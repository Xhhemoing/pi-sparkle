import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  costEligibleInvocations,
  isCostEligible,
  isUnattributed,
  sumUsage
} from "../../../src/telemetry/usage-aggregate.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { invocationError } from "../../../src/telemetry/model-invocation.js";
import {
  createAgentInstanceId,
  createInvocationId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { hash32 } from "../../../src/domain/hash.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

/**
 * 2026-08-22 weak-area report §1.2: errored invocations recorded `tokensIn: 0`
 * from the error payload's zeroed usage. Counting those does not just inflate
 * the record count — it drags every per-token average toward zero, which is
 * exactly the input the routing cost calibration trusts.
 */

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: createInvocationId(UUID),
    taskId: createTaskId(UUID),
    runId: createRunId(UUID),
    agentInstanceId: createAgentInstanceId(UUID),
    config: {
      provider: "faux",
      model: "faux-1",
      modelVersion: undefined,
      parameterHash: hash32("faux|faux-1|off||")
    },
    responseHash: hash32("body"),
    tokensIn: undefined,
    tokensOut: undefined,
    latencyMs: 12,
    occurredAt: "2026-08-14T00:00:00.000Z" as IsoTimestamp,
    ...overrides
  };
}

describe("cost eligibility", () => {
  it("admits only calls the provider completed", () => {
    assert.equal(isCostEligible(invocation({ callOutcome: "ok" })), true);
    for (const outcome of ["error", "timeout", "cancelled"] as const) {
      assert.equal(isCostEligible(invocation({ callOutcome: outcome })), false, outcome);
    }
  });

  it("treats a record with no outcome conservatively, and says why", () => {
    const legacy = invocation();
    assert.equal(isCostEligible(legacy), false, "an unattributed record must not be billed");
    assert.equal(isUnattributed(legacy), true);
    assert.equal(isUnattributed(invocation({ callOutcome: "error" })), false);
  });

  it("filters a mixed batch down to the billable calls", () => {
    const batch = [
      invocation({ callOutcome: "ok" }),
      invocation({ callOutcome: "error" }),
      invocation({ callOutcome: "ok" }),
      invocation()
    ];
    assert.equal(costEligibleInvocations(batch).length, 2);
  });
});

describe("sumUsage", () => {
  it("excludes the zeroed usage of failed calls from the totals", () => {
    // The exact shape the report found on disk: a 429 whose error payload
    // reported zero tokens next to one real call.
    const totals = sumUsage([
      invocation({ callOutcome: "ok", tokensIn: 100, tokensOut: 40 }),
      invocation({ callOutcome: "error", tokensIn: 0, tokensOut: 0 }),
      invocation({ callOutcome: "timeout", tokensIn: 0, tokensOut: 0 })
    ]);
    assert.equal(totals.tokensIn, 100);
    assert.equal(totals.tokensOut, 40);
    assert.equal(totals.invocations, 1);
    assert.equal(totals.excludedNotOk, 2);
    assert.equal(totals.excludedUnattributed, 0);
  });

  it("reports undefined, never zero, when nothing eligible carried usage", () => {
    const totals = sumUsage([
      invocation({ callOutcome: "ok" }),
      invocation({ callOutcome: "error", tokensIn: 0, tokensOut: 0 })
    ]);
    assert.equal(totals.tokensIn, undefined, "no data must never read as no tokens");
    assert.equal(totals.tokensOut, undefined);
    assert.equal(totals.invocations, 1);
    assert.equal(totals.missingUsage, 1);
    assert.equal(totals.withUsage, 0);
  });

  it("keeps a genuine zero from a completed call", () => {
    const totals = sumUsage([invocation({ callOutcome: "ok", tokensIn: 0, tokensOut: 12 })]);
    assert.equal(totals.tokensIn, 0);
    assert.equal(totals.tokensOut, 12);
    assert.equal(totals.withUsage, 1);
  });

  it("sums one side when the provider only reported one", () => {
    const totals = sumUsage([
      invocation({ callOutcome: "ok", tokensIn: 30 }),
      invocation({ callOutcome: "ok", tokensOut: 5 })
    ]);
    assert.equal(totals.tokensIn, 30);
    assert.equal(totals.tokensOut, 5);
    assert.equal(totals.withUsage, 2);
  });

  it("counts pre-attribution records apart from known failures", () => {
    const totals = sumUsage([
      invocation({ tokensIn: 999 }),
      invocation({ callOutcome: "cancelled" }),
      invocation({ callOutcome: "ok", tokensIn: 1, tokensOut: 1 })
    ]);
    assert.equal(totals.tokensIn, 1, "a legacy record's tokens must not enter the total");
    assert.equal(totals.excludedUnattributed, 1);
    assert.equal(totals.excludedNotOk, 1);
  });

  it("is empty, not zero, for an empty batch", () => {
    const totals = sumUsage([]);
    assert.deepEqual(
      { invocations: totals.invocations, tokensIn: totals.tokensIn, tokensOut: totals.tokensOut },
      { invocations: 0, tokensIn: undefined, tokensOut: undefined }
    );
  });

  it("mirrors the record validator: a non-integer count is not usage", () => {
    const bad = invocation({ callOutcome: "ok", tokensIn: 1.5, tokensOut: -3 });
    assert.notEqual(invocationError(bad), undefined, "the validator rejects these outright");
    const totals = sumUsage([bad]);
    assert.equal(totals.tokensIn, undefined);
    assert.equal(totals.tokensOut, undefined);
    assert.equal(totals.missingUsage, 1);
  });
});

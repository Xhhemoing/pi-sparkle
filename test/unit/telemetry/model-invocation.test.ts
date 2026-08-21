import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareRunToRun,
  hashInvocationResponse,
  invocationError,
  isInvocation,
  recordInvocation,
  validateInvocation,
} from "../../../src/telemetry/model-invocation.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import {
  createAgentInstanceId,
  createInvocationId,
  createRunId,
  createTaskId,
} from "../../../src/domain/ids.js";
import { hash32 } from "../../../src/domain/hash.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

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
      parameterHash: hash32("faux|faux-1|off||"),
    },
    responseHash: hash32("Faux response: task acknowledged."),
    tokensIn: undefined,
    tokensOut: undefined,
    latencyMs: 12,
    occurredAt: "2026-08-14T00:00:00.000Z" as IsoTimestamp,
    ...overrides,
  };
}

describe("Checkpoint F-4: model invocation recording", () => {
  it("records configuration, response hash, and unavailability instead of zero usage", () => {
    const record = recordInvocation(invocation());
    assert.equal(record.config.provider, "faux");
    assert.equal(record.config.model, "faux-1");
    assert.equal(record.config.modelVersion, undefined);
    assert.match(record.config.parameterHash, /^[0-9a-f]{1,8}$/);
    assert.equal(record.responseHash, hash32("Faux response: task acknowledged."));
    assert.equal(record.tokensIn, undefined, "unavailable usage must stay undefined, not zero");
    assert.equal(record.tokensOut, undefined);
    assert.equal(isInvocation(record), true);
  });

  it("hashes response bodies deterministically", () => {
    assert.equal(hashInvocationResponse("hello"), hashInvocationResponse("hello"));
    assert.notEqual(hashInvocationResponse("hello"), hashInvocationResponse("world"));
  });

  it("rejects malformed records instead of recording them", () => {
    const bad: Array<[Partial<ModelInvocation>, RegExp]> = [
      [{ id: "inv_bad!" as never }, /invalid invocation id/],
      [{ taskId: "nope" as never }, /invalid taskId/],
      [{ runId: "run_bad!" as never }, /invalid runId/],
      [{ agentInstanceId: "agt_bad!" as never }, /invalid agentInstanceId/],
      [{ config: { ...invocation().config, provider: "  " } }, /provider is required/],
      [{ config: { ...invocation().config, model: "" } }, /model is required/],
      [{ config: { ...invocation().config, modelVersion: "" } }, /modelVersion must not be empty/],
      [{ config: { ...invocation().config, parameterHash: "zzz" } }, /invalid parameterHash/],
      [{ responseHash: "g_123" }, /invalid responseHash/],
      [{ tokensIn: -1 }, /tokensIn/],
      [{ tokensOut: 1.5 }, /tokensOut/],
      [{ latencyMs: Number.NaN }, /latencyMs/],
      [{ occurredAt: "yesterday" as never }, /occurredAt/],
    ];
    for (const [patch, pattern] of bad) {
      const candidate = invocation(patch);
      const error = invocationError(candidate);
      assert.ok(error !== undefined && pattern.test(error), `expected ${pattern} for ${JSON.stringify(patch)}, got ${error}`);
      assert.throws(() => validateInvocation(candidate));
      assert.equal(isInvocation(candidate), false);
    }
  });

  it("pairs runs by task id and separates identical from differing invocations", () => {
    const base = [invocation(), invocation({ taskId: createTaskId(() => "22222222-89ab-cdef-0123-456789abcdef") })];
    const same = base.map((record) => ({ ...record }));
    const variance = compareRunToRun(base, same);
    assert.equal(variance.paired, 2);
    assert.equal(variance.identical, 2);
    assert.equal(variance.differing, 0);
    assert.equal(variance.unpairedInFirst, 0);
    assert.equal(variance.unpairedInSecond, 0);
    assert.equal(variance.allPairedIdentical, true);
  });

  it("detects changed responses and changed configuration across runs", () => {
    const first = [invocation()];
    const changedResponse = [invocation({ responseHash: hash32("different body") })];
    const changedConfig = [
      invocation({ config: { ...invocation().config, parameterHash: hash32("other params") } }),
    ];
    assert.deepEqual(
      { paired: 1, identical: 0, differing: 1 },
      {
        paired: compareRunToRun(first, changedResponse).paired,
        identical: compareRunToRun(first, changedResponse).identical,
        differing: compareRunToRun(first, changedResponse).differing,
      }
    );
    assert.deepEqual(
      { paired: 1, identical: 0, differing: 1 },
      {
        paired: compareRunToRun(first, changedConfig).paired,
        identical: compareRunToRun(first, changedConfig).identical,
        differing: compareRunToRun(first, changedConfig).differing,
      }
    );
  });

  it("reports unpaired invocations and never claims identity on an empty pairing", () => {
    const a = [invocation()];
    const b = [invocation({ taskId: createTaskId(() => "99999999-89ab-cdef-0123-456789abcdef") })];
    const variance = compareRunToRun(a, b);
    assert.equal(variance.paired, 0);
    assert.equal(variance.unpairedInFirst, 1);
    assert.equal(variance.unpairedInSecond, 1);
    assert.equal(variance.allPairedIdentical, false, "no pairing must never claim identical replay");
  });
});

it("pricing catalog version is recorded separately from provider-reported usage", () => {
  const inv = invocation({
    tokensIn: 120,
    tokensOut: 80,
    pricing: {
      catalogVersion: "catalog-2026-09",
      inputUsdPerMTok: 0.15,
      outputUsdPerMTok: 0.6
    }
  });
  assert.equal(invocationError(inv), undefined);
  assert.equal(inv.pricing?.catalogVersion, "catalog-2026-09");
  assert.equal(inv.pricing?.catalogVersion.includes("120"), false);
});

it("retries, cache hits, timeouts, and cancellations are attributable", () => {
  const retry = invocation({ attempt: 2, callOutcome: "ok" });
  const cacheHit = invocation({ attempt: 1, cacheHit: true, callOutcome: "ok" });
  const timeout = invocation({ attempt: 1, callOutcome: "timeout" });
  const cancelled = invocation({ attempt: 1, callOutcome: "cancelled" });
  for (const inv of [retry, cacheHit, timeout, cancelled]) {
    assert.equal(invocationError(inv), undefined);
  }
  assert.equal(retry.attempt, 2);
  assert.equal(cacheHit.cacheHit, true);
  assert.equal(timeout.callOutcome, "timeout");
  assert.equal(cancelled.callOutcome, "cancelled");
});

it("invalid attribution fields fail closed", () => {
  assert.match(invocationError(invocation({ attempt: 0 })) ?? "", /attempt/);
  assert.match(invocationError(invocation({ attempt: 1.5 })) ?? "", /attempt/);
  assert.match(invocationError(invocation({ callOutcome: "dropped" as never })) ?? "", /callOutcome/);
  assert.match(invocationError(invocation({ cacheHit: "yes" as never })) ?? "", /cacheHit/);
  assert.match(
    invocationError(invocation({ pricing: { catalogVersion: "" } })) ?? "",
    /catalogVersion/
  );
  assert.match(
    invocationError(invocation({ pricing: { catalogVersion: "c", inputUsdPerMTok: -1 } })) ?? "",
    /inputUsdPerMTok/
  );
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeUsageCoverage } from "../../../src/telemetry/usage-coverage.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import {
  createAgentInstanceId,
  createInvocationId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

function invocation(index: number, overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  const uuid = () => `01234567-89ab-cdef-0123-${String(index).padStart(12, "0")}`;
  return {
    id: createInvocationId(uuid),
    taskId: createTaskId(uuid),
    runId: createRunId(uuid),
    agentInstanceId: createAgentInstanceId(uuid),
    config: { provider: "faux", model: "faux-1", modelVersion: undefined, parameterHash: "abc" },
    responseHash: "def",
    tokensIn: undefined,
    tokensOut: undefined,
    latencyMs: 12,
    occurredAt: "2026-10-19T00:00:00.000Z" as IsoTimestamp,
    ...overrides
  };
}

const pricing = { catalogVersion: "test-v1", inputUsdPerMTok: 2, outputUsdPerMTok: 4 };

describe("summarizeUsageCoverage", () => {
  it("retains reported usage from failed and cancelled calls apart from calibration", () => {
    const report = summarizeUsageCoverage([
      invocation(1, { callOutcome: "ok", tokensIn: 100, tokensOut: 10, pricing }),
      invocation(2, { callOutcome: "error", tokensIn: 200, tokensOut: 20, pricing }),
      invocation(3, { callOutcome: "timeout", tokensIn: 300, tokensOut: 30, pricing }),
      invocation(4, { callOutcome: "cancelled", tokensIn: 400, tokensOut: 40, pricing }),
      invocation(5, { tokensIn: 500, tokensOut: 50, pricing })
    ]);
    assert.equal(report.totalRecords, 5);
    assert.equal(report.uniqueIdentities, 5);
    assert.equal(report.overall.invocations, 5);
    assert.equal(report.overall.input.tokens, 1500);
    assert.equal(report.overall.output.tokens, 150);
    assert.equal(report.byOutcome.error.input.tokens, 200);
    assert.equal(report.byOutcome.cancelled.output.tokens, 40);
    assert.deepEqual(Object.fromEntries(Object.entries(report.byOutcome).map(([key, value]) => [key, value.invocations])), {
      ok: 1, error: 1, timeout: 1, cancelled: 1, unknown: 1
    });
    assert.equal(report.overall.cost.pricedInvocations, 5);
    assert.ok(Math.abs(report.overall.cost.knownUsd! - 0.0036) < 1e-15);
    assert.equal(report.overall.cost.completeUsd, report.overall.cost.knownUsd);
  });

  it("reports independently missing usage and price sides without pricing partial rows", () => {
    const report = summarizeUsageCoverage([
      invocation(1, { tokensIn: 1_000_000, tokensOut: 0, pricing }),
      invocation(2, { tokensIn: 12, tokensOut: 3, pricing: { catalogVersion: "v", inputUsdPerMTok: 2 } }),
      invocation(3, { tokensIn: 4, pricing: { catalogVersion: "v", outputUsdPerMTok: 4 } }),
      invocation(4)
    ]);
    assert.deepEqual(report.overall.input, {
      reportedInvocations: 3, missingInvocations: 1, invalidInvocations: 0,
      tokens: 1_000_016, overflow: false, complete: false
    });
    assert.deepEqual(report.overall.output, {
      reportedInvocations: 2, missingInvocations: 2, invalidInvocations: 0,
      tokens: 3, overflow: false, complete: false
    });
    assert.deepEqual(report.overall.inputPrice, { reportedInvocations: 2, missingInvocations: 2, invalidInvocations: 0 });
    assert.deepEqual(report.overall.outputPrice, { reportedInvocations: 2, missingInvocations: 2, invalidInvocations: 0 });
    assert.deepEqual(report.overall.cost, { pricedInvocations: 1, knownUsd: 2, completeUsd: undefined, overflow: false });
  });

  it("distinguishes genuine zero usage and prices from absent fields and an empty input", () => {
    const zero = summarizeUsageCoverage([invocation(1, {
      tokensIn: 0, tokensOut: 0,
      pricing: { catalogVersion: "free", inputUsdPerMTok: 0, outputUsdPerMTok: 0 }
    })]);
    assert.equal(zero.overall.input.tokens, 0);
    assert.equal(zero.overall.input.complete, true);
    assert.equal(zero.overall.cost.knownUsd, 0);
    assert.equal(zero.overall.cost.completeUsd, 0);
    const absent = summarizeUsageCoverage([invocation(2)]);
    assert.equal(absent.overall.input.tokens, undefined);
    assert.equal(absent.overall.cost.knownUsd, undefined);
    assert.equal(absent.overall.cost.completeUsd, undefined);
    const empty = summarizeUsageCoverage([]);
    assert.equal(empty.totalRecords, 0);
    assert.equal(empty.uniqueIdentities, 0);
    assert.equal(empty.overall.input.complete, false);
    assert.equal(empty.overall.cost.knownUsd, undefined);
    assert.equal(empty.overall.cost.completeUsd, undefined);
  });

  it("deduplicates identical identity and data, including property order variations", () => {
    const row = invocation(1, { tokensIn: 3, tokensOut: 2, pricing });
    const copy = { ...row, config: { parameterHash: "abc", modelVersion: undefined, model: "faux-1", provider: "faux" } };
    const report = summarizeUsageCoverage([row, copy, structuredClone(row)]);
    assert.equal(report.totalRecords, 3);
    assert.equal(report.uniqueIdentities, 1);
    assert.equal(report.duplicateRecords, 2);
    assert.deepEqual(report.conflicts, []);
    assert.equal(report.overall.invocations, 1);
    assert.equal(report.overall.input.tokens, 3);
    assert.equal(report.overall.cost.completeUsd, report.overall.cost.knownUsd);
  });

  it("excludes every conflicting identity instead of choosing a winner", () => {
    const row = invocation(1, { callOutcome: "ok", tokensIn: 10, tokensOut: 2, pricing });
    const conflict = { ...row, callOutcome: "cancelled" as const, tokensIn: 20 };
    const other = invocation(2, { tokensIn: 1_000_000, tokensOut: 0, pricing });
    const report = summarizeUsageCoverage([row, conflict, structuredClone(row), other]);
    assert.equal(report.totalRecords, 4);
    assert.equal(report.uniqueIdentities, 2);
    assert.equal(report.duplicateRecords, 1);
    assert.deepEqual(report.conflicts, [{ id: row.id, records: 3, variants: 2 }]);
    assert.equal(report.overall.invocations, 1);
    assert.equal(report.overall.input.tokens, 1_000_000);
    assert.equal(report.overall.input.complete, false);
    assert.equal(report.byOutcome.ok.invocations, 0);
    assert.equal(report.byOutcome.cancelled.invocations, 0);
    assert.equal(report.overall.cost.knownUsd, 2);
    assert.equal(report.overall.cost.completeUsd, undefined);
    assert.equal(report.byOutcome.unknown.cost.completeUsd, undefined);
  });

  it("treats changes to non-usage invocation data as conflicts too", () => {
    const row = invocation(1, { tokensIn: 1, tokensOut: 1, pricing });
    for (const change of [
      { responseHash: "aaa" }, { taskId: invocation(2).taskId }, { latencyMs: 13 },
      { config: { ...row.config, provider: "other" } }, { executorClass: "pi" as const },
      { pricing: { ...pricing, catalogVersion: "another" } }
    ]) {
      const report = summarizeUsageCoverage([row, { ...row, ...change }]);
      assert.equal(report.conflicts.length, 1);
      assert.equal(report.overall.cost.knownUsd, undefined);
      assert.equal(report.overall.invocations, 0);
    }
  });

  it("has identical totals and conflicts for every input permutation without mutating rows", () => {
    const first = invocation(1, { tokensIn: 1, tokensOut: 0, pricing: { ...pricing, inputUsdPerMTok: 0.1 } });
    const second = invocation(2, { tokensIn: 1, tokensOut: 0, pricing: { ...pricing, inputUsdPerMTok: 1e20 } });
    const third = invocation(3, { tokensIn: 1, tokensOut: 0, pricing: { ...pricing, inputUsdPerMTok: 1.1 } });
    const fourth = invocation(4, { tokensIn: 1 });
    const rows = [first, second, third, fourth, { ...fourth, tokensIn: 2 }, structuredClone(first)];
    const before = structuredClone(rows);
    const expected = summarizeUsageCoverage(rows);
    for (const order of permutations(rows)) assert.deepEqual(summarizeUsageCoverage(order), expected);
    assert.deepEqual(rows, before);
    for (const row of rows) {
      Object.freeze(row.config);
      if (row.pricing) Object.freeze(row.pricing);
      Object.freeze(row);
    }
    assert.deepEqual(summarizeUsageCoverage(Object.freeze(rows)), expected);
  });

  it("separates invalid token counts from missing and never prices invalid rows", () => {
    const invalidCounts = [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];
    const report = summarizeUsageCoverage(invalidCounts.map((tokensIn, index) =>
      invocation(index + 1, { tokensIn, tokensOut: 0, pricing })));
    assert.equal(report.overall.input.invalidInvocations, 6);
    assert.equal(report.overall.input.missingInvocations, 0);
    assert.equal(report.overall.input.tokens, undefined);
    assert.equal(report.overall.input.complete, false);
    assert.equal(report.overall.output.tokens, 0);
    assert.equal(report.overall.cost.pricedInvocations, 0);
    assert.equal(report.overall.cost.knownUsd, undefined);
    assert.equal(report.overall.cost.completeUsd, undefined);
  });

  it("separates invalid prices from missing without emitting non-finite costs", () => {
    const invalidRates = [-1, NaN, Infinity, -Infinity];
    const report = summarizeUsageCoverage(invalidRates.map((inputUsdPerMTok, index) => invocation(index + 1, {
      tokensIn: 1, tokensOut: 1, pricing: { ...pricing, inputUsdPerMTok }
    })));
    assert.equal(report.overall.inputPrice.invalidInvocations, 4);
    assert.equal(report.overall.inputPrice.missingInvocations, 0);
    assert.equal(report.overall.cost.knownUsd, undefined);
    assert.equal(report.overall.cost.completeUsd, undefined);
  });

  it("never turns token sum or USD arithmetic overflow into a spend total", () => {
    const tokenOverflow = summarizeUsageCoverage([
      invocation(1, { tokensIn: Number.MAX_SAFE_INTEGER, tokensOut: 0, pricing }),
      invocation(2, { tokensIn: 1, tokensOut: 0, pricing })
    ]);
    assert.equal(tokenOverflow.overall.input.overflow, true);
    assert.equal(tokenOverflow.overall.input.tokens, undefined);
    assert.equal(tokenOverflow.overall.cost.knownUsd, undefined);
    assert.equal(tokenOverflow.overall.cost.completeUsd, undefined);
    const rates = { catalogVersion: "extreme", inputUsdPerMTok: Number.MAX_VALUE, outputUsdPerMTok: Number.MAX_VALUE };
    for (const rows of [
      [invocation(1, { tokensIn: 2_000_000, tokensOut: 0, pricing: rates })],
      [invocation(1, { tokensIn: 1_000_000, tokensOut: 1_000_000, pricing: rates })],
      [invocation(1, { tokensIn: 1_000_000, tokensOut: 0, pricing: rates }), invocation(2, { tokensIn: 1_000_000, tokensOut: 0, pricing: rates })]
    ]) {
      const report = summarizeUsageCoverage(rows);
      assert.equal(report.overall.cost.overflow, true);
      assert.equal(report.overall.cost.knownUsd, undefined);
      assert.equal(report.overall.cost.completeUsd, undefined);
    }
  });
});

function* permutations<T>(rows: readonly T[]): Generator<T[]> {
  if (rows.length === 0) yield [];
  for (let index = 0; index < rows.length; index++) {
    for (const tail of permutations(rows.filter((_, at) => at !== index))) yield [rows[index]!, ...tail];
  }
}

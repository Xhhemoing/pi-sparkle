import assert from "node:assert/strict";
import { mkdir, appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isInvocation, type ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { loadInvocationsFromStateRoot } from "../../../src/routing/cost-calibration.js";
import {
  recordedTaxonomyVersion,
  stampTaxonomyVersion,
  type TaskTaxonomyEntry
} from "../../../src/task/taxonomy.js";
import {
  createAgentInstanceId,
  createInvocationId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { hash32 } from "../../../src/domain/hash.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const BASE = "01234567-89ab-cdef-0123-456789abcdef";

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: createInvocationId(UUID),
    taskId: createTaskId(UUID),
    runId: createRunId(UUID),
    agentInstanceId: createAgentInstanceId(UUID),
    config: {
      provider: "faux",
      model: "faux-mini",
      modelVersion: undefined,
      parameterHash: hash32("params")
    },
    responseHash: hash32("response"),
    tokensIn: 100,
    tokensOut: 50,
    latencyMs: 250,
    occurredAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
    ...overrides
  };
}

test("persisted invocations keep retry, cache, timeout, cancel, and pricing attribution", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-telemetry-"));
  try {
    const records: readonly ModelInvocation[] = [
      invocation({ taskId: createTaskId(() => `${BASE.slice(0, 24)}00000001`), attempt: 1, callOutcome: "ok" }),
      // retry of the same logical call
      invocation({ taskId: createTaskId(() => `${BASE.slice(0, 24)}00000001`), attempt: 2, callOutcome: "timeout" }),
      invocation({ taskId: createTaskId(() => `${BASE.slice(0, 24)}00000002`), attempt: 1, cacheHit: true, callOutcome: "ok" }),
      invocation({ taskId: createTaskId(() => `${BASE.slice(0, 24)}00000003`), attempt: 1, callOutcome: "cancelled" }),
      invocation({
        taskId: createTaskId(() => `${BASE.slice(0, 24)}00000004`),
        attempt: 1,
        callOutcome: "ok",
        pricing: { catalogVersion: "catalog-2026-09", inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 }
      }),
      // malformed line must be skipped, not fail the load
      invocation({ tokensIn: -5 }) as unknown as ModelInvocation
    ];
    const log = join(stateRoot, "runtime", "invocations.jsonl");
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    for (const record of records) {
      await appendFile(log, `${JSON.stringify(record)}\n`);
    }

    const loaded = await loadInvocationsFromStateRoot(stateRoot);
    assert.equal(loaded.length, 5, "malformed invocation is dropped, valid ones load");

    const retries = loaded.filter((inv) => (inv.attempt ?? 1) > 1);
    const cacheHits = loaded.filter((inv) => inv.cacheHit === true);
    const timeouts = loaded.filter((inv) => inv.callOutcome === "timeout");
    const cancelled = loaded.filter((inv) => inv.callOutcome === "cancelled");
    const priced = loaded.filter((inv) => inv.pricing !== undefined);
    assert.equal(retries.length, 1);
    assert.equal(cacheHits.length, 1);
    assert.equal(timeouts.length, 1);
    assert.equal(cancelled.length, 1);
    assert.equal(priced.length, 1);

    // Pricing stays separate from provider-reported usage.
    const pricedRecord = priced[0];
    assert.equal(pricedRecord?.pricing?.catalogVersion, "catalog-2026-09");
    assert.equal(pricedRecord?.tokensIn, 100);
    assert.equal(
      JSON.stringify(pricedRecord?.pricing ?? {}).includes("tokensIn"),
      false,
      "pricing block must not absorb usage fields"
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("taxonomy version changes do not rewrite historical facts", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-telemetry-"));
  try {
    const historical: TaskTaxonomyEntry = stampTaxonomyVersion(
      { taskId: "tsk_hist", family: "edit", skills: ["typescript"] },
      1
    );
    const current = stampTaxonomyVersion({
      taskId: "tsk_now",
      family: "review",
      skills: []
    });
    const log = join(stateRoot, "taxonomy.jsonl");
    const lines = [historical, current]
      .map((entry) => JSON.stringify({ ...entry, taxonomy: recordedTaxonomyVersion(entry) }))
      .join("\n");
    await appendFile(log, `${lines}\n`);

    // Re-reading the persisted facts leaves each recorded version untouched:
    // no defaulting to the current TAXONOMY_VERSION, no rewriting.
    const raw = JSON.parse(`[${lines.replace(/\n/g, ",")}]`) as Array<{
      taskId: string;
      taxonomy: number | undefined;
    }>;
    assert.deepEqual(
      raw.map((row) => row.taxonomy),
      [1, 1]
    );
    assert.equal(recordedTaxonomyVersion(historical), 1);
    assert.equal(recordedTaxonomyVersion(current), 1);
    // The historical entry object itself was never mutated by re-stamping.
    const restamped = stampTaxonomyVersion(historical, 2);
    assert.equal(historical.taxonomyVersion, 1);
    assert.equal(restamped.taxonomyVersion, 2);
    assert.ok(isInvocation(invocation()));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

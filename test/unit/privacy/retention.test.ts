import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createProjectId, type EpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { appendFeedback, feedbackTombstonesPath, readFeedbackRecordsRaw } from "../../../src/feedback/store.js";
import {
  DEFAULT_RETENTION_POLICY,
  isWithinRetentionBound,
  planRetention,
  pruneRetention,
  validateRetentionPolicy
} from "../../../src/privacy/retention.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { catalogObservedPath } from "../../../src/routing/catalog-observed.js";
import { invocationsLogPath } from "../../../src/telemetry/invocation-log.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

const NOW = new Date("2026-08-24T00:00:00.000Z");
const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

const at = (): Date => NOW;

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-retention-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function invocationRow(id: string, occurredAt: string | undefined): Record<string, unknown> {
  return {
    id,
    taskId: "tsk_ret",
    runId: "run_ret",
    agentInstanceId: "agt_ret",
    config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
    responseHash: "def",
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 200,
    ...(occurredAt !== undefined ? { occurredAt } : {}),
    callOutcome: "ok"
  };
}

async function writeInvocations(stateRoot: string, rows: readonly unknown[]): Promise<string> {
  const path = invocationsLogPath(stateRoot);
  await mkdir(runtimeRoot(stateRoot), { recursive: true });
  const body = rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n");
  await writeFile(path, body === "" ? "" : `${body}\n`, "utf8");
  return path;
}

function episodeFixture(episodeId: EpisodeId, startedAt: string, closedAt?: string): ProjectEpisode {
  return {
    id: episodeId,
    projectId: createProjectId(UUID),
    objective: "Ship the payroll importer for acme-corp",
    contractVersion: 1,
    runIds: [],
    startedAt: parseIsoTimestamp(startedAt),
    ...(closedAt !== undefined ? { closedAt: parseIsoTimestamp(closedAt) } : {}),
    status: closedAt === undefined ? "OPEN" : "COMPLETED",
    acceptance: [{ id: "ac-1", description: "Rows match the ledger", observableCheck: "diff is empty" }],
    evidenceRefs: []
  };
}

async function seedEpisode(
  stateRoot: string,
  startedAt: string,
  closedAt?: string
): Promise<EpisodeId> {
  const episodeId = createEpisodeId(UUID);
  const dir = join(runtimeRoot(stateRoot), "episodes");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${episodeId}.jsonl`),
    `${JSON.stringify(episodeFixture(episodeId, startedAt, closedAt))}\n`,
    "utf8"
  );
  return episodeId;
}

test("the default policy is a 90-day age bound", () => {
  assert.deepEqual(DEFAULT_RETENTION_POLICY, { maxAgeDays: 90 });
});

test("a policy that is not a positive finite number of days is refused", () => {
  for (const maxAgeDays of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateRetentionPolicy({ maxAgeDays }), DomainValidationError);
  }
  assert.deepEqual(validateRetentionPolicy({ maxAgeDays: 7 }), { maxAgeDays: 7 });
});

test("an empty state root plans nothing and is within the bound", async () => {
  await withStateRoot(async (stateRoot) => {
    const plan = await planRetention(stateRoot, { now: at });
    assert.deepEqual(plan.expired, []);
    assert.deepEqual(plan.held, []);
    assert.equal(plan.consideredRecords, 0);
    assert.equal(plan.oldestAgeDays, undefined);
    assert.equal(isWithinRetentionBound(plan), true);
  });
});

test("the plan expires only records older than the bound, and reports the oldest age", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeInvocations(stateRoot, [
      invocationRow("inv_fresh", daysAgo(1)),
      invocationRow("inv_edge", daysAgo(89)),
      invocationRow("inv_old", daysAgo(120))
    ]);
    const fresh = await seedEpisode(stateRoot, daysAgo(10), daysAgo(9));
    const stale = await seedEpisode(stateRoot, daysAgo(200), daysAgo(199));

    const plan = await planRetention(stateRoot, { now: at });

    assert.deepEqual(
      plan.expired.map((record) => [record.kind, record.id]),
      [
        ["episode", stale],
        ["invocation", "inv_old"]
      ]
    );
    assert.equal(plan.expired[0]?.ageDays, 199);
    assert.equal(plan.consideredRecords, 5);
    assert.equal(plan.oldestAgeDays, 199);
    assert.equal(isWithinRetentionBound(plan), false);
    assert.ok(!plan.expired.some((record) => record.id === fresh));
  });
});

test("an undated invocation row is held, not deleted on a guess", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await writeInvocations(stateRoot, [
      invocationRow("inv_undated", undefined),
      invocationRow("inv_old", daysAgo(200))
    ]);

    const plan = await planRetention(stateRoot, { now: at });
    assert.deepEqual(plan.held, [
      { kind: "invocation", id: "inv_undated", path, reason: "undated" }
    ]);

    const result = await pruneRetention(stateRoot, { now: at, apply: true });
    assert.equal(result.droppedInvocations, 1);
    const remaining = (await readFile(path, "utf8")).trim().split("\n");
    assert.equal(remaining.length, 1);
    assert.equal((JSON.parse(remaining[0] as string) as { id: string }).id, "inv_undated");
  });
});

test("a dry run reports what it would remove and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await writeInvocations(stateRoot, [invocationRow("inv_old", daysAgo(200))]);
    const episodeId = await seedEpisode(stateRoot, daysAgo(200), daysAgo(199));
    const before = await readFile(path, "utf8");

    const result = await pruneRetention(stateRoot, { now: at });

    assert.equal(result.applied, false);
    assert.equal(result.plan.expired.length, 2);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(result.droppedInvocations, 0);
    assert.equal(await readFile(path, "utf8"), before);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "episodes", `${episodeId}.jsonl`)),
      true
    );
  });
});

test("apply drops expired invocation rows and invalidates the derived p50 snapshot", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await writeInvocations(stateRoot, [
      invocationRow("inv_old", daysAgo(200)),
      invocationRow("inv_fresh", daysAgo(2))
    ]);
    const observed = catalogObservedPath(stateRoot);
    await mkdir(join(runtimeRoot(stateRoot), "routing"), { recursive: true });
    await writeFile(observed, JSON.stringify({ models: [] }), "utf8");

    const result = await pruneRetention(stateRoot, { now: at, apply: true });

    assert.equal(result.applied, true);
    assert.equal(result.droppedInvocations, 1);
    assert.ok(result.removedPaths.includes(observed), "the stale aggregate must be invalidated");
    assert.equal(existsSync(observed), false);
    const kept = (await readFile(path, "utf8")).trim().split("\n");
    assert.deepEqual(
      kept.map((line) => (JSON.parse(line) as { id: string }).id),
      ["inv_fresh"]
    );
  });
});

test("apply deletes an expired episode through the deletion cascade", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = await seedEpisode(stateRoot, daysAgo(200), daysAgo(199));
    await appendFeedback(stateRoot, {
      id: "fb-expired",
      episodeId,
      kind: "human",
      rubricVersion: "1",
      score: 70,
      evidenceRefs: [],
      redacted: false,
      createdAt: parseIsoTimestamp(daysAgo(199)),
      body: "the importer dropped the last payroll row",
      summary: "importer drops rows"
    });

    const result = await pruneRetention(stateRoot, { now: at, apply: true });

    assert.deepEqual(result.deletedEpisodes, [episodeId]);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "episodes", `${episodeId}.jsonl`)),
      false
    );
    assert.deepEqual(result.cascadedFeedbackTombstones, ["fb-expired"]);
    const tombstones = JSON.parse(
      await readFile(feedbackTombstonesPath(stateRoot), "utf8")
    ) as string[];
    assert.deepEqual(tombstones, ["fb-expired"]);

    // The audit shell survives; both free-text fields are physically gone.
    const [record] = await readFeedbackRecordsRaw(stateRoot);
    assert.equal(record?.id, "fb-expired");
    assert.equal(record?.body, undefined);
    assert.equal(record?.summary, undefined);
  });
});

test("an open episode ages from startedAt; a closed one from closedAt", async () => {
  await withStateRoot(async (stateRoot) => {
    const openStale = await seedEpisode(stateRoot, daysAgo(120));
    // Started long ago but closed recently: the close is the newest fact, so it stays.
    const closedRecently = await seedEpisode(stateRoot, daysAgo(200), daysAgo(3));

    const plan = await planRetention(stateRoot, { now: at });

    assert.deepEqual(
      plan.expired.map((record) => record.id),
      [openStale]
    );
    assert.ok(!plan.expired.some((record) => record.id === closedRecently));
  });
});

test("--max-age-days is honoured over the default", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeInvocations(stateRoot, [invocationRow("inv_old", daysAgo(10))]);

    assert.equal((await planRetention(stateRoot, { now: at })).expired.length, 0);
    assert.equal(
      (await planRetention(stateRoot, { now: at, policy: { maxAgeDays: 7 } })).expired.length,
      1
    );
  });
});

test("a corrupt invocation row fails the rewrite closed and removes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await writeInvocations(stateRoot, [
      invocationRow("inv_old", daysAgo(200)),
      "{ this is not json",
      invocationRow("inv_fresh", daysAgo(1))
    ]);
    const before = await readFile(path, "utf8");

    // The plan still reports: a report that dies on one damaged line is useless.
    const plan = await planRetention(stateRoot, { now: at });
    assert.equal(plan.expired.length, 1);
    assert.equal(plan.held.length, 1);

    await assert.rejects(
      () => pruneRetention(stateRoot, { now: at, apply: true }),
      DomainValidationError
    );
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("prune is idempotent: a second apply finds nothing over the bound", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeInvocations(stateRoot, [invocationRow("inv_old", daysAgo(200))]);
    await seedEpisode(stateRoot, daysAgo(200), daysAgo(199));

    const first = await pruneRetention(stateRoot, { now: at, apply: true });
    assert.equal(first.droppedInvocations, 1);
    assert.equal(first.deletedEpisodes.length, 1);

    const second = await pruneRetention(stateRoot, { now: at, apply: true });
    assert.equal(second.droppedInvocations, 0);
    assert.deepEqual(second.deletedEpisodes, []);
    assert.equal(isWithinRetentionBound(second.plan), true);
  });
});

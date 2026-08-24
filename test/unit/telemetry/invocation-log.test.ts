import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { hash32 } from "../../../src/domain/hash.js";
import {
  createAgentInstanceId,
  createInvocationId,
  createRunId,
  createTaskId,
  type RunId
} from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  INVOCATIONS_LOG,
  appendInvocationRecord,
  invocationLogLockPath,
  invocationsLogPath,
  readInvocationRecords,
  withInvocationLogLock,
  writeInvocationRecords
} from "../../../src/telemetry/invocation-log.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import * as costCalibration from "../../../src/routing/cost-calibration.js";
import { loadInvocationsFromStateRoot } from "../../../src/routing/cost-calibration.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-invlog-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: createInvocationId(UUID),
    taskId: createTaskId(UUID),
    runId: createRunId(UUID),
    agentInstanceId: createAgentInstanceId(UUID),
    config: {
      provider: "faux",
      model: "faux-1",
      modelVersion: "faux-1-v1",
      parameterHash: hash32("faux|faux-1")
    },
    responseHash: hash32("response"),
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 120,
    occurredAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    callOutcome: "ok",
    ...overrides
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readLines(stateRoot: string): Promise<string[]> {
  const raw = await readFile(invocationsLogPath(stateRoot), "utf8").catch(() => "");
  return raw.split("\n").filter((line) => line !== "");
}

function idsOf(lines: readonly string[]): string[] {
  return lines.map((line) => (JSON.parse(line) as { id: string }).id);
}

test("the log path is the runtime-plane invocations file and calibration shares it", () => {
  const stateRoot = join(tmpdir(), "pi-sparkle-path-check");
  assert.equal(invocationsLogPath(stateRoot), join(stateRoot, "runtime", INVOCATIONS_LOG));
  assert.equal(invocationLogLockPath(stateRoot), `${invocationsLogPath(stateRoot)}.lock`);
  // Same function object, not a second copy of the path: a reader and a writer
  // that disagree on the location would silently split the log in two.
  assert.equal(costCalibration.invocationsLogPath, invocationsLogPath);
  assert.equal(costCalibration.INVOCATIONS_LOG, INVOCATIONS_LOG);
});

test("appendInvocationRecord creates the runtime plane and writes one readable row", async () => {
  await withStateRoot(async (stateRoot) => {
    const record = invocation();
    await appendInvocationRecord(stateRoot, record);

    const lines = await readLines(stateRoot);
    assert.deepEqual(lines, [JSON.stringify(record)]);
    const loaded = await loadInvocationsFromStateRoot(stateRoot);
    assert.deepEqual(
      loaded.map((inv) => inv.id),
      [record.id]
    );
  });
});

test("a malformed invocation fails closed and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const bad = invocation({ tokensIn: -5 });
    await assert.rejects(
      () => appendInvocationRecord(stateRoot, bad),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /tokensIn must be a non-negative integer/);
        return true;
      }
    );
    assert.equal(existsSync(invocationsLogPath(stateRoot)), false, "nothing may be written");
  });
});

test("concurrent appends from one process all land, whole and in call order", async () => {
  await withStateRoot(async (stateRoot) => {
    const records = Array.from({ length: 12 }, () => invocation());
    await Promise.all(records.map((record) => appendInvocationRecord(stateRoot, record)));

    const lines = await readLines(stateRoot);
    assert.deepEqual(
      idsOf(lines),
      records.map((record) => record.id),
      "every row lands exactly once, in the order the appends were issued"
    );
  });
});

test("an append waits for the log lock instead of writing under another writer", async () => {
  await withStateRoot(async (stateRoot) => {
    const record = invocation();
    let pending: Promise<void> | undefined;

    await withInvocationLogLock(stateRoot, async () => {
      pending = appendInvocationRecord(stateRoot, record);
      await sleep(80);
      assert.equal(
        existsSync(invocationsLogPath(stateRoot)),
        false,
        "the append must not touch the log while another writer holds the lock"
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual(idsOf(await readLines(stateRoot)), [record.id]);
    assert.equal(existsSync(invocationLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("a rewrite under the lock cannot clobber a concurrent append", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = invocation();
    const dropped = invocation({ runId: doomed });
    await appendInvocationRecord(stateRoot, keeper);
    await appendInvocationRecord(stateRoot, dropped);

    const live = invocation();
    let pending: Promise<void> | undefined;

    // The shape of the delete cascade's rewrite: read, filter, write — with an
    // append issued right inside that window. Unlocked, the write would erase
    // the appended row; locked, the append is still queued when the rewrite
    // finishes.
    await withInvocationLogLock(stateRoot, async () => {
      const { values } = await readInvocationRecords(stateRoot, "refusing to rewrite it");
      pending = appendInvocationRecord(stateRoot, live);
      await sleep(50);
      await writeInvocationRecords(
        stateRoot,
        values.filter((row) => (row as { runId?: unknown }).runId !== doomed)
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual(idsOf(await readLines(stateRoot)), [keeper.id, live.id]);
  });
});

test("readInvocationRecords fails closed on a corrupt middle line and names the refusal", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = invocationsLogPath(stateRoot);
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(path, `${JSON.stringify(invocation())}\n{ not json\n{"id":"inv_c"}\n`, "utf8");

    await assert.rejects(
      () => readInvocationRecords(stateRoot, "refusing to rewrite it for a delete"),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.equal(
          error.message,
          `corrupt invocation jsonl at line 2 of ${path}; refusing to rewrite it for a delete`
        );
        return true;
      }
    );
  });
});

test("readInvocationRecords reports a crash-truncated tail instead of parsing it", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      invocationsLogPath(stateRoot),
      `${JSON.stringify(invocation())}\n{"id":"inv_partial","runId":"run_`,
      "utf8"
    );

    const read = await readInvocationRecords(stateRoot);
    assert.equal(read.values.length, 1);
    assert.equal(read.recovery.lineNumber, 2);
    assert.match(String(read.recovery.incompleteLine), /inv_partial/);
  });
});

test("a missing log reads as empty rather than throwing", async () => {
  await withStateRoot(async (stateRoot) => {
    const read = await readInvocationRecords(stateRoot);
    assert.deepEqual(read.values, []);
    assert.equal(read.path, invocationsLogPath(stateRoot));
  });
});

test("writeInvocationRecords replaces the log and empties it without leaving a blank line", async () => {
  await withStateRoot(async (stateRoot) => {
    await appendInvocationRecord(stateRoot, invocation());
    const kept = invocation();

    await withInvocationLogLock(stateRoot, () => writeInvocationRecords(stateRoot, [kept]));
    assert.deepEqual(idsOf(await readLines(stateRoot)), [kept.id]);

    await withInvocationLogLock(stateRoot, () => writeInvocationRecords(stateRoot, []));
    assert.equal(await readFile(invocationsLogPath(stateRoot), "utf8"), "");
  });
});

test("an append that cannot take the lock times out instead of writing unlocked", async () => {
  await withStateRoot(async (stateRoot) => {
    const held: RunId = createRunId(UUID);
    let outcome: unknown;

    await withInvocationLogLock(stateRoot, async () => {
      outcome = await appendInvocationRecord(stateRoot, invocation({ runId: held }), {
        timeoutMs: 40,
        retryMs: 5
      }).then(
        () => "resolved",
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the append");
    assert.match(outcome.message, /timed out waiting for lock/);
    assert.equal(existsSync(invocationsLogPath(stateRoot)), false, "no unlocked fallback write");
  });
});

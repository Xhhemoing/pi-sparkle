import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
  createInvocationSink,
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

test("the sink retries a lock timeout and the row lands once the lock clears", async () => {
  await withStateRoot(async (stateRoot) => {
    const record = invocation();
    const drops: string[] = [];
    const backoffs: number[] = [];
    let releaseLock = (): void => undefined;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const sink = createInvocationSink(stateRoot, {
      onDrop: (reason) => drops.push(reason),
      maxAttempts: 3,
      retryBackoffMs: 1,
      timeoutMs: 60,
      retryMs: 5,
      // The retry backoff is the synchronization point: the first attempt has
      // provably timed out by the time this runs, so releasing here exercises
      // "lock cleared between attempt 1 and attempt 2" without a sleep race.
      sleep: async (ms) => {
        backoffs.push(ms);
        releaseLock();
      }
    });

    let pending: Promise<void> | undefined;
    await withInvocationLogLock(stateRoot, async () => {
      pending = sink(record);
      await lockHeld;
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual(backoffs, [1], "exactly one retry was needed");
    assert.deepEqual(drops, [], "a row that lands is never reported as dropped");
    assert.deepEqual(idsOf(await readLines(stateRoot)), [record.id]);
  });
});

test("the sink gives up after its retry budget without throwing and reports the drop once", async () => {
  await withStateRoot(async (stateRoot) => {
    const kept = invocation();
    await appendInvocationRecord(stateRoot, kept);
    const before = await readFile(invocationsLogPath(stateRoot), "utf8");

    const drops: string[] = [];
    const backoffs: number[] = [];
    const sink = createInvocationSink(stateRoot, {
      onDrop: (reason) => drops.push(reason),
      maxAttempts: 3,
      retryBackoffMs: 1,
      timeoutMs: 20,
      retryMs: 5,
      sleep: async (ms) => {
        backoffs.push(ms);
      }
    });

    let outcome: unknown = "never settled";
    await withInvocationLogLock(stateRoot, async () => {
      outcome = await sink(invocation()).then(
        () => "resolved",
        (error: unknown) => error
      );
    });

    assert.equal(outcome, "resolved", "the live path must never see a telemetry rejection");
    assert.deepEqual(backoffs, [1, 1], "three tries means two backoffs, no more");
    assert.equal(drops.length, 1, "the terminal drop is reported exactly once");
    assert.match(drops[0] ?? "", /lock timeout after 3 attempts/);
    assert.match(
      drops[0] ?? "",
      new RegExp(invocationLogLockPath(stateRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the drop names the lock that blocked it"
    );
    assert.equal(
      await readFile(invocationsLogPath(stateRoot), "utf8"),
      before,
      "a dropped row leaves the log byte-identical"
    );
  });
});

test("the sink drops an invalid record immediately, with no retry", async () => {
  await withStateRoot(async (stateRoot) => {
    const drops: string[] = [];
    const backoffs: number[] = [];
    const sink = createInvocationSink(stateRoot, {
      onDrop: (reason) => drops.push(reason),
      maxAttempts: 3,
      retryBackoffMs: 1,
      sleep: async (ms) => {
        backoffs.push(ms);
      }
    });

    const outcome = await sink(invocation({ tokensIn: -5 })).then(
      () => "resolved",
      (error: unknown) => error
    );

    assert.equal(outcome, "resolved");
    assert.deepEqual(backoffs, [], "a record the validator rejects is never retried");
    assert.equal(drops.length, 1);
    assert.match(drops[0] ?? "", /tokensIn must be a non-negative integer/);
    assert.equal(existsSync(invocationsLogPath(stateRoot)), false, "nothing may be written");
  });
});

test("sink writes keep call order even when the first one has to retry", async () => {
  await withStateRoot(async (stateRoot) => {
    const records = Array.from({ length: 6 }, () => invocation());
    const drops: string[] = [];
    let releaseLock = (): void => undefined;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const sink = createInvocationSink(stateRoot, {
      onDrop: (reason) => drops.push(reason),
      maxAttempts: 3,
      retryBackoffMs: 1,
      timeoutMs: 60,
      retryMs: 5,
      sleep: async () => {
        releaseLock();
      }
    });

    let pending: Promise<void>[] = [];
    await withInvocationLogLock(stateRoot, async () => {
      pending = records.map((record) => sink(record));
      await lockHeld;
    });

    await Promise.all(pending);
    assert.deepEqual(drops, []);
    assert.deepEqual(
      idsOf(await readLines(stateRoot)),
      records.map((record) => record.id),
      "the retrying first row still lands ahead of the rows issued after it"
    );
  });
});

/**
 * Source pin for the CLI wiring, in the style of `plane-boundary.test.ts`.
 *
 * The flowchart branch used to build its executor with `hooks = undefined`, so
 * `run --flowchart --executor pi` persisted zero invocation rows and cost
 * calibration was blind to that whole path. Nothing else in the suite would
 * notice the hook disappearing again, so pin both call sites here.
 */
const MAIN_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url)),
  "utf8"
);

/**
 * Blank out comment and string-literal contents, preserving length so the
 * result can be searched structurally. A hook that only survives as a comment
 * must not satisfy the pin.
 */
function normalizeSource(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (pair === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += "  ";
      index += 2;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") {
          out += "  ";
          index += 2;
          continue;
        }
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += char;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function runCommandBody(): string {
  const normalized = normalizeSource(MAIN_SOURCE);
  const start = normalized.indexOf("async function runCommand(");
  assert.ok(start >= 0, "runCommand must still exist in src/cli/main.ts");
  const end = normalized.indexOf("\n}\n", start);
  assert.ok(end > start, "could not find the end of runCommand");
  return normalized.slice(start, end);
}

function callArguments(body: string, openParen: number): string {
  let depth = 0;
  for (let index = openParen; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return body.slice(openParen + 1, index);
    }
  }
  return assert.fail("unbalanced parentheses in a createExecutor call in runCommand");
}

test("both createExecutor call sites in runCommand pass an invocation hook", () => {
  const body = runCommandBody();
  const needle = "createExecutor(";
  const sites: string[] = [];
  for (let at = body.indexOf(needle); at >= 0; at = body.indexOf(needle, at + 1)) {
    sites.push(callArguments(body, at + needle.length - 1));
  }

  assert.equal(
    sites.length,
    2,
    "runCommand builds exactly two executors: flowchart and children/track"
  );
  for (const args of sites) {
    assert.match(
      args,
      /onInvocation\s*:/,
      `createExecutor called without an invocation hook: ${args}`
    );
    assert.match(
      args,
      /invocationSink\s*\(/,
      `invocation hook does not use the shared sink: ${args}`
    );
  }
  assert.match(
    body,
    /const\s+invocationSink\s*=\s*createInvocationSink\(\s*stateRoot/,
    "both hooks must share one sink built from the resolved state root"
  );
  assert.match(
    MAIN_SOURCE,
    /import \{ createInvocationSink \} from "\.\.\/telemetry\/invocation-log\.js";/,
    "main.ts must import the sink factory, not hand-roll a fire-and-forget append"
  );
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

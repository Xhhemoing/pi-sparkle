#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";

const DEFAULT_ITERATIONS = 3;
const CHILD_TIMEOUT_MS = 3_000;
const CHILD_FLAG = "--crash-probe-child";
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function publishSentinel(sentinelPath, contents = `${process.pid}\n`) {
  const handle = await open(sentinelPath, "wx");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function signalAndKill(sentinelPath, contents) {
  await publishSentinel(sentinelPath, contents);
  process.kill(process.pid, "SIGKILL");
  await sleep(CHILD_TIMEOUT_MS);
  throw new Error("SIGKILL did not terminate crash-probe child");
}

function crashBeforeRenameOptions(payload, phase) {
  return {
    uniqueSuffix: () => payload.uniqueSuffix,
    rename: async (source, destination) => {
      await signalAndKill(
        payload.sentinelPath,
        `${JSON.stringify({ pid: process.pid, phase, source, destination })}\n`
      );
    }
  };
}

async function runChild(mode, payload) {
  if (mode === "jsonl-tail") {
    const handle = await open(payload.filePath, "a");
    try {
      await handle.writeFile(payload.partialLine, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await signalAndKill(payload.sentinelPath);
    return;
  }

  if (mode === "checkpoint-temp") {
    const handle = await open(payload.tempPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(payload.checkpoint, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await signalAndKill(payload.sentinelPath);
    await rename(payload.tempPath, payload.checkpointPath);
    return;
  }

  if (mode === "lock-holder") {
    const { withExclusiveFileLock } = await tsImport(
      "../src/persist/file-lock.ts",
      import.meta.url
    );
    await withExclusiveFileLock(payload.lockPath, async () => {
      await signalAndKill(payload.sentinelPath);
    });
    return;
  }

  if (mode === "feedback-tombstones") {
    const { withFeedbackLogLock, writeFeedbackRecords, writeFeedbackTombstones } = await tsImport(
      "../src/feedback/store.ts",
      import.meta.url
    );
    await withFeedbackLogLock(payload.stateRoot, async () => {
      await writeFeedbackRecords(payload.stateRoot, payload.records);
      await writeFeedbackTombstones(
        payload.stateRoot,
        new Set(payload.tombstones),
        crashBeforeRenameOptions(payload, "before-feedback-tombstones-rename")
      );
    });
    return;
  }

  if (mode === "feedback-rewrite") {
    const { withFeedbackLogLock, writeFeedbackRecords } = await tsImport(
      "../src/feedback/store.ts",
      import.meta.url
    );
    await withFeedbackLogLock(payload.stateRoot, () =>
      writeFeedbackRecords(
        payload.stateRoot,
        payload.records,
        crashBeforeRenameOptions(payload, "before-feedback-rewrite-rename")
      )
    );
    return;
  }

  if (mode === "invocation-rewrite") {
    const { withInvocationLogLock, writeInvocationRecords } = await tsImport(
      "../src/telemetry/invocation-log.ts",
      import.meta.url
    );
    await withInvocationLogLock(payload.stateRoot, () =>
      writeInvocationRecords(
        payload.stateRoot,
        payload.rows,
        crashBeforeRenameOptions(payload, "before-invocation-rewrite-rename")
      )
    );
    return;
  }

  if (mode === "episode-settle") {
    const { createEventId } = await tsImport("../src/domain/ids.ts", import.meta.url);
    const { nowIso } = await tsImport("../src/domain/timestamp.ts", import.meta.url);
    const { settleBoundEpisode } = await tsImport(
      "../src/run/episode-bind.ts",
      import.meta.url
    );
    await settleBoundEpisode({
      stateRoot: payload.stateRoot,
      events: payload.events,
      status: "FAILED",
      append: async (event) => {
        assert.equal(event.type, "EPISODE_CLOSED");
        await signalAndKill(
          payload.sentinelPath,
          `${JSON.stringify({ pid: process.pid, phase: "terminal-snapshot-appended" })}\n`
        );
      },
      make: (type, eventPayload) => ({
        id: createEventId(),
        schemaVersion: 1,
        occurredAt: nowIso(),
        runId: payload.runId,
        type,
        actor: "crash-probe",
        payload: eventPayload
      })
    });
    return;
  }

  if (mode === "atomic-write") {
    const { writeFileAtomic } = await tsImport(
      "../src/persist/atomic-file.ts",
      import.meta.url
    );
    await writeFileAtomic(payload.destinationPath, payload.contents, {
      uniqueSuffix: () => payload.uniqueSuffix,
      rename: async (source, destination) => {
        await signalAndKill(
          payload.sentinelPath,
          `${JSON.stringify({
            pid: process.pid,
            phase: "before-atomic-rename",
            source,
            destination
          })}\n`
        );
      }
    });
    return;
  }

  throw new Error(`unknown crash child mode: ${mode}`);
}

function spawnCrashChild(mode, payload) {
  const child = spawn(
    process.execPath,
    [SCRIPT_PATH, CHILD_FLAG, mode, JSON.stringify(payload)],
    { stdio: "ignore" }
  );
  const state = {};
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  void completion.then(
    (result) => {
      state.result = result;
    },
    (error) => {
      state.error = error;
    }
  );
  return { child, completion, state };
}

async function waitForSentinel(sentinelPath, state) {
  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await access(sentinelPath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (state.error !== undefined) throw state.error;
    if (state.result !== undefined) {
      throw new Error(
        `child exited before publishing sentinel (code=${state.result.code}, signal=${state.result.signal})`
      );
    }
    await sleep(5);
  }
  throw new Error(`timed out waiting for child sentinel at ${sentinelPath}`);
}

async function runKilledChild(mode, payload) {
  const spawned = spawnCrashChild(mode, payload);
  try {
    await waitForSentinel(payload.sentinelPath, spawned.state);
    const result = await Promise.race([
      spawned.completion,
      sleep(CHILD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
        throw new Error(`child did not exit after publishing ${payload.sentinelPath}`);
      })
    ]);
    assert.equal(result.code, null, `${mode} child must not exit normally`);
    assert.equal(result.signal, "SIGKILL", `${mode} child must self-SIGKILL`);
  } finally {
    if (spawned.child.exitCode === null && spawned.child.signalCode === null) {
      spawned.child.kill("SIGKILL");
      await spawned.completion.catch(() => undefined);
    }
  }
}

async function runCase(name, iterations, operation) {
  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await operation(iteration);
    }
    return { name, ok: true, iterations };
  } catch (error) {
    return { name, ok: false, iterations, error: errorMessage(error) };
  }
}

function parseIterations(args) {
  if (args.length === 0) return DEFAULT_ITERATIONS;
  if (args.length !== 2 || args[0] !== "--iterations") {
    throw new Error("usage: node scripts/crash-probe.mjs [--iterations <1-10>]");
  }
  const iterations = Number(args[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) {
    throw new Error("iterations must be an integer from 1 through 10");
  }
  return iterations;
}

async function runProbe(iterations) {
  const { appendJsonlLine, readJsonlObjects } = await tsImport(
    "../src/persist/jsonl.ts",
    import.meta.url
  );
  const { withExclusiveFileLock } = await tsImport(
    "../src/persist/file-lock.ts",
    import.meta.url
  );
  const { CheckpointStore } = await tsImport(
    "../src/run/checkpoint-store.ts",
    import.meta.url
  );
  const { runtimeRoot } = await tsImport(
    "../src/privacy/state-layout.ts",
    import.meta.url
  );
  const {
    appendFeedback,
    feedbackLogLockPath,
    feedbackLogPath,
    feedbackTombstonesPath,
    readFeedbackRecordsRaw,
    readFeedbackTombstoneIds,
    writeFeedbackTombstones
  } = await tsImport("../src/feedback/store.ts", import.meta.url);
  const {
    invocationLogLockPath,
    invocationsLogPath,
    readInvocationRecords,
    withInvocationLogLock,
    writeInvocationRecords
  } = await tsImport("../src/telemetry/invocation-log.ts", import.meta.url);
  const { writeFileAtomic } = await tsImport(
    "../src/persist/atomic-file.ts",
    import.meta.url
  );
  const { createEpisodeId, createEventId, createProjectId, createRunId } = await tsImport(
    "../src/domain/ids.ts",
    import.meta.url
  );
  const { nowIso } = await tsImport(
    "../src/domain/timestamp.ts",
    import.meta.url
  );
  const {
    bindEpisodeToRun,
    episodeLockPath,
    settleBoundEpisode
  } = await tsImport("../src/run/episode-bind.ts", import.meta.url);
  const { EpisodeStore } = await tsImport(
    "../src/run/episode-store.ts",
    import.meta.url
  );
  const { EpisodeEventStore } = await tsImport(
    "../src/episode/store.ts",
    import.meta.url
  );

  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-crash-probe-"));
  const cases = [];
  try {
    cases.push(
      await runCase("jsonl-truncated-tail", iterations, async (iteration) => {
        const caseDir = join(root, "jsonl", String(iteration));
        await mkdir(caseDir, { recursive: true });
        const filePath = join(caseDir, "events.jsonl");
        const sentinelPath = join(caseDir, "child-ready");
        const prefix = [
          { sequence: 1, iteration },
          { sequence: 2, payload: "intact-prefix" }
        ];
        for (const value of prefix) {
          await appendJsonlLine(filePath, JSON.stringify(value), true);
        }
        const partialLine = `{"sequence":3,"iteration":${iteration}`;

        await runKilledChild("jsonl-tail", { filePath, partialLine, sentinelPath });

        const read = await readJsonlObjects(
          filePath,
          (lineNumber) => new Error(`unexpected corrupt JSONL at line ${lineNumber}`)
        );
        assert.deepEqual(read.values, prefix);
        assert.deepEqual(read.recovery, {
          incompleteLine: partialLine,
          lineNumber: prefix.length + 1
        });
      })
    );

    cases.push(
      await runCase("checkpoint-old-then-next-write", iterations, async (iteration) => {
        const caseDir = join(root, "checkpoint", String(iteration));
        const stateRoot = join(caseDir, "state");
        const runId = `run_crash_probe_${iteration}`;
        const store = new CheckpointStore(stateRoot, runId);
        const previous = { generation: 1, payload: `previous-${iteration}` };
        const next = { generation: 2, payload: `next-${iteration}` };
        await store.write(previous);

        const checkpointPath = join(
          runtimeRoot(stateRoot),
          "runs",
          runId,
          "checkpoint.json"
        );
        // The probe owns this unique interrupted-write path. It never discovers
        // or assumes the store's internal temporary-file naming strategy.
        const tempPath = join(dirname(checkpointPath), `interrupted-${randomUUID()}.tmp`);
        const sentinelPath = join(caseDir, "child-ready");
        await runKilledChild("checkpoint-temp", {
          checkpoint: next,
          checkpointPath,
          sentinelPath,
          tempPath
        });
        await access(tempPath);

        assert.deepEqual(await store.read(), previous);
        await store.write(next);
        assert.deepEqual(await store.read(), next);
      })
    );

    cases.push(
      await runCase("stale-lock-no-steal", iterations, async (iteration) => {
        const caseDir = join(root, "lock", String(iteration));
        await mkdir(caseDir, { recursive: true });
        const lockPath = join(caseDir, "resource.lock");
        const sentinelPath = join(caseDir, "child-ready");
        await runKilledChild("lock-holder", { lockPath, sentinelPath });

        let waiterEntered = false;
        let timeoutError;
        try {
          await withExclusiveFileLock(
            lockPath,
            async () => {
              waiterEntered = true;
            },
            { timeoutMs: 120, retryMs: 5 }
          );
        } catch (error) {
          timeoutError = error;
        }
        assert.equal(waiterEntered, false);
        assert.ok(timeoutError instanceof Error);
        assert.equal(timeoutError.name, "DomainValidationError");
        assert.match(timeoutError.message, /timed out waiting for lock/);
        assert.ok(timeoutError.message.includes(lockPath));

        await rm(lockPath);
        const recovered = await withExclusiveFileLock(
          lockPath,
          async () => "recovered",
          { timeoutMs: 120, retryMs: 5 }
        );
        assert.equal(recovered, "recovered");
      })
    );

    cases.push(
      await runCase("feedback-cascade-strip-before-tombstone", iterations, async (iteration) => {
        const caseDir = join(root, "feedback-cascade", String(iteration));
        const stateRoot = join(caseDir, "state");
        const episodeId = createEpisodeId(() => `cascade_${iteration}`);
        const otherEpisodeId = createEpisodeId(() => `cascade_other_${iteration}`);
        const target = await appendFeedback(stateRoot, {
          id: `feedback-cascade-${iteration}`,
          episodeId,
          kind: "human",
          rubricVersion: "1",
          score: 90,
          evidenceRefs: [],
          redacted: false,
          createdAt: nowIso(),
          body: `feedback body ${iteration}`,
          summary: `feedback summary ${iteration}`
        });
        await appendFeedback(stateRoot, {
          id: `feedback-unrelated-${iteration}`,
          episodeId: otherEpisodeId,
          kind: "peer",
          rubricVersion: "1",
          score: 70,
          evidenceRefs: [],
          redacted: false,
          createdAt: nowIso(),
          body: `unrelated body ${iteration}`,
          summary: `unrelated summary ${iteration}`
        });
        assert.equal(target.body, `feedback body ${iteration}`);
        assert.equal(target.summary, `feedback summary ${iteration}`);

        const before = await readFeedbackRecordsRaw(stateRoot);
        const stripped = before.map((record) => {
          if (record.id !== target.id) return record;
          return Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== "body" && key !== "summary")
          );
        });
        const tombstonePath = feedbackTombstonesPath(stateRoot);
        const existingTombstone = `feedback-existing-${iteration}`;
        const oldTombstones = new Set([existingTombstone]);
        const candidateTombstones = [existingTombstone, target.id].sort();
        await writeFeedbackTombstones(stateRoot, oldTombstones);
        const beforeTombstoneBytes = await readFile(tombstonePath, "utf8");
        const candidateTombstoneBytes = `${JSON.stringify(candidateTombstones, null, 2)}\n`;
        const sentinelPath = join(caseDir, "child-ready");

        await runKilledChild("feedback-tombstones", {
          records: stripped,
          sentinelPath,
          stateRoot,
          tombstones: candidateTombstones,
          uniqueSuffix: `feedback-tombstones-${iteration}`
        });
        await access(feedbackLogLockPath(stateRoot));
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "before-feedback-tombstones-rename");
        assert.equal(sentinel.destination, tombstonePath);
        assert.notEqual(sentinel.source, tombstonePath);

        const after = await readFeedbackRecordsRaw(stateRoot);
        assert.deepEqual(after, stripped, "free text must be stripped before tombstone publication");
        assert.ok(
          after.some((record) => record.id === `feedback-unrelated-${iteration}`),
          "the unrelated feedback row must survive the interrupted cascade"
        );
        assert.equal(await readFile(tombstonePath, "utf8"), beforeTombstoneBytes);
        const tombstones = await readFeedbackTombstoneIds(stateRoot);
        assert.deepEqual(tombstones, oldTombstones);
        assert.equal(tombstones.has(target.id), false);
        assert.equal(await readFile(sentinel.source, "utf8"), candidateTombstoneBytes);
        await rm(feedbackLogLockPath(stateRoot));
        await rm(sentinel.source);
      })
    );

    cases.push(
      await runCase("feedback-rewrite-kill-before-rename", iterations, async (iteration) => {
        const caseDir = join(root, "feedback-rewrite", String(iteration));
        const stateRoot = join(caseDir, "state");
        const target = await appendFeedback(stateRoot, {
          id: `feedback-rewrite-target-${iteration}`,
          episodeId: createEpisodeId(() => `rewrite_target_${iteration}`),
          kind: "human",
          rubricVersion: "1",
          score: 80,
          evidenceRefs: [],
          redacted: false,
          createdAt: nowIso(),
          body: `target body ${iteration}`
        });
        const unrelated = await appendFeedback(stateRoot, {
          id: `feedback-rewrite-unrelated-${iteration}`,
          episodeId: createEpisodeId(() => `rewrite_unrelated_${iteration}`),
          kind: "peer",
          rubricVersion: "1",
          score: 70,
          evidenceRefs: [],
          redacted: false,
          createdAt: nowIso(),
          body: `unrelated body ${iteration}`
        });
        const beforeRecords = await readFeedbackRecordsRaw(stateRoot);
        const rewritten = beforeRecords.filter((record) => record.id !== target.id);
        const path = feedbackLogPath(stateRoot);
        const beforeBytes = await readFile(path, "utf8");
        const rewrittenBytes = `${rewritten.map((record) => JSON.stringify(record)).join("\n")}\n`;
        const sentinelPath = join(caseDir, "child-ready");

        await runKilledChild("feedback-rewrite", {
          records: rewritten,
          sentinelPath,
          stateRoot,
          uniqueSuffix: `feedback-rewrite-${iteration}`
        });

        await access(feedbackLogLockPath(stateRoot));
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "before-feedback-rewrite-rename");
        assert.equal(sentinel.destination, path);
        assert.notEqual(sentinel.source, path);
        assert.equal(await readFile(path, "utf8"), beforeBytes);
        assert.deepEqual(await readFeedbackRecordsRaw(stateRoot), beforeRecords);
        assert.ok(
          beforeRecords.some((record) => record.id === unrelated.id),
          "the unrelated feedback row must survive the interrupted rewrite"
        );
        assert.equal(await readFile(sentinel.source, "utf8"), rewrittenBytes);
        await rm(feedbackLogLockPath(stateRoot));
        await rm(sentinel.source);
      })
    );

    cases.push(
      await runCase("invocation-rewrite-kill-before-rename", iterations, async (iteration) => {
        const caseDir = join(root, "invocation-rewrite", String(iteration));
        const stateRoot = join(caseDir, "state");
        const target = {
          id: `invocation-rewrite-target-${iteration}`,
          runId: `run_rewrite_target_${iteration}`,
          futureField: { preserve: "target" }
        };
        const unrelated = {
          id: `invocation-rewrite-unrelated-${iteration}`,
          runId: `run_rewrite_unrelated_${iteration}`,
          futureField: { preserve: "unrelated" }
        };
        const beforeRows = [target, unrelated];
        await withInvocationLogLock(stateRoot, () =>
          writeInvocationRecords(stateRoot, beforeRows)
        );
        const path = invocationsLogPath(stateRoot);
        const beforeBytes = await readFile(path, "utf8");
        const rewrittenBytes = `${JSON.stringify(unrelated)}\n`;
        const sentinelPath = join(caseDir, "child-ready");

        await runKilledChild("invocation-rewrite", {
          rows: [unrelated],
          sentinelPath,
          stateRoot,
          uniqueSuffix: `invocation-rewrite-${iteration}`
        });

        await access(invocationLogLockPath(stateRoot));
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "before-invocation-rewrite-rename");
        assert.equal(sentinel.destination, path);
        assert.notEqual(sentinel.source, path);
        assert.equal(await readFile(path, "utf8"), beforeBytes);
        assert.deepEqual((await readInvocationRecords(stateRoot)).values, beforeRows);
        assert.ok(
          (await readInvocationRecords(stateRoot)).values.some(
            (row) => row?.id === unrelated.id
          ),
          "the unrelated invocation row must survive the interrupted rewrite"
        );
        assert.equal(await readFile(sentinel.source, "utf8"), rewrittenBytes);
        await rm(invocationLogLockPath(stateRoot));
        await rm(sentinel.source);
      })
    );

    cases.push(
      await runCase("episode-settle-stale-lock-recovery", iterations, async (iteration) => {
        const caseDir = join(root, "episode-settle", String(iteration));
        const stateRoot = join(caseDir, "state");
        const runId = createRunId(() => `settle_${iteration}`);
        const events = [];
        const make = (type, payload) => ({
          id: createEventId(),
          schemaVersion: 1,
          occurredAt: nowIso(),
          runId,
          type,
          actor: "crash-probe",
          payload
        });
        const bound = await bindEpisodeToRun({
          stateRoot,
          runId,
          projectId: createProjectId(() => `settle_${iteration}`),
          objective: `crash settle ${iteration}`,
          append: async (event) => {
            events.push(event);
          },
          make
        });
        const snapshots = new EpisodeStore(stateRoot, bound.episodeId);
        const episodeEvents = new EpisodeEventStore(stateRoot, bound.episodeId);
        const sentinelPath = join(caseDir, "child-ready");

        await runKilledChild("episode-settle", {
          events,
          runId,
          sentinelPath,
          stateRoot
        });
        const lockPath = episodeLockPath(stateRoot, bound.episodeId);
        await access(lockPath);
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "terminal-snapshot-appended");
        const terminalBeforeWaiter = (await snapshots.readAll()).episodes.filter((episode) =>
          ["COMPLETED", "FAILED", "ABANDONED"].includes(episode.status)
        );
        assert.equal(terminalBeforeWaiter.length, 1);
        assert.equal(terminalBeforeWaiter[0]?.status, "FAILED");

        let waiterError;
        try {
          await settleBoundEpisode({
            stateRoot,
            events,
            status: "FAILED",
            append: async (event) => {
              events.push(event);
            },
            make,
            lockOptions: { timeoutMs: 120, retryMs: 5 }
          });
        } catch (error) {
          waiterError = error;
        }
        assert.ok(waiterError instanceof Error);
        assert.equal(waiterError.name, "DomainValidationError");
        assert.match(waiterError.message, /timed out waiting for lock/);
        assert.equal(
          (await snapshots.readAll()).episodes.filter((episode) =>
            ["COMPLETED", "FAILED", "ABANDONED"].includes(episode.status)
          ).length,
          1
        );

        await rm(lockPath);
        await settleBoundEpisode({
          stateRoot,
          events,
          status: "FAILED",
          append: async (event) => {
            events.push(event);
          },
          make,
          lockOptions: { timeoutMs: 120, retryMs: 5 }
        });
        assert.equal(
          (await snapshots.readAll()).episodes.filter((episode) =>
            ["COMPLETED", "FAILED", "ABANDONED"].includes(episode.status)
          ).length,
          1
        );
        assert.equal(
          (await episodeEvents.readAll()).events.filter((event) => event.type === "EPISODE_CLOSED")
            .length,
          1
        );
        assert.equal(events.filter((event) => event.type === "EPISODE_CLOSED").length, 0);
      })
    );

    cases.push(
      await runCase("atomic-write-stale-unique-temp", iterations, async (iteration) => {
        const caseDir = join(root, "atomic-write", String(iteration));
        await mkdir(caseDir, { recursive: true });
        const destinationPath = join(caseDir, "value.json");
        const sentinelPath = join(caseDir, "child-ready");
        const oldContents = `${JSON.stringify({ generation: "old", iteration })}\n`;
        const interruptedContents = `${JSON.stringify({
          generation: "interrupted",
          iteration,
          filler: "x".repeat(100_000)
        })}\n`;
        const recoveredContents = `${JSON.stringify({ generation: "recovered", iteration })}\n`;
        await writeFileAtomic(destinationPath, oldContents);

        await runKilledChild("atomic-write", {
          contents: interruptedContents,
          destinationPath,
          sentinelPath,
          uniqueSuffix: `interrupted-${iteration}`
        });
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "before-atomic-rename");
        assert.equal(sentinel.destination, destinationPath);
        assert.notEqual(sentinel.source, destinationPath);
        const afterCrash = await readFile(destinationPath, "utf8");
        assert.ok(
          afterCrash === oldContents || afterCrash === interruptedContents,
          "atomic destination contained bytes other than the complete old or new payload"
        );
        assert.equal(await readFile(sentinel.source, "utf8"), interruptedContents);

        await writeFileAtomic(destinationPath, recoveredContents, {
          uniqueSuffix: () => `interrupted-${iteration}`
        });
        assert.equal(await readFile(destinationPath, "utf8"), recoveredContents);
        assert.equal(
          await readFile(sentinel.source, "utf8"),
          interruptedContents,
          "the next writer adopted or modified the crashed writer's unique temp"
        );
        await rm(sentinel.source);
      })
    );
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      cases.push({
        name: "temporary-state-cleanup",
        ok: false,
        iterations: 1,
        error: errorMessage(error)
      });
    }
  }
  return { ok: cases.every((entry) => entry.ok), cases };
}

const args = process.argv.slice(2);
if (args[0] === CHILD_FLAG) {
  const mode = args[1] ?? "";
  const rawPayload = args[2];
  if (rawPayload === undefined) {
    process.exitCode = 2;
  } else {
    await runChild(mode, JSON.parse(rawPayload)).catch(() => {
      process.exitCode = 2;
    });
  }
} else {
  let verdict;
  try {
    verdict = await runProbe(parseIterations(args));
  } catch (error) {
    verdict = {
      ok: false,
      cases: [{ name: "probe", ok: false, iterations: 0, error: errorMessage(error) }]
    };
  }
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
}

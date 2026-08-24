#!/usr/bin/env node
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";

const DEFAULT_ITERATIONS = 3;
const CHILD_TIMEOUT_MS = 3_000;
const CHILD_FLAG = "--crash-probe-child";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const UNBLOCK_REASON_BYTES = 16 * 1024 * 1024;
const UNBLOCK_REASON_PREFIX = "widen the real append-before-checkpoint window: ";
const UNBLOCK_NODE_ID = "tsk_crash_unblock";
const UNBLOCK_NOW = "2026-08-24T20:00:00.000Z";

const PROBE_ROUTER_CONFIG = {
  policyVersion: "crash-probe-v1",
  models: [
    {
      id: "cheap",
      version: "cheap-v1",
      roles: ["actor", "critic"],
      maxComplexity: "MEDIUM",
      estimatedCostUsd: 0.1,
      estimatedDurationMs: 1_000
    },
    {
      id: "premium",
      version: "premium-v1",
      roles: ["actor", "critic", "judge", "router"],
      maxComplexity: "HIGH",
      estimatedCostUsd: 0.5,
      estimatedDurationMs: 4_000
    }
  ]
};

function unblockReason(bytes) {
  assert.ok(bytes >= UNBLOCK_REASON_PREFIX.length);
  return `${UNBLOCK_REASON_PREFIX}${"x".repeat(bytes - UNBLOCK_REASON_PREFIX.length)}`;
}

function verificationResult(request, kind) {
  const evidenceId = `evd_crash-${request.taskId}`;
  return {
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_crash-${request.agentInstanceId}`,
      occurredAt: UNBLOCK_NOW,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: "SUPERVISOR",
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: kind === "FAILED" ? "verification failed before unblock" : "verification passed after resume",
      artifactIds: [`art_crash-${request.taskId}`],
      evidenceIds: [evidenceId],
      verification: { kind, evidenceIds: [evidenceId] }
    }
  };
}

function recordingExecutor(kind) {
  const taskIds = [];
  return {
    taskIds,
    async *execute(request, signal) {
      taskIds.push(request.taskId);
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        return;
      }
      yield verificationResult(request, kind);
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  };
}

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

  if (mode === "run-lifecycle") {
    const { startRun } = await tsImport("../src/run/coordinator.ts", import.meta.url);
    const running = startRun(
      {
        stateRoot: payload.stateRoot,
        executor: {
          async *execute(request) {
            await signalAndKill(
              payload.sentinelPath,
              `${JSON.stringify({
                pid: process.pid,
                phase: "run-executing",
                runId: request.runId
              })}\n`
            );
            yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
          }
        }
      },
      {
        projectRoot: payload.projectRoot,
        objective: "hold the lifecycle lock until SIGKILL"
      }
    );
    await running.done;
    return;
  }

  if (mode === "unblock-flowchart") {
    const { unblockFlowchartRun } = await tsImport(
      "../src/run/flowchart-run.ts",
      import.meta.url
    );
    const { createModelRouter } = await tsImport(
      "../src/supervisor/model-router.ts",
      import.meta.url
    );
    await unblockFlowchartRun(
      {
        stateRoot: payload.stateRoot,
        router: createModelRouter(PROBE_ROUTER_CONFIG),
        now: () => payload.now,
        generateId: randomUUID
      },
      payload.runId,
      {
        reason: unblockReason(payload.reasonBytes),
        retryNodeId: payload.retryNodeId
      }
    );
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

async function waitForCompleteAppend(eventsPath, previousSize, minimumGrowth, state) {
  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const size = await stat(eventsPath).then(
      (entry) => entry.size,
      (error) => {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
    );
    if (size >= previousSize + minimumGrowth) {
      const handle = await open(eventsPath, "r");
      try {
        const byte = Buffer.alloc(1);
        const { bytesRead } = await handle.read(byte, 0, 1, size - 1);
        if (bytesRead === 1 && byte[0] === 0x0a) return size;
      } finally {
        await handle.close();
      }
    }
    if (state.error !== undefined) throw state.error;
    if (state.result !== undefined) {
      throw new Error(
        `child exited before the complete append was observable ` +
          `(code=${state.result.code}, signal=${state.result.signal})`
      );
    }
    await sleep(1);
  }
  throw new Error(`timed out waiting for complete append at ${eventsPath}`);
}

async function runExternallyKilledAfterAppend(mode, payload, eventsPath, previousSize) {
  const spawned = spawnCrashChild(mode, payload);
  const childPid = spawned.child.pid;
  assert.equal(Number.isSafeInteger(childPid), true, `${mode} child must have a PID`);
  try {
    const appendedSize = await waitForCompleteAppend(
      eventsPath,
      previousSize,
      payload.reasonBytes,
      spawned.state
    );
    assert.equal(
      spawned.child.kill("SIGKILL"),
      true,
      `${mode} child must still be alive after publishing the append`
    );
    const result = await Promise.race([
      spawned.completion,
      sleep(CHILD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
        throw new Error(`${mode} child did not exit after external SIGKILL`);
      })
    ]);
    assert.equal(result.code, null, `${mode} child must not exit normally`);
    assert.equal(result.signal, "SIGKILL", `${mode} child must receive external SIGKILL`);
    return { appendedSize, childPid };
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

async function snapshotDirectory(root) {
  const snapshot = [];
  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath =
        relativeDirectory === "" ? entry.name : join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        snapshot.push({ path: `${relativePath}/`, contents: null });
        await visit(path, relativePath);
      } else if (entry.isFile()) {
        snapshot.push({
          path: relativePath,
          contents: (await readFile(path)).toString("base64")
        });
      }
    }
  }
  await visit(root, "");
  return snapshot;
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
  const { LOCK_TIMEOUT_CODE, withExclusiveFileLock } = await tsImport(
    "../src/persist/file-lock.ts",
    import.meta.url
  );
  const { doctorCommand } = await tsImport("../src/cli/doctor.ts", import.meta.url);
  const { deleteRunRecords, verifyRunRecordsRemoved } = await tsImport(
    "../src/privacy/deletion.ts",
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
  const {
    createEpisodeId,
    createEventId,
    createProjectId,
    createRunId,
    parseTaskId
  } = await tsImport("../src/domain/ids.ts", import.meta.url);
  const { nowIso } = await tsImport(
    "../src/domain/timestamp.ts",
    import.meta.url
  );
  const { createAgentProfileRegistry, defaultAgentProfiles } = await tsImport(
    "../src/agents/registry.ts",
    import.meta.url
  );
  const { compileChildrenToFlowchart } = await tsImport(
    "../src/graph/compile-children.ts",
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
  const { EventStore, runLockPath } = await tsImport(
    "../src/run/event-store.ts",
    import.meta.url
  );
  const { resumeFlowchartRun, startFlowchartRun } = await tsImport(
    "../src/run/flowchart-run.ts",
    import.meta.url
  );
  const { replayRun } = await tsImport("../src/run/replay.ts", import.meta.url);
  const { createModelRouter } = await tsImport(
    "../src/supervisor/model-router.ts",
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
      await runCase("sigkill-run-lock-operator-recovery", iterations, async (iteration) => {
        const caseDir = join(root, "run-lifecycle", String(iteration));
        const stateRoot = join(caseDir, "state");
        const projectRoot = join(caseDir, "project");
        const sentinelPath = join(caseDir, "child-ready");
        await mkdir(projectRoot, { recursive: true });

        await runKilledChild("run-lifecycle", {
          projectRoot,
          sentinelPath,
          stateRoot
        });

        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
        assert.equal(sentinel.phase, "run-executing");
        assert.equal(typeof sentinel.runId, "string");
        assert.equal(Number.isSafeInteger(sentinel.pid), true);
        assert.notEqual(sentinel.pid, process.pid);

        const lockPath = runLockPath(stateRoot, sentinel.runId);
        const lock = JSON.parse(await readFile(lockPath, "utf8"));
        assert.equal(lock.pid, sentinel.pid, "the abandoned run lock must record the dead child PID");
        let pidError;
        try {
          process.kill(lock.pid, 0);
        } catch (error) {
          pidError = error;
        }
        assert.equal(pidError?.code, "ESRCH", "the PID recorded in the run lock must be dead");

        const runDir = join(runtimeRoot(stateRoot), "runs", sentinel.runId);
        const beforeDelete = await snapshotDirectory(runDir);
        assert.ok(
          beforeDelete.some((entry) => entry.path === "events.jsonl"),
          "the child must reach a persisted real run before SIGKILL"
        );
        const refused = await deleteRunRecords(stateRoot, sentinel.runId, {
          timeoutMs: 120,
          retryMs: 5
        }).then(
          () => assert.fail("deleteRunRecords must not steal the SIGKILLed run's lock"),
          (error) => error
        );
        assert.equal(refused?.code, LOCK_TIMEOUT_CODE);
        assert.deepEqual(
          await snapshotDirectory(runDir),
          beforeDelete,
          "a LOCK_TIMEOUT must leave every run record untouched"
        );

        const stdout = [];
        await doctorCommand(
          ["--json", "--state-root", stateRoot],
          {
            stdout: (text) => stdout.push(text),
            stderr: () => {}
          }
        );
        const report = JSON.parse(stdout.join(""));
        const inventoryEntry = report.locks.entries.find((entry) => entry.path === lockPath);
        assert.ok(inventoryEntry, "doctor must inventory the abandoned run lock");
        assert.equal(inventoryEntry.pid, sentinel.pid);
        assert.equal(inventoryEntry.pidLiveness, "not-running");
        assert.equal(inventoryEntry.metadata, "valid");
        assert.match(inventoryEntry.remediation, /inspect and remove manually; never automatic/);
        assert.ok(
          inventoryEntry.remediation.includes(lockPath),
          "the remediation must name the lock the operator should inspect"
        );

        await rm(lockPath);
        const deleted = await deleteRunRecords(stateRoot, sentinel.runId);
        assert.deepEqual(deleted.removedPaths, [runDir]);
        await verifyRunRecordsRemoved(stateRoot, sentinel.runId);
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

    cases.push(
      await runCase("unblock-append-before-checkpoint-sigkill", iterations, async (iteration) => {
        const caseDir = join(root, "unblock-window", String(iteration));
        const stateRoot = join(caseDir, "state");
        const projectRoot = join(caseDir, "project");
        await mkdir(projectRoot, { recursive: true });

        const taskId = parseTaskId(UNBLOCK_NODE_ID);
        const childTask = {
          taskId,
          role: "implementer",
          objective: "fail verification, then pass after crash recovery",
          profile: createAgentProfileRegistry(defaultAgentProfiles()).resolve("implementer"),
          inputArtifactIds: [],
          acceptanceCriteria: [],
          limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
        };
        const failed = recordingExecutor("FAILED");
        const blocked = await startFlowchartRun(
          {
            stateRoot,
            router: createModelRouter(PROBE_ROUTER_CONFIG),
            now: () => UNBLOCK_NOW,
            generateId: randomUUID,
            executor: failed,
            cluster: true
          },
          {
            projectRoot,
            flowchart: compileChildrenToFlowchart([
              { taskId, role: "implementer", objective: childTask.objective }
            ]),
            childTasks: [childTask]
          }
        );
        assert.equal(blocked.status, "BLOCKED");
        assert.deepEqual(failed.taskIds, [UNBLOCK_NODE_ID]);
        assert.equal(blocked.snapshot.nodes[UNBLOCK_NODE_ID]?.state, "FAILED");

        const runDir = join(runtimeRoot(stateRoot), "runs", blocked.runId);
        const eventsPath = join(runDir, "events.jsonl");
        const checkpointPath = join(runDir, "checkpoint.json");
        const checkpointBefore = await readFile(checkpointPath, "utf8");
        const eventBytesBefore = (await stat(eventsPath)).size;

        // The observer is the parent process. A large but valid operator reason
        // gives it time to see the complete append and SIGKILL the unmodified
        // producer while that producer re-reads the log, before checkpoint I/O.
        const killed = await runExternallyKilledAfterAppend(
          "unblock-flowchart",
          {
            now: UNBLOCK_NOW,
            reasonBytes: UNBLOCK_REASON_BYTES,
            retryNodeId: UNBLOCK_NODE_ID,
            runId: blocked.runId,
            stateRoot
          },
          eventsPath,
          eventBytesBefore
        );
        assert.ok(killed.appendedSize >= eventBytesBefore + UNBLOCK_REASON_BYTES);

        const afterKill = (await new EventStore(stateRoot, blocked.runId).readAll()).events;
        const unblocks = afterKill.filter((event) => event.type === "RUN_UNBLOCKED");
        assert.equal(unblocks.length, 1, "the complete authorization append must survive SIGKILL");
        assert.equal(unblocks[0]?.payload.reason.length, UNBLOCK_REASON_BYTES);
        assert.equal(unblocks[0]?.payload.retryNodeId, UNBLOCK_NODE_ID);
        assert.equal(afterKill.at(-1)?.type, "RUN_UNBLOCKED");
        assert.equal(
          await readFile(checkpointPath, "utf8"),
          checkpointBefore,
          "the externally observed checkpoint must still be the blocked one"
        );
        assert.deepEqual(
          (await readdir(runDir)).filter((name) =>
            name.startsWith(`checkpoint.json.${killed.childPid}.`)
          ),
          [],
          "SIGKILL must land before the child starts its checkpoint write"
        );

        const lockPath = runLockPath(stateRoot, blocked.runId);
        const lock = JSON.parse(await readFile(lockPath, "utf8"));
        assert.equal(lock.pid, killed.childPid);
        await rm(lockPath);

        const passing = recordingExecutor("PASSED");
        const resumed = await resumeFlowchartRun(
          {
            stateRoot,
            router: createModelRouter(PROBE_ROUTER_CONFIG),
            now: () => UNBLOCK_NOW,
            generateId: randomUUID,
            executor: passing,
            cluster: true
          },
          blocked.runId
        );
        assert.equal(resumed.status, "COMPLETED");
        assert.equal(resumed.snapshot.nodes[UNBLOCK_NODE_ID]?.state, "COMPLETED");
        assert.deepEqual(passing.taskIds, [UNBLOCK_NODE_ID], "the reopened node must execute once");
        assert.equal(
          resumed.events.filter((event) => event.type === "RUN_UNBLOCKED").length,
          1,
          "resume must recover the existing authorization, not append another"
        );
        assert.deepEqual(
          resumed.events
            .map((event) => event.type)
            .filter((type) => type === "RUN_BLOCKED" || type === "RUN_COMPLETED"),
          ["RUN_BLOCKED", "RUN_COMPLETED"]
        );
        assert.deepEqual(replayRun(resumed.events).anomalies, []);
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

#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
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

async function publishSentinel(sentinelPath) {
  const handle = await open(sentinelPath, "wx");
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function signalAndKill(sentinelPath) {
  await publishSentinel(sentinelPath);
  process.kill(process.pid, "SIGKILL");
  await sleep(CHILD_TIMEOUT_MS);
  throw new Error("SIGKILL did not terminate crash-probe child");
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

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { RunId } from "../../../src/domain/ids.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { startTrackedRun } from "../../../src/track/loop.js";

/**
 * The track loop's clarification path mints a run id and writes a whole run's
 * records — discovery, a bound episode, `RUN_WAITING_FOR_USER`, a checkpoint
 * and `track-questions.json`. It is a run lifecycle, so it holds the run's
 * cooperative lock for all of it, like every other embedder.
 *
 * Before the acquisition it was the one CLI-reachable embedder the survivors
 * error's "an embedder that does not take the lifecycle lock" clause actually
 * described: driven against a held lock it wrote the entire run through, and
 * only the questions write at the end failed closed — leaving a half-written
 * run behind a `delete --run` that was removing that very subtree.
 */

/**
 * `waitForClarification` mints the run id from the injected generator's first
 * value, so the lock a foreign holder must take is known before the run runs.
 */
const CLARIFICATION_RUN_ID = "run_00000000-0000-4000-8000-000000000000" as RunId;

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-clarify-lock-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-clarify-lock-proj-"));
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** A vague objective with no answers is what routes into the clarification run. */
function clarificationInput(stateRoot: string, projectRoot: string, generateId: () => string) {
  return {
    projectRoot,
    objective: "do it",
    stateRoot,
    executor: new ProtocolChildExecutor(),
    primaryModelId: "premium",
    fastModelId: "cheap",
    generateId
  };
}

test("a clarification run refuses to start while another holder has the run lock, and writes nothing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let outcome: unknown;

    // The holder stands in for a `delete --run` already removing this run's
    // subtree, or a lock a killed run left behind.
    await withExclusiveFileLock(runLockPath(stateRoot, CLARIFICATION_RUN_ID), async () => {
      outcome = await startTrackedRun({
        ...clarificationInput(stateRoot, projectRoot, sequenceGenerator()),
        runLock: { timeoutMs: 40, retryMs: 5 }
      }).then(
        (value) => value,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof Error, "a clarification run that cannot take its lock must not start");
    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "runs", CLARIFICATION_RUN_ID)),
      false,
      "no event log, no checkpoint and no questions file for a run that was refused"
    );
    assert.deepEqual(
      await readdir(join(runtimeRoot(stateRoot), "episodes")).catch(() => []),
      [],
      "and no episode was bound past the holder"
    );
  });
});

test("a clarification run mints its id before the lock and its records under it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // Every id the run mints, paired with whether the lock file existed at that
    // moment. The run id comes first and must precede the acquisition (a run
    // refused by discovery leaves no `runtime/runs/`); everything the run
    // records afterwards is minted while the lock is held.
    const lockPath = runLockPath(stateRoot, CLARIFICATION_RUN_ID);
    const held: boolean[] = [];
    let n = 0;
    const generateId = (): string => {
      held.push(existsSync(lockPath));
      return `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
    };

    const outcome = await startTrackedRun(clarificationInput(stateRoot, projectRoot, generateId));

    assert.equal(outcome.status, "WAITING_FOR_USER");
    assert.equal(outcome.runId, CLARIFICATION_RUN_ID);
    assert.ok(outcome.questions.length > 0, "the run is the clarification path, not a full tracked run");
    assert.equal(held.at(0), false, "the run id is minted before the acquisition");
    assert.equal(held.at(-1), true, "the run's last record is written while it still holds the lock");
    assert.equal(existsSync(lockPath), false, "and teardown releases it");
  });
});

test("a clarification run still publishes its questions file crash-atomically", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await startTrackedRun(clarificationInput(stateRoot, projectRoot, sequenceGenerator()));

    const runDir = join(runtimeRoot(stateRoot), "runs", outcome.runId);
    const questions = JSON.parse(await readFile(join(runDir, "track-questions.json"), "utf8")) as {
      questions: { id: string }[];
      objective: string;
    };
    assert.equal(questions.objective, "do it");
    assert.deepEqual(
      questions.questions.map((question) => question.id),
      outcome.questions.map((question) => question.id)
    );
    assert.deepEqual(
      (await readdir(runDir)).filter((name) => name.endsWith(".tmp")),
      [],
      "the atomic publish leaves no temp file behind"
    );
  });
});

test("a clarification run refused by discovery persists nothing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    await assert.rejects(
      () =>
        startTrackedRun(
          clarificationInput(stateRoot, join(projectRoot, "missing"), sequenceGenerator())
        ),
      /root/
    );
    assert.deepEqual(
      await readdir(stateRoot).catch(() => []),
      [],
      "pre-flight outside the lock means a refused run does not even create runtime/runs/"
    );
  });
});

test("the track loop's clarification path takes the lock through the shared helper", async () => {
  const loop = await readFile(new URL("../../../src/track/loop.ts", import.meta.url), "utf8");

  assert.match(
    loop,
    /return withRunLifecycleLock\(\s*input\.stateRoot,\s*runId,\s*\(\) => recordClarificationRun\(input, contract, questions, runId, project\),\s*input\.runLock\s*\);/,
    "the record-writing body is what is wrapped, and the options seam is threaded"
  );
  assert.doesNotMatch(
    loop,
    /runLockPath|withExclusiveFileLock/,
    "the questions write no longer takes the run lock itself — the lock is not reentrant"
  );
  assert.ok(
    loop.indexOf("await discoverProject(") < loop.indexOf("return withRunLifecycleLock("),
    "discovery is pre-flight and stays outside the acquisition"
  );
});

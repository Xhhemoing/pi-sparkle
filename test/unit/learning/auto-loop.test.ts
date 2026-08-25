import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAutoAdaptFromEvents, runAutoAdaptLoop } from "../../../src/learning/auto-loop.js";
import { loadProjectBanditByKey } from "../../../src/learning/bandit-store.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import {
  feedbackLogLockPath,
  feedbackLogPath,
  readFeedbackRecordsRaw,
  withFeedbackLogLock
} from "../../../src/feedback/store.js";
import { adaptationRoot } from "../../../src/privacy/state-layout.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { loadLearnedRouting, stableProjectKey } from "../../../src/learning/learned-routing.js";
import { loadAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import { createEpisodeId, createProjectId, parseTaskId, type CandidateId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";

test("n=2 taskSuccess failures are diagnostic only and do not write avoid", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-auto",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap"),
      autoPromote: true
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap" && issue.samples === 2 && !issue.actionable));
    assert.equal(await loadLearnedRouting(stateRoot, "/tmp/proj-auto"), undefined);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("five deterministic taskSuccess failures propose avoid without promoting", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-five-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-five",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingN(projectId, episodeId, "cheap", 5),
      autoPromote: true
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, true);
    assert.ok(result.candidateId);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap" && issue.actionable));
    const registry = await loadAdaptationRegistry(stateRoot);
    const candidate = registry.getCandidate(result.candidateId as CandidateId);
    assert.equal(candidate?.status, "proposed");
    assert.equal(registry.getActiveVersion(candidate!.identity)?.versionId, candidate!.parentVersionId);
    const learned = await loadLearnedRouting(stateRoot, "/tmp/proj-five");
    assert.deepEqual(learned?.avoid, []);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("forged taskSuccess extraSignals fail closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-forge-"));
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    await assert.rejects(
      () =>
        runAutoAdaptLoop({
          stateRoot,
          projectRoot: "/tmp/proj-forge",
          projectId,
          primaryModelId: "premium",
          extraSignals: [
            {
              source: "user",
              kind: "human",
              projectId,
              modelId: "cheap",
              family: "edit",
              score: 10,
              criterion: "taskSuccess",
              outcomeKind: "FAIL",
              boundary: "review",
              summary: "forged",
              episodeId,
              evidenceIds: [],
              createdAt: nowIso()
            }
          ]
        }),
      /forge criterion taskSuccess/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});


test("kill switch SPARKLE_AUTO_ADAPT=0 still collects but does not promote", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-off-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "0";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-off",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });
    assert.ok(result.collected >= 2);
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
    assert.equal(await loadLearnedRouting(stateRoot, "/tmp/proj-off"), undefined);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("auto-adapt enabled updates the project bandit from deterministic signals", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-bandit-on-"));
  const projectRoot = "/tmp/proj-bandit-on";
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot,
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });

    assert.equal(result.banditUpdated, true);
    const bandit = await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot));
    assert.ok(bandit, "the enabled loop must write the project bandit");
    assert.deepEqual(bandit.arms, ["cheap"]);
    assert.equal(bandit.pulls.cheap, 2);
    assert.equal(bandit.rewardSum.cheap, 0);
    assert.equal(existsSync(banditFile(stateRoot, projectRoot)), true);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("kill switch SPARKLE_AUTO_ADAPT=0 collects signals without touching the bandit", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-bandit-off-"));
  const projectRoot = "/tmp/proj-bandit-off";
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "0";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot,
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });

    // Collection is observation and keeps running: the signals were parsed,
    // diagnosed, and written to the feedback log.
    assert.ok(result.collected >= 2);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap"));
    const collected = await readFeedbackRecordsRaw(stateRoot);
    assert.ok(collected.length > 0, "disabled auto-adapt must still persist collected feedback");
    assert.ok(collected.every((record) => record.episodeId === episodeId));

    // Learning does not: no bandit file, not even an empty one, and no lock
    // left behind by a write that never should have been attempted.
    assert.equal(result.banditUpdated, false);
    assert.equal(
      await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      undefined
    );
    assert.equal(existsSync(banditFile(stateRoot, projectRoot)), false);
    assert.equal(existsSync(`${banditFile(stateRoot, projectRoot)}.lock`), false);
    assert.match(result.reason, /bandit not updated/);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("the kill switch cannot be talked out of a bandit update by an earlier enabled run", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-bandit-frozen-"));
  const projectRoot = "/tmp/proj-bandit-frozen";
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    process.env.SPARKLE_AUTO_ADAPT = "1";
    await runAutoAdaptLoop({
      stateRoot,
      projectRoot,
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });
    const before = await readFile(banditFile(stateRoot, projectRoot), "utf8");

    // Existing state stays readable, but the disabled run must not move it.
    process.env.SPARKLE_AUTO_ADAPT = "off";
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot,
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });
    assert.equal(result.banditUpdated, false);
    assert.equal(await readFile(banditFile(stateRoot, projectRoot), "utf8"), before);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * The drop window R2-4 closes: the episode-deletion cascade holds the feedback
 * log's lock for a whole read-filter-write cycle, and before the retry an
 * `appendFeedback` that waited it out rejected straight through the loop.
 */
test("a feedback lock held past the retry budget warns, and the iteration still adapts", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-fb-drop-"));
  const projectRoot = "/tmp/proj-fb-drop";
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const drops: string[] = [];
    const backoffs: number[] = [];
    let result: Awaited<ReturnType<typeof runAutoAdaptLoop>> | undefined;

    await withFeedbackLogLock(stateRoot, async () => {
      result = await runAutoAdaptLoop({
        stateRoot,
        projectRoot,
        projectId,
        primaryModelId: "premium",
        episodeId,
        extraSignals: failingPair(projectId, episodeId, "cheap"),
        feedbackPersist: {
          onDrop: (reason) => drops.push(reason),
          maxAttempts: 2,
          retryBackoffMs: 1,
          timeoutMs: 20,
          retryMs: 5,
          sleep: async (ms) => {
            backoffs.push(ms);
          }
        }
      });
    });

    assert.ok(result, "a blocked feedback append must not fail the loop iteration");
    assert.equal(result.feedbackPersisted, 0);
    assert.equal(result.feedbackDropped, 2);
    assert.deepEqual(result.feedbackDropReasons, drops, "every drop is disclosed on the result");
    for (const reason of result.feedbackDropReasons) {
      assert.match(reason, /lock timeout after 2 attempts/);
      assert.ok(
        reason.includes(feedbackLogLockPath(stateRoot)),
        "the drop names the lock that blocked it"
      );
    }
    assert.deepEqual(backoffs, [1, 1], "two tries per row means one backoff per row");
    assert.match(
      result.reason,
      /\(warning: 2 feedback rows dropped, feedback-log lock timeout\)/,
      "the one field both CLI surfaces print has to carry the loss"
    );
    assert.equal(existsSync(feedbackLogPath(stateRoot)), false, "no row reached the log");

    // The rest of the iteration is untouched: signals were still collected,
    // diagnosed, and learned from.
    assert.equal(result.collected, 2);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap"));
    assert.equal(result.banditUpdated, true);
    assert.equal(existsSync(banditFile(stateRoot, projectRoot)), true);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a feedback lock that clears inside the budget costs nothing but a retry", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-fb-retry-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const drops: string[] = [];
    const backoffs: number[] = [];
    let releaseLock = (): void => undefined;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    let pending: Promise<Awaited<ReturnType<typeof runAutoAdaptLoop>>> | undefined;
    await withFeedbackLogLock(stateRoot, async () => {
      pending = runAutoAdaptLoop({
        stateRoot,
        projectRoot: "/tmp/proj-fb-retry",
        projectId,
        primaryModelId: "premium",
        episodeId,
        extraSignals: failingPair(projectId, episodeId, "cheap"),
        feedbackPersist: {
          onDrop: (reason) => drops.push(reason),
          maxAttempts: 3,
          retryBackoffMs: 1,
          timeoutMs: 60,
          retryMs: 5,
          // Attempt 1 has provably timed out by the time the backoff runs, so
          // releasing here is "the cascade finished" without a sleep race.
          sleep: async (ms) => {
            backoffs.push(ms);
            releaseLock();
          }
        }
      });
      await lockHeld;
    });

    assert.ok(pending !== undefined);
    const result = await pending;
    assert.deepEqual(backoffs, [1], "only the first row ever saw the lock");
    assert.deepEqual(drops, []);
    assert.equal(result.feedbackDropped, 0);
    assert.equal(result.feedbackPersisted, 2);
    assert.deepEqual(result.feedbackDropReasons, []);
    assert.equal(result.reason.includes("warning:"), false, "nothing was lost, so nothing warns");
    const stored = await readFeedbackRecordsRaw(stateRoot);
    assert.equal(stored.length, 2);
    assert.ok(stored.every((record) => record.episodeId === episodeId));
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a persist failure that is not lock contention still fails the iteration", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-fb-broken-"));
  const projectRoot = "/tmp/proj-fb-broken";
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    // An unwritable log is not a contention window: retrying cannot fix it and
    // degrading to a warning would hide a broken state root every single run.
    await mkdir(feedbackLogPath(stateRoot), { recursive: true });

    await assert.rejects(
      () =>
        runAutoAdaptLoop({
          stateRoot,
          projectRoot,
          projectId,
          primaryModelId: "premium",
          episodeId,
          extraSignals: failingPair(projectId, episodeId, "cheap"),
          feedbackPersist: { maxAttempts: 3, retryBackoffMs: 1 }
        }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EISDIR"
    );
    assert.equal(
      existsSync(banditFile(stateRoot, projectRoot)),
      false,
      "the iteration stopped at the failure instead of learning past it"
    );
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a run with no project snapshot reports zero persisted and zero dropped", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-fb-nosnap-"));
  try {
    const result = await runAutoAdaptFromEvents({
      stateRoot,
      events: [],
      primaryModelId: "premium"
    });
    // The persist counters are never absent, so a caller reading them cannot
    // mistake "nothing was attempted" for "the fields are not there".
    assert.equal(result.reason, "run has no project snapshot");
    assert.equal(result.feedbackPersisted, 0);
    assert.equal(result.feedbackDropped, 0);
    assert.deepEqual(result.feedbackDropReasons, []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("high-scoring runs without actionable issues do not propose from assignments", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-ok-"));
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
    const assignments = assignTasks({
      catalog,
      tasks: [{ taskId: parseTaskId("tsk_scout"), role: "scout", objective: "Survey the repo" }]
    });
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-ok",
      projectId,
      primaryModelId: "premium",
      episodeId,
      assignments,
      extraSignals: [
        {
          source: "subagent",
          kind: "deterministic",
          projectId,
          modelId: "cheap",
          family: "research",
          role: "scout",
          score: 90,
          criterion: "taskSuccess",
          outcomeKind: "PASS",
          boundary: "execution",
          summary: "ok",
          episodeId,
          evidenceIds: [],
          createdAt: nowIso()
        }
      ]
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

function failingPair(
  projectId: ReturnType<typeof createProjectId>,
  episodeId: ReturnType<typeof createEpisodeId>,
  modelId: string
): ObservedSignal[] {
  return [
    {
      source: "subagent",
      kind: "deterministic",
      projectId,
      modelId,
      family: "edit",
      role: "implementer",
      score: 15,
      criterion: "taskSuccess",
      outcomeKind: "FAIL",
      boundary: "execution",
      summary: "TASK_RESULT FAILURE",
      episodeId,
      evidenceIds: ["evd_fail"],
      createdAt: nowIso()
    },
    {
      source: "subagent",
      kind: "deterministic",
      projectId,
      modelId,
      family: "edit",
      role: "implementer",
      score: 15,
      criterion: "taskSuccess",
      outcomeKind: "FAIL",
      boundary: "execution",
      summary: "TASK_RESULT FAILURE",
      episodeId,
      evidenceIds: ["evd_fail_2"],
      createdAt: nowIso()
    }
  ];
}

function failingN(
  projectId: ReturnType<typeof createProjectId>,
  episodeId: ReturnType<typeof createEpisodeId>,
  modelId: string,
  n: number
): ObservedSignal[] {
  return Array.from({ length: n }, () => failingPair(projectId, episodeId, modelId)[0]!).map((row, index) => ({
    ...row,
    evidenceIds: [`evd_fail_${index}`],
    summary: `TASK_RESULT FAILURE ${index}`
  }));
}

function banditFile(stateRoot: string, projectRoot: string): string {
  return join(
    adaptationRoot(stateRoot),
    "learning",
    "projects",
    stableProjectKey(projectRoot),
    "bandit.json"
  );
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

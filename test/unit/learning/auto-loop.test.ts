import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAutoAdaptLoop } from "../../../src/learning/auto-loop.js";
import { loadProjectBandit } from "../../../src/learning/bandit-store.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import { readFeedbackRecordsRaw } from "../../../src/feedback/store.js";
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
    const bandit = await loadProjectBandit(stateRoot, projectRoot);
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
    assert.equal(await loadProjectBandit(stateRoot, projectRoot), undefined);
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

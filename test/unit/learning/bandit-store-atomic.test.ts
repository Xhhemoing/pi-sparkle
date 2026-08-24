import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createEpisodeId, createProjectId, type EpisodeId, type ProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { runAutoAdaptLoop } from "../../../src/learning/auto-loop.js";
import {
  BANDIT_STATE_UNREADABLE_CODE,
  loadProjectBanditByKey,
  updateProjectBandit
} from "../../../src/learning/bandit-store.js";
import { stableProjectKey } from "../../../src/learning/learned-routing.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import { adaptationRoot } from "../../../src/privacy/state-layout.js";

/**
 * The publish half of the bandit store: `updateProjectBandit` goes through the shared
 * `writeFileAtomic`, so a reader that does not hold the write lock never sees a spliced
 * document — which is what makes the fail-closed reader in `bandit-store.test.ts` an
 * external-damage contract rather than a crash-window one.
 */

const CONCURRENT_ARMS = 1200;
const CONCURRENT_PUBLISHES = 12;

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-atomic-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

function taskSuccess(modelId: string, outcomeKind: "PASS" | "FAIL"): ObservedSignal {
  return {
    source: "deterministic",
    kind: "deterministic",
    projectId: createProjectId(),
    modelId,
    score: outcomeKind === "PASS" ? 90 : 15,
    criterion: "taskSuccess",
    outcomeKind,
    boundary: "execution",
    summary: `task ${outcomeKind.toLowerCase()}`,
    evidenceIds: [],
    createdAt: nowIso()
  };
}

function failingPair(projectId: ProjectId, episodeId: EpisodeId, modelId: string): ObservedSignal[] {
  return [0, 1].map(() => ({
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
    evidenceIds: [],
    createdAt: nowIso()
  }));
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

async function seedLargeBandit(path: string, armCount: number): Promise<void> {
  const arms = Array.from({ length: armCount }, (_unused, index) =>
    `model-${String(index).padStart(4, "0")}`
  );
  const pulls: Record<string, number> = {};
  const rewardSum: Record<string, number> = {};
  for (const arm of arms) {
    pulls[arm] = 1;
    rewardSum[arm] = 1;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ arms, pulls, rewardSum, explorationsUsed: 0, highRiskExplorations: 0 }, null, 2)}\n`,
    "utf8"
  );
}

test("a reader racing repeated publishes never observes a spliced bandit document", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = banditFile(stateRoot, projectRoot);
    await seedLargeBandit(path, CONCURRENT_ARMS);

    let writing = true;
    const failures: string[] = [];
    let reads = 0;
    const reader = (async () => {
      while (writing) {
        try {
          const state = await loadProjectBanditByKey(
            stateRoot,
            stableProjectKey(projectRoot)
          );
          if (state === undefined) {
            failures.push("a read saw no bandit at all");
          } else if (state.arms.length !== CONCURRENT_ARMS) {
            failures.push(`a read saw ${state.arms.length} arms`);
          }
          reads += 1;
        } catch (error: unknown) {
          failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        }
      }
    })();

    try {
      for (let publish = 0; publish < CONCURRENT_PUBLISHES; publish += 1) {
        await updateProjectBandit(stateRoot, projectRoot, [taskSuccess("model-0000", "PASS")]);
      }
    } finally {
      writing = false;
      await reader;
    }

    assert.deepEqual(failures.slice(0, 3), [], `${failures.length} of ${reads} reads were torn`);
    assert.ok(reads > 5, `the reader only got ${reads} reads in; the race window was not exercised`);
    const published = await loadProjectBanditByKey(
      stateRoot,
      stableProjectKey(projectRoot)
    );
    assert.equal(published?.pulls["model-0000"], 1 + CONCURRENT_PUBLISHES);
    assert.deepEqual(
      (await readdir(dirname(path))).filter((name) => name.endsWith(".tmp")),
      [],
      "a published bandit must leave no temp file behind"
    );
  });
});

test("the published bytes and the lock lifecycle are unchanged by the atomic writer", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = banditFile(stateRoot, projectRoot);
    const state = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS"),
      taskSuccess("model-b", "FAIL")
    ]);

    assert.equal(await readFile(path, "utf8"), `${JSON.stringify(state, null, 2)}\n`);
    assert.equal(existsSync(`${path}.lock`), false);
    assert.deepEqual(
      (await readdir(dirname(path))).sort(),
      ["bandit.json"],
      "the publish directory must hold nothing but the published file"
    );
  });
});

test("a temp abandoned by a crashed writer is neither adopted nor truncated", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = banditFile(stateRoot, projectRoot);
    await mkdir(dirname(path), { recursive: true });
    const stale = `${path}.${process.pid}.9d1f0c2a-stale.tmp`;
    const staleBytes = '{"arms": ["model-crashed"';
    await writeFile(stale, staleBytes, "utf8");

    const state = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    assert.deepEqual(state.arms, ["model-a"]);
    assert.deepEqual(
      await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      state
    );
    assert.equal(await readFile(stale, "utf8"), staleBytes);
  });
});

test("the bandit store publishes through the shared atomic writer, not a private copy", () => {
  const source = readFileSync(
    new URL("../../../src/learning/bandit-store.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /writeFileAtomic\(path, /);
  assert.doesNotMatch(source, /\bwriteFile\(/, "the plain writer would publish a tearable file");
  assert.doesNotMatch(source, /\brename(Sync)?\(/, "no private temp+rename copy may reappear");
  assert.doesNotMatch(source, /\.tmp/, "temp naming belongs to persist/atomic-file.ts");
});

test("the kill switch stays collect-only, and fail-closed does not reach past it", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = banditFile(stateRoot, projectRoot);
    await mkdir(dirname(path), { recursive: true });
    const damaged = '{"arms": ["model-a"], "pulls"';
    await writeFile(path, damaged, "utf8");

    const previous = process.env.SPARKLE_AUTO_ADAPT;
    process.env.SPARKLE_AUTO_ADAPT = "0";
    try {
      const projectId = createProjectId();
      const episodeId = createEpisodeId();
      const collectOnly = await runAutoAdaptLoop({
        stateRoot,
        projectRoot,
        projectId,
        primaryModelId: "premium",
        episodeId,
        extraSignals: failingPair(projectId, episodeId, "model-a")
      });
      // Collection still runs and the damaged file is never even opened: turning learning
      // off must not turn a damaged bandit into a failed run.
      assert.equal(collectOnly.banditUpdated, false);
      assert.ok(collectOnly.collected >= 2);
      assert.equal(await readFile(path, "utf8"), damaged);
      assert.equal(existsSync(`${path}.lock`), false);

      // With learning on, the same file stops the loop instead of resetting the project.
      process.env.SPARKLE_AUTO_ADAPT = "1";
      await assert.rejects(
        runAutoAdaptLoop({
          stateRoot,
          projectRoot,
          projectId,
          primaryModelId: "premium",
          episodeId,
          extraSignals: failingPair(projectId, episodeId, "model-a")
        }),
        { code: BANDIT_STATE_UNREADABLE_CODE }
      );
      assert.equal(await readFile(path, "utf8"), damaged);
    } finally {
      restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    }
  });
});

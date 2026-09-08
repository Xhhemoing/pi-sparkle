import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import * as banditStore from "../../../src/learning/bandit-store.js";
import {
  BANDIT_STATE_UNREADABLE_CODE,
  BanditStateUnreadableError,
  loadProjectBanditByKey,
  updateProjectBandit
} from "../../../src/learning/bandit-store.js";
import { stableProjectKey } from "../../../src/learning/learned-routing.js";
import { parseObservedSignal, type ObservedSignal } from "../../../src/learning/signals.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { adaptationRoot, runtimeRoot } from "../../../src/privacy/state-layout.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-store-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function expectedBanditPath(stateRoot: string, projectRoot: string): string {
  return join(
    adaptationRoot(stateRoot),
    "learning",
    "projects",
    stableProjectKey(projectRoot),
    "bandit.json"
  );
}

function taskSuccess(
  modelId: string,
  outcomeKind: "PASS" | "FAIL",
  failureClass?: ObservedSignal["failureClass"]
): ObservedSignal {
  // Under 9e46be8 a FAIL only counts when attributed to the model; the default
  // keeps the pre-gate tests meaning "a real model failure".
  const attribution =
    outcomeKind === "FAIL" ? failureClass ?? ("model" as const) : failureClass;
  return {
    source: "deterministic",
    kind: "deterministic",
    projectId: createProjectId(),
    modelId,
    score: outcomeKind === "PASS" ? 90 : 15,
    criterion: "taskSuccess",
    outcomeKind,
    ...(attribution !== undefined ? { failureClass: attribution } : {}),
    boundary: "execution",
    summary: `task ${outcomeKind.toLowerCase()}`,
    evidenceIds: [],
    createdAt: nowIso()
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the bandit store does not export a caller-less root-keyed reader", () => {
  assert.equal("loadProjectBandit" in banditStore, false);
});

test("creates, updates, and loads project state only from the adaptation plane", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const created = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    assert.deepEqual(created, {
      arms: ["model-a"],
      pulls: { "model-a": 1 },
      rewardSum: { "model-a": 1 },
      explorationsUsed: 0,
      highRiskExplorations: 0
    });

    const updated = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "FAIL"),
      taskSuccess("model-b", "PASS")
    ]);
    assert.deepEqual(updated, {
      arms: ["model-a", "model-b"],
      pulls: { "model-a": 2, "model-b": 1 },
      rewardSum: { "model-a": 1, "model-b": 1 },
      explorationsUsed: 0,
      highRiskExplorations: 0
    });
    assert.deepEqual(
      await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      updated
    );
    await access(expectedBanditPath(stateRoot, projectRoot));
    await assert.rejects(access(runtimeRoot(stateRoot)), { code: "ENOENT" });
  });
});

test("a project with no bandit yet is absent; ENOENT is the one silent path", async () => {
  await withTempDir(async (stateRoot) => {
    assert.equal(
      await loadProjectBanditByKey(stateRoot, stableProjectKey(join(stateRoot, "never-run"))),
      undefined
    );
  });
});

test("a torn bandit file fails closed instead of reading as no bandit", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const learned = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS"),
      taskSuccess("model-a", "FAIL"),
      taskSuccess("model-b", "PASS")
    ]);
    const path = expectedBanditPath(stateRoot, projectRoot);
    const torn = `${JSON.stringify(learned, null, 2)}\n`.slice(0, 42);
    await writeFile(path, torn, "utf8");

    await assert.rejects(
      loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      (error: unknown) => {
        assert.ok(error instanceof BanditStateUnreadableError);
        assert.ok(error instanceof DomainValidationError);
        assert.equal(error.code, BANDIT_STATE_UNREADABLE_CODE);
        assert.equal(error.name, "BanditStateUnreadableError");
        assert.equal(error.path, path);
        assert.ok(error.cause instanceof SyntaxError);
        assert.match(error.message, /not valid JSON/);
        assert.match(error.message, /cannot be recomputed from any log/);
        return true;
      }
    );

    // The update refuses for the same reason, before writing: the damaged bytes are still
    // there to repair, where the pre-atomic store would have published a fresh state over
    // them and lost the learned pulls for good.
    await assert.rejects(
      updateProjectBandit(stateRoot, projectRoot, [taskSuccess("model-b", "PASS")]),
      (error: unknown) => {
        assert.ok(error instanceof BanditStateUnreadableError);
        assert.equal(error.code, BANDIT_STATE_UNREADABLE_CODE);
        return true;
      }
    );
    assert.equal(await readFile(path, "utf8"), torn);
    await assert.rejects(access(`${path}.lock`), { code: "ENOENT" });
  });
});

test("an empty bandit file is damage, not a project that has never learned", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = expectedBanditPath(stateRoot, projectRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "", "utf8");

    await assert.rejects(
      loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      (error: unknown) => {
        assert.ok(error instanceof BanditStateUnreadableError);
        assert.match(error.message, /the file is empty/);
        return true;
      }
    );
  });
});

test("every damaged bandit shape is refused by name, and none of them resets the file", async () => {
  const core = {
    arms: ["model-a"],
    pulls: { "model-a": 4 },
    rewardSum: { "model-a": 3 },
    explorationsUsed: 0,
    highRiskExplorations: 0
  };
  const damaged: readonly (readonly [unknown, RegExp])[] = [
    [[], /top level is not a JSON object/],
    [null, /top level is not a JSON object/],
    [{ ...core, arms: "model-a" }, /arms is not an array/],
    [{ ...core, arms: ["model-a", " "] }, /arms holds an entry that is not a non-empty arm id/],
    [{ ...core, arms: ["model-a", "model-a"] }, /arms holds duplicate ids/],
    [{ ...core, explorationsUsed: -1 }, /explorationsUsed is not a non-negative integer/],
    [{ ...core, highRiskExplorations: 1.5 }, /highRiskExplorations is not a non-negative integer/],
    [{ ...core, pulls: [] }, /pulls is not a JSON object/],
    [{ arms: core.arms, pulls: core.pulls, explorationsUsed: 0, highRiskExplorations: 0 }, /rewardSum is not a JSON object/],
    [{ ...core, pulls: { "model-a": 4, "model-z": 1 } }, /a counter names model-z, which is not in arms/],
    [{ ...core, pulls: {} }, /pulls\.model-a is not a non-negative integer/],
    [{ ...core, rewardSum: { "model-a": "3" } }, /rewardSum\.model-a is not a finite non-negative number/],
    [{ ...core, rewardSum: { "model-a": 5 } }, /rewardSum\.model-a exceeds its pull count/]
  ];

  await withTempDir(async (stateRoot) => {
    for (const [index, entry] of damaged.entries()) {
      const [document, expected] = entry;
      const projectRoot = join(stateRoot, `project-${index}`);
      const path = expectedBanditPath(stateRoot, projectRoot);
      const bytes = `${JSON.stringify(document, null, 2)}\n`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, "utf8");

      await assert.rejects(
        loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
        (error: unknown) => {
          assert.ok(error instanceof BanditStateUnreadableError, `case ${index}`);
          assert.match(error.message, expected, `case ${index}`);
          return true;
        }
      );
      await assert.rejects(
        updateProjectBandit(stateRoot, projectRoot, [taskSuccess("model-b", "PASS")]),
        { code: BANDIT_STATE_UNREADABLE_CODE },
        `case ${index} must refuse the update too`
      );
      assert.equal(await readFile(path, "utf8"), bytes, `case ${index} must survive untouched`);
    }
  });
});

test("unknown keys from a newer writer are version skew: the learned core survives", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = expectedBanditPath(stateRoot, projectRoot);
    await mkdir(dirname(path), { recursive: true });
    const core = {
      arms: ["model-a"],
      pulls: { "model-a": 7 },
      rewardSum: { "model-a": 5 },
      explorationsUsed: 3,
      highRiskExplorations: 0
    };
    await writeFile(
      path,
      `${JSON.stringify({ ...core, schemaVersion: 2, decayHalfLifeRuns: 30 }, null, 2)}\n`,
      "utf8"
    );

    // Half one: the document loads, and the unknown keys are dropped at the read boundary.
    assert.deepEqual(
      await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot)),
      core
    );

    // Half two: the update keeps the learned counters instead of restarting from zero, and
    // republishes without the keys it never understood — the documented, accepted loss.
    const updated = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    assert.deepEqual(updated, {
      arms: ["model-a"],
      pulls: { "model-a": 8 },
      rewardSum: { "model-a": 6 },
      explorationsUsed: 3,
      highRiskExplorations: 0
    });
    const republished: unknown = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(Object.keys(republished as Record<string, unknown>).sort(), [
      "arms",
      "explorationsUsed",
      "highRiskExplorations",
      "pulls",
      "rewardSum"
    ]);
  });
});

test("updates acquire the project bandit lock before writing", async () => {
  await withTempDir(async (stateRoot) => {
    const projectRoot = join(stateRoot, "project");
    const path = expectedBanditPath(stateRoot, projectRoot);
    const acquired = deferred();
    const release = deferred();
    const holder = withExclusiveFileLock(`${path}.lock`, async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;

    const update = updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess("model-a", "PASS")
    ]);
    try {
      const result = await Promise.race([
        update.then(() => "completed" as const),
        delay(40).then(() => "blocked" as const)
      ]);
      assert.equal(result, "blocked");
    } finally {
      release.resolve();
      await holder;
    }

    assert.deepEqual((await update).pulls, { "model-a": 1 });
    await assert.rejects(access(`${path}.lock`), { code: "ENOENT" });
  });
});

// ---- 9035 increments: model-attributed rewards only ----

test("bandit rewards are model-attributed taskSuccess only", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-"));
  const projectRoot = "/tmp/proj-bandit";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const state = await updateProjectBandit(stateRoot, projectRoot, [
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "PASS" }),
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "model" }),
      // Non-model failures must not lower the posterior.
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "environment" }),
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "tool" }),
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "run" }),
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "contract" }),
      // Unattributed FAIL is not evidence.
      modelTaskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL" })
    ]);
    assert.equal(state.pulls.cheap, 2, "only PASS and model-FAIL count as pulls");
    assert.equal(state.rewardSum.cheap, 1);
    const reloaded = await loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot));
    assert.equal(reloaded?.pulls.cheap, 2);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a prose-only extraSignals FAIL cannot lower the posterior", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-"));
  const projectRoot = "/tmp/proj-bandit-prose";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const afterPass = await updateProjectBandit(stateRoot, projectRoot, [
      modelTaskSuccess({ projectId, episodeId, modelId: "premium", outcomeKind: "PASS" })
    ]);
    assert.equal(afterPass.pulls.premium, 1);
    assert.equal(afterPass.rewardSum.premium, 1);

    // The measured A5 probe, inverted: an extraSignals FAIL whose only
    // "evidence" is unrecognised caller prose must leave the arm untouched
    // instead of dragging the mean from 1.00 to 0.50.
    const proseOnlyFail = parseObservedSignal({
      source: "subagent",
      kind: "deterministic",
      projectId,
      score: 15,
      criterion: "taskSuccess",
      outcomeKind: "FAIL",
      boundary: "execution",
      summary: "it produced nonsense",
      createdAt: nowIso(),
      evidenceIds: [],
      modelId: "premium"
    });
    assert.equal(proseOnlyFail.failureClass, undefined);
    const afterProseFail = await updateProjectBandit(stateRoot, projectRoot, [proseOnlyFail]);
    assert.equal(afterProseFail.pulls.premium, 1, "prose-only FAIL is not a pull");
    assert.equal(afterProseFail.rewardSum.premium, 1, "prose-only FAIL is not evidence");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

function modelTaskSuccess(input: {
  projectId: ReturnType<typeof createProjectId>;
  episodeId: ReturnType<typeof createEpisodeId>;
  modelId: string;
  outcomeKind: "PASS" | "FAIL";
  failureClass?: ObservedSignal["failureClass"];
}): ObservedSignal {
  return {
    source: "subagent",
    kind: "deterministic",
    projectId: input.projectId,
    modelId: input.modelId,
    family: "edit",
    role: "implementer",
    score: input.outcomeKind === "PASS" ? 90 : 15,
    criterion: "taskSuccess",
    outcomeKind: input.outcomeKind,
    ...(input.failureClass !== undefined ? { failureClass: input.failureClass } : {}),
    boundary: "execution",
    summary: `TASK_RESULT ${input.outcomeKind}`,
    episodeId: input.episodeId,
    evidenceIds: ["evd_x"],
    createdAt: nowIso()
  };
}

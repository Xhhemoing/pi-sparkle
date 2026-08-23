import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProjectBandit, updateProjectBandit } from "../../../src/learning/bandit-store.js";
import { parseObservedSignal, type ObservedSignal } from "../../../src/learning/signals.js";
import { createEpisodeId, createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";

test("bandit rewards are model-attributed taskSuccess only", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-bandit-"));
  const projectRoot = "/tmp/proj-bandit";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const state = await updateProjectBandit(stateRoot, projectRoot, [
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "PASS" }),
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "model" }),
      // Non-model failures must not lower the posterior.
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "environment" }),
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "tool" }),
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "run" }),
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL", failureClass: "contract" }),
      // Unattributed FAIL is not evidence.
      taskSuccess({ projectId, episodeId, modelId: "cheap", outcomeKind: "FAIL" })
    ]);
    assert.equal(state.pulls.cheap, 2, "only PASS and model-FAIL count as pulls");
    assert.equal(state.rewardSum.cheap, 1);
    const reloaded = await loadProjectBandit(stateRoot, projectRoot);
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
      taskSuccess({ projectId, episodeId, modelId: "premium", outcomeKind: "PASS" })
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

function taskSuccess(input: {
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

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import {
  observationIdentity,
  partitionNovelSignals,
  updateProjectBanditDeduped
} from "../../../src/learning/observation-ledger.js";
import { loadProjectBanditByKey } from "../../../src/learning/bandit-store.js";
import { stableProjectKey } from "../../../src/learning/learned-routing.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";

function signal(modelId: string, outcome: "PASS" | "FAIL"): ObservedSignal {
  return {
    source: "deterministic",
    kind: "deterministic",
    projectId: createProjectId(),
    modelId,
    score: outcome === "PASS" ? 90 : 15,
    criterion: "taskSuccess",
    outcomeKind: outcome,
    ...(outcome === "FAIL" ? { failureClass: "model" as const } : {}),
    boundary: "execution",
    summary: `task ${outcome}`,
    runId: createRunId(() => "abc"),
    taskId: createTaskId(() => "one"),
    evidenceIds: ["evd_1"],
    createdAt: nowIso()
  };
}

describe("PS-P4 observation ledger dedupe", () => {
  it("same signal identity is stable", () => {
    const a = signal("cheap", "PASS");
    const b = { ...a, evidenceIds: ["evd_1"] };
    assert.equal(observationIdentity(a), observationIdentity(b));
    assert.match(observationIdentity(a), /^obs_v2_/);
    assert.doesNotMatch(observationIdentity(a), /^obs_[0-9a-f]{64}$/);
  });

  it("uses the full canonical signal key and ignores evidence order", () => {
    const a = signal("cheap", "PASS");
    const reordered = { ...a, evidenceIds: ["evd_1", "evd_0"] };
    const same = { ...a, evidenceIds: ["evd_0", "evd_1"] };
    assert.equal(observationIdentity(reordered), observationIdentity(same));
    assert.notEqual(observationIdentity(a), observationIdentity(reordered));
    const id = observationIdentity(reordered);
    assert.match(id, /^obs_v2_/);
    assert.match(id, /"evidenceIds":"evd_0,evd_1"/);
    assert.match(id, /"modelId":"cheap"/);
    assert.doesNotMatch(id.slice("obs_v2_".length), /^[0-9a-f]{64}$/);
  });

  it("partitionNovelSignals drops duplicates in-batch and against ledger", () => {
    const s = signal("cheap", "PASS");
    const id = observationIdentity(s);
    const first = partitionNovelSignals([s, s], new Set());
    assert.equal(first.novel.length, 1);
    assert.equal(first.duplicates.length, 1);
    const second = partitionNovelSignals([s], new Set([id]));
    assert.equal(second.novel.length, 0);
    assert.equal(second.duplicates.length, 1);
  });

  it("updateProjectBanditDeduped does not double-apply the same signal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-ledger-"));
    try {
      const projectRoot = join(dir, "project");
      const s = signal("cheap", "PASS");
      const first = await updateProjectBanditDeduped(dir, projectRoot, [s]);
      assert.equal(first.applied, 1);
      assert.equal(first.skippedDuplicates, 0);
      const second = await updateProjectBanditDeduped(dir, projectRoot, [s]);
      assert.equal(second.applied, 0);
      assert.equal(second.skippedDuplicates, 1);
      const state = await loadProjectBanditByKey(dir, stableProjectKey(projectRoot));
      assert.ok(state);
      assert.equal(state!.pulls["cheap"], 1);
      assert.equal(state!.rewardSum["cheap"], 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

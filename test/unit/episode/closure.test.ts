import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId, createEvidenceId, createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { decideClosure } from "../../../src/episode/closure.js";

function episode(overrides: Partial<ProjectEpisode> = {}): ProjectEpisode {
  return {
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [
      { id: "ac-privacy", description: "no secrets", observableCheck: "redaction" },
      { id: "ac-tests", description: "tests pass", observableCheck: "vitest" }
    ],
    evidenceRefs: [],
    ...overrides
  };
}

test("a single unrelated evidence ref does not close every criterion", () => {
  const decision = decideClosure(
    episode({ evidenceRefs: [createEvidenceId()] }),
    []
  );
  assert.equal(decision.canClose, false);
  assert.equal(decision.reason, "acceptance-incomplete");
  assert.ok(decision.requiredEvidence.includes("ac-privacy"));
  assert.ok(decision.requiredEvidence.includes("ac-tests"));
});

test("each criterion must have a matching evidence ref", () => {
  const decision = decideClosure(
    episode({
      evidenceRefs: [createEvidenceId(() => "ac-privacy"), createEvidenceId(() => "ac-tests")]
    }),
    []
  );
  assert.equal(decision.canClose, true);
  assert.equal(decision.reason, "all-criteria-met");
});

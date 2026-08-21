import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnoseModelProjectIssues } from "../../../src/learning/diagnostics.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import { createEpisodeId, createProjectId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";

test("diagnostics group taskSuccess failures by model and project", () => {
  const projectId = createProjectId();
  const episodeId = createEpisodeId();
  const signals: ObservedSignal[] = [
    signal({ projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic", score: 15, family: "edit", criterion: "taskSuccess" }),
    signal({ projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic", score: 15, family: "edit", criterion: "taskSuccess" }),
    signal({ projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic", score: 15, family: "edit", criterion: "taskSuccess" }),
    signal({ projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic", score: 15, family: "edit", criterion: "taskSuccess" }),
    signal({ projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic", score: 15, family: "edit", criterion: "taskSuccess" }),
    signal({ projectId, episodeId, modelId: "cheap", source: "user", kind: "human", score: 10, family: "edit", criterion: "userAcceptance" }),
    signal({ projectId, episodeId, modelId: "premium", source: "subagent", kind: "deterministic", score: 90, family: "edit", criterion: "taskSuccess" })
  ];
  const issues = diagnoseModelProjectIssues(signals);
  const cheap = issues.find((issue) => issue.modelId === "cheap");
  const premium = issues.find((issue) => issue.modelId === "premium");
  assert.ok(cheap);
  assert.equal(cheap.projectId, projectId);
  assert.equal(cheap.samples, 5);
  assert.ok(cheap.meanScore < 0.3);
  assert.equal(cheap.actionable, true);
  assert.equal(premium?.actionable, false);
});

function signal(input: {
  projectId: ReturnType<typeof createProjectId>;
  episodeId: ReturnType<typeof createEpisodeId>;
  modelId: string;
  source: ObservedSignal["source"];
  kind: ObservedSignal["kind"];
  score: number;
  family: string;
  criterion?: ObservedSignal["criterion"];
}): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    modelId: input.modelId,
    family: input.family,
    role: "implementer",
    score: input.score,
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(input.criterion === "taskSuccess" ? { outcomeKind: input.score >= 50 ? "PASS" : "FAIL" } : {}),
    boundary: input.source === "user" ? "review" : "execution",
    summary: `${input.source} ${input.score}`,
    episodeId: input.episodeId,
    evidenceIds: [],
    createdAt: nowIso()
  };
}

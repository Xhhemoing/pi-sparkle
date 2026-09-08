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

test("non-model failures stay out of routing-quality diagnostics", () => {
  const projectId = createProjectId();
  const episodeId = createEpisodeId();
  const nonModel: ObservedSignal[] = (["environment", "tool", "run", "contract"] as const).flatMap(
    (failureClass) => [
      signal({
        projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic",
        score: 15, family: "edit", criterion: "taskSuccess", failureClass
      }),
      signal({
        projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic",
        score: 15, family: "edit", criterion: "taskSuccess", failureClass
      })
    ]
  );
  const issues = diagnoseModelProjectIssues(nonModel);
  assert.equal(issues.length, 0, "8 non-model failures must not create a model-project issue");
});

test("a FAIL without failure attribution is not evidence against the model", () => {
  const projectId = createProjectId();
  const episodeId = createEpisodeId();
  const unattributed: ObservedSignal[] = Array.from({ length: 5 }, () =>
    signal({
      projectId, episodeId, modelId: "cheap", source: "subagent", kind: "deterministic",
      score: 15, family: "edit", criterion: "taskSuccess", failureClass: undefined, omitFailureClass: true
    })
  );
  const issues = diagnoseModelProjectIssues(unattributed);
  assert.equal(issues.length, 0);
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
  failureClass?: ObservedSignal["failureClass"];
  omitFailureClass?: boolean;
}): ObservedSignal {
  const outcomeKind = input.criterion === "taskSuccess" ? (input.score >= 50 ? "PASS" : "FAIL") : undefined;
  const failureClass =
    input.omitFailureClass === true
      ? undefined
      : input.failureClass ?? (outcomeKind === "FAIL" ? "model" : undefined);
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    modelId: input.modelId,
    family: input.family,
    role: "implementer",
    score: input.score,
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(outcomeKind !== undefined ? { outcomeKind } : {}),
    ...(failureClass !== undefined ? { failureClass } : {}),
    boundary: input.source === "user" ? "review" : "execution",
    summary: `${input.source} ${input.score}`,
    episodeId: input.episodeId,
    evidenceIds: [],
    createdAt: nowIso()
  };
}

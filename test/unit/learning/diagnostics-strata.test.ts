import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { diagnoseModelProjectIssues } from "../../../src/learning/diagnostics.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";

function row(n: number, overrides: Partial<ObservedSignal> = {}): ObservedSignal {
  return {
    source: "deterministic", kind: "deterministic", projectId: createProjectId(() => "strata"),
    runId: createRunId(() => "strata"), taskId: createTaskId(() => `strata-${n}`),
    modelId: "primary", family: "edit", role: "implementer", modelVersion: "v1", featureVersion: "f1",
    criterion: "taskSuccess", outcomeKind: "FAIL", failureClass: "model", score: 15,
    boundary: "execution", summary: "failed", evidenceIds: [`evidence-${n}`],
    createdAt: parseIsoTimestamp("2026-09-29T00:00:00.000Z"), ...overrides
  };
}

function batch(start: number, overrides: Partial<ObservedSignal> = {}): ObservedSignal[] {
  return Array.from({ length: 5 }, (_, i) => row(start + i, overrides));
}

test("family failures are not averaged with another family's successes", () => {
  const issues = diagnoseModelProjectIssues([...batch(0), ...batch(10, {
    family: "review", outcomeKind: "PASS", failureClass: undefined, score: 90
  })]);
  assert.equal(issues.length, 2);
  assert.equal(issues.find((issue) => issue.family === "edit")?.actionable, true);
  assert.equal(issues.find((issue) => issue.family === "review")?.meanScore, 0.9);
  assert.ok(issues.every((issue) => issue.samples === 5));
});

test("role, model version and feature version each define separate strata", () => {
  for (const dimension of ["role", "modelVersion", "featureVersion"] as const) {
    const issues = diagnoseModelProjectIssues([...batch(0), ...batch(10, { [dimension]: "other" })]);
    assert.equal(issues.length, 2, dimension);
    assert.deepEqual(new Set(issues.map((issue) => Reflect.get(issue, dimension))),
      new Set([Reflect.get(row(0), dimension), "other"]));
    assert.ok(issues.every((issue) => issue.samples === 5));
  }
});

test("reimporting one task with different time, prose and evidence order counts once", () => {
  const one = row(0, { evidenceIds: ["b", "a"] });
  const copies = Array.from({ length: 6 }, (_, n) => ({ ...one,
    summary: `import ${n}`, evidenceIds: n % 2 === 0 ? ["a", "b"] : ["b", "a"],
    createdAt: parseIsoTimestamp(`2026-09-29T00:00:0${n}.000Z`)
  }));
  const [issue] = diagnoseModelProjectIssues(copies);
  assert.equal(issue?.samples, 1);
  assert.equal(issue?.actionable, false);
});

test("conflicting task outcomes are excluded in either arrival order", () => {
  const signals = [...batch(0), row(0, { outcomeKind: "PASS", failureClass: undefined, score: 90 })];
  const issues = diagnoseModelProjectIssues(signals);
  assert.equal(issues[0]?.samples, 4);
  assert.equal(issues[0]?.actionable, false);
  assert.deepEqual(issues, diagnoseModelProjectIssues([...signals].reverse()));
});

test("conflicting task binding or attribution cannot be split into two samples", () => {
  for (const conflict of [
    { modelId: "other" }, { family: "review" }, { role: "reviewer" },
    { modelVersion: "v2" }, { featureVersion: "f2" }, { failureClass: "provider" as const }, { score: 10 }
  ]) {
    assert.deepEqual(diagnoseModelProjectIssues([row(0), row(0, conflict)]), []);
  }
});

test("unbound duplicate observations remain diagnostic and cannot become actionable", () => {
  const one = row(0, { runId: undefined, taskId: undefined });
  const issues = diagnoseModelProjectIssues(Array.from({ length: 6 }, (_, n) => ({ ...one,
    createdAt: parseIsoTimestamp(`2026-09-29T00:00:0${n}.000Z`)
  })));
  assert.equal(issues[0]?.samples, 1);
  assert.equal(issues[0]?.actionable, false);
  const unbound = batch(0, { runId: undefined, taskId: undefined });
  assert.equal(diagnoseModelProjectIssues(unbound)[0]?.actionable, false);
});

test("unbound observations never upgrade a bound small sample into an actionable group", () => {
  const signals = [...batch(0).slice(0, 4), row(10, { runId: undefined, taskId: undefined })];
  assert.equal(diagnoseModelProjectIssues(signals)[0]?.actionable, false);
});

test("invalid scores are excluded, and failure counts follow the outcome not a score cutoff", () => {
  for (const score of [NaN, Infinity, -Infinity, -1, 101]) {
    assert.deepEqual(diagnoseModelProjectIssues([row(0, { score })]), []);
  }
  const [issue] = diagnoseModelProjectIssues([row(0, { score: 45 })]);
  assert.equal(issue?.failures, 1);
});

test("provider, environment and unattributed failures are not model negatives", () => {
  for (const failureClass of ["provider", "environment", "contract", "tool", "run", undefined] as const) {
    assert.deepEqual(diagnoseModelProjectIssues(batch(0, { failureClass })), []);
  }
  assert.deepEqual(diagnoseModelProjectIssues(batch(0, { source: "user", kind: "human" })), []);
});

test("primary model can be diagnosed without implying replacement or host acceptance", () => {
  const [issue] = diagnoseModelProjectIssues(batch(0));
  assert.equal(issue?.modelId, "primary");
  assert.equal(issue?.actionable, true);
  assert.equal(Reflect.has(issue!, "independentVerification"), false);
});

test("missing metadata is not merged with a literal unknown string", () => {
  for (const field of ["family", "role", "modelVersion", "featureVersion"] as const) {
    const issues = diagnoseModelProjectIssues([...batch(0, { [field]: undefined }), ...batch(10, { [field]: "unknown" })]);
    assert.equal(issues.length, 2, field);
  }
});

test("tuple keys cannot collide through model/family separators", () => {
  const issues = diagnoseModelProjectIssues([
    row(0, { modelId: "a::b", family: "c" }),
    row(1, { modelId: "a", family: "b::c" })
  ]);
  assert.equal(issues.length, 2);
});

test("diagnostic ordering is deterministic on equal scores and does not mutate input", () => {
  const a = Object.freeze(row(0, { modelId: "z" }));
  const b = Object.freeze(row(1, { modelId: "a" }));
  const signals = Object.freeze([a, b]);
  const before = JSON.stringify(signals);
  assert.deepEqual(diagnoseModelProjectIssues(signals), diagnoseModelProjectIssues([b, a]));
  assert.equal(JSON.stringify(signals), before);
});

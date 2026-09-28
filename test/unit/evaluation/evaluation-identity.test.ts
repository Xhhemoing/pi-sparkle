import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessHostTerminalOutcome,
  createEvaluationRecord,
  parseHostTerminalOutcome
} from "../../../src/evaluation/evaluator.js";
import type {
  EvaluatorIdentity,
  HostTerminalOutcome,
  HostTerminalOutcomeBinding,
  HostTerminalOutcomeSourceState
} from "../../../src/evaluation/types.js";
import type { Rubric } from "../../../src/rubric/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { canonicalizeStableJson } from "../../../src/domain/canonical-json.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const evaluator: EvaluatorIdentity = {
  kind: "deterministic",
  version: "eval-v1",
  rubricVersion: "rubric-v1"
};

const rubric: Rubric = {
  id: "rubric-core",
  version: 1,
  scope: "task",
  createdAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
  criteria: [
    { id: "ac-1", description: "works", weight: 1, observableCheck: "tests pass" }
  ]
};

test("an evaluation identifies its target artifact, version, and independence class", () => {
  const record = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: { "ac-1": "ev-1" },
    target: { artifactId: "artifact-src-pay-parser", artifactVersion: "v3" },
    independenceClass: "paired"
  });
  assert.equal(record.target?.artifactId, "artifact-src-pay-parser");
  assert.equal(record.target?.artifactVersion, "v3");
  assert.equal(record.independenceClass, "paired");
});

test("target and independence class stay optional for legacy callers", () => {
  const record = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: {}
  });
  assert.equal(record.target, undefined);
  assert.equal(record.independenceClass, undefined);
});

test("an empty target artifact id is rejected", () => {
  assert.throws(
    () =>
      createEvaluationRecord({
        episodeId: createEpisodeId(UUID),
        evaluator,
        rubric,
        evidence: {},
        target: { artifactId: "  " }
      }),
    /artifactId/
  );
});

test("an unknown independence class is rejected", () => {
  assert.throws(
    () =>
      createEvaluationRecord({
        episodeId: createEpisodeId(UUID),
        evaluator,
        rubric,
        evidence: {},
        independenceClass: "self-reviewed" as never
      }),
    /independence/
  );
});

const terminalOutcome: HostTerminalOutcome = {
  schemaVersion: "host-terminal-outcome-v1",
  sourceKind: "host-evaluator",
  outcomeRef: "outcome-001",
  bindingRef: "binding-001",
  projectId: "project-a",
  projectVersion: "commit-a",
  episodeId: "ep_01234567-89ab-cdef-0123-456789abcdef",
  runId: "run_01234567-89ab-cdef-0123-456789abcdef",
  taskId: "tsk_eval_a",
  modelId: "model-a",
  modelVersion: "model-v1",
  targetArtifactId: "artifact-a",
  targetArtifactVersion: "artifact-v1",
  evaluatorId: "evaluator-a",
  evaluatorVersion: "evaluator-v1",
  rubricId: "rubric-a",
  rubricVersion: "rubric-v1",
  evaluatorDefinitionCanonicalJson: '{"id":"evaluator-a","version":"evaluator-v1"}',
  outcome: "PASSED",
  failureAttribution: "none",
  evidenceRefs: ["evidence-001"]
};

const terminalBinding: HostTerminalOutcomeBinding &
  Pick<HostTerminalOutcome, "outcomeRef" | "bindingRef"> = {
  outcomeRef: terminalOutcome.outcomeRef,
  bindingRef: terminalOutcome.bindingRef,
  projectId: terminalOutcome.projectId,
  projectVersion: terminalOutcome.projectVersion,
  episodeId: terminalOutcome.episodeId,
  runId: terminalOutcome.runId,
  taskId: terminalOutcome.taskId,
  modelId: terminalOutcome.modelId,
  modelVersion: terminalOutcome.modelVersion,
  targetArtifactId: terminalOutcome.targetArtifactId,
  targetArtifactVersion: terminalOutcome.targetArtifactVersion,
  evaluatorId: terminalOutcome.evaluatorId,
  evaluatorVersion: terminalOutcome.evaluatorVersion,
  rubricId: terminalOutcome.rubricId,
  rubricVersion: terminalOutcome.rubricVersion,
  evaluatorDefinitionCanonicalJson: terminalOutcome.evaluatorDefinitionCanonicalJson
};

const terminalBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalizeStableJson(value));

test("host terminal outcomes parse from strict canonical bytes and bind every identity", () => {
  assert.deepEqual(parseHostTerminalOutcome(terminalBytes(terminalOutcome)), terminalOutcome);
  const assessed = assessHostTerminalOutcome({
    recordBytes: terminalBytes(terminalOutcome),
    sourceState: "available",
    expected: terminalBinding
  });
  assert.equal(assessed.eligible, true);
  assert.equal(assessed.outcome, "PASSED");
});

test("unknown or missing terminal outcome fields fail closed", () => {
  const { evidenceRefs: _omitted, ...missing } = terminalOutcome;
  assert.throws(() => parseHostTerminalOutcome(terminalBytes(missing)), /fields|evidenceRefs/i);
  assert.throws(
    () => parseHostTerminalOutcome(terminalBytes({ ...terminalOutcome, extra: true })),
    /unknown.*field/i
  );
});

test("untrusted, unavailable, or ambiguous sources stay UNOBSERVED and ineligible", () => {
  const states: readonly Exclude<HostTerminalOutcomeSourceState, "available">[] = [
    "missing",
    "deleted",
    "foreign",
    "stale",
    "legacy",
    "incomplete",
    "self-reported-only",
    "identity-drift",
    "provider-failure",
    "tool-failure",
    "run-failure",
    "timeout",
    "evaluator-unavailable",
    "ambiguous-crash-replay"
  ];
  for (const sourceState of states) {
    const assessed = assessHostTerminalOutcome({
      recordBytes: terminalBytes(terminalOutcome),
      sourceState,
      expected: terminalBinding
    });
    assert.equal(assessed.eligible, false, sourceState);
    assert.equal(assessed.outcome, "UNOBSERVED", sourceState);
  }
  assert.equal(
    assessHostTerminalOutcome({ sourceState: "missing", expected: terminalBinding }).outcome,
    "UNOBSERVED"
  );
});

test("identity or canonical evaluator-definition drift stays UNOBSERVED", () => {
  for (const expected of [
    { ...terminalBinding, runId: "run_other" },
    { ...terminalBinding, evaluatorDefinitionCanonicalJson: '{"id":"other"}' }
  ]) {
    const assessed = assessHostTerminalOutcome({
      recordBytes: terminalBytes(terminalOutcome),
      sourceState: "available",
      expected
    });
    assert.equal(assessed.eligible, false);
    assert.equal(assessed.outcome, "UNOBSERVED");
  }
});

test("outcomeRef mismatch stays UNOBSERVED and ineligible", () => {
  const assessed = assessHostTerminalOutcome({
    recordBytes: terminalBytes(terminalOutcome),
    sourceState: "available",
    expected: { ...terminalBinding, outcomeRef: "outcome-other" }
  });
  assert.equal(assessed.eligible, false);
  assert.equal(assessed.outcome, "UNOBSERVED");
  assert.equal(assessed.reason, "binding mismatch: outcomeRef");
});

test("bindingRef mismatch stays UNOBSERVED and ineligible", () => {
  const assessed = assessHostTerminalOutcome({
    recordBytes: terminalBytes(terminalOutcome),
    sourceState: "available",
    expected: { ...terminalBinding, bindingRef: "binding-other" }
  });
  assert.equal(assessed.eligible, false);
  assert.equal(assessed.outcome, "UNOBSERVED");
  assert.equal(assessed.reason, "binding mismatch: bindingRef");
});

test("FAILED requires host model-evaluated attribution; operational failures cannot become FAILED", () => {
  const failed = {
    ...terminalOutcome,
    outcome: "FAILED",
    failureAttribution: "model-evaluated"
  } as const;
  assert.equal(
    assessHostTerminalOutcome({
      recordBytes: terminalBytes(failed),
      sourceState: "available",
      expected: terminalBinding
    }).outcome,
    "FAILED"
  );
  assert.throws(
    () =>
      parseHostTerminalOutcome(
        terminalBytes({ ...failed, failureAttribution: "provider-failure" })
      ),
    /failureAttribution/i
  );
  assert.equal(
    assessHostTerminalOutcome({
      recordBytes: terminalBytes(failed),
      sourceState: "provider-failure",
      expected: terminalBinding
    }).outcome,
    "UNOBSERVED"
  );
});

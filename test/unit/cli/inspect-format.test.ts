import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatTaskResultLine,
  formatUnverifiedSummary,
  unverifiedTaskIds
} from "../../../src/cli/inspect-format.js";
import type {
  AgentInstanceId,
  EvidenceId,
  MessageId,
  RunId,
  TaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, type TaskResult, type VerificationKind } from "../../../src/protocol/v1.js";
import type { ChildInspection } from "../../../src/run/inspection.js";

function taskResult(opts: {
  taskId?: string;
  outcome?: TaskResult["outcome"];
  kind: VerificationKind;
  verificationEvidence?: string[];
}): TaskResult {
  return {
    protocolVersion: 1,
    id: "msg_fixture" as MessageId,
    occurredAt: parseIsoTimestamp("2026-08-23T00:00:00.000Z"),
    runId: "run_fixture" as RunId,
    taskId: (opts.taskId ?? "tsk_fixture") as TaskId,
    from: "agt_fixture" as AgentInstanceId,
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome: opts.outcome ?? "SUCCESS",
    summary: "did the work",
    artifactIds: [],
    evidenceIds: [],
    verification: {
      kind: opts.kind,
      evidenceIds: (opts.verificationEvidence ?? []) as EvidenceId[]
    }
  };
}

function child(taskId: string, terminal?: TaskResult): ChildInspection {
  return {
    childRunId: `run_${taskId}` as RunId,
    taskId: taskId as TaskId,
    outcome: terminal?.outcome ?? "RUNNING",
    attempts: 1,
    messages: terminal !== undefined ? [terminal] : [],
    ...(terminal !== undefined ? { terminalResult: terminal } : {}),
    timedOut: false
  };
}

test("formatTaskResultLine appends the verification kind", () => {
  assert.equal(
    formatTaskResultLine(taskResult({ kind: "PASSED", verificationEvidence: ["evd_1"] })),
    "SUCCESS verification=PASSED — did the work"
  );
  assert.equal(
    formatTaskResultLine(taskResult({ outcome: "FAILURE", kind: "FAILED" })),
    "FAILURE verification=FAILED — did the work"
  );
});

test("UNOBSERVED verification with no evidence suffixes the outcome with (unverified)", () => {
  assert.equal(
    formatTaskResultLine(taskResult({ kind: "UNOBSERVED" })),
    "SUCCESS (unverified) verification=UNOBSERVED — did the work"
  );
  // With evidence attached, the kind still prints but the suffix is withheld.
  assert.equal(
    formatTaskResultLine(taskResult({ kind: "UNOBSERVED", verificationEvidence: ["evd_1"] })),
    "SUCCESS verification=UNOBSERVED — did the work"
  );
});

test("formatTaskResultLine stays a single line so the CLI owns the newline", () => {
  // `main.ts` embeds the fragment as `      result: ${...}\n`; a newline from
  // here would break the indent of every following child line.
  const line = formatTaskResultLine(taskResult({ kind: "UNOBSERVED" }));
  assert.doesNotMatch(line, /\n/);
  assert.doesNotMatch(line, /^\s|\s$/);
});

test("unverifiedTaskIds counts everything except verification PASSED, including missing TASK_RESULT", () => {
  const children: ChildInspection[] = [
    child("tsk_passed", taskResult({ taskId: "tsk_passed", kind: "PASSED" })),
    child("tsk_failed", taskResult({ taskId: "tsk_failed", outcome: "FAILURE", kind: "FAILED" })),
    child("tsk_unobserved", taskResult({ taskId: "tsk_unobserved", kind: "UNOBSERVED" })),
    child("tsk_no_result")
  ];
  assert.deepEqual(unverifiedTaskIds(children), ["tsk_failed", "tsk_unobserved", "tsk_no_result"]);
});

test("unverifiedTaskIds keeps children order and never reorders or dedupes", () => {
  // Report-only: the line is read against the child list printed just above it,
  // so the ids must arrive in the order those children were printed.
  const children: ChildInspection[] = [
    child("tsk_c", taskResult({ taskId: "tsk_c", kind: "UNOBSERVED" })),
    child("tsk_a", taskResult({ taskId: "tsk_a", kind: "PASSED" })),
    child("tsk_b", taskResult({ taskId: "tsk_b", outcome: "FAILURE", kind: "FAILED" }))
  ];
  assert.deepEqual(unverifiedTaskIds(children), ["tsk_c", "tsk_b"]);
});

test("formatUnverifiedSummary reports N/M with the unverified task ids", () => {
  const summary = formatUnverifiedSummary([
    child("tsk_passed", taskResult({ taskId: "tsk_passed", kind: "PASSED" })),
    child("tsk_unobserved", taskResult({ taskId: "tsk_unobserved", kind: "UNOBSERVED" }))
  ]);
  assert.equal(summary, "unverified: 1/2 (tsk_unobserved)");
});

test("formatUnverifiedSummary omits ids when everything is PASSED and is undefined without children", () => {
  const allPassed = formatUnverifiedSummary([
    child("tsk_a", taskResult({ taskId: "tsk_a", kind: "PASSED" })),
    child("tsk_b", taskResult({ taskId: "tsk_b", kind: "PASSED" }))
  ]);
  assert.equal(allPassed, "unverified: 0/2");
  assert.equal(formatUnverifiedSummary([]), undefined);
});

test("a PASSED verification on a non-SUCCESS outcome still reads as verified", () => {
  // Verification is about observation, not success: a FAILURE that was actually
  // observed is not an unverified child, and the summary must not claim it is.
  const observedFailure = child(
    "tsk_observed_failure",
    taskResult({ taskId: "tsk_observed_failure", outcome: "FAILURE", kind: "PASSED" })
  );
  assert.equal(formatTaskResultLine(observedFailure.terminalResult!), "FAILURE verification=PASSED — did the work");
  assert.deepEqual(unverifiedTaskIds([observedFailure]), []);
  assert.equal(formatUnverifiedSummary([observedFailure]), "unverified: 0/1");
});

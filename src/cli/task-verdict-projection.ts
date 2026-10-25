import path from "node:path";

type ObjectRecord = Record<string, unknown>;
type EvidenceState = "available" | "incomplete" | "missing" | "corrupt" | "unsupported" | "unsafe" | "unavailable";
const STATUSES = ["completed", "cancelled", "timed_out", "output_limit", "spawn_error"] as const;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ARTIFACT_ID = /^(?:art_v2_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{64})$/;
function hasControls(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  });
}

export interface TaskVerdictProjection {
  readonly type: "TASK_VERDICT";
  readonly historical: true;
  readonly currentSourceVerified: false;
  readonly grantsAuthority: false;
  readonly evidence: { state: EvidenceState; file: string; kind: string | null; runId: string | null; artifactId: string | null; issues: string[] };
  readonly historicalAcceptance: { status: "accepted" | "refused" | "unobserved"; scope: "check" | "native-session" | "native-loop" | "preflight" | "unobserved" };
  readonly recordedChecks: { passed: number; failed: number; unobserved: number };
  readonly process: { status: string; exitCode: number | null; signal: string | null };
  settlement: "settled" | "unsettled" | "unobserved";
  candidatePath: string | null;
  candidateRevision: string | null;
  sourceRevision: string | null;
  sourceRepo: string | null;
  readonly apply: { status: "unobserved" | "prepared" | "recorded-applied"; registration: "unobserved" | "recorded"; evidenceFile: string | null; evidenceState: EvidenceState | "unobserved"; issues: string[]; appliedRevision: string | null; reverified: boolean | null };
  readonly cost: { readonly status: "unknown"; readonly usd: null };
  readonly limitations: readonly string[];
}

class ProjectionError extends Error {
  constructor(readonly state: "corrupt" | "unsupported", readonly issue: string) { super(issue); }
}
function requireValue(condition: unknown, issue = "invalid-record"): asserts condition {
  if (!condition) throw new ProjectionError("corrupt", issue);
}
function object(value: unknown): ObjectRecord {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as ObjectRecord;
}
export function safeVerdictPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !hasControls(value) &&
    (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}
function revision(value: unknown): string { requireValue(typeof value === "string" && REVISION.test(value)); return value; }
function recordedPath(value: unknown): string { requireValue(safeVerdictPath(value), "invalid-reference"); return value; }
function bool(value: unknown): boolean { requireValue(typeof value === "boolean"); return value; }
function exitCode(value: unknown): number | null {
  requireValue(value === null || (Number.isSafeInteger(value) && Math.abs(value as number) <= 2 ** 32));
  return value as number | null;
}
function signal(value: unknown): string | null {
  requireValue(value === null || (typeof value === "string" && /^SIG[A-Z0-9]{1,24}$/.test(value)));
  return value as string | null;
}
export function emptyTaskVerdict(file: string, state: EvidenceState, issue?: string): TaskVerdictProjection {
  return { type: "TASK_VERDICT", historical: true, currentSourceVerified: false, grantsAuthority: false,
    evidence: { state, file, kind: null, runId: null, artifactId: null, issues: issue === undefined ? [] : [issue] },
    historicalAcceptance: { status: "unobserved", scope: "unobserved" }, recordedChecks: { passed: 0, failed: 0, unobserved: 0 },
    process: { status: "unobserved", exitCode: null, signal: null }, settlement: "unobserved",
    candidatePath: null, candidateRevision: null, sourceRevision: null, sourceRepo: null,
    apply: { status: "unobserved", registration: "unobserved", evidenceFile: null, evidenceState: "unobserved", issues: [], appliedRevision: null, reverified: null },
    cost: { status: "unknown", usd: null }, limitations: [
      "This is a projection of editable historical file records, not authenticated evidence.",
      "Historical acceptance does not verify the current source or the overall TaskSpec outcome.",
      "No checks were rerun and no execution, apply, disposal or recovery authority is granted.",
      "Unobserved application is not proof that application never occurred."
    ] };
}
function observeProcess(report: TaskVerdictProjection, row: ObjectRecord, independent: boolean): void {
  const status = row[independent ? "processStatus" : "status"];
  if (status === undefined && independent) {
    requireValue(row.processExitCode === undefined && row.processSignal === undefined && row.processCleanupUnsettled === undefined,
      "incomplete-process-record");
    return;
  }
  requireValue(typeof status === "string" && (STATUSES as readonly string[]).includes(status));
  const code = exitCode(row[independent ? "processExitCode" : "exitCode"]);
  const sig = signal(row[independent ? "processSignal" : "signal"]);
  const unsettled = row[independent ? "processCleanupUnsettled" : "cleanupUnsettled"];
  requireValue(unsettled === undefined || unsettled === true);
  if (report.process.status === "unobserved") Object.assign(report.process, { status, exitCode: code, signal: sig });
  else if (report.process.status !== status || report.process.exitCode !== code || report.process.signal !== sig) {
    Object.assign(report.process, { status: "mixed", exitCode: null, signal: null });
  }
  if (unsettled) report.settlement = "unsettled";
  else if (report.settlement !== "unsettled") report.settlement = "settled";
}
function check(report: TaskVerdictProjection, value: unknown): ObjectRecord {
  const row = object(value);
  requireValue(row.kind === "command-check" && row.schemaVersion === "g1a-v1");
  const passed = bool(row.ok);
  const code = exitCode(row.exitCode);
  requireValue(code !== null && (!passed || code === 0), "check-process-mismatch");
  if (row.processStatus !== undefined) {
    const rawCode = exitCode(row.processExitCode), rawSignal = signal(row.processSignal);
    requireValue(code === (rawCode ?? (rawSignal !== null ? 128 : 1)), "check-process-mismatch");
    if (passed) requireValue(row.processStatus === "completed" && rawCode === 0 && rawSignal === null &&
      row.processCleanupUnsettled !== true, "check-process-mismatch");
  }
  report.recordedChecks[passed ? "passed" : "failed"]++;
  observeProcess(report, row, true);
  return row;
}
function sameInvocation(left: ObjectRecord, right: ObjectRecord): boolean {
  return typeof left.command === "string" && left.command.length > 0 && left.command === right.command &&
    Array.isArray(left.args) && Array.isArray(right.args) && left.args.length === right.args.length &&
    left.args.every((arg, index) => typeof arg === "string" && arg === (right.args as unknown[])[index]);
}
function acceptance(value: unknown, candidate: string, candidateRevision: string): ObjectRecord {
  const row = object(value);
  bool(row.accepted);
  requireValue(recordedPath(row.cwd) === candidate && revision(row.revision) === candidateRevision, "acceptance-reference-mismatch");
  requireValue(typeof row.artifactId === "string" && ARTIFACT_ID.test(row.artifactId));
  requireValue(sameInvocation(row, object(row.independentCheck)), "acceptance-check-mismatch");
  return row;
}
function closedLoop(report: TaskVerdictProjection, body: ObjectRecord): void {
  requireValue(body.schemaVersion === "g1a-v1");
  report.candidatePath = recordedPath(body.cwd);
  report.candidateRevision = revision(body.revision);
  const row = check(report, body.check);
  requireValue(recordedPath(row.cwd) === report.candidatePath && revision(row.revision) === report.candidateRevision, "check-reference-mismatch");
  report.historicalAcceptance.scope = "check";
  if (body.acceptance === undefined) {
    report.evidence.state = "incomplete";
    report.evidence.issues.push("acceptance-not-recorded");
    return;
  }
  const accepted = acceptance(body.acceptance, report.candidatePath, report.candidateRevision);
  requireValue(body.artifactId === accepted.artifactId, "acceptance-reference-mismatch");
  const independent = object(accepted.independentCheck);
  requireValue(independent.checkId === row.checkId && independent.cwd === row.cwd && independent.revision === row.revision &&
    independent.ok === row.ok && independent.exitCode === row.exitCode && sameInvocation(independent, row) &&
    sameInvocation(accepted, row) && independent.processStatus === row.processStatus &&
    independent.processExitCode === row.processExitCode && independent.processSignal === row.processSignal &&
    independent.processCleanupUnsettled === row.processCleanupUnsettled, "acceptance-check-mismatch");
  if (accepted.accepted) requireValue(row.ok && report.settlement !== "unsettled", "acceptance-check-mismatch");
  report.historicalAcceptance.status = accepted.accepted ? "accepted" : "refused";
}
function nativeSession(report: TaskVerdictProjection, value: unknown): void {
  const result = object(value);
  requireValue(["COMPLETED", "FAILED", "CANCELLED"].includes(result.status as string));
  report.candidatePath = recordedPath(result.candidatePath);
  report.sourceRevision = revision(result.sourceRevision);
  const accepted = object(result.acceptance), independent = object(accepted.independentCheck);
  report.candidateRevision = revision(accepted.revision);
  acceptance(accepted, report.candidatePath, report.candidateRevision);
  const row = check(report, independent);
  requireValue(row.cwd === report.candidatePath && row.revision === report.candidateRevision, "check-reference-mismatch");
  const artifact = object(result.artifact);
  requireValue(artifact.id === accepted.artifactId, "acceptance-artifact-mismatch");
  if (accepted.accepted) requireValue(result.status === "COMPLETED" && row.ok && result.effectsSettled !== false &&
    report.settlement !== "unsettled", "acceptance-status-mismatch");
  report.historicalAcceptance.status = accepted.accepted ? "accepted" : "refused";
  report.historicalAcceptance.scope = "native-session";
  if (result.effectsSettled === false) report.settlement = "unsettled";
}
function preflight(report: TaskVerdictProjection, body: ObjectRecord): void {
  report.candidatePath = recordedPath(body.candidatePath);
  report.sourceRevision = revision(body.sourceRevision);
  const accepted = bool(body.ok), settled = bool(body.effectsSettled);
  report.historicalAcceptance.status = accepted ? "accepted" : "refused";
  report.historicalAcceptance.scope = "preflight";
  for (const [index, phase] of [body.preparation, body.checks].entries()) {
    requireValue(Array.isArray(phase) && phase.length <= 8);
    for (const value of phase) {
      const row = object(value), result = object(row.result);
      const expected = bool(row.expected), passed = bool(result.ok);
      requireValue(passed === (result.status === "completed" && result.exitCode === 0), "command-outcome-mismatch");
      bool(result.spawned);
      report.recordedChecks[expected ? "passed" : "failed"]++;
      observeProcess(report, result, false);
      if (expected) {
        requireValue(result.status === "completed" && result.spawned === true && result.signal === null &&
          result.cleanupUnsettled !== true, "expected-command-mismatch");
        // A base check may deliberately establish a business assertion RED.
        // Its host-recorded expected flag is separate from process success.
        requireValue(index === 0 ? passed && result.exitCode === 0 :
          (passed && result.exitCode === 0) || (!passed && result.exitCode === 1), "expected-command-mismatch");
      }
    }
  }
  requireValue(Array.isArray(body.unobservedChecks) && body.unobservedChecks.length <= 8);
  report.recordedChecks.unobserved = body.unobservedChecks.length;
  requireValue(!settled || report.settlement !== "unsettled", "settlement-mismatch");
  requireValue(!accepted || (settled && report.recordedChecks.failed === 0 && body.unobservedChecks.length === 0 &&
    Array.isArray(body.checks) && body.checks.length > 0), "preflight-outcome-mismatch");
  // Outer false may include an interrupted command that never reached a row.
  report.settlement = settled ? "settled" : "unsettled";
}
function bodyProjection(report: TaskVerdictProjection, body: ObjectRecord): void {
  switch (body.kind) {
    case "ps-p3-closed-loop": closedLoop(report, body); break;
    case "development-preflight": preflight(report, body); break;
    case "native-write-failure": {
      report.candidatePath = recordedPath(body.candidatePath);
      report.sourceRevision = revision(body.sourceRevision);
      report.historicalAcceptance.status = "refused";
      report.historicalAcceptance.scope = "native-session";
      if (body.processCleanup !== undefined) {
        const cleanup = object(body.processCleanup);
        requireValue(cleanup.settled === false);
        observeProcess(report, { ...cleanup, cleanupUnsettled: true }, false);
      }
      break;
    }
    case "native-write-loop": {
      requireValue(body.schemaVersion === 1);
      report.candidatePath = recordedPath(body.candidatePath);
      report.sourceRevision = revision(body.sourceRevision);
      requireValue(Array.isArray(body.attempts) && body.attempts.length <= 5);
      requireValue(["accepted", "attempt-limit", "no-progress", "cancelled", "time-budget", "executor-failed", "verification-unavailable", "snapshot-unavailable", "source-changed"].includes(body.stopReason as string));
      for (const attempt of body.attempts) bool(object(attempt).accepted);
      if (body.stopReason === "accepted") requireValue(body.attempts.length > 0 && object(body.attempts.at(-1)).accepted === true);
      report.historicalAcceptance.status = body.stopReason === "accepted" ? "accepted" : "refused";
      report.historicalAcceptance.scope = "native-loop";
      break;
    }
    case "native-apply-registration":
      requireValue(body.registrationSchema === 2);
      nativeSession(report, body.result);
      report.sourceRepo = recordedPath(body.sourceRepo);
      report.apply.registration = "recorded";
      break;
    default: throw new ProjectionError("unsupported", "unsupported-evidence-kind");
  }
  report.evidence.kind = body.kind as string;
}

/** Allowlisted historical claims only. This never grants serialized records native authority. */
export function projectTaskVerdict(file: string, value: unknown, byteLength: number): TaskVerdictProjection {
  const report = emptyTaskVerdict(file, "available");
  try {
    const outer = object(value);
    let body = outer;
    if (outer.schemaVersion !== undefined) {
      if (outer.schemaVersion !== "loop-artifact-v2") throw new ProjectionError("unsupported", "unsupported-envelope-version");
      requireValue(outer.byteLength === byteLength, "artifact-byte-length-mismatch");
      requireValue(typeof outer.runId === "string" && /^run_[A-Za-z0-9_-]{1,64}$/.test(outer.runId));
      requireValue(typeof outer.id === "string" && ARTIFACT_ID.test(outer.id));
      report.evidence.runId = outer.runId;
      report.evidence.artifactId = outer.id;
      body = object(outer.body);
    } else if (outer.kind !== "development-preflight") throw new ProjectionError("unsupported", "unsupported-evidence-format");
    bodyProjection(report, body);
    return report;
  } catch (error) {
    return emptyTaskVerdict(file, error instanceof ProjectionError ? error.state : "corrupt",
      error instanceof ProjectionError ? error.issue : "invalid-record");
  }
}

/** A separate host-saved return/prepared record is a claim, never proof of current application. */
export function projectApplyRecord(report: TaskVerdictProjection, file: string, value: unknown): void {
  report.apply.evidenceFile = file;
  try {
    requireValue(report.evidence.state === "available" || report.evidence.state === "incomplete", "primary-evidence-unavailable");
    const row = object(value);
    requireValue(report.candidatePath !== null && report.sourceRevision !== null && row.candidatePath === report.candidatePath &&
      row.sourceRevision === report.sourceRevision, "apply-reference-mismatch");
    const appliedRevision = revision(row.appliedRevision);
    if (row.status === "APPLIED") {
      requireValue(row.reverified === true && row.retainedCandidate === true);
      Object.assign(report.apply, { status: "recorded-applied", evidenceState: "available", appliedRevision, reverified: true });
    } else if (row.status === undefined && typeof row.candidateTree === "string" && REVISION.test(row.candidateTree)) {
      Object.assign(report.apply, { status: "prepared", evidenceState: "available", appliedRevision, reverified: null });
    } else throw new ProjectionError("unsupported", "unsupported-apply-record");
  } catch (error) {
    report.apply.issues.push(error instanceof ProjectionError ? error.issue : "invalid-apply-record");
    report.apply.evidenceState = error instanceof ProjectionError ? error.state : "corrupt";
  }
}

function markdownEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}[\]()#+.!|~-])/g, "\\$1");
}
/** Both renderers consume exactly this same bounded projection. */
export function renderTaskVerdictMarkdown(report: TaskVerdictProjection): string {
  const rows: string[] = ["# Historical task verdict", "", "| Field | Recorded value |", "| --- | --- |"];
  for (const [key, value] of Object.entries(report)) {
    if (Array.isArray(value)) value.forEach((item: string, i: number) => rows.push(`| ${key}.${i} | ${markdownEscape(item)} |`));
    else if (value !== null && typeof value === "object") {
      for (const [child, leaf] of Object.entries(value)) rows.push(`| ${key}.${child} | ${markdownEscape(Array.isArray(leaf) ? leaf.join(", ") : String(leaf))} |`);
    } else rows.push(`| ${key} | ${markdownEscape(String(value))} |`);
  }
  return rows.join("\n") + "\n";
}

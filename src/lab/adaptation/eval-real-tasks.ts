import { lstat, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { prepareDevelopmentCheckPlan } from "../../development/check-plan.js";
import { DomainValidationError } from "../../domain/errors.js";
import { isRecord } from "../../domain/record.js";
import { isRunId, parseEpisodeId, parseRunId, parseTaskId, type ResourceVersionId } from "../../domain/ids.js";
import { nowIso } from "../../domain/timestamp.js";
import { createEvaluationRecord } from "../../evaluation/evaluator.js";
import type { CriterionScore, EvaluationOutcome, EvaluationRecord } from "../../evaluation/types.js";
import type { ResourceRegistry } from "./registry.js";
import { identityEquals, type ResourceIdentity } from "./resource.js";
import { verifyMaterializedTaskResources } from "./task-resources.js";

export interface RealTaskTrialFiles {
  readonly recordFile: string;
  readonly inputFile: string;
  readonly contractFile: string;
  readonly eventsFile: string;
  readonly checkFile?: string;
  readonly preflightFile?: string;
}
export interface RealTaskTrialObservation {
  readonly recordRef: string;
  readonly logicalTaskId: string;
  readonly versionId?: ResourceVersionId;
  readonly status: string;
  readonly consumed: boolean;
  readonly correctDelivery: boolean | "unknown";
  readonly hostCheckReached: boolean | "unknown";
  readonly issues: readonly string[];
}
function fail(message: string): never { throw new DomainValidationError(`real-task evaluation: ${message}`); }
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export async function readRealTaskJson(file: string): Promise<unknown> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) fail("evidence must be a bounded regular file");
  return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")) as unknown;
}
function delivery(row: Record<string, unknown>): boolean | "unknown" {
  if (["FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "PREFLIGHT_FAILED", "ERROR"].includes(String(row.status)) ||
    row.accepted === false || row.effectsSettled === false || row.kept === false || (finite(row.escapedDefects) && row.escapedDefects > 0)) return false;
  return row.status === "COMPLETED" && row.accepted === true && row.effectsSettled === true && row.reviewed === true && row.kept === true && row.escapedDefects === 0 ? true : "unknown";
}
/** Read actual private records/artifacts; never substitute routing replay or worker self-reports. */
export async function evaluateRealTaskResources(input: { registry: ResourceRegistry; identity: ResourceIdentity; versionId: ResourceVersionId; trials: readonly RealTaskTrialFiles[] }) {
  const version = input.registry.getVersion(input.versionId);
  if (!version || !identityEquals(version.identity, input.identity) || version.parentVersionId === undefined) fail("evaluation requires a known promoted candidate version and its parent");
  if (!input.registry.ledger().some(entry => entry.kind === "promoted" && entry.toVersionId === version.versionId)) fail("candidate version has no approved promotion");
  if (input.trials.length === 0 || input.trials.length > 1000) fail("require 1..1000 trial attempts");
  const identities = new Set<string>(), candidateTasks = new Set<string>(), baselineTasks = new Set<string>();
  const actualRuns = new Set<string>();
  const claimedRuns = new Set<string>();
  const attempts: RealTaskTrialObservation[] = [], evaluations: EvaluationRecord[] = [];
  const strata = new Set<string>();
  let comparable = true;
  let knownLowerBoundUsd = 0, unknownCosts = 0;
  for (const files of input.trials) {
    const row = await readRealTaskJson(files.recordFile);
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.source !== "string" || !["pi-sparkle", "soul"].includes(row.source) || row.arm !== "sparkle") fail("invalid native real-task record identity");
    const identity = JSON.stringify([row.source, row.arm, row.id]);
    if (identities.has(identity)) fail("duplicate attempt identity");
    identities.add(identity);
    // Cost population only: a claimed run id is not proof of content consumption.
    // Independent preflight failures may have no run id and retain their record identity.
    if (isRunId(row.runId)) {
      const claimedRun = JSON.stringify([row.source, row.runId]);
      if (claimedRuns.has(claimedRun)) fail("duplicate claimed run identity");
      claimedRuns.add(claimedRun);
    }
    const lower = isRecord(row.cost) ? row.cost.knownLowerBoundUsd : undefined;
    if (row.referenceUsd !== "unknown" && row.referenceUsd !== undefined && !finite(row.referenceUsd)) fail("invalid reference cost");
    if (lower !== undefined && (!finite(lower) || (finite(row.referenceUsd) && lower > row.referenceUsd))) fail("invalid cost lower bound");
    knownLowerBoundUsd += finite(row.referenceUsd) ? row.referenceUsd : finite(lower) ? lower : 0;
    if (!Number.isFinite(knownLowerBoundUsd)) fail("cost sum is not finite");
    if (!finite(row.referenceUsd)) unknownCosts++;
    const issues: string[] = [];
    let logicalTaskId = row.id, resourceVersion: ResourceVersionId | undefined;
    let consumed: boolean;
    let actualRunIdentity: string | undefined;
    let taskId: string | undefined, artifactId: string | undefined, hostCheckReached: boolean | "unknown" = "unknown";
    let hostCheckPassed: boolean | "unknown" = "unknown";
    let checkerVersion = "unobserved";
    try {
      const artifact = await readRealTaskJson(files.contractFile);
      if (!isRecord(artifact) || artifact.schemaVersion !== "loop-artifact-v2" || typeof artifact.id !== "string" || artifact.runId !== row.runId || !isRecord(artifact.body)) fail("task artifact run identity mismatch");
      const body = artifact.body;
      if (body.kind !== "native-write-task-contract" || typeof body.runId !== "string" || body.runId !== row.runId || typeof body.taskId !== "string") fail("task artifact run or task binding mismatch");
      actualRunIdentity = JSON.stringify([row.source, body.runId]);
      const materialized = verifyMaterializedTaskResources(input.registry, await readRealTaskJson(files.inputFile));
      logicalTaskId = materialized.logicalTaskId;
      if (typeof row.comparisonId !== "string" || !row.comparisonId.trim() || row.comparisonId !== logicalTaskId) fail("materialized logical task does not match registered comparisonId");
      const binding = materialized.resources.find(resource => identityEquals(resource.identity, input.identity));
      if (!binding || ![version.versionId, version.parentVersionId].includes(binding.versionId)) fail("trial resource version is outside this comparison");
      resourceVersion = binding.versionId;
      if (materialized.resources.length !== 1) fail("evaluate one resource delta at a time");
      if (body.sourceRevision !== row.sourceRevision || body.sourceRevision !== materialized.sourceRevision) fail("task artifact source binding mismatch");
      if (body.objective !== materialized.spec.objective) fail("actual task objective did not consume materialized content");
      artifactId = artifact.id; taskId = body.taskId;
      const planned = prepareDevelopmentCheckPlan({ scopePolicy: { allowedScope: materialized.baseSpec.write.allow, protectedPaths: materialized.baseSpec.write.protect },
        checks: materialized.baseSpec.checks.map(({ expect: _expect, ...check }) => check) }).verification;
      const expected = { ...planned, timeoutMs: Math.round(materialized.baseSpec.budget.checkSeconds * 1000) };
      const actual = body.verification;
      if (!isRecord(actual) || !isRecord(actual.trustedVerification) || typeof actual.trustedVerification.id !== "string" || !actual.trustedVerification.id) fail("actual verifier descriptor is missing");
      const { id: _actualId, ...actualDescriptor } = actual.trustedVerification;
      const { id: _expectedId, ...expectedDescriptor } = expected.trustedVerification!;
      if (!isDeepStrictEqual({ ...actual, trustedVerification: actualDescriptor }, { ...expected, trustedVerification: expectedDescriptor })) fail("actual verifier does not match materialized checker definitions");
      checkerVersion = JSON.stringify({ ...actual, trustedVerification: actualDescriptor });
      if (typeof row.model !== "string" || !row.model || typeof row.thinking !== "string" || !row.thinking) comparable = false;
      strata.add(JSON.stringify({ source: row.source, model: row.model, thinking: row.thinking, verifier: checkerVersion,
        prepare: materialized.baseSpec.prepare, budget: materialized.baseSpec.budget }));
      // A date-only operator record cannot prove a later trial. Use the actual host run creation event.
      const eventInfo = await lstat(files.eventsFile);
      if (!eventInfo.isFile() || eventInfo.isSymbolicLink() || eventInfo.size > 16 * 1024 * 1024) fail("run events must be a bounded regular file");
      const events = (await readFile(files.eventsFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
      const created = events.find(event => isRecord(event) && event.type === "RUN_CREATED" && event.runId === row.runId);
      if (!isRecord(created) || typeof created.occurredAt !== "string" || !Number.isFinite(Date.parse(created.occurredAt)) ||
          !isRecord(created.payload) || !isRecord(created.payload.run) || created.payload.run.id !== row.runId ||
          Date.parse(created.occurredAt) < Date.parse(input.registry.getVersion(binding.versionId)!.createdAt)) fail("trial is not bound to a later host run");
      if (binding.topic === "node-preparation") {
        // Existing preflight artifacts record recipe id/result, not command/argv. Same-id replacement is indistinguishable.
        // Do not call guidance text or an author-supplied binding proof of actual preparation consumption.
        fail("workflow preparation consumption UNOBSERVED: existing preflight evidence does not bind command/argv");
      }
      consumed = true;
      if (files.checkFile !== undefined) {
        const checked = await readRealTaskJson(files.checkFile);
        if (!isRecord(checked) || checked.schemaVersion !== "loop-artifact-v2" || checked.runId !== row.runId || !isRecord(checked.body) ||
            checked.body.kind !== "ps-p3-closed-loop" || checked.body.revision !== row.sourceRevision || checked.body.cwd !== body.candidatePath || !isRecord(checked.body.check)) fail("host check artifact binding mismatch");
        const check = checked.body.check;
        if (checked.body.command !== actual.command || !isDeepStrictEqual(checked.body.args, actual.args) || check.cwd !== body.candidatePath ||
            check.command !== actual.command || !isDeepStrictEqual(check.args, actual.args)) fail("actual host checker command binding mismatch");
        if (check.kind !== "command-check" || check.processStatus !== "completed" || !Number.isSafeInteger(check.processExitCode) ||
            check.processExitCode !== check.exitCode || check.processSignal !== null || check.processCleanupUnsettled === true ||
            !isRecord(check.trustedVerification) || check.trustedVerification.schemaVersion !== "exact-verification-v1" ||
            check.trustedVerification.descriptorId !== actual.trustedVerification.id || check.trustedVerification.ok !== true) fail("host check lacks settled exact verification evidence");
        hostCheckReached = true;
        hostCheckPassed = check.exitCode === 0;
        if (row.accepted === true && check.exitCode !== 0) fail("accepted record conflicts with failed host check");
      }
    } catch (error) { issues.push(error instanceof Error ? error.message : "unverified evidence"); consumed = false; }
    // Outside evidence recovery: a renamed record must not retain duplicate cost or alter delivery rates.
    if (actualRunIdentity !== undefined) {
      if (actualRuns.has(actualRunIdentity)) fail("duplicate actual run identity");
      actualRuns.add(actualRunIdentity);
    }
    const registeredTask = JSON.stringify([row.source, row.comparisonId]);
    if (consumed && resourceVersion === version.versionId) candidateTasks.add(registeredTask);
    if (consumed && resourceVersion === version.parentVersionId) baselineTasks.add(registeredTask);
    const recordedDelivery = delivery(row);
    const correctDelivery = recordedDelivery === false || hostCheckPassed === false ? false :
      consumed && hostCheckPassed === true && recordedDelivery === true ? true : "unknown";
    attempts.push({ recordRef: files.recordFile, logicalTaskId, ...(resourceVersion === undefined ? {} : { versionId: resourceVersion }),
      status: typeof row.status === "string" ? row.status : "unknown", consumed, correctDelivery, hostCheckReached, issues });
    if (artifactId && taskId && resourceVersion) {
      const score = (criterionId: string, observed: boolean | "unknown", ref: string): CriterionScore => ({ criterionId,
        outcome: observed === "unknown" ? "UNOBSERVED" : observed ? "PASS" : "FAIL", ...(observed === "unknown" ? {} : { evidenceRef: ref }) });
      const base = createEvaluationRecord({ episodeId: parseEpisodeId(`ep_${logicalTaskId.replace(/[^A-Za-z0-9_-]/g, "_")}`),
        runId: parseRunId(String(row.runId)), taskId: parseTaskId(taskId), evaluator: { kind: "deterministic", version: "real-task-resources-v1", rubricVersion: "1" },
        rubric: { id: "real-task-resources", version: 1, scope: "task", createdAt: nowIso(), criteria: [] }, evidence: {},
        target: { artifactId, artifactVersion: String(row.sourceRevision) }, independenceClass: "same-author",
        dependencyVersions: { resource: resourceVersion, source: String(row.sourceRevision), checker: checkerVersion, rubric: "real-task-resources-v1" } });
      const scores = [score("content-consumption", consumed ? true : "unknown", files.contractFile),
        score("host-check-reached", hostCheckReached, files.checkFile ?? files.contractFile), score("correct-delivery", correctDelivery, files.recordFile),
        score("complete-reference-cost", finite(row.referenceUsd) ? true : "unknown", files.recordFile)];
      const overall: EvaluationOutcome = !consumed ? "UNOBSERVED" : correctDelivery === false ? "FAIL" : correctDelivery === true ? "PASS" : "UNOBSERVED";
      evaluations.push({ ...base, scores, overall });
    }
  }
  const candidate = attempts.filter(attempt => attempt.consumed && attempt.versionId === version.versionId);
  const baseline = attempts.filter(attempt => attempt.consumed && attempt.versionId === version.parentVersionId);
  const rate = (rows: readonly RealTaskTrialObservation[]) => rows.filter(row => row.correctDelivery === true).length / rows.length;
  // Descriptive only: no causal, non-inferiority or ADR-010 benefit claim follows from five observations.
  let conclusion: "better" | "worse" | "unclear" = "unclear";
  if (candidateTasks.size >= 5 && baselineTasks.size > 0 && comparable && strata.size === 1 &&
      attempts.every(attempt => attempt.consumed && attempt.hostCheckReached === true && typeof attempt.correctDelivery === "boolean")) {
    conclusion = rate(candidate) > rate(baseline) ? "better" : rate(candidate) < rate(baseline) ? "worse" : "unclear";
  }
  return { conclusion, interpretation: "descriptive correct-delivery comparison only; not causal evidence or ADR-010 benefit acceptance", candidateTasks: candidateTasks.size,
    baselineTasks: baselineTasks.size, attempts, evaluations, cost: { knownLowerBoundUsd, unknownAttempts: unknownCosts, totalUsd: unknownCosts ? "unknown" : knownLowerBoundUsd } };
}

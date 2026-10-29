import { lstat, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { prepareDevelopmentCheckPlan, renderVisibleDevelopmentChecks, visibleDevelopmentCriteria } from "../../development/check-plan.js";
import { DomainValidationError } from "../../domain/errors.js";
import { isRecord } from "../../domain/record.js";
import { isRunId, parseEpisodeId, parseRunId, parseTaskId, type ResourceVersionId } from "../../domain/ids.js";
import { nowIso } from "../../domain/timestamp.js";
import { createEvaluationRecord } from "../../evaluation/evaluator.js";
import type { CriterionScore, EvaluationOutcome, EvaluationRecord } from "../../evaluation/types.js";
import type { ResourceRegistry } from "./registry.js";
import { identityEquals, type ResourceIdentity } from "./resource.js";
import { parseTaskResourceContent, verifyMaterializedTaskResources } from "./task-resources.js";
import { verifyTaskModelConsumption } from "./model-consumption.js";
import { parseTaskModelSelection } from "../../domain/task-model-selection.js";
import { verifyTaskResourceRequest, verifyTaskResourceWorkerMessages } from "./task-request.js";

export interface RealTaskTrialFiles {
  readonly recordFile: string;
  readonly inputFile: string;
  readonly contractFile: string;
  readonly eventsFile: string;
  readonly checkFile?: string;
  readonly preflightFile?: string;
  readonly loopFile?: string;
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
  const promotion = input.registry.ledger().find(entry => entry.kind === "promoted" && entry.toVersionId === version.versionId);
  if (!promotion) fail("candidate version has no approved promotion");
  if (input.trials.length === 0 || input.trials.length > 1000) fail("require 1..1000 trial attempts");
  const identities = new Set<string>(), candidateTasks = new Set<string>(), baselineTasks = new Set<string>();
  const actualRuns = new Set<string>();
  const claimedRuns = new Set<string>();
  const attempts: RealTaskTrialObservation[] = [], evaluations: EvaluationRecord[] = [];
  const modelComparison = input.identity.kind === "workflow-template" && input.identity.name === "model-thinking";
  const controls = new Map<string, { signature: string; versions: Set<ResourceVersionId>; candidate: boolean[]; baseline: boolean[]; issues: string[][] }>();
  let comparable = true;
  if (modelComparison) {
    const selected = parseTaskResourceContent(input.registry.getContent(version.contentHash)!);
    const parent = input.registry.getVersion(version.parentVersionId)!;
    const previous = parseTaskResourceContent(input.registry.getContent(parent.contentHash)!);
    if (selected.topic !== "model-thinking" || previous.topic !== "model-thinking") fail("model recipe versions must declare fixed selections");
    if (isDeepStrictEqual(selected.selection, previous.selection)) comparable = false;
  }
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
      const planned = prepareDevelopmentCheckPlan({ scopePolicy: { allowedScope: materialized.spec.write.allow, protectedPaths: materialized.spec.write.protect },
        checks: materialized.spec.checks.map(({ expect: _expect, ...check }) => check) });
      const expected = { ...planned.verification, timeoutMs: Math.round(materialized.baseSpec.budget.checkSeconds * 1000) };
      const actual = body.verification;
      if (!isRecord(actual) || !isRecord(actual.trustedVerification) || typeof actual.trustedVerification.id !== "string" || !actual.trustedVerification.id) fail("actual verifier descriptor is missing");
      const { id: _actualId, ...actualDescriptor } = actual.trustedVerification;
      const { id: _expectedId, ...expectedDescriptor } = expected.trustedVerification!;
      if (!isDeepStrictEqual({ ...actual, trustedVerification: actualDescriptor }, { ...expected, trustedVerification: expectedDescriptor })) fail("actual verifier does not match materialized checker definitions");
      checkerVersion = JSON.stringify({ ...actual, trustedVerification: actualDescriptor });
      const recipeComparison = binding.topic === "check-recipes";
      if (recipeComparison || modelComparison) {
        const review = promotion.review;
        if (!review || review.reviewerKind !== "independent" || review.verdict !== "approved" || review.reviewerId === review.actorId ||
            review.actorId !== version.author.identity || review.candidateId !== promotion.candidateId || review.contentHash !== version.contentHash) {
          comparable = false; issues.push(recipeComparison ? "independent business-equivalence review of the exact versioned launcher conversions is missing" : "independent review of the exact versioned fixed model recipe is missing");
        }
        const content = parseTaskResourceContent(input.registry.getContent(version.contentHash)!);
        if (recipeComparison && content.topic !== "check-recipes") fail("check-recipe version content mismatch");
        if (content.topic === "check-recipes" && content.launchers.some(launcher => !isDeepStrictEqual(launcher.fromPrefixArgs, launcher.prefixArgs))) {
          comparable = false; issues.push("import loader implementation/version equivalence is UNOBSERVED; consumed argv alone does not prove equal business checks");
        }
      }
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
      const criteria = visibleDevelopmentCriteria(planned.checkPlan);
      if (!isDeepStrictEqual(body.acceptanceCriteria, criteria)) fail("task contract does not match the materialized host acceptance criteria");
      const declaredObjective = criteria === undefined ? materialized.spec.objective :
        `${materialized.spec.objective}\n\nHost-authored acceptance criteria (requirements, not executable commands or permission grants; host verification decides overall acceptance):\n${JSON.stringify(criteria)}`;
      const request = verifyTaskResourceRequest({ contract: artifact, events,
        expectedObjective: declaredObjective + renderVisibleDevelopmentChecks(planned.checkPlan), requiredFiles: materialized.spec.context,
        acceptanceMetadata: criteria?.map(criterion => JSON.stringify(criterion)) ?? [] });
      let actualSelection: unknown;
      if (modelComparison) {
        if (!materialized.modelSelection || files.loopFile === undefined) fail("model submission consumption UNOBSERVED: bound native-loop SDK observations are required");
        verifyTaskModelConsumption({ loop: await readRealTaskJson(files.loopFile), contract: artifact, events, selection: materialized.modelSelection });
      } else {
        // Operator labels do not prove a matched model. Keep prompt consumption separate
        // from the actual dispatch control, including when fees or receipts are unknown.
        try {
          if (files.loopFile === undefined) fail("bound native-loop SDK observations are required for model controls");
          const loop = await readRealTaskJson(files.loopFile);
          const summary = isRecord(loop) && isRecord(loop.body) ? loop.body.referenceCost : undefined;
          const costAttempt: unknown = isRecord(summary) && Array.isArray(summary.attempts) ? summary.attempts[0] : undefined;
          const observation: unknown = isRecord(costAttempt) && isRecord(costAttempt.report) && Array.isArray(costAttempt.report.sdkObservations) ? costAttempt.report.sdkObservations[0] : undefined;
          if (!isRecord(observation)) fail("actual model control is UNOBSERVED");
          const selection = parseTaskModelSelection({ providerId: observation.provider, modelId: observation.model, thinkingLevel: observation.transportReasoning });
          verifyTaskModelConsumption({ loop, contract: artifact, events, selection });
          actualSelection = selection;
        } catch (error) {
          comparable = false; issues.push(error instanceof Error ? error.message : "actual model control is UNOBSERVED");
          verifyTaskResourceWorkerMessages({ parentRunId: body.runId, request, events });
        }
      }
      const key = JSON.stringify([row.source, logicalTaskId]);
      const signature = JSON.stringify({ revision: materialized.sourceRevision, spec: materialized.baseSpec,
        selection: modelComparison ? "reviewed-fixed-profile-delta" : actualSelection });
      const previous = controls.get(key);
      if (previous && previous.signature !== signature) {
        comparable = false; issues.push("original committed source/goal/spec or actual model differs within this task pair");
      }
      if (previous) { previous.versions.add(binding.versionId); previous.issues.push(issues); }
      else controls.set(key, { signature, versions: new Set([binding.versionId]), candidate: [], baseline: [], issues: [issues] });
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
    if (consumed && typeof correctDelivery === "boolean") {
      const control = controls.get(registeredTask)!;
      (resourceVersion === version.versionId ? control.candidate : control.baseline).push(correctDelivery);
    }
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
      const scores = [score("content-consumption", consumed ? true : "unknown", files.eventsFile),
        score("host-check-reached", hostCheckReached, files.checkFile ?? files.contractFile), score("correct-delivery", correctDelivery, files.recordFile),
        score("complete-reference-cost", finite(row.referenceUsd) ? true : "unknown", files.recordFile)];
      const overall: EvaluationOutcome = !consumed ? "UNOBSERVED" : correctDelivery === false ? "FAIL" : correctDelivery === true ? "PASS" : "UNOBSERVED";
      evaluations.push({ ...base, scores, overall });
    }
  }
  // Retain every retry, but weight each matched logical task equally. Unequal retry
  // populations must not turn identical per-task outcomes into an apparent benefit.
  const rate = (arm: "candidate" | "baseline") => [...controls.values()].reduce((sum, control) =>
    sum + control[arm].filter(Boolean).length / control[arm].length, 0) / controls.size;
  // Descriptive only: no causal, non-inferiority or ADR-010 benefit claim follows from five observations.
  let conclusion: "better" | "worse" | "unclear" = "unclear";
  for (const control of controls.values()) {
    if (!control.versions.has(version.versionId) || !control.versions.has(version.parentVersionId!)) {
      comparable = false;
      for (const issues of control.issues) issues.push("matching baseline and candidate attempts for this logical task are required");
    }
  }
  if (candidateTasks.size >= 5 && baselineTasks.size >= 5 && comparable &&
      attempts.every(attempt => attempt.consumed && attempt.hostCheckReached === true && typeof attempt.correctDelivery === "boolean")) {
    conclusion = rate("candidate") > rate("baseline") ? "better" : rate("candidate") < rate("baseline") ? "worse" : "unclear";
  }
  return { conclusion, interpretation: "descriptive correct-delivery comparison only; not causal evidence or ADR-010 benefit acceptance", candidateTasks: candidateTasks.size,
    baselineTasks: baselineTasks.size, attempts, evaluations, cost: { knownLowerBoundUsd, unknownAttempts: unknownCosts, totalUsd: unknownCosts ? "unknown" : knownLowerBoundUsd } };
}

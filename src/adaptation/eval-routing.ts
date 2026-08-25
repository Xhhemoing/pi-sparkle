import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { writeFileAtomic, type AtomicWriteOptions } from "../persist/atomic-file.js";
import { adaptationRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import { isCandidateId, parseTaskId, type CandidateId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { createEvaluationCard } from "../experiments/evaluation-card.js";
import {
  computeComparisonReport,
  DEFAULT_COMPARISON_REPORT_CONFIG,
  validateComparisonReport,
  type ComparisonReport,
  type ComparisonReportConfig,
  type PairedEvaluationRecord
} from "../experiments/comparison-report.js";
import { createIsolationGuard } from "../experiments/isolation.js";
import { stableStringify } from "../experiments/manifest.js";
import { replayCacheKey } from "../experiments/replay.js";
import {
  parseLearnedRoutingPolicy,
  type LearnedRoutingPolicy
} from "../learning/learned-routing.js";
import { catalogFromPrimary } from "../routing/primary-catalog.js";
import { assignTasks } from "../routing/assign.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";
import { loadAdaptationRegistry } from "./promotion.js";
import type { ResourceRegistry } from "./registry.js";

export const ROUTING_EVALUATOR_VERSION = "routing-eval-v1";

const FORBIDDEN_POLICY_FIELDS = new Set([
  "permission",
  "credential",
  "secret",
  "token",
  "apikey",
  "password",
  "authorization"
]);

const REPLAY_COMPARISON_CONFIG: ComparisonReportConfig = {
  ...DEFAULT_COMPARISON_REPORT_CONFIG,
  evidenceClass: "simulation"
};

const IMPROVEMENT_CLAIM = /improve|outperform|better|regret/i;

export interface RoutingEvalRequest {
  readonly stateRoot: string;
  readonly candidateId: string;
  readonly datasetDir: string; // frozen replay episodes, never the live workspace
}

export interface RoutingEvalReport {
  readonly candidateId: string;
  readonly contentHash: string;
  readonly cacheKey: string;
  readonly stages: readonly ("static" | "replay")[];
  readonly comparison: ComparisonReport;
  readonly evidenceClass: "replay";
  readonly environmentVersion: string;
  readonly evaluatorVersion: string;
  readonly rerunHash: string;
}

export interface RoutingEvalResult {
  readonly report: RoutingEvalReport;
  readonly reportPath: string;
}

export function parseRoutingEvalReport(value: unknown): RoutingEvalReport {
  if (!isRecord(value)) {
    throw new DomainValidationError("eval report must be an object");
  }
  if (typeof value.candidateId !== "string" || value.candidateId.trim() === "") {
    throw new DomainValidationError("eval report candidateId is required");
  }
  if (typeof value.contentHash !== "string" || value.contentHash.trim() === "") {
    throw new DomainValidationError("eval report contentHash is required");
  }
  if (typeof value.cacheKey !== "string" || value.cacheKey.trim() === "") {
    throw new DomainValidationError("eval report cacheKey is required");
  }
  if (!Array.isArray(value.stages)) {
    throw new DomainValidationError("eval report stages must be an array");
  }
  if (!isRecord(value.comparison)) {
    throw new DomainValidationError("eval report comparison must be an object");
  }
  if (!Array.isArray(value.comparison.claims)) {
    throw new DomainValidationError("eval report comparison.claims must be an array");
  }
  if (!isRecord(value.comparison.utilityDelta) || !isRecord(value.comparison.costDelta)) {
    throw new DomainValidationError("eval report comparison deltas are required");
  }
  if (typeof value.environmentVersion !== "string" || value.environmentVersion.trim() === "") {
    throw new DomainValidationError("eval report environmentVersion is required");
  }
  if (typeof value.evaluatorVersion !== "string" || value.evaluatorVersion.trim() === "") {
    throw new DomainValidationError("eval report evaluatorVersion is required");
  }
  if (typeof value.rerunHash !== "string" || value.rerunHash.trim() === "") {
    throw new DomainValidationError("eval report rerunHash is required");
  }
  return value as unknown as RoutingEvalReport;
}

/**
 * One replay row. `adapt dataset` writes these as the routed tasks of a single
 * run, so a manifest's rows are not independent episodes even though the key
 * they arrive under is `episodes` (kept because this reader and its errors
 * name that path).
 */
interface RoutingEvalEpisode {
  readonly episodeHash: string;
  readonly taskId: string;
  readonly role: AgentRole;
  readonly objective: string;
  readonly taskFamily?: string | undefined;
  readonly taskSuccess?: "PASS" | "FAIL" | undefined;
  /**
   * The exporter's redacted project root. Best-effort redaction means this may
   * be a placeholder (`[path]`) rather than a real directory, so isolation
   * treats only absolute values as roots.
   */
  readonly originalWorkspace: string;
}

interface RoutingEvalDataset {
  readonly datasetId: string;
  readonly environmentVersion: string;
  readonly episodes: readonly RoutingEvalEpisode[];
}

interface ReplayAction {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly taskSuccess: "PASS" | "FAIL" | "UNOBSERVED";
  readonly baselineModel: string;
  readonly candidateModel: string;
  readonly baselineCostUsd: number;
  readonly candidateCostUsd: number;
}

export async function evalRoutingPolicy(
  request: RoutingEvalRequest,
  writeOptions: AtomicWriteOptions = {}
): Promise<RoutingEvalResult> {
  if (!isCandidateId(request.candidateId)) {
    throw new DomainValidationError(`invalid candidate id: ${request.candidateId}`);
  }
  const candidateId = request.candidateId as CandidateId;
  const registry = await loadAdaptationRegistry(request.stateRoot);
  const candidate = registry.getCandidate(candidateId);
  if (candidate === undefined) {
    throw new DomainValidationError(`unknown candidate: ${candidateId}`);
  }
  if (candidate.identity.kind !== "routing-policy") {
    throw new DomainValidationError(
      `adapt eval only supports routing-policy candidates (got ${candidate.identity.kind})`
    );
  }

  const candidateContent = contentFor(registry, candidate.contentHash, "candidate");
  const candidatePolicy = parseRoutingPolicyContent(candidateContent);
  const parent = registry.getVersion(candidate.parentVersionId);
  if (parent === undefined) {
    throw new DomainValidationError(`unknown parent version: ${candidate.parentVersionId}`);
  }
  const baselineContent = contentFor(registry, parent.contentHash, "parent");
  const baselinePolicy = parseRoutingPolicyContent(baselineContent);

  const dataset = await loadRoutingEvalDataset(request.datasetDir);
  const outputRoot = join(adaptationRoot(request.stateRoot), "evals");
  assertReplayIsolated(dataset, request.datasetDir, outputRoot);

  const catalog = catalogFromPrimary({ primaryModelId: baselinePolicy.primaryModelId });
  const actions = replayAssignments(dataset.episodes, catalog, baselinePolicy, candidatePolicy);
  const records = pairedRecords(dataset.episodes, actions);
  if (records.length === 0) {
    throw new DomainValidationError(
      "routing eval requires at least one episode with recorded PASS or FAIL"
    );
  }

  const comparison = gatedComparison(records);
  const cacheKey = replayCacheKey({
    runId: dataset.datasetId,
    candidateHash: candidate.contentHash,
    environmentVersion: dataset.environmentVersion,
    evaluatorVersion: ROUTING_EVALUATOR_VERSION
  });
  const rerunHash = hash32(
    stableStringify({
      datasetId: dataset.datasetId,
      cache: {
        candidateHash: candidate.contentHash,
        environmentVersion: dataset.environmentVersion,
        evaluatorVersion: ROUTING_EVALUATOR_VERSION
      },
      actions
    })
  );

  const report: RoutingEvalReport = {
    candidateId,
    contentHash: candidate.contentHash,
    cacheKey,
    stages: ["static", "replay"],
    comparison,
    evidenceClass: "replay",
    environmentVersion: dataset.environmentVersion,
    evaluatorVersion: ROUTING_EVALUATOR_VERSION,
    rerunHash
  };

  await mkdir(outputRoot, { recursive: true });
  const reportPath = join(outputRoot, `${candidateId}.${cacheKey}.json`);
  await writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`, writeOptions);
  return { report, reportPath };
}

function contentFor(registry: ResourceRegistry, contentHash: string, label: string): string {
  const content = registry.getContent(contentHash);
  if (content === undefined) {
    throw new DomainValidationError(`missing ${label} content for hash ${contentHash}`);
  }
  return content;
}

function parseRoutingPolicyContent(content: string): LearnedRoutingPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new DomainValidationError("routing-policy content is not JSON");
  }
  assertNoForbiddenFields(parsed);
  return parseLearnedRoutingPolicy(content);
}

function assertNoForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoForbiddenFields(entry);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_POLICY_FIELDS.has(key.toLowerCase())) {
      throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
    }
    assertNoForbiddenFields(child);
  }
}

async function loadRoutingEvalDataset(datasetDir: string): Promise<RoutingEvalDataset> {
  const path = join(datasetDir, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new DomainValidationError(`dataset manifest not found at ${path}`);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new DomainValidationError(`invalid dataset manifest JSON at ${path}`);
  }
  if (!isRecord(parsed)) {
    throw new DomainValidationError("dataset manifest must be an object");
  }
  if (typeof parsed.datasetId !== "string" || parsed.datasetId.trim() === "") {
    throw new DomainValidationError("dataset manifest datasetId is required");
  }
  if (typeof parsed.environmentVersion !== "string" || parsed.environmentVersion.trim() === "") {
    throw new DomainValidationError("dataset manifest environmentVersion is required");
  }
  if (!Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
    throw new DomainValidationError("dataset manifest episodes must be a non-empty array");
  }
  const episodes = parsed.episodes.map((entry, index) =>
    parseEpisode(entry, index, manifestWorkspace(parsed.source))
  );
  return {
    datasetId: parsed.datasetId,
    environmentVersion: parsed.environmentVersion,
    episodes
  };
}

/**
 * The exporter stores the redacted project root once on `source` and repeats it
 * on every row. A manifest that carries only the manifest-level copy still
 * loads: the row-level key remains the reader's contract, and this is the value
 * it defaults to.
 */
function manifestWorkspace(source: unknown): string | undefined {
  if (!isRecord(source)) return undefined;
  const workspace = source.originalWorkspace;
  return typeof workspace === "string" && workspace.trim() !== "" ? workspace : undefined;
}

function parseEpisode(
  value: unknown,
  index: number,
  fallbackWorkspace: string | undefined
): RoutingEvalEpisode {
  if (!isRecord(value)) {
    throw new DomainValidationError(`dataset episodes[${index}] must be an object`);
  }
  if (typeof value.episodeHash !== "string" || value.episodeHash.trim() === "") {
    throw new DomainValidationError(`dataset episodes[${index}] requires episodeHash`);
  }
  if (typeof value.taskId !== "string") {
    throw new DomainValidationError(`dataset episodes[${index}] requires taskId`);
  }
  parseTaskId(value.taskId);
  if (!isAgentRole(value.role)) {
    throw new DomainValidationError(`dataset episodes[${index}] has invalid role`);
  }
  if (typeof value.objective !== "string" || value.objective.trim() === "") {
    throw new DomainValidationError(`dataset episodes[${index}] requires objective`);
  }
  const originalWorkspace =
    typeof value.originalWorkspace === "string" && value.originalWorkspace.trim() !== ""
      ? value.originalWorkspace
      : fallbackWorkspace;
  if (originalWorkspace === undefined) {
    throw new DomainValidationError(`dataset episodes[${index}] requires originalWorkspace`);
  }
  let taskSuccess: "PASS" | "FAIL" | undefined;
  if (value.taskSuccess !== undefined) {
    if (value.taskSuccess !== "PASS" && value.taskSuccess !== "FAIL") {
      throw new DomainValidationError(
        `dataset episodes[${index}] taskSuccess must be PASS or FAIL when present`
      );
    }
    taskSuccess = value.taskSuccess;
  }
  const taskFamily =
    typeof value.taskFamily === "string" && value.taskFamily.trim() !== ""
      ? value.taskFamily
      : undefined;
  return {
    episodeHash: value.episodeHash,
    taskId: value.taskId,
    role: value.role,
    objective: value.objective,
    originalWorkspace,
    ...(taskFamily !== undefined ? { taskFamily } : {}),
    ...(taskSuccess !== undefined ? { taskSuccess } : {})
  };
}

/**
 * The dataset directory is always a real directory and always a read-only root.
 * A recorded workspace is only a root when it is still an absolute path: the
 * exporter redacts it, and a redacted value such as `[path]` is a marker, not a
 * location — resolving it against the current working directory would invent a
 * root that never existed.
 */
function assertReplayIsolated(
  dataset: RoutingEvalDataset,
  datasetDir: string,
  outputRoot: string
): void {
  const workspaces = dataset.episodes
    .map((episode) => episode.originalWorkspace)
    .filter((workspace) => isAbsolute(workspace));
  try {
    createIsolationGuard({
      readOnlyRoots: [...workspaces, datasetDir],
      outputRoot
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError(`output root overlaps original workspace: ${detail}`);
  }
}

function replayAssignments(
  episodes: readonly RoutingEvalEpisode[],
  catalog: ModelRouterConfig,
  baselinePolicy: LearnedRoutingPolicy,
  candidatePolicy: LearnedRoutingPolicy
): readonly ReplayAction[] {
  const tasks = episodes.map((episode) => ({
    taskId: parseTaskId(episode.taskId),
    role: episode.role,
    objective: episode.objective
  }));
  const baseline = assignTasks({ catalog, tasks, learned: baselinePolicy });
  const candidate = assignTasks({ catalog, tasks, learned: candidatePolicy });
  return episodes.map((episode, index) => {
    const baselineAssignment = baseline[index];
    const candidateAssignment = candidate[index];
    if (baselineAssignment === undefined || candidateAssignment === undefined) {
      throw new DomainValidationError(`missing assignment for ${episode.episodeHash}`);
    }
    return {
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily ?? baselineAssignment.analysis.family,
      taskSuccess: episode.taskSuccess ?? "UNOBSERVED",
      baselineModel: baselineAssignment.decision.model,
      candidateModel: candidateAssignment.decision.model,
      baselineCostUsd: catalogCost(catalog, baselineAssignment.decision.model),
      candidateCostUsd: catalogCost(catalog, candidateAssignment.decision.model)
    };
  });
}

function catalogCost(catalog: ModelRouterConfig, modelId: string): number {
  const model = catalog.models.find((entry) => entry.id === modelId);
  if (model === undefined) {
    throw new DomainValidationError(`selected model ${modelId} is not in the catalog`);
  }
  return model.estimatedCostUsd;
}

function pairedRecords(
  episodes: readonly RoutingEvalEpisode[],
  actions: readonly ReplayAction[]
): PairedEvaluationRecord[] {
  const records: PairedEvaluationRecord[] = [];
  for (const [index, episode] of episodes.entries()) {
    if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
      continue;
    }
    const action = actions[index];
    if (action === undefined) {
      throw new DomainValidationError(`missing replay action for ${episode.episodeHash}`);
    }
    const utility = episode.taskSuccess === "PASS" ? 1 : 0;
    records.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily ?? action.taskFamily,
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: action.baselineCostUsd,
      candidateCostUsd: action.candidateCostUsd
    });
  }
  return records;
}

function gatedComparison(records: readonly PairedEvaluationRecord[]): ComparisonReport {
  const card = cardFromRecords(records);
  const report = computeComparisonReport(records, card, [], REPLAY_COMPARISON_CONFIG);
  const validation = validateComparisonReport(report, REPLAY_COMPARISON_CONFIG);
  if (validation.valid) {
    return report;
  }
  const stripped = report.claims.filter((claim) => !IMPROVEMENT_CLAIM.test(claim));
  const retry = computeComparisonReport(records, card, stripped, REPLAY_COMPARISON_CONFIG);
  const retryValidation = validateComparisonReport(retry, REPLAY_COMPARISON_CONFIG);
  if (!retryValidation.valid) {
    throw new DomainValidationError(
      `comparison report invalid: ${retryValidation.reasons.join("; ")}`
    );
  }
  return retry;
}

function cardFromRecords(records: readonly PairedEvaluationRecord[]) {
  const domains = [...new Set(records.map((record) => record.taskFamily))];
  const baselineUtilities = records.map((record) => record.baselineUtility);
  const candidateUtilities = records.map((record) => record.candidateUtility);
  const baselineCosts = records.map((record) => record.baselineCostUsd);
  const candidateCosts = records.map((record) => record.candidateCostUsd);
  return createEvaluationCard({
    domains,
    difficultyTiers: ["replay"],
    metrics: ["utility", "cost"],
    baseline: {
      utility: mean(baselineUtilities),
      costUsd: mean(baselineCosts),
      uncertainty: sampleStandardError(baselineUtilities)
    },
    candidate: {
      utility: mean(candidateUtilities),
      costUsd: mean(candidateCosts),
      uncertainty: sampleStandardError(candidateUtilities)
    },
    guardrailViolations: []
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardError(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  let variance = 0;
  for (const value of values) {
    variance += (value - average) * (value - average);
  }
  return Math.sqrt(variance / (values.length - 1)) / Math.sqrt(values.length);
}

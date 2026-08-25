import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { RunId } from "../domain/ids.js";
import { redactSensitiveText, type RedactionClass } from "../feedback/redaction.js";
import { createIsolationGuard } from "../experiments/isolation.js";
import { stableStringify } from "../experiments/manifest.js";
import { writeFileAtomic, type AtomicWriteOptions } from "../persist/atomic-file.js";
import { adaptationRoot } from "../privacy/state-layout.js";
import type { Event } from "../run/events.js";
import { outcomesFromRoutedRun } from "./from-episode.js";

export const EVAL_DATASET_EXPORTER_VERSION = "adapt-dataset-v1";

/**
 * Objectives are user text. The manifest needs one because the replay re-runs
 * `assignTasks` over it, but it does not need the whole thing: a bounded
 * excerpt keeps the routing keywords (which lead the objective) while capping
 * how much task text a derived adaptation-plane file can ever hold.
 */
export const OBJECTIVE_MAX_CHARS = 500;

export interface EvalDatasetEpisode {
  readonly episodeHash: string;
  readonly taskId: string;
  readonly role: AgentRole;
  readonly objective: string;
  readonly taskFamily: string;
  readonly taskSuccess: "PASS" | "FAIL";
  readonly originalWorkspace: string;
}

export interface EvalDatasetManifest {
  readonly datasetId: string;
  readonly environmentVersion: string;
  readonly source: {
    readonly kind: "run-event-log";
    readonly runId: string;
    readonly exporterVersion: string;
    readonly objectiveMaxChars: number;
    readonly redactionPipe: "redactSensitiveText";
    readonly redactionClasses: readonly RedactionClass[];
  };
  readonly episodes: readonly EvalDatasetEpisode[];
}

export interface ExportEvalDatasetInput {
  readonly stateRoot: string;
  readonly runId: RunId;
  /** The run's own event log, already read by the caller (runtime-plane reader). */
  readonly events: readonly Event[];
  /** Defaults to `<stateRoot>/adaptation/eval-datasets/<runId>`. */
  readonly datasetDir?: string | undefined;
}

export interface ExportEvalDatasetResult {
  readonly datasetDir: string;
  readonly manifestPath: string;
  readonly manifest: EvalDatasetManifest;
  /** Routed PASS/FAIL tasks dropped because the log records no objective for them. */
  readonly skippedWithoutObjective: number;
  /** Earlier attempts of a task superseded by its final recorded outcome. */
  readonly supersededAttempts: number;
}

/**
 * Export the replay dataset `adapt eval --dataset` expects from one run's
 * recorded events.
 *
 * Everything written is derived from the run event log: task ids, the agent
 * role and task family the router recorded, the deterministic PASS/FAIL
 * verification outcome, the discovered project root, and a redacted excerpt of
 * the task objective. No prompts, tool payloads, model output, or bandit state
 * are read, and nothing here consults the live routing policy — the dataset is
 * an input to evaluation, not a product of it.
 *
 * Fails closed rather than inventing rows: a run with no project snapshot, no
 * routed PASS/FAIL outcome, or no recorded objective for any such task is
 * refused, because each of those would otherwise become a fabricated episode.
 */
export async function exportRoutingEvalDataset(
  input: ExportEvalDatasetInput,
  writeOptions: AtomicWriteOptions = {}
): Promise<ExportEvalDatasetResult> {
  const workspace = originalWorkspace(input.events);
  if (workspace === undefined) {
    throw new DomainValidationError("run has no project snapshot");
  }
  const objectives = objectivesByTaskId(input.events);
  const outcomes = outcomesFromRoutedRun(input.events);
  if (outcomes.length === 0) {
    throw new DomainValidationError(
      "run has no routed task with a recorded PASS or FAIL verification"
    );
  }

  const classes = new Set<RedactionClass>();
  const byTaskId = new Map<string, EvalDatasetEpisode>();
  let supersededAttempts = 0;
  let skippedWithoutObjective = 0;
  for (const outcome of outcomes) {
    const taskId = outcome.taskId;
    if (taskId === undefined) continue;
    if (outcome.outcome !== "PASS" && outcome.outcome !== "FAIL") continue;
    const objective = objectives.get(taskId);
    if (objective === undefined) {
      skippedWithoutObjective += 1;
      continue;
    }
    // Defensive narrowing: the routed-run reader only emits AgentRole values.
    if (!isAgentRole(outcome.role)) continue;
    const role: AgentRole = outcome.role;
    if (byTaskId.has(taskId)) supersededAttempts += 1;
    const scanned = redactSensitiveText(objective.slice(0, OBJECTIVE_MAX_CHARS));
    for (const cls of scanned.classes) classes.add(cls);
    byTaskId.set(taskId, {
      episodeHash: `eh_${hash32(stableStringify({ runId: input.runId, taskId }))}`,
      taskId,
      role,
      objective: scanned.text,
      taskFamily: outcome.taskFamily,
      taskSuccess: outcome.outcome,
      originalWorkspace: workspace
    });
  }

  const episodes = [...byTaskId.values()];
  if (episodes.length === 0) {
    throw new DomainValidationError(
      "run has routed PASS/FAIL outcomes but no recorded task objective to replay; nothing was written"
    );
  }

  const datasetDir =
    input.datasetDir ?? join(adaptationRoot(input.stateRoot), "eval-datasets", input.runId);
  assertDatasetIsolated(datasetDir, workspace);

  const manifest: EvalDatasetManifest = {
    datasetId: `ds-${input.runId}`,
    environmentVersion: environmentVersion(input.events),
    source: {
      kind: "run-event-log",
      runId: input.runId,
      exporterVersion: EVAL_DATASET_EXPORTER_VERSION,
      objectiveMaxChars: OBJECTIVE_MAX_CHARS,
      redactionPipe: "redactSensitiveText",
      redactionClasses: [...classes].sort()
    },
    episodes
  };
  const manifestPath = join(datasetDir, "manifest.json");
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, writeOptions);
  return { datasetDir, manifestPath, manifest, skippedWithoutObjective, supersededAttempts };
}

function originalWorkspace(events: readonly Event[]): string | undefined {
  let root: string | undefined;
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") root = event.payload.project.rootPath;
  }
  return root !== undefined && root.trim() !== "" ? root : undefined;
}

function objectivesByTaskId(events: readonly Event[]): Map<string, string> {
  const objectives = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "TASK_GRAPH_ACCEPTED") continue;
    for (const task of event.payload.tasks) {
      if (typeof task.objective === "string" && task.objective.trim() !== "") {
        objectives.set(task.id, task.objective);
      }
    }
  }
  return objectives;
}

/**
 * The versions the replay is reproducible against: the routing feature version
 * and the router policy version the run actually recorded. Both are internal
 * version strings, never user text, and both belong in the eval cacheKey — a
 * dataset captured under a different router must not silently reuse a report.
 */
function environmentVersion(events: readonly Event[]): string {
  const featureVersions = new Set<string>();
  const policyVersions = new Set<string>();
  for (const event of events) {
    if (event.type !== "MODEL_ROUTED") continue;
    if (event.payload.featureVersion.trim() !== "") featureVersions.add(event.payload.featureVersion);
    if (event.payload.policyVersion.trim() !== "") policyVersions.add(event.payload.policyVersion);
  }
  const feature = [...featureVersions].sort().join("+");
  const policy = [...policyVersions].sort().join("+");
  return `run-log:${feature === "" ? "unknown" : feature}:${policy === "" ? "unknown" : policy}`;
}

function assertDatasetIsolated(datasetDir: string, workspace: string): void {
  try {
    createIsolationGuard({ readOnlyRoots: [workspace], outputRoot: datasetDir });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError(
      `dataset dir must not overlap the recorded project workspace: ${detail}`
    );
  }
}

import { realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { RunId } from "../domain/ids.js";
import { redactSensitiveText, type RedactionClass } from "../feedback/redaction.js";
import { createIsolationGuard } from "../experiments/isolation.js";
import { stableStringify } from "../experiments/manifest.js";
import { writeFileAtomic, type AtomicWriteOptions } from "../persist/atomic-file.js";
import {
  assertDefaultEvalDatasetPublished,
  bindDefaultEvalDatasetDir
} from "../privacy/eval-dataset-path.js";
import { defaultEvalDatasetDir, runtimeRoot } from "../privacy/state-layout.js";
import type { Event } from "../run/events.js";
import { outcomesFromRoutedRun } from "./from-episode.js";

export const EVAL_DATASET_EXPORTER_VERSION = "adapt-dataset-v1";

/**
 * Objectives are user text. The manifest needs one because the replay re-runs
 * `assignTasks` over it, but it does not need the whole thing: a bounded
 * excerpt keeps the routing keywords (which lead the objective) while capping
 * how much task text a derived adaptation-plane file can ever hold.
 *
 * The excerpt is cut out of the *redacted* objective, never the raw one. Cutting
 * first was a leak: a truncation that lands inside a quoted secret leaves the
 * secret's opening quote unmatched, so neither the quoted nor the unquoted
 * keyed-secret rule fires and the fragment reaches disk unredacted.
 */
export const OBJECTIVE_MAX_CHARS = 500;

/** Owner-only: the manifest is redacted user text, not a shared artifact. */
const DATASET_FILE_MODE = 0o600;

/**
 * One routed task from one run — not an independent episode.
 *
 * The JSON key stays `episodes` because `adapt eval` parses `parsed.episodes`
 * and names that path in its errors, but the rows are the PASS/FAIL tasks of a
 * single run and `episodeHash` is `hash(runId, taskId)`. Counting them as
 * independent samples is pseudo-replication; this export is a routing/cost
 * replay fixture, not held-out validation evidence.
 */
export interface EvalDatasetEpisode {
  readonly episodeHash: string;
  readonly taskId: string;
  readonly role: AgentRole;
  /**
   * Redacted, bounded excerpt of the task objective. Regex redaction is
   * best-effort: this is still user text, and is classified as sensitive.
   */
  readonly objective: string;
  readonly taskFamily: string;
  readonly taskSuccess: "PASS" | "FAIL";
  /**
   * The same redacted value as `source.originalWorkspace`, copied per row so
   * `adapt eval`'s existing per-row reader keeps parsing. Best-effort redacted,
   * so it is sensitive too: a workspace path carries usernames, customer and
   * repository names, and organization layout.
   */
  readonly originalWorkspace: string;
}

export interface EvalDatasetManifest {
  readonly datasetId: string;
  readonly environmentVersion: string;
  readonly source: {
    readonly kind: "run-event-log";
    readonly runId: string;
    readonly exporterVersion: string;
    /** What one `episodes[]` row is, so no reader has to infer independence. */
    readonly rowKind: "routed-task-from-one-run";
    readonly objectiveMaxChars: number;
    readonly redactionPipe: "redactSensitiveText";
    readonly redactionClasses: readonly RedactionClass[];
    /** The run's project root, redacted once; every row repeats this value. */
    readonly originalWorkspace: string;
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
 * verification outcome, a redacted form of the discovered project root, and a
 * redacted excerpt of the task objective. No prompts, tool payloads, model
 * output, or bandit state are read, and nothing here consults the live routing
 * policy — the dataset is an input to evaluation, not a product of it.
 *
 * Both user-text fields go through `redactSensitiveText` *before* they are
 * bounded, and both remain sensitive afterwards: regex redaction is
 * best-effort, so `routing-eval-dataset` classifies `objective` and
 * `originalWorkspace` as sensitive fields rather than claiming the survivors
 * are clean.
 *
 * The rows are one run's routed tasks. They are written under the `episodes`
 * key because that is what the evaluator parses, not because they are
 * independent episodes.
 *
 * Fails closed rather than inventing rows: a run with no project snapshot, no
 * routed PASS/FAIL outcome, or no recorded objective for any such task is
 * refused, because each of those would otherwise become a fabricated row.
 *
 * A default export (no `datasetDir`) additionally binds its output directory
 * to the canonical `adaptation/eval-datasets/` root before it publishes, and
 * refuses outright when the `<runId>` leaf is a symlink — see
 * `src/privacy/eval-dataset-path.ts` for why writing through one produced a
 * derivative that `delete --run` could report as removed while it survived.
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
  const scannedWorkspace = redactSensitiveText(workspace);
  for (const cls of scannedWorkspace.classes) classes.add(cls);
  const redactedWorkspace = scannedWorkspace.text;
  if (redactedWorkspace.trim() === "") {
    throw new DomainValidationError("redacted project root is empty; refusing to export");
  }

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
    // Redact the whole objective, then excerpt the redacted text: excerpting
    // first can cut a secret in half and leave the half that survives
    // unmatchable by every rule that would have removed it.
    const scanned = redactSensitiveText(objective);
    for (const cls of scanned.classes) classes.add(cls);
    byTaskId.set(taskId, {
      episodeHash: `eh_${hash32(stableStringify({ runId: input.runId, taskId }))}`,
      taskId,
      role,
      objective: scanned.text.slice(0, OBJECTIVE_MAX_CHARS),
      taskFamily: outcome.taskFamily,
      taskSuccess: outcome.outcome,
      originalWorkspace: redactedWorkspace
    });
  }

  const episodes = [...byTaskId.values()];
  if (episodes.length === 0) {
    throw new DomainValidationError(
      "run has routed PASS/FAIL outcomes but no recorded task objective to replay; nothing was written"
    );
  }

  // A `--dir` export is the operator's own external path: warned about at the
  // command surface, never cascaded, and not bound to anything here. A default
  // export is a record of this state root, so its leaf has to be a directory
  // this state root owns rather than an alias the delete could only unlink.
  const isDefaultExport = input.datasetDir === undefined;
  const datasetDir = input.datasetDir ?? defaultEvalDatasetDir(input.stateRoot, input.runId);
  await assertDatasetIsolated(datasetDir, workspace, input.stateRoot);
  const bound = isDefaultExport
    ? await bindDefaultEvalDatasetDir(input.stateRoot, input.runId)
    : undefined;

  const manifest: EvalDatasetManifest = {
    datasetId: `ds-${input.runId}`,
    environmentVersion: environmentVersion(input.events),
    source: {
      kind: "run-event-log",
      runId: input.runId,
      exporterVersion: EVAL_DATASET_EXPORTER_VERSION,
      rowKind: "routed-task-from-one-run",
      objectiveMaxChars: OBJECTIVE_MAX_CHARS,
      redactionPipe: "redactSensitiveText",
      redactionClasses: [...classes].sort(),
      originalWorkspace: redactedWorkspace
    },
    episodes
  };
  const manifestPath = join(datasetDir, "manifest.json");
  // The manifest holds redacted user text, so it is published owner-only
  // rather than at whatever the process umask happens to allow.
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: DATASET_FILE_MODE,
    ...writeOptions
  });
  if (bound !== undefined) {
    try {
      await assertDefaultEvalDatasetPublished(input.stateRoot, input.runId, bound);
    } catch (error) {
      // The leaf stopped being the directory this export bound to between the
      // bind and the publish — swapped for an alias, or replaced by another
      // real directory at the same name — so these bytes are not where this
      // path says they are. Take back what this call wrote, best-effort:
      // `manifestPath` is lexical, so it reaches the bytes only while the
      // original directory is still there to be reached. Then fail, rather
      // than return a path that does not hold the manifest.
      await rm(manifestPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
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

/**
 * Two containment refusals, both on canonical paths.
 *
 * The dataset may not overlap the workspace it freezes (an evaluation input
 * must not be written into the source of truth it describes), and it may not
 * be written into `<stateRoot>/runtime/`: this is an adaptation-plane record,
 * and the plane layout's whole claim is that the two classes are never
 * co-located. `--dir` is the only way to aim at either, and a lexical
 * `path.resolve` comparison misses both through a symlink, so every path is
 * canonicalized first — for the dataset dir, which usually does not exist yet,
 * by canonicalizing its nearest existing ancestor.
 */
async function assertDatasetIsolated(
  datasetDir: string,
  workspace: string,
  stateRoot: string
): Promise<void> {
  const outputRoot = await canonicalPath(datasetDir);
  const refuse = (readOnlyRoot: string, describe: (detail: string) => string): void => {
    try {
      createIsolationGuard({ readOnlyRoots: [readOnlyRoot], outputRoot });
    } catch (error) {
      throw new DomainValidationError(
        describe(error instanceof Error ? error.message : String(error))
      );
    }
  };

  refuse(
    await canonicalPath(workspace),
    (detail) => `dataset dir must not overlap the recorded project workspace: ${detail}`
  );
  const runtimePlane = await canonicalPath(runtimeRoot(stateRoot));
  refuse(
    runtimePlane,
    (detail) =>
      `dataset dir must not be written into the runtime plane (${runtimePlane}); an exported dataset is an adaptation-plane record and the two are never co-located: ${detail}`
  );
}

/**
 * `path.resolve` plus symlink resolution, for a path that need not exist yet:
 * the nearest existing ancestor is resolved with `realpath` and the missing
 * tail is re-joined onto it. Falls back to the lexically resolved path when
 * even the filesystem root cannot be read.
 */
async function canonicalPath(target: string): Promise<string> {
  const resolved = resolve(target);
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length === 0 ? real : join(real, ...[...missing].reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolved;
      missing.push(basename(current));
      current = parent;
    }
  }
}

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { evalRoutingPolicy, parseRoutingEvalReport } from "../adaptation/eval-routing.js";
import {
  loadAdaptationRegistry,
  parsePromotionReview,
  promoteWithRegistry,
  saveAdaptationRegistry,
  withAdaptationRegistryLock
} from "../adaptation/promotion.js";
import type { PromoteInput } from "../adaptation/promotion.js";
import { rollbackActive, ROLLBACK_REASONS } from "../adaptation/rollback.js";
import type { RollbackReason } from "../adaptation/rollback.js";
import { DomainValidationError } from "../domain/errors.js";
import { isCandidateId, isResourceVersionId, parseRunId } from "../domain/ids.js";
import { exportRoutingEvalDataset } from "../learning/eval-dataset.js";
import { proposeRoutingFromRoutedEvents } from "../learning/from-episode.js";
import { runAutoAdaptFromEvents, runAutoAdaptLoop } from "../learning/auto-loop.js";
import { DEFAULT_PRIMARY_MODEL_ID } from "../routing/primary-catalog.js";
import { EventStore } from "../run/event-store.js";
import { discoverProject } from "../project/discovery.js";

export interface AdaptIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const ADAPT_USAGE = `pi-sparkle adapt — adaptation plane (proposal-first live runs; auto-loop after episodes)

Usage:
  pi-sparkle adapt status [--state-root <dir>]
  pi-sparkle adapt learn --run <runId> [--primary-model <id>] [--state-root <dir>]
  pi-sparkle adapt auto [--run <runId>] [--project <path>] [--primary-model <id>] [--state-root <dir>]
  pi-sparkle adapt show --candidate <cnd_...> [--content-file <path>] [--json] [--state-root <dir>]
  pi-sparkle adapt dataset --run <runId> [--dir <path>] [--state-root <dir>]
  pi-sparkle adapt eval --candidate <cnd_...> --dataset <dir> [--state-root <dir>]
  pi-sparkle adapt promote
  pi-sparkle adapt promote --candidate <cnd_...> --expected <rsv_...> --content-file <path> --review-file <path> --approve [--eval-file <path>] [--state-root <dir>]
  pi-sparkle adapt rollback --expected <rsv_...> --target <rsv_...> --reason <guardrail|degradation|user> [--state-root <dir>]

show and dataset are read-only: show never promotes, dataset never writes policy.

dataset exports one run's routed tasks as replay rows (manifest key "episodes",
because that is what eval reads) — they are one run's evidence, not independent
episodes, and the export is a routing/cost replay fixture rather than held-out
validation. Task objectives and the project root are redacted best-effort and
stay sensitive. The default export under adaptation/eval-datasets/<runId>/ is
removed by delete --run <runId>; a --dir export is external and is not.
`;

const PROMOTE_REFUSAL =
  "refusing to mutate live policy; promotion is compare-and-swap after explicit approval (M6-T5)\n";

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

export async function adaptCommand(args: string[], io: AdaptIo): Promise<number> {
  const [sub, ...rest] = args;
  const { values } = parseArgs({
    args: rest,
    options: {
      "state-root": { type: "string" },
      candidate: { type: "string" },
      dataset: { type: "string" },
      expected: { type: "string" },
      "content-file": { type: "string" },
      "review-file": { type: "string" },
      "eval-file": { type: "string" },
      approve: { type: "boolean" },
      scope: { type: "string" },
      evidence: { type: "string" },
      guardrails: { type: "string" },
      "approved-by": { type: "string" },
      target: { type: "string" },
      reason: { type: "string" },
      run: { type: "string" },
      "primary-model": { type: "string" },
      project: { type: "string" },
      dir: { type: "string" },
      json: { type: "boolean", default: false },
      "no-promote": { type: "boolean", default: false },
      confirm: { type: "boolean" }
    }
  });
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  switch (sub) {
    case "status":
      return await statusCommand(stateRoot, io);
    case "learn":
      return await learnCommand(values, stateRoot, io);
    case "auto":
      return await autoCommand(values, stateRoot, io);
    case "show":
      return await showCommand(values, stateRoot, io);
    case "dataset":
      return await datasetCommand(values, stateRoot, io);
    case "eval":
      return await evalCommand(values, stateRoot, io);
    case "promote":
      return await promoteCommand(values, stateRoot, io);
    case "rollback":
      return await rollbackCommand(values, stateRoot, io);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      io.stdout(ADAPT_USAGE);
      return sub === undefined ? 1 : 0;
    default:
      io.stderr(`Unknown adapt command: ${sub}\n`);
      io.stderr(ADAPT_USAGE);
      return 1;
  }
}

async function statusCommand(stateRoot: string, io: AdaptIo): Promise<number> {
  io.stdout(`Adaptation plane is proposal-first (ADR-004).\n`);
  io.stdout(`  state-root: ${stateRoot}\n`);
  io.stdout("  live runs execute immutable resource versions; they cannot rewrite policy.\n");
  io.stdout("  R0-equivalent static routing is live (flowchart ModelRouter + --track/--children assign).\n");
  io.stdout("  R1/bandit remain shadow-only until Checkpoint F holdout policy is approved.\n");
  io.stdout("  After each --track/--children run, auto-loop collects user + subagent feedback and may propose a routing-policy candidate.\n");
  io.stdout("  adapt auto never CAS-promotes; SPARKLE_AUTO_ADAPT=0 still collects. Use adapt promote --approve.\n");
  io.stdout("  CAS promotion exists and remains proposal-first; rollback is wired (automatic on guardrail).\n");
  try {
    const registry = await loadAdaptationRegistry(stateRoot);
    const proposed = registry.snapshot().candidates.filter((candidate) => candidate.status === "proposed");
    io.stdout(`  proposed candidates: ${proposed.length}\n`);
    for (const candidate of proposed) {
      io.stdout(
        `    ${candidate.candidateId} ${candidate.identity.kind}/${candidate.identity.name} parent=${candidate.parentVersionId}\n`
      );
    }
  } catch (error) {
    if (error instanceof DomainValidationError && /no registry snapshot/.test(error.message)) {
      io.stdout("  proposed candidates: 0 (no registry yet; run --track or adapt learn)\n");
    } else {
      throw error;
    }
  }
  return 0;
}

/**
 * Frozen `adapt show --json` contract. Additive changes only: consumers pin
 * `type` and `preview`. Not a domain Event (no `id`; `type` is outside the
 * Event union), and `preview: true` says so.
 *
 * `reviewActorId` is the whole reason this verb exists: `adapt promote`
 * requires a review whose `actorId` equals the candidate author's identity
 * string, and nothing else prints it.
 */
export interface AdaptShowJson {
  readonly type: "ADAPT_CANDIDATE";
  readonly preview: true;
  readonly candidateId: string;
  readonly kind: string;
  readonly name: string;
  readonly status: string;
  readonly authorKind: string;
  readonly authorIdentity: string;
  readonly reviewActorId: string;
  readonly contentHash: string;
  readonly contentBytes: number;
  readonly content: string;
  readonly contentFile: string | null;
  readonly parentVersionId: string;
  readonly activeVersionId: string | null;
}

/**
 * Read-only candidate inspection. It loads the registry, never writes it, and
 * has no path to promotion: the content it dumps is exactly what
 * `promote --content-file` must hash to, and the identity it prints is exactly
 * what the promotion review's `actorId` must be.
 */
async function showCommand(
  values: {
    candidate?: string | undefined;
    "content-file"?: string | undefined;
    json?: boolean | undefined;
  },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  if (values.candidate === undefined) {
    io.stderr("adapt show requires --candidate <cnd_...>\n");
    return 1;
  }
  if (!isCandidateId(values.candidate)) {
    io.stderr(`invalid candidate id: ${values.candidate}\n`);
    return 1;
  }
  const candidateId = values.candidate;
  const contentFile = values["content-file"];
  try {
    const registry = await loadAdaptationRegistry(stateRoot);
    const candidate = registry.getCandidate(candidateId);
    if (candidate === undefined) {
      io.stderr(`unknown candidate: ${candidateId}\n`);
      return 1;
    }
    const content = registry.getContent(candidate.contentHash);
    if (content === undefined) {
      io.stderr(
        `registry has no stored content for ${candidateId} (hash ${candidate.contentHash}); it cannot be promoted from this snapshot\n`
      );
      return 1;
    }
    if (contentFile !== undefined) {
      await writeFile(contentFile, content, "utf8");
    }
    const active = registry.getActiveVersion(candidate.identity);
    if (values.json === true) {
      const payload: AdaptShowJson = {
        type: "ADAPT_CANDIDATE",
        preview: true,
        candidateId,
        kind: candidate.identity.kind,
        name: candidate.identity.name,
        status: candidate.status,
        authorKind: candidate.author.kind,
        authorIdentity: candidate.author.identity,
        reviewActorId: candidate.author.identity,
        contentHash: candidate.contentHash,
        contentBytes: Buffer.byteLength(content, "utf8"),
        content,
        contentFile: contentFile ?? null,
        parentVersionId: candidate.parentVersionId,
        activeVersionId: active?.versionId ?? null
      };
      io.stdout(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    io.stdout(`candidate: ${candidateId}\n`);
    io.stdout(`kind: ${candidate.identity.kind}\n`);
    io.stdout(`name: ${candidate.identity.name}\n`);
    io.stdout(`status: ${candidate.status}\n`);
    io.stdout(`author: ${candidate.author.kind} ${candidate.author.identity}\n`);
    io.stdout(
      `review actorId: ${candidate.author.identity} (promote --review-file must carry this actorId, a different reviewerId, and reviewerKind peer or independent)\n`
    );
    io.stdout(`contentHash: ${candidate.contentHash}\n`);
    io.stdout(`parent version: ${candidate.parentVersionId}\n`);
    io.stdout(
      `active version: ${active?.versionId ?? "(none)"}${active !== undefined ? " (promote --expected)" : ""}\n`
    );
    io.stdout(`content bytes: ${String(Buffer.byteLength(content, "utf8"))}\n`);
    if (contentFile !== undefined) {
      io.stdout(`content file: ${contentFile}\n`);
      return 0;
    }
    io.stdout("--- content ---\n");
    io.stdout(content.endsWith("\n") ? content : `${content}\n`);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}

/**
 * Export the replay dataset `adapt eval --dataset` consumes from one run's
 * recorded events. Writes the dataset directory and nothing else: no registry
 * mutation, no bandit file, no policy.
 *
 * The rows are that run's routed tasks. They are written under the manifest's
 * `episodes` key because that is what the evaluator reads, and they are not
 * independent episodes — five tasks from one run are one run's evidence.
 *
 * Default exports land under `adaptation/eval-datasets/<runId>/` and
 * `delete --run` removes them with the run. A `--dir` export is an external
 * copy of redacted user text that nothing records, so it is warned about here
 * instead of being promised a cascade that cannot find it.
 */
async function datasetCommand(
  values: { run?: string | undefined; dir?: string | undefined },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  if (values.run === undefined) {
    io.stderr("adapt dataset requires --run <runId>\n");
    return 1;
  }
  try {
    const runId = parseRunId(values.run);
    const read = await new EventStore(stateRoot, runId).readAll();
    if (read.events.length === 0) {
      io.stderr(`no events recorded for run ${runId} under ${stateRoot}\n`);
      return 1;
    }
    const result = await exportRoutingEvalDataset({
      stateRoot,
      runId,
      events: read.events,
      ...(values.dir !== undefined ? { datasetDir: values.dir } : {})
    });
    if (result.skippedWithoutObjective > 0) {
      const tasks = result.skippedWithoutObjective === 1 ? "task" : "tasks";
      io.stderr(
        `warning: ${result.skippedWithoutObjective} routed PASS/FAIL ${tasks} had no recorded objective and were left out\n`
      );
    }
    if (values.dir !== undefined) {
      io.stderr(
        `warning: ${result.datasetDir} is an external export and is NOT cascaded by delete --run ${runId}; only the default adaptation/eval-datasets/${runId}/ export is. It holds redacted task text and a redacted project root — delete it yourself when you are done with it.\n`
      );
    }
    io.stdout(`${result.datasetDir}\n`);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}

async function evalCommand(
  values: { candidate?: string | undefined; dataset?: string | undefined },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  if (values.candidate === undefined || values.dataset === undefined) {
    io.stderr("adapt eval requires --candidate and --dataset\n");
    return 1;
  }
  if (!isCandidateId(values.candidate)) {
    io.stderr(`invalid candidate id: ${values.candidate}\n`);
    return 1;
  }
  try {
    const result = await evalRoutingPolicy({
      stateRoot,
      candidateId: values.candidate,
      datasetDir: values.dataset
    });
    io.stdout(`${result.reportPath}\n`);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}

async function learnCommand(
  values: { run?: string | undefined; "primary-model"?: string | undefined },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  if (values.run === undefined) {
    io.stderr("adapt learn requires --run <runId>\n");
    return 1;
  }
  const runId = parseRunId(values.run);
  const primaryModelId = values["primary-model"] ?? process.env.PI_MODEL ?? DEFAULT_PRIMARY_MODEL_ID;
  const result = await proposeRoutingFromRoutedEvents({ stateRoot, runId, primaryModelId });
  io.stdout(`${result.reason}${result.candidateId !== undefined ? ` (${result.candidateId})` : ""}\n`);
  return result.created || result.reason !== "run has no project snapshot" ? 0 : 1;
}

async function autoCommand(
  values: {
    run?: string | undefined;
    project?: string | undefined;
    "primary-model"?: string | undefined;
    "no-promote"?: boolean | undefined;
  },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  const primaryModelId = values["primary-model"] ?? process.env.PI_MODEL ?? DEFAULT_PRIMARY_MODEL_ID;
  if (values.run !== undefined) {
    const runId = parseRunId(values.run);
    const store = new EventStore(stateRoot, runId);
    const read = await store.readAll();
    const result = await runAutoAdaptFromEvents({
      stateRoot,
      events: read.events,
      primaryModelId,
      ...(values.project !== undefined ? { projectRoot: values.project } : {}),
      autoPromote: false
    });
    io.stdout(
      `${result.reason} collected=${result.collected} promoted=${String(result.promoted)}${result.candidateId !== undefined ? ` (${result.candidateId})` : ""}\n`
    );
    return result.reason === "run has no project snapshot" ? 1 : 0;
  }
  if (values.project === undefined) {
    io.stderr("adapt auto requires --run <runId> and/or --project <path>\n");
    return 1;
  }
  const project = await discoverProject(values.project);
  const result = await runAutoAdaptLoop({
    stateRoot,
    projectRoot: values.project,
    projectId: project.id,
    primaryModelId,
    autoPromote: false
  });
  io.stdout(
    `${result.reason} collected=${result.collected} promoted=${String(result.promoted)}${result.candidateId !== undefined ? ` (${result.candidateId})` : ""}\n`
  );
  return 0;
}

async function promoteCommand(
  values: {
    candidate?: string | undefined;
    expected?: string | undefined;
    "content-file"?: string | undefined;
    "review-file"?: string | undefined;
    "eval-file"?: string | undefined;
    approve?: boolean | undefined;
    scope?: string | undefined;
    evidence?: string | undefined;
    guardrails?: string | undefined;
    "approved-by"?: string | undefined;
  },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  const flagged =
    values.candidate !== undefined ||
    values.expected !== undefined ||
    values["content-file"] !== undefined ||
    values["review-file"] !== undefined ||
    values.approve === true;
  if (!flagged || values.approve !== true) {
    io.stderr(PROMOTE_REFUSAL);
    return 1;
  }
  if (
    values.candidate === undefined ||
    values.expected === undefined ||
    values["content-file"] === undefined
  ) {
    io.stderr("promote requires --candidate, --expected, and --content-file\n");
    return 1;
  }
  if (!isCandidateId(values.candidate)) {
    io.stderr(`invalid candidate id: ${values.candidate}\n`);
    return 1;
  }
  if (!isResourceVersionId(values.expected)) {
    io.stderr(`invalid expected version id: ${values.expected}\n`);
    return 1;
  }
  if (values["review-file"] === undefined) {
    io.stderr("promote requires --review-file with persisted independent review provenance\n");
    return 1;
  }

  const candidateId = values.candidate;
  const expectedVersionId = values.expected;
  const contentFile = values["content-file"];
  const reviewFile = values["review-file"];
  const evalFile = values["eval-file"];
  try {
    const content = await readFile(contentFile, "utf8");
    let reviewValue: unknown;
    try {
      reviewValue = JSON.parse(await readFile(reviewFile, "utf8")) as unknown;
    } catch (error: unknown) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") throw error;
      throw new DomainValidationError(`invalid promotion review JSON at ${reviewFile}`);
    }
    const review = parsePromotionReview(reviewValue);
    let evalReport: ReturnType<typeof parseRoutingEvalReport> | undefined;
    if (evalFile !== undefined) {
      let evalValue: unknown;
      try {
        evalValue = JSON.parse(await readFile(evalFile, "utf8")) as unknown;
      } catch (error: unknown) {
        const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "ENOENT") throw error;
        throw new DomainValidationError(`invalid eval report JSON at ${evalFile}`);
      }
      evalReport = parseRoutingEvalReport(evalValue);
    }
    const result = await withAdaptationRegistryLock(stateRoot, async () => {
      const registry = await loadAdaptationRegistry(stateRoot);
      const candidate = registry.getCandidate(candidateId);
      if (candidate === undefined) {
        throw new DomainValidationError(`unknown candidate: ${candidateId}`);
      }
      if (candidate.identity.kind === "routing-policy" && evalReport === undefined) {
        throw new DomainValidationError("routing-policy promote requires --eval-file");
      }
      const input: PromoteInput = {
        candidateId,
        expectedCurrentVersionId: expectedVersionId,
        content,
        approvedBy: {
          kind: "human",
          identity: values["approved-by"] ?? "cli-user"
        },
        review,
        changeNote: {
          scope: values.scope ?? "cli-promote",
          evidence: [values.evidence ?? "explicit CLI --approve"],
          guardrails: [values.guardrails ?? "proposal-first"],
          rollbackVersionId: expectedVersionId
        },
        explicitApproval: true,
        ...(evalReport !== undefined ? { evalReport } : {})
      };
      const promoted = promoteWithRegistry(registry, input);
      if (promoted.ok && promoted.newVersion !== undefined) {
        await saveAdaptationRegistry(stateRoot, registry);
      }
      return promoted;
    });
    if (!result.ok || result.newVersion === undefined) {
      io.stderr("promotion failed; live policy was not mutated\n");
      return 1;
    }
    io.stdout(
      `promoted ${candidateId} -> ${result.newVersion.versionId} (rollback ${expectedVersionId})\n`
    );
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DomainValidationError) {
      io.stderr(`${message}\n`);
      return 1;
    }
    const code =
      error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      io.stderr(
        `content, review, or eval file not found: ${contentFile}, ${reviewFile}${evalFile !== undefined ? `, ${evalFile}` : ""}\n`
      );
      return 1;
    }
    io.stderr(`${message}\n`);
    return 1;
  }
}

const ROLLBACK_REASON_VALUES: readonly string[] = ROLLBACK_REASONS;

function isRollbackReason(value: string): value is RollbackReason {
  return ROLLBACK_REASON_VALUES.includes(value);
}

async function rollbackCommand(
  values: {
    expected?: string | undefined;
    target?: string | undefined;
    reason?: string | undefined;
    evidence?: string | undefined;
    confirm?: boolean | undefined;
  },
  stateRoot: string,
  io: AdaptIo
): Promise<number> {
  if (values.expected === undefined || values.target === undefined || values.reason === undefined) {
    io.stderr("rollback requires --expected, --target, and --reason\n");
    return 1;
  }
  if (!isResourceVersionId(values.expected)) {
    io.stderr(`invalid expected version id: ${values.expected}\n`);
    return 1;
  }
  if (!isResourceVersionId(values.target)) {
    io.stderr(`invalid target version id: ${values.target}\n`);
    return 1;
  }
  if (!isRollbackReason(values.reason)) {
    io.stderr(`invalid rollback reason: ${values.reason}\n`);
    return 1;
  }
  const reason = values.reason;
  const expectedVersionId = values.expected;
  const targetVersionId = values.target;

  try {
    const result = await withAdaptationRegistryLock(stateRoot, async () => {
      const registry = await loadAdaptationRegistry(stateRoot);
      const expectedVersion = registry.getVersion(expectedVersionId);
      const targetVersion = registry.getVersion(targetVersionId);
      const identity = expectedVersion?.identity ?? targetVersion?.identity;
      if (identity === undefined) {
        throw new DomainValidationError(`unknown rollback version: ${expectedVersionId}`);
      }
      const rolledBack = rollbackActive(registry, {
        identity,
        expectedCurrentVersionId: expectedVersionId,
        targetVersionId,
        reason,
        automatic: reason === "guardrail",
        evidence: [values.evidence ?? `cli-rollback:${reason}`],
        ...(values.confirm === true ? { confirm: true } : {})
      });
      await saveAdaptationRegistry(stateRoot, registry);
      return rolledBack;
    });
    if (!result.ok) {
      io.stdout(
        `rollback proposed ${expectedVersionId} -> ${targetVersionId} (pointer unchanged)\n`
      );
      return 0;
    }
    io.stdout(`rolled back ${expectedVersionId} -> ${result.active.versionId} (${reason})\n`);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}

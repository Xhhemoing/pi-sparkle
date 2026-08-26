import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { isRunId, parseRunId, type RunId } from "../domain/ids.js";
import { CheckpointStore } from "../run/checkpoint-store.js";
import { EventStore } from "../run/event-store.js";
import { validateCheckpoint, type RunCheckpoint } from "../run/replay.js";
import {
  assembleDecisionCommitInput,
  filterDecisionCommitNodeIds,
  formatCommitMessage,
  generateDecisionCommits,
  gitCommitArgs,
  parseCommitNodeIdsCsv,
  parseDecisionCommitFile,
  type DecisionCommitInput,
  type DecisionCommitProposal
} from "../tools/decision-commit.js";
import { CLI_EXIT, cliFail, errorCodeOf, warnTruncatedJsonl } from "./errors.js";

export interface CommitsIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const COMMITS_USAGE = `pi-sparkle commits — decision ledger to conventional commits

Usage:
  pi-sparkle commits preview --run <runId> [--state-root <dir>] [--json] [--nodes <id,id>]
  pi-sparkle commits apply --run <runId> [--state-root <dir>] [--repo <path>] [--file <edited.json>] [--sign] [--nodes <id,id>]

preview --json prints one COMMITS_PREVIEW object; apply --file accepts that output, with or without the type/preview keys.
`;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

/**
 * Whether a failure is a plain domain judgement this command may re-report as
 * its own refusal.
 *
 * A coded failure — ENOTDIR on a file used as `--state-root`, EISDIR on a
 * checkpoint path that is a directory, EACCES, the lock family — is an
 * environment fault `main.ts` already routes, so it is rethrown untouched.
 */
function isUncodedDomainFault(error: unknown): error is DomainValidationError {
  return error instanceof DomainValidationError && errorCodeOf(error) === undefined;
}

/**
 * The four stored-ledger faults below all used to reach `main.ts`'s generic
 * catch, whose one remedy is `pi-sparkle doctor`. Doctor inventories run event
 * logs, not checkpoint files, so it answers none of them: a root holding a
 * deleted and a corrupt `checkpoint.json` passes every doctor check and never
 * prints the word `checkpoint`. Each refusal keeps the store's or the commit
 * plane's message bytes — those name the file and the reason — and replaces
 * only the remedy.
 *
 * `runId` is safe to interpolate into a printed command: `isRunId` has already
 * constrained it to `run_` plus 1–64 `[A-Za-z0-9_-]` characters. The state root
 * is arbitrary operator text, so these remedies say "the same --state-root"
 * rather than pasting it into a line that looks copy-paste safe.
 */
function refuseAbsentCheckpoint(io: CommitsIo, runId: RunId): void {
  cliFail(io, {
    command: "commits",
    stage: "lookup",
    message: `Run ${runId} has no durable checkpoint`,
    next:
      "this run recorded events but no durable checkpoint; " +
      `pi-sparkle inspect --run ${runId} using the same --state-root shows its status — ` +
      "only checkpointed runs have a decision ledger",
    runId
  });
}

function refuseCorruptCheckpoint(io: CommitsIo, error: DomainValidationError, runId: RunId): void {
  cliFail(io, {
    command: "commits",
    stage: "validation",
    message: error.message,
    next:
      "repair or move aside the checkpoint file named above, then retry; " +
      "pi-sparkle doctor does not inventory checkpoint files",
    runId
  });
}

function refuseNonFlowchartCheckpoint(io: CommitsIo, error: DomainValidationError, runId: RunId): void {
  cliFail(io, {
    command: "commits",
    stage: "validation",
    message: error.message,
    next:
      "decision commits are generated from a flowchart run's checkpoint; " +
      "this run was not started with run --flowchart, so it has no decision ledger",
    runId
  });
}

/**
 * Having no completed node is a fact about the run's progress, not a fault of
 * the tree. It fires only after `filterDecisionCommitNodeIds`, so an unknown
 * `--nodes` id keeps its own earlier refusal.
 */
function refuseNoProposals(io: CommitsIo, error: DomainValidationError, runId: RunId): number {
  return cliFail(io, {
    command: "commits",
    stage: "validation",
    message: error.message,
    next:
      `pi-sparkle inspect --run ${runId} using the same --state-root lists its nodes; ` +
      "commit proposals exist only for COMPLETED nodes",
    runId
  });
}

async function loadCommitInput(
  stateRoot: string,
  runId: RunId,
  io: CommitsIo
): Promise<{ checkpoint: RunCheckpoint; input: DecisionCommitInput } | undefined> {
  // Outside every catch below: a corrupt *event log* is the one family in this
  // command doctor genuinely inventories, so it keeps main's doctor remedy.
  const read = await new EventStore(stateRoot, runId).readAll();
  warnTruncatedJsonl(io, read.recovery, "event log");
  if (read.events.length === 0) {
    // The house run-not-found remedy, copied rather than imported: `main.ts`
    // imports this module, so reaching back for `missingRun` would be a cycle.
    cliFail(io, {
      command: "commits",
      stage: "lookup",
      message: `Run ${runId} not found under ${stateRoot}`,
      next: `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there`,
      runId
    });
    return undefined;
  }
  let checkpoint: RunCheckpoint;
  try {
    const raw = await new CheckpointStore(stateRoot, runId).read();
    if (raw === undefined) {
      // `read()` maps checkpoint ENOENT to `undefined`, so this is an absent
      // stored record — the same class as a `--file` that is not there.
      refuseAbsentCheckpoint(io, runId);
      return undefined;
    }
    checkpoint = validateCheckpoint(raw);
  } catch (error) {
    if (!isUncodedDomainFault(error)) throw error;
    refuseCorruptCheckpoint(io, error, runId);
    return undefined;
  }
  let input: DecisionCommitInput;
  try {
    input = assembleDecisionCommitInput(checkpoint, read.events, runId);
  } catch (error) {
    if (!isUncodedDomainFault(error)) throw error;
    refuseNonFlowchartCheckpoint(io, error, runId);
    return undefined;
  }
  return { checkpoint, input };
}

/**
 * `filteredIds` is already through `filterDecisionCommitNodeIds`: the unknown-id
 * refusal belongs to the flag that named them, so each command body runs that
 * filter under its own catch and hands the survivors here.
 */
function proposalsFromInput(
  loaded: { checkpoint: RunCheckpoint; input: DecisionCommitInput },
  filteredIds: readonly string[] | undefined,
  fileProposals: DecisionCommitProposal[] | undefined
): DecisionCommitProposal[] {
  if (fileProposals !== undefined) {
    if (filteredIds === undefined) return fileProposals;
    const selected = new Set(filteredIds);
    const selectedProposals = fileProposals.filter((proposal) => selected.has(proposal.nodeId));
    if (selectedProposals.length === 0) {
      throw new DomainValidationError("no completed nodes to commit");
    }
    return selectedProposals;
  }
  return generateDecisionCommits(
    filteredIds === undefined ? loaded.input : { ...loaded.input, nodeIds: filteredIds }
  );
}

function isGitWorkTree(repo: string): { ok: true } | { ok: false; detail: string } {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error !== undefined) {
    return { ok: false, detail: result.error.message };
  }
  if (result.status === 0 && result.stdout.trim() === "true") return { ok: true };
  const detail = (result.stderr.trim() || result.stdout.trim() || "not a git work tree").trim();
  return { ok: false, detail };
}

function applyProposal(
  repo: string,
  proposal: DecisionCommitProposal,
  sign: boolean,
  io: CommitsIo
): boolean {
  const args = gitCommitArgs(proposal, { sign });
  const result = spawnSync("git", [...args], {
    cwd: repo,
    encoding: "utf8",
    input: `${formatCommitMessage(proposal)}\n`,
    windowsHide: true
  });
  if (result.error !== undefined) {
    io.stderr(`${result.error.message}\n`);
    return false;
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim() === "" ? result.stdout : result.stderr;
    io.stderr(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    return false;
  }
  return true;
}

/**
 * Whether `--nodes <csv>` can name exactly these ids and nothing else.
 *
 * Flowchart node ids are only required to be non-empty, so a valid id may
 * carry a comma or outer whitespace that `parseCommitNodeIdsCsv` would split
 * or trim away. Asking the CSV parser to reproduce the list is the check;
 * narrowing the id grammar to make the command always printable would reject
 * flowcharts the runtime accepts today.
 */
function nodesCsvSelectsExactly(nodeIds: readonly string[]): boolean {
  const parsed = parseCommitNodeIdsCsv(nodeIds.join(","));
  return parsed !== undefined && parsed.length === nodeIds.length && parsed.every((id, index) => id === nodeIds[index]);
}

/**
 * What `apply` owes an operator when commit *k* of *n* fails: the commits
 * already in their history are real, this command cannot take them back, and
 * the obvious reflex — rerunning the same command — would create them a second
 * time. The count and the not-yet-created ids are always disclosed.
 *
 * The recovery command is only printed when it provably cannot replay the
 * prefix. `--nodes` re-derives its selection from the checkpoint, so it is
 * offered for generated proposals whose remaining ids survive the CSV
 * round-trip and never for `--file` input, which may repeat a `nodeId` (the
 * filter would then select the created proposal too) or name one the
 * checkpoint does not know (the filter would refuse the whole rerun).
 */
function partialApplyNote(
  proposals: readonly DecisionCommitProposal[],
  created: number,
  repo: string,
  fromFile: boolean
): string {
  const remaining = proposals.slice(created);
  const remainingIds = remaining.map((proposal) => proposal.nodeId);
  const head =
    `note: ${created} of ${proposals.length} proposed commits were already created in ${repo} before this failure; ` +
    `re-running apply would create them again — the commits not yet created are for node ids ${remainingIds.join(", ")}`;
  if (!fromFile && nodesCsvSelectsExactly(remainingIds)) {
    return `${head}; pass --nodes ${remainingIds.join(",")} to apply only those\n`;
  }
  return (
    `${head}; write just those proposals to a new file as { "commits": [...] } and rerun apply with --file on that ` +
    `file — do not rerun an input that still contains the first ${created}\n`
  );
}

function refuseMalformedRun(io: CommitsIo, run: string, stateRoot: string): number {
  return cliFail(io, {
    command: "commits",
    stage: "parse-args",
    message: `invalid --run "${run}": expected a run id of the form run_<suffix>`,
    next: `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}`,
    runId: run
  });
}

/**
 * An explicitly blank `--state-root` is what an unset shell variable leaves
 * behind (`--state-root "$SR"`), and resolving it aimed the ledger read at a
 * cwd-relative tree: the operator got `Run … not found under ` about the root
 * they meant, with a remedy whose `list --state-root ` swallowed the next word.
 * Both subcommands check it before their own root assignment.
 *
 * The remedy names the flag rather than echoing the value back into a line
 * that looks copy-paste safe.
 */
function refuseBlankStateRoot(io: CommitsIo, raw: string): number {
  return cliFail(io, {
    command: "commits",
    stage: "parse-args",
    message: `invalid --state-root "${raw}": state root must be a non-empty directory path`,
    next: "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle"
  });
}

/**
 * `parseCommitNodeIdsCsv` trims and drops blanks, so a CSV of nothing but
 * commas selects no ids at all. Left to the filter it would sail through as
 * "select everything named here" and the run would be blamed for having no
 * completed nodes; the mistake is in argv, so it refuses before state is read.
 */
function refuseEmptyNodes(io: CommitsIo, nodes: string): number {
  return cliFail(io, {
    command: "commits",
    stage: "parse-args",
    message: `invalid --nodes "${nodes}": selects no node ids`,
    next: "pass --nodes <id,id> or drop the flag to use every completed node"
  });
}

/**
 * Which ids exist is run state, not CLI knowledge, so the stage stays
 * `validation` — but the remedy names the flag and the command that lists the
 * ids, not doctor preflight.
 */
function refuseUnknownNodes(io: CommitsIo, error: unknown, runId: RunId, stateRoot: string): number {
  return cliFail(io, {
    command: "commits",
    stage: "validation",
    message: error instanceof Error ? error.message : String(error),
    next:
      "pass --nodes ids from this run's flowchart; " +
      `pi-sparkle inspect --run ${runId} --state-root ${stateRoot} lists its nodes`,
    runId
  });
}

async function previewCommand(args: string[], io: CommitsIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        run: { type: "string" },
        "state-root": { type: "string" },
        json: { type: "boolean", default: false },
        nodes: { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle commits --help"
    });
  }
  if (values.help === true) {
    io.stdout(COMMITS_USAGE);
    return CLI_EXIT.ok;
  }
  if (values.run === undefined) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: "commits preview requires --run <runId>",
      next: "pass --run <runId>"
    });
  }
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return refuseBlankStateRoot(io, rawStateRoot);
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  if (!isRunId(values.run)) return refuseMalformedRun(io, values.run, stateRoot);
  const nodeIds = parseCommitNodeIdsCsv(values.nodes);
  if (values.nodes !== undefined && nodeIds?.length === 0) return refuseEmptyNodes(io, values.nodes);
  const runId = parseRunId(values.run);
  const loaded = await loadCommitInput(stateRoot, runId, io);
  if (loaded === undefined) return CLI_EXIT.error;
  const knownIds = loaded.checkpoint.flowchart?.definition.nodes.map((node) => node.id) ?? [];
  let filteredIds: readonly string[] | undefined;
  try {
    filteredIds = filterDecisionCommitNodeIds(knownIds, nodeIds);
  } catch (error) {
    return refuseUnknownNodes(io, error, runId, stateRoot);
  }
  let proposals: DecisionCommitProposal[];
  try {
    proposals = proposalsFromInput(loaded, filteredIds, undefined);
  } catch (error) {
    if (!isUncodedDomainFault(error)) throw error;
    return refuseNoProposals(io, error, runId);
  }
  if (values.json === true) {
    // `preview: true` is the developer-preview marker every machine surface
    // carries, not a restatement of the `preview` subcommand; COMMITS_PREVIEW
    // is a CLI view object, never an Event.
    io.stdout(`${JSON.stringify({ type: "COMMITS_PREVIEW", preview: true, commits: proposals })}\n`);
    return 0;
  }
  io.stdout(`${proposals.map(formatCommitMessage).join("\n\n")}\n`);
  return 0;
}

async function applyCommand(args: string[], io: CommitsIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        run: { type: "string" },
        "state-root": { type: "string" },
        repo: { type: "string" },
        file: { type: "string" },
        sign: { type: "boolean", default: false },
        nodes: { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle commits --help"
    });
  }
  if (values.help === true) {
    io.stdout(COMMITS_USAGE);
    return CLI_EXIT.ok;
  }
  if (values.run === undefined) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: "commits apply requires --run <runId>",
      next: "pass --run <runId>"
    });
  }
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return refuseBlankStateRoot(io, rawStateRoot);
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  if (!isRunId(values.run)) return refuseMalformedRun(io, values.run, stateRoot);
  const runId = parseRunId(values.run);
  // A supplied blank `--repo` is an argv fault, not a missing environment: the
  // checkpoint fallback below answers only for the flag the operator omitted.
  if (values.repo !== undefined && values.repo.trim() === "") {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: `invalid --repo "${values.repo}": repository path must be a non-empty string`,
      next: "pass --repo <path to a git work tree> or omit it to use checkpoint project.rootPath",
      runId
    });
  }
  const nodeIds = parseCommitNodeIdsCsv(values.nodes);
  if (values.nodes !== undefined && nodeIds?.length === 0) return refuseEmptyNodes(io, values.nodes);
  const loaded = await loadCommitInput(stateRoot, runId, io);
  if (loaded === undefined) return CLI_EXIT.error;
  let fileProposals: DecisionCommitProposal[] | undefined;
  if (values.file !== undefined) {
    let raw: string;
    try {
      raw = await readFile(values.file, "utf8");
    } catch (error) {
      return cliFail(io, {
        command: "commits",
        stage: "lookup",
        message: `cannot read --file ${values.file}: ${error instanceof Error ? error.message : String(error)}`,
        next: "check the --file path; commits preview --json writes an input this flag accepts",
        runId
      });
    }
    try {
      fileProposals = parseDecisionCommitFile(raw);
    } catch (error) {
      return cliFail(io, {
        command: "commits",
        stage: "validation",
        message: `${values.file}: ${error instanceof Error ? error.message : String(error)}`,
        next: `fix ${values.file} or regenerate it with commits preview --json`,
        runId
      });
    }
  }
  const knownIds = loaded.checkpoint.flowchart?.definition.nodes.map((node) => node.id) ?? [];
  let filteredIds: readonly string[] | undefined;
  try {
    filteredIds = filterDecisionCommitNodeIds(knownIds, nodeIds);
  } catch (error) {
    return refuseUnknownNodes(io, error, runId, stateRoot);
  }
  let proposals: DecisionCommitProposal[];
  try {
    proposals = proposalsFromInput(loaded, filteredIds, fileProposals);
  } catch (error) {
    if (!isUncodedDomainFault(error)) throw error;
    return refuseNoProposals(io, error, runId);
  }
  const repo = values.repo ?? loaded.checkpoint.project?.rootPath;
  if (repo === undefined || repo.trim() === "") {
    // The flag was omitted (a blank one already refused as argv) and the
    // checkpoint names no project: an absent work tree is an environment fault,
    // not a claim about the run.
    return cliFail(io, {
      command: "commits",
      stage: "preflight",
      message: "apply requires --repo or a checkpoint project.rootPath",
      next: "pass --repo <path to a git work tree>",
      runId
    });
  }
  const workTree = isGitWorkTree(repo);
  if (!workTree.ok) {
    return cliFail(io, {
      command: "commits",
      stage: "preflight",
      message: `apply requires a git work tree at ${repo}: ${workTree.detail}`,
      next: `run git init in ${repo} or pass --repo <git work tree>`,
      runId
    });
  }
  for (const [index, proposal] of proposals.entries()) {
    if (!applyProposal(repo, proposal, values.sign === true, io)) {
      // Rewriting the operator's git history would be a far larger claim than
      // the one that just failed, so the disclosure is the whole remedy.
      if (index > 0) {
        io.stderr(partialApplyNote(proposals, index, repo, fileProposals !== undefined));
      }
      return 1;
    }
    io.stdout(`Committed ${proposal.type}(${proposal.scope}): ${proposal.subject}\n`);
  }
  return 0;
}

export async function commitsCommand(args: string[], io: CommitsIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "preview":
      return await previewCommand(rest, io);
    case "apply":
      return await applyCommand(rest, io);
    case "help":
    case "--help":
    case "-h":
      io.stdout(COMMITS_USAGE);
      return 0;
    case undefined:
      io.stderr(COMMITS_USAGE);
      return cliFail(io, {
        command: "commits",
        stage: "parse-args",
        message: "commits requires a subcommand: preview or apply",
        next: "use commits preview or commits apply"
      });
    default:
      io.stderr(COMMITS_USAGE);
      return cliFail(io, {
        command: "commits",
        stage: "parse-args",
        message: `Unknown commits command: ${sub}`,
        next: "use commits preview or commits apply"
      });
  }
}

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId, type RunId } from "../domain/ids.js";
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
import { CLI_EXIT, cliFail, warnTruncatedJsonl } from "./errors.js";

export interface CommitsIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const COMMITS_USAGE = `pi-sparkle commits — decision ledger to conventional commits

Usage:
  pi-sparkle commits preview --run <runId> [--state-root <dir>] [--json] [--nodes <id,id>]
  pi-sparkle commits apply --run <runId> [--state-root <dir>] [--repo <path>] [--file <edited.json>] [--sign] [--nodes <id,id>]

preview --json prints one COMMITS_PREVIEW object; apply --file accepts that output, with or without the type/preview keys.
`;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

async function loadCommitInput(
  stateRoot: string,
  runId: RunId,
  io: CommitsIo
): Promise<{ checkpoint: RunCheckpoint; input: DecisionCommitInput } | undefined> {
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
  const raw = await new CheckpointStore(stateRoot, runId).read();
  if (raw === undefined) {
    throw new DomainValidationError(`Run ${runId} has no durable checkpoint`);
  }
  const checkpoint = validateCheckpoint(raw);
  return { checkpoint, input: assembleDecisionCommitInput(checkpoint, read.events, runId) };
}

function proposalsFromInput(
  loaded: { checkpoint: RunCheckpoint; input: DecisionCommitInput },
  nodeIds: readonly string[] | undefined,
  fileProposals: DecisionCommitProposal[] | undefined
): DecisionCommitProposal[] {
  const knownIds = loaded.checkpoint.flowchart?.definition.nodes.map((node) => node.id) ?? [];
  const filteredIds = filterDecisionCommitNodeIds(knownIds, nodeIds);
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

async function previewCommand(args: string[], io: CommitsIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "state-root": { type: "string" },
      json: { type: "boolean", default: false },
      nodes: { type: "string" }
    }
  });
  if (values.run === undefined) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: "commits preview requires --run <runId>",
      next: "pass --run <runId>"
    });
  }
  const loaded = await loadCommitInput(values["state-root"] ?? defaultStateRoot(), parseRunId(values.run), io);
  if (loaded === undefined) return CLI_EXIT.error;
  const proposals = proposalsFromInput(loaded, parseCommitNodeIdsCsv(values.nodes), undefined);
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
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "state-root": { type: "string" },
      repo: { type: "string" },
      file: { type: "string" },
      sign: { type: "boolean", default: false },
      nodes: { type: "string" }
    }
  });
  if (values.run === undefined) {
    return cliFail(io, {
      command: "commits",
      stage: "parse-args",
      message: "commits apply requires --run <runId>",
      next: "pass --run <runId>"
    });
  }
  const loaded = await loadCommitInput(values["state-root"] ?? defaultStateRoot(), parseRunId(values.run), io);
  if (loaded === undefined) return CLI_EXIT.error;
  const fileProposals =
    values.file !== undefined ? parseDecisionCommitFile(await readFile(values.file, "utf8")) : undefined;
  const proposals = proposalsFromInput(loaded, parseCommitNodeIdsCsv(values.nodes), fileProposals);
  const repo = values.repo ?? loaded.checkpoint.project?.rootPath;
  if (repo === undefined || repo.trim() === "") {
    throw new DomainValidationError("apply requires --repo or a checkpoint project.rootPath");
  }
  const workTree = isGitWorkTree(repo);
  if (!workTree.ok) {
    throw new DomainValidationError(`apply requires a git work tree at ${repo}: ${workTree.detail}`);
  }
  for (const [index, proposal] of proposals.entries()) {
    if (!applyProposal(repo, proposal, values.sign === true, io)) {
      // The commits already in the operator's history are real and this
      // command cannot take them back — rewriting their git history would be a
      // far larger claim than the one that just failed. Naming them, and the
      // `--nodes` selection that skips them, is what keeps the natural
      // re-run from duplicating work the CLI already did.
      if (index > 0) {
        io.stderr(
          `note: ${index} of ${proposals.length} proposed commits were already created in ${repo} before this failure; re-running apply would create them again — pass --nodes ${proposals
            .slice(index)
            .map((remaining) => remaining.nodeId)
            .join(",")} to apply only the rest\n`
        );
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

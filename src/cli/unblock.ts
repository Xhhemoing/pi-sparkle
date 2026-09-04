import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId, type RunId } from "../domain/ids.js";
import type { Event, RewoundDescendant } from "../run/events.js";
import { unblockFlowchartRun, type FlowchartRunOutcome } from "../run/flowchart-run.js";
import { createFilePauseController } from "../run/pause-controller.js";
import { CLI_EXIT, cliFail } from "./errors.js";
import type { CliIo } from "./main.js";
import { createCalibratedCliModelRouter } from "./model-catalog.js";

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

/**
 * The one command that ends a BLOCKED run.
 *
 * It is separate from `inject` on purpose: injection adds a typed fact and
 * deliberately holds no lifecycle lock because it may be aimed at a live run,
 * while this changes what every writer thinks the run's terminal is and has to
 * serialize against resume and delete. `unblockFlowchartRun` takes that lock,
 * insists the run is actually blocked, and refuses a stale or repeated attempt.
 *
 * It executes nothing. `resume` is still the only surface that spends money, so
 * the operator authorizes and runs in two separately auditable steps — which is
 * also why the success output ends by naming the resume rather than doing it.
 *
 * `--discard-executed` is the one flag that changes which authorization is
 * recorded. It is boolean because the set it authorizes is computed under the
 * run lock from the flowchart and the blocked checkpoint: an operator listing
 * nodes could omit a consequential one and get a partially coherent rewind that
 * still reads as authorized. Its output names every node discarded, the state
 * it was in and what its attempts charged, because that is the record the
 * operator is signing.
 */
export async function unblockCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      reason: { type: "string" },
      "retry-node": { type: "string" },
      "discard-executed": { type: "boolean" },
      actor: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  const reason = values.reason;
  if (values.run === undefined || reason === undefined || reason.trim() === "") {
    return cliFail(io, {
      command: "unblock",
      stage: "parse-args",
      message: "unblock requires --run <runId> and a non-empty --reason <text>",
      next: "pass --run <runId> and --reason <text> recording why the block is cleared",
      ...(values.run !== undefined ? { runId: values.run } : {})
    });
  }
  const retryNode = values["retry-node"];
  if (retryNode !== undefined && retryNode.trim() === "") {
    return cliFail(io, {
      command: "unblock",
      stage: "parse-args",
      message: "unblock --retry-node requires a non-empty flowchart node id",
      next: "pass --retry-node <nodeId> from the flowchart line of pi-sparkle inspect, or omit it",
      runId: values.run
    });
  }
  const discardExecuted = values["discard-executed"] === true;
  if (discardExecuted && retryNode === undefined) {
    return cliFail(io, {
      command: "unblock",
      stage: "parse-args",
      message: "unblock --discard-executed requires --retry-node <nodeId>",
      next: "discarding is defined relative to one failed node: pass --retry-node <nodeId>, or drop --discard-executed",
      runId: values.run
    });
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const outcome = await unblockRun(io, {
    stateRoot,
    runId,
    reason,
    discardExecuted,
    ...(retryNode !== undefined ? { retryNode } : {}),
    ...(values.actor !== undefined ? { actor: values.actor } : {})
  });
  if (typeof outcome === "number") return outcome;
  const nodes = Object.entries(outcome.snapshot.nodes)
    .map(([id, node]) => `${id}=${node.state}`)
    .join(" ");
  io.stdout(`Run ${runId}: unblocked (${outcome.status})\n`);
  io.stdout(`  reason: ${reason}\n`);
  if (retryNode !== undefined) {
    io.stdout(`  reopened: ${retryNode}\n`);
  }
  for (const descendant of discardedDescendants(outcome.events)) {
    io.stdout(
      `  discarded: ${descendant.nodeId} (was ${descendant.previousState}; charged estimate ${descendant.chargedEstimatedCostUsd} USD / ${descendant.chargedEstimatedDurationMs} ms across ${descendant.modelRouteEventIds.length} route(s), not refunded)\n`
    );
  }
  io.stdout(`  flowchart: ${outcome.snapshot.status}${nodes === "" ? "" : ` (${nodes})`}\n`);
  io.stdout(`  resume: pnpm cli resume --run ${runId} --state-root ${stateRoot}\n`);
  return CLI_EXIT.ok;
}

/** What the stronger authorization on this log says it superseded, if it is one. */
function discardedDescendants(events: readonly Event[]): readonly RewoundDescendant[] {
  const discard = events.findLast(
    (event): event is Extract<Event, { type: "RUN_UNBLOCKED_WITH_DISCARD" }> =>
      event.type === "RUN_UNBLOCKED_WITH_DISCARD"
  );
  return discard?.payload.rewoundDescendants ?? [];
}

/**
 * The unblock call, with one refusal turned into routing.
 *
 * An operator who reopens a node whose downstream work already ran meets a
 * refusal that is correct and, on its own, a dead end: it names the blocking
 * nodes but not the command that can proceed. The refusal message itself is the
 * state machine's and stays exactly as it is — this adds the `next:` line the
 * operator needs beside it, at the only surface that knows the flag exists.
 */
async function unblockRun(
  io: CliIo,
  request: {
    readonly stateRoot: string;
    readonly runId: RunId;
    readonly reason: string;
    readonly discardExecuted: boolean;
    readonly retryNode?: string;
    readonly actor?: string;
  }
): Promise<FlowchartRunOutcome | number> {
  try {
    return await unblockFlowchartRun(
      {
        stateRoot: request.stateRoot,
        router: await createCalibratedCliModelRouter(request.stateRoot),
        pause: createFilePauseController(request.stateRoot)
      },
      request.runId,
      {
        reason: request.reason,
        ...(request.retryNode !== undefined ? { retryNodeId: request.retryNode } : {}),
        ...(request.actor !== undefined ? { actor: request.actor } : {}),
        ...(request.discardExecuted ? { discardExecuted: true } : {})
      }
    );
  } catch (error) {
    if (
      request.retryNode === undefined ||
      !(error instanceof DomainValidationError) ||
      !error.message.includes("rewinding executed work is not authorized by an unblock")
    ) {
      throw error;
    }
    return cliFail(io, {
      command: "unblock",
      stage: "validation",
      message: error.message,
      next: `re-run with --retry-node ${request.retryNode} --discard-executed to authorize discarding that executed work, or leave the run blocked`,
      runId: request.runId
    });
  }
}

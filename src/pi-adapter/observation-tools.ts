import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RunId } from "../domain/ids.js";
import type { ObservationRef } from "../context/observation-store.js";
import { ObservationStore } from "../context/observation-store.js";
import { projectObservation } from "../context/observation-projection.js";

/**
 * Live wiring of the PR-B observation library for native workers.
 *
 * A projector is bound to one worker run: archived objects land under that
 * run's `runtime/runs/<runId>/observations/` subtree and vanish with the
 * existing `delete --run` cascade. Eligibility, the first-two-fulls contract,
 * and the ≤2KiB placeholder budget are the library's own rules — this module
 * adds no new projection policy.
 *
 * Disabled (the default) the projector returns every text unchanged and
 * archives nothing, byte-identical to the pre-wiring behavior.
 *
 * Binding model: the projector is created unbound (the run id does not exist
 * before `startParentRun`) and bound synchronously after the run starts,
 * before any child work can execute. All ids inside the run must stay
 * coordinator-generated — never inject a fixed id generator to pre-know the
 * run id, because that generator also mints every event/message id and would
 * collide them all.
 */

export interface ProjectInput {
  /** Stable id of the logical source (e.g. tool call id). */
  readonly sourceId: string;
  readonly text: string;
  readonly isError?: boolean | undefined;
  readonly evidenceReceipt?: boolean | undefined;
}

export interface ProjectResult {
  readonly text: string;
  readonly packed: boolean;
  readonly ref?: ObservationRef | undefined;
}

function fail(message: string): never {
  throw new Error(message);
}

export interface ObservationProjector {
  /** Bind to the run that owns this projector. Exactly once, before first use. */
  bind(binding: { readonly runId: RunId; readonly stateRoot: string }): void;
  project(input: ProjectInput): Promise<ProjectResult>;
  /** Refs archived by this projector (same run), recallable by id. */
  readonly refs: ReadonlyMap<string, ObservationRef>;
  /** Available only after bind; the recall tool resolves the store through it. */
  readonly runId: RunId | undefined;
  readonly stateRoot: string | undefined;
}

export function createObservationProjector(input: {
  readonly enabled: boolean;
  readonly toolName: string;
}): ObservationProjector {
  const refs = new Map<string, ObservationRef>();
  const sendCounts = new Map<string, number>();
  let boundRunId: RunId | undefined;
  let boundStateRoot: string | undefined;
  const storeFor = (): ObservationStore => {
    if (boundRunId === undefined || boundStateRoot === undefined) {
      return fail("observation projector used before bind()");
    }
    return new ObservationStore(boundStateRoot, boundRunId);
  };
  return {
    get runId() { return boundRunId; },
    get stateRoot() { return boundStateRoot; },
    refs,
    bind(binding: { readonly runId: RunId; readonly stateRoot: string }): void {
      if (boundRunId !== undefined) fail("observation projector is already bound to a run");
      boundRunId = binding.runId;
      boundStateRoot = binding.stateRoot;
    },
    async project(observable: ProjectInput): Promise<ProjectResult> {
      // Content-keyed send counter: the same bytes sent N times advance one
      // counter; distinct contents each get their own first-two window. This
      // is what makes repeat reads of one large file pack while distinct
      // files still pass through in full.
      const key = `${observable.text.length}:${hashablePrefix(observable.text)}`;
      const priorFullSends = sendCounts.get(key) ?? 0;
      sendCounts.set(key, priorFullSends + 1);
      const result = await projectObservation(
        {
          id: observable.sourceId,
          toolName: input.toolName,
          text: observable.text,
          isError: observable.isError ?? false,
          pureText: true,
          evidenceReceipt: observable.evidenceReceipt ?? false
        },
        { enabled: input.enabled, priorFullSends, store: storeFor() }
      );
      if (result.ref !== undefined) refs.set(result.ref.id, result.ref);
      return {
        text: result.text,
        packed: result.packed,
        ...(result.ref !== undefined ? { ref: result.ref } : {})
      };
    }
  };
}

function hashablePrefix(text: string): string {
  // Cheap content key: prefix + suffix + length. Exact identity is the
  // store's sha256; this key only routes the send counter.
  return `${text.slice(0, 256)}|${text.slice(-256)}`;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentTool<any> is the factory surface used across this adapter */
export function createRecallTool(projector: ObservationProjector): AgentTool<any> {
  return {
    name: "sparkle_recall_observation",
    label: "Sparkle Recall Observation",
    description:
      "Page through a previously archived (packed) observation from this run. Use the id from an [observation packed] placeholder. Offsets page forward; content is hash-verified.",
    parameters: Type.Object({
      id: Type.String({ description: "Observation id from the packed placeholder" }),
      offset: Type.Optional(Type.Number({ description: "Byte offset to page from (default 0)" }))
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const record = params as { id?: unknown; offset?: unknown };
      if (typeof record.id !== "string" || record.id.trim() === "") fail("observation id is required");
      const ref = projector.refs.get(record.id);
      if (ref === undefined) fail(`unknown observation id (not archived in this run): ${record.id}`);
      const offset = record.offset ?? 0;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
        fail("offset must be a non-negative safe integer");
      }
      if (projector.runId === undefined || projector.stateRoot === undefined) {
        return fail("observation projector is not bound to a run");
      }
      const store = new ObservationStore(projector.stateRoot, projector.runId);
      const page = await store.recall(ref, offset);
      const suffix = page.eof ? "" : `\n[continued at offset ${page.nextOffset}]`;
      return {
        content: [{ type: "text", text: `${page.text}${suffix}` }],
        details: { nextOffset: page.nextOffset, eof: page.eof }
      };
    }
  };
}

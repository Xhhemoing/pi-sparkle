import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RunId } from "../domain/ids.js";
import type { ObservationRef } from "../context/observation-store.js";
import { ObservationStore } from "../context/observation-store.js";
import { isObservationEligible, projectObservation } from "../context/observation-projection.js";
import { redactSensitiveText } from "../feedback/redaction.js";

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

export interface ProjectabilityMetadata {
  readonly resultKind: "observation" | "receipt" | "permission" | "error" | "other";
  readonly isError: boolean;
  readonly mutatesState: boolean;
  readonly securityCritical: boolean;
  readonly toolKind: "read" | "write" | "permission" | "verification" | "other";
  readonly toolPolicyProjectable: boolean;
}

export interface ProjectInput {
  /** Stable id of the logical source (e.g. tool call id). */
  readonly sourceId: string;
  readonly text: string;
  readonly isError?: boolean | undefined;
  readonly evidenceReceipt?: boolean | undefined;
  /** Original tool arguments. Read projection derives path sensitivity here. */
  readonly toolParams?: unknown;
  /** Tool-resolved canonical path; callers cannot supply this trust signal. */
  readonly resolvedReadPath?: string | undefined;
  /** Absent metadata fails closed and is never projected. */
  readonly projectability?: ProjectabilityMetadata | undefined;
}

export interface RecallBudget {
  readonly maxCalls: number;
  readonly maxBytes: number;
  readonly maxPages: number;
}

export const DEFAULT_RECALL_BUDGET: RecallBudget = {
  maxCalls: 16,
  maxBytes: 262_144,
  maxPages: 32
};

export interface ProjectResult {
  readonly text: string;
  readonly packed: boolean;
  readonly ref?: ObservationRef | undefined;
}

export interface ProjectionMechanism {
  repeatMassBytes: number;
  projectionBytes: number;
  placeholderBytes: number;
  recallRefusals: number;
  storageUnavailable: number;
}

export function emptyProjectionMechanism(): ProjectionMechanism {
  return { repeatMassBytes: 0, projectionBytes: 0, placeholderBytes: 0, recallRefusals: 0, storageUnavailable: 0 };
}

function fail(message: string): never {
  throw new Error(message);
}

function validateRecallBudget(budget: RecallBudget): RecallBudget {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail(`recall budget ${name} must be a positive safe integer`);
    }
  }
  return budget;
}

export interface ObservationProjector {
  /** Bind to the run that owns this projector. Exactly once, before first use. */
  bind(binding: { readonly runId: RunId; readonly stateRoot: string }): void;
  project(input: ProjectInput): Promise<ProjectResult>;
  /** Refs archived by this projector (same run), recallable by id. */
  readonly refs: ReadonlyMap<string, ObservationRef>;
  readonly mechanism: ProjectionMechanism;
  readonly recallBudget: RecallBudget;
  readonly recallUsage: { calls: number; bytes: number; pages: number };
  /** Available only after bind; the recall tool resolves the store through it. */
  readonly runId: RunId | undefined;
  readonly stateRoot: string | undefined;
}

export function createObservationProjector(input: {
  readonly enabled: boolean;
  readonly toolName: string;
  readonly recallBudget?: RecallBudget | undefined;
}): ObservationProjector {
  const refs = new Map<string, ObservationRef>();
  const sendCounts = new Map<string, number>();
  const mechanism: {
    repeatMassBytes: number;
    projectionBytes: number;
    placeholderBytes: number;
    recallRefusals: number;
    storageUnavailable: number;
  } = emptyProjectionMechanism();
  const recallBudget = validateRecallBudget(input.recallBudget ?? DEFAULT_RECALL_BUDGET);
  const recallUsage = { calls: 0, bytes: 0, pages: 0 };
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
    mechanism,
    recallBudget,
    recallUsage,
    bind(binding: { readonly runId: RunId; readonly stateRoot: string }): void {
      if (boundRunId !== undefined) fail("observation projector is already bound to a run");
      boundRunId = binding.runId;
      boundStateRoot = binding.stateRoot;
    },
    async project(observable: ProjectInput): Promise<ProjectResult> {
      if (!input.enabled) return { text: observable.text, packed: false };
      if (!isProjectable(observable) || observable.isError === true || observable.evidenceReceipt === true) {
        return { text: observable.text, packed: false };
      }
      const observation = {
        id: observable.sourceId,
        toolName: input.toolName,
        text: observable.text,
        isError: observable.isError ?? false,
        pureText: true,
        evidenceReceipt: observable.evidenceReceipt ?? false
      };
      if (!isObservationEligible(observation)) return { text: observable.text, packed: false };
      const store = storeFor();
      let ref: ObservationRef;
      try {
        ref = await store.put(observable.text);
      } catch {
        mechanism.storageUnavailable += 1;
        return { text: observable.text, packed: false };
      }
      const priorFullSends = sendCounts.get(ref.id) ?? 0;
      sendCounts.set(ref.id, priorFullSends + 1);
      const result = await projectObservation(
        observation,
        { enabled: input.enabled, priorFullSends, store, observationRef: ref }
      );
      if (result.ref !== undefined) refs.set(result.ref.id, result.ref);
      if (result.reason === "storage-unavailable") mechanism.storageUnavailable += 1;
      if (result.packed) {
        mechanism.repeatMassBytes += Buffer.byteLength(observable.text, "utf8");
        mechanism.placeholderBytes += Buffer.byteLength(result.text, "utf8");
      } else if (result.reason === "first-two") {
        mechanism.projectionBytes += Buffer.byteLength(result.text, "utf8");
      }
      return {
        text: result.text,
        packed: result.packed,
        ...(result.ref !== undefined ? { ref: result.ref } : {})
      };
    }
  };
}

const SENSITIVE_EXACT_NAMES = new Set([
  ".env",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_ecdsa",
  "id_rsa"
]);

function isSensitiveReadPath(params: unknown): boolean {
  if (typeof params !== "object" || params === null || !("path" in params)) return true;
  const path = (params as { readonly path?: unknown }).path;
  if (typeof path !== "string" || path.trim() === "") return true;
  const normalized = path.trim().replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const basename = segments.at(-1);
  if (basename === undefined) return true;
  if (SENSITIVE_EXACT_NAMES.has(basename)) return true;
  if (/^auth(?:[._-].*)?$/.test(basename)) return true;
  if (basename.startsWith(".env.")) return true;
  if (/^(?:credential|credentials|secret|secrets)(?:[._-].*)?$/.test(basename)) return true;
  if (/\.(?:key|pem|p12|pfx|ppk)$/.test(basename)) return true;
  return segments.some((segment) => segment === ".ssh" || segment === ".aws" || segment === "secret" || segment === "secrets");
}

function containsSecretContent(text: string): boolean {
  return redactSensitiveText(text).classes.includes("secret");
}

function isProjectable(input: ProjectInput): boolean {
  const metadata = input.projectability;
  if (metadata === undefined) return false;
  return metadata.resultKind === "observation"
    && metadata.isError === false
    && metadata.mutatesState === false
    && metadata.securityCritical === false
    && metadata.toolKind === "read"
    && metadata.toolPolicyProjectable === true
    && !isSensitiveReadPath(input.toolParams)
    && (input.resolvedReadPath === undefined || !isSensitiveReadPath({ path: input.resolvedReadPath }))
    && !containsSecretContent(input.text);
}

export interface RecallBudgetRefusalReceipt {
  readonly code: "RECALL_BUDGET_EXHAUSTED";
  readonly runId: RunId;
  readonly refId: string;
  readonly dimension: "calls" | "bytes" | "pages";
  readonly observed: number;
  readonly limit: number;
  readonly offset: number;
}

export class RecallBudgetExceededError extends Error {
  readonly code = "RECALL_BUDGET_EXHAUSTED" as const;

  constructor(readonly receipt: RecallBudgetRefusalReceipt) {
    super(
      `recall budget exhausted: ${receipt.dimension} run=${receipt.runId} ref=${receipt.refId} ` +
      `observed=${receipt.observed} limit=${receipt.limit} offset=${receipt.offset}`
    );
    this.name = "RecallBudgetExceededError";
  }
}

export function recallBudgetRefusal(input: {
  readonly runId: RunId;
  readonly ref: ObservationRef;
  readonly dimension: "calls" | "bytes" | "pages";
  readonly observed: number;
  readonly limit: number;
  readonly offset: number;
}): string {
  return `recall budget exhausted: ${input.dimension} run=${input.runId} ref=${input.ref.id} observed=${input.observed} limit=${input.limit} offset=${input.offset}`;
}

function createRecallBudgetExceededError(input: {
  readonly runId: RunId;
  readonly ref: ObservationRef;
  readonly dimension: "calls" | "bytes" | "pages";
  readonly observed: number;
  readonly limit: number;
  readonly offset: number;
}): RecallBudgetExceededError {
  return new RecallBudgetExceededError({
    code: "RECALL_BUDGET_EXHAUSTED",
    runId: input.runId,
    refId: input.ref.id,
    dimension: input.dimension,
    observed: input.observed,
    limit: input.limit,
    offset: input.offset
  });
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentTool<any> is the factory surface used across this adapter */
export function createRecallTool(projector: ObservationProjector): AgentTool<any> {
  return {
    name: "sparkle_recall_observation",
    label: "Sparkle Recall Observation",
    description:
      "Page through a previously archived (packed) observation from this run. Use the id from an [observation packed] placeholder. Offsets page forward; byte length is checked, but content integrity is not cryptographically verified.",
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
      const usage = projector.recallUsage;
      const nextCalls = usage.calls + 1;
      const nextPages = usage.pages + 1;
      const dimension = nextCalls > projector.recallBudget.maxCalls
        ? "calls"
        : nextPages > projector.recallBudget.maxPages
          ? "pages"
          : usage.bytes >= projector.recallBudget.maxBytes
            ? "bytes"
            : undefined;
      if (dimension !== undefined) {
        projector.mechanism.recallRefusals += 1;
        const observed = dimension === "calls" ? nextCalls : dimension === "pages" ? nextPages : usage.bytes;
        const limit = projector.recallBudget[dimension === "calls" ? "maxCalls" : dimension === "pages" ? "maxPages" : "maxBytes"];
        throw createRecallBudgetExceededError({
          runId: projector.runId,
          ref,
          dimension,
          observed,
          limit,
          offset
        });
      }
      const projectedBytes = Math.min(16_384, Math.max(0, ref.byteLength - offset));
      if (usage.bytes + projectedBytes > projector.recallBudget.maxBytes) {
        projector.mechanism.recallRefusals += 1;
        throw createRecallBudgetExceededError({
          runId: projector.runId,
          ref,
          dimension: "bytes",
          observed: usage.bytes + projectedBytes,
          limit: projector.recallBudget.maxBytes,
          offset
        });
      }
      const store = new ObservationStore(projector.stateRoot, projector.runId);
      const page = await store.recall(ref, offset);
      const pageBytes = Buffer.byteLength(page.text, "utf8");
      usage.calls = nextCalls;
      usage.pages = nextPages;
      usage.bytes += pageBytes;
      const suffix = page.eof ? "" : `\n[continued at offset ${page.nextOffset}]`;
      return {
        content: [{ type: "text", text: `${page.text}${suffix}` }],
        details: { nextOffset: page.nextOffset, eof: page.eof }
      };
    }
  };
}

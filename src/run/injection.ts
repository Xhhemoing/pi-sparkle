import { DomainValidationError } from "../domain/errors.js";
import {
  isConfidenceScore,
  validateConfidenceScore,
  type ConfidenceScore,
  type DecisionPolicy
} from "../domain/flowchart.js";
import { isRecord } from "../domain/record.js";
import type { FactValue, FlowchartInjection, FlowNodeState } from "../supervisor/flowchart-supervisor.js";

export const INJECTION_KINDS = ["fact", "override", "skip"] as const;
export type InjectionKind = (typeof INJECTION_KINDS)[number];

export interface InjectionValidationContext {
  policy: DecisionPolicy;
  nodeState?: (nodeId: string) => FlowNodeState | undefined;
}

export type ValidatedInjection = FlowchartInjection & {
  readonly actor: string;
  readonly requiresApproval: boolean;
  readonly confidence: ConfidenceScore;
  readonly nodeId?: string;
};

const SKIP_FORBIDDEN: ReadonlySet<string> = new Set([
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "WAITING_FOR_USER"
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFactScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

function unexpectedKeys(payload: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(payload)) {
    if (!allowedSet.has(key)) return `payload.${key} is not valid for ${String(payload.kind)}`;
  }
  return undefined;
}

export function parseFactValue(raw: string): FactValue {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || Array.isArray(parsed) || typeof parsed === "object") {
      throw new DomainValidationError("fact value must be a JSON scalar or bare string");
    }
    if (!isFactScalar(parsed)) {
      throw new DomainValidationError("fact value must be a JSON scalar or bare string");
    }
    return parsed;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    if (error instanceof SyntaxError) return raw;
    throw error;
  }
}

export function injectionPayloadError(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.kind !== "string" || !(INJECTION_KINDS as readonly string[]).includes(payload.kind)) {
    return "payload.kind must be fact, override, or skip";
  }
  if (!nonEmpty(payload.actor)) return "payload.actor must be a non-empty string";
  if (!isConfidenceScore(payload.confidence)) {
    return "payload.confidence must be a finite number between 0 and 1";
  }
  if (payload.kind === "fact") {
    const extra = unexpectedKeys(payload, ["kind", "actor", "confidence", "key", "value", "nodeId"]);
    if (extra !== undefined) return extra;
    if (!nonEmpty(payload.key)) return "payload.key must be a non-empty string";
    if (!isFactScalar(payload.value)) return "payload.value must be a string, number, or boolean scalar";
    if (payload.nodeId !== undefined && !nonEmpty(payload.nodeId)) {
      return "payload.nodeId must be a non-empty string";
    }
    return undefined;
  }
  const extra = unexpectedKeys(payload, ["kind", "actor", "confidence", "nodeId"]);
  if (extra !== undefined) return extra;
  if (!nonEmpty(payload.nodeId)) return "payload.nodeId must be a non-empty string";
  return undefined;
}

export function validateInjection(value: unknown, ctx: InjectionValidationContext): ValidatedInjection {
  if (!isRecord(value)) throw new DomainValidationError("injection must be an object");
  const actor = value.actor === undefined ? "user" : value.actor;
  const confidence =
    value.confidence === undefined ? 1 : validateConfidenceScore(value.confidence, "confidence");
  const candidate: Record<string, unknown> = { ...value, actor, confidence };
  const reason = injectionPayloadError(candidate);
  if (reason !== undefined) throw new DomainValidationError(reason.replace(/^payload\./, "injection "));

  const requiresApproval = ctx.policy.requiresApproval(confidence, false);
  const kind = candidate.kind as InjectionKind;

  if (kind === "fact") {
    return {
      kind: "fact",
      actor: actor as string,
      confidence,
      key: candidate.key as string,
      value: candidate.value as FactValue,
      requiresApproval,
      ...(nonEmpty(candidate.nodeId) ? { nodeId: candidate.nodeId } : {})
    };
  }

  const nodeId = candidate.nodeId as string;
  const state = ctx.nodeState?.(nodeId);
  if (ctx.nodeState !== undefined && state === undefined) {
    throw new DomainValidationError(`unknown node: ${nodeId}`);
  }
  if (kind === "skip") {
    if (state !== undefined && SKIP_FORBIDDEN.has(state)) {
      throw new DomainValidationError(`cannot skip node ${nodeId} in state ${state}`);
    }
    return { kind: "skip", actor: actor as string, confidence, nodeId, requiresApproval };
  }
  if (state === "FAILED") {
    throw new DomainValidationError(`cannot override confidence of FAILED node ${nodeId}`);
  }
  return { kind: "override", actor: actor as string, confidence, nodeId, requiresApproval };
}

export function injectionEventPayload(injection: ValidatedInjection): Record<string, unknown> {
  const base = { kind: injection.kind, actor: injection.actor, confidence: injection.confidence };
  if (injection.kind === "fact") {
    return {
      ...base,
      key: injection.key,
      value: injection.value,
      ...(injection.nodeId !== undefined ? { nodeId: injection.nodeId } : {})
    };
  }
  return { ...base, nodeId: injection.nodeId };
}

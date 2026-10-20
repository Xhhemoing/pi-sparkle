import { DomainValidationError } from "./errors.js";

export interface RunEngineBinding {
  readonly kind: "managed-pi";
  readonly generationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRunEngineBinding(value: unknown): value is RunEngineBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).length === 2 &&
    Object.hasOwn(binding, "kind") && Object.hasOwn(binding, "generationId") &&
    binding.kind === "managed-pi" && typeof binding.generationId === "string" && UUID.test(binding.generationId);
}

export function snapshotRunEngineBinding(value: unknown): RunEngineBinding {
  if (!isRunEngineBinding(value)) throw new DomainValidationError("Invalid Run engineBinding");
  return Object.freeze({ kind: value.kind, generationId: value.generationId });
}

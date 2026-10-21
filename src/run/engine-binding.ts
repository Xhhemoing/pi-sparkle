import { DomainValidationError } from "../domain/errors.js";
import { snapshotRunEngineBinding, type RunEngineBinding } from "../domain/run-engine-binding.js";

/** Trusted host assertion; actual loaded engine identity is established by the host. */
export interface RunEngineContext {
  readonly binding: RunEngineBinding;
  readonly assertQualifiedGeneration: (binding: RunEngineBinding) => Promise<void>;
}

/** Capture before the entry point's first await so mutable options cannot rebind a run. */
export function captureRunEngineContext(context: RunEngineContext | undefined): RunEngineContext | undefined {
  if (context === undefined) return undefined;
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new DomainValidationError("Invalid run engine context");
  }
  const binding = snapshotRunEngineBinding(context.binding);
  const assertQualifiedGeneration = context.assertQualifiedGeneration;
  if (typeof assertQualifiedGeneration !== "function") {
    throw new DomainValidationError("Run engine context requires assertQualifiedGeneration");
  }
  return Object.freeze({ binding, assertQualifiedGeneration });
}

export async function bindingForNewRun(context: RunEngineContext | undefined): Promise<RunEngineBinding | undefined> {
  if (context === undefined) return undefined;
  await context.assertQualifiedGeneration(context.binding);
  return context.binding;
}

export async function assertRunEngineForResume(recorded: RunEngineBinding | undefined, context: RunEngineContext | undefined): Promise<void> {
  if (recorded === undefined) {
    if (context !== undefined) throw new DomainValidationError("Cannot resume legacy run with managed engine context");
    return;
  }
  const binding = snapshotRunEngineBinding(recorded);
  if (context === undefined) throw new DomainValidationError("Managed run requires its original engine context");
  if (binding.generationId !== context.binding.generationId) {
    throw new DomainValidationError("Run engine generation mismatch: resume requires the recorded generation");
  }
  await context.assertQualifiedGeneration(binding);
}

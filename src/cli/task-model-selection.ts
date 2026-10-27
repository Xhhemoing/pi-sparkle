import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { formatModelRef } from "../config/model-ref.js";
import type { ProvidersConfig } from "../config/providers-config.js";
import {
  parseTaskModelSelection,
  parseTaskModelSelectionAuthority,
  type TaskModelSelection
} from "../domain/task-model-selection.js";
import { resolveCliPiExecutorOptions, type CliExecutorEnvironment } from "./executor-factory.js";

export {
  parseTaskModelSelection,
  parseTaskModelSelectionAuthority,
  type TaskModelSelection,
  type TaskModelSelectionAuthority
} from "../domain/task-model-selection.js";
function fail(reason: string): never { throw new DomainValidationError(`task model selection: ${reason}`); }
function fields(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("expected an ordinary own-data object");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key))) fail("unexpected or missing fields");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) fail("fields must be own data properties");
    result[key] = descriptor.value;
  }
  return result;
}
function sameSelection(left: TaskModelSelection, right: TaskModelSelection): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId && left.thinkingLevel === right.thinkingLevel;
}

/** Fixed host profile only: original pricing, credentials and executor construction remain authoritative. */
export function resolveTaskModelSelectionOptions(input: {
  readonly stateRoot: string;
  readonly config: ProvidersConfig;
  readonly env: CliExecutorEnvironment;
  readonly selection: unknown;
  readonly authority: unknown;
}): ReturnType<typeof resolveCliPiExecutorOptions> {
  fields(input, ["stateRoot", "config", "env", "selection", "authority"]);
  const selection = parseTaskModelSelection(input.selection), authority = parseTaskModelSelectionAuthority(input.authority);
  if (!authority.approvedSelections.some(approved => sameSelection(approved, selection))) fail("profile is not approved by host authority");
  if (!input.config.enabled.includes(formatModelRef(selection.providerId, selection.modelId))) fail("selected model is not enabled");
  // Resolve the effective original provider, but let the fixed valid thinking override ambient thinking.
  const original = resolveCliPiExecutorOptions({ stateRoot: input.stateRoot, config: input.config, env: input.env, thinkingLevel: selection.thinkingLevel });
  if (original.providerId !== selection.providerId) fail("selected provider must equal the effective original provider");
  // A fixed profile binds every dispatch: do not silently inherit a fast-model fallback.
  const { fast: _fast, ...fixedConfig } = input.config;
  return resolveCliPiExecutorOptions({ stateRoot: input.stateRoot, config: fixedConfig, env: input.env,
    executorModelOverride: { providerId: selection.providerId, modelId: selection.modelId }, thinkingLevel: selection.thinkingLevel });
}

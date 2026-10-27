import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { formatModelRef } from "../config/model-ref.js";
import type { ProvidersConfig } from "../config/providers-config.js";
import { resolveCliPiExecutorOptions, type CliExecutorEnvironment } from "./executor-factory.js";
import { isThinkingLevel, type CliThinkingLevel } from "./run-options.js";

export interface TaskModelSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly thinkingLevel: CliThinkingLevel;
}
export interface TaskModelSelectionAuthority {
  readonly authorityRef: string;
  readonly approvedSelections: readonly TaskModelSelection[];
}
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
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maximum ||
      [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) fail("expected bounded nonblank text without control characters");
  return value;
}
function sameSelection(left: TaskModelSelection, right: TaskModelSelection): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId && left.thinkingLevel === right.thinkingLevel;
}
/** Content parser only. A parsed triple is not authority to select a model. */
export function parseTaskModelSelection(value: unknown): TaskModelSelection {
  const raw = fields(value, ["providerId", "modelId", "thinkingLevel"]);
  const providerId = text(raw.providerId, 256), modelId = text(raw.modelId, 1024);
  if (providerId.includes("/")) fail("providerId must not contain a slash");
  if (typeof raw.thinkingLevel !== "string" || !isThinkingLevel(raw.thinkingLevel)) fail("unsupported thinking level");
  return Object.freeze({ providerId, modelId, thinkingLevel: raw.thinkingLevel });
}
/** The trusted host supplies this whitelist separately from resource content. */
export function parseTaskModelSelectionAuthority(value: unknown): TaskModelSelectionAuthority {
  const raw = fields(value, ["authorityRef", "approvedSelections"]);
  const authorityRef = text(raw.authorityRef, 4096), entries = raw.approvedSelections;
  if (entries === null || typeof entries !== "object" || types.isProxy(entries) || !Array.isArray(entries) ||
      Object.getPrototypeOf(entries) !== Array.prototype || entries.length < 1 || entries.length > 32) fail("approved selections must be an ordinary array of 1..32 profiles");
  const keys = Reflect.ownKeys(entries);
  if (keys.length !== entries.length + 1 || keys.some(key => typeof key !== "string" ||
      (key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= entries.length)))) fail("approved selections must not have extra fields or holes");
  const approvedSelections: TaskModelSelection[] = [];
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (descriptor === undefined || !("value" in descriptor)) fail("approved selections must contain own data entries");
    const selection = parseTaskModelSelection(descriptor.value);
    if (approvedSelections.some(previous => sameSelection(previous, selection))) fail("duplicate approved selection");
    approvedSelections.push(selection);
  }
  return Object.freeze({ authorityRef, approvedSelections: Object.freeze(approvedSelections) });
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

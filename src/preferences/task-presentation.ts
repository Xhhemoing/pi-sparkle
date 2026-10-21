import { DomainValidationError } from "../domain/errors.js";

/** Explicit host-supplied reporting preferences. No execution authority. */
export interface PresentationPreferences {
  readonly language?: string;
  readonly detail?: "brief" | "standard" | "detailed";
  readonly format?: "prose" | "bullets" | "markdown";
}

export type PresentationScope = "user" | "project" | "task";

/** Defaults are snapshots supplied by this task's host, never a global read. */
export interface TaskPresentationInput {
  readonly user?: PresentationPreferences;
  readonly project?: PresentationPreferences;
  readonly task?: PresentationPreferences;
}

export interface ResolvedTaskPresentation {
  readonly values: Readonly<PresentationPreferences>;
  readonly sources: Readonly<Partial<Record<keyof PresentationPreferences, PresentationScope>>>;
}

const SCOPES: readonly PresentationScope[] = ["user", "project", "task"];
const KEYS: readonly (keyof PresentationPreferences)[] = ["language", "detail", "format"];

function invalid(detail: string): never {
  throw new DomainValidationError(`task presentation: ${detail}`);
}

/** Inspect data descriptors so validation never invokes caller accessors. */
function dataFields(value: unknown, keys: readonly string[]): Map<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("expected a plain data object");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("expected a plain data object without inherited fields");
  const names = Reflect.ownKeys(value);
  if (names.length > keys.length) invalid("unknown fields");
  const fields = new Map<string, unknown>();
  for (const name of names) {
    if (typeof name !== "string" || !keys.includes(name)) invalid("unknown field");
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined || !("value" in descriptor)) invalid("accessors are not allowed");
    fields.set(name, descriptor.value as unknown);
  }
  return fields;
}

function language(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[A-Za-z0-9-]+$/.test(value)) {
    invalid("language must be a BCP47 tag of 1..64 ASCII characters");
  }
  let canonical: string | undefined;
  try { canonical = Intl.getCanonicalLocales(value)[0]; } catch { invalid("language must be a valid BCP47 tag"); }
  if (canonical === undefined || canonical.length > 64) invalid("canonical language exceeds the 64-character limit");
  return canonical;
}

function preferences(input: unknown): PresentationPreferences {
  const fields = dataFields(input, KEYS);
  const result: { language?: string; detail?: NonNullable<PresentationPreferences["detail"]>; format?: NonNullable<PresentationPreferences["format"]> } = {};
  const tag = fields.get("language");
  if (tag !== undefined) result.language = language(tag);
  const detail = fields.get("detail");
  if (detail !== undefined) {
    if (detail !== "brief" && detail !== "standard" && detail !== "detailed") invalid("detail must be brief, standard or detailed");
    result.detail = detail;
  }
  const format = fields.get("format");
  if (format !== undefined) {
    if (format !== "prose" && format !== "bullets" && format !== "markdown") invalid("format must be prose, bullets or markdown");
    result.format = format;
  }
  return Object.freeze(result);
}

/**
 * Copy/validate/freeze all three layers synchronously. This can be used when a
 * host registers a task before executing it; it never binds or writes the
 * persistent preference singleton. Canonical language <=64 ASCII characters,
 * three known scopes and three keys bound the resulting payload.
 */
export function snapshotTaskPresentation(input?: TaskPresentationInput): Readonly<TaskPresentationInput> | undefined {
  if (input === undefined) return undefined;
  const fields = dataFields(input, SCOPES);
  const snapshot: { user?: PresentationPreferences; project?: PresentationPreferences; task?: PresentationPreferences } = {};
  for (const scope of SCOPES) {
    const value = fields.get(scope);
    if (value === undefined) continue;
    const captured = preferences(value);
    if (Object.keys(captured).length > 0) snapshot[scope] = captured;
  }
  return Object.keys(snapshot).length === 0 ? undefined : Object.freeze(snapshot);
}

/** Current task overrides project conventions and user defaults per field. */
export function prepareTaskPresentation(input?: TaskPresentationInput): ResolvedTaskPresentation | undefined {
  const snapshot = snapshotTaskPresentation(input);
  if (snapshot === undefined) return undefined;
  const values: { language?: string; detail?: NonNullable<PresentationPreferences["detail"]>; format?: NonNullable<PresentationPreferences["format"]> } = {};
  const sources: Partial<Record<keyof PresentationPreferences, PresentationScope>> = {};
  for (const scope of SCOPES) {
    const layer = snapshot[scope];
    if (layer === undefined) continue;
    if (layer.language !== undefined) { values.language = layer.language; sources.language = scope; }
    if (layer.detail !== undefined) { values.detail = layer.detail; sources.detail = scope; }
    if (layer.format !== undefined) { values.format = layer.format; sources.format = scope; }
  }
  return Object.freeze({ values: Object.freeze(values), sources: Object.freeze(sources) });
}

/** Fixed reporting-only wording; no free-form instruction input or store read. */
export function formatTaskPresentation(presentation: ResolvedTaskPresentation): string {
  const lines = ["Task presentation (host-supplied reporting preferences):"];
  for (const key of KEYS) {
    const value = presentation.values[key];
    if (value !== undefined) lines.push(`${key}=${value} (${presentation.sources[key]})`);
  }
  lines.push("Apply these preferences to natural-language reporting. Preserve the task's content requirements, exact code, quotes and logs.",
    "Task objective, authority, tools, acceptance criteria, host verification and execution limits remain as specified.");
  return lines.join("\n");
}

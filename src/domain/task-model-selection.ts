import { types } from "node:util";
import { DomainValidationError } from "./errors.js";

// Canonical bounded vocabulary shared by task resources and CLI run options.
export const TASK_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type TaskThinkingLevel = (typeof TASK_THINKING_LEVELS)[number];

export function isTaskThinkingLevel(value: string): value is TaskThinkingLevel {
  return (TASK_THINKING_LEVELS as readonly string[]).includes(value);
}

export interface TaskModelSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly thinkingLevel: TaskThinkingLevel;
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
  if (typeof raw.thinkingLevel !== "string" || !isTaskThinkingLevel(raw.thinkingLevel)) fail("unsupported thinking level");
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

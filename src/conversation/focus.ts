import { randomUUID } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId, type RunId } from "../domain/ids.js";

export interface ConversationTarget {
  readonly projectRef: string;
  readonly taskRef?: string;
}
export interface ConversationFocusToken {
  readonly generation: string;
  readonly revision: number;
}
export interface ConversationFocusLocation extends ConversationTarget {
  readonly runId?: RunId;
}
export interface ConversationFocusSnapshot {
  readonly token: ConversationFocusToken;
  readonly current?: ConversationFocusLocation;
  readonly suspended?: ConversationFocusLocation;
  readonly messageRef?: string;
}

function fail(reason: string): never { throw new DomainValidationError(`conversation focus: ${reason}`); }

/** Internal shared validation; never evaluates request accessors. */
export function conversationRecord(input: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail(`${label} must be a plain object`);
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowed.includes(key)) fail(`${label} contains unsupported fields`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!("value" in descriptor)) fail(`${label} fields must be ordinary values, not accessors`);
    output[key] = descriptor.value;
  }
  return output;
}
export function conversationText(input: unknown, label: string, maximum = 256): string {
  if (typeof input !== "string" || input.length < 1 || input.length > maximum || input.trim() !== input || input.includes("\0")) {
    fail(`${label} must contain 1..${maximum} characters without NUL or surrounding whitespace`);
  }
  return input;
}
export function conversationTarget(input: unknown): ConversationTarget {
  const value = conversationRecord(input, ["projectRef", "taskRef"], "target");
  return Object.freeze({ projectRef: conversationText(value.projectRef, "projectRef", 128),
    ...(value.taskRef === undefined ? {} : { taskRef: conversationText(value.taskRef, "taskRef", 128) }) });
}
export function conversationToken(input: unknown): ConversationFocusToken {
  const value = conversationRecord(input, ["generation", "revision"], "focus token");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) fail("focus revision must be a nonnegative safe integer");
  return Object.freeze({ generation: conversationText(value.generation, "focus generation", 128), revision: value.revision as number });
}
export function conversationTargetKey(target: ConversationTarget): string {
  return JSON.stringify([target.projectRef, target.taskRef ?? null]);
}

/** In-memory lookup pointers, never task completion or execution authority. */
export class ConversationFocus {
  private readonly known = new Set<string>();
  private state: ConversationFocusSnapshot;

  constructor(targets: readonly ConversationTarget[], initial?: Pick<ConversationFocusSnapshot, "current" | "suspended">) {
    if (!Array.isArray(targets) || targets.length > 256) fail("known targets must be an array of at most 256 entries");
    for (const target of targets) {
      const key = conversationTargetKey(conversationTarget(target));
      if (this.known.has(key)) fail("known targets contain duplicate references");
      this.known.add(key);
    }
    const locations: { current?: ConversationFocusLocation; suspended?: ConversationFocusLocation } = {};
    if (initial !== undefined) {
      const input = conversationRecord(initial, ["current", "suspended"], "initial focus");
      for (const field of ["current", "suspended"] as const) {
        if (input[field] === undefined) continue;
        const value = conversationRecord(input[field], ["projectRef", "taskRef", "runId"], "initial location");
        const target = conversationTarget({ projectRef: value.projectRef, ...(value.taskRef === undefined ? {} : { taskRef: value.taskRef }) });
        if (!this.known.has(conversationTargetKey(target))) fail("unknown initial target reference");
        locations[field] = Object.freeze({ ...target, ...(value.runId === undefined ? {} : { runId: parseRunId(value.runId as string) }) });
      }
      if (locations.suspended !== undefined && locations.current === undefined) fail("suspended focus requires current focus");
    }
    this.state = Object.freeze({ ...locations, token: Object.freeze({ generation: `focus_v1_${randomUUID()}`, revision: 0 }) });
  }

  snapshot(): ConversationFocusSnapshot { return this.state; }

  matches(input: ConversationFocusToken): boolean {
    const token = conversationToken(input);
    return token.generation === this.state.token.generation && token.revision === this.state.token.revision;
  }

  assertCurrent(input: ConversationFocusToken): void {
    if (!this.matches(input)) fail("stale focus token; read the current focus before another action");
  }

  select(input: ConversationTarget, expected: ConversationFocusToken, messageRef: string, temporary = false): ConversationFocusSnapshot {
    const target = conversationTarget(input);
    if (!this.known.has(conversationTargetKey(target))) fail("unknown target reference");
    const source = conversationText(messageRef, "messageRef");
    if (typeof temporary !== "boolean") fail("temporary must be a boolean");
    this.assertCurrent(expected);
    const suspended = temporary ? this.state.suspended ?? this.state.current : undefined;
    return this.publish({ current: target, ...(suspended === undefined ? {} : { suspended }), messageRef: source });
  }

  restore(expected: ConversationFocusToken, messageRef: string): ConversationFocusSnapshot {
    const source = conversationText(messageRef, "messageRef");
    this.assertCurrent(expected);
    if (this.state.suspended === undefined) fail("no suspended focus to restore");
    return this.publish({ current: this.state.suspended, messageRef: source });
  }

  /** Bind only an actual returned run, and only if the captured pointer is current. */
  recordRun(expected: ConversationFocusToken, runId: RunId, messageRef: string): boolean {
    const actualRun = parseRunId(runId);
    const source = conversationText(messageRef, "messageRef");
    if (!this.matches(expected) || this.state.current === undefined) return false;
    this.publish({ current: Object.freeze({ ...this.state.current, runId: actualRun }),
      ...(this.state.suspended === undefined ? {} : { suspended: this.state.suspended }), messageRef: source });
    return true;
  }

  private publish(input: Omit<ConversationFocusSnapshot, "token">): ConversationFocusSnapshot {
    if (this.state.token.revision === Number.MAX_SAFE_INTEGER) fail("focus revision capacity exhausted");
    this.state = Object.freeze({ ...input,
      token: Object.freeze({ generation: this.state.token.generation, revision: this.state.token.revision + 1 }) });
    return this.state;
  }
}

import { DomainValidationError } from "../domain/errors.js";
import type { TaskId } from "../domain/ids.js";
import type { LoopArtifactRef } from "../execution/loop-artifact.js";

/** Host-authored requirements. Descriptive checks never become executable authority. */
export interface NativeWriteAcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly observableCheck: string;
}
export interface NativeWriteTaskContract {
  readonly schemaVersion: 1;
  readonly taskId: TaskId;
  readonly acceptanceCriteria: readonly NativeWriteAcceptanceCriterion[];
  readonly criterionIds: readonly string[];
  /** Requirement definition only; no independent per-criterion verdict is implied. */
  readonly artifact: LoopArtifactRef;
}
function fail(detail: string): never { throw new DomainValidationError(`native write acceptance criteria: ${detail}`); }
function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum || value.includes("\0")) {
    fail(`${label} must contain 1..${maximum} characters without NUL`);
  }
  return value.trim();
}
/** Validate and snapshot synchronously, before candidate or run allocation. */
export function prepareNativeWriteCriteria(input: unknown): readonly NativeWriteAcceptanceCriterion[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) fail("must be an array of 1..8 criteria");
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) {
    fail("array contains unsupported fields");
  }
  const ids = new Set<string>();
  const output: NativeWriteAcceptanceCriterion[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined || !("value" in descriptor)) fail("array must contain ordinary criterion values");
    const item: unknown = descriptor.value;
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail("criterion must be a plain object");
    const prototype: unknown = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) fail("criterion must be a plain object");
    if (Reflect.ownKeys(item).some((key) => typeof key !== "string" || !["id", "description", "observableCheck"].includes(key))) {
      fail("criterion contains unsupported fields");
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of ["id", "description", "observableCheck"]) {
      if (descriptors[key] === undefined || !("value" in descriptors[key])) fail("criterion fields must be ordinary values");
    }
    const id = text(descriptors.id!.value, "id", 64);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) fail("ids must be unique ASCII identifiers");
    ids.add(id);
    output.push(Object.freeze({ id, description: text(descriptors.description!.value, "description"),
      observableCheck: text(descriptors.observableCheck!.value, "observableCheck") }));
  }
  return Object.freeze(output);
}

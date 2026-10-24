import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { snapshotDevelopmentCheckPlan, type DevelopmentCheckDefinition } from "./check-plan.js";
import { assertRequiredDevelopmentWrites, snapshotDevelopmentScopePolicy } from "./task-policy.js";
import { workItemScope } from "./work-items.js";

export interface DevelopmentTaskPreparation { readonly id: string; readonly command: string; readonly args: readonly string[]; }
export type DevelopmentTaskCheck = DevelopmentCheckDefinition & { readonly expect:
  | { readonly baseline: "pass" }
  | { readonly baseline: "fail"; readonly failureAssertion: string } };
/** Experimental normalized JSON TaskSpec; parsing performs no preparation or execution. */
export interface DevelopmentTaskSpec {
  readonly version: 1;
  readonly objective: string;
  readonly context: readonly string[];
  readonly write: { readonly allow: readonly string[]; readonly protect: readonly string[]; readonly require?: readonly string[] };
  readonly prepare: readonly DevelopmentTaskPreparation[];
  readonly checks: readonly DevelopmentTaskCheck[];
  readonly budget: { readonly totalSeconds: number; readonly prepareSeconds: number; readonly checkSeconds: number; readonly workerSeconds: number;
    readonly workerTotalSeconds?: number; readonly checkTotalSeconds?: number };
  readonly worker: { readonly model: "inherit"; readonly maxAttempts?: number };
}

const CHECK_FIELDS = ["id", "command", "args", "verifierVersion", "protectedPaths", "timeoutMs", "maxStdoutBytes", "maxStderrBytes", "visibleToWorker", "expect"];
function fail(reason: string): never { throw new DomainValidationError(`development TaskSpec: ${reason}`); }
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("expected an ordinary own-data object");
  const copied = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !allowed.includes(key)) fail(`unsupported field ${String(key)} (USD and shell run are unsupported)`);
    if (!("value" in property)) fail("fields must be own data properties, not accessors");
    copied[key] = property.value;
  }
  return copied;
}
/** Internal host entry normalization; resources stay host-owned, ordinary fields are read once. */
export function snapshotTaskSpecHostInput<T extends object>(value: T, fields: readonly string[]): T {
  return Object.freeze(record(value, fields)) as T;
}
function array(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) fail("expected an ordinary own-data array");
  if (value.length < minimum || value.length > maximum) fail(`array size must be ${minimum}..${maximum}`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) fail("arrays must not have holes or extra fields");
  const copied: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, index);
    if (property === undefined || !("value" in property)) fail("array entries must be own data properties");
    copied.push(property.value);
  }
  return copied;
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > maximum || (!allowEmpty && value.trim() === "")) fail(`expected a bounded string of at most ${maximum} characters`);
  return value;
}
function args(value: unknown): string[] { return array(value, 64).map((entry) => text(entry, 2048, true)); }
function prefixes(value: unknown, maximum: number, minimum = 0): string[] {
  return array(value, maximum, minimum).map(workItemScope);
}
/** Only this explicit declaration syntax is a file reference; ordinary prose stays unchanged. */
function requiredContext(objective: string, explicit: string[]): string[] {
  const required = [...explicit];
  const remaining = objective.replace(/\[\[file:([\s\S]*?)\]\]/g, (_declaration, rawPath: string) => {
    if (rawPath.includes("\n") || rawPath.includes("\r")) fail("explicit file reference must fit one line");
    const selected = workItemScope(rawPath);
    if (!required.includes(selected)) required.push(selected);
    return "";
  });
  if (remaining.includes("[[file:")) fail("malformed explicit file reference");
  if (required.length > 32) fail("combined required context must contain at most 32 files");
  return required;
}
function duration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.001 || value > 1800) fail("duration must convert to 1..1800000 whole milliseconds");
  const milliseconds = value * 1000;
  const rounded = Math.round(milliseconds);
  if (!Number.isSafeInteger(rounded) || Math.abs(milliseconds - rounded) > Number.EPSILON * Math.max(1, milliseconds) * 2) {
    fail("duration must have whole millisecond precision");
  }
  return value;
}
function expectation(value: unknown): DevelopmentTaskCheck["expect"] {
  const raw = record(value, ["baseline", "failureAssertion"]);
  if (raw.baseline === "pass") {
    if (Object.hasOwn(raw, "failureAssertion")) fail("passing baseline must not declare failureAssertion");
    return { baseline: "pass" };
  }
  if (raw.baseline === "fail") return { baseline: "fail", failureAssertion: text(raw.failureAssertion, 256) };
  return fail("check expectation baseline must be pass or fail");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function snapshotDevelopmentTaskSpec(value: unknown): DevelopmentTaskSpec {
  const raw = record(value, ["version", "objective", "context", "write", "prepare", "checks", "budget", "worker"]);
  if (raw.version !== 1) fail("version must be 1");
  const objective = text(raw.objective, 4096);
  const context = requiredContext(objective, raw.context === undefined ? [] : prefixes(raw.context, 32));
  const write = record(raw.write, ["allow", "protect", "require"]);
  const scope = snapshotDevelopmentScopePolicy({ allowedScope: array(write.allow, 32, 1), protectedPaths: array(write.protect, 128) });
  const requiredWrites = write.require === undefined ? undefined : prefixes(write.require, 32);
  if (requiredWrites !== undefined) {
    if (new Set(requiredWrites).size !== requiredWrites.length) fail("required writable paths must be unique");
    assertRequiredDevelopmentWrites(scope, requiredWrites);
  }
  const prepare = (raw.prepare === undefined ? [] : array(raw.prepare, 8)).map((value) => {
    const command = record(value, ["id", "command", "args"]);
    const id = text(command.id, 64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) fail("preparation id must be a safe identifier");
    return { id, command: text(command.command, 512), args: args(command.args) };
  });
  if (new Set(prepare.map((command) => command.id)).size !== prepare.length) fail("preparation ids must be unique");
  const checked = array(raw.checks, 8, 1).map((value) => {
    const check = record(value, CHECK_FIELDS);
    const expect = expectation(check.expect);
    const { expect: _expect, ...recipe } = check;
    recipe.args = args(recipe.args);
    if (recipe.protectedPaths !== undefined) recipe.protectedPaths = prefixes(recipe.protectedPaths, 16);
    return { recipe, expect };
  });
  const plan = snapshotDevelopmentCheckPlan({ checks: checked.map((check) => check.recipe) });
  const budget = record(raw.budget, ["totalSeconds", "prepareSeconds", "checkSeconds", "workerSeconds", "workerTotalSeconds", "checkTotalSeconds"]);
  const worker = raw.worker === undefined ? { model: "inherit" } : record(raw.worker, ["model", "maxAttempts"]);
  if (worker.model !== "inherit") fail("worker model must inherit; explicit model selection is unsupported");
  if (worker.maxAttempts !== undefined && (!Number.isSafeInteger(worker.maxAttempts) || Number(worker.maxAttempts) < 1 || Number(worker.maxAttempts) > 5)) fail("worker maxAttempts must be an integer from 1 to 5");
  return freeze({ version: 1, objective, context, write: { allow: scope.allowedScope, protect: scope.protectedPaths, ...(requiredWrites === undefined ? {} : { require: requiredWrites }) }, prepare,
    checks: plan.checks.map((check, index) => ({ ...check, expect: checked[index]!.expect })),
    budget: { totalSeconds: duration(budget.totalSeconds), prepareSeconds: duration(budget.prepareSeconds),
      checkSeconds: duration(budget.checkSeconds), workerSeconds: duration(budget.workerSeconds),
      ...(budget.workerTotalSeconds === undefined ? {} : { workerTotalSeconds: duration(budget.workerTotalSeconds) }),
      ...(budget.checkTotalSeconds === undefined ? {} : { checkTotalSeconds: duration(budget.checkTotalSeconds) }) },
    worker: { model: "inherit", ...(worker.maxAttempts === undefined ? {} : { maxAttempts: worker.maxAttempts as number }) } });
}

export function parseDevelopmentTaskSpec(text: string): DevelopmentTaskSpec {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 64 * 1024) fail("JSON text must be at most 64 KiB UTF8");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { return fail("invalid JSON"); }
  return snapshotDevelopmentTaskSpec(value);
}

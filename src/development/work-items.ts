import { DomainValidationError } from "../domain/errors.js";

export interface WorkItemRecipe {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly verifierVersion: string;
  /** Host-declared decisive checker/dependency prefixes, never worker-writable. */
  readonly protectedPaths?: readonly string[];
  /** Host command deadline; defaults to 5000 ms. All recipes together allow at most 40000 ms. */
  readonly timeoutMs?: number;
  /** Per-stream hard output caps; defaults to 2048 bytes, maximum 1 MiB each. */
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
}

export const DEFAULT_RECIPE_TIMEOUT_MS = 5000;
export const DEFAULT_RECIPE_OUTPUT_BYTES = 2048;
const MAX_RECIPE_TOTAL_TIMEOUT_MS = 40000;
const MAX_RECIPE_OUTPUT_BYTES = 1024 * 1024;
export interface WorkItemDefinition {
  readonly id: string;
  readonly goal: string;
  readonly dependencies: readonly string[];
  /** Literal repository-relative file/directory prefixes, never globs. */
  readonly allowedScope: readonly string[];
  readonly priority: number;
  readonly acceptance: readonly WorkItemRecipe[];
}
export type WorkItemStatus = "planned" | "running" | "blocked" | "ready-for-review" | "accepted";
export interface WorkItemClaim {
  readonly token: string;
  readonly owner: string;
  readonly baseRevision: string;
  readonly startedAt: string;
}
/** Bound metadata only. A host resolver must independently verify its artifact. */
export interface WorkItemEvidence {
  readonly source: "host-command";
  readonly workItemId: string;
  readonly baseRevision: string;
  readonly recipeId: string;
  readonly verifierVersion: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly artifactRef: string;
  readonly checkId: string;
  readonly exitCode: number;
}
export interface WorkItemRecord {
  readonly definition: WorkItemDefinition;
  readonly status: WorkItemStatus;
  readonly claim?: WorkItemClaim;
  readonly evidence?: readonly WorkItemEvidence[];
  readonly blockedReason?: string;
}
export interface WorkQueue {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly authorityRef: string;
  readonly revision: number;
  readonly items: readonly WorkItemRecord[];
}
export interface CreateWorkQueueInput {
  readonly id: string;
  readonly authorityRef: string;
  readonly items: readonly WorkItemDefinition[];
}

function fail(reason: string): never { throw new DomainValidationError(`work item queue: ${reason}`); }
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("expected a plain object");
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`unknown field ${key}`);
  return value as Record<string, unknown>;
}
export function workItemText(value: unknown, name: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || value.includes("\0")) fail(`invalid ${name}`);
  return value;
}
function id(value: unknown): string {
  const text = workItemText(value, "id", 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) fail("invalid id");
  return text;
}
export function workItemBaseRevision(value: unknown): string {
  const text = workItemText(value, "base revision", 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(text)) fail("base revision must be a full Git revision");
  return text;
}
function integer(value: unknown, maximum: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("integer out of bounds");
  return value;
}
function array(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail("array size out of bounds");
  return value;
}
function unique<T>(values: T[], keys: (item: T) => string): T[] {
  if (new Set(values.map(keys)).size !== values.length) fail("duplicate entries");
  return values;
}
function args(value: unknown): string[] {
  return array(value, 64).map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048 || entry.includes("\0")) fail("invalid command argument");
    return entry;
  });
}
export function workItemScope(value: unknown): string {
  const text = workItemText(value, "allowed scope", 256);
  const parts = text.split("/");
  if (/[:\\*?[\]]/.test(text) || parts.some((part) => part === "" || part === "." || part === "..") || parts[0] === ".git") {
    fail("allowed scope must be a safe literal relative path");
  }
  return text;
}
function recipe(value: unknown): WorkItemRecipe {
  const raw = object(value, ["id", "command", "args", "verifierVersion", "protectedPaths", "timeoutMs", "maxStdoutBytes", "maxStderrBytes"]);
  if (Object.values(Object.getOwnPropertyDescriptors(raw)).some((property) => !("value" in property))) {
    fail("recipes must contain ordinary values, not accessors");
  }
  const optionalLimit = (name: string, maximum: number): number | undefined => {
    const value: unknown = Object.getOwnPropertyDescriptor(raw, name)?.value;
    return value === undefined ? undefined : integer(value, maximum, 1);
  };
  const timeoutMs = optionalLimit("timeoutMs", MAX_RECIPE_TOTAL_TIMEOUT_MS);
  const maxStdoutBytes = optionalLimit("maxStdoutBytes", MAX_RECIPE_OUTPUT_BYTES);
  const maxStderrBytes = optionalLimit("maxStderrBytes", MAX_RECIPE_OUTPUT_BYTES);
  let protectedPaths: string[] | undefined;
  if (raw.protectedPaths !== undefined) {
    const paths = array(raw.protectedPaths, 16);
    protectedPaths = [];
    for (let index = 0; index < paths.length; index++) {
      const property = Object.getOwnPropertyDescriptor(paths, index);
      if (property === undefined || !("value" in property)) fail("protected paths must contain ordinary path values");
      protectedPaths.push(workItemScope(property.value));
    }
    unique(protectedPaths, (entry) => entry);
  }
  return { id: id(raw.id), command: workItemText(raw.command, "command"), args: args(raw.args),
    verifierVersion: workItemText(raw.verifierVersion, "verifier version", 128),
    ...(protectedPaths === undefined ? {} : { protectedPaths }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxStdoutBytes === undefined ? {} : { maxStdoutBytes }),
    ...(maxStderrBytes === undefined ? {} : { maxStderrBytes }) };
}

/** Validate and snapshot the whole host recipe set before any checker starts. */
export function prepareWorkItemRecipes(value: unknown): readonly WorkItemRecipe[] {
  const recipes = unique(array(value, 8, 1).map(recipe), (entry) => entry.id);
  if (recipes.reduce((total, entry) => total + (entry.timeoutMs ?? DEFAULT_RECIPE_TIMEOUT_MS), 0) > MAX_RECIPE_TOTAL_TIMEOUT_MS) {
    fail("combined recipe timeout exceeds 40000 ms");
  }
  return freezeWorkItemValue(recipes);
}
function definition(value: unknown): WorkItemDefinition {
  const raw = object(value, ["id", "goal", "dependencies", "allowedScope", "priority", "acceptance"]);
  return { id: id(raw.id), goal: workItemText(raw.goal, "goal", 4096),
    dependencies: unique(array(raw.dependencies, 32).map(id), (entry) => entry),
    allowedScope: unique(array(raw.allowedScope, 32, 1).map(workItemScope), (entry) => entry),
    priority: integer(raw.priority, 100), acceptance: prepareWorkItemRecipes(raw.acceptance) };
}
function claim(value: unknown): WorkItemClaim {
  const raw = object(value, ["token", "owner", "baseRevision", "startedAt"]);
  const startedAt = workItemText(raw.startedAt, "claim timestamp", 32);
  if (!Number.isFinite(Date.parse(startedAt)) || new Date(startedAt).toISOString() !== startedAt) fail("invalid claim timestamp");
  return { token: workItemText(raw.token, "claim token", 128), owner: workItemText(raw.owner, "owner", 128),
    baseRevision: workItemBaseRevision(raw.baseRevision), startedAt };
}
function evidence(value: unknown): WorkItemEvidence {
  const raw = object(value, ["source", "workItemId", "baseRevision", "recipeId", "verifierVersion", "command", "args", "artifactRef", "checkId", "exitCode"]);
  if (raw.source !== "host-command" || raw.exitCode !== 0) fail("successful host command evidence required");
  return { source: "host-command", workItemId: id(raw.workItemId), baseRevision: workItemBaseRevision(raw.baseRevision),
    recipeId: id(raw.recipeId), verifierVersion: workItemText(raw.verifierVersion, "verifier version", 128),
    command: workItemText(raw.command, "command"), args: args(raw.args), artifactRef: workItemText(raw.artifactRef, "artifact reference"),
    checkId: workItemText(raw.checkId, "check id", 128), exitCode: 0 };
}

export function freezeWorkItemValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeWorkItemValue(entry);
    Object.freeze(value);
  }
  return value;
}

/** Validate binding, not artifact authenticity; the store also requires a host resolver. */
export function validateWorkItemEvidence(
  value: unknown, item: WorkItemDefinition, currentClaim: WorkItemClaim, currentBaseRevision: string
): readonly WorkItemEvidence[] {
  if (workItemBaseRevision(currentBaseRevision) !== currentClaim.baseRevision) fail("current base revision changed from claim");
  const records = unique(array(value, 8, 1).map(evidence), (entry) => entry.recipeId);
  if (records.length !== item.acceptance.length) fail("evidence must cover every acceptance recipe");
  for (const entry of records) {
    const expected = item.acceptance.find((candidate) => candidate.id === entry.recipeId);
    if (entry.workItemId !== item.id || entry.baseRevision !== currentClaim.baseRevision || expected === undefined ||
        entry.verifierVersion !== expected.verifierVersion || entry.command !== expected.command ||
        entry.args.length !== expected.args.length || entry.args.some((arg, index) => arg !== expected.args[index])) {
      fail("evidence does not match work item/base/recipe/verifier binding");
    }
  }
  return freezeWorkItemValue(records);
}

function record(value: unknown): WorkItemRecord {
  const raw = object(value, ["definition", "status", "claim", "evidence", "blockedReason"]);
  const item = definition(raw.definition);
  const status = raw.status;
  if (status !== "planned" && status !== "running" && status !== "blocked" && status !== "ready-for-review" && status !== "accepted") fail("invalid work item status");
  if (status === "planned") {
    if (raw.claim !== undefined || raw.evidence !== undefined || raw.blockedReason !== undefined) fail("planned item cannot carry execution state");
    return { definition: item, status };
  }
  const currentClaim = claim(raw.claim);
  if (status === "blocked") {
    if (raw.evidence !== undefined) fail("blocked item cannot carry accepted evidence");
    return { definition: item, status, claim: currentClaim, blockedReason: workItemText(raw.blockedReason, "blocked reason", 2048) };
  }
  if (raw.blockedReason !== undefined) fail("unexpected blocked reason");
  if (status === "running") {
    if (raw.evidence !== undefined) fail("running item cannot carry accepted evidence");
    return { definition: item, status, claim: currentClaim };
  }
  return { definition: item, status, claim: currentClaim,
    evidence: validateWorkItemEvidence(raw.evidence, item, currentClaim, currentClaim.baseRevision) };
}

function validateGraph(items: readonly WorkItemRecord[]): void {
  const byId = new Map(items.map((entry) => [entry.definition.id, entry]));
  if (byId.size !== items.length) fail("duplicate work item ids");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): void {
    if (visiting.has(key)) fail("dependency cycle");
    if (visited.has(key)) return;
    const entry = byId.get(key);
    if (entry === undefined) fail(`unknown dependency ${key}`);
    visiting.add(key);
    for (const dependency of entry.definition.dependencies) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of byId.keys()) visit(key);
  for (const entry of items) {
    if (entry.status !== "planned" && entry.definition.dependencies.some((dependency) => byId.get(dependency)!.status !== "accepted")) {
      fail("claimed work item prerequisites must be accepted");
    }
  }
}

export function validateWorkQueue(value: unknown): WorkQueue {
  const raw = object(value, ["schemaVersion", "id", "authorityRef", "revision", "items"]);
  if (raw.schemaVersion !== 1) fail("unsupported schema version");
  const items = array(raw.items, 128, 1).map(record);
  validateGraph(items);
  return freezeWorkItemValue({ schemaVersion: 1, id: id(raw.id), authorityRef: workItemText(raw.authorityRef, "authority reference"),
    revision: integer(raw.revision, Number.MAX_SAFE_INTEGER), items });
}

export function createWorkQueue(input: CreateWorkQueueInput): WorkQueue {
  const raw = object(input, ["id", "authorityRef", "items"]);
  return validateWorkQueue({ schemaVersion: 1, id: raw.id, authorityRef: raw.authorityRef, revision: 0,
    items: array(raw.items, 128, 1).map((value) => ({ definition: value, status: "planned" })) });
}

export function workItemScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((left) => b.some((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
}

/** Read-only advisory selection; execution must use the store's reverified, locked claimNext. */
export function selectWorkItemCandidates(value: WorkQueue): readonly WorkItemDefinition[] {
  const queue = validateWorkQueue(value);
  const accepted = new Set(queue.items.filter((entry) => entry.status === "accepted").map((entry) => entry.definition.id));
  const active = queue.items.filter((entry) => entry.status !== "planned" && entry.status !== "accepted");
  return queue.items.filter((entry) => entry.status === "planned" &&
    entry.definition.dependencies.every((dependency) => accepted.has(dependency)) &&
    !active.some((other) => workItemScopesOverlap(entry.definition.allowedScope, other.definition.allowedScope)))
    .map((entry) => entry.definition)
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Read-only advisory selection; execution still requires the store's locked claim. */
export function selectNextWorkItem(value: WorkQueue): WorkItemDefinition | undefined {
  return selectWorkItemCandidates(value)[0];
}

import { spawnSync } from "node:child_process";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId, type RunId } from "../domain/ids.js";
import type { DevelopmentController } from "../development/controller.js";
import { assertRunPresent, loopArtifactPath, readLoopArtifact } from "../execution/loop-artifact.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { EventStore } from "../run/event-store.js";
import { INSPECTION_EVENT_READ_LIMITS, inspectRunEvents } from "../run/inspection.js";
import { ConversationFocus, conversationRecord, conversationTarget, conversationTargetKey, conversationText,
  type ConversationFocusLocation, type ConversationFocusSnapshot, type ConversationTarget } from "./focus.js";
import { parseConversationRequest } from "./session.js";

const REFERENCE_BYTES = 16 * 1024;
export interface ConversationReferences {
  readonly version: 1;
  readonly current?: ConversationFocusLocation;
  readonly suspended?: ConversationFocusLocation;
}
export interface ConversationRecoveryProject {
  readonly projectRef: string;
  readonly sourceRepo: string;
  readonly stateRoot: string;
  /** Required with controller; its existing action store is alongside this queue. */
  readonly queuePath?: string;
  readonly controller?: Pick<DevelopmentController, "status">;
}
export type ConversationRecoveryTask = ConversationTarget & { readonly taskRef: string } & (
  | { readonly kind: "direct"; readonly runId?: string; readonly artifactId?: string; readonly sourceRevision?: string }
  | { readonly kind: "queue"; readonly itemId: string }
);
export interface ConversationRecoveryOptions {
  readonly referenceFile: string;
  readonly projects: readonly ConversationRecoveryProject[];
  readonly tasks?: readonly ConversationRecoveryTask[];
}
type Availability = "available" | "stale" | "unavailable";
interface SourceFact { readonly availability: Availability; readonly revision?: string; readonly dirty?: boolean; readonly reasons: readonly string[]; }
interface TaskFact extends ConversationTarget {
  readonly kind: "direct" | "queue";
  readonly availability: Availability;
  readonly reasons: readonly string[];
  readonly run?: { readonly runId: string; readonly status: string; readonly artifactId: string };
  readonly item?: { readonly itemId: string; readonly status: string };
  readonly actions?: readonly { readonly actionId: string; readonly kind: string; readonly state: string }[];
}
export interface ConversationRecoveryFacts {
  readonly observedAt: string;
  readonly provenance: "host-bound";
  readonly readOnly: true;
  readonly source: SourceFact;
  readonly tasks: readonly TaskFact[];
}
export type ConversationRecoveryResponse =
  | { readonly kind: "question" | "focus" | "restore"; readonly focus: ConversationFocusSnapshot }
  | { readonly kind: "recovery-status"; readonly projectRef: string; readonly facts: ConversationRecoveryFacts; readonly staleFocus: boolean; readonly focus: ConversationFocusSnapshot };
function fail(reason: string): never { throw new DomainValidationError(`conversation recovery: ${reason}`); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function list(input: unknown, max: number, label: string): readonly unknown[] {
  if (!Array.isArray(input) || input.length > max) fail(`${label} must be a bounded array`);
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) fail(`${label} has unsupported fields`);
  return Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined || !("value" in descriptor)) fail(`${label} must contain ordinary values`);
    return descriptor.value as unknown;
  });
}
function location(input: unknown): ConversationFocusLocation {
  const value = conversationRecord(input, ["projectRef", "taskRef", "runId"], "saved location");
  const target = conversationTarget({ projectRef: value.projectRef, ...(value.taskRef === undefined ? {} : { taskRef: value.taskRef }) });
  return Object.freeze({ ...target, ...(value.runId === undefined ? {} : { runId: parseRunId(conversationText(value.runId, "runId", 128)) }) });
}
function references(input: unknown, fromFocus = false): ConversationReferences {
  const value = conversationRecord(input, fromFocus ? ["current", "suspended", "token", "messageRef"] : ["version", "current", "suspended"], "reference snapshot");
  if (!fromFocus && value.version !== 1) fail("unsupported reference version");
  if (fromFocus && value.token !== undefined) conversationRecord(value.token, ["generation", "revision"], "discarded focus token");
  const current = value.current === undefined ? undefined : location(value.current);
  const suspended = value.suspended === undefined ? undefined : location(value.suspended);
  if (suspended !== undefined && current === undefined) fail("suspended focus requires current focus");
  return Object.freeze({ version: 1, ...(current === undefined ? {} : { current }), ...(suspended === undefined ? {} : { suspended }) });
}
async function noLinks(file: string): Promise<void> {
  let cursor = path.resolve(file);
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) fail("linked storage is refused"); }
    catch (error) { if (!missing(error)) throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
async function regular(file: string, max: number): Promise<void> {
  await noLinks(file);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > max) fail("storage must be a bounded regular file");
}
/** Explicit host action; only pointers are persisted, never execution authority. */
export async function saveConversationReferences(referenceFile: string, focus: ConversationFocusSnapshot): Promise<void> {
  const snapshot = references(focus, true);
  const file = conversationText(referenceFile, "referenceFile", 8192);
  await noLinks(file);
  try { await regular(file, REFERENCE_BYTES); } catch (error) { if (!missing(error)) throw error; }
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json) > REFERENCE_BYTES) fail("reference snapshot too large");
  await writeFileAtomic(file, json, { mode: 0o600 });
}
export async function deleteConversationReferences(referenceFile: string): Promise<void> {
  const file = conversationText(referenceFile, "referenceFile", 8192);
  await noLinks(file);
  try { await regular(file, REFERENCE_BYTES); await unlink(file); } catch (error) { if (!missing(error)) throw error; }
}
async function loadReferences(file: string): Promise<ConversationReferences> {
  await regular(file, REFERENCE_BYTES);
  const handle = await open(file, "r");
  try {
    const before = await handle.stat(); const buffer = Buffer.alloc(REFERENCE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat(); const named = await lstat(file);
    if (!before.isFile() || bytesRead > REFERENCE_BYTES || before.size !== bytesRead || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ino !== named.ino || before.dev !== named.dev || named.isSymbolicLink()) fail("reference storage changed while reading");
    return references(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown);
  } finally { await handle.close(); }
}
type Status = Awaited<ReturnType<DevelopmentController["status"]>>;
interface Project {
  readonly projectRef: string; readonly sourceRepo: string; readonly stateRoot: string;
  readonly queuePath?: string; readonly status?: () => Promise<Status>;
  readonly sourceIdentity?: { readonly path: string; readonly dev: number; readonly ino: number };
}
function statusReader(input: unknown): (() => Promise<Status>) | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object") fail("controller must provide status");
  let prototype: object | null = input;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "status");
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") fail("controller status must be an ordinary method");
      return (descriptor.value as () => Promise<Status>).bind(input);
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  fail("controller must provide status");
}
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) fail("source read failed"); return result.stdout.trim();
}
async function source(project: Project): Promise<SourceFact> {
  try {
    const physical = await realpath(project.sourceRepo); const stat = await lstat(physical);
    if (project.sourceIdentity === undefined || physical !== project.sourceIdentity.path || stat.dev !== project.sourceIdentity.dev || stat.ino !== project.sourceIdentity.ino ||
      await realpath(git(physical, ["rev-parse", "--show-toplevel"])) !== physical) return { availability: "unavailable", reasons: ["source-identity-changed"] };
    const revision = git(physical, ["rev-parse", "HEAD"]); const dirty = git(physical, ["status", "--porcelain", "--untracked-files=normal"]) !== "";
    return { availability: dirty ? "stale" : "available", revision, dirty, reasons: dirty ? ["source-dirty"] : [] };
  } catch { return { availability: "unavailable", reasons: ["source-unavailable"] }; }
}
async function directFact(task: Extract<ConversationRecoveryTask, { kind: "direct" }>, project: Project, current: SourceFact): Promise<TaskFact> {
  const identity = { projectRef: task.projectRef, taskRef: task.taskRef, kind: task.kind };
  if (task.runId === undefined || task.artifactId === undefined || task.sourceRevision === undefined) return { ...identity, availability: "unavailable", reasons: ["direct-history-unmapped"] };
  const runId = parseRunId(task.runId);
  try {
    await assertRunPresent(project.stateRoot, runId, INSPECTION_EVENT_READ_LIMITS);
    const read = await new EventStore(project.stateRoot, runId).readAll(INSPECTION_EVENT_READ_LIMITS);
    if (read.recovery.incompleteLine !== undefined) return { ...identity, availability: "unavailable", reasons: ["run-incomplete-tail"] };
    const observed = inspectRunEvents(runId, read.events);
    await readLoopArtifact(project.stateRoot, runId, task.artifactId, { maxBytes: 1024 * 1024, eventLogLimits: INSPECTION_EVENT_READ_LIMITS });
    const reasons = [...current.reasons, ...(current.revision !== undefined && current.revision !== task.sourceRevision ? ["source-revision-changed"] : [])];
    return { ...identity, availability: current.availability === "unavailable" ? "unavailable" : reasons.length > 0 ? "stale" : "available", reasons,
      run: { runId, status: observed.status, artifactId: task.artifactId } };
  } catch { return { ...identity, availability: "unavailable", reasons: ["run-or-artifact-unavailable"] }; }
}

/** Restores lookup pointers and reads facts. It never restores a dispatch capability. */
export class ReadonlyConversationSession {
  private constructor(private readonly projects: ReadonlyMap<string, Project>, private readonly tasks: readonly ConversationRecoveryTask[],
    private readonly targets: readonly ConversationTarget[], private readonly pointers: ConversationFocus) {}

  static async load(input: ConversationRecoveryOptions): Promise<ReadonlyConversationSession> {
    const options = conversationRecord(input, ["referenceFile", "projects", "tasks"], "recovery options");
    const referenceFile = conversationText(options.referenceFile, "referenceFile", 8192);
    const projects = new Map<string, Project>(); const targets: ConversationTarget[] = [];
    for (const entry of list(options.projects, 64, "project bindings")) {
      const value = conversationRecord(entry, ["projectRef", "sourceRepo", "stateRoot", "queuePath", "controller"], "recovery project");
      const projectRef = conversationText(value.projectRef, "projectRef", 128);
      if (projects.has(projectRef)) fail("duplicate project reference");
      const sourceRepo = path.resolve(conversationText(value.sourceRepo, "sourceRepo", 8192));
      const stateRoot = path.resolve(conversationText(value.stateRoot, "stateRoot", 8192));
      const status = statusReader(value.controller);
      const queuePath = value.queuePath === undefined ? undefined : path.resolve(conversationText(value.queuePath, "queuePath", 8192));
      if (status !== undefined && queuePath === undefined) fail("controller requires its existing queuePath");
      projects.set(projectRef, Object.freeze({ projectRef, sourceRepo, stateRoot, ...(queuePath === undefined ? {} : { queuePath }),
        ...(status === undefined ? {} : { status }) }));
      targets.push(Object.freeze({ projectRef }));
    }
    const seen = new Set<string>();
    const tasks = list(options.tasks === undefined ? [] : options.tasks, 128, "task bindings").map((entry): ConversationRecoveryTask => {
      const value = conversationRecord(entry, ["projectRef", "taskRef", "kind", "runId", "artifactId", "sourceRevision", "itemId"], "recovery task");
      const target = conversationTarget({ projectRef: value.projectRef, taskRef: value.taskRef });
      if (target.taskRef === undefined || !projects.has(target.projectRef)) fail("unknown project or missing task reference");
      const key = conversationTargetKey(target); if (seen.has(key)) fail("duplicate task reference"); seen.add(key);
      let task: ConversationRecoveryTask;
      if (value.kind === "queue") {
        if (["runId", "artifactId", "sourceRevision"].some((field) => value[field] !== undefined)) fail("queue mapping cannot carry direct run fields");
        task = { ...target, taskRef: target.taskRef, kind: "queue", itemId: conversationText(value.itemId, "itemId", 256) };
      } else if (value.kind === "direct") {
        if (value.itemId !== undefined) fail("direct mapping cannot carry queue itemId");
        const fields = [value.runId, value.artifactId, value.sourceRevision];
        if (fields.some((field) => field !== undefined) && fields.some((field) => field === undefined)) fail("direct history requires runId, artifactId and sourceRevision together");
        const runId: RunId | undefined = value.runId === undefined ? undefined : parseRunId(conversationText(value.runId, "runId", 128));
        const artifactId = value.artifactId === undefined ? undefined : conversationText(value.artifactId, "artifactId", 128);
        if (runId !== undefined && artifactId !== undefined) loopArtifactPath("", runId, artifactId);
        task = { ...target, taskRef: target.taskRef, kind: "direct", ...(runId === undefined ? {} : { runId, artifactId: artifactId!, sourceRevision: conversationText(value.sourceRevision, "sourceRevision", 128) }) };
      } else fail("unknown recovery task kind");
      targets.push(Object.freeze({ ...target })); return Object.freeze(task);
    });
    // All host fields above are snapshotted before the first asynchronous read.
    for (const [projectRef, project] of projects) {
      try {
        const physical = await realpath(project.sourceRepo); const stat = await lstat(physical);
        projects.set(projectRef, Object.freeze({ ...project, sourceIdentity: { path: physical, dev: stat.dev, ino: stat.ino } }));
      } catch { /* Unavailable source is reported, never created. */ }
    }
    let snapshot: ConversationReferences;
    try { snapshot = await loadReferences(referenceFile); }
    catch (error) { fail(`reference file unavailable: ${missing(error) ? "missing" : "invalid or unreadable"}`); }
    for (const selected of [snapshot.current, snapshot.suspended]) {
      if (selected === undefined) continue;
      if (!targets.some((target) => conversationTargetKey(target) === conversationTargetKey(selected))) fail("unknown saved target");
      if (selected.runId !== undefined) {
        const binding = tasks.find((task) => conversationTargetKey(task) === conversationTargetKey(selected));
        if (binding?.kind !== "direct" || binding.runId !== selected.runId) fail("saved run does not match host-selected task mapping");
      }
    }
    const { version: _version, ...initial } = snapshot;
    return new ReadonlyConversationSession(projects, Object.freeze(tasks), Object.freeze(targets), new ConversationFocus(targets, initial));
  }
  refs(): readonly ConversationTarget[] { return this.targets; }
  focus(): ConversationFocusSnapshot { return this.pointers.snapshot(); }
  async handle(input: unknown, signal?: AbortSignal): Promise<ConversationRecoveryResponse> {
    const operation = parseConversationRequest(input);
    signal?.throwIfAborted();
    if (operation.kind === "run-direct") fail("read-only recovery cannot dispatch; prior execution ownership is not restored");
    this.pointers.assertCurrent(operation.focus);
    if (operation.kind === "question") return { kind: "question", focus: this.focus() };
    if (operation.kind === "focus") return { kind: "focus", focus: this.pointers.select(operation.target, operation.focus, operation.messageRef, operation.temporary) };
    if (operation.kind === "restore") return { kind: "restore", focus: this.pointers.restore(operation.focus, operation.messageRef) };
    const projectRef = operation.projectRef ?? this.focus().current?.projectRef;
    const project = projectRef === undefined ? undefined : this.projects.get(projectRef);
    if (project === undefined) fail("unknown project status reference");
    const observed = await source(project);
    const tasks: TaskFact[] = [];
    const selected = this.tasks.filter((task) => task.projectRef === project.projectRef);
    let status: Status | undefined;
    if (selected.some((task) => task.kind === "queue") && project.status !== undefined && project.queuePath !== undefined) {
      try {
        await regular(project.queuePath, 8 * 1024 * 1024);
        await regular(path.join(path.dirname(project.queuePath), "actions", "actions.json"), 8 * 1024 * 1024);
        status = await project.status();
      } catch { /* Absent/corrupt stores remain unavailable; do not bootstrap them. */ }
    }
    for (const task of selected) {
      if (task.kind === "direct") { tasks.push(await directFact(task, project, observed)); continue; }
      const item = status?.queue.items.find((entry) => entry.definition.id === task.itemId);
      if (item === undefined || status === undefined) { tasks.push({ projectRef: task.projectRef, taskRef: task.taskRef, kind: task.kind, availability: "unavailable", reasons: ["queue-item-unavailable"] }); continue; }
      const actions = status.actions.filter((action) => {
        try { const value: unknown = JSON.parse(action.inputCanonicalJson); return value !== null && typeof value === "object" && "itemId" in value && value.itemId === task.itemId && "queueId" in value && value.queueId === status!.queue.id; } catch { return false; }
      }).map((action) => ({ actionId: action.actionId, kind: action.kind, state: action.state }));
      const reasons = [...observed.reasons, ...(item.claim !== undefined && item.claim.baseRevision !== observed.revision ? ["source-revision-changed"] : [])];
      tasks.push({ projectRef: task.projectRef, taskRef: task.taskRef, kind: task.kind, availability: observed.availability === "unavailable" ? "unavailable" : reasons.length > 0 ? "stale" : "available", reasons,
        item: { itemId: task.itemId, status: item.status }, actions });
    }
    return { kind: "recovery-status", projectRef: project.projectRef, facts: { observedAt: new Date().toISOString(), provenance: "host-bound", readOnly: true, source: observed, tasks },
      staleFocus: !this.pointers.matches(operation.focus), focus: this.focus() };
  }
}

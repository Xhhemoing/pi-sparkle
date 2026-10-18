import { DomainValidationError } from "../domain/errors.js";
import type { DevelopmentController } from "../development/controller.js";
import { startDevelopmentTask, type StartDevelopmentTaskInput } from "../development/start-task.js";
import { assertTrustedVerificationDescriptor } from "../execution/trusted-verification.js";
import { prepareNativeWriteCriteria } from "../native/write-criteria.js";
import type { NativeWriteSessionResult } from "../native/write-session.js";
import { snapshotTaskPresentation } from "../preferences/task-presentation.js";
import {
  ConversationFocus, conversationRecord, conversationTarget, conversationTargetKey, conversationText, conversationToken,
  type ConversationFocusSnapshot, type ConversationFocusToken, type ConversationTarget
} from "./focus.js";

export interface ConversationProjectBinding {
  readonly projectRef: string;
  readonly controller?: Pick<DevelopmentController, "status">;
}
export interface ConversationTaskBinding extends ConversationTarget {
  readonly taskRef: string;
  /** Trusted host registration only; this input is never taken from a model request. */
  readonly input: Omit<StartDevelopmentTaskInput, "signal">;
}
export interface ConversationSessionOptions {
  readonly projects: readonly ConversationProjectBinding[];
  readonly tasks?: readonly ConversationTaskBinding[];
  /** In-memory consumed direct requests, never evicted. Default 128, maximum 1024. */
  readonly maxRequests?: number;
}
interface RequestBase { readonly messageRef: string; readonly focus: ConversationFocusToken; }
export type ConversationRequest =
  | (RequestBase & { readonly kind: "question" })
  | (RequestBase & { readonly kind: "status"; readonly projectRef?: string })
  | (RequestBase & { readonly kind: "focus"; readonly target: ConversationTarget; readonly temporary?: boolean })
  | (RequestBase & { readonly kind: "restore" })
  | (RequestBase & { readonly kind: "run-direct"; readonly target: ConversationTarget; readonly requestId: string });
type ProjectStatus = Awaited<ReturnType<DevelopmentController["status"]>>;
export type ConversationResponse =
  | { readonly kind: "question" | "focus" | "restore"; readonly focus: ConversationFocusSnapshot }
  | { readonly kind: "status"; readonly projectRef: string; readonly status: ProjectStatus; readonly staleFocus: boolean; readonly focus: ConversationFocusSnapshot }
  | { readonly kind: "direct-result"; readonly requestId: string; readonly messageRef: string; readonly target: ConversationTarget;
      readonly result: NativeWriteSessionResult; readonly staleFocus: boolean; readonly focus: ConversationFocusSnapshot };

function fail(reason: string): never { throw new DomainValidationError(`conversation session: ${reason}`); }
function integer(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`${label} must be an integer in 1..${maximum}`);
  return value;
}
function array(input: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(input) || input.length > maximum) fail(`${label} must be an array of at most ${maximum} ordinary values`);
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) fail(`${label} has unsupported fields`);
  return Object.freeze(Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined || !("value" in descriptor)) fail(`${label} must contain ordinary values`);
    return descriptor.value as unknown;
  }));
}
function exitCodes(input: unknown, label: string): readonly number[] | undefined {
  if (input === undefined) return undefined;
  const result = array(input, 255, label).map((value) => integer(value, 255, label));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`);
  return Object.freeze(result);
}
function snapshotTask(input: unknown): Omit<StartDevelopmentTaskInput, "signal"> {
  const value = conversationRecord(input, ["stateRoot", "executorFactory", "sandboxRoot", "sourceRepo", "objective", "verification",
    "maxAttempts", "maxWallTimeMs", "acceptanceCriteria", "presentation"], "registered task input");
  if (typeof value.executorFactory !== "function") fail("registered task requires an executorFactory");
  const verification = conversationRecord(value.verification, ["command", "args", "trustedVerification", "repairableExitCodes", "unsettledExitCodes"], "host verification");
  const args = Object.freeze(array(verification.args === undefined ? [] : verification.args, 256, "verification args").map((arg) => {
    if (typeof arg !== "string" || arg.includes("\0") || arg.length > 8192) fail("verification args must be strings of at most 8192 characters without NUL");
    return arg;
  }));
  if (args.reduce((total, arg) => total + arg.length, 0) > 65536) fail("verification argv exceeds 65536 characters");
  const command = conversationText(verification.command, "verification command", 8192);
  const trustedVerification = verification.trustedVerification as StartDevelopmentTaskInput["verification"]["trustedVerification"];
  if (trustedVerification !== undefined) assertTrustedVerificationDescriptor(trustedVerification, command, args);
  const repairableExitCodes = exitCodes(verification.repairableExitCodes, "repairableExitCodes");
  const unsettledExitCodes = exitCodes(verification.unsettledExitCodes, "unsettledExitCodes");
  if (unsettledExitCodes?.some((code) => repairableExitCodes?.includes(code))) fail("unsettled exit codes cannot authorize repair");
  const acceptanceCriteria = prepareNativeWriteCriteria(value.acceptanceCriteria);
  const presentation = snapshotTaskPresentation(value.presentation as StartDevelopmentTaskInput["presentation"]);
  return Object.freeze({
    stateRoot: conversationText(value.stateRoot, "stateRoot", 8192), sourceRepo: conversationText(value.sourceRepo, "sourceRepo", 8192),
    objective: conversationText(value.objective, "objective", 65536), executorFactory: value.executorFactory as StartDevelopmentTaskInput["executorFactory"],
    ...(value.sandboxRoot === undefined ? {} : { sandboxRoot: conversationText(value.sandboxRoot, "sandboxRoot", 8192) }),
    verification: Object.freeze({ command, args, ...(trustedVerification === undefined ? {} : { trustedVerification }),
      ...(repairableExitCodes === undefined ? {} : { repairableExitCodes }), ...(unsettledExitCodes === undefined ? {} : { unsettledExitCodes }) }),
    ...(value.maxAttempts === undefined ? {} : { maxAttempts: integer(value.maxAttempts, 5, "maxAttempts") }),
    ...(value.maxWallTimeMs === undefined ? {} : { maxWallTimeMs: integer(value.maxWallTimeMs, 1800000, "maxWallTimeMs") }),
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }), ...(presentation === undefined ? {} : { presentation })
  });
}

function request(input: unknown): ConversationRequest {
  const common = ["kind", "messageRef", "focus"];
  // Read kind only from an ordinary own field before selecting the closed shape.
  if (input === null || typeof input !== "object") fail("request must be a plain object");
  const kindDescriptor = Object.getOwnPropertyDescriptor(input, "kind");
  if (kindDescriptor === undefined || !("value" in kindDescriptor)) fail("request kind must be an ordinary value");
  const kind: unknown = kindDescriptor.value;
  const extra = kind === "focus" ? ["target", "temporary"] : kind === "status" ? ["projectRef"] : kind === "run-direct" ? ["target", "requestId"] : [];
  if (!["question", "status", "focus", "restore", "run-direct"].includes(kind as string)) fail("unsupported request kind");
  const value = conversationRecord(input, [...common, ...extra], "request");
  const base = { messageRef: conversationText(value.messageRef, "messageRef"), focus: conversationToken(value.focus) };
  if (kind === "question" || kind === "restore") return Object.freeze({ ...base, kind });
  if (kind === "status") return Object.freeze({ ...base, kind, ...(value.projectRef === undefined ? {} : { projectRef: conversationText(value.projectRef, "projectRef", 128) }) });
  const target = conversationTarget(value.target);
  if (kind === "run-direct") return Object.freeze({ ...base, kind, target, requestId: conversationText(value.requestId, "requestId", 128) });
  if (value.temporary !== undefined && typeof value.temporary !== "boolean") fail("temporary must be a boolean");
  return Object.freeze({ ...base, kind: "focus", target, ...(value.temporary === undefined ? {} : { temporary: value.temporary as boolean }) });
}

/**
 * Experimental trusted-host facade. Interpreting messages and authorizing these
 * registrations belongs to the host; structured requests never issue authority.
 * In-memory replay guards are not durable exactly-once execution or an OS sandbox.
 */
export class ConversationSession {
  private readonly projects = new Map<string, (() => Promise<ProjectStatus>) | undefined>();
  private readonly tasks = new Map<string, Omit<StartDevelopmentTaskInput, "signal">>();
  private readonly pointers: ConversationFocus;
  private readonly maxRequests: number;
  private readonly consumedRequests = new Set<string>();
  private readonly consumedMessages = new Set<string>();
  private active = false;
  private fenced = false;

  constructor(input: ConversationSessionOptions) {
    const options = conversationRecord(input, ["projects", "tasks", "maxRequests"], "session options");
    this.maxRequests = integer(options.maxRequests === undefined ? 128 : options.maxRequests, 1024, "maxRequests");
    const targets: ConversationTarget[] = [];
    for (const item of array(options.projects, 64, "project bindings")) {
      const binding = conversationRecord(item, ["projectRef", "controller"], "project binding");
      const projectRef = conversationText(binding.projectRef, "projectRef", 128);
      if (this.projects.has(projectRef)) fail("duplicate project binding");
      const controller = binding.controller as ConversationProjectBinding["controller"];
      if (controller !== undefined && (controller === null || typeof controller.status !== "function")) fail("controller must provide status()");
      this.projects.set(projectRef, controller === undefined ? undefined : controller.status.bind(controller));
      targets.push(Object.freeze({ projectRef }));
    }
    for (const item of array(options.tasks === undefined ? [] : options.tasks, 128, "task bindings")) {
      const binding = conversationRecord(item, ["projectRef", "taskRef", "input"], "task binding");
      const target = conversationTarget({ projectRef: binding.projectRef, taskRef: binding.taskRef });
      if (target.taskRef === undefined || !this.projects.has(target.projectRef)) fail("unknown project or missing task reference");
      const key = conversationTargetKey(target);
      if (this.tasks.has(key)) fail("duplicate task binding");
      this.tasks.set(key, snapshotTask(binding.input));
      targets.push(target);
    }
    this.pointers = new ConversationFocus(targets);
  }

  focus(): ConversationFocusSnapshot { return this.pointers.snapshot(); }

  async handle(input: ConversationRequest, signal?: AbortSignal): Promise<ConversationResponse> {
    const operation = request(input);
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail("signal must be a host AbortSignal");
    if (operation.kind === "run-direct") {
      // Consumed provenance wins over a now-stale focus token. Never evict it.
      if (this.consumedRequests.has(operation.requestId) || this.consumedMessages.has(operation.messageRef)) fail("direct request provenance already used");
      this.pointers.assertCurrent(operation.focus);
      const binding = this.tasks.get(conversationTargetKey(operation.target));
      if (binding === undefined) fail("unknown direct task binding");
      const current = this.focus().current;
      if (current === undefined || conversationTargetKey(current) !== conversationTargetKey(operation.target)) fail("direct task must match current focus");
      if (this.fenced) fail("direct execution fenced; host reconciliation is required before creating a new session");
      if (this.active) fail("another direct task is active");
      if (this.consumedRequests.size >= this.maxRequests) fail("direct request provenance capacity exhausted");
      signal?.throwIfAborted();
      // Reserve all in-memory guards before any worker allocation or await.
      this.consumedRequests.add(operation.requestId);
      this.consumedMessages.add(operation.messageRef);
      this.active = true;
      try {
        const result = await startDevelopmentTask({ ...binding, ...(signal === undefined ? {} : { signal }) });
        if (result.effectsSettled === false) this.fenced = true;
        const staleFocus = !this.pointers.recordRun(operation.focus, result.runId, operation.messageRef);
        return Object.freeze({ kind: "direct-result", requestId: operation.requestId, messageRef: operation.messageRef,
          target: operation.target, result, staleFocus, focus: this.focus() });
      } catch (error) {
        // A thrown dispatch cannot prove that no candidate/effect was allocated.
        this.fenced = true;
        throw error;
      } finally {
        // startDevelopmentTask awaits NativeWriteSession.shutdown, including cancellation.
        this.active = false;
      }
    }
    this.pointers.assertCurrent(operation.focus);
    if (operation.kind === "focus") return Object.freeze({ kind: "focus", focus: this.pointers.select(operation.target, operation.focus, operation.messageRef, operation.temporary) });
    if (operation.kind === "restore") return Object.freeze({ kind: "restore", focus: this.pointers.restore(operation.focus, operation.messageRef) });
    if (operation.kind === "question") return Object.freeze({ kind: "question", focus: this.focus() });
    const projectRef = operation.projectRef ?? this.focus().current?.projectRef;
    if (projectRef === undefined || !this.projects.has(projectRef)) fail("unknown project status reference");
    const status = this.projects.get(projectRef);
    if (status === undefined) fail("project status is not registered");
    const observed = await status();
    return Object.freeze({ kind: "status", projectRef, status: observed, staleFocus: !this.pointers.matches(operation.focus), focus: this.focus() });
  }
}

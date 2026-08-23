import { DomainValidationError } from "../domain/errors.js";
import type { EpisodeId, ProjectId, RunId, TaskId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { FeedbackKind } from "../feedback/types.js";
import type { EpisodeSignatureKind } from "./signatures.js";
import type { Event } from "../run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "../protocol/v1.js";
import { classifyTaskFailure } from "../routing/failure-class.js";
import type { FailureClass, OutcomeCriterion, OutcomeKind } from "../routing/outcomes.js";
import {
  taskSuccessFromResult,
  type TaskSuccessRouteBinding
} from "./task-success.js";

export type SignalSource = "user" | "subagent" | "deterministic";

export interface ObservedSignal {
  readonly source: SignalSource;
  readonly kind: FeedbackKind;
  readonly projectId: ProjectId;
  readonly modelId?: string | undefined;
  readonly modelVersion?: string | undefined;
  readonly role?: string | undefined;
  readonly family?: string | undefined;
  readonly featureVersion?: string | undefined;
  readonly score: number;
  readonly criterion?: OutcomeCriterion | undefined;
  readonly outcomeKind?: OutcomeKind | undefined;
  /**
   * Attribution of a taskSuccess FAIL. Only `model` failures may lower a
   * model's routing posterior; contract/tool/environment/run failures must
   * stay out of the bandit and avoid diagnostics. Missing = not attributable.
   */
  readonly failureClass?: FailureClass | undefined;
  readonly boundary: EpisodeSignatureKind;
  readonly summary: string;
  readonly episodeId?: EpisodeId | undefined;
  readonly runId?: RunId | undefined;
  readonly taskId?: TaskId | undefined;
  readonly evidenceIds: readonly string[];
  readonly createdAt: IsoTimestamp;
}

export interface SignalContext {
  readonly episodeId?: EpisodeId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly projectRoot?: string | undefined;
}

const USER_NEGATIVE = /\b(no|wrong|revert|reject|bad|不行|错误)\b/i;
const USER_POSITIVE = /\b(lgtm|good|ship|approve|yes|可以)\b/i;
const PEER_NEGATIVE = /\b(fail|bug|issue|missing|violation|unknown agent|错误)\b/i;

export function scoreTaskResult(outcome: TaskOutcome, verification: VerificationKind): number {
  if (outcome === "FAILURE" || verification === "FAILED") return 15;
  if (outcome === "CANCELLED") return 25;
  if (verification === "PASSED") return 90;
  if (outcome === "PARTIAL") return 50;
  if (verification === "UNOBSERVED") return 45;
  return 70;
}

export function scoreUserAnswer(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (USER_NEGATIVE.test(trimmed)) return 10;
  if (USER_POSITIVE.test(trimmed)) return 90;
  return undefined;
}

export function parseObservedSignal(value: unknown): ObservedSignal {
  if (!isRecord(value)) {
    throw new DomainValidationError("observed signal must be an object");
  }
  if (value.source !== "user" && value.source !== "subagent" && value.source !== "deterministic") {
    throw new DomainValidationError("observed signal source is invalid");
  }
  if (typeof value.kind !== "string" || value.kind.trim() === "") {
    throw new DomainValidationError("observed signal kind is required");
  }
  if (typeof value.projectId !== "string" || value.projectId.trim() === "") {
    throw new DomainValidationError("observed signal projectId is required");
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new DomainValidationError("observed signal score is required");
  }
  if (typeof value.boundary !== "string") {
    throw new DomainValidationError("observed signal boundary is required");
  }
  if (typeof value.summary !== "string") {
    throw new DomainValidationError("observed signal summary is required");
  }
  if (typeof value.createdAt !== "string") {
    throw new DomainValidationError("observed signal createdAt is required");
  }
  if (value.criterion === "taskSuccess" && (value.source === "user" || value.kind === "human")) {
    throw new DomainValidationError("extraSignals cannot forge criterion taskSuccess");
  }
  if (value.failureClass !== undefined) {
    throw new DomainValidationError("extraSignals cannot forge failureClass");
  }
  const derivedFailureClass =
    value.outcomeKind === "FAIL"
      ? classifyTaskFailure({
          outcome: "FAILURE",
          verificationKind: "FAILED",
          summary: typeof value.summary === "string" ? value.summary : ""
        })
      : undefined;
  return baseSignal({
    source: value.source,
    kind: value.kind as ObservedSignal["kind"],
    projectId: value.projectId as ProjectId,
    score: value.score,
    boundary: value.boundary as ObservedSignal["boundary"],
    summary: value.summary,
    createdAt: value.createdAt as ObservedSignal["createdAt"],
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.modelVersion === "string" ? { modelVersion: value.modelVersion } : {}),
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.family === "string" ? { family: value.family } : {}),
    ...(typeof value.featureVersion === "string" ? { featureVersion: value.featureVersion } : {}),
    ...(typeof value.criterion === "string" ? { criterion: value.criterion as ObservedSignal["criterion"] } : {}),
    ...(typeof value.outcomeKind === "string"
      ? { outcomeKind: value.outcomeKind as ObservedSignal["outcomeKind"] }
      : {}),
    ...(derivedFailureClass !== undefined ? { failureClass: derivedFailureClass } : {}),
    ...(typeof value.episodeId === "string" ? { episodeId: value.episodeId as EpisodeId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId as RunId } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId as TaskId } : {}),
    ...(Array.isArray(value.evidenceIds)
      ? { evidenceIds: value.evidenceIds.filter((id): id is string => typeof id === "string") }
      : {})
  });
}

/**
 * Turn a completed run's events into column-separated signals.
 * User answers are userAcceptance and are never bound to the last routed model.
 * taskSuccess is delegated to the deterministic adapter (TASK_RESULT PASSED/FAILED).
 * USER_ANSWER, JUDGE_DECISION, and TRACKING_ASSESSMENT never write that criterion.
 * Numeric process exits on Pi subagent runs are not taskSuccess.
 *
 * Model bindings follow event order: MODEL_ROUTED opens a binding and a
 * cascade TASK_RETRY rebinds the task to the escalated model, so a result
 * after escalation is attributed to the model that actually produced it.
 */
export function collectSignalsFromEvents(
  events: readonly Event[],
  context: SignalContext = {}
): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const timedOutTasks = new Set<string>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      break;
    }
  }
  if (projectId === undefined) return [];

  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) {
        familyByTask.set(event.payload.taskId, event.payload.family);
      }
      if (event.payload.modelVersion !== undefined) {
        modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      }
      if (event.payload.featureVersion !== undefined) {
        featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
      }
    }
    if (event.type === "TASK_TIMEOUT" && event.taskId !== undefined) {
      timedOutTasks.add(event.taskId);
    }
    if (event.type === "TASK_RETRY" && event.taskId !== undefined) {
      const nextModel = event.payload.nextModel;
      if (nextModel !== undefined && nextModel.trim() !== "" && modelByTask.has(event.taskId)) {
        modelByTask.set(event.taskId, nextModel);
        const nextVersion = event.payload.nextModelVersion;
        if (nextVersion !== undefined && nextVersion.trim() !== "") {
          modelVersionByTask.set(event.taskId, nextVersion);
        } else {
          // The escalated model's version is unknown — never let the previous
          // model's version impersonate it.
          modelVersionByTask.delete(event.taskId);
        }
      }
    }
    if (event.type === "CHILD_MESSAGE") {
      const message = event.payload.message;
      const fromResult = signalFromAgentMessage(message, {
        projectId,
        modelByTask,
        modelVersionByTask,
        roleByTask,
        familyByTask,
        featureVersionByTask,
        timedOutTasks,
        episodeId: context.episodeId,
        createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignal({
          source: "user",
          kind: "human",
          projectId,
          score,
          criterion: "userAcceptance",
          outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review",
          summary: truncate(`user: ${event.payload.answer}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignal({
          source: "deterministic",
          kind: "judge",
          projectId,
          score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED"
              ? "PASS"
              : event.payload.verdict === "REJECTED"
                ? "FAIL"
                : "ABSTAIN",
          boundary: "review",
          summary: `judge ${event.payload.verdict}`,
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId,
          taskId: event.payload.taskId,
          evidenceIds: event.payload.evidenceIds,
          ...(modelId !== undefined ? { modelId } : {}),
          ...(roleByTask.get(event.payload.taskId) !== undefined
            ? { role: roleByTask.get(event.payload.taskId) }
            : {}),
          ...(familyByTask.get(event.payload.taskId) !== undefined
            ? { family: familyByTask.get(event.payload.taskId) }
            : {})
        })
      );
    }
    if (event.type === "RUN_FAILED") {
      signals.push(
        baseSignal({
          source: "deterministic",
          kind: "deterministic",
          projectId,
          score: 10,
          boundary: "execution",
          summary: truncate(`run failed: ${event.payload.reason}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
  }
  return signals;
}

export function collectSignalsFromSubagentRun(raw: unknown, context: SignalContext): ObservedSignal[] {
  if (!isRecord(raw) || context.projectId === undefined) return [];
  const request = isRecord(raw.request) ? raw.request : {};
  const results = Array.isArray(raw.results) ? raw.results : [];
  const status = typeof raw.status === "string" ? raw.status : "";
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();

  for (const result of results) {
    if (!isRecord(result)) continue;
    const agent = typeof result.agent === "string" ? result.agent : typeof request.agent === "string" ? request.agent : undefined;
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
    const extracted = extractAssistant(result.messages);
    const failed =
      status === "failed" ||
      status === "error" ||
      exitCode === 1 ||
      PEER_NEGATIVE.test(extracted.text);
    const score = failed ? 15 : 70;
    const kind: FeedbackKind = agent === "reviewer" || agent === "tester" ? "peer" : "deterministic";
    signals.push(
      baseSignal({
        source: "subagent",
        kind,
        projectId: context.projectId,
        score,
        boundary: failed && /unknown agent/i.test(extracted.text) ? "tool" : "execution",
        summary: truncate(extracted.text === "" ? `subagent ${status || "completed"}` : extracted.text),
        createdAt,
        episodeId: context.episodeId,
        ...(extracted.model !== undefined ? { modelId: extracted.model } : {}),
        ...(agent !== undefined ? { role: agent } : {})
      })
    );
  }
  return signals;
}

function signalFromAgentMessage(
  message: AgentMessage,
  ctx: {
    projectId: ProjectId;
    modelByTask: ReadonlyMap<string, string>;
    modelVersionByTask: ReadonlyMap<string, string>;
    roleByTask: ReadonlyMap<string, string>;
    familyByTask: ReadonlyMap<string, string>;
    featureVersionByTask: ReadonlyMap<string, string>;
    timedOutTasks: ReadonlySet<string>;
    episodeId?: EpisodeId | undefined;
    createdAt: IsoTimestamp;
  }
): ObservedSignal | undefined {
  if (message.type === "TASK_RESULT") {
    const modelId = ctx.modelByTask.get(message.taskId);
    const role = ctx.roleByTask.get(message.taskId);
    const family = ctx.familyByTask.get(message.taskId) ?? familyFromRole(role);
    const modelVersion = ctx.modelVersionByTask.get(message.taskId);
    const featureVersion = ctx.featureVersionByTask.get(message.taskId);
    const unverified = message.outcome === "SUCCESS" && message.verification.kind === "UNOBSERVED";
    const binding: TaskSuccessRouteBinding = {
      ...(modelId !== undefined ? { modelId } : {}),
      ...(modelVersion !== undefined ? { modelVersion } : {}),
      ...(family !== undefined ? { family } : {}),
      ...(featureVersion !== undefined ? { featureVersion } : {}),
      ...(role !== undefined ? { role } : {})
    };
    const taskSuccess = taskSuccessFromResult(message.outcome, message.verification.kind, binding);
    const failureClass =
      taskSuccess?.outcomeKind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            timedOut: ctx.timedOutTasks.has(message.taskId),
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    return baseSignal({
      source: "subagent",
      kind: "deterministic",
      projectId: ctx.projectId,
      score: scoreTaskResult(message.outcome, message.verification.kind),
      boundary: "execution",
      summary: truncate(
        `${unverified ? "unverified-success " : ""}TASK_RESULT ${message.outcome}: ${message.summary}`
      ),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      evidenceIds: message.evidenceIds,
      ...(taskSuccess !== undefined
        ? {
            criterion: taskSuccess.criterion,
            outcomeKind: taskSuccess.outcomeKind,
            ...(failureClass !== undefined ? { failureClass } : {}),
            ...(taskSuccess.modelVersion !== undefined ? { modelVersion: taskSuccess.modelVersion } : {}),
            ...(taskSuccess.featureVersion !== undefined
              ? { featureVersion: taskSuccess.featureVersion }
              : {})
          }
        : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(family !== undefined ? { family } : {})
    });
  }
  if (message.type === "PEER_MESSAGE") {
    const score = PEER_NEGATIVE.test(message.body) ? 25 : 65;
    const modelId = ctx.modelByTask.get(message.taskId);
    return baseSignal({
      source: "subagent",
      kind: "peer",
      projectId: ctx.projectId,
      score,
      criterion: "policyCompliance",
      outcomeKind: score < 40 ? "FAIL" : "PASS",
      boundary: "review",
      summary: truncate(`peer: ${message.body}`),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      ...(modelId !== undefined ? { modelId } : {})
    });
  }
  return undefined;
}

function familyFromRole(role: string | undefined): string | undefined {
  if (role === "critic" || role === "reviewer") return "review";
  if (role === "tester") return "test";
  if (role === "scout") return "research";
  if (role === "planner") return "plan";
  if (role === "actor" || role === "implementer" || role === "worker" || role === "debugger") return "edit";
  return undefined;
}

function extractAssistant(messages: unknown): { text: string; model?: string } {
  if (!Array.isArray(messages)) return { text: "" };
  let text = "";
  let model: string | undefined;
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    if (typeof message.model === "string" && message.model.trim() !== "") {
      model = message.model;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type === "thinking") continue;
      if (part.type === "text" && typeof part.text === "string") {
        text = text === "" ? part.text : `${text}\n${part.text}`;
      }
    }
  }
  return model !== undefined ? { text, model } : { text };
}

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

function baseSignal(input: {
  source: SignalSource;
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: RunId | undefined;
  taskId?: TaskId | undefined;
  modelId?: string | undefined;
  modelVersion?: string | undefined;
  role?: string | undefined;
  family?: string | undefined;
  featureVersion?: string | undefined;
  criterion?: OutcomeCriterion | undefined;
  outcomeKind?: OutcomeKind | undefined;
  failureClass?: FailureClass | undefined;
  evidenceIds?: readonly string[] | undefined;
}): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? [],
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.modelVersion !== undefined ? { modelVersion: input.modelVersion } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.featureVersion !== undefined ? { featureVersion: input.featureVersion } : {}),
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(input.outcomeKind !== undefined ? { outcomeKind: input.outcomeKind } : {}),
    ...(input.failureClass !== undefined ? { failureClass: input.failureClass } : {}),
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  };
}

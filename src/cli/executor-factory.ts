import { FakeExecutor } from "../testing/fake-executor.js";
import { createConfiguredPiExecutor } from "../pi-adapter/runtime.js";
import type { CostGateEvent } from "../pi-adapter/pi-executor.js";
import { DomainValidationError } from "../domain/errors.js";
import { loadProvidersConfig, type ProvidersConfig } from "../config/providers-config.js";
import { parseModelRef, type ModelRef } from "../config/model-ref.js";
import type { ArtifactId, EvidenceId, MessageId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutor, AgentExecutionRequest, ExecutionEvent } from "../execution/contract.js";
import { resolveThinkingLevel, type CliThinkingLevel } from "./run-options.js";

/** Fake executor that speaks protocol v1: emits a terminal TASK_RESULT. */
class ChildFakeExecutor implements AgentExecutor {
  async *execute(
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_fake-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: "SUPERVISOR",
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

export interface CliExecutorHooks {
  readonly onInvocation?: (invocation: import("../telemetry/model-invocation.js").ModelInvocation) => void;
  readonly onCostGate?: (event: CostGateEvent) => void;
}

/** Only these environment values participate in executor construction. */
export interface CliExecutorEnvironment {
  readonly PI_PROVIDER?: string;
  readonly PI_MODEL?: string;
  readonly PI_API_KEY?: string;
  readonly PI_THINKING_LEVEL?: string;
}

/** Pure assembly; reading provider state and constructing Pi stay in the factory. */
export function resolveCliPiExecutorOptions(input: {
  readonly stateRoot: string;
  readonly config: ProvidersConfig;
  readonly env: CliExecutorEnvironment;
  readonly hooks?: CliExecutorHooks;
  readonly modelOverride?: ModelRef;
  readonly thinkingLevel?: CliThinkingLevel;
  readonly executorModelOverride?: ModelRef;
}): Parameters<typeof createConfiguredPiExecutor>[0] {
  const { stateRoot, config, hooks, modelOverride, thinkingLevel, executorModelOverride } = input;
  const envProvider = input.env.PI_PROVIDER;
  const envModel = input.env.PI_MODEL;
  const primary = config.primary !== undefined ? parseModelRef(config.primary) : undefined;
  // Precedence: explicit --primary-model flag > env vars > providers.json.
  // --executor-model is distinct from --primary-model: it pins only the
  // executor's model, while --primary-model continues to drive the track
  // router's premium alias. Explicit flag > env vars > providers.json.
  const executorOverride = executorModelOverride ?? modelOverride;
  const providerId = executorOverride?.providerId ?? envProvider ?? primary?.providerId;
  const modelId = executorOverride?.modelId ?? envModel ?? primary?.modelId;
  if (providerId === undefined || modelId === undefined) {
    throw new DomainValidationError(
      "--executor pi requires an enabled primary model (pi-sparkle models set-default) or PI_PROVIDER and PI_MODEL"
    );
  }
  const requestedLevel = thinkingLevel ?? resolveThinkingLevel(undefined, input.env.PI_THINKING_LEVEL ?? "off");
  const fast = config.fast !== undefined ? parseModelRef(config.fast) : undefined;
  const envRef = envProvider !== undefined && envModel !== undefined
    ? { providerId: envProvider, modelId: envModel }
    : undefined;
  const effectiveRef = executorOverride ?? envRef;
  const premiumAlias = primary && executorOverride === undefined ? primary : (effectiveRef ?? primary);
  const cheapAlias = fast ?? premiumAlias;
  return {
    stateRoot,
    providerId,
    modelId,
    thinkingLevel: requestedLevel,
    customProviders: config.customProviders,
    ...(input.env.PI_API_KEY !== undefined ? { apiKey: input.env.PI_API_KEY } : {}),
    ...(cheapAlias !== undefined || premiumAlias !== undefined
      ? {
          aliases: {
            ...(cheapAlias !== undefined ? { cheap: cheapAlias } : {}),
            ...(premiumAlias !== undefined ? { premium: premiumAlias } : {})
          }
        }
      : {}),
    ...(fast !== undefined && (fast.providerId !== providerId || fast.modelId !== modelId)
      ? { fallbackModels: [fast] }
      : {}),
    ...(hooks?.onInvocation !== undefined ? { onInvocation: hooks.onInvocation } : {}),
    // Only the real executor has a cost gate. The fake executors ignore a cap
    // by design, so wiring the sink onto them would promise a warning that
    // could never fire.
    ...(hooks?.onCostGate !== undefined ? { onCostGate: hooks.onCostGate } : {})
  };
}

export async function createCliExecutor(
  kind: string,
  stateRoot: string,
  hooks?: CliExecutorHooks,
  /** Explicit --primary-model wins over ambient env vars and providers.json. */
  modelOverride?: { readonly providerId: string; readonly modelId: string },
  /** Already-resolved --thinking level; falls back to PI_THINKING_LEVEL here. */
  thinkingLevel?: CliThinkingLevel,
  /** Explicit --executor-model pins the pi executor to a concrete model. */
  executorModelOverride?: { readonly providerId: string; readonly modelId: string }
): Promise<AgentExecutor> {
  if (kind === "fake") {
    return new FakeExecutor([
      { type: "TEXT_DELTA", text: "fake worker: objective received" },
      { type: "TOOL_STARTED", toolCallId: "fake-1", toolName: "read_file" },
      { type: "TOOL_FINISHED", toolCallId: "fake-1", isError: false, summary: "read project files" },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
  }
  if (kind === "fake-children") {
    return new ChildFakeExecutor();
  }
  if (kind === "pi") {
    const config = await loadProvidersConfig(stateRoot);
    return createConfiguredPiExecutor(resolveCliPiExecutorOptions({
      stateRoot,
      config,
      env: process.env,
      ...(hooks !== undefined ? { hooks } : {}),
      ...(modelOverride !== undefined ? { modelOverride } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(executorModelOverride !== undefined ? { executorModelOverride } : {})
    }));
  }
  throw new DomainValidationError(`Unknown executor "${kind}": expected "fake" or "pi"`);
}

/** Flowchart --executor fake must emit TASK_RESULT, same as --children. */
export function flowchartExecutorKind(kind: string): string {
  return kind === "fake" ? "fake-children" : kind;
}


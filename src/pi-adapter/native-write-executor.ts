import type { NativeWriteExecutorFactory } from "../native/write-session.js";
import type { CapturedNativeHostContext } from "./native-host-context.js";
import { developmentPiTools } from "./development-tools.js";
import { PiAgentExecutor } from "./pi-executor.js";

/** One captured host selection; every repair gets its own owned child session. */
export function createNativeWriteExecutorFactory(host: CapturedNativeHostContext): NativeWriteExecutorFactory {
  return (context) => {
    const cost = context.executionCostBudget;
    const executor = new PiAgentExecutor({
    providerId: host.defaultModel.provider, modelId: host.defaultModel.id, models: host.models,
    systemPrompt: host.effectiveSystemPrompt, thinkingLevel: host.thinkingLevel,
    ...(host.thinkingBudgets === undefined ? {} : { thinkingBudgets: host.thinkingBudgets }),
    approvedResourcePayload: host.approvedResourcePayload,
    tools: developmentPiTools(context.tools), onInvocation: context.onInvocation,
    stopAfterTaskResult: true,
    ...(cost === undefined ? {} : { strictReferenceBudget: true, onExecutionCost: cost.onExecutionCost,
      referenceBudgetAdmission: cost.assertDispatchAllowed })
    });
    cost?.bindExecutor(executor);
    return executor;
  };
}

import type { NativeWriteExecutorFactory } from "../native/write-session.js";
import type { CapturedNativeHostContext } from "./native-host-context.js";
import { developmentPiTools } from "./development-tools.js";
import { PiAgentExecutor } from "./pi-executor.js";

/** One captured host selection; every repair gets its own owned child session. */
export function createNativeWriteExecutorFactory(host: CapturedNativeHostContext): NativeWriteExecutorFactory {
  return (context) => new PiAgentExecutor({
    providerId: host.defaultModel.provider, modelId: host.defaultModel.id, models: host.models,
    systemPrompt: host.effectiveSystemPrompt, thinkingLevel: host.thinkingLevel,
    approvedResourcePayload: host.approvedResourcePayload,
    tools: developmentPiTools(context.tools), onInvocation: context.onInvocation,
    stopAfterTaskResult: true
  });
}

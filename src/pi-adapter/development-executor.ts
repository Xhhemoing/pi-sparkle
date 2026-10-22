import { DomainValidationError } from "../domain/errors.js";
import type { AgentExecutor } from "../execution/contract.js";
import type { NativeWriteExecutorFactory, NativeWriteTool } from "../native/write-session.js";
import { createConfiguredPiExecutor } from "./runtime.js";

export type DevelopmentPiExecutorOptions = Omit<Parameters<typeof createConfiguredPiExecutor>[0], "tools">;

/** Preserve host-provided descriptors and scope closures; never reconstruct tools. */
export function developmentPiTools(tools: readonly NativeWriteTool[]): NonNullable<Parameters<typeof createConfiguredPiExecutor>[0]["tools"]> {
  return ["sparkle_read_file", "sparkle_write_file", "sparkle_list_files", "sparkle_search_files", "sparkle_patch_file"].map((name) => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined || !("parameters" in tool) || tool.parameters === null || typeof tool.parameters !== "object" ||
        !("label" in tool) || typeof tool.label !== "string" || !("description" in tool) || typeof tool.description !== "string") {
      throw new DomainValidationError(`develop: native scoped tool descriptor unavailable: ${name}`);
    }
    return tool as NonNullable<Parameters<typeof createConfiguredPiExecutor>[0]["tools"]>[number];
  });
}

/** Assembly only: the caller owns model/config selection, telemetry and lifetime. */
export function createDevelopmentPiExecutorFactory(
  options: DevelopmentPiExecutorOptions,
  createExecutor: (input: Parameters<typeof createConfiguredPiExecutor>[0]) => Promise<AgentExecutor> = createConfiguredPiExecutor
): NativeWriteExecutorFactory {
  return (context) => createExecutor({ ...options, tools: developmentPiTools(context.tools),
    onInvocation: (invocation) => {
      context.onInvocation(invocation);
      options.onInvocation?.(invocation);
    }
  });
}

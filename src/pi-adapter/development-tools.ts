import type { NativeWriteTool } from "../native/write-session.js";
import type { PiExecutorOptions } from "./pi-executor.js";
import { DomainValidationError } from "../domain/errors.js";
/** Preserve the host-provided closures and schemas; never create broader tools. */
export function developmentPiTools(tools: readonly NativeWriteTool[]): NonNullable<PiExecutorOptions["tools"]> {
  return ["sparkle_read_file", "sparkle_write_file", "sparkle_list_files", "sparkle_search_files", "sparkle_patch_file"].map((name) => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined || !("parameters" in tool) || tool.parameters === null || typeof tool.parameters !== "object" ||
        !("label" in tool) || typeof tool.label !== "string" || !("description" in tool) || typeof tool.description !== "string") {
      throw new DomainValidationError(`develop: native scoped tool descriptor unavailable: ${name}`);
    }
    return tool as NonNullable<PiExecutorOptions["tools"]>[number];
  });
}

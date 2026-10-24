#!/usr/bin/env node
/** Repository-local research composition. Not an npm bin or a CLI permission flag. */
import { pathToFileURL } from "node:url";
import { main as coreMain, type CliIo, type CliRuntimeContext } from "../cli/main.js";
import type { CliLabBehavior } from "../cli/lab-behavior.js";
import { assignTasks } from "./routing/assign.js";
import { loadLearnedRouting } from "./learning/learned-routing.js";
import { runAutoAdaptLoop } from "./learning/auto-loop.js";
import { withLearnedFlowchartRouting } from "./flowchart.js";

export const cliLabBehavior: CliLabBehavior = {
  assignChildren: async ({ stateRoot, projectRoot, ...input }) => {
    const learned = await loadLearnedRouting(stateRoot, projectRoot);
    return assignTasks({ ...input, ...(learned === undefined ? {} : { learned }) });
  },
  flowchartRouting: (deps) => {
    const { loadModelPolicyTransform } = withLearnedFlowchartRouting(deps);
    return loadModelPolicyTransform === undefined ? {} : { loadModelPolicyTransform };
  },
  afterChildren: (input) => runAutoAdaptLoop(input)
};

export function main(argv: string[], io?: CliIo, runtime?: Omit<CliRuntimeContext, "labBehavior">): Promise<number> {
  return coreMain(argv, io, { ...runtime, labBehavior: cliLabBehavior });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  process.exitCode = await main(process.argv.slice(2));
}

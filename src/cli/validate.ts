import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import type { Flowchart } from "../domain/flowchart.js";
import { isAgentRole } from "../domain/roles.js";
import { providersConfigPath } from "../config/providers-config.js";
import { compileChildrenToFlowchart, type CompilableChild } from "../graph/compile-children.js";
import { parseChildSpec } from "./children-spec.js";
import { CLI_EXIT, cliFail } from "./errors.js";
import { parseFlowchartFile } from "./flowchart-io.js";
import { buildLiveCatalogConfig } from "./model-catalog.js";

export interface ValidateIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const VALIDATE_USAGE = `pi-sparkle validate — check a spec file without starting a run

Usage:
  pi-sparkle validate --children <spec.json> [--json]
  pi-sparkle validate --flowchart <flowchart.json> [--state-root <dir>] [--json]

Exactly one of --children / --flowchart. This command creates no run, writes
nothing under any state root, opens no provider connection, and executes no
task: it runs the same parsers the run path runs and reports what they said.

--children is parsed exactly as run --children parses it (ids, roles,
objectives, acceptance criteria, limits.maxCostUsd, dependsOn) and then
compiled with compileChildrenToFlowchart, so a cycle, a self-dependency or a
missing dependency is refused here. The compile uses the default cheap/premium
model policy; a real run assigns catalog models instead, so this does not
check model availability for children.

--flowchart runs the flowchart validator and then the same live-catalog check
run --flowchart applies: node models are checked against the catalog built
from the providers config under --state-root (default ~/.pi-sparkle), so a
node naming a model that state root does not expose fails, and a node naming a
model you enabled there passes. Reading that config is a read — it creates no
run and writes nothing. --state-root is ignored by --children, which never
consults the catalog.

--json prints one VALIDATE_OK object on success (frozen-additive: type,
preview, kind, path, taskCount, nodeCount, edgeCount, flowchartId,
catalogSource, stateRoot keep their name, type and meaning). A failure prints
the CLI error report on stderr and exits 1 — never a VALIDATE_OK object.
`;

/**
 * The success contract of `validate`, frozen-additive from day one: these keys
 * keep their name, type and meaning, and a new one arrives only in a diff that
 * also updates the pins in `test/unit/cli/validate.test.ts`.
 *
 * `preview` is always true and says what this command is: a developer-preview
 * check that read the spec and wrote nothing.
 */
export interface ValidateOkJson {
  readonly type: "VALIDATE_OK";
  readonly preview: true;
  readonly kind: "children" | "flowchart";
  readonly path: string;
  readonly taskCount?: number;
  readonly nodeCount: number;
  readonly edgeCount?: number;
  readonly flowchartId?: string;
  /**
   * Present for `--flowchart` only, and only ever `"live"`: the model check
   * came from the catalog built out of `stateRoot`, the same one
   * `run --flowchart` builds. `--children` omits both keys because it compiles
   * with the default cheap/premium policy and checks no catalog at all.
   */
  readonly catalogSource?: "live";
  readonly stateRoot?: string;
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

/**
 * `parseChildSpec` already refuses an unknown role, so this narrowing is a
 * type bridge rather than a second check — but it refuses rather than dropping
 * the task, because a validate that silently omitted one would report a task
 * count the run path does not agree with.
 */
function compilableChildren(tasks: Awaited<ReturnType<typeof parseChildSpec>>): CompilableChild[] {
  return tasks.map((task) => {
    if (!isAgentRole(task.role)) {
      throw new DomainValidationError(`Child task ${task.taskId}: role must be a known AgentRole`);
    }
    return {
      taskId: task.taskId,
      role: task.role,
      objective: task.objective,
      ...(task.dependsOn !== undefined ? { dependsOn: task.dependsOn } : {})
    };
  });
}

export async function validateCommand(args: string[], io: ValidateIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        children: { type: "string" },
        flowchart: { type: "string" },
        "state-root": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "validate",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle validate --help"
    });
  }
  if (values.help === true) {
    io.stdout(VALIDATE_USAGE);
    return CLI_EXIT.ok;
  }
  const childrenPath = values.children;
  const flowchartPath = values.flowchart;
  if ((childrenPath === undefined) === (flowchartPath === undefined)) {
    return cliFail(io, {
      command: "validate",
      stage: "parse-args",
      message: "validate requires exactly one of --children <spec.json> or --flowchart <flowchart.json>",
      next: "pass --children <spec.json> or --flowchart <flowchart.json>, not both"
    });
  }

  let report: ValidateOkJson;
  let prose: string;
  try {
    if (childrenPath !== undefined) {
      const tasks = await parseChildSpec(childrenPath);
      const flowchart: Flowchart = compileChildrenToFlowchart(compilableChildren(tasks));
      report = {
        type: "VALIDATE_OK",
        preview: true,
        kind: "children",
        path: childrenPath,
        taskCount: tasks.length,
        nodeCount: flowchart.nodes.length,
        flowchartId: flowchart.id
      };
      prose = `valid: children ${tasks.length} tasks → flowchart ${flowchart.id} (${flowchart.nodes.length} nodes)\n`;
    } else {
      // The catalog `run --flowchart` would check against, built the same way
      // from the same state root: a static cheap/premium list here would
      // refuse flowcharts a run accepts and accept ones a run refuses.
      const stateRoot = values["state-root"] ?? defaultStateRoot();
      let catalogIds: readonly string[];
      try {
        catalogIds = (await buildLiveCatalogConfig(stateRoot)).models.map((model) => model.id);
      } catch (error) {
        // A broken or unresolvable catalog is not a broken spec, so it does
        // not get the "fix the spec" remedy. The two ways to get here are an
        // enabled model no provider exposes and a malformed providers.json, so
        // the remedy names a repair for each and the file both live in.
        return cliFail(io, {
          command: "validate",
          stage: error instanceof DomainValidationError ? "validation" : "execute",
          message: `could not build the model catalog at ${stateRoot}: ${error instanceof Error ? error.message : String(error)}`,
          next: `disable an unknown enabled model with pi-sparkle models disable <provider/model>, repair ${providersConfigPath(stateRoot)}, or pass --state-root <dir>`
        });
      }
      const flowchart = await parseFlowchartFile(flowchartPath as string, catalogIds);
      report = {
        type: "VALIDATE_OK",
        preview: true,
        kind: "flowchart",
        path: flowchartPath as string,
        nodeCount: flowchart.nodes.length,
        edgeCount: flowchart.edges.length,
        flowchartId: flowchart.id,
        catalogSource: "live",
        stateRoot
      };
      prose = `valid: flowchart ${flowchart.id} (${flowchart.nodes.length} nodes, ${flowchart.edges.length} edges) checked against the live catalog at ${stateRoot}\n`;
    }
  } catch (error) {
    // A refusal is the whole point of this command, so it reports the parser's
    // own message. --json stays unprinted: the stderr error report is the
    // failure contract, and a half-shaped VALIDATE_OK would be worse than none.
    return cliFail(io, {
      command: "validate",
      stage: error instanceof DomainValidationError ? "validation" : "execute",
      message: error instanceof Error ? error.message : String(error),
      next: "fix the spec and re-run pi-sparkle validate"
    });
  }

  io.stdout(values.json === true ? `${JSON.stringify(report)}\n` : prose);
  return CLI_EXIT.ok;
}

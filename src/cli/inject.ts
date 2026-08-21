import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseRunId } from "../domain/ids.js";
import { createCalibratedCliModelRouter } from "./model-catalog.js";
import { injectFlowchartRun } from "../run/flowchart-run.js";
import { createFilePauseController } from "../run/pause-controller.js";
import { parseFactValue } from "../run/injection.js";
import { CLI_EXIT, cliFail } from "./errors.js";

export interface InjectIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

export async function injectCommand(args: string[], io: InjectIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      type: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      node: { type: "string" },
      confidence: { type: "string" },
      actor: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  if (values.run === undefined || values.type === undefined) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: "inject requires --run <runId> and --type fact|override|skip",
      next: "pass --run <runId> and --type fact|override|skip"
    });
  }
  if (values.type === "fact" && (values.key === undefined || values.value === undefined)) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: "inject --type fact requires --key and --value",
      next: "pass --key and --value",
      runId: values.run
    });
  }
  if ((values.type === "override" || values.type === "skip") && values.node === undefined) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: `inject --type ${values.type} requires --node <id>`,
      next: "pass --node <id>",
      runId: values.run
    });
  }
  if (values.type === "override" && values.confidence === undefined) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: "inject --type override requires --confidence <0-1>",
      next: "pass --confidence <0-1>",
      runId: values.run
    });
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const request: Record<string, unknown> = {
    kind: values.type,
    actor: values.actor ?? "user",
    ...(values.key !== undefined ? { key: values.key } : {}),
    ...(values.value !== undefined ? { value: parseFactValue(values.value) } : {}),
    ...(values.node !== undefined ? { nodeId: values.node } : {}),
    ...(values.confidence !== undefined
      ? { confidence: Number(values.confidence) }
      : values.type === "override"
        ? {}
        : { confidence: 1 })
  };
  const outcome = await injectFlowchartRun(
    { stateRoot, router: await createCalibratedCliModelRouter(stateRoot), pause: createFilePauseController(stateRoot) },
    runId,
    request
  );
  const facts = Object.entries(outcome.snapshot.facts)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const nodes = Object.entries(outcome.snapshot.nodes)
    .map(([id, node]) => `${id}=${node.state}`)
    .join(" ");
  io.stdout(
    `Injected ${values.type}${values.key !== undefined ? ` key=${values.key}` : ""}${
      values.value !== undefined ? ` value=${values.value}` : ""
    }${values.node !== undefined ? ` node=${values.node}` : ""} actor=${String(request.actor)}\n`
  );
  io.stdout(`  facts: ${facts === "" ? "(none)" : facts}\n`);
  io.stdout(`  nodes: ${nodes}\n`);
  return CLI_EXIT.ok;
}

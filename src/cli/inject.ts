import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseRunId } from "../domain/ids.js";
import { createCalibratedCliModelRouter } from "./model-catalog.js";
import { injectFlowchartRun } from "../run/flowchart-run.js";
import { createFilePauseController } from "../run/pause-controller.js";
import { EventStore } from "../run/event-store.js";
import { parseFactValue } from "../run/injection.js";
import { CLI_EXIT, cliFail } from "./errors.js";

export interface InjectIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const INJECT_USAGE = `pi-sparkle inject — record a typed fact/override/skip against a run's decision policy

Usage:
  pi-sparkle inject --run <runId> --type fact --key <name> --value <json-scalar|text> [--actor <who>] [--state-root <dir>]
  pi-sparkle inject --run <runId> --type override --node <nodeId> --confidence <0-1> [--actor <who>] [--state-root <dir>]
  pi-sparkle inject --run <runId> --type skip --node <nodeId> [--actor <who>] [--state-root <dir>]

--value parses as a JSON scalar when it is one (true, 42, "text"), otherwise as the bare string;
objects, arrays, and null are refused. Values are recorded, never executed. Injection into a
terminal or BLOCKED run fails closed; success echoes the resulting facts/nodes snapshot.
`;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

const INJECTION_KINDS = new Set(["fact", "override", "skip"]);

export async function injectCommand(args: string[], io: InjectIo): Promise<number> {
  const first = args[0];
  if (first === "help" || first === "--help" || first === "-h") {
    io.stdout(INJECT_USAGE);
    return CLI_EXIT.ok;
  }

  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        run: { type: "string" },
        type: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
        node: { type: "string" },
        confidence: { type: "string" },
        actor: { type: "string" },
        "state-root": { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle inject --help"
    });
  }

  if (values.help === true) {
    io.stdout(INJECT_USAGE);
    return CLI_EXIT.ok;
  }
  if (values.run === undefined || values.type === undefined) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: "inject requires --run <runId> and --type fact|override|skip",
      next: "pass --run <runId> and --type fact|override|skip"
    });
  }
  // A kind the CLI does not know is a value-domain argv error, and it has to be
  // named as one here: on a flowchart run the plane calls it a validation
  // failure with the doctor remedy, and on a run with no flowchart snapshot the
  // plane refuses on run shape first, so the operator is sent to debug a healthy
  // checkpoint and never told which flag they mistyped.
  if (!INJECTION_KINDS.has(values.type)) {
    return cliFail(io, {
      command: "inject",
      stage: "parse-args",
      message: `unknown --type "${values.type}": injection kind must be fact, override, or skip`,
      next: "pass --type fact, override, or skip",
      runId: values.run
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
  // Same reason as the kind above, one flag later: `--confidence banana` and
  // `--confidence 2` are both argv, and both reached the plane before anyone
  // looked at them. Converted once here so the request carries the number the
  // refusal already vetted.
  let confidence: number | undefined;
  if (values.confidence !== undefined) {
    confidence = Number(values.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return cliFail(io, {
        command: "inject",
        stage: "parse-args",
        message: `invalid --confidence "${values.confidence}": confidence must be a finite number between 0 and 1`,
        next: "pass --confidence <0-1>",
        runId: values.run
      });
    }
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  // A missing run reached the flowchart plane and surfaced as an untyped throw
  // indistinguishable from a real plane failure. Refused here, before anything
  // is read or written on that plane; deeper failures still throw as they did.
  const read = await new EventStore(stateRoot, runId).readAll();
  if (read.events.length === 0) {
    return cliFail(io, {
      command: "inject",
      stage: "lookup",
      message: `Run ${runId} not found under ${stateRoot}`,
      // The house run-not-found remedy, copied rather than imported: `main.ts`
      // imports this module, so reaching back for `missingRun` would be a cycle.
      next: `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there`,
      runId
    });
  }
  const request: Record<string, unknown> = {
    kind: values.type,
    actor: values.actor ?? "user",
    ...(values.key !== undefined ? { key: values.key } : {}),
    ...(values.value !== undefined ? { value: parseFactValue(values.value) } : {}),
    ...(values.node !== undefined ? { nodeId: values.node } : {}),
    ...(confidence !== undefined
      ? { confidence }
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

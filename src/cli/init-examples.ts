// Wiring note for the parent: main.ts still has to import initExamplesCommand
// from "./init-examples.js", add a `case "init":` to the command switch, and
// add the `pi-sparkle init [--dir <path>] [--force] [--json]` line to USAGE.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cliFail, CLI_EXIT } from "./errors.js";

export interface InitExamplesIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const INIT_USAGE = `pi-sparkle init — write example specs you can run immediately

Usage:
  pi-sparkle init [--dir <path>] [--force] [--json]

Writes sparkle-children.example.json (a --children task spec) and
sparkle-flowchart.example.json (the same two steps as a --flowchart spec) into
--dir (default: the current directory). Existing files are never replaced
without --force. No state root is read or written, and no run is started.
`;

export const CHILDREN_EXAMPLE_FILENAME = "sparkle-children.example.json";
export const FLOWCHART_EXAMPLE_FILENAME = "sparkle-flowchart.example.json";

/**
 * The examples are embedded as source constants rather than read from
 * `examples/` at runtime: the published package ships `dist` only, so a
 * file-relative read would work from a checkout and fail from an install.
 * `examples/` holds the same bytes for people browsing the repository, and
 * the unit test pins the two copies together.
 */
export const CHILDREN_EXAMPLE_JSON = `{
  "tasks": [
    {
      "id": "tsk_survey",
      "role": "scout",
      "objective": "List every call site that reads configuration directly, with file and line",
      "acceptanceCriteria": [
        {
          "id": "ac_call_sites",
          "description": "Each call site is named with its file path and line number"
        }
      ]
    },
    {
      "id": "tsk_migrate",
      "role": "implementer",
      "objective": "Route the surveyed call sites through the shared configuration loader",
      "dependsOn": ["tsk_survey"]
    }
  ]
}
`;

export const FLOWCHART_EXAMPLE_JSON = `{
  "id": "flw_example",
  "nodes": [
    {
      "id": "survey",
      "taskId": "tsk_survey",
      "role": "actor",
      "objective": "List every call site that reads configuration directly, with file and line",
      "modelPolicy": {
        "allowedModels": ["cheap", "premium"],
        "preferredModel": "cheap"
      },
      "confidenceThreshold": 0.7,
      "approvalRequired": false
    },
    {
      "id": "migrate",
      "taskId": "tsk_migrate",
      "role": "actor",
      "objective": "Route the surveyed call sites through the shared configuration loader",
      "modelPolicy": {
        "allowedModels": ["cheap", "premium"],
        "preferredModel": "premium"
      },
      "confidenceThreshold": 0.7,
      "approvalRequired": false
    }
  ],
  "edges": [
    {
      "from": "survey",
      "to": "migrate",
      "condition": { "type": "success", "expected": true }
    }
  ]
}
`;

interface ExampleFile {
  readonly name: string;
  readonly body: string;
}

const EXAMPLE_FILES: readonly ExampleFile[] = [
  { name: CHILDREN_EXAMPLE_FILENAME, body: CHILDREN_EXAMPLE_JSON },
  { name: FLOWCHART_EXAMPLE_FILENAME, body: FLOWCHART_EXAMPLE_JSON }
];

function isHelp(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--help" || arg === "-h" || arg === "help");
}

export async function initExamplesCommand(args: string[], io: InitExamplesIo): Promise<number> {
  if (isHelp(args)) {
    io.stdout(INIT_USAGE);
    return CLI_EXIT.ok;
  }
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: "string" },
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false }
    }
  });

  const dir = resolve(values.dir ?? ".");
  const targets = EXAMPLE_FILES.map((file) => ({ ...file, path: resolve(dir, file.name) }));

  // Both targets are checked before anything is written: a partial write would
  // leave the operator with one fresh example next to one of their own files
  // and no way to tell which is which.
  const existing = targets.filter((target) => existsSync(target.path));
  if (existing.length > 0 && values.force !== true) {
    const first = existing[0]!;
    return cliFail(io, {
      command: "init",
      stage: "execute",
      message: `${first.path} already exists`,
      next: "re-run with --force to overwrite"
    });
  }

  await mkdir(dir, { recursive: true });
  for (const target of targets) {
    await writeFile(target.path, target.body, "utf8");
  }

  const overwritten = existing.length > 0;
  if (values.json === true) {
    // `preview: true` is the developer-preview marker every machine surface
    // carries; the object prints as one compact line like the other machine
    // surfaces so a caller can read it a line at a time.
    io.stdout(
      `${JSON.stringify({
        type: "INIT_EXAMPLES",
        preview: true,
        dir,
        files: targets.map((target) => target.path),
        overwritten
      })}\n`
    );
    return CLI_EXIT.ok;
  }

  const childrenPath = targets.find((target) => basename(target.path) === CHILDREN_EXAMPLE_FILENAME)!.path;
  for (const target of targets) {
    io.stdout(`wrote ${target.path}\n`);
  }
  io.stdout(`next: pi-sparkle validate --children ${childrenPath}\n`);
  return CLI_EXIT.ok;
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * End-to-end cover for the frozen `inspect --run --summary-json` contract
 * (`InspectSummaryJson`): the four keys consumers pin, one object on stdout,
 * `--json` untouched as an event NDJSON stream, and both refusals.
 */

const REPO_ROOT = process.cwd();

/** Consumers pin exactly these; additive changes update this list deliberately. */
const INSPECT_SUMMARY_KEYS = ["type", "runId", "status", "requiredEvidence"] as const;

/** One node, no `--results` and no `--executor`: the node leases and stalls. */
const STALLING_FLOWCHART = {
  id: "cli-summary-stall",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
};

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-summary-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-summary-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function parseRunIdFromOutput(text: string): string {
  const runId = text.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, `no run id in CLI output: ${text}`);
  return runId;
}

/** Runs the fake executor to a clean COMPLETED run. */
async function completedRun(stateRoot: string, projectRoot: string): Promise<string> {
  const started = capture();
  const code = await main(
    ["run", "--project", projectRoot, "--objective", "Audit the project", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  return parseRunIdFromOutput(started.out.join(""));
}

/** Runs a flowchart that cannot progress, so the supervisor blocks it. */
async function blockedRun(stateRoot: string, projectRoot: string): Promise<string> {
  const flowchartPath = join(projectRoot, "flow.json");
  await writeFile(flowchartPath, JSON.stringify(STALLING_FLOWCHART), "utf8");
  const started = capture();
  const code = await main(
    [
      "run",
      "--project",
      projectRoot,
      "--objective",
      "stall",
      "--flowchart",
      flowchartPath,
      "--state-root",
      stateRoot
    ],
    started.io
  );
  assert.equal(code, 1, "a stalled flowchart run exits non-zero");
  assert.match(started.out.join(""), /BLOCKED/);
  return parseRunIdFromOutput(started.out.join(""));
}

async function readEventLines(stateRoot: string, runId: string): Promise<string[]> {
  const text = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  return text.trim().split("\n");
}

test("inspect --summary-json prints one frozen object for a genuinely blocked run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await blockedRun(stateRoot, projectRoot);

    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));

    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 1, "JSON mode stdout is exactly one object");
    const summary = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [...INSPECT_SUMMARY_KEYS].sort());
    assert.equal(summary.type, "INSPECT_SUMMARY");
    assert.equal(summary.runId, runId);
    assert.equal(summary.status, "BLOCKED");
    assert.ok(!("id" in summary), "the summary is not a domain Event");

    // The demand is the RUN_BLOCKED payload verbatim, not a derived restatement.
    const events = (await readEventLines(stateRoot, runId)).map(
      (line) => JSON.parse(line) as { type: string; payload: { requiredEvidence?: string[] } }
    );
    const blocked = events.find((event) => event.type === "RUN_BLOCKED");
    assert.ok(blocked, "the stalled run persisted RUN_BLOCKED");
    assert.ok((blocked.payload.requiredEvidence ?? []).length > 0);
    assert.deepEqual(summary.requiredEvidence, blocked.payload.requiredEvidence);
  });
});

test("inspect --summary-json reports COMPLETED with no evidence demand for a clean run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);

    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    assert.deepEqual(json.err, []);

    const summary = JSON.parse(json.out.join("").trim()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [...INSPECT_SUMMARY_KEYS].sort());
    assert.equal(summary.status, "COMPLETED");
    assert.deepEqual(summary.requiredEvidence, [], "a run that never stalled demands nothing");
  });
});

test("inspect --json stays one line per persisted event with no summary appended", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await blockedRun(stateRoot, projectRoot);
    const persisted = await readEventLines(stateRoot, runId);

    const json = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], json.io);
    assert.equal(code, 0, json.err.join(""));

    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, persisted.length, "nothing is appended to the event stream");
    const types = lines.map((line) => {
      const event = JSON.parse(line) as { id?: unknown; type?: unknown };
      assert.ok(typeof event.id === "string" && event.id !== "", "every line is a domain Event");
      return event.type;
    });
    assert.ok(!types.includes("INSPECT_SUMMARY"));
    assert.ok(types.includes("RUN_BLOCKED"));
  });
});

test("inspect refuses --json together with --summary-json", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);

    const { io, out, err } = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--json", "--summary-json"],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /either --json or --summary-json/);
    assert.deepEqual(out, [], "a refused invocation writes nothing to stdout");
  });
});

test("inspect refuses --summary-json for --episode", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const inspected = capture();
    await main(["inspect", "--run", runId, "--state-root", stateRoot], inspected.io);
    const episodeId = inspected.out.join("").match(/episode: (ep_[A-Za-z0-9_-]+)/)?.[1];
    assert.ok(episodeId, "the fake run binds an episode");

    const { io, out, err } = capture();
    const code = await main(
      ["inspect", "--episode", episodeId, "--state-root", stateRoot, "--summary-json"],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /only available with --run/);
    assert.deepEqual(out, [], "the summary is run-only");
  });
});

test("the spawned CLI writes the summary object and nothing else to stdout", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await blockedRun(stateRoot, projectRoot);

    const stdout = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "inspect",
        "--run",
        runId,
        "--state-root",
        stateRoot,
        "--summary-json"
      ],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );

    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1, `expected one object, got: ${stdout}`);
    const summary = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [...INSPECT_SUMMARY_KEYS].sort());
    assert.equal(summary.type, "INSPECT_SUMMARY");
    assert.equal(summary.runId, runId);
    assert.equal(summary.status, "BLOCKED");
  });
});

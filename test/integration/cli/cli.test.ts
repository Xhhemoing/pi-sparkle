import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { validateConfidenceScore } from "../../../src/domain/flowchart.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createCliModelRouter } from "../../../src/cli/model-catalog.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

const REPO_ROOT = process.cwd();

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

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("run with the fake executor prints a human summary and persists the run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Audit the project", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0);
    const text = out.join("");
    assert.match(text, /Run (run_[A-Za-z0-9_-]+): COMPLETED/);
    assert.match(text, /events\.jsonl/);
    assert.match(text, /checkpoint\.json/);
    assert.deepEqual(err, []);

    const match = text.match(/Run (run_[A-Za-z0-9_-]+):/);
    const runId = match?.[1];
    assert.ok(runId);
    const eventsFile = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const checkpointFile = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
    const eventsText = await readFile(eventsFile, "utf8");
    const eventLines = eventsText.trim().split("\n");
    assert.equal(eventLines.length, 12);
    const eventTypes = eventLines.map((line) => (JSON.parse(line) as { type: string }).type);
    assert.ok(eventTypes.includes("EPISODE_OPENED"));
    assert.ok(eventTypes.includes("RUN_ATTACHED"));
    assert.ok(eventTypes.includes("EPISODE_CLOSED"));
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");
  });
});

test("run rejects missing required arguments", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, out, err } = capture();
    const code = await main(["run", "--project", projectRoot, "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /--objective/);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "run");
    assert.equal(parsed?.stage, "parse-args");
    assert.ok((parsed?.next ?? "").includes("--objective"));
    assert.deepEqual(out, []);
  });
});

test("run rejects an unknown executor", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { io, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--executor", "magic", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /executor/);
  });
});

test("inspect warns on a crash-truncated final event line and still replays complete events", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);
    await appendFile(
      join(stateRoot, "runtime", "runs", runId, "events.jsonl"),
      '{"id":"evt_truncated","schemaVersion":1,"type":"RUN_ST'
    );

    const human = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0);
    assert.match(human.out.join(""), /COMPLETED/);
    assert.match(human.err.join(""), /truncated event log at line/);

    const json = capture();
    const jsonCode = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], json.io);
    assert.equal(jsonCode, 0);
    assert.match(json.err.join(""), /truncated event log at line/);
    for (const line of json.out.join("").trim().split("\n")) {
      const parsed = JSON.parse(line) as { id?: unknown; type?: unknown };
      assert.ok(parsed.id && parsed.type);
    }
  });
});

test("inspect prints the status and --json emits one JSON event per line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);

    const human = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0);
    assert.match(human.out.join(""), /COMPLETED/);
    assert.match(human.out.join(""), /episode: ep_/);

    const json = capture();
    const jsonCode = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], json.io);
    assert.equal(jsonCode, 0);
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 12);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.id && parsed.type);
    }
  });
});

test("inspect --episode prints the bound snapshot", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);

    const runInspect = capture();
    await main(["inspect", "--run", runId, "--state-root", stateRoot], runInspect.io);
    const episodeId = runInspect.out.join("").match(/episode: (ep_[A-Za-z0-9_-]+)/)?.[1];
    assert.ok(episodeId);

    const human = capture();
    const code = await main(["inspect", "--episode", episodeId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0);
    assert.match(human.out.join(""), new RegExp(`Episode ${episodeId}: COMPLETED`));
    assert.match(human.out.join(""), new RegExp(`runs: ${runId}`));
    assert.deepEqual(human.err, []);

    const json = capture();
    const jsonCode = await main(
      ["inspect", "--episode", episodeId, "--state-root", stateRoot, "--json"],
      json.io
    );
    assert.equal(jsonCode, 0);
    const snapshot = JSON.parse(json.out.join("").trim()) as { id: string; status: string; runIds: string[] };
    assert.equal(snapshot.id, episodeId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.deepEqual(snapshot.runIds, [runId]);
  });
});

test("inspect rejects --run and --episode together", async () => {
  const { io, err } = capture();
  const code = await main(
    [
      "inspect",
      "--run",
      "run_01234567-89ab-cdef-0123-456789abcdef",
      "--episode",
      "ep_01234567-89ab-cdef-0123-456789abcdef",
      "--state-root",
      "/tmp/pi-sparkle-nonexistent"
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /either --run or --episode/);
});

test("inspect reports a missing run", async () => {
  const { io, err } = capture();
  const code = await main(["inspect", "--run", "run_01234567-89ab-cdef-0123-456789abcdef", "--state-root", "/tmp/pi-sparkle-nonexistent"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /not found/);
});

test("inspect reports a missing episode", async () => {
  const { io, err } = capture();
  const code = await main(
    [
      "inspect",
      "--episode",
      "ep_01234567-89ab-cdef-0123-456789abcdef",
      "--state-root",
      "/tmp/pi-sparkle-nonexistent"
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /not found/);
});

test("resume rebuilds a deleted checkpoint from the event log", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);
    const checkpointFile = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
    await rm(checkpointFile);

    const resumeIo = capture();
    const code = await main(["resume", "--run", runId, "--state-root", stateRoot], resumeIo.io);
    assert.equal(code, 0);
    assert.match(resumeIo.out.join(""), /checkpoint rebuilt/);
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");
  });
});

test("unsupervised resume continues a flowchart checkpoint without stripping it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: createCliModelRouter(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: (() => {
          let n = 0;
          return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
        })()
      },
      {
        projectRoot,
        flowchart: {
          id: "cli-flowchart",
          nodes: [
            {
              id: "only",
              taskId: createTaskId(() => "only"),
              role: "actor",
              objective: "Do the work",
              modelPolicy: { allowedModels: ["cheap"] },
              confidenceThreshold: validateConfidenceScore(0.7),
              approvalRequired: false
            }
          ],
          edges: []
        },
        childResults: {
          only: {
            outcome: "SUCCESS",
            confidence: validateConfidenceScore(0.9),
            evidenceIds: ["evd_only"]
          }
        }
      }
    );
    assert.ok(outcome.checkpoint.flowchart);
    const checkpointFile = join(stateRoot, "runtime", "runs", outcome.runId, "checkpoint.json");
    const routedBefore = (await readFile(join(stateRoot, "runtime", "runs", outcome.runId, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.includes("MODEL_ROUTED")).length;

    const resumeIo = capture();
    const code = await main(["resume", "--run", outcome.runId, "--state-root", stateRoot], resumeIo.io);
    assert.equal(code, 0);
    assert.doesNotMatch(resumeIo.err.join(""), /use flowchart resume/i);
    assert.match(resumeIo.out.join(""), /COMPLETED/);
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    assert.ok(checkpoint.flowchart, "flowchart checkpoint must be preserved");
    const routedAfter = (await readFile(join(stateRoot, "runtime", "runs", outcome.runId, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.includes("MODEL_ROUTED")).length;
    assert.equal(routedAfter, routedBefore, "completed nodes must not be rerun");
  });
});

test("answer appends USER_ANSWER to an existing run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runIo = capture();
    await main(["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot], runIo.io);
    const runId = runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);
    const messageId = "msg_01234567-89ab-cdef-0123-456789abcdef";
    const ans = capture();
    const code = await main(
      ["answer", "--run", runId, "--message", messageId, "--text", "ship it", "--state-root", stateRoot],
      ans.io
    );
    assert.equal(code, 0);
    assert.match(ans.out.join(""), /Recorded answer/);
    const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.match(eventsText, /USER_ANSWER/);
    assert.match(eventsText, /ship it/);
  });
});

test("answer rejects a missing run", async () => {
  await withRoots(async (stateRoot) => {
    const { io, err } = capture();
    const code = await main(
      [
        "answer",
        "--run",
        "run_01234567-89ab-cdef-0123-456789abcdef",
        "--message",
        "msg_01234567-89ab-cdef-0123-456789abcdef",
        "--text",
        "later",
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /not found/);
  });
});

test("unknown commands exit with an error", async () => {
  const { io, err } = capture();
  const code = await main(["frobnicate"], io);
  assert.equal(code, 1);
  assert.match(err.join(""), /Unknown command/);
  const parsed = parseCliErrorJson(err.join(""));
  assert.equal(parsed?.command, "pi-sparkle");
  assert.match(parsed?.next ?? "", /help/);
});

test("the CLI entrypoint prints the package version", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  assert.equal(output, "0.1.0\n");
});

test("the CLI entrypoint spawns end-to-end", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "help"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  assert.match(output, /pi-sparkle/);
  assert.match(output, /run|inspect|resume|answer/);
  assert.match(output, /doctor/);
  assert.match(output, /--flowchart/);
  assert.match(output, /inspect --episode/);
  assert.match(output, /adapt status/);
  assert.match(output, /startFlowchartRun|flowchart JSON|flowchart waiting/i);
});

const WAITING_FLOWCHART = {
  id: "cli-wait",
  nodes: [
    {
      id: "gate",
      taskId: "tsk_gate",
      role: "router",
      objective: "Choose work",
      modelPolicy: { allowedModels: ["premium"] },
      confidenceThreshold: 0.7,
      approvalRequired: true
    },
    {
      id: "work",
      taskId: "tsk_work",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: [{ from: "gate", to: "work", condition: { type: "success", expected: true } }]
};

const WORK_RESULTS = {
  work: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_work"] }
};

function parseRunIdFromOutput(text: string): string {
  const runId = text.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId);
  return runId;
}

async function countRouted(stateRoot: string, runId: string): Promise<number> {
  const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  return eventsText
    .trim()
    .split("\n")
    .filter((line) => {
      if (line.trim() === "") return false;
      const parsed = JSON.parse(line) as { type: string };
      return parsed.type === "MODEL_ROUTED";
    }).length;
}

test("run --flowchart is incompatible with --children", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const childrenPath = join(projectRoot, "children.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    await writeFile(childrenPath, JSON.stringify({ tasks: [] }), "utf8");
    const { io, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--flowchart",
        flowchartPath,
        "--children",
        childrenPath,
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /incompatible with --children/);
  });
});

test("run --flowchart --executor fake completes without --results", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(
      flowchartPath,
      JSON.stringify({
        id: "cli-exec",
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
      }),
      "utf8"
    );
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--flowchart",
        flowchartPath,
        "--executor",
        "fake",
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(err.join(""), "");
    assert.equal(code, 0);
    assert.match(out.join(""), /COMPLETED/);
    assert.match(out.join(""), /only=COMPLETED/);
  });
});

test("run --flowchart with a FAILURE child result exits 1 and emits RUN_FAILED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(
      flowchartPath,
      JSON.stringify({
        id: "fail-cli",
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
      }),
      "utf8"
    );
    await writeFile(resultsPath, JSON.stringify({ only: { outcome: "FAILURE" } }), "utf8");
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--flowchart",
        flowchartPath,
        "--results",
        resultsPath,
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 1);
    assert.match(out.join(""), /FAILED/);
    assert.match(err.join(""), /reason:/);
    const runId = parseRunIdFromOutput(out.join(""));
    const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.match(eventsText, /RUN_FAILED/);
    assert.doesNotMatch(eventsText, /RUN_COMPLETED/);
  });
});

test("run --flowchart fails closed for models outside the CLI catalog", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(
      flowchartPath,
      JSON.stringify({
        ...WAITING_FLOWCHART,
        nodes: WAITING_FLOWCHART.nodes.map((node, index) =>
          index === 0 ? { ...node, modelPolicy: { allowedModels: ["mystery-model"] } } : node
        )
      }),
      "utf8"
    );
    const { io, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /unavailable model "mystery-model"/);
    assert.match(err.join(""), /cheap, premium/);
  });
});

test("flowchart run waits, inspect/resume/answer continue, completed nodes are not rerun", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    await writeFile(resultsPath, JSON.stringify(WORK_RESULTS), "utf8");

    const started = capture();
    const startCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the gate",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    assert.equal(startCode, 0);
    assert.match(started.out.join(""), /WAITING_FOR_USER/);
    assert.match(started.out.join(""), /pending approval/);
    assert.match(started.out.join(""), /\bwork\b/);
    const runId = parseRunIdFromOutput(started.out.join(""));
    const routedAtWait = await countRouted(stateRoot, runId);
    assert.equal(routedAtWait, 1, "only the waiting gate is routed on start");

    const inspected = capture();
    const inspectCode = await main(["inspect", "--run", runId, "--state-root", stateRoot], inspected.io);
    assert.equal(inspectCode, 0);
    assert.match(inspected.out.join(""), /WAITING_FOR_USER/);
    assert.match(inspected.out.join(""), /pending approval approval:branch:gate: work/);

    const resumedWait = capture();
    const resumeWaitCode = await main(["resume", "--run", runId, "--state-root", stateRoot], resumedWait.io);
    assert.equal(resumeWaitCode, 0);
    assert.doesNotMatch(resumedWait.err.join(""), /use flowchart resume/i);
    assert.match(resumedWait.out.join(""), /WAITING_FOR_USER/);
    assert.equal(await countRouted(stateRoot, runId), routedAtWait);

    const rejectedPlain = capture();
    const eventsBefore = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    const rejectCode = await main(
      ["answer", "--run", runId, "--message", "msg_01234567-89ab-cdef-0123-456789abcdef", "--text", "ship it", "--state-root", stateRoot],
      rejectedPlain.io
    );
    assert.equal(rejectCode, 1);
    assert.match(rejectedPlain.err.join(""), /--selected/);
    assert.equal(await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8"), eventsBefore);

    const answered = capture();
    const answerCode = await main(
      [
        "answer",
        "--run",
        runId,
        "--selected",
        "work",
        "--text",
        "choose work",
        "--results",
        resultsPath,
        "--state-root",
        stateRoot
      ],
      answered.io
    );
    assert.equal(answerCode, 0);
    assert.match(answered.out.join(""), /Recorded answer/);
    assert.match(answered.out.join(""), /COMPLETED/);
    assert.match(answered.out.join(""), /work=COMPLETED/);
    const routedAfterAnswer = await countRouted(stateRoot, runId);
    assert.equal(routedAfterAnswer, 2, "gate and work are each routed once");

    const resumedDone = capture();
    const resumeDoneCode = await main(["resume", "--run", runId, "--state-root", stateRoot], resumedDone.io);
    assert.equal(resumeDoneCode, 0);
    assert.match(resumedDone.out.join(""), /COMPLETED/);
    assert.equal(await countRouted(stateRoot, runId), routedAfterAnswer, "completed nodes must not be rerun");
  });
});

test("resume --selected continues a waiting flowchart", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    await writeFile(resultsPath, JSON.stringify(WORK_RESULTS), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const resumed = capture();
    const code = await main(
      [
        "resume",
        "--run",
        runId,
        "--selected-ids",
        "work",
        "--results",
        resultsPath,
        "--text",
        "go",
        "--state-root",
        stateRoot
      ],
      resumed.io
    );
    assert.equal(code, 0);
    assert.match(resumed.out.join(""), /COMPLETED/);
    assert.match(resumed.out.join(""), /work=COMPLETED/);
  });
});

test("resume and answer refuse a flowchart event log without a durable flowchart checkpoint", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const checkpointFile = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
    const eventsFile = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const eventsBefore = await readFile(eventsFile, "utf8");
    await rm(checkpointFile);

    const resumeMissing = capture();
    const resumeCode = await main(["resume", "--run", runId, "--state-root", stateRoot], resumeMissing.io);
    assert.equal(resumeCode, 1);
    assert.match(resumeMissing.err.join(""), /no durable checkpoint|refusing to invent/);
    await assert.rejects(() => readFile(checkpointFile, "utf8"), /ENOENT/);
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore);

    const answerMissing = capture();
    const answerCode = await main(
      [
        "answer",
        "--run",
        runId,
        "--message",
        "msg_01234567-89ab-cdef-0123-456789abcdef",
        "--text",
        "ship it",
        "--state-root",
        stateRoot
      ],
      answerMissing.io
    );
    assert.equal(answerCode, 1);
    assert.match(answerMissing.err.join(""), /no durable checkpoint|refusing to invent/);
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore, "must not append an uncorrelated USER_ANSWER");
    await assert.rejects(() => readFile(checkpointFile, "utf8"), /ENOENT/);
  });
});

test("resume refuses a checkpoint that dropped its flowchart field", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const checkpointFile = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
    const eventsFile = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const eventsBefore = await readFile(eventsFile, "utf8");
    const stripped = JSON.parse(await readFile(checkpointFile, "utf8")) as { flowchart?: unknown };
    delete stripped.flowchart;
    await writeFile(checkpointFile, `${JSON.stringify(stripped, null, 2)}\n`, "utf8");

    const resumed = capture();
    const code = await main(["resume", "--run", runId, "--state-root", stateRoot], resumed.io);
    assert.equal(code, 1);
    assert.match(resumed.err.join(""), /no durable checkpoint|refusing to invent/);
    const after = JSON.parse(await readFile(checkpointFile, "utf8")) as { flowchart?: unknown };
    assert.equal(after.flowchart, undefined, "must not materialize a linear checkpoint");
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore);
  });
});

test("unknown --selected id is rejected on a waiting flowchart", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const eventsFile = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const eventsBefore = await readFile(eventsFile, "utf8");

    const resumed = capture();
    const resumeCode = await main(
      ["resume", "--run", runId, "--selected", "not-a-real-action", "--state-root", stateRoot],
      resumed.io
    );
    assert.equal(resumeCode, 1);
    assert.match(resumed.err.join(""), /unknown or non-selectable action: not-a-real-action/);
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore);

    const answered = capture();
    const answerCode = await main(
      ["answer", "--run", runId, "--selected", "not-a-real-action", "--text", "nope", "--state-root", stateRoot],
      answered.io
    );
    assert.equal(answerCode, 1);
    assert.match(answered.err.join(""), /unknown or non-selectable action: not-a-real-action/);
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore);
  });
});

test("resume --text without --selected on a waiting flowchart is rejected", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const eventsFile = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const eventsBefore = await readFile(eventsFile, "utf8");
    const resumed = capture();
    const code = await main(
      ["resume", "--run", runId, "--text", "please continue", "--state-root", stateRoot],
      resumed.io
    );
    assert.equal(code, 1);
    assert.match(resumed.err.join(""), /--text on a waiting flowchart requires --selected/);
    assert.equal(await readFile(eventsFile, "utf8"), eventsBefore);
    assert.match(
      JSON.stringify(JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8"))),
      /WAITING_FOR_USER/
    );
  });
});

test("supervised resume still refuses a flowchart checkpoint", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(WAITING_FLOWCHART), "utf8");
    const started = capture();
    await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ],
      started.io
    );
    const runId = parseRunIdFromOutput(started.out.join(""));
    const resumed = capture();
    const code = await main(
      ["resume", "--run", runId, "--supervised", "--state-root", stateRoot],
      resumed.io
    );
    assert.equal(code, 1);
    assert.match(resumed.err.join(""), /flowchart snapshot|flowchart resume/i);
  });
});

const VERIFICATION_CHILD_SPEC = {
  tasks: [
    { id: "tsk_one", role: "implementer", objective: "Do the first thing" },
    { id: "tsk_two", role: "tester", objective: "Check the first thing" }
  ]
};

test("run --children and inspect print verification per TASK_RESULT and an unverified summary", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(VERIFICATION_CHILD_SPEC), "utf8");
    const runIo = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship it", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    assert.equal(code, 0, runIo.err.join(""));
    const runText = runIo.out.join("");
    // The fake child executor verifies PASSED with evidence: no (unverified) suffix.
    assert.match(runText, /result: SUCCESS verification=PASSED — /);
    assert.doesNotMatch(runText, /\(unverified\)/);
    assert.match(runText, /^ {2}unverified: 0\/2$/m);
    const runId = parseRunIdFromOutput(runText);

    const inspected = capture();
    const inspectCode = await main(["inspect", "--run", runId, "--state-root", stateRoot], inspected.io);
    assert.equal(inspectCode, 0, inspected.err.join(""));
    const inspectText = inspected.out.join("");
    assert.match(inspectText, /result: SUCCESS verification=PASSED — /);
    assert.match(inspectText, /^ {2}unverified: 0\/2$/m);
  });
});

test("inspect --json stays a pure event stream with no unverified line appended", async () => {
  // The summary is human-output only: a consumer parsing `--json` line by line
  // must not suddenly meet a non-JSON line once the wiring lands.
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(VERIFICATION_CHILD_SPEC), "utf8");
    const runIo = capture();
    await main(
      ["run", "--project", projectRoot, "--objective", "Ship it", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    const runId = parseRunIdFromOutput(runIo.out.join(""));
    const inspected = capture();
    const code = await main(["inspect", "--run", runId, "--json", "--state-root", stateRoot], inspected.io);
    assert.equal(code, 0, inspected.err.join(""));
    const lines = inspected.out.join("").trim().split("\n");
    assert.ok(lines.length > 0);
    for (const line of lines) {
      JSON.parse(line);
    }
  });
});

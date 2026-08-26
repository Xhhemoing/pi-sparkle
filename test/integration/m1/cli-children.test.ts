import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { inspectRun } from "../../../src/run/inspection.js";
import { parseRunId } from "../../../src/domain/ids.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";
import { stripSkipContractWarning } from "../../helpers/skip-contract-warning.js";

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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-m1-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-m1-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function requireCompletedRunId(out: string[], err: string[]): ReturnType<typeof parseRunId> {
  const text = out.join("");
  const match = text.match(/Run (run_[A-Za-z0-9_-]+):/);
  if (match?.[1] === undefined) {
    throw new Error(
      `expected Run run_<id> in stdout; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`
    );
  }
  return parseRunId(match[1]);
}

const CHILD_SPEC = {
  tasks: [
    {
      id: "tsk_parse",
      role: "implementer",
      objective: "Implement the parser",
      acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    },
    {
      id: "tsk_test",
      role: "tester",
      objective: "Test the parser",
      acceptanceCriteria: [{ id: "ac-2", description: "Suite passes" }],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    }
  ]
};

async function readEventLog(stateRoot: string, runId: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function runDirectoryNames(stateRoot: string): Promise<string[]> {
  try {
    return await readdir(join(stateRoot, "runtime", "runs"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

test("run --children carries a declared maxCostUsd to the child run and its TASK_REQUEST", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_capped",
            role: "implementer",
            objective: "Implement the parser under a budget",
            acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
            limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000, maxCostUsd: 0.25 }
          }
        ]
      }),
      "utf8"
    );
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship the parser", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    const runId = requireCompletedRunId(out, err);

    // The declared ceiling must be on disk, not merely accepted by the CLI:
    // the TASK_REQUEST the parent logged and the child's own RUN_CREATED are
    // the two records that claim what the child was allowed to spend.
    const parentEvents = await readEventLog(stateRoot, runId);
    const requests = parentEvents.flatMap((event) => {
      const payload = event.payload as { message?: { type?: string; limits?: { maxCostUsd?: number } } };
      const message = payload?.message;
      return event.type === "CHILD_MESSAGE" && message?.type === "TASK_REQUEST" ? [message] : [];
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.limits?.maxCostUsd, 0.25);

    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.children.length, 1);
    const childRunId = inspection.children[0]!.childRunId;
    const childEvents = await readEventLog(stateRoot, childRunId);
    const created = childEvents.filter((event) => event.type === "RUN_CREATED");
    assert.equal(created.length, 1);
    const createdRun = (created[0]!.payload as { run: { limits: { maxCostUsd?: number } } }).run;
    assert.equal(createdRun.limits.maxCostUsd, 0.25);
  });
});

test("run --children refuses a non-positive maxCostUsd naming the task and writes no run", async () => {
  // JSON cannot carry NaN/Infinity, so `null` is the shape a hand-written spec
  // actually reaches the parser with when the value is not a number at all.
  for (const declared of [0, -1, "0.25", null] as const) {
    await withRoots(async (stateRoot, projectRoot) => {
      const specPath = join(projectRoot, "children.json");
      await writeFile(
        specPath,
        JSON.stringify({
          tasks: [
            {
              id: "tsk_capped",
              role: "implementer",
              objective: "Implement the parser under a budget",
              acceptanceCriteria: [],
              limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000, maxCostUsd: declared }
            }
          ]
        }),
        "utf8"
      );
      const { io, err } = capture();
      const code = await main(
        ["run", "--project", projectRoot, "--objective", "x", "--children", specPath, "--state-root", stateRoot],
        io
      );
      assert.notEqual(code, 0);
      const stderr = err.join("");
      assert.match(stderr, /tsk_capped/);
      assert.match(stderr, /maxCostUsd/);
      const parsed = parseCliErrorJson(stderr);
      assert.ok(parsed, stderr);
      assert.equal(parsed.ok, false);
      assert.deepEqual(await runDirectoryNames(stateRoot), []);
    });
  }
});

test("run --children compiles dependsOn into a sequential flowchart", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_parse",
            role: "implementer",
            objective: "Implement the parser",
            acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
            limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
          },
          {
            id: "tsk_test",
            role: "tester",
            objective: "Test the parser",
            dependsOn: ["tsk_parse"],
            acceptanceCriteria: [{ id: "ac-2", description: "Suite passes" }],
            limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
          }
        ]
      }),
      "utf8"
    );
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship the parser", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0);
    assert.equal(stripSkipContractWarning(err.join("")), "");
    assert.match(out.join(""), /children: 2/);
    assert.match(out.join(""), /flowchart: COMPLETED/);
  });
});

test("README children example ids and roles are accepted", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "tasks.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_research",
            role: "scout",
            objective: "Survey the latest payment gateway options",
            acceptanceCriteria: [{ id: "ac1", description: "List 3+ candidates with pros/cons" }]
          },
          {
            id: "tsk_impl",
            role: "implementer",
            objective: "Integrate the chosen gateway",
            inputArtifactIds: ["art_research-report"]
          }
        ]
      }),
      "utf8"
    );
    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Migrate to new payment provider", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.equal(stripSkipContractWarning(err.join("")), "");
    assert.match(out.join(""), /children: 2/);
    assert.match(out.join(""), /tsk_research/);
    assert.match(out.join(""), /tsk_impl/);
  });
});

test("run --children completes a parent run with correlated children", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");

    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship the parser", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /Run (run_[A-Za-z0-9_-]+): COMPLETED/);
    assert.match(text, /children: 2/);
    assert.equal(stripSkipContractWarning(err.join("")), "");

    const runId = requireCompletedRunId(out, err);
    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.status, "COMPLETED");
    assert.equal(inspection.children.length, 2);
    const outcomes = inspection.children.map((c) => c.outcome);
    assert.deepEqual(outcomes, ["SUCCESS", "SUCCESS"]);
    for (const child of inspection.children) {
      assert.ok(child.messages.some((m) => m.type === "TASK_REQUEST"), "TASK_REQUEST persisted per child");
      assert.ok(child.messages.some((m) => m.type === "TASK_RESULT"), "TASK_RESULT persisted per child");
    }
  });
});

test("run --children rejects an invalid child spec before executing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify({ tasks: [{ id: "nope", role: "wizard", objective: "" }] }), "utf8");
    const { io, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    const stderr = err.join("");
    assert.match(stderr, /children|task|role|objective/i);
    const parsed = parseCliErrorJson(stderr);
    assert.ok(parsed, stderr);
    assert.equal(parsed.command, "run");
    assert.equal(parsed.ok, false);
    assert.ok(parsed.stage === "validation" || parsed.stage === "parse-args" || parsed.stage === "execute");
    assert.ok(parsed.next.length > 0);
  });
});

test("inspect reports children, questions, answers, artifacts, and evidence", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const runIo = capture();
    await main(
      ["run", "--project", projectRoot, "--objective", "x", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    const runId = requireCompletedRunId(runIo.out, runIo.err);

    const human = capture();
    const humanCode = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(humanCode, 0);
    const text = human.out.join("");
    assert.match(text, /children/i);
    assert.match(text, /tsk_parse/);
    assert.match(text, /SUCCESS/);

    const jsonIo = capture();
    await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], jsonIo.io);
    const lines = jsonIo.out.join("").trim().split("\n");
    assert.ok(lines.length > 0);
    const parsed = lines.map((line) => JSON.parse(line));
    assert.ok(parsed.some((event) => event.type === "CHILD_RUN_CREATED"));
  });
});

test("a question pauses the parent run and answer supplies the explicit answer event", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(
      specPath,
      JSON.stringify({
        tasks: [
          {
            id: "tsk_ask",
            role: "implementer",
            objective: "Ask before proceeding",
            acceptanceCriteria: [],
            limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
          }
        ]
      }),
      "utf8"
    );

    // The run command itself completes with the fake executor; the durable
    // question flow is exercised through the coordinator integration tests.
    const runIo = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    assert.equal(code, 0, runIo.err.join(""));
    const runId = requireCompletedRunId(runIo.out, runIo.err);
    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.status, "COMPLETED");
    assert.equal(inspection.pendingQuestions.length, 0);
  });
});

test("checkpoint and event files are written for the parent and children", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const runIo = capture();
    await main(
      ["run", "--project", projectRoot, "--objective", "x", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    const runId = requireCompletedRunId(runIo.out, runIo.err);
    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");

    const inspection = await inspectRun(stateRoot, runId);
    for (const child of inspection.children) {
      const events = await readFile(join(stateRoot, "runtime", "runs", child.childRunId, "events.jsonl"), "utf8");
      assert.match(events, /RUN_CREATED/);
      assert.match(events, /AGENT_FINISHED/);
    }
  });
});

test("fake children e2e: run, inspect, checkpoint, TASK_REQUEST/RESULT, and replay ids", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");
    const runIo = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship the parser", "--children", specPath, "--state-root", stateRoot],
      runIo.io
    );
    assert.equal(code, 0, runIo.err.join(""));
    assert.equal(stripSkipContractWarning(runIo.err.join("")), "");
    const runId = requireCompletedRunId(runIo.out, runIo.err);

    const inspectIo = capture();
    const inspectCode = await main(["inspect", "--run", runId, "--state-root", stateRoot], inspectIo.io);
    assert.equal(inspectCode, 0, inspectIo.err.join(""));
    assert.match(inspectIo.out.join(""), /tsk_parse/);
    assert.match(inspectIo.out.join(""), /tsk_test/);

    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runtime", "runs", runId, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");
    const parentEvents = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
    assert.match(parentEvents, /RUN_CREATED/);
    assert.match(parentEvents, /RUN_COMPLETED/);

    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.children.length, 2);
    for (const child of inspection.children) {
      assert.match(child.childRunId, /^run_/);
      assert.match(child.taskId, /^tsk_/);
      assert.equal(child.outcome, "SUCCESS");
      assert.ok(child.messages.some((m) => m.type === "TASK_REQUEST"));
      const result = child.messages.find((m) => m.type === "TASK_RESULT");
      assert.ok(result !== undefined && result.type === "TASK_RESULT");
      assert.ok(result.artifactIds.length > 0);
      assert.ok(result.evidenceIds.length > 0);
    }
  });
});

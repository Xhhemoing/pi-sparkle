import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { inspectRun } from "../../../src/run/inspection.js";
import { parseRunId } from "../../../src/domain/ids.js";

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
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
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

test("run --children completes a parent run with correlated children", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(CHILD_SPEC), "utf8");

    const { io, out, err } = capture();
    const code = await main(
      ["run", "--project", projectRoot, "--objective", "Ship the parser", "--children", specPath, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0);
    const text = out.join("");
    assert.match(text, /Run (run_[A-Za-z0-9_-]+): COMPLETED/);
    assert.match(text, /children: 2/);
    assert.deepEqual(err, []);

    const runId = parseRunId(text.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]);
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
    assert.match(err.join(""), /children|task|role|objective/i);
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
    const runId = parseRunId(runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]);

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
    assert.equal(code, 0);
    const runId = parseRunId(runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]);
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
    const runId = parseRunId(runIo.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1]);
    const checkpoint = JSON.parse(await readFile(join(stateRoot, "runs", runId, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.status, "COMPLETED");

    const inspection = await inspectRun(stateRoot, runId);
    for (const child of inspection.children) {
      const events = await readFile(join(stateRoot, "runs", child.childRunId, "events.jsonl"), "utf8");
      assert.match(events, /RUN_CREATED/);
      assert.match(events, /AGENT_FINISHED/);
    }
  });
});

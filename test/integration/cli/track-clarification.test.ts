import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * The `run --track` clarification wait used to be a dead end: the questions
 * were written only to `runtime/runs/<id>/track-questions.json`, `inspect`
 * could not name them, and `answer` happily appended a `USER_ANSWER` that
 * nothing reads — which also replays the stranded run as RUNNING.
 *
 * These tests hold both halves of the minimum repair: inspect prints what is
 * on disk (and says so when it cannot read it), and answer refuses before it
 * writes anything.
 */

/** The frozen `--summary-json` keys; the clarification lines are prose-only. */
const INSPECT_SUMMARY_KEYS = ["type", "runId", "status", "requiredEvidence"] as const;

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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-clarify-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-clarify-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function questionsPath(stateRoot: string, runId: string): string {
  return join(stateRoot, "runtime", "runs", runId, "track-questions.json");
}

function eventsPath(stateRoot: string, runId: string): string {
  return join(stateRoot, "runtime", "runs", runId, "events.jsonl");
}

interface ClarificationWait {
  readonly runId: string;
  readonly questions: readonly { id: string; question: string }[];
}

/** A vague objective without `--assume-defaults`: the tracked run waits. */
async function startClarificationWait(
  stateRoot: string,
  projectRoot: string
): Promise<ClarificationWait> {
  const started = capture();
  const code = await main(
    ["run", "--track", "--project", projectRoot, "--objective", "do it", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  assert.match(started.out.join(""), /WAITING_FOR_USER/);
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, `no run id in CLI output: ${started.out.join("")}`);
  const file = JSON.parse(await readFile(questionsPath(stateRoot, runId), "utf8")) as {
    questions: { id: string; question: string }[];
  };
  assert.ok(file.questions.length > 0, "the wait persisted at least one question");
  return { runId, questions: file.questions };
}

test("inspect --run prints the persisted track clarification questions and a new-run continuation", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot);

    const inspected = capture();
    const code = await main(["inspect", "--run", wait.runId, "--state-root", stateRoot], inspected.io);
    assert.equal(code, 0, inspected.err.join(""));
    const text = inspected.out.join("");
    assert.match(text, /WAITING_FOR_USER/);
    for (const question of wait.questions) {
      assert.ok(
        text.includes(question.question),
        `inspect must print the persisted question ${question.id}: ${text}`
      );
      assert.ok(text.includes(question.id));
    }
    assert.ok(text.includes(questionsPath(stateRoot, wait.runId)), "the source file is named");
    assert.match(text, /run --track/);
    assert.match(text, /--answers <file\.json>/);
    assert.match(text, /--assume-defaults/);
    assert.match(text, /answer --run .* cannot continue this run/);
    assert.ok(text.includes(projectRoot), "the continuation names the project it was started on");
  });
});

test("inspect --summary-json keeps its four frozen keys on a clarification run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot);

    const json = capture();
    const code = await main(
      ["inspect", "--run", wait.runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 1, "JSON mode stdout is exactly one object");
    const summary = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [...INSPECT_SUMMARY_KEYS].sort());
    assert.equal(summary.status, "WAITING_FOR_USER");
  });
});

test("answer refuses a track clarification run and appends no USER_ANSWER", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot);
    const before = await readFile(eventsPath(stateRoot, wait.runId), "utf8");

    const answered = capture();
    const code = await main(
      [
        "answer",
        "--run",
        wait.runId,
        "--message",
        "msg_01234567-89ab-cdef-0123-456789abcdef",
        "--text",
        "yes, with tests",
        "--state-root",
        stateRoot
      ],
      answered.io
    );
    assert.equal(code, 1);
    assert.deepEqual(answered.out, [], "a refused answer writes nothing to stdout");
    const stderr = answered.err.join("");
    assert.match(stderr, /clarification questions/);
    assert.match(stderr, /run --track/);
    assert.match(stderr, /--answers <file\.json>/);

    const after = await readFile(eventsPath(stateRoot, wait.runId), "utf8");
    assert.equal(after, before, "the refusal must not append to the event log");
    assert.ok(!after.includes("USER_ANSWER"));

    // The run stays honestly WAITING_FOR_USER rather than replaying as RUNNING
    // on the strength of an answer nothing consumes.
    const json = capture();
    await main(["inspect", "--run", wait.runId, "--state-root", stateRoot, "--summary-json"], json.io);
    const summary = JSON.parse(json.out.join("").trim()) as { status?: string };
    assert.equal(summary.status, "WAITING_FOR_USER");
  });
});

test("inspect reports an unreadable questions file instead of inventing questions", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot);
    const asked = wait.questions[0]!;
    await writeFile(questionsPath(stateRoot, wait.runId), "{ not json", "utf8");

    const inspected = capture();
    const code = await main(["inspect", "--run", wait.runId, "--state-root", stateRoot], inspected.io);
    assert.equal(code, 0, inspected.err.join(""));
    const text = inspected.out.join("");
    assert.match(text, /could not be read/);
    assert.ok(!text.includes(asked.question), "no question is reconstructed from anywhere else");
    assert.match(text, /run --track/);

    // The plane marker is the file's existence, so the refusal still holds.
    const answered = capture();
    const answerCode = await main(
      [
        "answer",
        "--run",
        wait.runId,
        "--message",
        "msg_01234567-89ab-cdef-0123-456789abcdef",
        "--text",
        "yes",
        "--state-root",
        stateRoot
      ],
      answered.io
    );
    assert.equal(answerCode, 1);
    assert.ok(!(await readFile(eventsPath(stateRoot, wait.runId), "utf8")).includes("USER_ANSWER"));
  });
});

test("answer still records a plain question on a run with no clarification file", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = capture();
    const runCode = await main(
      ["run", "--project", projectRoot, "--objective", "x", "--state-root", stateRoot],
      started.io
    );
    assert.equal(runCode, 0, started.err.join(""));
    const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);

    const answered = capture();
    const code = await main(
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
      answered.io
    );
    assert.equal(code, 0, answered.err.join(""));
    assert.match(answered.out.join(""), /Recorded answer/);
    assert.match(await readFile(eventsPath(stateRoot, runId), "utf8"), /USER_ANSWER/);
  });
});

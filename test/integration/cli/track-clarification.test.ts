import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import {
  createAgentInstanceId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { Run } from "../../../src/domain/run.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, validateAgentMessage } from "../../../src/protocol/v1.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent } from "../../helpers/event-factory.js";
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
 *
 * Two later holes are held here as well. The sidecar is written *after*
 * `RUN_WAITING_FOR_USER`, so losing it leaves a real wait that the file-based
 * refusal cannot see: the refusal therefore correlates the answered message to
 * a pending child `QUESTION` instead. And the continuation the operator is
 * pointed at is printed as labelled facts, because a project path and an
 * objective concatenated into one shell line carry whatever `;` or `$(...)`
 * they contain.
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

/**
 * A project path and an objective the operator could not paste safely.
 *
 * Both are real recorded values on this plane: the path is where the run was
 * started, the objective is what it was started with. If either reaches a
 * printed command line, `;` ends the command and `$(...)` runs.
 */
const INJECTED_OBJECTIVE = "fix $(echo INJECTED) it";

async function withInjectionRoots(
  run: (stateRoot: string, projectRoot: string) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle state; echo INJECTED "));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle proj; echo INJECTED "));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/**
 * Nothing printed is a continuation command the operator can paste: the
 * arguments are labelled facts they retype, so their own data cannot execute.
 */
function assertNoPasteableContinuation(text: string): void {
  assert.doesNotMatch(text, /next:.*pnpm cli run --track --project/);
  for (const line of text.split("\n")) {
    if (!line.includes("next:")) continue;
    assert.ok(!line.includes("--project"), `a next: line must not carry --project: ${line}`);
    assert.ok(!line.includes("--objective"), `a next: line must not carry --objective: ${line}`);
  }
}

interface ClarificationWait {
  readonly runId: string;
  readonly questions: readonly { id: string; question: string }[];
}

/** A vague objective without `--assume-defaults`: the tracked run waits. */
async function startClarificationWait(
  stateRoot: string,
  projectRoot: string,
  objective = "do it"
): Promise<ClarificationWait> {
  const started = capture();
  const code = await main(
    ["run", "--track", "--project", projectRoot, "--objective", objective, "--state-root", stateRoot],
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

/**
 * The wait `answer` is for: a parent whose child asked a `QUESTION` and which
 * recorded `RUN_WAITING_FOR_USER` on that message. Written straight to the
 * event log because the CLI cannot reach this shape without a child executor
 * that blocks, and the correlation under test is a property of the log.
 */
async function seedCoordinatorWait(stateRoot: string): Promise<ClarificationWait & { messageId: string }> {
  const runId = createRunId();
  const childRunId = createRunId();
  const projectId = createProjectId();
  const taskId = createTaskId();
  const occurredAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  const asked = "Proceed with the risky refactor?";
  const question = validateAgentMessage({
    protocolVersion: 1,
    id: createMessageId(),
    occurredAt,
    runId: childRunId,
    taskId,
    from: createAgentInstanceId(),
    to: SUPERVISOR,
    type: "QUESTION",
    question: asked,
    options: ["Yes", "No"]
  });
  const run: Run = {
    id: runId,
    projectId,
    rootTaskId: taskId,
    status: "RUNNING",
    limits: defaultRunLimits(),
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const store = new EventStore(stateRoot, runId);
  for (const event of [
    makeEvent("RUN_CREATED", { run }, { runId }),
    makeEvent("RUN_STARTED", {}, { runId }),
    makeEvent("CHILD_RUN_CREATED", { childRun: { ...run, id: childRunId, parentRunId: runId } }, { runId, taskId }),
    makeEvent("CHILD_MESSAGE", { message: question }, { runId, taskId }),
    makeEvent("RUN_WAITING_FOR_USER", { messageId: question.id }, { runId, taskId })
  ]) {
    await store.append(event);
  }
  return { runId, questions: [{ id: question.id, question: asked }], messageId: question.id };
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

test("answer fails closed on a clarification wait whose questions file is gone", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot);
    // The wait the writer leaves behind when it dies (or is half-restored)
    // between `RUN_WAITING_FOR_USER` and the sidecar write.
    await unlink(questionsPath(stateRoot, wait.runId));
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
    assert.match(stderr, /WAITING_FOR_USER but records no pending question/);
    assert.match(stderr, /nothing consuming it/);
    assert.ok(
      !stderr.includes(questionsPath(stateRoot, wait.runId)),
      `the refusal must not name a questions file that is gone: ${stderr}`
    );

    const after = await readFile(eventsPath(stateRoot, wait.runId), "utf8");
    assert.equal(after, before, "the refusal must not append to the event log");
    assert.ok(!after.includes("USER_ANSWER"));

    const json = capture();
    await main(["inspect", "--run", wait.runId, "--state-root", stateRoot, "--summary-json"], json.io);
    const summary = JSON.parse(json.out.join("").trim()) as { status?: string };
    assert.equal(summary.status, "WAITING_FOR_USER");
  });
});

test("answer records a coordinator question the waiting run actually asked", async () => {
  await withRoots(async (stateRoot) => {
    const wait = await seedCoordinatorWait(stateRoot);
    const beforeUnrelated = await readFile(eventsPath(stateRoot, wait.runId), "utf8");

    // Same WAITING run, an id it never asked: still fail-closed.
    const unrelated = capture();
    const unrelatedCode = await main(
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
      unrelated.io
    );
    assert.equal(unrelatedCode, 1);
    assert.equal(await readFile(eventsPath(stateRoot, wait.runId), "utf8"), beforeUnrelated);

    const answered = capture();
    const code = await main(
      ["answer", "--run", wait.runId, "--message", wait.messageId, "--text", "yes", "--state-root", stateRoot],
      answered.io
    );
    assert.equal(code, 0, answered.err.join(""));
    assert.match(answered.out.join(""), /Recorded answer/);
    const events = await readFile(eventsPath(stateRoot, wait.runId), "utf8");
    assert.match(events, /USER_ANSWER/);
    assert.ok(events.includes(wait.messageId), "the recorded answer carries the question it answers");
  });
});

test("inspect prints an injectable project path and objective as continuation facts", async () => {
  await withInjectionRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot, INJECTED_OBJECTIVE);

    const inspected = capture();
    const code = await main(["inspect", "--run", wait.runId, "--state-root", stateRoot], inspected.io);
    assert.equal(code, 0, inspected.err.join(""));
    const text = inspected.out.join("");
    assert.ok(
      text.includes(`  continuation project: ${projectRoot}\n`),
      `the project path is one labelled fact: ${text}`
    );
    assert.ok(
      text.includes(`  continuation objective: ${INJECTED_OBJECTIVE}\n`),
      `the objective is one labelled fact: ${text}`
    );
    assert.ok(text.includes(`  continuation state-root: ${stateRoot}\n`));
    assert.match(text, /continuation verb: run --track/);
    assert.match(text, /--answers <file\.json>/);
    assertNoPasteableContinuation(text);
    assertNoPasteableContinuation(inspected.err.join(""));
  });
});

test("the answer refusal prints an injectable continuation as facts, not a command", async () => {
  await withInjectionRoots(async (stateRoot, projectRoot) => {
    const wait = await startClarificationWait(stateRoot, projectRoot, INJECTED_OBJECTIVE);

    const answered = capture();
    const code = await main(
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
    assert.equal(code, 1);
    const stderr = answered.err.join("");
    assert.match(stderr, /clarification questions/);
    assert.match(stderr, /continuation verb: run --track/);
    assert.match(stderr, /--answers <file\.json>/);
    assert.ok(stderr.includes(`  continuation project: ${projectRoot}\n`));
    assert.ok(stderr.includes(`  continuation objective: ${INJECTED_OBJECTIVE}\n`));
    assert.ok(stderr.includes(`  continuation state-root: ${stateRoot}\n`));
    assertNoPasteableContinuation(stderr);
    assertNoPasteableContinuation(answered.out.join(""));
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

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main, type CliIo } from "../../../src/cli/main.js";
import { EventStore } from "../../../src/run/event-store.js";
import { parseRunId } from "../../../src/domain/ids.js";
import { replayRun, replayedTerminalStatus } from "../../../src/run/replay.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * `pi-sparkle unblock` from the operator's side.
 *
 * The stall block is the one shape reachable end to end from the CLI offline —
 * the gate's shape needs a real child whose verification fails, and is driven
 * through the API in `test/integration/run/unblock-flow.test.ts`. What this file
 * is for is the command surface itself: what it refuses and how, that a
 * successful unblock spends nothing, and that the run only moves when the
 * operator separately asks resume to move it.
 *
 * That last point is the reason unblock is its own command rather than a flag
 * on resume. Authorizing a blocked run and spending money on it are different
 * decisions, and keeping them two commands keeps them two audit records.
 */

const STALLING_FLOWCHART = {
  id: "cli-unblock-stall",
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

const COMPLETING_RESULTS = {
  only: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_only"] }
};

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

interface Cli {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function cli(args: readonly string[]): Promise<Cli> {
  const captured = capture();
  const code = await main([...args], captured.io);
  return { code, out: captured.out(), err: captured.err() };
}

async function withBlockedRun(
  body: (context: { stateRoot: string; projectRoot: string; runId: string }) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-unblock-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-unblock-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, JSON.stringify(STALLING_FLOWCHART), "utf8");
    await withIsolatedPiEnv(async () => {
      const started = await cli([
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the work",
        "--flowchart",
        flowchartPath,
        "--state-root",
        stateRoot
      ]);
      assert.equal(started.code, 1, started.err);
      const runId = started.out.match(/Run (run_[A-Za-z0-9_-]+): BLOCKED/)?.[1];
      assert.ok(runId !== undefined, started.out);
      await body({ stateRoot, projectRoot, runId });
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function eventsOf(stateRoot: string, runId: string) {
  return (await new EventStore(stateRoot, parseRunId(runId)).readAll()).events;
}

test("unblock refuses without a run id or a reason, and names what to pass", async () => {
  await withBlockedRun(async ({ stateRoot, runId }) => {
    const noRun = await cli(["unblock", "--reason", "reviewed", "--state-root", stateRoot]);
    assert.equal(noRun.code, 1);
    assert.match(noRun.err, /^error: unblock requires --run <runId> and a non-empty --reason <text>$/m);
    assert.match(noRun.err, /^ {2}stage: parse-args$/m);

    // A blank reason is refused like a missing one: the whole point of the
    // field is that the log records why a human authorized this.
    for (const reason of [undefined, "", "   "]) {
      const attempt = await cli([
        "unblock",
        "--run",
        runId,
        ...(reason === undefined ? [] : ["--reason", reason]),
        "--state-root",
        stateRoot
      ]);
      assert.equal(attempt.code, 1, `reason ${JSON.stringify(reason)} should be refused`);
      assert.match(attempt.err, /non-empty --reason/);
    }

    const blankNode = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "reviewed",
      "--retry-node",
      "",
      "--state-root",
      stateRoot
    ]);
    assert.equal(blankNode.code, 1);
    assert.match(blankNode.err, /^error: unblock --retry-node requires a non-empty flowchart node id$/m);

    // None of the refusals touched the log.
    const events = await eventsOf(stateRoot, runId);
    assert.equal(events.some((event) => event.type === "RUN_UNBLOCKED"), false);
    assert.equal(replayedTerminalStatus(events), "BLOCKED");
  });
});

test("unblock clears the block, reports what it did, and executes nothing", async () => {
  await withBlockedRun(async ({ stateRoot, runId }) => {
    const unblocked = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "operator supplied the missing result out of band",
      "--actor",
      "alice",
      "--state-root",
      stateRoot
    ]);

    assert.equal(unblocked.code, 0, unblocked.err);
    assert.match(unblocked.out, new RegExp(`^Run ${runId}: unblocked \\(RUNNING\\)$`, "m"));
    assert.match(unblocked.out, /^ {2}reason: operator supplied the missing result out of band$/m);
    assert.ok(
      unblocked.out.includes(`  resume: pnpm cli resume --run ${runId} --state-root ${stateRoot}\n`),
      unblocked.out
    );

    const events = await eventsOf(stateRoot, runId);
    const authorizations = events.filter((event) => event.type === "RUN_UNBLOCKED");
    assert.equal(authorizations.length, 1);
    assert.equal(authorizations[0]?.actor, "alice", "--actor records who authorized it");
    assert.equal(replayedTerminalStatus(events), undefined, "the latch is open");
    assert.deepEqual(replayRun(events).anomalies, []);

    // Nothing ran. The run is authorized to continue and has not continued.
    assert.equal(
      events.some((event) => event.type === "RUN_COMPLETED" || event.type === "RUN_FAILED"),
      false,
      "unblock is not an execution surface"
    );
    assert.equal(
      events.at(-1)?.type,
      "RUN_UNBLOCKED",
      "the authorization is the last thing on the log until the operator resumes"
    );
  });
});

test("a second unblock is refused: the authorization is spent, not repeatable", async () => {
  await withBlockedRun(async ({ stateRoot, runId }) => {
    const first = await cli(["unblock", "--run", runId, "--reason", "reviewed", "--state-root", stateRoot]);
    assert.equal(first.code, 0, first.err);

    const second = await cli(["unblock", "--run", runId, "--reason", "reviewed again", "--state-root", stateRoot]);
    assert.equal(second.code, 1);
    assert.match(second.err, /^error: cannot unblock a RUNNING run: unblock clears one active RUN_BLOCKED$/m);
    assert.match(second.err, /^ {2}stage: validation$/m);

    const events = await eventsOf(stateRoot, runId);
    assert.equal(
      events.filter((event) => event.type === "RUN_UNBLOCKED").length,
      1,
      "the refused repeat wrote no second authorization"
    );
  });
});

test("unblock then resume is the operator's whole loop, and resume is the half that runs", async () => {
  await withBlockedRun(async ({ stateRoot, projectRoot, runId }) => {
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(resultsPath, JSON.stringify(COMPLETING_RESULTS), "utf8");

    // Resume before the unblock does exactly what its note says: replays BLOCKED.
    const early = await cli([
      "resume",
      "--run",
      runId,
      "--results",
      resultsPath,
      "--state-root",
      stateRoot
    ]);
    assert.equal(early.code, 1);
    assert.match(early.out, new RegExp(`Run ${runId}: BLOCKED`));
    assert.ok(
      early.err.includes(
        `  next: pnpm cli unblock --run ${runId} --reason <text> [--retry-node <nodeId>] --state-root ${stateRoot}\n`
      ),
      early.err
    );

    const unblocked = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "operator supplied the missing result out of band",
      "--state-root",
      stateRoot
    ]);
    assert.equal(unblocked.code, 0, unblocked.err);

    const resumed = await cli([
      "resume",
      "--run",
      runId,
      "--results",
      resultsPath,
      "--state-root",
      stateRoot
    ]);
    assert.equal(resumed.code, 0, resumed.err);
    assert.match(resumed.out, new RegExp(`Run ${runId}: COMPLETED`));
    assert.equal(resumed.err, "", "a run that finished prints no routing block");

    const events = await eventsOf(stateRoot, runId);
    assert.deepEqual(
      events
        .map((event) => event.type)
        .filter((type) => type === "RUN_BLOCKED" || type === "RUN_UNBLOCKED" || type === "RUN_COMPLETED"),
      ["RUN_BLOCKED", "RUN_UNBLOCKED", "RUN_COMPLETED"],
      "blocked, authorized, finished — one log that reads as the operator's own history"
    );
    assert.deepEqual(replayRun(events).anomalies, []);
  });
});

test("unblock refuses a run that does not exist", async () => {
  await withBlockedRun(async ({ stateRoot }) => {
    const missing = await cli([
      "unblock",
      "--run",
      "run_00000000-0000-4000-8000-000000000999",
      "--reason",
      "reviewed",
      "--state-root",
      stateRoot
    ]);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /not found/);
  });
});

test("help lists unblock, and an operator reading it is told it executes nothing", async () => {
  const help = await cli(["help"]);
  assert.equal(help.code, 0);
  assert.match(
    help.out,
    /^ {2}pi-sparkle unblock --run <runId> --reason <text> \[--retry-node <nodeId>\] \[--actor <who>\] \[--state-root <dir>\]$/m
  );
  assert.match(help.out, /unblock is the only thing that ends a BLOCKED run/);
  assert.match(help.out, /executes nothing\. resume runs the reopened work/);
});

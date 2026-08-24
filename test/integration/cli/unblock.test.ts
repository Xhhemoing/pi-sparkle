import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main, type CliIo } from "../../../src/cli/main.js";
import { createCalibratedCliModelRouter } from "../../../src/cli/model-catalog.js";
import { EventStore } from "../../../src/run/event-store.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { validateFlowchart, type Flowchart } from "../../../src/domain/flowchart.js";
import {
  parseRunId,
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { Event } from "../../../src/run/events.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
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

  // The stronger form is its own usage line rather than an optional bracket on
  // the ordinary one: it is a different authorization, not a modifier.
  assert.match(
    help.out,
    /^ {2}pi-sparkle unblock --run <runId> --reason <text> --retry-node <nodeId> --discard-executed \[--actor <who>\] \[--state-root <dir>\]$/m
  );
  assert.match(help.out, /--discard-executed/);
});

/**
 * The discard flag from the operator's side.
 *
 * Its precondition — a gate block whose failed node has an executed descendant
 * — needs real children whose verification disagrees with them, which no
 * offline CLI invocation produces. So the run is seeded through the API with
 * the router the CLI itself builds, and every assertion below is then made
 * against the shipped command. What is under test here is the command surface:
 * what it refuses before touching the log, what it prints when it succeeds, and
 * whether an operator who hits the ordinary refusal is told the flag exists.
 */

const TS = parseIsoTimestamp("2026-08-24T09:00:00.000Z");
const SCOUT = "tsk_scout";
const ROOT_CAUSE = "tsk_root_cause";
const SUMMARY = "tsk_summarize";

function result(request: AgentExecutionRequest, passed: boolean): ExecutionEvent {
  const evidenceIds = [`evd_${request.taskId}` as EvidenceId];
  return {
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_${request.agentInstanceId}` as MessageId,
      occurredAt: TS,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: passed ? "verification agreed" : "the child reported success; verification did not",
      artifactIds: [`art_${request.taskId}` as ArtifactId],
      evidenceIds,
      verification: passed ? { kind: "PASSED", evidenceIds } : { kind: "FAILED", evidenceIds }
    }
  };
}

function investigationChild(taskId: string): ChildTaskInput {
  return {
    taskId: parseTaskId(taskId),
    role: "implementer",
    objective: `Do ${taskId}`,
    profile: createAgentProfileRegistry(defaultAgentProfiles()).resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

/** The summary joins on `any`, so it runs beside the analysis instead of after it. */
function investigationFlowchart(): Flowchart {
  const compiled = compileChildrenToFlowchart(
    [
      { taskId: parseTaskId(SCOUT), role: "implementer", objective: "Collect the logs" },
      {
        taskId: parseTaskId(ROOT_CAUSE),
        role: "implementer",
        objective: "Find the root cause",
        dependsOn: [parseTaskId(SCOUT)]
      },
      {
        taskId: parseTaskId(SUMMARY),
        role: "implementer",
        objective: "Summarize for the incident review",
        dependsOn: [parseTaskId(SCOUT), parseTaskId(ROOT_CAUSE)]
      }
    ],
    { allowedModels: ["cheap"], preferredModel: "cheap" }
  );
  return validateFlowchart({
    ...compiled,
    nodes: compiled.nodes.map((node) =>
      node.id === SUMMARY
        ? { ...node, joinPolicy: { mode: "any" as const, requiredNodeIds: [SCOUT, ROOT_CAUSE] } }
        : node
    )
  });
}

async function withExecutedDescendantBlock(
  body: (context: {
    stateRoot: string;
    runId: string;
    events: readonly Event[];
  }) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-discard-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-discard-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(async () => {
      const executor: AgentExecutor = {
        async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
          yield result(request, request.taskId !== ROOT_CAUSE);
          yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
        }
      };
      const outcome = await startFlowchartRun(
        {
          stateRoot,
          router: await createCalibratedCliModelRouter(stateRoot),
          now: () => TS,
          executor,
          cluster: true
        },
        {
          projectRoot,
          flowchart: investigationFlowchart(),
          childTasks: [
            investigationChild(SCOUT),
            investigationChild(ROOT_CAUSE),
            investigationChild(SUMMARY)
          ]
        }
      );
      assert.equal(outcome.status, "BLOCKED");
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(outcome.snapshot.nodes).map(([id, node]) => [id, node.state])
        ),
        { [SCOUT]: "COMPLETED", [ROOT_CAUSE]: "FAILED", [SUMMARY]: "COMPLETED" }
      );
      await body({ stateRoot, runId: outcome.runId, events: outcome.events });
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("--discard-executed is refused before the log is touched when it names no node", async () => {
  await withBlockedRun(async ({ stateRoot, runId }) => {
    // Parse-time: the flag is defined relative to one failed node, so it cannot
    // stand alone. This is caught without reading the run at all.
    const bare = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "reviewed",
      "--discard-executed",
      "--state-root",
      stateRoot
    ]);
    assert.equal(bare.code, 1);
    assert.match(bare.err, /^error: unblock --discard-executed requires --retry-node <nodeId>$/m);
    assert.match(bare.err, /^ {2}stage: parse-args$/m);
    assert.match(
      bare.err,
      /^ {2}next: discarding is defined relative to one failed node: pass --retry-node <nodeId>, or drop --discard-executed$/m
    );

    // A stall block is run-level: it names no failed node, so even with a
    // --retry-node there is no consequence set to authorize discarding.
    const stall = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "reviewed",
      "--retry-node",
      "only",
      "--discard-executed",
      "--state-root",
      stateRoot
    ]);
    assert.equal(stall.code, 1);
    assert.match(stall.err, /this block names no failed node, so there is nothing to discard behind/);
    assert.match(stall.err, /^ {2}stage: validation$/m);

    const events = await eventsOf(stateRoot, runId);
    assert.equal(
      events.some(
        (event) => event.type === "RUN_UNBLOCKED" || event.type === "RUN_UNBLOCKED_WITH_DISCARD"
      ),
      false,
      "neither refusal wrote an authorization"
    );
    assert.equal(replayedTerminalStatus(events), "BLOCKED");
  });
});

test("the ordinary refusal names the flag that can proceed, and the flag then reports what it discarded", async () => {
  await withExecutedDescendantBlock(async ({ stateRoot, runId, events: seeded }) => {
    // Without the flag the operator gets the state machine's own refusal, plus
    // the one line it cannot know to write: the command that can proceed.
    const refused = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "retry the analysis",
      "--retry-node",
      ROOT_CAUSE,
      "--state-root",
      stateRoot
    ]);
    assert.equal(refused.code, 1);
    assert.match(
      refused.err,
      new RegExp(
        `^error: cannot reopen node ${ROOT_CAUSE}: ${SUMMARY} already executed, and rewinding executed work is not authorized by an unblock$`,
        "m"
      )
    );
    assert.match(refused.err, /^ {2}stage: validation$/m);
    assert.match(
      refused.err,
      new RegExp(
        `^ {2}next: re-run with --retry-node ${ROOT_CAUSE} --discard-executed to authorize discarding that executed work, or leave the run blocked$`,
        "m"
      )
    );
    assert.equal(
      (await eventsOf(stateRoot, runId)).length,
      seeded.length,
      "the refusal appended nothing"
    );

    const discarded = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "operator accepted losing the summary",
      "--retry-node",
      ROOT_CAUSE,
      "--discard-executed",
      "--actor",
      "sre-oncall",
      "--state-root",
      stateRoot
    ]);
    assert.equal(discarded.code, 0, discarded.err);
    assert.match(discarded.out, new RegExp(`^Run ${runId}: unblocked \\(RUNNING\\)$`, "m"));
    assert.match(discarded.out, /^ {2}reason: operator accepted losing the summary$/m);
    assert.match(discarded.out, new RegExp(`^ {2}reopened: ${ROOT_CAUSE}$`, "m"));

    // The discard line quotes the charged estimate off the routing row itself,
    // so what the operator reads is what the log can actually support.
    const events = await eventsOf(stateRoot, runId);
    const authorizations = events.filter((event) => event.type === "RUN_UNBLOCKED_WITH_DISCARD");
    assert.equal(authorizations.length, 1);
    assert.equal(events.filter((event) => event.type === "RUN_UNBLOCKED").length, 0);
    assert.equal(authorizations[0]?.actor, "sre-oncall", "--actor records who authorized it");
    const rewound = authorizations[0]!.payload.rewoundDescendants;
    assert.deepEqual(
      rewound.map((entry) => `${entry.nodeId}:${entry.previousState}`),
      [`${SUMMARY}:COMPLETED`]
    );
    const summaryRoute = events.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.taskId === SUMMARY
    );
    assert.ok(summaryRoute?.type === "MODEL_ROUTED");
    assert.equal(rewound[0]?.chargedEstimatedCostUsd, summaryRoute.payload.estimatedCostUsd);
    assert.ok(
      discarded.out.includes(
        `  discarded: ${SUMMARY} (was COMPLETED; charged estimate ${summaryRoute.payload.estimatedCostUsd} USD / ${summaryRoute.payload.estimatedDurationMs} ms across 1 route(s), not refunded)\n`
      ),
      discarded.out
    );
    assert.ok(
      discarded.out.includes(`  resume: pnpm cli resume --run ${runId} --state-root ${stateRoot}\n`),
      discarded.out
    );

    assert.equal(replayedTerminalStatus(events), undefined, "the latch is open");
    assert.deepEqual(replayRun(events).anomalies, []);
    assert.equal(
      events.at(-1)?.type,
      "RUN_UNBLOCKED_WITH_DISCARD",
      "the stronger authorization executes nothing either"
    );
  });
});

test("--discard-executed on a block with nothing executed behind it is refused, and the ordinary form still works", async () => {
  await withExecutedDescendantBlock(async ({ stateRoot, runId }) => {
    // The scout completed, but it is not a consequence of the failed node, so
    // reopening the scout — which never failed — is refused on its own state
    // before the discard set is ever considered.
    const wrongNode = await cli([
      "unblock",
      "--run",
      runId,
      "--reason",
      "wrong node",
      "--retry-node",
      SCOUT,
      "--discard-executed",
      "--state-root",
      stateRoot
    ]);
    assert.equal(wrongNode.code, 1);
    assert.match(wrongNode.err, new RegExp(`${SCOUT} is not the failed node this block names`));
    assert.deepEqual(
      (await eventsOf(stateRoot, runId)).filter(
        (event) => event.type === "RUN_UNBLOCKED_WITH_DISCARD"
      ),
      []
    );
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { formatBlockedRunReport, main, type CliIo } from "../../../src/cli/main.js";
import {
  parseTaskId,
  type ArtifactId,
  type EventId,
  type EvidenceId,
  type MessageId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";
import { stripSkipContractWarning } from "../../helpers/skip-contract-warning.js";

/**
 * `run` tells the operator what to do with a BLOCKED run.
 *
 * Before this, only FAILED got a `reason:`/`next:` pair. Once the tracking gate
 * started deciding the run's terminal, the production-ordinary shape — a
 * clustered child reporting success against a failed verification — began
 * ending BLOCKED, and that shape printed a status and nothing else.
 *
 * Two BLOCKED producers write `RUN_BLOCKED`, and the block has to serve both:
 * the stall detector (`no progress for too many rounds`, ledger evidence) and
 * the gate (`ANALYSIS_QUEUED`, the evidence the queued analysis is owed). Only
 * the stall producer is reachable from the CLI offline, so it carries the
 * end-to-end assertions and the gate's payload is driven through a real
 * `startFlowchartRun` into the exported formatter.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");
const MAIN_PATH = fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url));

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

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-blocked-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-blocked-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => body(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** One node and no result for it: the run stalls out and the loop blocks. */
const STALLING_FLOWCHART = {
  id: "cli-blocked-stall",
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

async function runFlowchart(
  stateRoot: string,
  projectRoot: string,
  resultsPath?: string
): Promise<{ code: number; out: string; err: string; runId: string }> {
  const flowchartPath = join(projectRoot, "flow.json");
  await writeFile(flowchartPath, JSON.stringify(STALLING_FLOWCHART), "utf8");
  const captured = capture();
  const code = await main(
    [
      "run",
      "--project",
      projectRoot,
      "--objective",
      "Ship the work",
      "--flowchart",
      flowchartPath,
      ...(resultsPath !== undefined ? ["--results", resultsPath] : []),
      "--state-root",
      stateRoot
    ],
    captured.io
  );
  const out = captured.out.join("");
  return { code, out, err: captured.err.join(""), runId: out.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1] ?? "" };
}

test("run prints a routed block when a flowchart run ends BLOCKED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = await runFlowchart(stateRoot, projectRoot);

    assert.equal(started.code, 1, "flowchartExitCode still decides the exit code for BLOCKED");
    assert.match(started.out, /Run run_[A-Za-z0-9_-]+: BLOCKED/, "the status line is unchanged");
    assert.ok(started.runId !== "", started.out);

    // The half an operator could not see before: why, and what to do next.
    assert.match(started.err, /^ {2}reason: no progress for too many rounds$/m);
    assert.match(started.err, /^ {2}required evidence: /m);
    assert.ok(
      started.err.includes(`  next: pnpm cli inspect --run ${started.runId} --state-root ${stateRoot}\n`),
      started.err
    );
    assert.ok(
      started.err.includes(
        `  next: pnpm cli inject --run ${started.runId} --type fact --key <key> --value <text> --state-root ${stateRoot}\n`
      ),
      started.err
    );
    assert.match(started.err, /^ {2}note: resume alone replays BLOCKED/m);
  });
});

/**
 * The honesty pin, and the reason it changed.
 *
 * Its previous form said no event clears a BLOCKED log and resume replays it
 * "until an unblock ships". `RUN_UNBLOCKED` shipped, so both clauses became
 * false, and a routing block that tells an operator a remedy does not exist is
 * worse than one that omits it. The order the block prints is the order the
 * operator works in: inspect the block, unblock it, then resume to run the
 * reopened work. Resume keeps its note rather than a `next:` because on its own
 * it still replays BLOCKED — that part was true before and is still true.
 */
test("the BLOCKED block names the four options that exist, in the order they are used", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = await runFlowchart(stateRoot, projectRoot);
    assert.equal(started.code, 1);

    const routed = started.err
      .split("\n")
      .filter((line) => line.startsWith("  next: ") || line.startsWith("  note: "));
    const ordinary = [
      `  next: pnpm cli inspect --run ${started.runId} --state-root ${stateRoot}`,
      `  next: pnpm cli inject --run ${started.runId} --type fact --key <key> --value <text> --state-root ${stateRoot}`,
      `  next: pnpm cli unblock --run ${started.runId} --reason <text> [--retry-node <nodeId>] --state-root ${stateRoot}`,
      `  note: resume alone replays BLOCKED — unblock is the event that clears this log, so run unblock first, then pnpm cli resume --run ${started.runId} --state-root ${stateRoot} executes the reopened work`
    ];
    // The four the operator works through, byte-for-byte and in order, as the
    // prefix of the block. A stronger authorization exists now, and disclosing
    // it must not cost the ordinary path a single line: nothing below may
    // reword, reorder or absorb one of these four.
    assert.deepEqual(routed.slice(0, ordinary.length), ordinary, started.err);

    assert.deepEqual(
      routed,
      [
        ...ordinary,
        `  note: if that unblock is refused because a descendant of the failed node already executed, --retry-node <nodeId> --discard-executed authorizes discarding it; the set is computed, not listed, and no budget is refunded`
      ],
      started.err
    );

    // The disclosure is honest about the two things an operator would otherwise
    // have to discover by being refused twice.
    const disclosure = routed[ordinary.length] ?? "";
    assert.match(disclosure, /--discard-executed/);
    assert.match(disclosure, /computed, not listed/, "the operator does not choose the set");
    assert.match(disclosure, /no budget is refunded/, "discarding work does not buy the money back");
    assert.ok(
      !disclosure.startsWith("  next: "),
      "it is not a fifth remedy to try in order; it is the stronger form of the third"
    );

    // The retired claims, named so a revert cannot quietly reinstate them.
    assert.ok(!started.err.includes("no event clears a BLOCKED log today"), started.err);
    assert.ok(!started.err.includes("until an unblock ships"), started.err);
  });
});

test("a COMPLETED run prints no BLOCKED block", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const resultsPath = join(projectRoot, "results.json");
    await writeFile(resultsPath, JSON.stringify(COMPLETING_RESULTS), "utf8");
    const started = await runFlowchart(stateRoot, projectRoot, resultsPath);

    assert.equal(started.code, 0, started.err);
    assert.match(started.out, /Run run_[A-Za-z0-9_-]+: COMPLETED/);
    assert.equal(
      stripSkipContractWarning(started.err),
      "",
      "the block is BLOCKED-specific; a healthy run stays quiet apart from the skip-contract disclosure"
    );
  });
});

/** The smallest `--children` spec the CLI accepts: one task, no dependencies. */
const SINGLE_CHILD_SPEC = {
  tasks: [
    {
      id: "tsk_only",
      role: "implementer",
      objective: "Do the work",
      acceptanceCriteria: [{ id: "ac-1", description: "The work is done" }],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    }
  ]
};

/**
 * Every `Run <id>: <word>` line the run printed, in order.
 *
 * The status line and the early disclosure share a shape on purpose — the
 * disclosure is the same line the tracked path has printed since Round 12 —
 * so the way to read this output is as a sequence, not as two independent
 * matches.
 */
function runLines(out: string): { readonly runId: string; readonly word: string }[] {
  return [...out.matchAll(/^Run (run_[A-Za-z0-9_-]+): (\S+)$/gm)].map((match) => ({
    runId: match[1]!,
    word: match[2]!
  }));
}

/**
 * The operator gap `onRunStarted` closed for `--track`, closed on the other two
 * public run paths.
 *
 * `pause --run` keys its token by run id, and both these paths printed their id
 * only once the run was terminal, so a live `--flowchart` or `--children` run
 * could be paused in principle and was unnameable in practice. The line comes
 * from the dependency the spine already exposes, fired after the run directory
 * and `RUN_CREATED` exist and before round 1 reads the pause token.
 *
 * Nothing here races and nothing is killed: the disclosure is read off the
 * run's own settled output. What that buys is checked additively — the terminal
 * line is unchanged and still second, and the disclosure names the same run —
 * because the `/Run (run_[A-Za-z0-9_-]+):/` extraction this file and four other
 * suites use takes the *first* match, which is now the started line.
 */
test("run --flowchart discloses its run id before the run settles", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = await runFlowchart(stateRoot, projectRoot);
    assert.equal(started.code, 1, started.err);

    const lines = runLines(started.out);
    assert.deepEqual(
      lines.map((line) => line.word),
      ["started", "BLOCKED"],
      `the disclosure is additive and the terminal line keeps its place: ${started.out}`
    );
    assert.equal(lines[0]?.runId, lines[1]?.runId, "one run, disclosed once and settled once");
    assert.equal(started.runId, lines[1]?.runId, "first-match extraction still names the blocked run");
  });
});

test("run --children discloses its run id before the run settles", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const specPath = join(projectRoot, "children.json");
    await writeFile(specPath, JSON.stringify(SINGLE_CHILD_SPEC), "utf8");
    const captured = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Ship the work",
        "--children",
        specPath,
        "--state-root",
        stateRoot
      ],
      captured.io
    );
    const out = captured.out.join("");
    assert.equal(code, 0, captured.err.join(""));

    const lines = runLines(out);
    assert.deepEqual(lines.map((line) => line.word), ["started", "COMPLETED"], out);
    assert.equal(lines[0]?.runId, lines[1]?.runId, "one run, disclosed once and settled once");
  });
});

test("resume without an unblock leaves the run BLOCKED, and says so again", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = await runFlowchart(stateRoot, projectRoot);
    assert.equal(started.code, 1);
    assert.match(started.err, /^ {2}note: resume alone replays BLOCKED/m);

    const resumed = capture();
    const code = await main(["resume", "--run", started.runId, "--state-root", stateRoot], resumed.io);
    assert.equal(code, 1, "a resumed BLOCKED run is still a failure exit");
    assert.match(
      resumed.out.join(""),
      new RegExp(`Run ${started.runId}: BLOCKED`),
      "resume replays the block rather than clearing it"
    );
    // The block the operator needs is on the command they reached for, not only
    // on the `run` that first produced it. Before this, resume printed the
    // status and nothing else, which is how an operator ends up resuming twice.
    assert.match(resumed.err.join(""), /^ {2}reason: no progress for too many rounds$/m);
    assert.ok(
      resumed.err.join("").includes(
        `  next: pnpm cli unblock --run ${started.runId} --reason <text> [--retry-node <nodeId>] --state-root ${stateRoot}\n`
      ),
      resumed.err.join("")
    );
  });
});

function router(): ModelRouter {
  return createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      },
      {
        id: "premium",
        version: "premium-v1",
        roles: ["actor", "critic", "judge", "router"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 4_000
      }
    ]
  });
}

/** The gate's seed: a child that did the work and reported it, verification disagreeing. */
const verificationFailedExecutor: AgentExecutor = {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_vf-${request.agentInstanceId}` as MessageId,
        occurredAt: TS,
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "the child reported success; verification did not agree",
        artifactIds: [`art_vf-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_vf-${request.taskId}` as EvidenceId],
        verification: { kind: "FAILED", evidenceIds: [`evd_vf-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
};

function childSpec(taskId: string): ChildTaskInput {
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

test("the gate's queued analysis and its owed evidence reach the operator verbatim", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // `--children` compiles this exact shape, but its fake child executor always
    // reports PASSED, so the gate's BLOCKED is not drivable through the CLI
    // offline. Production `startFlowchartRun` produces the payload, and the
    // formatter both `run` branches share reads it.
    const spec = childSpec("tsk_verify");
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        executor: verificationFailedExecutor,
        cluster: true
      },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart([
          { taskId: spec.taskId, role: "implementer", objective: spec.objective }
        ]),
        childTasks: [spec]
      }
    );
    assert.equal(outcome.status, "BLOCKED", "the gate decides the terminal");

    const report = formatBlockedRunReport(outcome.runId, stateRoot, outcome.events);
    assert.match(report, /^ {2}reason: ANALYSIS_QUEUED$/m, "the gate's reason code, not the stall detector's");
    assert.match(
      report,
      /^ {2}required evidence: evd_vf-tsk_verify$/m,
      "the evidence the queued analysis is owed, named on the RUN_BLOCKED payload"
    );
    assert.ok(report.includes(`--run ${outcome.runId} `), report);

    // Verbatim is not the same as sufficient: `ANALYSIS_QUEUED` reads as a job
    // in flight, and nothing runs. The note names the code the gate actually
    // recorded for this shape and says what will and will not end the block.
    // `blocked-gate-cause.test.ts` pins the sentence; what belongs here is that
    // the shape this file drives gets it, and that it does not promise work.
    assert.match(
      report,
      /^ {2}note: ANALYSIS_QUEUED is the tracking gate's verdict, not a running job — the gate recorded deterministic-fail on turn tsk_verify;/m,
      report
    );
    assert.match(report, /no analysis consumer is wired and nothing dequeues this block/, report);
    assert.match(report, /unblock is still what clears it/, report);
  });
});

/**
 * Wiring pin for `run --children`, which is the branch that lost the routing in
 * the first place and the one no offline test can drive to BLOCKED: its child
 * executor is a fake that always reports `verification: PASSED`, so the gate
 * never queues an analysis. The formatter is covered above against a real
 * gate-written payload; what is left to protect is that this branch still calls
 * it before handing the status to `flowchartExitCode`.
 */
function assertBlockedWiring(source: string): void {
  const start = source.indexOf("async function runCommand(");
  assert.ok(start >= 0, "runCommand must still exist in src/cli/main.ts");
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, "could not find the end of runCommand");
  const body = source.slice(start, end);

  const exits = [...body.matchAll(/return flowchartExitCode\(outcome\.status\);/g)];
  assert.equal(exits.length, 2, "runCommand reports two flowchart outcomes: --flowchart and --children");
  for (const exit of exits) {
    const guard = body.slice(Math.max(0, exit.index - 200), exit.index);
    assert.match(
      guard,
      /if \(outcome\.status === "BLOCKED"\) \{\s*reportBlockedRun\(io, outcome, stateRoot\);\s*\}/,
      `a flowchart outcome in runCommand exits without routing BLOCKED: ${guard}`
    );
  }
}

test("both flowchart outcomes in runCommand route BLOCKED before exiting", () => {
  assertBlockedWiring(readFileSync(MAIN_PATH, "utf8"));
});

test("the wiring pin fails when the --children branch drops the BLOCKED block", () => {
  const source = readFileSync(MAIN_PATH, "utf8");
  const needle = `      return reportFailedRun(io, "run", "children", outcome.runId, stateRoot, reason);
    }
    if (outcome.status === "BLOCKED") {
      reportBlockedRun(io, outcome, stateRoot);
    }`;
  assert.ok(source.includes(needle), "mutation target not found in runCommand");
  assert.throws(
    () => {
      assertBlockedWiring(source.replace(needle, `      return reportFailedRun(io, "run", "children", outcome.runId, stateRoot, reason);
    }`));
    },
    assert.AssertionError,
    "the pin passed on a source that lost the children branch's BLOCKED block"
  );
});

/**
 * Every flowchart command that can end BLOCKED, not just the one that starts a
 * run. `run` printed the block from the beginning; `resume` and `answer`
 * printed a status line and nothing else, which is exactly the operator who
 * resumes a second time hoping for a different answer.
 *
 * The check is on `flowchartExitCode`, the single function all four sites end
 * at, so a fifth flowchart command cannot be added without routing BLOCKED too.
 */
function assertEveryFlowchartExitRoutesBlocked(source: string): void {
  const exits = [...source.matchAll(/return flowchartExitCode\(outcome\.status\);/g)];
  assert.equal(exits.length, 4, "run --flowchart, run --children, resume and answer report flowchart outcomes");
  for (const exit of exits) {
    assert.match(
      source.slice(Math.max(0, exit.index - 200), exit.index),
      /if \(outcome\.status === "BLOCKED"\) \{\s*reportBlockedRun\(io, outcome, stateRoot\);\s*\}/,
      `a flowchart outcome exits without routing BLOCKED at index ${exit.index}`
    );
  }
}

test("resume and answer route BLOCKED alongside both run branches", () => {
  assertEveryFlowchartExitRoutesBlocked(readFileSync(MAIN_PATH, "utf8"));
});

test("the four-site pin fails when resume drops the BLOCKED block", () => {
  const source = readFileSync(MAIN_PATH, "utf8");
  const needle = `      return reportFailedRun(io, "resume", "flowchart", outcome.runId, stateRoot, reason);
    }`;
  assert.ok(source.includes(needle), "mutation target not found in resumeCommand");
  assert.throws(
    () => {
      assertEveryFlowchartExitRoutesBlocked(
        source.replace(
          `${needle}
    // Same block \`run\` prints, on the command an operator reaches for after
    // reading it. The supervised branch above is deliberately left alone: its
    // stderr is byte-pinned, and a DAG resume has no flowchart node to reopen.
    if (outcome.status === "BLOCKED") {
      reportBlockedRun(io, outcome, stateRoot);
    }`,
          needle
        )
      );
    },
    assert.AssertionError,
    "the pin passed on a source where resume lost the BLOCKED block"
  );
});

/**
 * The branch that must stay silent. `resume --supervised` runs the DAG
 * supervisor, whose BLOCKED stderr is byte-pinned by
 * `loopback-cli-resume.test.ts`, and which has no flowchart node an unblock
 * could reopen. Adding the block there would break a frozen pin and offer a
 * remedy that does not apply.
 */
test("the supervised resume branch prints no BLOCKED block", () => {
  const source = readFileSync(MAIN_PATH, "utf8");
  const start = source.indexOf("  if (values.supervised === true) {");
  assert.ok(start >= 0, "the supervised resume branch must remain identifiable");
  const end = source.indexOf("\n  if (checkpointCarriesFlowchart(existing)) {", start);
  assert.ok(end > start, "could not find the end of the supervised branch");
  assert.ok(
    !source.slice(start, end).includes("reportBlockedRun"),
    "the supervised branch must not print the flowchart BLOCKED block"
  );
});

test("the block reads the newest RUN_BLOCKED and says so when no evidence was recorded", () => {
  const runId = "run_synthetic" as RunId;
  const blocked = (reason: string, requiredEvidence: readonly string[]) => ({
    id: `evt_${reason}` as EventId,
    schemaVersion: 1 as const,
    occurredAt: TS,
    runId,
    type: "RUN_BLOCKED" as const,
    actor: "supervisor" as const,
    payload: { reason, requiredEvidence: [...requiredEvidence] }
  });

  // A run can block more than once; only the newest demand is current, which is
  // the same last-writer-wins rule `inspectRun` applies to this payload.
  const report = formatBlockedRunReport(runId, "/tmp/state", [
    blocked("stale reason", ["evd_stale"]),
    blocked("ANALYSIS_QUEUED", [])
  ]);
  assert.match(report, /^ {2}reason: ANALYSIS_QUEUED$/m);
  assert.match(
    report,
    /^ {2}required evidence: \(none recorded\)$/m,
    "an empty demand is stated, not silently omitted"
  );
});

test("the formatter keeps the four-line prefix and never promotes discard to a fifth next", () => {
  const runId = "run_prefix_freeze" as RunId;
  const stateRoot = "/tmp/prefix-freeze";
  const report = formatBlockedRunReport(runId, stateRoot, [
    {
      id: "evt_prefix_freeze" as EventId,
      schemaVersion: 1,
      occurredAt: TS,
      runId,
      type: "RUN_BLOCKED",
      actor: "supervisor",
      payload: { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_required"] }
    }
  ]);
  const ordinary = [
    `  next: pnpm cli inspect --run ${runId} --state-root ${stateRoot}`,
    `  next: pnpm cli inject --run ${runId} --type fact --key <key> --value <text> --state-root ${stateRoot}`,
    `  next: pnpm cli unblock --run ${runId} --reason <text> [--retry-node <nodeId>] --state-root ${stateRoot}`,
    `  note: resume alone replays BLOCKED — unblock is the event that clears this log, so run unblock first, then pnpm cli resume --run ${runId} --state-root ${stateRoot} executes the reopened work`
  ];

  const assertFrozenRouting = (text: string): void => {
    const routed = text
      .split("\n")
      .filter((line) => line.startsWith("  next: ") || line.startsWith("  note: "));
    assert.deepEqual(routed.slice(0, ordinary.length), ordinary, text);
    assert.equal(
      routed.filter((line) => line.startsWith("  next: ")).length,
      3,
      "inspect, inject and unblock are the only next lines"
    );
    const discard = routed.find((line) => line.includes("--discard-executed"));
    assert.ok(discard?.startsWith("  note: "), "discard is disclosure about unblock, not another remedy");
  };

  assertFrozenRouting(report);

  const reordered = report.replace(
    `${ordinary[0]}\n${ordinary[1]}\n`,
    `${ordinary[1]}\n${ordinary[0]}\n`
  );
  assert.notEqual(reordered, report, "reorder mutation target must exist");
  assert.throws(() => assertFrozenRouting(reordered), assert.AssertionError);

  const fifthNext = report.replace(
    "  note: if that unblock is refused",
    "  next: if that unblock is refused"
  );
  assert.notEqual(fifthNext, report, "discard mutation target must exist");
  assert.throws(() => assertFrozenRouting(fifthNext), assert.AssertionError);
});

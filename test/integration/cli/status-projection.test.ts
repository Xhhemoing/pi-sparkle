// End-to-end cover for the additive `inspect --run --status-json` surface:
// exactly one RUN_STATUS_PROJECTION object on stdout, built from a real
// fake-executor run's persisted events, with mutual-exclusion refusals in the
// same style as the --summary-json refusals.
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";
import { createAgentInstanceId, createInvocationId, createMessageId, createRunId, createTaskId, parseRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { appendInvocationRecord, invocationsLogPath, readInvocationRecords } from "../../../src/telemetry/invocation-log.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { EventStore } from "../../../src/run/event-store.js";
import { SUPERVISOR, type TaskResult } from "../../../src/protocol/v1.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

/** Contract keys pinned from day one; additive changes update this list deliberately. */
const STATUS_PROJECTION_KEYS = [
  "type",
  "runId",
  "status",
  "children",
  "progress",
  "blockers",
  "cost",
  "safeNextSteps",
  "dataQuality"
] as const;

/** One node, no `--results` and no `--executor`: the node leases and stalls. */
const STALLING_FLOWCHART = {
  id: "cli-status-projection-stall",
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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-status-proj-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-status-proj-proj-"));
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

async function completedRun(stateRoot: string, projectRoot: string): Promise<string> {
  const started = capture();
  const code = await main(
    ["run", "--project", projectRoot, "--objective", "Audit the project", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  return parseRunIdFromOutput(started.out.join(""));
}

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

test("inspect --status-json prints one projection object for a completed run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));

    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 1, "JSON mode stdout is exactly one object");
    const projection = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(projection).sort(), [...STATUS_PROJECTION_KEYS].sort());
    assert.equal(projection.type, "RUN_STATUS_PROJECTION");
    assert.equal(projection.runId, runId);
    assert.equal(projection.status, "COMPLETED");
    assert.ok(!("id" in projection), "the projection is not a domain Event");

    const cost = projection.cost as Record<string, unknown>;
    assert.equal(cost.invocationsAvailable, false, "fake runs write no invocation log; that is a gap, not zero");
    const dataQuality = projection.dataQuality as Record<string, unknown>;
    assert.equal(dataQuality.truncated, false);
    const nexts = (projection.safeNextSteps as readonly Record<string, unknown>[]).map(
      (step) => step.command as string
    );
    assert.ok(nexts.every((command) => /^(inspect|inject|unblock|resume|answer)\b/.test(command)), "no invented verbs");
  });
});

test("a gate-blocked run routes to unblock, never to answer", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await blockedRun(stateRoot, projectRoot);
    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const projection = JSON.parse(json.out.join("").trim()) as Record<string, unknown>;
    assert.equal(projection.status, "BLOCKED");
    const blockers = projection.blockers as Record<string, unknown>;
    const nexts = (projection.safeNextSteps as readonly Record<string, unknown>[]).map(
      (step) => step.command as string
    );
    assert.ok(nexts.some((command) => command.startsWith("unblock")));
    assert.ok(!nexts.some((command) => command.startsWith("answer")));
    assert.ok(
      blockers.requiredEvidence !== undefined || blockers.gateCause !== undefined || blockers.pendingQuestions !== undefined
    );
  });
});

test("CLI forwards terminal child verification and pins nested status keys", async () => {
  await withRoots(async (stateRoot) => {
    const parent = makeRun();
    const child = { ...parent, id: createRunId(), parentRunId: parent.id, rootTaskId: createTaskId() };
    const result: TaskResult = {
      protocolVersion: 1, id: createMessageId(), occurredAt: parent.createdAt, runId: child.id,
      taskId: child.rootTaskId, from: createAgentInstanceId(), to: SUPERVISOR, type: "TASK_RESULT",
      outcome: "SUCCESS", summary: "done", artifactIds: [], evidenceIds: [],
      verification: { kind: "PASSED", evidenceIds: [], criteria: [{ id: "ac-met", kind: "PASSED", evidenceIds: [] }] }
    };
    const store = new EventStore(stateRoot, parent.id);
    await store.append(makeEvent("RUN_CREATED", { run: parent }));
    await store.append(makeEvent("CHILD_RUN_CREATED", { childRun: child }));
    await store.append(makeEvent("CHILD_MESSAGE", { message: result }, { taskId: child.rootTaskId }));
    const captured = capture();
    assert.equal(await main(["inspect", "--run", parent.id, "--state-root", stateRoot, "--status-json"], captured.io), 0, captured.err.join(""));
    const data = JSON.parse(captured.out.join(""));
    const keys = (value: object) => Object.keys(value).sort();
    assert.deepEqual(keys(data), [...STATUS_PROJECTION_KEYS].sort());
    assert.deepEqual(keys(data.children[0]), ["taskId", "childRunId", "outcome", "verification", "verificationSource", "criteriaReported", "metCriteria", "unmetCriteria", "unobservedCriteria"].sort());
    assert.equal(data.children[0].verification, "PASSED");
    assert.equal(data.children[0].verificationSource, "child-report");
    assert.deepEqual(data.children[0].metCriteria, ["ac-met"]);
    assert.deepEqual(keys(data.progress), ["total", "succeeded", "failed", "partial", "cancelled", "unobserved", "inFlight", "criteriaUnobserved", "criteriaNotReported"].sort());
    assert.deepEqual(keys(data.blockers), ["requiredEvidence", "pendingQuestions"].sort());
    assert.deepEqual(keys(data.cost), ["invocationsAvailable", "known", "unknown"].sort());
    assert.deepEqual(keys(data.cost.known), ["invocations", "withUsage", "pricedInvocations"].sort(), "undefined numeric totals are omitted, not zero");
    assert.deepEqual(keys(data.cost.unknown), ["missingUsage", "excludedNotOk", "unattributed", "unpricedInvocations"].sort());
    assert.deepEqual(keys(data.dataQuality), ["truncated", "invocationsTruncated"].sort());
  });
});

test("status cost excludes foreign runs and exposes telemetry truncation without changing bytes", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = parseRunId(await completedRun(stateRoot, projectRoot));
    const row = (id: typeof runId, tokensIn: number): ModelInvocation => ({
      id: createInvocationId(), runId: id, taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
      config: { provider: "faux", model: "fixture", modelVersion: undefined, parameterHash: "123abc" },
      responseHash: "123abc", tokensIn, tokensOut: 2, latencyMs: 10, callOutcome: "ok",
      occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z")
    });
    await appendInvocationRecord(stateRoot, row(runId, 10));
    await appendInvocationRecord(stateRoot, row(createRunId(), 900));
    const path = invocationsLogPath(stateRoot);
    await appendFile(path, '{"torn":');
    const eventsPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    await appendFile(eventsPath, '{"torn":');
    const before = await readFile(path);
    const eventsBefore = await readFile(eventsPath);
    const captured = capture();
    assert.equal(await main(["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"], captured.io), 0);
    const result = JSON.parse(captured.out.join(""));
    assert.equal(result.cost.known.tokensIn, 10);
    assert.deepEqual(result.dataQuality, { truncated: true, invocationsTruncated: true });
    assert.match(captured.err.join(""), /truncated invocation log/);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readFile(eventsPath), eventsBefore);
  });
});

for (const corruption of ["{broken}\n{}\n", "{}\n"]) {
  test(`telemetry corruption refuses rather than printing an empty projection: ${JSON.stringify(corruption)}`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const runId = await completedRun(stateRoot, projectRoot);
      await mkdir(join(stateRoot, "runtime"), { recursive: true });
      await writeFile(invocationsLogPath(stateRoot), corruption);
      const result = capture();
      assert.notEqual(await main(["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"], result.io), 0);
      assert.equal(result.out.join(""), "");
      assert.match(result.err.join(""), /corrupt invocation|invalid invocation/i);
    });
  });
}

test("projection telemetry reads enforce limits inside the reader", async () => {
  await withRoots(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(invocationsLogPath(stateRoot), "{}\n{}\n");
    await assert.rejects(readInvocationRecords(stateRoot, "refusing projection", { maxBytes: 1, maxRecords: 10 }), /maxBytes/);
    await assert.rejects(readInvocationRecords(stateRoot, "refusing projection", { maxBytes: 100, maxRecords: 1 }), /maxRecords/);
  });
});

test("unreadable invocation path errors are not swallowed", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    await mkdir(invocationsLogPath(stateRoot), { recursive: true });
    const result = capture();
    assert.notEqual(await main(["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"], result.io), 0);
    assert.equal(result.out.join(""), "");
    assert.match(result.err.join(""), /regular file/);
  });
});

test("an empty existing invocation file is available, unlike an absent file", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(invocationsLogPath(stateRoot), "");
    const result = capture();
    assert.equal(await main(["inspect", "--run", runId, "--state-root", stateRoot, "--status-json"], result.io), 0);
    const data = JSON.parse(result.out.join(""));
    assert.equal(data.cost.invocationsAvailable, true);
    assert.equal(data.cost.known.usd, undefined);
  });
});

test("flag mutual exclusions refuse in the existing inspect style", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await completedRun(stateRoot, projectRoot);
    const combos: readonly [readonly string[], string][] = [
      [(["--status-json", "--json"]), "only one of --json, --summary-json, or --status-json"],
      [(["--status-json", "--summary-json"]), "only one of --json, --summary-json, or --status-json"],
      [["--status-json", "--follow"], "either --follow or --status-json"]
    ];
    for (const [flags, message] of combos) {
      const failed = capture();
      const code = await main(["inspect", "--run", runId, "--state-root", stateRoot, ...flags], failed.io);
      assert.notEqual(code, 0, `inspect ${flags.join(" ")} must refuse`);
      assert.match(failed.err.join(""), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const episode = capture();
    const episodeCode = await main(
      ["inspect", "--episode", "ep_doesnotexist", "--state-root", stateRoot, "--status-json"],
      episode.io
    );
    assert.notEqual(episodeCode, 0);
    assert.match(episode.err.join(""), /only available with --run/);
  });
});

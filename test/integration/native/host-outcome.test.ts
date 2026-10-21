import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEvidenceId, createInvocationId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeWriteSession, isNativeHostObservation, type NativeWriteExecutorFactoryInput, type NativeWriteSessionResult } from "../../../src/native/write-session.js";
import { NativeHostOutcomeCollector, type NativeHostEvaluator, type NativeHostObservation } from "../../../src/native/host-outcome.js";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import type { RunOutcome } from "../../../src/run/coordinator.js";

const hostEvaluator = { evaluatorId: "node-checker", evaluatorVersion: "1", rubricId: "value-good", rubricVersion: "1",
  evaluatorDefinitionCanonicalJson: '{"accept":"exit 0","modelFailure":[1]}', modelFailureExitCodes: [1] };
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
async function fixture(body: (root: string, repo: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "native-outcome-")); const repo = path.join(root, "repo");
  await mkdir(repo); git(repo, ["init"]); git(repo, ["config", "user.name", "Outcome Test"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(repo, "value.txt"), "zero", "utf8"); git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture"]);
  try { await body(root, repo); } finally { await rm(root, { recursive: true, force: true }); }
}
function success(request: AgentExecutionRequest): ExecutionEvent {
  const evidenceId = createEvidenceId();
  return { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
    runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR", type: "TASK_RESULT",
    outcome: "SUCCESS", summary: "worker PASSED", artifactIds: [], evidenceIds: [evidenceId],
    verification: { kind: "PASSED", evidenceIds: [evidenceId] } } };
}
function invocation(request: AgentExecutionRequest, version: string | undefined): ModelInvocation {
  return { id: createInvocationId(), taskId: request.taskId, runId: request.runId, agentInstanceId: request.agentInstanceId,
    config: { provider: "faux", model: "fixture", modelVersion: version, parameterHash: "a" }, responseHash: "b",
    tokensIn: undefined, tokensOut: undefined, latencyMs: 1, occurredAt: nowIso(), callOutcome: "ok", executorClass: "faux" };
}
const args = ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)"];
function verification(trusted = true) {
  return { command: process.execPath, args, ...(trusted ? { trustedVerification: prepareTrustedVerification({ command: process.execPath, args }) } : {}) };
}
function observation(result: NativeWriteSessionResult): NativeHostObservation {
  const row = result.hostObservation;
  assert.ok(row, "actual native execution must publish a host observation"); return row;
}
interface WriterOptions {
  readonly evaluator?: NativeHostEvaluator | null;
  readonly emit?: (context: NativeWriteExecutorFactoryInput, request: AgentExecutionRequest, row: ModelInvocation, index: number) => void;
  readonly beforeFinish?: (context: NativeWriteExecutorFactoryInput, request: AgentExecutionRequest, index: number) => void | Promise<void>;
  readonly runtimeError?: boolean;
}
function writer(root: string, values: string[], versions: (string | undefined)[] = ["2026-10"], error = false, options: WriterOptions = {}) {
  const requests: AgentExecutionRequest[] = []; let number = 0;
  const factory = (context: NativeWriteExecutorFactoryInput) => {
    const index = number++;
    return { async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
      requests.push(request);
      const row = invocation(request, versions[index]);
      if (options.emit === undefined) context.onInvocation(row); else options.emit(context, request, row, index);
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: values[index] ?? "good" });
      if (error) yield { type: "TOOL_FINISHED", toolCallId: "swallowed", isError: true, summary: "failed" };
      await options.beforeFinish?.(context, request, index);
      if (options.runtimeError) throw new Error("runtime failed");
      yield success(request); yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } };
  };
  const evaluator = options.evaluator === undefined ? hostEvaluator : options.evaluator;
  return { requests, factory, session: new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), executorFactory: factory,
    ...(evaluator === null ? {} : { hostEvaluator: evaluator }) }) };
}

test("actual trusted check publishes bound host outcome without changing source or acceptance", async () => {
  await fixture(async (root, repo) => {
    const { session, requests } = writer(root, ["good"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(result.acceptance.accepted, true);
    assert.match(result.taskId ?? "", /^tsk_/); assert.match(result.logicalTaskId ?? "", /^logical_task_/);
    assert.equal(observation(result).assessment.outcome, "PASSED");
    assert.equal(observation(result).assessment.eligible, true);
    const observed = observation(result); const record = observed.assessment.record!;
    assert.equal(isNativeHostObservation(observed), true);
    assert.equal(isNativeHostObservation({ ...observed }), false);
    assert.equal(isNativeHostObservation(JSON.parse(JSON.stringify(observed))), false);
    assert.equal(record.runId, requests[0]!.runId); assert.notEqual(record.runId, result.runId);
    assert.equal(record.taskId, result.taskId); assert.equal(record.projectVersion, result.sourceRevision);
    assert.equal(observed.attempts[0]!.runId, result.runId);
    assert.equal(record.projectId, observed.attempts[0]!.projectId); assert.equal(record.episodeId, observed.attempts[0]!.episodeId);
    assert.equal(observed.executorClass, "faux"); assert.equal(record.modelId, "faux/fixture");
    assert.equal(Object.isFrozen(observed.invocations[0]!.config), true); assert.equal(Object.isFrozen(record.evidenceRefs), true);
    assert.ok(Date.parse(observed.startedAt) <= Date.parse(observed.invocations[0]!.occurredAt));
    assert.ok(Date.parse(observed.invocations[0]!.occurredAt) <= Date.parse(observed.completedAt));
    const artifactText = await readFile(observed.artifact.path, "utf8");
    assert.doesNotMatch(artifactText, /worker PASSED|responseHash|tokensIn|parameterHash|modelFailure/);
    assert.equal(isNativeHostObservation(JSON.parse(artifactText)), false);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "zero");
  });
});

test("default publication is opt-in and direct host entry explicitly forwards evaluator", async () => {
  await fixture(async (root, repo) => {
    const legacy = writer(root, ["good"], ["2026-10"], false, { evaluator: null });
    const result = await legacy.session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(result.hostObservation, undefined); assert.ok(result.taskId); assert.ok(result.logicalTaskId);
    const direct = writer(root, ["good"]);
    const published = await startDevelopmentTask({ sourceRepo: repo, objective: "make good", verification: verification(),
      stateRoot: path.join(root, "direct"), sandboxRoot: path.join(root, "direct-candidates"), executorFactory: direct.factory, hostEvaluator });
    assert.equal(observation(published).assessment.outcome, "PASSED");
    assert.notEqual(result.logicalTaskId, published.logicalTaskId);
  });
});

test("generic failure exits cannot acquire model-quality labels from repairability", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail"], ["2026-10"], false, { evaluator: { ...hostEvaluator, modelFailureExitCodes: [] } });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: { ...verification(), repairableExitCodes: [1] } });
    assert.equal(result.acceptance.accepted, false); assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.equal(observation(result).assessment.reason, "evaluator-unavailable-exit");
  });
});

test("earlier unavailable evaluator exit remains excluded after an accepted repair", async () => {
  await fixture(async (root, repo) => {
    const checkerArgs = ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:2)"];
    const { session } = writer(root, ["fail", "good"], ["2026-10", "2026-10"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", maxAttempts: 2, verification: {
      command: process.execPath, args: checkerArgs,
      trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs }) } });
    assert.equal(result.acceptance.accepted, true); assert.equal(result.loop!.attempts.length, 2);
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.equal(observation(result).assessment.reason, "evaluator-unavailable-exit");
  });
});

test("unavailable repair checker cannot reuse the preceding model-failure check", async () => {
  await fixture(async (root, repo) => {
    const checker = path.join(root, "checker.cjs");
    await writeFile(checker, "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)", "utf8");
    const checkerArgs = [checker];
    const { session } = writer(root, ["fail", "good"], ["2026-10", "2026-10"], false, {
      beforeFinish: async (_context, _request, index) => { if (index === 1) await writeFile(checker, "process.exit(0)", "utf8"); }
    });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", maxAttempts: 2, verification: {
      command: process.execPath, args: checkerArgs,
      trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs, checkerFiles: [checker] }) } });
    assert.equal(result.acceptance.accepted, false); assert.match(result.reason, /independent verification failed/);
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
  });
});

test("copied/changed/forged check or descriptor cannot issue exact host evidence", async () => {
  await fixture(async (root, repo) => {
    const verifier = verification(); const { session } = writer(root, ["good"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verifier });
    const check = result.acceptance.independentCheck!;
    for (const [candidate, descriptor] of [
      [{ ...check }, verifier.trustedVerification],
      [JSON.parse(JSON.stringify(check)) as typeof check, verifier.trustedVerification],
      [{ ...check, cwd: repo }, verifier.trustedVerification],
      [check, { ...verifier.trustedVerification! }]
    ] as const) {
      const collector = new NativeHostOutcomeCollector(hostEvaluator);
      collector.checked(candidate, descriptor, result.candidatePath, result.sourceRevision, result.artifact, result.runId);
      const published = collector.project({ runId: result.runId, taskId: result.taskId!, sourceRevision: result.sourceRevision,
        artifact: result.artifact, cancelled: false, timedOut: false, effectsSettled: true, accepted: true, terminalReason: "accepted" });
      assert.equal(published.assessment.outcome, "UNOBSERVED"); assert.equal(published.assessment.reason, "original-exact-evidence-required");
    }
  });
});

test("genuine checker plus fabricated host binding cannot mint an issued observation", async () => {
  await fixture(async (root, repo) => {
    const verifier = verification(); const { session, requests } = writer(root, ["good"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verifier });
    const collector = new NativeHostOutcomeCollector(hostEvaluator); const attempt = collector.beginAttempt();
    for await (const _event of attempt.wrap({ async *execute() { yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }; } })
      .execute(requests[0]!, new AbortController().signal)) { /* actual request copied from genuine execution */ }
    attempt.onInvocation(observation(result).invocations[0]!);
    attempt.complete({ runId: "run_forged", project: { id: "prj_forged" }, status: "COMPLETED",
      events: [{ type: "RUN_ATTACHED", payload: { episodeId: "ep_forged" } }] } as unknown as RunOutcome, result.taskId!);
    collector.checked(result.acceptance.independentCheck!, verifier.trustedVerification, result.candidatePath, result.sourceRevision, result.artifact, result.runId);
    const forged = collector.project({ runId: "run_forged" as typeof result.runId, taskId: result.taskId!, sourceRevision: result.sourceRevision,
      artifact: result.artifact, cancelled: false, timedOut: false, effectsSettled: true, accepted: true, terminalReason: "accepted" });
    assert.equal(isNativeHostObservation(forged), false, "a projection assembled from arbitrary host JSON must have no session issuance authority");
  });
});

test("host evaluator snapshots reject getters before evaluating them", () => {
  let calls = 0;
  const withGetter = { ...hostEvaluator };
  Object.defineProperty(withGetter, "evaluatorId", { get() { calls++; return "side-effect"; } });
  const exits = [1]; Object.defineProperty(exits, "0", { get() { calls++; return 1; } });
  for (const evaluator of [withGetter, { ...hostEvaluator, modelFailureExitCodes: exits }]) {
    assert.throws(() => new NativeWriteSession({ stateRoot: "unused", executorFactory: () => { throw new Error("unused"); }, hostEvaluator: evaluator }), /own data|plain/);
  }
  assert.equal(calls, 0);
});

test("malformed, foreign, conflicting, overflow and missing telemetry explicitly exclude", async () => {
  const cases: [string, NonNullable<WriterOptions["emit"]>][] = [
    ["malformed-invocation", (context, _request, row) => context.onInvocation({ ...row, latencyMs: -1 })],
    ["missing-or-foreign-invocation", () => undefined],
    ["missing-or-foreign-invocation", (context, _request, row) => context.onInvocation({ ...row, taskId: "tsk_foreign" as typeof row.taskId })],
    ["conflicting-invocation", (context, _request, row) => { context.onInvocation(row); context.onInvocation({ ...row, responseHash: "c" }); }],
    ["invocation-overflow", (context, _request, row) => { for (let index = 0; index < 257; index++) context.onInvocation({ ...row, id: createInvocationId() }); }]
  ];
  for (const [reason, emit] of cases) await fixture(async (root, repo) => {
    const { session } = writer(root, ["good"], ["2026-10"], false, { emit });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(result.acceptance.accepted, true); assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.equal(observation(result).assessment.reason, reason); assert.ok(observation(result).invocations.length <= 256);
  });
});

test("unrepresentable provider identity excludes telemetry without failing an accepted task", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["good"], ["2026-10"], false, {
      emit: (context, _request, row) => context.onInvocation({ ...row, config: { ...row.config, provider: "bad/provider" } })
    });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(result.acceptance.accepted, true); assert.equal(observation(result).assessment.reason, "malformed-invocation");
  });
});

test("provider errors, unknown call outcomes and runtime failures never become quality outcomes", async () => {
  for (const failure of ["error", "timeout", "cancelled", "unknown", "runtime"] as const) await fixture(async (root, repo) => {
    const { session } = writer(root, ["good"], ["2026-10"], false, { runtimeError: failure === "runtime",
      emit: (context, _request, row) => context.onInvocation({ ...row, callOutcome: failure === "unknown" ? undefined : failure === "runtime" ? "ok" : failure }) });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.equal(observation(result).assessment.reason, failure === "error" ? "provider-failure" : failure === "runtime" ? "run-failure" : failure === "unknown" ? "unknown-call-outcome" : failure);
  });
});

test("all repair identities and immutable telemetry survive aggregation, including provenance", async () => {
  for (const classes of [["faux", "faux"], [undefined, undefined], ["faux", "pi"]] as const) await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail", "good"], ["2026-10", "2026-10"], false, {
      emit(context, _request, row, index) {
        const mutable = { ...row, config: { ...row.config }, executorClass: classes[index] };
        context.onInvocation(mutable); context.onInvocation(mutable);
        mutable.config.modelVersion = "mutated-after-callback";
      }
    });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), maxAttempts: 2 });
    const observed = observation(result);
    assert.equal(observed.assessment.outcome, "PASSED"); assert.equal(observed.attempts.length, 2); assert.equal(observed.invocations.length, 2);
    assert.notEqual(observed.attempts[0]!.taskId, observed.attempts[1]!.taskId); assert.notEqual(observed.attempts[0]!.runId, observed.attempts[1]!.runId);
    assert.equal(observed.logicalTaskId, result.logicalTaskId); assert.equal(observed.invocations[0]!.config.modelVersion, "2026-10");
    assert.equal(observed.executorClass, classes[0] === undefined ? "unknown" : classes[0] === classes[1] ? "faux" : "mixed");
  });
});

test("different actual repair model versions cannot be overwritten by the last attempt", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail", "good"], ["old", "new"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), maxAttempts: 2 });
    assert.equal(result.acceptance.accepted, true); assert.equal(observation(result).assessment.reason, "unknown-or-mixed-model-version");
  });
});

test("host-declared unsettled checker exits exclude even explicit model-failure semantics", async () => {
  await fixture(async (root, repo) => {
    const checkerArgs = ["-e", "process.exit(2)"];
    const { session } = writer(root, ["good"], ["2026-10"], false, { evaluator: { ...hostEvaluator,
      modelFailureExitCodes: [2], evaluatorDefinitionCanonicalJson: '{"modelFailure":[2]}' } });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: {
      command: process.execPath, args: checkerArgs, unsettledExitCodes: [2],
      trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs }) } });
    assert.equal(result.effectsSettled, false); assert.equal(result.acceptance.accepted, false);
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED"); assert.equal(observation(result).assessment.reason, "unsettled-effects");
  });
});

test("repair-context failure cannot publish the preceding model-evaluated check", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail"], ["2026-10"], false, {
      beforeFinish: async (context) => { await writeFile(path.join(context.candidatePath, "value.txt"), Buffer.from([0xff])); }
    });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), maxAttempts: 2,
      taskContext: { requiredFiles: ["value.txt"], expectedSourceRevision: git(repo, ["rev-parse", "HEAD"]), tokenBudget: 2000 } });
    assert.equal(result.acceptance.accepted, false); assert.match(result.reason, /task context admission failed/);
    assert.equal(observation(result).attempts.length, 1); assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.match(observation(result).assessment.reason ?? "", /run-failure/);
  });
});

test("host deadline and explicit cancellation exclude completed worker self-reports", async () => {
  for (const mode of ["deadline", "cancel"] as const) await fixture(async (root, repo) => {
    const abort = new AbortController();
    const { session } = writer(root, ["good"], ["2026-10"], false, {
      beforeFinish: async (context) => {
        if (mode === "cancel") abort.abort();
        else await new Promise<void>((resolve) => {
          if (context.signal.aborted) resolve(); else context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    });
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), signal: abort.signal,
      ...(mode === "deadline" ? { maxWallTimeMs: 6000 } : {}) });
    assert.equal(result.status, "CANCELLED"); assert.equal(result.acceptance.accepted, false);
    assert.equal(observation(result).assessment.reason, mode === "deadline" ? "timeout" : "cancelled");
  });
});

test("late cancellation during observation persistence corrects single and repair-loop durable results", async () => {
  for (const maxAttempts of [undefined, 2]) await fixture(async (root, repo) => {
    const abort = new AbortController(); const originalRename = fs.rename; let injected = false;
    fs.rename = async (source, destination) => {
      if (!injected && String(destination).includes("loop-artifacts")) {
        const payload = JSON.parse(await readFile(source, "utf8")) as { body?: { kind?: string } };
        if (payload.body?.kind === "native-host-observation") { injected = true; abort.abort(); }
      }
      return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    try {
      const { session } = writer(root, ["good"]);
      const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), signal: abort.signal,
        ...(maxAttempts === undefined ? {} : { maxAttempts }) });
      assert.equal(injected, true); assert.equal(result.status, "CANCELLED"); assert.equal(result.acceptance.accepted, false);
      assert.equal(observation(result).assessment.outcome, "UNOBSERVED"); assert.equal(observation(result).assessment.reason, "cancelled");
      const final = JSON.parse(await readFile(observation(result).artifact.path, "utf8")) as { body: { terminalState?: string; supersedesArtifactId?: string } };
      assert.equal(final.body.terminalState, "CANCELLED"); assert.ok(final.body.supersedesArtifactId);
      if (maxAttempts !== undefined) {
        assert.equal(result.loop!.stopReason, "cancelled");
        const loop = JSON.parse(await readFile(result.loop!.artifact.path, "utf8")) as { body: { stopReason: string; supersedesArtifactId?: string } };
        assert.equal(loop.body.stopReason, "cancelled"); assert.ok(loop.body.supersedesArtifactId);
      }
    } finally { fs.rename = originalRename; syncBuiltinESMExports(); }
  });
});

test("worker PASSED is model-evaluated FAILED only under declared host evaluator exits", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification() });
    assert.equal(result.acceptance.accepted, false);
    assert.equal(observation(result).assessment.outcome, "FAILED");
  });
});

test("missing exact descriptor and swallowed tool error remain explicitly unobserved", async () => {
  for (const error of [false, true]) await fixture(async (root, repo) => {
    const { session } = writer(root, ["good"], ["2026-10"], error);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(error) });
    assert.equal(result.acceptance.accepted, true);
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.match(observation(result).assessment.reason ?? "", error ? /tool-failure/ : /exact/);
  });
});

test("repairs retain earlier unknown model version rather than attributing final success", async () => {
  await fixture(async (root, repo) => {
    const { session } = writer(root, ["fail", "good"], [undefined, "2026-10"]);
    const result = await session.execute({ sourceRepo: repo, objective: "make good", verification: verification(), maxAttempts: 2 });
    assert.equal(result.acceptance.accepted, true);
    assert.equal(observation(result).assessment.outcome, "UNOBSERVED");
    assert.match(observation(result).assessment.reason ?? "", /model/);
  });
});

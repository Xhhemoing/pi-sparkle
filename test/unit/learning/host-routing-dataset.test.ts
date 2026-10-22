import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createEvidenceId, createInvocationId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeWriteSession } from "../../../src/native/write-session.js";
import type { NativeHostObservation } from "../../../src/native/host-outcome.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { runHostRoutingCase, prepareHostRoutingDataset, type HostRoutingCaseDeclaration } from "../../../src/learning/host-routing-dataset.js";

const evaluator = { evaluatorId: "node-checker", evaluatorVersion: "1", rubricId: "good", rubricVersion: "1",
  evaluatorDefinitionCanonicalJson: '{"accept":"exit 0","modelFailure":[1]}', modelFailureExitCodes: [1] };
const checkerArgs = ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)"];
let root: string;
let repo: string;
function declaration(caseId: string, problemId = caseId, templateId = caseId): HostRoutingCaseDeclaration {
  return { caseId, problemId, templateId, predecision: { taskFamily: "edit", features: { hasTests: true, files: 1 } },
    candidate: { candidateId: "faux-high", provider: "faux", model: "fixture", modelVersion: "2026-10", effort: "high",
      toolProfileId: "scoped-files", maxAttempts: 2, maxWallTimeMs: 60_000 } };
}
function terminal(request: AgentExecutionRequest): ExecutionEvent {
  const id = createEvidenceId();
  return { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
    runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR", type: "TASK_RESULT",
    outcome: "SUCCESS", summary: "fixture self report", artifactIds: [], evidenceIds: [id], verification: { kind: "PASSED", evidenceIds: [id] } } };
}
async function issue(options: { values?: string[]; version?: string | null; model?: string; missingUsage?: boolean;
  sharedId?: ModelInvocation["id"] } = {}): Promise<{ hostObservation?: NativeHostObservation }> {
  let attempt = 0;
  const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), hostEvaluator: evaluator,
    executorFactory: (context) => ({ async *execute(request): AsyncIterable<ExecutionEvent> {
      const index = attempt++;
      context.onInvocation({ id: options.sharedId ?? createInvocationId(), runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId,
        config: { provider: "faux", model: options.model ?? "fixture", modelVersion: options.version === null ? undefined : options.version ?? "2026-10", parameterHash: "ab" },
        responseHash: "cd", tokensIn: options.missingUsage ? undefined : 100, tokensOut: options.missingUsage ? undefined : 50,
        latencyMs: 3, occurredAt: nowIso(), executorClass: "faux", callOutcome: "ok",
        pricing: { catalogVersion: "fixture", inputUsdPerMTok: 2, outputUsdPerMTok: 4 } });
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: options.values?.[index] ?? "good" });
      yield terminal(request);
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } }) });
  try { return await session.execute({ sourceRepo: repo, objective: "private objective must not export", maxAttempts: options.values?.length ?? 1,
    verification: { command: process.execPath, args: checkerArgs, repairableExitCodes: [1],
      trustedVerification: prepareTrustedVerification({ command: process.execPath, args: checkerArgs }) } }); }
  finally { await session.shutdown(); }
}
const project = (cases: readonly unknown[], cutoff = "2999-01-01T00:00:00.000Z") => prepareHostRoutingDataset({ cases, evidenceMode: "synthetic", cutoff });
before(async () => {
  await mkdir(path.resolve(".agent_workspace/routing-training-data"), { recursive: true });
  root = await mkdtemp(path.resolve(".agent_workspace/routing-training-data/dataset-"));
  repo = path.join(root, "repo"); await mkdir(repo); await mkdir(path.join(root, "candidates"));
  for (const args of [["init"], ["config", "user.name", "Dataset Test"], ["config", "user.email", "test@example.com"]]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
  }
  await writeFile(path.join(repo, "value.txt"), "zero", "utf8");
  for (const args of [["add", "value.txt"], ["commit", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
  }
});
after(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); });

test("captures declarations before execution and exports only independent host labels and allowed metadata", async () => {
  const input = declaration("pass");
  const pending = runHostRoutingCase({ declaration: input, execute: async () => {
    input.predecision.features.files = 999;
    return issue();
  } });
  const captured = await pending;
  assert.equal(captured.declaration.predecision.features.files, 1);
  assert.ok(Object.isFrozen(captured.declaration.candidate));
  const dataset = project([captured]);
  assert.equal(dataset.rows.length, 1); assert.equal(dataset.training.length, 1);
  const row = dataset.training[0]!;
  assert.equal(row.label?.outcome, "PASSED");
  assert.deepEqual(row.actual, [{ provider: "faux", model: "fixture", modelVersion: "2026-10", parameterHash: "ab" }]);
  assert.equal(row.declaration?.candidate.effort, "high");
  assert.equal(row.usageCoverage.overall.cost.completeUsd, 0.0004);
  assert.ok(row.timing!.wallTimeMs >= 0);
  assert.equal(row.timing!.recordedInvocationLatencyMs, 3);
  assert.equal(row.sourceRevision, captured.hostObservation!.sourceRevision);
  const serialized = JSON.stringify(dataset);
  for (const forbidden of ["private objective", repo, "candidatePath", "artifact.path", "evaluatorDefinitionCanonicalJson", "hostObservation"]) assert.ok(!serialized.includes(forbidden), forbidden);
});

test("failed host checks are negative labels despite worker PASSED; repairs stay one sample with all usage", async () => {
  const failed = await runHostRoutingCase({ declaration: declaration("failed"), execute: () => issue({ values: ["bad"] }) });
  const repaired = await runHostRoutingCase({ declaration: declaration("repair"), execute: () => issue({ values: ["bad", "good"] }) });
  const dataset = project([failed, repaired]);
  assert.equal(dataset.training.length, 2);
  assert.equal(dataset.training.find((row) => row.declaration?.caseId === "failed")!.label?.outcome, "FAILED");
  const row = dataset.training.find((entry) => entry.declaration?.caseId === "repair")!;
  assert.equal(row.label?.outcome, "PASSED"); assert.equal(row.refs.attemptRunIds.length, 2);
  assert.equal(row.usageCoverage.overall.invocations, 2); assert.equal(row.usageCoverage.overall.input.tokens, 200);
});

test("unknown versions, actual model/version mismatch and missing usage remain explicit", async () => {
  const cases = await Promise.all([
    runHostRoutingCase({ declaration: declaration("unknown"), execute: () => issue({ version: null }) }),
    runHostRoutingCase({ declaration: declaration("other-model"), execute: () => issue({ model: "other" }) }),
    runHostRoutingCase({ declaration: declaration("other-version"), execute: () => issue({ version: "v2" }) }),
    runHostRoutingCase({ declaration: declaration("unknown-cost"), execute: () => issue({ missingUsage: true }) })
  ]);
  const dataset = project(cases);
  assert.equal(dataset.training.length, 1); assert.equal(dataset.excluded.length, 3);
  assert.equal(dataset.training[0]!.declaration?.caseId, "unknown-cost");
  assert.equal(dataset.training[0]!.usageCoverage.overall.cost.completeUsd, undefined);
  assert.equal(dataset.excluded.find((row) => row.declaration?.caseId === "unknown")!.hostAttributionExclusion?.detail, "unknown-or-mixed-model-version");
  assert.equal(dataset.excluded.find((row) => row.declaration?.caseId === "other-model")!.exclusionReason, "candidate-identity-mismatch");
  assert.equal(dataset.excluded.find((row) => row.declaration?.caseId === "other-version")!.actual[0]!.modelVersion, "v2");
  assert.equal(dataset.overallCoverage.overall.invocations, 4);
});

test("same problem OR template links a transitive group across cutoff", async () => {
  const first = await runHostRoutingCase({ declaration: declaration("a", "problem-a", "template-a"), execute: () => issue() });
  const cutoff = nowIso();
  const second = await runHostRoutingCase({ declaration: declaration("b", "problem-a", "template-b"), execute: () => issue() });
  const third = await runHostRoutingCase({ declaration: declaration("c", "problem-c", "template-b"), execute: () => issue() });
  const dataset = project([first, second, third], cutoff);
  assert.equal(dataset.training.length, 0); assert.equal(dataset.test.length, 0);
  assert.equal(dataset.excluded.length, 3);
  assert.ok(dataset.excluded.every((row) => row.exclusionReason === "cross-boundary-group"));
  assert.equal(dataset.overallCoverage.overall.invocations, 3);
  assert.deepEqual(dataset, project([third, first, second], cutoff));
});

test("trusted capture dedup is idempotent; repeated case IDs or observations do not become independent samples", async () => {
  const first = await runHostRoutingCase({ declaration: declaration("a"), execute: () => issue() });
  assert.equal(project([first, first]).training.length, 1);
  const second = await runHostRoutingCase({ declaration: declaration("a"), execute: () => issue() });
  const duplicate = project([first, second]);
  assert.equal(duplicate.training.length, 0); assert.equal(duplicate.excluded.length, 2);
  assert.ok(duplicate.excluded.every((row) => row.exclusionReason === "duplicate-case-id"));
  const originalObservation = first.hostObservation;
  assert.ok(originalObservation);
  const rebound = await runHostRoutingCase({ declaration: declaration("b"), execute: async () => ({ hostObservation: originalObservation }) });
  const reused = project([first, rebound]);
  assert.equal(reused.training.length, 0);
  assert.equal(reused.overallCoverage.overall.invocations, 1);
});

test("conflicting genuine invocation IDs exclude labels but do not invent a usage variant", async () => {
  const sharedId = createInvocationId();
  const first = await runHostRoutingCase({ declaration: declaration("a"), execute: () => issue({ sharedId }) });
  const second = await runHostRoutingCase({ declaration: declaration("b"), execute: () => issue({ sharedId }) });
  const dataset = project([first, second]);
  assert.equal(dataset.training.length, 0);
  assert.equal(dataset.overallCoverage.conflicts.length, 1);
  assert.equal(dataset.overallCoverage.overall.cost.completeUsd, undefined);
});

test("JSON copies and post-hoc lookalikes cannot establish capture or observation authority", async () => {
  const captured = await runHostRoutingCase({ declaration: declaration("real"), execute: () => issue() });
  const lookalike = { declaration: declaration("forged"), hostObservation: captured.hostObservation };
  const forgedObservation = await runHostRoutingCase({ declaration: declaration("copied"), execute: async () => ({ hostObservation: JSON.parse(JSON.stringify(captured.hostObservation)) }) });
  const dataset = project([JSON.parse(JSON.stringify(captured)), lookalike, forgedObservation]);
  assert.equal(dataset.training.length, 0); assert.equal(dataset.excluded.length, 3);
  assert.equal(dataset.overallCoverage.overall.invocations, 0);
});

test("a prior genuine observation cannot acquire a post-hoc predecision declaration", async () => {
  const old = await issue();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const captured = await runHostRoutingCase({ declaration: declaration("old"), execute: async () => old });
  const dataset = project([captured]);
  assert.equal(dataset.training.length, 0);
  assert.equal(dataset.excluded[0]!.exclusionReason, "observation-before-capture");
  assert.equal(dataset.overallCoverage.overall.invocations, 1);
});

test("declaration accessors and unapproved text fields are rejected without invoking them or execute", async () => {
  let reads = 0; let executions = 0;
  const input = declaration("getter");
  Object.defineProperty(input.predecision.features, "hidden", { get() { reads++; return 1; }, enumerable: false });
  await assert.rejects(runHostRoutingCase({ declaration: input, execute: async () => { executions++; return {}; } }), /data|accessor/i);
  await assert.rejects(runHostRoutingCase({ declaration: { ...declaration("text"), objective: "private" } as HostRoutingCaseDeclaration, execute: async () => { executions++; return {}; } }), /field|allow/i);
  await assert.rejects(runHostRoutingCase({ declaration: { ...declaration("path"), caseId: "C:\\private" }, execute: async () => { executions++; return {}; } }), /identifier|token/i);
  assert.equal(reads, 0); assert.equal(executions, 0);
});

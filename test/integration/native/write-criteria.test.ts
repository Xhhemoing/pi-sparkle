import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { NativeWriteSession, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";
import { EventStore } from "../../../src/run/event-store.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeApplySession } from "../../../src/native/apply.js";
import { issueApplyRegistration } from "../../../src/native/apply-registration.js";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout;
}
async function fixture(body: (root: string, repo: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "native-criteria-")); const repo = path.join(root, "repo");
  await mkdir(repo); git(repo, ["init"]); git(repo, ["config", "user.name", "Criteria Test"]);
  git(repo, ["config", "user.email", "test@example.com"]); await writeFile(path.join(repo, "value.txt"), "zero");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture"]);
  try { await body(root, repo); } finally { await rm(root, { recursive: true, force: true }); }
}
function success(request: AgentExecutionRequest): ExecutionEvent {
  const evidenceId = createEvidenceId();
  return { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(), runId: request.runId,
    taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR", type: "TASK_RESULT", outcome: "SUCCESS",
    summary: "all requirements passed", artifactIds: [], evidenceIds: [evidenceId], verification: { kind: "PASSED", evidenceIds: [evidenceId] } } };
}
const criteria = [{ id: "value-correct", description: "Return good", observableCheck: "Host reads value.txt and compares exact bytes" }];
const verification = { command: process.execPath, args: ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:1)"] };
function makeSession(root: string, contexts: NativeWriteExecutorFactoryInput[], requests: AgentExecutionRequest[], values: string[], mutate?: () => void) {
  return new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), executorFactory(context) {
    contexts.push(context); mutate?.();
    return { async *execute(request): AsyncIterable<ExecutionEvent> {
      requests.push(request);
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: values[Math.min(contexts.length - 1, values.length - 1)]! });
      yield success(request); yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } };
  } });
}

test("host criteria reach actual prompt, structured task request and bound result artifact", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
    const result = await makeSession(root, contexts, requests, ["good"]).execute({ sourceRepo: repo, objective: "repair", verification, acceptanceCriteria: criteria });
    assert.equal(result.acceptance.accepted, true); assert.deepEqual(contexts[0]?.acceptanceCriteria, criteria);
    assert.match(requests[0]?.prompt ?? "", /value-correct/); assert.match(requests[0]?.prompt ?? "", /Host reads value.txt/);
    const events = (await new EventStore(path.join(root, "state"), result.runId).readAll()).events;
    const request = events.flatMap((event) => event.type === "CHILD_MESSAGE" && event.payload.message.type === "TASK_REQUEST" ? [event.payload.message] : [])[0]!;
    assert.deepEqual(request.acceptanceCriteria, [{ id: criteria[0]!.id, description: `${criteria[0]!.description}; check: ${criteria[0]!.observableCheck}` }]);
    assert.equal(result.taskContract?.taskId, request.taskId); assert.deepEqual(result.taskContract?.criterionIds, ["value-correct"]);
    const stored = JSON.parse(await readFile(result.taskContract!.artifact.path, "utf8")) as { body: { kind: string; taskId: string; acceptanceCriteria: unknown; verification: unknown } };
    assert.equal(stored.body.kind, "native-write-task-contract"); assert.equal(stored.body.taskId, request.taskId);
    assert.deepEqual(stored.body.acceptanceCriteria, criteria); assert.deepEqual(stored.body.verification, verification);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "zero");
  });
});

test("caller/factory mutation cannot alter criteria or execute descriptive observableCheck", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
    const input = { sourceRepo: repo, objective: "repair", verification: { command: verification.command, args: [...verification.args] },
      acceptanceCriteria: [{ ...criteria[0]! }] };
    const write = makeSession(root, contexts, requests, ["fail"], () => {
      input.acceptanceCriteria[0]!.id = "injected"; input.acceptanceCriteria[0]!.observableCheck = "process.exit(0)";
      input.verification.args[1] = "process.exit(0)";
      assert.equal(Object.isFrozen(contexts[0]?.acceptanceCriteria?.[0]), true);
    });
    const result = await write.execute(input);
    assert.equal(result.acceptance.accepted, false, "child PASSED cannot override failed host check");
    assert.deepEqual(result.taskContract?.acceptanceCriteria, criteria); assert.match(requests[0]?.prompt ?? "", /value-correct/);
    assert.doesNotMatch(requests[0]?.prompt ?? "", /injected/);
  });
});

test("each repair attempt keeps immutable criteria and its actual task binding", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
    const result = await makeSession(root, contexts, requests, ["fail", "good"]).execute({ sourceRepo: repo, objective: "repair", verification,
      acceptanceCriteria: criteria, maxAttempts: 3 });
    assert.equal(result.loop?.attempts.length, 2); assert.equal(result.acceptance.accepted, true);
    const taskIds: string[] = [];
    for (const attempt of result.loop!.attempts) {
      const stored = JSON.parse(await readFile(attempt.taskContractArtifact!.path, "utf8")) as { body: { runId: string; taskId: string; acceptanceCriteria: unknown } };
      assert.equal(stored.body.runId, attempt.runId); assert.deepEqual(stored.body.acceptanceCriteria, criteria); taskIds.push(stored.body.taskId);
    }
    assert.equal(new Set(taskIds).size, 2); assert.equal(result.taskContract?.taskId, taskIds[1]);
  });
});

test("invalid criteria allocate no candidate or executor and omitted criteria remain absent", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
    const write = makeSession(root, contexts, requests, ["good"]);
    await assert.rejects(write.execute({ sourceRepo: repo, objective: "repair", verification, acceptanceCriteria: [criteria[0]!, criteria[0]!] }), /acceptance criteria/i);
    assert.equal(contexts.length, 0); assert.equal(write.activeCount, 0);
    assert.deepEqual(await readdir(path.join(root, "candidates")).catch(() => []), []);
    const result = await write.execute({ sourceRepo: repo, objective: "repair", verification });
    assert.equal("taskContract" in result, false); assert.equal("acceptanceCriteria" in contexts[0]!, false);
  });
});

test("native trusted verification preserves host capability and refuses forged descriptor before execution", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
    const descriptor = prepareTrustedVerification(verification);
    const write = makeSession(root, contexts, requests, ["good"]);
    await assert.rejects(write.execute({ sourceRepo: repo, objective: "repair", acceptanceCriteria: criteria,
      verification: { ...verification, trustedVerification: { ...descriptor } } }), /host-issued descriptor/i);
    assert.equal(contexts.length, 0);
    const result = await write.execute({ sourceRepo: repo, objective: "repair", acceptanceCriteria: criteria,
      verification: { ...verification, trustedVerification: descriptor } });
    assert.equal(result.acceptance.accepted, true); assert.equal(result.acceptance.independentCheck?.trustedVerification?.ok, true);
    assert.equal(result.acceptance.independentCheck?.trustedVerification?.descriptorId, descriptor.id);
  });
});

for (const operation of ["apply", "issue"] as const) {
  test(`trusted candidate ${operation} refuses silent downgrade to legacy verification`, async () => {
    await fixture(async (root, repo) => {
      const contexts: NativeWriteExecutorFactoryInput[] = []; const requests: AgentExecutionRequest[] = [];
      const descriptor = prepareTrustedVerification(verification);
      const result = await makeSession(root, contexts, requests, ["good"]).execute({ sourceRepo: repo, objective: "repair",
        verification: { ...verification, trustedVerification: descriptor } });
      assert.equal(result.acceptance.accepted, true);
      const operationPromise = operation === "apply" ? new NativeApplySession().apply({ sourceRepo: repo, result }) :
        issueApplyRegistration({ stateRoot: path.join(root, "state"), sourceRepo: repo, result });
      await assert.rejects(operationPromise, /trusted verification.*(not supported|descriptor|refus)/i);
      assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "zero");
      assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "good");
    });
  });
}

test("host repairable exits distinguish assertion failure from aggregate infrastructure failure", async () => {
  await fixture(async (root, repo) => {
    const verify = { command: process.execPath, args: ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='good'?0:2)"] };
    const limitedContexts: NativeWriteExecutorFactoryInput[] = [];
    const allowed = [1];
    const limited = await makeSession(root, limitedContexts, [], ["fail", "good"], () => { allowed.push(2); }).execute({
      sourceRepo: repo, objective: "repair", verification: { ...verify, repairableExitCodes: allowed }, maxAttempts: 3 });
    assert.equal(limited.acceptance.accepted, false); assert.equal(limitedContexts.length, 1);
    assert.equal(limited.loop?.stopReason, "verification-unavailable");
    const defaultContexts: NativeWriteExecutorFactoryInput[] = [];
    const legacy = await makeSession(root, defaultContexts, [], ["fail", "good"]).execute({
      sourceRepo: repo, objective: "repair", verification: verify, maxAttempts: 3 });
    assert.equal(legacy.acceptance.accepted, true); assert.equal(defaultContexts.length, 2);
  });
});

test("invalid repairable-exit policies are refused before worker allocation", async () => {
  await fixture(async (root, repo) => {
    const contexts: NativeWriteExecutorFactoryInput[] = [];
    const write = makeSession(root, contexts, [], ["good"]);
    for (const repairableExitCodes of ["1", [0], [-1], [1.5], [256], [1, 1], [NaN], new Array(1)]) {
      await assert.rejects(write.execute({ sourceRepo: repo, objective: "repair", verification: { ...verification,
        repairableExitCodes: repairableExitCodes as readonly number[] } }), /repairableExitCodes/);
    }
    assert.equal(contexts.length, 0);
  });
});

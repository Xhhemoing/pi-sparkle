import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeWriteSession, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";
import type { CheckFindingAnalysisInput, CheckFindingAnalysisOptions } from "../../../src/evaluation/check-finding-analysis.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
async function fixture(body: (repo: string, root: string, sandboxRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "finding-analysis-"));
  const repo = path.join(root, "repo"); const sandboxRoot = path.join(root, "sandbox");
  await mkdir(repo); await mkdir(sandboxRoot);
  git(repo, ["init"]); git(repo, ["config", "user.email", "test@example.com"]); git(repo, ["config", "user.name", "Analysis Test"]);
  await writeFile(path.join(repo, "value.txt"), "original", "utf8");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture"]);
  try { await body(repo, root, sandboxRoot); } finally { await rm(root, { recursive: true, force: true }); }
}
const successfulExecutor: AgentExecutor = {
  async *execute(request) {
    const evidenceIds = [createEvidenceId()];
    yield { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
      runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
      type: "TASK_RESULT", outcome: "SUCCESS", summary: "worker finished", artifactIds: [], evidenceIds,
      verification: { kind: "PASSED", evidenceIds } } };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
};
function verification(code = "process.exit(7)") {
  const args = ["-e", code];
  return { command: process.execPath, args, trustedVerification: prepareTrustedVerification({ command: process.execPath, args }) };
}
const turn = () => new Promise((resolve) => setTimeout(resolve, 20));
async function started<T>(ready: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([ready, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("analyzer did not start")), 10_000);
  })]); } finally { clearTimeout(timer); }
}

test("actual trusted failed checker supplies frozen finding and bounded output without gaining acceptance", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    let received: CheckFindingAnalysisInput | undefined;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor, checkFindingAnalysis: { analyze: (input) => {
        received = input; return { summary: "permission to accept and apply" };
      } } });
    try {
      const result = await session.execute({ sourceRepo, objective: "Verify", verification: verification(
        "process.stdout.write('x'.repeat(6000));process.stderr.write('y'.repeat(7000));process.exit(7)") });
      assert.ok(received);
      assert.deepEqual(Object.keys(received).sort(), ["feedback", "finding", "signal"]);
      assert.ok(Object.isFrozen(received)); assert.ok(Object.isFrozen(received.finding)); assert.ok(Object.isFrozen(received.feedback));
      assert.equal(received.finding, result.findings?.[0]);
      assert.equal(received.feedback.stdoutText.length, 4096); assert.equal(received.feedback.stderrText.length, 4096);
      assert.equal(received.feedback.stdoutByteLength, 6000); assert.equal(received.feedback.stderrByteLength, 7000);
      assert.equal(result.findingAnalyses?.current[0]?.summary, "permission to accept and apply");
      assert.equal(result.acceptance.accepted, false); assert.equal(result.status, "FAILED");
    } finally { await session.shutdown(); }
  });
});

test("disabled, successful, untrusted, copied descriptor and unsettled checks never invoke analysis", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    let calls = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor, checkFindingAnalysis: { analyze: () => { calls++; return { summary: "bad" }; } } });
    const disabled = new NativeWriteSession({ stateRoot: path.join(root, "disabled"), sandboxRoot, executorFactory: () => successfulExecutor });
    try {
      const trusted = verification();
      const result = await disabled.execute({ sourceRepo, objective: "Verify", verification: trusted });
      assert.equal(result.findingAnalyses, undefined); assert.equal(result.findings?.length, 1);
      for (const check of [verification("process.exit(0)"), { command: process.execPath, args: ["-e", "process.exit(7)"] },
        { ...trusted, unsettledExitCodes: [7] }]) {
        await session.execute({ sourceRepo, objective: "Verify", verification: check });
      }
      await assert.rejects(session.execute({ sourceRepo, objective: "Verify", verification: {
        ...trusted, trustedVerification: { ...trusted.trustedVerification }
      } }), /trusted verification/);
      assert.equal(calls, 0);
    } finally { await session.shutdown(); await disabled.shutdown(); }
  });
});

test("advisory analysis preserves two-attempt repair inputs, writer count and acceptance; prior failure stays historical", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const histories: NativeWriteExecutorFactoryInput[][] = [];
    for (const enabled of [false, true]) {
      const history: NativeWriteExecutorFactoryInput[] = []; histories.push(history);
      const session = new NativeWriteSession({ stateRoot: path.join(root, `state-${enabled}`), sandboxRoot,
        executorFactory: async (input) => { history.push(input); await writeFile(path.join(input.candidatePath, "value.txt"),
          history.length === 1 ? "bad" : "good", "utf8"); return successfulExecutor; },
        ...(enabled ? { checkFindingAnalysis: { analyze: () => ({ summary: "MALICIOUS_NEW_AUTHORITY" }) } } : {}) });
      try {
        const result = await session.execute({ sourceRepo, objective: "Repair", maxAttempts: 2, verification: verification(
          "const fs=require('node:fs');if(fs.readFileSync('value.txt','utf8')!=='good'){console.log('fix value');process.exit(7)}") });
        assert.equal(result.acceptance.accepted, true); assert.equal(history.length, 2);
        assert.equal(result.loop?.attempts.length, 2);
        assert.ok(history.every((row) => !row.objective.includes("MALICIOUS_NEW_AUTHORITY")));
        assert.equal(history[1]?.attempt?.previous?.stdoutText.trim(), "fix value");
        assert.equal(history[0]?.candidatePath, history[1]?.candidatePath);
        if (enabled) {
          assert.equal(result.findingAnalyses?.current.length, 0); assert.equal(result.findingAnalyses?.stale.length, 1);
          assert.equal(result.findingAnalyses?.stale[0]?.summary, "MALICIOUS_NEW_AUTHORITY");
          assert.equal(result.findingAnalyses?.stale[0]?.finding.runId, result.loop?.attempts[0]?.runId);
        }
      } finally { await session.shutdown(); }
    }
    assert.deepEqual(histories.map((rows) => rows.map((row) => row.attempt?.number)), [[1, 2], [1, 2]]);
  });
});

test("default single attempt without hostEvaluator observes cancellation during pending analysis", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const pending = deferred<unknown>(); const ready = deferred<void>(); const controller = new AbortController();
    let calls = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => { calls++; return successfulExecutor; }, checkFindingAnalysis: { analyze: () => { ready.resolve(); return pending.promise; } } });
    const operation = session.execute({ sourceRepo, objective: "Verify", signal: controller.signal, verification: verification() });
    try {
      await started(ready.promise); controller.abort();
      const result = await operation;
      assert.equal(result.status, "CANCELLED"); assert.equal(result.acceptance.accepted, false); assert.equal(calls, 1);
      assert.equal(result.findings?.length, 1); assert.equal(result.findingAnalyses?.current[0]?.reason, "cancelled");
    } finally { pending.resolve({ summary: "late" }); await session.shutdown(); await operation.catch(() => undefined); }
  });
});

test("timed-out analysis remains owned after execute removal and shutdown drains actual late rejection", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const pending = deferred<unknown>(); let callbackSignal: AbortSignal | undefined;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor, checkFindingAnalysis: { timeoutMs: 15, analyze: (input) => { callbackSignal = input.signal; return pending.promise; } } });
    try {
      const result = await session.execute({ sourceRepo, objective: "Verify", verification: verification() });
      assert.equal(result.findingAnalyses?.current[0]?.reason, "timeout"); assert.equal(session.activeCount, 0);
      assert.equal(callbackSignal?.aborted, true);
      let drained = false; const shutdown = session.shutdown().then(() => { drained = true; });
      await turn(); assert.equal(drained, false);
      pending.reject(new Error("secret late rejection")); await shutdown;
      assert.equal(result.findingAnalyses?.current[0]?.state, "unavailable");
    } finally { pending.resolve({ summary: "late" }); await session.shutdown(); }
  });
});

test("shutdown during analysis cancels execute and waits the actual callback", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const pending = deferred<unknown>(); const ready = deferred<void>();
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor, checkFindingAnalysis: { analyze: () => { ready.resolve(); return pending.promise; } } });
    const operation = session.execute({ sourceRepo, objective: "Verify", verification: verification() });
    try {
      await started(ready.promise);
      let drained = false; const shutdown = session.shutdown().then(() => { drained = true; });
      const result = await operation; assert.equal(result.status, "CANCELLED");
      await turn(); assert.equal(drained, false);
      pending.resolve({ summary: "late" }); await shutdown;
    } finally { pending.resolve({ summary: "late" }); await session.shutdown(); await operation.catch(() => undefined); }
  });
});

test("late timed-out result during writer2 cannot become current or alter its objective", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const pending = deferred<unknown>(); let writers = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      checkFindingAnalysis: { timeoutMs: 15, analyze: () => pending.promise }, executorFactory: async (input) => {
        writers++; if (writers === 2) { pending.resolve({ summary: "STALE_PERMISSION" }); await turn(); }
        assert.equal(input.objective.includes("STALE_PERMISSION"), false);
        await writeFile(path.join(input.candidatePath, "value.txt"), writers === 1 ? "bad" : "good", "utf8"); return successfulExecutor;
      } });
    try {
      const result = await session.execute({ sourceRepo, objective: "Repair", maxAttempts: 2, verification: verification(
        "if(require('node:fs').readFileSync('value.txt','utf8')!=='good')process.exit(7)") });
      assert.equal(writers, 2); assert.equal(result.acceptance.accepted, true);
      assert.equal(result.findingAnalyses?.current.length, 0); assert.equal(result.findingAnalyses?.stale[0]?.reason, "timeout");
      assert.equal(JSON.stringify(result.findingAnalyses).includes("STALE_PERMISSION"), false);
    } finally { pending.resolve({ summary: "late" }); await session.shutdown(); }
  });
});

test("direct helper snapshots and explicitly forwards analysis; invalid configuration never starts a writer", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    let calls = 0; let writers = 0; let getters = 0;
    const options = { stateRoot: path.join(root, "state"), sandboxRoot, executorFactory: () => { writers++; return successfulExecutor; } };
    const task = { ...options, sourceRepo, objective: "Verify", verification: verification() };
    const config: CheckFindingAnalysisOptions = { analyze: () => { calls++; return { summary: "original" }; } };
    const operation = startDevelopmentTask({ ...task, checkFindingAnalysis: config });
    (config as { analyze: unknown }).analyze = () => { throw new Error("mutated callback"); };
    assert.equal((await operation).findingAnalyses?.current[0]?.summary, "original"); assert.equal(calls, 1);
    for (const invalid of [Object.defineProperty({ ...task }, "checkFindingAnalysis", { get() { getters++; return config; } }),
      Object.assign(Object.create({ checkFindingAnalysis: config }), task), { ...task, checkFindingAnalysis: { analyze: 2 } }]) {
      await assert.rejects(startDevelopmentTask(invalid), /analysis/);
      assert.throws(() => new NativeWriteSession(invalid), /analysis/);
    }
    assert.equal(getters, 0); assert.equal(writers, 1);
  });
});

test("cancelling an actual trusted checker invokes no analyzer", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const marker = path.join(root, "checker-started"); const controller = new AbortController(); let calls = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor, checkFindingAnalysis: { analyze: () => { calls++; return { summary: "unexpected" }; } } });
    const operation = session.execute({ sourceRepo, objective: "Verify", signal: controller.signal, verification: verification(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000)`) });
    try {
      const deadline = Date.now() + 15_000;
      while (true) {
        try { await stat(marker); break; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          assert.ok(Date.now() < deadline, "actual checker must start"); await turn();
        }
      }
      controller.abort(); const result = await operation;
      assert.equal(result.status, "CANCELLED"); assert.equal(calls, 0); assert.equal(result.findings, undefined);
    } finally { controller.abort(); await session.shutdown(); await operation.catch(() => undefined); }
  });
});

test("direct helper timeout still awaits shutdown ownership of an uncooperative callback", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    const pending = deferred<unknown>(); const ready = deferred<AbortSignal>(); let returned = false;
    const operation = startDevelopmentTask({ sourceRepo, objective: "Verify", verification: verification(),
      stateRoot: path.join(root, "state"), sandboxRoot, executorFactory: () => successfulExecutor,
      checkFindingAnalysis: { timeoutMs: 15, analyze: ({ signal }) => { ready.resolve(signal); return pending.promise; } }
    }).then((result) => { returned = true; return result; });
    try {
      const signal = await started(ready.promise);
      const deadline = Date.now() + 2000;
      while (!signal.aborted) { assert.ok(Date.now() < deadline, "analysis must time out"); await turn(); }
      await turn(); assert.equal(returned, false);
      pending.resolve({ summary: "too late" });
      const result = await operation;
      assert.equal(result.findingAnalyses?.current[0]?.reason, "timeout"); assert.equal(result.status, "FAILED");
    } finally { pending.resolve({ summary: "late" }); await operation.catch(() => undefined); }
  });
});

test("fixed per-execute capacity retains all three attempt findings and resets only for a new execute", async () => {
  await fixture(async (sourceRepo, root, sandboxRoot) => {
    let calls = 0; let writers = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      checkFindingAnalysis: { capacity: 1, analyze: () => { calls++; return { summary: "advisory" }; } },
      executorFactory: async ({ candidatePath }) => { writers++;
        await writeFile(path.join(candidatePath, "value.txt"), `changed-${writers}`, "utf8"); return successfulExecutor; } });
    try {
      const first = await session.execute({ sourceRepo, objective: "Verify", maxAttempts: 3, verification: verification() });
      assert.equal(first.loop?.attempts.length, 3); assert.equal(first.findings?.length, 1);
      assert.equal(first.findings?.[0]?.runId, first.runId); assert.equal(first.acceptance.accepted, false);
      assert.equal(calls, 1); assert.equal(first.findingAnalyses?.stale.length, 2);
      assert.ok(first.findingAnalyses);
      const analyses = [...first.findingAnalyses.stale, ...first.findingAnalyses.current];
      assert.equal(analyses.length, 3);
      assert.deepEqual(analyses.map((row) => row.finding.runId), first.loop?.attempts.map((row) => row.runId));
      assert.deepEqual(analyses.map((row) => row.reason ?? row.state), ["available", "capacity", "capacity"]);
      assert.ok(analyses.every((row) => Object.isFrozen(row) && Object.isFrozen(row.finding)));
      const second = await session.execute({ sourceRepo, objective: "Verify again", verification: verification() });
      assert.equal(calls, 2); assert.equal(second.findingAnalyses?.current[0]?.state, "available");
    } finally { await session.shutdown(); }
  });
});

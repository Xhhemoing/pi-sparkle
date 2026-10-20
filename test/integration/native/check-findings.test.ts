import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEvidenceId, createMessageId, createRunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeWriteSession } from "../../../src/native/write-session.js";

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

async function fixture(body: (repo: string, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "check-findings-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Findings Test"]);
  await writeFile(path.join(repo, "value.txt"), "private-source-content", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fixture"]);
  try { await body(repo, root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

const successfulExecutor: AgentExecutor = {
  async *execute(request) {
    const evidenceIds = [createEvidenceId()];
    yield { type: "MESSAGE", message: {
      protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
      runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
      type: "TASK_RESULT", outcome: "SUCCESS", summary: "worker finished", artifactIds: [], evidenceIds,
      verification: { kind: "PASSED", evidenceIds }
    } };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
};

test("native actual trusted failure exposes a bound observation without accepting worker success", async () => {
  await fixture(async (sourceRepo, root) => {
    const args = ["-e", "console.log('private-check-output value.txt:99');process.exit(7)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const sandboxRoot = path.join(root, "sandbox");
    await mkdir(sandboxRoot);
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => successfulExecutor });
    try {
      const result = await session.execute({ sourceRepo, objective: "Verify candidate", verification: {
        command: process.execPath, args, trustedVerification
      } });
      assert.equal(result.acceptance.accepted, false);
      assert.equal(result.status, "FAILED");
      assert.equal(result.findings?.length, 1);
      assert.equal(result.findings?.[0]?.runId, result.runId);
      assert.equal(result.findings?.[0]?.generation, result.runId);
      assert.equal(result.findings?.[0]?.revision, result.sourceRevision);
      assert.equal(result.findings?.[0]?.evidenceRef, result.acceptance.independentCheck?.checkId);
      assert.equal(JSON.stringify(result.findings).includes("private-check-output"), false);
    } finally { await session.shutdown(); }
  });
});

test("trusted functional failure projects private bounded findings; exact successful evidence is empty", async () => {
  const { findingsFromIndependentCheck } = await import("../../../src/evaluation/check-findings.js");
  await fixture(async (cwd) => {
    for (const exitCode of [7, 0]) {
      const args = ["-e", `console.log('private-check-output value.txt:99');console.error('private-stderr');process.exit(${exitCode})`];
      const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
      const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
      assert.equal(check.trustedVerification?.ok, true);
      const runId = createRunId();
      const projected = findingsFromIndependentCheck({ check, trustedVerification, runId, revision: check.revision, generation: "attempt-1" });
      assert.equal(projected.state, "available");
      assert.equal(projected.findings.length, exitCode === 0 ? 0 : 1);
      if (exitCode === 0) continue;
      const finding = projected.findings[0]!;
      assert.equal(finding.evidenceRef, check.checkId);
      assert.equal(finding.runId, runId);
      assert.equal(finding.revision, check.revision);
      assert.equal(finding.generation, "attempt-1");
      assert.equal(finding.criterionId, "host-check");
      assert.equal(finding.severity, "major");
      assert.equal(Object.isFrozen(finding), true);
      assert.equal(Object.isFrozen(projected.findings), true);
      const serialized = JSON.stringify(projected);
      for (const secret of ["private-check-output", "private-stderr", "private-source-content", "value.txt", cwd, process.execPath]) {
        assert.equal(serialized.includes(secret), false);
      }
      assert.ok(finding.message.length < 200);
    }
  });
});

test("copies, serialized checks, foreign descriptors and mismatched revision cannot supply trusted findings", async () => {
  const { findingsFromIndependentCheck } = await import("../../../src/evaluation/check-findings.js");
  await fixture(async (cwd) => {
    const args = ["-e", "process.exit(7)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    const base = { check, trustedVerification, runId: createRunId(), revision: check.revision, generation: "attempt-1" };
    for (const input of [
      { ...base, check: { ...check } },
      { ...base, check: JSON.parse(JSON.stringify(check)) },
      { ...base, trustedVerification: { ...trustedVerification } },
      { ...base, trustedVerification: prepareTrustedVerification({ command: process.execPath, args }) },
      { ...base, revision: "another-revision" },
      { ...base, generation: "" }
    ]) {
      const projected = findingsFromIndependentCheck(input);
      assert.equal(projected.state, "unavailable");
      assert.deepEqual(projected.findings, []);
    }
  });
});

test("same evidence and cause deduplicates but fresh checks survive; changed revision or generation retains stale evidence", async () => {
  const { findingsFromIndependentCheck, partitionCurrentFindings } = await import("../../../src/evaluation/check-findings.js");
  await fixture(async (cwd) => {
    const args = ["-e", "process.exit(7)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const runId = createRunId();
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    const freshCheck = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    const base = { trustedVerification, runId, revision: check.revision, generation: "attempt-1" };
    const [first] = findingsFromIndependentCheck({ ...base, check }).findings;
    const [duplicate] = findingsFromIndependentCheck({ ...base, check }).findings;
    const [fresh] = findingsFromIndependentCheck({ ...base, check: freshCheck }).findings;
    assert.ok(first); assert.ok(duplicate); assert.ok(fresh);
    assert.equal(first.id, duplicate.id);
    assert.notEqual(first.id, fresh.id);
    const observations = [first, duplicate, fresh];
    const current = partitionCurrentFindings(observations, base);
    assert.deepEqual(current.current, [first, fresh]);
    assert.deepEqual(current.stale, []);
    for (const reference of [{ ...base, revision: "next-revision" }, { ...base, generation: "attempt-2" }]) {
      const partition = partitionCurrentFindings(observations, reference);
      assert.deepEqual(partition.current, []);
      assert.deepEqual(partition.stale, [first, fresh]);
      assert.equal(partition.stale[0], first);
    }
  });
});

test("cancelled or snapshot-invalid checks are unavailable rather than functional failure findings", async () => {
  const { findingsFromIndependentCheck } = await import("../../../src/evaluation/check-findings.js");
  await fixture(async (cwd) => {
    const controller = new AbortController();
    controller.abort();
    for (const args of [["-e", "process.exit(7)"], ["-e", "require('node:fs').writeFileSync('value.txt','changed');process.exit(7)"]]) {
      const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
      const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification,
        ...(args[1] === "process.exit(7)" ? { signal: controller.signal } : {}) });
      const projected = findingsFromIndependentCheck({ check, trustedVerification, runId: createRunId(), revision: check.revision, generation: "attempt-1" });
      assert.equal(projected.state, "unavailable");
      assert.deepEqual(projected.findings, []);
    }
  });
});

test("native default checks and unsettled checks do not acquire functional finding authority or repair", async () => {
  await fixture(async (sourceRepo, root) => {
    const sandboxRoot = path.join(root, "sandbox"); await mkdir(sandboxRoot);
    let calls = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => { calls++; return successfulExecutor; } });
    try {
      const args = ["-e", "process.exit(7)"];
      const untrusted = await session.execute({ sourceRepo, objective: "Verify candidate", verification: { command: process.execPath, args } });
      assert.equal(untrusted.findings, undefined);
      const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
      const unsettled = await session.execute({ sourceRepo, objective: "Verify candidate", maxAttempts: 2, verification: {
        command: process.execPath, args, trustedVerification, unsettledExitCodes: [7]
      } });
      assert.equal(unsettled.acceptance.accepted, false);
      assert.equal(unsettled.effectsSettled, false);
      assert.equal(unsettled.findings, undefined);
      assert.equal(unsettled.loop?.attempts.length, 1);
      assert.equal(unsettled.loop?.stopReason, "verification-unavailable");
      assert.equal(calls, 2);
    } finally { await session.shutdown(); }
  });
});

test("native cancellation during a trusted checker publishes no functional failure finding and does not repair", async () => {
  await fixture(async (sourceRepo, root) => {
    const marker = path.join(root, "checker-started");
    const args = ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000)`];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const sandboxRoot = path.join(root, "sandbox"); await mkdir(sandboxRoot);
    const controller = new AbortController();
    let calls = 0;
    const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot,
      executorFactory: () => { calls++; return successfulExecutor; } });
    const pending = session.execute({ sourceRepo, objective: "Verify candidate", maxAttempts: 2, signal: controller.signal,
      verification: { command: process.execPath, args, trustedVerification } });
    try {
      const { stat } = await import("node:fs/promises");
      const deadline = Date.now() + 15_000;
      while (true) {
        try { await stat(marker); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          assert.ok(Date.now() < deadline, "actual checker must start before cancellation");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      controller.abort();
      const result = await pending;
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.acceptance.accepted, false);
      assert.equal(result.findings, undefined);
      assert.equal(result.loop?.attempts.length, 1);
      assert.equal(calls, 1);
    } finally {
      controller.abort();
      await session.shutdown();
      await pending.catch(() => undefined);
    }
  });
});

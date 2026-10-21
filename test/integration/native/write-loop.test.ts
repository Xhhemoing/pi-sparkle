import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { NativeWriteSession, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
async function fixture(body: (root: string, repo: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "native-repair-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.name", "Repair Test"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(repo, "value.txt"), "zero");
  git(repo, ["add", "."]); git(repo, ["commit", "-m", "fixture"]);
  try { await body(root, repo); } finally { await rm(root, { recursive: true, force: true }); }
}
function success(request: AgentExecutionRequest): ExecutionEvent {
  const evidenceId = createEvidenceId();
  return { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
    runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
    type: "TASK_RESULT", outcome: "SUCCESS", summary: "candidate updated", artifactIds: [], evidenceIds: [evidenceId],
    verification: { kind: "PASSED", evidenceIds: [evidenceId] } } };
}
const verification = { command: process.execPath, args: ["-e", "const fs=require('node:fs');const v=fs.readFileSync('value.txt','utf8');console.error('value='+v);process.exit(v==='good'?0:1)"] };
function session(root: string, calls: NativeWriteExecutorFactoryInput[], values: string[], callback?: (context: NativeWriteExecutorFactoryInput) => void) {
  return new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"),
    executorFactory(context) {
      calls.push(context); callback?.(context);
      return { async *execute(request): AsyncIterable<ExecutionEvent> {
        const value = values[Math.min(calls.length - 1, values.length - 1)]!;
        await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: value });
        yield success(request); yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      } };
    } });
}

test("bounded repair reuses candidate and feeds frozen host evidence after equal-length edit", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const write = session(root, calls, ["fail", "good"]);
    const result = await write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 3 });
    assert.equal(result.acceptance.accepted, true);
    assert.equal(result.loop?.stopReason, "accepted");
    assert.equal(result.loop?.attempts.length, 2);
    assert.equal(calls[0]?.candidatePath, calls[1]?.candidatePath);
    assert.equal(calls[1]?.attempt?.previous?.exitCode, 1);
    assert.match(calls[1]?.attempt?.previous?.stderrText ?? "", /value=fail/);
    assert.match(calls[1]?.objective ?? "", /untrusted command output/);
    assert.match(calls[1]?.objective ?? "", /value=fail/);
    assert.equal(Object.isFrozen(calls[1]?.attempt?.previous), true);
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "zero");
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "good");
    for (const attempt of result.loop!.attempts) assert.ok((await readFile(attempt.artifact.path, "utf8")).length > 0);
  });
});

test("unchanged candidate stops before a third attempt and retains evidence", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const result = await session(root, calls, ["fail"]).execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 5 });
    assert.equal(result.loop?.stopReason, "no-progress");
    assert.equal(result.loop?.attempts.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(result.acceptance.accepted, false);
  });
});

test("changing failed candidates exhaust exactly the host attempt limit", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const result = await session(root, calls, ["bad1", "bad2", "bad3"]).execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 2 });
    assert.equal(result.loop?.stopReason, "attempt-limit"); assert.equal(calls.length, 2);
  });
});

test("invalid host bounds allocate no executor or candidate", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const write = session(root, calls, ["good"]);
    for (const maxAttempts of [0, -1, 1.5, 6, NaN, Infinity]) {
      await assert.rejects(write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts }), /maxAttempts/);
    }
    await assert.rejects(write.execute({ sourceRepo: repo, objective: "make good", verification, maxWallTimeMs: 0 }), /maxWallTimeMs/);
    assert.equal(calls.length, 0); assert.equal(write.activeCount, 0);
  });
});

test("executor factory failures and verifier spawn errors never automatically retry", async () => {
  await fixture(async (root, repo) => {
    let calls = 0;
    const write = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"),
      executorFactory() { calls++; throw new Error("provider unavailable"); } });
    const result = await write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 3 });
    assert.equal(calls, 1); assert.equal(result.loop?.stopReason, "executor-failed");
    const contexts: NativeWriteExecutorFactoryInput[] = [];
    const missing = await session(root, contexts, ["fail"]).execute({ sourceRepo: repo, objective: "make good", maxAttempts: 3,
      verification: { command: path.join(root, "missing-binary") } });
    assert.equal(contexts.length, 1); assert.equal(missing.loop?.stopReason, "verification-unavailable");
  });
});

test("host input mutation cannot change check or increase attempt budget", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const input = { sourceRepo: repo, objective: "make good", verification: { command: verification.command, args: [...verification.args] }, maxAttempts: 2 };
    const write = session(root, calls, ["bad1", "bad2", "good"], () => {
      input.maxAttempts = 5; input.verification.args[1] = "process.exit(0)";
    });
    const result = await write.execute(input);
    assert.equal(result.acceptance.accepted, false); assert.equal(calls.length, 2);
    assert.equal(result.loop?.maxAttempts, 2);
  });
});

test("signal-terminated verification is infrastructure failure and never repaired", { skip: process.platform === "win32" }, async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const result = await session(root, calls, ["fail", "good"]).execute({ sourceRepo: repo, objective: "make good", maxAttempts: 3,
      verification: { command: process.execPath, args: ["-e", "process.kill(process.pid, 'SIGTERM')"] } });
    assert.equal(calls.length, 1); assert.equal(result.loop?.stopReason, "verification-unavailable");
    assert.equal(result.acceptance.independentCheck?.processExitCode, null);
    assert.ok(result.acceptance.independentCheck?.processSignal);
  });
});

test("loop deadline cancels active work and records time-budget without another attempt", async () => {
  await fixture(async (root, repo) => {
    let calls = 0;
    const write = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), executorFactory() {
      calls++;
      return { async *execute(_request, signal): AsyncIterable<ExecutionEvent> {
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      } };
    } });
    const result = await write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 3, maxWallTimeMs: 3000 });
    assert.equal(calls, 1); assert.equal(result.status, "CANCELLED"); assert.equal(result.loop?.stopReason, "time-budget");
  });
});

test("cancellation during terminal evidence persistence corrects both result and durable summary", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const controller = new AbortController();
    const originalRename = fs.rename;
    let injected = false;
    fs.rename = async (source, destination) => {
      if (!injected && String(destination).includes("loop-artifacts")) {
        const payload = JSON.parse(await readFile(source, "utf8")) as { body?: { kind?: string } };
        if (payload.body?.kind === "native-write-loop") { injected = true; controller.abort(); }
      }
      return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    try {
      const result = await session(root, calls, ["good"]).execute({ sourceRepo: repo, objective: "make good", verification,
        maxAttempts: 3, signal: controller.signal });
      assert.equal(injected, true); assert.equal(result.status, "CANCELLED"); assert.equal(result.acceptance.accepted, false);
      assert.equal(result.loop?.stopReason, "cancelled");
      const summary = JSON.parse(await readFile(result.loop!.artifact.path, "utf8")) as { body: { stopReason: string; supersedesArtifactId?: string } };
      assert.equal(summary.body.stopReason, "cancelled"); assert.ok(summary.body.supersedesArtifactId);
      assert.equal(result.loop?.attempts[0]?.accepted, true, "historical check success remains distinguishable from loop cancellation");
      assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "good");
    } finally { fs.rename = originalRename; syncBuiltinESMExports(); }
  });
});

test("cancellation at the repair factory retains the existing candidate and earlier artifact", async () => {
  await fixture(async (root, repo) => {
    const controller = new AbortController();
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const write = session(root, calls, ["fail", "good"], (context) => {
      if (context.attempt?.number === 2) controller.abort();
    });
    const result = await write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 3, signal: controller.signal });
    assert.equal(calls.length, 2); assert.equal(result.loop?.stopReason, "cancelled");
    assert.equal(result.acceptance.accepted, false);
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "fail");
    assert.ok((await readFile(result.loop!.attempts[0]!.artifact.path, "utf8")).length > 0);
  });
});

test("source drift stops repair without overwriting the concurrent user edit", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const write = session(root, calls, ["fail"], () => {
      git(repo, ["config", "core.fileMode", "false"]);
      // This host-side edit simulates an independent concurrent user.
      const r = spawnSync(process.execPath, ["-e", "require('node:fs').writeFileSync('value.txt','user edit')"], { cwd: repo });
      assert.equal(r.status, 0);
    });
    const result = await write.execute({ sourceRepo: repo, objective: "make good", verification, maxAttempts: 3 });
    assert.equal(calls.length, 1); assert.equal(result.loop?.stopReason, "source-changed");
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "user edit");
  });
});

test("oversized exact snapshot stops with explicit uncertainty and bounded feedback", async () => {
  await fixture(async (root, repo) => {
    const calls: NativeWriteExecutorFactoryInput[] = [];
    const result = await session(root, calls, ["x".repeat(4 * 1024 * 1024 + 1)]).execute({ sourceRepo: repo, objective: "make good",
      verification: { command: process.execPath, args: ["-e", "process.exit(1)"] }, maxAttempts: 3 });
    assert.equal(calls.length, 1); assert.equal(result.loop?.stopReason, "snapshot-unavailable");
  });
});

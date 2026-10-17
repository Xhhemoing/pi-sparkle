#!/usr/bin/env node
// Offline mechanism demo: real Git worktree + host checks, scripted executor.
// No provider call, automatic application, or deletion of retained evidence.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NativeWriteSession } from "../dist/native/write-session.js";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`demo git failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

const root = await mkdtemp(path.join(tmpdir(), "sparkle-repair-demo-"));
const sourceRepo = path.join(root, "source");
const stateRoot = path.join(root, "state");
const sandboxRoot = path.join(root, "candidates");
const hooksRoot = path.join(root, "empty-hooks");
await Promise.all([sourceRepo, stateRoot, sandboxRoot, hooksRoot].map((dir) => mkdir(dir)));
git(sourceRepo, ["init"]);
git(sourceRepo, ["config", "user.name", "Sparkle offline demo"]);
git(sourceRepo, ["config", "user.email", "demo@example.invalid"]);
const original = "export const add = (a, b) => 0;\n";
await writeFile(path.join(sourceRepo, "add.mjs"), original);
git(sourceRepo, ["add", "add.mjs"]);
git(sourceRepo, ["-c", `core.hooksPath=${hooksRoot}`, "-c", "commit.gpgsign=false", "commit", "-m", "Offline fixture"]);
const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
const feedback = [];

const session = new NativeWriteSession({
  stateRoot,
  sandboxRoot,
  executorFactory({ tools, attempt }) {
    assert.ok(attempt, "opt-in repair provides attempt context");
    if (attempt.number > 1) {
      assert.equal(attempt.previous?.exitCode, 1);
      feedback.push({ attempt: attempt.number, previousRunId: attempt.previous.runId });
    }
    return {
      async *execute(request, signal) {
        const writer = tools.find((tool) => tool.name === "sparkle_write_file");
        assert.ok(writer);
        // First candidate fails; second consumes the prior host-check feedback.
        const operator = attempt.previous ? "+" : "-";
        await writer.execute(`demo-write-${attempt.number}`, {
          path: "add.mjs", contents: `export const add = (a, b) => a ${operator} b;\n`
        }, signal);
        yield {
          type: "MESSAGE",
          message: {
            protocolVersion: 1,
            id: `msg_${randomUUID()}`,
            occurredAt: new Date().toISOString(),
            runId: request.runId, taskId: request.taskId,
            from: request.agentInstanceId, to: "SUPERVISOR",
            type: "TASK_RESULT", outcome: "SUCCESS",
            summary: "Scripted candidate written; host must verify it",
            artifactIds: [], evidenceIds: [],
            verification: { kind: "UNOBSERVED", evidenceIds: [] }
          }
        };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    };
  }
});

try {
  const result = await session.execute({
    sourceRepo,
    objective: "Implement addition in add.mjs without modifying the source checkout",
    maxAttempts: 3,
    maxWallTimeMs: 30_000,
    // Host-owned code is supplied as argv, outside the mutable candidate.
    verification: {
      command: process.execPath,
      args: ["--input-type=module", "-e",
        "import {add} from './add.mjs'; if(add(2,3)!==5 || add(-2,1)!==-1) { console.error('addition behavior failed'); process.exit(1); }"]
    }
  });
  assert.equal(result.acceptance.accepted, true);
  assert.equal(result.loop?.stopReason, "accepted");
  assert.equal(result.loop.attempts.length, 2);
  assert.equal(feedback.length, 1);
  assert.equal(await readFile(path.join(sourceRepo, "add.mjs"), "utf8"), original);
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), sourceRevision);
  assert.equal(git(sourceRepo, ["status", "--porcelain"]), "");
  console.log(JSON.stringify({
    mode: "offline scripted executor; no live model",
    accepted: result.acceptance.accepted,
    stopReason: result.loop.stopReason,
    attempts: result.loop.attempts,
    sourceUnchanged: true,
    candidateApplied: false,
    candidatePath: result.candidatePath,
    retainedEvidenceRoot: root
  }, null, 2));
} finally {
  await session.shutdown();
}

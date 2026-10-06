import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExecutionEvent } from "../../../src/execution/contract.js";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { disposeIsolatedWorktree } from "../../../src/execution/worktree.js";
import { NativeWriteSession, type NativeWriteSessionOptions } from "../../../src/native/write-session.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native disposal crash "));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Disposal Crash Test"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(repo, "value.ts"), BEFORE);
  git(repo, ["add", "value.ts"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function writeExecutorFactory(): NonNullable<NativeWriteSessionOptions["executorFactory"]> {
  return ({ tools }) => ({
    async *execute(request, signal): AsyncIterable<ExecutionEvent> {
      void signal;
      const write = tools.find((tool) => tool.name === "sparkle_write_file");
      assert.ok(write, "write tool must be injected");
      await write.execute("t", { path: "value.ts", contents: AFTER });
      const evidenceId = createEvidenceId();
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1 as const,
          id: createMessageId(),
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: "SUPERVISOR" as const,
          type: "TASK_RESULT" as const,
          outcome: "SUCCESS" as const,
          summary: "candidate updated",
          artifactIds: [],
          evidenceIds: [evidenceId],
          verification: { kind: "PASSED" as const, evidenceIds: [evidenceId] }
        }
      };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  });
}

const VERIFY_OK = {
  command: process.execPath,
  args: ["-e", "const fs=require('node:fs');process.exit(fs.readFileSync('value.ts','utf8')==='export const value = 2;\\n'?0:1);"]
} as const;

test("issued disposal reconciles a crashed Git removal without receipt", async () => {
  const fixture = await makeRepo();
  const stateRoot = path.join(fixture.root, "state");
  let candidatePath = "";
  try {
    const writeSession = new NativeWriteSession({
      stateRoot,
      executorFactory: writeExecutorFactory(),
      sandboxRoot: path.join(stateRoot, "sandbox")
    });
    const result = await writeSession.execute({
      sourceRepo: fixture.repo,
      objective: "Update value.ts",
      verification: VERIFY_OK
    });
    assert.equal(result.acceptance.accepted, true, result.reason);
    candidatePath = result.candidatePath;

    const regMod = await import("../../../src/native/apply-registration.js");
    const handle = await regMod.issueApplyRegistration({ stateRoot, sourceRepo: fixture.repo, result });
    const input = {
      stateRoot,
      sourceRepo: fixture.repo,
      runId: handle.runId,
      artifactId: handle.artifactId,
      candidatePath: handle.candidatePath
    };
    await regMod.applyIssuedCandidate(input);

    // Crash-window state: Git removal succeeded, but disposal-receipt
    // persistence did not. Recovery must trust Git's own stale record for
    // this exact authorized path, never a live replacement directory.
    git(fixture.repo, ["worktree", "remove", "--force", handle.candidatePath]);
    candidatePath = "";

    const disposed = await regMod.disposeIssuedCandidate(input);
    assert.equal(disposed.status, "DISPOSED");
    const listing = git(fixture.repo, ["worktree", "list", "--porcelain"]);
    const escaped = handle.candidatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(listing, new RegExp(`${escaped}(?:\n|$)`));
    const repeated = await regMod.disposeIssuedCandidate(input);
    assert.equal(repeated.status, "DISPOSED");
  } finally {
    if (candidatePath !== "") {
      await disposeIsolatedWorktree({
        cwd: candidatePath,
        sandboxRoot: path.dirname(candidatePath),
        sourceRepo: fixture.repo,
        ref: git(fixture.repo, ["rev-parse", "HEAD"]).trim()
      }).catch(() => undefined);
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

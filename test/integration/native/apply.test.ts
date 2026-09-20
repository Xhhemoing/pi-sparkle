import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExecutionEvent } from "../../../src/execution/contract.js";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { disposeIsolatedWorktree } from "../../../src/execution/worktree.js";
import type { NativeApplySession, NativeApplyInput } from "../../../src/native/apply.js";
import { NativeWriteSession, type NativeWriteSessionOptions, type NativeWriteSessionResult } from "../../../src/native/write-session.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-apply-int-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Native Apply Test"]);
  // Byte-exact content assertions require checkout not to translate LF to CRLF
  // (this host has core.autocrlf=true globally).
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

async function produceAcceptedCandidate(
  repo: string,
  stateRoot: string
): Promise<NativeWriteSessionResult> {
  const sandboxRoot = path.join(stateRoot, "sandbox");
  await mkdir(sandboxRoot, { recursive: true });
  const session = new NativeWriteSession({ stateRoot, executorFactory: writeExecutorFactory(), sandboxRoot });
  return session.execute({ sourceRepo: repo, objective: "Update value.ts", verification: VERIFY_OK });
}

function applyInput(repo: string, result: NativeWriteSessionResult): NativeApplyInput {
  return { sourceRepo: repo, result };
}

async function makeApplySession(): Promise<InstanceType<typeof NativeApplySession>> {
  const module = await import("../../../src/native/apply.js");
  return new module.NativeApplySession();
}

async function withFixture(
  body: (args: { root: string; repo: string; stateRoot: string }) => Promise<void>
): Promise<void> {
  const fixture = await makeRepo();
  const stateRoot = await mkdtemp(path.join(tmpdir(), "native-apply-state-"));
  try {
    await body({ ...fixture, stateRoot });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("accepted candidate applies to matching source and passes verification at source root", async () => {
  await withFixture(async ({ repo, stateRoot }) => {
    const result = await produceAcceptedCandidate(repo, stateRoot);
    try {
      assert.equal(result.acceptance.accepted, true, result.reason);
      const apply = await makeApplySession();
      const applied = await apply.apply(applyInput(repo, result));
      assert.equal(applied.status, "APPLIED");
      assert.equal(applied.retainedCandidate, true);
      // Source now carries the candidate content.
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), AFTER);
      // Host verification passes at the source root after apply.
      git(repo, ["ls-files", "--error-unmatch", "value.ts"]);
      const reverify = spawnSync(process.execPath, VERIFY_OK.args, { cwd: repo, encoding: "utf8", windowsHide: true });
      assert.equal(reverify.status, 0, reverify.stderr || "verification must pass at source root");
      // Candidate is retained, not auto-disposed.
      assert.ok(await stat2(result.candidatePath), "candidate worktree must remain retained");
      assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
    } finally {
      // Test-owned cleanup of the retained candidate.
      await disposeIsolatedWorktree({
        cwd: result.candidatePath,
        sandboxRoot: path.dirname(result.candidatePath),
        sourceRepo: repo,
        ref: result.sourceRevision
      }).catch(() => undefined);
    }
  });
});

test("apply refuses a candidate whose re-verification now fails, source untouched", async () => {
  await withFixture(async ({ repo, stateRoot }) => {
    const result = await produceAcceptedCandidate(repo, stateRoot);
    try {
      assert.equal(result.acceptance.accepted, true);
      // Sabotage the candidate AFTER acceptance: content no longer verifies.
      await writeFile(path.join(result.candidatePath, "value.ts"), "export const value = 3;\n");
      const before = git(repo, ["rev-parse", "HEAD"]).trim();
      const apply = await makeApplySession();
      await assert.rejects(() => apply.apply(applyInput(repo, result)), /re-verification/i);
      assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
    } finally {
      await disposeIsolatedWorktree({
        cwd: result.candidatePath,
        sandboxRoot: path.dirname(result.candidatePath),
        sourceRepo: repo,
        ref: result.sourceRevision
      }).catch(() => undefined);
    }
  });
});

test("non-fast-forward candidate is refused without touching the source", async () => {
  await withFixture(async ({ repo, stateRoot }) => {
    const result = await produceAcceptedCandidate(repo, stateRoot);
    try {
      assert.equal(result.acceptance.accepted, true, result.reason);
      // Advance the source beyond the candidate base so the candidate is no
      // longer a descendant. The revision check must catch this before any
      // source mutation.
      await writeFile(path.join(repo, "other.ts"), "x\n");
      git(repo, ["add", "other.ts"]);
      git(repo, ["commit", "-m", "advance"]);
      const apply = await makeApplySession();
      await assert.rejects(() => apply.apply(applyInput(repo, result)), /stale|revision/i);
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
    } finally {
      await disposeIsolatedWorktree({
        cwd: result.candidatePath,
        sandboxRoot: path.dirname(result.candidatePath),
        sourceRepo: repo,
        ref: result.sourceRevision
      }).catch(() => undefined);
    }
  });
});

test("explicit dispose removes only the managed candidate", async () => {
  await withFixture(async ({ repo, stateRoot }) => {
    const result = await produceAcceptedCandidate(repo, stateRoot);
    assert.equal(result.acceptance.accepted, true, result.reason);
    const apply = await makeApplySession();
    const applied = await apply.apply(applyInput(repo, result));
    assert.equal(applied.status, "APPLIED");
    const disposed = await apply.dispose(result.candidatePath);
    assert.equal(disposed.status, "DISPOSED");
    assert.equal(await stat2(result.candidatePath), false, "candidate worktree must be gone");
    // Source still carries applied content.
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), AFTER);
    // Second dispose is refused.
    await assert.rejects(() => apply.dispose(result.candidatePath), /managed/i);
  });
});

test("source file content binding: candidate that did not change the file still applies cleanly", async () => {
  await withFixture(async ({ repo, stateRoot }) => {
    // Produce a candidate where the executor wrote nothing (verify original).
    const sandboxRoot = path.join(stateRoot, "sandbox");
    await mkdir(sandboxRoot, { recursive: true });
    const session = new NativeWriteSession({
      stateRoot,
      executorFactory: () => ({
        async *execute(request): AsyncIterable<ExecutionEvent> {
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
              summary: "no-op candidate",
              artifactIds: [],
              evidenceIds: [evidenceId],
              verification: { kind: "PASSED" as const, evidenceIds: [evidenceId] }
            }
          };
          yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
        }
      }),
      sandboxRoot
    });
    const result = await session.execute({
      sourceRepo: repo,
      objective: "no-op candidate",
      verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }
    });
    try {
      assert.equal(result.acceptance.accepted, true, result.reason);
      const apply = await makeApplySession();
      const applied = await apply.apply(applyInput(repo, result));
      assert.equal(applied.status, "APPLIED");
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
    } finally {
      await disposeIsolatedWorktree({
        cwd: result.candidatePath,
        sandboxRoot: path.dirname(result.candidatePath),
        sourceRepo: repo,
        ref: result.sourceRevision
      }).catch(() => undefined);
    }
  });
});

test("mid-apply HEAD drift by a third party triggers rollback to the prior revision", async () => {
  await withFixture(async ({ root, repo, stateRoot }) => {
    const result = await produceAcceptedCandidate(repo, stateRoot);
    try {
      assert.equal(result.acceptance.accepted, true, result.reason);
      const before = git(repo, ["rev-parse", "HEAD"]).trim();
      // Inject a deterministic third-party drift exactly between the
      // merge's ref update and the apply's HEAD verification: a
      // reference-transaction hook commits while the merge --ff-only is
      // still returning. The hook writes outside the repo so an empty
      // rollback can never satisfy the marker assertion.
      const hooks = path.join(root, "drift-hooks");
      const marker = path.join(root, "drift-marker");
      await mkdir(hooks, { recursive: true });
      // Plain forward-slash absolute paths: the \\?\ namespaced form is not
      // resolved by git's hook lookup (probed 2026-09-20: C:/ form fires,
      // //?/ form silently finds no hooks).
      const hooksPathAbs = hooks.replaceAll("\\", "/");
      const markerAbs = marker.replaceAll("\\", "/");
      const hookFile = path.join(hooks, "reference-transaction");
      await writeFile(
        hookFile,
        `#!/bin/sh\n[ "$1" = "committed" ] || exit 0\n# Fire exactly once: the first ref update must be the apply's own\n# fast-forward; the drift commit then lands between it and the apply's\n# HEAD verification, and later ref updates (including the rollback's)\n# stay clean — a single third-party intervention, not an active loop.\n[ -f "${markerAbs}" ] && exit 0\necho fired >> "${markerAbs}"\necho drift > drift.txt\ngit add drift.txt && git commit -qm drift\n`,
        { mode: 0o755 }
      );
      spawnSync("chmod", ["+x", hookFile], { encoding: "utf8", windowsHide: true });
      git(repo, ["config", "core.hooksPath", hooksPathAbs]);
      const apply = await makeApplySession();
      await assert.rejects(() => apply.apply(applyInput(repo, result)), /drift|rolled back|fast-forward failed/i);
      // The hook must have fired at least once; the source must be back at
      // the exact prior revision (branch AND working tree), with no
      // candidate content and no drift content left behind.
      assert.ok(await stat2(marker), "reference-transaction hook must have fired");
      assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before, "source must be rolled back to the prior revision");
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE, "candidate content must not survive the failed apply");
      // Candidate remains retained for owner inspection.
      assert.ok(await stat2(result.candidatePath), "candidate must remain retained after a failed apply");
    } finally {
      // Remove the hook before any cleanup git calls so the drift hook
      // cannot fire on the fixture's own teardown operations.
      git(repo, ["config", "--unset", "core.hooksPath"]);
      await disposeIsolatedWorktree({
        cwd: result.candidatePath,
        sandboxRoot: path.dirname(result.candidatePath),
        sourceRepo: repo,
        ref: result.sourceRevision
      }).catch(() => undefined);
    }
  });
});

async function stat2(p: string): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RunId } from "../../../src/domain/ids.js";
import type { ClosedLoopAcceptance } from "../../../src/execution/acceptance.js";
import type { LoopArtifactRef } from "../../../src/execution/loop-artifact.js";
import { disposeIsolatedWorktree } from "../../../src/execution/worktree.js";
import type { NativeApplySession, NativeApplyInput } from "../../../src/native/apply.js";
import type { NativeWriteSessionResult } from "../../../src/native/write-session.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-apply-unit-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Native Apply Test"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(repo, "value.ts"), BEFORE);
  git(repo, ["add", "value.ts"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function artifactRef(): LoopArtifactRef {
  return {
    id: "art_v2_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    byteLength: 100,
    path: "/unused/artifact.json",
    schemaVersion: "loop-artifact-v2"
  };
}

function acceptance(accepted: boolean): ClosedLoopAcceptance {
  return {
    artifactId: "b".repeat(64),
    revision: "x".repeat(40),
    cwd: "/unused/candidate",
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    accepted,
    reason: accepted ? "accepted" : "verification failed"
  };
}

export function writeResult(repo: string, overrides?: {
  accepted?: boolean;
  revision?: string;
  status?: NativeWriteSessionResult["status"];
}): NativeWriteSessionResult {
  const revision = overrides?.revision ?? git(repo, ["rev-parse", "HEAD"]).trim();
  const accepted = overrides?.accepted ?? true;
  return {
    runId: "r" + "0".repeat(23) as RunId,
    status: overrides?.status ?? (accepted ? "COMPLETED" : "FAILED"),
    candidatePath: "/unused/candidate",
    sourceRevision: revision,
    artifact: artifactRef(),
    acceptance: acceptance(accepted),
    reason: accepted ? "accepted" : "verification failed",
    executionEvents: 3
  };
}

function applyInput(repo: string, result: NativeWriteSessionResult): NativeApplyInput {
  return { sourceRepo: repo, result };
}

async function withRepo(body: (args: { root: string; repo: string }) => Promise<void>): Promise<void> {
  const fixture = await makeRepo();
  try {
    await body(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function makeSession(): Promise<InstanceType<typeof NativeApplySession>> {
  const module = await import("../../../src/native/apply.js");
  return new module.NativeApplySession();
}

test("unaccepted candidate result is refused before any git mutation", async () => {
  await withRepo(async ({ repo }) => {
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    const session = await makeSession();
    await assert.rejects(
      () => session.apply(applyInput(repo, writeResult(repo, { accepted: false }))),
      /accept/i
    );
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  });
});

test("stale source revision is refused without mutation", async () => {
  await withRepo(async ({ repo }) => {
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    const session = await makeSession();
    await assert.rejects(
      () => session.apply(applyInput(repo, writeResult(repo, { revision: "f".repeat(40) }))),
      /revision|stale/i
    );
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  });
});

test("dirty source is refused without mutation", async () => {
  await withRepo(async ({ repo }) => {
    await writeFile(path.join(repo, "value.ts"), "dirty\n");
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    const session = await makeSession();
    await assert.rejects(() => session.apply(applyInput(repo, writeResult(repo))), /clean/i);
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  });
});

test("disposal refuses paths outside the managed sandbox", async () => {
  await withRepo(async ({ repo }) => {
    const session = await makeSession();
    await assert.rejects(() => session.dispose(repo), /not|managed|sandbox|foreign/i);
    assert.equal(git(repo, ["status", "--porcelain"]), "");
  });
});

test("pre-aborted apply performs no work", async () => {
  await withRepo(async ({ repo }) => {
    const controller = new AbortController();
    controller.abort();
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    const session = await makeSession();
    await assert.rejects(
      () => session.apply({ ...applyInput(repo, writeResult(repo)), signal: controller.signal }),
      /abort|cancel/i
    );
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  });
});

for (const identity of ["source", "source junction", "foreign repository", "unregistered worktree", "replaced path", "wrong base"] as const) {
  test(`${identity} is refused before candidate verification executes`, async () => {
    await withRepo(async ({ root, repo }) => {
      const before = git(repo, ["rev-parse", "HEAD"]).trim();
      const marker = path.join(root, "verification-ran");
      let candidatePath = repo;
      if (identity === "source junction") {
        candidatePath = path.join(root, "source-alias");
        await symlink(repo, candidatePath, process.platform === "win32" ? "junction" : "dir");
      } else if (identity === "foreign repository") {
        candidatePath = path.join(root, "foreign");
        git(root, ["clone", repo, candidatePath]);
        assert.equal(git(candidatePath, ["rev-parse", "HEAD"]).trim(), before, "foreign fixture must share the source commit");
      } else if (identity === "unregistered worktree" || identity === "replaced path" || identity === "wrong base") {
        candidatePath = path.join(root, "candidate");
        git(repo, ["worktree", "add", "--detach", candidatePath, before]);
        if (identity === "unregistered worktree") {
          const moved = path.join(root, "moved-candidate");
          await rename(candidatePath, moved);
          candidatePath = moved;
          assert.equal(git(candidatePath, ["rev-parse", "HEAD"]).trim(), before, "unregistered fixture must still answer Git commands");
        } else if (identity === "replaced path") {
          const moved = path.join(root, "original-candidate");
          await rename(candidatePath, moved);
          await symlink(repo, candidatePath, process.platform === "win32" ? "junction" : "dir");
        } else {
          git(candidatePath, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "different base"]);
        }
      }
      const result = writeResult(repo);
      const session = await makeSession();
      await assert.rejects(() => session.apply(applyInput(repo, {
        ...result,
        candidatePath,
        acceptance: {
          ...result.acceptance,
          cwd: candidatePath,
          revision: before,
          args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran', 'utf8')`]
        }
      })), /candidate|source|worktree|base|path/i);
      await assert.rejects(() => access(marker), { code: "ENOENT" }, "verification must not run for an invalid candidate identity");
      assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
      assert.equal(git(repo, ["status", "--porcelain"]), "");
    });
  });
}

test("detached source is refused before verification because a named source branch is required", async () => {
  await withRepo(async ({ root, repo }) => {
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    const candidatePath = path.join(root, "candidate");
    const marker = path.join(root, "verification-ran");
    git(repo, ["worktree", "add", "--detach", candidatePath, before]);
    await writeFile(path.join(candidatePath, "value.ts"), AFTER, "utf8");
    git(repo, ["checkout", "--detach", before]);
    const result = writeResult(repo);
    const session = await makeSession();
    await assert.rejects(() => session.apply(applyInput(repo, {
      ...result,
      candidatePath,
      acceptance: {
        ...result.acceptance,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran', 'utf8')`]
      }
    })), /named source branch/i);
    await assert.rejects(() => access(marker), { code: "ENOENT" });
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
    assert.equal(git(repo, ["rev-parse", "--symbolic-full-name", "HEAD"]).trim(), "HEAD");
    assert.equal(git(repo, ["status", "--porcelain"]), "");
  });
});

// Keep a reference so the fixture helper is used in typecheck even before the
// integration slice lands; removed when disposal integration tests arrive.
void disposeIsolatedWorktree;
void AFTER;

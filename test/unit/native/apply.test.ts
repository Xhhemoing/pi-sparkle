import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(repo, "value.ts"), BEFORE);
  git(repo, ["add", "value.ts"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function artifactRef(): LoopArtifactRef {
  return {
    id: "artifact-1",
    sha256: "a".repeat(64),
    byteLength: 100,
    path: "/unused/artifact.json",
    schemaVersion: "loop-artifact-v1"
  };
}

function acceptance(accepted: boolean): ClosedLoopAcceptance {
  return {
    artifactHash: "b".repeat(64),
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

// Keep a reference so the fixture helper is used in typecheck even before the
// integration slice lands; removed when disposal integration tests arrive.
void disposeIsolatedWorktree;
void AFTER;

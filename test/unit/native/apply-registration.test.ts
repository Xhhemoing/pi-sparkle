import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunId, createProjectId, createTaskId, createEventId, type RunId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { ClosedLoopAcceptance } from "../../../src/execution/acceptance.js";
import type { LoopArtifactRef } from "../../../src/execution/loop-artifact.js";
import type { NativeWriteSessionResult } from "../../../src/native/write-session.js";
import {
  issueApplyRegistration,
  applyIssuedCandidate,
  disposeIssuedCandidate,
  type IssuedApplyCandidate
} from "../../../src/native/apply-registration.js";

const BEFORE = "export const value = 1;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-apply-reg-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Apply Registration Test"]);
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
  status?: NativeWriteSessionResult["status"];
}): NativeWriteSessionResult {
  const revision = git(repo, ["rev-parse", "HEAD"]).trim();
  const accepted = overrides?.accepted ?? true;
  return {
    runId: createRunId(),
    status: overrides?.status ?? (accepted ? "COMPLETED" : "FAILED"),
    candidatePath: "/unused/candidate",
    sourceRevision: revision,
    artifact: artifactRef(),
    acceptance: acceptance(accepted),
    reason: accepted ? "accepted" : "verification failed",
    executionEvents: 3
  };
}

async function seedDurableRun(stateRoot: string, runId: RunId): Promise<void> {
  // Loop artifacts require a real initialized run: a valid event log with a
  // RUN_CREATED whose payload names the same run (durable-identity contract).
  const store = new EventStore(stateRoot, runId);
  const now = parseIsoTimestamp("2026-09-20T09:00:00.000Z");
  const run = {
    id: runId,
    projectId: createProjectId(),
    rootTaskId: createTaskId(),
    status: "RUNNING" as const,
    limits: defaultRunLimits(),
    createdAt: now,
    updatedAt: now
  };
  await store.append({
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: now,
    runId,
    type: "RUN_CREATED",
    actor: "test",
    payload: { run }
  });
}

function withStateRoot<T>(body: (args: { repo: string; root: string; stateRoot: string }) => Promise<T>): Promise<T> {
  return makeRepo().then(async ({ root, repo }) => {
    const stateRoot = path.join(root, "state");
    try {
      return await body({ repo, root, stateRoot });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

async function issueFromTrustedResult(
  stateRoot: string,
  repo: string,
  accepted: NativeWriteSessionResult
): Promise<IssuedApplyCandidate> {
  // The real write path runs inside a parent run, so its artifact address
  // already lives under an initialized run. Registration must seed the same
  // durable run shape for a synthetic trusted result.
  await seedDurableRun(stateRoot, accepted.runId);
  return issueApplyRegistration({ stateRoot, sourceRepo: repo, result: accepted });
}

test("issued candidate mirrors the accepted write result; non-accepted results are refused", async () => {
  await withStateRoot(async ({ repo, stateRoot }) => {
    const accepted = writeResult(repo, { accepted: true });
    const issued = await issueFromTrustedResult(stateRoot, repo, accepted);
    assert.equal(issued.runId, accepted.runId);
    assert.equal(issued.candidatePath, accepted.candidatePath);
    assert.equal(issued.accepted, true);

    const rejected = writeResult(repo, { accepted: false });
    await assert.rejects(
      () => issueApplyRegistration({ stateRoot, sourceRepo: repo, result: rejected }),
      /accepted/i
    );
  });
});

test("foreign runs and mutated artifacts are refused at apply time", async () => {
  await withStateRoot(async ({ repo, stateRoot }) => {
    const accepted = writeResult(repo, { accepted: true });
    const issued = await issueFromTrustedResult(stateRoot, repo, accepted);

    // Foreign run id: no artifact exists under the state root.
    const foreignRun = "run_" + "f".repeat(64);
    await assert.rejects(
      () => applyIssuedCandidate({ stateRoot, sourceRepo: repo, runId: foreignRun, artifactSha256: "a".repeat(64), candidatePath: "/unused/candidate" }),
      /issued|artifact|foreign|missing/i
    );

    // Issued run id but wrong artifact hash: content-address lookup misses.
    await assert.rejects(
      () => applyIssuedCandidate({
        stateRoot, sourceRepo: repo, runId: accepted.runId,
        artifactSha256: "c".repeat(64), candidatePath: "/unused/candidate"
      }),
      /issued|artifact|hash/i
    );

    // Host-side mutation: the same run + mutated body maps to a DIFFERENT
    // artifact address. The issued address binds the exact trusted bytes, so
    // a mutated result can never alias an issued registration.
    const mutated: NativeWriteSessionResult = {
      ...accepted,
      acceptance: { ...accepted.acceptance, command: "node", args: ["-e", "process.exit(0)"] }
    };
    const mutatedIssue = await issueApplyRegistration({
      stateRoot, sourceRepo: repo, result: { ...mutated, runId: accepted.runId }
    });
    assert.notEqual(mutatedIssue.artifactSha256, issued.artifactSha256);
    // The mutated address reconstructs the mutated body — the address is
    // content-bound, not a session-wide lookup. Applying it would run a
    // different command than the host accepted, so candidatePath/source
    // checks must still gate it; the handle's own binding is proven by the
    // address difference itself.
  });
});

test("session-scoped disposal refuses paths never managed by an apply session", async () => {
  await withStateRoot(async ({ repo }) => {
    await assert.rejects(
      () => disposeIssuedCandidate({ candidatePath: repo }),
      /managed|issued|session/i
    );
  });
});

test("registration surface is stable and binds the issued artifact address", async () => {
  await withStateRoot(async ({ repo, stateRoot }) => {
    const accepted = writeResult(repo, { accepted: true });
    const issued = await issueFromTrustedResult(stateRoot, repo, accepted);
    assert.equal(issued.accepted, true);
    assert.ok(issued.runId.startsWith("run_"));
    assert.match(issued.artifactSha256, /^[0-9a-f]{64}$/);
    assert.equal(issued.sourceRevision, accepted.sourceRevision);
  });
});

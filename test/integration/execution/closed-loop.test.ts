import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import {
  closeClosedLoop,
  openClosedLoop,
  runClosedLoopCheck
} from "../../../src/execution/closed-loop.js";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import { loopArtifactsDir, runDirectoryPath } from "../../../src/execution/loop-artifact.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { makeEvent } from "../../../test/helpers/event-factory.js";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function makeSourceRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), "sparkle-src-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/app.txt"), "version=1\n", "utf8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}


async function seedDurableRun(stateRoot: string, runId: ReturnType<typeof createRunId>): Promise<void> {
  // A durable run is a valid initialized event log (RUN_CREATED), not an
  // empty file: assertRunPresent validates run identity through the
  // EventStore, so fixtures must initialize real events.
  const createdAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  await new EventStore(stateRoot, runId).append(
    makeEvent(
      "RUN_CREATED",
      {
        run: {
          id: runId,
          projectId: createProjectId(),
          rootTaskId: createTaskId(),
          status: "PLANNING",
          limits: defaultRunLimits(),
          createdAt,
          updatedAt: createdAt
        }
      },
      { runId }
    )
  );
}

/** Independent check: file must contain the expected token. */
const CHECK_ARGS = [
  "-e",
  "const fs=require('fs'); const t=fs.readFileSync('src/app.txt','utf8'); process.exit(t.includes('version=2')?0:1);"
] as const;

test("closed loop: edit in worktree → independent test sees it → artifact → acceptance", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();

  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    const tools = createWorktreeCodingTools({ worktreeRoot: session.worktree.cwd });
    const write = tools.find((t) => t.name === "sparkle_write_file");
    assert.ok(write);
    await write.execute("t1", {
      path: "src/app.txt",
      contents: "version=2\n"
    });

    const sourceStill = await readFile(path.join(sourceRepo, "src/app.txt"), "utf8");
    assert.equal(sourceStill, "version=1\n", "source checkout must stay untouched");

    const result = await runClosedLoopCheck({
      session,
      stateRoot,
      runId,
      command: "node",
      args: [...CHECK_ARGS],
      selfReport: {
        source: "subagent",
        verification: "PASSED",
        evidenceIds: [],
        summary: "I claim pass without evidence"
      },
      note: "ps-p3 e2e"
    });

    assert.equal(result.check.ok, true, `check exit=${result.check.exitCode}`);
    assert.equal(result.check.exitCode, 0);
    assert.equal(result.check.stdoutHash.length, 64);
    assert.equal(result.artifact.sha256.length, 64);
    assert.equal(result.acceptance.accepted, true);
    assert.equal(result.acceptance.artifactHash, result.artifact.sha256);
    assert.equal(result.acceptance.cwd, session.worktree.cwd);
    assert.equal(result.acceptance.revision, result.check.revision);
    assert.equal(result.acceptance.command, "node");

    await access(path.join(loopArtifactsDir(stateRoot, runId), `${result.artifact.sha256}.json`));
  } finally {
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("closed loop: command failure surfaces as acceptance fail", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    // No edit — version remains 1, so the version=2 check fails.
    const result = await runClosedLoopCheck({
      session,
      stateRoot,
      runId,
      command: "node",
      args: [...CHECK_ARGS]
    });
    assert.equal(result.check.ok, false);
    assert.notEqual(result.check.exitCode, 0);
    assert.equal(result.acceptance.accepted, false);
    assert.match(result.acceptance.reason, /independent check failed/);
  } finally {
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("self-report-only path is rejected even when claiming PASSED", () => {
  const rejected = evaluateIndependentAcceptance({
    selfReport: {
      source: "subagent",
      verification: "PASSED",
      evidenceIds: [],
      summary: "report-only tool call"
    },
    revision: "abc",
    cwd: "/tmp/wt",
    command: "sparkle_report_task_result"
  });
  assert.equal(rejected.accepted, false);
});


test("closed loop: check that only writes under allowedOutputDirs still accepts", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    const tools = createWorktreeCodingTools({ worktreeRoot: session.worktree.cwd });
    const write = tools.find((t) => t.name === "sparkle_write_file");
    assert.ok(write);
    await write.execute("t1", {
      path: "src/app.txt",
      contents: "version=2\n"
    });

    const result = await runClosedLoopCheck({
      session,
      stateRoot,
      runId,
      command: "node",
      args: [
        "-e",
        "const fs=require('fs'); fs.mkdirSync('out',{recursive:true}); fs.writeFileSync('out/log.txt','ok'); const t=fs.readFileSync('src/app.txt','utf8'); process.exit(t.includes('version=2')?0:1);"
      ],
      snapshotManifest: { allowedOutputDirs: ["out"] }
    });

    assert.equal(result.check.ok, true, `check exit=${result.check.exitCode}`);
    assert.notEqual(
      result.check.contentFingerprintBefore.digest,
      result.check.contentFingerprintAfter.digest,
      "digest should change due to out/log.txt"
    );
    assert.equal(result.acceptance.accepted, true, result.acceptance.reason);
  } finally {
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("closed loop: quotePath Chinese file rewrite during check is not accepted", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "sparkle-src-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "core.quotePath", "true"]);
  await writeFile(path.join(repo, "ä¸­æ–‡.txt"), "v1\n", "utf8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init-zh"]);

  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();
  const session = await openClosedLoop({ sourceRepo: repo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    git(session.worktree.cwd, ["config", "core.quotePath", "true"]);
    await writeFile(path.join(session.worktree.cwd, "ä¸­æ–‡.txt"), "v2\n", "utf8");
    const result = await runClosedLoopCheck({
      session,
      stateRoot,
      runId,
      command: "node",
      args: ["-e", "require('fs').writeFileSync('ä¸­æ–‡.txt','v3\\n'); process.exit(0)"]
    });
    assert.equal(result.check.exitCode, 0);
    assert.equal(result.check.ok, false);
    assert.equal(result.acceptance.accepted, false);
  } finally {
    await closeClosedLoop(session);
    await rm(repo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("closed loop: empty or corrupt event logs do not authorize execution", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });
  try {
    for (const contents of ["", "not-json\\n"]) {
      const runId = createRunId();
      const dir = runDirectoryPath(stateRoot, runId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(dir, "events.jsonl"), contents, "utf8");
      await assert.rejects(
        () => runClosedLoopCheck({ session, stateRoot, runId, command: "node", args: ["-e", "process.exit(0)"] }),
        /event|run|corrupt|created|identity/i
      );
    }
  } finally {
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("closed loop: deleted run is not revived by runClosedLoopCheck", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    const runDir = runDirectoryPath(stateRoot, runId);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");
    await deleteRunRecords(stateRoot, runId);
    await assert.rejects(() => access(runDir));

    await assert.rejects(
      () =>
        runClosedLoopCheck({
          session,
          stateRoot,
          runId,
          command: "node",
          args: ["-e", "process.exit(0)"]
        }),
      /missing|refused/
    );

    await assert.rejects(() => access(runDir));
  } finally {
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("closed loop: run lock is respected and no nested same-lock acquisition happens", async () => {
  const sourceRepo = await makeSourceRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-state-"));
  const runId = createRunId();
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });
  let releaseLock: () => void = () => undefined;
  try {
    await seedDurableRun(stateRoot, runId);

    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockHold = withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      await lockGate;
    });
    // Wait until the lock file actually exists (acquisition succeeded).
    while (true) {
      try {
        await access(runLockPath(stateRoot, runId));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    let settled: "done" | "failed" | undefined;
    const pending = runClosedLoopCheck({
      session,
      stateRoot,
      runId,
      command: "node",
      args: ["-e", "process.exit(0)"]
    }).then(
      (result) => {
        settled = "done";
        return result;
      },
      (error) => {
        settled = "failed";
        throw error;
      }
    );
    // The check must block at saveLoopArtifact's lock acquisition, not fail.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, undefined, "check must wait for the held run lock");
    releaseLock();

    // If assertRunPresent (inside the artifact write) re-acquired the same
    // exclusive lock, the check would reject with LOCK_TIMEOUT here.
    const result = await pending;
    assert.equal(result.acceptance.accepted, true);
    await lockHold;
  } finally {
    releaseLock();
    await closeClosedLoop(session);
    await rm(sourceRepo, { recursive: true, force: true });
    await rm(sandbox, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

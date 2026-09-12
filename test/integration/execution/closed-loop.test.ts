import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import {
  closeClosedLoop,
  openClosedLoop,
  runClosedLoopCheck
} from "../../../src/execution/closed-loop.js";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import { loopArtifactsDir } from "../../../src/execution/loop-artifact.js";
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
  try {
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
  try {
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

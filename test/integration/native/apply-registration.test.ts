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
import { NativeWriteSession, type NativeWriteSessionOptions } from "../../../src/native/write-session.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-apply-tool-int-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Apply Tool Integration"]);
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

test("registered apply tool round-trips an issued candidate through the Pi loader", async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const fixture = await makeRepo();
  const stateRoot = path.join(fixture.root, "state");
  const sandboxRoot = path.join(stateRoot, "sandbox");
  let candidatePath = "";
  try {
    // 1. Trusted write: produce an accepted candidate (real git fixtures).
    const writeSession = new NativeWriteSession({ stateRoot, executorFactory: writeExecutorFactory(), sandboxRoot });
    const result = await writeSession.execute({
      sourceRepo: fixture.repo,
      objective: "Update value.ts",
      verification: VERIFY_OK
    });
    assert.equal(result.acceptance.accepted, true, result.reason);
    candidatePath = result.candidatePath;

    // 2. Load the real extension via Pi's loader (no provider work).
    const { loadExtensions } = await import(loaderUrl.href);
    const loaded = await loadExtensions([path.resolve("extensions/pi-sparkle/index.ts")], fixture.root);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions[0]!;

    // 3. The apply tool must refuse a handle that was never issued.
    const applyTool = extension.tools.get("sparkle_apply_candidate")!.definition;
    await assert.rejects(
      () => applyTool.execute(
        "call-1",
        { issue: { runId: result.runId, artifactSha256: result.artifact.sha256, candidatePath: result.candidatePath }, candidatePath: result.candidatePath },
        undefined,
        undefined,
        { cwd: fixture.root } as never
      ),
      /not issued|refused/i
    );

    // 4. The host issues the handle; the tool consumes only the issued
    // handle values (runId + issued artifact sha + candidatePath).
    const regMod = await import("../../../src/native/apply-registration.js");
    const handle = await regMod.issueApplyRegistration({
      stateRoot, sourceRepo: fixture.repo, result
    });
    // The registration record path reconstructs the trusted result from
    // hash-verified bytes; confirm before the tool call.
    const viaLoopArtifact = await regMod.findAcceptedLoopArtifact(
      stateRoot, result.runId, result.artifact.sha256, result.candidatePath
    );
    assert.equal(viaLoopArtifact.acceptance.accepted, true);
    assert.equal(viaLoopArtifact.sourceRevision, result.sourceRevision);
    // The host/user registers the issued handle through the host-only
    // command path (the slash command cannot be invoked by the model).
    const issueCommand = extension.commands.get("sparkle-issue-candidate")!;
    await issueCommand.handler(
      `${handle.runId} ${handle.artifactSha256} ${handle.candidatePath} ${fixture.repo} ${stateRoot}`,
      { cwd: fixture.root, hasUI: false } as never
    );
    const applied = await applyTool.execute(
      "call-2",
      { issue: { runId: handle.runId, artifactSha256: handle.artifactSha256, candidatePath: handle.candidatePath }, candidatePath: handle.candidatePath },
      undefined,
      undefined,
      { cwd: fixture.root } as never
    );
    assert.ok(applied, "issued handle must be accepted by the tool");
    assert.match(applied.content[0]!.text, /Applied/);
    assert.equal(applied.details.status, "APPLIED");

    // 5. Source carries the candidate content; verification passes at root.
    assert.equal(await readFile(path.join(fixture.repo, "value.ts"), "utf8"), AFTER);
    const reverify = spawnSync(process.execPath, VERIFY_OK.args, { cwd: fixture.repo, encoding: "utf8", windowsHide: true });
    assert.equal(reverify.status, 0, "verification must pass at source root");
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { EventStore } from "../../../src/run/event-store.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function withRepo(body: (fixture: { root: string; repo: string; stateRoot: string; sandboxRoot: string }) => Promise<void>, autocrlf = false): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "direct-development-task-"));
  const repo = path.join(root, "repo");
  const stateRoot = path.join(root, "state");
  const sandboxRoot = path.join(root, "candidates");
  try {
    await mkdir(repo);
    await mkdir(sandboxRoot);
    git(repo, ["init"]);
    // Most cases assert exact LF bytes. Do not inherit the runner's checkout
    // conversion; the discovery scenario separately exercises CRLF checkout.
    git(repo, ["config", "core.autocrlf", String(autocrlf)]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Direct Development Test"]);
    await writeFile(path.join(repo, "value.ts"), BEFORE);
    git(repo, ["add", "value.ts"]);
    git(repo, ["commit", "-m", "fixture"]);
    await body({ root, repo, stateRoot, sandboxRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function taskResult(request: AgentExecutionRequest) {
  const evidenceId = createEvidenceId();
  return {
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
  };
}

function checkValue(expected = AFTER) {
  return {
    command: process.execPath,
    args: ["-e", `const fs = require('node:fs'); process.exit(fs.readFileSync('value.ts', 'utf8') === ${JSON.stringify(expected)} ? 0 : 1);`]
  };
}

function writer(onExecute: (candidatePath: string) => void = () => undefined): NativeWriteExecutorFactory {
  return ({ candidatePath, tools }) => ({
    async *execute(request): AsyncIterable<ExecutionEvent> {
      onExecute(candidatePath);
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ["sparkle_list_files", "sparkle_patch_file", "sparkle_read_file", "sparkle_search_files", "sparkle_write_file"]);
      const write = tools.find((tool) => tool.name === "sparkle_write_file");
      assert.ok(write);
      await write.execute("direct-write", { path: "value.ts", contents: AFTER });
      yield { type: "MESSAGE", message: taskResult(request) };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  });
}

test("direct task uses one worker without queue input and retains an accepted candidate without source edits", async () => {
  await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
    let calls = 0;
    const sourceRevision = git(repo, ["rev-parse", "HEAD"]);
    const result = await startDevelopmentTask({
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts", verification: checkValue(),
      executorFactory: writer(() => { calls++; })
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.equal(result.sourceRevision, sourceRevision);
    assert.notEqual(result.candidatePath, repo);
    assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
    assert.equal(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    assert.equal(result.loop, undefined, "default path does not opt into repair orchestration");
    const events = await new EventStore(stateRoot, result.runId).readAll();
    assert.equal(events.events.filter((event) => event.type === "CHILD_RUN_CREATED").length, 1);
    assert.ok(events.events.some((event) => event.type === "RUN_COMPLETED"));
    assert.ok(await readFile(result.artifact.path, "utf8"));
  });
});

test("direct task repairs in the same retained candidate only when bounded attempts are requested", async () => {
  await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
    const candidates: string[] = [];
    const factory: NativeWriteExecutorFactory = ({ candidatePath, tools, attempt }) => ({
      async *execute(request): AsyncIterable<ExecutionEvent> {
        candidates.push(candidatePath);
        assert.ok(attempt);
        if (attempt.number === 2) {
          assert.equal(attempt.previous?.exitCode, 1);
          assert.ok(attempt.previous?.artifactId);
        }
        const write = tools.find((tool) => tool.name === "sparkle_write_file");
        assert.ok(write);
        await write.execute("repair-write", { path: "value.ts", contents: attempt.number === 1 ? BEFORE : AFTER });
        yield { type: "MESSAGE", message: taskResult(request) };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    });
    const result = await startDevelopmentTask({
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts", verification: checkValue(),
      executorFactory: factory, maxAttempts: 2
    });
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.deepEqual(candidates, [result.candidatePath, result.candidatePath]);
    assert.equal(result.loop?.stopReason, "accepted");
    assert.deepEqual(result.loop?.attempts.map((attempt) => attempt.accepted), [false, true]);
    assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
  });
});

test("direct task cancellation retains evidence and does not accept the candidate", async () => {
  await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const pending = startDevelopmentTask({
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts", verification: checkValue(),
      signal: controller.signal,
      executorFactory: ({ tools }) => ({
        async *execute(_request, signal): AsyncIterable<ExecutionEvent> {
          const write = tools.find((tool) => tool.name === "sparkle_write_file");
          assert.ok(write);
          await write.execute("cancel-write", { path: "value.ts", contents: AFTER });
          entered.resolve();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        }
      })
    });
    await entered.promise;
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.acceptance.accepted, false);
    assert.equal(result.reason, "cancelled");
    assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
    assert.ok(await readFile(result.artifact.path, "utf8"));
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
  });
});

test("direct task refuses invalid limits and dirty source before executor allocation", async () => {
  await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
    let calls = 0;
    const input = {
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts", verification: checkValue(),
      executorFactory: () => { calls++; throw new Error("factory must not be allocated"); }
    };
    await assert.rejects(startDevelopmentTask({ ...input, maxAttempts: 0 }), /maxAttempts/);
    await assert.rejects(startDevelopmentTask({ ...input, objective: " " }), /objective/);
    await writeFile(path.join(repo, "value.ts"), AFTER);
    await assert.rejects(startDevelopmentTask(input), /must be clean/);
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(sandboxRoot), []);
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), AFTER);
  });
});

test("direct task snapshots caller-owned roots, executor and verifier before asynchronous work", async () => {
  await withRepo(async ({ root, repo, stateRoot, sandboxRoot }) => {
    let calls = 0;
    const input = {
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts", verification: checkValue(),
      executorFactory: writer(() => { calls++; })
    };
    const pending = startDevelopmentTask(input);
    input.stateRoot = path.join(root, "redirected-state");
    input.sandboxRoot = path.join(root, "redirected-candidates");
    input.sourceRepo = root;
    input.objective = "caller mutated objective";
    input.verification.args.splice(0, input.verification.args.length, "-e", "process.exit(1)");
    input.executorFactory = () => { throw new Error("caller replaced factory"); };
    const result = await pending;
    assert.equal(calls, 1);
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.equal(path.dirname(result.candidatePath), sandboxRoot);
    assert.ok(result.artifact.path.startsWith(`${stateRoot}${path.sep}`));
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
  });
});

test("direct task preserves unsettled effects and candidate evidence through final shutdown", async () => {
  await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
    let calls = 0;
    const result = await startDevelopmentTask({
      stateRoot, sandboxRoot, sourceRepo: repo, objective: "Update value.ts",
      verification: { command: process.execPath, args: ["-e", "process.exit(3)"], unsettledExitCodes: [3] },
      executorFactory: writer(() => { calls++; }), maxAttempts: 3
    });
    assert.equal(calls, 1, "unsettled checker must not start repair");
    assert.equal(result.status, "FAILED");
    assert.equal(result.acceptance.accepted, false);
    assert.equal(result.effectsSettled, false);
    assert.equal(result.loop?.stopReason, "verification-unavailable");
    assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
    const artifact = JSON.parse(await readFile(result.artifact.path, "utf8")) as { body: { processCleanup: { settled: boolean } } };
    assert.equal(artifact.body.processCleanup.settled, false);
    assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
  });
});

for (const autocrlf of [false, true]) {
  test(`direct task discovers, locates, reads and patches candidate code before host acceptance (autocrlf=${autocrlf})`, async () => {
    const candidateBefore = autocrlf ? BEFORE.replaceAll("\n", "\r\n") : BEFORE;
    const candidateAfter = autocrlf ? AFTER.replaceAll("\n", "\r\n") : AFTER;
    await withRepo(async ({ repo, stateRoot, sandboxRoot }) => {
      assert.equal(git(repo, ["config", "--get", "core.autocrlf"]), String(autocrlf));
      let workerCalls = 0;
      let workerError: unknown;
      const result = await startDevelopmentTask({
        stateRoot, sandboxRoot, sourceRepo: repo, objective: "Find and update the exported value", verification: checkValue(candidateAfter),
        executorFactory: ({ tools, candidatePath }) => ({
          async *execute(request): AsyncIterable<ExecutionEvent> {
            workerCalls++;
            try {
              assert.equal(tools.some((tool) => tool.name === "sparkle_run_command"), false);
              const findTool = (name: string) => {
                const tool = tools.find((entry) => entry.name === name);
                assert.ok(tool, `direct task is missing ${name}`);
                return tool;
              };
              const listing = await findTool("sparkle_list_files").execute("list", {}) as { content: { text: string }[] };
              assert.deepEqual(JSON.parse((listing.content[0] as { text: string }).text), { paths: ["value.ts"], truncated: false });
              const found = await findTool("sparkle_search_files").execute("search", { query: "value = 1" }) as { content: { text: string }[] };
              const match = (JSON.parse((found.content[0] as { text: string }).text) as { matches: { path: string; line: number }[] }).matches[0];
              assert.ok(match);
              const read = await findTool("sparkle_read_file").execute("range", { path: match.path, startLine: match.line, endLine: match.line }) as { content: { text: string }[] };
              assert.equal((read.content[0] as { text: string }).text, candidateBefore);
              await findTool("sparkle_patch_file").execute("patch", { path: match.path, oldText: "value = 1", newText: "value = 2" });
              yield { type: "MESSAGE", message: taskResult(request) };
              yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
            } catch (error) {
              const canonical = await realpath(candidatePath).catch(() => "<unavailable>");
              workerError = new Error(`candidate ${candidatePath}; canonical ${canonical}; ${error instanceof Error ? error.stack : String(error)}`, { cause: error });
              throw workerError;
            }
          }
        })
      });
      assert.equal(workerCalls, 1);
      assert.ifError(workerError);
      assert.equal(result.acceptance.accepted, true, result.reason);
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
      assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), candidateAfter);
      assert.equal(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    }, autocrlf);
  });
}

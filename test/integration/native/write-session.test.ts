import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEvidenceId, createMessageId, type RunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { disposeIsolatedWorktree } from "../../../src/execution/worktree.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { NativeWriteSession, NativeWriteSessionOptions, NativeWriteSessionResult } from "../../../src/native/write-session.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function makeRepo(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-write-session-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Native Write Test"]);
  await writeFile(path.join(repo, "value.ts"), BEFORE);
  git(repo, ["add", "value.ts"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function executorFactory(
  mode: "write" | "fail" | "hang" | "throw",
  calls: { count: number; requests: AgentExecutionRequest[] }
): NonNullable<NativeWriteSessionOptions["executorFactory"]> {
  return ({ tools }) => {
    const executor: AgentExecutor = {
      async *execute(request, signal): AsyncIterable<ExecutionEvent> {
        calls.count += 1;
        calls.requests.push(request);
        if (mode === "throw") throw new Error("executor exploded");
        if (mode === "hang") {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
          return;
        }
        assert.deepEqual(tools.map((tool) => tool.name).sort(), ["sparkle_read_file", "sparkle_write_file"]);
        const write = tools.find((tool) => tool.name === "sparkle_write_file");
        assert.ok(write, "write session must inject the candidate-scoped write tool");
        await write.execute("test-write", { path: "value.ts", contents: AFTER });
        yield { type: "MESSAGE", message: makeTaskResult(request, mode === "write" ? "PASSED" : "FAILED") };
        yield { type: "EXECUTION_FINISHED", outcome: mode === "write" ? "SUCCESS" : "FAILURE" };
      }
    };
    return executor;
  };
}

function makeTaskResult(request: AgentExecutionRequest, verification: "PASSED" | "FAILED") {
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
    outcome: verification === "PASSED" ? "SUCCESS" as const : "FAILURE" as const,
    summary: verification === "PASSED" ? "candidate updated" : "candidate failed",
    artifactIds: [],
    evidenceIds: verification === "PASSED" ? [evidenceId] : [],
    verification: { kind: verification, evidenceIds: verification === "PASSED" ? [evidenceId] : [] }
  };
}

function input(repo: string) {
  return {
    sourceRepo: repo,
    objective: "Update value.ts",
    verification: {
      command: process.execPath,
      args: [
        "-e",
        "const fs = require('node:fs'); process.exit(fs.readFileSync('value.ts', 'utf8') === 'export const value = 2;\\n' ? 0 : 1);"
      ]
    }
  };
}

async function withRepo(body: (args: { root: string; repo: string; stateRoot: string }) => Promise<void>): Promise<void> {
  const fixture = await makeRepo();
  const stateRoot = await mkdtemp(path.join(tmpdir(), "native-write-state-"));
  try {
    await body({ ...fixture, stateRoot });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function makeSession(options: NativeWriteSessionOptions): Promise<NativeWriteSession> {
  const module = await import("../../../src/native/write-session.js");
  const sandboxRoot = path.join(options.stateRoot, "sandbox");
  await mkdir(sandboxRoot, { recursive: true });
  return new module.NativeWriteSession({ ...options, sandboxRoot });
}

async function withRetainedCandidate<T>(
  sourceRepo: string,
  result: NativeWriteSessionResult,
  body: () => Promise<T>
): Promise<T> {
  try {
    return await body();
  } finally {
    await disposeIsolatedWorktree({
      cwd: result.candidatePath,
      sandboxRoot: path.dirname(result.candidatePath),
      sourceRepo,
      ref: result.sourceRevision
    });
  }
}

test("successful write keeps source clean and returns retained accepted candidate evidence", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("write", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    const result = await session.execute(input(repo));

    await withRetainedCandidate(repo, result, async () => {
      assert.equal(calls.count, 1);
      assert.equal(result.acceptance.accepted, true, result.acceptance.reason);
      assert.ok(result.runId);
      assert.ok(result.candidatePath);
      assert.ok(result.artifact.sha256.length === 64);
      assert.equal(await readFile(path.join(repo, "value.ts"), "utf8"), BEFORE);
      assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
      assert.equal(calls.requests[0]?.workingDirectory, result.candidatePath);
      const events = await new EventStore(stateRoot, result.runId as RunId).readAll();
      assert.ok(events.events.some((event) => event.type === "RUN_CREATED"));
      assert.ok(events.events.some((event) => event.type === "RUN_COMPLETED"));
    });
  });
});

test("failed host verification retains candidate evidence without acceptance", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("write", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    const result = await session.execute({
      ...input(repo),
      verification: { command: process.execPath, args: ["-e", "process.exit(7)"] }
    });
    await withRetainedCandidate(repo, result, async () => {
      assert.equal(result.acceptance.accepted, false);
      assert.equal(result.status, "FAILED");
      assert.ok(result.artifact.sha256.length === 64);
      assert.ok(result.candidatePath);
    });
  });
});

test("missing verification is refused before executor or worktree allocation", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("write", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    await assert.rejects(
      () => session.execute({ sourceRepo: repo, objective: "Update value.ts", verification: undefined } as never),
      /verification/i
    );
    assert.equal(calls.count, 0);
  });
});

test("dirty source is refused before executor allocation", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    await writeFile(path.join(repo, "value.ts"), "dirty\n");
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("write", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    await assert.rejects(() => session.execute(input(repo)), /clean|dirty/i);
    assert.equal(calls.count, 0);
  });
});

test("pre-abort performs no work", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const controller = new AbortController();
    controller.abort();
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("write", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    await assert.rejects(() => session.execute({ ...input(repo), signal: controller.signal }), /abort|cancel/i);
    assert.equal(calls.count, 0);
  });
});

test("in-flight cancellation settles without acceptance", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const controller = new AbortController();
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("hang", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    const pending = session.execute({ ...input(repo), signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    const result = await pending;
    await withRetainedCandidate(repo, result, async () => {
      assert.equal(result.acceptance.accepted, false);
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.reason, "cancelled");
    });
  });
});

test("shutdown settles active work and skips acceptance", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("hang", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    const pending = session.execute(input(repo));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await session.shutdown();
    const result = await pending;
    await withRetainedCandidate(repo, result, async () => {
      assert.equal(result.acceptance.accepted, false);
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.reason, "shutdown");
    });
  });
});

test("thrown executor failure is retained and cannot be accepted", async () => {
  await withRepo(async ({ repo, stateRoot }) => {
    const calls = { count: 0, requests: [] as AgentExecutionRequest[] };
    const factory = executorFactory("throw", calls);
    const session = await makeSession({ stateRoot, executorFactory: factory });
    const result = await session.execute(input(repo));
    await withRetainedCandidate(repo, result, async () => {
      assert.equal(result.acceptance.accepted, false);
      assert.match(result.reason, /executor|failed|error/i);
      assert.ok(result.runId);
      assert.ok(result.candidatePath);
    });
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import { EventStore } from "../../../src/run/event-store.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createInvocationSink, readInvocationRecords } from "../../../src/telemetry/invocation-log.js";
import { isInvocation, type ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";

async function loadHost() {
  // Missing exported implementation is the first RED, not a test-loader error.
  const location = new URL("../../../examples/direct-development-task.js", import.meta.url).href;
  const module = await import(location).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.runDirectDevelopmentTask, "function", "runnable Pi host must export runDirectDevelopmentTask");
  return module as typeof import("../../../examples/direct-development-task.js");
}

async function fixture(body: (input: { sourceRepo: string; stateRoot: string; sandboxRoot: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pi-development-host-"));
  const sourceRepo = join(root, "source"), stateRoot = join(root, "state"), sandboxRoot = join(root, "candidates");
  try {
    await mkdir(sourceRepo); await mkdir(sandboxRoot);
    for (const args of [["init"], ["config", "core.autocrlf", "false"], ["config", "user.email", "test@example.com"],
      ["config", "user.name", "Host Test"]]) {
      const result = spawnSync("git", args, { cwd: sourceRepo, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
    await writeFile(join(sourceRepo, "value.txt"), "before", "utf8");
    for (const args of [["add", "."], ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]]) {
      const result = spawnSync("git", args, { cwd: sourceRepo, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
    await body({ sourceRepo, stateRoot, sandboxRoot });
  } finally { await rm(root, { force: true, recursive: true }); }
}

for (const accepted of [true, false]) test(`runnable Pi host retains real file writes and independent checker ${accepted ? "acceptance" : "rejection"}`, async () => {
  const { runDirectDevelopmentTask } = await loadHost();
  await fixture(async (paths) => {
    const provider = await startLoopbackOpenAiProvider({ modelIds: ["host-model"], scriptedResponse: (n) => n === 1
      ? { toolCalls: [{ name: "sparkle_write_file", arguments: { path: "value.txt", contents: "after" } }] }
      : n === 2 ? { toolCalls: [{ name: "sparkle_report_task_result", arguments: {
        verification: "PASSED", summary: "updated value", evidenceIds: ["evd_host1"]
      } }] } : { text: "done" } });
    try {
      const invocations: ModelInvocation[] = [];
      const durableSink = createInvocationSink(paths.stateRoot);
      const input = { ...paths, objective: "Change value.txt to after", maxWallTimeMs: 60_000,
        hostEvaluator: { evaluatorId: "host-check", evaluatorVersion: "1", rubricId: "value", rubricVersion: "1",
          evaluatorDefinitionCanonicalJson: '{"accept":"exit 0","modelFailure":[1]}', modelFailureExitCodes: [1] },
        verification: { command: process.execPath, args: ["-e", accepted
          ? "process.exit(require('node:fs').readFileSync('value.txt','utf8') === 'after' ? 0 : 1)"
          : "process.exit(1)"] },
        pi: { providerId: "host-loop", modelId: "host-model", apiKey: "local-fixture", retry: { maxAttempts: 1 },
          customProviders: [{ id: "host-loop", baseUrl: provider.baseUrl, models: [{ id: "host-model" }] }],
          onInvocation: (row: ModelInvocation) => { invocations.push(row); } },
        invocationSink: async (row: ModelInvocation) => { await new Promise((resolve) => setTimeout(resolve, 30)); await durableSink(row); }
      };
      if (accepted) {
        const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: paths.sourceRepo, encoding: "utf8", windowsHide: true });
        assert.equal(revision.status, 0, revision.stderr);
        Object.defineProperty(input, "taskContext", { value: {
          requiredFiles: ["value.txt"], expectedSourceRevision: revision.stdout.trim(), tokenBudget: 2000
        } });
      }
      const result = await runDirectDevelopmentTask(input);
      assert.equal(result.acceptance.accepted, accepted, result.reason);
      assert.equal(await readFile(join(paths.sourceRepo, "value.txt"), "utf8"), "before");
      assert.equal(await readFile(join(result.candidatePath, "value.txt"), "utf8"), "after");
      assert.ok(await readFile(result.artifact.path, "utf8"));
      const events = (await new EventStore(paths.stateRoot, result.runId).readAll()).events;
      assert.ok(events.some((event) => event.type === "CHILD_MESSAGE" && event.payload.message.type === "TASK_RESULT" &&
        event.payload.message.verification?.kind === "PASSED"), "the real report tool must produce a task result");
      assert.ok(provider.requests.length >= 2);
      if (accepted) assert.match(JSON.stringify(provider.requests[0]!.body), /UNTRUSTED CANDIDATE SOURCE/, "non-enumerable context must reach the real worker prompt");
      for (const request of provider.requests) {
        const body = request.body as { model: string; tools: { function: { name: string } }[] };
        assert.equal(body.model, "host-model");
        const names = body.tools.map((tool) => tool.function.name);
        for (const expected of ["sparkle_read_file", "sparkle_write_file", "sparkle_list_files", "sparkle_search_files", "sparkle_patch_file"]) assert.ok(names.includes(expected));
        assert.equal(names.includes("sparkle_run_command"), false);
      }
      assert.ok(invocations.length > 0);
      assert.equal(new Set(invocations.map((row) => row.id)).size, invocations.length);
      assert.deepEqual((await readInvocationRecords(paths.stateRoot)).values.map((row) => {
        assert.ok(isInvocation(row)); return row.id;
      }).sort(), invocations.map((row) => row.id).sort(), "host must await exactly one durable sink write per callback");
      assert.deepEqual(result.hostObservation?.invocations.map((row) => row.id).sort(), invocations.map((row) => row.id).sort(), "candidate host collector and durable sink must receive the same invocations");
      assert.deepEqual(provider.protocolErrors, []);
    } finally { await provider.close(); }
  });
});

test("runnable Pi host forwards cancellation without dispatching another model and flushes telemetry", async () => {
  const { runDirectDevelopmentTask } = await loadHost();
  await fixture(async (paths) => {
    const abort = new AbortController();
    const provider = await startLoopbackOpenAiProvider({ modelIds: ["host-model"], scriptedResponse: () => ({ text: "cancel this task" }) });
    try {
      let sinkCompleted = false;
      const result = await runDirectDevelopmentTask({ ...paths, objective: "Wait for cancellation", signal: abort.signal,
        maxWallTimeMs: 60_000, verification: { command: process.execPath, args: ["-e", "process.exit(99)"] },
        pi: { providerId: "host-loop", modelId: "host-model", apiKey: "local-fixture", retry: { maxAttempts: 1 },
          customProviders: [{ id: "host-loop", baseUrl: provider.baseUrl, models: [{ id: "host-model" }] }],
          onInvocation: () => abort.abort() },
        invocationSink: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); sinkCompleted = true; }
      });
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.acceptance.accepted, false);
      assert.equal(sinkCompleted, true);
      assert.equal(provider.requests.length, 1);
      assert.equal(await readFile(join(paths.sourceRepo, "value.txt"), "utf8"), "before");
      assert.ok(await readFile(result.artifact.path, "utf8"));
    } finally { await provider.close(); }
  });
});

test("executable host entry handles SIGINT and removes its signal listeners after cancellation", async () => {
  const { directDevelopmentMain } = await loadHost();
  await fixture(async (paths) => {
    const priorKey = process.env.SPARKLE_HOST_TEST_API_KEY;
    process.env.SPARKLE_HOST_TEST_API_KEY = "local-fixture";
    const provider = await startLoopbackOpenAiProvider({ modelIds: ["host-model"], scriptedResponse: () => {
      setImmediate(() => process.emit("SIGINT"));
      return { text: "interrupted" };
    } });
    try {
      await saveProvidersConfig(paths.stateRoot, { version: 1, enabled: [], customProviders: [
        { id: "host-loop", baseUrl: provider.baseUrl, envVar: "SPARKLE_HOST_TEST_API_KEY", models: [{ id: "host-model" }] }
      ] });
      const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
      let output = "";
      const code = await directDevelopmentMain([
        "--source", paths.sourceRepo, "--state-root", paths.stateRoot, "--sandbox-root", paths.sandboxRoot,
        "--objective", "Wait for cancellation", "--model", "host-loop/host-model", "--checker", process.execPath,
        "--checker-arg=-e", "--checker-arg=process.exit(99)", "--max-wall-time-ms", "60000"
      ], { stdout: (value) => { output += value; } });
      assert.equal(code, 1);
      const outcome = JSON.parse(output);
      assert.equal(outcome.status, "CANCELLED", `${output}; provider requests: ${provider.requests.length}`);
      assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
      assert.equal(provider.requests.length, 1);
    } finally {
      if (priorKey === undefined) delete process.env.SPARKLE_HOST_TEST_API_KEY;
      else process.env.SPARKLE_HOST_TEST_API_KEY = priorKey;
      await provider.close();
    }
  });
});

test("host refuses own and inherited protected accessors without invoking them", async () => {
  const { runDirectDevelopmentTask } = await loadHost();
  await fixture(async (paths) => {
    for (const field of ["presentation", "taskContext", "hostEvaluator", "checkFindingAnalysis"]) {
      for (const inherited of [false, true]) {
        let reads = 0;
        const descriptor = { enumerable: true, get: () => { reads++; throw new Error("getter must not execute"); } };
        const base = { ...paths, objective: "Never dispatched", verification: { command: process.execPath },
          pi: { providerId: "unused", modelId: "unused", customProviders: [] } };
        const input = inherited ? Object.assign(Object.create(Object.defineProperty({}, field, descriptor)), base)
          : Object.defineProperty(base, field, descriptor);
        await assert.rejects(runDirectDevelopmentTask(input), /must be an own data property/, `${field} inherited=${inherited}`);
        assert.equal(reads, 0, `${field} inherited=${inherited}`);
      }
    }
  });
});

test("host preserves validation of non-enumerable protected data before dispatch", async () => {
  const { runDirectDevelopmentTask } = await loadHost();
  await fixture(async (paths) => {
    for (const field of ["presentation", "taskContext", "hostEvaluator", "checkFindingAnalysis"]) {
      const input = { ...paths, objective: "Never dispatched", verification: { command: process.execPath },
        pi: { providerId: "unused", modelId: "unused", customProviders: [] } };
      Object.defineProperty(input, field, { value: "invalid" });
      await assert.rejects(runDirectDevelopmentTask(input), (error: unknown) => {
        assert.ok(error instanceof DomainValidationError, field); return true;
      });
    }
  });
});

test("host captures sink rejection and synchronous throw immediately and awaits delayed writes before reporting", async () => {
  const { runDirectDevelopmentTask } = await loadHost();
  await fixture(async (paths) => {
    const provider = await startLoopbackOpenAiProvider({ modelIds: ["host-model"], scriptedResponse: (n) => n % 3 === 1
      ? { toolCalls: [{ name: "sparkle_write_file", arguments: { path: "value.txt", contents: `after-${n}` } }] }
      : n % 3 === 2 ? { toolCalls: [{ name: "sparkle_report_task_result", arguments: { verification: "PASSED", summary: "updated value" } }] }
        : { text: "done" } });
    const durable = createInvocationSink(paths.stateRoot);
    const writes: Promise<void>[] = [];
    let calls = 0, delayedDone = false;
    try {
      const run = runDirectDevelopmentTask({ ...paths, objective: "Update value", maxAttempts: 3, maxWallTimeMs: 60_000,
        verification: { command: process.execPath, args: ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8') === 'after-7' ? 0 : 1)"] },
        pi: { providerId: "host-loop", modelId: "host-model", apiKey: "local-fixture", retry: { maxAttempts: 1 },
          customProviders: [{ id: "host-loop", baseUrl: provider.baseUrl, models: [{ id: "host-model" }] }] },
        invocationSink: (row) => {
          calls++;
          if (calls === 1) return Promise.reject(new Error("async sink failed"));
          if (calls === 2) throw new Error("sync sink failed");
          const write = new Promise<void>((resolve) => setTimeout(resolve, 300)).then(async () => {
            await durable(row); delayedDone = true;
          });
          writes.push(write);
          return write;
        }
      });
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors.map((entry: Error) => entry.message), ["async sink failed", "sync sink failed"]);
        assert.equal(delayedDone, true, "all pending writes must settle before telemetry failure is returned");
        const result = error.cause as { candidatePath: string; acceptance: { accepted: boolean } };
        assert.equal(result.acceptance.accepted, true);
        assert.ok(result.candidatePath);
        return true;
      });
      assert.ok(calls >= 3, "a sink failure must not suppress later invocation writes");
      assert.equal((await readInvocationRecords(paths.stateRoot)).values.length, calls - 2);
      assert.equal(await readFile(join(paths.sourceRepo, "value.txt"), "utf8"), "before");
    } finally { await Promise.allSettled(writes); await provider.close(); }
  });
});

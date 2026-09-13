/**
 * G2 — real Pi adapter + HTTP/SSE loopback closed loop (no live LLM).
 *
 * Drives createConfiguredPiExecutor with createWorktreeCodingTools through the
 * agent path (scripted tool_calls over loopback), then host runClosedLoopCheck
 * for independent acceptance. Marked: loopback / no live LLM.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import {
  closeClosedLoop,
  openClosedLoop,
  runClosedLoopCheck,
  type ClosedLoopSession
} from "../../../src/execution/closed-loop.js";
import type { CommandPolicy } from "../../../src/execution/command-policy.js";
import {
  loopArtifactPath,
  readLoopArtifact,
  runDirectoryPath
} from "../../../src/execution/loop-artifact.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";
import {
  startLoopbackOpenAiProvider,
  type LoopbackOpenAiProvider,
  type LoopbackScriptedResponse
} from "../../helpers/loopback-openai-provider.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

const PROVIDER_ID = "g2loop";
const MODEL_ID = "g2loop-1";
const API_KEY = "g2-loopback-test-key-not-real";

const BROKEN_ADD = `function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n`;
const FIXED_ADD = `function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n`;

const CHECK_ARGS = [
  "-e",
  "const { add } = require('./src/add.cjs'); process.exit(add(2, 3) === 5 ? 0 : 1);"
] as const;

const NODE_POLICY: CommandPolicy = {
  allow: [{ executable: "node", maxArgs: 32 }],
  timeoutMs: 15_000,
  envAllowlist: []
};


async function seedDurableRun(stateRoot: string, runId: ReturnType<typeof createRunId>): Promise<void> {
  const dir = runDirectoryPath(stateRoot, runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, "events.jsonl"), "", "utf8");
}

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function makeBrokenFixtureRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), "sparkle-g2-src-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "g2@example.com"]);
  git(repo, ["config", "user.name", "G2 Test"]);
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/add.cjs"), BROKEN_ADD, "utf8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init broken add"]);
  return repo;
}

function executionRequest(workingDirectory: string): AgentExecutionRequest {
  return {
    runId: createRunId(),
    taskId: createTaskId(),
    agentInstanceId: createAgentInstanceId(),
    prompt:
      "Fix src/add.cjs so add(2,3)===5. Use sparkle_read_file then sparkle_write_file, then sparkle_report_task_result.",
    workingDirectory
  };
}

async function drainExecutor(
  executor: Awaited<ReturnType<typeof createConfiguredPiExecutor>>,
  request: AgentExecutionRequest
): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

function toolEvents(events: readonly ExecutionEvent[]): Array<{
  type: string;
  toolName?: string;
  isError?: boolean;
}> {
  return events
    .filter((e) => e.type === "TOOL_STARTED" || e.type === "TOOL_FINISHED")
    .map((e) =>
      e.type === "TOOL_STARTED"
        ? { type: e.type, toolName: e.toolName }
        : { type: e.type, isError: e.isError }
    );
}

interface Harness {
  readonly sourceRepo: string;
  readonly sandbox: string;
  readonly stateRoot: string;
  readonly session: ClosedLoopSession;
  readonly provider: LoopbackOpenAiProvider;
  readonly runId: ReturnType<typeof createRunId>;
}

async function withHarness(
  scriptedResponse: (
    requestNumber: number,
    body: Record<string, unknown>
  ) => LoopbackScriptedResponse,
  run: (h: Harness) => Promise<void>
): Promise<void> {
  const sourceRepo = await makeBrokenFixtureRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-g2-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-g2-state-"));
  const runId = createRunId();
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID],
    scriptedResponse
  });
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  try {
    await withIsolatedPiEnv(async () => {
      await run({ sourceRepo, sandbox, stateRoot, session, provider, runId });
    });
  } finally {
    // Session/provider cleanup first; keep stateRoot until after test body so
    // failure evidence can be asserted. Only wipe this-test resources.
    await closeClosedLoop(session).catch(() => undefined);
    await provider.close().catch(() => undefined);
    await rm(sourceRepo, { recursive: true, force: true }).catch(() => undefined);
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("G2 happy path: Pi loopback tools fix fixture → host check → artifact → acceptance", async () => {
  await withHarness(
    (n) => {
      if (n === 1) {
        return {
          toolCalls: [{ name: "sparkle_read_file", arguments: { path: "src/add.cjs" } }]
        };
      }
      if (n === 2) {
        return {
          toolCalls: [
            {
              name: "sparkle_write_file",
              arguments: { path: "src/add.cjs", contents: FIXED_ADD }
            }
          ]
        };
      }
      if (n === 3) {
        return {
          toolCalls: [
            {
              name: "sparkle_report_task_result",
              arguments: {
                verification: "PASSED",
                summary: "fixed add to return a+b",
                evidenceIds: ["evd_g2fix1"]
              }
            }
          ]
        };
      }
      return { text: "done" };
    },
    async ({ sourceRepo, stateRoot, session, provider, runId }) => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools
      });

      const request = executionRequest(session.worktree.cwd);
      const events = await drainExecutor(executor, request);

      assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
      assert.ok(provider.requests.length >= 3, `expected >=3 provider turns, got ${provider.requests.length}`);

      const started = events.filter((e) => e.type === "TOOL_STARTED");
      const readStart = started.find((e) => e.type === "TOOL_STARTED" && e.toolName === "sparkle_read_file");
      const writeStart = started.find((e) => e.type === "TOOL_STARTED" && e.toolName === "sparkle_write_file");
      assert.ok(readStart, `missing read tool: ${JSON.stringify(toolEvents(events))}`);
      assert.ok(writeStart, `missing write tool: ${JSON.stringify(toolEvents(events))}`);

      const fixed = await readFile(path.join(session.worktree.cwd, "src/add.cjs"), "utf8");
      assert.equal(fixed, FIXED_ADD);
      const sourceStill = await readFile(path.join(sourceRepo, "src/add.cjs"), "utf8");
      assert.equal(sourceStill, BROKEN_ADD, "source repo content must stay untouched");
      const indexCheck = spawnSync("git", ["status", "--porcelain"], {
        cwd: sourceRepo,
        encoding: "utf8",
        windowsHide: true
      });
      assert.equal(indexCheck.status, 0);
      assert.equal(indexCheck.stdout.trim(), "", "source repo index must stay clean");

      const result = await runClosedLoopCheck({
        session,
        stateRoot,
        runId,
        command: "node",
        args: [...CHECK_ARGS],
        selfReport: {
          source: "subagent",
          verification: "PASSED",
          evidenceIds: ["evd_g2fix1"],
          summary: "model claims pass"
        },
        note: "g2 loopback happy path"
      });

      assert.equal(result.check.ok, true, `check exit=${result.check.exitCode}`);
      assert.equal(result.acceptance.accepted, true, result.acceptance.reason);
      assert.equal(result.artifact.sha256.length, 64);
      await access(loopArtifactPath(stateRoot, runId, result.artifact.sha256));
      const body = await readLoopArtifact(stateRoot, runId, result.artifact.sha256);
      assert.ok(body !== null && typeof body === "object");
    }
  );
});

test("G2 negative: provider HTTP failure does not independent PASS", async () => {
  await withHarness(
    () => ({ httpStatus: 500, errorMessage: "injected loopback provider failure" }),
    async ({ stateRoot, session, provider, runId }) => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools,
        retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 }
      });

      const events = await drainExecutor(executor, executionRequest(session.worktree.cwd));
      const finished = events.find((e) => e.type === "EXECUTION_FINISHED");
      assert.ok(finished);
      assert.notEqual(finished.type === "EXECUTION_FINISHED" && finished.outcome, "SUCCESS");

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
          summary: "claim pass after provider failure"
        },
        note: "g2 provider failure"
      });
      assert.equal(result.check.ok, false);
      assert.equal(result.acceptance.accepted, false);
      assert.ok(result.artifact.sha256.length === 64, "failure evidence artifact retained");
    }
  );
});

test("G2 negative: self-report PASSED but host check fails → not independent PASS", async () => {
  await withHarness(
    (n) => {
      if (n === 1) {
        return {
          toolCalls: [
            {
              name: "sparkle_write_file",
              arguments: {
                path: "src/add.cjs",
                contents: `function add(a, b) {\n  return a * b;\n}\nmodule.exports = { add };\n`
              }
            }
          ]
        };
      }
      if (n === 2) {
        return {
          toolCalls: [
            {
              name: "sparkle_report_task_result",
              arguments: {
                verification: "PASSED",
                summary: "I claim the bug is fixed",
                evidenceIds: ["evd_fake1"]
              }
            }
          ]
        };
      }
      return { text: "done" };
    },
    async ({ stateRoot, session, provider, runId }) => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools
      });
      await drainExecutor(executor, executionRequest(session.worktree.cwd));

      const result = await runClosedLoopCheck({
        session,
        stateRoot,
        runId,
        command: "node",
        args: [...CHECK_ARGS],
        selfReport: {
          source: "subagent",
          verification: "PASSED",
          evidenceIds: ["evd_fake1"],
          summary: "self-report success"
        },
        note: "g2 self-report vs check"
      });
      assert.equal(result.check.ok, false);
      assert.equal(result.acceptance.accepted, false);
      assert.match(result.acceptance.reason, /independent check failed|check failed/i);
    }
  );
});

test("G2 negative: unauthorized sparkle_run_command is error; no independent PASS", async () => {
  await withHarness(
    (n) => {
      if (n === 1) {
        return {
          toolCalls: [
            {
              name: "sparkle_run_command",
              arguments: { command: "curl", args: ["http://example.com"] }
            }
          ]
        };
      }
      if (n === 2) {
        return {
          toolCalls: [
            {
              name: "sparkle_report_task_result",
              arguments: {
                verification: "PASSED",
                summary: "ran unauthorized command somehow",
                evidenceIds: ["evd_unauth1"]
              }
            }
          ]
        };
      }
      return { text: "done" };
    },
    async ({ stateRoot, session, provider, runId }) => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools
      });
      const events = await drainExecutor(executor, executionRequest(session.worktree.cwd));
      const startedCmd = events.find(
        (e) => e.type === "TOOL_STARTED" && e.toolName === "sparkle_run_command"
      );
      assert.ok(startedCmd && startedCmd.type === "TOOL_STARTED");
      const finishedCmd = events.find(
        (e) =>
          e.type === "TOOL_FINISHED" &&
          e.toolCallId === startedCmd.toolCallId
      );
      assert.ok(finishedCmd && finishedCmd.type === "TOOL_FINISHED");
      assert.equal(finishedCmd.isError, true, "unauthorized command must surface as tool error");

      const result = await runClosedLoopCheck({
        session,
        stateRoot,
        runId,
        command: "node",
        args: [...CHECK_ARGS],
        note: "g2 unauthorized command"
      });
      assert.equal(result.acceptance.accepted, false);
    }
  );
});

test("G2 negative: artifact tamper is refused; must not independent PASS on tampered bytes", async () => {
  await withHarness(
    (n) => {
      if (n === 1) {
        return {
          toolCalls: [
            {
              name: "sparkle_write_file",
              arguments: { path: "src/add.cjs", contents: FIXED_ADD }
            }
          ]
        };
      }
      return { text: "done without report tool" };
    },
    async ({ stateRoot, session, provider, runId }) => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools
      });
      await drainExecutor(executor, executionRequest(session.worktree.cwd));

      const result = await runClosedLoopCheck({
        session,
        stateRoot,
        runId,
        command: "node",
        args: [...CHECK_ARGS],
        note: "g2 before tamper"
      });
      assert.equal(result.acceptance.accepted, true, result.acceptance.reason);

      const artifactFile = loopArtifactPath(stateRoot, runId, result.artifact.sha256);
      const original = await readFile(artifactFile, "utf8");
      const tampered = original.replace(/"note": "g2 before tamper"/, '"note": "tampered"');
      assert.notEqual(tampered, original);
      await writeFile(artifactFile, tampered, "utf8");

      await assert.rejects(
        () => readLoopArtifact(stateRoot, runId, result.artifact.sha256),
        /hash mismatch|tamper/i
      );
      // Independent PASS was recorded against the pre-tamper hash; a tampered
      // read must not be treated as valid evidence for a new PASS.
      assert.equal(result.acceptance.accepted, true);
      assert.equal(result.acceptance.artifactHash, result.artifact.sha256);
    }
  );
});

test("G2 negative: session cleanup does not wipe sole failure evidence under stateRoot", async () => {
  const sourceRepo = await makeBrokenFixtureRepo();
  const sandbox = await mkdtemp(path.join(tmpdir(), "sparkle-g2-sandbox-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "sparkle-g2-state-"));
  const runId = createRunId();
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID],
    scriptedResponse: () => ({ text: "no tools used" })
  });
  const session = await openClosedLoop({ sourceRepo, sandboxRoot: sandbox });

    await seedDurableRun(stateRoot, runId);  let artifactSha: string | undefined;
  try {
    await withIsolatedPiEnv(async () => {
      const tools = createWorktreeCodingTools({
        worktreeRoot: session.worktree.cwd,
        commandPolicy: NODE_POLICY
      });
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        apiKey: API_KEY,
        customProviders: [
          {
            id: PROVIDER_ID,
            baseUrl: provider.baseUrl,
            models: [{ id: MODEL_ID, name: "G2 Loop", contextWindow: 8_192, maxTokens: 512 }]
          }
        ],
        tools
      });
      await drainExecutor(executor, executionRequest(session.worktree.cwd));

      const result = await runClosedLoopCheck({
        session,
        stateRoot,
        runId,
        command: "node",
        args: [...CHECK_ARGS],
        note: "g2 failure evidence keep"
      });
      assert.equal(result.acceptance.accepted, false);
      artifactSha = result.artifact.sha256;
    });
  } finally {
    // Cleanup session/provider/source — deliberately keep stateRoot for assert.
    await closeClosedLoop(session).catch(() => undefined);
    await provider.close().catch(() => undefined);
    await rm(sourceRepo, { recursive: true, force: true }).catch(() => undefined);
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
  }

  assert.ok(artifactSha);
  // First save is provisional (pre-acceptance); it still retains the failed
  // independent check. Session/source cleanup must not remove stateRoot evidence.
  const body = await readLoopArtifact(stateRoot, runId, artifactSha);
  assert.ok(body !== null && typeof body === "object");
  const check = (body as { check?: { ok?: boolean }; note?: string }).check;
  assert.equal(check?.ok, false);
  assert.equal((body as { note?: string }).note, "g2 failure evidence keep");
  await access(loopArtifactPath(stateRoot, runId, artifactSha));

  await rm(stateRoot, { recursive: true, force: true });
});

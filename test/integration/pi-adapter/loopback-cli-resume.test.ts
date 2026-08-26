import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import { createTaskId, type RunId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startParentRun } from "../../../src/run/coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import { startSupervisedRun } from "../../../src/run/supervisor.js";
import { loadInvocationsFromStateRoot } from "../../../src/routing/cost-calibration.js";
import { invocationsLogPath } from "../../../src/telemetry/invocation-log.js";
import {
  startLoopbackOpenAiProvider,
  type LoopbackOpenAiProvider
} from "../../helpers/loopback-openai-provider.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";
import { stripSkipContractWarning } from "../../helpers/skip-contract-warning.js";
import { simulateProcessDeath } from "../../helpers/process-death.js";

const PROVIDER_ID = "loopback";
const MODEL_ID = "loopback-1";
const CATALOG_ID = `${PROVIDER_ID}/${MODEL_ID}`;
const DEFAULT_MODEL_ID = "loopback-2";
const DEFAULT_CATALOG_ID = `${PROVIDER_ID}/${DEFAULT_MODEL_ID}`;
const API_KEY = "loopback-test-key";

const FLOWCHART = {
  id: "loopback-resume",
  nodes: [
    {
      id: "prepare",
      taskId: "tsk_prepare",
      role: "actor",
      objective: "Prepare the offline result",
      modelPolicy: { allowedModels: [CATALOG_ID] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    },
    {
      id: "deliver",
      taskId: "tsk_deliver",
      role: "actor",
      objective: "Deliver the offline result",
      modelPolicy: { allowedModels: [CATALOG_ID] },
      confidenceThreshold: 0.7,
      approvalRequired: true
    }
  ],
  edges: [{ from: "prepare", to: "deliver", condition: { type: "success", expected: true } }]
};

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

function parseRunId(output: string): string {
  const runId = output.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, `missing run id in output: ${output}`);
  return runId;
}

async function invocationRowCount(stateRoot: string): Promise<number> {
  const text = await readFile(invocationsLogPath(stateRoot), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  );
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

async function waitForInvocationRows(stateRoot: string, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await invocationRowCount(stateRoot)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`expected ${expected} invocation rows, found ${await invocationRowCount(stateRoot)}`);
}

async function waitForTaskRunning(stateRoot: string, runId: RunId): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const read = await store.readAll();
    const running = read.events.some(
      (event) => event.type === "TASK_STATUS_CHANGED" && event.payload.status === "RUNNING"
    );
    if (running) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`supervised run ${runId} did not persist a running task`);
}

class HangingExecutor implements AgentExecutor {
  async *execute(
    _request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

/**
 * Supplies the deterministic verifier verdict that a plain-text Pi response
 * cannot carry, while delegating the model call itself to the real Pi executor.
 */
class CascadeVerificationExecutor implements AgentExecutor {
  private attempts = 0;

  constructor(private readonly delegate: AgentExecutor) {}

  async *execute(
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    this.attempts += 1;
    const verificationFailed = this.attempts === 1;
    for await (const event of this.delegate.execute(request, signal)) {
      if (event.type !== "MESSAGE" || event.message.type !== "TASK_RESULT") {
        yield event;
        continue;
      }
      yield verificationFailed
        ? {
            type: "MESSAGE",
            message: {
              ...event.message,
              outcome: "FAILURE",
              summary: "deterministic verification failed",
              verification: { kind: "FAILED", evidenceIds: [] },
              failure: { category: "MODEL_ERROR", detail: "deterministic verification failed" }
            }
          }
        : {
            type: "MESSAGE",
            message: {
              ...event.message,
              outcome: "SUCCESS",
              summary: "deterministic verification passed",
              verification: { kind: "PASSED", evidenceIds: [] }
            }
          };
    }
  }
}

function supervisedTask(): TaskNode {
  return {
    id: createTaskId(() => "wire"),
    title: "wire",
    objective: "Witness the resumed executor request",
    role: "worker",
    dependencies: [],
    acceptanceCriteria: [{ id: "ac-wire", description: "the provider receives the request" }],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

function cascadeTask(): ChildTaskInput {
  const role = "worker";
  return {
    taskId: createTaskId(() => "cascade-wire"),
    role,
    objective: "Prove the cascade model on the loopback wire",
    profile: createAgentProfileRegistry(defaultAgentProfiles()).resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: [
      { id: "ac-cascade-wire", description: "the second request uses the next model tier" }
    ],
    limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 120_000 },
    assignedModel: CATALOG_ID,
    cascade: {
      highRisk: false,
      tiers: [
        { modelId: CATALOG_ID, version: `${MODEL_ID}-v1` },
        { modelId: DEFAULT_CATALOG_ID, version: `${DEFAULT_MODEL_ID}-v1` }
      ]
    }
  };
}

async function withHarness(
  run: (input: {
    stateRoot: string;
    projectRoot: string;
    provider: LoopbackOpenAiProvider;
  }) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-loopback-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-loopback-project-"));
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID, DEFAULT_MODEL_ID]
  });
  try {
    await writeFile(join(projectRoot, "package.json"), "{}\n", "utf8");
    await saveProvidersConfig(stateRoot, {
      version: 1,
      enabled: [CATALOG_ID, DEFAULT_CATALOG_ID],
      primary: DEFAULT_CATALOG_ID,
      fast: DEFAULT_CATALOG_ID,
      customProviders: [
        {
          id: PROVIDER_ID,
          baseUrl: provider.baseUrl,
          models: [
            {
              id: MODEL_ID,
              name: "Loopback One",
              contextWindow: 8_192,
              maxTokens: 256,
              inputCostPerMTok: 0.25,
              outputCostPerMTok: 1,
              reasoning: true,
              compat: { supportsReasoningEffort: true }
            },
            {
              id: DEFAULT_MODEL_ID,
              name: "Loopback Default",
              contextWindow: 8_192,
              maxTokens: 256,
              inputCostPerMTok: 0.25,
              outputCostPerMTok: 1
            }
          ]
        }
      ]
    });
    await withIsolatedPiEnv(async () => {
      process.env.PI_API_KEY = API_KEY;
      await run({ stateRoot, projectRoot, provider });
    });
  } finally {
    await provider.close();
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("cascade retry sends the next tier's model on the second loopback request", async () => {
  await withHarness(async ({ stateRoot, projectRoot, provider }) => {
    const piExecutor = await createConfiguredPiExecutor({
      stateRoot,
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      apiKey: API_KEY
    });
    const outcome = await startParentRun(
      {
        stateRoot,
        executor: new CascadeVerificationExecutor(piExecutor),
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      {
        projectRoot,
        objective: "Exercise a two-tier cascade over loopback",
        children: [cascadeTask()]
      }
    ).done;

    assert.equal(outcome.status, "COMPLETED");
    const taskResults = outcome.events
      .filter((event) => event.type === "CHILD_MESSAGE")
      .map((event) => event.payload.message)
      .filter((message) => message.type === "TASK_RESULT");
    assert.deepEqual(
      taskResults.map((message) => message.verification.kind),
      ["FAILED", "PASSED"],
      "the first deterministic failure is what drives the cascade retry"
    );
    const retry = outcome.events.find((event) => event.type === "TASK_RETRY");
    assert.ok(retry);
    assert.equal(retry.payload.previousModel, CATALOG_ID);
    assert.equal(retry.payload.nextModel, DEFAULT_CATALOG_ID);

    assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
    assert.equal(provider.requests.length, 2, "the failed verification causes exactly one retry");
    for (const request of provider.requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.authorization, `Bearer ${API_KEY}`);
      assert.ok(typeof request.body === "object" && request.body !== null);
      assert.equal((request.body as Record<string, unknown>).stream, true);
    }
    const firstBody = provider.requests[0]!.body as Record<string, unknown>;
    const secondBody = provider.requests[1]!.body as Record<string, unknown>;
    assert.equal(firstBody.model, MODEL_ID);
    assert.equal(secondBody.model, DEFAULT_MODEL_ID);
  });
});

test("flowchart resume sends flagged executor config to the offline provider", async () => {
  await withHarness(async ({ stateRoot, projectRoot, provider }) => {
    const flowchartPath = join(projectRoot, "flowchart.json");
    await writeFile(flowchartPath, `${JSON.stringify(FLOWCHART, null, 2)}\n`, "utf8");

    const started = capture();
    const startCode = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Exercise Pi offline",
        "--flowchart",
        flowchartPath,
        "--executor",
        "pi",
        "--state-root",
        stateRoot
      ],
      started.io
    );
    assert.equal(startCode, 0, started.err.join(""));
    assert.equal(stripSkipContractWarning(started.err.join("")), "");
    assert.match(started.out.join(""), /WAITING_FOR_USER/);
    const runId = parseRunId(started.out.join(""));
    await waitForInvocationRows(stateRoot, 1);

    const resumed = capture();
    const resumeCode = await main(
      [
        "resume",
        "--run",
        runId,
        "--selected",
        `route:${CATALOG_ID}`,
        "--executor",
        "pi",
        "--primary-model",
        CATALOG_ID,
        "--thinking",
        "high",
        "--state-root",
        stateRoot
      ],
      resumed.io
    );
    assert.equal(resumeCode, 0, resumed.err.join(""));
    // R4-6: this was the pinned default-rebuild warning from 74daff3. Adding
    // flags intentionally changes that sole allowed stderr line to disclosure.
    assert.equal(
      resumed.err.join(""),
      "note: resume rebuilt the pi executor with primary model loopback/loopback-1 and thinking high; the run's own executor configuration is not recorded, so this is what you asked for now, not what it started with\n"
    );
    assert.match(resumed.out.join(""), /COMPLETED/);
    await waitForInvocationRows(stateRoot, 2);

    assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
    assert.equal(provider.requests.length, 2, "run and resume each make one provider call");
    for (const request of provider.requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.authorization, `Bearer ${API_KEY}`);
      assert.ok(typeof request.body === "object" && request.body !== null);
      assert.equal((request.body as Record<string, unknown>).model, MODEL_ID);
      assert.equal((request.body as Record<string, unknown>).stream, true);
    }
    const startedBody = provider.requests[0]!.body as Record<string, unknown>;
    const resumedBody = provider.requests[1]!.body as Record<string, unknown>;
    assert.equal(startedBody.reasoning_effort, undefined);
    assert.equal(resumedBody.reasoning_effort, "high");

    // This is the production calibration reader, not a direct JSONL parse.
    // It also executes the fail-closed invocation decoder over both rows.
    const calibratedInput = await loadInvocationsFromStateRoot(stateRoot);
    assert.equal(calibratedInput.length, 2);
    assert.deepEqual(
      new Set(calibratedInput.map((row) => row.taskId)),
      new Set(["tsk_prepare", "tsk_deliver"])
    );
    assert.equal(
      calibratedInput.find((row) => row.taskId === "tsk_prepare")?.runId,
      runId,
      "the initial thin-executor invocation belongs to the flowchart run"
    );
    for (const row of calibratedInput) {
      assert.equal(row.config.provider, PROVIDER_ID);
      assert.equal(row.config.model, MODEL_ID);
      assert.equal(row.callOutcome, "ok");
      assert.equal(row.tokensIn, 11);
      assert.equal(row.tokensOut, 5);
    }
  });
});

test("supervised resume overrides a distinct configured default on the HTTP request", async () => {
  await withHarness(async ({ stateRoot, projectRoot, provider }) => {
    const interrupted = startSupervisedRun(
      {
        stateRoot,
        executor: new HangingExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      {
        projectRoot,
        objective: "Exercise supervised resume over loopback",
        tasks: [supervisedTask()]
      }
    );

    try {
      await waitForTaskRunning(stateRoot, interrupted.runId);
      simulateProcessDeath(stateRoot, interrupted.runId);
      assert.equal(provider.requests.length, 0, "the interrupted fixture never contacted the provider");

      const resumed = capture();
      const resumeCode = await main(
        [
          "resume",
          "--run",
          interrupted.runId,
          "--supervised",
          "--executor",
          "pi",
          "--primary-model",
          CATALOG_ID,
          "--thinking",
          "high",
          "--state-root",
          stateRoot
        ],
        resumed.io
      );

      // Pi synthesizes UNOBSERVED verification for plain text, so the
      // deterministic supervised judge blocks after the witnessed call.
      assert.equal(resumeCode, 1, resumed.err.join(""));
      assert.match(resumed.out.join(""), /resumed \(BLOCKED\)/);
      assert.equal(
        resumed.err.join(""),
        "note: resume rebuilt the pi executor with primary model loopback/loopback-1 and thinking high; the run's own executor configuration is not recorded, so this is what you asked for now, not what it started with\n"
      );

      assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
      assert.equal(provider.requests.length, 1, "supervised resume makes one provider call");
      const request = provider.requests[0]!;
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.authorization, `Bearer ${API_KEY}`);
      assert.ok(typeof request.body === "object" && request.body !== null);
      const body = request.body as Record<string, unknown>;
      assert.equal(body.model, MODEL_ID);
      assert.notEqual(body.model, DEFAULT_MODEL_ID);
      assert.equal(body.reasoning_effort, "high");
      assert.equal(body.stream, true);
    } finally {
      interrupted.cancel();
      await interrupted.done.catch(() => undefined);
    }
  });
});

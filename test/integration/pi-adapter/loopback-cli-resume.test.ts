import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import { loadInvocationsFromStateRoot } from "../../../src/routing/cost-calibration.js";
import { invocationsLogPath } from "../../../src/telemetry/invocation-log.js";
import {
  startLoopbackOpenAiProvider,
  type LoopbackOpenAiProvider
} from "../../helpers/loopback-openai-provider.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

const PROVIDER_ID = "loopback";
const MODEL_ID = "loopback-1";
const CATALOG_ID = `${PROVIDER_ID}/${MODEL_ID}`;
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

async function withHarness(
  run: (input: {
    stateRoot: string;
    projectRoot: string;
    provider: LoopbackOpenAiProvider;
  }) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-loopback-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-loopback-project-"));
  const provider = await startLoopbackOpenAiProvider({ modelId: MODEL_ID });
  try {
    await writeFile(join(projectRoot, "package.json"), "{}\n", "utf8");
    await saveProvidersConfig(stateRoot, {
      version: 1,
      enabled: [CATALOG_ID],
      primary: CATALOG_ID,
      fast: CATALOG_ID,
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

test("offline custom provider persists run and resume invocations for calibration", async () => {
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
    assert.equal(started.err.join(""), "");
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
        "--state-root",
        stateRoot
      ],
      resumed.io
    );
    assert.equal(resumeCode, 0, resumed.err.join(""));
    // R4-6: a flag-free `--executor pi` resume rebuilds on defaults and says so.
    // Other stderr remains a failure; this is the one disclosed line.
    assert.equal(
      resumed.err.join(""),
      "warning: resume rebuilt the pi executor on defaults (the default primary model, thinking off); the run's own --primary-model/--thinking are not recorded, so pass them again if it did not start on defaults\n"
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

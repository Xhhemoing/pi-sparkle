import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import {
  startLoopbackOpenAiProvider,
  type LoopbackOpenAiProvider
} from "../../helpers/loopback-openai-provider.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

const PROVIDER_ID = "costless";
const MODEL_ID = "costless-1";
const CATALOG_ID = `${PROVIDER_ID}/${MODEL_ID}`;
const API_KEY = "costless-test-key";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

/**
 * A custom provider with no declared rates. `buildCustomProvider` zero-fills
 * the cost block and `catalogPrices` reads a zero pair as "nobody priced this"
 * rather than "free", so this is an unpriced model by construction — the
 * common case for every locally configured provider, not a corner.
 */
async function withHarness(
  run: (input: {
    stateRoot: string;
    projectRoot: string;
    provider: LoopbackOpenAiProvider;
  }) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-costgate-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-costgate-project-"));
  const provider = await startLoopbackOpenAiProvider({ modelIds: [MODEL_ID] });
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
          models: [{ id: MODEL_ID, name: "Costless One", contextWindow: 8_192, maxTokens: 256 }]
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

function requireRunId(out: string[], err: string[]): string {
  const runId = out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  if (runId === undefined) {
    throw new Error(`expected a run id; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
  }
  return runId;
}

async function rootTaskId(stateRoot: string, runId: string): Promise<string> {
  const raw = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  const created = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { type: string; payload: { run?: { rootTaskId?: string } } })
    .find((event) => event.type === "RUN_CREATED");
  assert.ok(created?.payload.run?.rootTaskId, "RUN_CREATED should name the root task");
  return created.payload.run.rootTaskId;
}

test("run --executor pi --max-cost-usd on an unpriced model warns once on stderr", async () => {
  await withHarness(async ({ stateRoot, projectRoot, provider }) => {
    const { io, out, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Exercise the disarmed cost ceiling",
        "--executor",
        "pi",
        "--max-cost-usd",
        "0.01",
        "--state-root",
        stateRoot
      ],
      io
    );

    // The whole thread, end to end: main -> createExecutor ->
    // createConfiguredPiExecutor -> PiAgentExecutor -> onCostGate -> stderr.
    const runId = requireRunId(out, err);
    assert.equal(
      err.join(""),
      `warning: cost ceiling not enforced for task ${await rootTaskId(stateRoot, runId)}: ` +
        "requested 0.01 USD, but the catalog quotes no usable price for this model, " +
        "so spend is unknowable; the run continues uncapped\n"
    );
    // The warning is disclosure, not a failure: the run still exits by its own
    // outcome and the model call still happened.
    assert.equal(code, 0, out.join(""));
    assert.match(out.join(""), /COMPLETED/);
    assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
    assert.equal(provider.requests.length, 1);
  });
});

test("the same run without --max-cost-usd stays silent", async () => {
  // The control that keeps the warning honest: it fires because a ceiling was
  // requested and could not be armed, not because the model is unpriced.
  await withHarness(async ({ stateRoot, projectRoot, provider }) => {
    const { io, err } = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "Exercise the uncapped control",
        "--executor",
        "pi",
        "--state-root",
        stateRoot
      ],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.equal(err.join(""), "");
    assert.equal(provider.requests.length, 1);
  });
});

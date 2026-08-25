import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { FLOWCHART_EXAMPLE_JSON } from "../../../src/cli/init-examples.js";
import { setDefaultModels } from "../../../src/config/providers-config.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withRoots(
  run: (stateRoot: string, projectRoot: string) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parity-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parity-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function routedModels(stateRoot: string, runId: string): Promise<readonly string[]> {
  const eventsText = await readFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "utf8");
  return eventsText
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { type: string; payload?: { model?: unknown } })
    .filter((event) => event.type === "MODEL_ROUTED")
    .map((event) => String(event.payload?.model));
}

/**
 * The state root `models set-default --primary openai/gpt-4o-mini` leaves
 * behind: one primary, no fast, nothing else enabled. `set-default` self-
 * enables the ref, so this is the whole first-run setup.
 */
async function withLonePrimary(
  run: (stateRoot: string, projectRoot: string, flowchartPath: string) => Promise<void>
): Promise<void> {
  await withRoots(async (stateRoot, projectRoot) => {
    await setDefaultModels(stateRoot, { primary: "openai/gpt-4o-mini" });
    const flowchartPath = join(projectRoot, "flow.json");
    await writeFile(flowchartPath, FLOWCHART_EXAMPLE_JSON, "utf8");
    await run(stateRoot, projectRoot, flowchartPath);
  });
}

/**
 * The shipped `init` flowchart against the shipped `models set-default` setup:
 * both example nodes allow `cheap` and `premium` and the second prefers
 * `premium`, so a catalog that suppressed the `premium` alias for a lone
 * primary made `init`'s "run immediately" false. Routing the run proves the
 * alias survives past parse-time membership into the real router.
 */
test("a lone primary runs the shipped flowchart example and routes its premium node", async () => {
  await withLonePrimary(async (stateRoot, projectRoot, flowchartPath) => {
    const validated = capture();
    assert.equal(
      await main(["validate", "--flowchart", flowchartPath, "--state-root", stateRoot], validated.io),
      0,
      validated.err.join("")
    );

    const ran = capture();
    const code = await main(
      [
        "run",
        "--project",
        projectRoot,
        "--objective",
        "x",
        "--flowchart",
        flowchartPath,
        "--executor",
        "fake",
        "--state-root",
        stateRoot
      ],
      ran.io
    );
    assert.equal(code, 0, ran.err.join(""));
    const text = ran.out.join("");
    assert.match(text, /COMPLETED/);
    const runId = text.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
    assert.ok(runId);
    assert.ok(
      (await routedModels(stateRoot, runId)).includes("premium"),
      "the migrate node prefers premium, so the run must route it"
    );
  });
});

/**
 * The other half of parity: `validate` is only worth running if it refuses
 * exactly what `run` refuses. A regression that taught one call site a model
 * the other does not know would pass a one-sided test and fail this one.
 */
test("validate and run refuse the same unavailable model with the same fact", async () => {
  await withLonePrimary(async (stateRoot, projectRoot, flowchartPath) => {
    const example = JSON.parse(FLOWCHART_EXAMPLE_JSON) as {
      nodes: { modelPolicy: { allowedModels: string[]; preferredModel?: string } }[];
    };
    const [first, ...rest] = example.nodes;
    assert.ok(first);
    await writeFile(
      flowchartPath,
      JSON.stringify({
        ...example,
        nodes: [{ ...first, modelPolicy: { allowedModels: ["mystery"] } }, ...rest]
      }),
      "utf8"
    );

    const validated = capture();
    assert.equal(
      await main(["validate", "--flowchart", flowchartPath, "--state-root", stateRoot], validated.io),
      1
    );
    assert.deepEqual(validated.out, []);
    assert.match(parseCliErrorJson(validated.err.join(""))?.message ?? "", /unavailable model "mystery"/);

    const ran = capture();
    assert.equal(
      await main(
        [
          "run",
          "--project",
          projectRoot,
          "--objective",
          "x",
          "--flowchart",
          flowchartPath,
          "--executor",
          "fake",
          "--state-root",
          stateRoot
        ],
        ran.io
      ),
      1
    );
    assert.match(ran.err.join(""), /unavailable model "mystery"/);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { describeResumeExecutorConfig, main, type CliIo } from "../../../src/cli/main.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * `resume` used to accept neither `--primary-model` nor `--thinking`: a run
 * started on `--primary-model X --thinking high` came back on whatever the
 * ambient defaults resolved to, with nothing said about it.
 *
 * Nothing records a run's executor configuration — no event payload carries it,
 * and `materializeCheckpoint` derives `checkpoint.json` from the replayed log,
 * so a field written there would not survive the next rebuild — so resume
 * cannot restore it and instead takes the flags again. What is testable offline
 * is the honesty half: which configuration resume says it rebuilt. Only
 * `--executor pi` reads either value, so the forwarding itself is pinned in
 * `test/unit/cli/invocation-sink-wiring.test.ts`.
 */
function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-resume-cfg-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-resume-cfg-proj-"));
  const savedLevel = process.env.PI_THINKING_LEVEL;
  delete process.env.PI_THINKING_LEVEL;
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => run(stateRoot, projectRoot));
  } finally {
    if (savedLevel === undefined) delete process.env.PI_THINKING_LEVEL;
    else process.env.PI_THINKING_LEVEL = savedLevel;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** Starts a plain (non-flowchart) fake run and returns its id. */
async function startPlainRun(stateRoot: string, projectRoot: string): Promise<string> {
  const started = capture();
  const code = await main(
    ["run", "--project", projectRoot, "--objective", "Ship", "--state-root", stateRoot],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, started.out.join(""));
  return runId;
}

const FLOWCHART = {
  id: "resume-cfg",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
};

const RESULTS = { only: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_only"] } };

async function startFlowchartRun(stateRoot: string, projectRoot: string): Promise<string> {
  const flowchartPath = join(projectRoot, "flow.json");
  const resultsPath = join(projectRoot, "results.json");
  await writeFile(flowchartPath, JSON.stringify(FLOWCHART), "utf8");
  await writeFile(resultsPath, JSON.stringify(RESULTS), "utf8");
  const started = capture();
  const code = await main(
    [
      "run",
      "--project",
      projectRoot,
      "--objective",
      "Ship",
      "--flowchart",
      flowchartPath,
      "--results",
      resultsPath,
      "--state-root",
      stateRoot
    ],
    started.io
  );
  assert.equal(code, 0, started.err.join(""));
  const runId = started.out.join("").match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(runId, started.out.join(""));
  return runId;
}

test("resume --thinking with an unknown level fails at parse-args before touching the run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["resume", "--run", runId, "--state-root", stateRoot, "--thinking", "ultra"],
      io
    );
    assert.equal(code, 1);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "resume");
    assert.equal(parsed?.stage, "parse-args");
    assert.match(err.join(""), /--thinking must be one of off, minimal, low, medium, high, xhigh, max/);
    assert.deepEqual(out, []);
  });
});

/**
 * Parity with `run`, which refuses an ambient level it cannot honour rather
 * than quietly downgrading to "off" (see thinking-flag.test.ts). Resume reads
 * the same variable now, so it owes the same refusal — including on paths that
 * build no executor, where the alternative is a rule that changes with the
 * checkpoint's shape.
 */
test("resume refuses an unusable PI_THINKING_LEVEL", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    process.env.PI_THINKING_LEVEL = "ultra";
    const { io, err } = capture();
    const code = await main(["resume", "--run", runId, "--state-root", stateRoot], io);
    assert.equal(code, 1);
    assert.match(err.join(""), /PI_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, max/);
    assert.equal(parseCliErrorJson(err.join(""))?.command, "resume");
  });
});

test("resume accepts --primary-model and --thinking and still rebuilds the checkpoint", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      [
        "resume",
        "--run",
        runId,
        "--state-root",
        stateRoot,
        "--primary-model",
        "openai/gpt-5",
        "--thinking",
        "high"
      ],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /checkpoint rebuilt/);
    // This resume builds no executor at all, so the flags did nothing — saying
    // so is the whole point: they used to be rejected by parseArgs.
    assert.match(err.join(""), /resume ignored --primary-model\/--thinking/);
    assert.match(err.join(""), /rebuilds no executor/);
  });
});

test("resume without the flags stays quiet on the paths that cannot use them", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    const { io, err } = capture();
    assert.equal(await main(["resume", "--run", runId, "--state-root", stateRoot], io), 0);
    assert.deepEqual(err, []);
  });
});

test("resume discloses that a fake executor ignores the requested config", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startFlowchartRun(stateRoot, projectRoot);
    const { io, out, err } = capture();
    const code = await main(
      [
        "resume",
        "--run",
        runId,
        "--state-root",
        stateRoot,
        "--executor",
        "fake",
        "--thinking",
        "high"
      ],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /COMPLETED/);
    assert.match(err.join(""), /resume ignored --primary-model\/--thinking/);
    assert.match(err.join(""), /fake-children executor/);
  });
});

/**
 * The disclosure has to land before the executor is built, or a resume that
 * fails to build one would say nothing about the configuration it was going to
 * use. With no provider configured, `--executor pi` cannot be built at all —
 * which makes this the offline way to prove the ordering.
 */
test("resume warns about the default rebuild before it tries to build the pi executor", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await startPlainRun(stateRoot, projectRoot);
    const { io, err } = capture();
    const code = await main(
      ["resume", "--run", runId, "--state-root", stateRoot, "--supervised", "--executor", "pi"],
      io
    );
    assert.equal(code, 1);
    const text = err.join("");
    assert.match(text, /resume rebuilt the pi executor on defaults/);
    assert.match(text, /thinking off/);
    assert.match(text, /not recorded/);
    assert.ok(
      text.indexOf("on defaults") < text.indexOf("requires an enabled primary model"),
      `the disclosure must precede the build failure: ${text}`
    );
  });
});

test("resume reports the pi configuration it was asked for", () => {
  const notice = describeResumeExecutorConfig({
    kind: "pi",
    primaryModelFlag: "anthropic/claude-x",
    modelOverride: { providerId: "anthropic", modelId: "claude-x" },
    thinkingFlag: "high",
    thinkingLevel: "high"
  });
  assert.match(notice ?? "", /^note: /);
  assert.match(notice ?? "", /primary model anthropic\/claude-x/);
  assert.match(notice ?? "", /thinking high/);
  // Honest about what it does not know: these are the operator's values, not
  // the ones the run started with.
  assert.match(notice ?? "", /not recorded/);
});

test("an alias --primary-model is disclosed as not pinning a channel", () => {
  const notice = describeResumeExecutorConfig({
    kind: "pi",
    primaryModelFlag: "premium",
    modelOverride: undefined,
    thinkingFlag: undefined,
    thinkingLevel: "off"
  });
  // `run` treats a non provider/model value the same way (aliases resolve
  // downstream), so resume must not claim it pinned the executor to it.
  assert.match(notice ?? "", /primary model premium \(not a provider\/model pair/);
});

test("only a pi rebuild without flags is warned about; the quiet cases stay quiet", () => {
  assert.equal(
    describeResumeExecutorConfig({
      kind: undefined,
      primaryModelFlag: undefined,
      modelOverride: undefined,
      thinkingFlag: undefined,
      thinkingLevel: "off"
    }),
    undefined
  );
  assert.equal(
    describeResumeExecutorConfig({
      kind: "fake-children",
      primaryModelFlag: undefined,
      modelOverride: undefined,
      thinkingFlag: undefined,
      thinkingLevel: "off"
    }),
    undefined
  );
  assert.match(
    describeResumeExecutorConfig({
      kind: "pi",
      primaryModelFlag: undefined,
      modelOverride: undefined,
      thinkingFlag: undefined,
      thinkingLevel: "off"
    }) ?? "",
    /^warning: resume rebuilt the pi executor on defaults/
  );
});

test("usage documents the resume flags", async () => {
  const { io, out } = capture();
  assert.equal(await main(["help"], io), 0);
  const usage = out.join("");
  assert.match(usage, /resume --run <runId>.*\[--primary-model <id>\] \[--thinking <level>\]/);
  assert.match(usage, /executor configuration is\nnot recorded/);
});

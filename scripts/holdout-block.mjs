#!/usr/bin/env node
/**
 * F6 paired-block runner (decision package §2.2, 2026-09-04). Executes ONE
 * sealed taskSpec under BOTH routing arms from the same immutable base commit,
 * each arm in its own disposable git worktree with its own state root — the
 * clean-room isolation the adversarial review demanded.
 *
 *   node scripts/holdout-block.mjs \
 *     --spec <taskSpec.json> --base-commit <sha> --out <block.json> \
 *     --seed <n> [--observations <r1-observations.json>] [--executor pi|fake]
 *
 * Arms:
 *   R0  — the live CLI default (static ModelRouter), run as-is.
 *   R1  — routeR1 computed OFFLINE (experiments plane; the live path never
 *         imports R1), then materialized as a --flowchart with the chosen
 *         model pinned in modelPolicy. Cold-start R1 falls back to the R0
 *         baseline by design (routeR1.fallback), which is recorded.
 *
 * The block record carries per-arm run id, outcome, invocation rows (with
 * executorClass + cacheHit), and the arm-order randomization. It FAILS CLOSED
 * (exit 1, no block written) if any invocation row is not executorClass "pi"
 * when --executor pi was requested — provenance is programmatic, not grepped.
 *
 * --executor fake exists ONLY to shake out the harness itself (Week-0 smoke).
 * Fake-arm blocks are simulation class and must never enter the F-PROD sample.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const specPath = flag("spec");
const baseCommit = flag("base-commit");
const outPath = flag("out");
const seedText = flag("seed");
const observationsPath = flag("observations");
const executor = flag("executor") ?? "pi";

if (specPath === undefined || baseCommit === undefined || outPath === undefined || seedText === undefined) {
  console.error("usage: holdout-block --spec <file> --base-commit <sha> --out <block.json> --seed <n> [--observations <file>] [--executor pi|fake]");
  process.exit(2);
}
if (executor !== "pi" && executor !== "fake") {
  console.error(`--executor must be pi or fake, got ${executor}`);
  process.exit(2);
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const specBody = await readFile(specPath);
const specHash = createHash("sha256").update(specBody).digest("hex");
const spec = JSON.parse(specBody.toString("utf8"));

// Committed-seed arm order: hash(seed || specHash) bit 0 decides which arm runs
// first. Deterministic, reproducible, and pre-registerable.
const orderSeed = createHash("sha256").update(`${seedText}|${specHash}`).digest();
const r0First = (orderSeed[0] & 1) === 0;

const cli = join(repoRoot, "dist", "cli", "main.js");

async function runArm(arm, worktree, stateRoot, flowchartPath) {
  const runArgs = [
    cli, "run",
    "--project", worktree,
    "--objective", `F6 holdout block (${arm} arm)`,
    "--executor", executor,
    "--state-root", stateRoot
  ];
  if (flowchartPath !== undefined) {
    runArgs.push("--flowchart", flowchartPath);
  } else {
    runArgs.push("--children", join(worktree, ".holdout-spec.json"));
  }
  // Ambient PI_* overrides from the host session (e.g. an agent harness's
  // PI_PROVIDER/PI_MODEL) must never leak into an arm: the CLI's env
  // compatibility override would silently re-route the block. Provider
  // credential variables (XHH_API_KEY etc.) pass through; routing-affecting
  // variables do not.
  const armEnv = { ...process.env };
  for (const key of ["PI_PROVIDER", "PI_MODEL", "PI_API_KEY", "PI_FAST_MODEL", "PI_THINKING_LEVEL"]) {
    delete armEnv[key];
  }
  let stdout;
  let stderr = "";
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, runArgs, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1_800_000,
      env: armEnv
    });
  } catch (error) {
    code = typeof error.status === "number" ? error.status : 1;
    stdout = String(error.stdout ?? "");
    stderr = String(error.stderr ?? "");
  }
  if (code !== 0 && stderr !== "") {
    console.error(`  ${arm} arm stderr (first 400 chars): ${stderr.slice(0, 400)}`);
  }
  const runIdMatch = /Run (run_[0-9a-f-]+):/.exec(stdout);
  // The id line prints twice (started, then terminal); the terminal status is
  // the LAST "Run <id>: <STATUS>" line.
  const statusMatches = [...stdout.matchAll(/Run run_[0-9a-f-]+: (\w+)/g)];
  const statusMatch = statusMatches[statusMatches.length - 1];
  const invocationsPath = join(stateRoot, "runtime", "invocations.jsonl");
  let invocations = [];
  try {
    invocations = (await readFile(invocationsPath, "utf8"))
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch { /* no invocations written */ }
  return {
    arm,
    runId: runIdMatch?.[1],
    status: statusMatch?.[1] ?? "UNKNOWN",
    exitCode: code,
    invocations
  };
}

// R1 offline assignment (experiments plane). Returns undefined when the R1
// decision falls back to the R0 baseline — the block then records fallback and
// the R1 arm runs the same model, which is the honest cold-start outcome.
async function r1FlowchartFor(worktree) {
  const { routeR0 } = await import(pathToFileURL(join(repoRoot, "dist", "routing", "r0.js")).href);
  const { routeR1 } = await import(pathToFileURL(join(repoRoot, "dist", "routing", "r1.js")).href);
  const observations = observationsPath !== undefined
    ? JSON.parse(await readFile(observationsPath, "utf8"))
    : [];
  const task = (spec.tasks ?? [])[0];
  if (task === undefined) throw new Error("spec has no tasks[0]");
  const catalogIds = spec.allowedModels ?? [];
  if (catalogIds.length === 0) throw new Error("spec.allowedModels (catalog ids) is required for the R1 arm");
  // Minimal well-formed descriptors: the block runner's job is arm
  // assignment, not cost estimation — prices come from the live catalog when
  // the flowchart runs. Costs here are placeholders so eligibility works.
  const models = catalogIds.map((id) => ({
    modelId: id,
    providerId: id.split("/")[0] ?? id,
    version: `${id}-holdout`,
    capabilities: [],
    providerPolicy: "approved",
    inputCostPerMTok: 1,
    outputCostPerMTok: 1,
    latencyMsPer1K: 1000,
    approvedForHighRisk: true
  }));
  const request = {
    taskFamily: "holdout",
    privacyRequired: "none",
    requiredCapabilities: [],
    contextNeeded: 0,
    outputNeeded: 0,
    budgetUsd: Number.MAX_SAFE_INTEGER,
    deadlineMs: Number.MAX_SAFE_INTEGER,
    highRisk: false,
    fixedCostUsd: 1,
    fixedLatencyMs: 1000
  };
  const r0 = routeR0(
    { confidenceGate: 0.7, cascade: false, policyVersion: "holdout-r0-v1" },
    models,
    request
  );
  const r1 = routeR1({
    r0,
    role: "actor",
    featureVersion: "holdout-block-v1",
    models,
    observations,
    nowMs: Date.now()
  });
  const chosen = r1.selection ?? r0.selection;
  if (chosen === undefined) throw new Error("no eligible model for the R1 arm");
  const flowchart = {
    id: "flw_holdout_block",
    nodes: [{
      id: "task",
      taskId: task.id,
      role: "actor",
      objective: task.objective,
      modelPolicy: { allowedModels: models.map((model) => model.modelId), preferredModel: chosen },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }],
    edges: []
  };
  const flowchartPath = join(worktree, ".holdout-flowchart.json");
  await writeFile(flowchartPath, JSON.stringify(flowchart, null, 2), "utf8");
  return { flowchartPath, r1: { selection: r1.selection, fallback: r1.fallback, reason: r1.reason } };
}

const worktrees = [];
try {
  // Stage the spec into both worktrees (it is custodian-revealed at schedule
  // time; the file lives only inside the disposable worktree).
  const arms = r0First ? ["R0", "R1"] : ["R1", "R0"];
  const results = [];
  for (const arm of arms) {
    const worktree = await mkdtemp(join(tmpdir(), `holdout-${arm.toLowerCase()}-`));
    worktrees.push(worktree);
    execFileSync("git", ["worktree", "add", "--detach", worktree, baseCommit], { cwd: repoRoot, stdio: "pipe" });
    execFileSync("git", ["-C", worktree, "checkout", "--detach", baseCommit], { stdio: "pipe" });
    await writeFile(join(worktree, ".holdout-spec.json"), specBody);
    const stateRoot = await mkdtemp(join(tmpdir(), `holdout-state-${arm.toLowerCase()}-`));
    worktrees.push(stateRoot);
    let flowchartPath;
    let r1Info;
    if (arm === "R1") {
      ({ flowchartPath, r1: r1Info } = await r1FlowchartFor(worktree));
    }
    const result = await runArm(arm, worktree, stateRoot, flowchartPath);
    results.push({ ...result, ...(r1Info !== undefined ? { r1: r1Info } : {}) });
  }

  // Provenance gate: with --executor pi, every row must be executorClass "pi".
  if (executor === "pi") {
    for (const result of results) {
      for (const row of result.invocations) {
        if (row.executorClass !== "pi") {
          console.error(`PROVENANCE FAILURE: ${result.arm} arm row ${row.id} has executorClass ${JSON.stringify(row.executorClass)} — block rejected`);
          process.exit(1);
        }
      }
    }
  }

  const block = {
    version: 1,
    blockId: `blk_${randomUUID()}`,
    specHash,
    baseCommit,
    seed: seedText,
    armOrder: arms,
    executor,
    evidenceClass: (() => {
      if (executor !== "pi") return "simulation";
      // Collector/config failure (no invocations and no real terminal status) is
      // not an experimental outcome — demote so empty arms cannot enter F-PROD.
      // Real task failures that still wrote invocation rows stay eligible.
      const harnessOnly = results.every(
        (result) =>
          result.invocations.length === 0 &&
          (result.status === "UNKNOWN" || result.runId === undefined)
      );
      return harnessOnly ? "harness-failure" : "production-candidate";
    })(),
    executedAt: new Date().toISOString(),
    arms: results.map(({ arm, runId, status, exitCode, r1, invocations }) => ({
      arm,
      runId,
      status,
      exitCode,
      ...(r1 !== undefined ? { r1 } : {}),
      invocationCount: invocations.length,
      cacheHits: invocations.filter((row) => row.cacheHit === true).length,
      tokensIn: invocations.reduce((sum, row) => sum + (row.tokensIn ?? 0), 0),
      tokensOut: invocations.reduce((sum, row) => sum + (row.tokensOut ?? 0), 0),
      callOutcomes: invocations.map((row) => row.callOutcome ?? "unknown")
    }))
  };
  await writeFile(outPath, JSON.stringify(block, null, 2) + "\n", "utf8");
  console.log(`block ${block.blockId} (${block.evidenceClass}) -> ${outPath}`);
  for (const armResult of block.arms) {
    console.log(`  ${armResult.arm}: ${armResult.status} invocations=${armResult.invocationCount} cacheHits=${armResult.cacheHits}`);
  }
} finally {
  for (const path of worktrees) {
    try {
      execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", path], { stdio: "pipe" });
    } catch { /* state roots are not worktrees */ }
    await rm(path, { recursive: true, force: true });
  }
}

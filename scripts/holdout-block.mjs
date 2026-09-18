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
import { classifyHoldoutBlockEvidenceClass } from "./lib/holdout-block-evidence.mjs";

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
const priceTableFlag = flag("price-table");
const nowMsFlag = flag("now-ms");

if (specPath === undefined || baseCommit === undefined || outPath === undefined || seedText === undefined || nowMsFlag === undefined) {
  console.error("usage: holdout-block --spec <file> --base-commit <sha> --out <block.json> --seed <n> --now-ms <n> [--observations <file>] [--executor pi|fake] [--price-table <file>]");
  process.exit(2);
}
if (executor !== "pi" && executor !== "fake") {
  console.error(`--executor must be pi or fake, got ${executor}`);
  process.exit(2);
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const priceTablePath = priceTableFlag ?? join(repoRoot, "holdout", "price-table-v1.json");
const frozenNowMs = nowMsFlag !== undefined ? Number(nowMsFlag) : undefined;
if (nowMsFlag !== undefined && !Number.isFinite(frozenNowMs)) {
  console.error(`--now-ms must be a finite number, got ${nowMsFlag}`);
  process.exit(2);
}
const specBody = await readFile(specPath);
const specHash = createHash("sha256").update(specBody).digest("hex");
const spec = JSON.parse(specBody.toString("utf8"));

// Pre-flight the spec against the same vocabulary the CLI will enforce, so a
// malformed taskSpec dies here — before two worktrees are provisioned and an
// arm burns its schedule slot on a validation exit.
const specProblems = [];
for (const [index, task] of (spec.tasks ?? []).entries()) {
  if (typeof task.id !== "string" || !/^tsk_[A-Za-z0-9_-]{1,64}$/.test(task.id)) {
    specProblems.push(`tasks[${index}].id ${JSON.stringify(task.id)} is not a TaskId (needs the tsk_ prefix, src/domain/ids.ts)`);
  }
  if (typeof task.role !== "string" || !["worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"].includes(task.role)) {
    specProblems.push(`tasks[${index}].role ${JSON.stringify(task.role)} is not a known AgentRole (src/domain/roles.ts)`);
  }
  if (typeof task.objective !== "string" || task.objective.trim() === "") {
    specProblems.push(`tasks[${index}].objective is empty`);
  }
}
if ((spec.tasks ?? []).length === 0) specProblems.push("spec.tasks is empty");
if (!Array.isArray(spec.allowedModels) || spec.allowedModels.length === 0) {
  specProblems.push("spec.allowedModels (catalog ids) is required for the R1 arm");
}
if (specProblems.length > 0) {
  console.error(`spec preflight failed:\n  ${specProblems.join("\n  ")}`);
  process.exit(2);
}

// PS-P4: full taskSpec validate (family, multi-task shape) before worktrees.
{
  const { validateHoldoutTaskSpec } = await import(
    pathToFileURL(join(repoRoot, "dist", "experiments", "task-spec.js")).href
  );
  try {
    validateHoldoutTaskSpec(spec);
  } catch (error) {
    console.error(`spec validate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

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

// R1 offline assignment via PS-P4 compileEquivalentArms (experiments plane).
// Full multi-task flowchart; real price table; injectable clock; family from spec.
async function r1FlowchartFor(worktree) {
  const { validateHoldoutTaskSpec, compileEquivalentArms, modelDescriptorsFromPriceTable } =
    await import(pathToFileURL(join(repoRoot, "dist", "experiments", "task-spec.js")).href);
  const observations = observationsPath !== undefined
    ? JSON.parse(await readFile(observationsPath, "utf8"))
    : [];
  const priceTable = JSON.parse(await readFile(priceTablePath, "utf8"));
  const validated = validateHoldoutTaskSpec(spec);
  const catalog = modelDescriptorsFromPriceTable(validated.allowedModels, priceTable);
  if (frozenNowMs === undefined) {
    throw new Error("PS-P4: --now-ms is required for sealed R1 compile (no wall Date.now)");
  }
  const compiled = compileEquivalentArms({
    spec: validated,
    catalog,
    nowMs: frozenNowMs,
    observations,
    featureVersion: "holdout-block-v1"
  });
  const flowchartPath = join(worktree, ".holdout-flowchart.json");
  await writeFile(flowchartPath, JSON.stringify(compiled.r1.flowchart, null, 2), "utf8");
  const r1 = compiled.r1.decision;
  return {
    flowchartPath,
    r1: { selection: r1.selection, fallback: r1.fallback, reason: r1.reason },
    compiled: {
      taskFamily: compiled.shared.taskFamily,
      taskCount: compiled.shared.tasks.length,
      specHash: compiled.shared.specHash,
      nowMs: compiled.shared.nowMs
    }
  };
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
    // Collector/config failure (no invocations and no real terminal status) is
    // not an experimental outcome — demote so empty arms cannot enter F-PROD.
    // Real task failures that still wrote invocation rows stay eligible.
    evidenceClass: classifyHoldoutBlockEvidenceClass({ executor, results }),
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

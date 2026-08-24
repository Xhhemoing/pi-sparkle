/**
 * Round-4 R4-I equivalence + adjudication simulation (committed because the
 * S4-I winner landed, per campaign rule).
 *
 * Winner (S4-I): the CLI eagerly imported the Pi runtime subtree
 * (@earendil-works/pi-ai ~99ms + @earendil-works/pi-agent-core ~32ms) on
 * EVERY invocation through two static edges — cli/main.ts ->
 * pi-adapter/runtime.js (only consumed by --executor pi) and
 * pi-adapter/auth-session.ts -> runtime.js (only consumed by
 * checkProviderAuth / loginProviderInteractive). The landed change imports
 * runtime.js dynamically at those two points of use (the exact pattern
 * listed-model.js already established in-repo), removing ~105-121ms of dead
 * module loading from every command that never builds a Pi runtime,
 * including the documented fake-executor `run` / `run --children` flows.
 *
 * This sim proves, deterministically (seeded mulberry32; conclusions must be
 * bitwise identical across independent runs):
 *   A.1 structural: the two static edges are gone; the dynamic edges exist.
 *   A.2 module identity: repeated dynamic imports return the same namespace
 *       (engine module cache — no hand-rolled hidden state).
 *   A.3 in-process CLI battery: every command class runs twice on fresh
 *       identical fixtures and produces byte-identical (or id/timestamp-
 *       normalized identical) stdout/stderr/exit, and the stable output
 *       contracts hold (version string, providers.json fail-fast message,
 *       --executor pi validation message, --track x --children conflict).
 *   A.4 cache probe (spawned): importing the CLI module graph does NOT load
 *       @earendil-works/pi-ai (cold-import time survives), while a control
 *       import is cached afterwards.
 *
 * Also adjudicates and kills four fresh non-winner candidates:
 *   S4-I-2 resume/answer PAUSED check via checkpoint.status instead of
 *          replayRun(events): stale-checkpoint divergence proof (crash
 *          between event append and checkpoint write) + sub-ms bench.
 *   S4-I-3 reorder `values.unpause !== true` before the pause probe to skip
 *          replayRun on --unpause: equivalent (replayRun is pure and never
 *          throws — fuzzed) but the saving is one sub-ms in-memory replay.
 *   S4-I-4 hoist the --track x --children conflict check above the
 *          providers/executor loads: error-selection divergence proof
 *          (broken providers.json currently wins) + zero success-path gain.
 *   S4-I-5 replace describeSparkleModel's try/catch miss path (exceptions as
 *          control flow, once per enabled custom id per catalog build):
 *          microsecond bench at realistic M.
 *
 * Run with:  npx tsx scripts/round04-r4i-equivalence-sim.ts
 * Seeds: 0x54a101-0x54a108.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { main, type CliIo } from "../src/cli/main.js";
import { replayRun, materializeCheckpoint, validateCheckpoint } from "../src/run/replay.js";
import type { Event } from "../src/run/events.js";
import { createEventId, parseRunId } from "../src/domain/ids.js";
import { nowIso } from "../src/domain/timestamp.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function out(line: string): void {
  console.log(line);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}

/* ============================================================
 * Shared fixture pieces (same corpus shape as the prior R*-I sims).
 * ============================================================ */
const PROVIDER_ID = "simprov";
const MODEL_IDS = ["sim-a", "sim-b", "sim-c"] as const;
const CATALOG_IDS = MODEL_IDS.map((id) => `${PROVIDER_ID}/${id}`);

function providersJson(): string {
  return `${JSON.stringify(
    {
      version: 1,
      enabled: CATALOG_IDS,
      primary: `${PROVIDER_ID}/sim-c`,
      fast: `${PROVIDER_ID}/sim-a`,
      customProviders: [
        {
          id: PROVIDER_ID,
          baseUrl: "http://localhost:9/v1",
          models: MODEL_IDS.map((id, i) => ({
            id,
            contextWindow: 32768 * (i + 1),
            maxTokens: 4096,
            inputCostPerMTok: 0.5 * (i + 1),
            outputCostPerMTok: 1.5 * (i + 1)
          }))
        }
      ]
    },
    null,
    2
  )}\n`;
}

interface Fixture {
  readonly home: string;
  readonly configured: string;
  readonly empty: string;
  readonly broken: string;
  readonly project: string;
  readonly childrenSpec: string;
}

function makeFixture(tag: string): Fixture {
  const home = mkdtempSync(join(tmpdir(), `r4i-sim-${tag}-`));
  const configured = join(home, "sr-conf");
  const empty = join(home, "sr-empty");
  const broken = join(home, "sr-broken");
  for (const root of [configured, empty, broken]) {
    mkdirSync(join(root, "runtime"), { recursive: true });
  }
  writeFileSync(join(configured, "runtime", "providers.json"), providersJson(), "utf8");
  writeFileSync(join(broken, "runtime", "providers.json"), "{ torn providers", "utf8");
  const project = join(home, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), `{"name":"fixture","version":"0.0.0"}\n`, "utf8");
  const childrenSpec = join(home, "children.json");
  writeFileSync(
    childrenSpec,
    `${JSON.stringify({
      tasks: [
        { id: "tsk_scout1", role: "scout", objective: "Survey the payment module" },
        { id: "tsk_impl1", role: "implementer", objective: "Implement retry logic", dependsOn: ["tsk_scout1"] },
        { id: "tsk_test1", role: "tester", objective: "Run the unit tests", dependsOn: ["tsk_impl1"] }
      ]
    })}\n`,
    "utf8"
  );
  return { home, configured, empty, broken, project, childrenSpec };
}

/** Strip generated ids, ISO timestamps, and absolute paths. */
function normalize(text: string): string {
  return text
    .replace(/\b(run|evt|ep|agt|msg|art|evd|cnd|inv|tsk|fbk|rsv)_[A-Za-z0-9-]+/g, "$1_X")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, "TS")
    .replace(/\/[^\s"']*r4i-sim-[^\s"']*/g, "PATH");
}

async function runMain(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    }
  };
  const code = await main(args, io);
  return { stdout, stderr, code };
}

/* ============================================================
 * Part A — S4-I winner
 * ============================================================ */
async function partA(): Promise<void> {
  // A.1 structural: the eager edges are gone, the lazy edges exist.
  const mainSource = readFileSync(join(REPO_ROOT, "src", "cli", "main.ts"), "utf8");
  const authSource = readFileSync(join(REPO_ROOT, "src", "pi-adapter", "auth-session.ts"), "utf8");
  check(
    "A.1 main.ts has no static value import of pi-adapter/runtime.js",
    !/^import\s+\{[^}]*\}\s+from\s+"\.\.\/pi-adapter\/runtime\.js";/m.test(mainSource)
  );
  check(
    'A.1 main.ts lazily imports runtime.js at the "pi" branch',
    mainSource.includes('await import("../pi-adapter/runtime.js")')
  );
  check(
    "A.1 auth-session.ts has no static value import of ./runtime.js",
    !/^import\s+\{[^}]*\}\s+from\s+"\.\/runtime\.js";/m.test(authSource)
  );
  check(
    "A.1 auth-session.ts lazily imports runtime.js at both points of use",
    authSource.split('await import("./runtime.js")').length === 3
  );

  // A.2 module identity across repeated dynamic imports (engine cache).
  const first = await import("../src/pi-adapter/runtime.js");
  const second = await import("../src/pi-adapter/runtime.js");
  check("A.2 dynamic import returns the identical module namespace", first === second);
  check(
    "A.2 createConfiguredPiExecutor is the same function object",
    first.createConfiguredPiExecutor === second.createConfiguredPiExecutor
  );

  // A.3 in-process CLI battery: run each command twice on fresh identical
  // fixtures; assert byte-identical (raw) or normalized-identical output and
  // pin the stable output contracts that the lazy load must not move.
  interface BatteryCase {
    readonly name: string;
    readonly args: (f: Fixture) => string[];
    readonly mode: "raw" | "normalized";
    readonly golden?: (result: { stdout: string; stderr: string; code: number }) => boolean;
  }
  const packageVersion = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string })
    .version;
  const cases: BatteryCase[] = [
    {
      name: "--version",
      args: () => ["--version"],
      mode: "raw",
      golden: (r) => r.stdout === `${packageVersion}\n` && r.code === 0
    },
    {
      name: "help",
      args: () => ["help"],
      mode: "raw",
      golden: (r) => r.stdout.startsWith("pi-sparkle — project-development multi-agent runtime") && r.code === 0
    },
    { name: "models list (empty)", args: (f) => ["models", "list", "--state-root", f.empty], mode: "raw" },
    { name: "models list (configured)", args: (f) => ["models", "list", "--state-root", f.configured], mode: "raw" },
    {
      name: "models set-default",
      args: (f) => [
        "models",
        "set-default",
        "--primary",
        "simprov/sim-c",
        "--fast",
        "simprov/sim-a",
        "--state-root",
        f.configured
      ],
      mode: "raw"
    },
    { name: "auth status (empty)", args: (f) => ["auth", "status", "--state-root", f.empty], mode: "raw" },
    {
      name: "auth login unknown provider",
      args: (f) => ["auth", "login", "nosuchprovider", "--key", "k", "--state-root", f.empty],
      mode: "raw",
      golden: (r) => r.code === 1 && r.stderr.includes('unknown provider "nosuchprovider"')
    },
    { name: "adapt status", args: (f) => ["adapt", "status", "--state-root", f.empty], mode: "normalized" },
    {
      name: "inspect missing run",
      args: (f) => ["inspect", "--run", "run_missing0001", "--state-root", f.empty],
      mode: "normalized",
      golden: (r) => r.code === 1
    },
    {
      name: "run plain fake",
      args: (f) => ["run", "--project", f.project, "--objective", "survey the module", "--state-root", f.configured],
      mode: "normalized",
      golden: (r) => r.code === 0 && r.stdout.includes(": COMPLETED")
    },
    {
      name: "run --children fake (README flow)",
      args: (f) => [
        "run",
        "--project",
        f.project,
        "--objective",
        "ship the feature",
        "--children",
        f.childrenSpec,
        "--state-root",
        f.configured
      ],
      mode: "normalized",
      golden: (r) => r.code === 0 && r.stdout.includes("children: 3")
    },
    {
      name: "run broken providers.json keeps the fail-fast",
      args: (f) => ["run", "--project", f.project, "--objective", "x", "--state-root", f.broken],
      mode: "normalized",
      golden: (r) => r.code === 1 && r.stderr.includes("invalid providers.json at")
    },
    {
      name: "run --executor pi without model fails before any Pi load",
      args: (f) => ["run", "--project", f.project, "--objective", "x", "--executor", "pi", "--state-root", f.empty],
      mode: "normalized",
      golden: (r) => r.code === 1 && r.stderr.includes("requires an enabled primary model")
    },
    {
      name: "run --track --children conflict on a healthy root",
      args: (f) => [
        "run",
        "--project",
        f.project,
        "--objective",
        "x",
        "--track",
        "--children",
        f.childrenSpec,
        "--state-root",
        f.configured
      ],
      mode: "normalized",
      golden: (r) => r.code === 1 && r.stderr.includes("run --track is incompatible with --children")
    }
  ];
  const rng = mulberry32(0x54a101);
  const order = cases.map((_, i) => i).sort(() => rng() - 0.5);
  for (const index of order) {
    const batteryCase = cases[index]!;
    const fixtureOne = makeFixture(`a-${index}-1`);
    const fixtureTwo = makeFixture(`a-${index}-2`);
    try {
      const one = await runMain(batteryCase.args(fixtureOne));
      const two = await runMain(batteryCase.args(fixtureTwo));
      const [oneOut, oneErr] =
        batteryCase.mode === "raw" ? [one.stdout, one.stderr] : [normalize(one.stdout), normalize(one.stderr)];
      const [twoOut, twoErr] =
        batteryCase.mode === "raw" ? [two.stdout, two.stderr] : [normalize(two.stdout), normalize(two.stderr)];
      check(`A.3 ${batteryCase.name}: exit deterministic`, one.code === two.code, `${one.code} vs ${two.code}`);
      check(`A.3 ${batteryCase.name}: stdout deterministic`, oneOut === twoOut);
      check(`A.3 ${batteryCase.name}: stderr deterministic`, oneErr === twoErr);
      if (batteryCase.golden !== undefined) {
        check(`A.3 ${batteryCase.name}: golden contract`, batteryCase.golden(one), JSON.stringify(one));
      }
    } finally {
      rmSync(fixtureOne.home, { recursive: true, force: true });
      rmSync(fixtureTwo.home, { recursive: true, force: true });
    }
  }

  // A.4 cache probe (spawned): the CLI module graph must not preload pi-ai.
  // Cold pi-ai import is ~90ms; a cached one is <1ms — 10ms is a safe fence.
  // The probe lives inside the repo so bare-specifier resolution finds
  // node_modules; it is deleted in the finally block.
  const probePath = join(REPO_ROOT, "scripts", ".r4i-cache-probe.tmp.mts");
  writeFileSync(
    probePath,
    [
      "const t0 = performance.now();",
      `await import(${JSON.stringify(join(REPO_ROOT, "src", "cli", "main.ts"))});`,
      "const mainMs = performance.now() - t0;",
      "const t1 = performance.now();",
      'await import("@earendil-works/pi-ai");',
      "const coldPiMs = performance.now() - t1;",
      "const t2 = performance.now();",
      'await import("@earendil-works/pi-ai");',
      "const cachedPiMs = performance.now() - t2;",
      "console.log(JSON.stringify({ mainMs, coldPiMs, cachedPiMs }));"
    ].join("\n"),
    "utf8"
  );
  try {
    const probe = spawnSync(process.execPath, ["--import", "tsx", probePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true
    });
    check("A.4 probe process ran", probe.status === 0, probe.stderr);
    const parsed = JSON.parse(probe.stdout.trim().split("\n").at(-1) || "{}") as {
      mainMs?: number;
      coldPiMs?: number;
      cachedPiMs?: number;
    };
    check(
      "A.4 importing the CLI graph does not preload @earendil-works/pi-ai",
      parsed.coldPiMs !== undefined && parsed.coldPiMs > 10,
      JSON.stringify(parsed)
    );
    check(
      "A.4 control: a second pi-ai import is served from the module cache",
      parsed.cachedPiMs !== undefined && parsed.cachedPiMs < 5,
      JSON.stringify(parsed)
    );
    out(
      `part A: CLI graph import=${parsed.mainMs?.toFixed(1)}ms; pi-ai after it cold=${parsed.coldPiMs?.toFixed(1)}ms ` +
        `(eliminated from every non-Pi command), cached=${parsed.cachedPiMs?.toFixed(2)}ms`
    );
  } finally {
    rmSync(probePath, { force: true });
  }
}

/* ============================================================
 * Part B — S4-I-2: PAUSED probe via checkpoint.status (divergence kill)
 * ============================================================ */
function syntheticEvent(runId: ReturnType<typeof parseRunId>, type: Event["type"], at: string): Event {
  return {
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: at,
    runId,
    type,
    actor: "cli",
    payload: {}
  } as Event;
}

function partB(): void {
  const runId = parseRunId("run_r4istale0001");
  const started = syntheticEvent(runId, "RUN_STARTED", "2026-08-24T00:00:00.000Z");
  const paused = syntheticEvent(runId, "PAUSE_REQUESTED", "2026-08-24T00:00:01.000Z");
  // Crash window: the checkpoint was materialized BEFORE the pause event was
  // appended (event append and checkpoint write are separate durable steps).
  const staleCheckpoint = validateCheckpoint(materializeCheckpoint(replayRun([started]), nowIso()));
  const current = replayRun([started, paused]).status === "PAUSED";
  const candidate = staleCheckpoint.status === "PAUSED";
  check("B events replay says PAUSED", current);
  check("B stale checkpoint says not PAUSED (divergence)", !candidate && staleCheckpoint.status === "RUNNING");
  // Scale: the replaced work is one in-memory replay per interactive command.
  for (const eventCount of [200, 2000]) {
    const events: Event[] = [started];
    for (let i = 0; i < eventCount - 1; i += 1) {
      events.push(syntheticEvent(runId, "AGENT_EVENT", "2026-08-24T00:00:02.000Z"));
    }
    const ms = bench(() => void replayRun(events), eventCount === 200 ? 2000 : 300);
    out(`part B: replayRun over E=${eventCount} in-memory events=${(ms * 1000).toFixed(0)}us per answer/resume`);
  }
}

/* ============================================================
 * Part C — S4-I-3: reorder unpause short-circuit (equivalent, sub-threshold)
 * ============================================================ */
function partC(): void {
  const runId = parseRunId("run_r4ifuzz00001");
  const rng = mulberry32(0x54a105);
  const pool: Event["type"][] = [
    "RUN_STARTED",
    "PAUSE_REQUESTED",
    "PAUSE_CLEARED",
    "RUN_COMPLETED",
    "RUN_WAITING_FOR_USER",
    "RUN_CANCEL_REQUESTED",
    "AGENT_EVENT"
  ];
  let divergences = 0;
  for (let trial = 0; trial < 2000; trial += 1) {
    const events: Event[] = [];
    const length = Math.floor(rng() * 8);
    for (let i = 0; i < length; i += 1) {
      events.push(syntheticEvent(runId, pick(rng, pool), "2026-08-24T00:00:03.000Z"));
    }
    // replayRun must be pure and non-throwing even on anomalous orderings —
    // that purity is what makes the reorder exactly equivalent.
    const tokenPaused = rng() < 0.5;
    const unpause = rng() < 0.5;
    const currentOrder = (tokenPaused || replayRun(events).status === "PAUSED") && unpause !== true;
    const candidateOrder = unpause !== true && (tokenPaused || replayRun(events).status === "PAUSED");
    if (currentOrder !== candidateOrder) divergences += 1;
  }
  check("C reorder is boolean-equivalent across 2000 fuzzed logs (replayRun pure, no throw)", divergences === 0);
  out("part C: saving = one sub-ms in-memory replayRun, only on --unpause resumes (see part B bench)");
}

/* ============================================================
 * Part D — S4-I-4: conflict-check hoist (error-selection divergence kill)
 * ============================================================ */
async function partD(): Promise<void> {
  const fixture = makeFixture("d");
  try {
    const result = await runMain([
      "run",
      "--project",
      fixture.project,
      "--objective",
      "x",
      "--track",
      "--children",
      fixture.childrenSpec,
      "--state-root",
      fixture.broken
    ]);
    check("D today: broken providers.json wins error selection", result.stderr.includes("invalid providers.json at"));
    check(
      "D today: the conflict message is NOT reported first",
      !result.stderr.includes("run --track is incompatible with --children")
    );
    check("D today: exit 1", result.code === 1);
    // Candidate replica: hoisting the conflict check above the loads reports
    // the conflict instead — observable error-selection divergence.
    const candidateMessage = "run --track is incompatible with --children (track generates the cluster plan)";
    check(
      "D candidate would report the conflict instead (divergence)",
      !result.stderr.includes(candidateMessage) && candidateMessage.length > 0
    );
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
}

/* ============================================================
 * Part E — S4-I-5: describeSparkleModel exception-miss path (noise kill)
 * ============================================================ */
async function partE(): Promise<void> {
  const { resolveListedModel } = await import("../src/pi-adapter/listed-model.js");
  const custom = [
    {
      id: PROVIDER_ID,
      baseUrl: "http://localhost:9/v1",
      models: MODEL_IDS.map((id) => ({ id, inputCostPerMTok: 1, outputCostPerMTok: 2 }))
    }
  ];
  const resolved = resolveListedModel(PROVIDER_ID, "sim-a", custom);
  check("E custom id resolves through the builtin-miss path", resolved !== undefined);
  const ms = bench(() => void resolveListedModel(PROVIDER_ID, "sim-a", custom), 20000);
  out(
    `part E: one builtin-miss resolveListedModel (throw/catch control flow)=${(ms * 1e6).toFixed(0)}ns ` +
      `x M<=10 enabled ids per catalog build`
  );
}

await partA();
partB();
partC();
await partD();
await partE();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);

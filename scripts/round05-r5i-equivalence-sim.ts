/**
 * Round-5 R5-I equivalence + adjudication simulation (committed because the
 * S5-I-1 winner landed, per campaign rule).
 *
 * Winner (S5-I-1): cli/main.ts statically imported twelve modules that are
 * each reachable from exactly one dispatch branch — the eight one-shot
 * subcommand handlers (cli/auth.js, cli/models.js, cli/adapt.js,
 * cli/episode.js, cli/commits.js, cli/pause.js, cli/inject.js,
 * cli/doctor.js) plus run/supervisor.js (resume --supervised only),
 * track/loop.js (run --track only), preferences/export.js (pref export
 * only) and privacy/deletion.js (delete only). The landed change imports
 * each at its dispatch site (the S4-I point-of-use pattern). Interleaved
 * same-window A/B on this VM: median spawn-to-exit -23..-30ms on every
 * measured command class (--version, run --children default/configured,
 * run --track configured), dominated by an ~15-20ms Node-22 package-scope
 * resolution penalty that the static main.ts -> track/loop.js edge alone
 * re-triggered for every command (CPU profile: getPackageScopeConfig
 * 25.2ms vs 1.0ms self-time).
 *
 * This sim proves, deterministically (seeded mulberry32; check verdicts must
 * be identical across independent runs):
 *   A.1 structural: all twelve static edges are gone; the twelve dynamic
 *       point-of-use edges exist.
 *   A.2 module identity: repeated dynamic imports of all twelve modules, in
 *       seeded shuffled order, return the same namespace objects (engine
 *       module cache — no hand-rolled state, singletons preserved).
 *   A.3 in-process CLI battery: every lazified dispatch branch runs twice on
 *       fresh identical fixtures and produces byte-identical (or id/
 *       timestamp-normalized identical) stdout/stderr/exit, and the stable
 *       output contracts hold (version string, usage texts, cliFail
 *       messages, --track completion).
 *   A.4 load-trace probe (spawned, hook writes synchronously to a file):
 *       importing the CLI graph and dispatching --version loads none of the
 *       twelve modules; dispatching `auth status` then loads cli/auth.ts and
 *       still none of the other eleven.
 *
 * Also adjudicates the fresh non-winner candidates (full data in
 * docs/reports/sota-opt/round-05/R5-I.md):
 *   S5-I-2 variant B (handlers lazy, track/loop kept static): measured
 *          same-window medians sit at baseline (-0..-6ms) — keeping the one
 *          track edge static forfeits the resolver win. Kill is
 *          measurement-based; recorded in the report.
 *   S5-I-3 variant M (only track/loop lazy, handlers kept static): captures
 *          about half the win (-7..-13ms median). Same-window loser vs the
 *          landed set; recorded in the report.
 *   S5-I-4 extending lazification to shared modules (run/replay.js,
 *          preferences/service.js, cli/model-catalog.js, ...): part C proves
 *          these are referenced from multiple always-reachable command
 *          paths, so no dispatch branch can drop them, and the per-module
 *          marginal load is low-ms/µs class — an order below the landing
 *          bar.
 *
 * Run with:  npx tsx scripts/round05-r5i-equivalence-sim.ts
 * Seeds: 0x55a101-0x55a103.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { main, type CliIo } from "../src/cli/main.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}\n`);
  }
}
function out(line: string): void {
  process.stdout.write(`${line}\n`);
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

/** The twelve lazified edges: [specifier in main.ts, path fragment in loads]. */
const LAZY_EDGES: ReadonlyArray<readonly [string, string]> = [
  ["./auth.js", "src/cli/auth.ts"],
  ["./models.js", "src/cli/models.ts"],
  ["./adapt.js", "src/cli/adapt.ts"],
  ["./episode.js", "src/cli/episode.ts"],
  ["./commits.js", "src/cli/commits.ts"],
  ["./pause.js", "src/cli/pause.ts"],
  ["./inject.js", "src/cli/inject.ts"],
  ["./doctor.js", "src/cli/doctor.ts"],
  ["../run/supervisor.js", "src/run/supervisor.ts"],
  ["../track/loop.js", "src/track/loop.ts"],
  ["../preferences/export.js", "src/preferences/export.ts"],
  ["../privacy/deletion.js", "src/privacy/deletion.ts"]
];

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
  readonly project: string;
}

function makeFixture(tag: string): Fixture {
  const home = mkdtempSync(join(tmpdir(), `r5i-sim-${tag}-`));
  const configured = join(home, "sr-conf");
  const empty = join(home, "sr-empty");
  for (const root of [configured, empty]) {
    mkdirSync(join(root, "runtime"), { recursive: true });
  }
  writeFileSync(join(configured, "runtime", "providers.json"), providersJson(), "utf8");
  const project = join(home, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), `{"name":"fixture","version":"0.0.0"}\n`, "utf8");
  return { home, configured, empty, project };
}

/** Strip generated ids, ISO timestamps, and absolute paths. */
function normalize(text: string): string {
  return text
    .replace(/\b(run|evt|ep|agt|msg|art|evd|cnd|inv|tsk|fbk|rsv)_[A-Za-z0-9-]+/g, "$1_X")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, "TS")
    .replace(/\/[^\s"']*r5i-sim-[^\s"']*/g, "PATH");
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
 * Part A — S5-I-1 winner
 * ============================================================ */
async function partA(): Promise<void> {
  // A.1 structural: the twelve eager edges are gone, the lazy edges exist.
  const mainSource = readFileSync(join(REPO_ROOT, "src", "cli", "main.ts"), "utf8");
  for (const [specifier] of LAZY_EDGES) {
    const staticEdge = new RegExp(
      `^import\\s+\\{[^}]*\\}\\s+from\\s+"${specifier.replace(/[./]/g, "\\$&")}";`,
      "m"
    );
    check(`A.1 main.ts has no static value import of ${specifier}`, !staticEdge.test(mainSource));
    check(
      `A.1 main.ts lazily imports ${specifier} at its dispatch site`,
      mainSource.includes(`await import("${specifier}")`)
    );
  }

  // A.2 module identity across repeated dynamic imports (engine cache), in
  // seeded shuffled order — singletons and function identities preserved.
  const rngIdentity = mulberry32(0x55a102);
  const modulePaths = LAZY_EDGES.map(([, fragment]) => join(REPO_ROOT, fragment));
  const firstPass = new Map<string, unknown>();
  for (const path of [...modulePaths].sort(() => rngIdentity() - 0.5)) {
    firstPass.set(path, await import(path));
  }
  let identityHolds = true;
  for (const path of [...modulePaths].sort(() => rngIdentity() - 0.5)) {
    if ((await import(path)) !== firstPass.get(path)) identityHolds = false;
  }
  check("A.2 repeated dynamic imports return identical namespaces for all twelve modules", identityHolds);
  const loopOne = (await import("../src/track/loop.js")).startTrackedRun;
  const loopTwo = (await import("../src/track/loop.js")).startTrackedRun;
  check("A.2 startTrackedRun is the same function object", loopOne === loopTwo);
  const supOne = (await import("../src/run/supervisor.js")).resumeSupervisedRun;
  const supTwo = (await import("../src/run/supervisor.js")).resumeSupervisedRun;
  check("A.2 resumeSupervisedRun is the same function object", supOne === supTwo);

  // A.3 in-process CLI battery: run every lazified dispatch branch twice on
  // fresh identical fixtures; assert byte-identical (raw) or normalized-
  // identical output and pin the stable output contracts.
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
      name: "auth help",
      args: () => ["auth", "help"],
      mode: "raw",
      golden: (r) => r.stdout.startsWith("pi-sparkle auth — per-provider credentials") && r.code === 0
    },
    { name: "auth status (empty)", args: (f) => ["auth", "status", "--state-root", f.empty], mode: "raw" },
    {
      name: "models help",
      args: () => ["models", "help"],
      mode: "raw",
      golden: (r) => r.stdout.startsWith("pi-sparkle models — enable Pi models for routing") && r.code === 0
    },
    { name: "models list (configured)", args: (f) => ["models", "list", "--state-root", f.configured], mode: "raw" },
    { name: "adapt status (empty)", args: (f) => ["adapt", "status", "--state-root", f.empty], mode: "normalized" },
    {
      name: "episode help",
      args: () => ["episode", "help"],
      mode: "raw",
      golden: (r) => r.code === 0
    },
    {
      name: "episode show without --episode",
      args: (f) => ["episode", "show", "--state-root", f.empty],
      mode: "raw",
      golden: (r) => r.code === 1 && r.stderr.includes("episode command requires --episode")
    },
    {
      name: "commits help",
      args: () => ["commits", "help"],
      mode: "raw",
      golden: (r) => r.stdout.startsWith("pi-sparkle commits — decision ledger to conventional commits") && r.code === 0
    },
    {
      name: "commits without subcommand",
      args: () => ["commits"],
      mode: "raw",
      golden: (r) => r.code === 1 && r.stderr.includes("commits requires a subcommand")
    },
    {
      name: "pause without --run",
      args: (f) => ["pause", "--state-root", f.empty],
      mode: "raw",
      golden: (r) => r.code === 1
    },
    {
      name: "inject without --run",
      args: (f) => ["inject", "--state-root", f.empty],
      mode: "raw",
      golden: (r) => r.code === 1
    },
    { name: "doctor (fixture roots)", args: (f) => ["doctor", "--state-root", f.empty, "--project", f.project], mode: "normalized" },
    { name: "pref export", args: () => ["pref", "export"], mode: "normalized" },
    {
      name: "delete missing run",
      args: (f) => ["delete", "--run", "run_missing0001", "--state-root", f.empty],
      mode: "normalized"
    },
    {
      name: "run --track --assume-defaults fake (configured)",
      args: (f) => [
        "run",
        "--project",
        f.project,
        "--objective",
        "ship the tracked feature",
        "--track",
        "--assume-defaults",
        "--executor",
        "fake",
        "--state-root",
        f.configured
      ],
      mode: "normalized",
      golden: (r) => r.code === 0 && r.stdout.startsWith("Run run_")
    },
    {
      name: "resume --supervised missing run",
      args: (f) => ["resume", "--run", "run_missing0001", "--supervised", "--state-root", f.empty],
      mode: "normalized",
      golden: (r) => r.code === 1
    }
  ];
  const rng = mulberry32(0x55a101);
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

  // A.4 load-trace probe (spawned): a customization hook appends every loaded
  // URL to a file synchronously during load, so no message-passing race.
  // Phase 1: import the CLI graph + dispatch --version — none of the twelve
  // lazified modules may load. Phase 2: dispatch `auth status` — cli/auth.ts
  // loads, the other eleven still must not.
  const hookPath = join(REPO_ROOT, "scripts", ".r5i-load-hook.tmp.mjs");
  const probePath = join(REPO_ROOT, "scripts", ".r5i-load-probe.tmp.mts");
  const loadLog = join(REPO_ROOT, "scripts", ".r5i-load-log.tmp.txt");
  writeFileSync(
    hookPath,
    [
      'import { appendFileSync } from "node:fs";',
      "let logPath;",
      "export function initialize(data) { logPath = data.logPath; }",
      "export async function load(url, context, nextLoad) {",
      "  appendFileSync(logPath, `${url}\\n`);",
      "  return nextLoad(url, context);",
      "}"
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    probePath,
    [
      'import { register } from "node:module";',
      'import { mkdtempSync, readFileSync, rmSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      `register(${JSON.stringify(hookPath)}, { parentURL: import.meta.url, data: { logPath: ${JSON.stringify(loadLog)} } });`,
      `const { main } = await import(${JSON.stringify(join(REPO_ROOT, "src", "cli", "main.ts"))});`,
      'const io = { stdout: () => {}, stderr: () => {} };',
      'await main(["--version"], io);',
      `const phase1 = readFileSync(${JSON.stringify(loadLog)}, "utf8");`,
      'const stateRoot = mkdtempSync(join(tmpdir(), "r5i-probe-"));',
      'await main(["auth", "status", "--state-root", stateRoot], io);',
      "rmSync(stateRoot, { recursive: true, force: true });",
      `const phase2 = readFileSync(${JSON.stringify(loadLog)}, "utf8");`,
      "console.log(JSON.stringify({ phase1, phase2 }));"
    ].join("\n"),
    "utf8"
  );
  try {
    writeFileSync(loadLog, "", "utf8");
    const probe = spawnSync(process.execPath, ["--import", "tsx", probePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
    check("A.4 probe process ran", probe.status === 0, probe.stderr.slice(0, 600));
    const parsed = JSON.parse(probe.stdout.trim().split("\n").at(-1) || "{}") as {
      phase1?: string;
      phase2?: string;
    };
    const phase1 = parsed.phase1 ?? "";
    const phase2 = parsed.phase2 ?? "";
    check("A.4 probe traced the CLI graph load", phase1.includes("src/cli/main.ts"));
    for (const [specifier, fragment] of LAZY_EDGES) {
      check(`A.4 --version does not load ${specifier}`, !phase1.includes(fragment));
    }
    check("A.4 auth status loads src/cli/auth.ts", phase2.includes("src/cli/auth.ts"));
    for (const [specifier, fragment] of LAZY_EDGES) {
      if (fragment === "src/cli/auth.ts") continue;
      check(`A.4 auth status still does not load ${specifier}`, !phase2.includes(fragment));
    }
    out(
      `part A: --version load-set excludes all 12 lazified modules; auth dispatch adds only its own subtree ` +
        `(${phase2.split("\n").length - phase1.split("\n").length} module loads)`
    );
  } finally {
    rmSync(hookPath, { force: true });
    rmSync(probePath, { force: true });
    rmSync(loadLog, { force: true });
  }
}

/* ============================================================
 * Part B — dispatch-site overhead: a cached dynamic import is ns-class, so
 * the per-invocation cost the landed change adds on taken branches is noise.
 * ============================================================ */
async function partB(): Promise<void> {
  const first = await import("../src/cli/auth.js");
  const reps = 20000;
  let identical = true;
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) {
    if ((await import("../src/cli/auth.js")) !== first) identical = false;
  }
  const perCall = ((performance.now() - t0) / reps) * 1e3;
  check("B cached dynamic import keeps namespace identity across 20000 calls", identical);
  out(
    `part B: cached await import on a taken dispatch branch=${perCall.toFixed(1)}us per invocation ` +
      `(under tsx hooks; bare node is cheaper) — once per command, noise class`
  );
}

/* ============================================================
 * Part C — S5-I-4 kill: the modules kept static are shared by multiple
 * always-reachable command paths, so no dispatch branch could drop them and
 * point-of-use imports there would buy nothing (per-module marginal load is
 * low-ms class — an order below the landing bar; report has the bench).
 * ============================================================ */
function partC(): void {
  const mainSource = readFileSync(join(REPO_ROOT, "src", "cli", "main.ts"), "utf8");
  const shared: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["../run/replay.js", ["replayRun("]],
    [
      "../preferences/service.js",
      ["configurePreferencePersistence(", "correctPreference(", "deletePreference(", "inspectPreferences("]
    ],
    ["./model-catalog.js", ["buildLiveCatalogConfig(", "createCalibratedCliModelRouter("]]
  ];
  for (const [specifier, callSites] of shared) {
    const stillStatic = mainSource.includes(`from "${specifier}"`);
    const sites = callSites.reduce((sum, callSite) => sum + mainSource.split(callSite).length - 1, 0);
    check(`C ${specifier} stays static and serves multiple paths`, stillStatic && sites >= 2, `sites=${sites}`);
    out(`part C: ${specifier} call sites in main.ts=${sites} (shared; not branch-exclusive)`);
  }
}

await partA();
await partB();
partC();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);

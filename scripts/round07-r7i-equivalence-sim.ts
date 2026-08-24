/**
 * Round-7 R7-I equivalence + adjudication simulation (committed because the
 * S7-I-1 winner landed, per campaign rule).
 *
 * Winner (S7-I-1): the calibrated live-catalog build (cli/model-catalog.ts
 * buildLiveCatalogConfig — shared by run --children, run --track via
 * track/loop.ts, run --flowchart, and the calibrated CLI router) resolved
 * enabled builtin model ids through listed-model.js, whose module top
 * statically imports @earendil-works/pi-ai/providers/all — ~40 provider
 * modules with auth/API machinery (~48-63ms cold on this VM, dominated by
 * ESM resolution/compilation incl. the Node-22.14 getPackageScopeConfig
 * share; the provider JS itself is ~1ms). R4-I's module-graph note
 * mischaracterized this edge as "type-only + point-of-use dynamic", so no
 * prior round ever measured it: every run of a CONFIGURED user (enabled
 * builtin models in providers.json) paid it even with --executor fake,
 * while R1-I's catalog benches used custom-provider fixtures that never
 * touch the builtin tables.
 *
 * The landed change resolves builtin ids through a new async twin
 * (pi-adapter/listed-model-lazy.ts resolveListedModelLazy) that imports only
 * the queried provider's generated model table
 * (@earendil-works/pi-ai/providers/<id>.models — a public exported subpath of
 * pure data; the generated catalog's MODELS[provider] is the same object as
 * that module's single *_MODELS export). Any per-provider miss (unknown or
 * custom provider id, future pi-ai layout change) falls back to the
 * authoritative providers/all getBuiltinModel, and a failure to load
 * providers/all itself propagates exactly like the old static edge.
 * listed-model.ts keeps its public sync surface byte-compatible (shared
 * helpers moved to the leaf module listed-model-common.ts).
 *
 * Interleaved same-window A/B on this VM (median spawn-to-exit, N=15):
 * configured run --children 158ms -> 109ms (-49ms), configured run --track
 * 174ms -> 126ms (-48ms); controls flat (unconfigured children 104->103ms,
 * --version 55->54ms). Full data in docs/reports/sota-opt/round-07/R7-I.md.
 *
 * This sim proves, deterministically (seeded mulberry32; check verdicts must
 * be identical across independent runs):
 *   A.1 structural: model-catalog.ts no longer imports listed-model.js (its
 *       type import moved to listed-model-common.js) and lazily imports
 *       listed-model-lazy.js at the point of use; listed-model-lazy.ts and
 *       listed-model-common.ts have no static value import of pi-ai;
 *       listed-model.ts keeps its providers/all edge for the one-shot
 *       consumers (models/auth/index surface).
 *   B   exhaustive builtin equivalence: for EVERY builtin provider and EVERY
 *       model id in its catalog, resolveListedModelLazy returns a row deeply
 *       equal to resolveListedModel, the per-provider module has exactly one
 *       *_MODELS export, and each table entry is reference-identical to
 *       getBuiltinModel's answer (per-version layout invariant the fallback
 *       guards at runtime).
 *   C   miss/custom/adversarial equivalence in seeded shuffled order:
 *       unknown providers/models, custom hits, custom shadowing a builtin
 *       provider id, empty custom lists, and hostile provider ids
 *       ("all", "..", ".", "", "__proto__"+"constructor", "anthropic.models",
 *       "data/.manifest" shapes) — lazy result === sync result, no throws.
 *   D   load-trace probe (spawned): a builtin-configured
 *       buildLiveCatalogConfig does NOT load providers/all (cold-import
 *       margin probe: importing it afterwards still costs >15ms, vs <15ms
 *       cache-hit when the custom-provider fallback DID load it), and both
 *       fixtures produce exactly the catalog rows the sync resolver implies.
 *   E   in-process CLI battery: run --children on a configured-builtin
 *       fixture twice produces normalized-identical stdout/stderr/exit and
 *       routes to the enabled builtin ids.
 *
 * Also adjudicates the fresh non-winner candidates (full data in
 * docs/reports/sota-opt/round-07/R7-I.md):
 *   S7-I-2 preferences.json sync hydration on every run (bindPreferenceStore
 *          -> configurePreferencePersistence readFileSync + rebuildViews):
 *          store lives out of slice and realistic preference counts are
 *          tens of observations — µs-class read; reject.
 *   S7-I-3 Promise.all over the run-path config reads (providers.json /
 *          public prior / learned routing): S2-J-10 / S4-J-2 / S7-G-5
 *          double-fault-race family, and each read is tens of µs; reject.
 *   S7-I-4 extending per-provider lazy tables to the one-shot consumers
 *          (models enable/set-default, auth): one-shot CLI class is below
 *          the campaign bar by rule; reject.
 *
 * Run with:  npx tsx scripts/round07-r7i-equivalence-sim.ts
 * Seed: 0x77a701.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBuiltinModel,
  getBuiltinModels,
  getBuiltinProviders
} from "@earendil-works/pi-ai/providers/all";
import { resolveListedModel } from "../src/pi-adapter/listed-model.js";
import { resolveListedModelLazy } from "../src/pi-adapter/listed-model-lazy.js";
import type { CustomProviderConfig } from "../src/config/providers-config.js";
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

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/* ============================================================
 * Part A — structural edges
 * ============================================================ */
function partA(): void {
  const catalogSource = readFileSync(join(REPO_ROOT, "src", "cli", "model-catalog.ts"), "utf8");
  check(
    "A.1 model-catalog.ts has no import from listed-model.js",
    !catalogSource.includes(`"../pi-adapter/listed-model.js"`)
  );
  check(
    "A.1 model-catalog.ts lazily imports listed-model-lazy.js at the point of use",
    catalogSource.includes(`await import("../pi-adapter/listed-model-lazy.js")`)
  );
  check(
    "A.1 model-catalog.ts takes SparkleListedModel type from the leaf common module",
    catalogSource.includes(`import type { SparkleListedModel } from "../pi-adapter/listed-model-common.js"`)
  );
  const lazySource = readFileSync(join(REPO_ROOT, "src", "pi-adapter", "listed-model-lazy.ts"), "utf8");
  check(
    "A.1 listed-model-lazy.ts has no static value import of pi-ai",
    !/^import\s+\{[^}]*\}\s+from\s+"@earendil-works\/pi-ai/m.test(lazySource)
  );
  check(
    "A.1 listed-model-lazy.ts falls back to providers/all outside its catch",
    lazySource.includes(`await import("@earendil-works/pi-ai/providers/all")`)
  );
  const commonSource = readFileSync(join(REPO_ROOT, "src", "pi-adapter", "listed-model-common.ts"), "utf8");
  check(
    "A.1 listed-model-common.ts has no static value import of pi-ai",
    !/^import\s+\{[^}]*\}\s+from\s+"@earendil-works\/pi-ai/m.test(commonSource)
  );
  const listedSource = readFileSync(join(REPO_ROOT, "src", "pi-adapter", "listed-model.ts"), "utf8");
  check(
    "A.1 listed-model.ts keeps its authoritative providers/all edge for one-shot consumers",
    /^import\s+\{[^}]*getBuiltinModel[^}]*\}\s+from\s+"@earendil-works\/pi-ai\/providers\/all";/m.test(listedSource)
  );
  out(`part A: structural edges verified (checks=${checks})`);
}

/* ============================================================
 * Part B — exhaustive builtin equivalence
 * ============================================================ */
async function partB(): Promise<void> {
  const providers = getBuiltinProviders();
  check("B providers catalog is non-trivial", providers.length >= 30, `got ${providers.length}`);
  let rows = 0;
  let identical = 0;
  for (const provider of providers) {
    const ns = (await import(`@earendil-works/pi-ai/providers/${provider}.models`)) as Record<
      string,
      unknown
    >;
    const tables = Object.keys(ns).filter((key) => key.endsWith("_MODELS"));
    check(`B provider module ${provider}.models has exactly one *_MODELS export`, tables.length === 1);
    const table = ns[tables[0]!] as Record<string, unknown>;
    for (const model of getBuiltinModels(provider)) {
      rows += 1;
      const sync = resolveListedModel(provider, model.id);
      const lazy = await resolveListedModelLazy(provider, model.id);
      if (JSON.stringify(sync) === JSON.stringify(lazy)) identical += 1;
      else check(`B ${provider}/${model.id} lazy === sync`, false, JSON.stringify({ sync, lazy }));
      if (table[model.id] !== getBuiltinModel(provider, model.id as never)) {
        check(
          `B ${provider}/${model.id} per-provider table entry is reference-identical to MODELS`,
          false
        );
      }
    }
  }
  check("B every builtin row matched", identical === rows, `${identical}/${rows}`);
  out(`part B: ${rows} builtin rows across ${providers.length} providers — lazy===sync for all`);
}

/* ============================================================
 * Part C — miss / custom / adversarial equivalence
 * ============================================================ */
async function partC(): Promise<void> {
  const custom: CustomProviderConfig = {
    id: "simprov",
    baseUrl: "http://localhost:9/v1",
    models: [
      { id: "sim-a", contextWindow: 32768, maxTokens: 4096, inputCostPerMTok: 0.5, outputCostPerMTok: 1.5 },
      { id: "sim-b" }
    ]
  };
  const shadowingAnthropic: CustomProviderConfig = {
    id: "anthropic",
    baseUrl: "http://localhost:9/v1",
    models: [{ id: "not-a-builtin-model-zzz" }]
  };
  const cases: ReadonlyArray<readonly [string, string, readonly CustomProviderConfig[]]> = [
    ["no-such-provider", "no-such-model", []],
    ["anthropic", "no-such-model-zzz", []],
    ["simprov", "sim-a", [custom]],
    ["simprov", "sim-b", [custom]],
    ["simprov", "sim-missing", [custom]],
    ["anthropic", "not-a-builtin-model-zzz", [shadowingAnthropic]],
    ["simprov", "sim-a", []],
    ["all", "gpt-4o-mini", []],
    ["..", "x", []],
    [".", "x", []],
    ["", "x", []],
    ["", "", []],
    ["__proto__", "constructor", []],
    ["constructor", "constructor", []],
    ["anthropic.models", "x", []],
    ["data/.manifest", "x", []],
    ["providers/all", "x", []]
  ];
  const rand = mulberry32(0x77a701);
  for (const [provider, model, customs] of shuffled(cases, rand)) {
    let sync: unknown;
    let syncThrew = false;
    try {
      sync = resolveListedModel(provider, model, customs);
    } catch {
      syncThrew = true;
    }
    let lazy: unknown;
    let lazyThrew = false;
    try {
      lazy = await resolveListedModelLazy(provider, model, customs);
    } catch {
      lazyThrew = true;
    }
    check(
      `C (${JSON.stringify(provider)}, ${JSON.stringify(model)}, customs=${customs.length}) equivalence`,
      syncThrew === lazyThrew && JSON.stringify(sync) === JSON.stringify(lazy),
      JSON.stringify({ syncThrew, lazyThrew, sync, lazy })
    );
  }
  out(`part C: ${cases.length} miss/custom/adversarial cases — lazy===sync for all (seeded order)`);
}

/* ============================================================
 * Part D — spawned load-trace probe
 * ============================================================ */
const PROBE_SOURCE = `
import { buildLiveCatalogConfig } from "${REPO_ROOT.replace(/\\/g, "/")}/src/cli/model-catalog.js";
const stateRoot = process.argv[2];
const catalog = await buildLiveCatalogConfig(stateRoot);
const t0 = performance.now();
await import("@earendil-works/pi-ai/providers/all");
const allImportMs = performance.now() - t0;
process.stdout.write(JSON.stringify({ allImportMs, ids: catalog.models.map((m) => m.id) }));
`;

function providersJson(enabled: readonly string[], customProviders: readonly CustomProviderConfig[]): string {
  return `${JSON.stringify(
    {
      version: 1,
      enabled,
      primary: enabled[0],
      fast: enabled[enabled.length - 1],
      customProviders
    },
    null,
    2
  )}\n`;
}

function makeStateRoot(home: string, tag: string, providers: string): string {
  const root = join(home, tag);
  mkdirSync(join(root, "runtime"), { recursive: true });
  writeFileSync(join(root, "runtime", "providers.json"), providers, "utf8");
  return root;
}

function runProbe(stateRoot: string, probePath: string): { allImportMs: number; ids: string[] } {
  const probe = spawnSync(process.execPath, ["--import", "tsx", probePath, stateRoot], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" }
  });
  check("D probe exited 0", probe.status === 0, probe.stderr);
  return JSON.parse(probe.stdout) as { allImportMs: number; ids: string[] };
}

async function partD(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "r7i-sim-d-"));
  // The probe must live under the repo root so its bare pi-ai specifier
  // resolves against the repo's node_modules (same resolution the CLI uses).
  const probeHome = mkdtempSync(join(REPO_ROOT, ".r7i-sim-probe-"));
  try {
    const probePath = join(probeHome, "probe.mjs");
    writeFileSync(probePath, PROBE_SOURCE, "utf8");
    const builtinRoot = makeStateRoot(
      home,
      "sr-builtin",
      providersJson(["anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini"], [])
    );
    const customRoot = makeStateRoot(
      home,
      "sr-custom",
      providersJson(
        ["simprov/sim-a"],
        [
          {
            id: "simprov",
            baseUrl: "http://localhost:9/v1",
            models: [{ id: "sim-a", contextWindow: 32768, maxTokens: 4096 }]
          }
        ]
      )
    );

    const builtin = runProbe(builtinRoot, probePath);
    check(
      "D builtin-configured build does NOT load providers/all (post-import still cold, >15ms)",
      builtin.allImportMs > 15,
      `allImportMs=${builtin.allImportMs.toFixed(1)}`
    );
    for (const id of ["anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini", "premium", "cheap"]) {
      check(`D builtin catalog contains ${id}`, builtin.ids.includes(id), builtin.ids.join(","));
    }
    const expected = resolveListedModel("anthropic", "claude-sonnet-4-5");
    check("D builtin fixture id resolves in the sync catalog too", expected !== undefined);

    const custom = runProbe(customRoot, probePath);
    check(
      "D custom-only build DID load providers/all via the fallback (post-import cache hit, <15ms)",
      custom.allImportMs < 15,
      `allImportMs=${custom.allImportMs.toFixed(1)}`
    );
    check("D custom catalog contains simprov/sim-a", custom.ids.includes("simprov/sim-a"), custom.ids.join(","));
    out(
      `part D: load probe — builtin build leaves providers/all cold (${builtin.allImportMs.toFixed(1)}ms), ` +
        `custom fallback loads it (${custom.allImportMs.toFixed(1)}ms cache-hit)`
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(probeHome, { recursive: true, force: true });
  }
}

/* ============================================================
 * Part E — in-process CLI battery
 * ============================================================ */
function normalize(text: string): string {
  return text
    .replace(/\b(run|evt|ep|agt|msg|art|evd|cnd|inv|tsk|fbk|rsv)_[A-Za-z0-9-]+/g, "$1_X")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, "TS")
    .replace(/\/[^\s"']*r7i-sim-[^\s"']*/g, "PATH");
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

async function partE(): Promise<void> {
  const outputs: string[] = [];
  for (let round = 0; round < 2; round++) {
    const home = mkdtempSync(join(tmpdir(), "r7i-sim-e-"));
    try {
      const stateRoot = makeStateRoot(
        home,
        "sr",
        providersJson(["anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini"], [])
      );
      const project = join(home, "proj");
      mkdirSync(project, { recursive: true });
      writeFileSync(join(project, "package.json"), `{"name":"fixture","version":"0.0.0"}\n`, "utf8");
      const spec = join(home, "children.json");
      writeFileSync(
        spec,
        `${JSON.stringify({ tasks: [{ id: "tsk_sim-a", role: "implementer", objective: "do a" }] })}\n`,
        "utf8"
      );
      const result = await runMain([
        "run",
        "--project",
        project,
        "--objective",
        "sim objective",
        "--children",
        spec,
        "--state-root",
        stateRoot
      ]);
      check(`E round ${round} exits 0`, result.code === 0, result.stderr);
      check(
        `E round ${round} routes against the enabled builtin catalog`,
        result.stdout.includes("primary=anthropic/claude-sonnet-4-5") &&
          /-> (openai\/gpt-4o-mini|anthropic\/claude-sonnet-4-5)/.test(result.stdout),
        result.stdout.split("\n").slice(0, 3).join(" | ")
      );
      outputs.push(normalize(`${result.stdout}\n===\n${result.stderr}\ncode=${result.code}`));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
  check("E normalized outputs identical across rounds", outputs[0] === outputs[1]);
  out("part E: configured run --children battery — normalized-identical across rounds");
}

/* ============================================================ */
async function run(): Promise<void> {
  partA();
  await partB();
  await partC();
  await partD();
  await partE();
  out(`checks=${checks} failures=${failures}`);
  if (failures > 0) process.exitCode = 1;
}

await run();

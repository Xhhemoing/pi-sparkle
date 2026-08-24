import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Live-plane isolation, enforced over the **transitive** import closure.
 *
 * The previous version of this test read the source text of ten hand-listed
 * files, so a learned/exploratory router could enter live execution through any
 * intermediate module without tripping it. This version walks the real module
 * graph from the live entry points and judges what is *reachable*, not what is
 * spelled out in one file.
 *
 * Two learned-routing modules are reachable today. Both are pinned below with
 * the exact importer that pulls them in, so the allowlist cannot silently grow:
 *
 *   - `src/routing/bandit.ts` — reached through `src/learning/bandit-store.ts`,
 *     which the post-run adaptation loop uses to *write* per-project reward
 *     counters. Only the constructor/writer symbols are imported; `selectArm`
 *     (the exploratory selector) has no caller in the closure. The stored state is
 *     read back by `bandit-store.ts` itself and by `src/cli/doctor.ts`, which calls
 *     `loadProjectBanditByKey` for the read-only `learnedState` inventory (R6-4;
 *     parent sign-off: read-only inventory, never a selector — doctor never feeds
 *     routing). No other live module may read the stored state back.
 *   - `src/routing/topology.ts` — reached through `src/run/supervisor.ts`, which
 *     defines the parked `planTaskTopology` wrapper. The run loop does not call
 *     it (M5-T5 / Checkpoint F owns that integration), which the pinned
 *     occurrence count below keeps honest.
 *
 * Anything else on the watchlist (R1, the bandit shadow router, the shadow
 * report, the offline shadow comparison, the holdout simulator) must stay
 * unreachable.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Roots of live execution: the CLI, the flowchart runner, the DAG supervisor,
 * and the tracking loop. Every other live file is reachable from these.
 */
const LIVE_ENTRY_POINTS = [
  "src/cli/main.ts",
  "src/run/flowchart-run.ts",
  "src/run/supervisor.ts",
  "src/track/loop.ts"
] as const;

/**
 * Files the previous per-file version of this test guarded directly. They must
 * stay inside the closure, otherwise the entry-point list has drifted and the
 * closure check would be silently vacuous.
 */
const PINNED_LIVE_MODULES = [
  "src/cli/main.ts",
  "src/routing/assign.ts",
  "src/run/child-tracking.ts",
  "src/run/coordinator.ts",
  "src/run/flowchart-run.ts",
  "src/run/supervisor.ts",
  "src/supervisor/flowchart-supervisor.ts",
  "src/supervisor/model-router.ts",
  "src/track/loop.ts",
  "src/track/primary-split.ts"
] as const;

/** Learned/exploratory routers that must never be reachable from live code. */
const FORBIDDEN_MODULES = [
  "src/experiments/shadow-compare.ts",
  "src/experiments/simulation-holdout.ts",
  "src/routing/r1-shadow-report.ts",
  "src/routing/r1.ts",
  "src/routing/shadow.ts"
] as const;

interface Allowance {
  /** Reachable learned-routing module, repo-relative. */
  readonly module: string;
  /** The complete set of in-closure importers that may pull it in. */
  readonly importers: readonly string[];
  readonly because: string;
}

/** Pinned exceptions. Adding one requires a conscious edit here. */
const ALLOWED_LEARNED_MODULES: readonly Allowance[] = [
  {
    module: "src/routing/bandit.ts",
    importers: ["src/learning/bandit-store.ts"],
    because:
      "adaptation-plane reward writer only; the exploratory selectArm path is not reachable"
  },
  {
    module: "src/routing/topology.ts",
    importers: ["src/run/supervisor.ts"],
    because: "parked planTaskTopology wrapper; the run loop never calls it"
  }
];

/**
 * Everything the closure is judged against. Splitting it this way means a new
 * learned-routing edge shows up as a watchlist mismatch even if someone forgets
 * to extend FORBIDDEN_MODULES.
 */
const WATCHED_MODULES: readonly string[] = [
  ...FORBIDDEN_MODULES,
  ...ALLOWED_LEARNED_MODULES.map((entry) => entry.module)
];

/** Symbols `bandit-store.ts` may import from the bandit module. */
const ALLOWED_BANDIT_SYMBOLS = new Set(["BanditState", "createBanditState", "recordReward"]);

const SPECIFIER_PATTERN =
  /\bfrom\s*"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|^\s*import\s+"([^"]+)"/gm;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function readModule(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

/** Resolve a relative NodeNext specifier (`./x.js`) to its `.ts` source file. */
function resolveRelative(fromModule: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(resolve(REPO_ROOT, fromModule)), specifier);
  const stem = base.endsWith(".js") ? base.slice(0, -3) : base;
  for (const candidate of [`${stem}.ts`, resolve(stem, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return toPosix(relative(REPO_ROOT, candidate));
    }
  }
  return undefined;
}

interface Closure {
  readonly members: ReadonlySet<string>;
  readonly importersOf: ReadonlyMap<string, ReadonlySet<string>>;
  /** First module that reached each member, for readable failure messages. */
  readonly reachedFrom: ReadonlyMap<string, string>;
}

function buildClosure(entries: readonly string[]): Closure {
  const members = new Set<string>(entries);
  const importersOf = new Map<string, Set<string>>();
  const reachedFrom = new Map<string, string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const specifier of importSpecifiers(readModule(current))) {
      const target = resolveRelative(current, specifier);
      if (target === undefined) continue;
      const importers = importersOf.get(target) ?? new Set<string>();
      importers.add(current);
      importersOf.set(target, importers);
      if (members.has(target)) continue;
      members.add(target);
      reachedFrom.set(target, current);
      pending.push(target);
    }
  }

  return { members, importersOf, reachedFrom };
}

function importChain(closure: Closure, module: string): string {
  const chain = [module];
  let cursor = closure.reachedFrom.get(module);
  while (cursor !== undefined && !chain.includes(cursor)) {
    chain.unshift(cursor);
    cursor = closure.reachedFrom.get(cursor);
  }
  return chain.join(" -> ");
}

const LIVE_CLOSURE = buildClosure(LIVE_ENTRY_POINTS);

test("every entry point and watched module path still exists", () => {
  const missing = [...LIVE_ENTRY_POINTS, ...WATCHED_MODULES].filter(
    (module) => !existsSync(resolve(REPO_ROOT, module))
  );
  assert.deepEqual(missing, [], "a pinned path was renamed; this guard would be vacuous");
});

test("live entry points reach every module the per-file isolation check used to guard", () => {
  const missing = PINNED_LIVE_MODULES.filter((module) => !LIVE_CLOSURE.members.has(module));
  assert.deepEqual(
    missing,
    [],
    "live entry points no longer reach these files; the closure check would be vacuous"
  );
});

test("live import closure never reaches R1, shadow, or holdout simulation routers", () => {
  const reachable = FORBIDDEN_MODULES.filter((module) => LIVE_CLOSURE.members.has(module)).map(
    (module) => importChain(LIVE_CLOSURE, module)
  );
  assert.deepEqual(reachable, [], "a learned/shadow router entered the live execution plane");
});

test("learned-routing modules inside the live closure match the pinned allowlist", () => {
  const reachable = WATCHED_MODULES.filter((module) => LIVE_CLOSURE.members.has(module)).sort();
  const allowed = ALLOWED_LEARNED_MODULES.map((entry) => entry.module).sort();
  assert.deepEqual(reachable, allowed);

  for (const entry of ALLOWED_LEARNED_MODULES) {
    const actual = [...(LIVE_CLOSURE.importersOf.get(entry.module) ?? new Set<string>())].sort();
    assert.deepEqual(
      actual,
      [...entry.importers].sort(),
      `${entry.module} gained or lost a live importer; re-justify the allowlist entry`
    );
  }
});

test("every allowlisted learned-routing exception states its justification", () => {
  for (const entry of ALLOWED_LEARNED_MODULES) {
    assert.ok(entry.because.length > 5, entry.module);
    assert.ok(entry.importers.length > 0, entry.module);
  }
});

test("bandit reaches the live closure as a reward writer, never as a selector", () => {
  const storeSource = readModule("src/learning/bandit-store.ts");
  const banditImport = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/routing\/bandit\.js"/.exec(
    storeSource
  );
  assert.ok(banditImport !== null, "bandit-store must import the bandit module by name");
  const symbols = (banditImport[1] ?? "")
    .split(",")
    .map((part) => part.replace(/^\s*type\s+/, "").trim())
    .filter((part) => part !== "");
  const unexpected = symbols.filter((symbol) => !ALLOWED_BANDIT_SYMBOLS.has(symbol));
  assert.deepEqual(unexpected, [], "bandit-store may only import bandit constructor/writer symbols");

  const selectors = [...LIVE_CLOSURE.members]
    .filter((module) => module !== "src/routing/bandit.ts")
    .filter((module) => /\bselectArm\b/.test(readModule(module)))
    .sort();
  assert.deepEqual(selectors, [], "selectArm gained a caller inside the live execution plane");

  // R7-8 narrowed the exception: doctor now reaches the stored state through the
  // keyed reader instead of inverting the project-key hash, so the symbol this pin
  // requires moved with it. The sign-off it encodes is unchanged — read-only
  // inventory, never a selector.
  assert.match(
    readModule("src/cli/doctor.ts"),
    /\bloadProjectBanditByKey\b/,
    "doctor's signed-off exception is the learnedState inventory reader, not a selector"
  );
  const readers = [...LIVE_CLOSURE.members]
    .filter((module) => module !== "src/learning/bandit-store.ts")
    .filter((module) => module !== "src/cli/doctor.ts")
    .filter((module) => /\bloadProjectBandit(?:ByKey)?\b/.test(readModule(module)))
    .sort();
  assert.deepEqual(
    readers,
    [],
    "live execution must not read learned bandit state back (doctor inventory is the signed-off diagnostic exception)"
  );
});

test("DAG supervisor parks topology routing instead of calling it per round", () => {
  const text = readModule("src/run/supervisor.ts");
  assert.match(text, /the current run loop does NOT call this yet/);
  assert.equal(
    (text.match(/planTaskTopology/g) ?? []).length,
    1,
    "planTaskTopology must stay defined but unused in the live loop"
  );

  const callers = [...LIVE_CLOSURE.members]
    .filter((module) => module !== "src/run/supervisor.ts")
    .filter((module) => /\bplanTaskTopology\b/.test(readModule(module)))
    .sort();
  assert.deepEqual(callers, [], "planTaskTopology must stay unused until Checkpoint F");
});

test("live ModelRouter may import R0 eligibility helpers but not R1/bandit/shadow", () => {
  const text = readModule("src/supervisor/model-router.ts");
  assert.doesNotMatch(text, /routing\/r1/, "model-router must not import R1");
  assert.doesNotMatch(text, /routing\/bandit/, "model-router must not import bandit");
  assert.doesNotMatch(text, /routing\/shadow/, "model-router must not import shadow");
  assert.match(text, /evaluateLiveCandidate/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
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
 *   - `src/lab/routing/bandit.ts` — reached through `src/lab/learning/bandit-store.ts`,
 *     which the post-run adaptation loop uses to *write* per-project reward
 *     counters. Only the constructor/writer symbols are imported; `selectArm`
 *     (the exploratory selector) has no caller in the closure. The stored state is
 *     read through `src/persist/bandit-state.ts` by the lab writer and `src/cli/doctor.ts`, which calls
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

// The ordinary core keeps every possible literal loader except the two explicit
// CLI research commands. Track remains separately exercised in LIVE_CLOSURE.
const DEFAULT_ENTRY_POINTS = [
  "src/cli/main.ts", "src/run/flowchart-run.ts", "src/run/supervisor.ts", "src/native/core-session.ts"
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
  "src/lab/experiments/shadow-compare.ts",
  "src/lab/experiments/simulation-holdout.ts",
  "src/routing/r1-shadow-report.ts",
  "src/routing/r1.ts",
  "src/lab/routing/r1-shadow-report.ts",
  "src/lab/routing/r1.ts",
  "src/routing/shadow.ts",
  "src/lab/routing/shadow.ts"
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
    module: "src/lab/routing/bandit.ts",
    importers: ["src/lab/learning/bandit-store.ts"],
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
  "src/routing/bandit.ts", // Old compatibility path cannot create a second live ingress.
  ...ALLOWED_LEARNED_MODULES.map((entry) => entry.module)
];

/** Symbols `bandit-store.ts` may import from the bandit module. */
const ALLOWED_BANDIT_SYMBOLS = new Set(["BanditState", "createBanditState", "recordReward"]);

const TYPE_ONLY_IMPORT_PATTERN =
  /\bimport\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s*(["'])[^"']+\1\s*;?/g;
const TYPE_ONLY_EXPORT_PATTERN = /\bexport\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s+from\s*(["'])[^"']+\1\s*;?/g;
const SPECIFIER_PATTERN = /\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3|^\s*import\s*(["'])([^"']+)\5/gm;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function readModule(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function listTypeScriptModules(relativeDirectory: string): string[] {
  const modules: string[] = [];
  const pending = [relativeDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of readdirSync(resolve(REPO_ROOT, directory), { withFileTypes: true })) {
      const module = toPosix(`${directory}/${entry.name}`);
      if (entry.isDirectory()) pending.push(module);
      else if (entry.isFile() && entry.name.endsWith(".ts")) modules.push(module);
    }
  }
  return modules.sort();
}

function importEdges(source: string): Array<{ specifier: string; dynamic: boolean }> {
  const valueSource = source.replace(TYPE_ONLY_IMPORT_PATTERN, "").replace(TYPE_ONLY_EXPORT_PATTERN, "");
  const out: Array<{ specifier: string; dynamic: boolean }> = [];
  for (const match of valueSource.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier !== undefined) out.push({ specifier, dynamic: match[4] !== undefined });
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  return importEdges(source).map((edge) => edge.specifier);
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

function buildClosure(entries: readonly string[], overrides: ReadonlyMap<string, string> = new Map(), includeExplicitResearch = true): Closure {
  const members = new Set<string>(entries);
  const importersOf = new Map<string, Set<string>>();
  const reachedFrom = new Map<string, string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const { specifier, dynamic } of importEdges(overrides.get(current) ?? readModule(current))) {
      const target = resolveRelative(current, specifier);
      if (target === undefined) continue;
      if (!includeExplicitResearch && dynamic && current === "src/cli/main.ts" &&
        (target === "src/track/loop.ts" || target === "src/cli/adapt.ts")) continue;
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
const DEFAULT_CLOSURE = buildClosure(DEFAULT_ENTRY_POINTS, new Map(), false);
const SRC_MODULES = listTypeScriptModules("src");

test("every entry point and watched module path still exists", () => {
  const missing = [...LIVE_ENTRY_POINTS, ...DEFAULT_ENTRY_POINTS, ...WATCHED_MODULES].filter(
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

function assertNoForbiddenRouters(closure: Closure): void {
  const reachable = FORBIDDEN_MODULES.filter((module) => closure.members.has(module)).map((module) => importChain(closure, module));
  assert.deepEqual(reachable, [], "a canonical or compatibility learned/shadow router entered the live execution plane");
}

function assertAllowedLearnedModules(closure: Closure): void {
  const reachable = WATCHED_MODULES.filter((module) => closure.members.has(module)).sort();
  assert.deepEqual(reachable, ALLOWED_LEARNED_MODULES.map((entry) => entry.module).sort());
  for (const entry of ALLOWED_LEARNED_MODULES) {
    const actual = [...(closure.importersOf.get(entry.module) ?? new Set<string>())].sort();
    assert.deepEqual(actual, [...entry.importers].sort(), entry.module + " gained or lost a live importer; re-justify the allowlist entry");
  }
}

function assertStaticDefault(closure: Closure): void {
  const research = [...closure.members].filter((module) => /^src\/(?:lab|learning|adaptation|experiments)\//.test(module) || module === "src/routing/assign.ts");
  assert.deepEqual(research, [], "ordinary core must not load research; explicit track/adapt are checked separately");
}

test("ordinary core value closure stays static while explicit track retains its research composition", () => {
  assertStaticDefault(DEFAULT_CLOSURE);
  assert.equal(DEFAULT_CLOSURE.members.has("src/track/loop.ts"), false);
  assert.equal(DEFAULT_CLOSURE.members.has("src/cli/adapt.ts"), false);
  assert.ok(LIVE_CLOSURE.members.has("src/track/loop.ts"));
  assert.ok(LIVE_CLOSURE.members.has("src/lab/learning/bandit-store.ts"));
});

test("live import closure never reaches canonical or compatibility R1/shadow/holdout routers", () => {
  assertNoForbiddenRouters(LIVE_CLOSURE);
});

test("learned-routing modules inside the explicit research closure match the pinned allowlist", () => {
  assertAllowedLearnedModules(LIVE_CLOSURE);
});

test("every allowlisted learned-routing exception states its justification", () => {
  for (const entry of ALLOWED_LEARNED_MODULES) {
    assert.ok(entry.because.length > 5, entry.module);
    assert.ok(entry.importers.length > 0, entry.module);
  }
});

function assertBanditWriter(source: string): void {
  const banditImport = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/routing\/bandit\.js"/.exec(source);
  assert.ok(banditImport !== null, "canonical bandit-store must import the canonical bandit module by name");
  const symbols = (banditImport[1] ?? "").split(",").map((part) => part.replace(/^\s*type\s+/, "").trim()).filter((part) => part !== "");
  assert.deepEqual(symbols.filter((symbol) => !ALLOWED_BANDIT_SYMBOLS.has(symbol)), [], "bandit-store may only import bandit constructor/writer symbols");
}

function selectorUsers(modules: readonly string[], overrides: ReadonlyMap<string, string> = new Map()): string[] {
  return modules.filter((module) => {
    let source = overrides.get(module) ?? readModule(module);
    // Exempt exactly the canonical declaration name, never the complete file:
    // an added reference/call in that implementation must still be rejected.
    if (module === "src/lab/routing/bandit.ts") source = source.replace(/\bfunction\s+selectArm\b/, "function selectorDeclaration");
    return /\bselectArm\b/.test(source);
  }).sort();
}

function assertNoUnexpectedReaders(closure: Closure, overrides: ReadonlyMap<string, string> = new Map()): void {
  const allowed = new Set(["src/lab/learning/bandit-store.ts", "src/persist/bandit-state.ts", "src/cli/doctor.ts"]);
  const readers = [...closure.members].filter((module) => !allowed.has(module))
    .filter((module) => /\bloadProjectBandit(?:ByKey)?\b/.test(overrides.get(module) ?? readModule(module))).sort();
  assert.deepEqual(readers, [], "only the existing lab reward writer, canonical read implementation and doctor inventory may read bandit state");
}

function assertSelectorAndDeletedReaderIsolation(overrides: ReadonlyMap<string, string> = new Map()): void {
  assert.deepEqual(selectorUsers(SRC_MODULES, overrides), ["src/lab/routing/shadow.ts"], "selectArm's only src user must remain canonical shadow, including all old forwards");
  const deletedReaderUsers = SRC_MODULES.filter((module) => /\bloadProjectBandit\b/.test(overrides.get(module) ?? readModule(module)));
  assert.deepEqual(deletedReaderUsers, [], "the deleted root-keyed reader cannot revive in a canonical or compatibility module");
}

test("bandit reaches explicit track as a reward writer, never as a selector", () => {
  assertBanditWriter(readModule("src/lab/learning/bandit-store.ts"));
  assert.deepEqual(selectorUsers([...LIVE_CLOSURE.members]), [], "selectArm gained a reference inside live execution");
  assert.match(readModule("src/cli/doctor.ts"), /\bloadProjectBanditByKey\b/);
  assert.match(readModule("src/cli/doctor.ts"), /from "\.\.\/persist\/bandit-state\.js"/, "doctor must use the core inventory reader, not load the research writer");
  assertNoUnexpectedReaders(LIVE_CLOSURE);
});

test("selectArm stays shadow-only and R8-9's root-keyed reader stays deleted", () => {
  assertSelectorAndDeletedReaderIsolation();
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


test("type-only declarations stay erased but inline type imports remain module edges", () => {
  assert.deepEqual(importSpecifiers([
    'import type { Gone } from "./gone.js";',
    'export type { Gone } from "./gone-export.js";',
    'import { type Kept } from "./kept.js";',
    '// import { Comment } from "./comment.js";',
    'import "./side-effect.js";'
  ].join("\n")), ["./kept.js", "./comment.js", "./side-effect.js"]);
});

test("a research import added to ordinary main is rejected", () => {
  const module = "src/cli/main.ts";
  const overrides = new Map([[module, readModule(module) + '\nimport "../lab/learning/learned-routing.js";']]);
  const closure = buildClosure(DEFAULT_ENTRY_POINTS, overrides, false);
  assert.ok(closure.members.has("src/lab/learning/learned-routing.ts"));
  assert.throws(() => assertStaticDefault(closure), assert.AssertionError);
});

for (const target of ["src/experiments/shadow-compare.ts", "src/lab/experiments/shadow-compare.ts"]) test(target + " cannot enter explicit track through a forward or canonical import", () => {
  const module = "src/track/loop.ts";
  const specifier = target.replace(/^src\//, "../").replace(/\.ts$/, ".js");
  const overrides = new Map([[module, readModule(module) + '\nimport "' + specifier + '";']]);
  const closure = buildClosure(LIVE_ENTRY_POINTS, overrides);
  assert.ok(closure.members.has(target), "the mutation must actually reach the selected path");
  assert.throws(() => assertNoForbiddenRouters(closure), assert.AssertionError);
});

for (const module of ["src/routing/bandit.ts", "src/lab/routing/bandit.ts"]) test(module + " cannot hide a selector reference behind a forward or definition", () => {
  const overrides = new Map([[module, readModule(module) + '\nvoid selectArm;']]);
  assert.throws(() => assertSelectorAndDeletedReaderIsolation(overrides), assert.AssertionError);
});

for (const module of ["src/learning/bandit-store.ts", "src/lab/learning/bandit-store.ts"]) test(module + " cannot revive the deleted root-keyed reader", () => {
  const overrides = new Map([[module, readModule(module) + '\nexport const loadProjectBandit = () => undefined;']]);
  assert.throws(() => assertSelectorAndDeletedReaderIsolation(overrides), assert.AssertionError);
});

test("the canonical reward writer cannot import the selector or grant another reader", () => {
  const module = "src/lab/learning/bandit-store.ts", original = readModule(module);
  const changed = original.replace("createBanditState, recordReward", "createBanditState, recordReward, selectArm");
  assert.notEqual(changed, original);
  assert.throws(() => assertBanditWriter(changed), assert.AssertionError);
  const unauthorized = "src/track/loop.ts";
  const overrides = new Map([[unauthorized, readModule(unauthorized) + '\nloadProjectBanditByKey("synthetic", "synthetic");']]);
  assert.throws(() => assertNoUnexpectedReaders(LIVE_CLOSURE, overrides), assert.AssertionError);
});

for (const specifier of ["../track/loop.js", "./adapt.js"]) test("the explicit dynamic exception cannot conceal a static import of " + specifier, () => {
  const module = "src/cli/main.ts";
  const overrides = new Map([[module, readModule(module) + '\nimport "' + specifier + '";']]);
  const closure = buildClosure(DEFAULT_ENTRY_POINTS, overrides, false);
  assert.ok(closure.members.has(specifier.startsWith("../track") ? "src/track/loop.ts" : "src/cli/adapt.ts"));
  assert.throws(() => assertStaticDefault(closure), assert.AssertionError);
});

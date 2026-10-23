import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P0 Q1 boundary rule (2026-08-22 privacy sign-off): adaptation-plane modules
 * must not read runtime records directly. Runtime data reaches adaptation
 * only as derived, text-free signals (e.g. taskSuccess PASS/FAIL) or through
 * the redaction pipes. This test pins the current exceptions; adding one
 * requires a conscious edit here plus a dictionary note.
 */

const ADAPTATION_DIRS = [
  "adaptation",
  "learning",
  "preferences",
  "experiments",
  "feedback",
  "lab/adaptation",
  "lab/learning",
  "lab/experiments",
  "lab/routing",
  "lab/evaluation"
] as const;

/**
 * Runtime-plane prefixes the adaptation plane must not reach into.
 *
 * `../supervisor/` and `../cli/` were added on 2026-08-24: the supervisor holds
 * the live orchestration engine and model router, and the CLI wires the live run
 * to disk, so both are runtime surfaces even though the original list only named
 * the record-bearing directories. `../routing/` stays deliberately narrow —
 * routing is a shared policy library, and the adaptation plane legitimately
 * imports its pure scoring helpers. `cost-calibration` reads runtime cost
 * records; `model-catalog` loads runtime provider configuration and calibrates
 * from those records, even though its canonical path no longer lives in CLI.
 */

// Scan exact old research forwards too, without classifying mixed core directories as research.
const RESEARCH_COMPAT_MODULES: readonly string[] = [
  "routing/assign.ts",
  "routing/bandit.ts",
  "routing/drift.ts",
  "routing/shadow.ts",
  "routing/r1.ts",
  "routing/r1-shadow-report.ts",
  "routing/posterior.ts",
  "routing/offline-types.ts",
  "routing/offline-logit.ts",
  "routing/offline-prob-add.ts",
  "routing/lin-alg.ts",
  "routing/propensity.ts",
  "evaluation/adapters.ts",
  "evaluation/check-adapter.ts",
  "evaluation/delivery-adapter.ts",
  "evaluation/diff-adapter.ts",
  "evaluation/invalidation.ts",
  "evaluation/ownership.ts",
  "evaluation/precedence.ts"
];

const RUNTIME_MODULES = [
  "../run/",
  "../episode/",
  "../telemetry/",
  "../config/",
  "../pi-adapter/",
  "../supervisor/",
  "../cli/",
  "../routing/cost-calibration",
  "../routing/model-catalog"
] as const;

interface Exception {
  readonly module: string;
  readonly because: string;
  /** Set when the import must stay erased at runtime (`import type { ... }`). */
  readonly typeOnly?: true;
}

/** Allowed adaptation -> runtime imports, each with its justification. */
const ALLOWED: ReadonlyArray<Exception> = [
  {
    module: "lab/routing/assign.ts -> supervisor/model-router.ts",
    because: "existing legacy assignment facade uses only erased ModelRouter/RoutingLimits types; execution stays in static-assign",
    typeOnly: true
  },
  // Type-only import of the runtime event shape; no data access.
  { module: "lab/learning/auto-loop.ts -> run/events.ts", because: "type-only Event shape", typeOnly: true },
  { module: "lab/learning/signals.ts -> run/events.ts", because: "type-only Event shape", typeOnly: true },
  {
    module: "lab/learning/eval-dataset.ts -> run/events.ts",
    because: "type-only Event shape; the CLI reads the log and hands the events in",
    typeOnly: true
  },
  // Derived-signal pipe: extracts taskSuccess PASS/FAIL only, never text.
  { module: "lab/learning/from-episode.ts -> run/event-store.ts", because: "sanctioned derived-signal reader (PASS/FAIL only)" },
  { module: "lab/learning/from-episode.ts -> run/events.ts", because: "type-only Event/ModelRoutedPayload shapes", typeOnly: true },
  // The direct model-router import is type-only, but eval-routing value-imports
  // routing/assign and static-assign, which loads model-router at runtime.
  // model-router has no filesystem or record access.
  {
    module: "lab/adaptation/eval-routing.ts -> supervisor/model-router.ts",
    because: "type-only ModelRouterConfig shape for offline routing replay",
    typeOnly: true
  }
];

interface ValueRuntimeAllowance {
  readonly edge: string;
  readonly because: string;
}

/**
 * Exact non-runtime -> runtime edges reachable from adaptation value imports.
 * Runtime modules may import within their own plane after these boundary
 * crossings; any new crossing from adaptation/shared policy code is blocked.
 */
const ALLOWED_VALUE_RUNTIME_EDGES: readonly ValueRuntimeAllowance[] = [
  {
    edge: "lab/learning/from-episode.ts -> run/event-store.ts",
    because: "sanctioned derived-signal reader extracts routed task PASS/FAIL only"
  },
  {
    edge: "routing/static-assign.ts -> supervisor/model-router.ts",
    because: "offline routing replay uses the filesystem-free deterministic model router"
  }
];

const SRC_ROOT = fileURLToPath(new URL("../../../src/", import.meta.url));

function readSrc(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), "utf8");
}

function listTs(dir: string): string[] {
  const root = SRC_ROOT;
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(join(root, d), { withFileTypes: true })) {
      const rel = join(d, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".ts")) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

// Preserve the fail-closed comment behavior while erasing only whole type declarations.
const TYPE_ONLY_IMPORT_PATTERN =
  /\bimport\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s*(["'])[^"']+\1\s*;?/g;
const TYPE_ONLY_EXPORT_PATTERN = /\bexport\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s+from\s*(["'])[^"']+\1\s*;?/g;
const SPECIFIER_PATTERN = /\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3|^\s*import\s*(["'])([^"']+)\5/gm;

function allImportSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER_PATTERN)].map((match) => match[2] ?? match[4] ?? match[6]!);
}

interface ImportEdge {
  readonly importer: string;
  readonly target: string;
}

interface ValueImportClosure {
  readonly members: ReadonlySet<string>;
  readonly edges: readonly ImportEdge[];
}

function valueImportSpecifiers(source: string): string[] {
  return allImportSpecifiers(source.replace(TYPE_ONLY_IMPORT_PATTERN, "").replace(TYPE_ONLY_EXPORT_PATTERN, ""));
}

function resolveRelativeModule(
  importer: string,
  specifier: string,
  sources: ReadonlyMap<string, string>
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const stem = resolved.endsWith(".js") ? resolved.slice(0, -3) : resolved;
  return [`${stem}.ts`, posix.join(stem, "index.ts")].find((candidate) =>
    sources.has(candidate)
  );
}

function buildValueImportClosure(
  entries: readonly string[],
  sources: ReadonlyMap<string, string>
): ValueImportClosure {
  const members = new Set(entries);
  const edges: ImportEdge[] = [];
  const edgeKeys = new Set<string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const importer = pending.pop();
    if (importer === undefined) break;
    const source = sources.get(importer);
    if (source === undefined) throw new Error(`missing source for closure member ${importer}`);
    for (const specifier of valueImportSpecifiers(source)) {
      const target = resolveRelativeModule(importer, specifier, sources);
      if (target === undefined) continue;
      const edge = `${importer} -> ${target}`;
      if (!edgeKeys.has(edge)) {
        edgeKeys.add(edge);
        edges.push({ importer, target });
      }
      if (members.has(target)) continue;
      members.add(target);
      pending.push(target);
    }
  }

  return { members, edges };
}

function isRuntimeModule(module: string): boolean {
  return RUNTIME_MODULES.some((prefix) => module.startsWith(prefix.replace(/^\.\.\//, "")));
}

function runtimeIngresses(closure: ValueImportClosure): string[] {
  return closure.edges
    .filter((edge) => isRuntimeModule(edge.target) && !isRuntimeModule(edge.importer))
    .map((edge) => `${edge.importer} -> ${edge.target}`)
    .sort();
}

function assertOnlyAllowedRuntimeIngresses(
  closure: ValueImportClosure,
  allowed: readonly ValueRuntimeAllowance[]
): void {
  assert.deepEqual(
    runtimeIngresses(closure),
    allowed.map((entry) => entry.edge).sort(),
    "adaptation value-import closure crossed into the runtime plane outside the allowlist"
  );
}

function loadSourceTable(): ReadonlyMap<string, string> {
  return new Map(
    listTs("").map((file) => {
      const normalized = file.split("\\").join("/");
      return [normalized, readSrc(file)] as const;
    })
  );
}

function adaptationEntries(sources: ReadonlyMap<string, string>): string[] {
  return [...sources.keys()].filter((file) => ADAPTATION_DIRS.some((dir) => file.startsWith(dir + "/")) || RESEARCH_COMPAT_MODULES.includes(file));
}

function assertAllowedDirectImports(sources: ReadonlyMap<string, string>): void {
  const violations: string[] = [];
  for (const file of adaptationEntries(sources)) {
    for (const specifier of allImportSpecifiers(sources.get(file)!)) {
      if (!specifier.startsWith(".")) continue;
      // Missing runtime files must not hide a forbidden dependency from this
      // direct boundary check merely because module resolution cannot find it.
      const normalized = posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\.js$/, ".ts");
      const target = resolveRelativeModule(file, specifier, sources) ?? normalized;
      if (!isRuntimeModule(target)) continue;
      const key = file + " -> " + target;
      if (!ALLOWED.some((allowed) => allowed.module === key)) violations.push(key);
    }
  }
  assert.deepEqual(violations, [], "adaptation direct imports crossed the runtime boundary");
}

function assertTypeOnlyAllowances(sources: ReadonlyMap<string, string>): void {
  for (const entry of ALLOWED) {
    const [file, target] = entry.module.split(" -> ");
    assert.ok(file !== undefined && target !== undefined, entry.module);
    const source = sources.get(file);
    assert.ok(source !== undefined, entry.module);
    const imports = allImportSpecifiers(source).map((specifier) => resolveRelativeModule(file, specifier, sources));
    assert.ok(imports.includes(target), "stale allowlisted import: " + entry.module);
    if (entry.typeOnly === true) {
      const values = valueImportSpecifiers(source).map((specifier) => resolveRelativeModule(file, specifier, sources));
      assert.equal(values.includes(target), false, "allowlisted type-only import became a value import: " + entry.module);
    }
  }
}

test("adaptation plane scans canonical lab modules and old forwards for unauthorized runtime imports", () => {
  assertAllowedDirectImports(loadSourceTable());
});

test("every allowlisted exception states its justification", () => {
  for (const entry of [...ALLOWED, ...ALLOWED_VALUE_RUNTIME_EDGES]) {
    assert.ok(entry.because.length > 5, "module" in entry ? entry.module : entry.edge);
  }
});

test("every allowlisted exception still exists and type-only ones stay erased", () => {
  assertTypeOnlyAllowances(loadSourceTable());
});

test("adaptation value-import closure enters runtime only through sanctioned readers", () => {
  const sources = loadSourceTable();
  const entries = adaptationEntries(sources);
  const closure = buildValueImportClosure(entries, sources);

  assertOnlyAllowedRuntimeIngresses(closure, ALLOWED_VALUE_RUNTIME_EDGES);
});

test("transitive walker rejects a simulated runtime edge and fails closed on comments", () => {
  const sources = new Map<string, string>([
    [
      "adaptation/root.ts",
      [
        'import type { Event } from "../run/events.js";',
        'import { route } from "../routing/synthetic.js";',
        '// import { invocationPath } from "../telemetry/invocation-log.js";'
      ].join("\n")
    ],
    ["routing/synthetic.ts", 'import { EventStore } from "../run/event-store.js";'],
    ["run/events.ts", "export interface Event {}"],
    ["run/event-store.ts", "export class EventStore {}"],
    ["telemetry/invocation-log.ts", "export const invocationPath = '';"]
  ]);
  const closure = buildValueImportClosure(["adaptation/root.ts"], sources);

  assert.equal(closure.members.has("run/events.ts"), false, "import type must stay erased");
  assert.deepEqual(runtimeIngresses(closure), [
    "adaptation/root.ts -> telemetry/invocation-log.ts",
    "routing/synthetic.ts -> run/event-store.ts"
  ]);
  assert.throws(
    () => assertOnlyAllowedRuntimeIngresses(closure, []),
    assert.AssertionError,
    "a synthetic transitive runtime import must make the guard go red"
  );
});

test("catalog construction remains a runtime boundary outside its old CLI path", () => {
  const sources = new Map<string, string>([
    ["adaptation/root.ts", 'import { buildLiveCatalogConfig } from "../routing/model-catalog.js";'],
    ["routing/model-catalog.ts", 'import { loadProvidersConfig } from "../config/providers-config.js";'],
    ["config/providers-config.ts", "export const loadProvidersConfig = () => ({});"]
  ]);
  const closure = buildValueImportClosure(["adaptation/root.ts"], sources);
  assert.deepEqual(runtimeIngresses(closure), ["adaptation/root.ts -> routing/model-catalog.ts"]);
  assert.throws(() => assertOnlyAllowedRuntimeIngresses(closure, []), assert.AssertionError);
});

test("the allowlisted model router remains free of filesystem record access", () => {
  const modelRouter = readSrc("supervisor/model-router.ts");

  assert.doesNotMatch(
    modelRouter,
    /node:fs|\breadFile\b|\bwriteFile\b|\bappendFile\b/,
    "model-router must remain free of filesystem record access"
  );
});

for (const importer of ["learning/signals.ts", "lab/learning/signals.ts", "evaluation/check-adapter.ts", "lab/evaluation/check-adapter.ts"]) test(importer + " runtime bypass is rejected through canonical and compatibility roots", () => {
  const sources = new Map(loadSourceTable());
  const relative = importer.startsWith("lab/") ? "../../" : "../";
  sources.set(importer, sources.get(importer)! + '\nimport { loadProvidersConfig } from "' + relative + 'config/providers-config.js";');
  assert.throws(() => assertAllowedDirectImports(sources), assert.AssertionError);
  assert.throws(() => assertOnlyAllowedRuntimeIngresses(buildValueImportClosure(adaptationEntries(sources), sources), ALLOWED_VALUE_RUNTIME_EDGES), assert.AssertionError);
});

test("an otherwise unreferenced canonical lab module remains an adaptation root", () => {
  const sources = new Map(loadSourceTable());
  sources.set("lab/learning/orphan.ts", 'import { EventStore } from "../../run/event-store.js";');
  assert.throws(() => assertAllowedDirectImports(sources), assert.AssertionError);
  assert.throws(() => assertOnlyAllowedRuntimeIngresses(buildValueImportClosure(adaptationEntries(sources), sources), ALLOWED_VALUE_RUNTIME_EDGES), assert.AssertionError);
});

test("canonical type-only permission cannot be upgraded to a runtime import", () => {
  const sources = new Map(loadSourceTable());
  const file = "lab/learning/signals.ts", original = sources.get(file)!;
  const changed = original.replace('import type { Event } from "../../run/events.js"', 'import { Event } from "../../run/events.js"');
  assert.notEqual(changed, original);
  sources.set(file, changed);
  assert.throws(() => assertTypeOnlyAllowances(sources), assert.AssertionError);
});

test("a missing runtime target does not bypass the direct canonical boundary", () => {
  const sources = new Map(loadSourceTable());
  sources.set("lab/learning/orphan.ts", 'import { hidden } from "../../run/not-present.js";');
  assert.throws(() => assertAllowedDirectImports(sources), assert.AssertionError);
});

test("the moved assignment facade retains only its erased router type permission", () => {
  const sources = new Map(loadSourceTable());
  const file = "lab/routing/assign.ts", original = sources.get(file)!;
  const changed = original.replace("import type { ModelRouter, RoutingLimits }", "import { ModelRouter, RoutingLimits }");
  assert.notEqual(changed, original);
  sources.set(file, changed);
  assert.throws(() => assertTypeOnlyAllowances(sources), assert.AssertionError);
  assert.throws(() => assertOnlyAllowedRuntimeIngresses(buildValueImportClosure(adaptationEntries(sources), sources), ALLOWED_VALUE_RUNTIME_EDGES), assert.AssertionError);
});

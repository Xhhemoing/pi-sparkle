import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Adaptation-plane isolation, enforced over the union value-import closure.
 *
 * This is deliberately a fail-closed regex walker. It does not remove comments,
 * so comment text that looks like a value import is treated as an edge. It sees
 * literal `from "x"` and `import("x")` specifiers, but not `import(expr)`;
 * the repository-wide watchlist below rejects every unlisted computed import.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

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


// Scan exact old research forwards too, without classifying mixed core directories as research.
const RESEARCH_COMPAT_MODULES: readonly string[] = [
  "src/routing/assign.ts",
  "src/routing/bandit.ts",
  "src/routing/drift.ts",
  "src/routing/shadow.ts",
  "src/routing/r1.ts",
  "src/routing/r1-shadow-report.ts",
  "src/routing/posterior.ts",
  "src/routing/offline-types.ts",
  "src/routing/offline-logit.ts",
  "src/routing/offline-prob-add.ts",
  "src/routing/lin-alg.ts",
  "src/routing/propensity.ts",
  "src/evaluation/adapters.ts",
  "src/evaluation/check-adapter.ts",
  "src/evaluation/delivery-adapter.ts",
  "src/evaluation/diff-adapter.ts",
  "src/evaluation/invalidation.ts",
  "src/evaluation/ownership.ts",
  "src/evaluation/precedence.ts"
];

const RUNTIME_PREFIXES = [
  "src/run/",
  "src/episode/",
  "src/telemetry/",
  "src/config/",
  "src/pi-adapter/",
  "src/supervisor/",
  "src/cli/"
] as const;

const RUNTIME_EXACT_MODULES = [
  "src/routing/cost-calibration.ts",
  "src/routing/model-catalog.ts"
] as const;

interface RuntimeAllowance {
  readonly module: string;
  readonly because: string;
}

/**
 * Runtime modules currently reached by value imports.
 *
 * Loop 4 removed the inferred-preference episode lookup from the learning
 * path, so the from-episode pipe no longer loads episode-bind or its
 * dependencies. Persist helpers are intentionally absent: `src/persist/` is
 * not a runtime-plane prefix.
 */
const ALLOWED_RUNTIME_MODULES: readonly RuntimeAllowance[] = [
  {
    module: "src/run/event-store.ts",
    because: "sanctioned reader extracts taskSuccess PASS/FAIL signals from the run event stream"
  },
  {
    module: "src/run/events.ts",
    because: "EventStore validation dependency reached by the sanctioned derived-signal reader"
  },
  {
    module: "src/run/injection.ts",
    because: "event payload validation dependency reached transitively through EventStore"
  },
  {
    module: "src/supervisor/model-router.ts",
    because: "offline routing replay reaches the filesystem-free router through routing/assign and static-assign"
  }
];

/**
 * Under verbatimModuleSyntax these declarations are erased, so they are not
 * value edges. Inline `type` specifiers in an ordinary import are not stripped:
 * TypeScript preserves that declaration as a module import.
 */
const TYPE_ONLY_IMPORT_PATTERN =
  /\bimport\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s*(["'])[^"']+\1\s*;?/g;

const TYPE_ONLY_EXPORT_PATTERN = /\bexport\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s+from\s*(["'])[^"']+\1\s*;?/g;
const SPECIFIER_PATTERN =
  /\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3|^\s*import\s*(["'])([^"']+)\5/gm;

/** Methods named import are not dynamic imports; only ImportKeyword calls are. */
function computedImportArguments(source: string): string[] {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const argumentsFound: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      // Exempt only this call's literal prefix in the retained value walker's
      // syntax. A match elsewhere in a comment is not the actual import.
      // Escapes must decode to the same specifier the regex walker will use.
      const literalPrefix = /^import\s*\(\s*(["'])([^"']+)\1/.exec(node.getText(file));
      const visibleLiteral = argument !== undefined && ts.isStringLiteral(argument) &&
        literalPrefix?.[2] === argument.text;
      if (!visibleLiteral) {
        argumentsFound.push(argument?.getText(file) ?? "");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return argumentsFound;
}
const FILESYSTEM_ACCESS_PATTERN = /node:fs|\breadFile\b|\bwriteFile\b|\bappendFile\b/;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function readModule(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function listTs(relativeDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })) {
      const relativePath = toPosix(resolve(dir, entry.name));
      const repoRelative = toPosix(relative(REPO_ROOT, relativePath));
      if (entry.isDirectory()) walk(repoRelative);
      else if (entry.name.endsWith(".ts")) out.push(repoRelative);
    }
  };
  walk(relativeDir);
  return out.sort();
}

function importSpecifiers(source: string): string[] {
  const valueSource = source.replace(TYPE_ONLY_IMPORT_PATTERN, "").replace(TYPE_ONLY_EXPORT_PATTERN, "");
  const out: string[] = [];
  for (const match of valueSource.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

/** Resolve a relative NodeNext specifier (`./x.js`) to its `.ts` source. */
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
  /** First value importer that reached each member, for failure diagnostics. */
  readonly reachedFrom: ReadonlyMap<string, string>;
}

function buildValueClosure(entries: readonly string[], overrides: ReadonlyMap<string, string> = new Map()): Closure {
  const members = new Set(entries);
  const reachedFrom = new Map<string, string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const specifier of importSpecifiers(overrides.get(current) ?? readModule(current))) {
      const target = resolveRelative(current, specifier);
      if (target === undefined || members.has(target)) continue;
      members.add(target);
      reachedFrom.set(target, current);
      pending.push(target);
    }
  }

  return { members, reachedFrom };
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

function isRuntimeModule(module: string): boolean {
  return (
    RUNTIME_PREFIXES.some((prefix) => module.startsWith(prefix)) ||
    RUNTIME_EXACT_MODULES.includes(module as (typeof RUNTIME_EXACT_MODULES)[number])
  );
}

const ADAPTATION_ENTRY_POINTS = [...ADAPTATION_DIRS.flatMap((dir) => listTs(`src/${dir}`)), ...RESEARCH_COMPAT_MODULES];
const ADAPTATION_VALUE_CLOSURE = buildValueClosure(ADAPTATION_ENTRY_POINTS);

test("value walker erases import type declarations but keeps runtime import forms", () => {
  const source = `
    import type { Erased } from "./erased.js";
    import type * as ErasedNamespace from "./erased-namespace.js";
    export type { ErasedExport } from "./erased-export.js";
    import { type KeptInline } from "./inline-type.js";
    export { value } from "./re-export.js";
    const lazy = import("./lazy.js");
    import "./side-effect.js";
  `;
  assert.deepEqual(importSpecifiers(source), [
    "./inline-type.js",
    "./re-export.js",
    "./lazy.js",
    "./side-effect.js"
  ]);
});

test("runtime catalog configuration does not become shared policy by leaving CLI", () => {
  assert.equal(isRuntimeModule("src/routing/model-catalog.ts"), true);
});

function assertAllowedRuntimeModules(closure: Closure): void {
  const actual = [...closure.members].filter(isRuntimeModule).sort();
  const allowed = ALLOWED_RUNTIME_MODULES.map((entry) => entry.module).sort();
  const unallowlisted = actual.filter((module) => !allowed.includes(module)).map((module) => importChain(closure, module));
  assert.deepEqual(unallowlisted, [], "a runtime module entered the adaptation value closure; the reported path is its import chain");
  assert.deepEqual(allowed.filter((module) => !actual.includes(module)), [], "a runtime allowance is stale; remove or re-derive it");
  assert.deepEqual(actual, allowed);
}

test("adaptation value closure reaches only explicitly allowed runtime modules", () => {
  assertAllowedRuntimeModules(ADAPTATION_VALUE_CLOSURE);
  for (const dir of ADAPTATION_DIRS) {
    for (const module of listTs("src/" + dir)) assert.ok(ADAPTATION_VALUE_CLOSURE.members.has(module), module);
  }
});

test("every runtime allowance is unique and states its justification", () => {
  const modules = ALLOWED_RUNTIME_MODULES.map((entry) => entry.module);
  assert.equal(new Set(modules).size, modules.length, "runtime allowlist contains a duplicate");
  for (const entry of ALLOWED_RUNTIME_MODULES) {
    assert.ok(entry.because.length > 5, entry.module);
  }
});

test("model-router value subtree has no filesystem record access", () => {
  const closure = buildValueClosure(["src/supervisor/model-router.ts"]);
  const filesystemUsers = [...closure.members]
    .filter((module) => FILESYSTEM_ACCESS_PATTERN.test(readModule(module)))
    .sort()
    .map((module) => importChain(closure, module));

  assert.deepEqual(
    filesystemUsers,
    [],
    "model-router or a module in its value subtree gained node:fs/readFile/writeFile/appendFile"
  );
});

test("computed-import detection distinguishes dynamic calls from methods and literal imports", () => {
  const source = [
    'class Importer { async import(input: unknown) { return input; } }',
    'const method = { import(input: unknown) { return input; } };',
    'method.import("value");',
    'const literal = import("./literal.js");',
    "const single = import('./single.js');",
    'const variable = import(selected);',
    'const template = import(`./${name}.js`);',
    'const whitespace = import(\n  selectedAfterNewline\n);'
  ].join("\n");
  assert.deepEqual(computedImportArguments(source), [
    "selected", "`./${name}.js`", "selectedAfterNewline"
  ]);
});

test("dynamic literals hidden from the value walker remain computed imports", async (t) => {
  const sources = [
    ["block comment after parenthesis", 'import(/* loading hint */ "../run/coordinator.js")'],
    ["line comment after parenthesis", 'import(// loading hint\n "../run/coordinator.js")'],
    ["comment before parenthesis", 'import /* loading hint */ ("../run/coordinator.js")'],
    ["decoy import in comment", 'import(/* import("../run/coordinator.js") */ "../run/coordinator.js")']
  ] as const;
  for (const [name, source] of sources) {
    await t.test(name, () => {
      if (name !== "decoy import in comment") {
        assert.deepEqual(importSpecifiers(source), [], "the retained literal walker cannot see this call");
      }
      assert.deepEqual(computedImportArguments(source), ['"../run/coordinator.js"'],
        "a real import invisible to the literal walker must stay on the computed watchlist");
    });
  }
});
test("escaped literal specifiers cannot disappear behind raw value-import spelling", () => {
  const source = String.raw`import("\u002e\u002e/run/coordinator.js")`;
  assert.deepEqual(importSpecifiers(source), [String.raw`\u002e\u002e/run/coordinator.js`]);
  assert.deepEqual(computedImportArguments(source), [String.raw`"\u002e\u002e/run/coordinator.js"`]);
});
test("computed imports remain confined to justified runtime loaders outside adaptation", () => {
  const computedImportModules = listTs("src").filter((module) =>
    computedImportArguments(readModule(module)).length > 0
  );
  const allowed = [
    // Caller-selected provider data subpath; published pi-ai exports reject
    // unknown ids, then the loader falls back to the literal all-provider table.
    "src/pi-adapter/listed-model-lazy.ts",
    // A fresh child validates the physical generation, installed versions and
    // dist entry before importing it under lifetime resolution/loading hooks.
    // The generic contained entry is selected by qualification or driver code.
    "src/pi-adapter/managed/bootstrap.ts"
  ];
  assert.deepEqual(
    computedImportModules,
    allowed,
    "computed import(expr) is invisible to the value walker and requires a justified runtime exception"
  );
  for (const module of allowed) {
    assert.equal(ADAPTATION_VALUE_CLOSURE.members.has(module), false,
      `${module} must remain outside the adaptation value-import closure`);
  }
  assert.deepEqual(
    computedImportArguments(readModule("src/pi-adapter/managed/bootstrap.ts")),
    ["pathToFileURL(entry).href"],
    "the bootstrap exception covers only its validated contained entry"
  );
});

for (const importer of ["src/learning/signals.ts", "src/lab/learning/signals.ts", "src/evaluation/check-adapter.ts", "src/lab/evaluation/check-adapter.ts"]) test(importer + " cannot bypass the runtime closure through a side-effect import", () => {
  const relative = importer.startsWith("src/lab/") ? "../../" : "../";
  const source = readModule(importer) + '\nimport "' + relative + 'config/providers-config.js";';
  const closure = buildValueClosure(ADAPTATION_ENTRY_POINTS, new Map([[importer, source]]));
  assert.ok(closure.members.has("src/config/providers-config.ts"), "the mutated source must actually enter the runtime closure");
  assert.throws(() => assertAllowedRuntimeModules(closure), assert.AssertionError);
});

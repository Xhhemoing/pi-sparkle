import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Adaptation-plane isolation, enforced over the union value-import closure.
 *
 * This is deliberately a fail-closed regex walker. It does not remove comments,
 * so comment text that looks like a value import is treated as an edge. It sees
 * literal `from "x"` and `import("x")` specifiers, but not `import(expr)`;
 * the repository-wide watchlist below rejects every such computed import.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ADAPTATION_DIRS = [
  "adaptation",
  "learning",
  "preferences",
  "experiments",
  "feedback"
] as const;

const RUNTIME_PREFIXES = [
  "src/run/",
  "src/episode/",
  "src/telemetry/",
  "src/config/",
  "src/pi-adapter/",
  "src/supervisor/",
  "src/cli/"
] as const;

const RUNTIME_EXACT_MODULES = ["src/routing/cost-calibration.ts"] as const;

interface RuntimeAllowance {
  readonly module: string;
  readonly because: string;
}

/**
 * Runtime modules currently reached by value imports.
 *
 * The from-episode pipe statically loads all of episode-bind's dependencies,
 * even though its caller only uses episodeIdFromEvents. Persist helpers are
 * intentionally absent: `src/persist/` is not a runtime-plane prefix.
 */
const ALLOWED_RUNTIME_MODULES: readonly RuntimeAllowance[] = [
  {
    module: "src/episode/closure.ts",
    because: "episode settlement dependency statically loaded by the sanctioned episode-id pipe"
  },
  {
    module: "src/episode/events.ts",
    because: "episode manager's inline type specifiers preserve this module edge under verbatimModuleSyntax"
  },
  {
    module: "src/episode/manager.ts",
    because: "episode binding and settlement dependency statically loaded by the sanctioned episode-id pipe"
  },
  {
    module: "src/episode/store.ts",
    because: "episode event persistence dependency statically loaded by the sanctioned episode-id pipe"
  },
  {
    module: "src/run/episode-bind.ts",
    because: "resolves the episode id used by the sanctioned derived-signal reader"
  },
  {
    module: "src/run/episode-store.ts",
    because: "episode snapshot persistence dependency statically loaded by episode-bind"
  },
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
    because: "offline routing replay reaches the filesystem-free router through routing/assign"
  }
];

/**
 * Under verbatimModuleSyntax these declarations are erased, so they are not
 * value edges. Inline `type` specifiers in an ordinary import are not stripped:
 * TypeScript preserves that declaration as a module import.
 */
const TYPE_ONLY_IMPORT_PATTERN =
  /\bimport\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s*(["'])[^"']+\1\s*;?/g;

const SPECIFIER_PATTERN =
  /\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3/g;

const COMPUTED_IMPORT_PATTERN = /\bimport\s*\(\s*(?!["'])/;
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
  const valueSource = source.replace(TYPE_ONLY_IMPORT_PATTERN, "");
  const out: string[] = [];
  for (const match of valueSource.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2] ?? match[4];
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

function buildValueClosure(entries: readonly string[]): Closure {
  const members = new Set(entries);
  const reachedFrom = new Map<string, string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const specifier of importSpecifiers(readModule(current))) {
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

const ADAPTATION_ENTRY_POINTS = ADAPTATION_DIRS.flatMap((dir) => listTs(`src/${dir}`));
const ADAPTATION_VALUE_CLOSURE = buildValueClosure(ADAPTATION_ENTRY_POINTS);

test("value walker erases import type declarations but keeps runtime import forms", () => {
  const source = `
    import type { Erased } from "./erased.js";
    import type * as ErasedNamespace from "./erased-namespace.js";
    import { type KeptInline } from "./inline-type.js";
    export { value } from "./re-export.js";
    const lazy = import("./lazy.js");
  `;
  assert.deepEqual(importSpecifiers(source), [
    "./inline-type.js",
    "./re-export.js",
    "./lazy.js"
  ]);
});

test("adaptation value closure reaches only explicitly allowed runtime modules", () => {
  const actual = [...ADAPTATION_VALUE_CLOSURE.members].filter(isRuntimeModule).sort();
  const allowed = ALLOWED_RUNTIME_MODULES.map((entry) => entry.module).sort();
  const unallowlisted = actual
    .filter((module) => !allowed.includes(module))
    .map((module) => importChain(ADAPTATION_VALUE_CLOSURE, module));
  const stale = allowed.filter((module) => !actual.includes(module));

  assert.deepEqual(
    unallowlisted,
    [],
    "a runtime module entered the adaptation value closure; the reported path is its import chain"
  );
  assert.deepEqual(stale, [], "a runtime allowance is stale; remove or re-derive it");
  assert.deepEqual(actual, allowed);
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

test("all dynamic imports in src use string-literal arguments", () => {
  const computedImportModules = listTs("src").filter((module) =>
    COMPUTED_IMPORT_PATTERN.test(readModule(module))
  );
  assert.deepEqual(
    computedImportModules,
    [],
    "computed import(expr) is invisible to the closure walker and must be justified before allowlisting"
  );
});

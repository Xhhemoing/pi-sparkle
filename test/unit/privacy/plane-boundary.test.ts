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
  "feedback"
] as const;

/**
 * Runtime-plane prefixes the adaptation plane must not reach into.
 *
 * `../supervisor/` and `../cli/` were added on 2026-08-24: the supervisor holds
 * the live orchestration engine and model router, and the CLI wires the live run
 * to disk, so both are runtime surfaces even though the original list only named
 * the record-bearing directories. `../routing/` stays deliberately narrow —
 * routing is a shared policy library, and the adaptation plane legitimately
 * imports its pure scoring helpers; only `cost-calibration` carries runtime cost
 * records.
 */
const RUNTIME_MODULES = [
  "../run/",
  "../episode/",
  "../telemetry/",
  "../config/",
  "../pi-adapter/",
  "../supervisor/",
  "../cli/",
  "../routing/cost-calibration"
] as const;

interface Exception {
  readonly module: string;
  readonly because: string;
  /** Set when the import must stay erased at runtime (`import type { ... }`). */
  readonly typeOnly?: true;
}

/** Allowed adaptation -> runtime imports, each with its justification. */
const ALLOWED: ReadonlyArray<Exception> = [
  // Type-only import of the runtime event shape; no data access.
  { module: "learning/auto-loop.ts -> ../run/events.js", because: "type-only Event shape", typeOnly: true },
  { module: "learning/signals.ts -> ../run/events.js", because: "type-only Event shape", typeOnly: true },
  // Derived-signal pipe: extracts taskSuccess PASS/FAIL only, never text.
  { module: "learning/from-episode.ts -> ../run/event-store.js", because: "sanctioned derived-signal reader (PASS/FAIL only)" },
  { module: "learning/from-episode.ts -> ../run/episode-bind.js", because: "episode id resolution for the derived-signal reader" },
  { module: "learning/from-episode.ts -> ../run/events.js", because: "type-only Event/ModelRoutedPayload shapes", typeOnly: true },
  // The direct model-router import is type-only, but eval-routing value-imports
  // routing/assign, which value-imports and loads model-router at runtime.
  // model-router has no filesystem or record access.
  {
    module: "adaptation/eval-routing.ts -> ../supervisor/model-router.js",
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
    edge: "learning/from-episode.ts -> run/event-store.ts",
    because: "sanctioned derived-signal reader extracts routed task PASS/FAIL only"
  },
  {
    edge: "learning/from-episode.ts -> run/episode-bind.ts",
    because: "resolves the episode id needed by the sanctioned derived-signal reader"
  },
  {
    edge: "routing/assign.ts -> supervisor/model-router.ts",
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

const VALUE_IMPORT_PATTERN =
  /\bimport\s+(?!type\b)[^;]*?\bfrom\s*"([^"]+)"|\bexport\s+(?!type\b)[^;]*?\bfrom\s*"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|^\s*import\s*"([^"]+)"/gm;

interface ImportEdge {
  readonly importer: string;
  readonly target: string;
}

interface ValueImportClosure {
  readonly members: ReadonlySet<string>;
  readonly edges: readonly ImportEdge[];
}

function valueImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(VALUE_IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
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

test("adaptation plane does not import runtime modules outside the allowlist", () => {
  const violations: string[] = [];
  for (const dir of ADAPTATION_DIRS) {
    for (const file of listTs(dir)) {
      const src = readSrc(file);
      for (const match of src.matchAll(/from "([^"]+)"/g)) {
        const target = match[1];
        const hitsRuntime = RUNTIME_MODULES.some((prefix) => (target ?? "").startsWith(prefix));
        if (!hitsRuntime) continue;
        const key = `${file.split("\\").join("/")} -> ${target}`;
        if (!ALLOWED.some((allowed) => allowed.module === key)) {
          violations.push(key);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("every allowlisted exception states its justification", () => {
  for (const entry of [...ALLOWED, ...ALLOWED_VALUE_RUNTIME_EDGES]) {
    assert.ok(entry.because.length > 5, "module" in entry ? entry.module : entry.edge);
  }
});

test("every allowlisted exception still exists and type-only ones stay erased", () => {
  const stale: string[] = [];
  const valueImports: string[] = [];
  for (const entry of ALLOWED) {
    const [file, target] = entry.module.split(" -> ");
    assert.ok(file !== undefined && target !== undefined, entry.module);
    const src = readSrc(file);
    const quoted = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`from "${quoted}"`).test(src)) {
      stale.push(entry.module);
      continue;
    }
    if (entry.typeOnly === true && !new RegExp(`import\\s+type\\s[^;]*from "${quoted}"`).test(src)) {
      valueImports.push(entry.module);
    }
  }
  assert.deepEqual(stale, [], "allowlisted import no longer exists; drop the exception");
  assert.deepEqual(valueImports, [], "allowlisted type-only import became a value import");
});

test("adaptation value-import closure enters runtime only through sanctioned readers", () => {
  const sources = loadSourceTable();
  const entries = ADAPTATION_DIRS.flatMap((dir) =>
    listTs(dir).map((file) => file.split("\\").join("/"))
  );
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

test("the allowlisted model router remains free of filesystem record access", () => {
  const modelRouter = readSrc("supervisor/model-router.ts");

  assert.doesNotMatch(
    modelRouter,
    /node:fs|\breadFile\b|\bwriteFile\b|\bappendFile\b/,
    "model-router must remain free of filesystem record access"
  );
});

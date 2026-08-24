import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  // Offline routing evaluation reproduces the live router's *configuration
  // shape* so replays stay comparable. Type-only, so nothing supervisor-side is
  // loaded at runtime and no live record is reachable from the adaptation plane.
  {
    module: "adaptation/eval-routing.ts -> ../supervisor/model-router.js",
    because: "type-only ModelRouterConfig shape for offline routing replay",
    typeOnly: true
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
  for (const entry of ALLOWED) {
    assert.ok(entry.because.length > 5, entry.module);
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

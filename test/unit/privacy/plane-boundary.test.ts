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

const RUNTIME_MODULES = ["../run/", "../episode/", "../telemetry/", "../config/", "../pi-adapter/", "../routing/cost-calibration"] as const;

/** Allowed adaptation -> runtime imports, each with its justification. */
const ALLOWED: ReadonlyArray<{ module: string; because: string }> = [
  // Type-only import of the runtime event shape; no data access.
  { module: "learning/auto-loop.ts -> ../run/events.js", because: "type-only Event shape" },
  { module: "learning/signals.ts -> ../run/events.js", because: "type-only Event shape" },
  // Derived-signal pipe: extracts taskSuccess PASS/FAIL only, never text.
  { module: "learning/from-episode.ts -> ../run/event-store.js", because: "sanctioned derived-signal reader (PASS/FAIL only)" },
  { module: "learning/from-episode.ts -> ../run/episode-bind.js", because: "episode id resolution for the derived-signal reader" },
  { module: "learning/from-episode.ts -> ../run/events.js", because: "type-only Event/ModelRoutedPayload shapes" }
];

function listTs(dir: string): string[] {
  const root = fileURLToPath(new URL("../../../src/", import.meta.url));
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
      const src = readFileSync(
        fileURLToPath(new URL(`../../../src/${file.split("\\").join("/")}`, import.meta.url)),
        "utf8"
      );
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

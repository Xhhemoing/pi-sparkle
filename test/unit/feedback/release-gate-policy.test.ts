import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The release gate is a policy split across two files: `scripts/security-probe.mjs`
// decides, `docs/specs/release-gate.md` is what an operator reads before shipping.
// Nothing else makes them agree, so drift between them is what these tests catch.
// They deliberately assert nothing about redaction behaviour — `redaction.test.ts`
// owns that.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPEC_PATH = join(REPO_ROOT, "docs", "specs", "release-gate.md");
const PROBE_PATH = join(REPO_ROOT, "scripts", "security-probe.mjs");

const spec = readFileSync(SPEC_PATH, "utf8");
const probe = readFileSync(PROBE_PATH, "utf8");

/** Every finding id the probe can emit, from its sample table and its literals. */
function probeIds(source: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(/\b(?:id|probe):\s*"([a-z0-9-]+)"/g)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort();
}

function section(source: string, heading: string): string {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `${heading} is missing from docs/specs/release-gate.md`);
  const rest = source.slice(start + heading.length);
  const end = rest.search(/^#{1,6} /m);
  return end === -1 ? rest : rest.slice(0, end);
}

test("every probe finding id is documented in the release-gate spec", () => {
  const ids = probeIds(probe);
  assert.ok(ids.length >= 3, `expected the probe to emit finding ids, parsed: ${ids.join(", ")}`);
  for (const id of ids) {
    assert.ok(
      spec.includes(`\`${id}\``),
      `probe finding "${id}" is not documented in docs/specs/release-gate.md`
    );
  }
});

test("the spec declares a dated GREEN or BLOCKED status under a Status heading", () => {
  // Same heading shape scripts/preview-release-probe.mjs looks for.
  const heading = /^#{1,6}[ \t]+Status(?:[ \t]*:.*)?(?:[ \t]+#+)?[ \t]*$/m.exec(spec);
  assert.notEqual(heading, null, "docs/specs/release-gate.md needs a Status heading");
  const line = heading?.[0] ?? "";
  assert.match(line, /\b(GREEN|BLOCKED)\b/, `status line states no verdict: ${line}`);
  assert.match(line, /\b20\d{2}-\d{2}-\d{2}\b/, `status line is undated: ${line}`);
});

test("a GREEN status cites the command that produced it", () => {
  if (!/^#{1,6}[ \t]+Status[^\n]*\bGREEN\b/m.test(spec)) return;
  assert.ok(
    spec.includes("scripts/security-probe.mjs") && spec.includes("scripts/pi-compat-probe.mjs"),
    "a GREEN status must name the probes it was proved with"
  );
  assert.ok(
    spec.includes('"openFindings": []'),
    "a GREEN status must record the probe output that showed no open findings"
  );
});

test("the waiver register is either empty or a table of recorded waivers", () => {
  const register = section(spec, "### Waiver register").trim();
  assert.notEqual(register, "", "the waiver register section must say what it holds");
  if (register === "(empty)") return;
  assert.ok(
    register.startsWith("|"),
    "a non-empty waiver register must be a table (id, reason, expiry), got:\n" + register
  );
  assert.match(register, /expiry/i, "each recorded waiver needs an expiry");
});

test("the spec and the probe name the same waiver switch, and packaged-secrets is never waivable", () => {
  assert.ok(probe.includes("SECURITY_WAIVER"), "the probe no longer reads SECURITY_WAIVER");
  assert.ok(spec.includes("SECURITY_WAIVER"), "the spec must name the waiver switch operators would use");
  assert.match(
    spec,
    /`packaged-secrets`[^.]*\*\*never waivable\*\*/,
    "the spec must keep the unconditional block on packaged credential material"
  );
});

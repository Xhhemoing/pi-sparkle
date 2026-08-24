import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

const LIVE_PLANE = [
  "src/cli/main.ts",
  "src/run/coordinator.ts",
  "src/run/child-tracking.ts",
  "src/run/flowchart-run.ts",
  "src/run/supervisor.ts",
  "src/supervisor/flowchart-supervisor.ts",
  "src/supervisor/model-router.ts",
  "src/routing/assign.ts",
  "src/track/loop.ts",
  "src/track/primary-split.ts"
];

/** Live selectors only. Walking `src/cli/main.ts` would reach bandit via post-run `runAutoAdaptLoop`. */
const LIVE_SELECTORS = ["src/supervisor/model-router.ts", "src/routing/assign.ts"];

const FORBIDDEN_SELECTOR_MODULES = [
  /(?:^|[/\\])routing[/\\]r1\.ts$/,
  /(?:^|[/\\])routing[/\\]bandit\.ts$/,
  /(?:^|[/\\])routing[/\\]shadow\.ts$/,
  /(?:^|[/\\])routing[/\\]r1-shadow-report\.ts$/,
  /(?:^|[/\\])routing[/\\]propensity\.ts$/,
  /(?:^|[/\\])experiments[/\\]simulation-holdout\.ts$/
];

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g;

test("live execution plane does not import R1, bandit, or shadow routers", async () => {
  for (const file of LIVE_PLANE) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /routing\/r1/, `${file} must not import R1`);
    assert.doesNotMatch(text, /routing\/bandit/, `${file} must not import bandit`);
    assert.doesNotMatch(text, /routing\/shadow/, `${file} must not import shadow`);
    assert.doesNotMatch(text, /r1-shadow-report/, `${file} must not import r1-shadow-report`);
    assert.doesNotMatch(text, /simulation-holdout/, `${file} must not import simulation-holdout`);
  }
});

test("live selectors do not reach R1 bandit shadow propensity or holdout transitively", async () => {
  for (const entry of LIVE_SELECTORS) {
    const reachable = await collectTransitiveImports(entry);
    for (const file of reachable) {
      assert.ok(
        !FORBIDDEN_SELECTOR_MODULES.some((pattern) => pattern.test(file)),
        `${entry} must not reach ${file}`
      );
    }
    assert.ok(reachable.has(entry), `${entry} must include itself`);
  }
});

test("DAG supervisor parks topology routing instead of calling it per round", async () => {
  const text = await readFile("src/run/supervisor.ts", "utf8");
  assert.match(text, /the current run loop does NOT call this yet/);
  assert.equal(
    (text.match(/planTaskTopology/g) ?? []).length,
    1,
    "planTaskTopology must stay defined but unused in the live loop"
  );
});

test("live ModelRouter may import R0 eligibility helpers but not R1/bandit/shadow", async () => {
  const text = await readFile("src/supervisor/model-router.ts", "utf8");
  assert.doesNotMatch(text, /routing\/r1/, "model-router must not import R1");
  assert.doesNotMatch(text, /routing\/bandit/, "model-router must not import bandit");
  assert.doesNotMatch(text, /routing\/shadow/, "model-router must not import shadow");
  assert.match(text, /evaluateLiveCandidate/);
});

async function collectTransitiveImports(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const resolved = resolveRelativeImport(file, match[1]!);
      assert.ok(resolved !== undefined, `${file} imports ${match[1]} but the file was not found`);
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

function resolveRelativeImport(fromFile: string, spec: string): string | undefined {
  const stripped = spec.replace(/\.js$/u, "");
  const base = join(dirname(fromFile), stripped);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

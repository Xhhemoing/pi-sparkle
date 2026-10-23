import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function sameExports(legacy: Record<string, unknown>, canonical: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(canonical).sort());
  for (const key of Object.keys(legacy)) assert.equal(legacy[key], canonical[key], key);
}

test("root lab CLI forwards the same implementation and behavior", async () => {
  sameExports(await import("../../../lab/cli.js"), await import("../../../src/lab/cli.js"));
});

test("root lab flowchart forwards every export with the same identity", async () => {
  sameExports(await import("../../../lab/flowchart.js"), await import("../../../src/lab/flowchart.js"));
});

test("old bandit path forwards every export with the same identity", async () => {
  sameExports(await import("../../../src/routing/bandit.js"), await import("../../../src/lab/routing/bandit.js"));
});

test("old drift path forwards every export with the same identity", async () => {
  sameExports(await import("../../../src/routing/drift.js"), await import("../../../src/lab/routing/drift.js"));
});

test("old shadow path forwards every export with the same identity", async () => {
  sameExports(await import("../../../src/routing/shadow.js"), await import("../../../src/lab/routing/shadow.js"));
});

const relocatedGroups = {
  learning: ["attribution", "auto-loop", "bandit-store", "diagnostics", "eval-dataset", "from-episode",
    "learned-routing", "observation-ledger", "patterns", "signals", "signatures", "task-success"],
  adaptation: ["active-pointer", "approval-profile", "candidate", "eval-routing", "monitor", "mutate", "pareto",
    "promotion-rules", "promotion", "reflection", "registry", "resource", "retirement", "rollback"],
  experiments: ["arm-outcome", "attribution-report", "canary", "comparison-report", "dataset", "evaluation-card",
    "freeze", "gated-comparison", "holdout", "isolation", "manifest", "plan", "readonly-evaluator-manifest",
    "replay", "shadow-compare", "shadow", "simulation-holdout", "task-spec", "threshold-calibration"],
  routing: ["assign", "r1", "r1-shadow-report", "posterior", "offline-types", "offline-logit", "offline-prob-add", "lin-alg", "propensity"],
  evaluation: ["adapters", "check-adapter", "delivery-adapter", "diff-adapter", "invalidation", "ownership", "precedence"]
} as const;

for (const [group, names] of Object.entries(relocatedGroups)) {
  for (const name of names) test(`old ${group}/${name} forwards all canonical runtime exports`, async () => {
    sameExports(await import(`../../../src/${group}/${name}.js`), await import(`../../../src/lab/${group}/${name}.js`));
  });
}

for (const entry of ["lab/cli.ts", "src/lab/cli.ts"]) test(`${entry} source launcher executes help once`, () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], {
    cwd: root, encoding: "utf8", timeout: 20_000
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ""}${result.stderr}`);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.split("Usage:").length - 1, 1);
  assert.match(result.stdout, /Default\s+--children uses static routing/);
});

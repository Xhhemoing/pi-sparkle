import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { clarifyObjective } from "../../../src/track/clarify.js";
import { planFromContract } from "../../../src/track/plan.js";
import { configurePreferencePersistence, recordExplicitPreference, clearAll } from "../../../src/preferences/service.js";
import { createEpisodeId, type IdGenerator } from "../../../src/domain/ids.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

function sequentialIds(): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `seq${String(n).padStart(4, "0")}`;
  };
}

test("a vague objective waits for clarifying questions unless defaults are assumed", async () => {
  const vague = await clarifyObjective({ objective: "do it", projectKey: "proj-a" });
  assert.equal(vague.waiting, true);
  assert.ok(vague.questions.length >= 1);

  const assumed = await clarifyObjective({
    objective: "do it",
    projectKey: "proj-a",
    assumeDefaults: true
  });
  assert.equal(assumed.waiting, false);
});

test("investigation-only answers plan a scout and skip implementation", async () => {
  const clarified = await clarifyObjective({
    objective: "Investigate the checkout parser",
    projectKey: "proj-invest",
    assumeDefaults: true
  });
  const plan = planFromContract({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    answers: { "q-done": "investigation only" }
  });
  assert.deepEqual(
    plan.map((child) => child.role),
    ["planner", "scout"]
  );
});

test("an explicit implement objective plans scout, implement, review and optional tests", async () => {
  const clarified = await clarifyObjective({
    objective: "Implement the checkout parser and add tests",
    projectKey: "proj-b",
    assumeDefaults: true
  });
  const plan = planFromContract({ contract: clarified.candidate.contract, habits: clarified.habits });
  const roles = plan.map((child) => child.role);
  assert.equal(roles[0], "planner");
  assert.ok(roles.includes("implementer"));
  assert.ok(roles.includes("tester"));
  assert.ok(roles.includes("reviewer"));
  const impl = plan.find((child) => child.role === "implementer");
  const tester = plan.find((child) => child.role === "tester");
  assert.ok(impl);
  assert.ok(tester?.dependsOn.includes(impl!.taskId));
});

test("an answered q-scope grounds every planned objective", async () => {
  const clarified = await clarifyObjective({
    objective: "fix the typo in the readme",
    projectKey: "proj-scope",
    assumeDefaults: true
  });
  assert.ok(clarified.candidate.contract.questions.some((question) => question.id === "q-scope"));
  const plan = planFromContract({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    answers: { "q-scope": "docs/readme.md, docs/usage.md" }
  });
  assert.ok(plan.length > 1);
  for (const child of plan) {
    assert.match(child.objective, /\(scope: docs\/readme\.md, docs\/usage\.md\)$/);
  }
});

test("the q-scope discovery answer plans the scout the objective alone would skip", async () => {
  const clarified = await clarifyObjective({
    objective: "fix the typo in the readme",
    projectKey: "proj-scope-scout",
    assumeDefaults: true
  });
  const unanswered = planFromContract({
    contract: clarified.candidate.contract,
    habits: clarified.habits
  });
  assert.equal(unanswered.some((child) => child.role === "scout"), false);

  const discovered = planFromContract({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    answers: { "q-scope": "let scout discover them" }
  });
  assert.equal(discovered.some((child) => child.role === "scout"), true);
  for (const child of discovered) {
    assert.doesNotMatch(child.objective, /scope:/);
  }
});

test("q-scope answers that name nothing leave the plan unchanged", async () => {
  const clarified = await clarifyObjective({
    objective: "fix the typo in the readme",
    projectKey: "proj-scope-none",
    assumeDefaults: true
  });
  const base = planFromContract({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    generateId: sequentialIds()
  });
  for (const answer of ["I will paste paths", "the files named in the objective", "  "]) {
    const plan = planFromContract({
      contract: clarified.candidate.contract,
      habits: clarified.habits,
      answers: { "q-scope": answer },
      generateId: sequentialIds()
    });
    assert.deepEqual(plan, base, `answer ${JSON.stringify(answer)} should not change the plan`);
  }
});

test("a recorded require-tests habit skips the tests question", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-habits-"));
  try {
    configurePreferencePersistence(join(dir, "adaptation", "preferences.json"));
    recordExplicitPreference("project", "proj-c", "require-tests", true, createEpisodeId());
    const result = await clarifyObjective({
      objective: "Implement the parser module",
      projectKey: "proj-c",
      assumeDefaults: false
    });
    assert.equal(result.habits.requireTests, true);
    assert.equal(result.questions.some((question) => question.id === "q-tests"), false);
  } finally {
    clearAll();
    configurePreferencePersistence(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

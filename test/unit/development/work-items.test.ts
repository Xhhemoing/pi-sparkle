import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkQueue, selectNextWorkItem, validateWorkQueue, type WorkItemDefinition } from "../../../src/development/work-items.js";

function item(id: string, extra: Partial<WorkItemDefinition> = {}): WorkItemDefinition {
  return { id, goal: `Complete ${id}`, dependencies: [], allowedScope: [`src/${id}`], priority: 10,
    acceptance: [{ id: "tests", command: "node", args: ["--test"], verifierVersion: "tests-v1" }], ...extra };
}

test("work queue rejects unknown fields, unsafe scopes, duplicate ids and invalid budgets", () => {
  const base = { id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] };
  for (const invalid of [
    { ...base, hiddenAuthority: true },
    { ...base, items: [item("a", { allowedScope: ["../outside"] })] },
    { ...base, items: [item("a", { allowedScope: ["/absolute"] })] },
    { ...base, items: [item("a", { allowedScope: [".git/config"] })] },
    { ...base, items: [item("a", { allowedScope: ["src/*"] })] },
    { ...base, items: [item("a", { priority: Number.NaN })] },
    { ...base, items: [item("a"), item("a")] },
    { ...base, items: [item("a", { acceptance: [] })] },
    { ...base, items: Array.from({ length: 129 }, (_, index) => item(`a${index}`)) }
  ]) assert.throws(() => createWorkQueue(invalid as typeof base));
});

test("unknown, repeated and cyclic dependencies fail before selection", () => {
  for (const items of [
    [item("a", { dependencies: ["missing"] })],
    [item("a", { dependencies: ["a"] })],
    [item("a"), item("b", { dependencies: ["a", "a"] })],
    [item("a", { dependencies: ["b"] }), item("b", { dependencies: ["a"] })]
  ]) assert.throws(() => createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items }));
});

test("selection is deterministic by ready dependency, priority and id without mutating input", () => {
  const queue = createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [
    item("z", { priority: 100, dependencies: ["a"] }), item("b", { priority: 20 }), item("a", { priority: 20 })
  ] });
  const before = JSON.stringify(queue);
  assert.equal(selectNextWorkItem(queue)?.id, "a");
  assert.equal(JSON.stringify(queue), before);
  assert.equal(Object.isFrozen(queue.items[0]?.definition.acceptance[0]?.args), true);
});

test("status-only accepted and ready records cannot fabricate completed evidence", () => {
  const queue = createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] });
  for (const status of ["accepted", "ready-for-review", "running", "blocked"]) {
    const raw = structuredClone(queue);
    (raw.items[0] as { status: string }).status = status;
    assert.throws(() => validateWorkQueue(raw));
  }
});

test("the host definition is snapshotted and unknown persisted fields fail closed", () => {
  const definition = item("a");
  const queue = createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [definition] });
  (definition.acceptance[0]!.args as string[]).push("changed");
  assert.deepEqual(queue.items[0]!.definition.acceptance[0]!.args, ["--test"]);
  assert.throws(() => validateWorkQueue({ ...queue, success: true }));
});

test("persisted claimed descendants cannot bypass unresolved transitive prerequisites", () => {
  const queue = createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [
    item("a"), item("b", { dependencies: ["a"] }), item("c", { dependencies: ["b"], priority: 100 })
  ] });
  const claim = { token: "host-claim", owner: "host", baseRevision: "a".repeat(40), startedAt: "2026-10-15T00:00:00.000Z" };
  const evidence = [{ source: "host-command", workItemId: "b", baseRevision: claim.baseRevision,
    recipeId: "tests", verifierVersion: "tests-v1", command: "node", args: ["--test"], artifactRef: "runs/b",
    checkId: "host-check", exitCode: 0 }];
  for (const status of ["running", "blocked", "ready-for-review", "accepted"]) {
    const descendant = { definition: queue.items[1]!.definition, status, claim,
      ...(status === "blocked" ? { blockedReason: "host investigation" } : {}),
      ...(status === "ready-for-review" || status === "accepted" ? { evidence } : {}) };
    const persisted = { ...queue, items: [queue.items[0], descendant, queue.items[2]] };
    assert.throws(() => validateWorkQueue(persisted), /prerequisites must be accepted/, status);
  }
});

test("recipe protected paths are bounded safe literals and survive immutable round trips", () => {
  const protectedPaths = ["test/acceptance.mjs", "config/checker.json"];
  const definition = item("a");
  const baseRecipe = definition.acceptance[0]!;
  const make = (value: unknown) => createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md",
    items: [{ ...definition, acceptance: [{ ...baseRecipe, protectedPaths: value } as never] }] });
  const queue = make(protectedPaths);
  protectedPaths.push("later-mutation");
  const stored = queue.items[0]!.definition.acceptance[0]! as typeof baseRecipe & { protectedPaths: readonly string[] };
  assert.deepEqual(stored.protectedPaths, ["test/acceptance.mjs", "config/checker.json"]);
  assert.equal(Object.isFrozen(stored.protectedPaths), true);
  assert.deepEqual(validateWorkQueue(JSON.parse(JSON.stringify(queue))), queue);
  assert.deepEqual((make([]).items[0]!.definition.acceptance[0]! as typeof stored).protectedPaths, []);
  for (const invalid of [["../checker"], ["/checker"], [".git/config"], ["test/*"], ["test\\checker"],
    ["test/checker", "test/checker"], Array.from({ length: 17 }, (_, index) => `test/checker${index}`),
    Array(1), Object.defineProperty([], "0", { get: () => "test/checker" }), null, "test/checker"]) {
    assert.throws(() => make(invalid));
  }
  const legacy = createWorkQueue({ id: "legacy", authorityRef: "tasks/plan.md", items: [definition] });
  assert.equal(Object.hasOwn(legacy.items[0]!.definition.acceptance[0]!, "protectedPaths"), false);
});

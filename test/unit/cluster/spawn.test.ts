import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { validateSpawn } from "../../../src/cluster/spawn.js";

test("planner can spawn an implementer within depth and fan-out limits", () => {
  assert.equal(
    validateSpawn({
      parentRole: "planner",
      parentCanDelegate: true,
      childRole: "implementer",
      objective: "Write the parser",
      depth: 0,
      spawnsByParent: 0,
      liveTaskCount: 1,
      maxTasks: 16
    }),
    "implementer"
  );
});

test("implementer cannot spawn, and unknown roles fail closed", () => {
  assert.throws(
    () =>
      validateSpawn({
        parentRole: "implementer",
        parentCanDelegate: false,
        childRole: "tester",
        objective: "test",
        depth: 0,
        spawnsByParent: 0,
        liveTaskCount: 1,
        maxTasks: 16
      }),
    DomainValidationError
  );
  assert.throws(
    () =>
      validateSpawn({
        parentRole: "planner",
        parentCanDelegate: true,
        childRole: "wizard",
        objective: "nope",
        depth: 0,
        spawnsByParent: 0,
        liveTaskCount: 1,
        maxTasks: 16
      }),
    /unknown spawn role/
  );
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseChildCostCeiling, parseChildSpec } from "../../../src/cli/children-spec.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseTaskId } from "../../../src/domain/ids.js";

async function withSpec(contents: unknown, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-children-spec-"));
  try {
    const path = join(dir, "children.json");
    await writeFile(path, typeof contents === "string" ? contents : JSON.stringify(contents), "utf8");
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parseChildSpec keeps roles, dependsOn, limits and the declared cost ceiling", async () => {
  await withSpec(
    {
      tasks: [
        { id: "tsk_parse", role: "implementer", objective: "Write the parser" },
        {
          id: "tsk_test",
          role: "tester",
          objective: "Test the parser",
          dependsOn: ["tsk_parse"],
          acceptanceCriteria: [{ id: "ac1", description: "tests pass" }],
          inputArtifactIds: ["art_input"],
          limits: { maxAttempts: 3, timeoutMs: 1_000, maxCostUsd: 0.5 }
        }
      ]
    },
    async (path) => {
      const tasks = await parseChildSpec(path);
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]?.role, "implementer");
      assert.equal(tasks[0]?.dependsOn, undefined);
      assert.equal(Object.hasOwn(tasks[0] ?? {}, "dependsOn"), false);
      assert.deepEqual(tasks[0]?.acceptanceCriteria, []);
      assert.deepEqual(tasks[0]?.inputArtifactIds, []);
      assert.equal(tasks[0]?.limits.maxAttempts, 1);
      assert.equal(tasks[0]?.limits.timeoutMs, 60_000);
      assert.equal(tasks[0]?.limits.maxCostUsd, undefined);
      assert.deepEqual(tasks[1]?.dependsOn, [parseTaskId("tsk_parse")]);
      assert.deepEqual(tasks[1]?.acceptanceCriteria, [{ id: "ac1", description: "tests pass" }]);
      assert.deepEqual(tasks[1]?.inputArtifactIds, ["art_input"]);
      assert.equal(tasks[1]?.limits.maxAttempts, 3);
      assert.equal(tasks[1]?.limits.maxCostUsd, 0.5);
      assert.ok(tasks[1]?.profile !== undefined, "each task resolves an agent profile");
    }
  );
});

for (const field of ["dependsOn", "acceptanceCriteria", "inputArtifactIds"]) {
  for (const value of ["tsk_parse", {}, null, 42, true, false]) {
    test(`parseChildSpec refuses ${field}: ${JSON.stringify(value)}`, async () => {
      await withSpec(
        { tasks: [{ id: "tsk_a", role: "implementer", objective: "A", [field]: value }] },
        async (path) => {
          await assert.rejects(parseChildSpec(path), (error: unknown) => {
            assert.ok(error instanceof DomainValidationError);
            assert.equal(error.message, `Child task tsk_a: ${field} must be an array`);
            return true;
          });
        }
      );
    });
  }
}

test("parseChildSpec preserves explicitly empty lists", async () => {
  await withSpec(
    {
      tasks: [{
        id: "tsk_a",
        role: "implementer",
        objective: "A",
        dependsOn: [],
        acceptanceCriteria: [],
        inputArtifactIds: []
      }]
    },
    async (path) => {
      const tasks = await parseChildSpec(path);
      assert.deepEqual(tasks[0]?.dependsOn, []);
      assert.deepEqual(tasks[0]?.acceptanceCriteria, []);
      assert.deepEqual(tasks[0]?.inputArtifactIds, []);
    }
  );
});

test("parseChildSpec still refuses malformed list elements", async () => {
  for (const [field, value, message] of [
    ["dependsOn", ["invalid"], /Invalid TaskId/],
    ["acceptanceCriteria", [null], /acceptanceCriteria must be objects/],
    ["acceptanceCriteria", [{}], /acceptanceCriteria need \{id, description\}/],
    ["inputArtifactIds", ["invalid"], /invalid inputArtifactId/]
  ] as const) {
    await withSpec(
      { tasks: [{ id: "tsk_a", role: "implementer", objective: "A", [field]: value }] },
      async (path) => {
        await assert.rejects(parseChildSpec(path), (error: unknown) => {
          assert.ok(error instanceof DomainValidationError);
          assert.match(error.message, message);
          return true;
        });
      }
    );
  }
});

test("parseChildSpec still refuses a duplicate task id", async () => {
  await withSpec(
    {
      tasks: [
        { id: "tsk_same", role: "implementer", objective: "A" },
        { id: "tsk_same", role: "tester", objective: "B" }
      ]
    },
    async (path) => {
      await assert.rejects(parseChildSpec(path), /Duplicate child task id: tsk_same/);
    }
  );
});

test("parseChildSpec refuses an unknown role, an empty objective and a bad shape", async () => {
  await withSpec({ tasks: [{ id: "tsk_a", role: "wizard", objective: "A" }] }, async (path) => {
    await assert.rejects(parseChildSpec(path), /role must be a known AgentRole/);
  });
  await withSpec({ tasks: [{ id: "tsk_a", role: "worker", objective: "  " }] }, async (path) => {
    await assert.rejects(parseChildSpec(path), /objective must be a non-empty string/);
  });
  await withSpec({ children: [] }, async (path) => {
    await assert.rejects(parseChildSpec(path), /Child spec must be/);
  });
  await withSpec("{ not json", async (path) => {
    await assert.rejects(parseChildSpec(path), /Invalid child spec/);
  });
});

test("parseChildCostCeiling refuses anything but a positive finite number", () => {
  const taskId = parseTaskId("tsk_a");
  assert.equal(parseChildCostCeiling(taskId, undefined), undefined);
  assert.equal(parseChildCostCeiling(taskId, 1.5), 1.5);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
    assert.throws(
      () => parseChildCostCeiling(taskId, bad),
      /limits\.maxCostUsd must be a positive finite number/
    );
  }
});

test("parseChildSpec carries a declared per-task model pin", async () => {
  await withSpec(
    {
      tasks: [
        { id: "tsk_free", role: "implementer", objective: "Routed task" },
        { id: "tsk_pinned", role: "reviewer", objective: "Pinned task", model: "openai/gpt-4o-mini" }
      ]
    },
    async (path) => {
      const tasks = await parseChildSpec(path);
      assert.equal(tasks[0]?.pinnedModel, undefined);
      assert.equal(tasks[1]?.pinnedModel, "openai/gpt-4o-mini");
    }
  );
});

test("parseChildModelPin refuses anything but a non-empty string", async () => {
  const { parseChildModelPin } = await import("../../../src/cli/children-spec.js");
  const taskId = parseTaskId("tsk_a");
  assert.equal(parseChildModelPin(taskId, undefined), undefined);
  assert.equal(parseChildModelPin(taskId, "openai/gpt-4o-mini"), "openai/gpt-4o-mini");
  for (const bad of ["", "   ", 42, null, ["openai/gpt-4o-mini"], { id: "x" }]) {
    assert.throws(
      () => parseChildModelPin(taskId, bad),
      /model must be a non-empty catalog model id string/
    );
  }
  await withSpec({ tasks: [{ id: "tsk_a", role: "worker", objective: "A", model: "" }] }, async (path) => {
    await assert.rejects(parseChildSpec(path), /model must be a non-empty catalog model id string/);
  });
});

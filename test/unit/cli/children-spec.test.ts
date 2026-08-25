import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseChildCostCeiling, parseChildSpec } from "../../../src/cli/children-spec.js";
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
          limits: { maxAttempts: 3, timeoutMs: 1_000, maxCostUsd: 0.5 }
        }
      ]
    },
    async (path) => {
      const tasks = await parseChildSpec(path);
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]?.role, "implementer");
      assert.equal(tasks[0]?.dependsOn, undefined);
      assert.equal(tasks[0]?.limits.maxAttempts, 1);
      assert.equal(tasks[0]?.limits.timeoutMs, 60_000);
      assert.equal(tasks[0]?.limits.maxCostUsd, undefined);
      assert.deepEqual(tasks[1]?.dependsOn, [parseTaskId("tsk_parse")]);
      assert.deepEqual(tasks[1]?.acceptanceCriteria, [{ id: "ac1", description: "tests pass" }]);
      assert.equal(tasks[1]?.limits.maxAttempts, 3);
      assert.equal(tasks[1]?.limits.maxCostUsd, 0.5);
      assert.ok(tasks[1]?.profile !== undefined, "each task resolves an agent profile");
    }
  );
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

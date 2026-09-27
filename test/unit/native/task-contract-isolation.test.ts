import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NativeSession, type NativeTask } from "../../../src/native/session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

async function fixture(body: (root: string, session: NativeSession) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "contract-isolation-"));
  const session = new NativeSession();
  try { await body(root, session); }
  finally { await session.shutdown(); await rm(root, { recursive: true, force: true }); }
}
const task = (name: string) => ({ role: "scout" as const, objective: `Inspect ${name}`,
  contract: { scope: [`src/${name}.ts`], prohibitions: [`restriction-${name}`],
    acceptanceCriteria: [{ id: "ac", description: `Inspect ${name}`, observableCheck: `evidence-${name}` }] } });

test("parallel native tasks keep separate constraints and bind cards to actual child ids", async () => {
  await fixture(async (root, session) => {
    const seen = new Map<string, string>();
    const result = await session.delegate({ projectRoot: root, stateRoot: join(root, "state"),
      model: { provider: "fixture", id: "model" }, tasks: [task("alpha"), task("beta")],
      executor: { execute(request, signal) { seen.set(request.taskId, request.prompt); return new ProtocolChildExecutor().execute(request, signal); } }
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.taskContracts!.length, 2);
    assert.deepEqual(result.taskContracts!.map((card) => card.taskId).sort(), result.results.map((item) => item.taskId).sort());
    for (const card of result.taskContracts!) {
      const name = card.contract.objective.includes("alpha") ? "alpha" : "beta";
      const other = name === "alpha" ? "beta" : "alpha";
      assert.match(seen.get(card.taskId)!, new RegExp(`restriction-${name}`));
      assert.doesNotMatch(seen.get(card.taskId)!, new RegExp(`restriction-${other}`));
    }
  });
});

test("one invalid sibling contract prevents the whole delegation from starting", async () => {
  await fixture(async (root, session) => {
    let executed = false;
    await assert.rejects(session.delegate({ projectRoot: root, stateRoot: join(root, "state"),
      model: { provider: "fixture", id: "model" },
      tasks: [task("alpha"), { ...task("beta"), contract: { command: "sh" } }] as unknown as NativeTask[],
      executor: { execute(request, signal) { executed = true; return new ProtocolChildExecutor().execute(request, signal); } }
    }), /contract/);
    assert.equal(executed, false);
    assert.equal(session.activeCount, 0);
    await assert.rejects(readdir(join(root, "state")), { code: "ENOENT" });
  });
});

test("caller mutation after delegate cannot change the admitted contract snapshot", async () => {
  await fixture(async (root, session) => {
    const original = task("alpha");
    const pending = session.delegate({ projectRoot: root, stateRoot: join(root, "state"),
      model: { provider: "fixture", id: "model" }, tasks: [original], executor: new ProtocolChildExecutor() });
    original.contract.prohibitions[0] = "mutated-after-admission";
    const result = await pending;
    assert.match(JSON.stringify(result.taskContracts), /restriction-alpha/);
    assert.doesNotMatch(JSON.stringify(result.taskContracts), /mutated-after-admission/);
  });
});

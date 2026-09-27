import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NativeSession, type NativeDelegateInput, type NativeDelegateResult } from "../../../src/native/session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { RequirementContract } from "../../../src/domain/contract.js";

const contract = () => ({
  scope: ["src/auth/login.ts"],
  prohibitions: ["Do not modify files or run shell commands"],
  deliverables: ["Report with observed paths and evidence"],
  acceptanceCriteria: [{ id: "timeout", description: "Identify the timeout branch", observableCheck: "Cite the branch and relevant test path" }],
  sourceRefs: [{ kind: "message" as const, ref: "user-current-task" }]
});
async function roots(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "native-contract-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function input(root: string, value: unknown, seen: string[]): NativeDelegateInput {
  const task = { role: "scout" as const, objective: "Inspect the login timeout", contract: value };
  return {
    projectRoot: root, stateRoot: join(root, "state"), model: { provider: "fixture", id: "model" },
    tasks: [task] as unknown as NativeDelegateInput["tasks"],
    executor: { execute(request, signal) { seen.push(request.prompt); return new ProtocolChildExecutor().execute(request, signal); } }
  };
}
function cards(result: NativeDelegateResult): readonly { taskId: string; contract: RequirementContract }[] {
  // The cast lets this behavioral regression compile against the pre-feature baseline.
  return (result as NativeDelegateResult & { taskContracts?: readonly { taskId: string; contract: RequirementContract }[] }).taskContracts ?? [];
}

test("native contract reaches execution, parent events and a bound readonly task card", async () => {
  await roots(async (root) => {
    const session = new NativeSession();
    const seen: string[] = [];
    try {
      const result = await session.delegate(input(root, contract(), seen));
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.independentVerification, "UNOBSERVED");
      assert.match(seen[0]!, /src\/auth\/login\.ts/);
      assert.match(seen[0]!, /Do not modify files or run shell commands/);
      assert.match(seen[0]!, /Cite the branch and relevant test path/);
      assert.equal(cards(result).length, 1);
      const card = cards(result)[0]!;
      assert.equal(card.taskId, result.results[0]!.taskId);
      assert.deepEqual(card.contract.authority, []);
      assert.deepEqual(card.contract.deliverables.map((item) => item.artifactKind), ["report"]);
      assert.ok(card.contract.constraints.some((item) => item.id.endsWith("read-only")));
      assert.equal(card.contract.acceptanceCriteria.length, 1);
      const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
      assert.ok(JSON.stringify(events).includes("Cite the branch and relevant test path"));
      assert.match(result.text, /Task contract/);
      assert.match(result.text, /UNOBSERVED/);
    } finally { await session.shutdown(); }
  });
});

const invalids: [string, unknown][] = [
  ["null", null], ["array", []], ["write mode", { ...contract(), mode: "write" }],
  ["authority", { ...contract(), authority: [{ scope: "*", actions: ["write"] }] }],
  ["command", { ...contract(), command: "sh" }],
  ["empty scope item", { ...contract(), scope: [" "] }],
  ["scope count", { ...contract(), scope: Array(9).fill("src/file.ts") }],
  ["oversized text", { ...contract(), prohibitions: ["x".repeat(513)] }],
  ["duplicate criterion", { ...contract(), acceptanceCriteria: [...contract().acceptanceCriteria, ...contract().acceptanceCriteria] }],
  ["missing check", { ...contract(), acceptanceCriteria: [{ id: "ac", description: "check" }] }],
  ["source kind", { ...contract(), sourceRefs: [{ kind: "authority", ref: "x" }] }],
  ["source extra permission", { ...contract(), sourceRefs: [{ kind: "message", ref: "x", authority: "user" }] }]
];
for (const [label, value] of invalids) {
  test(`invalid native contract fails before execution or persistence: ${label}`, async () => {
    await roots(async (root) => {
      const session = new NativeSession();
      const seen: string[] = [];
      try {
        await assert.rejects(session.delegate(input(root, value, seen)), /contract/i);
        assert.deepEqual(seen, []);
        assert.equal(session.activeCount, 0);
        await assert.rejects(readdir(join(root, "state")), { code: "ENOENT" });
      } finally { await session.shutdown(); }
    });
  });
}

test("legacy native task without a contract keeps its original request and disclosure", async () => {
  await roots(async (root) => {
    const session = new NativeSession();
    const seen: string[] = [];
    try {
      const result = await session.delegate(input(root, undefined, seen));
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.independentVerification, "UNOBSERVED");
      assert.equal(cards(result).length, 0);
      assert.ok(!seen[0]!.includes("Read-only task contract"));
    } finally { await session.shutdown(); }
  });
});

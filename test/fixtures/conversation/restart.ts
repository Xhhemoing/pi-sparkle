import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { saveConversationReferences } from "../../../src/conversation/recovery.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const [mode, root] = process.argv.slice(2);
assert.ok(root);
const sourceRepo = path.join(root, "source");
const stateRoot = path.join(root, "state");
const referenceFile = path.join(root, "references.json");
const main = { projectRef: "project", taskRef: "arbitrary-host-task" };
const side = { projectRef: "project", taskRef: "side" };
const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { loadExtensions } = await import(loaderUrl.href);
let options: unknown;
if (mode === "produce") {
  options = { conversation: { projects: [{ projectRef: "project" }], tasks: [main, side].map((target) => ({ ...target, input: {
    sourceRepo, stateRoot, sandboxRoot: path.join(root, "candidates"), objective: "Update value.txt",
    verification: { command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='after')process.exit(1)"] },
    executorFactory: ({ tools }: { tools: { name: string; execute: (...args: unknown[]) => unknown }[] }) => ({
      async *execute(request: Parameters<ProtocolChildExecutor["execute"]>[0], signal: AbortSignal) {
        await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", { path: "value.txt", oldText: "before", newText: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      }
    })
  } })) } };
} else {
  const receipt = JSON.parse(await readFile(path.join(root, "receipt.json"), "utf8"));
  options = { conversationRecovery: { referenceFile, projects: [{ projectRef: "project", sourceRepo, stateRoot }],
    tasks: [{ ...main, kind: "direct", runId: receipt.runId, artifactId: receipt.artifactId, sourceRevision: receipt.sourceRevision }, { ...side, kind: "direct" }] } };
}
(globalThis as unknown as Record<string, unknown>).recoveryFixtureOptions = options;
const wrapper = path.join(root, `wrapper-${mode}.ts`);
await writeFile(wrapper, `import { createSparkleExtension } from ${JSON.stringify(path.join(process.cwd(), "extensions/pi-sparkle/index.ts").replaceAll("\\", "/"))}; export default createSparkleExtension(globalThis.recoveryFixtureOptions);`, "utf8");
const loaded = await loadExtensions([wrapper], process.cwd());
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
async function tool(name: string, parameters: unknown) {
  const registered = extension.tools.get(name);
  assert.ok(registered, `recovery factory must register ${name}`);
  return (await registered.definition.execute("fixture", parameters, undefined, undefined, {})).details;
}
const focus = () => tool("sparkle_conversation_focus", {});
const request = (params: unknown) => tool("sparkle_conversation", params);
if (mode === "produce") {
  await request({ kind: "focus", target: main, focus: (await focus()).focus.token, messageRef: "main" });
  const result = await request({ kind: "run-direct", target: main, focus: (await focus()).focus.token, requestId: "run", messageRef: "run" });
  assert.equal(result.result.acceptance.accepted, true);
  await request({ kind: "focus", target: side, temporary: true, focus: (await focus()).focus.token, messageRef: "side" });
  const snapshot = (await focus()).focus;
  await saveConversationReferences(referenceFile, snapshot);
  await writeFile(path.join(root, "receipt.json"), JSON.stringify({ runId: result.result.runId, artifactId: result.result.artifact.id,
    sourceRevision: result.result.sourceRevision, generation: snapshot.token.generation, candidatePath: result.result.candidatePath }), "utf8");
} else {
  const snapshot = (await focus()).focus;
  assert.deepEqual(snapshot.current, side);
  assert.equal(snapshot.suspended.taskRef, main.taskRef);
  await request({ kind: "restore", focus: snapshot.token, messageRef: "restore" });
  const restored = (await focus()).focus;
  assert.equal((await request({ kind: "question", focus: restored.token, messageRef: "question" })).kind, "question");
  const status = await request({ kind: "status", focus: restored.token, messageRef: "status" });
  assert.equal(status.kind, "recovery-status");
  assert.equal(status.facts.tasks[0].run.status, "COMPLETED");
  assert.equal(status.facts.tasks[0].availability, "available");
  await assert.rejects(request({ kind: "run-direct", target: main, focus: restored.token, requestId: "run", messageRef: "run" }), /read.only/);
  await writeFile(path.join(root, "recovered.json"), JSON.stringify({ focus: restored, status }), "utf8");
}
for (const shutdown of extension.handlers.get("session_shutdown") ?? []) await shutdown({}, {});

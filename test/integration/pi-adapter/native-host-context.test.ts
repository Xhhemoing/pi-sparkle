import assert from "node:assert/strict";
import { test } from "node:test";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { actualParentDelegation, PARENT_ONLY, AMBIENT_ONLY } from "./native-host-parent.fixture.js";

const HOST_TEXT = "  FINAL_HOST\r\n中文\n  ";
function assertOwnedDelegation(result: Awaited<ReturnType<typeof actualParentDelegation>>, expectedRead = "OWNED_READ_RESULT") {
  assert.equal(result.error, undefined);
  assert.ok(result.parentCalls >= 2, "the parent must receive the real delegate result");
  assert.ok(result.children.length >= 2, "the worker must execute its own read through the real SDK");
  assert.ok(result.promptCalls >= 2, "actual parent and child AgentSession.prompt must both run");
  assert.match(JSON.stringify(result.parentEntries), new RegExp(PARENT_ONLY));
  const wire = JSON.stringify(result.children);
  assert.match(wire, new RegExp(expectedRead));
  assert.match(wire, /Do not claim independent verification/);
  assert.match(wire, /Use sparkle_report_task_result/);
  assert.match(wire, /read-only project assistant/);
  assert.doesNotMatch(wire, new RegExp(`${PARENT_ONLY}|${AMBIENT_ONLY}`));
  for (const child of result.children) {
    assert.deepEqual(getCurrentTools(child.context.messages).map((tool) => tool.name).sort(),
      ["sparkle_read_file", "sparkle_report_task_result"], "the child owns read/report tools, not parent closures");
  }
}

for (const [name, prompt] of [["opaque", HOST_TEXT], ["empty", ""]] as const) {
  test(`actual parent delegation preserves its final ${name} effective prompt`, { timeout: 20000 }, async () => {
    const result = await actualParentDelegation(prompt);
    assertOwnedDelegation(result);
    for (const child of result.children) assert.equal(getCurrentSystemPrompt(child.context.messages), prompt);
  });
}

test("actual parent delegation preserves thinking selected by the late host handler", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation(HOST_TEXT);
  assertOwnedDelegation(result);
  for (const child of result.children) assert.equal(child.options?.reasoning, "low");
});

for (const retryWorker of [false, true]) test(`approved resource bodies reach a real delegated worker${retryWorker ? " through provider retry" : ""} and direct its owned read`, { timeout: 20000 }, async () => {
  let calls = 0;
  let selectedCwd: string | undefined;
  const original = {
    contextFiles: [{ path: "opaque-host-label", text: "APPROVED_CONTEXT APPROVED_READ=approved.txt" }],
    skills: [{ name: "approved-skill", description: "Approved description", body: "APPROVED_SKILL_BODY" }]
  };
  const result = await actualParentDelegation(HOST_TEXT, ({ cwd }) => {
    calls++;
    selectedCwd = cwd;
    queueMicrotask(() => {
      original.contextFiles[0]!.text = "MUTATED_CONTEXT";
      original.skills[0]!.body = "MUTATED_SKILL";
    });
    return original;
  }, retryWorker);
  assertOwnedDelegation(result, "APPROVED_READ_RESULT");
  assert.equal(calls, 1);
  assert.equal(typeof selectedCwd, "string");
  for (const child of result.children) {
    assert.equal(getCurrentSystemPrompt(child.context.messages), HOST_TEXT);
    const wire = JSON.stringify(child.context.messages);
    assert.match(wire, /APPROVED_CONTEXT/);
    assert.match(wire, /APPROVED_SKILL_BODY/);
    const bodyMessages = child.context.messages.filter((message) => message.role === "user" && JSON.stringify(message.content).includes("APPROVED_SKILL_BODY"));
    assert.equal(bodyMessages.length, 1, "the owned custom message is converted to user content once");
    assert.equal(wire.match(/APPROVED_SKILL_BODY/g)?.length, 1, "each attempt receives the captured resource message once");
    assert.doesNotMatch(wire, /MUTATED_CONTEXT|MUTATED_SKILL/);
  }
});

test("delegation inherits the host getter rather than a later non-forced parent wire transform", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation("BASE_HOST_PROMPT", undefined, false, true);
  assertOwnedDelegation(result);
  assert.equal(result.getterPrompts.length, 1);
  assert.match(result.getterPrompts[0]!, /BASE_HOST_PROMPT/);
  assert.doesNotMatch(result.getterPrompts[0]!, /TRANSFORM_FINAL/);
  assert.ok(result.parentWirePrompts.length > 0);
  for (const prompt of result.parentWirePrompts) assert.equal(prompt, "TRANSFORM_FINAL");
  for (const child of result.children) assert.equal(getCurrentSystemPrompt(child.context.messages), result.getterPrompts[0]);
});

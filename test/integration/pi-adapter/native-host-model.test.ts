import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { createSparkleExtension } from "../../../extensions/pi-sparkle/index.js";
import { actualParentDelegation } from "./native-host-parent.fixture.js";

for (const override of [undefined, "B", "host-context/B"]) {
  test(`real parent SDK pins every delegated child to ${override ?? "its selected host A"}`, { timeout: 20000 }, async () => {
    const result = await actualParentDelegation("MODEL_HOST_PROMPT", undefined, false, false,
      override === undefined ? { thinkingBudgets: { low: 4321 } } : { override });
    assert.equal(result.error, undefined);
    assert.ok(result.children.length >= 2, "both sibling tasks must dispatch through the real SDK");
    assert.deepEqual([...new Set(result.children.map((child) => child.model))], [override === undefined ? "host-context/A" : "host-context/B"]);
    if (override === undefined) for (const child of result.children) assert.equal(child.options?.thinkingBudgets?.low, 4321,
      "the real parent SettingsManager budget must reach every child wire");
    assert.deepEqual(result.delegateResults.map((details) => {
      assert.ok(typeof details === "object" && details !== null && "analysis" in details);
      return details.analysis;
    }), ["skipped"], "default core delegation must not start post-run adaptation");
  });
}

test("host selection is captured before approved-resource callback changes the real parent model", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation("MODEL_HOST_PROMPT", undefined, false, false, { switchDuringApproval: true });
  assert.equal(result.error, undefined);
  assert.equal(result.hostModel, "host-context/B");
  assert.ok(result.children.length >= 2);
  assert.deepEqual([...new Set(result.children.map((child) => child.model))], ["host-context/A"]);
});

test("default delegation ignores malformed learned state instead of loading a policy", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation("MODEL_HOST_PROMPT", undefined, false, false, { malformedLearnedState: true });
  assert.equal(result.error, undefined);
  assert.ok(result.children.length >= 2);
  assert.deepEqual([...new Set(result.children.map((child) => child.model))], ["host-context/A"]);
});

test("missing, unavailable, out-of-scope and ambiguous selections refuse before persistence or worker dispatch", async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensionFromFactory } = await import(loaderUrl.href);
  const faux = fauxProvider({ provider: "host-selection", models: [{ id: "A" }, { id: "B" }] });
  const a = faux.getModel("A")!, b = faux.getModel("B")!;
  const cases = [
    { name: "missing host", host: undefined, override: undefined, available: faux.models, scoped: [], error: /host model.*required|requires.*host model/ },
    { name: "unavailable host", host: a, override: undefined, available: [b], scoped: [], error: /unavailable/ },
    { name: "out of scope host", host: a, override: undefined, available: faux.models, scoped: [{ model: b }], error: /unavailable/ },
    { name: "out of scope override", host: a, override: "B", available: faux.models, scoped: [{ model: a }], error: /unavailable/ },
    { name: "ambiguous override", host: a, override: "B", available: [a, b, { ...b, provider: "other-provider" }], scoped: [], error: /ambiguous/ }
  ];
  const scratch = join(process.cwd(), ".agent_workspace", "phase0-core");
  await mkdir(scratch, { recursive: true });
  for (const scenario of cases) {
    const cwd = await mkdtemp(join(scratch, "refuse-"));
    let selections = 0, dispatches = 0;
    const runtime = createExtensionRuntime(); runtime.getSettings = () => ({});
    const extension = await loadExtensionFromFactory(createSparkleExtension({ approvedResources: () => {
      selections++;
      if (scenario.host === undefined) throw new Error("resource selection preceded missing-host refusal");
      return undefined;
    } }), cwd, createEventBus(), runtime);
    const tool = extension.tools.get("sparkle_delegate")!.definition;
    await assert.rejects(tool.execute(scenario.name, { tasks: [{ role: "scout", objective: "Synthetic inspection" }],
      ...(scenario.override !== undefined ? { model: scenario.override } : {}) }, undefined, undefined, {
      cwd, model: scenario.host, scopedModels: scenario.scoped, thinkingLevel: "off", getSystemPrompt: () => "HOST",
      modelRegistry: { getAvailable: () => scenario.available, streamSimple: () => { dispatches++; throw new Error("must not dispatch"); } }
    }), scenario.error, scenario.name);
    if (scenario.host === undefined) assert.equal(selections, 0);
    assert.equal(dispatches, 0, scenario.name);
    await assert.rejects(stat(join(cwd, ".agent_workspace", "pi-sparkle")), { code: "ENOENT" }, scenario.name);
  }
});

test("one selected registry model still rejects an ineligible sibling through static policy before persistence", async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensionFromFactory } = await import(loaderUrl.href);
  const scratch = join(process.cwd(), ".agent_workspace", "phase0-core");
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, "policy-refuse-"));
  const faux = fauxProvider({ provider: "host-policy", models: [{ id: "only" }] });
  let dispatches = 0;
  const runtime = createExtensionRuntime(); runtime.getSettings = () => ({});
  const extension = await loadExtensionFromFactory(createSparkleExtension(), cwd, createEventBus(), runtime);
  await assert.rejects(extension.tools.get("sparkle_delegate")!.definition.execute("policy-refuse", {
    tasks: [{ role: "scout", objective: "Inspect parser" }, { role: "reviewer", objective: "Review parser; data must stay local" }]
  }, undefined, undefined, {
    cwd, model: faux.getModel(), scopedModels: [], thinkingLevel: "off", getSystemPrompt: () => "HOST",
    modelRegistry: { getAvailable: () => faux.models, streamSimple: () => { dispatches++; throw new Error("must not dispatch"); } }
  }), /no eligible|privacy/i);
  assert.equal(dispatches, 0);
  await assert.rejects(stat(join(cwd, ".agent_workspace", "pi-sparkle")), { code: "ENOENT" });
});

test("selected host object identity drift remains refused by actual worker dispatch", { timeout: 20000 }, async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensionFromFactory } = await import(loaderUrl.href);
  const scratch = join(process.cwd(), ".agent_workspace", "phase0-core");
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, "drift-"));
  const faux = fauxProvider({ provider: "host-drift", models: [{ id: "selected" }] });
  const model = { ...faux.getModel() };
  let dispatches = 0, changed = false;
  const runtime = createExtensionRuntime(); runtime.getSettings = () => ({});
  const extension = await loadExtensionFromFactory(createSparkleExtension(), cwd, createEventBus(), runtime);
  const result = await extension.tools.get("sparkle_delegate")!.definition.execute("drift", {
    tasks: [{ role: "scout", objective: "Inspect parser" }]
  }, undefined, (update: { content: { type: string; text?: string }[] }) => {
    if (update.content.some((part) => /Run .* started/.test(part.text ?? ""))) { model.id = "DRIFTED"; changed = true; }
  }, {
    cwd, model, scopedModels: [], thinkingLevel: "off", getSystemPrompt: () => "HOST",
    modelRegistry: { getAvailable: () => [model], streamSimple: () => { dispatches++; throw new Error("must not dispatch drifted identity"); } }
  });
  assert.equal(changed, true, "the real run must reach the post-snapshot progress boundary");
  assert.equal(dispatches, 0);
  assert.equal(result.details.status, "FAILED");
});

test("project root is captured before approved-resource callback changes the tool context cwd", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation("MODEL_HOST_PROMPT", undefined, false, false, { switchCwdDuringApproval: true });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.approvedCwds, [result.cwd]);
  const wire = JSON.stringify(result.children);
  assert.match(wire, /ROOT_CAPTURE_APPROVED/);
  assert.match(wire, /OWNED_READ_RESULT/);
  assert.doesNotMatch(wire, /WRONG_ROOT_READ_RESULT/);
  assert.ok(await stat(join(result.cwd, ".agent_workspace", "pi-sparkle", "runtime")));
  await assert.rejects(stat(join(result.changedCwd, ".agent_workspace", "pi-sparkle")), { code: "ENOENT" });
});

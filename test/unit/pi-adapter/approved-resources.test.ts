import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { createSparkleExtension, type SparkleExtensionOptions } from "../../../extensions/pi-sparkle/index.js";
import { prepareApprovedResources, APPROVED_RESOURCE_MAX_BYTES, APPROVED_RESOURCE_MAX_ENTRIES } from "../../../src/pi-adapter/approved-resources.js";

test("approved resource UTF8 rendering accepts the exact bound and rejects one extra byte", () => {
  const make = (text: string) => ({ contextFiles: [{ path: "label", text }] });
  const overhead = Buffer.byteLength(prepareApprovedResources(make(""))!, "utf8");
  const remaining = APPROVED_RESOURCE_MAX_BYTES - overhead;
  const body = "中".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
  const payload = prepareApprovedResources(make(body))!;
  assert.equal(Buffer.byteLength(payload, "utf8"), APPROVED_RESOURCE_MAX_BYTES);
  assert.throws(() => prepareApprovedResources(make(body + "a")), /UTF8/);
});

test("approved empty bodies are explicit text while absent resources add no message", () => {
  assert.equal(prepareApprovedResources(undefined), undefined);
  assert.equal(prepareApprovedResources({ contextFiles: [], skills: [] }), undefined);
  const payload = prepareApprovedResources({ skills: [{ name: "empty", description: "", body: "" }] });
  assert.deepEqual(JSON.parse(payload!), { contextFiles: [], skills: [{ name: "empty", description: "", body: "" }] });
  assert.throws(() => prepareApprovedResources({ skills: Array.from({ length: APPROVED_RESOURCE_MAX_ENTRIES + 1 }, () => ({ name: "x", description: "", body: "" })) }), /entries/);
});

const invalidResources = [
  Promise.resolve({ skills: [] }), { then() {} }, { parentTranscript: "forbidden" },
  { skills: [{ name: "missing", description: "metadata", filePath: "Z:/DO_NOT_READ/SKILL.md" }] },
  { skills: [{ name: "missing", description: "metadata" }] },
  { contextFiles: [{ path: "label", text: 12 }] }, { contextFiles: new Array(1) },
  { contextFiles: [{ path: "label", text: "中".repeat(APPROVED_RESOURCE_MAX_BYTES) }] }
];

test("invalid or asynchronous approved resources refuse before registry or provider work", async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensionFromFactory } = await import(loaderUrl.href);
  for (const invalid of invalidResources) {
    let selections = 0, dispatches = 0;
    let input: unknown;
    const options = { approvedResources: (value: unknown) => { selections++; input = value; return invalid; } } as unknown as SparkleExtensionOptions;
    const extension = await loadExtensionFromFactory(createSparkleExtension(options), process.cwd(), createEventBus(), createExtensionRuntime());
    const tool = extension.tools.get("sparkle_delegate")!.definition;
    await assert.rejects(tool.execute("invalid-approved", { tasks: [{ role: "scout", objective: "Synthetic" }] },
      new AbortController().signal, undefined, {
        cwd: process.cwd(), thinkingLevel: "off", getSystemPrompt: () => "HOST",
        modelRegistry: { getAvailable: () => { dispatches++; throw new Error("must not reach registry"); } }
      }), /approved|context|skill|UTF8/);
    assert.equal(selections, 1);
    assert.deepEqual(input, { cwd: process.cwd() });
    assert.equal(dispatches, 0);
  }
});

test("rejected async approved resources are refused without terminating the host", () => {
  const helper = new URL("../../../src/pi-adapter/approved-resources.ts", import.meta.url).href;
  const script = `
    import { prepareApprovedResources } from ${JSON.stringify(helper)};
    const provider = async () => { throw new Error("ASYNC_RESOURCE_FAILURE"); };
    try {
      prepareApprovedResources(provider());
      throw new Error("async resources were accepted");
    } catch (error) {
      if (!/synchronous/.test(String(error))) throw error;
      console.log("ASYNC_REFUSED");
    }
    await new Promise(resolve => setImmediate(resolve));
    console.log("HOST_ALIVE");
  `;
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(), encoding: "utf8", timeout: 20_000
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /ASYNC_REFUSED/);
  assert.match(child.stdout, /HOST_ALIVE/);
});

test("closed delegate refuses before host getters or approved resource selection", async () => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensionFromFactory } = await import(loaderUrl.href);
  let selections = 0, getters = 0, dispatches = 0;
  const extension = await loadExtensionFromFactory(createSparkleExtension({ approvedResources: () => { selections++; return undefined; } }),
    process.cwd(), createEventBus(), createExtensionRuntime());
  for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler();
  const tool = extension.tools.get("sparkle_delegate")!.definition;
  const context = {
    cwd: process.cwd(), thinkingLevel: "off", getSystemPrompt: () => { getters++; return "HOST"; },
    modelRegistry: { getAvailable: () => { dispatches++; throw new Error("must not reach registry"); } }
  };
  await assert.rejects(tool.execute("closed-approved", { tasks: [{ role: "scout", objective: "Synthetic" }] },
    new AbortController().signal, undefined, context), /shut down/);
  assert.equal(selections, 0);
  assert.equal(getters, 0);
  assert.equal(dispatches, 0);
  const aborted = new AbortController();
  const reason = new Error("PREABORT_PRIORITY");
  aborted.abort(reason);
  await assert.rejects(tool.execute("closed-aborted", { tasks: [{ role: "scout", objective: "Synthetic" }] },
    aborted.signal, undefined, context), (error) => error === reason);
  assert.equal(selections, 0);
  assert.equal(getters, 0);
});

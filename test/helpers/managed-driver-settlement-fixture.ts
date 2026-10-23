import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

export async function boundedSettlement<T>(promise: Promise<T>, label: string, milliseconds = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Instrument only a private staged copy. This is cooperative composition coverage,
 * not qualification of unchanged bytes or protection against a hostile candidate. */
export async function installManagedSettlementFixture(appRoot: string, mode: "tool" | "agent-end") {
  const directory = path.join(appRoot, "dist/pi-adapter");
  const executor = path.join(directory, "pi-executor.js");
  const codingSession = path.join(directory, "coding-session.js");
  const fixture = path.join(directory, "managed-driver-settlement-fixture.mjs");
  const signals = path.join(directory, "managed-driver-settlement-signals");
  const original = await readFile(executor);
  const source = original.toString("utf8");
  const originalSession = await readFile(codingSession);
  const sessionSource = originalSession.toString("utf8");
  const opening = "const kernel = await createControlledCodingSession({";
  const factory = "export async function createControlledCodingSession(options) {";
  const closing = "return new ControlledSession(session, options);";
  assert.equal(source.split(opening).length, 2, "unique controlled SDK construction seam");
  assert.equal(sessionSource.split(factory).length, 2, "unique controlled SDK factory seam");
  assert.equal(sessionSource.split(closing).length, 2, "unique real SDK session construction seam");
  await mkdir(signals);
  const code = `import { existsSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const directory = new URL("./managed-driver-settlement-signals/", import.meta.url);
const file = name => new URL(name, directory);
const mark = (name, value = "observed") => { writeFileSync(file(name + ".tmp"), value, "utf8"); renameSync(file(name + ".tmp"), file(name)); };
const mode = ${JSON.stringify(mode)};
let entries = 0;
async function hold(signal, request) {
  if (++entries !== 1) throw new Error("fixture operation entered more than once");
  const onAbort = () => mark("aborted");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  mark("entered", JSON.stringify({ runId: request.runId }));
  const deadline = Date.now() + 30000;
  const acknowledged = new Set();
  try {
    while (!existsSync(file("release"))) {
      if (Date.now() >= deadline) throw new Error("fixture release deadline");
      for (const phase of ["before", "after"]) {
        if (!acknowledged.has(phase) && existsSync(file("probe-" + phase))) {
          mark("held-" + phase);
          acknowledged.add(phase);
        }
      }
      await delay(10);
    }
    appendFileSync(file("completed"), "completed\\n", "utf8");
  } catch (error) {
    try { mark("error", error instanceof Error ? (error.stack ?? error.message) : String(error)); }
    catch { /* Preserve the original fixture exception if diagnostics cannot be written. */ }
    throw error;
  } finally { signal?.removeEventListener("abort", onAbort); }
}
export function prepareOptions(options) {
  const runId = options.managedSettlementRunId;
  if (typeof runId !== "string") throw new Error("fixture requires the actual child run id");
  if (mode === "tool") {
    return { ...options, tools: [...options.tools, {
      name: "managed_settlement_hold", label: "Settlement hold", description: "Wait for test release",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async (_id, _args, toolSignal) => {
        await hold(toolSignal, { runId });
        return { content: [{ type: "text", text: "released" }], details: {} };
      }
    }] };
  }
  return options;
}
export function decorate(agent, options) {
  if (mode === "agent-end") {
    // Raw Agent listeners are awaited; SDK session subscribers are notifications only.
    agent.subscribe(async (event, signal) => {
      if (event.type === "agent_end") await hold(signal, { runId: options.managedSettlementRunId });
    });
  }
}
`;
  try {
    await writeFile(fixture, code, "utf8");
    await writeFile(executor, source.replace(opening, `${opening}\n            managedSettlementRunId: request.runId,`), "utf8");
    await writeFile(codingSession,
      'import { prepareOptions as managedSettlementOptions, decorate as managedSettlementFixture } from "./managed-driver-settlement-fixture.mjs";\n' +
      sessionSource.replace(factory, `${factory}\n    options = managedSettlementOptions(options);`)
        .replace(closing, `managedSettlementFixture(session.agent, options);\n    ${closing}`), "utf8");
  } catch (error) {
    await Promise.all([writeFile(executor, original), writeFile(codingSession, originalSession)]);
    await rm(fixture, { force: true });
    await rm(signals, { recursive: true, force: true });
    throw error;
  }
  return {
    async wait(name: string, whilePending?: () => void): Promise<string> {
      const deadline = Date.now() + 15_000;
      while (true) {
        let fixtureError: string | undefined;
        try { fixtureError = await readFile(path.join(signals, "error"), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        assert.equal(fixtureError, undefined, `fixture failed while waiting for ${name}: ${fixtureError}`);
        whilePending?.();
        try { return await readFile(path.join(signals, name), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        assert.ok(Date.now() < deadline, `fixture signal ${name} was not observed`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async diagnostics(): Promise<Record<string, string | null>> {
      const result: Record<string, string | null> = {};
      for (const name of ["entered", "aborted", "probe-before", "held-before", "probe-after", "held-after", "release", "completed", "error"]) {
        try { result[name] = await readFile(path.join(signals, name), "utf8"); }
        catch (error) {
          result[name] = (error as NodeJS.ErrnoException).code === "ENOENT" ? null : String(error);
        }
      }
      return result;
    },
    async mark(name: string): Promise<void> { await writeFile(path.join(signals, name), "release", "utf8"); },
    async restore(): Promise<void> {
      await Promise.all([writeFile(executor, original), writeFile(codingSession, originalSession)]);
      assert.deepEqual(await readFile(executor), original, "staged executor restored byte for byte");
      assert.deepEqual(await readFile(codingSession), originalSession, "staged SDK session restored byte for byte");
      await rm(fixture, { force: true });
      await rm(signals, { recursive: true, force: true });
    }
  };
}

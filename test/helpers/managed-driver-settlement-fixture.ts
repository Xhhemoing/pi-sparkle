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
  const fixture = path.join(directory, "managed-driver-settlement-fixture.mjs");
  const signals = path.join(directory, "managed-driver-settlement-signals");
  const original = await readFile(executor);
  const source = original.toString("utf8");
  const opening = "SparkleKernel.fromFactory(() => new Agent({";
  const closing = "}), gate.armed";
  assert.equal(source.split(opening).length, 2, "unique real Agent construction seam");
  assert.equal(source.split(closing).length, 2, "unique real Agent construction closing seam");
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
export function decorate(agent, signal, request) {
  if (mode === "tool") {
    agent.state.tools = [...agent.state.tools, {
      name: "managed_settlement_hold", label: "Settlement hold", description: "Wait for test release",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async (_id, _args, toolSignal) => {
        await hold(toolSignal, request);
        return { content: [{ type: "text", text: "released" }], details: {} };
      }
    }];
  } else {
    agent.subscribe(async event => { if (event.type === "agent_end") await hold(signal, request); });
  }
  return agent;
}
`;
  try {
    await writeFile(fixture, code, "utf8");
    await writeFile(executor, 'import { decorate as managedSettlementFixture } from "./managed-driver-settlement-fixture.mjs";\n' +
      source.replace(opening, "SparkleKernel.fromFactory(() => managedSettlementFixture(new Agent({")
        .replace(closing, "}), signal, request), gate.armed"), "utf8");
  } catch (error) {
    await writeFile(executor, original);
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
      await writeFile(executor, original);
      assert.deepEqual(await readFile(executor), original, "staged executor restored byte for byte");
      await rm(fixture, { force: true });
      await rm(signals, { recursive: true, force: true });
    }
  };
}

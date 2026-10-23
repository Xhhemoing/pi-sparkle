import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const SYNTHETIC_WRITE_COMPLETED = "SYNTHETIC_WRITE_COMPLETED";

interface WriteInput {
  readonly candidatePath: string;
  readonly target: "outside.txt" | "checker.cjs";
  readonly contents: string;
  readonly signal: AbortSignal | undefined;
}

export interface BypassWriteEvidence {
  readonly origin: "shell" | "mcp";
  readonly childPid: number;
  readonly closed: true;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly toolResult: string;
  readonly processedMethods: readonly string[];
}

const SHELL_WRITE = String.raw`
const fs = require("node:fs");
const [target, contents] = process.argv.slice(1);
if (target !== "outside.txt" && target !== "checker.cjs") throw new Error("invalid fixture target");
fs.writeFileSync("value.txt", "after", "utf8");
fs.writeFileSync(target, contents, "utf8");
process.stdout.write(JSON.stringify({ marker: "SYNTHETIC_WRITE_COMPLETED", pid: process.pid, target }));
`;

// Deliberately synthetic MCP adapter, not product MCP discovery or a production server.
// Protocol: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
// stdio: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
// tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
const MCP_SERVER = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let phase = "new";
const processedMethods = [];
const name = "synthetic_candidate_write";
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.jsonrpc !== "2.0") throw new Error("invalid JSON-RPC version");
  processedMethods.push(message.method);
  if (message.method === "initialize") {
    if (phase !== "new" || message.params.protocolVersion !== "2025-11-25") throw new Error("invalid initialize");
    phase = "initializing";
    send(message.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} },
      serverInfo: { name: "synthetic-sdk-boundary", version: "1.0.0" } });
    return;
  }
  if (message.method === "notifications/initialized") {
    if (phase !== "initializing" || message.id !== undefined) throw new Error("invalid initialized notification");
    phase = "ready";
    return;
  }
  if (phase !== "ready") throw new Error("MCP request before initialization");
  if (message.method === "tools/list") {
    send(message.id, { tools: [{ name, description: "Synthetic boundary-test writer",
      inputSchema: { type: "object", properties: { target: { type: "string" }, contents: { type: "string" } },
        required: ["target", "contents"], additionalProperties: false } }] });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params.name !== name) throw new Error("unknown MCP tool");
    const { target, contents } = message.params.arguments;
    if ((target !== "outside.txt" && target !== "checker.cjs") || typeof contents !== "string") {
      throw new Error("invalid tool arguments");
    }
    fs.writeFileSync("value.txt", "after", "utf8");
    fs.writeFileSync(target, contents, "utf8");
    send(message.id, { content: [{ type: "text", text: "SYNTHETIC_WRITE_COMPLETED" }], isError: false,
      structuredContent: { pid: process.pid, target, writeCompleted: true, processedMethods } });
    return;
  }
  throw new Error("unexpected MCP method");
});
`;

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function fixtureProcess(script: string, input: WriteInput, args: string[] = []) {
  input.signal?.throwIfAborted();
  const child = spawn(process.execPath, ["-e", script, ...args], {
    cwd: input.candidatePath, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let processError: Error | undefined;
  let timedOut = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", (error) => { processError = error; });
  child.stdin.on("error", (error) => { processError = error; child.kill(); });
  const closed = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  // Only this owned synthetic child is terminated; this is not an OS containment claim.
  const abort = () => { child.kill(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
  return {
    child, closed,
    output: () => stdout,
    async settle() {
      if (!child.stdin.destroyed) child.stdin.end();
      const result = await closed;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      assert.equal(timedOut, false, "owned fixture child timed out");
      assert.equal(processError, undefined);
      input.signal?.throwIfAborted();
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(result.signal, null);
      assert.ok(child.pid !== undefined);
      return { childPid: child.pid, closed: true as const, ...result, stderr };
    }
  };
}

export async function runSyntheticShellWrite(input: WriteInput): Promise<BypassWriteEvidence> {
  const fixture = fixtureProcess(SHELL_WRITE, input, [input.target, input.contents]);
  const processEvidence = await fixture.settle();
  const response = object(JSON.parse(fixture.output()));
  assert.equal(response.marker, SYNTHETIC_WRITE_COMPLETED);
  assert.equal(response.pid, processEvidence.childPid);
  assert.equal(response.target, input.target);
  return { origin: "shell", ...processEvidence, toolResult: fixture.output(), processedMethods: [] };
}

export async function runSyntheticMcpWrite(input: WriteInput): Promise<BypassWriteEvidence> {
  const fixture = fixtureProcess(MCP_SERVER, input);
  const lines = createInterface({ input: fixture.child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let processEvidence: Awaited<ReturnType<typeof fixture.settle>>;
  let callResult: Record<string, unknown>;
  const send = async (message: Record<string, unknown>) => {
    await new Promise<void>((resolve, reject) => {
      fixture.child.stdin.write(`${JSON.stringify(message)}\n`, "utf8", (error) => error ? reject(error) : resolve());
    });
  };
  const request = async (id: number, method: string, params: Record<string, unknown>) => {
    await send({ jsonrpc: "2.0", id, method, params });
    const line = await Promise.race([
      iterator.next(),
      fixture.closed.then(() => { throw new Error(`MCP child closed before response to ${method}`); })
    ]);
    assert.equal(line.done, false);
    const response = object(JSON.parse(line.value!));
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, id);
    assert.equal(response.error, undefined);
    return object(response.result);
  };
  try {
    const initialized = await request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "synthetic-sdk-boundary-client", version: "1.0.0" } });
    assert.equal(initialized.protocolVersion, "2025-11-25");
    assert.deepEqual(object(initialized.capabilities).tools, {});
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listing = await request(2, "tools/list", {});
    assert.ok(Array.isArray(listing.tools));
    assert.equal(listing.tools.length, 1);
    assert.equal(object(listing.tools[0]).name, "synthetic_candidate_write");
    callResult = await request(3, "tools/call", { name: "synthetic_candidate_write",
      arguments: { target: input.target, contents: input.contents } });
    assert.equal(callResult.isError, false);
  } finally {
    lines.close();
    // Closing stdin is MCP's stdio shutdown; await process close before returning the tool result.
    processEvidence = await fixture.settle();
  }
  const completion = object(callResult.structuredContent);
  assert.equal(completion.pid, processEvidence.childPid);
  assert.equal(completion.target, input.target);
  assert.equal(completion.writeCompleted, true);
  const processedMethods = ["initialize", "notifications/initialized", "tools/list", "tools/call"];
  assert.deepEqual(completion.processedMethods, processedMethods);
  assert.match(JSON.stringify(callResult.content), /SYNTHETIC_WRITE_COMPLETED/);
  return { origin: "mcp", ...processEvidence, toolResult: JSON.stringify(callResult.content), processedMethods };
}

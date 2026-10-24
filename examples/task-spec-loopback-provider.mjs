// Explicit synthetic demo transport. No external endpoint or real credential is used.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createServer } from "node:http";

export const DEMO_PROVIDER = "sparkle-demo-loopback";
export const DEMO_MODEL = "synthetic-writer";

export async function startTaskSpecLoopbackProvider(fixture) {
  const requests = [], protocolErrors = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 2 * 1024 * 1024, "loopback request exceeded demo bound"); chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const number = requests.length + 1;
      // Private fixture context stays in memory, never in the public summary.
      requests.push({ model: body.model, toolNames: body.tools?.map(tool => tool.function?.name), number });
      assert.equal(request.socket.remoteAddress, "127.0.0.1");
      assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
      assert.equal(body.model, DEMO_MODEL); assert.equal(body.stream, true); assert.ok(number <= 2, "unexpected extra provider turn");
      assert.deepEqual(requests.at(-1).toolNames?.slice().sort(), ["sparkle_list_files", "sparkle_patch_file", "sparkle_read_file",
        "sparkle_report_task_result", "sparkle_search_files", "sparkle_write_file"]);
      const call = number === 1 ? { name: "sparkle_write_file", args: { path: fixture.sourceFile, contents: fixture.after } }
        : { name: "sparkle_report_task_result", args: { verification: "PASSED", summary: "Synthetic model report; independent host checks decide acceptance" } };
      const base = { id: `chatcmpl-demo-${number}`, object: "chat.completion.chunk", created: 1787595200 + number, model: DEMO_MODEL };
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      for (const value of [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_demo_${number}`,
          type: "function", function: { name: call.name, arguments: "" } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }
      ]) response.write(`data: ${JSON.stringify(value)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      protocolErrors.push(error.message);
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "synthetic loopback protocol refused" } }));
    }
  });
  // Fetch rejects some OS-assigned ephemeral ports; use the same high range as
  // the existing loopback tests, without importing installed-unavailable tests.
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { server.off("error", failed); server.off("listening", listening); };
        const failed = error => { cleanup(); reject(error); }, listening = () => { cleanup(); resolve(); };
        server.once("error", failed); server.once("listening", listening); server.listen(randomInt(49152, 65536), "127.0.0.1");
      });
      const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      return { baseUrl, requests, protocolErrors, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
    } catch (error) { if (!["EADDRINUSE", "EACCES"].includes(error.code) || attempt === 31) throw error; }
  }
  throw new Error("loopback port allocation exhausted");
}

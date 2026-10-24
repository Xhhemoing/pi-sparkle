import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { test } from "node:test";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";

async function requestCompletion(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "port-fixture", stream: true, messages: [] })
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /\[DONE\]/);
}

test("loopback provider remains fetchable when ephemeral allocation would select a blocked port", async (t) => {
  const originalListen = Server.prototype.listen;
  t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]): Server {
    // Reproduce the actual Windows 1723 allocation without altering fetch's protections.
    const requested = args[0] === 0 ? 1723 : args[0];
    return Reflect.apply(originalListen, this, [requested, ...args.slice(1)]) as Server;
  });
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["port-fixture"] });
  try {
    await requestCompletion(provider.baseUrl);
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.protocolErrors, []);
  } finally {
    await provider.close();
  }
});

test("loopback provider retries a real occupied address and still serves exactly one request", async (t) => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
  const occupiedAddress = occupied.address();
  assert.ok(occupiedAddress !== null && typeof occupiedAddress !== "string");
  const originalListen = Server.prototype.listen;
  let attempts = 0;
  t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]): Server {
    attempts += 1;
    return Reflect.apply(originalListen, this, [attempts === 1 ? occupiedAddress.port : args[0], ...args.slice(1)]) as Server;
  });
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["port-fixture"] });
  try {
    assert.ok(attempts >= 2);
    await requestCompletion(provider.baseUrl);
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.protocolErrors, []);
  } finally {
    await provider.close();
  }
});

test("loopback provider bounds exhausted allocation and removes temporary listeners", async (t) => {
  let attempts = 0;
  let attemptedServer: Server | undefined;
  const occupied = Object.assign(new Error("fixture address occupied"), { code: "EADDRINUSE" });
  t.mock.method(Server.prototype, "listen", function (this: Server): Server {
    attemptedServer = this;
    attempts += 1;
    queueMicrotask(() => this.emit("error", occupied));
    return this;
  });
  await assert.rejects(startLoopbackOpenAiProvider({ modelIds: ["port-fixture"] }));
  assert.ok(attempts > 1 && attempts <= 32, `bounded retries, observed ${attempts}`);
  assert.equal(attemptedServer?.listening, false);
  const untouchedServer = createServer();
  assert.equal(attemptedServer?.listenerCount("error"), untouchedServer.listenerCount("error"));
  assert.equal(attemptedServer?.listenerCount("listening"), untouchedServer.listenerCount("listening"));
});

test("loopback provider propagates non-allocation errors without retry", async (t) => {
  let attempts = 0;
  const fatal = Object.assign(new Error("fixture unsupported address family"), { code: "EAFNOSUPPORT" });
  t.mock.method(Server.prototype, "listen", function (this: Server): Server {
    attempts += 1;
    queueMicrotask(() => this.emit("error", fatal));
    return this;
  });
  await assert.rejects(startLoopbackOpenAiProvider({ modelIds: ["port-fixture"] }), (error: unknown) => error === fatal);
  assert.equal(attempts, 1);
});

test("loopback provider retries a reserved-port refusal before real HTTP", async (t) => {
  const originalListen = Server.prototype.listen;
  let attempts = 0;
  t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]): Server {
    attempts += 1;
    if (attempts === 1) {
      queueMicrotask(() => this.emit("error", Object.assign(new Error("fixture reserved port"), { code: "EACCES" })));
      return this;
    }
    return Reflect.apply(originalListen, this, args) as Server;
  });
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["port-fixture"] });
  try {
    assert.ok(attempts >= 2);
    await requestCompletion(provider.baseUrl);
    assert.equal(provider.requests.length, 1);
  } finally {
    await provider.close();
  }
});

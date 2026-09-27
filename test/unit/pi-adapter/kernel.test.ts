import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AsyncEventQueue,
  SparkleKernel,
  type SparkleKernelAgent,
  type SparkleKernelEvent,
  type SparkleKernelUserMessage
} from "../../../src/pi-adapter/kernel.js";

class StubAgent implements SparkleKernelAgent {
  sessionId?: string;
  shouldStopAfterTurn?: (...args: never[]) => boolean | Promise<boolean>;
  state = { isStreaming: true, errorMessage: "provider failed" };
  prompts: string[] = [];
  steered: SparkleKernelUserMessage[] = [];
  followedUp: SparkleKernelUserMessage[] = [];
  aborts = 0;
  resets = 0;
  idleWaits = 0;
  private listener:
    | ((event: SparkleKernelEvent, signal: AbortSignal) => void | Promise<void>)
    | undefined;

  subscribe(
    listener: (event: SparkleKernelEvent, signal: AbortSignal) => void | Promise<void>
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: SparkleKernelEvent): void {
    void this.listener?.(event, new AbortController().signal);
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
  }

  abort(): void {
    this.aborts += 1;
  }

  async waitForIdle(): Promise<void> {
    this.idleWaits += 1;
  }

  reset(): void {
    this.resets += 1;
  }

  steer(message: SparkleKernelUserMessage): void {
    this.steered.push(message);
  }

  followUp(message: SparkleKernelUserMessage): void {
    this.followedUp.push(message);
  }
}

describe("SparkleKernel", () => {
  it("forwards lifecycle operations and exposes state without Pi types", async () => {
    const agent = new StubAgent();
    const kernel = SparkleKernel.fromFactory(() => agent, { sessionId: "session-1" });

    await kernel.prompt("build the feature");
    await kernel.waitForIdle();
    kernel.abort();
    kernel.reset();

    assert.equal(kernel.sessionId, "session-1");
    assert.equal(kernel.isStreaming, true);
    assert.equal(kernel.errorMessage, "provider failed");
    assert.deepEqual(agent.prompts, ["build the feature"]);
    assert.equal(agent.idleWaits, 1);
    assert.equal(agent.aborts, 1);
    assert.equal(agent.resets, 1);

    kernel.sessionId = "session-2";
    assert.equal(agent.sessionId, "session-2");
  });

  it("builds user messages for steering and follow-ups and forwards subscriptions", () => {
    const agent = new StubAgent();
    const kernel = SparkleKernel.fromAgent(agent);
    const seen: SparkleKernelEvent[] = [];
    const unsubscribe = kernel.subscribe((event) => seen.push(event));

    kernel.steerText("change direction");
    kernel.followUpText("verify the result");
    agent.emit({ type: "turn_start" });
    unsubscribe();
    agent.emit({ type: "turn_end" });

    assert.deepEqual(seen, [{ type: "turn_start" }]);
    assert.equal(agent.steered[0]?.role, "user");
    assert.equal(agent.steered[0]?.content, "change direction");
    assert.equal(typeof agent.steered[0]?.timestamp, "number");
    assert.equal(agent.followedUp[0]?.role, "user");
    assert.equal(agent.followedUp[0]?.content, "verify the result");
    assert.equal(typeof agent.followedUp[0]?.timestamp, "number");
  });

  it("installs and invokes the Agent stop-after-turn hook without exposing Pi types", async () => {
    const agent = new StubAgent();
    let checks = 0;
    const kernel = SparkleKernel.fromAgent(agent, {
      stopAfterTurn: () => {
        checks += 1;
        return checks >= 2;
      }
    });

    assert.equal(await agent.shouldStopAfterTurn?.(), false);
    assert.equal(await agent.shouldStopAfterTurn?.(), true);
    assert.equal(checks, 2);

    kernel.setStopAfterTurn(undefined);
    assert.equal(agent.shouldStopAfterTurn, undefined);
  });
});

describe("AsyncEventQueue", () => {
  it("drains a 100000-event burst in order without moving the remaining backlog on each read", async (t) => {
    const queue = new AsyncEventQueue<number>();
    // Count actual array slot writes, not elapsed time (machine load varies).
    // Instrument storage only; assertions still consume the public iterator.
    const storage = queue as unknown as { buffered: Array<number | undefined> };
    let slotWrites = 0;
    storage.buffered = new Proxy(storage.buffered, {
      set(target, property, value, receiver) {
        if (/^\d+$/.test(String(property))) slotWrites += 1;
        return Reflect.set(target, property, value, receiver);
      }
    });
    const count = 100_000;
    for (let index = 0; index < count; index += 1) queue.push(index);
    queue.close();
    slotWrites = 0;
    const iterator = queue[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { value: 0, done: false });
    assert.ok(slotWrites <= 2, `one dequeue moved ${slotWrites} backlog entries`);
    let seen = 1;
    for await (const value of { [Symbol.asyncIterator]: () => iterator }) {
      assert.equal(value, seen++);
      if (seen % 1000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(seen, count);
    assert.equal(storage.buffered.length, 0, "draining releases consumed references");
    t.diagnostic(`peak backlog=${count}; delivered=${seen}; initial-array slot writes=${slotWrites}`);
  });

  it("close wakes a waiting consumer and undefined values are still delivered", async () => {
    const queue = new AsyncEventQueue<undefined>();
    queue.push(undefined);
    const iterator = queue[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { value: undefined, done: false });
    const waiting = iterator.next();
    queue.close();
    queue.close();
    assert.deepEqual(await waiting, { value: undefined, done: true });
  });

  it("delivers live and buffered values before closing", async () => {
    const queue = new AsyncEventQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const live = iterator.next();

    queue.push(1);
    assert.deepEqual(await live, { value: 1, done: false });

    queue.push(2);
    queue.close();
    assert.deepEqual(await iterator.next(), { value: 2, done: false });
    assert.deepEqual(await iterator.next(), { value: undefined, done: true });

    queue.push(3);
    assert.equal(queue.isClosed, true);
  });
});

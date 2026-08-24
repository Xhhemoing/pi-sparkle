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
});

describe("AsyncEventQueue", () => {
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

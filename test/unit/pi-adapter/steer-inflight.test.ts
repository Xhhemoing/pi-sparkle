import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SparkleKernel,
  type SparkleKernelAgent,
  type SparkleKernelEvent,
  type SparkleKernelUserMessage
} from "../../../src/pi-adapter/kernel.js";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => settle?.()
  };
}

class BlockingAgent implements SparkleKernelAgent {
  sessionId?: string;
  state = { isStreaming: false };
  readonly promptStarted = deferred();
  readonly releasePrompt = deferred();
  readonly steeringQueue: SparkleKernelUserMessage[] = [];

  subscribe(
    _listener: (event: SparkleKernelEvent, signal: AbortSignal) => void | Promise<void>
  ): () => void {
    return () => undefined;
  }

  async prompt(_input: string): Promise<void> {
    this.state.isStreaming = true;
    this.promptStarted.resolve();
    await this.releasePrompt.promise;
    this.state.isStreaming = false;
  }

  abort(): void {
    this.releasePrompt.resolve();
  }

  async waitForIdle(): Promise<void> {
    await this.releasePrompt.promise;
  }

  reset(): void {
    this.steeringQueue.length = 0;
  }

  steer(message: SparkleKernelUserMessage): void {
    if (!this.state.isStreaming) {
      throw new Error("steer called without an in-flight prompt");
    }
    this.steeringQueue.push(message);
  }

  followUp(_message: SparkleKernelUserMessage): void {
    // This stub only observes the steering queue.
  }
}

test("SparkleKernel queues steering text while its agent prompt is in flight", async () => {
  const agent = new BlockingAgent();
  const kernel = SparkleKernel.fromAgent(agent);
  const prompt = kernel.prompt("start blocked work");

  await agent.promptStarted.promise;
  assert.equal(kernel.isStreaming, true);
  assert.doesNotThrow(() => kernel.steerText("change direction"));
  assert.equal(agent.steeringQueue.length, 1);
  assert.equal(agent.steeringQueue[0]?.role, "user");
  assert.equal(agent.steeringQueue[0]?.content, "change direction");
  assert.equal(typeof agent.steeringQueue[0]?.timestamp, "number");

  agent.releasePrompt.resolve();
  await prompt;
  assert.equal(kernel.isStreaming, false);
});

test.skip("RunningRun.steer forwards in-flight text and rejects empty text", () => {
  // Enable when RunningRun.steer lands:
  // const running = startRun(...);
  // assert.doesNotThrow(() => running.steer("change direction"));
  // assert.throws(() => running.steer("   "), /non-empty/);
  assert.fail("RunningRun.steer is not available yet");
});

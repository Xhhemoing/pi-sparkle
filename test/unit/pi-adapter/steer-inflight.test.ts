import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import {
  SparkleKernel,
  type SparkleKernelAgent,
  type SparkleKernelEvent,
  type SparkleKernelUserMessage
} from "../../../src/pi-adapter/kernel.js";
import { startRun } from "../../../src/run/coordinator.js";
import type { SteerInjectedPayload } from "../../../src/run/events.js";

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

/**
 * An executor whose in-flight run really is a kernel, so a steer accepted at
 * the run level has to survive every hop to be observable: `RunningRun.steer`
 * → `AgentExecutor.steerText` → `SparkleKernel.steerText` → the agent's own
 * steering queue. `GatedExecutor` records steer strings instead, which is
 * enough for the coordinator's contract but stops short of the kernel.
 *
 * The refusals mirror `PiAgentExecutor.steerText` for the single-agent case;
 * the multi-agent refusal is not reachable from one `startRun`.
 */
class KernelBackedExecutor implements AgentExecutor {
  readonly agent = new BlockingAgent();
  /** Resolves once a kernel is live and its prompt is streaming. */
  readonly started: Promise<void>;
  private live: SparkleKernel | undefined;
  private resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  steerText(text: string): void {
    if (text.trim() === "") {
      throw new DomainValidationError("steer text must be a non-empty string");
    }
    const kernel = this.live;
    if (kernel === undefined) {
      throw new DomainValidationError("cannot steer: no agent run is in flight");
    }
    kernel.steerText(text);
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const kernel = SparkleKernel.fromAgent(this.agent);
    const prompt = kernel.prompt("blocked work");
    this.live = kernel;
    try {
      await this.agent.promptStarted.promise;
      this.resolveStarted();
      yield { type: "TEXT_DELTA", text: "working" };
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      this.live = undefined;
      kernel.abort();
      await prompt;
    }
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

async function withTempRoots(
  body: (stateRoot: string, projectRoot: string) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-proj-"));
  try {
    await body(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("RunningRun.steer forwards in-flight text to the live kernel and rejects empty text", async () => {
  await withTempRoots(async (stateRoot, projectRoot) => {
    const executor = new KernelBackedExecutor();
    const running = startRun({ stateRoot, executor }, { projectRoot, objective: "audit the loop" });

    await executor.started;
    // Refused by the run before the executor is asked, so the kernel below it
    // never hears about the attempt at all.
    assert.throws(() => running.steer("   \n\t "), /non-empty/);
    assert.equal(executor.agent.steeringQueue.length, 0);

    await running.steer("change direction", { actor: "supervisor" });
    running.cancel();
    const outcome = await running.done;

    // `BlockingAgent.steer` throws unless a prompt is actually streaming, so
    // reaching the queue is itself the in-flight assertion.
    assert.equal(executor.agent.steeringQueue.length, 1);
    assert.equal(executor.agent.steeringQueue[0]?.role, "user");
    assert.equal(executor.agent.steeringQueue[0]?.content, "change direction");

    const steered = outcome.events.filter((event) => event.type === "STEER_INJECTED");
    assert.equal(steered.length, 1);
    assert.equal(steered[0]?.actor, "supervisor");
    assert.equal((steered[0]?.payload as SteerInjectedPayload).text, "change direction");
  });
});

test("a steer refused by the kernel is not recorded as if the agent had received it", async () => {
  await withTempRoots(async (stateRoot, projectRoot) => {
    const executor = new KernelBackedExecutor();
    const running = startRun({ stateRoot, executor }, { projectRoot, objective: "audit the loop" });

    await executor.started;
    // Ending the prompt without ending the execution leaves the run steerable
    // from the coordinator's side while the kernel below has nothing to steer.
    executor.agent.releasePrompt.resolve();
    await executor.agent.waitForIdle();
    assert.throws(() => running.steer("too late"), /steer called without an in-flight prompt/);

    running.cancel();
    const outcome = await running.done;

    assert.equal(executor.agent.steeringQueue.length, 0);
    assert.equal(outcome.events.some((event) => event.type === "STEER_INJECTED"), false);
  });
});

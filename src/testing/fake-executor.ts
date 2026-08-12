import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../execution/contract.js";

export class FakeExecutor implements AgentExecutor {
  constructor(private readonly steps: readonly ExecutionEvent[]) {}

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    for (const step of this.steps) yield step;
  }
}

export class GatedExecutor implements AgentExecutor {
  sawAbort = false;
  readonly started: Promise<void>;
  private resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.resolveStarted();
    yield { type: "TEXT_DELTA", text: "working" };
    if (signal.aborted) {
      this.sawAbort = true;
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          this.sawAbort = true;
          resolve();
        },
        { once: true }
      );
    });
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

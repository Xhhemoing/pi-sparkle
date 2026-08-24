/**
 * Sparkle's handle on the Pi agent loop.
 *
 * ADR-001 confines Pi imports to `src/pi-adapter/**`, which so far has meant
 * that everything the kernel can do beyond "run one prompt" was reachable only
 * by writing more executor. `SparkleKernel` is the seam instead: it drives a
 * Pi `Agent` while naming none of Pi's types on its public surface, so
 * secondary development targets this class rather than `@earendil-works/*`.
 *
 * The agent is accepted structurally (`SparkleKernelAgent`), and its events
 * come back as opaque `SparkleKernelEvent`s that only the adapter translates.
 */

/**
 * One event from the agent loop. Deliberately opaque: `type` is readable for
 * routing and logging, but the payload belongs to the adapter, which turns it
 * into an `ExecutionEvent` before anything outside `src/pi-adapter/**` sees it.
 */
export interface SparkleKernelEvent {
  readonly type: string;
}

/** A user turn queued into the loop as steering or as a follow-up. */
export interface SparkleKernelUserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

/**
 * The slice of the Pi agent this facade drives.
 *
 * Declared structurally for two reasons: `new Agent(...)` satisfies it without
 * the Pi type appearing in any exported signature, and a stub satisfies it
 * without a provider, so the facade is testable on its own.
 */
export interface SparkleKernelAgent {
  /** Forwarded to providers for cache-aware backends. */
  sessionId?: string | undefined;
  readonly state: { readonly isStreaming: boolean; readonly errorMessage?: string | undefined };
  subscribe(listener: (event: SparkleKernelEvent, signal: AbortSignal) => void | Promise<void>): () => void;
  prompt(input: string): Promise<void>;
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
  steer(message: SparkleKernelUserMessage): void;
  followUp(message: SparkleKernelUserMessage): void;
}

/** Builds the agent a kernel wraps. Called once, when the kernel is created. */
export type SparkleKernelAgentFactory = () => SparkleKernelAgent;

export interface SparkleKernelOptions {
  /** Forwarded to providers for cache-aware backends. */
  sessionId?: string;
}

/**
 * Unbounded, single-consumer queue bridging a push listener to `for await`.
 *
 * Unbounded on purpose: the Pi agent awaits its event listeners as part of run
 * settlement, so a listener that blocked on a slow consumer would stall the
 * very run it is reporting on.
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | undefined;
  private closed = false;

  /** Values pushed after `close()` are dropped. */
  push(value: T): void {
    if (this.closed) return;
    const waiting = this.waiting;
    if (waiting === undefined) {
      this.buffered.push(value);
      return;
    }
    this.waiting = undefined;
    waiting({ value, done: false });
  }

  /** End the stream once already-buffered values have been consumed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiting = this.waiting;
    if (waiting === undefined) return;
    this.waiting = undefined;
    waiting({ value: undefined, done: true });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.buffered.length > 0) {
        yield this.buffered.shift() as T;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done === true) return;
      yield next.value;
    }
  }
}

export class SparkleKernel {
  constructor(
    private readonly agent: SparkleKernelAgent,
    options: SparkleKernelOptions = {}
  ) {
    if (options.sessionId !== undefined) this.agent.sessionId = options.sessionId;
  }

  /** Wrap an agent that already exists. */
  static fromAgent(agent: SparkleKernelAgent, options: SparkleKernelOptions = {}): SparkleKernel {
    return new SparkleKernel(agent, options);
  }

  /** Wrap the agent a factory builds; the factory runs immediately. */
  static fromFactory(create: SparkleKernelAgentFactory, options: SparkleKernelOptions = {}): SparkleKernel {
    return new SparkleKernel(create(), options);
  }

  /**
   * Observe the loop. Returns an unsubscribe function.
   *
   * The listener is called synchronously and its result is discarded: Pi
   * awaits listener promises before the run settles, so an async listener that
   * waited on a consumer would deadlock `waitForIdle`. Hand work off to a queue
   * instead — see {@link AsyncEventQueue}.
   */
  subscribe(listener: (event: SparkleKernelEvent) => void): () => void {
    return this.agent.subscribe((event) => {
      listener(event);
    });
  }

  /** Start a new run from text. Resolves when the run's first pass returns. */
  async prompt(text: string): Promise<void> {
    await this.agent.prompt(text);
  }

  /** Abort the active run, if any. */
  abort(): void {
    this.agent.abort();
  }

  /** Resolve once the run and its awaited listeners have settled. */
  async waitForIdle(): Promise<void> {
    await this.agent.waitForIdle();
  }

  /** Drop the transcript, runtime state, and both queues. */
  reset(): void {
    this.agent.reset();
  }

  /** Queue text to be injected after the current assistant turn finishes. */
  steerText(text: string): void {
    this.agent.steer(userMessage(text));
  }

  /** Queue text to run only once the agent would otherwise stop. */
  followUpText(text: string): void {
    this.agent.followUp(userMessage(text));
  }

  get sessionId(): string | undefined {
    return this.agent.sessionId;
  }

  set sessionId(sessionId: string | undefined) {
    this.agent.sessionId = sessionId;
  }

  /** Error from the most recent failed or aborted turn, if any. */
  get errorMessage(): string | undefined {
    return this.agent.state.errorMessage;
  }

  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }
}

function userMessage(content: string): SparkleKernelUserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

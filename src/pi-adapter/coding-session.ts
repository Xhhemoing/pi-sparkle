import { assertApprovedResourcePayload } from "./approved-resources.js";
import { captureThinkingBudgets, type SparkleThinkingBudgets } from "./thinking-budgets.js";
import type { AgentTool, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, createAssistantMessageEventStream, normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type Extension,
  type ResourceLoader
} from "@earendil-works/pi-coding-agent";

export interface ControlledCodingSessionOptions {
  cwd: string;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  thinkingBudgets?: SparkleThinkingBudgets | undefined;
  systemPrompt: string;
  approvedResourcePayload?: string | undefined;
  tools: AgentTool[];
  streamFn: StreamFn;
  shouldStopAfterTurn?: () => boolean | Promise<boolean>;
}

export type ControlledCodingSessionEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

export interface ControlledCodingSession {
  prompt(text: string): Promise<void>;
  steerText(text: string): void;
  abort(): void;
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: ControlledCodingSessionEvent) => void): () => void;
  dispose(): void;
  readonly errorMessage: string | undefined;
}

function ownedResources(systemPrompt: string, approvedResourcePayload: string | undefined): ResourceLoader {
  let supplied = false;
  // The SDK's customPrompt path appends cwd and replaces an empty prompt with
  // defaults. Its public before-agent-start override keeps host text opaque.
  // This one owned handler does not discover or execute project extensions.
  const promptOwner: Extension = {
    path: "<inline:sparkle-host-prompt>", resolvedPath: "<inline:sparkle-host-prompt>",
    sourceInfo: { path: "<inline:sparkle-host-prompt>", source: "inline", scope: "temporary", origin: "top-level" },
    handlers: new Map([["before_agent_start", [async () => {
      const message = !supplied && approvedResourcePayload !== undefined
        ? { customType: "sparkle-approved-resources", content: approvedResourcePayload, display: false }
        : undefined;
      supplied = true;
      return { systemPrompt, ...(message !== undefined ? { message } : {}) };
    }]]]),
    tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map()
  };
  const extensions = { extensions: [promptOwner], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error("Controlled worker resource discovery is disabled"); },
    reload: async () => { throw new Error("Controlled worker resource reload is disabled"); }
  };
}

/** Host-owned model transport and auth stay outside the SDK's model registry. */
export async function createControlledCodingSession(options: ControlledCodingSessionOptions): Promise<ControlledCodingSession> {
  const thinkingBudgets = captureThinkingBudgets(options);
  assertApprovedResourcePayload(options.approvedResourcePayload);
  const { model } = options;
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  const refresh = runtime.refresh.bind(runtime);
  const registrations: ReturnType<ModelRuntime["refresh"]>[] = [];
  // registerNativeProvider initiates its own refresh. Restrict that public path
  // before registration and await it, including its availability checks.
  runtime.refresh = (refreshOptions = {}) => {
    const completion = refresh({ ...refreshOptions, providers: [model.provider], allowNetwork: false });
    registrations.push(completion);
    return completion;
  };
  const forbiddenTransport = (): never => { throw new Error("Controlled worker transport must be dispatched by its host"); };
  runtime.registerNativeProvider({
    id: model.provider,
    name: "Host-owned worker transport",
    getModels: () => [model],
    auth: { apiKey: {
      name: "Host-delegated transport readiness",
      check: async () => ({ type: "api_key", source: "host-delegated" }),
      resolve: async () => ({ auth: {} })
    } },
    stream: forbiddenTransport,
    streamSimple: forbiddenTransport
  });
  for (const result of await Promise.all(registrations)) {
    if (result.aborted) throw new Error("Controlled worker model registration aborted");
    for (const error of result.errors.values()) throw error;
  }
  const available = await runtime.getAvailable(model.provider);
  if (!available.some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) {
    throw new Error(`Controlled worker delegated model ${model.provider}/${model.id} is not available`);
  }
  const { session } = await createAgentSession({
    cwd: options.cwd,
    modelRuntime: runtime,
    model,
    thinkingLevel: options.thinkingLevel,
    tools: options.tools.map((tool) => tool.name),
    customTools: options.tools,
    resourceLoader: ownedResources(options.systemPrompt, options.approvedResourcePayload),
    sessionManager: SessionManager.inMemory(options.cwd),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false, provider: { maxRetries: 0 } },
      compaction: { enabled: false }, cacheWarming: "off", steeringMode: "all", ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }) })
  });
  // The public factory owns its Agent, including when SDK and host Pi versions
  // differ. Never pass a host Agent into the SDK's nominal class boundary.
  return new ControlledSession(session, options);
}

function stoppedStream(model: Model<Api>) {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const, content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "aborted" as const, errorMessage: "Controlled worker aborted before provider dispatch", timestamp: Date.now()
  };
  stream.push({ type: "error", reason: "aborted", error: message });
  stream.end(message);
  return stream;
}

class ControlledSession implements ControlledCodingSession {
  private accepting = false;
  private stopped = false;
  private disposed = false;
  private running: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private abortCompletion: Promise<void> | undefined;
  private failure: unknown;
  private readonly unsubscribeOwned: (() => void)[];

  constructor(private readonly session: AgentSession, options: ControlledCodingSessionOptions) {
    const agent = session.agent;
    // This worker inherits the host selection; SDK UI capability defaults must
    // not silently replace the explicit host transport configuration.
    agent.state.thinkingLevel = options.thinkingLevel;
    type SdkStream = Awaited<ReturnType<AgentSession["agent"]["streamFunction"]>>;
    agent.streamFunction = async (selected, context, streamOptions) => {
      // normalizeContext reconstructs the host Pi version's branded transcript.
      // Public members are structurally checked; the local assertion bridges
      // only the stream class's version-private identity.
      const stream: Pick<SdkStream, keyof SdkStream> = this.stopped
        ? stoppedStream(options.model)
        : await options.streamFn(selected, normalizeContext({ messages: context.messages }), streamOptions);
      return stream as SdkStream;
    };
    this.unsubscribeOwned = [session.subscribe((event) => {
      if (event.type === "agent_start" && !this.stopped) this.accepting = true;
      if (event.type === "agent_end" || event.type === "agent_settled") this.accepting = false;
    }), agent.subscribe(async (event) => {
      // SDK public event forwarding (and the caller's synchronous replay)
      // precedes this awaited raw listener.
      if (event.type === "turn_end") await this.drain();
      if (event.type === "agent_end") {
        this.accepting = false;
        await this.drain();
        if (this.stopped) session.clearQueue();
      }
    })];
    const finish = agent.finishTurn;
    agent.finishTurn = async (turn, signal) => {
      await this.drain();
      const decision = await finish?.(turn, signal);
      await this.drain();
      if (decision?.action === "end" || this.failure !== undefined || this.stopped
        || turn.message.stopReason === "error" || turn.message.stopReason === "aborted" || await options.shouldStopAfterTurn?.()) {
        this.abort();
        return { action: "end" };
      }
      return decision ?? undefined;
    };
    const prepare = agent.prepareNextTurnWithContext;
    agent.prepareNextTurnWithContext = async (turn, signal) => {
      await this.drain();
      const update = await prepare?.(turn, signal);
      await this.drain();
      return update;
    };
  }

  get errorMessage(): string | undefined { return this.session.state.errorMessage; }

  prompt(text: string): Promise<void> {
    if (this.disposed || this.stopped) return Promise.reject(new Error("Controlled worker prompt admission closed"));
    if (this.running) return Promise.reject(new Error("Controlled worker prompt already running"));
    this.accepting = true;
    this.running = this.runPrompt(text);
    return this.running;
  }

  private async runPrompt(text: string): Promise<void> {
    let promptError: unknown;
    try { await this.session.prompt(text, { expandPromptTemplates: false }); }
    catch (error) { promptError = error; this.abort(); }
    finally {
      this.accepting = false;
      await this.drain();
      await this.session.waitForIdle();
      await this.abortCompletion;
      this.running = undefined;
    }
    if (this.failure !== undefined) throw this.failure;
    if (promptError !== undefined) throw promptError;
  }

  steerText(text: string): void {
    if (text.trim() === "") throw new Error("Controlled worker steering must not be empty");
    if (!this.accepting || this.stopped || this.disposed) throw new Error("Controlled worker steering admission closed");
    // Admission is synchronous; delivery is serial and awaited by actual turn
    // boundaries. An asynchronous rejection belongs to the outer prompt.
    this.tail = this.tail.then(async () => {
      if (this.failure !== undefined || this.stopped) return;
      try {
        const disposition = await this.session.steer(text);
        if (disposition !== "queued") throw new Error(`Controlled worker steering was ${disposition}, expected queued`);
      } catch (error) { this.failure ??= error; this.abort(); }
    });
  }

  private async drain(): Promise<void> {
    for (;;) { const tail = this.tail; await tail; if (tail === this.tail) return; }
  }

  abort(): void {
    this.accepting = false;
    this.stopped = true;
    this.session.clearQueue();
    // abort sets SDK no-continuation intent before its first await. A hook
    // must never await this promise: it would await its own run's settlement.
    this.abortCompletion ??= this.session.abort().catch((error: unknown) => { this.failure ??= error; });
  }

  async waitForIdle(): Promise<void> {
    await this.running?.catch(() => undefined);
    await this.drain();
    await this.session.waitForIdle();
    await this.abortCompletion;
  }

  subscribe(listener: (event: ControlledCodingSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  dispose(): void {
    if (this.running) throw new Error("Controlled worker must be idle before disposal");
    this.accepting = false;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribeOwned) unsubscribe();
    this.session.dispose();
  }
}

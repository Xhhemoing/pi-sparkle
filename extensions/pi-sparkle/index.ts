import { prepareApprovedResources, type ApprovedResourcesProvider } from "../../src/pi-adapter/approved-resources.js";
import { join } from "node:path";
import { parseCandidateCommandArgs, parseCandidateDisposalArgs } from "../../src/native/command-args.js";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ConversationRecoveryOptions, ReadonlyConversationSession } from "../../src/conversation/recovery.js";
import type { ConversationSession, ConversationSessionOptions } from "../../src/conversation/session.js";
import type { NativeSession } from "../../src/native/session.js";

/**
 * Session-scoped issued-candidate handles. The apply tool never accepts a
 * `NativeWriteSessionResult` from the caller: command/argv inside that object
 * are executed inside the candidate, so they must come from the persisted,
 * opaque-id-addressed artifact the host created at write/issue time — never
 * from model-controlled tool parameters.
 */
interface IssuedCandidateHandle {
  readonly stateRoot: string;
  readonly sourceRepo: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly candidatePath: string;
}

export interface SparkleExtensionOptions {
  /** Synchronous trusted host selection; never populated from model tool parameters. */
  readonly approvedResources?: ApprovedResourcesProvider;
  readonly conversation?: ConversationSessionOptions;
  readonly conversationRecovery?: ConversationRecoveryOptions;
}

/** Trusted host entry. Model requests cannot supply bindings or execution authority. */
export function createSparkleExtension(options: SparkleExtensionOptions = {}): (pi: ExtensionAPI) => void {
  return (pi) => initializeSparkleExtension(pi, options);
}

export default createSparkleExtension();

function initializeSparkleExtension(pi: ExtensionAPI, options: SparkleExtensionOptions): void {
  if (process.env.SPARKLE_NATIVE === "0") return;
  let session: NativeSession | undefined;
  let closed = false;
  const abort = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let shutdown: Promise<void> | undefined;
  if (options.conversation !== undefined && options.conversationRecovery !== undefined) throw new Error("Choose conversation or conversationRecovery, not both");
  if (options.conversation !== undefined || options.conversationRecovery !== undefined) {
    const configuration = options.conversation;
    const recovery = options.conversationRecovery;
    let conversation: Promise<ConversationSession | ReadonlyConversationSession> | undefined;
    function enter<T>(signal: AbortSignal | undefined, operation: (session: ConversationSession | ReadonlyConversationSession, signal: AbortSignal) => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error("Sparkle session is shut down"));
      const combined = signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal]);
      const running = (async () => {
        combined.throwIfAborted();
        conversation ??= recovery === undefined
          ? import("../../src/conversation/session.js").then(({ ConversationSession }) => new ConversationSession(configuration!))
          : import("../../src/conversation/recovery.js").then(({ ReadonlyConversationSession }) => ReadonlyConversationSession.load(recovery));
        const current = await conversation;
        combined.throwIfAborted();
        return operation(current, combined);
      })();
      pending.add(running);
      // Register both settlement handlers, avoiding an unobserved rejected finally promise.
      void running.then(() => pending.delete(running), () => pending.delete(running));
      return running;
    }
    const ref = Type.String({ minLength: 1, maxLength: 128 });
    const target = Type.Object({ projectRef: ref, taskRef: Type.Optional(ref) }, { additionalProperties: false });
    const base = {
      messageRef: Type.String({ minLength: 1, maxLength: 256 }),
      focus: Type.Object({ generation: ref, revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })
    };
    pi.registerTool({
      name: "sparkle_conversation_focus", label: "Sparkle Conversation Focus",
      description: "Read current conversation focus/token and permitted project/task references. Host execution bindings are not exposed.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: (_id, params, signal) => enter(signal, async (current) => {
        const { conversationRecord } = await import("../../src/conversation/focus.js");
        conversationRecord(params, [], "focus parameters");
        const details = { refs: current.refs(), focus: current.focus() };
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      })
    });
    pi.registerTool({
      name: "sparkle_conversation", label: "Sparkle Conversation",
      description: recovery === undefined
        ? "Submit a question/status/focus/restore request, or run a task already authorized by the host. Use only registered references and a current focus token. Direct work retains a checked candidate; it does not apply it or issue apply authority."
        : "Read-only recovered conversation: question/status/focus/restore inspect host-selected references and fresh facts. Use a current focus token. run-direct is unavailable and always refused; recovery does not restore execution or apply authority.",
      // Provider adapters require root properties; the session parser enforces each closed branch.
      parameters: Type.Object({
        ...base,
        kind: Type.Union([Type.Literal("question"), Type.Literal("status"), Type.Literal("focus"), Type.Literal("restore"), Type.Literal("run-direct")]),
        projectRef: Type.Optional(Type.String({ ...ref, description: "Optional project reference for status only." })),
        target: Type.Optional(Type.Object(target.properties, { additionalProperties: false, description: "Required for focus and run-direct; forbidden for other kinds." })),
        temporary: Type.Optional(Type.Boolean({ description: "Optional for focus only; suspend the current mainline." })),
        requestId: Type.Optional(Type.String({ ...ref, description: "Required for run-direct only; unique within this session." }))
      }, { additionalProperties: false }),
      execute: (_id, params, signal) => enter(signal, async (current, combined) => {
        // Pass the original object to the closed-shape parser: never spread/read model accessors.
        const details = await current.handle(params, combined);
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      })
    });
  }
  const issuedCandidates = new Map<string, IssuedCandidateHandle>();
  const contractText = Type.String({ minLength: 1, maxLength: 512 });
  const taskContract = Type.Object({
    scope: Type.Optional(Type.Array(contractText, { maxItems: 8 })),
    prohibitions: Type.Optional(Type.Array(contractText, { maxItems: 8 })),
    deliverables: Type.Optional(Type.Array(contractText, { maxItems: 8 })),
    acceptanceCriteria: Type.Optional(Type.Array(Type.Object({
      id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
      description: contractText,
      observableCheck: contractText
    }, { additionalProperties: false }), { maxItems: 8 })),
    sourceRefs: Type.Optional(Type.Array(Type.Object({
      kind: Type.Union([Type.Literal("message"), Type.Literal("file"), Type.Literal("git"), Type.Literal("spec")]),
      ref: contractText,
      excerpt: Type.Optional(contractText)
    }, { additionalProperties: false }), { maxItems: 8 }))
  }, { additionalProperties: false, description: "Optional read-only requirements and source claims; no authority or independent verification. Combined objective and normalized contract must fit 8000 characters." });
  pi.registerTool({
    name: "sparkle_delegate",
    label: "Sparkle Delegate",
    description: "Delegate 1–4 read-only project inspections or reviews, optionally with scoped task requirements. Workers can read files; no writing or shell. Returns bounded child reports (not independent verification) and a durable run ID. Preferred model must be available in the Pi session catalogue.",
    promptSnippet: "Delegate parallel read-only project inspections with progress and durable evidence",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        role: Type.String({ enum: ["scout", "reviewer"] }),
        objective: Type.String({ minLength: 1, maxLength: 8000 }),
        contract: Type.Optional(taskContract)
      }), { minItems: 1, maxItems: 4 }),
      model: Type.Optional(Type.String({ description: "Exact provider/model or unique model ID; defaults to grok-4.7" })),
      contextEfficiency: Type.Optional(Type.Boolean({ description: "Archive large read results after two full sends and expose sparkle_recall_observation to workers (default off)" }))
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      if (closed) throw new Error("Sparkle session is shut down");
      // Sample host-owned scalars before imports/routing can yield. A later
      // host turn must not change the context of this admitted delegation.
      const effectiveSystemPrompt = ctx.getSystemPrompt();
      const thinkingLevel = ctx.thinkingLevel ?? pi.getThinkingLevel();
      const approvedResourcePayload = prepareApprovedResources(options.approvedResources?.({ cwd: ctx.cwd }));
      if (typeof effectiveSystemPrompt !== "string") throw new Error("Sparkle requires an explicit effective host system prompt");
      const [{ NativeSession, resolveNativeModel }, { createNativeExecutor }] = await Promise.all([
        import("../../src/native/session.js"), import("../../src/pi-adapter/native-executor.js")
      ]);
      if (closed) throw new Error("Sparkle session is shut down");
      session ??= new NativeSession();
      const available = ctx.modelRegistry.getAvailable();
      const scoped = ctx.scopedModels;
      const eligible = scoped.length === 0 ? available : available.filter((model) =>
        scoped.some((entry) => entry.model.id === model.id && entry.model.provider === model.provider));
      const model = resolveNativeModel(eligible, params.model);
      // Quality-first routing bridge: every eligible host model becomes a
      // catalog row so per-task assignment (static policy + learned routing)
      // can spread tasks across models instead of pinning one model.
      const routing = eligible.length > 1 ? await (async () => {
        const [{ buildNativeRoutingCatalog }, { loadLearnedRouting }] = await Promise.all([
          import("../../src/native/routing-catalog.js"),
          import("../../src/learning/learned-routing.js")
        ]);
        const stateRoot = join(ctx.cwd, ".agent_workspace", "pi-sparkle");
        const catalog = buildNativeRoutingCatalog(
          eligible.map((candidate) => ({
            ref: `${candidate.provider}/${candidate.id}`,
            preferred: candidate.provider === model.provider && candidate.id === model.id,
            contextWindow: candidate.contextWindow ?? undefined,
            maxOutputTokens: candidate.maxTokens ?? undefined
          })),
          { primary: `${model.provider}/${model.id}` }
        );
        const learned = await loadLearnedRouting(stateRoot, ctx.cwd);
        return { catalog, ...(learned !== undefined ? { learned } : {}) };
      })() : undefined;
      // Opt-in context efficiency (TASK-20260920-native-observation-projection):
      // the projector is run-scoped. The runId is minted here so the projector
      // can be bound before the coordinator starts the run; the run then uses
      // exactly this id (createRunId is injectable through the delegate input).
      const observation = params.contextEfficiency === true ? await (async () => {
        const { createObservationProjector } = await import("../../src/pi-adapter/observation-tools.js");
        // Unbound at creation; NativeSession.delegate binds it to the real
        // run id synchronously after startParentRun. No id injection — the
        // coordinator's generator mints every id in the run.
        return { projector: createObservationProjector({ enabled: true, toolName: "sparkle_read_file" }) };
      })() : undefined;
      const executor = createNativeExecutor({
        effectiveSystemPrompt, thinkingLevel, approvedResourcePayload,
        projectRoot: ctx.cwd,
        defaultModel: model,
        models: eligible,
        streamSimple: (selected, context, options) =>
          ctx.modelRegistry.streamSimple(selected, context, options),
        ...(observation !== undefined ? { observationProjector: observation.projector } : {})
      });
      const result = await session.delegate({
        projectRoot: ctx.cwd,
        stateRoot: join(ctx.cwd, ".agent_workspace", "pi-sparkle"),
        model, executor,
        tasks: params.tasks.map((task) => {
          if (task.role !== "scout" && task.role !== "reviewer") throw new Error("Unsupported native role");
          return { role: task.role, objective: task.objective,
            ...(task.contract !== undefined ? { contract: task.contract } : {}) };
        }),
        ...(signal !== undefined ? { signal } : {}),
        onProgress: (text) => onUpdate?.({ content: [{ type: "text", text }], details: {} }),
        ...(routing !== undefined ? { routing } : {}),
        ...(observation !== undefined ? { observationProjector: observation.projector } : {})
      });
      return { content: [{ type: "text", text: result.text }], details: result };
    }
  });
  pi.registerTool({
    name: "sparkle_apply_candidate",
    label: "Sparkle Apply Candidate",
    description: "Apply one previously issued accepted candidate to its source repository. Takes only the issued handle (runId, artifactId, candidatePath) returned when the candidate was registered; the trusted verification command is reconstructed from the persisted artifact, never from this call. The source must remain clean on a named branch at the candidate's base revision. On failure, source changes and the candidate are retained; an ambiguous or partial apply outcome requires inspection. Disposal of the retained candidate is a separate explicit call.",
    promptSnippet: "Apply a retained, independently accepted candidate to the source repository via its issued handle",
    parameters: Type.Object({
      issue: Type.Object({
        runId: Type.String({ description: "Run id returned at issue time" }),
        artifactId: Type.String({ description: "Opaque artifact id returned at issue time" }),
        candidatePath: Type.String({ description: "Candidate worktree path returned at issue time" })
      }),
      candidatePath: Type.String({ description: "Must equal issue.candidatePath; refusal on mismatch" })
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      signal?.throwIfAborted();
      if (closed) throw new Error("Sparkle session is shut down");
      const handle = issuedCandidates.get(params.issue.runId);
      if (handle === undefined) {
        throw new Error(
          `candidate ${params.issue.runId} was not issued in this session; obtain an issued handle from the host before applying`
        );
      }
      if (params.issue.artifactId !== handle.artifactId || params.issue.candidatePath !== handle.candidatePath) {
        throw new Error("issued handle does not match the registered candidate; refused");
      }
      if (params.candidatePath !== handle.candidatePath) {
        throw new Error("candidatePath does not match the issued handle; refused");
      }
      const [{ applyIssuedCandidate }] = await Promise.all([
        import("../../src/native/apply-registration.js")
      ]);
      const result = await applyIssuedCandidate({
        stateRoot: handle.stateRoot,
        sourceRepo: handle.sourceRepo,
        runId: handle.runId,
        artifactId: handle.artifactId,
        candidatePath: handle.candidatePath,
        ...(signal !== undefined ? { signal } : {})
      });
      return {
        content: [{
          type: "text",
          text: `Applied ${handle.runId} to ${handle.sourceRepo} at revision ${result.appliedRevision}. Candidate retained; dispose explicitly when done.`
        }],
        details: result
      };
    }
  });
  pi.registerCommand("sparkle-issue-candidate", {
    description: "Issue an apply handle for one accepted native-write candidate (host/user action; the model cannot call this)",
    handler: async (args, ctx) => {
      // Format: <runId> <artifactId> <candidatePath> <sourceRepo> <stateRoot>
      // All values come from the host-held write result, typed by the user.
      let parts: ReturnType<typeof parseCandidateCommandArgs>;
      try {
        parts = parseCandidateCommandArgs(args);
      } catch {
        if (ctx.hasUI) ctx.ui.notify("usage: /sparkle-issue-candidate <runId> <artifactId> <candidatePath> <sourceRepo> <stateRoot>. Quote each entire path containing spaces; supply exactly five nonempty arguments on one line.", "error");
        return;
      }
      const [runId, artifactId, candidatePath, sourceRepo, stateRoot] = parts;
      issuedCandidates.set(runId, { stateRoot, sourceRepo, runId, artifactId, candidatePath });
      if (ctx.hasUI) ctx.ui.notify(`Issued apply handle for ${runId}. The model may now call sparkle_apply_candidate with this handle.`, "info");
    }
  });
  pi.registerCommand("sparkle-dispose-candidate", {
    description: "Dispose one retained issued candidate after inspection (host/user action)",
    handler: async (args, ctx) => {
      let input: ReturnType<typeof parseCandidateDisposalArgs>;
      try {
        input = parseCandidateDisposalArgs(args);
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(
          `usage: /sparkle-dispose-candidate {"runId":"...","artifactId":"...","candidatePath":"...","sourceRepo":"...","stateRoot":"..."} or five quoted arguments. ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
        return;
      }
      try {
        const { disposeIssuedCandidate } = await import("../../src/native/apply-registration.js");
        const disposed = await disposeIssuedCandidate(input);
        if (ctx.hasUI) ctx.ui.notify(`Disposed retained candidate ${disposed.candidatePath}. Run evidence remains available.`, "info");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`Candidate disposal refused: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }
  });
  pi.registerCommand("sparkle-status", {
    description: "Show native Sparkle delegation status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify(`Sparkle: ${session?.activeCount ?? 0} active delegated runs; read-only workers; quality-first preferred model.`, "info");
    }
  });
  pi.on("session_shutdown", () => {
    if (shutdown !== undefined) return shutdown;
    closed = true;
    abort.abort(new Error("Sparkle session is shut down"));
    shutdown = (async () => {
      // Start native cancellation immediately; a failed conversation must not skip it.
      const native = session?.shutdown();
      const results = await Promise.allSettled([...pending, ...(native === undefined ? [] : [native])]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Sparkle shutdown observed failed operations");
    })();
    return shutdown;
  });
}

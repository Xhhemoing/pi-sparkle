import { join } from "node:path";
import { parseCandidateCommandArgs } from "../../src/native/command-args.js";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export default function sparkleExtension(pi: ExtensionAPI): void {
  if (process.env.SPARKLE_NATIVE === "0") return;
  let session: NativeSession | undefined;
  let closed = false;
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
  pi.registerCommand("sparkle-status", {
    description: "Show native Sparkle delegation status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify(`Sparkle: ${session?.activeCount ?? 0} active delegated runs; read-only workers; quality-first preferred model.`, "info");
    }
  });
  pi.on("session_shutdown", async () => { closed = true; await session?.shutdown(); });
}

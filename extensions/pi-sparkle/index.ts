import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NativeSession } from "../../src/native/session.js";

/**
 * Session-scoped issued-candidate handles. The apply tool never accepts a
 * `NativeWriteSessionResult` from the caller: command/argv inside that object
 * are executed inside the candidate, so they must come from the persisted,
 * content-addressed artifact the host created at write/issue time — never
 * from model-controlled tool parameters.
 */
interface IssuedCandidateHandle {
  readonly stateRoot: string;
  readonly sourceRepo: string;
  readonly runId: string;
  readonly artifactSha256: string;
  readonly candidatePath: string;
}

export default function sparkleExtension(pi: ExtensionAPI): void {
  if (process.env.SPARKLE_NATIVE === "0") return;
  let session: NativeSession | undefined;
  let closed = false;
  const issuedCandidates = new Map<string, IssuedCandidateHandle>();
  pi.registerTool({
    name: "sparkle_delegate",
    label: "Sparkle Delegate",
    description: "Delegate 1–4 read-only project inspections or reviews. Workers can read files; no writing or shell. Returns bounded child reports (not independent verification) and a durable run ID. Preferred model must be available in the Pi session catalogue.",
    promptSnippet: "Delegate parallel read-only project inspections with progress and durable evidence",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        role: Type.String({ enum: ["scout", "reviewer"] }),
        objective: Type.String({ minLength: 1, maxLength: 8000 })
      }), { minItems: 1, maxItems: 4 }),
      model: Type.Optional(Type.String({ description: "Exact provider/model or unique model ID; defaults to cursor-grok-4.6-fast" }))
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
      const provider = ctx.modelRegistry.getProvider(model.provider);
      if (provider === undefined) throw new Error("Pi provider unavailable for delegated model");
      const executor = createNativeExecutor({
        projectRoot: ctx.cwd, model, provider,
        resolveAuth: () => ctx.modelRegistry.getApiKeyAndHeaders(model)
      });
      const result = await session.delegate({
        projectRoot: ctx.cwd,
        stateRoot: join(ctx.cwd, ".agent_workspace", "pi-sparkle"),
        model, executor,
        tasks: params.tasks.map((task) => {
          if (task.role !== "scout" && task.role !== "reviewer") throw new Error("Unsupported native role");
          return { role: task.role, objective: task.objective };
        }),
        ...(signal !== undefined ? { signal } : {}),
        onProgress: (text) => onUpdate?.({ content: [{ type: "text", text }], details: {} })
      });
      return { content: [{ type: "text", text: result.text }], details: result };
    }
  });
  pi.registerTool({
    name: "sparkle_apply_candidate",
    label: "Sparkle Apply Candidate",
    description: "Apply one previously issued accepted candidate to its source repository. Takes only the issued handle (runId, artifactSha256, candidatePath) returned when the candidate was registered; the trusted verification command is reconstructed from the persisted artifact, never from this call. The source must be clean and at the candidate's base revision; on failure the source is rolled back. Disposal of the retained candidate is a separate explicit call.",
    promptSnippet: "Apply a retained, independently accepted candidate to the source repository via its issued handle",
    parameters: Type.Object({
      issue: Type.Object({
        runId: Type.String({ description: "Run id returned at issue time" }),
        artifactSha256: Type.String({ description: "Artifact sha256 returned at issue time" }),
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
      if (params.issue.artifactSha256 !== handle.artifactSha256 || params.issue.candidatePath !== handle.candidatePath) {
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
        artifactSha256: handle.artifactSha256,
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
      // Format: <runId> <artifactSha256> <candidatePath> <sourceRepo> <stateRoot>
      // All values come from the host-held write result, typed by the user.
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length !== 5) {
        if (ctx.hasUI) ctx.ui.notify("usage: /sparkle-issue-candidate <runId> <artifactSha256> <candidatePath> <sourceRepo> <stateRoot>", "error");
        return;
      }
      const [runId, artifactSha256, candidatePath, sourceRepo, stateRoot] = parts as [string, string, string, string, string];
      issuedCandidates.set(runId, { stateRoot, sourceRepo, runId, artifactSha256, candidatePath });
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

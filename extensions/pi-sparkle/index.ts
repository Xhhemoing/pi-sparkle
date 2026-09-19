import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NativeSession } from "../../src/native/session.js";

export default function sparkleExtension(pi: ExtensionAPI): void {
  if (process.env.SPARKLE_NATIVE === "0") return;
  let session: NativeSession | undefined;
  let closed = false;
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
  pi.registerCommand("sparkle-status", {
    description: "Show native Sparkle delegation status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify(`Sparkle: ${session?.activeCount ?? 0} active delegated runs; read-only workers; quality-first preferred model.`, "info");
    }
  });
  pi.on("session_shutdown", async () => { closed = true; await session?.shutdown(); });
}

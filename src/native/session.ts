import { join } from "node:path";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { createTaskId, type RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import type { AgentExecutor } from "../execution/contract.js";
import { startParentRun, type RunningRun } from "../run/coordinator.js";
import { runAutoAdaptLoop } from "../learning/auto-loop.js";
import { episodeIdFromEvents } from "../run/episode-bind.js";
import { runtimeRoot } from "../privacy/state-layout.js";

export interface NativeModel { readonly provider: string; readonly id: string }
export function resolveNativeModel<T extends NativeModel>(
  available: readonly T[], preferred = "cursor-grok-4.6-fast"
): T {
  const matches = available.filter((m) => preferred === `${m.provider}/${m.id}` || preferred === m.id);
  if (matches.length !== 1) {
    throw new DomainValidationError(`preferred model ${preferred} is ${matches.length === 0 ? "unavailable" : "ambiguous; specify provider/model"}`);
  }
  return matches[0]!;
}

export interface NativeTask { readonly role: "scout" | "reviewer"; readonly objective: string }
export interface NativeDelegateInput {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly model: NativeModel;
  readonly tasks: readonly NativeTask[];
  readonly executor: AgentExecutor;
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string) => void;
}
export interface NativeDelegateResult {
  readonly runId: RunId;
  readonly status: string;
  readonly results: readonly { taskId: string; summary: string; evidenceIds: readonly string[] }[];
  readonly independentVerification: "UNOBSERVED";
  readonly analysis: string;
  readonly text: string;
}

/** Owns only explicit delegated runs, never the ambient Pi transcript. */
export class NativeSession {
  private readonly active = new Set<RunningRun>();
  private closed = false;
  get activeCount(): number { return this.active.size; }

  async delegate(input: NativeDelegateInput): Promise<NativeDelegateResult> {
    if (this.closed) throw new DomainValidationError("native session is shut down");
    input.signal?.throwIfAborted();
    if (input.tasks.length < 1 || input.tasks.length > 4) throw new DomainValidationError("delegate requires 1 to 4 tasks");
    for (const task of input.tasks) {
      if (!["scout", "reviewer"].includes(task.role)) throw new DomainValidationError("native tasks must be scout or reviewer");
      if (!task.objective.trim() || task.objective.length > 8000) throw new DomainValidationError("objective must contain 1..8000 characters");
    }
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const modelId = `${input.model.provider}/${input.model.id}`;
    const progress = (text: string) => { try { input.onProgress?.(text); } catch { /* UI cannot fail a run. */ } };
    const executor: AgentExecutor = {
      async *execute(request, signal) {
        progress(`Running ${request.taskId} with ${modelId}`);
        for await (const event of input.executor.execute(request, signal)) {
          if (event.type === "TOOL_STARTED") progress(`${request.taskId}: ${event.toolName}`);
          yield event;
        }
      }
    };
    const running = startParentRun({ stateRoot: input.stateRoot, executor }, {
      projectRoot: input.projectRoot,
      objective: input.tasks.map((task) => task.objective).join("\n"),
      children: input.tasks.map((task) => ({
        taskId: createTaskId(), role: task.role, objective: task.objective,
        profile: registry.resolve(task.role), inputArtifactIds: [], acceptanceCriteria: [],
        assignedModel: modelId,
        limits: { maxAttempts: 1, timeoutMs: 300_000, maxWallTimeMs: 300_000 }
      }))
    });
    this.active.add(running);
    const abort = () => running.cancel();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    progress(`Run ${running.runId} started`);
    try {
      const outcome = await running.done;
      const results = outcome.events.flatMap((event) => {
        if (event.type !== "CHILD_MESSAGE" || event.payload.message.type !== "TASK_RESULT") return [];
        const message = event.payload.message;
        return [{ taskId: message.taskId, summary: message.summary.slice(0, 2000), evidenceIds: message.evidenceIds.slice(0, 20) }];
      });
      let analysis = "skipped";
      if (!this.closed && !input.signal?.aborted && ["COMPLETED", "FAILED"].includes(outcome.status)) {
        try {
          const episodeId = episodeIdFromEvents(outcome.events);
          const adapted = await runAutoAdaptLoop({
            stateRoot: input.stateRoot, projectRoot: input.projectRoot, projectId: outcome.project.id,
            primaryModelId: modelId, events: outcome.events,
            // Explicit run-local input only; do not ingest another extension's transcripts.
            subagentRunsDir: join(runtimeRoot(input.stateRoot), "runs", running.runId, "native-signals"),
            ...(episodeId !== undefined ? { episodeId } : {})
          });
          analysis = adapted.reason;
        } catch {
          analysis = "post-run analysis failed; execution evidence retained";
        }
      }
      const text = [`Run ${outcome.runId}: ${outcome.status}`, `Model: ${modelId}`,
        "Child reports are not independently verified; acceptance remains UNOBSERVED.",
        ...results.map((result) => `${result.taskId}: ${result.summary}`), `Analysis: ${analysis}`].join("\n");
      progress(`Run ${outcome.runId}: ${outcome.status}`);
      return { runId: outcome.runId, status: outcome.status, results, independentVerification: "UNOBSERVED", analysis, text };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.active.delete(running);
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const active = [...this.active];
    for (const running of active) running.cancel();
    await Promise.allSettled(active.map((running) => running.done));
  }
}

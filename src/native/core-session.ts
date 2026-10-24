import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { createTaskId, type RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RequirementContract } from "../domain/contract.js";
import type { AgentExecutor } from "../execution/contract.js";
import type { TaskAssignment } from "../routing/assign.js";
import { startParentRun, type RunningRun, type RunOutcome } from "../run/coordinator.js";
import type { ObservationProjector } from "../pi-adapter/observation-tools.js";
import { prepareNativeTaskContract, type NativeTaskContractInput } from "./task-contract.js";

export interface NativeModel { readonly provider: string; readonly id: string }
export function resolveNativeModel<T extends NativeModel>(
  available: readonly T[], preferred: string
): T {
  const matches = available.filter((m) => preferred === `${m.provider}/${m.id}` || preferred === m.id);
  if (matches.length !== 1) {
    throw new DomainValidationError(`preferred model ${preferred} is ${matches.length === 0 ? "unavailable" : "ambiguous; specify provider/model"}`);
  }
  return matches[0]!;
}

export interface NativeTask {
  readonly role: "scout" | "reviewer";
  readonly objective: string;
  readonly contract?: NativeTaskContractInput;
}
export interface NativeCoreDelegateInput {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly model: NativeModel;
  readonly tasks: readonly NativeTask[];
  readonly executor: AgentExecutor;
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string) => void;
  /**
   * Opt-in context efficiency. The projector must be unbound; delegate binds
   * it to the run's own id synchronously after start (before any child work),
   * so archives always land under this run's subtree.
   */
  readonly observationProjector?: ObservationProjector | undefined;
}
export interface NativeDelegateResult {
  readonly runId: RunId;
  readonly status: string;
  readonly results: readonly { taskId: string; summary: string; evidenceIds: readonly string[] }[];
  readonly independentVerification: "UNOBSERVED";
  /** Input snapshots bound to the actual child ids, not independent acceptance. */
  readonly taskContracts?: readonly { taskId: string; contract: RequirementContract }[];
  readonly analysis: string;
  readonly text: string;
}

/** Validated original task text; contract rendering is deliberately separate. */
export interface NativeRoutingTask {
  readonly taskId: ReturnType<typeof createTaskId>;
  readonly role: NativeTask["role"];
  readonly objective: string;
}
export interface NativeAssignmentPlan {
  readonly assignments: readonly TaskAssignment[];
  readonly requiredModelIds: readonly string[];
}
export interface NativeSessionBehavior {
  readonly plan?: (tasks: readonly NativeRoutingTask[]) => NativeAssignmentPlan;
  readonly analyze?: (context: {
    readonly input: NativeCoreDelegateInput;
    readonly outcome: RunOutcome;
    readonly modelId: string;
  }) => Promise<string>;
}

function copyAssignmentPlan(plan: NativeAssignmentPlan): NativeAssignmentPlan {
  return {
    requiredModelIds: [...plan.requiredModelIds],
    assignments: plan.assignments.map((assignment) => ({
      ...assignment,
      allowedModels: [...assignment.allowedModels],
      analysis: { ...assignment.analysis, requiredCapabilities: [...assignment.analysis.requiredCapabilities] },
      decision: {
        ...assignment.decision,
        eligibleModels: [...assignment.decision.eligibleModels],
        rejections: assignment.decision.rejections.map((refusal) => ({ ...refusal })),
        behaviorDistribution: { ...assignment.decision.behaviorDistribution },
        approvalPlan: {
          ...assignment.decision.approvalPlan,
          items: assignment.decision.approvalPlan.items.map((item) => ({ ...item }))
        }
      }
    }))
  };
}

/** Owns only explicit delegated runs, never the ambient Pi transcript. */
export class CoreNativeSession {
  private readonly active = new Set<RunningRun>();
  private readonly pending = new Set<Promise<NativeDelegateResult>>();
  private closed = false;
  get activeCount(): number { return this.active.size; }

  delegate(input: NativeCoreDelegateInput, behavior: NativeSessionBehavior = {}): Promise<NativeDelegateResult> {
    let resolve!: (result: NativeDelegateResult) => void;
    let reject!: (error: unknown) => void;
    const operation = new Promise<NativeDelegateResult>((done, failed) => { resolve = done; reject = failed; });
    // Register ownership before synchronous planning/progress callbacks can close
    // the session. Validation and copying still run before delegate yields.
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    void this.runDelegate(input, behavior).then(resolve, reject);
    return operation;
  }

  private async runDelegate(input: NativeCoreDelegateInput, behavior: NativeSessionBehavior): Promise<NativeDelegateResult> {
    if (this.closed) throw new DomainValidationError("native session is shut down");
    input.signal?.throwIfAborted();
    if (input.tasks.length < 1 || input.tasks.length > 4) throw new DomainValidationError("delegate requires 1 to 4 tasks");
    for (const task of input.tasks) {
      if (!["scout", "reviewer"].includes(task.role)) throw new DomainValidationError("native tasks must be scout or reviewer");
      if (!task.objective.trim() || task.objective.length > 8000) throw new DomainValidationError("objective must contain 1..8000 characters");
    }
    // Validate and copy every contract before starting any run. Each child
    // receives only its own requirements, never a union of sibling scopes.
    const routingTasks = input.tasks.map((task, index) => ({
      taskId: createTaskId(() => `route_${index}`), role: task.role, objective: task.objective
    }));
    const prepared = input.tasks.map((task, index) => ({
      taskId: createTaskId(), role: task.role,
      ...prepareNativeTaskContract(task.objective, task.contract, index)
    }));
    const taskContracts = prepared.flatMap((task) => task.contract === undefined
      ? [] : [{ taskId: task.taskId, contract: task.contract }]);
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const modelId = `${input.model.provider}/${input.model.id}`;
    const providedPlan = behavior.plan?.(routingTasks);
    // Admission owns the routing evidence as well as the dispatched model.
    // Never retain mutable objects returned by a caller's planning callback.
    const plan = providedPlan === undefined ? undefined : copyAssignmentPlan(providedPlan);
    const routedModelIds = plan?.assignments;
    if (routedModelIds !== undefined && (routedModelIds.length !== routingTasks.length ||
      routingTasks.some((task) => routedModelIds.filter((assignment) => assignment.taskId === task.taskId &&
        assignment.decision.taskId === task.taskId).length !== 1))) {
      throw new DomainValidationError("native assignment plan must cover every task exactly once before persistence");
    }
    const routedModelId = (index: number): string =>
      routedModelIds?.find((assignment) => assignment.taskId === routingTasks[index]?.taskId)?.decision.model ?? modelId;
    if (plan !== undefined) {
      if (input.executor.supportedModelIds === undefined) {
        throw new DomainValidationError("native routing executor must declare supportedModelIds capability before persistence");
      }
      const capability = new Set(input.executor.supportedModelIds);
      const uncovered = [...plan.requiredModelIds, ...plan.assignments.map((assignment) => assignment.decision.model)]
        .find((catalogModel) => !capability.has(catalogModel));
      if (uncovered !== undefined) {
        throw new DomainValidationError(
          `executor capability does not cover native routing catalog model ${uncovered}; refusing to persist`
        );
      }
    }
    if (this.closed) throw new DomainValidationError("native session is shut down");
    input.signal?.throwIfAborted();
    const progress = (text: string) => { try { input.onProgress?.(text); } catch { /* UI cannot fail a run. */ } };
    let setupFailed = false;
    const executor: AgentExecutor = {
      async *execute(request, signal) {
        if (setupFailed || signal.aborted) {
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
          return;
        }
        const requestModel = request.providerId !== undefined && request.modelId !== undefined
          ? `${request.providerId}/${request.modelId}`
          : request.modelId ?? modelId;
        progress(`Running ${request.taskId} with ${requestModel}`);
        for await (const event of input.executor.execute(request, signal)) {
          if (event.type === "TOOL_STARTED") progress(`${request.taskId}: ${event.toolName}`);
          yield event;
        }
      }
    };
    const running = startParentRun({ stateRoot: input.stateRoot, executor }, {
      projectRoot: input.projectRoot,
      objective: prepared.map((task) => task.objective).join("\n"),
      ...(routedModelIds !== undefined ? { assignments: routedModelIds } : {}),
      children: prepared.map((task, index) => ({
        taskId: task.taskId, role: task.role, objective: task.objective,
        profile: registry.resolve(task.role), inputArtifactIds: [], acceptanceCriteria: task.acceptanceCriteria,
        assignedModel: routedModelId(index),
        limits: { maxAttempts: 1, timeoutMs: 300_000, maxWallTimeMs: 300_000 }
      }))
    });
    this.active.add(running);
    const abort = () => running.cancel();
    try {
      // Cover setup as soon as the run exists: binding or listener setup may
      // throw before the normal done-await path can assume ownership.
      input.observationProjector?.bind({ runId: running.runId, stateRoot: input.stateRoot });
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) abort();
      progress(`Run ${running.runId} started`);
      const outcome = await running.done;
      const results = outcome.events.flatMap((event) => {
        if (event.type !== "CHILD_MESSAGE" || event.payload.message.type !== "TASK_RESULT") return [];
        const message = event.payload.message;
        return [{ taskId: message.taskId, summary: message.summary.slice(0, 2000), evidenceIds: message.evidenceIds.slice(0, 20) }];
      });
      let analysis = "skipped";
      if (behavior.analyze !== undefined && !this.closed && !input.signal?.aborted && ["COMPLETED", "FAILED"].includes(outcome.status)) {
        try {
          analysis = await behavior.analyze({ input, outcome, modelId });
        } catch {
          analysis = "post-run analysis failed; execution evidence retained";
        }
      }
      const actualModels = routedModelIds === undefined
        ? [modelId]
        : [...new Set(routedModelIds.map((assignment) => assignment.decision.model))];
      const text = [`Run ${outcome.runId}: ${outcome.status}`,
        routedModelIds === undefined ? `Model: ${modelId}` : `Models: ${actualModels.join(", ")}`,
        ...(routedModelIds !== undefined ? [`Routing: per-task over host catalog (${actualModels.length} distinct model(s))`] : []),
        ...taskContracts.map((card) => `Task contract ${card.taskId}: read-only; ${card.contract.deliverables.length} report deliverable(s), ${card.contract.acceptanceCriteria.length} criterion/criteria; independent verification UNOBSERVED.`),
        "Child reports are not independently verified; acceptance remains UNOBSERVED.",
        ...results.map((result) => `${result.taskId}: ${result.summary}`), `Analysis: ${analysis}`].join("\n");
      progress(`Run ${outcome.runId}: ${outcome.status}`);
      return { runId: outcome.runId, status: outcome.status, results, independentVerification: "UNOBSERVED", analysis, text,
        ...(taskContracts.length > 0 ? { taskContracts } : {}) };
    } catch (error) {
      setupFailed = true;
      running.cancel();
      await Promise.allSettled([running.done]);
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.active.delete(running);
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const active = [...this.active];
    for (const running of active) running.cancel();
    // running.done settles execution, but an admitted delegate may still own
    // post-run analysis. Drain the entire operation, including that analysis.
    await Promise.allSettled([...this.pending]);
  }
}

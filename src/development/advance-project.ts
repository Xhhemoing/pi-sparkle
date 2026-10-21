import { DomainValidationError } from "../domain/errors.js";
import { prepareNativeWriteLoopLimits } from "../native/write-loop.js";
import type { DevelopmentBatchController } from "./batch.js";
import type { DevelopmentResult } from "./controller.js";

export type ProjectController = Pick<DevelopmentBatchController, "status" | "currentSourceRevision" | "runNext">;
export interface AdvanceProjectInput {
  readonly maxAttempts?: number;
  readonly maxWallTimeMs?: number;
  readonly signal?: AbortSignal;
}

function prepare(input: AdvanceProjectInput): AdvanceProjectInput {
  if (input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).some((key) => typeof key !== "string" || !["maxAttempts", "maxWallTimeMs", "signal"].includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some((property) => property.get !== undefined || property.set !== undefined)) {
    throw new DomainValidationError("advance project: invalid options or accessors");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new DomainValidationError("advance project: signal must be an AbortSignal");
  }
  for (const value of [input.maxAttempts, input.maxWallTimeMs]) {
    if (value !== undefined && typeof value !== "number") throw new DomainValidationError("advance project: limits must be numbers");
  }
  prepareNativeWriteLoopLimits(input);
  return Object.freeze({ ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    ...(input.maxWallTimeMs === undefined ? {} : { maxWallTimeMs: input.maxWallTimeMs }),
    ...(input.signal === undefined ? {} : { signal: input.signal }) });
}

async function progress(controller: ProjectController) {
  const { queue, actions } = await controller.status();
  return Object.freeze({ sourceRevision: controller.currentSourceRevision(),
    queue: Object.freeze({ id: queue.id, revision: queue.revision, total: queue.items.length,
      planned: queue.items.filter((item) => item.status === "planned").length,
      running: queue.items.filter((item) => item.status === "running").length,
      blocked: queue.items.filter((item) => item.status === "blocked").length,
      readyForReview: queue.items.filter((item) => item.status === "ready-for-review").length,
      accepted: queue.items.filter((item) => item.status === "accepted").length }),
    actions: Object.freeze({ total: actions.length,
      prepared: actions.filter((action) => action.state === "prepared").length,
      running: actions.filter((action) => action.state === "running").length,
      completed: actions.filter((action) => action.state === "completed").length,
      needsReconciliation: actions.filter((action) => action.state === "needs-reconciliation").length,
      failed: actions.filter((action) => action.state === "failed").length }) });
}

/** Descriptive, detached observations; the reads do not form an atomic queue/source transaction. */
export type ProjectProgress = Awaited<ReturnType<typeof progress>>;
export interface AdvanceProjectResult {
  readonly before: ProjectProgress;
  readonly after: ProjectProgress;
  /** The original controller result, without acceptance or application inferred from it. */
  readonly result?: DevelopmentResult;
  readonly cancelled: boolean;
}

/** One existing controller operation, with no second scheduler, claim or status-based admission. */
export async function advanceProject(controller: ProjectController, input: AdvanceProjectInput = {}): Promise<AdvanceProjectResult> {
  const options = prepare(input);
  const before = await progress(controller);
  if (options.signal?.aborted) return Object.freeze({ before, after: before, cancelled: true });
  // Await actual controller settlement even after cancellation; never detach a late effect.
  const result = await controller.runNext(options);
  const after = await progress(controller);
  return Object.freeze({ before, after, result, cancelled: options.signal?.aborted === true });
}

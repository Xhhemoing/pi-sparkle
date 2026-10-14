/**
 * Pure reconstruction of flowchart children and their durable declarations.
 * The caller owns validated events/checkpoints, persistence and execution.
 */
import type { AgentProfileRegistry } from "../agents/registry.js";
import type { Flowchart, FlowNode } from "../domain/flowchart.js";
import type { TaskId } from "../domain/ids.js";
import { defaultRunLimits } from "../domain/limits.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { ChildRunLimits, TaskRequest } from "../protocol/v1.js";
import { cheapFirstTiers } from "../routing/live-cascade.js";
import type { ChildTaskInput } from "./child-coordinator.js";
import type { Event, ModelRoutedPayload } from "./events.js";
import type { TaskAcceptanceCriteria, TaskCostCeiling } from "./replay.js";

/**
 * The catalog fields {@link cheapFirstTiers} reads.
 *
 * It comes from the resuming process's own router, not from the log: the log
 * records which model ids were eligible, but not their versions or costs, so
 * the tiers have to be re-derived against a live catalog. A resume configured
 * against a different catalog therefore rebuilds different tiers — the same
 * exposure a fresh start has, and the reason the run's router is the source
 * rather than a second one built here.
 */
type CascadeCatalog = readonly {
  readonly id: string;
  readonly version?: string;
  readonly estimatedCostUsd: number;
}[];

/**
 * The last `TASK_REQUEST` the log carries per task.
 *
 * Every attempt records one and they differ only in the message envelope, so
 * the last is the run's most recent statement of what that node was asked to
 * do. A node an earlier resume already re-specified therefore rebuilds to the
 * spec that resume really sent: the rebuild is a fixed point, not a second
 * guess layered on the first.
 */
export function loggedTaskRequests(events: readonly Event[]): Map<TaskId, TaskRequest> {
  const requests = new Map<TaskId, TaskRequest>();
  for (const event of events) {
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_REQUEST") continue;
    requests.set(message.taskId, message);
  }
  return requests;
}

/** Ascending `taskId`, the order the checkpoint validator insists on. */
function byTaskId(left: TaskAcceptanceCriteria, right: TaskAcceptanceCriteria): number {
  if (left.taskId === right.taskId) return 0;
  return left.taskId < right.taskId ? -1 : 1;
}

/**
 * The per-task criteria record a fresh run opens with: the child specs its
 * caller handed it, recorded when the run accepts them rather than when it
 * dispatches them.
 *
 * That gap is the whole reason the durable field exists. A `TASK_REQUEST`
 * reaches the log only when a child actually starts, so a run paused, blocked
 * or crashed before some child was dispatched has nothing on its log for that
 * child — and {@link childTasksFromLog}, whose spec source *is* the log,
 * rebuilds it with an empty criteria list. The node then runs under that empty
 * list and appends a real `TASK_REQUEST` carrying it, which the
 * last-request-wins rule makes authoritative for every later resume. Without a
 * record written before dispatch, one pause permanently downgrades what a node
 * is asked to satisfy, and nothing afterwards can tell that it happened.
 *
 * These are the same `acceptanceCriteria` arrays `ChildCoordinator` copies
 * verbatim into each `TASK_REQUEST`, so recording them is recording a
 * dispatch fact early, not inventing one. Nothing here reads the bound
 * episode, the flowchart definition or the run contract, and a definition node
 * the caller supplied no spec for is simply absent — it stays *unknown*, which
 * is the distinction the field is for.
 */
export function plannedTaskCriteria(tasks: readonly ChildTaskInput[]): TaskAcceptanceCriteria[] | undefined {
  const planned = new Map<TaskId, TaskAcceptanceCriteria>();
  // Last spelling of a repeated task wins, exactly as `childTaskMap` resolves
  // the same duplicate, so the record describes the spec that would run.
  for (const task of tasks) {
    planned.set(task.taskId, { taskId: task.taskId, acceptanceCriteria: [...task.acceptanceCriteria] });
  }
  if (planned.size === 0) return undefined;
  return [...planned.values()].sort(byTaskId);
}

/**
 * The record carried forward by one checkpoint write: what the run already
 * recorded, plus any task the log has a `TASK_REQUEST` for that the record
 * does not yet name.
 *
 * **First write wins, and nothing is ever dropped.** The record is a statement
 * about what a task was dispatched with, and a later request cannot revise it:
 * a record that took the newest request would launder itself the first time a
 * substituted node logged its empty list (see {@link plannedTaskCriteria}). By
 * the same rule an entry already present survives every rewrite — a pause, an
 * injection and an unblock all rewrite the checkpoint, and none of them learn
 * anything new about what a child was asked to check.
 *
 * A task neither source names is absent, not empty: absence is "nobody
 * recorded this task's criteria", while an entry with an empty list is the
 * stronger, durable "this task was dispatched with none".
 *
 * Which is why a logged request carrying *no* criteria adds nothing here. On
 * the log those two states look identical — a caller who really asked for none
 * and a node the rebuild had to substitute for both produce an empty
 * `acceptanceCriteria` — and recording the second as the first is precisely
 * the laundering this field exists to stop. The one producer that can tell
 * them apart is the caller's own spec, which {@link plannedTaskCriteria}
 * records before dispatch and empty list included.
 */
export function advanceTaskCriteria(
  recorded: readonly TaskAcceptanceCriteria[] | undefined,
  requests: ReadonlyMap<TaskId, TaskRequest>
): TaskAcceptanceCriteria[] | undefined {
  const merged = new Map<TaskId, TaskAcceptanceCriteria>();
  for (const entry of recorded ?? []) merged.set(entry.taskId, entry);
  for (const [taskId, request] of requests) {
    if (merged.has(taskId) || request.acceptanceCriteria.length === 0) continue;
    merged.set(taskId, { taskId, acceptanceCriteria: [...request.acceptanceCriteria] });
  }
  if (merged.size === 0) return undefined;
  return [...merged.values()].sort(byTaskId);
}

/** Ascending `taskId`, the order the ceiling record's validator insists on. */
function byCeilingTaskId(left: TaskCostCeiling, right: TaskCostCeiling): number {
  if (left.taskId === right.taskId) return 0;
  return left.taskId < right.taskId ? -1 : 1;
}

/**
 * A declared spend ceiling, by the protocol's own rule for one.
 *
 * `ChildRunLimits` is an in-process interface, so an embedder can hand the
 * runtime a `maxCostUsd` the CLI's parse-time refusal would never have let
 * through. Recording such a value would either fail the run's own checkpoint
 * write or, worse, put a number the protocol rejects on a durable record, so
 * anything that is not a positive finite number is not a declared ceiling
 * here either.
 */
function declaredCeiling(limits: ChildRunLimits): number | undefined {
  const declared = limits.maxCostUsd;
  return typeof declared === "number" && Number.isFinite(declared) && declared > 0 ? declared : undefined;
}

/**
 * The per-task ceiling record a fresh run opens with: the ceilings its
 * caller's child specs declared, recorded when the run accepts them rather
 * than when it dispatches them.
 *
 * The same gap {@link plannedTaskCriteria} exists for, and the same fix. A
 * `TASK_REQUEST` reaches the log only when a child starts, so a run paused
 * before some child dispatches has nothing on its log about what that child
 * was allowed to spend, and {@link childTasksFromLog} substitutes a budget
 * that cannot honestly carry one. Recorded here, the ceiling survives the gap
 * and {@link withRecordedCostCeilings} puts it back.
 *
 * A task whose caller declared no ceiling is *absent*, not zero and not the
 * run's default: absence is "nobody authorized a cap for this task", which is
 * exactly the state the resume must not turn into a sibling's number.
 */
export function plannedTaskCostCeilings(tasks: readonly ChildTaskInput[]): TaskCostCeiling[] | undefined {
  // Last spelling of a repeated task wins, exactly as `childTaskMap` resolves
  // the same duplicate — including when the last spelling declares nothing,
  // which drops the earlier entry rather than keeping a ceiling that would no
  // longer be dispatched.
  const planned = new Map<TaskId, TaskCostCeiling | undefined>();
  for (const task of tasks) {
    const declared = declaredCeiling(task.limits);
    planned.set(task.taskId, declared === undefined ? undefined : { taskId: task.taskId, maxCostUsd: declared });
  }
  const entries = [...planned.values()].filter((entry): entry is TaskCostCeiling => entry !== undefined);
  if (entries.length === 0) return undefined;
  return entries.sort(byCeilingTaskId);
}

/**
 * The ceiling record carried forward by one checkpoint write: what the run
 * already recorded, plus any task the log has a ceiling-carrying
 * `TASK_REQUEST` for that the record does not yet name.
 *
 * First write wins and nothing is dropped, for {@link advanceTaskCriteria}'s
 * reasons exactly. A logged request carrying *no* ceiling adds nothing, for
 * that function's other reason: on the log, a caller who declared none and a
 * node the rebuild substituted for are indistinguishable, and only the
 * caller's own spec can say known-none — which absence already says.
 *
 * The arm that reads the log is what recovers a run whose checkpoint predates
 * this field: a task the log has seen dispatched under a ceiling gets that
 * ceiling back on the record, because its own `TASK_REQUEST` is proof of what
 * it was authorized to spend.
 */
export function advanceTaskCostCeilings(
  recorded: readonly TaskCostCeiling[] | undefined,
  requests: ReadonlyMap<TaskId, TaskRequest>
): TaskCostCeiling[] | undefined {
  const merged = new Map<TaskId, TaskCostCeiling>();
  for (const entry of recorded ?? []) merged.set(entry.taskId, entry);
  for (const [taskId, request] of requests) {
    if (merged.has(taskId)) continue;
    const declared = declaredCeiling(request.limits);
    if (declared === undefined) continue;
    merged.set(taskId, { taskId, maxCostUsd: declared });
  }
  if (merged.size === 0) return undefined;
  return [...merged.values()].sort(byCeilingTaskId);
}

/**
 * The routing decision that carries a task's true {@link AgentRole}.
 *
 * Two producers write `MODEL_ROUTED` for one task: the pre-run assignment,
 * which knows the `AgentRole` the caller asked for, and the supervisor's
 * per-node routing, which only knows the flowchart role — and that role has
 * already coarsened `tester` into `actor`. Only the assignment is a record of
 * the child's spec, so this selects on `agentRole` rather than taking the
 * first or the last event for the task. Taking the wrong one silently
 * reintroduces the coarsening the rebuild exists to remove.
 */
function assignedRoutes(events: readonly Event[]): Map<TaskId, ModelRoutedPayload> {
  const routes = new Map<TaskId, ModelRoutedPayload>();
  for (const event of events) {
    if (event.type !== "MODEL_ROUTED") continue;
    if (event.payload.agentRole === undefined) continue;
    routes.set(event.payload.taskId, event.payload);
  }
  return routes;
}

/**
 * The per-attempt timeout a substituted budget gets. `RunLimits` carries no
 * per-attempt field, so this is the one number no source on the log can
 * supply; it is the value every rebuilt child used to get for all three.
 */
const FALLBACK_CHILD_TIMEOUT_MS = 60_000;

/**
 * The budget for a node the log has never seen run.
 *
 * Such a node has no request to reconstruct, so the rebuild substitutes one —
 * but from a budget this run's caller actually authorised: a sibling's logged
 * request first, then the run's own declared per-task limits. The old rebuild
 * handed every resumed child `{2, 60_000, 3_600_000}` whatever the caller had
 * asked for, which is how a resumed node came to be able to spend twelve times
 * the caller's wall budget.
 *
 * The three coordinator-enforced fields only, in every arm. A sibling's
 * `maxCostUsd` is that sibling's spend authorization and says nothing about
 * this task, so copying it would invent a ceiling the caller never set here
 * and stamp the invention into the child's `TASK_REQUEST.limits`, its
 * `RUN_CREATED.limits` and the execution request — an absent cap stays absent.
 * A ceiling this task's own caller *did* declare comes back from the durable
 * record instead; see {@link withRecordedCostCeilings}.
 */
function fallbackChildLimits(
  events: readonly Event[],
  requests: ReadonlyMap<TaskId, TaskRequest>
): ChildRunLimits {
  const sibling = requests.values().next();
  if (sibling.done !== true) {
    const { maxAttempts, timeoutMs, maxWallTimeMs } = sibling.value.limits;
    return { maxAttempts, timeoutMs, maxWallTimeMs };
  }
  for (const event of events) {
    if (event.type !== "RUN_CREATED") continue;
    const limits = event.payload.run.limits;
    return {
      maxAttempts: limits.maxAttemptsPerTask,
      timeoutMs: FALLBACK_CHILD_TIMEOUT_MS,
      maxWallTimeMs: limits.maxWallTimeMs
    };
  }
  const defaults = defaultRunLimits();
  return {
    maxAttempts: defaults.maxAttemptsPerTask,
    timeoutMs: FALLBACK_CHILD_TIMEOUT_MS,
    maxWallTimeMs: defaults.maxWallTimeMs
  };
}

/** Predecessor task ids per task, read off the checkpointed edges. */
function dependenciesByTask(definition: Flowchart): Map<TaskId, TaskId[]> {
  const taskIdByNode = new Map(definition.nodes.map((node) => [node.id, node.taskId]));
  const dependencies = new Map<TaskId, TaskId[]>();
  for (const edge of definition.edges) {
    const from = taskIdByNode.get(edge.from);
    const to = taskIdByNode.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const existing = dependencies.get(to);
    if (existing === undefined) dependencies.set(to, [from]);
    else if (!existing.includes(from)) existing.push(from);
  }
  return dependencies;
}

/**
 * The child specs a resumed run relaunches, rebuilt from the parent log.
 *
 * The checkpointed definition is the *node set*: which nodes exist, and which
 * of them are children at all. The log is the *spec source*: `TASK_REQUEST`
 * carries the objective, artifacts, acceptance criteria and budget the caller
 * wrote, and the assignment's `MODEL_ROUTED` carries the true `AgentRole` plus
 * the `highRisk` and `eligibleModels` that regenerate the cascade through the
 * shipped planner. Nothing here needs a schema — every field was already
 * durable, which is why R4-6's refusal to persist executor config does not
 * apply to child specs.
 *
 * The predecessor it replaces, `childTasksFromDefinition`, synthesised each
 * spec from the node alone: empty criteria, empty artifacts, no model, no
 * cascade, the role coarsened back to `implementer`, and one hard-coded budget
 * for every caller. A resumed child was not the child the run started.
 */
export function childTasksFromLog(
  events: readonly Event[],
  definition: Flowchart,
  registry: AgentProfileRegistry,
  catalog: CascadeCatalog
): ChildTaskInput[] {
  const requests = loggedTaskRequests(events);
  const routes = assignedRoutes(events);
  const substituted = fallbackChildLimits(events, requests);
  const dependencies = dependenciesByTask(definition);
  const tasks: ChildTaskInput[] = [];
  for (const node of definition.nodes) {
    // The definition decides membership, so a resume launches children for the
    // same nodes it always did; the log only decides what they are asked to do.
    // A prior MODEL_ROUTED role wins over the role-label mapping so a resume
    // matches the start; the compile-time agentRole is NOT consulted — tracking
    // reads role from the rebuilt spec, and a persisted AgentRole would turn an
    // untracked caller label ("actor") into tracked criteria (tester), changing
    // the gate's verdict across a resume (R6-2's pinned invariant).
    const nodeRole = mappedAgentRole(node.role);
    if (nodeRole === undefined) continue;
    const request = requests.get(node.taskId);
    const routed = routes.get(node.taskId);
    const role = routed?.agentRole ?? nodeRole;
    const dependsOn = dependencies.get(node.taskId) ?? [];

    tasks.push({
      taskId: node.taskId,
      role,
      objective: request?.objective ?? node.objective,
      profile: registry.resolve(role),
      inputArtifactIds: request === undefined ? [] : [...request.inputArtifactIds],
      acceptanceCriteria: request === undefined ? [] : [...request.acceptanceCriteria],
      limits: request?.limits ?? substituted,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(routed !== undefined
        ? {
            assignedModel: routed.model,
            cascade: {
              highRisk: routed.highRisk,
              tiers: cheapFirstTiers(routed.eligibleModels, catalog)
            }
          }
        : {})
    });
  }
  return tasks;
}

/**
 * Restores the criteria a resumed child was originally dispatched with, for
 * the specs {@link childTasksFromLog} had to substitute for.
 *
 * The rebuild's spec source is the parent log, and that is deliberately left
 * alone here: a task whose `TASK_REQUEST` the log carries keeps that request's
 * criteria, whatever the checkpoint records. Only the substitution case — a
 * node the log has never seen run, which the rebuild gives an empty list — is
 * filled, and only from the run's own durable record. A task neither the log
 * nor the record names keeps the empty list, because unknown must not be
 * turned into a claim about what the caller asked for.
 *
 * Applied at the rebuild's sole call site rather than inside it so the
 * reconstruction seam R6-2 left behind keeps its exact shape.
 */
export function withRecordedCriteria(
  tasks: readonly ChildTaskInput[],
  events: readonly Event[],
  recorded: readonly TaskAcceptanceCriteria[] | undefined
): ChildTaskInput[] {
  if (recorded === undefined || recorded.length === 0) return [...tasks];
  const requests = loggedTaskRequests(events);
  const criteriaByTask = new Map(recorded.map((entry) => [entry.taskId, entry.acceptanceCriteria]));
  return tasks.map((task) => {
    if (requests.has(task.taskId)) return task;
    const criteria = criteriaByTask.get(task.taskId);
    return criteria === undefined ? task : { ...task, acceptanceCriteria: [...criteria] };
  });
}

/**
 * Restores the spend ceiling a resumed child was originally dispatched under,
 * for the specs {@link childTasksFromLog} had to substitute for.
 *
 * Same seam and same rules as {@link withRecordedCriteria}: a task whose
 * `TASK_REQUEST` the log carries keeps that request's budget verbatim,
 * whatever the checkpoint records, and a task neither source names keeps the
 * substituted budget — which carries no ceiling, because unknown must not be
 * turned into a claim about what the caller authorized.
 *
 * Only the ceiling is put back. The substituted attempt, timeout and wall
 * fields stay exactly what {@link fallbackChildLimits} chose: those are the
 * coordinator's enforcement knobs and the record says nothing about them.
 */
export function withRecordedCostCeilings(
  tasks: readonly ChildTaskInput[],
  events: readonly Event[],
  recorded: readonly TaskCostCeiling[] | undefined
): ChildTaskInput[] {
  if (recorded === undefined || recorded.length === 0) return [...tasks];
  const requests = loggedTaskRequests(events);
  const ceilingByTask = new Map(recorded.map((entry) => [entry.taskId, entry.maxCostUsd]));
  return tasks.map((task) => {
    if (requests.has(task.taskId)) return task;
    const maxCostUsd = ceilingByTask.get(task.taskId);
    return maxCostUsd === undefined ? task : { ...task, limits: { ...task.limits, maxCostUsd } };
  });
}

export function mappedAgentRole(role: FlowNode["role"]): AgentRole | undefined {
  if (isAgentRole(role)) return role;
  if (role === "critic") return "reviewer";
  if (role === "actor") return "implementer";
  return undefined;
}


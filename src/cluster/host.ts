import { DomainValidationError } from "../domain/errors.js";
import {
  createMessageId,
  createTaskId,
  type AgentInstanceId,
  type IdGenerator,
  type TaskId
} from "../domain/ids.js";
import type { AgentRole } from "../domain/roles.js";
import type { AgentProfileRegistry } from "../agents/registry.js";
import { defaultRunLimits } from "../domain/limits.js";
import {
  createMailbox,
  stampMail,
  type ClusterDeadLetter,
  type ClusterDeadLetterReason,
  type ClusterMail,
  type ClusterMailbox
} from "./mailbox.js";
import { MAX_SPAWN_DEPTH, MAX_SPAWNS_PER_PARENT, validateSpawn } from "./spawn.js";

export interface ClusterPeer {
  readonly agentId: AgentInstanceId;
  readonly role: AgentRole;
  readonly taskId: TaskId;
  readonly depth: number;
  readonly parentAgentId?: AgentInstanceId;
}

export interface ClusterSendInput {
  readonly from: AgentInstanceId;
  readonly body: string;
  readonly to?: AgentInstanceId;
  readonly addressRole?: AgentRole;
  readonly topic?: string;
}

export interface ClusterSpawnRequest {
  readonly parentAgentId: AgentInstanceId;
  readonly role: AgentRole;
  readonly objective: string;
}

export interface ClusterSessionView {
  send(input: { body: string; to?: AgentInstanceId; addressRole?: AgentRole }): ClusterMail;
  inbox(): readonly ClusterMail[];
  spawn(input: { role: AgentRole; objective: string }): { taskId: TaskId };
  peers(): readonly ClusterPeer[];
}

export interface ClusterDeadLetterRoleCount {
  readonly role: AgentRole;
  readonly count: number;
}

export interface ClusterDeadLetterReasonCount {
  readonly reason: ClusterDeadLetterReason;
  readonly count: number;
}

/**
 * Operator-facing tally of role-cast mail the mailbox gave up on. Counts are
 * derived from the mailbox on every call, so out-of-band claims through
 * {@link ClusterHost.mailbox} are included too.
 */
export interface ClusterDeadLetterReport {
  readonly total: number;
  /** Roles with drops, most-dropped first, ties broken by role name. */
  readonly byRole: readonly ClusterDeadLetterRoleCount[];
  readonly byReason: readonly ClusterDeadLetterReasonCount[];
  /** Every drop, oldest first. */
  readonly entries: readonly ClusterDeadLetter[];
  /** `onDeadLetter` calls that threw; those drops are still in `entries`. */
  readonly observerErrors: number;
}

export interface ClusterHost {
  register(agentId: AgentInstanceId, role: AgentRole, taskId: TaskId, parentAgentId?: AgentInstanceId): void;
  viewFor(agentId: AgentInstanceId): ClusterSessionView;
  send(input: ClusterSendInput): ClusterMail;
  inbox(agentId: AgentInstanceId): readonly ClusterMail[];
  spawn(input: ClusterSpawnRequest): { taskId: TaskId };
  peers(): readonly ClusterPeer[];
  mailbox(): ClusterMailbox;
  /** Role-cast mail that was dropped instead of delivered. */
  deadLetterReport(): ClusterDeadLetterReport;
}

export interface ClusterSpawnedTask {
  readonly taskId: TaskId;
  readonly role: AgentRole;
  readonly objective: string;
}

export interface ClusterHostOptions {
  readonly registry: AgentProfileRegistry;
  readonly maxTasks?: number;
  readonly generateId?: IdGenerator;
  readonly onSpawn: (task: ClusterSpawnedTask) => void;
  /**
   * Push notification for each newly dropped role-cast mail, so an embedder can
   * put starvation in a run summary without polling
   * {@link ClusterHost.deadLetterReport}. Throwing does not fail the
   * registration that observed the drop; the throw is tallied instead.
   */
  readonly onDeadLetter?: (entry: ClusterDeadLetter) => void;
}

/**
 * Dead-letter reporting (R2-8 residual, closed here):
 * `register` is the only place this host claims role mail, so it is also the
 * only place mail can be dropped. Each registration reports the drops that
 * appeared since the last one — including drops caused by a caller claiming
 * through `mailbox()` directly, which are picked up on the next registration
 * rather than lost. Nothing here adds a TTL or durability: a role queue that
 * sees no further registrations for its role still makes no progress, and the
 * report dies with the process (both accepted non-goals, see `mailbox.ts`).
 *
 * Reachability: `send` only queues a role-cast when the sender is the sole
 * holder of the addressed role, so a queued self-role-cast is exactly the
 * starvation the mailbox bounds. Because the mailbox skips the sending *role*
 * rather than the sending agent id, every later registration for that role
 * advances the bound — so a run whose attempts each register a fresh agent id
 * (the only production shape, `ChildCoordinator.runAttempt`) does reach a dead
 * letter once the role is registered `DEFAULT_MAX_ROLE_REQUEUES` + 1 more
 * times. Cross-role casts are untouched: they wait for their role, however
 * long, and are delivered when it arrives.
 */
export function createClusterHost(options: ClusterHostOptions): ClusterHost {
  const mailbox = createMailbox();
  const directory = new Map<AgentInstanceId, ClusterPeer>();
  const spawnsByParent = new Map<AgentInstanceId, number>();
  const maxTasks = options.maxTasks ?? defaultRunLimits().maxTasks;
  const generateId = options.generateId;
  let observedDeadLetters = 0;
  let observerErrors = 0;

  const reportNewDeadLetters = (): void => {
    const all = mailbox.deadLetters();
    const fresh = all.slice(observedDeadLetters);
    observedDeadLetters = all.length;
    const observer = options.onDeadLetter;
    if (observer === undefined) return;
    for (const entry of fresh) {
      try {
        observer(entry);
      } catch {
        observerErrors += 1;
      }
    }
  };

  const tally = <T extends string>(keys: readonly T[]): readonly { key: T; count: number }[] => {
    const counts = new Map<T, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  };

  const peer = (agentId: AgentInstanceId): ClusterPeer => {
    const found = directory.get(agentId);
    if (found === undefined) {
      throw new DomainValidationError(`unknown cluster agent ${agentId}`);
    }
    return found;
  };

  const host: ClusterHost = {
    mailbox: () => mailbox,
    peers: () => [...directory.values()],
    deadLetterReport() {
      const entries = mailbox.deadLetters();
      return {
        total: entries.length,
        byRole: tally(entries.map((entry) => entry.role)).map(({ key, count }) => ({ role: key, count })),
        byReason: tally(entries.map((entry) => entry.reason)).map(({ key, count }) => ({
          reason: key,
          count
        })),
        entries,
        observerErrors
      };
    },
    register(agentId, role, taskId, parentAgentId) {
      const parent = parentAgentId !== undefined ? directory.get(parentAgentId) : undefined;
      const depth = parent === undefined ? 0 : parent.depth + 1;
      directory.set(agentId, {
        agentId,
        role,
        taskId,
        depth,
        ...(parentAgentId !== undefined ? { parentAgentId } : {})
      });
      mailbox.claimRole(role, agentId);
      reportNewDeadLetters();
    },
    inbox(agentId) {
      return mailbox.inbox(agentId);
    },
    send(input) {
      if (input.body.trim() === "") {
        throw new DomainValidationError("cluster send body must be non-empty");
      }
      if (input.to === undefined && input.addressRole === undefined) {
        throw new DomainValidationError("cluster send requires to or addressRole");
      }
      if (input.to !== undefined) {
        if (!directory.has(input.to)) {
          throw new DomainValidationError(`unknown cluster recipient ${input.to}`);
        }
        const mail = stampMail({
          id: createMessageId(generateId),
          from: input.from,
          body: input.body.trim(),
          to: input.to,
          ...(input.topic !== undefined ? { topic: input.topic } : {})
        });
        mailbox.enqueue(mail);
        return mail;
      }
      const targets = [...directory.values()].filter(
        (entry) => entry.role === input.addressRole && entry.agentId !== input.from
      );
      if (targets.length === 0) {
        const role = input.addressRole;
        if (role === undefined) {
          throw new DomainValidationError("cluster send requires to or addressRole");
        }
        const queued = stampMail({
          id: createMessageId(generateId),
          from: input.from,
          body: input.body.trim(),
          addressRole: role,
          ...(input.topic !== undefined ? { topic: input.topic } : {})
        });
        mailbox.enqueue(queued);
        return queued;
      }
      let last = stampMail({
        id: createMessageId(generateId),
        from: input.from,
        body: input.body.trim(),
        to: targets[0]!.agentId,
        ...(input.topic !== undefined ? { topic: input.topic } : {})
      });
      mailbox.enqueue(last);
      for (const target of targets.slice(1)) {
        last = stampMail({
          id: createMessageId(generateId),
          from: input.from,
          body: input.body.trim(),
          to: target.agentId,
          ...(input.topic !== undefined ? { topic: input.topic } : {})
        });
        mailbox.enqueue(last);
      }
      return last;
    },
    spawn(input) {
      const parent = peer(input.parentAgentId);
      const profile = options.registry.resolve(parent.role);
      const used = spawnsByParent.get(input.parentAgentId) ?? 0;
      const childRole = validateSpawn({
        parentRole: parent.role,
        parentCanDelegate: profile.canDelegate,
        childRole: input.role,
        objective: input.objective,
        depth: parent.depth,
        spawnsByParent: used,
        liveTaskCount: directory.size,
        maxTasks
      });
      if (parent.depth + 1 > MAX_SPAWN_DEPTH) {
        throw new DomainValidationError(`spawn depth exceeds ${MAX_SPAWN_DEPTH}`);
      }
      if (used >= MAX_SPAWNS_PER_PARENT) {
        throw new DomainValidationError(`parent already spawned ${MAX_SPAWNS_PER_PARENT} children`);
      }
      const taskId = createTaskId(generateId);
      spawnsByParent.set(input.parentAgentId, used + 1);
      options.onSpawn({ taskId, role: childRole, objective: input.objective.trim() });
      return { taskId };
    },
    viewFor(agentId) {
      return {
        send: (input) =>
          host.send({
            from: agentId,
            body: input.body,
            ...(input.to !== undefined ? { to: input.to } : {}),
            ...(input.addressRole !== undefined ? { addressRole: input.addressRole } : {})
          }),
        inbox: () => host.inbox(agentId),
        spawn: (input) => host.spawn({ parentAgentId: agentId, role: input.role, objective: input.objective }),
        peers: () => host.peers()
      };
    }
  };
  return host;
}

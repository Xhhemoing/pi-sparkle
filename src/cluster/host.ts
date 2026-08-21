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
import { createMailbox, stampMail, type ClusterMail, type ClusterMailbox } from "./mailbox.js";
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

export interface ClusterHost {
  register(agentId: AgentInstanceId, role: AgentRole, taskId: TaskId, parentAgentId?: AgentInstanceId): void;
  viewFor(agentId: AgentInstanceId): ClusterSessionView;
  send(input: ClusterSendInput): ClusterMail;
  inbox(agentId: AgentInstanceId): readonly ClusterMail[];
  spawn(input: ClusterSpawnRequest): { taskId: TaskId };
  peers(): readonly ClusterPeer[];
  mailbox(): ClusterMailbox;
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
}

export function createClusterHost(options: ClusterHostOptions): ClusterHost {
  const mailbox = createMailbox();
  const directory = new Map<AgentInstanceId, ClusterPeer>();
  const spawnsByParent = new Map<AgentInstanceId, number>();
  const maxTasks = options.maxTasks ?? defaultRunLimits().maxTasks;
  const generateId = options.generateId;

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

import { DomainValidationError } from "../domain/errors.js";
import type { AgentInstanceId, MessageId } from "../domain/ids.js";
import type { AgentRole } from "../domain/roles.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";

export interface ClusterMail {
  readonly id: MessageId;
  readonly from: AgentInstanceId;
  readonly to?: AgentInstanceId;
  readonly addressRole?: AgentRole;
  readonly body: string;
  readonly topic?: string;
  readonly occurredAt: IsoTimestamp;
}

export interface ClusterMailbox {
  enqueue(mail: ClusterMail): void;
  inbox(agentId: AgentInstanceId): readonly ClusterMail[];
  drain(agentId: AgentInstanceId): ClusterMail[];
  /** Move pending role-cast mail onto this agent's inbox. */
  claimRole(role: AgentRole, agentId: AgentInstanceId): readonly ClusterMail[];
  pendingForRole(role: AgentRole): readonly ClusterMail[];
}

/**
 * In-memory mailbox. Unicast goes to `to`. Role-cast sits in a role queue
 * until an agent with that role claims it (CrewAI / AutoGen hybrid).
 */
export function createMailbox(): ClusterMailbox {
  const byAgent = new Map<AgentInstanceId, ClusterMail[]>();
  const byRole = new Map<AgentRole, ClusterMail[]>();

  const box = (agentId: AgentInstanceId): ClusterMail[] => {
    let list = byAgent.get(agentId);
    if (list === undefined) {
      list = [];
      byAgent.set(agentId, list);
    }
    return list;
  };

  return {
    enqueue(mail) {
      if (mail.to !== undefined) {
        box(mail.to).push(mail);
        return;
      }
      if (mail.addressRole !== undefined) {
        const list = byRole.get(mail.addressRole) ?? [];
        list.push(mail);
        byRole.set(mail.addressRole, list);
        return;
      }
      throw new DomainValidationError("cluster mail requires to or addressRole");
    },
    inbox(agentId) {
      return [...(byAgent.get(agentId) ?? [])];
    },
    drain(agentId) {
      const list = byAgent.get(agentId) ?? [];
      byAgent.set(agentId, []);
      return list;
    },
    claimRole(role, agentId) {
      const pending = byRole.get(role) ?? [];
      byRole.set(role, []);
      const delivered: ClusterMail[] = [];
      for (const mail of pending) {
        if (mail.from === agentId) {
          const remaining = byRole.get(role) ?? [];
          remaining.push(mail);
          byRole.set(role, remaining);
          continue;
        }
        const copy = { ...mail, to: agentId };
        box(agentId).push(copy);
        delivered.push(copy);
      }
      return delivered;
    },
    pendingForRole(role) {
      return [...(byRole.get(role) ?? [])];
    }
  };
}

export function stampMail(
  mail: Omit<ClusterMail, "occurredAt"> & { occurredAt?: IsoTimestamp }
): ClusterMail {
  return { ...mail, occurredAt: mail.occurredAt ?? nowIso() };
}

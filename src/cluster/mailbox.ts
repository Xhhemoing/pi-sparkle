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

/** Why role-cast mail left its role queue without being delivered. */
export type ClusterDeadLetterReason = "requeue-limit";

export interface ClusterDeadLetter {
  readonly mail: ClusterMail;
  readonly role: AgentRole;
  readonly reason: ClusterDeadLetterReason;
  /** Claim attempts that requeued this mail before it was dropped. */
  readonly requeues: number;
  readonly deadLetteredAt: IsoTimestamp;
}

/**
 * Requeues a role-cast mail survives before it is dead-lettered. A requeue only
 * happens when the claiming agent is the mail's own sender, so the bound
 * tolerates a couple of re-registrations by a lone role-holder and then stops.
 */
export const DEFAULT_MAX_ROLE_REQUEUES = 3;

export interface MailboxOptions {
  /** Override {@link DEFAULT_MAX_ROLE_REQUEUES}. Must be >= 0. */
  readonly maxRoleRequeues?: number;
  readonly now?: () => IsoTimestamp;
}

export interface ClusterMailbox {
  enqueue(mail: ClusterMail): void;
  inbox(agentId: AgentInstanceId): readonly ClusterMail[];
  drain(agentId: AgentInstanceId): ClusterMail[];
  /** Move pending role-cast mail onto this agent's inbox. */
  claimRole(role: AgentRole, agentId: AgentInstanceId): readonly ClusterMail[];
  pendingForRole(role: AgentRole): readonly ClusterMail[];
  /** Role-cast mail dropped after exceeding the requeue bound, oldest first. */
  deadLetters(role?: AgentRole): readonly ClusterDeadLetter[];
  /** Requeues recorded so far for still-pending role-cast mail; 0 otherwise. */
  requeueCount(mailId: MessageId): number;
}

/**
 * In-memory mailbox. Unicast goes to `to`. Role-cast sits in a role queue
 * until an agent with that role claims it (CrewAI / AutoGen hybrid).
 *
 * Starvation disclosure (deliberate limits, not defects):
 * - `claimRole` never hands a sender its own role-cast mail. When the only
 *   agent holding the role is the sender, the mail can never be delivered.
 *   Each such claim counts as a requeue; after `maxRoleRequeues` requeues the
 *   mail is dropped from the queue and surfaces via {@link
 *   ClusterMailbox.deadLetters}. Before that bound, {@link
 *   ClusterMailbox.requeueCount} shows how close it is.
 * - The bound counts claim attempts, not time. There is no wall-clock TTL, and
 *   `ClusterHost` only claims at `register`, so a queue with no further
 *   registrations makes no progress toward the bound. Role-cast mail for a role
 *   that nobody ever claims stays visible in `pendingForRole` indefinitely and
 *   is never dead-lettered.
 * - No durability. Everything here is process-local; pending mail, inboxes and
 *   dead letters are lost on exit, and dead letters accumulate for the lifetime
 *   of the mailbox rather than being persisted or acknowledged. Durability is
 *   an accepted non-goal while the cluster lives inside a single process.
 */
export function createMailbox(options: MailboxOptions = {}): ClusterMailbox {
  const maxRoleRequeues = options.maxRoleRequeues ?? DEFAULT_MAX_ROLE_REQUEUES;
  if (!Number.isInteger(maxRoleRequeues) || maxRoleRequeues < 0) {
    throw new DomainValidationError("maxRoleRequeues must be a non-negative integer");
  }
  const now = options.now ?? nowIso;
  const byAgent = new Map<AgentInstanceId, ClusterMail[]>();
  const byRole = new Map<AgentRole, ClusterMail[]>();
  const requeues = new Map<MessageId, number>();
  const deadLettered: ClusterDeadLetter[] = [];

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
      const remaining: ClusterMail[] = [];
      const delivered: ClusterMail[] = [];
      for (const mail of pending) {
        if (mail.from === agentId) {
          const attempted = (requeues.get(mail.id) ?? 0) + 1;
          if (attempted > maxRoleRequeues) {
            requeues.delete(mail.id);
            deadLettered.push({
              mail,
              role,
              reason: "requeue-limit",
              requeues: maxRoleRequeues,
              deadLetteredAt: now()
            });
            continue;
          }
          requeues.set(mail.id, attempted);
          remaining.push(mail);
          continue;
        }
        requeues.delete(mail.id);
        const copy = { ...mail, to: agentId };
        box(agentId).push(copy);
        delivered.push(copy);
      }
      byRole.set(role, remaining);
      return delivered;
    },
    pendingForRole(role) {
      return [...(byRole.get(role) ?? [])];
    },
    deadLetters(role) {
      return role === undefined ? [...deadLettered] : deadLettered.filter((entry) => entry.role === role);
    },
    requeueCount(mailId) {
      return requeues.get(mailId) ?? 0;
    }
  };
}

export function stampMail(
  mail: Omit<ClusterMail, "occurredAt"> & { occurredAt?: IsoTimestamp }
): ClusterMail {
  return { ...mail, occurredAt: mail.occurredAt ?? nowIso() };
}

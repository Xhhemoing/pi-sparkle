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
 * Claim opportunities a role-cast mail survives before it is dead-lettered. A
 * requeue only happens when the claimed role is also the role the mail came
 * from, so the bound tolerates a couple of claims by the sending role and then
 * stops.
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
  /**
   * Move pending role-cast mail onto this agent's inbox, except mail this role
   * cast at itself, and register the agent as a holder of the role.
   */
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
 * - `claimRole` never hands role-cast mail back to the role it came from. The
 *   mailbox learns who holds a role from the claims themselves, so the skip
 *   covers every instance of the sending role, not just the sending agent id —
 *   the granularity a real run needs, because each attempt registers a fresh
 *   agent id for the same logical agent. Mail a role casts at its own role is
 *   therefore undeliverable: each claim of that role counts as a requeue, and
 *   after `maxRoleRequeues` requeues the mail is dropped from the queue and
 *   surfaces via {@link ClusterMailbox.deadLetters}. Before that bound, {@link
 *   ClusterMailbox.requeueCount} shows how close it is. Because the holder set
 *   only grows, a mail that has been requeued once is never delivered later.
 * - Cross-role casts keep their late delivery: mail addressed to a role its
 *   sender does not hold goes to the first agent that claims that role, however
 *   long after the cast that happens, and never accrues a requeue.
 * - The bound counts claims on the addressed role, not time. There is no
 *   wall-clock TTL, claims on other roles do not advance it, and `ClusterHost`
 *   only claims at `register`, so a queue with no further registrations for its
 *   role makes no progress toward the bound. Role-cast mail for a role that
 *   nobody ever claims stays visible in `pendingForRole` indefinitely and is
 *   never dead-lettered.
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
  const holdersByRole = new Map<AgentRole, Set<AgentInstanceId>>();
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

  const holders = (role: AgentRole): Set<AgentInstanceId> => {
    let known = holdersByRole.get(role);
    if (known === undefined) {
      known = new Set();
      holdersByRole.set(role, known);
    }
    return known;
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
      const roleHolders = holders(role);
      roleHolders.add(agentId);
      const pending = byRole.get(role) ?? [];
      const remaining: ClusterMail[] = [];
      const delivered: ClusterMail[] = [];
      for (const mail of pending) {
        // The claimant is a holder by the line above, so this also covers the
        // sender claiming its own cast.
        if (roleHolders.has(mail.from)) {
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

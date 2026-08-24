import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  createAgentInstanceId,
  createMessageId,
  type AgentInstanceId,
  type MessageId
} from "../../../src/domain/ids.js";
import { nowIso, parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentRole } from "../../../src/domain/roles.js";
import {
  createMailbox,
  DEFAULT_MAX_ROLE_REQUEUES,
  type ClusterMailbox
} from "../../../src/cluster/mailbox.js";

function roleCast(
  mailbox: ClusterMailbox,
  from: AgentInstanceId,
  addressRole: AgentRole,
  body: string
): MessageId {
  const id = createMessageId();
  mailbox.enqueue({ id, from, addressRole, body, occurredAt: nowIso() });
  return id;
}

test("role-cast mail is claimed by the first matching agent and skipped by the sender", () => {
  const mailbox = createMailbox();
  const scout = createAgentInstanceId();
  const impl = createAgentInstanceId();
  mailbox.enqueue({
    id: createMessageId(),
    from: scout,
    addressRole: "implementer",
    body: "found 3 files",
    occurredAt: nowIso()
  });
  mailbox.claimRole("scout", scout);
  assert.equal(mailbox.inbox(scout).length, 0);
  const delivered = mailbox.claimRole("implementer", impl);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.body, "found 3 files");
  assert.equal(mailbox.inbox(impl)[0]?.to, impl);
});

test("unicast mail lands only on the named agent", () => {
  const mailbox = createMailbox();
  const a = createAgentInstanceId();
  const b = createAgentInstanceId();
  mailbox.enqueue({
    id: createMessageId(),
    from: a,
    to: b,
    body: "hello",
    occurredAt: nowIso()
  });
  assert.equal(mailbox.inbox(a).length, 0);
  assert.equal(mailbox.drain(b)[0]?.body, "hello");
  assert.equal(mailbox.inbox(b).length, 0);
});

test("sender-only role-cast is dead-lettered once the requeue bound is exceeded", () => {
  const clock = parseIsoTimestamp("2026-08-24T00:00:00.000Z");
  const mailbox = createMailbox({ maxRoleRequeues: 2, now: () => clock });
  const lonely = createAgentInstanceId();
  const id = roleCast(mailbox, lonely, "implementer", "anyone out there?");

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    assert.deepEqual(mailbox.claimRole("implementer", lonely), []);
    assert.equal(mailbox.requeueCount(id), attempt);
    assert.equal(mailbox.pendingForRole("implementer").length, 1);
    assert.deepEqual(mailbox.deadLetters(), []);
  }

  assert.deepEqual(mailbox.claimRole("implementer", lonely), []);
  assert.deepEqual(mailbox.pendingForRole("implementer"), []);
  assert.equal(mailbox.requeueCount(id), 0);
  const dropped = mailbox.deadLetters();
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.mail.id, id);
  assert.equal(dropped[0]?.role, "implementer");
  assert.equal(dropped[0]?.reason, "requeue-limit");
  assert.equal(dropped[0]?.requeues, 2);
  assert.equal(dropped[0]?.deadLetteredAt, clock);

  // Dropped mail is gone for good: no later claim resurrects it.
  const other = createAgentInstanceId();
  assert.deepEqual(mailbox.claimRole("implementer", other), []);
  assert.equal(mailbox.inbox(other).length, 0);
  assert.equal(mailbox.deadLetters().length, 1);
});

test("the default requeue bound is what an unconfigured mailbox enforces", () => {
  const mailbox = createMailbox();
  const lonely = createAgentInstanceId();
  const id = roleCast(mailbox, lonely, "reviewer", "self-addressed");
  for (let attempt = 0; attempt < DEFAULT_MAX_ROLE_REQUEUES; attempt += 1) {
    mailbox.claimRole("reviewer", lonely);
  }
  assert.equal(mailbox.requeueCount(id), DEFAULT_MAX_ROLE_REQUEUES);
  assert.equal(mailbox.deadLetters("reviewer").length, 0);
  mailbox.claimRole("reviewer", lonely);
  assert.equal(mailbox.deadLetters("reviewer").length, 1);
});

/**
 * The reachability change (R5-6): the skip is the sending *role*, not the
 * sending agent id, so a second instance of that role — the shape every retry
 * has, since each attempt registers a fresh id — does not resurrect the cast.
 */
test("a fresh agent id holding the sending role does not receive the role's own cast", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 2 });
  const sender = createAgentInstanceId();
  const nextAttempt = createAgentInstanceId();
  const id = roleCast(mailbox, sender, "tester", "run the suite");

  mailbox.claimRole("tester", sender);
  assert.equal(mailbox.requeueCount(id), 1);

  assert.deepEqual(mailbox.claimRole("tester", nextAttempt), []);
  assert.equal(mailbox.inbox(nextAttempt).length, 0);
  assert.equal(mailbox.requeueCount(id), 2);
  assert.deepEqual(mailbox.deadLetters(), []);

  // A third instance of the same role crosses the bound instead of delivering.
  assert.deepEqual(mailbox.claimRole("tester", createAgentInstanceId()), []);
  assert.deepEqual(mailbox.pendingForRole("tester"), []);
  assert.equal(mailbox.requeueCount(id), 0);
  assert.equal(mailbox.deadLetters()[0]?.mail.id, id);
  assert.equal(mailbox.deadLetters()[0]?.requeues, 2);
});

test("a cast to a role its sender does not hold is delivered however late the role arrives", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 0 });
  const scout = createAgentInstanceId();
  const impl = createAgentInstanceId();
  const id = roleCast(mailbox, scout, "implementer", "found src/parser.ts");

  // Claims on other roles neither deliver it nor advance the bound, even at a
  // zero bound: the sender holds none of them.
  mailbox.claimRole("scout", scout);
  mailbox.claimRole("reviewer", createAgentInstanceId());
  assert.equal(mailbox.pendingForRole("implementer").length, 1);
  assert.equal(mailbox.requeueCount(id), 0);
  assert.deepEqual(mailbox.deadLetters(), []);

  const delivered = mailbox.claimRole("implementer", impl);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.body, "found src/parser.ts");
  assert.equal(delivered[0]?.to, impl);
  assert.equal(mailbox.inbox(impl)[0]?.id, id);
  assert.deepEqual(mailbox.pendingForRole("implementer"), []);
  assert.deepEqual(mailbox.deadLetters(), []);
});

test("the mailbox learns role holders from claims, so cast order does not matter", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 1 });
  const early = createAgentInstanceId();
  // The cast happens before its sender is known to hold the role at all.
  const id = roleCast(mailbox, early, "planner", "who else is planning?");
  assert.equal(mailbox.requeueCount(id), 0);

  mailbox.claimRole("planner", early);
  assert.equal(mailbox.requeueCount(id), 1);
  mailbox.claimRole("planner", createAgentInstanceId());
  assert.equal(mailbox.deadLetters("planner").length, 1);
});

test("a claim skips only mail cast by its own role and preserves queue order", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 1 });
  const sender = createAgentInstanceId();
  const peer = createAgentInstanceId();
  const mine = roleCast(mailbox, sender, "scout", "mine");
  const theirs = roleCast(mailbox, peer, "scout", "theirs");
  const alsoMine = roleCast(mailbox, sender, "scout", "also mine");

  const delivered = mailbox.claimRole("scout", sender);
  assert.deepEqual(
    delivered.map((mail) => mail.id),
    [theirs]
  );
  assert.deepEqual(
    mailbox.pendingForRole("scout").map((mail) => mail.id),
    [mine, alsoMine]
  );

  mailbox.claimRole("scout", sender);
  assert.deepEqual(mailbox.pendingForRole("scout"), []);
  assert.deepEqual(
    mailbox.deadLetters("scout").map((entry) => entry.mail.id),
    [mine, alsoMine]
  );
  assert.deepEqual(mailbox.deadLetters("implementer"), []);
});

test("a zero bound dead-letters sender-only mail on its first claim", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 0 });
  const lonely = createAgentInstanceId();
  const id = roleCast(mailbox, lonely, "planner", "no second chance");
  assert.deepEqual(mailbox.claimRole("planner", lonely), []);
  assert.deepEqual(mailbox.pendingForRole("planner"), []);
  assert.equal(mailbox.deadLetters()[0]?.mail.id, id);
  assert.equal(mailbox.deadLetters()[0]?.requeues, 0);
});

test("role-cast mail nobody ever claims stays pending: there is no TTL", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 0 });
  const sender = createAgentInstanceId();
  roleCast(mailbox, sender, "debugger", "unclaimed forever");
  mailbox.claimRole("scout", sender);
  mailbox.claimRole("implementer", createAgentInstanceId());
  assert.equal(mailbox.pendingForRole("debugger").length, 1);
  assert.deepEqual(mailbox.deadLetters(), []);
});

test("dead-letter accessors hand back copies, not the live log", () => {
  const mailbox = createMailbox({ maxRoleRequeues: 0 });
  const lonely = createAgentInstanceId();
  roleCast(mailbox, lonely, "worker", "dropped");
  mailbox.claimRole("worker", lonely);
  const snapshot = mailbox.deadLetters();
  roleCast(mailbox, lonely, "worker", "dropped too");
  mailbox.claimRole("worker", lonely);
  assert.equal(snapshot.length, 1);
  assert.equal(mailbox.deadLetters().length, 2);
});

test("an invalid requeue bound is rejected at construction", () => {
  for (const maxRoleRequeues of [-1, 1.5, Number.NaN]) {
    assert.throws(() => createMailbox({ maxRoleRequeues }), DomainValidationError);
  }
});

test("requeueCount reports zero for unknown mail", () => {
  const mailbox = createMailbox();
  assert.equal(mailbox.requeueCount(createMessageId()), 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createAgentInstanceId, parseTaskId, type AgentInstanceId } from "../../../src/domain/ids.js";
import type { AgentRole } from "../../../src/domain/roles.js";
import { DEFAULT_MAX_ROLE_REQUEUES, type ClusterDeadLetter } from "../../../src/cluster/mailbox.js";
import { createClusterHost, type ClusterHost } from "../../../src/cluster/host.js";

const registry = createAgentProfileRegistry(defaultAgentProfiles());

function makeHost(onDeadLetter?: (entry: ClusterDeadLetter) => void): ClusterHost {
  return createClusterHost({
    registry,
    onSpawn: () => {},
    ...(onDeadLetter !== undefined ? { onDeadLetter } : {})
  });
}

let nextTask = 0;
function join(host: ClusterHost, agentId: AgentInstanceId, role: AgentRole): void {
  nextTask += 1;
  host.register(agentId, role, parseTaskId(`tsk_host${nextTask}`));
}

/** Re-register the lone role holder until its own role-cast is dropped. */
function starve(host: ClusterHost, agentId: AgentInstanceId, role: AgentRole): void {
  for (let claim = 0; claim <= DEFAULT_MAX_ROLE_REQUEUES; claim += 1) {
    join(host, agentId, role);
  }
}

test("sender-only role-cast starvation reaches the host's dead-letter report", () => {
  const seen: ClusterDeadLetter[] = [];
  const host = makeHost((entry) => seen.push(entry));
  const lonely = createAgentInstanceId();
  join(host, lonely, "reviewer");

  const mail = host.send({ from: lonely, body: "anyone reviewing?", addressRole: "reviewer" });
  assert.equal(host.mailbox().pendingForRole("reviewer").length, 1);
  assert.equal(host.deadLetterReport().total, 0);

  // Registrations for other roles never touch the starved queue: the bound
  // counts claims on that role, not wall-clock time.
  join(host, createAgentInstanceId(), "scout");
  assert.equal(host.deadLetterReport().total, 0);
  assert.equal(host.mailbox().requeueCount(mail.id), 0);

  for (let claim = 1; claim <= DEFAULT_MAX_ROLE_REQUEUES; claim += 1) {
    join(host, lonely, "reviewer");
    assert.equal(host.mailbox().requeueCount(mail.id), claim);
    assert.equal(host.deadLetterReport().total, 0);
    assert.equal(seen.length, 0);
  }

  join(host, lonely, "reviewer");
  const report = host.deadLetterReport();
  assert.equal(report.total, 1);
  assert.deepEqual(report.byRole, [{ role: "reviewer", count: 1 }]);
  assert.deepEqual(report.byReason, [{ reason: "requeue-limit", count: 1 }]);
  assert.equal(report.observerErrors, 0);
  assert.equal(report.entries[0]?.mail.id, mail.id);
  assert.equal(report.entries[0]?.mail.body, "anyone reviewing?");
  assert.equal(report.entries[0]?.requeues, DEFAULT_MAX_ROLE_REQUEUES);
  assert.deepEqual(
    seen.map((entry) => entry.mail.id),
    [mail.id]
  );
  assert.deepEqual(host.mailbox().pendingForRole("reviewer"), []);
});

test("a cluster that delivers its mail reports nothing", () => {
  const seen: ClusterDeadLetter[] = [];
  const host = makeHost((entry) => seen.push(entry));
  const scout = createAgentInstanceId();
  const impl = createAgentInstanceId();
  join(host, scout, "scout");
  host.send({ from: scout, body: "found src/parser.ts", addressRole: "implementer" });
  join(host, impl, "implementer");

  assert.equal(host.inbox(impl).length, 1);
  assert.deepEqual(host.deadLetterReport(), {
    total: 0,
    byRole: [],
    byReason: [],
    entries: [],
    observerErrors: 0
  });
  assert.equal(seen.length, 0);
});

test("counts group by role and reason, most-dropped first", () => {
  const host = makeHost();
  const drops: readonly (readonly [AgentRole, number])[] = [
    ["reviewer", 2],
    ["tester", 2],
    ["planner", 1]
  ];
  for (const [role, count] of drops) {
    const lonely = createAgentInstanceId();
    join(host, lonely, role);
    for (let index = 0; index < count; index += 1) {
      host.send({ from: lonely, body: `${role} cast ${index}`, addressRole: role });
    }
    starve(host, lonely, role);
  }

  const report = host.deadLetterReport();
  assert.equal(report.total, 5);
  assert.deepEqual(report.byRole, [
    { role: "reviewer", count: 2 },
    { role: "tester", count: 2 },
    { role: "planner", count: 1 }
  ]);
  assert.deepEqual(report.byReason, [{ reason: "requeue-limit", count: 5 }]);
  assert.deepEqual(
    report.entries.map((entry) => entry.role),
    ["reviewer", "reviewer", "tester", "tester", "planner"]
  );
});

test("an observer that throws is tallied and does not fail the registration", () => {
  const host = makeHost(() => {
    throw new Error("reporter is down");
  });
  const lonely = createAgentInstanceId();
  join(host, lonely, "planner");
  host.send({ from: lonely, body: "plan review?", addressRole: "planner" });
  starve(host, lonely, "planner");

  const report = host.deadLetterReport();
  assert.equal(report.total, 1);
  assert.equal(report.observerErrors, 1);
  assert.equal(report.entries[0]?.reason, "requeue-limit");
  // The registration that observed the drop still took effect.
  assert.deepEqual(
    host.peers().map((entry) => entry.agentId),
    [lonely]
  );
});

test("a drop caused outside register is reported at once and pushed exactly once", () => {
  const seen: ClusterDeadLetter[] = [];
  const host = makeHost((entry) => seen.push(entry));
  const lonely = createAgentInstanceId();
  join(host, lonely, "debugger");
  const mail = host.send({ from: lonely, body: "stack trace?", addressRole: "debugger" });

  const mailbox = host.mailbox();
  for (let claim = 0; claim <= DEFAULT_MAX_ROLE_REQUEUES; claim += 1) {
    mailbox.claimRole("debugger", lonely);
  }
  // The report reads the mailbox, so it never lags behind a direct claim.
  assert.equal(host.deadLetterReport().total, 1);
  assert.equal(seen.length, 0);

  join(host, createAgentInstanceId(), "worker");
  assert.deepEqual(
    seen.map((entry) => entry.mail.id),
    [mail.id]
  );
  join(host, createAgentInstanceId(), "worker");
  assert.equal(seen.length, 1);
});

test("a report is a snapshot, not a live view", () => {
  const host = makeHost();
  const first = createAgentInstanceId();
  join(host, first, "worker");
  host.send({ from: first, body: "first", addressRole: "worker" });
  starve(host, first, "worker");
  const snapshot = host.deadLetterReport();

  const second = createAgentInstanceId();
  join(host, second, "tester");
  host.send({ from: second, body: "second", addressRole: "tester" });
  starve(host, second, "tester");

  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(host.deadLetterReport().total, 2);
});

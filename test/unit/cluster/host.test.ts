import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createClusterHost, type ClusterSpawnedTask } from "../../../src/cluster/host.js";
import { MAX_SPAWN_DEPTH } from "../../../src/cluster/spawn.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseTaskId, type AgentInstanceId } from "../../../src/domain/ids.js";

function makeHost(spawned: ClusterSpawnedTask[] = [], maxTasks = 10) {
  return createClusterHost({
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    maxTasks,
    onSpawn: (task) => spawned.push(task)
  });
}

const agent = (id: string): AgentInstanceId => id as AgentInstanceId;

test("duplicate agent registration fails closed", () => {
  const host = makeHost();
  host.register(agent("agt_a"), "planner", parseTaskId("tsk_a"));
  assert.throws(
    () => host.register(agent("agt_a"), "worker", parseTaskId("tsk_b")),
    DomainValidationError
  );
});

test("spawn-tree depth accumulates and MAX_SPAWN_DEPTH refuses further spawns", () => {
  const spawned: ClusterSpawnedTask[] = [];
  const host = makeHost(spawned);
  host.register(agent("agt_planner"), "planner", parseTaskId("tsk_root"), { depth: 0 });
  host.spawn({ parentAgentId: agent("agt_planner"), role: "worker", objective: "level 1" });
  assert.equal(spawned[0]?.depth, 1);
  assert.equal(spawned[0]?.parentAgentId, agent("agt_planner"));

  // The child registers with the depth fixed at spawn time, even though its
  // parent has already finished and deregistered.
  host.deregister(agent("agt_planner"), "complete");
  host.register(agent("agt_worker"), "worker", spawned[0]!.taskId, {
    depth: spawned[0]!.depth,
    parentAgentId: spawned[0]!.parentAgentId
  });
  host.spawn({ parentAgentId: agent("agt_worker"), role: "tester", objective: "level 2" });
  assert.equal(spawned[1]?.depth, 2);

  host.register(agent("agt_tester"), "tester", spawned[1]!.taskId, { depth: spawned[1]!.depth });
  assert.equal(spawned[1]!.depth, MAX_SPAWN_DEPTH);
  assert.throws(
    () => host.spawn({ parentAgentId: agent("agt_tester"), role: "scout", objective: "level 3" }),
    /depth|delegate/
  );

  // Even a delegating role refuses at the depth ceiling — the bound is depth,
  // not just the role allowlist.
  host.register(agent("agt_deep_worker"), "worker", parseTaskId("tsk_deep"), {
    depth: MAX_SPAWN_DEPTH
  });
  assert.throws(
    () => host.spawn({ parentAgentId: agent("agt_deep_worker"), role: "scout", objective: "level 3" }),
    /depth/
  );
});

test("deregistration frees cluster task capacity", () => {
  const spawned: ClusterSpawnedTask[] = [];
  const host = makeHost(spawned, 2);
  host.register(agent("agt_p"), "planner", parseTaskId("tsk_p"));
  host.register(agent("agt_done"), "scout", parseTaskId("tsk_done"));
  // Directory is at maxTasks — spawn refuses.
  assert.throws(
    () => host.spawn({ parentAgentId: agent("agt_p"), role: "worker", objective: "x" }),
    /maxTasks/
  );
  // A finished agent releases its slot.
  host.deregister(agent("agt_done"), "complete");
  host.spawn({ parentAgentId: agent("agt_p"), role: "worker", objective: "x" });
  assert.equal(spawned.length, 1);
  assert.equal(host.peers().length, 1);
});

test("handoff deregistration re-queues undrained mail for a same-role successor", () => {
  const host = makeHost();
  host.register(agent("agt_scout"), "scout", parseTaskId("tsk_s"));
  host.register(agent("agt_impl1"), "implementer", parseTaskId("tsk_i"));
  host.send({ from: agent("agt_scout"), body: "found src/parser.ts", addressRole: "implementer" });
  assert.equal(host.inbox(agent("agt_impl1")).length, 1);

  // Attempt 1 dies without draining; a successor attempt must inherit the mail.
  host.deregister(agent("agt_impl1"), "handoff");
  host.register(agent("agt_impl2"), "implementer", parseTaskId("tsk_i"));
  const inherited = host.inbox(agent("agt_impl2"));
  assert.equal(inherited.length, 1);
  assert.equal(inherited[0]?.body, "found src/parser.ts");
});

test("complete deregistration consumes undrained mail instead of re-queuing it", () => {
  const host = makeHost();
  host.register(agent("agt_scout"), "scout", parseTaskId("tsk_s"));
  host.register(agent("agt_impl1"), "implementer", parseTaskId("tsk_i"));
  host.send({ from: agent("agt_scout"), body: "stale finding", addressRole: "implementer" });

  host.deregister(agent("agt_impl1"), "complete");
  host.register(agent("agt_impl2"), "implementer", parseTaskId("tsk_i2"));
  assert.equal(host.inbox(agent("agt_impl2")).length, 0, "completed work must not replay its mail");
});

test("deregistering an unknown agent is a safe no-op", () => {
  const host = makeHost();
  host.deregister(agent("agt_ghost"), "complete");
  assert.equal(host.peers().length, 0);
});

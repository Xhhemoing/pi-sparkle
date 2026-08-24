import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ClusterSessionView } from "../../../src/cluster/host.js";
import type { ClusterMail } from "../../../src/cluster/mailbox.js";
import type { AgentInstanceId, TaskId } from "../../../src/domain/ids.js";
import type { AgentRole } from "../../../src/domain/roles.js";
import { createClusterTools } from "../../../src/pi-adapter/cluster-tools.js";

interface FakeSession {
  readonly session: ClusterSessionView;
  readonly sends: Array<{ body: string; to?: AgentInstanceId; addressRole?: AgentRole }>;
  readonly spawns: Array<{ role: AgentRole; objective: string }>;
}

function mail(from: string, body: string): ClusterMail {
  return {
    id: "msg_test",
    from: from as AgentInstanceId,
    to: "agt_recipient" as AgentInstanceId,
    body,
    occurredAt: "2026-08-24T00:00:00.000Z"
  } as ClusterMail;
}

function fakeSession(inbox: readonly ClusterMail[] = []): FakeSession {
  const sends: FakeSession["sends"] = [];
  const spawns: FakeSession["spawns"] = [];
  return {
    sends,
    spawns,
    session: {
      send(input) {
        sends.push(input);
        return {
          ...mail("agt_sender", input.body),
          ...(input.to !== undefined ? { to: input.to } : {}),
          ...(input.addressRole !== undefined ? { addressRole: input.addressRole } : {})
        };
      },
      inbox: () => inbox,
      spawn(input) {
        spawns.push(input);
        return { taskId: "tsk_child" as TaskId };
      },
      peers: () => []
    }
  };
}

function toolNamed(session: ClusterSessionView, name: string): AgentTool {
  const tool = createClusterTools(session).find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} must be registered`);
  return tool;
}

async function executeText(tool: AgentTool, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute("tool_call_1", params);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  return content.text;
}

describe("createClusterTools sparkle_send", () => {
  it("passes a validated role-addressed message to the cluster session", async () => {
    const fake = fakeSession();
    const text = await executeText(toolNamed(fake.session, "sparkle_send"), {
      body: "status?",
      addressRole: "reviewer"
    });

    assert.equal(text, "sent msg_test");
    assert.deepEqual(fake.sends, [{ body: "status?", addressRole: "reviewer" }]);
  });

  it("rejects an unknown role instead of silently sending without a recipient", async () => {
    const fake = fakeSession();
    const send = toolNamed(fake.session, "sparkle_send");

    await assert.rejects(
      send.execute("tool_call_1", { body: "status?", addressRole: "manager" }),
      /invalid address role manager/
    );
    assert.deepEqual(fake.sends, []);
  });

  it("rejects a malformed agent id even when another recipient is valid", async () => {
    const fake = fakeSession();
    const send = toolNamed(fake.session, "sparkle_send");

    await assert.rejects(
      send.execute("tool_call_1", {
        body: "status?",
        addressRole: "reviewer",
        to: "reviewer-1"
      }),
      /invalid agent id reviewer-1/
    );
    assert.deepEqual(fake.sends, []);
  });
});

describe("createClusterTools sparkle_inbox", () => {
  it("formats pending messages without network access", async () => {
    const fake = fakeSession([mail("agt_scout", "found it"), mail("agt_tester", "tests pass")]);
    const text = await executeText(toolNamed(fake.session, "sparkle_inbox"), {});

    assert.equal(text, "agt_scout: found it\nagt_tester: tests pass");
  });

  it("reports an empty inbox", async () => {
    const fake = fakeSession();
    assert.equal(await executeText(toolNamed(fake.session, "sparkle_inbox"), {}), "(empty inbox)");
  });
});

describe("createClusterTools sparkle_spawn_subagent", () => {
  it("returns the dispatch preflight refusal for an undeclared Pi agent name", async () => {
    const fake = fakeSession();
    const text = await executeText(toolNamed(fake.session, "sparkle_spawn_subagent"), {
      role: "general-purpose",
      objective: "inspect the implementation"
    });

    assert.equal(text, "Unknown agent: general-purpose. Available: (none) [undeclared]");
    assert.deepEqual(fake.spawns, []);
  });

  it("delegates a valid role and objective to the cluster session", async () => {
    const fake = fakeSession();
    const text = await executeText(toolNamed(fake.session, "sparkle_spawn_subagent"), {
      role: "tester",
      objective: "run focused tests"
    });

    assert.equal(text, "spawned tsk_child");
    assert.deepEqual(fake.spawns, [{ role: "tester", objective: "run focused tests" }]);
  });
});

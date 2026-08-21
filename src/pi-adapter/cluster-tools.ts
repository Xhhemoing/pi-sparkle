/* eslint-disable @typescript-eslint/no-explicit-any --
 * Pi tool schemas are generic; this file is inside the adapter boundary. */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { isAgentRole } from "../domain/roles.js";
import { isAgentInstanceId } from "../domain/ids.js";
import { preflightPiAgentName } from "../agents/dispatch-preflight.js";
import type { ClusterSessionView } from "../cluster/host.js";

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * Pi-native cluster tools. Sparkle owns spawn/send/inbox; this wrapper only
 * translates them into AgentTool so a Pi Agent can call peers.
 */
export function createClusterTools(session: ClusterSessionView): AgentTool<any>[] {
  return [
    {
      name: "sparkle_send",
      label: "Sparkle Send",
      description:
        "Send a message to a peer subagent. Provide addressRole (scout, implementer, reviewer, tester, debugger, worker, planner) or to (agt_...).",
      parameters: Type.Object({
        body: Type.String(),
        addressRole: Type.Optional(Type.String()),
        to: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId: string, params: unknown) => {
        const record = params as { body?: string; addressRole?: string; to?: string };
        const body = typeof record.body === "string" ? record.body : "";
        const addressRole =
          record.addressRole !== undefined && isAgentRole(record.addressRole) ? record.addressRole : undefined;
        const to = record.to !== undefined && isAgentInstanceId(record.to) ? record.to : undefined;
        const mail = session.send({
          body,
          ...(to !== undefined ? { to } : {}),
          ...(addressRole !== undefined ? { addressRole } : {})
        });
        return textResult(`sent ${mail.id}`);
      }
    },
    {
      name: "sparkle_inbox",
      label: "Sparkle Inbox",
      description: "Read pending peer messages for this subagent.",
      parameters: Type.Object({}),
      execute: async (_toolCallId: string, _params: unknown) => {
        const inbox = session.inbox();
        if (inbox.length === 0) return textResult("(empty inbox)");
        return textResult(inbox.map((mail) => `${mail.from}: ${mail.body}`).join("\n"));
      }
    },
    {
      name: "sparkle_spawn_subagent",
      label: "Sparkle Spawn",
      description:
        "Spawn a bounded child subagent. Allowed from planner/worker/debugger. Roles: scout, implementer, reviewer, tester, debugger, worker.",
      parameters: Type.Object({
        role: Type.String(),
        objective: Type.String()
      }),
      execute: async (_toolCallId: string, params: unknown) => {
        const record = params as { role?: string; objective?: string };
        if (!isAgentRole(record.role) || typeof record.objective !== "string") {
          if (typeof record.role === "string" && record.role.trim() !== "") {
            const refused = preflightPiAgentName(record.role, []);
            if (!refused.ok) {
              return textResult(`${refused.message} [${refused.code}]`);
            }
          }
          return textResult(`unknown role ${String(record.role)}`);
        }
        const spawned = session.spawn({ role: record.role, objective: record.objective });
        return textResult(`spawned ${spawned.taskId}`);
      }
    }
  ];
}

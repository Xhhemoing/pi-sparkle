export const AGENT_ROLES = [
  "worker",
  "scout",
  "planner",
  "implementer",
  "reviewer",
  "tester",
  "debugger"
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

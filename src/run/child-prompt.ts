import type { AgentProfile } from "../agents/registry.js";
import { formatPacketForPrompt, type ContextPacket } from "../context/packet.js";

export interface ChildPromptAcceptance {
  readonly id: string;
  readonly description: string;
}

export interface ChildPromptMail {
  readonly from: string;
  readonly body: string;
}

export interface ChildPromptInput {
  readonly role: string;
  readonly objective: string;
  readonly profile: Pick<AgentProfile, "systemInstruction" | "canWriteWorkspace" | "allowedToolNames">;
  readonly assignedModel?: string | undefined;
  readonly peersLine?: string | undefined;
  readonly inbox?: readonly ChildPromptMail[] | undefined;
  readonly packet?: ContextPacket | undefined;
  readonly predecessorNotes?: readonly string[] | undefined;
  readonly acceptanceCriteria?: readonly ChildPromptAcceptance[] | undefined;
}

/**
 * Builds the child executor prompt. Role instruction and repo grounding come
 * before the objective so a vibe-coded one-liner cannot drown the contract.
 */
export function formatChildPrompt(input: ChildPromptInput): string {
  const lines: string[] = [];
  lines.push(input.profile.systemInstruction.trim());
  lines.push("");
  lines.push(`Write access: ${input.profile.canWriteWorkspace ? "allowed" : "forbidden"}`);
  lines.push(`Allowed tools: ${input.profile.allowedToolNames.join(", ")}`);
  if (input.assignedModel !== undefined) {
    lines.push(`Assigned model: ${input.assignedModel}`);
  }
  lines.push(`Role: ${input.role}`);
  if (input.peersLine !== undefined) {
    lines.push(`Peers: ${input.peersLine}`);
  }
  if (input.inbox !== undefined) {
    lines.push("Inbox:");
    if (input.inbox.length === 0) {
      lines.push("- (empty)");
    } else {
      for (const mail of input.inbox) {
        lines.push(`- from ${mail.from}: ${mail.body}`);
      }
    }
  }
  if (input.packet !== undefined) {
    lines.push("", formatPacketForPrompt(input.packet));
  }
  if (input.predecessorNotes !== undefined && input.predecessorNotes.length > 0) {
    lines.push("", "Predecessor results (use these; do not re-invent):");
    for (const note of input.predecessorNotes) {
      lines.push(`- ${note}`);
    }
  }
  if (input.acceptanceCriteria !== undefined && input.acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance:");
    for (const criterion of input.acceptanceCriteria) {
      lines.push(`- ${criterion.id}: ${criterion.description}`);
    }
  }
  lines.push("", "Objective:", input.objective);
  return lines.join("\n");
}

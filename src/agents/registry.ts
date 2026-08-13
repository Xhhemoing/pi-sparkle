import { DomainValidationError } from "../domain/errors.js";
import { isAgentProfileId, type AgentProfileId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";

/** Minimal structural JSON schema used for profile input/output contracts. */
export interface JsonSchema {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
}

export interface AgentProfile {
  id: AgentProfileId;
  role: AgentRole;
  systemInstruction: string;
  allowedToolNames: string[];
  canWriteWorkspace: boolean;
  canDelegate: boolean;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

const JSON_SCHEMA_TYPES = ["object", "array", "string", "number", "boolean", "null"] as const;

function isJsonSchema(value: unknown, depth = 0): boolean {
  if (depth > 8 || !isRecord(value)) return false;
  if (typeof value.type !== "string" || !(JSON_SCHEMA_TYPES as readonly string[]).includes(value.type)) {
    return false;
  }
  if (value.type === "object") {
    if (value.properties !== undefined) {
      if (!isRecord(value.properties)) return false;
      if (!Object.values(value.properties).every((schema) => isJsonSchema(schema, depth + 1))) return false;
    }
    if (value.required !== undefined) {
      if (!Array.isArray(value.required) || !value.required.every((name) => typeof name === "string" && name !== "")) {
        return false;
      }
    }
  }
  if (value.type === "array" && value.items !== undefined && !isJsonSchema(value.items, depth + 1)) {
    return false;
  }
  return true;
}

function profileError(value: unknown): string | undefined {
  if (!isRecord(value)) return "expected an object";
  if (!isAgentProfileId(value.id)) return "id must be a valid AgentProfileId";
  if (!isAgentRole(value.role)) return "role must be a known AgentRole";
  if (typeof value.systemInstruction !== "string" || value.systemInstruction.trim() === "") {
    return "systemInstruction must be a non-empty string";
  }
  if (
    !Array.isArray(value.allowedToolNames) ||
    value.allowedToolNames.length === 0 ||
    !value.allowedToolNames.every((name) => typeof name === "string" && name.trim() !== "")
  ) {
    return "allowedToolNames must be a non-empty array of non-empty strings";
  }
  if (typeof value.canWriteWorkspace !== "boolean") return "canWriteWorkspace must be a boolean";
  if (typeof value.canDelegate !== "boolean") return "canDelegate must be a boolean";
  if (!isJsonSchema(value.inputSchema)) return "inputSchema must be a valid JsonSchema";
  if (!isJsonSchema(value.outputSchema)) return "outputSchema must be a valid JsonSchema";
  return undefined;
}

export function isAgentProfile(value: unknown): value is AgentProfile {
  return profileError(value) === undefined;
}

export function validateAgentProfile(value: unknown): AgentProfile {
  const reason = profileError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid AgentProfile: ${reason}`);
  }
  return value as AgentProfile;
}

export interface AgentProfileRegistry {
  resolve(role: AgentRole): AgentProfile;
  has(role: AgentRole): boolean;
  list(): AgentProfile[];
}

export function createAgentProfileRegistry(profiles: readonly AgentProfile[]): AgentProfileRegistry {
  const byRole = new Map<AgentRole, AgentProfile>();
  for (const profile of profiles) {
    validateAgentProfile(profile);
    if (byRole.has(profile.role)) {
      throw new DomainValidationError(`Duplicate AgentProfile for role: ${profile.role}`);
    }
    byRole.set(profile.role, profile);
  }
  return {
    resolve(role: AgentRole): AgentProfile {
      const profile = byRole.get(role);
      if (profile === undefined) {
        throw new DomainValidationError(`Unknown agent role: ${role}`);
      }
      return profile;
    },
    has(role: AgentRole): boolean {
      return byRole.has(role);
    },
    list(): AgentProfile[] {
      return Array.from(byRole.values());
    }
  };
}

const READ_ONLY_TOOLS = ["read_file", "search_files", "git_status", "git_diff", "list_dir"] as const;

/** Built-in logical profiles. Roles never embed a concrete model/provider. */
export function defaultAgentProfiles(): AgentProfile[] {
  const profile = (
    role: AgentRole,
    systemInstruction: string,
    extraTools: readonly string[] = []
  ): AgentProfile => ({
    id: `prf_default_${role}` as AgentProfileId,
    role,
    systemInstruction,
    allowedToolNames: [...READ_ONLY_TOOLS, ...extraTools],
    canWriteWorkspace: false,
    canDelegate: false,
    inputSchema: { type: "object", properties: { objective: { type: "string" } }, required: ["objective"] },
    outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
  });

  return [
    profile("worker", "Execute the assigned development task in the project workspace."),
    profile("scout", "Inspect the project workspace and report facts, structure, and risks.", ["grep"]),
    profile("planner", "Decompose an objective into an ordered, verifiable task plan.", ["grep"]),
    profile("implementer", "Implement the requested change against the project conventions."),
    profile("reviewer", "Review a change set against the acceptance criteria and report findings.", ["grep"]),
    profile("tester", "Run the configured validation commands and report results.", ["run_test"]),
    profile("debugger", "Investigate a failure, reproduce it, and attribute a root cause.", ["grep", "run_test"])
  ];
}

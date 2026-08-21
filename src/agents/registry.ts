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
const WRITE_TOOLS = ["write_file", "edit_file"] as const;

const ROLE_INSTRUCTIONS: Record<AgentRole, string> = {
  worker:
    "Execute only the assigned development task. Read existing code and conventions before editing. Make the smallest change that satisfies the objective. Do not invent APIs, files, or dependencies.",
  scout:
    "Inspect the project workspace and report facts, structure, and risks. Cite file paths. Do not invent modules that are not present. Do not propose a large rewrite.",
  planner:
    "Decompose the objective into independently verifiable tasks. Prefer the cheapest reliable plan. Do not expand scope beyond the contract.",
  implementer:
    "Read the existing code and conventions before editing. Make the smallest change that satisfies the objective. Do not invent APIs, files, or dependencies. Do not drive-by refactor. Cite the files you changed. Do not claim the work is verified unless tests or an observable check actually ran.",
  reviewer:
    "Review the change against the acceptance criteria. Reject missing tests, invented APIs, and unverifiable claims. Do not rubber-stamp. Cite concrete findings with file paths.",
  tester:
    "Run the project's validation commands and report actual results. Never claim PASSED without running tests. Quote the command and its outcome.",
  debugger:
    "Reproduce the failure before changing code. Attribute a root cause with evidence. Prefer a minimal fix. Do not invent APIs or unrelated refactors."
};

const WRITER_ROLES: ReadonlySet<AgentRole> = new Set(["worker", "implementer", "debugger"]);

/** Built-in logical profiles. Roles never embed a concrete model/provider. */
export function defaultAgentProfiles(): AgentProfile[] {
  const profile = (
    role: AgentRole,
    extraTools: readonly string[] = [],
    canDelegate = false
  ): AgentProfile => ({
    id: `prf_default_${role}` as AgentProfileId,
    role,
    systemInstruction: ROLE_INSTRUCTIONS[role],
    allowedToolNames: [
      ...READ_ONLY_TOOLS,
      ...(WRITER_ROLES.has(role) ? WRITE_TOOLS : []),
      ...extraTools
    ],
    canWriteWorkspace: WRITER_ROLES.has(role),
    canDelegate,
    inputSchema: { type: "object", properties: { objective: { type: "string" } }, required: ["objective"] },
    outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
  });

  return [
    profile("worker", [], true),
    profile("scout", ["grep"]),
    profile("planner", ["grep"], true),
    profile("implementer"),
    profile("reviewer", ["grep"]),
    profile("tester", ["run_test"]),
    profile("debugger", ["grep", "run_test"], true)
  ];
}

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { isAgentRole, type AgentRole } from "../domain/roles.js";

export const DISPATCH_CONTRACT_VERSION = 1 as const;

export type DispatchRefusalCode = "undeclared" | "declared-missing" | "unmapped-role";

export interface PiDispatchContract {
  readonly schemaVersion: typeof DISPATCH_CONTRACT_VERSION;
  /** Outer Pi agent names this project may dispatch. Not a snapshot of ~/.pi. */
  readonly piProfiles: readonly string[];
  /** Explicit AgentRole → Pi profile. Missing keys fail closed; never guessed. */
  readonly roleToPiProfile: Readonly<Partial<Record<AgentRole, string>>>;
}

/**
 * Versioned read-only dispatch contract. `general-purpose` is intentionally
 * absent. `implementer` maps to `worker`; `tester` is unmapped until declared.
 */
export const DEFAULT_PI_DISPATCH_CONTRACT: PiDispatchContract = {
  schemaVersion: DISPATCH_CONTRACT_VERSION,
  piProfiles: ["debugger", "planner", "reviewer", "scout", "worker"],
  roleToPiProfile: {
    worker: "worker",
    scout: "scout",
    planner: "planner",
    implementer: "worker",
    reviewer: "reviewer",
    debugger: "debugger"
  }
};

export type DispatchPreflight =
  | { readonly ok: true; readonly profile: string }
  | {
      readonly ok: false;
      readonly code: DispatchRefusalCode;
      readonly requestedName: string;
      readonly available: readonly string[];
      readonly message: string;
    };

function sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => name.trim() !== ""))].sort();
}

function refusal(
  code: DispatchRefusalCode,
  requestedName: string,
  available: readonly string[],
  detail: string
): DispatchPreflight {
  const listed = available.length === 0 ? "(none)" : available.join(", ");
  return {
    ok: false,
    code,
    requestedName,
    available,
    message: `${detail} Available: ${listed}`
  };
}

export function preflightPiAgentName(
  requestedName: string,
  loadedProfiles: readonly string[],
  contract: PiDispatchContract = DEFAULT_PI_DISPATCH_CONTRACT
): DispatchPreflight {
  const name = requestedName.trim();
  const available = sortedUnique(loadedProfiles);
  if (name === "" || !contract.piProfiles.includes(name)) {
    return refusal("undeclared", name === "" ? requestedName : name, available, `Unknown agent: ${name || requestedName}.`);
  }
  if (!available.includes(name)) {
    return refusal(
      "declared-missing",
      name,
      available,
      `Declared Pi profile ${name} is not loaded.`
    );
  }
  return { ok: true, profile: name };
}

export function preflightAgentRole(
  role: string,
  loadedProfiles: readonly string[],
  contract: PiDispatchContract = DEFAULT_PI_DISPATCH_CONTRACT
): DispatchPreflight {
  if (!isAgentRole(role)) {
    return preflightPiAgentName(role, loadedProfiles, contract);
  }
  const mapped = contract.roleToPiProfile[role];
  if (mapped === undefined) {
    return refusal(
      "unmapped-role",
      role,
      sortedUnique(loadedProfiles),
      `Agent role ${role} has no declared Pi profile mapping.`
    );
  }
  return preflightPiAgentName(mapped, loadedProfiles, contract);
}

export interface PiDispatchGuard {
  dispatch(requestedName: string): DispatchPreflight;
  dispatchRole(role: string): DispatchPreflight;
}

export function createPiDispatchGuard(input: {
  readonly loadedProfiles: readonly string[];
  readonly contract?: PiDispatchContract;
  readonly writeRun?: (profile: string) => void;
}): PiDispatchGuard {
  const contract = input.contract ?? DEFAULT_PI_DISPATCH_CONTRACT;
  const run = (result: DispatchPreflight): DispatchPreflight => {
    if (result.ok) input.writeRun?.(result.profile);
    return result;
  };
  return {
    dispatch(requestedName: string): DispatchPreflight {
      return run(preflightPiAgentName(requestedName, input.loadedProfiles, contract));
    },
    dispatchRole(role: string): DispatchPreflight {
      return run(preflightAgentRole(role, input.loadedProfiles, contract));
    }
  };
}

export function listPiAgentProfiles(agentsDir: string): string[] {
  try {
    const names = readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".md")
      .map((entry) => basename(entry.name, extname(entry.name)))
      .filter((name) => name.trim() !== "");
    return sortedUnique(names);
  } catch {
    return [];
  }
}

export function listPiAgentProfilesFromDirs(agentsDirs: readonly string[]): string[] {
  const names: string[] = [];
  for (const dir of agentsDirs) {
    names.push(...listPiAgentProfiles(dir));
  }
  return sortedUnique(names);
}

export function defaultUserPiAgentsDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return join(fromEnv, "agents");
  }
  return join(homedir(), ".pi", "agent", "agents");
}

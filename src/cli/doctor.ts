import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEFAULT_PI_DISPATCH_CONTRACT,
  defaultUserPiAgentsDir,
  listPiAgentProfilesFromDirs
} from "../agents/dispatch-preflight.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import { readPinnedPiVersions } from "../pi-compat/check.js";
import { CLI_EXIT, cliFail, type CliErrorIo } from "./errors.js";
import { skillRouteLogCheck, unknownAgentDriftCheck } from "./doctor-overlay.js";
import { buildOfflinePiCompatReport, piCompatBreakage, readSparklePackageJson } from "./pi-compat.js";

export interface DoctorIo extends CliErrorIo {
  stdout(text: string): void;
}

export interface PackageEngines {
  readonly version: string;
  readonly enginesNode: string;
  readonly packageManager: string;
}

interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

function readPackageEngines(): PackageEngines {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../../package.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    version?: unknown;
    engines?: { node?: unknown };
    packageManager?: unknown;
  };
  const version = typeof parsed.version === "string" ? parsed.version : "unknown";
  const enginesNode =
    typeof parsed.engines?.node === "string" ? parsed.engines.node : ">=22.19.0";
  const packageManager =
    typeof parsed.packageManager === "string" ? parsed.packageManager : "pnpm@10.17.1";
  return { version, enginesNode, packageManager };
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
  const minParts = minimum.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(actualParts.length, minParts.length);
  for (let i = 0; i < length; i++) {
    const a = Number.isFinite(actualParts[i]) ? (actualParts[i] as number) : 0;
    const m = Number.isFinite(minParts[i]) ? (minParts[i] as number) : 0;
    if (a > m) return true;
    if (a < m) return false;
  }
  return true;
}

function minimumFromEngineRange(range: string): string {
  const match = range.trim().match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? "22.19.0";
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

async function stateRootWritable(stateRoot: string): Promise<DoctorCheck> {
  try {
    await mkdir(stateRoot, { recursive: true });
    await access(stateRoot, constants.W_OK);
    const probe = join(stateRoot, ".doctor-write-probe");
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
    return { name: "state-root", ok: true, detail: `${stateRoot} writable` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "state-root", ok: false, detail: `${stateRoot} not writable: ${message}` };
  }
}

function nodeCheck(engines: PackageEngines): DoctorCheck {
  const minimum = minimumFromEngineRange(engines.enginesNode);
  const actual = process.versions.node;
  const ok = versionAtLeast(actual, minimum);
  return {
    name: "node",
    ok,
    detail: `${actual} (engines ${engines.enginesNode})${ok ? "" : ` — need >= ${minimum}`}`
  };
}

function pnpmCheck(engines: PackageEngines): DoctorCheck {
  const expected = engines.packageManager.replace(/^pnpm@/, "");
  const userAgent = process.env.npm_config_user_agent ?? "";
  const fromAgent = userAgent.match(/pnpm\/(\d+\.\d+\.\d+)/)?.[1];
  const actual = fromAgent ?? "(not invoked via pnpm)";
  const ok = fromAgent === undefined || fromAgent === expected;
  return {
    name: "pnpm",
    ok,
    detail: `${actual}; packageManager pnpm@${expected}`
  };
}

async function providersCheck(stateRoot: string): Promise<DoctorCheck> {
  try {
    const config = await loadProvidersConfig(stateRoot);
    const primary = config.primary ?? "(none)";
    const enabled = config.enabled.length;
    return {
      name: "providers",
      ok: true,
      detail: `enabled=${enabled} primary=${primary} — fake executor does not need credentials`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "providers", ok: false, detail: message };
  }
}

async function projectCheck(projectRoot: string | undefined): Promise<DoctorCheck> {
  if (projectRoot === undefined) {
    return { name: "project", ok: true, detail: "omitted (pass --project to check package.json)" };
  }
  try {
    await access(join(projectRoot, "package.json"), constants.R_OK);
    return { name: "project", ok: true, detail: `${projectRoot} has package.json` };
  } catch {
    return { name: "project", ok: false, detail: `${projectRoot} is missing package.json` };
  }
}

function piDispatchCheck(projectRoot: string | undefined, agentsDir: string | undefined): DoctorCheck {
  const dirs =
    agentsDir !== undefined
      ? [agentsDir]
      : [
          defaultUserPiAgentsDir(),
          ...(projectRoot !== undefined ? [join(projectRoot, ".pi", "agents")] : [])
        ];
  const existing = dirs.filter((dir) => existsSync(dir));
  if (existing.length === 0) {
    return { name: "pi-dispatch", ok: true, detail: "skipped (no agents dir)" };
  }
  const loaded = listPiAgentProfilesFromDirs(existing);
  const missing = DEFAULT_PI_DISPATCH_CONTRACT.piProfiles.filter((name) => !loaded.includes(name));
  if (missing.length > 0) {
    const available = loaded.length === 0 ? "(none)" : loaded.join(", ");
    return {
      name: "pi-dispatch",
      ok: false,
      detail: `declared ${missing.join(", ")} not loaded; available: ${available}`
    };
  }
  return {
    name: "pi-dispatch",
    ok: true,
    detail: `declared ${DEFAULT_PI_DISPATCH_CONTRACT.piProfiles.join(", ")} among ${loaded.length} loaded`
  };
}

function piPackagesCheck(): DoctorCheck {
  try {
    const pinned = readPinnedPiVersions(readSparklePackageJson());
    return {
      name: "pi-packages",
      ok: true,
      detail: `agent-core=${pinned.agentCore} ai=${pinned.ai}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "pi-packages", ok: false, detail: message };
  }
}

function piCompatCheck(): DoctorCheck {
  const report = buildOfflinePiCompatReport();
  const breakage = piCompatBreakage(report);
  const note = breakage ?? report.findings[0] ?? "ok";
  return {
    name: "pi-compat",
    ok: breakage === undefined,
    detail: `status=${report.status} (${note.length > 96 ? `${note.slice(0, 93)}...` : note})`
  };
}

export async function doctorCommand(args: string[], io: DoctorIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "state-root": { type: "string" },
      project: { type: "string" },
      "agents-dir": { type: "string" }
    }
  });
  const engines = readPackageEngines();
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const checks: DoctorCheck[] = [
    nodeCheck(engines),
    pnpmCheck(engines),
    await stateRootWritable(stateRoot),
    await providersCheck(stateRoot),
    await projectCheck(values.project),
    piDispatchCheck(values.project, values["agents-dir"]),
    skillRouteLogCheck(values.project),
    unknownAgentDriftCheck(values.project),
    piPackagesCheck(),
    piCompatCheck()
  ];
  io.stdout(`pi-sparkle doctor ${engines.version} (developer preview — not a production capability)\n`);
  io.stdout("  live R1/bandit/topology: off until Checkpoint F-PROD closes\n");
  let failed = false;
  for (const check of checks) {
    io.stdout(`  ${check.ok ? "ok" : "FAIL"}  ${check.name}: ${check.detail}\n`);
    if (!check.ok) failed = true;
  }
  io.stdout("  next: pnpm cli run --project <path> --objective <text> uses the fake executor\n");
  io.stdout("  next: --executor pi requires models set-default or PI_PROVIDER/PI_MODEL\n");
  if (failed) {
    return cliFail(io, {
      command: "doctor",
      stage: "preflight",
      message: "one or more doctor checks failed",
      next: "fix the FAIL lines above, then re-run pi-sparkle doctor"
    });
  }
  return CLI_EXIT.ok;
}

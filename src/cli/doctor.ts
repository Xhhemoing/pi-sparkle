import { access, mkdir, readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
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
import { legacyLayoutCheck, skillRouteLogCheck, unknownAgentDriftCheck } from "./doctor-overlay.js";
import { buildOfflinePiCompatReport, piCompatBreakage, readSparklePackageJson } from "./pi-compat.js";

export interface DoctorIo extends CliErrorIo {
  stdout(text: string): void;
}

export interface DoctorOptions {
  /** Test seam; the real CLI defaults to the current process version. */
  readonly nodeVersion?: string;
  /** Test seam for deterministic lock ages. */
  readonly nowMs?: number;
  /** Test seam; production checks the recorded PID on the local host. */
  readonly pidLiveness?: (pid: number) => RecordedPidLiveness;
}

/**
 * Frozen `--json` contract. Additive changes only: consumers pin `checks[].name`
 * and read `ok` as the single go/no-go signal. In JSON mode stdout carries this
 * object and nothing else; the human-readable failure report still goes to
 * stderr through cliFail, and the exit code is unchanged.
 */
export interface DoctorJsonReport {
  readonly version: string;
  readonly preview: true;
  readonly liveAdaptive: false;
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly next: readonly string[];
  readonly locks: DoctorLockInventory;
}

export type DoctorLockPidLiveness = "running" | "not-running" | "unknown" | "not-recorded";
type RecordedPidLiveness = Exclude<DoctorLockPidLiveness, "not-recorded">;
export type DoctorLockMetadata = "valid" | "empty" | "invalid" | "unreadable";

export interface DoctorLockEntry {
  readonly path: string;
  readonly ageMs: number | null;
  readonly ageSource: "acquiredAt" | "mtime" | null;
  readonly acquiredAt: string | null;
  readonly pid: number | null;
  readonly pidLiveness: DoctorLockPidLiveness;
  readonly metadata: DoctorLockMetadata;
}

export interface DoctorLockInventory {
  readonly advisory: string;
  readonly entries: readonly DoctorLockEntry[];
  readonly scanErrors: readonly string[];
}

export interface PackageEngines {
  readonly version: string;
  readonly enginesNode: string;
  readonly packageManager: string;
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const NEXT_STEPS: readonly string[] = [
  "pnpm cli run --project <path> --objective <text> uses the fake executor",
  "--executor pi requires models set-default or PI_PROVIDER/PI_MODEL"
];

const FIX_FAILURES_NEXT = "fix the failing entries in checks[], then re-run pi-sparkle doctor";
const LOCK_PID_ADVISORY =
  "PID liveness is advisory only: PID reuse and shared/container filesystems mean it cannot prove a lock is stale; doctor never steals or deletes locks";

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

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function localPidLiveness(pid: number): RecordedPidLiveness {
  try {
    process.kill(pid, 0);
    return "running";
  } catch (error) {
    if (errorCode(error) === "ESRCH") return "not-running";
    return "unknown";
  }
}

function recordValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return key in record ? record[key] : undefined;
}

async function inspectLock(
  path: string,
  nowMs: number,
  pidLiveness: (pid: number) => RecordedPidLiveness
): Promise<DoctorLockEntry | undefined> {
  let raw: string | undefined;
  let mtimeMs: number | undefined;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
  }
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
  }

  if (raw === undefined) {
    return {
      path,
      ageMs: mtimeMs === undefined ? null : Math.max(0, nowMs - mtimeMs),
      ageSource: mtimeMs === undefined ? null : "mtime",
      acquiredAt: null,
      pid: null,
      pidLiveness: "not-recorded",
      metadata: "unreadable"
    };
  }

  if (raw.trim() === "") {
    return {
      path,
      ageMs: mtimeMs === undefined ? null : Math.max(0, nowMs - mtimeMs),
      ageSource: mtimeMs === undefined ? null : "mtime",
      acquiredAt: null,
      pid: null,
      pidLiveness: "not-recorded",
      metadata: "empty"
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    value = undefined;
  }
  const ownerToken = recordValue(value, "ownerToken");
  const recordedPid = recordValue(value, "pid");
  const recordedAcquiredAt = recordValue(value, "acquiredAt");
  const pid =
    typeof recordedPid === "number" && Number.isSafeInteger(recordedPid) && recordedPid > 0
      ? recordedPid
      : null;
  const acquiredAt =
    typeof recordedAcquiredAt === "string" && Number.isFinite(Date.parse(recordedAcquiredAt))
      ? recordedAcquiredAt
      : null;
  const acquiredAtMs = acquiredAt === null ? undefined : Date.parse(acquiredAt);
  const ageSource = acquiredAtMs === undefined ? (mtimeMs === undefined ? null : "mtime") : "acquiredAt";
  const sourceMs = acquiredAtMs ?? mtimeMs;
  const metadata =
    typeof ownerToken === "string" && ownerToken.length > 0 && pid !== null && acquiredAt !== null
      ? "valid"
      : "invalid";

  return {
    path,
    ageMs: sourceMs === undefined ? null : Math.max(0, nowMs - sourceMs),
    ageSource,
    acquiredAt,
    pid,
    pidLiveness: pid === null ? "not-recorded" : pidLiveness(pid),
    metadata
  };
}

async function lockInventory(
  stateRoot: string,
  options: DoctorOptions
): Promise<DoctorLockInventory> {
  const entries: DoctorLockEntry[] = [];
  const scanErrors: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const pidLiveness = options.pidLiveness ?? localPidLiveness;

  async function visit(dir: string): Promise<void> {
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        scanErrors.push(`${dir}: ${message}`);
      }
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(dir, child.name);
      if (child.isDirectory()) {
        await visit(path);
      } else if (child.isFile() && child.name.endsWith(".lock")) {
        const entry = await inspectLock(path, nowMs, pidLiveness);
        if (entry !== undefined) entries.push(entry);
      }
    }
  }

  await visit(stateRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { advisory: LOCK_PID_ADVISORY, entries, scanErrors };
}

function lockInventoryCheck(inventory: DoctorLockInventory): DoctorCheck {
  const unreadable = inventory.entries.filter((entry) => entry.metadata === "unreadable").length;
  const errors = inventory.scanErrors.length;
  const ok = unreadable === 0 && errors === 0;
  const problems = [
    ...(unreadable === 0 ? [] : [`${unreadable} unreadable lock file(s)`]),
    ...(errors === 0 ? [] : [`${errors} directory scan error(s)`])
  ];
  return {
    name: "lock-inventory",
    ok,
    detail: `${inventory.entries.length} lock file(s) found${
      problems.length === 0 ? "" : `; ${problems.join("; ")}`
    }; ${inventory.advisory}`
  };
}

function lockEntryDetail(entry: DoctorLockEntry): string {
  return `${entry.path}: age=${
    entry.ageMs === null ? "unknown" : `${Math.round(entry.ageMs)}ms`
  } source=${entry.ageSource ?? "unknown"} pid=${entry.pid ?? "not-recorded"} pid-liveness=${
    entry.pidLiveness
  } metadata=${entry.metadata}`;
}

function nodeCheck(engines: PackageEngines, actual: string): DoctorCheck {
  const minimum = minimumFromEngineRange(engines.enginesNode);
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

function buildDoctorJsonReport(
  version: string,
  checks: readonly DoctorCheck[],
  locks: DoctorLockInventory
): DoctorJsonReport {
  const ok = checks.every((check) => check.ok);
  return {
    version,
    preview: true,
    liveAdaptive: false,
    ok,
    checks,
    next: ok ? NEXT_STEPS : [FIX_FAILURES_NEXT, ...NEXT_STEPS],
    locks
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

export async function doctorCommand(
  args: string[],
  io: DoctorIo,
  options: DoctorOptions = {}
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "state-root": { type: "string" },
      project: { type: "string" },
      "agents-dir": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const engines = readPackageEngines();
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const locks = await lockInventory(stateRoot, options);
  const checks: DoctorCheck[] = [
    nodeCheck(engines, options.nodeVersion ?? process.versions.node),
    pnpmCheck(engines),
    await stateRootWritable(stateRoot),
    legacyLayoutCheck(stateRoot),
    await providersCheck(stateRoot),
    await projectCheck(values.project),
    piDispatchCheck(values.project, values["agents-dir"]),
    skillRouteLogCheck(values.project),
    unknownAgentDriftCheck(values.project),
    piPackagesCheck(),
    piCompatCheck(),
    lockInventoryCheck(locks)
  ];
  const failed = checks.some((check) => !check.ok);

  if (values.json === true) {
    io.stdout(`${JSON.stringify(buildDoctorJsonReport(engines.version, checks, locks))}\n`);
  } else {
    io.stdout(`pi-sparkle doctor ${engines.version} (developer preview — not a production capability)\n`);
    io.stdout("  live R1/bandit/topology: off until Checkpoint F-PROD closes\n");
    for (const check of checks) {
      io.stdout(`  ${check.ok ? "ok" : "FAIL"}  ${check.name}: ${check.detail}\n`);
    }
    for (const entry of locks.entries) {
      io.stdout(`    lock: ${lockEntryDetail(entry)}\n`);
    }
    for (const step of NEXT_STEPS) {
      io.stdout(`  next: ${step}\n`);
    }
  }

  if (failed) {
    // Even in JSON mode the failure report goes to stderr, so stdout stays a
    // single parseable object while the exit code still fails the caller.
    return cliFail(io, {
      command: "doctor",
      stage: "preflight",
      message: "one or more doctor checks failed",
      next:
        values.json === true
          ? FIX_FAILURES_NEXT
          : "fix the FAIL lines above, then re-run pi-sparkle doctor"
    });
  }
  return CLI_EXIT.ok;
}

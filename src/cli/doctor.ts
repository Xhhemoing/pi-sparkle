import { access, lstat, mkdir, readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
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
import { loadProvidersConfig, type CustomProviderConfig } from "../config/providers-config.js";
import { tryParseModelRef } from "../config/model-ref.js";
import { isRunId, type RunId } from "../domain/ids.js";
import {
  BanditStateUnreadableError,
  loadProjectBanditByKey,
  projectBanditPath
} from "../learning/bandit-store.js";
import { stableProjectKey } from "../learning/learned-routing.js";
import { readPinnedPiVersions } from "../pi-compat/check.js";
import {
  PreferenceSnapshotUnreadableError,
  readPreferenceSnapshot
} from "../preferences/store.js";
import { adaptationRoot, runtimeRoot, type Plane } from "../privacy/state-layout.js";
import {
  CatalogObservedCorruptError,
  catalogObservedPath,
  loadCatalogObservedSnapshot
} from "../routing/catalog-observed.js";
import { checkProviderAuth, type SparkleAuthCheck } from "../pi-adapter/auth-session.js";
import { EventStore } from "../run/event-store.js";
import { replayRun } from "../run/replay.js";
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
  /** Test seam; production resolves credentials the way a run would. */
  readonly authCheck?: DoctorAuthCheck;
  /**
   * Test seam for the storage walk. Directory reads that fail for anything but
   * ENOENT are the only way `storage.scanErrors` is populated, and no portable
   * fixture produces that failure on both POSIX and Windows, so the tests
   * inject it here instead of relying on mode bits.
   */
  readonly storageFs?: DoctorStorageFs;
}

/** The subset of `node:fs` Stats the storage walk reads; `Stats` satisfies it. */
export interface DoctorStorageStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
}

export interface DoctorStorageFs {
  readdir(dir: string): Promise<readonly string[]>;
  lstat(path: string): Promise<DoctorStorageStats>;
}

export type DoctorAuthCheck = (
  stateRoot: string,
  providerId: string,
  customProviders: readonly CustomProviderConfig[]
) => Promise<SparkleAuthCheck | undefined>;

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
  readonly runStates: DoctorRunStateInventory;
  readonly learnedState: DoctorLearnedStateInventory;
  readonly storage: DoctorStorageInventory;
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
  readonly remediation: string;
}

export interface DoctorLockInventory {
  readonly advisory: string;
  readonly entries: readonly DoctorLockEntry[];
  readonly scanErrors: readonly string[];
}

export type DoctorInFlightRunStatus = "PLANNING" | "RUNNING";

export interface DoctorRunStateEntry {
  readonly runId: RunId;
  readonly path: string;
  readonly status: DoctorInFlightRunStatus;
  readonly ageMs: number;
  readonly lastEventAt: string;
  readonly remediation: string;
}

export interface DoctorRunStateInventory {
  readonly advisory: string;
  readonly entries: readonly DoctorRunStateEntry[];
  readonly scanErrors: readonly string[];
}

export type DoctorLearnedStateKind = "bandit" | "preferences" | "catalog-observed";
export type DoctorLearnedStateClass = "learned" | "derived";
export type DoctorLearnedStateStatus = "present" | "absent" | "readable" | "damaged";

export interface DoctorLearnedStateEntry {
  readonly kind: DoctorLearnedStateKind;
  readonly stateClass: DoctorLearnedStateClass;
  readonly projectKey: string | null;
  readonly path: string;
  readonly status: DoctorLearnedStateStatus;
  readonly remediation: string;
}

export interface DoctorLearnedStateInventory {
  readonly advisory: string;
  readonly entries: readonly DoctorLearnedStateEntry[];
  readonly scanErrors: readonly string[];
}

export type DoctorStorageEntryKind = "file" | "directory" | "link" | "other";

export interface DoctorStorageEntry {
  readonly path: string;
  readonly plane: Plane;
  readonly kind: DoctorStorageEntryKind;
  /** Logical bytes of the regular files totalled here, not disk allocation. */
  readonly bytes: number;
  readonly files: number;
  /** Links found in this entry's subtree, counted rather than descended. */
  readonly links: number;
}

export interface DoctorStorageInventory {
  readonly advisory: string;
  readonly entries: readonly DoctorStorageEntry[];
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
const RUN_STATE_ADVISORY =
  "PLANNING/RUNNING logs are advisory crash candidates only: a live process may still own the run; inspect before resume or delete --run, and doctor never changes run state";
const LEARNED_STATE_ADVISORY =
  "Integrity is reported through the shipped state readers; damaged state is advisory, scan errors fail this check, and doctor never repairs, moves, deletes, or rebuilds files";
const LEARNED_STATE_REMEDIATION =
  "learned state: repair the file or move it aside and relearn from zero; doctor never changes it";
const PREFERENCE_STATE_REMEDIATION =
  "learned state: repair the file or move it aside and relearn preferences from an empty store; doctor never changes it";
const DERIVED_STATE_REMEDIATION =
  "derived state: delete the damaged file and rebuild it from runtime/invocations.jsonl; doctor never changes it";
const STORAGE_ADVISORY =
  "Retention is unbounded by accepted policy: doctor measures and never deletes, and delete --run and episode deletion are the reclaim verbs; sizes are logical bytes of regular files rather than disk allocation, links are counted but never descended, and the whole walk is a best-effort snapshot of a tree that can change while it is read";

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

function lockRemediation(
  path: string,
  ageMs: number | null,
  pid: number | null,
  pidLiveness: DoctorLockPidLiveness
): string {
  const age = ageMs === null ? "unknown age" : `age ${Math.round(ageMs)}ms`;
  if (pid !== null && pidLiveness === "not-running") {
    return `${age}; recorded PID ${pid} is not running: inspect and remove manually; never automatic (${path})`;
  }
  if (pid !== null && pidLiveness === "running") {
    return `${age}; recorded PID ${pid} appears to be running: do not remove based on age alone`;
  }
  if (pid !== null) {
    return `${age}; recorded PID ${pid} liveness is unknown: inspect ownership before any manual removal; never automatic`;
  }
  return `${age}; no valid PID is recorded: inspect metadata and ownership before any manual removal; never automatic`;
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
    const ageMs = mtimeMs === undefined ? null : Math.max(0, nowMs - mtimeMs);
    return {
      path,
      ageMs,
      ageSource: mtimeMs === undefined ? null : "mtime",
      acquiredAt: null,
      pid: null,
      pidLiveness: "not-recorded",
      metadata: "unreadable",
      remediation: lockRemediation(path, ageMs, null, "not-recorded")
    };
  }

  if (raw.trim() === "") {
    const ageMs = mtimeMs === undefined ? null : Math.max(0, nowMs - mtimeMs);
    return {
      path,
      ageMs,
      ageSource: mtimeMs === undefined ? null : "mtime",
      acquiredAt: null,
      pid: null,
      pidLiveness: "not-recorded",
      metadata: "empty",
      remediation: lockRemediation(path, ageMs, null, "not-recorded")
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
  const ageMs = sourceMs === undefined ? null : Math.max(0, nowMs - sourceMs);
  const recordedPidLiveness = pid === null ? "not-recorded" : pidLiveness(pid);

  return {
    path,
    ageMs,
    ageSource,
    acquiredAt,
    pid,
    pidLiveness: recordedPidLiveness,
    metadata,
    remediation: lockRemediation(path, ageMs, pid, recordedPidLiveness)
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

async function runStateInventory(
  stateRoot: string,
  options: DoctorOptions
): Promise<DoctorRunStateInventory> {
  const entries: DoctorRunStateEntry[] = [];
  const scanErrors: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const runsDir = join(runtimeRoot(stateRoot), "runs");
  let children;
  try {
    children = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      scanErrors.push(`${runsDir}: ${message}`);
    }
    return { advisory: RUN_STATE_ADVISORY, entries, scanErrors };
  }

  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    if (!child.isDirectory() || !isRunId(child.name)) continue;
    const runId = child.name;
    const path = join(runsDir, runId, "events.jsonl");
    try {
      const read = await new EventStore(stateRoot, runId).readAll();
      if (read.events.length === 0) continue;
      const status = replayRun(read.events).status;
      if (status !== "PLANNING" && status !== "RUNNING") continue;
      const lastEventAt = read.events[read.events.length - 1]?.occurredAt;
      if (lastEventAt === undefined) continue;
      entries.push({
        runId,
        path,
        status,
        ageMs: Math.max(0, nowMs - Date.parse(lastEventAt)),
        lastEventAt,
        remediation: `inspect with pi-sparkle inspect --run ${runId}; then resume --run ${runId} or delete --run ${runId}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scanErrors.push(`${path}: ${message}`);
    }
  }

  entries.sort((left, right) => left.runId.localeCompare(right.runId));
  return { advisory: RUN_STATE_ADVISORY, entries, scanErrors };
}

function learnedStateEntry(
  kind: DoctorLearnedStateKind,
  stateClass: DoctorLearnedStateClass,
  projectKey: string | null,
  path: string,
  status: DoctorLearnedStateStatus,
  remediation: string
): DoctorLearnedStateEntry {
  return { kind, stateClass, projectKey, path, status, remediation };
}

async function pathPresent(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function learnedStateInventory(
  stateRoot: string,
  projectRoot: string | undefined
): Promise<DoctorLearnedStateInventory> {
  const entries: DoctorLearnedStateEntry[] = [];
  const scanErrors: string[] = [];
  const projectsDir = join(adaptationRoot(stateRoot), "learning", "projects");
  const projectKeys = new Set<string>();
  if (projectRoot !== undefined) projectKeys.add(stableProjectKey(projectRoot));

  try {
    const children = await readdir(projectsDir, { withFileTypes: true });
    for (const child of children) {
      if (child.isDirectory() && /^p(?:0|[1-9a-f][0-9a-f]*)$/.test(child.name)) {
        projectKeys.add(child.name);
      }
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      scanErrors.push(`${projectsDir}: ${message}`);
    }
  }

  for (const projectKey of [...projectKeys].sort((left, right) => left.localeCompare(right))) {
    const path = projectBanditPath(stateRoot, projectKey);
    try {
      const bandit = await loadProjectBanditByKey(stateRoot, projectKey);
      entries.push(
        learnedStateEntry(
          "bandit",
          "learned",
          projectKey,
          path,
          bandit === undefined ? "absent" : "readable",
          LEARNED_STATE_REMEDIATION
        )
      );
    } catch (error) {
      if (error instanceof BanditStateUnreadableError) {
        entries.push(
          learnedStateEntry(
            "bandit",
            "learned",
            projectKey,
            path,
            "damaged",
            LEARNED_STATE_REMEDIATION
          )
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        scanErrors.push(`${path}: ${message}`);
        entries.push(
          learnedStateEntry(
            "bandit",
            "learned",
            projectKey,
            path,
            "present",
            LEARNED_STATE_REMEDIATION
          )
        );
      }
    }
  }

  const preferencesPath = join(adaptationRoot(stateRoot), "preferences.json");
  try {
    if (!(await pathPresent(preferencesPath))) {
      entries.push(
        learnedStateEntry(
          "preferences",
          "learned",
          null,
          preferencesPath,
          "absent",
          PREFERENCE_STATE_REMEDIATION
        )
      );
    } else {
      // The pure reader validates the snapshot without binding it, so inventorying
      // preferences cannot leave this process persisting to — or holding — an
      // operator's preference history.
      const snapshot = readPreferenceSnapshot(preferencesPath);
      entries.push(
        learnedStateEntry(
          "preferences",
          "learned",
          null,
          preferencesPath,
          snapshot === undefined ? "absent" : "readable",
          PREFERENCE_STATE_REMEDIATION
        )
      );
    }
  } catch (error) {
    if (error instanceof PreferenceSnapshotUnreadableError) {
      entries.push(
        learnedStateEntry(
          "preferences",
          "learned",
          null,
          preferencesPath,
          "damaged",
          PREFERENCE_STATE_REMEDIATION
        )
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      scanErrors.push(`${preferencesPath}: ${message}`);
      entries.push(
        learnedStateEntry(
          "preferences",
          "learned",
          null,
          preferencesPath,
          "present",
          PREFERENCE_STATE_REMEDIATION
        )
      );
    }
  }

  const observedPath = catalogObservedPath(stateRoot);
  try {
    if (!(await pathPresent(observedPath))) {
      entries.push(
        learnedStateEntry(
          "catalog-observed",
          "derived",
          null,
          observedPath,
          "absent",
          DERIVED_STATE_REMEDIATION
        )
      );
    } else {
      await loadCatalogObservedSnapshot(stateRoot);
      entries.push(
        learnedStateEntry(
          "catalog-observed",
          "derived",
          null,
          observedPath,
          "readable",
          DERIVED_STATE_REMEDIATION
        )
      );
    }
  } catch (error) {
    if (error instanceof CatalogObservedCorruptError) {
      entries.push(
        learnedStateEntry(
          "catalog-observed",
          "derived",
          null,
          observedPath,
          "damaged",
          DERIVED_STATE_REMEDIATION
        )
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      scanErrors.push(`${observedPath}: ${message}`);
      entries.push(
        learnedStateEntry(
          "catalog-observed",
          "derived",
          null,
          observedPath,
          "present",
          DERIVED_STATE_REMEDIATION
        )
      );
    }
  }

  return { advisory: LEARNED_STATE_ADVISORY, entries, scanErrors };
}

interface StorageTotals {
  bytes: number;
  files: number;
  links: number;
}

const REAL_STORAGE_FS: DoctorStorageFs = {
  readdir: (dir) => readdir(dir),
  lstat: (path) => lstat(path)
};

function scanError(scanErrors: string[], path: string, error: unknown): void {
  if (errorCode(error) === "ENOENT") return;
  scanErrors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
}

async function storageSubtreeTotals(
  dir: string,
  fs: DoctorStorageFs,
  scanErrors: string[]
): Promise<StorageTotals> {
  const totals: StorageTotals = { bytes: 0, files: 0, links: 0 };
  let names: readonly string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    scanError(scanErrors, dir, error);
    return totals;
  }
  for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
    const child = await storageNodeTotals(join(dir, name), fs, scanErrors);
    totals.bytes += child.totals.bytes;
    totals.files += child.totals.files;
    totals.links += child.totals.links;
  }
  return totals;
}

/**
 * `lstat` before recursion so a link is counted where it sits instead of being
 * descended into. That is best-effort, not an identity guarantee: a directory
 * can be replaced between this `lstat` and the `readdir` below it, and Node has
 * no portable fd-relative no-follow walk to close that window with.
 */
async function storageNodeTotals(
  path: string,
  fs: DoctorStorageFs,
  scanErrors: string[]
): Promise<{ kind: DoctorStorageEntryKind | null; totals: StorageTotals }> {
  let stats: DoctorStorageStats;
  try {
    stats = await fs.lstat(path);
  } catch (error) {
    scanError(scanErrors, path, error);
    return { kind: null, totals: { bytes: 0, files: 0, links: 0 } };
  }
  if (stats.isSymbolicLink()) {
    return { kind: "link", totals: { bytes: 0, files: 0, links: 1 } };
  }
  if (stats.isDirectory()) {
    return { kind: "directory", totals: await storageSubtreeTotals(path, fs, scanErrors) };
  }
  if (stats.isFile()) {
    return { kind: "file", totals: { bytes: stats.size, files: 1, links: 0 } };
  }
  return { kind: "other", totals: { bytes: 0, files: 0, links: 0 } };
}

/**
 * Growth, measured from the two authoritative plane roots rather than from a
 * hand-maintained list of record classes: every immediate entry under
 * `runtime/` and `adaptation/` is totalled recursively, so a file nobody
 * thought to enumerate here is still counted under the entry containing it.
 * Read-only — doctor measures and never deletes.
 */
async function storageInventory(
  stateRoot: string,
  options: DoctorOptions
): Promise<DoctorStorageInventory> {
  const fs = options.storageFs ?? REAL_STORAGE_FS;
  const entries: DoctorStorageEntry[] = [];
  const scanErrors: string[] = [];
  const planes: readonly (readonly [Plane, string])[] = [
    ["runtime", runtimeRoot(stateRoot)],
    ["adaptation", adaptationRoot(stateRoot)]
  ];

  for (const [plane, root] of planes) {
    let names: readonly string[];
    try {
      names = await fs.readdir(root);
    } catch (error) {
      scanError(scanErrors, root, error);
      continue;
    }
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      const path = join(root, name);
      const node = await storageNodeTotals(path, fs, scanErrors);
      if (node.kind === null) continue;
      entries.push({
        path,
        plane,
        kind: node.kind,
        bytes: node.totals.bytes,
        files: node.totals.files,
        links: node.totals.links
      });
    }
  }

  return { advisory: STORAGE_ADVISORY, entries, scanErrors };
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

function runStateInventoryCheck(inventory: DoctorRunStateInventory): DoctorCheck {
  const errors = inventory.scanErrors.length;
  return {
    name: "run-state-inventory",
    ok: errors === 0,
    detail: `${inventory.entries.length} PLANNING/RUNNING run log(s) found as advisory crash candidate(s)${
      errors === 0 ? "" : `; ${errors} log scan error(s)`
    }; ${inventory.advisory}`
  };
}

function learnedStateInventoryCheck(inventory: DoctorLearnedStateInventory): DoctorCheck {
  const errors = inventory.scanErrors.length;
  const count = (status: DoctorLearnedStateStatus): number =>
    inventory.entries.filter((entry) => entry.status === status).length;
  return {
    name: "learned-state-inventory",
    ok: errors === 0,
    detail: `${inventory.entries.length} state file(s) inventoried: ${count("readable")} readable, ${count("absent")} absent, ${count("damaged")} damaged, ${count("present")} present but unclassified${
      errors === 0 ? "" : `; ${errors} scan error(s)`
    }; ${inventory.advisory}`
  };
}

function storageInventoryCheck(inventory: DoctorStorageInventory): DoctorCheck {
  const errors = inventory.scanErrors.length;
  const planeTotal = (plane: Plane): string => {
    const planeEntries = inventory.entries.filter((entry) => entry.plane === plane);
    const bytes = planeEntries.reduce((sum, entry) => sum + entry.bytes, 0);
    const files = planeEntries.reduce((sum, entry) => sum + entry.files, 0);
    return `${plane}=${bytes} logical byte(s) in ${files} file(s)`;
  };
  const links = inventory.entries.reduce((sum, entry) => sum + entry.links, 0);
  return {
    name: "storage",
    ok: errors === 0,
    detail: `${planeTotal("runtime")}; ${planeTotal("adaptation")}; ${
      inventory.entries.length
    } top-level entr(y|ies), ${links} link(s) counted but not followed${
      errors === 0 ? "" : `; ${errors} scan error(s)`
    }; ${inventory.advisory}`
  };
}

function lockEntryDetail(entry: DoctorLockEntry): string {
  return `${entry.path}: age=${
    entry.ageMs === null ? "unknown" : `${Math.round(entry.ageMs)}ms`
  } source=${entry.ageSource ?? "unknown"} pid=${entry.pid ?? "not-recorded"} pid-liveness=${
    entry.pidLiveness
  } metadata=${entry.metadata}; remediation=${entry.remediation}`;
}

function runStateEntryDetail(entry: DoctorRunStateEntry): string {
  return `${entry.runId}: status=${entry.status} age=${Math.round(entry.ageMs)}ms path=${entry.path}; remediation=${entry.remediation}`;
}

function learnedStateEntryDetail(entry: DoctorLearnedStateEntry): string {
  const project = entry.projectKey === null ? "" : ` project-key=${entry.projectKey}`;
  return `${entry.kind}:${project} class=${entry.stateClass} status=${entry.status} path=${entry.path}; remediation=${entry.remediation}`;
}

function storageEntryDetail(entry: DoctorStorageEntry): string {
  return `${entry.path}: plane=${entry.plane} kind=${entry.kind} bytes=${entry.bytes} files=${entry.files} links=${entry.links}`;
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

/**
 * Whether the models this state root would actually route to can authenticate.
 *
 * Without it, a missing credential is discovered mid-run, as Pi's
 * `Provider is not configured` — after run state exists and after the operator
 * has waited. The question is asked of exactly the providers a run would use
 * (`primary`, `fast`, and everything enabled), and it is asked the way `auth
 * status` asks it: a stored credential first, ambient environment second.
 *
 * Nothing is reported but the provider id and the *source* of its credential
 * (an environment variable name, or "stored credential") — the same posture as
 * `auth status`, and never the value. `--json` consumers read this detail, so
 * a secret leaked here would be a secret written to whatever collects it.
 */
async function authCheck(stateRoot: string, options: DoctorOptions): Promise<DoctorCheck> {
  let config;
  try {
    config = await loadProvidersConfig(stateRoot);
  } catch {
    // The `providers` check already fails on this and names the reason; a
    // second failure for one cause would just be noise.
    return {
      name: "auth",
      ok: true,
      detail: "skipped: providers.json could not be read (see the providers check)"
    };
  }

  const providerIds = uniqueProviderIds([
    ...(config.primary !== undefined ? [config.primary] : []),
    ...(config.fast !== undefined ? [config.fast] : []),
    ...config.enabled
  ]);
  if (providerIds.length === 0) {
    return {
      name: "auth",
      ok: true,
      detail: "no models enabled — the fake executor needs no credentials"
    };
  }

  const check = options.authCheck ?? checkProviderAuth;
  const parts: string[] = [];
  const missing: string[] = [];
  for (const providerId of providerIds) {
    try {
      const resolved = await check(stateRoot, providerId, config.customProviders);
      if (resolved === undefined) {
        missing.push(providerId);
        parts.push(`${providerId}=no credential`);
      } else {
        parts.push(`${providerId}=${resolved.type} via ${resolved.source ?? "unnamed source"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      missing.push(providerId);
      parts.push(`${providerId}=unresolved (${message})`);
    }
  }

  const ok = missing.length === 0;
  return {
    name: "auth",
    ok,
    detail: ok
      ? parts.join("; ")
      : `${parts.join("; ")} — run pi-sparkle auth login <provider> or set the provider's environment variable; --executor pi fails mid-run without one`
  };
}

function uniqueProviderIds(catalogIds: readonly string[]): string[] {
  const ids: string[] = [];
  for (const catalogId of catalogIds) {
    const providerId = tryParseModelRef(catalogId)?.providerId;
    if (providerId === undefined || ids.includes(providerId)) continue;
    ids.push(providerId);
  }
  return ids;
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
  locks: DoctorLockInventory,
  runStates: DoctorRunStateInventory,
  learnedState: DoctorLearnedStateInventory,
  storage: DoctorStorageInventory
): DoctorJsonReport {
  const ok = checks.every((check) => check.ok);
  return {
    version,
    preview: true,
    liveAdaptive: false,
    ok,
    checks,
    next: ok ? NEXT_STEPS : [FIX_FAILURES_NEXT, ...NEXT_STEPS],
    locks,
    runStates,
    learnedState,
    storage
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
  const runStates = await runStateInventory(stateRoot, options);
  const learnedState = await learnedStateInventory(stateRoot, values.project);
  const storage = await storageInventory(stateRoot, options);
  const checks: DoctorCheck[] = [
    nodeCheck(engines, options.nodeVersion ?? process.versions.node),
    pnpmCheck(engines),
    await stateRootWritable(stateRoot),
    legacyLayoutCheck(stateRoot),
    await providersCheck(stateRoot),
    await authCheck(stateRoot, options),
    await projectCheck(values.project),
    piDispatchCheck(values.project, values["agents-dir"]),
    skillRouteLogCheck(values.project),
    unknownAgentDriftCheck(values.project),
    piPackagesCheck(),
    piCompatCheck(),
    lockInventoryCheck(locks),
    runStateInventoryCheck(runStates),
    learnedStateInventoryCheck(learnedState),
    storageInventoryCheck(storage)
  ];
  const failed = checks.some((check) => !check.ok);

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify(
        buildDoctorJsonReport(engines.version, checks, locks, runStates, learnedState, storage)
      )}\n`
    );
  } else {
    io.stdout(`pi-sparkle doctor ${engines.version} (developer preview — not a production capability)\n`);
    io.stdout("  live R1/bandit/topology: off until Checkpoint F-PROD closes\n");
    for (const check of checks) {
      io.stdout(`  ${check.ok ? "ok" : "FAIL"}  ${check.name}: ${check.detail}\n`);
    }
    for (const entry of locks.entries) {
      io.stdout(`    lock: ${lockEntryDetail(entry)}\n`);
    }
    for (const entry of runStates.entries) {
      io.stdout(`    run: ${runStateEntryDetail(entry)}\n`);
    }
    for (const entry of learnedState.entries) {
      io.stdout(`    state: ${learnedStateEntryDetail(entry)}\n`);
    }
    for (const entry of storage.entries) {
      io.stdout(`    storage: ${storageEntryDetail(entry)}\n`);
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

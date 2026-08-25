import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { readJsonlObjects } from "../persist/jsonl.js";
import { adaptationRoot, runtimeRoot, type Plane } from "../privacy/state-layout.js";
import { CLI_EXIT, cliFail } from "./errors.js";

/**
 * One-shot migration of the flat pre-2026-08-22 state root into the two plane
 * directories introduced by the P0 Q1 privacy remediation.
 *
 * Before the split, records lived directly under the state root
 * (`feedback/records.jsonl`, `runs/<id>/events.jsonl`, ...). Plane-aware code
 * reads only `runtime/` and `adaptation/`, so an upgraded install silently
 * sees an empty history — no error, no warning (2026-08-22 weak-area report
 * §2.2). This command makes that data visible again.
 *
 * Two rules hold throughout:
 *
 *  - Planes never mix. Each legacy source has exactly one destination plane,
 *    fixed in LEGACY_SOURCES below, and it is never inferred at runtime.
 *  - Sources are copied, never moved or deleted. An operator who is unhappy
 *    with the result still has the original tree.
 *
 * A third rule holds for --apply, and is what makes this tool survivable: no
 * destination ever exists holding a partial copy. See publishCopy.
 */

export interface MigrateLegacyIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

/** Seams that let the tests drive the publish protocol's failure paths portably. */
export interface MigrateLegacyOptions {
  /** Injection seam for the temp -> destination publish. Defaults to fs.link. */
  readonly link?: (existingPath: string, newPath: string) => Promise<void>;
  /** Injection seam for the temp-name suffix. Defaults to a random UUID. */
  readonly uniqueSuffix?: () => string;
}

/** Legacy entries at the state root, each pinned to the plane that owns it. */
const LEGACY_SOURCES: ReadonlyArray<{ readonly entry: string; readonly plane: Plane }> = [
  { entry: "feedback", plane: "adaptation" },
  { entry: "runs", plane: "runtime" },
  { entry: "episodes", plane: "runtime" },
  { entry: "invocations.jsonl", plane: "runtime" }
];

type ItemStatus = "copy" | "already-migrated" | "conflict";

interface MigrationItem {
  readonly plane: Plane;
  /** Path relative to the state root, POSIX-separated for stable output. */
  readonly relativePath: string;
  readonly source: string;
  readonly destination: string;
  readonly status: ItemStatus;
  /** Records counted when the file is JSONL, for the dry-run summary. */
  readonly records: number | undefined;
}

export interface MigrationPlan {
  readonly stateRoot: string;
  readonly items: readonly MigrationItem[];
  /** Truncated trailing JSONL lines found while validating, one note each. */
  readonly warnings: readonly string[];
}

const USAGE = `pi-sparkle migrate-legacy — move pre-2026-08-22 flat state into the plane layout

Usage:
  pi-sparkle migrate-legacy [--state-root <dir>] [--apply]

Without --apply this is a dry run: nothing is written. feedback/ goes to the
adaptation plane; runs/, episodes/, and invocations.jsonl go to the runtime
plane. Sources are copied, never deleted, and re-running is a no-op once the
destinations match. A JSONL file with a corrupt line is refused outright
rather than half-copied. An interrupted --apply never leaves a half-written
destination: each file is staged beside its destination as a *.tmp and
published in one step, so re-running finishes the job. A leftover *.tmp is
inert and safe to delete.

Exit codes: 0 when a dry run finds nothing to do or when --apply succeeds;
1 when a dry run finds pending work (so scripts can gate on it), when a
destination already exists with different content, or when apply fails.
`;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function planeRoot(stateRoot: string, plane: Plane): string {
  return plane === "runtime" ? runtimeRoot(stateRoot) : adaptationRoot(stateRoot);
}

export async function migrateLegacyCommand(
  args: string[],
  io: MigrateLegacyIo,
  options: MigrateLegacyOptions = {}
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "state-root": { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  });
  if (values.help === true) {
    io.stdout(USAGE);
    return CLI_EXIT.ok;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const apply = values.apply === true;

  let plan: MigrationPlan;
  try {
    plan = await planLegacyMigration(stateRoot);
  } catch (error) {
    return cliFail(io, {
      command: "migrate-legacy",
      stage: "scan",
      message: error instanceof Error ? error.message : String(error),
      next: "repair or remove the unreadable legacy file, then re-run migrate-legacy"
    });
  }

  for (const warning of plan.warnings) {
    io.stderr(`warning: ${warning}\n`);
  }

  const pending = plan.items.filter((item) => item.status === "copy");
  const conflicts = plan.items.filter((item) => item.status === "conflict");
  const migrated = plan.items.filter((item) => item.status === "already-migrated");

  io.stdout(`migrate-legacy: ${apply ? "apply" : "dry run (no files written)"}\n`);
  io.stdout(`  state root: ${stateRoot}\n`);

  if (plan.items.length === 0) {
    io.stdout("  no legacy files found\n");
    return CLI_EXIT.ok;
  }

  for (const item of migrated) {
    io.stdout(`  already migrated: ${item.relativePath}\n`);
  }
  for (const item of conflicts) {
    io.stdout(
      `  conflict: ${item.relativePath} -> ${describeDestination(stateRoot, item)} (destination differs; not overwritten)\n`
    );
  }

  if (!apply) {
    for (const item of pending) {
      io.stdout(
        `  would copy: ${item.relativePath} -> ${describeDestination(stateRoot, item)}${describeRecords(item)}\n`
      );
    }
    io.stdout(summaryLine(pending.length, migrated.length, conflicts.length));
    if (pending.length === 0 && conflicts.length === 0) {
      return CLI_EXIT.ok;
    }
    io.stdout(
      pending.length > 0
        ? "  re-run with --apply to copy the pending files\n"
        : "  resolve the conflicting destinations by hand; --apply never overwrites them\n"
    );
    return CLI_EXIT.error;
  }

  let copied = 0;
  const failures: string[] = [];
  for (const item of pending) {
    try {
      await publishCopy(item.source, item.destination, options);
      copied += 1;
      io.stdout(`  copied: ${item.relativePath} -> ${describeDestination(stateRoot, item)}\n`);
    } catch (error) {
      const raced = errorCode(error) === "EEXIST";
      // A destination that appeared mid-run is only benign when it matches.
      if (raced && (await sameContent(item.source, item.destination))) {
        io.stdout(`  already migrated: ${item.relativePath}\n`);
        continue;
      }
      failures.push(`${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const failure of failures) {
    io.stderr(`error: could not copy ${failure}\n`);
  }
  io.stdout(
    `summary: ${copied} copied, ${migrated.length} already migrated, ${conflicts.length} conflict(s), ${failures.length} failed\n`
  );
  if (conflicts.length > 0 || failures.length > 0) {
    return cliFail(io, {
      command: "migrate-legacy",
      stage: "apply",
      message: `migration incomplete: ${conflicts.length} conflict(s), ${failures.length} copy failure(s)`,
      next: "compare the reported destinations by hand; migrate-legacy never overwrites an existing plane file"
    });
  }
  return CLI_EXIT.ok;
}

/** `link` failures that mean the filesystem cannot hard-link, not that the destination exists. */
const LINK_UNSUPPORTED_CODES = new Set(["EPERM", "EOPNOTSUPP", "ENOTSUP", "ENOSYS"]);

const MAX_TEMP_NAME_ATTEMPTS = 3;

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function tempName(destination: string, uniqueSuffix: () => string): string {
  return `${destination}.${process.pid}.${uniqueSuffix()}.tmp`;
}

/**
 * Copy one legacy file so that the destination only ever exists holding the
 * source's whole content, and an existing destination is still never
 * overwritten.
 *
 * The bytes go to a uniquely named temp beside the destination first and are
 * fsynced there; `link` then publishes them under the real name in one step
 * and fails EEXIST rather than clobbering, so the never-overwrite contract is
 * enforced by the kernel at the instant of publish instead of by the earlier
 * stat in destinationStatus. The caller's EEXIST branch handles that failure
 * exactly as it handled the old copyFile(COPYFILE_EXCL) race: digest the two
 * files and call it already-migrated only when they match.
 *
 * The point of the temp is recovery. A crash anywhere before the link leaves
 * the destination absent and one `<destination>.<pid>.<uuid>.tmp` file next to
 * it — a name no reader in the tree looks for, and one the operator can delete
 * — so the re-run still plans the file as `copy` and completes. A plain
 * copyFile straight to the destination instead left a prefix of the source
 * under the real name, which every later run read as `conflict (destination
 * differs)`: a disaster-recovery tool that could not recover from its own
 * interrupted apply.
 */
async function publishCopy(
  source: string,
  destination: string,
  options: MigrateLegacyOptions
): Promise<void> {
  const linkFile = options.link ?? link;
  const uniqueSuffix = options.uniqueSuffix ?? randomUUID;
  await mkdir(dirname(destination), { recursive: true });

  const tempPath = await copyToUniqueTemp(source, destination, uniqueSuffix);
  try {
    await syncFile(tempPath);
    try {
      await linkFile(tempPath, destination);
    } catch (error) {
      if (!LINK_UNSUPPORTED_CODES.has(String(errorCode(error)))) throw error;
      // No hard links here (some mounts, some Windows filesystems). Fall back to
      // the exclusive copy: never-overwrite still holds, the crash window is back.
      await copyFile(tempPath, destination, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * COPYFILE_EXCL never truncates, so a temp left behind by a crashed apply is
 * refused rather than adopted; the retry then picks a fresh name. Exhaustion
 * throws without an EEXIST code, because to the caller EEXIST means one thing
 * only: the destination is already there.
 */
async function copyToUniqueTemp(
  source: string,
  destination: string,
  uniqueSuffix: () => string
): Promise<string> {
  for (let attempt = 0; attempt < MAX_TEMP_NAME_ATTEMPTS; attempt += 1) {
    const tempPath = tempName(destination, uniqueSuffix);
    try {
      await copyFile(source, tempPath, constants.COPYFILE_EXCL);
      return tempPath;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
  throw new Error(
    `no free temp name beside ${destination} after ${MAX_TEMP_NAME_ATTEMPTS} attempts`
  );
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Enumerate every legacy file and decide what would happen to it. Reading is
 * fail-closed: a JSONL file with a corrupt line anywhere but the last line
 * throws, so a partially-written history is never silently copied.
 */
export async function planLegacyMigration(stateRoot: string): Promise<MigrationPlan> {
  const items: MigrationItem[] = [];
  const warnings: string[] = [];
  for (const source of LEGACY_SOURCES) {
    const absolute = join(stateRoot, source.entry);
    for (const file of await listFiles(absolute)) {
      const relativePath = toPosix(relative(stateRoot, file));
      const destination = join(planeRoot(stateRoot, source.plane), relative(stateRoot, file));
      const records = await validateJsonl(file, relativePath, warnings);
      items.push({
        plane: source.plane,
        relativePath,
        source: file,
        destination,
        status: await destinationStatus(file, destination),
        records
      });
    }
  }
  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { stateRoot, items, warnings };
}

async function destinationStatus(source: string, destination: string): Promise<ItemStatus> {
  const existing = await stat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing === undefined) return "copy";
  return (await sameContent(source, destination)) ? "already-migrated" : "conflict";
}

async function sameContent(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  return a === b;
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * Count records in a JSONL file, reusing the shared reader so the corruption
 * contract matches the stores that will read the migrated copy. A truncated
 * final line is recoverable and only warned about; the copy is byte-for-byte,
 * so nothing is lost either way.
 */
async function validateJsonl(
  path: string,
  relativePath: string,
  warnings: string[]
): Promise<number | undefined> {
  if (!path.endsWith(".jsonl")) return undefined;
  const { values, recovery } = await readJsonlObjects(
    path,
    (lineNumber) => new Error(`corrupt legacy JSONL at ${relativePath} line ${lineNumber}`)
  );
  if (recovery.incompleteLine !== undefined) {
    const at = recovery.lineNumber !== undefined ? ` at line ${recovery.lineNumber}` : "";
    warnings.push(`${relativePath} has a truncated final line${at}; copied verbatim`);
  }
  return values.length;
}

async function listFiles(path: string): Promise<string[]> {
  const entry = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (entry === undefined) return [];
  if (entry.isFile()) return [path];
  if (!entry.isDirectory()) return [];
  const found: string[] = [];
  for (const child of await readdir(path, { withFileTypes: true })) {
    found.push(...(await listFiles(join(path, child.name))));
  }
  return found;
}

function describeDestination(stateRoot: string, item: MigrationItem): string {
  return toPosix(relative(stateRoot, item.destination));
}

function describeRecords(item: MigrationItem): string {
  return item.records === undefined ? "" : ` (${item.records} record(s))`;
}

function summaryLine(pending: number, migrated: number, conflicts: number): string {
  return `summary: ${pending} to copy, ${migrated} already migrated, ${conflicts} conflict(s)\n`;
}

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

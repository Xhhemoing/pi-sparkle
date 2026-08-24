import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
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
 */

export interface MigrateLegacyIo {
  stdout(text: string): void;
  stderr(text: string): void;
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
rather than half-copied.

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

export async function migrateLegacyCommand(args: string[], io: MigrateLegacyIo): Promise<number> {
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
      await mkdir(dirname(item.destination), { recursive: true });
      await copyFile(item.source, item.destination, constants.COPYFILE_EXCL);
      copied += 1;
      io.stdout(`  copied: ${item.relativePath} -> ${describeDestination(stateRoot, item)}\n`);
    } catch (error) {
      const raced = (error as NodeJS.ErrnoException).code === "EEXIST";
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

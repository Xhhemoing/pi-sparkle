import fs, { type BigIntStats } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { SnapshotManifest } from "./worktree-snapshot.js";

/** Opaque in-process handle: bytes are never exposed or serialized. */
export interface ExactSnapshot {
  readonly fileCount: number;
  readonly byteLength: number;
}

export interface ExactSnapshotLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

interface Entry {
  readonly relativePath: string;
  readonly mode: bigint;
  readonly bytes?: Buffer;
}

interface SnapshotData {
  readonly root: string;
  readonly scope: string;
  readonly entries: readonly Entry[];
}

const snapshots = new WeakMap<ExactSnapshot, SnapshotData>();

function fail(reason: string): never {
  throw new DomainValidationError(`exact snapshot: ${reason}`);
}

function prefixes(value: readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) fail("manifest prefixes must be a bounded array");
  return [...new Set(value.map((input) => {
    if (typeof input !== "string" || input.length > 4096 || input.includes("\0")) {
      fail("invalid manifest prefix path");
    }
    const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)
      || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
      fail("manifest prefix must be a contained relative path");
    }
    return normalized;
  }))].sort();
}

function under(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function unchanged(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
    && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs
    && before.nlink === after.nlink;
}

function assertUnchanged(absolute: string, before: BigIntStats): void {
  if (!unchanged(before, fs.lstatSync(absolute, { bigint: true }))) fail("filesystem path identity changed during capture");
}

function readExactFile(absolute: string, before: BigIntStats, remainingBytes: number): Buffer {
  if (!before.isFile() || before.nlink !== 1n) fail("included path must be a nonlinked regular file");
  if (before.size > BigInt(remainingBytes)) fail("byte limit exceeded");
  // O_NONBLOCK prevents a swapped FIFO from blocking before fstat can refuse it.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(absolute, flags);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !unchanged(before, opened)) fail("file identity changed before read");
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail("file changed or truncated during read");
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(fd, extra, 0, 1, offset) !== 0) fail("file changed or grew during read");
    if (!unchanged(opened, fs.fstatSync(fd, { bigint: true }))) fail("file changed during read");
    assertUnchanged(absolute, before);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Capture a bounded filesystem scope, including ignored files. Direct byte
 * equality is cooperative pre/post evidence, not an atomic filesystem snapshot
 * or a defense against an unobserved transient swap-and-restore. Explicit
 * exclusions define the scope; allowedOutputDirs is refused in exact mode.
 */
export function captureExactSnapshot(
  root: string,
  manifest: SnapshotManifest = {},
  limits: ExactSnapshotLimits = { maxFiles: 256, maxBytes: 4 * 1024 * 1024 }
): ExactSnapshot {
  if (!limits || !Number.isSafeInteger(limits.maxFiles) || limits.maxFiles < 1
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
    fail("maxFiles and maxBytes limits must be positive safe integers");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("invalid snapshot manifest");
  const includes = prefixes(manifest.includePrefixes);
  const excludes = [...new Set([".git", ...prefixes(manifest.excludePrefixes)])].sort();
  if (prefixes(manifest.allowedOutputDirs).length > 0) fail("allowedOutputDirs is unsupported for exact snapshots");
  for (const include of includes) {
    if (excludes.some((exclude) => under(include, exclude))) fail("required include prefix is excluded");
  }
  if (typeof root !== "string" || !root || root.includes("\0")) fail("invalid root path");
  const requestedRoot = path.resolve(root);
  try {
    const rootStat = fs.lstatSync(requestedRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("root must be a nonlinked directory");
    const canonicalRoot = fs.realpathSync(requestedRoot);
    assertUnchanged(canonicalRoot, rootStat);
    const scope = JSON.stringify([includes, excludes]);
    const entries: Entry[] = [{ relativePath: "", mode: rootStat.mode }];
    const observations = new Map<string, BigIntStats>([[canonicalRoot, rootStat]]);
    const pending = [{ relativePath: "", absolute: canonicalRoot, stat: rootStat }];
    const found = new Set<string>();
    // Stream directories instead of allocating an unbounded readdir result.
    // Count every observed child, including out-of-scope siblings, but never
    // descend into an excluded subtree. A separate depth bound avoids huge
    // ancestor chains; the file limit itself counts regular files only.
    const traversalLimit = Math.min(1_000_000, Math.max(1024, limits.maxFiles * 16));
    let visited = 0;
    let fileCount = 0;
    let byteLength = 0;
    while (pending.length > 0) {
      const directory = pending.pop()!;
      assertUnchanged(directory.absolute, directory.stat);
      const handle = fs.opendirSync(directory.absolute, { bufferSize: 32 });
      try {
        for (let item = handle.readSync(); item !== null; item = handle.readSync()) {
          visited += 1;
          if (visited > traversalLimit) fail("directory traversal entry limit exceeded");
          // Refuse ambiguous decoded/nonportable names instead of allowing
          // different filesystem paths to collapse onto one scope identity.
          if (item.name.includes("\ufffd") || item.name.includes("\\")) fail("unsupported filesystem path encoding");
          const relativePath = directory.relativePath ? `${directory.relativePath}/${item.name}` : item.name;
          if (excludes.some((exclude) => under(relativePath, exclude))) continue;
          const included = includes.length === 0 || includes.some((include) => under(relativePath, include));
          const requiredParent = includes.some((include) => under(include, relativePath));
          if (!included && !requiredParent) continue;
          if (relativePath.split("/").length > 128) fail("directory traversal depth limit exceeded");
          const absolute = path.join(canonicalRoot, relativePath);
          const stat = fs.lstatSync(absolute, { bigint: true });
          if (stat.isSymbolicLink()) fail("included path or parent is a symbolic link");
          if (includes.includes(relativePath)) found.add(relativePath);
          observations.set(absolute, stat);
          if (stat.isDirectory()) {
            entries.push({ relativePath, mode: stat.mode });
            pending.push({ relativePath, absolute, stat });
          } else {
            if (!included || !stat.isFile() || stat.nlink !== 1n) fail("included path must be a nonlinked regular file or directory");
            fileCount += 1;
            if (fileCount > limits.maxFiles) fail("file count limit exceeded");
            const bytes = readExactFile(absolute, stat, limits.maxBytes - byteLength);
            byteLength += bytes.length;
            entries.push({ relativePath, mode: stat.mode, bytes });
          }
        }
      } finally {
        handle.closeSync();
      }
      assertUnchanged(directory.absolute, directory.stat);
    }
    if (includes.some((include) => !found.has(include))) fail("required include prefix is missing");
    // Validate all earlier observations again so a later read cannot silently
    // replace an already captured file, ancestor directory, or the root.
    for (const [absolute, stat] of observations) assertUnchanged(absolute, stat);
    assertUnchanged(requestedRoot, rootStat);
    if (fs.realpathSync(requestedRoot) !== canonicalRoot) fail("root identity changed during capture");
    entries.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    const snapshot = Object.freeze({ fileCount, byteLength });
    snapshots.set(snapshot, { root: canonicalRoot, scope, entries });
    return snapshot;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    fail("filesystem capture failed or path changed during capture");
  }
}

/** Only genuine in-process handles can participate in exact equality. */
export function sameExactSnapshot(a: ExactSnapshot, b: ExactSnapshot): boolean {
  const left = snapshots.get(a);
  const right = snapshots.get(b);
  if (!left || !right || left.root !== right.root || left.scope !== right.scope
    || left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index]!;
    return entry.relativePath === other.relativePath && entry.mode === other.mode
      && (entry.bytes === undefined ? other.bytes === undefined
        : other.bytes !== undefined && entry.bytes.equals(other.bytes));
  });
}

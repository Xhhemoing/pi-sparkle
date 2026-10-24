import fs, { type BigIntStats } from "node:fs";
import { spawnSync } from "node:child_process";
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
  readonly limits: ExactSnapshotLimits;
}

const snapshots = new WeakMap<ExactSnapshot, SnapshotData>();

const WHOLE_SCOPE = JSON.stringify([[], [".git"]]);
const TREE_ID = /^[0-9a-f]{40}$/;
const SAFE_GIT_FILE_MODES = new Set([0o100644, 0o100755]);

interface GitTreeEntry {
  readonly relativePath: string;
  readonly mode: number;
  readonly type: "blob" | "tree" | "commit";
  readonly object: string;
}

function fail(reason: string): never {
  throw new DomainValidationError(`exact snapshot: ${reason}`);
}

function requireSnapshot(snapshot: ExactSnapshot): SnapshotData {
  const data = snapshots.get(snapshot);
  if (!data) fail("a genuine in-process snapshot handle is required");
  if (data.scope !== WHOLE_SCOPE) fail("only a whole-worktree snapshot can bind a Git tree");
  return data;
}

function repositoryRoot(repository: string, expectedRoot?: string): string {
  if (typeof repository !== "string" || !repository || repository.includes("\0")) {
    fail("invalid repository path");
  }
  const requested = path.resolve(repository);
  let stat: BigIntStats;
  let canonical: string;
  try {
    stat = fs.lstatSync(requested, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("repository must be a nonlinked directory");
    canonical = fs.realpathSync(requested);
    assertUnchanged(canonical, stat);
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    fail("repository path is unavailable");
  }
  if (expectedRoot !== undefined && canonical !== expectedRoot) {
    fail("repository does not match the snapshot root");
  }
  // `--show-toplevel` may use an MSYS path form on Windows (for example
  // `/d/...`) that Node cannot resolve as a native path. Git's own relative
  // root query is representation-independent and is empty only at the root.
  const parentPrefix = runGit(canonical, ["rev-parse", "--show-cdup"], 4096).toString("utf8");
  if (parentPrefix.trim() !== "") fail("repository must be the Git worktree root");
  return canonical;
}

function runGit(repository: string, args: readonly string[], maxBuffer: number, input?: Buffer, allowNoMatch = false): Buffer {
  const result = spawnSync("git", ["--no-replace-objects", "-C", repository, ...args], {
    input,
    encoding: "buffer",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" }
  });
  if (!result.error && allowNoMatch && result.status === 1 && Buffer.isBuffer(result.stdout)) return result.stdout;
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    const detail = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS"
      ? "Git output bound exceeded"
      : result.error?.message ?? (Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : "unknown Git error");
    fail(`Git command failed: ${detail.slice(0, 240)}`);
  }
  return result.stdout;
}

function strictUtf8(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0 || text.includes("\ufffd")) {
    fail("Git tree contains an invalid UTF-8 path");
  }
  return text;
}

function validateGitPath(relativePath: string): void {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.includes("\0")
    || relativePath === ".git" || relativePath.startsWith(".git/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("Git tree contains an unsafe or unsupported path");
  }
}

function validateTreeId(treeId: string): void {
  if (typeof treeId !== "string" || !TREE_ID.test(treeId)) {
    fail("tree object address must be a complete 40-character Git object id");
  }
}

function treeEntries(data: SnapshotData, repository: string, treeId: string): GitTreeEntry[] {
  validateTreeId(treeId);
  const maxFiles = data.limits.maxFiles;
  // ls-tree output is deliberately capped before parsing. A normal path is
  // much shorter than 4 KiB; this bound scales with the immutable capture
  // limit and prevents an adversarial tree from allocating unbounded output.
  const maxBuffer = Math.min(16 * 1024 * 1024, Math.max(4096, (Math.min(maxFiles, 4096) + 1) * 4096));
  const type = runGit(repository, ["cat-file", "-t", treeId], 128).toString("utf8").trim();
  if (type !== "tree") fail("tree object address does not name a tree object");
  const output = runGit(repository, ["ls-tree", "-rz", "-t", "--full-tree", treeId], maxBuffer);
  const entries: GitTreeEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0) fail("Git tree output is missing a NUL terminator");
    const record = output.subarray(offset, end);
    offset = end + 1;
    const tab = record.indexOf(9);
    if (tab <= 0) fail("Git tree record is malformed");
    const header = record.subarray(0, tab).toString("ascii").split(" ");
    if (header.length !== 3 || !/^[0-7]{6}$/.test(header[0]!) || !TREE_ID.test(header[2]!)) {
      fail("Git tree record has an invalid mode or object address");
    }
    const relativePath = strictUtf8(record.subarray(tab + 1));
    validateGitPath(relativePath);
    if (seenPaths.has(relativePath)) fail("Git tree contains a duplicate path");
    seenPaths.add(relativePath);
    const mode = Number.parseInt(header[0]!, 8);
    const typeName = header[1];
    if (typeName !== "blob" && typeName !== "tree" && typeName !== "commit") {
      fail("Git tree contains an unsupported object type");
    }
    if (typeName === "tree" && mode !== 0o40000) fail("Git tree directory mode is invalid");
    if (typeName === "blob" && !SAFE_GIT_FILE_MODES.has(mode) && mode !== 0o120000) {
      fail("Git tree contains an unsupported file mode");
    }
    if (typeName === "commit" && mode !== 0o160000) fail("Git submodule mode is invalid");
    entries.push({ relativePath, mode, type: typeName, object: header[2]! });
    const fileCount = entries.reduce((count, entry) => count + (entry.type === "blob" ? 1 : 0), 0);
    if (fileCount > maxFiles) fail("Git tree file limit exceeded");
    if (entries.length > maxFiles * 129 + 1) fail("Git tree entry limit exceeded");
  }
  return entries;
}

const GIT_BATCH_SIZE = 64;
interface GitObjectHeader { readonly object: string; readonly type: string; readonly size: number }

function objectHeader(header: string, expectedObject: string): GitObjectHeader {
  const fields = /^([0-9a-f]{40}) (blob|tree|commit|tag) (0|[1-9][0-9]*)$/.exec(header);
  if (fields === null || fields[1] !== expectedObject) fail("Git batch object header or identity is invalid");
  const size = Number(fields[3]);
  if (!Number.isSafeInteger(size)) fail("Git batch object size is invalid");
  return { object: fields[1]!, type: fields[2]!, size };
}

function objectInput(objects: readonly string[]): Buffer {
  if (objects.length === 0 || objects.length > GIT_BATCH_SIZE || objects.some((object) => !TREE_ID.test(object))) {
    fail("Git batch requires bounded complete object addresses");
  }
  return Buffer.from(`${objects.join("\n")}\n`, "ascii");
}

function objectHeaders(repository: string, objects: readonly string[]): GitObjectHeader[] {
  const output = runGit(repository, ["cat-file", "--batch-check"], objects.length * 128, objectInput(objects));
  const lines = output.toString("utf8").split("\n");
  if (lines.pop() !== "" || lines.length !== objects.length) fail("Git batch object header count or terminator is invalid");
  return lines.map((line, index) => objectHeader(line, objects[index]!));
}

function readBlobBatch(repository: string, objects: readonly string[], maxBytes: number): Buffer[] {
  const headers = objectHeaders(repository, objects);
  let byteLength = 0;
  for (const header of headers) {
    if (header.type !== "blob") fail("Git tree file object is not a blob");
    if (header.size > maxBytes - byteLength) fail("Git blob exceeds the captured byte limit");
    byteLength += header.size;
  }
  const output = runGit(repository, ["cat-file", "--batch"], byteLength + objects.length * 129, objectInput(objects));
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const expected of headers) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < offset || headerEnd - offset >= 128) fail("Git batch blob header is missing or oversized");
    const actual = objectHeader(output.subarray(offset, headerEnd).toString("utf8"), expected.object);
    if (actual.type !== "blob" || actual.size !== expected.size) fail("Git batch blob type or size changed");
    const start = headerEnd + 1;
    const end = start + actual.size;
    if (end >= output.length || output[end] !== 10) fail("Git batch blob content or terminator is incomplete");
    blobs.push(output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length) fail("Git batch blob output has unexpected trailing bytes");
  return blobs;
}

function expectedMaps(data: SnapshotData): { files: Map<string, Entry>; dirs: Set<string> } {
  const files = new Map<string, Entry>();
  const dirs = new Set<string>();
  for (const entry of data.entries) {
    if (!entry.relativePath) continue;
    if (entry.bytes === undefined) dirs.add(entry.relativePath);
    else files.set(entry.relativePath, entry);
  }
  return { files, dirs };
}

function assertTreeObjects(repository: string, entries: readonly GitTreeEntry[]): void {
  for (let offset = 0; offset < entries.length; offset += GIT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + GIT_BATCH_SIZE);
    const headers = objectHeaders(repository, batch.map((entry) => entry.object));
    if (batch.some((entry, index) => headers[index]!.type !== entry.type)) fail("Git tree entry points to an object of the wrong type");
  }
}

function compareTree(data: SnapshotData, repository: string, treeId: string): GitTreeEntry[] {
  const entries = treeEntries(data, repository, treeId);
  const expected = expectedMaps(data);
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.type === "tree") {
      seenDirs.add(entry.relativePath);
      continue;
    }
    if (entry.type !== "blob") fail("Git tree contains a symlink or submodule instead of a regular file");
    const expectedFile = expected.files.get(entry.relativePath);
    if (!expectedFile) fail(`Git tree path does not match captured files: ${entry.relativePath}`);
    const executable = (expectedFile.mode & 0o100n) !== 0n;
    if ((executable && entry.mode !== 0o100755) || (!executable && entry.mode !== 0o100644)) {
      fail(`Git tree executable mode does not match captured file: ${entry.relativePath}`);
    }
    seenFiles.add(entry.relativePath);
  }
  if (seenFiles.size !== expected.files.size || [...expected.files.keys()].some((key) => !seenFiles.has(key))) {
    fail("Git tree file paths do not match the complete captured snapshot");
  }
  if (seenDirs.size !== expected.dirs.size || [...expected.dirs].some((key) => !seenDirs.has(key))) {
    fail("Git tree directory paths do not match the complete captured snapshot");
  }
  const files = entries.filter((entry) => entry.type === "blob");
  for (let offset = 0; offset < files.length; offset += GIT_BATCH_SIZE) {
    const batch = files.slice(offset, offset + GIT_BATCH_SIZE);
    const blobs = readBlobBatch(repository, batch.map((entry) => entry.object), data.limits.maxBytes - totalBytes);
    for (let index = 0; index < batch.length; index++) {
      const entry = batch[index]!;
      const bytes = blobs[index]!;
      totalBytes += bytes.length;
      if (!bytes.equals(expected.files.get(entry.relativePath)!.bytes!)) fail(`Git tree byte content does not match captured file: ${entry.relativePath}`);
    }
  }
  if (totalBytes !== data.entries.reduce((sum, entry) => sum + (entry.bytes?.length ?? 0), 0)) {
    fail("Git tree byte total does not match the captured snapshot");
  }
  return entries;
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
  const optionalIncludes = prefixes(manifest.optionalIncludePrefixes);
  const selected = [...new Set([...includes, ...optionalIncludes])].sort();
  if (selected.length > 256) fail("combined manifest include prefixes exceed the bounded limit");
  const excludes = [...new Set([".git", ...prefixes(manifest.excludePrefixes)])].sort();
  if (prefixes(manifest.allowedOutputDirs).length > 0) fail("allowedOutputDirs is unsupported for exact snapshots");
  for (const include of selected) {
    if (excludes.some((exclude) => under(include, exclude))) fail("required include prefix is excluded");
  }
  if (typeof root !== "string" || !root || root.includes("\0")) fail("invalid root path");
  const requestedRoot = path.resolve(root);
  try {
    const rootStat = fs.lstatSync(requestedRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("root must be a nonlinked directory");
    const canonicalRoot = fs.realpathSync(requestedRoot);
    assertUnchanged(canonicalRoot, rootStat);
    const scope = JSON.stringify(optionalIncludes.length === 0 ? [includes, excludes] : [includes, excludes, optionalIncludes]);
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
          const included = selected.length === 0 || selected.some((include) => under(relativePath, include));
          const requiredParent = selected.some((include) => under(include, relativePath));
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
    snapshots.set(snapshot, {
      root: canonicalRoot,
      scope,
      entries,
      limits: Object.freeze({ maxFiles: limits.maxFiles, maxBytes: limits.maxBytes })
    });
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
  return !!left && !!right && left.root === right.root && sameExactSnapshotContents(a, b);
}

/** Compare selected bytes/modes across roots; does not establish worktree identity. */
export function sameExactSnapshotContents(a: ExactSnapshot, b: ExactSnapshot): boolean {
  const left = snapshots.get(a);
  const right = snapshots.get(b);
  if (!left || !right || left.scope !== right.scope || left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index]!;
    return entry.relativePath === other.relativePath && entry.mode === other.mode
      && (entry.bytes === undefined ? other.bytes === undefined
        : other.bytes !== undefined && entry.bytes.equals(other.bytes));
  });
}

export function assertExactSnapshotMatchesGitTree(snapshot: ExactSnapshot, repository: string, treeId: string): void {
  const data = requireSnapshot(snapshot);
  const root = repositoryRoot(repository, data.root);
  compareTree(data, root, treeId);
  // The worktree can be changed between capture and verification. The tree
  // comparison is intentionally against the immutable captured bytes; callers
  // that need a second live check must capture another genuine handle.
}

export function assertGitAttributesPreserveExactBytes(
  snapshot: ExactSnapshot,
  repository: string,
  trees: { readonly beforeTree: string; readonly afterTree: string }
): void {
  const data = requireSnapshot(snapshot);
  const root = repositoryRoot(repository, data.root);
  if (!trees || typeof trees !== "object" || Array.isArray(trees)) fail("invalid Git tree pair");
  validateTreeId(trees.beforeTree);
  validateTreeId(trees.afterTree);
  const before = treeEntries(data, root, trees.beforeTree);
  const after = treeEntries(data, root, trees.afterTree);
  assertTreeObjects(root, [...before, ...after]);
  const paths = new Set<string>(data.entries.filter((entry) => entry.relativePath).map((entry) => entry.relativePath));
  for (const entry of [...before, ...after]) paths.add(entry.relativePath);
  const orderedPaths = [...paths].sort();

  const inspect = (args: string[], view: string): void => {
    for (let offset = 0; offset < orderedPaths.length; offset += GIT_BATCH_SIZE) {
      const batch = orderedPaths.slice(offset, offset + GIT_BATCH_SIZE);
      const requested = new Set(batch);
      const input = Buffer.from(`${batch.join("\0")}\0`, "utf8");
      const output = runGit(root, ["check-attr", "-z", "--all", ...args, "--stdin"], batch.length * 16 * 1024, input);
      if (output.length === 0) continue;
      const text = output.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(output)) fail(`Git attribute output is invalid UTF-8 for ${view}`);
      const fields = text.split("\0");
      if (fields.pop() !== "" || fields.length % 3 !== 0) fail(`Git attribute output is malformed for ${view}`);
      const pathBytes = new Map<string, number>();
      for (let index = 0; index < fields.length; index += 3) {
        const relativePath = fields[index]!;
        const name = fields[index + 1];
        const value = fields[index + 2];
        if (!requested.has(relativePath) || name === "") fail(`Git attribute output contains an unexpected path or name for ${view}`);
        const bytes = (pathBytes.get(relativePath) ?? 0) + Buffer.byteLength(relativePath) + Buffer.byteLength(name!) + Buffer.byteLength(value!) + 3;
        if (bytes > 16 * 1024) fail(`Git attribute per-path output bound exceeded for ${view}`);
        pathBytes.set(relativePath, bytes);
        if (name === "filter" && value !== "unset") fail(`active Git filter attribute in ${view}`);
        if (name === "text" && value !== "unset") fail(`active Git text conversion attribute in ${view}`);
        if (name === "eol" && value !== "unset") fail(`active Git line-ending attribute in ${view}`);
        if (name === "ident" && value !== "unset") fail(`active Git ident attribute in ${view}`);
        if (name === "crlf" && value !== "unset") fail(`active Git CRLF attribute in ${view}`);
        // Even an explicit disabling assignment is rejected. Git versions and
        // attribute macros have differed in how this value is interpreted, so
        // accepting it could silently re-enable a worktree encoding conversion.
        if (name === "working-tree-encoding") fail(`Git attribute working-tree-encoding is unsupported in ${view}`);
      }
    }
  };

  // `filter=unset` and `filter=unspecified` are valid literal driver names;
  // Git prints the same values it uses for an unset attribute. Refuse these
  // sentinel drivers by inspecting configuration metadata, without invoking
  // any clean/process command.
  const sentinelConfig = runGit(root, [
    "config", "--includes", "--name-only", "--get-regexp",
    "^filter\\.(unset|unspecified)\\.(clean|smudge|process|required)$"
  ], 16 * 1024, undefined, true).toString("utf8").trim();
  if (sentinelConfig) fail("Git attribute filter transform is configured");

  inspect([], "worktree");
  inspect(["--cached"], "index");
  inspect([`--source=${trees.beforeTree}`], "before tree");
  inspect([`--source=${trees.afterTree}`], "after tree");
}

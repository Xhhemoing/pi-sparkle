import { constants } from "node:fs";
import { isUtf8 } from "node:buffer";
import { lstat, open, opendir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { isPathInside, resolveInsideRoot } from "./paths.js";

export interface WorkspaceFilesContext {
  readonly worktreeRoot: string;
  /** May lower the 1 MiB hard per-file/output read bound. */
  readonly maxReadBytes?: number;
  readonly signal?: AbortSignal;
}

const MAX_READ_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_RESULTS = 1000;
const DEFAULT_RESULTS = 200;
const MAX_DEPTH = 64;
const MAX_PATH_BYTES = 4096;
const MAX_MATCH_BYTES = 4096;
const CHUNK_BYTES = 64 * 1024;
const EXCLUDED = new Set([".git", "node_modules", ".agent_workspace"]);

function checkCancelled(ctx: WorkspaceFilesContext): void {
  if (ctx.signal?.aborted) throw new DomainValidationError("workspace operation cancelled");
}

function integer(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new DomainValidationError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function readLimit(ctx: WorkspaceFilesContext): number {
  return integer(ctx.maxReadBytes === undefined ? MAX_READ_BYTES : ctx.maxReadBytes, "maxReadBytes", MAX_READ_BYTES);
}

function assertPath(value: string): void {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new DomainValidationError("path must be a non-empty string without NUL");
  }
}

function relativePath(root: string, file: string): string {
  return path.relative(root, file).replaceAll("\\", "/");
}

function checkExcluded(root: string, file: string): void {
  if (path.relative(root, file).split(path.sep).some((component) => EXCLUDED.has(component))) {
    throw new DomainValidationError("path is excluded from workspace file tools");
  }
}

async function scope(ctx: WorkspaceFilesContext, input: string, discovery = false): Promise<{ root: string; absolute: string; canonical: string }> {
  checkCancelled(ctx);
  readLimit(ctx);
  assertPath(input);
  const requestedRoot = resolveInsideRoot(ctx.worktreeRoot, ".");
  const requestedAbsolute = path.resolve(requestedRoot, input);
  if (!isPathInside(requestedAbsolute, requestedRoot)) {
    throw new DomainValidationError(`path escape refused: ${input} is outside worktree root ${requestedRoot}`);
  }
  if (discovery) checkExcluded(requestedRoot, requestedAbsolute);
  const root = await realpath(requestedRoot);
  checkCancelled(ctx);
  // Canonicalize only the root prefix before inspecting child links. Native
  // aliases (for example Windows short names) must not make an in-root path
  // appear outside its canonical root. Keep the child spelling so discovery
  // still sees, and skips, an explicitly requested directory link.
  const absolute = resolveInsideRoot(root, path.relative(requestedRoot, requestedAbsolute));
  const canonical = await realpath(absolute);
  checkCancelled(ctx);
  resolveInsideRoot(root, canonical);
  if (discovery) checkExcluded(root, canonical);
  return { root, absolute, canonical };
}

async function openRegular(ctx: WorkspaceFilesContext, root: string, absolute: string): Promise<FileHandle> {
  checkCancelled(ctx);
  const canonical = await realpath(resolveInsideRoot(root, absolute));
  checkCancelled(ctx);
  resolveInsideRoot(root, canonical);
  const metadata = await lstat(canonical);
  checkCancelled(ctx);
  if (!metadata.isFile()) throw new DomainValidationError("path must be a regular file");
  // O_NOFOLLOW closes the final-component link race where supported. Existing
  // resolveInsideRoot checks also protect link/junction ancestors; as with that
  // helper this is best-effort path containment, not an OS sandbox.
  const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    checkCancelled(ctx);
    const opened = await handle.stat();
    checkCancelled(ctx);
    if (!opened.isFile()) throw new DomainValidationError("path must be a regular file");
    resolveInsideRoot(root, await realpath(canonical));
    checkCancelled(ctx);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readBounded(ctx: WorkspaceFilesContext, handle: FileHandle, maximum: number): Promise<Buffer> {
  const metadata = await handle.stat();
  checkCancelled(ctx);
  if (metadata.size > maximum) throw new DomainValidationError(`file exceeds maxReadBytes (${metadata.size} > ${maximum})`);
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    checkCancelled(ctx);
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, maximum + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
    checkCancelled(ctx);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximum) throw new DomainValidationError(`file exceeds maxReadBytes (${total} > ${maximum})`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Whole reads preserve the former UTF-8 text/resolvedPath contract and never
 * allocate an entire oversized file. Range reads preserve original terminators,
 * scan at most 16 MiB, and emit at most maxReadBytes (hard maximum 1 MiB).
 * A range can excerpt the prefix of a larger file; reaching its end does not
 * require scanning the suffix. totalLines appears only after reaching EOF.
 */
export async function readWorkspaceFile(
  ctx: WorkspaceFilesContext,
  input: { path: string; startLine?: number; endLine?: number }
): Promise<{ text: string; resolvedPath: string; startLine?: number; endLine?: number; totalLines?: number }> {
  checkCancelled(ctx);
  const maximum = readLimit(ctx);
  const hasRange = input.startLine !== undefined || input.endLine !== undefined;
  const startLine = integer(input.startLine === undefined ? 1 : input.startLine, "startLine", Number.MAX_SAFE_INTEGER);
  const endLine = input.endLine === undefined ? undefined : integer(input.endLine, "endLine", Number.MAX_SAFE_INTEGER);
  if (endLine !== undefined && endLine < startLine) throw new DomainValidationError("line range endLine precedes startLine");
  const { root, canonical } = await scope(ctx, input.path);
  const resolvedPath = relativePath(root, canonical);
  const handle = await openRegular(ctx, root, canonical);
  try {
    if (!hasRange) return { text: (await readBounded(ctx, handle, maximum)).toString("utf8"), resolvedPath };
    const chunks: Buffer[] = [];
    let bytesScanned = 0;
    let outputBytes = 0;
    let currentLine = 1;
    let selectedEnd = startLine - 1;
    let lineHasBytes = false;
    while (bytesScanned < MAX_SCAN_BYTES) {
      checkCancelled(ctx);
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, MAX_SCAN_BYTES - bytesScanned));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytesScanned);
      checkCancelled(ctx);
      if (bytesRead === 0) {
        const totalLines = currentLine - (lineHasBytes ? 0 : 1);
        if (startLine > totalLines) throw new DomainValidationError(`startLine exceeds file line count (${totalLines})`);
        return { text: Buffer.concat(chunks, outputBytes).toString("utf8"), resolvedPath, startLine, endLine: selectedEnd, totalLines };
      }
      bytesScanned += bytesRead;
      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        lineHasBytes = true;
        if (buffer[index] !== 10) continue;
        if (currentLine >= startLine) {
          const segment = buffer.subarray(segmentStart, index + 1);
          outputBytes += segment.length;
          if (outputBytes > maximum) throw new DomainValidationError(`range exceeds maxReadBytes (${maximum})`);
          chunks.push(segment);
          selectedEnd = currentLine;
        }
        if (currentLine === endLine) {
          return { text: Buffer.concat(chunks, outputBytes).toString("utf8"), resolvedPath, startLine, endLine: selectedEnd };
        }
        currentLine += 1;
        lineHasBytes = false;
        segmentStart = index + 1;
      }
      if (currentLine >= startLine && segmentStart < bytesRead) {
        const segment = buffer.subarray(segmentStart, bytesRead);
        outputBytes += segment.length;
        if (outputBytes > maximum) throw new DomainValidationError(`range exceeds maxReadBytes (${maximum})`);
        chunks.push(segment);
        selectedEnd = currentLine;
      }
    }
    // A finite prefix is deliberately insufficient to claim a total line count.
    throw new DomainValidationError(`range exceeds scan limit (${MAX_SCAN_BYTES} bytes)`);
  } finally {
    await handle.close();
  }
}

interface ScanState {
  entries: number;
  truncated: boolean;
  stopped: boolean;
}

async function directoryEntries(ctx: WorkspaceFilesContext, directory: string, state: ScanState): Promise<string[]> {
  checkCancelled(ctx);
  const handle = await opendir(directory, { bufferSize: 32 });
  const names: string[] = [];
  try {
    while (true) {
      checkCancelled(ctx);
      const entry = await handle.read();
      checkCancelled(ctx);
      if (entry === null) break;
      state.entries += 1;
      if (state.entries > MAX_ENTRIES) {
        // Do not return an OS-order-dependent subset of an overfull directory.
        state.truncated = true;
        state.stopped = true;
        return [];
      }
      names.push(entry.name);
    }
    return names.sort();
  } finally {
    await handle.close();
  }
}

async function* walkFiles(
  ctx: WorkspaceFilesContext,
  root: string,
  absolute: string,
  state: ScanState,
  depth = 0
): AsyncGenerator<{ absolute: string; relative: string }> {
  checkCancelled(ctx);
  if (state.stopped) return;
  const relative = relativePath(root, absolute);
  if (Buffer.byteLength(relative) > MAX_PATH_BYTES || depth > MAX_DEPTH) {
    state.truncated = true;
    return;
  }
  const metadata = await lstat(absolute);
  checkCancelled(ctx);
  if (metadata.isSymbolicLink()) return;
  resolveInsideRoot(root, absolute);
  if (metadata.isFile()) {
    yield { absolute, relative };
    return;
  }
  if (!metadata.isDirectory()) return;
  for (const name of await directoryEntries(ctx, absolute, state)) {
    checkCancelled(ctx);
    if (EXCLUDED.has(name)) continue;
    yield* walkFiles(ctx, root, path.join(absolute, name), state, depth + 1);
    if (state.stopped) return;
  }
}

/**
 * Files only, lexical depth-first order, no traversal symlinks. Discovery visits
 * at most 10,001 directory entries (one overflow sentinel), depth 64, paths up to
 * 4 KiB and at most 1 MiB output. An overfull directory is omitted in its entirety
 * so its bounded admission does not depend on filesystem enumeration order.
 */
export async function listWorkspaceFiles(
  ctx: WorkspaceFilesContext,
  input: { path?: string; limit?: number }
): Promise<{ paths: readonly string[]; truncated: boolean }> {
  checkCancelled(ctx);
  const limit = integer(input.limit === undefined ? DEFAULT_RESULTS : input.limit, "limit", MAX_RESULTS);
  const { root, absolute } = await scope(ctx, input.path === undefined ? "." : input.path, true);
  const state: ScanState = { entries: 0, truncated: false, stopped: false };
  const paths: string[] = [];
  let outputBytes = 0;
  for await (const file of walkFiles(ctx, root, absolute, state)) {
    outputBytes += Buffer.byteLength(file.relative);
    if (outputBytes > MAX_READ_BYTES) { state.truncated = true; break; }
    paths.push(file.relative);
    if (paths.length >= limit) { state.truncated = true; break; }
  }
  checkCancelled(ctx);
  return { paths, truncated: state.truncated };
}

function boundedText(text: string, query: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= MAX_MATCH_BYTES) return { text, truncated: false };
  // Keep the literal match visible when a very long line needs an excerpt.
  const excerpt = text.slice(text.indexOf(query));
  let bytes = 0;
  let end = 0;
  for (const character of excerpt) {
    bytes += Buffer.byteLength(character);
    if (bytes > MAX_MATCH_BYTES) break;
    end += character.length;
  }
  return { text: excerpt.slice(0, end), truncated: true };
}

/** Literal single-line UTF-8 search. Oversized files are skipped visibly. The
 * scan reads at most 16 MiB total, at most maxReadBytes per file, at most 4 KiB
 * per matching line, and at most 1 MiB returned matching text/path bytes. NUL or
 * malformed UTF-8 files are skipped with truncated=true. */
export async function searchWorkspaceFiles(
  ctx: WorkspaceFilesContext,
  input: { query: string; path?: string; limit?: number }
): Promise<{ matches: readonly { path: string; line: number; text: string }[]; truncated: boolean }> {
  checkCancelled(ctx);
  if (typeof input.query !== "string" || input.query === "" || /[\r\n]/.test(input.query) || Buffer.byteLength(input.query) > MAX_MATCH_BYTES) {
    throw new DomainValidationError("query must be a non-empty single-line literal of at most 4096 UTF-8 bytes");
  }
  const maximum = readLimit(ctx);
  const limit = integer(input.limit === undefined ? DEFAULT_RESULTS : input.limit, "limit", MAX_RESULTS);
  const { root, absolute } = await scope(ctx, input.path === undefined ? "." : input.path, true);
  const state: ScanState = { entries: 0, truncated: false, stopped: false };
  const matches: { path: string; line: number; text: string }[] = [];
  let scannedBytes = 0;
  let outputBytes = 0;
  files: for await (const file of walkFiles(ctx, root, absolute, state)) {
    checkCancelled(ctx);
    const handle = await openRegular(ctx, root, file.absolute);
    let buffer: Buffer;
    try {
      const metadata = await handle.stat();
      checkCancelled(ctx);
      if (metadata.size > maximum || metadata.size > MAX_SCAN_BYTES - scannedBytes) {
        state.truncated = true;
        continue;
      }
      // readBounded's extra byte detects concurrent growth without an unbounded
      // read; reserve it in the operation budget even for stable files.
      if (MAX_SCAN_BYTES - scannedBytes < 1) { state.truncated = true; break; }
      const admitted = Math.min(maximum, MAX_SCAN_BYTES - scannedBytes - 1);
      try {
        buffer = await readBounded(ctx, handle, admitted);
      } catch (error) {
        if (error instanceof DomainValidationError && error.message.includes("maxReadBytes")) {
          scannedBytes += admitted + 1;
          state.truncated = true;
          continue;
        }
        throw error;
      }
      scannedBytes += buffer.byteLength + 1;
    } finally {
      await handle.close();
    }
    if (buffer.includes(0) || !isUtf8(buffer)) {
      state.truncated = true;
      continue;
    }
    let line = 0;
    for (const original of buffer.toString("utf8").split("\n")) {
      checkCancelled(ctx);
      line += 1;
      const text = original.endsWith("\r") ? original.slice(0, -1) : original;
      if (!text.includes(input.query)) continue;
      const bounded = boundedText(text, input.query);
      state.truncated ||= bounded.truncated;
      outputBytes += Buffer.byteLength(file.relative) + Buffer.byteLength(bounded.text);
      if (outputBytes > MAX_READ_BYTES) { state.truncated = true; break files; }
      matches.push({ path: file.relative, line, text: bounded.text });
      if (matches.length >= limit) { state.truncated = true; break files; }
    }
  }
  checkCancelled(ctx);
  return { matches, truncated: state.truncated };
}

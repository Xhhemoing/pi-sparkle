import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { resolveInsideRoot } from "./paths.js";

export interface WorkspacePatchContext {
  readonly worktreeRoot: string;
  /** May lower the fixed 1 MiB input/output ceiling. */
  readonly maxReadBytes?: number;
  readonly signal?: AbortSignal;
}

/**
 * Exact single replacement for a candidate's single writer. This is not a
 * filesystem transaction against independent external writers, or an OS sandbox.
 * No fuzzy matching, shell, creation, or permission/acceptance changes.
 */
export async function patchWorkspaceFile(
  ctx: WorkspacePatchContext,
  input: { readonly path: string; readonly oldText: string; readonly newText: string }
): Promise<{ readonly resolvedPath: string; readonly replacements: 1 }> {
  ctx.signal?.throwIfAborted();
  if (input === null || typeof input !== "object") throw new DomainValidationError("patch parameters must be an object");
  if (typeof input.path !== "string" || input.path.trim() === "") {
    throw new DomainValidationError("path must be a non-empty string");
  }
  if (typeof input.oldText !== "string" || input.oldText.length === 0) {
    throw new DomainValidationError("oldText must be a non-empty string for a unique exact patch");
  }
  if (typeof input.newText !== "string") throw new DomainValidationError("newText must be a string");
  const maxReadBytes = ctx.maxReadBytes === undefined ? 1024 * 1024 : ctx.maxReadBytes;
  if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 1024 * 1024) {
    throw new DomainValidationError("maxReadBytes must be an integer from 1 to 1048576");
  }
  if (Buffer.byteLength(input.oldText) > maxReadBytes || Buffer.byteLength(input.newText) > maxReadBytes) {
    throw new DomainValidationError("patch text exceeds maxReadBytes");
  }
  const absolute = resolveInsideRoot(ctx.worktreeRoot, input.path);
  const root = await realpath(ctx.worktreeRoot);
  const canonical = await realpath(absolute);
  resolveInsideRoot(root, canonical);
  const metadata = await lstat(canonical);
  if (!metadata.isFile()) throw new DomainValidationError("patch requires a regular file");
  ctx.signal?.throwIfAborted();
  // No truncation, no final-component link following, no blocking FIFO open.
  const file = await open(canonical, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
      throw new DomainValidationError("patch requires an unchanged regular file");
    }
    if (before.size > maxReadBytes) throw new DomainValidationError("file exceeds maxReadBytes");
    const buffer = Buffer.alloc(maxReadBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      ctx.signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxReadBytes) throw new DomainValidationError("file exceeds maxReadBytes");
    const bytes = buffer.subarray(0, length);
    const text = bytes.toString("utf8");
    if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) {
      throw new DomainValidationError("patch requires UTF-8 text, not binary data");
    }
    const first = text.indexOf(input.oldText);
    if (first < 0 || text.indexOf(input.oldText, first + 1) >= 0) {
      throw new DomainValidationError("oldText must have exactly one unique match");
    }
    const next = Buffer.from(text.slice(0, first) + input.newText + text.slice(first + input.oldText.length));
    if (next.length > maxReadBytes) throw new DomainValidationError("patched file exceeds maxReadBytes");
    const current = await file.stat();
    const pathname = await stat(canonical);
    if (before.dev !== pathname.dev || before.ino !== pathname.ino || before.size !== current.size || before.mtimeMs !== current.mtimeMs || before.ctimeMs !== current.ctimeMs ||
      await realpath(absolute) !== canonical) {
      throw new DomainValidationError("file changed during exact patch; read it again");
    }
    resolveInsideRoot(root, canonical);
    ctx.signal?.throwIfAborted();
    // Once admitted, finish the bounded write before observing cancellation.
    // Aborting midway would intentionally leave a partially patched file.
    let written = 0;
    while (written < next.length) {
      const result = await file.write(next, written, next.length - written, written);
      if (result.bytesWritten === 0) throw new DomainValidationError("exact patch write made no progress");
      written += result.bytesWritten;
    }
    await file.truncate(next.length);
    return { resolvedPath: relative(root, canonical).replaceAll("\\", "/"), replacements: 1 };
  } finally { await file.close(); }
}

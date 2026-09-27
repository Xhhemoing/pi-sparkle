import { appendFile, mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

export interface ReadJsonlOptions {
  /**
   * When true, truncate an incomplete trailing line to the real byte offset of
   * the last complete record. Default false: readers (inspect/follow/list) must
   * not mutate the file under a concurrent writer. Prefer letting
   * {@link appendJsonlLine} repair before write; pass `{ repair: true }` only
   * when a caller must repair without appending.
   */
  readonly repair?: boolean;
  /** Refuse before allocating/reading when the remaining file exceeds this bound. */
  readonly maxBytes?: number;
  /** Refuse once this many complete non-empty records would be exceeded. */
  readonly maxRecords?: number;
}

export class JsonlReadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonlReadLimitError";
  }
}

/**
 * Shared append-only JSONL helper for run events and episode logs.
 * Callers own schema validation; this module serializes lines and recovers a truncated tail.
 *
 * Truncation uses the absolute UTF-8 byte offset after the last complete record —
 * never a length recomputed by rejoining parsed lines (that drops blank-line bytes
 * and can cut a complete record). Readers default to non-mutating recovery;
 * {@link appendJsonlLine} repairs a crash-truncated tail before appending.
 */
export async function appendJsonlLine(filePath: string, line: string, fsync: boolean): Promise<void> {
  const needsNewline = await repairCrashTruncatedTail(filePath);
  const contents = `${needsNewline ? "\n" : ""}${line}\n`;
  const append = async (): Promise<void> => {
    if (!fsync) {
      await appendFile(filePath, contents, "utf8");
      return;
    }

    const handle = await open(filePath, "a");
    try {
      await handle.appendFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  try {
    await append();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(dirname(filePath), { recursive: true });
    await append();
  }
}

function lineForParse(segment: string): string {
  return segment.endsWith("\r") ? segment.slice(0, -1) : segment;
}

/**
 * If the file ends mid-line (no trailing newline and the final segment is not
 * valid JSON), truncate to the real byte offset after the previous newline.
 * Returns true when a complete final line needs a separator before append.
 * Healthy logs need only their last byte; a torn line is scanned backwards.
 */
async function repairCrashTruncatedTail(filePath: string): Promise<boolean> {
  const handle = await openExisting(filePath, "r+");
  if (handle === undefined) return false;
  try {
    const size = await regularFileSize(handle, filePath);
    if (size === 0) return false;
    const lastByte = await readRange(handle, size - 1, 1);
    if (lastByte.length !== 1) throw new Error("JSONL file changed while reading its tail");
    if (lastByte[0] === 0x0a) return false;

    const chunks = [lastByte];
    let position = size - 1;
    let keepBytes = 0;
    while (position > 0) {
      const length = Math.min(position, 4096);
      position -= length;
      const chunk = await readRange(handle, position, length);
      if (chunk.length !== length) throw new Error("JSONL file changed while reading its tail");
      const newline = chunk.lastIndexOf(0x0a);
      chunks.push(chunk.subarray(newline + 1));
      if (newline !== -1) {
        keepBytes = position + newline + 1;
        break;
      }
    }
    const parseTail = lineForParse(Buffer.concat(chunks.reverse()).toString("utf8"));
    await assertUnchangedSize(handle, size);
    if (parseTail === "") return true;
    try {
      JSON.parse(parseTail);
      return true;
    } catch {
      await handle.truncate(keepBytes);
      return false;
    }
  } finally {
    await handle.close();
  }
}


export type JsonlOffsetUnsafe = "offset-beyond-eof" | "offset-not-on-boundary";

export interface ReadJsonlFromOffset {
  values: unknown[];
  recovery: JsonlRecovery;
  fromByteOffset: number;
  completeByteLength: number;
  unsafe?: JsonlOffsetUnsafe;
}

/**
 * Read JSONL starting at an absolute UTF-8 byte offset that must sit on a
 * record boundary (0, or immediately after a newline). Offsets that are not
 * on a boundary, or that sit past EOF after a repair/truncate, are reported
 * via `unsafe` rather than parsed — callers decide whether to fall back.
 * The opened file's initial size bounds the read; this is not an immutable
 * snapshot. Callers still serialize writers when requesting tail repair.
 */
export async function readJsonlObjectsFromOffset(
  filePath: string,
  byteOffset: number,
  corrupt: (lineNumber: number) => Error,
  options: ReadJsonlOptions = {}
): Promise<ReadJsonlFromOffset> {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new RangeError(`JSONL byte offset must be a non-negative integer, got ${byteOffset}`);
  }
  const maxBytes = validateReadLimit("maxBytes", options.maxBytes);
  const maxRecords = validateReadLimit("maxRecords", options.maxRecords);
  if (maxBytes !== undefined && byteOffset !== 0) {
    throw new RangeError("bounded JSONL reads require byteOffset 0");
  }
  const handle = await openExisting(filePath, options.repair === true ? "r+" : "r");
  if (handle === undefined) {
    return emptyRead(byteOffset, 0, byteOffset > 0 ? "offset-beyond-eof" : undefined);
  }
  try {
    const size = await regularFileSize(handle, filePath);
    if (byteOffset > size) return emptyRead(byteOffset, size, "offset-beyond-eof");
    const remaining = size - byteOffset;
    if (maxBytes !== undefined && remaining > maxBytes) {
      throw new JsonlReadLimitError(`JSONL read exceeded maxBytes ${maxBytes}: ${remaining}`);
    }
    if (byteOffset > 0) {
      const boundary = await readRange(handle, byteOffset - 1, 1);
      if (boundary.length === 0) {
        return emptyRead(byteOffset, (await handle.stat()).size, "offset-beyond-eof");
      }
      if (boundary[0] !== 0x0a) return emptyRead(byteOffset, byteOffset, "offset-not-on-boundary");
    }
    // Capture one EOF: concurrent growth is left for the next incremental read.
    const buffer = await readRange(handle, byteOffset, remaining);
    if (buffer.length < remaining) {
      const currentSize = (await handle.stat()).size;
      if (byteOffset > currentSize) return emptyRead(byteOffset, currentSize, "offset-beyond-eof");
    }
    return await parseJsonlRange(handle, buffer, byteOffset, size, corrupt, options.repair === true, maxRecords);
  } finally {
    await handle.close();
  }
}

async function parseJsonlRange(
  handle: FileHandle,
  buffer: Buffer,
  byteOffset: number,
  size: number,
  corrupt: (lineNumber: number) => Error,
  repair: boolean,
  maxRecords: number | undefined
): Promise<ReadJsonlFromOffset> {
  const values: unknown[] = [];
  const recovery: JsonlRecovery = {};
  let cursor = 0;
  let keepBytes = 0;

  for (let index = 0; cursor < buffer.length; index += 1) {
    const newline = buffer.indexOf(0x0a, cursor);
    const isLast = newline === -1;
    const segmentEnd = isLast ? buffer.length : newline + 1;
    const parseLine = lineForParse(buffer.subarray(cursor, isLast ? buffer.length : newline).toString("utf8"));
    cursor = segmentEnd;

    if (parseLine === "") continue;

    try {
      const parsed = JSON.parse(parseLine) as unknown;
      if (maxRecords !== undefined && values.length >= maxRecords) {
        throw new JsonlReadLimitError(`JSONL read exceeded maxRecords ${maxRecords}`);
      }
      values.push(parsed);
      keepBytes = segmentEnd;
    } catch (error) {
      if (error instanceof JsonlReadLimitError) throw error;
      // Successful incremental reads never need the prefix. Only diagnostics
      // pay for its newline count to retain absolute corruption/recovery lines.
      const lineNumber = 1 + await countPrefixNewlines(handle, byteOffset) + index;
      if (isLast) {
        recovery.incompleteLine = parseLine;
        recovery.lineNumber = lineNumber;
        if (repair) {
          await assertUnchangedSize(handle, size);
          await handle.truncate(byteOffset + keepBytes);
        }
        continue;
      }
      throw corrupt(lineNumber);
    }
  }
  return {
    values,
    recovery,
    fromByteOffset: byteOffset,
    completeByteLength: byteOffset + keepBytes
  };
}

function emptyRead(byteOffset: number, completeByteLength: number, unsafe?: JsonlOffsetUnsafe): ReadJsonlFromOffset {
  return { values: [], recovery: {}, fromByteOffset: byteOffset, completeByteLength, ...(unsafe === undefined ? {} : { unsafe }) };
}

function validateReadLimit(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`JSONL ${name} must be a positive safe integer, got ${value}`);
  }
  return value;
}

async function openExisting(filePath: string, flags: "r" | "r+"): Promise<FileHandle | undefined> {
  return open(filePath, flags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function regularFileSize(handle: FileHandle, filePath: string): Promise<number> {
  const details = await handle.stat();
  if (!details.isFile()) {
    const code = details.isDirectory() ? "EISDIR" : "EINVAL";
    throw Object.assign(new Error(`${code}: JSONL path is not a regular file, '${filePath}'`), {
      code,
      path: filePath
    });
  }
  return details.size;
}

async function readRange(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, position + read);
    if (result.bytesRead === 0) break;
    read += result.bytesRead;
  }
  return buffer.subarray(0, read);
}

async function countPrefixNewlines(handle: FileHandle, length: number): Promise<number> {
  let newlines = 0;
  for (let position = 0; position < length;) {
    const requested = Math.min(length - position, 64 * 1024);
    const buffer = await readRange(handle, position, requested);
    if (buffer.length !== requested) throw new Error("JSONL file changed while counting prefix lines");
    for (const byte of buffer) {
      if (byte === 0x0a) newlines += 1;
    }
    position += buffer.length;
  }
  return newlines;
}

async function assertUnchangedSize(handle: FileHandle, size: number): Promise<void> {
  if ((await handle.stat()).size !== size) {
    throw new Error("JSONL file changed before tail repair");
  }
}

export async function readJsonlObjects(
  filePath: string,
  corrupt: (lineNumber: number) => Error,
  options: ReadJsonlOptions = {}
): Promise<{ values: unknown[]; recovery: JsonlRecovery }> {
  const read = await readJsonlObjectsFromOffset(filePath, 0, corrupt, options);
  return { values: read.values, recovery: read.recovery };
}

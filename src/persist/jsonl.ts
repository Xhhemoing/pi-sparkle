import { appendFile, mkdir, open, readFile, truncate } from "node:fs/promises";
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
  await repairCrashTruncatedTail(filePath);
  const contents = `${line}\n`;
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
 * Leaves a final complete line that lacks a newline untouched.
 */
async function repairCrashTruncatedTail(filePath: string): Promise<void> {
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (raw === "" || raw.endsWith("\n")) return;

  const lastNl = raw.lastIndexOf("\n");
  const tail = lastNl === -1 ? raw : raw.slice(lastNl + 1);
  const parseTail = lineForParse(tail);
  if (parseTail === "") return;
  try {
    JSON.parse(parseTail);
    return;
  } catch {
    const keepBytes = lastNl === -1 ? 0 : Buffer.byteLength(raw.slice(0, lastNl + 1), "utf8");
    await truncate(filePath, keepBytes);
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
  const repair = options.repair === true;
  const maxBytes = validateReadLimit("maxBytes", options.maxBytes);
  const maxRecords = validateReadLimit("maxRecords", options.maxRecords);
  if (maxBytes !== undefined && byteOffset !== 0) {
    throw new RangeError("bounded JSONL reads require byteOffset 0");
  }
  const buf = maxBytes === undefined
    ? await readFile(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return Buffer.alloc(0);
      throw error;
    })
    : await readFileBounded(filePath, byteOffset, maxBytes);
  if (byteOffset > buf.length) {
    return {
      values: [],
      recovery: {},
      fromByteOffset: byteOffset,
      completeByteLength: buf.length,
      unsafe: "offset-beyond-eof"
    };
  }
  if (byteOffset > 0 && buf[byteOffset - 1] !== 0x0a) {
    return {
      values: [],
      recovery: {},
      fromByteOffset: byteOffset,
      completeByteLength: byteOffset,
      unsafe: "offset-not-on-boundary"
    };
  }
  const raw = buf.subarray(byteOffset).toString("utf8");
  if (raw === "") {
    return { values: [], recovery: {}, fromByteOffset: byteOffset, completeByteLength: byteOffset };
  }

  let lineNumberBase = 1;
  if (byteOffset > 0) {
    let newlines = 0;
    for (let i = 0; i < byteOffset; i += 1) {
      if (buf[i] === 0x0a) newlines += 1;
    }
    lineNumberBase = 1 + newlines;
  }

  const segments = raw.split("\n");
  const values: unknown[] = [];
  const recovery: JsonlRecovery = {};
  let cursor = 0;
  let keepBytes = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const isLast = index === segments.length - 1;
    const segmentBytes = Buffer.byteLength(segment, "utf8");
    const newlineBytes = isLast ? 0 : 1;
    const segmentEnd = cursor + segmentBytes + newlineBytes;
    const parseLine = lineForParse(segment);

    if (parseLine === "") {
      cursor = segmentEnd;
      continue;
    }

    try {
      const parsed = JSON.parse(parseLine) as unknown;
      if (maxRecords !== undefined && values.length >= maxRecords) {
        throw new JsonlReadLimitError(`JSONL read exceeded maxRecords ${maxRecords}`);
      }
      values.push(parsed);
      keepBytes = segmentEnd;
      cursor = segmentEnd;
    } catch (error) {
      if (error instanceof JsonlReadLimitError) throw error;
      if (isLast) {
        recovery.incompleteLine = parseLine;
        recovery.lineNumber = lineNumberBase + index;
        if (repair) {
          const rawBytes = Buffer.byteLength(raw, "utf8");
          if (keepBytes < rawBytes) {
            await truncate(filePath, byteOffset + keepBytes);
          }
        }
        continue;
      }
      throw corrupt(lineNumberBase + index);
    }
  }
  return {
    values,
    recovery,
    fromByteOffset: byteOffset,
    completeByteLength: byteOffset + keepBytes
  };
}

function validateReadLimit(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`JSONL ${name} must be a positive safe integer, got ${value}`);
  }
  return value;
}

async function readFileBounded(filePath: string, byteOffset: number, maxBytes: number): Promise<Buffer> {
  const handle = await open(filePath, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (handle === undefined) return Buffer.alloc(0);
  try {
    const size = (await handle.stat()).size;
    const remaining = Math.max(0, size - byteOffset);
    if (remaining > maxBytes) {
      throw new JsonlReadLimitError(`JSONL read exceeded maxBytes ${maxBytes}: ${remaining}`);
    }
    const buffer = Buffer.alloc(remaining);
    let read = 0;
    while (read < remaining) {
      const result = await handle.read(buffer, read, remaining - read, byteOffset + read);
      if (result.bytesRead === 0) break;
      read += result.bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
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

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
  const buf = await readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  });
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
      values.push(JSON.parse(parseLine) as unknown);
      keepBytes = segmentEnd;
      cursor = segmentEnd;
    } catch {
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

export async function readJsonlObjects(
  filePath: string,
  corrupt: (lineNumber: number) => Error,
  options: ReadJsonlOptions = {}
): Promise<{ values: unknown[]; recovery: JsonlRecovery }> {
  const read = await readJsonlObjectsFromOffset(filePath, 0, corrupt, options);
  return { values: read.values, recovery: read.recovery };
}

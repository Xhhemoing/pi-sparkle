import { appendFile, mkdir, open, readFile, truncate } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

/**
 * Shared append-only JSONL helper for run events and episode logs.
 * Callers own schema validation; this module serializes lines and recovers a truncated tail.
 *
 * When the last line is incomplete, the on-disk file is truncated to the real byte
 * offset after the last complete record (including its newline and any blank lines
 * that preceded that record). Truncation must NOT be derived by rejoining parsed
 * lines — that drops leading/middle blank bytes and can cut through a complete
 * record. Callers that append concurrently should hold the run write lock around
 * recover-then-append; this helper only repairs a trailing fragment.
 */
export async function appendJsonlLine(filePath: string, line: string, fsync: boolean): Promise<void> {
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

export async function readJsonlObjects(
  filePath: string,
  corrupt: (lineNumber: number) => Error
): Promise<{ values: unknown[]; recovery: JsonlRecovery }> {
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (raw === "") return { values: [], recovery: {} };

  const segments = raw.split("\n");
  const values: unknown[] = [];
  const recovery: JsonlRecovery = {};
  let cursor = 0;
  /** Absolute UTF-8 byte offset of the end of the last successfully parsed record. */
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
        recovery.lineNumber = index + 1;
        const rawBytes = Buffer.byteLength(raw, "utf8");
        if (keepBytes < rawBytes) {
          await truncate(filePath, keepBytes);
        }
        continue;
      }
      throw corrupt(index + 1);
    }
  }
  return { values, recovery };
}

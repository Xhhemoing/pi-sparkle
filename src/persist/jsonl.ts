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
 * When the last line is incomplete, the on-disk file is truncated back to the last
 * complete line (including its newline) before returning. Leaving the fragment on
 * disk would make the next append bury it mid-file, where recovery can no longer
 * treat it as a trailing partial.
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
  let completePrefix = "";
  for (let index = 0; index < segments.length; index += 1) {
    const line = segments[index];
    if (line === undefined || line === "") continue;
    try {
      values.push(JSON.parse(line) as unknown);
      completePrefix += `${line}\n`;
    } catch {
      if (index === segments.length - 1) {
        recovery.incompleteLine = line;
        recovery.lineNumber = index + 1;
        const keepBytes = Buffer.byteLength(completePrefix, "utf8");
        if (keepBytes < Buffer.byteLength(raw, "utf8")) {
          await truncate(filePath, keepBytes);
        }
        continue;
      }
      throw corrupt(index + 1);
    }
  }
  return { values, recovery };
}

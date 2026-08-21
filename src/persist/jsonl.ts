import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

/**
 * Shared append-only JSONL helper for run events and episode logs.
 * Callers own schema validation; this module serializes lines and recovers a truncated tail.
 */
export async function appendJsonlLine(filePath: string, line: string, fsync: boolean): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, "utf8");
  if (!fsync) return;
  const handle = await open(filePath, "a");
  try {
    await handle.sync();
  } finally {
    await handle.close();
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
  for (let index = 0; index < segments.length; index += 1) {
    const line = segments[index];
    if (line === undefined || line === "") continue;
    try {
      values.push(JSON.parse(line) as unknown);
    } catch {
      if (index === segments.length - 1) {
        recovery.incompleteLine = line;
        recovery.lineNumber = index + 1;
        continue;
      }
      throw corrupt(index + 1);
    }
  }
  return { values, recovery };
}

import { readFile, stat } from "node:fs/promises";

/** Declared + enforced JSONL input cap (16 MiB). */
export const HARNESS_EFFICIENCY_MAX_FILE_BYTES = 16 * 1024 * 1024;

const ALLOWED_ROW_FIELDS = new Set([
  "schemaVersion",
  "runId",
  "requestId",
  "observationId",
  "baselineBytes",
  "projectedBytes"
]);

export interface EfficiencyRow {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly requestId: string;
  readonly observationId: string;
  readonly baselineBytes: number | null;
  readonly projectedBytes: number | null;
}

export interface EfficiencyReport {
  readonly schemaVersion: 1;
  readonly evidenceClass: "synthetic" | "observed";
  readonly rowCount: number;
  readonly pairedRows: number;
  readonly unknownRows: number;
  readonly pairedBaselineBytes: number;
  readonly pairedProjectedBytes: number;
  readonly pairedReductionRatio: number | null;
  readonly monetarySavingUsd: null;
  readonly notes: readonly string[];
}

export class HarnessEfficiencyError extends Error {
  readonly line: number | null;
  readonly field: string;

  constructor(line: number | null, field: string) {
    super(line === null ? field : `line ${String(line)}: ${field}`);
    this.name = "HarnessEfficiencyError";
    this.line = line;
    this.field = field;
  }
}

function fail(line: number | null, field: string): never {
  throw new HarnessEfficiencyError(line, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseByteField(value: unknown, line: number, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(line, field);
  }
  return value;
}

function rowKey(row: EfficiencyRow): string {
  return `${row.runId}\0${row.requestId}\0${row.observationId}`;
}

function lineForParse(segment: string): string {
  return segment.endsWith("\r") ? segment.slice(0, -1) : segment;
}

export function parseEfficiencyRow(value: unknown, line: number): EfficiencyRow {
  if (!isRecord(value)) fail(line, "json");
  for (const key of Object.keys(value)) {
    if (!ALLOWED_ROW_FIELDS.has(key)) fail(line, key);
  }
  if (value.schemaVersion !== 1) fail(line, "schemaVersion");
  if (!isNonEmptyString(value.runId)) fail(line, "runId");
  if (!isNonEmptyString(value.requestId)) fail(line, "requestId");
  if (!isNonEmptyString(value.observationId)) fail(line, "observationId");
  return {
    schemaVersion: 1,
    runId: value.runId,
    requestId: value.requestId,
    observationId: value.observationId,
    baselineBytes: parseByteField(value.baselineBytes, line, "baselineBytes"),
    projectedBytes: parseByteField(value.projectedBytes, line, "projectedBytes")
  };
}

/**
 * Parse a JSONL document into rows. Blank lines are ignored. Every non-blank
 * line must be a valid row. A truncated final line is rejected. Errors name
 * only the 1-based line number and field — never the raw input.
 */
export function parseEfficiencyJsonl(text: string): EfficiencyRow[] {
  if (Buffer.byteLength(text, "utf8") > HARNESS_EFFICIENCY_MAX_FILE_BYTES) {
    fail(null, "size");
  }

  const segments = text.split("\n");
  const rows: EfficiencyRow[] = [];
  const seen = new Set<string>();
  const endsWithNewline = text.endsWith("\n") || text.endsWith("\r\n");

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const lineNumber = index + 1;
    const isLast = index === segments.length - 1;
    const parseLine = lineForParse(segment);
    if (parseLine.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(parseLine) as unknown;
    } catch {
      fail(lineNumber, isLast && !endsWithNewline ? "truncated" : "json");
    }

    const row = parseEfficiencyRow(parsed, lineNumber);
    const key = rowKey(row);
    if (seen.has(key)) fail(lineNumber, "observationId");
    seen.add(key);
    rows.push(row);
  }

  return rows;
}

export async function readEfficiencyJsonlFile(filePath: string): Promise<EfficiencyRow[]> {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    fail(null, "read");
  }
  if (!details.isFile()) fail(null, "input");
  if (details.size > HARNESS_EFFICIENCY_MAX_FILE_BYTES) fail(null, "size");

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(null, "read");
  }
  if (Buffer.byteLength(text, "utf8") > HARNESS_EFFICIENCY_MAX_FILE_BYTES) {
    fail(null, "size");
  }
  return parseEfficiencyJsonl(text);
}

export function analyzeHarnessEfficiency(
  rows: readonly EfficiencyRow[],
  evidenceClass: EfficiencyReport["evidenceClass"]
): EfficiencyReport {
  if (evidenceClass !== "synthetic" && evidenceClass !== "observed") {
    fail(null, "evidence-class");
  }

  const seen = new Set<string>();
  let pairedRows = 0;
  let unknownRows = 0;
  let pairedBaselineBytes = 0;
  let pairedProjectedBytes = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    const line = index + 1;
    const row = parseEfficiencyRow(raw, line);
    const key = rowKey(row);
    if (seen.has(key)) fail(line, "observationId");
    seen.add(key);

    const paired = row.baselineBytes !== null && row.projectedBytes !== null;
    if (paired) {
      pairedRows += 1;
      pairedBaselineBytes += row.baselineBytes as number;
      pairedProjectedBytes += row.projectedBytes as number;
    } else {
      unknownRows += 1;
    }
  }

  const pairedReductionRatio =
    pairedRows === 0 || pairedBaselineBytes === 0
      ? null
      : 1 - pairedProjectedBytes / pairedBaselineBytes;

  return {
    schemaVersion: 1,
    evidenceClass,
    rowCount: rows.length,
    pairedRows,
    unknownRows,
    pairedBaselineBytes,
    pairedProjectedBytes,
    pairedReductionRatio,
    monetarySavingUsd: null,
    notes: [
      "pairedReductionRatio is 1 - pairedProjectedBytes / pairedBaselineBytes; null when unpaired or baseline sum is 0",
      "monetarySavingUsd is reserved and always null",
      `input file size cap is ${String(HARNESS_EFFICIENCY_MAX_FILE_BYTES)} bytes`
    ]
  };
}

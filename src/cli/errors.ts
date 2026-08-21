export interface CliErrorIo {
  stderr(text: string): void;
}

export interface CliErrorReport {
  readonly ok: false;
  readonly command: string;
  readonly stage: string;
  readonly message: string;
  readonly next: string;
  readonly runId?: string;
  readonly taskId?: string;
}

export const CLI_EXIT = {
  ok: 0,
  error: 1
} as const;

export function writeCliError(io: CliErrorIo, report: Omit<CliErrorReport, "ok">): void {
  const payload: CliErrorReport = { ok: false, ...report };
  io.stderr(`error: ${payload.message}\n`);
  io.stderr(`  command: ${payload.command}\n`);
  io.stderr(`  stage: ${payload.stage}\n`);
  if (payload.runId !== undefined) io.stderr(`  run: ${payload.runId}\n`);
  if (payload.taskId !== undefined) io.stderr(`  task: ${payload.taskId}\n`);
  io.stderr(`  next: ${payload.next}\n`);
  io.stderr(`${JSON.stringify(payload)}\n`);
}

export function cliFail(io: CliErrorIo, report: Omit<CliErrorReport, "ok">): typeof CLI_EXIT.error {
  writeCliError(io, report);
  return CLI_EXIT.error;
}

export function parseCliErrorJson(stderr: string): CliErrorReport | undefined {
  const lines = stderr.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as CliErrorReport;
      if (parsed.ok === false && typeof parsed.command === "string" && typeof parsed.stage === "string") {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

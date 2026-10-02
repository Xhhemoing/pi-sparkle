import { spawn } from "node:child_process";
import { DomainValidationError } from "../domain/errors.js";

export type CommandRunStatus = "completed" | "cancelled" | "timed_out" | "output_limit" | "spawn_error";

export interface AuthorizedCommandRunInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly signal?: AbortSignal;
}

export interface AuthorizedCommandRunResult {
  readonly status: CommandRunStatus;
  readonly spawned: boolean;
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutText: string;
  readonly stderrText: string;
  readonly stdoutByteLength: number;
  readonly stderrByteLength: number;
  readonly errorMessage?: string;
}

function requireLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError(`${name} must be a positive safe integer`);
  }
}

function terminate(child: ReturnType<typeof spawn>): void {
  // detached creates a process group on POSIX. A normal child kill is the
  // portable fallback; the command boundary still waits for close below.
  if (child.pid !== undefined && process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  } else {
    child.kill();
  }
}

/** Run one already-authorized command without a shell and await full cleanup. */
export function runAuthorizedCommand(input: AuthorizedCommandRunInput): Promise<AuthorizedCommandRunResult> {
  requireLimit(input.timeoutMs, "timeoutMs");
  requireLimit(input.maxStdoutBytes, "maxStdoutBytes");
  requireLimit(input.maxStderrBytes, "maxStderrBytes");
  if (input.signal?.aborted) {
    return Promise.resolve({
      status: "cancelled", spawned: false, ok: false, exitCode: null, signal: null,
      stdoutText: "", stderrText: "", stdoutByteLength: 0, stderrByteLength: 0
    });
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(input.executable, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true
      });
    } catch (error) {
      resolve({
        status: "spawn_error", spawned: false, ok: false, exitCode: null, signal: null,
        stdoutText: "", stderrText: "", stdoutByteLength: 0, stderrByteLength: 0,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    let status: CommandRunStatus = "completed";
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let errorMessage: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve({
        status, spawned: true, ok: status === "completed" && exitCode === 0,
        exitCode, signal: exitSignal, stdoutText: stdout, stderrText: stderr,
        stdoutByteLength: stdoutBytes, stderrByteLength: stderrBytes,
        ...(errorMessage === undefined ? {} : { errorMessage })
      });
    };
    const stop = (next: CommandRunStatus, reason?: string): void => {
      if (status === "completed") status = next;
      if (reason !== undefined) errorMessage = reason;
      if (!child.killed) terminate(child);
    };
    const onAbort = (): void => stop("cancelled");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => stop("timed_out", `command exceeded ${input.timeoutMs}ms`), input.timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      errorMessage = error.message;
      if (status === "completed") status = "spawn_error";
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stdoutBytes += Buffer.byteLength(text, "utf8");
      if (Buffer.byteLength(stdout, "utf8") < input.maxStdoutBytes) {
        const remaining = input.maxStdoutBytes - Buffer.byteLength(stdout, "utf8");
        stdout += Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
      }
      if (stdoutBytes > input.maxStdoutBytes) stop("output_limit", "stdout exceeded host limit");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stderrBytes += Buffer.byteLength(text, "utf8");
      if (Buffer.byteLength(stderr, "utf8") < input.maxStderrBytes) {
        const remaining = input.maxStderrBytes - Buffer.byteLength(stderr, "utf8");
        stderr += Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
      }
      if (stderrBytes > input.maxStderrBytes) stop("output_limit", "stderr exceeded host limit");
    });
    child.on("exit", (code, signal) => { exitCode = code; exitSignal = signal; });
    // close waits until stdout/stderr pipes are closed, which is the cleanup
    // boundary callers need before retaining evidence or applying a candidate.
    child.on("close", () => {
      // Preserve the historical check record's zero exit code for a command
      // that was healthy until the host stopped it for an output limit; the
      // distinct status is the authoritative failure reason.
      if (status === "output_limit" && exitCode === null) exitCode = 0;
      finish();
    });
  });
}

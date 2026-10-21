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

const TERMINATION_GRACE_MS = 250;
const FORCED_CLOSE_TIMEOUT_MS = 1_000;

function terminate(child: ReturnType<typeof spawn>, signal: "SIGTERM" | "SIGKILL"): void {
  // The process group can outlive its leader while descendants hold pipes.
  // Never use child.killed as evidence of exit: it only records signal delivery.
  if (child.pid !== undefined && process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch { /* Try the direct child below. */ }
  }
  // Windows signals terminate only the direct child. Tree containment requires
  // an OS-specific host facility; the final deadline still bounds local handles.
  try { child.kill(signal); } catch { /* Missing exit/close is handled by the deadline. */ }
}

function processGroupExists(child: ReturnType<typeof spawn>): boolean {
  if (child.pid === undefined || process.platform === "win32") return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    // Permission failure is not evidence that the owned group disappeared.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Run one already-authorized command without a shell, with bounded cleanup. */
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
    let forceTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;
    let stopping = false;
    let closed = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve({
        status, spawned: true, ok: status === "completed" && exitCode === 0,
        exitCode, signal: exitSignal, stdoutText: stdout, stderrText: stderr,
        stdoutByteLength: stdoutBytes, stderrByteLength: stderrBytes,
        ...(errorMessage === undefined ? {} : { errorMessage })
      });
    };
    const stop = (next: CommandRunStatus, reason?: string): void => {
      if (settled || stopping) return;
      stopping = true;
      if (status === "completed") status = next;
      if (reason !== undefined) errorMessage = reason;
      if (timer !== undefined) clearTimeout(timer);
      terminate(child, "SIGTERM");
      forceTimer = setTimeout(() => {
        forceTimer = undefined;
        terminate(child, "SIGKILL");
        if (closed) { finish(); return; }
        closeTimer = setTimeout(() => {
          const cleanupError = "command cleanup incomplete: pipes did not close after SIGKILL; descendants may still be running";
          errorMessage = errorMessage === undefined ? cleanupError : `${errorMessage}; ${cleanupError}`;
          // Escaped descendants (or an OS kill failure) must not hold the caller
          // forever. Release local handles and return failure, never acceptance.
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          finish();
        }, FORCED_CLOSE_TIMEOUT_MS);
      }, TERMINATION_GRACE_MS);
    };
    const onAbort = (): void => stop("cancelled");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => stop("timed_out", `command exceeded ${input.timeoutMs}ms`), input.timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      if (errorMessage === undefined) errorMessage = error.message;
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
    // close is stronger than exit: inherited stdout/stderr must also be closed.
    // A surviving group still gets its scheduled escalation even if all pipes
    // have closed, so ignored-stdio descendants do not escape cancellation.
    child.on("close", () => {
      closed = true;
      // Preserve the historical check record's zero exit code for a command
      // that was healthy until the host stopped it for an output limit; the
      // distinct status is the authoritative failure reason.
      if (status === "output_limit" && exitCode === null) exitCode = 0;
      if (!stopping || forceTimer === undefined || !processGroupExists(child)) finish();
    });
  });
}

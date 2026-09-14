import { DomainValidationError } from "../domain/errors.js";

export interface CommandAllowRule {
  /** Exact executable name or path (matched against argv0 as provided). */
  readonly executable: string;
  /**
   * Optional exact argv prefix that must match. Empty/omitted means any args
   * after the executable are allowed (still subject to maxArgs).
   */
  readonly argvPrefix?: readonly string[];
  readonly maxArgs?: number;
}

export interface CommandPolicy {
  readonly allow: readonly CommandAllowRule[];
  /** Env var names allowed into the child (default: empty = no host env). */
  readonly envAllowlist?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
}

export interface AuthorizedCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

function argsMatchPrefix(args: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > args.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (args[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Host-declared command authorization. Default posture is deny: without a
 * matching allow rule, execution is refused. This is not an OS sandbox —
 * allowed executables (including repo test scripts) can still do arbitrary
 * process work; use only with trusted fixtures / host-chosen rules.
 */
export function authorizeCommand(
  policy: CommandPolicy | undefined,
  command: string,
  args: readonly string[]
): AuthorizedCommand {
  if (policy === undefined || policy.allow.length === 0) {
    throw new DomainValidationError(
      "sparkle_run_command denied: host commandPolicy required (default deny)"
    );
  }
  if (command.trim() === "") {
    throw new DomainValidationError("command must be a non-empty string");
  }

  const rule = policy.allow.find((r) => r.executable === command);
  if (rule === undefined) {
    throw new DomainValidationError(`sparkle_run_command denied: executable not allowed: ${command}`);
  }
  const maxArgs = rule.maxArgs ?? 64;
  if (args.length > maxArgs) {
    throw new DomainValidationError(`sparkle_run_command denied: too many args (${args.length} > ${maxArgs})`);
  }
  if (rule.argvPrefix !== undefined && !argsMatchPrefix(args, rule.argvPrefix)) {
    throw new DomainValidationError("sparkle_run_command denied: argv does not match host allow rule");
  }

  const allow = new Set(policy.envAllowlist ?? []);
  const env: NodeJS.ProcessEnv = {};
  // Minimal PATH-free baseline so Node can still find nothing from host secrets.
  env.PATH = process.env.PATH ?? "";
  env.SystemRoot = process.env.SystemRoot;
  env.WINDIR = process.env.WINDIR;
  for (const key of allow) {
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  const executable = command === "node" ? process.execPath : command;

  return {
    executable,
    args,
    env,
    timeoutMs: policy.timeoutMs ?? 60_000,
    maxStdoutBytes: requirePositiveInt(policy.maxStdoutBytes, 256 * 1024, "maxStdoutBytes"),
    maxStderrBytes: requirePositiveInt(policy.maxStderrBytes, 256 * 1024, "maxStderrBytes")
  };
}

function requirePositiveInt(value: number | undefined, fallback: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n <= 0) {
    throw new DomainValidationError(`${name} must be a positive integer`);
  }
  return n;
}

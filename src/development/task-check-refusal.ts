import type { AuthorizedCommandRunResult } from "../execution/command-runner.js";
import type { DevelopmentTaskSpec } from "./task-spec.js";

/** Static preparation advice only; never acceptance or permission to execute it. */
export interface TaskCheckRefusal {
  readonly code: "TS_COMPILER_MISSING" | "TS_CONFIG_MISSING" | "TS_UNDECLARED_RED";
  readonly category: "infrastructure" | "undeclared-red";
  readonly message: string;
  readonly next: string;
}

const TYPESCRIPT_REFUSALS: Readonly<Record<TaskCheckRefusal["code"], TaskCheckRefusal>> = Object.freeze({
  TS_COMPILER_MISSING: Object.freeze({ code: "TS_COMPILER_MISSING", category: "infrastructure",
    message: "The example's TypeScript compiler or required type dependencies are unavailable.",
    next: "Prepare typescript and the required type packages in the explicit external dependency prefix, then regenerate and review the example. No dependencies are installed automatically." }),
  TS_CONFIG_MISSING: Object.freeze({ code: "TS_CONFIG_MISSING", category: "infrastructure",
    message: "The example's tsconfig.json is missing.",
    next: "Restore and review tsconfig.json before running the fixed tsc --noEmit -p . check again." }),
  TS_UNDECLARED_RED: Object.freeze({ code: "TS_UNDECLARED_RED", category: "undeclared-red",
    message: "The declared passing TypeScript baseline contains compiler errors.",
    next: "Inspect the private compiler diagnostics and fix the baseline code before retrying. A type error is not an authorized named business RED." })
});

export function classifyTaskCheckRefusal(check: DevelopmentTaskSpec["checks"][number], result: AuthorizedCommandRunResult): TaskCheckRefusal | undefined {
  if (result.status !== "completed" || result.signal !== null || result.cleanupUnsettled || result.exitCode === null || result.exitCode === 0 ||
      Buffer.byteLength(result.stdoutText) !== result.stdoutByteLength || Buffer.byteLength(result.stderrText) !== result.stderrByteLength) return undefined;
  if (check.id !== "typescript-typecheck" || check.verifierVersion !== "example-typescript-v1" ||
      check.args.length !== 1 || check.args[0] !== "typecheck/check.mjs" || !check.protectedPaths?.includes("typecheck")) return undefined;
  let report: unknown;
  try { report = JSON.parse(result.stdoutText); } catch { return undefined; }
  if (report === null || typeof report !== "object" || Array.isArray(report) || Object.keys(report).length !== 2 ||
      !("protocol" in report) || report.protocol !== "sparkle-example-typescript-check-v1" || !("code" in report) ||
      typeof report.code !== "string" || !Object.hasOwn(TYPESCRIPT_REFUSALS, report.code)) return undefined;
  const refusal = TYPESCRIPT_REFUSALS[report.code as TaskCheckRefusal["code"]];
  return result.exitCode === (refusal.category === "infrastructure" ? 2 : 1) ? refusal : undefined;
}

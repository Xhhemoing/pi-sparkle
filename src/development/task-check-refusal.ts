import type { AuthorizedCommandRunResult } from "../execution/command-runner.js";
import type { DevelopmentTaskSpec } from "./task-spec.js";

type TypeScriptRefusalCode = "TS_COMPILER_MISSING" | "TS_CONFIG_MISSING" | "TS_UNDECLARED_RED";

/** Static preparation advice only; never acceptance or permission to execute it. */
export interface TaskCheckRefusal {
  readonly code: TypeScriptRefusalCode | "RUST_TOOLCHAIN_UNAVAILABLE" | "RUST_OFFLINE_DEPENDENCY_MISSING";
  readonly category: "infrastructure" | "undeclared-red";
  readonly message: string;
  readonly next: string;
}

const TYPESCRIPT_REFUSALS: Readonly<Record<TypeScriptRefusalCode, TaskCheckRefusal>> = Object.freeze({
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

const RUST_TOOLCHAIN_REFUSAL: TaskCheckRefusal = Object.freeze({ code: "RUST_TOOLCHAIN_UNAVAILABLE", category: "infrastructure",
  message: "The Rust check could not select an installed toolchain.",
  next: "In the original host shell, run rustup toolchain list to identify an already installed toolchain. In PowerShell, set $env:RUSTUP_HOME=(rustup show home); $env:RUSTUP_TOOLCHAIN='<installed-toolchain>'. Regenerate and review init-generated drafts. For explicit TaskSpecs, the owner must review and update the fixed toolchain/environment selection before rechecking. Checks do not re-resolve that selection. Select an installed toolchain only; no toolchain is installed automatically." });

const RUST_OFFLINE_DEPENDENCY_REFUSAL: TaskCheckRefusal = Object.freeze({ code: "RUST_OFFLINE_DEPENDENCY_MISSING", category: "infrastructure",
  message: "The offline Rust check could not resolve a dependency from the selected local cache.",
  next: "The owner may prepare dependencies outside this offline product run using the same reviewed CARGO_HOME and registry configuration selected by the fixed TaskSpec: run cargo fetch and review any Cargo.lock changes, or cargo vendor and review the resulting configuration. Any change to the cache or registry selection requires explicit TaskSpec review before retrying. This product run does not enable network access or install dependencies." });

export function classifyTaskCheckRefusal(check: DevelopmentTaskSpec["checks"][number], result: AuthorizedCommandRunResult): TaskCheckRefusal | undefined {
  if (result.status !== "completed" || result.signal !== null || result.cleanupUnsettled || result.exitCode === null || result.exitCode === 0 ||
      Buffer.byteLength(result.stdoutText) !== result.stdoutByteLength || Buffer.byteLength(result.stderrText) !== result.stderrByteLength) return undefined;
  if (check.protectedPaths?.includes("Cargo.toml") && check.protectedPaths.includes("Cargo.lock")) {
    // These observed diagnostic lines only select static advice. They do not
    // change acceptance or forward Cargo/rustup's download suggestions.
    if (result.exitCode === 1 && /^error: rustup could not choose a version of cargo to run, because one wasn't specified explicitly, and no default is configured\.\r?$/m.test(result.stderrText)) {
      return RUST_TOOLCHAIN_REFUSAL;
    }
    if (result.exitCode === 101 && /^error: no matching package named `[^`\r\n]+` found\r?$/m.test(result.stderrText) &&
        /^location searched: crates\.io index\r?$/m.test(result.stderrText) &&
        /^note: offline mode \(via `--offline`\) can sometimes cause surprising resolution failures\r?$/m.test(result.stderrText)) {
      return RUST_OFFLINE_DEPENDENCY_REFUSAL;
    }
  }
  if (check.id !== "typescript-typecheck" || check.verifierVersion !== "example-typescript-v1" ||
      check.args.length !== 1 || check.args[0] !== "typecheck/check.mjs" || !check.protectedPaths?.includes("typecheck")) return undefined;
  let report: unknown;
  try { report = JSON.parse(result.stdoutText); } catch { return undefined; }
  if (report === null || typeof report !== "object" || Array.isArray(report) || Object.keys(report).length !== 2 ||
      !("protocol" in report) || report.protocol !== "sparkle-example-typescript-check-v1" || !("code" in report) ||
      typeof report.code !== "string" || !Object.hasOwn(TYPESCRIPT_REFUSALS, report.code)) return undefined;
  const refusal = TYPESCRIPT_REFUSALS[report.code as TypeScriptRefusalCode];
  return result.exitCode === (refusal.category === "infrastructure" ? 2 : 1) ? refusal : undefined;
}

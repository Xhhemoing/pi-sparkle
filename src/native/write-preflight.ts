import { spawnSync } from "node:child_process";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

export interface NativeWriteVerificationInput { readonly command: string; readonly args?: readonly string[]; }
export interface NativeWritePreflightInput { readonly sourceRepo: string; readonly objective: string; readonly verification: NativeWriteVerificationInput; readonly signal?: AbortSignal; }
export interface NativeWritePreflight { readonly sourceRepo: string; readonly objective: string; readonly verification: { readonly command: string; readonly args: readonly string[] }; readonly revision: string; }

function fail(message: string): never { throw new DomainValidationError(message); }
function git(repo: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd: repo, encoding: "utf8", windowsHide: true });
  if (result.error !== undefined || result.status !== 0) fail(`git preflight failed: ${result.error?.message ?? result.stderr ?? "unknown error"}`);
  return result.stdout.trim();
}
export function prepareNativeWrite(input: NativeWritePreflightInput): NativeWritePreflight {
  if (input === null || typeof input !== "object") fail("input is required");
  if (input.signal?.aborted) fail("write preflight aborted");
  if (typeof input.sourceRepo !== "string" || input.sourceRepo.trim() === "") fail("source repository is required");
  if (typeof input.objective !== "string" || input.objective.trim() === "") fail("objective is required");
  const verification = input.verification;
  if (verification === null || typeof verification !== "object") fail("verification is required");
  if (typeof verification.command !== "string" || verification.command.trim() === "") fail("verification command is required");
  const args = verification.args === undefined ? [] : verification.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail("verification args must be strings");
  const requested = path.resolve(input.sourceRepo);
  const root = path.resolve(git(requested, ["rev-parse", "--show-toplevel"]));
  if (requested !== root) fail("source repository must be the Git toplevel");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]);
  if (status !== "") fail("source repository must be clean");
  const revision = git(root, ["rev-parse", "HEAD"]);
  const output = { sourceRepo: root, objective: input.objective.trim(), verification: { command: verification.command, args: [...args] }, revision };
  Object.freeze(output.verification.args); Object.freeze(output.verification); return Object.freeze(output);
}

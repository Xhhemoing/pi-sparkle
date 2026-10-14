import { spawnSync } from "node:child_process";
import path from "node:path";
import { physicalDirectoryWithoutLinks } from "./physical-directory.js";
import { DomainValidationError } from "../domain/errors.js";
import { prepareNativeWriteCriteria, type NativeWriteAcceptanceCriterion } from "./write-criteria.js";
import { assertTrustedVerificationDescriptor, type TrustedVerificationDescriptor } from "../execution/trusted-verification.js";

export interface NativeWriteVerificationInput { readonly command: string; readonly args?: readonly string[]; readonly trustedVerification?: TrustedVerificationDescriptor; readonly repairableExitCodes?: readonly number[]; }
export interface NativeWritePreflightInput { readonly sourceRepo: string; readonly objective: string; readonly verification: NativeWriteVerificationInput; readonly signal?: AbortSignal; readonly acceptanceCriteria?: readonly NativeWriteAcceptanceCriterion[]; }
export interface NativeWritePreflight { readonly sourceRepo: string; readonly objective: string; readonly verification: { readonly command: string; readonly args: readonly string[]; readonly trustedVerification?: TrustedVerificationDescriptor; readonly repairableExitCodes?: readonly number[] }; readonly revision: string; readonly acceptanceCriteria?: readonly NativeWriteAcceptanceCriterion[]; }

function fail(message: string): never { throw new DomainValidationError(message); }
function repairableExits(input: unknown): readonly number[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 255) fail("repairableExitCodes must be an array of unique integer exit codes from 1 to 255");
  const codes: number[] = [];
  for (let index = 0; index < input.length; index++) {
    const property = Object.getOwnPropertyDescriptor(input, index);
    const value: unknown = property !== undefined && "value" in property ? property.value : undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 255 || codes.includes(value)) {
      fail("repairableExitCodes must be an array of unique integer exit codes from 1 to 255");
    }
    codes.push(value);
  }
  return Object.freeze(codes);
}
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
  const acceptanceCriteria = prepareNativeWriteCriteria(input.acceptanceCriteria);
  const verification = input.verification;
  if (verification === null || typeof verification !== "object") fail("verification is required");
  if (typeof verification.command !== "string" || verification.command.trim() === "") fail("verification command is required");
  const args = verification.args === undefined ? [] : verification.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail("verification args must be strings");
  const trustedVerification = verification.trustedVerification;
  const repairableExitCodes = repairableExits(verification.repairableExitCodes);
  if (trustedVerification !== undefined) assertTrustedVerificationDescriptor(trustedVerification, verification.command, args);
  const requested = path.resolve(input.sourceRepo);
  const physical = physicalDirectoryWithoutLinks(requested);
  const root = physicalDirectoryWithoutLinks(git(physical, ["rev-parse", "--show-toplevel"]));
  if (physical !== root) fail("source repository must be the Git toplevel");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]);
  if (status !== "") fail("source repository must be clean");
  const revision = git(root, ["rev-parse", "HEAD"]);
  const output = { sourceRepo: root, objective: input.objective.trim(), verification: { command: verification.command, args: [...args],
    ...(trustedVerification === undefined ? {} : { trustedVerification }),
    ...(repairableExitCodes === undefined ? {} : { repairableExitCodes }) }, revision,
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }) };
  Object.freeze(output.verification.args); Object.freeze(output.verification); return Object.freeze(output);
}

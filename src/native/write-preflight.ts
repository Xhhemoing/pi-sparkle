import { snapshotDevelopmentVerification } from "../development/task-policy.js";
import { assertDevelopmentCheckPlanVerification, snapshotDevelopmentCheckPlan, visibleDevelopmentCriteria, type DevelopmentCheckPlan } from "../development/check-plan.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { physicalDirectoryWithoutLinks } from "./physical-directory.js";
import { DomainValidationError } from "../domain/errors.js";
import { prepareNativeWriteCriteria, type NativeWriteAcceptanceCriterion } from "./write-criteria.js";
import { assertTrustedVerificationDescriptor, type TrustedVerificationDescriptor } from "../execution/trusted-verification.js";

export interface NativeWriteVerificationInput { readonly command: string; readonly args?: readonly string[]; readonly trustedVerification?: TrustedVerificationDescriptor; readonly repairableExitCodes?: readonly number[]; readonly unsettledExitCodes?: readonly number[]; }
export interface NativeWritePreflightInput { readonly sourceRepo: string; readonly objective: string; readonly verification: NativeWriteVerificationInput; readonly signal?: AbortSignal; readonly acceptanceCriteria?: readonly NativeWriteAcceptanceCriterion[]; readonly checkPlan?: DevelopmentCheckPlan; }
export interface NativeWritePreflight { readonly sourceRepo: string; readonly objective: string; readonly verification: { readonly command: string; readonly args: readonly string[]; readonly trustedVerification?: TrustedVerificationDescriptor; readonly repairableExitCodes?: readonly number[]; readonly unsettledExitCodes?: readonly number[] }; readonly revision: string; readonly acceptanceCriteria?: readonly NativeWriteAcceptanceCriterion[]; readonly checkPlan?: DevelopmentCheckPlan; }

function fail(message: string): never { throw new DomainValidationError(message); }
function exitCodes(input: unknown, name: string): readonly number[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 255) fail(`${name} must be an array of unique integer exit codes from 1 to 255`);
  const codes: number[] = [];
  for (let index = 0; index < input.length; index++) {
    const property = Object.getOwnPropertyDescriptor(input, index);
    const value: unknown = property !== undefined && "value" in property ? property.value : undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 255 || codes.includes(value)) {
      fail(`${name} must be an array of unique integer exit codes from 1 to 255`);
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
/** Snapshot plan-selected authority before any caller-owned input spread. */
export function prepareNativeCheckPlanInput(input: object): {
  readonly checkPlan: DevelopmentCheckPlan; readonly verification: NativeWriteVerificationInput;
} | undefined {
  const planProperty = Object.getOwnPropertyDescriptor(input, "checkPlan");
  if ((planProperty === undefined && "checkPlan" in input) || (planProperty !== undefined && !("value" in planProperty))) fail("check plan must be an own data property");
  if (planProperty?.value === undefined) return undefined;
  const checkPlan = snapshotDevelopmentCheckPlan(planProperty.value);
  const verifierProperty = Object.getOwnPropertyDescriptor(input, "verification");
  if (verifierProperty === undefined || !("value" in verifierProperty)) fail("planned verification must be an own data property");
  const criteriaProperty = Object.getOwnPropertyDescriptor(input, "acceptanceCriteria");
  if ((criteriaProperty === undefined && "acceptanceCriteria" in input) ||
      (criteriaProperty !== undefined && (!("value" in criteriaProperty) || criteriaProperty.value !== undefined))) fail("check plan derives its own visible acceptance criteria");
  return Object.freeze({ checkPlan, verification: snapshotDevelopmentVerification(verifierProperty.value as NativeWriteVerificationInput) });
}
export function prepareNativeWrite(input: NativeWritePreflightInput): NativeWritePreflight {
  if (input === null || typeof input !== "object") fail("input is required");
  if (input.signal?.aborted) fail("write preflight aborted");
  if (typeof input.sourceRepo !== "string" || input.sourceRepo.trim() === "") fail("source repository is required");
  if (typeof input.objective !== "string" || input.objective.trim() === "") fail("objective is required");
  const planned = prepareNativeCheckPlanInput(input);
  const checkPlan = planned?.checkPlan;
  const acceptanceCriteria = checkPlan === undefined ? prepareNativeWriteCriteria(input.acceptanceCriteria) : visibleDevelopmentCriteria(checkPlan);
  const verification = planned?.verification ?? input.verification;
  if (verification === null || typeof verification !== "object") fail("verification is required");
  if (typeof verification.command !== "string" || verification.command.trim() === "") fail("verification command is required");
  const args = verification.args === undefined ? [] : verification.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail("verification args must be strings");
  const trustedVerification = verification.trustedVerification;
  const repairableExitCodes = exitCodes(verification.repairableExitCodes, "repairableExitCodes");
  const unsettledExitCodes = exitCodes(verification.unsettledExitCodes, "unsettledExitCodes");
  if (unsettledExitCodes?.some((code) => repairableExitCodes?.includes(code))) fail("unsettled exit codes cannot authorize repair");
  if (trustedVerification !== undefined) assertTrustedVerificationDescriptor(trustedVerification, verification.command, args);
  if (checkPlan !== undefined) assertDevelopmentCheckPlanVerification(checkPlan, verification);
  const requested = path.resolve(input.sourceRepo);
  const physical = physicalDirectoryWithoutLinks(requested);
  const root = physicalDirectoryWithoutLinks(git(physical, ["rev-parse", "--show-toplevel"]));
  if (physical !== root) fail("source repository must be the Git toplevel");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]);
  if (status !== "") fail("source repository must be clean");
  const revision = git(root, ["rev-parse", "HEAD"]);
  const output = { sourceRepo: root, objective: input.objective.trim(), verification: { command: verification.command, args: [...args],
    ...(trustedVerification === undefined ? {} : { trustedVerification }),
    ...(repairableExitCodes === undefined ? {} : { repairableExitCodes }),
    ...(unsettledExitCodes === undefined ? {} : { unsettledExitCodes }) }, revision,
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
    ...(checkPlan === undefined ? {} : { checkPlan }) };
  Object.freeze(output.verification.args); Object.freeze(output.verification); return Object.freeze(output);
}

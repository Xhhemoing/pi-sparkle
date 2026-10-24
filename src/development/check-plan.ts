import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DomainValidationError } from "../domain/errors.js";
import { matchesPathSelector } from "../execution/path-selector.js";
import type { IndependentCheckRecord } from "../execution/independent-check.js";
import { assertTrustedVerificationDescriptor } from "../execution/trusted-verification.js";
import type { NativeWriteAcceptanceCriterion } from "../native/write-criteria.js";
import type { NativeWriteVerificationInput } from "../native/write-preflight.js";
import { prepareScopedDevelopmentVerification, type DevelopmentScopePolicy } from "./task-policy.js";
import { DEFAULT_RECIPE_OUTPUT_BYTES, prepareWorkItemRecipes, type WorkItemRecipe } from "./work-items.js";

/** Experimental Check foundation; not the complete public TaskSpec schema. */
export interface DevelopmentCheckDefinition extends WorkItemRecipe { readonly visibleToWorker?: boolean; }
export interface DevelopmentCheckPlan { readonly checks: readonly DevelopmentCheckDefinition[]; }
export interface VisibleCheckResult {
  readonly id: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdoutText: string;
  readonly stderrText: string;
  readonly stdoutByteLength: number;
  readonly stderrByteLength: number;
}
export interface VisibleCheckFeedback {
  readonly outcome: "not-accepted";
  readonly checks: readonly VisibleCheckResult[];
}
export const DEVELOPMENT_CHECK_STORAGE_BYTES = 256 * 1024;
const RECIPE_FIELDS = ["id", "command", "args", "verifierVersion", "protectedPaths", "timeoutMs", "maxStdoutBytes", "maxStderrBytes"];
function fail(reason: string): never { throw new DomainValidationError(`development check plan: ${reason}`); }
function ownRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("expected a plain object");
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in property)) fail("unsupported field or accessor");
    Object.defineProperty(result, key, { value: property.value, enumerable: true });
  }
  return result;
}
function ownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("expected ordinary array values");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, index);
    if (property === undefined || !("value" in property)) fail("expected ordinary array values");
    result.push(property.value);
  }
  return result;
}
export function snapshotDevelopmentCheckPlan(value: unknown): DevelopmentCheckPlan {
  const raw = ownRecord(value, ["checks"]);
  if (!Array.isArray(raw.checks) || raw.checks.length < 1 || raw.checks.length > 8) fail("requires 1..8 checks");
  const checks = ownArray(raw.checks).map((entry) => {
    const record = ownRecord(entry, [...RECIPE_FIELDS, "visibleToWorker"]);
    const visible = record.visibleToWorker === undefined ? true : record.visibleToWorker;
    if (typeof visible !== "boolean") fail("visibleToWorker must be boolean");
    const { visibleToWorker: _visible, ...recipe } = record;
    recipe.args = ownArray(recipe.args);
    if (recipe.protectedPaths !== undefined) recipe.protectedPaths = ownArray(recipe.protectedPaths);
    return { recipe, visible };
  });
  const recipes = prepareWorkItemRecipes(checks.map((entry) => entry.recipe));
  // JSON escaping can expand a bounded byte sixfold. Refuse a plan whose
  // complete bounded report cannot fit the existing command output ceiling.
  const reportBound = recipes.reduce((total, recipe) => total + 1024 +
    6 * ((recipe.maxStdoutBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES) + (recipe.maxStderrBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES) + 8), 1024);
  if (reportBound > DEVELOPMENT_CHECK_STORAGE_BYTES) fail("combined check output limits exceed structured evidence capacity");
  return Object.freeze({ checks: Object.freeze(recipes.map((recipe, index) =>
    Object.freeze({ ...recipe, visibleToWorker: checks[index]!.visible }))) });
}
function recipesOf(plan: DevelopmentCheckPlan): readonly WorkItemRecipe[] {
  return plan.checks.map(({ visibleToWorker: _visible, ...recipe }) => recipe);
}
function verifierDefinition(plan: DevelopmentCheckPlan) {
  const sourceMode = import.meta.url.endsWith(".ts");
  const suffix = sourceMode ? ".ts" : ".js";
  const checker = fileURLToPath(new URL(`./recipe-check${suffix}`, import.meta.url));
  return { command: process.execPath,
    args: [...(sourceMode ? ["--import", import.meta.resolve("tsx")] : []), checker, JSON.stringify(recipesOf(plan)), "--structured"],
    checkerFiles: [checker, fileURLToPath(new URL(`../execution/command-runner${suffix}`, import.meta.url)),
      fileURLToPath(new URL(`./work-items${suffix}`, import.meta.url)), fileURLToPath(new URL(`../domain/errors${suffix}`, import.meta.url))] };
}
export function prepareDevelopmentCheckPlan(input: DevelopmentCheckPlan & { readonly scopePolicy: DevelopmentScopePolicy }): {
  readonly checkPlan: DevelopmentCheckPlan; readonly verification: NativeWriteVerificationInput;
} {
  const checkPlan = snapshotDevelopmentCheckPlan({ checks: input.checks });
  const verification = prepareScopedDevelopmentVerification({ ...verifierDefinition(checkPlan), scopePolicy: input.scopePolicy,
    maxSnapshotFiles: 1024, maxSnapshotBytes: 16 * 1024 * 1024 });
  const fixedVerification = Object.freeze({ ...verification,
    repairableExitCodes: Object.freeze([1]), unsettledExitCodes: Object.freeze([3]) });
  assertDevelopmentCheckPlanVerification(checkPlan, fixedVerification);
  return Object.freeze({ checkPlan, verification: fixedVerification });
}
export function assertDevelopmentCheckPlanVerification(plan: DevelopmentCheckPlan, verification: NativeWriteVerificationInput): void {
  const expected = verifierDefinition(plan);
  const descriptor = verification.trustedVerification;
  if (descriptor === undefined) fail("requires an original host-issued verifier");
  assertTrustedVerificationDescriptor(descriptor, verification.command, verification.args);
  const under = (relative: string, prefix: string): boolean => relative === prefix || relative.startsWith(`${prefix}/`);
  const manifest = descriptor.snapshotManifest;
  for (const protectedPath of plan.checks.flatMap((check) => check.protectedPaths ?? [])) {
    if (!((manifest.includePrefixes ?? []).some((prefix) => under(protectedPath, prefix)) ||
        (manifest.includePatterns ?? []).some((selector) => matchesPathSelector(protectedPath, selector))) ||
        (manifest.excludePrefixes ?? []).some((prefix) => under(protectedPath, prefix) || under(prefix, protectedPath))) {
      fail("declared protected check dependencies are not covered by the selected verifier scope");
    }
  }
  if ((manifest.allowedOutputDirs?.length ?? 0) !== 0) fail("check plan requires exact verification without allowed output directories");
  if (verification.command !== expected.command || verification.args?.length !== expected.args.length ||
      !expected.args.every((arg, index) => verification.args![index] === arg) ||
      !expected.checkerFiles.every((file) => descriptor.checkerFiles.includes(realpathSync(file)))) fail("verifier does not match the fixed check plan");
  if (verification.repairableExitCodes?.length !== 1 || verification.repairableExitCodes[0] !== 1 ||
      verification.unsettledExitCodes?.length !== 1 || verification.unsettledExitCodes[0] !== 3) fail("check plan requires functional exit 1 and unsettled exit 3 policies");
}
export function visibleDevelopmentCriteria(plan: DevelopmentCheckPlan): readonly NativeWriteAcceptanceCriterion[] | undefined {
  const visible = plan.checks.filter((check) => check.visibleToWorker !== false);
  return visible.length === 0 ? undefined : Object.freeze(visible.map((check) => Object.freeze({ id: check.id,
    description: `Satisfy host check ${check.id}`, observableCheck: `Host check ${check.id}, verifier ${check.verifierVersion}` })));
}
export function renderVisibleDevelopmentChecks(plan: DevelopmentCheckPlan): string {
  const visible = plan.checks.filter((check) => check.visibleToWorker !== false).map(({ id, command, args }) => ({ id, command, args }));
  return visible.length === 0 ? "" : `\n\nWorker-visible host checks (fixed declarations, not new permission grants):\n${JSON.stringify(visible)}`;
}
function excerpt(text: string): string {
  const bytes = Buffer.from(text);
  return bytes.length <= 1024 ? text : `${bytes.subarray(0, 256).toString("utf8")}\n... output omitted ...\n${bytes.subarray(-768).toString("utf8")}`;
}
/** Decode the complete host report, then project only its predeclared visible rows. */
export function projectDevelopmentCheckFeedback(plan: DevelopmentCheckPlan, check: IndependentCheckRecord): VisibleCheckFeedback | undefined {
  if (check.processStatus !== "completed" || check.processSignal !== null || check.processExitCode !== 1 || check.exitCode !== 1 ||
      check.processCleanupUnsettled || !check.trustedVerification?.ok ||
      check.stdoutByteLength !== Buffer.byteLength(check.stdoutText) || check.stderrByteLength !== Buffer.byteLength(check.stderrText)) return undefined;
  try {
    const report = ownRecord(JSON.parse(check.stdoutText) as unknown, ["schemaVersion", "results", "unobserved"]);
    if (report.schemaVersion !== 1 || !Array.isArray(report.results) || report.results.length !== plan.checks.length ||
        !Array.isArray(report.unobserved) || report.unobserved.length !== 0) return undefined;
    let anyFailed = false;
    const visible: VisibleCheckResult[] = [];
    for (let index = 0; index < plan.checks.length; index++) {
      const definition = plan.checks[index]!;
      const result = ownRecord(report.results[index], ["recipeId", "ok", "status", "exitCode", "signal", "stdoutText", "stderrText",
        "stdoutByteLength", "stderrByteLength", "cleanupUnsettled"]);
      if (result.recipeId !== definition.id || result.status !== "completed" || result.signal !== null || result.cleanupUnsettled !== false ||
          typeof result.exitCode !== "number" || !Number.isSafeInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255 ||
          typeof result.ok !== "boolean" || result.ok !== (result.exitCode === 0) || typeof result.stdoutText !== "string" || typeof result.stderrText !== "string" ||
          typeof result.stdoutByteLength !== "number" || !Number.isSafeInteger(result.stdoutByteLength) || result.stdoutByteLength < 0 ||
          typeof result.stderrByteLength !== "number" || !Number.isSafeInteger(result.stderrByteLength) || result.stderrByteLength < 0 ||
          result.stdoutByteLength !== Buffer.byteLength(result.stdoutText) || result.stderrByteLength !== Buffer.byteLength(result.stderrText) ||
          result.stdoutByteLength > (definition.maxStdoutBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES) ||
          result.stderrByteLength > (definition.maxStderrBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES)) return undefined;
      anyFailed ||= !result.ok;
      if (definition.visibleToWorker !== false) visible.push(Object.freeze({ id: definition.id, ok: result.ok, exitCode: result.exitCode,
        stdoutText: excerpt(result.stdoutText), stderrText: excerpt(result.stderrText),
        stdoutByteLength: result.stdoutByteLength, stderrByteLength: result.stderrByteLength }));
    }
    return anyFailed ? Object.freeze({ outcome: "not-accepted", checks: Object.freeze(visible) }) : undefined;
  } catch { return undefined; }
}

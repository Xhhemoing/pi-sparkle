import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { captureExactSnapshot, sameExactSnapshot, type ExactSnapshot } from "../execution/exact-snapshot.js";
import { resolveInsideRoot } from "../execution/paths.js";
import { assertTrustedVerificationDescriptor, prepareTrustedVerification,
  type TrustedVerificationInput, type TrustedVerificationDescriptor } from "../execution/trusted-verification.js";
import { captureWorktreeFingerprint } from "../execution/worktree-snapshot.js";
import type { NativeWriteVerificationInput } from "../native/write-preflight.js";
import type { NativeWriteExecutorFactory } from "../native/write-session.js";
import { hasPathPattern, matchesPathSelector, normalizePathSelector } from "../execution/path-selector.js";
import type { SnapshotManifest } from "../execution/worktree-snapshot.js";
import { workItemScope } from "./work-items.js";

/** Experimental host-only path selectors; not a public TaskSpec schema. */
export interface DevelopmentScopePolicy {
  readonly allowedScope: readonly string[];
  readonly protectedPaths: readonly string[];
}

// Preserve existing Controller refusal wording for its current callers.
function fail(reason: string): never { throw new DomainValidationError(`development controller: ${reason}`); }
function under(relative: string, prefixes: readonly string[]): boolean {
  return relative !== ".git" && !relative.startsWith(".git/") && prefixes.some((prefix) => hasPathPattern(prefix) ? matchesPathSelector(relative, prefix) : relative === prefix || relative.startsWith(`${prefix}/`));
}
function paths(value: unknown, name: string, minimum: number, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`invalid ${name} path list`);
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, index);
    if (property === undefined || !("value" in property)) fail(`${name} paths must be ordinary values`);
    const entry: unknown = property.value;
    const relative = typeof entry === "string" && hasPathPattern(entry) ? normalizePathSelector(entry) : workItemScope(entry);
    if (result.includes(relative)) fail(`${name} paths must be unique`);
    result.push(relative);
  }
  return Object.freeze(result);
}

export function snapshotDevelopmentScopePolicy(value: unknown): DevelopmentScopePolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("scope policy must be a plain object");
  if (Reflect.ownKeys(value).some((key) => key !== "allowedScope" && key !== "protectedPaths")) fail("unsupported scope policy field");
  const own = (name: string): unknown => {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (property === undefined || !("value" in property)) fail("scope policy paths must be own data properties");
    return property.value;
  };
  return Object.freeze({ allowedScope: paths(own("allowedScope"), "allowed", 1, 32),
    protectedPaths: paths(own("protectedPaths"), "protected", 0, 128) });
}

/** Keep legacy literal fields literal; patterns are re-evaluated at every observation. */
export function developmentScopeManifest(policy: DevelopmentScopePolicy): SnapshotManifest {
  const required = policy.protectedPaths.filter((entry) => !hasPathPattern(entry));
  const optional = policy.allowedScope.filter((entry) => !hasPathPattern(entry));
  const requiredPatterns = policy.protectedPaths.filter(hasPathPattern);
  const optionalPatterns = policy.allowedScope.filter(hasPathPattern);
  return { includePrefixes: required, optionalIncludePrefixes: optional,
    ...(requiredPatterns.length === 0 ? {} : { includePatterns: requiredPatterns }),
    ...(optionalPatterns.length === 0 ? {} : { optionalIncludePatterns: optionalPatterns }) };
}
/** Issue the existing host verifier explicitly; execution never rewrites one. */
export function prepareScopedDevelopmentVerification(
  input: Omit<TrustedVerificationInput, "snapshotManifest"> & { readonly scopePolicy: DevelopmentScopePolicy }
): NativeWriteVerificationInput {
  const policy = snapshotDevelopmentScopePolicy(input.scopePolicy);
  const descriptor = prepareTrustedVerification({ command: input.command,
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.checkerFiles === undefined ? {} : { checkerFiles: input.checkerFiles }),
    ...(input.maxSnapshotBytes === undefined ? {} : { maxSnapshotBytes: input.maxSnapshotBytes }),
    ...(input.maxSnapshotFiles === undefined ? {} : { maxSnapshotFiles: input.maxSnapshotFiles }),
    snapshotManifest: developmentScopeManifest(policy) });
  return Object.freeze({ command: descriptor.command, args: descriptor.args, trustedVerification: descriptor });
}

/** Scoped calls use these same ordinary values for policy matching and execution. */
export function snapshotDevelopmentVerification(input: NativeWriteVerificationInput): NativeWriteVerificationInput {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) fail("verification must be a plain object");
  const fields = ["command", "args", "timeoutMs", "trustedVerification", "repairableExitCodes", "unsettledExitCodes"];
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || !fields.includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some((property) => !("value" in property))) {
    fail("verification must contain ordinary own fields");
  }
  const copyArray = <T>(values: readonly T[]): readonly T[] => {
    if (!Array.isArray(values)) fail("verification arrays must be ordinary values");
    const result: T[] = [];
    for (let index = 0; index < values.length; index++) {
      const property = Object.getOwnPropertyDescriptor(values, index);
      if (property === undefined || !("value" in property)) fail("verification arrays must be ordinary values");
      result.push(property.value as T);
    }
    return Object.freeze(result);
  };
  return Object.freeze({ ...input,
    ...(input.args === undefined ? {} : { args: copyArray(input.args) }),
    ...(input.repairableExitCodes === undefined ? {} : { repairableExitCodes: copyArray(input.repairableExitCodes) }),
    ...(input.unsettledExitCodes === undefined ? {} : { unsettledExitCodes: copyArray(input.unsettledExitCodes) }) });
}

function matchingDescriptor(policy: DevelopmentScopePolicy, verification: NativeWriteVerificationInput): TrustedVerificationDescriptor {
  const descriptor = verification.trustedVerification;
  if (descriptor === undefined) fail("scoped execution requires an original host-issued verifier");
  assertTrustedVerificationDescriptor(descriptor, verification.command, verification.args);
  const equal = (left: readonly string[] | undefined, right: readonly string[]): boolean => {
    const a = [...(left ?? [])].sort(); const b = [...right].sort();
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  };
  const manifest = descriptor.snapshotManifest;
  const expected = developmentScopeManifest(policy);
  if (!equal(manifest.includePrefixes, expected.includePrefixes ?? []) || !equal(manifest.optionalIncludePrefixes, expected.optionalIncludePrefixes ?? []) ||
      !equal(manifest.includePatterns, expected.includePatterns ?? []) || !equal(manifest.optionalIncludePatterns, expected.optionalIncludePatterns ?? []) ||
      (manifest.excludePrefixes?.length ?? 0) !== 0 || (manifest.allowedOutputDirs?.length ?? 0) !== 0) {
    fail("host verifier manifest does not match the selected scope policy");
  }
  return descriptor;
}

function canonicalMutationPath(candidate: string, relative: string): string {
  const root = realpathSync(candidate);
  let ancestor = resolveInsideRoot(candidate, relative);
  const missing: string[] = [];
  for (;;) {
    try {
      const canonical = path.resolve(realpathSync(ancestor), ...missing.reverse());
      resolveInsideRoot(root, canonical);
      return path.relative(root, canonical).replaceAll("\\", "/");
    } catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(path.basename(ancestor)); ancestor = parent;
    }
  }
}
function mutationArguments(candidate: string, raw: unknown, policy: DevelopmentScopePolicy): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("write outside task scope or into protected verifier dependency refused");
  const copied: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    const property = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || !("value" in property)) fail("mutation arguments must contain ordinary own values");
    Object.defineProperty(copied, key, { value: property.value, enumerable: true });
  }
  const relative = copied.path;
  if (typeof relative !== "string" || relative.includes("\\") || path.posix.isAbsolute(relative) ||
      relative.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      !under(relative, policy.allowedScope) || under(relative, policy.protectedPaths)) fail("write outside task scope or into protected verifier dependency refused");
  const canonical = canonicalMutationPath(candidate, relative);
  if (!under(canonical, policy.allowedScope) || under(canonical, policy.protectedPaths)) fail("write outside task scope or into protected verifier dependency refused");
  return copied;
}

/** Keep ordinary Git scope checks and include ignored additions under explicit protection. */
export function assertDevelopmentScope(candidate: string, policy: DevelopmentScopePolicy, baseRevision: string): void {
  const committed = spawnSync("git", ["--no-replace-objects", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", baseRevision, "HEAD", "--"],
    { cwd: candidate, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (committed.error !== undefined || committed.status !== 0) fail("committed candidate paths could not be verified");
  if (committed.stdout.split("\0").filter(Boolean).some((relative) => !under(relative, policy.allowedScope) || under(relative, policy.protectedPaths))) {
    fail("candidate changed paths outside task scope or inside protected verifier dependencies");
  }
  if (captureWorktreeFingerprint(candidate).entries.some((entry) => !under(entry.path, policy.allowedScope) || under(entry.path, policy.protectedPaths))) {
    fail("candidate changed paths outside task scope or inside protected verifier dependencies");
  }
  if (policy.protectedPaths.length === 0) return;
  const anchors = [...new Set(policy.protectedPaths.map((selector) => {
    const parts = selector.split("/"); const patternAt = parts.findIndex(hasPathPattern);
    return patternAt < 0 ? selector : parts.slice(0, patternAt).join("/") || ".";
  }))];
  const ignored = spawnSync("git", ["--literal-pathspecs", "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...anchors],
    { cwd: candidate, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (ignored.error !== undefined || ignored.status !== 0) fail("protected ignored paths could not be verified");
  if (ignored.stdout.split("\0").filter(Boolean).some((relative) => under(relative, policy.protectedPaths))) fail("candidate changed paths outside task scope or inside protected verifier dependencies");
}

/** One invocation owns one protected observation across all repair attempts. */
export function scopedDevelopmentExecutorFactory(
  factory: NativeWriteExecutorFactory, input: DevelopmentScopePolicy, verification: NativeWriteVerificationInput
): NativeWriteExecutorFactory {
  const policy = snapshotDevelopmentScopePolicy(input);
  const descriptor = matchingDescriptor(policy, verification);
  const limits = { maxFiles: descriptor.maxSnapshotFiles, maxBytes: descriptor.maxSnapshotBytes };
  let candidate: string | undefined;
  let protectedBefore: ExactSnapshot | undefined;
  const checkProtected = (cwd: string): void => {
    if (protectedBefore !== undefined && !sameExactSnapshot(protectedBefore,
      captureExactSnapshot(cwd, developmentScopeManifest({ allowedScope: [], protectedPaths: policy.protectedPaths }), limits))) fail("protected candidate bytes changed during execution");
  };
  return async (context) => {
    if (candidate === undefined) {
      candidate = context.candidatePath;
      if (policy.protectedPaths.length > 0) protectedBefore = captureExactSnapshot(candidate, developmentScopeManifest({ allowedScope: [], protectedPaths: policy.protectedPaths }), limits);
    } else {
      if (candidate !== context.candidatePath) fail("scoped repair cannot replace its candidate");
      checkProtected(candidate);
    }
    const tools = context.tools.map((tool) => tool.name !== "sparkle_write_file" && tool.name !== "sparkle_patch_file" ? tool : {
      ...tool, execute: (id: string, raw: unknown, signal?: AbortSignal) =>
        tool.execute(id, mutationArguments(context.candidatePath, raw, policy), signal)
    });
    const executor = await factory({ ...context, tools });
    return {
      ...(executor.supportedModelIds === undefined ? {} : { supportedModelIds: executor.supportedModelIds }),
      ...(executor.steerText === undefined ? {} : { steerText: executor.steerText.bind(executor) }),
      async *execute(request, signal) {
        checkProtected(context.candidatePath);
        yield* executor.execute(request, signal);
        checkProtected(context.candidatePath);
        assertDevelopmentScope(context.candidatePath, policy, context.sourceRevision);
      }
    };
  };
}

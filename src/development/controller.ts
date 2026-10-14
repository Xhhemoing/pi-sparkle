import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId } from "../domain/ids.js";
import { readLoopArtifact } from "../execution/loop-artifact.js";
import { captureWorktreeFingerprint } from "../execution/worktree-snapshot.js";
import { runIndependentCheck } from "../execution/independent-check.js";
import { createIsolatedWorktree, disposeIsolatedWorktree } from "../execution/worktree.js";
import { prepareTrustedVerification } from "../execution/trusted-verification.js";
import { NativeWriteSession, type NativeWriteExecutorFactory, type NativeWriteSessionInput } from "../native/write-session.js";
import { prepareNativeWriteLoopLimits } from "../native/write-loop.js";
import type { AgentExecutor } from "../execution/contract.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import { ActionLedger, type ActionClaim, type ActionRecord } from "./action-ledger.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { canonicalizeStableJson } from "../domain/canonical-json.js";
import { WorkItemStore, type WorkItemVerificationContext } from "./work-item-store.js";
import { validateWorkItemEvidence, type WorkItemDefinition, type WorkItemEvidence, type WorkQueue } from "./work-items.js";

export interface DevelopmentControllerOptions {
  readonly sourceRepo: string;
  readonly queuePath: string;
  readonly stateRoot: string;
  readonly owner: string;
  readonly executorFactory?: NativeWriteExecutorFactory;
  readonly sandboxRoot?: string;
}
export interface DevelopmentResult {
  readonly status: "ready-for-review" | "blocked" | "no-ready-task" | "needs-reconciliation";
  readonly itemId?: string;
  readonly actionId?: string;
  readonly candidatePath?: string;
  readonly reason?: string;
}
interface EffectReceipt {
  readonly itemId: string;
  readonly claimToken: string;
  readonly sourceRevision: string;
  readonly candidatePath: string;
  readonly runId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly evidence: readonly WorkItemEvidence[];
}

function fail(reason: string): never { throw new DomainValidationError(`development controller: ${reason}`); }
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.error !== undefined || result.status !== 0) fail(`Git check failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function ancestor(cwd: string, base: string, current: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", base, current], { cwd, windowsHide: true }).status === 0;
}
function under(relative: string, scope: readonly string[]): boolean {
  return scope.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}
function protectedPaths(item: WorkItemDefinition): readonly string[] {
  return [...new Set(item.acceptance.flatMap((recipe) => recipe.protectedPaths ?? []))];
}
function assertRecipePolicy(item: WorkItemDefinition): void {
  for (const recipe of item.acceptance) {
    const first = recipe.args[0];
    const inlineNode = /^node(?:\.exe)?$/i.test(path.basename(recipe.command)) &&
      first !== undefined && (first === "-e" || first === "--eval" || first.startsWith("--eval="));
    if (!inlineNode && (recipe.protectedPaths?.length ?? 0) === 0) {
      fail(`recipe ${recipe.id} requires declared protected checker/dependency paths or fixed Node inline argv`);
    }
  }
}
function unchangedProtected(cwd: string, base: string, current: string, item: WorkItemDefinition): boolean {
  const paths = protectedPaths(item);
  return paths.length === 0 || spawnSync("git", ["diff", "--quiet", base, current, "--", ...paths],
    { cwd, windowsHide: true }).status === 0;
}
function assertScope(candidate: string, item: WorkItemDefinition): void {
  if (captureWorktreeFingerprint(candidate).entries.some((entry) => !under(entry.path, item.allowedScope) || under(entry.path, protectedPaths(item)))) {
    fail("candidate changed paths outside task scope or inside protected verifier dependencies");
  }
}
function verification(item: WorkItemDefinition) {
  assertRecipePolicy(item);
  const sourceMode = import.meta.url.endsWith(".ts");
  const suffix = sourceMode ? ".ts" : ".js";
  const checker = fileURLToPath(new URL(`./recipe-check${suffix}`, import.meta.url));
  const args = [...(sourceMode ? ["--import", import.meta.resolve("tsx")] : []), checker, JSON.stringify(item.acceptance)];
  const command = process.execPath;
  const trustedVerification = prepareTrustedVerification({ command, args,
    checkerFiles: [checker, fileURLToPath(new URL(`../execution/command-runner${suffix}`, import.meta.url)),
      fileURLToPath(new URL(`../domain/errors${suffix}`, import.meta.url))],
    snapshotManifest: { includePrefixes: [...new Set([...item.allowedScope, ...protectedPaths(item)])] },
    maxSnapshotFiles: 1024, maxSnapshotBytes: 16 * 1024 * 1024 });
  return { command, args, trustedVerification };
}
function parseReceipt(action: ActionRecord): EffectReceipt {
  if (action.resultCanonicalJson === undefined) fail("action has no completed effect receipt");
  const value: unknown = JSON.parse(action.resultCanonicalJson);
  if (value === null || typeof value !== "object") fail("action receipt is invalid");
  const result = value as Partial<EffectReceipt>;
  if (typeof result.itemId !== "string" || typeof result.claimToken !== "string" || typeof result.sourceRevision !== "string" ||
      typeof result.candidatePath !== "string" || typeof result.runId !== "string" || typeof result.accepted !== "boolean" ||
      typeof result.reason !== "string" || !Array.isArray(result.evidence)) fail("action receipt is incomplete");
  return result as EffectReceipt;
}

/** One host work item per call; acceptance/review and source application are separate. */
export class DevelopmentController {
  readonly store: WorkItemStore;
  readonly ledger: ActionLedger;
  private readonly options: DevelopmentControllerOptions;

  constructor(options: DevelopmentControllerOptions) {
    this.options = Object.freeze({ ...options, sourceRepo: path.resolve(options.sourceRepo),
      stateRoot: path.resolve(options.stateRoot), queuePath: path.resolve(options.queuePath) });
    this.ledger = new ActionLedger(path.join(path.dirname(this.options.queuePath), "actions"));
    this.store = new WorkItemStore(this.options.queuePath, {
      verifyEvidence: (evidence, context, signal) => this.verifyEvidence(evidence, context, signal),
      verificationTimeoutMs: 60_000
    });
  }

  async status(): Promise<{ queue: WorkQueue; actions: readonly ActionRecord[] }> {
    return { queue: await this.store.load(), actions: await this.ledger.list() };
  }
  next(): Promise<WorkItemDefinition | undefined> { return this.store.next(); }

  private async verifyIntegrated(item: WorkItemDefinition, revision: string, signal?: AbortSignal, protectedBase = revision): Promise<boolean> {
    if (!unchangedProtected(this.options.sourceRepo, protectedBase, revision, item)) return false;
    const sandboxRoot = path.join(runtimeRoot(this.options.stateRoot), "development", "checks");
    await mkdir(sandboxRoot, { recursive: true });
    const view = await createIsolatedWorktree({ sourceRepo: this.options.sourceRepo, sandboxRoot });
    try {
      if (git(view.cwd, ["rev-parse", "HEAD"]) !== revision) return false;
      const check = await runIndependentCheck({ cwd: view.cwd, ...verification(item),
        ...(signal === undefined ? {} : { signal }) });
      assertScope(view.cwd, item);
      return check.ok && git(this.options.sourceRepo, ["rev-parse", "HEAD"]) === revision;
    } finally {
      await disposeIsolatedWorktree(view);
    }
  }

  private async verifyEvidence(evidence: WorkItemEvidence, context: WorkItemVerificationContext, signal: AbortSignal): Promise<boolean> {
    const pieces = evidence.artifactRef.split("/");
    if (pieces.length !== 2) return false;
    const [runId, artifactId] = pieces as [string, string];
    const body = await readLoopArtifact(this.options.stateRoot, parseRunId(runId), artifactId);
    if (body === null || typeof body !== "object" || !("check" in body) || !("cwd" in body)) return false;
    const stored = body as { check: { checkId?: string; ok?: boolean }; cwd: unknown; revision?: string; args?: unknown };
    if (stored.check.checkId !== evidence.checkId || stored.check.ok !== true || typeof stored.cwd !== "string" ||
        stored.revision !== context.claim.baseRevision) return false;
    const candidate = physicalDirectoryWithoutLinks(stored.cwd);
    const source = physicalDirectoryWithoutLinks(this.options.sourceRepo);
    const currentSource = git(source, ["rev-parse", "HEAD"]);
    const candidateRevision = git(candidate, ["rev-parse", "HEAD"]);
    if (!ancestor(source, context.claim.baseRevision, currentSource) ||
        !ancestor(candidate, context.claim.baseRevision, candidateRevision) ||
        !unchangedProtected(candidate, context.claim.baseRevision, candidateRevision, context.item) ||
        path.resolve(candidate, git(candidate, ["rev-parse", "--git-common-dir"])) !==
        path.resolve(source, git(source, ["rev-parse", "--git-common-dir"]))) return false;
    // Once source advances, old acceptance only remains useful when the actual
    // integrated source satisfies the criterion. Candidate success alone does
    // not unlock dependent work against an unchanged source checkout.
    if (currentSource !== context.claim.baseRevision) return this.verifyIntegrated(
      { ...context.item, acceptance: [context.recipe] }, currentSource, signal, context.claim.baseRevision);
    assertScope(candidate, context.item);
    const check = await runIndependentCheck({ cwd: candidate,
      ...verification({ ...context.item, acceptance: [context.recipe] }), signal });
    assertScope(candidate, context.item);
    return check.ok && git(source, ["rev-parse", "HEAD"]) === currentSource;
  }

  async runNext(input: Pick<NativeWriteSessionInput, "maxAttempts" | "maxWallTimeMs" | "signal"> = {}): Promise<DevelopmentResult> {
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["maxAttempts", "maxWallTimeMs", "signal"].includes(key)) ||
        Object.values(Object.getOwnPropertyDescriptors(input)).some((property) => property.get !== undefined || property.set !== undefined)) {
      fail("run options contain unsupported fields or accessors");
    }
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) fail("run signal must be an AbortSignal");
    prepareNativeWriteLoopLimits(input);
    const options = Object.freeze({ ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.maxWallTimeMs === undefined ? {} : { maxWallTimeMs: input.maxWallTimeMs }),
      ...(input.signal === undefined ? {} : { signal: input.signal }) });
    if (options.signal?.aborted) fail("run cancelled before claiming work");
    if (this.options.executorFactory === undefined) fail("run requires a host executor factory");
    const sourceRevision = git(this.options.sourceRepo, ["rev-parse", "HEAD"]);
    const advisory = await this.store.next();
    if (advisory === undefined) return { status: "no-ready-task" };
    assertRecipePolicy(advisory);
    const pending = (await this.ledger.list()).find((action) => {
      if (action.kind !== "candidate-write" || !["running", "needs-reconciliation"].includes(action.state)) return false;
      const definition = JSON.parse(action.inputCanonicalJson) as { itemId?: unknown };
      return definition.itemId === advisory.id;
    });
    if (pending !== undefined) return { status: "needs-reconciliation", itemId: advisory.id, actionId: pending.actionId,
      reason: "an earlier effect remains running or uncertain; releasing a task claim does not authorize replay" };
    const beforeClaim = await this.store.load();
    for (const dependencyId of advisory.dependencies) {
      const dependency = beforeClaim.items.find((record) => record.definition.id === dependencyId)!;
      if (!await this.verifyIntegrated(dependency.definition, sourceRevision, options.signal, dependency.claim!.baseRevision)) return { status: "needs-reconciliation", itemId: advisory.id,
        reason: `dependency ${dependencyId} is accepted as a candidate but does not verify in the current source; integrate and reverify first` };
    }
    const selected = await this.store.claimNext({ owner: this.options.owner, baseRevision: sourceRevision });
    if (selected === undefined) return { status: "no-ready-task" };
    const queue = await this.store.load();
    let actionClaim: ActionClaim | undefined;
    let actionId: string | undefined;
    let candidatePath: string | undefined;
    try {
      assertRecipePolicy(selected.item);
      const unresolved = (await this.ledger.list()).find((action) => {
        if (action.kind !== "candidate-write" || !["running", "needs-reconciliation"].includes(action.state)) return false;
        return (JSON.parse(action.inputCanonicalJson) as { itemId?: unknown }).itemId === selected.item.id;
      });
      if (unresolved !== undefined) fail(`earlier effect ${unresolved.actionId} still requires reconciliation before another dispatch`);
      if (git(this.options.sourceRepo, ["rev-parse", "HEAD"]) !== selected.claim.baseRevision) fail("source changed after task claim");
      // claimNext can select a different item when another worker wins the
      // advisory selection race. Verify the dependencies actually claimed.
      for (const dependencyId of selected.item.dependencies) {
        const dependency = queue.items.find((record) => record.definition.id === dependencyId)!;
        if (!await this.verifyIntegrated(dependency.definition, sourceRevision, options.signal, dependency.claim!.baseRevision)) fail(`claimed dependency ${dependencyId} is not integrated in the current source`);
      }
      const action = await this.ledger.prepare({ idempotencyKey: `${queue.id}:${selected.item.id}:${selected.token}`,
        kind: "candidate-write", input: { queueId: queue.id, itemId: selected.item.id, claimToken: selected.token,
          sourceRepo: this.options.sourceRepo, sourceRevision, owner: this.options.owner, definition: selected.item } });
      actionId = action.actionId;
      actionClaim = await this.ledger.claim(action.actionId, action.version);
      const checker = verification(selected.item);
      const factory = this.options.executorFactory;
      const session = new NativeWriteSession({ stateRoot: this.options.stateRoot,
        ...(this.options.sandboxRoot === undefined ? {} : { sandboxRoot: this.options.sandboxRoot }),
        executorFactory: async (context) => {
          candidatePath = context.candidatePath;
          actionClaim = await this.ledger.checkpoint(actionClaim!, { evidence: { summary: "candidate allocated before worker dispatch",
            references: [candidatePath, context.sourceRevision] }, result: { candidatePath, sourceRevision: context.sourceRevision,
              itemId: selected.item.id, claimToken: selected.token } });
          const tools = context.tools.map((tool) => tool.name !== "sparkle_write_file" ? tool : {
            ...tool, execute: (id: string, raw: unknown, signal?: AbortSignal) => {
              const relative = raw !== null && typeof raw === "object" && "path" in raw ? (raw as { path: unknown }).path : undefined;
              if (typeof relative !== "string" || relative.includes("\\") || path.posix.isAbsolute(relative) ||
                  relative.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
                  !under(relative, selected.item.allowedScope) || under(relative, protectedPaths(selected.item))) fail("write outside task scope or into protected verifier dependency refused");
              return tool.execute(id, raw, signal);
            }
          });
          const executor = await factory({ ...context, tools });
          const guarded: AgentExecutor = {
            ...(executor.supportedModelIds === undefined ? {} : { supportedModelIds: executor.supportedModelIds }),
            ...(executor.steerText === undefined ? {} : { steerText: executor.steerText.bind(executor) }),
            async *execute(request, signal) {
              yield* executor.execute(request, signal);
              assertScope(context.candidatePath, selected.item);
            }
          };
          return guarded;
        }
      });
      let result;
      try {
        result = await session.execute({ sourceRepo: this.options.sourceRepo,
          objective: `${selected.item.goal}\n\nHost allowed write prefixes: ${selected.item.allowedScope.join(", ")}`,
          verification: { ...checker, repairableExitCodes: [1] }, acceptanceCriteria: selected.item.acceptance.map((recipe) => ({ id: recipe.id,
            description: `Host criterion ${recipe.id}`, observableCheck: `${recipe.command} ${recipe.args.join(" ")}`.slice(0, 512) })),
          ...options });
      } finally { await session.shutdown(); }
      assertScope(result.candidatePath, selected.item);
      const checkId = result.acceptance.independentCheck?.checkId;
      const evidence: WorkItemEvidence[] = result.acceptance.accepted && checkId !== undefined
        ? selected.item.acceptance.map((recipe) => ({ source: "host-command", workItemId: selected.item.id,
          baseRevision: sourceRevision, recipeId: recipe.id, verifierVersion: recipe.verifierVersion,
          command: recipe.command, args: [...recipe.args], artifactRef: `${result.runId}/${result.artifact.id}`, checkId, exitCode: 0 })) : [];
      const receipt: EffectReceipt = { itemId: selected.item.id, claimToken: selected.token, sourceRevision,
        candidatePath: result.candidatePath, runId: result.runId, accepted: result.acceptance.accepted, reason: result.reason, evidence };
      await this.ledger.complete(actionClaim!, { evidence: { summary: "native development effect completed",
        references: [result.artifact.path, result.candidatePath] }, result: receipt });
      if (!result.acceptance.accepted) {
        await this.store.block(selected.item.id, selected.token, result.reason);
        return { status: "blocked", itemId: selected.item.id, actionId, candidatePath: result.candidatePath, reason: result.reason };
      }
      await this.store.markReady(selected.item.id, selected.token, git(this.options.sourceRepo, ["rev-parse", "HEAD"]), evidence);
      return { status: "ready-for-review", itemId: selected.item.id, actionId, candidatePath: result.candidatePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // A settled action may only need the queue transition recovered. Do not
      // rerun it, and do not overwrite the original completed receipt.
      const action = actionId === undefined ? undefined : await this.ledger.get(actionId);
      if (action?.state === "completed") return { status: "needs-reconciliation", itemId: selected.item.id,
        ...(actionId === undefined ? {} : { actionId }), ...(candidatePath === undefined ? {} : { candidatePath }), reason };
      if (actionClaim !== undefined) await this.ledger.markUncertain(actionClaim, { evidence: {
        summary: reason.slice(0, 2048), references: [candidatePath ?? this.options.sourceRepo] } });
      await this.store.block(selected.item.id, selected.token, reason.slice(0, 2048));
      return { status: "blocked", itemId: selected.item.id, ...(actionId === undefined ? {} : { actionId }),
        ...(candidatePath === undefined ? {} : { candidatePath }), reason };
    }
  }

  async accept(itemId: string): Promise<void> {
    const queue = await this.store.load();
    const record = queue.items.find((item) => item.definition.id === itemId);
    if (record?.claim === undefined) fail("task has no reviewable claim");
    await this.store.accept(itemId, record.claim.token, git(this.options.sourceRepo, ["rev-parse", "HEAD"]));
  }

  /** Complete a missing queue transition from an already completed effect. */
  async reconcile(actionId: string): Promise<DevelopmentResult> {
    const action = await this.ledger.get(actionId);
    if (action === undefined || action.state !== "completed") return { status: "needs-reconciliation", actionId,
      reason: "unknown/running effects require explicit stopped-worker actual-state reconciliation; no replay performed" };
    const result = parseReceipt(action);
    const queue = await this.store.load();
    const item = queue.items.find((record) => record.definition.id === result.itemId);
    if (item?.claim?.token !== result.claimToken) fail("completed receipt has a stale task claim");
    const input: unknown = JSON.parse(action.inputCanonicalJson);
    if (input === null || typeof input !== "object") fail("action input binding is invalid");
    const binding = input as Record<string, unknown>;
    if (binding.queueId !== queue.id || binding.itemId !== result.itemId || binding.claimToken !== result.claimToken ||
        binding.sourceRepo !== this.options.sourceRepo || binding.sourceRevision !== result.sourceRevision ||
        result.sourceRevision !== item.claim.baseRevision || canonicalizeStableJson(binding.definition) !== canonicalizeStableJson(item.definition)) {
      fail("completed receipt does not match the original action/task definition");
    }
    if (!result.accepted) {
      if (item.status === "running") await this.store.block(result.itemId, result.claimToken, result.reason);
      return { status: "blocked", itemId: result.itemId, actionId, candidatePath: result.candidatePath, reason: result.reason };
    }
    let boundEvidence: readonly WorkItemEvidence[];
    try { boundEvidence = validateWorkItemEvidence(result.evidence, item.definition, item.claim, item.claim.baseRevision); }
    catch (error) { fail(`completed receipt evidence invalid: ${error instanceof Error ? error.message : String(error)}`); }
    for (const evidence of boundEvidence) {
      const [runId, artifactId] = evidence.artifactRef.split("/");
      if (runId !== result.runId || artifactId === undefined) fail("receipt run/evidence binding mismatch");
      const body = await readLoopArtifact(this.options.stateRoot, parseRunId(runId), artifactId);
      if (body === null || typeof body !== "object" || !("cwd" in body) || body.cwd !== result.candidatePath) {
        fail("receipt candidate/evidence binding mismatch");
      }
    }
    if (item.status === "running") await this.store.markReady(result.itemId, result.claimToken,
      git(this.options.sourceRepo, ["rev-parse", "HEAD"]), boundEvidence);
    else if (item.status === "ready-for-review" || item.status === "accepted") {
      for (const evidence of boundEvidence) {
        const recipe = item.definition.acceptance.find((entry) => entry.id === evidence.recipeId);
        if (recipe === undefined || !await this.verifyEvidence(evidence, { item: item.definition, claim: item.claim, recipe }, new AbortController().signal)) {
          fail("completed receipt evidence no longer verifies");
        }
      }
    } else fail("completed receipt task needs explicit host recovery");
    return { status: "ready-for-review", itemId: result.itemId, actionId, candidatePath: result.candidatePath };
  }
}

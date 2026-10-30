import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { taskRunCommand } from "./task-run.js";
import { parseTaskModelSelectionAuthority } from "../domain/task-model-selection.js";
import { DomainValidationError } from "../domain/errors.js";
import { readWorktreeRevision } from "../execution/worktree.js";
import type { ResourceRegistry } from "../lab/adaptation/registry.js";
import { verifyMaterializedTaskResources } from "../lab/adaptation/task-resources.js";

function fail(message: string): never { throw new DomainValidationError(`real-task execution: ${message}`); }
function physicalComparisonPath(value: string): string {
  let result = path.resolve(value);
  try { result = realpathSync.native(result); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return process.platform === "win32" ? result.toLowerCase() : result;
}
function hasGitMetadata(directory: string): boolean {
  for (let current = realpathSync.native(directory); ; current = path.dirname(current)) {
    try { lstatSync(path.join(current, ".git")); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const metadata = (name: string) => {
      try { return lstatSync(path.join(current, name)); }
      catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        return undefined;
      }
    };
    const head = metadata("HEAD"), config = metadata("config");
    const objectLayout = metadata("objects/info")?.isDirectory() && metadata("objects/pack")?.isDirectory();
    const refsLayout = metadata("refs/heads")?.isDirectory() && metadata("refs/tags")?.isDirectory();
    if ((objectLayout && (refsLayout || head?.isFile() || config?.isFile())) ||
        (refsLayout && (head?.isFile() || config?.isFile()))) return true;
    if (path.dirname(current) === current) return false;
  }
}
function gitCommonDirectory(directory: string, logicalProject = false): string | undefined {
  try {
    if (!statSync(directory).isDirectory()) fail("Git identity path must be a directory");
  } catch (error) {
    if (logicalProject && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--git-common-dir"], {
    encoding: "utf8", windowsHide: true, timeout: 10_000, env: { ...process.env, LC_ALL: "C" }
  });
  if (result.error !== undefined) fail(`cannot inspect Git identity: ${result.error.message}`);
  if (result.status !== 0) {
    if (logicalProject && result.status === 128 && /^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/.test(result.stderr) && !hasGitMetadata(directory)) return undefined;
    fail("cannot inspect Git identity; isolation is unknown");
  }
  if (result.stdout.trim() === "") fail("Git common directory is missing; isolation is unknown");
  const common = realpathSync.native(path.resolve(directory, result.stdout.trim()));
  return process.platform === "win32" ? common.toLowerCase() : common;
}
export function prepareMaterializedTaskExecution(input: {
  readonly registry: ResourceRegistry; readonly projectRoot: string; readonly sourceRepo: string; readonly materialized: unknown; readonly authority: unknown;
}) {
  const materialized = verifyMaterializedTaskResources(input.registry, input.materialized);
  if (path.resolve(input.projectRoot) !== path.resolve(materialized.projectRoot)) fail("project binding mismatch");
  if (physicalComparisonPath(input.sourceRepo) === physicalComparisonPath(input.projectRoot)) fail("real-task execution requires an explicitly selected isolated source, separate from the logical project");
  const sourceCommonDirectory = gitCommonDirectory(input.sourceRepo), projectCommonDirectory = gitCommonDirectory(input.projectRoot, true);
  if (projectCommonDirectory !== undefined && sourceCommonDirectory === projectCommonDirectory) fail("real-task execution requires an independent source repository; shared Git common storage is not isolated");
  if (materialized.resources.length !== 1 || materialized.resources[0]!.topic !== "model-thinking" || materialized.modelSelection === undefined) fail("explicit execution supports one fixed model-thinking resource only");
  const binding = materialized.resources[0]!;
  if (input.registry.getActiveVersion(binding.identity)?.versionId !== binding.versionId) fail("materialized version is no longer active; review and materialize again explicitly");
  if ((materialized.spec.worker.maxAttempts ?? 1) !== 1) fail("fixed-profile evidence currently supports single-attempt tasks only");
  const usd = materialized.spec.budget.usd;
  if (usd === undefined || usd <= 0 || usd > 5) fail("an explicit reference budget of at most US$5 is required");
  if (readWorktreeRevision(input.sourceRepo) !== materialized.sourceRevision) fail("committed source revision changed");
  const authority = parseTaskModelSelectionAuthority(input.authority), selection = materialized.modelSelection;
  if (!authority.approvedSelections.some(value => value.providerId === selection.providerId && value.modelId === selection.modelId && value.thinkingLevel === selection.thinkingLevel)) fail("fixed recipe is outside host-approved selections");
  return Object.freeze({ spec: materialized.spec, expectedSourceRevision: materialized.sourceRevision, modelSelection: Object.freeze({ selection, authority }) });
}
/** Explicit host operation only. Uses original strict cost, cancellation, sink and lifecycle handling. */
export async function executeMaterializedTaskResources(input: Parameters<typeof prepareMaterializedTaskExecution>[0] & {
  readonly stateRoot: string; readonly io: { stdout(text: string): void; stderr(text: string): void }; readonly signal?: AbortSignal;
}): Promise<number> {
  input.signal?.throwIfAborted();
  const prepared = prepareMaterializedTaskExecution(input), directory = await mkdtemp(path.join(tmpdir(), "pi-real-task-input-"));
  try {
    const file = path.join(directory, "task.json");
    await writeFile(file, JSON.stringify(prepared.spec), { encoding: "utf8", flag: "wx" });
    return await taskRunCommand(["run", file, "--project", path.resolve(input.sourceRepo), "--executor", "pi", "--state-root", path.resolve(input.stateRoot), "--json"], input.io,
      { modelSelection: prepared.modelSelection, expectedSourceRevision: prepared.expectedSourceRevision, ...(input.signal === undefined ? {} : { signal: input.signal }) });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

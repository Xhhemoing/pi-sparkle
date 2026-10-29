import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
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
export function prepareMaterializedTaskExecution(input: {
  readonly registry: ResourceRegistry; readonly projectRoot: string; readonly sourceRepo: string; readonly materialized: unknown; readonly authority: unknown;
}) {
  const materialized = verifyMaterializedTaskResources(input.registry, input.materialized);
  if (path.resolve(input.projectRoot) !== path.resolve(materialized.projectRoot)) fail("project binding mismatch");
  if (physicalComparisonPath(input.sourceRepo) === physicalComparisonPath(input.projectRoot)) fail("real-task execution requires an explicitly selected isolated source, separate from the logical project");
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

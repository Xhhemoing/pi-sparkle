import { lstat, mkdir, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { defaultEvalDatasetDir, evalDatasetsRoot } from "./state-layout.js";

/**
 * The default `adapt dataset` path is derived from the run id so that
 * `delete --run` can cascade into it without searching the filesystem for
 * manifests. That derivation is a *lexical* path, and a lexical path is not an
 * identity: if the `<runId>` leaf is a symlink, the export writes through it
 * and the delete unlinks it.
 *
 * The two halves used to disagree about which of those a path is. The exporter
 * canonicalized the directory for its isolation checks and then published
 * `manifest.json` through the alias, so the redacted objective excerpt and the
 * redacted project root landed wherever the link pointed. The delete then
 * `stat`ed the same path (which follows the link, so the dataset "existed"),
 * `rm`ed the lexical path (which does not, so only the alias went), and
 * reported the default directory as removed. The derivative survived at the
 * target under a name no cascade can rediscover, and nothing warned: the
 * external-export warning only fires for `--dir`, which the operator never
 * passed.
 *
 * So both halves ask the same question here, with `lstat` rather than `stat`:
 * what *is* the leaf, not what does it point at.
 *
 *  - Export binds instead of checking: the container is resolved, the leaf is
 *    created with a non-recursive `mkdir` (which never follows or adopts a
 *    final symlink), and the binding is re-asserted after the publish so a
 *    swap into the write window is caught rather than silently honoured.
 *  - Delete refuses. It cannot follow the alias — removing an operator's
 *    external directory because a link pointed at it is not a cascade, it is
 *    collateral — and it must not unlink the alias and call that a delete. So
 *    it fails loudly with the target named, and the operator resolves it.
 *
 * A `--dir` export is untouched by all of this: the operator named that path,
 * it is external by construction, and it keeps the existing warning that no
 * delete cascades into it.
 */
export const EVAL_DATASET_ALIAS_CODE = "EVAL_DATASET_ALIAS" as const;

/** Which half hit the alias, so the message can say what did not happen. */
export type EvalDatasetAliasStage = "export" | "publish" | "delete";

/**
 * The default eval-dataset path for a run is not a directory this state root
 * owns. Discriminate on `code`, never on the message.
 */
export class EvalDatasetAliasError extends DomainValidationError {
  readonly code = EVAL_DATASET_ALIAS_CODE;
  readonly stage: EvalDatasetAliasStage;
  /** The lexical default path, i.e. the alias itself. */
  readonly datasetDir: string;
  /** What the leaf points at, as written; `undefined` when it is not a symlink. */
  readonly linkTarget: string | undefined;

  constructor(
    message: string,
    stage: EvalDatasetAliasStage,
    datasetDir: string,
    linkTarget: string | undefined
  ) {
    super(message);
    this.name = "EvalDatasetAliasError";
    this.stage = stage;
    this.datasetDir = datasetDir;
    this.linkTarget = linkTarget;
  }
}

function aliasError(
  stage: EvalDatasetAliasStage,
  runId: string,
  datasetDir: string,
  linkTarget: string | undefined,
  resolved: string | undefined
): EvalDatasetAliasError {
  const points =
    linkTarget === undefined
      ? `does not resolve to itself${resolved === undefined ? "" : ` (it resolves to ${resolved})`}`
      : `is a symlink to ${linkTarget}${resolved === undefined || resolved === linkTarget ? "" : ` (resolving to ${resolved})`}`;
  const where = resolved ?? linkTarget ?? "the link target";
  const consequence =
    stage === "delete"
      ? `Removing it would unlink the alias and leave the exported manifest — a redacted excerpt of every routed task objective plus the redacted project root — on disk at ${where}, so reporting this delete as successful would be a false claim. Nothing was removed.`
      : `Publishing through it would write the exported manifest — a redacted excerpt of every routed task objective plus the redacted project root — to ${where}, outside the adaptation plane and outside the cascade delete --run performs. Nothing was exported.`;
  const swapped =
    stage === "publish"
      ? " The leaf was a real directory when the export bound to it and had been replaced by the time the manifest was published, so the bytes were written to the target and this export has removed them again on a best-effort basis; check the target."
      : "";
  return new EvalDatasetAliasError(
    `run:${runId}: the default eval-dataset path ${datasetDir} ${points}, not a directory under this state root. ${consequence}${swapped} Inspect ${where}, delete whatever derivative is there yourself, then remove ${datasetDir} and re-run. Pass adapt dataset --dir <path> if an external export is what you meant; that path is warned about at export time and is deliberately not cascaded by delete --run ${runId}.`,
    stage,
    datasetDir,
    linkTarget
  );
}

function ignoreMissing(error: NodeJS.ErrnoException): undefined {
  if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
  throw error;
}

/** The literal link text, for the message; `undefined` when it cannot be read. */
async function linkTextOf(path: string): Promise<string | undefined> {
  return readlink(path).catch(() => undefined);
}

/** Where the path actually lands, or `undefined` for a dangling link. */
async function resolvedTargetOf(path: string): Promise<string | undefined> {
  return realpath(path).catch(() => undefined);
}

/**
 * Refuse when the `<runId>` leaf of the default export path is a symlink.
 *
 * `lstat` is the point: `stat` follows, and following is exactly how the
 * delete convinced itself a derivative it was about to orphan was present.
 * An absent leaf is not an alias, and neither is a real directory.
 */
export async function assertDefaultEvalDatasetNotAliased(
  stateRoot: string,
  runId: string,
  stage: EvalDatasetAliasStage
): Promise<void> {
  const datasetDir = defaultEvalDatasetDir(stateRoot, runId);
  const leaf = await lstat(datasetDir).catch(ignoreMissing);
  if (leaf === undefined || !leaf.isSymbolicLink()) return;
  throw aliasError(
    stage,
    runId,
    datasetDir,
    await linkTextOf(datasetDir),
    await resolvedTargetOf(datasetDir)
  );
}

/**
 * Assert that the default dataset directory resolves to exactly its own name
 * under the canonicalized eval-datasets container.
 *
 * This is the binding a publish needs, and it is stricter than "the leaf is
 * not a symlink": it also rejects a leaf that resolves out of the container
 * some other way. The container itself is canonicalized rather than required
 * to be link-free — an operator who relocates the whole `eval-datasets` root
 * keeps a working cascade, because `delete --run`'s `rm` traverses the same
 * directory components.
 */
async function assertBoundToDatasetRoot(
  stateRoot: string,
  runId: string,
  stage: EvalDatasetAliasStage
): Promise<void> {
  await assertDefaultEvalDatasetNotAliased(stateRoot, runId, stage);
  const datasetDir = defaultEvalDatasetDir(stateRoot, runId);
  const canonicalRoot = await realpath(evalDatasetsRoot(stateRoot));
  const resolved = await realpath(datasetDir);
  if (resolved === join(canonicalRoot, runId)) return;
  throw aliasError(stage, runId, datasetDir, undefined, resolved);
}

/**
 * Create the default dataset directory bound to the canonical eval-datasets
 * root, and return the lexical path the delete cascade also names.
 *
 * The leaf is created with a non-recursive `mkdir`, which is the whole trick:
 * it either makes a real directory or fails `EEXIST`, and it never resolves a
 * final symlink into a write somewhere else. A recursive `mkdir` — which is
 * what `writeFileAtomic` does for the manifest's parent — happily succeeds
 * through an existing alias, which is how the publish used to escape.
 */
export async function bindDefaultEvalDatasetDir(
  stateRoot: string,
  runId: string
): Promise<string> {
  await assertDefaultEvalDatasetNotAliased(stateRoot, runId, "export");
  await mkdir(evalDatasetsRoot(stateRoot), { recursive: true });
  await mkdir(defaultEvalDatasetDir(stateRoot, runId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  await assertBoundToDatasetRoot(stateRoot, runId, "export");
  return defaultEvalDatasetDir(stateRoot, runId);
}

/**
 * Re-assert the binding after the manifest has been published.
 *
 * `bindDefaultEvalDatasetDir` cannot hold the leaf open across the write —
 * Node exposes no directory-relative publish — so the honest close is to
 * check again and fail loudly if the target moved, rather than to check once
 * and describe the result as a guarantee.
 */
export async function assertDefaultEvalDatasetPublished(
  stateRoot: string,
  runId: string
): Promise<void> {
  await assertBoundToDatasetRoot(stateRoot, runId, "publish");
}

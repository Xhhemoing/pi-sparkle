import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
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
 *
 *    A name is not an identity either, so that re-assertion compares the
 *    *directory*, not the pathname. Comparing canonical pathnames only —
 *    `realpath(leaf) === join(realpath(container), runId)` — accepts a
 *    different real directory created at the same lexical path while the
 *    manifest was being published, which returned a `manifestPath` that did
 *    not contain the manifest.
 *
 *    Identity at the two endpoints is not that claim either. The bound
 *    directory can be moved aside, a replacement can take the publish, and the
 *    original can be moved back before the re-assertion reads it — the same
 *    `dev`/`ino`, the same witness, and an empty directory at the returned
 *    path. So the re-assertion also looks for the manifest itself inside the
 *    directory it just proved the identity of: the claim being made is that
 *    the returned path holds the export, and only the file can attest to that.
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

/**
 * The file a default export publishes, named once so the exporter and the
 * post-publish check cannot come to disagree about which file the returned
 * path is claiming to hold.
 */
export const EVAL_DATASET_MANIFEST_FILE = "manifest.json" as const;

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

/**
 * Why the leaf is not the directory this state root bound.
 *
 * The first two are *aliasing*: the path leads somewhere else, so bytes
 * published through it land off-plane. The last four are *identity*: the path
 * leads nowhere useful, or to a directory that is not the one this call wrote
 * into, or to the right directory with the manifest missing from it, so the
 * bytes are not where the returned path says they are.
 */
type AliasFinding =
  | {
      readonly kind: "symlink";
      readonly linkTarget: string;
      readonly resolved: string | undefined;
    }
  | { readonly kind: "escaped"; readonly resolved: string | undefined }
  | { readonly kind: "not-a-directory" }
  | { readonly kind: "missing" }
  | { readonly kind: "replaced" }
  | { readonly kind: "unpublished"; readonly manifestFile: string; readonly present: boolean };

/** How the leaf reads in a sentence, and the place worth inspecting. */
function describeFinding(finding: AliasFinding, datasetDir: string): [string, string] {
  switch (finding.kind) {
    case "symlink": {
      const trailer =
        finding.resolved === undefined || finding.resolved === finding.linkTarget
          ? ""
          : ` (resolving to ${finding.resolved})`;
      return [
        `is a symlink to ${finding.linkTarget}${trailer}, not a directory under this state root`,
        finding.resolved ?? finding.linkTarget
      ];
    }
    case "escaped":
      return [
        `does not resolve to itself${finding.resolved === undefined ? "" : ` (it resolves to ${finding.resolved})`}, not a directory under this state root`,
        finding.resolved ?? datasetDir
      ];
    case "not-a-directory":
      return ["exists but is not a directory", datasetDir];
    case "missing":
      return ["no longer exists", datasetDir];
    case "replaced":
      return ["is a different directory from the one this export bound to", datasetDir];
    case "unpublished":
      return [
        finding.present
          ? `is the directory this export bound to, but ${finding.manifestFile} inside it is not a regular file`
          : `is the directory this export bound to, but holds no ${finding.manifestFile}`,
        datasetDir
      ];
  }
}

const MANIFEST_CONTENTS =
  "a redacted excerpt of every routed task objective plus the redacted project root";

function aliasError(
  stage: EvalDatasetAliasStage,
  runId: string,
  datasetDir: string,
  finding: AliasFinding
): EvalDatasetAliasError {
  const [points, where] = describeFinding(finding, datasetDir);
  const linkTarget = finding.kind === "symlink" ? finding.linkTarget : undefined;
  const detail =
    finding.kind === "symlink" || finding.kind === "escaped"
      ? offPlaneDetail(stage, runId, datasetDir, where)
      : identityDetail(datasetDir, finding);
  return new EvalDatasetAliasError(
    `run:${runId}: the default eval-dataset path ${datasetDir} ${points}. ${detail}`,
    stage,
    datasetDir,
    linkTarget
  );
}

/** The leaf leads outside the plane: say where the bytes could have gone. */
function offPlaneDetail(
  stage: EvalDatasetAliasStage,
  runId: string,
  datasetDir: string,
  where: string
): string {
  const consequence =
    stage === "delete"
      ? `Removing it would unlink the alias and leave the exported manifest — ${MANIFEST_CONTENTS} — on disk at ${where}, so reporting this delete as successful would be a false claim. Nothing was removed.`
      : `Publishing through it would write the exported manifest — ${MANIFEST_CONTENTS} — to ${where}, outside the adaptation plane and outside the cascade delete --run performs. Nothing was exported.`;
  const swapped =
    stage === "publish"
      ? " The leaf was a real directory when the export bound to it and had been replaced by the time the manifest was published, so the bytes were written to the target and this export has removed them again on a best-effort basis; check the target."
      : "";
  return `${consequence}${swapped} Inspect ${where}, delete whatever derivative is there yourself, then remove ${datasetDir} and re-run. Pass adapt dataset --dir <path> if an external export is what you meant; that path is warned about at export time and is deliberately not cascaded by delete --run ${runId}.`;
}

/**
 * The leaf is no longer the directory the bind accepted, or it is that
 * directory and the manifest is not in it.
 *
 * Take-back can only reach the lexical path, and the directory that received
 * the bytes has been moved or removed out from under it — so the honest thing
 * to report is that this export cannot name it, rather than to name a place
 * the operator would find empty.
 */
function identityDetail(
  datasetDir: string,
  finding: { readonly kind: "not-a-directory" | "missing" | "replaced" | "unpublished" }
): string {
  if (finding.kind === "not-a-directory") {
    return `Nothing was exported: the default export publishes into a directory this state root owns, and ${datasetDir} is not one. Remove or rename whatever is at ${datasetDir} and re-run.`;
  }
  if (finding.kind === "unpublished") {
    // The directory at the lexical path is the bound one — identity already
    // proved that — so the manifest did not land in it: something took the
    // publish at this name and left with it. Same honesty as `replaced`, and
    // the same refusal to go looking.
    return `This export published the manifest — ${MANIFEST_CONTENTS} — at ${datasetDir}, and it is not there now, so the directory that took the write was not the one at this path when the publish finished. Take-back reaches only what is still at ${datasetDir}; this export cannot name where the manifest went, and it does not search the filesystem for it. Nothing was exported, and no path is returned. Find the displaced directory yourself, delete the derivative inside it, then re-run.`;
  }
  return `This export published the manifest — ${MANIFEST_CONTENTS} — into the directory that was at ${datasetDir} when it bound to that directory, and the directory was moved or replaced before the publish finished. Take-back reaches only what is still at ${datasetDir}; this export cannot name where the rest went, and it does not search the filesystem for it. Nothing was exported. Find the displaced directory yourself, delete the derivative inside it, then remove ${datasetDir} and re-run.`;
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

/** The symlink finding, or the `escaped` wording when the link text is unreadable. */
async function symlinkFinding(datasetDir: string): Promise<AliasFinding> {
  const resolved = await resolvedTargetOf(datasetDir);
  const linkTarget = await linkTextOf(datasetDir);
  return linkTarget === undefined
    ? { kind: "escaped", resolved }
    : { kind: "symlink", linkTarget, resolved };
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
  throw aliasError(stage, runId, datasetDir, await symlinkFinding(datasetDir));
}

/**
 * Assert that the default dataset directory is a real directory resolving to
 * exactly its own name under the canonicalized eval-datasets container, and
 * return the `lstat` that proved it.
 *
 * This is the binding a publish needs, and it is stricter than "the leaf is
 * not a symlink": the leaf must exist, must be a directory rather than a file
 * the manifest write would fail against, and must not resolve out of the
 * container some other way. The container itself is canonicalized rather than
 * required to be link-free — an operator who relocates the whole
 * `eval-datasets` root keeps a working cascade, because `delete --run`'s `rm`
 * traverses the same directory components.
 */
async function assertBoundToDatasetRoot(
  stateRoot: string,
  runId: string,
  stage: EvalDatasetAliasStage
): Promise<BigIntStats> {
  const datasetDir = defaultEvalDatasetDir(stateRoot, runId);
  const leaf = await lstat(datasetDir, { bigint: true }).catch(ignoreMissing);
  if (leaf === undefined) throw aliasError(stage, runId, datasetDir, { kind: "missing" });
  if (leaf.isSymbolicLink()) {
    throw aliasError(stage, runId, datasetDir, await symlinkFinding(datasetDir));
  }
  if (!leaf.isDirectory()) {
    throw aliasError(stage, runId, datasetDir, { kind: "not-a-directory" });
  }
  const canonicalRoot = await realpath(evalDatasetsRoot(stateRoot));
  const resolved = await realpath(datasetDir);
  if (resolved !== join(canonicalRoot, runId)) {
    throw aliasError(stage, runId, datasetDir, { kind: "escaped", resolved });
  }
  return leaf;
}

/**
 * Which directory the bind accepted, in a form a later `lstat` can be checked
 * against.
 *
 * `inode` is the answer wherever the platform has one: `dev`/`ino` read
 * through `lstat`'s bigint form, which is allocated by the filesystem and
 * cannot be chosen by a directory created afterwards at the same name. The
 * bigint form matters because a 64-bit inode number does not survive a
 * `number`, and two directories whose ids differ only past 2^53 would compare
 * equal.
 *
 * `witness` is the fallback for the platforms that report no id at all —
 * `ino === 0n`, which libuv can return on Windows volumes and network shares
 * that expose no file index. There the bind drops a uniquely named empty file
 * *inside* the directory it bound and looks for it again after the publish: a
 * replacement directory created at the same path during the write cannot
 * contain a name this call invented, and the file is removed as soon as the
 * check has read it.
 */
export type EvalDatasetDirIdentity =
  | { readonly kind: "inode"; readonly dev: bigint; readonly ino: bigint }
  | { readonly kind: "witness"; readonly file: string };

/** The bound leaf: the lexical path the delete cascade names, plus its identity. */
export interface BoundEvalDatasetDir {
  readonly path: string;
  readonly identity: EvalDatasetDirIdentity;
}

/** Owner-only, like everything else this directory holds. */
const WITNESS_FILE_MODE = 0o600;

async function captureIdentity(
  datasetDir: string,
  leaf: BigIntStats
): Promise<EvalDatasetDirIdentity> {
  if (leaf.ino !== 0n) return { kind: "inode", dev: leaf.dev, ino: leaf.ino };
  const file = join(datasetDir, `.pi-sparkle-bind-${randomUUID()}`);
  // "wx" so a name collision is an error rather than an adoption of someone
  // else's file, which would make the witness prove nothing.
  await writeFile(file, "", { flag: "wx", mode: WITNESS_FILE_MODE });
  return { kind: "witness", file };
}

/**
 * Create the default dataset directory bound to the canonical eval-datasets
 * root, and return the binding: the lexical path the delete cascade also
 * names, and the identity of the directory now sitting at it.
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
): Promise<BoundEvalDatasetDir> {
  await assertDefaultEvalDatasetNotAliased(stateRoot, runId, "export");
  await mkdir(evalDatasetsRoot(stateRoot), { recursive: true });
  const datasetDir = defaultEvalDatasetDir(stateRoot, runId);
  await mkdir(datasetDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const leaf = await assertBoundToDatasetRoot(stateRoot, runId, "export");
  return { path: datasetDir, identity: await captureIdentity(datasetDir, leaf) };
}

/**
 * Re-assert the binding after the manifest has been published, against the
 * directory `bindDefaultEvalDatasetDir` actually accepted, and against the
 * manifest that publish was supposed to leave inside it.
 *
 * `bindDefaultEvalDatasetDir` cannot hold the leaf open across the write —
 * Node exposes no directory-relative publish — so the honest close is to
 * check again and fail loudly if the target moved, rather than to check once
 * and describe the result as a guarantee.
 *
 * "The same path" is not that check. A fresh real directory created at
 * `<runId>` while the manifest was being written has the same canonical
 * pathname as the one that received the bytes, so pathname equality passed and
 * the export returned a `manifestPath` that held nothing. The binding is
 * compared instead.
 *
 * "The same directory" is not the whole check either, because identity read at
 * two endpoints says nothing about the interval between them. Move the bound
 * directory aside, let a replacement at `<runId>` take the publish, move the
 * replacement away with the manifest in it and put the original back: `dev`,
 * `ino` and the witness all match, and the returned `manifestPath` does not
 * exist. So the last question is the one the caller's return value actually
 * claims — is the manifest in this directory — asked with `lstat`, which
 * refuses a symlink standing in for the file just as it does for the leaf.
 */
export async function assertDefaultEvalDatasetPublished(
  stateRoot: string,
  runId: string,
  bound: BoundEvalDatasetDir
): Promise<void> {
  const leaf = await assertBoundToDatasetRoot(stateRoot, runId, "publish");
  if (!(await isBoundDirectory(bound.identity, leaf))) {
    throw aliasError("publish", runId, bound.path, { kind: "replaced" });
  }
  // Inside the directory just proved to be the bound one, by the same lexical
  // path the caller is about to return. No search for the directory that may
  // have taken the write instead: this call can only speak for what is here.
  const manifest = await lstat(join(bound.path, EVAL_DATASET_MANIFEST_FILE)).catch(ignoreMissing);
  if (manifest !== undefined && manifest.isFile()) return;
  throw aliasError("publish", runId, bound.path, {
    kind: "unpublished",
    manifestFile: EVAL_DATASET_MANIFEST_FILE,
    present: manifest !== undefined
  });
}

async function isBoundDirectory(
  identity: EvalDatasetDirIdentity,
  leaf: BigIntStats
): Promise<boolean> {
  if (identity.kind === "inode") return leaf.dev === identity.dev && leaf.ino === identity.ino;
  const witness = await lstat(identity.file).catch(ignoreMissing);
  // Removed either way: on the success path it has done its job, and on the
  // failure path the name is this call's own invention, so the worst case is a
  // no-op against a directory that never had it.
  await rm(identity.file, { force: true }).catch(() => undefined);
  return witness !== undefined && witness.isFile();
}

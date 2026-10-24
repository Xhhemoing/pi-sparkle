import { hash32 } from "../domain/hash.js";

/**
 * Folds only the case-ambiguous volume prefix of a normalized path: a drive
 * letter (`C:`) or the `//host/share` UNC prefix. Everything after the prefix
 * keeps its case, because on case-sensitive filesystems two paths that differ
 * only by case are two distinct projects (TASK-20261001-ps02).
 */
function foldCaseAmbiguousPrefix(normalized: string): string {
  const drive = /^([a-zA-Z]:)([\\/]|$)/.exec(normalized);
  if (drive !== null) {
    const prefix = drive[1]!;
    return `${prefix.toLowerCase()}${normalized.slice(prefix.length)}`;
  }
  const unc = /^(\/\/[^/]+\/[^/]+)([\\/]|$)/.exec(normalized);
  if (unc !== null) {
    const prefix = unc[1]!;
    return `${prefix.toLowerCase()}${normalized.slice(prefix.length)}`;
  }
  return normalized;
}

export function stableProjectKey(projectRoot: string): string {
  const normalized = foldCaseAmbiguousPrefix(
    projectRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  );
  return `p${hash32(normalized)}`;
}

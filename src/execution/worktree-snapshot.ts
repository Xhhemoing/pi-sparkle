import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DomainValidationError } from "../domain/errors.js";
import { readWorktreeRevision } from "./worktree.js";

/** Host-fixed candidate scope for fingerprinting. Model cannot reshape this. */
export interface SnapshotManifest {
  /** Relative path prefixes included (empty = whole worktree except .git). */
  readonly includePrefixes?: readonly string[];
  /** Relative path prefixes excluded (always includes .git). */
  readonly excludePrefixes?: readonly string[];
  /**
   * Relative dirs where check-generated outputs may appear without failing
   * before/after equality (still recorded when present before the check).
   */
  readonly allowedOutputDirs?: readonly string[];
}

export type FingerprintEntryKind = "modified" | "deleted" | "untracked" | "added";

export interface FingerprintEntry {
  readonly path: string;
  readonly kind: FingerprintEntryKind;
  /** Content sha256; null for deleted paths. */
  readonly sha256: string | null;
}

export const WORKTREE_FINGERPRINT_SCHEMA = "g1a-v1" as const;

export interface WorktreeFingerprint {
  readonly schemaVersion: typeof WORKTREE_FINGERPRINT_SCHEMA;
  readonly headRevision: string;
  readonly entries: readonly FingerprintEntry[];
  /** sha256 of canonical entry serialization (stable order). */
  readonly digest: string;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isExcluded(rel: string, manifest: SnapshotManifest): boolean {
  const prefixes = [".git/", ...(manifest.excludePrefixes ?? []).map((x) =>
    x.endsWith("/") ? x : `${x}/`
  )];
  const n = normalizeRel(rel);
  if (n === ".git" || n.startsWith(".git/")) return true;
  for (const pref of prefixes) {
    if (n === pref.slice(0, -1) || n.startsWith(pref)) return true;
  }
  const includes = manifest.includePrefixes ?? [];
  if (includes.length === 0) return false;
  return !includes.some((pref) => {
    const p = pref.endsWith("/") ? pref : `${pref}/`;
    return n === pref || n === pref.replace(/\/$/, "") || n.startsWith(p);
  });
}

function isAllowedOutput(rel: string, manifest: SnapshotManifest): boolean {
  const dirs = manifest.allowedOutputDirs ?? [];
  const n = normalizeRel(rel);
  return dirs.some((d) => {
    const p = d.endsWith("/") ? d : `${d}/`;
    return n === d.replace(/\/$/, "") || n.startsWith(p);
  });
}

function sha256Bytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function gitPorcelain(cwd: string): string {
  const r = spawnSync("git", ["status", "--porcelain=v1", "-uall"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (r.status !== 0) {
    throw new DomainValidationError(
      `worktree fingerprint: git status failed: ${r.stderr ?? r.error?.message ?? "unknown"}`
    );
  }
  return r.stdout ?? "";
}

/**
 * Capture a deterministic fingerprint of HEAD + dirty/untracked candidate
 * content without mutating the index (`git add` is never used).
 */
export function captureWorktreeFingerprint(
  cwd: string,
  manifest: SnapshotManifest = {}
): WorktreeFingerprint {
  const root = path.resolve(cwd);
  const headRevision = readWorktreeRevision(root);
  const lines = gitPorcelain(root).split(/\r?\n/).filter((l) => l.length > 0);
  const entries: FingerprintEntry[] = [];

  for (const line of lines) {
    const xy = line.slice(0, 2);
    let rawPath = line.slice(3);
    // rename: "R  old -> new"
    if (rawPath.includes(" -> ")) {
      rawPath = rawPath.split(" -> ").pop() ?? rawPath;
    }
    const rel = normalizeRel(rawPath.replace(/^"|"$/g, ""));
    if (isExcluded(rel, manifest)) continue;

    const abs = path.join(root, rel);
    let kind: FingerprintEntryKind;
    if (xy === "??") kind = "untracked";
    else if (xy.includes("D") || xy === " D") kind = "deleted";
    else if (xy.includes("A") || xy === " A") kind = "added";
    else kind = "modified";

    if (kind === "deleted") {
      entries.push({ path: rel, kind, sha256: null });
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      entries.push({ path: rel, kind, sha256: null });
      continue;
    }
    entries.push({ path: rel, kind, sha256: sha256Bytes(readFileSync(abs)) });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const canonical = entries
    .map((e) => `${e.path}\0${e.kind}\0${e.sha256 ?? ""}`)
    .join("\n");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");

  return {
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    headRevision,
    entries,
    digest
  };
}

/**
 * Compare before/after fingerprints. Entries under allowedOutputDirs that
 * appear only after the check are ignored; any other drift fails.
 */
export function fingerprintsCompatible(
  before: WorktreeFingerprint,
  after: WorktreeFingerprint,
  manifest: SnapshotManifest = {}
): { ok: boolean; reason: string } {
  if (before.schemaVersion !== WORKTREE_FINGERPRINT_SCHEMA || after.schemaVersion !== WORKTREE_FINGERPRINT_SCHEMA) {
    return { ok: false, reason: "fingerprint schemaVersion mismatch or missing g1a-v1" };
  }
  if (before.headRevision !== after.headRevision) {
    return { ok: false, reason: "HEAD revision changed during independent check" };
  }
  if (before.digest === after.digest) {
    return { ok: true, reason: "fingerprints identical" };
  }

  const beforeMap = new Map(before.entries.map((e) => [e.path, e]));
  const afterMap = new Map(after.entries.map((e) => [e.path, e]));
  const paths = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const p of paths) {
    const b = beforeMap.get(p);
    const a = afterMap.get(p);
    if (b && a) {
      if (b.kind !== a.kind || b.sha256 !== a.sha256) {
        return { ok: false, reason: `candidate content changed: ${p}` };
      }
      continue;
    }
    if (!b && a) {
      if (isAllowedOutput(p, manifest)) continue;
      return { ok: false, reason: `new candidate path during check: ${p}` };
    }
    if (b && !a) {
      return { ok: false, reason: `candidate path disappeared during check: ${p}` };
    }
  }
  return { ok: true, reason: "fingerprints compatible (allowed outputs ignored)" };
}

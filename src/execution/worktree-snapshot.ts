import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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

function gitPorcelainZ(cwd: string): string {
  const r = spawnSync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
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

function parsePorcelainZ(stdout: string): Array<{ xy: string; rel: string }> {
  const records: Array<{ xy: string; rel: string }> = [];
  let i = 0;
  while (i < stdout.length) {
    if (stdout.charCodeAt(i) === 0) {
      i += 1;
      continue;
    }
    if (i + 3 > stdout.length) {
      throw new DomainValidationError("worktree fingerprint: truncated git status -z record");
    }
    const xy = stdout.slice(i, i + 2);
    if (stdout[i + 2] !== " ") {
      throw new DomainValidationError("worktree fingerprint: malformed git status -z record");
    }
    i += 3;
    const n1 = stdout.indexOf("\0", i);
    if (n1 < 0) {
      throw new DomainValidationError("worktree fingerprint: missing NUL terminator");
    }
    const first = stdout.slice(i, n1);
    i = n1 + 1;
    if (xy.includes("R") || xy.includes("C")) {
      const n2 = stdout.indexOf("\0", i);
      if (n2 < 0) {
        throw new DomainValidationError("worktree fingerprint: missing rename/copy path NUL");
      }
      // git status -z emits "R  NEW\\0OLD\\0" (destination first).
      i = n2 + 1;
    }
    records.push({ xy, rel: normalizeRel(first) });
  }
  return records;
}

function entryKey(e: FingerprintEntry): string {
  return `${e.path}\0${e.kind}`;
}

function hashExistingFile(root: string, rel: string): string {
  const abs = path.join(root, rel);
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      throw new Error("not a regular file");
    }
    return sha256Bytes(readFileSync(abs));
  } catch (err) {
    if (err instanceof DomainValidationError) throw err;
    throw new DomainValidationError(`worktree fingerprint: unreadable non-delete path: ${rel}`);
  }
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
  const records = parsePorcelainZ(gitPorcelainZ(root));
  const entries: FingerprintEntry[] = [];

  for (const { xy, rel } of records) {
    if (isExcluded(rel, manifest)) continue;

    let kind: FingerprintEntryKind;
    if (xy === "??") kind = "untracked";
    else if (xy.includes("D") || xy === " D") kind = "deleted";
    else if (xy.includes("A") || xy === " A") kind = "added";
    else kind = "modified";

    if (kind === "deleted") {
      entries.push({ path: rel, kind, sha256: null });
      continue;
    }
    entries.push({ path: rel, kind, sha256: hashExistingFile(root, rel) });
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

  const beforeMap = new Map(before.entries.map((e) => [entryKey(e), e]));
  const afterMap = new Map(after.entries.map((e) => [entryKey(e), e]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const key of keys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    const p = (b ?? a)?.path ?? key;
    if (b && a) {
      if (b.kind !== a.kind || b.sha256 !== a.sha256) {
        return { ok: false, reason: `candidate content changed: ${p}` };
      }
      continue;
    }
    if (!b && a) {
      if (isAllowedOutput(a.path, manifest)) continue;
      return { ok: false, reason: `new candidate path during check: ${a.path}` };
    }
    if (b && !a) {
      return { ok: false, reason: `candidate path disappeared during check: ${b.path}` };
    }
  }
  return { ok: true, reason: "fingerprints compatible (allowed outputs ignored)" };
}

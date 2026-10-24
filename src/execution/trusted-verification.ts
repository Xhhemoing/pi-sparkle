import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { captureExactSnapshot, sameExactSnapshot, type ExactSnapshot } from "./exact-snapshot.js";
import type { SnapshotManifest } from "./worktree-snapshot.js";
import { normalizePathSelector } from "./path-selector.js";

export interface TrustedVerificationInput {
  readonly command: string;
  readonly args?: readonly string[];
  /** Complete host-declared external checker definition/dependency files. */
  readonly checkerFiles?: readonly string[];
  readonly snapshotManifest?: SnapshotManifest;
  readonly maxSnapshotBytes?: number;
  readonly maxSnapshotFiles?: number;
}

/** Runtime capability: its private exact checker bytes are not serializable. */
export interface TrustedVerificationDescriptor {
  readonly schemaVersion: "trusted-verification-v1";
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly checkerFiles: readonly string[];
  readonly snapshotManifest: SnapshotManifest;
  readonly maxSnapshotBytes: number;
  readonly maxSnapshotFiles: number;
}

export interface TrustedVerificationEvidence {
  readonly schemaVersion: "exact-verification-v1";
  readonly descriptorId: string;
  readonly ok: boolean;
  readonly reason: string;
  readonly candidateFileCount: number;
  readonly candidateByteLength: number;
}

interface DescriptorState { readonly checkerSnapshots: readonly ExactSnapshot[]; }
export interface TrustedVerificationObservation {
  readonly descriptor: TrustedVerificationDescriptor;
  readonly cwd: string;
  readonly candidate: ExactSnapshot;
}
const descriptors = new WeakMap<TrustedVerificationDescriptor, DescriptorState>();

function fail(reason: string): never { throw new DomainValidationError(`trusted verification ${reason}`); }
function equalArgs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function frozenManifest(input: SnapshotManifest = {}): SnapshotManifest {
  if (input === null || typeof input !== "object") fail("manifest must be an object");
  const copy = (values: readonly string[] | undefined): readonly string[] => {
    if (values === undefined) return Object.freeze([]);
    if (!Array.isArray(values)) fail("manifest prefixes must be arrays");
    const normalized = values.map((value) => {
      if (typeof value !== "string" || value.includes("\0")) fail("manifest prefixes must be relative paths");
      const prefix = value.replace(/\\/g, "/").replace(/\/+$/, "");
      if (prefix === "" || path.posix.isAbsolute(prefix) || /^[A-Za-z]:/.test(prefix) ||
        prefix.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
        prefix === ".git" || prefix.startsWith(".git/")) fail("manifest prefixes must be safe relative paths outside .git");
      return prefix;
    });
    return Object.freeze([...new Set(normalized)].sort());
  };
  const patterns = (values: readonly string[]): readonly string[] => {
    if (!Array.isArray(values) || values.length > 256) fail("manifest patterns must be bounded arrays");
    return Object.freeze([...new Set(values.map(normalizePathSelector))].sort());
  };
  return Object.freeze({ includePrefixes: copy(input.includePrefixes), excludePrefixes: copy(input.excludePrefixes),
    ...(input.optionalIncludePrefixes === undefined ? {} : { optionalIncludePrefixes: copy(input.optionalIncludePrefixes) }),
    ...(input.includePatterns === undefined ? {} : { includePatterns: patterns(input.includePatterns) }),
    ...(input.optionalIncludePatterns === undefined ? {} : { optionalIncludePatterns: patterns(input.optionalIncludePatterns) }),
    allowedOutputDirs: copy(input.allowedOutputDirs) });
}

function limits(descriptor: TrustedVerificationDescriptor): { maxFiles: number; maxBytes: number } {
  return { maxFiles: descriptor.maxSnapshotFiles, maxBytes: descriptor.maxSnapshotBytes };
}

function checkerSnapshots(descriptor: TrustedVerificationDescriptor): readonly ExactSnapshot[] {
  let remaining = descriptor.maxSnapshotBytes;
  return descriptor.checkerFiles.map((file) => {
    const snapshot = captureExactSnapshot(path.dirname(file), { includePrefixes: [path.basename(file)] },
      { maxFiles: 1, maxBytes: Math.max(1, remaining) });
    if (snapshot.byteLength > remaining) fail("checker snapshot exceeds byte limit");
    remaining -= snapshot.byteLength;
    return snapshot;
  });
}

function checkerUnchanged(descriptor: TrustedVerificationDescriptor): boolean {
  const state = descriptors.get(descriptor);
  if (state === undefined) return false;
  const current = checkerSnapshots(descriptor);
  return current.length === state.checkerSnapshots.length && current.every((snapshot, index) => sameExactSnapshot(snapshot, state.checkerSnapshots[index]!));
}

/** Issue once from host authority, before giving candidate-scoped tools to workers. */
export function prepareTrustedVerification(input: TrustedVerificationInput): TrustedVerificationDescriptor {
  if (typeof input.command !== "string" || input.command.trim() === "") fail("requires a command");
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail("argv must contain strings");
  const maxSnapshotBytes = input.maxSnapshotBytes ?? 4 * 1024 * 1024;
  const maxSnapshotFiles = input.maxSnapshotFiles ?? 256;
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1 || maxSnapshotBytes > 32 * 1024 * 1024) fail("snapshot byte limit must be 1..33554432");
  if (!Number.isSafeInteger(maxSnapshotFiles) || maxSnapshotFiles < 1 || maxSnapshotFiles > 4096) fail("snapshot file limit must be 1..4096");
  const files = input.checkerFiles ?? [];
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || !path.isAbsolute(file))) fail("checker files must be absolute paths");
  if (files.length > maxSnapshotFiles || new Set(files.map((file) => path.resolve(file))).size !== files.length) fail("checker file list exceeds limit or contains duplicates");
  const manifest = frozenManifest(input.snapshotManifest);
  if (manifest.allowedOutputDirs!.length > 0) fail("exact snapshots require explicit exclusions instead of allowedOutputDirs");
  const descriptor: TrustedVerificationDescriptor = Object.freeze({ schemaVersion: "trusted-verification-v1", id: `verifier_v1_${randomUUID()}`,
    command: input.command, args: Object.freeze([...args]), checkerFiles: Object.freeze(files.map((file) => path.resolve(file))),
    snapshotManifest: manifest, maxSnapshotBytes, maxSnapshotFiles });
  for (const file of descriptor.checkerFiles) {
    if (realpathSync(file) !== file) fail("checker definition/dependency path must not contain links");
  }
  descriptors.set(descriptor, { checkerSnapshots: checkerSnapshots(descriptor) });
  return descriptor;
}

export function assertTrustedVerificationDescriptor(
  descriptor: TrustedVerificationDescriptor, command: string, args: readonly string[] = []
): void {
  if (!descriptors.has(descriptor)) fail("requires the original host-issued descriptor; serialized or copied descriptors are not authority");
  if (descriptor.command !== command || !equalArgs(descriptor.args, args)) fail("command/argv does not match host descriptor");
}

/** Internal execution seam. No caller-supplied evidence is trusted. */
export function beginTrustedVerification(
  descriptor: TrustedVerificationDescriptor, cwd: string, command: string, args: readonly string[], manifest?: SnapshotManifest
): TrustedVerificationObservation {
  assertTrustedVerificationDescriptor(descriptor, command, args);
  if (manifest !== undefined && JSON.stringify(frozenManifest(manifest)) !== JSON.stringify(descriptor.snapshotManifest)) fail("manifest override does not match host descriptor");
  const root = realpathSync(path.resolve(cwd));
  if (root !== path.resolve(cwd)) fail("candidate cwd must be canonical and nonlinked");
  if (descriptor.checkerFiles.some((file) => file === root || file.startsWith(`${root}${path.sep}`))) fail("checker files must remain outside the candidate");
  if (!checkerUnchanged(descriptor)) fail("checker definition/dependency changed after issuance");
  return { descriptor, cwd: root, candidate: captureExactSnapshot(root, descriptor.snapshotManifest, limits(descriptor)) };
}

/** Compare ephemeral bytes, returning only safe metadata for the run artifact. */
export function finishTrustedVerification(observation: TrustedVerificationObservation): TrustedVerificationEvidence {
  const { descriptor, cwd, candidate } = observation;
  let reason = "exact candidate and declared checker bytes unchanged";
  let ok = false;
  try {
    const after = captureExactSnapshot(cwd, descriptor.snapshotManifest, limits(descriptor));
    if (!sameExactSnapshot(candidate, after)) reason = "candidate bytes or dependency scope changed during verification";
    else if (!checkerUnchanged(descriptor)) reason = "checker definition/dependency changed during verification";
    else ok = true;
  } catch (error) {
    reason = `exact snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return Object.freeze({ schemaVersion: "exact-verification-v1", descriptorId: descriptor.id, ok, reason,
    candidateFileCount: candidate.fileCount, candidateByteLength: candidate.byteLength });
}


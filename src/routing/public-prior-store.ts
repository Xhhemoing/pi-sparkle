import { readFile } from "node:fs/promises";
import { DomainValidationError } from "../domain/errors.js";
import {
  parsePublicPriorSnapshot,
  publicPriorHash,
  type PublicPriorSnapshot
} from "./public-prior.js";

/**
 * Disk loader for frozen public-prior snapshots. Compares publicPriorHash
 * against a sidecar or embedded hash and fails closed on mismatch. Never
 * fetches leaderboards.
 */

export interface LoadedPublicPriorSnapshot {
  readonly snapshot: PublicPriorSnapshot;
  readonly hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asHash(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function sidecarPaths(jsonPath: string): readonly string[] {
  const paths = [jsonPath + ".hash"];
  if (jsonPath.toLowerCase().endsWith(".json")) {
    paths.push(`${jsonPath.slice(0, -5)}.hash`);
  }
  return [...new Set(paths)];
}

async function readSidecarHash(jsonPath: string): Promise<string | undefined> {
  const found = new Set<string>();
  for (const candidate of sidecarPaths(jsonPath)) {
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const hash = asHash(text);
    if (hash === undefined) {
      throw new DomainValidationError(`public prior hash sidecar is empty: ${candidate}`);
    }
    found.add(hash.toLowerCase());
  }
  if (found.size === 0) return undefined;
  if (found.size > 1) {
    throw new DomainValidationError("public prior sidecar hashes disagree");
  }
  const [only] = found;
  return only;
}

function stripEmbeddedHash(raw: unknown): { payload: unknown; hash: string | undefined } {
  if (!isRecord(raw)) return { payload: raw, hash: undefined };
  const contentHash = asHash(raw.contentHash);
  const fieldHash = asHash(raw.hash);
  if (contentHash !== undefined && fieldHash !== undefined && !hashesEqual(contentHash, fieldHash)) {
    throw new DomainValidationError("public prior embedded hashes disagree");
  }
  const payload: Record<string, unknown> = { ...raw };
  delete payload.contentHash;
  delete payload.hash;
  return { payload, hash: contentHash ?? fieldHash };
}

function hashesEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Read a snapshot JSON from disk and require a matching sidecar
 * (`path.hash` or `path` with `.json` → `.hash`) and/or embedded
 * `contentHash` / `hash` field. Extra hash fields are stripped before
 * parse/hash. Opt-in vs loadPublicPriorFile, which does not require a hash.
 */
export async function loadPublicPriorSnapshot(path: string): Promise<LoadedPublicPriorSnapshot> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new DomainValidationError(`public prior file is unreadable: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new DomainValidationError("public prior file is not JSON");
  }
  const stripped = stripEmbeddedHash(raw);
  const sidecar = await readSidecarHash(path);
  if (sidecar !== undefined && stripped.hash !== undefined && !hashesEqual(sidecar, stripped.hash)) {
    throw new DomainValidationError("public prior sidecar and embedded hash mismatch");
  }
  const expected = sidecar ?? stripped.hash;
  if (expected === undefined) {
    throw new DomainValidationError("public prior hash is required");
  }
  const snapshot = parsePublicPriorSnapshot(stripped.payload);
  const hash = publicPriorHash(snapshot);
  if (!hashesEqual(hash, expected)) {
    throw new DomainValidationError(`public prior hash mismatch: expected ${expected}, computed ${hash}`);
  }
  return { snapshot, hash };
}

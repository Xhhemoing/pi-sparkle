import { createHash } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { runtimeRoot } from "../privacy/state-layout.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Run-scoped closed-loop artifacts. Covered by `deleteRunRecords` via the
 * whole `runtime/runs/<runId>/` subtree removal (same cascade as observations).
 */
export function loopArtifactsDir(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "loop-artifacts");
}

export function loopArtifactPath(stateRoot: string, runId: RunId, sha256: string): string {
  return join(loopArtifactsDir(stateRoot, runId), `${sha256}.json`);
}

export interface LoopArtifactRef {
  readonly id: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly path: string;
}

export interface SaveLoopArtifactInput {
  readonly stateRoot: string;
  readonly runId: RunId;
  readonly body: unknown;
}

function sha256OfText(text: string): { hex: string; bytes: Buffer } {
  const bytes = Buffer.from(text, "utf8");
  const hex = createHash("sha256").update(bytes).digest("hex");
  return { hex, bytes };
}

/**
 * Persist a closed-loop artifact (diff / acceptance / check record) under the
 * run subtree. Returns the content-addressed ref used in acceptance binding.
 */
export async function saveLoopArtifact(input: SaveLoopArtifactInput): Promise<LoopArtifactRef> {
  const text = `${JSON.stringify(input.body, null, 2)}\n`;
  const { hex, bytes } = sha256OfText(text);
  if (!SHA256_HEX.test(hex)) {
    throw new DomainValidationError("loop artifact hash must be 64 lowercase hex chars");
  }
  const dir = loopArtifactsDir(input.stateRoot, input.runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(dir, 0o700).catch(() => undefined);
  }
  const path = loopArtifactPath(input.stateRoot, input.runId, hex);
  await writeFileAtomic(path, text, { mode: 0o600 });
  return {
    id: `loop_${hex}`,
    sha256: hex,
    byteLength: bytes.byteLength,
    path
  };
}

export async function readLoopArtifact(
  stateRoot: string,
  runId: RunId,
  sha256: string
): Promise<unknown> {
  if (!SHA256_HEX.test(sha256)) {
    throw new DomainValidationError("loop artifact sha256 must be 64 lowercase hex chars");
  }
  const text = await readFile(loopArtifactPath(stateRoot, runId, sha256), "utf8");
  return JSON.parse(text) as unknown;
}

#!/usr/bin/env node
/**
 * F6 custodian seal (ADR-007 Q2): encrypt a directory of plaintext taskSpecs
 * into a single AES-256 tarball whose KEY lives off-repo (SM95 custodian
 * The repo carries AES-256-GCM ciphertext and a plaintext byte length only.
 * A blob that still has a legacy digest field (plainSha256/sha256/digest) is
 * refused on open and is never rehashed. Byte length is not an integrity
 * commitment. New output has no digest field.
 *
 *   node scripts/holdout-custody.mjs seal   --specs <dir> --out <blob> --key-file <path>
 *   node scripts/holdout-custody.mjs open   --blob <file> --key-file <path> --out <dir>
 *
 * seal — tar the specs dir, encrypt with the 32-byte hex key in <key-file>
 *        (created with `openssl rand -hex 32` on the custodian host, mode
 *        0600), write <blob>. Commit the blob only.
 * open — decrypt into <out> (a fresh tmp dir the caller wipes with the
 *        arm's worktree). Used by the block scheduler at reveal time ONLY.
 *
 * Key separation is the whole mechanism: the agent that tunes the router has
 * the repo, the custodian host has the key, and neither alone can read the
 * backlog.
 */
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIGEST_FIELDS = ["plainSha256", "sha256", "digest"];

/** Legacy digest fields are historical only. Never recompute them. */
export function assertNoLegacyDigest(blob) {
  const present = DIGEST_FIELDS.filter((field) => blob?.[field] !== undefined);
  if (present.length > 0) {
    const error = new Error(
      `legacy digest field ${present.join(", ")} present — refusing to extract (not rehashed)`
    );
    error.code = "LEGACY_DIGEST";
    throw error;
  }
}

/** New seals carry plaintext byte length only. No digest field. */
export function sealBlobFields(plainByteLength) {
  return { version: 2, plainBytes: plainByteLength };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
await main();
}

async function main() {

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? undefined : rest[index + 1];
};

if ((command !== "seal" && command !== "open") || flag("key-file") === undefined) {
  console.error("usage:");
  console.error("  holdout-custody seal --specs <dir> --out <blob> --key-file <path>");
  console.error("  holdout-custody open --blob <file> --key-file <path> --out <dir>");
  process.exit(2);
}

const keyHex = (await readFile(flag("key-file"), "utf8")).trim();
if (!/^[0-9a-f]{64}$/.test(keyHex)) {
  console.error("key file must hold exactly one 32-byte hex key (openssl rand -hex 32)");
  process.exit(2);
}
const key = Buffer.from(keyHex, "hex");

const AAD = "pi-sparkle-f6-holdout-v1";

if (command === "seal") {
  const specsDir = flag("specs");
  const outPath = flag("out");
  if (specsDir === undefined || outPath === undefined) {
    console.error("seal requires --specs and --out");
    process.exit(2);
  }
  const tmp = await mkdtemp(join(tmpdir(), "f6-seal-"));
  try {
    const tarball = join(tmp, "specs.tar");
    execFileSync("tar", ["-cf", tarball, "-C", resolve(specsDir), "."]);
    const plain = await readFile(tarball);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(AAD));
    const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = {
      ...sealBlobFields(plain.byteLength),
      cipher: "aes-256-gcm",
      aad: AAD,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      sealedBytes: sealed.byteLength,
      sealedAt: new Date().toISOString(),
      data: sealed.toString("base64")
    };
    await writeFile(outPath, JSON.stringify(blob) + "\n", "utf8");
    console.log(`sealed ${specsDir} -> ${outPath} (plainBytes ${blob.plainBytes}, not a digest)`);
    console.log("the key file stays with the custodian; commit ONLY the blob");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
} else {
  const blobPath = flag("blob");
  const outDir = flag("out");
  if (blobPath === undefined || outDir === undefined) {
    console.error("open requires --blob and --out");
    process.exit(2);
  }
  const blob = JSON.parse(await readFile(blobPath, "utf8"));
  try {
    assertNoLegacyDigest(blob);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (blob.version !== 2 || blob.cipher !== "aes-256-gcm" || blob.aad !== AAD) {
    console.error("blob is not a pi-sparkle-f6-holdout-v2 aes-256-gcm seal");
    process.exit(2);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "hex"));
  decipher.setAAD(Buffer.from(AAD));
  decipher.setAuthTag(Buffer.from(blob.tag, "hex"));
  let plain;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
  } catch {
    console.error("decryption failed — wrong key or tampered blob (GCM auth tag mismatch)");
    process.exit(1);
  }
  if (plain.byteLength !== blob.plainBytes) {
    console.error("decrypted tarball byte length does not match sealed plainBytes — refusing to extract");
    process.exit(1);
  }
  const tmp = await mkdtemp(join(tmpdir(), "f6-open-"));
  try {
    const tarball = join(tmp, "specs.tar");
    await writeFile(tarball, plain);
    execFileSync("mkdir", ["-p", outDir]);
    execFileSync("tar", ["-xf", tarball, "-C", outDir]);
    console.log(`opened ${blobPath} -> ${outDir} (plainBytes ${plain.byteLength}; not a digest check)`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
}

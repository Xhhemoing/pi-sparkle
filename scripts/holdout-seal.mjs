#!/usr/bin/env node
/**
 * F6 holdout inventory (not a cryptographic seal). Lists spec ids and byte
 * lengths only. Refuses digest fields and refuses to claim integrity.
 *
 *   node scripts/holdout-seal.mjs inventory --specs <dir> --out <manifest.json>
 *
 * Does not encrypt, hash, or seal real holdout data.
 */
import { Buffer } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIGEST_FIELDS = ["sha256", "plainSha256", "digest"];

/** Inventory rows are names and lengths. Digest fields are refused. */
export function manifestEntry(name, body) {
  if (!Buffer.isBuffer(body)) {
    throw new Error("manifestEntry requires a Buffer");
  }
  return { name, bytes: body.byteLength };
}

export function assertInventoryManifest(manifest) {
  const specs = manifest?.specs;
  if (manifest?.version !== 2 || manifest?.cryptographicSeal !== false || !Array.isArray(specs)) {
    const error = new Error("manifest is not a version-2 non-cryptographic inventory");
    error.code = "NOT_INVENTORY";
    throw error;
  }
  for (const spec of specs) {
    const present = DIGEST_FIELDS.filter((field) => spec?.[field] !== undefined);
    if (present.length > 0) {
      const error = new Error(`legacy digest field ${present.join(", ")} — refusing inventory`);
      error.code = "LEGACY_DIGEST";
      throw error;
    }
    if (typeof spec?.name !== "string" || typeof spec?.bytes !== "number") {
      throw new Error("inventory spec must have name and bytes");
    }
  }
  return specs;
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

const specsDir = flag("specs");
const outPath = flag("out");
const commitmentsPath = flag("commitments");

if (command === "seal" || command === "verify" || commitmentsPath !== undefined) {
  console.error("cryptographic seal/verify removed — refusing to claim a seal");
  process.exit(1);
}
if (command !== "inventory" || specsDir === undefined || outPath === undefined) {
  console.error("usage:");
  console.error("  holdout-seal inventory --specs <dir> --out <manifest.json>");
  console.error("not a cryptographic seal; records spec ids and byte lengths only");
  process.exit(2);
}

const names = (await readdir(specsDir)).filter((name) => name.endsWith(".json")).sort();
const specs = [];
for (const name of names) {
  specs.push(manifestEntry(name, await readFile(join(specsDir, name))));
}
if (specs.length === 0) {
  console.error(`no *.json specs in ${specsDir} — refusing an empty inventory`);
  process.exit(1);
}
const manifest = {
  version: 2,
  cryptographicSeal: false,
  note: "byte lengths only; not an integrity commitment",
  specs
};
assertInventoryManifest(manifest);
const { writeFile } = await import("node:fs/promises");
await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`inventoried ${specs.length} spec(s) -> ${outPath} (not a cryptographic seal)`);
}

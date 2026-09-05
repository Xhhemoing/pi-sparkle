#!/usr/bin/env node
/**
 * F6 holdout sealing tool (decision package §2.6): the evaluated repo carries
 * SHA-256 commitments only; plaintext task specs stay with the custodian.
 *
 *   node scripts/holdout-seal.mjs seal   --specs <dir>  --out <commitments.json>
 *   node scripts/holdout-seal.mjs verify --specs <dir>  --commitments <file>
 *
 * seal   — hash every *.json spec in <dir> (sorted by name) into a commitments
 *          file: { version, sealedAt, specs: [{ name, sha256, bytes }] }.
 *          The file is safe to commit; the specs directory is NOT.
 * verify — re-hash and compare; exit 1 on any mismatch/missing/extra spec,
 *          printing the first divergence. This is the Week-2 integrity audit.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? undefined : rest[index + 1];
};

const specsDir = flag("specs");
const outPath = flag("out");
const commitmentsPath = flag("commitments");

if ((command !== "seal" && command !== "verify") || specsDir === undefined ||
    (command === "seal" && outPath === undefined) ||
    (command === "verify" && commitmentsPath === undefined)) {
  console.error("usage:");
  console.error("  holdout-seal seal   --specs <dir> --out <commitments.json>");
  console.error("  holdout-seal verify --specs <dir> --commitments <file>");
  process.exit(2);
}

async function hashSpecs(dir) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const specs = [];
  for (const name of names) {
    const body = await readFile(join(dir, name));
    specs.push({
      name,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.byteLength
    });
  }
  return specs;
}

if (command === "seal") {
  const specs = await hashSpecs(specsDir);
  if (specs.length === 0) {
    console.error(`no *.json specs in ${specsDir} — refusing to seal an empty backlog`);
    process.exit(1);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    outPath,
    JSON.stringify({ version: 1, sealedAt: new Date().toISOString(), specs }, null, 2) + "\n"
  );
  console.log(`sealed ${specs.length} spec(s) -> ${outPath}`);
  console.log("commit ONLY the commitments file; keep the specs directory with the custodian");
} else {
  const expected = JSON.parse(await readFile(commitmentsPath, "utf8"));
  const actual = await hashSpecs(specsDir);
  const byName = new Map(actual.map((spec) => [spec.name, spec]));
  for (const spec of expected.specs ?? []) {
    const found = byName.get(spec.name);
    if (found === undefined) {
      console.error(`MISSING: ${spec.name}`);
      process.exit(1);
    }
    if (found.sha256 !== spec.sha256) {
      console.error(`MODIFIED: ${spec.name} (sealed ${spec.sha256.slice(0, 12)}…, now ${found.sha256.slice(0, 12)}…)`);
      process.exit(1);
    }
    byName.delete(spec.name);
  }
  const extra = [...byName.keys()];
  if (extra.length > 0) {
    console.error(`EXTRA: ${extra.join(", ")} (not in the sealed backlog)`);
    process.exit(1);
  }
  console.log(`integrity OK: ${actual.length} spec(s) match the sealed commitments`);
}

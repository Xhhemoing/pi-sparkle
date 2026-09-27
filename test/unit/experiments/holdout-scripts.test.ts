import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();

async function load(script: string) {
  return import(pathToFileURL(join(root, "scripts", script)).href);
}

describe("holdout scripts have no SHA-256", () => {
  it("source of the three scripts does not call SHA-256", async () => {
    for (const name of ["holdout-custody.mjs", "holdout-block.mjs", "holdout-seal.mjs"]) {
      const source = await readFile(join(root, "scripts", name), "utf8");
      assert.doesNotMatch(source, /createHash|SHA-256/);
    }
  });

  it("custody refuses a legacy digest without rehashing and omits digest fields", async () => {
    const { assertNoLegacyDigest, sealBlobFields } = await load("holdout-custody.mjs");
    assert.throws(
      () => assertNoLegacyDigest({ plainSha256: "ab".repeat(32), version: 1 }),
      /refusing to extract/
    );
    const fields = sealBlobFields(12);
    assert.equal(fields.version, 2);
    assert.equal(fields.plainBytes, 12);
    assert.equal("plainSha256" in fields, false);
    assert.equal("sha256" in fields, false);
  });

  it("block order is FNV-1a and documented as not an integrity commitment", async () => {
    const { fnv1a32, r0RunsFirst } = await load("holdout-block.mjs");
    const source = await readFile(join(root, "scripts", "holdout-block.mjs"), "utf8");
    assert.match(source, /NOT an integrity commitment/);
    assert.equal(fnv1a32(""), 0x811c9dc5);
    assert.equal(fnv1a32("a"), 0xe40c292c);
    assert.equal(typeof r0RunsFirst("42", 8), "boolean");
    assert.equal(r0RunsFirst("42", 8), r0RunsFirst("42", 8));
  });

  it("imports pure block-order helpers without a built dist tree", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "sparkle-holdout-import-"));
    try {
      const scripts = join(fixture, "scripts");
      await mkdir(join(scripts, "lib"), { recursive: true });
      await copyFile(join(root, "scripts", "holdout-block.mjs"), join(scripts, "holdout-block.mjs"));
      await copyFile(
        join(root, "scripts", "lib", "holdout-block-evidence.mjs"),
        join(scripts, "lib", "holdout-block-evidence.mjs")
      );
      const { fnv1a32, r0RunsFirst } = await import(pathToFileURL(join(scripts, "holdout-block.mjs")).href);
      assert.equal(fnv1a32("a"), 0xe40c292c);
      assert.equal(typeof r0RunsFirst("42", 8), "boolean");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("seal inventory records id and byte length and refuses a digest", async () => {
    const { manifestEntry, assertInventoryManifest } = await load("holdout-seal.mjs");
    const entry = manifestEntry("a.json", Buffer.from("abcd"));
    assert.deepEqual(entry, { name: "a.json", bytes: 4 });
    assert.equal("sha256" in entry, false);
    const manifest = {
      version: 2,
      cryptographicSeal: false,
      specs: [entry]
    };
    assert.deepEqual(assertInventoryManifest(manifest), [entry]);
    assert.throws(
      () => assertInventoryManifest({ ...manifest, specs: [{ ...entry, sha256: "ab" }] }),
      /legacy digest/
    );
  });
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();
const SRC = join(REPO_ROOT, "src");

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

test("no Pi package imports outside src/pi-adapter", async () => {
  const files = await listSourceFiles(SRC);
  const offenders: string[] = [];
  for (const file of files) {
    if (file.replace(/\\/g, "/").includes("/pi-adapter/")) continue;
    const content = await readFile(file, "utf8");
    if (content.includes("@earendil-works/")) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the pi-adapter boundary is the only Pi importer", async () => {
  const files = await listSourceFiles(SRC);
  const importers = files.filter((file) => file.replace(/\\/g, "/").includes("/pi-adapter/"));
  assert.ok(importers.length >= 1, "src/pi-adapter must contain the adapter implementation");
});

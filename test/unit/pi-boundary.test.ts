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

/** ADR-001 forbids importing Pi packages outside src/pi-adapter, not mentioning them as data. */
function hasPiPackageImport(source: string): boolean {
  return /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']@earendil-works\//.test(source);
}

test("no Pi package imports outside src/pi-adapter", async () => {
  const files = await listSourceFiles(SRC);
  const offenders: string[] = [];
  for (const file of files) {
    if (file.replace(/\\/g, "/").includes("/pi-adapter/")) continue;
    const content = await readFile(file, "utf8");
    if (hasPiPackageImport(content)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test("string mentions of Pi package names are not treated as imports", () => {
  const mention = 'readDependencyVersion(dependencies, "@earendil-works/pi-agent-core")';
  assert.equal(hasPiPackageImport(mention), false);
  assert.equal(hasPiPackageImport('import { Agent } from "@earendil-works/pi-agent-core"'), true);
  assert.equal(hasPiPackageImport('const { builtinModels } = await import("@earendil-works/pi-ai/providers/all")'), true);
});

test("the pi-adapter boundary is the only Pi importer", async () => {
  const files = await listSourceFiles(SRC);
  const importers = files.filter((file) => file.replace(/\\/g, "/").includes("/pi-adapter/"));
  assert.ok(importers.length >= 1, "src/pi-adapter must contain the adapter implementation");
});

// ADR-006 guardrail: the adapter may depend on the Pi runtime libraries only.
// Adding any other @earendil-works package (e.g. the coding agent) requires an
// explicit, reviewed change to this whitelist.
const PI_ADAPTER_PACKAGE_WHITELIST = new Set(["pi-agent-core", "pi-ai"]);

test("src/pi-adapter imports only whitelisted @earendil-works packages", async () => {
  const files = await listSourceFiles(join(SRC, "pi-adapter"));
  assert.ok(files.length >= 1, "src/pi-adapter must exist");
  const offenders: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(/@earendil-works\/([A-Za-z0-9_.-]+)/g)) {
      const pkg = match[1] as string;
      if (!PI_ADAPTER_PACKAGE_WHITELIST.has(pkg)) {
        offenders.push(`${file}: @earendil-works/${pkg}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("package.json declares no pi.extensions and no coding-agent dependency", async () => {
  const raw = await readFile(join(REPO_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    pi?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(
    pkg.pi?.extensions,
    undefined,
    "package.json must not declare pi.extensions (ADR-006: adapter, not extension host)"
  );
  const allDeps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const codingAgent = allDeps.filter((name) => name.includes("pi-coding-agent"));
  assert.deepEqual(codingAgent, [], "pi-coding-agent must not be a dependency");
});

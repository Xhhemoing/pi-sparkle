import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const skillDir = join(root, ".agents/skills/pi-sparkle");
const skillPath = join(skillDir, "SKILL.md");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("package.json is a Pi package without an inbound extension", () => {
  const pkg = readJson(join(root, "package.json"));
  assert.equal(pkg.name, "pi-sparkle");
  assert.deepEqual(pkg.keywords, ["pi-package"]);
  const files = pkg.files;
  assert.ok(Array.isArray(files));
  assert.ok(files.includes(".agents/skills"));
  assert.ok(files.includes("prompts"));
  const pi = pkg.pi as Record<string, unknown> | undefined;
  assert.ok(pi);
  assert.deepEqual(pi.skills, [".agents/skills"]);
  assert.deepEqual(pi.prompts, ["./prompts"]);
  assert.equal("extensions" in pi, false);
});

test("pi-sparkle skill frontmatter and referenced files are complete", () => {
  const text = readFileSync(skillPath, "utf8");
  const fence = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fence, "SKILL.md must have YAML frontmatter");
  const name = fence[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fence[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert.equal(name, "pi-sparkle");
  assert.ok(description && description.length > 0 && description.length <= 1024);
  assert.match(name ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const refs = [...text.matchAll(/references\/([a-z0-9-]+\.md)/g)].map((match) => match[1]);
  assert.ok(refs.length >= 6);
  for (const file of new Set(refs)) {
    assert.equal(existsSync(join(skillDir, "references", file)), true, file);
  }
});

test("sparkle prompt template exists for /sparkle", () => {
  const prompt = readFileSync(join(root, "prompts/sparkle.md"), "utf8");
  assert.match(prompt, /^---\r?\n/);
  assert.match(prompt, /pi-sparkle/);
});

test("opt-in skill-route logger exists and is not a Pi extension", () => {
  assert.equal(existsSync(join(skillDir, "scripts", "log-skill-route.mjs")), true);
  const pkg = readJson(join(root, "package.json"));
  const pi = pkg.pi as Record<string, unknown>;
  assert.equal("extensions" in pi, false);
});

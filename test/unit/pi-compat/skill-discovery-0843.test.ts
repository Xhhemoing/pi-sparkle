import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const groupingRoot = join(repoRoot, "test/fixtures/pi-0843-skills/grouping");
const nestedSkillPath = join(groupingRoot, "nested-skill/SKILL.md");

test("Pi 0.84.3 fixture contains a valid nested SKILL.md", () => {
  assert.equal(existsSync(nestedSkillPath), true);

  const skill = readFileSync(nestedSkillPath, "utf8");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(frontmatter, "nested SKILL.md must have YAML frontmatter");
  const frontmatterBody = frontmatter[1];
  assert.ok(frontmatterBody, "nested SKILL.md frontmatter must not be empty");
  assert.match(frontmatterBody, /^name:\s*nested-fixture-skill$/m);
  assert.match(frontmatterBody, /^description:\s*\S.+$/m);
});

test("grouping Markdown files do not declare skill frontmatter", () => {
  for (const filename of ["AGENTS.md", "README.md"]) {
    const path = join(groupingRoot, filename);
    assert.equal(existsSync(path), true, `${filename} must exist`);
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /^---(?:\r?\n|$)/,
      `${filename} must remain ordinary Markdown`
    );
  }
});

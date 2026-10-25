import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePathSelector, hasPathPattern, matchesPathSelector, mayMatchPathDescendant } from "../../../src/execution/path-selector.js";

test("selectors accept finite slash-separated grammar and preserve literal case", () => {
  for (const value of ["src", "src/*.ts", "**/*.test.?s", ".cache/**", "中文/?.ts"]) assert.equal(normalizePathSelector(value), value);
  for (const value of ["", "/src", "./src", "src/", "src//a", "src/../a", "C:/src", "src\\a", "src/[ab]", "src/{a,b}", "src/@(a)", "src/a**b", "**x", ".git", "src/.git/a", "src/\0", "x".repeat(257)]) assert.throws(() => normalizePathSelector(value), /selector|path|pattern/i);
  assert.equal(hasPathPattern("src/literal.ts"), false);
  assert.equal(hasPathPattern("src/?/foo*"), true);
});
test("selector matching applies stars within components, globstar across components and subtree semantics", () => {
  const positive = [["src/x.ts", "src/*.ts"], ["src/x.ts/deep", "src/*.ts"], ["src/deep/x.ts", "src/**/*.ts"], ["src/x.ts", "src/**/*.ts"], [".hidden/file", "*"], ["src/a/b", "src/**"], ["src", "src/**"], ["中文/字.ts", "中文/?.ts"], ["emoji/😀.ts", "emoji/?.ts"]];
  for (const [relative, selector] of positive) assert.equal(matchesPathSelector(relative!, selector!), true, `${relative} :: ${selector}`);
  for (const [relative, selector] of [["src/a/b.ts", "src/*.ts"], ["src/A.TS", "src/*.ts"], ["a/b", "a/?/c"], [".git/config", "**"], ["src/.git/config", "**"]]) assert.equal(matchesPathSelector(relative!, selector!), false, `${relative} :: ${selector}`);
});
test("descendant possibility supports dynamic traversal without claiming a regular-file match", () => {
  assert.equal(mayMatchPathDescendant("src", "src/**/*.ts"), true);
  assert.equal(mayMatchPathDescendant("src/deep", "src/**/*.ts"), true);
  assert.equal(mayMatchPathDescendant("other", "src/**/*.ts"), false);
  assert.equal(mayMatchPathDescendant("regular.txt", "**/*.ts"), true);
  assert.equal(matchesPathSelector("regular.txt", "**/*.ts"), false);
  assert.equal(mayMatchPathDescendant("src/matched.ts", "src/*.ts"), true);
});

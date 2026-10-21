import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../../scripts/run-tests.mjs", import.meta.url));

async function withFixture(
  files: Readonly<Record<string, string>>,
  check: (root: string) => void
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-test-runner-"));
  try {
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    for (const [relative, body] of Object.entries(files)) {
      const path = join(root, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function invoke(root: string, args: readonly string[] = []) {
  const env = { ...process.env };
  // This child runs a separate suite, not another test of its caller's suite.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000
  });
  assert.equal(result.error, undefined, String(result.error));
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("test wrapper discovers nested TypeScript tests by default and ignores helpers", async () => {
  await withFixture({
    "test/alpha.test.ts": 'import { test } from "node:test"; const value: number = 1; test("alpha-found", () => { if (value !== 1) throw Error("bad"); });',
    "test/nested/beta.test.ts": 'import { test } from "node:test"; test("beta-found", () => {});',
    "test/helper.ts": 'throw new Error("helper-must-not-run");'
  }, (root) => {
    const result = invoke(root);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /alpha-found/);
    assert.match(result.output, /beta-found/);
    assert.doesNotMatch(result.output, /helper-must-not-run/);
  });
});

test("test wrapper preserves flags-only filtering including a separate option value", async () => {
  await withFixture({
    "test/filter.test.ts": 'import { test } from "node:test"; test("wanted", () => {}); test("unwanted", () => { throw Error("must-be-filtered"); });'
  }, (root) => {
    const result = invoke(root, ["--test-name-pattern", "^wanted$", "--test-concurrency=1"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /wanted/);
    assert.doesNotMatch(result.output, /must-be-filtered/);
  });
});

test("test wrapper expands an explicit directory without adding unrelated default tests", async () => {
  await withFixture({
    "test/selected/one.test.ts": 'import { test } from "node:test"; test("selected-found", () => {});',
    "test/unrelated.test.ts": 'throw Error("unrelated-must-not-run");'
  }, (root) => {
    const result = invoke(root, ["--", "--test-concurrency=1", "test/selected"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /selected-found/);
    assert.doesNotMatch(result.output, /unrelated-must-not-run/);
  });
});

test("test wrapper preserves explicit file selection and propagates its failure", async () => {
  await withFixture({
    "test/failing.test.ts": 'import { test } from "node:test"; test("selected-failure", () => { throw Error("expected-test-failure"); });',
    "test/unrelated.test.ts": 'throw Error("unrelated-must-not-run");'
  }, (root) => {
    const result = invoke(root, ["test/failing.test.ts"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /expected-test-failure/);
    assert.doesNotMatch(result.output, /unrelated-must-not-run/);
  });
});

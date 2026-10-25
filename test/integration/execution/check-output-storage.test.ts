import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-check-storage-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.name", "Storage fixture"]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(root, "value.txt"), "original", "utf8");
    git(root, ["add", "."]);
    git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const revision = git(root, ["rev-parse", "HEAD"]);
    await body(root);
    assert.equal(git(root, ["rev-parse", "HEAD"]), revision);
    assert.equal(await readFile(path.join(root, "value.txt"), "utf8"), "original");
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("sparkle-check-storage-"));
    await rm(root, { recursive: true, force: true });
  }
}

for (const larger of [false, true]) {
  test(`independent check ${larger ? "retains explicitly bounded structured output" : "preserves the legacy 4 KiB storage default"}`, async () => fixture(async (cwd) => {
    const input = { cwd, command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({padding:'x'.repeat(9000),tail:'host-only-tail'}));process.stderr.write('e'.repeat(6000))"],
      ...(larger ? { storedStreamMaxBytes: 16384 } : {}) };
    const result = await runIndependentCheck(input);
    assert.equal(result.ok, true);
    assert.equal(result.stdoutByteLength, Buffer.byteLength(JSON.stringify({ padding: "x".repeat(9000), tail: "host-only-tail" })));
    assert.equal(result.stderrByteLength, 6000);
    if (larger) {
      assert.equal(Buffer.byteLength(result.stdoutText), result.stdoutByteLength, "all bounded structured results must remain readable by the host");
      assert.equal(JSON.parse(result.stdoutText).tail, "host-only-tail");
      assert.equal(result.stderrText.length, 6000);
    } else {
      assert.equal(Buffer.byteLength(result.stdoutText), 4096);
      assert.equal(Buffer.byteLength(result.stderrText), 4096);
    }
    assert.equal(git(cwd, ["status", "--porcelain=v1"]), "");
  }));
}

test("invalid stored-output limits refuse before the actual checker can run", async () => fixture(async (cwd) => {
  for (const storedStreamMaxBytes of [0, -1, 1.5, 262145, NaN]) {
    const marker = path.join(cwd, "checker-ran.txt");
    const input = { cwd, command: process.execPath,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`], storedStreamMaxBytes };
    const outcome = await runIndependentCheck(input).then((result) => ({ result }), (error: unknown) => ({ error }));
    if ("result" in outcome) assert.equal(await readFile(marker, "utf8"), "ran", "the invalid-bound command actually executed");
    assert.ok("error" in outcome && outcome.error instanceof Error, "invalid storage limits must reject before command execution");
    assert.match(outcome.error.message, /stored|storage|limit/i);
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
  }
}));

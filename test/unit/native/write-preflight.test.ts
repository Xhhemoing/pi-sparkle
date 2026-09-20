import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { prepareNativeWrite, type NativeWritePreflightInput } from "../../../src/native/write-preflight.js";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function fixture(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "native-preflight-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Native Test"]);
  await writeFile(path.join(repo, "value.txt"), "before\n");
  git(repo, ["add", "value.txt"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function input(repo: string): NativeWritePreflightInput {
  return { sourceRepo: repo, objective: "  change value  ", verification: { command: process.execPath, args: ["-e", "process.exit(0)"] } };
}

async function withFixture(body: (fixture: { root: string; repo: string }) => Promise<void>): Promise<void> {
  const current = await fixture();
  try { await body(current); } finally { await rm(current.root, { recursive: true, force: true }); }
}

function assertRefusal(action: () => unknown, pattern: RegExp): void {
  assert.throws(action, (error: unknown) => error instanceof DomainValidationError && pattern.test(error.message));
}

test("clean preflight pins HEAD and freezes a copied host verification snapshot", async () => {
  await withFixture(async ({ repo }) => {
    const args = ["-e", "process.exit(0)"];
    const request = { sourceRepo: repo, objective: "  change value  ", verification: { command: process.execPath, args } };
    const result = prepareNativeWrite(request);
    assert.equal(result.sourceRepo, path.resolve(repo));
    assert.equal(result.objective, "change value");
    assert.equal(result.revision, git(repo, ["rev-parse", "HEAD"]).trim());
    assert.deepEqual(result.verification.args, ["-e", "process.exit(0)"]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.verification));
    assert.ok(Object.isFrozen(result.verification.args));
    args[0] = "mutated";
    assert.deepEqual(result.verification.args, ["-e", "process.exit(0)"]);
    assert.throws(() => (result.verification.args as string[]).push("mutated"), TypeError);
  });
});

test("equivalent root syntax is accepted while subdirectories and nonrepositories are refused", async () => {
  await withFixture(async ({ root, repo }) => {
    assert.equal(prepareNativeWrite(input(`${repo}${path.sep}.`)).sourceRepo, path.resolve(repo));
    const subdirectory = path.join(repo, "src");
    await mkdir(subdirectory);
    assertRefusal(() => prepareNativeWrite(input(subdirectory)), /toplevel|repository|root/i);
    assertRefusal(() => prepareNativeWrite(input(root)), /git|repository|preflight/i);
  });
});

for (const dirty of ["staged", "unstaged", "untracked"] as const) {
  test(`refuses ${dirty} source changes without mutating the source`, async () => {
    await withFixture(async ({ repo }) => {
      if (dirty === "staged") {
        await writeFile(path.join(repo, "staged.txt"), "staged\n");
        git(repo, ["add", "staged.txt"]);
      } else if (dirty === "unstaged") {
        await writeFile(path.join(repo, "value.txt"), "changed\n");
      } else {
        await writeFile(path.join(repo, "untracked.txt"), "untracked\n");
      }
      const before = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      assertRefusal(() => prepareNativeWrite(input(repo)), /clean|change|dirty/i);
      assert.equal(git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]), before);
    });
  });
}

test("does not silently ignore untracked user code under a committed ignore rule", async () => {
  await withFixture(async ({ repo }) => {
    await writeFile(path.join(repo, ".gitignore"), "ignored/\n");
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-m", "ignore rule"]);
    await mkdir(path.join(repo, "ignored"));
    await writeFile(path.join(repo, "ignored", "user-code.ts"), "export const value = 1;\n");
    assertRefusal(() => prepareNativeWrite(input(repo)), /clean|ignored|change|dirty/i);
  });
});

test("rejects pre-abort and invalid runtime inputs", async () => {
  await withFixture(async ({ root, repo }) => {
    const controller = new AbortController();
    controller.abort();
    assertRefusal(() => prepareNativeWrite({ ...input(repo), signal: controller.signal }), /abort/i);
    const invalid = [
      undefined,
      null,
      { ...input(repo), objective: "   " },
      { ...input(repo), verification: undefined },
      { ...input(repo), verification: { command: "   " } },
      { ...input(repo), verification: { command: process.execPath, args: "bad" } },
      { ...input(repo), verification: { command: process.execPath, args: ["ok", 1] } },
      { ...input(repo), sourceRepo: root, objective: "" }
    ];
    for (const value of invalid) {
      assertRefusal(() => prepareNativeWrite(value as unknown as NativeWritePreflightInput), /required|args|objective|verification|repository|git|input/i);
    }
  });
});

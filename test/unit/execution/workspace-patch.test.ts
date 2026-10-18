import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { patchWorkspaceFile } from "../../../src/execution/workspace-patch.js";

async function fixture(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "workspace-patch-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("exact patch changes one UTF-8 occurrence and preserves surrounding bytes", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "value.ts"), "// 示例\r\nconst value = 1;\r\n");
    assert.deepEqual(await patchWorkspaceFile({ worktreeRoot: root }, {
      path: "value.ts", oldText: "value = 1", newText: "value = 2"
    }), { resolvedPath: "value.ts", replacements: 1 });
    assert.equal(await readFile(join(root, "value.ts"), "utf8"), "// 示例\r\nconst value = 2;\r\n");
  });
});

test("absent or ambiguous old text leaves the original file unchanged", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "value.txt"), "aaa");
    for (const oldText of ["missing", "aa", ""]) {
      await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
        path: "value.txt", oldText, newText: "x"
      }), /unique|non-empty/);
      assert.equal(await readFile(join(root, "value.txt"), "utf8"), "aaa");
    }
  });
});

test("patch refuses escaping and outside symlink paths", async () => {
  await fixture(async (root) => {
    await fixture(async (outside) => {
      const target = join(outside, "value.txt");
      await writeFile(target, "original");
      await symlink(outside, join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
      for (const path of ["../value.txt", "outside/value.txt"]) {
        await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
          path, oldText: "original", newText: "changed"
        }), /escape refused/);
      }
      assert.equal(await readFile(target, "utf8"), "original");
    });
  });
});

test("cancelled, oversized, binary and invalid patches never mutate", async () => {
  await fixture(async (root) => {
    const path = join(root, "value.txt");
    const original = "0123456789";
    await writeFile(path, original);
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root, signal: AbortSignal.abort() }, {
      path: "value.txt", oldText: "0", newText: "x"
    }), /abort|cancel/i);
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root, maxReadBytes: 4 }, {
      path: "value.txt", oldText: "0", newText: "x"
    }), /maxReadBytes/);
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
      path: "value.txt", oldText: "0", newText: "x".repeat(1024 * 1024 + 1)
    }), /maxReadBytes/);
    assert.equal(await readFile(path, "utf8"), original);
    await writeFile(path, Buffer.from([0xff, 0x00, 0x61]));
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
      path: "value.txt", oldText: "a", newText: "b"
    }), /UTF-8|binary/);
    assert.deepEqual(await readFile(path), Buffer.from([0xff, 0x00, 0x61]));
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
      path: "value.txt", oldText: "a", newText: 1 as unknown as string
    }), /string/);
  });
});


test("exact patch refuses a directory before opening it for writing", async () => {
  await fixture(async (root) => {
    await mkdir(join(root, "directory"));
    await assert.rejects(() => patchWorkspaceFile({ worktreeRoot: root }, {
      path: "directory", oldText: "a", newText: "b"
    }), /regular file/);
  });
});

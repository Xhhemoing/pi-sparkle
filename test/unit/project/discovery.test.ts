import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverProject } from "../../../src/project/discovery.js";

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
) {
  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-proj-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const path = join(root, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("discovers instruction files, manifests, commands, and the git root", async () => {
  await withProject(
    {
      "AGENTS.md": "# Agent instructions",
      "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "tsc -b" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      ".git/HEAD": "ref: refs/heads/main"
    },
    async (root) => {
      const snapshot = await discoverProject(root);
      assert.deepEqual(snapshot.rootPath, root);
      assert.deepEqual(snapshot.gitRootPath, root);
      assert.deepEqual(snapshot.instructionFiles, [{ path: join(root, "AGENTS.md") }]);
      assert.deepEqual(snapshot.manifests, [{ path: join(root, "package.json") }]);
      assert.deepEqual(snapshot.commands, [
        { name: "test", command: "vitest run" },
        { name: "build", command: "tsc -b" }
      ]);
      assert.deepEqual(snapshot.facts, [
        { key: "package_manager", value: "pnpm", confidence: "HIGH" },
        { key: "git_root", value: root, confidence: "HIGH" }
      ]);
      assert.ok(snapshot.id.startsWith("prj_"));
    }
  );
});

test("canonicalizes a root with traversal segments", async () => {
  await withProject(
    { "package.json": JSON.stringify({}) },
    async (root) => {
      await mkdir(join(root, "sub"));
      const snapshot = await discoverProject(join(root, "sub", ".."));
      assert.equal(snapshot.rootPath, root);
    }
  );
});

test("records no commands when package.json has no recognized scripts", async () => {
  await withProject(
    { "package.json": JSON.stringify({ scripts: { publish: "npm publish" } }) },
    async (root) => {
      const snapshot = await discoverProject(root);
      assert.deepEqual(snapshot.commands, []);
    }
  );
});

test("walks up to a parent git root", async () => {
  await withProject(
    { ".git/HEAD": "ref: refs/heads/main", "sub/dir/AGENTS.md": "# x" },
    async (root) => {
      const snapshot = await discoverProject(join(root, "sub", "dir"));
      assert.equal(snapshot.gitRootPath, root);
      assert.deepEqual(snapshot.instructionFiles, [{ path: join(root, "sub", "dir", "AGENTS.md") }]);
    }
  );
});

test("rejects a missing root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sparkle-proj-"));
  try {
    await assert.rejects(() => discoverProject(join(root, "missing")), /root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a non-directory root", async () => {
  await withProject({ "file.txt": "x" }, async (root) => {
    await assert.rejects(() => discoverProject(join(root, "file.txt")), /not a directory/);
  });
});

test("tolerates an unparsable package.json without commands", async () => {
  await withProject({ "package.json": "{broken" }, async (root) => {
    const snapshot = await discoverProject(root);
    assert.deepEqual(snapshot.commands, []);
  });
});

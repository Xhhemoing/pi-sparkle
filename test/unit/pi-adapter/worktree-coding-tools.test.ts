import assert from "node:assert/strict";
import { existsSync, symlinkSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";

function linkParentDir(target: string, link: string): void {
  if (process.platform === "win32") {
    symlinkSync(target, link, "junction");
    return;
  }
  symlinkSync(target, link);
}

async function toolByName(root: string, name: string, commandPolicy?: Parameters<typeof createWorktreeCodingTools>[0]["commandPolicy"]) {
  const tools = createWorktreeCodingTools({ worktreeRoot: root, ...(commandPolicy ? { commandPolicy } : {}) });
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

test("coding tools actually read and write inside the worktree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/hello.txt"), "hi\n", "utf8");

  const read = await toolByName(root, "sparkle_read_file");
  const readOut = await read.execute("tc1", { path: "src/hello.txt" });
  assert.equal(readOut.content[0]?.type, "text");
  assert.equal((readOut.content[0] as { text: string }).text, "hi\n");
  assert.deepEqual(readOut.details, {
    resolvedPath: "src/hello.txt"
  });

  const write = await toolByName(root, "sparkle_write_file");
  await write.execute("tc2", { path: "src/hello.txt", contents: "edited\n" });
  const again = await read.execute("tc3", { path: "src/hello.txt" });
  assert.equal((again.content[0] as { text: string }).text, "edited\n");
});

test("coding tools refuse path escape on read and write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  const read = await toolByName(root, "sparkle_read_file");
  await assert.rejects(() => read.execute("tc", { path: "../outside.txt" }), /path escape refused/);
  const write = await toolByName(root, "sparkle_write_file");
  await assert.rejects(
    () => write.execute("tc", { path: "../outside.txt", contents: "x" }),
    /path escape refused/
  );
});

test("sparkle_run_command default-denies without commandPolicy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  const run = await toolByName(root, "sparkle_run_command");
  await assert.rejects(
    () => run.execute("tc", { command: "node", args: ["-e", "process.exit(0)"] }),
    /commandPolicy required|denied/
  );
});

test("sparkle_run_command executes when host allows node -e", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  await writeFile(path.join(root, "marker.txt"), "yes\n", "utf8");
  const run = await toolByName(root, "sparkle_run_command", {
    allow: [{ executable: "node", argvPrefix: ["-e"], maxArgs: 8 }],
    envAllowlist: [],
    timeoutMs: 30_000
  });
  const out = await run.execute("tc", {
    command: "node",
    args: ["-e", "const fs=require('fs'); process.exit(fs.existsSync('marker.txt')?0:2)"]
  });
  const payload = JSON.parse((out.content[0] as { text: string }).text) as {
    exitCode: number;
    cwd: string;
  };
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.cwd, root);
});

test("sparkle_run_command refuses unauthorized executable and does not leak host secret env", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  process.env.G1B_FIXTURE_SECRET = "should-not-appear";
  try {
    const run = await toolByName(root, "sparkle_run_command", {
      allow: [{ executable: "node", argvPrefix: ["-e"] }],
      envAllowlist: []
    });
    await assert.rejects(() => run.execute("tc", { command: "python", args: [] }), /not allowed|denied/);
    const out = await run.execute("tc", {
      command: "node",
      args: ["-e", "process.stdout.write(process.env.G1B_FIXTURE_SECRET||'ABSENT')"]
    });
    const payload = JSON.parse((out.content[0] as { text: string }).text) as { stdout: string };
    assert.equal(payload.stdout, "ABSENT");
  } finally {
    delete process.env.G1B_FIXTURE_SECRET;
  }
});

test("sparkle_write_file refuses dangling file symlink and does not create the outside target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  const outside = await mkdtemp(path.join(tmpdir(), "sparkle-out-"));
  try {
    const outsideTarget = path.join(outside, "pwned.txt");
    symlinkSync(outsideTarget, path.join(root, "link.txt"));
    const write = await toolByName(root, "sparkle_write_file");
    await assert.rejects(
      () => write.execute("tc", { path: "link.txt", contents: "ESCAPED\n" }),
      /path escape refused|broken symlink/
    );
    assert.equal(existsSync(outsideTarget), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("sparkle_write_file refuses parent dir link/junction and does not create outside", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  const outside = await mkdtemp(path.join(tmpdir(), "sparkle-out-"));
  try {
    linkParentDir(outside, path.join(root, "ext"));
    const write = await toolByName(root, "sparkle_write_file");
    await assert.rejects(
      () => write.execute("tc", { path: "ext/new.txt", contents: "ESCAPED\n" }),
      /path escape refused|symlink/
    );
    assert.equal(existsSync(path.join(outside, "new.txt")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("sparkle_write_file creates a normal in-root new file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  try {
    const write = await toolByName(root, "sparkle_write_file");
    const read = await toolByName(root, "sparkle_read_file");
    await write.execute("tc", { path: "src/new.txt", contents: "fresh\n" });
    const out = await read.execute("tc2", { path: "src/new.txt" });
    assert.equal((out.content[0] as { text: string }).text, "fresh\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coding tools expose bounded discovery, literal search, range read and exact patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-discovery-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src/value.ts"), "// header\nexport const value = 1;\n// footer\n");
    const list = await toolByName(root, "sparkle_list_files");
    const listed = await list.execute("list", {});
    assert.deepEqual(JSON.parse((listed.content[0] as { text: string }).text), {
      paths: ["src/value.ts"], truncated: false
    });
    const search = await toolByName(root, "sparkle_search_files");
    const found = await search.execute("search", { query: "value = 1" });
    assert.deepEqual(JSON.parse((found.content[0] as { text: string }).text), {
      matches: [{ path: "src/value.ts", line: 2, text: "export const value = 1;" }], truncated: false
    });
    const read = await toolByName(root, "sparkle_read_file");
    const excerpt = await read.execute("range", { path: "src/value.ts", startLine: 2, endLine: 2 });
    assert.equal((excerpt.content[0] as { text: string }).text, "export const value = 1;\n");
    assert.equal((excerpt.details as { startLine: number }).startLine, 2);
    const patch = await toolByName(root, "sparkle_patch_file");
    await patch.execute("patch", { path: "src/value.ts", oldText: "value = 1", newText: "value = 2" });
    const result = await read.execute("whole", { path: "src/value.ts" });
    assert.equal((result.content[0] as { text: string }).text, "// header\nexport const value = 2;\n// footer\n");
    assert.deepEqual(result.details, { resolvedPath: "src/value.ts" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("new coding tool parameters fail closed and cancelled patch preserves bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-discovery-"));
  try {
    await writeFile(path.join(root, "value.txt"), "original");
    const tools = createWorktreeCodingTools({ worktreeRoot: root, signal: AbortSignal.abort() });
    for (const name of ["sparkle_list_files", "sparkle_search_files", "sparkle_patch_file"]) {
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool);
      const params = name === "sparkle_search_files" ? { query: "original" } : name === "sparkle_patch_file"
        ? { path: "value.txt", oldText: "original", newText: "changed" } : {};
      await assert.rejects(() => tool.execute("cancel", params), /abort|cancel/i);
    }
    const read = await toolByName(root, "sparkle_read_file");
    assert.equal((await read.execute("read", { path: "value.txt" })).content[0]?.type, "text");
    await assert.rejects(() => read.execute("invalid-range", { path: "value.txt", startLine: "1" }), /line|Line/);
    const search = await toolByName(root, "sparkle_search_files");
    await assert.rejects(() => search.execute("invalid-query", { query: "" }), /query/);
    const list = await toolByName(root, "sparkle_list_files");
    await assert.rejects(() => list.execute("invalid-limit", { limit: 0 }), /limit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

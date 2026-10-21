import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles } from "../../../src/execution/workspace-files.js";

async function fixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-files-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("workspace whole read preserves UTF-8 text and canonical relative path", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(path.join(f.root, "src"));
  await writeFile(path.join(f.root, "src/a.txt"), "你好\r\nworld\n");
  assert.deepEqual(await readWorkspaceFile({ worktreeRoot: f.root }, { path: "src/../src/a.txt" }), {
    text: "你好\r\nworld\n", resolvedPath: "src/a.txt"
  });
});

test("workspace range read preserves UTF-8 and CRLF and reports one-based bounds", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "a.txt"), "first\r\n中文\r\nlast");
  assert.deepEqual(await readWorkspaceFile({ worktreeRoot: f.root }, { path: "a.txt", startLine: 2, endLine: 2 }), {
    text: "中文\r\n", resolvedPath: "a.txt", startLine: 2, endLine: 2
  });
  assert.deepEqual(await readWorkspaceFile({ worktreeRoot: f.root }, { path: "a.txt", startLine: 2, endLine: 9 }), {
    text: "中文\r\nlast", resolvedPath: "a.txt", startLine: 2, endLine: 3, totalLines: 3
  });
});

test("workspace range can excerpt a file larger than the whole-read limit", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "large.txt"), "wanted\n" + "x".repeat(1024 * 1024 + 1));
  const ctx = { worktreeRoot: f.root };
  await assert.rejects(readWorkspaceFile(ctx, { path: "large.txt" }), /maxReadBytes/);
  assert.equal((await readWorkspaceFile(ctx, { path: "large.txt", endLine: 1 })).text, "wanted\n");
});

test("workspace range scans a finite prefix and refuses overlong selected lines", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "large.txt"), "x".repeat(16 * 1024 * 1024 + 1));
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: "large.txt", startLine: 2, endLine: 2 }), /scan|limit/);
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root, maxReadBytes: 8 }, { path: "large.txt", endLine: 1 }), /maxReadBytes/);
});

test("workspace read enforces whole-read limits, regular files, and out-of-range lines", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "a.txt"), "first\nlast\n");
  await writeFile(path.join(f.root, "empty.txt"), "");
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root, maxReadBytes: 4 }, { path: "a.txt" }), /maxReadBytes/);
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: "." }), /regular file/);
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: "a.txt", startLine: 3 }), /line|range/);
  assert.equal((await readWorkspaceFile({ worktreeRoot: f.root }, { path: "empty.txt" })).text, "");
});

test("workspace discovery is lexical, relative, and skips excluded roots and traversal links", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const outside = await fixture(); t.after(outside.cleanup);
  await writeFile(path.join(outside.root, "secret.txt"), "needle");
  for (const dir of ["z", "a", ".git", "node_modules", ".agent_workspace", "a/node_modules"]) {
    await mkdir(path.join(f.root, dir), { recursive: true });
    await writeFile(path.join(f.root, dir, "hidden.txt"), "needle");
  }
  await writeFile(path.join(f.root, "b.txt"), "needle");
  await symlink(path.join(f.root, "a"), path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
  await symlink(outside.root, path.join(f.root, "outside"), process.platform === "win32" ? "junction" : "dir");
  const ctx = { worktreeRoot: f.root };
  assert.deepEqual(await listWorkspaceFiles(ctx, {}), { paths: ["a/hidden.txt", "b.txt", "z/hidden.txt"], truncated: false });
  assert.deepEqual(await listWorkspaceFiles(ctx, { path: "a" }), { paths: ["a/hidden.txt"], truncated: false });
  assert.deepEqual(await listWorkspaceFiles(ctx, { path: "b.txt" }), { paths: ["b.txt"], truncated: false });
  assert.deepEqual(await listWorkspaceFiles(ctx, { limit: 1 }), { paths: ["a/hidden.txt"], truncated: true });
});

test("workspace search skips NUL and malformed UTF-8 files with visible truncation", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "a-nul.bin"), Buffer.from("needle\0binary"));
  await writeFile(path.join(f.root, "b-invalid.bin"), Buffer.from([110, 101, 101, 100, 108, 101, 255]));
  await writeFile(path.join(f.root, "c-text.txt"), "needle 中文");
  assert.deepEqual(await searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "needle" }), {
    matches: [{ path: "c-text.txt", line: 1, text: "needle 中文" }], truncated: true
  });
});

test("workspace discovery retains containment and link policy through an ancestor root alias", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const root = path.join(f.root, "physical", "candidate");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, "src/a.txt"), "needle\n");
  await writeFile(path.join(root, ".git/config"), "needle");
  await writeFile(path.join(f.root, "outside.txt"), "needle");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(path.join(f.root, "physical"), path.join(f.root, "alias"), linkType);
  await symlink(path.join(root, "src"), path.join(root, "linked"), linkType);
  await symlink(f.root, path.join(root, "outside"), linkType);
  const ctx = { worktreeRoot: path.join(f.root, "alias", "candidate") };
  assert.equal((await readWorkspaceFile(ctx, { path: "src/a.txt" })).text, "needle\n");
  assert.deepEqual(await listWorkspaceFiles(ctx, {}), { paths: ["src/a.txt"], truncated: false });
  assert.deepEqual(await listWorkspaceFiles(ctx, { path: path.join(ctx.worktreeRoot, "src") }), { paths: ["src/a.txt"], truncated: false });
  assert.deepEqual(await searchWorkspaceFiles(ctx, { query: "needle", path: "src" }), {
    matches: [{ path: "src/a.txt", line: 1, text: "needle" }], truncated: false
  });
  assert.deepEqual(await listWorkspaceFiles(ctx, { path: "linked" }), { paths: [], truncated: false });
  assert.deepEqual(await searchWorkspaceFiles(ctx, { path: "linked", query: "needle" }), { matches: [], truncated: false });
  for (const input of ["outside/outside.txt", "../outside.txt", path.join(f.root, "outside.txt"), ".git/config"]) {
    await assert.rejects(listWorkspaceFiles(ctx, { path: input }), /escape|excluded/);
    await assert.rejects(searchWorkspaceFiles(ctx, { path: input, query: "needle" }), /escape|excluded/);
  }
});

test("workspace literal search is lexical and counts source lines without interpreting regex", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(path.join(f.root, "src"));
  await writeFile(path.join(f.root, "z.txt"), "axb\na.b\n");
  await writeFile(path.join(f.root, "src/a.txt"), "first\r\na.b 中文\r\nlast\n");
  assert.deepEqual(await searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "a.b" }), {
    matches: [{ path: "src/a.txt", line: 2, text: "a.b 中文" }, { path: "z.txt", line: 2, text: "a.b" }], truncated: false
  });
  assert.deepEqual(await searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "a.b", path: "src", limit: 1 }), {
    matches: [{ path: "src/a.txt", line: 2, text: "a.b 中文" }], truncated: true
  });
});

test("workspace search marks oversized skipped files and bounded match text as truncated", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "a-large.txt"), "needle" + "x".repeat(1024 * 1024));
  await writeFile(path.join(f.root, "b.txt"), "needle" + "x".repeat(5000));
  const result = await searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "needle" });
  assert.equal(result.truncated, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.path, "b.txt");
  assert.ok(Buffer.byteLength(result.matches[0]?.text ?? "") <= 4096);
});

test("workspace tools reject escape and outside symlinks/junctions; discovery refuses excluded paths", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const outside = await fixture(); t.after(outside.cleanup);
  await writeFile(path.join(outside.root, "secret.txt"), "needle");
  await mkdir(path.join(f.root, ".git"));
  await writeFile(path.join(f.root, ".git/config"), "needle");
  await symlink(outside.root, path.join(f.root, "outside"), process.platform === "win32" ? "junction" : "dir");
  for (const input of ["../secret.txt", path.join(outside.root, "secret.txt"), "outside/secret.txt"]) {
    await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: input }), /escape|excluded/);
    await assert.rejects(listWorkspaceFiles({ worktreeRoot: f.root }, { path: input }), /escape|excluded/);
    await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { path: input, query: "needle" }), /escape|excluded/);
  }
  await assert.rejects(listWorkspaceFiles({ worktreeRoot: f.root }, { path: ".git/config" }), /excluded/);
  await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { path: ".git/config", query: "needle" }), /excluded/);
  // Explicit reads retain the previous tool's path permissions, including when
  // a caller elects to excerpt a file omitted from automatic discovery.
  assert.equal((await readWorkspaceFile({ worktreeRoot: f.root }, { path: ".git/config" })).text, "needle");
  assert.equal((await readWorkspaceFile({ worktreeRoot: f.root }, { path: ".git/config", endLine: 1 })).text, "needle");
});

test("workspace inputs reject invalid ranges, limits, queries and read budgets", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "a.txt"), "a\nb");
  for (const limit of [0, -1, 1.5, 1001, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(listWorkspaceFiles({ worktreeRoot: f.root }, { limit }), /limit/);
    await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "a", limit }), /limit/);
  }
  for (const range of [{ startLine: 0 }, { startLine: 1.5 }, { endLine: -1 }, { startLine: 3, endLine: 2 }, { endLine: Number.POSITIVE_INFINITY }]) {
    await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: "a.txt", ...range }), /Line|range/);
  }
  for (const maxReadBytes of [0, -1, 1.5, 1024 * 1024 + 1]) {
    await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root, maxReadBytes }, { path: "a.txt" }), /maxReadBytes/);
  }
  for (const query of ["", "a\nb", "x".repeat(4097)]) {
    await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { query }), /query/);
  }
  const nullNumber = null as unknown as number;
  const nullPath = null as unknown as string;
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root }, { path: "a.txt", startLine: nullNumber }), /startLine/);
  await assert.rejects(readWorkspaceFile({ worktreeRoot: f.root, maxReadBytes: nullNumber }, { path: "a.txt" }), /maxReadBytes/);
  await assert.rejects(listWorkspaceFiles({ worktreeRoot: f.root }, { limit: nullNumber }), /limit/);
  await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "a", limit: nullNumber }), /limit/);
  await assert.rejects(listWorkspaceFiles({ worktreeRoot: f.root }, { path: nullPath }), /path/);
  await assert.rejects(searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "a", path: nullPath }), /path/);
});

test("workspace tools observe pre-cancellation before accessing paths", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const controller = new AbortController(); controller.abort();
  const ctx = { worktreeRoot: f.root, signal: controller.signal };
  await assert.rejects(readWorkspaceFile(ctx, { path: "missing" }), /cancel|abort/i);
  await assert.rejects(listWorkspaceFiles(ctx, {}), /cancel|abort/i);
  await assert.rejects(searchWorkspaceFiles(ctx, { query: "needle" }), /cancel|abort/i);
});

test("workspace read and discovery observe cancellation during IO", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, "large.txt"), "x".repeat(16 * 1024 * 1024 + 1));
  const controller = new AbortController();
  const pending = readWorkspaceFile({ worktreeRoot: f.root, signal: controller.signal }, { path: "large.txt", startLine: 2 });
  setImmediate(() => controller.abort());
  await assert.rejects(pending, /cancel|abort/i);
  const listController = new AbortController();
  const listing = listWorkspaceFiles({ worktreeRoot: f.root, signal: listController.signal }, {});
  setImmediate(() => listController.abort());
  await assert.rejects(listing, /cancel|abort/i);
});

test("workspace traversal omits an overfull directory deterministically with a finite visit cap", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(path.join(f.root, "crowded"));
  for (let offset = 0; offset < 10001; offset += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 10001 - offset) }, (_, index) =>
      writeFile(path.join(f.root, "crowded", `f${String(offset + index).padStart(5, "0")}`), "needle")));
  }
  assert.deepEqual(await listWorkspaceFiles({ worktreeRoot: f.root }, {}), { paths: [], truncated: true });
  assert.deepEqual(await searchWorkspaceFiles({ worktreeRoot: f.root }, { query: "needle" }), { matches: [], truncated: true });
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";

async function toolByName(root: string, name: string) {
  const tools = createWorktreeCodingTools({ worktreeRoot: root });
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

test("sparkle_run_command executes with cwd bound to worktree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-coding-"));
  await writeFile(path.join(root, "marker.txt"), "yes\n", "utf8");
  const run = await toolByName(root, "sparkle_run_command");
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

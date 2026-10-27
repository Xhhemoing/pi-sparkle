import assert from "node:assert/strict";
import cp, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { access, mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

function git(cwd: string, args: string[]): string { const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
async function fixture() {
  const parent = path.resolve(".agent_workspace/phase1-task-session"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "retained-")), sourceRepo = path.join(root, "source"), candidatePath = path.join(root, "candidate");
  await mkdir(sourceRepo); git(sourceRepo, ["init", "-b", "fixture"]); git(sourceRepo, ["config", "user.name", "Retained fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8"); await writeFile(path.join(sourceRepo, ".gitignore"), "ignored/\n", "utf8");
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]); git(sourceRepo, ["worktree", "add", "--detach", candidatePath, sourceRevision]);
  await writeFile(path.join(candidatePath, "value.txt"), "owned dirty candidate", "utf8");
  const api = await import("../../../src/native/retained-candidate.js");
  const handle = api.holdRetainedCandidate({ sourceRepo, candidatePath, sourceRevision });
  return { root, sourceRepo, sourceRevision, candidatePath, api, handle };
}
test("a genuine retained handle removes exactly its held dirty worktree and retains source", async () => {
  const f = await fixture(); let prepared = false;
  const result = await f.api.discardRetainedCandidate({ handle: f.handle, onPrepared: async () => { prepared = true; await access(f.candidatePath); } });
  assert.equal(prepared, true); assert.equal(result.status, "DISPOSED"); await assert.rejects(access(f.candidatePath), { code: "ENOENT" });
  assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.sourceRevision);
});
for (const changed of ["json", "bytes", "ignored", "index", "head", "locked", "replacement"] as const) test(`retained discard refuses ${changed} rather than deleting new data`, async () => {
  const f = await fixture(); let handle = f.handle;
  if (changed === "json") handle = JSON.parse(JSON.stringify(handle));
  if (changed === "bytes") await writeFile(path.join(f.candidatePath, "value.txt"), "later user change", "utf8");
  if (changed === "ignored") { await mkdir(path.join(f.candidatePath, "ignored")); await writeFile(path.join(f.candidatePath, "ignored/user.txt"), "user", "utf8"); }
  if (changed === "index") git(f.candidatePath, ["add", "value.txt"]);
  if (changed === "head") { git(f.candidatePath, ["add", "."]); git(f.candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "changed head"]); }
  if (changed === "locked") git(f.sourceRepo, ["worktree", "lock", f.candidatePath]);
  if (changed === "replacement") { const saved = path.join(f.root, "saved-candidate"); await rename(f.candidatePath, saved); await symlink(saved, f.candidatePath, "junction"); }
  await assert.rejects(f.api.discardRetainedCandidate({ handle })); await access(f.candidatePath);
});
test("retained discard rechecks after prepared persistence and never removes callback additions", async () => {
  const f = await fixture();
  await assert.rejects(f.api.discardRetainedCandidate({ handle: f.handle, onPrepared: async () => {
    await writeFile(path.join(f.candidatePath, "later.txt"), "user addition", "utf8");
  } })); await access(path.join(f.candidatePath, "later.txt"));
});
test("a failed Git removal has one attempt and no recursive or prune fallback", async () => {
  const f = await fixture(), original = cp.spawnSync; let removals = 0, prunes = 0;
  cp.spawnSync = ((...args: Parameters<typeof cp.spawnSync>) => {
    const argv = args[1];
    if (Array.isArray(argv) && argv.includes("worktree") && argv.includes("remove")) { removals++; return { pid: 0, output: [], stdout: "", stderr: "synthetic Git deletion refusal", status: 1, signal: null }; }
    if (Array.isArray(argv) && argv.includes("prune")) prunes++;
    return original(...args);
  }) as typeof cp.spawnSync; syncBuiltinESMExports();
  try { await assert.rejects(f.api.discardRetainedCandidate({ handle: f.handle }), /synthetic Git deletion refusal/); }
  finally { cp.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(removals, 1); assert.equal(prunes, 0); await access(f.candidatePath);
});

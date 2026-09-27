import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Both implementations see the SAME fixture in the SAME process/runner.
// The baseline checkout is pinned by the accompanying workflow.
const baselineDir = process.argv[2];
assert.ok(baselineDir, "supply the pinned baseline checkout path");
const { prepareNativeWrite: baseline } = await import(pathToFileURL(path.resolve(baselineDir, "src/native/write-preflight.ts")).href);
const { prepareNativeWrite: current } = await import("../src/native/write-preflight.ts");
const root = mkdtempSync(path.join(tmpdir(), "sparkle-root-"));
const repo = path.join(root, "repo with spaces");
const git = (args) => {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  mkdirSync(repo);
  git(["init"]);
  git(["config", "user.name", "Root Regression"]);
  git(["config", "user.email", "test@example.com"]);
  writeFileSync(path.join(repo, "value.txt"), "fixture\n");
  git(["add", "value.txt"]);
  git(["commit", "-m", "fixture"]);
  const top = git(["rev-parse", "--show-toplevel"]);
  const identity = (p) => { const s = statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };
  const input = { sourceRepo: repo, objective: "inspect root", verification: { command: process.execPath, args: ["--version"] } };
  const call = (fn) => {
    try { return { accepted: true, sourceRepo: fn(input).sourceRepo }; }
    catch (error) { return { accepted: false, error: String(error) }; }
  };
  const before = git(["status", "--porcelain=v1", "-z", "--ignored"]);
  const baseResult = call(baseline);
  const headResult = call(current);
  console.log("ROOT_BASELINE_COMPARISON " + JSON.stringify({
    platform: process.platform, node: process.version,
    baseline: "1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d",
    requested: path.resolve(repo), top: path.resolve(top),
    requestedReal: realpathSync.native(repo), topReal: realpathSync.native(top),
    requestedId: identity(repo), topId: identity(top), baseResult, headResult
  }));
  assert.equal(git(["status", "--porcelain=v1", "-z", "--ignored"]), before);
  assert.equal(headResult.accepted, true, "current preflight must accept the actual temporary repository root");
} finally {
  rmSync(root, { recursive: true, force: true });
}

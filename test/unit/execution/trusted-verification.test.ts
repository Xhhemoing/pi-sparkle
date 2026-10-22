import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";

async function fixture(body: (repo: string, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "trusted-check-"));
  const repo = path.join(root, "repo"); mkdirSync(repo);
  const git = (args: string[]): void => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init"]); git(["config", "user.email", "check@example.com"]); git(["config", "user.name", "Check"]);
  writeFileSync(path.join(repo, "value.txt"), "good"); git(["add", "."]); git(["commit", "-m", "fixture"]);
  try { await body(repo, root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("host-fixed inline verifier accepts exact unchanged bytes without persisting raw content", async () => {
  await fixture(async (cwd) => {
    const args = ["-e", "process.exit(0)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    args[1] = "process.exit(1)";
    const check = await runIndependentCheck({ cwd, command: process.execPath, args: trustedVerification.args, trustedVerification });
    assert.equal(check.ok, true); assert.equal(check.trustedVerification?.ok, true);
    assert.equal(Object.isFrozen(trustedVerification.snapshotManifest), true);
    assert.equal(JSON.stringify(check).includes('"type":"Buffer"'), false);
    assert.equal(JSON.stringify(check).includes("good"), false);
    const input = { independentCheck: check, artifactId: "art_v2_fixture", revision: check.revision, cwd,
      command: process.execPath, args: trustedVerification.args, trustedVerification };
    assert.equal(evaluateIndependentAcceptance(input).accepted, true);
    assert.equal(evaluateIndependentAcceptance({ ...input, independentCheck: JSON.parse(JSON.stringify(check)) }).accepted, false);
  });
});

test("same-length rewrite during host verification fails exact opt-in equality", async () => {
  await fixture(async (cwd) => {
    writeFileSync(path.join(cwd, "value.txt"), "bad1");
    const args = ["-e", "require('node:fs').writeFileSync('value.txt','bad2')"];
    const legacy = await runIndependentCheck({ cwd, command: process.execPath, args });
    assert.equal(legacy.ok, true, "legacy path/length semantics remain opt-out compatible");
    writeFileSync(path.join(cwd, "value.txt"), "bad1");
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    assert.equal(check.exitCode, 0); assert.equal(check.ok, false);
    assert.equal(check.trustedVerification?.ok, false);
    assert.match(check.trustedVerification?.reason ?? "", /candidate.*changed/);
  });
});

test("external checker or declared dependency rewrites after issuance refuse execution", async () => {
  await fixture(async (cwd, root) => {
    const checker = path.join(root, "check.cjs");
    const dependency = path.join(root, "rules.txt");
    const marker = path.join(root, "executed");
    writeFileSync(checker, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`);
    writeFileSync(dependency, "rule1");
    const args = [checker];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, checkerFiles: [checker, dependency] });
    writeFileSync(dependency, "rule2");
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification }), /checker.*changed/);
    assert.throws(() => readFileSync(marker), /ENOENT/);
  });
});

test("unchanged external checker and declared dependencies can be reused by their host", async () => {
  await fixture(async (cwd, root) => {
    const checker = path.join(root, "check.cjs");
    const dependency = path.join(root, "rules.txt");
    writeFileSync(checker, "process.exit(require('node:fs').readFileSync(process.argv[2],'utf8')==='rule1'?0:1)");
    writeFileSync(dependency, "rule1");
    const args = [checker, dependency];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, checkerFiles: [checker, dependency] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
      assert.equal(check.ok, true); assert.equal(check.trustedVerification?.ok, true);
    }
  });
});

test("checker definition changed during execution cannot pass even with exit zero", async () => {
  await fixture(async (cwd, root) => {
    const checker = path.join(root, "check.cjs");
    writeFileSync(checker, "const fs=require('node:fs');fs.writeFileSync(__filename,fs.readFileSync(__filename,'utf8').replace('same','diff')); //same");
    const args = [checker];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, checkerFiles: [checker] });
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    assert.equal(check.ok, false); assert.match(check.trustedVerification?.reason ?? "", /checker.*changed/);
  });
});

test("forged descriptor, changed args or manifest cannot run", async () => {
  await fixture(async (cwd) => {
    const args = ["-e", "process.exit(0)"];
    const manifest = { includePrefixes: ["value.txt"] };
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, snapshotManifest: manifest });
    manifest.includePrefixes.push("other");
    assert.deepEqual(trustedVerification.snapshotManifest.includePrefixes, ["value.txt"]);
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args: ["-e", "process.exit(1)"], trustedVerification }), /argv/);
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args, snapshotManifest: {}, trustedVerification }), /manifest/);
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification: { ...trustedVerification } }), /host-issued/);
  });
});

test("optional snapshot scope is frozen and cannot be overridden or widen to the whole candidate", async () => {
  await fixture(async (cwd) => {
    const args = ["-e", "process.exit(0)"];
    const manifest = { optionalIncludePrefixes: ["missing"] };
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, snapshotManifest: manifest });
    manifest.optionalIncludePrefixes.push("value.txt");
    assert.deepEqual(trustedVerification.snapshotManifest.optionalIncludePrefixes, ["missing"]);
    assert.equal(Object.isFrozen(trustedVerification.snapshotManifest.optionalIncludePrefixes), true);
    writeFileSync(path.join(cwd, "value.txt"), "unselected dirty file");
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    assert.equal(check.ok, true);
    assert.equal(check.trustedVerification?.candidateFileCount, 0);
    assert.deepEqual(check.contentFingerprintBefore.entries, []);
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification,
      snapshotManifest: { optionalIncludePrefixes: ["value.txt"] } }), /manifest/);
    const legacy = prepareTrustedVerification({ command: process.execPath, args });
    assert.equal(Object.hasOwn(legacy.snapshotManifest, "optionalIncludePrefixes"), false);
  });
});

test("trusted optional scope detects checker creation and same-length changes", async () => {
  await fixture(async (cwd) => {
    for (const contents of ["good", "evil"]) {
      const args = ["-e", `require('node:fs').writeFileSync('new.txt',${JSON.stringify(contents)})`];
      const trustedVerification = prepareTrustedVerification({ command: process.execPath, args,
        snapshotManifest: { optionalIncludePrefixes: ["new.txt", "unused"] } });
      const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
      assert.equal(check.exitCode, 0);
      assert.equal(check.ok, false);
      assert.equal(check.trustedVerification?.ok, false);
      assert.equal(readFileSync(path.join(cwd, "new.txt"), "utf8"), contents);
    }
  });
});

test("candidate-owned checker and oversized candidate snapshots fail closed before execution", async () => {
  await fixture(async (cwd) => {
    const checker = path.join(cwd, "check.cjs"); writeFileSync(checker, "process.exit(0)");
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args: [checker], checkerFiles: [checker] });
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args: [checker], trustedVerification }), /outside.*candidate/);
    const args = ["-e", "process.exit(0)"];
    const bounded = prepareTrustedVerification({ command: process.execPath, args, maxSnapshotBytes: 1 });
    await assert.rejects(runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification: bounded }), /snapshot.*(bytes|limit|exceeds)/);
  });
});

test("a linked candidate cwd cannot redirect the trusted invocation", { skip: process.platform === "win32" }, async () => {
  await fixture(async (cwd, root) => {
    const alias = path.join(root, "candidate-link"); symlinkSync(cwd, alias, "dir");
    const args = ["-e", "process.exit(0)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    await assert.rejects(runIndependentCheck({ cwd: alias, command: process.execPath, args, trustedVerification }), /candidate.*(linked|canonical)/);
  });
});

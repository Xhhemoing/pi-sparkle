// Explicit real-compiler measurement; machine timings are not a new default gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runTaskSpecPreflight } from "../../src/development/task-preflight.js";

function executable(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const value = path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
    if (existsSync(value)) return value;
  }
  return undefined;
}
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// Four fresh stdlib compiler targets model a small multi-target cold build.
// No sleep or previous output is used to make preparation exceed the allowance.
const prepare = `const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const [compiler,compilerPath]=process.argv.slice(1);fs.mkdirSync('.cache');
for(let i=0;i<4;i++){const output=path.resolve('.cache/check'+i+(process.platform==='win32'?'.exe':''));
if(fs.existsSync(output))throw Error('compiler output must start absent');
const result=spawnSync(compiler,['checks/check'+i+'.rs','-o',output],{encoding:'utf8',windowsHide:true,env:process.platform==='win32'?{}:{PATH:compilerPath}});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
console.log('FOUR_FRESH_TARGETS_COMPILED');`;
const check = `const {spawn}=require('node:child_process');const path=require('node:path');
Promise.all(Array.from({length:4},(_,i)=>new Promise(resolve=>{
const child=spawn(path.resolve('.cache/check'+i+(process.platform==='win32'?'.exe':'')),[],{windowsHide:true,env:{}});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.once('error',error=>{console.error(error.message);resolve(1)});child.once('close',code=>resolve(code===0?0:1));
}))).then(codes=>{process.exitCode=codes.some(code=>code!==0)?1:0;});`;

test("actual cold Rust preparation may exceed check allowance while all compiled base checks pass", async (t) => {
  const rustc = executable("rustc");
  const cc = process.platform === "win32" ? undefined : executable("cc");
  if (rustc === undefined || (process.platform !== "win32" && cc === undefined)) {
    t.skip("real Rust/linker unavailable; cold compiler preparation remains unverified"); return;
  }
  const parent = path.resolve(".agent_workspace/phase1-cold-prepare");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "fixture-"));
  const candidate = path.join(root, "candidate");
  let passed = false;
  try {
    await mkdir(path.join(candidate, "checks"), { recursive: true });
    await writeFile(path.join(candidate, "value.txt"), "unchanged\n", "utf8");
    await writeFile(path.join(candidate, ".gitignore"), ".cache/\n", "utf8");
    for (let i = 0; i < 4; i++) {
      await writeFile(path.join(candidate, `checks/check${i}.rs`),
        `fn main() { let actual: u64 = (1..=${1000 + i}).sum(); assert_eq!(actual, ${(1000 + i) * (1001 + i) / 2}); println!("COLD_CHECK_${i}_PASSED"); }\n`, "utf8");
    }
    git(candidate, "init"); git(candidate, "config", "core.autocrlf", "false");
    git(candidate, "config", "user.name", "Compiler fixture"); git(candidate, "config", "user.email", "fixture@example.invalid");
    git(candidate, "add", "."); git(candidate, "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    const revision = git(candidate, "rev-parse", "HEAD");
    const compilerPath = [...new Set([path.dirname(rustc), ...(cc === undefined ? [] : [path.dirname(cc)])])].join(path.delimiter);
    const checkAllowanceMs = 750;
    const result = await runTaskSpecPreflight({ candidatePath: candidate, sourceRevision: revision, stateRoot: path.join(root, "state"),
      spec: { version: 1, objective: "Verify a cold multi-target Rust build without spending the check allowance on compilation",
        context: ["value.txt"], write: { allow: ["value.txt"], protect: ["checks"] },
        prepare: [{ id: "compile", command: process.execPath, args: ["-e", prepare, rustc, compilerPath] }],
        checks: [{ id: "compiled-business", command: process.execPath, args: ["-e", check], verifierVersion: "cold-fixture-v1",
          protectedPaths: ["checks"], timeoutMs: checkAllowanceMs, expect: { baseline: "pass" } }],
        budget: { totalSeconds: 90, prepareSeconds: 60, checkSeconds: checkAllowanceMs / 1000, workerSeconds: 1 }, worker: { model: "inherit" } } });
    const evidence = JSON.parse(await readFile(result.artifactPath, "utf8"));
    t.diagnostic(JSON.stringify({ preparationMs: result.preparationMs, checksMs: result.checksMs, checkAllowanceMs, effectsSettled: result.effectsSettled }));
    assert.equal(result.ok, true, JSON.stringify(evidence));
    assert.equal(result.effectsSettled, true);
    assert.ok(result.preparationMs > checkAllowanceMs, "actual fresh compilation must exceed this fixture's check allowance");
    assert.ok(result.checksMs < checkAllowanceMs, "actual compiled checks must fit their separate allowance");
    assert.equal(evidence.preparation.length, 1);
    assert.match(evidence.preparation[0].result.stdoutText, /FOUR_FRESH_TARGETS_COMPILED/);
    assert.equal(evidence.checks[0].result.exitCode, 0);
    for (let i = 0; i < 4; i++) assert.match(evidence.checks[0].result.stdoutText, new RegExp(`COLD_CHECK_${i}_PASSED`));
    assert.equal(git(candidate, "rev-parse", "HEAD"), revision);
    assert.equal(git(candidate, "status", "--porcelain=v1"), "");
    assert.equal(await readFile(path.join(candidate, "value.txt"), "utf8"), "unchanged\n");
    passed = true;
  } finally {
    // Failed or unsettled compiler observations retain their private candidate.
    if (passed) { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
    else t.diagnostic(`Retained compiler evidence: ${root}`);
  }
});

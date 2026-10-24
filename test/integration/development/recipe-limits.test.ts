import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import { test } from "node:test";
import { checkDevelopmentRecipes } from "../../../src/development/recipe-check.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { reviewDevelopmentCandidate } from "../../../src/development/candidate-review.js";
import { createWorkQueue, type WorkItemRecipe } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function recipe(script: string, extra: object = {}): WorkItemRecipe {
  return { id: "check", command: process.execPath, args: ["-e", script], verifierVersion: "limits-v1", ...extra };
}
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function temporary(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-recipe-limits-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("a host cap permits ordinary checker stdout and stderr above the legacy 2 KiB limit", async () => {
  assert.equal(await checkDevelopmentRecipes([recipe("process.stdout.write('x'.repeat(3072)); process.stderr.write('y'.repeat(3072))",
    { maxStdoutBytes: 4096, maxStderrBytes: 4096 })]), "accepted");
});

test("a host deadline permits a real successful checker lasting more than five seconds", { timeout: 15000 }, async () => {
  const started = performance.now();
  assert.equal(await checkDevelopmentRecipes([recipe("setTimeout(() => {}, 5250)", { timeoutMs: 8000 })]), "accepted");
  assert.ok(performance.now() - started >= 5000);
});

test("default output overflow and configured timeout remain unavailable and stop later recipes", async () => temporary(async (root) => {
  const sentinel = path.join(root, "should-not-execute");
  const later = recipe(`require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`, { id: "later" });
  for (const first of [recipe("process.stdout.write('x'.repeat(3072))"),
    recipe("setTimeout(() => {}, 1000)", { timeoutMs: 20 })]) {
    assert.equal(await checkDevelopmentRecipes([first, later]), "unavailable");
    await assert.rejects(readFile(sentinel), { code: "ENOENT" });
  }
}));

test("all recipes are validated before an earlier command can run", async () => temporary(async (root) => {
  const sentinel = path.join(root, "should-not-execute");
  await assert.rejects(checkDevelopmentRecipes([
    recipe(`require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`),
    recipe("0", { id: "later", timeoutMs: 0 })
  ]));
  await assert.rejects(readFile(sentinel), { code: "ENOENT" });
}));

test("functional failures remain repair feedback while spawn failures stay unavailable", async () => {
  assert.equal(await checkDevelopmentRecipes([recipe("process.exit(1)")]), "failed");
  assert.equal(await checkDevelopmentRecipes([recipe("0", { command: path.join(tmpdir(), "sparkle-absent-recipe-executable") })]), "unavailable");
});

test("caller mutation during an awaited checker cannot replace a later host command or cap", async () => temporary(async (root) => {
  const sentinel = path.join(root, "mutated-command");
  const later = { ...recipe("process.stdout.write('x'.repeat(3072))", { id: "later", maxStdoutBytes: 4096 }),
    maxStdoutBytes: 4096, args: ["-e", "process.stdout.write('x'.repeat(3072))"] };
  const recipes = [recipe("setTimeout(() => {}, 150)"), later];
  const checked = checkDevelopmentRecipes(recipes);
  later.args[1] = `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`;
  later.maxStdoutBytes = 1;
  assert.equal(await checked, "accepted");
  await assert.rejects(readFile(sentinel), { code: "ENOENT" });
}));

test("controller run, historical review and explicit accept retain the host limits and source", async () => temporary(async (root) => {
  git(root, ["init"]); git(root, ["config", "user.name", "Recipe limits fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(root, "value.txt"), "before");
  git(root, ["add", "."]); git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  await temporary(async (stateRoot) => {
    const controller = new DevelopmentController({ sourceRepo: root, stateRoot, queuePath: path.join(stateRoot, "queue.json"),
      owner: "host", executorFactory: ({ tools }) => ({ async *execute(request, signal) {
        await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }) });
    const acceptance = [recipe("if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1); process.stdout.write('x'.repeat(3072))",
      { timeoutMs: 10000, maxStdoutBytes: 4096, maxStderrBytes: 4096 })];
    await controller.store.create(createWorkQueue({ id: "limits", authorityRef: "host:test", items: [{
      id: "change", goal: "Set value.txt to after", dependencies: [], allowedScope: ["value.txt"], priority: 90, acceptance
    }] }));
    const result = await controller.runNext({ maxAttempts: 2, maxWallTimeMs: 30000 });
    assert.equal(result.status, "ready-for-review");
    const review = await reviewDevelopmentCandidate({ sourceRepo: root, stateRoot,
      queuePath: path.join(stateRoot, "queue.json"), actionId: result.actionId! });
    assert.equal(review.historicalOnly, true);
    assert.equal(review.reverified, false);
    await controller.accept("change");
    const status = await controller.status();
    assert.equal(status.queue.items[0]?.status, "accepted");
    assert.deepEqual(status.queue.items[0]?.definition.acceptance, acceptance);
    assert.deepEqual(JSON.parse(status.actions[0]!.inputCanonicalJson).definition.acceptance, acceptance);
    assert.equal(await readFile(path.join(root, "value.txt"), "utf8"), "before");
    assert.equal(git(root, ["rev-parse", "HEAD"]), base);
    assert.equal(git(root, ["status", "--porcelain"]), "");
  });
}));
test("stored failed-recipe evidence preserves the diagnostic tail after verbose compiler output", async () => temporary(async (root) => {
  git(root, ["init"]); git(root, ["config", "user.name", "Recipe diagnostic fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(root, "value.txt"), "unchanged");
  git(root, ["add", "."]); git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const checker = fileURLToPath(new URL("../../../src/development/recipe-check.ts", import.meta.url));
  const recipes = [recipe("process.stdout.write('compile-start\\n'+'x'.repeat(5000)+'\\nstdout-final-detail'); process.stderr.write('compiler-preamble\\n'+'y'.repeat(5000)+'\\nerror: final diagnostic explains the failed check'); process.exitCode=1",
    { maxStdoutBytes: 8192, maxStderrBytes: 8192 })];
  const checked = await runIndependentCheck({ cwd: root, command: process.execPath,
    args: ["--import", import.meta.resolve("tsx"), checker, JSON.stringify(recipes)] });
  assert.equal(checked.ok, false);
  assert.equal(checked.exitCode, 1);
  const summary = JSON.parse(checked.stdoutText.split("\n")[0]!);
  assert.equal(summary.results[0].recipeId, "check");
  assert.equal(summary.results[0].status, "completed");
  assert.equal(summary.results[0].ok, false);
  assert.match(checked.stdoutText, /compile-start/);
  assert.match(checked.stdoutText, /stdout-final-detail/);
  assert.match(checked.stdoutText, /compiler-preamble/);
  assert.match(checked.stdoutText, /error: final diagnostic explains the failed check/);
  assert.ok(Buffer.byteLength(checked.stdoutText) <= 4096);
  assert.equal(await readFile(path.join(root, "value.txt"), "utf8"), "unchanged");
}));

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { main } from "../../../src/cli/main.js";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";

const CLI = fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
const PRIVATE_OUTPUT = "TASK_CLI_HIDDEN_CHECK_OUTPUT";
const MODEL = "loopback-task";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(options: { unpriced?: boolean; invalid?: boolean; onRequest?: () => void } = {}) {
  const parent = path.resolve(".agent_workspace/phase1-task-cli");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "actual-cli-"));
  const source = path.join(root, "source"), state = path.join(root, "state"), home = path.join(root, "home");
  await mkdir(path.join(source, "checks"), { recursive: true }); await mkdir(home);
  await writeFile(path.join(source, "value.txt"), "before", "utf8");
  await writeFile(path.join(source, "outside.txt"), "scope keeps this", "utf8");
  await writeFile(path.join(source, "AGENTS.md"), "TASK_CLI_AMBIENT_AGENTS_NOT_APPROVED", "utf8");
  const counter = path.join(root, "check-count.txt");
  const checker = "const f=require('node:fs');f.appendFileSync(process.argv[2],'checked\\n');if(f.readFileSync('value.txt','utf8')!=='after'){console.log(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}";
  await writeFile(path.join(source, "checks/business.cjs"), checker, "utf8");
  await writeFile(path.join(source, "checks/private.cjs"), `console.error(${JSON.stringify(PRIVATE_OUTPUT)})`, "utf8");
  git(source, ["init", "-b", "fixture"]); git(source, ["config", "core.autocrlf", "false"]);
  git(source, ["config", "user.name", "Task CLI synthetic"]); git(source, ["config", "user.email", "fixture@example.invalid"]);
  git(source, ["add", "."]); git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic"]);
  const revision = git(source, ["rev-parse", "HEAD"]);
  const taskFile = path.join(root, "task with spaces.json");
  await writeFile(taskFile, JSON.stringify({ version: 1, objective: "Repair value.txt in the owned candidate", context: ["value.txt"],
    write: { allow: ["value.txt", "checks"], protect: ["checks"] },
    checks: [{ id: "business", command: process.execPath, args: ["checks/business.cjs", counter], verifierVersion: "v1",
      protectedPaths: ["checks"], visibleToWorker: true, expect: { baseline: "fail", failureAssertion: "value-regression" } },
    { id: "private", command: process.execPath, args: ["checks/private.cjs"], verifierVersion: "v1", protectedPaths: ["checks"], visibleToWorker: false, expect: { baseline: "pass" } }],
    worker: { model: "inherit", maxAttempts: 1 }, budget: { totalSeconds: 120, prepareSeconds: 20, checkSeconds: 15, workerSeconds: 30, usd: options.invalid ? 0 : 0.01 } }), "utf8");
  const provider = await startLoopbackOpenAiProvider({ modelIds: [MODEL], scriptedResponse: n => { options.onRequest?.(); return { toolCalls: n === 1 ? [
    { name: "sparkle_write_file", arguments: { path: "outside.txt", contents: "forbidden" } },
    { name: "sparkle_write_file", arguments: { path: "checks/business.cjs", contents: "process.exit(0)" } },
    { name: "sparkle_write_file", arguments: { path: "value.txt", contents: "after" } }
  ] : [{ name: "sparkle_report_task_result", arguments: { verification: "PASSED", summary: "worker claim is not host acceptance" } }] }; } });
  await saveProvidersConfig(state, { version: 1, enabled: [`loopback/${MODEL}`], primary: `loopback/${MODEL}`, fast: `loopback/${MODEL}`,
    customProviders: [{ id: "loopback", baseUrl: provider.baseUrl, models: [{ id: MODEL, contextWindow: 8192, maxTokens: 256,
      ...(options.unpriced ? {} : { inputCostPerMTok: 1, outputCostPerMTok: 2 }) }] }] });
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: root, TMP: root, TMPDIR: root, PI_API_KEY: "synthetic-loopback-key" });
  const run = async (extra: string[] = [], input = "", command = ["task", "run", taskFile]) => {
    const child = spawn(process.execPath, ["--import", TSX, CLI, ...command, "--project", source, "--state-root", state, "--executor", "pi", "--json", ...extra],
      { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error; });
    child.stdin.end(input);
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    await writeFile(path.join(root, "cli-stdout.log"), stdout, "utf8"); await writeFile(path.join(root, "cli-stderr.log"), stderr, "utf8");
    assert.doesNotMatch(stdout + stderr, new RegExp(`${PRIVATE_OUTPUT}|synthetic-loopback-key|worker claim is not host acceptance`));
    const records = stdout.split("\n").filter(line => line.trim().startsWith("{")).map(line => JSON.parse(line) as Record<string, unknown>);
    return { code, stdout, stderr, records };
  };
  return { root, source, state, taskFile, revision, counter, checker, provider, run, env };
}
async function costSummaries(directory: string): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await costSummaries(filename));
    else if (entry.name.endsWith(".json")) {
      const value = JSON.parse(await readFile(filename, "utf8"));
      if (value.body?.referenceCost !== undefined) results.push(value.body.referenceCost);
    }
  }
  return results;
}

for (const decision of ["default", "apply", "discard", "eof"] as const) test(`actual task run uses configured loopback SDK and ${decision} keeps explicit lifecycle authority`, { timeout: 180000 }, async () => {
  const f = await fixture();
  try {
    const output = await f.run(decision === "default" ? [] : ["--review"], decision === "default" || decision === "eof" ? "" : `${decision}\n`);
    assert.equal(output.code, 0, output.stderr);
    const run = output.records.find(record => record.type === "TASKSPEC_EXECUTION");
    assert.ok(run, output.stdout); assert.equal(run.accepted, true); assert.equal(run.effectsSettled, true); assert.equal(run.managed, true);
    assert.equal(Object.hasOwn(run, "refusal"), false, "successful execution projection is unchanged");
    assert.equal(f.provider.requests.length, 2, "report_task_result stops SDK before a third model turn"); assert.deepEqual(f.provider.protocolErrors, []);
    for (const request of f.provider.requests) {
      const body = request.body as { tools: { function: { name: string } }[]; model: string };
      assert.equal(body.model, MODEL);
      assert.deepEqual(body.tools.map(tool => tool.function.name).sort(), ["sparkle_list_files", "sparkle_patch_file", "sparkle_read_file", "sparkle_report_task_result", "sparkle_search_files", "sparkle_write_file"]);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(`${PRIVATE_OUTPUT}|TASK_CLI_AMBIENT_AGENTS_NOT_APPROVED`));
    }
    assert.equal(await readFile(path.join(f.source, "value.txt"), "utf8"), decision === "apply" ? "after" : "before");
    assert.equal(await readFile(path.join(f.source, "outside.txt"), "utf8"), "scope keeps this");
    assert.equal(await readFile(path.join(f.source, "checks/business.cjs"), "utf8"), f.checker);
    assert.equal((await readFile(f.counter, "utf8")).trim().split("\n").length, decision === "apply" ? 3 : 2, "independent checks run beyond worker self-report, and again on apply");
    const candidate = run.candidatePath as string;
    if (decision === "discard") { assert.ok(output.records.some(record => record.type === "TASKSPEC_DISPOSAL")); await assert.rejects(access(candidate), { code: "ENOENT" }); }
    else { await access(candidate); assert.equal(await readFile(path.join(candidate, "outside.txt"), "utf8"), "scope keeps this"); assert.equal(await readFile(path.join(candidate, "checks/business.cjs"), "utf8"), f.checker); }
    if (decision === "apply") assert.ok(output.records.some(record => record.type === "TASKSPEC_APPLICATION" && record.reverified === true));
    else assert.equal(git(f.source, ["rev-parse", "HEAD"]), f.revision);
    const costs = await costSummaries(f.state);
    assert.ok(costs.some(cost => cost.coverage === "complete" && cost.settled === true && Math.abs(Number(cost.knownReferenceUsd) - 0.000042) <= Number.EPSILON), "real finalizer receipts must settle both HTTP turns into the logical task USD pool");
    await access(run.artifactPath as string);
  } finally { await f.provider.close(); }
});

for (const [mode, expectedCode] of [["type-error", "TS_UNDECLARED_RED"], ["missing-compiler", "TS_COMPILER_MISSING"], ["missing-config", "TS_CONFIG_MISSING"]] as const) {
  test(`actual task run typed ${mode} retains safe refusal guidance with zero model dispatch`, { timeout: 180000 }, async () => {
    const f = await fixture();
    try {
      const examples = await import(pathToFileURL(path.resolve("examples/task-spec-language-fixtures.mjs")).href);
      const packageAnchor = mode === "missing-compiler" ? path.join(f.root, "missing/package.json") : path.resolve("package.json");
      const files = { ...examples.typescriptExampleFiles({ packageAnchor }), "package.json": '{"type":"module"}',
        "src/value.ts": mode === "type-error" ? 'export const value: number = "TASK_CLI_HIDDEN_CHECK_OUTPUT";\n' : 'export const value: number = 1;\n' };
      for (const [file, contents] of Object.entries(files)) {
        if (file === "tsconfig.json" && mode === "missing-config") continue;
        await mkdir(path.dirname(path.join(f.source, file)), { recursive: true });
        await writeFile(path.join(f.source, file), contents as string, "utf8");
      }
      const draft = JSON.parse(await readFile(f.taskFile, "utf8"));
      draft.write.allow.push("src"); draft.write.protect.push("package.json");
      await writeFile(f.taskFile, JSON.stringify(examples.configureTypeScriptExample(draft)), "utf8");
      git(f.source, ["add", "."]); git(f.source, ["-c", "commit.gpgsign=false", "commit", "-m", "Typed CLI refusal"]);
      const revision = git(f.source, ["rev-parse", "HEAD"]);
      const output = await f.run();
      assert.equal(output.code, 1); assert.equal(f.provider.requests.length, 0);
      const run = output.records.find(record => record.type === "TASKSPEC_EXECUTION");
      assert.ok(run); assert.equal(run.accepted, false); assert.equal(run.effectsSettled, true);
      const refusal = run.refusal as { code: string; category: string; message: string; next: string };
      assert.equal(refusal?.code, expectedCode);
      assert.equal(refusal.category, mode === "type-error" ? "undeclared-red" : "infrastructure");
      assert.deepEqual(Object.keys(refusal).sort(), ["category", "code", "message", "next"]);
      assert.ok(output.stderr.includes(refusal.message)); assert.ok(output.stderr.includes(refusal.next));
      assert.equal(git(f.source, ["rev-parse", "HEAD"]), revision); assert.equal(git(f.source, ["status", "--porcelain=v1"]), "");
      assert.equal(await readFile(path.join(f.source, "value.txt"), "utf8"), "before");
    } finally { await f.provider.close(); }
  });
}

for (const reason of ["invalid", "unpriced"] as const) test(`actual task run ${reason} refuses with zero model dispatch`, { timeout: 180000 }, async () => {
  const f = await fixture({ [reason]: true });
  try {
    const output = await f.run(); assert.equal(output.code, 1);
    assert.match(output.stderr + output.stdout, reason === "invalid" ? /usd|positive/i : /cost|pricing|reference|unavailable/i);
    assert.equal(f.provider.requests.length, 0); assert.equal(git(f.source, ["rev-parse", "HEAD"]), f.revision);
    assert.equal(await readFile(path.join(f.source, "value.txt"), "utf8"), "before");
  } finally { await f.provider.close(); }
});

test("task resume explicitly refuses lost live verifier and allowance authority without model dispatch", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const output = await f.run([], "", ["task", "resume", "run_historical"]);
    assert.equal(output.code, 1); assert.match(output.stderr, /live.*(?:verifier|session)|remaining.*(?:pool|budget|allowance)/i);
    assert.equal(f.provider.requests.length, 0); assert.equal(git(f.source, ["rev-parse", "HEAD"]), f.revision);
  } finally { await f.provider.close(); }
});

test("actual main cancellation settles the configured SDK before returning and never applies", { timeout: 180000 }, async () => {
  const controller = new AbortController();
  const f = await fixture({ onRequest: () => controller.abort(new Error("synthetic host interruption")) });
  const keys = ["HOME", "USERPROFILE", "PI_PROVIDER", "PI_MODEL", "PI_API_KEY", "PI_THINKING_LEVEL"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const out: string[] = [], err: string[] = [];
  try {
    for (const key of keys) {
      if (f.env[key] === undefined) delete process.env[key]; else process.env[key] = f.env[key];
    }
    const code = await main(["task", "run", f.taskFile, "--project", f.source, "--state-root", f.state, "--executor", "pi", "--json"],
      { stdout: text => out.push(text), stderr: text => err.push(text) }, { signal: controller.signal });
    assert.equal(code, 1); assert.equal(f.provider.requests.length, 1, "the actual provider call must start before host cancellation");
    assert.ok(out.some(line => { const result = JSON.parse(line); return result.type === "TASKSPEC_EXECUTION" && result.status === "CANCELLED" && result.accepted === false; }), out.join("\n"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.provider.requests.length, 1, "settlement must not leave another SDK turn in the background");
    assert.equal(await readFile(path.join(f.source, "value.txt"), "utf8"), "before"); assert.equal(git(f.source, ["rev-parse", "HEAD"]), f.revision);
    assert.doesNotMatch(out.join("\n") + err.join("\n"), new RegExp(PRIVATE_OUTPUT));
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await f.provider.close();
  }
});

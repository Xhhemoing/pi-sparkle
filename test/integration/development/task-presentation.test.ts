import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { createEpisodeId, createEvidenceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { NativeWriteSession, type NativeWriteExecutorFactory, type NativeWriteSessionInput } from "../../../src/native/write-session.js";
import { configurePreferencePersistence, deletePreference, inspectPreferences, recordExplicitPreference } from "../../../src/preferences/service.js";
import { listTombstones, resetPreferenceStore } from "../../../src/preferences/store.js";

const BEFORE = "export const value = 1;\n";
const AFTER = "export const value = 2;\n";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "task-presentation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const stateRoot = path.join(root, "state");
  const sandboxRoot = path.join(root, "candidates");
  await mkdir(repo); await mkdir(sandboxRoot);
  git(repo, ["init"]); git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Presentation Test"]);
  await writeFile(path.join(repo, "value.ts"), BEFORE);
  git(repo, ["add", "value.ts"]); git(repo, ["commit", "-m", "fixture"]);
  return { root, repo, stateRoot, sandboxRoot };
}

function verification() {
  return { command: process.execPath, args: ["-e", "const fs = require('node:fs'); process.exit(fs.readFileSync('value.ts', 'utf8') === 'export const value = 2;\\n' ? 0 : 1);"] };
}

function resultMessage(request: AgentExecutionRequest) {
  const evidenceId = createEvidenceId();
  return { protocolVersion: 1 as const, id: createMessageId(), occurredAt: nowIso(), runId: request.runId,
    taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR" as const,
    type: "TASK_RESULT" as const, outcome: "SUCCESS" as const, summary: "candidate updated", artifactIds: [],
    evidenceIds: [evidenceId], verification: { kind: "PASSED" as const, evidenceIds: [evidenceId] } };
}

function writer(prompts: string[], objectives: string[], contents = AFTER): NativeWriteExecutorFactory {
  return ({ tools, objective }) => {
    objectives.push(objective);
    return { async *execute(request): AsyncIterable<ExecutionEvent> {
      prompts.push(request.prompt);
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ["sparkle_list_files", "sparkle_patch_file", "sparkle_read_file", "sparkle_search_files", "sparkle_write_file"]);
      const write = tools.find((tool) => tool.name === "sparkle_write_file"); assert.ok(write);
      await write.execute("presentation-write", { path: "value.ts", contents });
      yield { type: "MESSAGE", message: resultMessage(request) };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } };
  };
}

test("presentation reaches actual direct-task prompt while objective, source and checker remain intact", async (t) => {
  const f = await fixture(t);
  const prompts: string[] = []; const objectives: string[] = [];
  const check = verification(); const originalCheck = JSON.stringify(check);
  const result = await startDevelopmentTask({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
    sourceRepo: f.repo, objective: "Update value.ts", verification: check, executorFactory: writer(prompts, objectives),
    presentation: { user: { language: "en-US", detail: "brief" }, project: { format: "markdown" }, task: { language: "zh-CN", detail: "detailed" } } });
  assert.equal(result.acceptance.accepted, true, result.reason);
  assert.deepEqual(objectives, ["Update value.ts"]);
  assert.match(prompts[0] ?? "", /language=zh-CN \(task\)/);
  assert.match(prompts[0] ?? "", /detail=detailed \(task\)/);
  assert.match(prompts[0] ?? "", /format=markdown \(project\)/);
  assert.equal(JSON.stringify(check), originalCheck);
  assert.equal(await readFile(path.join(f.repo, "value.ts"), "utf8"), BEFORE);
  assert.equal(await readFile(path.join(result.candidatePath, "value.ts"), "utf8"), AFTER);
});

test("no-overlay and empty-overlay prompts remain byte-identical; task style does not leak to later tasks", async (t) => {
  const f = await fixture(t);
  const prompts: string[] = [];
  const candidates: string[] = [];
  for (const presentation of [undefined, {}, { task: { language: "zh-CN", detail: "detailed" as const } }, undefined]) {
    await startDevelopmentTask({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo,
      objective: "Update value.ts", verification: verification(), executorFactory: (input) => {
        candidates.push(input.candidatePath);
        return writer(prompts, [])(input);
      },
      ...(presentation === undefined ? {} : { presentation }) });
  }
  assert.equal(prompts.length, 4);
  const normalized = prompts.map((prompt, index) => prompt.replaceAll(candidates[index] ?? "", "<candidate>"));
  assert.equal(normalized[0], normalized[1]);
  assert.equal(normalized[0], normalized[3]);
  assert.doesNotMatch(prompts[0] ?? "", /Task presentation/);
  assert.match(prompts[2] ?? "", /language=zh-CN/);
});

test("concurrent tasks retain independent presentation snapshots", async (t) => {
  const f = await fixture(t);
  const reached = Promise.withResolvers<void>();
  let entered = 0;
  const barrierFactory = (prompts: string[]): NativeWriteExecutorFactory => async (input) => {
    entered++; if (entered === 2) reached.resolve();
    await reached.promise;
    return writer(prompts, [])(input);
  };
  const zh: string[] = []; const fr: string[] = [];
  const base = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo, objective: "Update value.ts", verification: verification() };
  const results = await Promise.all([
    startDevelopmentTask({ ...base, executorFactory: barrierFactory(zh), presentation: { task: { language: "zh-CN", detail: "detailed" } } }),
    startDevelopmentTask({ ...base, executorFactory: barrierFactory(fr), presentation: { task: { language: "fr-FR", detail: "brief" } } })
  ]);
  assert.ok(results.every((result) => result.acceptance.accepted));
  assert.match(zh[0] ?? "", /language=zh-CN/); assert.doesNotMatch(zh[0] ?? "", /language=fr-FR/);
  assert.match(fr[0] ?? "", /language=fr-FR/); assert.doesNotMatch(fr[0] ?? "", /language=zh-CN/);
});

test("presentation snapshots survive caller mutation and same-candidate repair", async (t) => {
  const f = await fixture(t);
  const entered = Promise.withResolvers<void>(); const proceed = Promise.withResolvers<void>();
  const style: { language: string; detail: "brief" | "detailed" } = { language: "zh-CN", detail: "detailed" };
  const prompts: string[] = []; const candidates: string[] = [];
  const pending = startDevelopmentTask({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo,
    objective: "Update value.ts", verification: verification(), maxAttempts: 2, presentation: { task: style },
    executorFactory: async (input) => {
      candidates.push(input.candidatePath);
      if (input.attempt?.number === 1) { entered.resolve(); await proceed.promise; }
      return writer(prompts, [], input.attempt?.number === 1 ? BEFORE : AFTER)(input);
    } });
  await entered.promise; style.language = "fr-FR"; style.detail = "brief"; proceed.resolve();
  const result = await pending;
  assert.equal(result.acceptance.accepted, true, result.reason);
  assert.equal(result.loop?.attempts.length, 2);
  assert.deepEqual(candidates, [result.candidatePath, result.candidatePath]);
  for (const prompt of prompts) {
    assert.match(prompt, /language=zh-CN \(task\)/); assert.match(prompt, /detail=detailed \(task\)/);
    assert.doesNotMatch(prompt, /language=fr-FR/);
  }
});

test("invalid/accessor presentation fails before worktree allocation or factory calls", async (t) => {
  const f = await fixture(t);
  let calls = 0; let getters = 0;
  const session = new NativeWriteSession({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
    executorFactory: () => { calls++; throw new Error("must not run"); } });
  t.after(() => session.shutdown());
  const base = { sourceRepo: f.repo, objective: "Update value.ts", verification: verification() };
  const bad = { ...base, presentation: { task: { allowedTools: ["sparkle_run_command"] } } };
  const accessor = Object.defineProperty({ ...base }, "presentation", { get: () => { getters++; return {}; } });
  const nested = { ...base, presentation: { task: Object.defineProperty({}, "language", { get: () => { getters++; return "zh-CN"; } }) } };
  for (const input of [bad, accessor, nested]) {
    await assert.rejects(session.execute(input as NativeWriteSessionInput), /presentation/i);
  }
  assert.equal(getters, 0); assert.equal(calls, 0); assert.equal(session.activeCount, 0);
  assert.deepEqual(await readdir(f.sandboxRoot), []);
});

test("direct-task entry rejects a presentation accessor before its rest spread can invoke it", async (t) => {
  const f = await fixture(t);
  let getters = 0; let calls = 0;
  const base = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo,
    objective: "Update value.ts", verification: verification(), executorFactory: () => { calls++; throw new Error("must not run"); } };
  const accessor = Object.defineProperty({ ...base }, "presentation", { enumerable: true, get: () => { getters++; return {}; } });
  const inherited = Object.assign(Object.create({ presentation: { task: { language: "zh-CN" } } }) as typeof base, base);
  const attempts = await Promise.allSettled([startDevelopmentTask(accessor), startDevelopmentTask(inherited)]);
  assert.deepEqual(attempts.map((attempt) => attempt.status), ["rejected", "rejected"]);
  for (const attempt of attempts) if (attempt.status === "rejected") assert.match(String(attempt.reason), /presentation/i);
  assert.equal(getters, 0); assert.equal(calls, 0);
  assert.deepEqual(await readdir(f.sandboxRoot), []);
});

test("presentation stays active with inferred adaptation disabled and never changes stored preferences or tombstones", async (t) => {
  const f = await fixture(t);
  const priorFlag = process.env["SPARKLE_AUTO_ADAPT"]; process.env["SPARKLE_AUTO_ADAPT"] = "0";
  const snapshotPath = path.join(f.root, "preferences.json");
  resetPreferenceStore(); configurePreferencePersistence(snapshotPath);
  const episodeId = createEpisodeId();
  recordExplicitPreference("user", "default", "detail", "brief", episodeId);
  const deleted = recordExplicitPreference("user", "default", "format", "compact", episodeId);
  assert.equal(deletePreference(deleted.id), true);
  const beforeDisk = await readFile(snapshotPath, "utf8");
  const beforeMemory = JSON.stringify({ observations: inspectPreferences(), tombstones: listTombstones() });
  const prompts: string[] = [];
  try {
    await startDevelopmentTask({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo,
      objective: "Update value.ts", verification: verification(), executorFactory: writer(prompts, []),
      presentation: { user: { detail: "brief" }, task: { language: "zh-CN", detail: "detailed" } } });
    assert.match(prompts[0] ?? "", /detail=detailed \(task\)/);
    assert.equal(await readFile(snapshotPath, "utf8"), beforeDisk);
    assert.equal(JSON.stringify({ observations: inspectPreferences(), tombstones: listTombstones() }), beforeMemory);
  } finally {
    configurePreferencePersistence(undefined); resetPreferenceStore();
    if (priorFlag === undefined) delete process.env["SPARKLE_AUTO_ADAPT"]; else process.env["SPARKLE_AUTO_ADAPT"] = priorFlag;
  }
});

test("presentation cannot turn an unsuccessful host check into acceptance", async (t) => {
  const f = await fixture(t);
  const result = await startDevelopmentTask({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.repo,
    objective: "Update value.ts", verification: verification(), executorFactory: writer([], [], BEFORE),
    presentation: { task: { language: "zh-CN", detail: "brief", format: "bullets" } } });
  assert.equal(result.status, "FAILED"); assert.equal(result.acceptance.accepted, false);
  assert.equal(await readFile(path.join(f.repo, "value.ts"), "utf8"), BEFORE);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseDevelopmentTaskSpec, snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { preflightDevelopmentTaskSpec, startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { TaskSpecSession } from "../../../src/development/task-session.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { materializeTaskResources, taskResourceIdentity, verifyMaterializedTaskResources } from "../../../src/lab/adaptation/task-resources.js";

// Optional v1 declarations; parser/schema and downstream limits are exercised below.
// All values stay below current supported capacities; none imports #103.
// One admission assertion precedes downstream probes, so a missing optional-field
// implementation cannot masquerade as several successful invalid-input tests.
// Parser admission precedes nested runtime/repair/apply/materialization probes.
// Evaluation reconstruction remains a deferred integration probe until its authoring dependency is adopted.
const limits = { context: { tokenBudget: 4000, maxFiles: 2, maxBytes: 512 }, snapshot: { maxFiles: 8, maxBytes: 65536 } };
type Limits = typeof limits;
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function definition(): DevelopmentTaskSpec {
  return { version: 1, objective: "Repair value with the complete selected context", context: ["value.txt", "context.txt"],
    write: { allow: ["value.txt"], protect: ["checks"] },
    prepare: [{ id: "warm", command: process.execPath, args: ["checks/prepare.cjs"] }],
    checks: [{ id: "business", command: process.execPath, args: ["checks/business.cjs"], verifierVersion: "synthetic-v1",
      protectedPaths: ["checks"], visibleToWorker: true, expect: { baseline: "fail", failureAssertion: "value-regression" } }],
    worker: { model: "inherit", maxAttempts: 2 }, budget: { totalSeconds: 60, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 } };
}
async function fixture(body: (input: { sourceRepo: string; stateRoot: string; sandboxRoot: string; root: string }) => Promise<void>): Promise<void> {
  const parent = path.resolve(".agent_workspace/task-preparation-red/limits"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const sourceRepo = path.join(root, "source"), stateRoot = path.join(root, "state"), sandboxRoot = path.join(root, "candidates");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true }); await mkdir(sandboxRoot);
  await writeFile(path.join(sourceRepo, ".gitignore"), ".cache/\n", "utf8");
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
  await writeFile(path.join(sourceRepo, "context.txt"), "Complete required context: keep all of this text.", "utf8");
  await writeFile(path.join(sourceRepo, "checks/prepare.cjs"), "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/ready','warm');", "utf8");
  await writeFile(path.join(sourceRepo, "checks/business.cjs"), "const f=require('node:fs');if(f.readFileSync('.cache/ready','utf8')!=='warm')throw Error('cold candidate');if(f.readFileSync('value.txt','utf8')!=='after'){process.stdout.write(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}", "utf8");
  git(sourceRepo, ["init", "-b", "fixture"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Limits synthetic fixture"]); git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic source"]);
  try { await body({ sourceRepo, stateRoot, sandboxRoot, root }); }
  finally { assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("case-")); await rm(root, { recursive: true, force: true }); }
}
function explicit(selected: Limits = limits): DevelopmentTaskSpec {
  return parseDevelopmentTaskSpec(JSON.stringify({ ...definition(), limits: selected }));
}

test("legacy v1 without optional limits still reaches its checker and model boundary", async () => fixture(async input => {
  const spec = parseDevelopmentTaskSpec(JSON.stringify(definition()));
  let dispatches = 0;
  const result = await startDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec,
    executorFactory: context => ({ async *execute(request, signal) {
      dispatches++;
      await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  assert.equal(dispatches, 1); assert.equal(result.preflight?.ok, true);
  assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
  assert.equal(await readFile(path.join(input.sourceRepo, "value.txt"), "utf8"), "before");
}));

test("explicit preparation limits are admitted before downstream enforcement/reconstruction probes", async t => {
  // Initially the single intended parser RED; downstream probes run only after admission.
  // If it fails, NONE of the downstream probes below count as runtime RED/GREEN evidence.
  let admitted: DevelopmentTaskSpec | undefined;
  assert.doesNotThrow(() => { admitted = explicit(); }, "optional complete limits within existing capacities must be usable host input");
  assert.deepEqual(Reflect.get(admitted!, "limits"), limits);

  for (const [name, selected] of [
    ["required token budget", { ...limits, context: { ...limits.context, tokenBudget: 1 } }],
    ["required byte budget", { ...limits, context: { ...limits.context, maxBytes: 8 } }],
    ["required file count", { ...limits, context: { ...limits.context, maxFiles: 1 } }],
    ["protected snapshot bytes", { ...limits, snapshot: { ...limits.snapshot, maxBytes: 8 } }],
    ["protected snapshot files", { ...limits, snapshot: { ...limits.snapshot, maxFiles: 1 } }],
  ] as const) {
    await t.test(`insufficient ${name} refuses at public preflight and task-run with zero dispatch`, async () => fixture(async input => {
      const spec = explicit(selected); let factories = 0, dispatches = 0;
      const preflight = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec })
        .then(result => ({ result }), (error: unknown) => {
          assert.ok(error instanceof DomainValidationError);
          assert.match(error.message, /limit|budget|token|context|snapshot|byte|file/i);
          return { error };
        });
      if ("result" in preflight) {
        assert.equal(preflight.result.ok, false, `${name} must not silently fall back to defaults`);
        assert.match(preflight.result.reason ?? "", /limit|budget|token|context|snapshot|byte|file/i);
      }
      const outcome = await startDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec,
        executorFactory: () => { factories++; return { async *execute(request, signal) { dispatches++; yield* new ProtocolChildExecutor().execute(request, signal); } }; } })
        .then(result => ({ result }), (error: unknown) => { assert.ok(error instanceof DomainValidationError); return { error }; });
      assert.equal(factories, 0); assert.equal(dispatches, 0);
      if ("result" in outcome) assert.equal(outcome.result.execution.acceptance.accepted, false);
    }));
  }
  await t.test("malformed declarations are not accepted through a generic unknown-field refusal", () => {
    // Run only AFTER the valid field has been admitted above.
    for (const value of [
      { ...limits, context: { ...limits.context, tokenBudget: 0 } },
      { ...limits, context: { ...limits.context, maxFiles: 1.5 } },
      { ...limits, context: { ...limits.context, maxBytes: -1 } },
      { ...limits, snapshot: { ...limits.snapshot, maxFiles: 0 } },
      { ...limits, snapshot: { ...limits.snapshot, maxBytes: Infinity } },
    ]) assert.throws(() => snapshotDevelopmentTaskSpec({ ...definition(), limits: value }), DomainValidationError);
  });
  await t.test("sufficient limits keep complete context through a real repair without preparing twice", async () => fixture(async input => {
    let factories = 0, dispatches = 0;
    const result = await startDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec: admitted!,
      executorFactory: context => {
        factories++;
        assert.ok(context.preparedContext, "the host must build actual required context");
        assert.equal(context.preparedContext.requiredFiles.length, 2);
        assert.equal(context.preparedContext.requiredFiles.find(file => file.path === "context.txt")?.text, "Complete required context: keep all of this text.");
        assert.ok(context.preparedContext.estimatedTokens <= 4000);
        if (factories === 2) assert.equal(context.preparedContext.requiredFiles.find(file => file.path === "value.txt")?.text, "intermediate");
        return { async *execute(request, signal) {
          dispatches++;
          await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: factories === 1 ? "intermediate" : "after" }, signal);
          yield* new ProtocolChildExecutor().execute(request, signal);
        } };
      } });
    assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
    assert.equal(factories, 2); assert.equal(dispatches, 2);
    const preflight = JSON.parse(await readFile(result.preflight!.artifactPath, "utf8"));
    assert.equal(preflight.preparation.length, 1);
  }));
  await t.test("final verification refuses a worker result exceeding declared protected snapshot bytes", async () => fixture(async input => {
    const checker = "const f=require('node:fs');if(!f.readFileSync('value.txt','utf8').startsWith('after')){process.stdout.write(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}";
    await writeFile(path.join(input.sourceRepo, "checks/business.cjs"), checker, "utf8");
    git(input.sourceRepo, ["add", "checks/business.cjs"]); git(input.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic final check"]);
    let dispatches = 0;
    const result = await startDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot,
      spec: { ...admitted!, worker: { model: "inherit", maxAttempts: 1 } },
      executorFactory: context => ({ async *execute(request, signal) {
        dispatches++;
        await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("grow", { path: "value.txt", contents: "after" + "x".repeat(limits.snapshot.maxBytes + 1) }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }) });
    assert.equal(result.preflight?.ok, true, "the original small candidate must establish its exact base RED");
    assert.equal(dispatches, 1);
    assert.equal(result.execution.acceptance.accepted, false, "final verification must use the original declared snapshot byte limit");
    assert.equal(await readFile(path.join(input.sourceRepo, "value.txt"), "utf8"), "before");
  }));
  await t.test("apply reverification honors the whole-source snapshot declaration without source mutation", async () => fixture(async input => {
    await writeFile(path.join(input.sourceRepo, "outside.txt"), "x".repeat(limits.snapshot.maxBytes + 1), "utf8");
    git(input.sourceRepo, ["add", "outside.txt"]); git(input.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic large source"]);
    const revision = git(input.sourceRepo, ["rev-parse", "HEAD"]);
    const session = new TaskSpecSession({ stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot });
    let dispatches = 0;
    try {
      const run = await session.run({ sourceRepo: input.sourceRepo, spec: admitted!, executorFactory: context => ({ async *execute(request, signal) {
        dispatches++;
        await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }) });
      assert.equal(run.accepted, true, "scoped checking can accept before whole-source apply reverification");
      assert.equal(dispatches, 1);
      await assert.rejects(session.apply(run.runId), /byte|limit|snapshot/i);
      assert.equal(git(input.sourceRepo, ["rev-parse", "HEAD"]), revision);
      assert.equal(await readFile(path.join(input.sourceRepo, "value.txt"), "utf8"), "before");
      assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
    } finally { await session.shutdown(); }
  }));
  await t.test("existing authoring materialization and reconstruction preserve limits and reject a changed declaration", () => {
    const registry = new ResourceRegistry(), projectRoot = "/synthetic/preparation-limits";
    registry.registerBaseline({ identity: taskResourceIdentity(projectRoot, "node-preparation"), author: { kind: "human", identity: "owner" },
      content: JSON.stringify({ topic: "node-preparation", guidance: "Use only the declared candidate preparation", sourceRefs: ["private/synthetic"], expectedEffect: "Preserve explicit host limits" }) });
    const materialized = materializeTaskResources({ registry, projectRoot, logicalTaskId: "limits", sourceRevision: "a".repeat(40), spec: admitted!, topics: ["node-preparation"],
      preparationBinding: { recipeId: "warm", command: process.execPath, args: ["checks/prepare.cjs"], authorityRef: "private/synthetic-owner", candidateOnly: true } });
    assert.deepEqual(Reflect.get(materialized.spec, "limits"), limits);
    const packet = JSON.parse(JSON.stringify(materialized));
    assert.deepEqual(Reflect.get(verifyMaterializedTaskResources(registry, packet).spec, "limits"), limits);
    packet.spec.limits.context.maxBytes = 511;
    assert.throws(() => verifyMaterializedTaskResources(registry, packet), DomainValidationError);
  });
});

test.todo("evaluation and actual TASK_REQUEST reconstruction retain the explicit limits after the authoring dependencies are adopted");

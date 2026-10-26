import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import type { FailureClass } from "../../../src/routing/outcomes.js";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../../../scripts/real-task-record.mjs", import.meta.url));
const summary = fileURLToPath(new URL("../../../scripts/real-task-summary.mjs", import.meta.url));
const failureClasses: FailureClass[] = ["model", "contract", "tool", "environment", "provider", "run"];
const metadata = (extra = {}) => ({ id: "attempt-1", date: "2026-10-25", source: "pi-sparkle", arm: "sparkle",
  objective: "Synthetic task", taskSpecMinutes: 2, interventions: 0, ...extra });
const projection = (extra = {}) => ({ type: "TASKSPEC_EXECUTION", runId: "run_one", status: "COMPLETED",
  accepted: true, effectsSettled: true, ...extra });
const invocation = (extra = {}) => ({ id: "inv_one", taskId: "task_one", runId: "run_one", agentInstanceId: "agent_one",
  config: { provider: "test", model: "synthetic", parameterHash: "a" }, responseHash: "b", tokensIn: 1000, tokensOut: 500,
  latencyMs: 1, occurredAt: "2026-10-25T10:00:00.000Z", callOutcome: "ok", executorClass: "pi", cacheHit: false, attempt: 1,
  pricing: { catalogVersion: "synthetic-v1", inputUsdPerMTok: 2, outputUsdPerMTok: 4 }, ...extra });

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-real-task-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
}
async function record(root: string, meta: object, capture?: object | object[], rows?: object[] | string, loop?: object, direct?: object) {
  await writeFile(join(root, "metadata.json"), JSON.stringify(meta), "utf8");
  const args = [script, "--root", root, "--metadata", join(root, "metadata.json"), "--state-root", join(root, "state")];
  if (capture !== undefined) {
    await writeFile(join(root, "projection.json"), Array.isArray(capture) ? capture.map(row => JSON.stringify(row)).join("\n") + "\n" : JSON.stringify(capture), "utf8");
    args.push("--projection", join(root, "projection.json"));
  }
  if (rows !== undefined) {
    await mkdir(join(root, "state/runtime"), { recursive: true });
    await writeFile(join(root, "state/runtime/invocations.jsonl"), typeof rows === "string" ? rows : rows.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  }
  if (loop !== undefined) {
    await writeFile(join(root, "loop.json"), JSON.stringify(loop), "utf8");
    args.push("--loop-artifact", join(root, "loop.json"));
  }
  if (direct !== undefined) {
    await writeFile(join(root, "direct.json"), JSON.stringify(direct), "utf8");
    args.push("--direct-cost-report", join(root, "direct.json"));
  }
  const { stdout } = await exec(process.execPath, args);
  const { path } = JSON.parse(stdout) as { path: string };
  return JSON.parse(await readFile(path, "utf8"));
}
async function summarize(root: string, week = "2026-10-19", extraArgs: string[] = []) {
  const { stdout } = await exec(process.execPath, [summary, "--root", root, "--week", week, "--json", ...extraArgs]);
  return JSON.parse(stdout);
}

test("record imports actual invocation fields and retries, whitelists projections, and requires observed human review", async () => {
  await fixture(async root => {
    const result = await record(root, metadata({ reviewed: true, kept: true, escapedDefects: 0, phases: {
      prepare: { start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:00:12Z" }, model: 8, check: "unknown" },
      model: "synthetic", thinking: "high", comparisonId: "pair-1", prompt: "SECRET", arbitrary: "SECRET" }),
    projection({ refusal: { code: "CHECK_FAILED", message: "SECRET", next: "SECRET" }, artifactPath: "SECRET" }),
    [invocation(), invocation({ id: "inv_two", attempt: 1 })], loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_one"], [0.008], [2]) }));
    assert.equal(result.referenceUsd, 0.008);
    assert.equal(result.cost.invocationCount, 2);
    assert.equal(result.correctDelivery, true);
    assert.deepEqual(result.phases, { prepare: 12, model: 8, check: "unknown", review: "unknown" });
    assert.equal(result.model, "synthetic");
    assert.equal(result.refusalCode, "CHECK_FAILED");
    assert.ok(!JSON.stringify(result).includes("SECRET"));
    const unreviewed = await record(root, metadata({ id: "unreviewed" }), projection(), [invocation()]);
    assert.equal(unreviewed.accepted, true);
    assert.equal(unreviewed.correctDelivery, "unknown");
    assert.equal(unreviewed.applied, "unknown");
  });
});

test("all attempts survive missing projection and lifecycle capture preserves execution and terminal actions", async () => {
  await fixture(async root => {
    for (const [index, status] of ["FAILED", "CANCELLED", "TIMEOUT", "REFUSED", "unknown"].entries()) {
      const result = await record(root, metadata({ id: `failure-${index}`, status, failureClass: failureClasses[index] }), undefined);
      assert.equal(result.status, status);
      assert.equal(result.accepted, "unknown");
      assert.equal(result.referenceUsd, "unknown");
    }
    const direct = await record(root, metadata({ id: "direct", arm: "direct-pi", status: "COMPLETED" }));
    assert.equal(direct.arm, "direct-pi");
    assert.equal(direct.referenceUsd, "unknown");
    const applied = await record(root, metadata({ id: "applied", applied: false, reviewed: true, kept: true, escapedDefects: 0 }),
      [projection(), { type: "TASKSPEC_APPLICATION", runId: "run_one", status: "APPLIED", message: "SECRET" }]);
    assert.equal(applied.status, "COMPLETED");
    assert.equal(applied.applied, true);
    assert.equal(applied.terminalAction, "APPLIED");
    const discarded = await record(root, metadata({ id: "discarded", applied: true, reviewed: true, kept: true, escapedDefects: 0 }),
      [projection(), { type: "TASKSPEC_DISPOSAL", runId: "run_one", status: "DISPOSED" }]);
    assert.equal(discarded.applied, false);
    assert.equal(discarded.terminalAction, "DISPOSED");
    assert.equal(discarded.correctDelivery, false);
    const appliedThenDisposed = await record(root, metadata({ id: "applied-then-disposed", reviewed: true, kept: true, escapedDefects: 0 }),
      [projection(), { type: "TASKSPEC_APPLICATION", runId: "run_one", status: "APPLIED" },
        { type: "TASKSPEC_DISPOSAL", runId: "run_one", status: "DISPOSED" }]);
    assert.equal(appliedThenDisposed.applied, true);
    assert.equal(appliedThenDisposed.applicationStatus, "APPLIED");
    assert.equal(appliedThenDisposed.disposalStatus, "DISPOSED");
    assert.equal(appliedThenDisposed.correctDelivery, true);
    const absent = await record(root, metadata({ id: "absent", accepted: true, effectsSettled: true, reviewed: true, kept: true, escapedDefects: 0 }));
    assert.equal(absent.accepted, "unknown");
    assert.equal(absent.correctDelivery, "unknown");
    const contradictory = await record(root, metadata({ id: "contradictory", reviewed: true, kept: true, escapedDefects: 0 }), projection({ status: "FAILED" }));
    assert.equal(contradictory.correctDelivery, false);
    const rejected = await record(root, metadata({ id: "rejected", accepted: true }), projection({ accepted: false, status: "FAILED" }));
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.correctDelivery, false);
    const unsettled = await record(root, metadata({ id: "unsettled", reviewed: true, kept: true, escapedDefects: 0 }), projection({ effectsSettled: false }));
    assert.equal(unsettled.correctDelivery, false);
  });
});

test("failed, missing, corrupt, torn, duplicate and unpriced invocation evidence remains unknown", async () => {
  await fixture(async root => {
    const cases: (object[] | string)[] = [[], [invocation({ runId: "run_other" })], [invocation({ callOutcome: "error" })],
      [invocation(), invocation({ id: "inv_two", callOutcome: "timeout", tokensIn: undefined })],
      [invocation({ callOutcome: "cancelled" })], [invocation({ tokensOut: undefined })], [invocation({ pricing: undefined })],
      [invocation({ executorClass: "faux" })], [invocation({ executorClass: undefined })], [invocation({ cacheHit: true })],
      [invocation({ tokensIn: -1 })], [invocation(), invocation()], JSON.stringify(invocation()),
      JSON.stringify(invocation()) + "\n{torn\n", JSON.stringify(invocation()) + "\nnull\n"];
    for (const [index, rows] of cases.entries()) {
      const result = await record(root, metadata({ id: `unknown-${index}` }), projection(), rows);
      assert.equal(result.referenceUsd, "unknown", `case ${index}`);
      assert.equal(typeof result.cost.reason, "string");
    }
  });
});

test("weekly summary counts every arm/outcome and reserves five dollars per unknown without zeroing measurements", async () => {
  await fixture(async root => {
    await record(root, metadata({ id: "paired", date: "2026-10-19", reviewed: true, kept: true, escapedDefects: 0,
      phases: { prepare: 3, model: 4, check: 5, review: 6 } }), projection(), [invocation()], loopArtifact());
    await record(root, metadata({ id: "paired", date: "2026-10-20", arm: "direct-pi", status: "TIMEOUT", interventions: 2 }));
    await record(root, metadata({ id: "missing-status", date: "2026-10-25" }));
    await record(root, metadata({ id: "prior", date: "2026-10-18" }));
    await record(root, metadata({ id: "next", date: "2026-10-26" }));
    const result = await summarize(root);
    assert.equal(result.allTime.attempts, 5);
    assert.equal(result.week.attempts, 3);
    assert.equal(result.week.byArm.sparkle, 2);
    assert.equal(result.week.byArm["direct-pi"], 1);
    assert.equal(result.week.byStatus.unknown, 1);
    assert.equal(result.week.correctDeliveries, 1);
    assert.equal(result.week.cost.knownUsd, 0.004);
    assert.equal(result.week.cost.unknownAttempts, 2);
    assert.equal(result.week.cost.totalUsd, "unknown");
    assert.equal(result.week.interventions.knownTotal, 2);
    assert.equal(result.week.phases.prepare.unknownAttempts, 2);
    assert.equal(result.budget.accountedUsd, 10.004);
    assert.equal(result.budget.nextTaskReservationUsd, 5);
    assert.equal(result.budget.canAdmitNextTask, true);
    assert.equal(result.budget.perTaskLimitUsd, 5);
    await assert.rejects(summarize(root, "2026-10-20"));
    const { stdout } = await exec(process.execPath, [summary, "--root", root, "--week", "2026-10-19"]);
    assert.match(stdout, /unknown/);
  });
});

test("summary rejects duplicate identity and exposes exhausted budget and per-task overrun", async () => {
  await fixture(async root => {
    for (let index = 0; index < 10; index++) await record(root, metadata({ id: `budget-${index}` }));
    const full = await summarize(root);
    assert.equal(full.budget.accountedUsd, 50);
    assert.equal(full.budget.canAdmitNextTask, false);
    await record(root, metadata({ id: "overrun" }), projection(), [invocation({ tokensIn: 3_000_000 })]);
    const over = await summarize(root);
    assert.equal(over.budget.overLimitAttempts, 1);
    assert.equal(over.budget.withinWeeklyLimit, false);
    await record(root, metadata({ id: "budget-0", date: "2026-10-24" }));
    await assert.rejects(summarize(root), /duplicate/i);
  });
});

test("weekly limit is per invocation and preserves accounting across default, unlimited and numeric policies", async () => {
  await fixture(async root => {
    for (let index = 0; index < 10; index++) await record(root, metadata({ id: `weekly-${index}` }));
    await record(root, metadata({ id: "prior", date: "2026-10-18" }));
    await record(root, metadata({ id: "next", date: "2026-10-26" }));
    const recordPaths = Array.from({ length: 10 }, (_, index) => join(root, `.agent_workspace/real-tasks/2026-10-25-weekly-${index}/record.json`));
    const before = await Promise.all(recordPaths.map(file => readFile(file, "utf8")));
    const baseline = await summarize(root);
    assert.equal(baseline.allTime.attempts, 12);
    assert.equal(baseline.week.attempts, 10);
    assert.equal(baseline.week.cost.totalUsd, "unknown");
    assert.equal(baseline.week.cost.unknownAttempts, 10);
    assert.deepEqual(baseline.budget, { perTaskLimitUsd: 5, weeklyLimitUsd: 50, accountedUsd: 50,
      unknownReservationUsd: 50, remainingUsd: 0, overLimitAttempts: 0, withinWeeklyLimit: true,
      nextTaskReservationUsd: 5, canAdmitNextTask: false, admissionReason: "next US$5 reservation exceeds weekly cap" });
    const policies = [
      { args: [], limit: 50, remaining: 0, within: true, admit: false },
      { args: ["--weekly-limit-usd", "none"], limit: null, remaining: null, within: true, admit: true },
      { args: ["--weekly-limit-usd", "55"], limit: 55, remaining: 5, within: true, admit: true },
      { args: ["--weekly-limit-usd", "54.99"], limit: 54.99, remaining: 54.99 - 50, within: true, admit: false },
      { args: ["--weekly-limit-usd", "49.99"], limit: 49.99, remaining: 0, within: false, admit: false },
    ];
    for (const policy of policies) {
      const result = await summarize(root, "2026-10-19", policy.args);
      assert.deepEqual(result.allTime, baseline.allTime);
      assert.deepEqual(result.week, baseline.week);
      assert.deepEqual(result.budget, { ...baseline.budget, weeklyLimitUsd: policy.limit, remainingUsd: policy.remaining,
        withinWeeklyLimit: policy.within, canAdmitNextTask: policy.admit,
        admissionReason: policy.admit ? "within recorded caps" : "next US$5 reservation exceeds weekly cap" });
      const { stdout } = await exec(process.execPath, [summary, "--root", root, "--week", "2026-10-19", ...policy.args]);
      assert.ok(stdout.includes(`Weekly budget: US$50.0000/${policy.limit === null ? "unlimited" : policy.limit} accounted`));
      assert.ok(stdout.includes("task limit US$5; 0 task overruns"));
      assert.ok(stdout.includes(`admission within recorded caps: ${result.budget.canAdmitNextTask} (${result.budget.admissionReason})`));
      assert.match(stdout, /reference cost unknown/);
    }
    assert.deepEqual(await summarize(root), baseline);
    assert.deepEqual(await Promise.all(recordPaths.map(file => readFile(file, "utf8"))), before);
  });
});

test("unlimited weekly policy retains an observed six dollar per-attempt overrun and unknown reservation", async () => {
  await fixture(async root => {
    await record(root, metadata(), projection(), [invocation({ tokensIn: 3_000_000, tokensOut: 0 })]);
    const baseline = await summarize(root);
    const result = await summarize(root, "2026-10-19", ["--weekly-limit-usd", "none"]);
    assert.deepEqual(result.week, baseline.week);
    assert.equal(result.week.cost.totalUsd, "unknown");
    assert.equal(result.week.cost.knownUsd, 6);
    assert.equal(result.week.cost.unknownAttempts, 1);
    assert.deepEqual(result.budget, { ...baseline.budget, weeklyLimitUsd: null, remainingUsd: null });
    assert.equal(result.budget.perTaskLimitUsd, 5);
    assert.equal(result.budget.accountedUsd, 6);
    assert.equal(result.budget.unknownReservationUsd, 6);
    assert.equal(result.budget.withinWeeklyLimit, true);
    assert.equal(result.budget.overLimitAttempts, 1);
    assert.equal(result.budget.canAdmitNextTask, false);
    assert.equal(result.budget.admissionReason, "current-week task exceeded US$5");
    const { stdout } = await exec(process.execPath, [summary, "--root", root, "--week", "2026-10-19", "--weekly-limit-usd", "none"]);
    assert.ok(stdout.includes("Weekly budget: US$6.0000/unlimited accounted"));
    assert.ok(stdout.includes("task limit US$5; 1 task overruns"));
    assert.ok(stdout.includes(`admission within recorded caps: false (${result.budget.admissionReason})`));
  });
});

test("weekly limit rejects missing, empty, invalid, nonpositive and nonfinite arguments", async () => {
  await fixture(async root => {
    await assert.rejects(summarize(root, "2026-10-19", ["--weekly-limit-usd"]), /weekly-limit-usd/);
    for (const value of ["", " ", "garbage", "55usd", "NONE", "0", "-1", "NaN", "Infinity", "-Infinity", "1e309"]) {
      await assert.rejects(summarize(root, "2026-10-19", [`--weekly-limit-usd=${value}`]), /weekly-limit-usd/);
    }
  });
});

test("record validates identity/date/booleans/counters/phases and refuses overwrite or conflicting run projections", async () => {
  await fixture(async root => {
    for (const extra of [{ id: "../escape" }, { id: "CON" }, { date: "2026-02-30" }, { reviewed: "yes" },
      { interventions: -1 }, { escapedDefects: 0.5 }, { taskSpecMinutes: Infinity }, { failureClass: "new-class" },
      { phases: { model: -1 } }, { phases: { model: 604801 } },
      { phases: { review: { start: "2026-10-25T11:00:00Z", end: "2026-10-25T10:00:00Z" } } }]) {
      await assert.rejects(record(root, metadata(extra)));
    }
    await record(root, metadata());
    const before = await readFile(join(root, ".agent_workspace/real-tasks/2026-10-25-attempt-1/record.json"), "utf8");
    await assert.rejects(record(root, metadata({ objective: "changed" })), /exist/i);
    assert.equal(await readFile(join(root, ".agent_workspace/real-tasks/2026-10-25-attempt-1/record.json"), "utf8"), before);
    await assert.rejects(record(root, metadata({ id: "mismatch" }), [projection(),
      { type: "TASKSPEC_APPLICATION", runId: "run_other", status: "APPLIED" }]), /run/i);
  });
});


test("record and summary refuse workspace junctions instead of reading or writing outside root", async () => {
  await fixture(async root => {
    await fixture(async outside => {
      await symlink(outside, join(root, ".agent_workspace"), "junction");
      await assert.rejects(record(root, metadata()), /physical/i);
      await assert.rejects(summarize(root), /physical/i);
    });
  });
});

async function update(root: string, fields: object, extraArgs: string[] = []) {
  const file = join(root, "review-update.json");
  await writeFile(file, JSON.stringify({ id: "attempt-1", date: "2026-10-25", source: "pi-sparkle", arm: "sparkle", ...fields }), "utf8");
  const { stdout } = await exec(process.execPath, [script, "--root", root, "--metadata", file, "--update", ...extraArgs]);
  const { path } = JSON.parse(stdout) as { path: string };
  return JSON.parse(await readFile(path, "utf8"));
}

test("explicit review update backfills observations without rewriting execution, costs or attempt count", async () => {
  await fixture(async root => {
    const original = await record(root, metadata({ phases: { model: 12 }, notes: "initial" }), projection(), [invocation()]);
    assert.equal(original.correctDelivery, "unknown");
    const reviewed = await update(root, { reviewed: true, kept: true, escapedDefects: 0, phases: { review: 8 }, linkedPR: "https://example.invalid/pr/1" });
    assert.equal(reviewed.correctDelivery, true);
    assert.equal(reviewed.phases.review, 8);
    assert.equal(reviewed.phases.model, 12);
    assert.equal(reviewed.referenceUsd, original.referenceUsd);
    assert.equal(reviewed.runId, original.runId);
    const escaped = await update(root, { escapedDefects: 1, interventions: 2, failureClass: "tool", rootCause: "Synthetic late defect", notes: "follow-up" });
    assert.equal(escaped.correctDelivery, false);
    assert.equal(escaped.accepted, true);
    assert.deepEqual(escaped.cost, original.cost);
    const result = await summarize(root);
    assert.equal(result.week.attempts, 1);
    assert.equal(result.week.correctDeliveries, 0);
    assert.equal(result.week.escapedDefects.knownTotal, 1);
    for (const fields of [{ accepted: false }, { runId: "run_other" }, { referenceUsd: 0 }, { phases: { model: 0 } },
      { source: "soul" }, { arm: "direct-pi" }, { id: "absent" }, { escapedDefects: -1 }]) {
      await assert.rejects(update(root, fields));
    }
    await assert.rejects(update(root, { reviewed: true }, ["--projection", join(root, "projection.json")]));
    await assert.rejects(update(root, { reviewed: true }, ["--state-root", join(root, "state")]));
    assert.equal((await summarize(root)).week.attempts, 1);
  });
});

test("direct Pi delivery requires reviewed operator checks with an evidence reference", async () => {
  await fixture(async root => {
    const fields = { arm: "direct-pi", status: "COMPLETED", accepted: true, effectsSettled: true, reviewed: true, kept: true, escapedDefects: 0 };
    const direct = await record(root, metadata({ ...fields, id: "direct-checked", checkEvidence: "private/checks.txt" }));
    assert.equal(direct.accepted, true);
    assert.equal(direct.correctDelivery, true);
    assert.equal(direct.referenceUsd, "unknown");
    const noEvidence = await record(root, metadata({ ...fields, id: "direct-no-evidence" }));
    assert.equal(noEvidence.accepted, "unknown");
    assert.equal(noEvidence.correctDelivery, "unknown");
    const unreviewed = await record(root, metadata({ ...fields, id: "direct-unreviewed", reviewed: false, checkEvidence: "private/checks.txt" }));
    assert.equal(unreviewed.accepted, "unknown");
    assert.equal(unreviewed.correctDelivery, "unknown");
  });
});

test("summary includes missing measurements and never trusts a bare cached correct-delivery flag", async () => {
  await fixture(async root => {
    const row = await record(root, metadata());
    delete row.status;
    delete row.referenceUsd;
    row.correctDelivery = true;
    await writeFile(join(root, ".agent_workspace/real-tasks/2026-10-25-attempt-1/record.json"), JSON.stringify(row), "utf8");
    const result = await summarize(root);
    assert.equal(result.week.attempts, 1);
    assert.equal(result.week.byStatus.unknown, 1);
    assert.equal(result.week.cost.unknownAttempts, 1);
    assert.equal(result.budget.accountedUsd, 5);
    assert.equal(result.week.correctDeliveries, 0);
    assert.equal(result.week.correctDeliveryUnknown, 1);
  });
});

test("one known per-task budget overrun reports stop even when weekly capacity remains", async () => {
  await fixture(async root => {
    await record(root, metadata(), projection(), [invocation({ tokensIn: 3_000_000 })]);
    const result = await summarize(root);
    assert.equal(result.budget.withinWeeklyLimit, true);
    assert.equal(result.budget.overLimitAttempts, 1);
    assert.equal(result.budget.canAdmitNextTask, false);
    assert.equal(result.budget.admissionReason, "current-week task exceeded US$5");
  });
});

function loopArtifact(runIds = ["run_one"], bodyExtra = {}, envelopeExtra = {}) {
  return { schemaVersion: "loop-artifact-v2", id: "art_v2_00000000-0000-4000-8000-000000000001", runId: runIds.at(-1),
    body: { kind: "native-write-loop", schemaVersion: 1, referenceCost: nativeCostSummary(runIds), attempts: runIds.map((runId, index) => ({ number: index + 1, runId })), ...bodyExtra }, ...envelopeExtra };
}

test("complete task cost requires worker population evidence and cannot infer internal retry usage", async () => {
  await fixture(async root => {
    const missing = await record(root, metadata({ id: "no-population" }), projection(), [invocation()]);
    assert.equal(missing.referenceUsd, "unknown");
    assert.equal(missing.cost.knownLowerBoundUsd, 0.004);
    const retry = await record(root, metadata({ id: "internal-retry" }), projection(), [invocation({ attempt: 2 })], loopArtifact());
    assert.equal(retry.referenceUsd, "unknown");
    assert.equal(retry.cost.knownLowerBoundUsd, 0.004);
    const all = await record(root, metadata({ id: "worker-repair" }), projection(), [invocation({ id: "inv_prior", runId: "run_prior" }), invocation()], loopArtifact(["run_prior", "run_one"]));
    assert.equal(all.referenceUsd, 0.008);
    assert.equal(all.cost.invocationCount, 2);
    const partial = await record(root, metadata({ id: "missing-worker" }), projection(), [invocation()], loopArtifact(["run_prior", "run_one"]));
    assert.equal(partial.referenceUsd, "unknown");
    assert.equal(partial.cost.knownLowerBoundUsd, 0.008);
    for (const bad of [loopArtifact(["run_one", "run_one"]), loopArtifact(["run_other"]),
      loopArtifact(["run_one"], { attempts: [{ number: 2, runId: "run_one" }] }),
      loopArtifact(["run_one"], { candidatePath: "different", sourceRevision: "different" })]) {
      await assert.rejects(record(root, metadata({ id: "bad-loop" }), projection({ candidatePath: "candidate", sourceRevision: "revision" }), [invocation()], bad));
    }
    await assert.rejects(update(root, { id: "no-population" }, ["--loop-artifact", join(root, "loop.json")]));
  });
});

test("unknown call evidence retains known cost lower bound and cannot hide per-task overrun", async () => {
  await fixture(async root => {
    const costly = invocation({ tokensIn: 3_000_000, tokensOut: 0 });
    const unknownRows: (object[] | string)[] = [[costly, invocation({ id: "inv_bad", callOutcome: "error", tokensIn: undefined })],
      [costly, invocation({ id: "inv_bad", pricing: undefined })], JSON.stringify(costly) + "\n{torn"];
    for (const [index, rows] of unknownRows.entries()) {
      const result = await record(root, metadata({ id: `lower-bound-${index}` }), projection(), rows);
      assert.equal(result.referenceUsd, "unknown");
      assert.equal(result.cost.knownLowerBoundUsd, 6);
    }
    const result = await summarize(root);
    assert.equal(result.week.cost.knownUsd, 18);
    assert.equal(result.week.cost.unknownAttempts, 3);
    assert.equal(result.budget.accountedUsd, 18);
    assert.equal(result.budget.unknownReservationUsd, 18);
    assert.equal(result.budget.overLimitAttempts, 3);
    assert.equal(result.budget.canAdmitNextTask, false);
  });
});

test("direct review can backfill independent acceptance but cannot borrow TaskSpec projection authority", async () => {
  await fixture(async root => {
    const initial = await record(root, metadata({ arm: "direct-pi", status: "COMPLETED" }));
    const reviewed = await update(root, { arm: "direct-pi", reviewed: true, checkEvidence: "private/independent-checks.txt", accepted: true,
      effectsSettled: true, kept: true, escapedDefects: 0 });
    assert.equal(reviewed.correctDelivery, true);
    assert.equal(reviewed.referenceUsd, initial.referenceUsd);
    assert.deepEqual(reviewed.cost, initial.cost);
    assert.equal((await summarize(root)).week.attempts, 1);
    await assert.rejects(record(root, metadata({ id: "direct-with-projection", arm: "direct-pi", reviewed: true, kept: true, escapedDefects: 0 }), projection()));
    await assert.rejects(update(root, { arm: "direct-pi", reviewed: false, accepted: true }));
    const p = join(root, ".agent_workspace/real-tasks/2026-10-25-attempt-1/record.json");
    reviewed.runId = "run_one";
    await writeFile(p, JSON.stringify(reviewed), "utf8");
    await assert.rejects(update(root, { arm: "direct-pi", reviewed: true, accepted: true }));
  });
});

test("a final provider attempt two never proves total reference cost", async () => {
  await fixture(async root => {
    const result = await record(root, metadata(), projection(), [invocation({ attempt: 2 })]);
    assert.equal(result.referenceUsd, "unknown");
  });
});

test("direct Pi records reject TaskSpec execution projections", async () => {
  await fixture(async root => {
    await assert.rejects(record(root, metadata({ arm: "direct-pi", reviewed: true, kept: true, escapedDefects: 0 }), projection()));
  });
});


function nativeCostSummary(runIds = ["run_one"], amounts = runIds.map(() => 0.004), dispatches = runIds.map(() => 1)) {
  const knownReferenceUsd = amounts.reduce((sum, amount) => sum + amount, 0);
  return { maxReferenceUsd: 5, knownReferenceUsd, coverage: "complete", settled: true, remainingReferenceUsd: 5 - knownReferenceUsd,
    attempts: runIds.map((runId, index) => ({ number: index + 1, offeredReferenceUsd: 5 - amounts.slice(0, index).reduce((sum, amount) => sum + amount, 0),
      report: { runId, taskId: "task_one", agentInstanceId: "agent_one", streamDispatches: dispatches[index], knownReferenceUsd: amounts[index], coverage: "complete", settled: true,
        ledger: { turns: dispatches[index], turnsWithoutUsage: 0, tokensIn: 1000 * (dispatches[index] ?? 0), tokensOut: 500 * (dispatches[index] ?? 0), spentUsd: amounts[index] } } })) };
}

test("direct host cost reports retain partial spend without execution authority", async () => {
  await fixture(async root => {
    const cost = nativeCostSummary(["run_direct"], [6], [2]).attempts[0]!.report;
    cost.coverage = "partial"; cost.ledger.turnsWithoutUsage = 1;
    const result = await record(root, metadata({ arm: "direct-pi", status: "FAILED" }), undefined, undefined, undefined, { cost });
    assert.equal(result.referenceUsd, "unknown");
    assert.equal(result.cost.knownLowerBoundUsd, 6);
    assert.equal(result.runId, undefined);
    assert.equal(result.accepted, "unknown");
    assert.equal((await summarize(root)).budget.accountedUsd, 6);
    await assert.rejects(() => record(root, metadata({ id: "wrong-arm" }), undefined, undefined, undefined, { cost }), /direct/i);
    await assert.rejects(() => record(root, metadata({ id: "mixed-direct", arm: "direct-pi" }), {}, undefined, undefined, { cost }), /without TaskSpec evidence/);
    const complete = nativeCostSummary(["run_direct"]).attempts[0]!.report;
    const stillUnknown = await record(root, metadata({ id: "direct-complete", arm: "direct-pi", accepted: true, effectsSettled: true }), undefined, undefined, undefined, { cost: complete });
    assert.equal(stillUnknown.referenceUsd, "unknown");
    assert.equal(stillUnknown.accepted, "unknown");
    assert.equal(stillUnknown.effectsSettled, "unknown");
  });
});

async function childBinding(root: string, parent = "run_one", child = "run_child", overrides = {}) {
  const folder = join(root, "state/runtime/runs", parent);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "events.jsonl"), JSON.stringify({ type: "CHILD_RUN_CREATED", runId: parent, taskId: "task_one",
    payload: { childRun: { id: child, parentRunId: parent, rootTaskId: "task_one", ...overrides } } }) + "\n", "utf8");
}

test("parent task records retain bound child worker costs, including partial timeout usage", async () => {
  await fixture(async root => {
    await childBinding(root);
    const complete = await record(root, metadata({ id: "bound-complete" }), projection(),
      [invocation({ runId: "run_child" })], loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_child"]) }));
    assert.equal(complete.referenceUsd, 0.004);
    const partial = nativeCostSummary(["run_child"], [0.0581076], [3]);
    partial.coverage = "partial";
    partial.attempts[0]!.report.coverage = "partial";
    partial.attempts[0]!.report.ledger.turnsWithoutUsage = 1;
    const result = await record(root, metadata({ id: "bound-partial" }), projection({ status: "FAILED" }),
      [invocation({ runId: "run_child", callOutcome: "timeout", tokensIn: undefined, tokensOut: undefined })],
      loopArtifact(["run_one"], { referenceCost: partial }));
    assert.equal(result.referenceUsd, "unknown");
    assert.equal(result.cost.invocationCount, 1);
    assert.equal(result.cost.knownLowerBoundUsd, 0.0581076);
  });
});

test("child cost binding refuses missing, wrong-parent, wrong-task and duplicate worker links", async () => {
  await fixture(async root => {
    for (const [index, overrides] of [undefined, { parentRunId: "run_elsewhere" }, { rootTaskId: "task_elsewhere" }].entries()) {
      if (overrides !== undefined) await childBinding(root, "run_one", "run_child", overrides);
      const result = await record(root, metadata({ id: `bad-child-${index}` }), projection(),
        [invocation({ runId: "run_child" })], loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_child"]) }));
      assert.equal(result.referenceUsd, "unknown");
      assert.equal(result.cost.knownLowerBoundUsd, 0);
    }
    await childBinding(root, "run_prior"); await childBinding(root);
    const duplicate = await record(root, metadata({ id: "duplicate-child" }), projection(), [invocation({ runId: "run_child" })],
      loopArtifact(["run_prior", "run_one"], { referenceCost: nativeCostSummary(["run_child", "run_child"]) }));
    assert.equal(duplicate.referenceUsd, "unknown");
    assert.equal(duplicate.cost.knownLowerBoundUsd, 0);
  });
});

test("known direct failure remains false before positive review evidence is available", async () => {
  await fixture(async root => {
    for (const [index, fields] of [{ status: "FAILED" }, { status: "TIMEOUT" }, { kept: false }, { escapedDefects: 1 }].entries()) {
      const result = await record(root, metadata({ id: `direct-failure-${index}`, arm: "direct-pi", ...fields }));
      assert.equal(result.correctDelivery, false);
    }
    const summaryResult = await summarize(root);
    assert.equal(summaryResult.week.correctDeliveryUnknown, 0);
  });
});

test("independent complete native cost receipt covers a dropped same-run telemetry row", async () => {
  await fixture(async root => {
    const result = await record(root, metadata(), projection(), [invocation()], loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_one"], [0.008], [2]) }));
    assert.equal(result.referenceUsd, 0.008);
    assert.equal(result.cost.knownLowerBoundUsd, 0.008);
    const withoutReceipt = await record(root, metadata({ id: "no-receipt" }), projection(), [invocation()], loopArtifact(["run_one"], { referenceCost: undefined }));
    assert.equal(withoutReceipt.referenceUsd, "unknown");
  });
});

test("partial or inconsistent native cost receipts never certify complete task cost", async () => {
  await fixture(async root => {
    const good = nativeCostSummary();
    const report = good.attempts[0]!.report;
    const invalid = [undefined, { ...good, coverage: "partial" }, { ...good, settled: false }, { ...good, knownReferenceUsd: 1 },
      { ...good, attempts: [] }, { ...good, attempts: [{ ...good.attempts[0], report: null }] },
      { ...good, attempts: [{ ...good.attempts[0], fault: "dropped" }] },
      { ...good, attempts: [{ ...good.attempts[0], report: { ...report, runId: "run_other" } }] },
      { ...good, attempts: [{ ...good.attempts[0], report: { ...report, coverage: "partial" } }] },
      { ...good, attempts: [{ ...good.attempts[0], report: { ...report, settled: false } }] },
      { ...good, attempts: [{ ...good.attempts[0], report: { ...report, streamDispatches: 2 } }] },
      { ...good, attempts: [{ ...good.attempts[0], report: { ...report, ledger: { ...report.ledger, turnsWithoutUsage: 1 } } }] },
      nativeCostSummary(["run_one"], [0.002])];
    for (const [index, receipt] of invalid.entries()) {
      const result = await record(root, metadata({ id: `receipt-${index}` }), projection(), [invocation()], loopArtifact(["run_one"], { referenceCost: receipt }));
      assert.equal(result.referenceUsd, "unknown", `receipt ${index}`);
      assert.equal(result.cost.knownLowerBoundUsd, 0.004);
    }
    const unpriced = await record(root, metadata({ id: "no-prices" }), projection(), [invocation({ pricing: { catalogVersion: "synthetic", inputUsdPerMTok: 0, outputUsdPerMTok: 0 } })], loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_one"], [0]) }));
    assert.equal(unpriced.referenceUsd, "unknown");
  });
});


test("independent complete observed spend survives an entirely missing invocation log", async () => {
  await fixture(async root => {
    const result = await record(root, metadata(), projection(), undefined, loopArtifact(["run_one"], { referenceCost: nativeCostSummary(["run_one"], [6]) }));
    assert.equal(result.referenceUsd, "unknown");
    assert.equal(result.cost.knownLowerBoundUsd, 6);
    const weekly = await summarize(root);
    assert.equal(weekly.budget.accountedUsd, 6);
    assert.equal(weekly.budget.canAdmitNextTask, false);
  });
});

test("partial native observed spend survives missing or unpriced telemetry and still stops overrun", async () => {
  await fixture(async root => {
    const good = nativeCostSummary(["run_one"], [6], [2]);
    const report = good.attempts[0]!.report;
    const partial = { ...good, coverage: "partial", remainingReferenceUsd: undefined,
      attempts: [{ ...good.attempts[0], fault: "incomplete-usage", report: { ...report, coverage: "partial",
        ledger: { ...report.ledger, turnsWithoutUsage: 1 } } }] };
    for (const [index, rows] of [undefined, [invocation({ pricing: undefined })]].entries()) {
      const result = await record(root, metadata({ id: `partial-host-${index}` }), projection(), rows,
        loopArtifact(["run_one"], { referenceCost: partial }));
      assert.equal(result.referenceUsd, "unknown");
      assert.equal(result.cost.knownLowerBoundUsd, 6);
    }
    const result = await summarize(root);
    assert.equal(result.budget.accountedUsd, 12);
    assert.equal(result.budget.overLimitAttempts, 2);
    assert.equal(result.budget.canAdmitNextTask, false);
  });
});

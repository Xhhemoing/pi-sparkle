import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import {
  analyzePairedArms,
  classifyArmOutcome,
  classifyHoldoutBlockEvidenceClass
} from "../../../src/experiments/arm-outcome.js";
import { createRunId } from "../../../src/domain/ids.js";
import { taskSuccessFromResult } from "../../../src/learning/task-success.js";
import { deleteRunRecords, verifyRunRecordsRemoved } from "../../../src/privacy/deletion.js";
import { appendJsonlLine, readJsonlObjects } from "../../../src/persist/jsonl.js";
import { EventStore } from "../../../src/run/event-store.js";
import { classifyTaskFailure } from "../../../src/routing/failure-class.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

test("P1 JSONL: truncate recovery then append+read stays clean", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-p5-jsonl-"));
  const path = join(dir, "log.jsonl");
  try {
    await writeFile(path, Buffer.from('{"ok":true}\n{"partial', "utf8"));
    const recovered = await readJsonlObjects(path, (line) => new Error(`corrupt ${line}`), { repair: true });
    assert.equal(recovered.recovery.incompleteLine, '{"partial');
    await appendJsonlLine(path, JSON.stringify({ n: 2 }), false);
    const again = await readJsonlObjects(path, (line) => new Error(`corrupt ${line}`));
    assert.deepEqual(again, { values: [{ ok: true }, { n: 2 }], recovery: {} });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("P1 JSONL: corrupt middle stays fail-closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-p5-mid-"));
  const path = join(dir, "log.jsonl");
  try {
    await writeFile(path, '{"first":true}\nNOT JSON\n{"last":true}\n', "utf8");
    await assert.rejects(
      () => readJsonlObjects(path, (line) => new Error(`corrupt ${line}`)),
      /corrupt 2/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("P1 delete verification: removed records stay gone", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-p5-del-"));
  const runId = createRunId(() => "01234567-89ab-cdef-0123-456789abcdef");
  try {
    const store = new EventStore(stateRoot, runId);
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    await deleteRunRecords(stateRoot, runId);
    await verifyRunRecordsRemoved(stateRoot, runId);
    const again = await store.readAll();
    assert.deepEqual(again.events, []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("P3 self-report PASSED with empty evidenceIds is not independent PASS", () => {
  const result = evaluateIndependentAcceptance({
    selfReport: {
      source: "subagent",
      verification: "PASSED",
      evidenceIds: [],
      summary: "looks good"
    },
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, false);
});

test("P4 F6: harness UNKNOWN / empty arms are not production-candidate", () => {
  const collect = classifyArmOutcome({ arm: "R0", invocations: [], status: "UNKNOWN" }, "pi");
  assert.equal(collect.evidenceClass, "harness-failure");
  assert.equal(collect.experimentEligible, false);
  assert.equal(
    classifyHoldoutBlockEvidenceClass({
      executor: "pi",
      results: [
        { invocations: [], status: "UNKNOWN" },
        { invocations: [], status: "UNKNOWN" }
      ]
    }),
    "harness-failure"
  );
  const paired = analyzePairedArms({
    executor: "pi",
    r0: { arm: "R0", invocations: [], status: "UNKNOWN" },
    r1: { arm: "R1", invocations: [], status: "UNKNOWN" }
  });
  assert.notEqual(paired.evidenceClass, "production-candidate");
});

test("HOTFIX: UNOBSERVED provider failure stays out of taskSuccess and is not model", () => {
  assert.equal(taskSuccessFromResult("FAILURE", "UNOBSERVED"), undefined);
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "UNOBSERVED",
      httpStatus: 429,
      summary: "429 rate limited",
      failure: { category: "PROVIDER_ERROR", detail: "429" }
    }),
    "provider"
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRun } from "../../../src/domain/run.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { validateEvent } from "../../../src/run/events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "../../../src/run/replay.js";

import { isRunEngineBinding, snapshotRunEngineBinding } from "../../../src/domain/run-engine-binding.js";
import { assertRunEngineForResume, bindingForNewRun, captureRunEngineContext, type RunEngineContext } from "../../../src/run/engine-binding.js";

const A = { kind: "managed-pi" as const, generationId: "11111111-1111-4111-8111-111111111111" };
const now = parseIsoTimestamp("2026-10-20T00:00:00.000Z");
const run = { id: createRunId(), projectId: createProjectId(), rootTaskId: createTaskId(), status: "PLANNING", limits: defaultRunLimits(), createdAt: now, updatedAt: now };

test("optional managed binding validates at run, event and checkpoint boundaries", () => {
  assert.equal(Object.hasOwn(validateRun(run), "engineBinding"), false);
  assert.deepEqual(validateRun({ ...run, engineBinding: A }).engineBinding, A);
  for (const engineBinding of [null, [], {}, { ...A, kind: "other" }, { ...A, generationId: "" }, { ...A, generationId: A.generationId.toUpperCase().replace("1", "A") }, { ...A, generationId: "not-a-uuid" }, { ...A, path: "/engine" }]) {
    assert.throws(() => validateRun({ ...run, engineBinding }), /engineBinding/, JSON.stringify(engineBinding));
    const event = { id: "evt_test", schemaVersion: 1, occurredAt: now, runId: run.id, type: "RUN_CREATED", actor: "test", payload: { run: { ...run, engineBinding } } };
    assert.throws(() => validateEvent(event), /engineBinding/);
    assert.throws(() => validateEvent({ ...event, type: "CHILD_RUN_CREATED", payload: { childRun: { ...run, engineBinding } } }), /engineBinding/);
    const checkpoint = materializeCheckpoint(replayRun([]), now);
    assert.throws(() => validateCheckpoint({ ...checkpoint, run: { ...run, engineBinding } }), /engineBinding/);
  }
});



test("context capture refuses malformed managed input and detaches binding and callback", async () => {
  for (const invalid of [null, [], {}, { binding: A }, { binding: A, assertQualifiedGeneration: true }, { binding: { ...A, extra: true }, assertQualifiedGeneration: async () => {} }]) {
    assert.throws(() => captureRunEngineContext(invalid as RunEngineContext), /engine|QualifiedGeneration/i);
  }
  assert.equal(isRunEngineBinding(A), true);
  const binding = snapshotRunEngineBinding(A);
  assert.notEqual(binding, A);
  assert.equal(Object.isFrozen(binding), true);
  const source = { binding: { ...A }, assertQualifiedGeneration: async (value: unknown) => { assert.deepEqual(value, A); } };
  const captured = captureRunEngineContext(source)!;
  source.binding.generationId = "22222222-2222-4222-8222-222222222222";
  source.assertQualifiedGeneration = async () => { throw new Error("new callback"); };
  assert.deepEqual(await bindingForNewRun(captured), A);
  assert.equal(await bindingForNewRun(undefined), undefined);
});

test("resume binding table rejects implicit adoption and switching before qualification", async () => {
  let checks = 0;
  const context = captureRunEngineContext({ binding: A as RunEngineContext["binding"], assertQualifiedGeneration: async () => { checks++; } })!;
  await assertRunEngineForResume(undefined, undefined);
  await assert.rejects(() => assertRunEngineForResume(undefined, context), /legacy/);
  await assert.rejects(() => assertRunEngineForResume(context.binding, undefined), /original engine/);
  await assert.rejects(() => assertRunEngineForResume({ ...context.binding, generationId: "22222222-2222-4222-8222-222222222222" }, context), /mismatch/);
  assert.equal(checks, 0);
  await assertRunEngineForResume(context.binding, context);
  assert.equal(checks, 1);
});

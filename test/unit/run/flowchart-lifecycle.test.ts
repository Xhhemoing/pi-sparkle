import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEventId } from "../../../src/domain/ids.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { pauseFlowchartRun, resumeFlowchartRun, unblockFlowchartRun } from "../../../src/run/flowchart-run.js";
import { materializeCheckpoint, replayRun } from "../../../src/run/replay.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const now = parseIsoTimestamp("2026-10-15T00:00:00.000Z");
type Case = "empty" | "no-run" | "no-project" | "no-checkpoint" | "no-flowchart" | "malformed" | "blocked";

async function withRecoveryCase(kind: Case, body: (context: {
  stateRoot: string; runId: ReturnType<typeof makeRun>["id"]; events: Event[]; checkpoint: CheckpointStore;
}) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "flowchart-recovery-"));
  const run = makeRun();
  const project: ProjectSnapshot = { id: run.projectId, rootPath: stateRoot, discoveredAt: now,
    instructionFiles: [], manifests: [], commands: [], facts: [] };
  const event = (type: Event["type"], payload: unknown): Event => makeEvent(type, payload, { id: createEventId() });
  const events = kind === "empty" ? [] : kind === "no-run" ? [event("RUN_STARTED", {})] : [event("RUN_CREATED", { run })];
  if (!["empty", "no-run", "no-project"].includes(kind)) events.push(event("PROJECT_DISCOVERED", { project }));
  if (kind === "blocked") events.push(event("RUN_BLOCKED", { reason: "blocked fixture", requiredEvidence: [] }));
  const store = new EventStore(stateRoot, run.id);
  const checkpoint = new CheckpointStore(stateRoot, run.id);
  try {
    for (const row of events) await store.append(row);
    if (kind === "no-flowchart") await checkpoint.write(materializeCheckpoint(replayRun(events), now));
    if (kind === "malformed") await checkpoint.write({ schemaVersion: 99 });
    await body({ stateRoot, runId: run.id, events, checkpoint });
    assert.deepEqual((await store.readAll()).events, events, "refused recovery must not append run events");
  } finally { await rm(stateRoot, { recursive: true, force: true }); }
}

function dependencies(stateRoot: string) {
  return { stateRoot, now: () => now, router: createModelRouter({ policyVersion: "recovery-test",
    models: [{ id: "model", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] }) };
}

for (const action of ["resume", "pause"] as const) {
  for (const kind of ["empty", "no-run", "no-project", "no-checkpoint", "no-flowchart"] as const) {
    test(`${action} preserves durable recovery prerequisite ordering: ${kind}`, async () => {
      await withRecoveryCase(kind, async ({ stateRoot, runId }) => {
        const expected = kind === "empty" ? `Run ${runId} not found` : kind === "no-run" ? `Run ${runId} has no RUN_CREATED event` :
          kind === "no-project" ? `Run ${runId} has no PROJECT_DISCOVERED event` : kind === "no-checkpoint" ?
            `Flowchart run ${runId} has no durable checkpoint; refusing to invent state` :
            `Flowchart run ${runId} checkpoint is missing flowchart snapshot`;
        await assert.rejects(action === "resume" ? resumeFlowchartRun(dependencies(stateRoot), runId) :
          pauseFlowchartRun(dependencies(stateRoot), runId, "characterization"),
        (error: unknown) => error instanceof DomainValidationError && error.message === expected);
      });
    });
  }
}

test("resume preserves malformed checkpoint validation before snapshot presence", async () => {
  await withRecoveryCase("malformed", async ({ stateRoot, runId }) => {
    await assert.rejects(resumeFlowchartRun(dependencies(stateRoot), runId), /Invalid RunCheckpoint: schemaVersion/);
  });
});

test("unblock rejects the nonblocked log before demanding a checkpoint", async () => {
  await withRecoveryCase("no-checkpoint", async ({ stateRoot, runId }) => {
    await assert.rejects(unblockFlowchartRun(dependencies(stateRoot), runId, { reason: "characterization" }),
      (error: unknown) => error instanceof DomainValidationError && error.message === "cannot unblock a PLANNING run: unblock clears one active RUN_BLOCKED");
  });
});

test("unblock preserves checkpoint prerequisites once a block exists", async () => {
  await withRecoveryCase("blocked", async ({ stateRoot, runId, events, checkpoint }) => {
    await assert.rejects(unblockFlowchartRun(dependencies(stateRoot), runId, { reason: "characterization" }),
      (error: unknown) => error instanceof DomainValidationError && error.message === `Flowchart run ${runId} has no durable checkpoint; refusing to invent state`);
    await checkpoint.write(materializeCheckpoint(replayRun(events), now));
    await assert.rejects(unblockFlowchartRun(dependencies(stateRoot), runId, { reason: "characterization" }),
      (error: unknown) => error instanceof DomainValidationError && error.message === `Flowchart run ${runId} checkpoint is missing flowchart snapshot`);
  });
});

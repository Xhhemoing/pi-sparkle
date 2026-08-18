import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventId, createRunId } from "../../../src/domain/ids.js";
import { EventStore } from "../../../src/run/event-store.js";
import { applyTrackingGate } from "../../../src/run/gate-apply.js";
import { hashAssessment, parseTrackingAssessment } from "../../../src/tracking/types.js";

test("EventStore replay of the same assessmentHash+seq still has one GATE_TRANSITION", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-gate-apply-"));
  const runId = createRunId(() => "a");
  const store = new EventStore(stateRoot, runId);
  let seq = 0;
  const generateEventId = () => createEventId(() => `g${++seq}`);
  try {
    const assessment = parseTrackingAssessment({
      schemaVersion: 1,
      episodeId: "ep_a",
      runId,
      turnId: "trn_1",
      prescore: 0.2,
      quality: 0,
      coverage: 1,
      human: { kind: "unobserved" },
      score: 0.2,
      dimensions: [{ id: "scope-safety", verdict: "FAIL", evidenceRefs: ["evd_esc"] }],
      gate: {
        kind: "hard",
        codes: ["ownership-escape"],
        wakeAnalysis: true,
        expandDetail: true,
        askUser: false,
        openMinors: []
      },
      evidenceRefs: ["evd_esc"]
    });
    const assessmentHash = hashAssessment(assessment);
    const first = applyTrackingGate({
      events: [],
      assessment,
      assessmentHash,
      expectedSeq: 1,
      policyVersion: "track-v1",
      nowIso: "2026-08-18T00:00:00.000Z",
      generateEventId
    });
    assert.equal(first.result.applied, true);
    for (const event of first.events) {
      await store.append(event);
    }

    const replayed = await store.readAll();
    const second = applyTrackingGate({
      events: replayed.events,
      assessment,
      assessmentHash,
      expectedSeq: 1,
      policyVersion: "track-v1",
      nowIso: "2026-08-18T00:00:01.000Z",
      generateEventId
    });
    assert.equal(second.result.applied, false);
    assert.equal(
      second.events.filter((event) => event.type === "GATE_TRANSITION").length,
      1
    );
    assert.equal(
      replayed.events.filter((event) => event.type === "GATE_TRANSITION").length,
      1
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

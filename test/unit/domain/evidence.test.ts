import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createArtifactId,
  createEventId,
  createEvidenceId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { validateArtifact, validateEvidence } from "../../../src/domain/evidence.js";
import { validateRun } from "../../../src/domain/run.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

test("a valid run validates", () => {
  const run = {
    id: createRunId(UUID),
    projectId: createProjectId(UUID),
    rootTaskId: createTaskId(UUID),
    status: "PLANNING",
    limits: defaultRunLimits(),
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z"
  };
  assert.deepEqual(validateRun(run), run);
});

test("a run with an optional parent run id validates", () => {
  const run = {
    id: createRunId(UUID),
    projectId: createProjectId(UUID),
    parentRunId: createRunId(() => "11111111-2222-3333-4444-555555555555"),
    rootTaskId: createTaskId(UUID),
    status: "PLANNING",
    limits: defaultRunLimits(),
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z"
  };
  assert.deepEqual(validateRun(run), run);
});

test("invalid runs are rejected", () => {
  const base = {
    id: createRunId(UUID),
    projectId: createProjectId(UUID),
    rootTaskId: createTaskId(UUID),
    status: "PLANNING",
    limits: defaultRunLimits(),
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z"
  };
  assert.throws(() => validateRun({ ...base, id: "nope" }), /id/);
  assert.throws(() => validateRun({ ...base, projectId: 7 }), /projectId/);
  assert.throws(() => validateRun({ ...base, parentRunId: "nope" }), /parentRunId/);
  assert.throws(() => validateRun({ ...base, rootTaskId: "" }), /rootTaskId/);
  assert.throws(() => validateRun({ ...base, status: "DONE" }), /status/);
  assert.throws(() => validateRun({ ...base, limits: { ...defaultRunLimits(), maxTasks: 0 } }), /limits/);
  assert.throws(() => validateRun({ ...base, createdAt: "bad" }), /createdAt/);
  assert.throws(() => validateRun({ ...base, updatedAt: 123 }), /updatedAt/);
});

test("evidence validates and rejects malformed entries", () => {
  const evidence = {
    id: createEvidenceId(UUID),
    kind: "TOOL_EVENT",
    summary: "Ran pnpm test",
    sourceEventId: createEventId(UUID),
    confidence: "HIGH",
    redaction: "NONE"
  };
  assert.deepEqual(validateEvidence(evidence), evidence);
  assert.throws(() => validateEvidence({ ...evidence, kind: "NOPE" }), /kind/);
  assert.throws(() => validateEvidence({ ...evidence, summary: "" }), /summary/);
  assert.throws(() => validateEvidence({ ...evidence, sourceEventId: "x" }), /sourceEventId/);
  assert.throws(() => validateEvidence({ ...evidence, confidence: "SURE" }), /confidence/);
  assert.throws(() => validateEvidence({ ...evidence, redaction: "PARTIAL" }), /redaction/);
});

test("artifacts validate and reject malformed entries", () => {
  const artifact = {
    id: createArtifactId(UUID),
    kind: "COMMAND_OUTPUT",
    contentPath: "/tmp/x/out.txt",
    sha256: "a".repeat(64),
    createdByEventId: createEventId(UUID)
  };
  assert.deepEqual(validateArtifact(artifact), artifact);
  const minimal = { id: createArtifactId(UUID), kind: "TEXT", createdByEventId: createEventId(UUID) };
  assert.deepEqual(validateArtifact(minimal), minimal);
  assert.throws(() => validateArtifact({ ...artifact, kind: "VIDEO" }), /kind/);
  assert.throws(() => validateArtifact({ ...artifact, contentPath: "" }), /contentPath/);
  assert.throws(() => validateArtifact({ ...artifact, sha256: "xyz" }), /sha256/);
  assert.throws(() => validateArtifact({ ...artifact, createdByEventId: "nope" }), /createdByEventId/);
});

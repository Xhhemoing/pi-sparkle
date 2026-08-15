import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createArtifactId,
  createAgentInstanceId,
  createEventId,
  createEvidenceId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId,
  isRunId,
  parseMessageId,
  parseRunId
} from "../../../src/domain/ids.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

test("id factories produce prefixed branded ids", () => {
  assert.match(createProjectId(UUID), /^prj_/);
  assert.match(createRunId(UUID), /^run_/);
  assert.match(createTaskId(UUID), /^tsk_/);
  assert.match(createMessageId(UUID), /^msg_/);
  assert.match(createEventId(UUID), /^evt_/);
  assert.match(createArtifactId(UUID), /^art_/);
  assert.match(createEvidenceId(UUID), /^evd_/);
  assert.match(createAgentInstanceId(UUID), /^agt_/);
  assert.ok(createRunId().startsWith("run_"));
});

test("parseRunId accepts a well-formed run id", () => {
  const id = createRunId(UUID);
  assert.equal(parseRunId(id), id);
  assert.equal(isRunId(id), true);
  assert.equal(isRunId("run_abc"), true);
});

test("parseMessageId accepts a well-formed message id", () => {
  const id = createMessageId(UUID);
  assert.equal(parseMessageId(id), id);
});

test("parseRunId rejects malformed values", () => {
  const bad = [
    undefined,
    null,
    42,
    "",
    "run",
    "run_",
    "RUN_xyz",
    "task_abc",
    "run_!!!",
    "run_" + "x".repeat(1000)
  ];
  for (const value of bad) {
    assert.throws(() => parseRunId(value), /Invalid RunId/);
    assert.equal(isRunId(value), false);
  }
});

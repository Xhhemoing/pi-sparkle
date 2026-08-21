import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAgentProfiles } from "../../../src/agents/registry.js";
import { compileContextPacket } from "../../../src/context/packet.js";
import { createEmptyContext } from "../../../src/context/index.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { formatChildPrompt } from "../../../src/run/child-prompt.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

test("child prompt injects the role instruction, write policy, and grounding before the objective", () => {
  const implementer = defaultAgentProfiles().find((profile) => profile.role === "implementer");
  assert.ok(implementer);
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: {
      schemaVersion: 1,
      objective: "Implement the parser",
      deliverables: [],
      constraints: [{ id: "c-smallest", description: "Change only files required by the objective", enforceable: false }],
      nonGoals: ["Drive-by refactors"],
      acceptanceCriteria: [{ id: "ac-1", description: "parser works", observableCheck: "pnpm test" }],
      assumptions: [],
      questions: [],
      authority: [],
      sourceRefs: []
    },
    index: createEmptyContext(createProjectId(UUID), parseIsoTimestamp("2026-08-12T09:00:00.000Z")),
    tokenBudget: 4000,
    selectorVersion: 1
  });
  const prompt = formatChildPrompt({
    role: "implementer",
    objective: "Implement the parser",
    profile: implementer,
    packet,
    predecessorNotes: ["tsk_scout: found src/parser.ts"],
    acceptanceCriteria: [{ id: "ac-1", description: "parser works" }]
  });
  assert.match(prompt, /smallest change|Read the existing code/i);
  assert.match(prompt, /Write access: allowed/);
  assert.match(prompt, /Change only files required by the objective/);
  assert.match(prompt, /tsk_scout: found src\/parser\.ts/);
  assert.match(prompt, /ac-1: parser works/);
  const objectiveAt = prompt.indexOf("Objective:");
  const instructionAt = prompt.indexOf(implementer.systemInstruction.slice(0, 24));
  assert.ok(instructionAt >= 0 && objectiveAt > instructionAt);
});

test("read-only roles are told they cannot write the workspace", () => {
  const reviewer = defaultAgentProfiles().find((profile) => profile.role === "reviewer");
  assert.ok(reviewer);
  const prompt = formatChildPrompt({
    role: "reviewer",
    objective: "Review the change",
    profile: reviewer
  });
  assert.match(prompt, /Write access: forbidden/);
  assert.match(prompt, /rubber-stamp|Reject missing tests/i);
});

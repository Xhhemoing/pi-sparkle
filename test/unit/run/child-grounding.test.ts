import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createEmptyContext } from "../../../src/context/index.js";
import {
  createArtifactId,
  createProjectId,
  createTaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { groundChildTask } from "../../../src/run/child-grounding.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function child(): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: createTaskId(() => "impl"),
    role: "implementer",
    objective: "Implement the parser",
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 },
    dependsOn: [createTaskId(() => "scout")]
  };
}

test("grounding forwards predecessor artifacts and summaries into the child", () => {
  const scoutId = createTaskId(() => "scout");
  const artifactId = createArtifactId(() => "scout-out");
  const grounded = groundChildTask({
    child: child(),
    predecessors: [
      {
        taskId: scoutId,
        summary: "found src/parser.ts",
        artifactIds: [artifactId]
      }
    ],
    index: {
      ...createEmptyContext(createProjectId(UUID), parseIsoTimestamp("2026-08-12T09:00:00.000Z")),
      validationRoutes: ["test"],
      facts: [
        {
          key: "validation.route:test",
          value: "pnpm test",
          trust: "HIGH",
          sourceHash: "h",
          freshness: "fresh"
        }
      ]
    },
    contract: {
      schemaVersion: 1,
      objective: "Implement the parser",
      deliverables: [],
      constraints: [{ id: "c-smallest", description: "smallest change", enforceable: false }],
      nonGoals: [],
      acceptanceCriteria: [],
      assumptions: [],
      questions: [],
      authority: [],
      sourceRefs: []
    }
  });
  assert.deepEqual(grounded.inputArtifactIds, [artifactId]);
  assert.ok(grounded.predecessorNotes?.some((note) => note.includes("found src/parser.ts")));
  assert.ok(grounded.contextPacket?.requiredFacts.includes("smallest change"));
  assert.ok(grounded.contextPacket?.requiredFacts.includes("found src/parser.ts"));
});

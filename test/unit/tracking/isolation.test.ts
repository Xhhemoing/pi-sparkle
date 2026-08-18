import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyContext } from "../../../src/context/index.js";
import { compileContextPacket } from "../../../src/context/packet.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { bindExecutionContext, executionMayNotReadSummary } from "../../../src/tracking/isolation.js";
import type { RollingSummary } from "../../../src/tracking/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const NOW = parseIsoTimestamp("2026-08-18T00:00:00.000Z");

const SUMMARY: RollingSummary = {
  schemaVersion: 1,
  constraints: [],
  unresolvedQuestions: [],
  confirmedDecisions: [],
  operations: [],
  prescore: 0.88,
  human: { kind: "unobserved" },
  score: 0.88,
  anomalyCodes: [],
  evidenceRefs: ["evd_track"],
  openMinors: [],
  omissions: [],
  failClosed: false
};

describe("execution / tracking isolation", () => {
  it("gives execution only the task context packet", () => {
    const packet = compileContextPacket({
      taskId: createTaskId(() => "iso0001"),
      contract: {
        schemaVersion: 1,
        objective: "ship the fix",
        deliverables: [],
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: [],
        assumptions: [],
        questions: [],
        authority: [],
        sourceRefs: []
      },
      index: createEmptyContext(createProjectId(UUID), NOW),
      tokenBudget: 400,
      selectorVersion: 1
    });
    const bound = bindExecutionContext(packet, SUMMARY);
    assert.deepEqual(bound, packet);
    assert.equal(executionMayNotReadSummary(bound, SUMMARY), true);
    assert.equal("prescore" in bound, false);
    assert.equal("openMinors" in bound, false);
  });

  it("keeps run and execution source off the tracking summary module", () => {
    const files = [
      ...listTs(join(REPO_ROOT, "src", "execution")),
      join(REPO_ROOT, "src", "run", "coordinator.ts"),
      join(REPO_ROOT, "src", "run", "child-coordinator.ts"),
      join(REPO_ROOT, "src", "context", "packet.ts")
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /from ["'][^"']*tracking\//, file);
    }
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listTs(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

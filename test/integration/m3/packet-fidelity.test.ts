import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjectContextIndex,
  type ProjectContextIndex
} from "../../../src/context/index.js";
import { compileContextPacket, queryPacketGrounding } from "../../../src/context/packet.js";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function snapshot(): ProjectSnapshot {
  return {
    id: createProjectId(UUID),
    rootPath: "/fixtures/packet-fidelity",
    discoveredAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
    instructionFiles: [{ path: "/fixtures/packet-fidelity/AGENTS.md" }],
    manifests: [{ path: "/fixtures/packet-fidelity/package.json" }],
    commands: [
      { name: "test", command: "pnpm test" },
      { name: "lint", command: "pnpm lint" }
    ],
    facts: [
      { key: "risk.migration", value: "pending payments table migration", confidence: "HIGH" }
    ]
  };
}

function contract(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Add refund endpoint",
    deliverables: [],
    constraints: [
      { id: "c-privacy", description: "never log card numbers", enforceable: true }
    ],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "ac-1", description: "refund works", observableCheck: "pnpm test" }
    ],
    assumptions: [],
    questions: [
      { id: "q-refund-store", question: "Where do refunds record?", options: ["ledger", "orders"] }
    ],
    authority: [{ scope: "src/pay", actions: ["edit"] }],
    sourceRefs: []
  };
}

function buildPacket(tokenBudget: number, dependencyOutputs: readonly string[]) {
  const index: ProjectContextIndex = buildProjectContextIndex(snapshot(), {
    now: parseIsoTimestamp("2026-08-21T08:00:00.000Z")
  });
  return compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract(),
    index,
    tokenBudget,
    selectorVersion: 1,
    dependencyOutputs: [...dependencyOutputs]
  });
}

test("every mandatory category survives compilation under an adequate budget", () => {
  const packet = buildPacket(8000, ["payments/refund-types.d.ts"]);
  const joined = packet.requiredFacts.join("\n");
  assert.ok(joined.includes("never log card numbers"), "constraint missing");
  assert.ok(joined.includes("src/pay") && joined.includes("edit"), "authority grant incomplete");
  assert.ok(joined.includes("Where do refunds record?") && joined.includes("ledger"), "question incomplete");
  assert.ok(joined.includes("validation route: test"), "validation route missing");
  assert.ok(joined.includes("dependency output: payments/refund-types.d.ts"), "dependency output missing");
  const mandatoryOmitted = packet.omissions.filter((omission) => omission.rank === 1);
  assert.deepEqual(mandatoryOmitted, []);
});

test("an inadequate budget still records mandatory omissions inspectably instead of truncating", () => {
  const packet = buildPacket(5, ["payments/refund-types.d.ts"]);
  assert.ok(!packet.requiredFacts.some((fact) => fact.includes("never log card numbers")));
  assert.ok(
    packet.omissions.some((omission) => omission.key === "constraint:c-privacy" && omission.reason === "token-budget")
  );
});

test("downstream fixture questions are answerable without the parent transcript", () => {
  const packet = buildPacket(8000, ["payments/refund-types.d.ts"]);
  const qa: ReadonlyArray<readonly [string, string]> = [
    ["what constraint applies to card numbers?", "never log card numbers"],
    ["which validation route proves the acceptance criterion?", "validation route: test"],
    ["where do refunds get recorded and what are the options?", "ledger"],
    ["what did the upstream dependency produce?", "payments/refund-types.d.ts"],
    ["any migration risk before I edit payments?", "pending payments table migration"]
  ];
  for (const [question, expected] of qa) {
    const answers = queryPacketGrounding(packet, question);
    assert.ok(
      answers.some((line) => line.includes(expected)),
      `question "${question}" not answerable; got: ${answers.join(" | ")}`
    );
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyContext } from "../../../src/context/index.js";
import type { ProjectContextIndex } from "../../../src/context/index.js";
import {
  compileContextPacket,
  compilePacket,
  formatPacketForPrompt,
  queryPacketGrounding
} from "../../../src/context/packet.js";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const NOW = parseIsoTimestamp("2026-08-12T09:00:00.000Z");

function contract(overrides: Partial<RequirementContract> = {}): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Ship a private patch",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "ac-1", description: "tests pass", observableCheck: "pnpm test" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: [],
    ...overrides
  };
}

function index(overrides: Partial<ProjectContextIndex> = {}): ProjectContextIndex {
  return {
    ...createEmptyContext(createProjectId(UUID), NOW),
    ...overrides
  };
}

test("privacy constraint in the contract is present in the packet", () => {
  const privacy = "Do not log PII or secrets";
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c-privacy", description: privacy, enforceable: true }]
    }),
    index: index(),
    tokenBudget: 4000,
    selectorVersion: 1
  });
  assert.ok(packet.requiredFacts.includes(privacy));
  assert.equal(packet.selectorVersion, 1);
});

test("conflicting facts remain separate after collapse", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract(),
    index: index({
      facts: [
        { key: "language", value: "typescript", trust: "HIGH", sourceHash: "a", freshness: "fresh" },
        { key: "language", value: "python", trust: "MEDIUM", sourceHash: "b", freshness: "fresh" }
      ]
    }),
    tokenBudget: 4000,
    selectorVersion: 1
  });
  const languageFacts = packet.requiredFacts.filter((fact) => fact.includes("typescript") || fact.includes("python"));
  assert.equal(languageFacts.length, 2);
  assert.ok(languageFacts.some((fact) => fact.includes("typescript")));
  assert.ok(languageFacts.some((fact) => fact.includes("python")));
});

test("token overflow produces omission records instead of silent drops", () => {
  const mandatory = "This privacy constraint must never be silently truncated from the packet";
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c-long", description: mandatory, enforceable: true }]
    }),
    index: index(),
    tokenBudget: 2,
    selectorVersion: 1
  });
  assert.ok(!packet.requiredFacts.includes(mandatory));
  assert.ok(!packet.requiredFacts.some((fact) => mandatory.startsWith(fact) && fact.length < mandatory.length && fact.length > 0));
  assert.ok(packet.omissions.some((omission) => omission.reason === "token-budget" && omission.key === "constraint:c-long"));
  assert.ok(packet.omittedSummary.some((row) => row.reason === "token-budget" && row.count >= 1));
});

test("secret evidence refs are not expanded into packet text", () => {
  const secretRef = "/run/secrets/api.key";
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c1", description: "keep secrets out of prompts", enforceable: true }]
    }),
    index: index({ instructionPrecedence: ["/tmp/demo/AGENTS.md"] }),
    tokenBudget: 4000,
    selectorVersion: 1,
    secretEvidenceRefs: [secretRef, "evd_seeded-secret"]
  });
  const blob = `${packet.requiredFacts.join("\n")}\n${packet.relevantFiles.join("\n")}`;
  assert.ok(!blob.includes(secretRef));
  assert.ok(!blob.includes("evd_seeded-secret"));
  assert.ok(!packet.relevantFiles.includes(secretRef));
  assert.ok(packet.omissions.some((omission) => omission.reason === "secret"));
});

test("unrelated dirty paths are not treated as required facts", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract(),
    index: index({
      dirtyUnrelated: ["src/unrelated.ts"],
      validationRoutes: ["lint"],
      facts: [
        { key: "validation.route:lint", value: "eslint .", trust: "HIGH", sourceHash: "x", freshness: "fresh" }
      ]
    }),
    tokenBudget: 4000,
    selectorVersion: 1
  });
  assert.ok(packet.requiredFacts.includes("validation route: lint"));
  assert.ok(!packet.requiredFacts.some((fact) => fact.includes("unrelated")));
  assert.ok(!packet.relevantFiles.includes("src/unrelated.ts"));
  assert.ok(packet.omissions.some((omission) => omission.reason === "unrelated-dirty"));
});

test("selected code-map entries reach the packet with public interfaces and call edges intact", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract(),
    index: index({
      codeMap: {
        schemaVersion: 1,
        tokenBudget: 100,
        estimatedTokens: 12,
        entries: [
          {
            path: "src/api.ts",
            symbol: "TaskRunner",
            kind: "interface",
            public: true,
            calls: ["cancel", "run"]
          }
        ],
        omissions: []
      }
    }),
    tokenBudget: 4000,
    selectorVersion: 1
  });

  assert.deepEqual(packet.codeMap.entries, [
    {
      path: "src/api.ts",
      symbol: "TaskRunner",
      kind: "interface",
      public: true,
      calls: ["cancel", "run"]
    }
  ]);
  assert.equal(packet.codeMap.tokenBudget, 100);
  assert.ok(packet.codeMap.estimatedTokens > 0);
});

test("code-map omissions remain inspectable across index and packet token budgets", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract(),
    index: index({
      codeMap: {
        schemaVersion: 1,
        tokenBudget: 20,
        estimatedTokens: 12,
        entries: [
          {
            path: "src/api.ts",
            symbol: "TaskRunner",
            kind: "interface",
            public: true,
            calls: ["cancel", "run"]
          }
        ],
        omissions: [
          {
            path: "src/internal.ts",
            symbol: "helper",
            reason: "token-budget",
            rank: 2
          }
        ]
      }
    }),
    tokenBudget: 1,
    selectorVersion: 1
  });

  assert.deepEqual(packet.codeMap.entries, []);
  assert.deepEqual(packet.codeMap.omissions.map((item) => item.symbol), ["TaskRunner", "helper"]);
  assert.ok(packet.omissions.some((item) => item.key === "code-map:src/api.ts:TaskRunner"));
  assert.ok(packet.omissions.some((item) => item.key === "code-map:src/internal.ts:helper"));
});

test("same frozen inputs produce equal packets", () => {
  const request = {
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c-privacy", description: "no PII", enforceable: true }],
      authority: [{ scope: "src/context", actions: ["edit"] }],
      questions: [{ id: "q1", question: "Which store?", options: ["jsonl"] }]
    }),
    index: index({
      validationRoutes: ["typecheck"],
      facts: [{ key: "package_manager", value: "pnpm", trust: "HIGH", sourceHash: "h", freshness: "fresh" }]
    }),
    tokenBudget: 4000,
    selectorVersion: 1 as const,
    dependencyOutputs: ["coverage/summary.json"]
  };
  assert.deepEqual(compileContextPacket(request), compileContextPacket(request));
});

test("compilePacket wrapper still works for empty-contract callers", () => {
  const packet = compilePacket(createTaskId(UUID), createEmptyContext(createProjectId(UUID), NOW), 128);
  assert.equal(packet.tokenBudget, 128);
  assert.equal(packet.selectorVersion, 1);
  assert.equal(typeof packet.contractDigest, "string");
  assert.deepEqual(packet.requiredFacts, []);
});

test("formatPacketForPrompt tells the agent not to invent files", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c-smallest", description: "smallest change", enforceable: false }]
    }),
    index: index(),
    tokenBudget: 4000,
    selectorVersion: 1
  });
  const text = formatPacketForPrompt(packet);
  assert.match(text, /do not invent/i);
  assert.match(text, /smallest change/);
});

test("mandatory items keep full fidelity under an adequate budget", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c1", description: "no PII in prompts", enforceable: true }],
      authority: [{ scope: "src/context", actions: ["edit", "write"], expiresAt: "2026-09-01T00:00:00.000Z" }],
      questions: [{ id: "q-open", question: "Which store?", options: ["jsonl", "sqlite"] }]
    }),
    index: index({ validationRoutes: ["typecheck"] }),
    tokenBudget: 4000,
    selectorVersion: 1,
    dependencyOutputs: ["coverage/summary.json"]
  });
  const joined = packet.requiredFacts.join("\n");
  // constraint
  assert.ok(joined.includes("no PII in prompts"));
  // authority grant keeps actions and expiry, not just the scope
  assert.ok(
    packet.requiredFacts.some((fact) => fact.includes("src/context") && fact.includes("edit") && fact.includes("write")),
    `authority grant lost actions: ${joined}`
  );
  assert.ok(packet.requiredFacts.some((fact) => fact.includes("2026-09-01")));
  // unresolved question keeps its options so downstream can decide
  assert.ok(
    packet.requiredFacts.some((fact) => fact.includes("Which store?") && fact.includes("jsonl") && fact.includes("sqlite")),
    `question lost options: ${joined}`
  );
  // validation route and dependency output
  assert.ok(joined.includes("typecheck"));
  assert.ok(joined.includes("coverage/summary.json"));
});

test("queryPacketGrounding answers fixture questions from the packet alone", () => {
  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: contract({
      constraints: [{ id: "c-store", description: "store choice must be jsonl until decided", enforceable: true }],
      questions: [{ id: "q-open", question: "Which store?", options: ["jsonl", "sqlite"] }]
    }),
    index: index({
      validationRoutes: ["pnpm test"],
      risks: ["pending payments migration"]
    }),
    tokenBudget: 4000,
    selectorVersion: 1,
    dependencyOutputs: ["coverage/summary.json"]
  });
  const routeAnswer = queryPacketGrounding(packet, "which validation route should I run?");
  assert.ok(routeAnswer.some((line) => line.includes("pnpm test")), `${routeAnswer.join("|")}`);
  const depAnswer = queryPacketGrounding(packet, "what did the dependency produce?");
  assert.ok(depAnswer.some((line) => line.includes("coverage/summary.json")), `${depAnswer.join("|")}`);
  const riskAnswer = queryPacketGrounding(packet, "any migration risk to know about?");
  assert.ok(riskAnswer.some((line) => line.includes("pending payments migration")), `${riskAnswer.join("|")}`);
  const storeAnswer = queryPacketGrounding(packet, "which store option is still open?");
  assert.ok(storeAnswer.some((line) => line.includes("jsonl")), `${storeAnswer.join("|")}`);
});

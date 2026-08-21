import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjectContextIndex,
  createEmptyContext,
  type ProjectContextIndex
} from "../../../src/context/index.js";
import { compileContextPacket } from "../../../src/context/packet.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { RequirementContract } from "../../../src/domain/contract.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const NOW = parseIsoTimestamp("2026-08-12T09:00:00.000Z");

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: createProjectId(UUID),
    rootPath: "/tmp/demo",
    discoveredAt: NOW,
    instructionFiles: [],
    manifests: [],
    commands: [],
    facts: [],
    ...overrides
  };
}

function emptyContract(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "demo",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
}

test("nested instruction files are ordered closer-to-root first", () => {
  const index = buildProjectContextIndex(
    snapshot({
      instructionFiles: [
        { path: "/tmp/demo/packages/nested/AGENTS.md" },
        { path: "/tmp/demo/AGENTS.md" },
        { path: "/tmp/demo/packages/AGENTS.md" }
      ]
    })
  );
  assert.deepEqual(index.instructionPrecedence, [
    "/tmp/demo/AGENTS.md",
    "/tmp/demo/packages/AGENTS.md",
    "/tmp/demo/packages/nested/AGENTS.md"
  ]);
  assert.equal(index.schemaVersion, 1);
});

test("stale source hash invalidates the affected fact", () => {
  const frozen = snapshot({
    instructionFiles: [{ path: "/tmp/demo/AGENTS.md" }]
  });
  const stale = buildProjectContextIndex(frozen, {
    sourceHashes: { "/tmp/demo/AGENTS.md": "hash-new" },
    priorHashes: { "/tmp/demo/AGENTS.md": "hash-old" }
  });
  const fact = stale.facts.find((entry) => entry.value === "/tmp/demo/AGENTS.md");
  assert.equal(fact?.freshness, "stale");
  assert.equal(fact?.sourceHash, "hash-new");
  assert.equal(fact?.trust, "HIGH");

  const fresh = buildProjectContextIndex(frozen, {
    sourceHashes: { "/tmp/demo/AGENTS.md": "hash-same" },
    priorHashes: { "/tmp/demo/AGENTS.md": "hash-same" }
  });
  const freshFact = fresh.facts.find((entry) => entry.value === "/tmp/demo/AGENTS.md");
  assert.equal(freshFact?.freshness, "fresh");
});

test("missing test route stays unavailable when no commands are named test", () => {
  const index = buildProjectContextIndex(
    snapshot({
      commands: [{ name: "lint", command: "eslint ." }]
    })
  );
  assert.deepEqual(index.validationRoutes, ["lint"]);
  const testRoute = index.facts.find((fact) => fact.key === "validation.route:test");
  assert.equal(testRoute?.trust, "unavailable");
  assert.equal(testRoute?.freshness, "unavailable");
  assert.deepEqual(index.tests, []);
});

test("unrelated dirty changes are listed but not required packet facts", () => {
  const index = buildProjectContextIndex(
    snapshot({
      commands: [{ name: "build", command: "tsc -b" }],
      instructionFiles: [{ path: "/tmp/demo/AGENTS.md" }]
    }),
    {
      dirtyPaths: ["src/unrelated.ts", "dist/generated.js"],
      generatedPaths: ["dist"]
    }
  );
  assert.deepEqual(index.dirtyUnrelated, ["src/unrelated.ts"]);
  assert.ok(!index.dirtyUnrelated.includes("dist/generated.js"));

  const packet = compileContextPacket({
    taskId: createTaskId(UUID),
    contract: emptyContract(),
    index,
    tokenBudget: 4000,
    selectorVersion: 1
  });
  assert.ok(!packet.requiredFacts.some((fact) => fact.includes("src/unrelated.ts")));
  assert.ok(!packet.relevantFiles.includes("src/unrelated.ts"));
  assert.ok(packet.omissions.some((omission) => omission.reason === "unrelated-dirty"));
});

test("generated files are recorded separately from unrelated dirty paths", () => {
  const index = buildProjectContextIndex(snapshot(), {
    generatedPaths: ["coverage/lcov.info", "dist"],
    dirtyPaths: ["README.md"]
  });
  assert.deepEqual(index.generatedHints, ["coverage/lcov.info", "dist"]);
  assert.deepEqual(index.dirtyUnrelated, ["README.md"]);
  assert.ok(!index.generatedHints.includes("README.md"));
});

test("ranks public interfaces and preserves call structure in the code map", () => {
  const index = buildProjectContextIndex(snapshot(), {
    codeMap: [
      {
        path: "src/internal.ts",
        symbol: "helper",
        kind: "function",
        public: false,
        calls: ["parseInput"]
      },
      {
        path: "src/api.ts",
        symbol: "TaskRunner",
        kind: "interface",
        public: true,
        calls: ["run", "cancel"]
      }
    ],
    codeMapTokenBudget: 100
  });

  assert.deepEqual(index.codeMap.entries, [
    {
      path: "src/api.ts",
      symbol: "TaskRunner",
      kind: "interface",
      public: true,
      calls: ["cancel", "run"]
    },
    {
      path: "src/internal.ts",
      symbol: "helper",
      kind: "function",
      public: false,
      calls: ["parseInput"]
    }
  ]);
  assert.equal(index.codeMap.omissions.length, 0);
  assert.ok(index.codeMap.estimatedTokens > 0);
});

test("code-map ranking uses its own token budget and records deterministic omissions", () => {
  const options = {
    codeMap: [
      {
        path: "src/api.ts",
        symbol: "TaskRunner",
        kind: "interface" as const,
        public: true,
        calls: ["run", "cancel"]
      },
      {
        path: "src/internal.ts",
        symbol: "helper",
        kind: "function" as const,
        public: false,
        calls: ["parseInput"]
      }
    ],
    codeMapTokenBudget: 8
  };
  const first = buildProjectContextIndex(snapshot(), options);
  const second = buildProjectContextIndex(snapshot(), options);

  assert.deepEqual(first, second);
  assert.equal(first.codeMap.entries.length, 0);
  assert.deepEqual(first.codeMap.omissions.map((item) => item.symbol), ["TaskRunner", "helper"]);
  assert.ok(first.codeMap.omissions.every((item) => item.reason === "token-budget"));
});

test("building twice from the same snapshot and options is deep-equal", () => {
  const frozen = snapshot({
    instructionFiles: [{ path: "/tmp/demo/AGENTS.md" }],
    manifests: [{ path: "/tmp/demo/package.json" }],
    commands: [{ name: "lint", command: "eslint ." }],
    facts: [{ key: "package_manager", value: "pnpm", confidence: "HIGH" }]
  });
  const options = {
    dirtyPaths: ["src/a.ts"],
    generatedPaths: ["dist"],
    sourceHashes: { "/tmp/demo/AGENTS.md": "abc", "/tmp/demo/package.json": "def" },
    now: NOW
  };
  const first = buildProjectContextIndex(frozen, options);
  const second = buildProjectContextIndex(frozen, options);
  assert.deepEqual(first, second);
});

test("createEmptyContext fills additive fields for compatibility", () => {
  const empty = createEmptyContext(createProjectId(UUID), NOW);
  const expected: ProjectContextIndex = {
    projectId: empty.projectId,
    lastUpdated: NOW,
    manifests: {},
    architecture: [],
    tests: [],
    risks: [],
    priorEpisodes: [],
    schemaVersion: 1,
    facts: [],
    instructionPrecedence: [],
    validationRoutes: [],
    generatedHints: [],
    dirtyUnrelated: [],
    codeMap: {
      schemaVersion: 1,
      tokenBudget: 2000,
      estimatedTokens: 0,
      entries: [],
      omissions: []
    }
  };
  assert.deepEqual(empty, expected);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjectContextIndex,
  refreshProjectContextIndex,
  type ProjectContextIndex
} from "../../../src/context/index.js";
import { validateProjectSnapshot, type ProjectSnapshot } from "../../../src/domain/project.js";
import { createEpisodeId, createProjectId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function frozenProjectInput(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return Object.freeze(
    validateProjectSnapshot({
      id: createProjectId(UUID),
      rootPath: "/fixtures/demo-project",
      discoveredAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
      instructionFiles: [
        { path: "/fixtures/demo-project/AGENTS.md" },
        { path: "/fixtures/demo-project/packages/pay/AGENTS.md" }
      ],
      manifests: [{ path: "/fixtures/demo-project/package.json" }],
      commands: [
        { name: "test", command: "pnpm test" },
        { name: "lint", command: "pnpm lint" }
      ],
      facts: [
        {
          key: "architecture.boundary",
          value: "packages/pay must not import packages/web",
          confidence: "HIGH"
        },
        {
          key: "risk.migration",
          value: "pending payments table migration",
          confidence: "MEDIUM"
        }
      ],
      ...overrides
    })
  ) as ProjectSnapshot;
}

test("index built from a frozen project input records ownership, boundaries, risks, and routes", () => {
  const index = buildProjectContextIndex(frozenProjectInput(), {
    now: parseIsoTimestamp("2026-08-21T08:00:00.000Z")
  });
  assert.deepEqual(
    index.instructionOwnership.map((entry) => [entry.owner, entry.scope, entry.precedence]),
    [
      ["root", ".", 1],
      ["nested", "packages/pay", 2]
    ]
  );
  assert.deepEqual(index.architecture, ["packages/pay must not import packages/web"]);
  assert.deepEqual(index.risks, ["pending payments table migration"]);
  assert.deepEqual(index.validationRoutes, ["test", "lint"]);
  assert.deepEqual(index.tests, ["pnpm test"]);
});

test("refreshing against a changed frozen input is deterministic and incremental", () => {
  const prior = buildProjectContextIndex(frozenProjectInput(), {
    now: parseIsoTimestamp("2026-08-21T08:00:00.000Z")
  });
  const withEpisode: ProjectContextIndex = {
    ...prior,
    priorEpisodes: [createEpisodeId(UUID)]
  };
  const changed = frozenProjectInput({
    discoveredAt: parseIsoTimestamp("2026-08-21T09:00:00.000Z"),
    facts: [
      {
        key: "architecture.boundary",
        value: "packages/pay must not import packages/web",
        confidence: "HIGH"
      },
      {
        key: "risk.migration",
        value: "migration landed and verified",
        confidence: "HIGH"
      }
    ]
  });
  const first = refreshProjectContextIndex(withEpisode, changed, {
    now: parseIsoTimestamp("2026-08-21T09:00:00.000Z")
  });
  const second = refreshProjectContextIndex(withEpisode, changed, {
    now: parseIsoTimestamp("2026-08-21T09:00:00.000Z")
  });
  assert.deepEqual(first, second);

  const staleRisk = first.facts.find((entry) => entry.key === "risk.migration");
  const freshBoundary = first.facts.find((entry) => entry.key === "architecture.boundary");
  assert.equal(staleRisk?.freshness, "stale");
  assert.equal(freshBoundary?.freshness, "fresh");
  assert.deepEqual(first.risks, ["migration landed and verified"]);
  assert.deepEqual(first.priorEpisodes, withEpisode.priorEpisodes);
});

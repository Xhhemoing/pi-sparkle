import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { parsePublicPriorSnapshot } from "../../../src/routing/public-prior.js";
import { parseTaskId } from "../../../src/domain/ids.js";

test("a user-selected primary plus fast catalog assigns cheap work to fast and hard work to primary", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const assignments = assignTasks({
    catalog,
    tasks: [
      { taskId: parseTaskId("tsk_scout"), role: "scout", objective: "Survey the repo" },
      {
        taskId: parseTaskId("tsk_impl"),
        role: "implementer",
        objective: "Deploy the checkout flow to production with credential rotation"
      }
    ]
  });
  assert.equal(assignments[0]?.decision.model, "cheap");
  assert.equal(assignments[1]?.decision.model, "premium");
  assert.equal(assignments[1]?.analysis.preferPrimary, true);
});

test("a public prior prefers the cheaper model once both clear the quality bar", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const ts = "2026-08-19T00:00:00.000Z";
  const assignments = assignTasks({
    catalog,
    prior: parsePublicPriorSnapshot({
      schemaVersion: 1,
      snapshotId: "pps_assign",
      createdAt: ts,
      qualityBar: 0,
      scores: [
        {
          sourceId: "aider-polyglot",
          modelAliases: ["cheap"],
          raw: 0.8,
          unit: "pass_rate",
          fetchedAt: ts,
          sourceUrl: "https://aider.chat/docs/leaderboards/"
        },
        {
          sourceId: "aider-polyglot",
          modelAliases: ["premium"],
          raw: 0.9,
          unit: "pass_rate",
          fetchedAt: ts,
          sourceUrl: "https://aider.chat/docs/leaderboards/"
        }
      ]
    }),
    tasks: [{ taskId: parseTaskId("tsk_edit"), role: "implementer", objective: "Implement the cache layer" }]
  });
  assert.equal(assignments[0]?.analysis.family, "edit");
  assert.equal(assignments[0]?.preferredModel, "cheap");
});

test("a public prior does not override high-risk prefer-primary", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const ts = "2026-08-19T00:00:00.000Z";
  const assignments = assignTasks({
    catalog,
    prior: parsePublicPriorSnapshot({
      schemaVersion: 1,
      snapshotId: "pps_assign_risk",
      createdAt: ts,
      qualityBar: 0,
      scores: [
        {
          sourceId: "aider-polyglot",
          modelAliases: ["cheap"],
          raw: 0.99,
          unit: "pass_rate",
          fetchedAt: ts,
          sourceUrl: "https://aider.chat/docs/leaderboards/"
        },
        {
          sourceId: "aider-polyglot",
          modelAliases: ["premium"],
          raw: 0.1,
          unit: "pass_rate",
          fetchedAt: ts,
          sourceUrl: "https://aider.chat/docs/leaderboards/"
        }
      ]
    }),
    tasks: [
      {
        taskId: parseTaskId("tsk_prod"),
        role: "implementer",
        objective: "Deploy the checkout flow to production with credential rotation"
      }
    ]
  });
  assert.equal(assignments[0]?.analysis.preferPrimary, true);
  assert.equal(assignments[0]?.preferredModel, "premium");
});

test("a single primary catalog routes every task to that model", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "gpt-x", fastModelId: "gpt-x" });
  assert.equal(catalog.models.length, 1);
  const assignments = assignTasks({
    catalog,
    tasks: [{ taskId: parseTaskId("tsk_work"), role: "worker", objective: "Fix the typo in README" }]
  });
  assert.equal(assignments[0]?.decision.model, "gpt-x");
});

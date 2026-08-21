import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createTaskId } from "../../../src/domain/ids.js";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { startParentRun } from "../../../src/run/coordinator.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function uncoveredContract(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Ship the parser",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "acc-mandatory", description: "parser works", observableCheck: "tests pass" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: [{ kind: "message", ref: "cli-objective", excerpt: "Ship the parser" }]
  };
}

test("parent run refuses to start when the contract is uncovered", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cov-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cov-proj-"));
  try {
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const child: ChildTaskInput = {
      taskId: createTaskId(() => "impl"),
      role: "implementer",
      objective: "Implement without covering acc-mandatory",
      profile: registry.resolve("implementer"),
      inputArtifactIds: [],
      acceptanceCriteria: [{ id: "other", description: "unrelated" }],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 60_000 }
    };
    assert.throws(
      () =>
        startParentRun(
          { stateRoot, executor: new ProtocolChildExecutor() },
          { projectRoot, objective: "Ship the parser", children: [child], contract: uncoveredContract() }
        ),
      (error: unknown) =>
        error instanceof DomainValidationError && /coverage gate blocked start/i.test(error.message)
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import type { AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";
import { startSupervisedRun } from "../../../src/run/supervisor.js";

const EMPTY_GRAPH_ERROR = "Task graph must contain at least one task";

test("empty task graphs are rejected by graph validation", () => {
  assert.throws(
    () => validateTaskGraph([]),
    (error: unknown) => error instanceof DomainValidationError && error.message === EMPTY_GRAPH_ERROR
  );
});

test("supervised pre-flight rejects an empty graph without persisting", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-empty-graph-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-empty-graph-project-"));
  let executed = false;
  const executor: AgentExecutor = {
    async *execute(): AsyncIterable<ExecutionEvent> {
      executed = true;
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
    }
  };

  try {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor,
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      { projectRoot, objective: "Ship it", tasks: [] }
    );

    await assert.rejects(
      () => running.done,
      (error: unknown) => error instanceof DomainValidationError && error.message === EMPTY_GRAPH_ERROR
    );
    assert.equal(executed, false, "validation refuses before any worker starts");
    assert.deepEqual(
      await readdir(stateRoot),
      [],
      "pre-flight refusal must not mint run or episode records"
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

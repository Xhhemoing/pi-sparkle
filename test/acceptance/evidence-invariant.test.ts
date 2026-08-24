import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startRun } from "../../src/run/coordinator.js";
import { EpisodeStore } from "../../src/run/episode-store.js";
import { FakeExecutor } from "../../src/testing/fake-executor.js";

test("a fake-executor run cannot close COMPLETED without terminal-status evidence", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-evidence-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-evidence-project-"));
  try {
    const running = startRun(
      {
        stateRoot,
        executor: new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }])
      },
      { projectRoot, objective: "Exercise the deterministic fake path" }
    );
    const outcome = await running.done;

    assert.equal(outcome.status, "COMPLETED");
    const attachment = outcome.events.find((event) => event.type === "RUN_ATTACHED");
    assert.ok(attachment, "a completed run must retain its episode attachment");

    const snapshots = await new EpisodeStore(stateRoot, attachment.payload.episodeId).readAll();
    const terminal = snapshots.episodes.at(-1);
    assert.equal(terminal?.status, "COMPLETED");
    // outcomeId mirrors terminal run status here; this is not Outcome-supported evidence.
    assert.equal(terminal?.outcomeId, "COMPLETED");
    assert.ok(
      (terminal?.evidenceRefs.length ?? 0) >= 1,
      "the durable COMPLETED terminal record must carry at least one evidence reference"
    );

    const statusEvidence = terminal?.acceptanceEvidence?.find(
      (entry) => entry.criterionId === "run-complete" && entry.result === "PASSED"
    );
    assert.ok(statusEvidence, "COMPLETED must be supported by run-complete acceptance evidence");
    assert.ok(terminal.evidenceRefs.includes(statusEvidence.evidenceId));
    assert.equal(statusEvidence.sourceRef, `run-status:${outcome.runId}:COMPLETED`);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

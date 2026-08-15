import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { attachRun, openEpisode } from "../../../src/episode/manager.js";

test("attachRun rejects a run from another project", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  const foreign = createProjectId();
  assert.notEqual(opened.episode.projectId, foreign);
  assert.throws(
    () => attachRun(opened.episode, createRunId(), foreign),
    /another project|foreign/i
  );
});

test("attachRun accepts a run from the same project", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  const runId = createRunId();
  const next = attachRun(opened.episode, runId, opened.episode.projectId);
  assert.deepEqual(next.episode.runIds, [runId]);
});

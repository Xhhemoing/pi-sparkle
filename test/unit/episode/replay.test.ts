import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { attachRun, openEpisode, reduceEpisodeEvents } from "../../../src/episode/manager.js";
import { replayFromLog } from "../../../src/episode/replay.js";

test("replayFromLog recovers a truncated final JSONL line", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  const attached = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const complete = JSON.stringify(opened.event);
  const result = replayFromLog([complete, '{"type":"RUN_ATTACH']);
  assert.equal(result.recovered, true);
  assert.equal(result.incompleteLine, '{"type":"RUN_ATTACH');
  assert.equal(result.state.episode?.id, opened.episode.id);
  assert.deepEqual(result.state.episode?.runIds, []);
  assert.deepEqual(reduceEpisodeEvents([opened.event]), result.state);
  assert.notEqual(attached.episode.runIds.length, 0);
});

test("replayFromLog fails closed on a corrupt mid-file line", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  assert.throws(
    () => replayFromLog(["NOT JSON", JSON.stringify(opened.event)]),
    /line 1/
  );
});

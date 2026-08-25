import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { attachRun, closeEpisode, openEpisode, waitForUser } from "../../../src/episode/manager.js";
import { validateEpisodeEvent } from "../../../src/episode/events.js";

function fixtures() {
  const episodeId = createEpisodeId();
  const opened = openEpisode({
    id: episodeId,
    projectId: createProjectId(),
    objective: "validate episode events",
    contractVersion: 1,
    acceptance: [{ id: "acc-1", description: "events validate", observableCheck: "pnpm test" }]
  });
  const attached = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const waiting = waitForUser(attached.episode, "acceptance-incomplete", ["acc-1"]);
  const closed = closeEpisode(waiting.episode, "COMPLETED", "out-1");
  return { opened, attached, waiting, closed };
}

test("validateEpisodeEvent accepts the four known shapes unchanged", () => {
  const { opened, attached, waiting, closed } = fixtures();
  for (const event of [opened.event, attached.event, waiting.event, closed.event]) {
    const decoded = validateEpisodeEvent(JSON.parse(JSON.stringify(event)) as unknown);
    assert.equal(JSON.stringify(decoded), JSON.stringify(event));
  }
});

test("validateEpisodeEvent accepts EPISODE_CLOSED without an outcomeId", () => {
  const { waiting } = fixtures();
  const closed = closeEpisode(waiting.episode, "ABANDONED");
  const decoded = validateEpisodeEvent(JSON.parse(JSON.stringify(closed.event)) as unknown);
  assert.equal(JSON.stringify(decoded), JSON.stringify(closed.event));
  assert.equal("outcomeId" in decoded, false);
});

test("validateEpisodeEvent rejects an unknown type", () => {
  const { attached } = fixtures();
  assert.throws(
    () => validateEpisodeEvent({ ...attached.event, type: "EPISODE_REOPENED" }),
    (error: unknown) =>
      error instanceof DomainValidationError && /Unknown EpisodeEvent\.type: EPISODE_REOPENED/.test(error.message)
  );
});

test("validateEpisodeEvent rejects non-objects and a missing type", () => {
  for (const value of [null, 42, "EPISODE_OPENED", ["EPISODE_OPENED"]]) {
    assert.throws(() => validateEpisodeEvent(value), DomainValidationError);
  }
  assert.throws(() => validateEpisodeEvent({ episodeId: createEpisodeId() }), DomainValidationError);
});

test("validateEpisodeEvent rejects malformed required fields on every shape", () => {
  const { opened, attached, waiting, closed } = fixtures();
  const cases: Array<[string, unknown]> = [
    ["opened without an episode", { ...opened.event, episode: undefined }],
    ["opened with a malformed episode", { ...opened.event, episode: { ...opened.event.episode, id: "nope" } }],
    ["opened with a bad occurredAt", { ...opened.event, occurredAt: "yesterday" }],
    ["attached with a bad episodeId", { ...attached.event, episodeId: "ep" }],
    ["attached with a bad runId", { ...attached.event, runId: "prj_1" }],
    ["attached with a bad attachedAt", { ...attached.event, attachedAt: 0 }],
    ["waiting with an empty reason", { ...waiting.event, reason: "  " }],
    ["waiting with non-array evidence", { ...waiting.event, requiredEvidence: "acc-1" }],
    ["waiting with non-string evidence", { ...waiting.event, requiredEvidence: ["acc-1", 7] }],
    ["closed with an unknown status", { ...closed.event, status: "DONE" }],
    ["closed with a bad closedAt", { ...closed.event, closedAt: "2026-13-45" }],
    ["closed with a non-string outcomeId", { ...closed.event, outcomeId: 7 }]
  ];
  for (const [label, value] of cases) {
    assert.throws(() => validateEpisodeEvent(value), DomainValidationError, label);
  }
});

test("validateEpisodeEvent keeps the shapes exact: unknown keys are dropped, prototypes untouched", () => {
  const { attached } = fixtures();
  const row = JSON.stringify(attached.event).replace(
    /^\{/,
    '{"extra":"ignored","__proto__":{"polluted":true},'
  );
  const decoded = validateEpisodeEvent(JSON.parse(row) as unknown);
  assert.deepEqual(Object.keys(decoded), ["type", "episodeId", "runId", "attachedAt"]);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  assert.equal((decoded as unknown as Record<string, unknown>).polluted, undefined);
});

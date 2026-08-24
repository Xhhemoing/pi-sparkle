import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Census pin: replay.ts had no production caller and duplicated the validated
 * EpisodeEventStore.readAll path. The store suite pins truncation recovery and
 * validation; a second replay module needs a live caller before it can return.
 */
test("episode replay has no duplicate, unvalidated module", () => {
  const replayPath = fileURLToPath(
    new URL("../../../src/episode/replay.ts", import.meta.url)
  );
  assert.equal(
    existsSync(replayPath),
    false,
    "episode replay belongs in EpisodeEventStore.readAll; a duplicate module needs a live caller"
  );
});

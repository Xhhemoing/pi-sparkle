import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearAll,
  configurePreferencePersistence,
  deletePreference,
  inspectPreferences,
  isDeleted,
  recordExplicitPreference,
} from "../../../src/preferences/service.js";
import { materializeView } from "../../../src/preferences/materialize.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

describe("M4-T5: deleted preference is absent after restart/replay", () => {
  it("a deleted preference stays absent after clearAll and reload from disk", async () => {
    const file = join(tmpdir(), `pi-sparkle-pref-replay-${randomUUID()}.json`);
    const episodeId = createEpisodeId();
    try {
      configurePreferencePersistence(file);
      const obs = recordExplicitPreference("user", "u1", "format", "compact", episodeId);
      assert.equal(deletePreference(obs.id), true);
      assert.equal(isDeleted(obs.id), true);

      clearAll();
      assert.equal(isDeleted(obs.id), false);
      assert.equal(inspectPreferences().count, 0);

      configurePreferencePersistence(file);
      assert.equal(isDeleted(obs.id), true);
      assert.ok(!inspectPreferences().observations.some((row) => row.id === obs.id));
      assert.equal(inspectPreferences().count, 0);
      const view = materializeView("user", "u1");
      assert.ok(!("format" in view.effectiveKeys));
    } finally {
      configurePreferencePersistence(undefined);
      clearAll();
      if (existsSync(file)) {
        await rm(file, { force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
      }
    }
  });
});

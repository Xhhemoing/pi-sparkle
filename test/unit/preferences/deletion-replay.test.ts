import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearAll,
  configurePreferencePersistence,
  correctPreference,
  deletePreference,
  inspectPreferences,
  isDeleted,
  recordExplicitPreference,
  recordInferredPreference,
} from "../../../src/preferences/service.js";
import {
  MIN_INFERRED_RECURRENCE_DEFAULT,
  configureMinInferredRecurrence,
  findConflicts,
  getObservationsByKey,
  recordObservation,
} from "../../../src/preferences/store.js";
import { materializeView } from "../../../src/preferences/materialize.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

beforeEach(() => {
  configurePreferencePersistence(undefined);
  clearAll();
  configureMinInferredRecurrence(MIN_INFERRED_RECURRENCE_DEFAULT);
});

afterEach(() => {
  configurePreferencePersistence(undefined);
  clearAll();
  configureMinInferredRecurrence(MIN_INFERRED_RECURRENCE_DEFAULT);
});

async function withSnapshot(run: (file: string) => Promise<void>): Promise<void> {
  const file = join(tmpdir(), `pi-sparkle-pref-replay-${randomUUID()}.json`);
  try {
    await run(file);
  } finally {
    configurePreferencePersistence(undefined);
    clearAll();
    await rm(file, { force: true, maxRetries: 10, retryDelay: 50 });
  }
}

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

  it("ignores repeated ingestion of a deleted ID before and after reload without writing", async () => {
    await withSnapshot(async (file) => {
      configurePreferencePersistence(file);
      const deleted = recordExplicitPreference("user", "u1", "format", "compact", createEpisodeId());
      assert.equal(deletePreference(deleted.id), true);
      const deletedBytes = await readFile(file, "utf8");

      for (const reload of [false, true]) {
        if (reload) {
          clearAll();
          configurePreferencePersistence(file);
        }
        recordObservation(deleted);
        recordObservation(deleted);
        assert.equal(isDeleted(deleted.id), true);
        assert.equal(inspectPreferences().count, 0);
        assert.deepEqual(getObservationsByKey("user", "u1"), []);
        assert.deepEqual(findConflicts("user", "u1"), []);
        assert.deepEqual(materializeView("user", "u1").effectiveKeys, {});
        assert.equal(await readFile(file, "utf8"), deletedBytes);
      }
    });
  });

  it("deletes every historical row sharing an ID, including conflicting duplicates", async () => {
    await withSnapshot(async (file) => {
      const deleted = recordExplicitPreference("user", "u1", "format", "compact", createEpisodeId());
      await writeFile(file, JSON.stringify({
        observations: [deleted, { ...deleted, value: "verbose" }, { ...deleted, scopeKey: "u2" }],
        tombstones: [],
      }), "utf8");
      clearAll();
      configurePreferencePersistence(file);
      assert.equal(inspectPreferences().count, 3);
      assert.equal(findConflicts("user", "u1").length, 1);

      assert.equal(deletePreference(deleted.id), true);
      assert.equal(inspectPreferences().count, 0);
      assert.deepEqual(findConflicts("user", "u1"), []);
      assert.deepEqual(materializeView("user", "u1").effectiveKeys, {});
      assert.deepEqual(materializeView("user", "u2").effectiveKeys, {});
      assert.equal(deletePreference(deleted.id), false);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
        observations: [], tombstones: [deleted.id],
      });
    });
  });

  it("filters stale tombstoned snapshot rows from history, conflicts and materialized confidence", async () => {
    await withSnapshot(async (file) => {
      const deleted = recordExplicitPreference("user", "u1", "format", "verbose", createEpisodeId());
      const kept = recordExplicitPreference("user", "u1", "format", "compact", createEpisodeId());
      const staleBytes = JSON.stringify({ observations: [deleted, kept], tombstones: [deleted.id] });
      await writeFile(file, staleBytes, "utf8");
      clearAll();
      configurePreferencePersistence(file);

      assert.deepEqual(inspectPreferences().observations.map((row) => row.id), [kept.id]);
      assert.deepEqual(getObservationsByKey("user", "u1").map((row) => row.id), [kept.id]);
      assert.deepEqual(findConflicts("user", "u1"), []);
      const view = materializeView("user", "u1");
      assert.deepEqual(view.effectiveKeys, { format: "compact" });
      assert.equal(view.view.sourceCount, 1);
      assert.equal(view.view.confidence, 0.2);
      assert.equal(isDeleted(deleted.id), true);
      assert.equal(await readFile(file, "utf8"), staleBytes);
    });
  });

  it("demotes inferred recurrence after deletion and restores it only with fresh evidence", () => {
    const first = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    const second = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    assert.equal(materializeView("user", "u1").effectiveKeys["format"], "compact");
    assert.equal(deletePreference(first.id), true);

    assert.deepEqual(inspectPreferences().observations.map((row) => [row.id, row.recurrenceCount]), [
      [second.id, 1],
    ]);
    assert.deepEqual(materializeView("user", "u1").effectiveKeys, {});
    assert.equal(materializeView("user", "u1").view.sourceCount, 0);
    recordObservation(first);
    assert.deepEqual(materializeView("user", "u1").effectiveKeys, {});

    const fresh = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    assert.notEqual(fresh.id, first.id);
    assert.equal(fresh.recurrenceCount, 2);
    assert.equal(materializeView("user", "u1").effectiveKeys["format"], "compact");
    assert.equal(materializeView("user", "u1").view.sourceCount, 1);
  });

  it("recomputes stored inferred recurrence after filtering a stale tombstoned snapshot row", async () => {
    await withSnapshot(async (file) => {
      const first = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
      const second = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
      assert.equal(second.recurrenceCount, 2);
      const staleBytes = JSON.stringify({ observations: [first, second], tombstones: [first.id] });
      await writeFile(file, staleBytes, "utf8");
      clearAll();
      configurePreferencePersistence(file);

      assert.deepEqual(inspectPreferences().observations.map((row) => [row.id, row.recurrenceCount]), [
        [second.id, 1],
      ]);
      assert.deepEqual(materializeView("user", "u1").effectiveKeys, {});
      assert.equal(materializeView("user", "u1").view.sourceCount, 0);
      recordObservation(first);
      assert.equal(await readFile(file, "utf8"), staleBytes);
      const fresh = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
      assert.equal(fresh.recurrenceCount, 2);
      assert.equal(materializeView("user", "u1").effectiveKeys["format"], "compact");
      clearAll();
      configurePreferencePersistence(file);
      assert.deepEqual(inspectPreferences().observations.map((row) => row.recurrenceCount), [1, 2]);
    });
  });

  it("keeps explicit and inferred recurrence separate in original surviving order", () => {
    const first = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    const anchor = recordExplicitPreference("user", "u1", "format", "verbose", createEpisodeId());
    const second = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    assert.equal(deletePreference(first.id), true);
    assert.deepEqual(inspectPreferences().observations.map((row) => [row.id, row.recurrenceCount]), [
      [anchor.id, 1], [second.id, 1],
    ]);
    const fresh = recordInferredPreference("user", "u1", "format", "compact", createEpisodeId());
    const correction = correctPreference("user", "u1", "format", "short", createEpisodeId());
    assert.equal(fresh.recurrenceCount, 2);
    assert.equal(correction.recurrenceCount, 2);
    assert.deepEqual(inspectPreferences().observations.map((row) => row.recurrenceCount), [1, 1, 2, 2]);
    assert.equal(materializeView("user", "u1").effectiveKeys["format"], "short");
  });

  it("accepts a fresh explicit correction after reload while retaining the original tombstone", async () => {
    await withSnapshot(async (file) => {
      configurePreferencePersistence(file);
      const deleted = recordExplicitPreference("user", "u1", "format", "compact", createEpisodeId());
      assert.equal(deletePreference(deleted.id), true);
      clearAll();
      configurePreferencePersistence(file);
      const correction = correctPreference("user", "u1", "format", "verbose", createEpisodeId());
      assert.notEqual(correction.id, deleted.id);
      clearAll();
      configurePreferencePersistence(file);

      assert.equal(isDeleted(deleted.id), true);
      assert.deepEqual(inspectPreferences().observations.map((row) => row.id), [correction.id]);
      assert.equal(materializeView("user", "u1").effectiveKeys["format"], "verbose");
    });
  });
});

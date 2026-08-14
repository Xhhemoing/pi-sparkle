import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearAll,
  correctPreference,
  deletePreference,
  inspectPreferences,
  isDeleted,
  recordExplicitPreference,
  recordInferredPreference,
} from "../../../src/preferences/service.js";
import {
  exportAuthorizedPreferences,
  exportForDataset,
} from "../../../src/preferences/export.js";
import { listObservations } from "../../../src/preferences/store.js";
import { getMaterializedView } from "../../../src/preferences/materialize.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const epA = createEpisodeId();
const epB = createEpisodeId();

beforeEach(() => {
  clearAll();
});

describe("M4-T5: preference inspect/correct/export/delete workflow", () => {
  it("inspect lists observations with scope filtering", () => {
    recordExplicitPreference("user", "u1", "format", "compact", epA);
    recordExplicitPreference("project", "proj-1", "ci", "strict", epA);

    assert.equal(inspectPreferences().count, 2);
    const projectOnly = inspectPreferences("project");
    assert.equal(projectOnly.count, 1);
    assert.equal(projectOnly.observations[0]?.scopeKey, "proj-1");
  });

  it("correction adds an explicit observation and recomputes the view without deleting history", () => {
    const learned = recordInferredPreference("user", "u1", "format", "verbose", epA);
    recordInferredPreference("user", "u1", "format", "verbose", epB);
    assert.equal(getMaterializedView("user", "u1")?.view.sourceCount, 1);

    const corrected = correctPreference("user", "u1", "format", "compact", epB);
    assert.equal(corrected.explicit, true);

    const history = listObservations("user");
    assert.equal(history.length, 3);
    assert.ok(history.some((o) => o.id === learned.id));

    const view = getMaterializedView("user", "u1");
    assert.equal(view?.effectiveKeys["format"], "compact");
  });

  it("export contains only authorized scopes", () => {
    recordExplicitPreference("user", "u1", "format", "compact", epA);
    recordExplicitPreference("project", "proj-1", "ci", "strict", epA);

    const userOnly = exportAuthorizedPreferences({ scopes: ["user"] });
    const parsed = JSON.parse(userOnly.data) as {
      count: number;
      observations: Array<{ scope: string }>;
    };
    assert.equal(parsed.count, 1);
    assert.ok(parsed.observations.every((o) => o.scope === "user"));
    assert.equal(userOnly.scopes.length, 1);

    const everything = exportAuthorizedPreferences();
    assert.equal(everything.count, 2);
  });

  it("dataset export strips the evidence episode id (non-sensitive provenance)", () => {
    recordExplicitPreference("user", "u1", "format", "compact", epA);
    const data = exportForDataset("user");
    const parsed = JSON.parse(data) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 1);
    assert.ok(!("evidenceEpisodeId" in (parsed[0] ?? {})));
    assert.equal(parsed[0]?.scopeKey, "u1");
  });

  it("delete creates a tombstone, removes the observation, and rebuilds the view", () => {
    const obs = recordExplicitPreference("user", "u1", "format", "compact", epA);
    assert.equal(getMaterializedView("user", "u1")?.effectiveKeys["format"], "compact");

    assert.equal(deletePreference(obs.id), true);
    assert.equal(isDeleted(obs.id), true);
    assert.ok(!listObservations().some((o) => o.id === obs.id));
    assert.equal(getMaterializedView("user", "u1")?.effectiveKeys["format"], undefined);

    const exported = JSON.parse(exportAuthorizedPreferences().data) as {
      observations: Array<{ id: string }>;
    };
    assert.ok(!exported.observations.some((o) => o.id === obs.id));

    // The tombstone itself is included only on explicit request.
    const withTombstones = JSON.parse(
      exportAuthorizedPreferences({ includeTombstones: true }).data
    ) as { tombstones?: string[] };
    assert.ok(withTombstones.tombstones?.includes(obs.id));
    const withoutTombstones = JSON.parse(exportAuthorizedPreferences().data) as {
      tombstones?: string[];
    };
    assert.equal(withoutTombstones.tombstones, undefined);

    // Deleting the same id again reports not found; the tombstone persists.
    assert.equal(deletePreference(obs.id), false);
    assert.equal(isDeleted(obs.id), true);
  });

  it("clearAll resets observations and tombstones", () => {
    const obs = recordExplicitPreference("user", "u1", "format", "compact", epA);
    deletePreference(obs.id);
    clearAll();
    assert.equal(inspectPreferences().count, 0);
    assert.equal(isDeleted(obs.id), false);
  });
});

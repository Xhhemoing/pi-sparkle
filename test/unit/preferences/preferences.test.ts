import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_INFERRED_RECURRENCE_DEFAULT,
  clearPreferences,
  configureMinInferredRecurrence,
  findConflicts,
  getObservationsByKey,
  getView,
  listObservations,
  recordPreference,
} from "../../../src/preferences/store.js";
import {
  compareScopePriority,
  explicitOverridesInferred,
  getScopePriority,
  selectHighestPriority,
} from "../../../src/preferences/precedence.js";
import { materializeView } from "../../../src/preferences/materialize.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const epA = createEpisodeId();
const epB = createEpisodeId();

beforeEach(() => {
  clearPreferences();
  configureMinInferredRecurrence(MIN_INFERRED_RECURRENCE_DEFAULT);
});

function explicit(
  scope: "user" | "project" | "task-family" | "role" | "model",
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId = epA
) {
  return recordPreference(scope, scopeKey, key, value, episodeId, 1.0, true);
}

function inferred(
  scope: "user" | "project" | "task-family" | "role" | "model",
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId = epA
) {
  return recordPreference(scope, scopeKey, key, value, episodeId, 0.5, false);
}

describe("M4-T4: scoped preference observations and materialized views", () => {
  it("explicit project and user-global observations remain separate scopes", () => {
    const user = explicit("user", "u1", "format", "compact");
    const project = explicit("project", "proj-1", "format", "verbose");

    assert.equal(listObservations().length, 2);
    assert.deepEqual(listObservations("user").map((o) => o.id), [user.id]);
    assert.deepEqual(listObservations("project").map((o) => o.id), [project.id]);
    assert.deepEqual(
      getObservationsByKey("project", "proj-1").map((o) => o.id),
      [project.id]
    );
  });

  it("scope precedence ranks user > project > task-family > role > model", () => {
    assert.ok(getScopePriority("user") > getScopePriority("project"));
    assert.ok(getScopePriority("project") > getScopePriority("task-family"));
    assert.ok(compareScopePriority("user", "model") > 0);
    const chosen = selectHighestPriority([
      explicit("model", "m", "k", "v"),
      explicit("role", "r", "k", "v"),
      explicit("project", "p", "k", "v"),
    ]);
    assert.equal(chosen?.scope, "project");
  });

  it("a current explicit instruction overrides inferred observations at the same key", () => {
    const ex = explicit("user", "u1", "format", "compact");
    const inf = inferred("user", "u1", "format", "verbose");
    const other = inferred("user", "u1", "length", "short");
    const remaining = explicitOverridesInferred([ex], [inf, other]);
    assert.deepEqual(remaining.map((o) => o.key), ["length"]);
  });

  it("one inferred occurrence cannot become durable; provenance is still preserved", () => {
    inferred("user", "u1", "format", "compact");
    const view = materializeView("user", "u1");
    assert.ok(!("format" in view.effectiveKeys));
    assert.equal(view.view.sourceCount, 0);
    // The observation itself remains in history with provenance.
    const history = listObservations("user");
    assert.equal(history.length, 1);
    assert.equal(history[0]?.evidenceEpisodeId, epA);
    assert.equal(history[0]?.recurrenceCount, 1);
  });

  it("two comparable inferred recurrences become durable with confidence", () => {
    inferred("user", "u1", "format", "compact", epA);
    const second = inferred("user", "u1", "format", "compact", epB);
    assert.equal(second.recurrenceCount, 2);

    const view = materializeView("user", "u1");
    assert.equal(view.effectiveKeys["format"], "compact");
    assert.equal(view.view.sourceCount, 1);
    assert.ok(view.view.confidence > 0);
  });

  it("recurrence threshold is configurable and defaults to two", () => {
    assert.equal(MIN_INFERRED_RECURRENCE_DEFAULT, 2);
    configureMinInferredRecurrence(3);
    inferred("user", "u1", "format", "compact", epA);
    inferred("user", "u1", "format", "compact", epB);
    assert.ok(!("format" in materializeView("user", "u1").effectiveKeys));
    inferred("user", "u1", "format", "compact", createEpisodeId());
    assert.equal(materializeView("user", "u1").effectiveKeys["format"], "compact");
    configureMinInferredRecurrence(2);
  });

  it("an explicit observation is durable immediately (no recurrence gate)", () => {
    explicit("user", "u1", "format", "compact");
    assert.equal(materializeView("user", "u1").effectiveKeys["format"], "compact");
  });

  it("conflicting inferred observations keep the explicit value and lower confidence, preserving history", () => {
    explicit("user", "u1", "format", "compact");
    const before = getView("user", "u1")?.confidence ?? 0;
    assert.ok(before > 0);

    inferred("user", "u1", "format", "verbose", epA);
    inferred("user", "u1", "format", "verbose", epB);

    const after = materializeView("user", "u1");
    assert.equal(after.effectiveKeys["format"], "compact");
    assert.ok(after.view.confidence < before);
    assert.equal(listObservations().length, 3);
  });

  it("an explicit correction overrides the learned value and raises confidence", () => {
    explicit("user", "u1", "format", "compact");
    const before = getView("user", "u1")?.confidence ?? 0;
    explicit("user", "u1", "format", "verbose");
    const after = materializeView("user", "u1");
    assert.equal(after.effectiveKeys["format"], "verbose");
    assert.ok(after.view.confidence > before);
  });

  it("numeric preferences merge by averaging comparable recurrences", () => {
    explicit("user", "u1", "max-tokens", 4000);
    inferred("user", "u1", "max-tokens", 2000, epA);
    inferred("user", "u1", "max-tokens", 2000, epB);
    assert.equal(materializeView("user", "u1").effectiveKeys["max-tokens"], 3000);
  });

  it("findConflicts reports conflicts with resolutions", () => {
    explicit("user", "u1", "format", "compact");
    const conflicts = findConflicts("user", "u1");
    assert.equal(conflicts.length, 0);

    const corrected = explicit("user", "u1", "format", "verbose");
    const afterCorrection = findConflicts("user", "u1");
    assert.equal(afterCorrection.length, 1);
    assert.equal(afterCorrection[0]?.key, "format");
    assert.equal(afterCorrection[0]?.incoming.id, corrected.id);
    assert.equal(afterCorrection[0]?.resolution, "override");
  });
});

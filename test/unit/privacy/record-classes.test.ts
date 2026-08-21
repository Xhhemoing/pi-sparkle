import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DURABLE_RECORD_CLASSES,
  durableRecordClassById
} from "../../../src/privacy/record-classes.js";

const REQUIRED_IDS = [
  "run-event",
  "run-checkpoint",
  "episode",
  "artifact-ref",
  "feedback",
  "preference",
  "preference-dataset",
  "model-invocation",
  "catalog-observed",
  "candidate",
  "experiment",
  "providers-config",
  "auth-credential"
] as const;

test("every durable record class has owner, retention, redaction, deletion, and migration", () => {
  const ids = DURABLE_RECORD_CLASSES.map((entry) => entry.id);
  assert.deepEqual([...ids].sort(), [...REQUIRED_IDS].sort());
  for (const entry of DURABLE_RECORD_CLASSES) {
    assert.ok(entry.owner.length > 0, entry.id);
    assert.ok(entry.path.length > 0, entry.id);
    assert.ok(entry.retention.length > 0, entry.id);
    assert.ok(entry.redaction.length > 0, entry.id);
    assert.ok(entry.deletion.length > 0, entry.id);
    assert.ok(Number.isInteger(entry.migrationVersion) && entry.migrationVersion >= 1, entry.id);
    assert.ok(entry.recovery.length > 0, entry.id);
  }
});

test("dataset export and credentials declare deletion propagation", () => {
  const dataset = durableRecordClassById("preference-dataset");
  assert.equal(dataset?.deletion, "exclude-from-export");
  const preference = durableRecordClassById("preference");
  assert.ok(preference?.deletionPropagatesTo.includes("preference-dataset"));
  const auth = durableRecordClassById("auth-credential");
  assert.ok(auth?.sensitiveFields.some((field) => field.includes("api_key")));
});

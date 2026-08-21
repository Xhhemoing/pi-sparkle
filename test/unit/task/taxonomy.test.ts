import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TAXONOMY_VERSION,
  recordedTaxonomyVersion,
  stampTaxonomyVersion,
  type TaskTaxonomyEntry
} from "../../../src/task/taxonomy.js";

function entry(overrides: Partial<TaskTaxonomyEntry> = {}): TaskTaxonomyEntry {
  return {
    taskId: "tsk_1",
    family: "edit",
    skills: ["typescript"],
    ...overrides
  };
}

test("stamping records the current taxonomy version without mutating the source entry", () => {
  const original = entry();
  const stamped = stampTaxonomyVersion(original);
  assert.equal(stamped.taxonomyVersion, TAXONOMY_VERSION);
  assert.equal(original.taxonomyVersion, undefined);
  assert.deepEqual({ ...original }, original);
});

test("an explicit version can be stamped for historical replays", () => {
  const stamped = stampTaxonomyVersion(entry(), 3);
  assert.equal(stamped.taxonomyVersion, 3);
});

test("recordedTaxonomyVersion never defaults: pre-versioning entries stay unwritten", () => {
  assert.equal(recordedTaxonomyVersion(entry()), undefined);
  assert.equal(recordedTaxonomyVersion(entry({ taxonomyVersion: 1 })), 1);
  assert.equal(recordedTaxonomyVersion(entry({ taxonomyVersion: 2 })), 2);
});

test("re-stamping an entry keeps its original record intact and yields a new object", () => {
  const historical = stampTaxonomyVersion(entry(), 1);
  const snapshot = JSON.stringify(historical);
  const restamped = stampTaxonomyVersion(historical, 2);
  assert.equal(JSON.parse(snapshot).taxonomyVersion, 1);
  assert.equal(historical.taxonomyVersion, 1);
  assert.equal(restamped.taxonomyVersion, 2);
  assert.notEqual(historical, restamped);
});

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
  "run-pause",
  "track-questions",
  "routing-eval-report",
  "learning-bandit",
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

test("completeness: every known durable state-root path is covered by a class", () => {
  // Paths below were collected by auditing every writeFile/appendFile call in
  // src/ against the state root (2026-08-22 P0 pre-review). If a new durable
  // path is added, extend this list AND the dictionary together.
  const knownPaths = [
    "runs/<runId>/events.jsonl", // run-event
    "runs/<runId>/checkpoint.json", // run-checkpoint
    "runs/<runId>/pause.json", // run-pause
    "runs/<runId>/track-questions.json", // track-questions
    "episodes/<episodeId>/events.jsonl", // episode
    "feedback/records.jsonl", // feedback
    "preferences.json", // preference
    "invocations.jsonl", // model-invocation
    "routing/catalog-observed.json", // catalog-observed
    "adaptation/registry.json", // candidate
    "adaptation/evals/<candidateId>.<cacheKey>.json", // routing-eval-report
    "learning/projects/<stableProjectKey>/bandit.json", // learning-bandit
    "providers.json", // providers-config
    "auth.json" // auth-credential
  ];
  const covered = new Set(DURABLE_RECORD_CLASSES.map((entry) => entry.path));
  for (const path of knownPaths) {
    assert.ok(covered.has(path), `durable path not covered by the dictionary: ${path}`);
  }
});

test("run-scoped siblings of sensitive events share their sensitivity class", () => {
  // pause.json stores user free-text reason; track-questions.json stores the
  // objective — the same fields the episode class marks sensitive. They must
  // not declare fewer protections than episode events.
  const episode = durableRecordClassById("episode");
  const pause = durableRecordClassById("run-pause");
  const questions = durableRecordClassById("track-questions");
  assert.ok(episode && pause && questions);
  assert.equal(pause?.retention, "run-scoped");
  assert.equal(questions?.retention, "run-scoped");
  assert.equal(pause?.deletion, "delete-files");
  assert.equal(questions?.deletion, "delete-files");
  assert.ok(questions?.sensitiveFields.some((f) => f.includes("objective")));
});

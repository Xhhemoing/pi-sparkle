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
  "learned-routing-policy",
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
    "runtime/runs/<runId>/events.jsonl", // run-event
    "runtime/runs/<runId>/checkpoint.json", // run-checkpoint
    "runtime/runs/<runId>/pause.json", // run-pause
    "runtime/runs/<runId>/track-questions.json", // track-questions
    "runtime/episodes/<episodeId>.jsonl", // episode (project-episode log)
    "adaptation/feedback/records.jsonl", // feedback
    "adaptation/feedback/tombstones.json", // feedback tombstones
    "adaptation/preferences.json", // preference
    "runtime/invocations.jsonl", // model-invocation
    "runtime/routing/catalog-observed.json", // catalog-observed
    "adaptation/registry.json", // candidate
    "adaptation/evals/<candidateId>.<cacheKey>.json", // routing-eval-report
    "adaptation/learning/projects/<stableProjectKey>/routing.json", // learned-routing-policy
    "adaptation/learning/projects/<stableProjectKey>/bandit.json", // learning-bandit
    "runtime/providers.json", // providers-config
    "runtime/auth.json" // auth-credential
  ];
  // A class path may list variant file shapes parenthetically (e.g. the
  // feedback log plus its tombstone sidecar); every listed shape counts as
  // covered.
  const covered = new Set<string>();
  for (const entry of DURABLE_RECORD_CLASSES) {
    const main = entry.path.replace(/ \([^)]*\)/g, "");
    covered.add(main);
    const dir = main.slice(0, main.lastIndexOf("/"));
    for (const m of entry.path.matchAll(/\(([^)]*)\)/g)) {
      const group = m[1] ?? "";
      for (const part of group.split(/\bor\b|,/)) {
        const candidate = part.trim().replace(/^\+\s*/, "");
        if (candidate === "") continue;
        covered.add(candidate.includes("/") ? candidate : `${dir}/${candidate}`);
      }
    }
  }
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

test("P0 Q1: every concrete path lives under its owner's plane directory", () => {
  const PLANE_BY_OWNER: Record<string, string> = { runtime: "runtime/", adaptation: "adaptation/" };
  const VIRTUAL_PATHS = new Set([
    "referenced from TASK_RESULT.artifactIds (not a blob store)",
    "in-memory / fixture plans (no live assignment store)",
    "derived export (exportForDataset / exportAuthorizedPreferences)"
  ]);
  for (const entry of DURABLE_RECORD_CLASSES) {
    if (VIRTUAL_PATHS.has(entry.path)) continue;
    const prefix = PLANE_BY_OWNER[entry.owner];
    assert.ok(prefix, `unknown owner: ${entry.owner}`);
    assert.ok(
      entry.path.startsWith(prefix),
      `${entry.id} (${entry.owner}) must live under ${prefix}, got ${entry.path}`
    );
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_TEXT_FEEDBACK_FIELDS } from "../../../src/privacy/deletion.js";
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
  "routing-eval-dataset",
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

test("deletionPropagatesTo only ever names a known record class", () => {
  const ids = new Set(DURABLE_RECORD_CLASSES.map((entry) => entry.id));
  for (const entry of DURABLE_RECORD_CLASSES) {
    for (const target of entry.deletionPropagatesTo) {
      assert.ok(ids.has(target), `${entry.id} propagates to unknown class ${target}`);
      assert.notEqual(target, entry.id, `${entry.id} must not propagate to itself`);
    }
  }
});

/**
 * `deletionPropagatesTo` is a claim about what the delete tooling does today,
 * so every entry is pinned here against the code that performs it. Widening a
 * declaration without widening the implementation (or the reverse) fails.
 */
const IMPLEMENTED_PROPAGATION: ReadonlyArray<{
  from: string;
  to: readonly string[];
  by: string;
}> = [
  {
    from: "run-event",
    to: ["run-checkpoint", "run-pause", "track-questions", "model-invocation"],
    by: "deleteRunRecords: rm -r runtime/runs/<runId>/ then filter-rewrite runtime/invocations.jsonl"
  },
  {
    from: "model-invocation",
    to: ["catalog-observed"],
    by: "deleteRunRecords: unlink the stale p50 snapshot once invocation rows were dropped"
  },
  {
    from: "episode",
    to: ["feedback"],
    by: "deleteEpisodeRecords -> cascadeFeedbackTombstones"
  },
  {
    from: "preference",
    to: ["preference-dataset"],
    by: "exportForDataset filters isTombstoned observations"
  }
];

test("every declared deletion propagation is one the tooling actually performs", () => {
  const declared = DURABLE_RECORD_CLASSES.filter((entry) => entry.deletionPropagatesTo.length > 0)
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(
    declared,
    IMPLEMENTED_PROPAGATION.map((entry) => entry.from).sort(),
    "a class declares propagation that is not pinned to an implementation"
  );
  for (const entry of IMPLEMENTED_PROPAGATION) {
    assert.deepEqual(
      [...(durableRecordClassById(entry.from)?.deletionPropagatesTo ?? [])].sort(),
      [...entry.to].sort(),
      entry.from
    );
    assert.ok(entry.by.length > 5, entry.from);
  }
});

test("run deletion does not claim to take the episode with it", () => {
  // Episodes outlive individual runs under multi-run attach, so
  // deleteRunRecords deliberately leaves the episode alone. The declaration
  // used to say otherwise; it must not drift back.
  const runEvent = durableRecordClassById("run-event");
  assert.ok(runEvent);
  assert.ok(!runEvent.deletionPropagatesTo.includes("episode"));
});

test("feedback marks every field the episode cascade strips as sensitive", () => {
  const feedback = durableRecordClassById("feedback");
  assert.ok(feedback);
  for (const field of FREE_TEXT_FEEDBACK_FIELDS) {
    assert.ok(
      feedback.sensitiveFields.includes(field),
      `${field} is stripped on delete but not declared sensitive`
    );
  }
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
    "adaptation/eval-datasets/<runId>/manifest.json", // routing-eval-dataset
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

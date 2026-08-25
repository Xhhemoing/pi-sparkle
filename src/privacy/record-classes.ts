export const RETENTION_POLICIES = [
  "run-scoped",
  "episode-scoped",
  "until-deleted",
  "until-rollback",
  "session-only"
] as const;

export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

export const DELETION_STRATEGIES = [
  "delete-files",
  "tombstone-ids",
  "redact-in-place",
  "exclude-from-export"
] as const;

export type DeletionStrategy = (typeof DELETION_STRATEGIES)[number];

/**
 * Durable record classes under the state root. This is the privacy/storage
 * dictionary for Developer Preview: owner, retention, redaction, deletion
 * propagation, and migration version. Independent review is still required
 * before any production claim.
 */
export interface DurableRecordClass {
  readonly id: string;
  readonly owner: string;
  readonly path: string;
  readonly retention: RetentionPolicy;
  readonly sensitiveFields: readonly string[];
  readonly redaction: string;
  readonly deletion: DeletionStrategy;
  /**
   * Other record classes that the delete tooling actually reaches today when
   * this class is deleted. This is a behavioral claim, not a roadmap: an entry
   * here must be backed by code in `src/privacy/deletion.ts` (or the class's
   * own store), and `record-classes.test.ts` pins the ones the deletion engine
   * implements. Intended-but-unimplemented propagation belongs in
   * `docs/data-dictionary.md`, not in this field.
   */
  readonly deletionPropagatesTo: readonly string[];
  readonly migrationVersion: number;
  readonly recovery: string;
}

export const DURABLE_RECORD_CLASSES: readonly DurableRecordClass[] = [
  {
    id: "run-event",
    owner: "runtime",
    path: "runtime/runs/<runId>/events.jsonl",
    retention: "run-scoped",
    sensitiveFields: ["prompt", "tool payloads", "model output text"],
    redaction: "event bodies are append-only; do not copy into optimization datasets",
    deletion: "delete-files",
    // deleteRunRecords removes the whole runtime/runs/<runId>/ subtree, drops
    // the run's rows from the shared invocation log, and removes the replay
    // dataset derived from the run at the default eval-datasets path (a
    // `--dir` export is outside that cascade and the exporter says so). It
    // does NOT propagate to episode: episodes outlive individual runs under
    // multi-run attach, so a run delete must not take the episode with it.
    deletionPropagatesTo: [
      "run-checkpoint",
      "run-pause",
      "track-questions",
      "model-invocation",
      "routing-eval-dataset"
    ],
    migrationVersion: 1,
    recovery: "truncated final JSONL line is ignored; a corrupt middle line fails closed"
  },
  {
    id: "run-checkpoint",
    owner: "runtime",
    path: "runtime/runs/<runId>/checkpoint.json",
    retention: "run-scoped",
    sensitiveFields: ["flowchart snapshot", "pending answers"],
    redaction: "checkpoint is operational state, not a learning corpus",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "refuse to invent flowchart state when the checkpoint is missing"
  },
  {
    id: "episode",
    owner: "runtime",
    path: "runtime/episodes/<episodeId>.jsonl",
    retention: "episode-scoped",
    sensitiveFields: ["objective", "acceptance text"],
    redaction: "export only ids, status, and evidence references",
    deletion: "delete-files",
    deletionPropagatesTo: ["feedback"],
    migrationVersion: 1,
    // Variant record shape sharing this class:
    // runtime/episodes/<id>.events.jsonl (event log). delete --episode unlinks
    // both record shapes while holding runtime/episodes/<id>.lock; it does not
    // unlink or report that operational sidecar as an episode record. Normal
    // owned lock release removes it.
    recovery: "duplicate open/attach/terminal must fail closed on the reducer"
  },
  {
    id: "artifact-ref",
    owner: "runtime",
    path: "referenced from TASK_RESULT.artifactIds (not a blob store)",
    retention: "run-scoped",
    sensitiveFields: ["artifact contents in the project workspace"],
    redaction: "persist ids only; workspace files stay in the project",
    deletion: "exclude-from-export",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "missing artifact ids stay inspectable as dangling references"
  },
  {
    id: "feedback",
    owner: "adaptation",
    path: "adaptation/feedback/records.jsonl (+ tombstones.json)",
    retention: "until-deleted",
    // summary is derived user text (learning/signals.ts truncates user
    // answers, peer bodies, and subagent output into it), so it is exactly as
    // sensitive as body: both are redacted on write and both are physically
    // stripped by the episode-deletion cascade.
    sensitiveFields: ["body", "summary"],
    redaction: "redactFeedback strips secrets, PII when enabled, and oversized bodies from body and summary",
    deletion: "tombstone-ids",
    // No implemented propagation: preference-dataset is a preference export
    // and never reads feedback. The tombstone filter in readFeedback is what
    // keeps deleted feedback out of anything downstream.
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "corrupt JSONL line fails closed; tombstoned ids never reload through readFeedback"
  },
  {
    id: "preference",
    owner: "adaptation",
    path: "adaptation/preferences.json",
    retention: "until-deleted",
    sensitiveFields: ["value", "evidenceEpisodeId"],
    redaction: "bound via configurePreferencePersistence; dataset export strips evidenceEpisodeId and includes tombstone ids",
    deletion: "tombstone-ids",
    deletionPropagatesTo: ["preference-dataset"],
    migrationVersion: 1,
    recovery: "tombstones reload from disk; replay ignores deleted observations"
  },
  {
    id: "preference-dataset",
    owner: "adaptation",
    path: "derived export (exportForDataset / exportAuthorizedPreferences)",
    retention: "until-deleted",
    sensitiveFields: ["value"],
    redaction: "authorized export omits tombstones unless includeTombstones; dataset export always lists tombstone ids and never payloads",
    deletion: "exclude-from-export",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "re-export after tombstone; do not keep stale dataset files"
  },
  {
    id: "model-invocation",
    owner: "runtime",
    path: "runtime/invocations.jsonl",
    retention: "run-scoped",
    sensitiveFields: ["none stored — prompt/response bodies are hashed only"],
    redaction: "tokensIn/tokensOut unavailable stay undefined, never 0",
    // One global append-only log, so a run-scoped delete filter-rewrites it
    // rather than unlinking it, then invalidates the derived p50 snapshot.
    deletion: "delete-files",
    deletionPropagatesTo: ["catalog-observed"],
    migrationVersion: 1,
    recovery:
      "malformed invocation records fail closed at validateInvocation; a corrupt middle line also fails the delete rewrite closed"
  },
  {
    id: "catalog-observed",
    owner: "runtime",
    path: "runtime/routing/catalog-observed.json",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "aggregates only; missing usage is skipped, never treated as zero",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "rebuild from invocations.jsonl; a run delete invalidates the snapshot instead of recomputing it"
  },
  {
    id: "candidate",
    owner: "adaptation",
    path: "adaptation/registry.json",
    retention: "until-rollback",
    sensitiveFields: ["content is stored as hash, not body"],
    redaction: "candidates stay proposed until adapt promote --approve",
    deletion: "tombstone-ids",
    // No implemented propagation: there is no live assignment store to
    // propagate into (see the experiment class), so retiring a candidate
    // cannot reach one.
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "CAS promotion records expected version; rollback requires the target version"
  },
  {
    id: "experiment",
    owner: "adaptation",
    path: "in-memory / fixture plans (no live assignment store)",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "simulation evidence cannot close F-PROD",
    deletion: "exclude-from-export",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "re-validate the frozen plan before any assignment"
  },
  {
    id: "run-pause",
    owner: "runtime",
    path: "runtime/runs/<runId>/pause.json",
    retention: "run-scoped",
    sensitiveFields: ["reason (user free text)"],
    redaction: "operational pause state; never copied into optimization datasets",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "malformed pause.json (not JSON, paused !== true, bad requestedAt) fails closed"
  },
  {
    id: "track-questions",
    owner: "runtime",
    path: "runtime/runs/<runId>/track-questions.json",
    retention: "run-scoped",
    sensitiveFields: ["objective", "acceptance text"],
    redaction: "same sensitivity class as episode events; export only ids and references",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "file is regenerated by the track loop; missing file is not fabricated"
  },
  {
    id: "routing-eval-report",
    owner: "adaptation",
    path: "adaptation/evals/<candidateId>.<cacheKey>.json",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "paired aggregates only (stages, comparison, hashes); no episode bodies or raw prompts",
    deletion: "exclude-from-export",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "report is reproducible from the frozen dataset + registry via the cacheKey"
  },
  {
    id: "routing-eval-dataset",
    owner: "adaptation",
    path: "adaptation/eval-datasets/<runId>/manifest.json",
    retention: "until-deleted",
    // Two user-text fields reach this file, both best-effort redacted and
    // neither claimed clean. `exportRoutingEvalDataset` runs the whole
    // objective through `redactSensitiveText` (the value-removing pass
    // `redactFeedback` applies) and only then cuts an OBJECTIVE_MAX_CHARS
    // excerpt, because cutting first can split a secret past the point any
    // rule matches it. The discovered project root goes through the same pass
    // and is stored once on `source.originalWorkspace`, repeated verbatim on
    // each row so `adapt eval`'s per-row reader still parses; redaction only
    // removes the shapes it recognises, so a surviving path can still name a
    // user, a customer, or a repository.
    sensitiveFields: [
      "objective (redacted excerpt of task text)",
      "originalWorkspace (redacted project root; regex redaction is best-effort)"
    ],
    redaction:
      "adapt dataset copies ids, agent role, task family, PASS/FAIL, a redactSensitiveText-scrubbed objective excerpt and the scrubbed project root; prompts, tool payloads and model output never reach it. Rows are one run's routed tasks, not independent episodes",
    deletion: "delete-files",
    // No propagation out of this class: it is a leaf derived copy. The cascade
    // into it is declared on run-event, which is what deleteRunRecords
    // performs for the default eval-datasets/<runId>/ path. A `--dir` export
    // is an external copy no delete can rediscover; adapt dataset warns at
    // export time rather than implying a cascade that cannot exist.
    //
    // `delete-files` is a claim about the derivative, not about the name it is
    // filed under, so the default `<runId>` leaf must be a directory this
    // state root owns. A leaf that is a symlink is refused at export and makes
    // the delete fail closed (`EvalDatasetAliasError`) rather than unlink the
    // alias and report the file as deleted; see eval-dataset-path.ts.
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "re-export from the run event log; a stale manifest is replaced whole, never merged"
  },
  {
    id: "learned-routing-policy",
    owner: "adaptation",
    path: "adaptation/learning/projects/<stableProjectKey>/routing.json",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "model ids and avoid-list patterns only; no task text, no bodies",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "missing file loads as absent policy; live routing falls back to R0"
  },
  {
    id: "learning-bandit",
    owner: "adaptation",
    path: "adaptation/learning/projects/<stableProjectKey>/bandit.json",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "PASS/FAIL reward aggregates per model only; no task text, no bodies",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "rebuild from observed signals; corrupt file is ignored, not repaired"
  },
  {
    id: "providers-config",
    owner: "runtime",
    path: "runtime/providers.json",
    retention: "until-deleted",
    sensitiveFields: ["must not contain api keys"],
    redaction: "enableModel writes provider/model ids only",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "missing file loads as empty config"
  },
  {
    id: "auth-credential",
    owner: "runtime",
    path: "runtime/auth.json",
    retention: "until-deleted",
    sensitiveFields: ["api_key", "oauth tokens"],
    redaction: "auth status never prints secrets",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "missing file is empty; env vars still apply"
  }
];

export function durableRecordClassById(id: string): DurableRecordClass | undefined {
  return DURABLE_RECORD_CLASSES.find((entry) => entry.id === id);
}

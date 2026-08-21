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
  readonly deletionPropagatesTo: readonly string[];
  readonly migrationVersion: number;
  readonly recovery: string;
}

export const DURABLE_RECORD_CLASSES: readonly DurableRecordClass[] = [
  {
    id: "run-event",
    owner: "runtime",
    path: "runs/<runId>/events.jsonl",
    retention: "run-scoped",
    sensitiveFields: ["prompt", "tool payloads", "model output text"],
    redaction: "event bodies are append-only; do not copy into optimization datasets",
    deletion: "delete-files",
    deletionPropagatesTo: ["run-checkpoint", "episode"],
    migrationVersion: 1,
    recovery: "truncated final JSONL line is ignored; a corrupt middle line fails closed"
  },
  {
    id: "run-checkpoint",
    owner: "runtime",
    path: "runs/<runId>/checkpoint.json",
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
    path: "episodes/<episodeId>/events.jsonl",
    retention: "episode-scoped",
    sensitiveFields: ["objective", "acceptance text"],
    redaction: "export only ids, status, and evidence references",
    deletion: "delete-files",
    deletionPropagatesTo: ["feedback"],
    migrationVersion: 1,
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
    path: "feedback/records.jsonl",
    retention: "until-deleted",
    sensitiveFields: ["body"],
    redaction: "redactFeedback strips secrets, PII when enabled, and oversized bodies",
    deletion: "tombstone-ids",
    deletionPropagatesTo: ["preference-dataset"],
    migrationVersion: 1,
    recovery: "corrupt JSONL line fails closed"
  },
  {
    id: "preference",
    owner: "adaptation",
    path: "preferences.json (bound via configurePreferencePersistence)",
    retention: "until-deleted",
    sensitiveFields: ["value", "evidenceEpisodeId"],
    redaction: "dataset export strips evidenceEpisodeId and includes tombstone ids",
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
    path: "invocations.jsonl",
    retention: "run-scoped",
    sensitiveFields: ["none stored — prompt/response bodies are hashed only"],
    redaction: "tokensIn/tokensOut unavailable stay undefined, never 0",
    deletion: "delete-files",
    deletionPropagatesTo: ["catalog-observed"],
    migrationVersion: 1,
    recovery: "malformed invocation records fail closed at validateInvocation"
  },
  {
    id: "catalog-observed",
    owner: "runtime",
    path: "routing/catalog-observed.json",
    retention: "until-deleted",
    sensitiveFields: [],
    redaction: "aggregates only; missing usage is skipped, never treated as zero",
    deletion: "delete-files",
    deletionPropagatesTo: [],
    migrationVersion: 1,
    recovery: "rebuild from invocations.jsonl"
  },
  {
    id: "candidate",
    owner: "adaptation",
    path: "adaptation/registry.json",
    retention: "until-rollback",
    sensitiveFields: ["content is stored as hash, not body"],
    redaction: "candidates stay proposed until adapt promote --approve",
    deletion: "tombstone-ids",
    deletionPropagatesTo: ["experiment"],
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
    id: "providers-config",
    owner: "runtime",
    path: "providers.json",
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
    path: "auth.json",
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

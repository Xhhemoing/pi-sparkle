export type TaskFamily =
  | "edit"
  | "test"
  | "review"
  | "plan"
  | "research"
  | "refactor"
  | "deploy"
  | "unknown";

export interface TaskTaxonomyEntry {
  readonly taskId: string;
  readonly family: TaskFamily;
  readonly skills: readonly string[];
  /** Taxonomy version at classification time; undefined for pre-versioning entries. */
  readonly taxonomyVersion?: number;
}

/**
 * Version of the task taxonomy in effect for NEW classifications. Historical
 * entries keep the version they were recorded under — this constant never
 * rewrites them.
 */
export const TAXONOMY_VERSION = 1;

/** Pure: returns a new entry stamped with the given taxonomy version. */
export function stampTaxonomyVersion(
  entry: TaskTaxonomyEntry,
  version: number = TAXONOMY_VERSION
): TaskTaxonomyEntry {
  return { ...entry, taxonomyVersion: version };
}

/**
 * The taxonomy version exactly as recorded on the entry — undefined for
 * pre-versioning entries. Never defaults to the current version, so a
 * taxonomy bump cannot retroactively reclassify history.
 */
export function recordedTaxonomyVersion(entry: TaskTaxonomyEntry): number | undefined {
  return entry.taxonomyVersion;
}

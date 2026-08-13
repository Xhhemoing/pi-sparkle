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
}

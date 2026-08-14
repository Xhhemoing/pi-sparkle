import type { IsoTimestamp } from "../domain/timestamp.js";

export type RubricScope = "project" | "task" | "delivery" | "global";

export interface RubricCriterion {
  readonly id: string;
  readonly description: string;
  readonly weight: number; // 0-1
  readonly observableCheck: string;
}

export interface Rubric {
  readonly id: string;
  readonly version: number;
  readonly scope: RubricScope;
  readonly criteria: readonly RubricCriterion[];
  readonly createdAt: IsoTimestamp;
}

export interface RubricRegistry {
  readonly rubrics: Record<string, Rubric>;
  readonly activeVersion: Record<RubricScope, string>;
}

export function createRubric(
  id: string,
  scope: RubricScope,
  criteria: RubricCriterion[]
): Rubric {
  return {
    id,
    version: 1,
    scope,
    criteria,
    createdAt: new Date().toISOString() as IsoTimestamp,
  };
}

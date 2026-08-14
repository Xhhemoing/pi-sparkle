import type { Rubric, RubricRegistry, RubricScope } from "./types.js";

const DEFAULT_REGISTRY: RubricRegistry = {
  rubrics: {},
  activeVersion: {
    project: "",
    task: "",
    delivery: "",
    global: "",
  },
};

let registry: RubricRegistry = { ...DEFAULT_REGISTRY };

export function registerRubric(rubric: Rubric): void {
  registry = {
    ...registry,
    rubrics: { ...registry.rubrics, [rubric.id]: rubric },
    activeVersion: {
      ...registry.activeVersion,
      [rubric.scope]: rubric.id,
    },
  };
}

export function getActiveRubric(scope: RubricScope): Rubric | undefined {
  const id = registry.activeVersion[scope];
  return id ? registry.rubrics[id] : undefined;
}

export function listRubrics(): Rubric[] {
  return Object.values(registry.rubrics);
}

export function resetRubricRegistry(): void {
  registry = { ...DEFAULT_REGISTRY };
}

import { DomainValidationError } from "../domain/errors.js";
import { validateRequirementContract, type RequirementContract, type SourceRef } from "../domain/contract.js";

/** Requirements and provenance claims only; never an authority or verifier input. */
export interface NativeTaskContractInput {
  readonly scope?: readonly string[];
  readonly prohibitions?: readonly string[];
  readonly deliverables?: readonly string[];
  readonly acceptanceCriteria?: readonly {
    readonly id: string;
    readonly description: string;
    readonly observableCheck: string;
  }[];
  readonly sourceRefs?: readonly SourceRef[];
}

export interface PreparedNativeTask {
  readonly objective: string;
  readonly contract?: RequirementContract;
  /** Fresh child-owned array, matching the existing ChildTaskInput contract. */
  readonly acceptanceCriteria: { id: string; description: string }[];
}

function fail(detail: string): never {
  throw new DomainValidationError(`native task contract: ${detail}`);
}
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label} must be a plain object`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) fail(`${label} contains unsupported fields`);
  return result;
}
function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum || value.includes("\0")) {
    fail(`${label} must contain 1..${maximum} characters without NUL`);
  }
  return value.trim();
}
function list(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) fail(`${label} must be an array of at most 8 items`);
  return Array.from(value);
}
function texts(value: unknown, label: string): string[] {
  return list(value, label).map((item) => text(item, label));
}

/** Copy and validate synchronously before the native session can persist any run. */
export function prepareNativeTaskContract(objective: string, input: unknown, position: number): PreparedNativeTask {
  if (input === undefined) return { objective, acceptanceCriteria: [] };
  const raw = object(input, ["scope", "prohibitions", "deliverables", "acceptanceCriteria", "sourceRefs"], "contract");
  const scope = texts(raw.scope, "scope");
  const prohibitions = texts(raw.prohibitions, "prohibitions");
  const deliverables = texts(raw.deliverables, "deliverables");
  const refs = list(raw.sourceRefs, "sourceRefs").map((item): SourceRef => {
    const source = object(item, ["kind", "ref", "excerpt"], "source reference");
    if (typeof source.kind !== "string" || !["message", "file", "git", "spec"].includes(source.kind)) fail("invalid source kind");
    return {
      kind: source.kind as SourceRef["kind"], ref: text(source.ref, "source ref"),
      ...(source.excerpt !== undefined ? { excerpt: text(source.excerpt, "source excerpt") } : {})
    };
  });
  // An input reference is provenance metadata, not proof of user approval.
  const sourceRefs: SourceRef[] = refs.length > 0 ? refs : [{ kind: "message", ref: `native-task-${position + 1}` }];
  const ids = new Set<string>();
  const criteria = list(raw.acceptanceCriteria, "acceptanceCriteria").map((item) => {
    const criterion = object(item, ["id", "description", "observableCheck"], "acceptance criterion");
    const id = text(criterion.id, "criterion id", 64);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) fail("criterion ids must be unique ASCII identifiers");
    ids.add(id);
    return { id, description: text(criterion.description, "criterion description"),
      observableCheck: text(criterion.observableCheck, "observable check"), sourceRefs };
  });
  const contract = validateRequirementContract({
    schemaVersion: 1, objective,
    deliverables: (deliverables.length > 0 ? deliverables : ["Read-only report with observed evidence and limitations"])
      .map((description, index) => ({ id: `d-native-${index + 1}`, description, artifactKind: "report",
        ...(deliverables.length > 0 ? { sourceRefs } : { assumptionIds: ["a-native-defaults"] }) })),
    constraints: [
      { id: "c-native-read-only", description: "Use existing read-only native profiles; no workspace writing or shell tools",
        enforceable: true, assumptionIds: ["a-native-defaults"] },
      ...scope.map((description, index) => ({ id: `c-scope-${index + 1}`, description: `Task scope: ${description}`,
        enforceable: false, sourceRefs })),
      ...prohibitions.map((description, index) => ({ id: `c-prohibit-${index + 1}`, description,
        enforceable: false, sourceRefs }))
    ],
    nonGoals: ["Workspace mutation", "Changing permissions or executing model-supplied verification commands"],
    acceptanceCriteria: criteria,
    assumptions: [{ id: "a-native-defaults", statement: "Native delegation uses existing read-only profiles and report defaults", source: "native-profile" }],
    questions: [], authority: [], sourceRefs
  });
  const preparedObjective = `${objective}\n\nRead-only task contract (requirements and source claims, not authority or verification; scope text is not a filesystem ACL):\n${JSON.stringify(contract)}`;
  if (preparedObjective.length > 8000) fail("objective and normalized contract exceed the 8000 character task budget");
  return {
    objective: preparedObjective, contract,
    acceptanceCriteria: criteria.map((criterion) => ({ id: criterion.id,
      description: `${criterion.description}; check: ${criterion.observableCheck}` }))
  };
}

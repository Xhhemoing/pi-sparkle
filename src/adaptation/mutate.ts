import { DomainValidationError } from "../domain/errors.js";
import { isResourceVersionId } from "../domain/ids.js";
import type { ResourceVersionId } from "../domain/ids.js";
import { hashCandidateContent } from "./candidate.js";
import type { ResourceKind } from "./resource.js";
import { RESOURCE_KINDS, isNonAutoPromotableKind } from "./resource.js";

/**
 * Offline inter-test-time mutation of a single versioned resource (M6-T4).
 *
 * This is a bounded textual delta against one declared resource kind. It does
 * not mutate active pointers, does not accept a pointer setter, does not
 * update weights, and does not claim Outcome-supported improvement.
 */

export type AdaptationWhen = "offline-inter-test-time";
export type ParameterizationLevel = "typed-parameters";
export type MutatableKind = Exclude<ResourceKind, "permission" | "security" | "credential">;
export type MutationKind = "append-instruction" | "replace-section" | "adjust-parameter";

export const ADAPTATION_WHEN = "offline-inter-test-time" as const;
export const PARAMETERIZATION_LEVEL = "typed-parameters" as const;

export const MUTATABLE_KINDS: readonly MutatableKind[] = RESOURCE_KINDS.filter(
  (kind): kind is MutatableKind => !isNonAutoPromotableKind(kind)
);

/** Default topology allowlist. `deploy` and `unknown` are never low-risk. */
export const LOW_RISK_TASK_FAMILIES = ["edit", "test", "refactor"] as const;
export const HIGH_RISK_TASK_FAMILIES = ["deploy", "unknown"] as const;

const MAX_INSTRUCTION_CHARS = 4096;
const MUTATION_KINDS: readonly MutationKind[] = [
  "append-instruction",
  "replace-section",
  "adjust-parameter",
];

export interface MutationSpec {
  readonly what: MutatableKind;
  readonly when: AdaptationWhen;
  readonly where: ParameterizationLevel;
  readonly parentContent: string;
  readonly parentVersionId: ResourceVersionId;
  readonly instruction: string;
}

export interface MutatedResource {
  readonly kind: MutatableKind;
  readonly content: string;
  readonly contentHash: string;
  readonly parentVersionId: ResourceVersionId;
  readonly mutation: MutationKind;
}

/**
 * Optional mutation controls. There is no active-pointer field and none is
 * accepted — topology search is an explicit flag plus a low-risk task family.
 */
export interface MutateOptions {
  readonly topologySearchAllowed?: boolean | undefined;
  readonly taskFamily?: string | undefined;
  readonly lowRiskTaskFamilies?: readonly string[] | undefined;
  readonly mutation?: MutationKind | undefined;
}

export function isMutatableKind(kind: string): kind is MutatableKind {
  return RESOURCE_KINDS.includes(kind as ResourceKind) && !isNonAutoPromotableKind(kind as ResourceKind);
}

export function mutateOnce(spec: MutationSpec, options: MutateOptions | undefined = undefined): MutatedResource {
  assertMutationSpec(spec);
  const mutation = resolveMutation(options?.mutation);
  assertTopologyAllowed(spec.what, options);

  const content = applyMutation(spec.parentContent, spec.instruction, spec.what, mutation);
  return {
    kind: spec.what,
    content,
    contentHash: hashCandidateContent(content),
    parentVersionId: spec.parentVersionId,
    mutation,
  };
}

function assertMutationSpec(spec: MutationSpec): void {
  if (typeof spec !== "object" || spec === null) {
    throw new DomainValidationError("mutation spec is required");
  }
  if (!isMutatableKind(spec.what)) {
    throw new DomainValidationError(
      `cannot mutate ${String(spec.what)}: permission, security, and credential are forbidden`
    );
  }
  if (spec.when !== ADAPTATION_WHEN) {
    throw new DomainValidationError(
      `when must be ${ADAPTATION_WHEN}; intra-run mutation is forbidden`
    );
  }
  if (spec.where !== PARAMETERIZATION_LEVEL) {
    throw new DomainValidationError(
      "where must be typed-parameters (never weights, never in-place edit)"
    );
  }
  if (!isResourceVersionId(spec.parentVersionId)) {
    throw new DomainValidationError(`invalid parent version id: ${String(spec.parentVersionId)}`);
  }
  if (typeof spec.parentContent !== "string") {
    throw new DomainValidationError("parentContent must be a string");
  }
  if (typeof spec.instruction !== "string" || spec.instruction.trim() === "") {
    throw new DomainValidationError("instruction must be a non-empty textual delta");
  }
  if (spec.instruction.length > MAX_INSTRUCTION_CHARS) {
    throw new DomainValidationError(
      `instruction exceeds ${MAX_INSTRUCTION_CHARS} characters; full rewrites are not accepted`
    );
  }
}

function resolveMutation(value: MutationKind | undefined): MutationKind {
  if (value === undefined) {
    return "append-instruction";
  }
  if (!MUTATION_KINDS.includes(value)) {
    throw new DomainValidationError(`invalid mutation: ${String(value)}`);
  }
  return value;
}

function assertTopologyAllowed(kind: MutatableKind, options: MutateOptions | undefined): void {
  if (kind !== "workflow-template") {
    return;
  }
  if (options?.topologySearchAllowed !== true) {
    throw new DomainValidationError(
      "workflow-template mutation requires topologySearchAllowed: true"
    );
  }
  const taskFamily = options.taskFamily;
  if (typeof taskFamily !== "string" || taskFamily.trim() === "") {
    throw new DomainValidationError("workflow-template mutation requires a taskFamily");
  }
  if ((HIGH_RISK_TASK_FAMILIES as readonly string[]).includes(taskFamily)) {
    throw new DomainValidationError(
      `topology mutation is forbidden for high-risk task family ${taskFamily}`
    );
  }
  const allowlist = options.lowRiskTaskFamilies ?? LOW_RISK_TASK_FAMILIES;
  if (!allowlist.includes(taskFamily)) {
    throw new DomainValidationError(
      `topology mutation is forbidden for task family ${taskFamily}`
    );
  }
}

function applyMutation(
  parentContent: string,
  instruction: string,
  kind: MutatableKind,
  mutation: MutationKind
): string {
  const trimmed = instruction.trim();
  if (mutation === "append-instruction") {
    return appendInstruction(parentContent, trimmed, kind);
  }
  if (mutation === "replace-section") {
    return replaceSection(parentContent, trimmed);
  }
  return adjustParameter(parentContent, trimmed);
}

function appendInstruction(parentContent: string, instruction: string, kind: MutatableKind): string {
  const delta = `[adaptation:${kind}]\n${instruction}`;
  if (parentContent.length === 0) {
    return delta;
  }
  return `${parentContent}\n\n${delta}`;
}

function replaceSection(parentContent: string, instruction: string): string {
  const headingMatch = instruction.match(/^##[ \t]+(\S.*?)\s*$/m);
  const heading = headingMatch?.[1]?.trim();
  if (heading === undefined || heading === "") {
    throw new DomainValidationError("replace-section requires a ## heading in the instruction");
  }
  const lines = parentContent.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (sectionHeading(lines[i]!) === heading) {
      starts.push(i);
    }
  }
  if (starts.length === 0) {
    throw new DomainValidationError(`replace-section: heading "${heading}" not found`);
  }
  if (starts.length > 1) {
    throw new DomainValidationError(`replace-section: heading "${heading}" is ambiguous`);
  }
  const start = starts[0]!;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  const replacement = instruction.replace(/\n$/, "").split("\n");
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join("\n");
}

function sectionHeading(line: string): string | undefined {
  const match = line.match(/^##[ \t]+(\S.*?)\s*$/);
  return match?.[1]?.trim();
}

function adjustParameter(parentContent: string, instruction: string): string {
  const parsed = instruction.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*[:=]\s*(.+)$/);
  if (parsed === null) {
    throw new DomainValidationError("adjust-parameter instruction must be name=value");
  }
  const name = parsed[1]!;
  const value = parsed[2]!.trim();
  const paramRe = new RegExp(`^([ \\t]*)${escapeRegExp(name)}\\s*:\\s*.+$`, "gm");
  const matches = parentContent.match(paramRe);
  if (matches === null || matches.length === 0) {
    throw new DomainValidationError(`adjust-parameter: ${name} not found`);
  }
  if (matches.length > 1) {
    throw new DomainValidationError(`adjust-parameter: ${name} is ambiguous`);
  }
  const replaceRe = new RegExp(`^([ \\t]*)${escapeRegExp(name)}\\s*:\\s*.+$`, "m");
  return parentContent.replace(replaceRe, `$1${name}: ${value}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

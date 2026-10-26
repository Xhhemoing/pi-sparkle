import { DomainValidationError } from "../../domain/errors.js";
import { isResourceVersionId, parseProjectId, type ResourceVersionId } from "../../domain/ids.js";
import { isRecord } from "../../domain/record.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../development/task-spec.js";
import { stableProjectKey } from "../../persist/project-key.js";
import { hashCandidateContent } from "./candidate.js";
import type { ResourceRegistry } from "./registry.js";
import { identityEquals, type ResourceIdentity } from "./resource.js";

export const TASK_RESOURCE_TOPICS = ["node-preparation", "host-only-checks", "input-validation"] as const;
export type TaskResourceTopic = typeof TASK_RESOURCE_TOPICS[number];
export interface TaskResourceContent {
  readonly topic: TaskResourceTopic;
  readonly guidance: string;
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
export interface TaskResourceBinding {
  readonly topic: TaskResourceTopic;
  readonly identity: ResourceIdentity;
  readonly versionId: ResourceVersionId;
  readonly contentHash: string;
}
/** Development authoring artifact, never runtime permission or a persisted live capability. */
export interface MaterializedTaskResources {
  readonly logicalTaskId: string;
  readonly sourceRevision: string;
  readonly projectRoot: string;
  readonly baseSpec: DevelopmentTaskSpec;
  readonly spec: DevelopmentTaskSpec;
  readonly resources: readonly TaskResourceBinding[];
  readonly hostGuidance: readonly string[];
  readonly preparationBinding?: PreparationBinding;
}
export interface PreparationBinding {
  readonly recipeId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly authorityRef: string;
  readonly candidateOnly: true;
}
function fail(message: string): never { throw new DomainValidationError(`task resources: ${message}`); }
export function taskResourceTopic(value: unknown): TaskResourceTopic {
  if (!TASK_RESOURCE_TOPICS.includes(value as TaskResourceTopic)) fail("unsupported topic");
  return value as TaskResourceTopic;
}
export function taskResourceIdentity(projectRoot: string, topic: TaskResourceTopic): ResourceIdentity {
  taskResourceTopic(topic);
  return { kind: topic === "node-preparation" ? "workflow-template" : "prompt", name: topic,
    scope: { kind: "project", projectId: parseProjectId(`prj_${stableProjectKey(projectRoot)}`) } };
}
function text(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > maximum) fail(`invalid ${label}`);
  return value;
}
export function parseTaskResourceContent(content: string): TaskResourceContent {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return fail("guidance content must be JSON"); }
  if (!isRecord(value) || Object.keys(value).some(key => !["topic", "guidance", "sourceRefs", "expectedEffect"].includes(key))) fail("unsupported guidance fields");
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0 || value.sourceRefs.length > 1000) fail("source references required");
  const sourceRefs = value.sourceRefs.map(ref => text(ref, "source reference"));
  if (new Set(sourceRefs).size !== sourceRefs.length) fail("duplicate source reference");
  return Object.freeze({ topic: taskResourceTopic(value.topic), guidance: value.guidance === "" ? "" : text(value.guidance, "guidance"),
    sourceRefs: Object.freeze(sourceRefs), expectedEffect: text(value.expectedEffect, "expected effect") });
}
function resolveBinding(registry: ResourceRegistry, projectRoot: string, topic: TaskResourceTopic, versionId: ResourceVersionId): { binding: TaskResourceBinding; content: TaskResourceContent } {
  const identity = taskResourceIdentity(projectRoot, topic), version = registry.getVersion(versionId);
  if (version === undefined || !identityEquals(identity, version.identity) || registry.isRetired(versionId)) fail("resource version identity is unavailable");
  const raw = registry.getContent(version.contentHash);
  if (raw === undefined || hashCandidateContent(raw) !== version.contentHash) fail("resource content unavailable or changed");
  const content = parseTaskResourceContent(raw);
  if (content.topic !== topic) fail("content topic does not match identity");
  if (content.guidance === "" && version.parentVersionId !== undefined) fail("only an owner-created original baseline may have empty guidance");
  return { binding: Object.freeze({ topic, identity, versionId, contentHash: version.contentHash }), content };
}
function build(input: { registry: ResourceRegistry; projectRoot: string; logicalTaskId: string; sourceRevision: string; spec: DevelopmentTaskSpec; preparationBinding?: PreparationBinding }, versions: readonly { topic: TaskResourceTopic; versionId: ResourceVersionId }[]): MaterializedTaskResources {
  const logicalTaskId = text(input.logicalTaskId, "logical task id", 128), projectRoot = text(input.projectRoot, "project root");
  if (!/^[0-9a-f]{40}$/.test(input.sourceRevision)) fail("source revision must be an exact Git revision");
  const baseSpec = snapshotDevelopmentTaskSpec(input.spec);
  if (versions.length === 0 || new Set(versions.map(entry => entry.topic)).size !== versions.length) fail("select distinct resource topics");
  const selected = versions.map(entry => resolveBinding(input.registry, projectRoot, entry.topic, entry.versionId));
  const resources = Object.freeze(selected.map(entry => entry.binding));
  let preparationBinding: PreparationBinding | undefined;
  if (versions.some(entry => entry.topic === "node-preparation")) {
    const binding = input.preparationBinding;
    const recipe = baseSpec.prepare.find(entry => entry.id === binding?.recipeId);
    if (binding === undefined || binding.candidateOnly !== true || !recipe || recipe.command !== binding.command ||
        JSON.stringify(recipe.args) !== JSON.stringify(binding.args)) fail("node preparation requires an explicit host-selected preparation binding already present in TaskSpec.prepare");
    preparationBinding = Object.freeze({ recipeId: recipe.id, command: recipe.command, args: Object.freeze([...recipe.args]),
      authorityRef: text(binding.authorityRef, "prepare authority reference"), candidateOnly: true });
  } else if (input.preparationBinding !== undefined) fail("preparation binding requires the node-preparation topic");
  const annotation = JSON.stringify({ logicalTaskId, resources: resources.map(({ topic, versionId, contentHash }) => ({ topic, versionId, contentHash })) });
  const hostGuidance = Object.freeze(selected.filter(entry => entry.binding.topic === "node-preparation").map(entry => entry.content.guidance));
  const guidance = selected.filter(entry => entry.binding.topic !== "node-preparation" && entry.content.guidance !== "").map(entry => `[${entry.binding.topic}]\n${entry.content.guidance}`).join("\n\n");
  // Only objective text is materialized. Commands, scopes, checks and budgets remain exactly host-selected.
  const spec = guidance === "" ? baseSpec : snapshotDevelopmentTaskSpec({ ...baseSpec, objective: `${baseSpec.objective}\n\nHost-selected resource guidance (content only; no new command, permission or budget authority):\n${annotation}\n${guidance}` });
  return Object.freeze({ logicalTaskId, sourceRevision: input.sourceRevision, projectRoot, baseSpec, spec, resources, hostGuidance,
    ...(preparationBinding === undefined ? {} : { preparationBinding }) });
}
/** Explicit host authoring call; reads current pointers once, never promotes or executes. */
export function materializeTaskResources(input: { registry: ResourceRegistry; projectRoot: string; logicalTaskId: string; sourceRevision: string; spec: DevelopmentTaskSpec; topics: readonly TaskResourceTopic[]; preparationBinding?: PreparationBinding }): MaterializedTaskResources {
  const versions = input.topics.map(raw => {
    const topic = taskResourceTopic(raw), active = input.registry.getActiveVersion(taskResourceIdentity(input.projectRoot, topic));
    if (active === undefined) fail(`no active ${topic}; owner baseline approval is required`);
    return { topic, versionId: active.versionId };
  });
  return build(input, versions);
}
/** Reconstruct expected text from immutable registry versions, not from assertions in a trial file. */
export function verifyMaterializedTaskResources(registry: ResourceRegistry, value: unknown): MaterializedTaskResources {
  if (!isRecord(value) || !Array.isArray(value.resources)) fail("invalid materialized input");
  const versions = value.resources.map(entry => {
    if (!isRecord(entry) || !isResourceVersionId(entry.versionId)) return fail("invalid consumed version");
    return { topic: taskResourceTopic(entry.topic), versionId: entry.versionId };
  });
  let preparationBinding: PreparationBinding | undefined;
  if (value.preparationBinding !== undefined) {
    const raw = value.preparationBinding;
    if (!isRecord(raw) || raw.candidateOnly !== true || !Array.isArray(raw.args)) fail("invalid preparation binding");
    preparationBinding = { recipeId: text(raw.recipeId, "prepare id"), command: text(raw.command, "prepare command"),
      args: raw.args.map(arg => { if (typeof arg !== "string") return fail("invalid prepare args"); return arg; }),
      authorityRef: text(raw.authorityRef, "prepare authority reference"), candidateOnly: true };
  }
  const expected = build({ registry, projectRoot: text(value.projectRoot, "project root"), logicalTaskId: text(value.logicalTaskId, "logical task id", 128),
    sourceRevision: text(value.sourceRevision, "source revision"), spec: snapshotDevelopmentTaskSpec(value.baseSpec),
    ...(preparationBinding === undefined ? {} : { preparationBinding }) }, versions);
  if (JSON.stringify(snapshotDevelopmentTaskSpec(value.spec)) !== JSON.stringify(expected.spec) || JSON.stringify(value.resources) !== JSON.stringify(expected.resources) ||
      JSON.stringify(value.hostGuidance) !== JSON.stringify(expected.hostGuidance)) fail("materialized content or bindings changed");
  return expected;
}

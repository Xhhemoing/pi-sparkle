import { DomainValidationError } from "../../domain/errors.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types } from "node:util";
import { isResourceVersionId, parseProjectId, type ResourceVersionId } from "../../domain/ids.js";
import { isRecord } from "../../domain/record.js";
import { snapshotDevelopmentTaskSpec, snapshotTaskSpecHostInput, type DevelopmentTaskSpec } from "../../development/task-spec.js";
import { workItemScope } from "../../development/work-items.js";
import { stableProjectKey } from "../../persist/project-key.js";
import { hashCandidateContent } from "./candidate.js";
import type { ResourceRegistry } from "./registry.js";
import { identityEquals, type ResourceIdentity } from "./resource.js";
import { parseTaskModelSelection, type TaskModelSelection } from "../../domain/task-model-selection.js";

export const TASK_RESOURCE_TOPICS = ["node-preparation", "host-only-checks", "input-validation", "check-recipes", "model-thinking", "context-rule", "task-spec-template"] as const;
export type TaskResourceTopic = typeof TASK_RESOURCE_TOPICS[number];
export interface TaskGuidanceContent {
  readonly topic: Exclude<TaskResourceTopic, "check-recipes" | "model-thinking" | "context-rule" | "task-spec-template">;
  readonly guidance: string;
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
export interface CheckRecipeLauncher {
  readonly id: string;
  readonly fromCommand: string;
  readonly fromPrefixArgs: readonly string[];
  readonly command: string;
  readonly prefixArgs: readonly string[];
}
export interface TaskCheckRecipeContent {
  readonly topic: "check-recipes";
  readonly mode: "preserve" | "host-bindings";
  readonly launchers: readonly CheckRecipeLauncher[];
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
/** A fixed execution recipe, without conditions, credentials or routing rules. */
export interface TaskModelRecipeContent {
  readonly topic: "model-thinking";
  readonly selection: TaskModelSelection;
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
export interface TaskContextRuleContent {
  readonly topic: "context-rule";
  readonly requiredFiles: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
export interface TaskSpecTemplateLayout {
  readonly prepareRoles: readonly string[];
  readonly checkRoles: readonly { readonly role: string; readonly requiredBaseline: "pass" | "fail" }[];
}
export interface TaskSpecTemplateContent {
  readonly topic: "task-spec-template";
  readonly schemaVersion: 1;
  readonly layout: TaskSpecTemplateLayout;
  readonly sourceRefs: readonly string[];
  readonly expectedEffect: string;
}
export type TaskResourceContent = TaskGuidanceContent | TaskCheckRecipeContent | TaskModelRecipeContent | TaskContextRuleContent | TaskSpecTemplateContent;
export interface CheckRecipeBindings {
  readonly authorityRef: string;
  readonly originalChecks: DevelopmentTaskSpec["checks"];
  readonly selections: readonly { readonly checkId: string; readonly launcherId: string }[];
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
  readonly checkRecipeBindings?: CheckRecipeBindings;
  /** Requested content only. A separate trusted host authority is required at execution. */
  readonly modelSelection?: TaskModelSelection;
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
  return { kind: topic === "node-preparation" || topic === "check-recipes" || topic === "model-thinking" || topic === "context-rule" || topic === "task-spec-template" ? "workflow-template" : "prompt", name: topic,
    scope: { kind: "project", projectId: parseProjectId(`prj_${stableProjectKey(projectRoot)}`) } };
}
function text(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > maximum) fail(`invalid ${label}`);
  return value;
}
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("unsupported check-recipe field");
  return value;
}
/** Copy only bounded ordinary own-data JSON. Never invoke host getters or toJSON. */
function templateData(value: unknown, depth = 0): unknown {
  if (depth > 12) fail("template input is too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value !== "object" || types.isProxy(value)) fail("template input must be own data");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1) fail("invalid template array");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const property = Object.getOwnPropertyDescriptor(value, index);
      if (!property || !("value" in property)) fail("template array entries must be own data");
      result.push(templateData(property.value, depth + 1));
    }
    return Object.freeze(result);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail("template objects must be ordinary own-data objects, without inherited entries");
  const result: Record<string, unknown> = {};
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1000) fail("too many template fields");
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !("value" in property) || !property.enumerable) fail("template fields must be enumerable own data, not accessors");
    Object.defineProperty(result, key, { value: templateData(property.value, depth + 1), enumerable: true });
  }
  return Object.freeze(result);
}
function templateFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail("invalid or missing template field");
  return value;
}
function templateRole(value: unknown): string {
  const role = text(value, "template role", 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(role) || Object.hasOwn(Object.prototype, role) || role === "prototype") fail("unsafe template role");
  return role;
}
export function parseTaskSpecTemplateLayout(value: unknown): TaskSpecTemplateLayout {
  const raw = templateFields(templateData(value), ["prepareRoles", "checkRoles"]);
  if (!Array.isArray(raw.prepareRoles) || raw.prepareRoles.length > 8 || !Array.isArray(raw.checkRoles) || raw.checkRoles.length < 1 || raw.checkRoles.length > 8) fail("template requires 0..8 prepare roles and 1..8 check roles");
  const prepareRoles = raw.prepareRoles.map(templateRole);
  const checkRoles = raw.checkRoles.map(entry => {
    const check = templateFields(entry, ["role", "requiredBaseline"]);
    if (check.requiredBaseline !== "pass" && check.requiredBaseline !== "fail") fail("unsupported template requiredBaseline");
    return Object.freeze({ role: templateRole(check.role), requiredBaseline: check.requiredBaseline });
  });
  const roles = [...prepareRoles, ...checkRoles.map(check => check.role)];
  if (new Set(roles).size !== roles.length) fail("duplicate template role");
  return Object.freeze({ prepareRoles: Object.freeze(prepareRoles), checkRoles: Object.freeze(checkRoles) });
}
function nodeCommand(value: unknown, absolute: boolean): string {
  const command = text(value, "Node command", 512);
  if (!/^(?:node|node\.exe)$/i.test(path.win32.basename(command)) ||
      (absolute ? !path.isAbsolute(command) && !path.win32.isAbsolute(command) : command !== "node" && command !== "node.exe" && !path.isAbsolute(command) && !path.win32.isAbsolute(command))) fail("launcher requires an explicit Node command, absolute for the replacement");
  return command;
}
function importPrefix(value: unknown, replacement: boolean): readonly string[] {
  if (!Array.isArray(value) || (value.length !== 0 && (value.length !== 2 || value[0] !== "--import"))) fail("launcher prefix must be empty or one --import module");
  if (value.length === 0) return Object.freeze([]);
  const module = text(value[1], "import module", 2048);
  if (module.startsWith("file:")) {
    try {
      const url = new URL(module);
      if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost") || url.search || url.hash) fail("import module must be an absolute local file URL");
      if (!path.isAbsolute(fileURLToPath(url))) fail("import module must be absolute");
    } catch { return fail("import module must be an absolute local file URL"); }
  } else if (replacement || (!path.isAbsolute(module) && !path.win32.isAbsolute(module))) fail("replacement import module must use an absolute local file URL");
  return Object.freeze(["--import", module]);
}
/** Exact conversion values live inside existing versioned candidate content, not in mutable binding paths. */
export function parseCheckRecipeLaunchers(value: unknown): readonly CheckRecipeLauncher[] {
  if (!Array.isArray(value) || value.length > 8) fail("require at most eight fixed launchers");
  const result = value.map(entry => {
    const raw = fields(entry, ["id", "fromCommand", "fromPrefixArgs", "command", "prefixArgs"]), id = text(raw.id, "launcher id", 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) fail("invalid launcher id");
    return Object.freeze({ id, fromCommand: nodeCommand(raw.fromCommand, false), fromPrefixArgs: importPrefix(raw.fromPrefixArgs, false), command: nodeCommand(raw.command, true), prefixArgs: importPrefix(raw.prefixArgs, true) });
  });
  if (new Set(result.map(entry => entry.id)).size !== result.length) fail("duplicate launcher id");
  return Object.freeze(result);
}
function checkBindings(value: unknown, spec: DevelopmentTaskSpec): CheckRecipeBindings {
  const raw = fields(value, ["authorityRef", "originalChecks", "selections"]);
  const originalChecks = snapshotDevelopmentTaskSpec({ ...spec, checks: raw.originalChecks }).checks;
  if (!isDeepStrictEqual(originalChecks, spec.checks)) fail("host binding original checks must exactly match the complete original checks");
  if (!Array.isArray(raw.selections) || raw.selections.length !== spec.checks.length) fail("host selections must cover all original checks");
  const selections = raw.selections.map(entry => {
    const selected = fields(entry, ["checkId", "launcherId"]);
    return Object.freeze({ checkId: text(selected.checkId, "check id", 64), launcherId: text(selected.launcherId, "launcher id", 64) });
  });
  if (new Set(selections.map(entry => entry.checkId)).size !== selections.length || selections.some(entry => !spec.checks.some(check => check.id === entry.checkId))) fail("host selection coverage must match every original check id exactly once");
  return Object.freeze({ authorityRef: text(raw.authorityRef, "host launcher authority reference"), originalChecks, selections: Object.freeze(selections) });
}
function materializeChecks(spec: DevelopmentTaskSpec, content: TaskCheckRecipeContent, binding: CheckRecipeBindings): DevelopmentTaskSpec["checks"] {
  if (content.mode === "preserve") return spec.checks;
  return spec.checks.map(check => {
    const selected = binding.selections.find(entry => entry.checkId === check.id)!;
    const launcher = content.launchers.find(entry => entry.id === selected.launcherId);
    if (!launcher) fail("host selection is not a fixed launcher in the approved resource");
    if (check.command !== launcher.fromCommand || !launcher.fromPrefixArgs.every((arg, index) => check.args[index] === arg) ||
        (launcher.fromPrefixArgs.length === 0 && check.args[0] === "--import")) fail("original launcher prefix does not match the exact approved conversion");
    const businessArgs = check.args.slice(launcher.fromPrefixArgs.length);
    if (businessArgs.length === 0 || businessArgs[0] === "--import") fail("one explicit launcher prefix and complete business args are required");
    return { ...check, command: launcher.command, args: [...launcher.prefixArgs, ...businessArgs] };
  });
}
export function parseTaskResourceContent(content: string): TaskResourceContent {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return fail("guidance content must be JSON"); }
  if (!isRecord(value)) fail("resource content must be an object");
  const topic = taskResourceTopic(value.topic);
  fields(value, topic === "task-spec-template" ? ["topic", "schemaVersion", "layout", "sourceRefs", "expectedEffect"] : topic === "context-rule" ? ["topic", "requiredFiles", "sourceRefs", "expectedEffect"] :
    topic === "check-recipes" ? ["topic", "mode", "launchers", "sourceRefs", "expectedEffect"] : topic === "model-thinking" ? ["topic", "selection", "sourceRefs", "expectedEffect"] : ["topic", "guidance", "sourceRefs", "expectedEffect"]);
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0 || value.sourceRefs.length > 1000) fail("source references required");
  const sourceRefs = value.sourceRefs.map(ref => text(ref, "source reference"));
  if (new Set(sourceRefs).size !== sourceRefs.length) fail("duplicate source reference");
  const common = { sourceRefs: Object.freeze(sourceRefs), expectedEffect: text(value.expectedEffect, "expected effect") };
  if (topic === "model-thinking") return Object.freeze({ topic, selection: parseTaskModelSelection(value.selection), ...common });
  if (topic === "task-spec-template") {
    templateFields(value, ["topic", "schemaVersion", "layout", "sourceRefs", "expectedEffect"]);
    if (value.schemaVersion !== 1) fail("unsupported template schemaVersion");
    return Object.freeze({ topic, schemaVersion: 1, layout: parseTaskSpecTemplateLayout(value.layout), ...common });
  }
  if (topic === "context-rule") {
    if (!Array.isArray(value.requiredFiles) || value.requiredFiles.length > 32) fail("context files must be an array of at most 32 literal paths");
    const requiredFiles = value.requiredFiles.map(workItemScope);
    if (new Set(requiredFiles).size !== requiredFiles.length) fail("duplicate context file path");
    return Object.freeze({ topic, requiredFiles: Object.freeze(requiredFiles), ...common });
  }
  if (topic === "check-recipes") {
    const launchers = parseCheckRecipeLaunchers(value.launchers);
    if ((value.mode !== "preserve" && value.mode !== "host-bindings") || (value.mode === "preserve" ? launchers.length !== 0 : launchers.length === 0)) fail("check-recipe mode requires preserve with no conversions or host-bindings with fixed conversions");
    return Object.freeze({ topic, mode: value.mode, launchers, ...common });
  }
  return Object.freeze({ topic, guidance: value.guidance === "" ? "" : text(value.guidance, "guidance"), ...common });
}
function resolveBinding(registry: ResourceRegistry, projectRoot: string, topic: TaskResourceTopic, versionId: ResourceVersionId): { binding: TaskResourceBinding; content: TaskResourceContent } {
  const identity = taskResourceIdentity(projectRoot, topic), version = registry.getVersion(versionId);
  if (version === undefined || !identityEquals(identity, version.identity) || registry.isRetired(versionId)) fail("resource version identity is unavailable");
  const raw = registry.getContent(version.contentHash);
  if (raw === undefined || hashCandidateContent(raw) !== version.contentHash) fail("resource content unavailable or changed");
  const content = parseTaskResourceContent(raw);
  if (content.topic !== topic) fail("content topic does not match identity");
  if ((content.topic === "context-rule" ? content.requiredFiles.length === 0 : content.topic === "check-recipes" ? content.mode === "preserve" : content.topic !== "model-thinking" && content.topic !== "task-spec-template" && content.guidance === "") && version.parentVersionId !== undefined) fail("only an owner-created original baseline may have empty context files, empty guidance or preserve checks");
  return { binding: Object.freeze({ topic, identity, versionId, contentHash: version.contentHash }), content };
}
function build(input: { registry: ResourceRegistry; projectRoot: string; logicalTaskId: string; sourceRevision: string; spec: DevelopmentTaskSpec; preparationBinding?: PreparationBinding; checkRecipeBindings?: unknown }, versions: readonly { topic: TaskResourceTopic; versionId: ResourceVersionId }[]): MaterializedTaskResources {
  const logicalTaskId = text(input.logicalTaskId, "logical task id", 128), projectRoot = text(input.projectRoot, "project root");
  if (!/^[0-9a-f]{40}$/.test(input.sourceRevision)) fail("source revision must be an exact Git revision");
  const baseSpec = snapshotDevelopmentTaskSpec(input.spec);
  if (versions.length === 0 || new Set(versions.map(entry => entry.topic)).size !== versions.length) fail("select distinct resource topics");
  const selected = versions.map(entry => resolveBinding(input.registry, projectRoot, entry.topic, entry.versionId));
  if (selected.some(entry => entry.content.topic === "task-spec-template")) fail("task-spec-template requires explicit authoring, not baseSpec materialization");
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
  const hostGuidance = Object.freeze(selected.flatMap(({ content }) => content.topic === "node-preparation" ? [content.guidance] : []));
  const guidance = selected.flatMap(({ content }) => content.topic !== "node-preparation" && content.topic !== "check-recipes" && content.topic !== "model-thinking" && content.topic !== "context-rule" && content.topic !== "task-spec-template" && content.guidance !== "" ? [`[${content.topic}]\n${content.guidance}`] : []).join("\n\n");
  const modelRecipe = selected.find(entry => entry.content.topic === "model-thinking")?.content;
  const modelSelection = modelRecipe?.topic === "model-thinking" ? modelRecipe.selection : undefined;
  const context = [...baseSpec.context];
  for (const { content } of selected) {
    if (content.topic === "context-rule") for (const file of content.requiredFiles) if (!context.includes(file)) context.push(file);
  }
  const recipe = selected.find(entry => entry.content.topic === "check-recipes")?.content;
  let checks = baseSpec.checks, checkRecipeBindings: CheckRecipeBindings | undefined;
  if (recipe?.topic === "check-recipes") {
    if (input.checkRecipeBindings !== undefined) checkRecipeBindings = checkBindings(input.checkRecipeBindings, baseSpec);
    if (recipe.mode === "host-bindings" && !checkRecipeBindings) fail("check-recipe materialization requires explicit host bindings");
    if (checkRecipeBindings) checks = materializeChecks(baseSpec, recipe, checkRecipeBindings);
  } else if (input.checkRecipeBindings !== undefined) fail("check-recipe bindings require the check-recipes topic");
  const objective = guidance === "" ? baseSpec.objective : `${baseSpec.objective}\n\nHost-selected resource guidance (content only; no new command, permission or budget authority):\n${annotation}\n${guidance}`;
  const spec = snapshotDevelopmentTaskSpec({ ...baseSpec, objective, context, checks });
  return Object.freeze({ logicalTaskId, sourceRevision: input.sourceRevision, projectRoot, baseSpec, spec, resources, hostGuidance,
    ...(preparationBinding === undefined ? {} : { preparationBinding }), ...(checkRecipeBindings === undefined ? {} : { checkRecipeBindings }),
    ...(modelSelection === undefined ? {} : { modelSelection }) });
}
/** Explicit host authoring call; reads current pointers once, never promotes or executes. */
export function materializeTaskResources(input: { registry: ResourceRegistry; projectRoot: string; logicalTaskId: string; sourceRevision: string; spec: DevelopmentTaskSpec; topics: readonly TaskResourceTopic[]; preparationBinding?: PreparationBinding; checkRecipeBindings?: unknown }): MaterializedTaskResources {
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
    ...(preparationBinding === undefined ? {} : { preparationBinding }), ...(value.checkRecipeBindings === undefined ? {} : { checkRecipeBindings: value.checkRecipeBindings }) }, versions);
  if (JSON.stringify(snapshotDevelopmentTaskSpec(value.spec)) !== JSON.stringify(expected.spec) || JSON.stringify(value.resources) !== JSON.stringify(expected.resources) ||
      JSON.stringify(value.hostGuidance) !== JSON.stringify(expected.hostGuidance) || !isDeepStrictEqual(value.modelSelection, expected.modelSelection)) fail("materialized content or bindings changed");
  return expected;
}

export interface TaskSpecTemplateBindings {
  readonly templateVersionId: ResourceVersionId;
  /** Provenance metadata only, never an execution credential. */
  readonly authorityRef: string;
  readonly objective: DevelopmentTaskSpec["objective"];
  readonly context: DevelopmentTaskSpec["context"];
  readonly limits?: DevelopmentTaskSpec["limits"];
  readonly write: DevelopmentTaskSpec["write"];
  readonly prepareByRole: Readonly<Record<string, DevelopmentTaskSpec["prepare"][number]>>;
  readonly checksByRole: Readonly<Record<string, DevelopmentTaskSpec["checks"][number]>>;
  readonly budget: DevelopmentTaskSpec["budget"];
  readonly worker: DevelopmentTaskSpec["worker"];
}
export interface TaskSpecTemplateHostInput {
  readonly projectRoot: string;
  readonly logicalTaskId: string;
  readonly sourceRevision: string;
  readonly versionId: ResourceVersionId;
  readonly bindings: unknown;
}
export interface AuthoredTaskSpecTemplate {
  readonly logicalTaskId: string;
  readonly sourceRevision: string;
  readonly projectRoot: string;
  readonly bindings: TaskSpecTemplateBindings;
  readonly resources: readonly TaskResourceBinding[];
  readonly spec: DevelopmentTaskSpec;
}
function authorTemplate(registry: ResourceRegistry, input: TaskSpecTemplateHostInput, current: boolean): AuthoredTaskSpecTemplate {
  const request = templateFields(templateData(input), ["projectRoot", "logicalTaskId", "sourceRevision", "versionId", "bindings"]);
  const projectRoot = text(request.projectRoot, "project root"), logicalTaskId = text(request.logicalTaskId, "logical task id", 128);
  const sourceRevision = text(request.sourceRevision, "source revision");
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) fail("source revision must be an exact Git revision");
  if (!isResourceVersionId(request.versionId)) fail("explicit template version id required");
  const raw = templateFields(request.bindings, ["templateVersionId", "authorityRef", "objective", "context", "write", "prepareByRole", "checksByRole", "budget", "worker"], ["limits"]);
  if (raw.templateVersionId !== request.versionId) fail("host templateVersionId must match the exact selected version");
  text(raw.authorityRef, "template authority reference");
  const selected = resolveBinding(registry, projectRoot, "task-spec-template", request.versionId);
  if (selected.content.topic !== "task-spec-template") fail("template content required");
  const version = registry.getVersion(request.versionId)!;
  if (version.parentVersionId !== undefined && !registry.ledger().some(entry => entry.kind === "promoted" && entry.toVersionId === version.versionId && entry.review?.verdict === "approved")) fail("template version lacks approved promotion");
  if (current && registry.getActiveVersion(selected.binding.identity)?.versionId !== request.versionId) fail("explicit template version must match the current active pointer");
  const { layout } = selected.content;
  const catalog = (value: unknown, roles: readonly string[]): Record<string, unknown> => {
    if (!isRecord(value) || Object.keys(value).length !== roles.length || roles.some(role => !Object.hasOwn(value, role))) fail("host catalog coverage must match every template role exactly once");
    return value;
  };
  const prepareCatalog = catalog(raw.prepareByRole, layout.prepareRoles);
  const checkCatalog = catalog(raw.checksByRole, layout.checkRoles.map(check => check.role));
  // Only the ordered arrays are supplied by the template. All values remain host-owned.
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: raw.objective, context: raw.context, write: raw.write,
    prepare: layout.prepareRoles.map(role => prepareCatalog[role]), checks: layout.checkRoles.map(check => checkCatalog[check.role]),
    budget: raw.budget, worker: raw.worker, ...(raw.limits === undefined ? {} : { limits: raw.limits }) });
  if (layout.checkRoles.some((check, index) => check.requiredBaseline !== spec.checks[index]!.expect.baseline)) fail("host expect does not match template requiredBaseline");
  const ids = [...spec.prepare, ...spec.checks].map(recipe => recipe.id);
  if (new Set(ids).size !== ids.length) fail("duplicate host recipe id");
  return Object.freeze({ logicalTaskId, sourceRevision, projectRoot, bindings: raw as unknown as TaskSpecTemplateBindings,
    resources: Object.freeze([selected.binding]), spec });
}
/** Development-only authoring: no baseSpec, inferred recipes, execution, or promotion. */
export function authorTaskSpecFromTemplate(input: TaskSpecTemplateHostInput & { readonly registry: ResourceRegistry }): AuthoredTaskSpecTemplate {
  const { registry, ...request } = snapshotTaskSpecHostInput(input, ["registry", "projectRoot", "logicalTaskId", "sourceRevision", "versionId", "bindings"]);
  return authorTemplate(registry, request, true);
}
/** Historical reconstruction uses registry bytes and the complete separately trusted request, never artifact authority. */
export function verifyAuthoredTaskSpecTemplate(registry: ResourceRegistry, value: unknown, trustedHostInput: TaskSpecTemplateHostInput & { readonly registry?: ResourceRegistry }): AuthoredTaskSpecTemplate {
  const { registry: selectedRegistry, ...request } = snapshotTaskSpecHostInput(trustedHostInput, ["registry", "projectRoot", "logicalTaskId", "sourceRevision", "versionId", "bindings"]);
  if (selectedRegistry !== undefined && selectedRegistry !== registry) fail("trusted host registry must match the reconstruction registry");
  const expected = authorTemplate(registry, request, false);
  if (!isDeepStrictEqual(templateData(value), expected)) fail("authored template content or host bindings changed or do not match");
  return expected;
}

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { createEventId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { bindEpisodeToRun } from "../../../src/run/episode-bind.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import type { Event } from "../../../src/run/events.js";

/**
 * An episode is a deliberately lossy projection of the contract: it keeps the
 * acceptance criteria needed to close the episode, but it is never an
 * authority from which a run's RequirementContract may be reconstructed.
 *
 * The behavioral no-contract resume pin lives in
 * `test/integration/m2.5/resume.test.ts` ("a CLI resume of a run that started
 * without a contract invents none"). These unit pins guard the source side of
 * that rule and make a new episode reader cross an AST-level boundary if it
 * starts manufacturing `contract`, `constraints`, or `acceptanceCriteria`.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EPISODE_BIND = "src/run/episode-bind.ts";
const EPISODE_MODEL = "src/domain/episode.ts";
const FLOWCHART_CHECKPOINT_MODEL = "src/run/replay.ts";
const ORIGINAL_RUN_AUTHORITY_FIELDS = new Set(["acceptanceCriteria", "constraints", "contract"]);
const HOST_ACCEPTANCE_DECLARATIONS = new Map([
  [resolve(REPO_ROOT, "src/development/work-items.ts"), "WorkItemDefinition"],
  [resolve(REPO_ROOT, "src/native/write-session.ts"), "NativeWriteSessionResult"]
]);

type FunctionScope =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function listSourceModules(relativeDirectory: string): string[] {
  const modules: string[] = [];
  const pending = [relativeDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of readdirSync(resolve(REPO_ROOT, directory), { withFileTypes: true })) {
      const module = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(module);
      else if (entry.isFile() && entry.name.endsWith(".ts")) modules.push(module);
    }
  }
  return modules.sort();
}

function isFunctionScope(node: ts.Node): node is FunctionScope {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionScopes(parsed: ts.SourceFile): FunctionScope[] {
  const scopes: FunctionScope[] = [];
  function visit(node: ts.Node): void {
    if (isFunctionScope(node) && node.body !== undefined) scopes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return scopes;
}

function scopeName(scope: FunctionScope): string {
  if ("name" in scope && scope.name !== undefined) return scope.name.getText();
  const parent = scope.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

function propertyName(node: ts.Node): string | undefined {
  const name = (node as ts.Node & { readonly name?: ts.PropertyName | ts.BindingName }).name;
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function isPerTaskCriteriaFieldName(name: string): boolean {
  const normalized = name.replaceAll(/[^A-Za-z]/g, "").toLowerCase();
  return (
    (normalized.includes("task") || normalized.includes("child")) &&
    (normalized.includes("criteria") || normalized.includes("criterion"))
  );
}

function perTaskCriteriaCheckpointFields(): string[] {
  const parsed = parse(FLOWCHART_CHECKPOINT_MODEL, readSource(FLOWCHART_CHECKPOINT_MODEL));
  const checkpoint = parsed.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "FlowchartCheckpointState"
  );
  assert.ok(checkpoint, "the flowchart checkpoint state must remain structurally inspectable");
  return checkpoint.members
    .map((member) => propertyName(member))
    .filter((name): name is string => name !== undefined && isPerTaskCriteriaFieldName(name))
    .sort();
}

function isRunAuthorityField(name: string | undefined, checkpointCriteriaFields: ReadonlySet<string>): boolean {
  return (
    name !== undefined &&
    (ORIGINAL_RUN_AUTHORITY_FIELDS.has(name) ||
      checkpointCriteriaFields.has(name) ||
      isPerTaskCriteriaFieldName(name))
  );
}

function isNamedElementAccess(node: ts.Node, name: string): boolean {
  return (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === name
  );
}

function callName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return undefined;
}

function censusProgram(modules: readonly { readonly file: string; readonly source: string }[]): ts.Program {
  const sources = new Map(modules.map((module) => [resolve(REPO_ROOT, module.file), module.source]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: [],
    noEmit: true
  };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(resolve(file));
    return source === undefined
      ? getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, languageVersion, true);
  };
  return ts.createProgram([...sources.keys()], options, host);
}

function isDeclaredHostAcceptance(type: ts.Type, checker: ts.TypeChecker): boolean {
  // A union containing even one episode/unknown branch must keep the signal.
  if (type.isUnion()) return type.types.every((member) => isDeclaredHostAcceptance(member, checker));
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  const declarations = checker.getPropertyOfType(type, "acceptance")?.declarations;
  return declarations !== undefined && declarations.length > 0 && declarations.every((declaration) =>
    ts.isPropertySignature(declaration) && ts.isInterfaceDeclaration(declaration.parent) &&
    HOST_ACCEPTANCE_DECLARATIONS.get(resolve(declaration.getSourceFile().fileName)) === declaration.parent.name.text
  );
}

function hasAssertedReceiverOrigin(receiver: ts.Node, checker: ts.TypeChecker): boolean {
  const visiting = new Set<ts.Node>();
  const observed = new Map<ts.Node, boolean>();
  let remaining = 256;
  function inspect(node: ts.Node): boolean {
    // Destructuring gets the same provenance check as a direct property read.
    if (ts.isObjectBindingPattern(node) && ts.isVariableDeclaration(node.parent) &&
        node.parent.initializer !== undefined && visit(node.parent.initializer)) return true;
    // A local alias must not turn an asserted episode into a trusted DTO.
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      if (declarations.some((declaration) => {
        let local: ts.Node = declaration;
        while (ts.isBindingElement(local) || ts.isObjectBindingPattern(local) || ts.isArrayBindingPattern(local)) {
          if (ts.isBindingElement(local) && local.initializer !== undefined && visit(local.initializer)) return true;
          local = local.parent;
        }
        return ts.isVariableDeclaration(local) && local.initializer !== undefined && visit(local.initializer);
      })) return true;
    }
    return ts.forEachChild(node, (child) => visit(child) || undefined) === true;
  }
  function visit(node: ts.Node): boolean {
    const known = observed.get(node);
    if (known !== undefined) return known;
    if (--remaining < 0 || visiting.has(node)) return true;
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return true;
    visiting.add(node);
    try {
      const result = inspect(node);
      // The same initializer can be reached through many aliases/arguments.
      // Charge its AST once; cycles, assertions and exhaustion still refuse.
      observed.set(node, result);
      return result;
    } finally {
      visiting.delete(node);
    }
  }
  return visit(receiver);
}
function readsAcceptance(node: ts.Node, checker: ts.TypeChecker): boolean {
  let receiver: ts.Node | undefined;
  if ((ts.isPropertyAccessExpression(node) && node.name.text === "acceptance") ||
      isNamedElementAccess(node, "acceptance")) {
    receiver = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
  } else if (ts.isBindingElement(node)) {
    const key = node.propertyName ?? node.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === "acceptance") receiver = node.parent;
  }
  // Keep the broad census: only the two exact host declarations above establish
  // a different authority. Names, unresolved types and foreign DTOs do not.
  return receiver !== undefined &&
    (hasAssertedReceiverOrigin(receiver, checker) || !isDeclaredHostAcceptance(checker.getTypeAtLocation(receiver), checker));
}

function scopeSignals(
  scope: FunctionScope,
  checkpointCriteriaFields: ReadonlySet<string>,
  checker: ts.TypeChecker
): {
  readonly readsEpisode: boolean;
  readonly constructsContract: boolean;
} {
  let readsEpisode = false;
  let constructsContract = false;
  const body = scope.body;
  assert.ok(body !== undefined);

  function visit(node: ts.Node): void {
    if (node !== body && isFunctionScope(node)) return;

    if (
      readsAcceptance(node, checker) ||
      (ts.isIdentifier(node) && node.text === "ProjectEpisode") ||
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === "episode" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "payload")
    ) {
      readsEpisode = true;
    }

    if (
      (ts.isObjectLiteralExpression(node) &&
        node.properties.some((property) =>
          isRunAuthorityField(propertyName(property), checkpointCriteriaFields)
        )) ||
      (ts.isCallExpression(node) && /contract/i.test(callName(node) ?? "")) ||
      (ts.isIdentifier(node) && node.text === "RequirementContract") ||
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        isRunAuthorityField(node.name.text, checkpointCriteriaFields))
    ) {
      constructsContract = true;
    }

    ts.forEachChild(node, visit);
  }
  visit(body);
  return { readsEpisode, constructsContract };
}

function assertNoEpisodeContractSynthesis(
  modules: readonly { readonly file: string; readonly source: string }[],
  checkpointCriteriaFields: readonly string[] = perTaskCriteriaCheckpointFields()
): string[] {
  const readers: string[] = [];
  const violations: string[] = [];
  const criteriaFields = new Set(checkpointCriteriaFields);
  const program = censusProgram(modules);
  const checker = program.getTypeChecker();
  for (const module of modules) {
    const parsed = program.getSourceFile(resolve(REPO_ROOT, module.file));
    assert.ok(parsed, `the census must parse ${module.file}`);
    for (const scope of functionScopes(parsed)) {
      const signals = scopeSignals(scope, criteriaFields, checker);
      if (!signals.readsEpisode) continue;
      const location = `${module.file}:${scopeName(scope)}`;
      readers.push(location);
      if (signals.constructsContract) violations.push(location);
    }
  }
  assert.deepEqual(
    violations,
    [],
    "episode readers must not manufacture a run contract or present empty constraints as one"
  );
  return readers.sort();
}

function findFunction(parsed: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const found = parsed.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
  assert.ok(found, `${parsed.fileName} must still declare ${name}`);
  return found;
}

test("episode binding projects acceptance criteria only, never a run contract", () => {
  const binding = parse(EPISODE_BIND, readSource(EPISODE_BIND));
  const bind = findFunction(binding, "bindEpisodeToRun");
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "openEpisode"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(bind);

  assert.equal(calls.length, 1, "bindEpisodeToRun must open exactly one episode");
  const projection = calls[0]?.arguments[0];
  assert.ok(projection !== undefined && ts.isObjectLiteralExpression(projection));
  assert.deepEqual(
    projection.properties.map((property) => propertyName(property)),
    ["id", "projectId", "objective", "contractVersion", "acceptance"],
    "episode binding may project metadata and acceptance, but not contract or constraints"
  );
  const acceptance = projection.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property) === "acceptance"
  );
  assert.ok(acceptance, "the episode must retain its closure criteria");
  assert.equal(acceptance.initializer.getText(binding), "contract.acceptanceCriteria");

  const model = parse(EPISODE_MODEL, readSource(EPISODE_MODEL));
  const episode = model.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "ProjectEpisode"
  );
  assert.ok(episode, "ProjectEpisode must remain structurally inspectable");
  const fields = episode.members.map((member) => propertyName(member));
  assert.ok(fields.includes("acceptance"));
  assert.equal(fields.includes("contract"), false);
  assert.equal(fields.includes("constraints"), false);
  assert.equal(fields.includes("acceptanceCriteria"), false);
  assert.deepEqual(
    fields.filter((field): field is string => field !== undefined && isPerTaskCriteriaFieldName(field)),
    [],
    "ProjectEpisode must not grow a per-task criteria field parallel to the flowchart checkpoint"
  );
  const checkpointCriteriaFields = perTaskCriteriaCheckpointFields();
  assert.deepEqual(
    checkpointCriteriaFields,
    ["taskCriteria"],
    "the durable checkpoint sibling must stay explicit and covered by the episode boundary"
  );
  for (const checkpointField of checkpointCriteriaFields) {
    assert.equal(
      fields.includes(checkpointField),
      false,
      `ProjectEpisode must not expose the checkpoint's ${checkpointField} authority`
    );
  }
});

test("no source reader of episode data constructs a RequirementContract", () => {
  const readers = assertNoEpisodeContractSynthesis(
    listSourceModules("src").map((file) => ({ file, source: readSource(file) }))
  );
  assert.ok(readers.includes("src/run/episode-bind.ts:settleLockedEpisode"));
  assert.ok(readers.includes("src/cli/main.ts:inspectEpisode"));
  assert.ok(readers.includes("src/privacy/deletion.ts:episodeTextOf"));
});

const CONTROLLER_FIXTURE_FILE = "src/development/controller.ts";
const HOST_ACCEPTANCE_FIXTURE = `
  import type { WorkItemDefinition } from "./work-items.js";
  import type { NativeWriteSessionResult } from "../native/write-session.js";
  import type { ProjectEpisode as EpisodeAlias } from "../domain/episode.js";
  function runNext(selected: { item: WorkItemDefinition }, result: NativeWriteSessionResult) {
    const acceptanceCriteria = selected.item.acceptance;
    return { acceptanceCriteria, contract: result.acceptance };
  }
`;

test("the census distinguishes declared host recipes and verdicts from episode acceptance", () => {
  assert.deepEqual(assertNoEpisodeContractSynthesis([
    { file: CONTROLLER_FIXTURE_FILE, source: HOST_ACCEPTANCE_FIXTURE }
  ]), []);
});

test("the census reuses shared expression provenance without exhausting its bounded traversal", () => {
  const repeated = Array.from({ length: 180 }, () => "shared").join(", ");
  const source = `
    import type { NativeWriteSessionResult } from "../native/write-session.js";
    declare function hostResult(...inputs: readonly unknown[]): NativeWriteSessionResult;
    function runNext() {
      const shared = { nested: { safe: 1 } };
      const result = hostResult(${repeated});
      return { contract: result.acceptance };
    }
  `;
  assert.deepEqual(assertNoEpisodeContractSynthesis([
    { file: CONTROLLER_FIXTURE_FILE, source }
  ]), []);
  const asserted = source.replace("const shared = { nested: { safe: 1 } };", "const hidden = {} as unknown as NativeWriteSessionResult; const shared = { hidden };");
  assert.throws(() => assertNoEpisodeContractSynthesis([
    { file: CONTROLLER_FIXTURE_FILE, source: asserted }
  ]), assert.AssertionError, "memoization must not turn asserted aliases into trusted origins");
});
test("the same controller location still rejects real episodes and mixed receiver types", () => {
  for (const receiverType of ["EpisodeAlias", "WorkItemDefinition | EpisodeAlias"]) {
    for (const read of ["selected.item.acceptance", 'selected.item["acceptance"]']) {
      const source = HOST_ACCEPTANCE_FIXTURE
        .replace("item: WorkItemDefinition", `item: ${receiverType}`)
        .replace("selected.item.acceptance", read);
      assert.throws(() => assertNoEpisodeContractSynthesis([
        { file: CONTROLLER_FIXTURE_FILE, source }
      ]), assert.AssertionError, `${receiverType} via ${read}`);
    }
  }
});

test("renamed episode destructuring remains a source signal at the controller location", () => {
  const source = HOST_ACCEPTANCE_FIXTURE
    .replace("item: WorkItemDefinition", "item: EpisodeAlias")
    .replace("const acceptanceCriteria = selected.item.acceptance;", "const { acceptance: criteria } = selected.item;")
    .replace("return { acceptanceCriteria, contract: result.acceptance };", "return { acceptanceCriteria: criteria };");
  assert.throws(() => assertNoEpisodeContractSynthesis([
    { file: CONTROLLER_FIXTURE_FILE, source }
  ]), assert.AssertionError);
});

test("assertions and local aliases cannot cast episode data into the host exception", () => {
  for (const read of [
    "const { item: cast = selected.item as unknown as WorkItemDefinition } = {}; const acceptanceCriteria = cast.acceptance;",
    "const { item: cast } = { item: selected.item as unknown as WorkItemDefinition }; const acceptanceCriteria = cast.acceptance;",
    "const [{ item: cast }] = [{ item: selected.item as unknown as WorkItemDefinition }]; const acceptanceCriteria = cast.acceptance;",
    "const acceptanceCriteria = (selected.item as unknown as WorkItemDefinition).acceptance;",
    "const acceptanceCriteria = (<WorkItemDefinition><unknown>selected.item).acceptance;",
    "const cast = selected.item as unknown as WorkItemDefinition; const alias = cast; const acceptanceCriteria = alias.acceptance;",
    "const cast = selected.item as unknown as WorkItemDefinition; const { acceptance: acceptanceCriteria } = cast;",
    "const acceptanceCriteria = (selected.item satisfies WorkItemDefinition).acceptance;"
  ]) {
    const source = HOST_ACCEPTANCE_FIXTURE
      .replace("item: WorkItemDefinition", "item: EpisodeAlias")
      .replace("const acceptanceCriteria = selected.item.acceptance;", read);
    assert.throws(() => assertNoEpisodeContractSynthesis([
      { file: CONTROLLER_FIXTURE_FILE, source }
    ]), assert.AssertionError, read);
  }
});

test("unknown and same-name foreign DTO receivers do not gain the host exception", () => {
  for (const declaration of [
    "type WorkItemDefinition = any;",
    "interface WorkItemDefinition { acceptance: readonly unknown[] }"
  ]) {
    const source = HOST_ACCEPTANCE_FIXTURE.replace(
      'import type { WorkItemDefinition } from "./work-items.js";', declaration
    );
    assert.throws(() => assertNoEpisodeContractSynthesis([
      { file: CONTROLLER_FIXTURE_FILE, source }
    ]), assert.AssertionError, declaration);
  }
});

test("the source census rejects reconstruction and an empty-constraints claim", () => {
  const mutant = `
    interface ProjectEpisode { acceptance: readonly unknown[] }
    function resumeFromEpisode(episode: ProjectEpisode) {
      const acceptanceCriteria = episode.acceptance;
      return { schemaVersion: 1, acceptanceCriteria, constraints: [] };
    }
  `;
  assert.throws(
    () => assertNoEpisodeContractSynthesis([{ file: "src/run/resume-from-episode.ts", source: mutant }]),
    assert.AssertionError
  );
});

test("the source census rejects per-task criteria reconstructed from an episode", () => {
  const mutant = `
    interface ProjectEpisode { acceptance: readonly unknown[] }
    function resumeFromEpisode(episode: ProjectEpisode) {
      const taskCriteria = [{ taskId: "child", acceptanceCriteria: episode.acceptance }];
      return { taskCriteria };
    }
  `;
  assert.throws(
    () => assertNoEpisodeContractSynthesis([{ file: "src/run/resume-from-episode.ts", source: mutant }]),
    assert.AssertionError
  );
});

test("a persisted episode contains criteria but none of the supplied contract constraints", async () => {
  const stateRoot = await mkdtemp(resolve(tmpdir(), "pi-sparkle-episode-contract-boundary-"));
  try {
    const runId = createRunId();
    const contract: RequirementContract = {
      schemaVersion: 1,
      objective: "keep the run contract authoritative",
      deliverables: [],
      constraints: [
        {
          id: "never-project-this",
          description: "the episode must not become the run constraint authority",
          enforceable: true
        }
      ],
      nonGoals: [],
      acceptanceCriteria: [
        {
          id: "episode-close",
          description: "the episode may retain this criterion",
          observableCheck: "the run completes"
        }
      ],
      assumptions: [],
      questions: [],
      authority: [],
      sourceRefs: []
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: contract.objective,
      contract,
      skipContract: false,
      append: async () => undefined,
      make: (type, payload) =>
        ({
          id: createEventId(),
          schemaVersion: 1,
          occurredAt: nowIso(),
          runId,
          type,
          actor: "test",
          payload
        }) as Event
    });
    const snapshot = (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.acceptance, contract.acceptanceCriteria);
    assert.equal(Object.hasOwn(snapshot, "contract"), false);
    assert.equal(Object.hasOwn(snapshot, "constraints"), false);
    assert.equal(Object.hasOwn(snapshot, "acceptanceCriteria"), false);
    assert.deepEqual(
      Object.keys(snapshot).filter(isPerTaskCriteriaFieldName),
      [],
      "the persisted episode must not acquire checkpoint per-task criteria authority"
    );
    for (const checkpointField of perTaskCriteriaCheckpointFields()) {
      assert.equal(Object.hasOwn(snapshot, checkpointField), false);
    }
    assert.deepEqual(bound.contract, contract);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a shorthand default initializer keeps its own asserted origin", () => {
  const source = `import type { NativeWriteSessionResult } from "../native/write-session.js";
    declare function hostResult(...inputs: readonly unknown[]): NativeWriteSessionResult;
    function runNext() {
      const unsafeAlias = {} as unknown as NativeWriteSessionResult;
      let selected;
      const plain = {};
      const result = hostResult(({ selected = unsafeAlias } = plain));
      return { contract: result.acceptance };
    }`;
  assert.throws(() => assertNoEpisodeContractSynthesis([
    { file: CONTROLLER_FIXTURE_FILE, source }
  ]), assert.AssertionError, "default initializer identifiers must resolve their own symbols");
});
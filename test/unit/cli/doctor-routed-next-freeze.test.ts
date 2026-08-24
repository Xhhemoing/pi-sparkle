import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const MAIN_PATH = fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url));
const MAIN_SOURCE = readFileSync(MAIN_PATH, "utf8");
const DOCTOR_EXPRESSION = "${doctor}";

const EXPECTED_GENERIC_FAILURE_NEXT =
  "fix the reported error, then retry; use pi-sparkle doctor for preflight";

const EXPECTED_DOCTOR_ROUTED_NEXT = [
  [
    "LOCK_TIMEOUT_CODE",
    `the lock is held and pi-sparkle never steals one: run ${DOCTOR_EXPRESSION} and read locks[] for the holder's pid, age and remediation, then retry`
  ],
  [
    "RUN_RECORDS_SURVIVED_CODE",
    `the run's records are still on disk: run ${DOCTOR_EXPRESSION} and read runStates[] for a live run and locks[] for its lock, stop that run, then delete again`
  ],
  [
    "BANDIT_STATE_UNREADABLE_CODE",
    `this project's learned bandit state is damaged and no log can recompute it: run ${DOCTOR_EXPRESSION} and read learnedState[] for the file and its learned-state remediation, then repair it or move it aside to relearn this project from zero`
  ],
  [
    "PREFERENCE_SNAPSHOT_UNREADABLE_CODE",
    `the learned preference snapshot is damaged and has no second copy on disk: run ${DOCTOR_EXPRESSION} and read learnedState[] for the file and its learned-state remediation, then repair it or move it aside to start from an empty store`
  ],
  [
    "CATALOG_OBSERVED_CORRUPT_CODE",
    `the observed catalog snapshot is damaged, and it is derived state: run ${DOCTOR_EXPRESSION} and read learnedState[] for the file and its derived-state remediation, then delete it and let it rebuild from runtime/invocations.jsonl`
  ]
] as const;

function parseMain(source: string): ts.SourceFile {
  return ts.createSourceFile(MAIN_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function constInitializer(parsed: ts.SourceFile, name: string): ts.Expression {
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        assert.ok(declaration.initializer, `${name} must have an initializer`);
        return declaration.initializer;
      }
    }
  }
  assert.fail(`${name} must remain a top-level constant in src/cli/main.ts`);
}

function doctorRouteArray(parsed: ts.SourceFile): ts.ArrayLiteralExpression {
  const initializer = constInitializer(parsed, "DOCTOR_ROUTED_NEXT");
  assert.ok(ts.isNewExpression(initializer), "DOCTOR_ROUTED_NEXT must remain a Map");
  assert.ok(
    ts.isIdentifier(initializer.expression) && initializer.expression.text === "Map",
    "DOCTOR_ROUTED_NEXT must remain a Map"
  );
  assert.equal(initializer.arguments?.length, 1, "DOCTOR_ROUTED_NEXT must have one entry array");
  const entries = initializer.arguments?.[0];
  assert.ok(
    entries !== undefined && ts.isArrayLiteralExpression(entries),
    "DOCTOR_ROUTED_NEXT must have an entry array"
  );
  return entries;
}

function routeWording(entry: ts.Expression, index: number): readonly [string, string] {
  assert.ok(ts.isArrayLiteralExpression(entry), `doctor route ${index} must remain a tuple`);
  assert.equal(entry.elements.length, 2, `doctor route ${index} must remain a key/renderer pair`);

  const [key, renderer] = entry.elements;
  assert.ok(key !== undefined && ts.isIdentifier(key), `doctor route ${index} must use a code key`);
  assert.ok(
    renderer !== undefined && ts.isArrowFunction(renderer),
    `${key.text} must use a route renderer`
  );
  assert.equal(renderer.parameters.length, 1, `${key.text} must take only doctor`);
  const parameter = renderer.parameters[0];
  assert.ok(
    parameter !== undefined &&
      ts.isIdentifier(parameter.name) &&
      parameter.name.text === "doctor",
    `${key.text} must take doctor`
  );
  assert.ok(ts.isTemplateExpression(renderer.body), `${key.text} must interpolate doctor`);
  assert.equal(renderer.body.templateSpans.length, 1, `${key.text} must interpolate doctor once`);
  const span = renderer.body.templateSpans[0];
  assert.ok(
    span !== undefined && ts.isIdentifier(span.expression) && span.expression.text === "doctor",
    `${key.text} must interpolate the doctor argument`
  );

  return [key.text, renderer.body.head.text + DOCTOR_EXPRESSION + span.literal.text];
}

function assertFrozenDoctorNext(source: string): void {
  const parsed = parseMain(source);
  const generic = constInitializer(parsed, "GENERIC_FAILURE_NEXT");
  assert.ok(
    ts.isStringLiteralLike(generic),
    "GENERIC_FAILURE_NEXT must remain a character-exact string"
  );
  assert.equal(generic.text, EXPECTED_GENERIC_FAILURE_NEXT);

  const actualRoutes = doctorRouteArray(parsed).elements.map(routeWording);
  assert.deepEqual(actualRoutes, EXPECTED_DOCTOR_ROUTED_NEXT);
}

function deleteRoute(source: string, routeKey: string): string {
  const parsed = parseMain(source);
  const entry = doctorRouteArray(parsed).elements.find(
    (candidate) =>
      ts.isArrayLiteralExpression(candidate) &&
      candidate.elements.some(
        (element, index) => index === 0 && ts.isIdentifier(element) && element.text === routeKey
      )
  );
  assert.ok(entry, `mutation target ${routeKey} must exist`);
  return source.slice(0, entry.getStart(parsed)) + source.slice(entry.getEnd());
}

test("generic failure and the five doctor-routed next strings stay character-exact", () => {
  assertFrozenDoctorNext(MAIN_SOURCE);
});

test("the freeze fails when the defense-in-depth catalog route is deleted", () => {
  const mutant = deleteRoute(MAIN_SOURCE, "CATALOG_OBSERVED_CORRUPT_CODE");
  assert.throws(() => assertFrozenDoctorNext(mutant), assert.AssertionError);
});

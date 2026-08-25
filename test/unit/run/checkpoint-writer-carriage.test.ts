import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const SOURCE_ROOT = fileURLToPath(new URL("../../../src/", import.meta.url));

interface Writer {
  readonly location: string;
  readonly payload: ts.Expression;
}

function sourceModules(directory: string): string[] {
  const modules: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...sourceModules(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) modules.push(path);
  }
  return modules.sort();
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return parent;
  }
  return undefined;
}

function resolvePayloadInitializer(
  parsed: ts.SourceFile,
  call: ts.CallExpression,
  payload: ts.Expression
): ts.Expression {
  if (!ts.isIdentifier(payload)) return payload;

  const payloadName = payload.text;
  const scope = enclosingFunction(call);
  assert.ok(scope, "materializeCheckpoint flowchart payload is written inside a function");
  const declarations: ts.VariableDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (node !== scope && ts.isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === payloadName &&
      node.initializer !== undefined &&
      node.getStart(parsed) < call.getStart(parsed)
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(scope);
  declarations.sort((left, right) => right.getStart(parsed) - left.getStart(parsed));
  const initializer = declarations[0]?.initializer;
  assert.ok(initializer, `flowchart payload ${payloadName} must have an inspectable local initializer`);
  return initializer;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
  ) {
    return node.name.text;
  }
  return undefined;
}

function carriesProperty(payload: ts.Expression, field: string): boolean {
  let carries = false;
  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralElementLike(node) && propertyName(node) === field) {
      carries = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(payload);
  return carries;
}

function mentionsField(payload: ts.Expression, field: string): boolean {
  let mentions = false;
  function visit(node: ts.Node): void {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === field) {
      mentions = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(payload);
  return mentions;
}

function flowchartPayloadWriters(): Writer[] {
  const writers: Writer[] = [];
  for (const path of sourceModules(SOURCE_ROOT)) {
    const parsed = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "materializeCheckpoint" &&
        node.arguments[2] !== undefined
      ) {
        const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
        writers.push({
          location: `${relative(SOURCE_ROOT, path)}:${line}`,
          payload: resolvePayloadInitializer(parsed, node, node.arguments[2])
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(parsed);
  }
  return writers;
}

test("every flowchart checkpoint writer carries its durable authority properties", () => {
  const writers = flowchartPayloadWriters();
  assert.ok(writers.length > 0, "the source census must find flowchart-payload writers");
  assert.ok(
    writers.some(({ payload }) => carriesProperty(payload, "taskCriteria")),
    "the source census must find a taskCriteria writer"
  );

  for (const writer of writers) {
    assert.equal(
      carriesProperty(writer.payload, "contract"),
      true,
      `${writer.location}: every flowchart-payload writer carries contract`
    );

    if (mentionsField(writer.payload, "taskCriteria")) {
      assert.equal(
        carriesProperty(writer.payload, "taskCriteria"),
        true,
        `${writer.location}: a flowchart payload that mentions taskCriteria carries it as a property`
      );
    }
  }
});

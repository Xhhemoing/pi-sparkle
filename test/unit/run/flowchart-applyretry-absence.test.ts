import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const FLOWCHART_SOURCES = [
  "../../../src/run/flowchart-run.ts",
  "../../../src/supervisor/flowchart-supervisor.ts"
] as const;

function assertNoSchedulerRetry(fileName: string, source: string): void {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
      node.text === "applyRetry"
    ) {
      violations.push("references applyRetry");
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      /(^|\/)scheduler\.js$/.test(node.moduleSpecifier.text)
    ) {
      violations.push(`imports ${node.moduleSpecifier.text}`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) =>
          ts.isStringLiteralLike(argument) && /(^|\/)scheduler\.js$/.test(argument.text)
      )
    ) {
      violations.push("dynamically imports scheduler.js");
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  assert.deepEqual(
    violations,
    [],
    `${fileName} must reopen FlowNodeState through its own state machine, not scheduler applyRetry`
  );
}

test("the flowchart plane neither imports scheduler nor references applyRetry", () => {
  for (const relativePath of FLOWCHART_SOURCES) {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    assertNoSchedulerRetry(relativePath, readFileSync(path, "utf8"));
  }
});

test("the absence pin rejects scheduler imports and a reopen helper that calls applyRetry", () => {
  assert.throws(
    () =>
      assertNoSchedulerRetry(
        "flowchart-run.ts",
        'import * as scheduler from "./scheduler.js";\nexport const untouched = true;\n'
      ),
    assert.AssertionError,
    "a namespace import must cross the pinned import-graph boundary"
  );
  assert.throws(
    () =>
      assertNoSchedulerRetry(
        "flowchart-supervisor.ts",
        "function reopenFailedNode(node: unknown) { return applyRetry(node); }\n"
      ),
    assert.AssertionError,
    "a future reopen helper must not call the DAG scheduler retry transition"
  );
});

test("discard and reopen identifiers remain under the whole-file scheduler absence pin", () => {
  const discardOrReopen = /discard|reopenAfterUnblock/i;
  for (const relativePath of FLOWCHART_SOURCES) {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = readFileSync(path, "utf8");
    const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const markers: string[] = [];
    function visit(node: ts.Node): void {
      if (
        (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
        discardOrReopen.test(node.text)
      ) {
        markers.push(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(
      markers.length > 0,
      `${relativePath} must retain a discard / WITH_DISCARD / reopenAfterUnblock identifier`
    );
    assertNoSchedulerRetry(relativePath, source);
  }
});

test("restore-side discard validation remains under the whole-file scheduler absence pin", () => {
  const relativePath = FLOWCHART_SOURCES[0];
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, "utf8");
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const restoreConsumers = new Set(["applyClearingEvent", "restoreCheckpointedSupervisor"]);
  const validatingConsumers: string[] = [];

  for (const statement of parsed.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.name === undefined ||
      !restoreConsumers.has(statement.name.text)
    ) {
      continue;
    }
    let validatesDiscardAudit = false;
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "assertDiscardAuditMatchesLog"
      ) {
        validatesDiscardAudit = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(statement);
    if (validatesDiscardAudit) validatingConsumers.push(statement.name.text);
  }

  assert.ok(
    validatingConsumers.length > 0,
    "applyClearingEvent or its restore caller must validate the recorded discard audit against the log"
  );
  assertNoSchedulerRetry(relativePath, source);
});

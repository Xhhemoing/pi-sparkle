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

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const SRC_ROOT = fileURLToPath(new URL("../../../src/", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), "utf8");
}

function listModules(directory = ""): string[] {
  return readdirSync(join(SRC_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = posix.join(directory, entry.name);
    if (entry.isDirectory()) return listModules(relativePath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [relativePath] : [];
  });
}

/** Static value dependencies only: dynamic imports remain intentional lazy boundaries. */
function valueSpecifiers(text: string): string[] {
  const parsed = ts.createSourceFile("boundary.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return parsed.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly === true) return [];
      return ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [];
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier !== undefined) {
      return ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [];
    }
    return [];
  });
}

test("static dependency walker preserves runtime forms without treating comments or types as edges", () => {
  assert.deepEqual(valueSpecifiers(`
    // import { example } from "./comment.js";
    import type { Erased } from "./type.js";
    export type { AlsoErased } from "./export-type.js";
    import "./side-effect.js";
    import { type Inline } from "./inline.js";
    export { value } from "./forwarder.js";
    const lazy = import("./lazy.js");
  `), ["./side-effect.js", "./inline.js", "./forwarder.js"]);
});

test("source static value imports contain no file cycle", () => {
  const modules = new Set(listModules());
  const edges = new Map([...modules].map((module) => [
    module,
    valueSpecifiers(source(module)).flatMap((specifier) => {
      if (!specifier.startsWith(".")) return [];
      const path = posix.normalize(posix.join(posix.dirname(module), specifier));
      const stem = path.endsWith(".js") ? path.slice(0, -3) : path;
      const target = [`${stem}.ts`, posix.join(stem, "index.ts")].find((candidate) => modules.has(candidate));
      return target === undefined ? [] : [target];
    })
  ]));
  const active = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];
  const visit = (module: string, chain: readonly string[]): void => {
    if (active.has(module)) {
      cycles.push([...chain.slice(chain.indexOf(module)), module].join(" -> "));
      return;
    }
    if (visited.has(module)) return;
    active.add(module);
    for (const target of edges.get(module) ?? []) visit(target, [...chain, module]);
    active.delete(module);
    visited.add(module);
  };
  for (const module of modules) visit(module, []);
  assert.deepEqual(cycles, [], "static value import cycles reintroduce initialization coupling");
});

test("preference commands consume shared options without loading main", () => {
  const pref = source("cli/pref.ts");
  assert.match(pref, /from "\.\/options\.js"/);
  assert.doesNotMatch(pref, /from "\.\/main\.js"/);
});

test("native and tracking catalog consumers do not reach through CLI", () => {
  for (const module of ["native/routing-catalog.ts", "track/loop.ts"]) {
    const text = source(module);
    assert.match(text, /from "\.\.\/routing\/model-catalog\.js"/, module);
    assert.doesNotMatch(text, /from "\.\.\/cli\/model-catalog\.js"/, module);
  }
});

test("state layout belongs to persist and privacy remains a compatibility forwarder", () => {
  assert.ok(existsSync(join(SRC_ROOT, "persist/state-layout.ts")), "foundational layout module is missing");
  const layout = source("persist/state-layout.ts");
  assert.deepEqual(valueSpecifiers(layout), ["node:path"], "layout must stay independent of record readers");
  assert.match(source("privacy/state-layout.ts"), /from "\.\.\/persist\/state-layout\.js"/);
  assert.doesNotMatch(source("privacy/state-layout.ts"), /function\s+(?:runtimeRoot|adaptationRoot)\b/);
});

#!/usr/bin/env node
/** Informational source analysis, never an execution trace or a size gate. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  ["product", "src/development/start-task.ts"],
  ["product", "src/native/core-session.ts"],
  ["product", "src/pi-adapter/pi-executor.ts"],
  ["product", "extensions/pi-sparkle/index.ts"],
  ["product", "src/cli/main.ts"],
  ["legacy", "src/native/session.ts"],
  ["lab", "src/lab/flowchart.ts"],
  ["lab", "src/lab/cli.ts"]
];
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const included = (file) => /^(src|extensions|lab)\//.test(relative(file)) &&
  /\.(?:ts|tsx|mts|cts)$/.test(file) && !/\.d\.(?:ts|mts|cts)$/.test(file);
const host = {
  fileExists: (file) => included(file) && fs.existsSync(file),
  // Resolution must not scan installed packages or their package.json files.
  readFile: (file) => included(file) && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined
};
const resolutionOptions = { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext };
const graph = new Map();
const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
function hasValueSpecifiers(clause) {
  return !clause || (!ts.isNamedExports(clause) && !ts.isNamedImports(clause)) ||
    clause.elements.length === 0 || clause.elements.some((element) => !element.isTypeOnly);
}
function read(file) {
  if (graph.has(file)) return graph.get(file);
  const text = fs.readFileSync(path.resolve(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result = { edges: [], unresolved: [], computedDynamics: 0,
    physicalLOC: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length - Number(/(?:\r\n|\r|\n)$/.test(text)) };
  function add(specifier, dynamic) {
    if (!specifier.startsWith(".")) return;
    const resolved = ts.resolveModuleName(specifier, path.resolve(root, file), resolutionOptions, host).resolvedModule;
    if (!resolved || !included(resolved.resolvedFileName)) {
      result.unresolved.push({ specifier, dynamic });
      return;
    }
    result.edges.push({ target: relative(resolved.resolvedFileName), dynamic });
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause?.isTypeOnly && (!clause || clause.name || hasValueSpecifiers(clause.namedBindings))) {
        add(node.moduleSpecifier.text, false);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && hasValueSpecifiers(node.exportClause)) {
      add(node.moduleSpecifier.text, false);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) && literal(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text, false);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (literal(node.arguments[0])) add(node.arguments[0].text, true);
      else result.computedDynamics++;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, result);
  return result;
}
function closure(entry, includeDynamics) {
  const visited = new Set([entry]);
  const queue = [entry];
  for (const file of queue) for (const edge of read(file).edges) {
    if ((!edge.dynamic || includeDynamics) && !visited.has(edge.target)) {
      visited.add(edge.target);
      queue.push(edge.target);
    }
  }
  const pathsByDirectory = {};
  for (const name of ["learning", "adaptation", "experiments", "evaluation"]) {
    pathsByDirectory[name] = queue.filter((file) => file.startsWith(`src/${name}/`)).sort();
  }
  pathsByDirectory.lab = queue.filter((file) => file.startsWith("lab/") || file.startsWith("src/lab/")).sort();
  return {
    files: queue.length,
    physicalLOC: queue.reduce((sum, file) => sum + read(file).physicalLOC, 0),
    pathsByDirectory,
    computedDynamicImportsNotFollowed: queue.reduce((sum, file) => sum + read(file).computedDynamics, 0),
    unresolvedRelativeImports: queue.flatMap((file) => read(file).unresolved
      .filter((item) => !item.dynamic || includeDynamics).map((item) => ({ file, ...item })))
  };
}
console.log("Import closure: informational source analysis; no thresholds; not resolved or executed-module counts.");
console.log("Scope: repository-relative TS/TSX/MTS/CTS in src/, extensions/, lab/ only; declaration files and explicit type-only edges excluded; installed package source is not traversed.");
console.log("static-value follows value imports/re-exports/import-equals; possible-literal-dynamic additionally follows literal import() (including expression-free templates). Bare aliases, require() and computed dynamics are not followed.");
console.log("Physical LOC includes blank lines, excludes the phantom trailing line. Directory categories do not classify safety code as removable research: evaluation findings and evidence retention remain required.");
try {
  for (const [kind, entry] of entries) {
    for (const includeDynamics of [false, true]) {
      console.log(JSON.stringify({ kind, entry, mode: includeDynamics ? "possible-literal-dynamic" : "static-value",
        ...closure(entry, includeDynamics) }));
    }
  }
} catch {
  // Keep machine-local absolute paths out of CI output, including read errors.
  console.error("Import closure reporting failed; check that the listed repository entry modules are readable.");
  process.exitCode = 1;
}

#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ADAPTER_ROOT = join(REPO_ROOT, "src", "pi-adapter");
const REQUIRED_PINS = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai"
];
const FORBIDDEN_IDENTIFIER = /\bGoogleThinkingLevel\b/;
const IMPORT_DECLARATION = /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const THINKING_LEVEL = /\bThinkingLevel\b/;
const THINKING_LEVEL_SOURCE = "@earendil-works/pi-agent-core";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files.sort();
}

function printPass(message) {
  console.log(`PASS ${message}`);
}

function printFail(message) {
  console.log(`FAIL ${message}`);
}

async function readPins() {
  const packageJson = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8"));
  if (
    packageJson === null ||
    typeof packageJson !== "object" ||
    packageJson.dependencies === null ||
    typeof packageJson.dependencies !== "object"
  ) {
    return {};
  }
  return packageJson.dependencies;
}

export async function main() {
  let failed = false;
  let pins = {};
  try {
    pins = await readPins();
  } catch (error) {
    printFail(`could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }

  for (const packageName of REQUIRED_PINS) {
    const pin = pins[packageName];
    if (typeof pin === "string" && pin.trim() !== "") {
      printPass(`pin ${packageName}: ${pin}`);
    } else {
      printFail(`pin ${packageName}: missing from dependencies`);
      failed = true;
    }
  }

  let files;
  try {
    files = await sourceFiles(ADAPTER_ROOT);
  } catch (error) {
    printFail(
      `could not read src/pi-adapter: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  const sources = await Promise.all(
    files.map(async (path) => ({ path, text: await readFile(path, "utf8") }))
  );
  const forbiddenMatches = sources
    .filter(({ text }) => FORBIDDEN_IDENTIFIER.test(text))
    .map(({ path }) => relative(REPO_ROOT, path));
  if (forbiddenMatches.length === 0) {
    printPass("legacy identifier GoogleThinkingLevel is absent from src/pi-adapter");
  } else {
    printFail(
      `legacy identifier GoogleThinkingLevel found in ${forbiddenMatches.join(", ")}`
    );
    failed = true;
  }

  const thinkingLevelImports = [];
  for (const { path, text } of sources) {
    for (const match of text.matchAll(IMPORT_DECLARATION)) {
      if (THINKING_LEVEL.test(match[1])) {
        thinkingLevelImports.push({
          path: relative(REPO_ROOT, path),
          source: match[2]
        });
      }
    }
  }

  const invalidImports = thinkingLevelImports.filter(
    ({ source }) => source !== THINKING_LEVEL_SOURCE
  );
  if (invalidImports.length === 0) {
    printPass(
      `ThinkingLevel imports use ${THINKING_LEVEL_SOURCE} only (${thinkingLevelImports.length} found)`
    );
  } else {
    printFail(
      `ThinkingLevel imported outside ${THINKING_LEVEL_SOURCE}: ${invalidImports
        .map(({ path, source }) => `${path} from ${source}`)
        .join(", ")}`
    );
    failed = true;
  }

  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

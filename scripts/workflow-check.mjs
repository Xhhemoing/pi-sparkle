#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : repoRoot);

const requiredFiles = [
  "AGENTS.md",
  "docs/development-workflow.md",
  "docs/templates/task-plan.md",
  "docs/templates/verification-record.md",
  "tasks/README.md",
  "tasks/plan.md",
  "tasks/todo.md",
  "docs/status-matrix.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "package.json"
];

const requiredHeadings = new Map([
  ["AGENTS.md", ["## Operating Rules", "## Required Evidence", "## Test and Delivery Policy"]],
  ["docs/development-workflow.md", ["## 1. Intake and Classification", "## 4. Test-First Implementation", "## 5. Verification Gates", "## 7. Closeout and Handoff"]],
  ["tasks/README.md", ["## Authoritative Files", "## Required Task Record", "## State Rules"]],
  ["docs/templates/task-plan.md", ["## Acceptance Criteria", "## Test-First Plan", "## Closeout"]],
  ["docs/templates/verification-record.md", ["## Commands", "## Behavioral Evidence", "## Handoff"]]
]);

const failures = [];
const contents = new Map();

for (const relativePath of requiredFiles) {
  try {
    const content = await readFile(join(root, relativePath), "utf8");
    contents.set(relativePath, content.replaceAll("\r\n", "\n"));
  } catch {
    failures.push(`missing required file: ${relativePath}`);
  }
}

for (const [relativePath, headings] of requiredHeadings) {
  const content = contents.get(relativePath);
  if (!content) continue;
  for (const heading of headings) {
    if (!content.includes(heading)) failures.push(`missing required heading in ${relativePath}: ${heading}`);
  }
}

const packageJson = contents.get("package.json");
if (packageJson) {
  try {
    const packageData = JSON.parse(packageJson);
    const scripts = packageData.scripts ?? {};
    if (typeof scripts["workflow:check"] !== "string") {
      failures.push("package.json must define scripts.workflow:check");
    }
    if (typeof scripts.gate !== "string" || !scripts.gate.includes("pnpm workflow:check")) {
      failures.push("package.json scripts.gate must run pnpm workflow:check");
    }
  } catch {
    failures.push("package.json is not valid JSON");
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`workflow-check: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`workflow-check: ok (${requiredFiles.length} required files, ${[...requiredHeadings.values()].flat().length} required headings)`);
}

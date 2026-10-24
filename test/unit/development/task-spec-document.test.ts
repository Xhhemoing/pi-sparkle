import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { parseDevelopmentTaskDocument } from "../../../src/development/task-spec-document.js";

const value = {
  version: 1, objective: "Repair the scoped value", context: ["src/value.ts"],
  write: { allow: ["src"], protect: ["checks"] },
  prepare: [{ id: "deps", command: "node", args: ["--flag", "$(literal)", "a && b", "你好"] }],
  checks: [{ id: "regression", command: "node", args: ["checks/value.mjs"], verifierVersion: "v1",
    protectedPaths: ["checks"], visibleToWorker: false, expect: { baseline: "pass" } }],
  budget: { totalSeconds: 30, prepareSeconds: 60, checkSeconds: 40, workerSeconds: 120, workerTotalSeconds: 0.401 }
};
const yaml = [
  "# A host-reviewed YAML 1.2 task",
  "version: 1",
  "objective: Repair the scoped value",
  "context: [src/value.ts]",
  "write:",
  "  allow: [src]",
  "  protect: [checks]",
  "prepare:",
  "  - id: deps",
  "    command: node",
  '    args: ["--flag", "$(literal)", "a && b", "你好"]',
  "checks:",
  "  - id: regression",
  "    command: node",
  "    args: [checks/value.mjs]",
  "    verifierVersion: v1",
  "    protectedPaths: [checks]",
  "    visibleToWorker: false",
  "    expect: {baseline: pass}",
  "budget:",
  "  totalSeconds: 30",
  "  prepareSeconds: 60",
  "  checkSeconds: 40",
  "  workerSeconds: 120",
  "  workerTotalSeconds: 0.401",
  ""
].join("\n");

test("YAML and JSON normalize to the same immutable TaskSpec with literal argv and millisecond limits", () => {
  const parsed = parseDevelopmentTaskDocument(yaml, "yaml");
  assert.deepEqual(parsed, parseDevelopmentTaskSpec(JSON.stringify(value)));
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.prepare[0]!.args));
  assert.equal(parsed.budget.workerTotalSeconds, 0.401);
  assert.deepEqual(parsed.prepare[0]!.args, ["--flag", "$(literal)", "a && b", "你好"]);
});

test("YAML block text and YAML 1.2 plain scalars preserve intended strings", () => {
  const block = yaml.replace("objective: Repair the scoped value", "objective: |-\n  Fix 你好\n  Keep literal $(command)");
  assert.equal(parseDevelopmentTaskDocument(block, "yaml").objective, "Fix 你好\nKeep literal $(command)");
  for (const literal of ["yes", "on", "off", "2026-10-24"]) {
    assert.equal(parseDevelopmentTaskDocument(yaml.replace("Repair the scoped value", literal), "yaml").objective, literal);
  }
});

test("YAML preserves the same optional reference USD allowance as JSON", () => {
  for (const usd of [0.7, 1e-7, Number.MIN_VALUE]) {
    const parsed = parseDevelopmentTaskDocument(yaml + "  usd: " + usd + "\n", "yaml");
    assert.deepEqual(parsed, parseDevelopmentTaskSpec(JSON.stringify({ ...value, budget: { ...value.budget, usd } })));
    assert.equal(parsed.budget.usd, usd);
  }
});

test("JSON remains the default and never silently falls back to YAML", () => {
  const json = JSON.stringify(value);
  assert.deepEqual(parseDevelopmentTaskDocument(json), parseDevelopmentTaskSpec(json));
  assert.deepEqual(parseDevelopmentTaskDocument(json, "json"), parseDevelopmentTaskSpec(json));
  assert.deepEqual(parseDevelopmentTaskDocument(json, "yaml"), parseDevelopmentTaskSpec(json));
  assert.throws(() => parseDevelopmentTaskDocument(yaml), DomainValidationError);
});

const refused: [string, string][] = [
  ["duplicate root key", yaml + "version: 1\n"],
  ["duplicate nested key", yaml.replace("  checkSeconds: 40", "  checkSeconds: 40\n  checkSeconds: 40")],
  ["multiple documents", yaml + "---\nversion: 2\n"],
  ["empty second document", yaml + "---\n"],
  ["YAML 1.1 directive", "%YAML 1.1\n---\n" + yaml],
  ["aliases", yaml.replace("context: [src/value.ts]", "context: &ctx [src/value.ts]").replace("allow: [src]", "allow: *ctx")],
  ["recursive aliases", yaml.replace("context: [src/value.ts]", "context: &ctx [*ctx]")],
  ["merge mapping", yaml.replace("  allow: [src]", "  <<: {allow: [src]}")],
  ["custom tag", yaml.replace("Repair the scoped value", "!private PRIVATE_TEXT")],
  ["object constructor tag", yaml.replace("Repair the scoped value", "!!js/function 'function(){return 1}'")],
  ["non-string map key", yaml.replace("version: 1", "? [version]\n: 1")],
  ["nonfinite budget", yaml.replace("totalSeconds: 30", "totalSeconds: .inf")],
  ["NaN budget", yaml.replace("totalSeconds: 30", "totalSeconds: .nan")],
  ["string budget", yaml.replace("totalSeconds: 30", 'totalSeconds: "30"')],
  ["unknown field", yaml + "shell: true\n"],
  ["private key", yaml + "PRIVATE_YAML_SOURCE_CONTENT_MUST_NOT_REACH_DIAGNOSTICS: true\n"],
  ["inherited fields", yaml.replace("version: 1", "__proto__: {version: 1}")],
  ["malformed sequence", yaml.replace("context: [src/value.ts]", "context: [src/value.ts")],
  ["empty document", "# no task\n"],
  ["oversized UTF-8 document", yaml + "#" + "你".repeat(22000)]
];
for (const [name, input] of refused) test("YAML refuses " + name + " before TaskSpec execution", () => {
  assert.throws(() => parseDevelopmentTaskDocument(input, "yaml"), (error: unknown) => {
    assert.ok(error instanceof DomainValidationError);
    assert.doesNotMatch(error.message, /PRIVATE_TEXT|PRIVATE_YAML_SOURCE_CONTENT_MUST_NOT_REACH_DIAGNOSTICS/);
    return true;
  });
});

test("text and format arguments remain bounded ordinary inputs", () => {
  assert.throws(() => parseDevelopmentTaskDocument({} as string, "yaml"), DomainValidationError);
  assert.throws(() => parseDevelopmentTaskDocument(JSON.stringify(value), "automatic" as "yaml"), DomainValidationError);
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// This consumer-level check catches loss of real host attempts, excluded spend,
// source isolation or the privacy boundary in the executable example.
test("synthetic dataset example executes host acceptance, repair and exclusions without changing its source", async () => {
  const example = new URL("../../../examples/host-routing-dataset.ts", import.meta.url);
  assert.equal(existsSync(example), true, "the executable synthetic consumer must exist");
  const { runHostRoutingDatasetExample, hostRoutingDatasetMain }: typeof import("../../../examples/host-routing-dataset.js") = await import(example.href);
  await assert.rejects(() => hostRoutingDatasetMain(["--provider=paid"]), /no arguments/);
  const { outputPath, dataset } = await runHostRoutingDatasetExample();
  assert.ok(path.resolve(outputPath).startsWith(path.resolve(".agent_workspace") + path.sep));
  const serialized = await readFile(outputPath, "utf8");
  assert.deepEqual(JSON.parse(serialized), JSON.parse(JSON.stringify(dataset)));
  assert.equal(dataset.evidenceMode, "synthetic");
  assert.deepEqual([...new Set(dataset.rows.map((row) => row.declaration?.problemId))], ["value-good"]);
  assert.deepEqual([...new Set(dataset.rows.map((row) => row.declaration?.templateId))], ["single-file-value-v1"]);
  assert.equal(dataset.rows.length, 5);
  assert.equal(dataset.training.length, 3);
  assert.equal(dataset.test.length, 0);
  assert.equal(dataset.excluded.length, 2);
  assert.equal(dataset.overallCoverage.overall.invocations, 6);
  assert.equal(dataset.overallCoverage.byOutcome.error.invocations, 1);
  assert.ok((dataset.overallCoverage.overall.cost.knownUsd ?? 0) > 0);
  assert.equal(dataset.overallCoverage.overall.cost.completeUsd, undefined);
  assert.equal(dataset.overallCoverage.byOutcome.error.input.missingInvocations, 1);
  assert.equal(dataset.rows.find((row) => row.declaration?.caseId === "failure")?.label?.outcome, "FAILED");
  assert.equal(dataset.rows.find((row) => row.declaration?.caseId === "success")?.label?.outcome, "PASSED");
  assert.equal(dataset.rows.find((row) => row.declaration?.caseId === "provider-error")?.hostAttributionExclusion?.detail, "provider-failure");
  assert.equal(dataset.rows.find((row) => row.declaration?.caseId === "unknown-version")?.hostAttributionExclusion?.detail, "unknown-or-mixed-model-version");
  function assertNoAbsolutePaths(value: unknown): void {
    if (typeof value === "string") assert.ok(!path.win32.isAbsolute(value) && !path.posix.isAbsolute(value));
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(assertNoAbsolutePaths);
  }
  assertNoAbsolutePaths(JSON.parse(serialized));
  assert.ok(!serialized.includes("produce good value"));
  assert.ok(!serialized.includes("readFileSync"));
  assert.ok(!serialized.includes("fixture result"));
  const root = path.dirname(outputPath);
  assert.equal(await readFile(path.join(root, "source", "value.txt"), "utf8"), "zero");
  const repaired = dataset.rows.find((row) => row.declaration?.caseId === "repair");
  assert.ok(repaired);
  assert.equal(repaired.refs.attemptRunIds.length, 2);
});

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as cliCatalog from "../../../src/cli/model-catalog.js";
import * as routingCatalog from "../../../src/routing/model-catalog.js";
import { lockWaitOptions as mainLockWaitOptions, type CliIo as MainCliIo } from "../../../src/cli/main.js";
import { lockWaitOptions, type CliIo } from "../../../src/cli/options.js";
import * as privacyLayout from "../../../src/privacy/state-layout.js";
import * as persistLayout from "../../../src/persist/state-layout.js";
import * as oldAnalysis from "../../../src/evaluation/check-finding-analysis.js";
import * as nativeAnalysis from "../../../src/native/check-finding-analysis.js";
import * as oldFindings from "../../../src/evaluation/check-findings.js";
import * as executionFindings from "../../../src/execution/check-findings.js";
import * as oldEvidenceRetention from "../../../src/experiments/evidence-retention.js";
import * as privacyEvidenceRetention from "../../../src/privacy/evidence-retention.js";
import { HOST_TERMINAL_OUTCOME_SCHEMA as oldOutcomeSchema } from "../../../src/evaluation/types.js";
import { HOST_TERMINAL_OUTCOME_SCHEMA } from "../../../src/native/host-outcome-types.js";
import { createRunId } from "../../../src/domain/ids.js";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";

test("old model catalog path forwards every runtime export with the same identity", () => {
  assert.deepEqual(Object.keys(cliCatalog), Object.keys(routingCatalog));
  for (const key of Object.keys(cliCatalog) as (keyof typeof cliCatalog)[]) {
    assert.equal(cliCatalog[key], routingCatalog[key], key);
  }
  const error = new routingCatalog.UnknownCatalogModelError("custom/missing", "custom", "custom");
  assert.ok(error instanceof cliCatalog.UnknownCatalogModelError);
});

test("main keeps the original helper and IO type exports", () => {
  assert.equal(mainLockWaitOptions, lockWaitOptions);
  const output: string[] = [];
  const io: CliIo = { stdout: (text) => output.push(text), stderr: (text) => output.push(text) };
  const legacyIo: MainCliIo = io;
  legacyIo.stdout("same structural CLI IO contract");
  assert.deepEqual(output, ["same structural CLI IO contract"]);
  assert.deepEqual(lockWaitOptions(undefined), {});
  assert.deepEqual(lockWaitOptions("0"), { timeoutMs: 0 });
  assert.deepEqual(lockWaitOptions("86400000"), { timeoutMs: 86_400_000 });
});

test("old state layout path forwards the same helpers and fixed durable paths", () => {
  assert.deepEqual(Object.keys(privacyLayout), Object.keys(persistLayout));
  for (const key of Object.keys(privacyLayout) as (keyof typeof privacyLayout)[]) {
    assert.equal(privacyLayout[key], persistLayout[key], key);
  }
  const stateRoot = join("state with spaces", "nested");
  assert.equal(persistLayout.runtimeRoot(stateRoot), join(stateRoot, "runtime"));
  assert.equal(persistLayout.adaptationRoot(stateRoot), join(stateRoot, "adaptation"));
  assert.equal(persistLayout.evalDatasetsRoot(stateRoot), join(stateRoot, "adaptation", "eval-datasets"));
  assert.equal(
    persistLayout.defaultEvalDatasetDir(stateRoot, "run_existing"),
    join(stateRoot, "adaptation", "eval-datasets", "run_existing")
  );
});

test("old safety paths forward the same functions, class and policy objects", () => {
  for (const [oldPath, corePath] of [
    [oldAnalysis, nativeAnalysis], [oldFindings, executionFindings], [oldEvidenceRetention, privacyEvidenceRetention]
  ]) {
    assert.deepEqual(Object.keys(oldPath!), Object.keys(corePath!));
    for (const key of Object.keys(oldPath!)) {
      assert.equal(Reflect.get(oldPath!, key), Reflect.get(corePath!, key), key);
    }
  }
  const owner = new oldAnalysis.CheckFindingAnalysisOwner(nativeAnalysis.snapshotCheckFindingAnalysis({ analyze: () => ({ summary: "advisory" }) })!);
  assert.ok(owner instanceof nativeAnalysis.CheckFindingAnalysisOwner);
  assert.equal(oldOutcomeSchema, HOST_TERMINAL_OUTCOME_SCHEMA);
});

test("real host-bound check evidence crosses old finding and new analysis paths without acquiring copy authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "safety-path-compat-"));
  const cwd = join(root, "repo");
  try {
    await mkdir(cwd);
    const git = (args: readonly string[]) => {
      const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    };
    git(["init"]);
    await writeFile(join(cwd, "value.txt"), "synthetic compatibility fixture", "utf8");
    git(["add", "."]);
    git(["-c", "user.name=Compatibility Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const args = ["-e", "process.exit(7)"];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const check = await runIndependentCheck({ cwd, command: process.execPath, args, trustedVerification });
    const runId = createRunId();
    const input = { check, trustedVerification, runId, revision: check.revision, generation: "compat-attempt" };
    const produced = oldFindings.findingsFromIndependentCheck(input);
    assert.equal(produced.state, "available");
    assert.equal(produced.findings.length, 1);
    const finding = produced.findings[0]!;
    const partition = executionFindings.partitionCurrentFindings(produced.findings, input);
    assert.equal(partition.current[0], finding);
    const owner = new nativeAnalysis.CheckFindingAnalysisOwner(oldAnalysis.snapshotCheckFindingAnalysis({ analyze: () => ({ summary: "bounded advisory" }) })!);
    owner.setCurrent(finding);
    const row = await owner.analyze(finding, { runId, artifactId: "compat-artifact", exitCode: 7,
      stdoutText: "", stderrText: "", stdoutByteLength: 0, stderrByteLength: 0 }, new AbortController().signal);
    assert.equal(row.state, "available");
    assert.equal(row.finding, finding);
    assert.equal(owner.project().current[0], row);
    assert.equal(executionFindings.findingsFromIndependentCheck({ ...input, check: { ...check } }).state, "unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

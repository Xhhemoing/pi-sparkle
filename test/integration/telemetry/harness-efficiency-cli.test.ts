import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptPath = join(repoRoot, "scripts/analyze-harness-efficiency.ts");
const fixtures = join(repoRoot, "test/fixtures/harness-efficiency");
const SENTINEL = "HARNESS_EFFICIENCY_SECRET_SENTINEL_sk-do-not-echo-7f3a9c";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
    const child = spawn(process.execPath, [tsxCli, scriptPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function assertNoLeak(result: CliResult): void {
  assert.equal(result.stdout.includes(SENTINEL), false, "stdout leaked sentinel");
  assert.equal(result.stderr.includes(SENTINEL), false, "stderr leaked sentinel");
}

function assertNoSuccessReport(result: CliResult): void {
  assert.equal(result.stdout.includes("pairedReductionRatio"), false);
  assert.equal(result.stdout.includes("monetarySavingUsd"), false);
  assert.equal(result.stdout.includes("\"rowCount\""), false);
}

describe("analyze-harness-efficiency CLI", () => {
  it("prints the complete fixture report as JSON and exits 0", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "complete.jsonl"),
      "--evidence-class",
      "synthetic",
      "--json"
    ]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: unknown;
      evidenceClass: unknown;
      rowCount: unknown;
      pairedRows: unknown;
      unknownRows: unknown;
      pairedBaselineBytes: unknown;
      pairedProjectedBytes: unknown;
      pairedReductionRatio: unknown;
      monetarySavingUsd: unknown;
    };
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.evidenceClass, "synthetic");
    assert.equal(report.rowCount, 3);
    assert.equal(report.pairedRows, 1);
    assert.equal(report.unknownRows, 2);
    assert.equal(report.pairedBaselineBytes, 1000);
    assert.equal(report.pairedProjectedBytes, 250);
    assert.equal(report.pairedReductionRatio, 0.75);
    assert.equal(report.monetarySavingUsd, null);
    assertNoLeak(result);
  });

  it("rejects a missing --evidence-class and does not print a success report", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "complete.jsonl"),
      "--json"
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /evidence-class/);
    assertNoSuccessReport(result);
    assertNoLeak(result);
  });

  it("rejects an illegal --evidence-class value", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "complete.jsonl"),
      "--evidence-class",
      "guessed",
      "--json"
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /evidence-class/);
    assertNoSuccessReport(result);
  });

  it("requires --input and --json", async () => {
    const missingInput = await runCli(["--evidence-class", "synthetic", "--json"]);
    assert.equal(missingInput.code, 1);
    assert.match(missingInput.stderr, /input/);
    assertNoSuccessReport(missingInput);

    const missingJson = await runCli([
      "--input",
      join(fixtures, "complete.jsonl"),
      "--evidence-class",
      "synthetic"
    ]);
    assert.equal(missingJson.code, 1);
    assert.match(missingJson.stderr, /json/);
    assertNoSuccessReport(missingJson);
  });

  it("exits 1 on invalid.jsonl and never echoes the secret sentinel", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "invalid.jsonl"),
      "--evidence-class",
      "synthetic",
      "--json"
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /line 1: leak/);
    assertNoSuccessReport(result);
    assertNoLeak(result);
  });

  it("reads missing.jsonl as unknown rows, not zeros", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "missing.jsonl"),
      "--evidence-class",
      "observed",
      "--json"
    ]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      evidenceClass: unknown;
      rowCount: unknown;
      pairedRows: unknown;
      unknownRows: unknown;
      pairedBaselineBytes: unknown;
      pairedProjectedBytes: unknown;
      pairedReductionRatio: unknown;
      monetarySavingUsd: unknown;
    };
    assert.equal(report.evidenceClass, "observed");
    assert.equal(report.rowCount, 3);
    assert.equal(report.pairedRows, 0);
    assert.equal(report.unknownRows, 3);
    assert.equal(report.pairedBaselineBytes, 0);
    assert.equal(report.pairedProjectedBytes, 0);
    assert.equal(report.pairedReductionRatio, null);
    assert.equal(report.monetarySavingUsd, null);
  });

  it("exits 1 on a missing input file without a success report", async () => {
    const result = await runCli([
      "--input",
      join(fixtures, "does-not-exist.jsonl"),
      "--evidence-class",
      "synthetic",
      "--json"
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /input|read/);
    assertNoSuccessReport(result);
    assertNoLeak(result);
  });

  it("rejects a file over the 16 MiB cap without echoing contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-efficiency-cap-"));
    const oversized = join(dir, "oversized.jsonl");
    // Stay well under tmp disk while still over the declared cap: write a
    // sparse-ish payload by repeating a short valid-looking line past 16 MiB.
    // The CLI must refuse before parsing rows.
    const line =
      '{"schemaVersion":1,"runId":"r-cap","requestId":"q1","observationId":"o1","baselineBytes":1,"projectedBytes":1}\n';
    const target = 16 * 1024 * 1024 + line.length;
    const chunks: string[] = [];
    let size = 0;
    while (size < target) {
      chunks.push(line);
      size += line.length;
    }
    await writeFile(oversized, chunks.join(""), "utf8");
    const result = await runCli([
      "--input",
      oversized,
      "--evidence-class",
      "synthetic",
      "--json"
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /size|16/);
    assertNoSuccessReport(result);
    assertNoLeak(result);
  });
});

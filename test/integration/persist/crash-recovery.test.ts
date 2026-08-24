import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const probePath = join(repoRoot, "scripts/crash-probe.mjs");

interface ProbeCase {
  readonly error?: string;
  readonly iterations: number;
  readonly name: string;
  readonly ok: boolean;
}

interface ProbeVerdict {
  readonly cases: readonly ProbeCase[];
  readonly ok: boolean;
}

function runReducedProbe(): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probePath, "--iterations", "1"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 9_000);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, stdout, timedOut });
    });
  });
}

test("real process kills preserve persistence recovery invariants", { timeout: 10_000 }, async () => {
  const result = await runReducedProbe();
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const verdict = JSON.parse(lines[0] ?? "") as ProbeVerdict;
  assert.equal(verdict.ok, true);
  assert.deepEqual(
    verdict.cases.map((entry) => ({
      iterations: entry.iterations,
      name: entry.name,
      ok: entry.ok
    })),
    [
      { iterations: 1, name: "jsonl-truncated-tail", ok: true },
      { iterations: 1, name: "checkpoint-old-then-next-write", ok: true },
      { iterations: 1, name: "stale-lock-no-steal", ok: true }
    ]
  );
});

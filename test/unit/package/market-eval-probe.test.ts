import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const probeRelativePath = "scripts/market-eval-probe.mjs";
const probePath = join(repoRoot, probeRelativePath);
const adr006Path = "docs/decisions/0006-pi-extension-reverse-adapter.md";

interface MarketEvalReport {
  schemaVersion?: unknown;
  package?: {
    private?: unknown;
    piManifest?: {
      extensions?: unknown;
      prompts?: unknown;
      skills?: unknown;
    };
  };
  adrs?: Array<{
    file?: unknown;
    statusLines?: unknown;
  }>;
}

function runProbe(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probePath], {
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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`market-eval probe exited ${String(code)}: ${stderr}`));
      }
    });
  });
}

test("the market-eval probe script is present", () => {
  assert.ok(existsSync(probePath), `${probeRelativePath} must exist for the probe to be runnable`);
});

/**
 * Name-agnostic on purpose. Which key wires the probe (`market:eval`,
 * `market-eval:probe`, ...) is a package.json decision; what this pins is that
 * whatever key does wire it runs *this* file with node, so a rename of the
 * script cannot leave a package entry pointing at a path that no longer exists.
 */
test("any package script wiring the market-eval probe points at the real file", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const wiring = Object.entries(packageJson.scripts ?? {}).filter(([, command]) =>
    command.includes("market-eval-probe")
  );
  for (const [name, command] of wiring) {
    assert.equal(
      command,
      `node ${probeRelativePath}`,
      `package script ${name} must run the probe as "node ${probeRelativePath}"`
    );
  }
});

test("market-eval JSON pins the Pi overlay posture and ADR-006 status", async () => {
  const report = JSON.parse(await runProbe()) as MarketEvalReport;

  assert.equal(report.schemaVersion, 1);
  // The ADR-001 posture the probe exists to keep honest: pi-sparkle ships a
  // skills/prompts overlay and declares no Pi extension.
  assert.equal(report.package?.piManifest?.extensions, false);
  assert.equal(report.package?.piManifest?.skills, true);
  assert.equal(report.package?.piManifest?.prompts, true);
  assert.equal(report.package?.private, true, "the developer preview stays unpublishable");

  assert.ok(Array.isArray(report.adrs), "probe must report ADR files");
  const adr006 = report.adrs.find((adr) => adr.file === adr006Path);
  assert.ok(adr006, `${adr006Path} must exist in the probe report`);
  assert.ok(Array.isArray(adr006.statusLines), "ADR-006 must have a best-effort status parse");
  assert.ok(
    adr006.statusLines.some((line) => typeof line === "string" && /\bProposed\b/i.test(line)),
    "ADR-006 status must contain Proposed"
  );
});

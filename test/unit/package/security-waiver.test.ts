import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const probe = fileURLToPath(new URL("../../../scripts/security-probe.mjs", import.meta.url));
interface ProbeResult {
  status: string;
  openFindings: { probe: string }[];
  waivedFindings: unknown[];
  refusedWaivers: string[];
}

async function runProbe(waiver: string, unsafe: boolean): Promise<{ code: number; report: ProbeResult }> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-security-waiver-"));
  try {
    await mkdir(join(root, "dist", "feedback"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "sparkle-waiver-fixture", version: "0.1.0", private: true, type: "module", files: ["dist"]
    }), "utf8");
    await writeFile(join(root, "dist", "feedback", "redaction.js"), unsafe
      ? 'export const redactFeedback = (feedback) => ({ feedback });\n// -----BEGIN PRIVATE KEY-----\n'
      : 'export const redactFeedback = (feedback) => ({ feedback: { ...feedback, body: "redacted" } });\n', "utf8");
    const result = await execute(process.execPath, [probe], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, SECURITY_WAIVER: waiver,
        SECURITY_WAIVER_RELEASE: "unregistered-old-release", SECURITY_WAIVER_EXPIRY: "2000-01-01" }
    }).then((output) => ({ code: 0, stdout: output.stdout }), (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(typeof failure.code, "number", failure.stderr);
      return { code: failure.code, stdout: failure.stdout };
    });
    return { code: result.code, report: JSON.parse(result.stdout) as ProbeResult };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("empty waiver leaves successful security probes unchanged", async () => {
  const { code, report } = await runProbe("", false);
  assert.equal(code, 0);
  assert.equal(report.status, "ok");
  assert.deepEqual(report.waivedFindings, []);
});

test("empty register refuses known, unknown, expired/release-labelled and unwaivable requests", async () => {
  const requested = ["pii-redaction", "secret-bodies", "unknown-probe", "pii-redaction@old-release", "packaged-secrets"];
  const { code, report } = await runProbe(requested.join(","), true);
  assert.equal(code, 1);
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.waivedFindings, []);
  assert.deepEqual(report.refusedWaivers, [...requested].sort());
  for (const probeId of ["pii-redaction", "secret-bodies", "packaged-secrets"]) {
    assert.ok(report.openFindings.some((finding) => finding.probe === probeId), probeId);
  }
});

test("an unregistered waiver cannot silently succeed even when findings are absent", async () => {
  const { code, report } = await runProbe("pii-redaction", false);
  assert.equal(code, 1);
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.refusedWaivers, ["pii-redaction"]);
});

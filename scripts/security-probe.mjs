#!/usr/bin/env node
/**
 * security-probe — RELEASE GATE (run against the built dist/, not src).
 *
 * Fails the prerelease flow while any security finding below is open.
 * A finding may be time-boxed waived via SECURITY_WAIVER="id1,id2"
 * (see docs/specs/release-gate.md for the waiver register).
 *
 * Probes:
 *   pii-redaction   PII must be REMOVED from feedback bodies, not just labeled
 *   secret-bodies   secret stripping must remove values, not only prefixes
 *   packaged-secrets no credential material inside the publishable artifact
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const waivers = new Set(
  (process.env.SECURITY_WAIVER ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
);

const failures = [];
const passed = [];

// --- probe: pii-redaction + secret-bodies (against dist) -------------------
const redactionSamples = [
  { id: "pii-redaction", name: "email", body: "contact john.doe@example.com now" },
  { id: "pii-redaction", name: "ipv4", body: "server 192.168.1.100 up" },
  { id: "pii-redaction", name: "phone-intl", body: "call +1-555-123-4567" },
  { id: "pii-redaction", name: "phone-cn", body: "phone 13812345678" },
  { id: "pii-redaction", name: "credit-card", body: "card 4111111111111111" },
  { id: "pii-redaction", name: "unix-path", body: "see /home/john/.ssh/id_rsa" },
  { id: "pii-redaction", name: "windows-path", body: "saved C:\\Users\\john\\secret.txt" },
  { id: "secret-bodies", name: "openai-key-body", body: "key sk-proj-abcdefghijklmnop1234567890" },
  { id: "secret-bodies", name: "api-key-value", body: "api_key=supersecretvalue123" }
];

function loadDistRedaction() {
  const path = join(process.cwd(), "dist", "feedback", "redaction.js");
  return import(new URL(`file://${path.replaceAll("\\", "/")}`).href);
}

try {
  const { redactFeedback } = await loadDistRedaction();
  const policy = {
    redactPII: true,
    maxBodyChars: 400,
    forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"]
  };
  for (const sample of redactionSamples) {
    const record = {
      id: "fb_probe",
      episodeId: "ep_probe",
      kind: "human",
      rubricVersion: "1",
      score: 50,
      evidenceRefs: [],
      redacted: false,
      createdAt: "2026-08-22T00:00:00.000Z",
      body: sample.body
    };
    const { feedback } = redactFeedback(record, policy);
    const out = feedback.body ?? "";
    // The sensitive payload must not survive verbatim anywhere in the output.
    const core =
      sample.name === "openai-key-body" ? "abcdefghijklmnop1234567890"
      : sample.name === "api-key-value" ? "supersecretvalue123"
      : sample.name === "email" ? "john.doe@example.com"
      : sample.name === "ipv4" ? "192.168.1.100"
      : sample.name === "phone-intl" ? "+1-555-123-4567"
      : sample.name === "phone-cn" ? "13812345678"
      : sample.name === "credit-card" ? "4111111111111111"
      : sample.name === "unix-path" ? "/home/john/.ssh/id_rsa"
      : sample.name === "windows-path" ? "Users\\john\\secret.txt"
      : sample.body;
    if (out.includes(core)) {
      failures.push({ probe: sample.id, sample: sample.name, detail: `sensitive payload survives redaction: "${core}"` });
    } else {
      passed.push({ probe: sample.id, sample: sample.name });
    }
  }
} catch (error) {
  failures.push({ probe: "pii-redaction", sample: "module-load", detail: String(error).slice(0, 200) });
}

// --- probe: packaged-secrets -----------------------------------------------
const SECRET_PATTERNS = [
  [/sk-or-v1-[0-9a-f]{16,}/, "OpenRouter key"],
  [/sk-(proj|ant)-[A-Za-z0-9_-]{20,}/, "OpenAI/Anthropic key shape"],
  [/BEGIN (RSA )?PRIVATE KEY/, "private key block"],
  [/sk-jGwupu|sk-lucNV|sk-3554e1|sk-1mABm3|sk-qWpEN/, "known personal key prefix"]
];

try {
  const listing = execSync("npm pack --dry-run --json", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const files = JSON.parse(listing)[0]?.files?.map((f) => f.path) ?? [];
  let scanned = 0;
  for (const rel of files) {
    if (!/\.(js|mjs|cjs|json|md|txt)$/.test(rel)) continue;
    let text;
    try {
      text = readFileSync(join(process.cwd(), rel), "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        failures.push({ probe: "packaged-secrets", sample: rel, detail: `${label} matches packaging content` });
      }
    }
  }
  passed.push({ probe: "packaged-secrets", sample: `${scanned} files scanned` });
} catch (error) {
  failures.push({ probe: "packaged-secrets", sample: "pack", detail: String(error).slice(0, 200) });
}

// --- waiver accounting ------------------------------------------------------
const effective = failures.filter((f) => !waivers.has(f.probe));
const waived = failures.filter((f) => waivers.has(f.probe));

process.stdout.write(
  `${JSON.stringify(
    {
      status: effective.length === 0 ? "ok" : "BLOCKED",
      passed: passed.length,
      openFindings: effective,
      waivedFindings: waived.map((f) => ({ ...f, waivedBy: "SECURITY_WAIVER" }))
    },
    null,
    2
  )}\n`
);
process.exitCode = effective.length === 0 ? 0 : 1;

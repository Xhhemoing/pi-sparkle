#!/usr/bin/env node
/**
 * security-probe — RELEASE GATE (run against the built dist/, not src).
 *
 * Fails the prerelease flow while any security finding below is open.
 * A finding may be time-boxed waived via SECURITY_WAIVER="id1,id2"
 * (see docs/specs/release-gate.md for the waiver register) — except for the
 * probes in UNWAIVABLE, which no environment variable can silence.
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

/**
 * A waiver time-boxes a known weakness that is still only a weakness. Packaged
 * credential material is not that: the tarball is the artifact, and shipping it
 * publishes the secret to everyone who installs the package — there is no
 * "later" in which to fix it. So this probe is deliberately outside the waiver
 * mechanism, and a SECURITY_WAIVER that names it is reported as refused rather
 * than honoured.
 */
const UNWAIVABLE = new Set(["packaged-secrets"]);

const failures = [];
const passed = [];

// --- probe: pii-redaction + secret-bodies (against dist) -------------------
const redactionSamples = [
  { id: "pii-redaction", name: "email", body: "contact john.doe@example.com now", core: "john.doe@example.com" },
  { id: "pii-redaction", name: "ipv4", body: "server 192.168.1.100 up", core: "192.168.1.100" },
  { id: "pii-redaction", name: "phone-intl", body: "call +1-555-123-4567", core: "+1-555-123-4567" },
  { id: "pii-redaction", name: "phone-cn", body: "phone 13812345678", core: "13812345678" },
  { id: "pii-redaction", name: "credit-card", body: "card 4111111111111111", core: "4111111111111111" },
  {
    id: "pii-redaction",
    name: "ipv6",
    body: "host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 down",
    core: "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
  },
  { id: "pii-redaction", name: "ssn-dashed", body: "ssn 123-45-6789 on file", core: "123-45-6789" },
  { id: "pii-redaction", name: "ssn-bare", body: "ssn 123456789 on file", core: "123456789" },
  {
    id: "pii-redaction",
    name: "cn-id",
    body: "身份证 11010519491231002X 已登记",
    core: "11010519491231002X"
  },
  { id: "pii-redaction", name: "unix-path", body: "see /home/john/.ssh/id_rsa", core: "/home/john/.ssh/id_rsa" },
  {
    id: "pii-redaction",
    name: "macos-path",
    body: "open /Users/alice/Library/Application Support/pi/auth.json",
    core: "/Users/alice/Library/Application Support/pi/auth.json"
  },
  {
    id: "pii-redaction",
    name: "windows-path",
    body: "saved C:\\Users\\john\\secret.txt",
    core: "Users\\john\\secret.txt"
  },
  {
    id: "pii-redaction",
    name: "windows-unc-path",
    body: "copied \\\\fileserver\\private\\alice\\credentials.json",
    core: "\\\\fileserver\\private\\alice\\credentials.json"
  },
  {
    id: "secret-bodies",
    name: "openai-key-body",
    body: "key sk-proj-abcdefghijklmnop1234567890",
    core: "abcdefghijklmnop1234567890"
  },
  {
    id: "secret-bodies",
    name: "api-key-value",
    body: "api_key=supersecretvalue123",
    core: "supersecretvalue123"
  },
  {
    id: "secret-bodies",
    name: "aws-secret-access-key",
    body: "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    core: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  },
  {
    id: "secret-bodies",
    name: "namespaced-api-key",
    body: "SPARKLE_API_KEY: 'supersecretvalue123'",
    core: "supersecretvalue123"
  },
  {
    id: "secret-bodies",
    name: "bearer-token-body",
    body: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.cHJvYmUtdXNlcg.sensitive-signature",
    core: "eyJhbGciOiJIUzI1NiJ9.cHJvYmUtdXNlcg.sensitive-signature"
  },
  {
    id: "secret-bodies",
    name: "pem-private-key-body",
    body:
      "-----BEGIN PRIVATE KEY-----\n" +
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n" +
      "-----END PRIVATE KEY-----",
    core: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ"
  }
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
    forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "Bearer", "BEGIN PRIVATE"]
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
    if (out.includes(sample.core)) {
      failures.push({
        probe: sample.id,
        sample: sample.name,
        detail: `sensitive payload survives redaction: "${sample.core}"`
      });
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
const waivable = (finding) => waivers.has(finding.probe) && !UNWAIVABLE.has(finding.probe);
const effective = failures.filter((finding) => !waivable(finding));
const waived = failures.filter((finding) => waivable(finding));
const refusedWaivers = [...waivers].filter((probe) => UNWAIVABLE.has(probe)).toSorted();

process.stdout.write(
  `${JSON.stringify(
    {
      status: effective.length === 0 ? "ok" : "BLOCKED",
      passed: passed.length,
      openFindings: effective,
      waivedFindings: waived.map((f) => ({ ...f, waivedBy: "SECURITY_WAIVER" })),
      // Named in SECURITY_WAIVER and ignored on purpose: the operator asked for
      // a waiver the gate does not grant, and silence would look like consent.
      refusedWaivers
    },
    null,
    2
  )}\n`
);
process.exitCode = effective.length === 0 ? 0 : 1;

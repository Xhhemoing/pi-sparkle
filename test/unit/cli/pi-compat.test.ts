import assert from "node:assert/strict";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { piCompatBreakage, readSparklePackageJson } from "../../../src/cli/pi-compat.js";
import { readPinnedPiVersions, type PiCompatReport } from "../../../src/pi-compat/index.js";

/** A port nothing listens on, so --online fails closed without leaving the host. */
const UNREACHABLE_REGISTRY_URL = "http://127.0.0.1:1";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

function healthyReport(overrides: Partial<PiCompatReport> = {}): PiCompatReport {
  return {
    generatedAt: "2026-08-24T14:00:00.000Z",
    offline: true,
    pinned: { agentCore: "0.84.3", ai: "0.84.3" },
    adapter: {
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      googleThinkingType: "GoogleApiThinkingLevel",
      nestedSkillDiscovery: true,
      agentsMdNotBrokenSkill: true
    },
    status: "unknown",
    findings: [],
    ...overrides
  };
}

test("pi-compat --offline prints the pinned Pi versions and a status, exit 0", async () => {
  const { io, out, err } = capture();
  const code = await main(["pi-compat", "--offline"], io);
  assert.equal(code, 0, err.join(""));
  const text = out.join("");
  // Read the pins rather than hardcoding them so a pin bump does not need a test edit.
  const pinned = readPinnedPiVersions(readSparklePackageJson());
  assert.equal(pinned.agentCore, pinned.ai, "the two Pi packages must stay on a matching pin");
  assert.match(pinned.agentCore, /^\d+\.\d+\.\d+/);
  assert.match(text, /developer preview/);
  assert.ok(
    text.includes(`pinned: agent-core=${pinned.agentCore} ai=${pinned.ai}`),
    `expected the pinned line for ${pinned.agentCore} in:\n${text}`
  );
  assert.match(text, /mode: offline/);
  assert.match(text, /latest: skipped \(offline\)/);
  assert.match(text, /status: (?:current|behind|ahead|unknown)\n/);
  assert.doesNotMatch(text, /google-thinking=legacy-GoogleThinkingLevel/);
  assert.deepEqual(err, []);
});

test("pi-compat --json writes a parseable offline report and nothing else", async () => {
  const { io, out, err } = capture();
  const code = await main(["pi-compat", "--json"], io);
  assert.equal(code, 0, err.join(""));
  const report = JSON.parse(out.join("")) as PiCompatReport;
  assert.equal(report.offline, true);
  assert.equal(report.latest, undefined);
  assert.equal(typeof report.generatedAt, "string");
  assert.ok(["current", "behind", "ahead", "unknown"].includes(report.status));
  const pinned = readPinnedPiVersions(readSparklePackageJson());
  assert.deepEqual(report.pinned, pinned);
  assert.notEqual(report.adapter.googleThinkingType, "legacy-GoogleThinkingLevel");
  assert.ok(report.adapter.thinkingLevels.includes("high"));
  assert.ok(Array.isArray(report.findings));
  assert.equal(piCompatBreakage(report), undefined, report.findings.join("; "));
  assert.deepEqual(err, []);
});

test("pi-compat rejects --offline together with --online", async () => {
  const { io, out, err } = capture();
  const code = await main(["pi-compat", "--offline", "--online"], io);
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  const parsed = parseCliErrorJson(err.join(""));
  assert.equal(parsed?.command, "pi-compat");
  assert.equal(parsed?.stage, "parse-args");
  assert.match(parsed?.message ?? "", /either --offline or --online, not both/);
});

test("pi-compat --online fails closed when the registry is unreachable", async () => {
  const previous = process.env.PI_COMPAT_REGISTRY_URL;
  process.env.PI_COMPAT_REGISTRY_URL = UNREACHABLE_REGISTRY_URL;
  try {
    const { io, out, err } = capture();
    const code = await main(["pi-compat", "--online", "--json"], io);
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as PiCompatReport;
    assert.equal(report.offline, false);
    assert.equal(report.latest, undefined);
    assert.equal(report.status, "unknown");
    assert.match(err.join(""), /warning: latest Pi versions not fetched:/);
  } finally {
    if (previous === undefined) delete process.env.PI_COMPAT_REGISTRY_URL;
    else process.env.PI_COMPAT_REGISTRY_URL = previous;
  }
});

test("piCompatBreakage reports only broken adapter contracts", () => {
  assert.equal(piCompatBreakage(healthyReport()), undefined);
  assert.equal(
    piCompatBreakage(healthyReport({ status: "behind", findings: ["pin 0.84.3 is behind latest 0.85.0"] })),
    undefined,
    "being behind latest is not a broken contract"
  );
  assert.equal(
    piCompatBreakage(
      healthyReport({
        findings: ["assumed nested skill discovery (Pi 0.84.3)", "BROKEN: unreadable Pi package pins: nope"]
      })
    ),
    "unreadable Pi package pins: nope"
  );
  assert.equal(
    piCompatBreakage(
      healthyReport({
        adapter: { ...healthyReport().adapter, googleThinkingType: "legacy-GoogleThinkingLevel" }
      })
    ),
    "adapter references the legacy GoogleThinkingLevel type"
  );
  assert.equal(
    piCompatBreakage(
      healthyReport({ adapter: { ...healthyReport().adapter, thinkingLevels: [] } })
    ),
    "adapter exposes no thinking levels"
  );
});

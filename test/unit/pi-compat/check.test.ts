import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPiCompatReport,
  comparePiVersions,
  probeAdapterContract,
  readPinnedPiVersions
} from "../../../src/pi-compat/index.js";

const NOW = "2026-08-24T14:00:00.000Z";
const THINKING_LEVEL_TYPE = `export type SparkleThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";`;

function packageJson(agentCore = "0.84.1", ai = "0.84.1"): unknown {
  return {
    dependencies: {
      "@earendil-works/pi-agent-core": agentCore,
      "@earendil-works/pi-ai": ai
    }
  };
}

describe("Pi compatibility checks", () => {
  it("reads the two pinned Pi dependency versions", () => {
    assert.deepEqual(readPinnedPiVersions(packageJson()), {
      agentCore: "0.84.1",
      ai: "0.84.1"
    });
  });

  it("throws clear errors when Pi dependencies are missing", () => {
    assert.throws(
      () => readPinnedPiVersions({}),
      /package\.json dependencies are missing/
    );
    assert.throws(
      () =>
        readPinnedPiVersions({
          dependencies: { "@earendil-works/pi-agent-core": "0.84.1" }
        }),
      /dependency @earendil-works\/pi-ai is missing/
    );
  });

  it("compares numeric major.minor.patch and ignores prerelease labels", () => {
    assert.equal(comparePiVersions("0.84.1", "0.84.3"), "behind");
    assert.equal(comparePiVersions("1.0.0", "0.99.99"), "ahead");
    assert.equal(comparePiVersions("0.84.3-next.1", "0.84.3"), "current");
    assert.equal(comparePiVersions("100000000000000000000.0.0", "99999999999999999999.0.0"), "ahead");
  });

  it("reports behind when either package is behind", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson(),
      offline: false,
      latest: { agentCore: "0.84.3", ai: "0.84.1" },
      now: NOW
    });
    assert.equal(report.status, "behind");
  });

  it("reports ahead only when no package is behind", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson("0.85.0", "0.84.3"),
      offline: false,
      latest: { agentCore: "0.84.3", ai: "0.84.3" },
      now: NOW
    });
    assert.equal(report.status, "ahead");
  });

  it("reports current when both package pins match", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson("0.84.3", "0.84.3-rc.1"),
      offline: false,
      latest: { agentCore: "0.84.3", ai: "0.84.3" },
      now: NOW
    });
    assert.equal(report.status, "current");
  });

  it("turns junk versions into an unknown report instead of throwing", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson(),
      offline: false,
      latest: { agentCore: "latest", ai: "0.84.3" },
      now: NOW
    });
    assert.equal(report.status, "unknown");
    assert.match(report.findings.join("\n"), /versions are incomparable.*Invalid Pi version "latest"/);
  });

  it("marks a junk pinned version incomparable even without latest versions", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson("workspace:*"),
      offline: true,
      now: NOW
    });
    assert.equal(report.status, "unknown");
    assert.match(report.findings.join("\n"), /pin is incomparable.*Invalid Pi version "workspace:\*"/);
  });

  it("detects the legacy GoogleThinkingLevel without importing Pi", () => {
    const probe = probeAdapterContract({
      readAdapterSource: () =>
        `import type { GoogleThinkingLevel, GoogleApiThinkingLevel } from "pi";\n${THINKING_LEVEL_TYPE}`
    });
    assert.equal(probe.googleThinkingType, "legacy-GoogleThinkingLevel");
    assert.deepEqual(probe.thinkingLevels, [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]);
    assert.equal(probe.nestedSkillDiscovery, true);
    assert.equal(probe.agentsMdNotBrokenSkill, true);
  });

  it("distinguishes the API-prefixed Google type from the legacy symbol", () => {
    const probe = probeAdapterContract({
      readAdapterSource: () => "type Level = GoogleApiThinkingLevel;"
    });
    assert.equal(probe.googleThinkingType, "GoogleApiThinkingLevel");
  });

  it("does not mark reports broken for legacy text outside adapter sources", () => {
    const documentation = "Migration note: GoogleThinkingLevel was the legacy name.";
    assert.match(documentation, /\bGoogleThinkingLevel\b/);

    for (const adapter of [
      {
        source: `type Level = GoogleApiThinkingLevel;\n${THINKING_LEVEL_TYPE}`,
        expectedGoogleType: "GoogleApiThinkingLevel"
      },
      {
        source: THINKING_LEVEL_TYPE,
        expectedGoogleType: "absent"
      }
    ] as const) {
      const report = buildPiCompatReport({
        packageJson: packageJson(),
        offline: true,
        now: NOW,
        readAdapterSource: () => adapter.source
      });

      assert.equal(report.adapter.googleThinkingType, adapter.expectedGoogleType);
      assert.equal(
        report.findings.some((finding) => finding.startsWith("BROKEN:")),
        false
      );
    }
  });

  it("marks an adapter with empty thinking levels as broken", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson(),
      offline: true,
      now: NOW,
      readAdapterSource: () => "export type SparkleThinkingLevel = never;"
    });
    assert.deepEqual(report.adapter.thinkingLevels, []);
    assert.ok(report.findings.includes("BROKEN: adapter exposes no thinking levels"));
  });

  it("turns a missing adapter reader into a broken finding", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson(),
      offline: true,
      now: NOW,
      readAdapterSource: () => {
        throw new Error("adapter fixture is missing");
      }
    });
    assert.match(
      report.findings.join("\n"),
      /^BROKEN: unable to read Pi adapter sources: adapter fixture is missing$/m
    );
  });

  it("returns a JSON-serializable report with exact optional fields", () => {
    const report = buildPiCompatReport({
      packageJson: packageJson(),
      offline: true,
      now: NOW
    });
    const serialized: unknown = JSON.parse(JSON.stringify(report));
    assert.deepEqual(serialized, report);
    assert.equal(report.generatedAt, NOW);
    assert.equal(report.status, "unknown");
    assert.equal("latest" in report, false);
  });
});

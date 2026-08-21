import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blendedQuality,
  parsePublicPriorSnapshot,
  pickFromPublicPrior,
  publicPriorHash,
  type PublicPriorSnapshot
} from "../../../src/routing/public-prior.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const TS = "2026-08-19T00:00:00.000Z";

function snapshot(overrides: Partial<PublicPriorSnapshot> = {}): PublicPriorSnapshot {
  return parsePublicPriorSnapshot({
    schemaVersion: 1,
    snapshotId: "pps_fixture_v1",
    createdAt: TS,
    qualityBar: 0.55,
    scores: [
      {
        sourceId: "aider-polyglot",
        modelAliases: ["cheap"],
        raw: 0.4,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://aider.chat/docs/leaderboards/"
      },
      {
        sourceId: "aider-polyglot",
        modelAliases: ["premium"],
        raw: 0.88,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://aider.chat/docs/leaderboards/"
      },
      {
        sourceId: "swe-bench-verified-mini",
        modelAliases: ["cheap"],
        raw: 0.31,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://www.swebench.com/verified"
      },
      {
        sourceId: "swe-bench-verified-mini",
        modelAliases: ["premium"],
        raw: 0.74,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://www.swebench.com/verified"
      },
      {
        sourceId: "terminal-bench-2.1-fixed-harness",
        modelAliases: ["cheap"],
        raw: 0.5,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://www.tbench.ai/leaderboard/terminal-bench/2.1"
      },
      {
        sourceId: "terminal-bench-2.1-fixed-harness",
        modelAliases: ["premium"],
        raw: 0.8,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://www.tbench.ai/leaderboard/terminal-bench/2.1"
      }
    ],
    ...overrides
  });
}

const catalog = [
  { id: "cheap", estimatedCostUsd: 0.1 },
  { id: "premium", estimatedCostUsd: 0.5 }
];

test("edit quality ranks premium above cheap after min-max blend", () => {
  const quality = blendedQuality(snapshot(), "edit", ["cheap", "premium"]);
  assert.ok((quality.get("premium") ?? 0) > (quality.get("cheap") ?? 1));
});

test("cheapest above the quality bar is preferred for edit work", () => {
  const pick = pickFromPublicPrior(snapshot(), "edit", catalog);
  assert.equal(pick?.modelId, "premium");
  assert.match(pick?.reason ?? "", /quality bar/);
});

test("when both models clear the bar, the cheaper one wins", () => {
  const pick = pickFromPublicPrior(snapshot({ qualityBar: 0 }), "edit", catalog);
  assert.equal(pick?.modelId, "cheap");
});

test("deploy and unknown have no public coverage", () => {
  assert.equal(pickFromPublicPrior(snapshot(), "deploy", catalog), undefined);
  assert.equal(pickFromPublicPrior(snapshot(), "unknown", catalog), undefined);
});

test("a catalog model with no aliases is not zero-filled", () => {
  const quality = blendedQuality(snapshot(), "edit", ["cheap", "premium", "mystery"]);
  assert.equal(quality.has("mystery"), false);
});

test("alias matching is exact after case folding, not substring includes", () => {
  const snap = parsePublicPriorSnapshot({
    schemaVersion: 1,
    snapshotId: "pps_alias",
    createdAt: TS,
    qualityBar: 0,
    scores: [
      {
        sourceId: "aider-polyglot",
        modelAliases: ["gpt-4"],
        raw: 0.99,
        unit: "pass_rate",
        fetchedAt: TS,
        sourceUrl: "https://aider.chat/docs/leaderboards/"
      }
    ]
  });
  const quality = blendedQuality(snap, "edit", ["gpt-4", "gpt-4-mini"]);
  assert.equal(quality.get("gpt-4"), 0.99);
  assert.equal(quality.has("gpt-4-mini"), false);
});

test("coverage under 3 scored models does not min-max stretch to 0/1", () => {
  const quality = blendedQuality(snapshot(), "edit", ["cheap", "premium"]);
  assert.notEqual(quality.get("cheap"), 0);
  assert.notEqual(quality.get("premium"), 1);
});

test("publicPriorHash includes createdAt and per-row provenance", () => {
  const first = publicPriorHash(snapshot());
  const second = publicPriorHash(snapshot({ createdAt: parseIsoTimestamp("2026-08-20T00:00:00.000Z") }));
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f]+$/);
});


test("arena-coding elo is allowed only after validation", () => {
  const withArena = parsePublicPriorSnapshot({
    schemaVersion: 1,
    snapshotId: "pps_fixture_v1",
    createdAt: TS,
    qualityBar: 0.55,
    scores: [
      ...snapshot().scores,
      {
        sourceId: "arena-coding",
        modelAliases: ["premium"],
        raw: 1566,
        unit: "elo",
        fetchedAt: TS,
        sourceUrl: "https://arena.ai/leaderboard/code"
      },
      {
        sourceId: "arena-coding",
        modelAliases: ["cheap"],
        raw: 1400,
        unit: "elo",
        fetchedAt: TS,
        sourceUrl: "https://arena.ai/leaderboard/code"
      }
    ]
  });
  const review = pickFromPublicPrior(withArena, "review", catalog);
  assert.ok(review !== undefined);
});

test("pass_rate outside [0,1] fails closed", () => {
  assert.throws(
    () =>
      parsePublicPriorSnapshot({
        ...snapshot(),
        scores: [
          {
            sourceId: "aider-polyglot",
            modelAliases: ["cheap"],
            raw: 1.4,
            unit: "pass_rate",
            fetchedAt: TS,
            sourceUrl: "https://example.invalid"
          }
        ]
      }),
    /pass_rate/
  );
});

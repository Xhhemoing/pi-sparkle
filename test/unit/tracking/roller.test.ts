import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollSummary } from "../../../src/tracking/roller.js";
import { hashSummary } from "../../../src/tracking/types.js";
import type { ConstraintRecord, RollingSummary, TrackingWindow } from "../../../src/tracking/types.js";

const PRIVACY: ConstraintRecord = {
  id: "privacy-1",
  text: "do not persist raw PII",
  kind: "constraint",
  mandatory: true
};

function window(overrides: Partial<TrackingWindow> = {}): TrackingWindow {
  return {
    contextFacts: ["task: redact logs"],
    toolSituations: [
      {
        name: "read",
        targetPath: "src/a.ts",
        wrote: false,
        escaped: false,
        artifactIds: [],
        evidenceIds: ["evd_1"],
        hashes: ["aa"]
      }
    ],
    constraints: [PRIVACY],
    unresolvedDecisions: ["ask about retention"],
    confirmedDecisions: ["use structured logs"],
    openMinors: [],
    ...overrides
  };
}

function roll(current: TrackingWindow, previous?: RollingSummary, maxItems?: number): RollingSummary {
  return rollSummary({
    window: previous === undefined ? current : { ...current, previous },
    prescore: 0.8,
    human: { kind: "unobserved" },
    score: 0.8,
    anomalyCodes: [],
    evidenceRefs: ["evd_1"],
    openMinors: current.openMinors,
    ...(maxItems !== undefined ? { maxItems } : {})
  }).summary;
}

describe("tracking rolling summary", () => {
  it("keeps an early privacy constraint after three rolls", () => {
    const first = roll(window());
    const second = roll(
      window({
        toolSituations: [
          {
            name: "test",
            exitCode: 0,
            wrote: false,
            escaped: false,
            artifactIds: [],
            evidenceIds: ["evd_2"],
            hashes: ["bb"]
          }
        ]
      }),
      first
    );
    const third = roll(
      window({
        toolSituations: [
          {
            name: "write",
            targetPath: "src/a.ts",
            wrote: true,
            escaped: false,
            artifactIds: ["art_1"],
            evidenceIds: ["evd_3"],
            hashes: ["cc"]
          }
        ]
      }),
      second
    );
    assert.ok(third.constraints.some((item) => item.id === "privacy-1"));
    assert.equal(third.failClosed, false);
  });

  it("names a mandatory omission and fails closed instead of dropping it silently", () => {
    const authority: ConstraintRecord = {
      id: "auth-1",
      text: "no production writes",
      kind: "authority",
      mandatory: true
    };
    const result = roll(window({ constraints: [PRIVACY, authority] }), undefined, 1);
    assert.equal(result.failClosed, true);
    assert.ok(result.omissions.some((item) => item.mandatory));
    const omittedIds = new Set(result.omissions.map((item) => item.key));
    const keptIds = new Set(result.constraints.map((item) => item.id));
    assert.ok(omittedIds.size >= 1);
    for (const omission of result.omissions) {
      if (omission.mandatory) {
        assert.ok(!keptIds.has(omission.key) || result.failClosed);
      }
    }
    assert.match(result.failClosedReason ?? "", /mandatory/);
  });

  it("chains prevSummaryHash across three rolls and keeps an early privacy constraint", () => {
    const privacy = { id: "privacy-1", text: "do not persist raw PII", kind: "constraint" as const, mandatory: true as const };
    const window0 = { constraints: [privacy], contextFacts: [], toolSituations: [], unresolvedDecisions: [], confirmedDecisions: [], openMinors: [] };
    const r0 = rollSummary({ window: window0, prescore: 0.8, human: { kind: "unobserved" }, score: 0.8, anomalyCodes: [], evidenceRefs: [], openMinors: [] });
    const r1 = rollSummary({
      window: { ...window0, previous: r0.summary },
      prescore: 0.7, human: { kind: "unobserved" }, score: 0.7, anomalyCodes: [], evidenceRefs: [], openMinors: []
    });
    const r2 = rollSummary({
      window: { ...window0, previous: r1.summary },
      prescore: 0.6, human: { kind: "unobserved" }, score: 0.6, anomalyCodes: [], evidenceRefs: [], openMinors: []
    });
    assert.equal(r0.summary.constraints.some((c) => c.id === "privacy-1"), true);
    assert.equal(r2.summary.constraints.some((c) => c.id === "privacy-1"), true);
    assert.equal(r1.summary.prevSummaryHash, hashSummary({ ...r0.summary, prevSummaryHash: undefined }));
    assert.equal(r2.summary.prevSummaryHash, hashSummary({ ...r1.summary, prevSummaryHash: r1.summary.prevSummaryHash }));
    assert.equal("toolBodies" in r2.summary, false);
  });

  it("records a mandatory omission and failClosed when the budget cannot fit constraints", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      id: `c-${i}`, text: `keep ${i}`, kind: "constraint" as const, mandatory: true as const
    }));
    const r = rollSummary({
      window: { constraints: many, contextFacts: [], toolSituations: [], unresolvedDecisions: [], confirmedDecisions: [], openMinors: [] },
      prescore: 0.5, human: { kind: "unobserved" }, score: 0.5, anomalyCodes: [], evidenceRefs: [], openMinors: [],
      maxItems: 2
    });
    assert.equal(r.summary.failClosed, true);
    assert.ok(r.summary.omissions.some((o) => o.mandatory));
  });

  it("records operations, scores, open minors, and omissions as structured fields", () => {
    const summary = roll(
      window({
        openMinors: [
          {
            id: "typo",
            text: "comment typo",
            status: "verified-true",
            consecutiveTurns: 1,
            touchesConstraint: false,
            userRejected: false
          }
        ]
      })
    );
    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.prescore, 0.8);
    assert.equal(summary.human.kind, "unobserved");
    assert.equal(summary.score, 0.8);
    assert.equal(summary.operations[0]?.name, "read");
    assert.equal(summary.openMinors[0]?.id, "typo");
    assert.ok(summary.unresolvedQuestions.includes("ask about retention"));
    assert.ok(summary.confirmedDecisions.includes("use structured logs"));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HARNESS_EFFICIENCY_MAX_FILE_BYTES,
  analyzeHarnessEfficiency,
  parseEfficiencyJsonl,
  type EfficiencyRow
} from "../../../src/telemetry/harness-efficiency.js";

const SENTINEL = "HARNESS_EFFICIENCY_SECRET_SENTINEL_sk-do-not-echo-7f3a9c";

function row(overrides: Partial<EfficiencyRow> = {}): EfficiencyRow {
  return {
    schemaVersion: 1,
    runId: "r1",
    requestId: "q1",
    observationId: "o1",
    baselineBytes: 1000,
    projectedBytes: 250,
    ...overrides
  };
}

describe("analyzeHarnessEfficiency", () => {
  it("aggregates the complete key case: one pair, two unknown, ratio 0.75", () => {
    const report = analyzeHarnessEfficiency(
      [
        row({ observationId: "o1", baselineBytes: 1000, projectedBytes: 250 }),
        row({ observationId: "o2", baselineBytes: null, projectedBytes: 100 }),
        row({ observationId: "o3", baselineBytes: 1000, projectedBytes: null })
      ],
      "synthetic"
    );
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.evidenceClass, "synthetic");
    assert.equal(report.rowCount, 3);
    assert.equal(report.pairedRows, 1);
    assert.equal(report.unknownRows, 2);
    assert.equal(report.pairedBaselineBytes, 1000);
    assert.equal(report.pairedProjectedBytes, 250);
    assert.equal(report.pairedReductionRatio, 0.75);
    assert.equal(report.monetarySavingUsd, null);
    assert.ok(Array.isArray(report.notes));
  });

  it("treats a missing byte field as null/unknown and never coerces it to 0", () => {
    const report = analyzeHarnessEfficiency(
      [
        row({ observationId: "o1", baselineBytes: null, projectedBytes: null }),
        row({ observationId: "o2", baselineBytes: 500, projectedBytes: 100 })
      ],
      "observed"
    );
    assert.equal(report.evidenceClass, "observed");
    assert.equal(report.rowCount, 2);
    assert.equal(report.pairedRows, 1);
    assert.equal(report.unknownRows, 1);
    assert.equal(report.pairedBaselineBytes, 500);
    assert.equal(report.pairedProjectedBytes, 100);
    assert.equal(report.pairedReductionRatio, 0.8);
  });

  it("rejects a duplicate (runId, requestId, observationId) key", () => {
    assert.throws(
      () =>
        analyzeHarnessEfficiency(
          [row(), row({ baselineBytes: 10, projectedBytes: 1 })],
          "synthetic"
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /line 2: (runId|requestId|observationId)/);
        assert.equal(error.message.includes(SENTINEL), false);
        return true;
      }
    );
  });

  it("returns a null ratio when there are no paired rows", () => {
    const report = analyzeHarnessEfficiency(
      [row({ baselineBytes: null, projectedBytes: 10 })],
      "synthetic"
    );
    assert.equal(report.pairedRows, 0);
    assert.equal(report.unknownRows, 1);
    assert.equal(report.pairedBaselineBytes, 0);
    assert.equal(report.pairedProjectedBytes, 0);
    assert.equal(report.pairedReductionRatio, null);
    assert.equal(report.monetarySavingUsd, null);
  });

  it("returns a null ratio when the paired baseline sum is 0", () => {
    const report = analyzeHarnessEfficiency(
      [row({ baselineBytes: 0, projectedBytes: 0 })],
      "synthetic"
    );
    assert.equal(report.pairedRows, 1);
    assert.equal(report.unknownRows, 0);
    assert.equal(report.pairedBaselineBytes, 0);
    assert.equal(report.pairedProjectedBytes, 0);
    assert.equal(report.pairedReductionRatio, null);
  });

  it("allows a negative reduction ratio and does not clamp it", () => {
    const report = analyzeHarnessEfficiency(
      [row({ baselineBytes: 100, projectedBytes: 150 })],
      "synthetic"
    );
    assert.equal(report.pairedReductionRatio, 1 - 150 / 100);
    assert.ok((report.pairedReductionRatio ?? 0) < 0);
  });

  it("keeps monetarySavingUsd null even when paired bytes are known", () => {
    const report = analyzeHarnessEfficiency([row()], "observed");
    assert.equal(report.monetarySavingUsd, null);
  });

  it("declares the 16 MiB input size cap", () => {
    assert.equal(HARNESS_EFFICIENCY_MAX_FILE_BYTES, 16 * 1024 * 1024);
  });
});

describe("parseEfficiencyJsonl", () => {
  it("ignores blank lines and parses the complete fixture shape", () => {
    const text = [
      "",
      '{"schemaVersion":1,"runId":"r-complete","requestId":"q1","observationId":"o1","baselineBytes":1000,"projectedBytes":250}',
      "   ",
      '{"schemaVersion":1,"runId":"r-complete","requestId":"q2","observationId":"o2","baselineBytes":null,"projectedBytes":100}',
      '{"schemaVersion":1,"runId":"r-complete","requestId":"q3","observationId":"o3","baselineBytes":1000,"projectedBytes":null}',
      ""
    ].join("\n");
    const rows = parseEfficiencyJsonl(text);
    assert.equal(rows.length, 3);
    const report = analyzeHarnessEfficiency(rows, "synthetic");
    assert.equal(report.rowCount, 3);
    assert.equal(report.pairedRows, 1);
    assert.equal(report.unknownRows, 2);
    assert.equal(report.pairedReductionRatio, 0.75);
  });

  it("treats an omitted byte field as null (unknown), not 0", () => {
    const rows = parseEfficiencyJsonl(
      '{"schemaVersion":1,"runId":"r-miss","requestId":"q1","observationId":"o1"}\n'
    );
    assert.equal(rows[0]?.baselineBytes, null);
    assert.equal(rows[0]?.projectedBytes, null);
    const report = analyzeHarnessEfficiency(rows, "synthetic");
    assert.equal(report.unknownRows, 1);
    assert.equal(report.pairedRows, 0);
    assert.equal(report.pairedBaselineBytes, 0);
  });

  it("rejects unknown fields, illegal schema, and required-field problems with line+field only", () => {
    const cases: Array<{ text: string; field: string; line: number }> = [
      {
        text: `{"schemaVersion":1,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":1,"projectedBytes":1,"leak":"${SENTINEL}"}`,
        field: "leak",
        line: 1
      },
      {
        text: '{"schemaVersion":2,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":1,"projectedBytes":1}',
        field: "schemaVersion",
        line: 1
      },
      {
        text: '{"schemaVersion":1,"requestId":"q1","observationId":"o1","baselineBytes":1,"projectedBytes":1}',
        field: "runId",
        line: 1
      },
      {
        text: '{"schemaVersion":1,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":-1,"projectedBytes":1}',
        field: "baselineBytes",
        line: 1
      },
      {
        text: '{"schemaVersion":1,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":1.5,"projectedBytes":1}',
        field: "baselineBytes",
        line: 1
      },
      {
        text: '{"schemaVersion":1,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":9007199254740992,"projectedBytes":1}',
        field: "baselineBytes",
        line: 1
      }
    ];
    for (const item of cases) {
      assert.throws(
        () => parseEfficiencyJsonl(item.text),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, `line ${String(item.line)}: ${item.field}`);
          assert.equal(error.message.includes(SENTINEL), false);
          return true;
        },
        item.field
      );
    }
  });

  it("rejects a truncated last line without echoing the raw fragment", () => {
    const text =
      '{"schemaVersion":1,"runId":"r1","requestId":"q1","observationId":"o1","baselineBytes":1,"projectedBytes":1}\n{"schemaVersion":1,"runId":"r1","requestId":"q2","observationId":"o2","baselineBytes":';
    assert.throws(
      () => parseEfficiencyJsonl(text),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^line 2: (json|truncated)$/);
        assert.equal(error.message.includes("baselineBytes"), false);
        assert.equal(error.message.includes(SENTINEL), false);
        return true;
      }
    );
  });
});

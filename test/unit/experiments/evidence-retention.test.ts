import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertRawEvidenceDeletionAllowed,
  DEFAULT_HOLDOUT_EVIDENCE_RETENTION,
  shouldRetainRawEvidence
} from "../../../src/experiments/evidence-retention.js";
import { assertHoldoutEvidenceDeletionAllowed } from "../../../src/privacy/retention.js";

describe("PS-P4 evidence retention", () => {
  it("default holdout policy keeps raw evidence", () => {
    assert.equal(shouldRetainRawEvidence(DEFAULT_HOLDOUT_EVIDENCE_RETENTION), true);
  });

  it("keep-raw refuses raw deletion", () => {
    assert.throws(
      () =>
        assertRawEvidenceDeletionAllowed({
          policy: DEFAULT_HOLDOUT_EVIDENCE_RETENTION,
          target: "raw"
        }),
      /keep-raw/
    );
  });

  it("retention module wires the holdout gate", () => {
    assert.throws(
      () => assertHoldoutEvidenceDeletionAllowed({ target: "raw" }),
      /keep-raw/
    );
  });

  it("aggregates-only allows raw delete only after aggregate publish", () => {
    assert.throws(
      () =>
        assertRawEvidenceDeletionAllowed({
          policy: { mode: "aggregates-only" },
          target: "raw"
        }),
      /before aggregates/
    );
    assert.doesNotThrow(() =>
      assertRawEvidenceDeletionAllowed({
        policy: { mode: "aggregates-only", maxRawAgeDays: 30 },
        target: "raw",
        aggregatePublished: true
      })
    );
  });
});

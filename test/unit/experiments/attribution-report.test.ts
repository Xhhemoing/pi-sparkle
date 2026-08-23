import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeAttributionPair } from "../../../src/experiments/attribution-report.js";
import { OFFLINE_FIXTURE_ROWS } from "../routing/offline-fixture.js";

describe("attribution report pair", () => {
  it("runs both estimators on the same fixture and never writes a pointer", () => {
    let writes = 0;
    const pair = writeAttributionPair(OFFLINE_FIXTURE_ROWS, {
      writeActivePointer: () => {
        writes += 1;
      }
    });
    assert.equal(pair.logit.estimator, "logit-additive");
    assert.equal(pair.probAdd.estimator, "probability-additive");
    assert.equal(pair.logit.writesActivePointer, false);
    assert.equal(pair.probAdd.writesActivePointer, false);
    assert.equal(writes, 0);
  });
});

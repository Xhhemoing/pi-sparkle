import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRACKING_CONFIG,
  applyUserThreshold,
  trackingConfig
} from "../../../src/tracking/config.js";

describe("tracking config", () => {
  it("defaults the soft threshold to the versioned 0.55 absolute gate", () => {
    assert.equal(DEFAULT_TRACKING_CONFIG.version, 1);
    assert.equal(DEFAULT_TRACKING_CONFIG.softThreshold, 0.55);
    assert.equal(trackingConfig().softThreshold, 0.55);
  });

  it("lets the user change the threshold and rejects an invalid value", () => {
    const next = applyUserThreshold(DEFAULT_TRACKING_CONFIG, 0.6);
    assert.equal(next.softThreshold, 0.6);
    assert.equal(DEFAULT_TRACKING_CONFIG.softThreshold, 0.55);
    assert.throws(() => applyUserThreshold(DEFAULT_TRACKING_CONFIG, 1.2), /soft threshold/);
  });
});

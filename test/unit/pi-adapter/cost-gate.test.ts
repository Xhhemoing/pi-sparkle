import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CostGate, catalogPrices } from "../../../src/pi-adapter/cost-gate.js";

describe("CostGate", () => {
  it("stops only when cumulative catalog-priced usage reaches the cap", () => {
    const gate = new CostGate({
      maxCostUsd: 10,
      prices: { inputUsdPerMTok: 1_000_000, outputUsdPerMTok: 2_000_000 }
    });

    gate.recordTurn({ inputTokens: 2, outputTokens: 1 });
    assert.equal(gate.spentUsd, 4);
    assert.equal(gate.requestStopIfExceeded(), false);

    gate.recordTurn({ inputTokens: 2, outputTokens: 2 });
    assert.equal(gate.spentUsd, 10);
    assert.equal(gate.requestStopIfExceeded(), true);
    assert.deepEqual(gate.ledger, {
      turns: 2,
      turnsWithoutUsage: 0,
      tokensIn: 4,
      tokensOut: 3,
      spentUsd: 10
    });
  });

  it("does not invent spend or request a stop when catalog pricing is unknown", () => {
    const prices = catalogPrices({ input: 0, output: 0 });
    const gate = new CostGate({ maxCostUsd: 0.01, ...(prices !== undefined ? { prices } : {}) });

    gate.recordTurn({ inputTokens: 1_000_000, outputTokens: 1_000_000 });

    assert.equal(prices, undefined);
    assert.deepEqual(gate.state, { armed: false, reason: "unpriced-model" });
    assert.equal(gate.spentUsd, undefined);
    assert.equal(gate.requestStopIfExceeded(), false);
    assert.equal(gate.stopRequested, false);
  });
});

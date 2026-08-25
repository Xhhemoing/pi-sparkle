import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CostGate, catalogPrices } from "../../../src/pi-adapter/cost-gate.js";
import {
  SparkleKernel,
  type SparkleKernelAgent,
  type SparkleKernelEvent,
  type SparkleKernelUserMessage
} from "../../../src/pi-adapter/kernel.js";

/**
 * The arithmetic and the disarm rules behind the spend ceiling, plus the
 * kernel seam that carries the resulting predicate into the agent loop.
 * End-to-end "the loop really stopped" coverage lives with the executor tests.
 */

const PRICES = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };

describe("catalogPrices", () => {
  it("reads a priced catalog entry", () => {
    assert.deepEqual(catalogPrices({ input: 3, output: 15 }), PRICES);
  });

  it("keeps a one-sided price, which is still a real rate", () => {
    assert.deepEqual(catalogPrices({ input: 0, output: 15 }), {
      inputUsdPerMTok: 0,
      outputUsdPerMTok: 15
    });
  });

  it("treats an all-zero entry as no price on file, not as free", () => {
    // runtime.ts fills an unspecified custom-provider rate with zero, so zero
    // on both sides cannot be distinguished from a model nobody priced.
    assert.equal(catalogPrices({ input: 0, output: 0 }), undefined);
  });

  it("rejects missing, negative, and non-finite rates", () => {
    assert.equal(catalogPrices(undefined), undefined);
    assert.equal(catalogPrices({ input: 3 }), undefined);
    assert.equal(catalogPrices({ input: -1, output: 15 }), undefined);
    assert.equal(catalogPrices({ input: Number.NaN, output: 15 }), undefined);
  });
});

describe("CostGate arming", () => {
  it("arms only with both a usable ceiling and a price", () => {
    assert.equal(new CostGate({ maxCostUsd: 1, prices: PRICES }).armed, true);
    assert.equal(new CostGate({ prices: PRICES }).armed, false);
    assert.equal(new CostGate({ maxCostUsd: 1 }).armed, false);
  });

  it("names why it is disarmed so the caller can log the difference", () => {
    assert.deepEqual(new CostGate({ prices: PRICES }).state, { armed: false, reason: "no-cap" });
    assert.deepEqual(new CostGate({ maxCostUsd: 1 }).state, {
      armed: false,
      reason: "unpriced-model"
    });
    assert.deepEqual(new CostGate({ maxCostUsd: 0, prices: PRICES }).state, {
      armed: false,
      reason: "invalid-cap"
    });
    assert.deepEqual(new CostGate({ maxCostUsd: Number.NaN, prices: PRICES }).state, {
      armed: false,
      reason: "invalid-cap"
    });
  });

  it("never stops an unpriced run, however many tokens it burns", () => {
    const gate = new CostGate({ maxCostUsd: 0.000_001 });
    gate.recordTurn({ inputTokens: 5_000_000, outputTokens: 5_000_000 });
    assert.equal(gate.spentUsd, undefined, "no price means no dollar figure may be invented");
    assert.equal(gate.exceeded, false);
    assert.equal(gate.requestStopIfExceeded(), false);
    assert.equal(gate.stopRequested, false);
  });
});

describe("CostGate accounting", () => {
  it("prices accumulated usage across turns", () => {
    const gate = new CostGate({ maxCostUsd: 1, prices: PRICES });
    gate.recordTurn({ inputTokens: 1_000_000, outputTokens: 0 });
    assert.equal(gate.spentUsd, 3);
    gate.recordTurn({ inputTokens: 0, outputTokens: 100_000 });
    assert.equal(gate.spentUsd, 4.5);
    assert.deepEqual(gate.ledger, {
      turns: 2,
      turnsWithoutUsage: 0,
      tokensIn: 1_000_000,
      tokensOut: 100_000,
      spentUsd: 4.5
    });
  });

  it("counts a turn that reported nothing as unseen spend, not as zero spend", () => {
    const gate = new CostGate({ maxCostUsd: 1, prices: PRICES });
    gate.recordTurn(undefined);
    gate.recordTurn({});
    gate.recordTurn({ inputTokens: 100 });
    assert.equal(gate.ledger.turns, 3);
    assert.equal(gate.ledger.turnsWithoutUsage, 2);
    assert.equal(gate.ledger.tokensIn, 100);
  });

  it("ignores counts the invocation validator would also reject", () => {
    const gate = new CostGate({ maxCostUsd: 1, prices: PRICES });
    gate.recordTurn({ inputTokens: -5, outputTokens: 1.5 });
    assert.equal(gate.ledger.tokensIn, 0);
    assert.equal(gate.ledger.tokensOut, 0);
    assert.equal(gate.ledger.turnsWithoutUsage, 1);
  });

  it("trips when observed spend reaches the ceiling and latches the request", () => {
    const gate = new CostGate({ maxCostUsd: 3, prices: PRICES });
    gate.recordTurn({ inputTokens: 999_999 });
    assert.equal(gate.exceeded, false, "just under the ceiling keeps running");
    assert.equal(gate.requestStopIfExceeded(), false);

    gate.recordTurn({ inputTokens: 1 });
    assert.equal(gate.exceeded, true, "reaching the ceiling counts as reaching it");
    assert.equal(gate.requestStopIfExceeded(), true);
    assert.equal(gate.stopRequested, true, "the caller can tell the ceiling ended the run");
  });
});

class StopHookAgent implements SparkleKernelAgent {
  sessionId?: string;
  state = { isStreaming: false };
  shouldStopAfterTurn?: ((...args: never[]) => boolean | Promise<boolean>) | undefined;

  subscribe(): () => void {
    return () => undefined;
  }

  async prompt(): Promise<void> {}
  abort(): void {}
  async waitForIdle(): Promise<void> {}
  reset(): void {}
  steer(_message: SparkleKernelUserMessage): void {}
  followUp(_message: SparkleKernelUserMessage): void {}

  /** Stand-in for the loop's post-turn call, which passes a turn context. */
  askAfterTurn(): boolean | Promise<boolean> | undefined {
    return this.shouldStopAfterTurn?.(...([{ type: "turn_end" }] as unknown as never[]));
  }
}

describe("SparkleKernel stop-after-turn", () => {
  it("installs the predicate from options and consults it per turn", () => {
    const agent = new StopHookAgent();
    let stop = false;
    SparkleKernel.fromFactory(() => agent, { stopAfterTurn: () => stop });

    assert.equal(agent.askAfterTurn(), false);
    stop = true;
    assert.equal(agent.askAfterTurn(), true, "the predicate is re-read, not snapshotted");
  });

  it("replaces and removes an installed predicate", () => {
    const agent = new StopHookAgent();
    const kernel = SparkleKernel.fromAgent(agent);
    assert.equal(agent.askAfterTurn(), undefined, "no predicate unless one is asked for");

    kernel.setStopAfterTurn(() => true);
    assert.equal(agent.askAfterTurn(), true);

    kernel.setStopAfterTurn(undefined);
    assert.equal(agent.shouldStopAfterTurn, undefined);
    assert.equal(agent.askAfterTurn(), undefined);
  });

  it("keeps the hook out of the facade's own surface", () => {
    // The predicate takes no arguments, so nothing about the loop's turn
    // context — a Pi type — reaches a caller of the kernel.
    const agent = new StopHookAgent();
    const seen: SparkleKernelEvent[] = [];
    SparkleKernel.fromAgent(agent, {
      stopAfterTurn: () => {
        seen.push({ type: "asked" });
        return false;
      }
    });
    agent.askAfterTurn();
    assert.deepEqual(seen, [{ type: "asked" }]);
  });
});

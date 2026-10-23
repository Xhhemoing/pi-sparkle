/**
 * Spend ceiling for a live agent run.
 *
 * `RunLimits.maxCostUsd` was validated and then enforced nowhere: the loop had
 * no way to stop itself part-way through a task. Pi's completed-turn hook is
 * that way, and this module is the arithmetic behind the predicate — kept
 * apart from the executor so the rule it encodes can be read, and tested, on
 * its own.
 *
 * The cap uses a conservative budget reference, not a provider bill: reported
 * usage priced by the catalog, or a higher validated SDK amount. Missing or
 * contradictory observations retain incomplete coverage, not a free turn or
 * a claim that this reference is a lower bound on actual charges. No usable
 * model price disarms the gate; missing usage leaves a priced gate armed but
 * its budget coverage incomplete.
 */

/** Catalog rates in USD per million tokens, as `listed-model.ts` reports them. */
export interface CostGatePrices {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
}

/** Provider-reported usage for one finished turn. */
export interface CostGateUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
}

/** Internal per-turn conservative budget reference; not a provider billing receipt. */
export interface CostGatePricingObservation {
  /** Usable reference amount or subtotal. Missing remains uncovered, never a free turn. */
  readonly referenceUsd?: number | undefined;
  readonly complete: boolean;
}

export type CostGateDisarmedReason =
  /** No ceiling was requested. */
  | "no-cap"
  /** A ceiling was requested but is not a positive finite number of dollars. */
  | "invalid-cap"
  /** The catalog quotes no usable price for this model, so spend is unknowable. */
  | "unpriced-model";

export type CostGateState =
  | { readonly armed: true; readonly maxCostUsd: number; readonly prices: CostGatePrices }
  | { readonly armed: false; readonly reason: CostGateDisarmedReason };

/** What the gate observed, for the caller's log. */
export interface CostGateLedger {
  /** Finished turns the gate was shown. */
  readonly turns: number;
  /**
   * Turns without complete, consistent usage/pricing coverage. A nonzero
   * count means `spentUsd` is an incomplete conservative budget reference,
   * not a complete cost, actual bill, or guaranteed lower bound on charges.
   */
  readonly turnsWithoutUsage: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Conservative budget reference; undefined while the model is unpriced. */
  readonly spentUsd: number | undefined;
}

const USD_PER_MTOK = 1_000_000;

/**
 * Read catalog rates off a resolved model's cost block.
 *
 * Both rates at zero reads as "no price on file", not "free": the
 * custom-provider path in `runtime.ts` fills unspecified rates with zero, so a
 * zero pair cannot be told apart from a model nobody priced. Treating it as
 * unknown disarms the gate, which is the direction that fails safe — the
 * alternative is a cap that never trips while claiming to be enforced.
 */
export function catalogPrices(
  cost: { readonly input?: unknown; readonly output?: unknown } | undefined
): CostGatePrices | undefined {
  const inputUsdPerMTok = usdRate(cost?.input);
  const outputUsdPerMTok = usdRate(cost?.output);
  if (inputUsdPerMTok === undefined || outputUsdPerMTok === undefined) return undefined;
  if (inputUsdPerMTok === 0 && outputUsdPerMTok === 0) return undefined;
  return { inputUsdPerMTok, outputUsdPerMTok };
}

/**
 * Accumulates priced spend across the turns of one execution and answers
 * whether the ceiling has been reached.
 *
 * Usage is counted whatever the turn's eventual outcome, which is a deliberate
 * departure from `sumUsage`'s cost-eligibility rule. That rule drops non-`ok`
 * calls to keep per-token averages from being dragged toward zero by error
 * payloads; a ceiling asks a different question. Tokens a provider reported
 * before a stream failed still contribute to the reference, and excluding them
 * makes the cap under-enforce. The raw SDK observer retains cache-only turns;
 * wholly zeroed usage remains unknown and adds no invented reference amount.
 */
export class CostGate {
  /** The ceiling as asked for, kept so an unusable one can be named as such. */
  private readonly requestedCap: number | undefined;
  private readonly maxCostUsd: number | undefined;
  private readonly prices: CostGatePrices | undefined;
  private turns = 0;
  private turnsWithoutUsage = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private stopped = false;
  private referenceUsd = 0;

  constructor(input: {
    readonly maxCostUsd?: number | undefined;
    readonly prices?: CostGatePrices | undefined;
  }) {
    this.requestedCap = input.maxCostUsd;
    this.maxCostUsd =
      input.maxCostUsd !== undefined && Number.isFinite(input.maxCostUsd) && input.maxCostUsd > 0
        ? input.maxCostUsd
        : undefined;
    this.prices = input.prices;
  }

  get state(): CostGateState {
    if (this.maxCostUsd !== undefined && this.prices !== undefined) {
      return { armed: true, maxCostUsd: this.maxCostUsd, prices: this.prices };
    }
    return { armed: false, reason: this.reason() };
  }

  get armed(): boolean {
    return this.maxCostUsd !== undefined && this.prices !== undefined;
  }

  /** True once {@link requestStopIfExceeded} has asked the loop to stop. */
  get stopRequested(): boolean {
    return this.stopped;
  }

  /** Conservative budget reference so far; undefined while no model price is known. */
  get spentUsd(): number | undefined {
    if (this.prices === undefined) return undefined;
    return Number.isFinite(this.referenceUsd) ? roundUsd(this.referenceUsd) : undefined;
  }

  /** True when the gate is armed and observed spend has reached the ceiling. */
  get exceeded(): boolean {
    const spent = this.spentUsd;
    return this.maxCostUsd !== undefined && spent !== undefined && spent >= this.maxCostUsd;
  }

  get ledger(): CostGateLedger {
    return {
      turns: this.turns,
      turnsWithoutUsage: this.turnsWithoutUsage,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      spentUsd: this.spentUsd
    };
  }

  /**
   * Fold one finished turn into the ledger. Counts that are not non-negative
   * integers are ignored the same way the invocation validator ignores them,
   * and a turn that contributed nothing is recorded as unseen spend rather
   * than as zero spend.
   */
  recordTurn(usage: CostGateUsage | undefined, pricing?: CostGatePricingObservation): void {
    this.turns += 1;
    const inputTokens = tokenCount(usage?.inputTokens);
    const outputTokens = tokenCount(usage?.outputTokens);
    this.tokensIn += inputTokens ?? 0;
    this.tokensOut += outputTokens ?? 0;
    if (pricing !== undefined) {
      const amount = usdRate(pricing.referenceUsd);
      if (!pricing.complete || amount === undefined) this.turnsWithoutUsage += 1;
      if (amount !== undefined) this.referenceUsd += amount;
      return;
    }
    if (inputTokens === undefined && outputTokens === undefined) {
      this.turnsWithoutUsage += 1;
      return;
    }
    // Existing in-process callers supply only the two legacy token fields.
    // Raw Pi messages use the explicit observation above, including cache.
    if (this.prices !== undefined) {
      this.referenceUsd +=
        ((inputTokens ?? 0) / USD_PER_MTOK) * this.prices.inputUsdPerMTok +
        ((outputTokens ?? 0) / USD_PER_MTOK) * this.prices.outputUsdPerMTok;
    }
  }
  /**
   * The predicate handed to the agent loop: true asks it to finish this turn
   * and stop before the next provider request. Latches, so the caller can tell
   * afterwards that the ceiling — not the model — ended the run.
   */
  requestStopIfExceeded(): boolean {
    if (!this.exceeded) return false;
    this.stopped = true;
    return true;
  }

  private reason(): CostGateDisarmedReason {
    if (this.requestedCap === undefined) return "no-cap";
    if (this.maxCostUsd === undefined) return "invalid-cap";
    return "unpriced-model";
  }
}

function usdRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Mirrors the invocation validator: usage is a non-negative integer or nothing. */
function tokenCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Round to 6 decimal places so repeated addition stays drift-free. */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

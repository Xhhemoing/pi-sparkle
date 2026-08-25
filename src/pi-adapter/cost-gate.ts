/**
 * Spend ceiling for a live agent run.
 *
 * `RunLimits.maxCostUsd` was validated and then enforced nowhere: the loop had
 * no way to stop itself part-way through a task. Pi's `shouldStopAfterTurn` is
 * that way, and this module is the arithmetic behind the predicate — kept
 * apart from the executor so the rule it encodes can be read, and tested, on
 * its own.
 *
 * The rule: a cap is enforced only against money that can be accounted for.
 * That means provider-reported token counts (never an estimate from prompt
 * length) priced with the catalog entry the rest of sparkle already quotes
 * (never a guessed rate). Miss either input and the gate disarms and says so.
 * An unenforced cap the operator is told about is honest; a cap that looks
 * enforced but rests on invented prices is not.
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
   * Turns whose provider reported no usable usage. Every one of these is spend
   * the ceiling could not see, so a nonzero count means `spentUsd` is a floor.
   */
  readonly turnsWithoutUsage: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Priced spend for the reported usage; undefined while the gate is unpriced. */
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
 * before a stream failed are tokens it will still bill, and excluding them
 * makes the cap under-enforce. All-zero usage never reaches here — the
 * translator drops it — so an error payload's zeroed block adds nothing.
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

  /** Priced spend so far; undefined while no price is known. */
  get spentUsd(): number | undefined {
    if (this.prices === undefined) return undefined;
    return roundUsd(
      (this.tokensIn / USD_PER_MTOK) * this.prices.inputUsdPerMTok +
        (this.tokensOut / USD_PER_MTOK) * this.prices.outputUsdPerMTok
    );
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
  recordTurn(usage: CostGateUsage | undefined): void {
    this.turns += 1;
    const inputTokens = tokenCount(usage?.inputTokens);
    const outputTokens = tokenCount(usage?.outputTokens);
    if (inputTokens === undefined && outputTokens === undefined) {
      this.turnsWithoutUsage += 1;
      return;
    }
    this.tokensIn += inputTokens ?? 0;
    this.tokensOut += outputTokens ?? 0;
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

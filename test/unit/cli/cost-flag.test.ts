import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCostGateWarning, parseRunCostCeiling } from "../../../src/cli/main.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import type { TaskId } from "../../../src/domain/ids.js";
import type { CostGateEvent } from "../../../src/pi-adapter/pi-executor.js";

const TASK_ID = "tsk_00000000-0000-4000-8000-000000000002" as TaskId;

test("parseRunCostCeiling leaves an omitted flag undefined", () => {
  // The whole point of the absent arm: no layer invents a cap, so a run
  // without the flag must reach `startRun` exactly as it did before it existed.
  assert.equal(parseRunCostCeiling(undefined), undefined);
});

test("parseRunCostCeiling accepts plain positive decimals", () => {
  for (const [raw, expected] of [
    ["5", 5],
    ["0.5", 0.5],
    ["0.01", 0.01],
    ["0.000001", 0.000001],
    ["10.25", 10.25],
    ["100", 100],
    ["007", 7]
  ] as const) {
    assert.equal(parseRunCostCeiling(raw), expected, raw);
  }
});

test("parseRunCostCeiling refuses everything else with the frozen message", () => {
  // `1e4`, `0x10`, ` 5 ` and `+5` all coerce to a number JavaScript accepts
  // and an operator did not mean to type; `0` and negatives are numbers the
  // gate could never arm on. A budget is the wrong place to guess.
  for (const raw of [
    "0",
    "0.0",
    "-1",
    "-0.5",
    "1e4",
    "1E4",
    "0x10",
    " 5 ",
    "5 ",
    "+5",
    ".5",
    "5.",
    "1_000",
    "abc",
    "NaN",
    "Infinity",
    "$5",
    "5usd",
    ""
  ]) {
    assert.throws(
      () => parseRunCostCeiling(raw),
      (error: unknown) =>
        error instanceof DomainValidationError &&
        error.message ===
          `--max-cost-usd must be a positive finite number of US dollars, got: ${raw}`,
      `expected ${JSON.stringify(raw)} to be refused`
    );
  }
});

test("formatCostGateWarning byte-pins the unpriced-model warning", () => {
  const event: CostGateEvent = {
    kind: "disarmed",
    taskId: TASK_ID,
    maxCostUsd: 0.01,
    reason: "unpriced-model"
  };
  assert.equal(
    formatCostGateWarning(event),
    "warning: cost ceiling not enforced for task tsk_00000000-0000-4000-8000-000000000002: requested 0.01 USD, but the catalog quotes no usable price for this model, so spend is unknowable; the run continues uncapped\n"
  );
});

test("formatCostGateWarning byte-pins the invalid-cap warning", () => {
  const event: CostGateEvent = {
    kind: "disarmed",
    taskId: TASK_ID,
    maxCostUsd: -1,
    reason: "invalid-cap"
  };
  assert.equal(
    formatCostGateWarning(event),
    "warning: cost ceiling not enforced for task tsk_00000000-0000-4000-8000-000000000002: requested -1 USD is not a positive finite number of dollars; the run continues uncapped\n"
  );
});

test("formatCostGateWarning prints nothing for no-cap or a real ceiling stop", () => {
  // `no-cap` is unreachable (the executor emits disarmed only when a cap was
  // requested) and `stopped` is already transcript-visible; a second line
  // would be a claim with no new fact behind it.
  assert.equal(
    formatCostGateWarning({
      kind: "disarmed",
      taskId: TASK_ID,
      maxCostUsd: 0.5,
      reason: "no-cap"
    }),
    undefined
  );
  assert.equal(
    formatCostGateWarning({
      kind: "stopped",
      taskId: TASK_ID,
      maxCostUsd: 0.5,
      ledger: { turns: 2, turnsWithoutUsage: 0, tokensIn: 100, tokensOut: 50, spentUsd: 0.5 }
    }),
    undefined
  );
});

[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 2 · R2-5 — `maxCostUsd` honesty + coordinator O(n²) validation

Branch `agent/opt-continuous`, working tree only (no commit, per instruction).

## (a) `maxCostUsd`: enforcement investigated, non-enforcement documented

**Decision: document, do not enforce.** Cost is not cheaply derivable at the coordinator, and
making it derivable is exactly the calibration pipeline the slot forbids.

Evidence gathered before deciding:

- The coordinator's only usage signal is `ExecutionEvent` `TURN_FINISHED.usage`
  (`src/execution/contract.ts:22`), which carries `inputTokens` / `outputTokens` and no money.
- Tokens → USD needs a per-model price table. The type for one exists
  (`InvocationPricing` with `catalogVersion` / `inputUsdPerMTok` / `outputUsdPerMTok`,
  `src/telemetry/model-invocation.ts:36-40`) but `rg 'pricing' src` returns **only** that
  declaration and its validator: nothing in `src/` ever populates it, and there is no price
  catalog module. Building one is a new calibration pipeline.
- The only live cost gate is the experiments plane's own threshold
  (`accumulatedCostUsd(outcomes) > plan.thresholds.maxCostUsd`, `src/experiments/shadow.ts:225`),
  fed by externally supplied per-outcome `costUsd` values. It never reads `ChildRunLimits`.
- No producer in `src/` even sets `ChildRunLimits.maxCostUsd` today (all five construction sites
  set the three integer fields only), so the field is a declaration end to end.

What landed instead — the declaration now says it does not work, at both places a reader looks:

- `src/protocol/v1.ts`: interface-level doc on `ChildRunLimits` naming which three fields are
  honored and by whom, plus a field-level disclosure on `maxCostUsd` ("Validated for shape but
  **not enforced** at the child level"), why (no price catalog behind the token-only stream), and
  where the one real cost gate lives.
- `src/run/child-coordinator.ts`: matching disclosure on `ChildTaskInput.limits`.

Pinned by two tests so the disclosure cannot rot silently:

- `test/unit/protocol/v1.test.ts` — "maxCostUsd is declared with its non-enforcement disclosed,
  and nothing reads it": accepts a request carrying the field, asserts the disclosure text is
  present in `src/protocol/v1.ts`, and asserts `child-coordinator.ts` contains no
  `limits.maxCostUsd` read. If anyone wires enforcement, this goes red and forces the doc to be
  rewritten in the same change.
- `test/unit/run/child-coordinator-limits.test.ts` — "maxCostUsd is inert": a child declaring
  `maxCostUsd: 0.000001` and burning 10M reported tokens still settles SUCCESS in one attempt,
  and the summary claims no cost ceiling. This is a behavioral pin of the documented state, not
  an endorsement of it.

## (b) O(n²) → O(n) transcript validation

`child-coordinator.ts` called `assertAtMostOneTerminal([...seen, message])` per incoming message,
re-validating the whole prefix each time (T8 review nit). Replaced with a per-attempt
`AttemptTranscript` that holds the message list and a `sawTerminal` flag: each message is
validated exactly once (already done by the existing `validateAgentMessage` on arrival) and the
terminal check is a boolean.

Semantics deliberately unchanged:

- The transcript is per attempt, as `seen` was, so a terminal in attempt 1 followed by a terminal
  in attempt 2 (the cascade-escalation path) is still legal — covered by the pre-existing
  "a generous wall budget leaves the cascade escalation untouched" test, still green.
- A second terminal within one attempt still throws `DomainValidationError` with the **same
  message string** as `assertAtMostOneTerminal`; rejection still happens before the message is
  recorded and before the parent `CHILD_MESSAGE` event is appended. The pre-existing integration
  test "a duplicate terminal result fails the child run" is untouched and green.
- Wording drift between the two enforcement points is pinned by a new test that compares the
  coordinator's failure summary to the string `assertAtMostOneTerminal([terminal, terminal])`
  actually throws.

`assertAtMostOneTerminal` itself is unmodified (fuzz target intact); its doc comment now says it
is the whole-transcript check and points at the incremental enforcement point.

### Measured, not asserted

New regression test "transcript validation cost is linear in the number of child messages" counts
validations directly: each PROGRESS message carries a getter on `protocolVersion` (read by the
protocol validator, by `validateEvent`'s `CHILD_MESSAGE` branch, and by JSON serialization — and
by nothing else on the coordinator path), so getter hits count validations.

| 40 child messages | `protocolVersion` reads |
|---|---|
| before (prefix re-validation, temporarily restored to check) | 980 |
| after (incremental flag) | 120 (3 per message) |

The bound asserted is `<= 4 * messageCount` (160): comfortably above the constant-per-message
cost, far below the quadratic one. I verified the test is not vacuous by restoring the old
`assertAtMostOneTerminal([...transcript.messages, message])` line and watching it fail with
`saw 980 for 40 messages`, then reverting.

## T6 cancel / wall-time behavior

Untouched: no edit to `cancelledChildren`, the wall deadline timer, the attempt-controller map, or
the outcome ladder. All six pre-existing T6 tests in the owned file remain green unmodified.

## Verification run (this VM, Node v22.14.0)

- `node scripts/run-tests.mjs test/unit/run/child-coordinator-limits.test.ts
  test/unit/protocol/v1.test.ts test/unit/protocol/fuzz.test.ts` → **31/31 pass, 0 fail**
  (fuzz seed `0x4f310008` green, unmodified).
- `node scripts/run-tests.mjs test/integration/m1/child-coordinator.test.ts` → **16/16 pass**
  (not owned; run because it exercises the duplicate-terminal and message-rejection paths).
- `npx eslint` on the four owned source/test files → clean.
- `npx tsc --noEmit` (whole tree) → **3 errors, all in `src/run/flowchart-run.ts`**
  (`Property 'track' does not exist on type 'AbortController'`, two `RunAbortScope` mismatches).
  These are R2-1's in-flight edits in a file I do not own; none of my files appear. Same cause for
  the 2 failures in `test/unit/run` (`ctx.abort.cancelAndSettle is not a function`, stack entirely
  inside `flowchart-run.ts`) — the other 109 tests in that directory pass, including all of mine.
- No full gate run (per instruction).

## Files changed

- `src/run/child-coordinator.ts` — `AttemptTranscript`, incremental terminal check, limits
  disclosure.
- `src/protocol/v1.ts` — docs only: `ChildRunLimits` / `maxCostUsd` disclosure,
  `assertAtMostOneTerminal` note. No message shape, signature, or validation behavior changed.
- `test/unit/run/child-coordinator-limits.test.ts` — 3 new tests (wording parity, linear
  validation cost, `maxCostUsd` inert) plus a scripted-executor helper.
- `test/unit/protocol/v1.test.ts` — 1 new docs/enforcement pin.

## Disclosures

- The cost ceiling still does not work. What changed is that the contract now says so, in both
  places a caller reads it, with tests that break if either half drifts. Anyone who wants real
  enforcement needs a price catalog first; that is not this slot.
- The linear-cost test's bound is a proxy metric (validator getter hits), not wall time. It is
  deterministic and was verified to catch the pre-fix implementation, but it would not notice a
  regression that adds cost outside `validateAgentMessage`.
- Duplicate-terminal wording is now produced in two places. They are kept identical by a test, not
  by a shared constant, because `protocol/v1.ts` was docs/fix-only for this slot.

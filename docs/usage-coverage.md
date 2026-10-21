# Reported usage coverage

Use `summarizeUsageCoverage(rows)` from `src/telemetry/usage-coverage.ts` for a read-only summary of recorded `ModelInvocation` rows. It includes successful, failed, timed-out, cancelled and unknown outcomes. Existing success-only calibration aggregates keep their original behavior.

The result reports raw records, unique invocation identities, exact duplicates and conflicting identities. Conflicting variants are all excluded from numeric summaries and prevent a complete-total claim. Input ordering does not select a winner or change summation order.

Each outcome and the overall summary distinguish reported, missing and invalid input/output token counts and snapshot prices. Actual zero remains zero; absent usage or pricing stays unknown. `knownUsd` estimates only the subset of whole invocations with both valid token sides and both valid snapshot prices. `completeUsd` is present only when every recorded identity is covered without conflict or arithmetic overflow. Neither field is a settled provider bill or proof that every call was recorded. Unsafe token sums or non-finite cost arithmetic suppress cost numbers.

The function does not fetch prices, write telemetry, mutate input rows or change routing. Its TypeScript result is readonly; it is not a recursively frozen runtime object. Only recorded per-invocation pricing is used, including its catalog version.

Verification: `pnpm test --test-concurrency=1 test/unit/telemetry/usage-coverage.test.ts test/unit/telemetry/usage-aggregate.test.ts`. Current evidence and remaining integration checks are in [the staged record](reports/2026-10-19-staged-continuation.md).

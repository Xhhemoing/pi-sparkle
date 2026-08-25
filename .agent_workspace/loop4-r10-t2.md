# Loop 4 Round 10 — R10-2 deferred option (a) freeze

## Outcome

Option (a) remains unimplemented. This slot changed tests only:

- Added a meta-pin in `test/unit/tracking/option-a-preconditions.test.ts` that requires the exact R8-4 titles for pins 1, 3, 4, and 5. The four protected tests and their existing assertions were not replaced, weakened, or deleted. Pin 2 was not changed.
- Added a protocol-local compile-time and source-level pin in `test/unit/protocol/v1.test.ts`: `"criteria"` must not be a key of `VerificationResult`, and the declared interface must not contain a `criteria` field.
- This slot did not edit any `src/**` file. Option (a), `pi-executor.ts`, `replay.ts`, and tracking production code were not changed by R10-2.

## Census first

Taken against the working tree before edits and rechecked at `2026-08-24T23:05:27Z`:

- The handed protocol test path exists: `test/unit/protocol/v1.test.ts`.
- `src/protocol/v1.ts` declares `VerificationResult` with only `kind` and `evidenceIds`; its validator reads those same fields. A direct `criteria` field search in that file returned no matches.
- The named `VerificationResult` source consumers are its declaration/validator in `src/protocol/v1.ts` and the type consumer in `src/graph/judge.ts`. The broader verification census also found the existing executor, tracking, run, routing, and learning readers; none implements a per-criterion protocol channel.
- The exact R8-4 titles for pins 1, 3, 4, and 5 were present before the change and remain present. The new meta-pin makes their deletion or renaming fail.

## Verification

- `pnpm test -- test/unit/tracking/option-a-preconditions.test.ts test/unit/protocol/v1.test.ts` — 25 passed, 0 failed, 0 skipped.
- `pnpm exec eslint test/unit/tracking/option-a-preconditions.test.ts test/unit/protocol/v1.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` — whole tree, exit 0 on the first run. A recheck at `2026-08-24T23:06:19Z`, after concurrent edits arrived, failed only at `test/unit/run/gate-status-posture.test.ts:425`: that sibling test calls `makeEvent("RUN_UNBLOCKED_WITH_DISCARD", ...)`, while R10-1 has not yet added that event anywhere under `src/**`. This is an attributed shared-tree sequencing transient, not an R10-2 failure.
- `git diff --check` — exit 0.
- The expected Node v22.14.0 engine warning was observed. No full gate was run. No skip or scratch file was added.

## Shared-tree note

At the `2026-08-24T23:06:19Z` census, concurrent owned changes were present under `docs/**` (R10-3), `src/run/child-tracking.ts` and `src/tracking/{from-child,prescore}.ts` (R10-5), `test/integration/m2.5/resume.test.ts` (R10-4), `test/unit/pi-adapter/report-task-result.test.ts` (R10-6), and the R10-8/R10-9 run test files. They belong to other Round 10 slots and were not touched here. The R10-9/R10-1 sequencing transient is disclosed above.

No checkout, commit, or push was performed.

# Round 2 fable-2
MODEL_SLUG: claude-fable-5-thinking-xhigh

Full evidence report: `docs/reports/2026-08-24-sota-r2-isolation.md`.
Honesty updates applied: `docs/data-dictionary.md` (delete-tooling section
rewritten to the verified Round 2 behavior; remaining-limits list pruned to
what is actually still open), `docs/decisions/0005` (enforcement note
refreshed — the closure-check follow-up shipped; decision text untouched).
ADR-006 left Proposed. P0 sign-off left open. No src/test edits.

## Isolation delta vs R1

- R1's top gap is closed in this tree: `live-isolation.test.ts` is now a
  transitive import-closure check from four live entry points, with the
  two known leaks (bandit via `bandit-store`, topology via `supervisor`)
  pinned to their exact importers plus symbol-level guards (`selectArm` /
  `loadProjectBandit` / `planTaskTopology` may gain no live caller).
- Independent walker re-run agrees with the test: r1/shadow/report/compare/
  holdout absent from all four closures; same two allowances; r0 present via
  the evidence-cascade value import (its stale header comment is now fixed to
  say exactly that).
- `plane-boundary.test.ts` gained `../supervisor/` + `../cli/` prefixes; the
  exposed `eval-routing → model-router` import is pinned type-only and a new
  test fails if a type-only exception becomes a value import or goes stale.
- `bandit.json` reads now validated (`isBanditState`); corrupt state loads as
  undefined instead of being trusted.

## Privacy delta vs R1

Closed by opus-2's cascade (landed mid-audit; I verified each on-disk against
a scratch state root, plus suites):

- Cascade strips **both `body` and `summary`** physically from
  `records.jsonl` (was: summary survived).
- `delete --run` filter-rewrites the global `invocations.jsonl` under the log
  lock (fail-closed on corrupt middle lines) and invalidates
  `catalog-observed.json` (was: neither touched).
- Episode `.lock` removed on delete (was: survived).
- `record-classes.ts` reconciled: feedback `sensitiveFields` now
  `["body","summary"]`; phantom propagations (`run-event → episode`,
  `feedback → preference-dataset`, `candidate → experiment`) removed;
  `deletionPropagatesTo` documented as a behavioral claim.
- Bonus runtime-data-quality close: cost calibration now gates on
  `isCostEligible` with exclusion counters (failed/legacy rows no longer drag
  per-token averages).

Still open (kept disclosed in the dictionary): EPISODE_OPENED copy of episode
text in attached runs' event logs; no preference cascade on episode delete;
`redacted: true` still means pass-ran (classes not persisted); new residual —
deleting a still-executing run races the lock-free invocation appender.

## ADR

- 004 accurate, untouched. 005: enforcement note refreshed to the shipped
  closure test (decision unchanged). 006: all three interim constraints
  re-verified (no `pi.extensions`, no `pi-coding-agent` import, skill still
  diagnostic-overlay-only); left Proposed. No Outcome-supported claims;
  F-PROD open.

## Snapshot honesty

Mid-audit `cost-calibration.test.ts` was 3/6 red (fixtures predated the new
eligibility gate); the owning slot updated them before round close and added
`test/unit/privacy/deletion.test.ts` (raw-byte cascade pinning) plus
record-classes propagation pinning (`IMPLEMENTED_PROPAGATION`). Final check by
this slot against the closing tree: typecheck clean, full `pnpm test`
**1314 pass / 0 fail / 1 skip** (R1 baseline 1282/1).

## Ranked Round 3 risks (full list in report §4)

1. Boundary transitivity: plane-boundary test is direct-import only; reuse
   the closure walker to assert the adaptation closure never reaches runtime
   record readers outside the sanctioned pipe.
2. Eval independence: no test pins sealed-holdout/critic independence, weight-0
   self-report, or fail-closed forged `criterion: taskSuccess` from the CLI
   surface (ADR-005 items 3/6).
3. F-PROD stays open; guard against doc drift implying readiness.
4. Persist redaction decision classes (schema + migration bump).
5. `delete --episode` should list attached runs it is not deleting.
6. Delete-vs-appender race on invocations.jsonl (lock the appender or
   document delete-after-terminate as the only supported flow).
7. `aggregateCatalogObserved` p50s still fold non-`ok` rows (verified: zero
   `callOutcome` references in `src/routing/catalog-observed.ts`); wire
   `costEligibleInvocations` there next.
8. Surface `excludedUnattributed` in `doctor --json` (legacy state roots see
   calibration freeze silently otherwise).
9. Forbidden-module list is enumerated; consider forbidding
   `src/experiments/` in the live closure by convention.

## Blocked / handoff

Both mid-audit handoffs were resolved by their owners before round close:
fable-1 refreshed the status-matrix R1/bandit/topology enforcement wording to
the transitive test, and the implementing slot fixed the cost-calibration
fixtures. Nothing blocked; §4 of the report is the Round 3 queue.

Parent note: `docs/reports/2026-08-24-sota-isolation-privacy.md` (R1, dated
audit) now describes superseded delete-tooling behavior in §4. It was not in
this slot's Round 2 write set, so it was left as history; consider a one-line
"superseded in part by the Round 2 report" pointer at commit time.

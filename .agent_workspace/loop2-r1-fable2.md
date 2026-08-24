# Loop 2 Round 1 — fable-2
MODEL_SLUG: claude-fable-5-thinking-xhigh

Full evidence report: `docs/reports/2026-08-24-sota-loop2-isolation.md`.
Honesty updates applied: `docs/data-dictionary.md` (boundary-rule precision
note on the direct-import-only pin + the pinned transitive model-router
chain; delete-vs-appender race bullet rewritten to the locked-writer
behavior; Loop 2 R1 closure line added). ADR-006 left Proposed. P0 sign-off
left open. No src/test edits by this slot. No git commit.

## The §1.3 finding, closed at both layers

- gpt-sol-1 (test layer): overbroad allowlist comment replaced; new test pins
  the value chain (`eval-routing` → `assign` → `model-router`) and that
  `model-router.ts` stays filesystem-free. Verified: diff read, suite 4/4.
- This slot (doc layer): dictionary boundary note + loop-2 report. Key
  precision kept honest in both: the shipped test's fs check is single-file;
  the *subtree's* fs-freedom (10 files, zero fs) is walker-verified, not
  test-pinned, and the general transitive boundary check (R3 §5 item 3) is
  narrowed, not closed.

## Independent re-verification (this tree)

- `eval-routing` value closure: 36 files; `supervisor/model-router.ts` the
  only runtime-prefix module. fs users all adaptation-plane or
  caller-supplied-path utilities (`public-prior` loader never invoked on this
  path — `assignTasks` gets no prior).
- Union closure over all 47 adaptation-plane modules: 99 files; runtime-prefix
  reach = from-episode pipe (9 modules) + model-router (1). R3's "sanctioned
  pipe only, apart from this chain" claim holds.
- Walkers at `/tmp/loop2-value-graph.mjs` and `/tmp/loop2-plane-union.mjs`
  (statement-level type stripping matches `verbatimModuleSyntax`).

## Mid-round landings absorbed into dictionary claims

opus-2's `telemetry/invocation-log.ts` closes the delete-vs-appender race
(both writers share the log lock; cannot-clobber and refuse-unlocked-write
test-pinned). Dictionary bullet rewritten to what is now true, keeping the
two honest residues: post-rewrite appends survive deleting a still-executing
run, and a lock-timeout append silently drops the row (no counter/log line).

## Gates & sweeps

- ADR-006 Proposed; constraints hold. New nuance for future audits: since the
  Pi 0.84.3 merge, `scripts/pi-latest-check.mjs` names `pi-coding-agent` as a
  registry-query string — R3's "rg hits docs only" phrasing is stale, the
  constraint (no import/dependency) is not.
- Outcome-supported sweep: all mentions negative or gate definitions. F-PROD
  open. CAS promotion approval-only, unchanged.

## Snapshot honesty

Typecheck clean; full `pnpm test` **1434 pass / 0 fail / 1 skip** (R3 close:
1363/0/1), run twice — second run against the tree including fable-1's
README/status-matrix edits and gpt-sol-2's cli-contract-honesty test.
Siblings may still land after this note; parent's round-close verification is
binding.

## Parent notes

1. The dictionary and the loop-2 isolation report cross-link; both are in
   this slot's write set, no collisions observed with sibling files.
2. R3 report §1.3's "should be corrected by the file's next owner" is now
   satisfied by gpt-sol-1's fix; the R3 report was left untouched as history.
3. Queue suggestion for a later round: the general type-aware transitive
   plane-boundary check (closure machinery already exists in
   `live-isolation.test.ts`) — the new chain test covers only the known
   chain. Also still open: kill-switch lenient parsing, residual-scan
   checkpoint/pause blind spots, feedback id collisions, catalog p50 folding.

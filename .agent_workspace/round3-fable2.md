# Round 3 fable-2 (final isolation/privacy certification)
MODEL_SLUG: claude-fable-5-thinking-xhigh

Certification report: `docs/reports/2026-08-24-sota-r3-isolation.md`.
Honesty updates applied: `docs/data-dictionary.md` only (delete-tooling
section now covers Round 3 residual disclosure + preference non-goal; the
redacted-flag rule rewritten to the persisted `redactionClasses` tri-state;
kill-switch scope line added). ADR-004/005/006 re-verified accurate and left
untouched; ADR-006 stays **Proposed**. P0 sign-off stays open. No src/test
edits. No Outcome-supported claims anywhere (re-verified).

## Certification verdicts (closing tree, verified on disk)

- **Closure allowlist: still justified, both entries.** Independent walker
  re-run agrees with the shipped test on every claim: forbidden five absent
  from all four live closures (union 160 files); bandit only via
  `bandit-store`, topology only via `supervisor`; zero closure mentions of
  `selectArm`/`loadProjectBandit`/`planTaskTopology`/`routeR0` outside their
  definers. Bandit allowance is now *stronger*: the write sits behind the
  kill switch.
- **Delete semantics vs dictionary: reconciled.** Scratch-state-root script
  verified: cascade bytes (body+summary gone, shell + `redactionClasses`
  kept, tombstoned), residual run disclosure incl. idempotent repeat, run
  log + preferences byte-identical, invocation rewrite (2 of 3 rows),
  catalog-observed unlinked.
- **Kill switch: honest now.** `updateProjectBandit` moved behind
  `isAutoAdaptEnabled()`; suite pins on/off/frozen at disk level (no bandit
  file, no lock, byte-identical existing state; collection still persists).
  `banditUpdated` surfaced in the result.

## New finding this round

`plane-boundary.test.ts` allowlist justification for
`eval-routing -> model-router` ("nothing supervisor-side is loaded at
runtime") is **overbroad**: value chain
`eval-routing -> routing/assign -> supervisor/model-router` loads the live
router module at runtime (verified with a type-only-aware walker).
No record reachable — model-router is pure (zero fs access) — so a comment
fix + the queued transitive boundary test, not an incident.

## What a later owner must still sign (report §4)

P0 independent re-review (deltas: cascade, residual disclosure,
`redactionClasses` without a migration bump, kill-switch scope); F-PROD
item 1 (and F-SIM needs eval-independence tests first); ADR-006 acceptance;
CAS promotion approvals; the two isolation allowances are signed for the
current tree only.

## Negative cases this loop did not capture (report §5)

1. Enumerated forbidden list — new exploratory module needs a list edit to
   be caught (convention gate still missing).
2. Eval independence (ADR-005 items 3/6) untested.
3. Transitive adaptation-plane boundary still untested in-repo (my walker is
   external evidence).
4. Residual scan misses `checkpoint.json`/`pause.json` copies; corrupt line
   without the episode id is skipped silently.
5. Feedback id collision (`hash32(summary:score:model)`, no episode in hash)
   can over-suppress a same-id record from another episode via tombstones.
6. `SPARKLE_AUTO_ADAPT=no`/junk enables the loop (lenient parsing unpinned).
7. Delete-vs-appender race has no test.
8. `catalog-observed` p50 non-`ok` folding not even pinned as known-bad.

## Snapshot honesty

Siblings landed mid-audit (kill-switch reorder, `redactionClasses`
persistence, residual disclosure, auth-session/cluster-tools/store tests);
all §1/§2/§3 claims were re-verified against the **closing** tree. Final
pass by this slot: typecheck clean, full `pnpm test` **1363 pass / 0 fail /
1 skip** (R2 close 1314/0/1).

## Handoffs / parent notes

- `src/cli/main.ts` gained one line (residual print) despite the Round 3
  "do not edit main.ts" rule — benign, needed by the delete disclosure;
  parent to ratify at commit time.
- README/`adapt` USAGE still say "SPARKLE_AUTO_ADAPT=0 still collects" —
  true but incomplete now; could add "bandit and proposals stop"
  (fable-1 owns README).
- `plane-boundary.test.ts` comment fix + transitive check: next owner of
  that test (not in any Round 3 write set).

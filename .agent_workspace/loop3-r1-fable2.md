# Loop 3 Round 1 — fable-2 (isolation / privacy-claim honesty)

Slot: fable-2, model `claude-fable-5-thinking-xhigh`. No git commit (parent
commits). No `src/`, `test/`, README, matrix, or `package.json` edits by this
slot.

## Files changed

- `docs/reports/2026-08-24-sota-loop3-isolation.md` — **created.** Independent
  value-import walk of the adaptation plane (union 47 roots → 99 files,
  exactly 10 runtime-prefix modules: from-episode pipe ×9 + model-router via
  routing/assign; all filesystem-free, streams included). Cross-checked
  gpt-sol-2's new `adaptation-plane-closure.test.ts` allowlist: exact 10 = 10
  set equality. Documents what is now test-pinned vs still regex (comments
  fail closed; `export type … from` counted as value edge, none exist;
  computed `import(expr)` rejected repo-wide by a companion test). Residual
  races after the two lock closures (invocation one-retry-then-silent-drop,
  probe-measured; feedback no-retry, `adapt skipped:` stderr disclosure at
  pass granularity; post-rewrite/post-cascade rows survive by construction).
  Gate surface re-verified: ADR-006 Proposed, no Outcome-supported claims in
  `src/`, no live R1, retention unbounded (probe only), P0 sign-off open with
  two new deltas for the re-review. Inspect summary confirmed stdout-only —
  deliberately not added to the record dictionary.
- `docs/data-dictionary.md` — honesty-only edits:
  - Header test list now includes `adaptation-plane-closure.test.ts`.
  - Plane-layout precision note rewritten: transitive value-closure pin now
    exists (10-module justified allowlist, chain printed on failure,
    model-router **subtree** fs-check now in-suite), with walker-honesty
    disclosure (regex fail-closed, `import type` stripping, `export type from`
    over-approximation, computed-import guard).
  - Episode-delete paragraph: cascade read/rewrite/tombstone-write now inside
    the feedback log's cooperative lock shared with `appendFeedback`; cascade
    throws on lock timeout instead of rewriting unlocked.
  - Known-limits: invocation drop bullet updated to one-bounded-retry-then-
    silent-drop (`pnpm invocation:probe`); new bullet for the feedback-race
    closure and its residuals (post-cascade append keeps text until repeat
    delete — id-based tombstones; append timeout rejects and aborts the rest
    of the adaptation pass, disclosed on stderr).
  - "Closed in Loop 3 Round 1" history line added; section heading and report
    links updated (Loop 3 R1 link added).
- `.agent_workspace/loop3-r1-fable2.md` — this file.

## Verification (closing tree: `ce28506` + sibling working-tree landings)

- Independent walker `/tmp/loop3-value-graph.mjs`: union closure 99,
  runtime-prefix = 10, eval-routing closure 36, model-router subtree 10 with
  0 fs users. Matches Loop 2 numbers and the shipped test's allowlist.
- `pnpm exec tsc --noEmit` clean; full `pnpm test` **1457 / 0 / 1 skip**
  (Loop 2 close: 1434); targeted privacy suites 9/9.
- `pnpm invocation:probe` → `{"retries":1,"dropped":1,"landed":32,"ok":true}`.
- Sweeps: no computed `import(expr)`, no single-quoted specifiers, no
  `export type … from` in `src/`; Outcome-supported mentions all negative;
  `pi` block skills+prompts only; `pi-coding-agent` named only as a string in
  `scripts/pi-latest-check.mjs`.

## Notes for the parent

- Sibling landings observed and verified by this slot: opus-1 inspect freeze
  (+ `test/integration/cli/inspect-summary.test.ts`), opus-2 feedback lock
  (+ `test/unit/feedback/store-lock.test.ts`), gpt-sol-1 retry + probe +
  `invocation:probe` script key, gpt-sol-2 closure test. Anything landing
  after this slot's close is covered by the parent's round-close run.
- Live-isolation allowlist untouched and no expansion recommended (bandit
  writer via bandit-store; parked `planTaskTopology` only).

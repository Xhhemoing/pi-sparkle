# Isolation honesty, Loop 2 Round 1 — 2026-08-24

Scope: Loop 2 Round 1 slot fable-2 — close the Round 3 §1.3 claim-accuracy
finding at the *documentation* layer while gpt-sol-1 closes it at the test
layer. Evidence only; the edits shipped with this report are honesty updates
to `docs/data-dictionary.md`. No `src/` or `test/` edits by this slot.
ADR-004/005/006 untouched (ADR-006 remains **Proposed**).

Baseline: branch `agent/sota-opt-next-7e63` at commit `1b228d3` ("start
loop-2 SOTA follow-on from merged main") plus Round 1 sibling agents'
uncommitted working-tree changes. As in Round 3, sibling work landed **while
this audit ran**: the tree gained the plane-boundary comment fix and
transitive-chain test (gpt-sol-1), the locked invocation-log writer surface
(`telemetry/invocation-log.ts` + `privacy/deletion.ts` + the `cli/main.ts`
`onInvocation` append, opus-2), and the inspect `requiredEvidence` surface
(opus-1) between this slot's read passes. Every claim below was verified
against the tree carrying those changes; §5 is the verification log.

## 1. The Round 3 §1.3 finding, re-verified and now pinned

Round 3 found that the `plane-boundary.test.ts` allowlist justified the
`adaptation/eval-routing.ts -> ../supervisor/model-router.js` type-only entry
with "nothing supervisor-side is loaded at runtime" — wrong transitively,
because a value-import chain loads the live router module. This slot's
independent value-import walker (type-only statements stripped, matching
`verbatimModuleSyntax` emit semantics exactly) re-confirmed every fact on
this tree:

- The chain exists and is minimal: `adaptation/eval-routing.ts ->
  routing/assign.ts -> supervisor/model-router.ts` (eval-routing
  value-imports `assignTasks`; `assign.ts` value-imports `createModelRouter`).
- `eval-routing`'s full value closure is 36 files; `supervisor/model-router.ts`
  is the **only** module in it under a runtime-plane prefix.
- `model-router.ts`'s own value subtree is 10 files (itself, four `domain/`
  modules, five pure `routing/` policy helpers) with **zero** filesystem
  access anywhere — no `node:fs`, no read/write/append, no streams. The
  Round 3 conclusion stands and is now stronger: the chain loads runtime
  *code* but can reach no runtime *record*.
- The four filesystem users in eval-routing's closure are all accounted for:
  `eval-routing.ts` itself (reads the frozen replay dataset manifest, writes
  its report under `adaptation/evals/`), `adaptation/promotion.ts` (registry,
  adaptation plane), `persist/file-lock.ts` (plane-neutral lock helper), and
  `routing/public-prior.ts` (`loadPublicPriorFile` reads a caller-supplied
  frozen-snapshot path only; eval-routing's `assignTasks` calls pass no
  prior, so it is never invoked on this path).
- Union value closure over **all 47 adaptation-plane modules** (the five
  `ADAPTATION_DIRS`): 99 files, of which exactly ten sit under runtime
  prefixes — the nine modules of the sanctioned `from-episode` pipe
  (`run/event-store.ts`, `run/episode-bind.ts`, and their internals) plus
  `supervisor/model-router.ts` via `routing/assign.ts`. No runtime-prefix
  module in the closure touches the filesystem in its own source; the pipe's
  record I/O goes through `persist/jsonl.ts`, which is exactly its sanctioned
  job. The Round 3 "apart from this chain, everything sits inside the
  from-episode pipe" claim holds on the loop-2 tree.

### 1.1 What gpt-sol-1's fix pins — and what it does not

Landed this round (uncommitted at audit time), verified by reading the diff
and running the suite (4/4 pass):

- The overbroad comment is replaced with the honest statement: the direct
  import is type-only, but eval-routing value-imports `routing/assign`,
  which value-imports and loads model-router at runtime; model-router has no
  filesystem or record access. The `because` string ("type-only
  ModelRouterConfig shape for offline routing replay") was kept — it
  describes the *direct edge* and remains accurate.
- A new test pins the chain so it cannot silently rot: eval-routing must
  value-import `assignTasks`, `assign.ts` must value-import
  `createModelRouter`, and `model-router.ts` must stay free of
  `node:fs`/`readFile`/`writeFile`/`appendFile`.

Honesty about the pin's reach: all three assertions are single-file source
regexes. The filesystem check covers `model-router.ts`'s own text, **not its
value subtree** — the subtree's cleanliness was verified this round by this
slot's walker, outside the shipped suite. And the test is specific to this
one known chain: Round 3 §5 item 3 (a general, type-aware *transitive*
adaptation-plane boundary check, reusing the closure machinery that already
exists in `live-isolation.test.ts`) is **narrowed, not closed**. A new
transitive value edge from the plane into, say, `run/` through a shared
`routing/` helper would still pass every shipped test today.

## 2. Dictionary honesty edits shipped with this report

- **Boundary-rule precision note** (plane-layout section): states that the
  allowlist pin is direct-import only, discloses the one known transitive
  value chain and why the rule still holds (it is a claim about records, not
  code loading; the router subtree is filesystem-free), names the dedicated
  test, and states plainly that unlisted-prefix transitive chains would not
  be flagged automatically.
- **Delete-vs-appender race bullet rewritten** to the verified closing-tree
  behavior: both writers of `runtime/invocations.jsonl` now share the log's
  cooperative lock via `src/telemetry/invocation-log.ts` (opus-2, this
  round; suite pins the cannot-clobber and refuse-to-write-unlocked cases).
  The bullet keeps what is *still* true: delete-after-terminate remains the
  supported flow, because rows appended after the rewrite survive by
  construction and a lock-timeout append silently drops the telemetry row
  rather than fail the run.
- Section heading and report links updated; a "Closed in Loop 2 Round 1"
  line records the race closure next to the Round 2/3 closure history.

Unchanged dictionary claims spot-checked against the closing tree: the
residual-text disclosure scope (event logs + `track-questions.json`, not
`checkpoint.json`/`pause.json`), the preference non-cascade non-goal, the
`redactionClasses` tri-state semantics, and the kill-switch scope wording —
none of this round's landings touched them.

## 3. Gate surface (nothing closed, one wording nuance)

- **ADR-006 stays Proposed.** Interim constraints re-verified: `package.json`
  `pi` block declares `skills` and `prompts` only; no `pi.extensions`; no
  import of `@earendil-works/pi-coding-agent` anywhere in `src/` or
  `scripts/`. One nuance new since the Pi 0.84.3 merge that Round 3's "rg
  hits docs only" phrasing predates: `scripts/pi-latest-check.mjs` *names*
  the package as a string in an npm-registry version query. That is a probe,
  not an import or dependency — the constraint holds, but future audits
  should not expect a docs-only grep.
- **P0 privacy sign-off remains open**; the invocation-lock change is one
  more material delta the independent re-review must cover (writer-surface
  consolidation for a durable record class).
- **F-PROD remains open**; the Outcome-supported sweep was re-run — every
  mention in `src/`, README, and the status matrix is a negative statement
  or a gate definition.
- **CAS promotion approvals** unchanged (`adapt promote --approve` only).

## 4. Negative-case ledger after this round

Carried from Round 3 §5, with status on the loop-2 tree:

1. New-module discovery (enumerated forbidden list; no `src/experiments/**`
   convention gate) — **open**.
2. Eval independence (ADR-005 items 3/6) — **open**; required before any
   F-SIM claim.
3. Transitive adaptation-plane boundary — **narrowed** (the one known chain
   is now test-pinned, §1.1) but the general check still does not exist.
4. Residual-scan blind spots (`checkpoint.json`, `pause.json`) — **open**.
5. Feedback id collisions vs tombstones (over-suppression) — **open**.
6. Kill-switch lenient parsing (`SPARKLE_AUTO_ADAPT=no` enables) — **open**.
7. Delete-vs-appender race — **closed** this round (locked writer surface,
   test-pinned). Two successor honesty items, disclosed in the dictionary
   rather than left silent: a lock-timeout append drops its row with no
   counter or log line anywhere (silent telemetry loss, privacy-safe
   direction), and deleting a still-executing run cannot cover rows appended
   after the rewrite (by construction).
8. `catalog-observed` p50 folding of non-`ok` rows — **open** (unchanged
   this round; `invocation-log.ts` centralizes the path but not the
   aggregation).

## 5. Verification log (closing tree)

- Value-import walker, entry `adaptation/eval-routing.ts`
  (`/tmp/loop2-value-graph.mjs`): closure 36, runtime-prefix hits =
  [`supervisor/model-router.ts`], shortest chain as in §1.
- Same walker, entry `supervisor/model-router.ts`: closure 10, filesystem
  users in closure = none.
- Union walker over all adaptation-plane roots (`/tmp/loop2-plane-union.mjs`):
  47 roots, closure 99, runtime-prefix modules = from-episode pipe (9) +
  model-router (1), each with its exact importer; no runtime-prefix module
  touches fs in its own source.
- Walker caveats (unchanged since Round 2): double-quoted static and dynamic
  specifiers only; a computed `import(expr)` would be invisible (none exist
  in `src/`). Statement-level type stripping matches `verbatimModuleSyntax`.
- `pnpm test -- test/unit/privacy/plane-boundary.test.ts` — 4 pass / 0 fail
  (includes gpt-sol-1's new transitive-chain test).
- `pnpm exec tsc --noEmit` — clean, and full `pnpm test` —
  **1434 pass / 0 fail / 1 skip** (Round 3 close: 1363/0/1), both against the
  tree carrying every sibling landing observed at this slot's close
  (gpt-sol-1 boundary test, opus-2 invocation lock + deletion + CLI append +
  calibration path re-export, opus-1 inspection surface). Siblings may land
  more after this slot closes; the parent's round-close verification is the
  binding one.
- ADR-006 constraints and Outcome-supported sweep: §3.

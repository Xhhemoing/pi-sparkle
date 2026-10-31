# Isolation honesty, Loop 3 Round 1 — 2026-08-24

Scope: Loop 3 Round 1 slot fable-2 — independent verification of the
adaptation-plane boundary now that the general transitive check exists, plus
honesty accounting for the two writer-lock closures (feedback log, invocation
retry) and the frozen inspect summary. Evidence only; the edits shipped with
this report are honesty updates to `docs/data-dictionary.md`. No `src/` or
`test/` edits by this slot. ADR-004/005/006 untouched (ADR-006 remains
**Proposed**).

Baseline: branch `agent/sota-opt-loop3-7e63` at commit `ce28506` ("start
loop-3 SOTA follow-on from merged main", on top of `main` @ `2a921ee`) plus
Round 1 sibling agents' uncommitted working-tree changes. As in the previous
two rounds, sibling work landed **while this audit ran**: at open the tree
already carried the feedback-log lock (`src/feedback/store.ts` +
`cascadeFeedbackTombstones` in `src/privacy/deletion.ts`, opus-2), the
invocation-log one-retry (`src/telemetry/invocation-log.ts` +
`scripts/invocation-lock-probe.mjs` + the `invocation:probe` script key,
gpt-sol-1), and the frozen `InspectSummaryJson` builder (`src/run/
inspection.ts` + `cli/main.ts` `inspectCommand`, opus-1);
`test/unit/privacy/adaptation-plane-closure.test.ts` (gpt-sol-2) landed
between this slot's read passes. Every claim below was verified against the
tree carrying all of those changes; §6 is the verification log.

## 1. Independent value-import walk (this slot's walker, not the shipped test)

Method unchanged from Loop 2 (`/tmp/loop3-value-graph.mjs`): statement-level
stripping of `import type` / `export type … from` (matching
`verbatimModuleSyntax` erasure), then closure over literal `from "…"`,
side-effect `import "…"`, and dynamic `import("…")` specifiers. Results on
the closing tree:

- **Union closure over all 47 adaptation-plane modules** (the five
  `ADAPTATION_DIRS`: `adaptation`, `learning`, `preferences`, `experiments`,
  `feedback`): **99 files**, identical to Loop 2. Exactly **ten** sit under
  runtime prefixes:
  - the nine modules of the sanctioned `from-episode` pipe, all reached
    through `learning/from-episode.ts` — `run/event-store.ts`,
    `run/events.ts`, `run/injection.ts`, `run/episode-bind.ts`,
    `run/episode-store.ts`, `episode/closure.ts`, `episode/events.ts`,
    `episode/manager.ts`, `episode/store.ts`;
  - `supervisor/model-router.ts`, via the known minimal chain
    `adaptation/eval-routing.ts -> routing/assign.ts ->
    supervisor/model-router.ts`.
- **None of the ten touches the filesystem in its own source** (pattern:
  `node:fs`, `readFile`, `writeFile`, `appendFile`, plus
  `createReadStream`/`createWriteStream`, which the shipped tests do not
  check — still zero hits). The pipe's record I/O goes through
  `persist/jsonl.ts`, which is its sanctioned job.
- `eval-routing`'s own value closure is **36 files** with model-router the
  only runtime-prefix member; `model-router.ts`'s value subtree is **10
  files** (itself, four `domain/` modules, five pure `routing/` policy
  helpers) with **zero** filesystem users. Both numbers match Loop 2.
- Filesystem users in the union closure: nine, all adaptation-plane files or
  plane-neutral helpers — `adaptation/eval-routing.ts`,
  `adaptation/promotion.ts`, `feedback/store.ts`, `learning/auto-loop.ts`,
  `learning/bandit-store.ts`, `persist/file-lock.ts`, `persist/jsonl.ts`,
  `preferences/store.ts`, and `routing/public-prior.ts` (reads a
  caller-supplied frozen-snapshot path only; eval-routing passes no prior, so
  it is never invoked on that path).

## 2. The transitive boundary is now test-pinned — Loop 2 §5 item 3 closed

Loop 2 closed the *known* eval-routing chain with a chain-specific regex test
and said plainly: "a new transitive value edge from the plane into, say,
`run/` through a shared `routing/` helper would still pass every shipped test
today." That is no longer true. gpt-sol-2's
`test/unit/privacy/adaptation-plane-closure.test.ts` (landed this round,
uncommitted at audit time) builds the same union value closure and asserts:

- every runtime-prefix module in the closure appears in an explicit
  `ALLOWED_RUNTIME_MODULES` list with a justification — its ten entries are
  **exactly** the ten modules this slot's independent walker found (§1), and
  the test fails with the offending import chain if an eleventh appears, and
  fails the other way if an allowance goes stale;
- `model-router.ts`'s **value subtree** (not just the file) is
  filesystem-free — this moves Loop 2's out-of-suite subtree verification
  into the shipped suite, closing the reach caveat disclosed in Loop 2 §1.1;
- **repo-wide**, every dynamic import in `src/` uses a string-literal
  argument — the walker's `import(expr)` blind spot is now guarded by a
  failing test instead of a report caveat;
- the walker's own type-stripping behavior is self-tested (erases
  `import type`, keeps inline-`type` module edges, re-exports, and literal
  dynamic imports).

The older `plane-boundary.test.ts` is unchanged this round and still pins the
direct-import allowlist (6 entries, 3 type-only) and the chain-specific
assertions. The two tests overlap deliberately: the direct allowlist carries
per-edge justifications the closure view cannot express, and the closure view
catches what direct inspection cannot see.

### 2.1 What is still regex, disclosed rather than claimed away

- Both boundary tests and this slot's walker are **regex-level, fail-closed**
  scanners, not parsers. Comment text that looks like a value import counts
  as an edge (can only over-report, never under-report).
- The shipped walker strips `import type` statements but not
  `export type … from` re-exports, so such a re-export would register as a
  value edge — an over-approximation in the fail-closed direction. None
  exist anywhere in `src/` today (verified by grep).
- Single-file source regexes remain in `plane-boundary.test.ts` (the
  chain-pin test) and `live-isolation.test.ts` (bandit symbol list,
  `planTaskTopology` occurrence count). They are precise about the one thing
  each pins and are backed by the closure tests for everything else.
- The filesystem pattern in the shipped tests omits
  `createReadStream`/`createWriteStream`; this slot's walker checked both —
  zero hits in the union closure — so the omission is currently harmless and
  is recorded here rather than silently ignored.

### 2.2 Live-isolation allowlist: unchanged, and should stay unchanged

`test/unit/routing/live-isolation.test.ts` was not touched this round
(per ownership, deliberately). Its two-entry allowlist stands as verified in
prior rounds: `routing/bandit.ts` reachable only through
`learning/bandit-store.ts` as a reward **writer** (constructor/writer symbols
pinned; `selectArm` and `loadProjectBandit` have no live caller), and
`routing/topology.ts` reachable only through the parked `planTaskTopology`
wrapper in `run/supervisor.ts` (occurrence count pinned at one; the run loop
never calls it). R1, shadow, and holdout routers stay unreachable from all
four live entry points. This report recommends **no expansion** of that
allowlist.

## 3. Residual races and drops after this round's lock work

Verified against source and the shipped suites (§6):

- **Invocation append, lock held elsewhere:** since this round the appender
  retries **once** with the same timeout, then still rejects; the CLI's
  `onInvocation` hook swallows the rejection (`.catch(() => undefined)`), so
  the drop remains **fully silent** — no counter, no log line. The new
  `scripts/invocation-lock-probe.mjs` (`pnpm invocation:probe`) measures the
  residual: on this tree it reported the held-lock append consuming both
  25 ms windows (~55.8 ms) before dropping, while 32 contended same-process
  appends all landed. The silent-loss disclosure from Loop 2 stands,
  narrowed by one retry.
- **Feedback append vs `cascadeFeedbackTombstones`:** closed this round the
  same way the invocation race was closed in Loop 2 — both writers share the
  feedback log's cooperative lock; the cascade wraps read + rewrite +
  tombstone publication in one critical section and **throws on lock
  timeout** rather than rewriting unlocked (a privacy delete must refuse,
  not race). Two residuals, now disclosed in the dictionary: (a) an appender
  lock-timeout is *not* retried — it rejects, and the CLI absorbs it at the
  whole-adaptation-pass boundary (`adapt skipped: …` on stderr), dropping
  that pass's remaining signals along with the row — coarser than the
  invocation drop but disclosed rather than silent; the store comment's "a
  dropped feedback row, which the auto-adapt caller can absorb" describes
  the row, and the pass-level granularity is the caller's actual behavior;
  (b) a feedback row appended *after* the cascade and bound to the deleted
  episode keeps its text until `delete --episode` is repeated — the
  tombstone filter is id-based and the new row's id is not tombstoned.
- **Both logs' readers stay lock-free** (unchanged, deliberate): a torn tail
  costs one calibration/adaptation sample rather than blocking a live run.
- **Post-rewrite survival is by construction on both logs:** rows appended
  after a completed rewrite are new rows; delete-after-terminate remains the
  supported flow for runs, repeat-delete the remediation for episodes.

## 4. Inspect summary: freeze verified, not a dictionary surface

`InspectSummaryJson` (this round) freezes `inspect --summary-json` to exactly
`type`/`runId`/`status`/`requiredEvidence`, additive-only, pinned by four new
unit tests plus an integration test asserting the CLI adds no keys of its
own. Checked for this report: the summary is **stdout-only** — the builder
is a pure projection of `RunInspection` and writes nothing under the state
root — so it is not a durable record class and the data dictionary correctly
does not list it. No dictionary edit was made for it; this paragraph records
that as a decision, not an omission.

## 5. Gate surface (nothing closed; all human/policy gates stay open)

- **ADR-006 stays Proposed.** Re-verified on the closing tree: the
  `package.json` `pi` block declares `skills` and `prompts` only, no
  `pi.extensions`; no import of `@earendil-works/pi-coding-agent` anywhere in
  `src/` or `scripts/` — the one textual mention is the npm-registry version
  probe in `scripts/pi-latest-check.mjs` (a string, not an import), as first
  noted in Loop 2 §3.
- **P0 privacy sign-off remains open and is a human act.** This round adds
  two more material deltas the independent re-review must cover: the
  feedback-log writer consolidation (a durable, user-text-bearing record
  class) and the invocation-append retry semantics.
- **Nothing is Outcome-supported.** Sweep re-run: every `src/` mention is a
  negative statement ("does not claim", "never claims"); README and matrix
  mentions are gate definitions (fable-1's surface this round; spot-checked,
  not re-audited here).
- **No live R1** (§2.2). **Retention default stays unbounded** — the probe
  (`scripts/retention-probe.mjs`) exists; a policy does not, per the accepted
  Q3 decision. **CAS promotion approvals** unchanged
  (`adapt promote --approve` only).

## 6. Negative-case ledger after this round

Carried from Loop 2 §4, with status on the loop-3 tree:

1. New-module discovery (enumerated forbidden list; no `src/experiments/**`
   convention gate) — **open**.
2. Eval independence (ADR-005 items 3/6) — **open**; required before any
   F-SIM claim.
3. Transitive adaptation-plane boundary — **closed** this round at the
   value-closure level (§2); what remains is the regex-not-parser honesty of
   §2.1, which is a precision statement, not a missing check.
4. Residual-scan blind spots (`checkpoint.json`, `pause.json`) — **open**.
5. Feedback id collisions vs tombstones (over-suppression) — **open**; note
   the new post-cascade-append residual (§3) is the mirror case,
   under-suppression until the delete is repeated.
6. Kill-switch lenient parsing (`SPARKLE_AUTO_ADAPT=no` enables) — **open**.
7. Delete-vs-appender races — invocations closed Loop 2; **feedback closed
   this round**; successor honesty items for both are in §3 and in the
   dictionary.
8. `catalog-observed` p50 folding of non-`ok` rows — **open** (unchanged;
   the retry touches acquisition, not aggregation).

## 7. Verification log (closing tree)

- Value-import walker, union over 47 adaptation-plane roots
  (`/tmp/loop3-value-graph.mjs`): closure 99, runtime-prefix modules = 10
  (from-episode pipe 9 + model-router 1), each with its exact chain; zero
  filesystem hits in any of the ten, including the stream constructors the
  shipped pattern omits.
- Same walker, entry `adaptation/eval-routing.ts`: closure 36, runtime hits =
  [`supervisor/model-router.ts`]. Entry `supervisor/model-router.ts`:
  closure 10 (itself + `domain/errors|flowchart|ids|record` +
  `routing/capability-registry|catalog-model|feature-version|live-selection|policy`),
  filesystem users = none.
- Walker-caveat probes: no computed `import(expr)` in `src/`; no
  single-quoted import specifiers; no `export type … from` re-exports in the
  plane or its closure directories.
- The shipped closure test's `ALLOWED_RUNTIME_MODULES` cross-checked against
  the independent walk: exact set equality, 10 = 10.
- `pnpm test -- test/unit/privacy/adaptation-plane-closure.test.ts
  test/unit/privacy/plane-boundary.test.ts` — 9 pass / 0 fail.
- `pnpm invocation:probe` — `{"retries":1,"dropped":1,"landed":32,…,"ok":true}`
  (held-lock append ~55.8 ms across two 25 ms windows, then dropped).
- `pnpm exec tsc --noEmit` — clean. Full `pnpm test` — **1457 pass / 0 fail /
  1 skip** (Loop 2 close: 1434), against the tree carrying every sibling
  landing observed at this slot's close (opus-1 inspect freeze + integration
  test, opus-2 feedback lock + store-lock tests, gpt-sol-1 retry + probe +
  `package.json` script key, gpt-sol-2 closure test). Siblings may land more
  after this slot closes; the parent's round-close verification is binding.
- ADR-006 constraints, Outcome-supported sweep, `pi` block: §5.

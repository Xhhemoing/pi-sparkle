# Isolation & privacy certification, Round 3 (final) — 2026-08-24

Scope: Round 3 slot fable-2 — final certification pass over live-vs-shadow
isolation, privacy delete semantics vs the data dictionary, kill-switch
honesty, and the sign-off surface a later owner inherits. Evidence only; the
edits shipped with this report are honesty updates to `docs/data-dictionary.md`.
ADR-004/005/006 were re-verified and left untouched (all three remain accurate;
ADR-006 remains **Proposed**).

Baseline: branch `agent/sota-persistent-opt-7e63` at commit `e25c9d7`
("round-2 SOTA polish") plus Round 3 sibling agents' uncommitted working-tree
changes. Sibling work landed **while this audit ran** — the tree gained the
kill-switch reorder (`auto-loop.ts`), persisted redaction classes
(`feedback/types.ts` + `store.ts` + `redaction.ts`), and the residual-text
disclosure (`privacy/deletion.ts`) between this slot's first and second read
passes. Every claim below states what was verified on disk against the
**closing** tree; §6 is the final verification log.

## 1. Live vs shadow: is the closure allowlist still justified?

**Verdict: yes, both entries — and the bandit entry's justification got
stronger this round.** Certified by re-running this slot's independent
import-closure walker (a second implementation, not the shipped test judging
itself) against the closing tree.

### 1.1 Closure facts (independent walker, closing tree)

- Union closure from the four live entry points (`cli/main.ts`,
  `run/flowchart-run.ts`, `run/supervisor.ts`, `track/loop.ts`): 160 files.
- All five forbidden modules **absent** from every entry point's closure:
  `routing/r1.ts`, `routing/shadow.ts`, `routing/r1-shadow-report.ts`,
  `experiments/shadow-compare.ts`, `experiments/simulation-holdout.ts`.
- `routing/bandit.ts` reachable **only** via `learning/bandit-store.ts`;
  `routing/topology.ts` **only** via `run/supervisor.ts` — exactly the two
  pinned allowances, exactly the pinned importers.
- Symbol sweep over the whole closure: zero mentions of `selectArm` outside
  `routing/bandit.ts`, zero of `loadProjectBandit` outside `bandit-store.ts`,
  zero of `planTaskTopology` outside `run/supervisor.ts`, zero of `routeR0`
  outside `routing/r0.ts` (r0 stays value-reachable via `cascade-evidence.ts`,
  uncalled — matching its fixed header comment).
- `selectArm`'s only caller in all of `src/` remains `routing/shadow.ts`,
  which is unreachable from live. The ADR-005 enforcement note stays accurate.

### 1.2 Allowlist re-justification

- **`bandit.ts` via `bandit-store.ts`** ("adaptation-plane reward writer
  only"): still true at module, symbol, and now *policy* level. Round 3 moved
  `updateProjectBandit` behind the `isAutoAdaptEnabled()` gate (§3), so the
  one live-reachable learned-state write is now also operator-switchable.
  Rewards remain PASS/FAIL from `deterministic` `taskSuccess` signals only
  (`bandit-store.ts` filters out `user`/`human` and non-deterministic kinds);
  nothing in the live closure reads the state back.
- **`topology.ts` via `run/supervisor.ts`** ("parked wrapper"): unchanged;
  the pinned single occurrence of `planTaskTopology` and the "run loop does
  NOT call this yet" marker both still hold. Justified until Checkpoint F
  owns the integration.

### 1.3 New finding: one plane-boundary justification is overbroad

The `plane-boundary.test.ts` allowlist pins
`adaptation/eval-routing.ts -> ../supervisor/model-router.js` as type-only,
with the justification "type-only, so **nothing supervisor-side is loaded at
runtime** and no live record is reachable". The first half of that sentence is
wrong transitively: this slot's value-import-only walker (type-only edges
stripped) shows

```
src/adaptation/eval-routing.ts -> src/routing/assign.ts -> src/supervisor/model-router.ts
```

`eval-routing.ts` value-imports `assignTasks` from `routing/assign.ts` (the
`routing/` prefix is deliberately not runtime-listed), and `assign.ts`
value-imports `selectLiveModel`-adjacent symbols from
`supervisor/model-router.ts`. So the live router module **is** loaded at
runtime by the adaptation plane. The second half of the justification holds:
`model-router.ts` is a pure policy module (zero `node:fs` access, verified),
so no runtime *record* is reachable through the chain. This is a
claim-accuracy finding, not a data leak — but it is a concrete demonstration
of Round 2 risk #1 (the boundary test is direct-import only), and the comment
should be corrected by the file's next owner. Apart from this chain, every
runtime module value-reachable from the adaptation plane sits inside the
sanctioned `from-episode` pipe (event-store/episode-bind and their internals).

### 1.4 Standing caveats (unchanged, disclosed since Round 2)

The walker (test and independent script alike) resolves double-quoted static
and dynamic specifiers; a computed `import(expr)` would be invisible (none
exist in `src/`). The forbidden list is enumerated: a brand-new exploratory
module would need a conscious list edit to be caught (§5, item 1).

## 2. Privacy: delete semantics vs the dictionary

**Verdict: after this round's dictionary update (shipped with this report),
every dictionary claim is backed by code verified on disk.** Evidence script
re-run against a scratch state root (`/tmp/r3-verify-delete.mts`); all checks
passed against the closing tree.

### 2.1 Round 2 behaviors re-verified on disk

Episode delete removes `<id>.jsonl` + `<id>.events.jsonl` + `<id>.lock`;
the cascade strips **both** free-text fields (`body`, `summary`) from the
rewritten `records.jsonl` — sentinel strings absent at byte level, no
free-text keys on the shell — and persists the tombstone; `readFeedback`
filters the shell. Run delete drops exactly the target run's invocation rows
(other runs byte-identical), unlinks `catalog-observed.json`, and removes the
run subtree. Corrupt-middle-line fail-closed behavior is pinned by the
deletion suite.

### 2.2 New this round, verified

1. **Residual episode text is now disclosed, not silently left.**
   `deleteEpisodeRecords` returns `residualEpisodeTextRunIds` and the CLI
   prints one remediation line per run
   (`residual episode text: run <id> ... delete --run <id> to remove it`).
   The scan reads episode text before the unlink, considers **only runs that
   name the episode**, and classifies three reasons (`episode-opened`,
   `objective-copy` — including `track-questions.json` — and
   `unreadable-log`, reported rather than assumed clean). Verified on disk:
   the attached run was named, its event log stayed **byte-identical**, and a
   repeat delete (episode records already gone) still disclosed the copy via
   the run's own `EPISODE_OPENED` text. The append-only rationale for not
   scrubbing run logs is stated in code where the decision lives.
2. **Preference non-cascade is now a documented, test-pinned non-goal**, not
   a silent hole: `deletion.ts` carries the three-reason rationale
   (process-global store binding, behavior-changing deletion, propagation
   claims must match code), and both the shipped suite and this slot's script
   verify `adaptation/preferences.json` stays **byte-identical** across an
   episode delete. What survives is a dangling `evidenceEpisodeId` — an id,
   not episode text.
3. **The cascade preserves `redactionClasses`** on the stripped audit shell
   (verified at byte level), so deleting an episode does not destroy the
   record of what redaction previously removed.

### 2.3 Still open after this round (disclosed in the dictionary)

- **Delete-vs-appender race**: `onInvocation` in `cli/main.ts` still appends
  to `invocations.jsonl` without the lock the delete rewrite takes (verified
  in the closing tree). Delete after the run terminates.
- **Residual scan scope**: the scan covers run event logs and
  `track-questions.json`. It does **not** scan `checkpoint.json` (flowchart
  snapshot) or `pause.json` (free-text reason), either of which could quote
  objective text (§5, item 4).
- `catalog-observed.ts` p50 aggregates still fold non-`ok` rows (zero
  `callOutcome` references, re-verified); `excludedUnattributed` still not
  surfaced in `doctor --json`.

## 3. Kill-switch honesty

**Verdict: the Round 2 finding is fixed in code, tested at disk level, and
the in-code description now draws the line honestly.** Verified in the
closing tree:

- `updateProjectBandit` now runs **after** the `isAutoAdaptEnabled()` gate;
  with `SPARKLE_AUTO_ADAPT=0|false|off` the loop parses, persists, and
  diagnoses signals (observation) but writes **no** bandit state and creates
  **no** candidate (adaptation). The docblock states exactly this, including
  why the bandit sits on the adaptation side of the line.
- The result now carries `banditUpdated`, and the suite pins the semantics on
  disk: enabled run writes the bandit; disabled run leaves **no bandit file
  and no lock file**; a disabled run against pre-existing bandit state leaves
  it **byte-identical**; disabled collection still persists feedback records.
- Residual honesty items, for the next owner:
  1. **Scope**: the switch gates the automatic post-run loop only. Explicit
     commands (`adapt learn` / preference tooling) write to the adaptation
     plane regardless — defensible (an explicit command is user intent), but
     only the `auto-loop.ts` docblock says so. User-facing text (README,
     `adapt` USAGE) still says "still collects", which is true but no longer
     the whole story — it could now honestly say "collects only; bandit and
     proposals stop". README is fable-1's surface; handed off.
  2. **Lenient parsing**: any value other than `0`/`false`/`off` enables the
     loop — `SPARKLE_AUTO_ADAPT=no` (or a typo) silently enables. Unpinned
     and undocumented (§5, item 6).
- Related honesty upgrade verified: `redactionClasses` is now persisted on
  feedback records, so on-disk rows finally distinguish "scanned clean"
  (`["pii"]` under the store's always-on policy) from "content removed"
  (`secret`/`path`/`oversized` present). Legacy rows read as `undefined` =
  "unknown", explicitly not "clean". Readers fail closed on unknown class
  strings and refuse to hand back a body on an `oversized` row. The feedback
  class keeps `migrationVersion: 1` — justified as a compatible optional-field
  addition (old rows stay valid), but that choice is part of the P0 review
  surface (§4).

## 4. What a later owner must still sign

Nothing in this loop closed a human gate. The full list a later owner
inherits, with what has *changed underneath* each gate since it was last
reviewed:

1. **P0 privacy sign-off (open).** The 2026-08-22 independent review returned
   CONDITIONAL; Q1/Q2 remediations are implemented but the **independent
   reviewer has not re-reviewed**. Material deltas the re-review must cover:
   the episode-delete cascade and run-delete invocation rewrite (Round 2),
   residual-text disclosure and the preference non-goal (Round 3), the
   persisted `redactionClasses` schema addition **without** a
   migration-version bump, and the kill-switch scope (auto-loop only). The
   dictionary is a control input to that review, not a substitute for it.
2. **F-PROD item 1 (open).** Production paired-outcome evidence per ADR-005
   (utility-delta CI lower bound > 0, cost-delta CI upper bound ≤ 0,
   pre-registered MDE and sample gates). No Outcome-supported claim exists in
   the tree (re-verified: every mention is a negative statement or gate
   definition). F-SIM, if ever claimed, is a separate item and needs the
   eval-independence tests that still do not exist (§5, item 2).
3. **ADR-006 acceptance (Proposed).** All three interim constraints
   re-verified in the closing tree: no `pi.extensions` in `package.json`,
   zero `pi-coding-agent` imports outside docs, skill still a diagnostic
   overlay. Accepting the ADR — and only that — authorizes
   `extensions/pi-sparkle/`.
4. **CAS promotion approvals.** Structurally unchanged and re-verified:
   `runAutoAdaptLoop` cannot promote (`autoPromote` ignored, `promoted:
   false` on every path); `adapt promote --approve` remains the only path.
5. **The two isolation allowances** (§1.2) are signed *for the current tree
   only*: any Checkpoint F work that starts calling `planTaskTopology` or
   reading bandit state live re-opens both entries by design (the tests will
   fail; that is the point).

## 5. Negative cases this loop did not capture

Gaps in test coverage found while certifying — none is a currently-exploited
hole; all are places where the suite would stay green while a claim silently
broke:

1. **New-module discovery**: the forbidden list is enumerated. A new
   exploratory router (say `src/experiments/foo.ts`) imported into live would
   pass every isolation test unless someone edits the list. A
   convention gate (forbid `src/experiments/**` in the live closure
   wholesale) was queued in Round 2 and still does not exist.
2. **Eval independence (ADR-005 items 3/6)**: nothing pins sealed-holdout /
   critic independence, weight-0 self-report, or that the offline eval path
   cannot read tracking `score` into reward. Required before any F-SIM claim.
3. **Adaptation-plane transitive boundary**: `plane-boundary.test.ts` remains
   direct-import; §1.3's value chain was found by an external script, not a
   shipped test. A type-aware transitive check (the closure machinery already
   exists in `live-isolation.test.ts`) is the fix.
4. **Residual-scan blind spots**: no test (and no scan) covers episode text
   quoted in `checkpoint.json` or `pause.json`; a corrupt run-log line that
   contains an objective copy but not the episode id is skipped without an
   `unreadable-log` report.
5. **Feedback id collisions vs tombstones**: `persistSignals` derives ids
   from `hash32(summary:score:modelId)` — no episode/run/task in the hash.
   Two identical signals in *different episodes* share an id; tombstoning one
   episode's record then hides the other episode's record through
   `readFeedback` (over-suppression — privacy-safe direction, but silent data
   loss). No test pins either the collision or the direction.
6. **Kill-switch parsing**: `SPARKLE_AUTO_ADAPT=no` (or any junk value)
   enables the loop; unpinned, undocumented.
7. **Delete-vs-appender race**: still no test simulating a concurrent
   `onInvocation` append during the delete rewrite; the only guard is a code
   comment plus a dictionary bullet.
8. **`catalog-observed` p50 folding**: the fact that non-`ok` rows *do* move
   the latency/volume percentiles is not even pinned as known-bad behavior, so
   fixing it will not flip any test.

## 6. Verification log (closing tree)

- Independent import-closure walker (`/tmp/r3-import-graph.mjs`): §1.1
  results; re-run after the mid-audit sibling landings — identical.
- Value-import-only adaptation-plane walker (`/tmp/r3-value-graph.mjs`):
  §1.3 chain; all other adaptation→runtime value paths inside the
  `from-episode` pipe.
- Deletion evidence script (`/tmp/r3-verify-delete.mts`) against a scratch
  state root: all §2 checks passed (cascade bytes, tombstone, residual
  disclosure + idempotent repeat, run-log and preferences byte-identical,
  invocation rewrite, catalog-observed invalidation, `redactionClasses`
  survival).
- `pnpm exec tsc --noEmit` — clean.
- Full `pnpm test` — **1363 pass / 0 fail / 1 skip** (Round 2 close: 1314/0/1).
- ADR-006 constraints: `package.json` `pi` block has `skills`/`prompts` only;
  `rg pi-coding-agent` hits docs only.
- Ownership note for the parent: `src/cli/main.ts` was modified this round
  (one output line printing the residual-text disclosure) despite the Round 3
  "do not edit main.ts" instruction — benign and necessary for the feature,
  but it is a deviation the parent should ratify at commit time.

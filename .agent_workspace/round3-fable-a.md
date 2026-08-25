MODEL_SLUG: claude-fable-5-thinking-xhigh

> **Filename collision, both reports kept** (same situation R3-opus-B hit): two
> parallel Round 3 tracks assign the slug R3-fable-A. This path held the
> aux-features track's SOTA docs close-out report; it is preserved verbatim in
> the second half of this file. The kernel-reuse track's report is first.
> Parent: split if you want one report per file.

---

# Round 3 — R3-fable-A (kernel reuse): cost-stop vs steer ordering docs; `maxCostUsd` status

Target 3 in `R2-KERNEL-BRIEF.md`, branch `cursor/pi-kernel-reuse-e1e3`.
Files written: `docs/kernel-reuse.md`,
`.agents/skills/pi-sparkle/references/kernel-reuse.md`, this report.
No `src/` edits. No commit.

## Answer the brief asked for: does the coordinator forward `maxCostUsd`?

**Yes — wired, and it landed while I was watching.** The grep history is the
evidence, timestamped (UTC, 2026-08-24):

- ~16:27 — `rg maxCostUsd src/run/coordinator.ts` → **empty** (my first act
  this session; the Round 2 brief's "coordinator does not yet pass
  `maxCostUsd`" was still true).
- ~16:31 — same grep → **two hits**. A sibling's wiring landed in between.
- 16:36:17Z — final check, stable: line 250 spreads
  `run.limits.maxCostUsd` onto the root `AgentExecutionRequest` in
  `startRun`; line 455 hands it to `ChildCoordinator` in `startParentRun`.

Downstream of those two sites (all read, not assumed):
`ChildCoordinator.costCapFor` (`src/run/child-coordinator.ts` ~334) takes the
**min** of the per-task `ChildRunLimits.maxCostUsd` and the run-level cap —
a task budget cannot buy past the run's, a run cap cannot loosen a tighter
task — and stamps the result into both the child's `RUN_CREATED` record and
its execution request. `src/run/supervisor.ts` ~348 forwards the same limit
on its own `ChildCoordinator`. `PiAgentExecutor.buildCostGate` reads
`request.maxCostUsd ?? options.maxCostUsd` and arms only with catalog
prices; unpriced/invalid caps surface via `onCostGate`, never guessed.

Test evidence, re-run by me at ~16:33 in the current tree (not taken from
peer reports): `pnpm test -- test/integration/m0/coordinator.test.ts
test/integration/m1/child-coordinator.test.ts` → **25/25 pass**, including
the four named forwarding subtests (root forwards configured cap; root
leaves it unset; child forwards; child leaves unset).
`test/integration/pi-adapter/cost-stop.test.ts` +
`test/unit/pi-adapter/cost-gate.test.ts` → 29/29 pass.

Per the repo's own rule: this is a dated snapshot of a tree that changed
under me twice in one session — re-grep before repeating the claim.

## Ordering hazard, verified at the source before documenting

Claim documented: Pi consults `shouldStopAfterTurn` **before** draining
steering, so a cost stop can drop an in-flight steer. Verified against the
installed `@earendil-works/pi-agent-core` 0.84.3, not the changelog:

- `dist/agent-loop.js` line 151: `if (await config.shouldStopAfterTurn?.(...))`
  → emits `agent_end` and **returns from the loop**.
- Line 160: `pendingMessages = (await config.getSteeringMessages?.()) || []`
  — the steer drain, reached only when the stop check declines. The
  follow-up drain (line 163) is skipped the same way.
- `dist/agent.js`: `steer()` only enqueues (`steeringQueue.enqueue`); the
  queue is otherwise drained at the next `prompt()` start — which never
  comes, because sparkle discards the `Agent` when the run settles. So the
  accepted text dies with the attempt.

Consequence spelled out in the docs: `STEER_INJECTED` records **acceptance
into the queue, not delivery to the model**. A cost-stopped run's log is
honest but split — the steer event and the gate's "stopped" record sit side
by side, and nothing claims the model saw the text (matches the inline
comment R3-opus-B put at the `stopAfterTurn` install site in
`pi-executor.ts`).

Reorder declined, with the reason written down: in-loop reorder = Pi fork
(off the table); the no-fork alternative — predicate holds the stop while a
steer is queued — buys the steer another **priced turn past the cap**,
under-enforcing the budget exactly when someone intervenes. Opus-B's
softer variant (`steerText` refuses once the gate's stop latches, silent
drop → visible refusal) is recorded as open, not landed.

## What I wrote where

`docs/kernel-reuse.md` (the contended file this round; opus-B explicitly
left it to docs ownership):

- **Wired-today table**: new spend-ceiling row — `RunLimits.maxCostUsd` →
  request → `CostGate` as the loop's stop-after-turn hook, with the
  min-merge, the honest-disarm rule, the between-retries re-check, and the
  five test files as evidence.
- **"Round 3 status (2026-08-24, R3-fable-A)"** subsection: closes Round 2's
  three open items — forwarding landed (with the claim gate
  `rg -n "maxCostUsd" src/run/coordinator.ts` and the empty-then-not
  history), `steer-inflight` skip replaced with kernel-backed tests
  (`rg -n "test.skip" test/` returns nothing — verified), ordering
  documented.
- **Semantics list**: new bullet "A cost stop outranks a queued steer",
  placed beside the retry bullet (the two steer-drop paths together) —
  mechanism with the 0.84.3 loop citation, the acceptance-vs-delivery log
  reading, the audit pair, and why the reorder was declined.

`.agents/skills/pi-sparkle/references/kernel-reuse.md` (overlay, kept in
agreement as the lighter of the pair): item 6 gains the second-drop-path
paragraph with a pointer to the docs bullet. **Note for the parent — write
collision resolved here:** a sibling appended their own cost-stop paragraph
to item 6 while I was editing it; for a few seconds the file said the same
thing twice, once mid-sentence. I merged into one paragraph keeping their
distinctive facts (`TASK_RESULT` framing, "dropped with the attempt") and
mine (acceptance ≠ delivery, docs pointer), and dropped my gate-arming
sentence because their new item-2 passage already covers arming. Re-read
item 6 once more before committing in case a later write raced mine.

## Not done / out of scope

- No `src/` or `test/` edits (targets 1 and 2 were siblings'; both observed
  landed in the tree and reflected in the docs as observations).
- `pnpm gate` as a whole not run by me — I ran only the four suites named
  above; the gate is target 5's owner. Docs edits are inert to typecheck.
- The Round 2 subsection's "the skip should be removed" line is left as the
  historical snapshot it is; the Round 3 subsection directly below records
  its resolution.

---
---

# Round 3 report — R3-fable-A (SOTA docs close-out)

*(Preserved verbatim from the aux-features track; predates the kernel-reuse
work above.)*

`MODEL_SLUG: claude-fable-5-thinking-xhigh`

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/status-matrix.md`** — new section "Pi compatibility line
   (pin + auxiliary tooling)" between the runtime and adaptive-library
   lines, with the four requested rows, all honestly marked **not
   Outcome-supported** and framed as developer preview:
   - **Pi pin 0.84.3** — wired `src/pi-adapter/` only (ADR-001), exercised
     by typecheck + adapter tests + the specifier tripwire; exact matching
     pair, `pi-coding-agent` not a dependency.
   - **`pi-compat` CLI** — wired exactly as USAGE spells it
     (`pi-compat [--json] [--offline]`, online opt-in
     `pi-compat --online [--json]`); offline default, online fails closed,
     exit 1 only on adapter-contract breakage; probe adapter-source-only.
   - **doctor `pi-packages` / `pi-compat`** — offline-only check, inherits
     doctor's unfrozen output contract.
   - **`run --thinking <level>`** — all three `run` forms; flag >
     `PI_THINKING_LEVEL` > `off`; per-run, never persisted; Google clamp
     named as provider behavior. Exercised by `thinking-flag.test.ts` and
     the new clamp characterization test.
   - Section intro also states ADR-006 explicitly: no `pi.extensions`, only
     `skills` + `prompts`.
2. **`docs/reports/2026-08-24-round2-sota-gap.md`** — closed with a §4
   "Round 3 close-out": an already-in-tree evidence table (fixtures,
   `--thinking`, aliases, pin, clamp documentation, ADR-006), the
   remaining-proof list with per-owner acceptance, and a carried-beyond
   list. Two items I had drafted as open **landed mid-round while I
   worked** and §4 records them as observed, not promised:
   - `test/unit/pi-adapter/thinking-clamp.test.ts` (R3-opus-A):
     faux-provider proof the adapter forwards `xhigh`/`max` unchanged;
     `clampThinkingLevel` clamps to `high` on every Google reasoning model;
     compile-time `SameUnion` pins of `GoogleApiThinkingLevel` /
     `ResolvedGoogleThinkingLevel` against `SparkleThinkingLevel`.
   - README/overlay flip (R3-fable-B): README line 81 now has all seven
     levels including `max`, `--thinking` precedence, "never persists",
     the clamp, and a `pnpm pi:probe` row; SKILL.md + reference call the
     flag landed without claiming TUI persistence.
3. **`docs/how-to-adapt-to-pi.md`** —
   - Google clamp watch item now says in so many words: **known provider
     behavior, not a pi-sparkle bug**; do not file as drift, do not "fix"
     by rewriting the level; points at the clamp characterization test.
   - Step 5 gained the operator-facing non-finding: `--thinking xhigh|max`
     on a Google model behaves like `high` — the clamp, not a bump
     regression.
   - `"off"` divergence item now states the design: pi-ai dropped `"off"`
     from its own `ThinkingLevel` (`ModelThinkingLevel = "off" | ...`), and
     this repo is unaffected **because the adapter imports agent-core's
     union** and everything else sees only the adapter's re-export.
   - Maintainer note rewritten from "no automated drift test yet" (now
     stale) to the actual coverage: a *narrowed* agent-core union fails
     typecheck at the adapter boundary + the clamp test's compile-time
     pins; an *added* level still goes silently stale in the three
     sparkle-owned mirrors and stays a manual step-2 comparison.
4. This report.

## Verification (this VM, Node 22.22.2, pnpm 10.17.1, 2026-08-24)

- `pnpm cli pi-compat` run **before and after** my how-to edits (check.ts
  reads that file as prose evidence): exit 0 both times,
  `pinned: agent-core=0.84.3 ai=0.84.3`, `google-thinking=absent`, all
  seven levels, `nested-skill-discovery=yes`,
  `agents-md-not-broken-skill=yes`. The legacy identifier is still spelled
  in the maintainer notes; the report did not flip — the Round 2
  regression probe stands.
- `pnpm cli doctor`: exit 0, all ten checks ok including
  `pi-packages: agent-core=0.84.3 ai=0.84.3` and
  `pi-compat: status=unknown (offline …)`.
- Flag cross-check against USAGE in `src/cli/main.ts` (read this round):
  every flag spelling in the matrix, how-to, and gap report matches
  (`--offline` explicit-default, `--online` opt-in, `--json`,
  `--thinking <off|minimal|low|medium|high|xhigh|max>` on all three `run`
  forms). Audit report grep confirmed no stale flag spellings.
- Fixtures confirmed on disk: `test/fixtures/pi-0843-skills/grouping/`
  (README.md, AGENTS.md, nested-skill/SKILL.md) — cited as existing, not
  planned.

## Scope discipline

Wrote only `docs/**` and this file. `src/`, `test/`, `README.md`, skills,
`package.json` untouched. Nothing committed (parent commits). No
extensions proposed anywhere (ADR-006 respected in every doc touched).

## Residual risk

1. **Concurrent-tree race (main risk).** Both fable-B's flip and opus-A's
   clamp test landed *while I wrote*; my docs describe the tree as read at
   ~15:00 UTC. If a Round 3 peer force-rewrites those files after me, §4's
   "landed mid-round" observations could go stale the same way Round 2's
   overlay did. Mitigation: every §4 claim carries its file path so the
   parent's post-round `pnpm gate` + a grep will catch reversal cheaply.
2. **Gate not yet run as a whole.** My evidence is per-command
   (`pi-compat`, `doctor`) and per-file reads, not a full
   `pnpm gate` — that is deliberately owned by R3-opus-B/parent (§4 item
   3). The clamp test in particular I read but did not execute; if it
   fails under the gate, §4 item 2 must be reopened, not edited away.
3. **Additive thinking-level drift stays manual.** Narrowing fails
   typecheck; adding a level fails nothing. Three sparkle-owned mirrors
   (`SparkleThinkingLevel`, `THINKING_LEVELS`, `SPARKLE_THINKING_LEVELS`)
   can silently omit a new level. Documented in the how-to maintainer
   note; an exhaustiveness test remains an open P1 for a future round.
4. **Docs describe a moving upstream.** "Google clamps to `high`" is
   0.84.3-true and now test-pinned, but a future Pi could raise Google's
   ceiling; the clamp test is written to fail in that case, and the
   how-to/USAGE would then need a coordinated edit — the docs say so
   explicitly, which is the intended failure mode.
5. **Unowned carries.** Shipped-tree skill packaging doctor check (P1,
   optional) and the online CI cron (needs network policy) leave Round 3
   with no owner; recorded in §4 so they are a decision, not an oversight.

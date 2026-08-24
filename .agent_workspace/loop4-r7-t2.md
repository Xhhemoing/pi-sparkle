# R7-2 — Acceptance criteria are prompt guidance; the verifier is the sole gate

**Option (b), as signed off. Recorded in-source on the dimensions themselves, and pinned so it cannot be deleted quietly. One finding the sign-off did not have: option (a) is not two changes, it is three — putting `FAIL` into `coverageOutcome`'s range would not gate anything, because `gates.ts` has no anomaly code for an unmet criterion and the hard-fail cap reaches `displayPrescore` only, never the `P` the gate scores.**

Slot: R7-2 (P1, gate-semantics decision). Branch `agent/opt-continuous`, no commits, no checkouts. Owned files only: `src/tracking/prescore.ts`, `src/tracking/from-child.ts` (both **comment-only** diffs), one new file under `test/unit/tracking/`. `flowchart-run.ts` untouched; R6-2's FAIL-unreachable tripwire untouched.

---

## 1. What I did and did not do

| Asked | Done |
|---|---|
| Take option (b) | Yes. `src/tracking/` diff is **comment-only** — verified mechanically (§6) |
| Do **not** take (a); do not make check-coverage a real FAIL | Not taken. `coverageOutcome` and `constraintOutcome` bodies are byte-identical to HEAD |
| Record in-source, on the dimension | Doc blocks on `coverageOutcome` and `constraintOutcome` (where the decision lives), on `prescoreInputFromObservation` (where the copy-feeding happens), on `assessChildObservation` (the entry point), plus two one-line field notes on `PrescoreInput` |
| Truth the dimension comments / docs-in-source | Done. No `docs/**` edits — that is R7-6's; §7 hands them the two lines they need |
| Do not delete R6-2's tripwire | Not touched. My prose points at it by filename, and a pin asserts the file still contains it (§3) |
| Do not edit `flowchart-run.ts` | Not touched |
| Census first; scoped eslint + whole-tree `tsc`; 3× owned tests; no full gate; no scratch files | §2, §5, §6 |

## 2. Census (before trusting the brief)

Re-verified in source at the working tree, not from report hearsay:

- `coverageOutcome` (`prescore.ts`) returns `NOT_APPLICABLE` / `PASS` / `UNOBSERVED`. `FAIL` is not in its range for **any** input — not just the copy-fed one. R6-2's premise holds.
- `constraintOutcome` **does** have `FAIL` in range. What keeps it out of reach is the producer, not the function. The two dimensions are unreachable for different reasons, and the in-source record now says so separately.
- **`prescoreInputFromObservation` is the only production producer of a `PrescoreInput`.** Whole-`src` import census: outside `src/tracking/`, the only importer of any tracking *behaviour* module is `src/run/child-tracking.ts` → `from-child.js`. Every other cross-boundary import (`run/events.ts`, `run/gate-apply.ts`, `run/child-tracking.ts`) takes `tracking/types.js` only, and the barrel `src/tracking/index.ts` has **no** importer in `src/` at all. So "criteria never reach the gate" is a statement about one code path, and that is now a pin, not a claim.
- Criteria are not decorative *everywhere* — the record had to be accurate about this. They are rendered to the child (`run/child-prompt.ts`, under `"Acceptance:"`) and enforced at plan time (`requirement/coverage.ts::checkCoverageGate` refuses a start when a contract criterion is claimed by no task). They are decorative **at the gate**, which is the narrower and true statement.
- `turn.ts::derivedClaimedVerificationWithoutChecks` is a second consumer of the same copy-fed lists that R6-2 did not name. It is inert for a specific reason worth recording: on PASSED the copy closes the gap so the code never fires; on FAILED it fires but lands *behind* `deterministic-fail`, and `gate-apply.ts::mapGateDirective` reads `codes[0]` for the reason code. So criteria can add an anomaly code to the record and still not move the directive or the transition's `reasonCode`. Pinned.
- Consumers of my files that execute or pin their behaviour: `test/unit/tracking/{prescore,from-child,acceptance,types}.test.ts` (mine), `test/unit/run/{gate-apply,events,event-row-fuzz}.test.ts`, `test/unit/run/flowchart-run-abort.test.ts` (R7-1's), `test/integration/m2.5/resume.test.ts` (R7-1's). All run in §5.

## 3. The in-source record

`prescore.ts::coverageOutcome` carries the decision: FAIL is out of range by contract, the deterministic verifier is the sole gate, criteria are prompt guidance plus a plan-time coverage obligation, and — new — **the three things option (a) needs**, enumerated so the next slot does not discover them one at a time:

1. a child-side way to report per-criterion outcomes (today the protocol carries one verdict per task);
2. resumed specs fixed in the same diff, pointing at R6-2's tripwire by filename;
3. **a way for the FAIL to reach the gate at all** — see §4.

`constraintOutcome` carries the mirror case (FAIL in range, producer-blocked). `from-child.ts::prescoreInputFromObservation` carries why the echo is the honest derivation rather than a stub, and warns that replacing it changes gating on every plane. `assessChildObservation` states the one fact that gates a child.

Three pins keep the record from rotting: the contract prose must stay in both files (matched after comment-formatting is normalised, so rewrapping is free); `prescore.ts` must keep naming `flowchart-run-abort.test.ts`, **and that file must still contain R6-2's tripwire**; and the sole-production-path census above must stay true.

## 4. The finding the sign-off did not have

I mutation-checked the record rather than asserting it: I temporarily made `coverageOutcome` return `FAIL` for an unmet check and re-ran. R6-2's tripwire went red as designed — and **my directive sweep stayed green**. That is not a weak sweep; it is the real shape of the system, and it means the obvious form of option (a) would be a no-op at the gate:

- `evaluateGates` has **no anomaly code** for a criteria-shaped dimension failure. Its six hard codes are `deterministic-fail`, `ownership-escape`, `claimed-verification-without-checks`, `repeated-no-progress`, `user-reject-stop`, `permission-security-reject`. An unmet acceptance criterion is none of them.
- `cappedByHardFail` caps **`displayPrescore`** only. `runTrackingTurn` passes `prescore.P` — the *uncapped* value — to both `combineScore` and `evaluateGates`. So the 0.30 hard-fail cap is a display concern and has never reached a gating decision.
- Measured, not argued: one criteria-shaped FAIL with every other dimension passing gives `P = 0.8`, `displayPrescore = 0.3`, and `gate.kind = "none"` with **zero** codes. The same input with `deterministicFail: true` gives `hard` / `["deterministic-fail"]`. Pinned as "a criteria-shaped FAIL caps the displayed prescore and leaves the gate open".

Consequence for Round 8: whoever takes option (a) needs a gate path (a new anomaly code, or routing `cappedByHardFail` to the gate) on top of the observation channel and the reconstruction. Reconstruction is no longer the blocker — see §7.

## 5. Tests added — `test/unit/tracking/criteria-are-guidance.test.ts` (10)

Additive, new file, no existing test touched. `test/unit/tracking` goes 60 → 70.

The headline one replaces something Round 6 could not leave behind: R6-2's 240-cell sweep lived in `/tmp` and the reviewer flagged it as not re-runnable. **The sweep is now a 270-cell test in the tree.** Thirty child behaviours (5 outcomes × PASSED/FAILED × success-claiming / neutral / silent prose) × 3 criteria variants × 3 constraint variants; for each behaviour it asserts that varying only the criteria and the constraints leaves `{apply, gate.kind, askUser, wakeAnalysis, codes[0], user-reject-stop}` identical — which is exactly and only what `gate-apply.ts::mapGateDirective` reads to choose the directive and stamp the reason code.

The rest: the directive is a pure function of one fact (every PASSED behaviour → `none`, every FAILED → `hard`/`deterministic-fail`); the sweep is not vacuous (criteria *do* move the recorded verdicts and the numeric coverage); criteria can add an anomaly code but never the leading one; `check-coverage` has no FAIL in range over a required×completed list sweep; `constraint-retention` FAILs on a hand-built input and never through the producer; the §4 finding; and the three record-keeping pins from §3.

**Verification.** Scoped `eslint src/tracking/prescore.ts src/tracking/from-child.ts test/unit/tracking/` → clean. Whole-tree `tsc --noEmit` → exit 0, twice, the second time against a shared tree that had moved under me. `test/unit/tracking` **3× consecutive: 70/70, 0 fail, 0 skipped** (~1.0 s each; nothing timing-sensitive in this slot, run 3× per process rule anyway). Direct consumers `gate-apply` + `events` + `event-row-fuzz`: 15/15. No full gate (parent's job). No new skips. No scratch files — the one artifact I made, a `/tmp` backup for the mutation check, was removed and the mutation reverted (§6 proves the revert).

## 6. Shared-tree transients, attributed

The tree moved three times while I worked; HEAD went `a28e2b5` → `fffb675` and several slots' uncommitted edits appeared. Attribution, as of my last check at **2026-08-24T21:09:46Z**:

- **`test/unit/run/flowchart-run-abort.test.ts` test 18 ("the rebuilt child spec's exact shape") is RED, and it is R7-1's, not mine.** The pin expects `childTasksFromDefinition`'s hard-coded `{maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000}`; it now gets `{1, 30_000, 300_000}` — the caller's own budget, from node `a`'s spec. That is R7-1's reconstruction working: the rebuilt spec has started carrying the caller's limits. `src/run/flowchart-run.ts` is modified in the working tree (+172/−10) by R7-1, and by 21:09Z they had begun editing the test file too — the pin update their brief assigns them ("update R6-2's rebuilt-spec pin with disclosure") is in progress. Per the standing rule that a "did not land" verdict is only true as of the minute it was taken: this was still red at my last look, and it is theirs to close. **Test 20, R6-2's FAIL-unreachable tripwire, is GREEN** — as it must be, since I changed no semantics.
- My `src/tracking/` diff is comment-only, verified mechanically: `git diff src/tracking/` filtered to added/removed non-comment lines is **empty**. A comment-only diff cannot have caused test 18.
- The mutation check was fully reverted: after restoring, `git diff --stat src/tracking/prescore.ts` shows insertions only, and the two dimension function bodies match HEAD.

## 7. For the parent, and for whoever picks this up in Round 8

1. **Reconstruction is landing this round.** The sequencing constraint in the brief — "if (a), R7-1 must land first or in the same round-half" — is being satisfied as I write. Option (a) is genuinely sequenceable for Round 8; it was not when the brief was written.
2. **It is a three-part change, not one.** §4. Anyone scoping it as "make `coverageOutcome` return FAIL" will ship a no-op and a red tripwire. The in-source record now says this at the function.
3. **A smaller question worth its own decision, separate from (a):** should `cappedByHardFail` reach the gate? Today a hard-related dimension FAIL caps what an operator is *shown* to 0.30 while the gate scores 0.80 and stays open. That is defensible (the verifier is the gate) but it is undocumented and surprising, and it affects `scope-safety` and `progress-vs-stall` — dimensions that *are* real — not just the copy-fed pair. I did not touch it: it is a semantics change to `computePrescore`, which is exactly what option (b) says not to do this round.
4. **For R7-6 (docs), two lines to truth up**, since I am not touching `docs/**`: acceptance criteria gate nothing at the tracking gate — they are prompt guidance plus a plan-time coverage obligation, and the deterministic verifier is the sole gate; and the hard-fail cap is a display value. `docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md` is the file that mentions the dimensions.
5. **One cross-slot tripwire I added, disclosed so it is cheap to diagnose:** my sole-production-path pin fails if any slot adds an import of `tracking/{prescore,turn,gates,from-child,index}.js` from outside `src/tracking/`. It was green against the tree at 21:08Z including R7-4's `coordinator.ts` and R7-5's `main.ts` edits. If it ever goes red, the right response is to re-derive the 270-cell sweep for the new entry point, not to delete the pin — its assertion message says so.

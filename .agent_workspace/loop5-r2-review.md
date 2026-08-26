# Loop 5 · Round 2 — Comprehensive review

Reviewer: Round 2 comprehensive reviewer (claude-fable-5). Analysis only; no `src/` edits, no commit by this agent.

Reviewed at HEAD `07ffa00` (`docs(agent): record Loop 5 Round 2 closeout and Round 3 dispatch`) on `cursor/pi-sparkle-sota-opt-0da8`. While this review ran, the parent landed `e6c2bb5` (docs-only: the R3 GPT auth-challenge report); it changes nothing below — spot-checked, `.agent_workspace/` only.

Inputs: `docs/agent-progress.md` Round 2 closeout, all seven `loop5-r2-*.md` reports, `loop5-r1-review.md` (the ranked agenda Round 2 executed against), git log/diffs of the Round 2 landing commits (`ac9e02a`, `9872d93`, `3d9f013`, `390a38a`, `98b1128`, `7172f2d`, merges `232a617`/`0ba0dce`), and direct source reads of every open/closed claim cited below (`src/cli/main.ts`, `auth.ts`, `adapt.ts`, `validate.ts`, `model-catalog.ts`, `src/track/questions-file.ts`, `src/adaptation/promotion.ts`, `src/requirement/heuristic.ts`).

Verification run at HEAD (this VM): `pnpm typecheck` clean. Targeted landing suites (track-clarification, deletion unit+CLI, adapt, eval-dataset, plane-boundary, record-classes): **116/116 pass**. Frozen-pin set (inspection, inspect-summary, blocked-next, main-dispatch, m1-replay, unblock-flow, validate, init-examples): **63/63 pass**. Full suite: **2120 tests, 2119 pass, 0 fail, 1 skipped** (the network-gated `provider-smoke` skip, pre-existing). Host Node 22.14.0 < engines floor `>=22.19.0` — the standing warning-only condition; nothing failed on it.

---

## 1. Completed vs open

### 1.1 The three Round 2 implementation bets — all three landed, verified in code and tests

| Bet (R1 review §5 rank) | Landing | Verified state |
|---|---|---|
| Track-clarification dead end (#1) | `ac9e02a`, merged `232a617` | `inspect --run` prose renders the persisted `q-*` questions, the file path, the new-run continuation command, and states plainly the old run stays `WAITING_FOR_USER`. `answer` refuses on this plane via `cliFail` **before any append and before the flowchart branch**, keyed on file existence (readable or not). `--json`/`--summary-json` untouched — the four `INSPECT_SUMMARY` keys stay frozen (pins green). Rider shipped: `missingRun` now retargets to `pnpm cli list`. 230-line integration suite drives it through `main()`. |
| `adapt show` + `adapt dataset` (#2) | `3d9f013`, merged `0ba0dce` | `adapt show` prints candidate content plus the exact review requirements (`review actorId: … must carry this actorId, a different reviewerId, and reviewerKind peer or independent`) — closes Fable-adapt G1's "required `actorId` no command prints". `dataset` exports the eval file nothing could previously produce (G2), with the privacy caution honored: new record-class rows + `plane-boundary`/`record-classes` pin updates in the same diff. |
| Delete lock-timeout honesty (#3) | `9872d93` + pins `390a38a` + `98b1128` | "Removes nothing" corrected in all four doc surfaces (DELETE_USAGE, data-dictionary, status-matrix, m0-m2 spec) to the real two-half contract; `disclosePartial` hook wired to stderr on the failure path; `FileLockOptions` threaded into `dropRunFromInvocationLog` so `--lock-wait-ms 0` refuses at the invocation log too (the F4 rider). New pins cover partiality-with-telemetry, exactly-one disclosure line, silent no-drop case, and the forwarded zero wait; two lying test titles renamed. |

Coordination discipline held on the track landing: Fable-track §6's requirements to the implementer were honored — plane detection is an exported shared function (`src/track/questions-file.ts`, with the deliberate absent/read/unreadable trichotomy), the reader tolerates unknown keys and treats a damaged file as "still a clarification wait, questions unshowable" rather than fatal or empty, `replay.ts` was not touched, and the refusal message is ordinary CLI output, not a new frozen contract. GPT-track's honesty wording requirement ("this is a replacement run, the old one stays waiting") is in both the inspect prose and the refusal `next:`.

### 1.2 Other Round 2 closures

- **Validate catalog parity** (R1 §5.4, landed at R1 close as `42b4c6c`) — independently **ACCEPTED** by the GPT recheck this round, with a live validate/run side-by-side matrix. Closed as a validate/run disagreement; its riders and two adjacent defects remain open (§3).
- **README credential path** — `7172f2d` fixed README:93 to `runtime/auth.json`. Only half of auth F3: `AUTH_USAGE` at `src/cli/auth.ts:28` still says `<state-root>/auth.json`, contradicted by the command's own success output. Deliberately left to the Round 3 Opus-auth slot; confirmed still wrong at HEAD.
- **Coverage debt from R1 review §4** — Round 2's four audit slots closed every named uncovered area: `src/context/`+`src/tracking/` (Fable-context), auth/models/pi-adapter (Fable-auth), `review`/`rubric`/`evaluation`/`requirement` (Fable-review), `episode`/`inject`/`commits`+Windows CI+status-matrix (Fable-aux). All seven analysis reports exist in `.agent_workspace/` — no missing-report gap this round (unlike R1's Opus-list/init). Implementer slots left no reports; commits+tests+progress-doc rows are the record, consistent with R1 precedent.
- **Same-run continuation design** (Fable-track) — delivered as design-only per assignment: Variant A (literal same-run-id) specified and rejected with grounded freeze-hazard analysis; Variant B (same-episode continuation behind the shipped refusal) fully specified with crash re-entry table and test inventory. Not implemented — see §3 rank 1.

### 1.3 Open — verified still present at HEAD (not just asserted by reports)

Already owned by a Round 3 slot (dispatch table in `docs/agent-progress.md`):

- `promotion.ts:597` still coerces any non-`"rejected"` verdict to `"approved"` before validation (review F6) → Opus-review-verdict.
- `q-scope` still asked and discarded — `heuristic.ts:71-77` is the only `src/` occurrence (review F4) → Opus-review-verdict.
- `auth.ts:28` wrong path; login flags not mutually exclusive with the dangerous success-without-write case (auth F1/F2/F3-half/F12/F13) → Opus-auth, with GPT-auth-challenge already warning (in `e6c2bb5`) not to use `checkAuth().source` as the env probe.
- Gate blocks still say only `ANALYSIS_QUEUED`; anomaly code/failed dimensions/failed criterion durable but invisible through every verb (context G1–G3) → Fable-gate-cause + Opus-gate.
- Refused `episode close` writes WAITING undisclosed (aux E1); `inject`/`pause` have no help surface at all (aux I1) → Fable-commits-ep.
- Windows `cli-smoke` exercises none of the new verbs; `validate.test.ts` HOME-redirect proves nothing on Windows and its regex breaks there; no `.gitattributes` for the init byte pin (aux §2) → Fable-windows-ci.
- No status-matrix rows for `list`/`validate`/`init` (or `commits`) — proposed row text already written in aux §3 → Fable-status-matrix.

Open and **unowned** — ranked in §3:

- Same-episode continuation implementation (every clarification still strands a WAITING run + episode; the refusal is a guardrail, not a continuation — fable-track §2.3).
- The absent-sidecar crash window: `answer` refuses when `track-questions.json` exists (readable or unreadable), but a torn write leaving `RUN_WAITING_FOR_USER` with **no** file falls through to the generic `USER_ANSWER` append (verified: `main.ts` generic tail still appends on any `--message`/`--text` with no pending-question correlation). GPT-track's fail-closed rule (correlate `--message` to a persisted child `QUESTION`) was not implemented.
- One-model catalog suppresses the `premium` alias (`model-catalog.ts:69-75`, `primaryId !== fastId` guard), so README's alias claim, init's "run immediately", and the shipped example flowchart are false for a single-primary default (GPT-validate defect 1).
- `validate`'s broken-catalog `next:` still points at read-only `models list` (`validate.ts:157`; GPT-validate defect 2).
- `INIT_EXAMPLES` and `commits preview --json` still pretty-printed/untyped; `commits` still split across two error dialects; init check-then-write race; `init --dir help` quirk; children example never fed through the real parser (R1 §2.3–2.4 + aux C1/C2, all on the "before external scripts ossify" clock).
- Not-found remedies still circular or absent on `episode`/`commits`/`inject` (aux E2/C3/I2; R1 G6) — `list` exists as the retarget, strings verified unpinned.
- Auth findings beyond the Opus-auth slot: corrupt `auth.json` dead-ends even `logout` (F4); secret prompts echo on TTY while the module doc claims otherwise, and README recommends the shell-history-leaking `--key` path (F5); keyless custom providers store never-sent secrets (F6); custom providers invisible to `models list --available` (F8); `disable` silently drops the primary default (F9); stdin-EOF exit 13 (F10); no doctor auth preflight (F11); F14/F15 micro.
- Legacy-state detection, secrets-first (R1 §5.7) — untouched for the second consecutive round; the plaintext pre-split `auth.json` orphan is the one open item with security weight.
- Context/tracking read-side remainder beyond the gate slots: `ANALYSIS_QUEUED` formatter honesty if the gate slots stop at cause display (G2), fact-plane disambiguation (G6), scoring-skip durability (G4, design review), packet persistence/recompute (G5, parked behind a privacy decision), docs truth riders (G7/G8: status-matrix row 162 grounding-query overclaim, `unobservedHighCap` decision).
- Cost/usage report verb (map #5) — still correctly parked behind PR #12.

**Dispatch gap worth flagging:** the Round 2 closeout's own 下一轮重点 names "same-episode track continuation" for Round 3, but no slot in the Round 3 dispatch table owns it — the ten slots cover review, gate cause, episode/inject, Windows, matrix, two challenges, auth, gate, and review-verdict. If Round 3 is meant to implement Variant B, a slot must be added; otherwise it is a Round 4 headline item.

---

## 2. Regressions

**None found.**

- Full suite green at HEAD: 2120 tests, 0 failures (the closeout recorded 2110 on the implementer VM; the +10 delta is the landings' own new tests, not drift).
- Frozen surfaces held through all three landings, re-run here: `INSPECT_SUMMARY` four keys, blocked-next three-`next:` shape + source pins, doctor routes, `m1-replay`'s `USER_ANSWER → RUNNING` pin (the track fix deliberately prevents the producer instead of touching replay — exactly what both track reports required), eight-member `RunStatus`, unblock-flow ledger. No new event types, no new `RunStatus`, no `package.json` edits, no executor construction in new code paths.
- The delete edits changed privacy **disclosure**, not deletion behavior — the new pins assert the pre-existing engine order (pre-lock half completes, stays completed); `98b1128` is comment-reflow only.
- The adapt landing's new record-class rows came with same-diff plane-boundary and record-classes pin updates — the D3 pattern followed correctly.
- PR state unchanged: [#12](https://github.com/Xhhemoing/pi-sparkle/pull/12) and [#13](https://github.com/Xhhemoing/pi-sparkle/pull/13) both still open; the two-way `main.ts`/README/ci.yml/status-matrix merge-order risk from R1 review §2.1 stands, now with `ci.yml` and status-matrix edits queued in Round 3 slots — the sequencing constraints in aux §2.3/§3 must be honored by whoever lands second.
- Worktree hygiene, not a regression: an untracked `smoke-examples/` scratch directory sits at the repo root (the aux §2.3 smoke commands were evidently run in-place). Harmless — `init` output only — but the parent should remove it or it will show up in every future `git status`.

One accounting nit on the closeout row: "测试结果 … Track clarification 5 pass" undercounts the landed suite (the integration file asserts more than five behaviors); the substance — the suite passes — is correct.

---

## 3. Ranked Round 3 leftovers

Items **not** already owned by a dispatched Round 3 slot, ranked by operator pain × readiness:

1. **Implement same-episode continuation (Variant B) behind the shipped refusal.** The design is complete and freeze-audited (fable-track §3: consume answers as one correlated `USER_ANSWER` + `RUN_COMPLETED` on the clarification run, start the execution run attached to the same episode; zero new event types/files; one additive `existingEpisode` input to `startFlowchartRun`). Until it lands, every clarification permanently strands a WAITING run and episode with no linkage and no answers-correlation check. Sequence phase 1 + crash re-entry first per §8; honor the §3.7 sidecar riders (`schemaVersion`, `habits`) at the next writer touch. This is the closeout's own named next-round item that the dispatch table dropped.
2. **Close the absent-sidecar fall-through in `answer`** (GPT-track's fail-closed rule): before the generic non-flowchart append, require `--message` to correlate to a persisted pending child `QUESTION`. Small `main.ts` diff, natural rider on rank 1 or on any answer-path touch; closes the one crash window where the state-corrupting append is still reachable on the clarification plane.
3. **First-run catalog honesty batch** (GPT-validate): emit both `cheap`/`premium` aliases even when primary = fast (matches the Pi executor's own construction), pin the one-model catalog + run the init flowchart through real validate, fix `validate`'s `models list` remediation text, and add one side-by-side validate/run parity test. Today a supported single-model setup makes the shipped example, README, and init's "run immediately" all false on first contact.
4. **Machine-JSON ossification pair + G4 opener**: compact and type `INIT_EXAMPLES` and `commits preview --json` (both `JSON.parse`-pinned, so safe today), unify `commits` onto `cliFail` (its raw strings verified unpinned — the safest first G4 target). Time-sensitive in the "before external scripts ossify" sense; gets strictly more expensive.
5. **Not-found retarget batch onto `list`** (R1 G6 + aux E2/C3 + I2's event-log preflight for `inject`): circular and absent remedies across `episode`/`commits`/`inject`, all strings verified unpinned. High confusion-relief per line; mostly mechanical.
6. **Auth remainder beyond the Opus-auth slot**, in order: corrupt-store remedy (F4 — the error already carries the path; `next:` naming the file safe to delete is string-only); secret-prompt echo muting + stdin-pipe documentation (F5 — security-adjacent, the module comment actively misleads reviewers); keyless-custom `--key` guard (F6) + custom providers in `--available` (F8, ~6 lines with `listedModelsFromCustom` already shipped); doctor auth preflight (F11 — converts mid-run `Provider is not configured` into a preflight line, doctor JSON is frozen-additive).
7. **Legacy-state detection, secrets first** (R1 §5.7, carried twice): extend `LEGACY_STATE_ENTRIES` so doctor names the pre-split `auth.json` credential orphan and friends. Additive to an informational check; the migration half stays a separate decision.
8. **Windows test-portability pair** (aux §2.2) if Fable-windows-ci lands only the smoke lines: `HOME`→`USERPROFILE` in `validate.test.ts` and `.gitattributes` for the init byte pin — without them the test-step half of that slot is blocked and one test file silently proves nothing per OS.
9. **Context/tracking honesty riders** left after the gate-cause slots: `ANALYSIS_QUEUED` formatter wording (G2 — formatter only, the payload word is fixture-load-bearing), inject fact-plane sentence (G6 — check blocked-next anchored regexes first), status-matrix row 162 split + `unobservedHighCap` decision (G7/G8).
10. **Design-review items, not riders**: durable scoring-skip record (context G4 — wants an event type or side record; frozen-surface friction), packet persistence or inspect-side recompute (context G5 — parked behind the pinned "no prompt body" posture), episode/commits micro-batch (E5 truncation warning, E7 `--json` ignored, C4 partial-apply line).
11. **Cost/usage report verb** (map #5) — unchanged: wait for PR #12's cap to merge, then it is the natural companion.

---

## 4. NO_HIGH_VALUE_CHANGE_FOUND

- **Re-auditing frozen Loop 4 honesty contracts** — zero-slot by construction (D1); every freeze pin re-run green at HEAD; none of the three landings strained one.
- **Re-litigating the Round 2 landings** — the GPT recheck ACCEPTED validate parity with live evidence; my re-verification of track/delete/adapt found the coordination requirements honored and no defect worth reopening. The residuals (§3 ranks 1–3) are follow-ons, not flaws in what shipped.
- **Variant A same-run-id continuation** — rejection affirmed. It buys one fewer episode hop at the cost of an embedded-start mode in `flowchart-run.ts`, a lock-reentrancy seam, and a weakening of the invented-state refusal; B is a strict prerequisite anyway, so nothing is foreclosed.
- **Wiring the M4 review fabric** (`review`/`rubric`/`evaluation` beyond `self-review.ts`) — affirmed as KEEP, library-only, labeled. Wiring is a judgment-plane policy change with no operator demand; pruning would delete the spec's only bias-control implementation. The F2 collisions and F5/F7 notes are recorded for whichever future loop wires it, as one slot.
- **Deleting or "fixing" dormant context/tracking machinery** (G8's option-gated surface, G9's latent quirks, human-score/`gateFacts` producers) — affirmed: inert code with living pins is cheap; each wiring is a deliberate scoring-semantics change the posture pins exist to force.
- **`init` KEEP (D6)** — re-affirmed a second time, now by the GPT recheck: REPLACE would preserve the broken `premium` reference while removing installed-binary access. Fix the §3.3 defects; do not reopen the verb decision.
- **Auth store design, `PI_API_KEY` compat scope, `models` enable/disable/set-default semantics** — verified honest and correct by the live-probe audit; only the disclosure/guard lines in §3.6 are worth adding.
- **`episode close --lock-wait-ms` parity, `commits apply` rollback, inject crash-loss semantics, the E1 WAITING write itself** — all deliberate, documented or pinned; disclosure lines suffice where anything is owed.
- **Carried R1 §6 parkings** — shell completions, shadow/R1/holdout exposure, retention policy, cluster dead-letter, ADR-006, SQLite listing, `package.json` edits, auto-promotion/live-`selectArm`/topology: nothing this round produced a reason to unpark any of them.

# Loop 5 · Round 3 — Fable-gate-cause: exact prose for the gate-cause visibility batch (G1+G2+G3)

Auditor: Fable-gate-cause (claude-fable-5). Specification only; no `src/` edits, no commit.
Written at HEAD `4e596f5` (`docs(agent): record Loop 5 R3 GPT challenge of Round 2 landings`).
Input: `.agent_workspace/loop5-r2-fable-context.md` (§3 G1/G2/G3, §4 freeze table, §5 rec 1–2) and a fresh read of every pin named there. This document is the buildable spec: the exact `inspect` stdout lines and the exact `formatBlockedRunReport` note, each traced against the pins that could refuse them.

Verdict up front: the batch is implementable with **zero pin edits**. Every constraint the R2 freeze table listed holds at this HEAD, and one is sharper than R2 stated: the stall-path test does not merely pin a four-line prefix — it pins the routed `next:`/`note:` list **exhaustively** (`blocked-next.test.ts:180-188`, `assert.deepEqual(routed, [...ordinary, discardNote])`). An unconditional note is therefore not merely unwise, it is red on day one. The note below is conditional on the gate path, and the condition is chosen so that it also never fires in the two synthetic formatter tests, whose event arrays carry no `GATE_TRANSITION`.

---

## 1. What the pins actually permit (re-verified at this HEAD)

| Surface | Pin | What it permits |
|---|---|---|
| `inspect` human stdout | `test/unit/run/inspection.test.ts` (regex matches only), `test/integration/m1/cli-children.test.ts`, `test/integration/cli/cli.test.ts`, `track-clarification.test.ts` | **Not exact-pinned anywhere.** Every assertion on the human branch is `assert.match`/`includes`; no suite does `deepEqual` on joined stdout or pins a line count. Additive lines are legal everywhere, with one negative pin to respect: a clean run's inspect must not match `/required evidence/` (`inspection.test.ts:415-426`) — the new lines must not contain that phrase (they don't, and they render only when gate events exist, which a clean run has none of). |
| `inspect --json` | `inspection.test.ts:431-456`, `inspect-summary.test.ts:159-178` | Line count must equal persisted events. The new lines live in the human branch only; the `--json` branch (main.ts:1166-1171) is untouched. |
| `inspect --summary-json` | `inspection.test.ts` (SUMMARY_CONTRACT_KEYS + four exact-object `deepEqual`s incl. the "rich child state cannot add a fifth key" tripwire), `inspect-summary.test.ts` (INSPECT_SUMMARY_KEYS, sorted-keys deepEquals, spawned-CLI check) | The four keys are untouchable and this spec **adds no key**: `buildInspectSummaryJson` and `InspectSummaryJson` are not edited. The additive-key path exists but is deferred (§5). |
| Blocked report, stall path | `blocked-next.test.ts:124-147` (anchored `^  reason: no progress for too many rounds$`, `^  required evidence: `) and `:160-204` (**exhaustive** routed deepEqual: exactly the 4 ordinary lines + the discard note, nothing else) | On the stall path the routed set is frozen whole. The new note must never print there. Also two retired-claim pins: the report must not contain `no event clears a BLOCKED log today` or `until an unblock ships`. |
| Blocked report, gate path | `blocked-next.test.ts:398-432` (real `startFlowchartRun`, anchored `^  reason: ANALYSIS_QUEUED$` and `^  required evidence: evd_vf-tsk_verify$`, `--run <id> ` inclusion) | The `reason:` line is verbatim-frozen — honesty must be a separate line. Additive lines are otherwise legal; no routed-order assertion exists on this path today. |
| Formatter freeze | `blocked-next.test.ts:578-628` (`assertFrozenRouting`: 4-line ordinary prefix, **exactly 3 `next:` lines**, discard found by `--discard-executed` substring must start `  note: `) plus two mutation-throw checks | A gate-cause disclosure must be a `note:` (or a label outside the `next:`/`note:` filter), must sit after the four ordinary lines, and must not introduce a `next:`. The test's payload is a bare `RUN_BLOCKED(ANALYSIS_QUEUED)` with **no** `GATE_TRANSITION`. |
| Wiring pins | `blocked-next.test.ts:442-550` (source greps on `runCommand` / all four `flowchartExitCode` sites / the supervised-resume slice) | The edit stays inside `formatBlockedRunReport`'s body; no call site, needle string, or the supervised branch is touched. |
| Gate authority | `test/unit/run/gate-status-posture.test.ts` (census on `GateApplyResult.runStatus` readers) | Both renderings read **persisted events** (`read.events` in inspect, the `events` argument in the formatter), never the in-memory gate result. That is the pinned-legal channel. |
| Event vocabulary | `events.ts::validateEvent`, `event-row-fuzz.test.ts`, campaign D3 | Nothing here writes or defines an event, and the output is human prose, so no `preview:`-keyed machine object is owed. |

The R2 freeze table's remaining rows (`independentEvidence` census, criteria-guidance sweeps, packet prompt pins) are untouched by construction: no new src file, no `from-child.ts`/scoring edits, no packet changes.

---

## 2. The blocked-report note (exact)

### 2.1 Rendering rule

In `formatBlockedRunReport` (main.ts:487-506), after the existing seven lines, append **one** line when — and only when — both hold:

1. the newest `RUN_BLOCKED` payload (the `blocked` the function already reads) has `reason === "ANALYSIS_QUEUED"`, and
2. `events.findLast(e => e.type === "GATE_TRANSITION" && e.payload.directive === "queue_analysis")` exists — call it `transition`.

The line, byte-exact with `transition.payload.reasonCode` interpolated:

```
  note: ANALYSIS_QUEUED is the tracking gate's verdict, not a running job — the recorded cause is ${reasonCode}; no analysis consumer is wired yet and nothing dequeues this block, so unblock is still what clears it, and inspect prints the gate's failed dimensions and any unmet criteria
```

(terminated `\n`, appended as the last element of the joined array — after the discard note.)

Worked example, production-ordinary shape (a pi child's evidence-backed FAILED → leading code `deterministic-fail`):

```
  reason: ANALYSIS_QUEUED
  required evidence: evd_vf-tsk_verify
  next: pnpm cli inspect --run run_x --state-root /tmp/state
  next: pnpm cli inject --run run_x --type fact --key <key> --value <text> --state-root /tmp/state
  next: pnpm cli unblock --run run_x --reason <text> [--retry-node <nodeId>] --state-root /tmp/state
  note: resume alone replays BLOCKED — unblock is the event that clears this log, so run unblock first, then pnpm cli resume --run run_x --state-root /tmp/state executes the reopened work
  note: if that unblock is refused because a descendant of the failed node already executed, --retry-node <nodeId> --discard-executed authorizes discarding it; the set is computed, not listed, and no budget is refunded
  note: ANALYSIS_QUEUED is the tracking gate's verdict, not a running job — the recorded cause is deterministic-fail; no analysis consumer is wired yet and nothing dequeues this block, so unblock is still what clears it, and inspect prints the gate's failed dimensions and any unmet criteria
```

### 2.2 Why this exact shape, clause by clause

- **"is the tracking gate's verdict, not a running job"** — G2's honesty in one clause: the word on the `reason:` line names an internal queue with no consumer (`proposeFromAnomaly` has zero production callers; `applyChildThreeLine` drops the `AnomalyPacket`). The event payload stays untouched, exactly as the freeze table demands (fixtures in `unblock-flow`, `blocked-next`, replay pin the payload word).
- **"the recorded cause is ${reasonCode}"** — G1's disclosure: the leading anomaly code, read from the same persisted log the report already reads. `reasonCode` is validated non-empty by `validateEvent`, so no fallback text is needed.
- **"no analysis consumer is wired yet and nothing dequeues this block"** — states the dormancy without the two retired phrasings. Deliberately about the *analysis*, not the log: the resume note above it already owns "unblock is the event that clears this log", and this clause must not contradict or duplicate that claim.
- **"unblock is still what clears it"** — repeats the remedy at the point of confusion, consistent with the resume note.
- **"inspect prints the gate's failed dimensions and any unmet criteria"** — routes to §3, and "any" carries the conditionality (a child that reported no per-criterion outcomes yields no criteria lines). This clause is only true once §3 lands, which is why the batch is one diff, not two.

### 2.3 Legality trace, test by test (`blocked-next.test.ts`)

| Test | Why it stays green |
|---|---|
| "run prints a routed block…" (stall) | Stall path has no `GATE_TRANSITION` and reason is the stall's → condition false, note absent. Anchored regexes untouched. |
| "…names the four options…" (stall, **exhaustive** routed deepEqual + retired-claim pins) | Note absent (condition false). The note's text also avoids both retired strings, so even a future gate-path copy of these pins passes. |
| "a COMPLETED run prints no BLOCKED block" | Formatter not called. |
| Both run-id-disclosure tests | stdout only. |
| "resume without an unblock…" | Stall path again; note absent; reason regex and unblock-line inclusion untouched. |
| "the gate's queued analysis … verbatim" (real gate run) | Events carry `GATE_TRANSITION(queue_analysis, deterministic-fail)` + `RUN_BLOCKED(ANALYSIS_QUEUED)` → note prints as the eighth line. The three assertions (anchored `reason:`, anchored `required evidence:`, `--run <id> ` inclusion) are unaffected. |
| Both wiring pins + supervised-branch pin + the two mutation-throws | Source outside `formatBlockedRunReport`'s body is untouched; both needle strings and the supervised slice are intact. |
| "reads the newest RUN_BLOCKED… (none recorded)" (synthetic) | Events are two `RUN_BLOCKED`s, no transition → condition false, note absent, both regexes green. |
| "keeps the four-line prefix…" (synthetic freeze + mutation throws) | Payload has no transition → note absent → routed list byte-identical to today; `assertFrozenRouting` and both mutation checks behave identically. |

Two corners that make the compound condition and last-position placement load-bearing rather than stylistic:

- **Condition on reason alone would print the note in the freeze test** (its payload is `ANALYSIS_QUEUED`), which is survivable only if the note sits after the four ordinary lines — and would ship a "recorded cause" clause with no transition to read. Requiring the transition keeps the note truthful (the code is always available when it prints) and keeps every synthetic formatter test byte-identical.
- **Condition on transition alone would print the gate note under a stall block** in the mixed history (gate block → unblock → later stall): the newest `RUN_BLOCKED` would be the stall's, and a gate-cause note under `reason: no progress for too many rounds` is a lie. Requiring `reason === "ANALYSIS_QUEUED"` ties the note to the block actually in force — the same last-writer-wins rule the function already applies to the payload.

Placement last (after the discard note) is required by intent even where no pin currently reaches: the freeze comment pins the four ordinary lines "as the prefix of the block", and a `note:` inserted beside `reason:` would enter the routed filter at index 0 the moment any freeze-shaped payload carries a transition. The R2 table's "new label" alternative (an unfiltered `  cause: <code>` line under `reason:`) is also legal — the routed filter matches only `  next: `/`  note: ` — but it is a second additive line and a second vocabulary; one note that carries both the code and the honesty is the smaller, R2-rec-1-shaped change.

---

## 3. The inspect prose (exact)

All three additions render in `inspectCommand`'s human branch only (main.ts:1181-1255), from `read.events` — the persisted log the command already holds. `--json` and `--summary-json` branches are untouched; `src/run/inspection.ts` is untouched (nothing new enters `RunInspection`, so nothing can drift toward the frozen projection).

### 3.1 Gate + tracking lines (G1)

Inserted between the agent-outcome lines and the `required evidence` block (so the verdict precedes the demand it explains). Rendered only when `read.events.findLast(e => e.type === "GATE_TRANSITION")` exists — `transition`, newest wins, matching the last-writer-wins rule `inspectRun` applies to `requiredEvidence`:

```
  gate: ${from} -> ${to} — ${codes.join(", ")} (seq ${seq})
```

where `from`/`to`/`seq` come from `transition.payload`, and `codes` is the matched assessment's `gate.codes` when the assessment is found (below), else `[transition.payload.reasonCode]`. Using the full codes list is what makes the rider visible: `claimed-verification-without-checks` only ever accompanies `deterministic-fail` (R2 §2.2), and `reasonCode` alone would hide it.

The matched assessment: `read.events.findLast(e => e.type === "TRACKING_ASSESSMENT" && e.payload.assessmentHash === transition.payload.assessmentHash && e.payload.seq === transition.payload.seq)`. Both join keys exist on both payloads and are written in the same `applyTrackingGate` call, so the pair is exact, not heuristic. When found, one more line:

```
  tracking: score ${score} (prescore ${prescore}, quality ${quality}, coverage ${coverage})${failed.length > 0 ? `; failed dimensions: ${failed.join(", ")}` : ""}
```

with the four numbers `toFixed(2)` from `payload.assessment` and `failed` = `assessment.dimensions.filter(d => d.verdict === "FAIL").map(d => d.id)`. The suffix is omitted when empty rather than rendering a "(none)" — a gate can fire from `gateFacts` (`deterministicFail`, `criterionUnmet`) without any dimension verdict reading FAIL, and inventing a placeholder would misstate that.

Worked example (gate-blocked run; numbers illustrative):

```
Run run_x: BLOCKED (14 events)
  project: prj_…
  gate: RUNNING -> BLOCKED — deterministic-fail (seq 0)
  tracking: score 0.11 (prescore 0.11, quality 0.17, coverage 0.50); failed dimensions: evidence-consistency
  required evidence (1):
    - evd_vf-tsk_verify
  …
```

A run that blocked and was later unblocked still shows its newest transition — a labeled log fact (`seq`), not a status claim; the status line above it says what the run is now. A clean run has no `GATE_TRANSITION` (directive `none` writes only the assessment) and shows neither line.

### 3.2 Verification + unmet-criterion lines (G3)

Inside the existing children block, immediately after the `result:` line (main.ts:1225), when a terminal `TASK_RESULT` is printed:

```
      verification: ${terminal.verification.kind}${terminal.verification.evidenceIds.length > 0 ? ` (${terminal.verification.evidenceIds.join(", ")})` : ""}
```

and, for each entry of `terminal.verification.criteria ?? []` with `kind === "FAILED"`, one line each, in array order:

```
      unmet criterion ${criterion.id}: ${criterion.evidenceIds.join(", ")}
```

The evidence list is never empty on these lines: `isCriterionVerification` (protocol/v1.ts:255) rejects a FAILED criterion without evidence, so no fallback text exists to design. FAILED-only is deliberate — only FAILED gates (`unmet-acceptance-criterion`), and the protocol comment distinguishes `UNOBSERVED` from omission from `FAILED`; rendering the two non-gating states would bury the one line the operator is here for. The `verification:` line itself is unconditional (the field is mandatory on `TASK_RESULT`) because it closes the sharpest confusion in the blocked shape: today `result: SUCCESS — …` is all inspect shows for a child whose verification FAILED.

Worked examples — the blocked-next executor's shape, then the R11-1 option-(a) shape (whole-task PASSED, one criterion reported FAILED):

```
      result: SUCCESS — the child reported success; verification did not agree
      verification: FAILED (evd_vf-tsk_verify)
```

```
      result: SUCCESS — done, except ac-2
      verification: PASSED
      unmet criterion ac-2: evd_ac2-log
```

### 3.3 Legality trace

- `inspection.test.ts` human pins: the stalled fixture has no gate events and no children → no new line renders; the clean-run `doesNotMatch /required evidence/` cannot match any new line (none renders, and none contains the phrase). Both regex-positive tests match untouched lines.
- `--json` purity pins (both suites): branch untouched, line count unchanged.
- INSPECT_SUMMARY freeze (both suites, incl. the fifth-key tripwire and the spawned-CLI check): `buildInspectSummaryJson` untouched; the tripwire test exists precisely for this diff shape and passes byte-identically.
- `cli-children.test.ts` / `cli.test.ts` / `track-clarification.test.ts`: all matches (`/children/i`, `/tsk_parse/`, `/pending approval …/`, clarification lines) are on untouched lines; no exact-stdout assertion exists.
- `gate-status-posture.test.ts`: the rendering reads `GATE_TRANSITION`/`TRACKING_ASSESSMENT` events, never `GateApplyResult.runStatus` — the exact channel the posture pin names as legal. No posture comment is reworded.
- `independent-evidence-posture.test.ts`: no new src file; the field is not dereferenced (it lives on `PrescoreInput`, not the assessment payload).

---

## 4. What this deliberately does not do

- **No event payload or vocabulary change.** `RUN_BLOCKED.payload.reason` stays `ANALYSIS_QUEUED` (fixture-pinned); no `SCORING_SKIPPED` or gate-detail event (G4 stays a design-review item per R2 rec 5).
- **No `--summary-json` key.** The additive path is legal but expensive: a fifth key (e.g. `gate: { reasonCode, from, to, seq } | null`) requires same-diff updates to `SUMMARY_CONTRACT_KEYS` (unit), `INSPECT_SUMMARY_KEYS` (integration), all four exact-object `deepEqual`s, the sorted-keys checks, the `InspectSummaryJson` doc comment, and the main.ts inspect comment — seven pinned sites for a consumer that does not exist yet. Defer until something machine-reads the cause; the prose ships at zero pin cost.
- **No wiring of `proposeFromAnomaly` / analysis wake** — adaptation-plane policy, explicitly out of scope (R2 §5, freeze table last row).
- **No gate-authority or scoring change** — read-side only; `from-child.ts`, `gates.ts`, `gate-apply.ts` untouched.
- **No `inject` USAGE wording** (G6, R2 rec 3) — separable pure-strings diff; keeping it out keeps this batch's pin trace short.

---

## 5. Pins the implementing diff must add (same-diff discipline), and the verification plan

New behavior ships pinned in the same diff:

1. **Formatter, gate shape:** a synthetic events array `[GATE_TRANSITION(directive queue_analysis, reasonCode X), RUN_BLOCKED(ANALYSIS_QUEUED)]` → the note prints, is the last routed line, starts `  note: `, names X, and the four-line prefix / three-`next:` / discard-is-note invariants all still hold (reuse `assertFrozenRouting`'s shape against the richer payload — this closes the gap that today no formatter-level test carries a transition).
2. **Formatter, mixed history:** `[GATE_TRANSITION(queue_analysis), RUN_BLOCKED(ANALYSIS_QUEUED), RUN_BLOCKED(stall reason)]` → note absent (the current block is not the gate's).
3. **End-to-end:** extend "the gate's queued analysis and its owed evidence reach the operator verbatim" to assert the note names `deterministic-fail`.
4. **Inspect, gate-blocked:** drive `startFlowchartRun` with the blocked-next executor, then `main(["inspect", …])` → match `^  gate: RUNNING -> BLOCKED — deterministic-fail` and `^  tracking: score `, and `^      verification: FAILED \(evd_vf-` under the child.
5. **Inspect, unmet criterion:** a terminal with `verification: { kind: "PASSED", criteria: [{ id: "ac-2", kind: "FAILED", evidenceIds: […] }] }` → match `^      unmet criterion ac-2: `.
6. **Inspect, negative:** a clean COMPLETED run's stdout does not match `/^ {2}gate: /m` or `/^ {2}tracking: /m`.

Suites to run green before landing: `blocked-next`, `inspection`, `inspect-summary`, `unblock` (CLI), `unblock-flow`, `criteria-gate`, `gate-outcome`, `gate-status-posture`, `independent-evidence-posture`, `loopback-cli-resume` (supervised byte-pin), `cli-children`, `cli`, `track-clarification`, plus the full unit tracking set.

Risk noted from R2 and still live: both edit sites are in `src/cli/main.ts`, inside the PR #12 merge-collision zone Round 1 flagged — rebase before landing and re-run the wiring pins, which are the tests that will catch a bad merge of `runCommand`/`resumeCommand` bodies.

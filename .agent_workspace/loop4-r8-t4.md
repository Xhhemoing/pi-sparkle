[Model: claude-opus-5-thinking-high-fast]

# R8-4 — Option (a) rescoped: a signed-off-ready design for criteria that can gate

**Design only, as signed off: no `src/**`, no `src/protocol/v1.ts` edit, no implementation. R7-2's "three changes, not one" is confirmed in source — and it is understated. The census found a fourth precondition that dominates the other three: the verdict the gate admits on has no live producer. `PiAgentExecutor` cannot emit a child-authored `TASK_RESULT` at all, so a per-criterion channel added to protocol v1 today would be fillable only by the two fake executors — the exact producer-blocked shape R7-2 recorded for `constraint-retention`. Recommendations below name one protocol field, one gate mechanism, one never-ran-node posture, answer R7-2 §7.3 (`cappedByHardFail` stays display-only — measured, not argued), and give the order the three have to ship in.**

Slot: R8-4 (P2, design-first). Branch `agent/opt-continuous`, no commits, no checkouts. Tree touched: one additive test file, `test/unit/tracking/option-a-preconditions.test.ts`. Nothing else.

---

## 1. What I did and did not do

| Asked | Done |
|---|---|
| Design all three changes; do **not** implement | §3–§5. `git diff --stat src/` shows no file of mine; the only tree change is one new test file |
| Do not make `coverageOutcome` return FAIL | Not touched. Its body is byte-identical; the R6-2 tripwire is green (§8) |
| Answer R7-2 §7.3 separately | §6. Recommendation: display-only, with a 54-of-270 measurement behind it |
| Recommend one protocol field shape / one gate mechanism / one never-ran posture, with the evidence that rejects the alternatives | §3, §4, §5 — each with the rejected options and the source fact that rejects them |
| Keep the criteria-are-guidance record pins green | §8. Contract prose in both files untouched; tripwire named and present; sole-production-path census still true (my imports are test-side, and that pin scans `src/` only) |
| Additive pins only, and only if they lock current (b) behaviour | 5 pins, one new file, `test/unit/tracking` 70 → 75 (§7). No existing test edited |
| Census first; scoped eslint + whole-tree `tsc`; no full gate; no scratch files | §2, §8 |

## 2. Census — verified in source at the working tree, not from report hearsay

R7-2's three premises re-verified first, then four findings its scope did not have.

**The three premises hold.**

- `coverageOutcome` (`prescore.ts:158-162`) returns `NOT_APPLICABLE` / `PASS` / `UNOBSERVED`; `FAIL` is not in its range for any input.
- `gates.ts:18-36` builds six hard codes and none is criterion-shaped; the `AnomalyCode` union (`types.ts:19-28`) has nine members and the persisted-assessment parser (`types.ts:255-265`, `parseGateDecision`) refuses anything else.
- `turn.ts:89` and `:94-95` pass `prescore.P` — the **uncapped** value — to `combineScore` and `evaluateGates`; `cappedByHardFail` reaches `displayPrescore` only (`prescore.ts:73-74`), which `from-child.ts:103` copies into the recorded `assessment.prescore`.

**C4 — criteria reach the prescore for exactly one role.** `child-tracking.ts::observationFromChild:59-64` builds `requiredChecks` from the spec's criteria **only when `role === "tester"`**, and gives a tester with no criteria the literal `["test"]`. For the other six `AgentRole`s, `check-coverage` reads `NOT_APPLICABLE` however many criteria the caller wrote. So "make criteria gate" is a role decision as well as a protocol one, and today's answer is "implementer criteria are not even inputs". Pinned (§7 pin 1).

**C5 — the fact the gate admits on has no live producer.** `assessChildObservation` (`from-child.ts:58-61`) scores nothing unless `verification.kind` is `PASSED` or `FAILED`. The only non-fake `AgentExecutor` in the tree is `PiAgentExecutor`, and `translatePiEvent` (`pi-executor.ts:85-101`) maps pi's stream to `TEXT_DELTA` / `TOOL_STARTED` / `TOOL_FINISHED` / `TURN_FINISHED` and **never** to `MESSAGE`. `runAttempt` collects only translated events (`pi-executor.ts:244-247`), so the transcript can never contain a child-authored `TASK_RESULT`, and `finish` (`:364-391`) therefore always synthesizes one with `verification: { kind: "UNOBSERVED" }` — which `assessChildObservation` refuses. The two `src` producers of a scorable verdict are `testing/fake-executor.ts::ProtocolChildExecutor` and `cli/main.ts::ChildFakeExecutor`, both hard-coded `PASSED`; `--results` does not reach the gate at all (`ChildNodeResult`, `flowchart-supervisor.ts:158-163`, carries no verification and feeds `applyChildResult`, not `applyChildThreeLine`).

  Consequence, stated plainly: **the tracking gate has exactly two production-reachable states today — it does not run (`--executor pi`), or it runs and always opens (`--executor fake`).** The FAILED half of "the deterministic verifier is the sole gate" is itself producer-blocked. Option (a) would add a second channel behind the same wall. Pinned (§7 pin 2).

**C6 — the channel alone would half-wire itself to the gate, through prose.** `turn.ts::derivedClaimedVerificationWithoutChecks:172-181` already reads `requiredChecks`/`completedChecks`. Today the echo makes the gap reachable only on `FAILED`, where `deterministic-fail` is `codes[0]`, so it never leads. Replace the echo with a real observation and the existing hard code `claimed-verification-without-checks` becomes the **leading** code for a PASSED child with an unmet criterion — but only when the child's summary matches `isSuccessClaim`'s `/pass|passed|verified|succeed/i`. So "just add the channel and leave `gates.ts` alone" is not gate-inert; it is gate-active in a prose-conditioned subset, and it misses precisely the honest child that reports an unmet criterion without claiming success.

**C7 — hard vs soft is not the interesting axis.** `gate-apply.ts::mapGateDirective:191-226` maps both `hard` (absent `user-reject-stop`) and `soft` to `queue_analysis` → `RUN_BLOCKED` → run status BLOCKED. They differ only in the stamped `reasonCode` and the recorded `kind`. Any criterion code that reaches `gate.codes` blocks the run; picking "soft" buys no gentleness, only a less accurate reason code.

**C8 — and BLOCKED is absorbing.** R7-3/R7-4's pins hold every recorder to refusing a terminal over a BLOCKED log, and at HEAD (`dc7c82a`) `RUN_UNBLOCKED` does not exist in `src/` (`git grep` at that rev: no match; the working tree has R8-1's in-flight producer). So until R8-1 lands, a criterion that can gate is a criterion that can **terminally** block a run.

**C9 — the never-ran-node substitution launders itself into fact.** `childTasksFromLog:400` gives a node with no logged `TASK_REQUEST` `acceptanceCriteria: []`. When that node then runs, `child-coordinator.ts::buildTaskRequest:392` appends a real `TASK_REQUEST` carrying `acceptanceCriteria: []`, and R7-1's fixed-point rule (`loggedTaskRequests`: last request per task) makes that the authoritative spec for every later resume. Harmless under option (b). Under option (a) it means one crash before a node's first attempt permanently downgrades that node's gating, with no recovery path: `FlowNode` (`domain/flowchart.ts:142-152`) carries no criteria and the checkpoint carries no spec — the same durability hole R7-1 disclosed for `FlowchartContinuation.contract`.

**Consumers of the surfaces I am designing over** (for whoever implements): `src/protocol/v1.ts` and its two test files; `src/tracking/{from-child,prescore,turn,gates,types}.ts`; `src/run/child-tracking.ts` (the sole importer of tracking behaviour outside `src/tracking/`, still true); the two `applyChildThreeLine` call sites (`run/coordinator.ts:635`, `run/flowchart-run.ts:545`); `test/unit/run/flowchart-run-abort.test.ts` (R6-2's tripwire); `test/unit/tracking/criteria-are-guidance.test.ts` (the 270-cell sweep and the record pins); `docs/**` (R7-2 §7.4's two lines). Full obligation list in §9.

## 3. Decision 1 — the protocol field

**Recommended shape.** One optional field on the verdict object that already exists:

```ts
export interface CriterionVerification {
  id: string;
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
}

export interface VerificationResult {
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
  /** Per-criterion outcomes, when the verifier reported any. Absent means
   *  the verifier spoke only about the task as a whole. */
  criteria?: CriterionVerification[];
}
```

Validation rules for `isVerificationResult`: optional; when present, non-empty (two spellings of "nothing" is how a channel rots); each `id` a non-empty string, matching `isAcceptanceCriterion`'s existing looseness rather than inventing a branded id; ids unique within the array (a duplicate is a protocol violation, not a last-wins merge); `kind` from `VERIFICATION_KINDS`; `evidenceIds` all valid `EvidenceId`s and **non-empty when `kind === "FAILED"`**, mirroring the rule `tracking/types.ts:454-458` already enforces on a FAIL dimension, so a criterion failure can never enter the record unreferenced. Ids are **not** correlated against the request at the protocol layer — the validator has no access to the `TASK_REQUEST`; correlation is the tracking layer's job, and an unknown id there is ignored rather than fatal (a reporting slip must not destroy a result).

**The invariant the sign-off buys:** absence means exactly what today means. Every logged run keeps its meaning, because absent `criteria` must leave `prescoreInputFromObservation` on its present derivation.

**Rejected, with the evidence.**

- **Bump `PROTOCOL_VERSION` to 2.** `baseError` pins `protocolVersion !== 1` and every persisted `CHILD_MESSAGE` payload on an append-only log carries `1`. And it buys nothing: `messageError` does not reject unknown keys — pinned this slot, a `criteria`-bearing `TASK_RESULT` validates today and round-trips unchanged. So the field is additive-compatible in both directions with zero reader matrix, while a bump imposes one across replay, the two fuzzers, and three learning consumers (`learning/signals.ts:297`, `learning/from-episode.ts:224`, `tools/decision-commit.ts:76`).
- **A new repeated non-terminal message type (`CRITERION_RESULT`).** It multiplies transcript rules — `assertAtMostOneTerminal`, `AttemptTranscript.accept`, ordering against the terminal, and a merge rule when a criterion is reported twice — for facts that are part of a single verdict. The verifier speaks once; the schema should let it say more in that one statement, not more often.
- **A sibling field on `TaskResult` (`criterionOutcomes`).** Two independently-optional channels for one verifier statement is how the whole-task verdict and the per-criterion verdicts come to disagree with no rule for which wins. Nesting keeps the verdict one object and reuses `VerificationKind`, so "the verifier did not look at this criterion" is expressible as `UNOBSERVED` rather than as absence — which is exactly the distinction `coverageOutcome` refuses to fake today.
- **Encoding criterion ids into `evidenceIds`.** String-typed semantics over a validated id space; rejected on sight.

## 4. Decision 2 — the gate mechanism

**Recommended.** A new dedicated anomaly code `"unmet-acceptance-criterion"`, added to `AnomalyCode` and `ANOMALY_CODES`, driven by an explicit `GateInput` boolean (`criterionUnmet`) that the caller supplies from observed per-criterion outcomes — **not** derived inside `computePrescore`, and **not** inferred from a dimension's outcome. Placement in `evaluateGates`: after `claimed-verification-without-checks`, before `repeated-no-progress`, so a whole-task `deterministic-fail`, a scope escape, and a self-contradicting claim each still stamp the transition's `reasonCode` ahead of it. Fire it on an observed per-criterion `FAILED` only — never on `UNOBSERVED`, because "the verifier did not look" is not "the child did not do it", which is the same rule that keeps `coverageOutcome` off FAIL today.

Two properties this shape has and the alternatives do not: the gate's input stays a *fact supplied by a producer* rather than a value recomputed from a score, so the anomaly is auditable back to a criterion id and its evidence; and adding it is a single, visible vocabulary change that the persisted-assessment parser enforces — which is why §7's pin 4 exists.

**Rejected, with the evidence.**

- **Cap-to-gate** (feed `turn.ts` the capped `displayPrescore` instead of `P`). Measured this slot rather than argued: over R7-2's 270-cell grid, **54 cells change and not one of them is about criteria.** All 54 are PASSED children whose own reported outcome is `FAILURE` or `TIMEOUT` — that is `progress-vs-stall` failing — and they move `none` → `soft` / `["soft-threshold"]` → `queue_analysis` → BLOCKED. Criteria move nothing either way, because the copy-fed pair cannot FAIL. So cap-to-gate is a whole-scoring-semantics change wearing a criteria costume, and it would newly block a class of run that has nothing to do with acceptance criteria. It also double-counts: a hard-related FAIL has *already* lowered `quality` and hence `P`; replacing that measured value with the constant `hardFailCap` destroys the ordering the soft threshold exists to read, and `combineScore` would then mix a constant with the human ratio.
- **Ride the existing `claimed-verification-without-checks`** (change nothing in `gates.ts`; let the real channel light up the code that already reads these lists). Free, and wrong for C6's reason: whether an unmet criterion blocks the run would depend on whether the child's prose matches `/pass|passed|verified|succeed/i` — untrusted text, which this codebase tags `UNTRUSTED_TEXT` precisely so it does not decide things. And it inverts the incentive: the child that honestly reports an unmet criterion without claiming success is the one it misses.
- **A soft-only code.** C7: `mapGateDirective` sends soft and hard to the same directive and the same BLOCKED status. "Soft" would buy nothing but a vaguer reason code on the transition.
- **A criteria-shaped dimension FAIL with no gate wiring at all** (the "obvious" form of option (a)). R7-2 measured this and it is a no-op: `P` drops by one dimension's weight and the directive stays `none`. Recorded in-source at `coverageOutcome`; not re-litigated here.

## 5. Decision 3 — the never-ran node

**Recommended posture: "unknown is not unmet, and unknown must be durable."** Three parts:

1. `childTasksFromLog` keeps substituting nothing — R7-1's rule stands: a rebuild that invents a spec is the defect, not the fix.
2. The criterion code never fires for a node whose criteria are unknown, and `check-coverage` reads `UNOBSERVED` for it rather than `NOT_APPLICABLE`, so such a node is recorded as *less observed* instead of silently *unconstrained*. Unknown lowers coverage; it does not shut a gate.
3. **The "unknown" marker has to be durable**, and the only durable form that survives C9's laundering is the criteria themselves: per-task acceptance criteria persisted in the flowchart checkpoint, alongside the `contract` field R8-2 is designing. Option (a) therefore rides **R8-2's checkpoint seam and its schema sign-off**, not a second one.

**Rejected, with the evidence.**

- **Substitute criteria from the definition or from the run contract.** `FlowNode` carries no criteria (`domain/flowchart.ts:142-152`), and the contract's `acceptanceCriteria` are the *run's*, not the task's — presenting them as the task's is the class of lie R7-1 removed when it refused to adopt the supervisor's per-node route as a spec.
- **Refuse to resume a never-ran node once criteria can gate.** It converts a crash before a node's first attempt into an unresumable run, undoing R7-1's authorized-budget substitution, and it punishes the node for a *durability* defect in the parent's records rather than anything the child did.
- **An in-memory marker on `ChildTaskInput`** (the cheap version of the recommendation — set `specSource: "substituted"` in `childTasksFromLog`, read it in `observationFromChild`). It works exactly once. C9: the substituted node's own `TASK_REQUEST` is appended with `acceptanceCriteria: []`, and R7-1's fixed-point rule makes it authoritative, so the next resume cannot tell that node from a genuinely criteria-free task and its `UNOBSERVED` downgrade silently becomes `NOT_APPLICABLE`. A marker one extra crash erases is not a posture.

## 6. R7-2 §7.3, answered separately — `cappedByHardFail` stays display-only

**Recommendation: no semantics change to `computePrescore`. Fix the surprise by naming the two numbers, not by merging them.**

Three pieces of evidence, in order of weight:

1. **The blast radius is not criteria-shaped** (§4's measurement): 54 of 270 cells, every one of them a `progress-vs-stall` FAIL on a PASSED child, newly BLOCKED. The question was raised because the cap is "undocumented and surprising"; making it gate would be considerably more surprising, and to a different population of runs.
2. **It double-counts.** The FAIL has already moved `P` through `quality`. The cap is a floor for *presentation* — "there is a hard-related failure here, do not read 0.8 as reassurance" — and folding a presentation floor into the score replaces a measurement with a constant.
3. **Both numbers are already on the record; only the word is overloaded.** `assessment.prescore` is the capped one (`from-child.ts:103`); `TrackingTurnResult.P` and `AnomalyPacket.P` are the uncapped one. The defect R7-2 named is one word standing for two quantities. Renaming the persisted `TrackingAssessment.prescore` is a schema change for cosmetics; the right fix is the docs line — and R8-5 already owns the two lines R7-2 §7.4 wrote.

The counterfactual is now measured and pinned rather than folklore (§7 pin 3), so if a later round wants to reopen this, it starts from a number.

## 7. Additive pins — `test/unit/tracking/option-a-preconditions.test.ts` (5)

New file; no existing test touched; `test/unit/tracking` goes 70 → 75. Each pin locks a fact as it stands under option (b), and each is a replace-in-the-same-diff obligation for whoever implements option (a) — the file's docstring says so.

1. **`criteria reach the prescore for exactly one role`** — sweeps all seven `AgentRole`s through `observationFromChild`; only `tester` yields non-empty `requiredChecks`, a bare tester gets `["test"]`, and an implementer with criteria reads `NOT_APPLICABLE`. Locks C4.
2. **`no shipped executor can produce the verdict the gate admits on`** — a `src/**` census of `verification: { kind: … }` producers (comments stripped) resolving to exactly `{cli/main.ts: PASSED, pi-adapter/pi-executor.ts: UNOBSERVED, testing/fake-executor.ts: PASSED}`, the structural fact that the pi adapter emits exactly one protocol message (the terminal it synthesizes), and the behavioural half: the adapter's exact synthesized shape scores `apply: false`. Locks C5. Its message says to re-derive when a producer ships, not to delete.
3. **`scoring the capped prescore would move 54 of 270 cells, none of them about criteria`** — the headline. For each cell it evaluates the gate twice, once on `P` and once on `displayPrescore`, having first asserted that its direct `evaluateGates` call reproduces `runTrackingTurn`'s gate exactly (so the counterfactual is not measured against a straw man). Asserts the count is 54, every mover is `none` → `soft`/`["soft-threshold"]`, and every mover is a PASSED child with outcome `FAILURE` or `TIMEOUT`.
4. **`the recorded assessment vocabulary has no criterion-shaped anomaly code`** — R7-3's replace-not-weaken shape: `parseTrackingAssessment` accepts a control code and rejects three plausible criterion codes with `gate.codes[0] is invalid`. Adding the gate path cannot be done quietly.
5. **`the protocol carries one verdict per task and no per-criterion channel`** — `VERIFICATION_KINDS` is the three; the `VerificationResult` interface region declares exactly `kind` and `evidenceIds`; and a `criteria`-bearing `TASK_RESULT` validates unchanged today, which is the additive-compatibility fact §3 leans on and simultaneously the proof that the channel would currently be **unread**.

## 8. Verification

- **Scoped `eslint test/unit/tracking/ src/tracking/`** → clean, exit 0.
- **Whole-tree `tsc --noEmit`** → exit 0, against a shared tree carrying R8-1's in-flight edits to `events.ts`/`replay.ts`/`gate-apply.ts`/`flowchart-run.ts`/`main.ts`/`flowchart-supervisor.ts` and four other slots' work.
- **`test/unit/tracking` 3× consecutive: 75/75, 0 fail, 0 skipped** (~1.1 s each). Nothing in this slot is timing-sensitive; run 3× per the process rule.
- **The record pins and the tripwire are green.** `criteria-are-guidance.test.ts`'s ten pins pass inside that 75 (contract prose in `prescore.ts`/`from-child.ts`, the named tripwire file, the sole-production-path census — my new file imports `src/run/child-tracking.js` and `src/protocol/v1.js`, but that pin scans `src/` only, so it is unaffected and was re-verified green). `test/unit/run/flowchart-run-abort.test.ts`: **22/22**, including R6-2's `check-coverage cannot fail…` at line 1239.
- **Mutation check on pin 3, and the revert proved.** I temporarily replaced `displayPrescore = cappedByHardFail ? Math.min(P, config.hardFailCap) : P` with `= P` and re-ran: pin 3 went red (the 54 movers collapse to 0) while the other four stayed green — so the counterfactual is real and the pin is not vacuous. Restored from the backup immediately; `git diff --stat src/` lists ten files, **none of them `src/tracking/`**, and the `/tmp` backup was deleted. Pin 2's census was likewise mutation-proved by accident: its first run caught `flowchart-run.ts:730`'s *comment* discussing a FAILED verdict, which is why the pin strips comments before matching.
- No full gate (parent's job). No new skips. No scratch files at report time.

**Shared-tree note.** Five slots have uncommitted edits in this tree (`src/cli/main.ts`, `src/learning/bandit-store.ts`, `src/routing/catalog-observed.ts`, `src/run/{coordinator,events,flowchart-run,gate-apply,replay,supervisor}.ts`, `src/supervisor/flowchart-supervisor.ts`, plus docs and several test files). None is mine and none broke anything I ran. Pin 2's census is sensitive to a new `verification: { kind: … }` producer landing anywhere in `src/`; it was green against the tree as of my last run, and if a later slot turns it red the response is to re-derive the producer set, not to delete the pin.

## 9. For the parent — what signing this off commits to, and in what order

**Option (a) is four preconditions, not three, and the fourth is not in `src/tracking/`.**

0. **A child-side producer.** C5: no shipped executor can report a whole-task verdict, let alone a per-criterion one. Adding the protocol field first ships a channel with no filler — the identical defect R7-2 recorded for `constraint-retention`. The seam exists and has a precedent: `PiExecutorOptions.tools` plus `createClusterTools(request.cluster)` shows how a per-request tool sink turns an agent tool call into an `ExecutionEvent`, so a `report_task_result` tool of that shape is the smallest thing that makes any verdict a real observation. This is outside R8-4's ownership and is the honest first slot.
1. **R8-2's checkpoint seam.** §5: the never-ran-node posture needs durable per-task criteria, and R8-2 is already opening `FlowchartCheckpointState` for the contract. One schema sign-off, not two.
2. **R8-1's unblock.** C7 + C8: a criterion that can gate is a criterion that can terminally block, and today nothing clears a BLOCKED log.
3. **Then option (a):** the protocol field (§3), the gate code (§4), the never-ran posture (§5) — landed together, because any two of them without the third is either a no-op or a silent gating change.

**Consumer obligations for that final diff** (ship or prescribe, in-diff, per the standing rule):

- `src/protocol/v1.ts`: `VerificationResult`, `isVerificationResult`, a new `isCriterionVerification`.
- `test/unit/protocol/v1.test.ts` and `fuzz.test.ts`: a `TASK_RESULT` seed carrying `verification.criteria`. The fuzz invariant is "reject only via an exact `DomainValidationError`, and validation is idempotent", so an optional field needs a **seed** to be exercised, not a rule change.
- `src/tracking/from-child.ts`: `ChildObservation.verification` gains the field and `prescoreInputFromObservation` stops echoing — its contract prose changes with it, and the record pin matching that prose must be **rewritten, not deleted**.
- `src/tracking/prescore.ts`: `coverageOutcome` gains FAIL; the recorded contract block and the pin that requires it and names the tripwire file move together.
- `src/tracking/{gates,types}.ts`: the new code in `GateInput`, `AnomalyCode`, and `ANOMALY_CODES` (the persisted parser).
- `src/tracking/turn.ts`: thread the new fact, and **decide `derivedClaimedVerificationWithoutChecks`'s fate** — C6 means a real channel turns that copy-fed no-op into a prose-conditioned producer of the leading code. That is a decision, not a side effect.
- `src/run/child-tracking.ts`: the role gate (C4) — do a non-tester child's criteria count now?
- **`test/unit/run/flowchart-run-abort.test.ts:1239` goes red by design.** R6-2's FAIL-unreachable tripwire is the enforcement half of the contract being replaced; replace it with the new reachability statement in the same diff, with disclosure.
- **Re-derive R7-2's 270-cell sweep** in `criteria-are-guidance.test.ts` under the new semantics: its invariance premise is exactly what option (a) removes.
- All five pins from §7: replace-in-the-same-diff.
- `docs/**`: R7-2 §7.4's two lines invert (R8-5 is landing them this round in their current, still-correct form).

**If the parent wants a smaller first step than all of that:** the highest-value non-schema slot in this space is precondition 0 alone — give the real executor a way to report a verdict — because it is the change that makes today's already-signed-off gate (`deterministic-fail`) real for the first time. Option (a) is a strictly larger question that only becomes answerable afterwards.

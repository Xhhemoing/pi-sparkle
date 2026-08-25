[Model: claude-opus-5-thinking-high-fast]

# R11-1 — Option (a), implemented as one diff

**Shipped: acceptance criteria can now gate a run. The mechanism is one optional nested protocol field, one new anomaly code fed by an explicit producer fact, and a durable seam on the flowchart checkpoint — not a criteria-shaped dimension FAIL, which R8-4 measured to be a silent no-op and which this diff leaves exactly as it was. A child that reports `criteria: [{ id, kind: "FAILED", evidenceIds }]` on its verdict blocks its run for review even when the whole-task verdict is PASSED; a child that says nothing about criteria behaves byte-identically to one running against the previous HEAD. Eight pins were replaced in place, not deleted, and a ninth is prescribed: one assertion is red at report time, in a file this slot is told not to edit — `test/integration/m2.5/resume.test.ts:408` — with the exact replacement in §7.**

Slot: R11-1 (P1). Branch `agent/opt-continuous`. Dispatched at HEAD `be21a05`; final verification re-run at HEAD `98c2194`, after R11-4/R11-8/R11-3 landed under me. No checkout, no commit, no push. Node v22.14.0.

---

## 1. What was asked, and where it is

| Mandate | Where |
|---|---|
| 1. Optional nested `VerificationResult.criteria`, additive-compatible | §3.1 — `src/protocol/v1.ts` |
| 2. `unmet-acceptance-criterion` fed by an explicit producer fact on **observed FAILED only**; never-ran stays unknown-not-unmet; `coverageOutcome` does **not** gain FAIL | §3.2 — `src/tracking/{gates,types,turn,from-child}.ts`; `coverageOutcome`'s body is byte-identical (§8) |
| 3. Durable per-task criteria on R9-1's reserved checkpoint seam; never synthesized; absence stays valid | §3.3 — `src/run/replay.ts` |
| 4. Per-criterion reporting on `sparkle_report_task_result`, without weakening R10-6 | §3.4 — `src/pi-adapter/pi-executor.ts`; R10-6 freeze audit in §6 |
| Replace R8-4 pins 1/3/4/5, R10-2's meta-pin, R10-2's two `criteria` pins, R9-1's reserved-unimplemented assertion | §5, §7 |
| Inherit R10-5 (`independentEvidence` unread, `void` kept, not renamed) | §6 — census still `deepEqual`s to exactly one `void`; the field is not mentioned in this diff |
| Re-derive the 270-cell sweep if the sole production path changes; do not delete | §5.3 — the path did not change, the sweep is intact at 270, its framing was truthed up |
| `cappedByHardFail` stays display-only | Untouched; R8-4's 54-of-270 pin re-runs green and unchanged |

## 2. Census — verified in source at the working tree

Ran before writing anything; every path the brief handed me was checked to exist.

- **R9-1's reserved-unimplemented assertion lives in two places, and only one is mine.** The prose reservation is `src/run/replay.ts:75-77` (mine). The *assertion* is `test/integration/m2.5/resume.test.ts:408-413` — R11-3's file this round. §7 handles it.
- **`observationFromChild` needs no change.** `src/run/child-tracking.ts:80` spreads the protocol verdict object wholesale (`...(verification !== undefined ? { verification } : {})`), so widening `ChildObservation["verification"]` carries `criteria` through with no edit to a file I do not own. That was load-bearing for keeping this diff inside its ownership.
- **`AgentExecutionRequest` carries no acceptance criteria** (`src/execution/contract.ts:5-15`), which settles R8-4 §3's correlation question in source: the tool physically cannot check a reported id against the task's spec.
- **`GATE_TRANSITION.reasonCode` is a free non-empty string** (`src/run/events.ts:1000`), so a new anomaly code needs no event-schema change. Confirmed by seeding one (§5.4).
- **`GateInput` object literals exist at 13 call sites, all in `test/unit/tracking/**`** — inside my ownership, which is why the new field could be required rather than optional (§3.2).
- **`AnomalyCode` has no consumer outside `src/tracking/` except `gate-apply.ts:262/279`**, which read `codes[0]` as an opaque string. No switch anywhere had to grow an arm.
- **Shared tree.** At census time the tree carried R11-3's `src/cli/main.ts` + `src/track/loop.ts` + `test/integration/m2.5/*` edits (uncommitted) and R11-10's `episode-contract-boundary.test.ts`. R11-4 and R11-8 were already committed (`9663294`, `39c97c3`); R11-3 committed during this slot (`ac3faa3`, `98c2194`) with byte-identical content. All of it is green against this diff (§8). `test/integration/m2.5/resume.test.ts` was 16 tests at R10-4 and is 19 at `98c2194` — R11-3's additions, not mine.

## 3. The four changes

### 3.1 The protocol field

```ts
export interface CriterionVerification { id: string; kind: VerificationKind; evidenceIds: EvidenceId[]; }

export interface VerificationResult {
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
  criteria?: CriterionVerification[];
}
```

`isVerificationResult` gains: optional; when present non-empty (absent and empty must not be two spellings of "nothing"); ids non-empty and unique within the array; `kind` from `VERIFICATION_KINDS`; `evidenceIds` all valid, **non-empty when `kind === "FAILED"`**. Ids are not correlated against the request — the validator has no access to a `TASK_REQUEST`, and the tracking layer ignores an id nobody asked for rather than discarding a real result over a reporting slip.

No `PROTOCOL_VERSION` bump, as designed and as R8-4 pin 5 proved was safe: `messageError` does not reject unknown keys, so the field is additive-compatible in both directions and every persisted `CHILD_MESSAGE` row keeps its meaning. That property is now asserted rather than assumed — `test/unit/protocol/v1.test.ts` round-trips a criteria-free terminal through `JSON.parse(JSON.stringify(...))` and back.

`UNOBSERVED` is expressible per criterion at the protocol layer (the distinction `coverageOutcome` refuses to fake) and is **not** offered by the tool (§3.4), for the same reason `UNOBSERVED` is not a reportable whole-task verdict: omitting a criterion already says it.

### 3.2 The gate

`AnomalyCode` and `ANOMALY_CODES` gain `"unmet-acceptance-criterion"`. `GateInput` gains a **required** `criterionUnmet: boolean`, pushed in `evaluateGates` after `claimed-verification-without-checks` and before `repeated-no-progress`.

Three decisions, each stated in-source:

- **Required, not optional.** A gate fact that defaults to `false` when nobody mentions it is how a gate quietly stops gating. Making it required forced all 13 existing `evaluateGates` literals to state it, which is the point; all 13 are in files I own.
- **Hard, not soft.** `gate-apply.ts::mapGateDirective` sends both kinds to `queue_analysis` → `BLOCKED`; "soft" would buy no gentleness, only a vaguer reason code.
- **Supplied, not derived.** `assessChildObservation` computes it from `unmetCriteriaOf(observation)` — criteria the child *reported* `FAILED`. Nothing in a `PrescoreInput` records a per-criterion outcome, so `runTrackingTurn`'s `?? false` means "not reported", never "met".

**Never-ran nodes stay unknown-not-unmet with no special case.** The code fires only on a reported FAILED. A node that never ran reports nothing; a criterion the verifier skipped is `UNOBSERVED`; a verdict with no `criteria` array says nothing at all. All three leave the gate open.

**`coverageOutcome` did not gain FAIL.** Its body is byte-identical. R6-2's FAIL-unreachable tripwire in `test/unit/run/flowchart-run-abort.test.ts` (not my file) is green untouched, and `criteria-are-guidance.test.ts`'s "no FAIL in its range, for any input at all" still holds.

**`derivedClaimedVerificationWithoutChecks`'s fate, decided (R8-4 §9 asked for a decision, not a side effect): unchanged.** `completedChecks` stays a request-derived echo. Making it an observation of the new channel would turn that derivation into the *leading* hard code for a PASSED child with an unmet criterion — but only when the child's own prose matches `isSuccessClaim`, which is untrusted text this codebase tags `UNTRUSTED_TEXT` precisely so it does not decide things, and it would miss the honest child that reports a gap without boasting. The reasoning is recorded above the function and in `prescoreInputFromObservation`'s docstring.

The criterion's own `evidenceIds` now flow into `evidenceRefsOf`, so the recorded assessment's `evidenceRefs` carry them and the anomaly is auditable. *Which* criterion it was stays readable from the child's `CHILD_MESSAGE` row, which carries the whole array durably — I did not widen `TrackingAssessment`, because that is a persisted-schema change (validator + hash) for a fact the log already holds.

### 3.3 The durable checkpoint seam

`FlowchartCheckpointState` gains `taskCriteria?: TaskAcceptanceCriteria[]`, a sibling of `contract`, where `TaskAcceptanceCriteria = { taskId: TaskId; acceptanceCriteria: AcceptanceCriterion[] }`. `validateFlowchartCheckpointState` validates it fail-closed: absent is valid and stays absent (no invented empty list); present must be a non-empty array ordered by strictly ascending `taskId` (which settles uniqueness in the same comparison, as R10-1's payload does); an **entry** may carry an empty `acceptanceCriteria`, because that is the durable statement "this task was dispatched with none" and is exactly the fact that distinguishes known-empty from unknown; criterion ids unique within a task; blank ids and descriptions refused.

Never synthesized — not from the bound episode, not from the flowchart definition (`FlowNode` carries no criteria), not from the run contract (whose criteria are the run's, not any one task's). Stated in-source, so R11-10's never-synthesize census keeps its subject.

**Disclosed, prominently: there is no `src` writer for this field at this diff.** The flowchart checkpoint writer is `src/run/flowchart-run.ts::persistCheckpoint`, which this slot does not own (R11-4 does). R8-4 §9 warns against shipping a channel with no filler and it applies here: the shape is fixed and validated, and until a writer lands the field is a declared seam rather than a working durability guarantee. That is why the never-ran-node posture in §3.2 is carried entirely by "only a reported FAILED gates" and not at all by this field — the gate does not depend on the writer existing. The prescribed writer hunk is in §7.

### 3.4 The reporting surface

`sparkle_report_task_result` gains an optional `criteria` parameter: `Array<{ id: string; verification: string; evidenceIds?: string[] }>`. Validated by `criterionList`, which refuses the whole verdict rather than trimming it — the same rule as `idList` one level up, for the same reason: a criteria list quietly missing its one FAILED entry is worse than no list. Refusals: non-array; empty array (`omit it to say nothing about individual criteria`); blank id; duplicate id; a verdict outside PASSED/FAILED; a malformed evidence reference; a FAILED criterion citing nothing. The tool description tells the child to leave out a criterion it did not check rather than guess.

Absence is absence: when the parameter is omitted the emitted `verification` object is byte-identical to before, which is why R10-6's `deepEqual(terminal.verification, { kind, evidenceIds })` pins still pass unmodified.

## 4. What this changes for a real run

A pi child that calls the tool with `verification: "PASSED"` and one `FAILED` criterion now produces: a scorable observation (`apply: true`), `gate.kind: "hard"`, `codes: ["unmet-acceptance-criterion"]`, `directive: queue_analysis`, `runStatus: BLOCKED`, and a `GATE_TRANSITION` whose `reasonCode` names the criterion class rather than a score. The operator's exit is R8-1/R10-1's `unblock`, which is why this was gated on those landing.

Everything else is unchanged. A child that reports no criteria, a child that is silent, a `--executor fake` run, and every log written before this diff all behave exactly as they did.

## 5. Pin replacements (nine)

### 5.1 R8-4's four, plus R10-2's meta-pin — `test/unit/tracking/option-a-preconditions.test.ts` (6 → 7)

| Pin | Was | Now |
|---|---|---|
| meta | `keeps the deferred option (a) pins 1, 3, 4, and 5 named exactly` | `keeps the landed option (a) pins…` — same mechanism, re-pointed at the four post-option-(a) titles. Weakening one still requires renaming it here, in the open |
| 1 | `criteria reach the prescore for exactly one role` | `…, and the gate for all of them` — the role gate is re-measured unchanged (still only `tester`), then the new half: a reported FAILED criterion blocks all seven roles, and the implementer's `check-coverage` still reads `NOT_APPLICABLE` while it does |
| 3 | `scoring the capped prescore would move 54 of 270 cells…` | **Title and count unchanged.** No cell in the grid reports a per-criterion outcome, so the measurement is untouched; the new `criterionUnmet: false` is stated explicitly with the reason |
| 4 | `…has no criterion-shaped anomaly code` | `…names exactly one criterion-shaped anomaly code` — `unmet-acceptance-criterion` now parses, the two near-miss spellings are still refused, and a real production-path assessment carrying the code is round-tripped through `parseTrackingAssessment` with its criterion evidence asserted present |
| 5 | `…one verdict per task and no per-criterion channel` | `…one verdict per task, and that verdict can speak per criterion` — three kinds still; interface fields now exactly `["kind", "evidenceIds", "criteria?"]`; R8-4's own additive-but-unread message still validates unchanged **and is now read**, with the silent case asserted alongside it |

New 7th pin: `the durable per-task criteria seam is declared, validated, and never synthesized` — the replacement for R9-1's assertion, in a file I own (§7).

### 5.2 R10-2's two `VerificationResult.criteria` pins — `test/unit/protocol/v1.test.ts` (19 → 20)

The compile-level `"criteria" extends keyof VerificationResult ? never : true` flips to `? true : never`, plus a value-level check that a verdict without `criteria` still typechecks as a `VerificationResult`. The source-level `doesNotMatch` becomes a `match` requiring the `?` — the field must stay optional. A second test covers the runtime rules end to end (valid mixed PASSED/FAILED/UNOBSERVED set; empty array, non-array, duplicate id, unevidenced FAILED, blank id, bad kind, bad evidence id, missing evidenceIds, and a bare string all refused).

### 5.3 The 270-cell criteria-are-guidance sweep — kept, framing truthed up

The condition R8-4 attached to keeping it as written is that the sole production path into three-line scoring is unchanged. It is: `criteria-are-guidance.test.ts`'s own census still resolves to exactly `{ "from-child.js": ["src/run/child-tracking.ts"] }`. The sweep is intact at 270 cells with the same assertions.

What changed is prose, because the file's headline claim was about to read as false: the header, the two `describe` titles and the recorded-contract pin now say that the criteria a caller *asks for* are guidance, and point at `option-a-preconditions.test.ts` for the channel that gates. The recorded-contract pin's regex moved with the source sentence it pins (`prescore.ts`'s "a criterion this dimension reads is a criterion that was asked for, and asking for something is not evidence about it") and gained a second assertion requiring the source to name where the gate went instead — `unmet-acceptance-criterion`. Recording an absence without recording the alternative is how the next reader concludes it was an oversight.

### 5.4 `event-row-fuzz` seeds — `test/unit/run/event-row-fuzz.test.ts` (7 → 9)

New shapes ride the fuzzer as R10-1's did. The base `CHILD_MESSAGE` seed keeps its QUESTION so the cross-round mutation sweep stays comparable; a criteria-bearing `TASK_RESULT` row is seeded and swept separately (120 mutations, same `assertEventInvariant` discipline), then eight hand-written malformed criteria lists are each refused with exactly `DomainValidationError`, and the absent-not-empty shape is round-tripped. A second test puts `unmet-acceptance-criterion` through a real `TRACKING_ASSESSMENT` row and a `GATE_TRANSITION` `reasonCode`, and re-proves that an undeclared spelling still fails the parser.

### 5.5 `test/unit/pi-adapter/report-task-result.test.ts` (17 → 20)

Additive: the per-criterion happy path (including id trimming and the absent-vs-empty distinction), a nine-case refusal table each asserting `harness.emitted` is empty, and an end-to-end replay through `PiAgentExecutor` proving the criteria ride the child's own terminal rather than a second one. R10-6's four freezes are untouched (§6). `test/unit/tracking/gates.test.ts` also gains one test (7 → 8): the new code alone, its ordering against each of the four codes around it, and the fact withdrawn leaving the gate open.

## 6. Inherited freezes — audited, not assumed

- **R10-5 `independentEvidence`:** not read, not renamed, not mentioned anywhere in this diff. The whole-`src` AST dereference census in `independent-evidence-posture.test.ts` still `deepEqual`s to exactly the one `void input.independentEvidence`, green in every run below.
- **R10-6 producer freezes, all four green and unmodified:** adversarial identity (the tool still stamps `runId`/`taskId`/`from` from the lease and reads nothing identity-shaped from `params`); explicitly-empty FAILED `evidenceIds` still refused emitting nothing — and the per-criterion rule is the *same* rule applied one level down, so it strengthens rather than weakens; one verdict per attempt (the `reported` guard is byte-untouched, and the criteria arrive on that one call by design); the AST pin that the tool is a direct `tools`-array element, with its opt-in mutant, is untouched — `createTaskResultTool` is still called exactly once and named once in the array.
- **`runStatus` gains no consumer.** Not touched.
- **`cappedByHardFail`** stays display-only; R8-4's 54-cell measurement re-runs unchanged.
- **`TERMINAL_REPLAY_STATUSES`** untouched (R11-9's freeze green); the `replay.ts` change is the checkpoint type plus one new private validator.
- **ADR-006 Proposed; no `docs/**`, `scripts/**`, `package.json`, ADR edits. No live R1. No new skip** (the one skip is the standing `PI_SMOKE` gate). No scratch files at report time (`/tmp/r11-1-*.bak` both deleted, §8).

## 7. The one red assertion, and the exact fix — for the parent / R11-3

`test/integration/m2.5/resume.test.ts:408-413` is R9-1's reserved-unimplemented pin. Implementing the seam necessarily fails it, and my ownership line says in as many words *"Do not edit `test/integration/m2.5/resume.test.ts` (R11-3)"*, so per the mandate I prescribe rather than edit. **One test fails; the other 18 in that file and all 315 other integration tests pass.** R11-3 has since landed (`ac3faa3`/`98c2194`) without touching these lines, so the file is now uncontended and this is a one-hunk parent fix-joint rather than a scheduling conflict.

Replace lines 405-413 with:

```ts
  // R8-4 §5.3's reservation is spent: Loop 4 R11-1 implemented per-task
  // acceptance criteria on this seam as `taskCriteria`, validated fail-closed
  // and still never synthesized. Behavioural coverage is in
  // test/unit/tracking/option-a-preconditions.test.ts.
  assert.match(checkpointState, /taskCriteria\?: TaskAcceptanceCriteria\[\]/);
  assert.match(checkpointState, /never \*synthesized\*/);
  assert.match(
    checkpointValidator,
    /validateTaskCriteria/,
    "the sibling field fails closed the way the contract does"
  );
```

I have already added the replacement pin in a file I own — `option-a-preconditions.test.ts`'s new 7th test — which asserts the same source structure plus the behavioural half R9-1's pin never had (absence stays absent; a known-empty entry survives; six malformed shapes refused by exact message prefix). So the coverage exists at HEAD regardless of when the integration line is flipped.

**Two more consumer prescriptions, both outside my ownership:**

1. **The checkpoint writer (`src/run/flowchart-run.ts::persistCheckpoint`, R11-4's file).** The field has no producer until this lands. The hunk mirrors the contract line immediately above it:

```ts
    ...(ctx.contract !== undefined ? { contract: ctx.contract } : {}),
    ...(ctx.taskCriteria !== undefined ? { taskCriteria: ctx.taskCriteria } : {})
```

   with `taskCriteria` accumulated on `FlowchartLoopContext` from the `TASK_REQUEST`s the run dispatches (ascending `taskId`), and read back in `childTasksFromLog`'s substitution path so a never-ran node is recorded as *unknown* rather than silently *criteria-free*. That is R8-4 §5's third part and the only part of the design this diff could not complete; it needs its own sign-off because it changes what a resumed node is gated against.

2. **Docs (`docs/status-matrix.md`, R11-5's file).** The coverage-gate row still says "This is a whole-task verdict only; there is still no per-criterion result channel." That sentence is now false. It should record: the channel exists as optional `VerificationResult.criteria`; a reported FAILED criterion reaches the new hard `unmet-acceptance-criterion` gate and can block an `--executor pi` run regardless of the child's role; asked-for criteria still move recorded verdicts and the numeric prescore but not the directive; `coverageOutcome` still has no FAIL in its range; `cappedByHardFail` is still display-only.

## 8. Verification

- **Whole-tree `npx tsc --noEmit` → exit 0**, including a final run at `98c2194`. Across the slot the only errors it ever reported were the 13 intended `criterionUnmet` omissions and the flipped compile-level protocol check, all in files I own, all resolved.
- **Scoped `eslint` over `src/protocol/v1.ts src/tracking/ src/pi-adapter/pi-executor.ts src/run/replay.ts` and all four owned test paths → clean, exit 0.**
- **Owned suites 3× consecutive: 211/211, 0 fail, 0 skipped** (`test/unit/tracking/*`, `test/unit/protocol/*`, `test/unit/pi-adapter/*`, `event-row-fuzz`). Stable across all three.
- **Whole `test/unit/**`: 1613/1613, 0 fail, 0 skipped** (re-run at `98c2194`). Includes R6-2's tripwire (`flowchart-run-abort.test.ts`), R10-5's dereference census, R10-6's four producer freezes, R10-7/R11-10's episode boundary, R10-10/R11-9's terminal freeze, R10-8/R11-8's `applyRetry`-absence pin, and `flowchart-snapshot.test.ts`'s "absence stays absence" contract pin.
- **Whole `test/integration/**`: 316 tests, 314 pass, 1 fail, 1 skipped** (re-run at `98c2194`, i.e. over R11-4's restore-side audit and R11-3's pause controller). The fail is §7's single assertion. The skip is the standing `PI_SMOKE` gate — no second skip introduced.
- **`test/unit/routing/live-isolation.test.ts`: 9/9.** Run because the diff adds imports; the only `src` import added is a type-only `AcceptanceCriterion` in `replay.ts` (erased at runtime). The other new imports are test-side.
- **Two mutation checks, both proving the new pins bite, both reverted and re-verified:**
  - Deleting `if (input.criterionUnmet) hardCodes.push("unmet-acceptance-criterion");` from `gates.ts` turned **4** tests red (the new gates test and option-a pins 1, 4, 5). Restored; `git diff --stat src/tracking/gates.ts` back to `22 insertions(+)`, 0 deletions, and the suite green.
  - Replacing `validateTaskCriteria(value.taskCriteria)` with an unchecked cast turned the new checkpoint pin red and nothing else. Restored; `tsc` and the suite green.
  - `/tmp/r11-1-gates.bak` and `/tmp/r11-1-replay.bak` both deleted.
- **Diff, insert-heavy and comment-heavy.** `src` (`+/−`): `pi-executor.ts` 84/5, `protocol/v1.ts` 55/5, `replay.ts` 106/5, `from-child.ts` 76/15, `prescore.ts` 41/29 (a docstring rewrite — every removed line is inside the `coverageOutcome` comment block), `gates.ts` 22/0, `turn.ts` 15/0, `types.ts` 2/0. `coverageOutcome`'s body, `constraintOutcome`, `computePrescore`, `evidenceOutcome`, `progressOutcome` and `scopeOutcome` are byte-identical. Tests: `option-a-preconditions` 244/38, `event-row-fuzz` 150/0, `report-task-result` 103/0, `protocol/v1` 74/6, `gates` 56/0, `criteria-are-guidance` 28/12, `acceptance` 4/0. Static test-registration delta **+8**, counted per file base-vs-tree: `option-a-preconditions` 6→7, `protocol/v1` 19→20, `report-task-result` 17→20, `event-row-fuzz` 7→9, `tracking/gates` 7→8; `criteria-are-guidance` 10→10 and `acceptance` 6→6 (edits inside existing tests).
- No full gate (parent's job). No commits, no checkout, no push. No new files outside my ownership.

## 9. Residuals a later round should know about

1. **`taskCriteria` has no writer** (§3.3, §7.1). Until `flowchart-run.ts` fills it, R8-4 §5's durability answer is a declared shape rather than a working guarantee. The gate does not depend on it, so nothing is unsound; the never-ran-node *downgrade* (recording such a node as `UNOBSERVED` rather than `NOT_APPLICABLE`) is still unimplemented and still needs the writer plus a `childTasksFromLog` reader.
2. **The role gate (R8-4's C4) survives on the prescore side.** Only a tester's asked-for criteria become `requiredChecks`. The new gate sidesteps it entirely — a reported criterion outcome is read whatever the role — but the asymmetry is now visible in one file and pinned in pin 1; whether `check-coverage` should apply to more roles is a separate question this diff did not answer.
3. **A criterion id nobody asked for is silently accepted.** Deliberate (R8-4 §3: correlation is the tracking layer's job and a slip must not destroy a result), but it means a child could block its own run by naming a criterion the parent never set. The child can already block itself with a whole-task FAILED, so this adds no new authority — recorded so nobody re-derives it as a defect.
4. **`derivedClaimedVerificationWithoutChecks` is now dead weight in a narrower sense than before.** It still fires only on the FAILED/success-claiming-prose combination, behind `deterministic-fail`. The decision to leave it (§3.2) was a decision to not widen it; deciding to *remove* it is a different question with its own evidence.

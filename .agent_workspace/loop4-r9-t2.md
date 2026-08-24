[Model: claude-opus-5-thinking-high-fast]

# R9-2 — An executor that can report a verdict

**Shipped: `sparkle_report_task_result`, a per-request tool on `PiAgentExecutor` built the way `createClusterTools(request.cluster)` is built. A pi child can now emit a real protocol-v1 `TASK_RESULT` with `verification.kind` PASSED or FAILED into its attempt transcript, and `finish` replays it instead of synthesizing `UNOBSERVED`. R8-4's precondition 0 is closed: the tracking gate has a live producer for the first time. No protocol schema change. R8-4's pin 2 is re-derived in the same diff, not deleted, and now pins both halves — the real executor as a PASSED/FAILED producer and the silent default path as UNOBSERVED. §5 discloses exactly which gate outcomes this makes reachable for `--executor pi`, measured rather than argued; §6 re-checks C6 against real inputs and finds R8-4's prose still correct.**

Slot: R9-2. Branch `agent/opt-continuous`, no commits, no checkouts. Tree touched: `src/pi-adapter/pi-executor.ts` (sole, mine), `test/unit/tracking/option-a-preconditions.test.ts` (pin 2 + its header note only), one new file `test/unit/pi-adapter/report-task-result.test.ts`. Nothing else.

---

## 1. What I did and did not do

| Asked | Done |
|---|---|
| Census current producers of `verification: { kind: … }` in `src/**` first | §2. Exactly the two fakes (PASSED) plus pi (UNOBSERVED), verified in the working tree before I edited anything |
| Surface a `report_task_result` tool through the existing per-request tool seam | §3. `createTaskResultTool(request, emit)`, built inside `runAttempt` beside `createClusterTools`, appended to the same `tools` array |
| `finish` prefers a child-authored `TASK_RESULT` over the synthesized UNOBSERVED | §3.4. The `collected.some(… TASK_RESULT)` guard already existed and was dead; it is now the live path, mutation-proved (§7) |
| Replace R8-4 pin 2 in the same diff; census must include the real executor as a PASSED/FAILED producer, and the no-tool path may still be UNOBSERVED — pin both | §4. Pin 2 rewritten in place, both halves pinned, header note added |
| Disclose exactly which tracking-gate outcomes become reachable for `--executor pi` | §5, with a 360-cell measurement and the unreachable list |
| Re-check `derivedClaimedVerificationWithoutChecks` against real inputs | §6. R8-4's C6 holds unchanged; now pinned with a real reported message instead of prose |
| Offline tests only; no live provider; no `PI_SMOKE` skip | §7. Faux provider scripts the tool call. Test count 1574 → 1587 unit; skip count unchanged (the one `PI_SMOKE` skip lives in `test/integration/pi-adapter/provider-smoke.test.ts` and I did not touch it) |
| No protocol schema change; no `prescore.ts`/`gates.ts` behaviour change; no `VerificationResult.criteria`, no unmet-criterion anomaly, no never-ran-node checkpoint field | `git diff --stat src/` shows one file of mine. `src/protocol/v1.ts`, `src/tracking/**`, `package.json`, ADR-006 all byte-untouched by me |
| Census first, scoped eslint + whole-tree `tsc`, live-isolation, no full gate, no scratch files | §7 |

## 2. Census — verified in the working tree before the edit

`rg -n 'verification:\s*\{\s*kind' src/` at 22:0x UTC, before my first edit:

```
src/run/flowchart-run.ts:732: * `verification: { kind: "FAILED" }` drives the three-line gate to   <- a comment
src/testing/fake-executor.ts:76:  verification: { kind: "PASSED",  evidenceIds: [`evd_fake-${request.taskId}`] }
src/pi-adapter/pi-executor.ts:386: verification: { kind: "UNOBSERVED", evidenceIds: [] }
src/cli/main.ts:153:              verification: { kind: "PASSED",  evidenceIds: [`evd_fake-${request.taskId}`] }
```

Exactly what R8-4 C5 recorded and the brief predicted: two fakes hard-coding PASSED, the one real executor hard-coding UNOBSERVED, and one comment. R8-4's pin 2 was green against this.

Re-verified the two structural premises in source rather than from the report: `translatePiEvent` (`pi-executor.ts:85-129`) maps `message_update`/`tool_execution_start`/`tool_execution_end`/`turn_end` and returns `undefined` for everything else, so no `MESSAGE` could ever enter `events`; `runAttempt` collects only translated events; `finish`'s `collected.some(… "TASK_RESULT")` guard was therefore always false and the `UNOBSERVED` branch always taken. `assessChildObservation` (`from-child.ts:59-61`) refuses anything that is not PASSED or FAILED.

**Consumers of the surface I changed, censused and all run in §7:** `src/pi-adapter/runtime.ts` (`createConfiguredPiExecutor`, unedited — see §3.3 on why the tool is not opt-in), `src/run/child-coordinator.ts::handleExecutionEvent` (the `MESSAGE` case — the validator and lease checks my message must satisfy), `src/run/child-tracking.ts::observationFromChild`, `test/unit/pi-adapter/**` (7 files), `test/integration/pi-adapter/**` (5 files), `test/unit/cli/thinking-flag.test.ts`. No `src` consumer needed an edit: the executor's contract (`AsyncIterable<ExecutionEvent>`) is unchanged and `MESSAGE` was already a member of that union with a working handler on the other side.

## 3. What shipped

### 3.1 The tool

`createTaskResultTool(request, emit)` returns one `AgentTool`, named `sparkle_report_task_result` (exported as `REPORT_TASK_RESULT_TOOL`). Parameters: `verification` (PASSED | FAILED), `summary`, optional `outcome`, optional `evidenceIds` / `artifactIds`. On success it pushes one `{ type: "MESSAGE", message }` into the attempt's event array and returns `recorded <KIND> for <taskId>` to the model.

**Identity is stamped from the lease, never taken from the model.** `runId`, `taskId`, `from`, `to`, `id`, `occurredAt`, `protocolVersion` come from `request` and the adapter's own id/clock helpers. Two reasons: `child-coordinator.ts:771-776` refuses a message whose `from`/`runId`/`taskId` do not match the lease, so a model-supplied id would only ever fail the task; and a child that could name those fields could impersonate a peer on the cluster plane. The model supplies the verdict, its prose, and its references — nothing else.

### 3.2 The five producer-side rules, each with its reason in-source

| Rule | Why, not just what |
|---|---|
| `verification` must be PASSED or FAILED | UNOBSERVED is already what silence means, and `finish` synthesizes it. A tool call that says "I did not look" is indistinguishable from not calling the tool |
| `summary` must be non-empty after trimming | protocol v1 rejects an empty summary; refusing here tells the model why instead of failing the task at the coordinator |
| `outcome` defaults PASSED→SUCCESS / FAILED→FAILURE; explicit values limited to SUCCESS / PARTIAL / FAILURE | **CANCELLED is refused**: cancellation is the parent's fact, observed by the adapter through the abort signal. A child asserting it would replace an observation with a claim, and `child-coordinator.ts:529` maps a terminal's CANCELLED straight to the child outcome |
| A malformed `evd_`/`art_` reference refuses the whole call rather than being dropped | Silently shrinking the list leaves the verdict citing less than the child believes it cited |
| **A FAILED verdict must cite at least one `evidenceId`** | Load-bearing, not decoration: `from-child.ts:76-79` discards an assessment whose FAIL dimensions carry no evidence refs, so an unreferenced FAILED verdict would vanish between the transcript and the gate — the one verdict we most need to arrive. Pinned from the tracking side in pin 2 |

Refusals throw `DomainValidationError`. The pi agent loop turns a thrown tool error into an error tool result the model can read and retry from (`agent-loop.js:472-479`), which is the documented `AgentTool` contract and the same shape `sparkle_send` already uses. The run is not failed by a refusal (pinned).

**One verdict per attempt.** A second call is refused at the tool with the verdict already on the record named in the message. The alternative — emit it and let `AttemptTranscript.accept` reject the duplicate terminal — turns a model calling twice into a protocol violation that fails the whole task. Refusing at the producer keeps the transcript's at-most-one-terminal invariant without that punishment. First report wins; disclosed as a choice in §8.

### 3.3 Wiring — always surfaced, per attempt

```ts
const clusterTools = request.cluster !== undefined ? createClusterTools(request.cluster) : [];
const reportTaskResult = createTaskResultTool(request, (event) => events.push(event));
… tools: [...(this.options.tools ?? []), ...clusterTools, reportTaskResult]
```

Built **inside `runAttempt`**, so each attempt gets a fresh tool over that attempt's own `events` array. `runWithRetry` only surfaces the last attempt's events, so a verdict reported by an attempt that then failed does not leak into the retried transcript — the existing "a failed turn never leaks" rule now covers verdicts too, and that is pinned.

Not an opt-in option, and that was forced as much as chosen: `PiExecutorOptions` is not per-request (it cannot see `runId`/`taskId`/`agentInstanceId`), and the only production construction site is `createConfiguredPiExecutor` in `src/pi-adapter/runtime.ts`, which is **not mine this round**. A flag I could not plumb would be a tool no production run could reach. Always-on is also the `createClusterTools` posture: a capability of the request, not of the operator's configuration.

`parameterHash` is unaffected — `buildInvocation` hashes `this.options.tools` only, which is exactly how the cluster tools already sit outside it. Invocation records are byte-identical for a run that does not call the tool.

### 3.4 `finish`

Unchanged in behaviour-per-input; its guard is simply now reachable. Its docstring gained the rule the guard encodes: a child that reported already put its terminal in the transcript, and the adapter must neither overwrite an observation with UNOBSERVED nor append a second terminal. Only a silent child is synthesized for — so **UNOBSERVED still means exactly what it meant before: nobody looked.**

## 4. Pin 2, re-derived (R8-4's replace-in-same-diff obligation)

`test/unit/tracking/option-a-preconditions.test.ts` pin 2 was `no shipped executor can produce the verdict the gate admits on`. It is now `the real executor now produces the verdict the gate admits on; silence still does not`. Pins 1, 3, 4, 5 are byte-untouched; the file header gained four lines recording that pin 2 has been through its replacement and the other four still stand.

What the rewritten pin locks:

1. **The re-derived source census.** The old regex only matched a quoted literal kind, so it would have gone *green-by-blindness* against a producer whose kind is a runtime value. It now also matches the shorthand property and records it as `<runtime>`:
   ```
   { "src/cli/main.ts": ["PASSED"],
     "src/pi-adapter/pi-executor.ts": ["<runtime>", "UNOBSERVED"],
     "src/testing/fake-executor.ts": ["PASSED"] }
   ```
2. **The pi adapter now emits two protocol messages, not one** — the child's verdict and the terminal it synthesizes when there is none. The old count-of-1 assertion is now 2, with the two named.
3. **The behavioural half runs the shipped tool.** `reportedTerminal(...)` calls `createTaskResultTool(...).execute(...)`, revalidates the emitted message through `validateAgentMessage`, and wraps it in the `ChildRunOutcome` the coordinator would build (`outcome`/`summary` from the terminal per `child-coordinator.ts:529-530`, id lists per `:570-571`). A PASSED verdict scores with `gate.kind === "none"`; a FAILED verdict scores with `gate.codes === ["deterministic-fail"]`. These are real executor outputs, not hand-written lookalikes.
4. **The C6 probe** (§6).
5. **The default path is unchanged**: the exact synthesized UNOBSERVED shape still reads `apply: false`.
6. **The evidence rule is load-bearing**: a FAILED verdict citing nothing reads `apply: false`, which is why the tool refuses one.

## 5. Which tracking-gate outcomes become reachable for `--executor pi` (R8-4 C6, the disclosure)

Measured, not argued. Two offline sweeps over `assessChildObservation` / `runTrackingTurn` with the inputs a pi child can actually produce (`humanInput: {}`, `constraints` from the run contract, `stalledTurns: 0`, `escaped: false` — all fixed by `prescoreInputFromObservation`).

**Newly reachable:**

| Path | What is written | Note |
|---|---|---|
| Child reports **PASSED** | `TRACKING_ASSESSMENT`, directive `none`, run stays RUNNING, **no** `GATE_TRANSITION` (`gate-apply.ts:117-122`) | The first real tracking assessment a pi run has ever recorded. Swept 360 shapes (5 outcomes × artifacts × evidence × 3 criteria variants × 3 summaries × constraints): **zero** leave `kind: "none"`; the score floor is 0.750 against `softThreshold` 0.55 |
| Child reports **FAILED** (+ ≥1 evidence id) | `TRACKING_ASSESSMENT` → `GATE_TRANSITION` to BLOCKED with `reasonCode: "deterministic-fail"` → `RUN_BLOCKED { reason: "ANALYSIS_QUEUED" }` | **A pi run can now be blocked by the tracking gate.** 180/180 swept FAILED shapes apply and are `hard` with `deterministic-fail` leading. R8-1's `pi-sparkle unblock` is what reopens such a run — R8-4 C8's dependency is already satisfied, which is why this is safe to ship now and would not have been in Round 7 |
| `claimed-verification-without-checks` | A **second** code, never the first | §6 |

Reachable for **every role**, not only tester: `observationFromChild` gives a non-tester `requiredChecks: []`, so `check-coverage` reads `NOT_APPLICABLE`, but the `task-result` tool situation still supplies a hard PASS/FAIL, so `shouldApplyThreeLine` is satisfied. Verified for implementer / worker / tester, both verdicts.

**Still unreachable for `--executor pi`, with the reason:**

- `soft-threshold` — the PASSED score floor is 0.750 (360 cells, none below), well above 0.55.
- `ownership-escape` — `prescoreInputFromObservation` hard-codes `escaped: false` on the single tool situation it builds.
- `repeated-no-progress` — it hard-codes `stalledTurns: 0`.
- `user-reject-stop`, `permission-security-reject` — `assessChildObservation` passes `humanInput: {}`; there is no human signal on this plane.
- `minor-escalated` — `openMinors: []`.
- `mandatory-omission` / directive `wait_user` — `rollSummary` only fails closed when `maxItems` is defined, and `assessChildObservation` never passes it.

So the honest one-line version: **`--executor pi` moves from "the gate does not run" to "the gate runs, opens on PASSED, and hard-blocks on FAILED".** The always-opening state R8-4 attributed to `--executor fake` is now also pi's PASSED state — but pi's FAILED state is new, and it is the first production path on which `deterministic-fail` can fire from something other than a hard-coded constant.

**Not changed, deliberately:** `cappedByHardFail` stays display-only (R8-4 §6); `coverageOutcome` cannot FAIL (R6-2's tripwire green); `independentEvidence` is still `void`-ed inside `computePrescore`, so the fact that it is now set from a *self*-report reads nowhere. I flag that last one as a latent naming hazard for whoever wires it up later, not a defect today.

## 6. C6 re-checked against real inputs

R8-4 C6 predicted, from prose: a real verdict channel turns `derivedClaimedVerificationWithoutChecks` from a copy-fed no-op into a producer of `claimed-verification-without-checks`, but only in a prose-conditioned subset. **Re-checked against messages the shipped tool really emitted, the prediction holds exactly, and nothing about it needs deciding this round:**

- On **PASSED** it can never fire. `from-child.ts:162` still sets `completedChecks = [...requiredChecks]` when the verdict is PASSED, so the gap cannot open. My change does not touch that echo.
- On **FAILED** it fires iff the child's own `summary` matches `isSuccessClaim`'s `/pass|passed|verified|succeed/i` **and** `requiredChecks` is non-empty — i.e. a tester (any tester, since a bare tester gets the synthetic `["test"]`). 60 of 180 swept FAILED cells, which is exactly the one summary of three that trips the regex.
- It is **never the leading code**: `gates.ts:20-22` pushes `deterministic-fail` first, and a FAILED verdict always sets it. `mapGateDirective` stamps `codes[0]`, so the transition's `reasonCode` and the operator-visible block reason are unchanged. The second code lands in the assessment record only.

Pinned in pin 2 with a real reported terminal (`summary: "the suite passed except for two assertions"`) asserting `["deterministic-fail", "claimed-verification-without-checks"]`, and its neutral-prose sibling asserting `["deterministic-fail"]`.

The consequence R8-4 named — that this code misses the honest child who reports an unmet criterion *without* claiming success — is unchanged and unaddressed, because addressing it is option (a)'s job and option (a) is explicitly not this slot.

## 7. Verification

- **Whole-tree `npx tsc --noEmit`** → exit 0, twice (after the executor change, and again after the pin rewrite), against a shared tree carrying R9-1's in-flight edits to `replay.ts`/`flowchart-run.ts`/`main.ts` and R9-4's docs.
- **Scoped `npx eslint src/pi-adapter/ test/unit/pi-adapter/ test/unit/tracking/`** → clean, exit 0.
- **Owned tests 3× consecutive**: `test/unit/pi-adapter` + `option-a-preconditions.test.ts` → **94/94, 0 fail, 0 skipped** each time (~2.6 s).
- **Whole `test/unit`** → **1574 pass / 0 fail / 0 skipped** (19.8 s). Round 8's unit baseline plus my 13.
- **`test/unit/pi-adapter` alone**: 76 → 89 (13 new). **`test/unit/tracking`**: 75, unchanged (pin 2 replaced in place).
- **`test/integration/pi-adapter` + `test/unit/cli/thinking-flag.test.ts`** (the censused consumers) → 20 pass, **1 skipped — the pre-existing `PI_SMOKE=1` real-provider gate**, which I did not touch. No second skip anywhere.
- **`test/unit/routing/live-isolation.test.ts`** → green. My only new module edge is `pi-executor.ts → src/domain/errors.ts`; `Type` comes from the already-imported `@earendil-works/pi-ai`, and `isEvidenceId`/`isArtifactId`/`TaskOutcome`/`VerificationKind` were added to import statements that already existed. No watched module moved.
- **Two mutation checks, both reverted immediately and the revert verified by `git diff`:**
  1. Unwired `reportTaskResult` from the `tools` array → 2 of 13 new tests red (`Tool … not found`), the tool-level 8 still green. Proves the wiring is what makes the end-to-end pins pass.
  2. Changed `finish`'s guard from `"TASK_RESULT"` to `"PROGRESS"` → `replays the child's verdict instead of synthesizing UNOBSERVED` red with two terminals. Proves the "finish prefers the child's terminal" pin is not vacuous.
- **No full gate** (parent's job). **No scratch files at report time**: the tree carries only my three files; the gate-outcome sweeps in §5/§6 were run as `npx tsx --input-type=module -e` one-liners that wrote nothing.

**Shared-tree note.** At 22:36 UTC `git status` shows twelve modified files; nine are other slots' in-flight work (R9-1: `src/run/replay.ts`, `src/run/flowchart-run.ts`, `src/cli/main.ts`, `test/integration/m2.5/resume.test.ts`, `test/unit/persist/row-fuzz.test.ts`, `test/unit/supervisor/flowchart-snapshot.test.ts`; R9-4: three docs files). None is mine, none broke anything I ran, and none touches `src/pi-adapter/` or `test/unit/pi-adapter/`. The one file we could have collided on is `src/cli/main.ts`, whose `ChildFakeExecutor` is a producer in pin 2's census — R9-1's edit there does not add or move a `verification: { kind: … }` site, and pin 2 was green against the tree as of my last run. **If a later slot turns pin 2 red, the response is still to re-derive the producer census, not to delete the pin.**

## 8. Decisions I made that a reviewer should check, and what I refused

**Made, with the reasoning in-source:**

1. **The tool is always surfaced**, not gated by an option. Forced by ownership (§3.3) and consistent with the cluster-tool precedent. If the parent wants it opt-in, that is a `runtime.ts` + `main.ts` change and belongs to whoever owns those files.
2. **First report wins; a second call is refused.** The alternative (last wins) would mean either emitting two terminals — a protocol violation the transcript rejects — or buffering and rewriting a message the child already sent. Refusing at the producer is the only shape that keeps the transcript honest and does not fail a task over a model slip.
3. **FAILED must cite evidence** (§3.2). This is a producer-side constraint that did not exist before, justified by a real downstream discard, and pinned from both sides.
4. **CANCELLED is not a claim a child may make.**
5. **A reported terminal survives an executor-level failure on the *same* attempt.** If the child reports and the provider then errors, `finish` replays the child's verdict and `EXECUTION_FINISHED` still carries `FAILURE`; the coordinator prefers the terminal (`child-coordinator.ts:504-539`) and the task takes the reported outcome. I kept this rather than suppressing the message, because the child really did say it and suppressing would be the adapter lying by omission — and because the coordinator's existing ordering already privileges a terminal over `executorOutcome` for the fakes. **A parent-signal abort still dominates**: `child-coordinator.ts:462-466` checks `parentSignal.aborted` before it looks at the terminal, so a cancelled run does not adopt a verdict reported just before the abort. Both halves are pinned (the retry-drop pin, and the abort behaviour is unchanged and covered by `executor-abort.test.ts`).

**Refused, as instructed:** no `VerificationResult.criteria`; no `unmet-acceptance-criterion` code; no never-ran-node checkpoint field; no `protocol/v1` edit of any kind; no `prescore.ts`/`gates.ts` behaviour change; no `check-coverage` FAIL; no `package.json`; no ADR-006; no live provider and no new skip.

## 9. What this unblocks, and what it does not

R8-4's precondition 0 is closed. The remaining preconditions for option (a) are unchanged and still sequenced as R8-4 §9 wrote them: R9-1's checkpoint seam (for durable per-task criteria), R8-1's unblock (**already landed**, and now materially load-bearing — see §5, a FAILED verdict really can block a pi run), then option (a) as one diff.

Two things this does **not** buy, stated so nobody reads more into it:

- **It does not make the verdict independent.** The child scores itself. `independentEvidence` is set from that self-report and is `void`-ed, so nothing reads it today; a future slot that gives it meaning must not read it as third-party verification. The honest framing is the one `assessChildObservation` already uses: `verification.kind` is *the deterministic verifier's* verdict, and for a pi child the verifier is the child's own report of what it ran.
- **It does not make criteria gate.** `requiredChecks` still reach the prescore for testers only (pin 1, untouched), `completedChecks` is still echoed from the request (pin 2's old premise, untouched), and `coverageOutcome` still cannot FAIL. A per-criterion channel would still be fillable only through a new producer surface — the difference is that after this slot such a surface would have somewhere real to live.

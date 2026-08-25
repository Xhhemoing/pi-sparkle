# R6-2 — A resumed run's children are not the children the run started

**No reachable false-accept. Measured, not argued: across all 240 observations a routed child can produce, the gate directive is identical under the original spec and the rebuilt one (0 differences, 0 false accepts, 0 false rejects). This slot is NOT a Round 7 P0.** The re-specification is real and now pinned, but it is *inert with respect to the gate* for a structural reason that is itself worth more than the original finding: acceptance criteria are never compared against anything the child did, on any path, resumed or not.

Slot: R6-2 (P1, resume-honesty investigation). Base `agent/opt-continuous`, HEAD `b4cc072`. Investigation-first, **no `src/**` edits**. `flowchart-run.ts` untouched (R6-1 sole owner); `childTasksFromDefinition` not moved.

---

## 1. Census first (the brief's claims, checked at HEAD)

`childTasksFromDefinition` is at `flowchart-run.ts:231-250` (the brief said 234-253; R6-1's in-flight diff deleted `hasEvent` above it and shifted it by 3). Sole caller `:1094`, in `resumeLockedFlowchartRun`. Every claim in the brief reproduced:

| Brief's claim | Verified | Note |
|---|---|---|
| hard-coded `maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000` | yes | vs. caller's own limits |
| empty `acceptanceCriteria` and `inputArtifactIds` | yes | |
| no `assignedModel`, no `cascade` | yes | production sets both on every routed child |
| the three-line gate assesses against `spec.acceptanceCriteria` | **partly** | only via `child-tracking.ts:57-64`, and **only when `role === "tester"`** — see §3 |
| the log carries `TASK_REQUEST` + `MODEL_ROUTED`, so reconstruction may need no schema | **yes, exactly** | proved by construction, §4 |

**Two things the brief did not have.**

1. **The role is coarsened, not preserved.** `compileChildrenToFlowchart` maps every non-reviewer `AgentRole` to flowchart role `"actor"` (`flowchartRoleForAgentRole`, `compile-children.ts:50-52`); `mappedAgentRole` then maps `"actor"` back to `"implementer"`. So a **`tester` child resumes as an `implementer`** — and `role` is precisely what decides whether acceptance criteria reach the gate at all. The round-trip is lossy for all five of `worker`/`scout`/`planner`/`tester`/`debugger`.
2. **The requirement contract is dropped too.** `startLockedFlowchartRun` threads `input.contract` into the loop context (`:1023`); `resumeLockedFlowchartRun` never does (`:1118-1142` has no `contract` key). So a resumed child is assessed with **no constraints**, independently of the child-spec gap. This is the same bug one layer up and was not in the brief. Pinned in §5.

---

## 2. The measurement (the brief's question, answered)

> Can a resumed node actually pass a gate the original criteria would have failed?

**No.** Two independent measurements, both at the current tree state.

### 2a. Two-leg run (the shape the brief asked for)

Production-shaped tester children with real criteria, a routed model and a cascade; two nodes `a → b`; leg 1 pauses after `a`, leg 2 crashes after `b`'s result lands but before acceptance, leg 3 resumes and re-executes `b`. `a` is gated under the caller's spec, `b` under the rebuilt one, on identical child behaviour.

```
TASK_REQUEST on the parent log:
  tsk_a  criteria=[crit-integration,crit-regression]  limits={maxAttempts:1,timeoutMs:30000,maxWallTimeMs:300000}
  tsk_b  criteria=[]                                  limits={maxAttempts:2,timeoutMs:60000,maxWallTimeMs:3600000}

assessments:
  tsk_a  gate=none codes=[]  check-coverage=PASS
  tsk_b  gate=none codes=[]  check-coverage=NOT_APPLICABLE
```

The spec really is lost; the verdict is unchanged. The child's **prompt** also loses the criteria (`buildChildPrompt` → `formatChildPrompt(..., acceptanceCriteria)`): leg A's prompt contains `crit-integration`, leg B's does not.

### 2b. Exhaustive sweep (240 observations)

One run is one point. The sweep enumerates every observation a routed child can produce — `outcome` × `verification.kind` × summary (success-claim / neutral / empty) × artifacts × evidence, 240 cells — and compares the gate directive under `original` (role `tester`, two criteria, contract constraints) against `rebuilt` (role `implementer`, no criteria, no contract):

```
observations swept:                    240
differ in whether the gate ran at all:   0
differ in recorded prescore P:          12
differ in recorded gate codes:          10
differ in GATE DIRECTIVE:                0

reachable FALSE ACCEPTS: 0
reachable FALSE REJECTS: 0

directives reachable per verification.kind (both spec shapes pooled):
  PASSED      -> none/RUNNING  |  NO-GATE (assessment skipped)
  FAILED      -> queue_analysis/BLOCKED  |  NO-GATE (assessment skipped)
  UNOBSERVED  -> NO-GATE
  undefined   -> NO-GATE
```

The gate directive is a **pure function of `verification.kind`**. The spec cannot move it. What the spec *does* move is what gets written down: 12/240 cells record a different `P` and 10/240 a different code set for the same child behaviour, so the ledger is less honest after a resume even though the decision is the same.

### 2c. Why — three structural reasons, each measured

1. **check-coverage is tautological and can never FAIL.** `prescoreInputFromObservation` sets `completedChecks = verification.kind === "PASSED" ? [...requiredChecks] : []` (`from-child.ts:141`). It compares a list against a copy of itself. Reachable outcomes: `PASS`, `UNOBSERVED`, `NOT_APPLICABLE`. **`FAIL` is unreachable.** Acceptance criteria are decorative in the gate — they are never checked against anything the child actually did.
2. **The one criteria-derived hard code is strictly subsumed.** `claimed-verification-without-checks` needs `requiredChecks` non-empty *and* a completed-gap, which only happens when `verification.kind === "FAILED"` — which already raises `deterministic-fail`. Measured: raised 5 times, sole hard code **0** times.
3. **The soft gate cannot fire on a PASSED child.** Minimum gate score on the PASSED path is **0.6667** against `softThreshold` 0.55 — margin **0.1167**. Only `progress-vs-stall` can FAIL there (`evidence-consistency` needs a non-zero exit code, `scope-safety` needs `escaped`/`writePaths`, both impossible from `prescoreInputFromObservation` on a PASSED result), so quality bottoms out at 2/3.

Dropping the contract removes a dimension that is *always* `PASS` when present, which lowers `P` — i.e. it errs toward stricter, never toward accepting. That is why there are 0 false rejects as well as 0 false accepts: the loss never crosses a threshold in either direction.

**Consequence for the round:** this is not the loop's first P0, and the Round 7 version of this slot should not be filed as one. It is a P1 honesty-and-cost defect with a fully specified fix (§4) and a tripwire (§5) that converts the negative result into a guard.

---

## 3. Where the gap *does* bite today

Nothing here is a silent false success; all of it is real:

| Lost on resume | Consequence |
|---|---|
| `acceptanceCriteria` | the child agent is **told less than the original was** (prompt), and the ledger records a different `check-coverage` verdict for the same work |
| `inputArtifactIds` | the resumed child is not seeded with the artifacts the caller chose |
| `limits` | budget silently **widened**: `maxAttempts` 1→2, `timeoutMs` 30s→60s, `maxWallTimeMs` 300s→3600s. A resumed run can pay up to 12× the wall-time the caller authorised |
| `assignedModel` + `cascade` | the resumed child is unrouted, so `maybeCascadeRetry` has no plan: no tier escalation on a deterministic FAIL |
| `role` (tester→implementer, etc.) | role-dependent behaviour diverges; the role also feeds the child prompt and the learning plane |
| the requirement `contract` | resumed children are assessed with **no constraints** at all |

The budget widening is the sharpest *practical* one: it is an unauthorised spend increase that no disclosure currently covers.

---

## 4. Decision: **reconstruct from the log.** Not disclosure, not schema.

R4-6 refused to persist executor config because the log did not carry it. **That reason does not apply here** — verified by building the reconstruction and diffing it against the spec the run started with:

```
=== field-by-field: original spec vs reconstruction from the log ===
  MATCH  taskId      MATCH  role         MATCH  objective
  MATCH  profile     MATCH  inputArtifactIds
  MATCH  acceptanceCriteria               MATCH  limits
  MATCH  assignedModel                    MATCH  cascade

reconstruction mismatches: 0 / 9
```

Every field of `ChildTaskInput` is already durable, with no schema change:

| `ChildTaskInput` field | Source on the parent log |
|---|---|
| `taskId`, `objective`, `inputArtifactIds`, `acceptanceCriteria`, `limits` | `CHILD_MESSAGE` / `TASK_REQUEST` (`buildTaskRequest` copies them verbatim) |
| `role` | `MODEL_ROUTED.agentRole` — the true `AgentRole`, which the flowchart node role has already coarsened away |
| `profile` | recomputed from `role` via the registry (derived, not state) |
| `assignedModel` | `MODEL_ROUTED.model` |
| `cascade` | `cheapFirstTiers(MODEL_ROUTED.eligibleModels, catalog)` + `MODEL_ROUTED.highRisk` — the shipped planner, byte-identical output |
| `dependsOn` | the checkpointed flowchart edges |
| `contextPacket`, `predecessorNotes` | rebuilt at launch by design; not spec state |

**The one sharp edge a Round 7 implementer must not miss:** two producers write `MODEL_ROUTED`. The pre-run assignment path (`routing/assign.ts:106`, via `assignTasks`) passes `agentRole`; the supervisor's per-node routing (`flowchart-supervisor.ts:684`) does not. Both land on the log for the same `taskId`:

```
taskId=tsk_verify role=actor agentRole=tester    model=cheap highRisk=false eligible=[cheap,premium]
taskId=tsk_verify role=actor agentRole=<ABSENT>  model=cheap highRisk=false eligible=[cheap,premium]
```

A rebuild must **select on `agentRole !== undefined`**, not take the first or last. Taking the wrong one silently reintroduces the role coarsening this fix exists to remove.

### Why not the alternatives

- **Disclosure (R4-6 style)** — rejected. Disclosure is the honest answer when the information is genuinely gone. It is not gone; it is on the log, and 0/9 mismatches proves a faithful rebuild is available. Documenting a silently widened budget instead of restoring it would be choosing the weaker option with the stronger one in hand.
- **Schema change** — rejected as unnecessary, and it would need parent sign-off against the standing "no new persisted schema" posture. Nothing is missing.

### Design for Round 7 (files, seams, risks)

- **Seam.** Replace `childTasksFromDefinition(definition, registry)` at the single call site `flowchart-run.ts:1094` with a log-driven rebuild — `childTasksFromLog(events, definition, registry, catalog)` — keeping the definition as the *node set* (which nodes exist) and the log as the *spec source* (what each node was asked to do). Same return type, same call site, one function swapped.
- **Fallback, and it must be explicit.** A node with no `TASK_REQUEST` on the log has never run, so there is nothing to reconstruct. It must fall back to today's synthesised spec — but the fallback should carry the caller's `limits` from a sibling or the run limits rather than the hard-coded trio, and the choice should be recorded, not silent.
- **Catalog dependency.** Cascade regeneration needs the model catalog. `resumeFlowchartRun` has `deps.router`, whose `config.models` carries `id`/`version`/`estimatedCostUsd` — exactly the three fields `cheapFirstTiers` reads. No new dependency; confirm the resumed router is configured from the same catalog, or the tiers will differ.
- **Contract.** Thread `contract` into the resume context in the same diff (`:1118-1142`). Reconstructing child specs while still dropping the contract would leave `constraint-retention` wrong and make the two halves disagree.
- **Ownership.** `src/run/flowchart-run.ts` (sole — it is R6-1's this round, so this is a Round 7 claim), plus additive tests in the two files this slot pinned.
- **Risks.** (a) Picking the wrong `MODEL_ROUTED`, above. (b) A resumed run would begin honouring the caller's *tighter* limits, so a run that previously got 2 attempts may now get 1 — a behaviour change that needs disclosure even though it is the correct behaviour. (c) The rebuild reads the log twice (`readAll` already happens at `:1038`); reuse that read rather than adding one.

---

## 5. What landed (test-only, additive, both owned files)

`test/unit/run/flowchart-run-abort.test.ts` (+3 tests):

1. **`a resumed node is re-specified: the rebuilt child spec's exact shape`** — the three-leg crash/resume harness; pins the caller's spec on the pre-crash node and, field by field, the rebuilt shape on the resumed one (criteria `[]`, artifacts `[]`, limits exactly `{2, 60_000, 3_600_000}`). This is the "pin the current behaviour so the gap cannot silently change" deliverable.
2. **`the re-specification does not change the gate's verdict`** — the measurement, pinned: same gate kind and codes across the two specs, `check-coverage` `PASS` vs `NOT_APPLICABLE`. If a change ever makes the verdict diverge, this fails.
3. **`check-coverage cannot fail, which is what keeps the rebuilt spec off the verdict`** — **the tripwire.** Pins `completedChecks === requiredChecks` (or `[]`) through the shipped derivation and that `FAIL` is unreachable. The moment someone makes check-coverage a real check, the empty-criteria resume *becomes* a false-accept vector; this test fails first and the docstring says to fix `childTasksFromDefinition` in the same diff.

`test/integration/m2.5/resume.test.ts` (+2 tests):

4. **`a resumed node loses the caller's child spec and the run's contract`** — production-shaped pause/resume; pins the spec loss on the log **and** the contract drop (`constraint-retention` `PASS` on the started node, `NOT_APPLICABLE` on the resumed one).
5. **`the parent log already carries what a faithful child-spec rebuild needs`** — pins the Round 7 premise: `TASK_REQUEST` fields, exactly one `MODEL_ROUTED` carrying `agentRole` (and that the flowchart role alone would coarsen `tester`→`actor`), and a full reconstruction `deepEqual` to the spec the run started with. If a schema change ever drops one of these, reconstruction stops being possible without a schema and this fails.

No `src/**` edits. No file moved. Prototypes (`measure.ts`, `sweep.ts`, `margin.ts`, `reconstruct.ts`, `debug.ts`) stayed in `/tmp/r62/`, out of the tree.

**One correction to my own first draft, recorded because the harness matters:** my initial pin asserted node `b` carried the caller's criteria before the crash. It never did — leg 1 pauses *before* `b` starts, so both of `b`'s attempts come from a resume and both are rebuilt. The test now asserts that, with node `a` as the as-specified control. The measurement is unaffected; the A/B is still original-vs-rebuilt on identical behaviour.

---

## 6. Verification

- `npx tsc --noEmit` whole tree: **exit 0, clean** (one error in my first draft, a `token(runId)` arity slip in the new pause helper, fixed).
- `npx eslint test/integration/m2.5/resume.test.ts test/unit/run/flowchart-run-abort.test.ts`: **exit 0, clean**.
- Owned files **3×** (crash/resume timing): 26/26 pass, 0 fail, 0 skipped, all three passes.
- Neighbouring suites `test/unit/run` + `test/unit/tracking` + `test/integration/m2.5`: **243/243 pass**, 0 skipped. No new skip introduced by this slot.
- Full gate is the parent's job; not run here.

**Shared-tree note.** R6-1, R6-3 and R6-5 have landed in the working tree. My pins were measured and run against that state and pass. Checked explicitly for the coordination constraint: **R6-1's diff does not touch `childTasksFromDefinition`** (0 occurrences in their diff; the function moved 234→231 only because they deleted `hasEvent` above it). R6-1's change is in fact load-bearing for this slot's framing — now that BLOCKED wins over FAILED as the run's terminal, a gate false-accept would be *more* consequential than it was at the start of the round, which makes the 0/240 result worth more.

## 7. For the reviewer — the one-line version

The acceptance-criteria half of R6-2 is **not** a false-accept vector, and the reason is that the three-line gate never evaluates acceptance criteria against evidence at all (`completedChecks` is a copy of `requiredChecks`). The resume gap is real — widened budgets, lost cascade, coarsened role, dropped contract, a child prompt missing its criteria — and it is fully fixable from the log with no schema change (0/9 reconstruction mismatches). If Round 7 wants a P0 in this area, the candidate is not the resume gap; it is that **`check-coverage` is a tautology on every path**, which means no acceptance criterion anywhere in the tree can currently fail a child.

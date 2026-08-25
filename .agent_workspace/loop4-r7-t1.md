# R7-1 — A resumed run's children are the children the run started

**Landed.** `childTasksFromLog` replaces `childTasksFromDefinition` at the single resume call site: the checkpointed definition stays the node set, the parent log becomes the spec source. A node whose `TASK_REQUEST` is on the log now resumes as the task the caller wrote — objective, artifacts, acceptance criteria, budget, the true `AgentRole`, the assigned model and the cascade — with **no schema change**. A node the log has never seen run gets an explicit, named substitution instead of the silent hard-coded trio. The run `contract` is threaded into the resume context in the same diff, as far as it can be: the seam exists and is honoured, and the reason production still supplies none is §5, disclosure 3.

Slot: R7-1 (P1). Base `agent/opt-continuous`, start HEAD `6bffc2d`; verified again at `5a3fd60` (R7-2/5/8 landed under me mid-slot). Owned files only: `src/run/flowchart-run.ts`, `test/integration/m2.5/resume.test.ts`, `test/unit/run/flowchart-run-abort.test.ts`. `gate-apply.ts` untouched; `check-coverage` untouched (R7-2's, option (b) signed off).

---

## 1. Census first (R6-2 §4's premises, re-checked at HEAD before editing)

| R6-2 §4 claim | At HEAD | Note |
|---|---|---|
| `childTasksFromDefinition` at `:231`, sole caller `:1094` in `resumeLockedFlowchartRun` | yes, both exact | |
| every `ChildTaskInput` field is durable on the log | **yes, with one correction** — see below | 8 of 9, not 9 of 9 |
| two `MODEL_ROUTED` producers per task; select on `agentRole !== undefined` | yes | `routing/assign.ts` passes it, `flowchart-supervisor.ts:684` does not |
| cascade needs a catalog; `deps.router.config.models` carries `id`/`version`/`estimatedCostUsd` | yes | `ModelRouter.config.models` is `readonly CatalogModel[]`; structurally what `cheapFirstTiers` reads |
| `readAll` already happens before the call site | yes, `:1055` | reused, no second read |
| "thread `contract` into the resume context" | **premise does not hold as written** | the contract is on no durable record — §5, disclosure 3 |

**The correction that changed the design.** R6-2's reconstruction table lists nine fields as recoverable. Eight are. The ninth, the run `contract`, is not a `ChildTaskInput` field at all but the loop-context value beside it, and it is **not durable anywhere a run id can reach**: `startFlowchartRun` takes it as input, `bindEpisodeToRun` copies only `contract.acceptanceCriteria` (plus `schemaVersion`) onto the bound episode, and `ProjectEpisode` has no constraints field. The run log, the checkpoint (`RunCheckpoint`/`FlowchartCheckpointState`) and the episode snapshot all lack the `constraints` array that `observationFromChild` turns into `constraint-retention`. I checked each of the three by reading the type and its writer, not by grep. Consequence in §5.

Consumer census (who executes or pins a flowchart resume): `test/unit/run/*` (abort, gate-outcome, learned-routing, run-lifecycle-lock), `test/integration/m2.5/*` (resume, children-flowchart, flowchart-run), `test/integration/m3/pause-inject`, `test/integration/cli/*` (cli, pause-inject, blocked-next, command-error-doctor), `test/integration/m2/*`, `test/integration/pi-adapter/loopback-cli-resume`, `test/unit/cli/resume-executor-config`. All run; results in §6. No consumer outside my three owned files needed a change, and none is prescribed. `docs/**` mentions neither the old function nor resume re-specification (grepped) — R7-6 has nothing to *correct*, but §7 hands them the wording for what is now true.

---

## 2. What the rebuild does

`childTasksFromLog(events, definition, registry, catalog)` — R6-2's designed signature, unchanged, same return type, same call site.

| Field | Source | Behaviour when the log has no request for the node |
|---|---|---|
| `taskId`, membership | the checkpointed node | unchanged — the definition still decides *which* nodes are children |
| `objective` | `TASK_REQUEST.objective` | the node's objective |
| `inputArtifactIds`, `acceptanceCriteria` | `TASK_REQUEST` | **empty, deliberately** — nothing to restore, nothing invented |
| `limits` | `TASK_REQUEST.limits` | substituted, §3 |
| `role` | `MODEL_ROUTED.agentRole` (the event that has one) | the definition's coarse mapping, i.e. today's behaviour |
| `profile` | `registry.resolve(role)` — derived, not state | same |
| `assignedModel`, `cascade` | the same selected `MODEL_ROUTED` (`model`, `highRisk`, `cheapFirstTiers(eligibleModels, catalog)`) | omitted, as before |
| `dependsOn` | the checkpointed edges | same (edges are definition-side) |

Three properties worth naming:

1. **The `MODEL_ROUTED` trap is handled at the only place it can be.** `assignedRoutes` filters on `agentRole !== undefined` before inserting, so neither "first" nor "last" can win by accident. Where no assignment exists (a caller that passed `childTasks` but no `assignments`), the rebuild takes **neither** model nor cascade rather than adopting the supervisor's own per-node route: that route is the run's decision, which the resumed supervisor re-derives for itself, not a record of what the caller specified. Adopting it would be inventing a spec, which is the defect, not the fix.
2. **The rebuild is a fixed point.** It reads the *last* `TASK_REQUEST` per task, so a node an earlier resume already substituted for rebuilds to what that resume actually sent. Repeated resumes converge instead of drifting; pinned.
3. **The catalog is the resuming process's**, because the log records eligible model *ids* but not their versions or costs. A resume configured against a different catalog rebuilds different tiers — the same exposure a fresh start has. Stated on the type.

---

## 3. The fallback, made explicit (R6-2: "recorded, not silent")

A node with no logged request has no spec to reconstruct. The substitution chain, in order, all of it from the log: **the earliest logged sibling's budget** → **the run's own declared limits** (`RunLimits.maxAttemptsPerTask` / `maxWallTimeMs`) → the same fields off `defaultRunLimits()` if a log somehow has no `RUN_CREATED`. Each step is a budget this run's caller authorised for *something*; the old `{2, 60_000, 3_600_000}` was authorised by nobody.

Two honest edges:

- `ChildRunLimits.timeoutMs` has **no source at all** — `RunLimits` carries no per-attempt field. It is the one invented number, named `FALLBACK_CHILD_TIMEOUT_MS`, and it is set to the value every rebuilt child already got (60 s), so it is not a change.
- "Recorded" is recorded **in source and in tests**, not on a persisted record. A durable marker distinguishing "reconstructed" from "substituted" would be new schema, which needs sign-off I do not have. What *is* durable is the consequence: the substituted child writes its own `TASK_REQUEST`, which is exactly what the next resume reconstructs (property 2 above), so the substitution is inspectable on the log even though it is not labelled there.

---

## 4. What landed in the two owned test files

`test/unit/run/flowchart-run-abort.test.ts` (5 tests in the section, was 3):

1. **`a node the log never saw run is re-specified against a budget the caller authorised`** — the R6-2 rebuilt-spec-shape pin, **consciously rewritten, not deleted**. It keeps the same three-leg harness and the same field-by-field discipline; what changed is the expected budget (node `a`'s logged `{1, 30_000, 300_000}`, asserted both as a literal and as `deepEqual(original.limits)`) plus an explicit `notDeepEqual` against the old `SYNTHESISED_LIMITS` constant, so the tightening is asserted rather than merely no longer contradicted. Criteria and artifacts stay `[]` and now say *why* (nothing to restore). The fixed-point property is pinned here.
2. **`a node re-executed on resume runs under the spec the log recorded for it`** *(new)* — the reconstruction case. A single tester child with real criteria, artifacts and assignments; the process dies with the child's result on the log and no acceptance behind it, and the exhausted id generator also breaks the best-effort crash terminal (`crash-terminal.ts` swallows it), which is what a SIGKILL gives for free — so the checkpoint keeps the node RUNNING and the resume re-executes it. The rebuilt `TASK_REQUEST` equals the caller's field for field. The **role** restoration is pinned through the gate rather than by inspection: `check-coverage` is `PASS` on the resumed attempt, which only happens for a `tester` with criteria — the node role alone would have coarsened it to `implementer` and produced `NOT_APPLICABLE`.
3. **`a resumed child keeps the cascade the log recorded, so a failure still escalates`** *(new)* — the cascade is the one restored field no `TASK_REQUEST` can show, so it is pinned by what it does: the resumed child's deterministic check fails and the child escalates `cheap → premium`, with the executor's own `modelIds` confirming the second attempt really ran on the next tier. Under the old rebuild there was no plan, so the failure was simply final.
4. **`the re-specification does not change the gate's verdict`** — unchanged and still passing.
5. **`check-coverage cannot fail…`** — the tripwire, **not touched in substance**. Its docstring's last sentence named `childTasksFromDefinition`, which no longer exists; rewritten to say that R7-1 closed the larger half (a node whose request is on the log resumes with the caller's criteria) and that whoever makes check-coverage real still owns deciding what a *never-ran* node is gated against, with `childTasksFromLog` named as where that decision lands. The order it gives is intact.

`test/integration/m2.5/resume.test.ts` (7 tests, was 5): the spec-and-contract-loss pin is split in two, both driven by one shared production-shaped harness.

6. **`a node the resume has to substitute for gets a budget the caller authorised`** — the resumed node's budget is now the sibling's `{3, 45_000, 900_000}`, criteria and artifacts still empty, and `constraint-retention` is **`PASS` on both nodes** when the resume is handed the contract.
7. **`a resume that is handed no contract assesses its children against none`** *(new)* — the disclosure as a pin: the same run resumed without a contract still reports `NOT_APPLICABLE` on the resumed leg. This is the honest record of what R7-1 did *not* close, and it is what a future round flips.
8. `the parent log already carries what a faithful child-spec rebuild needs` — unchanged; its docstring now says the shipped rebuild reads exactly these fields, so the test is a schema tripwire for the rebuild rather than a premise for a future one.

---

## 5. Disclosures

1. **Resumed runs now honour tighter caller limits — the ordered behaviour change.** A resumed child that used to get `{2 attempts, 60 s, 60 min}` now gets what its caller wrote. In the pinned integration case that is `{3, 45 s, 15 min}`; in the pinned unit case `{1, 30 s, 5 min}` — a run that previously got two attempts now gets one, and a wall budget one twelfth as long. This is the correct behaviour and it is a behaviour change: a resumed child that used to squeak through on attempt 2 will now fail on attempt 1.
2. **One field moves the other way, in one case.** For a node with *no* logged sibling — the first resume of a run started on the thin executor path, which synthesises children for every node (pre-existing, R5-5) — `maxAttempts` comes from `RunLimits.maxAttemptsPerTask`, which is **3**, where the old hard-code was 2. `timeoutMs` and `maxWallTimeMs` are unchanged in that case. I chose the run's own declared per-task budget over keeping the magic 2 because R6-2 §4 named the run limits as the fallback source and because 3 is a number the run actually declares; the extra attempt is bounded by the run's own limit. Naming it because "the change is uniformly tightening" would have been the easier and less true sentence.
3. **The contract is threaded but not recoverable — half of R6-2's contract item is not closed.** `FlowchartContinuation.contract` is new, optional, and honoured (`ctx.contract`), so a resume that is *given* the contract now grounds and gates its children against it exactly as a start does. No production caller can give it one: as §1 establishes, the constraints live on no record reachable from a run id, so `run --resume` (which has only a run id) still assesses against none. I did not invent one — building a contract out of the episode's acceptance criteria with `constraints: []` would present an empty constraint set as the run's, which is the class of lie this slot exists to remove. Making it durable is a schema decision (cheapest shape: `FlowchartCheckpointState.contract`, in `replay.ts`, which is unowned this round) and needs parent sign-off. Round 8.
4. **`dependsOn` is restored from the checkpointed edges**, per R6-2's table. On a resume that runs a single node this is inert (`finishedChildren` is empty at resume time); where a resume runs two connected nodes in one process, the later one now gets predecessor notes and predecessor artifacts, as a fresh start does. Beyond the letter of the brief's "Change" paragraph, inside R6-2 §4's reconstruction table.
5. **`FlowchartContinuation` gained an optional field.** Additive; `src/cli/main.ts` (R7-5's file this round) builds continuations and is unaffected. No unowned file was edited.
6. **The rebuild still runs for every child-capable node whenever an executor is present**, including runs started on the thin path that never had children. That is pre-existing and out of this slot's scope; I only changed what those invented children are asked to do, not whether they exist.

---

## 6. Verification

- **Whole-tree `npx tsc --noEmit`: exit 0, clean.** Run last at `5a3fd60` + my working tree.
- **Scoped `npx eslint` on the three owned files: exit 0, clean.**
- **Owned, timing-sensitive (crash/resume windows), 3×:** `flowchart-run-abort.test.ts` + `m2.5/resume.test.ts` → **29/29 pass, 0 fail, 0 skipped, all three passes**, re-run after HEAD moved.
- **Consumer census run** (`test/unit/run`, `test/unit/cli`, `test/unit/track`, `test/unit/tracking`, `test/unit/routing`, `test/integration/m2`, `m2.5`, `m3`, `cli`, `pi-adapter`, `track`): **767 tests, 766 pass, 0 fail, 1 skipped**. The single skip is the `PI_SMOKE=1` real-provider gate — the baseline's only skip. **This slot introduced no skip.**
- Also run once green: `test/integration/cluster`, `m4`, `m5`, `m6`, `test/unit/supervisor`, `test/unit/graph`.
- **`test/unit/routing/live-isolation.test.ts`: 8/8 pass.** Required because I added imports (`routing/live-cascade.js`, `protocol/v1.js`) to a file inside the live closure; both modules were already in it via `child-coordinator.ts`, and the pin agrees.
- Baseline before editing, same VM: the same core suites at **217/217**, so the two failures the first post-edit run produced were exactly the two R6-2 pins this slot owns and rewrote — no third file moved.
- Full gate not run; that is the parent's.

**Shared-tree note.** Three siblings landed under me during the slot (`fffb675` R7-8, `b32584b` R7-2, `59984ca` R7-5). One transient: a single failure in `test/integration/cli/blocked-next.test.ts` ("the gate's queued analysis and its owed evidence reach the operator verbatim") during a mid-slot run, which passed 6/6 in isolation seconds later and has passed in every run since — attributable to R7-5's in-flight edits to `src/cli/main.ts`, their sole file, not to this diff (my diff touches no CLI path, and the failing assertion is about `main.ts` output wording). Every number in this section was re-measured **after** those three commits.

---

## 7. Hand-offs

- **R7-6 (docs).** Nothing in `docs/**` describes the old behaviour, so there is nothing to correct — but there is now something true to state: *a resumed flowchart node runs under the spec the parent log recorded for it (objective, input artifacts, acceptance criteria, per-child budget, agent role, assigned model, cascade), reconstructed from `TASK_REQUEST` and the assignment's `MODEL_ROUTED`; a node the log never saw run keeps empty criteria and artifacts and is given the earliest logged sibling's budget, or the run's own declared per-task limits when there is no sibling. A resumed run therefore honours the caller's limits, which may be tighter than the ones it used to be given.* Please also record disclosure 3: resume honours a contract it is handed and no production caller can hand it one.
- **R7-2 / Round 8 (check-coverage).** The tripwire in my file is intact and its order is updated: the reconstruction has landed, so the remaining exposure is narrower — only a node the log never saw run is gated on empty criteria. `childTasksFromLog` is where that last decision lands.
- **Round 8 (contract durability).** The one open half. Cheapest shape is a `contract?` on `FlowchartCheckpointState` (`src/run/replay.ts` + `validateCheckpoint`), written at start and read at resume; it is a persisted-schema change and needs sign-off. `test/integration/m2.5/resume.test.ts::a resume that is handed no contract assesses its children against none` is the pin that flips.
- **Nobody needs to update a pin of mine.** The two R6-2 pins this slot owned were rewritten here, in the same diff, with the disclosure above.

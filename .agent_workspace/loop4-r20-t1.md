[Model: claude-opus-5-thinking]

# Loop 4 · Round 20 · R20-1 — a declared per-child `maxCostUsd` survives pause/resume

Branch `cursor/opt-r18-postmerge-42b1` (no checkout, no commit, no push — parent commits).
Base HEAD `adcf727`. Direction **(b) restore**, per ROUND20-BRIEF §4 sign-off: the ceiling is
recorded durably at accept time and restored onto substituted specs; the sibling arm no longer
copies `maxCostUsd`; the disappearance is not accepted. Sibling R20-2's working-tree edits
(`src/execution/contract.ts`, `src/pi-adapter/pi-executor.ts`, `src/run/coordinator.ts`,
`scripts/kernel-reuse-probe.mjs`, new `test/integration/pi-adapter/steer-target.test.ts`) were
present alongside mine and are disjoint; I touched none of them. **The parent landed R20-2 as
`57ade59` while this slot was open**; my four files rebased on it without conflict and the whole
verification block below (typecheck, scoped lint, owned suite 3×, consumer suites) was re-run on
top of `57ade59` with identical numbers. The mutant transcript was taken before that landing, on
a copy that carried R20-2's uncommitted edits; nothing in it touches their seam.

## Census (before editing)

Every handed path exists at HEAD and every line reference in the brief resolved:

- `src/run/flowchart-run.ts:428-449` `fallbackChildLimits` — sibling arm `return sibling.value.limits;`
  (the whole object, `maxCostUsd` included since R18-2); no-sibling arms build three fields.
- `src/run/flowchart-run.ts:483-524` `childTasksFromLog`, `:510` `request?.limits ?? substituted` —
  a started child keeps its own request's limits verbatim, so only the substitution case is wrong.
- `taskCriteria` writer sites, all confirmed and all mirrored by this landing: seed at
  `:1310`/ctx `:1359` (start), advance+write in `persistCheckpoint` `:817`/`:831`, read at `:1485`,
  restore at `:1509`, ctx at `:1558`, pause/inject restore at `:1686`, unblock destructure `:2117`
  and reopen write `:2180`.
- `src/run/replay.ts` — `FlowchartCheckpointState` `:63-124`, `validateTaskCriteria` `:461`, wired at
  `:436`. The laundering coda at `:95-101` is **untouched** (verified in the diff).
- `test/integration/m2.5/resume.test.ts` (1497 lines, 22 tests), existing sibling-budget pin at
  `:738-743`. `docs/specs/m0-m2-architecture.md:368-377`.
- Consumer census for the new checkpoint field: `FlowchartCheckpointState` is read in
  `src/run/flowchart-run.ts`, `src/run/replay.ts` and `src/tracking/prescore.ts` (type-only, no
  per-task record), and `checkpoint.flowchart?.…` in `src/cli/main.ts` (snapshot/pendingApproval and
  `flowchartContinuation`'s `contract` only) and `src/cli/commits.ts` (`definition.nodes`). No
  consumer outside my ownership needed a change; `main.ts`, `child-coordinator.ts` and
  `protocol/v1.ts` are unedited. No adaptation-plane import edges touched.

## Files changed (4)

| File | Change |
|---|---|
| `src/run/replay.ts` | New optional `FlowchartCheckpointState.taskCostCeilings?: TaskCostCeiling[]` + exported `TaskCostCeiling {taskId, maxCostUsd}`; new fail-closed `validateTaskCostCeilings`, wired beside `validateTaskCriteria`. The validator tail now spreads the two optional records instead of enumerating 4 return shapes (absent stays an absent *key*). `:95-101` untouched. |
| `src/run/flowchart-run.ts` | `fallbackChildLimits` sibling arm returns the three enforced fields only; accept-time recorder `plannedTaskCostCeilings`; monotonic merge `advanceTaskCostCeilings` (+ `declaredCeiling`, `byCeilingTaskId`); restore `withRecordedCostCeilings` chained onto `withRecordedCriteria` at the single rebuild call site; `taskCostCeilings` on `FlowchartLoopContext` and at every `taskCriteria` writer/reader site (start seed, `persistCheckpoint`, resume read/ctx, pause-inject restore, unblock destructure + reopen write). |
| `test/integration/m2.5/resume.test.ts` | 5 new tests + per-seam source tripwires on the existing carriage test; `PassingExecutor` now records `AgentExecutionRequest.maxCostUsd` per task. |
| `docs/specs/m0-m2-architecture.md` | Lines 368-377 only: what the substituted budget now does and does not carry. |

### Design decisions inside the grant

- **Ceiling only, optional, absence = unknown, first-write-wins, no `FlowchartContinuation`
  counterpart** — as signed off. A continuation field would be a way to raise a child's cap by
  resuming it; `assert.doesNotMatch(resumeRestorer, /continuation\.taskCostCeilings/)` pins that.
- **The log-derived arm mirrors `advanceTaskCriteria` and is laundering-safe.** A logged
  `TASK_REQUEST` with no ceiling adds nothing (on the log, "caller declared none" and "the rebuild
  substituted" are indistinguishable — and with the sibling arm stripped, a substituted request can
  no longer carry an invented one at all). Its real domain is the same as the criteria arm's:
  recovering a checkpoint that predates the field for tasks the log *has* seen dispatched.
- **`declaredCeiling` guards the recorder** with the protocol's own positive-finite rule.
  `ChildRunLimits` is an in-process interface, so an embedder can pass `0`; without the guard that
  value would either fail the run's own checkpoint write or land on a durable record the
  parse boundary would have refused.
- **Two records, two merges.** The ceiling advance sits beside `advanceTaskCriteria` in
  `persistCheckpoint` rather than inside it, so the frozen criteria writer is byte-identical.

## Tests owed → delivered (all in `test/integration/m2.5/resume.test.ts`)

The audit's three proof shapes, plus the checkpoint-validation pins and the side-command seam:

1. `a straight-through run carries each child's own declared cost ceiling` — **control.** Same
   two-child arc as the two pause tests with the pause removed, so the pause is their only
   difference from it: `tsk_first` $0.25 and `tsk_second` $0.05 each land on all three records
   (`TASK_REQUEST.limits`, child `RUN_CREATED.limits`, `AgentExecutionRequest.maxCostUsd`). I did
   not reuse R18-2's CLI pin as the control — it covers a single child at the CLI boundary, not the
   sibling/second-child arc these tests need — but that pin
   (`test/integration/m1/cli-children.test.ts`, "run --children carries a declared maxCostUsd to the
   child run and its TASK_REQUEST") stays green and is cited in the new test's docstring.
2. `a resume never hands a child that declared no ceiling its sibling's` — **no-invention.**
   Sibling declares $0.25, `tsk_second` declares none, pause before its dispatch, resume: all three
   records carry no ceiling, the substituted budget is still the sibling's three enforced fields,
   and the durable record still names the sibling only (absent, not zero) after the resume's own
   writes.
3. `a resume re-dispatches a never-started child under the ceiling its caller declared` —
   **cap-restored.** Sibling $0.25, `tsk_second` $0.05, pause, resume: `0.05` on all three records —
   not absent, not the sibling's.
4. `an operator pause between the legs does not strip the durable cost ceiling` — the
   `restoreFlowchartSession` seam, through the shipped `pause` and `resume --executor fake`
   commands. A restorer that dropped the field erases it silently and the *next* resume uncaps the
   child rather than failing.
5. `the durable cost-ceiling record is validated fail-closed and absence stays valid` — present and
   valid (the run's own bytes round-trip), absence valid **and still an absent key**, and nine
   malformed spellings refused by location (empty array, non-array, bad task id, missing value,
   `0`, `-1`, `"0.05"`, out-of-order pair, repeated task).

Per-seam source tripwires added to the existing
`the flowchart checkpoint, its validator, its writer and both restorers carry the run contract`:
field declaration, `validateTaskCostCeilings`, the checkpoint writer, both restorers, the unblock
reopen, and the no-continuation clause.

The existing sibling-budget pin (`:738-743`, now `:769-774`) stays green untouched, as does
`a resume re-dispatches recorded criteria and leaves an unrecorded node unknown` and the whole
`taskCriteria` family. Fake-children executor ignoring enforcement stays pinned (nothing in this
landing asks an executor to enforce anything).

## Verification

- `npx tsc --noEmit` (whole tree, includes the sibling's in-flight edits): clean.
- `npx eslint src/run/flowchart-run.ts src/run/replay.ts test/integration/m2.5/resume.test.ts`: clean.
- Owned suite **3×**: `27 tests / 27 pass / 0 fail / 0 skipped` each (was 22 before this landing).
- Consumer suites, one run: `test/unit/run test/unit/tracking test/unit/supervisor
  test/integration/run test/integration/m1 test/integration/m2 test/integration/m2.5` —
  **503 tests / 503 pass / 0 fail / 0 skipped / 18 suites.**
- No full gate (parent's job). No commits, pushes or branch changes; no `PROGRESS.md` edit.

### Mutant transcript (out-of-tree copy: tracked working-tree files + symlinked `node_modules`, deleted after)

Baseline of the copy before each mutant: 27/27.

| # | Mutation | Result |
|---|---|---|
| 1 | **Restore the invention** — sibling arm back to `return sibling.value.limits;` | **single red**: `not ok 12 - a resume never hands a child that declared no ceiling its sibling's`. Actual vs expected: `+ childRunCreated: 0.25, + executionRequest: 0.25, + request.maxCostUsd: 0.25` — the audit's proof reproduced exactly (25 pass / 1 fail). |
| 2 | **Drop the restore** — `rebuilt` = `withRecordedCriteria(...)` only | **single red**: `not ok 13 - a resume re-dispatches a never-started child under the ceiling its caller declared`. `- maxCostUsd: 0.05` gone from the request, `childRunCreated`/`executionRequest` `undefined` — the audit's disappearance reproduced (25/1). |
| 3 | **Drop the accept-time recorder** — start ctx never seeds `taskCostCeilings` | **double red, both about the recorder**: `not ok 13` (the pause-time record no longer names `tsk_second`) and `not ok 15` (the paused checkpoint carries no record at all). 24 pass / 2 fail. |
| 4 | **Validator accepts any array** — `if (Array.isArray(value)) return value as TaskCostCeiling[];` | **single red**: `not ok 15 … Missing expected exception: an empty array is a second spelling of unknown` (25/1). |
| 5 | **Pause/inject restorer drops the field** | **two reds, tripwire + behaviour**: `not ok 4` (per-seam source pin) and `not ok 14` — the record loses `tsk_second: 0.05` and keeps `tsk_first: 0.25`, which is the erasure in its exact shape: the dispatched sibling's ceiling is recoverable from its logged request, the never-dispatched child's is not (25/2). |

## Residuals and disclosures

1. **Two durable surfaces outside my grant now describe the substitution incompletely.**
   `docs/data-dictionary.md:161` ("empty artifacts and uses the earliest logged sibling budget or the
   run's declared per-task limits") and `docs/status-matrix.md:38` (same clause inside the
   "Event log + checkpoint + resume" row) were written when the sibling budget was the whole limits
   object. They are the same staleness the brief's fold-in fixed in
   `m0-m2-architecture.md:368-377`, and the auditor's H5 census did not name them. The brief scoped
   my doc grant to those spec lines only, so I made no edit. Proposed replacement clause for both,
   if the parent wants it folded: *"…receives the earliest logged sibling's `maxAttempts`,
   `timeoutMs` and `maxWallTimeMs` (never its `maxCostUsd`) or the run's declared per-task limits;
   a declared ceiling comes back only from the durable `taskCostCeilings` record."* Neither file
   claims anything the new behaviour contradicts about `taskCriteria`.
2. **Verification hazard worth carrying forward: the `tsx` transpile cache served a stale copy of an
   edited test file.** My first post-edit run of the owned suite reported the pre-edit
   `22 tests / 22 pass` with none of the new test names present, from `/tmp/tsx-1000`. Every run
   reported above was taken after `rm -rf /tmp/tsx-*`. A slot that trusts a green count without
   checking that its own test *names* appear can report a pass for code that never ran.
3. **Not covered behaviourally: the unblock reopen's carriage of the new field.** It has the same
   per-seam source tripwire `taskCriteria` has at that seam and no more; reaching it needs a blocked
   flowchart run with a capped, never-dispatched child. Recorded, not claimed.
4. **A legacy checkpoint (field absent) still loses a never-dispatched child's ceiling** — the same
   visible, disclosed cost the `taskCriteria` legacy arm has (`m0-m2-architecture.md:393-398`). The
   log-derived arm recovers ceilings only for tasks it has seen dispatched, because a substituted
   request cannot prove one. Recorded, not hidden; no test asserts recovery that cannot happen.
5. **No perf claim.** Nothing in this landing was measured for speed; `persistCheckpoint` now scans
   the log twice per write (once per record) instead of once, next to a `readAll` and a `replayRun`.
6. Scratch: the out-of-tree copy was deleted and verified gone; the `/tmp` suite roots my runs left
   (the known hygiene phenomenon, posture frozen in ROUND19-BRIEF §5) were removed at report time,
   sparing anything newer than 5 minutes so a concurrently running sibling's roots are untouched.
   The working tree carries only the four files above (plus the sibling's disjoint edits).

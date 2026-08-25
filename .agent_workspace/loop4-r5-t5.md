# Loop 4 · Round 5 · R5-5 — Should resume adopt recorded-but-unaccepted child results?

Slot: R5-5 (P2/P3, disaster-recovery investigation). Investigation-first; the deliverable is a
decided posture plus pins.

**Decision: NO — do not buy resume-time adoption in Round 6.** It is *sound* and it is
*constructible today with no schema change* (both demonstrated below, end to end, through the real
three-line gate). It is not worth buying, because the window it closes is 0.0008 %–0.03 % of a run's
wall time, the cost when it hits is one visibly-retried node, and the failure mode of getting the
reconstruction wrong is a node marked COMPLETED on a result its child never committed — trading a
money cost for an honesty cost. The accepted-cost posture is documented in §5 and pinned in §6, along
with the two conditions that would flip the decision.

Owned and touched: `test/integration/m2.5/resume.test.ts` (+1 test), `test/unit/run/
flowchart-run-abort.test.ts` (+3 additive tests). **No `src/**` edits.** `flowchart-run.ts` was read
only — R5-1 is its sole owner this round. The prototype lives in §4 of this report, not in the tree.

---

## 1. Census (before trusting the brief)

Started at `6975aab`; the shared tree moved to `c2c3806` (R5-9) during the slot and every check in §7
was re-run against it. R5-1's and R5-2's work was already uncommitted in the tree throughout.

| Claim to check | Verdict |
|---|---|
| R4-4's "budgets 0–2: the result is on the log, unaccepted" | Reproduced, and **sharpened**: the child's `TASK_RESULT` reaches the *parent* log, not just the child's, as a `CHILD_MESSAGE` (`child-coordinator.ts:794`) |
| Adoption would live in `resumeRestoredRun`/`executeRemainingRunningNodes` | Correct. `resumeRestoredRun` (`flowchart-run.ts:1114`) runs `applyRunningResults` then `executeRemainingRunningNodes`; the gate lives one level down, in `executeClusteredNode` (`:379`) |
| "The real three-line gate" is `applyChildThreeLine` | Correct, and it is the **clustered** path only. The thin-executor branch of `executeRemainingRunningNodes` (`:403-426`) calls `supervisor.applyChildResult` with no gate at all and puts no `TASK_RESULT` on any log — it is outside this question entirely |
| Resume rebuilds child specs | Yes: `childTasksFromDefinition` (`:1060`) rebuilds from the checkpointed definition whenever an executor is present, so a run started on the thin path resumes on the clustered one. It carries **no** `assignedModel` and **no** `cascade` |
| A `TASK_RESULT` is the child's final answer | **No.** `maybeCascadeRetry` (`child-coordinator.ts:522`) can turn one into a `TASK_RETRY` and another attempt, and production sets a cascade plan on every routed child (`cli/main.ts:430`, `track/loop.ts:121`). Reproduced in §4.4 and pinned |

## 2. How often does the window matter?

The unrecoverable window runs from *the child's `TASK_RESULT` is appended to the parent log* to *the
supervisor accepts it*. Inside it: the child's own terminal append, a full `eventStore.readAll()` of
the parent log, the three-line gate, its appends, and `applyChildResult`. R4-4 closed everything
after the accept with `preserveResumableState`; this window is what is left.

### 2.1 What the log carries at each crash point

Crash swept across a resumed two-node run (node `a` durable, node `b` executing), the crash injected
`budget` id generations after `b`'s child reports. This is R4-4's sweep plus the two columns that
decide whether adoption is even possible.

| budget | `TASK_RESULT` on **parent** log | child closed its own log | supervisor accepted | checkpoint `b` | resume re-runs `b` | child runs for `b` |
|---|---|---|---|---|---|---|
| 0 | yes | no | no | RUNNING | yes | 2 |
| 1 | yes | no | no | RUNNING | yes | 2 |
| **2** | **yes** | **yes** | **no** | **RUNNING** | **yes** | **2** |
| 3 | yes | yes | yes | COMPLETED | no | 1 |
| 4 | yes | yes | yes | COMPLETED | no | 1 |

Budget 2 is the whole question: a child run that finished, committed, and reported — re-executed and
paid for twice. Budgets 0–1 are a child run still in flight.

### 2.2 How wide the window is, in wall time

Per-node medians, warmed process, 3 iterations per shape, this VM (Node v22.14.0).

| shape | parent log | median window | total window per run |
|---|---|---|---|
| 4 nodes, terse | 19.9 KiB | 1.22 ms | 3.7 ms |
| 12 nodes, chatty | 58.8 KiB | 1.29 ms | 13.6 ms |
| 24 nodes | 133.8 KiB | 1.73 ms | 35.0 ms |
| 40 nodes | 252.5 KiB | 2.23 ms | 65.4 ms |

The window grows with the parent log because `readAll()` is inside it — a longer run is a slightly
worse run to crash in.

### 2.3 What fraction of a run that is

`P(uniform crash lands in the window) = Σwindow / (Σwindow + nodes × per-node latency)`.

| shape | 5 s/node | 30 s/node | 120 s/node |
|---|---|---|---|
| 4 nodes | 0.020 % | 0.0034 % | 0.0008 % |
| 12 nodes | 0.023 % | 0.0038 % | 0.0009 % |
| 24 nodes | 0.025 % | 0.0042 % | 0.0010 % |
| 40 nodes | 0.029 % | 0.0049 % | 0.0012 % |

**Roughly 1 crash in 3,400 at the pessimistic end, 1 in 125,000 at the realistic one.**

### 2.4 How much of the window adoption would actually close

`handle.done` resolves only *after* the child log's terminal append, and the parent `readAll()` and
the gate run after that. So the non-adoptable head — the part where the child run is still in flight
and nothing durable proves its result is final — is just the two child-log appends, and everything
expensive is on the adoptable side.

| shape | parent log | median window | non-adoptable head | adoptable share |
|---|---|---|---|---|
| 8 nodes | 36.8 KiB | 1.32 ms | 0.118 ms | 91.0 % |
| 16 nodes | 77.0 KiB | 1.36 ms | 0.117 ms | 91.2 % |
| 24 nodes | 133.0 KiB | 1.55 ms | 0.120 ms | 92.3 % |
| 40 nodes | 251.1 KiB | 1.91 ms | 0.113 ms | 94.0 % |

The head is flat at ~0.12 ms regardless of log size, so the adoptable share rises with run length.
Adoption is not a half-measure: it would close ~92 % of an already-tiny window.

## 3. Is it sound?

Yes, with one non-negotiable precondition. Three findings.

### 3.1 The parent log alone is sufficient — no schema change

Everything a reconstruction needs is already durable on the parent log:

- `CHILD_RUN_CREATED` → which child run served the node (`payload.childRun.id`).
- `CHILD_MESSAGE` with `message.type === "TASK_REQUEST"` → one per attempt, so `attempts` is countable.
- `CHILD_MESSAGE` with `message.type === "TASK_RESULT"` → the child's terminal result, carrying
  `outcome`, `summary`, `evidenceIds`, `artifactIds`, `verification` — i.e. every field
  `observationFromChild` reads.
- The child's own log → its terminal (`RUN_COMPLETED` / `RUN_FAILED` / `RUN_CANCEL_REQUESTED`).

R4-6 refused executor-config persistence because it would need an event-schema change. Adoption does
not: the record already exists. That removes the usual reason to defer, which is why the decision
below rests on value rather than on cost.

### 3.2 The precondition is the child log's terminal, not the `TASK_RESULT`

A `TASK_RESULT` on the parent log is not the child's committed answer. `maybeCascadeRetry` can
supersede one with another attempt, and production sets a cascade plan on every routed child. Measured
directly (`startFlowchartRun` with `assignedModel: "cheap"` and a two-tier plan, first attempt
`FAILED`):

```
CHILD_RUN_CREATED, CHILD_MESSAGE(TASK_REQUEST), CHILD_MESSAGE(TASK_RESULT),
TASK_RETRY, CHILD_MESSAGE(TASK_REQUEST), CHILD_MESSAGE(TASK_RESULT),
TRACKING_ASSESSMENT, LEDGER_UPDATED, RUN_COMPLETED
```

One child run, two `TASK_RESULT`s, only the second one real. The child log's terminal is the only
signal that `runTask` reached its end — and, usefully, the only one that does not require the resume
to know the original spec (which it does not: `childTasksFromDefinition` rebuilds specs without
`cascade` or `assignedModel`).

### 3.3 Replaying through the real gate reproduces the uncrashed run exactly

See §4. Budget 2 adopts and lands on the control's shape; budgets 0–1 refuse and fall back to today's
visible retry; budgets 3+ are already accepted and the adopter correctly declines.

## 4. The prototype (report only — nothing in the tree)

A standalone module, run against the real tree: it reconstructs the outcome from the parent log,
restores the supervisor with the real `restoreFlowchartSupervisor`, runs the real
`applyChildThreeLine` over the real event log, appends the delta through the real `EventStore`,
writes the real `CheckpointStore`, and then hands the run to the real `resumeFlowchartRun`.

### 4.1 The reconstruction

```ts
async function adoptionCandidate(stateRoot, parentEvents, taskId) {
  const last = parentEvents.filter(
    (e) => e.type === "CHILD_RUN_CREATED" && e.taskId === taskId
  ).at(-1);
  if (last === undefined) return { refused: "no child run recorded" };
  const childRunId = last.payload.childRun.id;

  // Commit proof: the child run reached its own terminal. A TASK_RESULT is not
  // enough -- maybeCascadeRetry can supersede one.
  const childLog = await new EventStore(stateRoot, childRunId).readAll();
  const terminal = childLog.events.find(
    (e) => e.type === "RUN_COMPLETED" || e.type === "RUN_FAILED" || e.type === "RUN_CANCEL_REQUESTED"
  );
  if (terminal === undefined) return { refused: "child run never closed its own log" };
  if (terminal.type === "RUN_CANCEL_REQUESTED") return { refused: "child run was cancelled" };

  const messages = parentEvents
    .filter((e) => e.type === "CHILD_MESSAGE")
    .map((e) => e.payload.message)
    .filter((m) => m.runId === childRunId);
  const fromChild = messages.filter((m) => m.to === SUPERVISOR);
  const terminalResult = [...fromChild].reverse().find((m) => m.type === "TASK_RESULT");
  if (terminalResult === undefined) return { refused: "no terminal TASK_RESULT on the parent log" };

  return {
    childRunId,
    outcome: {
      childRunId,
      taskId,
      outcome: terminal.type === "RUN_COMPLETED"
        ? (terminalResult.outcome === "PARTIAL" ? "PARTIAL" : "SUCCESS")
        : "FAILURE",
      attempts: messages.filter((m) => m.type === "TASK_REQUEST").length,
      summary: terminal.type === "RUN_FAILED" ? terminal.payload.reason : terminalResult.summary,
      messages: fromChild,
      terminalResult,
      evidenceIds: terminalResult.evidenceIds,
      artifactIds: terminalResult.artifactIds
    }
  };
}
```

and the adoption step itself, which is the same three lines `executeClusteredNode` already runs:

```ts
const gated = applyChildThreeLine({
  events: read.events, child: candidate.outcome, spec, nowIso: now(),
  generateEventId: () => createEventId(generateId)
});
for (const event of gated.events.slice(read.events.length)) await eventStore.append(event);
supervisor.applyChildResult(nodeId, childNodeResultFromChildOutcome(candidate.outcome));
```

### 4.2 What it does at each crash point

| budget | adoption | checkpoint after | final status | re-executed `b` | child runs for `b` | assessments | replay anomalies |
|---|---|---|---|---|---|---|---|
| 0 | refused: child run never closed its own log | RUNNING | COMPLETED | yes | 2 | 1 | 0 |
| 1 | refused: child run never closed its own log | RUNNING | COMPLETED | yes | 2 | 1 | 0 |
| **2** | **adopted** | **COMPLETED** | **COMPLETED** | **no** | **1** | **1** | **0** |
| 3 | refused: node is COMPLETED, not RUNNING | COMPLETED | COMPLETED | no | 1 | 1 | 0 |
| 4 | refused: node is COMPLETED, not RUNNING | COMPLETED | COMPLETED | no | 1 | 1 | 0 |
| — | *control, no crash, no adoption* | — | COMPLETED | — | 1 | 1 | 0 |

Budget 2's row is byte-for-byte the control's shape. The gate ran for real: one `TRACKING_ASSESSMENT`
produced by the adoption, not carried over.

### 4.3 The partial-gate case, which turned out to favour adoption

`applyChildThreeLine` mints every gate event id *before* any of them is appended, then
`executeClusteredNode` appends them one `await` at a time. The id-generator seam therefore cannot drop
a crash between two gate appends — but a SIGKILL or ENOSPC can, leaving `TRACKING_ASSESSMENT` durable
and `GATE_TRANSITION` / `RUN_BLOCKED` not. Reproduced by truncating the log at `GATE_TRANSITION` and
rewinding the checkpoint's node to RUNNING:

- **Adoption** re-runs the gate. `nextTrackingSeq` returns `seq+1`, so the idempotency key does not
  match the stranded assessment; the gate emits all three events afresh (`applied: true`,
  `directive: queue_analysis`, `BLOCKED`). The partial gate is completed, not stranded.
- **Today's resume** re-executes the node and also emits a second assessment. Same duplicate, plus a
  paid re-execution.

I expected this to be adoption's worst case and it is its best one. Recording it because the opposite
was my hypothesis.

### 4.4 Out-of-slot observation, not a claim

A run whose node reports `verification: FAILED` closes with `RUN_BLOCKED` *and* `RUN_FAILED`, and
`replayRun` reports `anomalies: ['multiple terminal events']` on that perfectly ordinary log. This
reproduces at HEAD on an unmodified `startFlowchartRun` — no tampering, no crash. It is unrelated to
this slot and I did not chase it; flagging it for the parent because "anomalies is empty" is an
assertion several suites lean on.

## 5. The decision, and the accepted cost

**Do not buy resume-time adoption in Round 6.** The reasoning, in the order the evidence forced it:

1. **The window is rare.** 0.0008 %–0.03 % of run wall time (§2.3). The expected saving is a fraction
   of one node re-execution per ~10⁴ crashes.
2. **The cost when it hits is bounded and honest.** One node paid for twice, with the retry on the
   record: two `CHILD_RUN_CREATED`, two distinct child run ids, each child log closed (R4-4's pin),
   and — newly pinned here — the node's result accepted exactly once, so the ledger does not carry
   two accepted results for one node. This is at-least-once, the same contract the rest of the run
   plane already publishes. Nothing is silently lost.
3. **The failure modes are not commensurable.** Today's failure is *spend money twice, visibly*.
   Adoption's failure, if the reconstruction ever drifts from what the coordinator would have
   produced, is *a node marked COMPLETED on a result its child never committed* — a silent false
   success, which is on the standing forbidden list. The detection half of adoption runs on **every**
   resume of a run with a RUNNING node, while the payoff half fires once in 10⁴ crashes. That is the
   wrong ratio of exposure to benefit.
4. **The reconstruction is faithful but not *provably* faithful.** §4.1 infers `attempts` from
   `TASK_REQUEST` count and `messages` from "messages addressed to the supervisor". Both matched in
   every case I ran, but neither is enforced by a type or a pin, and `assessmentHash` — the thing that
   makes gate idempotency work — is computed from those fields. There is no compile-time link between
   the coordinator's `ChildRunOutcome` and a log-derived one. Any future field added to
   `ChildRunOutcome` silently degrades the reconstruction.

Points 1–2 say the prize is small. Points 3–4 say the risk is not.

**Accepted cost, stated plainly:** a crash in the ~1–2 ms between a child run committing and the
supervisor accepting its result costs one node re-execution on resume. The retry is visible on the
parent log and accepted exactly once. This is the same at-least-once boundary R4-4 disclosed; R5-5
measured it, priced it, proved the fix works, and declined it.

### What would flip this

Two conditions, either sufficient:

- **A schema round lands a committed-child-outcome record on the parent log.** Adoption then stops
  being a reconstruction and becomes a lookup, and point 4 evaporates. R4-4 already sketched the
  adjacent event (`RUN_CRASHED`); a `CHILD_RUN_SETTLED` carrying the outcome is the same class of
  addition and would make this cheap and provable. Needs parent sign-off, same as any schema change.
- **A measurement shows the window is no longer rare** — per-node latency collapsing (cached or local
  models), or the acceptance path growing something slow. The bar is the same one R4-1's decision pins
  set: a new same-VM measurement, never a silent reopen.

### If it is bought anyway: files, seams, risks

- **Seam.** One helper, `adoptRecordedChildResult(ctx, node)`, called from `executeRemainingRunningNodes`
  immediately before it spawns — not from `resumeRestoredRun`, so the clustered branch keeps the gate
  in exactly one place. Returns `"adopted" | undefined`; on `undefined` the existing spawn runs
  unchanged.
- **Files.** `src/run/flowchart-run.ts` (the helper and its one call site; R5-1's file, so this is a
  Round-6 ownership question, not a Round-5 one). Nothing else — `child-tracking.ts`,
  `gate-apply.ts`, `child-coordinator.ts` and the event schema are all consumed as published.
- **Preconditions, all four required.** Node state is RUNNING; the newest `CHILD_RUN_CREATED` for the
  task exists; that child run's own log carries a non-`RUN_CANCEL_REQUESTED` terminal; the parent log
  carries its terminal `TASK_RESULT`. Fail any one → fall through to re-execution. Fail closed, never
  fail open.
- **Risks, in the order they would bite.** (a) reconstruction drift from `ChildRunOutcome` (point 4 —
  mitigate with a round-trip pin against a live coordinator outcome, which I did not build);
  (b) the supervised plane (`coordinator.ts:498`) shares the shape and would need the same treatment
  or an explicit statement that it does not get it; (c) an adopted node is invisible at inspect time —
  the operator cannot tell "ran" from "adopted a prior process's run", which is the same disclosure
  gap R4-4 declined a marker for; (d) `applyRunningResults` must **not** be reused as the seam (§6).

## 6. Pins added

All additive. No existing assertion changed.

`test/unit/run/flowchart-run-abort.test.ts` — 3 new tests (14 → 17):

1. **"a crash inside the acceptance window leaves a committed child result the supervisor never took"**
   — the adoptable state, pinned in full: one `CHILD_RUN_CREATED` for the task, the parent log
   carrying its `TASK_REQUEST` and its terminal `TASK_RESULT`, the child run's own log closed with
   exactly one terminal, no `TRACKING_ASSESSMENT`, checkpoint `b: RUNNING`. R4-4 pinned the
   `TASK_RESULT` half; this adds the commit half and the attempt count — i.e. the *whole* precondition
   set a Round-6 adopter keys on. If a future change stops the parent log carrying the child's
   messages, this decision's central premise fails loudly instead of quietly becoming wrong.
2. **"the retry a crashed acceptance window costs is one node, accepted once"** — the accepted cost,
   bounded: exactly one node re-executed, and exactly one `TRACKING_ASSESSMENT` with
   `assessment.turnId === "tsk_b"` on the finished log. The duplicate is a node, not a gate.
3. **"a TASK_RESULT on the parent log is not by itself the child's committed answer"** — the cascade
   premise: one child run, two `TASK_RESULT`s on the parent log with a `TASK_RETRY` strictly between
   them. This is why the precondition is the child log's terminal. If cascade retry ever stops being
   reachable, the pin fails and the precondition can be relaxed on evidence.

`test/integration/m2.5/resume.test.ts` — 1 new test (3 → 4):

4. **"caller-supplied childResults are applied without a three-line gate"** — the seam that already
   exists. `applyRunningResults` applies caller-supplied results straight to the supervisor: the
   results really land (nodes reach COMPLETED) and no `TRACKING_ASSESSMENT` or `GATE_TRANSITION`
   appears on either leg. That is right for results a caller vouches for and wrong for results
   reconstructed from a log, so it is the seam a Round-6 adoption must **not** reuse. Pinned where
   resume's contract lives.

## 7. Verification

- `npx eslint test/unit/run/flowchart-run-abort.test.ts test/integration/m2.5/resume.test.ts` — clean,
  exit 0.
- `npx tsc --noEmit` whole tree — clean, exit 0.
- Owned tests 3×: 21 tests, 21 pass, 0 fail, 0 skipped, all three runs. **This slot introduces no
  skip.**
- **Mutation controls.** Surgical patch/unpatch on the exact anchor lines (never a whole-file copy —
  the tree is shared with concurrently-editing slots; residual mutant count verified 0 afterwards):

  | mutant | fails |
  |---|---|
  | child coordinator never appends `RUN_COMPLETED` to the child log | new 14, new 15 (+ pre-existing 8, 9) |
  | `maybeCascadeRetry`'s plan forced to `undefined` | new 16, and only 16 |
  | parent log stops carrying `CHILD_MESSAGE` | new 14, new 16 (+ pre-existing 9) |

  Pin 4's non-vacuity checked test-only: emptying its `childResults` fails it (the results-were-applied
  half), confirming the absence assertion cannot pass vacuously.
- No bench: this slot makes no perf claim. §2's timings are a property measurement of an existing
  path, not a before/after, and no arm of the tree changed.
- No scratch files: everything outside the two owned test files ran from `/tmp`, and this report is
  the only other artifact.

### Shared-tree transients, attributed to files (not mine, not fixed)

`test/integration/m2/resume.test.ts` × 2 fail at the time of writing —
`resume after an interruption completes without rerunning finished work` and
`resume of an in-window orphaned lease recovers instead of stalling`. Both are
`DomainValidationError` / `LOCK_TIMEOUT`, `timed out waiting for lock at
runtime/runs/<id>.lock`, from `withExclusiveFileLock`. That is **R5-1's run-lifecycle lock**
(`runLockPath`) as currently landed in `flowchart-run.ts` / `coordinator.ts` / `supervisor.ts`: a
supervised resume is waiting on a lock the run already holds. Each costs the full 5 s timeout, which
is why `test/unit/run` + `test/integration/m2.5` + `test/integration/m2` now takes ~186 s. Flagged for
R5-1/R5-2; this slot touches no `src/**` and neither test is in its ownership. `test/unit/run` and
`test/integration/m2.5` are fully green (191/193 across the three suites, the 2 failures being exactly
those).

## 8. Frozen contracts held

No `src/**` edits at all, so every frozen contract is untouched by construction. Specifically
unaffected: `recordCrashTerminal`'s in-flight-only posture on all three planes;
`preserveResumableState`'s flush-only-for-`RESUMABLE_CRASH_STATUSES` rule and the no-terminal rule for
paused/waiting/blocked; exactly-one-terminal per log; `applyRetry` as the sole BLOCKED→READY producer;
`EventStore.readAll`'s `DomainValidationError` posture; the two decision pins that `EventStore.append`
and `CheckpointStore.write` do not take the run lock. R4-4's six pins are byte-unchanged and green;
the three new unit pins sit after them and assert the same windows from the adoption side. No schema
addition, no `package.json` edit, no commit, no branch change.

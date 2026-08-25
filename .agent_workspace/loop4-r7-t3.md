gpt-5.6-sol

# Loop 4 · Round 7 · R7-3 — a way out of BLOCKED

Result: investigation and current-behaviour pins complete. No persisted schema
was added; the proposed schema below requires explicit parent sign-off in Round
8. This agent stayed on `agent/opt-continuous` and did not commit or push.

## Ownership

Owned changes are limited to:

- additive pins in `test/unit/run/replay.test.ts`
- this report, `.agent_workspace/loop4-r7-t3.md`

No `src/**`, `flowchart-run.ts`, or `main.ts` file was edited.

## Census first

The Round 6 finding reproduces from current source:

1. `replayRun` initializes `sawTerminal = false`, sets it for
   `RUN_COMPLETED`, `RUN_FAILED`, and `RUN_BLOCKED`, and has no case that clears
   it. `RUN_BLOCKED` therefore replays BLOCKED forever under the current event
   vocabulary.
2. `TERMINAL_REPLAY_STATUSES` contains exactly COMPLETED, FAILED, and BLOCKED.
   `replayedTerminalStatus` delegates to `replayRun`, so writers and the anomaly
   rule share that definition.
3. All three flowchart terminal recorders — `persistBlocked`,
   `persistCompleted`, and `persistFailed` — call the same
   `alreadyTerminal(ctx)` refusal. That helper reads the log and asks
   `replayedTerminalStatus`; a BLOCKED log prevents all three writes.
4. `injectFlowchartRun` accepts BLOCKED and appends `INJECTION_REQUESTED`, then
   mutates/checkpoints the supervisor. Replay ignores that event, so injection
   can add a fact but cannot change the run terminal.
5. `resumeFlowchartRun` also accepts BLOCKED, but restores the checkpoint as-is.
   For the R6-1 gate case, the checkpoint has a FAILED flowchart node while the
   run log replays BLOCKED. Resume reaches the FAILED supervisor outcome, and
   `persistFailed` refuses because replay still names BLOCKED.
6. `applyRetry` is not a run-log operation. It accepts a DAG `TaskNode` in
   BLOCKED and returns task status READY. Its sole production caller is
   `runSupervisorRounds` in `src/run/supervisor.ts`; there is no call in the
   flowchart plane. Even a persisted `TASK_STATUS_CHANGED` to READY does not
   affect run replay.
7. The domain state table already allows run BLOCKED → RUNNING. The missing
   piece is an event and producer that make that transition durable, not a new
   domain-state edge.
8. The persisted-schema consumer census found the mandatory Round 8 updates:
   `src/run/events.ts` owns `EVENT_TYPES`, the union, and validation;
   `src/run/replay.ts` owns terminal replay; `src/run/gate-apply.ts` separately
   reconstructs gate status; and
   `test/unit/run/event-row-fuzz.test.ts::EVENT_SEEDS` is exact-keyed to
   `EVENT_TYPES`.

## Additive current-behaviour pins

Two tests were added without changing the existing tests:

1. **All three terminal recorders refuse while replay names BLOCKED.** The pin
   checks each recorder's own source region for the shared
   `alreadyTerminal(ctx)` refusal and checks that the helper still delegates to
   `replayedTerminalStatus`. This covers the otherwise currently-unreachable
   `persistCompleted` direction, rather than inferring it from the one reachable
   R6-1 failure path.
2. **Current operator and scheduler signals cannot clear RUN_BLOCKED or its
   terminal latch.** The pin first asserts that the signed-off event vocabulary
   has no `RUN_UNBLOCKED`. It then appends, one at a time, the plausible existing
   substitutes:
   - another `RUN_STARTED`
   - an operator `INJECTION_REQUESTED`
   - a scheduler-level `TASK_STATUS_CHANGED` to READY
   - a `GATE_TRANSITION` from BLOCKED to RUNNING

   Every sequence still replays BLOCKED, `replayedTerminalStatus` still returns
   BLOCKED, and a later `RUN_FAILED` is still a multiple-terminal anomaly. The
   last assertion proves the private terminal latch was not merely hidden by the
   displayed status.

The event-vocabulary assertion is deliberately a Round 8 tripwire. It must be
replaced, not weakened, if the parent signs off the persisted event below.

## Round 8 contract requiring parent sign-off

### Persisted event

Proposed additive event:

```ts
type: "RUN_UNBLOCKED"
payload: {
  blockedEventId: EventId;
  reason: string;
  retryNodeId?: string;
}
```

Semantics:

- `blockedEventId` identifies the exact, currently active `RUN_BLOCKED`; this
  prevents a stale command from clearing a later block and makes repeated
  BLOCKED → RUNNING → BLOCKED cycles unambiguous.
- `reason` is the operator's non-empty audit rationale. The event's existing
  top-level `actor` records who authorized it.
- `retryNodeId` is absent for a run-level stall block. It is required for an
  `ANALYSIS_QUEUED` gate block and names the FAILED flowchart node to re-drive.
  The producer validates that the node's task matches the blocking
  `GATE_TRANSITION.turnId`; current tracking assessments use the child task id
  as `turnId`.
- No evidence is copied into this event. Facts/evidence remain in their existing
  durable events, especially `INJECTION_REQUESTED`; `blockedEventId` and
  `reason` are the transition audit record. This avoids a second, unverifiable
  evidence vocabulary.
- Validation rejects unknown keys, an invalid event id, an empty reason, an
  empty `retryNodeId`, a target that is not the active block, or a gate-block
  retry target that is not the failed blocking node.

This is a new persisted event type and therefore does not land without the
standing explicit schema sign-off.

### Producer surface

Choose a dedicated operator command, not a fourth injection kind:

```text
pi-sparkle unblock --run <runId> --reason <text>
  [--retry-node <nodeId>] [--state-root <dir>]
```

The operator flow is:

1. inspect the block and add the requested fact/evidence through existing
   surfaces where appropriate;
2. authorize the durable transition with `unblock`;
3. run `resume` to execute again.

Reasons for a dedicated command:

- injection is a typed fact/override/skip side channel, whereas unblocking
  changes the run lifecycle and terminal interpretation;
- `injectFlowchartRun` is deliberately not under `withRunLifecycleLock` because
  it may target a live run; an unblock must serialize against resume and delete;
- a separate command can validate one active BLOCKED terminal, append exactly
  one matched event, and refuse a second/stale unblock without conflating that
  authorization with user-supplied facts.

The command acquires `withRunLifecycleLock`, requires replay status BLOCKED,
finds the active `RUN_BLOCKED`, validates the target, appends `RUN_UNBLOCKED`,
and materializes the transformed checkpoint. It does not execute children;
resume remains the sole execution surface. Append precedes checkpoint write so
a crash cannot expose an unblocked checkpoint without its authorizing event.
Resume must be able to recover the inverse crash window (event present, old
checkpoint) as described below.

### Replay

Replay should retain the active terminal kind and, for BLOCKED, its event id.
On a valid `RUN_UNBLOCKED` whose `blockedEventId` matches that active block:

```ts
sawTerminal = false;
activeTerminal = undefined;
activeBlockedEventId = undefined;
status = sawStarted ? "RUNNING" : "PLANNING";
```

Consequences:

- `replayedTerminalStatus` returns `undefined`;
- the three existing flowchart recorder refusals open without a special-case in
  each writer;
- a later COMPLETED, FAILED, or BLOCKED is the new active terminal and is not a
  multiple-terminal anomaly;
- an unblock without an active BLOCKED, an unblock over COMPLETED/FAILED, or a
  mismatched `blockedEventId` is anomalous and leaves the terminal latched;
- a second BLOCKED followed by its own matched unblock is supported.

`TERMINAL_REPLAY_STATUSES` remains the set of statuses that can currently be
terminal. `RUN_UNBLOCKED` changes the active interval; it is not itself a
terminal status. `currentGateStatus` in `gate-apply.ts` must also treat a valid
`RUN_UNBLOCKED` as RUNNING, or a subsequent tracking transition would retain a
stale gate-level BLOCKED even though run replay had cleared it.

### Checkpoint restore and re-driving the node

Clearing replay alone is insufficient. The current R6-1 checkpoint contains a
FAILED flowchart node, so an unchanged resume would immediately call
`persistFailed`. Round 8 needs a flowchart-specific restore operation, distinct
from scheduler `applyRetry`:

1. Compare the matched unblock event's position with
   `checkpoint.lastEventId`. If the event is newer than the checkpoint, apply
   its transform during restore; if the checkpoint already includes it, do not
   apply twice.
2. For `retryNodeId`, require that node to be FAILED, remove its failed outcome
   fields and stale active route, and put it in READY. Preserve its prior
   evidence in the append-only history.
3. Reset only unexecuted descendant consequences of that failed result
   (READY/SKIPPED descendants back through PENDING, then propagate). Fail closed
   if retry would have to erase a descendant that already reached
   COMPLETED/FAILED; such a rewind would discard executed work and needs a
   separate contract.
4. For a run-level stall unblock (no `retryNodeId`), clear the checkpoint
   ledger's `isBlocked`, `consecutiveStalls`, and `requiredEvidence`; retain
   existing RUNNING/READY node state. Resume then re-executes restored RUNNING
   work or leases READY work through the normal loop.
5. Persist the transformed checkpoint before returning from `unblock`. Resume
   performs the same idempotent transform when recovering an event-first crash.
6. The normal resume loop now leases the READY target, records a fresh
   `MODEL_ROUTED`, and invokes the configured executor. The old failed attempt
   remains visible in events; no log row or evidence is rewritten.

The first Round 8 implementation should include both current block shapes:
`ANALYSIS_QUEUED` with a failed retry target and stall-ledger BLOCKED without a
target.

### Meaning of the frozen `applyRetry` sole-producer pin

It remains unchanged.

- `applyRetry` continues to be the sole producer of DAG task
  `TaskStatus` BLOCKED → READY, with its existing sole production caller in
  `runSupervisorRounds`.
- `RUN_UNBLOCKED` is a run-level persisted transition.
- Reopening a `FlowNodeState` is a flowchart-supervisor operation on a different
  state machine. It must use a distinct name and must not fabricate a
  `TaskNode`, call `applyRetry`, or append `TASK_STATUS_CHANGED` READY.
- Round 8 should keep `test/unit/run/scheduler.test.ts`'s sole-producer pin
  unchanged and add a negative pin that the flowchart unblock path does not
  import/call `applyRetry`.

## Round 8 implementation and test map

Minimum affected surfaces after sign-off:

- `src/run/events.ts`: event constant, payload union, exact validation
- `src/run/replay.ts`: matched active-block clearing and anomaly cases
- `src/run/gate-apply.ts`: clear reconstructed gate status
- `src/supervisor/flowchart-supervisor.ts` and snapshot validation: idempotent
  node/ledger reopen operation
- `src/run/flowchart-run.ts`: locked producer/restore integration and checkpoint
  crash recovery
- CLI command/usage wiring: dedicated `unblock`
- `test/unit/run/event-row-fuzz.test.ts`: mandatory exact-keyed event seed
- replay tests: replace this round's schema-absence tripwire with matched,
  stale, wrong-terminal, repeated-cycle, and post-unblock-terminal cases
- flowchart integration tests: gate-node retry really executes again; stall
  unblock resumes existing work; event-first checkpoint-failure recovery
- CLI tests: argument validation, stale/double refusal, and no execution before
  explicit resume

No existing terminal recorder needs a private unblock exception: their shared
replay query is the intended integration seam.

## Verification

- Owned replay suite, 3 consecutive runs: **14/14 pass, 0 fail, 0 skip**
  each run.
- Scoped ESLint on `test/unit/run/replay.test.ts`: clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `git diff --check`: clean at the post-edit check.
- No full gate was run.
- No scratch file was created in the repository.

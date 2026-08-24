[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 9 — R9-3 executed-descendant discard design

## Outcome

Decision: keep the existing `unblock` command and add an explicit
`--discard-executed` flag, but persist that stronger authorization as a distinct
exact-keyed event, provisionally named `RUN_UNBLOCKED_WITH_DISCARD`. Do not add
a field to `RUN_UNBLOCKED`, and do not append a separate discard event plus an
ordinary `RUN_UNBLOCKED`.

The distinct event is the whole authorization and the block-clearing event. It
avoids widening the exact-frozen `RUN_UNBLOCKED` payload and avoids a two-event
crash window in which only half of the authorization has landed. This round
does not implement that schema or behavior.

One additive unit pin now proves that ordinary unblock still refuses a FAILED
node with two COMPLETED descendants, names both descendants, and leaves the
snapshot untouched.

## 1. Census first

The current behavior and seams are:

1. `FlowchartSupervisorImpl.reopenAfterUnblock` computes join-required
   downstream consequences. If any consequence is `RUNNING`,
   `WAITING_FOR_USER`, `COMPLETED`, or `FAILED`, it throws
   `cannot reopen node … already executed … not authorized by an unblock`.
   Only `READY` and `SKIPPED` consequences are currently rewound to `PENDING`.
2. The ordinary reopen preserves evidence counts and all event-log rows. It
   clears stale outcome fields on the FAILED retry target and does not refund
   `remainingCostUsd` or `remainingTimeMs`.
3. `unblockLockedFlowchartRun` runs transform → `RUN_UNBLOCKED` append →
   checkpoint. A refused transform therefore writes nothing; an append-first
   crash is recovered by `unappliedUnblock` in every restore path.
4. `RUN_UNBLOCKED` is exact-keyed as
   `{ blockedEventId, reason, retryNodeId? }`. Unknown fields are rejected.
   Replay clears the terminal latch only when `blockedEventId` names the active
   block.
5. `currentGateStatus` in `gate-apply.ts` separately recognizes matched
   `RUN_UNBLOCKED`, so any new clearing event is a consumer there too.
6. CLI `unblock` currently parses `--run`, `--reason`, `--retry-node`,
   `--actor`, and `--state-root`; help, BLOCKED guidance, and CLI tests pin that
   surface.
7. The run log has a reliable charged estimate per `MODEL_ROUTED`
   (`estimatedCostUsd`, `estimatedDurationMs`). Provider invocation telemetry
   has task/run identity and optional usage/pricing, but its sink is
   best-effort and asynchronous and missing usage is deliberately
   `undefined`, never zero. It cannot support an unconditional “actual spend”
   claim in this event.

The existing integration pin mutates one descendant to COMPLETED. The new unit
pin builds a natural recovery graph: a FAILED node opens two failure branches,
both branches complete, and ordinary reopen refuses the resulting real
supervisor snapshot.

## 2. Command and event decision

### Operator surface

The future command is:

```text
pi-sparkle unblock --run <runId> --reason <text> \
  --retry-node <nodeId> --discard-executed [--actor <who>]
```

`--discard-executed` is a boolean opt-in to the full set computed under the run
lifecycle lock. It is not a user-supplied node list: the flowchart definition,
join policies, checkpoint states, and active block determine the set. This
prevents an operator from omitting one consequential node and producing a
partially coherent rewind.

Rules:

- Executed consequences without the flag retain today's exact fail-closed
  behavior and write nothing.
- The flag requires a gate block and its exact `--retry-node`; it is invalid for
  a targetless stall unblock.
- The flag with no executed consequence is refused (“nothing to discard; omit
  `--discard-executed`”), rather than writing a false discard record.
- All states protected by the current guard are in scope: `RUNNING`,
  `WAITING_FOR_USER`, `COMPLETED`, and `FAILED`. The event records each prior
  state. The lifecycle lock and terminal BLOCKED state must still ensure no
  child remains live before the transform is allowed.
- `resume`, not `unblock`, remains the only execution surface.

### Durable surface

Use one new event type, `RUN_UNBLOCKED_WITH_DISCARD`, rather than:

1. **A `discardExecuted` field on `RUN_UNBLOCKED`: rejected.** It breaks the
   exact-key freeze and turns the narrow ordinary authorization into a
   multi-strength event. That is a schema sign-off, not an additive flag.
2. **A discard event followed by `RUN_UNBLOCKED`: rejected.** The first append
   can survive without the second, or the clearing append can survive before
   the checkpoint. Correct recovery then needs cross-event pairing,
   consumption, and orphan rules solely to represent one operator act.
3. **A separate `discard` command: rejected.** Discarding control-state without
   atomically ending the named block creates an unnecessary operator-visible
   intermediate state.

The new event is also a future schema sign-off: it must join `EVENT_TYPES`, the
`Event` union, exact validation, seeded row fuzzing, replay, and every
reconstruction consumer in one implementation diff. It does not alter the
existing `RUN_UNBLOCKED` schema.

## 3. Proposed exact audit payload

Names are provisional until the implementation schema slot, but the semantic
minimum is:

```ts
interface RunUnblockedWithDiscardPayload {
  blockedEventId: EventId;
  reason: string;
  retryNodeId: string;
  rewoundDescendants: readonly {
    nodeId: string;
    taskId: TaskId;
    previousState:
      | "READY"
      | "SKIPPED"
      | "RUNNING"
      | "WAITING_FOR_USER"
      | "COMPLETED"
      | "FAILED";
    modelRouteEventIds: readonly EventId[];
    childRunIds: readonly RunId[];
    chargedEstimatedCostUsd: number;
    chargedEstimatedDurationMs: number;
  }[];
}
```

Contract details:

- `blockedEventId`, the event envelope's `actor`, and `reason` answer which
  block, who, and why.
- `retryNodeId` is required and remains a flowchart node id.
- `rewoundDescendants` lists every consequential descendant whose state
  changes, not only the executed subset. It excludes the retry target because
  that target is already named separately.
- Entries are unique and canonically ordered by `nodeId`. At least one entry
  must have an executed prior state; otherwise this event is invalid.
- `nodeId` plus `taskId` pins both state-machine and run-log identity.
- `modelRouteEventIds` and `childRunIds` identify the exact attempts whose
  control-state result is superseded. The original records remain the source of
  detailed evidence and artifacts.
- Charged estimates are finite non-negative sums for those attempts, validated
  against the referenced supervisor `MODEL_ROUTED` records. They state the
  budget estimate the run actually consumed, not a fabricated provider bill.

Do not put copied evidence ids, artifact contents, prompts, responses, or a
bare `actualCostUsd` in this event. Invocation telemetry remains in its own
records and can be correlated through task/child-run identity. Because that
sink may drop a row and provider usage/pricing may be unavailable, absence is
not zero and the authorization event cannot claim complete actual spend.

If a later schema requires observed usage, it needs an explicit
`COMPLETE | PARTIAL | UNAVAILABLE` basis and invocation ids; it must not reuse
the charged estimate field or silently convert unknown usage to zero.

## 4. Spend and budget decision

Discard is a control-state operation, not a refund:

- Keep `remainingCostUsd` and `remainingTimeMs` unchanged.
- Record per-descendant charged cost/time estimates and the route events behind
  them.
- Re-execution spends again and must pass the remaining-budget checks normally.
- READY/SKIPPED descendants carry empty route/child references and zero charged
  estimates; those values mean “no route was charged for this state,” not “the
  whole run cost zero.”

This is the strongest truthful audit available from the durable run plane
today. Calling it actual provider spend would overstate the telemetry
guarantee.

## 5. Evidence-survives decision

Yes: rewound COMPLETED work leaves every existing event untouched.

The new event supersedes those nodes' prior outcomes for future scheduling; it
does not delete history. Existing `CHILD_MESSAGE`, model-routing, gate,
evidence, artifact-reference, and invocation records remain factual. The
specialized event's node/attempt references make the supersession itself
queryable.

Snapshot behavior for the future transform:

- preserve evidence counts, ledger facts, and remaining budgets;
- clear stale `success`/`confidence` outcome fields on every executed
  descendant before setting it to `PENDING`;
- remove affected active routes and any affected pending approval/waiter state;
- rewind READY/SKIPPED consequences to `PENDING`;
- reopen the FAILED retry target exactly as ordinary unblock does;
- run the normal propagation fixpoint and waiter invariant afterward.

Evidence surviving does not mean a stale success remains eligible to satisfy
an edge. Events and evidence counts survive; control-state outcome fields do
not.

## 6. Producer, replay, and crash discipline

Preserve the existing transform → append → checkpoint order:

1. Under `withRunLifecycleLock`, resolve the active block and exact retry
   target.
2. Compute the consequence set, prior states, attempt references, charged
   estimates, and candidate reopened snapshot. Validate the generated audit
   payload against the checkpoint and event log.
3. Append one `RUN_UNBLOCKED_WITH_DISCARD`.
4. Materialize and write the reopened checkpoint.

A failure in steps 1–2 writes nothing. A crash after step 3 leaves one complete
authorization in the log and the old blocked checkpoint. `unappliedUnblock`
must recognize either ordinary `RUN_UNBLOCKED` or the specialized event and
apply the matching transform once, using `checkpoint.lastEventId` for
idempotence.

Replay must give the specialized event the same active-block matching,
stale/post-terminal anomaly, and pre-terminal status re-derivation rules as
ordinary unblock. It remains an event, not a status, and does not enter
`TERMINAL_REPLAY_STATUSES`. `currentGateStatus` must recognize the same matched
event so the gate record cannot disagree with replay.

Restore must recompute the consequence set from the durable definition and
blocked checkpoint and compare it with `rewoundDescendants`; it must not trust
a hand-edited node list to authorize unrelated state. Any mismatch fails
closed.

## 7. Future implementation consumer census

Production files owed after R9-1's durable-contract work lands:

- `src/run/events.ts`: new exact-keyed event payload/type/validator; ordinary
  `RUN_UNBLOCKED` remains byte-for-byte in shape.
- `src/run/replay.ts`: specialized matched/stale/terminal handling and clearing
  event identity.
- `src/supervisor/flowchart-supervisor.ts`: plan-returning specialized
  transform; ordinary transform and guard stay narrow.
- `src/run/flowchart-run.ts`: request flag, plan/audit derivation, append order,
  checkpoint recovery union, no budget refund.
- `src/run/gate-apply.ts`: matched specialized event in `currentGateStatus`.
- `src/cli/main.ts`: boolean parsing, help/BLOCKED guidance, request projection,
  and success output naming discarded nodes and charged estimates.

Tests owed:

1. Keep the new unit ordinary-unblock refusal pin and add a separate positive
   specialized-transform test covering multiple COMPLETED descendants,
   outcome-field clearing, evidence retention, and no budget refund.
2. `test/unit/run/event-row-fuzz.test.ts`: seed and exact nested refusals for the
   new event; retain all `RUN_UNBLOCKED` exact-key refusals.
3. `test/unit/run/replay.test.ts`: matched, stale, unmatched, post-terminal,
   re-block cycle, status re-derivation, and unchanged terminal set for the new
   event.
4. `test/integration/run/unblock-flow.test.ts`: no-flag refusal writes nothing;
   flag emits only the specialized event; unblock executes nothing; resume
   reruns the target and discarded descendants; old evidence/events survive;
   event-first crash recovery applies once.
5. `test/integration/cli/unblock.test.ts`: flag parsing, targetless and
   unnecessary-flag refusals, actor/reason, output, and help.
6. `test/integration/cli/blocked-next.test.ts`: disclose the stronger flag
   without weakening the ordinary guidance.
7. Add a gate reconstruction/re-block pin for the specialized event.

`src/run/flowchart-run.ts`, `src/run/replay.ts`, and `src/cli/main.ts` remain
R9-1-owned this round. This implementation must be sequenced afterward.

## 8. Additive fail-closed pin

Added
`test/unit/supervisor/flowchart-supervisor.test.ts::ordinary unblock cannot
rewind completed descendants of a failed node`.

It constructs a failed recovery root whose two downstream branches complete,
then exact-pins:

- both blocking node ids in the refusal;
- the statement that ordinary unblock lacks discard authorization;
- no mutation of the source supervisor snapshot.

The future positive contract adds a new path; ordinary unblock must continue to
pass this refusal test.

## 9. Verification and scope

- Focused `pnpm test -- test/unit/supervisor/flowchart-supervisor.test.ts`:
  25/25 pass, 0 fail, 0 skipped.
- Scoped
  `pnpm exec eslint test/unit/supervisor/flowchart-supervisor.test.ts`: pass.
- Whole-tree `pnpm exec tsc --noEmit`: pass against the cumulative shared tree.
  A post-report-census rerun briefly failed first on a half-written declaration,
  then on a missing `RequirementContract` import, both in sibling-owned
  `test/unit/supervisor/flowchart-snapshot.test.ts`; after that import landed,
  the exact whole-tree command passed again.
- Final owned-file `git diff --check`: pass.
- Full gate not run, as instructed.

Owned changes are only:

- `test/unit/supervisor/flowchart-supervisor.test.ts`
- `.agent_workspace/loop4-r9-t3.md`

No `src/**`, forbidden file, package, dependency, ADR, live-routing, git
history, branch, commit, or push change was made. Concurrent Round 9 edits
appeared elsewhere in the shared tree after the initial clean census; they were
not edited by this slot.

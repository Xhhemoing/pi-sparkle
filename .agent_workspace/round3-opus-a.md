MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 3 — R3-opus-A: forward `maxCostUsd` from run limits into `execute()`

Round 3 target 1 from `R2-KERNEL-BRIEF.md`: R2 built the adapter-side cost gate
(`src/pi-adapter/cost-gate.ts` + `shouldStopAfterTurn`) and added
`AgentExecutionRequest.maxCostUsd`, but nothing on the coordinator side ever set
that field, so a live run was uncapped no matter what `RunLimits.maxCostUsd`
said. This wires the ceiling from `Run.limits` to the executor request on the
root-run path and on every child path, without touching the gate's arithmetic.

## What changed

Four edits, all in `src/run/`:

**`src/run/coordinator.ts` — root run.** `startRun` forwards
`run.limits.maxCostUsd` on the `deps.executor.execute({...})` request. Absent
cap means the field is not present at all (conditional spread, matching how
`modelId`/`providerId`/`cluster` are already handled), so an unbudgeted run
reaches the executor as unbudgeted rather than as a number this layer invented.

**`src/run/coordinator.ts` — parent run.** `startParentRun` passes
`run.limits.maxCostUsd` to the `ChildCoordinator` it constructs. Same
conditional spread.

**`src/run/child-coordinator.ts` — child attempts.** `ChildCoordinatorDeps`
gained an optional `maxCostUsd` (the run-level cap). A new private
`costCapFor(limits: ChildRunLimits)` returns the tighter of the task's own
`ChildRunLimits.maxCostUsd` and the run-level cap, or undefined when neither is
set; `runAttempt` puts that on the executor request. `Math.min` rather than
"child wins": a per-task budget should not be able to buy its way past the
run's ceiling, and a run cap should not loosen a task that asked for less.
That is cap *selection* in the coordinator, not gate arithmetic — nothing in
`cost-gate.ts` or `pi-executor.ts` was touched.

The child's own `RUN_CREATED` payload now carries the same effective cap
(`{...defaultRunLimits(), maxCostUsd}`) instead of bare `defaultRunLimits()`,
so the child's event log records the ceiling it actually ran under rather than
implying it ran uncapped.

**`src/run/supervisor.ts`.** The `ChildCoordinator` built per supervisor round
gets `limits.maxCostUsd` from the same `RunLimits` it already reads
`maxConcurrentTasks` from.

## What this does *not* claim

These are the honest limits of the wiring, and they matter because a cap that
looks tighter than it is has the same failure mode the R2 gate was written to
avoid.

1. **Per-execution, not per-run.** `CostGate` is constructed once per
   `execute()` call. There is no cross-child accumulator, so a run capped at $X
   with N concurrent children bounds *each child* at $X, not the run at $X. The
   `ChildCoordinatorDeps.maxCostUsd` doc comment says this in place.
2. **Coordinator-level retries reset the ceiling.** `ChildCoordinator.runTask`
   calls `executor.execute()` once per attempt, and each call builds a fresh
   gate, so `maxAttempts: 3` under a $X cap can spend up to ~3·$X. Only the
   adapter's *internal* retry loop (`runWithRetry`) shares one gate across its
   attempts. I did not change this: making the ceiling survive attempts means
   either a gate that outlives one `execute()` call or a spend ledger threaded
   back through the request, which is a contract change beyond this lane.
3. **No caller sets a cap yet.** `src/cli/main.ts:860` calls `startRun` without
   `limits`, and nothing in `src/` writes `maxCostUsd` into a `RunLimits`. The
   path is live for programmatic callers of `startRun` / `startParentRun` /
   `runSupervisorRounds` and for `ChildTaskInput.limits.maxCostUsd`, which the
   flowchart clustered path supplies for free through the ChildCoordinator
   change. A CLI flag would be the next step and is another agent's file.
4. **A disarmed cap is still silent.** `PiExecutorOptions.onCostGate` is the
   only way to learn that a requested ceiling could not be priced, and
   `createConfiguredPiExecutor` in `src/pi-adapter/runtime.ts` neither accepts
   nor forwards it. So with the cap now forwarded, an unpriced model will
   ignore the ceiling with nothing in the log to say so. Wiring `onCostGate`
   into the event log is the obvious follow-up; `runtime.ts` and `main.ts` were
   not mine this round.

## Deliberately not touched

- `src/run/flowchart-executor.ts` (`executeFlowchartNode`) is the third
  `execute()` call site. Its input carries no limits, its caller
  (`flowchart-run.ts`) builds `Run.limits` from `defaultRunLimits()` plus
  `FlowchartRunLimits`, and `FlowchartRunLimits` has no cost field — so there
  is no cap to forward there today. Adding the parameter would be dead code
  until a flowchart run can express a budget.
- `src/pi-adapter/**` — the gate and its arithmetic are unchanged.
- Overlay (`.agents/skills/**`) — out of lane.
- Test files — R3-gpt-A owns the forwarding tests.

## Evidence

`pnpm typecheck` clean. `node scripts/run-tests.mjs`: 1448 tests, 1447 pass,
0 fail, 1 skipped (the pre-existing `steer-inflight` skip, R3-opus-B's).
`eslint` clean on the three changed files.

Behaviour was checked with a scratch script (`/tmp/verify-cost-forward.mts`,
not committed — the test files belong to another lane) that drives real
`startRun` / `startParentRun` against a request-recording executor:

```
ok: root run without a cap sends no maxCostUsd
ok: root run forwards run.limits.maxCostUsd
ok: child run=undefined child=undefined -> undefined
ok: child run=2 child=undefined -> 2
ok: child run=undefined child=0.5 -> 0.5
ok: child run=2 child=0.5 -> 0.5
ok: child run=0.5 child=2 -> 0.5
```

Each child case also asserts that the `CHILD_RUN_CREATED` payload's
`limits.maxCostUsd` matches the cap that reached the executor, so the log and
the request cannot drift apart. The first and third lines are the ones that
matter most for the "no invented prices" rule: with no cap named anywhere, the
request has no `maxCostUsd` key at all, which is what keeps the gate reporting
`no-cap` rather than pretending to enforce something.

No git commit, per the round protocol.

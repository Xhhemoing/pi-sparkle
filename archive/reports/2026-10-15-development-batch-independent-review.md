# Independent review: development batch and review interfaces

- Date: 2026-10-15.
- Reviewer: research agent; no implementation ownership of the stage-three batch, CLI, store cancellation, controller references or candidate review modules.
- Baseline: `726e5e5519aabf74fcb6699c64b268d401a2cefd`.
- Controlling plan: [bounded development batches and candidate evidence review](../superpowers/plans/2026-10-15-development-batch-review.md).

## Design review

Verdict: PASS for implementation, not implementation acceptance. The additive finite serial batch and historical evidence review address the continuation plan without changing host acceptance, source integration or unknown-effect recovery authority. No live provider trial is needed to verify these mechanisms.

The reviewer read the controlling plan, current work-item/store/controller/CLI APIs, native loop artifact producer and artifact reader, and the continuation guide. No tests were run for this design verdict. No credentials were read, model calls made, package-manager commands run or runtime source edited.

The following interface conditions will be checked against the final implementation:

1. Cancellation before claim publication creates no claim/action. Once publication commits, the claim token must return to the controller for fenced settlement rather than disappearing behind a cancellation exception. Queue readiness publication needs the same explicit commit boundary.
2. Deadline and caller cancellation signal operations to stop, then await their actual settlement. No race may return while a resolver, claim or worker can continue operating detached. Synchronous Git and persistence/cleanup tails retain the documented cooperative deadline limitation.
3. Batch admission inspects all visible running task claims and running/needs-reconciliation effects, not just the next selected item. Without a global lifecycle lock this is an observed-state admission rule, not a claim of global serialization or a cross-worker quota.
4. Legacy receipts with absent artifact references produce an explicit unavailable historical view. A declared artifact reference that is missing, corrupt or bound to another task/run/candidate is refused. Historical successful checks and serialized trusted metadata do not grant fresh acceptance authority.
5. New batch/review envelopes and flags remain additive. Existing run defaults, supported flags, JSON fields and exit behavior stay pinned. Review performs no checker/model execution or persisted-record mutation; batch performs no automatic accept, release, reconciliation or source application.

## Implementation review

Verdict: PASS after two scoped corrections. No remaining concrete blocking finding in the reviewed batch, CLI and store-operation interfaces. This reviewer edited only this report; implementation and regression changes were made by their respective authors.

Scope: `src/development/batch.ts`, `src/cli/development.ts`, `src/development/work-item-store.ts`, new batch/CLI/cancellation tests and their existing queue/CLI neighbors. Controller receipt/cancellation and candidate-review internals have separate independent reviews; their interfaces and the CLI review integration were exercised here, not substituted for those reviews.

### Findings and corrections

1. **P2, batch final observation:** after the last item, the batch read a snapshot containing a newly visible unknown effect but returned `max-items`; the CLI would return exit 0. An independent probe used a clean initial snapshot, one ready result and a final `needs-reconciliation` action. It observed `max-items` instead of `needs-reconciliation`. The author added a failing regression, then reused the same pending-effect/running-claim check before dispatch and after settlement. Final output retains the completed item while reporting the required reconciliation stop.
2. **P2, inherited store cancellation:** the store author identified that the option snapshot omitted inherited fields. The reviewer independently reproduced a real filesystem claim using `Object.assign(Object.create({signal: preAbortedSignal}), {owner, baseRevision})`: despite the aborted signal, a running claim was persisted. The author added two failing next/claim regressions and restricted options to ordinary or null-prototype objects. Inherited signals/accessors now fail before observation or mutation. The batch's own strict options preparation was already unaffected.

The final review confirms frozen batch options, shrinking positive per-item time allowances, shared cancellation, actual operation settlement without a batch `Promise.race`, fixed-source checks, observed global pending-state stops, explicit no-ready reporting, retained partial results, and no automatic acceptance/release/application. Existing run JSON keys/default limits and its rejection of batch-only flags remain pinned. Review is connected as a historical read-only command, with no injected model invocation and unchanged queue/action bytes in its integration test.

### Independent verification

Final command:

```sh
node --import tsx --test test/unit/development/batch.test.ts test/integration/development/batch.test.ts test/integration/cli/development-batch-review.test.ts test/integration/cli/development.test.ts test/integration/development/work-item-cancellation.test.ts test/integration/development/work-item-store.test.ts test/unit/development/work-items.test.ts
```

Result: **61 passed, 0 failed, 0 skipped**, exit 0, 4962.19 ms on Linux / Node 24.19.0. Log: `.agent_workspace/architecture-20261015/development-batch-independent-final.log`. Scoped `git diff --check` also passed. The suite includes real Git candidate creation, actual scoped writes and host commands, independent retained tasks, dependency waiting, unknown effects outside the selected task, actual queue lock contention and publication-boundary cancellation. Provider-facing factories are injected fixtures; no live provider was called.

Earlier independent runs: batch unit 10/10, store plus neighbors 25/25 before the review corrections, then standalone new CLI 11/11 and legacy CLI 9/9. An initial combined CLI invocation ended with incomplete output despite exit 0 and is not counted as a pass; the subsequent standalone runs and complete final 61-test run provide the accepted evidence. These overlapping totals are not additive.

Exact reviewed Git blobs, rechecked after final verification:

| File | Blob |
|---|---|
| `src/development/batch.ts` | `21ef3c91ee49c2ecccb97f5d65e0a22e0844115c` |
| `src/cli/development.ts` | `224b894f24c806dd27b13ffa46a39657cb757fbc` |
| `src/development/work-item-store.ts` | `7b19f28ffdb81626c50f49ece87c180d1787689f` |
| `test/unit/development/batch.test.ts` | `910b6225a6ea5123c5f83e67af7c03fdc471622d` |
| `test/integration/development/batch.test.ts` | `e3d5529f168586fa0e517d0078941adf5eac377d` |
| `test/integration/cli/development-batch-review.test.ts` | `5657bee5e1f72f93226889e3c9195a5bbada7c94` |
| `test/integration/development/work-item-cancellation.test.ts` | `4e35adc1309bf61c7720f2f9aaddaf27852871f4` |

### Retained limits and handoff

The coordinator explicitly retained legacy store calls without an operation signal using their prior early timeout race. Signal-aware batch/controller paths instead await resolver settlement. The tests distinguish these cases; this review does not claim that all legacy callers have acquired cooperative settlement semantics.

Batch time limits request cooperative cancellation, not an OS deadline. Synchronous Git, noncooperative callbacks and persistence/cleanup may exceed the requested duration. Admission checks stop on visible pending work but do not make concurrent workers globally serial. No dollar-cost cap, automatic trusted-candidate application or live-model effectiveness is claimed. The coordinator owns the final combined gate, source commit/tree binding, hosted verification and stage save.

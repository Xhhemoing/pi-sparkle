# Advance a project once

`advanceProject(controller, options)` in `src/development/advance-project.ts` performs at most one call to the existing controller's `runNext`. Supply a host-owned controller exposing `status`, `currentSourceRevision` and `runNext`; options are the existing optional `maxAttempts`, `maxWallTimeMs` and `signal`.

The returned object contains frozen, detached `before` and `after` progress summaries and the original controller `result`. Summaries include source revision, queue counts and action-state counts. Reads are descriptive observations, not an atomic queue/source snapshot or permission to execute. Another host may change state between reads.

A pre-aborted signal returns `cancelled: true` without calling `runNext`. Cancellation during an operation waits for the controller to settle before returning its original result and updated progress. `cancelled` describes the supplied signal; consult the original result for worker/deadline/reconciliation outcomes. Malformed options are rejected before reading progress or dispatching.

Progress and controller errors propagate without an automatic retry. In particular, a failed after-progress read can reject after the controller operation has already settled; inspect the existing controller queue/action records before retrying. A rejected wrapper is not evidence that no work occurred.

This function does not claim tasks itself, accept candidates, apply edits, schedule another iteration or treat project progress as completion. Concurrent callers use the controller's existing atomic claim/admission behavior. Accepted but unintegrated dependencies remain blocked by the existing verifier. An unresolved overlapping running claim remains held; its existing `no-ready-task` result is preserved. A queue with no runnable work dispatches no worker.

Verification: `pnpm test --test-concurrency=1 test/integration/development/advance-project.test.ts test/integration/development/batch.test.ts test/unit/development/batch.test.ts`. See [the staged evidence](reports/2026-10-19-staged-continuation.md) for actual checks and review status.

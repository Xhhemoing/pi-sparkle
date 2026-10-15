# Additive development batch/review CLI

- Task: B3-05; owner: runtime agent; state: ready-for-review.
- Baseline: `726e5e5519aabf74fcb6699c64b268d401a2cefd`.
- Controlling [plan](../superpowers/plans/2026-10-15-development-batch-review.md)
  and [checklist](../../tasks/development-batch-review-todo.md) read before edits.
- Scope: `src/cli/development.ts`, one new batch/review integration test, this
  report. No existing tests, native/controller implementations or SDK duplicates.

## Acceptance and test-first sequence

Add explicit `batch --max-items` and read-only `review --action` over the new
development SDKs. Keep existing run/status/other envelopes and fields unchanged.
Batch uses DEVELOPMENT_BATCH_RESULT, explicit fake/Pi, the same scoped tools,
invocation telemetry and process cancellation as run. Validate all flags before
state changes. Normal limit/no-work stops return zero; other stops return one.
Defaults: attempts 3, per-item and total deadline 600000 ms; bounded SDK limits.
Review returns historical evidence only and performs no checker/model/apply.

Write integration assertions before implementation, then observe RED and GREEN.
Cover independent serial items, blocked first item, malformed flags with exact
unchanged queue bytes, old run shape, real factory/tool wiring without live
calls, and read-only review. Independent review/full gate remain root-owned.

Initial test launcher probe could not import `tsx` because dependency recovery
is in progress. This environment failure is not a behavior RED or test pass.
Only direct Node commands are used; no dependency-manager or live-model calls.

## Current evidence

After the coordinating agent restored the locked dependencies, the new CLI
integration suite ran against the unchanged CLI: **RED 1 pass / 6 fail**. The
old run shape already passed; missing batch/review dispatch/help and batch
envelope assertions failed. Captured in
`.agent_workspace/executor-fallback-audit/development-batch-cli-red.log`.

The CLI source delegates batch/review through dynamic SDK imports and shares
run's model factory, telemetry flush and signal/finally path. The original run
result construction remains unchanged. Added tests also cover normal no-ready
stop, visible unknown effects, cancellation propagation and review-only flags.
Intermediate missing/placeholder SDK failures remain separately recorded in
`development-batch-cli-progress.log`; they are not counted as passes.

After the SDK implementations became available, the complete new and existing
CLI suites passed **20/20**, zero failures/skips (11 new cases, 9 unchanged prior
cases). The real-Git review test uses an actual controller/native result with
final/loop references, observes available historical evidence and one attempt,
and confirms exact queue/action bytes and source checkout remain unchanged.
The Pi-mode fixture performs two actual scoped candidate writes serially through
an injected executor factory; it is offline wiring evidence, not a model trial.

```sh
node --import tsx --test \
  test/integration/cli/development-batch-review.test.ts \
  test/integration/cli/development.test.ts
```

Current output: `.agent_workspace/executor-fallback-audit/development-batch-cli-green.log`.
Changed-file ESLint, `node scripts/workflow-check.mjs` and `git diff --check`
pass. Repository `tsc --noEmit` found no CLI diagnostics, but initially failed
on two concurrently authored batch unit-test fixture types (an optional itemId
and a deliberately invalid accessor input); these were reported to their root
owner rather than edited outside this slice. Evidence is retained in
`development-batch-cli-types.log`; final combined typecheck/full gate belongs
to the coordinating agent.

## Compatibility and limits

Batch requires `--max-items` 1..8. Total and per-item wall time each default to
600000 ms and cap at 1800000; attempts default to 3 and cap at 5. Its report
uses DEVELOPMENT_BATCH_RESULT and the SDK's unchanged limits/results/summary.
Only max-items and no-ready-task stops return exit zero; all other batch stops
return one. Parsing failures also use the batch envelope. Existing commands,
including run errors and exact successful run fields/defaults, keep the old
DEVELOPMENT_RESULT envelope. No existing test was edited.

Review returns the SDK's bound historical report under DEVELOPMENT_RESULT with
command review. It supplies no executor, and refuses execution-only flags.
It confers no acceptance, application or current-candidate validity. Batch
remains cooperative and local to one serial invocation; cleanup can exceed
the deadline, and neither a global worker quota nor dollar ceiling is claimed.
Independent reviewer owns final contract review; root owns aggregate/hosted
verification, common documentation and the saved checkpoint.

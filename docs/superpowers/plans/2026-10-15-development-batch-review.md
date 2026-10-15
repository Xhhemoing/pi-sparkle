# Bounded development batches and candidate evidence review

## Identity

- ID: TASK-20261015-development-batch-review
- Owner: root coordination, file-disjoint implementation and independent reviewers
- State: in-progress
- Baseline: PR #60, `726e5e5519aabf74fcb6699c64b268d401a2cefd`; previous DP source and five hosted jobs verified
- User direction: continue the project plan and preserve staged results

## Problem and scope

The development controller can produce one candidate per invocation. Continuous host-controlled progress needs a finite serial batch and an explicit evidence entrance for review. Existing candidate listing contains checkpoints only; controller receipts omit final/loop artifact locators. Cancellation currently checks only the entry boundary and does not reach selection/claim evidence verification.

Implement optional operation signals for selection/claim/publication, cancellation fences around controller awaits, explicit final/loop receipt references, a read-only bound candidate review API/CLI, and an additive finite batch SDK/CLI. Preserve old run output and old receipt compatibility. Do not change selector dependency/scope policy, automatic acceptance, source application, release, production/experimental gates or credential settings. No global long-lived lifecycle lock is introduced; serial means one invocation, not a global cross-worker quota. Existing claim/action fencing continues to govern concurrent workers.

## Acceptance Criteria

- [x] B3-01: pre-claim cancellation creates no claim/action; a committed claim returns its token and receives fenced cleanup, never a detached late write. Signals reach accepted-evidence resolvers and final queue publication.
- [x] B3-02: durable effect receipt retains explicit final artifact and loop artifact references, including unsuccessful outcomes. Old receipts lacking refs remain readable as unavailable, without directory scanning or new acceptance authority.
- [x] B3-03: review by action checks task/action/claim/base/run/candidate bindings, bounded artifact structure and stable queue/action versions; emits historical per-attempt observations and explicit not-reverified semantics. It runs no checker/model, changes no persisted record, and refuses corrupt/missing/stale evidence.
- [x] B3-04: a finite batch performs at most eight requested items, serially, from one fixed source revision, with a shared cooperative wall-clock deadline and remaining per-item limits. Only ready-for-review permits continuing. Visible unknown effects/running claims, blocked outcome, cancellation, source drift, no ready work or exhausted limits stop dispatch.
- [x] B3-05: develop batch/review are additive, require explicit executor for execution, preserve old run JSON/flags, and report candidates/results/stop reason with no automatic accept/apply. Real-provider use remains opt-in and scripted results remain separate.
- [ ] B3-06: independent review, full gate/probes, real-Git demonstration and exact saved source tree/hosted cross-platform evidence.

## Ownership and interfaces

| Slice | Files / owner |
|---|---|
| Store operation cancellation | work-item-store.ts and new focused store tests / baseline |
| Controller fences and receipt references | controller.ts and new focused controller tests / native loop agent |
| Candidate review | candidate-review.ts and new tests / cleanup agent |
| Optional bounded artifact reads | execution/loop-artifact.ts and focused tests / exact-snapshot agent, delegated by cleanup; existing defaults unchanged |
| Batch SDK | batch.ts and new tests / root |
| Additive CLI | cli/development.ts and new batch/review CLI tests / runtime agent |
| Docs, status matrix, demo, gate, staged delivery | root; research independent review |

Stable additions: `next({signal?})`, `claimNext({owner,baseRevision,signal?})`, optional fifth markReady signal; controller `currentSourceRevision(): string`; receipt `finalArtifactRef: runId/artifactId` and optional `loopArtifactRef: runId/artifactId`. Candidate review accepts `{sourceRepo,queuePath,stateRoot,actionId}`. Batch SDK `runDevelopmentBatch(controller,{maxItems,maxWallTimeMs,maxAttempts?,perItemWallTimeMs?,signal?})`: maxItems 1..8, total/per-item milliseconds 1..1800000, attempts 1..5. CLI batch requires --max-items and supports --max-total-wall-time-ms; original --max-wall-time-ms remains per-item. Default attempts 3, per-item/total 600000 ms. New batch result type DEVELOPMENT_BATCH_RESULT; old DEVELOPMENT_RESULT remains unchanged. Review is a historical snapshot, not new acceptance or current candidate validity.

Bounded review requires an additive fourth `readLoopArtifact` options argument with artifact byte and event-log byte/record limits. The opt-in reader validates options, refuses linked/nonregular files, reads from an opened descriptor into a capped buffer and forwards log limits to existing `EventStore.readAll`; no-options callers retain existing behavior. Candidate review supplies 512 KiB artifact and 2 MiB / 10000-record event-log limits. Existing initialized-run identity and torn-tail policy remain authoritative. This ownership extension was approved before implementation; focused RED/GREEN and independent review are required.

## Test-first and gates

Record RED before new behavior, then real focused GREEN. Cover cancellation during selection/lock validation/claim commit, no replay after interruption, task scope and dependency retention, two independent retained candidates, shrinking remaining time, first-failure stop, unknown-effect admission, mutated options, stale/corrupt artifact and no state changes during review. Do not Promise.race controller/claim operations: wait for actual settlement. Deadline is cooperative; synchronous Git and cleanup/persistence tail may exceed it, and no dollar-cost ceiling is claimed.

Run original workflow/type/lint/test/build package commands and security/Pi/kernel probes; hosted Node22 and Ubuntu/Windows checks validate additive CLI/controller. Keep LIVE-01 blocked if no allowed model/budget is configured; do not fabricate trial results. Save before expanding another stage.

## Handoff and abort

Repository task documents remain roadmap authority; the runtime queue governs only its host-defined items. After a batch, review and host source integration remain explicit. Stop and record blocked/needs-reconciliation if evidence, source identity, tokens, verifier availability or actual effects are uncertain. Formal R10/R11, production, adaptive and holdout approvals remain open.

## B3-06 offline batch demonstration subtask

Owner: baseline agent. Before implementation, scope is only new `examples/development-batch-demo.mjs` and `docs/reports/2026-10-15-development-batch-demo.md`, plus this plan subtask. Use built `DevelopmentController`, `runDevelopmentBatch` and `reviewDevelopmentCandidate` with a retained temporary Git repository containing two independent host-authored tasks and protected real checker files. A clearly scripted executor writes an incorrect result on each first attempt, then repairs from actual failed host feedback. A two-item batch must leave both candidates `ready-for-review`, with zero explicitly accepted tasks and no source application.

Review both completed action receipts and assert historical attempt outcomes `[false, true]`, explicit artifact references, unchanged queue/action bytes across review, retained candidates, and unchanged source HEAD/content/checkers/clean status. Do not invoke host acceptance or application and do not introduce checker side-effect counters. Record observed `performance.now()` and batch elapsed time, zero live-model calls, and unknown cost; do not infer model effectiveness or measured zero cost. Run direct Node TypeScript build, built demo, focused example lint, workflow and whitespace checks; retain real output and request independent review/execution before staged delivery.

Author result: direct build, built demo, focused lint and workflow all PASS. Both tasks reached ready-for-review after actual host checks `[1, 0]`; accepted count zero, source unchanged, both candidates retained. Batch elapsed 1013.80035 ms; measured batch-through-review/assertions duration 1088.58488 ms; live calls zero, cost unknown. Evidence and retained paths: [dated demo report](../../reports/2026-10-15-development-batch-demo.md). Frozen example blob `ad74b93e9df8cc95cf325d19fe726ebb855c9eb2`; independent review/execution requested before closeout.

Independent closeout: research agent's source review and separate built-demo execution PASS on that exact blob. Independent batch elapsed 869.663136 ms, total 934.146428 ms; ready two / accepted zero, both `[false, true]` histories and `[1, 0]` real check exits, unchanged source/review snapshots, retained candidates, no live calls and unknown cost all confirmed. Report contains the separate run output and retained fixture identities. This completes the demonstration subtask; aggregate/hosted verification and staged delivery remain coordinator-owned.

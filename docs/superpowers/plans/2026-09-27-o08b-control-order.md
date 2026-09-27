# O08b deterministic control queue ordering

## Identity

- ID: `TASK-20260927-o08b-control-order`.
- Owner: this chat; implementation/review subagents have disjoint ownership.
- State: `accepted` for the bounded O08b slice on 2026-09-27; integration and publication remain pending.
- Source revision: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669` plus independently developed O09 (unrelated files).
- Parent: [reliability O08b](2026-09-27-reliability-optimization.md#o08--event-buffering-and-control-ordering).
- Authority: [architecture](../../specs/m0-m2-architecture.md), [ADR-002](../../decisions/0002-event-log-and-checkpoints.md).

## Problem and Scope

`listPending` orders pending requests by random filename/UUID. An earlier completed inject submission can therefore follow a later pause; pause ends the drain and can leave the inject unapplied. The current runtime makes no strict FIFO promise. The integration coordinator assigned this chat exclusive O08b ownership after O09.

In scope: order one pending snapshot by `(Date.parse(submittedAt), requestId)`, with code-unit ID comparison; regression tests of persisted requests, actual run drain/events and acknowledgements. Out of scope: strict global submission/completion FIFO, persistent sequence allocation, format migration, clock synchronization, long locks, live providers and unrelated control bugs.

## Ordering decision before implementation

Use declared submission instants interpreted at **millisecond precision**, then request ID as deterministic tie-break. Equivalent ISO timezone offsets compare as the same instant; valid fractional seconds beyond milliseconds are intentionally truncated by the existing JavaScript timestamp interpretation and then tie-break by ID. Never use raw ISO lexical comparison. Within a loaded snapshot, all parsed messages follow this rule; requests appearing after the directory listing belong to a subsequent snapshot.

This is deterministic ordering, not FIFO for equal milliseconds, concurrent submissions, clock rollback, or delayed publication. With distinct increasing timestamps, a completed inject submitted before pause is applied first. Existing schema, random IDs, file publication, single writer and ack/stop rules remain unchanged. No new sequence store, transaction, hash or gate is required for this bounded promise.

## Acceptance Criteria

- [x] RED: reverse-sorted IDs with ascending distinct timestamps return inject then pause.
- [x] Same millisecond, concurrent submit, submillisecond differences and equivalent/different timezone offset cases explicitly exercise the chosen ordering.
- [x] Actual flowchart/CLI drain emits injection before pause, acknowledges both as applied, and preserves the injected fact. Assertions must check events/ack/pending state, not only a mocked sort.
- [x] Caller-provided clock rollback is represented honestly: timestamp order can differ from completion order.
- [x] Existing pause/inject refusal, terminal state and ack behavior do not regress.
- [x] Focused tests, separate specification then quality reviews, existing workflow/gate results and limitations are saved.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/run/control-plane.ts::listPending` | sort parsed requests by instant then ID | O08b implementer | changes deterministic request order only |
| `test/unit/run/control-plane-single-writer.test.ts` | controlled clocks/IDs and queue semantics | O08b implementer | no public schema changes |
| `test/integration/cli/pause-inject.test.ts` | real persisted queue, drain and ack regression | O08b implementer | fake/local fixtures only |
| dated plan/report | exact contract and evidence | coordinator | stage remains O01-O11 |

`src/run/flowchart-run.ts` is read-only unless a separately reproduced drain defect requires a minimal change and the integration owner confirms ownership first. A live/resume drain can demonstrate order without changing idle drain stop behavior; do not broaden the fix silently.

## Test-First Plan

- RED before production: persisted reverse IDs plus actual drain/ack ordering; record failure output.
- Focused: `pnpm test -- --test-concurrency=1 test/unit/run/control-plane-single-writer.test.ts test/integration/cli/pause-inject.test.ts`.
- Adjacent run/control tests selected by actual imports, then `pnpm workflow:check` and existing `pnpm gate` in the coordinated single full-suite lane.
- Raw logs: `.agent_workspace/verification/2026-09-27-o08b/`.

## Gates and Handoff

No new gate or frozen contract is introduced. Existing event persistence, lifecycle locks and validation are retained. S0-min, R10/R11, F6 and production/provider/holdout approvals remain separate. Roll back only this slice's Git changes if behavior fails, never persisted user state.

The other chat owns aggregate active-task/status updates, local merge, workspace preservation/cleanup and GitHub publication. This chat supplies reviewed commits and [verification](../../reports/2026-09-27-o08b-control-order.md).

## Closeout

- Verified date: 2026-09-27. The exact integration commit is recorded in the linked verification report once created; this plan does not claim a GitHub merge.
- Author RED: `pnpm test -- --test-concurrency=1 test/unit/run/control-plane-single-writer.test.ts test/integration/cli/pause-inject.test.ts` — 47 pass / 5 expected fail. GREEN: same command — 52 pass / 0 fail / 0 skip.
- Independent specification and quality reviews: PASS, each independently reran the 52-test focused command; quality review also ran `pnpm workflow:check` and scoped `git diff --check`.
- Coordinator gate: `pnpm build` then `pnpm gate` — both exit 0, 2907 pass / 0 fail / 18 skip on the combined O09/O08b branch. The prebuild is disclosed because this branch predates the separate clean-tree holdout-import repair.
- Evidence: [O08b verification](../../reports/2026-09-27-o08b-control-order.md). No strict FIFO, cross-snapshot ordering, or clock-integrity claim; no human, provider, holdout or production gate is closed.
- Next owner: overall reliability integration chat for cherry-pick/merge, combined verification on its branch, GitHub push, and later safe worktree cleanup.

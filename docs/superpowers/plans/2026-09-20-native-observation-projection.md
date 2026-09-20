# Task Plan: Native worker observation projection (context efficiency wiring)

## Identity

- ID: `TASK-20260920-native-observation-projection`
- Owner: main agent session (implementation)
- State: `in-progress`
- Date opened: 2026-09-20
- Related: [native Pi plan](2026-09-18-native-pi.md) ("live observation projection/recall"); [PR-B row](../../status-matrix.md) ("Not wired into live Pi executor/CLI"); [TASK-20260920-native-delegate-routing](2026-09-20-native-delegate-routing.md).

## Problem and Scope

### Problem

`ObservationStore` + `projectObservation` (PR-B, merged) are library-only: no live path calls them. Native workers reading the same large file repeatedly receive the full content every time, burning context tokens — the "context efficiency" program item is unrealized.

### In scope

1. **`src/pi-adapter/observation-tools.ts` (new)**: a `createObservationProjector(runId, { stateRoot, enabled })` helper that wraps any `AgentTool.execute` result text through `projectObservation` with a per-(runId, contentHash) `priorFullSends` counter held in memory. Projected results carry the existing placeholder (head/tail excerpts + `id`/`sha256` + recall pointer). The projector is run-scoped: archives land under the worker's own run subtree and vanish with `delete --run` (existing cascade).
2. **Recall tool `sparkle_recall_observation` (new, registered only when the projector is enabled)**: takes `id` + optional `offset`, resolves the archived object by in-memory ref (id → sha256), pages through `store.recall` (hash-verified). Never recalls another run's objects. Bounded page size.
3. **Wiring**: `NativeSession` creates the projector per run when enabled; `createNativeExecutor` passes it into the read tool's execute path. Enabled only when the caller passes an explicit `enabled: true` (default off, matching the PR-B `enabled=false ⇒ no archive` contract). `sparkle_delegate` gains an optional opt-in flag; default stays off.
4. **Tests**: projector RED→GREEN (first-two full, then placeholder, idempotent same-content reuse, error/receipt/small results never projected), recall tool paging + hash-verify + foreign-run refusal, disabled path byte-identical, live-isolation unchanged.

### Out of scope

- Any CLI wiring (CLI remains unchanged).
- Evidence receipts / error results — never projected (existing `isEligible` rules, no new ones).
- Cross-run recall, background timers, retention changes.
- F-PROD / adaptive selection (unrelated).

## Acceptance Criteria

- [x] Projector disabled path returns text unchanged and archives nothing; enabled path: first two sends full, then ≤2KiB placeholder with `[observation packed]` header and stable sha across repeat sends; ineligible (small/error/receipt) never projected; use-before-bind and double-bind refused; recall tool pages, matches archive bytes, refuses unknown ids. Evidence: [verification record](../../docs/reports/2026-09-20-native-observation-projection.md), commands table; focused unit runs 5/5, 28/28. Verified commit: pending merge.
- [x] Delegate-level: worker reads one >10KiB content three times through the real `NativeSession.delegate`; sends 1–2 full, send 3 placeholder, recall returns archive bytes, archives exist under `runtime/runs/<runId>/observations/`. Evidence: `test/unit/native/session.test.ts` "delegation with observation projection". Verified commit: pending merge.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/pi-adapter/observation-tools.ts` (new) | `ObservationProjector` + `createRecallTool`; pure wiring of existing library APIs | main agent | no new eligibility rules |
| `src/pi-adapter/native-executor.ts` | optional projector param; wraps `sparkle_read_file` result text | main agent | disabled path unchanged |
| `src/native/session.ts` | per-run projector when `enabled`; pass into executor input; runId available after `startParentRun`… **order problem**: projector needs runId before the run starts → derive projector from the stateRoot + a pre-generated runId passed by the caller (`delegate` creates it). | main agent | resolve at implementation |
| `extensions/pi-sparkle/index.ts` | opt-in flag on `sparkle_delegate` (default off) | main agent | thin adapter |
| tests (unit) | as listed in Test-First Plan | main agent | — |
| `docs/status-matrix.md`, `tasks/todo.md`, report | evidence | main agent | workflow:check |

## Test-First Plan

- Red tests: projector module missing (`ERR_MODULE_NOT_FOUND`); enabled projection sequence (full/full/placeholder); recall tool paging and foreign-id refusal; disabled identity.
- Focused command: `pnpm test test/unit/pi-adapter test/unit/context test/unit/native`
- Integration/acceptance: full serialized suite before delivery.
- Negative cases: store put failure → return original text (existing contract), recall of a non-archived id → clear error, oversized content → existing store cap.

## Gates and Handoff

- Human/policy gate: none (default-off wiring of an accepted library surface; no boundary change).
- Independent review: batch with the pending registration/routing re-dispatch when the relay recovers.
- Rollback/abort condition: any live-isolation allowlist change aborts the slice.
- Next command after handoff: serialized `pnpm gate`, deliver to main.

## Closeout

- Verified commit/date: 2026-09-20, `feat/native-observation-projection` (see [verification record](../../docs/reports/2026-09-20-native-observation-projection.md)).
- Commands and outcomes: serialized full suite 2826 pass / 0 fail / 18 skip; typecheck/lint/build/security:probe/pi:probe all pass; live-isolation unchanged (232).
- Deviations from plan: (1) runId pre-minting via `generateRunId` was rejected — the coordinator generator mints every run id; late binding after `startParentRun` instead. (2) Scope grew by one real library fix: observation store lock moved from the run lifecycle lock to a dedicated `observationLockPath` (live `put` silently timed out under the old lock; caught by the delegate-level test, root-caused by instrumentation).
- Open risks/follow-ups: CLI-side projection wiring, measured token deltas on real delegations, relay-blocked independent review (batched), global-config allowlists, F-PROD.
- Evidence links: [verification record](../../docs/reports/2026-09-20-native-observation-projection.md); [routing record](../../docs/reports/2026-09-20-native-delegate-routing.md); [outage record](../../docs/reports/2026-09-20-luna-dispatch-outage.md).

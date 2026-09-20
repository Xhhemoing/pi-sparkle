# Task Plan: Native delegate live-catalog routing (quality-first unified routing slice)

## Identity

- ID: `TASK-20260920-native-delegate-routing`
- Owner: main agent session (implementation)
- State: `planned`
- Date opened: 2026-09-20
- Related: [native Pi plan](2026-09-18-native-pi.md) ("common host catalogue routing with observed quality" next slice); [TASK-20260920-native-apply-registration](2026-09-20-native-apply-registration.md) (delivered `1707c8f`); [status matrix](../../status-matrix.md) R1/bandit row (shadow/offline only); `test/unit/routing/live-isolation.test.ts` allowlist contract.

## Problem and Scope

### Problem

`NativeSession.delegate` routes every delegated task to one fixed model: the extension resolves a single preferred model (`resolveNativeModel`), builds one executor, and stamps the same `assignedModel` onto all 1–4 children. The CLI path (`smartChildPlan`) instead analyzes each task (`analyzeTask`), applies the learned routing policy (`applyLearnedRouting`), and routes through the live catalog (`assignTasks` → `ModelRouter.route`, R0-equivalent static policy). Delegated work therefore never benefits from the project's learned routing policy, cost calibration, or catalog constraints — the "quality-first unified routing" program item is unrealized on the native path.

### In scope

1. **Host-catalog bridge**: build a `ModelRouterConfig` from the host's Pi model registry (the eligible model set the extension already computes) instead of only the single preferred model. Each host model becomes a `CatalogModel` row (roles/complexity/cost estimates mirror `routableFromListed` semantics; unknown pricing stays unpriced — never invented).
2. **Per-task routing inside `NativeSession`**: after the extension supplies an optional `NativeRoutingCatalog` (id → model metadata + preferred ref), `delegate` routes each child through the same `assignTasks`/`applyLearnedRouting` path the CLI uses, keyed by `analyzeTask(objective, role)`. The learned policy loads from the same adaptation registry (`loadLearnedRouting`) against the extension's state root.
3. **Multi-model executor**: extend `createNativeExecutor` so its provider bridge can resolve more than one model (per-model `resolveAuth` from the host registry). `PiAgentExecutor.resolveModel` already honors `request.modelId`/`providerId`, so the child coordinator's `assignedModel` flows through unchanged — no coordinator changes.
4. **Optional, not mandatory**: routing input is optional (`NativeRoutingCatalog` undefined ⇒ today's behavior exactly). No behavioral change for existing callers without a catalog.
5. Tests: routing matrix (learned policy avoid/prefer applied per family), catalog gap refusal parity (unknown model → clear error), regression that without a catalog the single-model behavior is byte-identical, and executor multi-model resolution over the host bridge.

### Out of scope

- **Live R1/bandit selection** — stays shadow/offline per Checkpoint F-PROD; `live-isolation.test.ts` must stay green with its current allowlist (this slice touches only `src/native/*`, `src/pi-adapter/native-executor.ts`, and tests; it imports `routing/assign.ts` + `learning/learned-routing.ts`, which are already in the live closure via `src/cli/main.ts`).
- **Main conversation model changes** — stays stable per owner decision.
- **Cost ceilings / cascade on the native path** — existing fake/`--children` semantics unchanged; not native-path scope here.
- **Write session routing** — `NativeWriteSession` keeps its executor-factory contract as is.
- **Global-config allowlists** — unchanged gate.

## Acceptance Criteria

- [ ] With a routing catalog supplied, two delegated tasks with different families route to different models when the learned policy (or static policy) dictates; `MODEL_ROUTED` events in the run log reflect per-task assignment. Verification: focused unit test asserting distinct `assignedModel` values from `assignTasks` output through `NativeSession`.
- [ ] Learned policy `avoid`/`prefer` entries are honored per family exactly as the CLI path applies them (`applyLearnedRouting` semantics: avoid filters, prefer wins, fallback chain identical). Verification: unit test with a synthetic learned policy.
- [ ] Without a routing catalog, `delegate` behavior is unchanged: all children get the single resolved preferred model, existing tests pass untouched. Verification: full native suite green before/after.
- [ ] `createNativeExecutor` resolves auth per request model through the host bridge; a model missing from the bridge refuses with a clear error before any provider call. Verification: unit test with two models, one refused.
- [ ] `live-isolation.test.ts` passes unchanged (no forbidden module enters the closure). Verification: `pnpm test test/unit/routing/live-isolation.test.ts`.
- [ ] Status matrix native-delegation row updated (routing note), plan/report/checklist evidence links complete. Verification: `pnpm workflow:check`.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/pi-adapter/native-executor.ts` | multi-model provider bridge: `models: readonly NativeModelBinding[]`, per-model auth resolve, clear refusal for unknown model | main agent | host auth reuse; no credential persistence |
| `src/native/session.ts` | optional `routing` input (`NativeRoutingCatalog` + learned policy loader); per-task `assignTasks` when present; disclosure line in result text | main agent | keep no-catalog path byte-identical |
| `src/native/routing-catalog.ts` (new) | host-catalog → `ModelRouterConfig` bridge; unpriced models get unpriced treatment, never invented costs | main agent | must mirror `routableFromListed` semantics |
| `extensions/pi-sparkle/index.ts` | build the catalog from `ctx.modelRegistry` (eligible set) and pass through; preferred-model fallback unchanged | main agent | thin-adapter rule: Pi types stay in this file |
| `test/unit/native/routing-catalog.test.ts` (new) | bridge unit tests | main agent | — |
| `test/unit/native/session.test.ts` | routing-matrix + no-catalog regression cases | main agent | — |
| `test/unit/pi-adapter/native-executor.test.ts` | multi-model bridge coverage | main agent | loopback |
| `docs/status-matrix.md`, `tasks/todo.md`, plan/report | evidence | main agent | workflow:check |

## Test-First Plan

- Red tests: (1) routing-catalog bridge module missing → `ERR_MODULE_NOT_FOUND`; (2) `delegate` with catalog + learned avoid on the default model routes the second task elsewhere; (3) multi-model executor unknown-model refusal.
- Focused command: `pnpm test test/unit/native test/unit/pi-adapter test/unit/routing/live-isolation.test.ts`
- Integration/acceptance: `pnpm test test/integration/native` (must stay green) and full serialized suite before delivery.
- Negative and recovery cases: catalog with empty eligible set (fail closed, no run started); learned policy hash mismatch (refused by existing `loadLearnedRouting`); provider missing for a routed model (clear error naming the model).

## Gates and Handoff

- Human/policy gate: none beyond existing standing scope (this changes routing *inputs*, not boundaries; no new mutable capability). F-PROD unaffected.
- Independent review: luna-fast when the relay recovers (same dispatch as the registration slice, batched if possible).
- Rollback/abort condition: any live-isolation allowlist growth or forbidden-module import aborts the slice.
- Required durable records: report under `docs/reports/`, status row note, checklist updates.
- Next command after handoff: `pnpm gate` (serialized test phase), then delivery.

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: live observation projection/recall; global-config allowlists; F-PROD.
- Evidence links: pending.

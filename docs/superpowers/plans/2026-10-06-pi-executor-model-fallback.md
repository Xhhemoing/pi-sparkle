# Task Plan: Pi Executor Model Configuration and Fallback

- ID: TASK-20261006-pi-executor-model-fallback
- Owner: agent
- State: planned
- Date opened: 2026-10-06
- Related: live-provider smoke (preview.3 install)

## Problem and Scope

### Problem

1. `run --executor pi` only honors `--primary-model` (mapped from `--primary-model` flag). There is no dedicated `--executor-model` flag, so an operator cannot configure the executor's model independently of the track router's primary.
2. When the configured executor model fails (e.g. xhh gateway returns 502 upstream auth expiry), the executor reports FAILURE. There is no fallback to a secondary model.

### In scope

- Add `--executor-model <provider/model>` flag on `run` (and `resume`) that pins the pi executor's model.
- Add fallback chain resolution in `PiAgentExecutor`: primary model first, then fallback list.
- Default fallback: `providers.json` fast model (existing `fast` field).

### Out of scope

- Changing fake executor.
- Changing the tracked-run routing planes (`--track`, `--flowchart`).
- Adding live provider credentials.

## Acceptance Criteria

- [ ] `run --executor pi --executor-model <ref>` configures the executor model; without the flag, providers.json primary remains the source.
- [ ] When the primary model fails (faux provider error), the executor falls back to the next model in the chain and completes successfully.
- [ ] Invocation records identify which model served each attempt.
- [ ] Focused tests demonstrate both behaviors.

## Implementation Slice

| File/symbol | Change |
|---|---|
| src/cli/main.ts | Add `--executor-model` flag; pass to `createExecutor` as a distinct `executorModelOverride` |
| src/pi-adapter/pi-executor.ts | Accept `fallbackModelId` option; on provider failure after retry cap, retry with fallback model |
| test/unit/pi-adapter/executor-retry.test.ts | New cases: fallback chain works; invocation records reflect attempted models |

## Test-First Plan

- Red test: primary fails, fallback succeeds → executor outcome SUCCESS, invocations record both models.
- Red test: `--executor-model` accepted by run; without it, no change to default path.
- Focused: `node scripts/run-tests.mjs test/unit/pi-adapter/executor-retry.test.ts`
- Integration: `pnpm gate`

## Gates and Handoff

- Required durable records: this plan + implementation report.
- Next command after handoff: `pnpm gate`

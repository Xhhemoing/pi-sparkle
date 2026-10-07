# Task Plan: Pi Executor Model Configuration and Fallback

- ID: TASK-20261006-pi-executor-model-fallback
- Owner: agent
- State: ready-for-review
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

## Closeout — 2026-10-07

Implementation was reviewed and completed on merged main `98af1b5928956de531280addae2ae1a847518eec` as PR #59. `--executor-model` is parsed for both `run` and `resume`, with precedence over `--primary-model`, ambient `PI_PROVIDER`/`PI_MODEL`, and `providers.json`; without the flag the default resolution is unchanged. The pi executor resolves the primary model first, then catalog-resolved fallback entries. `--executor-model` is recorded as the serving identity. When providers declare a fast alias that differs from the selected executor model override (or the selected `--primary-model` fallback), it becomes the first fallback; catalog entries that do not resolve are skipped, and skipped entries do not issue a call.

The final default fallback decision remains a product/policy review point. The current implementation emits one validated invocation record for each attempted model with the model identity and terminal call outcome, but does not add a separate operator-facing opt-in or stderr disclosure. No production, outcome-support, live-provider, or independent-review claim follows from the author verification below.

## Verification record — 2026-10-07

- Commit: `98af1b5928956de531280addae2ae1a847518eec`
- Environment: Windows, Asia/Shanghai; local repository worktree.
- Reviewer/owner: author verification only; independent review remains open.

| Command | Result | Notes |
|---|---|---|
| `pnpm test test/unit/pi-adapter/executor-fallback.test.ts test/unit/cli/resume-executor-config.test.ts` | `PASS` | 12 tests / 12 pass / 0 fail / 0 skip; includes fallback success, no-fallback-on-success, and invocation-model attribution. |
| `pnpm lint` | `PASS` | No findings. |
| `pnpm typecheck` | `PASS` | No findings. |
| `pnpm test` | `PASS` | 3274 tests / 3255 pass / 0 fail / 19 skip. |
| `pnpm build` | `PASS` | TypeScript build completed. |
| `pnpm workflow:check` | `PASS` | 10 required files and 16 required headings. |
| `git diff --check` | `PASS` | Documentation closeout worktree. |

### Verification boundary

- Not run: live-provider end-to-end, security probe, and prerelease-class probe suite.
- Not closed: independent review, owner review of default fallback, production authorization, and Outcome-supported status.

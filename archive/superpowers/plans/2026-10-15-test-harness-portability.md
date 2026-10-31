# Test harness portability

## Identity

- ID: `TASK-20261015-test-harness-portability`
- Owner: baseline/test-harness agent
- State: `ready-for-review`
- Date opened: 2026-10-15
- Contract: existing `pnpm test`, Node test flags, explicit file/directory selection and failure exit propagation.

## Problem and Scope

The standard test wrapper and two CLI integration launchers start the optional tsx CLI IPC server. Unix socket restrictions prevent the child application/test runner from starting. Baseline logs show `EPERM` before test execution; eight telemetry CLI assertions and the migration crash test are affected.

In scope: invoke Node with the supported tsx registration hook, explicitly discover default TypeScript tests, retain existing directory expansion and Node test flags, and exercise the wrapper's selection/failure behavior. Update only test infrastructure and dated evidence.

Out of scope: runtime product code, package/dependency versions, build-script approvals, CI permissions, test assertions or skip policies.

## Acceptance Criteria

- [x] Default invocation discovers the repository's `test/**/*.test.ts` files without depending on Node's version-specific TypeScript discovery; wrapper integration regression passes (2026-10-15 report below).
- [x] Explicit file/directory selection and Node test flags remain effective; failing tests produce a nonzero wrapper exit; focused 18/18 passes.
- [x] The telemetry CLI and migration crash assertions run unchanged without requiring the tsx CLI IPC listener; focused 18/18 passes.
- [x] Focused verification and the applicable standard test command are recorded; hosted Node 22/Windows verification is kept separate.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `scripts/run-tests.mjs` | Node `--import` hook; explicit default test discovery | baseline agent | flag/selection compatibility |
| `test/integration/telemetry/harness-efficiency-cli.test.ts` | subprocess launch only | baseline agent | preserve assertions |
| `test/integration/cli/migrate-legacy.test.ts` | subprocess launch only | baseline agent | preserve SIGKILL window assertion |
| `test/integration/tooling/run-tests.test.ts` | wrapper behavior regression | baseline agent | isolated tiny fixture tests |

## Test-First Plan

- Existing RED evidence: `.agent_workspace/architecture-20261015/baseline-direct-gate.log` and `baseline-clean-tests.log` at baseline `44db4b1`.
- Additional RED: wrapper integration scenarios for default discovery, focused selection/flags and failure exit.
- Focused command: `node --import tsx --test test/integration/tooling/run-tests.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts test/integration/cli/migrate-legacy.test.ts`.
- Delivery: direct pinned pnpm executable runs `test`; root owns the final integrated gate.

## Gates and Handoff

- No product permission changes or policy gate closures.
- Abort/rollback if selection changes omit intended tests or assertions require weakening.
- Supported mechanism: official tsx [Developer API](https://tsx.is/dev-api/) and [Node CLI documentation](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md) document `node --import tsx`; the latter uses deprecated `--loader` only for Node <=20.5.1. Retrieved 2026-10-15. Node 22.19.x remains the hosted CI target; local runtime is Node 24.19.0.

## Closeout

- Verification report: `docs/reports/2026-10-15-test-harness-portability.md`.
- 2026-10-15: direct Node and standard pinned-pnpm focused commands each pass 18/18; affected ESLint and whole-project typecheck pass. Root owns the final integrated gate. Hosted Node 22/Windows remains unverified locally.

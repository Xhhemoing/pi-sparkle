# Test harness portability verification

## Identity

- Task: `TASK-20261015-test-harness-portability`; parent baseline `44db4b15078ccce9b1c191d29fec438af044a95c`.
- Date/environment: 2026-10-15, Linux, Node v24.19.0, pnpm 10.17.1.
- Author: baseline/test-harness agent; independent review is not claimed.
- [Plan](../superpowers/plans/2026-10-15-test-harness-portability.md).

## Commands

| Command | Result | Notes/evidence |
|---|---|---|
| Baseline `node scripts/run-tests.mjs` | FAIL — environment | tsx CLI attempts an unavailable Unix IPC bind before the test runner starts; `baseline-direct-gate.log` |
| Baseline detached-source `node --import tsx --test <371 explicit test files>` | 3256 pass / 9 fail / 1 skip | Eight telemetry subprocesses fail on IPC; migration subprocess never starts copying. Fixed baseline source, separate from other agents' RED tests; `baseline-clean-tests.log` |
| Before implementation: `node --import tsx --test test/integration/tooling/run-tests.test.ts` | RED — 0 pass / 4 fail | IPC startup fails before the intended test assertions; `test-harness-red.log` |
| `node --import tsx --test test/integration/tooling/run-tests.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts test/integration/cli/migrate-legacy.test.ts` | PASS — 18 / 0 / 0 | `test-harness-focused-green.log` |
| `node /opt/codex/tools/pnpm/bin/pnpm.cjs test -- test/integration/tooling/run-tests.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts test/integration/cli/migrate-legacy.test.ts` | PASS — 18 / 0 / 0 | Runs the unchanged package test script using pinned pnpm; `test-harness-pnpm-focused.log` |
| `node node_modules/eslint/bin/eslint.js scripts/run-tests.mjs test/integration/tooling/run-tests.test.ts test/integration/telemetry/harness-efficiency-cli.test.ts test/integration/cli/migrate-legacy.test.ts` | PASS — exit 0 | No diagnostics |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS — exit 0 | No diagnostics |

All log paths above are beneath `.agent_workspace/architecture-20261015/`. This report records focused author verification; the root delivery report owns the final integrated gate.

## Behavioral Evidence

The test wrapper now starts Node with the supported tsx import registration hook and explicitly enumerates `test/**/*.test.ts` when callers supply no test selection. Directory/file selection remains explicit; common Node test flags accept both separate and equals-form values. Paths are passed as argv entries without shell interpretation. A failed child test keeps a nonzero exit.

Four new fixture-based integration tests exercise default nested TypeScript discovery/helper exclusion, flags-only name filtering, explicit directory selection excluding unrelated tests, and explicit file failure propagation. These execute the actual wrapper instead of mocking its spawn call.

The two existing CLI integration suites change only the subprocess launch arguments. The telemetry privacy/error assertions and migration SIGKILL/recovery assertions are unchanged. Their passing run demonstrates the earlier nine failures were launcher/environment failures, not application regressions.

The hook is documented upstream in [tsx Node CLI documentation](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md), retrieved 2026-10-15. The official documentation specifies `--import` for current Node versions and labels `--loader` deprecated for Node <=20.5.1. The resolved module URL keeps the wrapper usable when fixture working directories do not have their own dependency installation.

## Risks and Gates

- Local runtime is Node 24.19.0; existing hosted CI must verify Node 22.19.x and Windows. No hosted pass is inferred here.
- Default discovery intentionally follows the repository's existing `*.test.ts` convention under `test/`; all 371 baseline test files match it. Explicit directory expansion keeps the same convention it had before this change.
- No runtime product code, dependency version, package script, CI permission, build approval, test assertion or skip policy changed.
- New Node flags that consume separate values should be added to the wrapper's option-value set; equals-form flags pass through without that maintenance.

## Handoff

- Root runs/reports the final integrated gate after the other source slices finish, using the pinned pnpm executable to avoid the environment's dependency-install wrapper.
- Hosted Node 22/Windows verification remains separate from these local results.

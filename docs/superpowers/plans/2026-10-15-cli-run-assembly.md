# CLI run assembly extraction and configured fallback wiring

## Identity

- ID: `TASK-20261015-cli-run-assembly`; owner: runtime agent.
- Baseline: `c2b802c`; opened 2026-10-15 Asia/Shanghai.
- State: `implemented`; focused verification passed, independent integrated review pending.
- Contracts: ADR-001 Pi adapter boundary; frozen existing run/resume errors,
  cost warnings, thinking precedence and event shapes; model fallback row.

## Scope

Extract CLI thinking/cost/resume-disclosure helpers into `src/cli/run-options.ts`
and executor/configuration assembly into `src/cli/executor-factory.ts`. Preserve
existing public helper imports through re-exports from `main.ts`; command bodies,
USAGE, main dispatch, routing and default state-root selection stay in place.
The coordinating agent separately owns new development commands.

The audit also confirmed a distinct behavior defect: the CLI builds a fallback
list but `createConfiguredPiExecutor` drops it; CLI self-fallback filtering uses
object identity. Owner authorized the bounded correction separately: type and
forward fallback models through the adapter factory, and compare concrete
provider/model identity before adding a fallback.

## Acceptance and test-first verification

- [x] Existing thinking/cost/resume/config/sink characterization tests pass
  before extraction and retain the same errors, output and call arguments.
- [x] Pure configuration resolution accepts explicit environment/config inputs
  and preserves executor override > primary override > env > saved primary;
  existing cheap/premium alias behavior and hooks remain unchanged.
- [x] Real factory-created executor dispatches a distinct configured fallback
  after a retryable primary failure; no primary duplicate fallback is produced.
- [x] SDK-native Pi types remain within the adapter; no provider credentials,
  live calls, global configuration edits, help or existing status changes.

First run existing characterization suites. Add a RED regression against the
current factory using an injected faux model collection; add pure-resolution
tests after establishing the extraction boundary. Then run focused CLI/factory
and adapter suites, TypeScript, ESLint and workflow validation. Root owns full
integration gate and independent review. No commits/shared task-status edits.

## File ownership

`main.ts`: imports and existing helper blocks only (original lines 124–269,
426–481 and 1816–1864); never USAGE or command dispatch. New run-options and
executor-factory modules/tests; `src/pi-adapter/runtime.ts` and one factory
regression test; this plan and matching dated report. Abort extraction if it
would require changing frozen output or reimplementing routing.

## Evidence

Existing characterization: 49/49 before and after extraction. New regression
suite: RED 8 pass / 5 fail, then GREEN 13/13. Final focused CLI/adapter/telemetry
verification: 573/573 with no skips. TypeScript, changed-file ESLint and workflow
validation passed. See the [verification report](../../reports/2026-10-15-cli-run-assembly.md).

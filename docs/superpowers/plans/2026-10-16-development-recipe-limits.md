# Host-owned development recipe limits

## Identity

- ID: `TASK-20261016-development-recipe-limits`
- Owner: Codex
- State: `in-progress`
- Date opened: 2026-10-16
- Baseline: PR #60 `167a5404bcf7ca7fdf4abcc2b9e78c7f7e0bb53c`; main `44db4b1`.
- Contracts: [development workflow](../../development-workflow.md), [status matrix](../../status-matrix.md), [ADR-008](../../decisions/0008-remove-sha256.md).

## Problem and scope

Every development acceptance recipe currently stops after 5000 ms or 2048 bytes on either output stream. A passing checker with ordinary test output is classified as unavailable, and a medium-length checker cannot use the existing outer 60000 ms check window. Give the host bounded optional `timeoutMs`, `maxStdoutBytes`, and `maxStderrBytes` fields in the immutable recipe definition. Preserve omitted-field defaults and serialized legacy definitions.

The complete recipe set is validated and snapshotted before any command runs. Each timeout is 1..40000 ms and the sum of effective recipe deadlines is at most 40000 ms, retaining room in the existing outer 60000 ms window for process cleanup and startup. Output caps are 1..1048576 bytes per stream per recipe. These are command bounds, not an end-to-end wall-clock or dollar guarantee. The existing host verifier and candidate binding must include the new fields and the complete checker implementation dependencies.

Out of scope: arbitrary long full-suite checks, environment/credential configuration, shell execution, automatic acceptance/application/recovery, shared root cost accounting, live providers, main merge, production/R10/R11/F6 decisions, and PR #61 integration.

## Acceptance criteria

- [ ] RL-01: optional limits survive immutable queue round trips; omission preserves exact legacy shape/defaults. Invalid types, accessors, bounds and an excessive combined deadline refuse before execution.
- [ ] RL-02: a real checker exceeding 2 KiB passes under an explicit host cap; a real checker exceeding 5 seconds passes under an explicit host deadline. Default output overflow, timeout, signal/spawn failure retain unavailable behavior and do not trigger functional repair.
- [ ] RL-03: validate/snapshot all recipes before the first await; caller mutation during a preceding checker cannot change a later command or limit. A late invalid recipe cannot cause earlier commands to execute.
- [ ] RL-04: real Git controller run -> historical review -> explicit accept uses the same configured limits, binds them to the saved action/command, and preserves source and checker files. Trusted checker snapshots include the reused recipe validator dependency.
- [ ] RL-05: current framework guide, task/status entries, RED/GREEN evidence, full applicable gate/probes, and a reviewable GitHub checkpoint are recorded. Author checks are not independent review or production acceptance.

## Implementation slice

| File/symbol | Change | Dependency/risk |
|---|---|---|
| `src/development/work-items.ts` | Recipe limit schema, shared validating snapshot and aggregate deadline bound | Preserve legacy JSON shape; new definitions need an updated reader |
| `src/development/recipe-check.ts` | Use validated frozen recipes and their effective limits | Validate before any process; maintain 0/1/2 exit meanings |
| `src/development/controller.ts` | Include reused validator in trusted checker files | Complete host checker dependency binding |
| `test/unit/development/work-items.test.ts` | Validation and compatibility regressions | No external calls |
| `test/integration/development/recipe-limits.test.ts` | Real-process and controller acceptance regressions | Isolated temporary real Git repositories |
| `docs/framework.md`, existing guide/status/tasks, dated report | Current architecture, limitations and evidence | Separate main and PR capabilities |

## Test-first plan

Write and run the new tests against the unchanged runtime; require failures caused by unknown optional fields and the fixed runner caps. Then implement the bounded shared validator and runner propagation. Verify negative input before spawn using a filesystem sentinel, mutation using the first command's output, and real candidate acceptance with output over the old cap. Run focused neighboring development/native tests, workflow, typecheck, lint, full tests, build and security/Pi probes. Keep exact failure/skip/not-run results.

## Gates and handoff

Do not modify source application, frozen run/event contracts, external settings, or protected checker behavior. Stop on invalid definitions or unavailable checks. Keep all user work and prior branch history. Publish this bounded continuation to PR #60 after local verification, with a lease on the observed head. No independent review is claimed unless actually performed; merge and release remain separate.

## Closeout

Evidence and next actions will be recorded in `docs/reports/2026-10-16-development-recipe-limits.md`.

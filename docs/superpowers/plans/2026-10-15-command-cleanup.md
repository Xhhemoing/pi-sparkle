# Bounded command cleanup

## Identity

- ID: `TASK-20261015-command-cleanup`
- Owner: delegated command-cleanup implementation agent; root coordinates delivery.
- State: `ready-for-review`
- Opened: 2026-10-15 (Asia/Shanghai).
- Related: ADR-001, ADR-006, ADR-008; native cancellation plan dated 2026-10-02; native isolated-write/application status rows.

## Problem and scope

The shared authorized-command runner sends only SIGTERM and waits indefinitely for `close`. A command can ignore SIGTERM; a descendant can keep inherited pipes open after its parent exits. Both cases block cancellation, verification, and agent progress indefinitely. `child.killed` indicates signal delivery, not process termination.

In scope: the runner, its focused tests, this plan and a dated verification report. Preserve authorized argv/environment, shell-less spawning, frozen result fields/statuses, and failure-first acceptance. Use a fixed grace period, forceful POSIX process-group escalation, and a final bounded local-handle cleanup deadline. Preserve the first termination cause through escalation.

Out of scope: new OS sandboxing/job objects, a guarantee against descendants escaping the group, new public cleanup status fields, provider runs, production apply, or common task/status files (root owns these).

Platform correction: the October cancellation plan proposed Windows `taskkill`, but current source only kills the direct child. This slice retains direct-child Windows termination and bounds local pipe cleanup; it does not claim Windows process-tree cleanup. A separately designed and Windows-verified job-object/tree strategy remains follow-up work.

## Acceptance criteria

- [x] A ready POSIX command that ignores SIGTERM returns failed/cancelled after bounded escalation, with SIGKILL observed (2026-10-15 focused GREEN).
- [x] Timeout and output-limit paths also escalate and retain their original terminal cause (2026-10-15 focused GREEN).
- [x] An inherited-pipe descendant is stopped even after its group leader exits (2026-10-15 focused GREEN).
- [x] A descendant deliberately escaping its process group cannot hold the caller forever: a bounded local-pipe deadline returns failure and an explicit cleanup-incomplete diagnostic; no success is claimed (2026-10-15 focused GREEN).
- [x] Cooperative commands retain successful output/exit semantics and first-stop reasons are stable (2026-10-15 focused GREEN).
- [x] Tests use ready markers and independent watchdog cleanup, so the RED run cannot leak persistent fixtures or hang indefinitely (2026-10-15 RED and GREEN completed).
- [x] Focused unit/neighbor tests, intermediate typecheck, lint and workflow check have exact results in the report; root owns final typecheck/integrated gate (2026-10-15 record).

## Implementation slice

| File/symbol | Change | Owner | Risk |
|---|---|---|---|
| `src/execution/command-runner.ts` | Signal escalation, timer lifecycle, bounded fallback | command-cleanup agent | POSIX groups and pipe close are distinct |
| `test/unit/execution/command-runner.test.ts` | Adversarial real-process fixtures and regressions | command-cleanup agent | Avoid fixture leaks and timing-only readiness |
| This plan; `docs/reports/2026-10-15-command-cleanup.md` | Scope, evidence and limitations | command-cleanup agent | No independent acceptance implied |

## Test-first plan

1. Add real-process regressions with ready files, parent PID tracking, self-exit watchdogs, and final SIGKILL cleanup.
2. Run `pnpm test -- --test-concurrency=1 test/unit/execution/command-runner.test.ts`; confirm RED failures are bounded-cleanup failures.
3. Implement 250 ms graceful termination, SIGKILL escalation, then a 1,000 ms local-handle cleanup deadline. All pending stop paths remain non-successful.
4. Run focused runner, independent-check and coding-tool tests; typecheck/lint/workflow check. Root runs the final integrated gate/probes.

## Gates and handoff

- Existing R10/R11, F6, live-provider, production and independent-acceptance gates remain separate.
- Abort delivery on successful results with unconfirmed cleanup, changed public statuses, or lingering managed test fixtures.
- Rollback only these owned files; preserve unrelated work.
- Next command: root's final typecheck/integrated gate after the concurrent native-loop slice is complete.
- Evidence: [verification report](../../reports/2026-10-15-command-cleanup.md).

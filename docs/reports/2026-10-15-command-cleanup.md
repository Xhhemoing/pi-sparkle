# Bounded command cleanup verification

## Identity and outcome

- Task: `TASK-20261015-command-cleanup`; [scoped plan](../superpowers/plans/2026-10-15-command-cleanup.md).
- Baseline: `44db4b15078ccce9b1c191d29fec438af044a95c`; uncommitted slice on `codex/architecture-agent-loop-20261015`.
- Date: 2026-10-15 (Asia/Shanghai); Linux, Node v24.19.0, pnpm 11.25.0.
- Implementation owner: delegated command-cleanup agent. Independent review and integrated delivery remain root-owned.

The runner now stops managed commands with SIGTERM, allows 250 ms for graceful termination, and sends SIGKILL to the owned POSIX process group if needed. The group is signalled even after its leader exits. A remaining inherited output pipe has a final 1,000 ms local-close deadline after SIGKILL. Crossing that deadline closes local handles, returns the original failure status with `ok: false`, and explicitly reports cleanup as incomplete. It never describes escaped descendants as cleaned up.

The first cancellation/timeout/output-limit cause is retained. Follow-on timeout or output events do not restart cleanup or replace that cause. Existing result fields/statuses and the historical output-limit exit-code convention are preserved. Normal successful commands and failed executable spawning retain their existing behavior.

## Commands and evidence

| Command | Outcome | Evidence |
|---|---|---|
| `pnpm test -- --test-concurrency=1 test/unit/execution/command-runner.test.ts` | BLOCKED | Environment pnpm preflight attempted installation, then rejected ignored build scripts for existing dependencies; no tests ran. |
| `node scripts/run-tests.mjs --test-concurrency=1 test/unit/execution/command-runner.test.ts` | BLOCKED | tsx CLI attempted an IPC socket and received `listen EPERM`; no tests ran. |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/command-runner.test.ts` before implementation | RED | 3 pass, 5 fail, 0 skip; all five new cases failed with `command cleanup exceeded test deadline`. Each fixture was then killed by test cleanup. Duration 10.9 s. |
| Same direct-import command after implementation | GREEN | 8 pass, 0 fail, 0 skip; duration 4.0 s. |
| `node --import tsx --test --test-concurrency=1 test/unit/execution/command-runner.test.ts test/unit/execution/independent-check.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts` after adding success/spawn-error controls | GREEN | 24 pass, 0 fail, 0 skip; duration 5.1 s. |
| `node_modules/.bin/eslint src/execution/command-runner.ts test/unit/execution/command-runner.test.ts` | PASS after correction | First attempt found one `no-unsafe-finally` in test cleanup; cleanup error handling was extracted into its own function and rerun passed. |
| `node_modules/.bin/tsc --noEmit` | NOT GREEN at this intermediate shared-worktree state | Only concurrently authored `test/integration/native/write-loop.test.ts` referenced not-yet-added API fields (`maxAttempts`, `maxWallTimeMs`, `attempt`, `loop`). No runner errors. Root must rerun once that slice is implemented. |
| `node scripts/workflow-check.mjs` | PASS | 10 required files, 16 required headings. |
| `git diff --check` | PASS | No whitespace errors. |
| Integrated gate / probes | NOT RUN by this subagent | Root owns combined-source verification, including final typecheck. |

The direct `node --import tsx --test` command uses the installed TypeScript loader without the CLI's unnecessary IPC socket; no sandbox override or dependency-build permission change was made by this slice.

## Regression scenarios

1. A ready child installs a SIGTERM handler, then abort is requested: result is cancelled, signal is SIGKILL, and no cleanup-incomplete diagnostic is needed.
2. The same child times out: result is timed_out and its original timeout reason survives escalation.
3. The child exceeds the stdout cap: result remains output_limit, stored output stays capped, and the subsequent timeout cannot replace the reason.
4. A child inherits stdout/stderr and ignores SIGTERM after its parent exits normally: timeout still kills the original POSIX group and unblocks its pipes.
5. A deliberately detached descendant holds stdout/stderr open: the caller returns non-success within the cleanup bound and includes the explicit cleanup-incomplete diagnostic. The test's independent finalizer kills this intentionally escaped fixture.

Fixtures have ready-file handshakes, a 2 s expected-result deadline, tracked PIDs, final SIGKILL cleanup and a separate 10 s self-exit watchdog. The POSIX-specific cases are explicitly skipped on Windows. The successful-command, missing-executable, pre-abort and ordinary-abort controls are portable.

## Research and design rationale

The Node documentation distinguishes `exit` from `close` and explicitly states that `subprocess.killed` only reports that a signal was sent; it is not proof of termination. `detached: true` creates a POSIX process group/session, and Windows signal behavior only addresses the direct process. These facts support escalating independently of `child.killed` and separately bounding pipe closure: [Node child-process API](https://nodejs.org/download/release/latest-jod/docs/api/child_process.html).

The design adds no shell execution, new task runner, third-party dependency, or runtime metadata schema. The bounded failure path allows an agent supervisor to record a failed verification and retain a candidate rather than wait forever.

## Risks and open gates

- The 1.25 s cleanup budget begins at the first stop request; event-loop starvation can delay JavaScript timers. This is not a real-time guarantee.
- Escaped POSIX descendants and Windows process trees need stronger OS-level host containment. This patch bounds the caller and refuses success, but cannot certify their termination.
- The October 2 plan mentioned Windows `taskkill`; the source never provided it. This dated record corrects that claim for this slice. Windows direct-child behavior is retained, not newly verified on Linux.
- Successful commands that intentionally leave detached background work are outside this cancellation slice. No general process-sandbox guarantee is claimed.
- No live-provider, holdout, production-apply, R10/R11, F6, or Outcome-supported gate is closed.
- Follow-up owner: root for combined-source gate and independent review; platform execution owner for separately designed Windows tree containment.

## Handoff

Owned files: `src/execution/command-runner.ts`, `test/unit/execution/command-runner.test.ts`, scoped plan and this report. No common task/status files or Git commits were changed by this subagent. Review the final runner diff, rerun typecheck after native-loop implementation, then run the integrated gate/probes.

# Native Pi Isolated Write Session

## Identity

- Task: `TASK-20260918-native-pi`, isolated-write slice.
- Date/environment: 2026-09-19, Windows, Node 24.18.0, pnpm 10.17.1, Git worktrees.
- Scope: implement `NativeWriteSession` and immutable native-write preflight; retain candidate worktrees and evidence; do not apply candidates automatically.
- Source state: existing dirty/ignored user changes were preserved. No reset, discard, commit, push, merge, or cleanup of unrelated worktrees was performed.
- Review posture: main-agent implementation review and command verification only. The attempted independent Grok review was unavailable; no independent reviewer PASS, live-provider acceptance, benchmark, or holdout result is claimed.

## Acceptance Criteria

1. Refuse absent/invalid verification, dirty source, non-toplevel source, and pre-abort before executor allocation.
2. Allocate a detached retained worktree only after clean preflight; inject only candidate-scoped read/write tools.
3. Return durable run identity/events, candidate path, content-addressed evidence, and independent host acceptance.
4. Never accept child self-report alone; failed host checks, executor failures, cancellation, and shutdown remain non-accepted retained outcomes.
5. Preserve source checkout contents; no automatic candidate application or disposal.

## Changed Surface

- `src/native/write-preflight.ts`: canonical Git toplevel, `HEAD`, clean/ignored status, input validation, and frozen host verification snapshot.
- `src/native/write-session.ts`: session lifecycle, retained detached worktree, second clean/revision preflight before executor allocation, candidate-only tools, parent-run persistence, cancellation/shutdown, failure artifacts, and host `runClosedLoopCheck` acceptance.
- `test/unit/native/write-preflight.test.ts`: real-Git preflight and validation coverage.
- `test/integration/native/write-session.test.ts`: real-Git worktree, tool-bound deterministic executor, persistence, host verification, lifecycle, and retained cleanup coverage.
- `docs/superpowers/plans/2026-09-18-native-write.md`, `tasks/todo.md`, `docs/status-matrix.md`: durable scope/status/evidence updates.

The session is a library API only. It is not registered in the Pi extension or default CLI, and it does not add shell/spawn tools, credential access, permission mutation, automatic application, or post-run candidate cleanup. A cancellation before a durable run exists cleans only the just-created session-owned worktree.

## Test-First Evidence

- Initial integration RED: before the production entry existed, the focused test failed with `ERR_MODULE_NOT_FOUND` for `src/native/write-session.js`.
- Main-review historical draft RED: the rejected incomplete draft failed the success assertion and typecheck; it is retained under `.agent_workspace/research/native-write/incomplete-luna/` as historical evidence and is not active source.
- Preflight RED/GREEN: ignored user-code coverage first failed because status omitted ignored paths; adding `--ignored` made the focused preflight suite green.
- Final focused command:
  `pnpm exec tsx --test test/integration/native/write-session.test.ts test/unit/native/write-preflight.test.ts test/integration/execution/closed-loop.test.ts test/integration/execution/pi-closed-loop.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/unit/run/episode-contract-boundary.test.ts`
  Result: `35 tests / 35 pass / 0 fail / 0 skip`.
  Evidence: `.agent_workspace/research/native-write/focused-delivery-final.log`.
- Native write integration subset in that run: `8/8` pass. Preflight subset: `7/7` pass. Existing closed-loop, Pi loopback, tool-boundary, and episode-boundary tests also passed.

## Verification Commands

| Command | Result | Evidence |
|---|---|---|
| `pnpm workflow:check` | PASS, 10 required files / 16 headings | `.agent_workspace/research/native-write/workflow-final-closeout.log` |
| `pnpm typecheck` | PASS | `.agent_workspace/research/native-write/typecheck-current-final.log` |
| `pnpm lint` | PASS | `.agent_workspace/research/native-write/lint-current-full-final.log` |
| `pnpm test -- --test-concurrency=1` | PASS, `2794 tests / 2776 pass / 0 fail / 18 skip` | `.agent_workspace/research/native-write/test-delivery-latest.log` |
| `pnpm build` | PASS | `.agent_workspace/research/native-write/build-current-final.log` |
| `pnpm security:probe` | PASS, `26`, no open/waived/refused findings | `.agent_workspace/research/native-write/security-current-final.log` |
| `pnpm pi:probe` | PASS, `4/4` compatibility checks | `.agent_workspace/research/native-write/pi-current-final.log` |
| `git diff --check` | PASS (existing CRLF normalization notices only) | `.agent_workspace/research/native-write/diff-check-final-closeout.log` |

The project script `pnpm gate` was also attempted. Its normal parallel test phase hit Windows process/Git-fixture resource contention: `git init` returned `0xC0000402`, a child process returned `ETIMEDOUT`, and the run ended with `703 tests / 396 pass / 302 fail` after roughly 49 minutes. A later attempt with `NODE_OPTIONS=--test-concurrency=1` was invalid because Node rejects that flag in `NODE_OPTIONS` (exit 9). The supported equivalent gate sequence was then run explicitly with `pnpm test -- --test-concurrency=1`; all workflow, typecheck, lint, test, and build steps passed as recorded above. The parallel failure remains at `.agent_workspace/research/native-write/gate-final.log` and is not presented as a product regression or a green `pnpm gate` result.

## Behavioral Evidence

- Success writes `value.ts` only in the detached candidate; the source remains `export const value = 1;`, the candidate becomes `export const value = 2;`, and the host verification command reads the candidate file before exiting zero.
- The executor factory receives only `sparkle_read_file` and `sparkle_write_file`; `sparkle_run_command` is filtered out. The task working directory is the candidate path.
- Host verification command and argv are copied and frozen during preflight, and are passed to `runClosedLoopCheck` rather than taken from model output or task self-report.
- Nonzero host verification returns `status: "FAILED"`, `acceptance.accepted: false`, a retained candidate, and a content-addressed failure artifact.
- Cancellation and shutdown settle the parent run, skip acceptance, return `status: "CANCELLED"`, preserve the candidate and failure artifact, and report `reason: "cancelled"` or `"shutdown"`; a stop observed before host-check start skips that check entirely.
- Thrown executor failures are converted to durable failed run/evidence results and cannot be accepted.
- A second clean/revision preflight runs after worktree creation and before the factory receives tools, refusing late source changes observed in that check window. Concurrent source mutation after that check remains a later application/integration risk.

## Risks and Open Gates

- Git worktree isolation is not an OS sandbox. The trusted host verification command can execute candidate code; later integration must supply an explicit command policy and environment boundary where required.
- The session retains candidates and evidence by design. Automatic application, stale-target checks against a caller target, rollback, disposal ownership, and global Pi non-credential/non-permission field allowlists are a later slice.
- No independent reviewer PASS or real provider run was available. Local deterministic executors and loopback tests establish contract behavior, not model quality or provider availability.
- The normal parallel `pnpm gate` command did not pass on this Windows host due to resource contention. The serialized gate-equivalent command passed and is the current reproducible local evidence.
- F-PROD, live routing, holdout, and Outcome-supported claims remain unchanged and open.

## Handoff

- Next implementation slice: candidate application with explicit stale-target refusal, allowlisted non-security fields, rollback, disposal policy, and independent review/human authorization.
- Do not register `NativeWriteSession` as an unrestricted Pi tool until that application boundary and policy review are complete.
- Durable plan/checklist/status links: [native-write plan](../superpowers/plans/2026-09-18-native-write.md), [active checklist](../../tasks/todo.md), [status matrix](../status-matrix.md).

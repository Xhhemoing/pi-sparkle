# Generic command-tool uncertainty verification

## Identity
- Task: TASK-20261019-command-uncertainty / BF-20261019-command-uncertainty.
- State: ready-for-review for the bounded implementation; full merge gate is not green, acceptance remains open.
- Date/environment: 2026-10-19, Windows, Node v24.18.0, pnpm 10.17.1.
- Baseline: fetched PR #60 head 2ec715a5cf0c43333710ebb7050fe7278d62be8f; local branch codex/command-tool-uncertainty-20261019, working diff on that commit.
- Owner/reviewer: Codex implementation and self-review only. No independent review, hosted CI or human acceptance performed.
- [Plan](../superpowers/plans/2026-10-19-command-uncertainty.md); [current checklist](../../tasks/migration-todo.md).

## Source and record reconciliation
`gh pr view 60` confirmed OPEN, head codex/architecture-agent-loop-20261015, base main. Fresh fetch produced the baseline above. PR body verification at older 14a11640 is historical, not validation of this delta. Existing 2026-10-18 publication-blocker paragraphs remain historical snapshots. The previously clean E:/Project/pi-sparkle checkout now holds this local follow-up branch; the dirty personal-team worktree and main were preserved.

Native default tools are file-only. The affected opt-in path is a host factory creating generic commands with its explicit command policy. This slice supplies the missing host receipt boundary; it does not grant command authority or qualify arbitrary external executors.

## Problem, root cause and observable acceptance
The generic tool converted runner cleanupUnsettled into an ordinary DomainValidationError. A worker could catch the tool error and report success; NativeWriteSession had no independent command-cleanup receipt, so controller could complete its candidate-write action and release ownership.

The real regression sequence is:
1. Claim a candidate-write task and leave a second overlapping task planned.
2. Host authorizes `node -e "setInterval(()=>{},1000)"` with a 1000ms timeout. Runner returns timed_out and cleanupUnsettled=true; that is uncertainty, not evidence of stopped effects.
3. Scripted worker catches the tool error, runs a separate successful command and reports protocol success. Host verification would write a marker and exit zero.
4. Before the patch, controller returned ready-for-review. With the patch, the marker is absent; a native-write-failure artifact records processCleanup.settled=false/status=timed_out without raw stdout; candidate and source bytes remain available.
5. Ledger remains needs-reconciliation and original queue claim remains running. A fresh controller dispatches no overlapping worker, leaves that item planned and returns no-ready-task. MaxAttempts=2 does not repair/replay the unknown effect.
6. Tool regression verifies synchronous host notification before CommandCleanupIncompleteError; ordinary nonzero exit, policy denial and pre-aborted no-spawn execution do not emit extra uncertainty.

These are actual subprocess/Git/artifact/store assertions with a scripted worker, not a live model or containment qualification.

## Files and implementation
| File / symbol | Change |
|---|---|
| src/pi-adapter/worktree-coding-tools.ts / context, sparkle_run_command.execute | Optional synchronous host receipt; preserve typed cleanup error; combine per-call/session cancellation |
| src/native/write-session.ts / factory input, runAttempt | Supply host callback; retain first unknown cleanup result; preserve candidate during factory cancellation; persist existing failure/effectsSettled=false before cancellation/success/check branches |
| test/unit/pi-adapter/worktree-coding-tools.test.ts | Real timeout, typed error/receipt identity, known-failure and pre-spawn controls |
| test/integration/development/controller-admission.test.ts | Swallowed error plus later success, no checker/repair, retained evidence/claim, restart and overlap |
| tasks/{plan,todo,migration-todo}.md, docs/status-matrix.md, dated plan/report | Current scope, evidence, remaining conditions |

No ledger/queue schema, CLI/event contract, dependency, hash, frozen contract, baseline mechanism or gate was added. Existing controller/ledger fencing is reused.

## Commands
Log paths below are under `.agent_workspace/command-uncertainty/`.

| Command | Result | Evidence |
|---|---|---|
| pnpm test --test-name-pattern='generic command uncertainty' test/integration/development/controller-admission.test.ts (before patch) | Expected RED 0 pass / 1 fail | red.log: actual ready-for-review, expected needs-reconciliation |
| pnpm test --test-name-pattern='generic command reports' test/unit/pi-adapter/worktree-coding-tools.test.ts (before patch) | Expected RED 0 pass / 1 fail | unit-red.log: ordinary DomainValidationError lost cleanup result |
| First combined focused / initial typecheck | FAIL, fixture corrected | Wrong fixture vocabulary uncertain/state instead of needs-reconciliation/status; 100ms normal-process limit too tight on Windows. Fixed without relaxing product behavior. |
| pnpm test --test-concurrency=1 test/unit/execution test/integration/native test/integration/development | FAIL: 346 total / 317 pass / 1 fail / 28 skip | adjacent.log, exit 1; intermediate fixture incorrectly read evidence from ActionRecord instead of latest history transition. Corrected fixture passed separately and in final gate. |
| pnpm test --test-name-pattern='generic command uncertainty' test/integration/development/controller-admission.test.ts (extended final assertions) | PASS 1/1 | artifact-focused.log; initial expected restart needs-reconciliation was corrected to existing no-ready-task selection semantics |
| pnpm test test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts (final files) | PASS 23/23, 0 skip | final-focused.log, exit 0; both changed tests and neighbors |
| pnpm typecheck (final fixture) | PASS | final-typecheck.log, exit 0 |
| pnpm lint | PASS | lint.log, exit 0 |
| pnpm exec eslint src/native/write-session.ts src/pi-adapter/worktree-coding-tools.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts | PASS | final-lint.log, exit 0; final files |
| pnpm gate | FAIL: 3695 total / 3645 pass / 2 fail / 48 skip | gate.log, exit 1; workflow/typecheck/lint pass; tests fail; gate's final build step not reached |
| pnpm test --test-concurrency=1 test/integration/development/batch.test.ts | PASS 3/3 | batch-rerun.log, exit 0; unchanged tests, first case 25.1s, dependency case 9.5s |
| pnpm build | PASS | build.log, exit 0; explicitly run after gate had known failures |
| pnpm security:probe | PASS 26 | security.log, status ok, no open/waived/refused findings |
| pnpm pi:probe | PASS 4 | pi.log, pinned 0.86.1/import/legacy guards |
| pnpm workflow:check | PASS | workflow.log; final documentation-only rerun recorded in final-workflow.log |
| git diff --check | PASS | No whitespace errors; CRLF normalization notices only |

Full gate was an actual `pnpm gate`, under process-local affinity mask 15 (Node availableParallelism=4), without changing gate scripts. Both new regressions passed inside it (controller 8.2s, tool 1.6s). Its two failures are unchanged batch.test.ts cases: actual deadline vs expected max-items/no-ready-task, at 34.8s/36.5s against 30,000ms whole-batch limits. Separate serial rerun passed without source or deadline changes. This supports load/deadline competition but does not turn the full gate into a pass. Conditional skips include opt-in provider and POSIX/process/platform cases unavailable on Windows; no skipped test qualifies containment. Full logs retain exact skip names.

Known-success/nonzero controls use the normal 30-second host command limit. Only the reproduction command has a 1-second timeout. Final controller fixture uses separately created tools sharing one callback, proving later success cannot clear the first unknown receipt.

## Host wiring and compatibility
The callback is host evidence, not a model argument. A host opting into generic commands forwards it and its original signal:

```ts
const tools = createWorktreeCodingTools({
  worktreeRoot: context.candidatePath,
  signal: context.signal,
  onCommandCleanupUnsettled: context.onCommandCleanupUnsettled,
  commandPolicy: hostPolicy,
});
```

Await command calls before factory/executor settlement. Tools omitting the callback, detached host work and arbitrary external effects remain host responsibility. The standalone context callback is optional and typed cleanup errors remain available. Native supplies the new required callback on its experimental factory input; factories destructuring existing fields remain valid, while external fixtures manually constructing that input type must add it. No stable SDK compatibility acceptance is claimed.

## Review, risks and handoff
- [V] Real RED/GREEN and final 23/23 establish the bounded host-wired uncertainty behavior. Self-review inspected cancellation/factory disposal ordering, first-receipt retention, bounded repair termination, persisted ownership and privacy metadata. This is not independent verification.
- [H] The two full-gate batch failures are consistent with load/deadline competition, supported by their explicit deadline assertions and unchanged serial 3/3 rerun.
- [T] Before merge, maintainer must obtain a clean full pnpm gate under an isolated execution window and independent source review. No green full-gate or merge-ready claim is made here.
- Full OS/Windows containment qualification, old writers, terminal archival, arbitrary host executors, main/#61 integration, stable SDK and existing S0-min/R10/R11/F6/live/production/experimental gates remain open.
- Real provider, crash, benchmark and holdout runs: NOT RUN, opt-in and outside this slice. No paid/model run or production effect authorized.
- Git snapshot state: no commit/tag/snapshot/push requested or made. Rollback only this task's diff after actual effect reconciliation; never delete unknown rows or grant replay from failure text.
- Next action/owner: maintainer reviews this local branch and reruns the existing full gate without competing work before any merge. Host adopters wire the callback and reconcile actual stopped effects before releasing ownership. No new approval flow or cleanup action is introduced.

## 2026-10-19 staged continuation closeout
User explicitly requested staged local commits. Independent M0 specification and quality reviews passed; quality re-review confirmed runtime/test diff unchanged. Fresh focused command: `pnpm test --test-concurrency=1 test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts` passed 23/23 (staged-continuation/uncertainty-focused.log).

Fresh `pnpm gate` ran to completion: 3695 total / 3646 pass / 1 fail / 48 skip, exit 1. Workflow, typecheck and lint passed; test failure prevented its build step. Both former batch deadline cases passed. Sole failure was the exact-git-tree fixture after-hook throwing Windows EPERM during temporary directory cleanup; unchanged selected rerun reproduced it (tree-limit-repeat-1.log). Added bounded rmSync cleanup retry (10 retries, 50 ms linear delay), retaining exhaustion errors and every original production assertion. Full file now 25 pass / 0 fail / 2 existing platform skips; independent static review passed. Repeated selected checks and final workflow are recorded in the staged report.

Explicit current `pnpm build`, `pnpm security:probe` and `pnpm pi:probe` pass: security 26, Pi 4. Logs are under .agent_workspace/staged-continuation/uncertainty-{build,security,pi}.log. This reviewed source is preserved as a local checkpoint; final integrated full gate remains required and is not inferred from the corrected focused test. The previous report's no-commit/no-independent-review statements describe the earlier session and are superseded by this dated continuation. No remote publication or main merge occurs here. Real-provider smoke is a separately authorized M1 experiment, not M0 containment evidence.

## Superseding local acceptance (2026-10-20)

The later staged continuation supplied independent source reviews and the final local gate:3978 pass/0 fail/48 conditional skips plus build; security26/Pi4/kernel3 and actual packed consumers PASS. [Exact final evidence](2026-10-19-staged-continuation.md#final-local-acceptance-2026-10-20). The initial Identity/no-review and failed-gate entries above remain historical evidence. This bounded slice is now accepted locally; whole M0 containment, arbitrary host effects and production acceptance are still separate.

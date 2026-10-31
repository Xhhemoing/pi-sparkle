# P3 controlled-driver combination verification

## Identity

- Task: TASK-20261021-controlled-combinations, accepted locally (instrumented controlled-driver test coverage).
- Source: 683c620a417c10fcc45771bd0a3c2e0746aacd60 on codex/cloud-continuation-20261020.
- Date/environment: 2026-10-21 America/Los_Angeles; Windows, pwsh, Node24.18.0, pnpm10.17.1, Pi0.86.1.
- Owner: root; single test writer, independent specification and quality reviewers.
- [Precise plan](../superpowers/plans/2026-10-21-controlled-combinations.md).

## Commands

Requested P1/P2 commit completed before P3 writes: 683c620a, feat: add Pi tools and read-only recovery. Postcommit status was clean. Precommit focused36/36, workflow/diff checks exit0; exact evidence remains in the [P2 record](2026-10-20-conversation-recovery.md#requested-local-commit-checkpoint-2026-10-21). No remote push.

P3 final acceptance: focused34/34; independent specification/quality reviews; full gate3997 pass / 0 fail / 48 conditional skips plus build; security26/Pi4 pass. Exact commands are in Final local acceptance below. Earlier sections preserve chronological failed, diagnostic and then-pending outcomes. Raw directory: .agent_workspace/p3-controlled-combinations-20261021/.

## Behavioral Evidence

Read-only investigation found existing driver HTTP cancellation but no real driver+held-tool/listener composition. Qualification scenarios already cover these waits locally, and the driver suite already verifies old-run A/new-root B identity. Planned test instrumentation is limited to private copied candidates and keeps the actual Agent/kernel/CLI/driver path; it does not represent unchanged-candidate qualification.

## Risks and Gates

No production runtime, dependency or authority change planned. No live provider, containment/platform qualification, release or P4/P5 acceptance. Root serializes all integration tests/internal builds and the existing full gate. First-run green is recorded as coverage; only a real product failure creates a bugfix RED.

## Handoff

Single writer: driver integration tests plus dedicated test helper only. Root owns docs and final validation. Scope and acceptance are in the linked plan.

## Independent plan precheck

Reviewer conversation_readiness checked the precise plan against the real Agent-construction/waiting chain and existing driver identity/cancellation tests. It found no concrete infeasible requirement or scope contradiction. This is a read-only plan/source precheck (commands exit0), not actual-diff review or runtime verification; fixture cleanup and real-chain preservation still require final review.

## First actual P3 candidate

Single writer added two driver subtests and test/helpers/managed-driver-settlement-fixture.ts. Only the private copied pi-executor.js Agent-construction seam is wrapped; the real Agent receives a held tool or async agent_end listener. File entry/abort and held-probe acknowledgments precede release. Original executor bytes are restored after the actual driver finishes. No production source, dependency, default timeout or existing assertion changed.

Writer's pnpm typecheck and targeted ESLint exited0. A trailing-blank-line diff-check finding was corrected locally, then targeted diff-check exited0. No product RED is claimed. Root started pnpm test --test-concurrency=1 test/integration/pi-adapter/managed-driver.test.ts test/integration/pi-adapter/managed-qualification.test.ts; focused-attempt1.log and focused-attempt1-result.json retain the actual first result. The command is still running, and independent actual-diff specification review is in progress.

## Specification finding R1: unknown driver cleanup

Independent specification reviewer found that the new fixture cleanup restored candidate bytes after any resolved driver Promise. Root checked driver.ts: its stop-grace fallback can unref and finish without observing close, returning unknown settlement. A resolved Promise therefore does not prove the child stopped. The test must restore only after application-settled or explicitly not-started; unknown/rejected/timed-out cleanup must retain the candidate/root and prevent subsequent use of B. Outer root deletion must honor this condition too. This is a test-fixture cleanup defect, not a newly demonstrated production failure. The first focused run is still running; source edits wait until it ends, preserving its actual outcome.

## First focused outcome and fixture diagnosis

Root's first serial driver+qualification command exited1: 34 tests, 32 pass / 2 fail / 0 skip, 221022.2589 ms (one held-tool subtest failure plus its parent aggregate). Deferred agent_end composition passed in 3939.5688 ms; held tool timed out waiting for entered after 15043.7863 ms. Existing qualification passed. Raw focused-attempt1.log/result.json preserve the failure; this is not P3 acceptance.

The writer traced the tool-only fixture to a nonexistent agent.setTools method. Actual pinned Pi0.86.1 exposes the mutable state.tools setter; the listener branch did not call setTools and passed. Root checked the installed Agent declaration/implementation. This is a fixture API error, not an observed product settlement defect. The minimal correction assigns state.tools while retaining the real Agent. The independent R1 cleanup correction also requires root retention and stopping the outer suite on unknown ownership. No production change is justified by this failure.

## R1 correction and specification closure

The candidate now retains the whole private root by default once driver execution starts. It restores only after application-settled or explicitly not-started; unknown settlement, rejection or cleanup timeout retains the root, and a parent assertion stops any later reuse of B. The outer cleanup respects retention. The tool fixture now uses the actual state.tools API and asserts its declaration in the first real provider request.

Reviewer conversation_readiness re-read these changes and closed R1 with no new concrete specification defect. This is static actual-diff review, not command acceptance; read-only commands exited0. Writer's current typecheck/targeted lint/diff checks exit0. Root started the second serial focused run in focused-attempt2.log/result.json; independent quality review follows the completed specification review. No runtime code changed.

## Independent quality review

After specification closure, reviewer roadmap_validation read the plan, actual test delta/helper, report and in-progress log. It found no new concrete defect. It confirmed real Agent/CLI/driver execution, actual first-wire tool declaration, held/abort acknowledgments, terminal/dispatch/binding assertions, unchanged outer timeout, byte restoration and unknown-root retention. Two read-only calls and diff-check exited0. It ran no tests/builds and did not treat the partial attempt2 log as a pass. Final command verification remains root-owned.

## Second focused outcome: cancellation observation unresolved

The second serial focused command exited1: 34 tests, 32 pass / 2 fail / 0 skip, 216760.9651 ms (listener subtest plus parent aggregate). Held-tool composition now passed in 3988.5189 ms, including actual wire declaration. The listener entered and acknowledged held-before, but aborted was not observed within the unchanged bound; its failure took 18985.8672 ms. Qualification passed. Raw focused-attempt2.log/result.json retain the actual result.

The first run's listener pass does not override this failure. Static pinned Agent lifecycle inspection did not prove a lost signal. Repeated marker replacement on Windows is a candidate fixture race, but no retained exception yet confirms it. The writer is authorized to add diagnostic-only fixture error/driver-result reporting first, keeping the handshake, signal and timeouts unchanged. Root will run the driver alone for diagnosis, then the complete focused pair after a supported correction. Final acceptance and the full gate remain pending.

## Diagnostic-only candidate

The writer added a fixture error marker preserving the original stack and rethrows the error; all signal waits check that marker and premature driver completion. Failure and cleanup diagnostics include the signal snapshot and actual driver result. The signal, repeated ACK behavior and timeouts are unchanged. Typecheck passed; one diagnostic lint issue was corrected, then targeted lint/diff checks passed. Root started the driver-only diagnostic command in driver-diagnostic.log/result.json, serially with no other build. No root cause or fix is inferred merely from the earlier intermittent pass.

Independent cancellation-route investigation found no static normal-path cancellation gap. This children-based case actually uses CLI startFlowchartRun, not awaitCliHandle: flowchart-run subscribes and forwards external abort, live children are removed only after done, child-coordinator combines parent/attempt signals into the executor, and PiAgentExecutor closes its queue only after prompt/idle. Candidate fixture exit or observation errors still require actual evidence. Five read-only calls passed after correcting one guessed source path; no production edits or tests were made by the investigator.

## Diagnostic result and bounded fixture adjustment

Driver-only diagnostic run exited0: 16 pass / 0 fail / 0 skip, 187156.2873 ms; actual parent suite 186170.4564 ms, held tool5497.1296 ms and agent_end5367.5083 ms. No fixture error was observed. The earlier missing-aborted cause was not reproduced or confirmed; this passing run is not described as proof of its cause or correction.

The helper is now changing each held acknowledgment to a single write per phase, removing unnecessary repeated replacement while the parent observes that same file. Original signal semantics, deadlines, assertions and exception/result diagnostics remain. The abort marker already has once-listener/synchronous-preabort semantics, so no new mechanism was added. This bounded fixture adjustment reduces an identified observation race opportunity; attribution of the earlier missing marker remains explicitly unproven. Root will verify the final candidate with the whole focused pair and full gate, and both reviewers will recheck the final delta.

## Final-delta independent reviews

Specification reviewer conversation_readiness and then quality reviewer roadmap_validation re-read the diagnostic/single-write acknowledgment delta. Both found no new concrete defect: a phase is acknowledged in memory only after publishing its actual file; errors remain thrown even if diagnostic writing fails; actual before/after signals and all cancellation/terminal/provider/binding assertions remain. Unknown ownership still retains the root and stops B reuse. Read-only commands exited0; neither ran tests/builds. Both explicitly retained the unproven attribution of the earlier missing-aborted timeout. Final complete focused command is running in focused-final.log/result.json; source writes have stopped.

## Final focused verification

Root's final complete focused command, pnpm test --test-concurrency=1 test/integration/pi-adapter/managed-driver.test.ts test/integration/pi-adapter/managed-qualification.test.ts, exited0: **34 pass / 0 fail / 0 skip**, 264706.2269 ms. Driver parent183506.8681 ms, below its unchanged240s bound; actual held tool4871.9372 ms and deferred agent_end5030.2505 ms. Original generation-selection/resume checks and all qualification scenarios passed. Raw focused-final.log/result.json. No production source, dependency or assertion was changed to obtain this result.

Root now runs the unchanged existing pnpm gate via pwsh -NoProfile -File .agent_workspace/p3-controlled-combinations-20261021/run-p3-gate.ps1, with process-local affinity3 / availableParallelism2 / default test concurrency1. This serializes tests with internal builds. Source/test edits are stopped; only docs may reconcile. Full gate/probes and final document verification remain pending. Earlier failed/diagnostic outcomes remain distinct and retained.

## Usage/evidence consistency review

Independent conversation_readiness checked the managed guide, precise plan, report, actual tests and final focused log. It found stale top-level progress wording in the report/plan; root synchronized it to focused/reviews completed, full gate/probes pending. It found no scope expansion or unsupported root-cause claim. Read-only commands exited0; no independent product tests/builds were run. Historical failed attempts remain retained.

## Final local acceptance (2026-10-21)

P3's stated test-coverage criteria are met on 683c620a plus the reviewed test/documentation delta, in Windows / Node24.18.0 / pnpm10.17.1 / Pi0.86.1. P1/P2 was committed first as requested. Source/test writing stopped before the final focused run and full gate; only documentation changed afterward.

| Command | Actual result | Raw evidence |
|---|---|---|
| pnpm test --test-concurrency=1 test/integration/pi-adapter/managed-driver.test.ts test/integration/pi-adapter/managed-qualification.test.ts | exit0; 34 pass / 0 fail / 0 skip; 264706.2269 ms | focused-final.log, focused-final-result.json |
| pnpm typecheck | writer exit0; repeated successfully by root full gate | p3-gate.log |
| pnpm exec eslint test/integration/pi-adapter/managed-driver.test.ts test/helpers/managed-driver-settlement-fixture.ts | writer exit0; complete lint also passes in root gate | writer command results above; p3-gate.log |
| pnpm gate | exit0; workflow/typecheck/lint pass; **3997 pass / 0 fail / 0 cancelled / 48 conditional skips**, 4045 tests, 148 suites; build PASS | p3-gate.log, p3-gate-result.json |
| pnpm security:probe | exit0; 26 passed, no open/waived/refused findings | p3-security-probe.log |
| pnpm pi:probe | exit0; four checks pass for Pi0.86.1 | p3-pi-probe.log, p3-probes-result.json |

Raw logs live under .agent_workspace/p3-controlled-combinations-20261021/. The existing gate ran through the recorded ignored serial helper, 2026-10-21T08:18:59.2501698Z to 2026-10-21T09:18:01.3338462Z; test duration3464501.8808 ms. No gate definition, assertion or existing timeout was weakened. During the full gate the driver suite passed in159823.029 ms, including held-tool3669.6794 ms and deferred-agent-end3823.6665 ms; qualification passed in61429.6709 ms. The new combinations therefore passed both the final focused run and this full-candidate gate.

### Delivered files and observed assertions

- test/integration/pi-adapter/managed-driver.test.ts adds the two actual fixed driver/CLI/PiAgentExecutor/Agent combinations, real provider tool declaration, pending/abort/file acknowledgments, no terminal outcome before release, single cancellation outcome afterward, no extra wire dispatch and B/root/child binding checks. Existing A-resume/new-root-B coverage remains.
- test/helpers/managed-driver-settlement-fixture.ts instruments only the private copied Agent-construction seam, records original exceptions and real signal observations, bounds waits, and restores original bytes only after known settlement. Unknown child ownership retains the candidate/root and stops reuse.
- [Managed guide](../../docs/managed-pi.md), [accepted plan](../superpowers/plans/2026-10-21-controlled-combinations.md), [status](../../docs/status-matrix.md) and [active checklist](../../tasks/todo.md) record the scope and current evidence.
- No production runtime, dependency, lockfile or public API changed. No new hash, frozen contract or gate was introduced.

### Review and retained limitations

Independent specification review found and closed R1 (unsafe fixture restoration after unknown driver result); independent quality and final-delta reviews found no remaining concrete defect. These were actual source/diff/log reviews, not separately executed product tests. Usage/evidence review found stale progress wording, now reconciled.

The first fixture API failure was diagnosed and corrected against pinned Agent0.86.1. The later missing-aborted timeout was not reproduced in the diagnostic run, final focused run or full gate; its exact cause remains unconfirmed. Single-write acknowledgments remove unnecessary concurrent marker replacement, but are not proof of that historical cause. Original failed logs and added diagnostics are retained. If it recurs, the host/test maintainer should inspect the preserved fixture error, signal snapshot and actual driver result before changing product cancellation or test bounds.

No current acceptance command is blocked. This is instrumented cooperative composition coverage, not requalification of unchanged candidate bytes, OS descendant containment, hostile-code isolation, Linux/Node22 qualification or public real-project dispatch. The 48 conditional skips remain skips. No opt-in live-provider, crash probe, benchmark or holdout run, release/preview, remote push or main merge occurred. P4 bounded repair and P5/C4 planning remain future slices with their own precise plans and acceptance; no further implementation starts here.

### Final documentation and local handoff checks

After final acceptance reconciliation, pnpm workflow:check exited0 (10 required files, 16 headings), git diff --check exited0, and relative-path checking found 415 references across8 changed/new Markdown files with zero missing targets. Remote URLs and section anchors were not checked. Raw final-workflow.log, final-diff-check.log and document-links.json. Production src/extensions, package metadata and lockfile have no P3 delta. Only the two reviewed test/helper files and eight documentation/task files are included in the local P3 commit, test: cover managed driver settlement waits; the resulting commit is identified by Git history. No push is included.

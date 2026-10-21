# Conversation recovery verification

## Identity

- Task: TASK-20261020-conversation-recovery, accepted locally (bounded C3 read-only references).
- Source: 26808ad2 plus accepted P1 and preserved planning/docs changes; no dependency updates.
- Environment: Windows, pwsh, Node24.18.0, pnpm10.17.1.
- Owner: root; one implementation writer; independent spec/quality reviewers.
- [Precise plan](../superpowers/plans/2026-10-20-conversation-recovery.md). P1 gate/probes/reviews completed before P2 began.

## Commands

Final P2 acceptance: focused 36/36; independent specification and quality reviews complete; current full gate 3995 pass / 0 fail / 48 conditional skips plus build; security26/Pi4 pass. Exact commands and output are in the final acceptance section below. Earlier sections preserve the chronological RED/GREEN, findings and then-pending state; prior P1 results were not substituted for P2 verification.

## Design evidence

Two read-only investigations confirmed that direct taskRef is not durably mapped to run/queue identity and executorFactory can precede run creation. Recovery therefore uses explicit host-selected mappings and permanently read-only sessions. EventStore tail recovery must be surfaced; inspectRun alone discards that warning. Existing controller.status has read-lock side effects and is not an atomic cross-store snapshot. Model projection excludes messages, canonical action inputs and claim tokens.

## Risks and Gates

No replay or execution authority restored. No global exactly-once claim, automatic apply, provider calls or production/experimental acceptance. Host-selected file saving/deletion is explicit and serialized. A deleted or unreadable reference file never opens a writable session.

## Handoff

Single writer implements the precise plan after an observed missing-capability RED. Root owns documentation and serial final validation. Raw logs: .agent_workspace/conversation-recovery-20261020/.

Independent specification precheck: conversation_readiness read the precise plan (pwsh exit0), found no concrete scope/authority contradiction. This only checks the plan; runtime verification and actual-diff review remain pending.

## Actual restart RED

The real first child process loaded P1, executed and checked a Git candidate, and retained minimal reference data. After that child exited, a second child used the real Pi loader with the proposed recovery configuration and failed because sparkle_conversation_focus was absent. The targeted recovery test exited 1 (1 fail); this is a missing wiring/API failure, not a dependency error. Root inspected raw red.log and the actual fixture stack before implementation continued. Raw logs are under .agent_workspace/conversation-recovery-20261020/.

The existing controller store path was independently checked at controller.ts:193 and 209–210. The plan now requires queuePath plus ordinary-file presence checks before calling its status capability; missing stores stay unavailable. A race against external deletion is not claimed atomic.

## Initial GREEN and mapping review

- pnpm test --test-concurrency=1 test/integration/conversation/recovery.test.ts: intended RED exit1 (1 fail), then initial GREEN exit0 (1 pass / 0 fail / 0 skip), 28360.6643 ms. Logs red.log and green-initial.log.
- The first process runs the actual host task and preserves source isolation; the second process loads the actual recovery extension, gets a different generation and reads current run facts without dispatch. This is the initial restart criterion, not full P2 acceptance.
- Root's early targeted source review found that queue action projection filtered only itemId. Shared action directories can contain another queue with that same itemId; a negative regression and queueId-scoped filter are required before acceptance. Root also requested a load-time host configuration mutation regression so source filesystem awaits cannot alter the mapping selected at entry. Both are pending verification, not yet claimed fixed.

## Mapping and privacy regressions

Root requested two concrete regressions. The actual shared-ledger test exposed 2 action rows instead of 1 when a foreign queue used the same itemId; immediate caller mutation during load changed taskRef before validation and produced unknown saved target. Both failed before correction (mapping-red.log, 2 fail, exit1). The correction scopes actions by queueId plus itemId and snapshots all host mapping data before the first filesystem await.

The first broader recovery run also found an ENOENT reference-file error containing the host path, now sanitized to reference-storage-unavailable. That run included a fixture bug (ledger.claim omitted expectedVersion), which was fixed separately and is not a product defect. The raw failed run remains focused-attempt1.log.

Targeted reference/privacy + queue + mutation regression: mapping-green.log, exit0, 3 pass / 0 fail / 0 skip, 7633.2145 ms. Final combined focused, independent actual-source reviews and full gate remain pending.

## Independent specification review, before final closeout

Reviewer conversation_readiness read the actual candidate source/diff/new tests and P2 usage docs before the implementation report. It found one concrete mismatch: the recovery tool description still advertised direct execution although the handler always refuses it. The correction is mode-specific tool wording, not an authority change. The remainder of the inspected mapping, generation, minimal projection, unavailable-data handling and restart design matched the plan. This review is static and does not substitute for final command output.

To close the exact late-result acceptance criterion, the writer is also adding an actual P1 direct-task test: save focus before the original run returns, load a new read-only session, then settle the old task and verify neither the new pointer nor the reference file changes. Existing delayed recovery-status coverage remains separate. Final combined regression and targeted review follow these changes.

## Specification closure and expanded final candidate

The prior combined focused command passed 35/35 (0 fail/skip; 158945.3408 ms, focused-final.log). A further actual pre-runId late-result test was added to close the precise acceptance case; the final 36-test run is in progress (focused-final36.log). Source behavior changed only to select an accurate read-only tool description for recovery mode.

Independent specification reviewer conversation_readiness re-read those two additions and closed its description finding, with no new specification defect. It confirmed the test pauses the real executorFactory before runId allocation, loads a new recovery instance, lets the old checked task settle, and asserts no new-focus/reference-file overwrite or restored authority. This was a static targeted review, not an independent test run. Independent quality review is now in progress.

## Independent quality review

Reviewer roadmap_validation inspected the final P2 plan, actual delta/new source, test assertions and selected logs. It found no concrete defect requiring correction. It checked pre-await host snapshots, saved-target/run allowlists, permanent read-only behavior, bounded run/artifact reads with incomplete-tail handling, queueId/itemId filtering, existing-store checks, minimal projection, explicit reference deletion, fresh generation and real late-result/restart tests. Four read-only commands exited0; scoped diff whitespace check passed. It did not run product tests/builds and did not claim final command success from an in-progress log.

Root document check: 12 changed/new Markdown files, 412 relative references, zero missing paths. This validates file targets, not remote URLs or section anchors. Raw document-links.json. Earlier workflow and diff checks exited0; final reconciliation will repeat required workflow.

## Final focused verification

- pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/ test/integration/conversation/: exit0, **36 pass / 0 fail / 0 skip**, 149524.0862 ms; focused-final36.log. This includes all 28 P1 checks and 8 P2 integration scenarios.
- pnpm typecheck: exit0; typecheck-final.log.
- The first final targeted ESLint identified only an unused setImmediate import in the new recovery test. The writer is removing it and re-running lint; no behavior or assertions change. The full gate will validate the cleaned candidate.
- Independent specification and quality reviews are complete as recorded above. Current full gate/probes remain pending; source writing stops after lint cleanup.

## Final candidate frozen for existing gate

The writer removed only the unused import and stopped writing. Final targeted ESLint: pnpm exec eslint src/conversation/recovery.ts src/conversation/focus.ts src/conversation/session.ts extensions/pi-sparkle/index.ts test/integration/conversation/recovery.test.ts test/fixtures/conversation/restart.ts, exit0 (lint-clean.log; first lint-final.log exit1 is retained).

Root started pwsh -NoProfile -File .agent_workspace/conversation-recovery-20261020/run-p2-gate.ps1, invoking the unchanged pnpm gate under process-local affinity3 / availableParallelism2 / default test concurrency1. No other build/gate overlaps it. Logs p2-gate.log and p2-gate-result.json will record its actual outcome. Only documentation may change during this run; P2 remains unaccepted until the gate and probes finish.

## Final local P2 acceptance (2026-10-20)

P2's bounded acceptance criteria are met on codex/cloud-continuation-20261020 at 26808ad2 plus the reviewed P1/P2 working changes, in Windows / Node24.18.0 / pnpm10.17.1 / Pi0.86.1. P1 was accepted before P2 implementation began. Runtime/test writing stopped before the final full gate; subsequent edits reconcile documentation only.

| Command | Actual result | Retained evidence |
|---|---|---|
| pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/ test/integration/conversation/ | exit0; 36 pass / 0 fail / 0 skip; 149524.0862 ms | focused-final36.log |
| pnpm typecheck | exit0 | typecheck-final.log |
| pnpm exec eslint src/conversation/recovery.ts src/conversation/focus.ts src/conversation/session.ts extensions/pi-sparkle/index.ts test/integration/conversation/recovery.test.ts test/fixtures/conversation/restart.ts | exit0 after removal of one unused test import | lint-clean.log; earlier lint-final.log exit1 retained |
| pnpm gate | exit0; workflow/typecheck/lint pass; 4043 tests, 148 suites: **3995 pass / 0 fail / 0 cancelled / 48 conditional skips**; build PASS | p2-gate.log, p2-gate-result.json |
| pnpm security:probe | exit0; 26 passed, no open/waived/refused findings | p2-security-probe.log |
| pnpm pi:probe | exit0; 4 checks pass for pinned Pi0.86.1 | p2-pi-probe.log, p2-probes-result.json |

Raw evidence directory: .agent_workspace/conversation-recovery-20261020/. The unchanged gate was invoked by pwsh -NoProfile -File .agent_workspace/conversation-recovery-20261020/run-p2-gate.ps1 with process-local affinity3 / availableParallelism2 / default test concurrency1. Whole command: 2026-10-21T04:38:56.1971928Z through 2026-10-21T05:32:04.4641704Z (local date 2026-10-20); test duration 3113513.1162 ms. No concurrent full build, weakened assertion or changed timeout.

Independent specification review closed its inaccurate recovery-tool description finding after the correction and real pre-runId late-result test. Independent quality review found no remaining concrete defect. Both inspected actual source/diff/tests and evidence; they did not independently rerun product tests. The earlier failed reference-error privacy, shared-queue filtering and mutable host mapping cases were reproduced and corrected, with the failed logs retained above.

### Delivered behavior and changed files

- src/conversation/recovery.ts: explicit saveConversationReferences/deleteConversationReferences, validated host mappings, fresh read-only facts and ReadonlyConversationSession. Saved references contain only version/current/suspended projectRef/taskRef/runId; no credentials, prompts, paths or acceptance state.
- src/conversation/focus.ts: validated initial current/suspended locations with a fresh generation. src/conversation/session.ts: exported existing closed parser for reuse.
- extensions/pi-sparkle/index.ts: mutually exclusive conversationRecovery configuration and lazy recovery through the actual Pi tools; default and P1 behavior remain compatible.
- test/integration/conversation/recovery.test.ts and test/fixtures/conversation/restart.ts: eight integration scenarios, including actual two-process Pi-loader restart, reference recovery before runId allocation, followed by late settlement of the old direct task, queue scoping, privacy and corrupt/deleted/stale evidence.
- Usage: [conversation host](../conversation-host.md) and [workflow](../conversation-workflow.md). Accepted scope: [precise plan](../superpowers/plans/2026-10-20-conversation-recovery.md), [status](../status-matrix.md), [active checklist](../../tasks/todo.md).

### Remaining boundaries and next owner

No blocker remains for this bounded local P1/P2 delivery. Recovery always refuses run-direct, including completed/no-run references and new request IDs. Durable execution resumption and cross-process ownership remain a separate future C3 design owned by the host/framework maintainer; a final focus snapshot does not close the pre-runId execution window. Host saves/deletes must be serialized. Controller status may acquire existing read locks and is not an atomic cross-store snapshot; concurrent external deletion is not made transactional.

P3 controlled-driver combination coverage is the next planned slice, with a precise test plan and serialized builds; P4 repair and P5/C4 planning follow their documented dependencies. None was implemented or accepted here. The 48 conditional skips remain skips; no live-provider/crash/benchmark/holdout run, Linux/Node22 qualification, release/preview, main merge or remote publication is claimed. No dependency or lockfile changed. Working changes remain uncommitted.

### Final documentation reconciliation

Root reconciled the accepted plan, status matrix, active tasks/migration rows, route checklist and usage docs. pnpm workflow:check exited0 (10 required files, 16 headings); git diff --check exited0. Relative-path validation checked 12 changed/new Markdown files and 426 references: zero missing targets. Remote URLs and section anchors were not checked. Raw final-workflow.log, final-diff-check.log and final-document-links.json are in the same evidence directory.

Independent final document/evidence review by conversation_readiness found one wording ambiguity about the late-task test: reference recovery happens before runId allocation, and the old task settles later. That description was corrected; no behavior change or test rerun was needed. The reviewer found no other concrete mismatch in scope, final command counts, P1-before-P2 ordering or permanent read-only authority. This was read-only source/document/log review with command exit0, not an independent product test run. No runtime/test/dependency files changed after the passing full gate.

### Requested local commit checkpoint (2026-10-21)

The user requested committing the accepted P1/P2 changes before starting P3. Current precommit regression: pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/ test/integration/conversation/, exit0, 36 pass / 0 fail / 0 skip, 207731.6817 ms. pnpm workflow:check and git diff --check also exit0. Logs: .agent_workspace/p3-controlled-combinations-20261021/precommit-focused.log, precommit-focused-result.json and precommit-workflow.log. No runtime/test/dependency changes occurred between the recorded P2 full gate and this checkpoint; the earlier complete gate remains the full-candidate evidence. This records local commit preparation, not a remote push; the following P3 record will identify the resulting commit.

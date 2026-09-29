# Report execution evidence and handoff

Task: `TASK-20260929-report-execution`. Date: 2026-09-29. Branch: `codex/report-execution-20260929`, draft PR #47. This is author/automated evidence, not independent acceptance.

## Plan and source

The plan was saved before implementation at `cee4527c993a1257fa38048d4b497640ce6492f5`: [execution plan](../superpowers/plans/2026-09-29-report-execution.md). [Slice contracts](../superpowers/plans/2026-09-29-report-slice-contracts.md) define C2-context and D1-learning separately from the remaining A-E roadmap. Starting main was `6ef6a04882ed5a42fa5dae1d37f77b0c48e64689`; merged A1/A2/A0-root/B1 were preserved, not reimplemented.

C2 source is published at `f3a232057975ba5b4607074424a738ffdc43d463` (tree `33e756bdb38118db59e02e44dca61aeb640f876d`). The bounded workflow run `36522164929`, job `109257195394`, applied the staged source, verified it, and made a non-force feature-branch-only commit. Supported Node 22.19.0 / pnpm 10.17.1: `pnpm gate` PASS, 3178 PASS / 0 FAIL / 1 SKIP (3179 total), including build. Security probe 8/8, Pi compatibility 7/7 (pinned Pi 0.70.1), kernel reuse 11/11 PASS. The single skip is the explicitly opt-in real-provider slow-iteration timing probe. No live-provider authorization was assumed.

C2 retains available mandatory constraints, authority, questions, validation routes, predecessor output, instruction references and non-goals or refuses the whole packet. Invalid budgets and conflicting mandatory keys refuse with sanitized errors. Initial parent admission now enters the existing terminal-recording/cleanup path before any child executor call. Non-ASCII estimation is a deterministic packet-payload heuristic, NOT a calibrated tokenizer or a whole-prompt bound. Unavailable validator evidence stays explicit. C2 version/evidence invalidation is not implemented by this slice.

## D1 staged verification (remote source publication pending at this record)

D1 is implemented and verified in the author's supported offline worktree. New 13-case stratification tests are published before the source patch. The temporary bounded workflow will apply only the four specified learning source/test files and the five dated documentation pointers, run the supported gate and probes, then non-force push the feature branch. No main write, deployment or new schema authority is involved. The workflow/patch transport remains temporary and must be removed before delivery.

Verified local RED against original learning source: 33 total / 21 PASS / 12 FAIL / 0 SKIP. Corrected fixture IDs respect repository validation. GREEN: all 135 learning tests PASS / 0 FAIL / 0 SKIP. Full supported local `pnpm gate`: 3194 total / 3193 PASS / 0 FAIL / 1 SKIP; workflow check, typecheck, lint, tests and build PASS. Security 8/8, Pi compatibility 7/7 and kernel reuse 11/11 PASS. Built CLI version is 0.8.0. These are local author-command results, not yet the remote D1 result or independent review.

D1 groups taskSuccess by project/model/family/role/available model and feature version. Reimported task identity counts once despite changed timestamp/prose/evidence order; contradictory binding, outcome, score or attribution excludes that task. Invalid scores and non-model failures do not create model negatives. Unbound observations remain diagnostic, not actionable. Primary-model issues remain visible without automatic replacement. Known role/version qualifiers are never discarded to create broader legacy avoid rules; a scope-preserving typed candidate bridge remains open. Persisted observation identity, posterior behavior, live selection and activation gates are unchanged.

## Acceptance and remaining work

Independent review and main merge of these new slices are NOT complete. Source/commands do not imply Outcome-supported status. S0-min is implemented/source-reviewed but NOT owner-FROZEN; B2/L1/L2 depend on that freeze. O02/O03 retained-worktree ownership, existing D1 evidence-gap review, R10/R11, F6/F-PROD and production/live-provider/outcome gates remain as recorded. Shared root budgets, scoped decision memory, C2 evidence invalidation, typed method candidates, authorized independent/holdout comparisons and controlled activation outcomes remain unimplemented or gated, not checked off as complete. See [execution checklist](../../tasks/report-execution-todo.md).

The first C2 full-gate failure and its stricter checkpoint correction are retained in [follow-up evidence](2026-09-29-context-gate-followup.md); earlier RED commits are not green acceptance artifacts. The source transfer mechanism and its limits are recorded in [transport note](2026-09-29-report-transport.md).

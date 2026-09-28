# GitHub and local branch synchronization — 2026-09-28

## Identity

- ID: `TASK-20260928-sync-merge`
- Owner: Codex coordinator, user-authorized synchronization and compatible branch merges.
- State: `in-progress`.
- Opened: 2026-09-28 (Asia/Shanghai).
- Authority: `AGENTS.md`, `docs/development-workflow.md`, active task files, ADR-006/008 and existing Stage 0 boundaries.

## Problem and Scope

Synchronize the fetched GitHub branches and committed local work without losing unfinished work. Starting remote/local main is `1b04aa9d`; fetched PR #46 head is `ce529a4d` (12 commits ahead, hosted checks successful). Reuse the idle, clean main worktree on integration branch `codex/sync-merge-20260928`; the original checkout and other dirty worktrees remain recoverable.

In scope: inspect all 14 initial local branches and both remote branches; integrate PR #46, independently reviewed S0-min implementation if eligible, and patch-equivalent O09 ancestry; verify and publish a normal fast-forward update; refresh the original local checkout while preserving its draft material. Preserve all other branch refs, existing stash and dirty worktrees.

Out of scope: implementing unfinished O02/O03, rewriting history, force pushing, deleting branches/worktrees, restoring old storage designs, production apply, live providers, holdout, F6, or declaring S0-min FROZEN. No new hash, baseline, contract freeze, or gate is introduced by this sync task.

## Acceptance Criteria

- [ ] Fetch latest remote refs and inventory every local branch with exact starting revisions and merge previews.
- [ ] Merge only reviewed compatible candidates; record conflict-bearing or unfinished branches explicitly.
- [ ] Focused regression tests, existing `pnpm gate`, `pnpm security:probe`, and `pnpm pi:probe` pass on the integrated source; skips remain skips.
- [ ] Preserve the original four dirty paths, existing O02 stash, and other dirty worktrees; no reset/clean or destructive recovery.
- [ ] Published main and usable local source are synchronized and verified using `git ls-remote` plus local refs/status.
- [ ] Update the active plan/checklist and a dated verification report with exact commands, outcomes, review findings and remaining work.

## Implementation Slice

| Files/symbols | Change | Dependency/risk |
|---|---|---|
| PR #46's existing 29-file diff | Physical directory identity, argument/intent parsing, read-only task contracts | Independent review and native/requirement regression tests; existing authorization boundaries remain |
| S0-min's existing 10-file diff | Existing canonicalizer extraction and neutral host outcome DTO | Exact-revision spec review then quality review; no owner freeze or runtime activation |
| O09 history | Record already cherry-picked commits as merged, provided tree remains unchanged | Verify patch equivalence and empty tree diff |
| `tasks/plan.md`, `tasks/todo.md`, this plan and dated sync report | Durable synchronization evidence | Keep task acceptance separate from integration |

## Test-First Plan

No new runtime behavior is authored in this integration task. Existing candidates include their original RED/GREEN evidence and regression tests. Any new conflict-driven behavior fix must first gain a reproducing test; conflict-bearing branches are deferred rather than auto-resolved without the human review required by the workflow.

- Focused: `pnpm test -- --test-concurrency=1 test/unit/native/ test/integration/native/ test/unit/requirement/ test/unit/track/ test/unit/domain/canonical-json.test.ts test/unit/evaluation/ test/unit/experiments/freeze.test.ts test/unit/experiments/task-spec.test.ts test/unit/experiments/readonly-evaluator-manifest.test.ts test/integration/experiments/`
- Build prerequisite: `pnpm build` (some existing tests consume dist).
- Existing delivery checks: `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe`, `git diff --check`.
- Temporary logs/inventory: `.agent_workspace/sync-20260928/` (original checkout and integration worktree); durable summary under `docs/reports/`.

## Gates and Handoff

- Current clean candidates: PR #46, S0-min, and O09 ancestry; prior B0/controlled-improvement/reliability tips are already ancestors of main.
- Deferred conflict candidates: CI E1/E1-support/E2/N1/N3, offline-fixes, stage0-review (13–20 conflicts, older implementation/planning); D1 (one documentation conflict). Existing branch pointers are retained.
- Stop source publication for a failed relevant check, unresolved important review finding, unexpected remote advancement or conflict requiring human resolution.
- Independent review does not close owner freeze, R10/R11, F6, live/experimental approval or task-wide reliability acceptance.

## Closeout

Pending exact verification, independent review, publication, local refresh and preservation audit. Next action: stage the clean S0-min merge, run focused checks and the existing gate, then act on independent findings.

## Integration review amendment — 2026-09-28

Independent review found two bounded merge blockers. S0-min overstated what a
byte parser can establish about legacy producer provenance; correct only the
comment/specification and append a dated historical correction. PR #46's test
intent heuristic treated "do not add tests" as cancelling an explicit request
to run existing tests. Reproduce with bilingual extractor/planner regressions,
then narrow negative-scope handling in `src/requirement/objective-intent.ts`.
Keep direct no-run/no-tests restrictions and readonly behavior unchanged.

Acceptance for the small behavior correction: explicit English/Chinese
existing-test execution retains `ac-tests` and a tester even when new tests are
forbidden; direct execution prohibitions still remove both. Test first with
`pnpm test -- --test-concurrency=1 test/unit/requirement/report-regressions.test.ts`,
then the neighboring requirement/track suites and a fresh full gate. Obtain
independent delta review before main publication.

S0-min quality review identified a concrete strict-serialization bypass: array
subclasses can override `map` or `join`, suppress value validation and silently
change canonical bytes. Extend the existing plain-value refusal to array
prototypes, with RED/GREEN adversarial array tests. This enforces the already
specified strict JSON boundary; it adds no authority, store, hash or gate and
keeps the legacy compatibility wrapper unchanged. Re-review the exact revised
source and its tests before publication.

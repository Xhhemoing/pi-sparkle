# GitHub/local synchronization verification — 2026-09-28

## Identity

- Task: `TASK-20260928-sync-merge`.
- Date/environment: 2026-09-28, Windows, PowerShell 7, Node 24.18.0, pnpm 10.17.1.
- Owner: Codex coordinator; explicit user request to synchronize latest GitHub/local source and merge compatible branches.
- Initial main: `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`.
- Integration branch: `codex/sync-merge-20260928` in the existing clean reliability worktree.
- State: in progress; no final full-gate or publication claim yet.
- Plan: [sync/merge plan](../superpowers/plans/2026-09-28-sync-merge.md).

## Inventory and branch decisions

`git fetch --all --prune --tags` fetched the previously absent PR #46 branch.
Remote main was unchanged; the remote has main and the PR branch. The initial
14 local branches and their disposition are below. Previews are against the
initial main, not assertions that all old branch changes are absent from it.

| Branch | Initial tip | Decision/evidence |
|---|---|---|
| main | `1b04aa9d` | Publication target after checks |
| codex/controlled-improvement-20260925 | `e1ce19c0` | Already ancestor of main; original dirty checkout preserved |
| codex/controlled-improvement-b0-20260925 | `e1ce19c0` | Already ancestor of main |
| codex/reliability-optimization-20260927 | `8ccdc1f9` | Already ancestor of main |
| codex/offline-determinism-o09 | `0fb65cc6` | Both commits patch-equivalent to main; consolidate ancestry only if tree stays identical |
| codex/controlled-improvement-s0-min-20260925 | `d095a099` | Clean 10-file merge candidate; exact spec/quality review and existing checks required; not FROZEN |
| codex/controlled-improvement-d1-20260925 | `c6a5b1a9` | Deferred: one conflict in historical D1 verification report; task acceptance/review remains open |
| codex/ci-e1-20260925 | `a7c102d3` | Deferred: 19 conflicts in older implementation/planning |
| codex/ci-e1-support-20260925 | `3f406613` | Deferred: 19 conflicts |
| codex/ci-e2-20260925 | `17204d05` | Deferred: 19 conflicts |
| codex/ci-n1-20260925 | `a6f7a618` | Deferred: 19 conflicts |
| codex/ci-n3-20260925 | `3b422174` | Deferred: 19 conflicts |
| codex/offline-fixes-20260925 | `00af6bed` | Deferred: 20 conflicts; older storage design is not reactivated |
| codex/stage0-review-20260924 | `246dbd90` | Deferred: 13 conflicts plus uncommitted work |
| origin/codex/report-plan-phase-a-20260927 | `ce529a4d` | PR #46, 12 commits ahead of main; hosted quality/Linux/Windows checks successful; fresh review/checks required |

All branch pointers are retained; no `ours` merge is used to hide conflicts.
Per the existing workflow, any later agent-resolved conflict hunks need human
line-by-line review before publication. This sync does not silently decide
between incompatible historical status or implementation records.

## Independent review and corrections

- PR #46 review at exact `ce529a4d` against `1b04aa9d`: REQUEST CHANGES, one Important/P2. English/Chinese requests to run existing tests while forbidding new tests lost both the acceptance criterion and tester. Reviewer independently executed 60 requirement/parser/normalization tests (60/0/0); this is separate from coordinator checks.
- Coordinator regression: the six new scoped-intent cases produced 36 pass / 3 expected fail among 39 tests. The smallest correction narrows creation-only negatives when existing-test execution is explicit, while retaining execution/global prohibitions. Requirement/track follow-up: 78 pass / 0 fail / 0 skip. Two additional negative-execution variants then exposed 39 pass / 2 expected fail; a narrow qualifier correction produced final 80 pass / 0 fail / 0 skip.
- S0-min SPEC review at exact `d095a099` against `e1ce19c0`: REQUEST CHANGES, one P2 inaccurate compatibility/provenance claim. Strict serialization correctly refuses invalid original JS values, but legacy serialization can collapse those values to valid canonical bytes. Source comment/specification were corrected, and a dated correction appended to the historical report. No serialization/runtime behavior changed. Five executed cases demonstrate the distinction.
- Delta specification review, S0-min quality review and PR correction review are pending. No self-review is described as independent, and no owner freeze or policy acceptance follows from source integration.

## Commands

Raw logs are under `.agent_workspace/sync-20260928/`. The initial ref/conflict/
preservation inventory is in that directory of the original checkout; test
logs are in the same relative directory of the integration checkout.

| Command | Result | Notes/evidence |
|---|---|---|
| `git fetch --all --prune --tags`; branch/worktree/stash inventory; `gh pr list/view` | PASS | `refs-before.txt`, per-branch merge previews, `preserved-worktrees.json` |
| `git cherry main codex/offline-determinism-o09` | PASS | Two equivalent patches, no unique patch |
| `git merge --no-ff --no-commit codex/controlled-improvement-s0-min-20260925` | PASS, staged candidate | No conflict; 10 files |
| `pnpm build` | PASS | `build.log`; existing dist-dependent tests require this |
| Focused command in linked plan | PASS | `focused.log`: 262 pass / 0 fail / 0 skip; before intent correction |
| `pnpm test -- --test-concurrency=1 test/unit/requirement/report-regressions.test.ts` | EXPECTED FAIL (RED) | `test-intent-red.log`: 36 pass / 3 fail, before correction |
| `pnpm test -- --test-concurrency=1 test/unit/requirement/ test/unit/track/` | PASS | `test-intent-green.log`: 78 pass / 0 fail / 0 skip |
| `pnpm exec tsx .agent_workspace/sync-20260928/legacy-provenance-probe.ts` | PASS | `legacy-provenance-probe.log`: five original-value refusals and corresponding accepted legacy byte forms |
| `pnpm gate` (initial integration run) | PASS, superseded for final delivery | `gate.log`: 3145 pass / 0 fail / 18 skip; source was subsequently corrected, so a stable-source rerun is required |
| `pnpm security:probe`; `pnpm pi:probe` | NOT RUN YET | Existing checks, not new gates |

Probe setup mistakes are not product failures: a multiline pnpm `--eval`
attempt emitted no output and was not evidence; a first file-based attempt
passed text to a byte API and failed. The corrected probe supplies UTF-8 bytes,
executes five assertions and retains nonempty output.

## Preservation and remaining boundaries

The original checkout has four planning/report drafts; three other worktrees
have uncommitted work (4, 34 and 4 paths respectively). They are not merged as
finished work. Existing O02 stash object
`b484c3e2c0af33577316d10f518e31002300f6f1` is retained. No dirty/in-use
worktree, branch, ignored project data or stash is deleted.

Integration does not accept D1 or freeze S0-min; L1/L2, broader A0/O02/O03,
R10/R11, F6/F-PROD, production apply and live-provider/holdout validation remain
separate. No real provider, crash, benchmark, holdout, production apply or
release run is included. Deferred conflicts belong to the maintainer and
original slice owners; resume only with a concrete reconciliation and the
existing required review.

## Publication and handoff

Pending final checks and independent delta review. Publish using normal
fast-forward Git push only; refetch first and stop/reconcile if main advanced.
Then verify remote main, local main and the original checkout, retain drafts
recoverably and record exact final commits/status here and in active tasks.

## Independent delta findings and final correction candidate

- S0-min SPEC at `a8058948`: PASS for the corrected provenance wording; no owner freeze.
- PR delta at `a8058948`: REQUEST CHANGES for one qualified double negative (`do not skip existing tests`). A new regression failed as intended (43 pass / 1 fail); qualifier-aware normalization restored the requirement and preserved unnegated skip. Final requirement/track result: 83 pass / 0 fail / 0 skip (`test-intent-green-reviewed.log`).
- S0-min QUALITY at `a8058948`: REQUEST CHANGES for one strict-array prototype bypass. Independent fixed-ref code/test execution: 28 pass / 0 fail / 0 skip, plus separate concrete map/join override reproducers. Coordinator RED: 5 pass / 2 fail; existing strict plain-value validation now refuses custom array prototypes before method dispatch. S0/evaluation/experiment follow-up: 77 pass / 0 fail / 0 skip (`s0-green-reviewed.log`). Tests also pin the unchanged legacy-wrapper bytes for both subclass cases.
- The provisional `gate-final.log` run was explicitly stopped after the new review finding; it is INTERRUPTED, not passed. Only the final stable-source run will establish delivery evidence. The earlier initial integration gate remains historical 3145/0/18.
- Final correction typecheck and targeted ESLint both passed (`reviewed-typecheck.log`, `reviewed-lint.log`). Fresh exact-revision spec/quality/PR delta verdicts are still required before publication.

# GitHub/local synchronization verification — 2026-09-28

## Identity

- Task: `TASK-20260928-sync-merge`.
- Date/environment: 2026-09-28, Windows, PowerShell 7, Node 24.18.0, pnpm 10.17.1.
- Owner: Codex coordinator; explicit user request to synchronize latest GitHub/local source and merge compatible branches.
- Initial main: `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`.
- Integration branch: `codex/sync-merge-20260928` in the existing clean reliability worktree.
- State: accepted for scoped synchronization; compatible branches published and original checkout refreshed. Eight conflict-bearing branches remain explicitly deferred.
- Plan: [sync/merge plan](../superpowers/plans/2026-09-28-sync-merge.md).

## Inventory and branch decisions

`git fetch --all --prune --tags` fetched the previously absent PR #46 branch.
Remote main was unchanged; the remote has main and the PR branch. The initial
14 local branches and their disposition are below. Previews are against the
initial main, not assertions that all old branch changes are absent from it.

| Branch | Initial tip | Decision/evidence |
|---|---|---|
| main | `1b04aa9d` | Published and remote-verified at `bb6d59c8`; subsequent closeout commits are documentation only |
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
| origin/codex/report-plan-phase-a-20260927 | `ce529a4d` | PR #46: initial 12-commit candidate passed hosted checks; source corrected/reviewed locally, integrated and marked MERGED by GitHub |

All branch pointers are retained; no `ours` merge is used to hide conflicts.
Per the existing workflow, any later agent-resolved conflict hunks need human
line-by-line review before publication. This sync does not silently decide
between incompatible historical status or implementation records.

## Independent review and corrections

- PR #46 review at exact `ce529a4d` against `1b04aa9d`: REQUEST CHANGES, one Important/P2. English/Chinese requests to run existing tests while forbidding new tests lost both the acceptance criterion and tester. Reviewer independently executed 60 requirement/parser/normalization tests (60/0/0); this is separate from coordinator checks.
- Coordinator regression: the six new scoped-intent cases produced 36 pass / 3 expected fail among 39 tests. The smallest correction narrows creation-only negatives when existing-test execution is explicit, while retaining execution/global prohibitions. Requirement/track follow-up: 78 pass / 0 fail / 0 skip. Two additional negative-execution variants then exposed 39 pass / 2 expected fail; a narrow qualifier correction produced final 80 pass / 0 fail / 0 skip.
- S0-min SPEC review at exact `d095a099` against `e1ce19c0`: REQUEST CHANGES, one P2 inaccurate compatibility/provenance claim. Strict serialization correctly refuses invalid original JS values, but legacy serialization can collapse those values to valid canonical bytes. Source comment/specification were corrected, and a dated correction appended to the historical report. No serialization/runtime behavior changed. Five executed cases demonstrate the distinction.
- Initial checkpoint (superseded by the exact revised review outcomes below): delta specification review, S0-min quality review and PR correction review were pending. No self-review is described as independent, and no owner freeze or policy acceptance follows from source integration.

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
| `pnpm security:probe`; `pnpm pi:probe` (final delivery run) | PASS | 26 security probes, zero findings/waivers; all 4 Pi pin/import checks passed |

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

Independent source reviews PASS at `3f5711ba`; the test-only delta at `14a50358` and final full gate/probes also PASS. Publish using normal
fast-forward Git push only; refetch first and stop/reconcile if main advanced.
Then verify remote main, local main and the original checkout, retain drafts
recoverably and record exact final commits/status here and in active tasks.

## Independent delta findings and final correction candidate

- S0-min SPEC at `a8058948`: PASS for the corrected provenance wording; no owner freeze.
- PR delta at `a8058948`: REQUEST CHANGES for one qualified double negative (`do not skip existing tests`). A new regression failed as intended (43 pass / 1 fail); qualifier-aware normalization restored the requirement and preserved unnegated skip. Final requirement/track result: 83 pass / 0 fail / 0 skip (`test-intent-green-reviewed.log`).
- S0-min QUALITY at `a8058948`: REQUEST CHANGES for one strict-array prototype bypass. Independent fixed-ref code/test execution: 28 pass / 0 fail / 0 skip, plus separate concrete map/join override reproducers. Coordinator RED: 5 pass / 2 fail; existing strict plain-value validation now refuses custom array prototypes before method dispatch. S0/evaluation/experiment follow-up: 77 pass / 0 fail / 0 skip (`s0-green-reviewed.log`). Tests also pin the unchanged legacy-wrapper bytes for both subclass cases.
- The provisional `gate-final.log` run was explicitly stopped after the new review finding; it is INTERRUPTED, not passed. Only the final stable-source run will establish delivery evidence. The earlier initial integration gate remains historical 3145/0/18.
- Final correction typecheck and targeted ESLint both passed (`reviewed-typecheck.log`, `reviewed-lint.log`). Fresh exact-revision spec/quality/PR delta verdicts are still required before publication.

## Exact revised review outcomes — 2026-09-28

All source verdicts below bind to `3f5711ba792094aabe837cc41539038920b8f8ef`:

- PR #46 correction delta: **PASS**, no outstanding findings. Independent fixed-ref execution: 44 report regressions plus 8 supplementary positive/negative assertions, all passed.
- S0-min specification delta: **PASS**; 6 independent assertions covering both subclass refusals, both preserved legacy outputs, ordinary-array bytes and parser round trip.
- S0-min quality delta (after SPEC PASS): **PASS**, no outstanding findings. Independent fixed-ref execution: 30 directly changed unit tests and 11 supplementary assertions, all passed.

Full `main..candidate` whitespace review additionally found seven inherited
Markdown hard-break lines in PR documentation. Their trailing double spaces
were replaced with equivalent backslash hard breaks; no semantic code changed.
The follow-up main-to-working-tree diff check and conflict-marker scan pass.
An inventory comparison confirms all 11 non-integration worktrees still have
their original status; the four dirty worktrees and O02 stash remain intact.

## Full-gate failure and bounded fixture correction

The stable-source `pnpm gate` attempt in `gate-reviewed-final.log` failed:
3151 pass / 1 fail / 18 skip. `inspect-follow.test.ts:170` expected 12 events
but received the terminal snapshot's 11. The complete failure remains retained.
The exact file passed in isolation (12/12, `inspect-follow-recheck.log`).

Source inspection identifies the race, rather than assuming a random failure:
`followRunEvents` returns after a read reaches a stopping status, while the test
completed RUN_COMPLETED then appended later fixture records in separate awaited
writes. A poll between these writes validly stops at 11. Git comparison with
initial main confirms the fixture, CLI reader, inspection, JSONL and EventStore
runtime files were unchanged by this integration.

The test now appends the remaining terminal-line bytes and all following fixture
records together, preserving its partial-line phase and every existing
assertion. No production behavior or test expectation is relaxed. The focused
rerun, independent fixture review and subsequent full gate are recorded below;
the failed attempt is not counted as passing evidence.

## Final pre-publication verification

Verified source/test revision: `14a5035848073f706a166f5e6148a36487d9402c`.
Runtime source is byte-identical to independently reviewed `3f5711ba`.
The test-only delta received independent PASS; AST comparison confirmed all
54 assert calls in the file are unchanged. No production behavior was altered
by that fixture repair.

| Exact command | Result | Retained output |
|---|---|---|
| `pnpm test -- --test-concurrency=1 test/integration/cli/inspect-follow.test.ts` | PASS: 12 / 0 / 0 | `inspect-follow-fixed.log` |
| `pnpm gate` | PASS: workflow, typecheck, lint, 3152 pass / 0 fail / 18 skip, build | `gate-delivery.log`, 3170 total tests, 146 suites |
| `pnpm security:probe` (evidence-local npm cache) | PASS: 26, no open/waived/refused findings | `security-probe.log` |
| `pnpm pi:probe` | PASS: 4 pin/import checks | `pi-probe.log` |
| `git diff --check origin/main..HEAD`; conflict-marker scan | PASS | No unresolved markers or trailing-space defects |
| `git merge-base --is-ancestor <included-ref> HEAD` | PASS for all 6 named included refs | PR46/S0-min/O09 plus previously integrated controlled-improvement/B0/reliability tips |

The 18 skips remain skips. No provider/crash/benchmark/holdout/release result is
claimed. The initial gate, interrupted provisional run, failed race-exposing
gate, RED regressions and final passing run remain separately recorded.

## Verified publication and local refresh

- Normal push succeeded: `1b04aa9d..bb6d59c8 main -> main`. `git ls-remote origin refs/heads/main` exactly matched local main `bb6d59c82467954c77a414f7bfe939623cb4b51a` immediately afterward.
- GitHub PR #46 reports **MERGED**, merge commit `1d0978fefb1b12a42cd64ec3a0d24976792985a6`, merged at `2026-09-28T05:49:06Z`.
- Original `E:\Project\pi-sparkle` checkout is now on `main`, fast-forwarded to the integrated source and clean. No reset, clean, forced push, branch deletion or worktree disposal was used.
- All four original planning/report drafts are preserved in `c967dcf3391d9c0dd5b7e530e9669752cc9c0e3e`, currently `stash@{0}` (`sync-20260928: preserve original planning drafts`). Its exact four paths were checked against the pre-sync inventory. They were not reapplied over newer main documents.
- Original O02 stash `b484c3e2c0af33577316d10f518e31002300f6f1` remains listed, currently `stash@{1}`. The other three dirty worktrees and all original non-main branch tips are retained.
- Test/probe logs were copied into the original checkout's `.agent_workspace/sync-20260928/` alongside branch previews, preservation inventory and `publication.json`. Local recovery: inspect the named stash and selectively restore drafts in a separate working context if needed; do not blindly pop older plan files over current main.
- Subsequent closeout commits update only records/checklists. They do not change the tested/reviewed runtime source or tests. Remote/local equality is rechecked after the final evidence push; hosted CI remains a separately observed result, not inferred from local tests.

Handoff: eight incompatible old branches remain local, with exact conflict
counts above. Maintainer/original slice owners should reconcile those histories
and obtain the existing required human review of conflict hunks before later
merges. S0-min owner freeze, D1/L1/L2, O02/O03, production/live/provider/holdout
and policy gates remain open as documented. This sync task is complete within
that scope.

# O09 offline determinism verification — 2026-09-27

## Identity

Task: `TASK-20260927-o09-offline-determinism`; source revision `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669`; isolated branch `codex/offline-determinism-o09`. Owner: current coordinator. [Plan](../superpowers/plans/2026-09-27-o09-offline-determinism.md).

User authorized plan execution and cross-chat coordination. This checkout owns O09 only; the other reliability checkout remains in use and must not be overwritten or archived. Original dirty planning files are retained.

## Commands

The chronological RED/GREEN, review and gate results below supersede the initialization snapshot. Raw logs: `.agent_workspace/verification/2026-09-27-o09/`.

## Behavioral Evidence

O09b intentionally replaces anchor-only membership with stable greedy complete-link admission. O09a's predictive effect interpretation must be recorded before production edits. Public report fields remain unchanged unless a documented compatibility decision proves necessary.

## Risks and Gates

This is offline correctness work, with no real-world effectiveness claim. No new integrity system/gate/hash, no live/provider/holdout/crash/benchmark run. S0-min, R10/R11 and F6 remain separately open. O09 does not accept other reliability work.

## Handoff

The bounded offline implementation and independent reviews are complete as recorded below. The integration owner takes the reviewed commits through merge, final branch verification and GitHub publication.

## Initial command verification

Environment: Windows, Node 24.18.0, pnpm 10.17.1; pwsh; pinned dependencies installed with `pnpm install --frozen-lockfile --offline`, exit 0. The install reported ignored dependency build scripts (`@google/genai`, `protobufjs`); no approval or dependency version change was made.

- Pre-change command: `pnpm test -- --test-concurrency=1 test/unit/routing/offline-logit.test.ts test/unit/experiments/attribution-report.test.ts` — PASS, 5 tests, 0 failures/skips (2026-09-27). Raw log `prechange-logit.log` under the directory above. This is pre-change characterization, not acceptance of O09.
- Cross-chat handoff confirmed: other coordinator owns all non-O09 packages. Full suite will run in one lane; this chat will request that lane after focused checks/reviews.

## O09a pre-implementation decision

The plan now records `logit-standardized-v2` formulas and the dated correction to Phase C. Scope is canonicalization, removal of redundant reference interaction columns, unregularized rank refusal before numerical ridge, and equally defined model/project/interaction predictive effects. All rows are retained. No universal per-cell sample gate or common-support filter was added. New report reasons will identify the interpretation revision; historical evidence is unchanged. Full-grid predictions are model-based and may extrapolate; no causal or real-world benefit claim follows.

## O09b behavioral verification and specification review

- Author pre-change focused: 14 PASS, zero failures/skips.
- Author RED: `pnpm test -- --test-concurrency=1 test/unit/learning/patterns.test.ts` — FAIL as intended: 27 leaf tests, 16 PASS / 11 FAIL, 11 `ERR_ASSERTION` failures. The bridge-first case returned count 3, violating minimum pairwise similarity. Log: `o09b-red.log`.
- Author GREEN: same focused command — 27 PASS / 0 FAIL / 0 SKIP. Log: `o09b-green.log`.
- Author neighboring acceptance: `pnpm test -- --test-concurrency=1 test/unit/learning/patterns.test.ts test/acceptance/adaptive-loop.test.ts` — 29 PASS / 0 FAIL / 0 SKIP. Author scoped ESLint and `git diff --check` both exit 0. Exact author commands/logs: `o09b-report.md`.
- Independent specification review: `review_o09b_spec`, PASS on the current two-file diff against `e1ce19c0`. Reviewer inspected exact identity sorting, bridge-first six permutations, every-member admission and unchanged policies; independently ran `pnpm exec tsx --test test/unit/learning/patterns.test.ts`, 27 PASS / 0 FAIL / 0 SKIP. Reviewer raw record: `o09b-spec-review.md`. This is independent agent review, not human approval. Separate quality review is pending.

Log paths in this section are relative to `.agent_workspace/verification/2026-09-27-o09/`. This repository report preserves the command results; raw local logs remain available for integration handoff.

## O09b independent quality review

`review_o09b_quality` returned PASS with no actionable P1/P2/P3 findings on the same two-file diff after specification PASS. It independently ran `pnpm test -- --test-concurrency=1 test/unit/learning/patterns.test.ts` (27 PASS, 0 FAIL/SKIP), `pnpm workflow:check` (10 files/16 headings, exit 0), and scoped `git diff --check` (exit 0). The reviewer checked changed-code complexity, exact-content ordering, admission invariant, input ownership and policy compatibility. Review artifact: `.agent_workspace/verification/2026-09-27-o09/o09b-quality-review.md`. This closes O09b's agent review steps only; full-slice gate remains pending.

## O09a RED evidence

Author ran `pnpm test -- --test-concurrency=1 test/unit/routing/offline-logit.test.ts` after adding behavioral regressions and before production edits: FAIL as intended, 9 tests / 3 PASS / 6 FAIL. Failures cover the balanced weak-reference interpretation, record permutation, confounded design, tuple-name collision, rank-losing bootstrap, and interpretation marker on invalid reports. The existing separable negative weak-effect case remains a retained acceptance constraint. Raw output: `.agent_workspace/verification/2026-09-27-o09/o09a-red.log`. GREEN and reviews are pending; the version-label failure alone is not used as proof of numerical correctness.

## Delivery authorization update — 2026-09-27

The user explicitly requested completing the current phase, merging local branches, cleaning local workspaces, and finally committing/pushing current non-sensitive project data to GitHub. The other reliability chat confirmed ownership of the single integration/merge/push lane. The executable reliability phase remains O01-O11 unless the owner later narrows it; this O09 slice alone cannot close that phase. O12 and pre-existing human/experimental/production boundaries remain separate.

O09 will supply reviewed commits and evidence for integration. Its worktree stays in use until integration is confirmed. Cleanup must preserve unfinished branches, in-use trees and needed ignored artifacts; use recoverable native archival for managed worktrees after content inventory. Publication must inventory tracked/untracked/ignored project data and exclude secrets, authentication material and raw private transcripts. No merge, archive or push is claimed by this authorization record.

## Coordinator focused verification

- `pnpm test -- --test-concurrency=1 test/unit/routing/offline-logit.test.ts test/unit/routing/offline-prob-add.test.ts test/unit/routing/offline-types.test.ts test/unit/experiments/attribution-report.test.ts test/unit/learning/patterns.test.ts test/acceptance/adaptive-loop.test.ts` — PASS, 45 tests, 0 FAIL/SKIP (2026-09-27); raw `combined-focused.log`.
- `pnpm typecheck` — PASS, exit 0; raw `typecheck.log`.
- `pnpm workflow:check` — PASS, 10 required files and 16 headings. This check does not claim exhaustive Markdown/link validation.
- O09a initial author GREEN: 9/9 focused PASS; specification review is in progress. O09b two-stage review is already PASS. Full gate still pending the coordinated lane and final review.

## O09a specification review — REQUEST CHANGES

Reviewer `review_o09a_spec` independently passed 13 focused tests, then reproduced a P1 identifiability gap in `hasFullColumnRank`: the unscaled Gram matrix plus shared solver's absolute pivot threshold accepts an exactly dependent design under repeated-row counts. Four model/project cells with scenario `s-a` iff model index equals project index obey `a = intercept - u - v + 2w` exactly.

- Counts `[5353,5568,5227,3418]`, 19,566 alternating-outcome rows: expected immediate rank-deficient INVALID_ESTIMATE; actual base fit proceeded and later returned insufficient successful bootstrap draws. Assertion exit 1; `o09a-spec-rank-default.log`.
- Counts `[53530,55680,52270,34180]`, 195,660 rows, `{bootstrap:40, seed:7}`: actual returned ten effects with narrow intervals and a non-INVALID reason despite exact dependence. Assertion exit 1; `o09a-spec-rank-scaled.log`.

This is a real review finding, not a waived test. O09a remains unaccepted. Author is adding a bounded RED regression and repairing rank detection without changing shared solver/IRLS or adding dependencies. Both base and bootstrap must use the repaired rank primitive. Specification re-review must precede quality review.
## O09a P1 repair and independent re-review

The first specification review's `REQUEST CHANGES` above is retained as provenance; it was not waived. The author added a 19,566-row exact-dependency regression before changing production code: `pnpm test -- --test-concurrency=1 test/unit/routing/offline-logit.test.ts` returned 10 pass / 1 expected fail (`o09a-rank-red.log`). The pre-fix reason was insufficient bootstrap success instead of immediate rank-deficient `INVALID_ESTIMATE`.

The repair checks the direct row space of unique binary design supports, with repeated orthogonalization and a scale-aware tolerance. Both the base fit and each bootstrap draw run this unregularized rank check before inherited ridge/IRLS. Shared `lin-alg.ts` and the existing IRLS solver block were not changed. The same focused command then passed 11/11 (`o09a-rank-green.log`); 18/18 focused plus adjacent offline/attribution tests passed (`o09a-adjacent.log`), scoped ESLint and `pnpm typecheck` exited 0, and scoped `git diff --check` was clear. The reviewer's scaled 195,660-row repro with bootstrap 40 / seed 7 returned immediate rank-deficient `INVALID_ESTIMATE`, zero effects, and exit 0 (`o09a-rank-scaled-green.log`). Author details: `o09a-author-handoff.md`.

Independent specification re-review returned PASS, with 15/15 focused tests and five independent probes covering both prior failures, a full-rank control, a unique-row/column dependency and bootstrap rank loss (`o09a-spec-rereview.md`, `o09a-spec-rereview-probes.log`). A separate independent quality review returned PASS with no actionable P1/P2/P3; 12/12 focused tests passed, and a BigInt exact-elimination oracle agreed with the numeric rank result on 300 varied designs (207 full rank, 93 deficient, up to 29 columns), including reversed inputs. It also checked successful-draw boundaries and unequal scenario weights (`o09a-quality-review.md`, `o09a-quality-probes.log`). These are independent agent checks, not human or statistical calibration approval.

## Coordinator gate and bounded closeout

On the combined O09a/O09b/O08b working tree, the coordinator ran `pnpm build` followed by `pnpm gate` on 2026-09-27. Both exited 0. The gate included workflow check, typecheck, lint, tests and final build; its test runner reported **2907 pass / 0 fail / 18 skip**. Evidence: `pre-gate-build.log`, `o09-o08b-gate.log`, `o09-o08b-gate-result.json` under `.agent_workspace/verification/2026-09-27-o09/`. The prebuild was needed on this older source base because a separate holdout helper test imported a missing `dist` artifact; the other integration branch has a clean-tree import repair. The final integrated branch must run its applicable gate separately. Documentation-only closeout edits followed this gate and receive a fresh `pnpm workflow:check` before commit.

O09a and O09b satisfy the bounded offline acceptance criteria and both independent review stages. The v2 predictive contrasts, treatment references, JSON-tuple interaction names and report reasons are a deliberate interpretation/compatibility revision for new reports; historical reports are not rewritten. Missing cells are model extrapolations, interactions on the probability scale may reflect link nonlinearity, and the retained thresholds/LCB heuristic are not newly calibrated. This work does not establish causal or real-world benefit, alter a live selector or active pointer, or close S0-min, R10/R11, F6, provider, holdout or production gates.

The exact reviewed O09 commit and integration SHA will be recorded at handoff. Other O01–O11 work remains owned by the integration chat. Raw logs/probes and private session context in `.agent_workspace` are not automatically publication-safe; only individually screened, necessary evidence may be promoted. The worktree remains in use until integration is confirmed.

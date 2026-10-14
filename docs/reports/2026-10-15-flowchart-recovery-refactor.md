# Flowchart child recovery refactor verification

## Identity and result

- Task: `TASK-20261015-flowchart-recovery-refactor`
- Implementation baseline: `c2b802c`, verified 2026-10-15 (Asia/Shanghai) in the isolated Linux checkout.
- State: `ready-for-review`; root owns full integration gate and publication.
- Scope authority: [plan](../superpowers/plans/2026-10-15-flowchart-recovery-refactor.md), bounded P2 recovery extraction from the [architecture roadmap](2026-10-15-architecture-agent-loop.md).

Moved the pure child reconstruction and durable acceptance/cost declaration helpers from `src/run/flowchart-run.ts` into `src/run/flowchart-child-recovery.ts`. Orchestration shrank from 2,671 to 2,263 lines: 408 fewer lines (15.3%). The extracted module has 432 lines including preserved contract explanations and imports; total source size is not reduced, and line count alone is not evidence of improved runtime behavior.

The existing resume call-site names and shape remain intact. Public run/resume APIs, events, checkpoint fields, statuses, terminal ordering, acceptance semantics and cost authorization are unchanged. The new module imports orchestration/event/checkpoint types only; its runtime dependencies are role validation, default run limits and the existing cascade planner. It owns no persistence or execution.

## Changed files and boundaries

| File | Responsibility |
|---|---|
| `src/run/flowchart-child-recovery.ts` | Request/routing selection; child reconstruction; planned and monotone criteria/cost records; restoration of undispatched child declarations; existing role mapping |
| `src/run/flowchart-run.ts` | Imports those helpers; retains lifecycle, persistence, event replay, cancellation and execution callers |
| `test/unit/run/flowchart-child-recovery.test.ts` | Eight direct regressions for duplicate/empty/absent declarations, monotone authorization, log/checkpoint precedence, reconstruction, dependency deduplication, routing/cascade and fallback limits |
| `test/unit/run/flowchart-applyretry-absence.test.ts` | Extends scheduler/`applyRetry` absence census to the new module, retaining original discard/restore ownership checks |

The recovery helpers keep last-request-wins selection while durable record advancement keeps first-write-wins. Known-empty criteria survive; an unrecorded empty request does not fabricate a durable declaration. A request, even an explicitly empty or uncapped one, remains authoritative over checkpoint records. Substituted children may inherit sibling attempt/timeout/wall limits, never the sibling's spend cap. True role comes from role-bearing assignment events; compile-time `node.agentRole` does not change the resumed child gate. Cascade tiers rebuild from the current supplied catalog, preserving the existing disclosure.

## Exact local commands and outcomes

The standard command was attempted first. This environment's package-manager wrapper ran an installation check and rejected ignored dependency build scripts before starting the test suite. No dependency permission change is part of this slice. Direct execution of the repository's test launcher then exercised the same supported Node/tsx test path; root separately provides the genuine pinned pnpm gate.

1. `pnpm test -- test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/integration/m2.5/children-flowchart.test.ts test/integration/m2.5/flowchart-run-cap.test.ts test/integration/run/criteria-gate.test.ts`: **FAIL before tests**, environmental `ERR_PNPM_IGNORED_BUILDS`; output `.agent_workspace/continuous-quality/flowchart-recovery-baseline.log`.
2. `node scripts/run-tests.mjs test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/integration/m2.5/children-flowchart.test.ts test/integration/m2.5/flowchart-run-cap.test.ts test/integration/run/criteria-gate.test.ts`: **PASS before extraction**, 43 tests / 43 pass / 0 fail / 0 skip; output `flowchart-recovery-baseline-direct.log`.
3. `node scripts/run-tests.mjs test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/unit/run/flowchart-applyretry-absence.test.ts test/integration/m2.5/resume.test.ts test/integration/m2.5/children-flowchart.test.ts test/integration/m2.5/flowchart-run-cap.test.ts test/integration/run/criteria-gate.test.ts`: **PASS after extraction**, 74 / 74 / 0 / 0; output `flowchart-recovery-extraction.log`.
4. `node scripts/run-tests.mjs test/unit/run/flowchart-child-recovery.test.ts`: **PASS**, eight new direct boundary tests; output `flowchart-recovery-boundary.log`.
5. `node node_modules/typescript/bin/tsc --noEmit`: initial **FAIL** identified a new test fixture's invalid `CREATED` status; corrected the fixture to the existing `PLANNING` status, then **PASS**; outputs `flowchart-recovery-typecheck.log` and `flowchart-recovery-typecheck-final.log`. No status enum changed.
6. `node scripts/run-tests.mjs test/unit/run/flowchart-child-recovery.test.ts test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/unit/run/flowchart-applyretry-absence.test.ts test/integration/m2.5/resume.test.ts test/integration/m2.5/children-flowchart.test.ts test/integration/m2.5/flowchart-run-cap.test.ts test/integration/run/criteria-gate.test.ts`: **PASS**, 82 / 82 / 0 / 0; output `flowchart-recovery-focused-final.log`.
7. Following the independent review's source-pin coverage correction: `node scripts/run-tests.mjs test/unit/run/flowchart-child-recovery.test.ts test/unit/run/flowchart-applyretry-absence.test.ts`: **PASS**, 12 / 12 / 0 / 0; output `flowchart-recovery-review-fix.log`.
8. `node node_modules/eslint/bin/eslint.js src/run/flowchart-run.ts src/run/flowchart-child-recovery.ts test/unit/run/flowchart-child-recovery.test.ts test/unit/run/flowchart-applyretry-absence.test.ts`: **PASS**; output `flowchart-recovery-lint-final.log`.
9. `node scripts/workflow-check.mjs`: **PASS**, 10 required files / 16 required headings; output `flowchart-recovery-workflow.log`.
10. `git diff --check`: **PASS**.

All abbreviated output filenames above are under `.agent_workspace/continuous-quality/`; raw outputs stay local and the exact commands/counts are promoted here for durable review. Root independently compared TypeScript ASTs of the 15 moved functions to baseline after removing only the export modifier; all bodies matched (`recovery-exact-body-review.json`). This verifies mechanical equivalence, separately from behavioral tests.

## Review and handoff

Independent review found a P2 verification gap: the scheduler/`applyRetry` whole-file absence test initially scanned only the old owning files. The source census now includes the extraction, while discard-marker and restore-audit checks still target their existing owners. The targeted correction passed and root reported the independent recovery review's final **PASS**. Full gate and publication evidence belong to root's integration record.

Lifecycle/termination extraction, autonomous crash recovery, result adoption, true cross-child/cross-attempt monetary settlement and live-provider outcomes remain out of scope. Existing R10/R11, S0-min, F6/F-PROD and production/outcome boundaries are unchanged. Neither unit verification nor a source publication closes them.

## Coordinator delivery check (2026-10-15)

On the frozen recovery source, actual `pnpm gate` passed: workflow, TypeScript,
ESLint, **3,322 tests / 3,321 pass / 0 fail / 1 opt-in real-provider skip**, and
build. `pnpm security:probe` passed 26; `pnpm pi:probe` passed four;
`pnpm kernel-reuse:probe` passed three. Independent baseline review ran 96/0/0,
extraction review ran 62/0/0 and post-correction checks ran 12/0/0; these overlap
the full suite and are not added to its total.

Linux Node 24.19.0; a local PATH symlink selects the existing genuine
`/opt/codex/tools/pnpm/bin/pnpm.mjs` 10.17.1 for both top-level and nested
scripts. No global configuration, dependencies, build permissions, doctor
expectations or npm version environment values changed. Its doctor check passed
35/0/0. The initial wrapper failure above is retained and does not describe
this corrected full-gate run.

Raw outputs: `stage1-gate.log`, `stage1-security.log`, `stage1-pi.log`,
`stage1-kernel.log` and `pinned-pnpm-doctor.log` in the local evidence directory.
The new `Flowchart recovery regression` workflow runs ten selected suites
serially on Ubuntu/Windows with Node 22.19.x and pnpm 10.17.1. Syntax, matrix
and selected-file existence were checked locally. Hosted results are recorded
separately after GitHub publication.

First checkpoint published and remote ref verified at `43aea5ae9f00834f8249495d7e601f4c6439541e`
in [PR #61](https://github.com/Xhhemoing/pi-sparkle/pull/61). Remote Git tree
`8e137d2ed8170a1526a1e6a7f8bea27d95b6547b` equals the locally checked and staged
tree. The local snapshot commit `0b041ec` has different author/commit metadata
and the same tree; it is not mislabeled as the remote revision.
Dedicated recovery [run 38612917798](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38612917798)
and root regression [run 38612917262](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38612917262)
both passed their Ubuntu/Windows jobs. Standard [CI 38612917294](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38612917294)
also passed its quality and Ubuntu/Windows smoke jobs: **7/7 hosted jobs PASS**
at that exact first checkpoint, including the genuine pinned-pnpm gate under
Node 22.19.x.

Next action: the separately scoped [terminal recorder plan](../superpowers/plans/2026-10-15-flowchart-terminal-refactor.md)
characterizes and extracts only normal terminal recording. Finish/crash/checkpoint
ownership remains in the original orchestrator. This staged publication does
not merge PR #60 or #61 into main.

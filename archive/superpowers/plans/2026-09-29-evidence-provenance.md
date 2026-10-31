# C2-evidence-1: explicit command-evidence provenance

Task: `TASK-20260929-evidence-provenance`. Date: 2026-09-29.
Owner: implementation agent for source/command verification; maintainer or independent reviewer for independent acceptance.
State: planned, before runtime edits.
Baseline: main `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7` (PR #47 merged).
Branch: `codex/evidence-provenance-20260929`.

## Request and integration decision

The user explicitly requested continuation and merging effective work into main. PR #47 was integrated through the normal SHA-pinned merge endpoint after final-head CI `36523742474` passed quality and both platform smoke jobs. Its complete diff was inspected, with no conflict hunks to resolve. The PR conversation records the user's source-integration direction and author-side review. This is not an independent reviewer PASS or S0-min owner freeze. The earlier branch-only delivery snapshot is superseded only for source integration; independent acceptance remains separately open.

## Source finding and bounded scope

The next eligible package in [the dependency queue](2026-09-29-report-next-steps.md) is host-independent C2 evidence invalidation. Inspection found that `CheckAdapter` accepts an exit-zero result without recorded revision/changeSet and fills attribution metadata from the current context. That can make unbound historic output look current. Its input guard also does not validate revision or finite duration and allows non-finite/fractional exit codes.

This slice changes only the existing command adapter and its tests. It is a library-level provenance correction, not host-outcome wiring or completion of all C2 work.

Files: `src/evaluation/check-adapter.ts`, `test/unit/evaluation/project-adapters.test.ts`, new `test/unit/evaluation/check-evidence-provenance.test.ts`, and dated task/status/evidence records. No persisted DTO, frozen host terminal outcome, RunStatus, event, native apply, learning, retained O02/O03 work or dependency changes.

## Observable acceptance

1. A valid command result missing either its recorded revision or change set returns UNOBSERVED, for both zero and nonzero exits. Missing provenance is not inferred from the current context.
2. Metadata distinguishes actual recorded attribution from expected context. Missing revision is unavailable and missing changeSet is null, never the context's values or an invented empty set.
3. Explicit matching revision, working directory and set-equivalent changeSet retain existing PASS/FAIL behavior. Explicit stale revision, stale scope and wrong cwd retain the existing rejection behavior.
4. Malformed command results abstain: non-finite/fractional exit codes; missing, negative or non-finite duration; blank/non-string revision, command or cwd; malformed change sets. Context missing valid revision/cwd/changeSet cannot yield PASS or a model-quality failure.
5. Returned change-set metadata is a snapshot, not a mutable alias to the caller's arrays. Evaluation does not mutate source evidence or context. Order and duplicate entries do not change existing set-equality semantics; an explicit empty set remains valid.
6. Existing declaration and frozen identity pinning tests remain unchanged. No command is executed or replayed by this adapter, no cryptographic-integrity or independent-acceptance claim is added.

## Test-first and publication

Save this plan, then add and run new failing regressions on the unchanged adapter. Update legacy happy-path fixtures to provide actual revision/changeSet; replace the test that expects fabricated context attribution with UNOBSERVED assertions. Implement the smallest change, run all evaluation unit tests plus adjacent delivery/identity checks and supported typecheck/lint. Publish RED tests separately from GREEN source.

Use Node 22.19.0 / pnpm 10.17.1 from the previously exported public toolchain for local focused verification. The container's extracted source snapshot predates PR #47; local focused results concern unchanged evaluation files plus this slice, not an exact full-tree gate. The canonical GitHub branch, based on the merged main, must pass the existing complete CI quality and Windows/Linux smoke jobs before source integration. No new CI workflow or gate relaxation is needed.

Record exact tested commits, commands, counts, skips and review limitations. Source merge is authorized by the user's current request and must be SHA-pinned and conflict-free; do not bypass GitHub protection or report an independent reviewer that did not run.

## Remaining work and abort conditions

C2 artifact/contract/evaluator-definition version binding, dependency-aware invalidation for unrelated changes, and host-dependent integration remain open. S0-min freeze, B2/L1/L2, independent acceptance, retained reliability ownership, live experiments, F6/F-PROD and subsequent outcomes retain their gates. Stop on source drift, conflicting ownership, a frozen schema dependency or unexpected regression. Preserve all unrelated branches and user work. A corrective source revert, not user-workspace reset, is the recovery path.

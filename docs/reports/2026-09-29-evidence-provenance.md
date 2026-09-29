# Source integration and command-evidence provenance

Task: `TASK-20260929-evidence-provenance`. Date: 2026-09-29.
[Saved plan](../superpowers/plans/2026-09-29-evidence-provenance.md) | [Checklist](../../tasks/report-execution-todo.md) | [PR #48](https://github.com/Xhhemoing/pi-sparkle/pull/48).
This record describes author-side implementation and commands. Canonical full-tree CI and source integration are recorded on the exact PR head and merge commit, not inferred from the local snapshot.

## Prior source integration

The user explicitly requested continuation and merging effective work into main. PR #47 head `972a39beb0bcbe61c39606c00ce42f283350dd66` passed hosted final-head CI `36523742474`: quality `109262069825`, Ubuntu smoke `109262069570`, Windows smoke `109262070282`. The complete diff was inspected without conflict resolution. Normal SHA-pinned merge produced `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7`.

This dated source-integration fact supersedes PR #47's earlier branch-only/no-main-merge snapshots in the active report pointers and status row. It does not turn author-side review into an independent reviewer PASS. Independent C2-context/D1-learning acceptance, S0-min owner freeze and every experiment/production/outcome gate stay open.

## New source finding and behavior

Original `CheckAdapter` source blob `2f61b6d7e13d8e1d497d294a4d650f2f19a85e48` could accept unbound command results and fill their missing revision/changeSet from current context. The new adapter requires actual recorded provenance before PASS or a command-quality FAIL. Missing revision or scope returns UNOBSERVED for both zero and nonzero exits. Malformed records ABSTAIN; malformed expected context stays UNOBSERVED.

Metadata preserves actual and expected revision/scope separately. Missing revision is `unavailable`; missing scope is null, not an invented empty set. Scope arrays are copied, preventing later caller mutations from rewriting an already-returned assessment. Explicit matching/stale revision, wrong cwd and set-equivalence behavior remain; no commands are executed or replayed.

The structural `CommandResult` interface is unchanged, but legacy unbound records now yield UNOBSERVED. Callers must capture revision/changeSet when executing the command; attaching current context to historic output is not an acceptable migration. This is library-level protocol/provenance validation, not independent host verification. A revision string or path list alone does not prove the contents of an artifact or a verifier definition.

## Test-first evidence

Environment: supported Node 22.19.0 / pnpm 10.17.1, with unchanged locked dependencies from the earlier public toolchain export.

- Plan saved at `1adfce2f27b703524fc4ae7e3f8bea287c00d98c` before implementation.
- RED regressions committed at `7db057ef6ea87080852466110fa7b55146d6a83e`. `pnpm test -- test/unit/evaluation/check-evidence-provenance.test.ts` on original adapter: 32 total, 3 PASS / 29 FAIL / 0 SKIP, exit 1. Failures include actual PASS versus required UNOBSERVED, malformed fields, invalid context, and mutable metadata aliasing.
- GREEN: `pnpm test -- test/unit/evaluation test/integration/m4/delivery-evidence.test.ts`: 80 PASS / 0 FAIL / 0 SKIP, exit 0. The 32 new regressions are included.
- `pnpm typecheck`: exit 0.
- `pnpm exec eslint src/evaluation/check-adapter.ts test/unit/evaluation/check-evidence-provenance.test.ts test/unit/evaluation/project-adapters.test.ts`: exit 0.

Verified local blobs: adapter `cde2850aa69a5e07c2dcff3e7c52c261e0a96d56`; new tests `591ed2ed899d473a14334623ea001cf7004ddfee`; existing test fixture `7eff244976024e4a38c578601c2f3250d803f39a`. A publication byte check identified one accidentally added unrelated delivery assertion in the intermediate commit `039ac79c`; it was removed to restore the exact tested fixture, not to relax an existing assertion. Runtime bytes did not change in that correction.

The local extracted full tree predates PR #47. Therefore the local focused/typecheck/lint output is not presented as an exact canonical full-tree gate. The authoritative branch is based on the actual merged main; require its existing CI quality, build, security/Pi/kernel probes and Windows/Linux smoke before merging PR #48. The PR's dated verification entry records the actual head/run/job outcomes and skipped opt-in provider check. No provider/holdout execution is assumed.

## Review and remaining boundary

Author-side review inspects all final file changes, verifies matching blob identities and checks the pre-existing declaration/identity tests. No frozen host DTO, RunStatus/event, native apply surface, learned policy, persistent schema, dependency or CI workflow changes. There are no automated conflict resolutions or production activation in this slice. User-directed source integration is separate from independent acceptance; no independent reviewer PASS is claimed.

C2-evidence-1 is a bounded provenance fix, not completion of C2. Artifact/contract/evaluator-definition version binding and dependency-aware invalidation remain open, including preserving unaffected evidence after unrelated changes. B2 remains behind S0-min/L1/L2; C1 memory, B3 status, B4 shared budgets, D2 method candidates, D3 controlled comparisons and E activation retain the original queue and gates. Retained O02/O03 work is untouched.

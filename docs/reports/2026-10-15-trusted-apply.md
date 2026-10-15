# Trusted candidate apply verification

## Plan and scope

Owner: native apply author. State: ready-for-review, 2026-10-15. Parent plan: [trusted apply binding](../superpowers/plans/2026-10-15-trusted-apply-binding.md), TA-02/03/04. Baseline: `e837aab`.

Only `src/native/apply.ts`, `test/integration/native/trusted-apply.test.ts`, and this report are owned here. Exact snapshot/tree and attribute assertions are separately implemented and reviewed. Registration continues to refuse historical trusted metadata; no automatic acceptance, source integration, rebase, disposal, restart authority, or live provider is added.

The optional original host-issued `trustedVerification` capability must match snapshotted command/argv and cover the entire candidate. Capture whole raw source and candidate snapshots before the actual verification, refuse active Git content transforms in both repositories and old/new tree views, stage with per-operation CRLF conversion disabled, and require the immutable staged tree to equal checked raw bytes. Await a frozen `onPrepared` target before source mutation, then recheck source/candidate identity, exact bytes, attributes and cancellation. After checkout, compare actual source bytes with the immutable candidate tree before branch publication. Preserve observed state on ambiguity without rollback.

## Acceptance and test-first sequence

1. Real Git trusted candidate applies only with the original whole-worktree descriptor; absent/copied/serialized/scoped/mismatched descriptors refuse and retain source/candidate.
2. Binary/empty files and LF bytes survive staging and checkout, including a repository configured for automatic CRLF conversion.
3. Current candidate/source attributes and a real clean filter refuse before source mutation; ignored extra paths cannot escape tree binding.
4. Frozen prepared callback is awaited; callback failure, same-length candidate/source drift, changed attributes, and cancellation prevent checkout. Mutable caller inputs cannot change snapshotted bindings after the first await.
5. Raw source bytes after checkout bind to the checked tree; failures preserve the observed source/candidate state and do not publish the target branch. A reference hook can run after the two-tree checkout, so this may leave a partial checkout in the source; the path is intentionally retained for host inspection rather than automatically rolled back.
6. Existing native apply and registration suites remain compatible. Independent review and aggregate/hosted gates are owned by the coordinator.

Write regressions first and record the real RED command, then implement and run focused tests with `node --import tsx --test`. Use direct local TypeScript/ESLint/workflow commands; no managed pnpm wrapper or live provider. Stop before source mutation on uncertainty. This is bounded, in-process checking, not hostile concurrent-writer isolation or a crash-atomic checkout/ref transaction.

## Evidence

- `node --import tsx --test test/integration/native/trusted-apply.test.ts`: **16/16 passed**, 0 failed. This includes the original-descriptor guard, binary/empty/LF binding, ignored-extra and active-attribute refusal, filter refusal, callback fencing, cancellation, mutable-input snapshot, raw source drift and post-checkout reference-hook cases.
- Existing native apply, source-integration and unit apply suites: **26/26 passed**, 0 failed.
- `node --import tsx --test test/unit/execution/exact-git-tree.test.ts`: **25 passed, 0 failed, 1 Windows-only skip** on this Linux host. The exact-tree helper independently covers direct bytes, modes, path/object bounds, replacement refs, empty directories, attributes and configured sentinel filters.
- Targeted ESLint and TypeScript checks, plus `git diff --check`, pass. The coordinator owns the aggregate full-suite and hosted-platform result.

Empty directories and unsupported Git path/mode representations fail conservatively. Whole snapshots inherit the descriptor's bounded file/byte limits; no raw file snapshot is persisted and Git object identifiers only address immutable objects, not new content-integrity authority. If a reference hook changes source state after the two-tree checkout, apply retains the observed partial state and refuses publication; it does not guess a rollback.

## Hosted closeout

The final staged remote checkpoint is commit `df28c0b4ce560b66b9472d2f716c75155a5901b9` with tree `25e16232faae04729c93140c8ed82cdf6c496b54`. Five required hosted jobs passed on Node 22.19.x and pnpm 10.17.1: [CI quality and Ubuntu/Windows smoke](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38684829754) and [root Ubuntu/Windows regressions](https://github.com/Xhhemoing/pi-sparkle/actions/runs/38684828933). This closes TA-06 for this bounded in-process SDK slice; main is unchanged and production/R10/R11/LIVE-01 evidence remains out of scope.

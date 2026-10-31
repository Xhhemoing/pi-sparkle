# Native candidate-only bounded repair

- ID: `TASK-20261015-native-bounded-repair`
- Owner: coordinated `audit_loop` builder; integration owner: root coordinator
- State: ready-for-review (independent slice review PASS; combined-source gate owned by coordinator)
- Base: `44db4b1`; date: 2026-10-15 Asia/Shanghai
- Contracts: AGENTS.md; ADR-008; native isolated-write status row; existing R10/R11 and F6 remain open.

## Scope and acceptance

Extend the existing `NativeWriteSession` with host opt-in bounded attempts on the same retained candidate. Defaults remain one attempt. Freeze the verification command, arguments and attempt/time limits before asynchronous execution. A failed completed host command may supply bounded, immutable feedback to the next executor factory. Each attempt has an ordinary run and existing run-scoped evidence; a terminal loop record links attempts. No new store or event union is introduced.

Acceptance: failed-check → repair → independently accepted candidate preserves the source; unchanged bytes stop further work; equal-length changed bytes count as progress; executor failures, verifier infrastructure failures, cancellation, elapsed budget, snapshot uncertainty and attempt exhaustion stop explicitly. Host check arguments cannot be rewritten by worker feedback or caller mutation. Invalid limits create no worktree. Default one-attempt behavior and existing cancellation tests remain green.

No automatic apply/disposal, promotion, live-provider invocation, adaptive-policy activation, autonomous task selection, or crash resume. The factory and executor must honor cancellation; the deadline requests cancellation and prevents further attempts, not OS isolation of arbitrary host callbacks. The exact progress snapshot is bounded and ephemeral, compares bytes without a hash, and covers the existing nonignored candidate scope. Test acceptance is not outcome-supported learning.

## Files and tests

Builder owns `src/native/write-session.ts`, new `src/native/write-loop.ts`, focused native repair tests, and additive command-status evidence in `src/execution/independent-check.ts` if required to distinguish completed failures from infrastructure failures. No changes to frozen CLI/event contracts.

RED first: `pnpm test -- test/integration/native/write-loop.test.ts`. GREEN/recovery: same plus existing `test/integration/native/write-session.test.ts`, native apply and execution checks. Coordinator runs full `pnpm gate` and required probes. Record exact outputs in the dated report. Abort on source/candidate identity drift or missing trustworthy feedback; retain evidence. Integration owner updates active task/status links and SDK documentation.

## Closeout

2026-10-15: implemented the bounded repair path, exact ephemeral no-progress comparison, immutable bounded feedback, per-attempt artifacts, and corrective cancellation summary. Independent reviewer `command_cleanup` found a cancellation-persistence race and misclassification of a signalled verifier; both now have deterministic regression tests and reviewer delta PASS. Author's final focused regression: 50 pass / 0 fail / 0 skip; typecheck and focused ESLint PASS. [Verification and boundaries](../../reports/2026-10-15-native-bounded-repair.md). Combined-source gate, probes and integration remain coordinator-owned; no runtime/adaptation owner gate is silently closed.

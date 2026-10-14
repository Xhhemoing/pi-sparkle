# Native bounded repair — implementation and verification

Task: `TASK-20261015-native-bounded-repair`. Base: `44db4b1`. Date: 2026-10-15 Asia/Shanghai. Builder: coordinated `audit_loop`; independent slice reviewer: `command_cleanup`; combined-source integration owner: root coordinator. Source is the shared implementation candidate, not a separately published release. [Plan](../superpowers/plans/2026-10-15-native-bounded-repair.md).

## Delivered behavior

`NativeWriteSession.execute` now accepts host-only `maxAttempts` (1–5, default 1) and `maxWallTimeMs` (1–1,800,000). Explicitly setting either enables the bounded loop; its default time budget is `min(maxAttempts * 360000, 1800000)`. Existing callers that omit both retain their one-attempt result shape and behavior.

Every attempt uses the same retained detached candidate, an ordinary parent run, and the existing independent host check. Only an observed, normally completed command with an actual nonzero process exit and no termination signal qualifies for repair. Missing legacy process evidence, spawn errors, timeout, output overflow, cancellation, verifier drift, executor failures, or absent host checks do not trigger retries. The host command/argv and limits are copied before asynchronous work; workers cannot replace the verifier by rewriting feedback.

The next factory receives a frozen `attempt` context and bounded `previous` feedback. The actual implementer task also receives that feedback, explicitly labelled untrusted command output, so a factory that does not specially read the additive field still supplies the failure evidence to the executor. The original task remains the authority. There are no command/argv or approval grants in feedback.

Each attempt has its own run/check/failure artifact. Opt-in results additionally return `loop.attempts`, limits, `stopReason`, and `loop.artifact`; the last artifact links the attempt evidence. Stop reasons are `accepted`, `attempt-limit`, `no-progress`, `cancelled`, `time-budget`, `executor-failed`, `verification-unavailable`, `snapshot-unavailable`, and `source-changed`. Candidate and source remain separate; source drift stops further work and preserves concurrent user edits.

An exact, ephemeral progress snapshot compares changed nonignored paths, file kinds, modes and bytes without hashing. It is capped at 256 changed paths and 4 MiB, refuses linked/nonregular paths, and stops explicitly when a snapshot cannot be established. Equal-length rewrites count as progress. Repeating the same failed candidate stops after the second attempt. Snapshot bytes are not persisted in a new store.

Cancellation during final evidence persistence was independently reproduced. The corrected path returns `CANCELLED` with `acceptance.accepted=false`, persists a corrective summary with `supersedesArtifactId`, and points the result to that summary. A successful historical attempt check stays visible separately; it is not relabelled as unsuccessful or confused with overall loop acceptance.

## Exact changed surfaces

| File / symbol | Change |
|---|---|
| `src/native/write-session.ts` / `NativeWriteSession` | Same-candidate bounded attempts, immutable controls, feedback wiring, durable attempt links, cancellation-safe terminal result |
| `src/native/write-loop.ts` | Bounded control validation, feedback/stop DTOs, retry classification and exact ephemeral no-progress comparison |
| `src/execution/independent-check.ts` / `IndependentCheckRecord` | Additive optional `processStatus`, `processExitCode`, `processSignal`; preserves actual termination evidence before historical exit normalization |
| `test/integration/native/write-loop.test.ts` | End-to-end real Git/filesystem/command repair, stop, privacy-bound and cancellation races |
| `test/unit/native/write-loop.test.ts` | Legacy fail-closed classification, normal exit 128 versus signal termination, bounded feedback, frozen limits |

## Verification

| Command / check | Result |
|---|---|
| Initial `pnpm test -- test/integration/native/write-loop.test.ts` | BLOCKED before tests: environment pnpm preflight rejected ignored dependency build scripts |
| Initial `node scripts/run-tests.mjs test/integration/native/write-loop.test.ts` | BLOCKED before tests: tsx CLI IPC socket `EPERM` |
| Direct `node --import tsx --test test/integration/native/write-loop.test.ts` before implementation | RED: original seven cases failed. The absent loop deadline fell back to the original 300 s task timeout; this is preserved as failure evidence, not a success |
| First direct loop integration after implementation | GREEN: 7/7 |
| Expanded new unit/integration and existing write-session focused tests | GREEN: 22/22 before independent review corrections |
| Independent reviewer cancellation injection at terminal artifact rename | RED on original candidate: aborted signal but COMPLETED/accepted result and accepted summary. Corrected regression and delta source review PASS |
| Independent reviewer signal-terminated verifier probe | RED on original candidate: normalized exit 128 was classified repairable. Actual exit/signal fields and fail-closed classifier added; regression and delta source review PASS |
| `timeout 40s node --import tsx --test test/unit/native/write-loop.test.ts test/integration/native/write-loop.test.ts test/integration/native/write-session.test.ts test/integration/execution/closed-loop.test.ts test/unit/execution/independent-check.test.ts test/unit/native/apply.test.ts` | Final GREEN: 50 pass / 0 fail / 0 skip, 6.15 s, Linux. The self-SIGTERM integration is explicitly skipped on Windows |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS on final owned source |
| `node node_modules/eslint/bin/eslint.js src/native/write-loop.ts src/native/write-session.ts src/execution/independent-check.ts test/unit/native/write-loop.test.ts test/integration/native/write-loop.test.ts` | PASS on final owned source |
| Independent reviewer final loop unit/integration rerun | PASS: 15 tests; author verification remains separate |
| Integrated `pnpm gate` / security/Pi probes | Coordinator-owned; see [combined architecture record](2026-10-15-architecture-agent-loop.md) for final results |

No test used a paid/live model or modified the source repository through candidate application. The principal positive test writes an incorrect four-byte value, sees a real failed host command, changes it to a different four-byte value, passes the same command, and verifies that the source's original bytes are unchanged.

## What remains outside this slice

- This is task-code repair in an existing isolated write API. It is not cross-episode policy learning, automatic backlog selection, application, merge, promotion, or an autonomous scheduler.
- The exact no-progress snapshot is separate from the pre-existing host checker fingerprint. That older binding records paths/kinds/byte lengths and does not detect all equal-length mutations during verification. This slice does not claim an immutable evaluator or exact content binding for that older API.
- The elapsed budget requests cancellation and prevents subsequent attempts. Arbitrary host executor factories and callbacks must cooperate; event-loop starvation can delay timers. This is not a real-time or OS process containment guarantee.
- There is no session-wide dollar/token settlement budget and no crash-resume controller. Per-attempt run artifacts survive, while the mutable retained candidate represents the latest attempted state; prior candidate bytes are not automatically checkpointed.
- Exact snapshot limits intentionally stop large/ambiguous repairs. Ignored files remain outside the existing snapshot scope. No cleanup or disposal is automatic.
- Independent review of this slice and deterministic fixture success do not close S0-min owner freeze, L1/L2, R10/R11, F6, live-provider, production-apply, or Outcome-supported gates.

Handoff: coordinator runs the combined-source gate and probes, records exact source/verification scope, and decides integration under the existing user authorization. Future improvement loops should select one bounded task, use these retained evidence references for independent review, and advance only after the applicable integration acceptance; they must not turn a passing fixture into adaptive-policy promotion.

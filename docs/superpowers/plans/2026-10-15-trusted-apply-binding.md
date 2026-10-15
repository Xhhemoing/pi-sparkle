# Exact tree binding for explicit trusted candidate application

## Identity and scope

- ID: TASK-20261015-trusted-apply-binding
- Owner: root coordinator; exact-snapshot, native apply, example authors; independent reviewers
- State: ready-for-review
- Baseline: PR #60 `e837aab0950bfafeb669a6a88d9499944fa7dbae`, five hosted jobs PASS
- Direction: user requested continued implementation and staged saves

The development queue produces and explicitly accepts candidates, but native apply correctly refuses persisted trusted verification metadata. A fresh descriptor alone is insufficient: the real Git tree, including staging transforms, must equal the bytes that passed current verification. Implement an opt-in host SDK path with exact whole-candidate/tree binding; preserve default legacy behavior and serialized-registration refusal. Demonstrate explicit host integration of one accepted current-base candidate and subsequent dependent dispatch in temporary real repositories.

No automatic accept/apply, develop apply CLI, registration downgrade, automatic rebase/batch integration, disposal, production use, R10/R11 acceptance, credential/model configuration or live trial is authorized by this slice. Applying fixtures is test/example behavior. Keep previous source commits and main unchanged.

## Acceptance criteria

- [x] TA-00: registration snapshots validated host result and handle/source bindings synchronously before the first await. Caller mutation/accessors cannot change the persisted command, issued identities or subsequent apply/disposal targets. Runtime capabilities/signals are handled separately, not serialized as authority.

- [x] TA-01: genuine opaque whole-worktree exact snapshot can be directly compared with a bounded immutable Git tree: exact path/file bytes and Git executable mode, no symlink/submodule/invalid encoding or unsupported scope. Missing/extra/transformed files and forged handles fail. No new content hash or persisted byte snapshot is introduced.
- [x] TA-02: trusted apply requires an explicit original in-process freshly host-issued descriptor matching host command/argv and covering the whole candidate. Missing/copied/serialized descriptors remain refused. Registration without in-process authority remains refused. Existing non-trusted defaults and result fields remain unchanged.
- [x] TA-03: snapshot before the real check, recheck after actual settlement, safely stage, and compare the resulting tree with the checked whole snapshot before source mutation. Refuse content-transforming Git attributes; disable implicit CRLF normalization for opt-in staging/checkout. Observe attributes in source and candidate. Retain bounded bytes/files, candidate identity/source CAS, cancellation and no-rollback preservation. Recheck actual source bytes before branch publication; no hostile concurrent-writer or crash-atomicity claim.
- [x] TA-04: optional host-only onPrepared callback receives frozen target revision/tree identity before first source mutation, and is awaited without abandonment. Cancellation, callback failure or source/candidate drift after callback prevents checkout. This enables a host to persist intent/target with the existing action ledger; no automatic recovery or replay follows.
- [x] TA-05: real-Git tests/example show queue run→historical review→explicit accept→fresh host SDK verification/application→dependent task from the integrated revision. Preserve candidates, explicit zero-live/unknown-cost disclosure and stale sibling refusal. The example records candidate-apply intent and prepared target before mutation; unknown interrupted effects remain manual reconciliation.
- [x] TA-06: RED→GREEN, source-disjoint independent review, original tests and full gate/probes, Ubuntu/Windows focused checks and exact staged GitHub source/tree evidence.

## Verification update

TA-00 through TA-05 have author GREEN evidence: registration 23/23; exact Git tree 26 pass / 0 fail / 1 Windows skip; trusted apply 16/16; existing native apply/source/unit 26/26; queue integration 2/2; local full suite 3574 total / 3572 pass / 0 fail / 2 skips. Local typecheck, lint, build, workflow, security 26/0, Pi 4 and kernel 3 probes pass. Independent implementation review reports PASS on focused 56 tests (55 pass / 0 fail / 1 Windows skip) and current source blobs. TA-06 is closed by the exact remote source/tree checkpoint `e6c9f532bbc1c4c23ec2161ab0bab3f4f592cbd8` / `3c7eb200971e6e91286328aa848c9172a247d800`, with five hosted jobs passing: CI quality plus Ubuntu/Windows smoke, and root Ubuntu/Windows regressions. Main, production/R10/R11, and LIVE-01 remain separate gates.

## Interfaces and ownership

| Owner | Exclusive write scope |
|---|---|
| registration author | `src/native/apply-registration.ts`; new focused registration input tests; dated registration report |
| exact-snapshot author | `src/execution/exact-snapshot.ts`; new `test/unit/execution/exact-git-tree.test.ts`; dated exact-tree report |
| native apply author | `src/native/apply.ts`; new `test/integration/native/trusted-apply.test.ts`; dated trusted-apply report |
| example author | new `examples/development-integration-demo.mjs`; dated demonstration report |
| root | new development source-integration test, guide/status/task/CI/report closeout |
| reviewers | own independent report only; runtime source read-only |

Proposed additive native input: `trustedVerification?: TrustedVerificationDescriptor`, `onPrepared?: (target: {sourceRevision, appliedRevision, candidatePath, candidateTree}) => void | Promise<void>`. Callback target is frozen and input bindings are snapshotted before awaiting host code. Default helper `assertNativeApplyVerificationSupported(result)` retains its existing fail-closed behavior for registration. The opt-in native path must not recover authority from historical descriptor ids or evidence JSON. Descriptor manifest must be whole-candidate (no include/exclude/output exceptions). Exact helper APIs expose only opaque-handle predicates/assertions, never bytes.

Whole snapshot/tree comparison must refuse directories/files not representable in the applied tree where necessary, count paths/bytes before blob reads, bound Git output/argv/traversal, and use raw Git object bytes rather than filtered file output. Use conventional Git object ids only as immutable Git addresses; direct byte equality establishes the check. Queries for text/filter/eol/ident/working-tree-encoding transformations must cover old/new candidate/source attribute views; active transformations refuse before source mutation. Windows executable-mode limitations, empty directories and large repositories must fail conservatively or be explicitly defined in the report.

## Verification and delivery

Write real failing regressions before behavior. Cover same-length mutation, extra/ignored files, binary/empty files, clean filters/attributes, mode/path mismatch, forged snapshot/descriptor, callback mutation/cancellation, stale base, foreign worktrees, no descriptor and unchanged legacy apply. Preserve old tests. Use direct original Node package commands locally if the managed pnpm wrapper still mismatches; hosted Node22/pnpm10.17.1 remains separate. Apply/cancellation side effects must settle and preserve candidates/source on ambiguity. Run security/Pi/kernel probes and full gate, then stage-save exact source/tree before evidence-only closeout.

## Handoff and abort

Stop the opt-in apply path before source mutation on uncertain tree, descriptor, attributes, scope, source/candidate identity or target persistence. After checkout/ref failures retain observed source state and candidate; never reset/clean to guess a rollback. No global lifecycle lock or automatic unknown-effect resolution is added. Keep LIVE-01 and all production/experimental gates distinct. A general durable development apply CLI and safe reconstruction after process restart remain a separately designed next slice, not inferred from this in-process SDK capability.

## Pre-implementation audit correction

Read-only audit found `issueApplyRegistration` retains caller-owned result objects across asynchronous artifact persistence, then rereads them to return a handle. Fix this concrete input-mutation gap as TA-00 before delivering the opt-in capability. Audit adjacent apply/disposal asynchronous handle reads within the same file; stage-save the focused fix when independently verified. Existing comments about opaque locators must not claim same-address tamper detection.

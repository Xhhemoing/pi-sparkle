# Report continuation: A0-root and B1 evidence

Task: TASK-20260927-report-continuation. Date: 2026-09-27.
Owner: implementation agent. Independent review NOT RUN; main merge NOT performed.
Intake head: `696fc3b2173a342c18a64b3a3e1e608b0d142253`; original main: `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`.
Branch: `codex/report-plan-phase-a-20260927`; PR #46.

[Plan](../superpowers/plans/2026-09-27-report-continuation.md) | [Checklist](../../tasks/report-improvement-todo.md) | [B1 usage and boundaries](../native-task-contract.md)

## Scope and staged synchronization

The user requested implementation with staged GitHub synchronization. The following actual commits preserve test-first evidence rather than presenting the entire A-E roadmap as complete:

| Commit | Stage | Content |
|---|---|---|
| `019e1641` | A0 RED | Same-runner baseline/current probe, root regression tests and continuation plan |
| `c1d4ba89` | A0 correction 1 | Native preflight physical-directory identity; reject links before canonicalizing |
| `52a45954` | B1 RED | Fourteen native contract behavioral/compatibility cases before feature implementation |
| `41cd4a00` | A0 correction 2 | Reuse the same identity check for retained candidate application |
| `db8aff4f` | A0 diagnostic compatibility | Retain path context in alias-refusal errors; no change to rejection behavior |
| `de2b2262` | B1 implementation | Bounded native contract adapter, actual session/extension wiring, normalization and loader tests |
| `a1c32daa` | B1 integration correction | Child-owned criteria array type, three task-isolation/admission cases and usage documentation |

A0-root is a bounded platform repair, not acceptance of all existing reliability tasks. B1 is an optional requirements/input slice, not B2 independent outcome verification or the complete Stage B product.

## A0-root: observed RED and corrective sequence

Diagnostic workflow [36306140636](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306140636), Windows job `108583072864`, used Node 22.19.0 and Git 2.55.0.windows.5. Baseline and current preflight ran in one process against the same temporary Git repository; the configured verification command was never executed by the probe.

The requested temporary path used `C:\Users\RUNNER~1\AppData\Local\Temp`; Git top-level and both native real paths used `C:\Users\runneradmin\AppData\Local\Temp`. Device/inode matched (`742408122:562949954715434`). Both baseline and current preflight rejected that actual root. This demonstrates the short-name/long-name defect on the observed runner, not just an inference from unchanged source.

The initial Windows root/preflight/apply set was 34 tests: 13 pass, 21 fail, 0 skip. At `52a45954`, [workflow 36306444470](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306444470) job `108583945634` showed the same-fixture baseline rejecting while current preflight accepted; the set improved to 24 pass, 10 fail. Those ten failures exposed the same path-spelling assumption in candidate `repositoryIdentity`, justifying the separately recorded scope extension to that function.

At `41cd4a00`, [workflow 36306594139](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306594139) Windows job `108584350536` ran the normal apply, concurrent staged/unstaged/branch/HEAD preservation, re-verification failure and partial-ref-publication scenarios successfully. Two remaining failures were error-message compatibility: the new rejection omitted the word `path`, required by the existing diagnostic assertions. The check still correctly refused links. `db8aff4f` added that context, without weakening the tests or admission logic.

[Workflow 36306754611](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306754611) at `db8aff4f` completed successfully on Windows and Linux. The same-runner baseline/current probe and the original four-file root/preflight/apply suite passed. No claim is made that the whole CI at that intermediate head passed: B1's deliberately failing tests were already present.

Implementation: `physicalDirectoryWithoutLinks` rejects symlink/junction components along the complete resolved path, then normalizes native spellings using filesystem canonicalization and checks directory device/inode identity. Preflight and candidate identity reuse it. Existing common-Git-dir, registered detached worktree, backlink, HEAD, branch, clean-source, concurrent-change and retained-evidence checks remain. No new atomicity or OS-sandbox guarantee is claimed. macOS was not exercised.

## B1: RED, wiring and integration correction

The published test-first commit `52a45954` contains 14 contract cases. In the supported hosted quality job `108583962140` (workflow `36306444484`), the new propagation case and all 12 invalid-input cases failed for the expected behavioral reasons; the legacy-call case passed. The full job was later cancelled by the next push: those observed 13 RED cases and the legacy PASS are evidence, but the cancelled full run is not a completed gate.

`de2b2262` implemented the feature. [Workflow 36306880662](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306880662) passed both Windows and Linux root and native-contract/compatibility steps. The separate full quality job `108585164944` stopped at TypeScript TS2322: the new prepared criteria array was declared readonly while existing ChildTaskInput requires a mutable array. Later steps were skipped, not passing. `a1c32daa` corrected the fresh child-owned array type without casts or changes to the frozen child interface, and added multi-task isolation, all-or-nothing admission and input-snapshot tests.

The contract reuses RequirementContract and source/criterion types. Scope, prohibitions, deliverables, criteria and source claims are deep-validated and copied before any run starts. Each child receives only its own bounded normalized objective and actual acceptanceCriteria. The existing events/request fields persist the input; taskContracts binds the returned snapshot to the actual child task id. There is no new authoritative store or event type. Source claims grant no authority, and all results still disclose independentVerification UNOBSERVED.

Scope/prohibition text is deliberately marked not mechanically enforceable: it is not a filesystem read allowlist. Existing read-only profiles/tool policy remain the execution boundary. A descriptive observableCheck is never executed as a command. No parent-wide coverage gate or S0-min host Outcome DTO is added. Empty optional contracts use explicit report/profile defaults; absent contracts preserve the old interface. Oversized normalized objectives are refused instead of truncating hard requirements.

## Final verification

Verified source head: `a1c32daa62b0668c643a0ba6b0a8c640a20670f6`, Node 22.19.0, pnpm 10.17.1, TypeScript 5.9.3. State: bounded A0-root/B1 implementation and automated verification complete; ready for independent review, not merge/production approval.

| Check | Result | Exact hosted evidence |
|---|---|---|
| Workflow contract, TypeScript, lint, full test step, build | PASS | [CI 36307011572](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36307011572), quality job `108585530416` |
| Security, Pi compatibility, kernel reuse and built CLI probes | PASS | Same quality job, all four steps completed successfully |
| Linux CLI smoke and native reliability/persistence | PASS | Same CI, job `108585530548` |
| Windows CLI smoke and native reliability/persistence | PASS | Same CI, job `108585530202`; the original failing Windows step is now green |
| Baseline/current root comparison plus root/preflight/apply and native-contract compatibility | PASS on both OSes | [Workflow 36307011584](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36307011584), Linux `108585530301`, Windows `108585530469` |
| Three additional task-isolation/admission/snapshot cases | PASS in full test step | `test/unit/native/task-contract-isolation.test.ts`, included in the Linux full suite; not separately listed in the Windows focused command |
| Literal local `pnpm gate` invocation | NOT RUN | Local environment lacks the supported checkout/dependencies; hosted CI ran each gate component separately |
| Real provider, holdout, production apply, macOS, independent reviewer | NOT RUN | Not inferred from fake/real-Git fixture tests or hosted CI success |

This continuation added 33 test cases: 8 physical/root-directory cases and 25 task-contract cases. They are part of the repository suite, not additional counts on top of the same full test run. Optional existing provider/crash tests remain subject to the repository's explicit opt-in policy. No aggregate full-suite test count is inferred from job metadata.

Relevant reproducible focused commands (after `pnpm install --frozen-lockfile`):

```sh
pnpm test -- --test-concurrency=1 test/unit/native/physical-directory.test.ts test/unit/native/repository-root.test.ts test/unit/native/write-preflight.test.ts test/unit/native/apply.test.ts test/integration/native/apply.test.ts
pnpm test -- --test-concurrency=1 test/unit/native/task-contract.test.ts test/unit/native/task-contract-normalization.test.ts test/unit/native/task-contract-extension.test.ts test/unit/native/session.test.ts test/unit/native/extension.test.ts test/unit/native/candidate-command-extension.test.ts
```

The final record/index update changes documentation only relative to the verified source head. Its own later CI state must be read separately; earlier PASS evidence is pinned above, not silently attributed to an untested revision.

Local environment remains Node 22.16.0 / TypeScript 5.8.3 without pnpm/Pi dependencies and with GitHub/npm DNS unavailable. The local preflight/helper subset compiled strictly and its four helper tests passed. Those local results are not the full gate; supported-runtime verification comes from hosted CI. GitHub job logs retain the full execution output. Current container logs are under `.agent_workspace/verification/`.

## Handoff and unclosed gates

Independent reviewer acceptance, main merge and production rollout remain open. Existing O02 cancellation, O03 cross-instance disposal, raw evaluation evidence/performance and other reliability work retain their original ownership/status. A0-root does not close all A0 or O01-O11.

B2 requires the existing S0-min/L1/L2/final-review process; B3 persistent status/resume views, B4 root budgets, C memory, D method learning/evaluation and E controlled activation remain planned. R10/R11, F6 and F-PROD are unchanged. Real-provider, holdout and production-apply runs were not performed; fake/real-Git fixture tests are not evidence of long-term quality or cost benefit.

Rollback means reverting this slice's commits. No state migration, user-workspace rollback, credential change or automatic strategy promotion is part of this delivery.

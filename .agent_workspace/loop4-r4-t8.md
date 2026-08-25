gpt-5.6-sol-xhigh-fast

# Loop 4 Round 4 — R4-8 documentation truth-up

## Result

- Updated `docs/data-dictionary.md` and `docs/status-matrix.md` for R3-3:
  successful run-subtree deletion is post-verified, surviving/recreated records
  raise `RunRecordsSurvivedError` with code `RUN_RECORDS_SURVIVED`, and the
  current check is point-in-time rather than writer serialization.
- Corrected the status matrix's episode deletion claim: the two episode record
  files are unlinked while `<id>.lock` is held; the lock is an operational
  sidecar removed by owned release, not an episode record removed or reported
  by the delete.
- Corrected `docs/specs/m0-m2-architecture.md` for R3-8: the live DAG has no
  skip producer/operation, while persisted `SKIPPED` compatibility remains in
  the vocabulary/readiness path; flowchart skips are a separate plane.
- Replaced wall-clock lease-expiry claims with the implemented contract:
  `expiresAt` is descriptive, active leases remain until release, and resume
  immediately recovers reconstructed `RUNNING` leases as orphaned while
  retaining the historical `TASK_LEASE_EXPIRED` event name.
- Documented R3-6 doctor's recursive read-only lock inventory, including
  additive JSON, metadata/age/PID fields, scan errors, and no-steal/no-delete
  advisory posture.
- Documented R3-7's host `deadLetterReport()` and `onDeadLetter` surfaces,
  mailbox-derived tallies, observer-error handling, and process-local/no-TTL
  limits.

## Source verification

- `src/privacy/deletion.ts`: `verifyRunRecordsRemoved`,
  `RunRecordsSurvivedError`, `RUN_RECORDS_SURVIVED_CODE`,
  `removeRunSubtree`, and `unlinkEpisodeFiles`.
- `src/run/scheduler.ts`, `src/run/supervisor.ts`,
  `src/graph/readiness.ts`, and `src/domain/state.ts`: no DAG-plane
  `applySkipped`; compatibility recognition of `SKIPPED`; no lease sweep or
  expiry-based planning; event-log reconstruction and immediate orphan
  recovery on resume.
- `src/cli/doctor.ts`: recursive `*.lock` inventory,
  `DoctorJsonReport.locks`, `lock-inventory`, metadata classifications, and
  advisory PID liveness without lock mutation.
- `src/cluster/mailbox.ts` and `src/cluster/host.ts`: bounded claim-attempt
  requeues, dead-letter storage, pull report, push callback, watermarked
  observation, and observer-error tally.

## Round 4 coordination snapshot

Checked the shared source on 2026-08-24 at 18:40 UTC and timestamp-disclosed
the current behavior instead of predicting these in-flight slots:

- **R4-1:** no cooperative run-plane lock is shared by `delete --run` and the
  four run writers. R3-3's verification can still be followed by a later write.
- **R4-2:** the two production `createClusterHost` option objects pass
  `onSpawn` only; neither host dead-letter surface reaches CLI output.
- **R4-6:** `resumeCommand` accepts neither `--primary-model` nor `--thinking`;
  its two `createExecutor` calls pass neither `modelOverride` nor
  `thinkingLevel`.

No Outcome-supported claim, live R1/bandit/topology wiring claim, or ADR-006
status change was introduced.

## Verification

- `pnpm exec tsc --noEmit` — initially PASS. A final rerun after more
  shared-tree edits reports one error in unowned, newly created R4-4 scratch
  file `test/unit/run/zz-scratch-r44.test.ts:97`
  (`TS2554: Expected 0 arguments, but got 1`). No owned documentation file is
  involved; this slot did not edit the scratch test.
- `git diff --check -- docs/data-dictionary.md docs/status-matrix.md docs/specs/m0-m2-architecture.md` — PASS.
- Scoped ESLint over the three owned Markdown files — exit 0, zero errors;
  three expected "no matching configuration" warnings because ESLint does not
  lint Markdown in this repository.
- Focused source-contract tests — 74 tests, 73 pass, 1 fail. The sole failure
  is an R4-5 shared-tree transient in unowned
  `test/unit/cli/doctor.test.ts`: the concurrently edited expected
  `remediation` string differs from the concurrently edited
  `src/cli/doctor.ts` string. All deletion, cluster-host, scheduler, and resume
  wiring tests passed. This slot did not edit either R4-5 file.

Implementation edits are confined to `docs/**`; this file is the requested
slot report. No commit was created.

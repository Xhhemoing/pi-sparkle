# R6-8 — cross-process SIGKILLed-run lock probe

Result: **ACCEPT — one new probe case is justified and passes 3/3.**

## Census at `b4cc072`

- Baseline `node scripts/crash-probe.mjs`: `ok: true`, 8 cases × 3 iterations.
- `test/unit/run/run-lifecycle-lock.test.ts` proves in process that:
  - a live flowchart or parent run holds its lifecycle lock;
  - normal completion and an exception unwinding through `finally` release it;
  - another in-process holder causes start/pause refusal with `LOCK_TIMEOUT`.
- `test/unit/privacy/deletion.test.ts` proves in process that:
  - delete waits for a real live run or times out without changing its run log;
  - a directly-created lock holder blocks deletion; removal/release permits deletion.
- None of those pins crosses an OS process boundary or bypasses
  `withExclusiveFileLock`'s cleanup `finally`. They therefore cannot prove that
  SIGKILL preserves the actual lifecycle lock bytes and dead child PID, that
  production doctor classifies that PID, or that the complete manual-removal
  recovery works.

That is the delta from the existing in-process pins and why this is not a
duplicate of them or of `stale-lock-no-steal` (which exercises only a bare,
non-run lock and no doctor/delete chain).

## Change

Added exactly one case to `scripts/crash-probe.mjs`:
`sigkill-run-lock-operator-recovery`.

Each iteration:

1. Spawns a child that calls the real `startRun`, reaches its executor after
   run events have persisted, publishes its run id/PID, and self-SIGKILLs.
2. Reads `runtime/runs/<id>.lock`, proves it records that child PID, and proves
   the PID is no longer running.
3. Snapshots the whole run directory, calls real `deleteRunRecords` with a
   bounded lock wait, asserts `LOCK_TIMEOUT`, then byte-compares the directory
   snapshot to prove nothing was removed or changed.
4. Calls real `doctorCommand --json`; asserts the matching lock entry has valid
   metadata, the dead PID, `pidLiveness: "not-running"`, and manual-removal
   remediation naming the lock.
5. Performs the stated operator remedy (`rm` of that lock), calls
   `deleteRunRecords` again, asserts the run directory is reported removed,
   and finishes with `verifyRunRecordsRemoved`.

No TypeScript helper or production source was changed.

## Verification

- `node scripts/crash-probe.mjs` — PASS: `ok: true`, **9 cases × 3 iterations**,
  including the new case at 3/3.
- `pnpm exec eslint scripts/crash-probe.mjs` — PASS.
- `pnpm typecheck` — PASS (`tsc --noEmit`); only the pre-existing Node engine
  warning (`v22.14.0` vs package requirement `>=22.19.0`) was printed.
- `git diff --check -- scripts/crash-probe.mjs` — PASS.

Per instruction, no branch checkout, commit, or push was performed. The census
started at the requested `b4cc072`; while the shared branch was active, the
orchestrator advanced HEAD to `26632a3` with only `.agent_workspace/PROGRESS.md`.
R6-8 did not move HEAD or edit that file.

Concurrent unowned work was also present in `docs/data-dictionary.md`,
`test/helpers/loopback-openai-provider.ts`, `test/helpers/process-death.ts`,
`test/integration/cluster/undelivered-mail.test.ts`,
`test/unit/cluster/mailbox.test.ts`, and `.agent_workspace/loop4-r6-t10.md`.
R6-8 did not edit any of it.

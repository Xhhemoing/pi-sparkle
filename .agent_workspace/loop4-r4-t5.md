# Round 4 R4-5 — doctor remediation and crash-candidate inventory

## Outcome

Implemented the requested read-only doctor diagnostics in the owned files:

- Every lock inventory entry now has additive `remediation` text.
  - A lock with a recorded dead PID reports its age and explicitly says
    `inspect and remove manually; never automatic`.
  - Running, unknown, missing, and invalid PID cases remain conservative; age
    or PID liveness alone is never presented as stale-lock proof.
- `DoctorJsonReport` now has an additive `runStates` inventory.
  - It scans only `runtime/runs/<runId>/events.jsonl`.
  - Valid non-empty logs are replayed through the existing `EventStore` and
    `replayRun` path.
  - Only replayed `PLANNING` and `RUNNING` states are listed.
  - Each entry includes run ID, log path, status, age from the last valid event,
    last-event timestamp, and inspect/resume/delete remediation.
  - The inventory warns that a live process may still own the run and that
    doctor never changes run state.
- Added the advisory `run-state-inventory` check. Candidate presence is not a
  failure; an unreadable/corrupt run-log scan remains fail-closed.
- Prose output includes the same per-lock and per-run remediation.
- Existing JSON fields, `ok` semantics, exit behavior, and `nodeVersion`
  injection remain intact. `file-lock.ts` and `main.ts` were not edited.

## Tests

`test/unit/cli/doctor.test.ts` now pins:

- additive JSON keys and check ordering;
- dead-PID lock age/remediation and no lock deletion;
- PLANNING/RUNNING inclusion and terminal-run exclusion;
- exact event-derived ages and resume/delete guidance;
- unchanged run-log contents after both JSON and prose doctor calls;
- preservation of deterministic `nodeVersion`/`nowMs` seams.

Verification:

- `pnpm test -- test/unit/cli/doctor.test.ts` — PASS, 13/13.
- `pnpm exec eslint src/cli/doctor.ts test/unit/cli/doctor.test.ts` — PASS.
- `pnpm typecheck` — PASS after the R4-5 implementation. A later repeat was
  blocked by concurrent, out-of-scope
  `test/unit/run/zz-scratch-r44.test.ts:97` (`TS2554`); no R4-5 diagnostic was
  reported.
- A final full `pnpm lint` was likewise blocked only outside this slot:
  concurrent unused imports in `src/persist/atomic-file.ts` and two diagnostics
  in `test/unit/run/zz-scratch-r44.test.ts`. The owned-file ESLint run remains
  green.

No commit was created, as requested.

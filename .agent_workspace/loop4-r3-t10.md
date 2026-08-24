gpt-5.6-sol-xhigh-fast

# Loop 4 Round 3 — R3-10 docs/comment accuracy

## Result

- Corrected the checkpoint description to match `RunCheckpoint` and
  `materializeCheckpoint`: base run/project/status/outcome fields plus the
  optional flowchart snapshot, with no M2 DAG lease registry in the schema.
- Documented that supervised DAG resume rebuilds graph state, task statuses,
  attempts, ledger, and leases from events, including `TASK_LEASED`, and
  recovers restored running leases as orphaned.
- Corrected episode-deletion wording: both episode record files are unlinked
  while holding `<id>.lock`; the lock is an operational sidecar removed by
  normal owned release, not a record hand-unlinked or listed in
  `removedPaths`. Abandoned locks retain the documented no-steal/manual-retry
  posture.
- Changed only comments in `src/privacy/record-classes.ts`; record-class data,
  schema, and runtime behavior are unchanged.

## Source verification

- `src/run/replay.ts`: `RunCheckpoint`, `materializeCheckpoint`,
  `validateCheckpoint`.
- `src/run/supervisor.ts`: `reconstructSupervisorState` rebuilds leases from
  `TASK_LEASED` and resume recovers restored running leases.
- `src/privacy/deletion.ts`: `unlinkEpisodeFiles` acquires the episode lock,
  unlinks only the two record files, and excludes the lock from
  `removedPaths`.
- `src/persist/file-lock.ts`: owned lock release removes the sidecar.

## R3-3 coordination

R3-3 (`delete --run` resurrection) was still `RUNNING` at the final
coordination check on 2026-08-24 at 18:12 UTC. This change therefore does not
predict a run lock, terminal precondition, override, or post-delete failure
contract. Existing `delete --run` wording remains unchanged for the parent to
reconcile after R3-3 lands.

## Verification

- `pnpm exec tsc --noEmit` — PASS.
- `pnpm exec eslint src/privacy/record-classes.ts` — PASS.
- `git diff --check -- docs/specs/m0-m2-architecture.md docs/data-dictionary.md src/privacy/record-classes.ts` — PASS.

No commit was created.

# Delete-vs-writer race investigation — 2026-09-17

## Scope

`TASK-20260917-delete-writer-race-flake` investigated the hosted Linux failure on PR #42 head `aeb4993` in `test/unit/privacy/deletion.test.ts:1365`.

## Root cause

The failure was in the test observation, not in a product success path. The test awaited `deleteRunRecords`, then sampled `existsSync(runDir)` while the deliberately unlocked writer was still running. A write that lands after delete's final verification is explicitly a new fact allowed by the delete contract; it can recreate the directory between the returned promise and the synchronous filesystem sample. Therefore the assertion could report `true` even when the delete correctly returned a `DeletionResult` after verifying the subtree was absent.

Evidence:

- The failing assertion was `onDiskAtReturn === false` at line 1400, but the sample was taken before stopping/awaiting the writer.
- `deleteRunRecords` performs verification inside the run lock and again before returning (`src/privacy/deletion.ts:349-354`).
- The contract documents that a write after final verification is a new fact, not a resurrection (`src/privacy/deletion.ts:330`).
- The same test passed twice and failed once across three consecutive local runs, confirming timing dependence.
- WSL and Docker were unavailable in this Windows environment, so no local Linux run was claimed. The hosted CI rerun on the same PR head was green.

## Resolution

The regression test now stops and awaits the deliberately unlocked writer before inspecting the outcome. A successful outcome is checked for the correct run target and removal path; a failed outcome must remain `RunRecordsSurvivedError`. No production code was changed, and the delete invariant wording is unchanged.

## Verification

- `pnpm test -- test/unit/privacy/deletion.test.ts` — **51 pass / 0 fail**
- `pnpm typecheck` — **pass**
- `pnpm workflow:check` — **pass**
- `git diff --check` — **pass**
- Linux reproduction — **not run locally** (WSL/Docker unavailable); hosted rerun green

## Gate status

This resolves the local/test observation flake without claiming a new Linux adversarial measurement. The task remains monitoring-only for any future independent Linux reproduction; no speculative production locking change is warranted.

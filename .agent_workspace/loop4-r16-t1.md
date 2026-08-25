[Model: claude-opus-5-fast]

# Loop 4 · Round 16 — slot R16-1 report

**Mandate:** close the preference-store cross-process lost-update; a `pref delete` that printed success must stay true on disk. Lock placed at the **CLI layer** per parent sign-off. Landed in the working tree on `agent/opt-continuous`; no `git checkout`, no commit, no push.

## 1. Census (working tree, before any edit)

Taken at `2026-08-25 02:51` UTC. HEAD at census start was `9e59e43` (tree clean). HEAD moved to `9c58b90` during the slot — that is sibling R16-3 (`fix(adaptation): publish routing-eval reports atomically`) landing; it touches `src/adaptation/eval-routing.ts` and its unit test, neither of which this slot reads or writes. Siblings R16-2 (`src/episode/store.ts`) and R16-4 (`src/cli/migrate-legacy.ts`) were uncommitted in the same working tree throughout; their file sets are disjoint from this slot's and neither touches `docs/data-dictionary.md`. All verification below therefore ran over a tree that also carried their diffs — the tests I own and the consumer suites I re-ran are unaffected by them, but the whole-tree `tsc --noEmit` result is a joint result, not this slot's alone. Node v22.14.0 (engine warning only); `install-user.status` = 0.

Every handed path verified present before writing:

| Path | State at census | Verified fact |
|---|---|---|
| `src/cli/main.ts` | exists | `bindPreferenceStore` at :1639 built the path inline with `join(adaptationRoot(stateRoot), "preferences.json")`; called from `prefList` :1759, `prefCorrect` :1804, `prefExport` :1828, `prefDelete` :1847 and from :831 (run path, not touched). No `withExclusiveFileLock` import; `LOCK_TIMEOUT_CODE` imported only for the doctor route map |
| `src/preferences/store.ts` | exists | `configurePreferencePersistence` → `loadFromDisk` reads the whole snapshot; `applyObservation` / `deleteObservation` / `clearPreferences` each call `saveToDisk`, which `writeFileAtomicSync`s the whole in-memory state. No lock anywhere; no path helper |
| `test/unit/preferences/` | exists (4 files) | `deletion-replay`, `loop-eval`, `persistence-atomic`, `preferences`, `service-export`. New file added, none edited |
| `test/integration/m4/preferences-cli.test.ts` | exists, 220 lines, 7 cases | none of them concurrent |
| `docs/data-dictionary.md` | exists | operational-lock bullet list at :397-411 listed seven locks, not this one; preference bullet at :459-466 covered snapshot integrity but said nothing about writers |

Ownership cross-check confirmed on disk: `adaptation/preferences.json.lock` appeared nowhere in `src/`, `test/`, `scripts/` or `docs/`. The proven defect reproduced by inspection exactly as the audit describes — bind loads everything, mutators persist everything, nothing serializes the two.

Consumer census (who else constructs or reads this snapshot):

- `src/cli/doctor.ts:507` builds `join(adaptationRoot(stateRoot), "preferences.json")` for its `learnedState` inventory. **Read-only, unchanged, and needs no change** — its lock inventory walks the state root recursively for `*.lock`, which I proved end to end rather than asserting (test below). Residual noted in §6.
- `src/privacy/record-classes.ts:127` declares the durable class path. Unchanged: a lock sidecar is not a durable record class, and `test/unit/privacy/record-classes.test.ts`'s `knownPaths` list deliberately excludes every existing lock. Re-ran green.
- `test/unit/privacy/deletion.test.ts:346` pins that an episode delete leaves `preferences.json` byte-identical. It drives the **store API directly**, not the CLI, so the CLI-layer lock cannot reach it. Re-ran green, unmodified.
- `README.md:162` lists the `pref` commands in one row; nothing in that row became false, and README is not in this slot's ownership.

## 2. Diff

Five files; nothing outside the owned set.

### `src/preferences/store.ts` (+42)

Two exported path helpers plus the docstring the mandate asks for:

- `preferenceSnapshotPath(stateRoot)` and `preferenceSnapshotLockPath(stateRoot)` — `<file>.lock`, mirroring `feedbackLogLockPath` and `bandit.json.lock`. Placed here so the file path and its lock path cannot drift apart.
- A module-level docstring that pins the contract: the synchronous store API is **in-process-only**, holds no lock, and is last-writer-wins across processes; the exclusion lives at the writer (`pref correct` / `pref delete`), and **any new writer of this snapshot must take the lock over the same load→mutate→persist span, binding inside it**. Readers stay lock-free because the file is published by rename.
- One added sentence on `configurePreferencePersistence` naming it the "load" half of that window.

No behaviour change in this file. `writeFileAtomicSync` untouched — the existing publish path is what persists, per the freeze.

### `src/cli/main.ts` (+99 / −22, pref region only)

- New `withPreferenceSnapshotLock(stateRoot, mutate, options)` in the pref region: `withExclusiveFileLock(preferenceSnapshotLockPath(stateRoot), …)` with `bindPreferenceStore` called **inside** the operation, so the snapshot that gets persisted derives from bytes read under the lock.
- `prefCorrect` and `prefDelete` now validate every argument **first**, then acquire. An invocation that was never going to write does not queue behind a live mutator and does not create a lock file.
- Both gained `--lock-wait-ms`, reusing the existing `lockWaitOptions` (same parse rules, same 24-hour ceiling, same "absent flag means the lock's own 5s default"). Its docstring generalised from "delete" to "command" — it has two callers now.
- `bindPreferenceStore` now calls `preferenceSnapshotPath`; `adaptationRoot` became unused in `main.ts` and was dropped from the import. That import line is the only edit outside the pref region and it is a mechanical consequence (lint would otherwise fail). `runCommand`, the route map, `INSPECT_SUMMARY` and `onRunStarted` are untouched; `prefList` and `prefExport` are untouched and remain lock-free.
- `PREF_USAGE` gained the flag on both mutators and a paragraph stating the lock, the bound, the fail-closed guarantee and why readers do not take it — the same shape `DELETE_USAGE` uses.

**No new error type and no new route.** A timeout throws the existing `FileLockTimeoutError`; `main`'s catch turns it into the standard `cliFail` report, and `DOCTOR_ROUTED_NEXT` already keys `LOCK_TIMEOUT_CODE` to the `locks[]` remedy. Nothing was added to the frozen route map.

### `test/unit/preferences/snapshot-lock.test.ts` (new, 358 lines, 9 cases)

Deterministic because every interleaving is forced by holding the lock from outside the CLI — which is exactly what another process does — rather than raced.

1. the lock is a `*.lock` sidecar under the state root (doctor's scan precondition);
2. **doctor inventories a held preferences lock with zero doctor-side change** — real `doctor --json`, entry found by path, `metadata: valid`, recorded pid, and doctor neither acquires nor deletes it;
3. `pref delete` under a held lock → exit 1, `stage: validation`, message naming `preferences.json.lock`, `next:` carrying the doctor/`locks[]` route (the route is keyed on the frozen code and never on message text, so its presence is what proves the failure was the typed one), and the snapshot **byte-identical**;
4. same for `pref correct`;
5. a second mutator **waits** rather than writing beside the holder, and writes nothing while blocked;
6. **a correction bound before a delete cannot revert the delete's tombstone** — the store is deliberately left holding the pre-delete state, the holder publishes the tombstoned snapshot and only then releases, and the waiter must come out with the tombstone intact and the deleted observation absent;
7. a released lock leaves **no `.lock` behind**, over all three exits (correct, found delete, not-found delete);
8. an invocation refused on its arguments never asks for the lock (checked while the lock is held, so anything that asked would report a timeout instead);
9. `--lock-wait-ms` is validated before acquisition.

### `test/integration/m4/preferences-cli.test.ts` (+210 / −1, 7 → 9 cases)

Two cross-process cases; the seven existing ones are unmodified and still pass.

- **Forced interleaving, one real child process** — this is the P1 regression net. A genuine `pref delete` child is launched into a held lock; this process then plays the concurrent `pref correct` by publishing a snapshot in which the observation is live again and the tombstone list empty, and only then releases. The delete must still land its tombstone on disk **and** must not lose the concurrent write. Unlocked, the child loads before that publish and writes after it, and the tombstone is gone with no error anywhere. The child's window is not left to scheduling, so this case is deterministic.
- **Natural two-process convergence** — `pref delete` and `pref correct` spawned together, both orders converging on the same final state (tombstone plus the new observation only), which is what makes the assertion exact rather than "one of two acceptable outcomes". Labelled in-source as an end-to-end smoke check over the real spawn path, **not** the regression net, because whether the two windows overlap is up to process scheduling. §5 records that it did not catch the no-lock mutation, which is why it is documented that way and why the forced case exists.

### `docs/data-dictionary.md` (+38 / −5)

- Operational-lock inventory gains `adaptation/preferences.json.lock`, shared by `pref correct` and `pref delete`; the closing sentence now says explicitly that lock sidecars are not entries in the completeness list, and the doctor sentence records that recursive `*.lock` discovery is why this lock needed no doctor change.
- The preference bullet under *Snapshot integrity and recovery* gains the writer contract: both writers rewrite the whole snapshot from the whole loaded state; each holds the lock across load, mutation and republish with the load inside it; unsynchronized the pair was last-writer-wins in both directions and the losing side could be the delete; `--lock-wait-ms` bounds acquisition and fails closed on `LOCK_TIMEOUT` having written nothing; no steal; the synchronous store API stays in-process-only and any new writer must take the lock; readers are deliberately lock-free.
- The completeness-guard paragraph now states that lock sidecars are not durable paths and are not listed in `knownPaths`.
- **Census note** shipped in this diff (terminator-allowed, landing-triggered): names HEAD `9c58b90`, the two surfaces this landing changed and why, the siblings in flight and why nothing here is contingent on them, and carries the terminator sentence forward.

## 3. Tests, 3×

`test/unit/preferences` (all 5 existing files + the new one) and `test/integration/m4/preferences-cli.test.ts`:

| Run | tests | pass | fail | skipped |
|---|---|---|---|---|
| 1 | 51 | 51 | 0 | 0 |
| 2 | 51 | 51 | 0 | 0 |
| 3 | 51 | 51 | 0 | 0 |

The timing-sensitive cases (the two waiter cases and the forced-interleaving child) were green in all three; nothing was retried or quarantined.

Consumer suites re-run after the final edit — `test/unit/privacy`, `test/unit/cli`, `test/integration/cli`: **290 / 290 pass, 0 fail**. This covers the `deletion.test.ts` byte-identical pin (episode delete still never touches preferences), `record-classes.test.ts`, `plane-boundary.test.ts`, all three doctor suites, `doctor-routed-next-freeze.test.ts`, `errors.test.ts`, `delete.test.ts` and `command-error-doctor.test.ts` (whose `pref list`-over-damaged-snapshot route still passes — `pref list` is a reader and was not touched). An earlier sweep also ran `test/integration/m3`, `test/integration/m4` and `test/unit/persist` green.

No full gate — that is the parent's job.

## 4. eslint / tsc

- `npx eslint src/cli/main.ts src/preferences/store.ts test/unit/preferences/snapshot-lock.test.ts test/integration/m4/preferences-cli.test.ts` → exit 0, no output.
- `npx tsc --noEmit` (whole tree) → exit 0. As noted in §1 this tree also carried the uncommitted R16-2 and R16-4 diffs, so it is a joint clean, not this slot's in isolation.

## 5. Mutation testing (out-of-tree, then deleted)

Full copy of the tree at `/tmp/r16-1-mut` with `node_modules` symlinked to the real one; every mutation applied and run there; directory and scratch backup deleted afterwards (`/tmp/r16-1-mut`, `/tmp/main.orig.ts` both gone). **No in-tree mutation window at any point.**

| # | Mutation | Caught by |
|---|---|---|
| M1 | Lock removed entirely — bind + mutate straight through | 5 cases: both fail-closed cases, the waiter case, the tombstone-persistence case, and the forced-interleaving cross-process case |
| M2 | Bind hoisted **outside** the lock, mutate + persist still inside | 2 cases: the unit tombstone-persistence case and the forced-interleaving cross-process case |
| M3 | Only `pref delete` locked, `pref correct` left unlocked | 3 cases |
| M4 | Lock timeout swallowed, mutation proceeds unlocked | 2 cases (both fail-closed cases) |
| M5 | `--id` validation moved inside the lock | 1 case (the refused-invocation case) |

M2 is the one that matters most and the reason the forced-interleaving cross-process case exists: it is the plausible half-fix, and only tests that pin *where the load happens* can see it.

**Honest negative result:** under M1, the natural two-process convergence case **passed** — two `tsx` starts have enough jitter that their windows did not actually overlap. That case is therefore documented in-source as a smoke check rather than a regression net, and the forced-interleaving case was added specifically to cover the same property deterministically with a real child process. It is stated here rather than quietly dropped because a concurrency test that can miss its own defect is worth naming.

## 6. Residuals

1. **Duplicate path construction in `doctor.ts:507`.** Doctor still builds `join(adaptationRoot(stateRoot), "preferences.json")` by hand instead of calling the new `preferenceSnapshotPath`. Correct today (proved by the doctor inventory test, which compares against `preferenceSnapshotLockPath`) but it is a second source of truth that can drift. Not fixed: doctor is outside this slot's ownership and the mandate requires zero doctor changes. Prescribed for whoever next owns `doctor.ts` — a one-line import swap, no behaviour change.
2. **`recordInferredPreference` remains an unlocked writer in principle.** It has zero production callers today (audit §2 bound), so no live path bypasses the lock. The store docstring now binds any future caller to take the lock; it is not enforced mechanically, and it cannot be without moving the lock into the synchronous store API, which the sign-off rules out.
3. **Embedders calling the store API directly are still unserialized.** By design and now documented: the exclusion is at the CLI writer, so an embedder that mutates preferences itself must take `preferenceSnapshotLockPath` over the same span. This is the same posture `EventStore.append` has on the run plane.
4. **`pref list` / `pref export` remain lock-free** and can therefore read a snapshot that a mutator is about to replace. Deliberate, unchanged project posture: the file is published by rename, so a reader sees one whole version or another, never a splice.
5. **The natural-concurrency integration case is a smoke check, not a net** (see §5). Its cost is one extra pair of `tsx` spawns per run; it earns its place by exercising the real spawn path end to end, but it must not be counted as the regression coverage.
6. **`MAX_LOCK_WAIT_MS`'s docstring** still motivates the ceiling with "wait out a long run". Accurate for `delete`, slightly narrow now that `pref` shares the flag. Left alone — it is outside the pref region and the sentence is not false.

## 7. Frozen contracts checked

No schema change; no new `RunStatus` (the eight-member set is untouched); `EventStore.append` / `CheckpointStore.write` remain unlocked; no live R1; ADR-006 unchanged; no lock steal anywhere (the test helper's release removes only the file it created); persistence still goes through the existing `writeFileAtomicSync` store path and no new tmp+rename primitive was introduced; no `package.json` edit; the doctor `--json` contract, the route map and the `jsonl` signatures are byte-unchanged; `deletion.test.ts`'s byte-identical pin holds unmodified. No scratch files remain in the tree.

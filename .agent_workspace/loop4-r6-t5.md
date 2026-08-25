# R6-5 — CLI routing + bounded wait

**Slot:** R6-5 (P2/P3) · **Branch:** `agent/opt-continuous` (no checkout, no commit) ·
**Started at:** `b4cc072` · **Tree at report time:** `3a21d88` (the parent committed
sibling slots underneath me; see §6).

**Result: both halves landed.** The three adaptation-plane codes route to doctor's
`learnedState[]` (R6-4's surface landed mid-slot, so the coupled half was not skipped),
and `delete` grew `--lock-wait-ms`. `GENERIC_FAILURE_NEXT` and the two existing routes are
character-identical; every pre-existing pinned string is intact; scoped eslint clean and
whole-tree `tsc --noEmit` clean.

**One finding that is not mine to fix:** `test/unit/routing/live-isolation.test.ts` is red
at committed HEAD because of R6-4's `loadProjectBandit` call in `src/cli/doctor.ts`. I
reproduced it in a clean worktree at HEAD with none of my changes applied. Details and the
remedy in §6 — the parent should route this to R6-4 before the gate.

---

## 1. Census (done first, and re-done — the tree is shared)

`src/cli/main.ts` at `b4cc072`: 1794 lines. `DOCTOR_ROUTED_NEXT` at :1659 with exactly two
entries (`LOCK_TIMEOUT_CODE`, `RUN_RECORDS_SURVIVED_CODE`), `GENERIC_FAILURE_NEXT` at
:1647, `doctorRoutedNext`'s depth-4 `cause` walk at :1676, `stateRootArgument` at :1692.
`deleteCommand` at :1612 calling `deleteRunRecords(stateRoot, runId)` and
`deleteEpisodeRecords(stateRoot, episodeId)` with no third argument, i.e. both engines
already accept `FileLockOptions` and the CLI was the only thing not passing one.

**The census that mattered.** At `b4cc072` `src/cli/doctor.ts` had no `learnedState` and no
mention of the adaptation plane, so R6-5's part (1) precondition had not landed and I
started down the "skip the coupled code, publish the remedy" path (R5-2's (c) pattern),
writing the fall-through pin instead. Partway through I discovered this VM's working tree
is **shared with the other Round 6 slots** — R6-1, R6-3, R6-7 and R6-9 edits appeared under
me while I worked. I re-censused `doctor.ts`, found R6-4's `learnedState` inventory present
and by then committed, and switched to the real thing: three routes, and a test that
asserts the routed lines and proves doctor answers them.

Anyone reading this report as precedent should take the process lesson, not just the
result: **on a shared tree, a "precondition did not land" verdict is only true as of the
minute you took it.** I re-checked `doctor.ts` twice more before reporting.

I read R6-4's surface rather than guessing at it, so the `next:` lines name fields that
exist: `learnedState.entries[]` with `kind`, `stateClass` (`learned` | `derived`),
`projectKey`, `path`, `status` (`present` | `absent` | `readable` | `damaged`) and
`remediation`, plus `advisory` and `scanErrors`.

---

## 2. Part (1) — three routes to `learnedState[]`

Three entries in `DOCTOR_ROUTED_NEXT`, keyed on the imported frozen code constants
(`BANDIT_STATE_UNREADABLE_CODE`, `PREFERENCE_SNAPSHOT_UNREADABLE_CODE`,
`CATALOG_OBSERVED_CORRUPT_CODE`) — no message matching, nothing new in the classifier
itself. R5-9's claim that adding a route is one map entry each held exactly.

The routes are not interchangeable, and that is the point of writing three:

| Code | Plane | `next:` tells the operator to |
|---|---|---|
| `BANDIT_STATE_UNREADABLE` | learned | read `learnedState[]`, then repair the file or move it aside to **relearn this project from zero** |
| `PREFERENCE_SNAPSHOT_UNREADABLE` | learned | read `learnedState[]`, then repair or move aside to **start from an empty store** |
| `CATALOG_OBSERVED_CORRUPT` | derived | read `learnedState[]`, then delete it and **let it rebuild from `runtime/invocations.jsonl`** |

The wording is taken from the errors' own messages and R6-4's `remediation` strings, so the
`next:` line and the inventory entry the operator lands on say the same thing. A test
asserts the derived route never says "relearn" — the learned/derived distinction is the
whole reason doctor's entry carries `stateClass`, and a route that blurred it would send
someone hunting for a backup of a file that is recomputable.

**Frozen surfaces verified unchanged:** `GENERIC_FAILURE_NEXT` and both existing route
strings are character-identical (unchanged lines in the diff); the depth-4 `cause` walk,
`stateRootArgument` and `errorCodeOf` are untouched. A new test asserts the lock-timeout
route still names `locks[]` and does **not** mention `learnedState[]`, so three new
neighbours in the table did not smear the old ones.

**Tests** (`test/integration/cli/command-error-doctor.test.ts`, additive, 6 → 9 cases):

1. *…route to doctor's learnedState inventory* — all three real error objects (constructed
   through the shipped exported error classes, so the `code` is the shipped one) reach the
   state-root-qualified doctor command and name `learnedState[]`; the learned/derived split
   is asserted per code; the `cause`-wrapper case is covered.
2. *pref list over a damaged snapshot routes to an inventory that lists it* — end to end
   through `main()`: a truncated `adaptation/preferences.json` makes `pref list` exit 1
   with `stage: validation`, its `next:` names doctor, and then `doctor --json` really does
   carry that exact path in `learnedState.entries` with `status: "damaged"`,
   `stateClass: "learned"` and a remediation that says "move it aside". This is the test
   that makes the route a checked promise rather than a sentence. It restores the
   preference store's process-global binding in a `finally`.
3. *adding routes did not move the generic line or the run-plane ones* — the negative
   control extended: a bandit-shaped **message** with no `code` still gets the frozen
   generic line, and the lock-timeout route is unchanged.

---

## 3. Part (2) — `delete --lock-wait-ms`

`pi-sparkle delete --run <id> [--lock-wait-ms <ms>]` (and `--episode`), threading a
`FileLockOptions` into the `options` argument `deleteRunRecords`/`deleteEpisodeRecords`
have accepted since R5-1.

**Name and default, and why.** `--lock-wait-ms` names what is being waited for; the value
is milliseconds because that is the unit `FileLockOptions.timeoutMs` is in and a
seconds-flag would have to round. **Omitting the flag passes `{}`** — not an explicit
`5000` — so an unflagged delete makes byte-for-byte the call it made before the flag
existed, and the 5 s default stays owned by `withExclusiveFileLock` alone. That is pinned:
a test runs the same uncontended delete with and without the flag and deep-equals both the
stdout and stderr arrays.

`0` is a first-class value meaning "refuse now rather than wait a default I did not
choose". A 24 h ceiling (`MAX_LOCK_WAIT_MS`) turns a typo — one extra digit — into a parse
error instead of a CLI that looks hung; the flag exists to wait out a long run, so the
ceiling is far above any real one.

Only `/^\d+$/` is accepted. `Number()` would also have taken `1e4`, `0x10` and `" 5 "`, and
a delete that waits a different amount of time than the operator typed is worse than one
that refuses the spelling. The refusal is a `DomainValidationError`, so through `main()` it
gets the full structured report (`stage: validation`) like `parseRunId`'s already does.

**Both targets, not just `--run`.** R5-1's disclosure 7 named `delete --run`, but
`delete --episode` takes the episode lock and the feedback log lock through the same
options object, so one flag covers both — restricting it to `--run` would have been more
code and a worse CLI.

**Tests** (`test/integration/cli/delete.test.ts`, additive, 12 → 16 cases):

- *bounds the delete's wait; omitting it changes nothing* — the byte-identity pin above.
- *`--lock-wait-ms 0` refuses a held lock immediately, having removed nothing* — a real
  held lock, a real `LOCK_TIMEOUT`, elapsed asserted well under the 5 s default (so the
  bound demonstrably came from the flag), and the run directory still on disk. This is the
  offline witness that the flag reaches `withExclusiveFileLock` at all.
- *refuses a value it cannot honour exactly* — nine rejected spellings, each asserted to
  delete nothing and print nothing, plus a positive case at exactly the ceiling so the
  ceiling is honoured rather than merely asserted about. `-1` goes through the
  `--lock-wait-ms=-1` form because `parseArgs` refuses a dash-led value before this
  validator sees it; worth knowing for anyone adding a numeric CLI flag here.
- *bounds `delete --episode` too* — held episode lock, zero wait, `LOCK_TIMEOUT`, episode
  records intact.

**Usage text.** `DELETE_USAGE` and the top-level `USAGE` line gained the flag, with three
sentences on what a longer wait buys (a live run holds its lock for as long as it runs, so
this is how an operator says "wait for that run to finish" instead of stopping it) and the
fail-closed posture. No test pins either string byte-for-byte (checked).

### Why `pause` did **not** get the flag

The brief said "and `pause` if cheap". It is cheap — `createFilePauseController` already
takes a `lockOptions` seam — and I declined anyway, on semantics rather than cost.

A `pause --run` against a live run fails closed with `LOCK_TIMEOUT` because the run holds
its lifecycle lock for its whole duration (signed off and pinned:
`run-lifecycle-lock.test.ts:276`, contract in `coordinator.ts:82-87`). So the **only** way a
longer wait ever succeeds is if the run it was meant to pause has already stopped — at
which point the pause writes a token for a terminal run. The flag would trade a fast honest
refusal for a slow no-op, and would read to an operator as "pi-sparkle can wait to pause a
busy run", which is precisely what it cannot do. `delete` is the opposite: "remove the
records once the run finishes" is exactly what waiting delivers.

Recorded here rather than in-source because it is a decision about a flag that does not
exist. If a future slot disagrees, the thing to change first is the posture, not the flag.

---

## 4. Frozen contracts held

- `LOCK_TIMEOUT_CODE` / `RUN_RECORDS_SURVIVED_CODE`: imported constants only, no new
  producers, no message matching. `withExclusiveFileLock` and `file-lock.ts` untouched.
- No `createExecutor` added or moved; sink-wiring and resume-disclosure pins green
  (`test/unit/cli/invocation-sink-wiring.test.ts` 16/16,
  `test/unit/telemetry/invocation-log.test.ts` green — both read `main.ts` source and pin
  `runCommand`/`resumeCommand` bodies, which this diff does not enter).
- No `package.json` or dependency edit. No new private temp+rename writer. Doctor's JSON
  contract read, never written to.
- Unowned files not edited. `src/cli/pause.ts` was considered and left alone (§3).
  `src/cli/errors.ts` is owned but needed no change — `errorCodeOf` and `doctorJsonCommand`
  already carried the whole classifier.

## 5. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole tree) | **clean** |
| `npx eslint` on the four owned files | **clean** |
| `test/integration/cli/delete.test.ts` | 16/16 |
| `test/integration/cli/command-error-doctor.test.ts` | 9/9 |
| Both owned suites, 3× consecutive | 25/25 each time, no flake |
| `test/integration/cli/**` + `test/unit/cli/**` + `test/unit/privacy/**` | 252/252 |
| `run-lifecycle-lock`, `doctor`, `learning/**`, `preferences/**`, `catalog-observed` | 136/136 |
| `test/unit/routing/live-isolation.test.ts` | **1 fail — not mine, see §6** |

**Zero skips introduced.** Full gate is the parent's.

Two shared-tree transients crossed this slot's `tsc` runs, neither in an owned file and
neither touched:

- `src/track/loop.ts` — `withExclusiveFileLock` / `runLockPath` undefined (R6-3 mid-edit).
  Gone by the next run.
- `test/integration/m2.5/resume.test.ts:352` — `TS2554: Expected 0 arguments, but got 1`
  (R6-2 mid-edit, additive on their own file). Present at report time.

The clean whole-tree `tsc` recorded in the table above is the run between the two. Every
owned file typechecks in all runs; the owned suites are 25/25 in the final run as well.

## 6. Hand-off: `live-isolation.test.ts` is red at HEAD, and it is R6-4's

`test/unit/routing/live-isolation.test.ts` → *"bandit reaches the live closure as a reward
writer, never as a selector"* fails with:

```
live code must not read learned bandit state back
+ [ 'src/cli/doctor.ts' ]
- []
```

`src/cli/doctor.ts` imports and calls `loadProjectBandit` for the `learnedState` bandit
entries, and `doctor.ts` has been inside the live import closure all along
(`main.ts` imports `./doctor.js`, unchanged since before Round 6). The test's rule is that
no module in the closure other than `bandit-store.ts` may read learned bandit state back.

**Attribution is proven, not argued:** I checked HEAD out into a detached worktree with
none of my changes and reproduced the identical failure, then removed the worktree. My diff
adds no `loadProjectBandit` reference and does not change which modules the closure
contains — the allowlist test for importers of `src/routing/bandit.ts` still passes.

**Remedy is R6-4's** (they own `doctor.ts`), and it is a real judgement call, not a
rubber-stamp: either read the bandit file through a path that is not the learned-state
reader, or extend the pin's justification to say why a *read-only operator inventory* is
not "live code reading learned state back". The second reading is defensible — doctor never
feeds routing — but it widens a Checkpoint-F isolation guard, so it wants the parent's
sign-off and an explicit `because` on the allowlist rather than a quiet edit. Flagging it
because this is exactly the kind of break that gets misattributed to whoever runs the gate
next.

## 7. Hand-offs

- **R6-7 (docs):** `delete --lock-wait-ms` is undocumented outside the CLI usage text.
  `docs/data-dictionary.md`'s delete/lock prose and any operator runbook for "delete a run
  that is still going" should gain it, together with R5-1 disclosure 7 now being closed for
  `delete` and deliberately still open for `pause` (§3 has the reasoning verbatim).
- **R6-4:** §6, plus a note that their `learnedState` field names are now depended on by
  `command-error-doctor.test.ts` (`entries[].path`, `.status`, `.stateClass`,
  `.remediation`). Frozen-additive discipline keeps that safe; a rename would not.
- **Round 7:** R5-1 disclosure 7 is closed for `delete`. The remaining unparameterised
  bounded wait on a CLI path is the track loop's questions write, which no flag reaches.

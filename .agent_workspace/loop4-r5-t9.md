# R5-9 — From a refused command to the doctor remedy

Slot: R5-9 (P3, operability routing). Branch `agent/opt-continuous`, HEAD at start `6975aab`. **Not committed** (per instructions); working tree carries the changes below.

## Verdict

Landed. A command that fails with `LOCK_TIMEOUT` or `RUN_RECORDS_SURVIVED` now ends its stderr block with a `next:` that names `pi-sparkle doctor --json` — with the failing command's own `--state-root` — and the inventory field that answers it (`locks[]`, `runStates[]`). Routing is keyed on the error `code` only, with a negative control proving a message-matching implementation would behave differently. Every pre-existing error string is byte-unchanged; the generic `next:` is still emitted verbatim for every unrouted failure.

Real output (`delete --run` against a lock held by another holder):

```
error: timed out waiting for lock at /tmp/peek-f1FXka/runtime/runs/run_0123….lock
  command: delete
  stage: validation
  next: the lock is held and pi-sparkle never steals one: run pi-sparkle doctor --json --state-root /tmp/peek-f1FXka and read locks[] for the holder's pid, age and remediation, then retry
{"ok":false,"command":"delete","stage":"validation","message":"timed out waiting for lock at …","next":"the lock is held and …"}
```

## Census (before writing anything)

- `src/cli/main.ts` has exactly one funnel for thrown failures: the `catch` at the end of `main()`, which built a constant `next:`. Every other `cliFail` site (23 of them) is a parse/lookup refusal that never sees these two codes.
- Neither code was mentioned anywhere in `src/cli/**` before this slot: `LOCK_TIMEOUT_CODE` was consumed only by `feedback/store.ts` and `telemetry/invocation-log.ts` (retry decisions), `RUN_RECORDS_SURVIVED_CODE` only inside `privacy/deletion.ts`. The brief's "stops one hop short" is accurate.
- Both errors reach the funnel unwrapped: `deleteRunRecords` throws `RunRecordsSurvivedError` and lets `withExclusiveFileLock`'s `FileLockTimeoutError` propagate; `deleteCommand` and `src/cli/pause.ts` (`pause`/`pause --clear`, whose `requestPause` takes the run lock after R4-1) catch nothing. So one seam covers `delete`, `pause`, `answer`/track writes and every other lock-taking command — no per-command wiring.
- Doctor's `--json` really does carry `locks` and `runStates` at HEAD, and `lockInventory` walks the whole state root for `*.lock`, so `runtime/runs/<id>.lock` is inventoried. Doctor defaults to `~/.pi-sparkle`, which is why the remedy has to repeat the state root (see below).

## What changed

`src/cli/errors.ts` (additive, no behaviour change to existing exports):
- `errorCodeOf(error)` — the string `code` of a typed failure, or `undefined`. The one supported classification at this boundary.
- `doctorJsonCommand(stateRoot)` — `pi-sparkle doctor --json [--state-root <root>]`.

`src/cli/main.ts` (classification region, immediately above `main()`):
- `DOCTOR_ROUTED_NEXT`: a `ReadonlyMap` from the two **imported frozen constants** (`LOCK_TIMEOUT_CODE` from `persist/file-lock.js`, `RUN_RECORDS_SURVIVED_CODE` from `privacy/deletion.js`) to the remedy text. No code literals are re-spelled in `main.ts`, so a rename of either constant is a compile error here rather than a silently dead route.
- `doctorRoutedNext(error, doctor)`: classifies the thrown error, then walks `cause` (depth-bounded at 4) so a future wrapper cannot quietly drop the routing.
- `stateRootArgument(args)`: scans the failing command's own argv for `--state-root <v>` / `--state-root=<v>`. Scanned, not `parseArgs`-ed, deliberately: this runs on the failure path, where `parseArgs` throwing on some other command's flags would replace the operator's error with a worse one. A valueless `--state-root --json` yields `undefined` rather than a bogus path.
- `commandFailureNext(error, args)` (exported for the pins): the routed remedy, else `GENERIC_FAILURE_NEXT` — which is the pre-existing string, character for character.
- The `catch` now passes `commandFailureNext(error, rest)`. `command`, `stage`, `message` and the trailing JSON object are untouched.

**Why the state root is in the remedy:** doctor resolves `--state-root ?? ~/.pi-sparkle`. A remedy that said only "run pi-sparkle doctor" would send an operator who used `--state-root /srv/pi` to inventory a *different* tree and find no lock at all — a last hop that lands in the wrong place is worse than no hop. Pinned in both directions: present when the command named one, absent when it did not.

## Tests — `test/integration/cli/command-error-doctor.test.ts` (new, 6 cases)

1. **Lock timeout routes to `locks[]`** — the error is a real `FileLockTimeoutError` from a real contended `withExclusiveFileLock` (40 ms timeout), not a hand-built object.
2. **`RUN_RECORDS_SURVIVED` routes to `runStates[]` and `locks[]`** — the error comes from production `verifyRunRecordsRemoved` against a run directory that is still on disk. The test then runs the exact command the remedy names (`main(["doctor","--json","--state-root",…])`) and asserts `runStates.entries` contains that run with `status: "RUNNING"` and the `delete --run <id>` guidance: the route lands on a surface that answers.
3. **State-root presence/absence and both flag spellings**, including the valueless-flag guard.
4. **Code-discriminated, never message-matched** — the negative control: an `Error` carrying the *verbatim* lock-timeout message and no `code` gets the generic `next:`; an error with the code and the message `"?"` gets the routed one; a wrapper with the real error as `cause` still routes. A message-matching implementation fails case one.
5. **Unrouted failures keep the generic line** — a malformed run id through `main(["delete", …])` still prints `fix the reported error, then retry; use pi-sparkle doctor for preflight` exactly.
6. **End-to-end through the shipped CLI** — `delete --run` while a foreign holder owns `runLockPath`: exit 1, `error: timed out waiting for lock at <lockPath>` unchanged, `command: delete`, `stage: validation`, the routed `next:` in both the human lines and the JSON report, the run directory still on disk (fail-closed), and — still inside the hold — `doctor --json` lists that exact lock path with `pid === process.pid`, a remediation, and the no-steal advisory.

## Limits and disclosures

1. **`RUN_RECORDS_SURVIVED` has no end-to-end case, only the funnel plus a production-produced error.** I could not find an offline, portable, uid-independent way to make the shipped `delete --run` produce it: forcing `rm` to fail needs a permission trick that is a no-op under root, and the resurrection window (between the in-lock verify and the post-release re-verify, `deletion.ts:304`) can only be hit by racing a `mkdir` loop against it — probabilistic, and a flaky pin is worth less than an honest gap. Case 2 uses the real error object from the real verifier and the real doctor inventory; only the throw site is simulated. If R5-1's lifecycle acquisition makes a *clean* delete the norm, this refusal gets rarer still, which does not change the routing.
2. **The end-to-end lock case costs ~5.0 s of wall time** — `withExclusiveFileLock`'s default timeout, which `delete` does not parameterise. That is the price of driving the shipped command instead of a seam; the other five cases are millisecond-scale (whole file ~5.7 s). Run 3× back-to-back: 6/6 pass each time, no variance beyond the fixed 5 s.
3. **`--state-root` values with spaces are not quoted**, matching every existing `next:` in the tree (e.g. `reportFailedRun`'s `pnpm cli inspect … --state-root ${stateRoot}`). Consistency over a fix that would make this one line differ from its neighbours.
4. **Only two codes are routed.** Others (`CATALOG_OBSERVED_CORRUPT`, `PREFERENCE_SNAPSHOT_UNREADABLE`, `DomainValidationError` without a code) keep the generic line, because doctor has no inventory that answers them. Adding a route is now one map entry, but each one needs a doctor surface that actually answers it first.

## Frozen contracts checked

- `LOCK_TIMEOUT_CODE` and `RUN_RECORDS_SURVIVED` consumed as published, code-discrimination only; no message-matching anywhere in the new code (case 4 is the proof).
- **No unhooked `createExecutor`**: the sink-wiring pin (`test/unit/cli/invocation-sink-wiring.test.ts`, incl. its "exactly 4 call sites" count and 11 mutants) is green; my code adds no executor build and no `createExecutor(` token.
- **R4-6 resume disclosure**: all four cases in `test/unit/cli/resume-executor-config.test.ts` green, `resumeCommand` untouched.
- Doctor's frozen-additive `--json` contract: read-only in this slot; `src/cli/doctor.ts` not edited.
- `test/integration/cli/delete.test.ts` (R5-1's) not touched; green here.
- No `package.json` / dependency edits. No scratch files in the tree.

## Verification (this VM, Node v22.14.0)

- `npx tsc --noEmit` (whole tree, includes other slots' in-flight edits): **exit 0**.
- `npx eslint src/cli/main.ts src/cli/errors.ts test/integration/cli/command-error-doctor.test.ts`: **exit 0**.
- Scoped suites — new file + `invocation-sink-wiring` + `resume-executor-config` + `errors` + `doctor` + `delete` + `cli` + `pause-inject`: **93/93 pass, 0 fail, 0 skip**.
- New file alone, 3 consecutive runs: 6/6 each.
- Whole suite (`node scripts/run-tests.mjs`) at a mid-round snapshot of the shared tree: **1709 tests, 1708 pass, 0 fail, 1 skip** — the skip is the `PI_SMOKE=1` provider gate; I introduced none. Note the tree was concurrently carrying R5-1/2/3/6 edits (`deletion.ts`, `event-store.ts`, `supervisor.ts`, `coordinator.ts`, `flowchart-run.ts`, `mailbox.ts`, `bandit-store.ts`, new `crash-terminal.ts`), which is why the count is above the brief's 1680 baseline. The gate as a whole is the parent's call.

## Files

- `src/cli/main.ts` (sole owner) — classification region + one line in the `catch`.
- `src/cli/errors.ts` — two additive exports.
- `test/integration/cli/command-error-doctor.test.ts` — new.

No pause-failure test was needed: `pause` reaches the same funnel with nothing of its own to wire, and the lock case is already driven end-to-end through `delete`.

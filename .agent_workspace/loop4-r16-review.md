[Model: claude-fable-5]

# Loop 4 · Round 16 — SOTA review at `5ed437a`

Reviewer ran independently on this VM (Node v22.14.0, engine warning only), on `agent/opt-continuous`, working tree clean at HEAD `5ed437a`. Every verdict below is against the actual range `6d625d1..HEAD`: four landings (`9c58b90` R16-3, `ee24d86` R16-2, `92ffd15` R16-4, `16691b3` R16-1) plus six orchestrator commits (`b4f5283`, `b052c67`, `acb3ce9`, `67f0391`, `9e59e43`, `5ed437a` — all `.agent_workspace/**`-only, verified per-commit with `git show --stat`). Commit chronology (UTC 2026-08-25): dispatch bookkeeping through `9e59e43` 02:52 → **`9c58b90` 02:55:02 → `ee24d86` 03:03:49 → `92ffd15` 03:04:32 → `16691b3` 03:05:35** → `5ed437a` (PROGRESS-only). The range's `src` diff is exactly the five slot files (`adaptation/eval-routing.ts`, `cli/main.ts`, `cli/migrate-legacy.ts`, `episode/store.ts`, `preferences/store.ts`); `docs/decisions/`, `scripts/` (including `crash-probe.mjs`), `test/integration/persist/crash-recovery.test.ts`, `test/unit/privacy/deletion.test.ts`, and `package.json` are all **diff-empty** across the range (`git diff --stat` scoped, empty). No file outside `.agent_workspace/` was changed by this review; all mutation and proof runs happened in full copies under `/tmp` with `node_modules` symlinked, deleted afterwards; gate log at `/tmp/r16-gate.log`, probe JSON at `/tmp/r16-probe.json`.

## 1. Scoreboard

| Slot | Verdict | One-line basis |
|---|---|---|
| R16-1 (`16691b3`) | **ACCEPT** | Lock at the CLI layer exactly per sign-off, bind **inside** the lock, and the bind placement is genuinely pinned: reviewer's own out-of-tree half-fix mutation (bind hoisted outside the lock) is killed by the unit tombstone case *and* the forced-interleaving cross-process integration case (§4.1) |
| R16-2 (`ee24d86`) | **ACCEPT** | Write side runs the same decoder as the read side; reviewer's revert mutation is killed by all four new destructive tests; log bytes byte-identical on rejection; the six read-side tests untouched |
| R16-3 (`9c58b90`) | **ACCEPT** | One-line swap to pre-existing `writeFileAtomic` seams (`AtomicWriteOptions` dates to `64ff7db`); the rename-seam test is a real pause-the-rename proof (previous complete bytes while paused, new complete bytes after, both parse); reviewer's raw-`writeFile` revert killed by it; consumer fail-closed correctly *not* duplicated |
| R16-4 (`92ffd15`) | **ACCEPT-WITH-NITS** | Publish protocol is the signed-off shape (a) and correct at source (temp `COPYFILE_EXCL` → fsync → `link`, EEXIST → existing digest branch, fallback `COPYFILE_EXCL` — never a rename over a destination); nit: the **fallback arm's never-overwrite is unpinned** — reviewer's clobbering-fallback mutant survives all 23 owned tests (§4.4), a mutant the slot's own 8-mutant table did not run |
| Parent | Landing hygiene clean: all four landings are slot-files-plus-report only (zero PROGRESS ticks), zero overlapping `src` files, gate numbers match this review's independent run exactly, 12th probe case correctly declined; one factual inaccuracy inherited from the audit corrected on the record below (§5) |
| Joints | R16-1 and R16-4 both disclosed whole-tree `tsc` over the dirty joint tree (siblings in flight) — the honest form; final HEAD verified clean by this review's own full gate |

**3 ACCEPT, 1 ACCEPT-WITH-NITS, 0 ROLLBACK.** Zero red-tree commit points (disjoint file sets, each slot ran owned + consumer suites; the one joint artifact — shared-tree `tsc` — was disclosed in both reports and is retired by this review's clean gate at HEAD).

## 2. Independent verification (this VM)

- **`pnpm gate` GREEN, exit 0: 1977 tests / 1976 pass / 0 fail / 0 cancelled / 1 skipped, 112 suites** — matches the parent's recorded numbers exactly. Exactly one `# SKIP` line in the TAP output (`grep -c "# SKIP"` = 1), the standing `PI_SMOKE` real-provider gate. `tsc --noEmit`, `eslint .`, and `tsc -p tsconfig.build.json` all clean in the same run.
- **`node scripts/crash-probe.mjs` → `ok: true`, 11 cases × 3 iterations, exit 0** — full JSON compared name-by-name against the Round 15 record: all eleven names and their order unchanged (`jsonl-truncated-tail` … `unblock-discard-append-before-checkpoint-sigkill` last). No 12th case, matching the parent's decline; `scripts/crash-probe.mjs` is diff-empty across the range.
- **Test delta vs Round 15 (+26 tests, +1 suite) decomposed exactly:** R16-3 +1, R16-2 +4, R16-4 +10 (8 unit + 2 integration), R16-1 +11 (9 in the new `snapshot-lock.test.ts` — the +1 suite — plus 2 integration). 1951 + 26 = 1977. ✓
- **Commit hygiene:** verified per-commit (§1 header). Each landing = its owned `src` + tests + its own `.agent_workspace/loop4-r16-tN.md`, nothing else; R16-1 additionally owns `docs/data-dictionary.md` (the terminator-allowed census note, §4.1).

## 3. Freeze check

Everything outside the five touched files is byte-identical to `6d625d1`, which Rounds 14–15 verified in full — so every run-plane freeze holds structurally. The requested spot-checks were still read directly at HEAD:

- **Isolation:** `loadProjectBanditByKey` exactly `learning/bandit-store.ts` + `cli/doctor.ts`; `selectArm` exactly `routing/bandit.ts` + `routing/shadow.ts`; bare `\bloadProjectBandit\b` zero `src` matches.
- **ADR-006 Proposed** (`0006-pi-extension-reverse-adapter.md:5` read directly); `docs/decisions/` diff-empty.
- **`independentEvidence`:** exactly one `void` (`prescore.ts:89`); flowchart-spine zero-mention (only `tracking/from-child.ts` writer + `prescore.ts`).
- **`RunStatus`:** exactly eight members (`domain/status.ts:1-11`). **`TERMINAL_REPLAY_STATUSES`** = COMPLETED/FAILED/BLOCKED (`replay.ts:337-341`).
- **`DOCTOR_ROUTED_NEXT`:** exactly five routes (`LOCK_TIMEOUT`, `RUN_RECORDS_SURVIVED`, `BANDIT_STATE_UNREADABLE`, `PREFERENCE_SNAPSHOT_UNREADABLE`, `CATALOG_OBSERVED_CORRUPT`) + `GENERIC_FAILURE_NEXT`, character-exact — R16-1's hunks in `main.ts` end at (new) line 1985; the map begins at 2051 and is untouched. **R16-1 added no route**: it reuses `LOCK_TIMEOUT_CODE` from the existing import, and its tests prove the timeout lands on the existing `locks[]` doctor route.
- **`INSPECT_SUMMARY`** four keys (`main.ts:1163-1168`, untouched region); **BLOCKED prefix + both `note:` lines** (`main.ts:557-561`, untouched); `runCommand`/`onRunStarted` on all three public run paths (`main.ts:792/891/980`, untouched); `taskCriteria` writer in `replay.ts` untouched; scoped laundering coda `replay.ts:95-101` untouched (file diff-empty); `applyRetry` sole scheduler BLOCKED→READY producer untouched; `RUN_UNBLOCKED`/`RUN_UNBLOCKED_WITH_DISCARD` keys untouched (`flowchart-run.ts` diff-empty).
- **`EventStore.append` / `CheckpointStore.write` remain unlocked** (`src/run/event-store.ts` / `checkpoint-store.ts` diff-empty; no `withExclusiveFileLock` in either). R16-1's lock is a different file on a different plane, exactly as the brief scoped.
- **Primitives unchanged:** `persist/jsonl.ts`, `persist/atomic-file.ts`, `persist/file-lock.ts` (+ `LOCK_TIMEOUT_CODE`) all diff-empty. **No new tmp+rename publish helper**: whole-`src` sweep for raw `writeFile`/`writeFileSync` finds only doctor's transient write-probe and the lock owner record; the only `.tmp` producers are `atomic-file.ts` and R16-4's documented dest-dir temp+**link** (which never truncates and never renames — verified at source, §4.4). No lock stealing anywhere (R16-1's test helpers release only files they created; `file-lock.ts` unchanged).
- **No live R1/bandit/topology on the execution path, no Outcome-supported claims, no auto-promote, no dependency edits, no history rewrites** — structurally excluded by the range diff; the dictionary additions were read in full and add no such claim.
- **Probe pin** `test/integration/persist/crash-recovery.test.ts` diff-empty; `deletion.test.ts` byte-identical-preferences pin diff-empty and green in the gate (episode delete never takes the new lock — `privacy/deletion.ts` untouched, and R16-1's lock lives only in the two pref mutators).

## 4. Per-slot verification

### 4.1 R16-1 (P1) — pref correct/delete under `adaptation/preferences.json.lock`

Everything the sign-off specified, verified at source, not from the report:

- `withPreferenceSnapshotLock` (`main.ts:1677-1693`) holds `preferenceSnapshotLockPath` via the existing `withExclusiveFileLock` and calls `bindPreferenceStore` **inside** the callback; `prefCorrect` and `prefDelete` route their mutation through it and their old top-level bind calls are removed. Argument validation runs before the lock is requested (pinned by the "refused on its arguments never asks for the lock" test).
- **The half-fix is caught.** Reviewer applied the bind-hoist mutation out-of-tree (`/tmp/r16-mut`, deleted): `# fail 1` in the unit suite — exactly "a correction bound before a delete cannot revert the delete's tombstone" — and `not ok 7 — a pref delete in another process stays true on disk against a concurrent write` in the integration suite, which spawns a **real second `tsx` process** launched into a held lock. Two independent layers pin the load-inside-lock property. This matches the slot's own M2 result.
- Readers lock-free: `prefList`/`prefExport` bind directly with no lock (`main.ts:1808/1904`); doctor's preference read untouched. The run command's pre-existing bind (`main.ts:839`) is a reader-context bind — the run path calls no store mutator (verified by whole-`src` mutator-callsite sweep, §5).
- Store API stays in-process, `saveToDisk` lock-free and byte-unchanged except the module docstring; the new `preferenceSnapshotPath`/`preferenceSnapshotLockPath` helpers are the only exports added.
- `--lock-wait-ms` reuses the existing `lockWaitOptions` parser (only its comments changed); timeout is the frozen `LOCK_TIMEOUT` → existing doctor `locks[]` route — **no new error type, no new route** (§3).
- **Doctor zero-change proven by a real test:** "doctor inventories a held preferences lock with no doctor-side change" runs `main(["doctor","--json",...])` against a held lock and finds the entry with `metadata: "valid"` and the holder's pid. Verified in the diff and green in the gate.
- The dictionary note is the landing-triggered kind the Round 15 terminator prescribes: the lock inventory gained the new sidecar, the preference bullet gained the writer contract, and the embedded census (02:57:20 UTC, HEAD `9c58b90`) correctly names the two sibling slots then in flight as disjoint. Not a treadmill reopen.
- Report honesty confirmed: the natural two-process case is labeled in-source "an end-to-end smoke check over the real spawn path, not the regression net", and the report discloses it passed under the no-lock mutant (the reason the forced case exists). The dirty-tree whole-`tsc` is disclosed as a joint clean; this review's own gate retires it.

One correction to the slot report's residual #2 — see §5.

### 4.2 R16-2 (P2) — episode-event append validates before writing

`append` now runs `validateEpisodeEvent` (the same decoder `readAll` uses at `store.ts:64`) and appends **the decoder's output**, so unknown keys never land. Reviewer's out-of-tree revert (append `event` raw) fails all four new tests: byte-identical-log rejection, no-log-creation, malformed-field refusal, and unknown-key stripping. Rejection carries no line number (nothing was written — the report's stated reason matches the source comment). Subsequent valid append + `readAll` green after a rejection. The six read-side tests are diff-untouched. This is write-side rejection only — no rewrite of append-only logs anywhere in the diff; the freeze stands.

### 4.3 R16-3 (P2) — routing-eval report published atomically

The last raw truncating `writeFile` of a persisted artifact (`adaptation/evals/<candidateId>.<cacheKey>.json`) is now `writeFileAtomic`; the added `writeOptions: AtomicWriteOptions = {}` parameter is the *pre-existing* seam type (introduced `64ff7db`), defaulted so the sole production caller (`adapt.ts:143`) is untouched. The rename-seam test is a genuine interleaving proof: it blocks the injected rename, reads the destination mid-publish (previous complete report, byte-equal), releases, reads again (new complete report = staged temp bytes), and asserts both observations parse — never a splice. Reviewer's revert to raw `writeFile` is killed by it ("report published without reaching the atomic rename seam"). No new probe case (correct — `atomic-write-stale-unique-temp` covers the primitive; `scripts/` diff-empty), and the slot did **not** duplicate the consumer's fail-closed parse as busywork — its report names `adapt.ts`'s existing coverage and stops.

### 4.4 R16-4 (P3) — migrate-legacy never-overwrite publish

Shape (a) exactly as signed off, verified at source: unique temp `<destination>.<pid>.<uuid>.tmp` in the destination directory created with `COPYFILE_EXCL` (a crashed apply's temp is refused, never adopted, 3 name attempts), `handle.sync()` fsync, `link(temp, destination)` — EEXIST propagates to the caller's **pre-existing** digest branch (`sameContent`), temp unlinked in `finally`. Genuine divergent destinations still conflict (pinned mid-apply via the `uniqueSuffix` racer against the real `link`); truncated-tail warning untouched. The kill-at-publish integration test proves destination-absent-or-previous with a real SIGKILL, and the re-run test proves a crashed apply completes cleanly instead of conflicting forever. The fallback (`EPERM`/`EOPNOTSUPP`/`ENOTSUP`/`ENOSYS` only — EEXIST deliberately not in the set) is `copyFile(temp, destination, COPYFILE_EXCL)`: **it never renames over an existing destination**, so never-overwrite holds by kernel semantics on both arms; the reopened crash window on link-less filesystems is stated in-source, not hidden.

**The nit (proven):** reviewer mutated the fallback to a clobbering `copyFile(temp, destination)` (no `COPYFILE_EXCL`) out-of-tree — **all 23 owned tests stay green** (`# pass 23 / # fail 0`). The slot's own 8-mutant table killed the primary arm's `link → rename` mutant but never ran the fallback-arm equivalent, and its sole fallback test uses an absent destination. So the documented fallback contract ("never-overwrite still holds there") is true at source but unpinned by test: on a link-less filesystem, a regression to a clobbering fallback would silently overwrite a divergent destination and report `copied`. Prescribed fix (one test, no `src` change): inject `link` → EPERM **and** a `uniqueSuffix` racer that writes divergent bytes to the destination; assert exit 1 conflict and destination bytes untouched. Owner: `test/unit/cli/migrate-legacy.test.ts` (see ROUND17-BRIEF §4 R17-2). Second, trivial nit: a `/tmp/r16-4-proof-*` state-root remnant from the slot's proof runs survived on this VM despite the report's "now deleted" (removed by this review) — hygiene, no tree contact.

## 5. Process notes and one record correction

- **Landing hygiene:** all four landings are slot-files-plus-report only, zero PROGRESS ticks (Round 12 model held, verified per-commit). Zero overlapping `src` files across the four. Source-truth/docs-truth: R16-1's dictionary rides its own lock commit — allowed (same slot owns both; terminator-required note).
- **Record correction (audit §2 / R16-1 report residual #2):** the claim "`recordInferredPreference` has zero production callers" is **wrong as stated**. It has exactly one: `src/learning/from-episode.ts:161`, reachable from `adapt learn --run` (`adapt.ts:168` → `proposeRoutingFromRoutedEvents` → `proposeRoutingFromOutcomes`, which fires it whenever the run's events carry an episode id). The *material* conclusion survives for a different reason: `adaptCommand` never binds the preference store (zero `bindPreferenceStore`/`configurePreferencePersistence` matches in `adapt.ts`; `case "adapt"` dispatches directly), so `saveToDisk` no-ops and the call is **persistence-dead** — no live path writes the snapshot outside the R16-1 lock. Reviewer additionally verified `auto-loop.ts` (the in-process post-run path, where the store *is* bound) imports nothing from `from-episode.ts` or `preferences/*`, so the run command cannot reach the writer either. The lock's scope is therefore correct as landed; only the stated reason was inaccurate. The persistence-dead call itself is a real behavioural gap, proven deterministically below, and is Round 17 candidate R17-1.

**Proof transcript (real repo code, out-of-tree script + `/tmp` state root, both deleted):** driving `proposeRoutingFromOutcomes` exactly as `adapt learn` reaches it (one bound `taskSuccess` FAIL/`failureClass: model` outcome, an `episodeId`, store unbound exactly as `adaptCommand` leaves it):

```json
{
  "candidateCreated": true,
  "reason": "proposed routing-policy candidate",
  "inferredObservationRecordedInMemory": true,
  "inMemoryValue": "premium",
  "inMemoryWeight": 0.5,
  "durableFilesUnderStateRoot": ["adaptation/registry.json"],
  "preferencesJsonOnDisk": false
}
```

The routing candidate persists; the inferred preference (`project`-scope `primary-model`, weight 0.5) is recorded in memory and silently discarded at process exit. No error, no disclosure, and a fresh process's `pref list` shows nothing.

## 6. Round 17 disposition

The retarget planes are now clean except for what §5 and §4.4 proved: **two real candidates** (both P3), recorded with proofs in `ROUND17-BRIEF.md` §4 — R17-1 (decide and fix the persistence-dead inferred preference in the `adapt learn` path; direction needs parent sign-off) and R17-2 (pin the migrate-legacy fallback's never-overwrite arm; test-only). Nothing else surfaced: raw-write sweep clean (§3), unlocked-RMW sweep clean (preferences was the last, now locked), probe coverage settled (12th case declined and no new window landed), USAGE census clean per the audit and unchallenged by this review. Do not pad past these two.

## 7. Handoff

- Gate GREEN at `5ed437a`: **1977 / 1976 / 0 / 1 skipped** (`PI_SMOKE` only, exactly one `# SKIP`), 112 suites; crash-probe **11×3 `ok: true`**, names verified one-by-one, `unblock-discard-append-before-checkpoint-sigkill` last — both run independently on this VM and matching the parent's record exactly. Delta +26 tests / +1 suite fully decomposed to the four landings.
- **3 ACCEPT, 1 ACCEPT-WITH-NITS (R16-4: unpinned fallback never-overwrite, one-test fix prescribed), 0 ROLLBACK.** Zero red-tree commit points; landing hygiene clean; one audit-inherited factual claim corrected on the record (§5) without disturbing R16-1's verdict.
- `ROUND17-BRIEF.md` carries **two** proven candidates (R17-1 inferred-preference drop — needs parent sign-off on direction; R17-2 fallback pin — test-only), the Rounds 1–16 freeze verbatim, and the new Round 16 contracts (preferences lock span, write-side episode validation, atomic eval publish, the migrate-legacy publish protocol as the allowed second shape).

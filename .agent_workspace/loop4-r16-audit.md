[Model: claude-fable-5]

# Loop 4 · Round 16 — plane-retarget audit (I/O · races · protocol · disaster recovery)

Auditor: claude-fable-5, at HEAD `acb3ce9` on `agent/opt-continuous`. This is the retarget round mandated by the loop protocol (module gain <2% for 2 consecutive rounds → move to I/O, races, protocol, or disaster recovery) and by ROUND15-BRIEF §4's terminator on the `taskCriteria`/docs surface. Nothing on that surface was reopened. Every claim below was verified against the working tree, and every claimed hole carries a proof that ran real repository code out-of-tree under `/tmp` (all proof files deleted after the runs; transcripts inline below).

## 0. Baseline used

- `git diff --stat 6d625d1..HEAD` is **`.agent_workspace/**` only** (4 files, orchestrator bookkeeping), so the parent's gate GREEN at `6d625d1` (**1951 / 1950 pass / 0 fail / 1 skip**, 111 suites) stands for HEAD's code byte-for-byte. No independent full gate was run (per dispatch: optional).
- `node scripts/crash-probe.mjs --iterations 1` re-run by this audit: **`ok: true`, 11 cases**, names and order unchanged, `unblock-discard-append-before-checkpoint-sigkill` last. (Sanity beat, not the parent's 3× run.)
- Node v22.14.0 (engines want ≥22.19.0 — warning only, unchanged).
- Environment: async install complete (`install-user.status` = 0), `tsx` present.

## 1. Planes opened and how they were swept

1. **I/O correctness.** Enumerated every write primitive in `src/**` (`writeFile|appendFile|rename|createWriteStream|truncate` sweep, 215 files): all persisted-artifact writers go through `writeFileAtomic`/`writeFileAtomicSync` (checkpoint, pause, tombstones, feedback/invocation rewrites, bandit, preferences, providers, credentials, promotion registry, track-questions, catalog-observed) or `appendJsonlLine` (run events, episode snapshots, episode events, feedback/invocation appends) — with exactly **one** exception, `eval-routing.ts:207` (candidate R16-3). The only other raw `writeFile` is doctor's `.doctor-write-probe` (transient, written+unlinked inside one check; a crash leaves a 2-byte probe file the next truncating probe write reuses — harmless). No private tmp+rename exists outside `persist/atomic-file.ts` (`\.tmp|tempPath` sweep). `migrate-legacy`'s read path is fail-closed (corrupt middle throws, truncated tail warned, EEXIST race digest-checked); its *write* path has a crash window (candidate R16-4).
2. **Races.** Walked every `withExclusiveFileLock` holder and every writer of shared files. Invocation log: single writer surface, live append and delete-rewrite share `invocations.jsonl.lock`, sink retries lock timeouts and discloses drops on stderr in both `run` (`main.ts:748`) and `resume` (`main.ts:1350`). Feedback log: same treatment, cascade read-filter-write-tombstone all inside one lock, strip-before-tombstone ordering privacy-safe. Run plane: lifecycle/pause/delete take `runLockPath`; per-step writers stay unlocked (frozen measured decision, not reopened). Episode plane: settle and `episode close` under `episodeLockPath`; episode delete takes both its locks non-nested with the cost disclosed. Credentials: `FileCredentialStore.modify/delete` do read-modify-write **under `auth.json.lock`**. Bandit: `updateProjectBandit` RMW **under `bandit.json.lock`**. That leaves exactly one unlocked cross-process read-modify-write writer in the tree: **the preference store** (candidate R16-1, proven below).
3. **Protocol / CLI honesty.** Every USAGE command has an integration test: `commands.test.ts` (run/inspect/auth/models/episode), `commits.test.ts`, `delete.test.ts`, `migrate-legacy.test.ts` (unit+integration), `pause-inject.test.ts` (×2), `unblock.test.ts`, `blocked-next.test.ts`, `episode-cli.test.ts`, `preferences-cli.test.ts`, `adapt.test.ts`, `doctor.test.ts` + `doctor-routed-next-freeze.test.ts`, `pi-compat.test.ts`, `public-prior-cli.test.ts`. No untested command found. skipContract honesty is recorded — not touched. One cosmetic USAGE nit declined below (§4).
4. **Disaster recovery.** Mapped the 11 crash-probe cases against production crash windows. Windows *not* in the probe that exist in production code: the migrate-legacy `copyFile` window (R16-4, proven) and the eval-report raw write (R16-3 — a unit seam test suffices once atomic; no probe case owed). No others: every remaining writer is atomic-publish or append-with-tail-recovery, both already probed generically (`atomic-write-stale-unique-temp`, `jsonl-truncated-tail`). Supervised/flowchart/parent-plane crash terminals: landed R5-2/R7-4/R8-7; parent-plane WAITING_FOR_USER→RUN_FAILED and unguarded RUN_CANCEL_REQUESTED are recorded decisions — not candidates. Corrupt-middle fail-closed verified on every reader that rewrites or feeds state (event store, both episode stores, feedback raw read, invocation rewriter read); calibration's reader deliberately skips bad rows (documented posture, telemetry not evidence).
5. **Load-bearing test holes.** The one found: `EpisodeEventStore.append` is the only appender in the tree that does not validate before writing to a fail-closed-on-read, append-only, rewrite-frozen log — its siblings `EventStore.append` (`validateEvent`) and `EpisodeStore.append` (`validateEpisode`) both do. No test pins the asymmetry in either direction. Proven to permanently brick `readAll` (candidate R16-2). Checked and clean: `atomic-file` fallback codes tested (`atomic-file.test.ts` covers EPERM/EEXIST seams), lock contention/timeout/foreign-owner release tested, preference snapshot fail-closed tested, doctor JSON frozen contract tested.
6. **Dead / unused production code.** Full zero-importer census over 215 `src/**` files against `src/**`, `test/**`, and `scripts/**` importers (static + dynamic + `tsImport`): exactly three files have zero importers — `src/domain/index.ts`, `src/pi-adapter/index.ts`, `src/tracking/index.ts`. All three are re-export barrels the R6-9 exported-unused census explicitly classified as **evidence class B, barrel seams** (embedder surface, kept), and `tracking/index.js` is additionally named in `criteria-are-guidance.test.ts`'s behaviour-module list. Pinned, not dead. No candidate.

## 2. Proven holes (all proofs ran real repo code, out-of-tree, then were deleted)

### R16-1 (P1) — `preferences.json` cross-process lost-update: a reported `pref delete` is silently revertible

`bindPreferenceStore` (`main.ts:1640`) loads the whole snapshot at command start; every mutation persists the whole in-memory state (`store.ts` `saveToDisk`); **no lock exists** (`adaptation/preferences.json.lock` appears nowhere). Two processes in the bind→write window are last-writer-wins.

Proof (deterministic, two child processes driving the real store over one snapshot in exactly the CLI's order — bind, then mutate):

1. Seeded one explicit observation X through the real store.
2. Child A (= `pref delete --id X`): bound, then deleted. On-disk after A: X gone, `tombstones: [X]`. A's CLI shape prints `tombstoned preference X` and exits 0 here.
3. Child B (= `pref correct …`, bound before A's write): recorded a new observation. B's full-snapshot persist wrote its stale state back.
4. Final on-disk: `resurrectedDeletedObservation: true, tombstoneSurvived: false`. **The reported privacy delete was silently reverted** — observation restored, tombstone gone. The reverse shape (a `correct` lost under a later `delete` write) follows from the same window.

Why P1: `pref delete` is a privacy command whose printed success can become false on disk with no error anywhere — the exact "reported success must be true" class Rounds 2–5 closed on `delete --run`/`--episode` (`RunRecordsSurvivedError`, cascade-under-lock). And it is the last writer of its kind: auth (`auth.json.lock`), bandit (`bandit.json.lock`), feedback, invocations are all already locked. Doctor's lock inventory recursively walks the state root for `*.lock`, so a new preferences lock is inventoried with **zero doctor changes**.

Bounds, honestly stated: writers are only the two one-shot CLI subcommands (`pref correct`, `pref delete` — `recordInferredPreference` has zero production callers; `pref list`/`export` are read-only), so the window needs two overlapping pref commands on one state root. Rare, but scripted use makes it real, and the failure is silent in both directions.

### R16-2 (P2) — `EpisodeEventStore.append` writes unvalidated rows into a log its own reader refuses forever

Proof: appended a malformed row (`type: "EPISODE_REOPENED"`) through the real `EpisodeEventStore.append` — it landed in the log (no validation; TS types are erased at runtime, and the class is an exported embedder surface). Every subsequent `readAll` throws `Invalid episode event at line 2 … Unknown EpisodeEvent.type: EPISODE_REOPENED` — including `episode events`. The log is append-only and **rewriting append-only logs is frozen**, so there is no in-band recovery: one bad append bricks the episode's event history permanently. `EventStore.append` and `EpisodeStore.append` both validate before writing; this is the one asymmetric appender. Fix is a mirror: `validateEpisodeEvent(event)` before `appendJsonlLine`, plus a destructive test (malformed append rejects, log bytes unchanged, `readAll` stays green).

### R16-3 (P2) — `eval-routing.ts:207` is the last raw truncating `writeFile` of a persisted, read-back artifact

`adapt eval` writes `adaptation/evals/<candidateId>.<cacheKey>.json` with plain `writeFile`. A crash mid-write leaves a truncated report; a same-cacheKey re-run truncate-rewrites the same path in place, opening a torn-read window against a concurrent `adapt promote --eval` read of that file. Verified fail-closed by inspection at the consumer (`adapt.ts:283-291`: `JSON.parse` failure → `DomainValidationError "invalid eval report JSON"`; `parseRoutingEvalReport` validates shape) — **no laundering is possible**, and the record class already records recovery ("report is reproducible from the frozen dataset + registry via the cacheKey"). This is therefore atomicity hygiene, not an honesty hole: the one writer left below the codebase's own publish standard (R5-4 already moved providers/credentials/adaptation-registry to `writeFileAtomic`). One-line swap + seam test.

### R16-4 (P3, conditional) — a crashed `migrate-legacy --apply` leaves a conflict the tool can never resolve

Proof: simulated a crash mid-`copyFile` (partial destination bytes). Every re-run classifies the file as `conflict: … (destination differs; not overwritten)`; `--apply` exits 1 with `next: compare the reported destinations by hand`. Fail-closed and source-preserving (correct), but the tool cannot distinguish its own crashed copy from genuine divergence and can never complete without hand repair — a self-heal gap in a disaster-recovery tool, and a production crash window not in the probe. Fix shape (a): publish each copy atomically with never-overwrite semantics — copy to a unique temp in the destination directory, fsync, `link(temp, destination)` (fails EEXIST, preserving the never-overwrite contract), unlink temp; a crashed apply then leaves only an ignorable temp and the re-run completes. Fix shape (b), message-only (name "an interrupted --apply" as a possible conflict cause), is below the quality bar alone. Recommend (a) or an explicit parent decline.

## 3. Swept and clean — no candidate, with the reason each apparent hole is closed

| Surface | Finding |
|---|---|
| Invocation log delete-vs-appender | Closed since Loop 2 R1/R4: both writers under `invocations.jsonl.lock`; sink retry + disclosed drop wired in `run` and `resume`; rewriter read fails closed on corrupt middle; truncated tail dropped by rewrite (documented privacy-safe direction) |
| Feedback log cascade | Read-filter-write-tombstone under one lock; strip-before-tombstone crash ordering privacy-safe; probed (cases 5–6) |
| `delete --run` / `--episode` | Lock + verify-twice + `RUN_RECORDS_SURVIVED`; episode two-lock order disclosed; residual text disclosed; probed (case 4) |
| `EventStore.append` / `CheckpointStore.write` unlocked | Frozen measured decision (+22.5% / +17.5% e2e); the delete cannot lie regardless — not reopened |
| pause vs delete | `requestPause` under `runLockPath`; `clearPause` unlink-only, cannot recreate the subtree (reasoned in-source) |
| track-questions write | `writeFileAtomic` under the lifecycle lock (reasoned in-source, R5/R10 landings) |
| Credential store | RMW under `auth.json.lock`, atomic publish, 0600 chmod — already at standard |
| Bandit store | RMW under `bandit.json.lock`, atomic publish, damaged file rejects before anything is written; doctor-only read is the recorded live-isolation exception (re-verified: `loadProjectBanditByKey` in `bandit-store.ts` + `doctor.ts` only) |
| catalog-observed | Atomic write, typed corrupt error; **no production writer exists** (R7-10 recorded: no CLI producer), so the delete-vs-rebuild resurrection race is unreachable today. Standing note for the future: a producer that lands must read invocations under (or re-check against) the invocation-log lock, or a rebuild started before a `delete --run` rewrite can re-publish the deleted run's rows into the aggregate after the delete invalidated it |
| Doctor | Read-only inventories, never steals; transient write-probe harmless; `--json` contract frozen + tested; lock inventory auto-discovers any `*.lock` under the state root |
| jsonl / atomic-file / file-lock primitives | Tail recovery, corrupt-middle fail-closed, "wx" no-adopt temps, fallback codes, owner-token release — all tested; probed (cases 1–3, 9) |
| migrate-legacy read path | Fail-closed corrupt middle, warned truncated tail, digest-checked EEXIST race (write path → R16-4) |
| CLI test census | Every USAGE command has an integration test (list in §1.3); skipContract honesty recorded — untouched |
| Dead code | 3 zero-importer files, all barrels pinned as embedder seams by the R6-9 census (class B); 0 other zero-importer files in 215 |
| mailbox/cluster, lock stealing, resume-time adoption, `maxCostUsd`, non-terminal `RUN_CRASHED`, jsonl/lock perf | Frozen per dispatch — not swept for candidates |

## 4. Declined as below the bar

- `pause`/`inject` USAGE lines print `[--state-root]` without `<dir>` (`main.ts:259-261`) while every other line has `<dir>` — cosmetic; fold into a future docs pass only if one is owed for other reasons. Not a slot.
- A crash-probe case for the eval-report window — once R16-3 makes the write atomic, the generic `atomic-write-stale-unique-temp` case already covers it; a probe case would duplicate coverage.
- Re-proving any Round 1–15 pin (isolation, `applyRetry`, `TERMINAL_REPLAY_STATUSES`, never-synthesize, `INSPECT_SUMMARY`, routes, eight-member `RunStatus`, `RUN_UNBLOCKED*` keys, census notes): all held structurally — the code diff since the last review is empty.

## 5. Verdict

Four real candidates: **1 × P1, 2 × P2, 1 × P3-conditional**, mutually exclusive file ownership, each with a deterministic destructive proof already demonstrated by this audit. Ranked slots, ownership, and required sign-offs are in `.agent_workspace/ROUND16-BRIEF.md`. This is not padding — the count is what the sweep produced; the rest of the plane inventory is recorded clean above with reasons.

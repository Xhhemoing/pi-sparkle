[Model: claude-fable-5]

# ROUND 16 BRIEF — injection context for Loop 4 · Round 16 dispatch

Provenance: written by the Round 16 plane-retarget auditor (claude-fable-5) at HEAD `acb3ce9`; full sweep evidence and proof transcripts in `.agent_workspace/loop4-r16-audit.md`. Round 16 is the protocol-mandated retarget (module gain <2% for 2 rounds → I/O, races, protocol, disaster recovery). ROUND15-BRIEF §4's four dispatch conditions are satisfied by condition 2: **behavioural gaps surfaced by an evidence-based sweep of the new planes, each with a deterministic proof** — not manufactured work on the terminated surface. **Stay on `agent/opt-continuous`.**

## 1. What landed last (context, all committed)

| Slot | Landed | Key facts (do not re-implement) |
|---|---|---|
| R15-1 (`5d7c0d6`) | Census-note treadmill terminated; the three runtime surfaces are current at HEAD and carry the terminator sentence (a new census note is owed only when a landing changes what they describe) | `docs/status-matrix.md`, `docs/specs/m0-m2-architecture.md`, `docs/data-dictionary.md` |
| Parent | Gate GREEN recorded at `6d625d1`; Rounds 16 opening commits (`b4f5283`, `b052c67`, `acb3ce9`) are `.agent_workspace/**` only — the gate stands for HEAD's code | — |

Round 16 itself has dispatched nothing yet; this brief is the dispatch input.

## 2. Current baseline (this VM, Node v22.14.0, engine warning only)

- Parent `pnpm gate` GREEN at `6d625d1`: **1951 / 1950 pass / 0 fail / 1 skipped** (111 suites; the skip is `PI_SMOKE=1`). `git diff 6d625d1..HEAD` is bookkeeping-only, so those numbers are the code baseline at HEAD. Auditor did not re-run the full gate (dispatch said optional); every claimed hole instead carries its own targeted proof, run out-of-tree and deleted.
- `node scripts/crash-probe.mjs --iterations 1` re-run by the auditor at HEAD: `ok: true`, **11 cases**, names and order unchanged.
- No perf claims this round; nothing here is a perf candidate. Any future perf claim still owes same-VM before/after with an unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 16 (unchanged, plus dispatch scoping)

Global forbidden list, unchanged from ROUND15-BRIEF §3: live R1/bandit/topology on the execution path (doctor's `loadProjectBanditByKey` inventory read stays the only exception — re-verified this audit); Outcome-supported claims; **ADR-006 stays Proposed**; auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence` never read as corroboration; exact eight-member `RunStatus`; no fourth `RUN_UNBLOCKED` key.

Frozen contracts: the whole Rounds 1–15 set carried verbatim from ROUND15-BRIEF §3 — jsonl/atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/doctor/routes/`INSPECT_SUMMARY`/BLOCKED-prefix/episode-boundary/option (a)/discard-audit/probe/verdict-producer freezes; the `taskCriteria` writer as shipped; `onRunStarted` as shipped; the three-path early-id disclosure; the scoped laundering coda; the comparator soundness rule; **the census terminator** (note: R16-1 below, if landed, changes what the data dictionary's lock inventory describes — its census note therefore ships **inside R16-1's own diff**, which is exactly what the terminator prescribes, not a treadmill reopen).

Dispatch scoping for this round's planes, from the dispatch instructions and re-confirmed by the sweep: `EventStore.append`/`CheckpointStore.write` stay unlocked (frozen measured decision); parent-plane WAITING_FOR_USER crash → `RUN_FAILED` and unguarded `RUN_CANCEL_REQUESTED` are recorded decisions; jsonl/lock **perf** frozen; mailbox/cluster, lock stealing, resume-time adoption, `maxCostUsd`, non-terminal `RUN_CRASHED`, rewriting append-only logs, skipContract honesty: all off the table. The audit's §3 table lists every surface swept clean with the reason — none of those is a slot.

Process requirements per slot (carried forward): census first against the working tree; verify handed paths exist before writing; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; census your consumers and ship or prescribe their updates in your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files at report time; mutations out-of-tree, then deleted. Parent: source-truth commits before docs-truth commits; landing commits free of PROGRESS ticks.

## 4. Round 16 candidates (ranked, mutually exclusive ownership — 4 real, do not pad to 10)

Every candidate below was **proven at HEAD with a deterministic out-of-tree probe running the real code** (transcripts in the audit). Every landing owes destructive/defensive tests in its own diff.

### R16-1 (P1) — lock the preference store's cross-process read-modify-write; a reported `pref delete` must stay true on disk

- **Proven defect:** `pref` mutators load the whole snapshot at `bindPreferenceStore` and persist the whole in-memory state on mutation, with no lock. Two-process proof: `pref delete` printed success and persisted the tombstone; a concurrent `pref correct` (bound before the delete's write) then persisted its stale snapshot — **deleted observation resurrected, tombstone gone, no error anywhere**. The reverse (lost correct) follows from the same window. This is the last unlocked cross-process RMW writer in the tree: auth (`auth.json.lock`), bandit (`bandit.json.lock`), feedback and invocation logs are all already locked.
- **Fix shape (recommended):** cooperative lock `adaptation/preferences.json.lock` via `withExclusiveFileLock`, held across **bind (load) + mutate + persist** in the two mutating CLI subcommands (`prefCorrect`, `prefDelete` in `main.ts`) — binding *inside* the lock so the written snapshot derives from fresh bytes. Readers (`pref list`/`export`, doctor's `readPreferenceSnapshot`) stay lock-free — project posture, publish-by-rename. Store docstring pins that the synchronous store API alone is in-process-only and any new writer must take the lock. Bounded acquisition fails closed with the typed `LOCK_TIMEOUT` and an honest CLI message (mirror `delete --lock-wait-ms` posture; no steal). Doctor needs **zero changes** — its lock inventory recursively discovers any `*.lock` under the state root (verified).
- **Tests:** deterministic interleaving via a lock-holder (second mutator waits, or times out typed with nothing written); tombstone-persistence (delete followed by a corrected-under-lock write cannot revert the tombstone); lock-release leaves no `.lock` behind; existing `deletion.test.ts` byte-identical pin unaffected (episode delete still never touches preferences).
- **Consumer census owed in-diff:** `docs/data-dictionary.md` lock inventory + preference row gain the new lock (this is the landing-triggered census note the terminator allows and requires).
- **Ownership (exclusive):** `src/cli/main.ts` (pref subcommand region only), `src/preferences/store.ts` (+ a lock-path helper if placed there), new `test/unit/preferences/` test file, `test/integration/m4/preferences-cli.test.ts`, `docs/data-dictionary.md`.
- **Parent sign-off needed:** YES/NO on lock placement at the CLI layer (recommended) versus inside the store; no schema, no new status, no `RunStatus` contact.

### R16-2 (P2) — `EpisodeEventStore.append` validates before writing (mirror its two siblings)

- **Proven defect:** the one appender in the tree without write-side validation. A malformed row appended through the real store lands in the log; every later `readAll` throws (`Unknown EpisodeEvent.type` at its line) — `episode events` bricks for that id, permanently, because the log is append-only and rewrites are frozen. `EventStore.append` (`validateEvent`) and `EpisodeStore.append` (`validateEpisode`) both already validate; runtime callers are typed but types erase, and the class is an exported embedder surface.
- **Fix:** `validateEpisodeEvent(event)` in `append` before `appendJsonlLine`, wrapped with the same line-context style the reader uses is NOT needed on the write side — a plain rejection suffices (there is no line yet).
- **Tests:** destructive — malformed append rejects with `DomainValidationError`, **log bytes unchanged**, subsequent valid append + `readAll` stay green; keep every existing read-side test untouched.
- **Ownership (exclusive):** `src/episode/store.ts`, `test/unit/episode/store.test.ts`.
- **Parent sign-off:** none needed (defense-in-depth mirroring existing in-tree standard).

### R16-3 (P2) — publish the routing-eval report through `writeFileAtomic`

- **Proven gap:** `src/adaptation/eval-routing.ts:207` is the last raw truncating `writeFile` of a persisted, read-back artifact (`adaptation/evals/<candidateId>.<cacheKey>.json`). Crash mid-write leaves a truncated report; a same-cacheKey re-run truncate-rewrites in place, a torn-read window against a concurrent `adapt promote --eval` read. Verified fail-closed at the consumer (`adapt.ts:283-291` → `DomainValidationError`; `parseRoutingEvalReport` validates shape) and the record class records recovery ("reproducible via the cacheKey") — so this is **atomicity hygiene to the codebase's own standard** (R5-4 precedent), not an honesty hole. Severity honest: no laundering is possible.
- **Fix:** swap to `writeFileAtomic` (one line + import). **Tests:** rename-seam test proving the destination holds either the previous complete report or the new one, never a splice; torn-bytes-fail-closed already covered at the consumer — do not duplicate it.
- **Ownership (exclusive):** `src/adaptation/eval-routing.ts`, `test/unit/adaptation/eval-routing.test.ts`.
- **Parent sign-off:** none needed. No crash-probe case owed — the generic `atomic-write-stale-unique-temp` case covers the primitive once this writer uses it.

### R16-4 (P3, conditional — dispatch only with the sign-off below) — make a crashed `migrate-legacy --apply` re-runnable

- **Proven gap:** a crash mid-`copyFile` leaves a partial destination that every re-run classifies as `conflict (destination differs; not overwritten)`; `--apply` exits 1 forever with "compare the reported destinations by hand". Fail-closed and source-preserving (correct posture), but the disaster-recovery tool cannot distinguish its own crashed copy from genuine divergence and can never self-heal. This is a production crash window not in the 11-case probe.
- **Fix shape (a), recommended:** atomic never-overwrite publish per file — copy source bytes to a unique temp in the destination directory, fsync, `link(temp, destination)` (EEXIST preserves the never-overwrite contract exactly), unlink temp; on EEXIST fall back to the existing digest comparison (benign race already handled). A crashed apply then leaves only an ignorable/cleanable temp and the re-run completes. Fix shape (b) — message-only, naming an interrupted `--apply` as a possible conflict cause — is below the quality bar alone; do it only inside (a).
- **Tests:** crash-seam destructive test (kill/throw between temp write and link → destination absent or previous, re-run copies cleanly); conflict semantics for genuinely divergent destinations unchanged; truncated-tail warning unchanged. Optionally a 12th crash-probe case — if taken, `scripts/crash-probe.mjs` belongs to this slot exclusively and the case goes **after** `unblock-discard-append-before-checkpoint-sigkill` (the frozen order pins the first eleven).
- **Ownership (exclusive):** `src/cli/migrate-legacy.ts`, `test/unit/cli/migrate-legacy.test.ts`, `test/integration/cli/migrate-legacy.test.ts`, optionally `scripts/crash-probe.mjs`.
- **Parent sign-off needed:** YES/NO on fix shape (a); an explicit decline (recording the crashed-apply conflict as an accepted operator-remediation cost) is a valid outcome — then dispatch nothing here.

### Dispatch cross-check

No file appears in two slots (`main.ts` only in R16-1; the four `src` files are disjoint; test files are disjoint; `docs/data-dictionary.md` only in R16-1; `scripts/crash-probe.mjs` only in optional R16-4). Every named path exists at HEAD except the new `test/unit/preferences/` file, which R16-1 creates (the directory exists). **Do not manufacture six more slots** — the audit's §3 table records fourteen surfaces swept clean with reasons; re-dispatching any of them is padding.

## 5. Explicitly NOT for Round 16 (unchanged or newly settled)

Everything in ROUND15-BRIEF §5, verbatim — live R1/bandit/topology; reading `independentEvidence` as corroboration; any new `RunStatus`; a fourth `RUN_UNBLOCKED` key; re-litigating or re-pinning any part of the `taskCriteria` surface; overloading `onRunStarted`; per-path liveness/pause proofs; a third `Run <id>: <word>` line; synthesizing `contract`/`taskCriteria`; re-litigating option (a), the discard audit, the unblock fail-closed default, the gate-ledger posture, or set-before-sums; protocol-layer criterion correlation; per-criterion `UNOBSERVED`; manufactured pauses; jsonl/lock perf; mailbox/cluster work; lock stealing; resume-time adoption; `maxCostUsd` enforcement; non-terminal `RUN_CRASHED`; rewriting append-only logs; ADR-006 status changes; P0 sign-off; dependency bumps; in-tree mutation testing; editing the `replay.ts` docstring; bare-`createScanner` comment-only proofs; freeze-extra re-censuses; census notes on the runtime surfaces absent a landing that changes them (R16-1's in-diff dictionary update is the landing-triggered kind, not a treadmill note) — **plus, new this round:**

- Re-locking `EventStore.append` / `CheckpointStore.write` under the run lock in any Round 16 slot (frozen measured decision; R16-1's lock is a different file and a different plane).
- A catalog-observed producer or its locking (no producer exists — recorded R7-10 posture; the audit's standing note binds whoever lands one someday, not this round).
- Deleting or "cleaning up" the three zero-importer barrels (`domain/index.ts`, `pi-adapter/index.ts`, `tracking/index.ts`) — pinned embedder seams per the R6-9 census.
- The `pause`/`inject` USAGE `[--state-root]` cosmetic nit as a standalone slot.
- A crash-probe case for the eval-report writer (redundant once R16-3 lands).
- "Fixing" the calibration reader's skip-bad-rows posture (documented: telemetry is not evidence; the rewriter's fail-closed read is the guarded one).

[Model: claude-fable-5]

# ROUND 17 BRIEF — injection context for Loop 4 · Round 17 dispatch

Provenance: written by the Round 16 SOTA reviewer (claude-fable-5) at HEAD `5ed437a`; full verification evidence and proof transcripts in `.agent_workspace/loop4-r16-review.md`. Round 16 landed all four retarget-plane slots (3 ACCEPT, 1 ACCEPT-WITH-NITS, 0 ROLLBACK). Round 17 continues the retarget plane (I/O, races, protocol, disaster recovery) with exactly **two** proven candidates — both carry deterministic proofs run against real repo code at this HEAD. **Do not pad past these two. Stay on `agent/opt-continuous`.**

## 1. What landed in Round 16 (context, all committed — do not re-implement)

| Slot | SHA | Landed |
|---|---|---|
| R16-3 | `9c58b90` | `evalRoutingPolicy` publishes `adaptation/evals/<candidateId>.<cacheKey>.json` via `writeFileAtomic` (pre-existing `AtomicWriteOptions` seams passed through); rename-seam test pins never-a-splice |
| R16-2 | `ee24d86` | `EpisodeEventStore.append` validates with `validateEpisodeEvent` (same decoder as `readAll`) before `appendJsonlLine` and appends the decoder's output; four destructive tests pin rejection with byte-identical log |
| R16-4 | `92ffd15` | `migrate-legacy --apply` publishes each copy as unique dest-dir temp (`COPYFILE_EXCL`) → fsync → `link(temp, destination)`; EEXIST → the pre-existing digest branch; fallback on `EPERM`/`EOPNOTSUPP`/`ENOTSUP`/`ENOSYS` is `copyFile(temp, dest, COPYFILE_EXCL)` (never a rename over a destination); crashed apply re-runs cleanly (real-SIGKILL integration test) |
| R16-1 | `16691b3` | `pref correct`/`pref delete` hold `adaptation/preferences.json.lock` (existing `withExclusiveFileLock`) across **bind + mutate + persist**, bind inside the lock; `--lock-wait-ms` reuses the existing parser; timeout = frozen `LOCK_TIMEOUT` → existing doctor `locks[]` route (no new route); readers (`pref list`/`export`, doctor) lock-free; doctor needed zero changes (proven by a real `doctor --json` test); `docs/data-dictionary.md` census note is the landing-triggered kind the Round 15 terminator prescribes |

Orchestrator-only: `b4f5283`, `b052c67`, `acb3ce9`, `67f0391`, `9e59e43`, `5ed437a` (all `.agent_workspace/**`). Reviewer wrote `.agent_workspace/loop4-r16-review.md` and this brief; nothing else.

## 2. Current baseline (independent, this VM, Node v22.14.0, engine warning only)

- Reviewer's own `pnpm gate` at HEAD `5ed437a`: **GREEN, exit 0 — 1977 tests / 1976 pass / 0 fail / 1 skipped** (112 suites; the skip is `PI_SMOKE`, exactly one `# SKIP` line). Matches the parent's record. Delta vs Round 15: +26 tests / +1 suite, fully decomposed (R16-1 +11 incl. the new `test/unit/preferences/snapshot-lock.test.ts` suite, R16-4 +10, R16-2 +4, R16-3 +1).
- Reviewer's own `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, names and order verified one-by-one, `unblock-discard-append-before-checkpoint-sigkill` last. The parent's decline of a 12th case stands; `scripts/crash-probe.mjs` is diff-empty across the round.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 17 (Rounds 1–16 carried verbatim, plus new)

Global forbidden list, unchanged from ROUND16-BRIEF §3: live R1/bandit/topology on the execution path (doctor's `loadProjectBanditByKey` inventory read stays the only exception — re-verified this review); Outcome-supported claims; **ADR-006 stays Proposed**; auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence` never read as corroboration; exact eight-member `RunStatus`; no fourth `RUN_UNBLOCKED` key.

Frozen contracts: the whole Rounds 1–15 set carried verbatim from ROUND16-BRIEF §3 — jsonl/atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/doctor/routes (five `DOCTOR_ROUTED_NEXT` + `GENERIC_FAILURE_NEXT`, character-exact)/`INSPECT_SUMMARY`/BLOCKED-prefix/episode-boundary/option (a)/discard-audit/probe (11 cases, order pinned)/verdict-producer freezes; the `taskCriteria` writer as shipped; `onRunStarted` as shipped on all three public run paths; the three-path early-id disclosure; the scoped laundering coda (`replay.ts:95-101`); the comparator soundness rule; the census terminator (a census note is owed only when a landing changes what the runtime surfaces describe — R16-1's in-diff dictionary note paid the Round 16 instance; **the treadmill stays closed**). `EventStore.append`/`CheckpointStore.write` stay unlocked (frozen measured decision); rewriting append-only logs stays out of contract (R16-2 is write-side rejection, not a rewrite); mailbox/cluster, lock stealing, resume-time adoption, `maxCostUsd`, non-terminal `RUN_CRASHED`, jsonl/lock perf, skipContract honesty: all off the table.

**New, settled by Round 16 (now frozen):**
- The preferences writer contract: any writer of `adaptation/preferences.json` holds `preferenceSnapshotLockPath` across bind + mutate + persist, **binding inside the lock**; the synchronous store API alone is in-process-only; readers stay lock-free (publish-by-rename). No lock inside `saveToDisk`.
- `EpisodeEventStore.append` validates before writing and appends the decoder's output; all three appenders now share the standard.
- The eval report publishes atomically; no probe case for it (generic `atomic-write-stale-unique-temp` covers the primitive — recorded decline).
- The migrate-legacy publish protocol (dest-dir unique temp + fsync + `link`, EEXIST → digest, `COPYFILE_EXCL` fallback) is the **one** allowed publish shape outside `persist/atomic-file.ts`. Do not generalize it into a third helper; do not add a probe case for it (declined — real-SIGKILL integration test covers it).
- The corrected record: `recordInferredPreference` has exactly **one** production caller (`from-episode.ts:161`, reachable from `adapt learn`), persistence-dead because `adaptCommand` never binds the store. Do not re-cite "zero production callers".

Process requirements per slot (carried forward): census first against the working tree; verify handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; consumer census in your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files at report time (including `/tmp` state roots from proofs — R16-4 left one); mutations out-of-tree (full copy, `node_modules` symlinked), then deleted; landing commits are slot files + report only, no PROGRESS ticks.

## 4. Round 17 candidates (2 real — both proven at HEAD; do not pad to 10)

### R17-1 (P3, conditional — needs parent sign-off on direction) — the `adapt learn` inferred preference is recorded and silently discarded

- **Proven behaviour (transcript in `loop4-r16-review.md` §5):** `adapt learn --run` reaches `proposeRoutingFromOutcomes`, which — whenever the run's events carry an episode id — calls `recordInferredPreference("project", projectId, "primary-model", primaryModelId, episodeId)` (`from-episode.ts:160-168`). `adaptCommand` never binds the preference store (zero `bindPreferenceStore`/`configurePreferencePersistence` matches in `adapt.ts`; `main.ts:2141` dispatches directly), so `saveToDisk` no-ops: the reviewer's deterministic out-of-tree run of the real function shows the routing candidate durably written (`adaptation/registry.json`) while the in-memory inferred observation (weight 0.5) vanishes at process exit — `preferencesJsonOnDisk: false`, no error, no disclosure. Since the CLI is one process per command, inferred preferences can never accumulate the `MIN_INFERRED_RECURRENCE_DEFAULT` recurrence the view layer requires — the entire inferred-preference plane is dead from the CLI, silently.
- **Parent decision required — two honest directions:**
  - **(a) persist:** bind and record under `preferenceSnapshotLockPath` per the R16-1 writer contract (bind inside the lock, whole span covered). Placement note: `recordInferredPreference` currently fires *after* `withAdaptationRegistryLock` completes inside `proposeRoutingFromOutcomes`, so no lock nesting is required — but the clean shape is to surface the inferred observation to the CLI layer (return it, or move the call) and take the snapshot lock there, mirroring R16-1's CLI-layer placement rather than pushing a lock into the learning module. This makes `adapt learn` a third snapshot writer; its tests owe the same fail-closed lock-timeout and forced-interleaving pins R16-1 shipped.
  - **(b) remove:** delete the `recordInferredPreference` call (and the `episodeId` plumb if then unused) as an explicit recorded decision that the CLI's inferred-preference plane is not live; the store's inferred machinery stays for embedders. Smaller diff, honest about current behaviour.
- **Not acceptable:** binding without the lock (recreates the R16-1 defect on a third writer); persisting silently without tests; leaving the call as-is now that the drop is proven and on the record.
- **Ownership (exclusive):** `src/cli/adapt.ts`, `src/learning/from-episode.ts`, `test/unit/learning/from-episode.test.ts`, `test/unit/cli/adapt.test.ts`. Direction (a) additionally owes an integration test proving durability across processes (`adapt learn` then fresh-process `pref list` shows the inferred observation) — coordinate ownership if it must live in an existing integration file another slot owns (none does at HEAD).
- **Tests owed:** direction (a): persistence-across-processes, lock fail-closed typed with nothing written, forced interleaving against a held lock, and the existing candidate-dedup tests untouched. Direction (b): a pin that `proposeRoutingFromOutcomes` leaves the preference store untouched (in-memory too), plus removal of the dead plumb.
- **Parent sign-off needed: YES** — (a) vs (b) is a product-behaviour decision (does the developer-preview CLI learn inferred preferences durably, or not yet). Either is a valid outcome; an explicit decline of both (recording the drop as accepted preview behaviour, in-source) is also valid — then dispatch only R17-2.
- **Parent sign-off (2026-08-25): R17-1 YES — direction (b) remove.** README/USAGE advertise `adapt learn` as proposing a routing-policy candidate only. The call is an undisclosed, persistence-dead side-effect; persisting it would add a third snapshot writer and a durable behaviour the CLI never prints. Delete the call (and the `episodeId` plumb if then unused). Record in-source that the CLI inferred-preference plane is not live. Store inferred machinery stays for embedders. Do not bind, do not lock, do not persist.

### R17-2 (P3, test-only) — pin the migrate-legacy fallback's never-overwrite arm

- **Proven gap (mutation transcript in `loop4-r16-review.md` §4.4):** mutating the fallback `copyFile(temp, destination, COPYFILE_EXCL)` to a clobbering `copyFile(temp, destination)` leaves **all 23 owned tests green**. The sole fallback test injects `link` → EPERM with an *absent* destination, so the documented "never-overwrite still holds there" contract arm has no regression net; a future regression would silently overwrite a divergent destination on link-less filesystems and report `copied`. The shipped `src` is correct — this is a test hole, not a defect.
- **Fix:** one unit test combining the existing seams: `link` → EPERM injection **plus** a `uniqueSuffix` racer writing divergent bytes to the destination (both helpers already exist in the file); assert exit 1, `could not copy` on stderr, destination bytes untouched, temp cleaned. Must kill the reviewer's mutant.
- **Ownership (exclusive):** `test/unit/cli/migrate-legacy.test.ts` only. Zero `src` changes.
- **Parent sign-off:** none needed.

### Dispatch cross-check

No file appears in two slots (R17-1 owns `adapt.ts`/`from-episode.ts` and their tests; R17-2 owns only `test/unit/cli/migrate-legacy.test.ts`). If the parent declines R17-1 in both directions, Round 17 is a one-slot round (R17-2) — a valid, honest round; do not backfill.

## 5. Explicitly NOT for Round 17

Everything in ROUND16-BRIEF §5, verbatim — live R1/bandit/topology; reading `independentEvidence` as corroboration; any new `RunStatus`; a fourth `RUN_UNBLOCKED` key; the `taskCriteria` surface; overloading `onRunStarted`; per-path liveness/pause proofs; a third `Run <id>: <word>` line; synthesizing `contract`/`taskCriteria`; re-litigating option (a), the discard audit, the unblock fail-closed default, the gate-ledger posture, or set-before-sums; protocol-layer criterion correlation; per-criterion `UNOBSERVED`; manufactured pauses; jsonl/lock perf; mailbox/cluster; lock stealing; resume-time adoption; `maxCostUsd`; non-terminal `RUN_CRASHED`; rewriting append-only logs; ADR-006 status changes; P0 sign-off; dependency bumps; in-tree mutation testing; editing the `replay.ts` docstring; bare-`createScanner` comment-only proofs; freeze-extra re-censuses; census notes absent a landing that changes the surfaces; re-locking `EventStore.append`/`CheckpointStore.write`; a catalog-observed producer or its locking; deleting the three pinned zero-importer barrels; the `pause`/`inject` USAGE `[--state-root]` cosmetic nit as a slot; a crash-probe case for the eval-report writer — **plus, new this round:**

- Re-litigating any Round 16 sign-off: the CLI-layer lock placement (R16-1), fix shape (a) for migrate-legacy (R16-4), and the declined 12th probe case are settled.
- A lock inside the preference store's synchronous API (ruled out by the R16-1 sign-off; the writer contract lives at the caller).
- A `*.tmp` sweeper for crashed `migrate-legacy` applies (recorded R16-4 posture: orphan temps are inert, invisible to every reader, removed with the subtree by `delete --run`, and deleting another process's in-flight temp would be worse; a sweeper is a possible future slot only if usage surfaces real orphan accumulation).
- The `doctor.ts:507` hand-built preferences path (one-line `preferenceSnapshotPath` import swap) as a standalone slot — fold it into whichever future slot next owns `doctor.ts`, per R16-1's prescription.
- `MAX_LOCK_WAIT_MS` docstring wording ("wait out a long run" — slightly narrow, not false). Not a slot.
- Re-proving locked writers already at standard (auth, bandit, feedback, invocations, registry, episodes, runs — all verified locked or append-only across Rounds 1–16 and re-swept this review).

**Valid reasons to dispatch anything beyond §4 later** (carried forward, unchanged): a genuinely new seam lands; a behavioural gap surfaces from real usage; a gate or probe failure; a landing that makes recorded surfaces stale. Manufacturing busywork is forbidden; cosmetic USAGE nits are not slots.

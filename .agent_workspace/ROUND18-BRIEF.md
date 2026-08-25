[Model: claude-fable-5-thinking-xhigh]

# ROUND 18 BRIEF — injection context for Loop 4 · Round 18 dispatch

Provenance: written by the Round 17 SOTA reviewer at HEAD `6b8124d`; full verification evidence and mutation transcripts in `.agent_workspace/loop4-r17-review.md`. Round 17 landed both dispatched slots (2 ACCEPT, 0 nits, 0 ROLLBACK) and closed the last two holes Round 16 proved on the retarget plane (I/O, races, protocol, disaster recovery). **Round 18 carries zero candidates** — §4 records why that is the honest state and the only valid reasons to dispatch later. **Do not manufacture slots. Stay on `agent/opt-continuous`.**

## 1. What landed in Round 17 (context, all committed — do not re-implement)

| Slot | SHA | Landed |
|---|---|---|
| R17-2 | `16a471d` | Test-only: one test in `test/unit/cli/migrate-legacy.test.ts` combining `link` → EPERM with a `uniqueSuffix` racer writing divergent destination bytes, pinning the **fallback arm's** never-overwrite (`copyFile(temp, dest, COPYFILE_EXCL)` must conflict, exit 1, destination untouched, temps cleaned). The Round 16 clobbering-fallback mutant — which survived all 23 tests then — now dies with this test as the sole red (19/20, re-proven by the reviewer out-of-tree). Zero `src`. |
| R17-1 | `223e3dd` | Sign-off (b) executed exactly: `recordInferredPreference` call and import deleted from `src/learning/from-episode.ts`, the whole `episodeId` plumb with it (`LearnFromOutcomesInput.episodeId`, `episodeIdFromEvents` call + import, `EpisodeId` type import). In-source record on `proposeRoutingFromOutcomes`'s docstring: the CLI inferred-preference plane is not live, re-adding the call would not make it live, the embedder API stays, and any host that binds the store owes the R16-1 lock contract. Three pins (two in `from-episode.test.ts` binding the store, one CLI end-to-end in `adapt.test.ts`); two stale `from-episode → episode-bind` allowlist entries dropped from `test/unit/privacy/plane-boundary.test.ts` (outside ownership, disclosed, proven mandatory by M2 — the guard fails closed on stale entries). No bind, no lock, nothing persisted; `src/cli/adapt.ts` and `src/preferences/*` diff-empty. |

Orchestrator-only: `9c7cb3e`, `c3ef49e`, `6b8124d` (all `.agent_workspace/**`; `6b8124d` PROGRESS-only). Reviewer wrote `.agent_workspace/loop4-r17-review.md` and this brief; nothing else.

## 2. Current baseline (independent, this VM, Node v22.14.0, engine warning only)

- Reviewer's own `pnpm gate` at HEAD `6b8124d`: **GREEN, exit 0 — 1981 tests / 1980 pass / 0 fail / 0 cancelled / 1 skipped** (112 suites; the skip is `PI_SMOKE`, exactly one `# SKIP` line). Matches the parent's record. Delta vs Round 16: +4 tests / +0 suites, fully decomposed (R17-1 +3, R17-2 +1).
- Reviewer's own `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, names and order verified one-by-one against the Round 16 record, `unblock-discard-append-before-checkpoint-sigkill` last. No 12th case; `scripts/crash-probe.mjs` diff-empty across the round.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 18 (Rounds 1–17)

Global forbidden list, unchanged from ROUND17-BRIEF §3: live R1/bandit/topology on the execution path (doctor's `loadProjectBanditByKey` inventory read stays the only exception — re-verified this review); Outcome-supported claims; **ADR-006 stays Proposed**; auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence` never read as corroboration; exact eight-member `RunStatus`; no fourth `RUN_UNBLOCKED` key.

Frozen contracts: the whole Rounds 1–16 set carried verbatim from ROUND17-BRIEF §3 — jsonl/atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/doctor/routes (five `DOCTOR_ROUTED_NEXT` + `GENERIC_FAILURE_NEXT`, character-exact)/`INSPECT_SUMMARY`/BLOCKED-prefix/episode-boundary/option (a)/discard-audit/probe (11 cases, order pinned)/verdict-producer freezes; the `taskCriteria` writer as shipped; `onRunStarted` as shipped on all three public run paths; the three-path early-id disclosure; the scoped laundering coda (`replay.ts:95-101`); the comparator soundness rule; the census terminator (a note is owed only when a landing changes what the runtime surfaces describe — Round 17 correctly owed none; **the treadmill stays closed**); `EventStore.append`/`CheckpointStore.write` unlocked (frozen measured decision); the preferences writer contract (bind inside `preferenceSnapshotLockPath`, readers lock-free, no lock in `saveToDisk`); write-side episode-event validation; atomic eval publish; the migrate-legacy publish protocol as the one allowed publish shape outside `persist/atomic-file.ts` (no third helper, no probe case); mailbox/cluster, lock stealing, resume-time adoption, `maxCostUsd`, non-terminal `RUN_CRASHED`, jsonl/lock perf, skipContract honesty, rewriting append-only logs: all off the table.

**New, settled by Round 17 (now frozen):**
- **The CLI inferred-preference plane is not live, and that is now pinned, not just observed.** `adapt learn` writes exactly what it advertises: a routing-policy candidate (`adaptation/registry.json`). It never binds the preference store, takes no snapshot lock, and records no observation, in memory or on disk — pinned by three tests (direct-outcomes, routed-events with a `RUN_ATTACHED`-bearing log, and CLI end-to-end) plus the plane-boundary allowlist. `recordInferredPreference` stays an embedder API; a host that binds the store is a preference-snapshot writer owing `preferenceSnapshotLockPath` across bind+mutate+persist (restated in-source at `from-episode.ts:88-101`). Re-adding the call, or "making the plane live" without a parent product decision, is forbidden.
- **The migrate-legacy fallback never-overwrite is pinned.** Both publish arms (primary `link`, fallback `copyFile` + `COPYFILE_EXCL`) now have regression nets that kill their respective clobbering mutants. The fix shape is closed; do not add more publish-arm tests without a new proven mutant.
- **The `from-episode` runtime ingress is narrower and exact:** the sanctioned derived-signal pipe enters the runtime plane through `run/event-store.ts` alone; the plane-boundary allowlist equals the real import set in both directions (fails closed on stale entries — M2-proven). Do not re-add the `episode-bind` edges.
- The pre-removal record stands corrected in full: `recordInferredPreference` now has **zero** production callers (definition + embedder test + a comment-form mention only). Do not cite the Round 16 "exactly one caller" record against the post-`223e3dd` tree.

Process requirements per slot (carried forward): census first against the working tree; verify handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; consumer census in your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files at report time (including `/tmp` state roots from proofs); mutations out-of-tree (full copy, `node_modules` symlinked), then deleted; landing commits are slot files + report only, no PROGRESS ticks. **New from Round 17:** a dispatch that changes a `src` import edge on the adaptation plane must census `test/unit/privacy/plane-boundary.test.ts` into the ownership grant up front — its allowlist fails closed in both directions, so the consequential edit is mandatory, and it should be granted rather than forced outside ownership.

## 4. Round 18 candidates — ZERO (the honest round)

Round 16 proved exactly two remaining holes on the retarget plane with deterministic runs of real repo code; Round 17 closed both and this review independently re-verified the closures (mutation kills re-proven out-of-tree). The Round 17 reviewer then re-swept for anything new and found nothing dispatchable:

- The range added no `src` behavior (one file, net deletion + docstring), so **no new seam** can have landed.
- Raw-write sweep at HEAD unchanged: only doctor's transient write-probe and the lock owner record outside `persist/atomic-file.ts`.
- The last unlocked read-modify-write writer (preferences) was locked in Round 16; the last unpinned publish arm (migrate-legacy fallback) was pinned in Round 17.
- Probe coverage settled: 11 cases green ×3, a 12th declined twice on the record.
- Every doc surface this round could have staled was read and is accurate (dictionary, README, USAGE); the census treadmill stays closed.

**Do not dispatch Round 18 slots unless one of these becomes true** (the exhaustive valid-reasons list, carried and now the operative gate):

1. **A genuinely new seam lands** — new `src` behavior on the I/O/race/protocol/DR planes (a new writer, a new lock, a new publish path, a new crash window). The landing's reviewer owes the proof it is a hole, not the dispatch.
2. **A behavioural gap surfaces from real usage** — a reproducible defect or surprising behaviour observed running the real CLI, reduced to a deterministic out-of-tree run of real repo code before dispatch.
3. **A gate or probe failure** — any red in `pnpm gate` or `crash-probe.mjs` at a future HEAD, including flakes (a flake is a race candidate with the reproduction owed first).
4. **A landing stale-ifies recorded surfaces** — a commit that changes what the runtime surfaces describe, owing the census-terminator note and any consequential pin updates.

A future round that dispatches must re-prove its candidate's hole at that round's HEAD with a deterministic out-of-tree run — Round 16's transcripts are exhausted (both were spent on Round 17's landings). Cosmetic USAGE nits are not slots. Manufacturing busywork is forbidden; a zero-slot round with a green gate is a valid, recordable round, and the user's 20+-round goal is served by honest zero rounds, not padded ones.

**Ownership / tests owed / parent sign-off: none — no slots are dispatched by this brief.** If a valid reason above fires, the dispatching round writes its own ownership grant (remember the new plane-boundary census rule in §3) and its own tests-owed list, and product-behaviour decisions still need explicit parent sign-off before dispatch, per the R17-1 precedent.

## 5. Explicitly NOT for Round 18

Everything in ROUND17-BRIEF §5, verbatim — live R1/bandit/topology; reading `independentEvidence` as corroboration; any new `RunStatus`; a fourth `RUN_UNBLOCKED` key; the `taskCriteria` surface; overloading `onRunStarted`; per-path liveness/pause proofs; a third `Run <id>: <word>` line; synthesizing `contract`/`taskCriteria`; re-litigating option (a), the discard audit, the unblock fail-closed default, the gate-ledger posture, or set-before-sums; protocol-layer criterion correlation; per-criterion `UNOBSERVED`; manufactured pauses; jsonl/lock perf; mailbox/cluster; lock stealing; resume-time adoption; `maxCostUsd`; non-terminal `RUN_CRASHED`; rewriting append-only logs; ADR-006 status changes; P0 sign-off; dependency bumps; in-tree mutation testing; editing the `replay.ts` docstring; bare-`createScanner` comment-only proofs; freeze-extra re-censuses; census notes absent a landing that changes the surfaces; re-locking `EventStore.append`/`CheckpointStore.write`; a catalog-observed producer or its locking; deleting the three pinned zero-importer barrels; the `pause`/`inject` USAGE `[--state-root]` cosmetic nit as a slot; a crash-probe case for the eval-report writer; re-litigating any Round 16 sign-off; a lock inside the preference store's synchronous API; a `*.tmp` sweeper for crashed applies; `MAX_LOCK_WAIT_MS` docstring wording; re-proving locked writers already at standard — **plus, new this round:**

- **Re-litigating the R17-1 (b) sign-off.** The removal landed exactly as signed off (verified: no bind, no lock, nothing persisted). Making the CLI inferred-preference plane live is a product decision that starts with the parent, not a slot.
- **The `doctor.ts:507` hand-built preferences path** (one-line `preferenceSnapshotPath` import swap) — still folded into whichever future slot next owns `doctor.ts`; not a standalone slot (carried from Round 16, unchanged).
- **`LearnFromOutcomesInput.projectId`** (required member, now unread inside `proposeRoutingFromOutcomes`, still driving the `run has no project snapshot` guard one level up). Kept deliberately — removing it is an unauthorized public-API break and it is not a persistence hook. Fold the slot's own prescription (drop field, simplify guard to `projectRoot === undefined`, update two test call sites) into whichever future slot next owns `from-episode.ts`. Not a slot.
- **The `const result = await withAdaptationRegistryLock(...); return result;` cosmetic** in `from-episode.ts` — collapse it only inside a future slot that owns the file for a real reason. Not a slot.
- **More publish-arm mutation tests for migrate-legacy** — both arms are pinned; a new test needs a new proven surviving mutant first.

**Valid reasons to dispatch anything later**: exactly the four in §4. Nothing else qualifies.

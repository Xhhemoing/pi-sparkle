[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 17 — slot R17-1: remove the persistence-dead inferred-preference recording from `adapt learn`

Direction **(b) remove**, exactly as signed off. The store is not bound, no lock is taken, nothing is persisted; `recordInferredPreference` itself is untouched and stays an embedder API.

## 0. Census (before any edit)

- Branch `agent/opt-continuous`, HEAD `9c7cb3e` (`chore(orchestrator): close Round 16 (3 ACCEPT, 1 nit); open Round 17`). Working tree at slot start: clean except two untracked orchestrator files (`.agent_workspace/ROUND17-BRIEF.md`, `.agent_workspace/loop4-r16-review.md`). Sibling **R17-2** owns `test/unit/cli/migrate-legacy.test.ts` only — **disjoint** from every file below; it had not yet dirtied the tree when this slot started, and nothing here depends on it.
- All four handed paths exist: `src/learning/from-episode.ts`, `src/cli/adapt.ts`, `test/unit/learning/from-episode.test.ts`, `test/unit/cli/adapt.test.ts`.
- Call site confirmed at source, matching the R16 record: `from-episode.ts:160-168`, fired from `proposeRoutingFromOutcomes` after `withAdaptationRegistryLock` returns, reachable only via `adapt.ts:168` → `proposeRoutingFromRoutedEvents`.

**Consumer census (whole tree, `src` + `test`):**

| Symbol | Importers found | Action |
|---|---|---|
| `proposeRoutingFromOutcomes` | exported but imported nowhere outside `from-episode.ts` itself (used by `proposeRoutingFromAssignments` and `proposeRoutingFromRoutedEvents`) | none needed |
| `proposeRoutingFromAssignments` | `test/unit/learning/from-episode.test.ts` (owned) | none needed — no call site passed `episodeId` |
| `proposeRoutingFromRoutedEvents` | `src/cli/adapt.ts:168` (owned) | none needed — its input shape is unchanged |
| `LearnFromOutcomesInput.episodeId` | set in exactly one place, `proposeRoutingFromRoutedEvents`'s own plumb | removed with the field |
| `recordInferredPreference` | `from-episode.ts:161` (removed) and `test/unit/preferences/service-export.test.ts` (the embedder-API test) | embedder test left untouched and green |
| `episodeIdFromEvents` | `cli/main.ts`, `track/loop.ts`, `run/child-tracking.ts`, `run/episode-bind.ts`, two test files — all unrelated to learning | only the `from-episode.ts` import removed |
| `adaptCommand` | `test/integration/cli/commands.test.ts:128` (`adapt promote` only) | censused, **not edited** — the CLI pin lives in the owned unit file, per the slot's preference |
| `auto-loop.ts` (the in-process post-run path where the store *is* bound) | imports nothing from `from-episode.ts` or `preferences/*` | re-confirmed; unaffected |

**One consumer the census surfaced that is outside my ownership** — see §4.

## 1. Files changed

**`src/learning/from-episode.ts`** (owned)
- Deleted the `recordInferredPreference(...)` call and its `../preferences/service.js` import.
- Deleted the now-dead plumb: `episodeId` on `LearnFromOutcomesInput`, the `episodeIdFromEvents(read.events)` call and its `../run/episode-bind.js` import in `proposeRoutingFromRoutedEvents`, and the `EpisodeId` member of the `../domain/ids.js` type import. No field left behind "for later persist".
- Recorded the decision in-source at the former call site, on `proposeRoutingFromOutcomes`'s docstring: the candidate is the only thing this writes; the CLI never binds the store so the observation died at process exit and one-shot commands can never reach `MIN_INFERRED_RECURRENCE_DEFAULT`; **re-adding the call would not make the plane live**; `recordInferredPreference` stays an embedder API, and any host that binds the store is a snapshot writer owing `preferenceSnapshotLockPath` across bind+mutate+persist (the R16-1 contract, restated where a would-be re-adder will read it).

**`src/cli/adapt.ts`** (owned) — **no change.** The removal is entirely inside the learning module; `learnCommand`'s call shape is unchanged, and the in-source record sits at the former call site (the sign-off allows either location). Editing it would have been noise.

**`test/unit/learning/from-episode.test.ts`** (owned) — **+2 tests.**

**`test/unit/cli/adapt.test.ts`** (owned) — **+1 test.**

**`test/unit/privacy/plane-boundary.test.ts`** (**not in my ownership** — see §4) — dropped the two now-stale `from-episode.ts -> episode-bind` allowlist entries.

## 2. Tests added (3)

All three bind or reset the process-global preference store deliberately: an unbound store is exactly what hid this bug, so a pin that leaves it unbound would not see a stray in-memory write. A short comment in the test file says so.

1. **`proposing a candidate from outcomes leaves the preference store untouched`** (`from-episode.test.ts`) — binds the store to the temp state root, drives `proposeRoutingFromAssignments` with a bound `taskSuccess` FAIL / `failureClass: model` outcome, asserts the candidate was created, `listObservations()` is `[]`, and no `adaptation/preferences.json` exists. This is the direct-API pin the sign-off names.
2. **`the routed-events learn path records no inferred preference for an episode-bound run`** (`from-episode.test.ts`) — seeds a real event log through `EventStore.append` (every event validates): `PROJECT_DISCOVERED`, **`RUN_ATTACHED`** (so `episodeIdFromEvents` would resolve an id — the exact former trigger), a complete `MODEL_ROUTED`, and a `TASK_RESULT` FAILURE/`MODEL_ERROR`. Binds the store, runs `proposeRoutingFromRoutedEvents`, asserts `created === true` (proving execution reached the former call site), `listObservations()` is `[]`, and no snapshot file. **This is the mutant killer.**
3. **`adapt learn persists a routing-policy candidate and no preference snapshot`** (`adapt.test.ts`) — the CLI pin: the same episode-bound run driven through `adaptCommand(["learn", ...])`, asserting exit 0, `proposed routing-policy candidate` on stdout, `adaptation/registry.json` present (the advertised durable write survives), `adaptation/preferences.json` absent, and `listObservations()` empty. Cleans up its state root in a `finally` (the file's other tests leak their `mkdtemp` dirs; I did not change theirs).

The existing candidate-dedup tests are untouched in intent and in bytes.

## 3. Mutation (out-of-tree, full copy under `/tmp` with `node_modules` symlinked, both copies deleted)

**M1 — full revert** (`/tmp/r17-1-mut`): restored the `recordInferredPreference` call, the `episodeId` field, the `episodeIdFromEvents` plumb and both imports.

```
not ok 18 - adapt learn persists a routing-policy candidate and no preference snapshot
ok 23 - proposing a candidate from outcomes leaves the preference store untouched
not ok 24 - the routed-events learn path records no inferred preference for an episode-bound run
# pass 22 / # fail 2
```

Killed by the routed-events pin *and* independently by the CLI pin. **Disclosed honestly:** pin #1 (the direct-outcomes case) survives M1, and cannot do otherwise — post-removal the `episodeId` field does not exist, so a test that passes one would not typecheck against the shipped tree. Its job is pinning that the direct API is preference-free, not killing this mutant.

M1 additionally reddens `plane-boundary.test.ts` (2 of 6 tests), a third independent layer.

**M2 — is the allowlist edit load-bearing?** (`/tmp/r17-1-mut2`): shipped `src`, but the two removed allowlist entries put back.

```
not ok 3 - every allowlisted exception still exists and type-only ones stay erased
not ok 4 - adaptation value-import closure enters runtime only through sanctioned readers
# pass 4 / # fail 2
```

So the §4 edit was mandatory, not cosmetic: both entries had to go, and the guard catches a stale allowlist in both directions.

Both `/tmp` copies deleted; no state roots left behind by these runs.

## 4. The one edit outside my ownership — disclosed, not buried

`test/unit/privacy/plane-boundary.test.ts` pins the adaptation→runtime import allowlist and **fails closed on a stale entry** ("allowlisted import no longer exists; drop the exception"), plus asserts the value-import closure's runtime ingress set *exactly* equals the allowlist. Dropping the `episode-bind` import therefore forced two deletions there:

- `ALLOWED`: `learning/from-episode.ts -> ../run/episode-bind.js`
- `ALLOWED_VALUE_RUNTIME_EDGES`: `learning/from-episode.ts -> run/episode-bind.ts`

No other slot owns this file (R17-2 owns only `test/unit/cli/migrate-legacy.test.ts`), and leaving it would have meant committing a red tree, so I shipped it rather than prescribing it. It is a pure allowlist shrink with zero logic change: the sanctioned `from-episode` pipe now crosses into the runtime plane through `run/event-store.ts` alone. The privacy posture strictly improves.

**No `docs/**` edit, and none owed.** I read the surfaces this could stale and none of them changes meaning:
- `docs/data-dictionary.md:25-31` names `from-episode.ts` as the derived-signal pipe and says the exceptions "are pinned in `plane-boundary.test.ts`" — it enumerates none, so it stays accurate.
- `:48` "the only runtime-record reader value-reachable from the adaptation plane is the sanctioned `from-episode` pipe" — still true; the pipe got narrower.
- `:471-484` "Its two writers — `pref correct` and `pref delete`" — still exactly two, and this landing removes a would-be third path rather than adding one.
- `:544` lists `adapt learn` and "preference tooling" as separate explicit commands; it never claimed `adapt learn` writes preferences.
- `README.md:168` advertises `adapt learn` as "Propose a routing-policy candidate from MODEL_ROUTED events" — the shipped behaviour is now exactly that.

Per the frozen census terminator I added **no** dictionary census note: nothing the runtime surfaces describe has changed. (`docs/reports/2026-08-24-sota-loop2-isolation.md` counts the pipe at 9 modules; it is a dated snapshot report, not a live surface, and I did not touch it.)

## 5. Verification (this VM, Node v22.14.0)

- **`npx tsc --noEmit` (whole tree): clean, exit 0.** Tree was clean of sibling work at the time.
- **`npx eslint` on all four touched files: clean, exit 0.**
- `test/unit/learning/from-episode.test.ts`: 6/6 pass. `test/unit/cli/adapt.test.ts`: 18/18 pass. `test/unit/privacy/plane-boundary.test.ts`: 6/6 pass.
- Consumer/neighbour sweep `test/unit/learning/**` + `test/unit/preferences/**` + `test/unit/privacy/**` + `test/unit/cli/adapt.test.ts`: **194 pass / 0 fail**, 6 suites — this includes `service-export.test.ts` (the `recordInferredPreference` embedder test, untouched and green) and `deletion.test.ts` (the byte-identical-preferences pin).
- `test/integration/cli/commands.test.ts` (the `adaptCommand` consumer): 6/6 pass.
- None of the added tests is timing-sensitive: no locks, no interleaving, no sleeps, no spawned processes. The 3× rule does not apply; each was nevertheless run more than once across the mutation cycles with identical results.

## 6. Residuals

1. **`LearnFromOutcomesInput.projectId` is now unused inside `proposeRoutingFromOutcomes`** — it was read *only* by the deleted call (`routingPolicyIdentity` derives its own project id from `projectRoot`'s stable hash, deliberately not from this field). I **kept** it, and I want the reviewer to overrule me if that is wrong. Reasons: it is a *required* member of an exported input type, so removing it is a public-API break the sign-off did not authorize (it named `episodeId`); it is not a persistence hook, which is what "do not leave a dead field for later persist" is about; and it is still live one level up, where `proposeRoutingFromRoutedEvents` reads it from `PROJECT_DISCOVERED` to decide the `run has no project snapshot` refusal. Prescription if the reviewer disagrees: drop the field, simplify that guard to `projectRoot === undefined`, and update the two call sites in `test/unit/learning/from-episode.test.ts` — all inside this slot's ownership, so it is a contained follow-up.
2. **`plane-boundary.test.ts` edited outside ownership** (§4). Shipped rather than prescribed to avoid a red commit point; a pure allowlist shrink, proven necessary by M2.
3. **`src/cli/adapt.ts` is diff-empty.** Ownership was granted, no change was warranted.
4. **`proposeRoutingFromOutcomes` now ends `const result = await withAdaptationRegistryLock(...); return result;`** — a one-use temporary left by the deletion (the `if (input.episodeId ...)` block used to sit between them). Noticed, not tidied: collapsing it to a direct `return` is cosmetic, and the environment (below) stopped me from re-verifying an unnecessary edit. It is eslint- and tsc-clean as it stands.
5. **Environment:** the shell backend on this VM stopped returning exit status partway through a belt-and-braces `test/unit/**` sweep and did not recover across ~20 minutes of retries. Everything listed in §5 completed *before* that and is real; the whole-unit-tree sweep did not. The full gate is the parent's job in any case, and no evidence in this report depends on the lost run. One consequence I could not clean up: that interrupted sweep may have left `mkdtemp` state roots under `/tmp` from other suites' tests. My own additions clean up after themselves, and both mutation copies (`/tmp/r17-1-mut`, `/tmp/r17-1-mut2`) were deleted and verified gone before the shell died.
6. **No scratch files in the tree.** The only file this slot adds under `.agent_workspace/` is this report. `PROGRESS.md` untouched; branch unchanged; nothing committed or pushed.

## 7. Frozen surfaces — unbroken

No preference-snapshot writer added (one non-writer removed); `src/preferences/store.ts` untouched; no lock added anywhere and no `--lock-wait-ms` on `adapt`; five `DOCTOR_ROUTED_NEXT` routes, `INSPECT_SUMMARY`, `onRunStarted`, `taskCriteria`, the eight `RunStatus` members and `EventStore`/`CheckpointStore`'s unlocked posture are all outside this diff; no live R1; ADR-006 untouched; no `package.json`; no crash-probe change; `replay.ts` untouched; no dictionary census note.

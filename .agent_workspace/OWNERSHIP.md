# File ownership — Loop 4 Round 17 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Two real candidates from `.agent_workspace/ROUND17-BRIEF.md`. **Do not pad.** Freeze extras and the terminated census treadmill stay undispatched. Lists are binding. Files are disjoint. Landing commits are slot files + report only — no PROGRESS ticks.

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

Injection: `.agent_workspace/ROUND17-BRIEF.md`, `.agent_workspace/loop4-r16-review.md`.

| Slot | Model | Owns |
|---|---|---|
| R17-1 | opus | `src/learning/from-episode.ts`, `src/cli/adapt.ts`, `test/unit/learning/from-episode.test.ts`, `test/unit/cli/adapt.test.ts`. **Direction (b) remove:** delete the `recordInferredPreference` call (and the `episodeId` plumb if then unused). Pin that `proposeRoutingFromOutcomes` leaves the preference store untouched (in-memory too) and that `adapt learn` does not write `preferences.json`. Record in-source that the CLI inferred-preference plane is not live; store inferred machinery stays for embedders. Do **not** bind the store, take the preference lock, or persist. Do **not** edit `src/preferences/store.ts`. |
| R17-2 | gpt-sol | `test/unit/cli/migrate-legacy.test.ts` **only**. Zero `src` changes. One unit test: inject `link` → EPERM **and** a `uniqueSuffix` racer writing divergent bytes to the destination; assert exit 1, `could not copy` on stderr, destination bytes untouched, temp cleaned. Must kill a clobbering-fallback mutant (`copyFile` without `COPYFILE_EXCL`). Do **not** edit `scripts/crash-probe.mjs`. |

**Parent sign-off**
- **R17-1 YES — (b) remove.** Advertised CLI contract is routing-candidate only. Do not persist inferred preferences from `adapt learn`.
- **R17-2:** no extra sign-off.

Frozen (do not break): ROUND17-BRIEF §3/§5 — preferences writer contract (bind inside lock at the CLI writer; no lock inside `saveToDisk`); `EpisodeEventStore.append` validates; eval report atomic; migrate-legacy dest-dir temp+link protocol (R17-2 pins the fallback arm only); five `DOCTOR_ROUTED_NEXT` character-exact; census terminator closed; exact eight `RunStatus`; EventStore/CheckpointStore stay unlocked; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`; no lock steal; jsonl signatures; `writeFileAtomic`(+Sync); no new private tmp+rename outside `persist/atomic-file.ts`; no 12th crash-probe case.

Every slot: census first; verify paths exist; scoped eslint + whole-tree `tsc --noEmit`; owned tests 3× when timing-sensitive; report `.agent_workspace/loop4-r17-tN.md`. No full gate.

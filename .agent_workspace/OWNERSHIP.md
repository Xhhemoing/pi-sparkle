# File ownership — Loop 4 Round 16 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Four real candidates from `.agent_workspace/ROUND16-BRIEF.md`. **Do not pad.** Freeze extras and the terminated census treadmill stay undispatched. Lists are binding. Files are disjoint. Landing commits are slot files + report only — no PROGRESS ticks.

**Mutations run out-of-tree:** full copy under `/tmp` with `node_modules` symlinked, then deleted.

Injection: `.agent_workspace/ROUND16-BRIEF.md`, `.agent_workspace/loop4-r16-audit.md`. Dispatch: R16-1 `bc-de9f6564-72a2-550b-9c66-97b990097e6c`; R16-2 `bc-09e5e246-1ee3-5def-96c9-c09ba1a4b6dd`; R16-3 `bc-b02498fc-02dc-569f-8cb3-c6e3a27d136f`; R16-4 `bc-21baf251-e902-5849-92e2-16ccab8ac0b2`.

| Slot | Model | Owns |
|---|---|---|
| R16-1 | opus | `src/cli/main.ts` **pref subcommand region only** (`prefCorrect` / `prefDelete` / `bindPreferenceStore` callers — do not edit `runCommand`, routes, `INSPECT_SUMMARY`, or `onRunStarted`); `src/preferences/store.ts` (+ lock-path helper if placed there); new tests under `test/unit/preferences/`; `test/integration/m4/preferences-cli.test.ts`; `docs/data-dictionary.md` (lock inventory + preference row — the terminator-allowed census note). Cooperative lock `adaptation/preferences.json.lock` via `withExclusiveFileLock` held across **bind (load) + mutate + persist**. Readers stay lock-free. Bounded acquisition fails closed with typed `LOCK_TIMEOUT` and an honest CLI message (mirror `delete --lock-wait-ms`; no steal). Doctor needs zero changes. |
| R16-2 | opus | `src/episode/store.ts`, `test/unit/episode/store.test.ts`. `EpisodeEventStore.append` calls `validateEpisodeEvent` before `appendJsonlLine`. Malformed append rejects; log bytes unchanged. Keep existing read-side tests untouched. |
| R16-3 | gpt-sol | `src/adaptation/eval-routing.ts`, `test/unit/adaptation/eval-routing.test.ts`. Swap the persisted eval report write to `writeFileAtomic`. Rename-seam test: destination holds previous complete report or the new one, never a splice. No crash-probe case. |
| R16-4 | opus | `src/cli/migrate-legacy.ts`, `test/unit/cli/migrate-legacy.test.ts`, `test/integration/cli/migrate-legacy.test.ts`. Atomic never-overwrite publish (temp + fsync + `link(temp, destination)`; EEXIST → existing digest comparison). **Do not** edit `scripts/crash-probe.mjs` (parent declined a 12th probe case this round). Crash-seam unit/integration tests only. |

**Parent sign-off**
- **R16-1 YES — lock at the CLI layer** (recommended): bind + mutate + persist inside `withExclusiveFileLock`. Not inside the synchronous store API (that stays in-process). No schema, no new `RunStatus`.
- **R16-4 YES — fix shape (a)** atomic never-overwrite publish. **NO** 12th crash-probe case this round (keep the frozen 11; cover the window with owned tests).
- **R16-2 / R16-3:** no extra sign-off.

Frozen (do not break): ROUND15-BRIEF §3–§5 plus ROUND16-BRIEF §3/§5 — `taskCriteria` writer; `onRunStarted`; census terminator (R16-1's dictionary update is the landing-triggered kind); exact eight `RunStatus`; EventStore/CheckpointStore stay unlocked; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`; no lock steal; jsonl signatures; `writeFileAtomic`(+Sync); no new private tmp+rename outside `persist/atomic-file.ts`.

Every slot: census first; verify paths exist; scoped eslint + whole-tree `tsc --noEmit`; owned tests 3×; report `.agent_workspace/loop4-r16-tN.md`. No full gate.

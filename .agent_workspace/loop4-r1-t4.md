[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 1 — T4 slot report

**Task:** Episode plane — validated event reads + settle under the episode lock
**Branch:** `agent/opt-continuous` (working tree only; no commit, no push, no PR)
**Metric class:** correctness / fail-closed. **No performance claim is made.**

## Files changed (exclusive ownership only)

| Path | Change |
|---|---|
| `src/episode/events.ts` | new `validateEpisodeEvent(value): EpisodeEvent` (+94 lines) |
| `src/episode/store.ts` | `EpisodeEventStore.readAll` validates every row; corrupt-JSON callback upgraded to `DomainValidationError` |
| `src/run/episode-bind.ts` | new exported `episodeLockPath`; `settleBoundEpisode` read-decide-append moved under `withExclusiveFileLock`; optional `lockOptions`; unlocked-`bindEpisodeToRun` rationale comment |
| `test/unit/episode/events-validate.test.ts` | new — validator unit cases |
| `test/unit/episode/store.test.ts` | new — store read/round-trip/fail-closed/recovery cases |
| `test/unit/run/episode-bind.test.ts` | +4 tests (lock-path pin, contended settle, re-read under lock, lock cleanup) |
| `src/run/episode-store.ts`, `test/unit/run/episode-store.test.ts` | unchanged (already validated / already pinned) |

Nothing outside the ownership list was touched: `src/cli/episode.ts`, `src/persist/file-lock.ts` and `src/persist/jsonl.ts` are read-only from this slot, and the frozen `appendJsonlLine` / `readJsonlObjects` / `withExclusiveFileLock` signatures are used as-is.

## 1. Blind cast removed (`fable §3`)

`EpisodeEventStore.readAll` previously returned `values as EpisodeEvent[]` — the only episode-plane reader with no validation, and the source `episode events --json` re-emits verbatim.

`validateEpisodeEvent` is a fail-closed decoder over exactly the four known shapes:

- `EPISODE_OPENED` — `episode` through the existing `validateEpisode`, `occurredAt` a real `IsoTimestamp`.
- `RUN_ATTACHED` — `episodeId` / `runId` through `isEpisodeId` / `isRunId`, `attachedAt` a timestamp.
- `EPISODE_WAITING` — `episodeId`, non-empty `reason`, `requiredEvidence` an array of strings, `occurredAt`.
- `EPISODE_CLOSED` — `episodeId`, `status` through `isEpisodeStatus`, `closedAt`, optional `outcomeId` (string when present; the key is omitted, not set to `undefined`, so the row round-trips byte-identically).

Any other `type` throws `DomainValidationError: Unknown EpisodeEvent.type: …` (label truncated to 40 chars). Only known keys are copied into the returned object, so unknown fields and a JSON-parsed own `__proto__` key are dropped rather than propagated. `readAll` wraps each failure as `Invalid episode event at line N in <path>: <reason>`; the JSON-corruption callback now also throws `DomainValidationError` (it previously threw a bare `Error`), matching `EpisodeStore`. Truncated-tail recovery is untouched: the tail is still reported through `recovery`, never thrown.

Caveat recorded honestly: the line number in the validation message is the 1-based *record* index from `readJsonlObjects`, which equals the physical line number for logs written by `appendJsonlLine` (no blank lines) but would drift if a log ever contained blank lines. The JSON-corruption path keeps the physical index it always used.

## 2. Settle under the episode lock (`fable §2c`)

`settleBoundEpisode` now acquires `runtime/episodes/<id>.lock` — the same file `episode close` takes (`src/cli/episode.ts:90-91`) — and performs the whole read-decide-append inside it. The snapshot read that decides the action lives in `settleLockedEpisode`, which only runs with the lock held, so `latest` is always re-read after acquisition; a terminal snapshot that landed while we waited is seen and the settle becomes a no-op. Lock acquisition failure is not swallowed: the `DomainValidationError` from `withExclusiveFileLock` propagates to the caller and nothing is appended.

`opts.lockOptions?: FileLockOptions` is additive (all five production call sites in `coordinator.ts`, `supervisor.ts`, `flowchart-run.ts`, `track/loop.ts` keep the 5 s default); the tests use it to keep contention cases in the tens of milliseconds.

`bindEpisodeToRun` stays unlocked, with the reason in a comment: the episode id is generated one line earlier and is not reachable by any other writer until it appears in the run log.

The path is exported as `episodeLockPath(stateRoot, episodeId)` and pinned two ways: a direct equality check, and a source pin asserting `src/cli/episode.ts` still builds the identical `join(runtimeRoot(stateRoot), "episodes", ...)` template ending in `.lock`. If either side ever moves its lock file, the pin goes red instead of the two writers silently serializing against different files.

## 3. Tests (all six required behaviors)

| Required behavior | Test |
|---|---|
| 1. malformed / unknown-type row → `readAll` throws `DomainValidationError` naming the line | `test/unit/episode/store.test.ts`: "an unknown-type row fails readAll closed and names the line", "a malformed required field fails readAll closed instead of being cast", "a corrupt mid-file line fails readAll closed with a DomainValidationError" |
| 2. valid logs round-trip identically | `store.test.ts`: "a valid episode event log round-trips identically" (per-event `JSON.stringify` equality **and** byte equality of the whole file against the fixtures) |
| 3. settle while an external holder owns the lock → times out closed, nothing appended | `episode-bind.test.ts`: "settleBoundEpisode fails closed when another writer holds the episode lock" (asserts the rejection *and* that run events, episode snapshots and episode events are all unchanged in count) |
| 4. settle re-checks inside the lock: already terminal → no-op | `episode-bind.test.ts`: "settleBoundEpisode re-reads under the lock and never appends a second terminal" — a holder standing in for `episode close` appends an ABANDONED snapshot+event while settle waits; after release, settle appends nothing: zero `EPISODE_CLOSED` run events, exactly one terminal snapshot, exactly one `EPISODE_CLOSED` episode event |
| 5. existing waiting/close transitions unchanged | the four pre-existing `episode-bind.test.ts` transition tests are untouched and green; plus "settleBoundEpisode leaves no lock file behind after a clean settle" |
| 6. truncated-tail recovery still reported, not fatal | `store.test.ts`: "a crash-truncated final line is still recovered, not fatal"; `test/unit/run/episode-store.test.ts` snapshot-side case unchanged and green |

Extra coverage in `test/unit/episode/events-validate.test.ts`: the four shapes accepted unchanged, `EPISODE_CLOSED` without `outcomeId`, unknown type, non-objects / missing type, twelve malformed-field cases across all four shapes, and shape-exactness (unknown keys dropped, `Object.prototype` unpolluted).

Synchronization in the two lock tests is by promise handoff (the holder signals acquisition from inside the critical section; the test releases it explicitly) — no sleeps as synchronization. The one timing-shaped assertion is `settled === false` after a `setImmediate` yield, which pins that settle is still blocked while the operator holds the lock.

## 4. Verification run on this VM (Node 22.14.0, pnpm 10.17.1)

Owned tests only, as instructed (`pnpm test`/`pnpm gate` in full were not run from this slot):

```
pnpm test -- test/unit/episode test/unit/run/episode-bind.test.ts test/unit/run/episode-store.test.ts
# tests 40  # pass 40  # fail 0  # duration_ms 489.68
```

`npx eslint` over the seven owned paths: clean. `pnpm typecheck` (whole project, shared working tree): the only remaining error is `test/unit/protocol/v1.test.ts(302,56)` from another slot's in-flight edit; zero errors in T4 files.

Consumer sanity check for the now-validating reader (read-only for this slot, run because they are the two direct consumers of `EpisodeEventStore.readAll`): `test/integration/m3/episode-cli.test.ts` and `test/integration/m3/episode-reducer-store.test.ts` — 4/4 pass. Every event written in the tree comes from `openEpisode` / `attachRun` / `waitForUser` / `closeEpisode`, all of which produce shapes the validator accepts.

## 5. Honest limits

- Fail-closed is a *cooperative* posture: the lock only serializes writers that take it. Both writers in this tree now do (`episode close` and `settleBoundEpisode`); a third writer bypassing the lock would still race, and `delete --episode` still removes a live `<id>.lock` (disclosed in `deletion.ts:168-177`, unchanged here).
- A settle that cannot get the lock within the timeout throws to its caller. That is the intended fail-closed direction, but it means a stuck lock file surfaces as a run-side error rather than a silent skip; recovery is the documented manual lock cleanup in `file-lock.ts`.
- No claim about R1/bandit/topology, no Outcome-supported claim, ADR-006 unchanged (still Proposed), no auto-promote, no `package.json` dependency change, no git history rewrite, no commits from this slot.

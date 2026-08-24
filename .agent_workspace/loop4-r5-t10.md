gpt-5.6-sol

# Loop 4 · Round 5 · R5-10 — Decode doctrine and episode replay dead code

Baseline: `6975aab` on `agent/opt-continuous`. During the slot, the orchestrator
advanced the shared branch to `c8e2524` (the Round 5 dispatch-record commit).
This agent did not commit or change branches.

## Census first

- Repo-wide symbol/path search found `replayFromLog` and `replayEpisodeEvents`
  only in `src/episode/replay.ts` and its own unit test. There is no production
  import, dynamic import, or barrel re-export.
- The live read path is `EpisodeEventStore.readAll()` in
  `src/episode/store.ts`. It uses `readJsonlObjects`, then validates every
  decoded row through `validateEpisodeEvent`.
- `test/unit/episode/store.test.ts` already pins the live path's valid
  round-trip, missing-file behavior, unknown/malformed event rejection,
  corrupt middle-line typed failure, and truncated-final-line recovery.
- Therefore there is no imminent caller to justify wiring the duplicate replay
  API. Removal is the smaller honest change.

## Changes

1. Deleted `src/episode/replay.ts`, including both caller-less replay
   functions and their unvalidated cast/bare-error path.
2. Replaced its self-test with a census pin asserting that the duplicate
   replay module remains absent. Reintroducing it now requires changing the pin
   alongside evidence of a live caller.
3. Changed only `CheckpointStore.read`: malformed checkpoint JSON now throws
   an exact `DomainValidationError` whose message includes the full
   `checkpoint.json` path and the parse reason.
   - The ENOENT branch is byte-unchanged and still returns `undefined`.
   - Valid JSON still returns the same parsed value.
   - `write`, its docstring, and the “does not block on the run lock” decision
     pin are untouched.
4. No edit was needed in `src/cli/flowchart-io.ts`: at baseline HEAD,
   `readJsonFile` already wraps `JSON.parse` in `try/catch` and throws
   `DomainValidationError("Invalid <label> <path>: ...")`. History confirms
   this behavior has existed since that file was introduced. The brief's
   “bare parse” claim is stale for this file.

No `persist/` or `package.json` files were edited.

## Verification

- Scoped ESLint:
  `pnpm exec eslint src/run/checkpoint-store.ts src/cli/flowchart-io.ts test/unit/episode/replay.test.ts test/unit/run/checkpoint-store.test.ts`
  — clean.
- Whole-tree `pnpm exec tsc --noEmit` — final run clean, 0 errors. A recheck
  briefly saw three missing-name errors in peer-owned
  `src/learning/bandit-store.ts` while that file was mid-edit; its owner
  completed the edit and the final whole-tree run passed.
- Focused tests:
  `test/unit/episode/replay.test.ts`,
  `test/unit/episode/store.test.ts`,
  `test/unit/run/checkpoint-store.test.ts`, and
  `test/unit/cli/flowchart-cli.test.ts` — 17/17 pass, 0 fail, 0 skip.
- Scoped `git diff --check` — clean.

The shared working tree also contained concurrent peer edits in docs,
adaptation/config/pi-adapter files and their tests. They were not touched.

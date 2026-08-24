[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 Round 8 — R8-10

## Result

Added one test-only pre-rounds crash pin in `test/integration/m2/supervisor-crash.test.ts`. The seed is reachable without production changes.

The one-shot armable id generator permits the nine generations through `RUN_STARTED`, exhausts on the `TASK_GRAPH_ACCEPTED` event id, then disarms so crash bookkeeping can proceed. The test proves the persisted shape:

- `RUN_ATTACHED` landed, so the episode bind succeeded.
- `TASK_GRAPH_ACCEPTED` did not land, so rounds never opened.
- The in-flight terminal guard recorded exactly one `RUN_FAILED`.
- The only post-terminal event is `EPISODE_CLOSED`.
- Replay, the bound episode, and the checkpoint all read `FAILED`, with no replay anomaly.

R7-9's failed-bind seed, its `afterTerminal === []` assertion, the terminal resume pin, and the episode-store variant are unchanged.

## Census

- The existing pre-rounds seed fails inside `bindEpisodeToRun`, before a `RUN_ATTACHED` can expose an episode; this correctly exercises no invented closure.
- Existing rounds-window closure coverage remains separate.
- `startSupervisedRun` generates ids in a stable opening order: run, project, root task, two opening events, episode, two bind events, and `RUN_STARTED`; the next generation is for `TASK_GRAPH_ACCEPTED`.
- No named skip exists in the owned test file.
- Working-tree changes outside the owned test and this report belong to concurrent Round 8 slots and were not edited.

## Verification

- `pnpm test -- test/integration/m2/supervisor-crash.test.ts` — 13/13 pass, run three times.
- `pnpm exec eslint test/integration/m2/supervisor-crash.test.ts` — pass.
- `pnpm exec tsc --noEmit` — pass across the whole tree.
- No full gate run, as instructed.

The commands emitted only the repository's existing Node engine warning (`v22.14.0` versus declared `>=22.19.0`).

## Scope

No `src/**`, `src/graph/validate.ts`, package, ADR, live-R1, or existing test-line edits. The test-file diff is additive, introduces one test, and introduces no skip or scratch file.

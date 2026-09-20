# Native worker observation projection — verification record (2026-09-20)

## Scope

`TASK-20260920-native-observation-projection` on branch
`feat/native-observation-projection` (base `ee40c43`). Plan:
[2026-09-20-native-observation-projection](../superpowers/plans/2026-09-20-native-observation-projection.md).

Wires the PR-B observation library (`ObservationStore` +
`projectObservation`), previously library-only, into the native worker read
path so repeat reads of large files stop re-sending full content.

## What changed

- `src/pi-adapter/observation-tools.ts` (new):
  - `createObservationProjector({enabled, toolName})` — run-scoped projector.
    Content-keyed send counter (prefix+suffix+length key; exact identity is
    the store's sha256) implements the first-two-fulls / then-placeholder
    contract per distinct content. Fail-closed rules come from the library
    (`isEligible`): small (<10KiB), error, and evidence-receipt results are
    never projected. Disabled ⇒ byte-identical passthrough, zero archive.
  - `createRecallTool(projector)` — `sparkle_recall_observation`, paged
    (offset/nextOffset/eof), hash-verified recall; only objects this run's
    projector archived (id → ref map); unknown ids refused with a clear
    error. Registered only when projection is enabled.
  - Late binding: created unbound; `bind({runId, stateRoot})` exactly once;
    use before bind and double bind both fail loudly.
- `src/native/session.ts`: `NativeDelegateInput.observationProjector`
  (optional). After `startParentRun` returns (synchronously, before any child
  work — single-threaded event loop), `delegate` binds the projector to the
  run's own id, so archives always land under
  `runtime/runs/<runId>/observations/` and vanish with the existing
  `delete --run` cascade.
- `src/pi-adapter/native-executor.ts`: optional `observationProjector` input;
  wraps `sparkle_read_file`'s result text through `project()` and registers
  the recall tool alongside. Without the projector the tool surface and
  behavior are unchanged.
- `extensions/pi-sparkle/index.ts`: opt-in `contextEfficiency` boolean on
  `sparkle_delegate` (default off; no schema break for existing callers).
- `src/context/observation-store.ts`: lock fix (below).
- `test/unit/pi-adapter/observation-tools.test.ts` (5 tests),
  `test/unit/native/session.test.ts` (delegate-level projection test), lock
  test updated in `test/unit/context/observation-store.test.ts`.

## Root-cause finding (lock collision — real library bug)

The delegate-level test failed on the first live run: every `store.put`
silently degraded to `storage-unavailable`. Instrumented root cause:
`ObservationStore.put/recall` locked on `runLockPath(stateRoot, runId)` — the
**run lifecycle lock** the parent coordinator holds for the whole run. A
worker archiving mid-run always hit the 5s lock timeout. PR-B never exposed
this because the store was never exercised inside an active run.

Fix: `observationLockPath(stateRoot, runId)` =
`runtime/runs/<runId>/observations/.lock` — a dedicated lock for the
observation archive's own concurrency domain. Per-run archive data is
naturally exclusive to its run, so sharing the lifecycle lock was never
semantically required. The existing exclusion test was repointed at the new
lock (still proves put waits behind an exclusive holder); grep confirms no
other store dependency imports `runLockPath`.

Also rejected during design: pre-knowing the runId by injecting a fixed id
generator into the coordinator. The generator mints **every** id in the run
(events, messages, agent instances) — pinning it would collide them all.
Late binding avoids the problem entirely.

## Trust/policy boundary (summary)

- Projection is read-path-only context efficiency; it never rewrites
  evidence, never packs error results or evidence receipts, and the recall
  surface is hash-verified store paging. No new acceptance or verification
  claims.
- Default off. The model can only *enable* it per delegation; it cannot
  disable archive deletion, cross runs, or recall another run's objects.
- The delegation result's self-report disclosure is unchanged (children's
  reports are not independently verified).

## Commands

| Command | Outcome |
|---|---|
| `pnpm test test/unit/pi-adapter` | 150 pass / 0 fail / 1 skip |
| `pnpm test test/unit/context` | 43 pass / 0 fail |
| `pnpm test test/unit/native` | 28 pass / 0 fail |
| `pnpm test test/unit/routing` | 232 pass / 0 fail (live-isolation unchanged) |
| `pnpm test test/integration/native` | 15 pass / 0 fail |
| `pnpm test -- --test-concurrency=1` (full suite) | **2826 pass / 0 fail / 18 skip** |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 ×3 |
| `pnpm security:probe` | PASS, 0 open / 0 waived |
| `pnpm pi:probe` | PASS 4/4 |

## Handoff

- Independent review pending (relay-blocked; batch with registration +
  delegate-routing re-dispatches).
- Open follow-ups: CLI-side wiring (not in scope), measured token deltas on
  real delegations, global-config allowlists, F-PROD.

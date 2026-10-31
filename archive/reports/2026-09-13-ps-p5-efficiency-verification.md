# PS-P5 efficiency verification (2026-09-13)

## Scope

Incremental efficiency on `grok/sol-efficiency` continuing from P4 tip `d84cfc0`. No rewrite of supervisor/CLI; no P4 reopen; no Soul; no F6 promotion; no fake bench wins.

## Done bar

1. **Incremental checkpoint replay** — `ReplayCursor` + `replayFromCheckpointOffset` + `EventStore.readFromOffset`. Live persist (`persistCheckpoint`) reuses a cursor and reads only the tail after the first write. Missing / unknown offsets and `EventLogOffsetError` fall back to full `replayRun`. Corrupt middle still throws.
2. **Event aggregation / backpressure** — `DeltaAggregator` coalesces consecutive TEXT/THINKING deltas into progress counters. TOOL_*/TURN_*/MESSAGE/EXECUTION_FINISHED always pass through. Watermarks (16 chunks / 4096 units / queue 32) flush; they do not drop. Single-delta summary spelling is unchanged (`text delta (N chars)`).
3. **One duty split** — checkpoint persist/load/write extracted to `src/run/flowchart-checkpoint.ts`. Flowchart loop still owns scheduling/lifecycle. CLI `main.ts` dispatch switch left in place (parity test still reads it).
4. **Docs/UX** — this report only.
5. **Non-regression pins** — truncate recovery, fail-closed corrupt middle, delete verification, P2 pause/inject after terminal, P3 self-report ≠ independent PASS, P4 F6 harness-failure ≠ production-candidate, HOTFIX UNOBSERVED/provider.

## What got cheaper (measured in tests, not a bench)

| Path | Before | After |
| --- | --- | --- |
| Live flowchart persist after first checkpoint | `readAll` + full `replayRun` every step | `readFromOffset` + apply tail only (`replayMode: "incremental"`, 1 applied event in the persist unit test) |
| Consecutive executor TEXT/THINKING deltas | one `AGENT_EVENT` append per chunk | one append per window/kind/watermark; evidence events unchanged |
| JSONL readers that already have a record-boundary offset | full-file UTF-8 parse | suffix parse from `completeByteLength` |

Cold resume still full-reads the log: `childTasksFromLog` / `unappliedUnblock` need the prefix. That is intentional, not a residual defect.

## Modules

| Module | Role |
| --- | --- |
| `src/run/replay.ts` | `ReplayCursor` / `applyReplayEvents` / `snapshotReplay`; `replayRun` is the full snapshot |
| `src/run/incremental-replay.ts` | `replayFromCheckpointOffset` (safe incremental or full fallback) |
| `src/run/flowchart-checkpoint.ts` | Persist duty: `loadReplayForPersist` + `writeRunCheckpoint` |
| `src/run/event-aggregation.ts` | Delta window metrics + backpressure observations |
| `src/run/event-store.ts` | `readFromOffset` + `completeByteLength` |
| `src/persist/jsonl.ts` | `readJsonlObjectsFromOffset` (`readJsonlObjects` unchanged) |
| `src/run/flowchart-run.ts` | Thin persist wrapper; keeps criteria/ceiling advance-before-write |
| `src/run/coordinator.ts` / `child-coordinator.ts` | Wire aggregator; single-delta path identical |

## Tests

- `test/unit/run/incremental-replay.test.ts`
- `test/unit/run/event-aggregation.test.ts`
- `test/unit/run/event-store-offset.test.ts`
- `test/unit/run/flowchart-checkpoint.test.ts`
- `test/unit/persist/jsonl-offset.test.ts`
- `test/unit/run/p5-recovery-pins.test.ts` — truncate, corrupt middle, delete verify, P3/P4/HOTFIX

Existing suites still used as pins: `replay.test.ts`, `event-store.test.ts`, `jsonl.test.ts`, `control-plane-single-writer.test.ts`, `acceptance.test.ts`, `arm-outcome.test.ts`, `m0/coordinator.test.ts`.

## Gate

```
pnpm gate
exit: 0
tests: 2741 total; pass 2740; fail 0; skipped 1; suites 142; duration_ms ~28299
tip-before: d84cfc0c334d8a3c13c698870c8af99e20cb413e
```

Typecheck + lint + test + build all green. Freeze tip after the PS-P5 commit (no merge / no push).

## Residuals

- Cold resume / inspect / follow still full-read the log.
- No Windows bench numbers claimed.
- CLI command dispatch not extracted (one duty this tip: checkpoint persist).
- No F6 Week-1 collection, no Soul, no F-PROD.

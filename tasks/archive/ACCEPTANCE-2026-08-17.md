# Acceptance record — 2026-08-17

Quality gates (local, fake-executor default; real Pi smoke remains opt-in):

| Command | Result |
| --- | --- |
| `pnpm test` | 712 pass, 3 skip, 0 fail (715 collected) |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm build` | pass |

Source code was **not** moved. Archive means: completed plan text left `tasks/` and is kept here with the tests that prove it.

## Runtime M0–M2.5 — accepted, plan removed from `tasks/`

| Slice | Evidence |
| --- | --- |
| T1–T5 / Checkpoint A | `test/integration/m0/`, `test/integration/cli/`, `test/unit/run/` |
| T6–T8 / Checkpoint B | `test/integration/m1/`, `test/unit/protocol/` |
| T9–T11 / Checkpoint C | `test/integration/m2/` |
| T12–T17 / Checkpoints D–E (runtime flowchart + optional pause/commit) | `test/integration/m2.5/`, `test/unit/supervisor/`, `test/integration/m3/pause-inject.test.ts`, `test/integration/cli/commits.test.ts` |

Human-only remainder that does **not** block the runtime archive: real-provider Pi smoke (`PI_*`) remains opt-in.

## Adaptive library — accepted slices (machinery)

These plan checkboxes were empty in the live plan but are proven by tests. They are removed from the active plan.

| Slice | Key tests |
| --- | --- |
| M3-T3 source normalize / extract / critique | `test/unit/requirement/source-normalization.test.ts`, `test/integration/m3/requirement-extraction.test.ts` |
| M3-T7 episode close / inspect CLI | `test/integration/m3/episode-cli.test.ts`, `test/unit/episode/closure.test.ts` |
| M4-T1–T6 except safety one-off | `test/unit/evaluation/`, `test/unit/review/`, `test/unit/preferences/`, `test/unit/learning/patterns.test.ts`, `test/integration/m4/` |
| M5-T1–T4 | `test/unit/routing/r0.test.ts`, `r1.test.ts`, `test/integration/m5/replay.test.ts`, `test/unit/routing/shadow.test.ts` |
| M5-T5 topology **module** (not live loop) | `test/unit/routing/topology.test.ts`; live isolation: `test/unit/routing/live-isolation.test.ts` |
| M6-T1–T6 machinery | `test/unit/adaptation/`, `test/unit/experiments/` |
| Checkpoint G **Exercised** ladder | `test/acceptance/adaptive-loop.test.ts` |

Checkpoint G does **not** claim `Outcome-supported`. That remains blocked on Checkpoint F / ADR-005.

## Explicitly not accepted (kept in live `tasks/`)

P0 ADR freeze; M3-T1/T2/T4/T5/T6/T8 gaps and Checkpoint D; M4-T6 severe-safety one-off; M5-T5 live-loop recording (frozen until Checkpoint F); Checkpoint F sealed holdout; Outcome-supported; optional M7.

# Flowchart terminal recorder extraction

## Identity

- ID: `TASK-20261015-flowchart-terminal-refactor`
- Owner: flowchart recovery/terminal agent; root owns review, full gate and GitHub synchronization.
- State: `ready-for-review`
- Date opened: 2026-10-15 (Asia/Shanghai)
- Baseline: local `0b041ec`, tree-equivalent to published checkpoint `43aea5ae9f00834f8249495d7e601f4c6439541e`, tree `8e137d2ed8170a1526a1e6a7f8bea27d95b6547b`.
- Related roadmap: P2 termination/recovery extraction in [architecture report](../../reports/2026-10-15-architecture-agent-loop.md); previous [child recovery slice](../../reports/2026-10-15-flowchart-recovery-refactor.md).
- Contracts: [status matrix](../../../docs/status-matrix.md), frozen terminal replay vocabulary, single-writer lifecycle and existing terminal/recovery pins.

## Problem and scope

After the first extraction, `flowchart-run.ts` still mixes normal terminal event recording with loop orchestration. Move the existing four small functions `alreadyTerminal`, `persistBlocked`, `persistCompleted` and `persistFailed` to one narrow module, retaining every runtime statement and ordering.

In scope: `src/run/flowchart-terminal.ts` with a structural context containing only log reads, append/event factory, ledger snapshot and child cancellation; replace local function definitions with imported recorders; update source ownership pins without removing assertions; add direct behavioral coverage for ordering, first terminal refusal, authorized unblock and cancellation before log read.

Out of scope: `finish`, crash terminal handling, checkpoints, resumable-state preservation, cancellation ownership, locks, actor control, new lifecycle protocol, concurrency changes, event/status/API/schema changes, monetary settlement, live providers, shared tasks/status/CI files, commits and GitHub writes by this agent.

## Acceptance criteria

- [x] Baseline terminal/replay, abort, checkpoint and resume characterization passes before extraction; 2026-10-15, 84/0/0.
- [x] Recorder runtime bodies stay unchanged (four exact AST body matches); shared `replayedTerminalStatus` remains the only normal terminal lookup, including BLOCKED-until-authorized-unblock.
- [x] Seven direct regressions pin stall-before-block, unchanged reason/evidence and settlement-before-read/append ordering, including errors and a block arriving during settlement.
- [x] Prior terminal refusal matrix and ordinary unblock tests pass; existing ordinary/discard unblock integration remains green.
- [x] AST source pins inspect the extracted owner, retain guards/replay assertions and live call sites; discard/crash/checkpoint pins keep existing owners.
- [x] Final focused suite 138/0/0, typecheck, lint, workflow and diff checks pass; [report](../../reports/2026-10-15-flowchart-terminal-refactor.md) records commands/results and root handoff.

## Implementation slice

| File | Change | Risk |
|---|---|---|
| `src/run/flowchart-terminal.ts` | Four existing recorder functions and narrow structural context | Preserve first-terminal and cancellation/event ordering |
| `src/run/flowchart-run.ts` | Import three recorders; retain finish/crash/checkpoint/cancellation orchestration | Keep shared lifecycle ownership |
| `test/unit/run/flowchart-terminal.test.ts` | Behavioral tests using replayable in-memory event streams | Assert effects, authoritative log and error propagation |
| `test/unit/run/replay.test.ts` | Move recorder source ownership pin to extracted functions using TypeScript AST | Preserve all named recorder guards and shared-replay assertion |
| `test/unit/run/flowchart-applyretry-absence.test.ts` | Include new recorder module in scheduler/retry absence census | Original discard/audit owner checks remain |
| This plan and matching report | Durable scope/evidence/handoff | No full-gate or policy-gate inference |

## Test-first plan

This slice preserves behavior. First run existing characterization, then extract while green. New tests cover observable event effects and ordering, including a terminal arriving while cancellation settles and refusal to append BLOCKED when its preceding stall append fails.

Baseline: `node scripts/run-tests.mjs test/unit/run/replay.test.ts test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/unit/run/flowchart-applyretry-absence.test.ts test/integration/m2.5/resume.test.ts`.

Final focused command adds `test/unit/run/flowchart-terminal.test.ts`; typecheck and focused ESLint follow. Capture exact outputs under `.agent_workspace/continuous-quality/flowchart-terminal-*`. Root alone runs `pnpm gate` and relevant probes and publishes the next checkpoint.

## Gates and handoff

Abort if extraction requires changing a frozen behavior assertion, adding a competing lock/lifecycle controller, or moving crash/checkpoint responsibility. No R10/R11, S0-min, F6/F-PROD or production/outcome gate closes. Root reviews and integrates only after source freeze and the dated report.

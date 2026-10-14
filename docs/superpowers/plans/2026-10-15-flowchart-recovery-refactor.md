# Flowchart child recovery extraction

## Identity

- ID: `TASK-20261015-flowchart-recovery-refactor`
- Owner: flowchart recovery agent; root coordinates integration and publication.
- State: `ready-for-review`
- Date opened: 2026-10-15 (Asia/Shanghai)
- Baseline: `c2b802c`; related roadmap: [architecture and development report](../../reports/2026-10-15-architecture-agent-loop.md), P2 flowchart recovery/termination extraction.
- Contract: [status matrix](../../status-matrix.md), event log + checkpoint + resume row; existing acceptance and budget pinning tests.

## Problem and scope

`src/run/flowchart-run.ts` contains 2,671 lines and mixes orchestration with pure reconstruction of child specifications and durable acceptance/cost records. Extract one existing responsibility without introducing new recovery behavior.

In scope: move log request/routing selection, child reconstruction, criteria/cost planning and monotone checkpoint record advancement/restoration into `src/run/flowchart-child-recovery.ts`; retain the existing resume call-site shape and helper names; characterize the original behavior before extraction and add direct boundary regressions where useful.

Out of scope: termination/lifecycle redesign, recovery adoption, API/event/checkpoint/status/schema changes, monetary settlement, default CLI/native write wiring, concurrent Stage 2 files, shared task/status/package/CI files, live providers, commits and GitHub writes by the recovery agent. Root owns the full gate, integration, durable active-task update and publication.

## Acceptance criteria

- [x] Existing recovery/abort, acceptance, cost-cap, checkpoint and terminal replay regressions pass before and after extraction; 2026-10-15 baseline 43/0/0 and expanded 82/0/0.
- [x] Logged requests remain last-request-wins; checkpoint criteria/cost advancement remains first-write-wins, sorted, and preserves absence versus empty declarations; eight focused boundary regressions pass.
- [x] Reconstruction preserves true assigned role, dependencies, model/cascade, artifacts, criteria and limits; never invents sibling cost authorization or promotes compile-time `agentRole` into a child gate; existing and direct boundary tests pass.
- [x] Recorded criteria/cost restore only for children with no logged request; logged budgets and criteria remain authoritative; explicit conflicting/empty/uncapped precedence regression passes.
- [x] `flowchart-run.ts` shrinks 2,671 → 2,263 lines; module imports type-only orchestration/persistence surfaces and existing pure runtime dependencies.
- [x] [Dated report](../../reports/2026-10-15-flowchart-recovery-refactor.md) contains exact verification commands, outcomes, known limitations and root handoff.

## Implementation slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/run/flowchart-run.ts` | Replace pure reconstruction helper bodies with imports; preserve existing call sites | recovery agent | Source-shape pinning, public frozen behavior |
| `src/run/flowchart-child-recovery.ts` | Pure request/spec/criteria/cost recovery helpers | recovery agent | Type-only orchestration dependencies; no writes |
| New focused recovery test file | Assert extracted boundaries against meaningful recovery inputs | recovery agent | Fixture fidelity; avoid asserting implementation shape |
| `test/unit/run/flowchart-applyretry-absence.test.ts` | Extend scheduler/retry source census to the extraction; retain discard/restore owners | recovery agent | Existing pinning review requested this coverage correction |
| This plan and matching report | Scope/evidence/handoff | recovery agent | Do not overstate full roadmap completion |

## Test-first plan

This is behavior-preserving refactoring: run baseline characterization first rather than inventing a desired behavioral failure. Existing extensive executable recovery tests already cover crash/resume, role/cascade, criteria and costs. Add direct tests for duplicate/empty/absent criteria and ceilings, original-source precedence and reconstruction, then verify alongside the existing integrated regressions.

Commands:

- `pnpm test -- test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/integration/m2.5/children-flowchart.test.ts test/integration/m2.5/flowchart-run-cap.test.ts test/integration/run/criteria-gate.test.ts`
- `pnpm test -- test/unit/run/flowchart-child-recovery.test.ts` (after extraction)
- `pnpm typecheck`, focused ESLint and `pnpm workflow:check`.
- Root delivery gate: `pnpm gate`, applicable probes, independent review.

Capture exact local command/output under `.agent_workspace/continuous-quality/flowchart-recovery-*`; promote concise verified facts into the report. Abort if a move changes any frozen behavior or requires changing an existing behavioral assertion; identify and defer the incompatible extraction instead.

## Gates and handoff

No new human/experiment/production gate is closed. Existing R10/R11, S0-min, F6/F-PROD and Outcome-supported boundaries remain open. Local refactor verification and independent review are separate from root delivery/full gate and GitHub publication. Lifecycle extraction remains a separately bounded follow-up.

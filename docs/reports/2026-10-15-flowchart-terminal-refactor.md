# Flowchart terminal recorder refactor verification

## Identity and result

- Task: `TASK-20261015-flowchart-terminal-refactor`
- Baseline: local `0b041ec`, same tree as published first checkpoint `43aea5ae9f00834f8249495d7e601f4c6439541e` (`8e137d2ed8170a1526a1e6a7f8bea27d95b6547b`).
- Verified: 2026-10-15 (Asia/Shanghai), isolated Linux checkout.
- State: `ready-for-review`; root owns integration gate and publication.
- Authority: [bounded plan](../superpowers/plans/2026-10-15-flowchart-terminal-refactor.md), P2 termination/recovery extraction from the [architecture roadmap](2026-10-15-architecture-agent-loop.md).

Moved only `alreadyTerminal`, `persistBlocked`, `persistCompleted` and `persistFailed` into `src/run/flowchart-terminal.ts`. The caller still owns lifecycle locks, cancellation, crash recording, resumable-state preservation and checkpoint/episode settlement. The new context exposes only event reads, event construction/appends, ledger snapshot and cancellation/settlement. Its only runtime dependency is the existing shared replay helper.

`flowchart-run.ts` shrank from 2,263 to 2,214 lines in this slice (49 lines, 2.2%); cumulatively from the original 2,671 lines to 2,214 (457 lines, 17.1%). The new recorder module has 74 lines including its structural context and contract explanation. Total source size increases by the small module boundary; this is responsibility separation, not evidence of runtime speed or quality gains.

## Compatibility and behavioral evidence

The four recorder function bodies match baseline exactly in a TypeScript AST comparison. Context type and export/import ownership changed; runtime statements did not. The comparison is saved as `.agent_workspace/continuous-quality/flowchart-terminal-exact-body-review.json`. Root independently repeated the comparison and reported PASS.

Normal terminal refusal still consults `replayedTerminalStatus`; its vocabulary remains exactly COMPLETED, FAILED and BLOCKED. CANCELLED, PAUSED and WAITING_FOR_USER are not silently added. BLOCKED remains latched until an existing matched unblock event clears it. No new lifecycle or concurrency guarantee is introduced.

Seven direct behavior tests cover:

- Awaiting the stall append before constructing/appending BLOCKED, with unchanged reason, ledger round/stall counts and evidence descriptions.
- All three prior normal terminals against all three recorders: no second terminal or ledger snapshot; failure still settles children.
- Matched ordinary unblock permitting each next terminal without replay anomalies.
- Deferred child settlement preventing early log reads/appends, then retaining the exact supplied failure reason.
- BLOCKED arriving during settlement suppressing the subsequent failure after a fresh log read.
- Cancellation failure propagating before any log access.
- Failed stall append propagating without constructing or appending BLOCKED.

Existing replay tests retain ordinary/discard unblock, stale authorization and shared-terminal semantics. Existing abort/resume/gate/unblock tests retain whole-run ordering and operator-actionability coverage.

## Source-owner verification

`test/unit/run/replay.test.ts` now uses TypeScript AST function declarations to inspect the extracted recorder owner. It keeps each of the three `alreadyTerminal` guards and the shared `replayedTerminalStatus` assertion, and additionally pins the live orchestrator's imports/calls and absence of private recorder copies. `FLOWCHART_RUN_SOURCE` remains available for the original discard validation pin.

The scheduler/`applyRetry` absence census includes both extracted modules. Discard-marker/restore-audit ownership remains on the original files. The shared crash-helper pin is unchanged. Review's minor stale private-symbol JSDoc link was replaced by a plain reference to `flowchart-run.ts`; no runtime statement changed.

## Exact commands and outcomes

All raw output filenames below are under `.agent_workspace/continuous-quality/`.

| Command | Outcome | Output |
|---|---|---|
| `node scripts/run-tests.mjs test/unit/run/replay.test.ts test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/unit/run/flowchart-applyretry-absence.test.ts test/integration/m2.5/resume.test.ts` | Baseline **PASS**, 84 tests / 84 pass / 0 fail / 0 skip | `flowchart-terminal-baseline.log` |
| Same command after extraction and source-owner pin update | **PASS**, 84 / 84 / 0 / 0 | `flowchart-terminal-extraction.log` |
| `node scripts/run-tests.mjs test/unit/run/flowchart-terminal.test.ts` | **PASS**, seven direct tests / 0 fail / 0 skip | `flowchart-terminal-boundary.log` |
| `node node_modules/typescript/bin/tsc --noEmit` | **PASS** | `flowchart-terminal-typecheck.log` |
| `node node_modules/eslint/bin/eslint.js src/run/flowchart-run.ts src/run/flowchart-terminal.ts test/unit/run/flowchart-terminal.test.ts test/unit/run/replay.test.ts test/unit/run/flowchart-applyretry-absence.test.ts` | **PASS** | `flowchart-terminal-lint.log` |
| `node scripts/workflow-check.mjs` | **PASS**, 10 required files / 16 required headings | `flowchart-terminal-workflow.log` |
| `git diff --check` | **PASS** | no diagnostic output |

Final focused command: `node scripts/run-tests.mjs test/unit/run/flowchart-terminal.test.ts test/unit/run/flowchart-child-recovery.test.ts test/unit/run/replay.test.ts test/unit/run/flowchart-run-abort.test.ts test/unit/run/flowchart-checkpoint.test.ts test/unit/run/terminal-replay-statuses-freeze.test.ts test/unit/run/flowchart-applyretry-absence.test.ts test/unit/run/gate-outcome.test.ts test/unit/run/gate-status-posture.test.ts test/unit/tracking/independent-evidence-posture.test.ts test/integration/m2.5/resume.test.ts test/integration/run/unblock-flow.test.ts`: **PASS**, 138 tests / 138 pass / 0 fail / 0 skip, output `flowchart-terminal-focused-final.log`. This includes new boundary tests, prior recovery tests, terminal/absence/owner pins, full gate outcomes and ordinary/discard unblock integration.

## Review, limits and handoff

Independent agent review inspected the module, call sites, source pins and dependency direction, reported no runtime/import-cycle finding, and requested the resolved minor documentation owner-reference correction. Final independent disposition, full literal `pnpm gate`, probes, hosted checks and publication belong to root's integration record.

This slice changes no locks, event schemas, status vocabulary, checkpoint/replay cursor handling, failure reason, cancellation ownership or acceptance/cost semantics. The terminal check/append sequence remains protected by the caller's existing writer scope; the extracted module does not make it independently transactional. Crash/resume redesign, result adoption, monetary settlement, live providers and production/outcome gates remain out of scope. R10/R11, S0-min and F6/F-PROD remain unchanged.

## Coordinator delivery check (2026-10-15)

Independent final source review: **PASS**, no unresolved findings. Its actual
focused command ran 96 pass / 0 fail / 0 skip, separately from the implementation
agent's 138-pass set. Both overlap the complete suite.

The frozen combined recovery/terminal source passed actual pinned `pnpm gate`:
workflow, TypeScript, ESLint, **3,329 total / 3,328 pass / 0 fail / 1 opt-in
real-provider skip**, and build. `pnpm security:probe` passed 26, `pnpm pi:probe`
passed four and `pnpm kernel-reuse:probe` passed three. No dependency/configuration
or assertion relaxation was needed. The existing real pnpm 10.17.1 was selected
through the local PATH seam described in the first report; Linux Node 24.19.0.

Raw coordinator outputs: `stage2-gate.log`, `stage2-security.log`,
`stage2-pi.log`, `stage2-kernel.log`. Cross-platform recovery now selects twelve
suites, including the new terminal behavior tests and the moved replay/source
owner pins. Workflow syntax, matrix, file existence and exit-code propagation
checked locally. Actual hosted execution follows source publication.

Next action: publish and verify the second checkpoint, inspect its Ubuntu/Windows
and full CI evidence, and retain the exact revision in PR #61. Further lifecycle
extraction requires its own bounded characterization and plan. The original
Stage 2 queue/action-ledger/native verification work remains separate; integrate
it only after source review and its own gates rather than overwriting drafts.

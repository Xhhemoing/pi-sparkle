# M1-A: direct development task host entry

## Identity

- ID: `TASK-20261017-direct-development-task`.
- Owner: Codex (`m1_entry` implementation; root integration/review).
- State: `ready-for-review` (slice checks passed; integrated gate and independent review remain pending).
- Date opened: 2026-10-17.
- Contract: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [M1 migration](../../architecture-migration.md#3-m1-直接任务可用).

## Problem and scope

The approved framework calls for a direct single-worker development task without a project queue or monetary form. `NativeWriteSession` already owns isolated candidates, host verification, bounded repair, cancellation and retained evidence; the new entry must reuse that authority rather than create another loop.

In scope: experimental `startDevelopmentTask(input)` host function, its usage guide and real Git integration regressions. The function owns one session, snapshots its ordinary top-level inputs, awaits execution, and shuts the session down in `finally` without applying or disposing the returned candidate.

Out of scope: stable package exports, CLI changes, planner/reviewer calls, queue creation, budgets, new stores, automatic source apply, search/patch/context tools, Windows process containment, provider qualification, and closing all M0/M1 gates. Existing host verification and two candidate-scoped coding tools retain their semantics.

## Acceptance criteria

- [x] One scripted worker edits a retained detached candidate, passes host verification, records existing run evidence and leaves source bytes/Git status unchanged without a queue input.
- [x] Opt-in bounded repair uses the same candidate and host feedback; no second task authority is created.
- [x] In-flight cancellation does not accept the candidate and retains available evidence.
- [x] Invalid limits or dirty source are refused before factory execution.
- [x] Caller mutation after dispatch cannot redirect state roots or host verification.
- [x] Unsettled verification remains `effectsSettled: false`, is never accepted/retried and keeps candidate/artifact after wrapper shutdown.
- [x] Usage identifies the entry as an experimental deep module import and lists retained evidence and remaining boundaries.

## Implementation slice

| File / symbol | Change | Risk / dependency |
|---|---|---|
| `src/development/start-task.ts` / `startDevelopmentTask` | Thin function composing existing session input/options and lifecycle | Must return original result and propagate preflight failures |
| `test/integration/development/start-task.test.ts` | Real temporary Git repositories and scripted executors | No paid provider calls; source cannot be execution target |
| `docs/direct-development-task.md` | Host usage, required verification, lifecycle and limits | No stable SDK or full M1 completion claim |

## Test-first plan

Write the direct successful-task integration case before the module exists; run it and record the intended missing-module RED. Then implement the thin function and add focused lifecycle/repair/negative regressions. Existing native session tests are neighboring acceptance evidence, not rewritten here.

- Focused command: `pnpm test -- test/integration/development/start-task.test.ts`.
- Neighbors: `pnpm test -- test/integration/native/write-session.test.ts test/integration/native/write-loop.test.ts test/integration/development/process-ownership.test.ts`; held for the root integrated run to avoid overlapping process-sensitive suites.
- Integration gate: root runs `pnpm gate`, security/Pi probes and shared final review after all disjoint slices land.
- Negative/recovery cases: failed verification/repair, abort, dirty source, invalid limits, input mutation and unsettled checker exit.

## Gates and handoff

No new human approval is required for implementation or authorized source pushes. Main merge, paid provider execution, production apply and experimental/outcome gates retain their existing separate conditions. Abort this slice if the thin wrapper requires changing session authority or persistent schemas. Rollback removes the new entry and guide; existing session behavior and retained artifacts remain usable.

Root owns shared task/status updates and commits/pushes. Exact commands, results and open follow-ups will be recorded below before handoff.

## Closeout

- Verified date: 2026-10-17; uncommitted disjoint slice on the integration branch.
- RED: `node scripts/run-tests.mjs test/integration/development/start-task.test.ts` exited 1 with `ERR_MODULE_NOT_FOUND` for the absent `src/development/start-task.js`, before implementation.
- GREEN: `node scripts/run-tests.mjs --test-concurrency=1 test/integration/development/start-task.test.ts` exited 0: 6 tests, 6 pass, 0 fail, 0 skipped (Node 24.19.0; 1.288 seconds). The unsettled test uses a host-declared exit-code policy, not an OS containment claim.
- Static checks: `node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js src/development/start-task.ts test/integration/development/start-task.test.ts` exited 0.
- Usage: [direct host entry guide](../../direct-development-task.md).
- Raw test output was observed in this work session; this tracked task record is the durable command/outcome summary, not an independent review.
- Shared gate / independent review: root integration, pending.
- Open follow-ups: controlled list/search/range/patch tools and task-local context selection; qualified Windows process lifecycle; stable SDK/packaged-consumer verification.

# Framework map and host development recipe limits

## Identity

- Task: `TASK-20261016-development-recipe-limits`
- Date/environment: 2026-10-16; Linux; Node 24.19.0; project-pinned pnpm 10.17.1 selected through a session-local PATH entry.
- Owner/verifier: Codex author. No independent review of this delta is claimed.
- Source baseline: PR #60 `167a5404bcf7ca7fdf4abcc2b9e78c7f7e0bb53c`, exact tree `d6d0eaaa1ba311309f84fb5a3212628ddf572bf2`; main `44db4b15078ccce9b1c191d29fec438af044a95c`.
- [Plan](../superpowers/plans/2026-10-16-development-recipe-limits.md), [current framework](../framework.md), [usage](../development-agent-loop.md), [active checklist](../../tasks/todo.md).

## Problem and changed behavior

A passing development checker that printed more than 2048 bytes was treated as unavailable; a checker taking over 5000 ms was terminated even with time available in the outer check window. WorkItemRecipe now supports optional host-owned `timeoutMs`, `maxStdoutBytes`, and `maxStderrBytes`. Omitted values preserve 5000 ms/2048-byte defaults and the exact legacy serialized shape. Timeouts are positive safe integers up to 40000 ms and effective deadlines sum to at most 40000 ms per task; each stream cap is a positive safe integer up to 1048576 bytes.

The complete recipe set is validated, copied and deeply frozen synchronously before the first command. Invalid later definitions cannot cause earlier commands to execute. Caller mutation while an earlier checker runs cannot change a later command or cap. The shared validator is included in trusted checker file snapshots in the controller, integration fixture and built SDK example. Timeout/output/spawn failures still return unavailable; normal exit 1 stays functional repair feedback. No source application behavior or frozen run/event contract changed.

The framework guide maps actual entry points and module responsibilities, distinguishes main/#60/#61, and orders remaining work. The development guide's stale claim that trusted SDK apply was still future work is corrected against the already implemented TA slice. Original stage-one reports remain historical evidence.

## Commands and evidence

| Command | Result | Evidence |
|---|---|---|
| Original `node --import tsx --test test/unit/development/work-items.test.ts` | PASS 7/7 | Unchanged baseline tests before new regressions |
| New focused regression command before implementation | RED: 15 total, 7 pass, 8 fail | Actual fixed 2-KiB/5-second caps, unknown schema fields, late invalid recipe and caller mutation reproduced |
| `node --import tsx --test --test-concurrency=1 test/unit/development/work-items.test.ts test/integration/development/recipe-limits.test.ts test/integration/development/controller.test.ts test/integration/development/source-integration.test.ts test/integration/development/candidate-review.test.ts` | PASS 52/52, 0 fail/skip | Real processes and temporary real Git repositories; 51.30 s |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS after correcting the new test's assertion overload | Initial typecheck correctly rejected `assert.throws(..., undefined, ...)`; corrected before delivery |
| `node node_modules/eslint/bin/eslint.js .` | PASS | Current source/tests/examples |
| `pnpm gate` with pnpm 10.17.1 on PATH | RUNNING | Final result to be recorded before delivery |
| Security/Pi probes and built integration demo | NOT RUN yet | Required after build |
| GitHub checkpoint / current hosted CI | NOT RUN yet | Publish after local gate and final diff review |

New tests execute a checker for more than five seconds, permit 3072 bytes on both streams under a 4096-byte cap, preserve default overflow/explicit timeout stops, and distinguish normal failure from spawn failure. A sentinel verifies execution-before-validation and mutation cannot occur. The real Git test runs a candidate, reads bound historical review, explicitly accepts it using the same host limits, checks action/queue definition equality and confirms the original source file/revision/status remain unchanged.

Temporary raw logs are under `.agent_workspace/recipe-limits/`; tracked evidence is this report and the source tests. The initial managed pnpm 11.25.0 install materialized dependencies but returned `ERR_PNPM_IGNORED_BUILDS`; its automatically inserted workspace-policy placeholders were removed. No new dependency build permission or lockfile change was introduced. The pinned pnpm was then used directly for checks; it is session-local tooling, not a repository dependency.

## Risks and gates

New optional fields require an updated reader; older readers reject them. A 40000 ms aggregate deadline leaves room inside the inherited 60000 ms checker window, but does not promise an end-to-end deadline, arbitrary long full-suite checks, process sandboxing, or a dollar ceiling. Output retention remains bounded excerpts; increasing a command cap does not persist its full output. No hash/integrity primitive was introduced (ADR-008 unchanged).

This records author implementation and command verification. Independent review of the delta, main merge, release, shared root budget reservation/settlement, actual-state recovery of unknown effects, live-model effectiveness, production/R10/R11 and F6 remain open under their own conditions. There were no live model calls, model/credential changes, automatic accept/apply or PR #61 integration.

## Handoff

After the current local/hosted checks, review this delta on PR #60. Then reconcile #60 and #61 before integrating. The next implementation priority is the shared root budget lifecycle with cancellation, duplicate settlement and crash-reconciliation tests; see [framework priorities](../framework.md#5-下一步顺序).

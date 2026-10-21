# P3 controlled-driver settlement combinations

> For agentic workers: use subagent-driven-development for this single test slice and independent specification then quality review.

## Identity

- ID: TASK-20261021-controlled-combinations
- Owner: root coordinates, records and serializes validation; p1_tools_builder owns test implementation; independent spec/quality reviewers.
- State: accepted locally; bounded instrumented test coverage.
- Date opened: 2026-10-21 America/Los_Angeles.
- Source prerequisite: requested P1/P2 commit 683c620a417c10fcc45771bd0a3c2e0746aacd60; clean worktree confirmed before P3.
- Authority: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [approved P3 sequence](2026-10-20-sync-next.md), [managed runtime guide](../../managed-pi.md).

## Problem and Scope

### Problem

Qualification exercises held tools and asynchronous agent_end listeners in its faux harness. Existing real driver tests cover held HTTP cancellation and retained generation selection, but do not compose actual tool/listener waiting with fixed driver-entry, CLI, PiAgentExecutor and the real copied Agent. A driver must not give the host settled evidence while that owned operation is still pending.

### In scope

Add two controlled offline loopback integration scenarios to the existing serial driver suite: abort while a real Agent tool ignores cancellation until explicit release; hold a real Agent's asynchronous agent_end listener, request cancellation, then release it. Observe entry, abort and release through test-only filesystem signals, not driver IPC. Assert actual current event state, provider wire counts and driver result before and after release. Preserve existing old-run A/new-root B resume checks and require both new cases to retain selected engine binding.

The fixed production driver accepts no arbitrary tool/listener injection. The test may instrument only its private staged candidate's copied pi-executor.js at an asserted unique actual Agent-construction seam, keeping the real Agent, kernel, CLI, driver-entry and settlement implementation. Use a dedicated test helper/fixture inside that candidate; restore original bytes and remove fixture in finally after the child settles. Never modify workspace src/dist, add a production hook, bypass import isolation or add extra IPC messages. This is explicitly instrumented composition coverage, not requalification of an unchanged generation or proof against a hostile candidate.

### Out of scope

No public managed selector, OS/Windows descendant containment, malicious-code sandbox, real provider, paid call, network beyond loopback, crash/benchmark/holdout, dependency/lock updates, new hash/baseline/contract/gate, P4/P5, remote push or release. Runtime fixes are initially out of scope; an actual product failure must be retained and diagnosed before root assigns the smallest correction.

## Acceptance Criteria

- [x] Actual fixed driver -> copied CLI -> PiAgentExecutor -> real Agent invokes the held tool from a loopback tool response. Explicit entry then observed abort are required; while held, driver remains pending, no settled handoff or terminal run outcome is recorded, and provider dispatch count does not grow.
- [x] Actual Agent's deferred agent_end listener stays pending before and after cancellation until explicit release; driver cannot report settlement while held and cancellation causes no further provider request.
- [x] On release each case settles once with cancelled/application-settled and stopped receipt, owned operation finishes exactly once, relevant run/child terminal records occur at most once and expected terminal outcome is asserted. Selected generation and child bindings remain correct; existing resume A/new-root B test passes.
- [x] Deterministic entry/abort/release observations, bounded waits, and finally cleanup leave no hanging child/server or modified candidate bytes. Assertions do not rely only on fixed sleeps or synthetic receipt fabrication.
- [x] Focused serial driver+qualification checks, typecheck/lint, independent specification/quality reviews, existing full gate and security/Pi probes pass. All failures, skips and limits recorded; existing test timeouts/assertions are not weakened.
- [x] Guide, status, active checklist and verification record identify actual composition evidence and still-open containment/platform boundaries.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| test/integration/pi-adapter/managed-driver.test.ts | Two actual combination scenarios; reuse A/B build/staging and existing resume tests | single test writer | Shared copied candidate must be restored between serial subtests |
| test/helpers/managed-driver-settlement-fixture.ts | Bounded private fixture setup/observations/cleanup; optional dedicated fixture file only if necessary | same writer | Actual Agent preserved, no production hook or extra IPC |
| docs/managed-pi.md, docs/status-matrix.md, tasks/plan.md, tasks/todo.md, tasks/migration-todo.md, route plan and this report/plan | Evidence, scope and next conditions | root | Do not rewrite old stage evidence |

## Test-First Plan

1. Implement assertions against existing behavior first. This is coverage work: a first-run PASS is new coverage, not a fabricated RED. If behavior fails, preserve the original failing command and distinguish a fixture mistake from a product defect.
2. Root runs pnpm test --test-concurrency=1 test/integration/pi-adapter/managed-driver.test.ts test/integration/pi-adapter/managed-qualification.test.ts. Both files perform fresh builds and must run serially; no other build/gate overlaps.
3. pnpm typecheck and targeted pnpm exec eslint on the changed test/helper paths.
4. Independent specification reviewer reads actual diff/assertions first, then implementation report. After spec passes, independent quality reviewer checks race/cleanup/negative assertions. Correct and reverify concrete findings.
5. Root alone runs existing pnpm gate with serial test execution, then pnpm security:probe and pnpm pi:probe. No new repository gate. Final pnpm workflow:check and git diff --check after docs reconcile.

## Gates and Handoff

- User authorized current commit then P3; requested commit completed before P3 edits. Use existing continuation checkout; no reset/stash or unrelated changes.
- Builder must not run internal full builds or install dependencies; root schedules the focused integration command. No concurrent writes to shared test/helper paths.
- Stop unsafe fixture progression if entry/abort/release cannot be observed or a child remains owned; release then await bounded shutdown before restoring files. Report unresolved effects rather than relabeling them settled.
- Records: [verification](../../reports/2026-10-21-controlled-combinations.md); raw logs under .agent_workspace/p3-controlled-combinations-20261021/.
- Next action: P3 implementation and verification are complete. P4/P5 require their own precise plans; no broader implementation or platform acceptance follows.

## Closeout

- Verified source/date: 683c620a plus reviewed P3 test/documentation delta, 2026-10-21; Windows Node24.18.0, pnpm10.17.1, Pi0.86.1.
- Commands and outcomes: focused34/34, independent spec/quality reviews, gate3997/0/48 conditional skips plus build, security26/Pi4. [Exact final evidence](../../reports/2026-10-21-controlled-combinations.md#final-local-acceptance-2026-10-21).
- Open risks: public containment and additional OS/Node qualification remain separate; instrumented cooperative tests do not establish hostile integrity.

- Retained observation: one earlier missing-aborted timeout has no confirmed cause; diagnostic, final focused and full gate passed. Retained error/signal/result diagnostics govern any recurrence, as recorded in the final evidence.

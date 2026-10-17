# Framework migration: independent source review

## Identity and scope

- Date: 2026-10-17 UTC; Linux, Node `v24.19.0`.
- Reviewer: source-disjoint `migration_review` agent; no implementation files authored.
- Contract: [ADR-009](../decisions/0009-lightweight-adaptive-framework.md) and the
  [current integration plan](../superpowers/plans/2026-10-17-framework-migration.md).
- Diff baseline: local `778b235`, whose restored M0-A tree is the same as published
  `e6f6a5b`.
- Reviewed source checkpoint: `9089a5458978407921e21cf580044f52cff97573`,
  tree `a5a80479eeadb4467864d5bb720f1e6e1e450744`.
- Disposition: **PASS for the bounded source review after R1 was resolved**.

Review covers the M0-B admission/readiness changes, the thin M1-A task entry,
M2-A module moves/compatibility/privacy guards and their regression assertions.
This is source review and the explicitly listed independent command evidence;
author test results and the integration owner's full gate remain separate.

## Findings

| ID | Finding and practical effect | Resolution / regression |
|---|---|---|
| R1 | The initial `unresolvedEffect` legacy-binding parser rejected traversal but still accepted glob characters, colon, `.git` paths, NUL, whitespace-only and overlength scopes. Such a malformed running/uncertain binding could be treated as disjoint from current work rather than retaining the conservative ownership fence. | Author changed the parser to use the existing `workItemScope` grammar and a 1–32 scope bound. Eight real-controller malformed-binding cases assert reconciliation, zero factory dispatches and no new rows. Source correction reviewed; the author's final serial controller/process run passed 49/49. Its partial RED log is disclosed separately in the [M0 author record](2026-10-17-m0-atomic-admission.md). |

No remaining correctness blocker was found for the bounded M0-B, M1-A and M2-A
source after R1's correction. Integrated command verification is owned by the
integration agent; this source review does not accept the whole migration.

## Reviewed contracts

M0-B checks conflicts and publishes a running record within one existing
`ActionStore.update` transaction for both checker and writer admission. Effects
execute after that lock is released. Rejected attempts add no rows; immutable
idempotency, durable running/uncertain fences and existing settlement claims
remain in force. Readiness verifies accepted ancestors and overlapping accepted
scopes, skips only host-classified availability conflicts and propagates invalid
evidence or caller cancellation. The review included real-controller overlapping
checker and checker/writer races, accepted-A/disjoint-B wiring, malformed legacy
bindings and existing cancellation/retained-view assertions. The old separate
prepare/claim cancellation test seams were replaced by atomic admission without
weakening their no-dispatch and uncertain-ownership requirements.

M2-A's moved catalog and state-layout implementations were independently compared
with `git show 778b235:<old-path>` and matched byte for byte. The compatibility
paths re-export the original functions and error class, preserving identity.
The `main`/`pref` value cycle is removed through shared options; native and track
catalog consumers no longer import CLI. Dynamic Pi resolution stays lazy, paths
remain identical, and privacy guards classify the new runtime catalog path
without expanding any allowlist.

M1-A creates one existing `NativeWriteSession`, returns its original result and
awaits shutdown in `finally`. Ordinary root/factory options are captured before
dispatch; existing synchronous preflight snapshots verification, criteria and
loop limits before the first asynchronous allocation. Shutdown retains returned
candidates and artifacts. The direct path adds no queue, planner/reviewer call,
budget form, persistent success state or automatic application. The usage guide
accurately identifies the experimental deep import and inherited host executor,
cancellation, checker and process-containment boundaries.

## Independent commands

| Command / inspection | Outcome |
|---|---|
| Byte comparison of old catalog/layout at `778b235` against new canonical files | Both equal |
| `node scripts/run-tests.mjs --test-concurrency=1 test/unit/architecture test/unit/privacy/plane-boundary.test.ts test/unit/privacy/adaptation-plane-closure.test.ts test/unit/routing/live-isolation.test.ts test/unit/pi-boundary.test.ts` | 36 pass / 0 fail / 0 skip; 3.44 seconds |
| `git diff --check` during source review | PASS |
| M1-A six real-Git tests, M0-B focused suites, full gate and probes | Author/integration evidence; not rerun or claimed as reviewer-owned here |

## Remaining boundaries and handoff

This review does not qualify Windows/OS containment, old-writer isolation,
generic command-tool uncertainty, terminal-ledger archival, stable SDK, paid
providers, main merge or existing policy/production gates. Scoped readiness
specifically addresses freshness verification of accepted ancestors/overlaps;
it does not claim starvation-free selection after an operator releases a planned
item whose own effect still needs reconciliation.

The final checkpoint's six CI additions include the new focused admission,
readiness, direct-task and boundary tests in the existing serial Linux/Windows
development group. This is CI wiring review, not evidence that a hosted or
Windows run has executed. `git diff --exit-code 9089a5458978407921e21cf580044f52cff97573 -- src test .github`
confirmed no runtime/test/CI drift after reviewing that checkpoint.

Review report is an evidence file added after source review and does not itself
change runtime behavior. The integration owner records final gate/probes and
publication in the [delivery record](2026-10-17-framework-migration.md).

## Parallel documentation preservation

After remote documentation commit `cd3aaab29b709c8e8ad92f05d7a6abfdf40d7ae6`
arrived, the reviewer independently compared its two architecture HTML files,
dated download-fix report and plan with the integrated working files: all four
match byte for byte. Both additive task summary bodies are retained exactly
beside the migration entries. The parallel commit changes no runtime, tests or
CI; the current runtime/test/CI files still match reviewed `9089a54`. All 471
local file links in the changed Markdown resolve, and the diff whitespace check
passes. This is preservation and documentation consistency verification; browser
behavior evidence remains the separate documentation author's report.

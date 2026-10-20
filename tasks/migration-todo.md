# Current framework migration

Authority: [ADR-009](../docs/decisions/0009-lightweight-adaptive-framework.md).
Design: [M0–M7 plan](../docs/architecture-migration.md).
Current delivery: [2026-10-17 integration plan](../docs/superpowers/plans/2026-10-17-framework-migration.md).
Evidence: [dated verification](../docs/reports/2026-10-17-framework-migration.md).

This checklist tracks bounded implementation slices. Passing a slice does not
accept its entire M-number or any production/live/experimental gate.

| Slice | State | Evidence / next condition |
|---|---|---|
| M0-A cooperative process ownership | Published on PR #60 | `e6f6a5b`, exact tested tree `73e74bc2`; [original evidence](../docs/reports/2026-10-16-process-ownership.md) and current publication record |
| M0-B atomic effect admission and scoped readiness | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-m0-atomic-admission.md); existing ledger/store, schema unchanged; 49 real controller/process and 61 final adjacent tests pass |
| M0-C host-wired generic command uncertainty | Independently reviewed; final integrated gate pending | [Evidence](../docs/reports/2026-10-19-command-uncertainty.md); focused 23/23 and probes pass; fresh gate 3646/1/48, Windows fixture cleanup corrected and independently reviewed |
| M1-A direct task host entry | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-direct-development-task.md); one existing native session; six real Git tests pass |
| M1-B candidate file tools | Source reviewed / local gate verified | [Plan](../docs/superpowers/plans/2026-10-18-direction-completion.md): bounded list/search/range/unique patch, host-neutral implementation and direct-task wiring |
| M1-C task-local context | Independently reviewed / focused verified | [Evidence](../docs/reports/2026-10-19-staged-continuation.md): integrated 57/57, prior adjacent 142 pass / 1 Windows skip, 2/2 opted-in synthetic provider smoke; final full gate pending |
| M2-A boundary cleanup | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-m2-boundary-cleanup.md); 98/98 focused, no new allowlist exceptions |
| M2-B narrow SDK and lazy contributions | Independently reviewed / packed verified | [SDK](../docs/sdk.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): 32/32 integrated, two actual packed consumers, legacy paths; final full gate pending |
| M3-A trusted check findings | Independently reviewed / focused verified | [Usage](../docs/check-findings.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root 15/15, reviewers each 7/7; single-flight analysis/local correction remain follow-ups |
| C1/C2-A structured conversation host and focus | Source reviewed / local gate verified | [Plan](../docs/superpowers/plans/2026-10-18-conversation-presentation.md), focus/session 17/17; no NL registration or persistent focus |
| M4-A explicit task presentation | Source reviewed / local gate verified | Pure scoped language/detail/format + native/direct profile wiring; adjacent 46/46 |
| M4-B all-outcome usage coverage | Source reviewed / focused verified | [Guide](../docs/usage-coverage.md); root and independent reviews 20/20, full gate pending; routing/preferences remain separate |
| M5 managed Pi | Planned; M0 dependency | Qualified immutable generation and actual stop/settlement evidence |
| M6 project/connector | Planned | Thin controller continuation and bounded external receipts |
| M7 policy optimization | Planned | Attribution, offline/shadow evidence and existing policy gates |

## Current delivery checks

- [x] Recover previous source into an independent checkout; compare the exact
  tree with its saved M0-A evidence and publish with remote readback.
- [x] Restore pinned pnpm 10.17.1 dependencies with the frozen lockfile; preserve
  package metadata, lockfile and dependency build permissions.
- [x] Record focused RED/GREEN for M0-B and M1-A; complete adjacent regressions;
  exact commands and initial failures are in their scoped records and current report.
- [x] M2-A focused compatibility/CLI/native/Pi/privacy run: 98 pass / 0 fail /
  0 skip; command in the dated verification.
- [x] Complete source-disjoint review of `9089a54` and resolve malformed legacy
  scope finding R1; [review record](../docs/reports/2026-10-17-framework-migration-review.md).
- [x] Run integrated pinned `pnpm gate`: 3630 pass / 0 fail / 2 skip, build PASS;
  security 26 / Pi 4 / kernel 3 PASS. Initial focused failures and skips are
  preserved in the dated records.
- [x] Publish source `51cf50d` and evidence `20383c2` to existing PR #60 with
  expected-head fast-forward updates and exact remote tree readback; retain
  parallel architecture documentation `cd3aaab`. This receipt is documentation only.

## Open conditions

Full M0 retains OS escape/Windows containment qualification, old-writer
isolation, generic command-tool uncertainty and bounded terminal-ledger archival.
Successful checker rechecks still consume the existing finite ledger capacity;
no unknown effects are deleted or made replayable. New binaries must not share
effect roots with old controllers using the previous admission algorithm.
Scoped readiness covers unrelated accepted-task verification; selecting around
a planned high-priority item's own unresolved effect remains a separate follow-up.

Main/PR #61 integration, stable SDK, root shared budgets, real-provider benefit,
S0-min/R10/R11/F6 and production/experimental acceptance retain their own records.
Next implementation priorities are the remaining M1 task-context slice and C1/C2
conversation/focus wiring; M1-B file tools have current source/gate evidence. Full
M0 containment work is required before expanding process backends or overlapping
writers.

## Generic command-tool uncertainty (2026-10-19)

`TASK-20261019-command-uncertainty`: [plan](../docs/superpowers/plans/2026-10-19-command-uncertainty.md) · [verification](../docs/reports/2026-10-19-command-uncertainty.md). Source independently reviewed; focused 23/23, build, security 26 and Pi 4 pass. Fresh full gate: 3646 pass / 1 fixture-cleanup failure / 48 skip. Windows EPERM cleanup failure reproduced and corrected with bounded retries; full affected file 25 pass / 0 fail / 2 platform skips. A local checkpoint preserves this work; final integrated gate remains pending. Host command tools must forward the callback; full containment, arbitrary host effects, publication and production acceptance remain separate.
- [x] 2026-10-19: Real RED/GREEN, final 23/23, typecheck/lint/build and security/Pi probes recorded in the linked evidence.
- [x] Independent specification and code-quality source reviews passed; dated continuation evidence linked above.
- [ ] Root coordinator: rerun final integrated full gate after reviewed slices; current full run had one corrected Windows fixture-cleanup failure, not a passing gate.

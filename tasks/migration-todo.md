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
| M1-A direct task host entry | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-direct-development-task.md); one existing native session; six real Git tests pass |
| M1 remaining tools/context | Planned | Scope-aware list/search/range/patch and task-local CodeMap selection |
| M2-A boundary cleanup | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-m2-boundary-cleanup.md); 98/98 focused, no new allowlist exceptions |
| M2 narrow SDK and lazy contributions | Planned | Packed external consumers and activation/generation contract |
| M3 findings/local correction | Planned | Revision-bound read-only observations before automatic repair |
| M4 routing/usage/preferences | Planned | Independent increments; strict budget admission remains optional |
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
Next implementation priority after this delivery is the remaining M1 tool/context
slice, with full M0 containment work required before expanding process backends
or overlapping writers.

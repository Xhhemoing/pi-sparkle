# Current framework migration

Authority: [ADR-009](../docs/decisions/0009-lightweight-adaptive-framework.md).
Design: [M0–M7 plan](../docs/architecture-migration.md).
Current delivery: [2026-10-17 integration plan](../docs/superpowers/plans/2026-10-17-framework-migration.md).
Evidence: [dated verification](../docs/reports/2026-10-17-framework-migration.md).

This checklist tracks bounded implementation slices. Passing a slice does not
accept its entire M-number or any production/live/experimental gate.

**2026-10-20 current cloud correction:** `d6a3032a` actual Linux Node24 gate exits 1 before tests (`tsc` unavailable). Dependency bootstrap is blocked by automatic approval for unknown telemetry egress; offline cache is incomplete. Node22 runtime is installed but not verified against the product. Cloud Linux gate/probes/pack/SDK and C1/C2 tool wiring/C3 remain open. [Evidence and exact unblock/next command](../docs/reports/2026-10-20-cloud-validation.md). The separate local Windows acceptance below is not cloud Linux acceptance.

2026-10-20 final local evidence for runtime3d3dcdc5: gate3978 pass/0 fail/48 conditional skips + build; security26/Pi4/kernel3 and two actual packed consumers PASS. [Commands/reviews/limits](../docs/reports/2026-10-19-staged-continuation.md#final-local-acceptance-2026-10-20). Platform, public execution and later conversation/repair work remain separate.

| Slice | State | Evidence / next condition |
|---|---|---|
| M0-A cooperative process ownership | Published on PR #60 | `e6f6a5b`, exact tested tree `73e74bc2`; [original evidence](../docs/reports/2026-10-16-process-ownership.md) and current publication record |
| M0-B atomic effect admission and scoped readiness | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-m0-atomic-admission.md); existing ledger/store, schema unchanged; 49 real controller/process and 61 final adjacent tests pass |
| M0-D planned-item scoped readiness | Independently reviewed / locally verified | [Evidence](../docs/reports/2026-10-19-staged-continuation.md): root22/22, independent quality68/68 plus2 lock/cancellation probes; final local gate/probes passed |
| M0-C host-wired generic command uncertainty | Independently reviewed / locally verified | [Evidence](../docs/reports/2026-10-19-command-uncertainty.md); focused 23/23 and probes pass; fresh gate 3646/1/48, Windows fixture cleanup corrected and independently reviewed |
| M1-A direct task host entry | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-direct-development-task.md); one existing native session; six real Git tests pass |
| M1-B candidate file tools | Source reviewed / local gate verified | [Plan](../docs/superpowers/plans/2026-10-18-direction-completion.md): bounded list/search/range/unique patch, host-neutral implementation and direct-task wiring |
| M1-C task-local context | Independently reviewed / locally verified | [Evidence](../docs/reports/2026-10-19-staged-continuation.md): integrated 57/57, prior adjacent 142 pass / 1 Windows skip, 2/2 opted-in synthetic provider smoke; final local gate/probes passed |
| M2-A boundary cleanup | Reviewed/local gate verified; published source | [Plan](../docs/superpowers/plans/2026-10-17-m2-boundary-cleanup.md); 98/98 focused, no new allowlist exceptions |
| M2-B narrow SDK and lazy contributions | Independently reviewed / packed verified | [SDK](../docs/sdk.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): 32/32 integrated, two actual packed consumers, legacy paths; final local gate/probes passed |
| M3-A trusted check findings | Independently reviewed / locally verified | [Usage](../docs/check-findings.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root 15/15, reviewers each 7/7; optional analysis has the separate reviewed row below; automatic correction remains separate |
| M3-B optional finding analysis | Independently reviewed / locally verified | [Usage](../docs/check-findings.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root26/26, independent spec/quality27/27 each, architecture11/11; supported-Promise lifecycle, final local gate/probes passed |
| C1/C2-A structured conversation host and focus | Source reviewed / local gate verified | [Plan](../docs/superpowers/plans/2026-10-18-conversation-presentation.md), focus/session 17/17; no NL registration or persistent focus |
| M4-A explicit task presentation | Source reviewed / local gate verified | Pure scoped language/detail/format + native/direct profile wiring; adjacent 46/46 |
| M4-B all-outcome usage coverage | Independently reviewed / locally verified | [Guide](../docs/usage-coverage.md); root and independent reviews 20/20, final local gate/probes passed; routing/preferences remain separate |
| M4-C deleted preference replay | Independently reviewed / locally verified | [Evidence](../docs/reports/2026-10-19-staged-continuation.md): root45/45, spec36+9 and quality45 plus128 snapshot combinations; final local gate/probes passed |
| M5-A isolated Pi candidates | Independently reviewed / locally verified | [Guide](../docs/managed-pi.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root/spec19/19, quality17/17 plus independent boundary/lifecycle probes; final local gate/probes passed |
| M5-B actual staged Pi qualification | Independently reviewed / locally verified | [Guide](../docs/managed-pi.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root/spec/quality20/20 each; five actual offline scenarios, private issuance, final local gate/probes passed |
| M5-C retained qualified selection | Independently reviewed / locally verified | [Guide](../docs/managed-pi.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): root/spec/quality17/17 each; author A/B/C52/52; locked publication and retained lookup; final local gate/probes passed |
| M5-D1 durable engine binding | Independently reviewed / locally verified | [Evidence](../docs/reports/2026-10-19-staged-continuation.md): root36/36, independent154 pass/1 Windows skip; original event identity retained across resume/children; final local gate/probes passed |
| M5-D2 controlled Pi driver | Independently reviewed / locally verified | [Guide](../docs/managed-pi.md): root104/104 adjacent and14/14 actual process tests after cancellation repair; independent63/63 plus5 filesystem-window probes; internal controlled offline path, final local gate/probes passed |
| M6-B read-only GitHub drafts | Independently reviewed / locally verified | [Guide](../docs/github-drafts.md), [evidence](../docs/reports/2026-10-19-staged-continuation.md): author/root/reviewer22/22; current-fact drafts and finite transport receipts only; no remote write/activation, final local gate/probes passed |
| M6-A project continuation | Independently reviewed / locally verified | [Guide](../docs/advance-project.md); root 10/10, spec 10/10, quality 13/13; final local gate/probes passed; connector limited to read-only drafts |
| M7-C offline preparation | Independently reviewed / locally verified | [Usage](../docs/host-attribution.md); integrated28/28, independent spec/quality PASS; original-only observations and genuine spend, task-disjoint split; final local gate/probes passed |
| M7-B actual host publisher | Independently reviewed / locally verified | [Usage](../docs/host-attribution.md); integrated20/20, independent spec/quality PASS; corrected opt-in smoke proves unknown-version exclusion, earlier failures retained; final local gate/probes passed |
| M7-A replay correctness | Independently reviewed / locally verified | [Plan](../docs/superpowers/plans/2026-10-19-host-attribution.md); 54 pass / 1 Windows skip; host publisher/offline work and policy gates remain separate |

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

Full M0 retains OS escape/Windows containment qualification and arbitrary old-writer isolation. Scoped generic command uncertainty and fresh-ledger completed-check archival are implemented and independently reviewed; final integrated gate/probes passed.
Successful checker rechecks still consume the existing finite ledger capacity;
no unknown effects are deleted or made replayable. New binaries must not share
effect roots with old controllers using the previous admission algorithm.
Scoped readiness now also selects around a planned high-priority item's unresolved
effect: independent focused verification passes; final integrated gate/probes passed.

Main/PR #61 integration, stable SDK, root shared budgets, real-provider benefit,
S0-min/R10/R11/F6 and production/experimental acceptance retain their own records.
Managed Pi A/B/C/D1/D2, read-only GitHub drafts and fresh-ledger archival are now implemented and independently reviewed. Final integrated gate/probes and actual packed consumers passed; this bounded local delivery is complete. Task context, conversation/focus and file tools have their separately recorded evidence. Full
M0 containment work is required before expanding process backends or overlapping
writers.

## Generic command-tool uncertainty (2026-10-19)

`TASK-20261019-command-uncertainty`: [plan](../docs/superpowers/plans/2026-10-19-command-uncertainty.md) · [verification](../docs/reports/2026-10-19-command-uncertainty.md). Source independently reviewed; focused 23/23, build, security 26 and Pi 4 pass. Fresh full gate: 3646 pass / 1 fixture-cleanup failure / 48 skip. Windows EPERM cleanup failure reproduced and corrected with bounded retries; full affected file 25 pass / 0 fail / 2 platform skips. A local checkpoint preserves this work; final integrated gate/probes passed. Host command tools must forward the callback; full containment, arbitrary host effects, publication and production acceptance remain separate.
- [x] 2026-10-19: Real RED/GREEN, final 23/23, typecheck/lint/build and security/Pi probes recorded in the linked evidence.
- [x] Independent specification and code-quality source reviews passed; dated continuation evidence linked above.
- [x] 2026-10-20 root final pinned gate:3978 pass/0 fail/48 conditional skips, build PASS; security26/Pi4/kernel3 and two actual packed consumers PASS. [Final local evidence](../docs/reports/2026-10-19-staged-continuation.md#final-local-acceptance-2026-10-20); prior failures retained.

Fresh-ledger archival (2026-10-20): source reviewed/focused verified; root27 pass/1 existing Windows skip with actual1026 lifecycles, exact historical-source publication probe exit0. Finite opt-in schema2 only; final combined gate/probes passed. [Guide](../docs/check-archive.md) and [evidence](../docs/reports/2026-10-19-staged-continuation.md).

M5-D2 (2026-10-20): controlled driver source reviewed/focused verified; root104/104 adjacent and14/14 actual process tests after R1 cancellation repair, independent63/63 plus5 filesystem probes. Internal controlled offline path only; public real-project managed execution still awaits containment qualification. Final combined gate/probes passed. [Guide](../docs/managed-pi.md).

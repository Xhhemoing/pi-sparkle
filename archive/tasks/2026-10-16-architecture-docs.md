# Completed architecture documentation — 2026-10-16

Archived on 2026-10-17 to keep the active task entry focused on migration.
These are the original dated plan/checklist summaries, with only relative links
adjusted for this directory. Runtime and policy gates were not archived.

## Original plan summaries

### Detailed architecture map and compact navigation (2026-10-16)

`TASK-20261016-detailed-architecture-map` continues from `415b072`. The user
repeated the top-bar removal request, asked for thinner bottom controls and a
very detailed architecture diagram for explanation. The [plan](../superpowers/plans/2026-10-16-detailed-architecture-map.md)
scopes this to the guide layout and a standalone interactive map. Root and HTML
author have separate file ownership; independent reviewers verify architecture
relations and actual UI. [Evidence](../reports/2026-10-16-detailed-architecture-map.md)
records 48 px single-row controls, 32-node/39-edge map and four supplementary
diagrams. Author and independent browser/content review, local references and
the pinned workflow passed. Documentation commit `613bfbf` is published to
existing PR #60 with the exact reviewed tree. No runtime migration or production
gate is changed.

### Architecture explanation and navigation polish (2026-10-16)

`TASK-20261016-architecture-explanation-polish` continues from documentation head
`77dda44`. The user requested simpler switching, removal of the top toolbar and
more detailed explanation of the overall architecture. The
[plan](../superpowers/plans/2026-10-16-architecture-explanation-polish.md)
keeps the accepted design unchanged: chapter controls and local exploration are
separate, with expanded module responsibilities and control/data flow. Scope is
HTML/documentation only. The guide now has 13 chapters with architecture first,
independent local panels and no top toolbar. Author browser checks, independent
review, 270 local references and the pinned workflow check passed; the reading
mode URL mismatch was corrected. [Verification](../reports/2026-10-16-architecture-explanation-polish.md)
records the evidence. Documentation commit `1d9d0b2` is published to existing
PR #60 with the exact reviewed tree; runtime and production gates are unchanged.

### Maintained current architecture and interactive guide (2026-10-16)

`TASK-20261016-current-architecture-guide` is documentation-verified and ready for review from PR #60 checkpoint
`7407674`. The user accepted the lightweight adaptive design and requested project
documentation plus an unversioned, expandable HTML explanation. The
[plan](../superpowers/plans/2026-10-16-current-architecture-guide.md) scopes this
to documentation; runtime migration, Pi upgrades and PR merges are separate.
The [current architecture](../../docs/framework.md), [algorithms](../../docs/architecture-algorithms.md),
[migration](../../docs/architecture-migration.md) and [interactive guide](../../docs/architecture.html)
share the accepted design in [ADR-009](../../docs/decisions/0009-lightweight-adaptive-framework.md).
The [dated report](../reports/2026-10-16-current-architecture-guide.md) records
pinned workflow PASS, 557 valid local references, actual browser checks across
12 chapters/34 manual steps, and independent review PASS after the navigation
race was corrected. Documentation commit `a480d8c` is published to PR #60 with
the exact reviewed tree; runtime migration
starts separately with M0 and no production gate is closed here.

## Original checklist

### Detailed architecture map and compact navigation (2026-10-16)

- [x] Record scope, file ownership and measurable UI/diagram acceptance in the [plan](../superpowers/plans/2026-10-16-detailed-architecture-map.md).
- [x] Remove top-bar leftovers and reduce bottom controls to one thin 48 px row, measured across desktop/mobile.
- [x] Add the 32-node interactive architecture map, 39 relationships, four supplementary diagrams and standalone SVG; link them from the existing explanation.
- [x] Verify real browser behavior and architecture facts; record [evidence](../reports/2026-10-16-detailed-architecture-map.md).
- [x] Publish verified documentation commit `613bfbf` to existing PR #60 without forcing or merging; fetched remote files match the reviewed tree.

### Architecture explanation and navigation polish (2026-10-16)

- [x] 2026-10-16: record the requested HTML refinements and documentation-only boundary in the [plan](../superpowers/plans/2026-10-16-architecture-explanation-polish.md).
- [x] Remove the top toolbar, separate global chapter navigation from local diagrams, and expand the overall architecture and module/data-flow explanation.
- [x] Verify browser behavior, responsive/offline/no-JS/print output, architecture consistency, links and workflow; record [evidence](../reports/2026-10-16-architecture-explanation-polish.md).
- [x] Publish verified documentation commit `1d9d0b2` to existing PR #60 with an expected-head, non-forced update; fetched remote files match the reviewed tree. No runtime or production gate changes.

### Maintained current architecture and interactive guide (2026-10-16)

- [x] 2026-10-16: record the user's accepted design and documentation-only scope in the [task plan](../superpowers/plans/2026-10-16-current-architecture-guide.md); source baseline PR #60 `7407674`, separate main/PR #61 preserved.
- [x] 2026-10-16: write the maintained framework, ten algorithm contracts, bounded migration plan and accepted design ADR; preserve implementation and evidence boundaries. [Verification](../reports/2026-10-16-current-architecture-guide.md).
- [x] 2026-10-16: verify the self-contained HTML's 12 chapters and 34 manual steps, continuous reading, expandable detail, keyboard, reduced motion, mobile, offline and print behavior. [Browser evidence](../reports/2026-10-16-current-architecture-guide.md).
- [x] 2026-10-16: independent review PASS, pinned `pnpm workflow:check` PASS, 557 local links and diff check PASS; corrected the deferred-scroll navigation race. [Dated report](../reports/2026-10-16-current-architecture-guide.md).
- [x] 2026-10-16: publish documentation commit `a480d8c` to existing PR #60; fresh remote head and exact tree match the reviewed files. Publication evidence is in the dated report above. Runtime migration remains separate, starting with nested-process cancellation/settlement (M0).

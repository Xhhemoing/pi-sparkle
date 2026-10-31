# Current architecture and interactive guide

## Identity

- ID: `TASK-20261016-current-architecture-guide`
- Owner: Codex with disjoint documentation, presentation and independent-review agents
- State: `ready-for-review` (documentation and independent review verified; publication tracked separately)
- Date opened: 2026-10-16
- Base: PR #60 source/evidence checkpoint `740767403ef634c9d6f8be7829f8f489be7a68db`; main remains `44db4b1`, PR #61 is separate.
- Owner decision: the user accepted the reviewed lightweight, adaptive architecture and requested that it be written into the project, with a current, unversioned HTML explanation.

## Problem and Scope

The accepted architecture is currently outside the repository and explained as a numbered revision. Contributors need stable current documentation and a clear presentation that can be read or advanced manually.

In scope: current architecture/algorithm/migration documents; an accepted design ADR; one offline, self-contained HTML guide; README and existing documentation entry links; dated verification and active task references. The HTML will distinguish current implementation from accepted design and future migration work without centering a release/revision number.

Out of scope: production runtime refactoring, dependency updates, paid model evaluation, source-application changes, merging PRs, deployment, creating another PPTX, or automatic remote-update promises for a downloaded HTML file.

## Acceptance Criteria

- [x] Stable current architecture entry explains purpose, four responsibilities, light task flow, dynamic repair, Pi compatibility, preference/learning, plugins and project coordination.
- [x] Each algorithm has input/output, selection rule, fallback and acceptance evidence; migration has bounded slices and explicit unimplemented work.
- [x] HTML is usable offline with no CDN, has manual progression and expand/collapse detail, keyboard navigation and reduced-motion support, and works on desktop/mobile.
- [x] No version-branded cover/title or stale current-version promise; implementation/evidence references remain identifiable in a supporting section.
- [x] Existing strict acceptance, ADR-008, Pi boundaries and open reliability/production gates are accurately preserved.
- [x] `pnpm workflow:check`, targeted links/content checks and actual browser interaction/visual checks pass; review findings are resolved.

## Implementation Slice

| Files | Owner | Change |
|---|---|---|
| `docs/framework.md`, `docs/architecture-algorithms.md`, `docs/architecture-migration.md`, `docs/decisions/0009-lightweight-adaptive-framework.md` | architecture docs agent | Current maintained explanation and design decision |
| `docs/architecture.html` | HTML agent | Self-contained manual presentation / expandable reading guide |
| README, legacy quality-entry banners, tasks, status matrix, verification | root | Discoverability, consistent scope/status and delivery |
| All changed docs/HTML (review only) | independent reviewer | Accuracy, overclaim, interaction and accessibility review |

## Test-First Plan

Documentation-only task: no product test or failing runtime regression is required by the workflow. Use browser interaction checks to validate actual guide behavior and targeted link/content checks to validate navigation. Keep temporary browser/validation artifacts under `.agent_workspace/`.

- Focused command: `pnpm workflow:check`.
- Guide checks: chapter/manual-step controls, previous/reset, detail toggle, keyboard navigation, reduced-motion/no-JS readability, mobile overflow, offline requests and browser errors.
- Content checks: changed local Markdown/HTML links, current/target labels, no fixed revision branding, no false claim that migration or paid-provider validation occurred.

## Gates and Handoff

- Design acceptance is authorized by the user's explicit acceptance; this does not accept implementation or close existing production/experimental gates.
- Publish the docs-only commit to the existing PR #60 branch after verification; do not merge main or integrate PR #61.
- Abort publication on unexpected concurrent remote changes; preserve all existing work.
- Rollback: revert this documentation commit; no runtime or persistent schema changes.
- Required records: dated report, active plan/todo, and architecture ADR/status reference.

## Closeout

2026-10-16: [verification report](../../reports/2026-10-16-current-architecture-guide.md)
records the pinned workflow, actual browser/visual checks and independent review
PASS. The deferred-scroll mode-switch race was corrected and independently
rechecked. This closes the documentation acceptance criteria only; publication
is recorded after the normal push, and runtime migration remains separate.

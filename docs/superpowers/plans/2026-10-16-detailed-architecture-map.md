# Detailed architecture map and compact navigation

## Identity

- ID: `TASK-20261016-detailed-architecture-map`.
- Owner: root integrates the guide and delivery; HTML author owns the new map; architecture and interaction reviewers inspect independently.
- State: ready-for-review; documentation verified, publication pending.
- Baseline: PR #60 documentation head `415b072b8be18818be84e87489d00d7d44826bce`.
- User outcome: completely remove top-bar clutter, make the bottom controls thinner, and provide a very detailed architecture diagram for explanation.

## Scope and Acceptance Criteria

- [x] The guide and new map have no horizontal top toolbar or reserved top-bar space; remove obsolete toolbar styles and decorative chapter eyebrows from the guide.
- [x] Guide controls occupy one row, at most 48 px on desktop and 52 px on a 390 px mobile viewport, while chapter and reading controls remain usable. Content remains reachable above the fixed controls.
- [x] Add a standalone offline detailed architecture map with directed, labeled relationships, core boundaries, actual source locations and implementation status; enable node inspection and guided emphasis.
- [x] Explain the task/evidence loop, four fact owners, dynamic observation, model/cost decisions, Pi evolution, plugins, preferences/learning and project coordination with additional detailed views.
- [x] Preserve ADR-009 and actual implementation distinctions; no runtime, schema, dependency or authority change.
- [x] Exercise navigation, node details, deep links, responsive layout, offline/no-JavaScript and print visibility in Chromium; inspect actual screenshots, complete independent content/interaction review, pinned workflow, targeted links and whitespace checks.

## Implementation Slice

- Root: `docs/architecture.html`, framework/README map links if useful, this plan, active tasks and dated report.
- HTML author: `docs/architecture-map.html` and optional reusable diagram export.
- Reviewers: read-only source mapping and independent browser review. Temporary material: `.agent_workspace/architecture-map/`.

## Test-First Plan

Documentation-only exception applies. Measure the old and new footer in the actual browser; verify the changed UI and diagram rather than running runtime tests. Use `corepack pnpm@10.17.1 workflow:check`, the targeted link checker and `git diff --check`.

## Gates and Handoff

Publish verified documentation to existing PR #60 with expected-head/non-forced updates. Do not merge main or PR #61. Runtime and production/outcome gates stay open. Rollback is a documentation revert. Record exact results and publication in `docs/reports/2026-10-16-detailed-architecture-map.md`.

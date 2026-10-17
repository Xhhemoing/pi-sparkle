# Architecture explanation and navigation polish

## Identity

- ID: `TASK-20261016-architecture-explanation-polish`
- Owner: root integration; separate HTML author and architecture/reliability reviewers.
- State: complete; verified documentation published to existing PR #60.
- Base: documentation delivery `77dda44909048c05f3f10af738cacc75606de045` on PR #60.
- User request: simplify chapter switching, remove unnecessary top content, and explain the overall architecture in greater detail.

## Scope and Acceptance Criteria

- [x] Remove the top toolbar; keep chapter navigation and optional reading/motion controls in a compact sidebar or mobile bottom controls.
- [x] Global previous/next controls always switch chapters; local diagrams/steps remain independently selectable, with predictable keyboard and browser navigation.
- [x] Lead with the overall architecture, boundaries and module relationships; expand each core responsibility's inputs, outputs, decision authority and collaborators.
- [x] Explain control/data flow and the different ownership of queue, effect receipts, run history and Git; keep the login example as an illustration.
- [x] Preserve accepted ADR-009 and existing/planned capability labels. No runtime, dependency, schema or architecture decision change.
- [x] Verify actual HTML on desktop/mobile, mode switching, deep links/history, details, reduced motion, offline/no-JS and print; run the documentation workflow and targeted link checks.

## Implementation Slice

HTML author owns `docs/architecture.html`. Root owns README navigation instructions if necessary, this plan, active task references and the dated report. Reviewers inspect only. Temporary checks belong under `.agent_workspace/architecture-polish/`.

## Test-First Plan

This is a documentation/presentation change. No product regression or full product gate is required. Exercise the changed navigation in Chromium and visually inspect the architecture explanation. Use genuine `corepack pnpm@10.17.1 workflow:check`; the environment's plain pnpm wrapper is unsuitable here.

## Gates and Handoff

Documentation changes only; publish to the existing PR #60 using a non-forced, expected-head update after verification. Do not merge main or integrate PR #61. Keep the existing runtime P0 and production/outcome gates open. Rollback is a documentation revert.

## Closeout

Record findings, corrections, commands and publication in `docs/reports/2026-10-16-architecture-explanation-polish.md`; update active task references without rewriting prior delivery evidence.

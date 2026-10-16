# Architecture explanation and navigation polish — verification

## Identity

- Task: `TASK-20261016-architecture-explanation-polish`.
- Date: 2026-10-16.
- Baseline: PR #60 documentation head `77dda44909048c05f3f10af738cacc75606de045`.
- Scope: HTML presentation and navigation; accepted architecture and runtime unchanged.
- State: documentation verified; publication pending.
- Environment: Node 24.19.0, pinned pnpm 10.17.1, local-file Playwright/Chromium.

## Changes

The stable `docs/architecture.html` now contains 13 chapters. It starts with the
whole architecture, dependency direction, four core responsibilities, and module
collaboration before introducing the login task example. Each responsibility
explains inputs, outputs, decision authority, collaborators, rationale and existing
code versus remaining migration work. The collaboration chapter separates control
flow from evidence flow, and project work items from run history, managed effect
receipts and actual Git/workspace state. Run completion, accepted work and source
integration are explicitly different facts.

The top toolbar is removed. Desktop reading/motion controls sit below the sidebar;
mobile chapter selection and settings sit with the bottom navigation. Global
previous/next controls and available left/right keys change chapters directly.
Local diagram nodes select their own detail panels, with addressable links and
browser history. Explicit chapter navigation focuses its heading. Up/down keys
and focused input controls retain their native behavior.

Continuous reading, expandable detail, reduced motion, offline use, no-JavaScript
reading and print styles remain available. Presenter coaching text was reduced
to give architecture content more space. No runtime, dependency, schema, accepted
ADR or production status changed.

## Commands

Temporary browser scripts and raw output are under
`.agent_workspace/architecture-polish/`; the durable conclusions are recorded here.

| Command / check | Result | Scope |
|---|---|---|
| `corepack pnpm@10.17.1 workflow:check` | PASS: 10 required files, 16 required headings | Documentation workflow |
| `python3 .agent_workspace/architecture-polish/check-links.py` | PASS: 270 local references across five changed files, zero errors | Files and local fragments |
| `git diff --check` | PASS | Changed-file whitespace |
| `node .agent_workspace/architecture-polish/check.mjs` | PASS: 86 checks, zero page errors or external resource requests | Author browser verification |
| `node .agent_workspace/architecture-polish/mode-url-check.mjs` | PASS: 4 checks | Final mode/URL correction |
| `node .agent_workspace/architecture-polish/independent-browser.mjs` | PASS: 11 checks | Independent interaction verification |
| Independent architecture/content review | PASS after the mode/URL correction | Explanation consistency and implementation labels |
| Desktop/mobile screenshot inspection | PASS | Author, independent reviewer and root visual review |
| Full product gate / paid providers | NOT RUN | No runtime change |

## Behavioral Evidence

- All 13 chapters fit without horizontal document overflow at 390, 768, 1280 and
  1440 px; the independent reviewer also checked 320 px. Mobile controls, chapter
  selection and settings work at the tested sizes.
- Global navigation changes chapter from different local panel selections.
  Browser Back/Forward restores chapter/panel links; reload respects deep links.
  Explicit chapter changes focus the new heading without trapping focused controls.
- Continuous reading exposes every chapter and panel. Rapid mode changes remain
  stable after delayed scroll handlers. Native detail expansion and both reduced
  motion controls work; the system reduced-motion preference is respected.
- Local-file execution emitted no page errors or external-resource requests in
  the instrumented checks. No-JavaScript content remains readable with inactive
  controls hidden. Print CSS exposes every chapter, panel and detail body while
  hiding navigation. These are browser visibility checks, not physical-print or
  assistive-technology certification.
- Root inspected the desktop overview and four-responsibility layout and the
  mobile collaboration chapter. Independent review checked the accepted design
  boundaries against the maintained architecture and ADR-009, not only the page's
  own wording.

The independent reviewer found one navigation issue: entering continuous reading
at `#core`, scrolling to `learning`, then returning to chapter mode left the URL
at `#core`. Reload therefore returned to the wrong chapter. The mode transition
now replaces the URL with the displayed chapter when they differ, without adding
a history entry. Same-chapter panel deep links remain intact. Both cases passed
the author delta and the independent final run; no blocking finding remained.

## Risks and Gates

No new architecture decision, Pi upgrade, plugin SDK implementation, process
cancellation fix, learning outcome or strict budget guarantee is introduced.
Existing ADRs and runtime/production gates remain unchanged. This delivery does
not merge main or integrate PR #61. Browser evidence is scoped to the tested
Chromium build; runtime migration remains separate.

## Handoff

Maintain `docs/architecture.html` at the stable path. A downloaded copy remains
an offline snapshot. Publication will use the connected GitHub API and verify
the exact local/remote tree, since CLI push credentials were unavailable in the
preceding delivery. See the [plan](../superpowers/plans/2026-10-16-architecture-explanation-polish.md)
and [active checklist](../../tasks/todo.md).

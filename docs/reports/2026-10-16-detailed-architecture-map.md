# Detailed architecture map — verification

## Identity

- Task: `TASK-20261016-detailed-architecture-map`.
- Baseline: `415b072b8be18818be84e87489d00d7d44826bce`, existing PR #60.
- Date: 2026-10-16.
- State: documentation verified; publication pending.
- Scope: documentation diagrams and navigation only.
- Environment: Node 24.19.0, pinned pnpm 10.17.1, local-file Playwright/Chromium.

## Changes

The guide removes obsolete top-toolbar styles, reserved header references,
chapter eyebrows and the sidebar top label. The prior delivered file already
had no visible horizontal toolbar; this iteration clears the remaining styling
and decorative content rather than claiming a newly discovered visible header.

The fixed guide footer is now a single 48 px row on desktop and mobile, excluding
any physical-device safe-area inset. Previously it measured 75 px at 1440 px
and 111.44 px at 390 px. Mobile keeps chapter selection, an accessible settings
menu and arrow buttons in that one row. Global chapter switching and local
node selection retain their previous meanings. Document-end content can be
scrolled completely above the footer; this is not a new scrolling-container
implementation.

The new `architecture-map.html` contains a native vector diagram with 32 key
nodes and 39 directed, labeled relationships. Each node exposes inputs, outputs,
decision authority, collaborators, limitations/status and source links. Node
selection, sequential explanation and relationship/group emphasis support a
progressive explanation of the complete system. Four additional SVG diagrams
cover the strict task sequence, cancellation/recovery, Pi evolution and plugin
contributions. The map has no fixed top or bottom toolbar.

`architecture-map.svg` is the same overview SVG embedded in the HTML, saved as an
independent vector graphic for presentation use. Its legend distinguishes
control calls, facts/evidence and optional contributions, and labels existing
source capability (E), accepted migration targets (T) and optional future work
(F). README, framework and the guide link to both formats. The map contains all
required drawing styles and uses no external scripts, fonts or image assets.
No runtime or architecture decision is changed.

## Commands

| Command / check | Result | Scope |
|---|---|---|
| `node .agent_workspace/architecture-map/guide-check.mjs` | PASS: 45 assertions | Navigation/layout delta, reading, settings, no-JS and print visibility |
| Guide footer measurement | PASS: 48 px at 1440, 768, 390 and 320 px | Actual bounding rectangles, single-row controls |
| Independent guide delta | PASS: 17 checks; desktop/mobile screenshots inspected | Compact controls, settings, no top chrome, reachable detail, no-JS/print |
| `node .agent_workspace/architecture-map/check.mjs` | PASS: 35 assertions, zero page errors / external requests | Author map interactions, responsive, no-JS and print checks |
| `node .agent_workspace/architecture-map/independent-map-review.mjs` | PASS: 21 assertions | Independent map behavior and presentation review |
| `node .agent_workspace/architecture-map/root-svg-check.mjs` | PASS: decoded SVG image, no XML parse error, screenshot inspected | Standalone vector export |
| Embedded/standalone SVG comparison | PASS: identical embedded SVG bytes | Export consistency |
| Independent source/content review | PASS after targeted wording/label corrections | Real call relationships, fact owners and E/T/F distinctions |
| `corepack pnpm@10.17.1 workflow:check` | PASS: 10 required files / 16 headings | Documentation workflow |
| `python3 .agent_workspace/architecture-map/check-links.py` | PASS: 486 local references across nine changed files, zero errors | Local destinations and fragments |
| `git diff --check` | PASS | Changed documentation whitespace |
| Full product gate / paid providers | NOT RUN | No runtime change |

## Behavioral Evidence

Guide checks found no top fixed/sticky horizontal bar, no page overflow at the
four tested widths, usable settings within the viewport, working chapter keys,
selection and reading mode, and reachable end content. No-JavaScript reading
and print show all 13 chapters with inactive controls hidden. Root inspected
the desktop and mobile guide screenshots. Raw evidence is under
`.agent_workspace/architecture-map/`.

Two initial local harness runs stopped before producing a verdict: the first
used an ambiguous selector matching a hidden overview link and a local node;
the second included a closed settings panel's layout in the one-row measurement.
Selectors were restricted to the intended chapter node and the primary row
controls. These were harness corrections; the final 45 assertions passed.

Independent source mapping confirmed the existing strict development chain:
`DevelopmentController → NativeWriteSession → startParentRun → AgentExecutor →
PiAgentExecutor → Pi core`. The native extension's read-only delegation is a
separate route. Checks, fresh acceptance and explicit application remain separate
steps. Code-presence labels do not imply production acceptance; qualified Pi
generations, shared strict budgets and the narrow plugin registry remain targets.
The final review retained these distinctions and found no remaining blocking
content issue.

The map author exercised node click/keyboard activation, previous/next node,
relationship emphasis, reset, browser history and cold deep links; the system
reduced-motion preference is respected. At 390, 768, 1280 and 1440 px, the page
has no horizontal document overflow; the large SVG scrolls inside its own frame.
The independent reviewer also checked 320 px. With JavaScript disabled all 32
node explanations remain available. Print reveals all node details and all four
supplementary diagrams while hiding interaction controls. Browser visibility
checks are not physical-print or assistive-technology certification.

The author and independent reviewer inspected actual desktop/mobile views;
root inspected the compact guide, desktop map and complete vector graphic.
The independent final result is 17 guide + 21 map checks, with the review in
`.agent_workspace/architecture-map/independent-review.md`. These are actual
separate review runs, not additional runtime tests.

Corrections retained from verification:

- Three source links initially named nonexistent `src/native/executor.ts`;
  they now link to the actual `src/pi-adapter/native-executor.ts`.
- A mobile grid min-content width initially widened the page; sizing was
  corrected so only the SVG frame scrolls. The independent old result of 19/21
  is superseded by the final 21/21 run after that correction.
- Lane subtitles and edge labels overlapped in four places; redundant lane
  subtitles were removed and key labels repositioned into free space. The
  native driver wording now distinguishes host model streaming from the
  standalone core Agent without implying a nonexistent executor class.
- Direct SVG-document screenshots timed out in headless Chromium. Rendering
  the identical SVG bytes as a data-image decoded successfully and produced
  the inspected full graphic; DOMParser reported no XML error. No external
  renderer, font download or paid provider was required.

## Risks and Gates

Accepted ADR-009, implementation labels, existing runtime/production gates,
main and separate PR #61 remain unchanged. Process-tree cancellation, live
provider measurement, production learning outcomes and migration acceptance
are not closed by these diagrams or browser checks.

## Handoff

[Plan](../superpowers/plans/2026-10-16-detailed-architecture-map.md).
Documentation verification is complete; publication to existing PR #60 is
pending. Use an expected-head, non-forced update; do not merge main. When the
map changes, update its embedded SVG and standalone SVG together. The local
HTML remains an offline snapshot when downloaded.

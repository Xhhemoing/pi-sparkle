# Architecture UI and download delivery correction

- Task: `TASK-20261017-architecture-download-fix`; owner: Codex.
- Date: 2026-10-17 UTC; baseline: PR #60 `e6f6a5b187f8a6a5b468a7ccee3f16e152001df6`.
- Scope: documentation UI and downloadable exports; [plan](../superpowers/plans/2026-10-17-architecture-download-fix.md).
- Result: scoped implementation and author verification passed. No independent review, runtime gate, merge or production acceptance is claimed.

## Correction

The prior guide removed the horizontal toolbar but retained a sidebar brand,
continuous-reading buttons, animation toggles and mobile settings. That did not
fully satisfy the user's request. Repository-path delivery also did not provide
the user with a usable downloadable map. The exact previously opened client file
is not known; this delivery supplies fresh files rather than assuming a cache issue.

`docs/architecture.html` now removes those DOM elements, their handlers and the
unused reading-mode behavior. The only buttons are previous/next chapter; desktop
retains the chapter directory, mobile retains the chapter select. OS reduced-motion
settings apply automatically. No-JS and print still expose the full explanation.
The existing single-row footer remains 48 px excluding device safe-area insets.

`docs/architecture-map.html` now has a real `download` link containing the exact
standalone SVG bytes as a data URL. This works when only the HTML is present and
does not depend on fetching an adjacent SVG. The normal map heading is simplified;
the 32 nodes, 39 relationships and four supplemental diagrams are unchanged.

The offline export contains `architecture.html`, `architecture-map.html`,
`architecture-map.svg`, a 3840 × 4200 `architecture-map.png`, and a short README.
Non-bundled source/document references point to the existing GitHub branch;
guide/map cross-links remain local. Both HTML pages work offline; optional source
references require network access. Exports are delivered separately from source.

## Commands and evidence

Temporary author harnesses are under `.agent_workspace/architecture-download-fix/`.

| Check | Result |
| --- | --- |
| `node .agent_workspace/architecture-download-fix/check.mjs` | 42 assertions PASS; zero page errors or network requests |
| Viewports 1440 / 768 / 390 / 320 | removed controls absent in DOM; footer exactly 48 px; no page overflow |
| Guide interactions | all 13 chapters, local panel, cold deep link, history, mobile select PASS |
| Reduced motion / no-JS / print | OS setting applied; all 13 chapters readable without JS and in print |
| Map selection and actual download | 32 nodes / 39 edges retained; downloaded SVG exactly equals standalone bytes |
| Map responsive widths 1440 / 390 / 320 | no document overflow |
| PNG | 3840 × 4200, Chinese glyphs present; diagram and desktop/mobile guide screenshots visually inspected |
| ZIP | five members, archive integrity and every member's exact bytes verified |
| `node .agent_workspace/architecture-download-fix/extracted.mjs` | extracted guide → map → guide navigation PASS |
| Targeted HTML references | 191 local links / zero missing targets; embedded SVG bytes match source |
| `corepack pnpm@10.17.1 workflow:check` | PASS: 10 required files, 16 headings |
| `git diff --check` | PASS |

The initial default Playwright browser download returned an invalid archive. A
separately downloaded Chrome headless shell 133 was used for the checks. The first
visual inspection found missing CJK fonts in this environment; Noto Sans CJK was
installed and all 42 checks and screenshots/PNG generation rerun. Only the final
Chinese-readable PNG is packaged. These were environment/export findings, not
suppressed product failures.

Full runtime gate and paid provider calls were not run: the repository's docs-only
verification policy applies. Runtime changes already present at the remote baseline
are preserved. Main, PR #61, architecture decisions and migration gates are unchanged.
Publication is scoped to this documentation delta on the existing PR #60 branch;
the upload/push result is reported separately from the author verification above.

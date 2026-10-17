# Architecture controls and downloadable delivery

- Task: `TASK-20261017-architecture-download-fix`; owner: Codex.
- State: accepted (documentation verification); [evidence](../../reports/2026-10-17-architecture-download-fix.md).
- Baseline: PR #60 `e6f6a5b187f8a6a5b468a7ccee3f16e152001df6`.
- Problem: the user still sees Pi-sparkle branding and continuous-reading controls, and cannot download the detailed map. Earlier removal left sidebar/mobile controls, and repository paths alone did not provide a reliable downloadable deliverable.
- Scope: remove peripheral brand/reading/settings UI from `docs/architecture.html`; keep chapter and node navigation; add a self-contained SVG download to `docs/architecture-map.html`; prepare a fresh offline HTML/SVG/PNG ZIP export.
- Non-goals: architecture decisions, runtime, dependencies, PR merge, or migration gates.

## Acceptance

1. No brand toolbar, sidebar brand, continuous-reading button or animation/settings control in the guide DOM; headings and architecture prose remain.
2. Footer stays one 48 px row at desktop and 320/390/768 px widths; chapters, node navigation, deep links and system reduced motion work.
3. Map SVG download works from the standalone HTML without a sibling file or network; the complete 32-node/39-edge map and four supplements are retained.
4. A fresh downloadable ZIP contains both offline HTML pages, SVG and a high-resolution PNG; extracted pages and map links work. Exported source-reference links point to the repository instead of missing local files.
5. Browser interaction, no-JS, local link/content checks, pinned workflow and whitespace check pass; exact results and limitations are recorded.

## Verification and rollback

Documentation-only exception to runtime test-first/full gate applies. Browser checks cover actual viewports, navigation and downloaded bytes, and the PNG is inspected. Use `corepack pnpm@10.17.1 workflow:check`, `git diff --check`, and scoped browser/package checks. Undo only this documentation slice on failure. Publication uses the existing PR branch with a checked current head; do not overwrite intervening work. No independent review or runtime acceptance is claimed.

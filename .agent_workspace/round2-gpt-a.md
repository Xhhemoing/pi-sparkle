# Round 2 — R2-gpt-A

## Changes

- Added a Pi 0.84.3 fixture with a valid skill at
  `test/fixtures/pi-0843-skills/grouping/nested-skill/SKILL.md`.
- Added ordinary grouping-directory `AGENTS.md` and `README.md` files without
  YAML skill frontmatter.
- Added filesystem-only assertions in
  `test/unit/pi-compat/skill-discovery-0843.test.ts`. The test verifies the
  nested skill exists with non-empty `name` and `description` frontmatter and
  verifies the grouping Markdown files do not begin with `---`.
- Left both compatibility scripts unchanged. No fixture-related probe change
  or installer simulation was needed, and the reviewed offline, JSON, and
  strict paths did not show a clear defect within this assignment.

## Verification

- `pnpm exec tsx --test test/unit/pi-compat/skill-discovery-0843.test.ts`
  — 2 passed, 0 failed.
- `pnpm exec eslint test/unit/pi-compat/skill-discovery-0843.test.ts`
  — passed.
- `pnpm typecheck` — passed.

No commit was created.

# Round 3 — R3-gpt-A

## Changes

- Kept the Pi 0.84.3 discovery example exclusively under
  `test/fixtures/pi-0843-skills/`.
- Extended `test/unit/pi-compat/skill-discovery-0843.test.ts` to assert:
  - the nested `SKILL.md` has non-empty skill frontmatter with the expected
    `name` and `description`;
  - grouping `README.md` and `AGENTS.md` do not declare frontmatter;
  - no `SKILL.md` under `.agents/skills/` copies the fixture skill.
- Added `test/unit/pi-compat/probe-scripts.test.ts` with a local fake registry:
  - `--offline` and `PI_COMPAT_OFFLINE=1` make zero registry requests;
  - `--strict` exits 1 when fake latest versions are ahead of the pinned
    versions.
- Reviewed both probe scripts. Their behavior already satisfies these edge
  cases, so no script implementation change was needed.

## Verification

- `pnpm exec tsx --test test/unit/pi-compat/skill-discovery-0843.test.ts test/unit/pi-compat/probe-scripts.test.ts`
  — 5 passed, 0 failed.
- `pnpm exec eslint test/unit/pi-compat/skill-discovery-0843.test.ts test/unit/pi-compat/probe-scripts.test.ts`
  — passed.
- `pnpm typecheck` — passed.
- `git diff --check -- test/fixtures/pi-0843-skills test/unit/pi-compat/skill-discovery-0843.test.ts test/unit/pi-compat/probe-scripts.test.ts`
  — passed.

No commit was created.

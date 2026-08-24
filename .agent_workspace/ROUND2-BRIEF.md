# Round 2 conclusion brief (inject into every Round 3 agent)

Parent orchestrator, 2026-08-24. Branch `cursor/pi-adapt-aux-features-e1e3`. PR https://github.com/Xhhemoing/pi-sparkle/pull/4

## Round 2 landed

- **`run --thinking <level>`** is **shipped** in `src/cli/main.ts`: flag > `PI_THINKING_LEVEL` > `off`; per-run, not persisted; USAGE lists it. Tests: `test/unit/cli/thinking-flag.test.ts`.
- **pi-compat CLI tests** + doctor assertions; npm scripts `pi-compat`, `pi:latest`, `pi:probe`.
- **Library:** adapter-source-only probe; `BROKEN:` findings for empty levels / reader failure; docs mentioning `GoogleThinkingLevel` must **not** fail doctor.
- **Fixtures:** `test/fixtures/pi-0843-skills/` (nested SKILL.md + grouping README.md/AGENTS.md without skill frontmatter) + discovery tests.
- **Docs (fable-A):** how-to + audit + `docs/reports/2026-08-24-round2-sota-gap.md` treat `--thinking` as landed; specifier-based ADR-001 tripwire documented.
- **Overlay (fable-B) is STALE:** still calls `run --thinking` **planned**. Round 3 must flip overlay to landed without claiming TUI persistence.

## Do not regress

- ADR-001 / ADR-006: no Pi imports outside adapter; no extensions; no coding-agent dep; no PowerShell tool.
- Probe stays adapter-only.
- Nested demo skills stay under `test/fixtures/`, never `.agents/skills/`.
- Pin remains 0.84.3 matching pair.

## Round 3 targets (SOTA close-out)

1. Overlay + README: `--thinking` landed; `PI_THINKING_LEVEL` list includes `max`; `pnpm pi:probe` row if missing.
2. Thinking-mirror / Google `xhigh`/`max` clamp: test or documented warning only — do not change provider clamp.
3. `docs/status-matrix.md` row for `pi-compat` / pin 0.84.3 if the matrix is the live capability grid.
4. Full **`pnpm gate`** green. Fix real failures; Node engines 22.19 vs older VMs are environmental.
5. Cross-check help/USAGE/how-to/skill for flag names (`--online` not `--online` mismatch — actual flags are `--offline` default and `--online`).
6. No new product planes. No live R1/bandit.

After Round 3 the parent runs gate, updates the PR, and merges if the branch is conflict-free with `main`.

# Round 1 conclusion brief (inject into every Round 2 agent)

Line 0 context: parent orchestrator, 2026-08-24. Branch `cursor/pi-adapt-aux-features-e1e3`.

## What landed

- Pi **0.84.1 → 0.84.3** matching pin (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`).
- Adapter consumed types: **no-code-change bump** for the Google rename (never imported). `toolChoice` is additive and already forwarded via options spread.
- `SparkleThinkingLevel` now lives on the adapter boundary (CLI must not import Pi `ThinkingLevel`).
- New auxiliary: `pi-sparkle pi-compat [--json] [--offline|--online]` (offline default; `--online` fail-closed). Doctor checks `pi-packages` and `pi-compat`.
- Library: `src/pi-compat/check.ts` (do not import Pi packages here).
- Scripts: `scripts/pi-compat-probe.mjs`, `scripts/pi-latest-check.mjs`.
- Docs: `docs/how-to-adapt-to-pi.md`, `docs/reports/2026-08-24-pi-0843-gap-audit.md`.
- Overlay: `.agents/skills/pi-sparkle` 0.84.3 section + `references/pi-version-adapt.md`.
- Parent already narrowed `test/unit/pi-boundary.test.ts` to **import specifiers** (`from` / `import(` / `require(`), not substring `@earendil-works/`.

## Do not regress

- ADR-001: Pi types/imports only in `src/pi-adapter/`.
- ADR-006: no inbound Pi extension; no `pi-coding-agent` runtime dep; no PowerShell tool.
- Adapter probe (legacy `GoogleThinkingLevel` detection) must stay on **adapter sources**, never docs/skills prose.
- Do not add a second top-level skill (bloat). Nested grouping fixtures belong under `test/`.
- Live R1/bandit/topology stay off. Adaptation remains proposal-first.

## Round 2 targets (priority order)

1. CLI tests for `pi-compat` + doctor new checks; wrap probes in `package.json` scripts.
2. `run --thinking <level>` with precedence over `PI_THINKING_LEVEL`; document vs Pi TUI `/thinking`.
3. Nested-skill + root `AGENTS.md` 0.84.3 discovery **test fixture** (not a real skill).
4. Align how-to/README/USAGE (`--online` exists; default offline).
5. Full `pnpm gate` green (ignore this VM’s Node 22.14 vs engines 22.19 if still present).
6. Watch: `pi-ai` `ThinkingLevel` dropped `"off"`; agent-core still has it. Google silently clamps `xhigh`/`max`.

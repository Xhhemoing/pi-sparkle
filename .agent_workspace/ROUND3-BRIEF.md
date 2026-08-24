# Round 3 conclusion — SOTA close-out

Parent orchestrator, 2026-08-24. Branch `cursor/pi-adapt-aux-features-e1e3`.

## Outcome

Pi-sparkle is adapted to **Pi 0.84.3** with auxiliary tooling so later Pi bumps can be detected and absorbed behind `src/pi-adapter/` (ADR-001). ADR-006 still holds: overlay, not an extension.

`pnpm gate` **green** (1213 pass / 1 skipped live-smoke). No merge conflicts vs `origin/main`.

## Round 3 landed

- Overlay/README: `run --thinking` documented as **shipped** (flag > env > `off`; includes `max`; TUI `/thinking` remains session-scoped).
- Status matrix: Pi pin + `pi-compat` + doctor checks + `--thinking` rows (preview, not Outcome-supported).
- Google clamp **characterized** in tests; adapter still forwards `xhigh`/`max` unchanged.
- Fixture guards + probe offline/strict tests.
- Adapter-only probe: docs mentioning the legacy Google identifier do not fail doctor.
- `prerelease` now runs `pi:probe` after `security:probe` (redaction waiver still required for the full chain — pre-existing).

## Residual (out of scope)

- Additive thinking-level drift (new union members) is a manual per-bump check.
- Invalid `--thinking` vs invalid `PI_THINKING_LEVEL` use different CLI `stage` labels.
- Live provider smoke remains `PI_SMOKE=1`.
- Security redaction findings still block unwaved `prerelease`.

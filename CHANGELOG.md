# Changelog

All notable changes to this project will be documented here.

## [Unreleased] - 2026-09-01

### Changed

- Pinned `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` to 0.84.4
  (patch release; adapter contract re-probed OK, `pi-compat --online` status
  `current`).
- `doctor` auth detail now annotates the routing role of each provider missing
  a credential (`primary — every run routes here` / `fast model` / `enabled
  only — ...`), so triage no longer treats an unused enabled provider as
  urgently as a primary miss. Fail-closed semantics and exit codes unchanged.
- SKILL.md documents the `pnpm cli <command>` / `node dist/cli/main.js`
  fallback when the `pi-sparkle` bin is not globally linked.

### Added

- `skill-audit.mjs` now reports `negativeCases`: skills the router skipped
  despite >70% activation across past candidate appearances (min sample 3) —
  the should-route-but-did-not signal from evidence-loop.md fix #2.
  `neverActivated` is additionally gated on routed records existing, so a
  project that just enabled logging no longer lists every skill as unused.

### Fixed

- `doctor --project` no longer FAILs Python projects: `pyproject.toml` is now
  accepted as a project marker alongside `package.json`.

## [0.1.0-preview.1] - 2026-08-27

Developer Preview only. The package is `"private": true`, will not be
published to npm, and supports clone + pnpm installation only.

### Added

- Local fake-executor run, inspect, resume, children, and flowchart workflows.
- Parent/child coordination, durable checkpoints, event logs, and guarded
  unblock/delete operations.
- Opt-in Pi-provider execution behind the adapter boundary.
- Privacy record dictionary, redaction, deletion cascades, and technical P0
  re-verification.
- Dry-run-first `retain` command with a 90-day default for runtime invocation
  and episode records.
- `auth login --key-file <path>` and `--key-stdin` as argv-safe alternatives
  to `--key` (docker/`gh` stdin pattern).
- URL userinfo redaction (`https://user:password@host` / `http://token@host`).
- AWS STS (`ASIA…`) and Stripe live (`sk_live_` / `rk_live_`) token shapes.
- Prerelease quality, security, and Pi-boundary probes.

- `run --max-cost-usd <usd>` run-level cost ceiling on default and `--children` paths.
- `inspect --run --follow` read-only event tail, with optional `--idle-timeout-ms`.
- `inspect` child result lines print `verification=` via `inspect-format`.
- Market-eval and preview-release probes (`pnpm market-eval:probe`, `pnpm preview:probe`).
- `.env.example` and `.github/CODEOWNERS`.

### Known limitations

- No capability is Outcome-supported.
- Real-provider execution is opt-in; adaptive R1/bandit/topology selection is
  not live.
- Retention enforcement is operator-triggered through `retain --apply`; there
  is no background deletion timer.

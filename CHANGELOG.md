# Changelog

All notable changes to this project will be documented here.

## [0.1.0] - Unreleased

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
- `auth login --key-file <path>` as the argv-safe alternative to `--key`.
- URL userinfo redaction (`https://user:password@host` / `http://token@host`).
- Prerelease quality, security, and Pi-boundary probes.

### Known limitations

- No capability is Outcome-supported.
- Real-provider execution is opt-in; adaptive R1/bandit/topology selection is
  not live.
- Retention enforcement is operator-triggered through `retain --apply`; there
  is no background deletion timer.

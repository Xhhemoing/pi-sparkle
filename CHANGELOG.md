# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at the 0.1.0 developer preview. Entries before that point
were not tracked here; use `git log` for the full history.

## [Unreleased]

### Added

- `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, and `.env.example`.
- CI runs `pnpm security:probe` after `Build`, with **no** `SECURITY_WAIVER`,
  so the release-gate probe is enforced on every pull request rather than only
  as a dated local claim.
- `scripts/preview-release-probe.mjs` (`pnpm preview:probe`) checks cheap
  developer-preview invariants — `private: true`, a non-empty `engines.node`,
  the `bin` path, a Status heading in `docs/specs/release-gate.md`, and
  `pnpm-workspace.yaml` — and runs first in `pnpm prerelease`.
- `adapt eval` now states that a routing replay carries **no quality
  evidence**: `RoutingEvalReport` gains `qualityEvidence:
  "none-by-construction"`, a note explaining that both arms replay the recorded
  outcome (so `utilityDelta` is 0 by construction), and an `actionDiff` listing
  the episodes the candidate routes to a different model with the per-episode
  cost delta. The CLI prints that diff and warns — without blocking — when the
  cost-delta upper bound is positive. `adapt status` states the same evidence
  class.
- ADR-006 guardrails are assertions, not prose: `src/pi-adapter` may reference
  only `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`, and
  `package.json` must declare no `pi.extensions` and no `pi-coding-agent`
  dependency (`test/unit/pi-boundary.test.ts`).
- `src/cli/inspect-format.ts` formats a `TASK_RESULT` with
  `verification=PASSED|FAILED|UNOBSERVED`, suffixes the outcome with
  `(unverified)` when verification is `UNOBSERVED` with no evidence, and builds
  a report-only `unverified: N/M` summary. The module is not yet called from
  `src/cli/main.ts`, so CLI output is unchanged for now.

### Changed

- `scripts/security-probe.mjs` no longer honours `SECURITY_WAIVER` for
  `packaged-secrets`. Release-gate rule 3 ("credential material in the artifact
  is an unconditional block") is enforced by the probe instead of by review.

### Fixed

- Security findings `pii-redaction` and `secret-bodies` are closed. The
  value-removing transforms in `src/feedback/redaction.ts` collapse PEM blocks,
  `Bearer` tokens, vendor key shapes, JWTs, and keyed `name=value` assignments
  to `[secret]`; home/`.ssh`/Windows/UNC paths to `[path]`; and
  email/IPv4/phone/Luhn-valid card to their placeholders.
  `test/unit/feedback/redaction.test.ts` pins the same gate cores against
  `src/` so a regression fails `pnpm test` before it reaches the probe. The
  gate is GREEN as of 2026-08-25 with an empty waiver register.

## [0.1.0] — Developer Preview

Not published to npm (`private: true`). The state below is the authoritative
summary; the per-capability grid lives in
[docs/status-matrix.md](docs/status-matrix.md).

### Supported

- Local CLI on the fake-executor path: `run`, `inspect`, `resume`,
  `--flowchart`, `--children`.
- JSONL event persistence, resumable checkpoints, and an episode bound to each
  run; a crash-truncated final JSONL line is recovered rather than treated as
  corruption.
- Task DAG validation with cycle prevention and deterministic join scheduling.
- Stall detection, evidence ledger, and routing of low-confidence work to human
  approval.
- `--track`: clarify from objective and recorded habits, plan
  scout → implement → review → test, execute, and track the episode.

### Opt-in / not Outcome-supported

- Real Pi providers via `--executor pi` and `PI_*` environment variables.
- Adaptive routing: live routing is R0-equivalent static `ModelRouter`;
  R1/bandit remain shadow-only. `adapt auto` proposes routing-policy candidates
  only, and `adapt promote --approve` is required.

### Known open gates

- **P0 privacy review is CONDITIONAL**, not closed. Q1 (plane isolation) and
  Q2 (delete tooling + cascade) were remediated on 2026-08-22 and extended on
  2026-08-24; both await reviewer re-verification and sign-off.
- **Checkpoint F sealed holdout is open** (ADR-005); no adaptive gains may be
  claimed.
- **ADR-006 stays Proposed.** No Pi extension is registered.
- The security probe is green, which is a gate result and **not** a release
  authorization. See [SECURITY.md](SECURITY.md) and
  [docs/specs/release-gate.md](docs/specs/release-gate.md).

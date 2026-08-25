# Security Policy

## Supported versions

`pi-sparkle` is a **developer preview (0.1.0)** and is `private: true` — it is
not published to npm. Only `main` receives fixes; there are no supported
released versions.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability.

Use either of these private channels on
[github.com/Xhhemoing/pi-sparkle](https://github.com/Xhhemoing/pi-sparkle):

1. **GitHub Security Advisories** (preferred) — go to the repository's
   **Security → Advisories → Report a vulnerability** tab. This opens a private
   discussion visible only to you and the maintainers.
2. **Private issue to the maintainer** — if advisory reporting is unavailable
   to you, contact the repository owner (`@Xhhemoing`) directly through GitHub
   so a private thread can be opened.

Helpful reports include: affected commit or branch, reproduction steps, the
observed versus expected behaviour, and impact. If the finding involves real
credential material, include the *shape* of the secret, never the secret
itself.

Because this is a preview project maintained by a single owner, there is no
committed response SLA. Reports are triaged on a best-effort basis.

## Release gate and waivers

Security findings are enforced by `pnpm security:probe`, described in
[docs/specs/release-gate.md](docs/specs/release-gate.md). That document is the
authoritative source for the current finding list and the waiver register.

Key rules:

- A finding may be time-boxed waived via `SECURITY_WAIVER="id1,id2"`, but the
  waiver **must be recorded in the register** (reason + expiry) before use.
  The register is currently **empty**, and nothing on this branch needs a
  waiver — see below.
- Waivers are per-release. They do not close a finding.
- **`packaged-secrets` is never waivable.** Credential material inside the
  publishable artifact is an unconditional block, in CI and at release.
  `scripts/security-probe.mjs` excludes that id from the `SECURITY_WAIVER`
  filter, so the rule is enforced by the probe and not only by review.
- `pnpm prerelease` runs the probe **without** any waiver, so it fails while
  any finding is open. CI runs the same probe after `Build`, also with no
  waiver.

## Current findings

**None open as of 2026-08-25.** The last recorded run of
`node scripts/security-probe.mjs` against a freshly built `dist/` reported
`status: "ok"`, 14 passed, zero open findings and zero waived findings. The
evidence block and the per-finding detail live in
[docs/specs/release-gate.md](docs/specs/release-gate.md).

Two caveats on reading that result:

- The probe imports `dist/feedback/redaction.js`. A green result only describes
  the `dist/` it was run against — run `pnpm build` immediately before
  `pnpm security:probe`.
- Green is **not** a release authorization. `private: true` stays, the P0
  privacy sign-off is still open, and nothing here is Outcome-supported.

`pii-redaction` and `secret-bodies` were open on 2026-08-22 (`redactFeedback`
labelled rather than removed PII, and secret stripping removed only literal
prefixes). Both were closed by the value-removing transforms in
`src/feedback/redaction.ts`; `test/unit/feedback/redaction.test.ts` pins the
same gate cores against `src/` so a regression fails `pnpm test` before it
reaches the probe. Feedback bodies persisted under the state root **before**
that fix may still contain unredacted PII.

## Credential handling

- Never commit real keys. `.env` is git-ignored; only
  [`.env.example`](.env.example) — placeholders only — is tracked.
- Stored credentials live under the state root (`~/.pi-sparkle` by default) and
  are outside the packaged artifact.
- Telemetry records are reference-only: no prompt, response body, secret, or
  environment value is persisted. See
  [docs/data-dictionary.md](docs/data-dictionary.md).

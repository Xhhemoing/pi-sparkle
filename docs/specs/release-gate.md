# Release gate

`pnpm prerelease` = `pnpm gate` (typecheck/lint/test/build) **plus**
`pnpm security:probe` **plus** `pnpm pi:probe`. The security probe runs
against the built `dist/` artifact; the Pi probe checks the adapter boundary
and rejects the legacy symbol. CI (`ci.yml`) runs the quality gate on every
push. This repository is a Developer Preview with `"private": true` and will
not be published to npm; prerelease is the bar for a preview tag, not an npm
publication workflow.

## Status: OPEN — green at HEAD

The two findings opened on 2026-08-22 were remediated and closed on
2026-08-24:

| id | probe | resolution | closed |
|---|---|---|---|
| `pii-redaction` | redaction coverage | value-removing redaction for email, IP, phone, Luhn-valid cards, and home/UNC paths, with regression coverage | 2026-08-24 |
| `secret-bodies` | redaction coverage | value-aware removal for keyed assignments, bearer/JWT/vendor tokens, and private-key blocks | 2026-08-24 |

At HEAD the release command is expected to exit 0. Any new open security or
Pi-boundary finding closes the gate until fixed or validly waived under the
rules below.

## Waivers

A finding may be time-boxed waived for a specific release:

```bash
SECURITY_WAIVER="pii-redaction,secret-bodies" pnpm prerelease
```

Rules:

1. A waiver MUST be recorded below with reason + expiry before use.
2. Waivers are per-release; they do not close the finding.
3. `packaged-secrets` findings are **never waivable** — credential material
   in the artifact is an unconditional block. The probe enforces this in code:
   naming `packaged-secrets` in `SECURITY_WAIVER` cannot move that finding to
   the waived set.
4. Pi adapter-contract failures from `pnpm pi:probe` are not security-probe
   findings and cannot be waived through `SECURITY_WAIVER`.

### Waiver register

(empty)

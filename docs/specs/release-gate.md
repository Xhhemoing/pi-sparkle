# Release gate

`pnpm prerelease` = `pnpm gate` (typecheck/lint/test/build) **plus**
`pnpm security:probe`. The probe runs against the built `dist/` artifact and
blocks release while any finding is open. CI (`ci.yml`) runs the quality
gate on every push; the security probe is the extra bar for **publishing**.

## Status: currently BLOCKED

Open findings (2026-08-22, from the weak-areas data collection):

| id | probe | finding | candidate fixes (owner decision pending) |
|---|---|---|---|
| `pii-redaction` | redaction coverage | email/IP/phone/CN-phone/credit-card/paths survive `redactFeedback`; the flag labels but never removes | real PII regex removal pass |
| `secret-bodies` | redaction coverage | secret stripping removes only literal prefixes; key values survive | value-aware secret patterns (`key[:=]\s*\S+`) |

Until fixed, every `pnpm prerelease` exits 1. That is intentional: this
package is `private: true`, so nothing can ship accidentally.

## Waivers

A finding may be time-boxed waived for a specific release:

```bash
SECURITY_WAIVER="pii-redaction,secret-bodies" pnpm prerelease
```

Rules:

1. A waiver MUST be recorded below with reason + expiry before use.
2. Waivers are per-release; they do not close the finding.
3. `packaged-secrets` findings are **never waivable** — credential material
   in the artifact is an unconditional block.

### Waiver register

(empty)

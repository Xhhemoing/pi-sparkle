# Security Policy

pi-sparkle is an unreleased Developer Preview. It is not published to npm and
does not make production-support guarantees.

## Reporting a vulnerability

Use this repository's **Security** tab to submit a report through
[GitHub private vulnerability reporting](https://github.com/Xhhemoing/pi-sparkle/security/advisories/new).
Include reproduction steps, affected versions or commits, impact, and a
suggested mitigation when available.

Do **not** file a public issue that contains credentials, tokens, private keys,
personal data, exploit details, or other secrets. Revoke exposed credentials
immediately and report the issue privately.

Maintainers will acknowledge and triage private reports on a best-effort basis.
Please allow time for a fix and coordinated disclosure before publishing
details.

## Known limitations

- `auth login --key <secret>` places the secret in process argv and shell
  history. Prefer `--from-env`, `--key-file`, `--key-stdin`, or the
  interactive prompt.
- On POSIX, a group- or world-readable `auth.json` is refused until
  `chmod 600`. POSIX `chmod 0600` / `0700` is best-effort on Windows
  (NTFS ACLs are not rewritten).
- Retention is operator-triggered (`retain --apply`); there is no background
  sweeper.
- Regex redaction cannot cover every encoding of a secret. Treat feedback
  bodies as untrusted even when marked redacted.

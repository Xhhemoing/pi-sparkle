model: gpt-5.6-sol-xhigh-fast

# R2-gpt-A report

## Changes

- `scripts/security-probe.mjs` now excludes `packaged-secrets` from waiver
  eligibility while preserving `SECURITY_WAIVER` behavior for every other
  finding id. The waiver predicate cites rule 3 in
  `docs/specs/release-gate.md`.
- `.github/workflows/ci.yml` runs `pnpm security:probe` immediately after the
  quality job's Build step. The step has no `SECURITY_WAIVER` environment.

## Verification

- `pnpm build` — passed.
- `node --check scripts/security-probe.mjs` — passed.
- `env -u SECURITY_WAIVER pnpm security:probe` — passed with status `ok`,
  14 passed checks, and no open or waived findings.
- A Node assertion verified that the CI security step follows Build and that
  its step block contains neither `env:` nor `SECURITY_WAIVER`.

Never-waive experiment (no credential was used):

1. Created an ignored, temporary packaged file
   `dist/security-waiver-probe.txt` containing only the synthetic marker
   `BEGIN PRIVATE KEY`.
2. Ran
   `SECURITY_WAIVER=packaged-secrets pnpm security:probe`.
3. The command exited 1 with status `BLOCKED`; `openFindings` contained the
   `packaged-secrets` finding for the temporary file and `waivedFindings`
   remained empty.
4. Deleted the temporary file.

This exercises the complete package-list scan and waiver accounting path, not
just a duplicate of the predicate in an isolated test.

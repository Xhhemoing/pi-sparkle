# Developer Preview 0.1.0-preview.2

Date: 2026-10-01

This preview is a private, source-only developer release. It is intended for
Node.js >= 22.19.0 with pnpm 10.17.1 and is not published to npm.

## Included

- PR #49 status and provenance reconciliation.
- PR #50 project learning-key isolation for case-differing paths.
- PR #51 host-independent evidence validity classification with fail-closed
  dependency snapshots.
- Existing fake-executor CLI, checkpoint/resume paths, Pi compatibility probe,
  security probe, and preview-release gate.

## Verification boundary

The preview gate is `pnpm prerelease`: preview probe, workflow/type/lint/test/build
gate, packaged-security probe, and Pi adapter probe. This preview does not claim
independent acceptance, live-provider verification, adaptive policy activation,
production authorization, or Outcome-supported capability.

## Use

```bash
corepack enable
pnpm install
pnpm prerelease
pnpm cli version
```

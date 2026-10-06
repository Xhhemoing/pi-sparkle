# Developer Preview 0.1.0-preview.3

Date: 2026-10-06

This preview is a private, source-only developer release. It is intended for
Node.js >= 22.19.0 with pnpm 10.17.1 and is not published to npm.

## Included

- PS-06 read-only run status/recovery projection:
  `inspect --run <runId> --status-json` with an additive frozen contract,
  child-reported verification/criteria, current blockers, own-run eligible and
  fully-priced cost subsets with gaps, and independent event/telemetry
  truncation flags.
- O03 cross-session candidate disposal with a durable registration receipt,
  issued filesystem identities, idempotent retry, and host-only
  `/sparkle-dispose-candidate`.
- O03 crash-window receipt reconciliation after a completed Git worktree
  removal, bounded to the exact authorized absent path with a narrow
  prunable-stale-record repair. This is not a claim that apply and disposal are
  fully crash-atomic.
- Security probe compatibility for npm 12 object-shaped and npm 11 array-shaped
  `npm pack --dry-run --json` listings, without relaxing secret patterns,
  scanning scope, or waiver accounting.
- Existing fake-executor CLI, checkpoint/resume paths, Pi compatibility probe,
  security probe, and preview-release gate.

## Verification boundary

The preview gate is `pnpm prerelease`: preview probe, workflow/type/lint/test/
build gate, packaged-security probe, and Pi adapter probe. This preview does
not claim independent acceptance, live-provider verification, adaptive policy
activation, production authorization, or Outcome-supported capability.

## Use

```bash
corepack enable
pnpm install
pnpm prerelease
pnpm cli version
```

## Review and verification record

PR #54 was integrated into main as `dd9699b57eabb26810149ad9625593a41eab1b1d`
under the owner-delegated integration decision recorded in
[the PR #54 review package](2026-10-06-pr54-author-review-package.md). The
behavior head `ebc8d8fd` passed local `pnpm prerelease` with tests
3272 / 3253 pass / 0 fail / 19 skip, build PASS, preview probe 5 PASS,
security probe 26 PASS / no findings, and Pi probe 4 PASS. The decision-head
and merged-main hosted CI runs also passed; merged-main CI run
[`37465254859`](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37465254859)
completed successfully.

PR #56 reconciled the active task and status records as
`324cd5b00eef7914123fc0b9ca281238189d1581`; its documentation-only CI and the
resulting main CI run
[`37466427826`](https://github.com/Xhhemoing/pi-sparkle/actions/runs/37466427826)
also passed.

This is author verification and recorded owner-delegated integration. It is
not independent acceptance. Independent review of the exact merged source,
R10/R11 evaluator-definition and candidate-snapshot review, full
crash-atomicity, production apply, automatic write-to-apply chaining,
live-provider verification, npm publication, adaptive activation, and
Outcome-supported claims remain open.

The GitHub Release and tag for this preview are separate owner-authorized
publication actions. The GitHub Release for `0.1.0-preview.2` remains
uncreated.

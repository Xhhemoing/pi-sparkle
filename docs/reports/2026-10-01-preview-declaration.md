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

## Review and verification record

The review found and fixed a historical-binding issue in
`createEvaluationRecord`: caller-owned target, evaluator, and dependency
objects are now copied at record creation, so later mutation cannot rebind
stored evidence. Regression coverage is in
`test/unit/evaluation/evidence-invalidation.test.ts`.

At commit `ecddcca82afc30115fe9683236be712f71170ae2`, the focused command

```
node --import tsx --test test/unit/evaluation/evidence-invalidation.test.ts test/unit/learning/project-key-case.test.ts test/unit/cli/adapt.test.ts test/integration/cli/cli.test.ts
```

passed 72 tests with 0 failures and 0 skips. Local workflow-check, typecheck,
lint, build, preview-release probe, security probe (26 findings passed), and Pi
compatibility probe also passed. The repository `pnpm test` wrapper could not
be used in this sandbox because tsx's IPC pipe is denied; hosted CI remains the authoritative full gate. PR #52 CI run `36875581897`
passed quality (`110414386604`), Ubuntu smoke (`110414386841`), and Windows
smoke (`110414387073`).

This is author verification only. No independent acceptance, live-provider
verification, npm publication, production apply, adaptive activation, or
Outcome-supported claim is made.

The hosted quality job ran the full workflow contract, typecheck, lint, test,
build, security, Pi compatibility, kernel reuse, and built CLI version steps.
The preview probe itself also passed locally with all five findings clear.

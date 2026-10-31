# Explicit development CLI

- ID: `TASK-20261015-development-cli`; owner: runtime agent (DP-05 CLI).
- State: `ready-for-review`; baseline stage-two shared source on `c2b802c`.
- Contracts: ADR-001 adapter isolation; host-authored work definitions and
  explicit candidate review; unknown effects are never blindly rerun.

## Scope and acceptance

Add `develop init/status/next/candidates/run/accept/reconcile/release`, structured
JSON and help. Queue identity selects only a safe runtime development directory.
Initialization reads at most 1 MiB of strict host definitions and runs no checker.
Run requires explicit fake or Pi mode, with 3 attempts/600000 ms bounded defaults.
Fake performs no LLM calls or edits; real Pi receives only supplied scoped read
and write tools. Validation completes before mutating queue state. Acceptance
is an explicit host action, separate from source application. Reconciliation
uses completed receipts; release invalidates only a claim and warns that unknown
effects remain unresolved. No controller/native/execution changes or live calls.

## Files and test-first plan

Own new `src/cli/development.ts`, additive main USAGE/dispatch, README command row,
CLI-focused tests and this plan/report. First pin help/dispatch and failing CLI
init/validation/fake/review/reconciliation behavior against temporary Git repos.
Then implement over `DevelopmentController`, `WorkItemStore` and the existing
adapter factory. Run targeted CLI/controller checks, TypeScript, ESLint and
workflow validation; root owns independent review and full integrated gate.

Abort if implementation would require automatic source apply, unknown-effect
replay, bypassing evidence verification or importing SDK types outside adapter.

## Verification

Initial CLI regressions: RED 0 pass / 6 fail. Implemented suite: 9 CLI cases;
with controller, README/help parity and existing frozen error-route checks,
25/25 pass. TypeScript, changed-file ESLint, workflow and diff checks pass.
Independent review and integrated full gate remain with the coordinating agent.
See [the verification report](../../reports/2026-10-15-development-cli.md).

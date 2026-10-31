# Native verification cancellation — 2026-10-02

## Scope and result

This record closes a bounded PS-03/O02 implementation slice on branch
`codex/continue-plan-20261002`, based on main `ab2f11394b46295182ac23185b2c5841c4d7788f`.
It replaces synchronous verification and coding-command execution with the
shared shell-less `runAuthorizedCommand` runner. Abort and shutdown signals now
reach candidate verification and candidate-scoped command tools; cancellation
waits for the child process and its output pipes to close. Output is bounded
per stream, and cancellation, timeout, output limit, and spawn failure remain
distinct runner outcomes. A cancelled or shut-down write retains its candidate
and failure evidence. Apply checks cancellation after candidate verification,
before any candidate staging or source checkout.

## Changed files

- `src/execution/command-runner.ts`: asynchronous authorized runner with signal,
  timeout, process cleanup, bounded output, and terminal status.
- `src/execution/independent-check.ts`, `src/execution/closed-loop.ts`,
  `src/native/write-session.ts`, `src/native/apply.ts`: Promise/signal
  propagation and cancellation refusal.
- `src/pi-adapter/worktree-coding-tools.ts`: candidate command tool uses the
  shared runner and session signal.
- `src/execution/index.ts`: exports the runner contract.
- Tests cover pre-abort, in-flight abort, output limit, verification abort,
  source preservation, and all previous native reliability cases.

## Verification

- RED: importing the new runner failed before implementation (`ERR_MODULE_NOT_FOUND`).
- Focused native/execution command: **58 pass / 0 fail / 0 skip**.
- Additional write-session cancellation test: **9 pass / 0 fail / 0 skip**.
- Additional apply cancellation and existing apply suite: **12 pass / 0 fail / 0 skip**.
- `node_modules/.bin/tsc --noEmit`: PASS.
- ESLint on all changed runtime and focused test files: PASS.
- `git diff --check`: PASS.

The package wrapper could not be used after dependency reinstallation because
pnpm's non-interactive install requires build-script approval for existing
dependencies; the direct TypeScript runner and local test commands above are
the authoritative checks for this worktree. Hosted CI remains required before
merge.

## Boundaries still open

This does not close O03 cross-instance disposal, crash-atomic apply, R10/R11
evaluator/candidate snapshot review, S0-min, live-provider or holdout runs,
production authorization, F6/F-PROD, or Outcome-supported status. The GitHub
Release for `0.1.0-preview.2` remains uncreated; publication is a separate
blocked action because the connector has no create-release/ref operation and
the secure browser login handoff was declined.

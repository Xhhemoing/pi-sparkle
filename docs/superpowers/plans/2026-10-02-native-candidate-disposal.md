# Task Plan: issued candidate disposal across management instances

Task ID: `TASK-20261002-o03-issued-candidate-disposal`

## Goal

Close the non-crash portion of O03 using the existing run-scoped registration and loop-artifact storage. A trusted host-issued candidate must be removable by a fresh management instance only when the source repository, candidate path, accepted base revision, and registration receipt still agree.

## Scope

- Bind source identity into registration schema 2.
- Add an authorized disposal path that revalidates the live Git worktree.
- Persist a disposal receipt after successful removal for idempotent retries.
- Keep failed removal and replaced paths available for inspection.
- Expose disposal through a host-only command with JSON and quoted positional input.

## Exit criteria

- `issue → apply → fresh management instance → dispose` succeeds.
- The same disposal request returns `DISPOSED` without a second filesystem mutation.
- Foreign, replaced, or unregistered paths are refused.
- Run evidence remains available after disposal.
- Changed-file typecheck, lint, focused tests, and diff checks pass.

## Deferred

Crash reconciliation after Git removal but before disposal-receipt persistence remains under R10/R11. Automatic cleanup, production authorization, and write-to-apply chaining remain out of scope.

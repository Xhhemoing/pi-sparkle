# Development Workflow Rollout Record

- Date: 2026-09-12
- Branch: `cursor/ps-hotfix-provider-fail-attribution`
- Scope: repository development, planning, testing, verification, review, and durable knowledge workflow

## Delivered

- Added root [`AGENTS.md`](../../AGENTS.md) as the contributor/agent operating contract.
- Added [`docs/development-workflow.md`](../development-workflow.md) covering intake, source-of-truth precedence, planning, TDD, gates, review, closeout, and process health.
- Added [`tasks/README.md`](../../tasks/README.md) defining active task files, state meanings, and evidence requirements.
- Added [`docs/templates/task-plan.md`](../templates/task-plan.md) and [`docs/templates/verification-record.md`](../templates/verification-record.md).
- Added `scripts/workflow-check.mjs` and `pnpm workflow:check`; `pnpm gate` and CI now run the workflow contract check before code checks.
- Updated `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `README.md`, `tasks/plan.md`, and `tasks/todo.md` to point to the same process.
- Added `test/unit/package/workflow-check.test.ts`, including missing-file failure and current-repository success cases.

## Verification

| Command | Result | Evidence |
|---|---|---|
| `pnpm test -- test/unit/package/workflow-check.test.ts` | PASS, 2/2 | workflow checker behavior |
| `pnpm workflow:check` | PASS | 10 required files, 16 required headings |
| `pnpm typecheck` | PASS | exit 0 |
| `pnpm lint` | PASS | exit 0 |
| `pnpm build` | PASS | exit 0 |
| `pnpm gate` | BLOCKED | typecheck/lint passed; full test phase had 1 failure |

## Existing Worktree Failure

The full gate failure is in the pre-existing hotfix worktree, not in the new workflow files:

- Test: `test/unit/tracking/option-a-preconditions.test.ts:268`
- Failure: the source census expected `src/pi-adapter/pi-executor.ts` to contain only `<runtime>`, while the current dirty hotfix also contains `UNOBSERVED`.
- Current dirty business files include `src/learning/signals.ts`, `src/pi-adapter/pi-executor.ts`, `src/routing/failure-class.ts`, and related tests, plus two pending reports. They were not reverted or modified by this rollout.

## Handoff

Before merge, synchronize the hotfix implementation with its pinning test or record the intentional contract change, then rerun `pnpm gate`. Do not mark the merge gate green from the separate typecheck, lint, build, and workflow-check passes.

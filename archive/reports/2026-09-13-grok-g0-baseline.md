# G0 baseline — reproducible workflow (2026-09-13)

## Identity
- Seat: Sparkle Implementer
- Ticket: PS-G0 / `TASK-20260913-grok-trusted-execution`
- Worktree: `E:\Project\pi-sparkle-g0`
- Branch: `grok/trusted-execution-g0`
- Base SHA: `6ee16a3722fda35d9b6098144602f199fb0a7d0f` (`origin/main`, PR #36 merge)
- Node: v24.18.0 · pnpm: 10.15.0
- Dirty clone `E:\Project\pi-sparkle` left untouched (HOTFIX/src not transplanted)

## Baseline gate (before workflow:check)
- Command: `pnpm gate` on clean base (no `workflow:check` in `package.json` yet)
- Exit: **0**
- Summary: typecheck + lint + test + build; tests 2741, pass 2723, fail 0, skipped 18
- Note: `workflow:check` was **missing** on base — recorded, not claimed passed

## Workflow rollout applied (workflow-only)
Added: `AGENTS.md`, `docs/development-workflow.md`, `tasks/README.md`, `docs/templates/*`, `scripts/workflow-check.mjs`, `test/unit/package/workflow-check.test.ts`, rollout + delivery-status reports, trusted-execution plan.
Updated: `package.json` (`workflow:check` + gate wiring), `.github/workflows/ci.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `README.md`, `tasks/plan.md`, `tasks/todo.md`, `tasks/adaptive-plan.md` (P0 reconciliation note only).
**Excluded:** all HOTFIX `src/` / learning / routing / pi-adapter dirt from the dirty clone.

## Post-apply checks
- `pnpm test -- test/unit/package/workflow-check.test.ts` → exit 0 (2 pass)
- `pnpm workflow:check` → exit 0 (`workflow-check: ok`)
- `pnpm gate` → (see freeze paste)
- `git diff --check` → (see freeze paste)

## PR #36 independent review archive
- GitHub `reviews` / review comments for PR #36: **empty**
- Status: `unavailable` + SCM/xhh owner to supply room Reviewer PASS artifacts with exact SHAs
- Merge fact is separate: PR #36 MERGED; main includes tip `4804d4c`

## Acceptance mapping
- Clean clone can read ops rules (AGENTS + development-workflow + tasks/README) and run gate including `workflow:check`
- Dirty clone uncommitted HOTFIX not lost / not smuggled into this tip
- PR #36 merge vs missing review materials recorded separately above
## Freeze gate paste (post-rollout)
```
command: pnpm gate
cwd: E:\Project\pi-sparkle-g0
exit: 0
summary: workflow-check ok; typecheck+lint+test+build; tests 2743 pass 2725 fail 0 skipped 18; git diff --check exit 0
```

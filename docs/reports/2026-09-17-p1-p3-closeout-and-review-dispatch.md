# P1/P3 closeout and independent-review dispatch record — 2026-09-17

## Scope

Session executed the P1/P3 recommendations from the 2026-09-17 status analysis:
local flake-test commit, TASK-20260917 closeout, adaptive-plan reconciliation,
origin/main sync into the hotfix line, PR #43 delivery, and a retry of the PR
#42 independent-review dispatch. No F6, provider, holdout, or seal activity.

## What landed (branch `cursor/ps-hotfix-provider-fail-attribution`)

| Commit | Content |
|---|---|
| `6ae179c` | test(privacy): await unlocked writer before delete-outcome assertions (flake fix, test-only) |
| `9066b47` | docs(tasks): close TASK-20260917 (monitoring-only, abort-condition decision) + reconcile adaptive-plan checkboxes with the authoritative 2026-08-21 closeout |
| `2dc978d` | merge: sync origin/main `fe25330` into the hotfix line (5 conflict files resolved; main's `taskFailureForProvider` retained; reconciliation notes inline) |
| `732b442` | docs(reports): delete-writer race flake resolution report |
| `7c908ee` | test(routing,tracking): reconcile pins with main's enhanced provider classifier (429 → `provider`; census `<runtime>`-only) |

## Merge reconciliation notes (conflict review)

- `src/pi-adapter/pi-executor.ts`: took main's `taskFailureForProvider` version
  (category `PROVIDER_ERROR`, status/kind detail). Both sides synthesize
  UNOBSERVED verification and never FAILED-with-empty-evidence; semantics
  identical on the invariant that matters (never model FAIL for infra).
- `src/routing/failure-class.ts` / `provider-retry.ts` / `signals.ts`: merged
  clean or auto; one observable behavior difference pinned in
  `failure-class.test.ts` — FAILED + empty evidenceIds + 429 summary is now
  `provider` (PROVIDER_HINT), not the original hotfix's `environment`. Both
  keep the failure out of the model posterior.
- `option-a-preconditions` census: main assigns the synthesized UNOBSERVED
  object to a variable before the yield, so the source-form census sees only
  `<runtime>`; local pin updated with rationale.
- `tasks/plan.md` / `tasks/todo.md` / `tasks/adaptive-plan.md` /
  `pending-local-review.md`: merged both sides' facts; authoritative closeout
  state kept; superseded prose retained as history (nothing silently dropped).

## Verification (merged head `7c908ee`, Windows / Node v24.18.0 / pnpm 10.17.1)

| Command | Result |
|---|---|
| focused (pi-adapter, routing, learning, tracking, privacy, persist) | **715 pass / 0 fail** |
| `pnpm gate` | exit 0 — **2752 pass / 0 fail / 18 skip** (workflow:check, typecheck, lint, test, build all ok) |
| `pnpm security:probe` | no open findings |
| `pnpm pi:probe` | PASS (pin 0.85.1) |
| Hosted CI on PR #43 head `7c908ee` | quality + cli-smoke (ubuntu, windows) all SUCCESS |

## PR delivery

- **PR #43** opened: `hotfix(learning): provider failures never score as model
  FAIL + workflow governance` — base main, head `7c908ee`, MERGEABLE, three
  hosted checks SUCCESS. Gate output and AI-merge conflict-review checklist
  completed in the PR body. Not merged: awaits independent review + owner
  authorization.
- **PR #42** remains OPEN at `aeb4993` (unchanged this session); its CI is
  green and same-head author-run evidence is complete.

## Independent-review dispatch attempts (PR #42, turnkey protocol)

- 2026-09-17 (this session): subagent reviewer dispatch retried with the exact
  protocol from `2026-09-16-rr-fix-review-package.md` (fresh worktree
  checkout of `aeb4993`, old 5 + new 3 regression probes, focused 61, gate +
  probes, line-by-line RR diff review, verdict report under
  `.agent_workspace/rr-review-20260917/`). **Failed before start: OpenAI API
  error 402 — budget pool quota exhausted.** Same failure mode as the
  2026-09-16 attempts; no provider capacity is available to this repo's
  dispatch path right now.
- **Independent review therefore remains with the owner / Grok bot.** The
  protocol is turnkey: fresh checkout of `aeb4993`, run the two probe files
  from `.agent_workspace/grok-rereview/` against it (expect 5/5 and 3/3),
  focused 61/61, `pnpm gate` (~2771/0/18), `pnpm security:probe`,
  `pnpm pi:probe`, then line-by-line review of `git diff fe25330..aeb4993`
  (RR1/RR2/RR4 map in the review package). Acceptance = independent PASS +
  owner authorization, then merge PR #42. The same reviewer pass should cover
  PR #43's merge commits (`2dc978d`, `7c908ee`) or be repeated on its final
  head before that PR merges.

## Explicitly not closed

- PR #42 and PR #43 not merged (owner actions after review PASS).
- PR #36 evidence gaps (per-stage Reviewer PASS artifacts + owner
  authorization links) remain with SCM/xhh.
- F6 NOT READY: 100+15 spec authoring, SM95 custodian key, price-table freeze,
  seal — all pending, gated behind the delivery lines above.
- Worktree cleanup deferred until after review PASS (temp detached worktrees
  with uncommitted scratch deletions are owner decisions).

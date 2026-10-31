# Delivery gate unblock

## Identity

- ID: `TASK-20260918-delivery-gate-unblock`
- Owner: coding agent (coordination); reviewer, SCM/xhh and experiment owner (external gates)
- State: `in-progress`
- Date opened: 2026-09-18
- Contracts: development-workflow section 6, ADR-005/007, status-matrix F-PROD.

## Problem and Scope

Coordinate missing reviews/evidence, reconcile F6 prerequisites and preserve
dirty temp trees. Scope: PR requests, documentation and metadata checks only.
Non-goals: product edits, inferred approvals, paid holdout runs, secret access,
seal, forced removal, history rewriting or push/merge before gates.

## Acceptance Criteria

- [x] Record live PR identities/checks and actionable review requests.
- [x] Request six PR #36 stage artifacts and original authorization source.
- [x] Record F6 ordering, existing drafts/prices and validity/runner blockers.
- [x] Inventory three temp trees; preserve changes pending review/disposal approval.
- [x] Run workflow, diff and targeted link/content checks (results in verification record).
- [ ] External closure: independent PASS, human conflict review and owner authorization before merge; not implied by coordination completion.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `docs/reports/2026-09-18-delivery-gate-unblock.md` | Evidence, requests, cleanup inventory, handoff | agent | No invented history |
| `tasks/plan.md`, `tasks/todo.md` | Link active work; retain open gates | agent | Preserve historical reports |
| `docs/status-matrix.md` | Link F6 blockers | agent | No F-PROD closure |
| `holdout/README.md`, `holdout/BACKLOG-DRAFT.md` | Correct stale operator instructions | agent | No plaintext/key exposure or key overwrite |
| PR #36/#42/#43 comments | Exact review/evidence requests | agent | No approval impersonation |

## Test-First Plan

Docs/process only; product regression tests not applicable. Focused: live
`gh pr view`, git parent/worktree inventory, JSON census and price digest.
Delivery: `pnpm workflow:check`, `git diff --check`, targeted link/content check.
Full product gate/probes remain part of independent pinned-head review.

## Gates and Handoff

- Stop on head drift; rebind review/authorization to changed candidate.
- PR #43: review `2dc978d` against both parents and `7c908ee` follow-up;
  human line-by-line conflict review still required.
- SCM/xhh supplies original PR #36 evidence; new review cannot backdate it.
- F6: complete custodian-held 100+15 materials, SM95 key metadata, price binding,
  then seal after validity, preregistration and runner readiness gates.
- Cleanup: review PASS, preserve dirty/ignored content, owner-approved exact
  manifest, then approved paths only; no force removal by default.
- Abort/rollback: preserve all branches/trees; undo only this task docs if
  rejected. No automatic merge or deletion.

## Closeout

Initial identity: `13f954e211834b81808acef5bd63a7812fed4e1d`.
Documentation verification passed: workflow check, diff check, 71 local links
across seven files and custody content checks. External closure remains open;
no merge, seal or worktree cleanup. Custody format (ADR age vs script AES-GCM
JSON) also requires owner/custodian resolution before seal.
Evidence: [verification record](../../reports/2026-09-18-delivery-gate-unblock.md).

# PS-01: unify current capability status (report execution reconciliation)

Task: `TASK-20261001-ps01-status-reconciliation`. Date: 2026-10-01.
Owner: implementation agent for documentation; maintainer/independent reviewer for independent acceptance (remains open, not claimed here).
State: planned, before doc edits.
Baseline: main `46e1af0` (post PR #47 merge `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7` and PR #48 merge `b114255bd815617068b3b46bfb3848eac0b8e6e5`).

## Problem and Scope

### Problem

`docs/status-matrix.md` § "Report execution candidates (2026-09-29)" still opens with "Branch-scoped source in PR #47, not an assertion of main merge or independent acceptance". PR #47 is merged (as `4df5baff`, 2026-09-29) and PR #48 (C2-evidence-1 command-evidence provenance) is also merged (as `b114255`, exact head `f856b29`, CI run `36525786135`). The section therefore under-reports current state and omits PR #48's precise sub-scope. It also does not distinguish per-capability which gates are merged-fact versus still-open.

### In scope

- Retitle the section to a dated 2026-10-01 reconciliation; replace the stale PR #47 branch-only sentence with merged-source facts (exact merge SHAs and dates).
- Add a "Command-evidence provenance (C2-evidence-1)" row recording PR #48's bounded sub-scope: unbound command output returns UNOBSERVED; actual/expected provenance stays distinct; malformed evidence refuses; metadata arrays are snapshots. UNOBSERVED without a recorded revision/changeSet stays explicit.
- Per capability, record: source merged (exact SHA) / entry wired / offline exercised / independent accepted (open) / live verified (open) / outcome supported (open, `no`).
- Keep independent acceptance explicitly NOT PASS; keep all remaining checklist items and roadmap rows in `tasks/report-execution-todo.md` exactly as open, adding only the dated merge-fact lines.
- Update `tasks/report-execution-todo.md` header to record PR #48's merge fact alongside PR #47's.

### Out of scope

- No runtime source, test, workflow, or dependency changes; no second runtime event source; no structured-capability generator tooling beyond the table cells.
- No history rewrite: prior dated evidence records stay as written; nothing is marked closed that was not.
- PS-03 (O02/O03 lifecycle) stays with its existing owner; untouched here.

## Acceptance Criteria

- [ ] The 2026-09-29 stale branch-only sentence is gone; the section states merged-source facts with exact SHAs for PR #47 and PR #48.
- [ ] A per-capability status row exists for PR #48's command-evidence provenance sub-scope, stating the UNOBSERVED-without-revision/changeSet contract.
- [ ] Each capability row separates source merged / wired / exercised (automated facts) from independent accepted / live verified / outcome supported (all open, outcome column `no`).
- [ ] No previously-open gate is marked closed; historical failure/skip records are untouched.
- [ ] `pnpm workflow:check` passes; `git diff --check` clean.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `docs/status-matrix.md` | § Report execution candidates: retitle 2026-10-01, rewrite stale preamble, add PR #48 row, split merged-fact vs open-gate columns/wording | implementation agent | docs-only; low risk |
| `tasks/report-execution-todo.md` | Header: record PR #48 merge `b114255` / head `f856b29` / CI `36525786135`; keep all open checkboxes unchanged | implementation agent | docs-only; low risk |

## Test-First Plan

- Red test: none — documentation-only slice (per AGENTS.md test-first rule exemption for docs).
- Focused command: `pnpm workflow:check`
- Integration/acceptance command: `git diff --check` and reviewer re-read of both files against the merge facts below.
- Negative and recovery cases: none applicable; revert is the recovery path.

## Gates and Handoff

- Human/policy gate: none closed by this slice; independent acceptance of PR #47/#48 capabilities and all owner/experiment/production gates remain open and are not asserted.
- Rollback or abort condition: factual mismatch against the recorded merge SHAs; abort and correct, never relabel.
- Required durable records: this plan; the updated status-matrix section; the updated checklist header; a dated closeout note in the delivery evidence report.
- Next command after handoff: proceed to PS-02 RED regression slice on a separate branch.

## Closeout

- Verified commit/date: pending implementation.
- Commands and outcomes: pending.
- Open risks/follow-ups: independent acceptance of both PRs' capabilities remains open; C2-evidence host portions still wait for B2/S0-min.
- Evidence links: PR #47 merge `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7` (2026-09-29); PR #48 merge `b114255bd815617068b3b46bfb3848eac0b8e6e5`, head `f856b2973548aced684671654a50ec98e1403dba`, CI `36525786135` (2026-09-29); local main `46e1af0`.

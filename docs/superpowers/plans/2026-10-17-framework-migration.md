# Framework migration and project organization

## Identity

- ID: `TASK-20261017-framework-migration`
- Owner: root/integration agent, with disjoint M0-B, M1-A and M2-A authors.
- State: `in-progress`; opened 2026-10-17 UTC.
- Authority: user requested continued migration and project organization, explicitly authorizing all pushes; accepted [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md).
- Baseline: PR #60 `aac7a380`; main `44db4b1` and PR #61 remain separate.

## Problem and Scope

Continue the bounded migration rather than introduce a second scheduler or task
store. Publish the previous verified M0-A tree, close atomic admission and
unrelated-work readiness gaps, deliver the smallest direct-task host entry,
and move shared definitions out of CLI/privacy application layers.

Organize current work into one migration checklist. Archive the three completed
architecture-documentation task summaries with their original dated evidence;
retain open runtime, policy and experiment items. Preserve other checkouts,
branches, drafts and historical evidence. No main merge, release, live model
run, package export commitment or production apply is part of this slice.

## Acceptance Criteria

- [ ] Previous M0-A publication is read back with the exact verified tree.
- [ ] M0-B atomically admits overlapping effects through the existing ledger;
  unrelated ready tasks can continue without weakening dependent verification.
- [ ] M1-A executes a direct task through `NativeWriteSession`, retaining checks,
  bounded repair, cancellation and uncertain-effect results.
- [ ] M2-A removes the runtime CLI preference cycle and inverted catalog/layout
  dependencies while preserving old export identities and durable paths.
- [ ] Current task navigation is compact, archived links resolve and historical
  facts remain distinguishable from current verification.
- [ ] Focused regressions, cross-author review, full pinned `pnpm gate`, security
  and Pi probes pass; exact remote source/evidence publication is verified.

## Implementation Slice

| Scope | Owner | Detailed contract |
|---|---|---|
| Atomic admission and scoped readiness | M0 author | [M0-B plan](2026-10-17-m0-atomic-admission.md) |
| Direct task entry and real candidate tests | M1 author | [M1-A plan](2026-10-17-direct-development-task.md) |
| Module boundaries and compatibility guards | M2 author | [M2-A plan](2026-10-17-m2-boundary-cleanup.md) |
| Task navigation, migration/status/README and report | Root | `tasks/`, existing architecture/status docs, dated verification |
| Hosted cross-platform focused regression list | Root | Add new M0/M1/M2 cases to existing Ubuntu/Windows CI job; keep existing jobs and policies |
| Integrated diff review | Source-disjoint reviewer | Findings resolved before final delivery |

## Test-First Plan

Each runtime author records an actual focused RED before implementation, then
GREEN and adjacent regressions. Root serializes timing-sensitive process tests
and final gate, records initial failures without erasing them, and does not use
old M0-A counts as evidence for the new source.

Organization is documentation-only: inspect exact moved sections, verify local
Markdown links, run `pnpm workflow:check` and `git diff --check`. No redundant
unit test is added for prose moves.

## Gates and Handoff

Pushes are authorized by the current user instruction. Updates use an expected
remote head and fast-forward parent, with tree readback. The previous automatic
push-approval rejection is historical, superseded by this explicit authority;
the recovered checkout's HTTPS credential gap is handled by the connected
GitHub API, not by changing global credentials.

Stop on unexpected concurrent remote changes, contract/schema differences,
lost compatibility or unresolved review findings. Retain uncertain effects and
claims. Full OS containment/Windows qualification, old-writer isolation,
terminal-ledger archival, general command-tool uncertainty, stable SDK,
live-provider and existing policy/production gates remain open.

## Closeout

Current evidence and remaining commands will be recorded in
[`2026-10-17-framework-migration.md`](../../reports/2026-10-17-framework-migration.md).

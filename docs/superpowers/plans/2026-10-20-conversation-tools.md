# Host-bound conversation tools

## Identity

- ID: `TASK-20261020-conversation-tools`
- Owner: cloud root coordinator; one extension/test implementation writer.
- State: `planned`; implementation follows current-source validation where executable.
- Date opened: 2026-10-20 America/Los_Angeles.
- Authority: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md), [cloud continuation](2026-10-20-cloud-continuation.md), [conversation host](../../conversation-host.md).

## Problem and Scope

### Problem

ConversationSession already implements closed question/status/focus/restore/run-direct requests, generation checks, in-memory provenance deduplication and unsettled-effect fencing. The actual Pi extension does not register a conversation tool. Reuse that implementation rather than introducing another interpreter or scheduler.

### In scope

Add an explicitly host-configured extension factory and two tools: `sparkle_conversation_focus` (bootstrap focus token and permitted references only) and `sparkle_conversation` (the existing closed request union). The trusted host supplies all project/task bindings, paths, executors and checkers. Each extension instance owns a fresh session, abort controller and pending-call set.

### Out of scope

No new accept/apply authority, automatically issued candidate handles, model-supplied host configuration, paid provider calls, durable request deduplication, C3 recovery, classifier model or natural-language effectiveness claim. Existing default delegate/apply registration remains compatible. The native kill switch still disables all registration.

## Acceptance Criteria

- [ ] Real Pi loader registers and executes configured handlers; default registration remains unchanged.
- [ ] Questions/status never dispatch work or mutate focus; temporary focus/restore work through handlers.
- [ ] Host-authorized direct work executes against a real Git candidate, leaves the source unchanged and does not gain an apply handle.
- [ ] Unknown references, extra path/checker/executor/authority fields, stale/cross-session tokens and duplicate request/message provenance fail closed.
- [ ] Late results remain tied to their original target and are marked stale after focus changes.
- [ ] Cancellation and shutdown wait for real settlement; shutdown closes new entry synchronously and does not permit another writer while the first is settling.
- [ ] Usage docs, status, active tasks and actual independent diff review are recorded.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `extensions/pi-sparkle/index.ts` | Add trusted factory; register narrow handlers; compose lifecycle shutdown | implementation writer | Preserve existing apply issuance and native shutdown |
| `src/conversation/session.ts` | Only an additive safe reference-list accessor if needed | implementation writer | No changes to dispatch authorization or request validation |
| `test/integration/conversation/extension.test.ts` | Actual loader/handler and Git candidate regressions | implementation writer | No paid provider; no full build inside tests |
| `test/unit/native/extension.test.ts` | Preserve default surface pin; configured surface/kill-switch assertions | implementation writer | Intentional additive host-configured interface |
| `docs/conversation-host.md`, `docs/conversation-workflow.md` | Runnable host factory usage and limitations | root | Clearly distinguish tools from C3/understanding |
| Active tasks, status matrix and report | Current evidence and next condition | root | No historical-result relabeling |

## Test-First Plan

- Red test: real Pi loader cannot load the proposed named host factory, or configured registration lacks the tool. Record the intended failure before implementation.
- Focused command: `pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/focus.test.ts test/integration/conversation/`.
- Integration/acceptance command: `pnpm gate`, then sequential `pnpm security:probe` and `pnpm pi:probe` on the final candidate.
- Negative and recovery cases: all acceptance cases above; original unvalidated request object passes into the session parser (no accessor-triggering copy); empty focus-tool parameters reject extra fields; abort signal composition never releases an in-flight occupancy prematurely.

## Gates and Handoff

- Human/policy gate: existing production, paid provider, external effects, main merge and experiment permissions remain unchanged.
- Rollback or abort condition: stop conflicting writes, preserve in-flight ownership and report unresolved settlement. Do not grant acceptance to recover from shutdown failure.
- Required durable records: root verification report and actual read-only independent source review, plus active plan/checklist/status updates.
- Next command after handoff: the focused command above after dependencies and the initial candidate gate are available.

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending; no runtime implementation or test pass claimed by this plan.
- Open risks/follow-ups: C3 durable recovery and platform containment remain separate.
- Evidence links: [cloud handoff](../../reports/2026-10-20-cloud-handoff.md).

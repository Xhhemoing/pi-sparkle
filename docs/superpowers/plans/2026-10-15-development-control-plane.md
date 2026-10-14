# Project development control plane, stage two

## Identity

- ID: `TASK-20261015-development-control-plane`
- Owner: root integration; file-disjoint implementation agents and independent reviewers.
- State: `in-progress`
- User direction: continue the plan until all tasks are handled, with staged saved results (2026-10-15).
- Baseline: stage-one `c2b802c3`, PR #60; reviewed runtime implementation `14ffc2a4` passed five hosted jobs.

## Problem and Scope

Stage one repairs a single candidate. The next queue in the architecture report still needs project work-item selection, host criteria carried into writing, stronger exact-byte verification, durable operation identity/reconciliation, and an explicit developer entry point. A development agent must not advance a backlog using its own SUCCESS string or replay an uncertain side effect after a crash.

### In scope

- A host-authored scoped work queue with deterministic selection, validated dependency graph, file scope, exclusive fenced claims, and evidence-resolved transitions.
- Named native-write acceptance criteria and immutable contract artifacts, preserving absent-option compatibility.
- Optional trusted host verification definitions and bounded exact candidate/checker equality checks; no cryptographic identity or raw snapshot persistence.
- Durable action intent/claim/checkpoint/completion, with explicit reconciliation for uncertain effects.
- A controller over these existing native/write/verification APIs, and an explicit CLI for queue/candidate status, next selection and bounded development.
- Behavior-preserving extraction of CLI executor/flag assembly, with a separately reproduced correction for configured fallback options being dropped at the runtime factory.
- A small task evaluation harness and metrics that can run offline; a live provider run remains opt-in and requires available credentials/host budget. Do not invent live-model outcomes.

### Out of scope / retained boundaries

No automatic application to the user's source, merge, release, adaptive promotion, owner gate closure, global credential changes, or blind replay of unknown external effects. This request authorizes implementation and testing; production/outcome decisions remain distinct. A safe stop is a recorded blocked/reconciliation state, not an unchecked success.

## Acceptance Criteria

- [ ] Queue rejects unknown/cyclic dependencies and malformed/oversized data; priority selection is deterministic and file claims cannot overlap.
- [ ] Concurrent claims have one owner; stale tokens cannot settle a newer task; real host artifact verification is required for ready/accepted state.
- [ ] Named criteria reach the actual worker prompt/task and each attempt's durable contract record; verifier/limits are fixed before execution.
- [ ] Opt-in verification detects same-length changes to candidate or host checker and fails closed on unavailable bounded snapshots; absent opt-in preserves legacy behavior.
- [ ] Crash after effect/before completion does not execute it again; completed-action recovery finishes only the missing state transition after rechecking evidence.
- [ ] CLI gives explicit next/status/run/reconciliation behavior and retained candidate references; no child text performs source application.
- [ ] CLI extraction preserves pinned help/events/errors; configured model fallback reaches the Pi executor and does not duplicate the selected model.
- [ ] Evaluation metrics distinguish offline mechanism tests and live model effectiveness; skipped/unavailable live trials are reported accurately.
- [ ] Every stage is test-first, reviewed, recorded and saved as a commit/PR checkpoint before the next stage expands.

## Ownership

| Files | Owner |
|---|---|
| `src/development/work-items.ts`, queue store/tests | baseline agent |
| `src/development/action-ledger.ts`, action store/tests | research agent |
| Native write/preflight criteria and contract tests | native loop agent |
| Trusted verification and exact candidate equality in `src/execution/` | cleanup agent |
| Extracted CLI executor/options, runtime fallback wiring | runtime agent |
| Development controller/CLI, evaluation harness, common docs/state and staged delivery | root |

## Test-First Plan

Plans for each slice precede behavior edits. Regression coverage includes duplicate claims, stale receipts, fabricated success, evidence drift, exact same-length rewrites, cancellation, persistent corruption, signal termination and crash windows. Run focused checks before full gate-equivalent commands and hosted Node22/Linux/Windows gates. Preserve environment failures rather than weakening assertions.

## Gates and Handoff

Original task documents remain the project roadmap authority; scoped runtime queues are authoritative only for their host-declared work. Explicit host review accepts a candidate; automatic application is not part of queue progression. Stale/uncertain records require reconciliation, not lock stealing. Stage results are saved on PR #60 or a follow-up branch with exact tree identity.

## Closeout

Pending stage-two implementation and independent verification. Checklist: [development control-plane tasks](../../../tasks/development-control-plane-todo.md).

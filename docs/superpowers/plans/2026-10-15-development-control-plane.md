# Project development control plane, stage two

## Identity

- ID: `TASK-20261015-development-control-plane`
- Owner: root integration; file-disjoint implementation agents and independent reviewers.
- State: `ready-for-review`
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

- [x] Queue rejects unknown/cyclic dependencies and malformed/oversized data; priority selection is deterministic and file claims cannot overlap.
- [x] Concurrent claims have one owner; stale tokens cannot settle a newer task; real host artifact verification is required for ready/accepted state.
- [x] Named criteria reach the actual worker prompt/task and each attempt's durable contract record; verifier/limits are fixed before execution.
- [x] Opt-in verification detects same-length changes to candidate or host checker and fails closed on unavailable bounded snapshots; absent opt-in preserves legacy behavior.
- [x] Crash after effect/before completion does not execute it again; completed-action recovery finishes only the missing state transition after rechecking evidence.
- [x] CLI gives explicit next/status/run/reconciliation behavior and retained candidate references; no child text performs source application.
- [x] CLI extraction preserves pinned help/events/errors; configured model fallback reaches the Pi executor and does not duplicate the selected model.
- [x] Evaluation metrics distinguish offline mechanism tests and live model effectiveness; skipped/unavailable live trials are reported accurately.
- [x] Every stage is test-first, reviewed, recorded and saved as a commit/PR checkpoint before the next stage expands.

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

Platform gate follow-up: the new development CLI and controller create retained Git worktrees and invoke external commands, so the existing Ubuntu/Windows CLI smoke matrix must run their integration tests as well. Add a dedicated additive step without changing the existing tests, runner versions, or job names. Hosted evidence must distinguish the actual new development checks from historical CLI smoke success.

## Closeout

DP-01 through DP-08 are implemented, independently reviewed, verified and saved. Final local gate: 3431 total / 3430 pass / 0 fail / 1 opt-in real-provider skip; workflow, type, lint, build and probes pass. Tested checkpoint remote `9828011b` / local `b3910c6`, exact tree `3539ff0724e946cd6df97a55dfdea840d65653bc`, passes all five hosted jobs, including new development checks on Ubuntu/Windows. Final evidence-only closeout preserves that source. LIVE-01 remains blocked: model selection is empty and host model/trial budget is needed. No main merge, application, release or experimental/production promotion. [Final verification](../../reports/2026-10-15-development-control-plane.md). Checklist: [development control-plane tasks](../../../tasks/development-control-plane-todo.md).

## Runnable offline development demonstration

Owner: baseline agent; coordinator owns final gate and staged save. Add only `examples/development-demo.mjs` and a dated verification report. The example exercises the existing built controller with an actual temporary Git fixture, scoped queue, protected host checker, scripted first-attempt failure and second-attempt repair, durable failed/passing check artifacts and explicit host acceptance. Assertions must prove two attempts, failed host feedback before repair, ready-for-review before explicit acceptance, unchanged clean source revision/content and retained candidate/evidence. Runtime fixtures remain under `.agent_workspace/`; no live model, automatic source application or effectiveness claim is introduced. Build first, run the example and record exact outcomes in `docs/reports/2026-10-15-development-demo.md`; no runtime source or test edits are part of this demonstration slice.

Author execution complete: build and demo exit 0; two attempts, actual host check exit 1 then 0, explicit acceptance, unchanged source and retained candidate asserted. Example ESLint and workflow check pass. [Execution report](../../reports/2026-10-15-development-demo.md). Root owns final combined verification and stage saving.

DP07 demonstration follow-up: feed actual `performance.now()` elapsed time, observed attempt count and final accepted queue state into the existing `summarizeDevelopmentTrials`. Output `descriptiveEvaluation` in scripted mode with `costSource: unknown`; no model call must not be converted into a measured zero total cost. Time the task from `runNext` through explicit host acceptance, including artifact inspection. Re-run the built demo and extend independent review without modifying runtime source or tests.

DP07 example wiring complete: author and independent reviewer each ran the built example successfully, observed two attempts and host check exits 1 then 0, and verified accepted state, source preservation and unknown-cost attribution. Independent reviewed example blob: `5b210f781ffb61abbf5d177b61c5f61356093f37`; exact runs and retained fixture locations are recorded in the demonstration report.

## Reusable agent continuation guide

Owner: research agent; coordinator owns the README link and staged save. Documentation-only scope: add `docs/development-agent-loop.md` from the actual development CLI/help, work-item schema and controller APIs. Cover a valid host-authored JSON definition with protected checker dependencies; explicit init/status/next/run/candidates/reconcile/accept; bounded repair of one candidate; source integration before dependent execution; refusal to replay unknown effects; offline versus live-provider evidence; and independently reviewed, gated stage commits. Include a compact Mermaid relationship diagram. Do not add schedules, unattended dispatch, runtime source changes or claims of live-model effectiveness.

- [x] 2026-10-15: guide example JSON passed the actual `createWorkQueue` schema; local links and built CLI help were checked. `node scripts/workflow-check.mjs` PASS (10 required files, 16 headings); scoped `git diff --check` PASS. Independent baseline reviewer found the unsupported trusted-candidate native apply suggestion; it was corrected to separately authorized Git/PR integration and re-reviewed PASS. The review also clarified output hard caps and claims without time expiry.
- [x] 2026-10-15: independent `node examples/development-demo.mjs` PASS, exit 0 with empty stderr; two attempts, host checks 1 then 0, ready then explicit accept, source preserved and candidate/evidence retained. Reported to the example owner; see [demonstration evidence](../../reports/2026-10-15-development-demo.md).

Guide verification logs: `.agent_workspace/architecture-20261015/development-guide-workflow.log` and `development-guide-content-check.log`. The literal `pnpm workflow:check` attempt was environment-blocked before the workflow script: the package-manager wrapper invoked install and raised `ERR_PNPM_IGNORED_BUILDS`. Its four automatically generated `allowBuilds` draft lines were precisely removed; no build approval or dependency policy change was made, and the original `onlyBuiltDependencies: [esbuild]` remains with no file diff. The direct workflow script result above is the actual verification, not a claim that the blocked wrapper passed. Final source staging and integrated gate remain coordinator-owned.

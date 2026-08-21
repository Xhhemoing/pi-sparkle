# Implementation Plan: M0-M2 Runtime

> **Archived 2026-08-17.** Runtime M0–M2.5 (T1–T17, Checkpoints A–E) is accepted and removed from the active task list. Verification: `pnpm test` 712 pass / 3 skip / 0 fail; `pnpm typecheck`, `pnpm lint`, `pnpm build` green. See `ACCEPTANCE-2026-08-17.md`.

---

# Implementation Plan: M0-M2 Runtime

## Overview

Implement the smallest vertical path from project discovery to a Pi-backed run, then extend it to bounded child coordination and a resumable supervisor. Every phase leaves a runnable CLI and deterministic tests. Real-provider tests remain opt-in; fake execution is the default proof path.

## Architecture Decisions

- Pi is consumed through a version-pinned adapter: [ADR-001](../docs/decisions/0001-pi-adapter-boundary.md).
- JSONL events plus atomic checkpoints are the source of durable run state: [ADR-002](../docs/decisions/0002-event-log-and-checkpoints.md).
- Parent/child coordination uses versioned structured envelopes: [ADR-003](../docs/decisions/0003-structured-agent-protocol.md).
- The full target and acceptance scenarios are in [the M0-M2 specification](../docs/specs/m0-m2-architecture.md).

## Dependency Graph

```text
T1 bootstrap and conventions
  -> T2 domain IDs/contracts/state machines
       -> T3 event log/checkpoint/replay
            -> T4 project discovery + M0 coordinator
                 -> T5 fake/real Pi adapter and CLI smoke
                      -> checkpoint A
                            -> T6 agent registry + child protocol
                                 -> T7 child lifecycle/cancellation/limits
                                      -> T8 M1 integration flow
                                           -> checkpoint B
                                                 -> T9 task graph validation/scheduler
                                                      -> T10 supervisor ledger/stall/judge
                                                           -> T11 resume and M2 acceptance
                                                                -> checkpoint C
```

## Phase 1: M0 Foundation

### Task 1: Bootstrap TypeScript project

**Description:** Create the package metadata, strict TypeScript configuration, test/lint/build commands, source layout, and repository hygiene files. Pin the reviewed Pi dependency version only after confirming the package import path and Node compatibility.

**Acceptance criteria:**

- [ ] `pnpm install --frozen-lockfile` works on the declared Node/pnpm baseline.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` are real commands, even with an empty initial implementation.
- [ ] `.gitignore` excludes dependencies, build output, state roots, env files, and credentials.

**Verification:** Run all four commands and inspect the staged dependency diff for secrets and unreviewed packages.

**Dependencies:** None.

**Files likely touched:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.*`, `src/`, `test/`, `.gitignore`.

**Estimated scope:** Medium.

### Task 2: Define domain contracts and state transitions

**Description:** Add branded IDs, timestamps, status unions, run limits, project snapshot types, task types, evidence/artifact references, and pure transition/validation functions.

**Acceptance criteria:**

- [ ] Invalid IDs, timestamps, duplicate task IDs, illegal transitions, and negative limits are rejected.
- [ ] Domain code has no Pi or filesystem imports.
- [ ] Tests cover legal transitions and representative invalid inputs.

**Verification:** `pnpm test -- --runInBand` (or the configured equivalent), `pnpm typecheck`.

**Dependencies:** Task 1.

**Files likely touched:** `src/domain/`, `test/unit/domain/`.

**Estimated scope:** Medium.

### Task 3: Implement event log, checkpoint, and replay

**Description:** Build a per-run JSONL writer, schema validation, serialized append behavior, atomic checkpoint replacement, and replay reducer with partial-final-line recovery.

**Acceptance criteria:**

- [ ] Events are validated, ordered, correlated, and append-only.
- [ ] A crash-truncated final JSONL line does not discard valid preceding events and produces recovery evidence.
- [ ] Checkpoints are atomically replaced and replay can reconstruct equivalent state.
- [ ] Raw secrets and unbounded tool payloads are not written by default.

**Verification:** Unit tests with temporary directories, including interrupted writes and concurrent append attempts.

**Dependencies:** Task 2.

**Files likely touched:** `src/run/event-store.ts`, `src/run/checkpoint-store.ts`, `src/run/replay.ts`, `test/unit/run/`.

**Estimated scope:** Medium.

### Task 4: Implement project discovery and M0 coordinator

**Description:** Discover the requested project root, collect bounded instruction/manifests/command facts, create a run, invoke an `AgentExecutor`, persist translated events, and produce a terminal run state.

**Acceptance criteria:**

- [ ] Discovery canonicalizes the root and records found files as facts.
- [ ] The coordinator can execute a fake worker and end in `COMPLETED`, `FAILED`, or `CANCELLED` according to the terminal result.
- [ ] Every material state change has a correlated event.

**Verification:** Temporary-workspace integration tests for success, failure, cancellation, and a missing/invalid root.

**Dependencies:** Task 3.

**Files likely touched:** `src/project/`, `src/run/coordinator.ts`, `test/integration/m0/`.

**Estimated scope:** Large; split discovery and coordinator if the implementation exceeds five files.

### Task 5: Add Pi adapter and CLI smoke path

**Description:** Implement the Pi adapter behind the domain executor interface and expose `run`/`resume`/`inspect` commands with JSONL output suitable for scripts.

**Acceptance criteria:**

- [ ] No non-adapter source imports Pi packages.
- [ ] Fake executor tests remain provider-free and pass.
- [ ] An opt-in Pi smoke test is skipped with a clear reason when credentials/model config are absent.
- [ ] CLI output distinguishes human summaries from machine JSONL events.

**Verification:** `pnpm test`, `pnpm typecheck`, `pnpm build`, and CLI temporary-project smoke tests.

**Dependencies:** Task 4.

**Files likely touched:** `src/pi-adapter/`, `src/cli/`, `test/integration/cli/`, `test/integration/pi-adapter/`.

**Estimated scope:** Large; split CLI and adapter if necessary.

## Checkpoint A: M0

- [ ] A new user can discover a project and start one fake-agent run.
- [ ] The run can be inspected and resumed from its durable state.
- [ ] Unit, integration, lint, typecheck, and build commands pass.
- [ ] The Pi package/version and provider smoke configuration are reviewed before proceeding.

## Phase 2: M1 Child Agents

### Task 6: Add agent registry and protocol schemas

**Description:** Define logical agent profiles, registry lookup, protocol v1 schemas, artifact/evidence ownership checks, and parent/child correlation.

**Acceptance criteria:**

- [ ] Unknown roles, invalid envelopes, invalid references, and duplicate terminal results are rejected.
- [ ] Registry resolution never hardcodes a model into the logical role contract.
- [ ] Protocol fixtures cover all four message types.

**Verification:** Domain/schema tests and package-boundary import check.

**Dependencies:** Checkpoint A.

**Files likely touched:** `src/agents/`, `src/protocol/`, `test/unit/protocol/`.

**Estimated scope:** Medium.

### Task 7: Implement bounded child lifecycle

**Description:** Let the coordinator lease tasks to child executors, enforce concurrency, attempt/time limits, propagate cancellation, and persist all child messages and terminal outcomes.

**Acceptance criteria:**

- [ ] Parent cancellation reaches active children through `AbortSignal`.
- [ ] Concurrency never exceeds the configured limit.
- [ ] Timeout produces a blocked task and a retry decision owned by the coordinator.
- [ ] Parent settlement waits for child settlement or explicit timeout handling.

**Verification:** Fake-executor integration tests with barriers, delays, cancellation, and timeout.

**Dependencies:** Task 6.

**Files likely touched:** `src/run/child-coordinator.ts`, `src/run/limits.ts`, `test/integration/m1/`.

**Estimated scope:** Medium.

### Task 8: Complete the M1 parent-child workflow

**Description:** Add CLI commands and inspection output for child runs, progress, questions, results, artifacts, and evidence.

**Acceptance criteria:**

- [ ] Independent children can run with bounded parallelism and their results remain attributable.
- [ ] A question pauses the parent in `WAITING_FOR_USER` and resume supplies an explicit answer event.
- [ ] Cancellation and failure summaries identify the child task and evidence IDs.

**Verification:** End-to-end CLI tests using fake children and persisted state across process boundaries.

**Dependencies:** Task 7.

**Files likely touched:** `src/cli/`, `src/run/inspection.ts`, `test/integration/m1/cli/`.

**Estimated scope:** Medium.

## Checkpoint B: M1

- [ ] Parent/child protocol is versioned and schema validated.
- [ ] Parallelism, timeout, retry, cancellation, and question paths are tested.
- [ ] Restarting the CLI does not lose child correlation or terminal state.

## Phase 3: M2 Supervisor

### Task 9: Implement DAG validation and deterministic scheduler

**Description:** Add task graph parsing, cycle detection, readiness calculation, task leases, dependency joins, and legal state transitions.

**Acceptance criteria:**

- [ ] Cyclic, missing, duplicate, and self-dependent graphs fail before execution.
- [ ] A task becomes ready only when all dependencies satisfy the declared join rule.
- [ ] A task has at most one active lease and lease expiry is explicit.

**Verification:** Pure graph tests and scheduler integration tests with deterministic fake time.

**Dependencies:** Checkpoint B.

**Files likely touched:** `src/graph/`, `src/run/scheduler.ts`, `test/unit/graph/`, `test/integration/m2/scheduler/`.

**Estimated scope:** Medium.

### Task 10: Add ledger, bounded rounds, stall detection, and judge transitions

**Description:** Persist the supervisor ledger, classify progress, detect repeated no-progress rounds, enforce maximum rounds/stalls, and route judge outcomes only through declared transitions.

**Acceptance criteria:**

- [ ] Ledger revisions are monotonic and tied to event IDs.
- [ ] Duplicate/repeated work does not count as progress without new admissible evidence.
- [ ] Stall limits transition the run to `BLOCKED` and prevent further scheduling.
- [ ] Judge outputs are schema validated and cannot select undeclared targets.

**Verification:** Unit tests for progress classification and integration tests for approve/reject/user-decision branches.

**Dependencies:** Task 9.

**Files likely touched:** `src/supervisor/`, `src/graph/judge.ts`, `test/unit/supervisor/`, `test/integration/m2/supervisor/`.

**Estimated scope:** Large; split judge transitions from stall policy if needed.

### Task 11: Add M2 resume and acceptance scenarios

**Description:** Rebuild supervisor state from checkpoint plus event replay, recover expired leases, and expose graph/ledger inspection with the M2 acceptance flows.

**Acceptance criteria:**

- [ ] Resume does not rerun completed tasks.
- [ ] A join task returns to `READY` after restart when prerequisites are complete.
- [ ] Expired active leases are handled according to retry limits.
- [ ] Stall blocking is durable across restart.

**Verification:** Multi-process temporary-state tests and the complete M0-M2 test/build/typecheck/lint suite.

**Dependencies:** Task 10.

**Files likely touched:** `src/run/resume.ts`, `src/cli/inspect.ts`, `test/integration/m2/resume/`.

**Estimated scope:** Medium.

## Checkpoint C: M0-M2 Complete

- [ ] All M0-M2 acceptance scenarios in the architecture specification pass.
- [ ] No direct Pi imports exist outside `src/pi-adapter/`.
- [ ] No secrets or raw unbounded tool payloads appear in persisted test fixtures or state output.
- [ ] A fresh process can inspect and resume a run from its state root.
- [ ] Review has checked state transitions, cancellation, recovery, and security boundaries.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pi API/version drift | High | Pin version, isolate adapter, run contract tests before upgrades. |
| JSONL corruption or duplicate events | High | Serialize appends, validate IDs, test partial-line recovery and replay. |
| Agent claims accepted without evidence | High | Require evidence/artifact references and coordinator validation. |
| Infinite retries/replanning | High | Enforce attempts, rounds, stall, wall-time, and cost limits. |
| Tool access mistaken for sandboxing | High | Document and test external isolation requirement; default write authority is narrow. |
| Context explosion in parent/child runs | Medium | Pass bounded artifact references and summaries, not raw transcripts by default. |
| Premature database complexity | Medium | Start with JSONL/checkpoints; revisit only with measured query/concurrency need. |

## Open Questions

- Node.js LTS and pnpm baseline.
- Default M0 model/provider and read-only policy for the real smoke test.
- State-root default policy.
- Whether M1 enables file-writing workers or remains read-only.

## Implementation Rule

Do not begin implementation until the human approves the open questions or explicitly authorizes reasonable defaults. Once approved, implement one task at a time, test before moving forward, and commit each working increment atomically.

## P1–P7 Integration & Governance Extensions (M2.5+)

This section fuses the user's P1–P7 requirements into the roadmap. Features are classified per P7:
- **Permanent (常驻, core)**: P1 (智能模型路由), P2 (置信度 + 人类审批机制), P4 (框架规范, 简单非复杂化).
- **Optional extensions (可选功能)**: P3 (git 规范管理, 用更优方法替代), P5 (中途注入与暂停).
- P6 is addressed by providing lightweight normative frameworks (PolicyEngine, DecisionPolicy) rather than heavy rules.
- P4 (禁止哈希、避免过度 git 复杂化) is explicitly not adopted; we keep simple conventional commit generation as optional bridge only.

All additions preserve the event-sourced contract, JSONL + checkpoints, and M0-M2 compatibility. Flowchart Supervisor becomes the primary vehicle for P1/P2 integration.

## M2.5: Flowchart Supervisor + P1/P2 Core Governance (Permanent)

**Rationale (fused with P1/P2):** The M2 ledger provides stall detection and judge routes. To make sub-agent orchestration production-grade we elevate the supervisor to a **Flowchart** model (already planned) while embedding:

- **P1 Intelligent Model Routing**: Each FlowNode declares a `modelPolicy` (role-based, complexity-based, cost-aware, confidence-aware). A lightweight `ModelRouter` (core, permanent) selects the actual provider/model at lease time, records the route decision + justification as an event, and respects per-run cost/time limits. Router can be extended later but the interface and event are permanent.

- **P2 Confidence & Human-in-the-Loop**: 
  - `TaskNode` and `LedgerFact` carry `confidence: number (0-1)`.
  - `RunLimits` gains `minHumanConfidence?: number` (set at init or project policy). When a decision's confidence < threshold, the run transitions to `WAITING_FOR_USER` and emits an `AgentQuestion` with confidence score + rationale.
  - Structured decisions/operations (judge output, edge evaluation, fact recording) are required to emit confidence.
  - AI judges user preference + project state to decide whether to auto-apply or require human sign-off.
  - **Selective Execution in Approval Plans**: When a planner produces a plan, the `TASK_REQUEST` envelope includes an `ApprovalPlan` with selectable items (checkbox semantics). User can choose subset; only selected branches/nodes are executed. This is expressed in the protocol as `selectedActionIds` on the reply.

Flowchart nodes now carry `role`, `objective`, `modelPolicy`, `confidenceThreshold`, `approvalRequired`, `parallelGroup?`, `joinPolicy?`.
Edges carry `condition` (success | evidenceCount | confidence | userDecision | custom).

This makes P1 and P2 **permanent core** of M2.5 while keeping the original ledger/stall logic for compatibility.

### Task 12: Flowchart schema + ModelRouter + Confidence types (Permanent core)

**Description:** Define `Flowchart`, `FlowNode` (with `modelPolicy`, `confidenceThreshold`), `FlowEdge` (with confidence-aware conditions), `ModelRouter` interface, `ConfidenceScore`, `ApprovalPlan`, `DecisionPolicy`. Implement validators. Router default: role + task complexity heuristic (no external calls in core). Confidence defaults to 0.7 for auto-apply unless overridden.

**Acceptance criteria:**
- Flowchart with modelPolicy and confidenceThreshold validates and executes.
- ModelRouter records `MODEL_ROUTED` event with justification; respects limits.
- Task/Decision with confidence < minHumanConfidence forces `WAITING_FOR_USER`.
- ApprovalPlan with `selectable: true` items allows partial selection on reply.
- Existing M2 ledger paths remain functional (no regression).

**Files likely touched:** `src/domain/flowchart.ts` (new), `src/domain/limits.ts` (extend), `src/supervisor/model-router.ts` (new), `src/protocol/v1.ts` (extend ApprovalPlan), `src/supervisor/ledger.ts` (add confidence fields).

**Estimated scope:** Medium-High.

### Task 13: FlowchartSupervisor with P1 routing + P2 confidence/approval (Permanent core)

**Description:** Implement `FlowchartSupervisor` that:
- Uses ModelRouter at every lease to pick model.
- Evaluates edge conditions including confidence.
- On low-confidence or approvalRequired nodes, emits structured `AgentQuestion` containing `ApprovalPlan` (with checkboxes) and current confidence scores.
- Supports selective execution: only selected sub-flows are leased.
- Integrates with existing ledger for stall detection across parallel branches.

**Acceptance criteria:**
- Parallel branches with different modelPolicies route correctly.
- Human approval with selective checkboxes works end-to-end in fake-executor tests.
- Confidence propagation from child `TASK_RESULT` to parent decision is recorded.
- Resume restores router state + pending approval plans.

**Files likely touched:** `src/supervisor/flowchart-supervisor.ts` (new), `src/run/child-coordinator.ts` (integrate router + approval), `src/supervisor/judge.ts` (refactor to use DecisionPolicy).

**Estimated scope:** High.

### Task 14: Flowchart + ledger + confidence persistence + M2.5 gates (Permanent)

**Description:** Persist flowchart cursor, active model routes, confidence ledger entries, and pending `ApprovalPlan` selections in checkpoints. Ensure stall detection works when confidence-driven waits occur. All M2 tests still pass.

**Acceptance criteria:**
- Non-trivial flowchart (fork with different models + confidence gate + selective join) completes or waits for user correctly.
- Resume after crash restores pending approval state and router decisions.
- Full quality gates + no regression on T9–T11.

**Files likely touched:** `src/run/resume.ts`, `src/run/checkpoint-store.ts` (extend), `test/integration/m2.5/`.

**Estimated scope:** Medium.

**Checkpoint D (M2.5):** P1 (ModelRouter) and P2 (confidence + selective human approval) are permanent core. Flowchart is the canonical orchestration engine. Linear ledger mode remains for simple runs.

## M3: Optional Governance & Extensibility (P3, P5, P6 Framework)

These are explicitly **optional extensions** (per P7). They do not block M2.5 completion and are behind feature flags or separate packages.

### P3: Decision-to-Commit Bridge (better than raw git规范)

Instead of forcing "规范的git提交" inside the runtime (which would complicate git and violate P4), we provide an optional **Decision Ledger → Conventional Commit** adapter.

**Idea:** After a run (or selected nodes) completes, the bridge reads the event log + flowchart decisions + confidence facts and generates a set of conventional commits (type(scope): message + evidence links). User reviews and signs. No hashes are required or prohibited; no complex git workflows are introduced into the core supervisor. The bridge is a separate CLI command or post-run hook.

This satisfies the spirit of "规范git提交" without making git a first-class concern of the multi-agent runtime.

**Task 15 (Optional):** Implement `decision-to-commit` generator (reads ledger, emits conventional commit messages + evidence references). Optional signing step. Lives in `src/tools/decision-commit.ts` or a separate `@pi-sparkle/git-bridge` package.

**Acceptance:** Generated commits follow conventional format; evidence IDs are included; user can edit before apply. No core changes to EventStore or supervisor.

**Scope:** Low-Medium (optional).

### P5: Mid-run Injection & Pause Controller (Optional Extension)

**Framework (P6 simple norm):** Provide a narrow `InjectionController` interface and `PauseToken` that any coordinator can consult. Injection points are explicit events (`INJECTION_REQUESTED`, `PAUSE_REQUESTED`) recorded in the ledger. The controller does not interpret arbitrary user input; it only allows typed injections that match the current flowchart node policy (e.g., "add fact", "override confidence", "skip node").

**Task 16 (Optional):** Implement `PauseController` + `InjectionPoint` registry. Expose via CLI (`pi-sparkle pause`, `pi-sparkle inject --type fact --value ...`). All injections are validated against the active `DecisionPolicy` and recorded with confidence/actor. Resume continues from the injection point.

**Acceptance:** Pause works on long-running flowchart; typed injection is accepted and reflected in ledger; no arbitrary code execution.

**Scope:** Medium (optional, behind flag).

### P6: Lightweight Normative Framework (Permanent supporting)

Instead of heavy rule engines, we define simple permanent interfaces that all permanent components must implement:

- `DecisionPolicy` — returns required confidence, approval flag, model constraints for a given (role, objective, currentLedger).
- `ModelRouter` — pure function + event emitter (already in M2.5).
- `EvidencePolicy` — minimum evidence types per node type.

These are small, testable, and extensible. AI agents are expected to consult them; the framework itself stays minimal.

**Task 17 (Permanent support):** Extract `DecisionPolicy` and `EvidencePolicy` interfaces + default implementations during T12/T13. Document the normative expectations in `docs/policies.md`.

**Scope:** Small (done as part of M2.5).

## Updated Risks (M2.5 + M3 optional)

Original risks remain. New:

| Risk | Impact | Mitigation |
| --- | --- | --- |
| ModelRouter complexity | Medium | Keep default heuristic simple; interface allows future learned router. |
| Confidence mis-calibration | Medium | Default thresholds conservative; always allow human override. |
| Selective approval UX burden | Low | ApprovalPlan is optional per node; simple checkbox protocol. |
| Optional git-bridge pollutes core | Low | Strictly separate package / CLI entry; never imported by supervisor. |
| Pause/inject abuse | Low | Typed, policy-validated injections only; full audit trail. |

## Open Questions (post M2.5)

- Whether the initial flowchart can be discovered by a planner agent or must be supplied.
- Default confidence model (simple heuristic vs provider-reported).
- Visualization of flowchart + confidence heat-map (future UI, not M2.5).

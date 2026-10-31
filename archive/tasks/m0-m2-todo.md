# M0-M2 Task Checklist

> **Archived 2026-08-17.** All items were already `[x]` and re-verified by the full local quality gates. Active remaining work lives in `../todo.md` and `../adaptive-todo.md`.

---

# M0-M2 Task Checklist

Source: [implementation plan](plan.md) and [architecture specification](../docs/specs/m0-m2-architecture.md).

## M0

- [x] T1: Bootstrap TypeScript project and pin the reviewed Pi dependency.
  - Acceptance: strict typecheck, lint, test, build, and package hygiene commands work.
  - Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
  - Depends on: approved Node/pnpm baseline and package-review decision.

- [x] T2: Define domain contracts, validation schemas, and state transitions.
  - Acceptance: invalid input and illegal transitions are rejected without Pi/filesystem imports.
  - Verify: focused domain tests and `pnpm typecheck`.
  - Depends on: T1.

- [x] T3: Implement JSONL event log, atomic checkpoint, and replay recovery.
  - Acceptance: valid events replay; truncated final lines recover safely; no secrets are persisted.
  - Verify: temporary-directory storage tests.
  - Depends on: T2.

- [x] T4: Implement project discovery and single-run coordinator.
  - Acceptance: a temporary Git project produces a durable completed, failed, or cancelled fake-agent run.
  - Verify: M0 coordinator integration tests.
  - Depends on: T3.

- [x] T5: Implement Pi adapter and M0 CLI smoke commands.
  - Acceptance: only the adapter imports Pi; fake tests are provider-free; real smoke is opt-in.
  - Verify: CLI integration tests, build, and conditional provider smoke test.
  - Depends on: T4.

- [x] Checkpoint A: M0 works end-to-end and passes full local quality gates.
  - Items 1-3 verified by the local suite; item 4 (Pi package/version and
    provider smoke configuration review) remains a human decision. Proceeding
    to M1 with fake-executor defaults per the user's directive is safe because
    fake execution is the required default proof path.

## M1

- [x] T6: Add agent registry and protocol-v1 schemas.
  - Acceptance: malformed messages, unknown roles, invalid references, and duplicate terminal results fail closed.
  - Verify: protocol fixtures and package-boundary tests.
  - Depends on: Checkpoint A.

- [x] T7: Implement bounded child lifecycle and cancellation.
  - Acceptance: concurrency, attempts, timeout, retries, and AbortSignal propagation are enforced and persisted.
  - Verify: barrier/delay fake-agent integration tests.
  - Depends on: T6.

- [x] T8: Complete parent-child CLI workflow and inspection.
  - Acceptance: progress, questions, artifacts, evidence, results, and cancellation survive process restart.
  - Verify: end-to-end CLI integration tests.
  - Depends on: T7.

- [x] Checkpoint B: M1 coordination paths pass and are resumable.
  - Verified by the M1 unit/integration suite: parent-child CLI workflow,
    protocol envelopes, cancellation, questions/answers, and inspection all
    persist and replay from disk.

## M2

- [x] T9: Implement task DAG validation and deterministic scheduling.
  - Acceptance: invalid graphs fail before execution; dependencies, joins, and leases are correct.
  - Verify: graph unit and scheduler integration tests.
  - Depends on: Checkpoint B.

- [x] T10: Add supervisor ledger, bounded rounds, stall detection, and judge transitions.
  - Acceptance: no-progress loops block; judge outputs only use declared routes.
  - Verify: supervisor unit and integration tests.
  - Depends on: T9.

- [x] T11: Implement supervisor resume and M2 acceptance scenarios.
  - Acceptance: completed work does not rerun; joins, leases, and stall state recover after restart.
  - Verify: multi-process resume tests plus full quality gates.
  - Depends on: T10.

- [x] Checkpoint C: M0-M2 specification acceptance scenarios all pass.
  - The local suite (fake-executor path) verifies M0-M2 acceptance scenarios;
    the real-provider Pi smoke remains opt-in (requires PI_PROVIDER/PI_MODEL
    and credentials).

## P1–P7 Integration & Governance Extensions (M2.5+)

**Classification (P7):**
- **Permanent core (常驻)**: P1 (智能模型路由), P2 (置信度 + 人类审批 + 选择性执行), P4 (轻量框架规范).
- **Optional extensions (可选)**: P3 (Decision-to-Commit 桥接, 替代 git 规范), P5 (中途注入与暂停).
- P6: 轻量 `DecisionPolicy` / `ModelRouter` / `EvidencePolicy` 框架（随 M2.5 落地）。

## M2.5: Flowchart Supervisor + P1/P2 Core (Permanent)

- [x] T12: Flowchart schema + ModelRouter + Confidence types (Permanent core).
  - Acceptance: modelPolicy, confidenceThreshold, ApprovalPlan with selectable items; ModelRouter emits MODEL_ROUTED; low-confidence forces WAITING_FOR_USER; no M2 regression.
  - Verify: flowchart + router unit tests + typecheck.
  - Depends on: Checkpoint C.

- [x] T13: FlowchartSupervisor with P1 routing + P2 confidence/approval (Permanent core).
  - Acceptance: parallel branches route via ModelRouter; selective checkbox approval works; confidence propagates; resume restores pending approvals.
  - Verify: integration tests with mixed-model + confidence-gate scenarios.
  - Depends on: T12.

- [x] T14: Flowchart + ledger + confidence persistence + M2.5 gates (Permanent).
  - Acceptance: non-trivial flowchart (fork + different models + confidence gate + selective join) works; resume restores router + approval state; full gates pass.
  - Verify: full quality gates + resume tests.
  - Depends on: T13.

- [x] Checkpoint D (M2.5): P1 & P2 are permanent core. Flowchart is canonical orchestration engine.

## M3: Optional Governance (P3, P5)

- [x] T15 (Optional): Decision-to-Commit bridge (P3).
  - Acceptance: reads ledger + flowchart decisions, emits conventional commits with evidence links; user can edit/sign; no core supervisor changes.
  - Verify: CLI tool test.
  - Depends on: Checkpoint D.

- [x] T16 (Optional): PauseController + typed InjectionPoint (P5).
  - Acceptance: pause works on long-running flowchart; typed injections (fact/override/skip) validated by DecisionPolicy and recorded; resume continues correctly.
  - Verify: CLI injection tests + resume after pause.
  - Depends on: T15 (or parallel if behind flag).

- [x] Checkpoint E (M3 optional): Optional governance features available but not required for core M2.5.

## M2.5: Flowchart Supervisor

- [x] T12: Flowchart schema, validation, and execution semantics.
  - Acceptance: invalid flowcharts rejected; linear flowchart executes; ledger backward compatible.
  - Verify: flowchart unit tests + typecheck.
  - Depends on: Checkpoint C.

- [x] T13: Flowchart-driven subagent orchestration + parallel execution.
  - Acceptance: parallel sub-agents leased and joined; conditional edges evaluated from judge output; resume recovers cursor + branches.
  - Verify: integration tests with fork/join scenarios.
  - Depends on: T12.

- [x] T14: Flowchart + ledger integration, stall handling, and M2.5 acceptance.
  - Acceptance: non-trivial flowchart (fork→parallel→join) works end-to-end; no regression on M2 tests.
  - Verify: full quality gates + resume tests.
  - Depends on: T13.

- [x] Checkpoint D (M2.5): Flowchart supervisor becomes the canonical orchestration model for complex sub-agent relationships.

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

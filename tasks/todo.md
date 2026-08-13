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

- [ ] Checkpoint A: M0 works end-to-end and passes full local quality gates.
  - Items 1-3 verified by the local suite; item 4 (Pi package/version and
    provider smoke configuration review) remains a human decision. Proceeding
    to M1 with fake-executor defaults per the user's directive is safe because
    fake execution is the required default proof path.

## M1

- [ ] T6: Add agent registry and protocol-v1 schemas.
  - Acceptance: malformed messages, unknown roles, invalid references, and duplicate terminal results fail closed.
  - Verify: protocol fixtures and package-boundary tests.
  - Depends on: Checkpoint A.

- [ ] T7: Implement bounded child lifecycle and cancellation.
  - Acceptance: concurrency, attempts, timeout, retries, and AbortSignal propagation are enforced and persisted.
  - Verify: barrier/delay fake-agent integration tests.
  - Depends on: T6.

- [ ] T8: Complete parent-child CLI workflow and inspection.
  - Acceptance: progress, questions, artifacts, evidence, results, and cancellation survive process restart.
  - Verify: end-to-end CLI integration tests.
  - Depends on: T7.

- [ ] Checkpoint B: M1 coordination paths pass and are resumable.

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

- [ ] Checkpoint C: M0-M2 specification acceptance scenarios all pass.
  - The local suite (fake-executor path) verifies M0-M2 acceptance scenarios;
    the real-provider Pi smoke remains opt-in (requires PI_PROVIDER/PI_MODEL
    and credentials).

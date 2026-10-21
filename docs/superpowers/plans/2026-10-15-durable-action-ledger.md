# Durable action identity and host reconciliation

## Identity

- ID: `TASK-20261015-durable-action-ledger`
- Owner: action-ledger implementation agent; root owns development-controller integration.
- State: `ready-for-review`
- Opened: 2026-10-15 (Asia/Shanghai).
- Related: ADR-008 exact canonical JSON/opaque identities; architecture stage-two continuation; existing atomic-file/file-lock contracts.

## Problem and Scope

A process can perform an external effect and die before recording its result. Retrying from a merely `running` checkpoint can duplicate a commit, candidate mutation, apply, or PR. This slice adds an opt-in local action ledger with immutable input identity and explicit host reconciliation. It grants no authority to perform those actions.

In scope: `src/development/action-ledger.ts`, `action-store.ts`, focused real-filesystem tests, this plan and a dated verification report. Persist prepared intent and running claim before invocation; use opaque random identifiers, exact strict canonical JSON, bounded snapshots, atomic-file publication and short exclusive file locks. Concurrent claims and stale attempt tokens fail closed. Running actions do not become replayable on constructor/read; recovery requires a host attestation that the prior worker stopped and evidence from inspecting the actual effect. Only an explicit confirmed-absent reconciliation can reprepare an action.

Out of scope: native/CLI integration (root ownership), live external actions, automatic merge/apply, model-authored reconciliation, stale-lock stealing, cryptographic integrity, power-loss certification, or distributed host fencing. The caller is a trusted host and must stop/reconcile the prior worker; a ledger token cannot fence an arbitrary external API.

## Acceptance Criteria

- [ ] Same idempotency key plus exact canonical input/kind reuses its action; collisions with different identity refuse.
- [ ] Intent and exclusive running token are readable by a second process before an effect; competing claims and stale completion/reconciliation versions refuse.
- [ ] Kill a subprocess after a real filesystem effect and before completion: restart cannot claim or invoke again; actual-effect evidence resolves completion without replay.
- [ ] Explicit worker-stopped and confirmed-absent host evidence is required for safe retry; uncertainty remains blocked.
- [ ] Failed persistence never reports completed; corrupt/truncated/unknown-schema/oversized snapshots are preserved and refused.
- [ ] Inputs/results/evidence are bounded and detached from mutable caller objects; symlink/non-file data is refused.
- [ ] Focused tests, typecheck and lint evidence recorded; root owns integrated gate and independent review.

## Test-First Plan

1. Add focused tests before modules exist and capture RED.
2. Implement the declared API and state machine using existing persistence utilities.
3. Run `node --import tsx --test test/unit/development/action-ledger.test.ts`; include a spawned-process SIGKILL fixture that writes a real receipt before dying.
4. Run adjacent atomic-file/file-lock tests and typecheck/lint; record exact results and remaining limits.

## Gates and Handoff

Directory is caller-provided under runtime development state, never tracked source. All effects remain explicit host callbacks outside the short store lock. Stop on frozen contract or ownership conflict. No common files are edited by this slice. Root must bind final evidence to the staged source and separately review controller wiring.

## Closeout

Author focused verification: 38/38 ledger/persistence-neighbor tests and scoped lint passed after the independent review's strict-schema correction (RED then GREEN). Independent baseline-agent re-review and separate 38/38 run passed. Integrated typecheck/gate and exact revision binding remain with root. Report: `docs/reports/2026-10-15-durable-action-ledger.md`.

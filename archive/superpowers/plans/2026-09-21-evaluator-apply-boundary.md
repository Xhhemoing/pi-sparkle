# Full evaluator/apply boundary and future write registration plan

> **ADR-008 correction (2026-09-22):** this design uses opaque versioned references and exact-byte comparison in explicitly labeled local-weak mode; it does not use SHA-256 or a replacement cryptographic hash. The design remains unapproved and unfrozen, and cannot authorize implementation, writes, apply, or live runs.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. This plan is independent of the read-only projection pilot and must not be implemented as part of it.

**Goal:** Harden the existing host-facing `sparkle_apply_candidate` surface and decide whether future worker-write registration can be authorized without allowing a candidate to redefine its evaluator or replay an apply side effect.

**Architecture:** The existing host-facing apply registration remains present but non-production-authorized. Stage 0 freezes the invariant needed by the read-only pilot: the authoritative evaluator is outside candidate write scope and is bound to an opaque record reference plus exact canonical bytes in local-weak mode. A later host-issued capability binds immutable candidate/evaluator references, runtime/tool/policy identities, approval, expiry, and an idempotency key. Apply progresses through a durable reconciliation state machine and checks the source base and exact snapshot before mutation. Worker write registration remains a separate capability gate.

**Tech Stack:** `src/native/apply-registration.ts`, `src/native/apply.ts`, `src/native/write-session.ts`, Git worktrees/revisions, loop artifacts, independent checks, opaque references with exact-byte bindings, durable event/receipt records, fault-injection tests.

## Identity and staged gate

- Owner: native/change-control owner; state `planned — boundary design not
  frozen, no authorization`.
- Stage 0 (before any live pilot): freeze the boundary invariants, capability
  field vocabulary, evaluator write exclusion, weak-integrity labeling, and
  crash/replay threat model in a reviewable design record. This stage does not
  implement or authorize writes.
- Stage 1 (after pilot evidence, if approved): implement, independently review,
  and owner-authorize the existing host-facing apply surface; only then decide
  whether future worker-write registration is admissible.
- Refusal rule: any unresolved identity drift, ambiguous crash state, foreign
  handle, or missing approval stops before source mutation.

## Global Constraints

- `sparkle_apply_candidate` is already wired; this plan hardens and authorizes or refuses that existing surface.
- `NativeWriteSession` is not registered in the extension/default CLI; no automatic write-to-apply chain.
- ADR-006 forbids using this capability to mutate credentials, permissions, trust, or tool-activation/allowlist state.
- Candidate-supplied tests are evidence, not the sole authoritative evaluator.
- Git rollback does not undo network, credential, process, or external-file side effects.
- No production authorization without independent review and explicit owner scope.

## Canonical capability identity

Use one camelCase vocabulary:

```text
runId
repoTenantIdentity
baseRevision
candidateTreeReference
evaluatorBundleReference
evaluatorResultReference
runtimeIdentity
toolSchemaReference
policyReference
approvalIdentity
issuedAt
expiresAt
idempotencyKey
```

A mutable `candidatePath` may remain a locator, but never the candidate identity.
Any field change invalidates the capability and requires fresh evaluation and
approval. References resolve to immutable, run-scoped records whose canonical
bytes are compared exactly. This is local-weak binding, not cryptographic
signing or tamper resistance.

## Reconciliation states

```text
PREPARED -> VERIFIED -> AUTHORIZED -> APPLIED -> RECEIPTED
```

Recovery reconciles repository state and `idempotencyKey`; a missing receipt
does not imply that apply did not happen. Duplicate known requests return the
original result; ambiguous state stops automatic progress and requests review.

## Stage 0 draft record dependency

The draft Stage 0 record is specified at [evaluator boundary freeze](../specs/2026-09-21-evaluator-boundary-freeze.md) and is planned for `.agent_workspace/evidence-first-reconciliation/stage0-freeze-record.json`. It remains unapproved and unfrozen. The design record id and exact canonical-byte approval binding are non-circular; no record produced by this documentation slice is an approval.

## Acceptance Criteria

- [ ] Stage 0 boundary design is frozen before the live pilot: the authoritative
  evaluator is outside candidate write scope, bound by an opaque record reference
  and exact canonical bytes in local-weak mode, and cannot issue an apply
  capability; the absence of cryptographic tamper resistance is explicitly labeled.
- [ ] Existing registration, worker-write registration, and authorization are
  represented separately in code/docs/status.
- [ ] Stage 1 candidate cannot modify the authoritative evaluator bundle;
  evaluator bundle/result/runtime/tool/policy identities are content-bound.
- [ ] Capability validation rejects stale base, changed candidate snapshot,
  changed evaluator/config, expired approval, wrong repo/tenant, wrong approval,
  duplicate/ambiguous idempotency, and foreign handles before source mutation.
- [ ] State transitions and receipts are durable and replay/recovery tested.
- [ ] Fault injection covers verified→authorized, candidate mutation, base
  advance, source mutation→receipt crash, duplicate/replayed apply, and
  disposal/delete races.
- [ ] The result explicitly states external side effects not covered by Git
  rollback.
- [ ] ADR-006 limits are enforced: no credentials, permissions, trust, or
  tool-activation/allowlist edits.
- [ ] Independent review and owner authorization close before production apply
  claims or future worker-write registration.

## Test-first plan

- RED tests for each missing/mismatched capability field, candidate/evaluator
  mutation, stale base, expiry, duplicate replay, crash reconciliation, and
  ADR-006 forbidden mutation.
- Focused: `pnpm test test/unit/native test/integration/native`.
- Real-git fault injection and serialized `pnpm gate`; no live provider needed.
- Review packet must include exact commit, commands, verdict provenance, and
  owner authorization scope.

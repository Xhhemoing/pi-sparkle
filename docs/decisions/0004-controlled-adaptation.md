# ADR-004: Separate Runtime Execution from Controlled Adaptation

## Status

Accepted (2026-08-21). Owner ratified the separation after verifying that
the proposal-first guardrails (CAS promotion requiring independent review
provenance, shadow-only R1/bandit/topology) are implemented and tested.

## Date

2026-08-12

## Context

`pi-sparkle` is intended to improve its project understanding, model routing, multi-agent coordination, user-preference fit, and coding quality from observed work. A naive implementation could let a running agent rewrite its own prompt, memory, routing policy, permissions, or evaluation rules after receiving a favorable self-review. That design would create circular evaluation, non-reproducible behavior, preference pollution, policy escalation, and no dependable rollback path.

The runtime already treats durable events as source truth and requires evidence for material state changes. Adaptation must preserve those properties while supporting prompt/workflow optimization, scoped preferences, routing updates, and later optional model training.

## Decision

Separate the system into two authority domains:

1. **Execution plane:** runs approved, immutable versions of contracts, context policies, prompts, skills, model-routing policies, tools, and evaluator rubrics. A live run cannot mutate those active resources.
2. **Adaptation plane:** consumes immutable, redacted episode evidence; diagnoses repeated patterns; creates versioned improvement candidates; evaluates them through replay, sealed holdout, shadow, and bounded canary stages; and requests or performs promotion according to an explicit authority policy.

All adaptable resources use immutable versions, content hashes, parent lineage, declared scope, and an active-version pointer. Promotion and rollback are compare-and-swap operations recorded in an append-only ledger. Candidate creation does not activate a resource.

The initial product policy is **proposal-first**: promotion requires explicit user approval. A later user opt-in may authorize automatic promotion only for named low-risk resource classes after the experiment and rollback mechanisms have demonstrated reliability. Permissions, credentials, provider data policy, destructive tools, security boundaries, and global mandatory rules always require explicit approval.

An improvement may be described as:

- `Present` when the candidate exists;
- `Wired` when routing and evaluation paths exist;
- `Exercised` when used in replay, shadow, canary, or a live episode;
- `Outcome-supported` only when a held-out or comparable later outcome improves without a guardrail regression.

Only `Outcome-supported` candidates may be claimed as demonstrated improvement.

## Alternatives Considered

### Let an agent rewrite its active prompt or memory during a run

- Pros: immediate adaptation and minimal infrastructure.
- Cons: circular credit assignment, hidden state changes, irreproducible results, and no safe rollback.
- Rejected: incompatible with durable, auditable execution.

### Periodically regenerate one global prompt from all history

- Pros: simple deployment model.
- Cons: cross-project leakage, catastrophic forgetting, metric averaging across incompatible task families, and poor attribution.
- Rejected: learned resources remain scoped and may coexist on a Pareto frontier.

### Treat favorable self-review as sufficient evidence

- Pros: inexpensive and fast.
- Cons: self-enhancement bias, reward hacking, and no proof of later benefit.
- Rejected: self-review can propose a diagnosis but cannot promote its own change.

### Require approval for every low-risk change forever

- Pros: maximum human control.
- Cons: prevents useful bounded automation after reliability is proven.
- Rejected as a permanent restriction; retained as the initial default with explicit opt-in required for any later automation.

## Consequences

- The runtime and adaptation plane can evolve independently and be tested separately.
- More storage and bookkeeping are required for resource versions, experiments, and active pointers.
- Reproduction requires model/provider versions, environment/tool versions, seeds, policies, and evidence references.
- Candidate evaluation is slower than direct self-editing but produces defensible claims and safe rollback.
- Preference learning, model routing, and prompt optimization share one promotion mechanism without sharing one undifferentiated score.
- Deletion and privacy controls must propagate from source evidence into derived views and future experiment datasets.

## Follow-up

The detailed contracts, workflow, milestones, and acceptance scenarios are defined in [the adaptive agent work-loop specification](../specs/adaptive-agent-work-loop.md). This ADR remained Proposed until that specification and its default authority policy were approved; both approvals were recorded 2026-08-21 (see the policy-gates table in [`docs/status-matrix.md`](../status-matrix.md)), at which point the status above became Accepted.

| Gate | Owner | Inputs | Exit | Verify |
|---|---|---|---|---|
| Accept or revise this ADR | product + privacy | spec + status matrix | Status becomes Accepted or a superseding ADR | `docs/decisions/0004-controlled-adaptation.md` |
| Six defaults | product | spec “Decision required before implementation” | Written into an accepted spec revision | `docs/specs/adaptive-agent-work-loop.md` |
| P0 record rules | runtime | `src/privacy/record-classes.ts` | Independent review, no blocker | `pnpm test -- test/unit/privacy/record-classes.test.ts` |

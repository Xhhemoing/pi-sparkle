# ADR-003: Versioned Structured Parent-Child Agent Protocol

## Status

Accepted

## Date

2026-08-12

## Context

A parent agent must coordinate children without relying on concatenated natural-language output. The system needs to distinguish progress, questions, terminal results, artifacts, evidence, cancellation, and failures. Parent and child execution may be implemented by different adapters later, so the contract must belong to pi-sparkle.

## Decision

Define a versioned discriminated-union protocol with `TASK_REQUEST`, `PROGRESS`, `QUESTION`, and `TASK_RESULT` messages. Every message includes IDs, run/task correlation, sender/recipient, timestamp, and protocol version. Runtime schemas validate messages at the process boundary and before state transitions.

A child may emit multiple progress messages and at most one terminal result. A terminal result must reference artifacts/evidence owned by the task or explicitly shared. Questions pause the parent run for user input. Parent cancellation propagates through an abort signal and is recorded as an event before settlement.

Logical roles are separate from concrete model/process assignments. The parent schedules a task; the agent registry resolves the profile; the adapter resolves the selected execution backend.

## Alternatives Considered

### Plain text child responses

- Pros: minimal implementation.
- Cons: ambiguous status, fragile parsing, no reliable correlation or evidence references.
- Rejected: unsuitable for resumable orchestration.

### Shared mutable parent transcript

- Pros: children see context without explicit packaging.
- Cons: unbounded context growth, hidden coupling, unclear authority over state, and increased sensitive-data exposure.
- Rejected: children receive explicit bounded inputs and can refer to persisted artifacts.

### Fixed model-to-role bindings

- Pros: predictable configuration.
- Cons: prevents later capability/cost routing and couples workflow definitions to provider choices.
- Rejected: roles are logical; model selection is runtime configuration through M2 and later router work.

## Consequences

- Protocol changes require a schema version and compatibility policy.
- The coordinator must reject malformed or unauthorized messages instead of trying to recover through model interpretation.
- Agents need explicit artifact/evidence references, which adds bookkeeping but makes results inspectable.
- A later distributed transport can carry the same envelopes without changing domain semantics.

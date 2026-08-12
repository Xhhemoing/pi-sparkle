# ADR-002: Event Log and Checkpoints as Local Run Persistence

## Status

Accepted

## Date

2026-08-12

## Context

The runtime must show what happened, support audit and evidence references, and resume after a process restart. A mutable in-memory ledger loses the exact ordering and source of state changes. A database would add operational and migration complexity before query/concurrency requirements are known.

## Decision

Persist each run as an append-only JSONL event stream and an atomically replaced JSON checkpoint. Events are the source of truth. The checkpoint is a materialized recovery optimization and must be rebuildable by replaying valid events.

The writer serializes appends per run, validates every event before writing, records a stable event ID and schema version, and fsyncs terminal transitions. Recovery ignores an incomplete final line but reports it as evidence. Sensitive bodies are redacted or stored by reference.

## Alternatives Considered

### SQLite from M0

- Pros: indexed queries, transactions, and a single file.
- Cons: adds schema/migration/runtime concerns before the access patterns are known; raw tool/transcript storage still needs privacy policy.
- Deferred: revisit when run listing, concurrent writers, or cross-run analytics require indexed queries.

### Checkpoint-only persistence

- Pros: simple reads and writes.
- Cons: loses causality, event ordering, and the ability to diagnose partial writes or reconstruct state.
- Rejected: it cannot support the evidence and audit requirements.

### Full raw transcript storage

- Pros: maximum fidelity.
- Cons: can persist credentials, personal data, and unbounded tool input/output; makes every consumer a sensitive-data consumer.
- Rejected: retain bounded summaries and explicit artifact references by default.

## Consequences

- The event schema is a durable compatibility surface and requires versioning.
- Replaying a run is deterministic only when event payloads and reducer rules are versioned.
- JSONL is easy to inspect and export but less efficient for large cross-run queries.
- Atomic checkpoint replacement must be implemented and tested carefully to prevent false resumability.

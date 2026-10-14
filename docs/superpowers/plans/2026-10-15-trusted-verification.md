# Opt-in exact verification binding

## Identity

- ID: `TASK-20261015-trusted-verification`
- Owner: command-cleanup execution agent; native integration owner: audit-loop agent; root coordinates delivery.
- State: `ready-for-review`; opened 2026-10-15 Asia/Shanghai.
- Contracts: ADR-008 permits exact byte comparison and opaque IDs, forbids replacement cryptographic hashes; existing g1a-v1 acceptance remains unchanged without explicit opt-in.

## Problem, scope and boundaries

Legacy g1a-v1 metadata compares paths and lengths, so a checker can rewrite candidate bytes without changing the recorded identity. An agent-controlled checker in the candidate can also weaken its own test. Add an explicit host-issued verification descriptor, fixed argv and manifest, bounded exact candidate snapshots, and exact declared external checker-definition comparisons. Byte snapshots stay ephemeral; persisted evidence contains only opaque IDs, scope metadata and comparison outcomes.

The descriptor is issued by a host helper before execution and backed by private in-memory state. A copied/forged descriptor is refused. External checker files must be regular, nonlinked and outside the candidate. The declared checker dependency list is fixed; candidate scope additions/removals and same-length changes are detected. Host manifests and args are deeply copied/frozen. Impossible, unsafe or oversized snapshots fail closed. This is cooperative pre/post equality, not an OS sandbox, cryptographic attestation, proof of all undeclared transitive dependencies, or prevention of a transient hostile swap-and-restore between observations.

Out of scope: production/R10/R11 owner acceptance; new CLI policy; native files; storage of raw candidate/checker bytes; crypto hashes; implicit upgrades of legacy evidence; automatic apply.

## Acceptance criteria

- [x] A host-issued descriptor accepts unchanged candidate/checker state, including two invocations of an external checker with declared dependency (2026-10-15 focused GREEN).
- [x] Same-length candidate changes during verification cannot pass opt-in acceptance (2026-10-15 trusted test).
- [x] External checker/declared dependency changes after issuance or during verification are refused, including same-length changes (2026-10-15 trusted tests).
- [x] Command/argv/manifest overrides and copied descriptors are refused before executing the checker (2026-10-15 trusted test).
- [x] Added/deleted files in fixed scope, unsafe links, excessive files/bytes and missing required paths fail closed (2026-10-15 exact helper tests).
- [x] Mutated or replayed serialized exact-equality claims cannot satisfy opt-in acceptance; original in-process evidence identity is bound to the descriptor and check (2026-10-15 trusted test).
- [x] Existing no-descriptor callers and acceptance tests retain g1a-v1 behavior (2026-10-15 combined 49-case run).
- [x] No raw checker/candidate bytes appear in returned/persisted check DTOs (2026-10-15 trusted/closed-loop tests).

Verification details and limitations: [report](../../reports/2026-10-15-trusted-verification.md). Root owns final typecheck, independent review and combined-source delivery gate.

## Files and verification

Execution owner: new exact snapshot/trusted verification helpers, `src/execution/independent-check.ts`, `closed-loop.ts`, `acceptance.ts`, exports, relevant execution tests and this plan/report. Native integration is delegated separately and must preserve descriptor object identity. Avoid shared native/CLI/common status edits.

Test-first: add focused trusted-verification regressions, run RED, implement minimal opt-in wiring, run GREEN and neighboring independent-check/acceptance/closed-loop tests. Use `node --import tsx --test --test-concurrency=1 ...`, typecheck, ESLint, workflow and diff checks; root owns integrated gate/probes. Keep exact commands/outcomes in `docs/reports/2026-10-15-trusted-verification.md`.

Rollback/abort on leakage of raw snapshot bytes, changed legacy acceptance defaults, or unverifiable successful opt-in results. No approval is inferred for production, experiments or real providers.

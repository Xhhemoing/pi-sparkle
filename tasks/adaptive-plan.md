# Remaining plan: Adaptive Agent Work Loop

Accepted slices (M3-T3, M3-T7, M4 except safety one-off, M5-T1–T4, M5-T5 module-only, M6-T1–T6 machinery, Checkpoint G Exercised) were archived on 2026-08-17. Full original text: [archive/adaptive-plan-full.md](archive/adaptive-plan-full.md). Verification: [archive/ACCEPTANCE-2026-08-17.md](archive/ACCEPTANCE-2026-08-17.md).

Do not begin claiming `Outcome-supported` until Checkpoint F item 1 is closed. Do not wire R1/bandit/topology onto the live run loop until then.

## P0: Freeze privacy, storage, and authority

**Blocked on:** independent privacy review only. ADR-004 was accepted and the six defaults approved unchanged on 2026-08-21 (see `docs/reports/2026-08-21-gates-readiness.md`).

**Acceptance:**

- [ ] Every durable record class has owner, retention, redaction, deletion, and migration rules.
- [ ] Active resources cannot be changed by the execution plane (documented and tested as a P0 gate, not only implied by promotion CAS).
- [ ] Raw prompts, secrets, environment dumps, and hidden reasoning are explicitly excluded from optimization datasets.
- [ ] Open decisions are resolved in an **accepted** ADR/spec revision (not Proposed).

**Verification:** documentation links resolve; `git diff --check` passes; independent privacy/security review has no unresolved blocker.

## M3 remainder (required for Checkpoint D)

### M3-T1 leftover — episode store robustness

Still required vs [the original T1 contract](archive/adaptive-plan-full.md):

- [ ] One episode can attach multiple existing run IDs but cannot attach a run from another project (multi-run path, not only foreign-run reject).
- [ ] Duplicate opens, attachments, and terminal events fail closed on the episode reducer.
- [x] Replay after a truncated final JSONL line recovers consistently with the run event store.
- [ ] Cross-stream references are validated only after referenced run events are durable.

**RED/verify:** `test/unit/episode/*.test.ts` plus `test/integration/m3/episode-store.test.ts` (still missing for multi-run attach). Truncated-line recovery: `test/unit/episode/replay.test.ts` and `test/unit/run/episode-store.test.ts`.

### M3-T2 leftover — coverage gate in the live start path

- [ ] Every deliverable, constraint, and criterion has at least one source reference or is marked as an assumption.
- [x] Conflicting latency requirements are resolved by `applyPrecedence` (`user-first` / `spec-first` / `latest-first`); losers become assumptions. Wired into `--track`.
- [x] A task graph cannot start while mandatory criteria are uncovered (`assertCoverageAllowsStart` in `startParentRun` / `startSupervisedRun`). Skip-contracts and answered questions still start.
- [ ] A contract critic can report omissions but cannot mutate the accepted contract (needs an immutability test).

**Verify:** `test/unit/requirement/*.test.ts` and `test/integration/m3/coverage-gate.test.ts`.

### M3-T4 leftover — index completeness

Already proven: stale hashes, missing test route, unrelated dirty changes, ranked `codeMap`.

Still required:

- [ ] Instruction precedence **and ownership**, including nested project rules (`InstructionOwner` is not modeled).
- [ ] Index records architecture boundaries, migrations/security risks, public interfaces as specified — `architecture` / `risks` must not stay empty stubs.
- [ ] Index refresh is incremental and deterministic from frozen project inputs.
- [ ] Integration fixture: `test/integration/m3/project-context-index.test.ts`.

### M3-T5 leftover — mandatory packet fidelity

Already proven: conflict keep-separate, overflow omissions, secret non-expansion, determinism.

Still required:

- [ ] Mandatory contract constraints, authority grants, unresolved decisions, validation route, and dependency outputs cannot be omitted under an adequate budget.
- [ ] Downstream fixture questions can be answered from the packet and artifact refs without loading the parent transcript.
- [ ] Integration: `test/integration/m3/context-packet.test.ts`.

### M3-T6 leftover — evaluation identity and export tombstones

Already proven: deterministic vs inferential precedence, redaction classes, oversized reference-only, view tombstones.

Still required:

- [ ] An evaluation identifies target artifact/version, evaluator/model version, rubric version, evidence, independence class, and confidence (`EvaluationRecord` still lacks artifact/version and independence class).
- [x] Tombstoned source payloads disappear from **dataset exports**, not only preference materialized views. (`exportForDataset` lists tombstone ids and omits payloads; authorized export still omits tombstones unless `includeTombstones`.)
- [ ] Integration: `test/integration/m3/redaction.test.ts`.

### M3-T8 leftover — telemetry completeness

Already proven: missing usage is unavailable, not zero.

Still required:

- [ ] Pricing/catalog version is recorded separately from provider-reported usage.
- [ ] Retries, cache hits, timeouts, and cancelled calls are attributable.
- [ ] Taxonomy version changes do not rewrite historical facts.
- [ ] Integration: `test/integration/m3/pi-telemetry.test.ts`.

### Checkpoint D

- [ ] A multi-run M2 scenario replays into one episode.
- [ ] Conversation/project-source fixtures produce a source-attributed contract whose independent critique catches seeded omissions and contradictions.
- [ ] ProjectContextIndex fixtures expose instruction precedence, validation routes, risk boundaries, and unrelated dirty-worktree ownership.
- [ ] Requirement coverage, checks, feedback, evaluator provenance, and model usage are inspectable.
- [ ] Context-packet fixtures preserve every critical fact and record every bounded omission without forwarding a raw parent transcript.
- [ ] Every missing outcome is `Unobserved`, never fabricated.
- [ ] Redaction/deletion adversarial tests pass.
- [ ] Existing M0–M2 tests remain green.

## M4 leftover

### M4-T6 — severe safety one-off

- [ ] Explicit severe safety events are labeled one-off readiness findings (default two-episode recurrence and other negative controls already pass in `test/unit/learning/patterns.test.ts`).

## M5 leftover

### M5-T5 — live topology recording

Module records aggregation cost. The run loop must **not** call `planTaskTopology` until Checkpoint F.

- [ ] After Checkpoint F: topology decision and aggregation cost are recorded on the live run.

## Checkpoint F

- [ ] On a sealed held-out set, adaptive routing meets the approved cost-quality target against R0 under paired isolated evaluation or a predeclared estimator with valid overlap diagnostics. Open questions: [ADR-005](../docs/decisions/0005-checkpoint-f-holdout-open-questions.md).

Items already archived as module-complete: CI/raw-count/family reporting; zero policy-violation tests; frozen-input reproduction + invocation hashes.

## Checkpoint G claim (not the machinery)

Machinery walk is archived as Exercised. Remaining:

- [ ] A comparable later episode **plus** the approved F target before any `Outcome-supported` label.

## Optional M7

- [ ] Review whether consented, high-quality data justifies external SFT/preference/RL integration.
- [ ] Keep training infrastructure outside the TypeScript runtime behind a stable export/import contract.

## Out of scope until a new plan is approved

- Pi extension (`extensions/pi-sparkle/`) — ADR-006 Proposed; `PI_EXTENSION_IMPORT_ALLOWED` stays false.
- Intelligent-loop Phases 0–5 in `docs/reports/pi-intelligent-adaptive-loop.md` (BKT, error ontology, `/sparkle` commands).
- Unplanned shipped code: `--track`, cluster mailbox/spawn, `adapt auto`, children→flowchart compile. Treat as present, not plan-closed.

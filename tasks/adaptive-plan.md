# Remaining plan: Adaptive Agent Work Loop

Accepted slices (M3-T3, M3-T7, M4 except safety one-off, M5-T1–T4, M5-T5 module-only, M6-T1–T6 machinery, Checkpoint G Exercised) were archived on 2026-08-17. Full original text: [archive/adaptive-plan-full.md](archive/adaptive-plan-full.md). Verification: [archive/ACCEPTANCE-2026-08-17.md](archive/ACCEPTANCE-2026-08-17.md).

Do not begin claiming `Outcome-supported` until Checkpoint F item 1 is closed. Do not wire R1/bandit/topology onto the live run loop until then.

> **2026-09-17 reconciliation note:** the M3/M4/Checkpoint-D checkboxes below were stale relative to the authoritative closeout in [adaptive-todo.md](adaptive-todo.md) (closed 2026-08-21 with dated evidence, Checkpoint D closed by the adaptive owner per `docs/reports/2026-08-21-gates-readiness.md`). They have been aligned without rewriting history — each item now carries its closure date and evidence pointer. New authority remains `adaptive-todo.md` plus `docs/status-matrix.md`.

## P0: Freeze privacy, storage, and authority

**Closed 2026-08-26** by [technical re-verification](../docs/reports/2026-08-26-p0-technical-reverification.md): Q1/Q2 tests green; an independent privacy-officer countersign remains welcome but is non-blocking (authoritative: `docs/status-matrix.md` P0 row). Unchecked acceptance criteria below are historical records of the original gate, not a claim that P0 is open again — do not re-open P0 from this file alone.

- [ ] Every durable record class has owner, retention, redaction, deletion, and migration rules.
- [ ] Active resources cannot be changed by the execution plane (documented and tested as a P0 gate, not only implied by promotion CAS).
- [ ] Raw prompts, secrets, environment dumps, and hidden reasoning are explicitly excluded from optimization datasets.
- [ ] Open decisions are resolved in an **accepted** ADR/spec revision (not Proposed).

**Verification:** documentation links resolve; `git diff --check` passes; independent privacy/security review has no unresolved blocker.

## M3 remainder (required for Checkpoint D)

### M3-T1 leftover — episode store robustness

Historical T1 contract remainder ([original text](archive/adaptive-plan-full.md)) — all closed 2026-08-21 (see [adaptive-todo.md](adaptive-todo.md)):

- [x] One episode can attach multiple existing run IDs but cannot attach a run from another project (multi-run path, not only foreign-run reject). (Closed 2026-08-21: reducer marks sticky `failClosed` + reason; tests in `test/unit/episode/manager.test.ts` and `test/integration/m3/episode-reducer-store.test.ts`; see adaptive-todo.md M3-T1.)
- [x] Duplicate opens, attachments, and terminal events fail closed on the episode reducer. (Closed 2026-08-21, same evidence as above.)
- [x] Replay after a truncated final JSONL line recovers consistently with the run event store.
- [x] Cross-stream references are validated only after referenced run events are durable. (Closed 2026-08-21, same evidence as above.)

**RED/verify:** `test/unit/episode/*.test.ts` plus `test/integration/m3/episode-store.test.ts` (multi-run attach covered by `test/integration/m3/episode-reducer-store.test.ts` per the M3-T1 closure). Truncated-line recovery: `test/unit/episode/replay.test.ts` and `test/unit/run/episode-store.test.ts`.

### M3-T2 leftover — coverage gate in the live start path

- [x] Every deliverable/constraint sourced or assumed; non-placeholder precedence; coverage gate wired so a graph cannot start while mandatory criteria are uncovered; critic cannot mutate the accepted contract. (Closed 2026-08-21: optional `sourceRefs` / `assumptionIds` on the three item types; `findUnsourcedItems` in `src/requirement/provenance.ts`; `critiqueContract` lists unsourced ids in `missingSources`; heuristic extractor stamps objective-derived items and links defaults to assumption `a-defaults`; deep-frozen-contract immutability tests for the critic. Evidence: `test/integration/m3/checkpoint-d.test.ts`; see adaptive-todo.md M3-T2.)

**Verify:** `test/unit/requirement/*.test.ts` and `test/integration/m3/coverage-gate.test.ts`.

### M3-T4 leftover — index completeness

Already proven: stale hashes, missing test route, unrelated dirty changes, ranked `codeMap`.

Historical remainder — all closed 2026-08-21 (see [adaptive-todo.md](adaptive-todo.md)):

- [x] Instruction precedence **and ownership**, including nested project rules (`InstructionOwner` in `src/context/index.ts`; see adaptive-todo.md M3-T4, closed 2026-08-21).
- [x] Index records architecture boundaries, migrations/security risks, public interfaces as specified — `architecture` / `risks` derived from snapshot facts, not empty stubs (closed 2026-08-21).
- [x] Index refresh is incremental and deterministic from frozen project inputs (closed 2026-08-21).
- [x] Integration fixture: `test/integration/m3/project-context-index.test.ts` (landed with the M3-T4 closure).

### M3-T5 leftover — mandatory packet fidelity

Already proven: conflict keep-separate, overflow omissions, secret non-expansion, determinism.

Historical remainder — all closed 2026-08-21 (see [adaptive-todo.md](adaptive-todo.md)):

- [x] Mandatory contract constraints, authority grants, unresolved decisions, validation route, and dependency outputs cannot be omitted under an adequate budget (closed 2026-08-21: `src/context/packet.ts`; see adaptive-todo.md M3-T5).
- [x] Downstream fixture questions can be answered from the packet and artifact refs without loading the parent transcript (`queryPacketGrounding`; closed 2026-08-21).
- [x] Integration: `test/integration/m3/context-packet.test.ts` → landed as `test/integration/m3/packet-fidelity.test.ts`.

### M3-T6 leftover — evaluation identity and export tombstones

Already proven: deterministic vs inferential precedence, redaction classes, oversized reference-only, view tombstones.

Historical remainder — all closed 2026-08-21 (see [adaptive-todo.md](adaptive-todo.md)):

- [x] An evaluation identifies target artifact/version, evaluator/model version, rubric version, evidence, independence class, and confidence (`EvaluationTarget` + `IndependenceClass` on `EvaluationRecord`, validated in `createEvaluationRecord`; closed 2026-08-21, see adaptive-todo.md M3-T6).
- [x] Tombstoned source payloads disappear from **dataset exports**, not only preference materialized views. (`exportForDataset` lists tombstone ids and omits payloads; authorized export still omits tombstones unless `includeTombstones`.)
- [x] Integration: `test/integration/m3/redaction.test.ts` (landed with the M3-T6 closure).

### M3-T8 leftover — telemetry completeness

Already proven: missing usage is unavailable, not zero.

Historical remainder — all closed 2026-08-21 (see [adaptive-todo.md](adaptive-todo.md)):

- [x] Pricing/catalog version is recorded separately from provider-reported usage (`InvocationPricing.catalogVersion`; closed 2026-08-21, see adaptive-todo.md M3-T8).
- [x] Retries, cache hits, timeouts, and cancelled calls are attributable (`attempt` / `cacheHit` / `callOutcome` attribution validated in `src/telemetry/model-invocation.ts`).
- [x] Taxonomy version changes do not rewrite historical facts (`TAXONOMY_VERSION` + pure `stampTaxonomyVersion` + non-defaulting `recordedTaxonomyVersion`).
- [x] Integration: `test/integration/m3/pi-telemetry.test.ts` (landed with the M3-T8 closure).

### Checkpoint D

Closed 2026-08-21 (evidence: `test/integration/m3/checkpoint-d.test.ts` covers all seven automatable whole-checkpoint scenarios; decision package `docs/reports/2026-08-21-gates-readiness.md`). Historical criteria retained for the record:

- [x] A multi-run M2 scenario replays into one episode.
- [x] Conversation/project-source fixtures produce a source-attributed contract whose independent critique catches seeded omissions and contradictions.
- [x] ProjectContextIndex fixtures expose instruction precedence, validation routes, risk boundaries, and unrelated dirty-worktree ownership.
- [x] Requirement coverage, checks, feedback, evaluator provenance, and model usage are inspectable.
- [x] Context-packet fixtures preserve every critical fact and record every bounded omission without forwarding a raw parent transcript.
- [x] Every missing outcome is `Unobserved`, never fabricated.
- [x] Redaction/deletion adversarial tests pass.
- [x] Existing M0–M2 tests remain green.

## M4 leftover

### M4-T6 — severe safety one-off

- [x] Explicit severe safety events are labeled one-off readiness findings (closed 2026-08-21: `SEVERE_SAFETY_FEATURE` + `isSevereSafetySignature` in `src/learning/patterns.ts`; see adaptive-todo.md M4-T6).

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

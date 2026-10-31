# Adaptive Agent Work Loop Checklist

> **Archived snapshot 2026-08-17** taken before correcting over-marked M3 items. Live checklist: `../adaptive-todo.md`.

---

# Adaptive Agent Work Loop Checklist

Source: [adaptive specification](../docs/specs/adaptive-agent-work-loop.md), [ADR-004](../docs/decisions/0004-controlled-adaptation.md), and [implementation plan](adaptive-plan.md).

## Preconditions

- [ ] M0-M2 Checkpoint C passes.
- [ ] Adaptive specification is approved.
- [ ] ADR-004 is accepted.
- [ ] Six implementation defaults are approved or revised.
- [ ] P0 privacy/storage/authority preflight passes.

## M3: Episode observability

- [x] M3-T1: ProjectEpisode lifecycle and append-only event schemas. _(`src/episode/`, run episode bind/store)_
- [x] M3-T2: Requirement contract and coverage matrix. _(`src/domain/contract.ts`, `src/requirement/coverage.ts`)_
- [x] M3-T3: Normalize sources, extract requirements, and critique the contract. _(authority-aware normalization plus separately versioned extractor/critic interfaces, latent-inference/user-decision gate, and faux-provider fixtures; real provider adapter remains optional/not wired)_
- [x] M3-T4: Build a versioned ProjectContextIndex. _(`buildProjectContextIndex` plus deterministic ranked `codeMap` view with independent token budget)_
- [x] M3-T5: Bounded context-packet compiler and fidelity checks. _(core: omission records + secrets; no golden transcript fixtures)_
- [x] M3-T6: Structured feedback/evaluation and redaction boundary. _(redactFeedback + tombstone helper; not wired to dataset export)_
- [x] M3-T7: Deterministic episode closure and inspection CLI. _(`inspect --episode`, `episode close`, and `episode events --json`; acceptance-gated terminal snapshots/events)_
- [x] M3-T8: Task taxonomy and model invocation telemetry. _(`src/task/taxonomy.ts`, `src/telemetry/model-invocation.ts`)_
- [ ] Checkpoint D: replayable, inspectable, privacy-bounded episode foundation. _(T3/T7 blockers addressed; remaining whole-checkpoint acceptance still requires the broader context, evaluation, redaction, and replay evidence)_

## M4: Review and preference learning

- [x] M4-T1: Rubric registry and evaluator interface.
- [x] M4-T2: Project, code, and delivery evaluator adapters.
- [x] M4-T3: Independent actor/critic and blind pairwise review.
- [x] M4-T4: Scoped preference observations and materialized views.
- [x] M4-T5: Preference inspect/correct/export/delete workflow.
- [x] M4-T6: Repeated-pattern detector with negative controls.
- [x] Checkpoint E: traceable feedback reuse and bias-controlled review.

## M5: Adaptive routing and model clusters

- [x] M5-T1: Capability registry and deterministic R0 router.
- [x] M5-T2: Bayesian task-family outcome estimates.
- [x] M5-T3: Router replay harness and propensity ledger.
- [x] M5-T4: Contextual bandit in shadow mode.
- [x] M5-T5: Execution-topology router. _(router delivered; per-round recording of topology decisions is deferred to Checkpoint F — see adaptive-plan.md)_
- [ ] Checkpoint F: statistically valid held-out cost-quality improvement with zero policy violations. _(3/4 items: CI/raw-count/task-family reporting + frozen-input reproduction + invocation recording are done and test-verified; the sealed held-out experiment still needs an approved cost-quality target and a dataset source)_

## M6: Controlled self-optimization

- [x] M6-T1: Versioned resource and improvement-candidate registry. _(pre-research: delivered while Checkpoint F item 1 stays open)_
- [x] M6-T2: Isolated replay and sealed holdout evaluator. _(machinery only — dataset/isolation/holdout modules; the R0-vs-R1 experiment run stays frozen per ADR-005)_
- [x] M6-T3: Shadow/canary experiment runner.
- [x] M6-T4: Reflective prompt/workflow optimizer.
- [x] M6-T5: Approval and compare-and-swap promotion.
- [x] M6-T6: Drift monitor, rollback, and retirement.
- [x] Checkpoint G: propose → gates → CAS promote → later episode → automatic guardrail rollback, verified by `test/acceptance/adaptive-loop.test.ts`. Outcome-supported remains reserved until Checkpoint F item 1 (ADR-005).

## Optional M7

- [ ] Review whether consented, high-quality data justifies external SFT/preference/RL integration.
- [ ] Keep training infrastructure outside the TypeScript runtime behind a stable export/import contract.

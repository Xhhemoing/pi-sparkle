# Adaptive Agent Work Loop Checklist

Source: [adaptive specification](../docs/specs/adaptive-agent-work-loop.md), [ADR-004](../docs/decisions/0004-controlled-adaptation.md), and [implementation plan](adaptive-plan.md).

## Preconditions

- [ ] M0-M2 Checkpoint C passes.
- [ ] Adaptive specification is approved.
- [ ] ADR-004 is accepted.
- [ ] Six implementation defaults are approved or revised.
- [ ] P0 privacy/storage/authority preflight passes.

## M3: Episode observability

- [ ] M3-T1: ProjectEpisode lifecycle and append-only event schemas.
- [ ] M3-T2: Requirement contract and coverage matrix.
- [ ] M3-T3: Normalize sources, extract requirements, and critique the contract.
- [ ] M3-T4: Build a versioned ProjectContextIndex.
- [ ] M3-T5: Bounded context-packet compiler and fidelity checks.
- [ ] M3-T6: Structured feedback/evaluation and redaction boundary.
- [ ] M3-T7: Deterministic episode closure and inspection CLI.
- [ ] M3-T8: Task taxonomy and model invocation telemetry.
- [ ] Checkpoint D: replayable, inspectable, privacy-bounded episode foundation.

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

- [ ] M6-T1: Versioned resource and improvement-candidate registry.
- [ ] M6-T2: Isolated replay and sealed holdout evaluator.
- [ ] M6-T3: Shadow/canary experiment runner.
- [ ] M6-T4: Reflective prompt/workflow optimizer.
- [ ] M6-T5: Approval and compare-and-swap promotion.
- [ ] M6-T6: Drift monitor, rollback, and retirement.
- [ ] Checkpoint G: outcome-supported promotion and automatic guardrail rollback.

## Optional M7

- [ ] Review whether consented, high-quality data justifies external SFT/preference/RL integration.
- [ ] Keep training infrastructure outside the TypeScript runtime behind a stable export/import contract.

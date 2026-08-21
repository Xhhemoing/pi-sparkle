# Adaptive remainder checklist

Source: [adaptive-plan.md](adaptive-plan.md). Archived snapshot: [archive/adaptive-todo-pre-archive.md](archive/adaptive-todo-pre-archive.md).

Previous `[x]` marks on M3-T1/T2/T4/T5/T6/T8 and Checkpoint D were **overclaims**. They are open again until the remaining acceptance in the plan is met.

## Preconditions

- [ ] M0–M2 Checkpoint C local suite (re-verified 2026-08-17; real-provider smoke still opt-in).
- [ ] Adaptive specification approved.
- [ ] ADR-004 accepted.
- [ ] Six implementation defaults approved or revised.
- [ ] P0 privacy/storage/authority preflight passes.

## M3 gaps (Checkpoint D cannot close until these land)

- [ ] M3-T1 remaining: duplicate open/attach/terminal fail-closed on the episode reducer; truncated JSONL recovery test; dangling cross-stream refs; integration `episode-store` test; multi-run attach in one episode.
- [ ] M3-T2 remaining: every deliverable/constraint sourced or assumed; non-placeholder precedence; coverage gate wired so a graph cannot start while mandatory criteria are uncovered; critic cannot mutate the contract.
- [ ] M3-T4 remaining: instruction ownership (including nested rules); architecture/risks not empty stubs; incremental refresh; integration project-index test.
- [ ] M3-T5 remaining: mandatory authority/unresolved questions/dependency outputs cannot be omitted under an adequate budget; downstream questions answerable without parent transcript; integration packet test.
- [ ] M3-T6 remaining: evaluation identifies target artifact/version and independence class; integration redaction test. Preference dataset export now lists tombstone ids and omits payloads (`exportForDataset`).
- [ ] M3-T8 remaining: pricing/catalog version separate from usage; retry/cache/timeout/cancel attribution; taxonomy version does not rewrite history; integration pi-telemetry test.
- [ ] Checkpoint D: assemble the whole-checkpoint scenarios in the plan (not only module tests).

## M4 leftover

- [ ] M4-T6: explicit severe safety events labeled as one-off readiness findings (recurrence + other negative controls already tested).

## M5 leftover (frozen on live loop)

- [ ] M5-T5: record topology decision and aggregation cost **in the run loop** (`planTaskTopology` is defined but must stay unused until Checkpoint F).

## Checkpoints F / G claims

- [ ] Checkpoint F item 1: sealed held-out cost-quality vs R0 (ADR-005).
- [ ] Checkpoint G `Outcome-supported` (requires F). Machinery ladder is archived as Exercised only.

## Optional M7

- [ ] External SFT/preference/RL review.
- [ ] Training stays outside this runtime.

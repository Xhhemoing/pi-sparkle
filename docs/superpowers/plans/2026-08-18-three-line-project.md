# Three-line tracking and routing — project plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **one phase plan at a time**.

**Goal:** Ship isolated execution/tracking/analysis with deterministic supervisor gates, then correct single-layer R1, then offline attribution (both estimators), then proposal-first promotion — without claiming Outcome-supported before Checkpoint F.

**Architecture:** Tracking emits assessments only. The existing M2 supervisor applies a fixed transition table. Live routing stays R0 + single-layer R1 with conservative fallback. Hierarchical models and RouteLLM-style routers stay offline. Hidden CoT is never read.

**Tech Stack:** Existing TypeScript / Node 22 / `tsx --test`. No Temporal, OPA, SM4 KMS, or new ML runtime.

**Spec:** [2026-08-18-three-line-final.md](../specs/2026-08-18-three-line-final.md)

## Phase plans (implement in order)

| Phase | Plan | Spec slice |
| --- | --- | --- |
| A | [2026-08-18-phase-a-tracking-supervisor.md](./2026-08-18-phase-a-tracking-supervisor.md) | §§1–4, cases 1–12 |
| B | [2026-08-18-phase-b-outcome-r1.md](./2026-08-18-phase-b-outcome-r1.md) | §5, cases 13–19 |
| C | [2026-08-18-phase-c-offline-attribution.md](./2026-08-18-phase-c-offline-attribution.md) | §5–6, cases 15, 20–21 |
| D | [2026-08-18-phase-d-promotion-cas.md](./2026-08-18-phase-d-promotion-cas.md) | §6, cases 22–25 |
| 优化（评审后） | [2026-08-19-routing-optimization.md](./2026-08-19-routing-optimization.md) | 闭环 eval/晋升、目录、公开先验、仿真 holdout；R1 live 冻结 |

## Global Constraints

- Pi types stay in `src/pi-adapter/` (and not in tracking/routing domain modules).
- No new runtime dependencies without a written approval in this repo.
- `SPARKLE_AUTO_ADAPT` may collect and propose; it must not CAS-promote (full proposal-first).
- High-risk exploration count remains 0.
- Holdout stays sealed; updates use train/validation only.
- Fake-executor tests are the required proof path; real Pi smoke stays opt-in.
- Dual-path items (LCB; offline attribution) both ship as code + reports; only one is the live default.

---

## File map (all phases)

Existing `src/tracking/*` is the Phase A starting point. Do not create parallel `summary.ts` / `packet.ts` / `sanitizer.ts`.

| Area | Create | Modify |
| --- | --- | --- |
| Tracking A | — | `src/tracking/{types,prescore,human-score,roller,turn,analysis}.ts` |
| Supervisor A | `src/run/gate-apply.ts` | `src/run/supervisor.ts`, `src/run/events.ts` |
| Outcomes B | `src/routing/{lcb-beta,lcb-normal,lcb-select,lcb-coverage,beta-quantile}.ts` | `src/routing/{outcomes,posterior,r1}.ts` |
| Offline C | `src/routing/{offline-types,offline-logit,offline-prob-add,lin-alg}.ts`, `src/experiments/{attribution-report,threshold-calibration}.ts` | `src/routing/propensity.ts`, `src/experiments/manifest.ts`, ADR-005 protocol text only |
| Promotion D | — | `src/learning/auto-loop.ts`, `src/cli/adapt.ts`, `src/adaptation/{approval-profile,candidate,promotion}.ts`, `src/experiments/replay.ts` |

## Phase A — three lines + gates

See the Phase A plan. Gap-close against the current tracking library, then supervisor idempotent gates. Done when spec §8 cases 1–12 pass and live model choice is unchanged (still R0-equivalent `ModelRouter`).

## Phase B — outcome vector + corrected R1

See the Phase B plan. Split criteria; R1 reads only `taskSuccess`; `nObsEff` vs `nPriorEff`; dual LCB with a coverage fixture; cheapest-above-floor; hysteresis; version keys. Sparse → approved R0 baseline, never max-LCB among noisy cells.

## Phase C — offline only

See the Phase C plan. Dual-path attribution (logit + probability-additive), OPE `INVALID_ESTIMATE`, calibration report that does not change live 0.55, three-way split / compromised holdout, ADR-005 protocol sentence. No active pointer writes.

## Phase D — candidates and CAS

See the Phase D plan. `adapt auto` proposes only; one resource boundary; replay cache key; cost CI upper bound; ledger rebuild; rollback pointer consistency.

## Order and stop

Implement A → B → C → D. Stop and return to design if a task needs an incompatible M0–M2 rewrite, raw CoT in the dataset, live exploration on high-risk work, or an improvement claim without holdout.

## Still open — do not write more implementation for these

These remain questions. Phase C only records the protocol sentence; it does not answer them.

1. **ADR-005 Q1:** keep cost-delta CI upper bound ≤ $0, or relax ($0.02 / utility-per-dollar)?
2. **ADR-005 Q2:** may a simulation report close Checkpoint F item 1, or must item 1 wait for production episodes?
3. **Live 0.55:** the calibration report may recommend another threshold; applying it still requires a later approved config candidate.

## Out of v1

Dynamic live threshold, RL for κ, SM4/CCRC/ISO certification, DKT/RouteLLM live, GateController service, Temporal/OPA dependencies, SFT/RL training, limited auto-promotion after tables stabilize.

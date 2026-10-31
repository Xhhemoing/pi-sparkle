# Parent revalidation measurements — `cursor-grok-4.6`

**Phase:** 1 companion (independent of the opus cloud Task)
**Tree:** `cursor/algorithm-revalidate-9035` @ `acf034d` (branched from measure HEAD)
**Date:** 2026-08-23. Fake executor only. **Not** Outcome-supported. **Not** Checkpoint F.

Opus Phase-1 Task: `eb1979af-f16e-4ed0-a3d4-00357ad246a7` (`claude-opus-5-thinking-high-fast`).
This file is the parent coordinator’s own numbers on the same tree.

## Suites

| Command | Exit | Result |
|---|---|---|
| simulation-holdout + R1/shadow + adaptive-loop + cluster files + analyze/assign/flowchart-router/signals/auto-loop | 0 | **82 / 82** in 0.82 s |

Cluster was passed as files. Directory form is still `ERR_UNSUPPORTED_DIR_IMPORT` (runner, not algorithm).

## CLI `--track --assume-defaults --executor fake`

| Scenario | Exit | Wall | Outcome |
|---|---|---|---|
| Ordinary refactor+test | 0 | 0.737s | `run_05a90ea5-…` COMPLETED, 41 events. planner→premium (plan); scout cheap (research); implementer cheap (refactor); reviewer cheap (review); tester cheap (test). Same families on assign-v4 **and** flowchart-v4. No waits. |
| Deploy credentials | 0 | 0.762s | `run_79ff5412-…` COMPLETED, 43 events. All four roles premium, family `deploy`, `highRisk=true`, cheap rejected `complexity` + `high-risk-approval`. assign-v4 and flowchart-v4 both `WAITING_FOR_USER`. 4 waits + 4 `USER_ANSWER` all `answeredBy: assume-defaults-auto`. |
| Local-only | 1 | 0.689s | No run. `privacy class` named for cheap and premium. |
| Screenshot | 0 | 0.732s | `run_e5c2a56a-…` COMPLETED, 35 events. All premium; cheap rejected `capability`. Families plan/research/edit/review. |

No cluster spawn in any CLI run (fake executor never requests one).

## Desirability (parent, this tree)

| Pillar | Score | Evidence |
|---|---|---|
| Live routing decision quality | desirable | Ordinary 4/5 cheap; deploy all-premium with a recorded rejection matrix; vision/local-only fail closed on the named constraint |
| Attribution | desirable on the consent path | High-risk auto-select is labeled `assume-defaults-auto`, not a bare user answer |
| Policy alignment | desirable | Live still R0 + flowchart; F-SIM remains identically-observed (not re-run as a holdout dataset this pass; suite 82/82 includes the shadow report pins) |
| Usability | mixed | Ordinary + screenshot complete; local-only correctly refuses; unattended deploy still auto-clears armed gates (Stage 2 `--approve-high-risk` is owner-gated, not shipped) |

Phase 2 must wait for the opus report and must be written by `claude-fable-5-thinking-xhigh`.

# Parent Phase-1 measurements — `cursor-grok-4.6`

Tree: `cursor/algorithm-eval-polish-9035` @ `e06eee6` (branched from capability upgrade).
Date: 2026-08-23. Fake executor only. **Not** Outcome-supported. **Not** Checkpoint F.

## Suites

| Command | Exit | Result |
|---|---|---|
| Algorithm unit/sim/acceptance (files listed below) | 1 | 74 tests, **73 pass**, 1 fail — fail is `ERR_UNSUPPORTED_DIR_IMPORT` from passing `test/integration/cluster/` as a directory to `tsx --test`, not an algorithm failure |
| `test/integration/m6/simulation-holdout.test.ts` | 0 | 11/11; sim marks `evidenceClass=simulation` and cannot close production F |
| `test/unit/routing/r1-shadow-report.test.ts` + shadow + shadow-compare | 0 | R1 shadow does not invoke; live plane does not import shadow report |
| `test/acceptance/adaptive-loop.test.ts` | 0 | 2/2 CAS promote/rollback walk on fakes |
| `test/integration/cluster/peer-mailbox.test.ts` + `dynamic-spawn.test.ts` | 0 | **4/4** spawn depth/fan-out fail-closed; retry inherits undrained mail |
| analyze-task / assign / flowchart-router / signals / auto-loop | 0 | included in the 73-pass file set |

Re-run cluster as files, not a directory.

## Real CLI (fake executor, isolated state roots)

| Scenario | Command flags | Exit | Duration | Outcome |
|---|---|---|---|---|
| Ordinary default run | `--executor fake` | 0 | 0.684s | `run_127f1d0b-…` COMPLETED, 12 events, no `MODEL_ROUTED` (non-track path) |
| Ordinary `--track --assume-defaults` | fake | 0 | 1.180s | `run_697d0a1c-…` COMPLETED, 41 events. planner→**premium** (plan, MEDIUM); scout→cheap (research, LOW); implementer/reviewer/tester→cheap |
| High-risk `--track --assume-defaults` | “Deploy payment credentials to production” | 0 | 0.741s | `run_6e90dc75-…` COMPLETED, 35 events. **All four roles → premium**, family=`deploy`, `highRisk=true`, `featureVersion` assign-v3 then flowchart-v2. cheap rejected: `complexity` (MEDIUM < HIGH) **and** `high-risk-approval` |
| Local-only `--track --assume-defaults` | “Refactor billing; this must stay local” | 1 | 0.692s | No run written. Message: `No allowed model satisfies role actor and complexity MEDIUM` — **privacy refusal is real but the user-facing text hides `privacy-class`** |

## Desirability (parent, pre-opus)

| Pillar | Score | Evidence |
|---|---|---|
| Live routing decision quality | **desirable** | Track path changes models: cheap vs premium by family/risk; deploy exclusively premium with recorded rejection matrix |
| Attribution trustworthiness | **desirable** (tests) / **unexercised** (these CLI runs succeeded, so no FAIL posterior update) | Unit/auto-loop lock derived `failureClass`; CLI success paths do not stress it |
| Policy alignment | **desirable** | Sim/shadow explicitly cannot close F-PROD; live plane does not import simulation-holdout or r1-shadow-report |
| Usability | **mixed** | Ordinary + deploy work; local-only correctly refuse-closed but error omits privacy constraint |

## Anomalies Phase-2 must not ignore

1. Local-only refusal error text does not mention `privacy-class` (usability).
2. “add a unit test” in an implement objective classified `family=test` (classifier coarseness; implementer still routed cheap).
3. Default non-track `run` does not emit `MODEL_ROUTED` — live algorithm is on `--track` / `--flowchart` / `--children`.
4. No real provider, no production exposure, no legal OPE.

## Simulation claim boundary

`simulation-holdout` test “marks evidenceClass simulation and cannot close production Checkpoint F” passed. Treat all F-SIM numbers as simulation-only.

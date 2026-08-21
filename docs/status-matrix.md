# Status matrix (Developer Preview)

This is the executable map of what is implemented, wired, exercised, and
outcome-supported. It is **not** a production readiness certificate.

Definitions (ADR-004):

- **Present** — code or candidates exist.
- **Wired** — a runtime or CLI path can invoke it.
- **Exercised** — tests or local fake runs have used that path.
- **Outcome-supported** — held-out or comparable later benefit, no guardrail
  regression. Nothing in this repo is Outcome-supported.

## Runtime line (M0–M2.5)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| Fake executor `run` / `inspect` / `resume` | yes | yes | yes | no | Default local path. Quality gate: `pnpm gate`. |
| `--children` parent coordinator | yes | yes | yes | no | Fake child executor when `--executor` is omitted or `fake`. Not the flowchart engine. |
| `compileChildrenToFlowchart` | yes | no | library tests | no | CLI `--children` does **not** compile into `--flowchart`. |
| `--flowchart` supervisor | yes | yes | yes | no | Public orchestrator. Incompatible with `--children` / `--track`. Optional `--executor fake\|pi` runs RUNNING nodes; `--results` still overrides. |
| Event log + checkpoint + resume | yes | yes | yes | no | Truncated JSONL tail recovered; corrupt middle line fails closed. |
| Episode bind / `inspect --episode` | yes | yes | yes | no | Reducer is fail-closed on duplicate open/attach, terminal replay, and dangling cross-stream refs. |
| Coverage gate | yes | `--track` / parent start | unit + integration | no | Skip-contracts and answered questions still start. |
| Real Pi executor | yes | `--executor pi` | opt-in `PI_SMOKE=1` | no | Needs Node `>=22.19.0`, credentials, models, network. |
| `doctor` | yes | yes | unit tests | no | Developer-preview preflight. Output contract is not frozen. |

## Adaptive library line (M3–M6)

| Capability | Present | Wired | Exercised | Outcome-supported | Notes |
|---|---|---|---|---|---|
| R0 / static `ModelRouter` | yes | live flowchart + `--children` assign | yes | no | Live path. |
| Public prior snapshot | yes | `--public-prior` | yes | no | Hashed frozen file only; no HTTP leaderboard fetch. |
| R1 / bandit / topology | yes | **shadow / offline only** | module tests | no | Must not import into live execution until F-PROD. |
| Auto-loop collect + propose | yes | after `--track` / `--children` | yes | no | Never CAS-promotes. `adapt promote --approve` required. |
| Promotion CAS + rollback | yes | CLI | unit tests | no | Proposal-first. |
| Preferences + tombstones | yes | `pref` CLI | yes | no | Dataset export now lists tombstone ids and drops payloads. |
| Checkpoint F-SIM | machinery | experiments | simulation tests | no | Must not close F-PROD. |
| Checkpoint F-PROD | no | no | no | no | Sealed holdout still open (ADR-005). |

## Policy gates (human)

| Item | Owner | Inputs | Exit | Verify |
|---|---|---|---|---|
| ADR-004 | product + privacy | this matrix, adaptive spec | Accepted or revised | Status line in `docs/decisions/0004-controlled-adaptation.md` is not Proposed |
| Six adaptive defaults | product | spec § Decision required | Approved or revised in an accepted spec | `docs/specs/adaptive-agent-work-loop.md` |
| P0 privacy dictionary | runtime + privacy | `src/privacy/record-classes.ts` | Independent review has no blocker | `pnpm test -- test/unit/privacy/record-classes.test.ts` |
| Checkpoint D | adaptive | remaining M3 leftovers | Whole-checkpoint scenarios, not module tests only | `tasks/adaptive-todo.md` |
| Checkpoint F-PROD | routing | sealed holdout, paired utility CI | 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005; do not start before P0 + Provider smoke |
| Checkpoint G Outcome-supported | routing | F-PROD | Held-out benefit without guardrail regression | Forbidden until F |

Live R1, bandit, and topology stay off the execution path until F-PROD closes.

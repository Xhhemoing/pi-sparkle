# Algorithm evaluation process log — 2026-08-23

Purpose: record every phase, actor/model slug, action, and measured result
for the keep / deepen / replace decision on pi-sparkle routing, cluster,
and adaptation algorithms. This is **not** an Outcome-supported claim.

## Actors

| Role | Model slug | Notes |
|---|---|---|
| Parent coordinator | `cursor-grok-4.6` | This run. Cross-validate + polish. |
| Phase 1 measurement | `claude-opus-5-thinking-high-fast` | Cloud subagent: simulate + real-test, collect data |
| Phase 2 strategy | `claude-fable-5-thinking-xhigh` | Cloud subagent: decide keep / deepen / replace from data + plan purpose |

## Phase 0 — goal armed

- **Actor:** `cursor-grok-4.6`
- **Action:** Created durable goal; process log started; branched `cursor/algorithm-eval-polish-9035` from `e06eee6` (live analyzeTask + provenance-bound failureClass).
- **Result:** Goal active. Message queue empty. Phase 1 launched in this turn.

## Phase 1 — measurement (in progress)

### 1a. Parent local measurement — `cursor-grok-4.6`

- **Action:** Ran simulation-holdout, R1/shadow, adaptive-loop, cluster files, routing/learning units; ran four fake-executor CLI scenarios (ordinary run, ordinary track, deploy track, local-only track).
- **Result:** Algorithm suites green except a runner directory-import mistake. CLI: ordinary track cheap/premium split; deploy all-premium with cheap high-risk+complexity rejections; local-only exit 1 with a privacy filter that is not named in the error. Details: `docs/reports/2026-08-23-algorithm-measurement-parent.md`.
- **Cloud Phase-1 agent launched:** [Measure algorithm sim and real tests](4ff74c4c-8d6b-4033-9e5b-30c2106475e8) slug `claude-opus-5-thinking-high-fast` (awaiting return).

### 1b. Cloud measurement — `claude-opus-5-thinking-high-fast`

- **Actor:** [Measure algorithm sim and real tests](4ff74c4c-8d6b-4033-9e5b-30c2106475e8)
- **Action:** Independent sim + CLI measurement on `e06eee6`; adversarial attribution probes; live-import closure; one usability fix.
- **Result:** `pnpm gate` 1183 / 1182 / 0 / 1. Live routing changes models. Vision/local-only fail-closed. F-SIM utility delta identically 0 by construction. High-risk approval not armed on flowchart-v2. `TEST_RE` family pollution. Refusal text now names privacy/capability (`8a36554`). Report: `docs/reports/2026-08-23-algorithm-measurement.md`. HEAD `b83f6cb`.

## Phase 2 — strategy (closed)

- **Actor:** [Phase 2 algorithm strategy](98dfd022-f81d-435a-a927-865cc5320066) slug `claude-fable-5-thinking-xhigh`. Earlier launch `0e744a30-1f6c-4e85-8973-3ee04b104887` was not visible in this environment.
- **Action:** keep / deepen / replace against plan purpose + Phase-1 data; re-measured at `69274ec`.
- **Result:** `docs/reports/2026-08-23-algorithm-strategy.md` @ `fa73631`. **Keep** routing selector, cluster, and adaptation. **Deepen** only gate-consent provenance. **Replace** nowhere. F-SIM stays identically-observed. Stage 2 (`--approve-high-risk`) needs owner sign-off; no live R1. Parent cross-validates: verdict matches Phase-1 opus numbers and the `69274ec` CLI re-run.

## Phase 3 — parent polish (partial) — `cursor-grok-4.6`

- **Action (earlier):** Deepen live `analyzeTask` without replacing R0. Role-first family; review/refactor outrank test; reasoning raises complexity not a hard capability; premium catalog declares `vision`. Bump `assign-v4` / `flowchart-v3`.
- **Result (earlier):** Ordinary `--track` families `plan/research/refactor/review/test` on assign-v4. Screenshot `--track` completes on premium. Residuals at that HEAD: tester collapsed to implementer on flowchart; high-risk gate unarmed; F-SIM utility ≡ 0.
- **Action (this turn):** Persist `FlowNode.agentRole`; `routeFlowNode` uses `resolvedAgentRole` and arms `approvalRequired || analysis.highRisk`; `--assume-defaults` records the wait then auto-selects default approval items; F-SIM reports `observedUtilityOnBothArms` + selection disagreement without inventing counterfactual utility. Bump `flowchart-v4`. Commit `69274ec`.
- **Result (verified `cursor-grok-4.6`):**
  - Targeted suites + typecheck + lint green before/with the commit.
  - `pnpm gate`: **1189 / 1188 / 0 / 1** (skip = `PI_SMOKE=1`).
  - Simulation-holdout + adaptive-loop + cluster files: **17/17**.
  - CLI `--track --assume-defaults --executor fake` (isolated `/tmp` project):
    - Ordinary refactor+test, 0.760s, exit 0, `run_ef7fee06-…`, 41 events. Families `plan/research/refactor/review/test` on **both** assign-v4 and **flowchart-v4** (tester no longer collapses). planner→premium, others cheap.
    - Deploy credentials, 0.746s, exit 0, `run_e5909ad5-…`, 43 events. All premium, `highRisk=true`, cheap rejected `complexity` + `high-risk-approval`. Flowchart-v4 events are `WAITING_FOR_USER`. **4** `RUN_WAITING_FOR_USER` + **4** `USER_ANSWER` then COMPLETED (gate armed; assume-defaults auto-selects).
    - Local-only, 0.712s, exit 1, no run: `privacy class` named for cheap and premium.
    - Screenshot, 0.721s, exit 0, `run_601dc867-…`, 35 events, all premium, flowchart-v4, cheap rejected `capability`.
  - ManagePullRequest create failed (`must be a collaborator`). Branch: `cursor/algorithm-eval-measure-9035`.

## Phase 3b — Stage 1 consent provenance — `cursor-grok-4.6`

- **Action:** Implement fable's Stage 1 only (no behavior change, no `flowchart-v5`). `USER_ANSWER.answeredBy` is `assume-defaults-auto` when `autoSelectDefaultApprovals` applies a gate, `user` on resume/`answer`/child-coordinator replies, and absent on pre-increment logs (legacy, accepted).
- **Result:** pending targeted tests + `pnpm gate` this turn. Stage 2 not shipped (owner decision).

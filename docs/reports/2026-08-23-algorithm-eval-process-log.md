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

## Phase 2 — strategy (in progress)

- **Actor:** [Decide keep deepen or replace](0e744a30-1f6c-4e85-8973-3ee04b104887) slug `claude-fable-5-thinking-xhigh` — earlier launch; not visible in this environment.
- **Relaunch:** [Phase 2 algorithm strategy](98dfd022-f81d-435a-a927-865cc5320066) slug `claude-fable-5-thinking-xhigh` (cloud Task, this turn).
- **Action:** keep / deepen / replace against plan purpose + Phase-1 data.
- **Result:** pending (`docs/reports/2026-08-23-algorithm-strategy.md` not yet on this tree). Parent must not write that verdict.

## Phase 3 — parent polish (partial) — `cursor-grok-4.6`

- **Action (earlier):** Deepen live `analyzeTask` without replacing R0. Role-first family; review/refactor outrank test; reasoning raises complexity not a hard capability; premium catalog declares `vision`. Bump `assign-v4` / `flowchart-v3`.
- **Result (earlier):** Ordinary `--track` families `plan/research/refactor/review/test` on assign-v4. Screenshot `--track` completes on premium. Residuals at that HEAD: tester collapsed to implementer on flowchart; high-risk gate unarmed; F-SIM utility ≡ 0.
- **Action (this turn):** Persist `FlowNode.agentRole`; `routeFlowNode` uses `resolvedAgentRole` and arms `approvalRequired || analysis.highRisk`; `--assume-defaults` records the wait then auto-selects default approval items; F-SIM reports `observedUtilityOnBothArms` + selection disagreement without inventing counterfactual utility. Bump `flowchart-v4`.
- **Result:** tests pending this turn; strategy still owned by fable.

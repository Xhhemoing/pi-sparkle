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

Pending.

# Algorithm revalidation process log — 2026-08-23 (new `/goal`)

Purpose: record every phase, actor/model slug, action, and measured result
for a fresh simulate → decide → polish cycle. This is **not** an
Outcome-supported claim and cannot close Checkpoint F-PROD.

Prior cycle artifacts (do not substitute for this goal’s required slugs):
`docs/reports/2026-08-23-algorithm-eval-process-log.md`,
`docs/reports/2026-08-23-algorithm-measurement.md`,
`docs/reports/2026-08-23-algorithm-strategy.md`.

## Actors

| Role | Model slug | Notes |
|---|---|---|
| Parent coordinator | `cursor-grok-4.6` | This run. Cross-validate + polish. Must not write the Phase-2 verdict. |
| Phase 1 measurement | `claude-opus-5-thinking-high-fast` | Cloud Task only |
| Phase 2 strategy | `claude-fable-5-thinking-xhigh` | Cloud Task only; after Phase-1 data exists |

## Phase 0 — goal armed

- **Actor:** `cursor-grok-4.6`
- **Action:** Created durable goal; branched `cursor/algorithm-revalidate-9035` from `acf034d` on `cursor/algorithm-eval-measure-9035` (flowchart-v4 + Stage-1 `answeredBy`).
- **Result:** Goal active. Message queue empty. Phase 1 opus Task launched this turn: [Phase 1 measure algorithms](eb1979af-f16e-4ed0-a3d4-00357ad246a7) slug `claude-opus-5-thinking-high-fast`. Phase 2 fable not launched until opus data exists.

## Phase 1a — parent measurement — `cursor-grok-4.6`

- **Action:** Ran the algorithm file suites and four fake-executor `--track --assume-defaults` CLI scenarios on `acf034d`.
- **Result:** Suites **82/82**. Ordinary `run_05a90ea5-…` 41 events, families isolated on flowchart-v4. Deploy `run_79ff5412-…` 43 events, gate armed, 4× `answeredBy: assume-defaults-auto`. Local-only exit 1 names privacy. Screenshot `run_e5c2a56a-…` 35 events all premium. Details: `docs/reports/2026-08-23-algorithm-revalidate-measurement-parent.md`.
- **Cloud Phase-1:** still running ([Phase 1 measure algorithms](eb1979af-f16e-4ed0-a3d4-00357ad246a7)). Fable not started.

## Phase 1b — cloud measurement — `claude-opus-5-thinking-high-fast`

- **Actor:** [Phase 1 measure algorithms](eb1979af-f16e-4ed0-a3d4-00357ad246a7)
- **Action:** Independent sim + CLI + adversarial probes on `acf034d` / `af244ca`; one measurement-harness fix.
- **Result:** `docs/reports/2026-08-23-algorithm-revalidate-measurement.md` @ `012cc69`. Gate after fix **1191 / 1190 / 0 / 1**. F-SIM honesty fields now forwarded from `runSimulationHoldout` (`8d98522`). Parent numbers agree where they overlap. No keep/deepen/replace written (correct).

## Phase 2 — strategy — `claude-fable-5-thinking-xhigh`

- **Actor:** [Phase 2 keep deepen replace](5748aebb-c904-40a8-8c75-91faf8df6177) slug `claude-fable-5-thinking-xhigh`.
- **Action:** keep / deepen / replace from opus + parent data and ADR-004 / routing final plan.
- **Result:** `docs/reports/2026-08-23-algorithm-revalidate-strategy.md` @ `4ee3ed0`. Verdicts: routing **keep** (deepen feature inputs A2/A6/A4 via owner proposals), cluster **keep**, adaptation **keep** (deepen attribution). Single named increment shipped as `bb54866`: extraSignals prose can exculpate but never inculpate — the A5 prose-fallback to `failureClass: model` now degrades to "not attributable", so a prose-only FAIL cannot move a posterior. Gate after: **1194 / 1193 / 0 / 1**. F-SIM stays identically-observed (no counterfactual ADR). High-risk gate stays armed; Stage 2 `--approve-high-risk` remains owner-gated, not reversed. No new live selector; no R1/bandit/topology in live; simulation ≠ F-PROD.

## Phase 3 — parent cross-validate + polish — `cursor-grok-4.6`

- **Action:** Re-read `parseObservedSignal` and the A5 tests; they match the fable spec (prose `model` fallback → missing class; 429/tool/contract still land; `classifyTaskFailure` itself untouched). Shipped fable successor (c) A3: CLI run summary names how many high-risk gates `--assume-defaults` auto-cleared. Did **not** ship A2/A4/A6/`--approve-high-risk` in that increment (owner-gated risk de-escalation still not shipped).
- **Result:** A5 unit/bandit/auto-loop **26/26**. Track + CLI A3 tests **6/6**. `pnpm gate` @ `865fd30`: **1196 / 1195 / 0 / 1**. Live path remains R0 + flowchart; Stage 2 still owner-gated.

## Phase 4 — successor queue A2 + A6 + A4 + A7 — `cursor-grok-4.6`

- **Action:** Continue the fable successor queue in leverage order, without de-escalating sibling **high-risk** (Stage 2 still owner-gated) and without rewriting the Phase-2 verdict file.
  - **A2 + A6 as assign-v5:** `vision` only for implementer / debugger / worker; planner / scout / reviewer / tester stay `tool-use` on a shared screenshot objective. Generic edit roles skip `TEST_RE` so "Verify … QA coverage" stays `family: edit`. Review/refactor still outrank test. Deploy-family and `highRisk` sibling escalation untouched.
  - **A4 as flowchart-v5:** when compile persisted `agentRole`, `routeFlowNode` records `analyzeTask` complexity (scout/tester LOW) instead of `max(supervisor MEDIUM floor, analysis)`. Legacy nodes without `agentRole` still take the floor.
  - **A7:** live-selector transitive import graph from `model-router.ts` and `assign.ts` must not reach `r1` / `bandit` / `shadow` / `r1-shadow-report` / `propensity` / `simulation-holdout`. The 10-file textual allowlist stays. Walk is *not* from `src/cli/main.ts` because `track/loop` → `runAutoAdaptLoop` legitimately sees bandit after the run.
- **Result (pre-gate):** targeted routing/flowchart/isolation suites **42/42**. Feature versions bumped together. Stage 2 `--approve-high-risk` still not shipped. CLI re-measure and `pnpm gate` follow this commit.

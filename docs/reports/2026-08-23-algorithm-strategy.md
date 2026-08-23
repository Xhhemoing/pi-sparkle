# Algorithm strategy — keep / deepen / replace — 2026-08-23

**Model slug:** `claude-fable-5-thinking-xhigh` (Phase 2 of the locked algorithm evaluation;
this file is the Phase-2 deliverable named in
[the process log](2026-08-23-algorithm-eval-process-log.md)).
**Tree measured:** `cursor/algorithm-eval-measure-9035`, live code at `69274ec`
(`fix(routing): persist agent roles and arm the high-risk flowchart gate`); docs HEAD was
`ff8de7a` when measurement finished.
**Executor:** deterministic fake only. No real provider, no production episode, no sealed
holdout, no legal OPE. **Nothing in this file is an Outcome-supported claim and nothing
here closes Checkpoint F-PROD.**

Authorities honoured: [routing final plan](../research/model-routing-final-plan.md),
[ADR-004](../decisions/0004-controlled-adaptation.md),
[adaptive work loop](../specs/adaptive-agent-work-loop.md),
[status matrix](../status-matrix.md).
Inputs: Phase-1 measurement ([opus report](2026-08-23-algorithm-measurement.md),
[parent report](2026-08-23-algorithm-measurement-parent.md), both at `e06eee6`) plus my
own re-measurement at `69274ec`, because the parent coordinator (`cursor-grok-4.6`)
shipped `eb1a2bf` (assign-v4) and `69274ec` (flowchart-v4) *during* this evaluation.
Where Phase-1 anomalies were already fixed at HEAD, this strategy ratifies and refines
that work; it does not repeat or revert it.

---

## 1. What I re-measured at `69274ec` (this phase, fresh numbers)

| Check | Result |
|---|---|
| `pnpm gate` | exit 0 — **1189 tests / 1188 pass / 0 fail / 1 skip** (skip = `PI_SMOKE=1` real-provider smoke), ~27 s |
| Ordinary `--track --assume-defaults` (fake, isolated state root) | `run_50b0af0d-…` COMPLETED, 41 events, 0.76 s. planner→premium, scout/implementer/reviewer/tester→cheap. Families `plan/research/refactor/review/test` on **both** `assign-v4` and `flowchart-v4` — the tester no longer collapses to implementer (Phase-1 residual fact 6 is closed by `FlowNode.agentRole` + `resolvedAgentRole`) |
| Deploy `--track --assume-defaults` | `run_c06046e5-…` COMPLETED, 43 events. All roles premium, `highRisk=true`, cheap rejected on `complexity` + `high-risk-approval`. **Both** `assign-v4` and `flowchart-v4` events say `statusAfterRoute: WAITING_FOR_USER` (Phase-1 anomaly A4, the contradictory approval records, is gone). 4× `RUN_WAITING_FOR_USER`, each followed by a `USER_ANSWER` `"Selected route:premium"` written by the auto-select loop, then `RUN_COMPLETED` |
| Deploy `--track` (no flags) | `run_810ad368-…` exits `WAITING_FOR_USER` at the **clarify** stage (q-done, q-tests) after 7 events; routing is never reached. The CLI then suggests `--assume-defaults or --answers <file.json>` |
| Deploy `--track --answers <file>` (clarify answered, no blanket defaults) | `run_cf43fb18-…` exits `WAITING_FOR_USER` at the **first route gate**, 13 events, all five roles HIGH→premium. The human gate genuinely blocks on the attended path |

These agree with the parent's independent re-run recorded in the process log
(gate 1189/1188/0/1; ordinary/deploy/local-only/screenshot scenarios). Phase-1 facts not
re-tested here (adversarial attribution probes, cluster deny table, F-SIM utility ≡ 0,
transitive import closure) are carried forward from the
[opus report](2026-08-23-algorithm-measurement.md) unchanged, since none of the commits
since `e06eee6` touch those code paths except `r1-shadow-report.ts` (additive fields only).

---

## 2. Verdicts

| Algorithm | Verdict | Why (grounded in the numbers) |
|---|---|---|
| **Routing** (`analyzeTask` + R0 catalog filter + flowchart `routeFlowNode`) | **keep** the selector; **deepen** only gate-consent recording | At `69274ec` live selection is measurably correct on every probed scenario — ordinary work 4/5 cheap, deploy all-premium with a truthful per-model rejection matrix, vision/local-only fail closed naming the binding constraint, families role-true on both feature versions — and the one defect left on this path is not a selection defect: flag-sourced gate consent is recorded as a `USER_ANSWER` indistinguishable from a human's (§3, §6). |
| **Cluster** (spawn depth, fan-out, peer mail, lifecycle) | **keep** | The limits fail closed on every probe in the Phase-1 deny table (depth 2 refused, 5th spawn refused, leaf roles refused, undrained mail inherited on retry; 4/4 integration files, included in the 1188 passing), and no live run has ever fired a spawn under the fake CLI — so there is zero adverse evidence to justify change, and calibrating the static constants before real spawn data exists would be tuning against nothing. |
| **Adaptation** (signals, failureClass, auto-loop, CAS promotion) | **keep** | The provenance boundary survived adversarial probing (forged `failureClass` and forged/human-sourced `taskSuccess` rejected; 429/transport/`TASK_TIMEOUT` classified non-model; runtime transport evidence outranks agent self-report; `observationsForR1` kept 2 of 7 rows) and `runAutoAdaptLoop` returns `promoted: false` on every branch — this is the healthiest subsystem and rebuilding it is negative-value work. |

**No measured number supports "replace" anywhere.** The Phase-1 question "do the
algorithms do anything?" is answered yes with event-log evidence, and the failure modes
that measurement found (unarmed gate, family pollution, tester collapse, wrong refusal
text) were all *input and wiring* defects, all now fixed on the live R0 + flowchart path
at `69274ec` — exactly the final plan's leverage order (eligibility → features/version
isolation → outcome attribution → experiment identifiability), not a smarter selector.
This matches the earlier effectiveness verdict (`claude-opus-5-thinking-high-fast`,
agent `8b6a5ec2-64f3-4ee9-b72e-813deab0ef56`): foundation repair, do not replace R0.

Work the parent shipped mid-evaluation and that this strategy **ratifies**:

- `eb1a2bf` (assign-v4): role-first family isolation, review/refactor outrank test,
  reasoning escalates complexity instead of demanding an undeclarable capability,
  premium declares `vision`. Closes Phase-1 A2/A5 with the required feature bump.
- `69274ec` (flowchart-v4): `FlowNode.agentRole` persisted through compile;
  `routeFlowNode` arms `approvalRequired || analysis.highRisk`; `--track` passes
  high-risk assignments into compile; F-SIM gains `observedUtilityOnBothArms: true`
  plus `selectionDisagreementCount/Rate`. Closes Phase-1 A3/A4 and residual fact 6.

---

## 3. Single next increment

**Name: consent provenance for the armed high-risk gate — "blanket defaults are not
high-risk consent".**

The measured gap: on the only unattended path where live routing actually runs
(`--track --assume-defaults`), each armed high-risk gate is auto-satisfied by the flag
and the event log records it as a `USER_ANSWER` (`"Selected route:premium"`, see
`run_c06046e5-…` events 10–11, 18–19, 26–27, 34–35) — the same event, with the same
payload shape, that a real human reply produces through `pi-sparkle answer`. An auditor
replaying that log would conclude a user approved four production-credential gates.
Every other part of this system refuses exactly this kind of provenance blur: taskSuccess
is source-bound, failureClass is derived-only, behavior distributions are honest one-hots.
Consent must meet the same bar. ADR-004 is explicit that credentials and security
boundaries "always require explicit approval", and a blanket unattended flag whose
documented job is answering clarify questions is not explicit approval of a specific
high-risk action.

The increment, in two stages on the live R0 + flowchart path:

1. **Provenance labeling (no behavior change).** Approval replies applied by
   `autoSelectDefaultApprovals` carry an explicit machine source (e.g.
   `answeredBy: "assume-defaults-auto"` on the `USER_ANSWER` payload, or a distinct
   event field `autoSelected: true`), while replies arriving through
   `answer`/`resume` carry `answeredBy: "user"`. Replay of pre-existing logs must not
   fail closed (absent field = legacy). Downstream consumers (episode reconstruction,
   any future audit) can then distinguish flag consent from human consent.
2. **Explicit high-risk consent (behavior change — needs owner sign-off).**
   `--assume-defaults` keeps answering clarify/coverage questions and may keep
   auto-selecting *non-high-risk* route/branch defaults, but stops satisfying a ROUTE
   gate whose decision has `highRisk: true`; such a run exits `WAITING_FOR_USER`
   (resumable, exactly like today's `--answers` deploy run at 13 events) unless a
   dedicated flag (`--approve-high-risk`) or a per-task answers entry grants it, and
   that grant is recorded as flag-sourced consent, not as a bare user answer.

**I ship no code in this phase.** Reasons, in order: stage 2 reverses unattended-deploy
semantics the parent deliberately shipped in `69274ec` during this very evaluation —
under the repo's own proposal-first culture that flip needs the owner's decision, not a
subagent's; the task brief's bar for implementing ("small and already evidenced") is not
met for a behavior change that will make every unattended deploy-flavoured run block; and
stage 1 alone without stage 2 is only half the increment. The specification above plus §7
is the proposal.

This increment stays on the live R0 + flowchart path, changes no model selection, feeds
nothing into bandit/avoid/R1, and serves the controlled-adaptation purpose directly: it
keeps the audit trail honest enough that future outcome attribution and any later
F-PROD evidence can trust what the log says a human approved.

Successor queue after this increment (named, not part of it): (a) strengthen the
live-isolation guard from the 10-file textual allowlist in
`test/unit/routing/live-isolation.test.ts` to a transitive import-graph assertion over
the real `src/cli/main.ts` closure (Phase-1 §6 measured 154 live modules vs 10 guarded;
the invariant currently holds but the guard would not catch a new live file or a
re-export); (b) replace the regex-over-error-message control flow at
`flowchart-supervisor.ts` (`/fits the remaining cost and time limits/i`) with a
structured constraint code on `RoutingRefusalError`, keeping the user-facing strings
byte-identical; (c) document that `test/integration/cluster/` must be passed to
`tsx --test` as files, not a directory (`ERR_UNSUPPORTED_DIR_IMPORT` is a runner issue,
not an algorithm failure).

---

## 4. What must not be done

- **No live R1 / bandit / topology.** F-PROD is open; the status matrix and final plan
  §5 forbid it, and the isolation guard is currently weaker than the invariant it
  protects (§3 successor a), which is a reason for more caution, not less.
- **No fake counterfactual utilities presented as F-PROD evidence.** F-SIM's paired
  utility delta is identically zero by construction (`r1-shadow-report.ts` assigns both
  arms the same observed label); its 100 % selection disagreement and +0.0448 USD cost
  delta are simulation facts, never quality claims. More simulation can never move
  decision 1's utility LCB above zero.
- **No inventing catalog capabilities to make objectives routable.** The `vision`
  declaration on premium was a catalog-owner assertion shipped with assign-v4; do not
  extend the pattern (e.g. declaring `reasoning`) as a routing convenience — analyzeTask
  was instead changed so quality gradients escalate complexity rather than hard-filter.
- **No tracking/human scores into bandit, avoid, or R1.** Only attributable
  `taskSuccess` with `failureClass === "model"` may lower a posterior; the adversarial
  probes that verified this boundary are the reason adaptation's verdict is *keep*.
- **No replacing R0 with a learned or LLM-based live selector**, and no LLM classifier
  for `analyzeTask` without a sealed comparison with regex fallback (final plan F4).
- **No treating auto-selected `USER_ANSWER` records as human consent** in any audit,
  report, or learning signal — this is the gap §3 exists to close, and until it lands
  the events at `run_c06046e5-…` and its siblings must be read as flag-sourced.
- **No changing the load-bearing refusal strings** in `model-router.ts` /
  `flowchart-supervisor.ts` (cost/time and high-risk wordings): the supervisor
  regex-matches them to fail a single node instead of the whole run, and two regression
  tests pin them.
- **No claiming Checkpoint F, Outcome-supported status, or production improvement**
  from anything in this evaluation — every number here is fake-executor evidence.

---

## 5. F-SIM: stay identically-observed

**Recommendation: keep F-SIM identically-observed (honest zero utility) with selection
disagreement as the first-class simulation metric — which `69274ec` already shipped
(`observedUtilityOnBothArms: true`, `selectionDisagreementCount`,
`selectionDisagreementRate`). Do not add a counterfactual outcome model now.**

Grounds: the zero is a feature, not a bug — the harness refuses to invent an outcome for
a model that was never invoked, which is the same honesty rule the rest of the system
enforces. What F-SIM can legitimately measure it measures well: selection divergence
(30/30 pairs in Phase 1), cost delta (+0.0448 USD with a positive CI upper bound, which
independently blocks a "better" claim), holdout-vault contamination resistance, and claim
suppression (`evidenceClass: "simulation"`, `canCloseProductionCheckpointF: false` are
hard-coded). A separately-validated counterfactual outcome model would require its own
ADR, its own validation dataset, and even if perfect could still only close F-SIM — by
decision 2 it can never close production Checkpoint F. That effort competes directly with
the only evidence that can move decision 1: real paired production outcomes. If the owner
ever wants a nonzero simulated delta, the ADR must specify how the counterfactual model
is validated against data disjoint from both train and holdout, and every report it
touches must carry the counterfactual-model version — but nothing measured today
justifies starting that work.

---

## 6. High-risk human gate: keep it armed; `--assume-defaults` must not stand in for consent

**Arm the gate: yes — it is armed at `69274ec` and should stay armed.** Verified at HEAD:
`routeFlowNode` derives `approvalRequired: node.approvalRequired || analysis.highRisk`,
compile no longer hardcodes `false`, and the deploy run records `WAITING_FOR_USER`
consistently on both `assign-v4` and `flowchart-v4` events (A3 and A4 both closed). The
attended path proves the gate is real: with clarify answered via `--answers` and no
blanket flag, the deploy run stops at the first route gate (`run_cf43fb18-…`,
`WAITING_FOR_USER`, resumable). The Phase-1 precondition "fix A5 before arming A3" was
honoured — assign-v4 fixed the family pollution first, so an over-firing classifier is
no longer blocking ordinary work behind the gate (ordinary run: `highRisk=false`, zero
gates, 41 events, unchanged).

**How `--assume-defaults` should interact — clarify ≠ route approval.** Today the flag
does three jobs: answers clarify/coverage questions with defaults, auto-selects branch
defaults, and (since `69274ec`) auto-selects the `defaultSelected: true` "Use <model>"
item on high-risk route gates after recording the wait. The first two are what the flag's
name promises. The third conflates "assume my clarifying answers" with "I approve
high-risk execution", and the CLI actively steers users into it: when an attended deploy
run blocks at clarify, the printed hint is `re-run with --assume-defaults or --answers` —
the first suggestion silently waives the gate the user is about to hit. The shipped
design is defensible as an interim (the wait *is* recorded, so the audit trail shows an
armed gate, unlike pre-`69274ec` where no gate existed at all), but the end state should
be §3: blanket defaults answer questions; high-risk consent is a separate, explicit,
provenance-labeled grant (`--approve-high-risk` or per-task answers), and unattended
high-risk without it stays `WAITING_FOR_USER`. Route approval items on high-risk
decisions should then carry `defaultSelected: false` so no generic default-selection
sweep — present or future — can pick them up.

---

## 7. Success criteria / tests / gates for the increment

Scope guard: no `analyzeTask`/sensor change, so **no `ASSIGN_FEATURE_VERSION` bump**;
stage 2 changes the live human-gate behavior, which under the feature-version contract
requires bumping `FLOWCHART_FEATURE_VERSION` to `flowchart-v5` (stage 1 alone, changing
only event payload provenance, does not).

Stage 1 (provenance labeling) is done when:

- Unit: an approval reply applied by `autoSelectDefaultApprovals` produces an event whose
  payload names the machine source; a reply through `answer`/`resume` names the user
  source; domain validation accepts both plus the absent-field legacy form.
- Integration (`test/integration/track/track-loop.test.ts`): the deploy +
  `--assume-defaults` run's four consent events all carry the machine source; replaying a
  pre-increment event log still reconstructs (no fail-closed on the missing field).
- Nothing else moves: ordinary run still 41 events, deploy still 43, same routed models,
  same `MODEL_ROUTED` payloads.

Stage 2 (explicit high-risk consent; after owner sign-off) is done when:

- Integration: deploy + `--assume-defaults` **without** `--approve-high-risk` exits
  `WAITING_FOR_USER` at the first route gate with a resume hint naming the new flag;
  with the flag it completes and every gate's consent event cites the flag as source;
  ordinary (non-high-risk) `--assume-defaults` behavior is byte-identical to today.
- Unit: high-risk route approval plans carry `defaultSelected: false` on the model item;
  non-high-risk plans are unchanged; `routeFlowNode` decisions are unchanged (selection,
  eligibility, rejections — this increment must not alter any model choice).
- Regression: the two load-bearing refusal-string tests in
  `test/unit/supervisor/flowchart-router.test.ts` stay green untouched.
- `FLOWCHART_FEATURE_VERSION === "flowchart-v5"` with a reason line, and a status-matrix
  note that posteriors keyed on `flowchart-v4` are not reused across the bump.

Gates for both stages: `pnpm gate` green at ≥ the `69274ec` baseline (1189 tests, 0
fail, 1 skip), `pnpm typecheck`, `pnpm lint`; all evidence remains fake-executor and is
recorded as such — this increment produces **no** Outcome-supported claim and touches
**no** F checkpoint.

---

## 8. 中文总结

Phase 2（模型 `claude-fable-5-thinking-xhigh`）在 `69274ec` 上复测后的结论：三个算法都
**keep**，任何实测数字都不支持 replace。路由的选择器保留，仅剩的 deepen 点不在选模而在
审批同意的记录方式；集群限制全部 fail-closed 且无任何不利证据；归因边界经对抗性探测
仍然可信，是最健康的子系统。评估期间父协调者已合入 assign-v4 与 flowchart-v4：家族
隔离修复、tester 角色在 flowchart 编译后保留、高风险人工门已在真实执行路径上武装
（本阶段实测：部署任务四个门均记录 `WAITING_FOR_USER`，`--answers` 的有人值守路径
真实阻塞）。唯一命名的下一增量：**高风险门的同意来源标注**——`--assume-defaults`
自动通过的门目前被记录为与真人回答无法区分的 `USER_ANSWER`，须先标注机器来源，再经
产品负责人批准后让高风险门不可被通用默认旗标满足（新增显式 `--approve-high-risk`，
并 bump `flowchart-v5`）。本阶段不改代码：行为翻转属于产品决策，且推翻的是评估期间
父协调者刚合入的设计，须走 proposal-first。F-SIM 保持双臂同观测标签（utility 恒 0 是
诚实而非缺陷），以 selection disagreement 为一等仿真指标（已随 `69274ec` 合入）；
不建议现在建反事实结果模型，若建须先立 ADR。全部证据均为 fake executor，不构成
Outcome-supported 声称，不能关闭 Checkpoint F-PROD。

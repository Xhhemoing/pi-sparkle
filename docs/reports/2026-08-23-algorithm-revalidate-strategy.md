# Algorithm revalidation strategy — keep / deepen / replace — 2026-08-23

**Model slug:** `claude-fable-5-thinking-xhigh` (Phase 2 of the locked algorithm
revalidation; this file is the Phase-2 deliverable named in
[the revalidation process log](2026-08-23-algorithm-revalidate-process-log.md)).

**Tree measured:** `cursor/algorithm-revalidate-9035`, docs HEAD `acb4c4e` at the start of
this phase. Live code HEAD is `8d98522` (`fix(experiments): forward F-SIM honesty flags out
of runSimulationHoldout`): `git diff --name-only 8d98522 acb4c4e -- src test` is **empty**,
so every Phase-1 number below is valid on this tree. Re-verified fresh this phase:
`pnpm gate` exit 0 — **1191 tests / 1190 pass / 0 fail / 1 skip** (skip =
`PI_SMOKE=1` real-provider smoke), 27.1 s — byte-for-byte the opus row-7 baseline.

**Executor:** deterministic fake only, in every input to this verdict. No real provider
call, no production episode, no sealed holdout, no legal OPE. **Nothing in this file is an
Outcome-supported claim, nothing here closes Checkpoint F-PROD, and simulation evidence is
never treated as production Checkpoint F.**

Authorities honoured: [routing final plan](../research/model-routing-final-plan.md),
[ADR-004](../decisions/0004-controlled-adaptation.md),
[adaptive work loop](../specs/adaptive-agent-work-loop.md),
[status matrix](../status-matrix.md).

Inputs, in evidence order:

- Phase-1 opus measurement: [2026-08-23-algorithm-revalidate-measurement.md](2026-08-23-algorithm-revalidate-measurement.md)
  (`claude-opus-5-thinking-high-fast`, agent `eb1979af-f16e-4ed0-a3d4-00357ad246a7`, report
  landed at `012cc69`, measured `acf034d`/`af244ca`, own fix `8d98522`).
- Parent companion: [2026-08-23-algorithm-revalidate-measurement-parent.md](2026-08-23-algorithm-revalidate-measurement-parent.md)
  (`cursor-grok-4.6`, same tree, agrees on every overlapping number).
- Prior-cycle strategy: [2026-08-23-algorithm-strategy.md](2026-08-23-algorithm-strategy.md)
  (same slug as this file, earlier cycle at `69274ec`). This file **ratifies** its verdicts
  and its F-SIM stance, records that its Stage 1 has since shipped, and **refines** its
  successor queue against the fresh A1–A10 anomaly table rather than copying it.

---

## 1. What this phase verified itself

| Check | Result |
|---|---|
| Code delta since Phase-1 measurement | `git diff --name-only 8d98522 acb4c4e -- src test` empty; `012cc69` and `acb4c4e` are docs-only. Opus numbers transfer to HEAD without re-running. |
| `pnpm gate` at `acb4c4e` | exit 0, **1191 / 1190 / 0 / 1**, 27.1 s — identical to opus row 7 |
| A5 mechanism read from source | `parseObservedSignal` (`src/learning/signals.ts:103-110`) hardcodes `outcome: "FAILURE", verificationKind: "FAILED"` into `classifyTaskFailure`, and the fallback at `src/routing/failure-class.ts:57` returns `model` for any FAIL whose prose matches no hint. In this path `failure.category`, `httpStatus`, `transportCode`, `timedOut` are never passed, so `model` can **only** arise from that fallback — the caller's prose is the entire evidence base. |
| A5 blast radius read from source | `updateProjectBandit` lowers only on `failureClass === "model"` (`src/learning/bandit-store.ts:77`); avoid diagnostics require the same (`src/learning/diagnostics.ts:31`); `observationsForR1` drops FAIL-with-no-class (opus §3.1). A prose-only FAIL left unattributed therefore touches **no** posterior, **no** avoid list, **no** R1 observation. |
| Prior-cycle Stage 1 shipped | `ANSWER_SOURCES = ["user", "assume-defaults-auto"]` schema-enforced (`src/run/events.ts`), flag path labels `assume-defaults-auto` (`src/run/flowchart-run.ts:634`), human path labels `user` (`src/cli/main.ts:1226`). Status matrix records Stage 2 `--approve-high-risk` as **owner-gated, not shipped**. |

---

## 2. Verdicts

| Algorithm | Verdict | Why, grounded in the numbers |
|---|---|---|
| **Routing** (`analyzeTask` + R0 catalog filter + flowchart `routeFlowNode` + `ModelRouter`) | **keep** the selector; **deepen** its feature inputs (A2, A6, A4) | Live selection is measurably correct on every probed scenario — ordinary work 4/5 cheap at $0.90 versus $2.50 all-premium (36 %), deploy escalates all children to premium with a truthful two-row rejection matrix per task, both live paths agree on the gate 4/4, privacy and capability refusals fail closed naming the binding constraint — and every remaining defect (sibling escalation, generic-role family inheritance, complexity-floor disagreement) is a **feature-input** defect, exactly where the final plan's leverage order says to invest, not a selection-logic error that a new selector would fix. |
| **Cluster** (spawn depth, fan-out, deregister disposition, peer mail) | **keep** | Every boundary fails closed with a specific message (depth 2 refused, 5th spawn refused, leaf delegation refused, unknown role refused, planner→planner recursion refused, `liveTaskCount 8/8` refused), handoff genuinely re-queues undrained mail, and zero CLI runs under the fake executor fired a single spawn — so there is zero adverse evidence and zero production evidence, and changing static limits before any real spawn data exists would be tuning against nothing. |
| **Adaptation** (signals, `failureClass`, auto-loop, CAS promotion) | **keep** the architecture; **deepen** attribution by closing A5 (this cycle's single increment) | The provenance boundary survived every adversarial probe the policy names — forged `failureClass` and forged/human `taskSuccess` rejected, 429/transport/`TASK_TIMEOUT` classified non-model, runtime evidence outranks agent self-report, `runAutoAdaptLoop` returns `promoted: false` on every branch — with exactly one measured hole: a prose-only `extraSignals` FAIL defaults to `failureClass: model` and moved a real bandit arm from mean 1.00 to 0.50, which is ADR-004's posterior rule resting on a caller-authored string. |

**No measured number supports "replace" anywhere.** The prior cycle's verdict (keep all
three, invest in inputs per the leverage order eligibility → features / version isolation →
outcome attribution → experiment identifiability) is **ratified** on strictly stronger
evidence: the defects that motivated hesitation last cycle (unarmed gate, contradictory
approval records, family collapse to `test`, vision unroutable) are re-verified **fixed**
from real event logs on this tree, and the newly measured defects are again input defects,
not selector defects. Replacing R0 or the flowchart router would discard the only paths
with truthful attribution surfaces (`rejections`, one-hot `behaviorDistribution`,
`answeredBy`) in exchange for nothing any number here asks for.

---

## 3. Single next increment

**Name: `extraSignals` prose can exculpate, never inculpate — close anomaly A5 by making
the derived `failureClass` fail closed to "not attributable".**

**Implemented in this cycle** (see §7 for the evidence bar it must clear), because it is
the only anomaly whose fix direction is fully determined by locked policy rather than by a
product design choice, it is already evidenced end-to-end, and it touches zero live-routing
code.

The measured gap (opus §3.1, re-read from source this phase): the literal-field guard
(`extraSignals cannot forge failureClass`) holds, but `parseObservedSignal` then re-derives
a class from the caller's `summary` prose, and `classifyTaskFailure`'s fallback for an
unrecognised FAIL is `model`. Measured end to end: one prose-only FAIL
(`"it produced nonsense"`) moved a real bandit arm from mean 1.00 to 0.50; the same signal
with `"429"` in the prose did not. ADR-004 says only **attributable** `taskSuccess` with
`failureClass === "model"` may lower a posterior; a string the caller wrote is not
attribution, it is testimony.

The change, entirely inside `src/learning/signals.ts`:

- In the `parseObservedSignal` derivation (the `extraSignals` path only), keep running
  `classifyTaskFailure` over the prose so recognised *exculpatory* evidence still lands
  (`429`/rate-limit → `environment`, `tool error` → `tool`, `acceptance criteria` →
  `contract`), but when the classifier lands on its `model` fallback, record **no**
  `failureClass` — per the field's own contract, "Missing = not attributable".
- `classifyTaskFailure` itself is untouched: its 21 pinned cases, including the deliberate
  `model` default for a runtime-observed plain FAILED verification, stay byte-identical.
  The event path (`signalFromAgentMessage`, `from-episode.ts`) keeps that default because
  there the inputs are runtime evidence (`timedOut`, `failure.category`, protocol
  verification), not caller prose.

Downstream effect, verified against the consumers before writing this: a prose-only FAIL
becomes invisible to `updateProjectBandit` (lowers only on `model`), to avoid diagnostics
(same predicate), and to `observationsForR1` (drops FAIL-with-no-class). The opus probe's
posterior move 1.00 → 0.50 becomes impossible through this path.

Why this over the anomalies that sit earlier in the leverage order (A2, A6, A4):

- **A2 (sibling capability/risk escalation)** is the highest-severity open item, but its fix
  requires two design decisions this phase must not make unilaterally: a per-role capability
  matrix (which roles need `vision`?) changes live model selection and cost, and
  de-escalating sibling **risk** would shrink the deploy gate surface from 5/5 gated
  children to fewer — that is the same consent surface the owner is already deliberating
  under Stage 2, so it goes to the owner as a proposal, not into code.
- **A6 (implementer/debugger/worker inherit keyword families)** changes `analyzeTask`
  feature outputs, therefore forces an `assign-v5` bump and posterior re-keying; the right
  target family for the generic-edit roles (`edit` unconditionally? text with role
  override?) is the same design question as A2's matrix and should ship with it.
- **A4 (assign-v4 LOW vs flowchart-v4 MEDIUM floor for scout/tester)** is label-only on the
  shipped two-tier catalog, and the fix requires deciding which path is authoritative and a
  `flowchart-v5` bump; it is queued behind the A2/A6 proposal so the catalog owners bump
  versions once, not twice.
- **A5** has none of these blockers: no feature output changes (no version bump), no live
  model selection changes, no owner-gated semantics touched, and the fail-closed direction
  is the only one consistent with ADR-004.

Successor queue after this increment (named, not part of it, in leverage order):
(a) an **A2 + A6 feature-quality proposal** for the owner — per-role capability derivation
and role-first families for the generic edit roles, shipped together as `assign-v5`, with
the explicit call-out that any sibling *risk* de-escalation shrinks the high-risk gate
surface and needs the same sign-off as Stage 2; (b) **A4** — carry the assign-time
complexity through flowchart compile so both live paths record one number, as
`flowchart-v5`; (c) **A3** — a run-summary line naming how many high-risk gates armed and
were auto-cleared (no semantics change; safe interim while Stage 2 is owner-gated);
(d) **A7** — replace the 10-file textual live-isolation allowlist with a transitive
import-graph assertion from `src/cli/main.ts`; (e) **A8** — structured constraint codes on
`RoutingRefusalError` with the user-facing strings kept byte-identical.

---

## 4. What must not be done

- **No new live selector, and no R1 / bandit / topology wired into live.** F-PROD is open;
  the status matrix and final plan forbid it; the transitive-closure check (opus §3.4, 154
  live modules, zero adaptive call sites) is the invariant to preserve, and A7 notes its
  test guard is weaker than the invariant — a reason for more caution, not less.
- **No more simulation aimed at Decision 1.** F-SIM's paired utility delta is identically
  zero by construction — measured invariant across all-PASS, all-FAIL, and n = 400 while
  selection disagreement sat at 100 % — so the 95 % lower bound Decision 1 requires can
  never come from this harness. Any plan whose evidence step is "run more simulation" is
  dead on arrival (A1).
- **No treating simulation as Checkpoint F-PROD and no Outcome-supported claims.**
  `evidenceClass: "simulation"` and `canCloseProductionCheckpointF: false` are hard-coded
  and must stay hard-coded. Every number in this evaluation is fake-executor evidence.
- **No silent reversal of `--assume-defaults` unattended-deploy semantics.** Stage 2
  (`--approve-high-risk`) was owner-gated last cycle and **remains not shipped**. Making
  high-risk gates refuse blanket defaults is the right end state (§6) but it is the owner's
  call; until then, auto-cleared gates are honest in the event log (`assume-defaults-auto`)
  and must be read as flag-sourced, never as human consent, in any audit or learning signal.
- **No tracking or human scores into bandit / avoid / R1.** Only attributable `taskSuccess`
  with `failureClass === "model"` may lower a posterior — this cycle's increment makes that
  rule hold even against caller prose; do not weaken it back.
- **No changing the load-bearing refusal strings** — `"No allowed model is approved for
  high-risk tasks"` and `"No allowed model fits the remaining cost and time limits"` —
  `flowchart-supervisor.ts:688` regex-matches the latter to fail one node instead of the
  whole run, and regression tests pin both (A8's structured-code successor keeps the
  wordings byte-identical).
- **No inventing catalog capabilities to make objectives routable**, and no LLM classifier
  for `analyzeTask` without the sealed comparison the final plan requires.
- **No self-review-proves-PASS and no auto-promotion.** `runAutoAdaptLoop` returns
  `promoted: false` on every branch; promotion stays proposal-first CAS behind
  `adapt promote --approve`.
- **No de-escalating sibling risk as a side effect of fixing A2's cost problem** without
  naming it to the owner: fewer `highRisk` children means fewer armed gates on deploy runs.

---

## 5. F-SIM: stay identically-observed; no counterfactual ADR now

**Recommendation: keep F-SIM identically-observed, with selection disagreement and cost
delta as its first-class honest metrics. Do not start a counterfactual outcome model.**
This ratifies the prior cycle's stance on strictly stronger evidence: opus drove the
harness with adversarial datasets (all-PASS, all-FAIL, n = 400) and the utility delta,
its SE, and its CI stayed exactly [0, 0] while selection disagreement stayed 100 % —
the zero is structural, and `8d98522` now forwards `observedUtilityOnBothArms`,
`selectionDisagreementCount`, and `selectionDisagreementRate` out of `runSimulationHoldout`
so no caller can mistake the structural zero for a measured tie again.

The zero is a feature: the harness refuses to invent an outcome for a model that was never
invoked, the same honesty rule the rest of the system enforces. What it can measure it
measures well — selection divergence, cost delta (+0.0448 USD with a positive CI lower
bound, which independently blocks any "cheaper" claim), contamination refusal, holdout-vault
audit, claim suppression.

If the owner ever wants a nonzero simulated delta, that is a **counterfactual outcome
model** and it requires its own ADR before any code: validation against data disjoint from
both train and holdout, a counterfactual-model version stamped on every report it touches,
and the explicit statement that even a perfect one closes only F-SIM — by decision 2 it can
never close production Checkpoint F. Nothing measured this cycle justifies starting that
work, and it would compete directly with the only evidence that can move Decision 1: real
paired production outcomes.

---

## 6. High-risk gate and `--assume-defaults`

**Keep the gate armed exactly as it is.** It is load-bearing, not cosmetic, and this cycle
proved it on the executed path: R2c (`--answers` for clarification, **no**
`--assume-defaults`) completed routing for five tasks, armed the first flowchart-v4 gate,
and halted `WAITING_FOR_USER` with **zero** `CHILD_RUN_CREATED` events. Both live paths
agree (assign-v4 4/4 and flowchart-v4 4/4 `WAITING_FOR_USER`); the prior cycle's
contradictory-records defect is closed and stays closed.

**`--assume-defaults` stance, in three parts:**

1. **Stage 1 (shipped, keep):** every flag-cleared gate is labelled
   `answeredBy: "assume-defaults-auto"`, the schema rejects any other machine value, and a
   human answer writes `answeredBy: "user"`. Machine consent can no longer masquerade as a
   person in the event log. This closed the prior strategy's stage-1 requirement.
2. **Stage 2 (right end state, still owner-gated, not shipped, not reversed here):**
   blanket defaults should answer clarification questions but stop satisfying a ROUTE gate
   whose decision is `highRisk: true`; such a run should halt `WAITING_FOR_USER` (exactly
   the R2c behaviour) unless an explicit `--approve-high-risk` or per-task answers entry
   grants it, and high-risk model items should carry `defaultSelected: false` so no default
   sweep can select them. **This file does not ship or reverse any of that** — changing
   unattended-deploy semantics is the owner's product decision, recorded as such in the
   status matrix, and silently flipping it either way is forbidden (§4).
3. **The interim honesty gap is the operator surface, not the log (A3):** R2's stdout
   printed `COMPLETED` with no mention that four high-risk gates armed and were
   auto-cleared, and `makeApprovalPlan` marks `Use <model>` as `defaultSelected: true`, so
   `--assume-defaults` always resolves toward *proceed*. The named successor increment (§3,
   item c) is a summary line — "N high-risk approval gates were auto-cleared by
   --assume-defaults" — which changes no semantics, needs no owner decision, and makes the
   interim state visible to the operator who is about to rely on it.

---

## 7. Success criteria / tests / gates for the increment

Scope guard: the change is confined to the `extraSignals` derivation in
`src/learning/signals.ts`. `analyzeTask` and all sensors are untouched, so
`ASSIGN_FEATURE_VERSION` stays `assign-v4` and `FLOWCHART_FEATURE_VERSION` stays
`flowchart-v4` (`src/routing/feature-version.ts` must show no diff). No file under
`src/routing/` (including `failure-class.ts`) or `src/supervisor/` changes; both
load-bearing refusal strings are untouched by construction.

The increment is done when all of the following hold:

- **Unit — prose cannot inculpate:** `parseObservedSignal` on a `taskSuccess` FAIL whose
  summary matches no evidence hint (e.g. `"it produced nonsense"`) yields a signal with
  **no** `failureClass`; the same input with `"429"` prose still derives `environment`
  (exculpation preserved); the literal-field forge still throws
  `extraSignals cannot forge failureClass`; PASS signals are unchanged.
- **Unit — posterior immunity, the exact opus probe inverted:** feeding the parsed
  prose-only FAIL to `updateProjectBandit` after one honest PASS leaves the arm at
  `pulls = 1`, `rewardSum = 1`, mean 1.00 — not the measured 0.50 — while a
  deterministic event-path FAIL with `failureClass: "model"` still lowers it (the
  legitimate path must keep working).
- **Untouched behaviour pinned:** `test/unit/routing/failure-class.test.ts` (21 cases,
  including the runtime-evidence `model` default and all three self-report-outranked cases)
  passes with **zero diff** to `src/routing/failure-class.ts`; the event-path test
  asserting a plain verified FAIL derives `model` in `collectSignalsFromEvents` stays green
  unmodified.
- **Gates:** `pnpm gate` green at ≥ the `8d98522` baseline (1191 tests / 1190 pass / 0
  fail / 1 skip) plus the new tests; `pnpm typecheck`; `pnpm lint`.
- **Claims discipline:** all evidence remains fake-executor and is recorded as such; this
  increment produces **no** Outcome-supported claim, touches **no** F checkpoint, and does
  not change what any live run routes, prints, or refuses.

**Shipped and verified in this cycle** as `bb54866`
(`fix(learning): extraSignals prose can exculpate but never inculpate the model`):

- Every criterion above holds. `git diff --name-only` for the commit is exactly
  `src/learning/signals.ts` plus three test files under `test/unit/learning/` — zero diff
  in `src/routing/` (including `failure-class.ts` and `feature-version.ts`) and
  `src/supervisor/`, so refusal strings and both feature versions are untouched by
  construction, not by review.
- The two auto-loop threshold tests that previously injected prose-only FAILs through
  `extraSignals` — which was itself an instance of the A5 hole — now inject through the
  events path, where `FAILED` runtime verification legitimately derives `model`. Their
  thresholds (n = 2 diagnostic-only, n = 5 proposes without promoting) are unchanged.
- Three new tests pin the invariant at each level: `parseObservedSignal` (prose-only FAIL
  → no `failureClass`; 429/tool/contract prose still exculpates; forge still throws),
  `updateProjectBandit` (the opus probe inverted: arm stays `pulls = 1`, mean 1.00), and
  `runAutoAdaptLoop` (five prose-only extraSignals FAILs propose nothing).
- Gates after the change: `pnpm gate` exit 0 — **1194 tests / 1193 pass / 0 fail / 1
  skip** (+3 over the `8d98522` baseline, all three the new pins); `pnpm typecheck` and
  `pnpm lint` clean.

---

## 8. 中文总结

Phase 2（模型 slug `claude-fable-5-thinking-xhigh`，测量树 `acb4c4e`，live 代码
`8d98522`，本阶段自测 `pnpm gate` 1191/1190/0/1 与 Phase-1 完全一致）结论：路由、集群、
自适应三者全部 **keep**，没有任何实测数字支持 replace。路由选择器保留——普通任务 $0.90
（全 premium 的 36 %）、部署任务全 premium 且拒绝矩阵真实、两条 live 路径对高风险门
4/4 一致、隐私/能力拒绝 fail-closed——剩余缺陷（A2 连坐升级、A6 通用角色家族继承、A4
complexity 分歧）全是特征输入问题，按最终计划的杠杆顺序应投资输入而非换选择器。集群
每个边界 fail-closed 且无任何不利证据。自适应架构保留，本周期唯一命名增量为 **A5
fail-closed**：`extraSignals` 的散文只能开脱（429→environment 等），永不能入罪——
`classifyTaskFailure` 的 `model` 兜底在该路径映射为"不可归因"，使实测的 bandit 后验
1.00→0.50 不再可能；不改 `analyzeTask` 与任何 sensor，故无需升 feature version。A2/A6
（连带 sibling 风险降级会缩小部署门面）与 A4（需 flowchart-v5）作为 proposal 排队给
owner。F-SIM 维持双臂同观测标签：utility delta 恒为 [0, 0] 是结构性诚实，选择分歧率与
成本差是一等仿真指标；不建反事实结果模型，若建必须先立 ADR 且永远关不了 F-PROD。高风险
门保持武装；Stage 1 来源标注已合入并保留，Stage 2 `--approve-high-risk` 仍属 owner
决策，本文不推翻也不实施；A3 的摘要行是无语义变化的安全过渡。全部证据均为 fake
executor，**不构成 Outcome-supported 声称，不能关闭 Checkpoint F-PROD**。

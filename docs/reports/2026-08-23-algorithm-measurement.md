# Phase-1 algorithm measurement — 2026-08-23

**Model slug:** `claude-opus-5-thinking-high-fast`
**Phase:** 1 of 2 (measurement only; no selector invented, no R1 wired live)
**Tree measured:** `cursor/algorithm-capability-upgrade-9035` @ `e06eee6`
**Work branch:** `cursor/algorithm-eval-measure-9035` (branched at `6647dab`, which is
`e06eee6` plus the parent coordinator's own Phase-1 notes)
**Executor:** deterministic fake only. No real provider, no production episode, no
sealed holdout, no legal OPE.

This report is **not** an Outcome-supported claim and **cannot** close Checkpoint
F-PROD. Authorities honoured: [routing final plan](../research/model-routing-final-plan.md),
[ADR-004](../decisions/0004-controlled-adaptation.md),
[adaptive work loop](../specs/adaptive-agent-work-loop.md),
[status matrix](../status-matrix.md).

A companion file, [`2026-08-23-algorithm-measurement-parent.md`](2026-08-23-algorithm-measurement-parent.md),
records the parent coordinator's independent pass over the same tree. Where the two
overlap they agree; this report adds the vision/reasoning refusals, the approval-gate
asymmetry, the transitive isolation graph, and the F-SIM utility-delta proof.

---

## 1. Command table

All commands run from the repo root on Node 22.19.0 / pnpm 10.17.1. Durations are
wall clock for the whole command including `tsx` startup.

| # | Command | Exit | tests | pass | fail | skip | Duration |
|---|---|---|---|---|---|---|---|
| 1 | `pnpm exec tsx --test test/integration/m6/simulation-holdout.test.ts` | 0 | 11 | 11 | 0 | 0 | 0.44 s |
| 2 | `pnpm exec tsx --test test/unit/routing/r1-shadow-report.test.ts test/unit/routing/shadow.test.ts test/unit/experiments/shadow-compare.test.ts` | 0 | 20 | 20 | 0 | 0 | 0.45 s |
| 3 | `pnpm exec tsx --test test/acceptance/adaptive-loop.test.ts` | 0 | 2 | 2 | 0 | 0 | 0.42 s |
| 4 | `pnpm exec tsx --test test/integration/cluster/` | **1** | 1 | 0 | 1 | 0 | 0.38 s |
| 4b | `pnpm exec tsx --test test/integration/cluster/dynamic-spawn.test.ts test/integration/cluster/peer-mailbox.test.ts` | 0 | 4 | 4 | 0 | 0 | 0.68 s |
| 5 | `pnpm exec tsx --test test/unit/routing/analyze-task.test.ts test/unit/routing/assign.test.ts test/unit/supervisor/flowchart-router.test.ts test/unit/learning/signals.test.ts test/unit/learning/auto-loop.test.ts` | 0 | 40 | 40 | 0 | 0 | 0.67 s |
| 6 | `pnpm test` (whole suite, before my change) | 0 | 1181 | 1180 | 0 | 1 | 17.2 s |
| 7 | `pnpm typecheck` | 0 | — | — | — | — | 3.4 s |
| 8 | `pnpm lint` | 0 | — | — | — | — | 3.5 s |
| 9 | `pnpm build` | 0 | — | — | — | — | 3.0 s |
| 10 | `pnpm gate` (after my change) | 0 | **1183** | **1182** | 0 | 1 | 26.9 s |

**Row 4 is not an algorithm failure.** Passing a directory to `tsx --test` raises
`ERR_UNSUPPORTED_DIR_IMPORT` from the Node ESM resolver before any test loads. Run the
two cluster files explicitly (row 4b) and all four pass. This reproduces the parent
coordinator's finding.

The single skipped test in rows 6 and 10 is
`PiAgentExecutor completes a run against a real provider # SKIP set PI_SMOKE=1 …`,
i.e. the opt-in real-provider smoke. Expected in this environment.

Row 10 is +2 tests over row 6: the two regression tests I added with the fix in §5.

---

## 2. Real local CLI runs (fake executor)

Temp project `/tmp/measure/proj` (a `package.json`, a `README.md`, and one
`src/billing.ts`), isolated state root. Live routing is on the `--track` path;
a plain `run` emits no `MODEL_ROUTED` at all, so `--track --assume-defaults` is the
scenario that actually exercises the algorithms.

| Scenario | Objective | Exit | runId | Routed models | Flags | Duration |
|---|---|---|---|---|---|---|
| Ordinary edit | "Refactor the billing helper and add a unit test" | 0 | `run_963227a9-…` | planner→**premium**; scout/implementer/reviewer/tester→**cheap** | `highRisk=false`, families `plan`/`research`/`test`, `assign-v3` then `flowchart-v2`, 0 rejections, 41 events | 0.78 s |
| High risk | "Deploy payment credentials to production" | 0 | `run_c00bfb96-…` | **all four roles → premium** | `highRisk=true`, family `deploy`, `cheap` rejected on `complexity` **and** `high-risk-approval`, 35 events | 0.75 s |
| Local only | "Refactor billing; this must stay local" | 1 | none written | — | refused, `privacyRequired=local`, both models rejected `privacy-class` | 0.71 s |
| Vision | "Look at this screenshot and fix the padding" | 1 | none written | — | refused, `requiredCapabilities=[tool-use, vision]`, both models rejected `capability` | 0.69 s |

`pnpm cli inspect --run <id> --json` succeeded for both completed runs. No cascade
retries and no cluster spawn or deregister occurred in any run: the fake executor never
issues a spawn request, so `createClusterHost` is constructed but its `onSpawn` never
fires. Cluster behaviour is therefore Exercised by tests only, not by these CLI runs.

### The algorithm does change what runs

Routing is not decorative. Ordinary work puts four of five children on `cheap`; the
deploy objective moves every child to `premium` and records why `cheap` was excluded.
Both refusals were correct policy outcomes, not crashes.

### Recorded rejection matrix (high-risk run, verbatim from `events.jsonl`)

```json
{"model": "premium", "family": "deploy", "featureVersion": "assign-v3",
 "modelVersion": "premium-v1", "highRisk": true, "eligibleModels": ["premium"],
 "rejections": [
   {"modelId": "cheap", "constraint": "complexity", "detail": "maxComplexity MEDIUM < HIGH"},
   {"modelId": "cheap", "constraint": "high-risk-approval", "detail": "model is not approved for high-risk tasks"}],
 "behaviorDistribution": {"premium": 1}, "statusAfterRoute": "WAITING_FOR_USER",
 "policyVersion": "router-v1-primary", "agentRole": "planner"}
```

`behaviorDistribution` is a genuine one-hot over the eligible set, as F2 requires. No
fabricated positive propensity anywhere in the 18 `MODEL_ROUTED` events I collected.

---

## 3. Simulation / shadow (F-SIM)

`test/integration/m6/simulation-holdout.test.ts` passes 11/11. I then ran
`src/experiments/simulation-holdout.ts` directly on a 68-episode train split and a
30-episode holdout split.

| Measurement | Value |
|---|---|
| Train episodes | 68 |
| Holdout pairs | 30 |
| Pairs where R0 and R1 chose differently | **30 / 30 (100 %)** |
| Any pair invoked | `false` |
| `evidenceClass` | `simulation` |
| `canCloseProductionCheckpointF` | `false` |
| `utilityDelta` | mean **0**, standard error **0**, 95 % CI **[0, 0]**, `provisional: false` |
| `costDelta` | mean **+0.0448 USD**, 95 % CI **[0.0448, 0.0448]** |
| `claims` | `["仿真证据"]` |

### What the simulation can claim

Contamination resistance is real and demonstrated: the harness refuses an implicit
split, rejects a holdout hash that also appears in train, and the test at line 275
shows holdout labels that *would* reverse the posterior do not reach R1. Selection
divergence, cost delta, holdout-vault audit, and claim suppression are all genuinely
measured. `evidenceClass` and `canCloseProductionCheckpointF` are hard-coded constants
on the protocol object, so the harness structurally cannot be used to close F-PROD.

### What the simulation cannot claim — and never will

The zero utility delta is not a property of my dataset. It is a property of the code:

```115:123:src/routing/r1-shadow-report.ts
    const utility = episode.taskSuccess === "PASS" ? 1 : 0;
    records.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: selectedCost(r0, r0.selection),
      candidateCostUsd: selectedCost(r0, r1.selection),
    });
```

`baselineUtility` and `candidateUtility` are assigned the *same* per-episode observed
label. There is no counterfactual outcome model, so the paired utility delta is
identically zero for every possible input. That is honest — the harness refuses to
invent an outcome for a model that was never invoked — but the consequence is decisive:

> **F-SIM cannot support or refute any quality claim, at any sample size.** Decision 1
> of the routing final plan requires a utility-delta 95 % lower bound strictly above
> zero. This harness produces a lower bound of exactly zero, always. Its cost CI upper
> bound is also positive (+0.0448), which independently blocks a "better" claim.

Running more simulation episodes cannot move the main gate. Only real paired production
outcomes can.

---

## 4. Desirability scores

Scored from files plus test and CLI evidence. Not vibe, not intent.

| Algorithm | Live decision quality | Attribution trustworthiness | Policy alignment (ADR-004, no live R1) | Usability (fail closed vs brick) |
|---|---|---|---|---|
| **Routing (analyzeTask + R0 catalog filter)** | **desirable** | **desirable** | **desirable** | **mixed** |
| **Cluster (spawn depth, fan-out, peer mail)** | **mixed** | **desirable** | **desirable** | **desirable** |
| **Adaptation (signals, failureClass, auto-loop)** | **mixed** | **desirable** | **desirable** | **desirable** |

### Routing

*Live decision quality — desirable.* `routeFlowNode` calls `analyzeTask` and forwards
`highRisk`, `family`, `requiredCapabilities` and `privacyRequired` into the hard filter
(`src/supervisor/model-router.ts:364-388`). Measured effect: the deploy objective moved
all four children from `cheap` to `premium`; the ordinary objective left four of five on
`cheap`. Filtering happens through one shared matrix, `evaluateLiveCandidate`
(`src/routing/policy.ts:138`), used by both the flowchart path and `assignOne`.

*Attribution — desirable.* Every `MODEL_ROUTED` event I collected carried `family`,
`featureVersion`, `modelVersion`, `highRisk`, `eligibleModels`, `rejections` and a
one-hot `behaviorDistribution`. No `unknown` fallbacks appeared.

*Policy alignment — desirable.* See §6 for the transitive import graph: no adaptive
selector influences a live choice.

*Usability — mixed.* It fails closed, which is right, but before my fix it failed closed
*while naming the wrong constraint*, and two ordinary-sounding objectives are
unroutable against the default catalog. See §5 and anomaly A2.

### Cluster

*Live decision quality — mixed.* The limits are real and fail closed, verified directly:

```
MAX_SPAWN_DEPTH=2  MAX_SPAWNS_PER_PARENT=4
planner     -> worker, debugger, scout, implementer, reviewer, tester
worker      -> scout, reviewer, tester
debugger    -> scout, tester
scout / implementer / reviewer / tester -> (none: leaf roles)

depth 1                    ALLOWED      depth 2                REFUSED
spawnsByParent 3           ALLOWED      spawnsByParent 4       REFUSED
liveTaskCount == maxTasks  REFUSED      parentCanDelegate=false REFUSED
empty objective            REFUSED      unknown child role     REFUSED
```

Scored mixed only because the limits are static constants with no project calibration,
and because none of my four CLI runs triggered a single spawn — the fake executor never
requests one. The four cluster integration tests do exercise it, including the retry
inheriting undrained peer mail.

*Attribution and policy — desirable.* Deregistration is dispositioned (`handoff` vs
`complete`, `src/run/child-coordinator.ts:356,447`) rather than a bare removal.

### Adaptation

*Live decision quality — mixed.* The loop reaches a real conclusion ("no actionable
model-project issue" on both completed runs) and `--track` does load a promoted policy
via `loadLearnedRouting` (`src/track/loop.ts:88`), so a promoted candidate genuinely
changes later routing. Mixed because on these runs nothing was proposed, so the
decision-changing path was not exercised end to end.

*Attribution — desirable, and I verified it adversarially rather than trusting the
tests.* Direct probes against the live functions:

```
extraSignal[forge failureClass=model]      REJECTED: extraSignals cannot forge failureClass
extraSignal[forge taskSuccess from user]   REJECTED: extraSignals cannot forge criterion taskSuccess
parseOutcomeObservation taskSuccess/human  REJECTED: taskSuccess requires source deterministic-check

classifyTaskFailure:
  http 429                              -> environment
  http 503                              -> environment
  ECONNRESET                            -> environment
  timedOut (TASK_TIMEOUT)               -> run
  protocolViolation                     -> run
  agent claims MODEL_ERROR but http 429 -> environment   <- runtime evidence outranks self-report
  agent claims MODEL_ERROR, no transport-> model
  acceptance omission text              -> contract

observationsForR1: 7 rows in, 2 kept (taskSuccess/PASS, taskSuccess/FAIL+failureClass=model)
```

The provenance binding holds: 429, transport errors and timeouts stay out of the
posterior, and an agent-authored `MODEL_ERROR` cannot override runtime-observed
transport evidence.

*Policy alignment — desirable.* `runAutoAdaptLoop` returns `promoted: false` on every
branch and the doc comment states `autoPromote` is ignored
(`src/learning/auto-loop.ts:71,99,206,211`). Promotion stays behind
`adapt promote --approve`, matching ADR-004's proposal-first default.

---

## 5. Blocking usability bug found and fixed

**Symptom.** Both refusing CLI scenarios reported the wrong cause:

```
error: No allowed model satisfies role actor and complexity MEDIUM
```

for a *privacy* refusal, and the identical text for a *capability* refusal.

**Cause.** The rejection matrix always held the truth, but only `message` reaches the
caller, and every constraint except high-risk and budget/deadline fell through to one
generic role/complexity string.

**Fix** (`src/supervisor/model-router.ts`, commit `8a36554`): a `refusalMessage` helper
names the constraints that actually bound the refusal. After the fix:

```
error: No allowed model satisfies privacy class (cheap: cloud-general cannot serve local; premium: cloud-general cannot serve local)
error: No allowed model satisfies required capability (cheap: capability not declared: vision; premium: capability not declared: vision)
```

**Deliberately preserved.** The high-risk and cost/time wordings are unchanged, because
`src/supervisor/flowchart-supervisor.ts:688` matches `/fits the remaining cost and time
limits/i` on the message to fail a single node instead of the whole run. Two regression
tests in `test/unit/supervisor/flowchart-router.test.ts` now pin both the new
constraint-naming behaviour and those two load-bearing strings. This changes no routing
decision — only what the operator is told when routing refuses.

---

## 6. Isolation verified transitively, not textually

`test/unit/routing/live-isolation.test.ts` greps a hardcoded 10-file allowlist for
import strings. I built the actual transitive module graph from the real entrypoint
`src/cli/main.ts`:

| Module | Reachable from CLI entrypoint |
|---|---|
| `src/routing/r1.ts` | **no** |
| `src/routing/shadow.ts` | **no** |
| `src/routing/r1-shadow-report.ts` | **no** |
| `src/experiments/simulation-holdout.ts` | **no** |
| `src/routing/propensity.ts` | **no** |
| `src/routing/bandit.ts` | **yes** — `cli/adapt.ts → learning/auto-loop.ts → learning/bandit-store.ts → routing/bandit.ts` |
| `src/routing/topology.ts` | **yes** — `run/supervisor.ts → routing/topology.ts` |

The live graph is **154 modules**; the allowlist covers 10.

Both reachable cases are defensible. `bandit` sits behind `adapt`, which is the
adaptation plane and never CAS-promotes. `topology` is imported but not called — the
isolation test pins `planTaskTopology` to exactly one textual occurrence. **No adaptive
module influences a live model selection**, which is the invariant that matters.

But the *test* does not prove that invariant. It proves that ten named files lack five
import substrings. It would not catch a new live file, a transitive import, or a
re-export. The guarantee is currently stronger than its guard.

---

## 7. Anomalies

| # | Severity | Finding |
|---|---|---|
| A1 | **fixed** | Privacy and capability refusals were reported as role/complexity mismatches. Fixed in `8a36554` with tests. |
| A2 | **high** | Ordinary-sounding objectives are unroutable against the default catalog. `"Look at this screenshot and fix the padding"` requires `vision`; `"Prove the invariants of the ledger reconciliation"` requires `reasoning`. **Neither `cheap` nor `premium` declares either capability**, so both refuse. `analyzeTask` demands capabilities that the catalog can never supply. Left unfixed on purpose: declaring `vision` on a `providerId: "fake"` model would be inventing a capability, and widening the keyword regexes is a policy call for Phase 2. |
| A3 | **high** | **The high-risk human gate never arms on the executed path.** `assignOne` sets `approvalRequired: analysis.highRisk` (`src/routing/assign.ts:94`), and the deploy run's `assign-v3` events duly record `statusAfterRoute: WAITING_FOR_USER`. But `compileChildrenToFlowchart` hardcodes `approvalRequired: false` (`src/graph/compile-children.ts:139`), and `routeFlowNode` forwards only `node.approvalRequired` (`model-router.ts:377`) — it never derives approval from `analysis.highRisk`. So the same run's `flowchart-v2` events say `RUNNING`, and the deploy objective executed all four children to `COMPLETED` with **no human gate**. The gate machinery works (`flowchart-supervisor.ts:743-766` honours `WAITING_FOR_USER`); it is simply never armed. Model escalation to `premium` is live; approval escalation is not. |
| A4 | medium | Same run, two contradictory approval records: `assign-v3` events say `WAITING_FOR_USER`, `flowchart-v2` events for the same work say `RUNNING`. Anything reconstructing gate history from the event log gets an ambiguous answer. |
| A5 | medium | `familyOf` tests `TEST_RE` before `REVIEW_RE` and `REFACTOR_RE` (`src/routing/analyze-task.ts:106-115`), and `TEST_RE` matches `verify\|validation\|qa\|coverage`. Measured: 8 of 10 `MODEL_ROUTED` events in the ordinary run carried `family: "test"`, including the **reviewer** node. `family` is the data-isolation key for R1 posteriors and avoid candidates, so this systematically mislabels review and refactor work as `test`. |
| A6 | medium | `flowchart-supervisor.ts:688` branches on a **regex over an error message** to decide whether to fail one node or the whole run. Behaviour-critical control flow coupled to prose. My fix preserves the string and pins it with a test, but the coupling remains. |
| A7 | low | `test/integration/cluster/` cannot be passed as a directory to `tsx --test`. Any CI invocation using the directory form reports a false failure. |
| A8 | low | The live-isolation guard is a 10-file textual allowlist against a 154-module live graph (§6). |
| A9 | low | A plain `pnpm cli run` emits no `MODEL_ROUTED`. Live routing only exists on `--track`, `--flowchart` and `--children`. |

---

## 8. What Phase 2 must not ignore

1. **F-SIM is informationally empty on the main gate.** `baselineUtility === candidateUtility` by construction (§3), so the paired utility delta is identically zero for every possible dataset. No amount of simulation moves decision 1. Any Phase-2 plan whose evidence step is "run more simulation" is dead on arrival. If Phase 2 wants a utility signal, the only options are real paired production outcomes or an explicit, separately validated counterfactual outcome model — and the latter would need its own ADR.

2. **A3 is the largest live policy gap.** High-risk work escalates the model but not the human. Arming the gate is a one-line-ish change in `compile-children.ts` / `routeFlowNode`, but it is a behaviour change that would make every deploy-flavoured `--track` run block on a human. That is a product decision with a real usability cost, and it interacts with A5: if `analyzeTask` over-fires, arming the gate blocks ordinary work. **Fix A5 before arming A3.**

3. **A2 and A5 are both `analyzeTask` precision problems, and they point opposite ways.** A2 says the classifier demands capabilities the catalog cannot supply (too strict). A5 says it assigns the wrong family (too coarse). Any Phase-2 change to `analyzeTask` must bump `ASSIGN_FEATURE_VERSION` / `FLOWCHART_FEATURE_VERSION` — F4 makes that a data-isolation contract, and posteriors keyed on `assign-v3` must not be reused across the bump.

4. **Attribution is genuinely trustworthy — do not spend Phase 2 rebuilding it.** The provenance boundary survived adversarial probing (§4). Forged `failureClass`, forged `taskSuccess`, and human-sourced `taskSuccess` are all rejected, and runtime transport evidence outranks agent self-report. This is the healthiest part of the system. The leverage is elsewhere.

5. **The isolation invariant holds but its guard does not prove it** (§6). If Phase 2 touches the live plane, strengthen the guard to a transitive graph assertion before relying on the existing test.

6. **Routing already changes live behaviour**, so "does the algorithm do anything?" is answered: yes, measurably (§2). The open question is not whether to add a smarter selector but whether the *inputs* (`analyzeTask` features, catalog capability declarations) are accurate enough to deserve one. On this evidence they are not yet, which is consistent with the final plan's leverage order — eligibility matrix and features before R1.

7. **Everything here is fake-executor evidence.** Zero real provider calls, zero production episodes, zero legal OPE, and no cluster spawn actually fired in a CLI run. Nothing in this report may be promoted to Outcome-supported.

---

## 9. 中文总结

本次 Phase 1 只做测量，未新建选择器，也未把 R1 接入 live。在 `e06eee6` 上，全量
`pnpm gate` 通过（1183 项测试，1182 通过、0 失败、1 跳过为需 `PI_SMOKE=1` 的真实
provider 冒烟），`test/integration/cluster/` 唯一的"失败"是把目录传给 `tsx --test`
导致的 `ERR_UNSUPPORTED_DIR_IMPORT`，按文件运行则 4/4 全过。真实 CLI（fake executor）
证实 live 路由确实改变执行结果：普通改动五个子任务中四个走 `cheap`，而"部署生产支付
凭据"把四个子任务全部升到 `premium` 并完整记录 `cheap` 的拒绝矩阵；"必须留在本地"与
"看这张截图"两条则正确 fail-closed 拒绝。归因边界经对抗性探测确认可信：伪造
`failureClass`、伪造 `taskSuccess`、以及 429/传输错误/超时都进不了后验，运行时证据
优先于 agent 自报。政策合规同样成立——从 CLI 入口做传递闭包检查，R1、shadow、
simulation-holdout、propensity 均不可达，auto-loop 恒返回 `promoted: false`。

但有三项 Phase 2 不可忽视的发现。第一，**F-SIM 在主门上是空的**：
`r1-shadow-report.ts` 把 `baselineUtility` 与 `candidateUtility` 赋成同一个观测标签，
因此配对 utility delta 对任何数据集都恒等于 0（实测 30/30 对选择全部分歧，utility
CI 仍为 [0, 0]，cost CI 为 +0.0448），决策 1 要求的 LCB > 0 在结构上永远达不到，
再多仿真也无用。第二，**高风险的人工审批门从未在真正执行的路径上武装**：
`compileChildrenToFlowchart` 把 `approvalRequired` 硬编码为 `false`，`routeFlowNode`
也不从 `analysis.highRisk` 推导审批，导致部署任务虽然模型升级到 `premium`，却在无人
工确认下跑完全部四个子任务，同一次 run 的 `assign-v3` 与 `flowchart-v2` 事件还给出
互相矛盾的审批状态。第三，`analyzeTask` 精度同时偏严与偏粗：`vision` / `reasoning`
关键词要求的能力目录中无任何模型声明，普通任务因此被拒；而 `TEST_RE` 先于
`REVIEW_RE`/`REFACTOR_RE` 匹配，使 8/10 条路由事件的 `family` 被标成 `test`（连
reviewer 节点也是），污染了 R1 后验的隔离键。我只修了一个阻塞可用性的诊断缺陷：
隐私与能力拒绝此前一律被报成 role/complexity 不匹配，现已改为指名真正生效的约束，
并保留 supervisor 依赖的两条固定措辞且加了回归测试。以上全部为 fake executor 证据，
不构成 Outcome-supported 声称，也不能关闭 Checkpoint F-PROD。

# 模型路由：问题整合、已有能力与目标

**日期：** 2026-08-19  
**状态：** 对外评审简报（不是实施计划，不声称 Outcome-supported）  
**读者：** 未跟过本仓库日常开发、需要拍板或质疑路由方向的人  
**范围：** 任务如何选模型。不含 prompt 搜索、Pi extension、BKT 用户模型。

请先读第 1–3 节。第 4 节是证据。第 5 节是希望外人明确表态的问题。

---

## 1. 一句话现状

Live 选模是**静态 R0 等价物**：用 `--primary-model` / `--fast-model` 建两档目录，按角色、复杂度、风险白名单和预算挑最便宜的合格模型。已晋升的 `routing-policy` 现在会进入下一次 assign。自适应 R1、bandit、拓扑、公开榜单先验在库里或提案里，**仍不决定下一次真实调用**。

这是刻意的安全默认（ADR-004：执行面不能改自己的策略；Checkpoint F 未关之前不准声称「自适应更好」）。代价是：产品上还没有「越跑越会挑模型」这条能力。

```text
目标 live 路径（三线终稿，Accepted；R1 库已按此实现，尚未接到生产）

  任务分析 → R0 硬过滤 →（样本够）单层 R1 → 过线最便宜
                              ↓ 稀疏或不过线
                         批准的 R0 基线（不是最高噪声 LCB）

当前 live 路径

  任务分析（正则+角色）→ ModelRouter 最便宜合格（含高风险白名单）→ 执行
       ↑
  已晋升的 routing-policy（registry active pointer）可以改 allow-list / preferred
  公开先验 CLI 未传入；R1 / bandit / 拓扑仍不决定这次调用
```

---

## 2. 目标

### 2.1 产品目标

在**不训练权重、不在线探索高风险任务、不让一次自评改写策略**的前提下，让系统按任务族和角色把工作分给「够好且更便宜」的模型，并把贵的主模型留给高风险 / 高复杂度 / 规划类工作。

成功只允许在证据阶梯上陈述：

| 标签 | 含义 | 路由上的现状 |
| --- | --- | --- |
| Present | 代码或类型存在 | R0/R1/bandit/holdout 报告器都有 |
| Wired | 接到某条运行路径 | 仅静态 ModelRouter 接到 `--track` / `--children` / flowchart |
| Exercised | 被真实或夹具跑过 | 大量单测；无生产 holdout 实验 |
| Outcome-supported | 留出集上声明指标变好且无 guardrail 回归 | **零。禁止声称。** |

Checkpoint F 的正式表述：在密封 holdout 上，自适应路由相对 R0 达到**已批准**的成本–质量目标（成对隔离评估，或预注册且 overlap 诊断有效的估计器）。见 [ADR-005](../decisions/0005-checkpoint-f-holdout-open-questions.md)。

### 2.2 规格已拍板、实施时不得默默改掉的约束

来源：[三线终稿](../superpowers/specs/2026-08-18-three-line-final.md) §5–6、[ADR-004](../decisions/0004-controlled-adaptation.md)。

1. **Live = R0 硬过滤 + 单层 R1。** 稀疏时回退到批准的 R0 基线，禁止「稀疏时选最高 LCB」。
2. **生产 R1 只吃 `taskSuccess` 的 PASS/FAIL。** 路径逃逸记 `policyCompliance`，不自动等于模型无能。跟踪线的 `P` / `H` / `score` 只叫醒分析，**不写入**路由观测。
3. **R1 key** = `(taskFamily, role, modelVersion, featureVersion)`。版本变更开新 key。晋升看有效样本量 `nObsEff`，不看 prior 强度。
4. **高风险：白名单，探索次数必须为 0。**
5. **层级归因（项目效应、交互项）只离线出报告，不进 live 估计器。**
6. **策略变更全部提案优先。** `adapt auto` 只许收集和提案；`adapt promote --approve` 才动指针。权限 / 安全 / 凭据永不自动晋升。
7. **公开榜单是冻结快照先验，不是 live 策略，也不能冒充本地观测。** 路由时禁止 HTTP。
8. **不训练模型权重。** 拓扑搜索在 Checkpoint F 前不得进入 live run loop。

### 2.3 非目标（当前阶段）

- 用 Chatbot Arena 总分或「某套 agent 产品」的 SWE-bench 全榜当路由器。
- 让一次用户口头「不行」直接改下一次全局默认（必须进候选 + 评估 + 晋升）。
- 在没有 holdout 政策的情况下把 R1/bandit 接到 live 并宣传提升。
- 为路由引入新编排引擎、新数据库或在线拉榜。

---

## 3. 已有功能（按是否影响 live 分组）

### 3.1 已经接到 live（用户跑 `--track` / `--children` / `--flowchart` 会碰到）

| 能力 | 位置 | 行为 |
| --- | --- | --- |
| 两档目录 | `src/routing/primary-catalog.ts` | `--primary-model` + 可选 `--fast-model`。假执行默认 `premium` / `cheap`；真实 id 用保守成本估计。 |
| 任务分析 | `src/routing/analyze-task.ts` | **不是 LLM。** 角色优先，目标字符串正则提高复杂度 / 风险。高风险、HIGH、planner、debugger、deploy → 偏向主模型。 |
| 静态路由器 | `src/supervisor/model-router.ts` | 角色、复杂度上限、预算、时限过滤后，选最便宜合格项。高风险任务：**白名单**（`approvedForHighRisk`）硬过滤，无合格模型时抛 `RoutingRefusalError`；flowchart 的 `approvalRequired` 仍是人工门，与白名单分开。注释写明：这是 R0 等价，R1/bandit 不得走这条路径。 |
| 任务分配 | `src/routing/assign.ts` | 分析 →（若传入）learned 策略或公开先验改 allow-list / preferred → ModelRouter。`--track` / `--children` 会加载 **registry 中已晋升** 的 routing-policy。 |
| 路由事件 | `MODEL_ROUTED` | 记下 task、role、选中的 model，以及 family / featureVersion / modelVersion / eligible set / 拒绝矩阵（旧事件缺这些字段仍可解析）。 |
| 提案学习 | `src/learning/auto-loop.ts`、`adapt auto` / `adapt learn` | 跑完后可写一份 `routing-policy` **候选**。永不 CAS 晋升。`adapt promote --approve` 之后，下一次 assign 读新指针。 |

### 3.2 库已实现、测试覆盖、但 live 不调用

这些是「能评审算法、不能当产品承诺」的部分。

| 能力 | 位置 | 用途 |
| --- | --- | --- |
| 硬约束 R0 | `src/routing/r0.ts`、`policy.ts`、`capability-registry.ts` | 隐私级、能力声明、上下文窗、预算、时限、高风险白名单。失败原因全保留。另有置信度级联 `applyCascade`。 |
| 单层 R1 | `src/routing/r1.ts`、`posterior.ts` | Beta 后验；默认 **Beta 分位数 LCB**（正态近似仍可对照）。只消费 `taskSuccess` PASS/FAIL。过质量线（默认 0.55）后选**最便宜**；稀疏或不过线回 R0 基线；带滞回。`nObsEff` 不含 prior。**仍不接 live。** |
| Bandit | `src/routing/bandit.ts`、`learning/bandit-store.ts` | ε-greedy + **均值奖励**（不是 UCB）。高风险探索计数强制为 0。auto-loop 只把 `taskSuccess` PASS/FAIL 记成 1/0。live 不读。 |
| Shadow | `src/routing/shadow.ts` | 影子臂学习，不改生产副作用；比较预算可授权隔离调用。 |
| 公开场景先验 | `src/routing/public-prior.ts` | 按任务族混合 Aider polyglot / SWE-bench Verified mini / Terminal-Bench 固定 harness / Arena **coding**。过质量线后选最便宜。`deploy` / `unknown` 不用榜。 |
| 拓扑 | `src/routing/topology.ts` | single / critic / debate 等；Checkpoint F 前禁止进入 run loop。 |
| 实验机械 | `src/experiments/{replay,holdout,shadow,canary,comparison-report,isolation,manifest}.ts` | 冻结 replay、密封清单、成对比较报告（默认：n≥5，效用 Δ 的 95% CI 不含 0，**成本 Δ 的 CI 上界 ≤ $0**）。 |
| 晋升机械 | `src/adaptation/{registry,promotion,rollback,approval-profile}.ts` | 版本化资源、CAS、回滚账本。`routing-policy` 是允许的资源种类之一。 |

### 3.3 规格已写、代码未落地

| 项 | 计划 | 现状 |
| --- | --- | --- |
| 结果向量 `criterion` | Phase B：`taskSuccess` / `policyCompliance` / `userAcceptance` / `cost` / `latency` / `rework` | `OutcomeObservation.criterion` **已必需**。生产路径仍没有从验收结果生成 `taskSuccess` 的完整适配器；信号层已分列。 |
| 双 LCB + 覆盖率选默认 | Phase B：Beta 分位数 ∥ 正态近似 | 两者都有；库默认 Beta 分位数。有种子覆盖率夹具，**不是**预注册的正式覆盖率战役。 |
| 离线层级归因 | Phase C：logit 可加 + 概率可加启发式，只出报告 | `src/routing/offline-*.ts` 不存在 |
| 密封 holdout 实验 runner | ADR-005 冻结，待专家答两问 | 清单/隔离机械可继续；**实验运行与改进声称冻结** |

公开先验的研究说明：[public-scene-prior.md](../research/public-scene-prior.md)。R0 排序应是：硬过滤 → 冻结榜（若有覆盖）→ 过线最便宜。Planner / 高风险仍走主模型，榜单不能覆盖。

---

## 4. 问题整合

按「会卡住产品」而不是按文件名归类。每条都附代码或规格锚点。

### A. 学到的策略无法生效（闭环断开）— **已修复**

**原现象：** `adapt auto` 把候选写入 adaptation registry，live `assignTasks` 却读 `learning/projects/<hash>/routing.json`。`saveLearnedRouting` 无调用方。批准只移动指针，不生成那份 JSON。

**现行为：** `loadLearnedRouting` 只读 `routing-policy` 的 registry active content。无版本的 `routing.json` 被忽略；`saveLearnedRouting` 会抛错。验收：`test/unit/learning/active-routing.test.ts`（批准后下一次 assign 读新策略；rollback 恢复父版本）。

旁路 `bandit.json` 仍由 auto-loop 更新、live 不读。这是刻意的：F 关闭前 bandit 不得当生产决策器。

### B. 规格中的 R1 与库里的 R1 — **库已对齐，仍 shadow-only**

终稿规则现已在 `routeR1` 落地：

```text
过门且 LCB ≥ 质量线（默认 0.55）→ 过线最便宜
都过不了 → 批准的 R0 基线
稀疏 → 批准的 R0 基线（不是最高噪声 LCB）
滞回：上一选择仍过线时，更便宜的模型需稳定超过 floor+margin 才切换
```

R1 只消费 `taskSuccess`；`nObsEff` 不含 prior；默认 Beta 分位数 LCB。live `ModelRouter` 仍不调用它。这是上线前阻断项，不是当前 live 回归。

### C. 两套模型目录，约束强度不同 — **高风险白名单已进 live；其余未统一**

Live `RoutableModel` 现有 `approvedForHighRisk` / `version`。高风险 assign 硬过滤白名单，无合格模型返回 `RoutingRefusalError`。flowchart 的 `approvalRequired` 不自动等于高风险白名单。

仍未进 live 的库约束：隐私级、能力声明、上下文窗、provider 禁令、真实 token 单价。真实模型 id 的成本仍是 `catalogFromPrimary` 里的固定估计。

**目标对齐：** 最终应只有一份能力注册表。本阶段不把 R1 接到 live 来「顺便」统一目录。

### D. 观察太弱 — **分列与错误归因已修一截；生产验收适配器仍缺**

已改：

- `USER_ANSWER` 记 `userAcceptance`，**不再**挂到最后一个 `MODEL_ROUTED` 模型。
- `TASK_RESULT` 仅在确定性 PASSED/FAILED 时记 `taskSuccess`；`UNOBSERVED` 不当 PASS/FAIL。
- `JUDGE_DECISION` / peer 记 `policyCompliance`，不进入 R1 或 bandit reward。
- `collectSignalsFromEvents` **不**处理 `TRACKING_ASSESSMENT`。tracking score 不进 auto-loop、不进 R1。
- auto-loop 诊断只聚合 `taskSuccess`；bandit-store 只把 PASS/FAIL 记成 1/0。
- `adapt learn` 仍是「复制当时选了谁」的提案，不是结果学习。现会保留 payload 上的 family / eligible set，不再把 family 写成 `"unknown"`、把角色一律压成 `"worker"`。

仍缺：从真实任务验收生成 `taskSuccess` 的生产适配器；可行动阈值（`samples >= 2`）与 R1 `minSamples = 5` 仍不一致——前者只是提案门，不是每族结论门。任务族分类仍是角色 + 英文正则（`plan` 仍排在 `implement` 前）。目录成本仍不回写真实 tokens。

**目标对齐：** 缺 `taskId` 绑定就是 `UNOBSERVED`。正式每族结论应预注册样本下限或按 MDE 做 power analysis，而不是用 `n >= 5` 当可靠结论。

### E. 评估阶梯是标签，不是门

候选带着 `evaluationPlan.stages = ["static","replay"]`。没有任何 `adapt eval` 在晋升前跑 replay 或 holdout。人批准的是 JSON 文本，不是「相对 R0 的成对报告」。

比较报告器已经会拒绝无 CI、成本上界超标、或用「improve/better」却样本不足的声称。它只是没被晋升流程调用。

**目标对齐：** 无对照报告不得 `promote`。报告必须带候选哈希、环境/评估器版本、cache key。

### F. 公开先验写好了，CLI 没传入

`assign.ts` 支持 `prior?: PublicPriorSnapshot`。`src/cli/main.ts` / `src/track/loop.ts` 创建 catalog 和 assignments 时**仍不传** `prior`。别名匹配已改为大小写折叠后的**精确**匹配（`gpt-4` 不再命中 `gpt-4-mini`）。快照入库、`snapshotId` bump、hash 与 CLI 接线仍未做。公开榜只应作为冻结 R0 先验，不能冒充本地观测。

### G. Checkpoint F 卡在政策，不是卡在缺一个函数

机械已有：R0、R1、成对报告、倾向分、隔离守卫、密封清单。ADR-005 **冻结实验 runner 和改进声称**，直到有人回答：

1. **成本–质量目标**用哪条：现行代码是「效用 CI 不含 0 **且** 成本 CI **上界** ≤ `maxCostIncreaseUsd`（默认 0）」。若改成「平均成本不升」会比代码更松，必须改代码或改措辞。备选：$0.02/episode，或显式的 utility-per-dollar。
2. **holdout 数据从哪来：** 手写夹具对打进报告器 = 自交易，已否决。推荐：train 上更新 R1 后验，R0 与 R1 都路由密封 holdout，确定性模拟器出效用/成本，报告标 `evidenceClass: "simulation"`。子问题：仿真能否把 F item 1 标成「仿真证据已关」？成对设计 vs 现成 OPE？仿真非临时报告的最小样本 / 每族下限？

在这之前把 R1 接到 live，等于在未知成功标准上做产品。

### H. 次要但会在评审里被问到的问题

- **流程图 vs `--children`：** flowchart 直接用 `ModelRouter`；`--track`/`--children` 走 `assignTasks`。learned 策略只惠及后者，除非 flowchart 也读同一指针。
- **Kill switch：** `SPARKLE_AUTO_ADAPT=0` 现由 `runAutoAdaptLoop` 遵守：仍收集，不创建候选。
- **Topology / bandit 探索：** 规格禁止高风险探索；bandit 在非高风险上仍有 ε。F 前不得进 live。
- **治理：** ADR-004 仍是 Proposed；终稿已 Accepted。对外解释时以终稿 + ADR-004 原则为准，并标明 ADR 状态未关。

---

## 5. 请外人拍板的问题

请对每条给 **赞成 / 反对 / 需改措辞**。反对请给可测试的替代规则（不要只说「再聪明一点」）。

实施侧已按下列建议开工；**签字仍有效**——建议不等于 Checkpoint F 关闭。

### 5.1 产品阶段（建议默认赞成，除非有强理由）

1. **先接通 `routing-policy` 一条龙，再把 R1 接 live。** 指针链已接通；`adapt eval` 仍缺。R1 继续 shadow-only。
2. **Checkpoint F 关闭前，禁止任何「自适应路由已证明更好」的对外表述。** 仿真报告最多标 simulation-evidence；**不能**把仿真当生产改进结论。
3. **公开先验可以进 R0 排序，但永远不算 R1 的本地次数。** 前提：快照加载、hash、精确别名。deploy 继续白名单。别名精确匹配已做；CLI 接线未做。

### 5.2 ADR-005 必须有人签字（否则 F 一直开着）

4. 成本门采用哪一条？  
   - **建议 A（与现行代码一致，更严）：** 效用差 CI 为正 **且** 成本 Δ 的 95% CI **上界** ≤ 0（或批准的美元上限）。  
   - B：平均成本不增加。  
   - C：上界 ≤ $0.02 / episode。  
   - D：显式 utility-per-dollar（需同时给定效用尺度；评价卡效用在 [-1, 1]）。
5. 仿真 holdout 能否关闭 F item 1 的「仿真证据」桶，生产确认另开？**建议：可以关闭仿真证据子项，但不能关闭生产改进结论。**
6. 主设计用**成对**还是预注册 OPE？**建议 paired 优先**（不依赖 propensity model，解释更直接）；OPE 作补充。`n >= 5` 只作非临时报告门，不是可靠的每任务族结论；正式门应预注册每族下限或按 MDE 做 power analysis。

### 5.3 算法细节（可与 5.1 并行改库）

7. 过门规则：`LCB ≥ 质量线` 后选**最便宜**。质量线默认 **0.55**（版本化，live 上不自适应）。**库已按此实现。**
8. 双 LCB：覆盖率夹具存在；生产默认 Beta 分位数，正态近似进对照。预注册覆盖率目标建议 95% 名义覆盖。
9. 任务分析继续用确定性分类器作为 baseline。若未来加 LLM 分类器，必须有密封对照和正则回退。
10. 两套目录：同意最终统一到 `ModelDescriptor`。本阶段只把高风险白名单和拒绝矩阵带进 live，未废弃 `RoutableModel`。

### 5.4 明确不请人重开的题（除非论证推翻终稿）

- 高风险在线探索  
- 跟踪 `score` 写入 R1  
- live 层级交互项  
- 自动晋升 routing-policy  
- 用 Arena 总分或混杂 harness 的 agent 榜当路由器

---

## 6. 建议的最小验收（routing-policy 一条龙）

在不接 R1、不关 Checkpoint F 的前提下，下面五步全绿，才算「静态路由 + 受控学习」可用。这是给实施者的门，也是给评审者的「什么叫做完」。

1. 两次**绑定到同一 modelId** 的 `taskSuccess` 失败产生一条 `routing-policy` 候选。（auto-loop 诊断已只看 `taskSuccess`。）
2. `adapt eval` 写出带 cache key 的 replay 报告（相对当时的 R0 基线）。**仍未做。**
3. `adapt promote --approve` 之后，下一次 `--track` 的 `assign` 读到**新**策略（avoid / prefer 生效）。**单测已覆盖。**
4. `adapt rollback --reason guardrail` 之后，再下一次 assign 回到父版本。**单测已覆盖。**
5. 文档和 CLI 输出仍不出现 Outcome-supported。

R1 接 live 是这五步之后、且第 5.2 问有书面答案之后的事。

---

## 7. 关键文件

| 文件 | 为什么给评审者 |
| --- | --- |
| [三线终稿](../superpowers/specs/2026-08-18-three-line-final.md) | 路由与晋升的权威规格 |
| [ADR-004](../decisions/0004-controlled-adaptation.md) | 执行为什么不能自改策略 |
| [ADR-005](../decisions/0005-checkpoint-f-holdout-open-questions.md) | F 卡在哪两问 |
| [公开场景先验](../research/public-scene-prior.md) | 为什么不用 Arena 总分 |
| `src/routing/assign.ts`、`supervisor/model-router.ts` | 当前 live |
| `src/routing/r0.ts`、`r1.ts` | 自适应库 |
| `src/learning/auto-loop.ts`、`learned-routing.ts`、`adaptation/registry.ts` | 提案与 active pointer；live 读同一份 versioned content |
| `src/experiments/comparison-report.ts` | 改进声称的代码门 |

---

## 8. 修订

| 日期 | 说明 |
| --- | --- |
| 2026-08-19 | 初稿。基于当时仓库调用图，未使用生产运行日志。 |
| 2026-08-19 | 按专家评审修订：接通 active routing-policy；结果分列与按 taskId 归因；live 高风险白名单；R1 库改为过线最便宜（仍不接 live）。不声称 Outcome-supported。 |
| 2026-08-19 | 优化计划：[routing-optimization.md](../superpowers/plans/2026-08-19-routing-optimization.md)。 |

# 模型路由：问题整合、已有能力与目标

> **已被取代（执行权威）：** [model-routing-final-plan.md](./model-routing-final-plan.md)。  
> 专家复核确认：总体判断仍成立，但本文若干「现状」（尤其 P1–P4、P6）已过时。下一步、Checkpoint F 门与工作包以最终方案为准。本文保留作问题背景。

**用途：** 对外评审简报（历史）。把直播路由的现状、缺口、已实现但未接线的能力、以及目标收成一份可独立阅读的材料。  
**日期：** 2026-08-19  
**范围：** `src/supervisor/model-router.ts`、`src/routing/`、`src/learning/`、`src/cli/`、ADR-004 / ADR-005。  
**不是：** 实现计划、代码补丁、或「自适应已经优于静态基线」的声称。Checkpoint F 仍开放。

---

## 1. 一句话

直播路由仍然是 **关键词任务分类 + 合格集合里最便宜（可被 preferred 覆盖）**。带不确定性的部分（能力过滤、成本级联、公开场景先验、贝叶斯 LCB、拓扑期望值、影子 Bandit）多数已经写在库里，但没有接到 CLI / `--track`，或学习了错误信号。要更准，应先修 **特征与结果回路**，不要先把 R1 接到线上。

---

## 2. 产品目标（路由这块要达成什么）

来自 `docs/specs/adaptive-agent-work-loop.md` 验收场景 2、M5 / Checkpoint F，以及 three-line 规格 §5。

| 目标 | 含义 | 当前差距 |
| --- | --- | --- |
| 按任务选对模型 | 低风险文档/调查走便宜模型；高风险、规划、迁移审查走更强模型 | 主要靠角色 + 正则；误分类会一路放大 |
| 可解释、可复现 | 每次选择能从版本化输入复盘：特征、资格、拒绝原因、策略版本 | 直播 justification 是模板句；拒绝矩阵只在库里 |
| 成本–质量工作点 | 过质量线取最便宜，而不是一律最贵或一律最高分 | 直播取最便宜或 preferred；R1 取最高 LCB |
| 用真实结果学习 | 只把确定性检查 / 测试 / 验收写成 `taskSuccess`；用户接受、策略合规、返工分列 | 学习路径复制「当时选了谁」，或用跟踪分 avoid 模型 |
| 安全边界 | 高风险不探索；隐私/提供商/能力硬过滤；直播运行不能改自己的策略 | 高风险在直播上主要变成人工审批，而不是白名单硬过滤 |
| 可证明再晋升 | 密封 holdout 或有效 OPE 达标后，才称 Outcome-supported | ADR-005 未决；禁止无 holdout 的改进声称 |

**明确非目标（不要让评审往这边推）：**

- 运行中改写活跃 routing-policy / prompt（ADR-004：执行平面与自适应平面分离，提案优先）
- 把 tracking `score` / `P` / `H` 写进路由结果
- 路由时 HTTP 拉 Arena / SWE-bench
- 把 Arena overall Elo、混合 harness 的系统榜当作模型质量
- 模型自评更新自己的路由分
- 用户口头覆盖当成质量 PASS 标签
- 在本地 `taskSuccess` 不足时训练 RouteLLM 风格分类器并直接上线

---

## 3. 两套栈（读代码时最容易混）

```text
任务 objective + 角色
        │
        ▼
  analyzeTask          ← 直播唯一分类器（正则 + 角色）
        │
        ├──────────────────────────────┐
        ▼                              ▼
  直播路径                           自适应库（多数影子 / 未接线）
  ModelRouter                        capability-registry + policy
  assignTasks                        R0 + applyCascade
  cheap / premium 目录               public-prior（实现了，CLI 不传）
  learned avoid/prefer               R1 LCB（Checkpoint F 前禁止上线）
  MODEL_ROUTED 事件                  topology EV、shadow bandit、propensity
```

- **直播：** `--track` / `--children` 走 `assignTasks` → `createModelRouter`；流程图节点走同一 ModelRouter，但 `modelPolicy` 来自流程图本身。
- **库：** `src/routing/r0.ts`、`r1.ts`、`policy.ts` 等。README 与 `adapt status` 写明：R1 / bandit 保持 shadow-only。
- **学习：** 跑完后 `adapt auto` 可提出 `routing-policy` 候选；激活必须 `adapt promote --approve`。

默认 CLI 目录是占位符 `cheap`（0.1 USD / MEDIUM）和 `premium`（0.5 USD / HIGH）。用户选的 `--primary-model` 若不是这两个 id，会套保守静态成本，**不是**按 token 计价。

---

## 4. 问题清单（问题 / 已有 / 目标）

按对精度的杠杆排序。每一条都是「现状缺口」，不是尚未发明的功能。

### P1. 学习回路学了错误标签

**问题**

- `adapt learn` 从 `MODEL_ROUTED` 复制所选模型，当作策略候选。`src/learning/from-episode.ts` 把 family 填成 `unknown`，除 critic 外角色都映射成 `worker`，并把 `WAITING_FOR_USER` 当成 high-risk。
- `adapt auto` 用跟踪分做诊断：同一模型 n≥2 且 meanScore &lt; 0.45 就写入 `avoid`，并把该 family 的 prefer 指到 primary（`src/learning/diagnostics.ts`、`auto-loop.ts`）。
- `MODEL_ROUTED` 载荷没有 family、合格全集、拒绝原因、propensity、`featureVersion`、模型版本（`src/run/events.ts`）。
- 规格验收场景 5：规划漏需求却怪模型——当前没有把失败挂到合同 / 工具 / 模型 cell 的机制。

**已有**

- 事件与 checkpoint 已持久化；`ModelInvocation` 记录 tokens / 延迟 / 参数哈希，不存正文。
- 库结果类型已有 PASS / FAIL / ABSTAIN / UNOBSERVED；ABSTAIN / UNOBSERVED 不进后验（`src/routing/outcomes.ts`、`posterior.ts`）。
- 自适应平面是提案优先：候选写入 registry，不自动 CAS 晋升。
- Phase B 计划已要求结果向量分列：`taskSuccess`、`policyCompliance`、`userAcceptance`、`cost`、`latency`、`rework`。

**目标**

- 每次路由能复盘到：family、featureVersion、eligible 集、逐条拒绝、每个合格臂的 propensity、所选模型版本。
- 任务结束后，只有确定性检查 / 测试 / 验收写入 `taskSuccess` PASS/FAIL；其余列分列，不平均进同一个分。
- 失败归因到合同覆盖、工具错误或模型 cell；规划遗漏不更新路由后验。
- 跟踪分只做分析唤醒，永不写入 routing outcome（three-line 规格与 `public-scene-prior.md` 已写死）。

---

### P2. 直播路由与库路由不是同一套资格规则

**问题**

- 直播 `RoutableModel` 只有 id、roles、maxComplexity、静态成本与时长。
- 库 `ModelDescriptor` + `evaluateCandidate` 还检查：提供商策略、隐私等级、能力、上下文窗口、最大输出、按 token 预算、截止时间、高风险白名单。
- 流程图路径与 `--track`/`--children` 路径可以选出不同模型；库的拒绝矩阵直播看不到。
- 能力注册表是模块级可变 `Map`，测试后需 `reset`；直播目录反而是显式配置。

**已有**

- `createModelRouter`：allowed ∩ 角色 ∩ 复杂度 ∩ 剩余预算，再按 preferred → 更低 maxComplexity → 更低成本 → id 排序；失败 fail-closed。
- `evaluateCandidate` 对每条硬约束给出 `ConstraintFailure`，合格集可审计。
- 高风险在库 R0 上只考虑 `approvedForHighRisk` 模型，不探索。
- 置信度门（节点 / 运行 / 路由默认）取最严，松的节点策略不能削弱运行下限。

**目标**

- 一份目录、一套资格矩阵。流程图 `modelPolicy` 与 assign 的 preferred 都是这套矩阵上的约束，不是第二套算法。
- 无合格模型时返回结构化拒绝（原因列表），而不是只抛 `DomainValidationError`。
- 直播高风险走白名单硬过滤 + 人工审批，而不是仅靠关键词把任务标成 `approvalRequired`。

---

### P3. 任务特征过粗，误分类会污染后续一切

**问题**

- `analyzeTask` 是直播路由器消费的全部分类器：角色最强，其次是目标关键词。
- Family 只有 edit / test / review / plan / research / refactor / deploy / unknown。
- `HIGH_RISK_RE` 会把文档里的 auth、清理里的 delete 打成高风险，从而 `preferPrimary`。
- `PLAN_RE` 排在 `IMPLEMENT_RE` 前，「plan the checkout fix」会进 plan。
- 复杂度：高风险或 deploy → HIGH；文本长或换行 ≥ 3 → MEDIUM；scout/tester → LOW；几乎没有 HIGH 来自真实工作量。
- `requiredCapabilities` 实际只有 `tool-use` 或再加 `high-risk`，直播 ModelRouter 并不消费该字段。

**已有**

- 分类器是确定性、可测的（`test/unit/routing/analyze-task.test.ts`），不是隐藏 LLM 调用——这是优点，应保留为可归因基线。
- 角色 → family 有稳定映射；planner / debugger / deploy / 高风险已强制 prefer primary。
- Bandit 侧已规定可观测特征键：`featureVersion`、`taskFamily`、`role`、`contextTokens`、`outputTokens`、`capabilities`（超出即拒绝）。

**目标**

- 角色与合同风险旗标做先验；再叠加路径/语言、估计 context tokens、所需工具、仓库传感器（测试是否存在、所有权边界）、流程图节点角色。
- 分类器变更必须 bump `featureVersion`，旧后验不得假装仍有效。
- 记录负例（该升级却走了 cheap、该 cheap 却走了 primary），供校准，不在当次运行改策略。
- 若以后加 LLM 分类器：必须有密封对照，失败回退正则；不得读隐藏 CoT。

---

### P4. 排序目标与规格不一致（最便宜 vs 最高 LCB vs 过线最便宜）

**问题**

- 直播：非 preferPrimary 时取目录最便宜；有 preferred 则 preferred 赢。
- 库 R1：在 well-sampled 估计里取 **最高 LCB**。有数据后会偏向更贵、采样更密的模型。
- three-line 规格 §5 写的是：LCB ≥ 质量线 → **过线最便宜**；都过不了 → 批准的保守升级；稀疏 → 批准的 R0 基线，**不是**稀疏时的最高 LCB。
- 成本是写死常数；`ModelInvocation` 的真实 tokens/延迟不回写目录，预算过滤是假成本。
- 直播 `maxAttempts: 1`，一次指派结束。

**已有**

- 公开先验已经按「过 qualityBar 取最便宜」实现（`pickFromPublicPrior`）。
- `applyCascade`：便宜档证据置信度低于门限则升级到下一档，记录每一步；高风险不探索。
- R1 稀疏时回退 R0 基线（`fallback: true`），版本键隔离（modelVersion / featureVersion 变更开新 cell）。
- 后验是带半衰期的 Beta-Bernoulli；`weightedSampleSize` 已扣除先验强度。

**目标**

- 统一工作点：**硬过滤 →（高风险白名单）→ 稀疏则 R0 → 过质量线最便宜 → 否则保守升级**。
- 级联接到「第一次尝试的证据置信度」，不是任务开始时的查表置信度 0.90/0.80/0.68。
- 用真实调用校准目录成本与延迟；估计必须带模型版本。
- 切模型要有滞回/冷却，避免 LCB 在阈值附近于 cheap/premium 之间抖动。

---

### P5. 公开场景先验已实现，直播未加载

**问题**

- `assignTasks` 接受 `prior`，CLI `smartChildPlan` 与 `src/track/loop.ts` **从不传入**。
- 默认目录是 `cheap`/`premium`，与 Aider / SWE-bench / Terminal-Bench 别名对不上。
- 目录只有两个模型时，min-max 会把 0.81 vs 0.83 拉成 0 和 1。
- 别名匹配是互相 `includes`，容易串台。

**已有**

- 冻结快照契约：`snapshotId`、内容哈希、schemaVersion；路由时禁止联网（`src/routing/public-prior.ts`，研究说明 `docs/research/public-scene-prior.md`）。
- Family → 来源权重已选定：edit/refactor 用 Aider polyglot + SWE-bench Verified mini（固定 harness）+ Terminal-Bench；review 另加 Arena **coding**；deploy / unknown 不用榜。
- 明确拒绝：Arena overall、SWE-bench 全量系统榜、Martian 产品榜、路由时拉 Artificial Analysis。

**目标**

- CLI / `--track` 读取版本化快照文件；把用户 `--primary-model` 映射到快照别名。
- 公开数字只做 R0 排序先验，**永不计入** R1 的 `nObsEff`。可选：映成弱 Beta 先验，样本门仍扣掉先验。
- Checkpoint F 的基线臂 = 冻结公开先验 + 硬过滤；候选臂 = 仅用 train-split 本地 `taskSuccess` 的 R1。

---

### P6. 置信度未校准，却在挡人工审批

**问题**

- `routeConfidence`：LOW 0.90、MEDIUM 0.80、HIGH 0.68，preferred 再 +0.04。该数字决定是否 `WAITING_FOR_USER`。
- 库 LCB 用正态近似 `mean - 1.96 * sd`，不是 Beta 分位数；Phase B 的覆盖夹具、nObsEff 显式拆分、滞回均未落地。
- 直播目录常常不钉 `modelVersion`，R1 的版本隔离在直播上从未发生。

**已有**

- `effectiveConfidenceThreshold` 取节点 / 运行 / 默认中的最严。
- `isWellSampled`：加权观测 ≥ `minSamples`（默认 5）才信任估计。
- 新模型版本 / 新 featureVersion 开新 cell 的测试已覆盖。

**目标**

- 审批门使用校准后的不确定度（后验分位数或显式覆盖的 LCB），查表只作冷启动先验。
- 完成 Phase B 库修正，仍保持 R1 **影子**，直到 Checkpoint F 批准。
- 目录钉模型版本；换版本即新 cell，旧数据可审计、不可混用。

---

### P7. 影子实验与 OPE 机器在，直播不记对照

**问题**

- ADR-005：改进声称与实验运行器冻结，直到工作点与 holdout 数据源被批准。这是正确的暂停，但造成「没有并排证据」。
- 影子 `step()` 不调用 `recordReward`；`bandit.json` 会更新，直播读的是晋升后的快照，不是这个文件。
- Bandit 是 epsilon-greedy，已校验的 `TaskFeatures` 不参与选择（除高风险禁止探索）。注释写 UCB，实现是均值。
- 漂移检测用精确 token 计数当签名，几乎会永远判漂移并关掉探索。
- 直播不记每个合格臂的 propensity，无法做合法 OPE。

**已有**

- Shadow runner：不调用未选模型、高风险不探索、guardrail 违约即停、独立 comparison budget。
- Propensity 日志与 overlap / ESS 校验；后悔声称在诊断失败时直接拒绝（`src/routing/propensity.ts`）。
- 配对比较报告：效用差 CI、成本差 CI 上界、n≥5 才非临时（`src/experiments/comparison-report.ts`）。
- 密封 holdout manifest、污染检查、只读隔离在 M6-T2 路径上推进；ADR-005 允许这部分继续。

**目标**

- 在直播旁记录「R1 会选谁」，不调用、不改副作用。
- 每个合格动作都有 (0, 1] 内的 propensity。
- 密封 holdout 上做配对或预注册 OPE；仿真证据标注 `evidenceClass: "simulation"`，不等于 Outcome-supported。
- 上下文 Bandit（若做）必须受风险/预算约束，且不得替代 R0 硬过滤。

---

### P8. 拓扑（要不要加 critic）与选模型混在一起，且未进运行环

**问题**

- 验收场景 2 的后半句是「独立 critic」，不是再挑一个模型 id。
- `planTaskTopology` 注明：当前 run loop **尚未调用**；缺 task-family 语义与剩余预算记账。
- 拓扑增益写死（critic +0.20 utility 等），无项目数据校准。
- 流程图是静态图，不能按 EV 动态加节点。

**已有**

- `decideTopology`：意图不清 → human-boundary（多数票不能裁决）；确定性失败不能被多数意见覆盖；加 agent 必须 EV&gt;0 且预算够。
- 反思失败升级阶梯，最多 2 次，然后停，不无限循环。
- 安全/高风险倾向 critic；architecture 倾向 specialists；开放式倾向 candidates。

**目标**

- 只对审查 / 安全 / HIGH 打开 critic，并记录聚合成本。
- 不要为了「更智能」默认 debate 或加 agent 数量。
- 接线时保留 human-boundary 与确定性失败不可覆盖这两条。

---

## 5. 能力对照（已落地 vs 直播是否使用）

| 能力 | 位置 | 库/测试 | 直播 |
| --- | --- | --- | --- |
| 关键词任务分析 | `analyze-task.ts` | 有 | 在用 |
| 最便宜合格 + preferred | `model-router.ts`、`assign.ts` | 有 | 在用 |
| cheap/premium 或主键目录 | `primary-catalog.ts`、`model-catalog.ts` | 有 | 在用（占位成本） |
| 已学习 avoid/prefer | `learned-routing.ts` | 有 | 在用（若文件存在） |
| 隐私/能力/窗口硬过滤 | `policy.ts`、`capability-registry.ts` | 有 | 未用 |
| 成本级联 | `r0.ts` `applyCascade` | 有 | 未用 |
| 冻结公开先验 | `public-prior.ts` | 有 | 未传入 |
| R1 LCB | `r1.ts`、`posterior.ts` | 有 | 影子 only |
| 结果向量（分列 criterion） | Phase B 计划 | 未落地 | — |
| 过线最便宜（R1） | 规格 §5 | 未落地（现为 max LCB） | — |
| Propensity / OPE 校验 | `propensity.ts` | 有 | 未记 |
| 影子 Bandit | `shadow.ts`、`bandit.ts` | 有 | 不驱动选择 |
| 拓扑 EV | `topology.ts` | 有 | 运行环未调用 |
| 调用级 tokens/延迟 | `model-invocation.ts` | 有 | 不回写目录 |
| 提案/晋升/回滚 | `adaptation/`、`cli/adapt.ts` | 有 | 提案优先，不自动晋升 |

---

## 6. 建议讨论顺序（给评审，不是开工清单）

在不违反 ADR-004/005 的前提下，精度杠杆从高到低：

1. **结果回路：** 扩展 `MODEL_ROUTED`；停止从路由事件学习；诊断与跟踪分解耦。
2. **统一目录与资格：** 直播改走同一套 `evaluateCandidate`；真实模型 id，而不是 cheap/premium 语义。
3. **特征：** 收紧高风险正则；合同旗标优先；传感器进 featureVersion。
4. **工作点：** CLI 加载冻结先验；尝试后级联；成本用遥测校准。
5. **影子校准：** 完成 Phase B 库（分位数 LCB、过线最便宜、滞回）；并排日志；钉模型版本。
6. **Holdout：** 等 ADR-005 对工作点与数据源拍板后再声称改进。
7. **拓扑：** 最后才把 critic EV 接到运行环。

**现在不要做：** 把 R1 接到 `assign.ts`；用两次跟踪样本 ban 模型；稀疏时取最高 LCB；路由时拉榜。

---

## 7. 请评审拍板的问题

来自 ADR-005 与本整合，建议对方明确表态：

1. **工作点：** 效用差 95% CI 不含零，且成本差 CI **上界** ≤ 0（与当前代码一致）？还是允许每 episode 小幅成本上升（例如 ≤ $0.02）？
2. **Holdout 证据：** 确定性仿真可否关闭 Checkpoint F item 1（标注 simulation）？还是必须等真实生产 episode？
3. **估计器：** 配对（每个 holdout episode 两臂都跑）优先，还是预注册 OPE？最小每 family 样本数？
4. **公开先验上线：** 在 R1 仍影子时，是否允许 CLI 加载冻结快照作为 R0 排序（仍 fail-closed、仍不联网）？
5. **跟踪分：** 是否确认从 `adapt auto` 的 avoid 规则中移除，只保留人工/确定性 `taskSuccess`？
6. **级联：** 第一次尝试的「置信度」应来自确定性检查、critic、还是模型自报（规格倾向前两者，自报不得更新路由分）？

---

## 8. 关键路径索引

| 主题 | 路径 |
| --- | --- |
| 直播路由器 | `src/supervisor/model-router.ts` |
| 任务分析与指派 | `src/routing/analyze-task.ts`、`assign.ts` |
| 目录 | `src/routing/primary-catalog.ts`、`src/cli/model-catalog.ts` |
| 库 R0 / 级联 / R1 | `src/routing/r0.ts`、`r1.ts`、`policy.ts`、`posterior.ts` |
| 公开先验 | `src/routing/public-prior.ts`、`docs/research/public-scene-prior.md` |
| 学习（有偏） | `src/learning/from-episode.ts`、`auto-loop.ts`、`diagnostics.ts` |
| 事件载荷 | `src/run/events.ts` `ModelRoutedPayload` |
| 控制分离 | `docs/decisions/0004-controlled-adaptation.md` |
| Holdout 未决 | `docs/decisions/0005-checkpoint-f-holdout-open-questions.md` |
| 工作点规格 | `docs/superpowers/specs/2026-08-18-three-line-final.md` §5 |
| R1 修正计划 | `docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md` |
| 总规格 | `docs/specs/adaptive-agent-work-loop.md` M5、验收场景 2/5 |

---

## 9. 给转发对象的读法

- 若只评 **产品对不对：** 读 §2、§4 的 P1/P3/P4、§7。
- 若只评 **能不能上 R1：** 读 §1、§6、ADR-005、P7。结论应是：可以影子对照，不能直播晋升。
- 若只评 **公开榜能不能当路由器：** 读 P5 与 `docs/research/public-scene-prior.md`。结论应是：只能当冻结先验，且 CLI 今天还没加载。

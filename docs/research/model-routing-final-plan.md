# 模型路由最终方案（Accepted）

**状态：** 已采纳。本文件是路由方向的执行权威，覆盖 [model-routing-briefing.md](./model-routing-briefing.md) 中的「下一步」陈述。简报仍可作问题背景，其中若干「现状」已过时，以本文 §2 为准。  
**日期：** 2026-08-19  
**输入：** 对外简报 + 专家研究结论 + 当前工作树代码（非冻结 commit）。  
**不是：** Outcome-supported 声称。未跑真实 provider、生产 episode、密封 holdout 或合法 OPE。

---

## 0. 锁定判断

当前最值得修的不是换更复杂的选模算法。杠杆顺序是：

1. **资格矩阵**（一份目录、一套硬过滤）
2. **任务特征与版本隔离**
3. **结果归因**（什么能更新后验）
4. **实验可识别性**（曝光分布、配对、OPE 合法性）

更准确的总体状态：

> Live 仍是粗粒度任务分析 + 静态目录排序；高风险白名单和结构化拒绝已经补上。R1 已修为 taskSuccess-only、Beta LCB、过线最便宜、稀疏回退和滞回，但仍未进入 live。真正阻止 Checkpoint F 的，是不完整的生产曝光日志、尚不合法的 OPE、未经校准的 live confidence，以及缺少可信 holdout outcome，而不是 R1 公式本身。

**因此：不把 R1 接入 live 当作下一步。** 先统一 live R0、曝光/结果契约、调用后 cascade 与真实成本；公开先验在前置条件完成后才进入 R0 排序；R1 live 晋升与动态 topology 继续排最后。

---

## 1. 已锁定的决策（原简报 §7）

| # | 问题 | 决定 |
| --- | --- | --- |
| 1 | Checkpoint F 主门 | **配对** utility delta 的 95% CI **下界 > 0**，且 cost delta 的 95% CI **上界 ≤ 0**。允许 $0.02 成本上升只能另报「质量换成本 frontier」，**不能**关闭同成本改进主门。 |
| 2 | 仿真证据 | 只能关闭独立的 **F-SIM** 项，**不能**关闭生产 Checkpoint F item 1。`simulation ≠ production improvement`（three-line-final §6）。 |
| 3 | 估计器与样本量 | **密封 paired 优先**；OPE 仅补充。声称用预注册 MDE：`n >= ((1.96 + 0.84) * sd(delta) / MDE)^2`。无 pilot 时保守启动门：总计 100、每个需单独声称的 family 30；不足 power 标 `provisional`。代码里 `n>=5` 只是 smoke。 |
| 4 | 公开先验进 R0 | **原则上可以**在 R1 仍 shadow 时进入 R0，**当前还不上线**。先完成：统一硬过滤、完整 provenance hash、双点 min-max 修正、模型版本钉住、CLI 显式快照配置。 |
| 5 | tracking score | **永不**进入 avoid、bandit reward 或 R1。主路径已朝此修正；还应对持久化与 `extraSignals` 加 runtime schema，禁止调用方伪造 `criterion: taskSuccess`。 |
| 6 | 级联正证据 | cheap 档保留的正证据 **只能**来自确定性测试、编译、schema 或明确验收 PASS。独立 critic 可触发降置信、升级或 ABSTAIN，**不能单独证明 PASS**。模型自报权重为 0。无确定性检查 → ABSTAIN → 批准的保守模型或人工门。 |

建议将上述六条写入 ADR-005 的 Decision 段，把该 ADR 从 Open 改为 Accepted。本文在 ADR 更新前视为路由实验政策。

---

## 2. 当前工作树（以专家终读 + 复核为准）

审计对象含大量 modified/untracked 文件，调查期间仍在变化。下表不是某个稳定 commit。

| 项 | 简报原述 | 现在 | 仍缺 |
| --- | --- | --- | --- |
| P1 结果回路 | MODEL_ROUTED 缺 family 等；跟踪分进路由 | 已增 family / featureVersion / modelVersion / agentRole / highRisk / eligibleModels / rejections；userAcceptance 不挂最后模型；diagnostics 与 bandit 只吃 taskSuccess | 无策略概率与完整策略身份；outcome 未稳定绑到 task+模型版本+证据；`adapt learn` 仍可从选择重建候选；缺字段时回退 `unknown`/`worker` |
| P2 资格 | live 无高风险白名单、只抛普通错 | `approvedForHighRisk`、`RoutingRefusalError`、eligible/rejection 已有 | live descriptor 仍无 provider / privacy / capabilities / window / token 预算；两套模型描述仍在 |
| P2 排序 | live = 最便宜合格 | 实际：preferred → 更低 maxComplexity → 成本 → id | 更窄但更贵的模型可压过更便宜的宽模型；preferred 压过成本工作点 |
| P3 特征 | auth/delete 误报高风险 | 该回归已过 | 仍主要靠角色、正则、文本长度；传感器未进 live 特征；`ASSIGN_FEATURE_VERSION` 无强制 bump 合同 |
| P4 R1 | 选最高 LCB | 只读 taskSuccess、稀疏回退、不过线回退、过线最便宜、滞回 0.02 | live 成本仍是静态常数；`applyCascade` 未接第一次尝试后的确定性证据 |
| P5 先验 | substring 别名；CLI 未加载 | 精确 alias 匹配已修 | CLI/track 仍无快照加载链；双点 min-max 仍把微小差拉成 0/1；hash 不含 createdAt / fetchedAt / sourceUrl |
| P6 LCB | 仅正态近似 | 默认 Beta 0.05 分位数；R1 有 hysteresis | 覆盖率选择器未落地；`lcbZ` 只影响 normal 对照；live 审批仍是 0.90/0.80/0.68 + preferred 0.04 |
| P7 OPE | 「影子机器在」 | 隔离 runner 与数据结构存在；live isolation 禁止导入 | **没有生产并排曝光**；ESS 用原始 p 而非重要性权重；缺 target propensity、行为分布、estimator 身份 |
| P8 拓扑 | 与选模混在实现里 | 独立纯函数，supervisor 明确未调用 | EV 增益/成本为手工常数，无项目校准 |

验证（专家）：定向 18/18；全量 825 中 822 通过、0 失败、3 跳过；typecheck 通过；lint 失败于 `public-prior.test.ts` 未使用的 `publicPriorHash` 导入。

---

## 3. 目标架构

```text
任务 + 合同风险旗标 + 传感器
        │
        ▼
  analyzeTask (确定性分类器, featureVersion)
        │
        ▼
  统一目录 CatalogModel
        │
        ▼
  evaluateCandidate 硬过滤（隐私/能力/窗口/预算/截止/高风险白名单）
        │
        ▼
  Live R0 排序
    用户约束（preferred / preferPrimary）单独记账
    其余：过质量线（若有冻结先验）取最便宜，否则最便宜合格
        │
        ├── 写入 RoutingExposure（完整行为分布，确定性策略为 one-hot）
        │
        ▼
  执行一次
        │
        ▼
  确定性验收 → taskSuccess PASS/FAIL
  否则 ABSTAIN
  critic 只能降置信 / 升级 / ABSTAIN
        │
        ├── 失败分类：model | contract | tool | environment | run
        │     仅 model + taskSuccess 可更新 R1 后验
        ▼
  可选 applyCascade（正证据门见决策 6）
        │
        ▼
  Shadow 并排记录 R1 会选谁（不调用）
        │
        ▼
  密封 paired holdout → 主门 CI（决策 1）
  仿真单独 F-SIM
  合法 OPE 仅补充
```

Live 审批拆成两个数，禁止把查表分叫作「置信度」：

- `coldStartRoutingScore`：复杂度查表，只作冷启动排序/展示。
- `outcomeUncertainty`：后验分位数或显式覆盖的 LCB；**只有后者**可以做统计审批门。在校准完成前，人工门只用合同旗标、高风险白名单和显式 `approvalRequired`，不用查表分冒充概率。

---

## 4. 工作包（按依赖，不是按酷炫）

### F0 — 冻结工作树

**做什么**

- 提交或打 tag，使后续实现相对固定基线。
- 修 `public-prior.test.ts` 未使用导入，让 lint 绿。
- 更新 ADR-005 Decision 为本文 §1；简报顶部指向本文。

**完成标志：** 干净的 typecheck + lint；文档权威链清楚。  
**不做：** 功能改动。

---

### F1 — 统一资格矩阵（公开先验与任何自适应策略进 live 的前置条件）

**问题：** 只补了高风险一条约束，还不是一份目录。

**做什么**

1. 以 `ModelDescriptor` 为唯一目录类型。Live `RoutableModel` 变为它的视图或直接合并字段：`providerId`、`privacyClass`、`providerPolicy`、`capabilities`、`contextWindow`、`maxOutputTokens`、token 单价、`version`、`approvedForHighRisk`、flowchart `roles` / `maxComplexity`。
2. Live `ModelRouter.route` 调用同一套 `evaluateCandidate`；失败继续抛 `RoutingRefusalError` 并带满拒绝矩阵。
3. 删除或降级模块级可变 `Map` 注册表：测试与 live 都传入显式 `models[]`。
4. 排序合同（写入 justification，可测试）：
   - **硬过滤之后**，用户/合同约束（`--primary-model` 用于 high-risk / planner / debugger / deploy）记为 `constraint.preferred`，不是质量分。
   - 无该约束时：成本升序，tie-break 用 R0 档位再 id。
   - **禁止**用「更低 maxComplexity」让更贵的窄模型压过更便宜的宽模型。复杂度已在过滤阶段处理。
5. 钉 `model.version`；缺版本 fail-closed，不准用 id 冒充 version。

**完成标志**

- 同一任务在 flowchart 与 `--track` 上资格矩阵一致。
- 单测：隐私过严、窗口不足、高风险未批准、预算不足均出现在 `rejections`。
- 单测：无 preferred 时更便宜宽模型赢；有 preferred 约束时记录原因。

**不做：** 接 R1；接公开先验（等 F5）。

---

### F2 — 曝光与结果契约（仍是最高优先级功能缺口）

**问题：** 路由事件变胖了，但还不能合法学习。

**做什么**

1. `MODEL_ROUTED` 必填（不再 optional）：`family`、`featureVersion`、`modelVersion`、`policyVersion`、`highRisk`、`eligibleModels`、`rejections`、`behaviorDistribution`（对每个 eligible 的行为概率，和为 1）。
2. 确定性 live 策略：所选 = 1，其余 eligible = 0。**禁止**为通过 overlap 检查而伪造 (0,1] 的正概率。
3. 新增或扩展 outcome 记录，绑定：
   - `taskId`、`runId`、模型 id **与 version**、`family`、`role`、`featureVersion`
   - `criterion`、`outcome`、`source`
   - `failureClass`: `model | contract | tool | environment | run`
   - `evidenceIds`（确定性验收）
4. R1 / bandit / avoid **只消费**：`criterion === taskSuccess` ∧ `source === deterministic-check` ∧ PASS/FAIL ∧（FAIL 时 `failureClass === model`）。合同遗漏、工具错误、环境失败、运行级失败 → 不降模型后验；可写 `policyCompliance` 或 UNOBSERVED。
5. `adapt learn` **停止**把「当时选了谁」当成策略标签。无 outcome 绑定则不创建 routing-policy 候选。历史缺字段：fail-closed，不得发明 `unknown`/`worker` 冒充观察。
6. Runtime schema：`extraSignals` 与反馈持久化必须经 `parseOutcomeObservation`（或等价）。缺 criterion / 非法 source / 自报 taskSuccess → 拒绝。auto-loop 的 avoid 候选要求 `nObsEff >= minSamples`（默认 5）；n=2 只出诊断文本，不写入 policy `avoid`。

**完成标志**

- 从一次 fake `--track` 跑可重建：曝光 one-hot、taskSuccess 证据链、失败分类。
- 单测：规划遗漏的 FAIL 不进入 `observationsForR1`。
- 单测：伪造 `criterion: taskSuccess` 的 extraSignal 被拒。

**不做：** 用这些数据自动 CAS 晋升。

---

### F3 — 调用后 cascade 与真实成本

**依赖：** F1 目录有 token 单价；F2 有确定性 outcome。

**做什么**

1. 把 `applyCascade` 接到「第一次尝试之后」，输入是确定性证据置信，不是 `routeConfidence` 查表。
2. 正证据门 = 决策 6。无检查 → ABSTAIN，留在批准的保守模型或人工门，不升不留廉价档。
3. 用 `ModelInvocation` 的 `tokensIn` / `tokensOut` / `latencyMs` 校准目录估计（版本化、指数平滑即可）；预算过滤改用校准后的估计，缺遥测时保守高估。
4. `maxAttempts` 对级联显式放开（例如 2），每步写入 escalation 记录。

**完成标志：** 单测覆盖：cheap PASS 保留；cheap 确定性 FAIL 升级；无检查 ABSTAIN；高风险不 cascade 探索。  
**不做：** 用 critic 单独 PASS；用模型自报过门。

---

### F4 — 特征版本合同与 live 审批正名

**做什么**

1. `ASSIGN_FEATURE_VERSION` 成为数据隔离合同：分类规则或传感器任一变化必须 bump；测试拒绝跨 version 复用后验。
2. 特征仍保持确定性、可审计。在正则基线上 **增量** 加入（有则填，无则显式缺省，不编造）：
   - 估计 `contextTokens` / `outputTokens`（来自上下文编译器，不是目标字符串长度）
   - `requiredCapabilities` 来自合同/工具需求
   - 合同风险旗标优先于关键词
   - 可选传感器：是否存在测试、所有权边界（缺省 = unobserved）
3. 重命名 live 查表分为 `coldStartRoutingScore`；统计审批门在校准完成前不使用该数。
4. Beta 路径继续固定 0.05 分位，直到有覆盖率夹具；夹具选出的 kind 写入 `policyVersion`，不得静默切换。

**完成标志：** bump 规则有测试；误报回归（文档 auth/delete）保持绿；审批文案不再称查表分为 confidence。  
**不做：** LLM 分类器（除非另开密封对照，失败回退正则）。

---

### F5 — 冻结公开先验进入 R0（在 F1+F4 之后）

**做什么**

1. `publicPriorHash` 对规范化完整快照哈希：含 `createdAt`、每行 `fetchedAt` / `sourceUrl`。
2. 显式版本化映射 `canonicalModelId → snapshotAlias`，禁止模糊匹配（精确等值可保留为映射生成的结果）。
3. 双点 min-max：目录覆盖 &lt; 3 个有分模型时 **不** 做 min-max 拉伸；改用该来源的绝对 pass_rate，或宣布该来源对本目录无覆盖并回退最便宜合格。
4. CLI / `--track` 通过 `--public-prior <file>`（或 state-root 下版本化路径）加载；路由时禁止 HTTP。
5. 公开数字永不计入 `nObsEff`。可选弱 Beta 先验必须被 `weightedSampleSize` 扣掉。

**完成标志：** 无快照则行为与今日 R0 相同；有快照则过 bar 取最便宜；deploy/high-risk 仍走白名单/主键约束。  
**不做：** Arena overall；混合 harness 系统榜；路由时拉网。

---

### F6 — 并排影子、合法 OPE、holdout 政策

**问题：** 「影子机器在」应改成「有隔离 runner，没有生产并排曝光」。现有 ESS 公式不能支持反事实声称。

**做什么**

1. Live 旁路记录 `shadowSelection`（R1 会选谁），`invoked: false`，不改副作用。继续用 live isolation 测试禁止 live 导入 R1。
2. 重写 propensity 契约：
   - 记录 **完整行为分布** μ（live 确定性 = one-hot）。
   - 目标策略 π 另记。
   - Overlap：若 π(a)&gt;0 且 μ(a)=0 → `INVALID_ESTIMATE`。不得把 μ 改成全正。
   - ESS 基于重要性权重 w=π/μ（在 μ&gt;0 的支持上），例如 SNIPS；**不是** (Σp)²/Σp²。
   - 报告带 `estimatorId`（paired / IPS / SNIPS / DR）。
3. Checkpoint 拆分：
   - **F-PROD item 1：** 密封 paired，主门 = 决策 1；真实或批准的生产 episode outcome。
   - **F-SIM：** 确定性仿真，provenance `evidenceClass: "simulation"`，关闭独立项。
   - OPE 报告永远可被 `INVALID_ESTIMATE` 否决，且不能单独关闭 F-PROD。
4. `n>=5` 保留为单元 smoke；声称样本用决策 3。

**完成标志：** 单测：one-hot 行为分布 overlap 失败当 π 打在未选臂上；伪造正概率的日志校验失败；paired 报告在成本 CI 上界&gt;0 时拒「更好」声称。  
**不做：** 改进声称；RouteLLM 训练；把 bandit `step()` 接到 live。

---

### F7 — 拓扑（最后）

**做什么（仅当 F2 有任务族与剩余预算记账）**

- 保持 `decideTopology` 为独立纯函数。
- critic 是 **独立验证拓扑**，不是换 model id。
- 仅对 review / security / HIGH 打开 critic，受预算约束。
- 保留：意图不清 → human-boundary；确定性失败不可投票覆盖。
- EV 增益在有项目 paired 数据前保持显式常数，并在 justification 标明 `uncalibrated`。

**不做：** 默认 debate；为「更智能」加 agent 数；在资格矩阵完成前接入 run loop。

---

## 5. 明确不做

- R1 / bandit / topology 驱动 live 选择，直到 F-PROD item 1 关闭且 CAS 批准。
- 运行中改写活跃 routing-policy（ADR-004）。
- tracking `score` / `P` / `H` 写入 taskSuccess 或 avoid。
- 模型自报更新路由分或过 cascade 门。
- 用户口头覆盖当成 PASS。
- 为 overlap 检查伪造正 propensity。
- 路由时 HTTP 拉榜。
- 用两次样本或 n&lt;5 的 meanScore 写 avoid。
- 把仿真关闭生产 Checkpoint F。

---

## 6. 推荐顺序（一句话）

**F0 冻结 → F1 统一资格 → F2 曝光/结果 schema → F3 cascade + 成本遥测 → F4 特征版本与审批正名 → F5 公开先验进 R0 → F6 并排影子与合法 holdout → F7 拓扑。**

并行允许：F4 的重命名可与 F2 同期（不改选择）；lint/ADR 放 F0。  
禁止并行：F5 早于 F1；F6 声称早于 F2 行为分布；R1 live 早于 F-PROD。

---

## 7. 与 P1–P8 的对应

| 专家项 | 由谁关闭 |
| --- | --- |
| P1 剩余归因 | F2 |
| P2 两套描述 + 排序细节 | F1 |
| P3 表达过粗 + version 合同 | F4 |
| P4 live 成本/cascade/preferred | F1 + F3 |
| P5 先验未接 CLI + hash/min-max | F5 |
| P6 live 查表审批 | F4 |
| P7 无并排曝光 + 非法 OPE | F6 |
| P8 未接 live / 未校准 EV | F7 |

R1 公式本身不在关键路径上。它已经按规格修正，继续影子即可。

---

## 8. 实现时的文件落点（预期）

| 包 | 主要改动 |
| --- | --- |
| F1 | `src/supervisor/model-router.ts`、`src/routing/policy.ts`、`capability-registry.ts`、`primary-catalog.ts`、`cli/model-catalog.ts` |
| F2 | `src/run/events.ts`、`src/routing/outcomes.ts`、`src/learning/from-episode.ts`、`signals.ts`、`auto-loop.ts`、`diagnostics.ts` |
| F3 | `src/routing/r0.ts` `applyCascade`、coordinator / flowchart-run、`src/telemetry/model-invocation.ts` |
| F4 | `src/routing/analyze-task.ts`、`assign.ts`、model-router 查表重命名 |
| F5 | `src/routing/public-prior.ts`、CLI / `track/loop.ts` |
| F6 | `src/routing/propensity.ts`、`src/experiments/`、ADR-005 |
| F7 | `src/run/supervisor.ts` `planTaskTopology` 接线（最后） |

每包先补失败测试，再改生产代码；`corepack pnpm exec tsx --test <files>` 后 `pnpm run typecheck`。不在未要求时提交。

---

## 9. 给执行者的停条件

出现以下任一情况则停，回到提案，不「先接上再补」：

- 需要 R1 决定 live 模型才能继续的功能请求
- 需要伪造 propensity 才能让 overlap 变绿
- 需要用跟踪分或自报才能填满 taskSuccess
- 需要联网拉榜才能路由
- 用仿真报告关闭 F-PROD item 1

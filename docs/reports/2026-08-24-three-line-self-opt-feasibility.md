# 三线并行与受控自优化:可行性/有效性审计与保行为重构对比

日期:2026-08-24
基线:`main` @ `eb48a31`(fix(cli): --primary-model now actually selects the executor's model)
范围:`src/tracking`、`src/run`、`src/supervisor`、`src/adaptation`、`src/learning`、`src/routing`、`src/experiments`、`src/track` 及其单测/集成测/验收测。
权威规格:[三线最终规格](../superpowers/specs/2026-08-18-three-line-final.md)、[ADR-004](../decisions/0004-controlled-adaptation.md)、[ADR-005](../decisions/0005-checkpoint-f-holdout-open-questions.md)、[adaptive-agent-work-loop](../specs/adaptive-agent-work-loop.md)、[status-matrix](../status-matrix.md)。

本报告不声称任何 Outcome-supported 改进。Checkpoint F-PROD 仍开放(ADR-005),
本次改动全部是**行为保真**的模块拆分与局部性能优化;算法语义、阈值、晋升条件、
路由决策、公开导出、CLI 标志、事件 schema、CAS 语义均未变。

---

## 1. 对外契约清单与隐式依赖图

### 1.1 模块对外契约(重构前后完全一致)

**tracking(三线中的跟踪/分析入口)** — 公开面即 `src/tracking/index.ts`:

- 类型:`RollingSummary`、`TrackingWindow`、`TrackingAssessment`、`AnomalyPacket`、
  `GateDecision`、`HumanSignal`、`OpenMinor`、`AnomalyCode`、`OptionalScore`、
  `ConstraintRecord`、`ToolSituation`。
- 函数:`computePrescore`(P = quality × coverage,四舍五入 4 位)、
  `extractHumanScore` / `hasObviousHumanProblem` / `humanScoreValue`(H 提取,
  清单占比 → 十分制 → 短句规则,evaluable=0 → UNOBSERVED)、
  `combineScore`(无 H 或无明显问题 → P;否则 `0.7*min(H,P)+0.3*max(H,P)`)、
  `evaluateGates`(hard 码优先;soft 阈值默认 0.55;minor 升级规则:连续 2 轮 /
  累计 3 条 / 触碰约束或用户拒绝)、`rollSummary`(哈希链 `prevSummaryHash`;
  超预算强制 omission → fail-closed)、`runTrackingTurn`(单轮组合入口;
  fail-closed 时追加 `mandatory-omission` 并置 `askUser`)、
  `proposeFromAnomaly` / `sanitizePacketForAnalysis`(分析线:脱敏包 → 一条
  versioned candidate,绝不晋升)、`bindExecutionContext` /
  `executionMayNotReadSummary`(隔离断言:执行线只拿 ContextPacket)。
- 哈希契约:`hashAssessment` / `hashSummary`(字段排序后 hash32;
  `applyTrackingGate` 以重算校验失败即抛错的方式防伪造)。

**run / supervisor(执行线与门权威)**:

- `applyTrackingGate`:唯一把 `TrackingAssessment` 映射为状态转换的入口。
  幂等键 `assessmentHash:seq`;重放同一 assessment 只产生一次转换。
  映射白名单:`askUser`→`wait_user`(WAITING_FOR_USER);`kind==="none"`→无转换;
  hard `user-reject-stop`→`wait_user`;其余 soft/hard/wakeAnalysis→`queue_analysis`
  (RUN_BLOCKED,Phase A 语义)。`executionAuthority` 显式丢弃 supervisor 指令
  文本与滚动摘要,只返回任务上下文(摘要不能当权威)。
- `applyChildThreeLine`(`child-tracking.ts`):子任务 TASK_RESULT 只有携带
  PASSED/FAILED 的确定性 verification 且 coverage>0、有 hard 维度 PASS/FAIL 时
  才评分;FAIL 无证据 refs 则拒绝套用(不发明 tracker 叙述,不把 UNOBSERVED
  填成 0.5)。
- 事件 schema(`src/run/events.ts`,`schemaVersion: 1`):`TRACKING_ASSESSMENT`、
  `GATE_TRANSITION`(含 `transitionId, episodeId, turnId, seq, from, to,
  reasonCode, assessmentHash, evidenceRefs, policyVersion, idempotencyKey,
  directive`)、`RUN_BLOCKED`、`RUN_WAITING_FOR_USER`、`MODEL_ROUTED`、
  `JUDGE_DECISION`、`LEDGER_UPDATED`、`EPISODE_*` 等 33 种,一个未动。
- `planTaskTopology`:保留 API,注释明确"当前 run loop 尚未调用"(M5-T5
  记录项未接线,归 Checkpoint F / M6)。

**adaptation(受控自优化)**:

- `ResourceRegistry`:`registerBaseline` / `createCandidate`(不动 active 指针;
  单资源边界、无环 lineage、hash 失配 fail-closed)/ `beginPromotion` +
  `commitPromotion`(两阶段 CAS;crash 留下 inactive pending)/ `promote` /
  `rollback`(guardrail 自动、degradation 先提案需 confirm、user 直接 CAS;
  幂等)/ `retire` / `snapshot` / `restore`。
- `promoteWithRegistry` / `PromotionService`:routing-policy 晋升强制
  `evalReport`(evidenceClass 必须 replay,拒绝 production 标签,provisional
  报告非批准材料)。显式批准者必须 human(model / self-review 一律拒绝)。
- `loadAdaptationRegistry` / `saveAdaptationRegistry` /
  `withAdaptationRegistryLock`:文件锁 + 临时文件原子改名持久化。
- `autoPromotableFor`:permission / security / credential 永不自动晋升
  (由 kind 派生,输入不可覆盖)。
- `createAdaptationDriftMonitor`、`paretoFront`、`mutateResource`(what/when/
  where 三轴受限,offline-inter-test-time)。

**learning(自动闭环,只提案)**:

- `runAutoAdaptLoop` / `runAutoAdaptFromEvents`:收集信号 → 持久化 feedback →
  更新项目 bandit(离线存储)→ 诊断 →(仅当 `SPARKLE_AUTO_ADAPT` 未禁用)提出
  routing-policy candidate。**`autoPromote` 参数被忽略,永不 CAS**;
  `SPARKLE_AUTO_ADAPT=0` 仍收集。
- `loadLearnedRouting`:live 只读 registry 的 active 指针;
  `saveLearnedRouting` 直接抛错(旁路 routing.json 被拒绝)。
- `parseObservedSignal`:user/human 伪造 `criterion: taskSuccess` fail-closed。
- `proposeRoutingFromOutcomes`:只有绑定了确定性 taskSuccess 的 outcome 才产出
  avoid 项(failureClass=model 的 FAIL)。

**routing**:

- Live 面:`createModelRouter`(R0 等价:硬过滤 `evaluateLiveCandidate` +
  preferred 约束 + 最便宜;一票否决走 `RoutingRefusalError`,决策记录完整
  rejection 矩阵与 one-hot `behaviorDistribution`)、`assignTasks` / `assignOne`
  (分析 → 学到的 avoid/prefer → 路由)、`liveCascadePlanFromAssignment` /
  `decideLiveCascade`(便宜优先层级;非 model failureClass 不级联;高风险不
  探索)。
- 影子/离线面:`routeR1`(硬过滤继承 R0;well-sampled 且 LCB ≥ 质量线取最
  便宜;稀疏 / 无过线 → 回退 R0 基线,绝不选最高噪声 LCB;hysteresis 0.02)、
  `updatePosterior` / `lowerConfidenceBound`(生产默认 beta-quantile 单侧 95%,
  normal 留对照)、`nObsEff`(减去 prior 强度,prior 不能冒充样本)、
  `selectArm`(ε-greedy,高风险探索计数必须恒 0)、`decideTopology`、
  `buildR1ShadowReport`(paired、never invoked、禁 exploratory)、
  offline-logit / offline-prob-add(仅报告)。
- `observationsForR1`:生产 R1 只吃 `criterion === taskSuccess` 且
  `source === deterministic-check` 的 PASS/FAIL;FAIL 还须
  `failureClass === model`。

**experiments**:`HoldoutVault`(sealed、访问审计)、`createCanaryRunner`
(guardrail 停机)、`runSimulationHoldout`(`canCloseProductionCheckpointF:
false` 硬编码;OPE 附录一律 `INVALID_ESTIMATE`)、`computeComparisonReport` /
`validateComparisonReport`(改进类声明需非 provisional + utility CI 下界 > 0 +
cost CI 上界 ≤ 容忍;F-PROD 判定只认 production 证据)。

**CLI**(`src/cli/main.ts`):`run` / `inspect` / `resume` / `answer` / `auth` /
`models` / `pref` / `adapt`(list/eval/promote/rollback/auto)/ `episode` /
`delete` / `commits` / `pause` / `inject` / `doctor` / `version` / `help`。
所有标志与输出契约未动。

### 1.2 隐式依赖图(运行时 import 方向)

```text
tracking ──(analysis.ts 仅此一处)──> adaptation(registry/candidate/resource)
run ──> tracking(types/from-child)、supervisor(ledger/flowchart)、routing(topology、live-cascade、assign、failure-class)
supervisor/model-router ──> routing(policy/catalog-model/capability-registry)  [live 硬过滤唯一来源]
learning ──> adaptation(promotion/candidate/approval-profile)、routing(bandit/outcomes/catalog-model/failure-class)、run(events/event-store/episode-bind)
adaptation/eval-routing ──> learning(learned-routing)、routing(assign/primary-catalog)、experiments(replay/isolation/manifest/comparison)
routing/r1-shadow-report ──> experiments(comparison-report/gated-comparison)
experiments ──> routing(r0/r1/policy/outcomes)  [仅影子/离线方向]
track/loop ──> run + routing(live 面) + learning(loadLearnedRouting、runAutoAdaptLoop)
```

关键隔离检查结果:

- **live 执行不 import R1/bandit/topology/shadow**:`supervisor/model-router.ts`、
  `run/flowchart-run.ts`、`run/child-coordinator.ts`、`run/coordinator.ts` 中无一
  引用 `routing/r1`、`routing/bandit`、`routing/shadow`、`routing/topology`
  (`run/supervisor.ts` 引 `topology` 仅用于导出未接线的 `planTaskTopology`,
  有 `test/unit/routing/live-isolation.test.ts` 看护)。
- **score 不进路由**:`H`/`score` 只出现在 tracking 与 gate-apply;
  `observationsForR1` + `parseObservedSignal` 双层 fail-closed 防
  `criterion: taskSuccess` 伪造(ADR-005 §5)。
- **analysis 不改 in-flight run**:`proposeFromAnomaly` 只调
  `registry.createCandidate`;`sanitizePacketForAnalysis` 丢弃 actor
  identity/defense;隐藏 CoT 无 reader 注册(`readersInvoked.chainOfThought`
  恒 false)。
- **tracking 无命令权**:摘要→执行的通道被 `bindExecutionContext`(原样返回
  packet)与 `executionAuthority`(void 掉 directive 与摘要文本)显式切断,
  各有单测。
- **包级依赖环(重构前)**:`adaptation ↔ learning`(eval-routing →
  learned-routing;auto-loop/from-episode → promotion/registry)与
  `adaptation/registry.ts ↔ adaptation/promotion.ts` 文件级环——后者在重构前
  靠 `promotion.ts` 内 `await import("./registry.js")` 动态导入绕开运行时环。
  本次重构消除了文件级环(见 §4.2);包级 adaptation↔learning 环在文件粒度上
  无环(learned-routing 不回引 eval-routing),属可接受的分层交叉,未动。

### 1.3 不可破坏不变量的证据位置(全部有测试看护)

| 不变量 | 实现 | 看护测试 |
| --- | --- | --- |
| 分析线不改 in-flight run | `tracking/analysis.ts` 只 createCandidate | `test/unit/tracking/analysis.test.ts` |
| Tracking 无命令权、白名单转换 | `run/gate-apply.ts` mapGateDirective + 幂等键 | `test/integration/track/gate-apply.test.ts`、`test/unit/run/gate-apply.test.ts` |
| H/score 只叫醒分析 | gates.ts soft-threshold → wakeAnalysis;ADR-005 §5 fail-closed | `test/unit/tracking/gates.test.ts`、`test/unit/learning/signals*.test.ts` |
| 稀疏回退 R0 基线 | `routeR1` sampled/aboveFloor 双回退 | `test/unit/routing/r1*.test.ts` |
| nPrior 不冒充 nObs | `nObsEff = α+β−α₀−β₀` | `test/unit/routing/posterior.test.ts` |
| 层级归因只离线 | offline-logit/offline-prob-add 仅 experiments 引用 | `test/unit/experiments/attribution-report.test.ts` |
| 晋升提案优先、human-only | registry.preparePromotion + assertExplicitApprovalActor | `test/unit/adaptation/promotion.test.ts` |
| 权限/安全/凭据永不自动晋升 | `autoPromotableFor` + approval-profile | `test/unit/adaptation/*` |
| `adapt auto` 只提案 | runAutoAdaptLoop 忽略 autoPromote | `test/unit/learning/auto-loop.test.ts` |
| SPARKLE_AUTO_ADAPT=0 仍收集 | isAutoAdaptEnabled 分支在 persist/bandit 之后 | 同上 |
| 强制 omission fail-closed | roller maxItems → failClosed + mandatory-omission | `test/unit/tracking/roller.test.ts`、`turn.test.ts` |
| simulation ≠ production | `canCloseProductionCheckpointF` 只认 production 证据 | `test/unit/experiments/comparison-report.test.ts`、`test/integration/m6/simulation-holdout.test.ts` |
| CAS 幂等 / 回滚账本 | casActivePointer + RollbackLog append-only | `test/unit/adaptation/rollback.test.ts`、`test/acceptance/adaptive-loop.test.ts` |

---

## 2. 可行性结论

**三线并行/隔离:已按规格实现,且是"结构性隔离"而非"约定隔离"。**

- 执行线(run/supervisor + flowchart)只消费不可变事件与 ContextPacket;
  跟踪线产出 `TrackingAssessment` + `RollingSummary`(哈希链),经
  `applyTrackingGate` 的幂等白名单映射才变成状态转换;分析线只在
  `wakeAnalysis` 时拿脱敏 AnomalyPacket,出口只有一条 versioned candidate。
  三条线之间的每个越权通道(摘要当权威、自由文本改状态、CoT 读取、score 写
  路由)都有显式 fail-closed 代码 + 对应单测,不是靠注释约束。
- 需要指出"并行"的真实形态:三线是**逻辑并行**(职责/权威分离),不是三个
  常驻线程。跟踪评分在子任务 settle 时同步计算(`applyChildThreeLine`),
  分析排队用 `RUN_BLOCKED(reason: ANALYSIS_QUEUED)` 表达(Phase A 语义)。
  这与三线最终规格一致(规格定义的是权威与数据流边界,不是调度器)。

**受控自优化闭环:propose → gates → CAS promote → later episode → guardrail
rollback 全链路可运行,验收测试(`test/acceptance/adaptive-loop.test.ts`)用
确定性 fake 走通了 Checkpoint G 的全部台阶,且显式不声称 Outcome-supported。**

缺口(与 status-matrix 一致,重构不改变):

1. **Checkpoint F-PROD 开放**:sealed production holdout 不存在;
   `runSimulationHoldout` 只能闭 F-SIM。因此 live 路由必须(且确实)停在
   R0 等价。
2. **`planTaskTopology` 未接线**:topology 决策未在 run loop 逐轮记录
   (代码注释与 tasks/adaptive-plan.md 均如实声明,属 M6/F 所有)。
3. **层级归因(offline-logit / prob-add)只出报告**,无任何 live 指针写入——
   这是规格要求,不是缺陷。
4. **auto-loop 的诊断信号较粗**(正则打分 + 均分阈值),提案质量受限;但
   提案必须过 replay eval + human 批准才生效,粗糙度被门控吸收。

结论:**可行**。规格声明的隔离与受控性在代码里成立;未接线部分全部有显式
标注且被门控挡在 live 之外,不存在"规格说了但代码悄悄绕过"的通道。

## 3. 有效性结论

**现有测试与代码能证明什么:**

- 评分/门控管线(P、H、score、hard/soft gate、minor 升级、fail-closed)在
  单元层是**确定性且被完整规约**的(`test/unit/tracking/` 12 个文件,含
  acceptance.test.ts 对提议文件1 §11 用例的覆盖)。
- 自优化闭环在 **Exercised** 级别成立:fake 证据下 candidate 能过静态/replay/
  holdout/canary 门、CAS 晋升、后续 episode 触发 guardrail 自动回滚
  (Checkpoint G 验收场景)。
- 路由算法的**防错性质**被直接测试:稀疏回退、prior 不计入 nObs、双 LCB、
  taskSuccess 伪造 fail-closed、simulation 不能闭 F-PROD、cost 用 CI 上界。

**不能证明什么(诚实边界):**

- **没有任何生产改进证据。** 所有"R1 比 R0 好"的通路只存在于 simulation /
  replay 证据类;`comparison-report` 会把 improvement 类声明直接判 invalid
  除非 CI 门满足,而 CI 门在仿真类证据下永远不会给出 F-PROD 关闭。状态矩阵
  "Nothing in this repo is Outcome-supported" 与代码一致。
- **稀疏数据下 R1 恒等于 R0**(设计如此):`minSamples: 5` + 每键
  (family, role, modelVersion, featureVersion)分桶意味着真实项目短期内几乎
  全部落在 fallback 分支——有效性上限受观测量硬约束,任何"看起来更快"的
  绕开(降 minSamples、取消回退)都会违反规格,已判不可行,未做。
- **仿真 ≠ 生产**:`buildR1ShadowReport` 的 paired 记录里 baseline/candidate
  utility 恒等(未调用的影子模型没有 outcome),仿真只能比较成本侧;这正确
  地阻止了从仿真里读出质量改进,但也意味着仿真报告对"质量有效性"零证明力。
- auto-loop 的 avoid/prefer 提案改善路由的假设未经 holdout 验证,只有
  replay eval 这一道确定性门 + human 审批。

结论:**机制有效性(防错、可回滚、可审计)有强证据;效果有效性(真的选得
更好)在 Checkpoint F-PROD 关闭前无法声称,代码也在多处主动阻止提前声称。**

---

## 4. 重构前 vs 重构后逻辑对比(逐模块)

原则:只做提取纯函数、消除逐字重复、收紧模块边界、局部性能;不改任何
算法语义/阈值/晋升条件/路由决策。4 项改动如下。

### 4.1 R1:提取共享 `experiments/gated-comparison.ts`

**前**:`routing/r1-shadow-report.ts` 与 `adaptation/eval-routing.ts` 各持有一份
逐字相同的 `IMPROVEMENT_CLAIM` 正则、`gatedComparison`(算卡→算报告→验证→
剥离改进类声明→重算→再验证→仍失败则抛错)、`cardFromRecords`、`mean`、
`sampleStandardError`(合计 ~120 行 ×2)。唯一差异是 difficultyTiers
(`"simulation"` vs `"replay"`)与传入 claims(外部 claims vs `[]`)。

**后**:新增 `src/experiments/gated-comparison.ts` 导出
`gatedComparisonReport({records, claims, config, difficultyTier})`、
`pairedEvaluationCard`、`stripImprovementClaims`、`isImprovementClaim`;两个
调用点各保留一个 6 行薄包装,传入与之前完全相同的 config 常量、claims 与
tier 字符串。剥离-重试-fail-closed 的控制流逐语句一致;错误消息字符串一致。

**为何保行为**:共享函数体是两份副本的逐字并集;调用参数与原常量一致;
浮点路径(mean/方差/标准误)运算顺序未变。看护测试:
`test/unit/routing`(r1-shadow-report)、`test/unit/adaptation/eval-routing.test.ts`、
`test/integration/m6/simulation-holdout.test.ts` 全绿。

### 4.2 R2:提取 `adaptation/promotion-rules.ts`,消除 registry↔promotion 运行时环

**前**:`registry.ts` 静态 import `promotion.ts` 的 7 个纯校验函数
(`isPromotableStatus`、`validateChangeNote`、`validatePromotionReview`、
`assertExplicitApprovalActor`、`isIntentId`、`intentIdFor`、
`assertRoutingPolicyEvalReport`);`promotion.ts` 反向需要 `ResourceRegistry`
类,为绕开运行时环在 `loadAdaptationRegistry` 里用
`await import("./registry.js")` 动态导入。

**后**:7 个纯函数原样移入新文件 `promotion-rules.ts`(常量
`PROMOTABLE_STATUSES`、`INTENT_ID_PATTERN` 随迁;类型经 `import type` 引用,
运行时擦除);`promotion.ts` 通过 `export { ... } from "./promotion-rules.js"`
**原位 re-export,公开 API 不变**;`registry.ts` 改从 `promotion-rules.js`
取值导入;`promotion.ts` 改为静态 `import { ResourceRegistry }`,删除动态
import。运行时依赖图变为 `promotion → registry → promotion-rules → 叶子`,
无环。

另新增 `loadAdaptationRegistryOrNew(stateRoot, options?)`:等价于原先散落在
两个调用点的 `try { load } catch(no registry snapshot) { new ResourceRegistry() }`
块(其余错误照抛)。

**为何保行为**:函数体逐字未改;re-export 保证 `import {...} from
"./promotion.js"` 的所有既有调用点(含测试)解析到同一实现;动态→静态导入
只改变模块求值时机(Node ESM 下 registry 模块在首次 load 前后都只求值一次,
且这些模块无副作用初始化)。看护测试:`test/unit/adaptation/`(promotion、
registry、rollback、retirement、eval-routing)、`test/acceptance/adaptive-loop.test.ts`。

### 4.3 R3:learning 双份"加载 registry + 确保基线"重复消除

**前**:`learning/auto-loop.ts` 的 `proposeAndMaybePromote` 与
`learning/from-episode.ts` 的 `proposeRoutingFromOutcomes` 各持有一份相同的
(a) no-snapshot 回退新建 registry 的 catch 块,(b) "无 active 版本则
registerBaseline(空 avoid/prefer 策略)" 块;仅 detector 身份不同
(`pi-sparkle-auto-loop` vs `pi-sparkle-learn`)。

**后**:(a) 换用 §4.2 的 `loadAdaptationRegistryOrNew`;(b) 提取
`ensureRoutingBaseline(registry, identity, primaryModelId, detectorIdentity)`
至 `learning/learned-routing.ts`(策略内容、author kind=detector、身份参数化,
基线内容 `{primaryModelId, avoid: [], prefer: []}` 与原先字节一致)。两个调用
点各自传原身份字符串。候选去重、`contentHash` 比较、保存时机(auto-loop 两
分支都 save;from-episode 仅 created 时 save)**逐行未动**。

**为何保行为**:提取的两个函数体与原内联代码逐语句一致;身份字符串按调用点
保留。看护测试:`test/unit/learning/auto-loop.test.ts`、
`from-episode.test.ts`、`active-routing.test.ts`。

### 4.4 R4:`routeR1` 观测单遍分组(热路径局部优化)

**前**:对 tier 列表中每个候选模型执行
`observationsForKey(observations, parts)`——对**全部**观测逐条重算
`outcomeKey(o)`(4 字段字符串拼接)再比较。M 个模型 × N 条观测 = M×N 次
key 构造与 N×M 次扫描;`buildR1ShadowReport` / `runSimulationHoldout` 对 E
个 episode 逐个调用 `routeR1`,总代价 O(E×M×N)。另有每模型一次
`input.models.find` 线性查找。

**后**:`posterior.ts` 新增纯函数 `groupObservationsByKey`(单遍构建
`Map<key, obs[]>`,组内保持输入顺序);`routeR1` 每次调用只分组一次
(O(N)),每模型 `map.get(key) ?? []`;模型查找换 `Map`。估计行的 `key`
字段改用 `outcomeKey(parts)` 生成——与原字符串模板逐字符相同。

**为何保行为**:`filter` 与"分组后取本组"产出的子序列完全一致(均保持原
顺序),`updatePosterior` 的加权累加顺序不变 ⇒ 浮点结果逐位一致;
`observationsForKey` 保留导出未改。复杂度 O(M×N)→O(N+M);仿真 holdout 总
代价 O(E×M×N)→O(E×(N+M))。看护测试:`test/unit/routing/`(r1、posterior、
r1-shadow-report)、`test/integration/m6/simulation-holdout.test.ts`。

---

## 5. 性能 / 可维护性提升

| 项 | 前 | 后 |
| --- | --- | --- |
| `routeR1` 每次调用的 key 哈希/扫描 | O(M×N) 次 key 构造 + M 次全量扫描 | O(N) 次 key 构造 + 单遍分组(仿真 holdout:E=100, M=5, N=5000 时约 250 万次字符串拼接 → 50 万次) |
| `loadAdaptationRegistry` | 每次调用 `await import()`(首帧动态解析) | 静态导入,无动态解析 |
| 重复代码 | 比较门控 ~120 行 ×2;registry 加载/基线 ~20 行 ×2 | 单一来源;净删约 150 行重复 |
| 模块边界 | registry↔promotion 文件级环(靠动态 import 掩盖) | 无环;晋升规则(纯校验)与晋升服务(IO/流程)职责分离 |

未量化为基准测试的原因:改动均为常数因子/复杂度级别且逐位保行为,现有测试
套件即是等价性证据;引入 micro-benchmark 属新增无关文件。

## 6. 明确未做的事与原因

1. **不声称 Outcome-supported、不动 Checkpoint F/G 状态。** ADR-005 F-PROD
   仍开放;本仓库一切改进证据 ≤ Exercised。文档与代码中所有
   `canCloseProductionCheckpointF: false`、"simulation ≠ production" 语义
   原样保留。
2. **不给 `planTaskTopology` 接线。** 逐轮 topology 记录需要任务族语义与剩余
   预算簿记(M5-T5 未勾项),属 Checkpoint F/M6 的功能工作,不是保行为重构。
3. **不合并 auto-loop 与 from-episode 的候选创建流程主体。** 两者的保存时机
   语义不同(auto-loop 全分支 save;from-episode 仅 created 时 save),强行
   统一要么改变持久化行为、要么引入布尔开关式伪抽象;只提取了逐字相同的
   两小段。
4. **不动 `applyTrackingGate` / `nextTrackingSeq` 的线性事件扫描。** 每次子任
   务 settle 对全事件列表 O(E) 扫描,理论上整 run O(E²);但 E 是单 run 事件
   数(数百量级),改造需要把增量状态穿透公开函数签名(`applyChildThreeLine`
   与 `settleSupervisedOutcome` 的入参契约),收益不抵接口破坏风险。已记录。
5. **不合并散落各文件的 `asRecord`/`asArray`/`asStringArray` 私有解析助手。**
   错误消息文本各处有差异且被测试断言引用,统一属高接触面低收益的改动。
6. **不动 `human-score.ts` 每次调用重建正则。** matchAll 的 lastIndex 语义
   使共享 /g 正则存在状态风险,收益微不足道。
7. **不调整任何阈值/默认值**(softThreshold 0.55、hardFailCap 0.30、
   minorPDip 0.03、qualityFloor 0.55、hysteresis 0.02、minSamples 5、
   maxCostIncreaseUsd 0)。全部是版本化规格值。
8. **不把 adaptation↔learning 的包级交叉拆成第三包。** 文件粒度无环;拆包会
   移动公开 import 路径,破坏"公开导出兼容"约束。
9. **不实现 [pi-intelligent-adaptive-loop](./pi-intelligent-adaptive-loop.md)
   的任何内容。** ADR-006 为 Proposed 未立项。

## 7. 验证

```bash
pnpm typecheck   # 通过
pnpm lint        # 通过
pnpm build       # 通过
pnpm test        # 1156 pass / 1 fail(doctor 测试,环境 Node 22.14.0 < engines 22.19.0,
                 #   与本改动无关,基线同样失败;CI Node 22.x 最新版通过)
# 改动相关套件(tracking/adaptation/learning/routing/experiments/track/m5/m6/acceptance):
npx tsx --test "test/unit/tracking/**/*.test.ts" "test/unit/adaptation/**/*.test.ts" \
  "test/unit/learning/**/*.test.ts" "test/unit/routing/**/*.test.ts" \
  "test/unit/experiments/**/*.test.ts" "test/integration/track/**/*.test.ts" \
  "test/integration/m6/**/*.test.ts" "test/integration/m5/**/*.test.ts" \
  "test/acceptance/adaptive-loop.test.ts"
# → 498 pass / 0 fail
```

未修改任何测试文件。

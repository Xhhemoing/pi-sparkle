# Algorithm goal strategy — Phase 2 — 2026-08-23

- **角色：** Phase-2 算法策略代理
- **模型 slug：** `claude-fable-5-thinking-xhigh`
- **工作分支：** `cursor/algorithm-goal-strategy-f31b`（自
  `origin/cursor/algorithm-goal-measure-f31b`，含 Phase-1b 报告与拒绝文案修复）
- **裁决对象：** `cursor/merge-inactive-slices-f31b` @ `10d08a5` 的算法面，
  以 Phase-1 本轮数据为准（1b `claude-opus-5-thinking-high-fast` 的
  [measurement 报告](./2026-08-23-algorithm-goal-measurement.md)，
  1a parent `cursor-grok-4.6` 的独立复现）。**不引用 9035 旧数字。**
- **权威规划：** [model-routing-final-plan.md](../research/model-routing-final-plan.md)
  （杠杆顺序：资格矩阵 → 任务特征/版本隔离 → 结果归因 → 实验可识别性）、
  ADR-004、ADR-005、adaptive-agent-work-loop 规范、status-matrix。
- **不是：** Outcome-supported 声称。不关闭 Checkpoint F-PROD。不实现 P0 代码
  （Phase-3 由父代理交叉验证后实现）。不改 9035 分支。

---

## 1. 总结论

**Keep / deepen / replace 的答案是：选模公式全部保留，测量仪和接线全部加深，
没有任何算法需要替换。**

Phase-1 的每一条异常都落在规划锁定的四个杠杆上，而不是落在「选模算法不够聪明」上：

| 杠杆（plan §0） | Phase-1 证据 | 裁决 |
|---|---|---|
| 1. 资格矩阵 | 执行平面（`flowchart-v1`）不收 `highRisk`/`family`/`privacyRequired`/`requiredCapabilities`；S2 里 `cheap` 对 credentials 任务仍 *eligible*；S3/S4 exit 0 | **deepen（P0）** — 引擎正确，接线缺失 |
| 2. 特征与版本隔离 | `analyzeTask` 10 探 3 假阳性高风险；双路由让一半事件带 `family: unknown` | **deepen（P0+P1）** — 不换分类器 |
| 3. 结果归因 | 审批门未武装但事件声称 WAITING_FOR_USER；`signals.ts` 对 `MODEL_ROUTED` last-write-wins，学习信号吃到 `unknown` family；bandit 写而不读且 fake 数据零方差 | **deepen（P0+P1）** |
| 4. 实验可识别性 | F-SIM `utilityDelta = 0` 是构造性的（双臂同一 `utility` 变量）；`costDelta +0.031` 是同一测量仪缺陷的另一面 | **deepen（P1 标注）** — 不为此改 R1、不上 live、不编造反事实 |

一句话版本：**这一轮数据证明了 plan §0 的锁定判断——最值得修的不是换更复杂的
选模算法。** R0 的硬过滤矩阵（`evaluateLiveCandidate`）在被喂到正确输入时全部
正确拒绝（S3/S4 直探路由器均 refuse；S2 assign 平面正确收窄到 `["premium"]`）。
失败全部发生在「谁负责把输入喂给它」的接线层，以及「事件流声称了不存在的门」
的诚实层。

---

## 2. Keep — 保留，不要动

每条绑定本轮数据。

1. **R0 live 选模（硬过滤 + preferred → 成本 → id 排序）保留原样。**
   `src/supervisor/model-router.ts` 的排序已是 `preferred → estimatedCostUsd →
   id`（第 276–283 行），没有 plan §2/P2 担心的「更低 maxComplexity 压过更便宜
   宽模型」问题——该条在本树已符合 F1 的排序合同方向。S1 的 cheap/premium 分流
   真实（planner→premium，其余→cheap），S2 assign 平面正确产出 8 条
   `complexity`/`high-risk-approval` 拒绝。**公式不是瓶颈，不要为了「显得优化」
   重写它。**

2. **Proposal-first 适应平面（ADR-004）保留。** CAS promote/rollback 验收
   2/2；`isAutoAdaptEnabled` 默认关；三次同 state-root 重复运行字节级一致，
   `loadLearnedRouting` 返回 `undefined`，`adapt status` 报
   `proposed candidates: 0`——sidecar 对本轮所有测量零影响，是验证过的，
   不是假设的。

3. **F-SIM 诚实标签机制保留原样。** `evidenceClass: simulation`、
   `canCloseProductionCheckpointF: false`（protocol 与 comparison 双处）、
   `sanitizeClaims`/`gatedComparison` 的改进语义剥离（本轮 claims 只剩
   `["仿真证据"]`）、`invoked: false`、`adapt status` 的
   none-by-construction 文案。这套机制是让「构造性 0」不构成撒谎的全部原因，
   一个字都不要放松。

4. **Live 隔离边界保留。** `routing/r1.js` 只被 `r1-shadow-report.ts`、
   `simulation-holdout.ts`、`shadow-compare.ts` 导入（全部离线）；
   `src/routing/bandit.ts` 除 `bandit-store.ts` 外无 importer；R1/bandit/
   topology 均未接 live。守卫测试本身有盲区（P1-7），但边界成立。

5. **one-hot `behaviorDistribution` 保留。** 确定性策略如实记 one-hot 是
   ADR-005 的 consequence；OPE 可识别性的正确修法是 F6 的重要性权重契约，
   永远不是给未选臂伪造正概率。

6. **拒绝文案修复（measure 分支 `71e1eec`）保留。** 4 个回归测试，
   supervisor 的 `/fits the remaining cost and time limits/i` 匹配未破坏，
   全套件 1186/0/1 绿。

---

## 3. Deepen — 必须加深的八项

按杠杆顺序，不按发现顺序。§5/§6 给出可执行清单。

### 3.1 双路由（异常 #7）→ 执行平面继承任务分析

每个 tracked 任务发 2 条 `MODEL_ROUTED`：`assign-v2`（富、正确、咨询性）与
`flowchart-v1`（`family: unknown`、`highRisk: false`、真正租约执行）。根因是
`flowchart-supervisor.ts:684-692` 的 route 调用只传
role/complexity/modelPolicy/approvalRequired/limits，而
`compileChildrenToFlowchart` 把 assignment 压缩成一个 `preferredModel` 字符串
（`track/loop.ts:132-151`），分析结果全部丢失。**加深方向是把
`TaskAssignment.analysis` 穿过编译层带到节点，让执行平面用同一套输入调同一个
`evaluateLiveCandidate`，不是造第二个路由器。**

连锁伤害已实测：`signals.ts:139-157` 对 `MODEL_ROUTED` 按 taskId
last-write-wins，而 flowchart 平面事件在租约时追加、晚于 RUN_STARTED 后的
assign 重放，所以**学习信号里每个 tracked 任务的 family 都被覆写成
`"unknown"`**——杠杆 3 的归因和杠杆 2 的 family 级学习在数据源头就坏了。

### 3.2 审批门（异常 #2）→ 武装，或停止声称

`compile-children.ts:131` 硬编码 `approvalRequired: false`。S2 的 assign 平面
对全部 4 个高风险任务发 `statusAfterRoute: WAITING_FOR_USER`，run 却
COMPLETED，35 事件里 0 条 `RUN_WAITING_FOR_USER`。**事件流声称了一个不存在的
门，这比没有门更糟。** 机制已经在：`model-router.ts:287-288` 会因
`approvalRequired` 产出 WAITING_FOR_USER，supervisor 租约路径会挂
question——缺的只是把 `analysis.highRisk` 接到编译层。plan §3 明确：校准完成
前人工门只用合同旗标、高风险白名单和显式 `approvalRequired`；这正是那个门。
需要一并定版的产品语义：`--assume-defaults` **不得**豁免高风险人工门。

### 3.3 高风险硬过滤（异常 #3）→ 从排序巧合变成强制约束

S2 flowchart 行 `eligibleModels: ["cheap","premium"]`，credentials 任务里
`cheap.approvedForHighRisk === false` 却在资格名单上；premium 赢靠的是
`preferredModel` 排序。**今天任何一处 preferred 默认值变动（比如
`track/loop.ts` 的 `preferredFast` 回退）都会把高风险工作静默送进 cheap。**
修法与 3.1 同一条线：threading `highRisk` 后 `evaluateLiveCandidate` 的
`high-risk-approval` 过滤自动生效，F1 的完成标志「同一任务在 flowchart 与
`--track` 上资格矩阵一致」随之闭合。

### 3.4 privacy / vision 接线（异常 #4、#5）→ 显式入口，fail-closed

S3（local-only）与 S4（vision）exit 0、0 拒绝；直探路由器则两者都正确 refuse
（`privacy-class` / `capability`）。根因：`assignTasks` 从不设
`privacyRequired`（router 默认 `"cloud-general"`），`assignOne` 从不设
`requiredCapabilities`（恒 `["tool-use"]`）。**要定的是边界策略而不是算法：
privacy class 与 required capabilities 只能来自显式用户输入（CLI 旗标）或
合同 constraint，禁止从 prose 关键词推断**——推断漏一次就 fail-open，比让
用户显式声明贵得多。`RequirementContract` 目前没有 privacy/risk 字段
（`src/domain/contract.ts:56-67`），所以 CLI 旗标是最短路径，合同字段是
后续版本。

### 3.5 假阳性高风险（异常 #6）→ contractRisk 优先 + 正则收窄，不换分类器

10 探 3 假阳性（"Speed up the production build" / "Rename the prod flag" /
"Write docs explaining how we deploy" → `deploy/HIGH/highRisk=true`），每个
假阳性把整个 4-child 集群打到 premium（约 5× 成本）。两个既有事实决定修法：
`AnalyzeTaskOptions.contractRisk` 已存在且覆盖关键词（`analyze-task.ts:54`），
但 `primary-split.ts:41-50` 从不传它；`HIGH_RISK_RE` 无上下文约束。加深 =
接通 contractRisk + 给正则加语境（如要求 deploy/production 处于动宾语境、
docs-about-deploy 归 docs family），保留现有 3 个 analyze-task 回归。失败方向
是安全的（多花钱不放风险），所以排 P1 不排 P0。**不上 LLM 分类器**（F4：
除非另开密封对照；确定性与可审计性是 `ASSIGN_FEATURE_VERSION` 版本隔离合同的
前提）。语义变更必须 bump `assign-v2` → `assign-v3`。

### 3.6 bandit 写而不读（异常 #8）→ 卫生化，而不是接读方

`updateProjectBandit`（`auto-loop.ts:106-108`）是唯一写方，无任何读方——
「bandit 不在 live」约束成立。但 fake 执行器下 `rewardSum === pulls`
（3 次运行后 `{premium:3, cheap:9}` 双臂全 1.0），零方差数据正持续落盘且
**无 executor/evidence-class 出处标记**。今天不修的代价是不可逆的：等到
F-PROD 后某个合法读方出现时，已无法区分哪些 pulls 来自 fake 运行。修法二选一
（Phase-3 定）：live fake 路径停写，或每条记录带出处并让未来读方 fail-closed
过滤。**明确不做的：给它接读方。**

### 3.7 F-SIM 构造性 0（异常 #1）→ 把「测不到」写进报告工件本身

`r1-shadow-report.ts:115-123` 给双臂同一个 `utility` 变量，
`utilityDelta ≡ 0`，CI `[0,0]` 与「测得相等」在报告里无法区分。CLI
（`adapt status`）已口头说明，但报告 JSON 本身没有机器可读的
`qualityEvidence: "none-by-construction"` 一类字段。加深 = 在
comparison/shadow 报告加显式标注，让任何下游读者（包括未来的自动化）不可能把
`[0,0]` 读成质量等价证据。**同一标注也覆盖 costDelta 的解读**：
`+0.03136 USD` CI `[0.02213, 0.04059]` 是真实数字，但它是同一缺陷的另一面——
R1 按规格花钱买 fixture 声称的质量（cheap 后验 0/8 PASS，R1 过线取最便宜选
mid；docs family 未入训走 6 次稀疏回退），而 utility 通道无法记录该收益。
所以「R1 是成本回归」只在「质量通道为盲」的条件下成立，既不构成砍 R1 的
证据，也不构成升 R1 的证据。真正的质量证据只能来自 F2→F6 的生产配对，
**不是**在仿真里给未选臂编造反事实结果（与伪造 propensity 同类禁忌）。

### 3.8 可观测性与守卫的三个小洞（异常 #9、#11、S5）

- 无 `--track` 时 12 事件 0 `MODEL_ROUTED` 且无任何提示——用户以为路由发生了。
- `inspect --run` 人类视图零路由信息；`preferredConstraint` 被
  `routingContextFields` 丢弃，「为什么这个模型赢」在事件流里不可恢复。
- live-plane 守卫测试只查 `simulation-holdout` 与 `routing/r1`，不查
  topology/bandit；真正的保护在 `live-isolation.test.ts` 的出现次数断言里——
  约束成立但守卫易被绕过。

---

## 4. Replace — 没有；明确反对的大改

1. **不换 R1 公式，不把 R1 接 live。** `utilityDelta = 0` 是测量仪的性质，
   14/20 分歧与 +0.031 成本是「质量通道为盲」条件下的必然输出。R1 已按规格修
   （taskSuccess-only、Beta LCB、过线最便宜、稀疏回退、滞回），plan §7 原话：
   「R1 公式本身不在关键路径上。它已经按规格修正，继续影子即可。」
2. **不为让 F-SIM 出非零 utility 而建反事实结果模型。** 对未选臂发明 outcome
   与为 overlap 伪造正概率是同一类造假（ADR-005 / plan §5、§9 停条件）。
3. **不重写 live 排序公式。** 本轮所有错误路由都源于过滤输入缺失，零例源于
   排序；现排序已符合 F1 合同方向。
4. **不上 LLM 任务分类器。** 假阳性用 contractRisk 优先级 + 正则语境修；
   确定性分类是 featureVersion 数据隔离的前提。
5. **不给 bandit.json 接读方，不用本轮数据做任何 Outcome-supported 声称，
   不关 F-PROD。** 本轮全部证据是 fake-executor + simulation。
6. **不引入第二个路由引擎来「统一」双平面。** 统一的正确形态是两个平面喂同
   一个 `evaluateLiveCandidate` 相同输入，即 F1；不是新抽象。
7. **不动 9035 分支。**

---

## 5. P0 清单（Phase-3 先做；每条：文件、为什么、不改的代价）

三条 P0 全在执行路径上、失败方向全是不安全侧。它们共享文件，建议按序做但
分开提交。

### P0-1 执行平面继承任务分析（一份资格矩阵）

- **文件：** `src/graph/compile-children.ts`（`CompilableChild`/`FlowNode`
  增可选路由上下文：`family`、`highRisk`、`privacyRequired`、
  `requiredCapabilities`、`agentRole`）；`src/domain/flowchart.ts`
  （`FlowNode` 字段与校验）；`src/track/loop.ts:132-151` 与
  `src/cli/run.ts`（children 路径）把 `assignment.analysis` 传入编译；
  `src/supervisor/flowchart-supervisor.ts:684-692` 把节点上下文传给
  `router.route`。测试落点：`compile-children.test.ts`、
  `flowchart-router.test.ts`、新增「同任务双平面资格矩阵一致」断言（F1 完成
  标志原文）。
- **为什么（本轮数据）：** S2 flowchart 行对 credentials 任务列
  `eligibleModels: ["cheap","premium"]` 而 assign 平面已收窄 `["premium"]`；
  8 条 flowchart 事件全部 `family: unknown`、`highRisk: false`；
  `signals.ts` last-write-wins 使学习信号 family 全量被 `unknown` 覆写。
- **不改的代价：** 高风险执行安全靠 `preferredModel` 排序巧合维持，任何
  preferred 默认值变动都静默破防；`MODEL_ROUTED` 流一半是错的，F2（曝光/结果
  契约）在污染数据上开工；F1 无法关闭。

### P0-2 武装审批门（或停止声称）

- **文件：** `src/graph/compile-children.ts:131`（`approvalRequired` 从
  child/assignment 派生，替换硬编码 false）；`src/track/loop.ts`、
  `src/cli/run.ts` 传 `analysis.highRisk`；产品语义定版写入
  `docs/specs/adaptive-agent-work-loop.md` 或 ADR 附注：`--assume-defaults`
  不豁免高风险人工门。机制侧零新代码：`model-router.ts:287-288` 与
  supervisor 的 WAITING_FOR_USER/question 路径已在，等输入。
- **为什么（本轮数据）：** S2 四个任务 `statusAfterRoute: WAITING_FOR_USER`
  而 run COMPLETED、0 条 `RUN_WAITING_FOR_USER`、`inspect` 报
  `unverified: 0/4`。
- **不改的代价：** 审计轨迹主动撒谎——事件流里的门永远比缺失的门更危险；
  高风险 deploy 在零人类介入下完成而日志暗示相反；`statusAfterRoute` 字段
  对下游永久不可信。

### P0-3 privacy / capability 显式入口，fail-closed

- **文件：** `src/cli/run.ts` + args 解析（如 `--privacy local`、
  `--require-capability vision`，或合同 constraint 映射的第一版）；
  `src/track/primary-split.ts:41-50` 与 `src/routing/assign.ts`
  （`AssignableTask` 增字段，`assignOne` 传 `privacyRequired`/
  `requiredCapabilities` 进 `analyzeTask` options 与 `router.route`）；
  与 P0-1 汇合后同批字段进入 flowchart 节点。测试落点：S3/S4 形态的集成
  测试，期望 exit 1 且 refusal 命名 `privacy-class`/`capability`（拒绝文案
  修复已保证消息可读）。
- **为什么（本轮数据）：** S3「must never leave the local machine」路由到
  cloud、exit 0、0 拒绝；S4 vision 同；直探路由器两者均正确 refuse——纯接线
  缺口。策略点必须一并定版：privacy/capability 只来自显式输入，永不从 prose
  推断。
- **不改的代价：** 用户明示的机密性约束被静默违反——这是隐私面失败
  （P0 privacy 评审的暴露面），不是路由质量瑕疵；且每条事件里
  `privacyRequired: "cloud-general"` 的默认值都在声称一次从未真正发生的
  隐私检查。

---

## 6. P1 清单

| # | 项 | 文件 | 为什么（本轮数据） | 不改的代价 |
|---|---|---|---|---|
| P1-1 | 假阳性高风险：接通 `contractRisk` + `HIGH_RISK_RE` 语境收窄；bump `assign-v3` | `src/track/primary-split.ts`、`src/routing/analyze-task.ts`、`test/unit/routing/analyze-task.test.ts` | 10 探 3 假阳性，每个把 4-child 集群全量打到 premium（约 5×） | 慢性成本流血；`preferPrimary` 噪声污染未来 family 级成本统计；用户无纠错通道 |
| P1-2 | bandit 落盘卫生：fake 路径停写或记录带 executor/evidence-class 出处 | `src/learning/auto-loop.ts:106-108`、`src/learning/bandit-store.ts` | 3 次 fake 运行后 `rewardSum === pulls`（双臂全 1.0），零方差、无出处 | 污染不可逆——未来合法读方无法事后剔除 fake 数据 |
| P1-3 | F-SIM 报告机器可读标注 `qualityEvidence: none-by-construction` | `src/routing/r1-shadow-report.ts`、`src/experiments/comparison-report.ts`、`scripts/measure/simulation-holdout-drive.ts` | CI `[0,0]` 与「测得相等」在工件里不可区分；本轮 campaign 自己就差点踩中 | 每个后续读者都要重读源码才能不误读；「多跑仿真看 R1 好不好」类计划持续显得可行 |
| P1-4 | `MODEL_ROUTED` 增 `decisionPlane: assign\|execution`；`signals.ts` 显式只消费执行平面 | `src/run/events.ts`、`src/run/flowchart-run.ts`、`src/run/coordinator.ts`、`src/learning/signals.ts:139-157` | 8 事件 / 4 任务，消费语义靠事件顺序这一隐藏约定 | F2 曝光契约无法区分曝光与咨询回声；任何新消费者默认踩坑 |
| P1-5 | 无 `--track` 时打印一行「routing/tracking 未启用」 | `src/cli/run.ts` | S5：12 事件 0 `MODEL_ROUTED`，零提示 | 用户以为路由与适应发生了；误报支持成本 |
| P1-6 | `inspect --run` 人类视图渲染路由摘要；`preferredConstraint` 进事件 | `src/cli/inspect.ts`、`src/cli/inspect-format.ts`、`src/run/events.ts`（`routingContextFields`） | 人类视图零路由信息；胜出原因被丢弃、事件流不可恢复 | 审计必须 jq `--json`；「为什么 premium 赢」无解 |
| P1-7 | live-plane 守卫补 topology/bandit 导入检查 | `test/integration/m6/simulation-holdout.test.ts` 或 `test/unit/routing/live-isolation.test.ts` | 守卫只查 `simulation-holdout`/`routing/r1`；`run/supervisor.ts` 在名单上却 import `decideTopology`，真保护在另一处的出现次数断言 | 改一个未被守卫的文件即可无声突破边界 |

P1-2 与 P1-3 成本极低，若 Phase-3 顺手可与 P0 同批完成；其余按表序。

---

## 7. 建议 Phase-3 顺序与交叉验证

**实现序：P0-1 → P0-2 → P0-3 →（P1-2、P1-3 顺手）→ P1-1 → P1-4 → P1-5/6/7。**
P0-1 先行因为 P0-2 的门与 P0-3 的字段都经它开的通道进节点。每条先补失败测试
再改生产代码（plan §8 惯例），语义变更 bump featureVersion。

交叉验证脚本（复用 Phase-1 场景，期望翻转）：

1. 重跑 S2：flowchart 行 `eligibleModels` 应为 `["premium"]`、
   `family: deploy`、`highRisk: true`；事件流出现 `RUN_WAITING_FOR_USER`；
   无审批不得 COMPLETED。
2. 重跑 S3/S4（带新显式旗标）：exit 1，refusal 命名
   `privacy-class`/`capability`。
3. 重跑 10-probe：三个假阳性降级，真阳性（deploy/credentials 动宾语境）保持
   HIGH；`featureVersion` 已 bump。
4. 重跑 S5：出现一行未启用提示，事件流不变。
5. 全套件保持 1186+/0 fail；typecheck/lint 干净；`live-isolation` 与扩展后的
   守卫全绿。

---

## 8. 本报告不建立什么

- 不建立任何真实 provider 行为的证据（本轮全部 fake executor + simulation）。
- 不建立 R1 优于或劣于 R0 的质量结论——测量仪的质量通道为盲。
- 不关闭 Checkpoint F-PROD，不做 Outcome-supported 声称（ADR-005）。
- 不提议把 R1 / bandit / topology 接入 live。

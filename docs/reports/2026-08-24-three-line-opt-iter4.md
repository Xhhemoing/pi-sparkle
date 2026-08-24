# 三线并行与受控自优化:Iteration 4 收口报告

日期:2026-08-24
基线:`cursor/three-line-opt-iter3-cccc` @ `237bf78`(第 0+1+2+3 轮,含 R1–R4、A2、B1、C1、D1、E2、F1、G1、H1)
前轮报告:[第 0 轮](./2026-08-24-three-line-self-opt-feasibility.md)、[第 1 轮](./2026-08-24-three-line-opt-iter1.md)、[第 2 轮](./2026-08-24-three-line-opt-iter2.md)、[第 3 轮](./2026-08-24-three-line-opt-iter3.md)
本轮分支:`cursor/three-line-opt-iter4-ae47`

**结论:无更优解。** 本轮按任务指定的第 4 轮搜查方向对前三轮未点名(或仅粗看)的
全部文件做了穷尽式实际读码——routing 其余 15 文件、experiments 其余 6 文件、
adaptation 其余 7 文件、tracking 其余 7 文件、learning 其余 5 文件,以及
supervisor / graph / evaluation 与三线热路径相交的全部 17 文件——在既有排除表
(X0-1…X0-11、X1-1…X1-6、X2-1…X2-6、X3-1…X3-5)与已落地项之外,**没有任何候选
同时满足本轮提高后的三重门槛**:(a) 理论复杂度或常数因子明确下降;(b) 确定性
仿真可证逐位/契约一致;(c) 现实输入规模上收益不是噪声。全部近似候选逐一记入
本轮排除表(X4-1…X4-9)。**未改任何生产代码;本报告是本轮唯一交付物。**

判定依据(任务规范):「若某文件规模大且有 O(n²) 且输入可达数千,才值得做
理论+仿真组」——本轮扫描发现的所有超线性结构,要么输入规模被设计上界锁死在
个位数/几十级(模型目录 M≤10、flowchart 节点几十、每轮 facts 个位数、rubric
准则个位数),要么其 O(n²) 本身是 fail-closed / 不可变契约的直接后果
(caller-provided 状态全量校验、readonly 快照追加拷贝),消除它必然引入隐藏
状态(X1-1)、改公开契约(X0-4 同类)或削弱防伪(X3-3),不属于保行为优化。

本报告不声称任何 Outcome-supported 改进;Checkpoint F-PROD 仍开放(ADR-005)。
规格强制双路(offline-logit vs offline-prob-add;Beta LCB vs 正态 LCB)全部
保留,本轮一行未碰。前三轮全部排除项维持,未重提任何被否决方案。

---

## 1. 扫描清单与逐文件否决证据

每个文件均为本轮实际打开读码(非复述前轮结论)。「规模上界」指该路径现实
输入的设计上界;凡标注既有排除 ID 的,为该 ID 推理在新文件上的直接适用。

### 1.1 `src/routing/` 其余文件

| 文件 | 否决证据(一行) |
| --- | --- |
| `r0.ts` | `eligibleCandidates` 一遍 map+sort;高风险路径 `eligible.filter(models.find)` 为 O(E×M),M≤10 目录规模,常数因子噪声级(X1-4/X3-1 同理);库面 R0,live 不 import |
| `live-cascade.ts` | `cheapFirstTiers` 已建 `byId` Map;tier 数个位数;live 面(Live=R0 等价硬约束)不敢加任何分配 |
| `outcomes.ts` | `parseOutcomeObservation`/`observationsForR1` 单遍过滤已是 O(N) 下界;`failureClasses` 每调用 5 元数组属一次分配级(门槛明确排除) |
| `catalog-model.ts` | 纯构造函数 + `oneHotDistribution` O(E) 单遍,E=eligible 模型数个位数 |
| `catalog-observed.ts` | 聚合单遍 Map 分桶;`percentile50` 每桶一次 sort,O(n log n)→quickselect 的收益在一次性聚合路径上不可测(X4-3) |
| `cost-calibration.ts` | `calibrateCatalogConfig` O(M×I) 双层扫,M≤10、每次目录加载一次;按版本分组降为 O(I+M) 保序逐位安全但收益噪声级(X4-4) |
| `feature-version.ts` | 纯常量 |
| `analyze-task.ts` | 正则单遍分析,live 面;`HIGH_RISK_RE` 在 `analyzeTask` 与 `familyOf` 各测一次,短文本正则重复属噪声级 |
| `shadow.ts`(bandit shadow) | `step` 的 `decisions: [...state.decisions, d]` 追加拷贝 O(n²) 累计——`ShadowState.decisions` 是 readonly 公开契约,调用方可持旧状态引用;改可变/持久结构即改公开面(X4-2) |
| `policy.ts` | `evaluateCandidate`/`evaluateLiveCandidate` 单遍固定约束矩阵,无重复扫描 |
| `capability-registry.ts` | `registerModel` 全量拷贝 Map,注册次数=目录规模 M≤10;查询全部 O(1)/O(capabilities) |
| `expected-value.ts` | 4 行算术,无循环 |
| `failure-class.ts` | 固定 switch + 3 个正则,单次调用常数 |
| `primary-catalog.ts` | 纯构造,models 数组 ≤2 |
| `public-prior.ts` | `normalizeSource` 每 (catalogId, row) 对做 `aliasMap.find`+`aliases.some`(含 trim/toLowerCase),O(C×R×A);C≤10、R=榜单行数几十、A=别名映射几十——索引化保行为但收益噪声级(X4-5);该路径每次 R0 参考调用一次 |
| `public-prior-store.ts` | 磁盘加载 + 双哈希对账,一次性路径 |
| `offline-types.ts` | 纯 parse 走查 |

(`assign.ts`=X3-1、`propensity.ts`=X3-5、`lin-alg.ts`/`posterior.ts` 数值路径、
`bandit.ts`、`cascade-evidence.ts`、`topology.ts`、`drift.ts`、`r1.ts`、
`r1-shadow-report.ts`、`offline-logit.ts`、`offline-prob-add.ts` 为前轮已裁决/
已落地域,本轮未重提。)

### 1.2 `src/experiments/` 其余文件

| 文件 | 否决证据(一行) |
| --- | --- |
| `attribution-report.ts` | 双估计器薄包装(规格双路),`void sink` 是防写指针证明,无热循环 |
| `evaluation-card.ts` | 纯校验,固定字段 |
| `manifest.ts` | `validateManifest` 已全 Set 单遍 O(N);`stableStringify` 是字节稳定序列化契约(第 3 轮已认定不可动) |
| `plan.ts` | 纯校验;`assertUniqueNonEmpty` 已用 Set |
| `shadow.ts`(M6-T3 candidate runner) | `assign`/`recordOutcome` 每次调用走 `restoreShadowState` 全量校验(O(n),X3-3 fail-closed 契约);`shadowDecisionAt` 从 seed 重放 RNG O(index)——状态对象来自调用方且不含 RNG 位置,增量化=隐藏状态(X1-1)或改公开快照 shape;单次调用渐近已被 restore 的 O(n) 锁定,重放不改变量级(X4-1);n 上界=plan.budget.maxAssignments |
| `gated-comparison.ts` | 共享门(第 0 轮落地);mean/标准误单遍,strip-retry 双跑是 fail-closed 设计 |

(`replay.ts`=H1 已落地、`comparison-report.ts`=X3-2、`canary.ts`=X3-3、
`holdout.ts`/`dataset.ts`/`isolation.ts`/`shadow-compare.ts`/
`simulation-holdout.ts`/`threshold-calibration.ts` 为前轮已裁决域。)

### 1.3 `src/adaptation/` 其余文件

| 文件 | 否决证据(一行) |
| --- | --- |
| `promotion.ts` | parse 走查 + 原子写(temp+rename)+ 文件锁;管理面单次操作,无热循环 |
| `registry.ts` | 全部 Map 索引;`candidatesFor` 线性扫与 `addVersion` 追加拷贝的规模=人工晋升次数(个位数/资源);ledger/rollbackLog 拷贝是不可变契约 |
| `resource.ts` | 纯类型 + 相等谓词,枚举 ≤10 |
| `active-pointer.ts` | CAS 三行,O(1) |
| `approval-profile.ts` | 固定枚举 `includes`,上界 10 |
| `retirement.ts` | registry 三方法转发 |
| `reflection.ts` | `partitionEvidence` 单遍 Set 去重;`isSelfSupported` O(k²) 去重的 k=单条证据的评估者数(个位数);`evaluateProposalShadow` 的 O(n²) 属 X3-3/X4-1 域 |

(`candidate.ts`/`rollback.ts`/`monitor.ts`(X2-5)/`mutate.ts`/`pareto.ts`/
`eval-routing.ts`/`promotion-rules.ts` 为前轮已裁决/已落地域。)

### 1.4 `src/tracking/` 其余文件

| 文件 | 否决证据(一行) |
| --- | --- |
| `isolation.ts` | 2 个纯谓词,O(1) |
| `roller.ts` | `mergeConstraints` 已 Map、`uniqueStrings` 已 Set;`confirmedDecisions.includes` 嵌套的两侧都是单轮决策条数(个位数) |
| `gates.ts` | 固定 6 个硬码 + minors 过滤,minors 为当轮未决小问题(个位数) |
| `combined-score.ts` | 单表达式 |
| `config.ts` | 常量 + 2 个构造器 |
| `types.ts` | parse 走查;`hashAssessment`/`hashSummary` 的 sort 作用于单轮评估字段(维度=6、codes≤9),哈希契约版本化不可动 |

(`analysis.ts`/`from-child.ts`/`prescore.ts`/`turn.ts`/`human-score.ts`(X0-6)
为前轮已裁决域;`index.ts` 为纯 re-export barrel。)

### 1.5 `src/learning/` 其余文件

| 文件 | 否决证据(一行) |
| --- | --- |
| `auto-loop.ts` | 信号收集单遍;`persistSignals` 逐条 append 是审计日志契约;每 run 信号数与事件同阶(数百) |
| `from-episode.ts` | `outcomesFromRoutedRun` 已用 `routes` Map 单遍;`FAMILIES.includes` 上界 8 |
| `learned-routing.ts` | `applyLearnedRouting` 已建 avoided Set;catalogIds/prefer 均 ≤10,live 面 |
| `bandit-store.ts` | `state.arms.includes` 嵌套的 arms=项目模型数(个位数);全量重建 state 是文件锁内一次性持久化 |
| `attribution.ts` | 边界排序上界 8;`findNegativeControlMarker` O(5×cluster) 单遍 |

(`diagnostics.ts`/`patterns.ts`(X2-6)/`signals.ts`/`signatures.ts`/
`task-success.ts` 为前轮已裁决域。)

### 1.6 `src/supervisor/`、`src/graph/`、`src/evaluation/`(与三线热路径的交集)

| 文件 | 否决证据(一行) |
| --- | --- |
| `supervisor/model-router.ts` | live 路由(Live=R0 等价硬约束);`route()` 每次建 catalogIds Set + `inPolicy` O(M×A) 过滤,M≤10、A=allowedModels 个位数(X3-1 同理) |
| `supervisor/ledger.ts` | `isDuplicateFact` 线性扫 O(F);F=run 级累计事实(数百上界),每轮新事实个位数;Set 化收益噪声级且属 live 执行面(X4-7) |
| `supervisor/flowchart-supervisor.ts` | `propagate()` fixpoint 最坏 O(N²×E)、`leaseReadyNodes` 每节点重算 `computeStatus()` O(N)——N=flowchart 节点数(authored 图,几十级上界,maxConcurrentNodes=4);增量 ready-set 需跨 8 个公开方法维护失效,live 执行面不动(X4-8) |
| `supervisor/flowchart-snapshot.ts` | 纯校验走查;`eligibleSet` 已用 Set(L211),其余为 Object.entries 单遍 |
| `supervisor/flowchart.ts` | 纯 re-export barrel |
| `graph/compile-children.ts` | Map+Set 单遍;children 为用户 authored 规格(几十级) |
| `graph/judge.ts` | `evidenceIds.filter(includes)` O(E²) 的 E=单任务证据数(个位数) |
| `graph/readiness.ts` | 拓扑序单遍 |
| `graph/validate.ts` | Kahn 的 `queue.shift()` O(n) 使拓扑排序 O(n²)——任务图几十级;索引指针化 FIFO 序逐位相同但收益噪声级(X4-6) |
| `evaluation/adapters.ts` | 纯类型 |
| `evaluation/check-adapter.ts` | `changeSetsEqual` 已双 Set;单命令结果校验 |
| `evaluation/delivery-adapter.ts` | 固定分支判定,无循环 |
| `evaluation/diff-adapter.ts` | 4 个 length 检查 |
| `evaluation/evaluator.ts` | rubric 准则单遍 map + 3 个聚合谓词,准则数个位数 |
| `evaluation/ownership.ts` | `classifyDiffScope` 内 `changeSet.includes(path)` O(P×C)——Set 化=一次分配级改动,门槛明确排除(X4-9);P/C=episode 变更文件数(几十~数百) |
| `evaluation/precedence.ts` | 3 元固定表 find |
| `evaluation/types.ts` | 纯类型 |

## 2. 近似候选的三重门槛裁决(为何全部不达标)

本轮无任何候选进入理论+仿真组。以下为最接近门槛的五个结构与其致命项:

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| M6-T3 shadow runner 的 O(n²)(restore 全量校验 + RNG 从头重放) | ✗ 单次调用渐近被 fail-closed restore 的 O(n) 锁定,消除重放不改变量级 | ✗ 增量化需隐藏状态(X1-1)或改公开快照 shape | —(n 上界=plan 预算) | X4-1 |
| bandit shadow `decisions` 追加拷贝 O(n²) | ✓ 可变 push 为 O(1) | ✗ `readonly decisions` 公开契约,旧状态引用会被别名污染 | — | X4-2 |
| Kahn `queue.shift()` O(n²) | ✓ 指针化 O(n) | ✓ FIFO 序逐位相同 | ✗ 任务图几十级,shift 实测微秒级 | X4-6 |
| `isDuplicateFact`/`classifyDiffScope`/`normalizeSource` 线性 `includes`/`find` | ✓ Set/Map 化 | ✓ 成员判定同值 | ✗ 全部输入规模个位数~数百,属「个位数线性扫描 / 一次分配」明示排除项 | X4-5/-7/-9 |
| `percentile50` sort→quickselect;calibrate 分组索引 | ✓ | ✓(中位数为序统计量,同值) | ✗ 一次性聚合/加载路径,非热路径 | X4-3/-4 |

对比第 1–3 轮赢家的共性(A2/B1: O(E×N)→O(N) 且 N=20000 实测 146×;D1/E2/F1:
O(draws×p²×rows) 字符串比较且实测 4.9×;H1: O(N×E) 且 N 无上界实测 6.9×):
它们都同时具备「无上界输入 × 超线性 × 契约内可消除」。本轮扫描域内不存在
第三个条件成立的实例——所有超线性都被契约(fail-closed/不可变/公开面)保护,
所有契约内可消除的都被规模上界压到噪声级。搜索空间在此收敛。

## 3. 全局排除表(Iteration 4 新增)

第 0–3 轮 X0-1…X0-11、X1-1…X1-6、X2-1…X2-6、X3-1…X3-5 全部维持。本轮新增:

| ID | 方案 | 排除原因 |
| --- | --- | --- |
| X4-1 | `experiments/shadow.ts`(M6-T3)`shadowDecisionAt` RNG 位置缓存/增量重放;restore「已校验」记忆化 | 状态对象来自调用方且不含 RNG 位置:增量化=隐藏状态(X1-1 变体)或改公开快照 shape;fail-closed 全量 restore(X3-3)已使单次调用为 O(n),消除重放不改渐近 |
| X4-2 | `routing/shadow.ts`(bandit)`decisions` 追加拷贝改可变 push 或持久链表 | `ShadowState.decisions` 为 readonly 公开契约,调用方可持旧状态;可变化引入别名污染,持久结构改公开类型(X0-4 同类) |
| X4-3 | `catalog-observed.ts` `percentile50` sort→quickselect | 中位数为序统计量、同值可证,但路径为一次性聚合,收益不可测 |
| X4-4 | `cost-calibration.ts` `calibrateCatalogConfig` 按 (model, version) 分组索引 | O(M×I)→O(I+M) 保序逐位安全,但 M≤10 且每次目录加载只跑一次,噪声级 |
| X4-5 | `public-prior.ts` `normalizeSource`/`aliasesMatch` 别名索引化(预建 lowercase Map) | 榜单行数几十、目录 ≤10、别名映射几十;索引化保行为但收益噪声级 |
| X4-6 | `graph/validate.ts` Kahn `queue.shift()` 换读指针 | FIFO 序逐位相同,但任务图节点几十级,收益噪声级 |
| X4-7 | `supervisor/ledger.ts` `isDuplicateFact` 换 `key\|value` Set 索引 | 每轮新事实个位数、run 级累计数百;live 执行面,收益噪声级 |
| X4-8 | `flowchart-supervisor.ts` `propagate` 增量 ready-set / `leaseReadyNodes` 缓存 `computeStatus` | N=几十级 authored 图;增量集需跨 8 个公开方法维护失效,live 执行面复杂度代价远超收益 |
| X4-9 | `evaluation/ownership.ts` `classifyDiffScope` 的 `changeSet` Set 化 | 一次分配级改动,门槛明示排除;episode 变更集几十~数百 |

## 4. 未做的事(与前轮一致)

1. 未改任何生产代码;本轮交付物仅本报告。
2. 不动 live 面;R1/bandit/topology 仍不接 live;两套归因仍只出报告。
3. 不动任何阈值与版本化数值行为。
4. 不修 `offline-prob-add.ts` `diagnose()` 观察项(Frozen,维持只记录)。
5. 不声称 Outcome-supported;`canCloseProductionCheckpointF: false` 原样。
6. 维持前三轮全部排除,未重提任何被否决方案;第 1–3 轮仿真脚本
   (`scripts/iter1/2/3-equivalence-sim.ts`)保留原样作回归资产,本轮无新增
   仿真脚本(无候选进入理论+仿真组)。

## 5. 测试

本轮零代码改动,无需重跑套件;基线 `237bf78` 已由第 3 轮全量验证
(`pnpm test` 1157 pass / 0 fail / 1 skipped;三个 equivalence sim 全绿)。

## 6. 收口声明

在排除表(X0-1…X0-11、X1-1…X1-6、X2-1…X2-6、X3-1…X3-5、X4-1…X4-9)与已落地
八项(R1–R4、A2、B1、C1、D1、E2、F1、G1、H1)之外,`src/tracking`、`src/run`、
`src/supervisor`、`src/adaptation`、`src/learning`、`src/routing`、
`src/experiments`、`src/graph`、`src/evaluation` 的三线/自优化相关面已全部
实际读码裁决完毕:**找不到理论+仿真都优于现状且保行为的方案。**
若后续要推翻本结论,须先对相应排除 ID 写出推翻证据(输入规模上界失效、
契约放宽、或新代码引入新的无上界超线性结构)。

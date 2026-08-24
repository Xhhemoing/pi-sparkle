# 三线并行与受控自优化:Iteration 3 优化报告

日期:2026-08-24
基线:`cursor/three-line-opt-iter2-2c5c` @ `dc5e680`(第 0+1+2 轮,含 R1–R4、A2、B1、C1、D1、E2、F1、G1)
前轮报告:[第 0 轮](./2026-08-24-three-line-self-opt-feasibility.md)、[第 1 轮](./2026-08-24-three-line-opt-iter1.md)、[第 2 轮](./2026-08-24-three-line-opt-iter2.md)
本轮分支:`cursor/three-line-opt-iter3-cccc`

**结论:找到更优解。** 本轮在离线重放面(M5-T3 replay harness,offline-only)落地
一项逐位保行为的复杂度优化:`replayPolicy` 的排除过滤从对每个 episode 哈希做
`manifest.exclusions.includes(h)` 线性扫描(O(N×E) 字符串比较)改为循环外一次
`new Set(manifest.exclusions)` + `Set.has`(O(N+E))。N=20000 / E=10000 的确定性
夹具上实测中位耗时 610.8 ms → 88.3 ms(≈6.9×),参考实现每次重放
150,005,000 次成员比较被消除;71351 项逐位一致性检查全绿。

本报告不声称任何 Outcome-supported 改进;Checkpoint F-PROD 仍开放(ADR-005)。
算法语义、阈值、晋升条件、路由决策、公开导出、CLI、事件 schema、CAS 语义均未变。
第 0/1/2 轮排除表(X0-1 … X0-11、X1-1 … X1-6、X2-1 … X2-6)全部维持有效,本轮
未触碰任何被排除项。**规格强制双路(offline-logit vs offline-prob-add;
Beta LCB vs 正态 LCB)全部保留,本轮一行未碰其语义。**

---

## 1. 扫描过的候选列表

按任务给出的第 3 轮搜查方向逐一实际读代码(不是复述前轮结论);凡有 2+
相似方案的组,做了理论 + 仿真对比(见 §2):

| # | 位置 | 发现 | 处置 |
| --- | --- | --- | --- |
| S1 | `experiments/replay.ts` `replayPolicy` | 排除过滤 `[...manifest.episodeHashes].filter((h) => !manifest.exclusions.includes(h))`:每个哈希对 exclusions 做 O(E) 线性扫描,总计 O(N×E) 字符串比较;数据集规模无上界(隐私/污染排除随数据集增长),同文件 `validateManifest` 已用 Set 做同类成员判定 | **采纳**(H 组,赢家 H1) |
| S2 | `routing/propensity.ts` | 单遍 min/max/权重收集 + 两个对 weights 的 reduce;logs 条数与单份报告 action 数同阶(数百),合并 reduce 进主循环逐位安全但收益噪声级 | 否决(X3-5) |
| S3 | `routing/lin-alg.ts` `solveSymmetric` | 标准部分主元高斯消元;任何数值路径改动(Cholesky、分块、跳零策略变化)不逐位一致 | 无更优(X1-3/X2-3 同理),不动 |
| S4 | `routing/cascade-evidence.ts` | 纯决策函数,固定小枚举,无重复扫描 | 无更优,不动 |
| S5 | `routing/topology.ts` | `decideTopology`/`decideAfterFailedReflection` 为常数规模决策;`ESCALATION_LADDER.indexOf` 上界 6 | 无更优,不动 |
| S6 | `routing/bandit.ts` | `selectArm` 贪心 O(arms)、`recordReward` 全量拷贝——arm 数个位数、离线存储(第 1 轮 S6 结论用当前代码复核成立) | 无更优,不动 |
| S7 | `routing/assign.ts` `assignOne`/`preferredFrom` | 每任务重算 `catalogIds.filter(... models.some ...)`(O(M²))与 `[...models].sort`(O(M log M));M ≤ ~10 且这是 **live 面**(Live=R0 等价硬约束),每任务主导成本在 `analyzeTask` 正则分析 | 否决(X3-1) |
| S8 | `routing/drift.ts` | `observe` 对窗口 8 的 filter;X2-5 的路由面同类,噪声级 | 无更优,不动 |
| S9 | `experiments/holdout.ts` | 审计追加拷贝是不可变契约(第 2 轮 S10 复核成立) | 无更优,不动 |
| S10 | `experiments/canary.ts` | 每次 `assign`/`recordOutcome`/`cancel` 走 `restoreCanaryState` 全量校验(O(assignments)),整个 canary O(n²)——这是 fail-closed 设计:状态对象来自调用方,可能被外部改动,增量化/「已校验」记忆化是隐藏状态(X1-1 变体)且削弱防伪 | 否决(X3-3) |
| S11 | `experiments/dataset.ts` | 验证已用 Set/Map 单遍;`rotateHoldout` 两次 validate 分别针对输入与输出流形,均必需 | 无更优,不动 |
| S12 | `experiments/isolation.ts` | `isInside` 每次 `path.resolve`;roots 数与 episodes 同阶但只在构造/断言时调用,无重复扫描结构 | 无更优,不动 |
| S13 | `experiments/comparison-report.ts` `computeComparisonReport` | 1 遍验证 + 1 遍 delta/family + 4 个均值 reduce = 6 遍线性扫描;合并为单遍逐位安全(各累加器保序)但仍是 O(N)、常数因子噪声级,且四个命名 reduce 与后面的 evaluation-card 对账错误消息一一对应,合并降低可读性 | 否决(X3-2) |
| S14 | `experiments/threshold-calibration.ts` | 3 个固定阈值 × O(N) 计数;阈值集是版本化输出字段(`thresholds` 字面量),单遍化收益噪声级 | 无更优,不动 |
| S15 | `adaptation/pareto.ts` | O(n²) 支配过滤是 Pareto 前沿定义(第 2 轮 S11 复核成立) | 无更优,不动 |
| S16 | `adaptation/mutate.ts` | 一次性文本操作(match/split/join),无热循环 | 无更优,不动 |
| S17 | `adaptation/monitor.ts` | `observe` 每次重冻结基线 `freezeBaseline(observations.slice(0, windowSize))`;windowSize 默认 8,X2-5 用当前代码复核成立 | 维持排除(X2-5) |
| S18 | `adaptation/candidate.ts`/`rollback.ts` | 校验走查、固定小枚举 `includes`;`RollbackLog.list()` 拷贝是不可变契约 | 无更优,不动 |
| S19 | `tracking/from-child.ts`/`prescore.ts`/`analysis.ts`/`turn.ts` | 单遍、6 个固定维度;`includes` 嵌套上界是 requiredChecks/constraints/writePaths 条数(个位数)(第 2 轮 S14 复核成立);analysis 只 createCandidate | 无更优,不动 |
| S20 | `tracking/human-score.ts` | `extractTenPoint` 每次 `new RegExp(source, "gi")`——共享 /g 正则的 lastIndex 状态风险,X0-6 用当前代码复核成立 | 维持排除(X0-6) |
| S21 | `learning/diagnostics.ts` | 单遍 Map 分组;`unique` 的 O(k²) 上界是 kind 种类数(≤3) | 无更优,不动 |
| S22 | `learning/patterns.ts` | 贪心聚类 O(n²) 是算法定义;`averageSimilarity` 与 `clusterSignatures` 仅共享 (seed, j) 对,X2-6 用当前代码复核成立 | 维持排除(X2-6) |
| S23 | `learning/task-success.ts`/`signatures.ts` | 纯构造函数与成对比较,无热循环 | 无更优,不动 |
| S24 | `run/child-tracking.ts` | 薄编排;事件扫描成本在 `episodeIdFromEvents`/`nextTrackingSeq`/`applyTrackingGate`,属 X0-4/X2-4 已排除域(结构用当前代码复核:两个 `find` + `currentGateStatus` 三遍扫描仍在、单 run 事件数百) | 维持排除(X0-4/X2-4) |
| S25 | `run/flowchart-executor.ts` | 事件流消费单遍;不改调度语义,无重复扫描 | 无更优,不动 |
| S26 | `routing/posterior.ts` `betacf`/`lnGamma` | `betacf` 的 qab/qap/qam 已在循环外(C1 后复核);`lnGamma` 每次调用重建 9 元 Lanczos 系数数组——提升到模块级不改任何浮点运算(常量逐位相同),**理论安全但收益不可测**:C1 后每个分位数仅 3 次 lnGamma,成本被 80 次二分 × betacf(≤200 迭代)完全淹没,性能夹具上差异在计时噪声内 | 否决(X3-4) |
| S27 | 第 1/2 轮仿真脚本处置 | `scripts/iter1-equivalence-sim.ts`、`scripts/iter2-equivalence-sim.ts` 保留原样作回归资产;本轮新增独立 `scripts/iter3-equivalence-sim.ts` | 保留 + 新增 |

**第 2 轮观察项复核(用当前代码,非复述)**:`offline-prob-add.ts` `diagnose()`
的 project 循环过滤 `key.endsWith(\`|${lastSegment(input, key)}\`)` 对任何含 `|`
的键仍恒为真(`lastSegment` 取最后一段,任何含 `|` 的键必以 `|` + 最后一段结尾)
——Frozen formula 头部声明仍在,修改会改变诊断输出,**维持只记录不改**。

## 2. 相似方案组:理论对比 + 仿真检测

本轮唯一采纳组存在 2+ 个可行做法,按规范做了理论 + 仿真裁决。仿真载体:
`scripts/iter3-equivalence-sim.ts`(独立脚本,不改生产语义;内嵌第 2 轮
`dc5e680` 的 `replayPolicy` 实现原文作为冻结对照组;`createSeededRng`、
`assertIsolatedOutput`、`manifestHash`、`stableStringify`、`hash32`、
`DomainValidationError` 本轮未变,从生产导入,使被测差异恰好等于 H1)。

### 2.1 H 组:replayPolicy 排除过滤的成员判定

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| H0 现状 | filter 谓词内 `manifest.exclusions.includes(h)`:命中平均扫 E/2、未命中扫满 E;总计 O(N×E) 字符串比较。重放数据集 N 无上界,exclusions(隐私/污染排除)与数据集同阶增长 | 被更优解取代 |
| H1 循环外 `const excludedHashes = new Set(manifest.exclusions)`,谓词改 `!excludedHashes.has(h)` | **保行为论证**:`Array.prototype.includes` 与 `Set.prototype.has` 都使用 SameValueZero 语义(对字符串、NaN、±0 全部一致),重复排除项只影响 Set 存储不影响成员判定 ⇒ 谓词对每个元素返回相同布尔值 ⇒ `orderedHashes` 内容与顺序逐元素相同 ⇒ 下游 rng 消费序、`policy.select` 调用序、actions 构造、`rerunHash` 全部不变。整个路径无浮点运算参与过滤,浮点(propensity)只来自 policy 回调且调用序不变 ⇒ 逐位平凡一致。Set 与函数调用同生命周期、构造后只读,无隐藏状态;同文件 `validateManifest` 已是同一习语 | **赢家** |
| H2 模块级/WeakMap 按 manifest/exclusions 引用缓存 Set | X1-1 同理:隐藏全局状态、数组变异 ⇒ 陈旧缓存;且每次调用传入的 manifest 通常是新对象,命中率趋零 | 淘汰(X1-1 覆盖,不另立 ID) |
| H3 反转循环(对 exclusions 建索引删除法/双指针) | 需要先排序或改变遍历结构,输出顺序论证复杂化;H1 已达 O(N+E) 下界 | 被 H1 取代(非排除) |

### 2.2 仿真结果

```text
scenario 1 (replayPolicy H1 success paths): 64 cases compared
  — 60 个随机夹具(N 1–200,随机排除率、含不存在于 universe 的排除项、
    随机 seed、cache 有/无、5 种 policy 变体、每 episode 消费 1 次 rng)
    + 无排除 + 全排除(零 action)+ episodeHashes 含重复(replayPolicy 不调
    validateManifest,两侧须同样处理)+ exclusions 含重复项
scenario 2 (replayPolicy H1 error paths): 3 cases compared
  — manifest 引用缺失 episode / policy 选中资格集之外 / 输出根与原工作区
    重叠,错误类与消息逐字一致
perf fixture (N=20000, E=10000):
  reference 610.8 ms -> current 88.3 ms (6.9x)
reference membership comparisons per replay: 150,005,000
  (current: one Set build of 10,000 inserts + 20,000 O(1) lookups)

ALL EQUIVALENCE CHECKS PASSED (71351 bitwise checks)
```

全部 71351 项检查为 `Object.is` 逐位比较(actions 的 episodeHash/modelId/
propensity/eligible/propensities 全字段、manifestHash、rerunHash、
policyVersion、seed)及错误类名/消息逐字比较。当前实现剩余耗时(88.3 ms)
主要是 `rerunHash` 的 `stableStringify`(10000 个 action 的规范序列化),
属字节稳定重放契约本身,不可动。

## 3. 重构前 vs 重构后逻辑对比

### 3.1 `src/experiments/replay.ts`

**前**:`replayPolicy` 第 95 行
`const orderedHashes = [...manifest.episodeHashes].filter((h) => !manifest.exclusions.includes(h));`
——每个哈希对 exclusions 数组线性扫描。

**后**:filter 前一行 `const excludedHashes = new Set(manifest.exclusions);`,
谓词改为 `!excludedHashes.has(h)`,附注释说明 SameValueZero 等价与 rng 消费序
不变。`replayPolicy` 公开签名、`ReplayResult` 字段、错误消息、
`createSeededRng`/`replayCacheKey`/`assertIsolatedOutput` 导出逐字未动。

### 3.2 未触碰

`propensity.ts`、`lin-alg.ts`、`cascade-evidence.ts`、`topology.ts`、
`bandit.ts`、`assign.ts`、`drift.ts`、`posterior.ts`、experiments 其余六文件、
adaptation 五文件、tracking 五文件、learning 四文件、`child-tracking.ts`、
`flowchart-executor.ts`、`gate-apply.ts`:一行未改(理由见 §1)。两套归因
估计器与双 LCB 都保留,`attribution-report.ts` 的双路调用未动。

## 4. 性能 / 可维护性

| 项 | 第 2 轮后 | Iteration 3 后 |
| --- | --- | --- |
| `replayPolicy` 排除过滤 | O(N×E) 字符串比较 | O(E) Set 构建 + O(N) 常数查找 |
| 实测(N=20000, E=10000,中位) | 610.8 ms | 88.3 ms(≈6.9×) |
| 参考实现计数器(单次重放) | 150,005,000 次成员比较 | 10,000 次 insert + 20,000 次 has;剩余主导成本为 `stableStringify` 规范序列化(字节稳定重放契约,不可动) |
| 心智模型 | filter 谓词里藏着 O(E) 扫描 | 「索引一次、只读复用」显式,与同文件 `validateManifest` 的 Set 习语一致 |

live 面零变化:`replayPolicy` 仅被 m5 重放测试与离线评测链引用,生产代码只
import `replayCacheKey`/`createSeededRng`(本轮未动);
`test/unit/routing/live-isolation.test.ts` 继续看护。

## 5. 全局排除表(Iteration 3 新增)

第 0 轮 X0-1 … X0-11、第 1 轮 X1-1 … X1-6、第 2 轮 X2-1 … X2-6 全部维持。
本轮新增:

| ID | 方案 | 排除原因 |
| --- | --- | --- |
| X3-1 | `assign.ts` `assignOne`/`preferredFrom` 每任务 catalog 重过滤与排序换 Map/提升 | M ≤ ~10,常数因子在噪声级(X1-4 同理);且这是 live 面(Live=R0 等价硬约束),每任务主导成本在 `analyzeTask` 文本分析,无仿真可测收益 |
| X3-2 | `computeComparisonReport` 六遍线性扫描合并单遍 | 仍是 O(N)、常数因子噪声级;四个命名 reduce 与 evaluation-card 对账错误消息一一对应,合并显著降低可读性(X2-4 同理) |
| X3-3 | canary/shadow runner 每次调用的全量 restore 校验增量化或「已校验」记忆化 | 全量校验是 fail-closed 契约(状态对象来自调用方、可能被外部改动);记忆化是隐藏状态(X1-1 变体)且削弱防伪 |
| X3-4 | `lnGamma` Lanczos 系数数组提升到模块级 | 不改浮点路径、理论安全,但 C1 后每个分位数仅 3 次 lnGamma,成本被 betacf 完全淹没,无仿真可测收益 |
| X3-5 | `propensity.ts` 两个权重 reduce 并入主循环 | 逐位安全(各累加器保序)但 logs 数与单份报告同阶(数百),噪声级 |

被更优解取代(非排除):H0/H3。H2(模块级缓存)由 X1-1 的既有理由覆盖,
不另立 ID。

## 6. 测试命令与结果

```bash
# 环境:Node 22.22.2(满足 engines >=22.19.0),pnpm 10.17.1
pnpm typecheck   # 通过
pnpm lint        # 通过
pnpm build       # 通过

# 仿真/确定性检测(规范要求的对照实验):
npx tsx scripts/iter3-equivalence-sim.ts
# → scenario 1 (replayPolicy H1 success paths): 64 cases compared
# → scenario 2 (replayPolicy H1 error paths): 3 cases compared
# → perf fixture: reference 610.8 ms -> current 88.3 ms (6.9x)
# → ALL EQUIVALENCE CHECKS PASSED (71351 bitwise checks)

# 第 1/2 轮回归资产(保留原样):
npx tsx scripts/iter1-equivalence-sim.ts   # 仍全绿
npx tsx scripts/iter2-equivalence-sim.ts   # 仍全绿(6596 bitwise checks)

# 相关套件:
npx tsx --test "test/unit/tracking/**/*.test.ts" "test/unit/adaptation/**/*.test.ts" \
  "test/unit/learning/**/*.test.ts" "test/unit/routing/**/*.test.ts" \
  "test/unit/experiments/**/*.test.ts" "test/integration/track/**/*.test.ts" \
  "test/integration/m6/**/*.test.ts" "test/integration/m5/**/*.test.ts" \
  "test/acceptance/adaptive-loop.test.ts"
# → 498 pass / 0 fail

pnpm test        # 全量:1157 pass / 0 fail / 1 skipped
```

未修改任何测试文件。

## 7. 明确未做的事

1. 不动 live 面任何文件;R1/bandit/topology 仍不接 live;两套归因仍只出报告。
2. 不动阈值(ATTRIBUTION_EFFECT 0.1、QUALITY_FLOOR 0.55、minPairedSamples 5、
   maxCostIncreaseUsd 0、minEffectiveSampleSize 2、二分 80 次等全部版本化数值)。
3. 不修 `offline-prob-add.ts` `diagnose()` 的疑似过严 project 过滤(§1 复核项)
   ——行为改动超出本任务授权,维持第 2 轮的只记录不改。
4. 不声称 Outcome-supported;`canCloseProductionCheckpointF: false` 原样。
5. 维持第 0/1/2 轮全部排除(X0-1 … X0-11、X1-1 … X1-6、X2-1 … X2-6),
   未重提任何被否决方案。

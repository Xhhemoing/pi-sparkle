# 三线并行与受控自优化:Iteration 1 优化报告

日期:2026-08-24
基线:`cursor/three-line-self-opt-audit-e43a` @ `fb71432`(第 0 轮,含 R1–R4 保行为重构)
第 0 轮报告:[2026-08-24-three-line-self-opt-feasibility.md](./2026-08-24-three-line-self-opt-feasibility.md)
本轮分支:`cursor/three-line-opt-iter1-4b0e`

**结论:找到更优解。** 本轮在影子/离线面(shadow report / simulation holdout)落地
一组三项、逐位保行为的算法与常数因子优化,把 `buildR1ShadowReport` 的观测处理
复杂度从 O(E×(N+M)) 降到 O(N + E×M),并把 beta 分位数 LCB 的每次求值从
240 次 lnGamma 降到 3 次。E=200、N=20000 的确定性夹具上实测中位耗时
471.7 ms → 3.2 ms(≈146×),4390 项逐位一致性检查全绿。

本报告不声称任何 Outcome-supported 改进;Checkpoint F-PROD 仍开放(ADR-005)。
算法语义、阈值、晋升条件、路由决策、公开导出、CLI、事件 schema、CAS 语义均未变。
第 0 轮排除表(X0-1 … X0-11)全部维持有效,本轮未触碰任何被排除项。

---

## 1. 扫描过的候选列表

按任务给出的搜查方向逐一扫描(证据 = 代码阅读 + 复杂度推演;凡有 2+ 相似方案的
组,做了理论 + 仿真对比,见 §2):

| # | 位置 | 发现 | 处置 |
| --- | --- | --- | --- |
| S1 | `r1-shadow-report.ts` episode 循环 | 每 episode 对共享观测做 O(N) 拷贝(`[...shared, ...own]`)+ O(N) 过滤(`observationsForR1`,routeR1 内)+ O(N) 分组(`groupObservationsByKey`)。第 0 轮 R4 只消除了单次 routeR1 内的每模型重扫,episode 间重复未动 | **采纳**(A 组,赢家 A2) |
| S2 | 跨 episode 相同 key 的后验 + LCB 重算 | 共享观测 + 固定 nowMs/config 下,同 (taskFamily, role, modelVersion, featureVersion) 键的 `updatePosterior` + `lowerConfidenceBound` 在每个 episode 里逐位重算;beta 分位数是数值热点(80 次二分 × betacf ≤200 次迭代) | **采纳**(B 组,赢家 B1) |
| S3 | `posterior.ts` `inverseRegularizedIncompleteBeta` | 80 次二分迭代内每次重算 `lnBeta = lnGamma(a)+lnGamma(b)−lnGamma(a+b)`——a、b 在整个二分过程不变,x 无关项重复 240 次 lnGamma | **采纳**(C 组,赢家 C1) |
| S4 | `r1.ts` `cheaperEstimate`/`costOf`/`tierIndex` | reduce 内线性 `candidates.find` / `fallbacks.indexOf`;M ≤ ~10 | 否决(X1-4) |
| S5 | `experiments/shadow-compare.ts` vs `r1-shadow-report.ts` | 两处都调 routeR1,但契约不同:单 episode agree/disagree vs 配对成本报告。不是重复实现 | 否决(X1-5) |
| S6 | `routing/bandit.ts` | `selectArm` 贪心扫描 O(arms),`recordReward` 全量拷贝 records——arm 数个位数,离线存储 | 无更优,不动 |
| S7 | `routing/live-cascade.ts` | `cheapFirstTiers` 排序比较器内 `byId.get`——tier 数个位数,live 面不敢加任何分配 | 无更优,不动 |
| S8 | `tracking/roller.ts`/`gates.ts`/`combined-score.ts` | 单遍 + Map/Set,分配量与输入同阶;无重复扫描 | 无更优,不动 |
| S9 | `learning/signals.ts`/`attribution.ts`/`from-episode.ts`/`auto-loop.ts` | 事件收集单遍 + 五个 taskId Map;第 0 轮 R3 后无剩余逐字重复;`attributeToBoundary` 排序仅对 ≤8 种边界 | 无更优,不动 |
| S10 | `adaptation/`(promotion-rules 之外) | 第 0 轮 R2 后 registry↔promotion 无环;`eval-routing.ts` 已走共享 `gatedComparisonReport`;无重复门 | 无更优,不动 |
| S11 | 事件扫描局部索引(gate-apply 之外) | `from-episode.ts`/`signals.ts` 已用 Map 单遍;gate-apply 增量索引维持 X0-4 排除 | 维持排除 |
| S12 | 跨 episode 记忆化**整个** routeR1 决策(按 episode 特征去重) | 决策依赖完整 RouteRequest(经 r0 的成本/资格矩阵),按 (family, role) 去重会漏掉 request 差异,需引入脆弱的等价键 | 否决(X1-6) |
| S13 | `offline-logit.ts` / `offline-prob-add.ts`;Beta LCB vs 正态 LCB | 规格强制双路(层级归因两法、双 LCB 只出报告/对照),不属于「相似方案二选一」 | 规格双路,必须都留 |

## 2. 相似方案组:理论对比 + 仿真检测

三个组各自存在 2+ 个可行做法,按第 4 条新规范做了理论 + 仿真裁决。
仿真载体:`scripts/iter1-equivalence-sim.ts`(独立脚本,不改生产语义;内嵌
第 0 轮 `fb71432` 的实现原文作为冻结对照组)。

### 2.1 A 组:消除 shadow 报告中共享观测的每 episode 重复处理

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| A0 现状 | 每 episode O(N) 拷贝+过滤+分组;E 个 episode 共 O(E×N) 行扫描与字符串键构造 | 被更优解取代 |
| A1 引用键 WeakMap 记忆化(`observationsForR1`/分组结果按数组引用缓存) | 签名零改动,但:① `[...shared, ...own]` 每次产生新引用,缓存永不命中,必须连带改调用方;② 模块级隐藏状态,TS 的 readonly 不在运行时强制,数组被外部变异 → 陈旧缓存 → 错误路由决策,恰好落在要求 fail-closed 确定性的代码上;③ 缓存生命周期与调用方脱钩,不可审计 | **淘汰(X1-1)** |
| A2 显式预处理索引:`prepareR1Observations` 一次过滤+分组;`R1Input.observations` 收窄为 `readonly OutcomeObservation[] \| PreparedR1Observations` 联合;`mergePreparedR1Observations` 处理 per-episode 冻结观测 | 数据流显式、无隐藏状态;联合类型保证「恰好一个观测来源」,不存在 raw 与 prepared 不一致的输入;既有调用方(数组)不改一行即兼容(加宽输入位置类型是增量兼容);routeR1 内单一消费路径(raw 数组只是先过同一个 builder) | **赢家** |
| A3 新增第二个公开函数 `routeR1Prepared` | 两个公开入口点,违反「不留两套平行实现」精神;调用方需自行保证两入口行为一致 | **淘汰(X1-2)** |

**保行为论证**(A2):过滤与分组对拼接可交换——
`group(filter([...shared, ...own]))` 的每键子序列 =「shared 中该键行(保序)+
own 中该键行(保序)」,`mergePreparedR1Observations` 精确按 base-在前-extra-在后
拼接每键分组,故 `updatePosterior` 的加权累加顺序逐位不变。own 为空或全部不可入
(admissible=0)时直接复用 base 索引(分组内容相同)。

**仿真结果**:场景 2(500 个随机 routeR1 用例 × raw/prepared/复用/指纹失效
4 路)2000 项逐位一致;场景 3(60 份随机 shadow 报告,含 per-episode 观测、
UNOBSERVED 混合、高风险请求、R0 拒绝、fail-closed 抛错路径)报告与错误消息
全部逐位/逐字一致。

### 2.2 B 组:跨 episode 相同 key 的后验/LCB 重算

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| B0 不缓存(只做 A2) | 每 episode 仍付 M 次 `updatePosterior`(最坏单键聚集时 O(N))+ M 次 beta 分位数(数值热点);共享观测 + 固定 nowMs/config 下这些是逐位相同的重复计算 | 被更优解取代 |
| B1 prepared 索引内 per-key 估计备忘录,命中条件 = key + 指纹(nowMs + 全部 6 个 PosteriorConfig 字段)完全相等 | 估计是 (分组, config, nowMs) 的纯函数;分组在索引构造后不再变(merge 产生新索引、新空缓存);指纹守卫使任何输入变化都强制重算 ⇒ 与重算逐位一致。缓存作用域 = 单个 prepared 索引(单份报告),无跨调用泄漏。同一次 routeR1 内同版本模型共键也自然去重 | **赢家** |
| B3 WeakMap 按分组数组引用缓存 | 同 A1 ②③:隐藏模块级状态 + 变异风险;且仍需 config/nowMs 入键 | **淘汰(X1-1)** |

**仿真结果**:场景 2 显式覆盖「同一 prepared 索引复用(备忘录热)」与
「同索引 + 不同 nowMs/config(指纹失效强制重算)」两路,均与冻结参考逐位一致。

### 2.3 C 组:beta 分位数 LCB 的二分循环内重复计算

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| C0 现状 | `regularizedIncompleteBeta` 每次调用重算 lnBeta;二分 80 次 ⇒ 每个分位数 240 次 lnGamma | 被更优解取代 |
| C1 lnBeta 提升到二分循环外,作为参数传入 | lnBeta 与 x 无关;表达式 `lnGamma(a)+lnGamma(b)−lnGamma(a+b)` 原样保留、只求值一次 ⇒ 每次迭代拿到的 lnBeta 数值与原先逐位相同 ⇒ prefix、比较、二分路径、结果全部逐位一致。240 → 3 次 lnGamma | **赢家** |
| C2 Newton/Halley 法求逆 | 收敛更快,但迭代路径与浮点运算序完全不同 ⇒ 结果不逐位一致,违反行为保真 | **淘汰(X1-3)** |
| C3 减少二分迭代次数 / Wilson 等闭式近似 | 直接改变数值输出;80 次二分是版本化行为 | **淘汰(X1-3)** |

**仿真结果**:场景 1 对 9×9 参数网格 × 4 个 p、2000 组随机 (α, β, p)、
6 组退化输入(p ∉ (0,1)、非正参数)共 2330 项 `Object.is` 逐位一致。

## 3. 重构前 vs 重构后逻辑对比

### 3.1 `src/routing/posterior.ts`

**前**:`inverseRegularizedIncompleteBeta` 二分循环内每次调用
`regularizedIncompleteBeta(mid, a, b)`,后者内部重算 lnBeta。

**后**:新增私有 `lnBetaFunction(a, b)`;二分前算一次,
`regularizedIncompleteBeta(x, a, b, lnBeta)` 改为接收该值(私有函数,无公开面
变化)。新增公开纯函数:`prepareR1Observations`(过滤+分组一次)、
`mergePreparedR1Observations`(base-在前-extra-在后合并,空增量返回原索引)、
`estimateForKey`(per-key 估计,指纹守卫备忘录)及类型
`PreparedR1Observations`、`R1KeyEstimate`。`observationsForKey`、
`groupObservationsByKey`、`updatePosterior`、`lowerConfidenceBound` 等既有导出
一个未动。

### 3.2 `src/routing/r1.ts`

**前**:`routeR1` 每次调用 `observationsForR1(input.observations)`(O(N) 过滤,
含 R0 拒绝的早退路径)+ `groupObservationsByKey`(O(N) 分组),每模型
`updatePosterior` + `lowerConfidenceBound`。

**后**:`R1Input.observations` 类型加宽为
`readonly OutcomeObservation[] | PreparedR1Observations`;函数体先走 R0 拒绝
早退(观测处理对该路径无观察效应),然后 raw 数组经 `prepareR1Observations`
汇入与 prepared 完全相同的单一路径;每模型一行 `estimateForKey`。估计行字段
顺序(modelId, key, alpha, beta, mean, lcb, samples, wellSampled)与决策各分支
的 reason 字符串逐字未动。

### 3.3 `src/routing/r1-shadow-report.ts`

**前**:episode 循环内 `[...sharedObservations, ...(episode.observations ?? [])]`
每轮重拷 N 行再交给 routeR1 重过滤重分组。

**后**:循环外 `prepareR1Observations(input.observations ?? [])` 一次;循环内
own 观测为空 → 直接复用共享索引(命中 per-key 备忘录),非空 →
`mergePreparedR1Observations`(只为被触及的键付合并成本,新索引缓存独立)。
records/pairs 构造、fail-closed 抛错、claims 剥离逻辑逐行未动。
`runSimulationHoldout`(m6)经由本函数自动受益,自身未改。

## 4. 性能 / 可维护性

| 项 | 第 0 轮后 | Iteration 1 后 |
| --- | --- | --- |
| shadow 报告观测行扫描 | O(E×N)(拷贝+过滤+分组 ×E) | O(N)(一次)+ O(Σown) |
| 每份报告 beta 分位数求值 | E×M 次 | ≤ 去重键数(家族数×版本数上界) |
| 每个分位数的 lnGamma 调用 | 240 | 3 |
| 实测(E=200, N=20000, M=2,中位) | 471.7 ms | 3.2 ms(≈146×) |
| 参考实现计数器(单次报告) | ~10,132,600 行扫描、~48,000 lnGamma | 分析值:~20,000 行扫描、~30 lnGamma |
| 心智模型 | 「routeR1 自己扫观测」隐含 O(E×N) 陷阱 | 「索引一次、随处复用」显式;备忘录命中条件可审计(指纹) |

live 面零变化:`createModelRouter`/`assignTasks` 不 import R1,
`test/unit/routing/live-isolation.test.ts` 与 r1-shadow-report 内置的
live-plane 断言继续看护。

## 5. 全局排除表(Iteration 1 新增)

第 0 轮 X0-1 … X0-11 全部维持。本轮新增:

| ID | 方案 | 排除原因 |
| --- | --- | --- |
| X1-1 | 引用键 WeakMap/模块级隐藏缓存(观测过滤、分组或估计,任何变体) | 隐藏全局状态;readonly 不在运行时强制,数组变异 ⇒ 陈旧缓存 ⇒ 错误路由决策;拷贝使命中率为零。已由显式 prepared 索引(A2+B1)取代 |
| X1-2 | 为 prepared 路径新增第二个公开入口(`routeR1Prepared` 等) | 两个公开入口点 = 平行实现;联合类型入参在单入口内表达同一契约 |
| X1-3 | Newton/Halley 求逆、减少二分迭代、Wilson 等闭式近似替代 80 次二分 | 改变浮点运算路径,结果不逐位一致,违反行为保真;80 次二分属版本化数值行为 |
| X1-4 | `cheaperEstimate`/`costOf`/`tierIndex` 换 Map 索引 | M ≤ ~10,常数因子在噪声级;每次调用新建 Map 的分配可能反而变慢;无仿真可测收益 |
| X1-5 | 合并 `shadow-compare.compareShadowR1` 与 `buildR1ShadowReport` | 契约不同(单 episode agree/disagree vs 配对成本报告),非重复实现;合并改公开面 |
| X1-6 | 跨 episode 记忆化整个 routeR1 决策(按 episode 特征键去重) | 决策依赖完整 RouteRequest(r0 成本/资格矩阵),特征键无法安全覆盖全部输入;per-key 估计备忘录(B1)已拿走绝大部分收益且守卫完备 |

## 6. 测试命令与结果

```bash
# 环境:Node 22.22.2(满足 engines >=22.19.0),pnpm 10.17.1
pnpm typecheck   # 通过
pnpm lint        # 通过
pnpm build       # 通过

# 仿真/确定性检测(第 4 条规范要求的对照实验):
npx tsx scripts/iter1-equivalence-sim.ts
# → scenario 1 (C1 lnBeta hoist, beta-quantile LCB): 2330 bitwise checks passed
# → scenario 2 (routeR1 raw/prepared/memo/fingerprint): 2000 bitwise checks passed
# → scenario 3 (full shadow report old vs new): 60 report comparisons passed
# → perf fixture E=200/N=20000: 471.7 ms → 3.2 ms(≈146×)
# → ALL EQUIVALENCE CHECKS PASSED

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

1. 不动 live 面任何文件;R1/bandit/topology 仍不接 live。
2. 不动阈值(0.55/0.30/0.03/0.02/minSamples 5/maxCostIncreaseUsd 0)。
3. 不合并规格强制的双路(Beta LCB vs 正态 LCB;offline-logit vs
   offline-prob-add)——它们都只出报告/对照,本轮一行未碰其语义。
4. 不声称 Outcome-supported;`canCloseProductionCheckpointF: false` 原样。
5. 维持第 0 轮全部排除(X0-1 … X0-11),未重提任何被否决方案。

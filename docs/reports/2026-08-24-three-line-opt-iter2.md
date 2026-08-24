# 三线并行与受控自优化:Iteration 2 优化报告

日期:2026-08-24
基线:`cursor/three-line-opt-iter1-4b0e` @ `bf23106`(第 0+1 轮,含 R1–R4、A2、B1、C1)
前轮报告:[第 0 轮](./2026-08-24-three-line-self-opt-feasibility.md)、[第 1 轮](./2026-08-24-three-line-opt-iter1.md)
本轮分支:`cursor/three-line-opt-iter2-2c5c`

**结论:找到更优解。** 本轮在离线归因面(Phase C,offline-only)落地一组四项、
逐位保行为的算法与常数因子优化,把 `fitLogitAdditive` 的设计矩阵查找从
O(draws×p²×rows) 字符串比较降为 O(1) 映射查找、把平均预测比较(APC)从
每列全行重算降为「on 概率算一次 + 只访问活跃行」、把 IRLS 的 X′WX 累加从
每迭代全列扫描降为预计算行支撑;并消除 `fitProbabilityAdditive` pair 循环里
父格统计的重复重算。rows=400 / p≈60 / bootstrap=200 的确定性夹具上实测中位
耗时 11934.1 ms → 2414.2 ms(≈4.9×),6596 项逐位一致性检查全绿。

本报告不声称任何 Outcome-supported 改进;Checkpoint F-PROD 仍开放(ADR-005)。
算法语义、阈值、晋升条件、路由决策、公开导出、CLI、事件 schema、CAS 语义均未变。
第 0/1 轮排除表(X0-1 … X0-11、X1-1 … X1-6)全部维持有效,本轮未触碰任何被排除项。
**规格强制双路(offline-logit vs offline-prob-add;Beta LCB vs 正态 LCB)全部保留,
本轮只做各自内部的保行为优化,未合并、未删除任何一路。**

---

## 1. 扫描过的候选列表

按任务给出的第 2 轮搜查方向逐一实际读代码(不是复述第 1 轮结论);凡有 2+
相似方案的组,做了理论 + 仿真对比(见 §2):

| # | 位置 | 发现 | 处置 |
| --- | --- | --- | --- |
| S1 | `offline-logit.ts` `Design.build` | `set()` 内 `names.indexOf(name)` 每次 O(p) 线性扫(每 build ≤4 次)+ `interactionPairs.includes` O(w);build 在 bootstrap 里被调 O(draws×p×rows) 次 ⇒ O(draws×p²×rows) 字符串比较。性能夹具单次 fit 实测 4,984,000 次 build | **采纳**(D 组,赢家 D1) |
| S2 | `offline-logit.ts` `averagePredictiveComparison` | 每列重算与列无关的 `on = sigmoid(dot(β, xᵢ))` 全行一遍;对 dummy 未激活的行仍构造 off 向量 + 点积,而其贡献恒为 +0.0;参考实现单次 fit 13,393,600 次 dot | **采纳**(E 组,赢家 E2) |
| S3 | `offline-logit.ts` `irls` X′WX/X′Wz 累加 | 每迭代每行对全部 p 列做零值跳过扫描;行支撑 ≤5(截距+≤4 个 dummy),其余全是空扫;支撑集在整个 fit 内不变 | **采纳**(F 组,赢家 F1) |
| S4 | `offline-prob-add.ts` pair 循环 | 每个 (model, project) 对重复 `cell(byModel.get(model))` / `cell(byProject.get(project))`——父格统计已在 model/project 循环里算过,重算 O(Σ_pairs 父格行数),最坏 O(pairs×N) | **采纳**(G 组,赢家 G1) |
| S5 | `offline-logit.ts` `irls` 的 `eta` 点积按支撑求和 | `dot` 含 βⱼ×0 项,其值为 ±0.0(取决于 βⱼ 符号);略去它们对部分和的 −0.0/+0.0 号位不保逐位,与 F1 的「原本就 continue、无浮点操作」论证本质不同 | 否决(X2-1) |
| S6 | APC 按 (row, column) 记忆化 off 向量/off 概率 | O(n×p) 缓存爆炸 + 隐藏状态;E2(跳过非活跃行)已拿走同一收益且无缓存 | 否决(X2-2) |
| S7 | APC 换解析 delta 法 / IRLS 换 Newton 改良 | 改变浮点运算路径,结果不逐位一致(X1-3 在归因面的变体) | 否决(X2-3) |
| S8 | `lin-alg.ts` `solveSymmetric` | 标准部分主元高斯消元,新实现里已是剩余主导成本(O(p³)×迭代×draws);任何数值路径改动(Cholesky、分块)都不逐位一致 | 无更优(X1-3 同理),不动 |
| S9 | `propensity.ts` | 单遍 min/max/权重收集 + 两个 reduce;无重复扫描 | 无更优,不动 |
| S10 | `experiments/simulation-holdout.ts`/`shadow-compare.ts`/`holdout.ts`/`canary.ts`/`dataset.ts` | 薄包装(经第 1 轮 A2 自动受益)/ 单遍验证 / 审计追加拷贝属不可变契约;canary restore 的全量校验是 fail-closed 设计 | 无更优,不动 |
| S11 | `adaptation/pareto.ts` | O(n²) 支配过滤是 Pareto 前沿的正确性定义;候选数小,低维分治法引入复杂度且比较顺序变化影响并列裁决 | 无更优,不动 |
| S12 | `adaptation/mutate.ts`/`monitor.ts` | mutate 为一次性文本操作;monitor 每 observe 重算冻结基线,但 windowSize≈8 属噪声级,且 restore 需缓存失效管理 | 否决(X2-5) |
| S13 | `adaptation/eval-routing.ts` | 第 0 轮后已走共享 `gatedComparisonReport`;`catalogCost` 线性 find M≤10(X1-4 同理);两次 `assignTasks` 是 baseline/candidate 双策略必需 | 无更优,不动 |
| S14 | `tracking/from-child.ts`/`prescore.ts`/`analysis.ts` | 单遍、6 个固定维度;`includes` 嵌套上界是 requiredChecks/constraints 条数(个位数);analysis 只 createCandidate | 无更优,不动 |
| S15 | `run/gate-apply.ts`(不改签名) | 两个 `find` + `currentGateStatus` 共三遍事件扫描可合并单遍,但单 run 事件数百,常数因子在噪声级;单遍三用降低可读性,纯函数(mapGateDirective/currentGateStatus/nextTrackingSeq)已提取 | 否决(X2-4) |
| S16 | `learning/diagnostics.ts`/`patterns.ts`/`task-success.ts` | diagnostics 单遍分组;patterns 贪心聚类 O(n²) 是算法定义(换法改聚类结果);`averageSimilarity` 与 `clusterSignatures` 仅共享 (seed, j) 对,记忆化需对键缓存 | 否决(X2-6) |
| S17 | `posterior.ts`(C1 之后) | `betacf` 的 qab/qap/qam 已在循环外,循环体全部依赖 m;`lnGamma` 为标准 Lanczos 无重复;二分内 prefix 依赖 x 无法再提;任何进一步改动都是 X1-3 变体 | 确认无更优,不动 |
| S18 | 第 1 轮仿真脚本处置 | `scripts/iter1-equivalence-sim.ts` 保留原样作回归资产;本轮新增独立的 `scripts/iter2-equivalence-sim.ts`,不为提速牺牲逐位一致 | 保留 + 新增 |

**观察但不改(明确记录)**:`offline-prob-add.ts` `diagnose()` 的 project 循环里,
过滤条件 `key.endsWith(`|${lastSegment(key)}`)` 对任何含 `|` 的键恒为真,
即「project-problem」判定实际检查的是**全部** interaction 对(而非该 project 的对)
都含零——比按 project 过滤更严格。这可能是潜在缺陷,但该文件头部声明
"Frozen formula",且修改会改变诊断输出,违反本任务的行为保真约束,故只记录不改。

## 2. 相似方案组:理论对比 + 仿真检测

四个组各自存在 2+ 个可行做法,按规范做了理论 + 仿真裁决。仿真载体:
`scripts/iter2-equivalence-sim.ts`(独立脚本,不改生产语义;内嵌第 1 轮
`bf23106` 的 `fitLogitAdditive` / `fitProbabilityAdditive` 实现原文作为冻结
对照组;`betaQuantileLcb`/`solveSymmetric`/`DomainValidationError` 本轮未变,
从生产导入,使被测差异恰好等于 D1/E2/F1/G1)。

### 2.1 D 组:设计矩阵列查找

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| D0 现状 | 每次 `set()` 调 `names.indexOf` O(p),每次 build 查 `interactionPairs.includes` O(w);bootstrap 总代价 O(draws×p²×rows) 字符串比较 | 被更优解取代 |
| D1 design 闭包内显式 `columnIndex: Map` + `interactionPairSet: Set`,构造时建一次 | 列名唯一(去重后的层级藏在互异前缀 a:/u:/v:/w: 与 intercept 后),故 `map.get(name)` 与 `names.indexOf(name)` 返回同一索引;向量仍是同序 0/1 填充 ⇒ 逐位平凡一致。索引与 design 同生命周期、构造后只读,无隐藏状态 | **赢家** |
| D2 模块级/WeakMap 按 rows 数组引用缓存 design 或索引 | X1-1 同理:隐藏全局状态、数组变异 ⇒ 陈旧缓存;且 bootstrap 的 sample 数组每次新建,命中率为零 | 淘汰(X1-1 覆盖,不另立 ID) |

### 2.2 E 组:平均预测比较(APC)的每列重复计算

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| E0 现状 | 每列对全部行重算与列无关的 `on`,并为每行(含 dummy 未激活行)构造 off 向量 + 点积;bootstrap 里每个成功 draw × 每个 pointEffects 名字都重复此过程,参考级(reference levels)无对应列却也付全价 | 被更优解取代 |
| E1 只提升 `on` 概率(每个 (β, vectors) 算一次) | 逐位一致(同一表达式、同一遍历序),省一半;但 off 向量构造仍 O(rows×p)/列 | 被 E2 取代(E2 含 E1) |
| E2 提升 `on` + 跳过非活跃行(赢家):`onProbabilitiesFor` 每 fit/每 draw 算一次;APC 内 `columnIndex.get(column)` 定位列,`vectors[i][col] === 0` 的行直接跳过;参考级列(不在 names 中)全部跳过 | **保行为论证**:dummy 未激活 ⇒ `build(row, skip=column)` 产出的 off 向量与 on 向量逐元素相等 ⇒ 两次 `dot` 对相同数组按相同顺序求和 ⇒ 逐位相等 ⇒ `on − off` 恰为 +0.0(IEEE 754 RN 下 x−x=+0.0);贡献永不为 −0.0(相等相减得 +0.0,不等相减非零),部分和永不为 −0.0(非 −0.0 项之和在 RN 下不可能舍入到 −0.0),故略去 +0.0 加法不改变任何部分和的位型;除数保持 `rows.length`;参考级列 sum 恒 +0.0,`+0.0/n = +0.0` 与原全行 0 贡献一致 | **赢家** |
| E3 按 (row, column) 记忆化 off 向量/概率 | O(n×p) 键空间缓存 + 隐藏状态;收益与 E2 重叠且劣于 E2 | **淘汰(X2-2)** |
| E4 解析 delta 法/闭式近似替代成对 sigmoid 差 | 浮点路径完全不同,不逐位一致 | **淘汰(X2-3)** |

### 2.3 F 组:IRLS X′WX / X′Wz 累加

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| F0 现状 | 每迭代每行 `for a in 0..p`(零值 `continue`)、活跃 a 再 `for b in 0..p`(零值 `continue`);行支撑 ≤5,其余是纯空扫;支撑由 vectors 决定,整个 fit 不变 | 被更优解取代 |
| F1 每 fit 预计算 `supports[i]`(vᵢ 中非零下标,升序),累加只遍历支撑 | 原实现对零元素**没有任何浮点操作**(continue),支撑列表按升序构造 ⇒ 新实现执行的浮点操作序列(每行的 (a,b) 对序、跨行序、`+ w·xᵢ[a]·z` / `+ w·xᵢ[a]·xᵢ[b]` 表达式)与原实现完全相同 ⇒ 逐位一致。supports 每 fit 算一次 O(n×p),≈原一次迭代的扫描成本 | **赢家** |
| F2 `eta` 点积也按支撑求和 | `dot` 的 βⱼ×0 项值为 ±0.0(随 βⱼ 符号),部分和可能经过 −0.0;略去这些项在 −0.0 号位上不保逐位(−0.0 + (+0.0) = +0.0 会被跳过所改变),需要靠「下游 sigmoid/加法消除差异」的间接论证,不满足逐位保真标准 | **淘汰(X2-1)** |

### 2.4 G 组:prob-add 父格统计重复重算

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| G0 现状 | pair 循环每对重算 `cell(byModel.get(model) ?? [])` 与 `cell(byProject.get(project) ?? [])`,父格均值在 model/project 循环里已算过;O(Σ_pairs 父格行数),最坏 O(pairs×N) | 被更优解取代 |
| G1 在 model/project 循环内顺手存 `modelStats`/`projectStats` 两个局部 Map,pair 循环 `get(...) ?? cell(byModel.get(...) ?? [])` | `cell` 是纯函数、分组 Map 在三个循环前一次性建完后不再追加 ⇒ 缓存值与重算逐位相同。**边界保真**:pair 键 `${modelVersion}\|${projectId}` 在 modelVersion 含 `\|` 时 split 出的 parts 与真实键脱节,原实现走 `?? []` 空格路径——G1 的 `?? cell(byModel.get(model) ?? [])` 回退保留了逐字相同的原表达式(缓存只按真实父键填充,脱节键必 miss),该情形被仿真显式覆盖 | **赢家** |
| G2 模块级缓存 | X1-1 同理 | 淘汰(X1-1 覆盖,不另立 ID) |

### 2.5 仿真结果

```text
scenario 1 (fitLogitAdditive D1+E2+F1): 47 cases compared
  — 40 个随机夹具(scenarios 1–3 × models 1–4 × projects 1–4 × rows 10–100,
    随机 bootstrap 25–65 与 seed)+ 空设计 + 全 PASS/全 FAIL 退化 +
    bootstrap=5(<20 成功 draw 的 INVALID_ESTIMATE 路径)+ 4 行小样本
    (重采样常塌缩单类)+ modelVersion 含 "|" + 默认 bootstrap=200 中型夹具
scenario 2 (fitProbabilityAdditive G1): 61 cases + 2 error paths compared
  — 60 个单场景随机夹具(rows 1–150)+ "|" 脱节夹具;
    空行数组 / 多场景两条错误路径的异常消息逐字一致
perf fixture (rows=400, p≈60, bootstrap=200):
  reference 11934.1 ms -> current 2414.2 ms (4.9x)
reference work per fit: buildCalls=4,984,000, dotCalls=13,393,600

ALL EQUIVALENCE CHECKS PASSED (6596 bitwise checks)
```

全部 6596 项检查为 `Object.is` 逐位比较(effects 的 name/point/lcb/ucb、
diagnosis、reason、rowsUsed、estimator、writesActivePointer)及错误消息逐字比较。

## 3. 重构前 vs 重构后逻辑对比

### 3.1 `src/routing/offline-logit.ts`

**前**:`Design.build` 的 `set()` 每次 `names.indexOf`(O(p))、每 build 一次
`interactionPairs.includes`(O(w));`averagePredictiveComparison(design, rows,
vectors, coefficients, column)` 每列全行重算 on 概率并为所有行构造 off 向量;
`irls` 每迭代每行对全部 p 列做零值跳过双层扫描。

**后**:`Design` 增加只读 `columnIndex: ReadonlyMap<string, number>`(构造时由
唯一列名一次建成),`build` 改 `columnIndex.get` + `interactionPairSet.has`;
新增私有 `onProbabilitiesFor(vectors, coefficients)`,APC 签名(模块私有)增加
`onProbabilities` 参数并只访问 `vectors[i][columnIdx] !== 0` 的行;`irls` 开头
预计算 `supports`(每行非零下标,升序),累加循环 `for (const a of active)` /
`for (const b of active)`。`fitLogitAdditive` 公开签名、输出字段、reason 字符串、
bootstrap 抽样序(PRNG 调用序不变)逐字未动。

### 3.2 `src/routing/offline-prob-add.ts`

**前**:pair 循环内 `cell(byModel.get(model) ?? [])` / `cell(byProject.get(project)
?? [])` 每对重算父格均值。

**后**:model/project 循环各存一个局部 `Map<string, CellStats>`;pair 循环改
`modelStats.get(model) ?? cell(byModel.get(model) ?? [])`(project 同形)。
`fitProbabilityAdditive` 公开签名、effects 顺序与字段、diagnose 输入、错误消息
逐字未动;`\|` 脱节键的空格回退路径逐字保留。

### 3.3 未触碰

`propensity.ts`、`lin-alg.ts`、`posterior.ts`、experiments 五文件、adaptation
四文件、tracking 三文件、`gate-apply.ts`、learning 三文件:一行未改(理由见 §1)。
两套归因估计器都保留,`attribution-report.ts` 的双路调用未动。

## 4. 性能 / 可维护性

| 项 | 第 1 轮后 | Iteration 2 后 |
| --- | --- | --- |
| `Design.build` 单次成本 | O(p) indexOf ×≤4 + O(w) includes | O(p) 数组填充 + O(1) 查找 ×≤4 |
| bootstrap 列名查找总量 | O(draws×p²×rows) 字符串比较 | O(draws×p×rows) 常数操作 |
| APC 每列成本 | O(rows×p)(全行 on 重算 + 全行 off 构造) | O(rows) 活跃扫描 + O(活跃行×p);on 概率每 (β, vectors) 一次 |
| IRLS 每迭代累加 | O(rows×p) 空扫 + O(rows×s×p) | O(rows×s²),s≤5;supports 每 fit 一次 O(rows×p) |
| prob-add pair 循环 | O(Σ_pairs 父格行数)重算 | O(1) 查找(缓存于父循环) |
| 实测(rows=400, p≈60, bootstrap=200, 中位) | 11934.1 ms | 2414.2 ms(≈4.9×) |
| 参考实现计数器(单次 fit) | ~4,984,000 次 build(各含 O(p) indexOf)、~13,393,600 次 dot | build 降两个数量级下界受 bootstrap 抽样限制;剩余主导成本为 `solveSymmetric` O(p³)×迭代(数值路径,不可动) |
| 心智模型 | 「build 自己找列」隐含 O(p²) 陷阱;APC 隐含「参考级列也付全价」 | 索引/支撑「构造一次、只读复用」显式;+0.0 跳过条件有注释与仿真看护 |

live 面零变化:`offline-logit`/`offline-prob-add` 仅被 `experiments/attribution-report.ts`
引用(offline-only),`writesActivePointer: false` 原样;
`test/unit/routing/live-isolation.test.ts` 继续看护。

## 5. 全局排除表(Iteration 2 新增)

第 0 轮 X0-1 … X0-11、第 1 轮 X1-1 … X1-6 全部维持。本轮新增:

| ID | 方案 | 排除原因 |
| --- | --- | --- |
| X2-1 | IRLS 的 `eta`/`dot` 点积改为只按行支撑求和 | βⱼ×0 = ±0.0 随符号变化,部分和的 −0.0 号位不保逐位;与 F1(原本就无浮点操作的 continue 项)论证本质不同。全量 dot 保留 |
| X2-2 | APC 按 (row, column) 记忆化 off 向量/off 概率 | O(n×p) 键空间缓存 + 隐藏状态;E2 以零缓存拿走同一收益 |
| X2-3 | APC 换解析 delta 法/闭式近似;IRLS 换 Newton/Halley 改良 | 改变浮点运算路径,不逐位一致(X1-3 在离线归因面的变体);`solveSymmetric` 换 Cholesky/分块同理 |
| X2-4 | `applyTrackingGate` 三次事件扫描合并单遍(公开签名不变版) | 单 run 事件数百,常数因子在噪声级;单遍三用(双 find 语义 + 状态折叠)显著降低可读性;改签名版仍是 X0-4 |
| X2-5 | drift monitor 冻结基线缓存 | windowSize 默认 8,重算在噪声级;restore 需缓存失效管理,成本超过收益 |
| X2-6 | `patterns.ts` 聚类相似度按对记忆化 / averageSimilarity 复用 clusterSignatures 中间值 | 两处仅共享 (seed, j) 对,复用需对键缓存(隐藏状态变体);签名数小 |

被更优解取代(非排除):D0/E0/E1/F0/G0。D2/G2(模块级缓存)由 X1-1 的既有
理由覆盖,不另立 ID。

## 6. 测试命令与结果

```bash
# 环境:Node 22.22.2(满足 engines >=22.19.0),pnpm 10.17.1
pnpm typecheck   # 通过
pnpm lint        # 通过
pnpm build       # 通过

# 仿真/确定性检测(规范要求的对照实验):
npx tsx scripts/iter2-equivalence-sim.ts
# → scenario 1 (fitLogitAdditive D1+E2+F1): 47 cases compared
# → scenario 2 (fitProbabilityAdditive G1): 61 cases + 2 error paths compared
# → perf fixture: reference 11934.1 ms -> current 2414.2 ms (4.9x)
# → ALL EQUIVALENCE CHECKS PASSED (6596 bitwise checks)

# 第 1 轮回归资产(保留原样):
npx tsx scripts/iter1-equivalence-sim.ts   # 仍全绿

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
2. 不动阈值(ATTRIBUTION_EFFECT 0.1、QUALITY_FLOOR 0.55、INTERACTION_MIN_N 3、
   MIN_SUCCESSFUL_DRAWS 20、bootstrap 200、二分 80 次等全部版本化数值)。
3. 不修 `offline-prob-add.ts` `diagnose()` 的疑似过严 project 过滤(§1 观察项)
   ——行为改动超出本任务授权,已如实记录供后续立项。
4. 不声称 Outcome-supported;`canCloseProductionCheckpointF: false` 原样。
5. 维持第 0/1 轮全部排除(X0-1 … X0-11、X1-1 … X1-6),未重提任何被否决方案。

MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 1 / R1-C：离线路由切片 SOTA 打磨

- **战役:** 全库持久 SOTA 优化 Round 1 / R1-C（10 区并行之一）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `bb39570`
- **分支:** `cursor/r1c-offline-routing-a496`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量读码）

## 结论

**落地 1 组（S1-C，三部分）逐位保行为优化**，全部位于 `offline-logit.ts`：
消除 bootstrap 每 draw 对 design 向量与 IRLS 支撑的 O(rows×p) 重建、APC off
向量改由已建 on 向量复制置零派生、IRLS 迭代工作缓冲每 fit 分配一次。真实规模
夹具（rows=400、p≈60、bootstrap=200，即 Iter2 同一夹具）实测中位
**2336.3 ms → 1888.1 ms（1.24×）**，参考实现每 fit 的 358,006 次 `design.build`
降到 400 次（仅基线向量）；8028 项逐位一致性检查全绿。其余 10 个候选
（S1-C-1 … S1-C-10）经理论 + 确定性仿真裁决后全部淘汰记入排除表。落地后本切片
在排除表与规格双路约束下无更多可测优化。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留（X0-11），
只做各自内部保行为优化。live 面零文件改动（R1-B 域未触碰）。

## 0. 范围与约束遵守

- 排除表全部维持：X1-1…X1-6、X2-1…X2-3、X3-4、X3-5、X4-1、X4-2 及其余继承项
  均未重提；候选枚举刻意绕开被排除方案，只探索新角度（重采样工件复用、
  派生代替重建、每 fit 缓冲）。
- 公开面零变化：`fitLogitAdditive` 签名、输出字段与顺序、reason 字符串、
  bootstrap PRNG 调用序、全部版本化阈值（ATTRIBUTION_EFFECT 0.1、
  QUALITY_FLOOR 0.55、INTERACTION_MIN_N 3、MIN_SUCCESSFUL_DRAWS 20、
  bootstrap 200、IRLS TOL/ridge、二分 80 次）逐字未动。
- 仓库变更仅三处：`src/routing/offline-logit.ts`（切片内）、
  `scripts/round01-r1c-equivalence-sim.ts`（本轮仿真回归资产，沿用 R1-F 先例）、
  本报告。

## 1. 落地项 S1-C：offline-logit 重复构建工作的三点消除

`fitLogitAdditive` 是本切片最重的离线路径（经
`experiments/attribution-report.ts` 双归因调用）。Iter2 落地 D1/E2/F1 后
记载「build 降两个数量级下界受 bootstrap 抽样限制」——本轮推翻该「下界」：
bootstrap 重采样的行**就是** baseRows 里的同一批 Row 对象，其 design 向量与
支撑列表是基线拟合早已算好的纯函数结果，逐 draw 重建纯属重复。

### 1.1 三部分与理论

| 部分 | 改前 | 改后 | 复杂度 |
| --- | --- | --- | --- |
| (a) 重采样工件复用 | 每 draw `sample.map(design.build)` 重建 rows 个向量（各 O(p) 填充 + ≤4 次查找 + 分配），`irls` 内每 fit 重扫 O(rows×p) 求支撑 | 采样循环内按 index 复用基线 `vectors[index]`/`supports[index]`；`computeSupports` 每基线拟合一次，`irls` 改为入参（模块私有） | 每 draw 预处理 2×O(rows×p) → O(rows) 引用推入，p 因子整体消除 |
| (b) APC off 向量派生 | 每个活跃 (row, column) 调 `design.build(row, skip=column)` 全量重建 | `vectors[i].slice()` + 置零 contrast 列 | O(p) 重建+查找 → O(p) 拷贝+1 次写；消除 APC 全部 build 调用（参考实现单 fit ~27.8 万次） |
| (c) IRLS 迭代缓冲 | 每迭代新分配 eta/mu/X′WX/X′Wz（p+3 个数组/迭代 × 迭代数 × 201 fits） | 每 fit 分配一次，迭代顶部 eta/mu 全量覆写、X′WX/X′Wz `fill(0)` 归零 | 分配级常数；实测稳定 ~140–150 ms（三次重复 148.5/142.1/138.9 ms） |

### 1.2 保行为论证（逐位）

- **(a)**：`design.build(row)`（无 skip）是 (row, design) 的纯函数；重采样元素
  与 `baseRows[index]` 是同一对象，故 `vectors[index]` 内容与逐 draw 重建逐元素
  相同（0/1 整数，平凡逐位）。下游消费者（`irls` 的 eta 点积与累加读、
  `onProbabilitiesFor`、APC）对向量与支撑**只读不写**（本轮全文件核对），
  别名（跨 draw 共享、同一 sample 内重复行共享）不可观察。PRNG 调用序不变
  （每 draw 恰好 rows 次 `random()`）。退化 draw（单类塌缩跳过）现在在检查前
  推入引用，参考实现在检查后才 build——两侧均无观察效应，跳过 draw 上的引用
  推入代价平凡。
- **(b)**：活跃行（`vectors[i][columnIdx] !== 0`）的 off 向量恰为其 on 向量把
  contrast 列置 0——`build(row, skip)` 产出与「拷贝 on 向量 + 置零该列」内容
  逐元素相等；`dot` 对相同数组按相同顺序求和 ⇒ 逐位相等。E2 的 +0.0 论证
  （非活跃行跳过、参考级列全跳）原样保留。新增 `columnIdx !== 0` 守卫使
  （不可达的）intercept 列同样与 build 路径逐位一致：build 从不 skip
  intercept ⇒ off≡on ⇒ 参考实现均值为 +0.0；守卫直接跳过循环 ⇒ sum=+0 ⇒
  同为 +0.0（`Object.is` 相等）。
- **(c)**：eta/mu 每迭代全量覆写（同一 `dot`/`sigmoid` 表达式、同一遍历序）；
  X′WX/X′Wz 以 `fill(0)` 归零到与新分配完全相同的起始状态；`solveSymmetric`
  对输入做防御性拷贝（`a.map(row => [...row])`、`[...b]`），返回新数组，
  缓冲引用不逃逸出迭代。每迭代浮点操作序列与参考实现完全相同 ⇒ 逐位一致。
  与 X2-1 的区别：本项不改任何求和的项集合（eta 仍是全量 dot），只改分配。

### 1.3 相似方案组：单赢家裁决

同一「消除重复构建」方案族按站点分组，理论 + 仿真分段裁决（阶段基准均为
rows=400/p≈60/bootstrap=200 夹具中位）：

| 站点 | 方案 | 裁决 |
| --- | --- | --- |
| 重采样向量 | A0 逐 draw 重建（现状）/ A1 采样循环内融合推入引用 / A2 先存 index 数组、检查后再映射 | **A1 赢**：单遍最简；A2 仅在罕见跳过 draw 上省 2×rows 次推入，多一个数组。落地 = A1。阶段实测 (a) 单独 2397.9→2181.6 ms（1.10×） |
| APC off 向量 | B0 逐 (row,column) build（现状）/ B1 拷贝置零派生 / B2 原位置零+恢复 / B3 记忆化（X2-2 已排除）/ B4 `sigmoid(etaOn − β_col)` 代数捷径（X2-1/X2-3 域） | **B1 赢**：(a)+(b) 阶段实测 2409.2→2016.2 ms（1.19×）；B2 等价（8028 项检查含其全部用例）但对跨 draw 别名共享的 on 向量做临时可变操作，且相对 B1 边际仅 8.5–46 ms（运行间噪声内）→ 记 S1-C-1 排除；B3/B4 维持既有排除 |
| IRLS 分配 | C0 每迭代新分配（现状）/ C1 每 fit 缓冲 | **C1 赢**：边际稳定 ~140–150 ms（三次独立重复 7% 左右），非噪声；等价性平凡（归零起始态 + 拷贝隔离）。(a)+(b)+(c) 合计 1.24× |

### 1.4 仿真证据

`scripts/round01-r1c-equivalence-sim.ts`（冻结 `bb39570` 版 `fitLogitAdditive`
原文为对照组；`betaQuantileLcb`/`solveSymmetric` 本轮未变、从生产导入，被测
差异恰为 S1-C 编辑；`npx tsx scripts/round01-r1c-equivalence-sim.ts`）：

- **等价**：49 个夹具 ×｛生产 S1-C、中间态 (a)+(b)、被拒 S1-C-1｝三路 vs
  冻结参考 —— 40 个随机夹具（scenarios 1–3 × models 1–4 × projects 1–4 ×
  rows 10–100 × bootstrap 25–65 × 随机 seed）+ 空设计 + 全 PASS/全 FAIL 退化 +
  bootstrap=5（INVALID_ESTIMATE 路径）+ 4 行小样本 + `maxIter=3` 截断 IRLS +
  modelVersion 含 `|` + 单水平因子（仅 intercept+参考级）+ 默认 bootstrap=200
  中型夹具 + 性能夹具本体。effects 的 name/point/lcb/ucb 全部 `Object.is`
  逐位、diagnosis/reason/rowsUsed/estimator/writesActivePointer 逐字。
  **共 8028 项检查全部通过**（两次独立运行结论逐位一致）。
- **性能**（两次回归运行）：参考 2336.3 → 生产 1888.1 ms（**1.24×**）；
  2421.4 → 1960.3 ms（**1.24×**）。归因：中间态 (a)+(b) 2004.4 / 2055.6 ms。
  参考实现单 fit `design.build` 调用 **358,006** 次 → 生产 400 次（仅基线）。
- **交叉验证**：`scripts/iter2-equivalence-sim.ts`（其对照冻结在 Iter1 期）
  本轮全绿且实测 11841.5 → 1903.6 ms（6.2×，Iter2 时为 4.9×）——4.9 × 1.24 ≈ 6.1，
  与本轮增量吻合。
- **渐近收口**：落地后单 fit 剩余主导成本为 `solveSymmetric` 的
  O(p³)×迭代×draws 与 APC/eta 的全量 dot——三者均被 X1-3/X2-1/X2-3 的
  逐位一致要求锁定，bootstrap 抽样本身 Ω(draws×rows)。**本文件已达排除表
  约束下的可测最优。**

## 2. 全切片裁决（9 文件）

| 文件 | 裁决（一行） |
| --- | --- |
| `offline-logit.ts` | **落地 S1-C**（§1）；X2-1/X2-2/X2-3 维持；`solveSymmetric`/`dot`/`sigmoid` 数值路径锁定 |
| `offline-prob-add.ts` | G1 已落地；kappaS 输入与主循环的 `cell()` 双算见 S1-C-6；`betaInterval` (n,mean) 记忆化见 S1-C-7；`diagnose` 的 lastSegment 过严观察项维持 Iter2「只记录不改」（Frozen formula） |
| `posterior.ts` | C1/B1/A2 已落地；`betacf`/`lnGamma`（X3-4）/二分数值路径锁定；`estimateForKey` 指纹重建见 S1-C-4；merge 路径见 S1-C-2/3；`updatePosterior` 单遍即分组内容下界 |
| `r1.ts` | A2 已落地；`cheaperEstimate`/`costOf`/`tierIndex`=X1-4；`modelsById` 每调用重建、双 filter、`find` 均 M≤10 常数（S1-C-10）；跨 episode 决策记忆化=X1-6 |
| `r1-shadow-report.ts` | 主路径（共享观测）O(N) 一次 + O(E×(R0+M)) 已是 A2/B1 后形态；per-episode merge 路径仓内不可达（`runSimulationHoldout.toFrozenEpisode` 不传观测、单测不传），见 S1-C-2/3；`selectedCost` find=X1-4；与 shadow-compare 合并=X1-5 |
| `propensity.ts` | 单遍 min/max/权重收集；双 reduce=X3-5 维持；`isFabricatedPositiveSupport` 三遍见 S1-C-8；其余为固定字段校验 |
| `lin-alg.ts` | 部分主元高斯消元为版本化数值路径（Cholesky/分块=X2-3）；入参防御性拷贝是公开 readonly 契约本体，调用方传所有权=改公开面 |
| `bandit.ts` | `selectArm` 贪心 O(arms) 个位数（首臂重复求值见 S1-C-9）；`recordReward`/`recordExploration` 全量拷贝是不可变契约；`validateTaskFeatures` 表长 6（S1-A-8 同类） |
| `shadow.ts` | `decisions` 追加拷贝=X4-2 锁定（halted 分支同）；每 step 的 `selectArm` config 字面量分配见 S1-C-9；drift/预算扣减单遍 O(1) |

## 3. 候选三条件裁决总表

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| bootstrap 工件复用 + APC 派生 + IRLS 缓冲 | ✓ 2×O(draws×rows×p)→O(draws×rows)；35.8 万次 build→400；分配级常数 | ✓ 8028 项逐位（含全部退化/截断/`\|` 路径） | ✓ 实测 1.24×（两次运行一致），~450 ms/fit | **落地 S1-C** |
| APC 原位置零+恢复（免拷贝） | ✓ O(p) 拷贝→O(1) 变异 | ✓ 等价（单线程确定性下已仿真证明） | ✗ 相对 S1-C 边际 8.5–46 ms，运行间噪声内 | S1-C-1（另有别名可变危险） |
| merge 备忘录跨索引播种 | ✓ episode 带自有观测时未触及键免重算（最坏 O(E×(N+M×quantile)) 复现） | ✓ 未触及键分组同引用、纯函数+指纹守卫 | ✗ merge 路径仓内不可达（S1-F-1 先例），收益不可测 | S1-C-2 |
| merge overlay 持久索引免 O(K) 拷贝 | ✓ O(K)→O(touched) | ✗ `byKey` 公开 ReadonlyMap 形状（X0-4 同类） | ✗ 同上不可达 | S1-C-3 |
| estimateForKey 指纹提升/缓存 | ✗ E×M 次 7 字段串构建，数十 µs/报告 | 模块缓存=X1-1；加参/加字段=公开面 | ✗ 噪声 | S1-C-4 |
| prepare 过滤+分组单遍融合 | ✗ O(N)→O(N) 常数 | ✓ | ✗ S1-A-4 已实证此类融合可更慢 | S1-C-5 |
| prob-add `cell()` 双算合一 | ✓ O(2N)→O(N) | ✓ 纯函数同值 | ✗ 单场景 rows 数百，µs 级（X3-2 同类） | S1-C-6 |
| prob-add betaInterval (n,mean) 记忆化 | ✓ 去重同参分位数 | ✓ 序统计同值 | ✗ cells 数十、亚 ms；引入缓存状态 | S1-C-7 |
| propensity 三遍→单遍计数 | ✗ O(3n)→O(n) 常数 | ✓ `ones!==1` 代数同值 | ✗ n=episodes 数百（X3-5 同类） | S1-C-8 |
| bandit/shadow 微观分配 | ✗ arms 个位数/每 step 一小对象 | ✓ | ✗ 亚噪声（X1-4/S1-A-8 同类） | S1-C-9 |
| r1/r1-shadow-report 微观（Map 重建、双 filter、spread 省略） | ✗ M≤10 常数 | spread 省略改对象身份（S1-A-7 类） | ✗ 噪声 | S1-C-10 |

## 4. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-C-1 | offline-logit APC off 对共享 on 向量原位置零+恢复 | 等价且已仿真证明，但对跨 draw 别名共享的向量做临时可变操作（X1-1/X4-2 同精神的审计危险）；相对已落地拷贝派生边际 8.5–46 ms 在运行噪声内 |
| S1-C-2 | mergePreparedR1Observations 向新索引播种 base 备忘录中未触及键 | merge 路径仓内不可达（m6 holdout 不传 per-episode 观测；S1-F-1 先例），收益不可测；且跨索引共享 R1KeyEstimate 对象引入可观察身份变化（S1-A-7 类）。重开条件：真实调用方开始批量传 per-episode 观测 |
| S1-C-3 | merge 改 overlay/持久索引免 O(K) Map 拷贝 | `PreparedR1Observations.byKey` 公开 ReadonlyMap 形状（X0-4 同类）；O(K) 引用拷贝是不可变合并下界；同 S1-C-2 不可达 |
| S1-C-4 | estimateForKey 每调用 estimateFingerprint 重建的消除 | 模块缓存=X1-1；加参数/加索引字段=公开面变更（X0-4 同类）；E×M 次串构建数十 µs/报告，噪声 |
| S1-C-5 | prepareR1Observations 过滤+分组单遍融合 | 常数级；S1-A-4 已实证小数组融合可实测更慢 |
| S1-C-6 | offline-prob-add kappaS 输入与主循环 cell() 双算合一 | O(2N)→O(N) 常数，单场景 rows 数百级 µs 噪声（X3-2 同类） |
| S1-C-7 | offline-prob-add betaInterval 按 (n,mean) 记忆化 | 去重域=cells 数十、亚 ms；引入缓存状态（X2-2 同精神） |
| S1-C-8 | propensity isFabricatedPositiveSupport 三遍→单遍计数化简 | 常数遍数（X3-5 同类），n 数百级噪声 |
| S1-C-9 | bandit selectArm 首臂重复求值消除 / shadow step 内 config 字面量提升 | arms 个位数、一次小分配级，亚噪声（X1-4/S1-A-8 同类） |
| S1-C-10 | r1.ts modelsById/双 filter 微观、r1-shadow-report request spread 条件省略 | M≤10 常数噪声；spread 省略改对象身份（S1-A-7 类） |

## 5. 测试与验证

环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，会使 `cli doctor`
的 node 预检单测环境性失败——已在基线验证与本改动无关；切换 22.22.2 后全绿）。

```bash
pnpm typecheck   # ✓
pnpm lint        # ✓
pnpm build       # ✓
pnpm test        # ✓ 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）

# 相关子套件
npx tsx --test "test/unit/routing/**/*.test.ts" "test/unit/experiments/**/*.test.ts" \
  "test/integration/m5/**/*.test.ts" "test/integration/m6/**/*.test.ts"
# ✓ 297 pass / 0 fail

# 本轮仿真 + 全部既有回归资产
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8028 项逐位；1.24×
npx tsx scripts/iter1-equivalence-sim.ts         # ✓（143.4×）
npx tsx scripts/iter2-equivalence-sim.ts         # ✓ 6596 项；6.2×（原 4.9×，含本轮增量）
npx tsx scripts/iter3-equivalence-sim.ts         # ✓ 71351 项
npx tsx scripts/round01-r1f-equivalence-sim.ts   # ✓ 2668 项
```

未修改任何测试文件；live 面文件零改动（`test/unit/routing/live-isolation.test.ts`
与 r1-shadow-report 内置 live-plane 断言继续看护）；双 LCB 与双归因两路一行未删。

MORE_OPTIMA=no
BRANCH=cursor/r1c-offline-routing-a496

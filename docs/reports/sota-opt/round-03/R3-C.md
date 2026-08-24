MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 3 / R3-C：离线路由切片第三遍 SOTA 打磨

- **战役:** 全库持久 SOTA 优化 Round 3 / R3-C（Round 1–2 同区第三遍）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `451fc7b`（含 Round 1–2 全部已合入成果与 R3-A 排除）
- **分支:** `cursor/r3c-offline-routing-c9c8`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读；自 R2-C 基线 `627a438` 起切片唯一变动即 S2-C 落地本身，`git diff` 核实）

## 结论

**落地 1 项（S3-C）逐位保行为优化**，位于 `offline-logit.ts` 的 IRLS 累加热
循环：design 向量在支撑列表上的每个分量**恰为 1**（`build()` 只写 1，
`computeSupports` 只选非零），而 IEEE-754 对 1.0 的乘法是恒等运算
（`x * 1.0 === x` 逐位），故加数 `w * xi[a] * xi[b]` 与 `w * xi[a] * z` 分别
逐位等于 `w` 与 `w * z`——直接累加这两个值（`w * z` 每行提升一次）不改任何
求和的项集合、项值与顺序，只消除冗余乘法与向量读取。真实规模夹具
（rows=400、p=60、bootstrap=200、规范键 167，即 R1-C/R2-C 同一夹具）三次
独立预落地运行对生产省 **140.9–154.6 ms（1.09–1.10×）**，稳定高于 S1-C-1
判定的 ±35 ms 噪声带，与 R1-C (c)（~140–150 ms）和 S2-C（163–202 ms）的
落地量级同级；每次报告调用消除 **177,843,236 次**累加循环乘法（→ 0）。
14730 项逐位一致性检查 × 4 次独立运行全绿。同族三个附加变体（对称上三角+
镜像、融合单遍+w/z 键去重、采样缓冲复用）实测边际均为双向抖动，按单赢家
裁决淘汰记入排除表（S3-C-1..3）。落地后本切片在排除表与规格双路约束下
第三次收口。

这推翻了 R2-C 收口声明中「进一步压缩只剩批量化（违逐位）或改数值路径」的
一处过强概括——与 S2-C 推翻 R1-C 的方式同构：累加循环的加数**值**一直在
经由恒等乘法被重复计算；消除该重复既非批量化（加法项集合与顺序原样保留，
R2-C 已裁决 `sum += k×x` 不可行且本轮未重提），也非数值路径变更（每个被
消费的 double 可证逐位相同）。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。

## 0. 范围与约束遵守

- 先读并遵守：README / EXCLUSIONS.md / round-03/PLAN.md / round-01/R1-C.md /
  round-02/R2-C.md。禁止重开项零触碰：X2-1（eta 仍全量 dot；累加循环自 F1
  起本就只访问支撑，本项不改任何项集合）、X2-2/S1-C-1/S2-C-2/S2-C-4（APC
  站点四面锁定，逐字未动）、X2-3/X1-3（solveSymmetric/二分/sigmoid 数值路径
  逐字未动）、X1-1（无跨调用状态；工作缓冲生命周期同 S1-C (c)）、
  S2-C-1..5 / S1-C-1..10 / S3-A-1..4（未重提）。
- 公开面零变化：`fitLogitAdditive` 签名、输出字段与顺序、reason 字符串、
  bootstrap PRNG 调用序（每 draw 恰好 rows 次 `random()`）、全部版本化阈值
  （ATTRIBUTION_EFFECT 0.1、QUALITY_FLOOR 0.55、INTERACTION_MIN_N 3、
  MIN_SUCCESSFUL_DRAWS 20、bootstrap 200、IRLS TOL/ridge、二分 80 次）
  逐字未动。`irls` 为模块私有（R1-C/R2-C 先例）。
- 仓库变更仅三处：`src/routing/offline-logit.ts`（切片内）、
  `scripts/round03-r3c-equivalence-sim.ts`（本轮仿真回归资产，沿用
  R1-C/R2-C 先例）、本报告。

## 1. 落地项 S3-C：IRLS 累加循环的单位乘法消除

### 1.1 机会与理论

S1-C (a) 复用了静态工件（向量/支撑），S2-C 去重了每迭代的 eta/mu 纯函数值，
但每次 IRLS 迭代的累加循环仍对每个 (行, 支撑列对) 重算
`w * xi[a] * xi[b]` 与 `w * xi[a] * z`。观察：这是一个 **0/1 设计**——
`design.build` 产出的向量分量 ∈ {0,1}，支撑列表恰是值为 1 的列。于是
`xi[a] = xi[b] = 1`，两个加数分别恒等于 `w` 与 `w * z`，乘法是纯冗余。
perf 夹具上每次报告调用（201 个 fit、8966 次迭代、平均支撑 4.46、
Σs²+Σs = 8151/迭代）共 **177,843,236 次**此类乘法，S3-C 后为 0；同时
累加循环不再读取 design 向量（只读支撑），`w * z` 每行提升一次，
`xtwx[a]` 行引用在 b 循环外提升。

### 1.2 保行为论证（逐位）

- **加数值**：`w * xi[a] * z` 求值序为 `(w * xi[a]) * z`；`xi[a] === 1` ⇒
  `w * 1` 按 IEEE-754 精确等于 `w`（对任意有限 double 成立，w ∈
  [1e-10, 0.25] 恒有限正）⇒ 加数 === `w * z`。同理
  `(w * xi[a]) * xi[b] === w`。`wz = w * z` 是 (w, z) 的纯函数，每行提升
  一次与逐列重算逐位同值。
- **项集合与顺序**：外层行序、内层支撑列序、每个单元的加数序列完全不变
  （区别于 X2-1 改项集合、区别于 R2-C 已裁决不可行的批量累加改加法结合）；
  循环从 for-of 改 for-index 与行引用提升是纯代码移动，不触任何浮点运算。
- **不变量依据**：向量仅由模块私有 `design.build` 构造（只写 1），支撑仅由
  模块私有 `computeSupports` 构造（只选非零）——0/1 不变量在文件内封闭可
  审计，已写入生产注释；等价仿真在 52 个夹具（含单水平因子的 s=1 退化、
  全同键/全异键、截断 IRLS、`|` 键、重键）上逐位实证。
- 无跨调用状态；PRNG 调用序、跳过 draw 语义、迭代数（逐位同 beta 轨迹）
  全部不变。

### 1.3 相似方案组：单赢家裁决

同族「累加循环化简」按机制分组（基准均为 rows=400/p=60/bootstrap=200 夹具
中位，7 次进程内重复取中位 × 4 次独立进程运行；同码对照两路的进程内位置差
可达 ~45–60 ms，故裁决只用同run差值与跨run方向）：

| 变体 | 机制 | 裁决 |
| --- | --- | --- |
| VAR-A 单位乘法消除 | 加数 `w`/`wz` 直加，`wz` 每行提升 | **落地 S3-C**：对生产同run差 147.7 / 154.6 / 140.9 ms（1.09–1.10×），对冻结参考 1.11–1.13×；三次预落地运行方向一致，稳定高于 ±35 ms 噪声带 |
| VAR-B = A + X′WX 上三角累加+镜像 | (a,b) 与 (b,a) 加数序列逐位相同 ⇒ 只累加 ai≤bi 后镜像（S1-C (b) 拷贝派生同精神） | 淘汰 S3-C-1：每迭代省 n×(s²−s)/2 ≈ 2.4K 次加法被 p²/2 ≈ 1.77K 次镜像拷贝抵消，对 A 边际 −3.3 ~ +9.5 ms 双向抖动 |
| VAR-C = B + 融合单遍 + per-key w / per-(key,y) z 去重 | w=f(mu) 纯函数每键一值；z 每键仅两值；eta/mu 行数组消失 | 淘汰 S3-C-2：对 A 边际 +0.4 ~ +17.6 ms（多为更慢）；且 z 按 y 分支仅在 `y ∈ {0,1}` 类型契约内等价（控制组算术对任意 y 全域成立），防御纵深不值得换噪声 |
| VAR-D = A + 采样四缓冲跨 draw 复用 | PRNG 序与消费值不变，draw 内读取不越 draw | 淘汰 S3-C-3：分配级常数（每 draw 4×n push），对 A 边际 −7.6 ~ +1.8 ms 双向抖动（S2-C-3 同族） |
| 同键贡献批量累加 | — | R2-C 已裁决违逐位（浮点加法非结合），未重提 |

### 1.4 仿真证据

`scripts/round03-r3c-equivalence-sim.ts`（冻结 `451fc7b` 版 S2-C 生产原文为
对照组；`betaQuantileLcb`/`solveSymmetric` 本轮未变、从生产导入，被测差异恰
为 S3-C 编辑；`npx tsx scripts/round03-r3c-equivalence-sim.ts`）：

- **等价**：52 个夹具 ×｛生产、VAR-A、VAR-B、VAR-C、VAR-D｝五路 vs 冻结
  参考——40 个随机夹具 + 空设计 + 全 PASS/全 FAIL 退化 + bootstrap=5
  （INVALID_ESTIMATE 路径）+ 4 行小样本 + `maxIter=3` 截断 IRLS +
  modelVersion 含 `|` + 单水平因子（支撑退化为 {intercept}，压测三角/去重
  的 s=1 角）+ 默认 bootstrap=200 中型夹具 + 重键夹具 + 全异键夹具 +
  **单键混合结局夹具**（30 行同一三元组、y 混合——单键的两个 z 槽位每迭代
  同时活跃）+ 性能夹具本体。effects 的 name/point/lcb/ucb 全部 `Object.is`
  逐位、diagnosis/reason/rowsUsed/estimator/writesActivePointer 逐字。
  **共 14730 项检查全部通过**（4 次独立运行结论逐位一致，含落地后 1 次）。
- **性能**（4 次独立运行，中位 of 7）：对冻结参考 1803.8→1599.2 /
  1786.3→1586.0 / 1801.7→1618.9 ms（1.11–1.13×）；对同run生产（预落地）
  节省 147.7 / 154.6 / 140.9 ms。落地后生产实测 1793.0→1594.6 ms
  （**1.12×**）。累加循环乘法 177,843,236 → 0/报告；迭代数逐位相同
  （全部 effects 逐位 ⇒ beta 轨迹逐位）。
- **交叉验证**：`round02-r2c-equivalence-sim.ts` 全绿且对 S1-C 参考实测
  1912.5→1620.8 ms（**1.18×**，R2-C 时 1.09–1.12×；1.09×1.10≈1.20 吻合）；
  `round01-r1c-equivalence-sim.ts` 全绿且对 bb39570 参考 2404.1→1604.0 ms
  （**1.50×**，R2-C 后为 1.38×；1.38×1.10≈1.52 吻合）；
  `iter2-equivalence-sim.ts` 全绿且 11989.7→1616.0 ms（**7.4×**，S2-C 后
  6.8×；6.8×1.10≈7.5 吻合）。
- **渐近收口**：S3-C 后累加循环每行只剩 s 次 X′Wz 加法 + s² 次 X′WX 加法
  ——加法本身就是被逐位契约锁定的求和项（批量化违结合律，R2-C 已裁决；
  上三角减半被镜像成本抵消，S3-C-1 实证）；每迭代其余成本为 eta 去重的
  Ω(distinct keys × p)（S2-C 下界）、`solveSymmetric` 的 O(p³)+防御性拷贝
  （版本化数值路径 + 公开 readonly 契约本体）与 O(p²) 归零/ridge。每 fit
  其余成本：APC slice+dot 被 X2-2 + S1-C-1 + S2-C-2 + S2-C-4 四面锁定、
  on-prob 站点 S2-C-1、bootstrap 抽样 Ω(draws×rows) 受 PRNG 调用序锁定。
  **本文件第三次达到排除表约束下的可测最优。**

## 2. 全切片裁决（9 文件）

| 文件 | 裁决（一行） |
| --- | --- |
| `offline-logit.ts` | **落地 S3-C**（§1）；同族附加项 S3-C-1..3 实测噪声淘汰；批量累加维持 R2-C「不可行」；X2-1/X2-2/X2-3、S1-C-*、S2-C-* 全部维持 |
| `offline-prob-add.ts` | 与 R1-C/R2-C 裁决一致：S1-C-6/7 维持；`diagnose` lastSegment 观察项维持「只记录不改」（Frozen formula）；全函数亚 ms 级，无新候选 |
| `posterior.ts` | C1/B1/A2 已落地形态；S1-C-2/3/4/5 维持；`Math.pow` 换底数变换为非逐位（X2-3 域）；`betaQuantileLcb` 按 (α,β,p) 记忆化 = X1-1/S1-C-7 同族缓存状态；无新候选 |
| `r1.ts` | S1-C-10/X1-4/X1-6 维持；config spread 与 modelsById 重建 M≤10 常数；无新候选 |
| `r1-shadow-report.ts` | 主路径 A2/B1 后形态；merge 路径仓内不可达（S1-C-2/3）；X1-5 维持；request spread 省略改对象身份（S1-A-7 类）；无新候选 |
| `propensity.ts` | S1-C-8/X3-5 维持；weights 预分配为 n 数百级分配噪声；无新候选 |
| `lin-alg.ts` | 数值路径 + 入参防御性拷贝双锁定（X2-3 + 公开 readonly 契约）；维持 R1-C/R2-C 裁决 |
| `bandit.ts` | S1-C-9/S1-A-8 维持；不可变契约拷贝保留（X4-2 同类）；无新候选 |
| `shadow.ts` | X4-2（decisions 追加拷贝）/S1-C-9 维持；drift/预算扣减 O(1)；无新候选 |

## 3. 候选三条件裁决总表

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| IRLS 累加单位乘法消除 | ✓ 每报告 1.78 亿次乘法与等量向量读 → 0（加法与项序原样保留） | ✓ 14730 项逐位 × 4 runs（含 s=1/单键/截断/`\|` 路径）；IEEE `x*1.0≡x` 恒等 | ✓ 三次预落地运行 140.9–154.6 ms（1.09–1.10×），方向一致 | **落地 S3-C** |
| X′WX 上三角累加+镜像 | ✓ 每迭代省 n×(s²−s)/2 次加法读写 | ✓ (a,b)/(b,a) 加数序列逐位相同，已仿真证明 | ✗ 省项被 p²/2 镜像拷贝抵消，边际 −3.3~+9.5 ms 双向抖动 | S3-C-1 |
| 融合单遍 + per-key w / per-(key,y) z 去重 | ✓ 省 O(n) 拷贝遍 + 重复行的 max/div | ✓ 已仿真证明，但 z 分支仅在 y∈{0,1} 类型契约内等价（控制组算术全域成立） | ✗ 边际 +0.4~+17.6 ms，多为更慢 | S3-C-2 |
| bootstrap 采样缓冲跨 draw 复用 | ✗ 分配级常数（每 draw 4×n push→索引写） | ✓ PRNG 序/消费值不变，draw 内读取不越 draw，已仿真证明 | ✗ 边际 −7.6~+1.8 ms 双向抖动（S2-C-3 同族） | S3-C-3 |
| 同键贡献批量累加 | — | ✗ 浮点加法非结合（R2-C 已裁决） | — | 不可行，未重提 |
| APC off 值去重/免拷贝各式 | — | — | — | X2-2/S1-C-1/S2-C-2/S2-C-4 禁止重开，未重提 |

## 4. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-C-1 | offline-logit IRLS X′WX 上三角累加+镜像拷贝 | 等价（对称单元加数序列逐位相同）且已仿真证明，但每迭代省项被 p²/2 镜像拷贝抵消，对 S3-C 边际 −3.3~+9.5 ms 双向抖动，噪声 |
| S3-C-2 | offline-logit IRLS 融合单遍 + per-key w / per-(key,y) z 去重 | 等价且已仿真证明，但边际 +0.4~+17.6 ms 多为更慢；z 按 y 分支仅在 y∈{0,1} 类型契约内等价，控制组算术全域成立（防御纵深） |
| S3-C-3 | offline-logit bootstrap 采样四缓冲跨 draw 复用 | 分配级常数（S2-C-3 同族），边际 −7.6~+1.8 ms 双向抖动，噪声 |

重开条件：S3-C-1/3 若 p 相对 n×s² 大幅缩小（镜像成本占比下降）或 draw 数
增长 ≥2 个量级，可凭本报告等价性证据重开；S3-C-2 需先推翻「全域算术 vs
类型契约」的防御纵深权衡。

## 5. 测试与验证

环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，与 R1-C/R2-C
同处理）。

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
npx tsx scripts/round03-r3c-equivalence-sim.ts   # ✓ 14730 项逐位 × 4 runs；1.12×
npx tsx scripts/round02-r2c-equivalence-sim.ts   # ✓ 14420 项；1.18×（原 1.09–1.12×,含本轮增量）
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8028 项；1.50×（原 1.38×,含本轮增量）
npx tsx scripts/iter1-equivalence-sim.ts         # ✓（146.8×）
npx tsx scripts/iter2-equivalence-sim.ts         # ✓ 6596 项；7.4×（原 6.8×,含本轮增量）
npx tsx scripts/iter3-equivalence-sim.ts         # ✓ 71351 项
npx tsx scripts/round01-r1f-equivalence-sim.ts   # ✓ 2668 项
npx tsx scripts/r1j-equivalence-sim.ts           # ✓ 2468 项
```

未修改任何测试文件；live 面文件零改动（`test/unit/routing/live-isolation.test.ts`
继续看护）；双 LCB 与双归因两路一行未删。

MORE_OPTIMA=yes
BRANCH=cursor/r3c-offline-routing-c9c8

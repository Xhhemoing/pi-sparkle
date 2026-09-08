MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 4 / R4-C：离线路由切片第四遍 SOTA 打磨

- **战役:** 全库持久 SOTA 优化 Round 4 / R4-C（Round 1–3 同区第四遍）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `9e00288`（Round 1–3 十区全部已合入；本切片已落地 S1-C、S2-C、S3-C）
- **分支:** `cursor/r4-c-offline-routing-fourth-pass-83a1`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读；`git diff ccd4ab4..HEAD -- src/routing/` 核实自 S3-C 落地以来切片零改动，基线区间仅文档更新）

## 结论

**落地 1 项（S4-C）逐位保行为优化**，位于 `lin-alg.ts` 的 `solveSymmetric`
消元内核：CPU profile（V8 `--cpu-prof`，perf 夹具 6 次运行）显示该内核自身
时间占整个 `fitLogitAdditive` 的 **76.6%**（~1370 ms/报告，全程 ~1735 ms）——
前三轮全部在 `irls`/APC 里挖，而 O(p³) 求解器才是绝对主导。消元 k 循环内的
`m[row]`/`m[col]` 与行循环内的 `x[col]` 是循环不变量，但 V8 因元素存储保守
杀死装载而**不自动提升**；把三者提升为局部引用（回代循环同理）是纯代码
移动——浮点运算的集合、值与顺序零改变，每次读写落在完全相同的内存位置与
顺序上，逐位等价由构造成立（S3-C 已落地的 `xtwx[a]` 行提升同一先例，施于
主导内核）。真实规模夹具（rows=400、p=60、bootstrap=200、每报告 8966 次
solve 调用，即 R1-C/R2-C/R3-C 同一夹具）落地前独立基准三次
**1739.7→1121.2 / 1742.3→1073.0 / 1739.8→1069.7 ms**，落地后干净两路对照
**1742.0→1129.0 ms（1.54×，省 613 ms）**——为本切片四轮之最（S1-C ~450 ms、
S2-C ~180 ms、S3-C ~150 ms），远超 ±35 ms 噪声带。每次报告调用消除约
**13.2 亿次**冗余外层数组装载（8966 次调用 × 每次 (n³−n)/3×2 + n(n−1)/2×2）。
**24,888 项逐位一致性检查 × 2 次独立运行全绿**，含 73 个直接内核对抗矩阵
（235 次主元交换、奇异、NaN/∞、±0、n=0/1、factor=0 跳过、非方阵抛错）——
这些是 fit 级夹具无法强制的路径。同族五个变体（免 xCol、死存储跳过、扁平
Float64Array 两式、拷贝重构）按单赢家裁决淘汰记入排除表（S4-C-1..3），另有
三个理论裁决淘汰项（S4-C-4..6）。

这推翻了 R3-C 收口声明中「`solveSymmetric` 的 O(p³)+防御性拷贝是版本化数值
路径 + 公开 readonly 契约本体」的一处过强引申：两把锁分别锁定**浮点运算
序列**（X2-3/X1-3——任何改变结果的算法变更）与**拷贝的存在性**（调用方不
可转移所有权）——都不锁定"对同一内存的冗余重复装载"。与 S2-C 推翻 R1-C、
S3-C 推翻 R2-C 的方式同构：又一类恒等变换（内存访问级）被前轮的锁定语言
误覆盖。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。生产变更仅 `src/routing/lin-alg.ts` 一个文件
（+18/−6，全部为引用提升与注释），`solveSymmetric` 公开签名、错误消息、
防御性拷贝语句 `a.map(row => [...row])`、`[...b]`、eps=1e-12 逐字未动。

## 0. 范围与约束遵守

- 先读并遵守：README / EXCLUSIONS.md（全表）/ round-04/PLAN.md /
  round-01/R1-C.md / round-02/R2-C.md / round-03/R3-C.md。
- 禁止重开项零触碰：X2-3/X1-3（浮点运算序列逐字未动——部分主元选择、消元
  公式、二分、sigmoid 全部原样）、APC 站点四面 X2-2/S1-C-1/S2-C-2/S2-C-4
  （`averagePredictiveComparison` 逐字未动）、X2-1（eta 全量 dot 未动）、
  批量累加（R2-C 裁决维持，未重提）、X1-1（无跨调用状态——所有提升引用
  生命周期限于单次 solve 调用内）、S1-C-1..10 / S2-C-1..5 / S3-C-1..3
  （未重提）。防御性拷贝保留原文（不重开"调用方传所有权"）。
- 公开面零变化：`fitLogitAdditive` 与 `solveSymmetric` 签名、输出字段与
  顺序、reason/错误字符串、bootstrap PRNG 调用序、全部版本化阈值
  （ATTRIBUTION_EFFECT 0.1、QUALITY_FLOOR 0.55、INTERACTION_MIN_N 3、
  MIN_SUCCESSFUL_DRAWS 20、bootstrap 200、IRLS TOL/ridge、二分 80 次）
  逐字不动。`offline-logit.ts` 本轮零改动。
- 仓库变更仅三处：`src/routing/lin-alg.ts`（切片内）、
  `scripts/round04-r4c-equivalence-sim.ts`（本轮仿真回归资产，沿用
  R1-C/R2-C/R3-C 先例，seeded mulberry32）、本报告。

## 1. 剖析发现：成本模型被推翻

前三轮的裁决都以 `irls` 累加/eta/APC 为热点展开；本轮先做 V8 CPU profile
（perf 夹具，warmup 后 5 次重复，采样 ~1.07 ms）验证成本模型：

| 函数（自身时间） | 落地前 | 落地后 |
| --- | --- | --- |
| `solveSymmetric`（lin-alg） | **76.6%（~1370 ms/报告）** | 63.7%（~713 ms/报告） |
| `irls` 自身（eta 去重点积 + 累加） | 13.7% | 22.8% |
| `sigmoid` | 2.1% | 3.3% |
| `fitLogitAdditive` 自身（采样/排序等） | 1.9% | 2.9% |
| lin-alg 匿名回调（防御拷贝 map/spread） | 1.3% | 2.1% |
| `averagePredictiveComparison` | 1.1% | 1.7% |
| GC | 0.6% | 0.6% |

即：S1-C/S2-C/S3-C 三轮优化的全部站点合计不足 20%，主导成本一直在
`solveSymmetric`——每报告 8966 次调用 × (n³−n)/3=71,980 次消元内层迭代
（n=p=60），每次迭代含 2 次可提升的外层数组装载。

## 2. 落地项 S4-C：solveSymmetric 消元内核循环不变量提升

### 2.1 机会与理论

消元内层循环原文为 `m[row]![k] = m[row]![k]! - factor * m[col]![k]!`——
`m[row]` 与 `m[col]` 在 k 循环内是不变量，但每次迭代重新从外层数组 `m`
装载；行循环内 `x[col]` 同理；回代内层 `m[row]` 同理。TurboFan 对"元素存储
是否别名外层数组槽位"的保守假设使这些装载不被自动消除（实测 1.55× 直接
证明）。提升为：

- 消元：`colArr = m[col]`、`pivot = colArr[col]`、`xCol = x[col]` 于行循环
  前；`rowArr = m[row]` 于 k 循环前；
- 回代：`rowArr = m[row]` 于 k 循环前。

每报告消除装载：8966 × [(n³−n)/3 × 2（消元 k 循环）+ n(n−1)/2（x[col]）+
n(n−1)/2（回代）] ≈ **1.32 × 10⁹ 次**。

### 2.2 保行为论证（逐位）

- **纯代码移动**：提升点与最后使用之间没有任何语句重新赋值 `m[col]`、
  `m[row]` 或 `x[col]`——主元交换（唯一写 `m` 槽位的语句）在提升点之前
  执行；消元只写严格位于 `col` 之下各行的**元素**（`rowArr[k] = …`，
  row > col），从不写 `m` 自身的槽位；`x[row]` 写入满足 row > col，不触
  `x[col]`。故每次读写落在与参考实现完全相同的内存位置、以完全相同的顺序
  发生，浮点运算的集合、操作数与顺序零改变 ⇒ 输出逐位相同（不需要任何
  数值引理——比 S3-C 的 IEEE 恒等还要平凡，与其已落地的 `xtwx[a]` 行提升
  同类）。
- **两把既有锁均未触碰**：X2-3 锁"改变浮点结果的数值路径变更"（Cholesky/
  分块改变运算顺序、Newton 改变迭代式）——本项运算序列逐字保留；"防御性
  拷贝=公开 readonly 契约本体"锁拷贝的存在性——拷贝语句原文保留。
- **对抗域直接实证**（fit 级夹具无法强制的路径）：73 个内核矩阵 ×
  {production, 6 变体} vs 冻结 `ccd4ab4` 参考，元素级 `Object.is`——含
  强制主元交换的 SPD（[[1,1.5],[1.5,4]]）与非对称矩阵（共 235 次交换）、
  奇异/全零 → null、NaN/∞ 传播 → null、±0 条目、factor=0 跳过路径、
  n=0/n=1、非方阵/长度不匹配 → 同名同消息 DomainValidationError。
- 无跨调用状态；PRNG 调用序、IRLS 迭代数、beta 轨迹全部逐位不变（52 个
  fit 级夹具实证）。

### 2.3 相似方案组：单赢家裁决

同族"内核内存访问恒等变换"按机制分组（基准均为 rows=400/p=60/bootstrap=200
夹具中位 of 7 交错重复；落地前独立基准 + 落地后进程内赛马双环境）：

| 变体 | 机制 | 裁决 |
| --- | --- | --- |
| VAR-H2 提升 colArr+rowArr+xCol | 纯代码移动 | **落地 S4-C**：独立基准 1742.3→1073.0 / 1739.8→1069.7 ms；落地后干净两路 1742.0→1129.0 ms（1.54×，−613 ms），方向四次运行一致 |
| VAR-H 同上但不提升 xCol | 同 | 被支配：1121.2→1141.6 ms，恒慢于 H2 ~50–70 ms（x[col] 每行一次装载 × 15.9M 行次） |
| VAR-HD = H2 + k 循环起点 col+1（死存储跳过） | 被消元位 m[row][col] 此后不再被读（主元搜索只读后续列、回代只读上三角、交换只移行引用）⇒ 输出逐位 | 淘汰 S4-C-1：两环境方向相反（独立基准比 H 慢 ~80 ms；进程内赛马比 H2 快 ~50 ms）——双向抖动（S3-C-1 同款），且等价论证需额外死存储引理，审计位置弱于纯代码移动 |
| VAR-F 扁平 Float64Array + Int32 行偏移表（O(1) 交换） | 表示变换，运算序不变 | 淘汰 S4-C-2：1720.0 ms ≈ 原生产，几乎无收益——偏移表间接寻址抵消全部所得；V8 对 PACKED_DOUBLE 行数组已是近优布局 |
| VAR-FC 扁平 + 物理行拷贝交换 | 同 | 淘汰 S4-C-2：1585.5 ms，远劣于 H2 |
| VAR-H3 = H2 + 防御拷贝改 for+slice | 拷贝表示变换 | 淘汰 S4-C-3：与 H2 差 1.7 ms（1068.0 vs 1069.7），噪声级；拷贝站点 profile 仅 2.1%。拷贝语句保留原文 |

### 2.4 仿真证据

`scripts/round04-r4c-equivalence-sim.ts`（冻结 `ccd4ab4` 版 `solveSymmetric`
原文为对照组；fit 管线为逐字当前生产 `offline-logit.ts`（本轮未变）仅参数化
solve，故对照-变体差异恰为 solve 编辑、生产导入-对照差异恰为 R4-C 编辑；
`npx tsx scripts/round04-r4c-equivalence-sim.ts`）：

- **场景 1（直接内核）**：73 个矩阵 ×｛生产、H2、H、HD、F、FC、H3｝vs 冻结
  参考，解向量元素级 `Object.is`、null 对 null、抛错对同名同消息——含 30 对
  随机对称/非对称矩阵（n=2..12）、交换链、奇异、NaN/∞、±0、factor=0、
  n=0/1、非方阵。**主元交换实证 235 次**（perf 夹具上为 0 次——生产分布
  对角占优，交换路径必须靠对抗矩阵覆盖，这正是设直接内核场景的原因）。
- **场景 2（全报告）**：52 个夹具 × 7 路 vs 冻结对照——40 个随机夹具 +
  空设计 + 全 PASS/全 FAIL 退化 + bootstrap=5（INVALID_ESTIMATE）+ 4 行
  小样本 + `maxIter=3` 截断 IRLS + modelVersion 含 `|` + 单水平因子 + 默认
  bootstrap=200 中型 + 重键 + 全异键 + 单键混合结局 + 性能夹具本体。
  effects 的 name/point/lcb/ucb 全部 `Object.is` 逐位、diagnosis/reason/
  rowsUsed/estimator/writesActivePointer 逐字。
- **共 24,888 项检查 × 2 次独立运行全部通过**，两次运行结论（含交换计数
  235/0）逐位一致。
- **性能**：干净两路（对照 + 生产导入交错 7 重复）1742.0→1129.0 ms
  （**1.54×**）。注意：仿真内 8 路赛马使参数化 `solve` 调用点超多态、
  对照通胀至 ~2680 ms——该环境下的比率（2.3×）不作为落地依据，落地依据为
  上述干净两路与三次落地前独立基准（方向与幅度一致：−613/−669/−670 ms）。
- **交叉验证**（三份既有仿真的对照均从生产导入 solveSymmetric，故两侧同
  加速、各自轮次的比率保持）：`round03-r3c` 全绿 14,730 项，对 S2-C 冻结
  参考 1321.0→1113.6 ms（1.19×，原 1.12×——solve 变快后 S3-C 相对占比
  上升，方向吻合）；`round02-r2c` 全绿 14,420 项（1.26×，原 1.09–1.12×）；
  `round01-r1c` 全绿 8,028 项（1.64×，原 1.24×）。
- **渐近收口**：S4-C 后消元/回代内层循环每次迭代只剩浮点运算本体（乘、减、
  读写目标元素）——运算序列被 X2-3 锁定；防御性拷贝是公开 readonly 契约
  本体（profile 2.1%，且 H3 实证拷贝表示不是杠杆）；主元搜索 O(n²/2) 的
  Math.abs 与比较是版本化选择规则本体。每迭代其余成本：eta 去重
  Ω(distinct keys × p)（S2-C 下界 + X2-1）、累加加法本体（S3-C 后已无
  乘法）、O(p²) 归零/ridge（memset 级）。每 fit 其余成本：APC 四面锁定
  （自身 1.7%）、on-prob S2-C-1、bootstrap 抽样 Ω(draws×rows) 受 PRNG
  调用序锁定。**本切片在排除表约束下第四次达到可测最优**——但鉴于本轮
  与前两轮相继推翻各自前轮的收口语言，该声明仅限"当前已识别的变换类"。

## 3. 全切片裁决（9 文件）

| 文件 | 裁决(一行) |
| --- | --- |
| `lin-alg.ts` | **落地 S4-C**（§2）；同族 S4-C-1..3 实测淘汰；浮点运算序列（X2-3）与防御拷贝存在性双锁维持——本项在两锁之外 |
| `offline-logit.ts` | 本轮零改动；S1-C/S2-C/S3-C 落地形态维持；理论淘汰 S4-C-4（APC scratch）、S4-C-5（ys 预提取）、S4-C-6（首迭代常量短路）；bootstrap 不可行提前退出违 PRNG 调用序公开面，不立项 |
| `offline-prob-add.ts` | 与前三轮裁决一致：S1-C-6/7 维持；全函数亚 ms 级（betaInterval 数十次 × ~数十 µs）；无新候选 |
| `posterior.ts` | C1/B1/A2 落地形态；S1-C-2/3/4/5 维持；`betacf`/`lnGamma`/二分数值路径锁定（X1-3/X3-4）；无新候选 |
| `r1.ts` | S1-C-10/X1-4/X1-6 维持；M≤10 常数域；无新候选 |
| `r1-shadow-report.ts` | 主路径 A2/B1 后形态；merge 路径仓内不可达（S1-C-2/3）；X1-5 维持；无新候选 |
| `propensity.ts` | S1-C-8/X3-5 维持；n 数百级；无新候选 |
| `bandit.ts` | S1-C-9/S1-A-8 维持；不可变契约拷贝保留（X4-2 同类）；无新候选 |
| `shadow.ts` | X4-2/S1-C-9 维持；drift/预算扣减 O(1)；无新候选 |

## 4. 候选三条件裁决总表

| 候选 | (a) 复杂度下降 | (b) 逐位/契约可证 | (c) 现实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| solveSymmetric 循环不变量提升（colArr/rowArr/xCol + 回代 rowArr） | ✓ 每报告 ~13.2 亿次冗余装载 → 0（浮点运算零变化） | ✓ 24,888 项逐位 × 2 runs，含 235 次主元交换/奇异/非有限/非方阵对抗域；纯代码移动无需数值引理 | ✓ 三次独立基准 −613~−670 ms（1.54–1.62×），四轮之最 | **落地 S4-C** |
| + 死存储跳过（k 从 col+1 起） | ✓ 每调用省 n(n−1)/2 内层迭代 | ✓ 被消元位此后不再被读，已仿真证明 | ✗ 两环境方向相反（+80/−50 ms），双向抖动 | S4-C-1 |
| 扁平 Float64Array（偏移表/行拷贝交换） | —（表示变换） | ✓ 已仿真证明（含 NaN 载荷不可逃逸论证） | ✗ 实测 1720/1585 ms，大幅劣于 H2 | S4-C-2 |
| 防御拷贝 map+spread 改 for+slice | —（分配级） | ✓ 已仿真证明 | ✗ 与 H2 差 1.7 ms，噪声 | S4-C-3 |
| APC off 向量每 fit scratch 缓冲（免 slice 分配，不动共享向量、不记忆化、不改点积输入） | ✓ 每报告 ~27.8 万次分配 → 1 | ✓ 私有缓冲同内容同序读 | ✗ APC 全站点自身仅 1.7%（~19 ms/报告）为收益上界，低于噪声带；S3-C-3 分配级同族 | S4-C-4 |
| irls 每 fit ys 预提取（消除 rows[i].y 每迭代属性读） | ✗ 常数（~3.6M 次属性读/报告） | ✓ 纯拷贝，全域成立 | ✗ 数 ms 级，亚噪声 | S4-C-5 |
| IRLS 首迭代 eta/mu 常量短路（beta=0 ⇒ dot≡+0.0、sigmoid(0)≡0.5） | ✓ 每 fit 省一迭代的 distinct×p 点积 | ✓ +0.0×{0,1}≡+0.0 逐项、和为 +0.0；sigmoid(0)=0.5 精确 | ✗ 仅 ~1% eta 站点（~2 ms），亚噪声 | S4-C-6 |
| bootstrap 不可行提前退出（剩余 draw 数不足 20 时跳出） | ✓ 退化夹具省尾部 draw | ✗ 截断 bootstrap PRNG 调用序（公开面硬不变量） | — | 不可行，不立项 |
| eta 按支撑求和 / 批量累加 / APC off 值去重与免拷贝各式 | — | — | — | X2-1 / R2-C 裁决 / X2-2+S1-C-1+S2-C-2+S2-C-4 禁止重开，未重提 |

## 5. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-C-1 | solveSymmetric 消元 k 循环死存储跳过（起点 col+1） | 输出逐位（被消元位此后不再被读，已仿真证明），但两测量环境方向相反（独立基准比纯提升慢 ~80 ms、进程内赛马快 ~50 ms）——双向抖动（S3-C-1 同款）；且需额外死存储引理，审计位置弱于纯代码移动。重开条件：两环境同向且幅度 > 噪声带 |
| S4-C-2 | solveSymmetric 扁平 Float64Array 内部表示（Int32 偏移表 O(1) 交换 / 物理行拷贝交换两式） | 等价且已仿真证明（NaN 载荷不可逃逸：任何非有限值在返回前被 isFinite 门收敛为 null），但实测 1720/1585 ms 大幅劣于行引用提升的 1070——V8 PACKED_DOUBLE 行数组已是近优布局，手工扁平索引反而击败边界检查消除 |
| S4-C-3 | solveSymmetric 防御拷贝 `a.map(row => [...row])` 改 for+slice | 与赢家差 1.7 ms 噪声级；拷贝站点 profile 仅 2.1% 无杠杆；保留原文维持"拷贝存在性=契约本体"的最小 diff |
| S4-C-4 | APC off 向量每 fit scratch 缓冲复用（免 slice 分配；私有缓冲，不动共享向量、不记忆化、不改点积输入内容与序） | 分配级常数（S3-C-3 同族）；APC 全站点自身时间 1.7%（~19 ms/报告）即收益上界，低于 ±35 ms 噪声带；毗邻四面锁定站点（X2-2/S1-C-1/S2-C-2/S2-C-4），不值得审计面扩张。重开条件：rows/names 增长使 APC 分配占比 ≥ 噪声带 |
| S4-C-5 | irls 每 fit 预提取 ys 数组消除 rows[i].y 每迭代属性读 | 纯拷贝全域等价，但 ~3.6M 次单态属性读/报告仅数 ms，亚噪声 |
| S4-C-6 | IRLS 首迭代 eta/mu 常量短路（beta=0 时 dot≡+0.0、mu≡0.5 可证逐位） | 每 fit 仅省一迭代的 distinct keys × p 点积（~1% eta 站点，~2 ms/报告），亚噪声；增加首迭代特例分支的审计成本 |

## 6. 测试与验证

环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，与 R1-C/R2-C/
R3-C 同处理）。

```bash
pnpm gate        # ✓ typecheck + lint + test(1168 pass / 0 fail / 1 skipped) + build

# 相关子套件
npx tsx --test "test/unit/routing/**/*.test.ts" "test/unit/experiments/**/*.test.ts" \
  "test/integration/m5/**/*.test.ts" "test/integration/m6/**/*.test.ts"
# ✓ 297 pass / 0 fail

# 本轮仿真（两次独立运行，结论逐位一致）+ 全部既有回归资产
npx tsx scripts/round04-r4c-equivalence-sim.ts   # ✓ 24888 项逐位 × 2 runs；干净两路 1.54×
npx tsx scripts/round03-r3c-equivalence-sim.ts   # ✓ 14730 项；1.19×（原 1.12×，对照同享新 solve）
npx tsx scripts/round02-r2c-equivalence-sim.ts   # ✓ 14420 项；1.26×（原 1.09–1.12×）
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8028 项；1.64×（原 1.24×）
npx tsx scripts/iter1-equivalence-sim.ts         # ✓（146.7×）
npx tsx scripts/iter2-equivalence-sim.ts         # ✓ 6596 项
npx tsx scripts/iter3-equivalence-sim.ts         # ✓ 71351 项
npx tsx scripts/round01-r1f-equivalence-sim.ts   # ✓ 2668 项
npx tsx scripts/r1j-equivalence-sim.ts           # ✓ 2468 项
```

未修改任何测试文件；live 面文件零改动（`test/unit/routing/live-isolation.test.ts`
继续看护）；双 LCB 与双归因两路一行未删。

MORE_OPTIMA=yes
BRANCH=cursor/r4-c-offline-routing-fourth-pass-83a1

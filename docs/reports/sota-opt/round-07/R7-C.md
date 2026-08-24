MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 7 / R7-C：离线路由切片第七遍复查报告

- **战役:** 全库持久 SOTA 优化 Round 7 / R7-C（Round 1–6 同区第七遍；重启版——
  首个 R7-C VM 未推送任何分支即 IDLE，本报告为从最新独占 tip 起的全新工作）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `aa05347`（含 S6-C 落地与
  R7-A/B/D/E/G/H 报告合入；`git log 80d103e..aa05347 -- src/routing/` 为空
  ——自 S6-C 落地 `80d103e` 以来切片零字节改动，基线区间仅文档更新。工作
  途中基线由 `d37168c` 前进至 `aa05347`（R7-H 摄入，纯文档），已快进跟随，
  全部测量维持有效）
- **分支:** `cursor/r7-c-offline-routing-seventh-pass-83a1`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读）
- **模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无可落地的新更优解，本轮生产代码零改动**；第七组从未点名角度枚举出的
四个新候选（S7-C-1..4：draws 循环迭代器瘦身、收敛侧有限性检查手写化、
私有缓冲 Float64Array 化、on-prob 闭包消除）全部经理论 + 确定性仿真
（12,617 项逐位检查 × 3 次独立运行全绿，等价结论逐位一致）+ 真实规模
基准裁决后淘汰：一个 µs 级（29.6–30.6 µs/报告）、一个亚噪声带约 40×
（0.78–0.86 ms/报告）、一个零效应（±2 ms 异号）、一个实测负效应
（every 比手写循环快 6ns）。

**但本轮有一项档案级发现，是六轮以来第一次「排除行理由被实证推翻且隐含
落地量达标」**：排除表 X2-1（「eta/dot 按支撑求和」，理由「±0.0 号位
不保逐位」）的排除理由在当前生产形态下**不成立**。三个构造事实——设计
向量元素恰为 0/1、点积累加器从 `let value = 0`（+0.0）起步、IEEE
round-to-nearest 下非零结果与相反数相加均不产 −0.0——联立可证：部分和
永不为 −0.0，故被跳过的每个零项都是逐位无操作、被保留的每项 `1.0·β`
即 `β` 本身（§3.1 引理）。支撑求和变体（SOD）经含专设 ±0.0 对抗夹具的
12,617 项逐位检查 × 3 次独立运行全绿；干净两路对生产导入三次
**+40.7 / +45.4 / +47.4 ms（1.058–1.069×）**——即便背着仿真注入线束
~20 ms 的测量劣势（ctl-vs-prod 决斗实测）仍六次全部越过 ±35 ms 噪声带
（三次多路 + 三次决斗方向一致）；同线束公平对比为 **+63.3 / +63.9 /
+63.0 ms（1.09×）**，落地形态预期收益 ~60 ms 量级。机理：eta 去重点积
从 Ω(distinct keys × p) 松动为 Ω(distinct keys × s̄)（p=60 vs s̄≈4.45，
项数差 13.5×），每报告删除 **74,979,120 次浮点乘法与 ~69.4M 次 ±0.0
加法**、只保留 ~5.6M 次支撑加法。**本轮指令明文禁止重开任何 X* 行，且
硬不变量列明「不改浮点加乘集合（X2-1/X2-3）」——该变换恰是浮点加乘
集合变更，属排除表所有者层级的契约裁决，不在子代理权限内。故只立案
不落地**：完整反驳档案（理论引理 + 对抗夹具 + 六次测量 + 全文仿真）
记录于 §3 与附录，供父代理裁决。若父代理据档案更新 X2-1，SOD 是现成
的、证据齐备的下一个落地项。

成本模型复核（§1）：S6-C 后剖面形状与 R6-C 落地后剖面一致（solveSymmetric
自身 ~55%、irls 自身 ~25%、sigmoid ~5%、编排 ~5%、APC ~2%），R6-C 的
「IRLS/solve 平面除契约级变更外已收口」声明在变换类知识范围内维持成立
——其七类完全分解（装载/浮点/存储/边界检查/循环控制/分派/索引读取）本轮
复核仍无未命名类；X2-1 档案不推翻该枚举逻辑，而是命中其中被点名三锁
（S2-C 下界 + X2-1 + S5-C-5）之一的**理由缺陷**：S2-C（去重本体）与
S5-C-5（串行链不重排）不受影响，SOD 保留项相对序原样、不触数值路径。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。仓库变更仅本报告一个文件；无生产赢家故
未提交新 scripts 资产（败者仿真全文进附录，遵守先例）。

## 0. 范围与约束遵守

- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S6-C /
  S6-C-1..7 与新摄入的 S7-A/B/D/E/G/H 行）→ round-07/PLAN.md →
  round-01/R1-C.md … round-06/R6-C.md → 9 个切片源文件全量重读。
- 基线漂移检查：`git log 80d103e..aa05347 -- src/routing/` 为空（0 提交
  0 文件），S6-C 落地形态（IRLS 累加 `switch(active.length)` s=2..5
  直线化分派、滚动循环 default）原样在位——本轮全部测量在该形态之上，
  未回退未重写（对照组 CTL 即逐字 `80d103e` 生产 irls）。
- 禁止重开项零触碰：S5-C-5 / S5-C-7 / S6-C-1..7 / S1-*..S6-* 全系 /
  S7-A/B/D/E/G/H 全系。候选枚举刻意绕开全部既有排除（§2 各行标注最近邻
  排除行的区分）。**X2-1 行本身未重开**：SOD 变体只存在于临时仿真中用于
  档案测量，生产 `offline-logit.ts` 的 eta 站点仍是全量 `dot(beta,
  vector)` 逐字未动，EXCLUSIONS.md 一行未改。
- 硬不变量全部满足（生产零 diff 下天然成立）：分析不改在飞 run；双 LCB
  与双归因两路一行未删；promotion proposal-first；阈值 / 测试 / 公开
  签名 / CAS / credentials / 数据面契约不动；生产代码内无串行链重排、
  无浮点加乘集合变更。
- 环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，nvm 切换，
  与 R1-C..R6-C 同处理）、pnpm 10.17.1、`pnpm install --frozen-lockfile`。

## 1. 重剖析：S6-C 后成本模型复核

V8 `--cpu-prof`（perf 夹具 rows=400/p=60/bootstrap=200，2 次预热 + 6 次
测量，本 VM 生产每报告 ~736 ms；5714 采样 / 6101 ms 全进程，Node
22.22.2）：

| 函数（自身时间） | 采样合计 | 折合 /报告（8 fits） | 占比 |
| --- | --- | --- | --- |
| `solveSymmetric`（lin-alg） | 3379.1 ms | ~422 ms | **55.4%** |
| `irls` 自身 | 1522.5 ms | **~190 ms** | **25.0%** |
| `fitLogitAdditive` 自身（编排+bootstrap） | 321.4 ms | ~40 ms | 5.3% |
| `sigmoid` | 302.1 ms | ~38 ms | 5.0% |
| `averagePredictiveComparison` | 138.8 ms | ~17 ms | 2.3% |
| lin-alg 匿名回调（防御拷贝） | 128.1 ms | ~16 ms | 2.1% |
| GC | 61.9 ms | ~8 ms | 1.0% |

与 R6-C 落地后剖面（solveSymmetric ~458 / irls ~208 / sigmoid ~38 /
编排 ~35 / 拷贝 ~26 / APC ~21 ms/报告）同形状同量级（VM 差异内），成本
模型无位移；R6-C 干净两路落地量在本 VM 复现（r6c 仿真复跑：冻结 S5-C
对照 780.4 vs 生产 737.4 ms，1.06×，与父代理核验的 780.5/743.9 一致）。
内核形态插桩（同夹具）：**3,586,400 次行访问、1,249,652 次去重点积、
74,979,120 个 mul+add 对/报告**（去重点积平均长度 p=60；行访问支撑直方
与 R6-C 逐位一致 2:63,324 / 3:280,467 / 4:1,210,220 / 5:2,032,389）。

收口复核：R6-C §2.5 对两大热点的七类完全分解本轮逐项过一遍，生产代码侧
无新的未命名成本类。唯一的结构性余量在 eta 去重点积站点——其
Ω(distinct keys × p) 下界当时以三把锁标注（S2-C 下界 + X2-1 + S5-C-5），
其中 **X2-1 一锁的理由本轮被证伪**（§3）：若表所有者接受档案，下界松动
为 Ω(distinct keys × s̄)，13.5× 的项数差即 §3.3 实测收益的来源。其余
两锁不受影响。

## 2. 候选总表（S7-C-1..4，全部淘汰）

本轮第七组从未点名角度：报告级编排迭代器、收敛侧检查形态、私有缓冲
表示、on-prob 闭包消除。全部候选先过排除表相邻行区分，再过逐位仿真
（附录脚本，12,617 项 × 3 次独立运行），最后过真实规模基准。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-C-1 | bootstrap draws 循环 `pointEffects.entries()` → `.keys()`（`offline-logit.ts:482`，该循环只用键不用值；`:495` 的 entries 用值，不动） | 每 draw 免 p 个 `[key,value]` 元组分配（Map 迭代器协议）；键序 = 插入序，两迭代器同序 | ✅ 键序逐一致检查 | 148/148/153 ns/迭代 × 200 draws ≈ **29.6–30.6 µs/报告** | 淘汰：µs 级（验收标准明文拒收）。与 S1-C-1（draws 设计复用）、S3-C-3（缓冲复用抖动）无交集——迭代器形态此前从未点名 |
| S7-C-2 | 收敛侧 `beta.every(Number.isFinite)` → 手写短路循环（`offline-logit.ts:335`，8966 次/报告） | 纸面免回调分派 | ✅ 全电池逐位（FIN 道） | 组件级 every=29ns vs loop=34ns，**delta −6ns**（三次运行同值）；FIN 道多路三次 769.2/763.8/768.7 vs ctl 763.6/764.2/764.4 异号 | 淘汰：**实测负效应/纯抖动**——V8 对 builtin 谓词的 `Array.prototype.every` 已特化，手写循环反付边界检查；上界 −0.05 ms/报告 |
| S7-C-3 | irls 私有 eta/mu 缓冲 `number[]` → `Float64Array`（表示级；存取值逐位同） | 免装箱猜测；但 V8 PACKED_DOUBLE_ELEMENTS 数组本就非装箱连续双精度存储 → 理论收益上界即 0 | ✅ 全电池逐位（F64 道） | F64 道多路三次 763.6/761.6/765.0 vs ctl 763.6/764.2/764.4 **零差**（±2 ms 异号） | 淘汰：零效应——两种表示的装载/存储机器码同形。与 S2-C 无交集（etaByKey/muByKey 本就是 Float64Array，本候选是另两个缓冲）；与 X2-* 无涉（私有缓冲表示，不触任何浮点运算的集合/序） |
| S7-C-4 | `onProbabilitiesFor` `vectors.map(闭包)` → 索引 for 循环（`offline-logit.ts:352`；201 次/报告 = 基线 fit + 200 draws） | 免闭包分配与 map 回调分派 | ✅ 元素级 Object.is | 组件级（400×60）map=33.3–33.6 µs vs indexed=29.3–29.5 µs，delta 3.87–4.29 µs/调用 × 201 ≈ **0.78–0.86 ms/报告** | 淘汰：低于 ±35 ms 噪声带约 40×。与 S2-C-1 无交集——那是「跨列共享一次计算」，本候选是该一次计算自身的循环形态 |

另有两处以既有排除/裁决直接覆盖、不立新 ID：`percentile` 排序副本消除
（每效应每报告一次，亚 µs，S1-C 系 bootstrap 缓冲域）；`fitLogitAdditive`
入口 `rows.map` 行拷贝消除（公开输入防御拷贝 + 每报告一次 O(n)，µs 级）。

## 3. X2-1 反驳档案（只立案，不落地，不重开）

### 3.1 理论：±0.0 跳项恒等引理

生产 eta 站点（S2-C 去重分支内）：`dot(beta, vector)` =
`sum += vector[j] * beta[j]`，j 升序全量 0..p−1，`sum` 从 `0`（+0.0）
起步。X2-1 的候选形态是只对支撑索引求和：
`for (ai) value += beta[active[ai]]`（升序）。

**引理**：设 v₀ = +0.0，v_{k+1} = fl(v_k + t_k)，t_k = fl(x_k·β_k)，
x_k ∈ {0.0, 1.0}，β_k 有限。则跳过全部 x_k=0 项、以 β 直读替代
1.0·β，最终值与每一步部分和逐位不变：

1. x_k = 1.0 ⇒ t_k = β_k **逐位**（IEEE 754 乘以 1.0 精确无舍入，
   含符号与次正规数）。
2. x_k = 0.0 ⇒ t_k = ±0.0（符号随 β_k；β_k 有限故不产 NaN）。
3. **v_k 永不为 −0.0**（归纳）：基例 v₀ = +0.0。归纳步：round-to-nearest
   下 fl(a+b) = −0.0 仅当 a、b 均为 −0.0（非零结果不可能是 −0.0；相反数
   相加与相异号零相加均产 +0.0）——与归纳假设 v_k ≠ −0.0 矛盾。
4. 由 3：对 x_k=0 的项，fl(v_k ± 0.0) = v_k **逐位**（v_k ≠ −0.0 时
   +0.0/−0.0 均为加法单位元；v_k = +0.0 时 +0.0+(±0.0) = +0.0）。∎

三个前提全部由构造成立：设计元素恰为 0/1（`build()` 只写截距与哑元 1，
其余 fill(0)）；累加器 +0.0 起步（`let sum = 0`）；β 进入 eta 计算前
必过 `every(Number.isFinite)` 守卫（不过则整个 fit 早退）。X2-1 原理由
「±0.0 号位不保逐位」只在一般实值设计（x ∉ {0,1}，乘积有舍入）或累加器
可为 −0.0 的起点下成立——本站点两个失效模式都被构造排除。与 X2-3 区分：
不改任何数值路径（sigmoid/solve 原样）；与 S5-C-5 区分：保留项相对序
原样，无任何重排；与 R2-C 批量累加裁决区分：不改累加目标结构。

### 3.2 仿真证据（附录脚本，等价结论三次运行逐位一致）

- **场景 1**（24 个直接 irls 夹具 × SOD vs 逐字 `80d103e` 对照）：支撑
  大小 1..8 全扫（含生产不可达 s=6..8）、~1/3 行共享向量引用与规范键、
  maxIter ∈ {1,3,50}，coefficients 元素级 `Object.is`。
- **场景 1b（专设 ±0.0 对抗夹具）**：`beta0-truncated`（maxIter=1 钉死
  β=0 首迭代——全量 dot 只加 +0.0 项 vs 支撑和只加 +0.0 条目）；
  `negative-beta`（全败哑元驱动负 β，参考侧 0·β 产 −0.0 项，直击原
  排除理由的担忧场景）；`empty-support`（全零向量 s=0 边界：参考 +0.0
  vs 初始 +0.0，生产不可达但钉死引理端点）。
- **场景 2**（53 个全报告夹具 × {生产导入, SOD, F64, FIN} vs 对照）：
  R6-C 电池原样（40 随机 + 空设计 + 全 PASS/FAIL + bootstrap=5 + 4 行
  小样本 + maxIter=3 + `|` 键 + 单水平 + 默认 bootstrap=200 + 重键 +
  全异键 + 单键 + 截距-only s=1）。effects 的 point/lcb/ucb 全
  `Object.is`，diagnosis/reason/rowsUsed/estimator 逐字。
- 合计 **12,617 项 × 3 次独立运行全绿**；4 次决斗进程内另各 250 项全绿。

### 3.3 基准（本 VM，Node 22.22.2）

| 对比 | 三次独立进程 | 说明 |
| --- | --- | --- |
| 干净两路 生产导入 vs SOD | **+45.4 / +40.7 / +47.4 ms**（729.8→684.4、737.9→697.3、730.9→683.5；1.058–1.069×） | SOD 道走 fitWith 参数化线束（irls 注入回调，callsite 多态），背着线束劣势仍三次全越带 |
| 干净两路 ctl vs 生产导入 | +19.9 ms（748.0→728.1） | 线束自身代价的直接测量（ctl 即逐字 S6-C 复刻、仅注入方式不同）——带内，符合预期 |
| 多路赛马（相对序） ctl → SOD | 763.6→700.3 / 764.2→700.3 / 764.4→701.4（**+63.3 / +63.9 / +63.0 ms，1.09×**） | 同线束公平对：两道均走 fitWith，差异恰为 eta 站点单编辑 |

落地形态（生产内直接编辑，无线束）预期收益 ~60 ms 量级。机理与量能
对账：删除 74,979,120 次浮点乘法 + ~69.4M 次 ±0.0 加法，保留 ~5.6M 次
支撑加法（1,249,652 次去重点积 × s̄≈4.453）——被删项约为 irls 自身
时间（~190 ms/报告）中点积站点的绝对主体，与实测 ~60 ms 方向与量级
吻合（点积循环剩余部分为装载与循环控制，V8 无法消除全部）。

### 3.4 裁决与重开条件

本轮指令明文「Do NOT reopen …any other X* row」且硬不变量列明「不改
浮点加乘集合（X2-1/X2-3）」——SOD 恰是浮点加乘集合变更，其解禁属排除表
所有者层级的契约裁决，不在子代理权限内。**故生产零改动，档案全量入册。**

供父代理的重开路径：

1. 审核 §3.1 引理与 §3.2 证据后，由表所有者更新 X2-1 行（建议改写为
   「一般实值设计下不保逐位；0/1 设计 + +0.0 起点 + 有限 β 下已被
   R7-C 档案反驳，可凭该档案落地」）。
2. 重开后落地走 R6-C 先例全流程：生产内直接编辑 + 干净两路 3+ 次 +
   25k 级逐位电池 + r1c–r7c 全部既有仿真交叉重跑（附录脚本可直接改造
   为 round07 落地资产——生产导入侧换新生产、CTL 冻结 `80d103e` 原文）。
3. 失效条件：若设计矩阵未来引入非 0/1 元素（连续特征、行加权），引理
   前提失效，X2-1 原理由恢复效力，SOD 必须回退。

## 4. 全切片裁决（9 文件）

| 文件 | 裁决(一行) |
| --- | --- |
| `offline-logit.ts` | 零改动。S7-C-1..4 实测淘汰（§2）；X2-1 反驳档案立案不落地（§3）；S1-C/S2-C/S3-C/S6-C 落地形态维持逐字；S4-C-4/5/6、S5-C-5/7、S3-C-1..3、R2-C 批量累加裁决全部未重提 |
| `lin-alg.ts` | 零字节改动。S4-C/S5-C 落地形态维持；剖面复核 solveSymmetric 自身 ~422 ms/报告（55.4%）与防御拷贝 ~16 ms/报告——前者五锁（X2-3/S4-C/S5-C 族/S4-C-2/S4-C-3）维持，后者为公开契约拷贝且低于噪声带；S6-C-7 残留微观维持淘汰 |
| `posterior.ts` | C1/B1/A2 落地形态；S1-C-2/3/4/5 维持；`betacf`/`lnGamma`/二分 80 次数值路径锁定（X1-3/X3-4）；本轮重读无新候选 |
| `offline-prob-add.ts` | S1-C-6/7 维持；公式冻结（双归因 X0-11 一翼），全函数亚 ms；无新候选 |
| `r1.ts` | S1-C-10/X1-4/X1-6 维持；M≤10 常数域；无新候选 |
| `r1-shadow-report.ts` | 主路径 A2/B1 后形态；merge 路径仓内不可达（S1-C-2/3）；X1-5 维持；无新候选 |
| `propensity.ts` | S1-C-8/X3-5 维持；n 数百级、每报告一次；无新候选 |
| `bandit.ts` | S1-C-9/S1-A-8 维持；不可变契约拷贝保留（X4-2 同类）；无新候选 |
| `shadow.ts` | X4-2/S1-C-9 维持；drift/预算扣减 O(1)；无新候选 |

## 5. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-C-1 | bootstrap draws 循环 `pointEffects.entries()` 改 `.keys()` | 等价平凡（同插入序）但 148–153 ns/迭代 × 200 draws ≈ 29.6–30.6 µs/报告——µs 级明文拒收。重开：draws 或 p 增长 ≥2 个数量级 |
| S7-C-2 | 收敛侧 `beta.every(Number.isFinite)` 换手写短路循环 | 实测负效应：every=29ns vs loop=34ns（三次同值，V8 对 builtin 谓词已特化）；FIN 全道多路三次异号纯抖动；上界 −0.05 ms/报告 |
| S7-C-3 | irls 私有 eta/mu 缓冲 number[] 改 Float64Array | 零效应：PACKED_DOUBLE_ELEMENTS 与 Float64Array 装载/存储同形，多路三次 ±2 ms 异号；表示级编辑无收益面 |
| S7-C-4 | `onProbabilitiesFor` map+闭包改索引循环 | 等价且已仿真证明，但 3.87–4.29 µs/调用 × 201 fits ≈ 0.78–0.86 ms/报告，低于噪声带 ~40×。重开：rows 或 fits 增长 ≥2 个数量级使其达 ms 数十级 |

X2-1 **不在此表**（未重开、未改行）：§3 档案供表所有者裁决，重开条件
见 §3.4。切片级收口条件维持 R6-C §2.5 的七类分解声明，外加本轮新增
限定：其中 eta 点积站点的 Ω(distinct keys × p) 下界之 X2-1 锁的理由
已被档案反驳——收口声明的效力此后**以表所有者对该档案的裁决为准**。

## 6. 测试与验证

环境：Node 22.22.2（nvm；VM 默认 22.14.0 低于 engines）、pnpm 10.17.1。
生产代码零改动，测试文件零改动。

```bash
pnpm typecheck && pnpm lint && pnpm build    # ✓ 全绿（零 diff 基线自证）

# 本轮仿真（临时脚本，未入库——无生产赢家，全文见附录）
npx tsx /tmp/r7c-sim.mts          # ✓ 12,617 项逐位 × 3 次独立运行，结论逐位一致
npx tsx /tmp/r7c-sim.mts --duel prod,sod   # ✓ 250 项 + 决斗计时（×3 独立进程）
npx tsx /tmp/r7c-sim.mts --duel ctl,prod   # ✓ 250 项 + 线束代价锚点

# 既有回归资产复跑（本 VM 锚点）
npx tsx scripts/round06-r6c-equivalence-sim.ts
# ✓ 25,483 项逐位全绿；冻结 S5-C 对照 780.4 vs 生产 737.4 ms（1.06×）
#   ——与父代理核验值 780.5/743.9 同带
```

代表性一次全量运行输出：

```text
scenario 1 (direct irls bitwise equivalence, 24 fixtures x {SOD, F64, FIN} vs verbatim 80d103e irls; support sizes: 1,2,3,4,5,6,7,8)
scenario 1b (SOD adversarial signed-zero / beta=0 / empty-support fixtures)
scenario 2 (full-report bitwise equivalence, 53 cases x {production, SOD, F64, FIN} vs verbatim 80d103e irls under the verbatim production pipeline)
S7-C-1 bench entries-vs-keys (60-entry map): entries=273ns keys=125ns delta/iter=148ns -> per report (x200 draws) ~29.6us
S7-C-4 bench onProbabilitiesFor (400x60): map=33.3us indexed=29.4us delta=3.89us -> per report (x201 fits) ~0.78ms
S7-C-2 bench finite-check (p=60): every=29ns loop=34ns delta=-6ns -> per report (x8966 iters) ~-0.05ms
perf fixture eta site: rowVisits=3586400 dedupDots=1249652 dotTerms=74979120 (mul+add pairs) -> SOD would keep ~5.6M support adds of 75.0M
perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps (multi-way, relative order only):
  ctl (80d103e S6-C)   763.6 ms  (1.00x vs ctl)
  production           740.3 ms  (1.03x vs ctl)
  VAR-SOD              700.3 ms  (1.09x vs ctl)
  VAR-F64              763.6 ms  (1.00x vs ctl)
  VAR-FIN              769.2 ms  (0.99x vs ctl)

ALL EQUIVALENCE CHECKS PASSED (12617 bitwise checks)
```

决斗输出（三次独立进程 + 线束锚点）：

```text
duel prod vs sod: prod=729.8ms sod=684.4ms delta=45.4ms (1.066x)
duel prod vs sod: prod=737.9ms sod=697.3ms delta=40.7ms (1.058x)
duel prod vs sod: prod=730.9ms sod=683.5ms delta=47.4ms (1.069x)
duel ctl vs prod: ctl=748.0ms prod=728.1ms delta=19.9ms (1.027x)
```

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装；
决斗模式 `npx tsx <file> --duel prod,sod`）。若父代理裁决重开 X2-1，
本脚本可直接改造为 `scripts/round07-r7c-equivalence-sim.ts` 落地资产。

```ts
/**
 * Round 7 / R7-C deterministic equivalence + benchmark simulation
 * (offline routing slice, seventh pass). NOT committed: no production winner
 * this round — full source goes into the R7-C report appendix.
 *
 * Adjudicated lanes (all measured against CTL = verbatim 80d103e production
 * irls, i.e. the landed S6-C form; every already-excluded edit UNAPPLIED):
 *
 *   PROD  production import (equivalence anchor; must match CTL bitwise)
 *   SOD   eta site: dot(beta, vector) summed over the support only
 *         (Σ beta[active[ai]] ascending). THIS IS X2-1's ROW — measured as a
 *         refutation dossier ONLY (round instructions forbid reopening);
 *         nothing is landed. Theory: the 0/1 design + finite beta + sum
 *         starting at +0.0 make every skipped zero term a bitwise no-op —
 *         a partial sum can never be -0.0 (IEEE round-to-nearest yields
 *         -0.0 from x+y only when both are -0.0), and adding ±0.0 to a
 *         non-(-0.0) value is the identity.
 *   F64   S7-C-3 candidate: irls-private eta/mu buffers number[] ->
 *         Float64Array (representation only; stores exact doubles).
 *   FIN   S7-C-2 candidate: convergence-side finite check
 *         beta.every(Number.isFinite) -> hand-written short-circuit loop.
 *
 * Component-level candidates (replica-vs-replica micro benches + targeted
 * equivalence):
 *   S7-C-1 bootstrap draws loop `pointEffects.entries()` -> `.keys()`
 *   S7-C-4 onProbabilitiesFor vectors.map(closure) -> indexed for loop
 *
 * Modes:
 *   (default)          equivalence battery + instrumentation + micro benches
 *                      + in-process multi-way race (relative order only)
 *   --duel A,B         clean two-lane: exactly two racers, 7 interleaved
 *                      reps, median (landing-grade numbers; run in 3+
 *                      independent processes)
 *
 * Run: npx tsx /tmp/r7c-sim.mts [--duel ctl,sod]
 */

import { fitLogitAdditive } from "/workspace/src/routing/offline-logit.js";
import { solveSymmetric } from "/workspace/src/routing/lin-alg.js";
import { betaQuantileLcb } from "/workspace/src/routing/posterior.js";
import type { AttributionReport, OfflineRow } from "/workspace/src/routing/offline-types.js";

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;

interface Design {
  readonly names: readonly string[];
  readonly columnIndex: ReadonlyMap<string, number>;
  build(row: Row, skip?: string): number[];
  readonly referenceLevels: ReadonlyArray<{ factor: "a" | "u" | "v"; name: string }>;
}

interface Row {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
}

interface FitResult {
  readonly coefficients: readonly number[] | null;
}

type IrlsImpl = (
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number
) => FitResult;

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function buildDesign(rows: readonly Row[]): Design {
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))];
  const models = [...new Set(rows.map((r) => r.modelVersion))];
  const projects = [...new Set(rows.map((r) => r.projectId))];
  const dropLast = (levels: readonly string[]): string[] =>
    levels.slice(0, Math.max(0, levels.length - 1));
  const scenarioLevels = dropLast(scenarios);
  const modelLevels = dropLast(models);
  const projectLevels = dropLast(projects);

  const pairCounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.modelVersion}|${row.projectId}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const interactionPairs = [...pairCounts.entries()]
    .filter(([, n]) => n >= INTERACTION_MIN_N)
    .map(([key]) => key);

  const names = [
    "intercept",
    ...scenarioLevels.map((s) => `a:${s}`),
    ...modelLevels.map((m) => `u:${m}`),
    ...projectLevels.map((p) => `v:${p}`),
    ...interactionPairs.map((key) => `w:${key}`)
  ];
  const columnIndex = new Map(names.map((name, index) => [name, index] as const));
  const interactionPairSet = new Set(interactionPairs);

  const referenceLevels: Array<{ factor: "a" | "u" | "v"; name: string }> = [];
  const lastModel = models[models.length - 1];
  const lastProject = projects[projects.length - 1];
  if (lastModel !== undefined) referenceLevels.push({ factor: "u", name: lastModel });
  if (lastProject !== undefined) referenceLevels.push({ factor: "v", name: lastProject });

  return {
    names,
    columnIndex,
    referenceLevels,
    build(row: Row, skip?: string): number[] {
      const vec = new Array<number>(names.length).fill(0);
      vec[0] = 1;
      const set = (name: string): void => {
        if (name === skip) return;
        const index = columnIndex.get(name);
        if (index !== undefined && index > 0) vec[index] = 1;
      };
      if (row.scenarioId !== scenarios[scenarios.length - 1]) set(`a:${row.scenarioId}`);
      if (row.modelVersion !== models[models.length - 1]) set(`u:${row.modelVersion}`);
      if (row.projectId !== projects[projects.length - 1]) set(`v:${row.projectId}`);
      const pairKey = `${row.modelVersion}|${row.projectId}`;
      if (interactionPairSet.has(pairKey)) set(`w:${pairKey}`);
      return vec;
    }
  };
}

function computeSupports(vectors: readonly number[][]): number[][] {
  return vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
}

function canonicalRowKeys(rows: readonly Row[]): number[] {
  const byScenario = new Map<string, Map<string, Map<string, number>>>();
  const keys = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let byModel = byScenario.get(row.scenarioId);
    if (byModel === undefined) {
      byModel = new Map();
      byScenario.set(row.scenarioId, byModel);
    }
    let byProject = byModel.get(row.modelVersion);
    if (byProject === undefined) {
      byProject = new Map();
      byModel.set(row.modelVersion, byProject);
    }
    let canonical = byProject.get(row.projectId);
    if (canonical === undefined) {
      canonical = i;
      byProject.set(row.projectId, canonical);
    }
    keys[i] = canonical;
  }
  return keys;
}

/* ------------------------------------------------------------------- */
/* Shared S6-C accumulation body (verbatim in every lane).              */
/* Kept as a snippet-inliner so each lane below stays a faithful copy   */
/* of production with EXACTLY ONE edit.                                 */
/* ------------------------------------------------------------------- */

/* eslint-disable no-inner-declarations */

function accumulate(
  xtwx: number[][],
  xtwz: number[],
  active: readonly number[],
  w: number,
  wz: number
): void {
  switch (active.length) {
    case 5: {
      const a0 = active[0]!;
      const a1 = active[1]!;
      const a2 = active[2]!;
      const a3 = active[3]!;
      const a4 = active[4]!;
      xtwz[a0] = xtwz[a0]! + wz;
      const r0 = xtwx[a0]!;
      r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w; r0[a3] = r0[a3]! + w; r0[a4] = r0[a4]! + w;
      xtwz[a1] = xtwz[a1]! + wz;
      const r1 = xtwx[a1]!;
      r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w; r1[a3] = r1[a3]! + w; r1[a4] = r1[a4]! + w;
      xtwz[a2] = xtwz[a2]! + wz;
      const r2 = xtwx[a2]!;
      r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w; r2[a3] = r2[a3]! + w; r2[a4] = r2[a4]! + w;
      xtwz[a3] = xtwz[a3]! + wz;
      const r3 = xtwx[a3]!;
      r3[a0] = r3[a0]! + w; r3[a1] = r3[a1]! + w; r3[a2] = r3[a2]! + w; r3[a3] = r3[a3]! + w; r3[a4] = r3[a4]! + w;
      xtwz[a4] = xtwz[a4]! + wz;
      const r4 = xtwx[a4]!;
      r4[a0] = r4[a0]! + w; r4[a1] = r4[a1]! + w; r4[a2] = r4[a2]! + w; r4[a3] = r4[a3]! + w; r4[a4] = r4[a4]! + w;
      break;
    }
    case 4: {
      const a0 = active[0]!;
      const a1 = active[1]!;
      const a2 = active[2]!;
      const a3 = active[3]!;
      xtwz[a0] = xtwz[a0]! + wz;
      const r0 = xtwx[a0]!;
      r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w; r0[a3] = r0[a3]! + w;
      xtwz[a1] = xtwz[a1]! + wz;
      const r1 = xtwx[a1]!;
      r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w; r1[a3] = r1[a3]! + w;
      xtwz[a2] = xtwz[a2]! + wz;
      const r2 = xtwx[a2]!;
      r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w; r2[a3] = r2[a3]! + w;
      xtwz[a3] = xtwz[a3]! + wz;
      const r3 = xtwx[a3]!;
      r3[a0] = r3[a0]! + w; r3[a1] = r3[a1]! + w; r3[a2] = r3[a2]! + w; r3[a3] = r3[a3]! + w;
      break;
    }
    case 3: {
      const a0 = active[0]!;
      const a1 = active[1]!;
      const a2 = active[2]!;
      xtwz[a0] = xtwz[a0]! + wz;
      const r0 = xtwx[a0]!;
      r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w;
      xtwz[a1] = xtwz[a1]! + wz;
      const r1 = xtwx[a1]!;
      r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w;
      xtwz[a2] = xtwz[a2]! + wz;
      const r2 = xtwx[a2]!;
      r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w;
      break;
    }
    case 2: {
      const a0 = active[0]!;
      const a1 = active[1]!;
      xtwz[a0] = xtwz[a0]! + wz;
      const r0 = xtwx[a0]!;
      r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w;
      xtwz[a1] = xtwz[a1]! + wz;
      const r1 = xtwx[a1]!;
      r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w;
      break;
    }
    default: {
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai]!;
        xtwz[a] = xtwz[a]! + wz;
        const rowA = xtwx[a]!;
        for (let bi = 0; bi < active.length; bi++) {
          const b = active[bi]!;
          rowA[b] = rowA[b]! + w;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------- */
/* CTL: verbatim 80d103e production irls (landed S6-C form).            */
/* ------------------------------------------------------------------- */

const irlsCtl: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* ------------------------------------------------------------------- */
/* SOD (X2-1 refutation dossier — measurement only, NOT landed):        */
/* eta = Σ beta[active[ai]] ascending, replacing dot(beta, vector).     */
/* Single edit vs CTL: the dot call inside the stamp branch.            */
/* ------------------------------------------------------------------- */

const irlsSOD: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const active = supports[i]!;
        let value = 0;
        for (let ai = 0; ai < active.length; ai++) value += beta[active[ai]!]!;
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* ------------------------------------------------------------------- */
/* F64 (S7-C-3): eta/mu buffers as Float64Array. Single edit vs CTL.    */
/* ------------------------------------------------------------------- */

const irlsF64: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Float64Array(n);
  const mu = new Float64Array(n);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* ------------------------------------------------------------------- */
/* FIN (S7-C-2): finite check as a hand-written short-circuit loop.     */
/* Single edit vs CTL.                                                  */
/* ------------------------------------------------------------------- */

const irlsFIN: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    let allFinite = true;
    for (let d = 0; d < p; d++) {
      if (!Number.isFinite(beta[d]!)) {
        allFinite = false;
        break;
      }
    }
    if (!allFinite) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* Instrumented lane: counts eta-dot invocations and their total flops. */
let etaDotCalls = 0;
let etaDotTerms = 0;
let etaRowVisits = 0;
const irlsCounting: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      etaRowVisits++;
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        etaDotCalls++;
        etaDotTerms += vectors[i]!.length;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* ---------------------- rest of the verbatim pipeline ---------------------- */

function onProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  return vectors.map((vector) => sigmoid(dot(coefficients, vector)));
}

/* S7-C-4 candidate form (component-level): indexed loop, no closure/map. */
function onProbabilitiesForIndexed(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  const out = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    out[i] = sigmoid(dot(coefficients, vectors[i]!));
  }
  return out;
}

function averagePredictiveComparison(
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined && columnIdx !== 0) {
    for (let i = 0; i < rows.length; i++) {
      if (vectors[i]![columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      const offVector = vectors[i]!.slice();
      offVector[columnIdx] = 0;
      const off = sigmoid(dot(coefficients, offVector));
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

function percentile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! * (hi - index) + sortedValues[hi]! * (index - lo);
}

function modelOf(effectName: string): string {
  return effectName.slice("u:".length);
}

function pushValue(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function uncertainReport(rowsUsed: number, reason: string): AttributionReport {
  return {
    estimator: "logit-additive",
    rowsUsed,
    effects: [],
    diagnosis: "uncertain",
    reason,
    writesActivePointer: false
  };
}

function fitWith(
  irlsImpl: IrlsImpl,
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;

  const baseRows: Row[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y
  }));
  const effects: Array<{ name: string; point: number; lcb: number; ucb: number }> = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  const fit = irlsImpl(design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
  if (fit.coefficients === null) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = onProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      averagePredictiveComparison(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = rng(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    const sample: Row[] = [];
    const sampleVectors: number[][] = [];
    const sampleSupports: number[][] = [];
    const sampleKeys: number[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
      sampleKeys.push(keys[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = irlsImpl(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = onProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = averagePredictiveComparison(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      pushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return uncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: percentile(values, 0.025),
      ucb: percentile(values, 0.975)
    });
  }

  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = new Set(baseRows.map((r) => r.modelVersion)).size;
  const projects = new Set(baseRows.map((r) => r.projectId)).size;
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: { lcb: number; ucb: number }): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionsFor = (prefix: string): Array<{ name: string; lcb: number; ucb: number }> =>
    effects.filter((e) => e.name.startsWith(`w:${prefix}`));

  let diagnosis: AttributionReport["diagnosis"] = "uncertain";
  const scenarioHard = muLcb < QUALITY_FLOOR && models >= 2 && projects >= 3;
  if (
    effects.some(
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(modelOf(e.name)).every(containsZero)
    )
  ) {
    diagnosis = "model-problem";
  } else if (
    effects.some(
      (e) =>
        e.name.startsWith("v:") &&
        e.lcb < -ATTRIBUTION_EFFECT &&
        effects
          .filter((w) => w.name.startsWith("w:") && w.name.endsWith(`|${e.name.slice("v:".length)}`))
          .every(containsZero)
    )
  ) {
    diagnosis = "project-problem";
  } else if (effects.some((e) => e.name.startsWith("w:") && e.lcb < -ATTRIBUTION_EFFECT)) {
    diagnosis = "interaction-only";
  } else if (scenarioHard) {
    diagnosis = "scenario-hard";
  }

  return {
    estimator: "logit-additive",
    rowsUsed: baseRows.length,
    effects,
    diagnosis,
    reason: diagnosis === "uncertain" ? "no effect beyond threshold or intervals too wide" : `${diagnosis} beyond the ${ATTRIBUTION_EFFECT} effect threshold`,
    writesActivePointer: false
  };
}

/* ------------------------------ harness ------------------------------ */

let checksPassed = 0;
let failures = 0;

function check(label: string, ok: boolean): void {
  if (ok) checksPassed++;
  else {
    failures++;
    process.stderr.write(`FAIL ${label}\n`);
  }
}

function compareReports(label: string, expected: AttributionReport, actual: AttributionReport): void {
  check(`${label}.estimator`, expected.estimator === actual.estimator);
  check(`${label}.rowsUsed`, expected.rowsUsed === actual.rowsUsed);
  check(`${label}.diagnosis`, expected.diagnosis === actual.diagnosis);
  check(`${label}.reason`, expected.reason === actual.reason);
  check(`${label}.writesActivePointer`, expected.writesActivePointer === actual.writesActivePointer);
  check(`${label}.effects.length`, expected.effects.length === actual.effects.length);
  if (expected.effects.length === actual.effects.length) {
    for (let i = 0; i < expected.effects.length; i++) {
      const e = expected.effects[i]!;
      const g = actual.effects[i]!;
      check(`${label}.effects[${i}].name`, e.name === g.name);
      check(`${label}.effects[${i}].point`, Object.is(e.point, g.point));
      check(`${label}.effects[${i}].lcb`, Object.is(e.lcb, g.lcb));
      check(`${label}.effects[${i}].ucb`, Object.is(e.ucb, g.ucb));
    }
  }
}

function compareFits(label: string, expected: FitResult, actual: FitResult): void {
  const en = expected.coefficients === null;
  const an = actual.coefficients === null;
  check(`${label}.null`, en === an);
  if (expected.coefficients !== null && actual.coefficients !== null) {
    check(`${label}.length`, expected.coefficients.length === actual.coefficients.length);
    if (expected.coefficients.length === actual.coefficients.length) {
      for (let i = 0; i < expected.coefficients.length; i++) {
        check(`${label}[${i}]`, Object.is(expected.coefficients[i], actual.coefficients[i]));
      }
    }
  }
}

/* ------------------------------ fixtures ------------------------------ */

function fixtureRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

function randomRows(
  r: () => number,
  options: {
    scenarios: number;
    models: number;
    projects: number;
    rows: number;
    passRate: number;
    pipeInModel?: boolean;
  }
): OfflineRow[] {
  const scenarios = Array.from({ length: options.scenarios }, (_, i) => `fam${i}|role${i % 2}`);
  const models = Array.from({ length: options.models }, (_, i) =>
    options.pipeInModel === true && i === 0 ? "weird|model-0" : `model-${i}`
  );
  const projects = Array.from({ length: options.projects }, (_, i) => `prj_${i}`);
  const rows: OfflineRow[] = [];
  for (let i = 0; i < options.rows; i++) {
    const modelVersion = pick(r, models);
    const rate = modelVersion === models[0] ? options.passRate * 0.4 : options.passRate;
    rows.push({
      scenarioId: pick(r, scenarios),
      modelVersion,
      projectId: pick(r, projects),
      y: r() < rate ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

function allUniqueRows(r: () => number, count: number): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      scenarioId: `s${i % 2}`,
      modelVersion: `m${i}`,
      projectId: `p${i}`,
      y: r() < 0.6 ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

function batteryCases(): Array<{ rows: OfflineRow[]; options?: { maxIter?: number; bootstrap?: number; seed?: number } }> {
  const r = fixtureRng(0x3c01);
  const cases: Array<{ rows: OfflineRow[]; options?: { maxIter?: number; bootstrap?: number; seed?: number } }> = [];

  for (let i = 0; i < 40; i++) {
    cases.push({
      rows: randomRows(r, {
        scenarios: 1 + Math.floor(r() * 3),
        models: 1 + Math.floor(r() * 4),
        projects: 1 + Math.floor(r() * 4),
        rows: 10 + Math.floor(r() * 90),
        passRate: 0.3 + r() * 0.6,
      }),
      options: { bootstrap: 25 + Math.floor(r() * 40), seed: 1 + Math.floor(r() * 10_000) },
    });
  }
  cases.push({ rows: [] });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: 2 }),
  });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: -1 }),
  });
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 2, rows: 30, passRate: 0.6 }),
    options: { bootstrap: 5, seed: 42 },
  });
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 1, rows: 4, passRate: 0.5 }),
    options: { bootstrap: 30, seed: 7 },
  });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 3, projects: 2, rows: 40, passRate: 0.5 }),
    options: { maxIter: 3, bootstrap: 30, seed: 11 },
  });
  cases.push({
    rows: randomRows(r, {
      scenarios: 2,
      models: 3,
      projects: 3,
      rows: 60,
      passRate: 0.55,
      pipeInModel: true,
    }),
    options: { bootstrap: 30, seed: 99 },
  });
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 1, projects: 1, rows: 24, passRate: 0.5 }),
    options: { bootstrap: 40, seed: 3 },
  });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 3, projects: 3, rows: 50, passRate: 0.6 }),
  });
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 2, rows: 80, passRate: 0.55 }),
    options: { bootstrap: 40, seed: 21 },
  });
  cases.push({
    rows: allUniqueRows(r, 36),
    options: { bootstrap: 40, seed: 23 },
  });
  {
    const oneKey: OfflineRow[] = [];
    for (let i = 0; i < 30; i++) {
      oneKey.push({
        scenarioId: "s0",
        modelVersion: "m0",
        projectId: "p0",
        y: i % 3 === 0 ? 0 : 1,
        occurredAtMs: 1_000 + i,
      });
    }
    cases.push({ rows: oneKey, options: { bootstrap: 40, seed: 31 } });
  }
  cases.push({
    rows: [
      { scenarioId: "s0", modelVersion: "m0", projectId: "p0", y: 1, occurredAtMs: 1_000 },
      { scenarioId: "s0", modelVersion: "m0", projectId: "p0", y: 0, occurredAtMs: 1_001 },
    ],
    options: { bootstrap: 30, seed: 5 },
  });
  return cases;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const fail = (line: string): void => {
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
};

const VARIANTS: Array<[string, IrlsImpl]> = [
  ["SOD", irlsSOD],
  ["F64", irlsF64],
  ["FIN", irlsFIN],
];

/* -------- scenario 1: direct irls bitwise equivalence (s = 1..8) -------- */

function directDesign(p: number): Design {
  return {
    names: Array.from({ length: p }, (_, i) => `c${i}`),
    columnIndex: new Map(),
    referenceLevels: [],
    build(): number[] {
      throw new Error("direct-irls fixtures never call design.build");
    }
  };
}

function directKeys(vectors: readonly number[][]): number[] {
  const seen = new Map<string, number>();
  const keys = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const sig = vectors[i]!.join(",");
    const canonical = seen.get(sig);
    if (canonical === undefined) {
      seen.set(sig, i);
      keys[i] = i;
    } else {
      keys[i] = canonical;
    }
  }
  return keys;
}

function scenarioDirectIrls(): void {
  const r = fixtureRng(0x7c01);
  let fixtures = 0;
  const supportSizes = new Set<number>();
  for (let t = 0; t < 24; t++) {
    const p = 6 + Math.floor(r() * 7);
    const n = 5 + Math.floor(r() * 36);
    const vectors: number[][] = [];
    const rows: Row[] = [];
    for (let j = 0; j < n; j++) {
      if (j > 0 && r() < 0.35) {
        const k = Math.floor(r() * j);
        vectors.push(vectors[k]!);
      } else {
        const vec = new Array<number>(p).fill(0);
        vec[0] = 1;
        const extra = (j + t) % 8;
        const cols = new Set<number>();
        while (cols.size < Math.min(extra, p - 1)) {
          cols.add(1 + Math.floor(r() * (p - 1)));
        }
        for (const c of cols) vec[c] = 1;
        vectors.push(vec);
      }
      rows.push({ scenarioId: "s", modelVersion: "m", projectId: "p", y: r() < 0.5 ? 1 : 0 });
    }
    const supports = computeSupports(vectors);
    for (const s of supports) supportSizes.add(s.length);
    const keys = directKeys(vectors);
    const design = directDesign(p);
    const maxIter = t % 3 === 0 ? 1 : t % 3 === 1 ? 3 : 50;
    const expected = irlsCtl(design, rows, vectors, supports, keys, n, maxIter);
    for (const [name, impl] of VARIANTS) {
      compareFits(`direct[${t}].${name}`, expected, impl(design, rows, vectors, supports, keys, n, maxIter));
    }
    fixtures++;
  }
  for (let s = 1; s <= 6; s++) {
    check(`direct.support-size-${s}-covered`, supportSizes.has(s));
  }
  out(
    `scenario 1 (direct irls bitwise equivalence, ${fixtures} fixtures x {SOD, F64, FIN} vs ` +
      `verbatim 80d103e irls; support sizes: ${[...supportSizes].sort((a, b) => a - b).join(",")})`
  );
}

/* --------- scenario 1b: adversarial signed-zero fixtures for SOD --------- */

function scenarioSignedZero(): void {
  // Force negative and mixed-sign beta trajectories, tiny etas near zero,
  // shared references, and the empty-support edge. Every check is Object.is,
  // so a -0.0 vs +0.0 divergence in eta would surface as a coefficient or
  // report mismatch downstream (sigmoid(±0) = 0.5 either way, but eta feeds
  // z = eta + (y - mu)/w directly, where -0.0 + x differs from +0.0 + x
  // only at x = ±0.0 — also covered by the maxIter=1 beta=0 fixtures here).
  const design = directDesign(6);
  const mk = (vecs: number[][], ys: Array<0 | 1>, maxIter: number, label: string): void => {
    const rows: Row[] = ys.map((y) => ({ scenarioId: "s", modelVersion: "m", projectId: "p", y }));
    const supports = computeSupports(vecs);
    const keys = directKeys(vecs);
    const expected = irlsCtl(design, rows, vecs, supports, keys, rows.length, maxIter);
    compareFits(`zero[${label}]`, expected, irlsSOD(design, rows, vecs, supports, keys, rows.length, maxIter));
  };
  // beta = 0 first iteration: full dot adds 0*1 and 0*0 terms (+0.0 each);
  // support-only sums +0.0 entries. maxIter=1 pins the beta=0 eta exactly.
  mk(
    [
      [1, 0, 1, 0, 0, 0],
      [1, 1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 1],
    ],
    [1, 0, 1],
    1,
    "beta0-truncated"
  );
  // Mixed-sign betas (uniformly failing dummy drives a negative coefficient);
  // zero terms then multiply negative betas: reference adds -0.0 terms.
  mk(
    [
      [1, 1, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 0, 1, 0],
      [1, 0, 0, 0, 1, 0],
    ],
    [0, 0, 1, 1, 1, 0, 1, 1],
    50,
    "negative-beta"
  );
  // All-zero vector (empty support): full dot = +0.0 via 0-terms only;
  // support-only sum = initial +0.0. Unreachable in production (vec[0]=1
  // always) but pins the s=0 edge of the identity argument.
  mk(
    [
      [1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
    ],
    [1, 0, 1, 0],
    50,
    "empty-support"
  );
  out("scenario 1b (SOD adversarial signed-zero / beta=0 / empty-support fixtures)");
}

/* -------------- scenario 2: full-report bitwise equivalence -------------- */

function scenarioEquivalence(): void {
  const cases = batteryCases();
  for (const [index, testCase] of cases.entries()) {
    const expected = fitWith(irlsCtl, testCase.rows, testCase.options);
    compareReports(`R7C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    for (const [name, impl] of VARIANTS) {
      compareReports(`R7C-${name}[${index}]`, expected, fitWith(impl, testCase.rows, testCase.options));
    }
  }
  out(
    `scenario 2 (full-report bitwise equivalence, ${cases.length} cases x {production, SOD, F64, FIN} ` +
      `vs verbatim 80d103e irls under the verbatim production pipeline)`
  );
}

/* -------- scenario 3: component-level candidates S7-C-1 / S7-C-4 -------- */

function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}

function scenarioComponents(): void {
  // S7-C-1: draws-loop iteration entries() vs keys() over a p-sized map.
  const m = new Map<string, number>();
  for (let i = 0; i < 60; i++) m.set(`w:model-${i}|prj_${i}`, i * 0.001);
  {
    const a: string[] = [];
    for (const [name] of m.entries()) a.push(name);
    const b: string[] = [];
    for (const name of m.keys()) b.push(name);
    check("S7C1.same-names", a.length === b.length && a.every((v, i) => v === b[i]));
  }
  let sink = 0;
  const entriesCost = bench(() => {
    for (const [name] of m.entries()) sink += name.length;
  }, 200000);
  const keysCost = bench(() => {
    for (const name of m.keys()) sink += name.length;
  }, 200000);
  // Per report: 200 successful draws iterate the map once each.
  out(
    `S7-C-1 bench entries-vs-keys (60-entry map): entries=${(entriesCost * 1e6).toFixed(0)}ns ` +
      `keys=${(keysCost * 1e6).toFixed(0)}ns delta/iter=${((entriesCost - keysCost) * 1e6).toFixed(0)}ns ` +
      `-> per report (x200 draws) ~${(((entriesCost - keysCost) * 200) * 1e3).toFixed(1)}us`
  );

  // S7-C-4: onProbabilitiesFor map+closure vs indexed loop (400 rows, p=60).
  const r = fixtureRng(0xabcd);
  const vecs: number[][] = [];
  for (let i = 0; i < 400; i++) {
    const v = new Array<number>(60).fill(0);
    v[0] = 1;
    for (let k = 0; k < 4; k++) v[1 + Math.floor(r() * 59)] = 1;
    vecs.push(v);
  }
  const coef = Array.from({ length: 60 }, () => r() * 4 - 2);
  {
    const a = onProbabilitiesFor(vecs, coef);
    const b = onProbabilitiesForIndexed(vecs, coef);
    check("S7C4.bitwise", a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  }
  const mapCost = bench(() => void onProbabilitiesFor(vecs, coef), 2000);
  const idxCost = bench(() => void onProbabilitiesForIndexed(vecs, coef), 2000);
  out(
    `S7-C-4 bench onProbabilitiesFor (400x60): map=${(mapCost * 1e3).toFixed(1)}us ` +
      `indexed=${(idxCost * 1e3).toFixed(1)}us delta=${((mapCost - idxCost) * 1e3).toFixed(2)}us ` +
      `-> per report (x201 fits) ~${(((mapCost - idxCost) * 201)).toFixed(2)}ms`
  );

  // S7-C-2 component: every(Number.isFinite) vs hand loop on p=60.
  const beta = Array.from({ length: 60 }, () => r() * 10 - 5);
  const everyCost = bench(() => {
    if (!beta.every(Number.isFinite)) sink++;
  }, 500000);
  const loopCost = bench(() => {
    let ok = true;
    for (let d = 0; d < beta.length; d++) {
      if (!Number.isFinite(beta[d]!)) {
        ok = false;
        break;
      }
    }
    if (!ok) sink++;
  }, 500000);
  out(
    `S7-C-2 bench finite-check (p=60): every=${(everyCost * 1e6).toFixed(0)}ns ` +
      `loop=${(loopCost * 1e6).toFixed(0)}ns delta=${((everyCost - loopCost) * 1e6).toFixed(0)}ns ` +
      `-> per report (x8966 iters) ~${(((everyCost - loopCost) * 8966)).toFixed(2)}ms`
  );
  void sink;
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfRows(): OfflineRow[] {
  const r = fixtureRng(0xbeef);
  return randomRows(r, {
    scenarios: 4,
    models: 6,
    projects: 8,
    rows: 400,
    passRate: 0.6,
  });
}

const PERF_OPTIONS = { bootstrap: 200, seed: SEED_DEFAULT };

function perfFixtureMultiway(): void {
  const rows = perfRows();

  const expected = fitWith(irlsCtl, rows, PERF_OPTIONS);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, PERF_OPTIONS));
  for (const [name, impl] of VARIANTS) {
    compareReports(`perf-fixture.${name}`, expected, fitWith(impl, rows, PERF_OPTIONS));
  }

  etaDotCalls = 0;
  etaDotTerms = 0;
  etaRowVisits = 0;
  fitWith(irlsCounting, rows, PERF_OPTIONS);
  out(
    `perf fixture eta site: rowVisits=${etaRowVisits} dedupDots=${etaDotCalls} ` +
      `dotTerms=${etaDotTerms} (mul+add pairs) -> SOD would keep ~${(
        (etaDotCalls * 4.45) / 1e6
      ).toFixed(1)}M support adds of ${(etaDotTerms / 1e6).toFixed(1)}M`
  );

  const racers: Array<[string, () => AttributionReport]> = [
    ["ctl (80d103e S6-C)", (): AttributionReport => fitWith(irlsCtl, rows, PERF_OPTIONS)],
    ["production", (): AttributionReport => fitLogitAdditive(rows, PERF_OPTIONS)],
    ["VAR-SOD", (): AttributionReport => fitWith(irlsSOD, rows, PERF_OPTIONS)],
    ["VAR-F64", (): AttributionReport => fitWith(irlsF64, rows, PERF_OPTIONS)],
    ["VAR-FIN", (): AttributionReport => fitWith(irlsFIN, rows, PERF_OPTIONS)],
  ];
  const times = racers.map(() => [] as number[]);
  for (let rep = 0; rep < 7; rep++) {
    for (let v = 0; v < racers.length; v++) {
      const t0 = performance.now();
      racers[v]![1]();
      times[v]!.push(performance.now() - t0);
    }
  }
  const ctlMs = median(times[0]!);
  out(`perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps (multi-way, relative order only):`);
  for (let v = 0; v < racers.length; v++) {
    const ms = median(times[v]!);
    out(`  ${racers[v]![0].padEnd(20)} ${ms.toFixed(1)} ms  (${(ctlMs / ms).toFixed(2)}x vs ctl)`);
  }
}

/* ------------------------------ duel mode ------------------------------ */

const LANES: Record<string, (rows: readonly OfflineRow[]) => AttributionReport> = {
  ctl: (rows) => fitWith(irlsCtl, rows, PERF_OPTIONS),
  prod: (rows) => fitLogitAdditive(rows, PERF_OPTIONS),
  sod: (rows) => fitWith(irlsSOD, rows, PERF_OPTIONS),
  f64: (rows) => fitWith(irlsF64, rows, PERF_OPTIONS),
  fin: (rows) => fitWith(irlsFIN, rows, PERF_OPTIONS),
};

function duel(a: string, b: string): void {
  const rows = perfRows();
  const laneA = LANES[a]!;
  const laneB = LANES[b]!;
  // Correctness inside the duel process too.
  compareReports(`duel.${a}-vs-${b}`, laneA(rows), laneB(rows));
  const ta: number[] = [];
  const tb: number[] = [];
  for (let rep = 0; rep < 7; rep++) {
    let t0 = performance.now();
    laneA(rows);
    ta.push(performance.now() - t0);
    t0 = performance.now();
    laneB(rows);
    tb.push(performance.now() - t0);
  }
  const ma = median(ta);
  const mb = median(tb);
  out(
    `duel ${a} vs ${b}: ${a}=${ma.toFixed(1)}ms ${b}=${mb.toFixed(1)}ms ` +
      `delta=${(ma - mb).toFixed(1)}ms (${(ma / mb).toFixed(3)}x)`
  );
  if (failures > 0) {
    fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  } else {
    out(`duel equivalence: ${checksPassed} bitwise checks passed`);
  }
}

/* ------------------------------- main ------------------------------- */

const duelArg = process.argv.indexOf("--duel");
if (duelArg !== -1) {
  const [a, b] = (process.argv[duelArg + 1] ?? "").split(",");
  if (a === undefined || b === undefined || !(a in LANES) || !(b in LANES)) {
    fail(`usage: --duel <${Object.keys(LANES).join("|")}>,<lane>`);
  } else {
    duel(a, b);
  }
} else {
  scenarioDirectIrls();
  scenarioSignedZero();
  scenarioEquivalence();
  scenarioComponents();
  perfFixtureMultiway();
  if (failures > 0) {
    fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  } else {
    out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
  }
}
```

MORE_OPTIMA=yes
BRANCH=cursor/r7-c-offline-routing-seventh-pass-83a1

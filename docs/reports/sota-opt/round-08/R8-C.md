MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 8 / R8-C：离线路由切片第八遍复查报告

- **战役:** 全库持久 SOTA 优化 Round 8 / R8-C（Round 1–7 同区第八遍，叠在
  已落地的 S7-C 之上）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `1a2908f`（S7-C 已落地：
  `git log -- src/routing/` 显示切片最后一次改动即 `183df9b`「land S7-C
  support-only eta」，其后基线区间仅文档更新——本轮全部测量在该形态之上，
  未回退未重写）
- **分支:** `cursor/r8-c-offline-routing-eighth-pass-83a1`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读，含 S7-C eta 站点与 S6-C switch 现场核对）
- **模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无可落地的新更优解，本轮生产代码零改动。** 第八组从未点名角度枚举出的
四个新候选（S8-C-1..4：S7-C 引理外推到 on-prob 点积站点、外推到 APC off
对比站点（顺带消除 slice 拷贝）、IRLS 收敛侧 finite 检查的跨函数死代码
消除、回代对角 eps 卫的跨阶段死代码消除）全部经理论 + 确定性仿真
（**16,373 项逐位检查 × 3 次独立运行全绿**，含 51 个直接 solveSymmetric
对抗矩阵与 SOD 外推专用 ±0.0 对抗夹具）+ 真实规模基准裁决后淘汰：

- 两个 SOD 外推候选虽然逐位等价成立（S7-C 引理三前提在两站点逐字复现），
  但量级不达线——on-prob 站点 **4.57–4.66 ms/报告**（低于 ±35 ms 噪声带
  ~7×）、APC 站点 **22.16–23.59 ms/报告**（三次干净两路 +14.3/+15.6/
  +18.3 ms，全部落在噪声带内，S6-C-1「贴带不落地」纪律直接适用）；
- 死 finite 检查上界 **0.40 ms/报告**（深度亚噪声）；
- 死对角卫的删除**实测稳定负效应**（组件级三次 −2.2/−6.4/−6.5 µs/solve，
  干净两路 −87.5 ms，多路两次 −55 ms 级——量级超出其 ~0.4 ms 运算量上界
  一个数量级，为代码布局伪影主导，可回收价值为零）。

重剖析（§1）确认 S7-C 后成本模型：`solveSymmetric` 自身 **61.4%
（~433 ms/报告）**、`irls` 自身 **19.8%（~140 ms，落地前 ~190）**——
S7-C 的落地量在本 VM 剖面中如实显形；其余各池（编排 ~33、sigmoid ~30、
防御拷贝 ~19.5、APC ~16、GC ~7 ms/报告）**每一个即使整池清零也低于
±35 ms 噪声带**。两个带上池的七类完全分解（R6-C §2.5）本轮逐项复核
仍无未命名成本类——本轮把「跨函数/跨阶段死卫」这一疑似漏网类也点名
并实测关闭（S8-C-3/4）。**在当前排除表与逐位契约下，本切片不存在
不经表所有者层级契约变更即可达落地线的候选**——这一收口声明比 R7-C
的（当时 X2-1 档案尚待裁决）更强，因为唯一的档案级出口已在 S7-C 落地
中兑现。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。仓库变更仅本报告一个文件；无生产赢家故
未提交新 scripts 资产（败者仿真全文进附录，遵守 R7-C 先例）。

## 0. 范围与约束遵守

- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含改写后的
  X2-1 与 S7-* 全系）→ round-08/PLAN.md → round-01/R1-C.md …
  round-07/R7-C.md + R7-C-LAND.md → 9 个切片源文件全量重读。
- 基线漂移检查：切片最后一次改动为 `183df9b`（S7-C 落地本身），S7-C
  落地形态（去重分支内支撑升序直加 + S6-C switch 累加 + 前提注释）原样
  在位，本轮未触碰未重写。
- 禁止重开项零触碰：S7-C 本体未回退未重写；S5-C-5 / S5-C-7 /
  S6-C-1..7 / S7-C-1..4 及 X* / S1-*..S7-* 全系未重提。共享 `dot()`
  逐字未动（S8-C-1/2 仅为仿真内测量变体，生产 `onProbabilitiesFor` 与
  APC 数值路径零改动，X2-1 行「禁止另起平行实现」未被触碰）。
- 硬不变量全部满足（生产零 diff 下天然成立）：双 LCB 与双归因两路一行
  未删；promotion proposal-first；阈值 / 测试 / 公开签名 / 数据面契约
  不动；无串行链重排（S5-C-5）；生产内无浮点加乘集合变更。
- 环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，nvm 切换，
  与 R1-C..R7-C 同处理）、pnpm 10.17.1、`pnpm install --frozen-lockfile`。

## 1. 重剖析：S7-C 后成本模型（实测，未拷贝 R7-C 数字）

V8 `--cpu-prof`（perf 夹具 rows=400/p=60/bootstrap=200，2 次预热 + 7 次
测量；本 VM 生产每报告中位 **661.4–669.5 ms**；工作进程采样 6,346.8 ms
/ 9 次报告调用，Node 22.22.2）：

| 函数（自身时间） | 采样合计 | 折合 /报告 | 占比 |
| --- | --- | --- | --- |
| `solveSymmetric`（lin-alg） | 3897.8 ms | **~433 ms** | **61.4%** |
| `irls` 自身 | 1258.7 ms | **~140 ms** | **19.8%** |
| `fitLogitAdditive` 自身（编排+bootstrap） | 297.1 ms | ~33 ms | 4.7% |
| `sigmoid` | 267.1 ms | ~30 ms | 4.2% |
| lin-alg 匿名回调（防御拷贝） | 175.5 ms | ~19.5 ms | 2.8% |
| `averagePredictiveComparison` | 146.1 ms | ~16 ms | 2.3% |
| GC | 62.1 ms | ~7 ms | 1.0% |

与 R7-C 落地前剖面（solve 55.4% / irls 25.0%）对照：`irls` 自身
~190 → ~140 ms/报告——S7-C 删除 75.0M mul+add 对的落地量在本 VM 剖面
如实显形；`solveSymmetric` 占比相应升至 61.4%。站点核算（仿真插桩，
同夹具）：fits=201、IRLS 迭代 8,966、s̄=4.457；on-prob 点积
**4,824,000 项/报告**（支撑和仅保 ~358,383）；APC 活跃 (行,列) 对
~1,383/扫 × 201 扫（每对今日支付 60 拷贝 + 60 mul+add）；finite 检查
8,966 × 60；对角卫 8,966 × 60。

**收口复核**：两个带上池逐项对锁仍闭合——`solveSymmetric` 消元每元素
七类（装载/浮点/存储/边界检查/循环控制/分派/索引读取）分别由
X2-3 / S4-C / V8 / S5-C 族 / S4-C-1 / S4-C-2 / S6-C-7 覆盖，主元搜索
S5-C-6、回代 S5-C-5、防御拷贝 S4-C-3；`irls` 每行访问的 w/z/wz 公式体
+ switch 分派（S6-C）+ 支撑索引装载 + s²+s 加法本体（逐位契约），每
迭代的戳拷贝（S6-C-6）、归零（S5-C-7）、delta（S2-C-3）、eta 支撑和
（S7-C 落地形态，串行链 S5-C-5 不展开）。带下各池：编排（S3-C-3 /
S2-C-5 / S7-C-1 / S4-C-5 already 点名）、sigmoid（X1-3/X2-3 数值路径
+ 调用集合已最小）、拷贝（公开契约）、APC（四面锁 + S4-C-4 的 ~19 ms
整站上界，本轮实测 ~16 ms 自身 + 摊派 ≈ 22–24 ms，仍带内）。本轮唯一
疑似漏网类「跨函数/跨阶段死卫」由 S8-C-3/4 点名并关闭（§2）。

## 2. 候选总表（S8-C-1..4，全部淘汰）

本轮第八组从未点名角度：S7-C 引理的站点外推（两站点）与跨阶段死卫
消除（两站点）。全部候选先过排除表相邻行区分，再过逐位仿真（附录脚本，
16,373 项 × 3 次独立运行），最后过真实规模基准（组件级 + 多路赛马 +
干净两路决斗）。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-C-1 | `onProbabilitiesFor` 的 `dot(coefficients, vector)` 改支撑升序求和（S7-C 引理外推：0/1 设计 + `sum=0` 起步 + β 有限——`irls` 返回的系数逐迭代过 `every(Number.isFinite)`，maxIter=0 时为全零，恒有限） | 每报告删 ~4.47M 次 mul + ~4.47M 次 ±0.0 加法，保 ~358k 次支撑加法 | ✅ 全电池 + 专用对抗（全负 β 产 −0.0 项、空支撑行、5e-324 次正规、全零系数）逐位 | 组件级 delta 22.76–23.17 µs/调用 × 201 fits ≈ **4.57–4.66 ms/报告**；决斗 +3.7/+16.2/+3.7 ms 带内抖动 | 淘汰：低于 ±35 ms 带 ~7×。与 S2-C-1（on-prob 键去重，2.5–3.6 ms）同站点不同机制，量级同级；与 S7-C-4（map→索引循环）正交。生产 `dot()` 未动，无平行实现落地 |
| S8-C-2 | APC off 值改「支撑升序求和跳过 contrast 列」——消除每活跃 (行,列) 对的 O(p) `slice` 拷贝 + 置零写 + O(p) off 点积（引理同上；被跳过的 contrast 项在全量 dot 里是 0·β=±0.0 中链项，部分和永不为 −0.0 ⇒ 逐位无操作） | 每报告删 ~277,983 对 × (60 拷贝 + 60 mul+add)，保 ~s̄ 次支撑加法/对 | ✅ 同电池 + 13 列全扫（含 intercept 卫与未知列路径）+ 空行退化 | 组件级 delta 110.25–117.38 µs/全扫 × 201 ≈ **22.16–23.59 ms/报告**；三次干净两路 **+14.3/+15.6/+18.3 ms（1.022–1.028×）**——全部带内 | 淘汰：**贴带不越带**，S6-C-1 稳健性纪律直接适用；与 S4-C-4 的 APC 整站 ~19 ms 上界吻合。与 S1-C-1（原位置零+恢复）、S2-C-2（O(p) 虚零列）、X2-2（记忆化）三个近邻机制互异、全部未重提。重开条件：rows/p/draws 任一增长 ≥1 个数量级使该站点自身越带 |
| S8-C-3 | `irls` 收敛侧 `beta.every(Number.isFinite)` 死代码消除——`solveSymmetric` 仅在逐项过 `Number.isFinite` 后才返回非 null，`next` 在检查前无任何变异（delta 是 `map` 新数组），该检查恒真、其 null 分支不可达 | 每报告免 8,966 × 60 次谓词调用 | ✅ 全电池 + 24 个直接 irls 夹具（s=1..8、共享引用、maxIter∈{1,3,50}）逐位 | 组件级 every=44–45 ns × 8,966 ≈ **0.40 ms/报告**；决斗 +3.2 ms 带内 | 淘汰：深度亚噪声 + 该检查是收敛路径上的防御纵深（与 solveSymmetric 的返回不变量跨函数耦合，删除后不变量失去第二证人）。与 S7-C-2（检查**形态**换手写循环，实测负效应）区分：本候选是检查**存在性**，此前从未点名 |
| S8-C-4 | 回代对角卫 `if (Math.abs(diag) < eps) return null` 死代码消除——`rowArr[row]` 在回代时恰为消元第 row 步已过 `!(pivotAbs < eps)` 的主元（行 row 在自身步后不再被写入或交换：消元第 col'>row 步只写行 ≥ col'+1、只换行 ≥ col'），故 \|diag\| ≥ eps 或 diag 为 NaN，两种情形该卫均不触发 | 每报告免 8,966 × 60 次 abs+比较（运算量上界 ~0.4 ms） | ✅ 51 个直接对抗矩阵（13 个强制主元交换、奇异、NaN/∞、±0、eps 边界、n=0/1、非方阵抛错逐字）× {NoDiag, 生产导入} 逐位 | 组件级三次 **−2.2/−6.4/−6.5 µs/solve**（删除侧更慢）；干净两路 **−87.5 ms**；多路三次 −3.0/−57.8/−58.2 ms | 淘汰：**实测稳定负效应/布局伪影**——测得量级超出运算量上界一个数量级、方向恒负，删除无可回收价值；且该卫是 fail-closed 数值卫（S6-C-7 点名过的「校验毗邻公开错误契约」域），零收益下不值审计面扰动 |

另有两处以既有排除/裁决直接覆盖、不立新 ID：bootstrap 采样四数组缓冲
跨 draw 复用（S3-C-3 原行）；`percentile` 前 `values.sort` 换 TypedArray
无比较器排序（±0.0 相对序经稳定排序可观察发散——APC 均值可为 +0.0 而
TypedArray 排序把 −0 排在 +0 前，非平凡等价 + 每报告 ~1 ms 量级，不值
立项）。

### 2.1 线束锚点

干净两路 ctl（逐字 183df9b 复刻入参数化线束）vs 生产导入：**+22.0 ms
（694.3→672.3，1.033×）**——线束注入代价与 R7-C 测得的 ~20 ms 一致，
方向为生产更快；各变体与 ctl 同线束对比，差异恰为单站点编辑，不受此
影响。多路赛马三次运行 ctl 729.2/680.4/684.8 vs 生产 689.0/686.1/686.2，
相对序与决斗一致。

## 3. 全切片裁决（9 文件）

| 文件 | 裁决(一行) |
| --- | --- |
| `offline-logit.ts` | 零改动。S8-C-1/2/3 实测淘汰（§2）；S7-C 落地形态（支撑升序 eta + 前提注释）逐字维持；S1-C/S2-C/S3-C/S6-C 落地形态维持；S4-C-4/5/6、S5-C-5/7、S3-C-1..3、S2-C-1..5、S7-C-1..4、R2-C 批量累加裁决全部未重提 |
| `lin-alg.ts` | 零字节改动。S8-C-4 实测淘汰（§2，删除侧更慢）；S4-C/S5-C 落地形态维持；七类分解 + 五锁（X2-3/S4-C/S5-C 族/S4-C-2/S4-C-3）+ S5-C-6/S6-C-7 全部闭合；防御拷贝 ~19.5 ms/报告为公开契约拷贝且低于噪声带 |
| `posterior.ts` | C1/B1/A2 落地形态；S1-C-2/3/4/5 维持；`betacf`/`lnGamma`/二分 80 次数值路径锁定（X1-3/X3-4）；本轮重读无新候选 |
| `offline-prob-add.ts` | S1-C-6/7 维持；公式冻结（双归因 X0-11 一翼），全函数亚 ms；无新候选 |
| `r1.ts` | S1-C-10/X1-4/X1-6 维持；M≤10 常数域；无新候选 |
| `r1-shadow-report.ts` | 主路径 A2/B1 后形态；merge 路径仓内不可达（S1-C-2/3）；X1-5 维持；无新候选 |
| `propensity.ts` | S1-C-8/X3-5 维持；n 数百级、每报告一次；无新候选 |
| `bandit.ts` | S1-C-9/S1-A-8 维持；不可变契约拷贝保留（X4-2 同类）；无新候选 |
| `shadow.ts` | X4-2/S1-C-9 维持；drift/预算扣减 O(1)；无新候选 |

## 4. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-C-1 | `onProbabilitiesFor` 点积改支撑升序求和（S7-C 引理站点外推） | 逐位等价成立且已仿真证明，但站点量级 4.57–4.66 ms/报告，低于 ±35 ms 带 ~7×；决斗 +3.7/+16.2/+3.7 带内。重开条件：rows 或 fits 增长 ≥1 个数量级使该站点自身越带 |
| S8-C-2 | APC off 值改支撑求和跳 contrast 列（免 slice 拷贝 + 免 O(p) off 点积） | 逐位等价成立且已仿真证明（含中链 ±0.0 contrast 项引理），但 22.16–23.59 ms/报告、三次干净两路 +14.3/+15.6/+18.3 ms 全部带内——贴带不越带（S6-C-1 纪律）；与 S4-C-4 的 APC 整站 ~19 ms 上界吻合。重开条件：rows/p/draws 任一增长 ≥1 个数量级 |
| S8-C-3 | `irls` 收敛侧 `beta.every(Number.isFinite)` 死代码消除 | 恒真可证（solveSymmetric 返回不变量），但 0.40 ms/报告深度亚噪声，且删除即拆掉跨函数不变量的第二证人（防御纵深）。与 S7-C-2（形态变换）区分为存在性变换 |
| S8-C-4 | `solveSymmetric` 回代对角 eps 卫死代码消除 | 恒不触发可证（行 row 在自身消元步后不被写/换，diag 即已过卫主元或 NaN），但删除侧**实测稳定更慢**（组件 −2.2/−6.4/−6.5 µs/solve、决斗 −87.5 ms、多路两次 −55 ms 级——布局伪影主导，超运算量上界 ~0.4 ms 一个数量级）；fail-closed 数值卫防御纵深保留。重开条件：实测稳定反超且越带（不预期） |

切片级收口条件：R6-C §2.5 七类分解 + S7-C 落地后，本轮把「跨函数/跨
阶段死卫」类点名并实测关闭；带下各池（编排 ~33 / sigmoid ~30 / 拷贝
~19.5 / APC ~16 / GC ~7 ms）整池清零均不越带。**在当前排除表、逐位
契约与 ±35 ms 噪声带下，本切片无可达落地线的候选**；推翻该声明需要
（a）指出七类之外的新成本类，或（b）表所有者层级的契约变更（如 X2-3
数值路径解冻——不预期），或（c）现实规模位移 ≥1 个数量级使 S8-C-1/2
的重开条件成立。

## 5. 测试与验证

环境：Node 22.22.2（nvm；VM 默认 22.14.0 低于 engines）、pnpm 10.17.1。
生产代码零改动，测试文件零改动。

```bash
pnpm typecheck && pnpm lint && pnpm build    # ✓ 全绿（零 diff 基线自证）
npx tsx --test "test/unit/routing/*.test.ts" # ✓ 198/198 pass

# 本轮仿真（临时脚本，未入库——无生产赢家，全文见附录）
npx tsx /tmp/r8c-sim.mts                   # ✓ 16,373 项逐位 × 3 次独立运行，结论逐位一致
npx tsx /tmp/r8c-sim.mts --duel ctl,apc    # ✓ 250 项 + 决斗计时（×3 独立进程）
npx tsx /tmp/r8c-sim.mts --duel ctl,ops    # ✓ 250 项 + 决斗计时（×3 独立进程）
npx tsx /tmp/r8c-sim.mts --duel ctl,fin    # ✓ +3.2 ms 带内
npx tsx /tmp/r8c-sim.mts --duel ctl,diag   # ✓ −87.5 ms（删除侧更慢）
npx tsx /tmp/r8c-sim.mts --duel ctl,prod   # ✓ +22.0 ms 线束锚点

# 既有回归资产全量复跑（本 VM 锚点）
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8,028 项
npx tsx scripts/round02-r2c-equivalence-sim.ts   # ✓ 14,420 项
npx tsx scripts/round03-r3c-equivalence-sim.ts   # ✓ 14,730 项
npx tsx scripts/round04-r4c-equivalence-sim.ts   # ✓ 24,888 项
npx tsx scripts/round05-r5c-equivalence-sim.ts   # ✓ 28,555 项
npx tsx scripts/round06-r6c-equivalence-sim.ts   # ✓ 25,483 项
npx tsx scripts/round07-r7c-equivalence-sim.ts   # ✓ 6,193 项
```

代表性一次全量运行输出：

```text
scenario 1 (direct irls bitwise equivalence, 24 fixtures x {FIN, DIAG} vs verbatim 183df9b irls/solve; support sizes: 1,2,3,4,5,6,7,8)
scenario 1b (direct solveSymmetric adversarial matrices, 51 fixtures x {NoDiag, prod} vs verbatim 183df9b solve; forced-swap fixtures: 13; null returns: 6)
scenario 1c (SOD-extension adversarial component checks: 5 coefficient sets x 30 vectors incl. empty support, x 13 APC columns; all Object.is)
scenario 2 (full-report bitwise equivalence, 53 cases x {production, OPS, APC, FIN, DIAG} vs verbatim 183df9b pipeline)
S8-C-1 bench onProbabilitiesFor (400x60): full-dot=29.3us support-sum=6.2us delta=23.17us -> per report (x201 fits) ~4.66ms
S8-C-2 bench APC full sweep (59 names, 1383 active pairs, p=60): slice+dot=238.3us support-sum=126.2us delta=112.14us -> per report (x201 sweeps) ~22.54ms
S8-C-3 bench dead finite-check (p=60): every=45ns -> per report (x8966 iterations) ~0.40ms
S8-C-4 bench solve guard (n=60): with-guard=55.7us without=57.9us delta=-2186ns -> per report (x8966 solves) ~-19.60ms
site accounting: fits=201 irlsIterations=8966 p=60 n=400 sBar=4.457; on-prob dot terms/report=4824000 (support-sum keeps ~358383); APC active pairs/sweep(base)=1383 x 201 sweeps (each pays p-copy + p-dot today, s-sum under S8-C-2); finite-checks/report=8966 x p; diag-guards/report=8966 x n=60
perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps (multi-way, relative order only):
  ctl (183df9b S7-C)   729.2 ms  (1.00x vs ctl)
  production           689.0 ms  (1.06x vs ctl)
  VAR-OPS              724.1 ms  (1.01x vs ctl)
  VAR-APC              707.9 ms  (1.03x vs ctl)
  VAR-FIN              725.9 ms  (1.00x vs ctl)
  VAR-DIAG             732.2 ms  (1.00x vs ctl)

ALL EQUIVALENCE CHECKS PASSED (16373 bitwise checks)
```

决斗输出（独立进程）：

```text
duel ctl vs apc: ctl=676.0ms apc=660.4ms delta=15.6ms (1.024x)
duel ctl vs apc: ctl=677.1ms apc=658.9ms delta=18.3ms (1.028x)
duel ctl vs apc: ctl=676.4ms apc=662.1ms delta=14.3ms (1.022x)
duel ctl vs ops: ctl=677.6ms ops=673.9ms delta=3.7ms (1.005x)
duel ctl vs ops: ctl=701.2ms ops=685.0ms delta=16.2ms (1.024x)
duel ctl vs ops: ctl=680.2ms ops=676.5ms delta=3.7ms (1.006x)
duel ctl vs fin: ctl=679.1ms fin=676.0ms delta=3.2ms (1.005x)
duel ctl vs diag: ctl=693.7ms diag=781.1ms delta=-87.5ms (0.888x)
duel ctl vs prod: ctl=694.3ms prod=672.3ms delta=22.0ms (1.033x)
```

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装；
决斗模式 `npx tsx <file> --duel ctl,apc`）。若 S8-C-1/2 的重开条件将来
成立，本脚本可直接改造为 `scripts/round08-r8c-equivalence-sim.ts`
落地资产。

```ts
/**
 * Round 8 / R8-C deterministic equivalence + benchmark simulation
 * (offline routing slice, eighth pass). NOT committed: no production winner
 * this round — full source goes into the R8-C report appendix.
 *
 * Adjudicated lanes (all measured against CTL = verbatim 183df9b production
 * irls/solve/on-prob/APC, i.e. the landed S7-C form; every already-excluded
 * edit UNAPPLIED):
 *
 *   PROD  production import (equivalence anchor; must match CTL bitwise)
 *   OPS   S8-C-1 candidate: onProbabilitiesFor's dot(coefficients, vector)
 *         replaced by the support-only ascending sum (S7-C lemma premises
 *         hold verbatim at this site: 0/1 design entries, +0.0 accumulator
 *         start, finite coefficients guaranteed by irls/solveSymmetric).
 *   APC   S8-C-2 candidate: averagePredictiveComparison's off value computed
 *         as the support-only sum skipping the contrast column — drops the
 *         O(p) slice copy, the zero write, AND the O(p) off dot per active
 *         (row, column) pair. Bitwise by the same lemma: the zeroed contrast
 *         term contributes 0*beta = ±0.0 mid-chain, a no-op since partial
 *         sums never reach -0.0.
 *   FIN   S8-C-3 candidate: irls convergence-side beta.every(Number.isFinite)
 *         REMOVED as provably dead — solveSymmetric returns non-null only
 *         after checking every solution entry with Number.isFinite, and
 *         nothing mutates `next` before the check.
 *   DIAG  S8-C-4 candidate: back-substitution diagonal guard
 *         `if (Math.abs(diag) < eps) return null` REMOVED as provably dead —
 *         rowArr[row] at back-sub time is exactly the pivot that already
 *         passed `!(pivotAbs < eps)` at elimination step `row` (row `row` is
 *         never written or swapped after its own step), so |diag| >= eps or
 *         diag is NaN, and the guard fires in neither case.
 *
 * Modes:
 *   (default)          equivalence battery + instrumentation + micro benches
 *                      + in-process multi-way race (relative order only)
 *   --duel A,B         clean two-lane: exactly two racers, 7 interleaved
 *                      reps, median (run in 3+ independent processes)
 *
 * Run: npx tsx /tmp/r8c-sim.mts [--duel ctl,ops]
 */

import { fitLogitAdditive } from "/workspace/src/routing/offline-logit.js";
import { solveSymmetric } from "/workspace/src/routing/lin-alg.js";
import { betaQuantileLcb } from "/workspace/src/routing/posterior.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
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

type SolveImpl = (a: readonly (readonly number[])[], b: readonly number[]) => number[] | null;

type IrlsImpl = (
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number,
  solve: SolveImpl
) => FitResult;

type OnProbImpl = (
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  coefficients: readonly number[]
) => number[];

type ApcImpl = (
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
) => number;

interface Pipeline {
  readonly irls: IrlsImpl;
  readonly solve: SolveImpl;
  readonly onProb: OnProbImpl;
  readonly apc: ApcImpl;
}

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
/* ------------------------------------------------------------------- */

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
/* CTL irls: verbatim 183df9b production irls (landed S7-C form),       */
/* parameterized only by the solve implementation.                      */
/* ------------------------------------------------------------------- */

const irlsCtl: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter, solve) => {
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
        let value = 0;
        const active = supports[i]!;
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
    const next = solve(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* FIN (S8-C-3): identical except the dead convergence-side finite check
 * is removed. solve() returns non-null only after verifying every entry
 * with Number.isFinite, and nothing mutates `next` before the check. */
const irlsFin: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter, solve) => {
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
        let value = 0;
        const active = supports[i]!;
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
    const next = solve(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
};

/* ------------------------------------------------------------------- */
/* Solve lanes.                                                         */
/* ------------------------------------------------------------------- */

/* CTL solve: verbatim 183df9b production solveSymmetric. */
const solveCtl: SolveImpl = (a, b) => {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      let k = col;
      const stop = n - 3;
      for (; k < stop; k += 4) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
        rowArr[k + 1] = rowArr[k + 1]! - factor * colArr[k + 1]!;
        rowArr[k + 2] = rowArr[k + 2]! - factor * colArr[k + 2]!;
        rowArr[k + 3] = rowArr[k + 3]! - factor * colArr[k + 3]!;
      }
      for (; k < n; k++) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      }
      x[row] = x[row]! - factor * xCol;
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
};

/* DIAG (S8-C-4): identical except the dead back-substitution diagonal
 * guard is removed. */
const solveNoDiag: SolveImpl = (a, b) => {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      let k = col;
      const stop = n - 3;
      for (; k < stop; k += 4) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
        rowArr[k + 1] = rowArr[k + 1]! - factor * colArr[k + 1]!;
        rowArr[k + 2] = rowArr[k + 2]! - factor * colArr[k + 2]!;
        rowArr[k + 3] = rowArr[k + 3]! - factor * colArr[k + 3]!;
      }
      for (; k < n; k++) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      }
      x[row] = x[row]! - factor * xCol;
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
};

/* ------------------------------------------------------------------- */
/* on-prob / APC lanes.                                                 */
/* ------------------------------------------------------------------- */

/* CTL on-prob: verbatim production (supports ignored). */
const onProbCtl: OnProbImpl = (vectors, _supports, coefficients) =>
  vectors.map((vector) => sigmoid(dot(coefficients, vector)));

/* OPS (S8-C-1): support-only ascending sum in place of the full dot. */
const onProbSOD: OnProbImpl = (vectors, supports, coefficients) => {
  const out = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const active = supports[i]!;
    let value = 0;
    for (let ai = 0; ai < active.length; ai++) value += coefficients[active[ai]!]!;
    out[i] = sigmoid(value);
  }
  return out;
};

/* CTL APC: verbatim production (supports ignored). */
const apcCtl: ApcImpl = (design, rows, vectors, _supports, coefficients, onProbabilities, column) => {
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
};

/* APC (S8-C-2): off value as the support-only ascending sum skipping the
 * contrast column; no slice, no zero write, no O(p) dot. */
const apcSOD: ApcImpl = (design, rows, vectors, supports, coefficients, onProbabilities, column) => {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined && columnIdx !== 0) {
    for (let i = 0; i < rows.length; i++) {
      if (vectors[i]![columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      const active = supports[i]!;
      let value = 0;
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai]!;
        if (a === columnIdx) continue;
        value += coefficients[a]!;
      }
      const off = sigmoid(value);
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
};

/* ---------------------- rest of the verbatim pipeline ---------------------- */

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
  pipeline: Pipeline,
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
  const fit = pipeline.irls(design, baseRows, vectors, supports, keys, baseRows.length, maxIter, pipeline.solve);
  if (fit.coefficients === null) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = pipeline.onProb(vectors, supports, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      pipeline.apc(design, baseRows, vectors, supports, fit.coefficients, onProbabilities, name)
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
    const bootFit = pipeline.irls(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter, pipeline.solve);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = pipeline.onProb(sampleVectors, sampleSupports, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = pipeline.apc(
        design,
        sample,
        sampleVectors,
        sampleSupports,
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

function compareSolutions(label: string, expected: number[] | null, actual: number[] | null): void {
  check(`${label}.null`, (expected === null) === (actual === null));
  if (expected !== null && actual !== null) {
    check(`${label}.length`, expected.length === actual.length);
    if (expected.length === actual.length) {
      for (let i = 0; i < expected.length; i++) {
        check(`${label}[${i}]`, Object.is(expected[i], actual[i]));
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

const CTL: Pipeline = { irls: irlsCtl, solve: solveCtl, onProb: onProbCtl, apc: apcCtl };
const LANE_OPS: Pipeline = { irls: irlsCtl, solve: solveCtl, onProb: onProbSOD, apc: apcCtl };
const LANE_APC: Pipeline = { irls: irlsCtl, solve: solveCtl, onProb: onProbCtl, apc: apcSOD };
const LANE_FIN: Pipeline = { irls: irlsFin, solve: solveCtl, onProb: onProbCtl, apc: apcCtl };
const LANE_DIAG: Pipeline = { irls: irlsCtl, solve: solveNoDiag, onProb: onProbCtl, apc: apcCtl };

const VARIANTS: Array<[string, Pipeline]> = [
  ["OPS", LANE_OPS],
  ["APC", LANE_APC],
  ["FIN", LANE_FIN],
  ["DIAG", LANE_DIAG],
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
  const r = fixtureRng(0x8c01);
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
    const expected = irlsCtl(design, rows, vectors, supports, keys, n, maxIter, solveCtl);
    compareFits(`direct[${t}].FIN`, expected, irlsFin(design, rows, vectors, supports, keys, n, maxIter, solveCtl));
    compareFits(`direct[${t}].DIAG`, expected, irlsCtl(design, rows, vectors, supports, keys, n, maxIter, solveNoDiag));
    fixtures++;
  }
  for (let s = 1; s <= 6; s++) {
    check(`direct.support-size-${s}-covered`, supportSizes.has(s));
  }
  out(
    `scenario 1 (direct irls bitwise equivalence, ${fixtures} fixtures x {FIN, DIAG} vs ` +
      `verbatim 183df9b irls/solve; support sizes: ${[...supportSizes].sort((a, b) => a - b).join(",")})`
  );
}

/* ----- scenario 1b: direct solveSymmetric adversarial matrices (DIAG) ----- */

function scenarioDirectSolve(): void {
  const r = fixtureRng(0x8c02);
  let fixtures = 0;
  let swaps = 0;
  let nulls = 0;

  const runOne = (label: string, a: number[][], b: number[]): void => {
    const expected = solveCtl(a, b);
    if (expected === null) nulls++;
    compareSolutions(`solve[${label}].NoDiag`, expected, solveNoDiag(a, b));
    compareSolutions(`solve[${label}].prod`, expected, solveSymmetric(a, b));
    fixtures++;
  };

  // Random matrices n=1..12, some forcing pivot swaps (large off-diagonals).
  for (let t = 0; t < 40; t++) {
    const n = 1 + Math.floor(r() * 12);
    const a: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(r() * 4 - 2);
      a.push(row);
    }
    if (t % 3 === 0 && n >= 2) {
      // Force pivot swaps: a huge sub-diagonal entry in the first column.
      a[n - 1]![0] = 1e6;
      swaps++;
    }
    if (t % 5 === 0) {
      // Symmetrize part of the domain (production shape).
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) a[i]![j] = a[j]![i]!;
    }
    const b = Array.from({ length: n }, () => r() * 2 - 1);
    runOne(`rand${t}`, a, b);
  }

  // Singular (rank-deficient) matrices: elimination returns null before back-sub.
  runOne("singular2", [[1, 2], [2, 4]], [1, 2]);
  runOne("zero3", [[0, 0, 0], [0, 0, 0], [0, 0, 0]], [1, 1, 1]);

  // NaN / Infinity contamination.
  runOne("nan-diag", [[Number.NaN, 1], [1, 2]], [1, 1]);
  runOne("inf-cell", [[1, Number.POSITIVE_INFINITY], [2, 1]], [1, 1]);
  runOne("nan-later", [[2, 1, 1], [1, Number.NaN, 1], [1, 1, 3]], [1, 1, 1]);

  // Signed zeros in cells and rhs.
  runOne("signed-zero", [[2, -0, 1], [-0, 3, -0], [1, -0, 4]], [-0, 1, -0]);

  // n = 0 and n = 1 endpoints.
  runOne("n0", [], []);
  runOne("n1", [[3]], [6]);
  runOne("n1-null", [[0]], [1]);

  // Tiny-pivot edge exactly at eps boundary.
  runOne("eps-edge", [[1e-12, 0], [0, 1]], [1, 1]);
  runOne("eps-below", [[0.9e-12, 0], [0, 1]], [1, 1]);

  // Non-square inputs must throw identically.
  {
    let msgCtl = "";
    let msgVar = "";
    let msgProd = "";
    try { solveCtl([[1, 2]], [1, 2]); } catch (e) { msgCtl = (e as Error).message; }
    try { solveNoDiag([[1, 2]], [1, 2]); } catch (e) { msgVar = (e as Error).message; }
    try { solveSymmetric([[1, 2]], [1, 2]); } catch (e) { msgProd = (e as Error).message; }
    check("solve.throw.same", msgCtl !== "" && msgCtl === msgVar && msgCtl === msgProd);
  }

  out(
    `scenario 1b (direct solveSymmetric adversarial matrices, ${fixtures} fixtures x {NoDiag, prod} ` +
      `vs verbatim 183df9b solve; forced-swap fixtures: ${swaps}; null returns: ${nulls})`
  );
}

/* ---- scenario 1c: SOD-extension adversarial component checks (OPS/APC) ---- */

function scenarioSodComponents(): void {
  const r = fixtureRng(0x8c03);
  // Adversarial 0/1 vector sets: negative coefficients (0*beta = -0.0 terms
  // mid-chain), all-zero rows (empty support), mixed signs, tiny magnitudes.
  const coefSets: Array<[string, number[]]> = [
    ["all-negative", Array.from({ length: 12 }, (_, j) => -(j + 1) * 0.37)],
    ["mixed-sign", Array.from({ length: 12 }, (_, j) => (j % 2 === 0 ? 1 : -1) * (j + 0.5))],
    ["tiny", Array.from({ length: 12 }, (_, j) => (j % 2 === 0 ? 1 : -1) * 5e-324 * (j + 1))],
    ["zeros", Array.from({ length: 12 }, () => 0)],
    ["random", Array.from({ length: 12 }, () => r() * 8 - 4)],
  ];
  const vectors: number[][] = [];
  for (let i = 0; i < 30; i++) {
    const vec = new Array<number>(12).fill(0);
    if (i !== 7) vec[0] = 1; // row 7: all-zero vector (empty support)
    const extra = i % 6;
    const cols = new Set<number>();
    while (cols.size < extra) cols.add(1 + Math.floor(r() * 11));
    for (const c of cols) vec[c] = 1;
    vectors.push(vec);
  }
  const supports = computeSupports(vectors);
  const design = {
    names: Array.from({ length: 12 }, (_, i) => (i === 0 ? "intercept" : `c${i}`)),
    columnIndex: new Map(Array.from({ length: 12 }, (_, i) => [i === 0 ? "intercept" : `c${i}`, i] as const)),
    referenceLevels: [],
    build(): number[] {
      throw new Error("component fixtures never call design.build");
    }
  } satisfies Design;
  const rows: Row[] = vectors.map((_, i) => ({
    scenarioId: "s",
    modelVersion: "m",
    projectId: "p",
    y: (i % 2) as 0 | 1
  }));

  for (const [name, coef] of coefSets) {
    const expectedOn = onProbCtl(vectors, supports, coef);
    const actualOn = onProbSOD(vectors, supports, coef);
    check(`sod-comp[${name}].onprob.length`, expectedOn.length === actualOn.length);
    for (let i = 0; i < expectedOn.length; i++) {
      check(`sod-comp[${name}].onprob[${i}]`, Object.is(expectedOn[i], actualOn[i]));
    }
    for (const column of design.names) {
      const expectedApc = apcCtl(design, rows, vectors, supports, coef, expectedOn, column);
      const actualApc = apcSOD(design, rows, vectors, supports, coef, expectedOn, column);
      check(`sod-comp[${name}].apc[${column}]`, Object.is(expectedApc, actualApc));
    }
    // Unknown column: both take the columnIdx===undefined path.
    check(
      `sod-comp[${name}].apc[missing]`,
      Object.is(
        apcCtl(design, rows, vectors, supports, coef, expectedOn, "nope"),
        apcSOD(design, rows, vectors, supports, coef, expectedOn, "nope")
      )
    );
  }
  // Empty-rows edge: both return 0 via rows.length === 0.
  check(
    "sod-comp.empty-rows",
    Object.is(
      apcCtl(design, [], [], [], coefSets[0]![1], [], "c1"),
      apcSOD(design, [], [], [], coefSets[0]![1], [], "c1")
    )
  );
  out(
    `scenario 1c (SOD-extension adversarial component checks: ${coefSets.length} coefficient sets x ` +
      `30 vectors incl. empty support, x 13 APC columns; all Object.is)`
  );
}

/* -------------- scenario 2: full-report bitwise equivalence -------------- */

function scenarioEquivalence(): void {
  const cases = batteryCases();
  for (const [index, testCase] of cases.entries()) {
    const expected = fitWith(CTL, testCase.rows, testCase.options);
    compareReports(`R8C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    for (const [name, pipeline] of VARIANTS) {
      compareReports(`R8C-${name}[${index}]`, expected, fitWith(pipeline, testCase.rows, testCase.options));
    }
  }
  out(
    `scenario 2 (full-report bitwise equivalence, ${cases.length} cases x {production, OPS, APC, FIN, DIAG} ` +
      `vs verbatim 183df9b pipeline)`
  );
}

/* ------------------- scenario 3: component benchmarks ------------------- */

function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
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

function scenarioComponents(): void {
  const rows = perfRows();
  const baseRows: Row[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y
  }));
  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  const fit = irlsCtl(design, baseRows, vectors, supports, keys, baseRows.length, MAX_ITER_DEFAULT, solveCtl);
  const coef = fit.coefficients!;
  const p = design.names.length;

  // S8-C-1: on-prob full dot vs support-only sum (real fixture shapes).
  {
    const a = onProbCtl(vectors, supports, coef);
    const b = onProbSOD(vectors, supports, coef);
    check("S8C1.bitwise", a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
    const ctlCost = bench(() => void onProbCtl(vectors, supports, coef), 2000);
    const sodCost = bench(() => void onProbSOD(vectors, supports, coef), 2000);
    out(
      `S8-C-1 bench onProbabilitiesFor (400x${p}): full-dot=${(ctlCost * 1e3).toFixed(1)}us ` +
        `support-sum=${(sodCost * 1e3).toFixed(1)}us delta=${((ctlCost - sodCost) * 1e3).toFixed(2)}us ` +
        `-> per report (x201 fits) ~${((ctlCost - sodCost) * 201).toFixed(2)}ms`
    );
  }

  // S8-C-2: APC slice+dot vs support-sum-minus-column (full 60-name sweep).
  {
    const on = onProbCtl(vectors, supports, coef);
    const names = design.names.filter((name) => name !== "intercept");
    let activePairs = 0;
    for (const name of names) {
      const columnIdx = design.columnIndex.get(name)!;
      for (let i = 0; i < baseRows.length; i++) if (vectors[i]![columnIdx] !== 0) activePairs++;
    }
    const ctlCost = bench(() => {
      for (const name of names) apcCtl(design, baseRows, vectors, supports, coef, on, name);
    }, 300);
    const sodCost = bench(() => {
      for (const name of names) apcSOD(design, baseRows, vectors, supports, coef, on, name);
    }, 300);
    out(
      `S8-C-2 bench APC full sweep (${names.length} names, ${activePairs} active pairs, p=${p}): ` +
        `slice+dot=${(ctlCost * 1e3).toFixed(1)}us support-sum=${(sodCost * 1e3).toFixed(1)}us ` +
        `delta=${((ctlCost - sodCost) * 1e3).toFixed(2)}us -> per report (x201 sweeps) ` +
        `~${((ctlCost - sodCost) * 201).toFixed(2)}ms`
    );
  }

  // S8-C-3: cost of the dead convergence-side finite check.
  {
    const beta = [...coef];
    let sink = 0;
    const everyCost = bench(() => {
      if (!beta.every(Number.isFinite)) sink++;
    }, 500000);
    out(
      `S8-C-3 bench dead finite-check (p=${p}): every=${(everyCost * 1e6).toFixed(0)}ns ` +
        `-> per report (x8966 iterations) ~${(everyCost * 8966).toFixed(2)}ms`
    );
    void sink;
  }

  // S8-C-4: solve with vs without the dead diagonal guard (production-shaped
  // SPD-ish system harvested from the real fit).
  {
    const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const xtwz: number[] = new Array<number>(p).fill(0);
    for (let i = 0; i < baseRows.length; i++) {
      const w = 0.25;
      const wz = 0.25 * (baseRows[i]!.y === 1 ? 2 : -2);
      accumulate(xtwx, xtwz, supports[i]!, w, wz);
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    compareSolutions("S8C4.bitwise", solveCtl(xtwx, xtwz), solveNoDiag(xtwx, xtwz));
    const ctlCost = bench(() => void solveCtl(xtwx, xtwz), 3000);
    const varCost = bench(() => void solveNoDiag(xtwx, xtwz), 3000);
    out(
      `S8-C-4 bench solve guard (n=${p}): with-guard=${(ctlCost * 1e3).toFixed(1)}us ` +
        `without=${(varCost * 1e3).toFixed(1)}us delta=${((ctlCost - varCost) * 1e6).toFixed(0)}ns ` +
        `-> per report (x8966 solves) ~${((ctlCost - varCost) * 8966).toFixed(2)}ms`
    );
  }
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/* Instrumented site accounting for the candidate sites. */
function siteAccounting(): void {
  const rows = perfRows();
  const baseRows: Row[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y
  }));
  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  const p = design.names.length;
  const n = baseRows.length;
  void keys;

  // Count fits / iterations / draws by replaying the pipeline with counters.
  let fits = 0;
  let iterations = 0;
  const countingIrls: IrlsImpl = (d, r2, v, s, k, ks, mi, sv) => {
    fits++;
    const inner: SolveImpl = (a2, b2) => {
      iterations++;
      return sv(a2, b2);
    };
    return irlsCtl(d, r2, v, s, k, ks, mi, inner);
  };
  const countingPipeline: Pipeline = { irls: countingIrls, solve: solveCtl, onProb: onProbCtl, apc: apcCtl };
  fitWith(countingPipeline, rows, PERF_OPTIONS);

  const sBar = supports.reduce((acc, s) => acc + s.length, 0) / supports.length;
  const onProbTerms = fits * n * p;
  const onProbKept = Math.round(fits * n * sBar);
  const apcPairsPerSweep = supports.reduce((acc, s) => acc + (s.length - 1), 0);
  out(
    `site accounting: fits=${fits} irlsIterations=${iterations} p=${p} n=${n} sBar=${sBar.toFixed(3)}; ` +
      `on-prob dot terms/report=${onProbTerms} (support-sum keeps ~${onProbKept}); ` +
      `APC active pairs/sweep(base)=${apcPairsPerSweep} x ${fits} sweeps ` +
      `(each pays p-copy + p-dot today, s-sum under S8-C-2); ` +
      `finite-checks/report=${iterations} x p; diag-guards/report=${iterations} x n=${p}`
  );
}

function perfFixtureMultiway(): void {
  const rows = perfRows();

  const expected = fitWith(CTL, rows, PERF_OPTIONS);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, PERF_OPTIONS));
  for (const [name, pipeline] of VARIANTS) {
    compareReports(`perf-fixture.${name}`, expected, fitWith(pipeline, rows, PERF_OPTIONS));
  }

  const racers: Array<[string, () => AttributionReport]> = [
    ["ctl (183df9b S7-C)", (): AttributionReport => fitWith(CTL, rows, PERF_OPTIONS)],
    ["production", (): AttributionReport => fitLogitAdditive(rows, PERF_OPTIONS)],
    ["VAR-OPS", (): AttributionReport => fitWith(LANE_OPS, rows, PERF_OPTIONS)],
    ["VAR-APC", (): AttributionReport => fitWith(LANE_APC, rows, PERF_OPTIONS)],
    ["VAR-FIN", (): AttributionReport => fitWith(LANE_FIN, rows, PERF_OPTIONS)],
    ["VAR-DIAG", (): AttributionReport => fitWith(LANE_DIAG, rows, PERF_OPTIONS)],
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
  ctl: (rows) => fitWith(CTL, rows, PERF_OPTIONS),
  prod: (rows) => fitLogitAdditive(rows, PERF_OPTIONS),
  ops: (rows) => fitWith(LANE_OPS, rows, PERF_OPTIONS),
  apc: (rows) => fitWith(LANE_APC, rows, PERF_OPTIONS),
  fin: (rows) => fitWith(LANE_FIN, rows, PERF_OPTIONS),
  diag: (rows) => fitWith(LANE_DIAG, rows, PERF_OPTIONS),
};

function duel(a: string, b: string): void {
  const rows = perfRows();
  const laneA = LANES[a]!;
  const laneB = LANES[b]!;
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
  scenarioDirectSolve();
  scenarioSodComponents();
  scenarioEquivalence();
  scenarioComponents();
  siteAccounting();
  perfFixtureMultiway();
  if (failures > 0) {
    fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  } else {
    out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
  }
}
```

MORE_OPTIMA=no
BRANCH=cursor/r8-c-offline-routing-eighth-pass-83a1

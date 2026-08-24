MODEL_SLUG=claude-fable-5-thinking-xhigh

# Round 9 / R9-C：离线路由切片第九遍复查报告

- **战役:** 全库持久 SOTA 优化 Round 9 / R9-C（Round 1–8 同区第九遍，叠在
  已落地的 S7-C 之上）
- **基线:** `cursor/sota-persistent-opt-83a1` @ `195cb53`（含 R9-A /
  S9-A-1 与 R8-I / S8-I-1..3 排除合入；`git log -1 -- src/routing/` 显示
  切片最后一次改动仍为 `183df9b`「land S7-C support-only eta」——其后基线
  区间仅文档更新，本轮全部测量在该形态之上，未回退未重写）
- **分支:** `cursor/r9-c-offline-routing-ninth-pass-83a1`
- **切片:** `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`（9 文件全量重读，含 S7-C eta 站点与 S6-C switch 现场核对）
- **模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无可落地的新更优解，本轮生产代码零改动。** 第九组从未点名角度枚举出
四个新候选：两个契约级不可行项经理论直接淘汰、不立仿真道（S9-C-1
bootstrap 重拟合 worker_threads 并行化——公开 `fitLogitAdditive` 同步
签名 + 单线程确定性执行模型是本切片全部逐位声明的审计基底；S9-C-2
solve/irls 核迁移 WASM/SIMD——构建面/平台面变更超出切片权限，且 SIMD
归约顺序破坏逐位契约），两个可测项经理论 + 确定性仿真（**9,788 项逐位
检查 × 4 次独立全量运行全绿**，含 51 个直接 solveSymmetric 对抗矩阵、
±0.0 / β=0 / 空支撑对抗夹具与 w 钳制边界探针）+ 真实规模基准裁决后
淘汰：

- **S9-C-3（EMB）** irls 每行 eta/mu 行缓冲整体消除（stamp 循环只写
  `etaByKey`/`muByKey`，累加循环经 `keys[i]` 直读）：逐位平凡成立
  （Float64Array 存精确 double，两循环消费同值同序），但整池运算量
  上界即低于噪声带——行缓冲流量 14,345,600 次数组操作/报告，1 ns/op
  上界 ~14 ms < ±35 ms；实测多路 +1.9/+4.8/+2.7 ms、三次干净两路
  **+7.5/−0.9/+8.6 ms（1.011×/0.999×/1.013×）**——符号在独立进程间
  翻转，纯带内抖动；
- **S9-C-4（WCT）** w 钳制 `Math.max(mu*(1-mu), 1e-10)` 改三元
  `prod < 1e-10 ? 1e-10 : prod`：逐位对全体 double 成立（NaN 两者均
  传播；±0.0 两者均钳到 1e-10，且 mu∈[0,1] 下乘积永非 −0.0），但
  组件级 delta 仅 0.20–0.65 ns/行访问 × 3.59M 行访问 =
  **0.73–2.31 ms/报告**（低于带 ~15–48×）；三次干净两路
  +6.9/−3.1/+4.8 ms 同样符号翻转。

重剖析（§1）确认 S7-C 后成本模型在本 VM 复现：`solveSymmetric` 自身
**61.5%（~430 ms/报告）**、`irls` 自身 **18.7%（~131 ms）**——与 R8-C
的 61.4%/~433 与 19.8%/~140 同带；其余各池（编排 ~31、sigmoid ~28、
防御拷贝 ~20、APC ~18、GC ~11 ms/报告）**每一个即使整池清零也低于
±35 ms 噪声带**。本轮把 irls 池内最后两类未点名结构（行缓冲流量、
内建钳制调用形态）点名并实测关闭，把两个架构级出口（线程化、WASM）
点名并理论关闭；无 ID 残差上界（回代 init fill ~0.5 ms、solve finite
for-of ~0.5 ms）实测收口。**在当前排除表、逐位契约与 ±35 ms 噪声带
下，本切片不存在不经表所有者层级契约变更（公开异步签名 / 构建面）
即可达落地线的候选**——收口声明与 R8-C 同强，且本轮额外关闭了带上
池内部的剩余微结构类。

小形状矩阵复核（R7-I 教训）：3 模型 × 3 项目 / 120 行档整报告中位
**20.3–20.5 ms**——该规模下整条报告低于噪声带，调用矩阵在小配置态
一侧整体收口。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB
（Beta vs 正态）与双归因（offline-logit vs offline-prob-add）全部保留
（X0-11），live 面零文件改动。仓库变更仅本报告一个文件；无生产赢家故
未提交新 scripts 资产（败者仿真全文进附录，遵守 R7-C/R8-C 先例）。

## 0. 范围与约束遵守

- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含
  S8-C-1..4 与 S9-A-1；X2-1 改写后行）→ round-09/PLAN.md →
  round-08/PLAN.md + R8-C.md → round-01/R1-C.md … round-07/R7-C.md +
  R7-C-LAND.md → 9 个切片源文件全量重读。
- 基线漂移检查：基线 `195cb53` 相对 R8-C 基线仅文档合入；切片最后一次
  改动仍为 `183df9b`（S7-C 落地本身），S7-C 落地形态（去重分支内支撑
  升序直加 + S6-C switch 累加 + 前提注释）原样在位，本轮未触碰未重写。
- 禁止重开项零触碰：S7-C 本体未回退未重写未另起平行 eta/dot 路径；
  S5-C-5 / S5-C-7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 及 X* /
  S1-*..S7-* / S8-A-*..S8-I-* / S9-A-* 全系未重提。共享 `dot()` 逐字
  未动（本轮两个可测候选均在 irls 体内，与 S8-C-1/2 的 on-prob/APC
  站点外推正交；S8-J 在途 ID 未发明）。
- 硬不变量全部满足（生产零 diff 下天然成立）：双 LCB 与双归因两路一行
  未删；`beta.every(Number.isFinite)`（S8-C-3）与回代对角 eps 卫
  （S8-C-4）未 DCE；promotion proposal-first；阈值 / 测试 / 公开签名 /
  数据面契约不动；±0.0 夹具逐位维持。
- 环境：Node 22.22.2（VM 默认低于 engines ≥22.19.0，nvm 切换，与
  R1-C..R8-C 同处理）、pnpm、`pnpm install --frozen-lockfile`。

## 1. 重剖析：S7-C 后成本模型（实测，未拷贝 R8-C 数字）

V8 `--cpu-prof`（perf 夹具 rows=400/p=60/bootstrap=200，2 次预热 + 7 次
测量；本 VM 生产每报告中位 **669.4 ms**（sorted：661.8 665.5 668.3
669.4 670.5 682.5 685.0）；工作进程采样 6,297.1 ms / 9 次报告调用，
Node 22.22.2）：

| 函数（自身时间） | 采样合计 | 折合 /报告 | 占比 |
| --- | --- | --- | --- |
| `solveSymmetric`（lin-alg） | 3872.9 ms | **~430 ms** | **61.5%** |
| `irls` 自身 | 1180.0 ms | **~131 ms** | **18.7%** |
| `fitLogitAdditive` 自身（编排+bootstrap） | 276.2 ms | ~31 ms | 4.4% |
| `sigmoid` | 255.6 ms | ~28 ms | 4.1% |
| lin-alg 匿名回调（防御拷贝） | 179.5 ms | ~20 ms | 2.9% |
| `averagePredictiveComparison` | 162.1 ms | ~18 ms | 2.6% |
| GC | 100.7 ms | ~11 ms | 1.6% |

与 R8-C 剖面（solve 61.4%/~433、irls 19.8%/~140）逐池同带——S7-C 后
成本模型在本 VM 稳定复现，未漂移。站点核算（仿真插桩，同夹具）：
fits=201、IRLS 迭代 8,966、p=60、n=400、s̄=4.457；行访问
**3,586,400 次/报告**（S9-C-3 每次省 2 store + 2 load，S9-C-4 每次换
1 次内建调用）；eta/mu 行缓冲流量 **14,345,600 次数组操作/报告**；
无 ID 残差：回代解向量 init fill 537,960 次写/报告（1 ns 上界
~0.5 ms）、solve 收尾 finite for-of 537,960 次迭代/报告（~0.5 ms，
S8-C-3 在同量级实测 0.40 ms）。

**收口复核**：两个带上池逐项对锁仍闭合——`solveSymmetric` 七类分解
（R6-C §2.5）由 X2-3 / S4-C / V8 / S5-C 族 / S4-C-1 / S4-C-2 /
S6-C-7 覆盖，主元搜索 S5-C-6、回代 S5-C-5、防御拷贝 S4-C-3、跨阶段
死卫 S8-C-4，本轮补测无 ID 残差上界（init fill / finite for-of 各
~0.5 ms，深度亚带）；`irls` 的 w/z/wz 公式体 + switch 分派（S6-C）+
支撑索引装载 + eta 支撑和（S7-C 落地形态）+ 戳拷贝（S6-C-6）+ 归零
（S5-C-7）+ delta（S2-C-3）+ 收敛检查（S8-C-3）之外，本轮把仅剩的
两类微结构——**行缓冲流量**（S9-C-3）与**内建钳制调用形态**
（S9-C-4）——点名并实测关闭。带下各池维持 R8-C 裁决（每池整清零
均 < 带）。架构级出口（多线程 / WASM）本轮点名并理论关闭
（S9-C-1/2）。

## 2. 候选总表（S9-C-1..4，全部淘汰）

本轮第九组从未点名角度：两个架构级出口 + irls 池内两类剩余微结构。
可测候选先过排除表相邻行区分，再过逐位仿真（附录脚本，9,788 项 ×
4 次独立全量运行 + 决斗模式 250 项 × 6 次独立进程），最后过真实规模
基准（组件级 + 多路赛马 + 三次干净两路决斗）。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-C-1 | bootstrap 200 次重拟合按 worker_threads 并行分片 | 契约级不可行：公开 `fitLogitAdditive` 签名同步（X0-4 公开签名不动），同步 worker 池需模块级隐藏状态（X1-1）+ Atomics 阻塞；单线程确定性执行模型是本切片全部逐位声明（含本表全部先例）的审计基底，线程化后逐位复验语义本身失效 | 不立仿真道（「不可行不立项」先例，R9-A 同构） | — | 理论淘汰。重开条件：表所有者层级决定公开异步签名 + 重建并行确定性审计契约（不预期） |
| S9-C-2 | `solveSymmetric`/irls 内核迁移 WASM（含 SIMD） | 构建面 + 平台面变更（S6-I-2 同族），超出切片权限；SIMD 浮点归约顺序 ≠ 标量逐位契约，宽度不同结果不同；标量 WASM 无 SIMD 时增量来源仅为绕 JIT，投机且不可审计 | 不立仿真道 | — | 理论淘汰。重开条件：表所有者层级开放构建面 + 放弃逐位契约（不预期） |
| S9-C-3 | irls 每行 `eta[i]`/`mu[i]` 行缓冲整体消除——stamp 循环只写 `etaByKey`/`muByKey`（Float64Array 存精确 double），累加循环 `muByKey[keys[i]]` 直读（EMB） | 每行访问省 2 store + 2 load（换 1 int load + 2 typed load）；行缓冲流量 14.35M 数组操作/报告，1 ns/op 整池上界 ~14 ms **< ±35 ms 带**——上界即封顶 | ✅ 全电池（24 直接 irls 夹具 s=1..8 + 53 全报告用例 + ±0.0/β=0/空支撑对抗）逐位 × 4 次运行 | 多路 +1.9/+4.8/+2.7 ms；三次干净两路 **+7.5/−0.9/+8.6 ms（1.011×/0.999×/1.013×）**——符号翻转，带内抖动 | 淘汰：整池运算量上界低于噪声带 ~2.4×，实测深度带内且方向不稳。与 S2-C（键去重本体）、S6-C-6（戳拷贝）、S7-C（支撑和）互异：本候选是去重结果的**回读缓冲**层，此前从未点名。重开条件：n/keySpace 比值增长 ≥1 个数量级使行缓冲流量越带 |
| S9-C-4 | w 钳制 `Math.max(mu*(1-mu), 1e-10)` 改三元 `prod < 1e-10 ? 1e-10 : prod`（WCT） | 逐位对全体 double：NaN 两者均传播（max(NaN,c)=NaN；NaN<c 为 false 走 prod）；±0.0 两者均钳 1e-10（且 mu∈[0,1] 下 mu·(1−mu) 永非 −0.0）；有限值两侧同分支同值 | ✅ 同电池 + w 钳制边界探针（mu 使 prod 恰跨 1e-10 两侧、prod=1e-10 精确相等点）逐位 × 4 次运行 | 组件级 delta/行访问 **0.20–0.65 ns** × 3.59M = **0.73–2.31 ms/报告**；三次干净两路 +6.9/−3.1/+4.8 ms（1.010×/0.995×/1.007×） | 淘汰：上界即深度亚带（低于带 ~15–48×），V8 对二参数值型 `Math.max` 的内联已把可省成本压到 ns 级下沿。与 S3-C（单位乘消除）、X1-3（数值路径冻结——本候选逐位等价故不触犯，但也因此无值可取）区分。重开条件：无（形态变换收益上界随 JIT 只降不升） |

另有一处以既有裁决直接覆盖、不立新 ID：回代解向量
`new Array(n).fill(0)` 的 init fill 消除（解向量随后被逐项覆盖）——
537,960 次写/报告 ~0.5 ms 深度亚噪声，且与 S5-C-7（归零批消除，实测
负效应）同结构风险，不值立项。

### 2.1 线束锚点

多路赛马内 ctl（逐字 183df9b/195cb53 复刻入参数化线束）vs 生产导入：
**+39.8/+41.1/+43.6 ms（生产更快，1.06×）**——本轮线束仅注入
irls+solve 两件（R8-C 为四件线束，多路 +40.2 ms 同向同级），注入代价
方向与量级与 R8-C 一致；各变体与 ctl 同线束对比，差异恰为单站点编辑，
不受此影响。

## 3. 全切片裁决（9 文件）

| 文件 | 裁决(一行) |
| --- | --- |
| `offline-logit.ts` | 零改动。S9-C-3/4 实测淘汰、S9-C-1 理论淘汰（§2）；S7-C 落地形态（支撑升序 eta + 前提注释）逐字维持；S1-C/S2-C/S3-C/S6-C 落地形态维持；S8-C-1/2/3、S7-C-1..4、S5-C-5/7 全部未重提 |
| `lin-alg.ts` | 零字节改动。S9-C-2 理论淘汰（§2）；无 ID 残差上界（init fill / finite for-of 各 ~0.5 ms）实测收口；S4-C/S5-C 落地形态维持；S8-C-4 未重提；七类分解 + 五锁全部闭合 |
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
| S9-C-1 | bootstrap 重拟合 worker_threads 并行化 | 契约级不可行：公开同步签名（X0-4）、模块级隐藏状态（X1-1）、单线程确定性执行是逐位审计基底。重开条件：表所有者层级公开异步签名决策（不预期） |
| S9-C-2 | solve/irls 内核迁移 WASM/SIMD | 构建面 + 平台面变更（S6-I-2 同族）超出切片权限；SIMD 归约顺序破坏逐位契约。重开条件：表所有者层级开放构建面（不预期） |
| S9-C-3 | irls eta/mu 行缓冲消除（etaByKey/muByKey 直读） | 逐位等价成立且已仿真证明，但整池流量上界 ~14 ms/报告 < ±35 ms 带；三次干净两路 +7.5/−0.9/+8.6 ms 符号翻转纯噪声。重开条件：n/keySpace 增长 ≥1 个数量级使行缓冲流量越带 |
| S9-C-4 | w 钳制 Math.max 改三元 | 逐位等价成立（含 NaN/±0.0/边界探针），但 0.73–2.31 ms/报告深度亚噪声（低于带 ~15–48×）。重开条件：无 |

切片级收口条件：R6-C §2.5 七类分解 + S7-C 落地 + S8-C 跨函数死卫类
之后，本轮把 irls 池内剩余微结构（行缓冲流量、内建钳制形态）与两个
架构级出口（线程化、WASM）全部点名关闭；带下各池整池清零均不越带；
无 ID 残差上界（~0.5 ms × 2）实测收口。**在当前排除表、逐位契约与
±35 ms 噪声带下，本切片无可达落地线的候选**；推翻该声明需要
（a）指出七类 + 本轮两微结构类之外的新成本类，或（b）表所有者层级
的契约变更（公开异步签名 / 构建面开放 / X2-3 数值路径解冻——均不
预期），或（c）现实规模位移 ≥1 个数量级使 S8-C-1/2 或 S9-C-3 的
重开条件成立。

## 5. 测试与验证

环境：Node 22.22.2（nvm；VM 默认低于 engines）、pnpm。生产代码零改动，
测试文件零改动。

```bash
pnpm typecheck && pnpm lint && pnpm build    # ✓ 全绿（零 diff 基线自证）
pnpm test                                    # ✓ 全套通过（fail 0 / skipped 1）

# 本轮仿真（临时脚本，未入库——无生产赢家，全文见附录）
npx tsx /tmp/r9c-sim.mts                   # ✓ 9,788 项逐位 × 4 次独立运行，结论逐位一致
npx tsx /tmp/r9c-sim.mts --duel ctl,emb    # ✓ 250 项 + 决斗计时（×3 独立进程）
npx tsx /tmp/r9c-sim.mts --duel ctl,wct    # ✓ 250 项 + 决斗计时（×3 独立进程）

# 既有回归资产全量复跑（本 VM 锚点，落地零改动仍作回归门）
npx tsx scripts/round01-r1c-equivalence-sim.ts   # ✓ 8,028 项
npx tsx scripts/round02-r2c-equivalence-sim.ts   # ✓ 14,420 项
npx tsx scripts/round03-r3c-equivalence-sim.ts   # ✓ 14,730 项
npx tsx scripts/round04-r4c-equivalence-sim.ts   # ✓ 24,888 项
npx tsx scripts/round05-r5c-equivalence-sim.ts   # ✓ 28,555 项
npx tsx scripts/round06-r6c-equivalence-sim.ts   # ✓ 25,483 项
npx tsx scripts/round07-r7c-equivalence-sim.ts   # ✓ 6,193 项
# r7c 锚点：production 660.6 ms vs frozen S6-C 740.8 ms（1.12×），与父端
# 复跑（659.1/744.6，1.13×）同带。
```

代表性一次全量运行输出：

```text
scenario 1 (direct irls bitwise equivalence, 24 fixtures x {EMB, WCT} vs verbatim landed-S7-C irls/solve; support sizes: 1,2,3,4,5,6,7,8)
scenario 1b (adversarial signed-zero / beta=0 / empty-support fixtures + w-clamp boundary probes)
scenario 1c (direct solveSymmetric adversarial matrices, 51 fixtures x {prod} vs verbatim landed solve; forced-swap fixtures: 11; null returns: 6)
scenario 2 (full-report bitwise equivalence, 53 cases x {production, EMB, WCT} vs verbatim landed-S7-C pipeline)
S9-C-4 bench w-clamp (400 rows): max=0.36us ternary=0.28us delta/visit=0.20ns -> per report (x3.59M row visits) ~0.73ms
no-ID residual bounds: back-sub init fill = 537960 writes/report (~0.5ms at 1ns); solve finite for-of = 537960 iterations/report (~0.5ms, S8-C-3 measured 0.40ms at identical volume)
site accounting: fits=201 irlsIterations=8966 p=60 n=400 sBar=4.457; row visits/report=3586400 (S9-C-3 drops 2 stores + 2 loads each, S9-C-4 swaps 1 builtin call each); eta/mu row-buffer traffic = 14345600 array ops/report
  shape small (3 models x 3 projects, 120 rows): median 20.4 ms/report
  shape perf (6 models x 8 projects, 400 rows): median 733.4 ms/report
perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps (multi-way, relative order only):
  ctl (landed S7-C)    726.0 ms  (1.00x vs ctl)
  production           682.4 ms  (1.06x vs ctl)
  VAR-EMB              723.3 ms  (1.00x vs ctl)
  VAR-WCT              724.0 ms  (1.00x vs ctl)

ALL EQUIVALENCE CHECKS PASSED (9788 bitwise checks)
```

其余两次精确留档运行的多路表（相对序一致）：

```text
run A:  ctl 742.3 | production 702.5 (1.06x) | VAR-EMB 740.4 (1.00x) | VAR-WCT 747.0 (0.99x)
run B:  ctl 725.3 | production 684.2 (1.06x) | VAR-EMB 720.5 (1.01x) | VAR-WCT 726.9 (1.00x)
S9-C-4 组件级（run A/B）：delta/visit 0.65ns / 0.63ns -> ~2.31 / ~2.27 ms/报告
```

决斗输出（独立进程）：

```text
duel ctl vs emb: ctl=680.5ms emb=673.0ms delta=7.5ms (1.011x)
duel ctl vs emb: ctl=678.2ms emb=679.0ms delta=-0.9ms (0.999x)
duel ctl vs emb: ctl=679.7ms emb=671.1ms delta=8.6ms (1.013x)
duel ctl vs wct: ctl=685.8ms wct=678.9ms delta=6.9ms (1.010x)
duel ctl vs wct: ctl=677.4ms wct=680.6ms delta=-3.1ms (0.995x)
duel ctl vs wct: ctl=695.0ms wct=690.1ms delta=4.8ms (1.007x)
```

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装；
决斗模式 `npx tsx <file> --duel ctl,emb`）。若 S9-C-3 的重开条件将来
成立，本脚本可直接改造为 `scripts/round09-r9c-equivalence-sim.ts`
落地资产。

```ts
/**
 * Round 9 / R9-C deterministic equivalence + benchmark simulation
 * (offline routing slice, ninth pass). NOT committed: no production winner
 * this round — full source goes into the R9-C report appendix.
 *
 * Adjudicated lanes (all measured against CTL = verbatim 183df9b/195cb53
 * production irls/solve, i.e. the landed S7-C form; every already-excluded
 * edit UNAPPLIED):
 *
 *   PROD  production import (equivalence anchor; must match CTL bitwise)
 *   EMB   S9-C-3 candidate: the irls per-row eta/mu row buffers are removed
 *         entirely — the stamp loop only fills the per-key Float64Array
 *         values, and the accumulation loop reads etaByKey[keys[i]] /
 *         muByKey[keys[i]] directly. Bitwise trivially: a Float64Array
 *         stores exact doubles, so both loops consume the identical values;
 *         only 2 stores + 2 loads per row visit move to 1 integer load +
 *         2 typed loads.
 *   WCT   S9-C-4 candidate: the w clamp Math.max(mu*(1-mu), 1e-10) replaced
 *         by a ternary (prod < 1e-10 ? 1e-10 : prod). Bitwise for all
 *         doubles incl. NaN (both keep NaN) and ±0.0 (both clamp to 1e-10);
 *         mu*(1-mu) is never -0.0 here anyway (mu ∈ [0,1]).
 *
 * Theory-rejected candidates with NO lane (contract-level infeasibility,
 * no measurement needed — "不可行，不立项" precedent):
 *   S9-C-1 bootstrap refits parallelized across worker_threads — the public
 *          fitLogitAdditive signature is synchronous (X0-4), a sync worker
 *          pool needs module-level hidden state (X1-1) + Atomics blocking,
 *          and the single-threaded deterministic execution model is the
 *          audit substrate of every bitwise claim in this slice.
 *   S9-C-2 solve/irls kernel migration to WASM/SIMD — build-face + platform
 *          surface change (S6-I-2 same family), outside slice authority.
 *
 * Modes:
 *   (default)          equivalence battery + instrumentation + micro benches
 *                      + in-process multi-way race (relative order only)
 *   --duel A,B         clean two-lane: exactly two racers, 7 interleaved
 *                      reps, median (run in 3+ independent processes)
 *
 * Run: npx tsx /tmp/r9c-sim.mts [--duel ctl,emb]
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

interface Pipeline {
  readonly irls: IrlsImpl;
  readonly solve: SolveImpl;
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
/* CTL irls: verbatim current production irls (landed S7-C form),       */
/* parameterized only by the solve implementation.                      */
/* ------------------------------------------------------------------- */

const irlsCtl: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter, solve) => {
  void vectors;
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

/* EMB (S9-C-3): identical except the per-row eta/mu buffers are removed;
 * the stamp loop only fills the per-key values and the accumulation loop
 * reads them through keys[i]. Same doubles, different path. */
const irlsEmb: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter, solve) => {
  void vectors;
  const p = design.names.length;
  const n = rows.length;
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
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      const muI = muByKey[key]!;
      const etaI = etaByKey[key]!;
      const w = Math.max(muI * (1 - muI), 1e-10);
      const z = etaI + ((rows[i]!.y - muI) / w);
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

/* WCT (S9-C-4): identical except Math.max(prod, 1e-10) becomes a ternary.
 * Bitwise for all doubles: NaN stays NaN on both, ±0.0 clamps on both. */
const irlsWct: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter, solve) => {
  void vectors;
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
      const prod = mu[i]! * (1 - mu[i]!);
      const w = prod < 1e-10 ? 1e-10 : prod;
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

/* ------------------------------------------------------------------- */
/* CTL solve: verbatim current production solveSymmetric.               */
/* ------------------------------------------------------------------- */

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

/* ---------------------- rest of the verbatim pipeline ---------------------- */

const onProb = (vectors: readonly number[][], coefficients: readonly number[]): number[] =>
  vectors.map((vector) => sigmoid(dot(coefficients, vector)));

const apc = (
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number => {
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

  const onProbabilities = onProb(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      apc(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
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
    const sampleOnProbabilities = onProb(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = apc(
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

const CTL: Pipeline = { irls: irlsCtl, solve: solveCtl };
const LANE_EMB: Pipeline = { irls: irlsEmb, solve: solveCtl };
const LANE_WCT: Pipeline = { irls: irlsWct, solve: solveCtl };

const VARIANTS: Array<[string, Pipeline]> = [
  ["EMB", LANE_EMB],
  ["WCT", LANE_WCT],
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
  const r = fixtureRng(0x9c01);
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
    compareFits(`direct[${t}].EMB`, expected, irlsEmb(design, rows, vectors, supports, keys, n, maxIter, solveCtl));
    compareFits(`direct[${t}].WCT`, expected, irlsWct(design, rows, vectors, supports, keys, n, maxIter, solveCtl));
    fixtures++;
  }
  for (let s = 1; s <= 6; s++) {
    check(`direct.support-size-${s}-covered`, supportSizes.has(s));
  }
  out(
    `scenario 1 (direct irls bitwise equivalence, ${fixtures} fixtures x {EMB, WCT} vs ` +
      `verbatim landed-S7-C irls/solve; support sizes: ${[...supportSizes].sort((a, b) => a - b).join(",")})`
  );
}

/* -- scenario 1b: ±0.0 / beta=0 / empty-support adversarial irls fixtures -- */

function scenarioSignedZeroAdversarial(): void {
  // beta0-truncated: maxIter=1 pins the beta=0 first iteration (every eta
  // support sum adds only +0.0 entries).
  {
    const p = 8;
    const vectors: number[][] = [];
    const rows: Row[] = [];
    for (let j = 0; j < 12; j++) {
      const vec = new Array<number>(p).fill(0);
      vec[0] = 1;
      vec[1 + (j % (p - 1))] = 1;
      vectors.push(vec);
      rows.push({ scenarioId: "s", modelVersion: "m", projectId: "p", y: (j % 2) as 0 | 1 });
    }
    const supports = computeSupports(vectors);
    const keys = directKeys(vectors);
    const design = directDesign(p);
    const expected = irlsCtl(design, rows, vectors, supports, keys, rows.length, 1, solveCtl);
    compareFits("adv.beta0.EMB", expected, irlsEmb(design, rows, vectors, supports, keys, rows.length, 1, solveCtl));
    compareFits("adv.beta0.WCT", expected, irlsWct(design, rows, vectors, supports, keys, rows.length, 1, solveCtl));
  }
  // negative-beta: an all-fail dummy drives strongly negative coefficients.
  {
    const p = 6;
    const vectors: number[][] = [];
    const rows: Row[] = [];
    for (let j = 0; j < 40; j++) {
      const vec = new Array<number>(p).fill(0);
      vec[0] = 1;
      const bad = j % 2 === 0;
      if (bad) vec[1] = 1;
      else vec[2] = 1;
      if (j % 3 === 0) vec[3] = 1;
      vectors.push(vec);
      rows.push({ scenarioId: "s", modelVersion: "m", projectId: "p", y: bad ? 0 : 1 });
    }
    const supports = computeSupports(vectors);
    const keys = directKeys(vectors);
    const design = directDesign(p);
    const expected = irlsCtl(design, rows, vectors, supports, keys, rows.length, 50, solveCtl);
    compareFits("adv.negbeta.EMB", expected, irlsEmb(design, rows, vectors, supports, keys, rows.length, 50, solveCtl));
    compareFits("adv.negbeta.WCT", expected, irlsWct(design, rows, vectors, supports, keys, rows.length, 50, solveCtl));
  }
  // empty-support: an all-zero vector (s = 0) pins the lemma endpoint.
  {
    const p = 5;
    const vectors: number[][] = [];
    const rows: Row[] = [];
    for (let j = 0; j < 10; j++) {
      const vec = new Array<number>(p).fill(0);
      if (j !== 4) {
        vec[0] = 1;
        vec[1 + (j % (p - 1))] = 1;
      }
      vectors.push(vec);
      rows.push({ scenarioId: "s", modelVersion: "m", projectId: "p", y: (j % 2) as 0 | 1 });
    }
    const supports = computeSupports(vectors);
    const keys = directKeys(vectors);
    const design = directDesign(p);
    const expected = irlsCtl(design, rows, vectors, supports, keys, rows.length, 3, solveCtl);
    compareFits("adv.emptysup.EMB", expected, irlsEmb(design, rows, vectors, supports, keys, rows.length, 3, solveCtl));
    compareFits("adv.emptysup.WCT", expected, irlsWct(design, rows, vectors, supports, keys, rows.length, 3, solveCtl));
  }
  // WCT clamp-boundary probe: w values around the 1e-10 clamp, incl. exact
  // boundary, NaN, and ±0.0 (component-level identity of max vs ternary).
  {
    const probes = [Number.NaN, -0, 0, 5e-324, 1e-10, 1.0000000000000002e-10, 9.999999999999999e-11, 0.25, 1];
    for (const v of probes) {
      const viaMax = Math.max(v, 1e-10);
      const viaTernary = v < 1e-10 ? 1e-10 : v;
      check(`adv.wclamp[${v}]`, Object.is(viaMax, viaTernary));
    }
  }
  out("scenario 1b (adversarial signed-zero / beta=0 / empty-support fixtures + w-clamp boundary probes)");
}

/* ----- scenario 1c: direct solveSymmetric adversarial matrices (prod) ----- */

function scenarioDirectSolve(): void {
  const r = fixtureRng(0x9c02);
  let fixtures = 0;
  let swaps = 0;
  let nulls = 0;

  const runOne = (label: string, a: number[][], b: number[]): void => {
    const expected = solveCtl(a, b);
    if (expected === null) nulls++;
    compareSolutions(`solve[${label}].prod`, expected, solveSymmetric(a, b));
    fixtures++;
  };

  for (let t = 0; t < 40; t++) {
    const n = 1 + Math.floor(r() * 12);
    const a: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(r() * 4 - 2);
      a.push(row);
    }
    if (t % 3 === 0 && n >= 2) {
      a[n - 1]![0] = 1e6;
      swaps++;
    }
    if (t % 5 === 0) {
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) a[i]![j] = a[j]![i]!;
    }
    const b = Array.from({ length: n }, () => r() * 2 - 1);
    runOne(`rand${t}`, a, b);
  }

  runOne("singular2", [[1, 2], [2, 4]], [1, 2]);
  runOne("zero3", [[0, 0, 0], [0, 0, 0], [0, 0, 0]], [1, 1, 1]);
  runOne("nan-diag", [[Number.NaN, 1], [1, 2]], [1, 1]);
  runOne("inf-cell", [[1, Number.POSITIVE_INFINITY], [2, 1]], [1, 1]);
  runOne("nan-later", [[2, 1, 1], [1, Number.NaN, 1], [1, 1, 3]], [1, 1, 1]);
  runOne("signed-zero", [[2, -0, 1], [-0, 3, -0], [1, -0, 4]], [-0, 1, -0]);
  runOne("n0", [], []);
  runOne("n1", [[3]], [6]);
  runOne("n1-null", [[0]], [1]);
  runOne("eps-edge", [[1e-12, 0], [0, 1]], [1, 1]);
  runOne("eps-below", [[0.9e-12, 0], [0, 1]], [1, 1]);

  {
    let msgCtl = "";
    let msgProd = "";
    try { solveCtl([[1, 2]], [1, 2]); } catch (e) { msgCtl = (e as Error).message; }
    try { solveSymmetric([[1, 2]], [1, 2]); } catch (e) { msgProd = (e as Error).message; }
    check("solve.throw.same", msgCtl !== "" && msgCtl === msgProd);
  }

  out(
    `scenario 1c (direct solveSymmetric adversarial matrices, ${fixtures} fixtures x {prod} ` +
      `vs verbatim landed solve; forced-swap fixtures: ${swaps}; null returns: ${nulls})`
  );
}

/* -------------- scenario 2: full-report bitwise equivalence -------------- */

function scenarioEquivalence(): void {
  const cases = batteryCases();
  for (const [index, testCase] of cases.entries()) {
    const expected = fitWith(CTL, testCase.rows, testCase.options);
    compareReports(`R9C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    for (const [name, pipeline] of VARIANTS) {
      compareReports(`R9C-${name}[${index}]`, expected, fitWith(pipeline, testCase.rows, testCase.options));
    }
  }
  out(
    `scenario 2 (full-report bitwise equivalence, ${cases.length} cases x {production, EMB, WCT} ` +
      `vs verbatim landed-S7-C pipeline)`
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

  // S9-C-4 component: Math.max clamp vs ternary over realistic mu values.
  {
    const mus = onProb(vectors, coef);
    let sinkA = 0;
    let sinkB = 0;
    const maxCost = bench(() => {
      let acc = 0;
      for (let i = 0; i < mus.length; i++) {
        acc += Math.max(mus[i]! * (1 - mus[i]!), 1e-10);
      }
      sinkA += acc;
    }, 20000);
    const ternCost = bench(() => {
      let acc = 0;
      for (let i = 0; i < mus.length; i++) {
        const prod = mus[i]! * (1 - mus[i]!);
        acc += prod < 1e-10 ? 1e-10 : prod;
      }
      sinkB += acc;
    }, 20000);
    check("S9C4.sink", sinkA === sinkB || sinkA !== sinkB); // consume sinks
    const perVisitNs = ((maxCost - ternCost) / mus.length) * 1e6;
    out(
      `S9-C-4 bench w-clamp (400 rows): max=${(maxCost * 1e3).toFixed(2)}us ternary=${(ternCost * 1e3).toFixed(2)}us ` +
        `delta/visit=${perVisitNs.toFixed(2)}ns -> per report (x3.59M row visits) ~${(((maxCost - ternCost) / mus.length) * 3586400).toFixed(2)}ms`
    );
  }

  // Folded no-ID residuals: arithmetic bounds from site accounting (no bench
  // needed — pure operation counts at measured per-op scale).
  {
    // back-sub solution .fill(0): 60 writes x 8966 solves; solve-side for-of
    // finite check: 60 iterations x 8966; both at ~1ns/op are sub-ms.
    out(
      `no-ID residual bounds: back-sub init fill = ${8966 * p} writes/report (~0.5ms at 1ns); ` +
        `solve finite for-of = ${8966 * p} iterations/report (~0.5ms, S8-C-3 measured 0.40ms at identical volume)`
    );
  }
}

/* --------------------------- site accounting --------------------------- */

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
  const p = design.names.length;
  const n = baseRows.length;

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
  const countingPipeline: Pipeline = { irls: countingIrls, solve: solveCtl };
  fitWith(countingPipeline, rows, PERF_OPTIONS);

  const sBar = supports.reduce((acc, s) => acc + s.length, 0) / supports.length;
  const rowVisits = iterations * n;
  out(
    `site accounting: fits=${fits} irlsIterations=${iterations} p=${p} n=${n} sBar=${sBar.toFixed(3)}; ` +
      `row visits/report=${rowVisits} (S9-C-3 drops 2 stores + 2 loads each, S9-C-4 swaps 1 builtin call each); ` +
      `eta/mu row-buffer traffic = ${rowVisits * 4} array ops/report`
  );

  // Configured-state matrix probe: pool structure across shapes. At small
  // shapes the whole report is under the ±35 ms band; at wide shapes the
  // solve share only grows (O(p^3) vs O(n*s^2)).
  const shapes: Array<[string, OfflineRow[]]> = [
    ["small (3 models x 3 projects, 120 rows)", randomRows(fixtureRng(0x51), { scenarios: 2, models: 3, projects: 3, rows: 120, passRate: 0.6 })],
    ["perf (6 models x 8 projects, 400 rows)", rows],
  ];
  for (const [label, shapeRows] of shapes) {
    const times: number[] = [];
    fitWith(CTL, shapeRows, PERF_OPTIONS);
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      fitWith(CTL, shapeRows, PERF_OPTIONS);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    out(`  shape ${label}: median ${times[1]!.toFixed(1)} ms/report`);
  }
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfFixtureMultiway(): void {
  const rows = perfRows();

  const expected = fitWith(CTL, rows, PERF_OPTIONS);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, PERF_OPTIONS));
  for (const [name, pipeline] of VARIANTS) {
    compareReports(`perf-fixture.${name}`, expected, fitWith(pipeline, rows, PERF_OPTIONS));
  }

  const racers: Array<[string, () => AttributionReport]> = [
    ["ctl (landed S7-C)", (): AttributionReport => fitWith(CTL, rows, PERF_OPTIONS)],
    ["production", (): AttributionReport => fitLogitAdditive(rows, PERF_OPTIONS)],
    ["VAR-EMB", (): AttributionReport => fitWith(LANE_EMB, rows, PERF_OPTIONS)],
    ["VAR-WCT", (): AttributionReport => fitWith(LANE_WCT, rows, PERF_OPTIONS)],
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
  emb: (rows) => fitWith(LANE_EMB, rows, PERF_OPTIONS),
  wct: (rows) => fitWith(LANE_WCT, rows, PERF_OPTIONS),
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
  scenarioSignedZeroAdversarial();
  scenarioDirectSolve();
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
BRANCH=cursor/r9-c-offline-routing-ninth-pass-83a1

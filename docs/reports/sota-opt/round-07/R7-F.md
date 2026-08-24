MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-F：`src/experiments/` 第七遍复查报告（S6-F-1 之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `9c26b83`（含 S6-F-1 独占 tip、S6-C / S5-I-1 / S7-A-* / S7-B-* 排除）
- 切片：`src/experiments/` 全部 15 文件，工作在 S6-F-1 之上
- 前置阅读：README、EXCLUSIONS 全表（含 S7-A-1..4、S7-B-1..6）、round-07/PLAN、round-01/R1-F ～ round-06/R6-F
- 分支：`cursor/r7-f-experiments-seventh-pass-83a1`（已推送，未开 PR）

## 结论

**落地 2 项常数级优化（S7-F-1 + S7-F-2），同一提交（`519101f`）。** S7-F-1：shadow/canary restore 的反转成员判断（S6-F-1）之上叠加**对齐前缀快路径**——assignment 哈希与 population **同下标**条目字符串相等，即同时证明「非空字符串」与「冻结 population 成员」（population 内容刚被 validateExperimentPlan 全量重验），对齐前缀因此零 trim 探针、零哈希表操作；首个失配处回退到 pending-Set 方案只处理剩余后缀，**失配在下标 0 则改道原样落地循环**，全乱序输入只多付一次比较而非逐迭代税。S7-F-2：plan 验证 `assertUniqueNonEmpty` 的**可打印 ASCII 首字符卫**——首字符码点在 33..126 即证明该条目非空且不可能 trim 成空串（ECMAScript 全部 WhiteSpace/LineTerminator 码点均在该区间外），哈希形条目全部跳过 `trim()` 内建调用；首字符在区间外（含空串的 NaN，NaN 比较恒 false）逐字回落原 trim 探针，故障与消息逐字节不变。端到端 P=2000/A=1000 锚点全实验（本 VM 同机 A/B，worktree@基线 commit 对照）**175.0ms → 120.5ms（省 ~54.5ms，−31%）**；落地单元在全部四种 assignment 次序下同号为省（锚点 +44.8~+47.8ms、半对齐 +27.0~+29.9ms、乱序 +4.6~+7.7ms、倒序 +4.7~+8.0ms，四次独立运行）。等价性由入库仿真 `scripts/round07-r7f-equivalence-sim.ts`（169 项检查 × 四次独立运行 0 失败，含 1800 例对齐感知 restore 模糊 + 44 例定向 first-fault/对齐转移矩阵 + 717 例 plan 验证对抗字符串）与既有 r1f（2668 项）/r5f（224 项）/r6f（27 项）仿真回归共同证明。**披露**：S7-F-1 单拆的循环形态在全失配次序上有 −1.7~−3.5ms/2000 restores 的有界常数带（§2.5 与 S6-F-5 逐点区分），被同一提交内 S7-F-2 的无条件收益覆盖 2~4 倍，落地单元每次序净为正；回退边界干净（S7-F-1 限两个 restore 函数，S7-F-2 独立成立）。另裁决 2 个形态变体并淘汰（S7-F-3 无改道朴素相位拆分、S7-F-4 回退体外提函数化）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* ～ S6-* / S7-A-* / S7-B-* 条目。关键逐条对照：
  - **S7-F-1 不是 S6-F-5（双指针子序列快路径）**，四点本质区别：(1) 证明手段——同下标相等是**单次 O(1) 比较**即证成员资格；子序列需要在 population 上**前向搜索**（two-pointer while 推进）。(2) 失配代价——同下标失配立即停（对齐前缀已各付且仅付一次比较），失配在 0 改道后全程只多付一次比较 + 一次重读迭代，**有界常数**；子序列失配前 while 已把指针推到 population 末尾，每 restore 白付一遍 **O(P)** 扫描（S6-F-5 实测 scattered/reversed −18~−20ms 的来源）。(3) 回退粒度——后缀级回退（前缀成员资格已证明，不重付）；子序列失配后全量重跑。(4) 实测——落地单元四次序全部同号为正；S6-F-5 落地单元本身即翻符号。S6-F-5 的重开条件（assignment 次序契约化为 population 子序列）与本项无关：本项**不依赖任何次序契约**，对齐只是免哈希的机会主义证明，失配路径行为与成本受控。
  - **S7-F-2 不是「assertUniqueNonEmpty 探针数削减」**（PLAN 明令关闭的方向）：探针数不动（仍 1 次 `Set.add`/条目，S5-F 锁定），削减的是 `trim()` **字符串内建调用**——validate 布局四维度（批量构造 S6-F-3、对象表 S6-F-4、索引循环 S5-F-3、探针数 S5-F）之外的第五个独立维度（字符串操作维度），排除表经 `trim|charCode|align|prefix` 全检索无先例（仅 S2-J-3/S3-J-3 为 J 区 cluster 无关项）。
  - 未重提 S6-F-2（delete+size）、S6-F-3/4（validate 布局）、S5-F-1..3、S3-F-2（跳过 validate）、S2-F-4（assign includes）。
- 硬不变量全部维持：validateExperimentPlan 每调用照跑（Ω(P) 内容重读——卫兵只改变「用几条机器指令证明非空」，每条目仍被读取与判定）；每条 assignment 逐调用全检（Ω(A)——对齐路径逐条读 liveAction/changedLiveAction/shadowDecision/episodeHash 并判定，成员资格由相等性证明，检查一项不少）；`[...assignments]`/`[...outcomes]` 防御拷贝原样；双 LCB 与双归因未动；无阈值/测试/公开签名变更（新增 helper 均模块私有：`resolvePendingMembership`/`resolveCanaryPendingMembership`）；不声称 Outcome-supported。
- 切片漂移复核：`git log -- src/experiments/` tip 即 S6-F-1 落地提交 `f7a84fa`，S6-F-1 之后**零漂移**。
- 生产调用方次序复核：`src/adaptation/reflection.ts::evaluateProposalShadow` 按调用方 outcomes 次序 assign，**无对齐契约**——因此设计必须（且已）做到失配路径符号安全，收益侧押注锚点分布（战役验收锚点即 population 前缀序）。
- TypeError 语义保真：shadow 相位一保持落地属性读取序（liveAction → changedLiveAction → shadowDecision → episodeHash），canary 落地体本就 episodeHash 先行——两 runner 对 null/undefined assignment 的 TypeError 消息与抛出位置逐字节一致（模糊含 null 注入用例）。

## 1. 基底与锚点复核（本轮重新核实）

- 编辑前锚点（本 VM，Node 22.22.2，`git worktree` @ `9c26b83`）：r5f C2 全实验 **175.00ms**（2A-validate 组件 118.42ms，67.7%）；r6f partD 全实验 **174.98ms**——与父代理 S6-F-1 后复测 173.05 / 176.48ms 同带。
- 成本分解（编辑前）：validate 组件 ~118ms（67.7%）之内，`trim()` 内建调用是每条目继 Set 探针后的第二大字符串操作；restore 剩余 ~57ms 中 pending-Set 构建 + 早退扫描（S6-F-1 新地板，~2k 哈希操作/restore）是最大块。第七遍的两个新角度即分别指向这两块的**冗余部分**：锚点分布下 pending-Set 的构建证明了「对齐前缀成员资格」这一其实可由一次比较得到的事实；`trim()` 对可打印 ASCII 首字符条目是恒假探针。
- Ω(P+A) 下界第七次复核：契约强制的是**读取与判定义务**（每条目读到、每检查判到、每故障按生产字典序命名），不锁定证明手段的指令数。S7-F-1/2 移除的都是「换一种等价证明后即冗余」的操作：同下标相等 ⊇（非空 ∧ 成员），可打印 ASCII 首字符 ⊇ 非空。复杂度类照旧 O(P+A)。

## 2. 落地项 S7-F-1：restore 对齐前缀快路径

文件：`src/experiments/shadow.ts`（`restoreShadowState` + 私有 `resolvePendingMembership`）、`src/experiments/canary.ts`（`restoreCanaryState` + 私有 `resolveCanaryPendingMembership`）。

### 2.1 理论

- 相位一（对齐探测）：按落地检查序跑结构检查；`episodeHash !== population[index]` 即 break（无故障）。相等则该条目**免 typeof/trim/Set.add**——population[index] 已被 validate 证明为唯一非空字符串，相等性传递这两个属性外加成员资格。
- 相位二（回退）：失配下标 k>0 → pending-Set 方案只收集 k 起的后缀（shadow 的转移条目已过结构检查，只补哈希检查；canary 对齐比较即体首检查，k 起逐字重跑落地体）；k=0 → **改道原样落地 for-of 循环**（朴素相位拆分在此处付逐迭代指数税，见 S7-F-3）。成员解析共用早退计数 + 失败重放（S6-F-1 形态原样，提为私有 helper）。
- 全对齐成功路径（锚点）：零 Set 分配、零插入、零探查、零 trim——每 restore 从 ~2k 哈希操作 + A 次 trim 降到 A 次字符串相等比较（同进程状态下多为指针相等）。
- canary 的 derivedExposure 跨相位累加（前缀累加 + 后缀续加），exposure-match 与 canonicalHaltReason 检查位次不变。

### 2.2 保行为论证（逐位）

- **证明等价**：对齐 ⟹ 非空字符串 ∧ SameValueZero 成员（population 唯一非空由 validate 先行保证）；失配 ⟹ 不作任何判定，交回退按生产语义裁决。故障集合、消息、first-fault 字典序不变。
- **first-fault 竞速**：相位一结构故障 ⟹ 前缀全对齐即全成员，无更早成员故障可赢，直接抛（与落地「pending 全命中→抛结构故障」同结果）；回退侧结构故障捕获不抛，成员解析重放 `requirePopulationMember` 逐条探针复原首个违规（前缀条目必过探针，首个违规下标与落地一致）。shadow 同下标序（liveAction > shadowDecision > 哈希 > 成员）、canary 同下标序（哈希 > 成员 > action > exposureInt）均由相位内检查位置编码，定向矩阵覆盖（§2.3）。
- **不可观察差异**：对齐条目免 trim/Set.add（纯函数、无副作用）；k=0 改道重读 assignment[0] 属性一次（S6-F-1 失败路径重放已建立重读先例）；population 读取模式变化（S1-F 先例：纯数据读取模式非契约面）。
- **公开面**：runner 五方法、状态形状、全部导出签名不变；新 helper 模块私有。

### 2.3 仿真证据（`scripts/round07-r7f-equivalence-sim.ts`，已入库）

对照组为**整体冻结的编辑前行为**：S6-F-1 形态 restore 体 + S5-F 形态 assertUniqueNonEmpty/validateExperimentPlan 逐字冻结（冻结 restore 调用冻结 validate），被测侧全部生产导入——被测差异恰为 S7-F-1+S7-F-2 之和。

- Part A/B：900+900 例**对齐感知**随机 restore 模糊——基础次序按对齐前缀长 k∈[0,n]、全对齐、倒序、随机四族生成，再叠 round-6 全故障族篡改（成员/结构/同下标组合/重复/非字符串/空白哈希，半数 JSON 往返破坏指针相等）——verdict/消息/错误类/成功状态逐字节一致。
- Part C：27 shadow + 17 canary 定向用例 = round-6 first-fault 矩阵全量保留 + **对齐转移矩阵**（全对齐接受、前缀+乱序成员后缀接受、转移点非成员/空白/非字符串哈希、后缀内 membership@i vs structural@j 双向、下标 0 失配倒序接受、超 population 长度 ± 非成员、对齐重复对、对齐哈希结构故障压过后位成员故障；canary 侧另含 exposure 跨相位累加/失配）。
- 总计 **169 项检查 × 四次独立运行 0 失败**。

### 2.4 性能证据（落地单元，参考=编辑前整体冻结，四次独立运行）

2000 次 fail-closed restore 调用型（P=2000/A=1000）：

| 次序 | 参考（S6-F-1+S5-F 形态） | 生产（S7-F-1+2） | 节省（四运行带） |
| --- | --- | --- | --- |
| prefix（锚点，全对齐） | 161.3~165.8ms | 115.7~118.8ms | **+44.8 ~ +47.8ms** |
| half-aligned（前半对齐） | 182.8~187.3ms | 155.9~157.4ms | +27.0 ~ +29.9ms |
| scattered（全乱序） | 212.8~217.8ms | 208.2~210.2ms | +4.6 ~ +7.7ms |
| reversed（倒序） | 211.6~216.9ms | 205.3~208.9ms | +4.7 ~ +8.0ms |

端到端（同 VM 跨进程 A/B，基线=worktree@`9c26b83`）：

| 档位 | 编辑前 | 编辑后 |
| --- | --- | --- |
| r5f C2 全实验 | 175.00ms | **120.46ms（−54.5ms，−31.2%）** |
| r6f partD 全实验 | 174.98ms | **120.69ms** |
| r7f partE 全实验 | — | 127.3~129.6ms（fixture 略异，同带） |
| 2A-validate 组件 | 118.42ms（67.7%） | 100.58ms（83.5%，绝对值同降——即 S7-F-2） |

交叉回归：r1f 2668 项逐位检查全过（生产侧 fixture 62.0ms，参考侧 627ms，10.1×）；r5f 224 项、r6f 27 项全过（r6f partD 参考-对-生产 prefix +125.9ms 即 S6-F-1+S7-F 叠加视图）。

### 2.5 披露：S7-F-1 单拆的失配带与 S6-F-5 判例的关系

三形态冻结对冻结基准（双侧同 validate，隔离循环形态；含漂移对照——参考自身末位重测漂移仅 ±0.2~0.7ms，故负带为真实信号非漂移）：

| 次序 | 落地形态 C vs S6-F-1 形态（7 运行带） |
| --- | --- |
| prefix | **+38.7 ~ +47.1ms** |
| scattered | −1.7 ~ −3.0ms |
| reversed | +2.4 ~ −3.5ms（一次为正，余为负） |

即：S7-F-1 的循环形态**单独看**在全失配次序上有 −1.7~−3.5ms/2000 restores（每 restore ~1μs，该次序成本的 0.9~1.8%）的有界常数带——机械超额（一次对齐比较 + 一次改道重读迭代）远小于此，余为函数体增大后的 JIT/布局固定开销，函数外提（S7-F-4）不可消除。与 S6-F-5 判例的三点定量区别：(1) 量级——S6-F-5 罚 −18~−20ms（其收益的 ~60%、次序成本的 ~9%）；本项 −1.7~−3.5ms（收益的 ~5~8%、成本的 ~1.5%）。(2) 结构——S6-F-5 是随 P 增长的 O(P) 白付扫描；本项是不随 P/A 增长的有界常数。(3) 落地单元符号——S6-F-5 落地即翻；本项与同提交 S7-F-2（无条件 +6~+11ms/2000 调用）耦合后**每次序净为正**（§2.4 四运行同号）。裁决交父代理：若按「单拆符号纯度」权重高于锚点产出，回退边界干净——S7-F-1 限 `shadow.ts`/`canary.ts` 两个 restore 函数，S7-F-2 独立成立不受影响。

## 3. 落地项 S7-F-2：validate 可打印 ASCII 首字符卫

文件：`src/experiments/plan.ts`（`assertUniqueNonEmpty`）。

### 3.1 理论与保行为

- 原形态每条目 `value.trim() === ""`：`trim()` 为 CSA 内建调用，TurboFan 不内联；对非空白首尾字符串扫描后原样返回，再做空串比较——对哈希形条目是恒假但恒付的调用。
- 卫兵：`const head = value.charCodeAt(0); if (!(head > 32 && head < 127) && value.trim() === "")`。`charCodeAt(0)` 被 TurboFan 内联为裸字符载入。33..126 内 ⟹ 非空 ∧ 非全空白（ECMAScript trim 的空白集 = {9..13, 32, 0xA0, 0x1680, 0x2000..0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF}，全部在区间外）。空串 `charCodeAt(0)` 为 NaN，NaN 比较恒 false ⟹ 回落 trim 路径 ⟹ `"".trim() === ""` 照抛原消息（早期原型的 NaN 隐患即由此闭合）。首字符 ≤32、≥127（含全部 Unicode 空白、DEL、控制字符、非 ASCII、代理对）一律回落原探针——行为差异恒为零。typeof 检查拆为先行独立 if，同消息同序。
- 覆盖三个调用位（population/metrics/reversibleScopes），探针数、重复检测、first-fault 全部不动。

### 3.2 证据

- 入库仿真 Part D：**117 例定向对抗条目**（全 ECMAScript 空白类逐码点、ASCII 边界 32/33/126/127、NUL/控制字符、非 ASCII 首字符、代理对、前导/尾随空白混合、非字符串/数组注入，各注入 population/metrics/reversibleScopes 三槽位）+ **600 例随机 plan 模糊**（含重复、空数组、非数组）——verdict/消息/错误类逐字节一致，四次运行 0 失败。
- 性能（Part E，validateExperimentPlan ×2000，P=2000）：参考 116.1~120.2ms → 生产 107.4~111.5ms，**省 +6.3 ~ +11.1ms**，四运行同号。该收益无条件（不依赖 assignment 次序），是 §2.4 中 scattered/reversed 行净为正的构成来源。

## 4. 候选三条件裁决

| 候选 | (a) 不在排除表 | (b) 理论 + 仿真证明 | (c) 真实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| restore 对齐前缀快路径（下标 0 失配改道原样循环，形态 C） | ✓（§0 与 S6-F-5 四点区分） | ✓ 1800 对齐感知模糊 + 44 定向 + r1f/r5f/r6f 回归逐字节 | ✓ 锚点 +38.7~+47.1ms/2000 restores；失配带 −1.7~−3.5ms 有界常数、落地单元每次序净正（§2.5 全量披露） | **落地 S7-F-1** |
| validate 可打印 ASCII 首字符卫 | ✓（字符串操作维度，非探针数） | ✓ 117 定向对抗条目（全空白码点/边界/NaN）+ 600 模糊逐字节 | ✓ +6.3~+11.1ms/2000 调用，无条件同号 | **落地 S7-F-2** |
| 朴素相位拆分（无下标 0 改道，索引后缀循环直吃全数组） | ✓（S7-F-1 形态变体） | ✓（同一论证） | ✗ 失配次序被形态 C 支配：scattered −2.4~−3.3 vs C −1.7~−3.0，reversed −2.4~−4.4 vs C −2.1~−3.5，prefix 打平——同类方案唯一赢家纪律 | S7-F-3 |
| 回退体外提独立函数（形态 D，k=0/k>0 各一 helper） | ✓ | ✓（同一论证） | ✗ 对形态 C 无稳定增益：scattered −0.8~−3.1、reversed −1.8~−3.6，与 C 带互相重叠、5 运行 1 次反向——失配带非函数形状所致，外提不可消除，纯搅动 | S7-F-4 |

## 5. 逐文件收口（R1–R6 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | **落地 S7-F-1**（§2）；朴素拆分 = S7-F-3 淘汰；外提 = S7-F-4 淘汰；S6-F-1 语义原样保留于回退路径 | **落地** |
| `canary.ts` | **落地 S7-F-1**（对称；对齐比较即体首检查故回退更简，exposure 跨相位累加） | **落地** |
| `plan.ts` | **落地 S7-F-2**（§3）；探针数/布局四维度维持关闭，新开字符串操作维度并即时收割 | **落地** |
| `dataset.ts` | 首字符卫无镜像收益（sealed 校验每 manifest 一次、无 restore 放大，S5-F-1/S4-F-1 维持 test-only 判） | 无候选 |
| `simulation-holdout.ts` | 同上；S2-F-5/S3-F-5 维持 | 无候选 |
| `comparison-report.ts` | 真实 N 亚 ms 预算收口维持（R4-F 量化）；X3-2/S4-F-3/S1-F-5 维持 | 无候选 |
| `gated-comparison.ts` | S1-F-1/S2-F-6 维持 | 无候选 |
| `attribution-report.ts` | 无循环无新调用方 | 无候选 |
| `replay.ts` | 仍无生产调用方；S2-F-1/2/3、S4-F-2 维持 | 无候选 |
| `isolation.ts` | S3-F-4 维持 | 无候选 |
| `manifest.ts` | stableStringify 字节契约维持不提案 | 无候选 |
| `holdout.ts` | S1-F-3/X4-2 维持 | 无候选 |
| `threshold-calibration.ts` | S1-F-4 维持 | 无候选 |
| `evaluation-card.ts` | S1-B-7 域维持 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |

## 6. 前后对比与剩余空间

P=2000/A=1000 全实验 175.0ms → **120.5ms**（战役累计：727ms → ~120ms）。落地后剩余构成：(a) validate 组件 ~100.6ms（83.5%）——契约 Ω(P) 内容重读本体，每条目现为 typeof + charCodeAt 卫 + 单 Set 探针 + 计数比较，探针数（S5-F）/布局（S5-F-3、S6-F-3/4）/字符串操作（S7-F-2）三类维度全部收割或关闭，唯一剩余大块是 Set.add 本身——即唯一性证明的哈希工作，属契约义务本体；(b) restore 对齐路径已降到每 assignment ~4 载入 + 5 比较，接近读取义务地板；(c) 各 A 线性小项（recordOutcome 双 some ≈1–2ms、防御拷贝）历轮排除锁定。在保行为 + 契约 + 排除表约束下，本切片无剩余达「数十 ms」落地线的可测优化——第七遍消费的正是最后两处「等价证明替换后即冗余」的结构性空间。

## 7. 测试

- `npx tsx scripts/round07-r7f-equivalence-sim.ts` ✓ — 169 项检查 × 四次独立运行 0 失败；剔除计时行后确定性结论逐位一致
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（生产侧 fixture 62.0ms；信息行结构描述指 S1-F 时代，R6-F 已披露，未改脚本字节）
- `npx tsx scripts/round05-r5f-equivalence-sim.ts` ✓ — 224 项 0 失败（C2 端到端即 §2.4 编辑后数；C1/C4/C5 各分项回归维持）
- `npx tsx scripts/round06-r6f-equivalence-sim.ts` ✓ — 27 项 0 失败（partD 参考-对-生产即 S6-F-1+S7-F 叠加视图：prefix +125.9ms、scattered +33.4ms、reversed +31.7ms，全次序同号）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行
- 未触碰任何版本化阈值、权限、数据面契约、公开签名；未改任何测试断言；未编辑 EXCLUSIONS.md / PROGRESS.md
- 按纪律，S7-F-3/S7-F-4 的 loser 裁决脚本未入库（复现件见附录）；入库仅赢家仿真

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」；S7-F-1 / S7-F-2 请并入「已落地」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-F-3 | 对齐前缀快路径的朴素相位拆分形态（无下标 0 改道，索引后缀循环直吃全数组） | 失配次序被落地形态 C 支配（scattered/reversed 各差 ~0.5~1.5ms 且 7 运行方向一致），prefix 打平。同类方案唯一赢家纪律 |
| S7-F-4 | S7-F-1 回退体外提独立函数（k=0 / k>0 各一 helper） | 失配带（−1.7~−3.5ms/2000 restores）非函数形状所致，外提不可消除（5 运行与形态 C 带重叠、1 次反向）；漂移对照 ±0.2~0.7ms 证明带为真实信号。无稳定增益纯搅动 |

MORE_OPTIMA=no
BRANCH=cursor/r7-f-experiments-seventh-pass-83a1

## 附录 A：S7-F-3 / S7-F-4 裁决脚本（未入库，可复现）

保存为 `tmp-r7f-s7f3.ts` 后 `npx tsx tmp-r7f-s7f3.ts` 运行。脚本冻结四形态（S6-F-1 参考、朴素拆分、落地形态 C、外提形态 D）于同一进程、双侧调用同一生产 validate（S7-F-2 双侧抵消，隔离循环形态），末位重测参考形态作漂移对照。关键差异体：

```ts
/** S7-F-3: naive phase-split — 下标 0 失配也走索引后缀循环（无改道）。 */
if (structuralFault === undefined && index < assignments.length) {
  const pending = new Set<string>();
  const transition = assignments[index] as ShadowAssignment;
  if (typeof transition.episodeHash !== "string" || transition.episodeHash.trim() === "") {
    structuralFault = new DomainValidationError("episodeHash is required");
  } else {
    pending.add(transition.episodeHash);
    for (let i = index + 1; i < assignments.length; i++) { /* 落地体逐字，索引访问 */ }
  }
  resolvePending(serialized, pending);
}

/** S7-F-4: 形态 C 的两个回退分支各外提为独立函数，返回捕获的结构故障。 */
structuralFault = index === 0 ? unalignedFromStart(serialized) : unalignedSuffix(serialized, index);
```

两次带漂移对照的运行原始输出（前三次无对照运行的带已并入 §2.5/§4 表）：

```
order=prefix: S6-F-1-form=143.57ms naive-phase-split=102.56ms (delta 41.01ms) landed-formC=102.92ms (delta 40.65ms) formD-extracted=102.45ms (delta 41.12ms) ref-again=143.11ms (drift 0.46ms)
order=scattered: S6-F-1-form=200.54ms naive-phase-split=203.84ms (delta -3.29ms) landed-formC=203.46ms (delta -2.92ms) formD-extracted=202.70ms (delta -2.16ms) ref-again=200.12ms (drift 0.42ms)
order=reversed: S6-F-1-form=193.34ms naive-phase-split=196.45ms (delta -3.12ms) landed-formC=195.87ms (delta -2.54ms) formD-extracted=195.17ms (delta -1.84ms) ref-again=192.79ms (drift 0.54ms)
---（第 2 次独立运行）---
order=prefix: S6-F-1-form=142.42ms naive-phase-split=103.80ms (delta 38.63ms) landed-formC=103.58ms (delta 38.84ms) formD-extracted=104.26ms (delta 38.16ms) ref-again=142.63ms (drift -0.20ms)
order=scattered: S6-F-1-form=198.58ms naive-phase-split=201.42ms (delta -2.84ms) landed-formC=200.44ms (delta -1.86ms) formD-extracted=199.38ms (delta -0.79ms) ref-again=197.89ms (drift 0.69ms)
order=reversed: S6-F-1-form=195.34ms naive-phase-split=197.77ms (delta -2.43ms) landed-formC=197.43ms (delta -2.10ms) formD-extracted=197.28ms (delta -1.94ms) ref-again=195.01ms (drift 0.32ms)
```

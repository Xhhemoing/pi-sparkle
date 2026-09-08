MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-F：`src/experiments/` 第九遍复查报告（S7-F-1 + S7-F-2 之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `bf069cb`（含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 排除；切片最后一次改动仍是 S7-F 落地提交 `519101f`，`git diff 519101f..HEAD -- src/experiments/` 为空——**零漂移**，第九轮连续第三轮字节不变）
- 切片：`src/experiments/` 全部 15 文件（2550 行），全量实际读码；工作在 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上
- 前置阅读：README、EXCLUSIONS 全表（含 S9-A/B/C/D 全系）、round-09/PLAN、round-08/PLAN + R8-F、round-01/R1-F ～ round-07/R7-F
- 分支：`cursor/r9-f-experiments-ninth-pass-83a1`（已推送，未开 PR）
- 环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，nvm 切换，历轮同处理）、pnpm 10.17.1、`pnpm install --frozen-lockfile`

## 结论

**无可落地的新更优解，本轮生产代码零改动。** 第九遍从 R8-F 的成本池收口出发（validate 契约本体 ~100 ms + restore 契约义务 ~7 ms + 全部非契约池 ≤ ~4 ms），枚举出三个排除表未覆盖的结构性新角度（S9-F-1..3），全部经理论 + 确定性仿真（seeded mulberry32，**1600 项等价模糊用例 × 两次独立运行 0 失败**，剔除计时行后确定性结论逐位一致）+ 本 VM 真实规模基准裁决后淘汰：

- **S9-F-1**（restore 对齐见证经私有返回通道 → assign 侧 O(1) 成员+唯一性双证明）：本切片首个把 assign 站点**两个**非契约组件（trim+includes 成员判断 + `requireUniqueAssignment` 的 O(A) some 扫描）同时降到单次有界比较的机制——等价成立（700 例模糊含 S8-F-1 越界角落、错位成员、既有前缀重复项），但**整组件天花板实测仅 2.77–2.86 ms/实验**（全实验 121.9 ms 的 ~2.3%，低于数十 ms 落地线 ~4–15×）；失配次序税符号翻转（−58 ~ +109 µs）＝纯抖动。该测量把 S8-F-1 的站点收口从「成员判断」扩展到「成员+唯一性联合」：**assign 检查站点全预算 < 3 ms，任何机制不必再测**。
- **S9-F-2**（recordOutcome assignments.some 末元素正向见证）：生产模式（`evaluateProposalShadow` 逐 assign 即录 outcome）使 some 前向扫描恒在**末位**命中——最坏情形；O(1) 末元素预检等价平凡（正向见证无 fail-open 角落，500 例模糊），但组件差实测 **1.54–1.57 ms/实验**，低于线约一个数量级；且对 `outcomes.some`（缺席证明必须全扫）与 `accumulatedCostUsd`（S1-F-8 域）无能为力。
- **S9-F-3**（validateExperimentPlan 三站点共享 scratch Set——函数作用域传参非 X1-1 模块态、文件私有签名非 S1-F-6 公开面）：等价成立（400 例双站点模糊含「抛错后脏 Set 不泄漏」序列），但实测**稳定负优化**（−0.96 / −1.86 ms 两轮同号）：V8 `Set.clear()` 本就装配新的小容量表（增长 rehash 分文不省），clear 调用开销反超新生代分配的近零成本——S3-B-1/S3-F-1/S6-F-4「省分配直觉实测反转」教训第 N 次复现，本轮为 clear-reuse 形态立档。

锚点重测（本 VM，未拷贝父代理数字）：P=2000/A=1000 全实验 **121.87 ms**（r5f C2），2A-validate 组件 101.11 ms（**83.0%**）；四种 assignment 次序在 S7-F-1+2 落地态全部同号为省（prefix **+45.89** / half-aligned **+26.25** / scattered **+4.03** / reversed **+6.84 ms**，r7f partE）——与 R8-F 记载带（120.39 ms 与 +45.43/+28.13/+6.28/+6.68）一致。全部剩余 >10 ms 成本池仍为契约义务本体（validate 的 Ω(P) 内容重读 + 唯一性哈希证明；restore 的 Ω(A) 逐条全检 + 防御拷贝）；非契约池经本轮补测后逐项 ≤ ~3 ms 且全部被排除表锁定。**在当前排除表与逐位契约下，本切片不存在不经表所有者层级契约变更即可达落地线的候选；第九遍对 R8-F 收口的三处最后缝隙（唯一性联合天花板、末元素命中模式、scratch 复用）已逐一测量并封死。**

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB 与双归因未动；无阈值/测试/公开签名/数据面变更。仓库变更仅本报告一个文件；无赢家故未提交新 scripts 资产（裁决仿真全文进附录 A，遵守 R7-F/R8-F 纪律）。

## 0. 范围与约束遵守

- 阅读顺序按令执行：README → EXCLUSIONS 全表 → round-09/PLAN → round-08/PLAN + R8-F → R7-F..R1-F → 15 个切片源文件全量重读（未依赖历轮记忆）。
- 未重开任何 X* / S1-* ～ S8-* / S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 条目。逐条对照：
  - **本轮未触碰 restore**，S7-F-1 / S6-F-1 落地形态原样在位（shadow/canary 两 runner 逐字未动）。按令重申区分：**S7-F-1 不是 S6-F-5**——前者是同下标 O(1) 相等证明、后缀级回退、失配有界常数税；后者是 population 上的双指针前向搜索，失配白付 O(P) 扫描、符号随次序翻转。本轮未重开 S6-F-5，也未提出任何两指针/子序列形态（S9-F-1 的见证是 restore 既有对齐循环的**副产物布尔值**，不含任何前向搜索）。
  - **S9-F-1 不是 S8-F-1**（那是 assign 站点无见证的独立同下标比较，只证成员资格，其排除行未触 `requireUniqueAssignment`；本候选经 restore 私有返回通道携带「全对齐」见证，把唯一性也并入同一次比较——S8-F-1 的重开条件「A 增长 ≥1 个数量级且调用次序获得对齐契约」不适用，因为本候选不依赖次序契约、失配回退逐字）；**不是 S2-F-4**（那是 population Set 复用——哈希表机制，本候选零哈希表）；**不是 S3-F-1**（那是 assignment-hash Set 化 unique 扫描，实测负 5.9–6.5 ms；本候选对 unique 的证明是population 唯一性的逻辑推论，零构建成本）；**不是 S1-F-6/X0-4**（restore 公开 `restore(serialized)` 方法签名与返回对象不变，见证仅在文件私有 `restoreShadowState` 的返回通道，公开包装層丢弃）。排除表经 `witness|aligned|unique` 全检索无同机制先例，属新提案，独立裁决。
  - **S9-F-2 不是 S1-F-8**（那是 recordOutcome 查重/成本累加的 Set/增量化——哈希表或跨调用状态；本候选是无状态 O(1) 正向见证，利用生产调用模式的末位命中，机制上是 S7-F-1「机会主义相等证明」在 recordOutcome 站点的同族而非哈希化）。划出范围：`outcomes.some` 缺席证明与 `accumulatedCostUsd` 重算仍属 S1-F-8 锁定域，本候选不触。
  - **S9-F-3 不是 X1-1**（scratch Set 为 validateExperimentPlan 函数作用域、按参传入文件私有 helper，无模块级状态、无跨调用留存）；**不是 S1-F-6**（`validateExperimentPlan: void` 公开签名不变，改的是文件私有 `assertUniqueNonEmpty` 的参数表）；**不是 S6-F-3/S6-F-4/S5-F-3**（不改布局/探针/循环形态，仅改 Set 生命周期）。属新提案，独立裁决——实测负优化直接淘汰。
  - assign 链 restore→applyExperimentClock 中间对象融合（免一次 8 字段 spread）本轮枚举后**不立 ID 不测量**：R2-F 已把时钟/预算 spread 记为「O(字段数) 非 O(A)」池（每 assign 一次 8 字段 spread × 2A ≈ 数十 µs 天花板），且融合需为 assign 开 applyExperimentClock 平行变体（X1-2 邻域）+ S5-D-3「中间对象消除」同族——三重覆盖，无需新行。
  - 未重提 S1-F-1..8 / S2-F-1..6 / S3-F-1..5 / S4-F-1..3 / S5-F-1..3 / S6-F-2..5 / S7-F-3..4 / S8-F-1..3；未重做 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2；未重开 validate 布局维度（S6-F-3 及其 K 块粒度插值，R8-F §3.3 覆盖论证维持）。
- 硬不变量（生产零 diff 下天然成立，仍逐条核对）：validateExperimentPlan 每调用照跑（Ω(P) 内容重读）；每条 assignment 逐调用全检（Ω(A)）；`[...assignments]`/`[...outcomes]` 防御拷贝原样；TypeError 消息与属性读取序不变（shadow：liveAction → changedLiveAction → shadowDecision → episodeHash；canary：episodeHash 先行）；双 LCB 与双归因未动；无阈值变更；X1-5（shadow-compare 不并 r1-shadow-report）、X3-3/X4-1（不 fail-open 增量化）维持；不声称 Outcome-supported。
- 漂移复核：`git diff 519101f..HEAD -- src/experiments/` 为空（本轮实测）；R8-F 时代的先前规模数据仍适用，但全部锚点仍按令在本 VM 重测（§1）。

## 1. 锚点重测 + 配置态 × 命令类矩阵复核（本 VM 实测）

### 1.1 全实验锚点（未拷贝父代理/R8-F 数字）

| 档位 | 本 VM 实测 | R8-F 记载带 |
| --- | --- | --- |
| r5f C2 全实验（P=2000/A=1000） | **121.87 ms** | 120.39 ms |
| r6f partD 全实验 | 120.90 ms | 117.82 ms |
| r7f partE 全实验（fixture 略异） | 127.88 ms | 130.21 ms |
| 2A-validate 组件 | 101.11 ms（**83.0%**） | 100.06 ms（83.1%） |

四种 assignment 次序（r7f partE，S7-F-1+2 落地态 vs 编辑前冻结参考，2000 restores）：prefix **+45.89 ms**、half-aligned **+26.25 ms**、scattered **+4.03 ms**、reversed **+6.84 ms**——全次序同号为省，S7-F 落地单元在本 VM 复现无回归。r6f partD（S6-F-1+S7-F 叠加视图）：prefix +125.16 / scattered +31.27 / reversed +28.43 ms。r7f validate 组件视图（S7-F-2 单元）：×2000 调用省 +9.41 ms。r1f 2668 项逐位检查全过（生产侧 62.3 ms，参考侧 632.2 ms，10.1×）。r5f C1（S5-F 单元）：has+add 148.62 → add+size 118.26 ms（+30.35 ms）；C4 索引循环形式 −3.12 ms 维持 S5-F-3 抖动带记载。

### 1.2 配置态 × 命令类矩阵（逐项复核）

- **生产消费链**（rg 全仓复核，与 R8-F 逐条一致，**无新 src/ 调用方**）：`reflection.ts` L214–215（validateExperimentPlan + createShadowRunner，唯一 runner 生产链，L217–223 按调用方 outcomes 次序 assign+recordOutcome，**无对齐契约**，且每 outcome 紧随其 assign 记录——S9-F-2 的末位命中模式即源于此）；`eval-routing.ts`（gatedComparisonReport / createIsolationGuard / stableStringify / replayCacheKey）；`promotion-rules.ts`（validateComparisonReport）；`r1-shadow-report.ts`（gatedComparisonReport）。`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout`、sealed-manifest 全链路、`HoldoutVault`、`calibrateSoftThreshold`、`compareShadowR1`、`writeAttributionPair` 仓内仍仅测试可达。
- **命令类覆盖**：start（常数构造）、assign（本轮 S9-F-1 站点，§2）、recordOutcome（本轮 S9-F-2 站点，§2）、restore（S7-F-1 落地形态零漂移）、cancel（restore + clock + 一次 spread，每实验至多一次）。
- **配置态维度**：canary 块（test-only，S9-F-1/2 的裁决对称覆盖 canary 站点——test-only 加倍否决）、missingOutcomePolicy 三值（同成本路径）、halted 态（canonicalHaltReason 每 restore 至多一次 trim，锚点态 haltReason 缺省）、options.outputRoot 隔离守卫（每 runner 一次，生产唯一路径已被 S3-D-3 否决）——无默认空夹具遮蔽的配置态热路径，矩阵无空洞。

### 1.3 剩余成本池分解（本 VM，本轮补测两项）

121.9 ms = validate 组件 **101.1 ms**（契约 Ω(P) 内容重读本体：探针数 S5-F、布局 S5-F-3/S6-F-3/4、字符串操作 S7-F-2、scratch 复用 **S9-F-3（本轮实测负优化）** 五个维度全部收割或关闭，剩余大块是唯一性证明的哈希工作本体——S6-F-4 已证用户态表慢 38–45%，本轮 S9-F-3 再证 clear-reuse 亦负，native Set 冷分配形态即地板）+ restore 对齐扫描与防御拷贝 **~7 ms**（Ω(A) 契约义务）+ 非契约 A 线性池（本轮补测：assign trim+includes+some 全组件 **2.72–2.93 ms**（S9-F-1 天花板，含 S8-F-1 当年单测的 1.14–1.21 ms trim+includes 子项）、recordOutcome assignments-some **1.60–1.64 ms**（S9-F-2 天花板，本轮首次单列）、rng 重放 ~3 ms（S2-F-1）、outcomes.some + 成本累加（S1-F-8）、时钟/预算 spread O(字段数)）。**无一非契约池达两位数 ms；三个最大者的 O(1) 消除机制已全部立档否决。**

## 2. 候选总表（S9-F-1..3，全部淘汰）

裁决仿真（附录 A 全文）：1600 项等价模糊用例（700 + 500 + 400）+ 三部基准 × 两次独立运行 0 失败，确定性结论逐位一致。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准（本 VM） | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-F-1 | restore 对齐见证经私有返回通道 → assign 侧 O(1) 成员+唯一性双证明：restore 的 S7-F-1 对齐循环无 break 走完即证「assignments ≡ population 前缀」，该布尔值经文件私有返回通道给 assign；`assignments.length < P && population[assignments.length] === hash` 一次有界比较即同时证明非空+成员（S8-F-1 引理）+ **非重复**（population 唯一 ∧ 既有哈希 = population[0..A-1] ⟹ population[A] 不等于任何既有项），命中免 trim 探针、免 O(P) includes、免 O(A) some；失配或见证为假回退落地检查逐字 | 首个同时覆盖 assign 站点两个非契约组件的机制；锚点分布命中率 100%，每 assign 从 O(P+A) 降为 1 次比较 | ✅ 700 例模糊（对齐命中/错位成员/既有前缀重复项——快路径必失配且回退 some 必命名/非成员/空白/非字符串/越界下标 maxAssignments>P 角落）throw/消息/类逐字节一致；界卫按 S8-F-1 fail-open 教训预置 | 组件级（A=1000，mirror-vs-mirror，prefix）：落地 2841–2928 µs vs 快路径 72–74 µs——**整组件天花板 2.77–2.86 ms/实验（全实验 ~2.3%）**；scattered/reversed 失配税 −58 ~ +109 µs 符号翻转＝抖动 | 淘汰：收益天花板低于数十 ms 落地线 ~4–15×；S8-F-1（1.2 ms，成员单项）与 S3-F-1（unique Set 化负 5.9–6.5 ms）两个先例的联合上界在此实测封顶——**assign 检查站点全预算 < 3 ms，站点收口自成员单项扩展到成员+唯一性联合**；落地还需改两 restore 私有返回形状（S2-F-4 同型管线税） |
| S9-F-2 | recordOutcome assigned-membership 的末元素正向见证：`assignments[len-1].episodeHash === outcome.episodeHash` 即证 some 为真（生产模式恒末位命中——outcome 紧随 assign 记录，前向 some 扫描的最坏情形）；失配回退 some 逐字 | 正向见证平凡健全（元素存在即成员）；无缺席误证——fail-open 角落结构性不存在；每 recordOutcome 从 Σk≈A²/2 前向比较降为 1 次比较 | ✅ 500 例模糊（末位命中/中位命中/首位命中/未命中/空数组/重复项数组）判定一致 | 生产模式（A=1000）：落地 some 扫描 1602–1639 µs vs 见证 63–66 µs——**差 1.54–1.57 ms/实验** | 淘汰：低于线约一个数量级；且 outcomes.some（缺席证明必须全扫或哈希表=S1-F-8）与 accumulatedCostUsd（S1-F-8）不可同法覆盖，站点残余照旧；机制入档防后续以「顺手加个预检」重提 |
| S9-F-3 | validateExperimentPlan 三站点共享 scratch Set（函数作用域分配一次，population→metrics→reversibleScopes 传参 + 每站点 clear；shadow 形态两站点） | 免 1–2 次小 Set 分配/validate 调用 × 2A 次/实验；若 clear 保留容量还可免 population 站点增长 rehash | ✅ 400 例双站点模糊（重复/空项/空白/非字符串 × 两站点组合 + 抛错后脏 Set 复用序列）throw/消息/类逐字节一致 | validate 形态 ×2000（P=2000）：fresh-Sets 98.92–100.26 ms vs shared-scratch 99.89–102.12 ms——**稳定负 0.96–1.86 ms 两轮同号** | 淘汰：实测负优化——V8 `Set.prototype.clear` 装配新的小容量后备表（增长 rehash 分文不省），clear 调用本身反贴钱；新生代小对象分配近零成本（S3-B-1/S3-F-1/S6-F-4 教训在 clear-reuse 形态的复现，立档防「省分配」直觉第 N+1 次重提） |

## 3. 关键裁决细节

### 3.1 S9-F-1：站点收口的完成

R8-F 以 S8-F-1 封了 assign 站点的**成员判断**机制（天花板 1.14–1.21 ms，双机制确认），但其排除行明确未触 `requireUniqueAssignment` 的 some 扫描（S3-F-1 只证了 Set 化是负优化，未给出该组件的 O(1) 上界）。本候选是第一个能同时覆盖两组件的机制——对齐见证使唯一性成为 population 唯一性的零成本逻辑推论，无哈希表、无跨调用状态、失配有界。测量结论：**两组件联合天花板 2.77–2.86 ms/实验**，即便完美落地也差落地线 ~4–15×。加上落地需把两个 restore 私有函数的返回形状改为携带见证的包装（公开 `restore()` 不变但私有管线全改，S2-F-4 同型），量级与侵入两条死因独立成立。至此 assign 站点三条路径（Set 复用 S2-F-4、独立比较 S8-F-1、见证联合 S9-F-1）全部实测封顶，站点预算收口**完成**——重开条件：A 增长 ≥1 个数量级（届时联合天花板才可能过线）。

### 3.2 S9-F-2：最坏情形命中模式的价值与局限

本轮矩阵复核的新发现是生产调用模式使 `assignments.some` 恒在末位命中（`evaluateProposalShadow` 逐 assign 即录），前向扫描的最坏情形——这是 R7-I「配置态遮蔽」教训在调用模式维度的对应物（默认基准若随机命中会低估该组件一半）。O(1) 正向见证等价平凡且无 fail-open 面（与 S8-F-1 的越界角落对照：正向见证只在元素实际存在时短路，不存在误接受路径）。死因纯粹是量级：1.54–1.57 ms/实验，且站点其余两项（outcomes.some 缺席证明、accumulatedCostUsd 重算）在 S1-F-8 锁定域内无同法可乘——见证只能证「在场」，不能证「缺席」。

### 3.3 S9-F-3：clear-reuse 的实测反转

理论侧本候选有两个可能收益：免分配 + （若 clear 保容量）免增长 rehash。实测两轮稳定负（−0.96 / −1.86 ms）直接证伪了第二项：V8 的 `OrderedHashSet::Clear` 分配全新小容量表（非原地清空），population 站点的增长 rehash 每次照付；第一项（免 1 次小 Set 分配）被 clear 调用开销吃掉还倒贴。这与 S6-F-4（用户态对象表慢 38–45%）互为佐证：**validate 唯一性证明的哈希工作已在 native Set 冷分配形态的地板上**，分配侧、布局侧、探针侧、字符串侧、复用侧五个维度全部关闭。

## 4. 逐文件收口（R1–R8 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | S7-F-1 落地形态零漂移复核；**S9-F-1 在 assign 站点淘汰**（§3.1，站点收口完成）；**S9-F-2 在 recordOutcome 站点淘汰**（§3.2）；restore→clock 中间对象融合以 R2-F spread 池 + X1-2 + S5-D-3 三重覆盖不立 ID（§0）；unique 扫描/rng/双 some 维持 S3-F-1/S2-F-1/S1-F-8 | 无候选落地 |
| `canary.ts` | 对称复核（S9-F-1/2 裁决同覆盖 canary assign/recordOutcome 站点——test-only 加倍否决）；exposure 跨相位累加原样 | 无候选 |
| `plan.ts` | **S9-F-3 淘汰**（scratch 复用实测负，§3.3——validate 分配侧维度关闭）；探针数/布局/字符串操作/K 块维度维持关闭 | 无候选落地 |
| `dataset.ts` | S5-F-1/S4-F-1 维持（sealed 链 test-only）；scratch 复用无镜像收益（每 manifest 一次性 + 同负优化机制） | 无候选 |
| `simulation-holdout.ts` | S2-F-5/S3-F-5/S5-F-1 维持；requireHash 站点属 S8-F-2 同判 | 无候选 |
| `comparison-report.ts` | X3-2/S4-F-3/S1-F-5 维持；真实 N 亚 ms 预算收口维持（R4-F 量化） | 无候选 |
| `gated-comparison.ts` | S1-F-1/S2-F-6 维持；IMPROVEMENT_CLAIM 与 comparison-report 的 IMPROVEMENT_PATTERN 双字面量为模块级各编译一次，合并属重构非优化，不提案 | 无候选 |
| `attribution-report.ts` | 无循环无新调用方 | 无候选 |
| `replay.ts` | 仍无生产调用方；S2-F-1/2/3、S4-F-2 维持 | 无候选 |
| `isolation.ts` | S3-F-4 维持；唯一生产路径整体维持 S3-D-3 否决 | 无候选 |
| `manifest.ts` | stableStringify 字节契约维持 R2-F 不提案；S6-D-5（更快同字节序列化，459–468 µs）维持 | 无候选 |
| `holdout.ts` | S1-F-3/X4-2 维持 | 无候选 |
| `threshold-calibration.ts` | S1-F-4 维持 | 无候选 |
| `evaluation-card.ts` | S1-B-7 域维持 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |

## 5. 测试

- `npx tsx tmp-r9f-adjudication.ts`（附录 A）✓ — 6 项检查（1600 等价模糊用例）× 两次独立运行 0 失败；剔除计时行后确定性结论逐位一致
- `npx tsx scripts/round05-r5f-equivalence-sim.ts` ✓ — 224 项 0 失败（C2 端到端 121.87 ms 即 §1.1 锚点）
- `npx tsx scripts/round06-r6f-equivalence-sim.ts` ✓ — 27 项 0 失败（partD 三次序全正）
- `npx tsx scripts/round07-r7f-equivalence-sim.ts` ✓ — 169 项 0 失败（partE 四次序全正 + validate +9.41 ms）
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（生产侧 62.3 ms / 参考侧 632.2 ms，10.1×；信息行结构描述指 S1-F 时代，R6-F 已披露）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行
- 未触碰任何版本化阈值、权限、数据面契约、公开签名；未改任何测试断言；未编辑 EXCLUSIONS.md / PROGRESS.md / 任何 PLAN.md
- 按纪律，三个 loser 的裁决脚本未入库（全文见附录 A）；`scripts/` 零新增

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-F-1 | restore 对齐见证经私有返回通道 → assign 侧 O(1) 成员+唯一性双证明（`population[assignments.length] === hash` 有界比较，失配回退逐字） | 等价成立（700 例模糊含越界角落与前缀重复项），但两组件（trim+includes + unique some）联合天花板实测仅 **2.77–2.86 ms/实验**（全实验 ~2.3%，低于落地线 ~4–15×）；失配税 −58~+109 µs 符号翻转；落地需改两 restore 私有返回形状（S2-F-4 同型管线税）。**assign 检查站点三机制（S2-F-4/S8-F-1/S9-F-1）全部实测封顶，站点收口完成。** 重开条件：A 增长 ≥1 个数量级 |
| S9-F-2 | recordOutcome assignments.some 末元素正向见证（生产模式恒末位命中——outcome 紧随 assign 记录，前向扫描最坏情形；O(1) 预检失配回退逐字） | 正向见证平凡健全无 fail-open 面（500 例模糊），但组件差仅 **1.54–1.57 ms/实验**，低于线约一个数量级；outcomes.some 缺席证明与 accumulatedCostUsd 属 S1-F-8 锁定域不可同法覆盖。重开条件：A 增长 ≥1 个数量级 |
| S9-F-3 | validateExperimentPlan 三站点共享 scratch Set（函数作用域传参 + 每站点 clear；非 X1-1 模块态、非 S1-F-6 公开签名） | 等价成立（400 例含脏 Set 序列），但实测**稳定负优化 0.96–1.86 ms 两轮同号**：V8 `Set.clear` 装配新小容量表（增长 rehash 不省），clear 开销反超新生代分配；与 S6-F-4 互证 native Set 冷分配即哈希工作地板。validate 分配侧维度就此关闭 |

MORE_OPTIMA=no
BRANCH=cursor/r9-f-experiments-ninth-pass-83a1

## 附录 A：裁决仿真脚本（完整，可复现；无赢家按纪律不入库）

保存为 `tmp-r9f-adjudication.ts` 后 `npx tsx tmp-r9f-adjudication.ts` 运行。

```ts
/**
 * Round-9 R9-F adjudication simulation (temporary — embedded in the R9-F
 * report appendix, not committed as a standing script unless a winner lands).
 *
 * Adjudicates three fresh ninth-pass candidates over src/experiments/ on top
 * of the landed S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 baseline and the full
 * exclusion table (including S8-F-1..3):
 *
 *   S9-F-1  alignment-witness combined fast path: restoreShadowState already
 *           computes whether the WHOLE assignment array is population-aligned
 *           (its S7-F-1 aligned loop reaches assignments.length without a
 *           break). Export that witness through a PRIVATE return channel
 *           (public restore() signature unchanged) so assign can prove BOTH
 *           membership and uniqueness of the incoming hash with one
 *           bounds-guarded compare: population unique (just re-validated) ∧
 *           assignments ≡ population[0..A-1] ∧ hash === population[A]
 *           ⟹ member ∧ not-a-duplicate. Misses fall back verbatim. This is
 *           NOT S2-F-4 (restore-built Set reuse), NOT S8-F-1 (standalone
 *           same-index compare, membership only, no witness), NOT S3-F-1
 *           (assignment-hash Set build — measured negative).
 *   S9-F-2  recordOutcome last-element membership witness: the production
 *           loop (reflection.ts evaluateProposalShadow) records each outcome
 *           immediately after its assign, so assignments.some() always hits
 *           at the LAST index — the worst case for a forward scan. An O(1)
 *           positive witness (last element compare) before the verbatim scan.
 *           Positive witness only — no absence proof, so no fail-open corner.
 *   S9-F-3  shared scratch Set across the three assertUniqueNonEmpty sites
 *           inside one validateExperimentPlan call (population → metrics →
 *           reversibleScopes), file-private signature only. Saves two small
 *           Set allocations per validate call (shadow plans: one — no
 *           reversibleScopes site).
 *
 * Every equivalence check demands identical accept/reject verdicts, thrown
 * error messages, and error classes. All fixtures are generated with a seeded
 * mulberry32 so two independent runs produce bitwise-identical check verdicts
 * (timing lines are informational). Run with:
 *   npx tsx tmp-r9f-adjudication.ts
 */

import { DomainValidationError } from "./src/domain/errors.js";
import { createCandidateId, createResourceVersionId } from "./src/domain/ids.js";
import { requirePopulationEpisode, requireUniqueAssignment } from "./src/experiments/shadow.js";
import { validateExperimentPlan, type ExperimentPlan } from "./src/experiments/plan.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}\n`);
  }
}
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function timeMs(fn: () => void, rounds = 7): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    best = Math.min(best, Number(t1 - t0) / 1e6);
  }
  return best;
}

/** Deterministic fixture generator (mulberry32, fixture-only seed space). */
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

function runCatch(fn: () => void): { threw: boolean; message: string; cls: string } {
  try {
    fn();
    return { threw: false, message: "", cls: "" };
  } catch (error) {
    return {
      threw: true,
      message: error instanceof Error ? error.message : String(error),
      cls: (error as object)?.constructor?.name ?? "unknown",
    };
  }
}

function makeShadowPlan(populationSize: number, maxAssignments: number): ExperimentPlan {
  const population: string[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  return {
    planVersion: 1,
    experimentId: "exp_r9f_bench",
    mode: "shadow",
    baselineVersionId: createResourceVersionId(() => "r9fbase"),
    candidateId: createCandidateId(() => "r9fcand"),
    population,
    metrics: ["utility"],
    thresholds: { maxGuardrailBreaches: 1_000_000, maxCostUsd: 1e12 },
    budget: { maxAssignments, maxWallClockMs: 1e12 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
    canary: undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Part A — S9-F-1 alignment-witness combined fast path (assign site)  */
/* ------------------------------------------------------------------ */

interface MiniAssignment {
  readonly episodeHash: string;
}

/** Frozen mirror of the landed assign-path checks (shadow.ts assign). */
function refAssignChecks(
  plan: ExperimentPlan,
  assignments: readonly MiniAssignment[],
  episodeHash: string
): void {
  // requirePopulationEpisode: requireEpisodeHash + includes
  if (typeof episodeHash !== "string" || episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
  if (!plan.population.includes(episodeHash)) {
    throw new DomainValidationError(`episode ${episodeHash} is not in the frozen population`);
  }
  // requireUniqueAssignment
  if (assignments.some((assignment) => assignment.episodeHash === episodeHash)) {
    throw new DomainValidationError(`duplicate assignment for ${episodeHash}`);
  }
}

/**
 * Candidate: when the restore-side witness says the whole assignment array is
 * population-aligned (assignments[i].episodeHash === population[i] for all i,
 * a fact the landed S7-F-1 loop already establishes when it reaches
 * assignments.length without a break), a single bounds-guarded compare of the
 * incoming hash against population[assignments.length] proves membership
 * (equality with a validated population entry), non-emptiness (population
 * entries are unique non-empty strings), AND uniqueness (all existing
 * assignment hashes are population[0..A-1]; population entries are unique, so
 * population[A] cannot equal any of them). The bounds guard carries over the
 * S8-F-1 fail-open lesson (maxAssignments > P corner: out-of-range index
 * reads undefined, and an undefined episodeHash would satisfy === undefined).
 * Any miss — or an unaligned witness — falls back to the landed checks
 * verbatim.
 */
function fastAssignChecks(
  plan: ExperimentPlan,
  assignments: readonly MiniAssignment[],
  episodeHash: string,
  aligned: boolean
): void {
  if (
    aligned &&
    assignments.length < plan.population.length &&
    plan.population[assignments.length] === episodeHash
  ) {
    return;
  }
  refAssignChecks(plan, assignments, episodeHash);
}

function partA(): void {
  // Equivalence fuzz: candidate vs the production imports
  // (requirePopulationEpisode + requireUniqueAssignment), over aligned hits,
  // misaligned members, duplicates (early population entries — the fast path
  // must miss and the fallback scan must name them), non-members,
  // empty/whitespace, non-strings, and the out-of-range corner.
  const plan = makeShadowPlan(60, 90); // maxAssignments > P corner reachable
  validateExperimentPlan(plan);
  const rng = fixtureRng(0x9f01);
  const adversarial: unknown[] = [
    "", "  ", "\u00a0", "ep_zzz_not_member", null, undefined, 7, {}, [],
  ];
  let fuzz = 0;
  for (let c = 0; c < 700; c++) {
    // Build an assignment prefix: aligned with probability 0.6, else shuffled
    // members; length 0..65 (out-of-range corner when length >= 60).
    const len = Math.floor(rng() * 66);
    const alignedCase = rng() < 0.6;
    const prefix: MiniAssignment[] = [];
    if (alignedCase) {
      for (let i = 0; i < Math.min(len, 60); i++) {
        prefix.push({ episodeHash: plan.population[i] as string });
      }
    } else {
      const idx = Array.from({ length: 60 }, (_, k) => k);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = idx[i] as number;
        idx[i] = idx[j] as number;
        idx[j] = tmp;
      }
      for (let i = 0; i < Math.min(len, 60); i++) {
        prefix.push({ episodeHash: plan.population[idx[i] as number] as string });
      }
    }
    // The witness is only ever true when the aligned invariant actually holds
    // (restore computed it); model that faithfully.
    const witness = alignedCase;
    let query: unknown;
    const dice = rng();
    if (dice < 0.35) {
      query = plan.population[prefix.length] ?? "ep_zzz_not_member"; // aligned next (or corner)
    } else if (dice < 0.55) {
      query = plan.population[Math.floor(rng() * 60)]; // random member (maybe duplicate)
    } else if (dice < 0.7) {
      query = prefix.length > 0 ? prefix[Math.floor(rng() * prefix.length)]?.episodeHash : "ep_zzz_not_member"; // certain duplicate
    } else {
      query = adversarial[Math.floor(rng() * adversarial.length)];
    }
    const a = runCatch(() => {
      requirePopulationEpisode(plan, query as string);
      requireUniqueAssignment(prefix, query as string);
    });
    const b = runCatch(() => fastAssignChecks(plan, prefix, query as string, witness));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`A fuzz case ${c}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    fuzz += 1;
  }
  check("A alignment-witness combined fast path equivalence", true);
  out(`part A: ${fuzz} fuzz cases — throw/no-throw, message, and class identical`);

  // Ceiling bench at the production call shape (prefix order, one assign per
  // step, mirror-vs-mirror). The landed column measures the ENTIRE
  // trim + includes + some-scan component — the candidate's theoretical
  // ceiling. Scattered/reversed orders measure the miss tax (witness false,
  // one extra boolean test per assign).
  const A = 1000;
  const bench = makeShadowPlan(2 * A, A);
  validateExperimentPlan(bench);
  const orders: Record<string, number[]> = {
    prefix: Array.from({ length: A }, (_, k) => k),
    scattered: (() => {
      const idx = Array.from({ length: A }, (_, k) => k);
      const r = fixtureRng(0x9f02);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const tmp = idx[i] as number;
        idx[i] = idx[j] as number;
        idx[j] = tmp;
      }
      return idx;
    })(),
    reversed: Array.from({ length: A }, (_, k) => A - 1 - k),
  };
  for (const [name, order] of Object.entries(orders)) {
    const queries = order.map((i) => bench.population[i] as string);
    const aligned = name === "prefix";
    const tRef = timeMs(() => {
      const grown: MiniAssignment[] = [];
      for (let k = 0; k < A; k++) {
        refAssignChecks(bench, grown, queries[k] as string);
        grown.push({ episodeHash: queries[k] as string });
      }
    });
    const tFast = timeMs(() => {
      const grown: MiniAssignment[] = [];
      for (let k = 0; k < A; k++) {
        fastAssignChecks(bench, grown, queries[k] as string, aligned);
        grown.push({ episodeHash: queries[k] as string });
      }
    });
    out(
      `part A: order=${name} A=${A} landed trim+includes+some=${(tRef * 1000).toFixed(0)}µs ` +
        `witness-fast-path=${(tFast * 1000).toFixed(0)}µs (delta ${((tRef - tFast) * 1000).toFixed(0)}µs per experiment)`
    );
  }
  check("A bench completed", true);
}

/* ------------------------------------------------------------------ */
/* Part B — S9-F-2 recordOutcome last-element membership witness       */
/* ------------------------------------------------------------------ */

/** Frozen mirror of the landed assigned-membership check (shadow.ts). */
function refAssignedMembership(
  assignments: readonly MiniAssignment[],
  episodeHash: string
): boolean {
  return assignments.some((assignment) => assignment.episodeHash === episodeHash);
}

/** Candidate: O(1) positive witness at the last index, verbatim fallback. */
function witnessAssignedMembership(
  assignments: readonly MiniAssignment[],
  episodeHash: string
): boolean {
  const last = assignments.length - 1;
  if (last >= 0 && (assignments[last] as MiniAssignment).episodeHash === episodeHash) {
    return true;
  }
  return assignments.some((assignment) => assignment.episodeHash === episodeHash);
}

function partB(): void {
  // Equivalence fuzz: hits at last / middle / first, misses, empty arrays,
  // duplicate-bearing arrays, non-string junk entries.
  const rng = fixtureRng(0x9f03);
  let fuzz = 0;
  for (let c = 0; c < 500; c++) {
    const n = Math.floor(rng() * 30);
    const arr: MiniAssignment[] = [];
    for (let i = 0; i < n; i++) {
      const die = rng();
      arr.push({
        episodeHash:
          die < 0.1 && i > 0
            ? (arr[Math.floor(rng() * i)] as MiniAssignment).episodeHash
            : `h_${Math.floor(rng() * 40)}`,
      });
    }
    const die = rng();
    const query =
      die < 0.3 && n > 0
        ? (arr[n - 1] as MiniAssignment).episodeHash // last-element hit
        : die < 0.6 && n > 0
          ? (arr[Math.floor(rng() * n)] as MiniAssignment).episodeHash // interior hit
          : `h_${Math.floor(rng() * 80)}`; // maybe miss
    if (refAssignedMembership(arr, query) !== witnessAssignedMembership(arr, query)) {
      check(`B fuzz case ${c}`, false);
      return;
    }
    fuzz += 1;
  }
  check("B last-element witness equivalence", true);

  // Production-pattern bench: outcome k is recorded right after assign k, so
  // the scan hits at the LAST index every time (Σk ≈ A²/2 forward compares).
  const A = 1000;
  const hashes = Array.from({ length: A }, (_, i) => `ep_${i.toString(36).padStart(8, "0")}`);
  const tRef = timeMs(() => {
    const grown: MiniAssignment[] = [];
    for (let k = 0; k < A; k++) {
      grown.push({ episodeHash: hashes[k] as string });
      if (!refAssignedMembership(grown, hashes[k] as string)) {
        throw new Error("unreachable");
      }
    }
  });
  const tVar = timeMs(() => {
    const grown: MiniAssignment[] = [];
    for (let k = 0; k < A; k++) {
      grown.push({ episodeHash: hashes[k] as string });
      if (!witnessAssignedMembership(grown, hashes[k] as string)) {
        throw new Error("unreachable");
      }
    }
  });
  check("B bench completed", true);
  out(
    `part B: ${fuzz} fuzz cases identical; production pattern A=${A}: landed some-scan=${(tRef * 1000).toFixed(0)}µs ` +
      `last-element witness=${(tVar * 1000).toFixed(0)}µs (delta ${((tRef - tVar) * 1000).toFixed(0)}µs per experiment)`
  );
}

/* ------------------------------------------------------------------ */
/* Part C — S9-F-3 shared scratch Set across validate sites            */
/* ------------------------------------------------------------------ */

/** Landed assertUniqueNonEmpty (plan.ts, frozen mirror incl. S5-F + S7-F-2). */
function refAssertUnique(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  let unique = 0;
  for (const value of values) {
    if (typeof value !== "string") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    const head = value.charCodeAt(0);
    if (!(head > 32 && head < 127) && value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    seen.add(value);
    unique += 1;
    if (seen.size !== unique) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

/** Candidate: caller-owned scratch Set, cleared per site. */
function scratchAssertUnique(
  values: readonly string[],
  label: string,
  seen: Set<string>
): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  seen.clear();
  let unique = 0;
  for (const value of values) {
    if (typeof value !== "string") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    const head = value.charCodeAt(0);
    if (!(head > 32 && head < 127) && value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    seen.add(value);
    unique += 1;
    if (seen.size !== unique) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

function partC(): void {
  // Equivalence fuzz over the two-site shadow shape (population, metrics):
  // valid, duplicate-bearing, empty-entry, whitespace, non-string arrays; the
  // scratch variant reuses ONE Set across both sites like the candidate
  // validateExperimentPlan would, including fault-then-reuse sequences (a
  // dirty Set left by a throwing site must not leak into the next call).
  const rng = fixtureRng(0x9f04);
  const scratch = new Set<string>();
  let fuzz = 0;
  for (let c = 0; c < 400; c++) {
    const n = 1 + Math.floor(rng() * 12);
    const pop: string[] = [];
    for (let i = 0; i < n; i++) {
      const die = rng();
      pop.push(
        die < 0.08 ? "" : die < 0.16 ? "  " : die < 0.28 && i > 0 ? (pop[0] as string) : `p${Math.floor(rng() * 16)}`
      );
    }
    const metrics: string[] =
      rng() < 0.85 ? ["utility"] : rng() < 0.5 ? ["utility", "utility"] : [""];
    const a = runCatch(() => {
      refAssertUnique(pop, "population");
      refAssertUnique(metrics, "metrics");
    });
    const b = runCatch(() => {
      scratchAssertUnique(pop, "population", scratch);
      scratchAssertUnique(metrics, "metrics", scratch);
    });
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`C fuzz case ${c}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    fuzz += 1;
  }
  check("C shared scratch Set equivalence", true);

  // Ceiling bench at the validate call shape: 2000 validate-equivalent
  // two-site sequences over P=2000 (the shadow plan shape: population +
  // metrics, no reversibleScopes). The candidate saves ONE small Set
  // allocation per call (metrics site) — population still allocates/grows
  // the same buckets inside the scratch Set after clear() (V8 clear installs
  // a fresh small table, so growth work is NOT saved; this bench verifies
  // that empirically rather than assuming it).
  const P = 2000;
  const population: string[] = [];
  for (let i = 0; i < P; i++) {
    population.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  const metrics = ["utility"];
  const CALLS = 2000;
  const tRef = timeMs(() => {
    for (let i = 0; i < CALLS; i++) {
      refAssertUnique(population, "population");
      refAssertUnique(metrics, "metrics");
    }
  }, 5);
  const benchScratch = new Set<string>();
  const tVar = timeMs(() => {
    for (let i = 0; i < CALLS; i++) {
      scratchAssertUnique(population, "population", benchScratch);
      scratchAssertUnique(metrics, "metrics", benchScratch);
    }
  }, 5);
  check("C bench completed", true);
  out(
    `part C: ${fuzz} two-site fuzz cases identical; validate shape ×${CALLS} (P=${P}): ` +
      `landed fresh-Sets=${tRef.toFixed(2)}ms shared-scratch=${tVar.toFixed(2)}ms (delta ${(tRef - tVar).toFixed(2)}ms per experiment)`
  );
}

partA();
partB();
partC();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

两次独立运行原始输出：

```
part A: 700 fuzz cases — throw/no-throw, message, and class identical
part A: order=prefix A=1000 landed trim+includes+some=2841µs witness-fast-path=74µs (delta 2767µs per experiment)
part A: order=scattered A=1000 landed trim+includes+some=2786µs witness-fast-path=2761µs (delta 25µs per experiment)
part A: order=reversed A=1000 landed trim+includes+some=2797µs witness-fast-path=2787µs (delta 10µs per experiment)
part B: 500 fuzz cases identical; production pattern A=1000: landed some-scan=1639µs last-element witness=66µs (delta 1573µs per experiment)
part C: 400 two-site fuzz cases identical; validate shape ×2000 (P=2000): landed fresh-Sets=100.26ms shared-scratch=102.12ms (delta -1.86ms per experiment)

total: 6 checks, 0 failures
---（第 2 次独立运行）---
part A: 700 fuzz cases — throw/no-throw, message, and class identical
part A: order=prefix A=1000 landed trim+includes+some=2928µs witness-fast-path=72µs (delta 2855µs per experiment)
part A: order=scattered A=1000 landed trim+includes+some=2721µs witness-fast-path=2779µs (delta -58µs per experiment)
part A: order=reversed A=1000 landed trim+includes+some=2795µs witness-fast-path=2686µs (delta 109µs per experiment)
part B: 500 fuzz cases identical; production pattern A=1000: landed some-scan=1602µs last-element witness=63µs (delta 1539µs per experiment)
part C: 400 two-site fuzz cases identical; validate shape ×2000 (P=2000): landed fresh-Sets=98.92ms shared-scratch=99.89ms (delta -0.96ms per experiment)

total: 6 checks, 0 failures
```

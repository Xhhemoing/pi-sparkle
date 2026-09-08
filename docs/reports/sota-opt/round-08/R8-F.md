MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-F：`src/experiments/` 第八遍复查报告（S7-F-1 + S7-F-2 之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `8a8ab52`（含 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 排除；切片最后一次改动即 S7-F 落地提交 `519101f`，`git diff 519101f..HEAD -- src/experiments/` 为空——**零漂移**）
- 切片：`src/experiments/` 全部 15 文件，全量实际读码；工作在 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上
- 前置阅读：README、EXCLUSIONS 全表（含 S8-A/B/C 全系）、round-08/PLAN、round-07/PLAN、round-01/R1-F ～ round-07/R7-F
- 分支：`cursor/r8-f-experiments-eighth-pass-83a1`（已推送，未开 PR）
- 环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，nvm 切换，历轮同处理）、pnpm 10.17.1、`pnpm install --frozen-lockfile`

## 结论

**无可落地的新更优解，本轮生产代码零改动。** 第八遍从「配置态 × 命令类」矩阵复核出发（R7-I 教训），枚举出三个排除表未覆盖的结构性新角度（S8-F-1..3），全部经理论 + 确定性仿真（seeded mulberry32，**829 项等价用例 × 两次独立运行 0 失败**，剔除计时行后确定性结论逐位一致）+ 本 VM 真实规模基准裁决后淘汰：

- **S8-F-1**（assign 路径同下标成员快路径——S7-F-1 证明机制在 assign 站点的外推）：等价成立（含一枚**本轮实测抓到的 fail-open 反例**——朴素无界形式在 `maxAssignments > P` 角落对 `undefined` episodeHash 静默放行，越界 `population[index]` 与 `undefined` 恰相等；加界卫后 600 例模糊逐字节一致），但整个 trim+includes 组件在本 VM 锚点次序实测仅 **1.14–1.21 ms/实验**（全实验 120.4 ms 的 ~1%，低于数十 ms 落地线 ~40×），即该候选收益的**理论天花板**都不达线；失配次序另付 −1~−7 µs 有界单比较税（若落地须按 S7-F-1 先例耦合覆盖，但量级先行否决）。
- **S8-F-2**（S7-F-2 可打印 ASCII 首字符卫镜像到 A 线性 trim 站点——`requireEpisodeHash` / `validateExperimentOutcome`）：23 类对抗条目逐字节等价，但站点调用量仅 2A=2000 次/实验（对比 validate 站点的 4M），实测逐探针差 3.4 ns → **~6.8 µs/实验**，深低于线 ~4 个数量级。
- **S8-F-3**（`assertUniqueNonEmpty` 单元素快路径——metrics 站点免 Set 分配）：206 例等价，但 metrics 站点 2A 次调用合计差 **~190 µs/实验**，低于线 ~2 个数量级。

另有一处以既有关闭维度直接覆盖、不立新 ID：**K 块批量 size 检查**（每 K 条目查一次 `seen.size`、失配块内精确重放命名重复项）是已关闭的 S6-F-3「批量 Set 快路径 + 精确回退」维度的粒度插值——S6-F-3 的全批量形式（该机制节省上界的极大化形态）已实测符号翻转（+2.10/−0.34 ms），K 块形式的节省潜力被其支配，且 PLAN 明令不得重开 validate 布局维度。

锚点重测（本 VM）：P=2000/A=1000 全实验 **120.39 ms**（r5f C2），2A-validate 组件 100.06 ms（**83.1%**）；四种 assignment 次序在 S7-F-1+2 落地态全部同号为省（prefix +45.43 / half +28.13 / scattered +6.28 / reversed +6.68 ms，r7f partE）——与父代理复测带（122.51 / 119.41 / 129.58 ms 与 +45.55/+28.29/+4.40/+5.29）一致，未拷贝其数字。**本轮未触碰 restore**；S7-F-1 与 S6-F-5 的区分在 §0 按令重申。全部剩余 >10 ms 成本池均为契约义务本体（validate 的 Ω(P) 内容重读 + 唯一性哈希证明；restore 的 Ω(A) 逐条全检 + 防御拷贝），非契约池逐项 ≤ ~4 ms 且已被历轮排除表锁定。**在当前排除表与逐位契约下，本切片不存在不经表所有者层级契约变更即可达落地线的候选。**

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB 与双归因未动；无阈值/测试/公开签名/数据面变更。仓库变更仅本报告一个文件；无赢家故未提交新 scripts 资产（裁决仿真全文进附录，遵守 R7-F/R8-C 纪律）。

## 0. 范围与约束遵守

- 阅读顺序按令执行：README → EXCLUSIONS 全表 → round-08/PLAN → round-07/PLAN → R1-F..R7-F → 15 个切片源文件全量重读（未依赖历轮记忆）。
- 未重开任何 X* / S1-* ～ S7-* / S8-A-* / S8-B-* / S8-C-* 条目。逐条对照：
  - **本轮未触碰 restore**，S7-F-1 / S6-F-1 落地形态原样在位（对齐前缀快路径 + 下标 0 失配改道 + pending-Set 后缀回退，shadow/canary 两 runner 逐字未动）。按令重申区分：**S7-F-1 不是 S6-F-5**——前者是同下标 O(1) 相等证明、后缀级回退、失配有界常数税；后者是 population 上的双指针前向搜索，失配白付 O(P) 扫描、符号随次序翻转。本轮未重开 S6-F-5，也未提出任何两指针/子序列形态。
  - **S8-F-1 不是 S2-F-4**（那是 assign 复用 restore 已建 population Set——哈希表机制；本候选是同下标一次比较的相等性证明，零哈希表、零跨函数管线）；**不是 S3-F-1**（那是 assignment-hash Set 复用于 unique 扫描——本候选不触 `requireUniqueAssignment`）；**不是 S3-F-2**（不跳过任何 validate；restore 链一字不动）。排除表经 `assign|includes|population` 全检索无同机制先例，属新提案，独立裁决。
  - **S8-F-2 不是「重做 S7-F-2」**（那是 validate 的 population/metrics/reversibleScopes 三站点，4M 探针/实验；本候选是 assign/recordOutcome 的 A 线性站点，2000 探针/实验——同维度不同站点，S8-C-1/S8-C-2 的「引理站点外推」同类程序）；不触探针数（S5-F 锁定域外——这些站点本无 Set 探针）。
  - **S8-F-3 不是 S6-F-3/S6-F-4/S5-F-3**（那三条是 population 站点的批量构造/对象表/索引循环布局；本候选是长度 1 数组的平凡特例免 Set，机制上接近 S3-F-3「空 assignments 免 Set」的姊妹——该条也是规模性淘汰，本候选同命）；不改探针数语义（单元素数组无重复可探）。
  - K 块批量 size 检查**未提案未测量**：S6-F-3 关闭的维度按 PLAN 明令不重开（§3.3 记录覆盖论证）。
  - 未重提 S1-F-1..8 / S2-F-1..6 / S3-F-1..5 / S4-F-1..3 / S5-F-1..3 / S6-F-2..5 / S7-F-3..4；未重做 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。
- 硬不变量（生产零 diff 下天然成立，仍逐条核对）：validateExperimentPlan 每调用照跑（Ω(P) 内容重读）；每条 assignment 逐调用全检（Ω(A)）；`[...assignments]`/`[...outcomes]` 防御拷贝原样；TypeError 消息与属性读取序不变（shadow：liveAction → changedLiveAction → shadowDecision → episodeHash；canary：episodeHash 先行）；双 LCB 与双归因未动；无阈值变更；X1-5（shadow-compare 不并 r1-shadow-report）、X3-3/X4-1（不 fail-open 增量化）维持；不声称 Outcome-supported。
- 漂移复核：`git log -- src/experiments/` tip 即 S7-F 落地提交 `519101f`，`git diff 519101f..HEAD -- src/experiments/` 为空。scripts/ 自 S7-F 后仅增 r7c/r7i 仿真（切片外，已记录）。

## 1. 锚点重测 + 配置态 × 命令类矩阵复核（R7-I 教训，本 VM 实测）

### 1.1 全实验锚点（未拷贝父代理数字）

| 档位 | 本 VM 实测 | 父代理复测带 |
| --- | --- | --- |
| r5f C2 全实验（P=2000/A=1000） | **120.39 ms** | 122.51 ms |
| r6f partD 全实验 | 117.82 ms | 119.41 ms |
| r7f partE 全实验（fixture 略异） | 130.21 ms | 129.58 ms |
| 2A-validate 组件 | 100.06 ms（**83.1%**） | 同带 |

四种 assignment 次序（r7f partE，S7-F-1+2 落地态 vs 编辑前冻结参考，2000 restores）：prefix **+45.43 ms**、half-aligned **+28.13 ms**、scattered **+6.28 ms**、reversed **+6.68 ms**——全次序同号为省，S7-F 落地单元在本 VM 复现无回归。r6f partD（S6-F-1+S7-F 叠加视图）：prefix +122.06 / scattered +29.46 / reversed +28.99 ms。r1f 2668 项逐位检查全过（生产侧 62.8 ms，参考侧 624.6 ms，10.0×）。

### 1.2 配置态 × 命令类矩阵（逐项复核）

- **shadow vs canary restore**：两 runner 落地形态对称在位；canary 仓内仍仅测试可达（rg 复核），其对齐比较领先体首、exposure 跨相位累加均与 R7-F 记载一致。
- **evaluateProposalShadow 调用方次序**：`src/adaptation/reflection.ts` L216–223 仍按调用方 outcomes 次序 assign+recordOutcome，**无对齐契约**——S7-F-1 的失配安全设计前提未变；本轮据此对 S8-F-1 施加同一四次序纪律（§2）。
- **生产消费链**（rg 全仓复核，与 R7-F 逐条一致，**无新 src/ 调用方**）：`reflection.ts`（validateExperimentPlan + createShadowRunner，唯一 runner 生产链）；`eval-routing.ts`（gatedComparisonReport / createIsolationGuard / stableStringify / replayCacheKey）；`promotion-rules.ts`（validateComparisonReport）；`r1-shadow-report.ts`（comparison-report + gated-comparison）。`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout`、sealed-manifest 全链路、`HoldoutVault`、`calibrateSoftThreshold`、`compareShadowR1`、`writeAttributionPair` 仓内仍仅测试可达。S7-C / S7-I-1 / S8-A..C 均不触本切片（确认零交叉）。
- **配置态维度**：canary 块（test-only）、missingOutcomePolicy 三值（同成本路径）、halted 态（canonicalHaltReason 每 restore 至多一次 trim，锚点态 haltReason 缺省——亚噪声）、options.outputRoot 隔离守卫（每 runner 一次，生产唯一路径已被 S3-D-3 否决）——无默认空夹具遮蔽的配置态热路径。

### 1.3 剩余成本池分解（本 VM）

120.4 ms = validate 组件 **100.1 ms**（契约 Ω(P) 内容重读本体：每条目 typeof + charCodeAt 卫 + 单 Set 探针 + size 计数——探针数 S5-F、布局 S5-F-3/S6-F-3/4、字符串操作 S7-F-2 五个维度全部收割或关闭，剩余大块是唯一性证明的哈希工作本体）+ restore 对齐扫描与防御拷贝 **~7 ms**（Ω(A) 逐条全检义务 + 契约拷贝）+ 非契约 A 线性池（本轮逐项实测/复核：assign trim+includes **1.14–1.21 ms**（S8-F-1 天花板，本轮新测）、unique 扫描 ~4 ms（S3-F-1 已证 Set 化负优化）、rng 重放 ~3 ms（S2-F-1）、recordOutcome 双 some + 成本累加（S1-F-8）、时钟/预算 spread O(字段数)）。**无一非契约池达两位数 ms。**

## 2. 候选总表（S8-F-1..3，全部淘汰）

裁决仿真（附录 A 全文）：829 项等价用例（600 + 23 + 206）+ 三部基准 × 两次独立运行 0 失败，确定性结论逐位一致。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准（本 VM） | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-F-1 | assign 路径同下标成员快路径：`index < population.length && population[index] === episodeHash` 一次比较即证成员+非空（population 刚被同调用内 restore 的 validate 重验），命中免 trim 探针与 O(P) includes；失配回退落地 `requirePopulationEpisode` 逐字 | S7-F-1 证明机制在 assign 站点的外推；锚点分布命中率 100%，每 assign 从 O(k) includes 降为 1 次比较 | ✅ 加界卫后 600 例模糊（对齐命中/错位成员/非成员/空白/非字符串/越界下标）throw/消息/类逐字节一致。**披露：朴素无界形式被仿真首轮抓到 fail-open 反例**——`maxAssignments > P` 时 assign 下标可越界，`population[index]` 为 `undefined`，`undefined` episodeHash 恰相等而静默放行（生产抛 `episodeHash is required`）；界卫为落地形式的必要组成 | 组件级（A=1000，mirror-vs-mirror）：prefix 落地 1142–1209 µs vs 快路径 48–51 µs——**整组件天花板 1.14–1.21 ms/实验（全实验 ~1%）**；scattered −3~−7 µs、reversed −1~−4 µs（有界单比较税，符号为负） | 淘汰：收益天花板低于数十 ms 落地线 ~40×（S2-F-4 同站点 Set 机制当年 2.4 ms 同带）；失配次序符号为负，若落地须按 S7-F-1 先例耦合无条件正项覆盖，但本切片已无此量级的无条件项；朴素形式另有 fail-open 反例入档 |
| S8-F-2 | `requireEpisodeHash`（assign）与 `validateExperimentOutcome.episodeHash`（recordOutcome）站点镜像 S7-F-2 可打印 ASCII 首字符卫 | S7-F-2 引理逐字继承（33..126 首码点 ⟹ 非空 ∧ 非全空白；NaN 回落）；站点调用量 2A/实验 | ✅ 23 类对抗条目（全空白码点族/边界 32/33/126/127/NUL/DEL/非 ASCII/代理对/前导尾随空白/非字符串六类）throw/消息/类逐字节一致 | 逐探针差 3.37–3.42 ns × 2A=2000 ≈ **6.75–6.84 µs/实验**（validate 站点是 4M 探针才把同引理放大到 6.5 ms） | 淘汰：深低于线 ~4 个数量级；乘数不足是站点属性，无夹具可改变 |
| S8-F-3 | `assertUniqueNonEmpty` 长度 1 快路径：单元素数组平凡无重复，metrics 站点（`["utility"]`）免 Set 分配 + add + size 比较 | 每 validate 免一次 Set 分配与探针；2A 次/实验 | ✅ 206 例（合法/空串/空白/非字符串单元素 + 200 例多元素委托路径）throw/消息/类逐字节一致 | metrics 站点 ×2000 调用：落地 294–308 µs vs 快路径 107–120 µs——**差 ~187–193 µs/实验** | 淘汰：低于线 ~2 个数量级（S3-F-3「空 assignments 免 Set」姊妹同判：平凡特例、每实验常数次、µs 级）；population 站点无此特例可乘 |

## 3. 关键裁决细节

### 3.1 S8-F-1：反例的价值与天花板测量

- **fail-open 反例（本轮新档案）**：`budget.maxAssignments` 仅有下界校验（≥1），可大于 P；assignment 唯一性把可达 assign 数限到 P，第 P+1 次 assign 的下标恰为 P。朴素形式 `population[index] === episodeHash` 在该角落对 `undefined` 查询给出 `undefined === undefined` 为真——membership 检查被静默绕过，随后 `requireUniqueAssignment` 的 `some` 对 `undefined` 全失配也放行，一条 `episodeHash: undefined` 的 assignment 会被写入状态。生产在 `requireEpisodeHash` 的 typeof 检查处抛 `episodeHash is required`。仿真首轮（无界卫形式）在模糊第 100 例即命中该发散；界卫 `index < population.length` 关闭之。此反例与 S7-F-1 的 restore 侧无关（restore 的对齐循环以 `index < assignments.length` 为界，population 越界读只会导致失配回退，fail-closed）——但它说明**同下标证明机制外推到新站点时界条件必须逐站点重证**，记入排除行防后续轮次以「顺手加个快路径」形式重提无界形式。
- **天花板纪律**：本候选即使以完美形式落地，可回收上界=整个 trim+includes 组件（本 VM 实测 1.14–1.21 ms/实验）。S2-F-4（同站点、Set 复用机制）当年以 2.4 ms/0.8% 淘汰；本轮同站点第二种机制以同一量级第二次淘汰——该站点的预算收口至此双机制确认，除非 A 增长 ≥1 个数量级且 evaluateProposalShadow 的调用次序获得对齐契约，任何第三种机制不必再测。
- **四次序纪律**：scattered/reversed 的 −1~−7 µs 是失配单比较税（机械成本吻合，无 S6-F-5 型 O(P) 白付），量级本身亚噪声；但按「restore/assign 快路径失配税须由耦合单元覆盖」的 S7-F-1 先例，落地需要一个无条件正项配对——本切片在 S7-F-2 之后已无此量级的无条件剩余项，耦合不可构造。量级与耦合两条死因独立成立。

### 3.2 S8-F-2 / S8-F-3：乘数不足的站点属性

两候选的引理/机制都直接继承已落地赢家（S7-F-2 / S5-F 家族），等价性无悬念——死因均为**站点乘数**：validate 站点每实验 4M 探针（2A 调用 × P 条目），A 线性站点每实验只有 2A=2000 次、metrics 站点 2A 次单元素调用。同引理在 4M 乘数下是 6.5 ms 赢家、在 2000 乘数下是 6.8 µs 噪声。这与 R8-C 的 S8-C-1（同引理外推、量级不达线）完全同构，是「引理可外推、收益不可外推」的第二例——后续轮次对「已落地赢家的站点外推」类候选应先算乘数再写仿真。

### 3.3 K 块批量 size 检查：closed-dimension 覆盖论证（不立新 ID）

唯一在纸面上还可能触及两位数 ms 的想法是削减 validate 每条目的 `seen.size` 读取（4M 次/实验）：每 K 条目查一次 size，失配后重放命名重复项。该形式是 S6-F-3「批量 Set 快路径 + 精确回退」的粒度插值（K=P 即 S6-F-3 本体，K=1 即落地形态）：(a) S6-F-3 的全批量形式把 size 读取降到每数组一次——该机制节省的**极大化形态**——实测 +2.10/−0.34 ms 符号翻转，即 size 读取消除的经验上界 ~2 ms、符号不稳；(b) K 块形式的节省潜力严格小于全批量（每 K 条目仍付一次 size 读 + 计数维护）；(c) 首故障保真还需 S6-F-1 型捕获-解析机器（块内空项故障不得先于块前重复项抛出），复杂度高于 S6-F-3。三条叠加：被已关闭维度支配，按 PLAN「不重开 validate 布局维度」不提案不测量。V8 侧佐证：`Set.prototype.size` 为 TurboFan 内联的表头字段载入（~1 ns 级），4M 次的真实上界即落在 S6-F-3 实测的 ±2 ms 噪声带内，与 (a) 互证。

## 4. 逐文件收口（R1–R7 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | S7-F-1 落地形态零漂移复核；**S8-F-1 在 assign 站点淘汰**（§3.1，含 fail-open 反例入档）；**S8-F-2 在 requireEpisodeHash/validateExperimentOutcome 站点淘汰**（§3.2）；unique 扫描/rng/双 some 维持 S3-F-1/S2-F-1/S1-F-8；时钟与预算 spread 维持 R2-F「O(字段数)」记载 | 无候选落地 |
| `canary.ts` | 对称复核（S8-F-1/2 裁决同覆盖 canary assign 的 scope trim 站点——test-only 加倍否决）；exposure 跨相位累加原样 | 无候选 |
| `plan.ts` | **S8-F-3 淘汰**（metrics 站点单元素快路径，~190 µs）；K 块 size 检查以 S6-F-3 关闭维度覆盖不提案（§3.3）；探针数/布局/字符串操作维度维持关闭；`(head-33)>>>0 < 94` 型单比较卫为 S5-F-3 带形式抖动（上界 ~4M×<1 ns ≈ 低个位 ms，带内），不提案 | 无候选落地 |
| `dataset.ts` | S5-F-1/S4-F-1 维持（sealed 链 test-only）；单元素快路径无镜像收益（splits 非单元素主导且 test-only） | 无候选 |
| `simulation-holdout.ts` | S2-F-5/S3-F-5/S5-F-1 维持；requireHash 站点属 S8-F-2 同判（test-only 加倍否决） | 无候选 |
| `comparison-report.ts` | X3-2/S4-F-3/S1-F-5 维持；真实 N 亚 ms 预算收口维持（R4-F 量化） | 无候选 |
| `gated-comparison.ts` | S1-F-1/S2-F-6 维持 | 无候选 |
| `attribution-report.ts` | 无循环无新调用方 | 无候选 |
| `replay.ts` | 仍无生产调用方；S2-F-1/2/3、S4-F-2 维持 | 无候选 |
| `isolation.ts` | S3-F-4 维持；唯一生产路径整体维持 S3-D-3 否决 | 无候选 |
| `manifest.ts` | stableStringify 字节契约维持 R2-F 不提案；批量 size 惯用法本就无逐条目 size 读 | 无候选 |
| `holdout.ts` | S1-F-3/X4-2 维持 | 无候选 |
| `threshold-calibration.ts` | S1-F-4 维持 | 无候选 |
| `evaluation-card.ts` | S1-B-7 域维持 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |

## 5. 测试

- `npx tsx tmp-r8f-adjudication.ts`（附录 A）✓ — 6 项检查（829 等价用例）× 两次独立运行 0 失败；剔除计时行后确定性结论逐位一致
- `npx tsx scripts/round05-r5f-equivalence-sim.ts` ✓ — 224 项 0 失败（C2 端到端 120.39 ms 即 §1.1 锚点）
- `npx tsx scripts/round06-r6f-equivalence-sim.ts` ✓ — 27 项 0 失败（partD 三次序全正）
- `npx tsx scripts/round07-r7f-equivalence-sim.ts` ✓ — 169 项 0 失败（partE 四次序全正 + validate +6.52 ms）
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（生产侧 62.8 ms / 参考侧 624.6 ms，10.0×；信息行结构描述指 S1-F 时代，R6-F 已披露）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行
- 未触碰任何版本化阈值、权限、数据面契约、公开签名；未改任何测试断言；未编辑 EXCLUSIONS.md / PROGRESS.md
- 按纪律，三个 loser 的裁决脚本未入库（全文见附录 A）；`scripts/` 零新增

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-F-1 | assign 路径同下标成员快路径（`population[assignments.length] === episodeHash` 证成员+非空，失配回退 includes） | 收益天花板=整 trim+includes 组件仅 1.14–1.21 ms/实验（全实验 ~1%，低于落地线 ~40×；S2-F-4 同站点 Set 机制第二证人）；scattered/reversed 付 −1~−7 µs 单比较税且切片内已无可耦合的无条件正项；**朴素无界形式 fail-open**（maxAssignments > P 时越界 `population[index]`=undefined 与 undefined episodeHash 相等放行，生产抛 `episodeHash is required`——界卫必须；反例已档）。重开条件：A 增长 ≥1 个数量级且 evaluateProposalShadow 调用次序获得对齐契约 |
| S8-F-2 | S7-F-2 首字符卫镜像到 A 线性 trim 站点（requireEpisodeHash / validateExperimentOutcome） | 引理逐字继承等价（23 类对抗条目），但站点乘数仅 2A=2000 次/实验：3.4 ns/探针 → ~6.8 µs/实验，深低于线 ~4 个数量级（R8-C S8-C-1「引理可外推、收益不可外推」第二例） |
| S8-F-3 | `assertUniqueNonEmpty` 长度 1 快路径（metrics 站点免 Set） | 等价平凡（206 例），但 ~187–193 µs/实验，低于线 ~2 个数量级；S3-F-3 平凡特例同族。重开条件：validate 进入每条目乘数 ≥10³ 的单元素高频路径 |

MORE_OPTIMA=no
BRANCH=cursor/r8-f-experiments-eighth-pass-83a1

## 附录 A：裁决仿真脚本（完整，可复现；无赢家按纪律不入库）

保存为 `tmp-r8f-adjudication.ts` 后 `npx tsx tmp-r8f-adjudication.ts` 运行。

```ts
/**
 * Round-8 R8-F adjudication simulation (temporary — embedded in the R8-F
 * report appendix, not committed as a standing script unless a winner lands).
 *
 * Adjudicates three fresh eighth-pass candidates over src/experiments/ on top
 * of the landed S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 baseline and the full
 * exclusion table:
 *
 *   S8-F-1  assign-path same-index membership fast path: when the episode
 *           being assigned equals plan.population[assignments.length], that
 *           single compare proves membership AND non-emptiness (the
 *           population was validated by validateExperimentPlan inside the
 *           restore this same call just paid for), so requireEpisodeHash's
 *           trim probe and the O(P) includes scan are skipped; any miss
 *           falls back to the landed requirePopulationEpisode verbatim.
 *           This is the S7-F-1 proof mechanism at the ASSIGN site — NOT
 *           S2-F-4 (restore-built Set reuse) and NOT a restore change.
 *   S8-F-2  printable-ASCII head guard (S7-F-2's string-operation dimension)
 *           mirrored to the A-linear trim sites: requireEpisodeHash (assign)
 *           and validateExperimentOutcome.episodeHash (recordOutcome).
 *   S8-F-3  assertUniqueNonEmpty singleton fast path: length-1 arrays are
 *           trivially duplicate-free, so the metrics site (["utility"]) can
 *           skip the Set allocation + add + size compare on every one of the
 *           2A validate calls per experiment.
 *
 * Every equivalence check demands identical accept/reject verdicts, thrown
 * error messages, and error classes. All fixtures are generated with a seeded
 * mulberry32 so two independent runs produce bitwise-identical check verdicts
 * (timing lines are informational). Run with:
 *   npx tsx tmp-r8f-adjudication.ts
 */

import { DomainValidationError } from "./src/domain/errors.js";
import { createCandidateId, createResourceVersionId } from "./src/domain/ids.js";
import { requirePopulationEpisode } from "./src/experiments/shadow.js";
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
    experimentId: "exp_r8f_bench",
    mode: "shadow",
    baselineVersionId: createResourceVersionId(() => "r8fbase"),
    candidateId: createCandidateId(() => "r8fcand"),
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
/* Part A — S8-F-1 assign-path same-index membership fast path         */
/* ------------------------------------------------------------------ */

/** Frozen mirror of the landed assign-path membership check (shadow.ts). */
function refAssignMembership(plan: ExperimentPlan, episodeHash: string): void {
  if (typeof episodeHash !== "string" || episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
  if (!plan.population.includes(episodeHash)) {
    throw new DomainValidationError(`episode ${episodeHash} is not in the frozen population`);
  }
}

/**
 * Candidate: one aligned compare proves membership + non-emptiness.
 *
 * The bounds guard is load-bearing: without it, an out-of-range index (the
 * maxAssignments > P corner) makes `population[index]` undefined, and an
 * `undefined` episodeHash then satisfies `undefined === undefined` — a
 * fail-open acceptance where production throws "episodeHash is required".
 * The first sim run caught exactly that divergence (naive form, fuzz case
 * 100); the guarded form below is the one adjudicated.
 */
function fastAssignMembership(plan: ExperimentPlan, episodeHash: string, index: number): void {
  if (index < plan.population.length && plan.population[index] === episodeHash) {
    return;
  }
  refAssignMembership(plan, episodeHash);
}

function partA(): void {
  // Equivalence fuzz: candidate (with the production import as fallback)
  // versus the production requirePopulationEpisode, over aligned hits,
  // misaligned members, non-members, empty/whitespace, and non-strings.
  const plan = makeShadowPlan(60, 30);
  validateExperimentPlan(plan);
  const rng = fixtureRng(0x8f01);
  const adversarial: unknown[] = [
    "", "  ", "\u00a0", "ep_zzz_not_member", null, undefined, 7, {}, [],
  ];
  let fuzz = 0;
  for (let c = 0; c < 600; c++) {
    const index = Math.floor(rng() * 70); // includes out-of-range indices
    let query: unknown;
    const dice = rng();
    if (dice < 0.4) {
      query = plan.population[Math.floor(rng() * 60)]; // member (maybe aligned)
    } else if (dice < 0.6) {
      query = plan.population[index] ?? plan.population[0]; // aligned when in range
    } else {
      query = adversarial[Math.floor(rng() * adversarial.length)];
    }
    const a = runCatch(() => requirePopulationEpisode(plan, query as string));
    const b = runCatch(() =>
      fastAssignMembership(plan, query as string, index)
    );
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`A fuzz case ${c}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    fuzz += 1;
  }
  check("A fast-path assign membership equivalence", true);
  out(`part A: ${fuzz} fuzz cases — throw/no-throw, message, and class identical`);

  // Component bench at the production call shape (A member queries, one per
  // assign step, mirror-vs-mirror to keep JIT identity fair). The landed
  // includes column in prefix order is the ceiling of what S8-F-1 can save.
  const A = 1000;
  const bench = makeShadowPlan(2 * A, A);
  validateExperimentPlan(bench);
  const orders: Record<string, number[]> = {
    prefix: Array.from({ length: A }, (_, k) => k),
    scattered: (() => {
      const idx = Array.from({ length: A }, (_, k) => k);
      const r = fixtureRng(0x8f02);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const tmp = idx[i]!;
        idx[i] = idx[j]!;
        idx[j] = tmp;
      }
      return idx;
    })(),
    reversed: Array.from({ length: A }, (_, k) => A - 1 - k),
  };
  for (const [name, order] of Object.entries(orders)) {
    const queries = order.map((i) => bench.population[i]!);
    const tRef = timeMs(() => {
      for (let k = 0; k < A; k++) {
        refAssignMembership(bench, queries[k]!);
      }
    });
    const tFast = timeMs(() => {
      for (let k = 0; k < A; k++) {
        fastAssignMembership(bench, queries[k]!, k);
      }
    });
    out(
      `part A: order=${name} A=${A} landed trim+includes=${(tRef * 1000).toFixed(0)}µs ` +
        `fast-path=${(tFast * 1000).toFixed(0)}µs (delta ${((tRef - tFast) * 1000).toFixed(0)}µs per experiment)`
    );
  }
  check("A bench completed", true);
}

/* ------------------------------------------------------------------ */
/* Part B — S8-F-2 head-guard mirroring at the A-linear trim sites     */
/* ------------------------------------------------------------------ */

/** Landed requireEpisodeHash form (shadow.ts, frozen mirror). */
function refRequireEpisodeHash(episodeHash: string): void {
  if (typeof episodeHash !== "string" || episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
}

/** Candidate: S7-F-2's printable-ASCII head guard at this site. */
function guardedRequireEpisodeHash(episodeHash: string): void {
  if (typeof episodeHash !== "string") {
    throw new DomainValidationError("episodeHash is required");
  }
  const head = episodeHash.charCodeAt(0);
  if (!(head > 32 && head < 127) && episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
}

function partB(): void {
  // Equivalence over the adversarial entry families S7-F-2 locked.
  const entries: unknown[] = [
    "ep_0001", "x", "!", "~", "", " ", "\t", "\n", "\u00a0", "\u2028",
    "\u3000", "\ufeff", "\u0000", "\u007f", "é_hash", "𝕏_hash", " lead", "trail ",
    null, undefined, 42, {}, [],
  ];
  let cases = 0;
  for (const entry of entries) {
    const a = runCatch(() => refRequireEpisodeHash(entry as string));
    const b = runCatch(() => guardedRequireEpisodeHash(entry as string));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`B entry ${JSON.stringify(entry)}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    cases += 1;
  }
  check("B head-guard site equivalence", true);

  // Per-op delta on hash-shaped strings, scaled to the per-experiment call
  // volume of the A-linear sites (assign requireEpisodeHash + recordOutcome
  // validateExperimentOutcome = 2A trims per experiment; the 4M-per-experiment
  // validate site is S7-F-2, already landed).
  const A = 1000;
  const hashes: string[] = [];
  for (let i = 0; i < 4000; i++) {
    hashes.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  const N = 4_000_000;
  const tTrim = timeMs(() => {
    for (let i = 0; i < N; i++) {
      refRequireEpisodeHash(hashes[i & 4095] ?? "ep_x");
    }
  }, 5);
  const tGuard = timeMs(() => {
    for (let i = 0; i < N; i++) {
      guardedRequireEpisodeHash(hashes[i & 4095] ?? "ep_x");
    }
  }, 5);
  const perOpNs = ((tTrim - tGuard) * 1e6) / N;
  const perExperimentUs = (perOpNs * 2 * A) / 1000;
  check("B bench completed", Number.isFinite(perOpNs));
  out(
    `part B: ${cases} adversarial entries identical; per-probe delta=${perOpNs.toFixed(2)}ns ` +
      `→ 2A=${2 * A} A-linear trims ≈ ${perExperimentUs.toFixed(2)}µs per experiment`
  );
}

/* ------------------------------------------------------------------ */
/* Part C — S8-F-3 assertUniqueNonEmpty singleton fast path            */
/* ------------------------------------------------------------------ */

/** Landed assertUniqueNonEmpty (plan.ts, frozen mirror incl. S7-F-2). */
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

/** Candidate: singleton arrays skip the Set entirely. */
function singletonAssertUnique(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  if (values.length === 1) {
    const value = values[0] as string;
    if (typeof value !== "string") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    const head = value.charCodeAt(0);
    if (!(head > 32 && head < 127) && value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    return;
  }
  refAssertUnique(values, label);
}

function partC(): void {
  // Equivalence: singletons (valid, empty, whitespace, non-string) plus
  // multi-entry arrays (delegated verbatim — spot-check anyway).
  const rng = fixtureRng(0x8f03);
  const singletons: unknown[][] = [
    ["utility"], [""], ["  "], ["\u00a0"], [42 as unknown as string], [null as unknown as string],
  ];
  let cases = 0;
  for (const values of singletons) {
    const a = runCatch(() => refAssertUnique(values as string[], "metrics"));
    const b = runCatch(() => singletonAssertUnique(values as string[], "metrics"));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`C singleton ${JSON.stringify(values)}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    cases += 1;
  }
  for (let c = 0; c < 200; c++) {
    const n = 2 + Math.floor(rng() * 6);
    const values: string[] = [];
    for (let i = 0; i < n; i++) {
      const die = rng();
      values.push(die < 0.1 ? "" : die < 0.2 ? (values[0] ?? "m0") : `m${Math.floor(rng() * 8)}`);
    }
    const a = runCatch(() => refAssertUnique(values, "metrics"));
    const b = runCatch(() => singletonAssertUnique(values, "metrics"));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`C multi case ${c}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    cases += 1;
  }
  check("C singleton fast-path equivalence", true);

  // Metrics-site bench: 2A calls per experiment on ["utility"].
  const A = 1000;
  const metrics = ["utility"];
  const tRef = timeMs(() => {
    for (let i = 0; i < 2 * A; i++) {
      refAssertUnique(metrics, "metrics");
    }
  });
  const tVar = timeMs(() => {
    for (let i = 0; i < 2 * A; i++) {
      singletonAssertUnique(metrics, "metrics");
    }
  });
  check("C bench completed", true);
  out(
    `part C: ${cases} cases identical; metrics site ×${2 * A} calls landed=${(tRef * 1000).toFixed(0)}µs ` +
      `singleton fast path=${(tVar * 1000).toFixed(0)}µs (delta ${((tRef - tVar) * 1000).toFixed(0)}µs per experiment)`
  );
}

partA();
partB();
partC();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

两次独立运行原始输出（界卫形式；朴素无界形式的首轮输出为 `FAIL: A fuzz case 100 — episodeHash is required vs `，即 §3.1 反例）：

```
part A: 600 fuzz cases — throw/no-throw, message, and class identical
part A: order=prefix A=1000 landed trim+includes=1209µs fast-path=51µs (delta 1158µs per experiment)
part A: order=scattered A=1000 landed trim+includes=1143µs fast-path=1147µs (delta -3µs per experiment)
part A: order=reversed A=1000 landed trim+includes=1145µs fast-path=1147µs (delta -1µs per experiment)
part B: 23 adversarial entries identical; per-probe delta=3.40ns → 2A=2000 A-linear trims ≈ 6.79µs per experiment
part C: 206 cases identical; metrics site ×2000 calls landed=308µs singleton fast path=120µs (delta 188µs per experiment)

total: 6 checks, 0 failures
---（第 2 次独立运行）---
part A: 600 fuzz cases — throw/no-throw, message, and class identical
part A: order=prefix A=1000 landed trim+includes=1142µs fast-path=48µs (delta 1094µs per experiment)
part A: order=scattered A=1000 landed trim+includes=1142µs fast-path=1149µs (delta -7µs per experiment)
part A: order=reversed A=1000 landed trim+includes=1140µs fast-path=1145µs (delta -4µs per experiment)
part B: 23 adversarial entries identical; per-probe delta=3.42ns → 2A=2000 A-linear trims ≈ 6.84µs per experiment
part C: 206 cases identical; metrics site ×2000 calls landed=294µs singleton fast path=107µs (delta 187µs per experiment)

total: 6 checks, 0 failures
```

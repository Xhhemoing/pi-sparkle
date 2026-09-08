MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-F：`src/experiments/` 第六遍复查报告（Round 1–5 同区之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `94b3bea`（含 R1–R5 全部五十区、S5-I-1、R6-A/B/D 排除）
- 切片：`src/experiments/` 全部 15 文件（编辑前 2332 行），全量实际读码
- 前置阅读：README、EXCLUSIONS 全表（含 S6-A-*、S6-B-*、S6-D-*）、round-06/PLAN、round-01/R1-F ～ round-05/R5-F
- 分支：`cursor/r6-f-experiments-sixth-pass-83a1`

## 结论

**落地 1 项常数级优化（S6-F-1）：shadow/canary restore 的成员判断方向反转。** S1-F 落地形态在每次 fail-closed restore 上重建整个 population 的 Set（P 次插入）再对 A 条 assignment 各探一次；本次反转方向——把（去重后的）assignment 哈希建成 pending Set（A 次插入），扫描刚被 `validateExperimentPlan` 全量重验过内容的 population，全部命中即提前结束，失败路径按原样重放逐条探针以复原逐字节相同的 first-fault。成功路径探针经济从「P 插入 + A 探查」降到「A 插入 + 首次全命中前缀探查」；契约强制的每调用 Ω(P+A) 内容重读完全不动（validateExperimentPlan 未跳过、每条 assignment 仍逐调用全检、防御拷贝保留）。端到端 P=2000/A=1000 锚点全实验 **266.5ms → 173.4–175.9ms（省 ~91–93ms，−34~−35%）**，restore 组件在锚点次序省 84–87ms、在对抗性乱序/倒序下仍省 30–36ms——全次序同号，无 S4-F-1 型双向抖动。等价性由入库仿真 `scripts/round06-r6f-equivalence-sim.ts`（seeded mulberry32，27 项检查 × 两次独立运行 0 失败，含 1400 例随机 restore 模糊 + 21 例定向 first-fault 次序矩阵）与既有 r1f（2668 项）/r5f（224 项）仿真回归共同证明。另裁决 4 个新角度候选并全部淘汰，新增排除 S6-F-2…S6-F-5。`canCloseProductionCheckpointF` 语义未触碰（simulation ≠ production）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-A-* / S6-B-* / S6-D-* 条目。逐条对照：
  - S6-F-1 **不是 X3-3/X4-1**（那是跨调用增量化/隐藏状态；本次无任何跨调用状态，每次调用从零重建 pending 并重扫 population）；**不是 S3-F-2**（那是以引用同一性跳过 validateExperimentPlan；本次 validateExperimentPlan 一字不动、每调用照付 Ω(P) 内容重读）；**不是 S1-F-6/S2-F-4**（无签名变更、无跨函数 Set 复用——成功路径反而不再存在可复用的 population Set）；**不是 S3-F-1**（那是把 assign 路径 unique 扫描换 restore 顺手重建的 Set，实测负优化；本次改的是 restore 自身的 population 成员判断方向，探针总量下降而非平移）；**不是 S3-F-3**（那是仅空 assignments 特例跳过、每实验一次 µs 级；本次是一般化重构，空 assignments 情形只是自然副产物）。它是对已落地 S1-F 机制的替换升级，与 S5-C 之于 S4-C 同类（对落地项的后继改进，非重做）。
  - S6-F-3/S6-F-4 是 PLAN 点名的「validate 本体分配/布局角度、非探针数重放」：不降每条目探针数（仍 ≥1）、不触 S5-F-2 的行为死因（快路径带精确回退）——排除表无此条，独立裁决后淘汰。
  - 未重提 `assertUniqueNonEmpty` 探针数削减（已 1 探针/条目，S5-F 锁定）。
- 硬不变量全部维持：validateExperimentPlan 每调用照跑（Ω(P) 内容重读）；每条 assignment 逐调用全检（Ω(A)）；`[...assignments]`/`[...outcomes]` 防御拷贝原样；分析不改在飞 run；双 LCB 与双归因未动；无阈值变更；未改任何测试断言；不声称 Outcome-supported。
- `git diff --stat c0b7881..94b3bea -- src/experiments/` 核对：本切片自 S5-F 落地以来**零漂移**；`git diff 6d021c7..94b3bea` 仅含已记录的 S5-F `plan.ts`（+9/−2）。
- 本轮继承 lint 全绿（gate 首跑即过），无需 R5-F 式 console 机械修复。
- 披露：r1f 仿真的信息行「current: 1,000 Set builds of at most 2,000 inserts + O(1) lookups」是脚本内硬编码的 S1-F 时代结构描述（非断言）；S6-F-1 落地后该描述指旧结构，2668 项检查全部照过，新结构由本轮入库仿真文档化。未改该脚本字节。

## 1. 规模与可达性基底（本轮重新核实）+ 锚点地板复核

- 生产消费链 rg 全仓复核，与 R5-F 记载逐条一致：`src/adaptation/reflection.ts` 的 `evaluateProposalShadow`（`createShadowRunner`+`validateExperimentPlan`，唯一 runner 生产链，assign+recordOutcome 全循环）；`eval-routing.ts` 消费 `gatedComparisonReport`/`createIsolationGuard`/`stableStringify`/`replayCacheKey`；`promotion-rules.ts` 消费 `validateComparisonReport`；`r1-shadow-report.ts` 消费 comparison-report/gated-comparison。`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout`、sealed-manifest 全链路、`HoldoutVault`、`calibrateSoftThreshold`、`compareShadowR1`、`writeAttributionPair` 仓内仍仅测试可达——PLAN 点名的 comparison/gated/attribution 与 replay/isolation 两条线**无新生产调用方**，预算收口维持（真实 N≈40–10³ 时 computeComparisonReport 全函数亚 ms，R4-F 已量化；一切残余候选深低于否决线，本轮不硬凑）。
- **S5-F 之上锚点地板复核**（编辑前，本 VM，Node 22.22.2，r5f 仿真 part C2 生产路径）：P=2000/A=1000 全实验 **266.51ms**，与子代理测得 255–265ms、父代理复测 259.73ms 同带（本 VM 略高属机差）；2A-validate 组件 116.28ms（43.6%）。
- Ω(P+A) 下界第六次复核（并精化表述）：fail-closed 契约强制每次调用（a）重验 plan **内容**（Ω(P)，S3-F-2 构造性反证维持）与（b）重验全部 assignment（Ω(A)）。**(a) 的全量 P 读取义务由 validateExperimentPlan 承担且保留**；restore 内的成员判断义务是「证明 A 条 assignment 全部落在 population 内」——该义务本身不要求第二次全量 P 遍历，只要求足以裁定 A 个成员资格的读取。S1-F 形态在 (a) 之外多付了一遍无契约要求的全量 P 插入；S6-F-1 移除的正是这份**重复**成本，下界本体分毫未动。

## 2. 落地项 S6-F-1：restore 成员判断方向反转（早退计数形态）

文件：`src/experiments/shadow.ts`（`restoreShadowState`）、`src/experiments/canary.ts`（`restoreCanaryState`）。

### 2.1 理论

- 旧（S1-F）：每 restore `new Set(plan.population)`（P 插入，含增长 rehash）+ 每 assignment 一次 `Set.has`。全实验 2A 次 restore ⇒ 2A×P ≈ 4M 插入，是与 validate 探针同量级的第二大成本中心——前五遍始终把它记作 S1-F 落地形态的本体，未再分解。
- 新：pass 1 按生产次序跑全部结构检查并把（去重后）assignment 哈希收进 pending（≤A 插入）；pass 2 顺扫 population，`pending.has` 命中即计数，`found === pending.size` 即刻 break。population 唯一性由 validateExperimentPlan 保证，故命中计数与逐条成员判定严格等价。成功路径探针：A 插入 + maxpos 探查（maxpos = 覆盖全部 assignment 哈希所需的 population 前缀长）。生产锚点（assignment 顺序跟随 population 前缀）maxpos≈k，每 restore 从 P+k 次哈希操作降到 ~2k；即便对抗性 maxpos=P，也是「A 插入 + P 探查」对「P 插入 + A 探查」——插入（含表增长）贵于探查，A<P 时仍不劣。三种次序实测全部同号为省（§2.4）。
- first-fault 重构：结构故障**捕获不抛**（一个更早 index 的成员故障必须赢得 first-fault 竞速）；成员故障解析在 pass 2 后：若有缺失，重建 population Set 并按原样逐条 `requirePopulationMember` 重放——首个违规 index 与消息逐字节复原。收集点编码了 3b（成员探针）在各 runner 逐 assignment 检查序中的位置：shadow 序 [liveAction, shadowDecision, 3a, 3b]，哈希在 3a 通过后收集；canary 序 [3a, 3b, action, exposureInt]，哈希在 3a 后、action 检查前收集——同 index 上 shadow 结构故障压过成员故障、canary 成员故障压过 action 故障，均与生产一致。canary 的 exposure-match 与两 runner 的 canonicalHaltReason 检查保持在循环故障之后。

### 2.2 保行为论证（逐位）

- **判定集合**：成员语义仍是已验唯一非空字符串上的 SameValueZero ≡ `===`；计数早退只结束「匹配扫描」，不结束任何契约检查——退出条件是全部 pending 已证明在场。失败侧 pass 2 必然扫完整个 population（break 只在 found==target 时发生），缺失判定无假阳/假阴。
- **first-fault 次序**：随机模糊（700 shadow + 700 canary，含混合结构×成员故障、同 index 组合、重复哈希、非字符串注入、JSON 往返）+ 21 例定向次序矩阵（membership@0 vs structural@1 双向、shadow/canary 同 index 优先级、成员故障 vs 缺 haltReason、canary 成员/结构 vs exposure-mismatch、早退边界=population 末位命中、全 population 覆盖、空 assignments）全部 throw/消息/错误类逐字节一致。
- **成功状态**：返回对象构造一字未动（防御拷贝、字段序、canonicalHaltReason 调用位置不变），`stableStringify` 逐字节相等。
- **不可观察差异**：结构故障对象可能被构造后因更早成员故障而弃置（Error 构造无全局副作用）；population 数组元素读取次数/模式改变（S1-F 落地时已建立「纯数据读取模式非契约面」先例——它当年把 A×P 次读降到 P 次）。
- **公开面**：`ShadowState`/`CanaryState` 形状、五个 runner 方法、`requirePopulationEpisode`/`requirePopulationMember`/`requireUniqueAssignment` 签名与行为全部不变（`requirePopulationMember` 仍被失败路径与既有导出契约使用）；assign 路径的 `requirePopulationEpisode` includes 扫描未动（S2-F-4 维持排除，且其前提——成功路径存在 restore 已建 population Set——落地后已不复存在，排除加倍成立）。

### 2.3 仿真证据（`scripts/round06-r6f-equivalence-sim.ts`，已入库）

对照组为逐字冻结的编辑前（S1-F 形态）`restoreShadowState`/`restoreCanaryState`；被测侧双 runner 全部从生产导入，被测差异恰为本次编辑。`npx tsx scripts/round06-r6f-equivalence-sim.ts`：

- Part A/B：700+700 例随机 shadow/canary restore（~75% 篡改率，覆盖 §2.2 全部故障族，半数经 JSON 往返）——verdict/消息/错误类/成功状态逐字节一致。
- Part C：13 shadow + 8 canary 定向 first-fault 次序用例逐字节一致。
- Part D：锚点三次序 restore 调用型性能 + 生产全实验计时（§2.4）。
- 总计 **27 项检查 × 两次独立运行 0 失败**，剔除计时行后确定性结论逐位一致。

### 2.4 性能证据（三种测法、两次独立运行、全次序同号）

原型 copy-vs-copy（规避 JIT 身份差；2000 次 restore 调用型，P=2000/A=1000，两轮）：

| 次序 | 参考（S1-F 形态） | S6-F-1 | 节省 |
| --- | --- | --- | --- |
| prefix（锚点） | 244.65 / 241.79ms | 157.61 / 156.43ms | **+87.05 / +85.36ms** |
| scattered | 245.36 / 241.01ms | 211.31 / 211.27ms | +34.06 / +29.74ms |
| reversed（最坏） | 239.21 / 235.82ms | 209.31 / 206.22ms | +29.91 / +29.60ms |

入库仿真参考-对-生产（两轮）：prefix +83.99/+87.47ms；scattered +34.35/+35.76ms；reversed +30.91/+30.94ms。

端到端（生产导入，同 VM 同会话跨进程 A/B）：

| 档位 | 编辑前 | 编辑后 |
| --- | --- | --- |
| P=2000/A=1000 全实验 | 266.51ms（r5f C2） | **173.44ms（r5f C2）/ 174.93 / 175.91ms（本轮仿真两轮）** |
| 2A-validate 组件占比 | 43.6% | 66.7%（分母变小，组件绝对值 115.69ms 不变） |

交叉验证：r1f 仿真生产侧（每 assign 一次 restore 的 fixture）由 146.1ms 降至 **96.0ms**（参考侧 640–651ms，4.4×→6.8×，2668 项逐位检查全过）——与本落地在 restore 路径上的预期传导一致。

## 3. 候选三条件裁决

| 候选 | (a) 不在排除表 | (b) 理论 + 仿真证明 | (c) 真实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| restore 成员判断反转（has+计数早退形态） | ✓（§0 逐条对照） | ✓ 判定恒等 + first-fault 重构逐字节（1400 模糊 + 21 定向 + r1f/r5f 回归） | ✓ 端到端每实验省 91–93ms；对抗性次序仍 +30ms，全次序同号 | **落地 S6-F-1** |
| 同反转的 delete+size 早退形态 | ✓ | ✓（同一论证） | ✗ 三次序全部被 has+计数形态支配（prefix 74.3/71.8 vs 87.1/85.4；scattered 27.2/23.6 vs 34.1/29.7；reversed 21.0/21.3 vs 29.9/29.6）——delete 的删除/缩容开销贵于纯探查 | S6-F-2（同类方案唯一赢家纪律） |
| plan.ts `assertUniqueNonEmpty` 批量 Set 快路径 + 精确回退（无重复时 `new Set(values)`+免探针 typeof/trim 遍；有重复时逐字回退原循环，绕开 S5-F-2 两条死因） | ✓（新布局角度，非探针数重放） | ✓ 400 模糊 + 3 次序反例逐字节一致（回退保命名与 first-fault） | ✗ P=2000×2000 调用两轮 **+2.10 / −0.34ms**（组件 114–118ms 的 <2%），符号翻转纯抖动，S5-F-3 同带 | S6-F-3 |
| `assertUniqueNonEmpty` 换 null-prototype 对象表 | ✓ | ✓ 同上模糊含 `__proto__` 键用例 | ✗ 实测 **−51.04 / −44.40ms**（慢 38–45%）：V8 字符串键属性表插入贵于 Set | S6-F-4 |
| S6-F-1 之上再叠双指针子序列快路径（assignment 序为 population 子序列时零哈希操作证明成员资格，失配回退 pending-Set） | ✓ | ✓ 成功路径判定一致（9 检查） | ✗ **符号随输入次序翻转**：prefix +31.01/+27.65ms，scattered −20.17/−18.96ms，reversed −17.80/−18.81ms（失配时每 restore 白付一遍 O(P) 指针扫描）；调用方 assignment 次序无契约保证 | S6-F-5（S4-F-1/S4-C-1 双向抖动同判） |

## 4. 关键裁决细节

### 4.1 为什么第六遍还有数十 ms 级赢家——与前五遍记载的关系

R1-F 建立 Ω(P+A) 下界时把 restore 记为「validate Ω(P) + 建 Set O(P) + 查询 O(A)」并declare达界；R2–R5 四遍复核均在**复杂度类**层面成立（S3-F-2 反证、各 A 线性项 ≤1%）。但「建 Set O(P)」这一项从未被单独审计：它与 validate 的 Ω(P) 是**两遍独立的全量 P 成本**，而契约只强制其中一遍（内容重验在 validate）。成员判断义务的信息论需求是裁定 A 个成员资格——反转方向后这只需 A 插入加「足以覆盖全部命中的前缀」探查。这与 S5-F 的发现同构：契约锁定「读什么、验什么」，不锁定「用几次哈希操作达成」。复杂度类照旧 O(P+A)（validate 支配），S1-F 的 4.8×、S5-F 的 ~1.1× 与本次的 ~1.5× 正交叠加；锚点全实验自战役起点 727ms（R1-F 参考侧）累计降至 ~174ms。

### 4.2 S6-F-1 的 first-fault 重构为什么必须捕获结构故障

天真形态（pass 1 直接抛结构故障）有构造性反例：assignment[0] 成员违规 + assignment[1] shadowDecision 违规——生产抛 membership@0，天真形态抛 shadowDecision@1。捕获+解析次序（成员解析 → 结构重抛）恰好复原生产的 (index, 检查位) 字典序。canary 的收集点必须在 3a 后、action 检查前（同 index 成员故障压过 action 故障）；shadow 的收集点必须在全部结构检查后（同 index 结构故障压过成员故障）。两个收集点差异均入定向矩阵验证。失败路径重放 `requirePopulationMember` 而非手写消息，保证任何未来消息文本变更自动跟随。

### 4.3 S6-F-2/3/4/5：四个淘汰的独立死因

- **S6-F-2**：`pending.delete(hash)` 命中时做删除标记 + 可能缩容 rehash，纯探查（has）+ 计数在三种次序下稳定快 8–13ms。同类方案唯一赢家纪律：落地 has 形态，delete 形态入表防重提。
- **S6-F-3**：这是绕开 S5-F-2 行为死因的合法布局变体（批量构造 + 无重复证明后免探针第二遍 + 有重复精确回退），等价完整；死于规模——V8 对 `Set.prototype.add` 的内联使批量构造快路径无净优势，两轮符号翻转（+2.10/−0.34ms）落 S5-F-3 形式抖动带。PLAN 点名的「validate 本体分配/布局」角度至此闭合：批量构造、对象表、索引循环（S5-F-3）、探针数（S5-F）四个维度全部裁决完毕。
- **S6-F-4**：字符串键属性表插入含形状/字典化开销，稳定慢 38–45%，负优化直接淘汰（S3-B-1/S3-F-1 同教训第三次复现）。
- **S6-F-5**：子序列快路径的收益前提（assignment 序 = population 子序列）不是契约事实而是调用方巧合；失配时白付 O(P) 指针扫描使 scattered/reversed 稳定负 18–20ms。符号随输入分布翻转的候选按 S4-F-1 先例不落地。**重开条件**：若未来规格把 `evaluateProposalShadow` 的 assignment 次序契约化为 population 子序列（届时快路径无失配分支），携本轮数据重新裁决，预期再省 ~28–31ms/实验。

## 5. 逐文件收口（R1–R5 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | **落地 S6-F-1**（§2）；delete 形态 = S6-F-2 淘汰；子序列叠层 = S6-F-5 淘汰；S1-F-8/S2-F-1/S2-F-4 维持 | **落地** |
| `canary.ts` | **落地 S6-F-1**（对称，收集点按 canary 检查序前移）；derivedExposure 计数并入 pass 1，match 检查位次不变 | **落地** |
| `plan.ts` | 批量 Set 快路径 = S6-F-3 淘汰；对象表 = S6-F-4 淘汰；validate 布局四维度闭合（§4.3）；S5-F/S5-F-2/S5-F-3/S1-F-6 维持 | 无候选落地 |
| `dataset.ts` | 反转方向对 sealed 校验无镜像收益（universe Set 每 manifest 一次、无 restore 放大；S5-F-1/S4-F-1 维持 test-only 判） | 无候选 |
| `simulation-holdout.ts` | 同上；S2-F-5/S3-F-5 维持 | 无候选 |
| `comparison-report.ts` | 生产路径预算复核：真实 N≈40–10³ 全函数亚 ms（R4-F 量化维持），X3-2/S4-F-3/S1-F-5 维持 | 无候选 |
| `gated-comparison.ts` | 同预算收口；S1-F-1/S2-F-6 维持 | 无候选 |
| `attribution-report.ts` | 21 行证据封装无循环，无新生产调用方 | 无候选 |
| `replay.ts` | rg 复核仍无生产调用方；S2-F-1/2/3、S4-F-2 维持 | 无候选 |
| `isolation.ts` | 唯一生产路径 eval-routing 整体已被 S3-D-3 否决；S3-F-4 维持 | 无候选 |
| `manifest.ts` | stableStringify 字节契约维持 R2-F 不提案裁决 | 无候选 |
| `holdout.ts` | S1-F-3/X4-2 维持 | 无候选 |
| `threshold-calibration.ts` | S1-F-4 维持 | 无候选 |
| `evaluation-card.ts` | S1-B-7 域维持 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |

## 6. 前后对比与剩余空间

P=2000/A=1000 全实验 266.5ms → **173.4–175.9ms**。落地后剩余构成：(a) validate 组件 ~115.7ms（66.7%）——契约强制内容读取本体，每条目单遍单探针（S5-F），布局四维度本轮闭合；(b) 已逐项排除的 A 线性项（recordOutcome 双 some/成本累加 = S1-F-8、rng 重放 = S2-F-1、assign includes = S2-F-4，各 ≤~2%）与防御拷贝（X3-3/X4-1 锁定）；(c) 新地板：pending 构建 + 早退扫描 ~2k 哈希操作/restore——唯一已知的进一步压缩通路（子序列快路径）已以 S6-F-5 双向数据淘汰并留重开条件。在保行为 + 契约 + 排除表约束下，本切片无剩余达「数十 ms」落地线的可测优化。

## 7. 测试

- `npx tsx scripts/round06-r6f-equivalence-sim.ts` ✓ — 27 项检查 × 两次独立运行 0 失败；剔除计时行后确定性结论逐位一致
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（生产侧 146.1→96.0ms，即本落地传导；信息行结构描述指 S1-F 时代，§0 已披露）
- `npx tsx scripts/round05-r5f-equivalence-sim.ts` ✓ — 224 项检查 0 失败（S5-F 回归维持：C1 组件 146.8→120.7ms；C2 端到端即 §2.4 编辑后数）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。注：需 Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行
- 未触碰任何版本化阈值、权限、数据面契约、公开签名；未改任何测试断言；`canCloseProductionCheckpointF` 语义未动
- 按纪律，S6-F-2/3/4/5 的 loser 裁决脚本未入库（全文见附录）；入库仅赢家仿真

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」；S6-F-1 请并入「已落地」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-F-2 | restore 成员反转的 delete+size 早退形态 | 三种次序全部被落地的 has+计数形态支配（差 8–13ms）：delete 命中含删除标记/缩容开销。同类方案唯一赢家纪律。重开条件：实测稳定反超 >5% |
| S6-F-3 | plan.ts `assertUniqueNonEmpty` 批量 Set 快路径 + 精确回退 | 等价完整（回退保重复命名与 first-fault，绕开 S5-F-2 死因），但 P=2000×2000 调用两轮 +2.10/−0.34ms 符号翻转，S5-F-3 形式抖动带；V8 内联 add 使批量构造无净优势。validate 布局维度至此闭合 |
| S6-F-4 | `assertUniqueNonEmpty` 换 null-prototype 对象表 | 实测稳定负优化（慢 38–45%，−44~−51ms/组件）：字符串键属性表插入贵于 Set |
| S6-F-5 | S6-F-1 之上叠双指针子序列快路径 | 符号随输入次序翻转：prefix +28~+31ms、scattered/reversed −18~−20ms（失配白付 O(P) 指针扫描）；assignment 次序无契约保证（S4-F-1 双向同判）。**重开条件**：规格将 evaluateProposalShadow 的 assignment 次序契约化为 population 子序列 |

MORE_OPTIMA=no
BRANCH=cursor/r6-f-experiments-sixth-pass-83a1

## 附录 A：loser 裁决脚本 1（S6-F-2/3/4 + 赢家原型；未入库，可复现）

保存为 `tmp-r6f-bench.ts` 后 `npx tsx tmp-r6f-bench.ts` 运行。脚本含：refRestore（S1-F 冻结形态）、varRestoreA（落地形态）、varRestoreB（S6-F-2）、landedAssertUnique（S5-F 冻结形态）、bulkAssertUnique（S6-F-3）、objAssertUnique（S6-F-4）；600 例 restore 模糊（两形态）+ 400 例 validator 模糊 + 3 次序反例 + 三次序 restore 调用型计时 + validator 组件计时。两次运行原始输出：

```
part A: 600 fuzz cases — throw/message/class and success states identical (forms A+B)
part B: order=prefix 2000 restores (P=2000,A=1000): ref=244.65ms formA=157.61ms (save 87.05ms) formB=170.39ms (save 74.26ms)
part B: order=scattered 2000 restores (P=2000,A=1000): ref=245.36ms formA=211.31ms (save 34.06ms) formB=218.13ms (save 27.24ms)
part B: order=reversed 2000 restores (P=2000,A=1000): ref=239.21ms formA=209.31ms (save 29.91ms) formB=218.20ms (save 21.01ms)
part C: 400 fuzz + 3 ordering cases — all three validator forms byte-identical
part C: P=2000 × 2000 calls: landed=118.21ms bulk-fastpath=116.11ms (save 2.10ms) obj-table=169.24ms (save -51.04ms)
total: 8 checks, 0 failures
---（第 2 次独立运行）---
part B: order=prefix ... formA save 85.36ms formB save 71.77ms
part B: order=scattered ... formA save 29.74ms formB save 23.63ms
part B: order=reversed ... formA save 29.60ms formB save 21.33ms
part C: P=2000 × 2000 calls: landed=114.14ms bulk-fastpath save -0.34ms; obj-table save -44.40ms
total: 8 checks, 0 failures
```

关键实现（validator 两 loser；restore 两形态与入库仿真的 reference/production 逐字对应，故略）：

```ts
/** S6-F-3: bulk-Set fast path + exact-loop fallback. */
function bulkAssertUnique(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen = new Set(values);
  if (seen.size === values.length) {
    for (const value of values) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new DomainValidationError(`${label} contains an empty entry`);
      }
    }
    return;
  }
  const seen2 = new Set<string>();
  let unique = 0;
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    seen2.add(value);
    unique += 1;
    if (seen2.size !== unique) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

/** S6-F-4: null-prototype object table. */
function objAssertUnique(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen: Record<string, 1> = Object.create(null) as Record<string, 1>;
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    if (seen[value] === 1) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
    seen[value] = 1;
  }
}

/** S6-F-2: delete + size early-exit (pass 2 of the reversal). */
if (pending.size > 0) {
  for (const hash of serialized.plan.population) {
    if (pending.delete(hash) && pending.size === 0) break;
  }
  if (pending.size > 0) { /* fallback replay, identical to the landed form */ }
}
```

## 附录 B：loser 裁决脚本 2（S6-F-5；未入库，可复现）

保存为 `tmp-r6f-s6f5.ts` 后 `npx tsx tmp-r6f-s6f5.ts` 运行。快路径核心（叠加在落地形态的 pass 1 上，`collected`/回退细节见输出行；回退侧即落地 pending-Set 方案）：

```ts
const population = serialized.plan.population;
let j = 0;
let subsequence = true;
for (const assignment of serialized.assignments) {
  /* structural checks verbatim … */
  const hash = assignment.episodeHash;
  if (subsequence) {
    while (j < population.length && population[j] !== hash) j += 1;
    if (j < population.length) j += 1;
    else subsequence = false; // out-of-order / duplicate / missing → fallback
  }
}
if (!subsequence) { /* landed pending-Set scheme over all hashes */ }
```

两次运行原始输出：

```
order=prefix: landed=158.92ms subseq-fastpath=127.91ms (delta 31.01ms)
order=scattered: landed=211.13ms subseq-fastpath=231.30ms (delta -20.17ms)
order=reversed: landed=210.99ms subseq-fastpath=228.79ms (delta -17.80ms)
total: 9 checks, 0 failures
---（第 2 次独立运行）---
order=prefix: delta 27.65ms; order=scattered: delta -18.96ms; order=reversed: delta -18.81ms
total: 9 checks, 0 failures
```

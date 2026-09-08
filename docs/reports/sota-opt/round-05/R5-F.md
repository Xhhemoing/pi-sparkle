MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-F：`src/experiments/` 第五遍复查报告（Round 1–4 同区之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `4273c3e`（含 R1–R4 全部四十区、R5-A/B/D、S5-A-*、S5-B-*、S5-D-* 排除）
- 切片：`src/experiments/` 全部 15 文件（2325 行），全量实际读码
- 前置阅读：README、EXCLUSIONS 全表（含 S5-D-1..5）、round-05/PLAN、round-01/R1-F、round-02/R2-F、round-03/R3-F、round-04/R4-F
- 分支：`cursor/r5-f-experiments-fifth-pass-83a1`

## 结论

**落地 1 项常数级优化（S5-F）**：`plan.ts` `assertUniqueNonEmpty` 的重复检测由 `seen.has(value)` + `seen.add(value)` 双哈希表探针改为单次 `seen.add(value)` + size 计数器。该验证器在每次 fail-closed restore 中运行（每实验 2A 次），是 R3-F 量化过的最大成本中心（占全程 ~50–52%）——本次把契约强制 Ω(P) 重验的**常数**压低 20–22%，端到端 P=2000/A=1000 全实验 **285–295ms → 255–265ms（每实验省 ~21–30ms）**，达「数十 ms」落地线。行为逐字节保持（错误消息、first-fault 次序、公开签名全部不变），由入库仿真 `scripts/round05-r5f-equivalence-sim.ts`（seeded mulberry32，224 项检查 × 两次独立运行 0 失败、确定性结论逐位一致）证明。另找到 3 个新角度候选并全部淘汰，新增排除 S5-F-1…S5-F-3。Ω(P+A) 下界第五次复核维持成立（本次落地压的是该下界内的常数，不动复杂度类）；`canCloseProductionCheckpointF` 语义未触碰（simulation ≠ production）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-A-* / S5-B-* / S5-D-* 条目。逐条对照：S5-F **不是 S1-F-6**（那是把 population Set 通过公开签名返还给 restore 复用；本次不产出、不外传任何 Set，`validateExperimentPlan` 的 `: void` 签名与 `assertUniqueNonEmpty` 的文件私有性均不变）；**不是 S3-F-2**（那是跳过重验；本次每次调用仍读全每个条目、仍做每条目探针，只是把同一条目的两次探针合为一次）；**不是 S2-H-4**（那是 agents 域 changeSetsEqual 的 delete 化，且其死因——CheckAdapter 重复路径发散——此处不存在）；**不是 X0-4/X1-1/X3-3**（无签名变更、无跨调用状态、无增量化）。排除表无「验证循环内探针去重」条目，属新提案，独立裁决后落地。
- 未触碰版本化阈值、权限、数据面契约、公开签名；双 LCB 与双归因未动；live = R0 等价、R1 未接线 live 维持；不声称 Outcome-supported。S1-F 的 restore population Set 成员判断与全量重校验原样保留（本次编辑不在 shadow.ts/canary.ts）。未改任何测试断言。
- `git diff --stat d91e2bd..4273c3e -- src/experiments/` 核对：本切片自 S1-F 落地以来仅 `shadow.ts`（+33/−4）与 `canary.ts`（+6/−1）的已记录 S1-F 变更，与 R4-F 记载逐字节一致，无未记录漂移。
- 基线外一处非切片机械修复（已单独提交并在此披露）：基线 tip 本身 `pnpm lint` 挂在 `scripts/round04-r4c-equivalence-sim.ts` 的 3 处 `no-console`（继承性破损，与本切片无关）。按既有仿真脚本惯例（round01/round03 均用 `process.stdout.write`）做 3 行机械替换，输出字节不变，使 gate 恢复可通过。

## 1. 规模与可达性基底（本轮重新核实）+ Ω(P+A) 下界第五次复核

- 切片外生产消费链复核与 R4-F 一致：`src/adaptation/reflection.ts`（`evaluateProposalShadow` = `createShadowRunner` 唯一 runner 生产链，assign+recordOutcome 全循环）；`eval-routing.ts` 消费 `gatedComparisonReport`/`createIsolationGuard`/`stableStringify`/`replayCacheKey`；`promotion-rules.ts`/`r1-shadow-report.ts` 消费 comparison 侧。`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout`、sealed-manifest 全链路仓内仅测试可达。
- 基线性能锚点（本机，Node 22.22.2，编辑前实测两轮）：P=2000/A=1000 全实验 285.06–294.89ms；2A 次 `validateExperimentPlan` 组件 144.41–148.09ms（**50.2–50.7%**，与 R3-F 的 51.6–51.8% 同锚点）；P=200/A=100 全实验 3.11–3.25ms。
- **下界复核**：fail-closed 契约（X3-3/X4-1，S3-F-2 构造性反证维持）强制每次 runner 调用重验 plan 内容（Ω(P)：唯一性必须读全 population）+ 全量 assignment（Ω(A)）+ 防御拷贝（Ω(A)），S1-F 后实现 O(P+A) 已达界——**本轮不试图推翻它**。本次赢家的定位恰是 R2-F §1 预言的唯一剩余空间：「runner 侧一切候选只能压常数」。契约规定必须*读全*每个条目并*判定*唯一性，但不规定每条目用几次哈希表探针：`has`+`add` 对同一 value 做两次探针（各含一次桶定位），而重复的 `add` 是 no-op，故 `add`+size 计数器以一次探针得到与 `has` 逐位相同的判定。探针数 2P→P 是下界内的纯常数压缩。

## 2. 落地项 S5-F：`assertUniqueNonEmpty` 单探针重复检测

文件：`src/experiments/plan.ts`（文件私有 helper `assertUniqueNonEmpty`，服务 `validateExperimentPlan` 的 population/metrics/reversibleScopes 三处调用）。

### 2.1 理论

- 原实现每条目 `seen.has(value)`（探针 1）→ `seen.add(value)`（探针 2）。V8 字符串哈希有缓存，但两次调用各自做一遍桶定位/链扫描。
- 新实现每条目 `seen.add(value)` + `unique` 计数器：add 对已存在元素是 SameValueZero no-op，`seen.size` 停滞 ⟺ 原 `seen.has(value)` 为真——同一条目、同一判定、探针减半。
- 收益落点：`validateExperimentPlan` 在每次 shadow/canary restore 中调用（X3-3/X4-1 锁定不可跳过），每实验 2A 次 × 每次 P 条目 = 4M 次探针对（P=2000/A=1000），是全实验最大成本中心。仓内先例：size 比较判唯一性的惯用法已存在于 `manifest.ts`（`all.size !== length`）、`comparison-report.ts`、`domain/flowchart.ts`——本次只是把它带进逐条目定位重复项的形态。

### 2.2 保行为论证（逐位）

- **判定集合**：字符串上 `Set.add` 的去重语义与 `Set.has` 同为 SameValueZero ≡ `===`；`size` 停滞当且仅当 value 已存在。接受/拒绝集合完全一致。
- **first-fault 次序**：每条目内「空项检查（typeof + trim）先于重复检查」逐语句保持；跨条目扫描次序不变；首个违规条目与抛出消息（`${label} contains an empty entry` / `${label} contains a duplicate: ${value}`）逐字节一致。唯一内部差异：重复条目上 `seen.add` 在 throw 前执行了一次 no-op——`seen` 为函数局部、throw 后即弃，不可观察。
- **公开面**：`validateExperimentPlan` 签名/行为、`SUPPORTED_EXPERIMENT_PLAN_VERSION`、`EXPERIMENT_ID_PATTERN` 均不变；helper 保持文件私有。非字符串注入（number/null/undefined/object/array/boolean，敌意序列化态可达）仍在 typeof 检查处以相同消息拒绝。

### 2.3 仿真证据（`scripts/round05-r5f-equivalence-sim.ts`，已入库）

对照组为逐字冻结的 4273c3e 版 `assertUniqueNonEmpty`+`validateExperimentPlan`；被测侧 `validateExperimentPlan` 与双 runner 全部从生产导入，被测差异恰为本次编辑。`npx tsx scripts/round05-r5f-equivalence-sim.ts`：

- Part A：200 个随机合法 plan（population 1–40、metrics 1–5、双模式、随机阈值/预算/种子，mulberry32 固定）两侧均接受；213 个篡改/故障 plan（population/metrics/reversibleScopes 三数组 × 重复项首/中/尾、空项首/中/尾、纯空白项、六类非字符串注入、dup-then-empty / empty-then-dup 混合故障次序、空数组，及 13 类非 helper 故障）throw/消息/错误类逐字节一致。
- Part B：生产 shadow/canary runner 各 5 组 assign+recordOutcome + JSON 往返 restore 状态一致；**64 个 plan 篡改序列化态经生产 restore 全部 fail-closed，抛错消息与参考验证器逐字节相同**——S1-F 的 restore 防护面经本编辑后原样成立。
- Part C1（copy-vs-copy，规避 R4-F 记载的镜像/生产 JIT 身份差）：P=2000 × 2000 次调用，has+add 142.73–144.87ms → add+size 113.13–115.94ms，**省 28.92–31.15ms（20.0–21.5%）**。编辑前独立探测（进程级两轮、正反次序）同带：省 25.89–35.19ms（18.0–23.7%）。
- 总计 **224 项检查 × 两次独立运行 0 失败**，剔除计时行后确定性结论 `diff` 逐位一致。

### 2.4 端到端前后对比（跨进程 A/B，生产导入，各两轮取最优）

| 档位 | 编辑前全实验 | 编辑后全实验 | 编辑前 2A-validate 组件 | 编辑后组件 |
| --- | --- | --- | --- | --- |
| P=2000 / A=1000 | 285.06–294.89ms | **254.94–264.64ms（省 ~21–30ms，−7~−10%）** | 144.41–148.09ms（50.2–50.7%） | 113.95–121.38ms（43.6–46.0%） |
| P=200 / A=100 | 3.11–3.25ms | 2.81–3.19ms | 1.46–1.49ms | 1.01–1.13ms |

交叉验证：既有 `scripts/round01-r1f-equivalence-sim.ts` 的 current 侧（生产 restore 路径）由历轮 149–152ms 降至 **138.1ms**（参考侧 640.7ms，4.6×，2668 项逐位检查全过）——与本落地在 restore 路径上的预期传导一致。

## 3. 候选三条件裁决

| 候选 | (a) 不在排除表 | (b) 理论 + 仿真证明 | (c) 真实规模非噪声 | 裁决 |
| --- | --- | --- | --- | --- |
| assertUniqueNonEmpty has+add → add+size 计数器 | ✓（§0 逐条对照） | ✓ SameValueZero 判定恒等 + first-fault 逐语句保持（224 项仿真） | ✓ 端到端每实验省 21–30ms（组件 −20–22%），高出 S2-F-1/S2-F-4 否决带一个量级 | **落地 S5-F** |
| dataset.ts / simulation-holdout 同型探针去重镜像 | ✓（新角度） | ✓（同一论证直接继承） | ✗ sealed 链路仓内 test-only（S4-F-1 同链）；每 manifest 一次性，U=2000 实测仅省 14.9–15.9µs（低于 S2-F-3 90µs 否决线），U=20000 也才 ~128–148µs | S5-F-1 |
| 批量 `new Set(values).size !== values.length` 唯一性形式 | ✓ | ✗ 行为发散：无法命名重复项（消息少 `: ${value}` 段），且空项/重复项 first-fault 次序重排（`["x","",""]` 反例：生产报 empty entry，批量形式先报 duplicate）——两枚构造性反例入仿真 C3 | — | S5-F-2 |
| 赢家的索引循环形式（`for (let i…)` + `size !== i+1`） | ✓ | ✓（等价平凡） | ✗ 三次测量快 1.63–3.06ms（1.4–2.7%），与组件自身运行间方差（~2.8ms）同量级，纯形式抖动 | S5-F-3（S4-C-3 同型裁决，保留最小差异的 for-of+计数器形式） |

## 4. 关键裁决细节

### 4.1 为什么第五遍还有赢家——与前四遍结论的关系

R1-F 落地渐近赢家后声明「无更多可测优化」，R2/R3/R4 三遍在**渐近层面**证实了它（下界攻击 S3-F-2 失败、各 A 线性项逐项 ≤1%）。但前四遍对 validate 组件的处理始终是「契约强制成本、只可绕不可减」的整体记账（R3-F 直接把 ~52% 计为 "the price the fail-closed contract knowingly pays"），未曾在该组件**内部**找常数。本次的观察是：契约锁定的是「每次调用读全内容并判定」，不锁定「每条目探针数」——2P→P 探针是下界内的合法常数压缩，且因为乘数是 2A×P（全实验 4M 探针对），单点 ~15ns 的节省被放大到数十 ms。这不与任何先前记载矛盾：复杂度类照旧 O(P+A)，S1-F 的 4.8× 与本次的 ~1.1× 正交叠加。

### 4.2 S5-F-2：批量形式为何必须立 ID

`new Set(values).size !== values.length` 是本仓已有惯用法（manifest.ts），是最容易被后续轮次「顺手统一」的重构方向——但在 plan.ts 会同时破坏两条错误契约（重复项命名 + first-fault 次序），仿真 C3 两枚反例锁死。立 ID 防止以「与 manifest.ts 风格统一」名义重提。

### 4.3 实测纪律复核

本战役有 5 例「省操作」直觉实测反转（S3-F-1、S3-B-1、S2-A-4、S1-A-4、S1-I-7）。本候选按同纪律处理：进程级正反次序两轮独立探测（+25.9~+35.2ms）、入库仿真 copy-vs-copy 两轮（+28.9~+31.2ms）、端到端跨进程 A/B 两轮（+21~+30ms）——三种测法、七次测量全部同号同带，无双向抖动。

## 5. 逐文件收口（R1–R4 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `plan.ts` | **落地 S5-F**（§2）；批量 size 形式 = S5-F-2 淘汰；索引循环形式 = S5-F-3 淘汰；S1-F-6（返 Set）维持排除未重开 | **落地** |
| `shadow.ts` | S1-F 后零变更读码复核；restore 的 `new Set(population)` 为纯插入无双探针可去；`recordExperimentOutcome` 双 some/成本重加维持 S1-F-8 | 无候选 |
| `canary.ts` | 结构同构复核；`derivedExposure` 循环为 fail-closed 本体 | 无候选 |
| `dataset.ts` | **S5-F-1 淘汰**（探针去重镜像，test-only + µs 级）；S4-F-1（seen Set 复用为 universe）维持排除 | 无候选落地 |
| `simulation-holdout.ts` | `assertExplicitSplit` 的 trainHashes has+add 同判入 S5-F-1（test-only）；S2-F-5/S3-F-5 维持 | 无候选落地 |
| `manifest.ts` | `validateManifest` 已用批量 size 惯用法（其错误面不命名重复项，本就如此，无需统一）；stableStringify 维持 R2-F 不提案裁决 | 无候选 |
| `replay.ts` | S2-F-1/2/3、S4-F-2 维持；无新探针型角度（byHash 为 Map.set 纯插入） | 无候选 |
| `comparison-report.ts` | S4-F-3、X3-2 维持；`validateComparisonReport` 的批量 size 检查在报告校验路径、常数规模 | 无候选 |
| `gated-comparison.ts` | S1-F-1、S2-F-6 维持 | 无候选 |
| `holdout.ts` | S1-F-3/X4-2 维持；`datasets` Map 无双探针浪费（get 后按需 set 属不同键路径） | 无候选 |
| `isolation.ts` | S3-F-4 维持 | 无候选 |
| `threshold-calibration.ts` | S1-F-4 维持 | 无候选 |
| `evaluation-card.ts` | 校验数组字面量维持 S1-B-7 域 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |
| `attribution-report.ts` | 21 行证据封装无循环 | 无候选 |

## 6. 前后对比

P=2000/A=1000 全实验 285–295ms → **255–265ms**；validate 组件占比 50.2–50.7% → 43.6–46.0%。落地后本切片剩余候选空间：(a) 契约强制的内容读取本体（typeof/trim/正则/字段检查——每条目已是单遍单探针）；(b) 已逐项排除并量化的 A 线性项（各 ≤~1%）；(c) 本轮新增三个 µs 级/形式级角度。`assertUniqueNonEmpty` 每条目探针数已达 1，无第二次同型压缩空间；在保行为 + 契约 + 排除表约束下，无剩余达「数十 ms」落地线的可测优化。

## 7. 测试

- `npx tsx scripts/round05-r5f-equivalence-sim.ts` ✓ — 224 项检查 × 两次独立运行 0 失败；剔除计时行后确定性结论 `diff` 逐位一致
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（S1-F 回归：640.7ms→138.1ms，4.6×，1.67 亿次成员比较消除维持；current 侧较历轮再降 ~10ms 即本落地的传导）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。注：需 Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行；基线 tip 的 lint 破损（round04-r4c 脚本 3 处 no-console，非本切片）已按仿真脚本惯例机械修复并单独提交（§0）
- 未触碰任何版本化阈值、权限、数据面契约；`canCloseProductionCheckpointF` 语义未动；未改任何测试断言

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-F-1 | dataset.ts assertUniqueNonEmpty / simulation-holdout assertExplicitSplit 探针去重镜像（S5-F 同型） | 等价论证直接继承，但 sealed 链路仓内 test-only（S4-F-1 同链）、每 manifest 一次性，U=2000 实测仅省 14.9–15.9µs（低于 S2-F-3 90µs 否决线）、U=20000 也才 ~128–148µs。**重开条件**：该链路获得生产调用方且 U 达 10⁵ 级或验证进入高频路径，届时携本轮等价证明重新裁决 |
| S5-F-2 | assertUniqueNonEmpty 换批量 `new Set(values).size !== values.length` 形式 | 行为契约性淘汰：无法命名重复项（消息发散）+ 空项/重复项 first-fault 次序重排（`["x","",""]` 反例）；两枚构造性反例见入库仿真 C3。禁止以「与 manifest.ts 惯用法统一」名义重提 |
| S5-F-3 | S5-F 赢家的索引循环形式（`for (let i…)` + `seen.size !== i+1`） | 三次测量快 1.63–3.06ms（1.4–2.7%），与组件测量的运行间方差（~2.8ms）同量级，纯形式抖动（S4-C-3 同型）；保留最小差异的 for-of+计数器落地形式。**重开条件**：未来测得稳定 >5% 形式优势 |

MORE_OPTIMA=no
BRANCH=cursor/r5-f-experiments-fifth-pass-83a1

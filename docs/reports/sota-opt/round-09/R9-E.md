MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-E：`src/learning/` 第九遍复查报告（Round 9）

**战役:** 全库持久 SOTA 优化 Round 9 / R9-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `0f5c824`（含 S9-A-1 / S9-B-1..4 排除已入表）
**分支:** `cursor/r9-e-learning-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；R3-E..R8-E 的切片级收口锚点复核成立，
配置态 × 命令类矩阵复核无新洞（全部调用位点行号与 R8-E 记录逐一相同）。**
切片 10 个文件自 R1-E 基线（`adb20d7`）经 R2-E..R8-E 至本轮基线（`0f5c824`）
**逐字节未变**（`git diff adb20d7..HEAD -- src/learning/` 为 0 行，期间无任何
提交触及该目录）。`626f14c..0f5c824`（R8-E 之后）的全部提交仅触及
`docs/reports/sota-opt/`——`git diff --stat 626f14c..HEAD -- src/ test/` 为空，
**src 与 test 一行未动**，R8-E 的全部规模测量、调用面图景与裁决原样成立
（本 VM 天花板仍按本轮实测重锚，见 §1）。R1-E 逐文件收口、R2-E..R8-E 复查与
S1-E-1..8 / S2-E-1..7 / S3-E-1..5 / S4-E-1..3 / S5-E-1..5 / S6-E-1..5 /
S7-E-1..5 / S8-E-1..3 共 41 项排除全部继承有效。**SLICE-CPU 总量上界锚点
经本轮实测复核成立**：本 VM 五次运行 17.4–17.6µs/run（保守按 R7-E outcomes
带替换 ~22.2–22.7µs，与 R6-E / R8-E 同带）——距落地线（≥10ms）**≥568×**，
即使把切片 CPU 清零也远不达门槛。配置态 live 面复测：learned 策略已装载时
`applyLearnedRouting` 258–280ns/task（R8-E 261–276ns 同带），**空策略面新增
锚点 120–126ns/task**；`loadLearnedRouting` 全新 root 28.5–40.3µs、现实
registry 85.9–97.8µs（R8-E 80–85µs 同级，亚 ms 一次性）。在完整排除表之上
以第九组新角度枚举（局部永不逃逸载荷上的死存储消除、pass-2 工作集缩减、
跨函数分派树合一），得到 3 个此前未点名的新候选（S9-E-1 … S9-E-3），全部经
理论 + 确定性仿真（seeded mulberry32，4146 项等价检查/次 × 5 次独立运行，
等价结论逐位一致——VERDICT 行 md5 五次相同；ns 级基准按 S3-E-3 方法论副本
对副本、按 S3-E-4 方法论 5 次判向）裁决后淘汰：1 个等价成立但每 run 仅
242–272ns 的死存储消除（S9-E-1）；1 个等价成立但 **E=400 五次全负** 的
pass-2 预过滤（负优化，理论成本核算 6E→6E+4C 证实，S9-E-2）；1 个等价成立
但 1.2–1.6ns/call（每 run 12–16ns）且落地需新增公开导出或复制分派树语义的
跨函数合一（S9-E-3）。未重开任何 X* / S1-* … S8-* / S9-A-1 / S9-B-1..4
条目。零 diff 下全部硬不变量天然满足。本切片在其输出契约与数据面语义下维持
SOTA——第九遍复查确认：**剩余的全部 ms 级余量仍全部在被排除表点名保护的
I/O 契约面上**，切片级收口条件（R3-E §7 … R8-E §7）依然成立。第九组角度
（死存储 / 工作集缩减 / 分派树合一）全部收口，无遗留候选。**切片关闭，
MORE_OPTIMA=no。**

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第九遍全量实际
  读码，未依赖前八轮记忆。上下游 `adaptation/`、`routing/`、`run/`、`track/`、
  `cli/`、`feedback/`、`persist/`、`privacy/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表，含 S9-A-1、
  S9-B-1..4）→ round-09/PLAN.md → round-08/PLAN.md → round-08/R8-E.md →
  R7-E … R1-E → 10 个源文件。
- 基线漂移检查：`git diff adb20d7..HEAD -- src/learning/` 为 0 行且
  `git log adb20d7..HEAD -- src/learning/` 无提交——切片自 R1-E 裁决基线起
  逐字节未变。且 `626f14c..0f5c824` 间全部提交仅为 `docs/reports/sota-opt/`
  文档（R8-G/H/I/J、R9-A/B 报告与排除表摄取），`git diff --stat
  626f14c..HEAD -- src/ test/` 为空——前八轮全部测量与裁决原样成立。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S9-E-1（applyCascadeRetry
  死 `behaviorDistribution` 重算消除）与 S7-E-3（outcomesFromRoutedRun 验证
  提升）、S3-B-4（routing 切片「结果相同即跳过重建」生产不可达快路径）区分——
  本候选的死字段论证依据是 routes Map 为函数局部永不逃逸且输出行不读该字段，
  非验证时机变换、非生产不可达路径（本轮夹具实测 same-model no-op 占 applied
  retry 43.6%，可达）；S9-E-2（pass-2 消费者预过滤）与 S1-E-1（两遍合一遍
  merge）、S4-E-1（空事件快路径）区分——本候选保留两遍语义只缩减第二遍工作集，
  是 R7-E §3.4「重复求值」收口未覆盖的最后一个结构变体；S9-E-3
  （scoreTaskResult × taskSuccessFromResult 跨函数分派合一）与 S2-E-7（跨界
  binding 双拷贝）、S8-E-3（跨界 prefer.find 去重）区分——本候选合并的是两棵
  对同一 (outcome, verification) 输入的**分派树**而非数据拷贝或单一求值。
  X0-3 / X1-1 / X1-2 / X2-6 / S1-E-* … S8-E-* 全部未触碰。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `collectSignalsFromEvents` JUDGE_DECISION 分支 evidenceIds 经 baseSignal
    `?? []` 走共享冻结空单例 = S1-A-7 / S7-B-5 可观察身份族（R8-E §0 已拒），
    维持拒列；
  - `runAutoAdaptLoop` 的 `events ?? []` / `extraSignals ?? []` 共享冻结空
    数组 = 同一身份族，拒列；
  - bandit reward 循环 `kind === "human"` 被后继 `kind !== "deterministic"`
    吸收的冗余析取消除 = S1-B-7 近零成本比较族 + R6-E/R7-E 谓词整理无 ID
    收口，拒列；
  - `readBanditFile` ENOENT catch 直返 undefined = 一次性错误路径微整理
    （R2-E 错误路径裁决同式），拒列；
  - `diagnoseModelProjectIssues` 的 `first.modelId === undefined` 恒真守卫
    消除 = R5-E fail-closed 裁决维持，拒列；
  - `loadLearnedRouting` 读路径 `hashCandidateContent` 完整性重哈希消除 =
    S8-D-2 同式 + 数据面完整性契约（CAS 面），拒列；
  - `LEARN_EVALUATION_PLAN` 在 auto-loop.ts 与 from-episode.ts 双定义共享 =
    纯重构无性能面，拒列；
  - USER_ANSWER 的 `scoreUserAnswer`（trim）与 `truncate`（replace+trim）
    双归一化合流 = 两者语义不同（空白折叠 vs 端部裁剪）结构上不可复用，
    无候选可立。
- ns 级基准全部副本对副本（S3-E-3 方法论）；几十~几百 ns 量级 delta 以 5 次
  独立运行判向（S3-E-4 方法论）；S9-E-3 基准采用 64 项混合输入流（真实
  megamorphic 调用点形态，S8-A-3 教训）；生产导入仅承担等价性参照与绝对量级
  锚点角色。等价性 VERDICT 行（含 fixture 数、检查数、same-model 统计）跨
  5 次运行 md5 逐位一致。
- 硬不变量：零 diff，`adapt auto` 只提案、SPARKLE_AUTO_ADAPT=0 仍收集、
  `parseObservedSignal` 拒绝 user/human 伪造 taskSuccess、
  `ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双归因保留、Tracking
  无指挥权、分析不改 in-flight run——天然满足。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、测试、公开签名、数据面。
  S7-C 落地在 `routing/offline-logit.ts`，不触本切片，未重做。
- 环境：Node v22.14.0（与 R8-E 测量环境一致；`package.json` engines
  要求 >=22.19.0，量级结论不受影响，与前轮同口径）。

## 1. 配置态 × 命令类矩阵复核 + SLICE-CPU 锚点

R7-I 教训（默认态夹具可能掩盖配置态主路径）按令复查。src 自 `626f14c` 起
一行未动，故 R8-E §1 矩阵表结构原样成立；本轮逐条 grep 复核全部切片进入点
行号，**与 R8-E 记录逐一相同、无新增调用方**：

| 命令类 × 配置态 | 切片进入点（本轮行号复核） | 频次与规模 |
| --- | --- | --- |
| `adapt auto --run` | `runAutoAdaptFromEvents` @ `cli/adapt:188` → `runAutoAdaptLoop` | 每进程一次，E≈41 |
| `adapt auto --project` | `runAutoAdaptLoop` @ `cli/adapt:205`（空事件表，S4-E-1 面） | 每进程一次 |
| `adapt learn --run` | `proposeRoutingFromRoutedEvents` @ `cli/adapt:168`（S2-E-2 面） | 每进程一次 |
| 普通 `run` | `loadLearnedRouting` @ `cli/main:708`（S2-I-1 已裁决） | 每进程一次 |
| `run --children` | `cli/main:708` 载入 → `applyLearnedRouting` @ `routing/assign:102` 每任务 → `startFlowchartRun` 内 `flowchart-run:712` 第二次载入（S8-E-1，勿去重）→ `applyLearnedRouting` @ `flowchart-run:681` 每节点 → `runAutoAdaptLoop` @ `cli/main:783` 一次 | 双载入各一次；任务/节点 ≤10/几十 |
| `track`（startTrackedRun） | `track/loop:88` 载入 → 每任务 `applyLearnedRouting` → `flowchart-run:712` 第二次载入（同 S8-E-1）→ `runAutoAdaptLoop` @ `track/loop:172` 一次 | 同上 |
| flowchart resume / replay | 各单次载入（无双载入，R8-E 复核维持） | 每恢复一次 |
| SPARKLE_AUTO_ADAPT=0 | 仍收集（persistSignals + updateProjectBandit 照付），仅跳过 propose；R5-E 裁决维持 | 不变 |
| 测试专用面 | `patterns` / `attribution` / `signatures` / `compareSignatures` / `loadProjectBandit` / `taskSuccessFromExitCode` / `policyFromAssignments` / `learnedRoutingPath` / `parseObservedSignal`(直调) / `proposeRoutingFromAssignments`(deprecated) 交叉检索复核仍零生产调用方 | 不进热路径 |

矩阵结论：**无新洞**。配置态给本切片的全部新增工作仍是每任务/每节点一次
`applyLearnedRouting` + 每 run 至多两次 `loadLearnedRouting`（S8-E-1 已
点名保护），均在本轮实测锚点覆盖内。

SLICE-CPU 锚点本 VM 重测（五次运行区间；Node 22.14.0；seeds
`0xe99e01`–`0xe99e03`）：

```text
collect=13.6-13.8us  outcomes=2.2-2.3us  diagnose=0.84-0.93us  bandit-build=0.7us
total in-slice CPU ~17.4-17.6us per full auto-adapt run
vs landing bar >=10000us  ->  568-576x below EVEN IF ZEROED
configured-state: applyLearnedRouting(avoid=10, M=10) = 258-280ns/task （R8-E 261-276 同带）
                  applyLearnedRouting(空策略)        = 120-126ns/task （本轮新增空面锚点）
                  loadLearnedRouting fresh(ENOENT)   = 28.5-40.3us/次
                  loadLearnedRouting 现实 registry    = 85.9-97.8us/次 （亚 ms 一次性，S8-E-1 带）
```

注：本轮 diagnose 夹具（seed `0xe99e03`）分组数多于 R8-E 夹具（0.84–0.93µs
vs 0.12–0.15µs，夹具组成差异非代码差异——切片逐字节未变）；outcomes 夹具为
retry-heavy 变体 2.2–2.3µs。按 R7-E outcomes 带（7.0–7.3µs）保守替换，总量
~22.2–22.7µs，与 R6-E（22.0–24.4µs）/ R8-E 保守口径（22.7–24.3µs）同带。
两种口径下结论一致：**锚点复核成立，该切片不存在不推翻既有排除就能达门槛的
候选。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-E-1 | **`applyCascadeRetry` 死 `behaviorDistribution` 重算消除**（`from-episode:252-273`）。两个变体：(A) 死存储消除——去掉 `eligible` 计算与 `oneHotDistribution` 重算，spread 保留 stale 值；(B) same-model no-op 快路径——`nextModel === current.model` 且 `nextModelVersion` 未定义/空白/等值时直接 return | `routes` Map 为 `outcomesFromRoutedRun` 函数局部、永不逃逸；输出行只读 route 的 family / agentRole / model / modelVersion / featureVersion；后续 retry 只读 eligibleModels（spread 恒保留原引用）/ model / modelVersion——`behaviorDistribution` 写入后**无任何读者**，属死存储 | ✅ 400 fixtures（retry-heavy 偏置：5546 retries / 1676 applied / 731 same-model no-op = 43.6%）× 3 组 deepStrictEqual（prod↔ref、ref↔A、ref↔B）× 5 次运行逐位一致 | 副本对副本 E=40（applied=4）：dead-store delta **+242/+272/+247/+257/+246ns/run** 五次全正、fast-path **+108/+146/+121/+126/+113ns/run** 五次全正；每 applied retry ~61–68ns | 淘汰：量级——真实 run TASK_RETRY 至多个位数（R1-A 组成），每 run 收益上界数百 ns，距落地线 **~4–5 个数量级**；且删除字段的强形态会改变局部载荷的 own-property 集合（`ModelRoutedPayload` 公开类型完整性），等价虽由「永不逃逸」保证但收益不配风险；「结果相同即跳过重建」的 scheme 与 S3-B-4 同家族（该处判生产不可达，本处可达但 ns 级）——本轮以正式 ID 收口该家族在本切片的位点 |
| S9-E-2 | **`collectSignalsFromEvents` pass-2 消费者事件预过滤**（`signals:126-244`）：pass 1 顺带把 CHILD_MESSAGE / USER_ANSWER / JUDGE_DECISION / RUN_FAILED 收进 `consumers` 数组，pass 2 只遍历该工作集（保留两遍语义，非 S1-E-1 的合一遍） | 成本核算：现行 pass 2 对全部 E 事件各做至多 4 次类型比较（四个独立 if）→ 4E；预过滤把非消费者的比较移进 pass 1（新增至多 4 次比较 + push）→ pass 1 从 2E 升至 ~6E，pass 2 降至 4C，总量 6E → **~6E+4C + 数组构建**——理论预测中性偏负，随 E 放大 | ✅ 400 fixtures（含 no-project 早退、ctx-projectId 注入、episodeId 变体、PEER_MESSAGE/RUN_FAILED 覆盖）× 2 组 deepStrictEqual（prodNorm↔ref、ref↔prefilter）× 5 次运行逐位一致（信号相对序保留） | 副本对副本：E=40 方向不稳（0/−52/**+109**/+93/+80ns——噪声带内）；**E=400 五次全负**（−292/−884/−980/−846/−606ns/run），规模越大越负 | 淘汰：**负优化**，理论成本核算被实测证实。R7-E §3.4「重复求值/多遍结构」收口的最后一个未点名结构变体（工作集缩减而非遍合并），本轮点名并以负值封死 |
| S9-E-3 | **`scoreTaskResult`（`signals:48-55`）与 `taskSuccessFromResult`（`task-success:26-34`）跨函数分派树合一**：TASK_RESULT 分支对同一 (outcome, verification) 对付两棵独立分派树（score ≤7 次比较、taskSuccess ≤4 次）；合一为单树 ≤6 次比较同时产出两值 | 免每 TASK_RESULT 至多 ~5 次冗余字符串比较；合一树须逐位复现两函数全部语义（含 o=FAILURE + v=PASSED → score 15 / taskSuccess **PASS** 的 quirk） | ✅ 12 组合全枚举 × 6 binding 变体（undefined / 空 / 满 / 空白串 / 部分）+ 2000 fuzz × 5 次运行逐位一致（quirk 复现确认） | 副本对副本（64 项混合输入流）：pair 27.1–27.8ns/call vs merged 25.8–26.1ns/call，delta **+1.2/+1.2/+1.2/+1.2/+1.6ns/call** 五次全正 → ×10 TASK_RESULT/run = **12–16ns/run** | 淘汰：量级距落地线 **~10⁶×**；落地需在切片内新增公开导出（公开面扩张）或在 signals.ts 内联复制两棵树语义（X1-2 复制逻辑族），且 `scoreTaskResult` / `taskSuccessFromResult` 均为公开签名必须保留——合一后原函数沦为半死面，维护面反而扩大 |

## 3. 关键裁决细节

### 3.1 S9-E-1：死存储角度在本切片的收口

第九组第一个新角度是「局部永不逃逸载荷上的死字段/死存储」。
`applyCascadeRetry` 每次生效重试付一次 `eligible` 判定（含可能的数组拷贝）
+ 一次 `oneHotDistribution`（O(M) 对象构建）+ 整载荷 spread，但写入的
`behaviorDistribution` 在 `routes` 的整个生命周期内没有任何读者——消费侧
（TASK_RESULT 绑定）只读 5 个标量字段，后续重试只读 `eligibleModels` /
`model` / `modelVersion`（且 spread 从不更新 `eligibleModels` 引用）。
等价性由 400 个 retry-heavy 夹具（专门偏置 same-model 重试至 applied 的
43.6%，并覆盖 nextModelVersion 的 undefined/空白/等值/新值四态与
same-model 后再异 model 的链式重试）× 3 组 deepStrictEqual × 5 次运行
逐位确认。淘汰在量级：夹具 E=40 下 applied=4 时 dead-store 五次全正但仅
242–272ns/run；真实 run 的 TASK_RETRY 频次更低。该角度就此收口——切片内
其余局部构造均有读者（pass-1 五 Map、routes 标量字段、diagnose 分组），
无第二个死存储位点。

### 3.2 S9-E-2：pass-2 工作集缩减——理论预测负值并被实测证实

这是「两遍结构」角度树上最后一个未点名的分支：S1-E-1 否决了两遍合一遍
（改变 PROJECT_DISCOVERED 后置发现语义的风险面），S4-E-1 否决了空事件
快路径（生产不可达），而「保留两遍、只缩减第二遍工作集」从未被点名。
成本核算先行：预过滤不消除任何比较，只把非消费者事件的 4 次比较从 pass 2
搬进 pass 1，并新增消费者判定与 `consumers.push` 的分摊成本——总比较数
从 6E 升至 ~6E+4C，外加数组增长。实测精确复现该预测：E=40 在噪声带内
方向不稳（−52~+109ns），E=400 五次全负且负值随 E 放大（−292~−980ns）。
本候选以「理论 + 实测双重负值」封死，防止将来任何「预过滤/工作集缓存」
换名重提。

### 3.3 S9-E-3：跨函数分派树合一——等价可证但落地形态自败

`signalFromAgentMessage` 的 TASK_RESULT 分支是切片内唯一对同一输入对
执行两棵独立分派树的位点。合一树的等价性以最强口径确认（12 全组合 × 6
binding 变体全枚举 + 2000 fuzz，且专门覆盖 o=FAILURE + v=PASSED 时
score=15 / taskSuccess=PASS 的历史 quirk——合一实现必须原样保留该行为）。
淘汰是双重的：量级上 1.2–1.6ns/call、每 run 12–16ns，为本轮三候选之最低；
形态上两函数都是公开导出（测试与本切片内两处消费），合一体要么成为第三个
公开面（扩张），要么内联进 signals.ts 并留下两棵原树作半死面（X1-2 复制
逻辑族的镜像）。「跨函数冗余求值」角度至此在切片内（S1-E-2 双 get、
R7-E 六处）、跨界（S8-E-3）、跨分派树（本例）三个层级全部闭合。

## 4. 逐文件收口（前八轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S9-E-2（pass-2 预过滤）淘汰并封死两遍结构角度残支；S9-E-3（跨树合一）淘汰；JUDGE_DECISION evidenceIds 空单例、`?? []` 冻结数组不立 ID（§0 换名检查）；S1-E-1/2/3、S2-E-5/7、S3-E-1/5、S4-E-1/3、S5-E-2/3、S6-E-1/2/5、S7-E-1/2/5、S8-E-2 维持 | 无候选 |
| `from-episode.ts` | S9-E-1（死 behaviorDistribution 重算）淘汰并收口死存储角度；LEARN_EVALUATION_PLAN 双定义 = 纯重构拒列；S2-E-2、S7-E-3、Date.parse（X1-1 域）维持 | 无候选 |
| `task-success.ts` | S9-E-3 涉及面淘汰；`copyDefinedBinding`+`present()` 空白字段契约实施点不动；S2-E-7、S8-E-2 覆盖维持 | 无候选 |
| `auto-loop.ts` | `events/extraSignals ?? []` 空单例拒列（§0）；I/O 契约边全点名维持（S1-E-4/5、S2-E-1、S3-E-2、S4-E-2、S5-E-1/5）；ingestSubagentDirectory readdir 序传播为既有预期行为非候选 | 无候选 |
| `bandit-store.ts` | 吸收析取（`kind==="human"` 冗余）拒列（§0）；ENOENT catch 微整理拒列；S2-E-3/4、S3-E-4、S6-E-3/4、X1-2 维持 | 无候选 |
| `diagnostics.ts` | `first.modelId` 恒真守卫拒列（R5-E fail-closed 维持）；本轮 diagnose 锚点 0.84–0.93µs（夹具差异非代码差异）；S1-E-6、S3-E-3、S4-E-3、S5-E-4 维持 | 无候选 |
| `learned-routing.ts` | 空策略面新增锚点 120–126ns/task 立案；读路径完整性重哈希拒列（S8-D-2 同式 + CAS 契约）；S8-E-1（双载入，勿去重）、S2-E-6、X1-1 维持 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍零生产调用方（仅测试使用）；X2-6、S1-E-7/8 维持 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.14.0）：

```bash
npx tsx --test "test/unit/learning/"*.test.ts "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r9e-sim.mts`，未入库以遵守「败者仿真只进报告附录」；
完整源码见附录，seeds `0xe99e01`–`0xe99e08`）共 **5 次独立运行**，每次
**4146 项等价检查**全部通过，等价 VERDICT 行跨 5 次运行 **md5 逐位一致**
（`5c3a3d34b832430644bf7af758a692d3`）。代表性一次运行：

```text
BENCH SLICE-CPU anchor re-verify: collect=13.7us outcomes=2.2us diagnose=0.89us bandit-build=0.7us | total in-slice CPU ~17.4us per run vs landing bar >=10000us (574x below even if zeroed)
BENCH configured-state anchor: applyLearnedRouting(avoid=10, M=10)=277ns/task | empty policy=126ns/task -> x10 tasks/run = 2.77us/run (live face with learned policy loaded)
BENCH configured-state anchor: loadLearnedRouting fresh-root(ENOENT)=36.7us | realistic registry (baseline+1 candidate)=94.7us (once-per-run production call-site cost)
VERDICT S9-E-1 equivalence: 400 fixtures, retries=5546 applied=1676 same-model-noop=731 (43.6% of applied), all 3x400 deepStrictEqual checks passed=true
BENCH S9-E-1 (E=40, retries=17, applied=4, noop=2): ref=2.45us dead-store=2.21us (delta=242ns/run) fast-path=2.35us (delta=108ns/run) | per applied retry dead-store saves ~61ns
VERDICT S9-E-2 equivalence: 400 fixtures (incl. no-project and ctx-project cases), all 2x400 deepStrictEqual checks passed=true
BENCH S9-E-2 (replica-vs-replica): E=40 ref=15.9us prefilter=15.9us (delta=0ns/run) | E=400 ref=145.4us prefilter=145.6us (delta=-292ns/run)
VERDICT S9-E-3 equivalence: 72 exhaustive truth-table combos (12 outcome x verification pairs x 6 binding variants) + 2000 fuzz, all passed=true
BENCH S9-E-3 (replica-vs-replica, 64 mixed inputs/iter): pair=27.3ns/call merged=26.0ns/call delta=1.2ns/call -> x10 TASK_RESULT/run = 12ns/run
VERDICT total equivalence checks: 4146, failures: 0
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 5 次运行汇总：S9-E-1 dead-store **五次全正**（+242/+272/+247/
+257/+246ns/run）、fast-path 五次全正（+108/+146/+121/+126/+113ns/run）；
S9-E-2 E=40 方向不稳（0/−52/+109/+93/+80ns）、**E=400 五次全负**（−292/
−884/−980/−846/−606ns/run）；S9-E-3 五次全正（+1.2×4/+1.6ns/call）；
SLICE-CPU 总量 17.4–17.6µs 稳定；applyLearnedRouting 非空 258–280ns/task、
空策略 120–126ns/task 稳定；loadLearnedRouting fresh 28.5–40.3µs、现实
registry 85.9–97.8µs 稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-E-1 | applyCascadeRetry 死 behaviorDistribution 重算消除（死存储变体与 same-model no-op 快路径变体，from-episode:252-273） | 等价成立（400 fixtures × 3 组 × 5 运行；routes 局部永不逃逸、字段无读者）且五次全正，但 E=40 收益仅 242–272ns/run（每 applied retry ~61–68ns），真实 retry 频次个位数 ⇒ 距落地线 ~4–5 个数量级；「结果相同即跳过重建」scheme 与 S3-B-4 同家族；删除字段强形态动局部载荷 own-property 集合，收益不配风险 |
| S9-E-2 | collectSignalsFromEvents pass-2 消费者事件预过滤（保两遍语义、缩减第二遍工作集） | 等价成立但**负优化**：理论成本核算 6E → ~6E+4C+数组构建，实测 E=40 方向不稳（噪声带）、E=400 五次全负（−292~−980ns/run）且负值随 E 放大；两遍结构角度（S1-E-1 合遍、S4-E-1 空快路径、本条工作集缩减）至此全部封死 |
| S9-E-3 | scoreTaskResult × taskSuccessFromResult 跨函数分派树合一（单树同时产出 score 与 taskSuccess） | 等价成立（12 全组合 × 6 binding + 2000 fuzz，含 FAILURE+PASSED quirk 复现）且五次全正，但仅 1.2–1.6ns/call ⇒ 12–16ns/run，距落地线 ~10⁶×；落地需新增公开导出（公开面扩张）或内联复制两树语义（X1-2 族）且两原函数为公开签名必须保留 |

重开条件：S9-E-1 需 TASK_RETRY 频次增长 ≥3 个数量级（每 run 数千次重试）
或 routes 载荷逃逸为公开返回；S9-E-2 无重开条件（负优化，理论与实测双重
封死）；S9-E-3 需 TASK_RESULT 频次增长 ≥5 个数量级或两函数公开面立项合并。
切片级重开总条件维持 R3-E §7 … R8-E §7：SLICE-CPU 锚点失效（全切片 CPU
增长 ≥2 个量级，本轮复核值 17.4–17.6µs、保守口径 ~22.2–22.7µs）或任一 I/O
契约排除（X0-3 / S2-E-1/4 / S1-G-1 / S1-E-4/5 / S4-E-2 / S5-E-5 /
S6-E-3/4 / S8-E-1）被正式推翻。

**MORE_OPTIMA=no——切片关闭。** 第九组新角度（死存储、工作集缩减、分派树
合一）全部裁决淘汰且各自的角度类在切片内已无第二位点；配置态 × 命令类矩阵
复核无洞（全部行号与 R8-E 一致）；无遗留「maybe later」候选。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe99e01`–`0xe99e08`。VERDICT 行确定性（跨运行逐位一致），BENCH 行
承载计时。

```ts
/**
 * R9-E deterministic equivalence + benchmark simulation (ninth pass over
 * src/learning/). Adjudicates fresh candidates S9-E-1 .. S9-E-3 against the
 * current implementations and re-verifies the R3-E..R8-E SLICE-CPU anchor
 * plus the configured-state matrix cells (empty vs nonempty learned policy,
 * fresh vs realistic registry load). Seeded PRNG (mulberry32) -> fully
 * reproducible. Seeds: 0xe99e01 - 0xe99e08.
 *
 * Reference = production imports (equivalence role + absolute-magnitude
 * anchors). ns-delta benchmarks are replica-vs-replica per the S3-E-3
 * methodology; tens-of-ns deltas need >=5 independent runs per S3-E-4;
 * mixed-shape inputs are used where construction is touched (S8-A-3 PIC
 * lesson). Replicas keep every already-excluded edit UNAPPLIED.
 *
 * VERDICT lines are deterministic (must be bit-identical across runs);
 * BENCH lines carry timing and may vary.
 */
import { deepStrictEqual } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  collectSignalsFromEvents,
  scoreTaskResult,
  scoreUserAnswer,
  type ObservedSignal
} from "/workspace/src/learning/signals.js";
import { diagnoseModelProjectIssues } from "/workspace/src/learning/diagnostics.js";
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import {
  applyLearnedRouting,
  ensureRoutingBaseline,
  loadLearnedRouting,
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedRoutingPolicy
} from "/workspace/src/learning/learned-routing.js";
import {
  taskSuccessFromResult,
  type TaskSuccessObservation,
  type TaskSuccessRouteBinding
} from "/workspace/src/learning/task-success.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { classifyTaskFailure } from "/workspace/src/routing/failure-class.js";
import { parseOutcomeObservation, type OutcomeObservation } from "/workspace/src/routing/outcomes.js";
import {
  loadAdaptationRegistryOrNew,
  saveAdaptationRegistry
} from "/workspace/src/adaptation/promotion.js";
import { AGENT_ROLES, isAgentRole } from "/workspace/src/domain/roles.js";
import type { EpisodeId, ProjectId, RunId, TaskId } from "/workspace/src/domain/ids.js";
import type { Event, ModelRoutedPayload } from "/workspace/src/run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import type { FeedbackKind } from "/workspace/src/feedback/types.js";
import type { OutcomeCriterion, OutcomeKind } from "/workspace/src/routing/outcomes.js";
import type { EpisodeSignatureKind } from "/workspace/src/learning/signatures.js";
import type { TaskFamily } from "/workspace/src/task/taxonomy.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}`);
  }
}
function eq(name: string, a: unknown, b: unknown): void {
  checks += 1;
  try {
    deepStrictEqual(a, b);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
  }
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
const FAMILIES_LOCAL: readonly TaskFamily[] = [
  "edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"
];
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
const ROLES = ["actor", "critic", "tester", "planner", "scout", "reviewer"] as const;
const ANSWERS = ["lgtm", "no, revert this", "please also add coverage", "可以", "不行 错误", "hmm"];

/* ================================================================
 * Fixture generators (R1-A composition: E~41, 10 MODEL_ROUTED,
 * 10 CHILD_MESSAGE, few USER_ANSWER/JUDGE/RETRY). Mirrors prior rounds.
 * ================================================================ */
function genCollectEvents(rng: () => number, length: number, withProject: boolean): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  if (withProject) {
    out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } });
  }
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.22) {
      out.push({
        type: "MODEL_ROUTED",
        payload: {
          taskId,
          model: pick(rng, ["cheap", "premium", "mid"]),
          role: pick(rng, ROLES),
          ...(rng() < 0.8 ? { family: pick(rng, FAMILIES_LOCAL) } : {}),
          ...(rng() < 0.8 ? { modelVersion: "v1" } : {}),
          ...(rng() < 0.8 ? { featureVersion: "fv1" } : {})
        }
      });
    } else if (roll < 0.42) {
      out.push({
        type: "CHILD_MESSAGE",
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId,
            runId: "run_simsim01",
            outcome: pick(rng, OUTCOMES),
            verification: { kind: pick(rng, VERIFS) },
            summary: pick(rng, ["tests passed", "did the work\n  with details", "failed to compile", ""]),
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else if (roll < 0.5) {
      out.push({
        type: "CHILD_MESSAGE",
        payload: {
          message: {
            type: "PEER_MESSAGE",
            taskId,
            runId: "run_simsim01",
            body: pick(rng, ["looks fine", "found a bug in this", "missing coverage", "ok"])
          }
        }
      });
    } else if (roll < 0.6) {
      out.push({ type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: pick(rng, ANSWERS) } });
    } else if (roll < 0.7) {
      out.push({
        type: "JUDGE_DECISION",
        runId: "run_simsim01",
        payload: {
          taskId,
          verdict: pick(rng, ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"] as const),
          evidenceIds: rng() < 0.5 ? ["evd_00000002"] : []
        }
      });
    } else if (roll < 0.74) {
      out.push({ type: "RUN_FAILED", runId: "run_simsim01", payload: { reason: "supervisor gave up\n   after retries" } });
    } else {
      out.push({ type: pick(rng, ["LEDGER_UPDATED", "TASK_STATUS_CHANGED", "RUN_STARTED"] as const), payload: {} });
    }
  }
  return out as Event[];
}

/* Retry-heavy routed fixture for S9-E-1 (tracks current model per task to
 * bias genuine same-model retries; also emits nextModelVersion variants). */
function genRetryHeavy(rng: () => number, length: number): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  const models = ["cheap", "premium", "mid"];
  const currentModel = new Map<string, string>();
  out.push({
    type: "PROJECT_DISCOVERED",
    runId: "run_simsim01",
    occurredAt: NOW,
    payload: { project: { id: "prj_simsim01", rootPath: "/tmp/proj-a" } }
  });
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.25) {
      const model = pick(rng, models);
      const complete = rng() < 0.85;
      if (complete) currentModel.set(taskId, model);
      out.push({
        type: "MODEL_ROUTED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          taskId,
          model,
          role: pick(rng, ["actor", ...AGENT_ROLES]),
          eligibleModels: models,
          behaviorDistribution: oneHotDistribution(models, model),
          ...(complete ? { family: pick(rng, FAMILIES_LOCAL) } : {}),
          ...(complete ? { featureVersion: "fv1" } : {}),
          ...(complete ? { modelVersion: "v1" } : {}),
          ...(complete ? { agentRole: pick(rng, [...AGENT_ROLES]) } : {})
        }
      });
    } else if (roll < 0.55) {
      const hasRoute = currentModel.has(taskId);
      const sameModel = hasRoute && rng() < 0.5;
      const nextModel =
        rng() < 0.1
          ? pick(rng, [undefined, "", "  "] as const)
          : sameModel
            ? currentModel.get(taskId)
            : pick(rng, [...models, "fresh"]);
      const vRoll = rng();
      const nextModelVersion =
        vRoll < 0.3 ? undefined : vRoll < 0.5 ? "" : vRoll < 0.75 ? "v1" : "v2";
      if (typeof nextModel === "string" && nextModel.trim() !== "" && hasRoute) {
        currentModel.set(taskId, nextModel);
      }
      out.push({
        type: "TASK_RETRY",
        runId: "run_simsim01",
        occurredAt: NOW,
        taskId: rng() < 0.85 ? taskId : undefined,
        payload: { nextModel, nextModelVersion }
      });
    } else if (roll < 0.8) {
      out.push({
        type: "CHILD_MESSAGE",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId,
            runId: "run_simsim01",
            outcome: pick(rng, OUTCOMES),
            verification: { kind: pick(rng, VERIFS) },
            summary: "tests passed",
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else {
      out.push({
        type: pick(rng, ["USER_ANSWER", "LEDGER_UPDATED", "RUN_STARTED"] as const),
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { answer: "lgtm" }
      });
    }
  }
  return out as Event[];
}

function genSignal(rng: () => number): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    evidenceIds: [],
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3"]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, ["edit", "test", "review"]) } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL"] as const) } : {})
  };
}

/* Verbatim in-lock bandit build replica (R2-E S2-E-3 reference form). */
function banditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") arms.add(signal.modelId);
  }
  const armList = [...arms];
  let state = createBanditState(armList);
  if (previous !== undefined) {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
    if (signal.outcomeKind === "PASS") state = recordReward(state, signal.modelId, 1);
    else if (signal.outcomeKind === "FAIL") state = recordReward(state, signal.modelId, 0);
  }
  return state;
}

/* ================================================================
 * Replicas for S9-E-1: outcomesFromRoutedRun with three applyCascadeRetry
 * variants. Everything else verbatim from from-episode.ts.
 * ================================================================ */
const FAMILIES_REP: readonly TaskFamily[] = [
  "edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"
];
function isCompleteRouteRep(payload: ModelRoutedPayload): boolean {
  return (
    typeof payload.family === "string" &&
    payload.family.trim() !== "" &&
    typeof payload.featureVersion === "string" &&
    payload.featureVersion.trim() !== "" &&
    typeof payload.modelVersion === "string" &&
    payload.modelVersion.trim() !== "" &&
    typeof payload.agentRole === "string"
  );
}
function familyFromRoutedRep(value: string): TaskFamily | undefined {
  return (FAMILIES_REP as readonly string[]).includes(value) ? (value as TaskFamily) : undefined;
}
function outcomeKindFromResultRep(outcome: string, verification: string): "PASS" | "FAIL" | undefined {
  if (verification === "PASSED") return "PASS";
  if (verification === "FAILED") return "FAIL";
  return undefined;
}
/* Verbatim reference. */
function applyCascadeRetryRef(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  const eligible = current.eligibleModels.includes(nextModel)
    ? current.eligibleModels
    : [...current.eligibleModels, nextModel];
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion,
    behaviorDistribution: oneHotDistribution(eligible, nextModel)
  });
}
/* Variant A: dead-store elimination — behaviorDistribution recompute dropped
 * entirely (stale value retained via spread; field is never consumed). */
function applyCascadeRetryDead(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion
  });
}
/* Variant B: same-model no-op retry fast path (original body otherwise). */
function applyCascadeRetryFast(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  if (
    nextModel === current.model &&
    (nextModelVersion === undefined ||
      nextModelVersion.trim() === "" ||
      nextModelVersion === current.modelVersion)
  ) {
    return;
  }
  const eligible = current.eligibleModels.includes(nextModel)
    ? current.eligibleModels
    : [...current.eligibleModels, nextModel];
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion,
    behaviorDistribution: oneHotDistribution(eligible, nextModel)
  });
}
type RetryFn = typeof applyCascadeRetryRef;
function outcomesReplica(events: readonly Event[], retryFn: RetryFn): OutcomeObservation[] {
  const routes = new Map<string, ModelRoutedPayload>();
  const out: OutcomeObservation[] = [];
  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (isCompleteRouteRep(payload)) routes.set(payload.taskId, payload);
      continue;
    }
    if (event.type === "TASK_RETRY") {
      retryFn(routes, event.taskId, event.payload.nextModel, event.payload.nextModelVersion);
      continue;
    }
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    const route = routes.get(message.taskId);
    if (route === undefined) continue;
    const family = familyFromRoutedRep(route.family);
    if (family === undefined) continue;
    const role = route.agentRole;
    if (role === undefined || !isAgentRole(role)) continue;
    const kind = outcomeKindFromResultRep(message.outcome, message.verification.kind);
    if (kind === undefined) continue;
    const failureClass =
      kind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    try {
      out.push(
        parseOutcomeObservation({
          taskFamily: family,
          role,
          modelId: route.model,
          modelVersion: route.modelVersion,
          featureVersion: route.featureVersion,
          criterion: "taskSuccess",
          outcome: kind,
          occurredAtMs: Date.parse(event.occurredAt),
          source: "deterministic-check",
          ...(failureClass !== undefined ? { failureClass } : {}),
          taskId: message.taskId,
          runId: event.runId,
          evidenceIds: message.evidenceIds
        })
      );
    } catch {
      continue;
    }
  }
  return out;
}
/* Counts retries and fast-path-eligible (same-model no-op) retries in a fixture. */
function retryStats(events: readonly Event[]): { retries: number; applied: number; noop: number } {
  const routes = new Map<string, ModelRoutedPayload>();
  let retries = 0;
  let applied = 0;
  let noop = 0;
  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      if (isCompleteRouteRep(event.payload)) routes.set(event.payload.taskId, event.payload);
      continue;
    }
    if (event.type !== "TASK_RETRY") continue;
    retries += 1;
    const { nextModel, nextModelVersion } = event.payload;
    if (event.taskId === undefined || nextModel === undefined || nextModel.trim() === "") continue;
    const current = routes.get(event.taskId);
    if (current === undefined) continue;
    applied += 1;
    if (
      nextModel === current.model &&
      (nextModelVersion === undefined ||
        nextModelVersion.trim() === "" ||
        nextModelVersion === current.modelVersion)
    ) {
      noop += 1;
    }
    applyCascadeRetryRef(routes, event.taskId, nextModel, nextModelVersion);
  }
  return { retries, applied, noop };
}

/* ================================================================
 * Replicas for S9-E-2: collectSignalsFromEvents with and without pass-2
 * consumer prefiltering. createdAt injected for determinism; everything
 * else verbatim from signals.ts (shared leaf helpers imported from
 * production are identical in both variants).
 * ================================================================ */
const PEER_NEGATIVE_REP = /\b(fail|bug|issue|missing|violation|unknown agent|错误)\b/i;
function familyFromRoleRep(role: string | undefined): string | undefined {
  if (role === "critic" || role === "reviewer") return "review";
  if (role === "tester") return "test";
  if (role === "scout") return "research";
  if (role === "planner") return "plan";
  if (role === "actor" || role === "implementer" || role === "worker" || role === "debugger") return "edit";
  return undefined;
}
function truncateRep(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}
interface BaseSignalInput {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: RunId | undefined;
  taskId?: TaskId | undefined;
  modelId?: string | undefined;
  modelVersion?: string | undefined;
  role?: string | undefined;
  family?: string | undefined;
  featureVersion?: string | undefined;
  criterion?: OutcomeCriterion | undefined;
  outcomeKind?: OutcomeKind | undefined;
  evidenceIds?: readonly string[] | undefined;
}
function baseSignalRep(input: BaseSignalInput): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? [],
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.modelVersion !== undefined ? { modelVersion: input.modelVersion } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.featureVersion !== undefined ? { featureVersion: input.featureVersion } : {}),
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(input.outcomeKind !== undefined ? { outcomeKind: input.outcomeKind } : {}),
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  };
}
function signalFromAgentMessageRep(
  message: AgentMessage,
  ctx: {
    projectId: ProjectId;
    modelByTask: ReadonlyMap<string, string>;
    modelVersionByTask: ReadonlyMap<string, string>;
    roleByTask: ReadonlyMap<string, string>;
    familyByTask: ReadonlyMap<string, string>;
    featureVersionByTask: ReadonlyMap<string, string>;
    episodeId?: EpisodeId | undefined;
    createdAt: IsoTimestamp;
  }
): ObservedSignal | undefined {
  if (message.type === "TASK_RESULT") {
    const modelId = ctx.modelByTask.get(message.taskId);
    const role = ctx.roleByTask.get(message.taskId);
    const family = ctx.familyByTask.get(message.taskId) ?? familyFromRoleRep(role);
    const modelVersion = ctx.modelVersionByTask.get(message.taskId);
    const featureVersion = ctx.featureVersionByTask.get(message.taskId);
    const unverified = message.outcome === "SUCCESS" && message.verification.kind === "UNOBSERVED";
    const binding: TaskSuccessRouteBinding = {
      ...(modelId !== undefined ? { modelId } : {}),
      ...(modelVersion !== undefined ? { modelVersion } : {}),
      ...(family !== undefined ? { family } : {}),
      ...(featureVersion !== undefined ? { featureVersion } : {}),
      ...(role !== undefined ? { role } : {})
    };
    const taskSuccess = taskSuccessFromResult(message.outcome, message.verification.kind, binding);
    return baseSignalRep({
      source: "subagent",
      kind: "deterministic",
      projectId: ctx.projectId,
      score: scoreTaskResult(message.outcome, message.verification.kind),
      boundary: "execution",
      summary: truncateRep(
        `${unverified ? "unverified-success " : ""}TASK_RESULT ${message.outcome}: ${message.summary}`
      ),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      evidenceIds: message.evidenceIds,
      ...(taskSuccess !== undefined
        ? {
            criterion: taskSuccess.criterion,
            outcomeKind: taskSuccess.outcomeKind,
            ...(taskSuccess.modelVersion !== undefined ? { modelVersion: taskSuccess.modelVersion } : {}),
            ...(taskSuccess.featureVersion !== undefined
              ? { featureVersion: taskSuccess.featureVersion }
              : {})
          }
        : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(family !== undefined ? { family } : {})
    });
  }
  if (message.type === "PEER_MESSAGE") {
    const score = PEER_NEGATIVE_REP.test(message.body) ? 25 : 65;
    const modelId = ctx.modelByTask.get(message.taskId);
    return baseSignalRep({
      source: "subagent",
      kind: "peer",
      projectId: ctx.projectId,
      score,
      criterion: "policyCompliance",
      outcomeKind: score < 40 ? "FAIL" : "PASS",
      boundary: "review",
      summary: truncateRep(`peer: ${message.body}`),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      ...(modelId !== undefined ? { modelId } : {})
    });
  }
  return undefined;
}
interface CollectContext {
  readonly episodeId?: EpisodeId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly projectRoot?: string | undefined;
}
/* Verbatim two-pass reference (createdAt injected). */
function collectRef(events: readonly Event[], context: CollectContext, createdAt: IsoTimestamp): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      const id = event.payload.project.id;
      projectId = id;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) {
        familyByTask.set(event.payload.taskId, event.payload.family);
      }
      if (event.payload.modelVersion !== undefined) {
        modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      }
      if (event.payload.featureVersion !== undefined) {
        featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
      }
    }
  }
  if (projectId === undefined) return [];

  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const message = event.payload.message;
      const fromResult = signalFromAgentMessageRep(message, {
        projectId,
        modelByTask,
        modelVersionByTask,
        roleByTask,
        familyByTask,
        featureVersionByTask,
        episodeId: context.episodeId,
        createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignalRep({
          source: "user",
          kind: "human",
          projectId,
          score,
          criterion: "userAcceptance",
          outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review",
          summary: truncateRep(`user: ${event.payload.answer}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignalRep({
          source: "deterministic",
          kind: "judge",
          projectId,
          score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED"
              ? "PASS"
              : event.payload.verdict === "REJECTED"
                ? "FAIL"
                : "ABSTAIN",
          boundary: "review",
          summary: `judge ${event.payload.verdict}`,
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId,
          taskId: event.payload.taskId,
          evidenceIds: event.payload.evidenceIds,
          ...(modelId !== undefined ? { modelId } : {}),
          ...(roleByTask.get(event.payload.taskId) !== undefined
            ? { role: roleByTask.get(event.payload.taskId) }
            : {}),
          ...(familyByTask.get(event.payload.taskId) !== undefined
            ? { family: familyByTask.get(event.payload.taskId) }
            : {})
        })
      );
    }
    if (event.type === "RUN_FAILED") {
      signals.push(
        baseSignalRep({
          source: "deterministic",
          kind: "deterministic",
          projectId,
          score: 10,
          boundary: "execution",
          summary: truncateRep(`run failed: ${event.payload.reason}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
  }
  return signals;
}
/* Candidate: pass 1 additionally builds the consumer working set; pass 2
 * iterates only that set. Body of pass 2 identical to reference. */
function collectPre(events: readonly Event[], context: CollectContext, createdAt: IsoTimestamp): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];
  const consumers: Event[] = [];

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      const id = event.payload.project.id;
      projectId = id;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) {
        familyByTask.set(event.payload.taskId, event.payload.family);
      }
      if (event.payload.modelVersion !== undefined) {
        modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      }
      if (event.payload.featureVersion !== undefined) {
        featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
      }
    }
    if (
      event.type === "CHILD_MESSAGE" ||
      event.type === "USER_ANSWER" ||
      event.type === "JUDGE_DECISION" ||
      event.type === "RUN_FAILED"
    ) {
      consumers.push(event);
    }
  }
  if (projectId === undefined) return [];

  for (const event of consumers) {
    if (event.type === "CHILD_MESSAGE") {
      const message = event.payload.message;
      const fromResult = signalFromAgentMessageRep(message, {
        projectId,
        modelByTask,
        modelVersionByTask,
        roleByTask,
        familyByTask,
        featureVersionByTask,
        episodeId: context.episodeId,
        createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(
        baseSignalRep({
          source: "user",
          kind: "human",
          projectId,
          score,
          criterion: "userAcceptance",
          outcomeKind: score >= 50 ? "PASS" : "FAIL",
          boundary: "review",
          summary: truncateRep(`user: ${event.payload.answer}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(
        baseSignalRep({
          source: "deterministic",
          kind: "judge",
          projectId,
          score,
          criterion: "policyCompliance",
          outcomeKind:
            event.payload.verdict === "APPROVED"
              ? "PASS"
              : event.payload.verdict === "REJECTED"
                ? "FAIL"
                : "ABSTAIN",
          boundary: "review",
          summary: `judge ${event.payload.verdict}`,
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId,
          taskId: event.payload.taskId,
          evidenceIds: event.payload.evidenceIds,
          ...(modelId !== undefined ? { modelId } : {}),
          ...(roleByTask.get(event.payload.taskId) !== undefined
            ? { role: roleByTask.get(event.payload.taskId) }
            : {}),
          ...(familyByTask.get(event.payload.taskId) !== undefined
            ? { family: familyByTask.get(event.payload.taskId) }
            : {})
        })
      );
    }
    if (event.type === "RUN_FAILED") {
      signals.push(
        baseSignalRep({
          source: "deterministic",
          kind: "deterministic",
          projectId,
          score: 10,
          boundary: "execution",
          summary: truncateRep(`run failed: ${event.payload.reason}`),
          createdAt,
          episodeId: context.episodeId,
          runId: event.runId
        })
      );
    }
  }
  return signals;
}

/* ================================================================
 * Replicas for S9-E-3: (scoreTaskResult, taskSuccessFromResult) pair vs a
 * merged single-dispatch. Leaf construction (observe/copyDefinedBinding)
 * verbatim and shared by both variants.
 * ================================================================ */
function presentRep(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}
function copyDefinedBindingRep(binding: TaskSuccessRouteBinding | undefined): TaskSuccessRouteBinding {
  if (binding === undefined) return {};
  return {
    ...(presentRep(binding.modelId) ? { modelId: binding.modelId } : {}),
    ...(presentRep(binding.modelVersion) ? { modelVersion: binding.modelVersion } : {}),
    ...(presentRep(binding.family) ? { family: binding.family } : {}),
    ...(presentRep(binding.featureVersion) ? { featureVersion: binding.featureVersion } : {}),
    ...(presentRep(binding.role) ? { role: binding.role } : {})
  };
}
function observeRep(
  outcomeKind: "PASS" | "FAIL",
  binding: TaskSuccessRouteBinding | undefined
): TaskSuccessObservation {
  return {
    criterion: "taskSuccess",
    outcomeKind,
    source: "deterministic",
    ...copyDefinedBindingRep(binding)
  };
}
/* Verbatim reference pair. */
function scoreTaskResultRep(outcome: TaskOutcome, verification: VerificationKind): number {
  if (outcome === "FAILURE" || verification === "FAILED") return 15;
  if (outcome === "CANCELLED") return 25;
  if (verification === "PASSED") return 90;
  if (outcome === "PARTIAL") return 50;
  if (verification === "UNOBSERVED") return 45;
  return 70;
}
function taskSuccessFromResultRep(
  outcome: TaskOutcome,
  verification: VerificationKind,
  binding?: TaskSuccessRouteBinding
): TaskSuccessObservation | undefined {
  if (outcome === "PARTIAL" || outcome === "CANCELLED") return undefined;
  if (verification !== "PASSED" && verification !== "FAILED") return undefined;
  return observeRep(verification === "PASSED" ? "PASS" : "FAIL", binding);
}
function refPair(
  outcome: TaskOutcome,
  verification: VerificationKind,
  binding?: TaskSuccessRouteBinding
): { score: number; ts: TaskSuccessObservation | undefined } {
  return {
    score: scoreTaskResultRep(outcome, verification),
    ts: taskSuccessFromResultRep(outcome, verification, binding)
  };
}
/* Candidate: single merged dispatch producing both outputs. */
function mergedPair(
  outcome: TaskOutcome,
  verification: VerificationKind,
  binding?: TaskSuccessRouteBinding
): { score: number; ts: TaskSuccessObservation | undefined } {
  let score: number;
  let kind: "PASS" | "FAIL" | undefined;
  if (verification === "FAILED") {
    score = 15;
    kind = outcome === "PARTIAL" || outcome === "CANCELLED" ? undefined : "FAIL";
  } else if (verification === "PASSED") {
    score = outcome === "FAILURE" ? 15 : outcome === "CANCELLED" ? 25 : 90;
    kind = outcome === "PARTIAL" || outcome === "CANCELLED" ? undefined : "PASS";
  } else {
    score =
      outcome === "FAILURE"
        ? 15
        : outcome === "CANCELLED"
          ? 25
          : outcome === "PARTIAL"
            ? 50
            : verification === "UNOBSERVED"
              ? 45
              : 70;
    kind = undefined;
  }
  return { score, ts: kind === undefined ? undefined : observeRep(kind, binding) };
}

/* ================================================================
 * SECTION 1: SLICE-CPU anchor re-verify + configured-state matrix cells.
 * ================================================================ */
{
  const events = genCollectEvents(mulberry32(0xe99e01), 40, true);
  const routed = genRetryHeavy(mulberry32(0xe99e02), 40);
  const sigRng = mulberry32(0xe99e03);
  const signals = Array.from({ length: 12 }, () => genSignal(sigRng));
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const prevSeed = Array.from({ length: 30 }, () => genSignal(sigRng));
  const previous = banditBuild(undefined, prevSeed);

  const collect = bench(() => void collectSignalsFromEvents(events, {}), 20000);
  const outcomes = bench(() => void outcomesFromRoutedRun(routed), 20000);
  const diagnose = bench(() => void diagnoseModelProjectIssues(signals), 40000);
  const bandit = bench(() => void banditBuild(previous, signals), 40000);
  const total = collect + outcomes + diagnose + bandit;
  console.log(
    `BENCH SLICE-CPU anchor re-verify: collect=${(collect * 1e3).toFixed(1)}us outcomes=${(outcomes * 1e3).toFixed(1)}us diagnose=${(diagnose * 1e3).toFixed(2)}us bandit-build=${(bandit * 1e3).toFixed(1)}us | total in-slice CPU ~${(total * 1e3).toFixed(1)}us per run vs landing bar >=10000us (${Math.round(10 / total)}x below even if zeroed)`
  );

  // Configured-state matrix: nonempty learned policy vs empty policy.
  const catalog10 = models10;
  const learned10: LearnedRoutingPolicy = {
    primaryModelId: "m0",
    avoid: Array.from({ length: 10 }, (_, i) => ({
      modelId: `m${i % 5}`,
      reason: "r",
      ...(i % 2 === 0 ? { family: ["edit", "test", "review", "plan", "research"][i % 5]! } : {})
    })),
    prefer: [{ family: "edit", modelId: "m1" }]
  };
  const learnedEmpty: LearnedRoutingPolicy = { primaryModelId: "m0", avoid: [], prefer: [] };
  const applyCost = bench(() => void applyLearnedRouting("edit", catalog10, "m2", learned10), 100000);
  const applyEmptyCost = bench(() => void applyLearnedRouting("edit", catalog10, "m2", learnedEmpty), 100000);
  console.log(
    `BENCH configured-state anchor: applyLearnedRouting(avoid=10, M=10)=${(applyCost * 1e6).toFixed(0)}ns/task | empty policy=${(applyEmptyCost * 1e6).toFixed(0)}ns/task -> x10 tasks/run = ${(applyCost * 10 * 1e3).toFixed(2)}us/run (live face with learned policy loaded)`
  );
}

/* Configured-state matrix: loadLearnedRouting fresh vs realistic registry
 * (production call-site absolute anchor; same fixture as R8-E S8-E-1). */
{
  const freshRoot = await mkdtemp(join(tmpdir(), "r9e-fresh-"));
  const freshCost = await benchAsync(async () => {
    await loadLearnedRouting(freshRoot, "/tmp/proj-r9e");
  }, 200);

  const stateRoot = await mkdtemp(join(tmpdir(), "r9e-reg-"));
  const projectRoot = "/tmp/proj-r9e";
  const registry = await loadAdaptationRegistryOrNew(stateRoot);
  const identity = routingPolicyIdentity(projectRoot);
  const parent = ensureRoutingBaseline(registry, identity, "premium", "r9e-sim");
  const policy: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "meanScore 0.30 over 6 samples" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
  registry.createCandidate({
    identity,
    content: routingPolicyContent(policy),
    parentVersionId: parent.versionId,
    author: { kind: "detector", identity: "r9e-sim" },
    evaluationPlan: { stages: ["static", "replay"], metrics: ["task-success", "cost"], planVersion: 1 }
  });
  await saveAdaptationRegistry(stateRoot, registry);
  const loaded = await loadLearnedRouting(stateRoot, projectRoot);
  check("matrix registry fixture yields an active policy", loaded !== undefined);
  const realCost = await benchAsync(async () => {
    await loadLearnedRouting(stateRoot, projectRoot);
  }, 200);
  console.log(
    `BENCH configured-state anchor: loadLearnedRouting fresh-root(ENOENT)=${(freshCost * 1e3).toFixed(1)}us | realistic registry (baseline+1 candidate)=${(realCost * 1e3).toFixed(1)}us (once-per-run production call-site cost)`
  );
}

/* ================================================================
 * SECTION 2: S9-E-1 equivalence fuzz + bench.
 * ================================================================ */
{
  let fixtures = 0;
  let totalRetries = 0;
  let totalApplied = 0;
  let totalNoop = 0;
  const rng = mulberry32(0xe99e04);
  for (let i = 0; i < 400; i += 1) {
    const length = 10 + Math.floor(rng() * 70);
    const seed = Math.floor(rng() * 0xffffffff);
    const events = genRetryHeavy(mulberry32(seed), length);
    fixtures += 1;
    const stats = retryStats(events);
    totalRetries += stats.retries;
    totalApplied += stats.applied;
    totalNoop += stats.noop;
    const prod = outcomesFromRoutedRun(events);
    const ref = outcomesReplica(events, applyCascadeRetryRef);
    eq(`S9-E-1 replica fidelity #${i}`, prod, ref);
    eq(`S9-E-1 dead-store variant #${i}`, ref, outcomesReplica(events, applyCascadeRetryDead));
    eq(`S9-E-1 fast-path variant #${i}`, ref, outcomesReplica(events, applyCascadeRetryFast));
  }
  console.log(
    `VERDICT S9-E-1 equivalence: ${fixtures} fixtures, retries=${totalRetries} applied=${totalApplied} same-model-noop=${totalNoop} (${((totalNoop / Math.max(totalApplied, 1)) * 100).toFixed(1)}% of applied), all 3x${fixtures} deepStrictEqual checks passed=${failures === 0}`
  );

  // Bench replica-vs-replica on a fixed retry-heavy fixture.
  const benchEvents = genRetryHeavy(mulberry32(0xe99e05), 40);
  const bStats = retryStats(benchEvents);
  const refCost = bench(() => void outcomesReplica(benchEvents, applyCascadeRetryRef), 30000);
  const deadCost = bench(() => void outcomesReplica(benchEvents, applyCascadeRetryDead), 30000);
  const fastCost = bench(() => void outcomesReplica(benchEvents, applyCascadeRetryFast), 30000);
  console.log(
    `BENCH S9-E-1 (E=40, retries=${bStats.retries}, applied=${bStats.applied}, noop=${bStats.noop}): ref=${(refCost * 1e3).toFixed(2)}us dead-store=${(deadCost * 1e3).toFixed(2)}us (delta=${((refCost - deadCost) * 1e6).toFixed(0)}ns/run) fast-path=${(fastCost * 1e3).toFixed(2)}us (delta=${((refCost - fastCost) * 1e6).toFixed(0)}ns/run) | per applied retry dead-store saves ~${(((refCost - deadCost) / Math.max(bStats.applied, 1)) * 1e6).toFixed(0)}ns`
  );
}

/* ================================================================
 * SECTION 3: S9-E-2 equivalence fuzz + bench.
 * ================================================================ */
{
  const rng = mulberry32(0xe99e06);
  let fixtures = 0;
  for (let i = 0; i < 400; i += 1) {
    const length = 10 + Math.floor(rng() * 70);
    const seed = Math.floor(rng() * 0xffffffff);
    const withProject = rng() < 0.9;
    const ctxProject = rng() < 0.3 ? ("prj_ctxctx01" as ProjectId) : undefined;
    const events = genCollectEvents(mulberry32(seed), length, withProject);
    const context: CollectContext = {
      ...(ctxProject !== undefined ? { projectId: ctxProject } : {}),
      ...(rng() < 0.5 ? { episodeId: "epi_00000001" as EpisodeId } : {})
    };
    fixtures += 1;
    const prodNorm = collectSignalsFromEvents(events, context).map((s) => ({ ...s, createdAt: NOW }));
    const ref = collectRef(events, context, NOW);
    eq(`S9-E-2 replica fidelity #${i}`, prodNorm, ref);
    eq(`S9-E-2 prefilter variant #${i}`, ref, collectPre(events, context, NOW));
  }
  console.log(`VERDICT S9-E-2 equivalence: ${fixtures} fixtures (incl. no-project and ctx-project cases), all 2x${fixtures} deepStrictEqual checks passed=${failures === 0}`);

  const ev40 = genCollectEvents(mulberry32(0xe99e07), 40, true);
  const ev400 = genCollectEvents(mulberry32(0xe99e07), 400, true);
  const ref40 = bench(() => void collectRef(ev40, {}, NOW), 20000);
  const pre40 = bench(() => void collectPre(ev40, {}, NOW), 20000);
  const ref400 = bench(() => void collectRef(ev400, {}, NOW), 2000);
  const pre400 = bench(() => void collectPre(ev400, {}, NOW), 2000);
  console.log(
    `BENCH S9-E-2 (replica-vs-replica): E=40 ref=${(ref40 * 1e3).toFixed(1)}us prefilter=${(pre40 * 1e3).toFixed(1)}us (delta=${((ref40 - pre40) * 1e6).toFixed(0)}ns/run) | E=400 ref=${(ref400 * 1e3).toFixed(1)}us prefilter=${(pre400 * 1e3).toFixed(1)}us (delta=${((ref400 - pre400) * 1e6).toFixed(0)}ns/run)`
  );
}

/* ================================================================
 * SECTION 4: S9-E-3 equivalence (full truth table + fuzz) + bench.
 * ================================================================ */
{
  const bindings: (TaskSuccessRouteBinding | undefined)[] = [
    undefined,
    {},
    { modelId: "m1", modelVersion: "v1", family: "edit", featureVersion: "fv1", role: "actor" },
    { modelId: "  ", modelVersion: "", family: "edit" },
    { modelId: "m1", role: undefined, family: undefined },
    { role: "tester" }
  ];
  let combos = 0;
  for (const outcome of OUTCOMES) {
    for (const verification of VERIFS) {
      for (const binding of bindings) {
        combos += 1;
        const prod = {
          score: scoreTaskResult(outcome, verification),
          ts: taskSuccessFromResult(outcome, verification, binding)
        };
        const ref = refPair(outcome, verification, binding);
        eq(`S9-E-3 replica fidelity ${outcome}/${verification}/${combos}`, prod, ref);
        eq(`S9-E-3 merged ${outcome}/${verification}/${combos}`, ref, mergedPair(outcome, verification, binding));
      }
    }
  }
  const rng = mulberry32(0xe99e08);
  let fuzzed = 0;
  for (let i = 0; i < 2000; i += 1) {
    const outcome = pick(rng, OUTCOMES);
    const verification = pick(rng, VERIFS);
    const binding: TaskSuccessRouteBinding | undefined =
      rng() < 0.2
        ? undefined
        : {
            ...(rng() < 0.7 ? { modelId: pick(rng, ["m1", "", "  ", "m2"]) } : {}),
            ...(rng() < 0.5 ? { modelVersion: pick(rng, ["v1", ""]) } : {}),
            ...(rng() < 0.6 ? { family: pick(rng, ["edit", "test", " "]) } : {}),
            ...(rng() < 0.4 ? { featureVersion: "fv1" } : {}),
            ...(rng() < 0.6 ? { role: pick(rng, ["actor", "tester", ""]) } : {})
          };
    fuzzed += 1;
    eq(
      `S9-E-3 fuzz #${i}`,
      {
        score: scoreTaskResult(outcome, verification),
        ts: taskSuccessFromResult(outcome, verification, binding)
      },
      mergedPair(outcome, verification, binding)
    );
  }
  console.log(
    `VERDICT S9-E-3 equivalence: ${combos} exhaustive truth-table combos (12 outcome x verification pairs x 6 binding variants) + ${fuzzed} fuzz, all passed=${failures === 0}`
  );

  // Bench: mixed input stream (realistic megamorphic call site).
  const inputs: { o: TaskOutcome; v: VerificationKind; b: TaskSuccessRouteBinding | undefined }[] = [];
  const bRng = mulberry32(0xe99e08 ^ 0x5a5a);
  for (let i = 0; i < 64; i += 1) {
    inputs.push({
      o: pick(bRng, OUTCOMES),
      v: pick(bRng, VERIFS),
      b: pick(bRng, bindings)
    });
  }
  let sink = 0;
  const pairCost = bench(() => {
    for (const input of inputs) {
      const r = refPair(input.o, input.v, input.b);
      sink += r.score;
    }
  }, 20000);
  const mergedCost = bench(() => {
    for (const input of inputs) {
      const r = mergedPair(input.o, input.v, input.b);
      sink += r.score;
    }
  }, 20000);
  check("S9-E-3 sink consumed", sink !== 0);
  console.log(
    `BENCH S9-E-3 (replica-vs-replica, 64 mixed inputs/iter): pair=${((pairCost / 64) * 1e6).toFixed(1)}ns/call merged=${((mergedCost / 64) * 1e6).toFixed(1)}ns/call delta=${(((pairCost - mergedCost) / 64) * 1e6).toFixed(1)}ns/call -> x10 TASK_RESULT/run = ${(((pairCost - mergedCost) / 64) * 10 * 1e6).toFixed(0)}ns/run`
  );
}

console.log(`VERDICT total equivalence checks: ${checks}, failures: ${failures}`);
if (failures > 0) {
  console.error(`${failures} EQUIVALENCE CHECK(S) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

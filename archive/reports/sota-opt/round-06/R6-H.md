MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第六遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `9b17a8a`（独占 tip，含 S6-C / S5-I-1 / S5-F / S5-C 及 R6-E 排除 S6-E-1..5）
**分支:** `cursor/r6-h-eval-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 21 个文件
（1750 行）自 R1-H 基线（`fd437a9`）以来**逐字节未变**（`git diff
fd437a9..9b17a8a -- src/{evaluation,requirement,review,rubric}/` 为空，
同范围零提交），且 R5-H 基线（`d350722`）之后 `src/` 仅落地 S6-C
（`routing/offline-logit.ts`）、S5-I-1（`cli/main.ts`）、S5-F
（`experiments/plan.ts` 链），均不 import 本切片 ⇒ 生产调用方地图
**可证不变**，本轮全库 import 交叉检索再次确认（8 个导入位点与
R3-H/R4-H/R5-H 完全一致，各入口频次仍为每 run / 每晋升一次）。按指令对
R5-H §1 的 9.2–9.5µs/run 上界做了**实测复核而非沿用**：本 VM 三次独立
运行测得 JIT 热稳态切片全部生产入口每 run 合计 **5.6–6.3µs**（落在五轮
历史跨 VM 带 4.5–10µs 内）。第六遍在完整排除表（S1-H-1..9、S2-H-1..7、
S3-H-1..4、S4-H-1..3、S5-H-1..3 及五轮 20+ 处不立 ID 收口）之上补测了
最后一个未量化的成本层——**执行层级**（解释器冷首调 vs JIT 热稳态）：
生产入口每 run 恰执行一次 = 每进程一次，即永远跑在未优化层；dist 产物、
新进程、模块加载预扣除后实测首调合计中位数 **1.65–1.71ms**（第二调
~320–375µs，热稳态 ~6µs）——这才是诚实的每 run 上界，但它 (a) 属门槛
第 3 条明文否决的 once-per-process CLI 噪声类，(b) 仍低于落地线（数十~
数百 ms）一个数量级，(c) 本质是首调编译/分层成本，任何保语义重写照付。
在此之上枚举得 4 个此前未点名的新候选（S6-H-1 … S6-H-4），全部经理论 +
确定性仿真（seeded mulberry32，~19,500 项等价/逐位检查 + 真实/压力双端
基准，三次独立运行裁决逐位一致、计时方向稳定）裁决后淘汰：全部等价，
但真实规模收益钉死在 once-per-run 的 21–853ns 区间（低于落地线四个数量
级以上）；其中 S6-H-1 的「零守卫费」理论在冲突侧压力被测量层推翻（三次
稳定 −0.9~−2.1µs，S5-H-1 教训的回声），S6-H-2/3 各需复制门控/映射逻辑
（X0-5 单实现邻域）或收窄公开形状。未重开任何 X* / S1-* / S2-* / S3-* /
S4-* / S5-* / S6-* 条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第六遍实际读码。
  上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts` 只读取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含 S6-A/B/C/D/E
  全部新条目）/ round-06/PLAN.md / round-01/R1-H.md … round-05/R5-H.md。
  候选枚举刻意绕开全部既有排除，特别核对未触碰：S5-H-1（detectConflicts
  **分配前双 some 守卫**——S6-H-1 是过滤器**之间**的顺序早退，无任何
  重复扫描，机制不同，见 §3.1）、S5-H-2 / S5-E-5 / S5-I-*（惰性 import
  与模块图已收口——本轮执行层级测量是**函数首调编译成本**，与模块加载
  是不同层，未重开）、S5-H-3（hashArtifact 维持零候选）、S1-H-1 / S4-H-1
  （checkCoverageGate keys 行三面钉死维持——S6-H-2 删的是矩阵构建器的
  **taskToChecks 死输出**，不触 keys 行）、S1-H-2（gated 拷贝**条件跳过**
  ——S6-H-3 是**无条件融合消除**，机制不同，见 §3.3）、S1-H-9 / S2-H-4 /
  S3-H-4（changeSetsEqual 三面钉死维持，本轮零候选）、S1-H-8 / S2-H-6
  （registerRubric 维持）、X4-9 / X0-5 / X0-6。
- R5-H §1 的 9.2–9.5µs/run 上界按指令**先复核后引用**：本报告 §1 以三次
  独立实测在本 VM 重建热稳态锚点（5.6–6.3µs/run），并新增冷层锚点
  （1.65–1.71ms 首调），未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、双 LCB 与双归因保留、阈值/权限/数据面契约/公开签名
  不变、测试未改，天然成立。不声称 Outcome-supported，Checkpoint F-PROD
  仍开放（ADR-005）。
- lint 在独占 tip 上本就全绿，无需触碰任何继承脚本（未做 console.* 替换）。

## 1. 基线不变性、调用图复核与上界重测（热层 + 新增冷层）

1. **切片逐字节未变**：`git diff fd437a9..9b17a8a -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交。R1-H 逐函数下界表、R2-H 上界论证、
   R3-H 重复工作枚举、R4-H 三类角度收口、R5-H 三层级收口与全部 S*-H-*
   排除继承有效。
2. **调用图可证不变**：`git log d350722..9b17a8a -- src/` 仅含 S6-C
   （`routing/offline-logit.ts`）、S5-I-1（`cli/main.ts`）、S5-F
   （`experiments/` 计划校验）三组落地，无一 import 本切片。本轮全库
   import 检索双确认（8 位点，频次逐一复核）：
   `assertCoverageAllowsStart` ← `run/{supervisor,coordinator,flowchart-run}.ts`
   （每 run 启动一次，且仅当 `input.contract !== undefined`）；
   `extractHeuristicContract` ← `track/clarify.ts`（每 run 一次）；
   `applyPrecedence` ← `track/loop.ts`（每 run 一次，`"user-first"`）；
   `shouldScout` ← `track/plan.ts`（每 run 一次）；
   `assertCanPromoteFromReview` ← `adaptation/promotion-rules.ts`（每晋升
   一次）；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（仅类型导入与测试引用）。S5-I-1
   使 `track/loop` 子树改为 dispatch 时点加载，只移动切片模块的**加载
   时机**，不改每 run 执行成本与本节频次。
3. **热层上界锚点重测**（指令要求，三次运行区间，本 VM）：

```text
CEILING re-verify (JIT-warm): extractHeuristicContract=4678-5332ns
  + run-start gate=659-699ns + applyPrecedence=230-236ns
  = 5595-6263ns once-per-run production total
  -> slice gain ceiling 5.6-6.3µs/run（战役落地线：数十~数百 ms）
```

   复核结论：低于 R5-H 的 9.2–9.5µs，落在五轮历史跨 VM 带（4.5–10µs）
   内，属测量环境差异而非调用图变更（§1.2 已证零变更）。
4. **冷层（执行层级）锚点——第六遍新增的最后一个成本层**：前五轮全部
   测 JIT 热稳态，但生产入口每 run 恰执行一次 = 每进程一次，永远跑在
   Ignition 解释器/基线层（含首调字节码编译、RegExp 编译、隐藏类初建）。
   dist 产物、新进程、模块加载预扣除后（5 进程 ×3 轮）：

```text
TIER cold: first-call extract=1428-1609µs + gate=132-144µs + precedence=72-184µs
  -> median first-call production total = 1651 / 1674 / 1714 µs（区间 1638-1831µs）
  second call (same process) extract = 317-375µs; warm steady state ~5-6µs
```

   这才是诚实的每 run 收益上界：≈**1.7ms once-per-process**。三重否决
   任何据此立项的候选：(a) 门槛第 3 条明文把 once-per-process CLI 噪声
   列为否决类（S5-H-2 的 2.2–2.4ms 模块加载、S5-E-5 的 2.8–3.0ms 同类
   同判）；(b) 绝对量仍低于落地线一个数量级；(c) 该成本主体是**首调
   编译/分层成本而非算法成本**——任何保语义的切片重写在新进程里照样
   逐函数首调编译，不可经源码微编辑消除（消除路径是 snapshot/SEA/
   bytecode 缓存级的工程，超出本切片且属 CLI 启动预算议题 = S5-H-2
   重开条件原文管辖）。至此调用图（热）、模块图（加载）、执行层级
   （冷编译）三个进程级成本面全部有实测锚点。门槛第 3 条在本切片当前
   调用图下**结构上不可满足**的结论获得第三层证据。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-H-1 | `detectConflicts` 过滤器间顺序早退：`fast` 过滤结果为空即 `return []`，**跳过整个 slow 过滤**。与 S5-H-1（分配前**额外**双 `some` 预守卫，命中侧付「守卫费」被淘汰）机制不同：本条以第一个过滤器自身的结果为守卫，**任何路径都不存在重复扫描**，纸面上对每个输入都严格 ≤ 现行工作量（仅多一次长度分支）。生产 heuristic 合同两条 observableCheck 均无 fast 关键词 ⇒ 恒走跳过分支（省 1 次全量 filter + 1 次数组分配） | 无冲突（fast 空）路径省 Θ(C) 扫描 + 1 分配；其余路径逐指令等量 | ✅ 6000 fuzz（含 fast∧slow 双命中、slow-only、重复 id）+ slow-only 定向 + 生产合同形状定向（确认恒走跳过分支）逐字节一致 | 真实 C=2 省 **133–136ns**/run（249→115ns，once per run，applyPrecedence 全函数仅 242–243ns）；压力 C=469 无 fast 侧 +20.6~21.5µs；**冲突侧三次全部更慢 −0.9~−2.1µs**（38→40µs） | 淘汰：真实规模亚 µs once-per-run 噪声（占 §1 热层锚点 ~2%）+ 冲突侧压力**测量层**负优化——「零守卫费」在指令层成立但代码布局/分支结构层不成立（S5-H-1 对偶教训的回声，见 §3.1）；两端非同向 ⇒ 与 S5-H-1 同判并列钉死该函数的守卫方向 |
| S6-H-2 | run-start 门控组合内 `taskToChecks` 死计算跳过：`coverageMatrixFromTasks` 对每 task 构建 `mapped` 数组并写 `taskToChecks[task.id]`，但 `checkCoverageGate` **从不读取该字段**，且在 `assertCoverageAllowsStart` 内矩阵是局部值用完即弃 ⇒ 该组合内 taskToChecks 可证死工作。候选：门控私有构建器跳过之 | 免 T 次数组分配 + T 次 record 写 + C×T 次 push | ✅ 6000 fuzz（contract×tasks×options 全格，含 stray 准则、skip-contract、空 options 数组）throw parity 逐字节一致 + **Proxy 迹死性证明**：2000 例中 checkCoverageGate 触碰的矩阵属性恰为 {orphanRequirements, requirementToTasks}，taskToChecks 零读取 | 真实 C=2 / 5 tasks 省 **127–166ns**/run（~663→~516ns，once per run start）；压力 200 tasks（超真实两个量级）才 +10.0~11.1µs | 淘汰：真实规模亚 µs once-per-run 噪声；且实现两难——门控私有并行构建器复制映射循环（X0-5 单实现邻域，S5-H-3 同型两难），收窄公开 `CoverageMatrix` 输出形状则是公开面变更；`coverageMatrixFromTasks` 是公开导出，taskToChecks 对其他潜在调用方是契约输出 |
| S6-H-3 | `assertCoverageAllowsStart` **无条件**消除 gated 合同拷贝：把问题决议融合进 blocking 扫描（effective default 内联），矩阵改用**原合同**构建（gating 只替换 `questions`；矩阵构建只读 `acceptanceCriteria`+`schemaVersion`）。与 S1-H-2（**条件**跳过拷贝、保留 checkCoverageGate 调用）机制不同：拷贝永不发生，但门逻辑（uncovered/blocking/消息拼装）须在公开 `checkCoverageGate` 之外复制一份 | 免 1 次对象 spread + 1 次 questions map 数组（恒发生，不止无决议时） | ✅ 6000 fuzz throw parity 逐字节一致 + 定向边缘：已决议问题 `options[0] === ""` 时 gated default 为假值 ⇒ **两侧都保持 blocking**（融合最易悄悄改错的点） | 省 **21–45ns**/run（once per run start；三次方向一致但深入抖动带） | 淘汰：深度亚噪声（占门控全函数 ~4–7%）+ 门逻辑二份复制违背 checkCoverageGate 单实现意图（X0-5 邻域；S3-H-1 「builder 侧唯一强制验证」同向裁决）——收益不抵回归面 |
| S6-H-4 | `extractHeuristicContract` 每调用重建 extractor/critic **角色对象** → 模块级单例（critic 恒可单例；extractor 在 habits 为空形状时单例）。与 R2-H 不立 ID 收口的「问题/约束**数据字面量**提升」不同：那些字面量流入返回合同（共享实例身份可观察），角色对象**从不逃逸** `buildContractCandidate`——公开面只暴露 roleId 字符串 ⇒ 单例身份不可观察。两对象均为无状态闭包，非结果缓存 ⇒ 无 X1-1 陈旧性问题，败点纯在量级 | 免 2 次对象 + 闭包分配（含 async 方法闭包） | ✅ 1500 组全链 fuzz（6 objective × habits 全格含 undefined 字段）ContractCandidate 全载荷逐字节一致 | 省 **466–853ns**/run（6.0–6.2µs→5.4–5.5µs，本轮最大单点，占提取链 ~8–14%），once per run | 淘汰：亚 µs once-per-run 噪声（低于落地线四个数量级）；且 clarify 生产路径带偏好 habits 时 extractor 仍须每调用新建（单例只覆盖无偏好档），有效收益更低；X1-1 邻域的模块级对象虽经论证安全，无收益支撑不值引入 |

另有五处以既有排除/前轮收口直接覆盖、不立新 ID：`heuristicExtractor.extract`
的 `objective.trim()` 与 `isVague` 内重复 trim（S1-H-3 重复求值家族，
ns 级）；`checkCoverageGate` 的 `matrix.requirementToTasks` 每准则双属性
读 CSE（S5-J-5 族 ~10ns）；`Object.keys` 提升为**数组**（非 Set）的
S1-H-1 噪声带姊妹形式（其真实规模基准直接覆盖，未重开）；
`createTrustedSource` 的 `Object.freeze`（once-per-run 百 ns 级，冻结是
TRUSTED_SOURCE 信任标记的防篡改语义本体）；`detectConflicts` 每准则
isFast/isSlow 各一次 `toLowerCase` 的 CSE（被 S1-H-5 融合案的量级裁决
支配）。第六遍对 21 文件逐一重扫**再未发现任何未被六轮排除表覆盖的
结构**。

## 3. 关键裁决细节

### 3.1 S6-H-1：「零守卫费」在指令层成立、在测量层不成立——守卫方向的第二面钉死

S5-H-1 的分配前双 `some` 守卫败于命中侧的显式重复扫描（守卫费）。本轮
构造其修正形式：以第一个过滤器自身的输出为守卫（fast 空 ⇒ slow 过滤
可证不可达），指令层严格无重复——命中侧只多一次已物化数组的长度分支。
6000 fuzz + 定向全部逐字节等价。但冲突侧压力基准三次运行**全部更慢**
（−938/−1711/−2075ns，2–5%）：提前 return 把单一直线体切成两个基本块，
V8 的代码布局/分支预测代价吃掉了纸面「免费」。真实规模（生产恒走跳过
分支）省 133–136ns/run，once per run，占热层锚点 ~2%——深入战役噪声带。
与 S5-H-1 合并结论：`detectConflicts` 的守卫方向现在两面钉死——显式
预守卫付扫描费（S5-H-1），隐式序贯守卫付布局费（本条）；除非合同规模
增长 ≥2 个量级**且**流量分布被版本化为「无冲突为主」，该函数维持现状
即为 SOTA。

### 3.2 S6-H-2：Proxy 迹把「死工作」从推断升级为证明——但两条落地路都撞墙

第六遍的新枚举角度是**组合内死输出**：公开函数的输出字段在特定组合里
从不被消费。`coverageMatrixFromTasks` 的 `taskToChecks` 恰是全切片唯一
一例——`checkCoverageGate` 只读 `orphanRequirements` 与
`requirementToTasks`（2000 例 Proxy 属性迹零 taskToChecks 读取，把 R1-H
以来的代码阅读推断升级为机器证明），且 `assertCoverageAllowsStart` 内
矩阵局部即弃。但删除它的两条路都撞既有墙：门控私有并行构建器 = 映射
循环复制两份（X0-5「集中单实现」邻域，与 S5-H-3 的哈希循环复制两难
同型）；收窄公开输出形状 = `CoverageMatrix` 是 `domain/contract.ts` 的
公开类型且 `coverageMatrixFromTasks` 是公开导出，对切片外潜在调用方
taskToChecks 是契约。量级本身也已判死：真实 T≤6 时 127–166ns/run。
Proxy 迹证据留档：若未来矩阵构建进入每 turn 热路径且 T 增长 ≥2 个
量级，本条可凭该证明直接重开，落地路线应为「公开新增门控专用轻量
构建器并让 assertCoverageAllowsStart 消费之」而非复制循环。

### 3.3 S6-H-3：无条件融合比条件跳过更彻底——也更彻底地不值得

S1-H-2 只在「无问题会被 default」时跳过 gated 拷贝（保留公开门函数
调用）；本条把决议语义（`default !== undefined ? default : resolved ?
options[0] ?? "resolved" : undefined`）内联进 blocking 扫描，拷贝永不
发生，矩阵直接用原合同构建（gating 只动 questions，矩阵只读
acceptanceCriteria/schemaVersion——本轮以 fuzz + 代码路径双确认）。
最易改错的边缘（已决议问题 `options[0] === ""` ⇒ gated default 为空串
⇒ `!q.default` 判 blocking）经定向探针两侧一致保持 blocking。但收益
21–45ns/run——比 S1-H-2 的 75–111ns 还低（拷贝本身只值几十 ns，融合
额外省的只有 map 数组），而代价是把 uncovered/blocking/消息拼装三段
门逻辑在 `checkCoverageGate` 之外复制一份，未来任何门语义演进要改两处。
S3-H-1 裁决「builder 侧唯一强制验证不可动」同向：门的单实现价值高于
几十 ns。

### 3.4 S6-H-4：本轮最大单点（~0.5–0.9µs）恰好画出切片噪声带的顶

角色对象单例化是六轮以来该切片测得的最大单点节省（466–853ns/run，
占提取链 8–14%）——它仍低于战役落地线**四个数量级**。裁决要点有三：
其一，身份安全性经论证成立（extractor/critic 从不逃逸
buildContractCandidate，公开面只见 roleId 字符串；与 R2-H 否决的数据
字面量提升不同——那些对象流入返回合同）；其二，有效收益低于测得值
（clarify 从偏好档取 habits，非空时 extractor 仍每调用新建；单例只
覆盖零偏好档）；其三，X1-1 邻域的模块级对象即使无陈旧性，也是一份
需要长期审校「保持无状态」的隐性契约。三点合并：等价性证据留档，
量级不赦免。本条同时给后续轮次立锚：**本切片 once-per-run 面上任何
候选的收益天花板 ≈ 角色对象分配级（亚 µs）**，比落地线低四个数量级，
再无枚举价值。

### 3.5 第六遍收口：热层、加载层之外补上冷层——三个进程级成本面全部实测

R1-H 证逐函数渐近下界，R2-H 证调用图收益上界，R3-H 枚举尽重复工作与
分配削减，R4-H 收口内建换写/跨模块去重/局部可变化，R5-H 补分配前守卫/
模块图冷加载/Θ(字节) 内存流量，本轮补最后一层：**执行层级**——生产
入口 once-per-process 的现实使 JIT 热稳态数字（5.6–6.3µs）系统性低估
真实每 run 成本（首调 1.65–1.71ms，第二调仍 ~330µs），但该成本 (a) 属
门槛明文否决的 once-per-process 类，(b) 主体是首调编译而非算法工作，
源码微编辑不可消除。至此单函数、函数间、跨模块、调用图、模块图、
执行层级六个成本面全部有实测锚点与排除收口。重开该切片的唯一前提
维持 R4-H/R5-H 收口原文：调用图变更（evaluation/review/rubric 面接入
每 turn 热路径，或合同规模增长 ≥2 个量级）。

## 4. 逐文件收口（第六遍新视角，其余与 R1-H…R5-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/precedence.ts` | 过滤器间顺序早退（S6-H-1）；每准则双 toLowerCase CSE（S1-H-5 量级覆盖，不立 ID）；S5-H-1/S1-H-5/S4-H-2 维持未重开 | S6-H-1 淘汰 |
| `requirement/coverage.ts` | 组合内死输出 taskToChecks（S6-H-2，Proxy 迹证明）；无条件 gated 拷贝融合消除（S6-H-3，含空 options[0] 边缘）；requirementToTasks 双属性读 CSE 与 keys 数组提升形式（不立 ID）；S1-H-1/2、S4-H-1 三面钉死维持 | S6-H-2 / S6-H-3 淘汰 |
| `requirement/heuristic.ts` | 角色对象单例化（S6-H-4）；重复 trim（S1-H-3 族，不立 ID）；S3-H-3 子集正则短路维持未重开 | S6-H-4 淘汰 |
| `requirement/normalizer.ts` | createTrustedSource 的 Object.freeze（防篡改语义本体，不立 ID）；S2-H-7 默认 origin 守卫维持 | 无新候选 |
| `requirement/extractor.ts` / `critic.ts` / `provenance.ts` | S2-H-1/2、S3-H-1/2、S5-A-1 邻域维持；findUnsourcedItems 收口维持 | 无新候选 |
| 切片生产入口执行层级 | 冷首调 vs 热稳态量化（§1.4，非候选——once-per-process 否决类 + 编译成本本体） | 测量收口 |
| `evaluation/check-adapter.ts` | changeSetsEqual 三面钉死维持；hashArtifact（S5-H-3）维持零候选 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` / `precedence.ts` / `ownership.ts` / `delivery-adapter.ts` / `diff-adapter.ts` | 纯类型/常量/3 元表/test-only 面；X4-9 维持；S1-H-7 维持 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `critic.ts` / `self-review.ts` | 双物质比较为协议本体；S1-H-6 维持；O(1) 谓词 | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持；Θ(字段) 构造 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 via nvm，满足
engines >=22.19.0；系统 Node 22.14.0 过低的既知环境注记同 R1-J §3）。
`pnpm typecheck` 与 `pnpm lint` 在独占 tip 上全绿（未触碰任何继承脚本）：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H…R5-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r6h-sim.mts`，无赢家故未入库以从 round01–05 仅
赢家 sim 入库的仓库惯例；完整源码见附录，seed 固定可复现；执行层级
测量以 `pnpm build` 后的 dist 产物为准）代表性一次运行：

```text
S6-H-1 bench real heuristic C=2 (production skip path): current=253ns cand=116ns delta=136ns/run inside applyPrecedence=243ns (once per run)
S6-H-1 bench stress no-fast (469 criteria): current=38321ns cand=17288ns delta=21033ns/call
S6-H-1 bench stress with-conflict (469 criteria, no guard fee by construction): current=38141ns cand=39853ns delta=-1711ns/call
S6-H-2 proxy trace: checkCoverageGate touched matrix props {orphanRequirements, requirementToTasks} over 2000 cases -> taskToChecks is dead in the gate composition
S6-H-2 bench run-start gate (C=2, 5 tasks): current=662ns cand=510ns delta=152ns/run (once per run start)
S6-H-2 bench stress (C=2, 200 tasks): current=18654ns cand=8314ns delta=10340ns/call
S6-H-3 empty-options-resolved edge: ref=DomainValidationError cand=DomainValidationError (both blocking)
S6-H-3 bench run-start gate (C=2, 5 tasks, 1 defaulted question): current=608ns cand=582ns delta=26ns/run (once per run start)
S6-H-4 bench real objective (empty habits, both singletons active): current=6232ns cand=5379ns delta=853ns/run (once per run)
CEILING re-verify (JIT-warm): extractHeuristicContract=4678ns + run-start gate=681ns + applyPrecedence=236ns = 5595ns once-per-run production total -> slice gain ceiling ~5.6µs/run (campaign landing bar: tens-to-hundreds of ms)
TIER cold (interpreter, dist, fresh process, module load pre-charged): median first-call production total=1714µs range=[1638, 1831]µs — the honest once-per-run ceiling; still 2-3 orders below the landing bar

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~19,500 项等价/逐位检查全部通过、裁决结论逐位一致；
计时抖动内方向稳定（S6-H-1 真实规模三次 136/133/133ns、冲突侧压力
三次全部更慢 −1711/−938/−2075ns；S6-H-2 三次 152/166/127ns；S6-H-3
三次 26/45/21ns；S6-H-4 三次 853/466/616ns；热层锚点三次
5595/6263/5865ns；冷层中位数三次 1714/1674/1651µs）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-H-1 | detectConflicts 过滤器间顺序早退（fast 空即跳过 slow 过滤） | 等价且指令层无守卫费，但真实 C=2 仅 133–136ns/run once-per-run 噪声；冲突侧压力三次稳定更慢 −0.9~−2.1µs（代码布局/分支预测层的隐式守卫费，S5-H-1 对偶教训回声）——守卫方向两面钉死 |
| S6-H-2 | run-start 门控组合内 coverageMatrixFromTasks 的 taskToChecks 死计算跳过 | Proxy 迹证明死性 + throw parity 等价，但真实 T≤6 仅 127–166ns/run；落地需门控私有并行构建器（复制映射循环，X0-5 邻域）或收窄公开 CoverageMatrix 输出形状 |
| S6-H-3 | assertCoverageAllowsStart 无条件消除 gated 拷贝（决议融合进 blocking 扫描 + 原合同建矩阵） | 等价（含 options[0]==="" 保 blocking 边缘）但仅 21–45ns/run；门逻辑须在公开 checkCoverageGate 之外复制一份（单实现意图，S3-H-1 同向） |
| S6-H-4 | extractHeuristicContract 的 extractor/critic 角色对象模块级单例化 | 等价（角色对象不逃逸公开面，1500 组全链逐字节）且为六轮最大单点 466–853ns/run，仍低于落地线四个数量级；偏好档非空时 extractor 仍需新建 ⇒ 有效收益更低；X1-1 邻域无状态单例无收益支撑不引入 |

重开条件：S6-H-1 与 S5-H-1 合并——需合同规模 ≥2 个量级增长且「无冲突
流量为主」被版本化，且须实测推翻本报告冲突侧的布局费；S6-H-2 需矩阵
构建进入每 turn 热路径且 T 增长 ≥2 个量级，届时凭 Proxy 迹证明走「公开
新增门控专用构建器」路线；S6-H-3 需先出现门控每 turn 热路径且接受门
逻辑双实现的维护成本；S6-H-4 需提取链进入每 turn 热路径（届时凭本报告
1500 组逐字节证据直接落地，含空 habits 判定谓词）。总门槛更新：任何
候选须先推翻本报告 §1 的双层实测上界——热层 **5.6–6.3µs/run**（本 VM）
与冷层 **1.65–1.71ms once-per-process**（后者本身属 once-per-process
否决类且主体为首调编译成本）；即调用图出现每 turn 新热路径或合同规模
≥2 个量级增长之前，该切片结构上无达门槛候选。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：`pnpm build` 后保存为任意 `.mts` 并 `npx tsx <file>`（仓库
根目录，依赖已装；`.mts` 保证 ESM 顶层 await 可用；执行层级探针需要
dist 产物存在）。seeds：`0x664801` … `0x664804`（执行层级为进程级
测量，无需 RNG）。

```ts
/**
 * R6-H deterministic equivalence + benchmark simulation (sixth pass).
 * Adjudicates fresh candidates S6-H-1 .. S6-H-4 against the current
 * implementations in src/{evaluation,requirement,review,rubric}, re-verifies
 * the R5-H §1 9.2-9.5µs/run slice gain ceiling (mandated: re-measure, don't
 * assume) and closes the last unmeasured cost layer: the execution TIER
 * (interpreter-cold first call vs JIT-warm steady state) of the slice's
 * once-per-run production entries. All candidates are NEW angles not named
 * by EXCLUSIONS.md, R1-H (S1-H-1..9), R2-H (S2-H-1..7), R3-H (S3-H-1..4),
 * R4-H (S4-H-1..3) or R5-H (S5-H-1..3). Seeded PRNG (mulberry32) -> fully
 * reproducible. Seeds: 0x664801 .. 0x664804.
 *
 * Reference = production imports wherever the function is exported; each
 * candidate differs from the current implementation ONLY by the candidate
 * edit.
 */
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import {
  applyPrecedence,
  detectConflicts,
  type Conflict
} from "/workspace/src/requirement/precedence.js";
import {
  extractHeuristicContract,
  heuristicExtractor,
  heuristicCritic,
  type HeuristicHabits
} from "/workspace/src/requirement/heuristic.js";
import { buildContractCandidate, type ContractCandidate } from "/workspace/src/requirement/extractor.js";
import { createTrustedSource, type RawSource } from "/workspace/src/requirement/normalizer.js";
import {
  assertCoverageAllowsStart,
  checkCoverageGate,
  coverageMatrixFromTasks,
  isSkipContract,
  type CoverageTaskRef,
  type CoverageStartOptions
} from "/workspace/src/requirement/coverage.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import type {
  RequirementContract,
  CoverageMatrix,
  AcceptanceCriterion,
  DecisionQuestion,
  Assumption
} from "/workspace/src/domain/contract.js";
import type { TaskId } from "/workspace/src/domain/ids.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}\n`);
  }
}
function log(line: string): void {
  process.stdout.write(`${line}\n`);
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
function thrown(fn: () => void): string {
  try {
    fn();
    return "NO_THROW";
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}

/* ================================================================
 * S6-H-1: detectConflicts — sequential inter-filter early exit.
 * Distinct from S5-H-1 (a PRE-guard of two extra `some` scans that
 * paid a "guard fee" on the conflict side and was killed for exactly
 * that duality) and from S1-H-5 (fusing the filters inside
 * applyPrecedence): here the first filter's own result IS the guard —
 * if `fast` is empty the slow filter never runs. Work is strictly
 * <= current on every input (one added length branch); no re-scan
 * exists on any path. Production heuristic checks contain no
 * fast/slow keyword, so production always takes the skip.
 * ================================================================ */
function isFastLocal(check: string): boolean {
  const lower = check.toLowerCase();
  return lower.includes("fast") || lower.includes("< 10ms");
}
function isSlowLocal(check: string): boolean {
  const lower = check.toLowerCase();
  return lower.includes("slow") || lower.includes("> 1000ms");
}
function candidateDetectConflicts(contract: RequirementContract): Conflict[] {
  const fast = contract.acceptanceCriteria.filter((criterion) => isFastLocal(criterion.observableCheck));
  if (fast.length === 0) return []; // the candidate edit: skip the slow filter entirely
  const slow = contract.acceptanceCriteria.filter((criterion) => isSlowLocal(criterion.observableCheck));
  if (slow.length === 0) return [];
  return [
    {
      ids: [...fast, ...slow].map((criterion) => criterion.id),
      description: "contradictory-latency"
    }
  ];
}

function genPrecedenceContract(rng: () => number, scale: number): RequirementContract {
  const checkPool = [
    "runs fast",
    "must be slow to warm up",
    "latency < 10ms",
    "latency > 1000ms",
    "fast and slow paths compared",
    "manual-or-test",
    "run the suite"
  ];
  const count = Math.floor(rng() * 8 * scale);
  const criteria: AcceptanceCriterion[] = Array.from({ length: count }, (_, i) => ({
    id: rng() < 0.1 ? `dup-${Math.floor(rng() * 2)}` : `ac-${i}`,
    description: `criterion ${i}`,
    observableCheck: pick(rng, checkPool)
  }));
  return {
    schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
    acceptanceCriteria: criteria,
    assumptions: [{ id: "a-base", statement: "s", source: "src" }],
    questions: [], authority: [], sourceRefs: []
  } as unknown as RequirementContract;
}

{
  const rng = mulberry32(0x664801);
  for (let trial = 0; trial < 6000; trial += 1) {
    const contract = genPrecedenceContract(rng, 1);
    check(
      "S6-H-1 equivalence (inter-filter early exit)",
      JSON.stringify(detectConflicts(contract)) === JSON.stringify(candidateDetectConflicts(contract)),
      JSON.stringify(contract.acceptanceCriteria.map((criterion) => criterion.observableCheck))
    );
  }
  // Directed: slow-only contract (fast empty, slow non-empty) — the skip
  // branch must not change the [] result.
  const slowOnly = {
    ...genPrecedenceContract(mulberry32(0x664801), 1),
    acceptanceCriteria: [
      { id: "s-1", description: "d", observableCheck: "must be slow to warm up" },
      { id: "s-2", description: "d", observableCheck: "latency > 1000ms" }
    ]
  } as RequirementContract;
  check(
    "S6-H-1 slow-only parity",
    JSON.stringify(detectConflicts(slowOnly)) === JSON.stringify(candidateDetectConflicts(slowOnly)) &&
      detectConflicts(slowOnly).length === 0
  );
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const real = prod.contract;
  check(
    "S6-H-1 production heuristic contract takes the skip branch (no fast keyword)",
    real.acceptanceCriteria.every((criterion) => !isFastLocal(criterion.observableCheck)) &&
      JSON.stringify(detectConflicts(real)) === JSON.stringify(candidateDetectConflicts(real))
  );
  const curReal = bench(() => void detectConflicts(real), 100000);
  const candReal = bench(() => void candidateDetectConflicts(real), 100000);
  const applyReal = bench(() => void applyPrecedence(real, "user-first"), 100000);
  log(
    `S6-H-1 bench real heuristic C=${real.acceptanceCriteria.length} (production skip path): current=${(curReal * 1e6).toFixed(0)}ns cand=${(candReal * 1e6).toFixed(0)}ns delta=${((curReal - candReal) * 1e6).toFixed(0)}ns/run inside applyPrecedence=${(applyReal * 1e6).toFixed(0)}ns (once per run)`
  );
  // Stress: no-fast at scale (candidate best case) and with-conflict at
  // scale (candidate must be identical, not slower — no guard fee).
  const base = genPrecedenceContract(mulberry32(0x664801), 100);
  const stressMiss = {
    ...base,
    acceptanceCriteria: base.acceptanceCriteria.map((criterion, i) => ({
      ...criterion,
      observableCheck: `run the suite number ${i}`
    }))
  } as RequirementContract;
  const curMiss = bench(() => void detectConflicts(stressMiss), 2000);
  const candMiss = bench(() => void candidateDetectConflicts(stressMiss), 2000);
  log(
    `S6-H-1 bench stress no-fast (${stressMiss.acceptanceCriteria.length} criteria): current=${(curMiss * 1e6).toFixed(0)}ns cand=${(candMiss * 1e6).toFixed(0)}ns delta=${((curMiss - candMiss) * 1e6).toFixed(0)}ns/call`
  );
  const stressHit = genPrecedenceContract(mulberry32(0x664801), 100);
  const curHit = bench(() => void detectConflicts(stressHit), 2000);
  const candHit = bench(() => void candidateDetectConflicts(stressHit), 2000);
  log(
    `S6-H-1 bench stress with-conflict (${stressHit.acceptanceCriteria.length} criteria, no guard fee by construction): current=${(curHit * 1e6).toFixed(0)}ns cand=${(candHit * 1e6).toFixed(0)}ns delta=${((curHit - candHit) * 1e6).toFixed(0)}ns/call`
  );
}

/* ================================================================
 * S6-H-2: run-start gate composition — coverageMatrixFromTasks
 * computes `taskToChecks` (one `mapped` array per task + one record
 * write per task), but checkCoverageGate never reads it; inside
 * assertCoverageAllowsStart the matrix is local and discarded, so in
 * THIS composition taskToChecks is provably dead work. Candidate:
 * a gate-private builder that skips it. Proof of deadness: a Proxy
 * trace over the matrix records every property checkCoverageGate
 * touches. Costs: either a parallel private builder (duplicates the
 * mapping loop; X0-5 neighborhood) or narrowing the public
 * CoverageMatrix output (public-shape change).
 * ================================================================ */
function gateOnlyMatrix(contract: RequirementContract, tasks: readonly CoverageTaskRef[]): CoverageMatrix {
  const contractIds = new Set(contract.acceptanceCriteria.map((criterion) => criterion.id));
  const requirementToTasks: Record<string, TaskId[]> = {};
  for (const task of tasks) {
    for (const criterion of task.acceptanceCriteria) {
      if (!contractIds.has(criterion.id)) continue;
      const owners = requirementToTasks[criterion.id] ?? [];
      owners.push(task.id);
      requirementToTasks[criterion.id] = owners;
    }
  }
  return {
    contractVersion: contract.schemaVersion,
    requirementToTasks,
    taskToChecks: {},
    orphanRequirements: []
  };
}
function candidateAssertStartNoTaskToChecks(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[],
  options?: CoverageStartOptions
): void {
  if (isSkipContract(contract)) return;
  const resolved = new Set(options?.resolvedQuestionIds ?? []);
  const gated: RequirementContract = {
    ...contract,
    questions: contract.questions.map((question) => {
      if (question.default !== undefined || !resolved.has(question.id)) return question;
      return { ...question, default: question.options[0] ?? "resolved" };
    })
  };
  const result = checkCoverageGate(gated, gateOnlyMatrix(gated, tasks)); // the candidate edit
  if (result.ok) return;
  const parts = [
    result.uncoveredCriteria.length > 0 ? `uncovered=${result.uncoveredCriteria.join(",")}` : undefined,
    result.blockingDecisions.length > 0 ? `blocking=${result.blockingDecisions.join(",")}` : undefined,
    result.orphans.length > 0 ? `orphans=${result.orphans.join(",")}` : undefined
  ].filter((part): part is string => part !== undefined);
  throw new DomainValidationError(
    `coverage gate blocked start: ${parts.join("; ") || "mandatory criteria uncovered"}`
  );
}

function genGateCase(rng: () => number): {
  contract: RequirementContract;
  tasks: CoverageTaskRef[];
  options: CoverageStartOptions | undefined;
} {
  const criterionCount = Math.floor(rng() * 5);
  const criteria: AcceptanceCriterion[] = Array.from({ length: criterionCount }, (_, i) => ({
    id: `ac-${i}`,
    description: "d",
    observableCheck: "c"
  }));
  const questions: DecisionQuestion[] = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
    id: `q-${i}`,
    question: "q",
    options: rng() < 0.7 ? ["opt-a", "opt-b"] : rng() < 0.5 ? [""] : [],
    ...(rng() < 0.4 ? { default: rng() < 0.3 ? "" : "opt-a" } : {})
  }));
  const assumptions: Assumption[] =
    rng() < 0.15 ? [{ id: "skip-contract", statement: "s", source: "src" }] : [];
  const contract = {
    schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
    acceptanceCriteria: criteria, assumptions, questions, authority: [], sourceRefs: []
  } as unknown as RequirementContract;
  const tasks: CoverageTaskRef[] = Array.from({ length: Math.floor(rng() * 5) }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: criteria
      .filter(() => rng() < 0.6)
      .map((criterion) => ({ id: criterion.id }))
      .concat(rng() < 0.2 ? [{ id: "stray-ac" }] : [])
  }));
  const options: CoverageStartOptions | undefined =
    rng() < 0.6
      ? { resolvedQuestionIds: questions.filter(() => rng() < 0.5).map((question) => question.id) }
      : undefined;
  return { contract, tasks, options };
}

{
  const rng = mulberry32(0x664802);
  for (let trial = 0; trial < 6000; trial += 1) {
    const { contract, tasks, options } = genGateCase(rng);
    check(
      "S6-H-2 equivalence (gate-private matrix without taskToChecks)",
      thrown(() => assertCoverageAllowsStart(contract, tasks, options)) ===
        thrown(() => candidateAssertStartNoTaskToChecks(contract, tasks, options)),
      `trial ${trial}`
    );
  }
  // Deadness proof: Proxy trace — checkCoverageGate must never touch
  // taskToChecks on any fuzz case.
  const touched = new Set<string>();
  const rng2 = mulberry32(0x664802);
  for (let trial = 0; trial < 2000; trial += 1) {
    const { contract, tasks } = genGateCase(rng2);
    const matrix = coverageMatrixFromTasks(contract, tasks);
    const traced = new Proxy(matrix, {
      get(target, prop, receiver) {
        if (typeof prop === "string") touched.add(prop);
        return Reflect.get(target, prop, receiver);
      }
    });
    void checkCoverageGate(contract, traced);
  }
  check(
    "S6-H-2 deadness proof: checkCoverageGate never reads taskToChecks",
    !touched.has("taskToChecks"),
    `touched=${[...touched].join(",")}`
  );
  log(
    `S6-H-2 proxy trace: checkCoverageGate touched matrix props {${[...touched].sort().join(", ")}} over 2000 cases -> taskToChecks is dead in the gate composition`
  );
  // Real scale: heuristic contract C=2, 5 tasks (the run-start shape).
  const criteria: AcceptanceCriterion[] = [
    { id: "ac-objective", description: "d", observableCheck: "c" },
    { id: "ac-tests", description: "d", observableCheck: "c" }
  ];
  const contract = {
    schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
    acceptanceCriteria: criteria, assumptions: [], questions: [], authority: [], sourceRefs: []
  } as unknown as RequirementContract;
  const tasks: CoverageTaskRef[] = Array.from({ length: 5 }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: [{ id: "ac-objective" }, { id: "ac-tests" }]
  }));
  const cur = bench(() => assertCoverageAllowsStart(contract, tasks), 50000);
  const cand = bench(() => candidateAssertStartNoTaskToChecks(contract, tasks), 50000);
  log(
    `S6-H-2 bench run-start gate (C=2, 5 tasks): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (once per run start)`
  );
  // Stress: 200 tasks (two orders beyond the <=6-role reality).
  const stressTasks: CoverageTaskRef[] = Array.from({ length: 200 }, (_, i) => ({
    id: `tsk_${String(i).padStart(8, "0")}` as TaskId,
    acceptanceCriteria: [{ id: "ac-objective" }, { id: "ac-tests" }]
  }));
  const curS = bench(() => assertCoverageAllowsStart(contract, stressTasks), 5000);
  const candS = bench(() => candidateAssertStartNoTaskToChecks(contract, stressTasks), 5000);
  log(
    `S6-H-2 bench stress (C=2, 200 tasks): current=${(curS * 1e6).toFixed(0)}ns cand=${(candS * 1e6).toFixed(0)}ns delta=${((curS - candS) * 1e6).toFixed(0)}ns/call`
  );
}

/* ================================================================
 * S6-H-3: assertCoverageAllowsStart — UNCONDITIONAL elimination of
 * the gated-contract copy by fusing question resolution into the
 * blocking scan. Distinct from S1-H-2 (conditionally SKIP the copy
 * when no question would change — kept the checkCoverageGate call):
 * here the copy never happens; the matrix is built from the ORIGINAL
 * contract (gating replaces only `questions`; coverageMatrixFromTasks
 * reads only acceptanceCriteria + schemaVersion) and blocking is
 * computed with the effective default inline. Cost: the gate logic
 * (uncovered/blocking/message assembly) is duplicated outside the
 * public checkCoverageGate (X0-5 single-implementation neighborhood).
 * Edge fidelity: a resolved question with options[0] === "" gets a
 * falsy gated default and must STAY blocking.
 * ================================================================ */
function candidateAssertStartFused(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[],
  options?: CoverageStartOptions
): void {
  if (isSkipContract(contract)) return;
  const resolved = new Set(options?.resolvedQuestionIds ?? []);
  const matrix = coverageMatrixFromTasks(contract, tasks); // original contract: acceptanceCriteria unchanged by gating
  const orphans = matrix.orphanRequirements;
  const uncoveredCriteria: string[] = [];
  for (const criterion of contract.acceptanceCriteria) {
    const covered =
      Object.keys(matrix.requirementToTasks).includes(criterion.id) &&
      (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0;
    if (!covered) uncoveredCriteria.push(criterion.id);
  }
  const blockingDecisions: string[] = [];
  for (const question of contract.questions) {
    const effective =
      question.default !== undefined
        ? question.default
        : resolved.has(question.id)
          ? question.options[0] ?? "resolved"
          : undefined;
    if (!effective) blockingDecisions.push(question.id);
  }
  if (orphans.length === 0 && uncoveredCriteria.length === 0 && blockingDecisions.length === 0) return;
  const parts = [
    uncoveredCriteria.length > 0 ? `uncovered=${uncoveredCriteria.join(",")}` : undefined,
    blockingDecisions.length > 0 ? `blocking=${blockingDecisions.join(",")}` : undefined,
    orphans.length > 0 ? `orphans=${orphans.join(",")}` : undefined
  ].filter((part): part is string => part !== undefined);
  throw new DomainValidationError(
    `coverage gate blocked start: ${parts.join("; ") || "mandatory criteria uncovered"}`
  );
}

{
  const rng = mulberry32(0x664803);
  for (let trial = 0; trial < 6000; trial += 1) {
    const { contract, tasks, options } = genGateCase(rng);
    check(
      "S6-H-3 equivalence (fused resolution, no gated copy)",
      thrown(() => assertCoverageAllowsStart(contract, tasks, options)) ===
        thrown(() => candidateAssertStartFused(contract, tasks, options)),
      `trial ${trial}`
    );
  }
  // Directed: resolved question whose options[0] is "" -> gated default is
  // falsy -> must remain blocking on BOTH sides (the edge the fusion could
  // silently get wrong).
  const contract = {
    schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
    acceptanceCriteria: [], assumptions: [],
    questions: [{ id: "q-empty", question: "q", options: [""] }],
    authority: [], sourceRefs: []
  } as unknown as RequirementContract;
  const opts: CoverageStartOptions = { resolvedQuestionIds: ["q-empty"] };
  const refOutcome = thrown(() => assertCoverageAllowsStart(contract, [], opts));
  const candOutcome = thrown(() => candidateAssertStartFused(contract, [], opts));
  check(
    "S6-H-3 empty-options-resolved edge stays blocking on both sides",
    refOutcome === candOutcome && refOutcome !== "NO_THROW",
    `ref=${refOutcome} cand=${candOutcome}`
  );
  log(`S6-H-3 empty-options-resolved edge: ref=${refOutcome.split(":")[0]} cand=${candOutcome.split(":")[0]} (both blocking)`);
  const criteria: AcceptanceCriterion[] = [
    { id: "ac-objective", description: "d", observableCheck: "c" },
    { id: "ac-tests", description: "d", observableCheck: "c" }
  ];
  const benchContract = {
    schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
    acceptanceCriteria: criteria, assumptions: [],
    questions: [{ id: "q-tests", question: "q", options: ["yes", "no"], default: "yes" }],
    authority: [], sourceRefs: []
  } as unknown as RequirementContract;
  const tasks: CoverageTaskRef[] = Array.from({ length: 5 }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: [{ id: "ac-objective" }, { id: "ac-tests" }]
  }));
  const cur = bench(() => assertCoverageAllowsStart(benchContract, tasks), 50000);
  const cand = bench(() => candidateAssertStartFused(benchContract, tasks), 50000);
  log(
    `S6-H-3 bench run-start gate (C=2, 5 tasks, 1 defaulted question): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (once per run start)`
  );
}

/* ================================================================
 * S6-H-4: extractHeuristicContract — per-call construction of the
 * extractor/critic ROLE OBJECTS replaced by module-level singletons
 * (critic always; extractor when habits resolve to the empty shape).
 * Distinct from R2-H's no-ID closure of hoisting the question/
 * constraint DATA literals (those flow into the returned contract, so
 * a shared instance is identity-observable); the role objects never
 * escape buildContractCandidate — only their roleId strings do — so
 * singleton identity is unobservable through the public surface.
 * Both are stateless closures. X1-1 adjacency considered: this is a
 * stateless singleton, not a result cache, so no staleness exists —
 * the kill is magnitude.
 * ================================================================ */
const SINGLETON_EXTRACTOR = heuristicExtractor({});
const SINGLETON_CRITIC = heuristicCritic();
function isEmptyHabits(habits: HeuristicHabits): boolean {
  return (
    habits.requireTests === undefined &&
    habits.preferReview === undefined &&
    habits.askBeforeWrite === undefined
  );
}
async function candidateExtractHeuristicContract(input: {
  readonly objective: string;
  readonly sources?: readonly RawSource[];
  readonly habits?: HeuristicHabits;
}): Promise<ContractCandidate> {
  const sources =
    input.sources !== undefined && input.sources.length > 0
      ? input.sources
      : [
          createTrustedSource({
            kind: "message",
            ref: "cli-objective",
            origin: "user-turn",
            content: input.objective
          })
        ];
  const habits = input.habits ?? {};
  return buildContractCandidate({
    objective: input.objective,
    sources: [...sources],
    extractor: isEmptyHabits(habits) ? SINGLETON_EXTRACTOR : heuristicExtractor(habits), // the candidate edit
    critic: SINGLETON_CRITIC, // the candidate edit
    minimumConfidence: 0.8
  });
}

{
  const rng = mulberry32(0x664804);
  const objectives = [
    "fix the login retry bug in src/auth/session.ts and keep tests green",
    "do stuff", // vague
    "add qa coverage for the export path",
    "fix typo in README.md",
    "implement the new privacy deletion cascade and add tests",
    "investigate flaky supervisor shutdown"
  ];
  const habitValues: readonly (boolean | undefined)[] = [true, false, undefined];
  for (let trial = 0; trial < 1500; trial += 1) {
    const objective = pick(rng, objectives);
    const habits: HeuristicHabits | undefined =
      rng() < 0.3
        ? undefined
        : {
            ...(rng() < 0.7 ? { requireTests: pick(rng, habitValues) } : {}),
            ...(rng() < 0.7 ? { preferReview: pick(rng, habitValues) } : {}),
            ...(rng() < 0.7 ? { askBeforeWrite: pick(rng, habitValues) } : {})
          };
    const reference = await extractHeuristicContract({ objective, ...(habits !== undefined ? { habits } : {}) });
    const candidate = await candidateExtractHeuristicContract({
      objective,
      ...(habits !== undefined ? { habits } : {})
    });
    check(
      "S6-H-4 equivalence (role-object singletons)",
      JSON.stringify(reference) === JSON.stringify(candidate),
      `objective=${objective} habits=${JSON.stringify(habits)}`
    );
  }
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const cur = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  const cand = await benchAsync(async () => {
    await candidateExtractHeuristicContract({ objective });
  }, 3000);
  log(
    `S6-H-4 bench real objective (empty habits, both singletons active): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (once per run)`
  );
}

/* ================================================================
 * Ceiling re-verification (R5-H §1, mandated: re-measure, don't
 * assume): total JIT-warm production work of this slice per run.
 * ================================================================ */
{
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const chain = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  const prod = await extractHeuristicContract({ objective });
  const real = prod.contract;
  const tasks: CoverageTaskRef[] = Array.from({ length: 5 }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: real.acceptanceCriteria.map((criterion) => ({ id: criterion.id }))
  }));
  const gate = bench(() => assertCoverageAllowsStart(real, tasks), 50000);
  const precedence = bench(() => void applyPrecedence(real, "user-first"), 100000);
  const total = chain + gate + precedence;
  log(
    `CEILING re-verify (JIT-warm): extractHeuristicContract=${(chain * 1e6).toFixed(0)}ns + run-start gate=${(gate * 1e6).toFixed(0)}ns + applyPrecedence=${(precedence * 1e6).toFixed(0)}ns = ${(total * 1e6).toFixed(0)}ns once-per-run production total -> slice gain ceiling ~${(total * 1e3).toFixed(1)}µs/run (campaign landing bar: tens-to-hundreds of ms)`
  );
}

/* ================================================================
 * Execution-tier layer (NEW, sixth pass): every slice production
 * entry runs ONCE per run = ONCE per process, i.e. in the
 * interpreter/baseline tier — the JIT-warm numbers above describe a
 * steady state production never reaches. Measure the FIRST-call cost
 * of the three production entries in fresh Node processes on the
 * dist artifacts (module load itself pre-charged before timing), and
 * the second call in the same process for the tier-up delta. This is
 * the honest per-run ceiling.
 * ================================================================ */
{
  const script = `
    const { performance } = await import("node:perf_hooks");
    const { extractHeuristicContract } = await import("/workspace/dist/requirement/heuristic.js");
    const { assertCoverageAllowsStart } = await import("/workspace/dist/requirement/coverage.js");
    const { applyPrecedence } = await import("/workspace/dist/requirement/precedence.js");
    const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
    const t0 = performance.now();
    const prod = await extractHeuristicContract({ objective });
    const t1 = performance.now();
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: "tsk_0000000" + i,
      acceptanceCriteria: prod.contract.acceptanceCriteria.map((c) => ({ id: c.id }))
    }));
    const t2 = performance.now();
    assertCoverageAllowsStart(prod.contract, tasks);
    const t3 = performance.now();
    applyPrecedence(prod.contract, "user-first");
    const t4 = performance.now();
    // second call in the same process = tier-up reference
    const s0 = performance.now();
    await extractHeuristicContract({ objective });
    const s1 = performance.now();
    process.stdout.write([t1 - t0, t3 - t2, t4 - t3, s1 - s0].map((x) => x.toFixed(3)).join(" "));
  `;
  const firstTotals: number[] = [];
  const lines: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const proc = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    if (proc.status !== 0) {
      check("TIER cold-call probe runs", false, proc.stderr);
      break;
    }
    const [extract, gate, precedence, second] = proc.stdout.trim().split(" ").map(Number) as [
      number, number, number, number
    ];
    firstTotals.push(extract + gate + precedence);
    lines.push(
      `sample ${i}: first-call extract=${(extract * 1e3).toFixed(0)}µs gate=${(gate * 1e3).toFixed(0)}µs precedence=${(precedence * 1e3).toFixed(0)}µs total=${((extract + gate + precedence) * 1e3).toFixed(0)}µs; second-call extract=${(second * 1e3).toFixed(0)}µs`
    );
  }
  firstTotals.sort((a, b) => a - b);
  const median = firstTotals[Math.floor(firstTotals.length / 2)] ?? Number.NaN;
  for (const line of lines) log(`TIER ${line}`);
  log(
    `TIER cold (interpreter, dist, fresh process, module load pre-charged): median first-call production total=${(median * 1e3).toFixed(0)}µs range=[${(firstTotals[0]! * 1e3).toFixed(0)}, ${(firstTotals[firstTotals.length - 1]! * 1e3).toFixed(0)}]µs — the honest once-per-run ceiling; still 2-3 orders below the landing bar`
  );
  check("TIER probe produced numbers", Number.isFinite(median) && firstTotals.length === 5);
}

if (failures > 0) {
  process.stderr.write(`\n${failures} equivalence check(s) FAILED\n`);
  process.exit(1);
}
log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r6-h-eval-sixth-pass-83a1

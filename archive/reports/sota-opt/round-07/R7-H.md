MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第七遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `6a10331`（独占 tip，含 S6-F-1 落地与 S7-A/B/D/G 排除全表）
**分支:** `cursor/r7-h-eval-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 21 个文件
（1750 行）自 R1-H 基线（`fd437a9`）以来**逐字节未变**（`git diff
fd437a9..6a10331 -- src/{evaluation,requirement,review,rubric}/` 为空，
同范围零提交），且 R6-H 基线（`9b17a8a`）之后 `src/` 仅落地 S6-F-1
（`experiments/{canary,shadow}.ts`），不 import 本切片 ⇒ 生产调用方地图
**可证不变**，本轮全库 import 交叉检索再次确认（8 个导入位点与
R3-H…R6-H 完全一致，各入口频次仍为每 run / 每晋升一次）。按指令对 R6-H
§1 的双层上界做了**实测复核而非沿用**：本 VM 三次独立运行测得 JIT 热稳态
切片生产入口每 run 合计 **3.9–4.0µs**（低于六轮历史跨 VM 带 4.5–10µs 的
下沿，属快 VM 环境差异），冷层首调合计 **1.72–1.76ms** once-per-process
（与 R6-H 的 1.65–1.71ms 同带，否决类归属不变）。第七遍在完整排除表
（S1-H-1..9、S2-H-1..7、S3-H-1..4、S4-H-1..3、S5-H-1..3、S6-H-1..4 及
六轮 25+ 处不立 ID 收口）之上以三个**从未检视过的层面**枚举——生产链的
**异步机器成本**（promise 分配 + 微任务跳变）、组合死输出的**源侧**
（normalizer 的 signals 字段）、执行层级测量的**对策面**（模块加载期 JIT
预热）——得到 3 个此前未点名的新候选（S7-H-1 … S7-H-3），全部经理论 +
确定性仿真（seeded mulberry32，~24,000 项等价/迹检查 + 真实/进程双端
基准，三次独立运行裁决逐位一致、计时方向稳定）裁决后淘汰：S7-H-1 等价
（含逐位 sanity 闸）但整条异步机器仅 167–175ns/run 且落地需同步化三个
公开扩展点签名（X0-4 类）；S7-H-2 以 Proxy 迹证明 signals 在生产组合中
死（每源 3 次正则扫描 = 162–165ns，占 once-per-run 链 2.4–2.6%），但
定向探针证明该字段对任意 RequirementExtractor 实现是**活的契约输出**，
不可从 normalizeSources 删除；S7-H-3（冷层预热）三次实测**净负**——
预热调用自身付 ~1.7ms，真实首调只降到 ~0.39ms，关键路径恒差
+355~+411µs，属「once-per-process 否决类里连账面收益都为负」的干净关闭。
未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-A/B/D/G-*
条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第七遍实际读码。
  上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts` 只读取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含新并入的
  S7-A-1..4 / S7-B-1..6 / S7-D-1..5 / S7-G-1..5）/ round-07/PLAN.md /
  round-01/R1-H.md … round-06/R6-H.md。候选枚举刻意绕开全部既有排除，
  特别核对未触碰：S5-H-2 / S6-H 冷层测量（本轮 S7-H-3 是其**对策**而非
  重测——惰性 import 与首调编译成本本体均未重开）、S6-H-2（taskToChecks
  组合死输出——S7-H-2 是同机制在 **normalizer 源侧**的新位点，输出字段
  与落地墙都不同，见 §3.2）、S6-H-4（角色对象单例——本轮零重提）、
  S1-H-9 / S2-H-4 / S3-H-4（changeSetsEqual 三面钉死维持，零候选）、
  S1-H-8 / S2-H-6（registerRubric 维持）、X4-9 / X0-5 / X0-6。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `buildContractCandidate` 对仓内恒 0.8 常量 `minimumConfidence` 的
    每调用 `validateConfidence` 消除 = S7-A-1 跨模块常量折叠族 +
    S2-D-5 边界防御类，拒列；
  - `extractHeuristicContract` 与 `buildContractCandidate` 的双
    `[...sources]` 防御拷贝合并 = R1-H / R2-H 两处既有 no-ID 收口
    （S1-B-5 族）的并集，拒列；
  - `createCheckAdapter`/`createDeliveryAdapter`/`createDiffAdapter`
    无状态类实例单例化 = S6-H-4 换位点且作用面零生产调用方
    （test-only），拒列；
  - heuristic 的 isVague/shouldScout/namedTargets 多正则合并单遍多模式
    扫描 = S4-B-1 / S6-E-2 族（廉价形式不等价、忠实形式更慢的既判
    家族），拒列；
  - `input.habits ?? {}` 空对象字面量提升 = R2-H 数据字面量收口邻域 +
    ns 级，拒列。
- R6-H §1 的双层上界按指令**先复核后引用**：本报告 §1 以三次独立实测在
  本 VM 重建热层锚点（3.9–4.0µs/run）与冷层锚点（1.72–1.76ms 首调），
  未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 与双归因保留、阈值/权限/
  数据面契约/公开签名不变、测试未改，天然成立。不声称
  Outcome-supported，Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与上界重测

1. **切片逐字节未变**：`git diff fd437a9..6a10331 -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交（七遍全程零 diff）。R1-H 逐函数
   下界表、R2-H 调用图上界、R3-H 重复工作枚举、R4-H 三类角度收口、
   R5-H 三层级收口、R6-H 执行层级收口与全部 S*-H-* 排除继承有效。
2. **调用图可证不变**：`git log 9b17a8a..6a10331 -- src/` 仅含 S6-F-1
   （`experiments/canary.ts` + `experiments/shadow.ts`），不 import 本
   切片。本轮全库 import 检索双确认（8 位点，频次逐一复核）：
   `assertCoverageAllowsStart` ← `run/{supervisor,coordinator,flowchart-run}.ts`
   （每 run 启动一次，且仅当 `input.contract !== undefined`）；
   `extractHeuristicContract` ← `track/clarify.ts`（每 run 一次）；
   `applyPrecedence` ← `track/loop.ts`（每 run 一次，`"user-first"`）；
   `shouldScout` ← `track/plan.ts`（每 run 一次）；
   `assertCanPromoteFromReview` ← `adaptation/promotion-rules.ts`（每晋升
   一次）；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（仅类型导入与测试引用）。
3. **热层上界锚点重测**（指令要求，三次运行区间，本 VM）：

```text
CEILING re-verify (JIT-warm): extractHeuristicContract=2944-3086ns
  + run-start gate=651-692ns + applyPrecedence=270-281ns
  = 3910-4007ns once-per-run production total
  -> slice gain ceiling 3.9-4.0µs/run（战役落地线：数十~数百 ms）
```

   复核结论：低于 R6-H 的 5.6–6.3µs 与六轮历史带（4.5–10µs）下沿，属
   快 VM 测量环境差异而非调用图变更（§1.2 已证零变更）；量级结论不变。
4. **冷层锚点复核**（S7-H-3 探针的 baseline 侧顺带重建）：dist 产物、
   新进程、模块加载预扣除后，三生产入口首调合计中位数三次
   **1720 / 1739 / 1760 µs**——与 R6-H 的 1.65–1.71ms 同带，
   once-per-process 否决类归属不变。门槛第 3 条在本切片当前调用图下
   **结构上不可满足**的结论获得第七层证据。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-H-1 | 生产链异步机器消除：`extractHeuristicContract`（async 包装）→ `buildContractCandidate`（async，2 个 await）→ `heuristicExtractor.extract` / `heuristicCritic.critique`（async fn，体内无 await）全程做**纯同步工作**，却付 3 个 async 帧的 promise 分配 + 2 次微任务跳变。候选 = 整链同步化。R2-H 的 no-ID 注记只覆盖 test-only 的 ProjectAdapter 面；生产链的异步机器六轮从未量化 | 免 ~3 promise 分配 + ~2 微任务 hop | ✅ 先过 sanity 闸（async 逐字节复刻 replica ≡ 生产，2500 fuzz）再裁决候选：同步化整链 2500 fuzz（objective × habits 全格）载荷逐字节一致 | 隔离异步机器 **167–175ns**/链（三次稳定）；端到端 delta 205–1172ns/run 抖动一个量级（该量级已落入 JIT 函数身份噪声，与 R2-H S2-H-1/2 的 92–1209ns 同象）；once per run | 淘汰：亚 µs once-per-run 噪声（占 §1 热层锚点 ~4%）+ 落地需把 `RequirementExtractor.extract` / `ContractCritic.critique` / `buildContractCandidate` 三个**公开扩展点签名**从 Promise 改同步（X0-4 接口破坏类；异步签名正是为未来非启发式提取器留的扩展口） |
| S7-H-2 | `normalizeSources` 的 `signals` 字段（每源 3 次正则扫描 + 数组）在生产组合中是**组合死输出**：heuristic extractor 只读 `source.ref`、heuristicCritic 完全不读 sources、builder 只读 `source.ref.ref`（`canGrantAuthority` 仅在 authority 非空的 grounding 循环内读，生产恒空）。S6-H-2（taskToChecks）同机制在 normalizer 源侧的新位点。候选 = 生产组合跳过 signals 计算 | 免 3 次正则扫描 + 1 数组分配/源 | ✅ from-normalized 逐字节复刻 replica 过 sanity 闸（1500 fuzz）；skip-signals 变体经全链 1500 fuzz 逐字节一致；**Proxy 迹证明**：1000 例中生产组合触碰的 NormalizedSource 属性恰为 {ref}——signals/text/origin/authority 零读取；**扩展点活性反例**：读 signals 的自定义 extractor 下 skip 变体可观察发散（`[signals:requirement+constraint+acceptance]` vs `[signals:none]`） | 死份额 **162–165ns**/run = once-per-run 链的 **2.4–2.6%**（1 生产源） | 淘汰：亚 µs once-per-run 噪声；且 signals 是 `NormalizedSource` 公开形状的一部分，对**任意** RequirementExtractor 实现是活的契约输出（活性反例已证）——从 normalizeSources 删除属公开面变更，组合特化跳过则需平行归一化路径（S6-H-2 落地两难同型）；惰性 getter 变体改属性形状（枚举描述符 + JSON.stringify 触发时机），属 S1-A-7 可观察身份类 |
| S7-H-3 | 模块加载期 JIT 预热：R6-H 证明生产入口永远跑解释器冷层（首调 ~1.7ms vs 热稳态 ~4µs），自然对策 = 加载期用 dummy 输入先跑一遍三生产入口，把真实首调抬到已分层执行。候选 = 模块加载 priming 调用 | 真实首调从冷层降到二调层（~1.7ms → ~0.39ms） | —（进程级测量，无等价性问题；dummy 输入与真实输入不同 objective，无缓存混淆） | 新进程 dist 探针（5 样本中位数 ×3 轮）：baseline 真实首调 **1720/1739/1760µs**；预热版 warmup **1712/1724/1741µs** + 真实调 **390/390/391µs** = 关键路径 2102–2131µs ⇒ **净 +355/+363/+411µs，三次全部更差** | 淘汰：**净负优化**——预热调用自身在同一关键路径上付全额冷层成本（编译/分层是按代码首执行收费，不是按谁执行收费），tier-up 只省 ~1.35ms 而预热付 ~1.7ms；且整个层面属门槛第 3 条明文否决的 once-per-process CLI 类（S5-H-2/S6-H 冷层同判）。把预热挪到 I/O 等待空窗属进程调度工程，超出切片范围（S5-I-5 邻域） |

另有五处以既有排除/前轮收口直接覆盖、不立新 ID（见 §0 换名重提检查）。
第七遍对 21 文件逐一重扫**再未发现任何未被七轮排除表覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S7-H-1：异步面是本切片最后一个未量化的机器成本——量化后即关闭

六轮扫描测的都是「函数做了什么」；本轮补测「函数怎么被调用」：生产链
三个 async 帧（`extractHeuristicContract` 直接 return promise、
`buildContractCandidate` 两次 await、extract/critique 体内零 await）的
纯机器成本。镜像 promise 结构的隔离微基准测得 167–175ns/链（三次稳定），
端到端 delta（205–1172ns）在三次运行间抖动一个量级——恰说明该量级已
落入 JIT 函数身份噪声（S2-H-1/2 的 92–1209ns 同象）。等价性以两级闸
裁决：先证 async 逐字节复刻 replica ≡ 生产（把后续任何发散归因于候选
编辑本身），再证同步化整链逐字节一致。落地墙比量级墙更硬：
`RequirementExtractor.extract` 与 `ContractCritic.critique` 的 Promise
签名是给未来非启发式提取器（LLM 调用等真异步实现）留的扩展口，同步化
= X0-4 接口破坏。该面就此关闭：切片内不存在可保签名消除的异步开销。

### 3.2 S7-H-2：组合死输出的源侧镜像——Proxy 迹 + 活性反例双向钉死

S6-H-2 用 Proxy 迹证明了 gate 组合内 `taskToChecks` 死；本轮同机制
照向 normalizer：生产组合（heuristic extractor + critic + builder，
authority 恒空）对 `NormalizedSource` 触碰的属性**恰为 {ref}**——
`signals`（唯一有计算量的字段：3 次正则扫描）、`text`、`origin`、
`authority` 全部零读取，1000 例迹稳定。但与 S6-H-2 不同，本条多出一个
**活性反例**：`signals` 是 `NormalizedSource` 公开形状的字段，任意
第三方 `RequirementExtractor` 都可读——定向探针（把 signals 拼进
objective 的自定义 extractor）下 skip 变体可观察发散。于是三条落地路
全灭：从 normalizeSources 删除 = 破坏扩展点契约输出（活性反例）；
组合特化跳过 = 平行归一化路径（S6-H-2 两难同型 + X0-5 邻域）；惰性
getter = 属性形状可观察改变（S1-A-7 类）。量级本身也判死：死份额
162–165ns，占 once-per-run 链 2.4–2.6%。Proxy 迹证据留档：若未来
normalizeSources 进入每 turn 热路径且源数增长 ≥2 个量级，凭本报告走
「新增轻量 `normalizeRefsOnly` 公开构建器并让 heuristic 组合消费之」
路线重开，而非删字段。

### 3.3 S7-H-3：冷层的「显然对策」实测净负——执行层级面从测量收口升级为对策收口

R6-H 只测了冷层成本并按 once-per-process 类关闭；本轮把该层唯一的
切片内对策（加载期预热）拉上仿真台。三轮 fresh-process 探针方向一致：
tier-up 效果真实存在（真实首调 1720–1760µs → 390–391µs，降 ~78%），
但预热调用自身在**同一关键路径**上付 1712–1741µs 全额冷层成本——
V8 的首调编译/分层按代码首执行收费，谁执行都一样——净效果三次全部
更差（+355~+411µs）。这给执行层级面补上了对策级的关闭证据：冷层成本
不仅属否决类（once-per-process），而且**切片内无任何净正对策**；
唯一的真消除路径（snapshot / SEA / bytecode 缓存 / 把预热挪进 I/O
空窗）全部是进程级工程，超出切片且属 CLI 启动预算议题（S5-H-2 重开
条件原文管辖）。至此该层「测量 + 对策」双收口。

### 3.4 第七遍收口：机器成本三面（异步、死源、层级对策）补齐后再无未检视层

R1-H 证逐函数渐近下界，R2-H 证调用图收益上界，R3-H 枚举尽重复工作与
分配削减，R4-H 收口内建换写/跨模块去重/局部可变化，R5-H 补分配前守卫/
模块图/Θ(字节) 流量，R6-H 补执行层级测量，本轮补最后三面：**异步机器**
（S7-H-1，167–175ns/链 + X0-4 墙）、**组合死输出源侧**（S7-H-2，
162–165ns + 活性反例）、**层级对策**（S7-H-3，净负 +0.36~0.41ms）。
七遍合起来：单函数、函数间、跨模块、调用图、模块图、执行层级、调用
机器七个成本面全部有实测锚点与排除收口。重开该切片的唯一前提维持
R4-H…R6-H 收口原文：调用图变更（evaluation/review/rubric 面接入每
turn 热路径，或合同规模增长 ≥2 个量级）。

## 4. 逐文件收口（第七遍新视角，其余与 R1-H…R6-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/heuristic.ts` + `extractor.ts` | 生产链异步机器（S7-H-1，两级 sanity 闸）；minimumConfidence 常量校验与双 `[...sources]` 拷贝（换名重提，拒列）；S3-H-1/3、S6-H-4 维持未重开 | S7-H-1 淘汰 |
| `requirement/normalizer.ts` | signals 组合死输出（S7-H-2，Proxy 迹 + 活性反例）；S2-H-7 默认 origin 守卫维持；excerpt `slice(0,200)` 为契约输出（流入 contract.sourceRefs）复核成立 | S7-H-2 淘汰 |
| 切片生产入口执行层级 | 冷层对策（S7-H-3，加载期预热净负 +355~+411µs）；R6-H 冷层测量复核同带 | S7-H-3 淘汰 |
| `requirement/coverage.ts` | S1-H-1/2、S4-H-1、S6-H-2/3 五面钉死维持；本轮零新候选 | 无新候选 |
| `requirement/precedence.ts` | S1-H-5、S4-H-2、S5-H-1、S6-H-1 守卫方向两面钉死维持 | 无新候选 |
| `requirement/critic.ts` / `provenance.ts` | S2-H-3、S3-H-2 维持；findUnsourcedItems 收口维持 | 无新候选 |
| `evaluation/check-adapter.ts` | changeSetsEqual 三面钉死维持；hashArtifact（S5-H-3）维持零候选；async 面 = R2-H no-ID（test-only，X0-4 类）维持 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` / `precedence.ts` / `ownership.ts` / `delivery-adapter.ts` / `diff-adapter.ts` | 纯类型/常量/3 元表/test-only 面；X4-9 维持；adapter 工厂单例化 = S6-H-4 换位点拒列 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `critic.ts` / `self-review.ts` | 双物质比较为协议本体；S1-H-6 维持；O(1) 谓词 | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持；Θ(字段) 构造 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 via nvm，满足
engines >=22.19.0；系统 Node 22.14.0 过低的既知环境注记同 R1-J §3）。
`pnpm typecheck` / `pnpm lint` / `pnpm build` 在独占 tip 上全绿：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H…R6-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r7h-sim.mts`，无赢家故未入库以从 round01–06 仅
赢家 sim 入库的仓库惯例；完整源码见附录，seed 固定可复现；S7-H-3 与
冷层复核以 `pnpm build` 后的 dist 产物为准）代表性一次运行：

```text
S7-H-1 isolated async machinery (3 async frames + 2 awaits, trivial work): async=180ns sync=9ns machinery=172ns/chain
S7-H-1 bench full chain: current(async)=5134ns sync-ified cand=4721ns delta=414ns/run (once per run; landing requires sync-ifying the PUBLIC RequirementExtractor/ContractCritic/buildContractCandidate signatures = X0-4 class)
S7-H-2 proxy trace: production composition touched NormalizedSource props {ref} over 1000 cases -> signals/text/origin/authority are dead in THIS composition
S7-H-2 extension-point probe: signals-reader extractor objective ref="...irement+constraint+acceptance]" vs skip-signals cand="...must never fail [signals:none]" -> NOT universally dead; only the heuristic composition is
S7-H-2 cost isolation: extractSignals(3 regex scans, 1 production source)=165ns vs one extractHeuristicContract=6243ns -> dead share 2.6% of a once-per-run call
S7-H-3 fresh-process probes (dist, 5 samples each): baseline real first call=1760µs; primed: warmup=1724µs + real=391µs = critical path 2115µs -> net 355µs vs baseline (positive = pre-warm makes the critical path WORSE)
S7-H-3 tier-up effect in isolation: real call drops 1760µs -> 391µs, but the warmup itself costs 1724µs on the same critical path (once-per-process class either way)
CEILING re-verify (JIT-warm): extractHeuristicContract=3019ns + run-start gate=684ns + applyPrecedence=281ns = 3984ns once-per-run production total -> slice gain ceiling ~4.0µs/run (campaign landing bar: tens-to-hundreds of ms)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~24,000 项等价/迹检查全部通过、裁决结论逐位一致；计时
抖动内方向稳定（S7-H-1 隔离机器三次 172/175/167ns、端到端
414/205/1172ns；S7-H-2 死份额三次 165/165/162ns、Proxy 迹三次恒
{ref}、活性反例三次复现；S7-H-3 净差三次 +355/+363/+411µs 全部更差；
热层锚点三次 3984/3910/4007ns；冷层 baseline 三次 1760/1739/1720µs）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-H-1 | 生产提取链异步机器消除（extractor/critic/builder 同步化） | 等价（两级 sanity 闸 + 5000 fuzz）但整条机器仅 167–175ns/run once-per-run 噪声；落地需同步化 RequirementExtractor/ContractCritic/buildContractCandidate 三个公开扩展点 Promise 签名（X0-4 类，异步口为未来真异步提取器保留） |
| S7-H-2 | normalizeSources 生产组合跳过 signals 计算（组合死输出源侧） | Proxy 迹证明生产组合只读 {ref}，但活性反例证明 signals 对任意 extractor 是活的契约输出；死份额 162–165ns（once-per-run 链 2.4–2.6%）；三条落地路（删字段/平行路径/惰性 getter）分别撞扩展点契约、S6-H-2 两难、S1-A-7 身份类 |
| S7-H-3 | 模块加载期 JIT 预热调用（冷层对策） | 三次实测净负（关键路径 +355~+411µs）：预热自身付全额首调编译/分层成本，tier-up 收益（~1.35ms）小于预热成本（~1.7ms）；且整层属 once-per-process 否决类；真消除路径（snapshot/SEA/bytecode 缓存/I/O 空窗调度）超出切片 = S5-H-2 重开条件管辖 |

重开条件：S7-H-1 需先出现每 turn 生产调用方，**且**扩展点确定永不接入
真异步实现并版本化该决定（届时凭本报告 5000 组逐字节证据直接落地）；
S7-H-2 需 normalizeSources 进入每 turn 热路径且源数增长 ≥2 个量级，
届时凭 Proxy 迹走「新增轻量 refs-only 公开构建器」路线而非删字段；
S7-H-3 需先把 CLI 启动预算立为战役目标且预热可调度进 I/O 等待空窗
（进程级工程，超出本切片）。总门槛更新：任何候选须先推翻本报告 §1 的
双层实测上界——热层 **3.9–4.0µs/run**（本 VM）与冷层 **1.72–1.76ms
once-per-process**（否决类 + 首调编译成本本体 + 预热对策已证净负）；
即调用图出现每 turn 新热路径或合同规模 ≥2 个量级增长之前，该切片
结构上无达门槛候选。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：`pnpm build` 后保存为任意 `.mts` 并 `npx tsx <file>`（仓库
根目录，依赖已装；`.mts` 保证 ESM 顶层 await 可用；S7-H-3 与冷层探针
需要 dist 产物存在）。seeds：`0x774801` / `0x774802`（S7-H-3 为进程级
测量，无需 RNG）。

```ts
/**
 * R7-H deterministic equivalence + benchmark simulation (seventh pass).
 * Adjudicates fresh candidates S7-H-1 .. S7-H-3 against the current
 * implementations in src/{evaluation,requirement,review,rubric}, re-verifies
 * the R6-H §1 hot-tier slice gain ceiling (mandated: re-measure, don't
 * assume) and the cold-tier once-per-process class. All candidates are NEW
 * angles not named by EXCLUSIONS.md or R1-H..R6-H (S1-H-1..9, S2-H-1..7,
 * S3-H-1..4, S4-H-1..3, S5-H-1..3, S6-H-1..4):
 *   S7-H-1: production-chain async machinery elimination (sync-ified
 *           extractor/critic/builder replicas; R2-H's no-ID note covered
 *           only the test-only ProjectAdapter faces).
 *   S7-H-2: normalizeSources `signals` (3 regex scans per source) is
 *           composition-dead in the production chain (Proxy-trace proof,
 *           S6-H-2 mechanism at a never-named site).
 *   S7-H-3: module-load JIT pre-warm (priming call before the real first
 *           call) — the natural follow-up to R6-H's execution-tier layer.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0x774801..0x774804.
 *
 * Reference = production imports wherever the function is exported; private
 * helpers are replicated verbatim and each candidate differs from the
 * replica ONLY by the candidate edit. Replica-vs-production sanity gates
 * precede every candidate adjudication.
 */
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import {
  extractHeuristicContract,
  heuristicExtractor,
  heuristicCritic,
  isVague,
  namedTargets,
  shouldScout,
  HEURISTIC_EXTRACTOR_ROLE,
  HEURISTIC_CRITIC_ROLE,
  type HeuristicHabits
} from "/workspace/src/requirement/heuristic.js";
import {
  buildContractCandidate,
  type ContractCandidate,
  type ContractCritic,
  type RequirementExtractor,
  type AuthorityGrounding,
  type LatentRequirement,
  type LabeledInference
} from "/workspace/src/requirement/extractor.js";
import {
  normalizeSources,
  createTrustedSource,
  type NormalizedSource,
  type RawSource
} from "/workspace/src/requirement/normalizer.js";
import { critiqueContract, type ContractCritique } from "/workspace/src/requirement/critic.js";
import {
  assertCoverageAllowsStart,
  type CoverageTaskRef
} from "/workspace/src/requirement/coverage.js";
import { applyPrecedence } from "/workspace/src/requirement/precedence.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import {
  validateRequirementContract,
  type RequirementContract
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

/* ----------------------------------------------------------------
 * Shared fuzz material (R3-H lattice): objectives spanning every
 * heuristic branch and the full habits lattice.
 * ---------------------------------------------------------------- */
const VERBS = ["implement", "fix", "add", "refactor", "investigate", "polish", "update", "rename"];
const TAILS = [
  "the login retry bug in src/auth/session.ts",
  "the parser and keep tests green",
  "coverage reporting for the qa dashboard",
  "a typo in README.md",
  "one-line change in config.json",
  "stuff",
  "the flaky timeout logic across the scheduler and make coverage stay stable",
  "session handling",
  "qa checks",
  "docs/reports/index.md and src/a.ts"
];
function genObjective(rng: () => number): string {
  if (rng() < 0.08) return pick(rng, ["hm", "do it", "fix", "please make it better somehow"]);
  return `${pick(rng, VERBS)} ${pick(rng, TAILS)}`;
}
function genHabits(rng: () => number): HeuristicHabits {
  const tri = (r: number): boolean | undefined => (r < 0.34 ? undefined : r < 0.67 ? true : false);
  const habits: Record<string, boolean> = {};
  const rt = tri(rng());
  const pr = tri(rng());
  const abw = tri(rng());
  if (rt !== undefined) habits.requireTests = rt;
  if (pr !== undefined) habits.preferReview = pr;
  if (abw !== undefined) habits.askBeforeWrite = abw;
  return habits as HeuristicHabits;
}

/* ----------------------------------------------------------------
 * Verbatim replicas of the private pieces of the production chain,
 * factored so (a) an async no-edit replica can be sanity-gated
 * against production and (b) the S7-H-1 sync-ified variant and the
 * S7-H-2 from-normalized variant differ ONLY by their candidate edit.
 * ---------------------------------------------------------------- */
const SMALLEST_CHANGE = {
  id: "c-smallest",
  description: "Change only files required by the objective; no drive-by refactors",
  enforceable: false
};
const DEFAULT_NON_GOALS = [
  "Unrelated refactors",
  "Drive-by dependency upgrades",
  "Rewriting files not required by the objective"
];
function shouldAskScopeReplica(objective: string): boolean {
  if (shouldScout(objective)) return false;
  if (namedTargets(objective).length > 0) return false;
  return /\b(implement|fix|add|rename|change|update|refactor)\b/i.test(objective);
}

interface SyncExtractionResult {
  readonly contract: RequirementContract;
  readonly confidence: number;
  readonly inferences: readonly LatentRequirement[];
  readonly authorityGrounding: readonly AuthorityGrounding[];
}

/** Verbatim body of heuristicExtractor().extract as a plain sync function. */
function replicaExtractSyncBody(
  habits: HeuristicHabits,
  input: { readonly objective: string; readonly sources: readonly NormalizedSource[] }
): SyncExtractionResult {
  const objective = input.objective.trim();
  const vague = isVague(objective);
  const wantsTests = habits.requireTests === true || /\b(tests?|coverage|qa)\b/i.test(objective);
  const wantsReview = habits.preferReview !== false;
  const questions = vague
    ? [
        {
          id: "q-done",
          question: "What does done look like for this work?",
          options: ["ship a code change", "investigation only", "tests and a code change"]
        },
        {
          id: "q-tests",
          question: "Should the plan include running or adding tests?",
          options: ["yes", "no", "only if existing tests fail"]
        }
      ]
    : [];
  if (!vague && habits.requireTests === undefined && !/\b(tests?|coverage)\b/i.test(objective)) {
    questions.push({
      id: "q-tests",
      question: "Should the plan include running or adding tests?",
      options: ["yes", "no", "only if existing tests fail"]
    });
  }
  if (shouldAskScopeReplica(objective) && !questions.some((question) => question.id === "q-scope")) {
    questions.push({
      id: "q-scope",
      question: "Which files or modules should this change touch?",
      options: ["the files named in the objective", "let scout discover them", "I will paste paths"]
    });
  }
  if (habits.askBeforeWrite === true && !questions.some((question) => question.id === "q-write")) {
    questions.push({
      id: "q-write",
      question: "May the agent write files, or is this investigation only?",
      options: ["write files", "investigation only"]
    });
  }
  const targets = namedTargets(objective);
  const objectiveRefs = input.sources.map((source) => source.ref);
  const contract = validateRequirementContract({
    schemaVersion: 1,
    objective,
    deliverables: [
      {
        id: "d-change",
        description: vague ? "Change set matching the clarified objective" : `Deliver ${objective}`,
        artifactKind: "diff",
        sourceRefs: objectiveRefs
      },
      ...targets.map((path, index) => ({
        id: `d-file-${index + 1}`,
        description: path,
        artifactKind: "file",
        sourceRefs: objectiveRefs
      }))
    ],
    constraints: [
      { ...SMALLEST_CHANGE, assumptionIds: ["a-defaults"] },
      ...(wantsTests
        ? [{ id: "c-tests", description: "Tests must stay green", enforceable: true, sourceRefs: objectiveRefs }]
        : [])
    ],
    nonGoals: DEFAULT_NON_GOALS,
    acceptanceCriteria: [
      {
        id: "ac-objective",
        description: "The stated objective is addressed",
        observableCheck: "run.status is COMPLETED and child TASK_RESULT summaries cover the objective",
        sourceRefs: objectiveRefs
      },
      ...(wantsTests
        ? [
            {
              id: "ac-tests",
              description: "Tests ran",
              observableCheck: "tester child TASK_RESULT verification is PASSED",
              sourceRefs: objectiveRefs
            }
          ]
        : [])
    ],
    assumptions: [
      {
        id: "a-defaults",
        statement: "The smallest-change constraint is a heuristic default pending user confirmation",
        source: "heuristic-default"
      },
      ...(vague
        ? [{ id: "a-vague", statement: "Objective is underspecified until the user answers", source: "heuristic" }]
        : [])
    ],
    questions,
    authority: [],
    sourceRefs: objectiveRefs
  });
  const confidence = vague ? 0.55 : wantsReview ? 0.86 : 0.8;
  return { contract, confidence, inferences: [], authorityGrounding: [] };
}

/** Verbatim body of heuristicCritic().critique as a plain sync function. */
function replicaCritiqueSyncBody(contract: RequirementContract): ContractCritique {
  const critique = critiqueContract(contract);
  const omissions = [...critique.omissions];
  if (contract.questions.length > 0 && contract.acceptanceCriteria.length === 0) {
    omissions.push("acceptance-missing-while-questions-open");
  }
  return { ...critique, omissions };
}

function validateConfidenceReplica(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be between 0 and 1`);
  }
}
function assertAuthorityGroundingReplica(
  contract: RequirementContract,
  grounding: readonly AuthorityGrounding[],
  sources: readonly NormalizedSource[]
): void {
  const sourcesByRef = new Map(sources.map((source) => [source.ref.ref, source]));
  for (let authorityIndex = 0; authorityIndex < contract.authority.length; authorityIndex += 1) {
    const entry = grounding.find((item) => item.authorityIndex === authorityIndex);
    const trusted = entry?.sourceRefs.some((ref) => sourcesByRef.get(ref)?.canGrantAuthority === true) ?? false;
    if (!trusted) {
      throw new DomainValidationError(
        `authority grant ${authorityIndex} requires a user or approved-project source`
      );
    }
  }
}

/* ================================================================
 * S7-H-1: production-chain async machinery elimination. The chain
 * extractHeuristicContract (async wrapper) -> buildContractCandidate
 * (async, 2 awaits) -> heuristicExtractor.extract (async fn, no
 * internal await) / heuristicCritic.critique (async fn, no internal
 * await) allocates promises and hops microtasks for work that is
 * fully synchronous. Candidate = the whole chain sync-ified (sync
 * extension-point interfaces). R2-H's no-ID note covered only the
 * test-only ProjectAdapter async faces; the production chain was
 * never adjudicated. Sanity gate: an async verbatim replica must be
 * bit-identical to production first.
 * ================================================================ */
function replicaChainSync(input: {
  readonly objective: string;
  readonly sources?: readonly RawSource[];
  readonly habits?: HeuristicHabits;
}): ContractCandidate {
  const rawSources =
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
  const extractorRoleId = HEURISTIC_EXTRACTOR_ROLE;
  const criticRoleId = HEURISTIC_CRITIC_ROLE;
  // verbatim buildContractCandidate body, sync-ified (the candidate edit)
  if (extractorRoleId.trim() === "" || criticRoleId.trim() === "") {
    throw new DomainValidationError("extractor and critic role ids are required");
  }
  if (extractorRoleId === criticRoleId) {
    throw new DomainValidationError("extractor and critic must use independently versioned roles");
  }
  const sources = normalizeSources([...rawSources]);
  const extracted = replicaExtractSyncBody(habits, { objective: input.objective, sources });
  validateConfidenceReplica(extracted.confidence, "extraction confidence");
  const minimumConfidence = 0.8;
  validateConfidenceReplica(minimumConfidence, "minimum confidence");
  const contract = validateRequirementContract(extracted.contract);
  assertAuthorityGroundingReplica(contract, extracted.authorityGrounding, sources);
  const critique = replicaCritiqueSyncBody(contract);
  const sourceRefs = new Set(sources.map((source) => source.ref.ref));
  const inferences = extracted.inferences.map((inference): LabeledInference => {
    validateConfidenceReplica(inference.confidence, "inference confidence");
    const corroborated =
      inference.corroboratedSourceRefs.length > 0 &&
      inference.corroboratedSourceRefs.every((ref) => sourceRefs.has(ref));
    return { ...inference, status: corroborated ? "corroborated" : "needs-confirmation" };
  });
  const requiresUserDecision =
    extracted.confidence < minimumConfidence ||
    inferences.some((inference) => inference.status === "needs-confirmation") ||
    critique.contradictions.length > 0 ||
    critique.omissions.length > 0;
  return {
    contract,
    critique,
    extractorRoleId,
    criticRoleId,
    confidence: extracted.confidence,
    inferences,
    requiresUserDecision
  };
}

/** Async verbatim replica (no edits) for the sanity gate: wraps the same
 * sync bodies in the production async extension-point shape. */
function replicaExtractorAsync(habits: HeuristicHabits): RequirementExtractor {
  return {
    roleId: HEURISTIC_EXTRACTOR_ROLE,
    async extract(input) {
      return replicaExtractSyncBody(habits, input);
    }
  };
}
function replicaCriticAsync(): ContractCritic {
  return {
    roleId: HEURISTIC_CRITIC_ROLE,
    async critique(input) {
      return replicaCritiqueSyncBody(input.contract);
    }
  };
}
async function replicaChainAsync(input: {
  readonly objective: string;
  readonly habits?: HeuristicHabits;
}): Promise<ContractCandidate> {
  const sources = [
    createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: input.objective })
  ];
  return buildContractCandidate({
    objective: input.objective,
    sources: [...sources],
    extractor: replicaExtractorAsync(input.habits ?? {}),
    critic: replicaCriticAsync(),
    minimumConfidence: 0.8
  });
}

{
  const rng = mulberry32(0x774801);
  for (let trial = 0; trial < 2500; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const args = { objective, ...(Object.keys(habits).length > 0 ? { habits } : {}) };
    const ref = JSON.stringify(await extractHeuristicContract(args));
    const asyncReplica = JSON.stringify(await replicaChainAsync(args));
    check("S7-H-1 sanity gate (async replica bit-identical)", ref === asyncReplica, `objective="${objective}"`);
    const syncCand = JSON.stringify(replicaChainSync(args));
    check("S7-H-1 equivalence (sync-ified chain)", ref === syncCand, `objective="${objective}" habits=${JSON.stringify(habits)}`);
  }
  // Isolated async-machinery cost: mirror the chain's promise structure
  // (outer async wrapper -> async body awaiting two async leaf fns) vs the
  // plain synchronous calls, with identical trivial work.
  const leafA = async (): Promise<number> => 21;
  const leafB = async (): Promise<number> => 21;
  const bodyAsync = async (): Promise<number> => (await leafA()) + (await leafB());
  const wrapperAsync = (): Promise<number> => bodyAsync();
  const leafAS = (): number => 21;
  const leafBS = (): number => 21;
  const bodySync = (): number => leafAS() + leafBS();
  let sink = 0;
  const asyncCost = await benchAsync(async () => {
    sink += await wrapperAsync();
  }, 200000);
  const syncCost = bench(() => {
    sink += bodySync();
  }, 200000);
  // End-to-end: production chain vs sync-ified replica chain.
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const cur = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  const cand = bench(() => void replicaChainSync({ objective }), 3000);
  log(
    `S7-H-1 isolated async machinery (3 async frames + 2 awaits, trivial work): async=${(asyncCost * 1e6).toFixed(0)}ns sync=${(syncCost * 1e6).toFixed(0)}ns machinery=${((asyncCost - syncCost) * 1e6).toFixed(0)}ns/chain (sink=${sink > 0})`
  );
  log(
    `S7-H-1 bench full chain: current(async)=${(cur * 1e6).toFixed(0)}ns sync-ified cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (once per run; landing requires sync-ifying the PUBLIC RequirementExtractor/ContractCritic/buildContractCandidate signatures = X0-4 class)`
  );
}

/* ================================================================
 * S7-H-2: normalizeSources computes `signals` via 3 regex scans per
 * source, but the production composition (heuristic extractor reads
 * only source.ref; heuristicCritic ignores sources; builder reads
 * only source.ref.ref [+ canGrantAuthority inside the grounding loop
 * that never runs with authority=[]]) never consumes it. Same
 * composition-dead-output mechanism as S6-H-2 (taskToChecks), at a
 * site never named in six passes. Deadness proof: Proxy trace over
 * every NormalizedSource through a from-normalized verbatim replica
 * of the full chain. Extension-point liveness probe: a custom
 * extractor that reads signals MUST diverge under the skip-signals
 * variant — signals is contract output for arbitrary extractors.
 * ================================================================ */
async function replicaBuildFromNormalized(input: {
  readonly objective: string;
  readonly sources: readonly NormalizedSource[];
  readonly extractor: RequirementExtractor;
  readonly critic: ContractCritic;
  readonly minimumConfidence?: number;
}): Promise<ContractCandidate> {
  if (input.extractor.roleId.trim() === "" || input.critic.roleId.trim() === "") {
    throw new DomainValidationError("extractor and critic role ids are required");
  }
  if (input.extractor.roleId === input.critic.roleId) {
    throw new DomainValidationError("extractor and critic must use independently versioned roles");
  }
  const sources = input.sources; // the only difference: sources arrive pre-normalized
  const extracted = await input.extractor.extract({ objective: input.objective, sources });
  validateConfidenceReplica(extracted.confidence, "extraction confidence");
  const minimumConfidence = input.minimumConfidence ?? 0.8;
  validateConfidenceReplica(minimumConfidence, "minimum confidence");
  const contract = validateRequirementContract(extracted.contract);
  assertAuthorityGroundingReplica(contract, extracted.authorityGrounding, sources);
  const critique = await input.critic.critique({ contract, sources });
  const sourceRefs = new Set(sources.map((source) => source.ref.ref));
  const inferences = extracted.inferences.map((inference): LabeledInference => {
    validateConfidenceReplica(inference.confidence, "inference confidence");
    const corroborated =
      inference.corroboratedSourceRefs.length > 0 &&
      inference.corroboratedSourceRefs.every((ref) => sourceRefs.has(ref));
    return { ...inference, status: corroborated ? "corroborated" : "needs-confirmation" };
  });
  const requiresUserDecision =
    extracted.confidence < minimumConfidence ||
    inferences.some((inference) => inference.status === "needs-confirmation") ||
    critique.contradictions.length > 0 ||
    critique.omissions.length > 0;
  return {
    contract,
    critique,
    extractorRoleId: input.extractor.roleId,
    criticRoleId: input.critic.roleId,
    confidence: extracted.confidence,
    inferences,
    requiresUserDecision
  };
}

/** Skip-signals normalizeSources replica (the candidate edit). */
function candidateNormalizeSkipSignals(sources: RawSource[]): NormalizedSource[] {
  return normalizeSources(sources).map((normalized) => ({ ...normalized, signals: [] }));
}
/** Verbatim replica of the private extractSignals for cost isolation. */
function extractSignalsReplica(text: string): string[] {
  const signals: string[] = [];
  if (/must|shall|required/i.test(text)) signals.push("requirement");
  if (/not|never|avoid/i.test(text)) signals.push("constraint");
  if (/accept|pass|verify|test/i.test(text)) signals.push("acceptance");
  return signals;
}

{
  const rng = mulberry32(0x774802);
  // Sanity gate: from-normalized replica === production on the full chain.
  for (let trial = 0; trial < 1500; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const args = { objective, ...(Object.keys(habits).length > 0 ? { habits } : {}) };
    const ref = JSON.stringify(await extractHeuristicContract(args));
    const raw = [
      createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })
    ];
    const rep = JSON.stringify(
      await replicaBuildFromNormalized({
        objective,
        sources: normalizeSources([...raw]),
        extractor: heuristicExtractor(habits),
        critic: heuristicCritic(),
        minimumConfidence: 0.8
      })
    );
    check("S7-H-2 sanity gate (from-normalized replica bit-identical)", ref === rep, `objective="${objective}"`);
    // Candidate: skip-signals normalization through the same chain.
    const cand = JSON.stringify(
      await replicaBuildFromNormalized({
        objective,
        sources: candidateNormalizeSkipSignals([...raw]),
        extractor: heuristicExtractor(habits),
        critic: heuristicCritic(),
        minimumConfidence: 0.8
      })
    );
    check("S7-H-2 equivalence (skip-signals through production composition)", ref === cand, `objective="${objective}"`);
  }
  // Deadness proof: Proxy trace of every NormalizedSource property the
  // production composition touches.
  const touched = new Set<string>();
  const rng2 = mulberry32(0x774802);
  for (let trial = 0; trial < 1000; trial += 1) {
    const objective = genObjective(rng2);
    const habits = genHabits(rng2);
    const raw = [
      createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })
    ];
    const proxied = normalizeSources([...raw]).map(
      (source) =>
        new Proxy(source, {
          get(target, prop, receiver) {
            if (typeof prop === "string") touched.add(prop);
            return Reflect.get(target, prop, receiver);
          }
        })
    );
    await replicaBuildFromNormalized({
      objective,
      sources: proxied,
      extractor: heuristicExtractor(habits),
      critic: heuristicCritic(),
      minimumConfidence: 0.8
    });
  }
  check(
    "S7-H-2 deadness proof: production composition never reads signals",
    !touched.has("signals") && !touched.has("text") && !touched.has("origin") && !touched.has("authority"),
    `touched=${[...touched].join(",")}`
  );
  log(
    `S7-H-2 proxy trace: production composition touched NormalizedSource props {${[...touched].sort().join(", ")}} over 1000 cases -> signals/text/origin/authority are dead in THIS composition`
  );
  // Extension-point liveness probe: an extractor that READS signals must
  // diverge under the skip-signals variant — signals is contract output for
  // arbitrary RequirementExtractor implementations, so the field is NOT
  // universally dead and normalizeSources cannot drop it.
  const signalsReader: RequirementExtractor = {
    roleId: "signals-reader-v1",
    async extract(input) {
      const signalTag = input.sources[0]?.signals.join("+") || "none";
      const contract = validateRequirementContract({
        schemaVersion: 1,
        objective: `${input.objective} [signals:${signalTag}]`,
        deliverables: [],
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: [],
        assumptions: [],
        questions: [],
        authority: [],
        sourceRefs: input.sources.map((source) => source.ref)
      });
      return { contract, confidence: 0.9, inferences: [], authorityGrounding: [] };
    }
  };
  const probeObjective = "verify the exporter must never fail"; // hits all 3 signal regexes
  const rawProbe = [
    createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: probeObjective })
  ];
  const liveRef = await replicaBuildFromNormalized({
    objective: probeObjective,
    sources: normalizeSources([...rawProbe]),
    extractor: signalsReader,
    critic: heuristicCritic(),
    minimumConfidence: 0.8
  });
  const liveCand = await replicaBuildFromNormalized({
    objective: probeObjective,
    sources: candidateNormalizeSkipSignals([...rawProbe]),
    extractor: signalsReader,
    critic: heuristicCritic(),
    minimumConfidence: 0.8
  });
  check(
    "S7-H-2 extension-point liveness: signals-reading extractor must diverge",
    liveRef.contract.objective !== liveCand.contract.objective,
    `ref="${liveRef.contract.objective}" cand="${liveCand.contract.objective}"`
  );
  log(
    `S7-H-2 extension-point probe: signals-reader extractor objective ref="...${liveRef.contract.objective.slice(-30)}" vs skip-signals cand="...${liveCand.contract.objective.slice(-30)}" -> NOT universally dead; only the heuristic composition is`
  );
  // Cost isolation at production scale (1 source = the objective string).
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const signalsCost = bench(() => void extractSignalsReplica(objective), 200000);
  const chain = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  log(
    `S7-H-2 cost isolation: extractSignals(3 regex scans, 1 production source)=${(signalsCost * 1e6).toFixed(0)}ns vs one extractHeuristicContract=${(chain * 1e6).toFixed(0)}ns -> dead share ${((signalsCost / chain) * 100).toFixed(1)}% of a once-per-run call`
  );
}

/* ================================================================
 * S7-H-3: module-load JIT pre-warm. R6-H closed the execution-tier
 * layer by measuring that the slice's production entries always run
 * interpreter-cold (~1.65-1.71ms first call vs ~6µs warm). The
 * natural follow-up nobody adjudicated: run a PRIMING call with
 * dummy input at module load so the real first call executes in a
 * higher tier. Adjudication = fresh-process probes on dist:
 * baseline (real call cold) vs primed (dummy call, then real call).
 * The candidate's critical path is warmup+real; the tier benefit is
 * real(primed) vs real(baseline).
 * ================================================================ */
{
  const baselineScript = `
    const { performance } = await import("node:perf_hooks");
    const { extractHeuristicContract } = await import("/workspace/dist/requirement/heuristic.js");
    const { assertCoverageAllowsStart } = await import("/workspace/dist/requirement/coverage.js");
    const { applyPrecedence } = await import("/workspace/dist/requirement/precedence.js");
    const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
    const t0 = performance.now();
    const prod = await extractHeuristicContract({ objective });
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: "tsk_0000000" + i,
      acceptanceCriteria: prod.contract.acceptanceCriteria.map((c) => ({ id: c.id }))
    }));
    assertCoverageAllowsStart(prod.contract, tasks);
    applyPrecedence(prod.contract, "user-first");
    const t1 = performance.now();
    process.stdout.write((t1 - t0).toFixed(3));
  `;
  const primedScript = `
    const { performance } = await import("node:perf_hooks");
    const { extractHeuristicContract } = await import("/workspace/dist/requirement/heuristic.js");
    const { assertCoverageAllowsStart } = await import("/workspace/dist/requirement/coverage.js");
    const { applyPrecedence } = await import("/workspace/dist/requirement/precedence.js");
    // the candidate edit: a module-load priming pass over the same entries
    const w0 = performance.now();
    const warm = await extractHeuristicContract({ objective: "add coverage checks for the warmup module in src/warm/init.ts" });
    const warmTasks = Array.from({ length: 5 }, (_, i) => ({
      id: "tsk_1000000" + i,
      acceptanceCriteria: warm.contract.acceptanceCriteria.map((c) => ({ id: c.id }))
    }));
    assertCoverageAllowsStart(warm.contract, warmTasks);
    applyPrecedence(warm.contract, "user-first");
    const w1 = performance.now();
    // the real first call
    const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
    const t0 = performance.now();
    const prod = await extractHeuristicContract({ objective });
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: "tsk_0000000" + i,
      acceptanceCriteria: prod.contract.acceptanceCriteria.map((c) => ({ id: c.id }))
    }));
    assertCoverageAllowsStart(prod.contract, tasks);
    applyPrecedence(prod.contract, "user-first");
    const t1 = performance.now();
    process.stdout.write((w1 - w0).toFixed(3) + " " + (t1 - t0).toFixed(3));
  `;
  const baseline: number[] = [];
  const warmups: number[] = [];
  const primedReal: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const b = spawnSync(process.execPath, ["--input-type=module", "-e", baselineScript], { encoding: "utf8" });
    if (b.status !== 0) {
      check("S7-H-3 baseline probe runs", false, b.stderr);
      break;
    }
    baseline.push(Number(b.stdout.trim()));
    const p = spawnSync(process.execPath, ["--input-type=module", "-e", primedScript], { encoding: "utf8" });
    if (p.status !== 0) {
      check("S7-H-3 primed probe runs", false, p.stderr);
      break;
    }
    const [w, r] = p.stdout.trim().split(" ").map(Number) as [number, number];
    warmups.push(w);
    primedReal.push(r);
  }
  const median = (xs: number[]): number => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  };
  const mb = median(baseline);
  const mw = median(warmups);
  const mr = median(primedReal);
  log(
    `S7-H-3 fresh-process probes (dist, 5 samples each): baseline real first call=${(mb * 1e3).toFixed(0)}µs; primed: warmup=${(mw * 1e3).toFixed(0)}µs + real=${(mr * 1e3).toFixed(0)}µs = critical path ${((mw + mr) * 1e3).toFixed(0)}µs -> net ${((mw + mr - mb) * 1e3).toFixed(0)}µs vs baseline (positive = pre-warm makes the critical path WORSE)`
  );
  log(
    `S7-H-3 tier-up effect in isolation: real call drops ${(mb * 1e3).toFixed(0)}µs -> ${(mr * 1e3).toFixed(0)}µs, but the warmup itself costs ${(mw * 1e3).toFixed(0)}µs on the same critical path (once-per-process class either way)`
  );
  check("S7-H-3 probes produced numbers", Number.isFinite(mb) && Number.isFinite(mw) && Number.isFinite(mr));
}

/* ================================================================
 * Ceiling re-verification (R6-H §1, mandated: re-measure, don't
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

if (failures > 0) {
  process.stderr.write(`\n${failures} equivalence check(s) FAILED\n`);
  process.exit(1);
}
log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r7-h-eval-seventh-pass-83a1

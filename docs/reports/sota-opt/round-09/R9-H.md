MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第九遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 9 / R9-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `af7a423`（独占 tip，含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3 排除全表）
**分支:** `cursor/r9-h-eval-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 21 个文件
（1750 行，本轮 `wc -l` 复核逐文件一致）自 R1-H 基线（`fd437a9`）以来
**逐字节未变**（`git diff fd437a9..af7a423 -- src/{evaluation,requirement,review,rubric}/`
为空，九遍全程零 diff），且 R8-H 基线（`1cae2db`）之后 `src/` **零提交**
（`git log 1cae2db..af7a423 -- src/` 为空——其间全部 26 个提交均为
报告/排除表文档；R9-A/B/C/D/F 全数无落地）⇒ 生产调用方地图**可证不变**，
本轮全库 import 交叉检索再次独立确认（8 个导入位点与 R3-H…R8-H 完全
一致；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
`src/rubric/` 及 `applyRoutingScoreUpdate`、`buildContractFromSources`
等导出面仍零生产调用方——本轮定向 grep 证实其引用全部落在 `test/`）。
按指令在本 VM 重测三态双层锚点并**首次补齐命令类矩阵的全部剩余格**
（§1.3/§1.4）：热层默认态 **8.4–8.5µs**/run、配置态 A **7.3–7.9µs**、
配置态 B **3.8–4.2µs**（两档配置态均 ≤ 默认态 ⇒ R8-H「无配置态悬崖、
默认锚点是保守上界」结论在本 VM 复现）；晋升类 17.9–20.2ns；四个零
生产调用方命令类首次入锚（evaluate 1.1–1.2µs / critique 0.61–0.62µs /
pairwise 1.98–2.00µs / reconcile 69–71ns）——**即便调用图未来接入，
当前规模下每类也全部 ≤2µs**；冷层首调默认 1709–1760µs、配置
1626–1668µs once-per-process（与 R6-H…R8-H 同带，否决类归属不变）。
第九遍在完整排除表（S1-H-1..9、S2-H-1..7、S3-H-1..4、S4-H-1..3、
S5-H-1..3、S6-H-1..4、S7-H-1..3、S8-H-1..3 及八轮 35+ 处不立 ID 收口）
之上枚举得 2 个**从未点名位点**的新候选（S9-H-1 / S9-H-2），全部经
理论 + 确定性仿真（seeded mulberry32，80,000 项等价/抛错奇偶检查 +
真实规模基准，三次独立运行裁决逐位一致）裁决后淘汰：S9-H-1 等价但
三次基准符号翻转（−0.6/+0.9/+0.1ns）——V8 逃逸分析已把不逃逸的死
中间对象标量替换（S3-I-1 同象），源码删除零可测收益，且该面 test-only；
S9-H-2 等价且方向稳定（9.0–9.5ns/晋升）但整函数生产实测仅 14.3–20.2ns
且频次为每晋升一次（proposal-first 纪律下晋升永不成热循环），低于
落地线 6+ 个数量级。未重开任何 X* / S1-* … S8-* / S9-A/B/C/D/F-* 条目；
S5-H-1 守卫经本轮 diff 复核原样保留。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第九遍实际读码，
  未依赖前八轮记忆。上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts` 只读取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表 509 行，含
  S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3）/
  round-09/PLAN.md / round-08/PLAN.md + R8-H.md / R7-H … R1-H。候选
  枚举刻意绕开全部既有排除，特别核对未触碰：S1-H-9 / S2-H-4 / S3-H-4
  （changeSetsEqual 三面钉死维持，零候选）、S1-H-8 / S2-H-6
  （registerRubric copy-on-write 维持——`{ ...DEFAULT_REGISTRY }` 别名
  安全性经复核成立：全部写路径整体替换 registry，DEFAULT_REGISTRY 永不
  被就地变异）、S5-H-1（detectConflicts 分配前守卫——曾误删后恢复，
  本轮零候选、零 diff，守卫原样）、S6-H-1/2/3、S8-H-1（盲评输入形状
  未收窄）、S8-H-3（未做任何全决议快路径）、S7-H-1/2/3、X4-9 / X0-5 /
  X0-6。H/score 未写任何路由 PASS/FAIL。
- 换名重提检查（识别为既有方案换名/换位点或指令明文排除类，**未列为
  新候选**）：
  - `createCriticObservation` 的 score 对象条件键（`if (ev)
    score.evidenceRef = ev`）单态化（恒置键）= **S9-D-1 输出形状单态化
    机制在 H 位点** + 指令明文 PIC 纪律（「不得落地改变属性存在性可观察
    面的无条件字段物化」，S1-C-10 类）+ 该面 test-only，三重拒列；
  - `createEvaluationRecord` 聚合谓词惰性链化（hasAnyFail 命中时跳过
    allUnobserved/hasAnyPass 计算）= S1-H-7 同函数同判（test-only +
    ns 级），拒列；
  - `reconcileReviews` dissent 为空时跳过 `Array.from(new Set(...))` =
    S1-H-6 同函数量级支配（n=2 亚噪声）+ 零生产调用方，拒列；
  - `heuristicCritic` 的 `acceptance-missing-while-questions-open` 分支
    在生产组合中可证死（heuristic extractor 无条件产出 ac-objective ⇒
    acceptanceCriteria 恒非空）= S6-H-2/S7-H-2 组合死输出家族——删除
    即破坏对任意合同的扩展点一般性，拒列；
  - heuristic.ts 六处函数体内联正则字面量提升模块常量 = S1-B-1 正则
    提升家族（V8 已缓存编译产物，仅省每评估 ~几十 ns 对象分配），拒列；
  - `buildContractCandidate` 常量 roleId 的 `.trim()` 分配 = R8-H 换名
    重提清单原条目维持，拒列；
  - `applyRoutingScoreUpdate` 与 `assertCanPromoteFromReview` 两入口对
    `assertNotSelfReview` 的参数形状二态（显式字面量 vs spread）单态化
    = S8-A-3/S8-E-2 明文测量伪影类，拒列（S9-H-2 只裁决 spread 本体的
    分配成本，不裁决形状效应）。
- R8-H §1 的三态双层上界按指令**先复核后引用**：本报告 §1 以三次独立
  实测在本 VM 重建全部锚点，并补齐命令类矩阵剩余格，未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无
  命令权、H/score 不写路由、live = R0 等价、双 LCB 与双归因保留、
  阈值/权限/数据面契约/公开签名不变（含 S7-H-1 Promise 扩展点、
  S7-H-2 signals 活契约、S8-H-1 PairwiseInput 全形状）、测试未改，
  天然成立。不声称 Outcome-supported，Checkpoint F-PROD 仍开放
  （ADR-005）。

## 1. 基线不变性、调用图复核与上界重测（含命令类矩阵补全）

1. **切片逐字节未变**：`git diff fd437a9..af7a423 -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交（九遍全程零 diff）。21 文件
   1750 行逐文件计数与 R1-H 清单一致。R1-H 逐函数下界表、R2-H 调用图
   上界、R3-H 重复工作枚举、R4-H 三类角度收口、R5-H 三层级收口、
   R6-H 执行层级收口、R7-H 机器成本三面收口、R8-H 配置态矩阵收口与
   全部 S*-H-* 排除继承有效。
2. **调用图可证不变（最强形式）**：`git log 1cae2db..af7a423 -- src/`
   **为空**——R8-H 基线以来 26 个提交全部是 `docs/reports/` 文档
   （R8-F…R8-J 报告、R9 波次报告与排除表并入），R9-A/B/C/D/F 均无
   代码落地 ⇒ 无需逐提交论证，生产调用方地图数学上不变。本轮全库
   import 检索双确认（8 位点，频次逐一复核）：`assertCoverageAllowsStart`
   ← `run/{supervisor,coordinator,flowchart-run}.ts`（每 run 启动一次，
   且仅当 `input.contract !== undefined`）；`extractHeuristicContract`
   ← `track/clarify.ts`（每 run 一次）；`applyPrecedence` ←
   `track/loop.ts`（每 run 一次，`"user-first"`）；`shouldScout` ←
   `track/plan.ts`（每 run 一次）；`assertCanPromoteFromReview` ←
   `adaptation/promotion-rules.ts`（每晋升一次）；其余全部为类型导入。
   `src/evaluation/` 全 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/`、`applyRoutingScoreUpdate`、`buildContractFromSources`
   零生产调用方（定向 grep：引用仅存在于 `test/unit/` 与
   `test/integration/`）。
3. **热层三态锚点重测**（三次运行区间，本 VM，Node 22.22.2）：

```text
CEILING default  (8-pass anchor shape, Q=0):        8436-8486ns/run
CEILING configured A (habits 三键全设, Q=1 gated):   7283-7892ns/run
CEILING configured B (vague objective, Q=3 gated):   3834-4209ns/run
CEILING promotion class: assertCanPromoteFromReview=17.9-20.2ns/promotion
```

   两档配置态三次全部 ≤ 默认态（gated 重映射真实执行：production
   assume-defaults 流恒传覆盖全部问题的 `resolvedQuestionIds`）——
   R8-H「无配置态悬崖」结论在本 VM 复现；绝对值落在九轮历史跨 VM 带
   （3.9–10µs）内，属测量环境差异而非调用图变更（§1.2 已证零变更）。
4. **命令类矩阵补全（本轮新增的最后一组格）**：R8-H 只锚了 run-start
   与 promotion 两个**生产**命令类；本轮把指令点名的其余四类
   （evaluate / critique / reconcile / pairwise）全部入锚——它们在
   当前调用图下均无生产命令面（§1.2 零调用方 grep），锚点意义是
   **前瞻上界**：即便未来接线，当前规模下也全部低于落地线 4+ 个数量级：

```text
CEILING evaluate class  (TEST-ONLY): createEvaluationRecord(3 criteria) = 1105-1216ns/call
CEILING critique class  (chain 内):  critiqueContract(real contract)    = 611-622ns/call
CEILING pairwise class  (TEST-ONLY): runBlindPairwisePair               = 1975-2003ns/call
CEILING reconcile class (TEST-ONLY): reconcileReviews(n=2)              = 69-71ns/call
```

   至此「配置态（3 档）× 命令类（6 类）× 执行层（热/冷）」矩阵无
   未测格：门槛第 3 条在每一格上都结构性不可满足。
5. **冷层锚点复测（默认 + 配置双态）**：dist 产物、新进程、模块加载
   预扣除后，三生产入口首调合计中位数三次：默认态
   **1760/1709/1709µs**、配置态 **1664/1668/1626µs**——与 R6-H
   1.65–1.71ms / R7-H 1.72–1.76ms / R8-H 1.6–1.7ms 同带；
   once-per-process 否决类归属不变（S7-H-3 已证该层无净正对策）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-H-1 | `applyRoutingScoreUpdate` 死中间对象消除：函数体构造 `const update: RoutingScoreUpdate = { actorId, delta }` 后仅读回 `update.delta`——`actorId` 字段零读取、对象零逃逸，可证死中间体（S9-D-3 死码家族在从未点名位点；八轮报告从未检视该函数体） | 免 1 次 2 字段对象分配/调用 | ✅ 20,000 组 fuzz（reviewerKind × id 相等格 × score/delta 含 NaN/−0/±Infinity，`Object.is` 值奇偶 + 抛错奇偶双闸；verbatim replica sanity 闸先行零失配） | 三次 delta **−0.6/+0.9/+0.1ns——符号翻转纯抖动**：V8 逃逸分析已把不逃逸对象标量替换（S3-I-1「V8 已标量替换」同象），源码级删除零可测收益 | 淘汰三重：(a) 零可测收益（逃逸分析地板）；(b) 该面自 R1-H 起九轮零生产调用方（引用仅 `test/unit/review/self-review.test.ts`，S1-E-7 类）；(c) 该中间体是公开导出类型 `RoutingScoreUpdate` 在仓内唯一值级使用位点，删除后类型面退化为纯声明——负收益改动 |
| S9-H-2 | `assertCanPromoteFromReview` 的 `{...opts, action}` 参数 spread 换显式 4 字段字面量（S8-H-2 条件 spread 命令式化家族在**唯一有生产调用方的 review 位点**；同文件 `applyRoutingScoreUpdate` 已用显式字面量，两入口形状本就二态） | 免 1 次 spread 迭代协议（own-keys 枚举 + 逐键拷贝） | ✅ 20,000 组 fuzz（kind × 双 id 全格）抛错奇偶逐位一致（verbatim replica sanity 闸先行零失配） | 三次 delta **9.5/9.2/9.0ns/晋升**（方向稳定）；整函数生产实测 14.3–20.2ns | 淘汰：ns 级 once-per-promotion 噪声——晋升在 proposal-first 纪律（ADR-005 / Checkpoint F-PROD 开放）下永不构成热循环，收益频次上界即 §1.3 晋升类锚点，低于落地线 **6+ 个数量级**；与 S8-H-2（103–182ns/run 同判）比还低一个数量级 |

另有七处以既有排除/前轮收口/指令明文纪律直接覆盖、不立新 ID（见 §0
换名重提检查）。第九遍对 21 文件逐一重扫**再未发现任何未被九轮排除表
覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S9-H-1：逃逸分析地板——「死码可证」不等于「删除有收益」

这是本切片第一个被**编译器层**直接判零的候选：消融/等价证明干净
（`update.actorId` 零读取、对象零逃逸，20,000 组含 NaN/−0 的
`Object.is` 值奇偶全过），但三次基准符号翻转（−0.6/+0.9/+0.1ns）——
V8 的逃逸分析在 JIT 层早已把这个不逃逸的小对象标量替换成寄存器值，
源码里删不删它对生成代码无差别。S9-D-3（死码可证、上界 3.1–3.7ns、
零成本保留为防御纵深）与 S3-I-1（元组数组直线化被标量替换吞掉）是
同判先例。additionally，该对象是 `RoutingScoreUpdate` 公开类型在仓内
唯一的值级使用——删除后该导出类型变成无值用途的裸声明，属负收益
改动。该函数至此关闭：test-only 面 + 逃逸分析地板双重钉死。

### 3.2 S9-H-2：晋升类的频次墙——命令类矩阵反向确认否决

S8-H-2 关闭了 heuristic 合同字面量的条件 spread 组（103–182ns/run），
本条是同机制家族在 review 切片唯一生产位点的收口：spread 本体确实
可测（三次 9.0–9.5ns 方向稳定，约占整函数 60%），但频次是**每晋升
一次**——晋升走 proposal-first（人审批准）流程，结构上不可能进入
每 turn/每 run 热路径；§1.3 晋升类锚点（17.9–20.2ns）就是该候选收益
的硬频次上界。至此 `self-review.ts` 三个函数（assertNotSelfReview /
applyRoutingScoreUpdate / assertCanPromoteFromReview）全部有裁决记录，
review 切片四文件九轮合计零未检视结构。

### 3.3 第九遍收口：矩阵满格 + 编译器地板，候选空间三重闭合

R1-H…R8-H 依次闭合了单函数、函数间、跨模块、调用图、模块图、执行
层级、调用机器、配置态八个成本/状态面；本轮补上最后两块：(a) **命令类
矩阵满格**——六个命令类（run-start / promotion / evaluate / critique /
reconcile / pairwise）× 三档配置态 × 双执行层全部有实测锚点，四个零
调用方类的前瞻上界全部 ≤2µs；(b) **编译器地板证据**——S9-H-1 证明
本切片残存的「纸面死分配」已在 JIT 层被消除，源码微编辑连 ns 级收益
都无从兑现。重开该切片的唯一前提维持 R4-H…R8-H 收口原文：调用图变更
（evaluation/review/rubric 面接入每 turn 热路径，或合同规模增长 ≥2 个
量级）。

## 4. 逐文件收口(第九遍新视角，其余与 R1-H…R8-H 一致)

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `review/self-review.ts` | 死中间对象（S9-H-1，逃逸分析地板）；参数 spread 命令式化（S9-H-2，频次墙）；两入口形状二态单态化（S8-A-3 伪影类，拒列） | S9-H-1 / S9-H-2 淘汰 |
| `review/critic.ts` | score 条件键单态化 = S9-D-1 机制 + PIC 纪律明文 + test-only（拒列）；R2-H hasPass 融合收口维持 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` | S8-H-1 三重钉死维持（输入形状未收窄）；reconcile 空 dissent Set 跳过 = S1-H-6 支配（拒列）；pairwise/reconcile 类首次入锚（§1.4） | 无新候选 |
| `evaluation/evaluator.ts` | 聚合谓词惰性链化 = S1-H-7 同站点同判（拒列）；evaluate 类首次入锚（§1.4）；S1-A-8 表族维持 | 无新候选 |
| `evaluation/check-adapter.ts` | changeSetsEqual 三面钉死维持；hashArtifact（S5-H-3）维持；attributionMetadata 全分支活性复核（每 return 路径均消费，无死工作） | 无新候选 |
| `evaluation/` 其余 6 文件 | 纯类型/常量/3 元表/test-only 面；X4-9、S2-H-5、S1-H-7 维持 | 无新候选 |
| `requirement/heuristic.ts` | 内联正则提升 = S1-B-1 族拒列；S8-H-2、S6-H-4、S7-H-1、S3-H-3 维持未重开 | 无新候选 |
| `requirement/coverage.ts` | S1-H-1/2、S4-H-1、S6-H-2/3、S8-H-3 六面钉死维持；未做任何全决议快路径 | 无新候选 |
| `requirement/extractor.ts` / `critic.ts` / `normalizer.ts` / `provenance.ts` | S2-H-1/2、S3-H-1/2、S7-H-2、S2-H-7 维持；critic 组合死分支 = S6-H-2/S7-H-2 家族拒列 | 无新候选 |
| `requirement/precedence.ts` | S1-H-5、S4-H-2、S5-H-1（保留确认）、S6-H-1 四面钉死维持 | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持；`{...DEFAULT_REGISTRY}` 别名在 copy-on-write 纪律下安全（复核，非候选） | 无新候选 |

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
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H…R8-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r9h-sim.mts`，无赢家故未入库以从 round01–08 仅
赢家 sim 入库的仓库惯例；完整源码见附录，seed 固定可复现；冷层探针以
`pnpm build` 后的 dist 产物为准）代表性一次运行：

```text
S9-H-1 bench applyRoutingScoreUpdate: replica(dead intermediate)=11.5ns candidate(no intermediate)=12.0ns delta=-0.6ns/call production=11.7ns (face is TEST-ONLY)
S9-H-2 bench assertCanPromoteFromReview: replica(spread)=14.6ns candidate(explicit literal)=5.2ns delta=9.5ns/promotion production=14.8ns (once per PROMOTION)
CEILING default (8-pass anchor shape): extractHeuristicContract=7469ns + run-start gate(Q=0, no options)=742ns + applyPrecedence=275ns = 8486ns once-per-run production total
CEILING configured A (habits set, Q=1 gated): extractHeuristicContract=6572ns + run-start gate(Q=1, all resolved)=769ns + applyPrecedence=235ns = 7577ns once-per-run production total
CEILING configured B (vague, Q=3 gated): extractHeuristicContract=3360ns + run-start gate(Q=3, all resolved)=474ns + applyPrecedence=141ns = 3975ns once-per-run production total
CEILING promotion class: assertCanPromoteFromReview=20.2ns once per promotion (production)
CEILING evaluate class (TEST-ONLY face): createEvaluationRecord(3 criteria)=1216ns/call
CEILING critique class (inside run-start chain): critiqueContract(real contract)=611ns/call
CEILING pairwise class (TEST-ONLY face): runBlindPairwisePair=1975ns/call
CEILING reconcile class (TEST-ONLY face): reconcileReviews(n=2)=69ns/call
COLD first-call production total (dist, fresh process, default): median=1760µs range=[1724, 1818]µs — once per PROCESS (veto class)
COLD first-call production total (dist, fresh process, configured (habits + Q=1 gated)): median=1664µs range=[1629, 1722]µs — once per PROCESS (veto class)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 80,000 项等价/抛错奇偶检查全部通过、裁决结论逐位一致；
计时抖动内方向稳定（S9-H-1 三次 −0.6/+0.9/+0.1ns 符号翻转＝零收益；
S9-H-2 三次 9.5/9.2/9.0ns 方向一致；默认锚点三次 8486/8436/8459ns、
配置 A 三次 7577/7892/7283ns、配置 B 三次 3975/3834/4209ns；晋升类
三次 20.2/17.9/19.1ns；evaluate 三次 1216/1105/1109ns、critique
611/622/614ns、pairwise 1975/2003/1976ns、reconcile 69/71/69ns；
冷层默认三次 1760/1709/1709µs、配置三次 1664/1668/1626µs）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-H-1 | applyRoutingScoreUpdate 死 RoutingScoreUpdate 中间对象消除 | 等价可证（20,000 组含 NaN/−0 的 Object.is 奇偶）但三次基准符号翻转（−0.6/+0.9/+0.1ns）——V8 逃逸分析已标量替换不逃逸对象（S3-I-1/S9-D-3 同判）；面 test-only（九轮零生产调用方）；且该对象是公开类型 RoutingScoreUpdate 仓内唯一值级使用 |
| S9-H-2 | assertCanPromoteFromReview 参数 spread 换显式字面量 | 等价（20,000 组抛错奇偶）且方向稳定（9.0–9.5ns/晋升）但整函数生产实测仅 14.3–20.2ns、频次每晋升一次（proposal-first 下晋升永不成热循环），低于落地线 6+ 个数量级（S8-H-2 desugaring 家族收口位点） |

重开条件：S9-H-1 无重开条件（逃逸分析地板 + test-only 双重钉死；即便
调用图接入，删除仍零收益）；S9-H-2 需晋升类进入每 turn 热路径——与
proposal-first 纪律（ADR-005）矛盾，实际不可达。总门槛更新：任何候选
须先推翻本报告 §1 的满格矩阵实测上界——热层默认 **8.4–8.5µs/run**、
配置态 **3.8–7.9µs/run**（本 VM，配置态更低 ⇒ 默认锚点是保守上界）、
四个零调用方命令类 ≤2µs、冷层 **1.6–1.8ms once-per-process**（否决类）；
即调用图出现每 turn 新热路径或合同规模 ≥2 个量级增长之前，该切片
结构上无达门槛候选。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：`pnpm build` 后保存为任意 `.mts` 并 `npx tsx <file>`（仓库
根目录，依赖已装；`.mts` 保证 ESM 顶层 await 可用；冷层探针需要 dist
产物存在）。seeds：`0x994801`–`0x994802`。

```ts
/**
 * R9-H deterministic equivalence + benchmark simulation (ninth pass).
 * Adjudicates fresh candidates S9-H-1 .. S9-H-2 against the current
 * implementations in src/{evaluation,requirement,review,rubric}, re-verifies
 * the R8-H §1 three-state hot-tier ceiling on THIS VM (mandated: re-measure,
 * don't assume), and completes the configured-state × command-class matrix
 * with the four never-anchored test-only command classes (evaluate /
 * critique / reconcile / pairwise) plus the promotion class.
 * All candidates are NEW angles not named by EXCLUSIONS.md or R1-H..R8-H
 * (S1-H-1..9, S2-H-1..7, S3-H-1..4, S4-H-1..3, S5-H-1..3, S6-H-1..4,
 * S7-H-1..3, S8-H-1..3):
 *   S9-H-1: applyRoutingScoreUpdate allocates a RoutingScoreUpdate
 *           intermediate object only to read .delta back (its actorId is
 *           never read) — dead-intermediate elimination (S9-D-3 dead-code
 *           family at a never-named site; face is test-only).
 *   S9-H-2: assertCanPromoteFromReview forwards its opts via {...opts,
 *           action} argument spread; candidate replaces the spread with an
 *           explicit 4-field literal (S8-H-2 desugaring family at the ONLY
 *           production-called review site — once per promotion).
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0x994801..0x994804.
 *
 * Reference = production imports wherever the function is exported; private
 * helpers are replicated verbatim and each candidate differs from the
 * replica ONLY by the candidate edit. Replica-vs-production sanity gates
 * precede every candidate adjudication. Benchmarks keep reference and
 * candidate on separate function identities and interleave three rounds to
 * blunt PIC shape-pollution artifacts (S8-A-3 / S8-E-2 / S8-H-1 lesson).
 */
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import {
  extractHeuristicContract,
  type HeuristicHabits
} from "/workspace/src/requirement/heuristic.js";
import {
  assertCoverageAllowsStart,
  type CoverageTaskRef,
  type CoverageStartOptions
} from "/workspace/src/requirement/coverage.js";
import { applyPrecedence } from "/workspace/src/requirement/precedence.js";
import { critiqueContract } from "/workspace/src/requirement/critic.js";
import {
  applyRoutingScoreUpdate,
  assertCanPromoteFromReview,
  type ReviewerKind,
  type RoutingScoreUpdate
} from "/workspace/src/review/self-review.js";
import { runBlindPairwisePair, type PairwiseInput } from "/workspace/src/review/pairwise.js";
import { reconcileReviews } from "/workspace/src/review/reconcile.js";
import { createEvaluationRecord } from "/workspace/src/evaluation/evaluator.js";
import { createRubric } from "/workspace/src/rubric/types.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import type { EpisodeId, TaskId } from "/workspace/src/domain/ids.js";

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
 * S9-H-1: applyRoutingScoreUpdate dead RoutingScoreUpdate
 * intermediate. Production body builds
 *   const update: RoutingScoreUpdate = { actorId, delta };
 *   return opts.currentScore + update.delta;
 * The object never escapes and its actorId field is never read.
 * Candidate = return opts.currentScore + opts.delta directly.
 * Face is test-only (grep: only test/unit/review/self-review.test.ts).
 * ================================================================ */
function replicaAssertNotSelfReview(opts: {
  reviewerKind: ReviewerKind;
  reviewerId: string;
  actorId: string;
  action: "update routing score" | "promote the actor resource";
}): void {
  if (opts.reviewerKind === "self" || opts.reviewerId === opts.actorId) {
    throw new DomainValidationError(`self-review cannot ${opts.action}`);
  }
}
/** Verbatim replica (keeps the dead intermediate). */
function replicaApplyRoutingScoreUpdate(opts: {
  reviewerId: string;
  actorId: string;
  reviewerKind: ReviewerKind;
  currentScore: number;
  delta: number;
}): number {
  replicaAssertNotSelfReview({
    reviewerKind: opts.reviewerKind,
    reviewerId: opts.reviewerId,
    actorId: opts.actorId,
    action: "update routing score"
  });
  const update: RoutingScoreUpdate = { actorId: opts.actorId, delta: opts.delta };
  return opts.currentScore + update.delta;
}
/** Candidate: identical except the dead intermediate object is removed. */
function candidateApplyRoutingScoreUpdate(opts: {
  reviewerId: string;
  actorId: string;
  reviewerKind: ReviewerKind;
  currentScore: number;
  delta: number;
}): number {
  replicaAssertNotSelfReview({
    reviewerKind: opts.reviewerKind,
    reviewerId: opts.reviewerId,
    actorId: opts.actorId,
    action: "update routing score"
  });
  return opts.currentScore + opts.delta;
}

{
  const rng = mulberry32(0x994801);
  const KINDS: ReviewerKind[] = ["self", "peer", "independent"];
  const IDS = ["rev-1", "rev-2", "act-1", "act-2", ""];
  const NUMS = [0, 1, -1, 0.5, -0.25, 1e9, -1e9, Number.NaN, Number.POSITIVE_INFINITY, -0];
  for (let trial = 0; trial < 20000; trial += 1) {
    const opts = {
      reviewerId: pick(rng, IDS),
      actorId: pick(rng, IDS),
      reviewerKind: pick(rng, KINDS),
      currentScore: pick(rng, NUMS),
      delta: pick(rng, NUMS)
    };
    let refVal: number | undefined;
    let repVal: number | undefined;
    let candVal: number | undefined;
    const ref = thrown(() => {
      refVal = applyRoutingScoreUpdate(opts);
    });
    const rep = thrown(() => {
      repVal = replicaApplyRoutingScoreUpdate(opts);
    });
    const cand = thrown(() => {
      candVal = candidateApplyRoutingScoreUpdate(opts);
    });
    check(
      "S9-H-1 sanity gate (verbatim replica parity)",
      ref === rep && (refVal === undefined ? repVal === undefined : Object.is(refVal, repVal)),
      `trial ${trial}: ref=${ref} rep=${rep}`
    );
    check(
      "S9-H-1 equivalence (dead intermediate removed)",
      ref === cand && (refVal === undefined ? candVal === undefined : Object.is(refVal, candVal)),
      `trial ${trial}: ref=${ref} cand=${cand} refVal=${refVal} candVal=${candVal}`
    );
  }
  // Cost isolation on the happy path (throw paths are exceptional).
  const opts = { reviewerId: "rev-1", actorId: "act-1", reviewerKind: "peer" as ReviewerKind, currentScore: 0.5, delta: 0.1 };
  let sink = 0;
  let cur = 0;
  let cand = 0;
  for (let round = 0; round < 3; round += 1) {
    cur += bench(() => {
      sink += replicaApplyRoutingScoreUpdate(opts);
    }, 300000);
    cand += bench(() => {
      sink += candidateApplyRoutingScoreUpdate(opts);
    }, 300000);
  }
  cur /= 3;
  cand /= 3;
  const prod = bench(() => {
    sink += applyRoutingScoreUpdate(opts);
  }, 300000);
  log(
    `S9-H-1 bench applyRoutingScoreUpdate: replica(dead intermediate)=${(cur * 1e6).toFixed(1)}ns candidate(no intermediate)=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/call production=${(prod * 1e6).toFixed(1)}ns (face is TEST-ONLY; sink=${sink !== 0})`
  );
}

/* ================================================================
 * S9-H-2: assertCanPromoteFromReview forwards opts through an
 * argument spread ({...opts, action}). Candidate = explicit 4-field
 * literal. The ONLY production-called review face (once per
 * promotion via adaptation/promotion-rules.ts).
 * ================================================================ */
/** Verbatim replica (keeps the spread). */
function replicaAssertCanPromote(opts: {
  reviewerKind: ReviewerKind;
  reviewerId: string;
  actorId: string;
}): void {
  replicaAssertNotSelfReview({
    ...opts,
    action: "promote the actor resource"
  });
}
/** Candidate: identical except explicit field construction. */
function candidateAssertCanPromote(opts: {
  reviewerKind: ReviewerKind;
  reviewerId: string;
  actorId: string;
}): void {
  replicaAssertNotSelfReview({
    reviewerKind: opts.reviewerKind,
    reviewerId: opts.reviewerId,
    actorId: opts.actorId,
    action: "promote the actor resource"
  });
}

{
  const rng = mulberry32(0x994802);
  const KINDS: ReviewerKind[] = ["self", "peer", "independent"];
  const IDS = ["rev-1", "rev-2", "act-1", "act-2", ""];
  for (let trial = 0; trial < 20000; trial += 1) {
    const opts = {
      reviewerKind: pick(rng, KINDS),
      reviewerId: pick(rng, IDS),
      actorId: pick(rng, IDS)
    };
    const ref = thrown(() => assertCanPromoteFromReview(opts));
    const rep = thrown(() => replicaAssertCanPromote(opts));
    const cand = thrown(() => candidateAssertCanPromote(opts));
    check("S9-H-2 sanity gate (verbatim replica throw parity)", ref === rep, `trial ${trial}: ref=${ref} rep=${rep}`);
    check("S9-H-2 equivalence (explicit literal)", ref === cand, `trial ${trial}: ref=${ref} cand=${cand}`);
  }
  const opts = { reviewerKind: "peer" as ReviewerKind, reviewerId: "rev-1", actorId: "act-1" };
  let cur = 0;
  let cand = 0;
  for (let round = 0; round < 3; round += 1) {
    cur += bench(() => replicaAssertCanPromote(opts), 300000);
    cand += bench(() => candidateAssertCanPromote(opts), 300000);
  }
  cur /= 3;
  cand /= 3;
  const prod = bench(() => assertCanPromoteFromReview(opts), 300000);
  log(
    `S9-H-2 bench assertCanPromoteFromReview: replica(spread)=${(cur * 1e6).toFixed(1)}ns candidate(explicit literal)=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/promotion production=${(prod * 1e6).toFixed(1)}ns (once per PROMOTION)`
  );
}

/* ================================================================
 * Ceiling re-verification, hot tier (R8-H §1, mandated: re-measure,
 * don't assume) — the three-state anchor (default Q=0, configured A
 * habits+Q=1 gated, configured B vague+Q=3 gated; production
 * assume-defaults flow passes resolvedQuestionIds covering ALL
 * questions so the gated re-map materially executes), decomposed so
 * the configured-state × command-class matrix is explicit.
 * ================================================================ */
async function measureChain(label: string, objective: string, habits: HeuristicHabits | undefined): Promise<void> {
  const args = { objective, ...(habits !== undefined ? { habits } : {}) };
  const chain = await benchAsync(async () => {
    await extractHeuristicContract(args);
  }, 3000);
  const prod = await extractHeuristicContract(args);
  const real = prod.contract;
  const tasks: CoverageTaskRef[] = Array.from({ length: 5 }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: real.acceptanceCriteria.map((criterion) => ({ id: criterion.id }))
  }));
  const options: CoverageStartOptions | undefined =
    real.questions.length > 0
      ? { resolvedQuestionIds: real.questions.map((question) => question.id) }
      : undefined;
  const gate = bench(() => assertCoverageAllowsStart(real, tasks, options), 50000);
  const precedence = bench(() => void applyPrecedence(real, "user-first"), 100000);
  const total = chain + gate + precedence;
  log(
    `CEILING ${label}: extractHeuristicContract=${(chain * 1e6).toFixed(0)}ns + run-start gate(Q=${real.questions.length}${options !== undefined ? ", all resolved" : ", no options"})=${(gate * 1e6).toFixed(0)}ns + applyPrecedence=${(precedence * 1e6).toFixed(0)}ns = ${(total * 1e6).toFixed(0)}ns once-per-run production total`
  );
}
{
  await measureChain(
    "default (8-pass anchor shape)",
    "fix the login retry bug in src/auth/session.ts and keep tests green",
    undefined
  );
  await measureChain(
    "configured A (habits set, Q=1 gated)",
    "fix the login retry bug in src/auth/session.ts and keep tests green",
    { requireTests: true, preferReview: false, askBeforeWrite: true }
  );
  await measureChain("configured B (vague, Q=3 gated)", "fix bug please", { askBeforeWrite: true });
}

/* ================================================================
 * Command-class anchors beyond run-start: promotion (production,
 * once per promotion) and the four faces with ZERO production
 * callers (evaluate / critique / reconcile / pairwise) — anchored
 * so the matrix has no unmeasured command class even for faces that
 * would only matter if the call graph ever changes.
 * ================================================================ */
{
  const promo = bench(
    () => assertCanPromoteFromReview({ reviewerKind: "peer", reviewerId: "rev-1", actorId: "act-1" }),
    200000
  );
  log(`CEILING promotion class: assertCanPromoteFromReview=${(promo * 1e6).toFixed(1)}ns once per promotion (production)`);

  // evaluate class (test-only face): 3-criterion rubric, evidence for 2.
  const rubric = createRubric("rub-1", "task", [
    { id: "crit-1", description: "d1", weight: 0.4, observableCheck: "check-1" },
    { id: "crit-2", description: "d2", weight: 0.3, observableCheck: "check-2" },
    { id: "crit-3", description: "d3", weight: 0.3, observableCheck: "check-3" }
  ]);
  const evalInput = {
    episodeId: "ep_00000001" as EpisodeId,
    evaluator: { kind: "deterministic" as const, version: "v1", rubricVersion: "1" },
    rubric,
    evidence: { "crit-1": "evidence-a", "crit-2": "evidence-b" }
  };
  const evaluate = bench(() => void createEvaluationRecord(evalInput), 50000);
  log(`CEILING evaluate class (TEST-ONLY face): createEvaluationRecord(3 criteria)=${(evaluate * 1e6).toFixed(0)}ns/call`);

  // critique class: critiqueContract on the real heuristic contract shape.
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const critique = bench(() => void critiqueContract(prod.contract), 50000);
  log(`CEILING critique class (inside run-start chain): critiqueContract(real contract)=${(critique * 1e6).toFixed(0)}ns/call`);

  // pairwise + reconcile classes (test-only faces).
  const pairInput: PairwiseInput = {
    episodeId: "ep_00000001" as EpisodeId,
    aId: "cand-a",
    bId: "cand-b",
    aScore: 0.8,
    bScore: 0.7,
    aComment: "solid",
    bComment: "weaker"
  };
  const pairwise = bench(() => void runBlindPairwisePair(pairInput, () => 0.7), 20000);
  const pair = runBlindPairwisePair(pairInput, () => 0.7);
  const two = [pair.first, pair.swapped];
  const reconcile = bench(() => void reconcileReviews(two), 100000);
  log(`CEILING pairwise class (TEST-ONLY face): runBlindPairwisePair=${(pairwise * 1e6).toFixed(0)}ns/call`);
  log(`CEILING reconcile class (TEST-ONLY face): reconcileReviews(n=2)=${(reconcile * 1e6).toFixed(0)}ns/call`);
}

/* ================================================================
 * Cold-tier re-measure on dist (R6-H..R8-H once-per-process
 * anchor), default AND configured first-call shapes. 5 fresh
 * processes each.
 * ================================================================ */
{
  const mkScript = (configured: boolean): string => `
    const { performance } = await import("node:perf_hooks");
    const { extractHeuristicContract } = await import("/workspace/dist/requirement/heuristic.js");
    const { assertCoverageAllowsStart } = await import("/workspace/dist/requirement/coverage.js");
    const { applyPrecedence } = await import("/workspace/dist/requirement/precedence.js");
    const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
    const args = ${"{"} objective${"}"};
    ${configured ? 'const cfgArgs = { objective, habits: { requireTests: true, preferReview: false, askBeforeWrite: true } };' : ""}
    const t0 = performance.now();
    const prod = await extractHeuristicContract(${configured ? "cfgArgs" : "args"});
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: "tsk_0000000" + i,
      acceptanceCriteria: prod.contract.acceptanceCriteria.map((c) => ({ id: c.id }))
    }));
    ${configured
      ? "assertCoverageAllowsStart(prod.contract, tasks, { resolvedQuestionIds: prod.contract.questions.map((q) => q.id) });"
      : "assertCoverageAllowsStart(prod.contract, tasks);"}
    applyPrecedence(prod.contract, "user-first");
    const t1 = performance.now();
    process.stdout.write((t1 - t0).toFixed(3));
  `;
  const median = (xs: number[]): number => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  };
  for (const [label, configured] of [
    ["default", false],
    ["configured (habits + Q=1 gated)", true]
  ] as const) {
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const proc = spawnSync(process.execPath, ["--input-type=module", "-e", mkScript(configured)], {
        encoding: "utf8"
      });
      if (proc.status !== 0) {
        check(`cold probe runs (${label})`, false, proc.stderr);
        break;
      }
      samples.push(Number(proc.stdout.trim()));
    }
    log(
      `COLD first-call production total (dist, fresh process, ${label}): median=${(median(samples) * 1e3).toFixed(0)}µs range=[${(Math.min(...samples) * 1e3).toFixed(0)}, ${(Math.max(...samples) * 1e3).toFixed(0)}]µs — once per PROCESS (veto class)`
    );
    check(`cold probes produced numbers (${label})`, samples.length === 5 && samples.every(Number.isFinite));
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} equivalence check(s) FAILED\n`);
  process.exit(1);
}
log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r9-h-eval-ninth-pass-83a1

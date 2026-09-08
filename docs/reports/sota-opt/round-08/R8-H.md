MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第八遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 8 / R8-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `1cae2db`（独占 tip，含 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3 排除全表）
**分支:** `cursor/r8-h-eval-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 21 个文件
（1750 行）自 R1-H 基线（`fd437a9`）以来**逐字节未变**（`git diff
fd437a9..1cae2db -- src/{evaluation,requirement,review,rubric}/` 为空，
同范围零提交），且 R7-H 基线（`6a10331`）之后 `src/` 仅落地 S7-F-1/S7-F-2
（`experiments/{canary,plan,shadow}.ts`）、S7-C（`routing/offline-logit.ts`）、
S7-I-1（`cli/model-catalog.ts` + `pi-adapter/listed-model*.ts`），R8-A…R8-E
全部为纯报告提交 ⇒ 生产调用方地图**可证不变**，本轮全库 import 交叉检索
再次确认（8 个导入位点与 R3-H…R7-H 完全一致，各入口频次仍为每 run /
每晋升一次；test-only 面 grep 复核仍零切片外调用方）。按指令先按 R7-I
教训**首次为 H 切片补配置态 × 命令类锚点**（§1.3——七轮以来全部热层
锚点都用 Q=0 无 options 的合同，而生产 assume-defaults track 流恒传
`resolvedQuestionIds` 覆盖**全部**问题，gated 重映射路径从未在锚点中真实
执行过）：配置态 A（偏好档三键全设，Q=1 全决议）**5.1–5.6µs**/run、
配置态 B（模糊 objective，Q=3 全决议）**3.5–4.4µs**/run，均落在默认态
锚点（本 VM 6.9–8.8µs）**之内甚至更低**（habits 短路 wantsTests 正则、
模糊路径跳过 named-target 工作）——**H 切片不存在被默认态夹具掩盖的
配置态悬崖**，与 R8-D 在 adaptation 切片的发现同向。冷层首调复测
默认态中位数 **1703/1722/1703µs**、配置态 **1640/1612/1633µs**
once-per-process（与 R6-H 1.65–1.71ms / R7-H 1.72–1.76ms 同带，否决类
归属不变）。第八遍在完整排除表（S1-H-1..9、S2-H-1..7、S3-H-1..4、
S4-H-1..3、S5-H-1..3、S6-H-1..4、S7-H-1..3 及七轮 30+ 处不立 ID 收口）
之上以三个**从未点名的位点**枚举——盲评输入的组合死字段（S8-A-3 机制
新位点）、heuristic 合同字面量的条件数组 spread（S8-D-5/S8-E-2 机制
新位点）、由配置态复核直接派生的门控全决议快路径——得到 3 个新候选
（S8-H-1 … S8-H-3），全部经理论 + 确定性仿真（seeded mulberry32，
~24,500 项等价/消融/反例检查 + 真实规模基准，三次独立运行裁决逐位一致、
计时方向稳定）裁决后淘汰：S8-H-1 消融证明 comment 字段在整条盲评链中
死（6000 组逐字节）但该面零生产调用方、字段对任意未来非分数评审实现是
活的契约输入（S7-H-2 同型活性墙），**且瘦身链实测三次全部更慢**
（−41~−52ns——收窄对象把 `blindPairwiseCompare` 的 PIC 打成二态，
S8-A-3 伪影类这次反噬候选本身）；S8-H-2 逐字节等价（2500 组全链 fuzz，
先过 verbatim replica sanity 闸）但 103–182ns/run once-per-run 噪声
（低于落地线 4+ 个数量级）；S8-H-3 **不等价**——schema 合法的
`default:""` 与 `options:[""]` 问题在现行代码下保持 blocking，快路径
把门翻 **fail-open**（1011/8000 seeded fuzz 发散 + 两个定向反例三次
全部复现，发散方向是放行，S4-H-1 同判为最不可接受类）。未重开任何
X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-* / S8-A/B/C/D/E-*
条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第八遍实际读码，
  未依赖前七轮记忆。上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts`、`domain/contract.ts` 只读
  取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含继承
  X0–X4、S1–S7 全部 ID 及 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 /
  S8-D-1..5 / S8-E-1..3）/ round-08/PLAN.md / round-07/PLAN.md /
  round-01/R1-H.md … round-07/R7-H.md。S7-C 已落地于 offline-logit，
  未触碰。候选枚举刻意绕开全部既有排除，特别核对未触碰：S1-H-9 /
  S2-H-4 / S3-H-4（changeSetsEqual 三面钉死维持，零候选）、S1-H-8 /
  S2-H-6（registerRubric 维持）、S5-H-1（detectConflicts 分配前守卫
  ——曾误删后恢复，本轮零候选、零 diff，守卫原样）、S5-H-3
  （hashArtifact 维持零候选）、S6-H-2/3（门控组合死输出与 gated 拷贝
  融合——S8-H-3 是**门控语义层**的快路径而非拷贝/复制层的融合，机制
  与两者都不同，且以反例告终，见 §3.3）、S7-H-1/2/3（异步机器、
  signals 死输出、JIT 预热——零重提）、X4-9 / X0-5 / X0-6。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `SMALLEST_CHANGE` 每调用 spread 提升为共享常量对象 = R2-H 不立 ID
    收口（数据字面量流入返回合同，S1-A-7 可观察身份类），拒列；
  - `inferences: []` / `authorityGrounding: []` 每调用新建空数组换冻结
    单例 = S7-B-5/S1-A-7 身份类，拒列；
  - `buildContractCandidate` 对常量 roleId 的 `.trim()` 分配 = ns 级
    微分配家族，拒列；
  - 切片内 `for...of` 换索引循环 = S5-D-2/S7-C-4 家族在 C=2 规模的
    换位点，拒列；
  - `shouldAskScope` 内 `namedTargets(...).length > 0` 换早退 `test()`
    = S3-H-3/S1-H-3 单句正则家族，拒列；
  - 三个 run 入口对 gate options 的 `undefined` / 对象二态传参统一化
    （PIC 单态化）= S8-A-3/S8-E-2 明文点名的**测量伪影类**，非候选，
    拒列（本轮 S8-H-1 反而实测了该伪影的反向实例，见 §3.1）。
- R7-H §1 的双层上界按指令**先复核后引用**：本报告 §1 以三次独立实测在
  本 VM 重建热层锚点（默认 6.9–8.8µs/run + 配置态两档）与冷层锚点
  （1.6–1.7ms 首调，默认/配置双态），未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 与双归因保留、S3-H-1 双
  validateRequirementContract 与 S2-H-7 默认 origin 守卫保留、
  DEFAULT_REGISTRY 未变异、changeSetsEqual 语义未动、阈值/权限/数据面
  契约/公开签名不变（含 S7-H-1 的 Promise 扩展点签名与 S7-H-2 的
  normalizeSources.signals 活契约）、测试未改，天然成立。不声称
  Outcome-supported，Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与上界重测（含配置态首测）

1. **切片逐字节未变**：`git diff fd437a9..1cae2db -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交（八遍全程零 diff）。R1-H 逐函数
   下界表、R2-H 调用图上界、R3-H 重复工作枚举、R4-H 三类角度收口、
   R5-H 三层级收口、R6-H 执行层级收口、R7-H 机器成本三面收口与全部
   S*-H-* 排除继承有效。
2. **调用图可证不变**：`git log 6a10331..1cae2db -- src/` 仅含 S7-F-1/2
   （`experiments/`）、S7-C（`routing/offline-logit.ts`）、S7-I-1
   （`cli/model-catalog.ts` + `pi-adapter/`）四组落地提交，无一 import
   本切片；R8-A…R8-E 波次全部为报告提交。本轮全库 import 检索双确认
   （8 位点，频次逐一复核）：`assertCoverageAllowsStart` ←
   `run/{supervisor,coordinator,flowchart-run}.ts`（每 run 启动一次，
   且仅当 `input.contract !== undefined`）；`extractHeuristicContract`
   ← `track/clarify.ts`（每 run 一次）；`applyPrecedence` ←
   `track/loop.ts`（每 run 一次，`"user-first"`）；`shouldScout` ←
   `track/plan.ts`（每 run 一次）；`assertCanPromoteFromReview` ←
   `adaptation/promotion-rules.ts`（每晋升一次，本轮实测 18.7–19.9ns）；
   `src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（grep 本轮独立复核，仅类型
   导入与测试引用）。
3. **配置态 × 命令类锚点（R7-I 教训，H 切片首次）**：七轮以来全部热层
   锚点用的都是 Q=0 合同 + 无 options 的门控调用。但生产 track 流
   （`track/loop.ts` L101–104）在 assume-defaults / 全答复路径下恒传
   `resolvedQuestionIds = contract.questions.map(q => q.id)`——即**只要
   合同带问题，gated 重映射路径（resolved Set 构建 + 逐问题
   `{...question, default}` 重建 + blocking 重扫）就真实执行**。本轮
   构造两档配置态（三次运行区间，本 VM）：

```text
CEILING default  (7-pass anchor shape, Q=0):        6853-8766ns/run
CEILING configured A (habits 三键全设, Q=1 gated):   5061-5599ns/run
CEILING configured B (vague objective, Q=3 gated):   3451-4386ns/run
CEILING promotion class: assertCanPromoteFromReview=18.7-19.9ns/promotion
```

   三个结论：(a) **无配置态悬崖**——配置态反而更便宜：
   `requireTests: true` 使 `wantsTests` 经 `||` 短路跳过正则扫描，
   `preferReview: false` 不增开销，`askBeforeWrite: true` 只加一次
   push + `questions.some`（上界 4）；模糊 objective 跳过大部分
   named-target/scope 工作。gated 重映射的真实增量（Q=1–3 的 Set +
   map + spread）被 extract 链的正则成本波动完全吞没。(b) 自定义
   extractor / critic / CheckAdapter 轴：生产组合恒为 heuristic 对
   （`clarifyObjective` 硬编码调用 `extractHeuristicContract`），三个
   adapter 与 review/rubric 面零生产调用方（§1.2 grep）——该轴在当前
   调用图下无可测形态。(c) 门槛第 3 条在配置态下同样**结构上不可满足**。
   默认态绝对值（6.9–8.8µs）落在七轮历史跨 VM 带（3.9–10µs）内，属
   测量环境差异而非调用图变更（§1.2 已证零变更）。
4. **冷层锚点复测（默认 + 配置双态首测）**：dist 产物、新进程、模块
   加载预扣除后，三生产入口首调合计中位数三次：默认态
   **1703/1722/1703µs**、配置态 **1640/1612/1633µs**——与 R6-H 的
   1.65–1.71ms / R7-H 的 1.72–1.76ms 同带；配置态首调不更贵（更短的
   正则路径抵消了 gated 分支的首调编译）。once-per-process 否决类
   归属不变，S7-H-3 已证该层无净正对策。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-H-1 | `PairwiseInput.aComment/bComment` 在整条盲评链中是**组合死字段**：`blindPairwiseCompare` 只读 {aScore,bScore,aId,bId,episodeId}，`presentInput` 搬运（交换）comment 但 `PairwiseResult` 无 comment 字段 ⇒ 输出永不依赖。候选 = 链内去掉 comment 搬运 / 收窄公开输入类型（S8-A-3 死字段机制在从未点名位点） | 免 "ba" 呈现时 2 次字符串字段写 + 类型瘦身 | ✅ 消融证明：6000 组（分数格 × bind × 双 rng 分支）把 comment 换哨兵后全链输出逐字节一致；comment-free 候选链 6000 组逐字节一致（id/createdAt 归一化） | 全链 delta 三次 **−51/−41/−52ns——候选反而更慢**：收窄对象直接交给生产 `blindPairwiseCompare` 使其参数 PIC 变二态（原链恒单态），S8-A-3/S8-E-2 伪影类的反向实测实例 | 淘汰三重：(a) 该面自 R1-H 起八轮复核**零生产调用方**（test-only，S1-E-7 类）；(b) comment 是公开 `PairwiseInput` 的契约输入——对任意未来非纯分数评审实现（真 LLM 评审读 rationale 文本）是活字段，收窄 = 公开面变更（S7-H-2 活性墙同型）；(c) 实测负收益（唯一诚实落地形态还要付 PIC 二态费） |
| S8-H-2 | heuristic 合同字面量 4 处条件数组 spread（`...(wantsTests ? [c-tests] : [])` / `...(wantsTests ? [ac-tests] : [])` / `...(vague ? [a-vague] : [])` / `...targets.map(...)`）换命令式 push 构建（S8-D-5 尾部条件展开 / S8-E-2 条件 spread 机制家族在从未点名位点；R1-H 的 S1-B-5 收口只覆盖 `[...sources]` 防御拷贝，不覆盖本组） | 免每分支 1 个临时空数组 + spread 迭代协议 | ✅ 先过 verbatim replica sanity 闸（2500 组 objective×habits 全格逐字节 ≡ 生产），候选（仅 push 化差异）同 2500 组全链载荷逐字节一致 | 隔离 extract body：典型态省 **166–182ns**、模糊态省 **103–136ns**（三次方向一致；量级本身已带 PIC 伪影告警） | 淘汰：亚 µs once-per-run 噪声（占 §1 默认锚点 ~2%，低于落地线 4+ 个数量级）；与 S8-E-2 同判——「收益大半为分配/形状敏感项」，无生产可测意义 |
| S8-H-3 | `assertCoverageAllowsStart` 全决议快路径：`resolved ⊇ question ids` 时（恰是生产 assume-defaults 流的恒态）跳过 gated 重映射 + blocking 重扫。由 §1.3 配置态复核直接派生的候选——生产流恒走全决议形态，纸面上 gated 分支可证「全部会被 default」 | 免 Q 次对象 spread + 1 次 questions map + 1 次 blocking 扫描 | ❌ **fail-open 反例**（schema 合法：`validateRequirementContract` 不检查 question 内部）——(1) `{default: ""}`：gated map 跳过（default!==undefined），blocking 扫描 `!q.default` 仍拦，快路径放行；(2) `{options: [""]}`：gated default 变 `""` 仍 falsy 仍拦，快路径放行。8000 组 seeded fuzz **1011 处发散**（三次逐位相同）+ 两个定向反例三次复现；verbatim replica sanity 闸零失配 | —（不等价即淘汰；等价子域上的收益上界也仅 Q≤4 × ns） | 淘汰：不等价且发散方向是**放行**（fail-open，S4-H-1 同判最险类）；「resolved ⇒ 非 blocking」是无处强制的不变量（S1-A-9/S1-H-9/S4-H-1 家族第四例）；修正形态（逐决议问题预判 default 真值）恰是把重扫再做一遍 = 零节省 |

另有六处以既有排除/前轮收口直接覆盖、不立新 ID（见 §0 换名重提检查）。
第八遍对 21 文件逐一重扫**再未发现任何未被八轮排除表覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S8-H-1：死字段消除被 PIC 伪影反噬——S8-A-3 教训的反向实测

S8-A-3/S8-E-2 警示「朴素基准里的形状效应是伪影」；本条是该教训的镜像：
候选本身就是形状变更。消融证明干净利落（comment 换 `\u0000` 哨兵后
6000 组全链输出逐字节一致——字段确实死），但唯一不复制
`blindPairwiseCompare` 的落地形态是把 5 字段瘦身对象直接交给生产比较
函数，这使其参数位从恒 7 字段单态变二态，三次实测候选链**全部更慢**
（−41~−52ns）。加上零生产调用方（八轮 grep 一致）与活性墙——comment
对任意读 rationale 文本的未来评审实现是契约输入，`PairwiseInput` 是
公开导出类型，收窄即公开面变更（S7-H-2 的 signals 论证同型）——三重
钉死。该面（review/pairwise 全链）至此在「协议本体（双物质比较）+
零流量 + 死字段活性墙」三面收口。

### 3.2 S8-H-2：S8-D/S8-E 机制家族在本切片的最后一个未点名位点

R1-H 收口过 `[...sources]` 防御拷贝（S1-B-5 类），R2-H 收口过数据
字面量提升（S1-A-7 类），但合同字面量内部的**条件数组 spread 组**
（`...(cond ? [x] : [])` 三处 + `...targets.map(...)` 一处）八轮从未
被点名。等价性以两级闸裁决：verbatim replica 先证与生产逐字节一致
（把任何发散归因于候选编辑本身），push 化候选再证 2500 组全格逐字节
一致。收益 103–182ns/run once-per-run——恰落在 S8-E-2（171–212ns/call）
同一噪声量级，且同样带「分配/形状敏感」告警。与 S8-D-5（尾部条件
展开 ~5.1µs 淘汰）同家族同判。该位点关闭后，heuristic 合同构造的
分配面（防御拷贝、字面量、条件 spread、角色对象）四面全部有裁决记录。

### 3.3 S8-H-3：配置态复核直接产出的候选——也直接被门语义反例击杀

这是本轮方法论的闭环案例：§1.3 首次把生产全决议形态拉进锚点，立即
诱发「全决议 ⇒ gated 重映射可跳过」的候选。但 `DecisionQuestion` 的
schema（`domain/contract.ts` 只做 `Array.isArray(questions)`）允许
`default: ""` 与 `options: [""]`——两者在现行代码下都保持 blocking
（`!q.default` 对空串为真；`options[0] ?? "resolved"` 对 `""` 不触发
nullish 回退），而快路径把它们放行。发散方向是 fail-open（门从拦变开），
与 S4-H-1 的枚举性反例同属最不可接受类。8000 组 seeded fuzz 1011 处
发散三次逐位相同 + 两个定向反例三次复现。修正形态（对每个 resolved
问题预判其 gated default 是否真值）与现行 blocking 扫描等工作量，
零节省。至此 `assertCoverageAllowsStart` 的微优化方向四面钉死：条件
跳拷贝（S1-H-2 噪声）、无条件融合（S6-H-3 复制门逻辑）、组合死输出
（S6-H-2 两难）、全决议快路径（本条 fail-open）。「resolved ⇒ 非
blocking」若未来被版本化为 schema 约束（校验器拒绝空 default/空
option），可凭本报告反例集重开。

### 3.4 第八遍收口：配置态维度补齐后，测量矩阵与候选空间双重闭合

R1-H 证逐函数渐近下界，R2-H 证调用图收益上界，R3-H 枚举尽重复工作，
R4-H 收口内建换写/跨模块去重/可变化，R5-H 补守卫/模块图/Θ(字节)，
R6-H 补执行层级，R7-H 补异步机器/死输出源侧/层级对策，本轮补最后一个
测量维度：**配置态 × 命令类**（默认/配置 A/配置 B × run-start/晋升 ×
热/冷）。八遍合起来：单函数、函数间、跨模块、调用图、模块图、执行
层级、调用机器、配置态八个成本/状态面全部有实测锚点与排除收口，且
配置态实测**低于**默认态——七轮默认态锚点不仅没有掩盖热路径，反而是
保守上界。重开该切片的唯一前提维持 R4-H…R7-H 收口原文：调用图变更
（evaluation/review/rubric 面接入每 turn 热路径，或合同规模增长 ≥2 个
量级）。

## 4. 逐文件收口（第八遍新视角，其余与 R1-H…R7-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `review/pairwise.ts` | comment 组合死字段（S8-H-1，消融证明 + PIC 反噬 + 活性墙）；双物质比较协议本体维持 | S8-H-1 淘汰 |
| `requirement/heuristic.ts` | 合同字面量条件数组 spread 组（S8-H-2，两级 sanity 闸）；SMALLEST_CHANGE spread / 空数组单例 / roleId trim（换名重提，拒列）；S3-H-3、S6-H-4、S7-H-1 维持未重开 | S8-H-2 淘汰 |
| `requirement/coverage.ts` | 全决议快路径（S8-H-3，fail-open 双反例）；配置态 gated 路径首次入锚点（§1.3）；S1-H-1/2、S4-H-1、S6-H-2/3 五面钉死维持 | S8-H-3 淘汰 |
| `requirement/extractor.ts` | S2-H-1/2、S3-H-1、S7-H-1 维持；`validateRequirementContract` 不查 question 内部的事实成为 S8-H-3 反例的 schema 依据（只读取证，未改） | 无新候选 |
| `requirement/normalizer.ts` / `critic.ts` / `provenance.ts` | S2-H-7、S7-H-2、S2-H-3/S3-H-2 维持；零新结构 | 无新候选 |
| `requirement/precedence.ts` | S1-H-5、S4-H-2、S5-H-1（保留确认）、S6-H-1 守卫方向两面钉死维持 | 无新候选 |
| `evaluation/check-adapter.ts` | changeSetsEqual 三面钉死维持；hashArtifact（S5-H-3）维持零候选 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` / `precedence.ts` / `ownership.ts` / `delivery-adapter.ts` / `diff-adapter.ts` | 纯类型/常量/3 元表/test-only 面；X4-9 维持；S1-H-7/S2-H-5 维持 | 无新候选 |
| `review/reconcile.ts` / `critic.ts` / `self-review.ts` | S1-H-6 维持；O(1) 谓词；晋升类锚点实测 18.7–19.9ns（§1.3） | 无新候选 |
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
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H…R7-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r8h-sim.mts`，无赢家故未入库以从 round01–07 仅
赢家 sim 入库的仓库惯例；完整源码见附录，seed 固定可复现；冷层探针以
`pnpm build` 后的 dist 产物为准）代表性一次运行：

```text
S8-H-1 bench full pair chain ("ba" order forces the comment carry): current=1868ns comment-free cand=1918ns delta=-51ns/call (face has NO production caller; comments are contract input for future non-score judges)
S8-H-2 bench extract body typical (wantsTests=true, 1 named file): spread-form=1610ns push-form cand=1435ns delta=175ns/run (once per run; PIC-artifact caveat applies to deltas this small)
S8-H-2 bench extract body vague (2 questions + a-vague): spread-form=1008ns push-form cand=872ns delta=136ns/run (once per run; PIC-artifact caveat applies to deltas this small)
S8-H-3 fuzz: 1011/8000 divergences under the fully-resolved fast path; first: questions=[{"id":"q-0","question":"q","options":["opt-a","opt-b"],"default":""}] options={"resolvedQuestionIds":["q-0"]} ref=DomainValidationError: coverage gate blocked start: blocking=q-0 cand=NO_THROW
S8-H-3 counterexamples: default:"" -> current BLOCKS / fast-path cand OPENS (fail-open); options:[""] -> current BLOCKS / cand OPENS (fail-open)
CEILING default (7-pass anchor shape): extractHeuristicContract=7464ns + run-start gate(Q=0, no options)=645ns + applyPrecedence=250ns = 8359ns once-per-run production total
CEILING configured A (habits set, Q=1 gated): extractHeuristicContract=4696ns + run-start gate(Q=1, all resolved)=618ns + applyPrecedence=214ns = 5528ns once-per-run production total
CEILING configured B (vague, Q=3 gated): extractHeuristicContract=2856ns + run-start gate(Q=3, all resolved)=484ns + applyPrecedence=116ns = 3456ns once-per-run production total
CEILING promotion class: assertCanPromoteFromReview=18.8ns once per promotion
COLD first-call production total (dist, fresh process, default): median=1703µs range=[1652, 1743]µs — once per PROCESS (veto class)
COLD first-call production total (dist, fresh process, configured (habits + Q=1 gated)): median=1640µs range=[1599, 1718]µs — once per PROCESS (veto class)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~24,500 项等价/消融/反例检查全部通过、裁决结论逐位一致；
计时抖动内方向稳定（S8-H-1 三次 −51/−41/−52ns 全部候选更慢；S8-H-2
典型态三次 175/182/166ns、模糊态 136/127/103ns；S8-H-3 fuzz 发散数
三次恒 1011/8000、双反例三次复现；默认锚点三次 8359/8766/6853ns、
配置 A 三次 5528/5061/5599ns、配置 B 三次 3456/4386/3451ns；冷层默认
三次 1703/1722/1703µs、配置三次 1640/1612/1633µs）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-H-1 | 盲评链 PairwiseInput comment 死字段消除 / 公开输入类型收窄 | 消融证明字段死（6000 组逐字节）但零生产调用方；comment 对任意未来读 rationale 的评审实现是活契约输入（公开类型收窄 = S7-H-2 活性墙同型）；瘦身链实测三次全部更慢（−41~−52ns，PIC 二态反噬，S8-A-3 伪影类反向实例） |
| S8-H-2 | heuristic 合同字面量条件数组 spread 组换命令式 push | 逐字节等价（verbatim replica 闸 + 2500 组全格）但 103–182ns/run once-per-run 噪声，低于落地线 4+ 个数量级（S8-D-5/S8-E-2 机制家族收口位点） |
| S8-H-3 | assertCoverageAllowsStart 全决议快路径（跳 gated 重映射 + blocking 扫描） | 不等价：schema 合法 `default:""` / `options:[""]` 反例把门翻 fail-open（1011/8000 fuzz 发散三次逐位相同）；「resolved ⇒ 非 blocking」不变量无处强制；修正形态与原扫描等工作量零节省 |

重开条件：S8-H-1 需先出现 review/pairwise 的每 turn 生产调用方**且**
版本化「评审实现永不消费 comment」的决定（届时凭本报告消融证据落地，
且须解决 PIC 二态负收益——独立瘦身比较函数而非复用生产函数）；
S8-H-2 凭本报告等价证据在合同规模增长 ≥2 个量级或提取链进入每 turn
热路径时重开；S8-H-3 需先把「问题 default/options 非空」升级为
`validateRequirementContract` 的 schema 约束并版本化，推翻本报告反例。
总门槛更新：任何候选须先推翻本报告 §1 的三态双层实测上界——热层
默认 **6.9–8.8µs/run**、配置态 **3.5–5.6µs/run**（本 VM，配置态更低
⇒ 默认锚点是保守上界）与冷层 **1.6–1.7ms once-per-process**（否决类）；
即调用图出现每 turn 新热路径或合同规模 ≥2 个量级增长之前，该切片
结构上无达门槛候选。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：`pnpm build` 后保存为任意 `.mts` 并 `npx tsx <file>`（仓库
根目录，依赖已装；`.mts` 保证 ESM 顶层 await 可用；冷层探针需要 dist
产物存在）。seeds：`0x884801`–`0x884803`。

```ts
/**
 * R8-H deterministic equivalence + benchmark simulation (eighth pass).
 * Adjudicates fresh candidates S8-H-1 .. S8-H-3 against the current
 * implementations in src/{evaluation,requirement,review,rubric}, re-verifies
 * the R7-H §1 hot-tier ceiling (mandated: re-measure, don't assume), closes
 * the R7-I configured-state × command-class measurement hole (every prior
 * H-pass ceiling anchor used a question-less contract with no gate options;
 * the production assume-defaults track flow passes resolvedQuestionIds
 * covering EVERY contract question, so the gated re-map path materially
 * executes), and re-measures the cold once-per-process tier on dist.
 * All candidates are NEW angles not named by EXCLUSIONS.md or R1-H..R7-H
 * (S1-H-1..9, S2-H-1..7, S3-H-1..4, S4-H-1..3, S5-H-1..3, S6-H-1..4,
 * S7-H-1..3):
 *   S8-H-1: PairwiseInput.aComment/bComment are composition-dead through
 *           the whole blind-pairwise chain (ablation proof; S8-A-3
 *           dead-field mechanism at a never-named site).
 *   S8-H-2: heuristic contract-literal conditional array spreads
 *           (...(cond ? [x] : []) at 4 sites + targets.map spread)
 *           desugared to imperative pushes (S8-D-5 / S8-E-2 mechanism
 *           family at a never-named site).
 *   S8-H-3: assertCoverageAllowsStart fully-resolved fast path (skip gated
 *           re-map + blocking scan when resolved ⊇ question ids) — expected
 *           fail-open counterexamples on schema-legal default:"" and
 *           options:[""] questions.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds: 0x884801..0x884804.
 *
 * Reference = production imports wherever the function is exported; private
 * helpers are replicated verbatim and each candidate differs from the
 * replica ONLY by the candidate edit. Replica-vs-production sanity gates
 * precede every candidate adjudication. Benchmarks keep reference and
 * candidate on separate function identities and interleave three rounds to
 * blunt PIC shape-pollution artifacts (S8-A-3 / S8-E-2 lesson).
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
  type LatentRequirement
} from "/workspace/src/requirement/extractor.js";
import {
  createTrustedSource,
  type NormalizedSource
} from "/workspace/src/requirement/normalizer.js";
import { critiqueContract, type ContractCritique } from "/workspace/src/requirement/critic.js";
import {
  assertCoverageAllowsStart,
  checkCoverageGate,
  coverageMatrixFromTasks,
  isSkipContract,
  type CoverageTaskRef,
  type CoverageStartOptions
} from "/workspace/src/requirement/coverage.js";
import { applyPrecedence } from "/workspace/src/requirement/precedence.js";
import {
  runBlindPairwisePair,
  blindPairwiseCompare,
  type PairwiseInput,
  type PairwiseResult,
  type BlindPairwisePairResult,
  type PresentationOrder
} from "/workspace/src/review/pairwise.js";
import { reconcileReviews } from "/workspace/src/review/reconcile.js";
import { assertCanPromoteFromReview } from "/workspace/src/review/self-review.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import {
  validateRequirementContract,
  type RequirementContract,
  type AcceptanceCriterion,
  type DecisionQuestion
} from "/workspace/src/domain/contract.js";
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

/* ================================================================
 * S8-H-1: PairwiseInput.aComment/bComment are composition-dead
 * through the whole blind-pairwise chain: blindPairwiseCompare reads
 * only {aScore,bScore,aId,bId,episodeId}; presentInput carries the
 * comments (swapped) but no output field ever depends on them
 * (PairwiseResult has no comment field). Candidate = drop the comment
 * carry / narrow the public input type. Adjudication: (a) ablation
 * proof — comments replaced by sentinels leave the full chain output
 * bit-identical; (b) comment-free verbatim replica bit-equal;
 * (c) production-caller grep (face is test-only); (d) cost isolation.
 * ================================================================ */
interface PairwiseInputNoComments {
  readonly episodeId: EpisodeId;
  readonly aId: string;
  readonly bId: string;
  readonly aScore: number;
  readonly bScore: number;
}
function candPresentInput(
  input: PairwiseInputNoComments,
  order: PresentationOrder,
  bindScoresToSlots: boolean
): PairwiseInputNoComments {
  if (order === "ab") return input;
  return {
    episodeId: input.episodeId,
    aId: input.bId,
    bId: input.aId,
    aScore: bindScoresToSlots ? input.aScore : input.bScore,
    bScore: bindScoresToSlots ? input.bScore : input.aScore
  };
}
function candRemap(
  original: PairwiseInputNoComments,
  presented: PairwiseResult,
  order: PresentationOrder
): PairwiseResult {
  if (order === "ab") {
    return { ...presented, aId: original.aId, bId: original.bId };
  }
  const winner: PairwiseResult["winner"] =
    presented.winner === "tie" ? "tie" : presented.winner === "a" ? "b" : "a";
  return { ...presented, aId: original.aId, bId: original.bId, winner };
}
function candComparePresented(
  input: PairwiseInputNoComments,
  order: PresentationOrder,
  orderSwapped: boolean,
  bindScoresToSlots: boolean
): PairwiseResult {
  const presented = candPresentInput(input, order, bindScoresToSlots);
  // production blindPairwiseCompare never reads the comment fields, so the
  // narrowed object can be handed to it directly (the candidate edit).
  const raw = blindPairwiseCompare(presented as unknown as PairwiseInput, orderSwapped);
  return candRemap(input, raw, order);
}
function candRunBlindPairwisePair(
  input: PairwiseInputNoComments,
  rng: () => number,
  options?: { readonly bindScoresToSlots?: boolean | undefined }
): BlindPairwisePairResult {
  const bindScoresToSlots = options?.bindScoresToSlots === true;
  const initialOrder: PresentationOrder = rng() < 0.5 ? "ab" : "ba";
  const swappedOrder: PresentationOrder = initialOrder === "ab" ? "ba" : "ab";
  const first = candComparePresented(input, initialOrder, false, bindScoresToSlots);
  const swapped = candComparePresented(input, swappedOrder, true, bindScoresToSlots);
  const reconciliation = reconcileReviews([first, swapped]);
  return { first, swapped, reconciliation, initialOrder };
}
function normPair(result: BlindPairwisePairResult): string {
  const strip = (r: PairwiseResult): unknown => ({ ...r, id: "normalized", createdAt: "T" });
  return JSON.stringify({
    first: strip(result.first),
    swapped: strip(result.swapped),
    reconciliation: {
      ...result.reconciliation,
      dissent: result.reconciliation.dissent.map(strip)
    },
    initialOrder: result.initialOrder
  });
}

{
  const rng = mulberry32(0x884801);
  for (let trial = 0; trial < 6000; trial += 1) {
    const scores = [0, 0.25, 0.5, 0.7, 0.7, 1];
    const base: PairwiseInput = {
      episodeId: "ep_00000001" as EpisodeId,
      aId: `cand-a-${trial % 7}`,
      bId: `cand-b-${trial % 5}`,
      aScore: pick(rng, scores),
      bScore: pick(rng, scores),
      aComment: pick(rng, ["solid", "weaker", "", "detailed rationale text"]),
      bComment: pick(rng, ["fine", "meh", "", "another rationale"])
    };
    const bind = rng() < 0.5;
    const draw = rng();
    // (a) ablation: sentinel comments must not change the chain output.
    const ablated: PairwiseInput = { ...base, aComment: "\u0000SENTINEL-A", bComment: "\u0000SENTINEL-B" };
    const refOut = runBlindPairwisePair(base, () => draw, { bindScoresToSlots: bind });
    const ablOut = runBlindPairwisePair(ablated, () => draw, { bindScoresToSlots: bind });
    check("S8-H-1 ablation (comments never reach output)", normPair(refOut) === normPair(ablOut), `trial ${trial}`);
    // (b) comment-free candidate replica bit-equal (normalized ids/timestamps).
    const narrowed: PairwiseInputNoComments = {
      episodeId: base.episodeId,
      aId: base.aId,
      bId: base.bId,
      aScore: base.aScore,
      bScore: base.bScore
    };
    const candOut = candRunBlindPairwisePair(narrowed, () => draw, { bindScoresToSlots: bind });
    check("S8-H-1 equivalence (comment-free chain)", normPair(refOut) === normPair(candOut), `trial ${trial}`);
  }
  // (d) cost isolation at the only comment-touching site (presentInput "ba").
  const input: PairwiseInput = {
    episodeId: "ep_00000001" as EpisodeId,
    aId: "cand-a",
    bId: "cand-b",
    aScore: 0.8,
    bScore: 0.7,
    aComment: "solid",
    bComment: "weaker"
  };
  const narrowed: PairwiseInputNoComments = {
    episodeId: input.episodeId,
    aId: input.aId,
    bId: input.bId,
    aScore: input.aScore,
    bScore: input.bScore
  };
  let cur = 0;
  let cand = 0;
  for (let round = 0; round < 3; round += 1) {
    cur += bench(() => void runBlindPairwisePair(input, () => 0.7), 20000);
    cand += bench(() => void candRunBlindPairwisePair(narrowed, () => 0.7), 20000);
  }
  cur /= 3;
  cand /= 3;
  log(
    `S8-H-1 bench full pair chain ("ba" order forces the comment carry): current=${(cur * 1e6).toFixed(0)}ns comment-free cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (face has NO production caller; comments are contract input for future non-score judges)`
  );
}

/* ================================================================
 * S8-H-2: heuristic contract-literal conditional array spreads
 * desugared to imperative pushes. Verbatim replica of the extract
 * body first passes a sanity gate against production
 * (extractHeuristicContract); the candidate differs ONLY by
 * push-based construction of deliverables/constraints/
 * acceptanceCriteria/assumptions.
 * ================================================================ */
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
  readonly authorityGrounding: readonly never[];
}
function buildQuestions(objective: string, habits: HeuristicHabits, vague: boolean): DecisionQuestion[] {
  const questions: DecisionQuestion[] = vague
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
  return questions;
}
/** Verbatim replica of the extract body (conditional-spread form). */
function replicaExtractBody(
  habits: HeuristicHabits,
  input: { readonly objective: string; readonly sources: readonly NormalizedSource[] }
): SyncExtractionResult {
  const objective = input.objective.trim();
  const vague = isVague(objective);
  const wantsTests = habits.requireTests === true || /\b(tests?|coverage|qa)\b/i.test(objective);
  const wantsReview = habits.preferReview !== false;
  const questions = buildQuestions(objective, habits, vague);
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
/** Candidate: identical except the four conditional spreads become pushes. */
function candidateExtractBody(
  habits: HeuristicHabits,
  input: { readonly objective: string; readonly sources: readonly NormalizedSource[] }
): SyncExtractionResult {
  const objective = input.objective.trim();
  const vague = isVague(objective);
  const wantsTests = habits.requireTests === true || /\b(tests?|coverage|qa)\b/i.test(objective);
  const wantsReview = habits.preferReview !== false;
  const questions = buildQuestions(objective, habits, vague);
  const targets = namedTargets(objective);
  const objectiveRefs = input.sources.map((source) => source.ref);
  const deliverables: unknown[] = [
    {
      id: "d-change",
      description: vague ? "Change set matching the clarified objective" : `Deliver ${objective}`,
      artifactKind: "diff",
      sourceRefs: objectiveRefs
    }
  ];
  for (let index = 0; index < targets.length; index += 1) {
    deliverables.push({
      id: `d-file-${index + 1}`,
      description: targets[index],
      artifactKind: "file",
      sourceRefs: objectiveRefs
    });
  }
  const constraints: unknown[] = [{ ...SMALLEST_CHANGE, assumptionIds: ["a-defaults"] }];
  if (wantsTests) {
    constraints.push({ id: "c-tests", description: "Tests must stay green", enforceable: true, sourceRefs: objectiveRefs });
  }
  const acceptanceCriteria: unknown[] = [
    {
      id: "ac-objective",
      description: "The stated objective is addressed",
      observableCheck: "run.status is COMPLETED and child TASK_RESULT summaries cover the objective",
      sourceRefs: objectiveRefs
    }
  ];
  if (wantsTests) {
    acceptanceCriteria.push({
      id: "ac-tests",
      description: "Tests ran",
      observableCheck: "tester child TASK_RESULT verification is PASSED",
      sourceRefs: objectiveRefs
    });
  }
  const assumptions: unknown[] = [
    {
      id: "a-defaults",
      statement: "The smallest-change constraint is a heuristic default pending user confirmation",
      source: "heuristic-default"
    }
  ];
  if (vague) {
    assumptions.push({ id: "a-vague", statement: "Objective is underspecified until the user answers", source: "heuristic" });
  }
  const contract = validateRequirementContract({
    schemaVersion: 1,
    objective,
    deliverables,
    constraints,
    nonGoals: DEFAULT_NON_GOALS,
    acceptanceCriteria,
    assumptions,
    questions,
    authority: [],
    sourceRefs: objectiveRefs
  });
  const confidence = vague ? 0.55 : wantsReview ? 0.86 : 0.8;
  return { contract, confidence, inferences: [], authorityGrounding: [] };
}
function replicaCritiqueBody(contract: RequirementContract): ContractCritique {
  const critique = critiqueContract(contract);
  const omissions = [...critique.omissions];
  if (contract.questions.length > 0 && contract.acceptanceCriteria.length === 0) {
    omissions.push("acceptance-missing-while-questions-open");
  }
  return { ...critique, omissions };
}
function makeExtractor(
  body: (h: HeuristicHabits, i: { readonly objective: string; readonly sources: readonly NormalizedSource[] }) => SyncExtractionResult,
  habits: HeuristicHabits
): RequirementExtractor {
  return {
    roleId: HEURISTIC_EXTRACTOR_ROLE,
    async extract(input) {
      return body(habits, input);
    }
  };
}
function makeCritic(): ContractCritic {
  return {
    roleId: HEURISTIC_CRITIC_ROLE,
    async critique(input) {
      return replicaCritiqueBody(input.contract);
    }
  };
}
async function chainWith(
  body: (h: HeuristicHabits, i: { readonly objective: string; readonly sources: readonly NormalizedSource[] }) => SyncExtractionResult,
  objective: string,
  habits: HeuristicHabits
): Promise<ContractCandidate> {
  return buildContractCandidate({
    objective,
    sources: [createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })],
    extractor: makeExtractor(body, habits),
    critic: makeCritic(),
    minimumConfidence: 0.8
  });
}

{
  const rng = mulberry32(0x884802);
  for (let trial = 0; trial < 2500; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const args = { objective, ...(Object.keys(habits).length > 0 ? { habits } : {}) };
    const ref = JSON.stringify(await extractHeuristicContract(args));
    const replica = JSON.stringify(await chainWith(replicaExtractBody, objective, habits));
    check("S8-H-2 sanity gate (verbatim replica bit-identical)", ref === replica, `objective="${objective}"`);
    const cand = JSON.stringify(await chainWith(candidateExtractBody, objective, habits));
    check("S8-H-2 equivalence (push-based construction)", ref === cand, `objective="${objective}" habits=${JSON.stringify(habits)}`);
  }
  // Cost isolation: the extract body alone, production-scale inputs, both
  // spread branches (wantsTests true via objective, and vague objective).
  const normalized: NormalizedSource[] = [
    { ref: { kind: "message", ref: "cli-objective", excerpt: "x" }, text: "x", signals: [], origin: "user-turn", authority: "user", canGrantAuthority: true }
  ];
  for (const [label, objective] of [
    ["typical (wantsTests=true, 1 named file)", "fix the login retry bug in src/auth/session.ts and keep tests green"],
    ["vague (2 questions + a-vague)", "please make it better somehow"]
  ] as const) {
    let cur = 0;
    let cand = 0;
    for (let round = 0; round < 3; round += 1) {
      cur += bench(() => void replicaExtractBody({}, { objective, sources: normalized }), 30000);
      cand += bench(() => void candidateExtractBody({}, { objective, sources: normalized }), 30000);
    }
    cur /= 3;
    cand /= 3;
    log(
      `S8-H-2 bench extract body ${label}: spread-form=${(cur * 1e6).toFixed(0)}ns push-form cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (once per run; PIC-artifact caveat applies to deltas this small)`
    );
  }
}

/* ================================================================
 * S8-H-3: assertCoverageAllowsStart fully-resolved fast path — when
 * every question id is in the resolved set (exactly the production
 * assume-defaults track flow), skip the gated re-map AND the
 * blocking scan. Expected NOT equivalent: schema-legal questions
 * with default:"" (gated map skips them, blocking scan still fires)
 * or options:[""] (gated default becomes "", still falsy) keep
 * blocking under current code; the fast path opens the gate.
 * Replica sanity gate first; candidate differs only by the edit.
 * ================================================================ */
function replicaAssertStart(
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
  const result = checkCoverageGate(gated, coverageMatrixFromTasks(gated, tasks));
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
function candidateAssertStartFastPath(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[],
  options?: CoverageStartOptions
): void {
  if (isSkipContract(contract)) return;
  const resolved = new Set(options?.resolvedQuestionIds ?? []);
  const fullyResolved = contract.questions.every((question) => resolved.has(question.id));
  const gated: RequirementContract = fullyResolved
    ? contract // the candidate edit: skip the re-map, trust "resolved => non-blocking"
    : {
        ...contract,
        questions: contract.questions.map((question) => {
          if (question.default !== undefined || !resolved.has(question.id)) return question;
          return { ...question, default: question.options[0] ?? "resolved" };
        })
      };
  const matrix = coverageMatrixFromTasks(gated, tasks);
  const raw = checkCoverageGate(gated, matrix);
  const result = fullyResolved ? { ...raw, blockingDecisions: [], ok: raw.orphans.length === 0 && raw.uncoveredCriteria.length === 0 } : raw;
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
function genCoverageCase(rng: () => number): {
  contract: RequirementContract;
  tasks: CoverageTaskRef[];
  options: CoverageStartOptions | undefined;
} {
  const criterionCount = Math.floor(rng() * 4);
  const criteria: AcceptanceCriterion[] = Array.from({ length: criterionCount }, (_, i) => ({
    id: `ac-${i}`,
    description: "d",
    observableCheck: "c"
  }));
  const questions: DecisionQuestion[] = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => {
    const roll = rng();
    return {
      id: `q-${i}`,
      question: "q",
      options: roll < 0.15 ? [] : roll < 0.3 ? [""] : ["opt-a", "opt-b"],
      ...(rng() < 0.45 ? { default: rng() < 0.35 ? "" : "opt-a" } : {})
    };
  });
  const contract = {
    schemaVersion: 1,
    objective: "o",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: criteria,
    assumptions: rng() < 0.1 ? [{ id: "skip-contract", statement: "s", source: "src" }] : [],
    questions,
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
  const tasks: CoverageTaskRef[] = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
    id: `tsk_0000000${i}` as TaskId,
    acceptanceCriteria: criteria.filter(() => rng() < 0.7).map((criterion) => ({ id: criterion.id }))
  }));
  const roll = rng();
  const options: CoverageStartOptions | undefined =
    roll < 0.25
      ? undefined
      : roll < 0.6
        ? { resolvedQuestionIds: questions.map((question) => question.id) } // fully resolved (production shape)
        : { resolvedQuestionIds: questions.filter(() => rng() < 0.5).map((question) => question.id) };
  return { contract, tasks, options };
}

{
  const rng = mulberry32(0x884803);
  let replicaMismatch = 0;
  let divergences = 0;
  let firstDivergence = "";
  for (let trial = 0; trial < 8000; trial += 1) {
    const { contract, tasks, options } = genCoverageCase(rng);
    const ref = thrown(() => assertCoverageAllowsStart(contract, tasks, options));
    const rep = thrown(() => replicaAssertStart(contract, tasks, options));
    if (ref !== rep) replicaMismatch += 1;
    const cand = thrown(() => candidateAssertStartFastPath(contract, tasks, options));
    if (ref !== cand) {
      divergences += 1;
      if (firstDivergence === "") {
        firstDivergence = `questions=${JSON.stringify(contract.questions)} options=${JSON.stringify(options)} ref=${ref} cand=${cand}`;
      }
    }
  }
  check("S8-H-3 sanity gate (verbatim replica throw-parity)", replicaMismatch === 0, `${replicaMismatch} mismatches`);
  check("S8-H-3 fast path must diverge on schema-legal blocking questions", divergences > 0);
  log(`S8-H-3 fuzz: ${divergences}/8000 divergences under the fully-resolved fast path; first: ${firstDivergence.slice(0, 220)}`);
  // Directed counterexamples (schema-legal; validateRequirementContract does
  // not inspect question internals).
  const base = {
    schemaVersion: 1,
    objective: "o",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [],
    assumptions: [],
    authority: [],
    sourceRefs: []
  };
  const cx1 = {
    ...base,
    questions: [{ id: "q1", question: "?", options: ["yes"], default: "" }]
  } as unknown as RequirementContract;
  const cx2 = {
    ...base,
    questions: [{ id: "q1", question: "?", options: [""] }]
  } as unknown as RequirementContract;
  const opts: CoverageStartOptions = { resolvedQuestionIds: ["q1"] };
  const r1 = thrown(() => assertCoverageAllowsStart(cx1, [], opts));
  const c1 = thrown(() => candidateAssertStartFastPath(cx1, [], opts));
  const r2 = thrown(() => assertCoverageAllowsStart(cx2, [], opts));
  const c2 = thrown(() => candidateAssertStartFastPath(cx2, [], opts));
  check("S8-H-3 counterexample 1 (default:\"\" stays blocking)", r1 !== "NO_THROW" && c1 === "NO_THROW", `ref=${r1} cand=${c1}`);
  check("S8-H-3 counterexample 2 (options:[\"\"] defaults to \"\")", r2 !== "NO_THROW" && c2 === "NO_THROW", `ref=${r2} cand=${c2}`);
  log(
    `S8-H-3 counterexamples: default:"" -> current ${r1 === "NO_THROW" ? "opens" : "BLOCKS"} / fast-path cand ${c1 === "NO_THROW" ? "OPENS (fail-open)" : "blocks"}; options:[""] -> current ${r2 === "NO_THROW" ? "opens" : "BLOCKS"} / cand ${c2 === "NO_THROW" ? "OPENS (fail-open)" : "blocks"}`
  );
}

/* ================================================================
 * Ceiling re-verification, hot tier (R7-H §1, mandated: re-measure,
 * don't assume) — DEFAULT state (the seven-pass anchor shape) plus
 * the never-measured CONFIGURED states (R7-I matrix hole): habits
 * from preferences + questions present + resolvedQuestionIds
 * covering all questions (the production assume-defaults flow), and
 * the configured-vague variant (Q=3).
 * ================================================================ */
async function measureChain(
  label: string,
  objective: string,
  habits: HeuristicHabits | undefined
): Promise<void> {
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
  // Default state: the exact seven-pass anchor shape (Q=0, no options).
  await measureChain(
    "default (7-pass anchor shape)",
    "fix the login retry bug in src/auth/session.ts and keep tests green",
    undefined
  );
  // Configured state A: full habits from preferences; askBeforeWrite pushes
  // q-write, so the gate exercises the gated re-map materially (Q=1, all
  // resolved — the production assume-defaults flow).
  await measureChain(
    "configured A (habits set, Q=1 gated)",
    "fix the login retry bug in src/auth/session.ts and keep tests green",
    { requireTests: true, preferReview: false, askBeforeWrite: true }
  );
  // Configured state B: vague objective + askBeforeWrite -> Q=3, all resolved.
  await measureChain("configured B (vague, Q=3 gated)", "fix bug please", {
    askBeforeWrite: true
  });
  // Promotion command class: assertCanPromoteFromReview (once per promotion).
  const promo = bench(
    () => assertCanPromoteFromReview({ reviewerKind: "peer", reviewerId: "rev-1", actorId: "act-1" }),
    200000
  );
  log(`CEILING promotion class: assertCanPromoteFromReview=${(promo * 1e6).toFixed(1)}ns once per promotion`);
}

/* ================================================================
 * Cold-tier re-measure on dist (R6-H/R7-H once-per-process anchor),
 * default AND configured first-call shapes. 5 fresh processes each.
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
BRANCH=cursor/r8-h-eval-eighth-pass-83a1

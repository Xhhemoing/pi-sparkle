MODEL_SLUG=claude-fable-5-thinking-xhigh

# R1-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-H（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `fd437a9`
**分支:** `cursor/r1-h-eval-req-review-rubric-038d`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** 切片 21 个文件（1750 行）全部通读并以
新视角重新枚举，得到 9 个此前排除表未点名的候选（S1-H-1 … S1-H-9），全部经
理论 + 确定性仿真（seeded mulberry32，等价性 fuzz + 真实规模基准，三次独立
运行方向一致）裁决后淘汰：3 个不等价（各有硬发散反例），5 个等价但真实规模
噪声级——其中最强理论候选 S1-H-1 在**真实规模实测更慢**（战役第五例「小集合
索引结构固定开销 > 线性重算」），1 个的收益被 once-per-run 调用频次与生产
零流量双重钉死。本切片是全库**最冷**的面：生产入口全部是每 run 一次的合同
构建/门控（µs 级），其余为无生产调用方的 test-only 面；每个函数都已处于其
输出契约所要求的渐近下界。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量读码。上下游
  `domain/contract.ts`、`track/{clarify,loop,plan}.ts`、`run/{supervisor,
  coordinator,flowchart-run}.ts`、`adaptation/promotion-rules.ts` 只读取证，
  一行未改。
- 遵守排除表：**X4-9**（`classifyDiffScope` 的 changeSet Set 化）按指令维持
  排除，未触碰；X1-4/S1-A-8（3 元小表 find/includes 换 Map/Set）、X0-5
  （合并私有助手——critic.ts 与 requirement/precedence.ts 的矛盾检测重复
  维持分离）、X0-6/X1-1（正则/结果跨调用缓存）、S1-B-5（冗余 spread）、
  S1-A-3（单句输入正则微优化）全部未以原方案重开；候选枚举只探索**未被
  排除的新角度**（循环内重复求值提升、无操作拷贝跳过、查找索引化、多遍
  融合、可变化、长度早退）。
- 行为面全部不变：评价身份（evaluator kind/version/rubricVersion 契约、
  deterministic 无证据即 FAIL 的评分语义）、precedence（EVIDENCE_PRECEDENCE
  权重表与 requirement 冲突消解规则）、redaction/ownership 契约
  （X4-9 + DEFAULT_RULES 分类次序）、盲评双呈现 + 位置偏置检测协议、
  自评拒绝 fail-closed、authority grounding 信任校验——本轮零 diff，天然满足。

## 1. 现实规模测量（门槛第 3 条的证据基底）

全库交叉检索的生产调用方地图——本切片没有任何每 turn / 每事件热路径：

| 切片入口 | 生产调用方 | 频次与规模 |
| --- | --- | --- |
| `assertCoverageAllowsStart` | `run/supervisor.ts`、`run/coordinator.ts`、`run/flowchart-run.ts` | **每 run 启动一次**；合同准则 C=2（heuristic：ac-objective/ac-tests）、任务 ≤~6 角色 |
| `extractHeuristicContract` 链（normalizer→heuristic→extractor→critic→provenance） | `track/clarify.ts` | **每 run 一次**；1 个 CLI objective 源、单句文本、questions ≤4 |
| `applyPrecedence` / `detectConflicts` | `track/loop.ts` | **每 run 一次**；C 个位数 |
| `shouldScout` | `track/plan.ts` | 每 run 一次；单句正则 |
| `assertCanPromoteFromReview` | `adaptation/promotion-rules.ts` | 每次晋升一次；O(1) 谓词 |
| `src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、`src/rubric/` 全部 2 文件 | **无生产调用方**（仅 `test/unit/{evaluation,review}`、`test/integration/m3/checkpoint-d`、`test/integration/m4/delivery-evidence`） | test-only 面（S1-E-7/8 同类），收益在生产不可测 |

确定性 anchor（详见 §7 仿真输出）：

```text
anchor: one extractHeuristicContract = 7.3us (once per run)
anchor: run-start coverage gate (C=2, 5 tasks) = 650-700ns (once per run start)
anchor: createEvaluationRecord (5 criteria) = 1.1-1.3us (no production caller)
anchor: runBlindPairwisePair = 2.1-2.2us (no production caller)
```

即：本切片生产热度峰值是**每 run 一次的 ~8µs**。任何常数级微优化的收益上界
都在 ns–亚 µs/run，低于战役全部既往噪声线。

## 2. 结构下界论证（为什么渐近层面没有余地）

| 函数 | 下界论证 |
| --- | --- |
| `checkCoverageGate` | 输出契约要求逐准则判覆盖 + 逐 question 判 blocking ⇒ Ω(C+Q)；现 O(C×K) 的 K 因子在真实 C=2 上**比 O(C+K) 的 Set 构建更便宜**（S1-H-1 实测）；首合取项 `Object.keys().includes` 是**原型链守卫**（§4.1），不可删 |
| `coverageMatrixFromTasks` | 单遍 Θ(T×AC)，输出即矩阵本身 |
| `assertCoverageAllowsStart` | gated 副本 + 全量门控是 fail-closed 启动契约；错误消息拼装被测试断言 |
| `heuristicExtractor.extract` | 合同构造是输出本体 Θ(字段)；正则链扫单句文本；`validateRequirementContract` 全字段校验是 fail-closed 契约 |
| `normalizeSources` | Θ(源数×字节)：3 个信号正则 + 200B excerpt 切片均为输出契约；TRUSTED_SOURCE symbol 检查 O(1) |
| `critiqueContract` / `findUnsourcedItems` | 各单遍 Θ(项数)；分数公式为规格 |
| `assertAuthorityGrounding` | Ω(A)（逐 grant 必验）；`find` 的**首现语义**是行为（S1-H-4 反例）；生产 A=0 |
| `applyPrecedence` / `detectConflicts` | Ω(C) 必扫全准则；冲突消解次序（合同序 filter + ordered[0]/at(-1)）是行为 |
| `reconcileReviews` | dissent 依赖 consensus ⇒ 结构上 ≥2 遍；现 3+1 遍于 n=2 |
| `runBlindPairwisePair` | **双物质比较是设计契约**（位置偏置检测；两次 `createEventId`/`nowIso` 可观察），复用首比较推导 swapped 属行为改变 |
| `createEvaluationRecord` | 单遍 map + 3 聚合谓词，准则个位数；id/createdAt 新鲜性是契约 |
| `CheckAdapter.evaluate` | 校验分支序（cwd→revision→changeSet→exitCode）是错误归因契约；`hashArtifact` Θ(字节) 是 attribution 规格；`changeSetsEqual` O(a+b) 双 Set 是**集合相等**语义本体（S1-H-9 反例） |
| `classifyDiffScope` | O(P×规则数) + `changeSet.includes`；Set 化 = X4-9 维持排除 |
| `Delivery/DiffAdapter` | 常数分支守卫，无循环 |
| `evaluation/precedence.ts` | 3 元固定表 find（X1-4/S1-A-8 同类，Iter4 已点名） |
| `registerRubric` | copy-on-write 恰是 `resetRubricRegistry` 正确性的前提（`{...DEFAULT_REGISTRY}` 浅拷贝共享 rubrics 对象，S1-H-8 反例）；R 个位数 |
| `self-review.ts` | O(1) 谓词 + throw，fail-closed 契约 |

结论：剩余候选只能是 C=2 / Q≤4 / n=2 / 表长 3 尺度上的常数与分配削减，或
无生产流量面上的改良——正是战役已反复裁决为噪声的类别。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-H-1 | `checkCoverageGate` 循环内逐准则重算的 `Object.keys(requirementToTasks)` 提升为循环外一次性 Set | O(C×K)+C 次数组分配 → O(C+K)+1 | ✅ 6000 fuzz（含 constructor/toString 等原型链准则 id）逐字节一致；原型链守卫语义保留 | 真实 C=2/K=2 **实测更慢**：76→102ns（三次运行 −23/−28/−26ns 一致）；C=200 压力（超真实两个量级）才 74×（596µs→8.7µs） | 淘汰：真实规模负优化（S1-A-4/S1-B-6/S1-E-6/S1-E-8 系列第五例） |
| S1-H-2 | `assertCoverageAllowsStart` 无 question 会被 default 时跳过 gated 合同拷贝 | 免 1 次对象 + 数组 map 分配 | ✅ 6000 fuzz（throw/不 throw + 错误消息逐字节，含 skip-contract/空 options 全路径） | 省 75–111ns/run，每 run 启动一次 | 淘汰：噪声 |
| S1-H-3 | `heuristicExtractor.extract` 内 `shouldAskScope` 与外层的 `namedTargets`/`shouldScout` 重复求值去重（传参复用） | 免 1 次正则重扫 | —（纯函数重复求值，平凡等价） | 重复份额 ~690ns = 一次 `extractHeuristicContract`（7.3µs，每 run 一次）的 **9.5%** | 淘汰：单句输入噪声（S1-A-3/S1-B-1 同类），且需改私有函数签名传递中间值 |
| S1-H-4 | `assertAuthorityGrounding` 逐 grant 的 `grounding.find` 换预建 Map | O(A×G)→O(A+G) | first-wins Map ✅ 6000 fuzz；**naive last-wins Map ❌ 发散反例**（重复 authorityIndex 时 find 取首条：trusted 首条+untrusted 次条 → current 通过 / naive 抛错） | 生产 A=0（heuristic 恒 `authority: []`），G 个位数 | 淘汰：生产不可测 + 显然写法不等价（隐含「index 唯一」不变量，S1-A-9/S1-E-1 同类） |
| S1-H-5 | `applyPrecedence` 融合 `detectConflicts` 双 filter 为单遍 + `conflict.ids.includes` 换 Set | 3 遍→1 遍；O(C×ids)→O(C) | ✅ 6000×2 fuzz（含 fast∧slow 双命中准则、重复准则 id、三种 rule）逐字节一致 | 真实 C 个位数省 15–182ns/run，每 run 一次 | 淘汰：噪声 |
| S1-H-6 | `reconcileReviews` 三遍 filter + Set 去重折为两遍（计数遍 + dissent/去重遍） | 3+1 遍→2 遍 | ✅ 8000 fuzz（含空表、全 tie、平票 uncertain）一致 | 生产 n=2（盲评对）省 46–77ns/call | 淘汰：亚噪声（S1-A-6 同类） |
| S1-H-7 | `createEvaluationRecord` 三聚合谓词（some FAIL/some PASS/every UNOBSERVED）融合进 scores map 循环 | 4 遍→1 遍 | ✅ 6000 fuzz + 2 条验证抛错路径（空 artifactId、未知 independence class）一致 | 准则个位数、全调用 1.1–1.3µs 且**无生产调用方** | 淘汰：噪声 + test-only 面（S1-E-7 同类） |
| S1-H-8 | `registerRubric` copy-on-write 改就地可变写入 | 免每次 O(R) rubrics 拷贝 | ❌ **发散反例**：`registry = {...DEFAULT_REGISTRY}` 浅拷贝共享 rubrics 对象 ⇒ 就地写污染 DEFAULT_REGISTRY ⇒ `resetRubricRegistry` 后 rubric 仍可见（current=0 vs candidate=1） | — | 淘汰：不等价（模块状态别名污染） |
| S1-H-9 | `changeSetsEqual` 前置数组长度早退 | O(1) 快速拒绝 | ❌ **发散反例**：语义是**集合相等**（重复元素折叠）——`["a.ts","a.ts"]` vs `["a.ts"]` 经公开 `CheckAdapter.evaluate` 现返 PASS，长度早退候选判 stale-FAIL | — | 淘汰：不等价 |

另有七处以既有排除/设计契约直接覆盖、不立新 ID：`classifyDiffScope`
changeSet Set 化（**X4-9 维持**）；`extractHeuristicContract` 的冗余
`[...sources]` spread（S1-B-5 同类分配噪声）；`runBlindPairwisePair` 复用首
比较推导 swapped（双物质比较是位置偏置检测协议本体 + 两份 id/时间戳可观察）；
`getPrecedenceWeight`/`INDEPENDENCE_CLASSES.includes`/`SCOPE_PRECEDENCE` 类
3 元表 Map/Set 化（X1-4/S1-A-8 同类）；critic.ts 与 requirement/precedence.ts
矛盾检测重复的合并（X0-5 同类私有助手合并）；`extractSignals` 三正则并单正则
（分类输出契约 + 常数级）；`remapToOriginalIds` 的 "ab" 路径冗余展开拷贝
（分配级噪声，test-only 面）。

## 4. 关键裁决细节

### 4.1 S1-H-1：最强理论候选被真实规模推翻 + 一个必须保留的「冗余」守卫

`checkCoverageGate` 循环体内每个准则重算 `Object.keys(matrix.requirementToTasks)`
并做线性 `includes`，纸面上是切片内唯一的超线性结构（O(C×K) + C 次数组分配）。
但真实规模 C=2（heuristic 合同的 ac-objective/ac-tests）、每 run 启动一次：
预建 Set 的固定开销高于两次短数组扫描，三次独立运行**一致更慢**
（76→102ns）。要到 C=200（超真实两个量级）才出现 74× 收益。与 S1-A-4
（prescore Set 化）、S1-B-6（routeR0 Map 化）、S1-E-6（diagnostics 融合）、
S1-E-8（patterns 预取）构成同一教训的第五例。

仿真同时揭示该行的第一合取项**不是冗余**：`Object.keys().includes(id)` 把
覆盖判定限制在**自有可枚举键**上。若删守卫只留
`(requirementToTasks[id]?.length ?? 0) > 0`，则准则 id 为 `"constructor"` 时
`Object.prototype.constructor.length === 1` 使门**fail-open**（未覆盖准则被
判已覆盖，guard-dropped 变体 uncovered=0 vs current=1）。与 R1-A 对
`mapGateDirective` FAIL_CLOSED、R1-E 对 diagnostics 恒真守卫的裁决同向：
守卫保留。等价的 hoist 写法（`new Set(Object.keys(...))`）保持了该语义，
但按上段基准仍属负优化。

### 4.2 S1-H-8 / S1-H-9 的发散反例（可变化与早退的两类经典陷阱）

```text
S1-H-8: registerRubric 就地写入
  registry = { ...DEFAULT_REGISTRY }   // 浅拷贝：rubrics 与 DEFAULT 共享
  register(r1); reset(); listRubrics()
  current → []        mutable-candidate → [r1]   （DEFAULT_REGISTRY 被污染）
S1-H-9: changeSetsEqual 长度早退
  CheckAdapter.evaluate(changeSet=["a.ts","a.ts"] vs context=["a.ts"])
  current → PASS（集合相等语义）   length-exit-candidate → stale-changeset FAIL
```

前者证明 copy-on-write 不是风格而是 `resetRubricRegistry` 正确性的前提；
后者证明 `changeSetsEqual` 的双 Set 实现刻意选择了**集合相等**（重复路径
折叠）而非数组相等——长度早退隐含「无重复」不变量，而调用方（CommandResult
的 caller-provided changeSet）无处强制它。两者与 S1-A-9/S1-E-1 同属
「候选隐含无处强制的不变量」系列，为将来同类提案立反例。

### 4.3 S1-H-4：显然的 Map 化写法本身就不等价

`grounding.find(item => item.authorityIndex === index)` 的**首现语义**是行为：
重复 authorityIndex 条目（首条 trusted、次条 untrusted）下，`new Map(
grounding.map(g => [g.authorityIndex, g]))` 的 last-wins 覆盖使校验从通过变
抛错。等价的 first-wins 写法存在（6000 fuzz 一致），但生产调用链
（heuristic → buildContractCandidate）恒传 `authority: []`、`grounding: []`，
A=0 使任何收益不可测。淘汰双证：显然写法不健全 + 正确写法零流量。

### 4.4 test-only 面的统一裁决

`src/evaluation/`（Iter4 §1.6 已逐文件裁决，本轮以调用方检索再确认）、
`review/{pairwise,reconcile,critic}.ts`、`src/rubric/` 在 `src/` 内除切片
自身与类型导入外**没有任何生产调用方**——它们是 M3/M4 契约的规格面，被
单测与集成测试锚定。S1-E-7/8 先例：无生产流量面上的优化在生产不可测，
一律不落地。该面的每个函数同时也是评价身份/盲评协议的规格载体，
任何「等价重写」的回归风险都高于零收益。

## 5. 逐文件收口

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `evaluation/adapters.ts` / `types.ts` | 纯类型 + 常量 | 无候选 |
| `evaluation/check-adapter.ts` | S1-H-9 淘汰；校验分支序为归因契约；`hashArtifact` Θ(字节) 为 attribution 规格；`attributionMetadata` 各返回路径均使用，无惰性化空间 | 无候选 |
| `evaluation/delivery-adapter.ts` | 常数分支；isDeliveryEvidence 全字段校验为 ABSTAIN/UNOBSERVED 区分契约 | 无候选 |
| `evaluation/diff-adapter.ts` | 4 个 length 检查（Iter4 复核成立） | 无候选 |
| `evaluation/evaluator.ts` | S1-H-7 淘汰；`INDEPENDENCE_CLASSES.includes` 表长 3（S1-A-8 同类） | 无候选 |
| `evaluation/ownership.ts` | changeSet Set 化 = **X4-9 维持**；规则链早退已存在 | 无候选 |
| `evaluation/precedence.ts` | 3 元表 find/reduce（X1-4 同类，R1-J S4 对 preferences 同构面同判） | 无候选 |
| `requirement/coverage.ts` | S1-H-1/2 淘汰；原型链守卫保留（§4.1）；`coverageMatrixFromTasks` 单遍即输出 | 无候选 |
| `requirement/critic.ts` | 与 precedence.ts 矛盾检测重复 = X0-5 同类维持分离；单遍 + 分数公式为规格 | 无候选 |
| `requirement/extractor.ts` | S1-H-4 淘汰；extractor≠critic 角色校验、confidence 校验、inference 标注为契约本体 | 无候选 |
| `requirement/heuristic.ts` | S1-H-3 淘汰；`[...sources]` 冗余 spread = S1-B-5 同类；questions 去重 `some` 上界 4 | 无候选 |
| `requirement/normalizer.ts` | 3 信号正则 + excerpt 切片为输出契约；TRUSTED_SOURCE symbol O(1)；`buildContractFromSources` 无生产调用方 | 无候选 |
| `requirement/precedence.ts` | S1-H-5 淘汰；消解次序（合同序 + ordered[0]/at(-1)）为行为 | 无候选 |
| `requirement/provenance.ts` | assumptionIds Set 已建；三个单遍 filter+map 即输出 | 无候选 |
| `review/critic.ts` | actorDefense 拒绝 fail-closed 为契约；单遍 map + some，test-only 面 | 无候选 |
| `review/pairwise.ts` | 双物质比较为设计契约（§3 注）；`presentInput` "ab" 已恒等返回 | 无候选 |
| `review/reconcile.ts` | S1-H-6 淘汰；`Array.from(new Set(...))` 首现序语义已被两遍版逐位复刻仍判噪声 | 无候选 |
| `review/self-review.ts` | O(1) 谓词；中间 `RoutingScoreUpdate` 对象为分配级噪声（V8 逃逸分析可消除） | 无候选 |
| `rubric/registry.ts` | S1-H-8 淘汰；copy-on-write 为 reset 正确性前提 | 无候选 |
| `rubric/types.ts` | 纯类型 + Θ(字段) 构造 | 无候选 |

## 6. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 7. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2，满足 engines
>=22.19.0；系统 Node 22.14.0 过低的既知环境注记见 R1-J §3）：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0
```

仿真（临时脚本 `/tmp/r1h-sim.mts`，未入库以遵守「不改切片外文件」约束；
完整源码见附录，seed 固定可复现）最终一次运行：

```text
S1-H-1 proto-key case: current uncovered=1 hoisted=1 guard-dropped=0 -> keys guard is semantic; only the hoist is equivalent
S1-H-1 bench real C=2,K=2: current=76ns cand=102ns delta=-26ns/call
S1-H-1 bench stress C=200,K=200: current=596287ns cand=8659ns delta=587628ns/call
S1-H-2 bench run-start gate (C=2, 5 tasks): current=655ns cand=572ns delta=84ns/run (called once per run start)
S1-H-3 anchor: duplicated namedTargets+shouldScout=691ns (isVague=302ns) vs one extractHeuristicContract=7287ns (9.5% of a once-per-run call)
S1-H-4 duplicate-index case: current=NO_THROW last-wins-map=DomainValidationError -> naive Map indexing NOT equivalent; first-wins is, but A is 0 in production (heuristic authority=[])
S1-H-5 bench real C~4 (2 criteria): current=380ns cand=365ns delta=15ns/call (called once per run)
S1-H-5 bench stress C~400 (298 criteria): current=98941ns cand=36878ns delta=62063ns/call (called once per run)
S1-H-6 bench production n=2: current=77ns cand=31ns delta=46ns/call
S1-H-6 bench stress n=100: current=843ns cand=463ns delta=380ns/call
S1-H-7 anchor: createEvaluationRecord (5 criteria)=1141ns/call, no production caller (test-only face); fusion delta is sub-noise by construction
S1-H-8 counterexample: rubrics visible after reset — current=0 mutable-candidate=1 -> NOT equivalent (DEFAULT_REGISTRY pollution breaks resetRubricRegistry)
S1-H-9 counterexample: changeSet ["a.ts","a.ts"] vs ["a.ts"] — CheckAdapter=PASS (set semantics) length-exit-candidate=stale-FAIL -> NOT equivalent
anchor: runBlindPairwisePair=2126ns/call (double-compare is the design contract; no production caller)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~44000 项等价检查全部通过、结论逐位一致；计时抖动内方向稳定
（S1-H-1 真实规模三次全部更慢：−23/−28/−26ns；三个反例三次全部复现）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-H-1 | checkCoverageGate 循环内 Object.keys 提升为循环外 Set | 等价但真实 C=2 实测更慢（小集合 Set 构建开销，S1-A-4 系列第五例）；首合取项为原型链守卫不可删 |
| S1-H-2 | assertCoverageAllowsStart 无解析问题时跳过 gated 合同拷贝 | 等价但省 ~80ns/run，每 run 启动一次，噪声 |
| S1-H-3 | heuristic extract 的 namedTargets/shouldScout 重复求值去重 | 单句输入噪声（重复份额 ~690ns，占 once-per-run 调用 9.5%）；需改私有签名 |
| S1-H-4 | assertAuthorityGrounding grounding.find 换 Map | naive last-wins 不等价（重复 authorityIndex 反例）；first-wins 等价但生产 A=0 不可测 |
| S1-H-5 | applyPrecedence 融合 detectConflicts 双 filter + conflict.ids Set 化 | 等价但真实 C 个位数省 15–182ns/run，噪声 |
| S1-H-6 | reconcileReviews 三遍 filter 融合两遍 | 等价但生产 n=2 省 ~50ns，亚噪声（S1-A-6 同类） |
| S1-H-7 | createEvaluationRecord 聚合谓词融合进 map 循环 | 准则个位数 + 无生产调用方（test-only 面，S1-E-7 同类） |
| S1-H-8 | registerRubric copy-on-write 改就地可变写入 | 不等价：浅拷贝共享使 DEFAULT_REGISTRY 被污染，reset 后 rubric 泄漏反例 |
| S1-H-9 | changeSetsEqual 数组长度早退 | 不等价：语义为集合相等（重复折叠），["a.ts","a.ts"] vs ["a.ts"] 反例经公开 CheckAdapter 发散 |

重开条件：S1-H-1/2/5 若合同准则/问题规模增长 ≥2 个量级或门控进入每 turn
热路径，可凭本报告等价性证据重开（S1-H-1 需先推翻真实规模负优化基准）；
S1-H-3 若 objective 变多段长文本可重开；S1-H-4 需先出现非空 authority 的
生产流量；S1-H-6/7 需先出现 `reconcileReviews`（n>2）/`createEvaluationRecord`
的生产调用方；S1-H-8/9 需先推翻本报告的发散反例（即改掉 reset 浅拷贝语义 /
证明 changeSet 无重复不变量并版本化该语义变更）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装；
`.mts` 保证 ESM 顶层 await 可用）。seeds：`0x114801`–`0x11480b`。

```ts
/**
 * R1-H deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-H-1 .. S1-H-9 against the current
 * implementations in src/{evaluation,requirement,review,rubric}.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0x114801-0x11480b.
 *
 * Reference = production imports wherever the function is exported;
 * private helpers are replicated verbatim and the candidate differs from
 * the replica ONLY by the candidate edit.
 */
import { performance } from "node:perf_hooks";
import {
  checkCoverageGate,
  coverageMatrixFromTasks,
  assertCoverageAllowsStart,
  isSkipContract,
  type CoverageGateResult,
  type CoverageTaskRef,
  type CoverageStartOptions
} from "/workspace/src/requirement/coverage.js";
import {
  applyPrecedence,
  detectConflicts,
  type PrecedenceRule
} from "/workspace/src/requirement/precedence.js";
import {
  extractHeuristicContract,
  namedTargets,
  shouldScout,
  isVague
} from "/workspace/src/requirement/heuristic.js";
import { reconcileReviews } from "/workspace/src/review/reconcile.js";
import {
  runBlindPairwisePair,
  type PairwiseInput,
  type PairwiseResult
} from "/workspace/src/review/pairwise.js";
import {
  createEvaluationRecord,
  type EvaluationInput
} from "/workspace/src/evaluation/evaluator.js";
import { createCheckAdapter } from "/workspace/src/evaluation/check-adapter.js";
import type { AdapterContext, CommandResult } from "/workspace/src/evaluation/adapters.js";
import {
  registerRubric,
  listRubrics,
  resetRubricRegistry
} from "/workspace/src/rubric/registry.js";
import { createRubric, type Rubric, type RubricCriterion, type RubricScope } from "/workspace/src/rubric/types.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import type {
  RequirementContract,
  CoverageMatrix,
  AcceptanceCriterion,
  DecisionQuestion,
  Assumption
} from "/workspace/src/domain/contract.js";
import type { EpisodeId, TaskId } from "/workspace/src/domain/ids.js";
import type { EvaluatorKind, Finding, IndependenceClass } from "/workspace/src/evaluation/types.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}`);
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
function thrown(fn: () => void): string {
  try {
    fn();
    return "NO_THROW";
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}

/* ================================================================
 * S1-H-1: checkCoverageGate — hoist the per-criterion
 * Object.keys(matrix.requirementToTasks) recomputation into one
 * pre-loop Set. Candidate differs only by the hoist.
 * Also adjudicate the "drop the keys guard entirely" variant, which
 * must DIVERGE on prototype-chain criterion ids.
 * ================================================================ */
function candidateCheckCoverageGate(
  contract: RequirementContract,
  matrix: CoverageMatrix
): CoverageGateResult {
  const orphans = [...matrix.orphanRequirements];
  const uncoveredCriteria: string[] = [];
  const blockingDecisions: string[] = [];
  const ownKeys = new Set(Object.keys(matrix.requirementToTasks)); // the candidate edit
  for (const criterion of contract.acceptanceCriteria) {
    const covered =
      ownKeys.has(criterion.id) &&
      (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0;
    if (!covered) uncoveredCriteria.push(criterion.id);
  }
  for (const q of contract.questions) {
    if (!q.default) blockingDecisions.push(q.id);
  }
  const ok = orphans.length === 0 && uncoveredCriteria.length === 0 && blockingDecisions.length === 0;
  return { ok, orphans, uncoveredCriteria, blockingDecisions };
}

function unguardedCheckCoverageGate(
  contract: RequirementContract,
  matrix: CoverageMatrix
): CoverageGateResult {
  const orphans = [...matrix.orphanRequirements];
  const uncoveredCriteria: string[] = [];
  const blockingDecisions: string[] = [];
  for (const criterion of contract.acceptanceCriteria) {
    const covered = (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0; // guard dropped
    if (!covered) uncoveredCriteria.push(criterion.id);
  }
  for (const q of contract.questions) {
    if (!q.default) blockingDecisions.push(q.id);
  }
  const ok = orphans.length === 0 && uncoveredCriteria.length === 0 && blockingDecisions.length === 0;
  return { ok, orphans, uncoveredCriteria, blockingDecisions };
}

const WEIRD_IDS = ["constructor", "toString", "hasOwnProperty", "valueOf"];

function genCoverageCase(rng: () => number, scale: number): { contract: RequirementContract; matrix: CoverageMatrix } {
  const criterionCount = Math.floor(rng() * 6 * scale);
  const criteria: AcceptanceCriterion[] = Array.from({ length: criterionCount }, (_, i) => ({
    id: rng() < 0.08 ? pick(rng, WEIRD_IDS) : `ac-${i}`,
    description: `criterion ${i}`,
    observableCheck: "check"
  }));
  const questions: DecisionQuestion[] = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
    id: `q-${i}`,
    question: `question ${i}`,
    options: ["yes", "no"],
    ...(rng() < 0.5 ? { default: rng() < 0.3 ? "" : "yes" } : {})
  }));
  const requirementToTasks: Record<string, TaskId[]> = {};
  for (const criterion of criteria) {
    const roll = rng();
    if (roll < 0.5) requirementToTasks[criterion.id] = ["tsk_00000001" as TaskId];
    else if (roll < 0.65) requirementToTasks[criterion.id] = []; // own key, empty owners
    // else: key absent
  }
  if (rng() < 0.2) requirementToTasks[`stray-${Math.floor(rng() * 5)}`] = ["tsk_00000002" as TaskId];
  const contract = {
    schemaVersion: 1,
    objective: "obj",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: criteria,
    assumptions: [],
    questions,
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
  const matrix: CoverageMatrix = {
    contractVersion: 1,
    requirementToTasks,
    taskToChecks: {},
    orphanRequirements: rng() < 0.2 ? ["orphan-1"] : []
  };
  return { contract, matrix };
}

{
  const rng = mulberry32(0x114801);
  for (let trial = 0; trial < 6000; trial += 1) {
    const { contract, matrix } = genCoverageCase(rng, 1);
    check(
      "S1-H-1 equivalence (hoisted key set)",
      JSON.stringify(checkCoverageGate(contract, matrix)) ===
        JSON.stringify(candidateCheckCoverageGate(contract, matrix)),
      JSON.stringify({ ac: contract.acceptanceCriteria, m: matrix.requirementToTasks })
    );
  }
  // Directed: prototype-chain criterion id shows the keys guard is semantic.
  const protoContract = {
    schemaVersion: 1,
    objective: "obj",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "constructor", description: "d", observableCheck: "c" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
  const emptyMatrix: CoverageMatrix = {
    contractVersion: 1,
    requirementToTasks: {},
    taskToChecks: {},
    orphanRequirements: []
  };
  const guarded = checkCoverageGate(protoContract, emptyMatrix);
  const hoisted = candidateCheckCoverageGate(protoContract, emptyMatrix);
  const unguarded = unguardedCheckCoverageGate(protoContract, emptyMatrix);
  check("S1-H-1 guard: current marks 'constructor' uncovered", guarded.uncoveredCriteria.length === 1);
  check("S1-H-1 guard: hoisted-set candidate agrees", hoisted.uncoveredCriteria.length === 1);
  check("S1-H-1 guard-drop variant must diverge", unguarded.uncoveredCriteria.length === 0);
  console.log(
    `S1-H-1 proto-key case: current uncovered=${guarded.uncoveredCriteria.length} hoisted=${hoisted.uncoveredCriteria.length} guard-dropped=${unguarded.uncoveredCriteria.length} -> keys guard is semantic; only the hoist is equivalent`
  );
  // Real scale: heuristic contract has 2 criteria; run-start gate is called once.
  for (const [label, C, reps] of [["real C=2,K=2", 2, 50000], ["stress C=200,K=200", 200, 2000]] as const) {
    const criteria: AcceptanceCriterion[] = Array.from({ length: C }, (_, i) => ({
      id: `ac-${i}`,
      description: "d",
      observableCheck: "c"
    }));
    const requirementToTasks: Record<string, TaskId[]> = {};
    for (const criterion of criteria) requirementToTasks[criterion.id] = ["tsk_00000001" as TaskId];
    const contract = {
      schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
      acceptanceCriteria: criteria, assumptions: [], questions: [], authority: [], sourceRefs: []
    } as unknown as RequirementContract;
    const matrix: CoverageMatrix = { contractVersion: 1, requirementToTasks, taskToChecks: {}, orphanRequirements: [] };
    const cur = bench(() => checkCoverageGate(contract, matrix), reps);
    const cand = bench(() => candidateCheckCoverageGate(contract, matrix), reps);
    console.log(
      `S1-H-1 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * S1-H-2: assertCoverageAllowsStart — skip the gated-contract copy
 * when no question would actually be defaulted.
 * ================================================================ */
function candidateAssertStart(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[],
  options?: CoverageStartOptions
): void {
  if (isSkipContract(contract)) return;
  const resolved = new Set(options?.resolvedQuestionIds ?? []);
  let gated = contract; // candidate edit: copy only when a question changes
  if (
    resolved.size > 0 &&
    contract.questions.some((question) => question.default === undefined && resolved.has(question.id))
  ) {
    gated = {
      ...contract,
      questions: contract.questions.map((question) => {
        if (question.default !== undefined || !resolved.has(question.id)) return question;
        return { ...question, default: question.options[0] ?? "resolved" };
      })
    };
  }
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

{
  const rng = mulberry32(0x114802);
  for (let trial = 0; trial < 6000; trial += 1) {
    const criterionCount = Math.floor(rng() * 5);
    const criteria: AcceptanceCriterion[] = Array.from({ length: criterionCount }, (_, i) => ({
      id: `ac-${i}`,
      description: "d",
      observableCheck: "c"
    }));
    const questions: DecisionQuestion[] = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
      id: `q-${i}`,
      question: "q",
      options: rng() < 0.8 ? ["opt-a", "opt-b"] : [],
      ...(rng() < 0.4 ? { default: rng() < 0.3 ? "" : "opt-a" } : {})
    }));
    const assumptions: Assumption[] =
      rng() < 0.15 ? [{ id: "skip-contract", statement: "s", source: "src" }] : [];
    const contract = {
      schemaVersion: 1, objective: "o", deliverables: [], constraints: [], nonGoals: [],
      acceptanceCriteria: criteria, assumptions, questions, authority: [], sourceRefs: []
    } as unknown as RequirementContract;
    const tasks: CoverageTaskRef[] = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
      id: `tsk_0000000${i}` as TaskId,
      acceptanceCriteria: criteria.filter(() => rng() < 0.6).map((criterion) => ({ id: criterion.id }))
    }));
    const options: CoverageStartOptions | undefined =
      rng() < 0.6
        ? { resolvedQuestionIds: questions.filter(() => rng() < 0.5).map((question) => question.id) }
        : undefined;
    check(
      "S1-H-2 equivalence (skip no-op gated copy)",
      thrown(() => assertCoverageAllowsStart(contract, tasks, options)) ===
        thrown(() => candidateAssertStart(contract, tasks, options)),
      `trial ${trial}`
    );
  }
  // real-scale anchor: the run-start gate on a heuristic-shaped contract
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
  const cand = bench(() => candidateAssertStart(contract, tasks), 50000);
  console.log(
    `S1-H-2 bench run-start gate (C=2, 5 tasks): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run (called once per run start)`
  );
}

/* ================================================================
 * S1-H-3: heuristic extract — namedTargets/shouldScout evaluated
 * twice per extraction (once directly, once inside shouldAskScope).
 * Purity makes dedup trivially equal; anchor = duplicate share vs
 * one full extractHeuristicContract call (once per run).
 * ================================================================ */
{
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const dupCost = bench(() => {
    void namedTargets(objective);
    void shouldScout(objective);
  }, 50000);
  const vagueCost = bench(() => void isVague(objective), 50000);
  const full = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  console.log(
    `S1-H-3 anchor: duplicated namedTargets+shouldScout=${(dupCost * 1e6).toFixed(0)}ns (isVague=${(vagueCost * 1e6).toFixed(0)}ns) vs one extractHeuristicContract=${(full * 1e6).toFixed(0)}ns (${((dupCost / full) * 100).toFixed(1)}% of a once-per-run call)`
  );
}

/* ================================================================
 * S1-H-4: assertAuthorityGrounding — grounding.find per authority
 * index -> prebuilt Map. Reference = verbatim replica of the private
 * function in extractor.ts. First-wins Map is equivalent; the naive
 * last-wins Map DIVERGES on duplicate authorityIndex entries.
 * ================================================================ */
interface GroundingEntry {
  readonly authorityIndex: number;
  readonly sourceRefs: readonly string[];
}
interface MiniSource {
  readonly ref: { readonly ref: string };
  readonly canGrantAuthority: boolean;
}

function referenceAssertAuthority(
  authorityLength: number,
  grounding: readonly GroundingEntry[],
  sources: readonly MiniSource[]
): void {
  const sourcesByRef = new Map(sources.map((source) => [source.ref.ref, source]));
  for (let authorityIndex = 0; authorityIndex < authorityLength; authorityIndex += 1) {
    const entry = grounding.find((item) => item.authorityIndex === authorityIndex);
    const trusted = entry?.sourceRefs.some((ref) => sourcesByRef.get(ref)?.canGrantAuthority === true) ?? false;
    if (!trusted) {
      throw new DomainValidationError(
        `authority grant ${authorityIndex} requires a user or approved-project source`
      );
    }
  }
}

function candidateAssertAuthorityFirstWins(
  authorityLength: number,
  grounding: readonly GroundingEntry[],
  sources: readonly MiniSource[]
): void {
  const sourcesByRef = new Map(sources.map((source) => [source.ref.ref, source]));
  const byIndex = new Map<number, GroundingEntry>();
  for (const item of grounding) {
    if (!byIndex.has(item.authorityIndex)) byIndex.set(item.authorityIndex, item);
  }
  for (let authorityIndex = 0; authorityIndex < authorityLength; authorityIndex += 1) {
    const entry = byIndex.get(authorityIndex);
    const trusted = entry?.sourceRefs.some((ref) => sourcesByRef.get(ref)?.canGrantAuthority === true) ?? false;
    if (!trusted) {
      throw new DomainValidationError(
        `authority grant ${authorityIndex} requires a user or approved-project source`
      );
    }
  }
}

function naiveAssertAuthorityLastWins(
  authorityLength: number,
  grounding: readonly GroundingEntry[],
  sources: readonly MiniSource[]
): void {
  const sourcesByRef = new Map(sources.map((source) => [source.ref.ref, source]));
  const byIndex = new Map(grounding.map((item) => [item.authorityIndex, item]));
  for (let authorityIndex = 0; authorityIndex < authorityLength; authorityIndex += 1) {
    const entry = byIndex.get(authorityIndex);
    const trusted = entry?.sourceRefs.some((ref) => sourcesByRef.get(ref)?.canGrantAuthority === true) ?? false;
    if (!trusted) {
      throw new DomainValidationError(
        `authority grant ${authorityIndex} requires a user or approved-project source`
      );
    }
  }
}

{
  const rng = mulberry32(0x114804);
  for (let trial = 0; trial < 6000; trial += 1) {
    const authorityLength = Math.floor(rng() * 4);
    const sources: MiniSource[] = Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, i) => ({
      ref: { ref: `src-${i}` },
      canGrantAuthority: rng() < 0.5
    }));
    const grounding: GroundingEntry[] = Array.from({ length: Math.floor(rng() * 6) }, () => ({
      authorityIndex: Math.floor(rng() * 5), // duplicates + out-of-range on purpose
      sourceRefs: sources.filter(() => rng() < 0.5).map((source) => source.ref.ref)
    }));
    check(
      "S1-H-4 equivalence (first-wins map)",
      thrown(() => referenceAssertAuthority(authorityLength, grounding, sources)) ===
        thrown(() => candidateAssertAuthorityFirstWins(authorityLength, grounding, sources)),
      JSON.stringify({ authorityLength, grounding })
    );
  }
  // Directed: duplicate authorityIndex — find takes the FIRST entry.
  const sources: MiniSource[] = [
    { ref: { ref: "user-1" }, canGrantAuthority: true },
    { ref: { ref: "web-1" }, canGrantAuthority: false }
  ];
  const grounding: GroundingEntry[] = [
    { authorityIndex: 0, sourceRefs: ["user-1"] },
    { authorityIndex: 0, sourceRefs: ["web-1"] }
  ];
  const ref = thrown(() => referenceAssertAuthority(1, grounding, sources));
  const naive = thrown(() => naiveAssertAuthorityLastWins(1, grounding, sources));
  check("S1-H-4 last-wins map must diverge", ref === "NO_THROW" && naive !== "NO_THROW");
  console.log(
    `S1-H-4 duplicate-index case: current=${ref} last-wins-map=${naive.split(":")[0]} -> naive Map indexing NOT equivalent; first-wins is, but A is 0 in production (heuristic authority=[])`
  );
}

/* ================================================================
 * S1-H-5: applyPrecedence — fuse detectConflicts' two filters into
 * one pass + Set membership for conflict ids in the drop loop.
 * ================================================================ */
function isFastCheckLocal(checkText: string): boolean {
  const lower = checkText.toLowerCase();
  return lower.includes("fast") || lower.includes("< 10ms");
}
function isSlowCheckLocal(checkText: string): boolean {
  const lower = checkText.toLowerCase();
  return lower.includes("slow") || lower.includes("> 1000ms");
}

function candidateApplyPrecedence(contract: RequirementContract, rule: PrecedenceRule): RequirementContract {
  const fast: AcceptanceCriterion[] = [];
  const slow: AcceptanceCriterion[] = [];
  for (const criterion of contract.acceptanceCriteria) {
    if (isFastCheckLocal(criterion.observableCheck)) fast.push(criterion);
    if (isSlowCheckLocal(criterion.observableCheck)) slow.push(criterion);
  }
  const conflicts =
    fast.length === 0 || slow.length === 0
      ? []
      : [{ ids: [...fast, ...slow].map((criterion) => criterion.id), description: "contradictory-latency" }];
  if (conflicts.length === 0) return contract;

  const drop = new Set<string>();
  const assumptions = [...contract.assumptions];
  for (const conflict of conflicts) {
    const idSet = new Set(conflict.ids); // the candidate edit
    const ordered = contract.acceptanceCriteria.filter((criterion) => idSet.has(criterion.id));
    const winner = rule === "user-first" ? ordered[0] : ordered.at(-1);
    if (winner === undefined) continue;
    for (const criterion of ordered) {
      if (criterion.id === winner.id) continue;
      drop.add(criterion.id);
      assumptions.push({
        id: `a-superseded-${criterion.id}`,
        statement: `Dropped by ${rule}: ${criterion.description}`,
        source: "precedence"
      });
    }
  }
  return {
    ...contract,
    acceptanceCriteria: contract.acceptanceCriteria.filter((criterion) => !drop.has(criterion.id)),
    assumptions
  };
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
  const rng = mulberry32(0x114805);
  const rules: readonly PrecedenceRule[] = ["user-first", "spec-first", "latest-first"];
  for (let trial = 0; trial < 6000; trial += 1) {
    const contract = genPrecedenceContract(rng, 1);
    const rule = pick(rng, rules);
    check(
      "S1-H-5 equivalence (fused detect + id set)",
      JSON.stringify(applyPrecedence(contract, rule)) === JSON.stringify(candidateApplyPrecedence(contract, rule)),
      JSON.stringify(contract.acceptanceCriteria.map((criterion) => criterion.observableCheck))
    );
    check(
      "S1-H-5 detectConflicts cross-check",
      JSON.stringify(detectConflicts(contract)) ===
        JSON.stringify(
          (() => {
            const fast = contract.acceptanceCriteria.filter((criterion) => isFastCheckLocal(criterion.observableCheck));
            const slow = contract.acceptanceCriteria.filter((criterion) => isSlowCheckLocal(criterion.observableCheck));
            if (fast.length === 0 || slow.length === 0) return [];
            return [{ ids: [...fast, ...slow].map((criterion) => criterion.id), description: "contradictory-latency" }];
          })()
        )
    );
  }
  for (const [label, scale, reps] of [["real C~4", 1, 50000], ["stress C~400", 100, 500]] as const) {
    const contract = genPrecedenceContract(mulberry32(0x114806), scale);
    const cur = bench(() => applyPrecedence(contract, "user-first"), reps);
    const cand = bench(() => candidateApplyPrecedence(contract, "user-first"), reps);
    console.log(
      `S1-H-5 bench ${label} (${contract.acceptanceCriteria.length} criteria): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (called once per run)`
    );
  }
}

/* ================================================================
 * S1-H-6: reconcileReviews — three filter passes -> two passes
 * (count pass + dissent/dedup pass). Production call sites pass
 * exactly 2 results (runBlindPairwisePair).
 * ================================================================ */
function candidateReconcile(results: readonly PairwiseResult[]): ReturnType<typeof reconcileReviews> {
  if (results.length === 0) {
    return { consensus: "tie", dissent: [], dissentCount: 0, causalDefects: [] };
  }
  let aWins = 0;
  let bWins = 0;
  for (const result of results) {
    if (result.winner === "a") aWins += 1;
    else if (result.winner === "b") bWins += 1;
  }
  let consensus: "a" | "b" | "tie" | "uncertain";
  if (aWins === bWins) consensus = "uncertain";
  else consensus = aWins > bWins ? "a" : "b";
  const dissent: PairwiseResult[] = [];
  const seen = new Set<string>();
  const causalDefects: string[] = [];
  for (const result of results) {
    if (result.winner !== consensus && result.winner !== "tie") {
      dissent.push(result);
      if (!seen.has(result.rationale)) {
        seen.add(result.rationale);
        causalDefects.push(result.rationale);
      }
    }
  }
  return { consensus, dissent, dissentCount: dissent.length, causalDefects };
}

function genPairwiseResult(rng: () => number, i: number): PairwiseResult {
  return {
    id: `evt-${i}`,
    episodeId: "ep_00000001" as EpisodeId,
    aId: "cand-a",
    bId: "cand-b",
    winner: pick(rng, ["a", "b", "tie"] as const),
    rationale: pick(rng, ["a higher on first presentation", "b higher after swap", "scores equal; position bias avoided", "custom"]),
    createdAt: "2026-08-24T00:00:00.000Z" as PairwiseResult["createdAt"],
    orderSwapped: rng() < 0.5
  };
}

{
  const rng = mulberry32(0x114807);
  for (let trial = 0; trial < 8000; trial += 1) {
    const results = Array.from({ length: Math.floor(rng() * 7) }, (_, i) => genPairwiseResult(rng, i));
    check(
      "S1-H-6 equivalence (two-pass reconcile)",
      JSON.stringify(reconcileReviews(results)) === JSON.stringify(candidateReconcile(results)),
      JSON.stringify(results.map((result) => result.winner))
    );
  }
  for (const [label, n, reps] of [["production n=2", 2, 100000], ["stress n=100", 100, 5000]] as const) {
    const benchRng = mulberry32(0x114808 + n);
    const results = Array.from({ length: n }, (_, i) => genPairwiseResult(benchRng, i));
    const cur = bench(() => reconcileReviews(results), reps);
    const cand = bench(() => candidateReconcile(results), reps);
    console.log(
      `S1-H-6 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * S1-H-7: createEvaluationRecord — fuse the three aggregate
 * predicates (some FAIL / some PASS / every UNOBSERVED) into the
 * scores map loop. id/createdAt normalized for comparison.
 * ================================================================ */
function candidateCreateRecord(input: EvaluationInput): ReturnType<typeof createEvaluationRecord> {
  if (input.target !== undefined && input.target.artifactId.trim() === "") {
    throw new DomainValidationError("evaluation target artifactId must be non-empty");
  }
  if (
    input.independenceClass !== undefined &&
    !(["paired", "independent", "same-author"] as readonly string[]).includes(input.independenceClass)
  ) {
    throw new DomainValidationError(`unknown independence class: ${String(input.independenceClass)}`);
  }
  let hasAnyFail = false;
  let hasAnyPass = false;
  let allUnobserved = true;
  const scores = input.rubric.criteria.map((criterion) => {
    const hasEvidence = Boolean(input.evidence[criterion.id]);
    let outcome: "PASS" | "FAIL" | "UNOBSERVED";
    if (hasEvidence) outcome = "PASS";
    else if (input.evaluator.kind === "deterministic") outcome = "FAIL";
    else outcome = "UNOBSERVED";
    if (outcome === "FAIL") hasAnyFail = true;
    if (outcome === "PASS") hasAnyPass = true;
    if (outcome !== "UNOBSERVED") allUnobserved = false;
    return {
      criterionId: criterion.id,
      outcome,
      evidenceRef: hasEvidence ? input.evidence[criterion.id] : undefined,
      confidence: input.evaluator.kind === "inferential" ? 0.6 : undefined,
      reason: hasEvidence ? undefined : "no evidence provided"
    };
  });
  let overall: "PASS" | "FAIL" | "UNOBSERVED" | "ABSTAIN";
  if (hasAnyFail) overall = "FAIL";
  else if (allUnobserved) overall = "UNOBSERVED";
  else if (hasAnyPass) overall = "PASS";
  else overall = "ABSTAIN";
  return {
    id: "normalized",
    episodeId: input.episodeId,
    taskId: input.taskId,
    runId: input.runId,
    evaluator: input.evaluator,
    rubricId: input.rubric.id,
    rubricVersion: input.rubric.version,
    scores,
    findings: input.findings ?? [],
    overall,
    createdAt: "T" as ReturnType<typeof createEvaluationRecord>["createdAt"],
    target: input.target,
    independenceClass: input.independenceClass
  } as ReturnType<typeof createEvaluationRecord>;
}

function normRecord(record: ReturnType<typeof createEvaluationRecord>): string {
  return JSON.stringify({ ...record, id: "normalized", createdAt: "T" });
}

{
  const rng = mulberry32(0x114809);
  const kinds: readonly EvaluatorKind[] = ["deterministic", "human", "inferential"];
  for (let trial = 0; trial < 6000; trial += 1) {
    const criteria: RubricCriterion[] = Array.from({ length: Math.floor(rng() * 8) }, (_, i) => ({
      id: `cr-${i}`,
      description: "d",
      weight: 0.5,
      observableCheck: rng() < 0.7 ? "check" : ""
    }));
    const rubric: Rubric = {
      id: "rub-1",
      version: 1,
      scope: pick(rng, ["project", "task", "delivery", "global"] as const),
      criteria,
      createdAt: "2026-08-24T00:00:00.000Z" as Rubric["createdAt"]
    };
    const evidence: Record<string, string> = {};
    for (const criterion of criteria) {
      const roll = rng();
      if (roll < 0.45) evidence[criterion.id] = `evd-${criterion.id}`;
      else if (roll < 0.55) evidence[criterion.id] = ""; // falsy -> no evidence
    }
    const kind = pick(rng, kinds);
    const findings: Finding[] =
      rng() < 0.3 ? [{ id: "f1", criterionId: "cr-0", severity: "minor", message: "m" }] : [];
    const independenceClass: IndependenceClass | undefined =
      rng() < 0.5 ? pick(rng, ["paired", "independent", "same-author"] as const) : undefined;
    const input: EvaluationInput = {
      episodeId: "ep_00000001" as EpisodeId,
      evaluator: { kind, version: "1", rubricVersion: "1" },
      rubric,
      evidence,
      ...(findings.length > 0 ? { findings } : {}),
      ...(rng() < 0.4 ? { target: { artifactId: "art-1" } } : {}),
      ...(independenceClass !== undefined ? { independenceClass } : {})
    };
    check(
      "S1-H-7 equivalence (fused aggregates)",
      normRecord(createEvaluationRecord(input)) === normRecord(candidateCreateRecord(input)),
      `trial ${trial}`
    );
  }
  // validation-path equivalence
  const badTarget = {
    episodeId: "ep_00000001" as EpisodeId,
    evaluator: { kind: "human", version: "1", rubricVersion: "1" },
    rubric: createRubric("r", "task", []),
    evidence: {},
    target: { artifactId: "  " }
  } as EvaluationInput;
  check(
    "S1-H-7 validation equivalence (empty artifactId)",
    thrown(() => createEvaluationRecord(badTarget)) === thrown(() => candidateCreateRecord(badTarget))
  );
  const badClass = {
    episodeId: "ep_00000001" as EpisodeId,
    evaluator: { kind: "human", version: "1", rubricVersion: "1" },
    rubric: createRubric("r", "task", []),
    evidence: {},
    independenceClass: "bogus" as IndependenceClass
  } as EvaluationInput;
  check(
    "S1-H-7 validation equivalence (unknown class)",
    thrown(() => createEvaluationRecord(badClass)) === thrown(() => candidateCreateRecord(badClass))
  );
  const criteria: RubricCriterion[] = Array.from({ length: 5 }, (_, i) => ({
    id: `cr-${i}`, description: "d", weight: 0.5, observableCheck: "check"
  }));
  const rubric = createRubric("rub-bench", "task", criteria);
  const input: EvaluationInput = {
    episodeId: "ep_00000001" as EpisodeId,
    evaluator: { kind: "deterministic", version: "1", rubricVersion: "1" },
    rubric,
    evidence: { "cr-0": "e0", "cr-2": "e2" }
  };
  const cur = bench(() => void createEvaluationRecord(input), 50000);
  console.log(
    `S1-H-7 anchor: createEvaluationRecord (5 criteria)=${(cur * 1e6).toFixed(0)}ns/call, no production caller (test-only face); fusion delta is sub-noise by construction`
  );
}

/* ================================================================
 * S1-H-8: registerRubric — copy-on-write -> in-place mutation.
 * Must DIVERGE: the module holds `registry = { ...DEFAULT_REGISTRY }`
 * (shallow), so in-place writes pollute DEFAULT_REGISTRY and break
 * resetRubricRegistry. Reference side = the production module.
 * ================================================================ */
{
  interface MutableRegistry {
    rubrics: Record<string, Rubric>;
    activeVersion: Record<RubricScope, string>;
  }
  const CAND_DEFAULT: MutableRegistry = {
    rubrics: {},
    activeVersion: { project: "", task: "", delivery: "", global: "" }
  };
  let candRegistry: MutableRegistry = { ...CAND_DEFAULT };
  const candRegister = (rubric: Rubric): void => {
    candRegistry.rubrics[rubric.id] = rubric; // the (unsound) candidate edit
    candRegistry.activeVersion[rubric.scope] = rubric.id;
  };
  const candList = (): Rubric[] => Object.values(candRegistry.rubrics);
  const candReset = (): void => {
    candRegistry = { ...CAND_DEFAULT };
  };

  const rubric = createRubric("rub-x", "task", []);
  resetRubricRegistry();
  registerRubric(rubric);
  resetRubricRegistry();
  const referenceAfterReset = listRubrics().length;

  candRegister(rubric);
  candReset();
  const candidateAfterReset = candList().length;

  check("S1-H-8 mutation must diverge after reset", referenceAfterReset === 0 && candidateAfterReset === 1);
  console.log(
    `S1-H-8 counterexample: rubrics visible after reset — current=${referenceAfterReset} mutable-candidate=${candidateAfterReset} -> NOT equivalent (DEFAULT_REGISTRY pollution breaks resetRubricRegistry)`
  );
  resetRubricRegistry();
}

/* ================================================================
 * S1-H-9: changeSetsEqual — array-length early exit. Must DIVERGE:
 * the current semantics is SET equality (duplicates collapse).
 * Reference side = the public CheckAdapter.
 * ================================================================ */
{
  const adapter = createCheckAdapter();
  const context: AdapterContext = {
    episodeId: "ep_00000001" as EpisodeId,
    workingDirectory: "/w",
    revision: "rev-1",
    changeSet: ["a.ts"]
  };
  const result: CommandResult = {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 5,
    command: "pnpm test",
    cwd: "/w",
    changeSet: ["a.ts", "a.ts"] // duplicate collapses to {a.ts}
  };
  const evaluation = await adapter.evaluate(context, result);

  function candidateChangeSetsEqualLen(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false; // the (unsound) candidate edit
    const left = new Set(a);
    const right = new Set(b);
    if (left.size !== right.size) return false;
    for (const item of left) {
      if (!right.has(item)) return false;
    }
    return true;
  }
  const candSays = candidateChangeSetsEqualLen(result.changeSet as string[], context.changeSet);
  check("S1-H-9 length early-exit must diverge", evaluation.outcome === "PASS" && candSays === false);
  console.log(
    `S1-H-9 counterexample: changeSet ["a.ts","a.ts"] vs ["a.ts"] — CheckAdapter=${evaluation.outcome} (set semantics) length-exit-candidate=stale-FAIL -> NOT equivalent`
  );
}

/* ================================================================
 * Real-scale anchors for the remaining once-per-run faces.
 * ================================================================ */
{
  const rng = mulberry32(0x11480b);
  const input: PairwiseInput = {
    episodeId: "ep_00000001" as EpisodeId,
    aId: "cand-a",
    bId: "cand-b",
    aScore: 0.8,
    bScore: 0.7,
    aComment: "solid",
    bComment: "weaker"
  };
  const pairCost = bench(() => void runBlindPairwisePair(input, rng), 20000);
  console.log(
    `anchor: runBlindPairwisePair=${(pairCost * 1e6).toFixed(0)}ns/call (double-compare is the design contract; no production caller)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=NO
BRANCH=cursor/r1-h-eval-req-review-rubric-038d

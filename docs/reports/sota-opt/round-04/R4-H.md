MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第四遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `3e9ab6b`
**分支:** `cursor/r4-h-eval-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 21 个文件（1750 行）自 R1-H
基线（`fd437a9`）以来**逐字节未变**（`git diff fd437a9..3e9ab6b --
src/{evaluation,requirement,review,rubric}/` 为空），且 R3-H 基线（`ede7021`）
之后 `src/` **零提交**（期间全部为文档提交）⇒ 生产调用方地图**可证不变**，
本轮全库 import 交叉检索再次确认（8 个导入位点与 R3-H 完全一致）。按指令
对 R2-H §3.4 / R3-H §3.4 的收益上界做了**实测复核而非沿用**：三次独立
运行测得切片全部生产入口每 run 合计 **5.7–6.1µs**（extractHeuristicContract
4.8–5.2µs + run-start gate ~0.7µs + applyPrecedence ~0.22µs），比既往
~10µs 论证还紧——即使把切片生产工作全部归零，收益上界 ≈6µs/run，低于
战役落地线（数十~数百 ms）**四个数量级**。第四遍在完整排除表
（S1-H-1..9、S2-H-1..7、S3-H-1..4 及三轮 17 处不立 ID 收口）之上以新角度
枚举，得到 3 个此前未点名的新候选（S4-H-1 … S4-H-3），全部经理论 +
确定性仿真（seeded mulberry32，~18,000 项等价检查 + 真实/压力双端基准，
三次独立运行裁决逐位一致、计时方向稳定）裁决后淘汰：1 个有硬发散反例
（S4-H-1 的 `Object.hasOwn` 换写在非可枚举自有键上把门从 fail-closed
翻成 fail-open），1 个被公开签名 + 无处强制不变量 + 3% once-per-run
份额三重钉死（S4-H-2），1 个等价但 322–486ns/run（S4-H-3）。未重开任何
X* / S1-* / S2-* / S3-* / S4-* 条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第四遍实际读码。
  上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts` 只读取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（含 S4-A/B/D/E/F
  全部新条目）/ round-04/PLAN.md / round-01/R1-H.md / round-02/R2-H.md /
  round-03/R3-H.md。候选枚举刻意绕开全部既有排除，特别核对未触碰：
  S1-H-4 / S1-H-9 / S2-H-4（集合相等与 authorityIndex 发散族——本轮
  对 `changeSetsEqual` 零候选，R3-H「三面钉死」维持）、S1-H-8
  （registerRubric 就地写污染 DEFAULT_REGISTRY——S4-H-3 的就地变异
  作用于**局部新建**对象，与模块级共享状态是不同别名域，见 §3.3）、
  X4-9（classifyDiffScope changeSet Set 化）、S2-H-7（默认 origin 守卫）。
- R2-H/R3-H 的 ~10µs/run 收益上界按指令**先复核后引用**：本报告 §1
  以三次独立实测重建该锚点（5.7–6.1µs/run），未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 双 LCB 与双归因保留、阈值/权限/
  数据面契约/公开签名不变、测试未改，天然成立。不声称
  Outcome-supported，Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与上界重测

1. **切片逐字节未变**：`git diff fd437a9..3e9ab6b -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交。R1-H 逐函数下界表、R2-H 上界论证、
   R3-H 重复工作枚举与 S1-H-1..9 / S2-H-1..7 / S3-H-1..4 排除全部继承有效。
2. **调用图可证不变**：`git log ede7021..3e9ab6b -- src/` 为空（R3-H 之后
   仓库仅有 round-03/04 文档提交）⇒ R3-H 复核过的调用方地图数学上不可能
   改变。本轮仍做了全库 import 检索双确认：`assertCoverageAllowsStart` ←
   `run/{supervisor,coordinator,flowchart-run}.ts`（每 run 启动一次，仅当
   `input.contract !== undefined`）；`extractHeuristicContract` ←
   `track/clarify.ts`（每 run 一次）；`applyPrecedence` ← `track/loop.ts`
   （每 run 一次）；`shouldScout` ← `track/plan.ts`（每 run 一次）；
   `assertCanPromoteFromReview` ← `adaptation/promotion-rules.ts`（每晋升
   一次）；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（仅类型导入与测试引用）。
3. **上界锚点重测**（指令要求，三次运行区间）：

```text
CEILING re-verify: extractHeuristicContract=4786-5156ns + run-start gate=694-727ns
  + applyPrecedence=217-222ns = 5732-6067ns once-per-run production total
  -> slice gain ceiling 5.7-6.1µs/run（战役落地线：数十~数百 ms）
```

   复核结论：R2-H 的 ~10µs/run 论证不仅成立而且偏保守；真实上界 ≈6µs/run。
   门槛第 3 条（真实规模非噪声、落地线数十~数百 ms）在本切片当前调用图下
   **结构上不可满足**——除非调用图变更（evaluation/review/rubric 面接入
   每 turn 热路径，或合同规模增长 ≥2 个量级）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-H-1 | `checkCoverageGate` 的逐准则 `Object.keys(matrix.requirementToTasks).includes(id)` 换 `Object.hasOwn(matrix.requirementToTasks, id)`。与 S1-H-1（循环外 Set 提升）机制不同：零分配、O(1) 内建、且保留原型链守卫（hasOwn 不看继承键） | O(C×K)+C 次数组分配 → O(C)+0 次分配；渐近上是该函数唯一真下降 | 可枚举数据域 6000 fuzz（含 constructor/toString 等原型链准则 id）逐字节一致；原型链守卫双方都保留；❌ **发散反例**：非可枚举自有键——`Object.keys` 语义是「自有**且可枚举**」，current 判未覆盖（门**拦**），hasOwn 判已覆盖（门**开**）⇒ 病态输入下门从 fail-closed 翻 fail-open | 真实 C=2/K=2 delta 仅 **2–9ns**/call（三次运行同向但在抖动带内）；C=200 压力（超真实两个量级）才 591–637µs | 淘汰：真实规模亚噪声 + 严格语义不等价（候选隐含「矩阵自有键皆可枚举」不变量，数据面 JSON/字面量满足但公开边界无处强制——S1-A-9/S1-H-9 同族第三例；且发散方向是**放行**，比 stale-FAIL 更险） |
| S4-H-2 | 生产链 fast/slow 矛盾谓词跨模块双扫描去重：clarify 段 `critiqueContract` 的双 `checks.some(...)` 与 loop 段 `applyPrecedence→detectConflicts` 的双 filter 对**同一不可变合同**求同一谓词。候选：`applyPrecedence` 接受 critique 参数，contradictions 为空时跳过 detectConflicts | 免 1 次 Θ(C) 重扫（iff 关系 6000 fuzz 证实：critique 标记 ⟺ detectConflicts 非空） | ✅ iff 关系全 fuzz 成立；但**信息缺口**：`critique.contradictions` 只携带 `"contradictory-latency"` 标签，不携带 `conflict.ids` ⇒ 有冲突时仍须重扫，去重仅剩「空则跳过」快路径 | 重复份额 **223–224ns** = once-per-run 链的 **2.9–3.1%**；applyPrecedence 全函数本身仅 237ns | 淘汰三重钉死：(a) 需改 `applyPrecedence` 公开签名 + 切片外 `track/loop.ts` 调用方（S1-F-6/X0-4/S2-D-4 类）；(b) 引入「critique 必须出自同一合同」的无处强制不变量（X1-6/S3-F-2 同族）；(c) 亚 µs once-per-run 噪声 |
| S4-H-3 | `heuristicCritic.critique` 就地变异：直接 `critique.omissions.push(...)` 并返回 critique，免 `[...critique.omissions]` 拷贝 + 外层 `{...critique, omissions}` spread（两次分配）。与 R3-H 不立 ID 收口的「省略拷贝」观察**机制不同**：本条是 S1-D-1/S2-G-3 可变化家族在**局部独占对象**上的应用——`critiqueContract` 每次调用新建对象与数组，无别名可污染（与 S1-H-8 的模块级共享状态相反） | 免 1 次数组拷贝 + 1 次 6 字段对象 spread | ✅ 6000 fuzz（含 questions>0 ∧ acceptanceCriteria=0 的 omission 活分支双向）载荷逐字节一致 | 省 **322–486ns**/run（once per run；critic 全调用 0.9–1.1µs，含 critiqueContract 本体） | 淘汰：亚 µs once-per-run 噪声（占 §1 上界锚点的 ~7%，绝对量仍低于战役最小落地量级三个数量级）；且可变化写法牺牲「critic 输出与内部中间体解耦」的可读性契约，收益不抵审校成本 |

另有三处以既有排除/前轮收口直接覆盖、不立新 ID：`checkCoverageGate` 的
`[...matrix.orphanRequirements]` 拷贝省略（返回值别名矩阵内数组 ⇒ 可观察
对象身份改变 + 调用方后续变异串扰，S1-A-7/S2-J-5 身份类；~20ns）；
`namedTargets` 的 `?? []` 每次新建空数组换模块级冻结常量（X1-1 模块级
共享 / S1-A-7 身份类；返回数组被调用方 `.map` 消费，冻结单例虽安全但
ns 级）；`heuristicExtractor` 的 q-scope/q-write 恒假 `questions.some`
守卫跳过（R1-H 逐文件收口已裁「无候选」——该 some 上界 3 元素且是对
未来分支扩展的防御，S2-H-7 恒真守卫同向维持）。第四遍对 21 文件逐一
重扫**再未发现任何未被四轮排除表覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S4-H-1：`Object.hasOwn` 不是 `Object.keys().includes` 的语义等价物

S1-H-1 裁决时已证：该行第一合取项是**原型链守卫**（准则 id 为
`"constructor"` 时防 fail-open），且循环外 Set 提升在真实 C=2 上实测更慢。
本轮的新角度是 `Object.hasOwn`——零分配、O(1)、保原型链守卫，纸面上
完胜 Set 提升。但仿真揭示第三个语义维度：`Object.keys` 只列**可枚举**
自有键，`hasOwn` 不区分枚举性。定向探针
`Object.defineProperty(matrix, "ac-1", { enumerable: false, value: [task] })`
下 current 判未覆盖（门拦启动）、候选判已覆盖（门放行）——发散方向是
**削弱门**。`CoverageMatrix` 的数据面（JSON、字面量、
`coverageMatrixFromTasks` 的普通赋值）确实全可枚举，但 `checkCoverageGate`
是公开导出，边界上无处强制该不变量——与 S1-H-9（无重复不变量）、
S1-A-9（有序 seq 不变量）同族，且本例的发散把 fail-closed 翻成
fail-open，比 stale-FAIL 类更不可接受。绕开发散的写法是
`Object.keys` 语义的忠实复刻（`propertyIsEnumerable` 合取），但那又
回到逐调用两次内建查询，真实 C=2 收益 2–9ns 深入抖动带。至此该行
的微优化方向「Set 提升（更慢）+ 守卫删除（fail-open）+ hasOwn 换写
（枚举性发散）」三面钉死，与 R3-H 对 `changeSetsEqual` 的收口同构。

### 3.2 S4-H-2：跨模块重复是真实的，但去重的三道墙都比 223ns 高

这是四轮以来本切片发现的最后一类重复——**跨模块**的：同一 fast/slow
矛盾谓词在 clarify 段（critiqueContract 双 `some`）与 loop 段
（detectConflicts 双 filter）对同一不可变合同各求一次。6000 fuzz 证实
两处判定严格 iff。但去重不可行的三道墙：其一，critique 的
contradictions 只携带标签字符串，不携带 detectConflicts 输出的
`conflict.ids`（applyPrecedence 的 drop 逻辑必需）⇒ 有冲突时无论如何
要重扫，可省的只剩无冲突快路径；其二，快路径要求 applyPrecedence
新增 critique 参数（公开签名变更）并改 `track/loop.ts`（切片外），
且引入「传入的 critique 出自同一合同」的调用方约定——仓内成立
（`clarify.candidate.contract` 与其 critique 同源）但类型系统无处
表达，属 X1-6「等价键不安全」同族；其三，量级：重复份额 223–224ns，
occupying once-per-run 链的 3%。三墙叠加，X0-5（当年裁决的是**合并
私有助手**）之外的这条**结果级去重**新角度也正式关闭。

### 3.3 S4-H-3：可变化在局部独占对象上确实健全——但量级不赦免

S1-H-8 的反例钉死的是**模块级共享状态**（registry 浅拷贝别名
DEFAULT_REGISTRY）上的就地写；本条作用于 `critiqueContract` 每次调用
新建的局部对象与数组，无任何外部别名，6000 fuzz（含 omission 活分支）
载荷逐字节一致——可变化家族（S1-D-1/S2-G-3/X4-2 多次以「调用方持有
引用可观察」淘汰）在这里第一次真正健全。但收益 322–486ns/run、once
per run，比战役最小落地量级低三个数量级；且 heuristicCritic 是
`ContractCritic` 扩展点的参考实现，「不变异中间体、返回新对象」的
写法本身是给未来第三方 critic 实现的范式示例。等价性证据留档供重开。

### 3.4 第四遍收口：三类角度全部枚举穷尽

R1-H 证逐函数渐近下界，R2-H 证调用图收益上界，R3-H 枚举尽切片内
重复工作与分配削减，本轮补上最后三类：**语义等价的内建换写**
（S4-H-1，败于枚举性发散）、**跨模块结果级去重**（S4-H-2，败于签名
/不变量/量级三墙）、**局部独占对象可变化**（S4-H-3，健全但败于量级）。
四遍合起来：切片内单函数、函数间、跨模块三个层级的候选空间已穷尽，
上界锚点实测收紧到 ~6µs/run。重开该切片的唯一前提维持不变：调用图
变更（每 turn 热路径接入或合同规模 ≥2 个量级增长）。

## 4. 逐文件收口（第四遍新视角，其余与 R1-H/R2-H/R3-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/coverage.ts` | own-key 测试内建换写（S4-H-1）；orphans 拷贝省略（S1-A-7 身份类，不立 ID） | S4-H-1 淘汰 |
| `requirement/precedence.ts` | 跨模块矛盾谓词结果级去重下半段 | S4-H-2 淘汰 |
| `requirement/critic.ts` | 跨模块矛盾谓词结果级去重上半段（S2-H-3/S3-H-2 的融合/去数组角度维持排除） | S4-H-2 淘汰 |
| `requirement/heuristic.ts` | heuristicCritic 就地变异（S4-H-3）；namedTargets `?? []` 常量化与 q-scope/q-write 恒假守卫（不立 ID，见 §2 注） | S4-H-3 淘汰 |
| `requirement/extractor.ts` | S2-H-1/2、S3-H-1 维持；双 `.trim()` 各一次无去重空间 | 无新候选 |
| `requirement/normalizer.ts` / `provenance.ts` | S2-H-7 守卫维持；extractSignals 三正则（R1-H 不立 ID 收口）维持；isSourced 的 Array.isArray 运行时守卫为数据面防御 | 无新候选 |
| `evaluation/check-adapter.ts` | changeSetsEqual 三面钉死维持（本轮零候选）；attributionMetadata 全路径使用复核成立 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` / `precedence.ts` | S1-H-7/S2-H-5 维持；纯类型/常量/3 元表 | 无新候选 |
| `evaluation/delivery-adapter.ts` / `diff-adapter.ts` / `ownership.ts` | 分支序为归因契约；X4-9 维持；DEFAULT_RULES 顺序为分类语义 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `critic.ts` / `self-review.ts` | 双物质比较为协议本体；S1-H-6 维持；hasPass 融合（test-only）维持；O(1) 谓词 | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持（S4-H-3 的可变化不适用于此处的模块级别名域）；Θ(字段) 构造 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 via nvm，满足
engines >=22.19.0；系统 Node 22.14.0 过低的既知环境注记同 R1-J §3）：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H/R2-H/R3-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r4h-sim.mts`，无赢家故未入库以从 round01-r1c/r1f、
round02-r2c、round03-r3c 仅赢家入库的仓库惯例；完整源码见附录，seed
固定可复现）代表性一次运行：

```text
S4-H-1 non-enumerable own-key probe: current uncovered=1 (gate BLOCKS) hasOwn-candidate uncovered=0 (gate OPENS) -> current guard is "own AND enumerable"; hasOwn drops enumerability = fail-open on pathological input
S4-H-1 bench real C=2,K=2: current=77ns cand=74ns delta=3ns/call (gate runs once per run start)
S4-H-1 bench stress C=200,K=200: current=622488ns cand=2914ns delta=619573ns/call (gate runs once per run start)
S4-H-2 duplicate share: one detectConflicts(real C=2 contract)=223ns inside applyPrecedence=237ns vs one extractHeuristicContract=7315ns -> re-scan is 3.0% of the once-per-run chain; dedup needs a public-signature change + an unenforced same-contract invariant
S4-H-3 bench real contract: current critic=1132ns in-place cand=708ns delta=424ns/run vs whole chain=6038ns (once per run)
CEILING re-verify: extractHeuristicContract=5156ns + run-start gate=694ns (matrix=371ns) + applyPrecedence=217ns = 6067ns once-per-run production total -> slice gain ceiling ~6.1µs/run (campaign landing bar: tens-to-hundreds of ms)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~18,000 项等价检查全部通过、裁决结论逐位一致；计时抖动
内方向稳定（S4-H-1 真实规模三次 +3/+9/+2ns 深入抖动带、发散探针三次
全部复现；S4-H-2 重复份额三次 223/223/224ns；S4-H-3 三次
424/486/322ns；上界锚点三次 6067/5732/5754ns）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-H-1 | checkCoverageGate own-key 测试换 Object.hasOwn | 非可枚举自有键反例把门翻 fail-open（枚举性不变量无处强制）；真实 C=2 仅 2–9ns；与 S1-H-1/守卫删除合并三面钉死该行 |
| S4-H-2 | critiqueContract 与 applyPrecedence→detectConflicts 跨模块矛盾谓词结果级去重 | 公开签名 + 切片外调用方变更；「同一合同」不变量无处强制（X1-6 族）；重复份额 223ns = once-per-run 链 3% |
| S4-H-3 | heuristicCritic omissions 就地变异免双拷贝 | 等价且健全（局部独占对象，非 S1-H-8 别名域）但 322–486ns/run once-per-run 噪声；扩展点参考实现的范式价值 > 收益 |

重开条件：S4-H-1 需先版本化「CoverageMatrix 自有键皆可枚举」语义（或
换用忠实复刻枚举性的写法）并推翻真实规模抖动带基准；S4-H-2 需先出现
每 turn 生产调用方且把「critique 出自同一合同」升级为类型层不变量
（届时 conflict.ids 信息缺口仍须解决）；S4-H-3 凭本报告等价性证据在
出现每 turn 生产调用方时可直接重开。总门槛更新：任何候选须先推翻
本报告 §1 的 **~6µs/run** 实测收益上界（即调用图出现新热路径或合同
规模 ≥2 个量级增长）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装；
`.mts` 保证 ESM 顶层 await 可用）。seeds：`0x444801`–`0x444803`。

```ts
/**
 * R4-H deterministic equivalence + benchmark simulation (fourth pass).
 * Adjudicates fresh candidates S4-H-1 .. S4-H-3 against the current
 * implementations in src/{evaluation,requirement,review,rubric} and
 * re-verifies the R2-H §3.4 / R3-H §3.4 ~10µs/run slice gain ceiling.
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-H
 * (S1-H-1..9), R2-H (S2-H-1..7) or R3-H (S3-H-1..4). Seeded PRNG
 * (mulberry32) -> fully reproducible. Seeds: 0x444801 .. 0x444805.
 *
 * Reference = production imports wherever the function is exported;
 * private helpers are replicated verbatim and each candidate differs
 * from the replica ONLY by the candidate edit.
 */
import { performance } from "node:perf_hooks";
import {
  checkCoverageGate,
  coverageMatrixFromTasks,
  assertCoverageAllowsStart,
  type CoverageGateResult,
  type CoverageTaskRef
} from "/workspace/src/requirement/coverage.js";
import {
  applyPrecedence,
  detectConflicts,
  type PrecedenceRule
} from "/workspace/src/requirement/precedence.js";
import {
  extractHeuristicContract,
  heuristicCritic,
  HEURISTIC_CRITIC_ROLE
} from "/workspace/src/requirement/heuristic.js";
import { critiqueContract, type ContractCritique } from "/workspace/src/requirement/critic.js";
import type { ContractCritic } from "/workspace/src/requirement/extractor.js";
import type {
  RequirementContract,
  CoverageMatrix,
  AcceptanceCriterion,
  DecisionQuestion,
  SourceRef
} from "/workspace/src/domain/contract.js";
import type { TaskId } from "/workspace/src/domain/ids.js";

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

/* ================================================================
 * S4-H-1: checkCoverageGate — replace the per-criterion
 * `Object.keys(matrix.requirementToTasks).includes(id)` own-key test
 * with `Object.hasOwn(matrix.requirementToTasks, id)`. Distinct from
 * S1-H-1 (hoisted pre-loop Set): zero allocation, O(1) per criterion,
 * and it keeps the prototype-chain guard (hasOwn ignores inherited
 * keys). Equivalence subtlety: Object.keys lists own ENUMERABLE keys;
 * Object.hasOwn accepts own NON-enumerable keys too -> a non-enumerable
 * own property flips the gate from "uncovered" (blocks start) to
 * "covered" (start allowed) = fail-open on pathological input.
 * ================================================================ */
function candidateCheckCoverageGateHasOwn(
  contract: RequirementContract,
  matrix: CoverageMatrix
): CoverageGateResult {
  const orphans = [...matrix.orphanRequirements];
  const uncoveredCriteria: string[] = [];
  const blockingDecisions: string[] = [];
  for (const criterion of contract.acceptanceCriteria) {
    const covered =
      Object.hasOwn(matrix.requirementToTasks, criterion.id) && // the candidate edit
      (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0;
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
  const rng = mulberry32(0x444801);
  for (let trial = 0; trial < 6000; trial += 1) {
    const { contract, matrix } = genCoverageCase(rng, 1);
    check(
      "S4-H-1 equivalence on enumerable-data domain (Object.hasOwn)",
      JSON.stringify(checkCoverageGate(contract, matrix)) ===
        JSON.stringify(candidateCheckCoverageGateHasOwn(contract, matrix)),
      JSON.stringify({ ac: contract.acceptanceCriteria.map((c) => c.id), m: Object.keys(matrix.requirementToTasks) })
    );
  }
  // Prototype-chain criterion ids: both must keep the guard (mark uncovered).
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
  const protoCur = checkCoverageGate(protoContract, emptyMatrix);
  const protoCand = candidateCheckCoverageGateHasOwn(protoContract, emptyMatrix);
  check(
    "S4-H-1 prototype-chain guard preserved by hasOwn",
    protoCur.uncoveredCriteria.length === 1 && protoCand.uncoveredCriteria.length === 1
  );
  // DIVERGENCE probe: a NON-ENUMERABLE own property. Object.keys skips it
  // (current: uncovered -> gate blocks); Object.hasOwn sees it (candidate:
  // covered -> gate opens). The swap silently weakens the gate: fail-open.
  const sneaky: Record<string, TaskId[]> = {};
  Object.defineProperty(sneaky, "ac-1", {
    value: ["tsk_00000001" as TaskId],
    enumerable: false,
    configurable: true,
    writable: true
  });
  const sneakyContract = {
    schemaVersion: 1,
    objective: "obj",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "ac-1", description: "d", observableCheck: "c" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
  const sneakyMatrix: CoverageMatrix = {
    contractVersion: 1,
    requirementToTasks: sneaky,
    taskToChecks: {},
    orphanRequirements: []
  };
  const curSneaky = checkCoverageGate(sneakyContract, sneakyMatrix);
  const candSneaky = candidateCheckCoverageGateHasOwn(sneakyContract, sneakyMatrix);
  check(
    "S4-H-1 non-enumerable own key must diverge (fail-open direction)",
    curSneaky.uncoveredCriteria.length === 1 && candSneaky.uncoveredCriteria.length === 0
  );
  console.log(
    `S4-H-1 non-enumerable own-key probe: current uncovered=${curSneaky.uncoveredCriteria.length} (gate BLOCKS) hasOwn-candidate uncovered=${candSneaky.uncoveredCriteria.length} (gate OPENS) -> current guard is "own AND enumerable"; hasOwn drops enumerability = fail-open on pathological input`
  );
  // Real scale (heuristic contract C=2, matrix from 5 tasks) + stress.
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
    const cand = bench(() => candidateCheckCoverageGateHasOwn(contract, matrix), reps);
    console.log(
      `S4-H-1 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (gate runs once per run start)`
    );
  }
}

/* ================================================================
 * S4-H-2: cross-module duplicate fast/slow contradiction scan on the
 * production chain. clarify -> extractHeuristicContract runs
 * critiqueContract (checks.some(fast) && checks.some(slow)); loop ->
 * applyPrecedence(contract) re-runs the SAME predicate via
 * detectConflicts on the SAME immutable contract. A dedup would need
 * applyPrecedence to accept the critique (public-signature change +
 * out-of-slice caller edit in track/loop.ts) AND critique.contradictions
 * carries only the label, not the criterion ids detectConflicts needs.
 * Adjudication = measure the duplicate share + verify the iff-relation
 * that a skip-fast-path would rely on (an invariant nobody enforces).
 * ================================================================ */
{
  // Verify: critiqueContract flags "contradictory-latency" IFF
  // detectConflicts finds a conflict (same predicate, two modules).
  const rng = mulberry32(0x444802);
  const checkPool = [
    "runs fast",
    "must be slow to warm up",
    "latency < 10ms",
    "latency > 1000ms",
    "manual-or-test",
    "",
    "run the suite"
  ];
  for (let trial = 0; trial < 6000; trial += 1) {
    const count = Math.floor(rng() * 8);
    const sourced = () =>
      rng() < 0.7 ? { sourceRefs: [{ kind: "message", ref: "src-0" } as SourceRef] } : {};
    const contract = {
      schemaVersion: 1,
      objective: "o",
      deliverables: [],
      constraints: [],
      nonGoals: [],
      acceptanceCriteria: Array.from({ length: count }, (_, i) => ({
        id: `ac-${i}`,
        description: "d",
        observableCheck: pick(rng, checkPool),
        ...sourced()
      })),
      assumptions: [],
      questions: [],
      authority: [],
      sourceRefs: [{ kind: "message", ref: "src-0" }]
    } as unknown as RequirementContract;
    const critique = critiqueContract(contract);
    const conflicts = detectConflicts(contract);
    check(
      "S4-H-2 iff-relation: critique contradiction <=> detectConflicts conflict",
      critique.contradictions.includes("contradictory-latency") === (conflicts.length > 0),
      JSON.stringify(contract.acceptanceCriteria.map((c) => c.observableCheck))
    );
    // The information gap: the critique label carries no criterion ids;
    // applyPrecedence's drop logic needs conflict.ids, so a dedup cannot
    // reuse the critique payload — it can only SKIP when contradictions
    // is empty, importing the "critique is of this same contract" invariant.
    if (conflicts.length > 0) {
      check(
        "S4-H-2 information gap: critique carries no ids",
        typeof critique.contradictions[0] === "string" && conflicts[0]!.ids.length > 0
      );
    }
  }
  // Duplicate share at production scale: detectConflicts on the real
  // heuristic-shaped contract vs the full once-per-run chain.
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const real = prod.contract;
  const dupCost = bench(() => void detectConflicts(real), 100000);
  const applyCost = bench(() => void applyPrecedence(real, "user-first"), 100000);
  const chain = await benchAsync(async () => {
    await extractHeuristicContract({
      objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
    });
  }, 3000);
  console.log(
    `S4-H-2 duplicate share: one detectConflicts(real C=${real.acceptanceCriteria.length} contract)=${(dupCost * 1e6).toFixed(0)}ns inside applyPrecedence=${(applyCost * 1e6).toFixed(0)}ns vs one extractHeuristicContract=${(chain * 1e6).toFixed(0)}ns -> re-scan is ${((dupCost / chain) * 100).toFixed(1)}% of the once-per-run chain; dedup needs a public-signature change + an unenforced same-contract invariant`
  );
}

/* ================================================================
 * S4-H-3: heuristicCritic — mutate the fresh critique in place
 * (push into critique.omissions, return critique) instead of copying
 * the omissions array AND spreading the whole critique. Sound in-repo
 * because critiqueContract allocates a fresh object + fresh arrays per
 * call; adjudicate payload equality + measure the two allocations.
 * ================================================================ */
function candidateHeuristicCritic(): ContractCritic {
  return {
    roleId: HEURISTIC_CRITIC_ROLE,
    async critique(input) {
      const critique = critiqueContract(input.contract);
      // the candidate edit: in-place push, no [...omissions] copy, no {...critique} spread
      if (input.contract.questions.length > 0 && input.contract.acceptanceCriteria.length === 0) {
        critique.omissions.push("acceptance-missing-while-questions-open");
      }
      return critique;
    }
  };
}

{
  const rng = mulberry32(0x444803);
  const reference = heuristicCritic();
  const candidate = candidateHeuristicCritic();
  const checkPool = ["manual-or-test", "", "run the suite", "runs fast", "latency > 1000ms"];
  for (let trial = 0; trial < 6000; trial += 1) {
    const criterionCount = Math.floor(rng() * 4); // includes 0 -> omission branch live
    const questionCount = Math.floor(rng() * 3); // includes >0 with criteria 0
    const sourced = () =>
      rng() < 0.7 ? { sourceRefs: [{ kind: "message", ref: "src-0" } as SourceRef] } : {};
    const contract = {
      schemaVersion: 1,
      objective: "o",
      deliverables: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
        id: `d-${i}`,
        description: "d",
        artifactKind: "diff",
        ...sourced()
      })),
      constraints: [],
      nonGoals: [],
      acceptanceCriteria: Array.from({ length: criterionCount }, (_, i) => ({
        id: `ac-${i}`,
        description: "d",
        observableCheck: pick(rng, checkPool),
        ...sourced()
      })),
      assumptions: rng() < 0.4 ? [{ id: "a-1", statement: "s", source: "src" }] : [],
      questions: Array.from({ length: questionCount }, (_, i) => ({
        id: `q-${i}`,
        question: "q",
        options: ["yes", "no"]
      })),
      authority: [],
      sourceRefs: rng() < 0.85 ? [{ kind: "message", ref: "src-0" }] : []
    } as unknown as RequirementContract;
    const sources: never[] = [];
    const ref = JSON.stringify(await reference.critique({ contract, sources }));
    const cand = JSON.stringify(await candidate.critique({ contract, sources }));
    check("S4-H-3 equivalence (in-place omissions)", ref === cand, `trial ${trial}`);
  }
  // Cost isolation at production scale (heuristic-shaped contract, the
  // omission branch NOT taken: questions=0 on the tests-objective path).
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const real = prod.contract;
  const refCritic = heuristicCritic();
  const candCritic = candidateHeuristicCritic();
  const curCost = await benchAsync(async () => {
    await refCritic.critique({ contract: real, sources: [] });
  }, 30000);
  const candCost = await benchAsync(async () => {
    await candCritic.critique({ contract: real, sources: [] });
  }, 30000);
  const chain = await benchAsync(async () => {
    await extractHeuristicContract({
      objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
    });
  }, 3000);
  console.log(
    `S4-H-3 bench real contract: current critic=${(curCost * 1e6).toFixed(0)}ns in-place cand=${(candCost * 1e6).toFixed(0)}ns delta=${((curCost - candCost) * 1e6).toFixed(0)}ns/run vs whole chain=${(chain * 1e6).toFixed(0)}ns (once per run)`
  );
}

/* ================================================================
 * Ceiling re-verification (R2-H §3.4 / R3-H §3.4): total production
 * work of this slice per run = coverage gate + extraction chain +
 * applyPrecedence (+ O(1) promotion predicate). Anchor each entry.
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
  const matrixOnly = bench(() => void coverageMatrixFromTasks(real, tasks), 100000);
  const total = chain + gate + precedence;
  console.log(
    `CEILING re-verify: extractHeuristicContract=${(chain * 1e6).toFixed(0)}ns + run-start gate=${(gate * 1e6).toFixed(0)}ns (matrix=${(matrixOnly * 1e6).toFixed(0)}ns) + applyPrecedence=${(precedence * 1e6).toFixed(0)}ns = ${(total * 1e6).toFixed(0)}ns once-per-run production total -> slice gain ceiling ~${(total * 1e3).toFixed(1)}µs/run (campaign landing bar: tens-to-hundreds of ms)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r4-h-eval-fourth-pass-83a1

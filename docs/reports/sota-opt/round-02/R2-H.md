MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 复查报告（Round 1 同区第二遍）

**战役:** 全库持久 SOTA 优化 Round 2 / R2-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `7bf1c15`
**分支:** `cursor/r2-h-eval-req-review-rubric-05c5`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 21 个文件（1750 行）自 R1-H
基线（`fd437a9`）以来**逐字节未变**（`git diff fd437a9..7bf1c15 -- <切片>` 为空），
且生产调用方地图逐一复核后**完全不变**（基线以来 `src/` 仅改
`routing/offline-logit.ts` 与 `cli/main.ts`，均不触本切片；`track/primary-split.ts`
对 `HeuristicHabits` 仅类型导入且基线时已存在）。R1-H 的逐文件收口与
S1-H-1..9 排除全部继承有效。本轮在完整排除表之上以新角度再枚举，得到
7 个此前未点名的新候选（S2-H-1 … S2-H-7），全部经理论 + 确定性仿真
（seeded mulberry32，等价 fuzz + 真实规模基准，三次独立运行方向一致）
裁决后淘汰：1 个有硬发散反例（S2-H-4，与 S1-H-9 构成同一语义陷阱的
镜像侧），1 个在压力规模**实测反而慢 1.9–2.6×**（S2-H-3，融合丢失早退），
其余 5 个等价但收益全部钉死在 once-per-run 的 ns–亚 µs 区间。未重开任何
X* / S1-* / S2-* 条目。另以**调用图上界论证**收口：本切片生产热度峰值是
每 run 一次的 ~7µs 合同抽取——即使把切片生产工作全部归零，收益上界
~8µs/run，仍低于战役否决线（S1-C-7 亚 ms、S1-C-1 8.5–46 ms）两个量级。
除非出现新的每 turn 热路径调用方，该切片**结构上不存在**可达门槛的候选。
现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量重读。上下游
  `domain/contract.ts`、`track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、`adaptation/promotion-rules.ts`
  只读取证，一行未改。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-H.md。
  候选枚举刻意绕开全部既有排除（S1-H-1..9、X4-9、X0-5/6、X1-1/4、
  S1-A-3/7/8、S1-B-1/2/5、S1-E-7/8、S1-F-6、S2-D-5 等），只探索**未被
  点名的新角度**：生产路径死分配跳过（S2-H-1/2）、新位点多遍融合
  （S2-H-3）、分配削减的等价性边界（S2-H-4）、折叠内重复求值携带
  （S2-H-5）、被覆盖字段的冗余 spread（S2-H-6）、可证恒真守卫（S2-H-7）。
- 行为面全部不变：评价身份（evaluator kind/version/rubricVersion、
  deterministic 无证据即 FAIL）、precedence（EVIDENCE_PRECEDENCE 权重表
  与 requirement 冲突消解次序）、redaction/ownership 契约（X4-9 +
  DEFAULT_RULES 分类次序）、盲评双呈现 + 位置偏置检测协议、自评拒绝
  fail-closed、authority grounding 信任校验——本轮零 diff，天然满足。

## 1. 基线不变性与门槛校准

R1-H 的两项证据基底直接继承并复核：

1. **代码不变**：`git log fd437a9..HEAD -- src/{evaluation,requirement,review,rubric}/`
   为空。
2. **调用方地图不变**：`assertCoverageAllowsStart`（每 run 启动一次，C=2）、
   `extractHeuristicContract` 链（每 run 一次，单句 objective）、
   `applyPrecedence` / `shouldScout`（每 run 一次）、
   `assertCanPromoteFromReview`（每次晋升一次）；`src/evaluation/` 全部
   8 文件、`review/{pairwise,reconcile,critic}.ts`、`src/rubric/` 仍**无任何
   生产调用方**（本轮全库再检索确认，仅测试引用）。

本轮锚点（三次运行区间）：

```text
anchor: one extractHeuristicContract = 5481-7368ns (once per run; slice production peak)
```

门槛第 (c) 条沿用 R2-A §1 的落地/否决量级对照：战役实际落地线在
**百 ms 级或复杂度类下降**（J1 2770×、S1-F 4.8×、S1-C ~450ms/fit），
µs 级与亚 ms 级候选一律淘汰过（S1-C-7、S1-C-1、S1-A-1、S2-A-1）。本切片
生产峰值 once-per-run ~7µs ⇒ **任何**候选的绝对收益上界（把生产工作全部
归零）≈8µs/run，低于否决线两个量级。本轮候选据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-H-1 | `buildContractCandidate` 的 `sourceRefs` Set 无条件构建，但仅在 `inferences.map` 闭包内读取；生产提取器（heuristic）恒返回 `inferences: []` ⇒ 死 Set+数组分配。候选：仅当 `inferences.length > 0` 时构建 | 免 1 次 Set + 1 次 map 数组/抽取 | ✅ 4000 fuzz（含非空 inferences、corroborated/needs-confirmation 双路径、置信度越界与同 roleId 抛错路径，throw parity + 全载荷逐字节） | 生产规模（1 源）该 Set 成本 **44ns**，占 once-per-run 调用 0.6% | 淘汰：噪声（S2-A-1 同类死工作消除，量级低其两个数量级） |
| S2-H-2 | `assertAuthorityGrounding` 在循环前无条件构建 `sourcesByRef` Map，但生产 `contract.authority` 恒为 `[]` ⇒ 死 Map+数组。候选：`authority.length === 0` 早退 | 免 1 次 Map + 1 次 map 数组 | ✅（与 S2-H-1 同一 4000 fuzz 联合裁决，含 authority 1–2 项 + grounding 命中/未命中路径） | Map 成本 **43–45ns**；两死分配合计 ~88ns = once-per-run 调用的 1.2%；全路径 delta 92–1209ns 抖动（JIT 身份噪声，取隔离下界为准） | 淘汰：噪声；S1-H-4 的重开条件（非空 authority 生产流量）同样制约本条 |
| S2-H-3 | `critiqueContract` 四遍（checks 小写 map + untestable 循环 + 矛盾检测双 `some`）融合单遍 | 4 遍 → 1 遍，免 checks 中间数组 | ✅ 6000 fuzz（含 manual-or-test/空 check/fast+slow 组合、>20 deliverables、无源合同）+ heuristic 形状定向逐字节一致 | 真实 C=2 省 276–319ns/call（once per run）；**压力 109 准则实测慢 1.9–2.6×**（3.9→7.7µs / 11.0→21.2µs）：现行双 `some` 命中即早退，融合后每准则恒做 4 次 `includes` | 淘汰：真实规模噪声 + 压力规模负优化（融合丢早退，S1-E-6 同教训新例证） |
| S2-H-4 | `changeSetsEqual` 单 Set delete 化（省第二个 Set 分配）：`for b: if (!left.delete(item)) return false; return left.size === 0` | 2 Set → 1 Set | ❌ **发散反例**：语义是集合相等（重复折叠），`delete` 首次命中即消耗条目 ⇒ `b` 侧重复被误报缺失。经公开 `CheckAdapter.evaluate`：context=`["a.ts","a.ts"]` vs result=`["a.ts"]` 现返 **PASS**，候选判 **stale-FAIL**。无重复输入 8000 fuzz 全等 ⇒ 候选隐含无处强制的「context 无重复」不变量 | — | 淘汰：不等价（S1-H-9 的镜像侧反例——彼为长度早退在 `a` 侧栽，此为 delete 消耗在 `b` 侧栽）；且正确的单 Set 版本仍需第二成员结构，分配数不降 |
| S2-H-5 | `selectHighestPrecedence` 折叠中携带在位者权重（现行 `comparePrecedence` 每步对 best 重查 3 元表） | 2n 次表查 → n 次 | ✅ 8000 fuzz（0–7 长度、全 tie 组合；严格 `>` 保 reduce 的 first-wins tie 语义） | n=3 省 **9–13ns**/call，且**无生产调用方**（test-only 面） | 淘汰：亚噪声 + 零生产流量（S1-E-7 同类）；X1-4/S1-A-8 的 3 元表量级裁决同向 |
| S2-H-6 | `registerRubric` 外层 `...registry` spread 冗余（`rubrics`/`activeVersion` 两字段随即全被覆盖，`RubricRegistry` 恰为此二字段） | 免 2 次属性拷贝 | ✅ 12000 步随机操作序列（register/getActive/list/reset 交错，含 id 重用）逐步观察一致 | R=5 省 **7–20ns**/register，test-only 面 | 淘汰：亚噪声（S1-B-5/S2-A-5 冗余 spread 类新位点）；copy-on-write 本体保留（S1-H-8 反例仍有效） |
| S2-H-7 | `normalizeSources` 中 origin 由 `defaultOrigin(kind)` 推导时跳过 `assertOriginMatchesKind`（可证恒真：message→user-turn、spec→approved-spec、file/git→repository-fact 均不触发任一分支） | 免 2 次字符串比较/默认源 | ✅ kind 全域（4 值）穷举证明默认路径恒不抛；显式 origin 路径守卫仍活（`("file","user-turn")` 抛错验证） | 4 kind 全部守卫合计 **28–31ns** | 淘汰：守卫保留——防御纵深（S2-D-5 同类），且与 R1-A FAIL_CLOSED、R1-H §4.1 原型链守卫的「可证冗余守卫不删」裁决同向 |

另有六处以既有排除/设计契约直接覆盖、不立新 ID：`buildContractCandidate`
的 `normalizeSources([...input.sources])` 防御拷贝（S1-B-5 冗余 spread 类
第二实例；消除需改 `normalizeSources` 公开签名 = S1-F-6 类）；heuristic
问题/约束对象字面量提升为模块常量（X1-1 模块级隐藏状态 / S1-A-7 可观察
身份改变类）；`createCriticObservation` 的 hasPass 聚合融合（S1-H-7 同类
fusion，test-only 面）；`coverageMatrixFromTasks` owners 已存在时的冗余
重赋值（T≤6×C=2 常数亚噪声）；三个 adapter 的 async→sync 化（
`ProjectAdapter.evaluate` 公开接口破坏，X0-4 类）；`DiffAdapter` 的
`hasEpisodeOwned` 在 FAIL 分支前的预计算（单次 `.length` 读取，零级）。

## 3. 关键裁决细节

### 3.1 S2-H-4：分配削减撞上集合语义（S1-H-9 的镜像反例）

`changeSetsEqual` 被 `CheckAdapter.evaluate` 以
`(result.changeSet, context.changeSet)` 调用。`Set(a)` 构建天然折叠 `a` 侧
重复，所以 S1-H-9 的反例（`a` 侧重复）对 delete 化候选**不发散**——发散点
在 `b` 侧：`context.changeSet = ["a.ts","a.ts"]` 时首次 `delete("a.ts")`
消耗条目，第二次返回 `false`，候选判集合不等；而现行双 Set 实现返回
PASS。`AdapterContext.changeSet` 是 caller-provided，仓内无任何去重
不变量。两轮合起来，`changeSetsEqual` 的双 Set 写法现在有**两侧各一个**
已记录反例钉住：任何「省一次分配/一次扫描」的变体都必须先版本化
「changeSet 无重复」语义。此外正确的单 Set 变体（先查原始成员再决定）
仍需第二个成员结构，分配数不降——该函数在集合相等契约下已是分配下界。

### 3.2 S2-H-3：融合丢失早退（理论被仿真推翻，本切片首例）

现行 `critiqueContract` 的矛盾检测是两个 `checks.some(...)`——命中即停。
融合单遍后每准则**恒做** 4 次 `includes`。真实 C=2 时融合省 ~300ns（免
中间数组 + 单遍），但 109 准则压力下融合稳定慢 1.9–2.6×（三次运行
delta −3.3/−10.2/−3.7µs 方向一致）。与 S1-A-4（Set 构建开销）、S2-A-4
（concat 反转）同为「纸面常数直觉被 V8 真实路径推翻」系列；特别地，
它警示后续轮次：**对含 `some`/`every` 早退的多遍结构，融合在大规模侧
可能是负优化**，两端都要测。

### 3.3 S2-H-1/2：生产路径唯二死分配，量级钉死

本轮在 R1-H 的逐函数下界表之外找到的唯一「纯死工作」位点：生产链
（heuristic → `buildContractCandidate`）中 `sourceRefs` Set 与
`sourcesByRef` Map 均在恒空集合上构建后弃置。等价性以 4000 组含
throw-parity 的全载荷 fuzz 裁决通过（含非空 inferences / 非空 authority
的活路径）。但隔离测得两分配合计 ~88ns，占 once-per-run 调用的 1.2%；
全路径 delta（92–1209ns）在三次运行间抖动一个数量级，恰说明该量级已
落入 JIT 函数身份噪声之内。战役从未落地过 µs 级以下候选，本条不例外。

### 3.4 上界论证（本切片的终局收口）

R1-H 以逐函数下界证明「渐近层面无余地」；本轮补上调用图侧的上界：
切片全部生产入口（coverage gate ~0.7µs + 合同抽取链 ~7µs + precedence
~0.4µs + promotion 谓词 O(1)）每 run 合计 <10µs，其余面零生产流量。
故**本切片任何未来候选的收益上界 ≈ 10µs/run**——比战役否决线低两个
量级。这意味着 R3+ 对本切片的再搜索只在两种条件下有意义：(a) 出现新的
每 turn / 每事件热路径调用方（如 evaluation 面接入 tracking 循环），或
(b) 合同规模增长 ≥2 个量级。二者都属调用图变更，而非切片内代码变更。

## 4. 逐文件收口（新角度复查，其余面与 R1-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/extractor.ts` | 生产路径死分配（本轮唯一新结构） | S2-H-1/2 淘汰 |
| `requirement/critic.ts` | 四遍融合新位点 | S2-H-3 淘汰 |
| `evaluation/check-adapter.ts` | changeSetsEqual 分配下界 + 镜像反例 | S2-H-4 淘汰 |
| `evaluation/precedence.ts` | 折叠权重携带 | S2-H-5 淘汰 |
| `rubric/registry.ts` | 外层冗余 spread（copy-on-write 本体保留） | S2-H-6 淘汰 |
| `requirement/normalizer.ts` | 默认 origin 恒真守卫 | S2-H-7 淘汰 |
| `requirement/heuristic.ts` | 对象字面量常量化 = X1-1/S1-A-7 类；正则提升 = S1-B-1 类 | 无新候选 |
| `requirement/coverage.ts` | S1-H-1/2 收口维持；owners 冗余重赋值为常数亚噪声（不立 ID） | 无新候选 |
| `requirement/precedence.ts` / `provenance.ts` | S1-H-5 维持；单遍即输出 | 无新候选 |
| `review/critic.ts` | hasPass 融合 = S1-H-7 类（test-only） | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `self-review.ts` | 双物质比较为协议本体；S1-H-6 维持；O(1) 谓词 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` | S1-H-7 维持；纯类型/常量 | 无新候选 |
| `evaluation/delivery-adapter.ts` / `diff-adapter.ts` | 分支序为归因契约；async 化 = X0-4 类 | 无新候选 |
| `evaluation/ownership.ts` | X4-9 维持，未触碰 | 无新候选 |
| `rubric/types.ts` | Θ(字段) 构造 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2，满足 engines
>=22.19.0；系统 Node 22.14.0 过低的既知环境注记同 R1-J §3）：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H 同套件同计数）
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现）代表性一次运行：

```text
S2-H-1/2 dead-allocation cost at production scale (1 source): sourceRefs Set=44ns + sourcesByRef Map=44ns vs one extractHeuristicContract=7061ns (once per run) -> combined 1.2% of a once-per-run call
S2-H-1/2 bench full production path: current=4753ns cand=4661ns delta=92ns/run (once per run)
S2-H-3 bench real heuristic contract (C=2): current=887ns cand=590ns delta=297ns/call (called once per run via heuristicCritic)
S2-H-3 bench stress (109 criteria): current=10963ns cand=21210ns delta=-10247ns/call -> fusion loses its early-exit at scale
S2-H-4 counterexample: result ["a.ts"] vs context ["a.ts","a.ts"] — CheckAdapter=PASS (set semantics) single-set-delete-candidate=false -> stale-FAIL, NOT equivalent; a correct one-set variant needs a second membership structure anyway
S2-H-5 bench n=3: current=34ns cand=21ns delta=13ns/call (no production caller)
S2-H-6 bench register at R=5: current=184ns cand=177ns delta=7ns/call (test-only face)
S2-H-7 exhaustive proof over kind domain passed; guard cost for all 4 kinds=31ns -> keep the guard (defence-in-depth, S2-D-5 class; skipping saves ~2 string compares per defaulted source)
anchor: one extractHeuristicContract = 5828ns (once per run; slice production peak)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~38000 项等价检查全部通过、结论逐位一致；计时抖动内方向
稳定（S2-H-3 压力侧三次全部更慢：−3.3/−10.2/−3.7µs；S2-H-4 反例三次
全部复现；S2-H-1/2 隔离分配成本三次稳定 43–45ns）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-H-1 | buildContractCandidate 无 inferences 时跳过 sourceRefs Set 构建 | 等价但死分配仅 44ns（once-per-run 的 0.6%），噪声 |
| S2-H-2 | assertAuthorityGrounding authority 为空时早退免 sourcesByRef Map | 等价但 ~44ns 噪声；重开条件同 S1-H-4（需非空 authority 生产流量） |
| S2-H-3 | critiqueContract 四遍融合单遍 | 真实 C=2 省 ~300ns 噪声；压力规模实测慢 1.9–2.6×（融合丢失 some 早退） |
| S2-H-4 | changeSetsEqual 单 Set delete 化 | 不等价：context 侧重复反例经公开 CheckAdapter 发散（PASS→stale-FAIL）；正确单 Set 版仍需第二成员结构 |
| S2-H-5 | selectHighestPrecedence 折叠权重携带 | 等价但 9–13ns + 无生产调用方 |
| S2-H-6 | registerRubric 外层冗余 spread 移除 | 等价但 7–20ns，test-only 面（copy-on-write 本体保留，S1-H-8 反例有效） |
| S2-H-7 | normalizeSources 默认 origin 恒真守卫跳过 | 守卫保留：防御纵深（S2-D-5 类）+ 收益 ~30ns/4 kinds |

重开条件：S2-H-1/3/5/6 凭本报告等价性证据在合同/rubric 规模增长 ≥2 个
量级或出现每 turn 生产调用方时重开（S2-H-3 需两端规模重测）；S2-H-2 需
先出现非空 authority 生产流量；S2-H-4 需先版本化「changeSet 无重复」
语义并推翻本报告反例；S2-H-7 需先移除对显式 origin 的守卫职责。更强的
总门槛：本切片任何候选须先推翻 §3.4 的 ~10µs/run 收益上界（即调用图
出现新热路径）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装；
`.mts` 保证 ESM 顶层 await 可用）。seeds：`0x224801`–`0x224808`。

```ts
/**
 * R2-H deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S2-H-1 .. S2-H-7 against the current
 * implementations in src/{evaluation,requirement,review,rubric}.
 * All candidates are NEW angles not named by EXCLUSIONS.md or R1-H
 * (S1-H-1..9). Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0x224801 .. 0x224808.
 *
 * Reference = production imports wherever the function is exported;
 * private helpers are replicated verbatim and the candidate differs
 * from the replica ONLY by the candidate edit.
 */
import { performance } from "node:perf_hooks";
import {
  buildContractCandidate,
  type AuthorityGrounding,
  type ContractCandidate,
  type ContractCritic,
  type LabeledInference,
  type LatentRequirement,
  type RequirementExtractor
} from "/workspace/src/requirement/extractor.js";
import {
  normalizeSources,
  createTrustedSource,
  type NormalizedSource,
  type RawSource
} from "/workspace/src/requirement/normalizer.js";
import {
  extractHeuristicContract,
  heuristicExtractor,
  heuristicCritic
} from "/workspace/src/requirement/heuristic.js";
import { critiqueContract, type ContractCritique } from "/workspace/src/requirement/critic.js";
import { findUnsourcedItems } from "/workspace/src/requirement/provenance.js";
import { createCheckAdapter } from "/workspace/src/evaluation/check-adapter.js";
import type { AdapterContext, CommandResult } from "/workspace/src/evaluation/adapters.js";
import {
  selectHighestPrecedence,
  getPrecedenceWeight
} from "/workspace/src/evaluation/precedence.js";
import {
  registerRubric,
  getActiveRubric,
  listRubrics,
  resetRubricRegistry
} from "/workspace/src/rubric/registry.js";
import {
  createRubric,
  type Rubric,
  type RubricRegistry,
  type RubricScope
} from "/workspace/src/rubric/types.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import {
  validateRequirementContract,
  type RequirementContract,
  type SourceRef
} from "/workspace/src/domain/contract.js";
import type { EpisodeId } from "/workspace/src/domain/ids.js";
import type { EvaluatorKind } from "/workspace/src/evaluation/types.js";

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
async function thrownAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_THROW";
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
}

/* ================================================================
 * S2-H-1 + S2-H-2: buildContractCandidate production-path dead
 * allocations.
 *  - S2-H-1: `sourceRefs` Set is built unconditionally but only read
 *    inside the inferences.map closure; the production extractor
 *    (heuristic) always returns inferences: [] -> dead Set+array.
 *  - S2-H-2: assertAuthorityGrounding builds `sourcesByRef` Map before
 *    its loop even when contract.authority.length === 0 (production is
 *    always 0) -> dead Map+array.
 * Candidate = full replica of buildContractCandidate differing ONLY by
 * (a) building the Set lazily when inferences.length > 0 and
 * (b) early-returning from the grounding assert when authority is [].
 * ================================================================ */
function validateConfidenceReplica(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be between 0 and 1`);
  }
}
function candidateAssertAuthorityGrounding(
  contract: RequirementContract,
  grounding: readonly AuthorityGrounding[],
  sources: readonly NormalizedSource[]
): void {
  if (contract.authority.length === 0) return; // S2-H-2 edit
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
async function candidateBuildContractCandidate(input: {
  readonly objective: string;
  readonly sources: readonly RawSource[];
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
  const sources = normalizeSources([...input.sources]);
  const extracted = await input.extractor.extract({ objective: input.objective, sources });
  validateConfidenceReplica(extracted.confidence, "extraction confidence");
  const minimumConfidence = input.minimumConfidence ?? 0.8;
  validateConfidenceReplica(minimumConfidence, "minimum confidence");
  const contract = validateRequirementContract(extracted.contract);
  candidateAssertAuthorityGrounding(contract, extracted.authorityGrounding, sources);
  const critique = await input.critic.critique({ contract, sources });
  // S2-H-1 edit: build the ref set only when there are inferences to label
  const sourceRefs =
    extracted.inferences.length > 0 ? new Set(sources.map((source) => source.ref.ref)) : undefined;
  const inferences = extracted.inferences.map((inference): LabeledInference => {
    validateConfidenceReplica(inference.confidence, "inference confidence");
    const corroborated =
      inference.corroboratedSourceRefs.length > 0 &&
      inference.corroboratedSourceRefs.every((ref) => (sourceRefs as Set<string>).has(ref));
    return {
      ...inference,
      status: corroborated ? "corroborated" : "needs-confirmation"
    };
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

function fuzzContract(rng: () => number, authorityCount: number): unknown {
  return {
    schemaVersion: 1,
    objective: "fuzz objective long enough to not matter",
    deliverables: [
      { id: "d-1", description: "d", artifactKind: "diff", sourceRefs: [{ kind: "message", ref: "src-0" }] }
    ],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [
      {
        id: "ac-1",
        description: "d",
        observableCheck: rng() < 0.3 ? "manual-or-test" : "run tests",
        sourceRefs: [{ kind: "message", ref: "src-0" }]
      }
    ],
    assumptions: [],
    questions: [],
    authority: Array.from({ length: authorityCount }, (_, i) => ({
      resource: `res-${i}`,
      actions: ["write"]
    })),
    sourceRefs: [{ kind: "message", ref: "src-0" }]
  };
}

{
  const rng = mulberry32(0x224801);
  for (let trial = 0; trial < 4000; trial += 1) {
    const sourceCount = 1 + Math.floor(rng() * 3);
    const rawSources: RawSource[] = Array.from({ length: sourceCount }, (_, i) =>
      rng() < 0.7
        ? createTrustedSource({ kind: "message", ref: `src-${i}`, origin: "user-turn", content: `content ${i}` })
        : { kind: "file", ref: `src-${i}`, content: `content ${i}` }
    );
    const authorityCount = rng() < 0.35 ? 1 + Math.floor(rng() * 2) : 0;
    const inferences: LatentRequirement[] =
      rng() < 0.45
        ? Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, i) => ({
            statement: `latent ${i}`,
            corroboratedSourceRefs:
              rng() < 0.5 ? rawSources.filter(() => rng() < 0.6).map((s) => s.ref) : ["missing-ref"],
            confidence: rng() < 0.06 ? 1.5 : Number(rng().toFixed(3))
          }))
        : [];
    const grounding: AuthorityGrounding[] = Array.from({ length: Math.floor(rng() * 3) }, () => ({
      authorityIndex: Math.floor(rng() * Math.max(1, authorityCount + 1)),
      sourceRefs: rawSources.filter(() => rng() < 0.6).map((s) => s.ref)
    }));
    const confidence = rng() < 0.05 ? -0.2 : Number(rng().toFixed(3));
    // Pre-generate the contract ONCE so the extractor is deterministic
    // across the reference and candidate invocations.
    const frozenContract = fuzzContract(rng, authorityCount);
    const extractor: RequirementExtractor = {
      roleId: rng() < 0.02 ? "same-role" : "fuzz-extractor",
      async extract() {
        return {
          contract: frozenContract as RequirementContract,
          confidence,
          inferences,
          authorityGrounding: grounding
        };
      }
    };
    const critic: ContractCritic = {
      roleId: rng() < 0.02 ? "same-role" : "fuzz-critic",
      async critique(input) {
        return critiqueContract(input.contract);
      }
    };
    const args = {
      objective: "fuzz objective long enough to not matter",
      sources: rawSources,
      extractor,
      critic,
      ...(rng() < 0.5 ? { minimumConfidence: Number(rng().toFixed(2)) } : {})
    };
    // Each side runs exactly once; capture payload-or-throw.
    const refOutcome = await thrownAsync(async () => JSON.stringify(await buildContractCandidate(args)));
    const refJson = refOutcome === "NO_THROW" ? JSON.stringify(await buildContractCandidate(args)) : "";
    const candOutcome = await thrownAsync(async () =>
      JSON.stringify(await candidateBuildContractCandidate(args))
    );
    const candJson =
      candOutcome === "NO_THROW" ? JSON.stringify(await candidateBuildContractCandidate(args)) : "";
    check(
      "S2-H-1/2 equivalence (throw parity + payload)",
      refOutcome === candOutcome && refJson === candJson,
      `trial ${trial}: ref=${refOutcome} cand=${candOutcome}`
    );
  }
  // Production-scale cost isolation: 1 source, authority=0, inferences=[]
  const oneSource = normalizeSources([
    createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: "obj" })
  ]);
  const setCost = bench(() => void new Set(oneSource.map((source) => source.ref.ref)), 100000);
  const mapCost = bench(() => void new Map(oneSource.map((source) => [source.ref.ref, source])), 100000);
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const fullCurrent = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  console.log(
    `S2-H-1/2 dead-allocation cost at production scale (1 source): sourceRefs Set=${(setCost * 1e6).toFixed(0)}ns + sourcesByRef Map=${(mapCost * 1e6).toFixed(0)}ns vs one extractHeuristicContract=${(fullCurrent * 1e6).toFixed(0)}ns (once per run) -> combined ${(((setCost + mapCost) / fullCurrent) * 100).toFixed(1)}% of a once-per-run call`
  );
  // End-to-end production-path delta: heuristic extractor/critic through
  // the current builder vs the candidate builder (both dead allocations skipped).
  const prodSources = [
    createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })
  ];
  const prodArgs = {
    objective,
    sources: prodSources,
    extractor: heuristicExtractor({}),
    critic: heuristicCritic(),
    minimumConfidence: 0.8
  };
  const refJson = JSON.stringify(await buildContractCandidate(prodArgs));
  const candJson = JSON.stringify(await candidateBuildContractCandidate(prodArgs));
  check("S2-H-1/2 production-path payload identical", refJson === candJson);
  const curFull = await benchAsync(async () => {
    await buildContractCandidate(prodArgs);
  }, 3000);
  const candFull = await benchAsync(async () => {
    await candidateBuildContractCandidate(prodArgs);
  }, 3000);
  console.log(
    `S2-H-1/2 bench full production path: current=${(curFull * 1e6).toFixed(0)}ns cand=${(candFull * 1e6).toFixed(0)}ns delta=${((curFull - candFull) * 1e6).toFixed(0)}ns/run (once per run)`
  );
}

/* ================================================================
 * S2-H-3: critiqueContract — fuse the checks map + untestable loop
 * + two contradiction `some` scans into one pass over the criteria.
 * ================================================================ */
function candidateCritique(contract: RequirementContract): ContractCritique {
  const contradictions: string[] = [];
  const untestable: string[] = [];
  const scopeCreep: string[] = [];
  const missingSources: string[] = [];
  const omissions: string[] = [];

  let hasFast = false;
  let hasSlow = false;
  for (const c of contract.acceptanceCriteria) {
    if (!c.observableCheck || c.observableCheck === "manual-or-test") {
      untestable.push(c.id);
    }
    const lower = c.observableCheck.toLowerCase();
    if (lower.includes("fast") || lower.includes("< 10ms")) hasFast = true;
    if (lower.includes("slow") || lower.includes("> 1000ms")) hasSlow = true;
  }
  if (hasFast && hasSlow) contradictions.push("contradictory-latency");

  if (contract.deliverables.length > 20) scopeCreep.push("too-many-deliverables");
  if (contract.sourceRefs.length === 0) missingSources.push("no-sources");

  const unsourced = findUnsourcedItems(contract);
  for (const id of unsourced.deliverables) missingSources.push(`deliverable:${id}`);
  for (const id of unsourced.constraints) missingSources.push(`constraint:${id}`);
  for (const id of unsourced.acceptanceCriteria) missingSources.push(`criterion:${id}`);

  const score =
    100 -
    (contradictions.length * 15 +
      untestable.length * 10 +
      scopeCreep.length * 15 +
      missingSources.length * 20);
  return { contradictions, untestable, scopeCreep, missingSources, omissions, score: Math.max(0, score) };
}

function genCritiqueContract(rng: () => number, scale: number): RequirementContract {
  const checkPool = [
    "runs fast",
    "must be slow to warm up",
    "latency < 10ms",
    "latency > 1000ms",
    "manual-or-test",
    "",
    "run the suite"
  ];
  const count = Math.floor(rng() * 6 * scale);
  const sourced = () =>
    rng() < 0.7 ? { sourceRefs: [{ kind: "message", ref: "src-0" } as SourceRef] } : {};
  return {
    schemaVersion: 1,
    objective: "o",
    deliverables: Array.from({ length: Math.floor(rng() * (rng() < 0.06 ? 25 : 4)) }, (_, i) => ({
      id: `d-${i}`,
      description: "d",
      artifactKind: "diff",
      ...sourced()
    })),
    constraints: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
      id: `c-${i}`,
      description: "c",
      enforceable: true,
      ...sourced()
    })),
    nonGoals: [],
    acceptanceCriteria: Array.from({ length: count }, (_, i) => ({
      id: `ac-${i}`,
      description: "d",
      observableCheck: pick(rng, checkPool),
      ...sourced()
    })),
    assumptions: rng() < 0.4 ? [{ id: "a-1", statement: "s", source: "src" }] : [],
    questions: [],
    authority: [],
    sourceRefs: rng() < 0.85 ? [{ kind: "message", ref: "src-0" }] : []
  } as unknown as RequirementContract;
}

{
  const rng = mulberry32(0x224803);
  for (let trial = 0; trial < 6000; trial += 1) {
    const contract = genCritiqueContract(rng, 1);
    check(
      "S2-H-3 equivalence (fused critique)",
      JSON.stringify(critiqueContract(contract)) === JSON.stringify(candidateCritique(contract)),
      JSON.stringify(contract.acceptanceCriteria.map((c) => c.observableCheck))
    );
  }
  // Real scale: the exact contract shape the heuristic extractor produces
  // (C=2 criteria with long observableCheck strings, sourced items).
  const heuristicShaped = {
    schemaVersion: 1,
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green",
    deliverables: [
      {
        id: "d-change",
        description: "Deliver the objective",
        artifactKind: "diff",
        sourceRefs: [{ kind: "message", ref: "cli-objective" }]
      }
    ],
    constraints: [
      { id: "c-smallest", description: "smallest change", enforceable: false, assumptionIds: ["a-defaults"] },
      {
        id: "c-tests",
        description: "Tests must stay green",
        enforceable: true,
        sourceRefs: [{ kind: "message", ref: "cli-objective" }]
      }
    ],
    nonGoals: [],
    acceptanceCriteria: [
      {
        id: "ac-objective",
        description: "The stated objective is addressed",
        observableCheck: "run.status is COMPLETED and child TASK_RESULT summaries cover the objective",
        sourceRefs: [{ kind: "message", ref: "cli-objective" }]
      },
      {
        id: "ac-tests",
        description: "Tests ran",
        observableCheck: "tester child TASK_RESULT verification is PASSED",
        sourceRefs: [{ kind: "message", ref: "cli-objective" }]
      }
    ],
    assumptions: [{ id: "a-defaults", statement: "s", source: "heuristic-default" }],
    questions: [],
    authority: [],
    sourceRefs: [{ kind: "message", ref: "cli-objective" }]
  } as unknown as RequirementContract;
  check(
    "S2-H-3 heuristic-shaped equivalence",
    JSON.stringify(critiqueContract(heuristicShaped)) === JSON.stringify(candidateCritique(heuristicShaped))
  );
  const curReal = bench(() => critiqueContract(heuristicShaped), 50000);
  const candReal = bench(() => candidateCritique(heuristicShaped), 50000);
  console.log(
    `S2-H-3 bench real heuristic contract (C=2): current=${(curReal * 1e6).toFixed(0)}ns cand=${(candReal * 1e6).toFixed(0)}ns delta=${((curReal - candReal) * 1e6).toFixed(0)}ns/call (called once per run via heuristicCritic)`
  );
  const stress = genCritiqueContract(mulberry32(0x224804), 100);
  const curStress = bench(() => critiqueContract(stress), 500);
  const candStress = bench(() => candidateCritique(stress), 500);
  console.log(
    `S2-H-3 bench stress (${stress.acceptanceCriteria.length} criteria): current=${(curStress * 1e6).toFixed(0)}ns cand=${(candStress * 1e6).toFixed(0)}ns delta=${((curStress - candStress) * 1e6).toFixed(0)}ns/call -> fusion loses its early-exit at scale`
  );
}

/* ================================================================
 * S2-H-4: changeSetsEqual — single-Set delete-based variant to save
 * one Set allocation. Must DIVERGE: set-equality semantics collapse
 * duplicates; delete() consumes the entry so a duplicate in `b` is
 * reported missing. Reference side = the public CheckAdapter (same
 * probe family as R1-H S1-H-9) + a verbatim replica for fuzzing.
 * ================================================================ */
function referenceChangeSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}
function candidateSingleSetEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a); // the only allocation
  for (const item of b) {
    if (!left.delete(item)) return false; // consumed entries misreport duplicates
  }
  return left.size === 0;
}

{
  const rng = mulberry32(0x224805);
  let dupFreeAgree = true;
  for (let trial = 0; trial < 8000; trial += 1) {
    const pool = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const withDuplicates = rng() < 0.4;
    const gen = () => {
      const base = pool.filter(() => rng() < 0.6);
      if (withDuplicates && base.length > 0 && rng() < 0.7) base.push(pick(rng, base));
      return base;
    };
    const a = gen();
    const b = gen();
    const ref = referenceChangeSetsEqual(a, b);
    const cand = candidateSingleSetEqual(a, b);
    const aHasDup = new Set(a).size !== a.length;
    const bHasDup = new Set(b).size !== b.length;
    if (!aHasDup && !bHasDup) {
      if (ref !== cand) dupFreeAgree = false;
    }
  }
  check("S2-H-4 duplicate-free inputs agree (invariant nobody enforces)", dupFreeAgree);
  // Directed divergence through the PUBLIC adapter. changeSetsEqual is
  // called as (result.changeSet, context.changeSet) = (a, b); Set(a)
  // collapses duplicates in `a`, so the divergence needs the duplicate on
  // the CONTEXT side: delete() consumes the entry on the first hit and
  // reports the second occurrence in `b` as missing.
  const adapter = createCheckAdapter();
  const context: AdapterContext = {
    episodeId: "ep_00000001" as EpisodeId,
    workingDirectory: "/w",
    revision: "rev-1",
    changeSet: ["a.ts", "a.ts"] // caller-provided; no dedup invariant anywhere
  };
  const result: CommandResult = {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 5,
    command: "pnpm test",
    cwd: "/w",
    changeSet: ["a.ts"]
  };
  const evaluation = await adapter.evaluate(context, result);
  const candSays = candidateSingleSetEqual(result.changeSet as string[], context.changeSet);
  check("S2-H-4 single-set delete variant must diverge", evaluation.outcome === "PASS" && candSays === false);
  console.log(
    `S2-H-4 counterexample: result ["a.ts"] vs context ["a.ts","a.ts"] — CheckAdapter=${evaluation.outcome} (set semantics) single-set-delete-candidate=${candSays} -> stale-FAIL, NOT equivalent; a correct one-set variant needs a second membership structure anyway`
  );
}

/* ================================================================
 * S2-H-5: selectHighestPrecedence — carry the incumbent's weight
 * through the fold instead of recomputing it via comparePrecedence
 * (which calls getPrecedenceWeight twice per element).
 * ================================================================ */
function candidateSelectHighest(kinds: readonly EvaluatorKind[]): EvaluatorKind | undefined {
  if (kinds.length === 0) return undefined;
  let best = kinds[0] as EvaluatorKind;
  let bestWeight = getPrecedenceWeight(best);
  for (let i = 1; i < kinds.length; i += 1) {
    const current = kinds[i] as EvaluatorKind;
    const weight = getPrecedenceWeight(current);
    if (weight > bestWeight) {
      // strict > preserves the reduce's first-wins tie behaviour
      best = current;
      bestWeight = weight;
    }
  }
  return best;
}

{
  const rng = mulberry32(0x224806);
  const kindsPool: readonly EvaluatorKind[] = ["deterministic", "human", "inferential"];
  for (let trial = 0; trial < 8000; trial += 1) {
    const kinds = Array.from({ length: Math.floor(rng() * 8) }, () => pick(rng, kindsPool));
    check(
      "S2-H-5 equivalence (carried weight, first-wins ties)",
      selectHighestPrecedence(kinds) === candidateSelectHighest(kinds),
      JSON.stringify(kinds)
    );
  }
  const kinds: readonly EvaluatorKind[] = ["inferential", "human", "deterministic"];
  const cur = bench(() => void selectHighestPrecedence(kinds), 100000);
  const cand = bench(() => void candidateSelectHighest(kinds), 100000);
  console.log(
    `S2-H-5 bench n=3: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (no production caller)`
  );
}

/* ================================================================
 * S2-H-6: registerRubric — drop the redundant outer `...registry`
 * spread (both fields are overwritten immediately). Reference side =
 * the production module; candidate = replica registry without the
 * outer spread. Fuzz random op sequences and compare every
 * observable output.
 * ================================================================ */
{
  const DEFAULTS: RubricRegistry = {
    rubrics: {},
    activeVersion: { project: "", task: "", delivery: "", global: "" }
  };
  let candRegistry: RubricRegistry = { ...DEFAULTS };
  const candRegister = (rubric: Rubric): void => {
    candRegistry = {
      // S2-H-6 edit: no outer ...candRegistry
      rubrics: { ...candRegistry.rubrics, [rubric.id]: rubric },
      activeVersion: { ...candRegistry.activeVersion, [rubric.scope]: rubric.id }
    };
  };
  const candGetActive = (scope: RubricScope): Rubric | undefined => {
    const id = candRegistry.activeVersion[scope];
    return id ? candRegistry.rubrics[id] : undefined;
  };
  const candList = (): Rubric[] => Object.values(candRegistry.rubrics);
  const candReset = (): void => {
    candRegistry = { ...DEFAULTS };
  };

  const rng = mulberry32(0x224807);
  const scopes: readonly RubricScope[] = ["project", "task", "delivery", "global"];
  resetRubricRegistry();
  candReset();
  for (let step = 0; step < 12000; step += 1) {
    const op = rng();
    if (op < 0.5) {
      const rubric = createRubric(`rub-${Math.floor(rng() * 12)}`, pick(rng, scopes), []);
      registerRubric(rubric);
      candRegister(rubric);
    } else if (op < 0.7) {
      const scope = pick(rng, scopes);
      check(
        "S2-H-6 getActiveRubric parity",
        JSON.stringify(getActiveRubric(scope)) === JSON.stringify(candGetActive(scope)),
        `step ${step} scope ${scope}`
      );
    } else if (op < 0.9) {
      check(
        "S2-H-6 listRubrics parity",
        JSON.stringify(listRubrics()) === JSON.stringify(candList()),
        `step ${step}`
      );
    } else {
      resetRubricRegistry();
      candReset();
      check("S2-H-6 reset parity", listRubrics().length === 0 && candList().length === 0, `step ${step}`);
    }
  }
  resetRubricRegistry();
  // bench one register at R=5
  for (let i = 0; i < 5; i += 1) registerRubric(createRubric(`seed-${i}`, "task", []));
  const extra = createRubric("bench", "task", []);
  const cur = bench(() => registerRubric(extra), 50000);
  candReset();
  for (let i = 0; i < 5; i += 1) candRegister(createRubric(`seed-${i}`, "task", []));
  const cand = bench(() => candRegister(extra), 50000);
  console.log(
    `S2-H-6 bench register at R=5: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (test-only face)`
  );
  resetRubricRegistry();
}

/* ================================================================
 * S2-H-7: normalizeSources — assertOriginMatchesKind is provably a
 * no-op whenever origin was derived by defaultOrigin(kind). Exhaustive
 * proof over the whole SourceRef["kind"] domain, then adjudicate as a
 * defence-in-depth guard (S2-D-5 class) rather than a win.
 * ================================================================ */
{
  const KINDS: readonly SourceRef["kind"][] = ["message", "file", "git", "spec"];
  function defaultOriginReplica(kind: SourceRef["kind"]): string {
    if (kind === "message") return "user-turn";
    if (kind === "spec") return "approved-spec";
    return "repository-fact";
  }
  function assertReplica(kind: SourceRef["kind"], origin: string): void {
    if (origin === "user-turn" && kind !== "message") {
      throw new Error(`source origin user-turn is not valid for ${kind}`);
    }
    if (
      (origin === "approved-spec" || origin === "approved-plan" || origin === "approved-adr") &&
      kind !== "spec"
    ) {
      throw new Error(`source origin ${origin} is not valid for ${kind}`);
    }
  }
  let allPass = true;
  for (const kind of KINDS) {
    try {
      assertReplica(kind, defaultOriginReplica(kind));
    } catch {
      allPass = false;
    }
  }
  check("S2-H-7 exhaustive: defaulted origin never trips the guard", allPass);
  // and the guard is NOT dead for explicit origins (must stay)
  let explicitTrips = false;
  try {
    assertReplica("file", "user-turn");
  } catch {
    explicitTrips = true;
  }
  check("S2-H-7 guard still live for explicit origins", explicitTrips);
  const cost = bench(() => {
    for (const kind of KINDS) assertReplica(kind, defaultOriginReplica(kind));
  }, 100000);
  console.log(
    `S2-H-7 exhaustive proof over kind domain passed; guard cost for all 4 kinds=${(cost * 1e6).toFixed(0)}ns -> keep the guard (defence-in-depth, S2-D-5 class; skipping saves ~2 string compares per defaulted source)`
  );
}

/* ================================================================
 * Context anchor: the production entry of this slice.
 * ================================================================ */
{
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const full = await benchAsync(async () => {
    await extractHeuristicContract({ objective });
  }, 3000);
  console.log(
    `anchor: one extractHeuristicContract = ${(full * 1e6).toFixed(0)}ns (once per run; slice production peak)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第五遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `d350722`
**分支:** `cursor/r5-h-eval-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 21 个文件
（1750 行）自 R1-H 基线（`fd437a9`）以来**逐字节未变**（`git diff
fd437a9..d350722 -- src/{evaluation,requirement,review,rubric}/` 为空，
同范围零提交），且 R4-H 基线（`3e9ab6b`）之后 `src/` 仅改
`cli/main.ts` + `pi-adapter/auth-session.ts`（S4-I）与 `routing/lin-alg.ts`
（S4-C/S5-C），均不 import 本切片 ⇒ 生产调用方地图**可证不变**，本轮
全库 import 交叉检索再次确认（8 个导入位点与 R3-H/R4-H 完全一致）。
按指令对 R4-H §1 的 ~6µs/run 收益上界做了**实测复核而非沿用**：本 VM
三次独立运行测得切片全部生产入口每 run 合计 **9.2–9.5µs**
（extractHeuristicContract 8.1–8.4µs + run-start gate ~0.8µs +
applyPrecedence ~0.25µs）——绝对值高于 R4-H 的 5.7–6.1µs 属跨 VM 常态
（历史带 4.5–10µs：R1-H 7.3µs、R2-H 5.5–7.4µs、R3-H 4.5–6.6µs），结论
不变：即使把切片生产工作全部归零，收益上界 ≈10µs/run，低于战役落地线
（数十~数百 ms）**四个数量级**。第五遍在完整排除表（S1-H-1..9、
S2-H-1..7、S3-H-1..4、S4-H-1..3 及四轮 20+ 处不立 ID 收口）之上以三个
**未探索过的层级**枚举——生产快路径的分配前守卫、模块图冷加载成本、
切片内唯一 Θ(字节) 位点的内存流量——得到 3 个此前未点名的新候选
（S5-H-1 … S5-H-3），全部经理论 + 确定性仿真（seeded mulberry32，
~28,000 项等价/逐位检查 + 真实/压力双端基准，三次独立运行裁决逐位
一致、计时方向稳定）裁决后淘汰：S5-H-1 等价但真实规模 121–132ns/run
且冲突侧压力**负优化**；S5-H-2 是 2.2–2.4ms 的 once-per-process CLI
噪声（门槛第 3 条明文否决类 + S5-E-5 同族）；S5-H-3 逐位等价且压力侧
1.4–1.8ms，但作用面**零生产流量**且实现需破坏 `hash32` 单实现意图或
拓宽切片外公开 API。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-*
条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第五遍实际读码。
  上下游 `track/{clarify,loop,plan,primary-split}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts`、
  `adaptation/{promotion,promotion-rules}.ts`、`domain/hash.ts` 只读
  取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含 S5-C-1..7
  / S5-E-1..5 / S5-A/B/D 全部新条目）/ round-05/PLAN.md /
  round-01/R1-H.md / round-02/R2-H.md / round-03/R3-H.md /
  round-04/R4-H.md。候选枚举刻意绕开全部既有排除，特别核对未触碰：
  S1-H-5 / S4-H-2（applyPrecedence 融合与跨模块去重——S5-H-1 是
  **detectConflicts 本体内的分配前守卫**，机制与两者都不同，见 §3.1）、
  S4-I / S5-E-5（惰性 import 已落地/已否决位点——S5-H-2 测的是本切片
  从未量化过的模块图成本，见 §3.2）、S1-H-9 / S2-H-4 / S3-H-4
  （changeSetsEqual 三面钉死维持，本轮零候选）、S1-H-8 / S2-H-6
  （registerRubric 维持）、X4-9 / X0-5 / X0-6。
- R4-H §1 的 ~6µs/run 收益上界按指令**先复核后引用**：本报告 §1 以
  三次独立实测在本 VM 重建该锚点（9.2–9.5µs/run），未硬凑。
- 硬不变量全部满足：本轮零 diff ⇒ 双 LCB 与双归因保留、阈值/权限/
  数据面契约/公开签名不变、测试未改，天然成立。不声称
  Outcome-supported，Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与上界重测

1. **切片逐字节未变**：`git diff fd437a9..d350722 -- src/{evaluation,requirement,review,rubric}/`
   输出为空；同范围 `git log` 零提交。R1-H 逐函数下界表、R2-H 上界
   论证、R3-H 重复工作枚举、R4-H 三类新角度收口与全部 S*-H-* 排除
   继承有效。
2. **调用图可证不变**：`git log ede7021..d350722 -- src/` 仅含 S4-C
   （`routing/lin-alg.ts`）、S4-I（`cli/main.ts` + `pi-adapter/auth-session.ts`）、
   S5-C（`routing/lin-alg.ts`）三组落地，无一 import 本切片 ⇒ R3-H/R4-H
   复核过的调用方地图数学上不可能改变。本轮全库 import 检索双确认：
   `assertCoverageAllowsStart` ← `run/{supervisor,coordinator,flowchart-run}.ts`
   （每 run 启动一次）；`extractHeuristicContract` ← `track/clarify.ts`
   （每 run 一次）；`applyPrecedence` ← `track/loop.ts`（每 run 一次）；
   `shouldScout` ← `track/plan.ts`（每 run 一次）；
   `assertCanPromoteFromReview` ← `adaptation/promotion-rules.ts`（每晋升
   一次）；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（仅类型导入与测试引用）。
3. **上界锚点重测**（指令要求，三次运行区间，本 VM）：

```text
CEILING re-verify: extractHeuristicContract=8059-8383ns + run-start gate=804-886ns
  + applyPrecedence=245-281ns = 9190-9460ns once-per-run production total
  -> slice gain ceiling 9.2-9.5µs/run（战役落地线：数十~数百 ms）
```

   复核结论：绝对值高于 R4-H 的 5.7–6.1µs，落在四轮历史跨 VM 带
   （4.5–10µs）内，属测量环境差异而非调用图变更（§1.2 已证零变更）。
   门槛第 3 条（真实规模非噪声、落地线数十~数百 ms）在本切片当前
   调用图下**结构上不可满足**——重开前提维持 R4-H 收口原文：调用图
   变更（evaluation/review/rubric 面接入每 turn 热路径，或合同规模
   增长 ≥2 个量级）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-H-1 | `detectConflicts` 分配前守卫：先跑两个早退 `some` 扫描，仅当 fast/slow **双侧都命中**才做双 filter + 数组分配。与 S1-H-5（applyPrecedence 内把双 filter 融合单遍）、S4-H-2（跨模块结果级去重）机制都不同：本条在 detectConflicts 本体内让**无冲突路径零分配**——生产 heuristic 合同无 fast/slow 关键词，恒走该路径（现行 = 2 次全量 filter 扫描 + 2 次数组分配；候选 = 1 次 miss 扫描 + 0 分配） | 无冲突路径省 1 次全扫 + 2 次分配；有冲突路径**多付** ≤2 次早退扫描 | ✅ 6000 fuzz（含 fast∧slow 双命中、重复 id）+ heuristic 形状定向（确认生产恒走无冲突分支）逐字节一致 | 真实 C=2 省 **121–132ns**/run（240→119ns，once per run，applyPrecedence 全函数仅 238–243ns）；压力 C=729 无冲突侧 +29.0~32.7µs、**有冲突侧 −2.8~−4.2µs（三次全部更慢）** | 淘汰：真实规模亚 µs once-per-run 噪声（占 §1 上界锚点 ~1.3%）+ 冲突侧压力负优化（守卫在命中时是纯重复扫描——S2-H-3「融合丢早退」的镜像教训：**守卫在命中侧丢守卫费**）；两端非同向使其连「规模增长可重开」的干净候选都不是 |
| S5-H-2 | 生产加载的切片子树惰性 import（模块图角度，本切片四轮从未量化）：`requirement/{coverage,heuristic,extractor,normalizer,critic,provenance,precedence}` + `review/self-review` 经 `run/*`、`track/*`、`adaptation/promotion-rules` 在 CLI 启动时急切加载。候选 = S4-I/S5-E-5 同族的用点惰性化 | 免启动期 8 模块的解析/求值 | —（进程级测量，无等价性问题；测量确定性由 5 样本中位数 ×3 轮保证） | dist 产物、新进程、domain 共享依赖预扣除后**切片独占冷加载中位数 2261/2270/2448µs**（区间 2211–2671µs），once per **process** | 淘汰三重：(a) 门槛第 3 条**明文**否决 once-per-run CLI 噪声，2.2–2.4ms 恰属此类（S5-E-5 的 2.8–3.0ms 独占增量同量级同判）；(b) 惰性化仅是**延付**——track/clarify 每个 tracked run 必然触发，成本照付，真正省的只有从不进 tracking 路径的命令（--help/纯配置类），有效收益更低；(c) 需改切片外全部 6 个调用方文件（S4-I 落地的是 ms×大子树 + 用点在自己切片内，本条两者都不满足） |
| S5-H-3 | `hashArtifact` 免拼接增量折叠：切片内唯一 Θ(字节) 位点把 `${stdout}\u0000${stderr}` 先物化成全尺寸新串再交 `hash32` 逐 code unit 折叠（charCodeAt 迫使 rope 扁平化 = 双倍内存流量）。`hash32` 是可播种折叠（h = h·31 + c），增量变体（折 stdout → 折 "\u0000" → 折 stderr）**构造上逐位相同** | 免 1 次 O(bytes) 串物化；哈希值逐位不变 | ✅ 8000×2 逐位检查（经公开 CheckAdapter.metadata.artifactHash + 直接对 hash32 拼接双路，含嵌入 NUL、孤立代理项、BMP 高码点、空串）三轮全过 | 典型 CI 输出 2KB+200B：省 **1.9–2.0µs**/call；压力 1MB stdout：省 **1363–1823µs**/call——但该面自 R1-H 起四轮复核**零生产调用方**（test-only 面），1MB 输入无任何契约锚点 | 淘汰：零生产流量（S1-E-7/S1-H-7 类，收益在生产不可测）+ 实现两难——在 check-adapter 内复制折叠循环违背 `domain/hash.ts` 的「Centralized here so every caller shares one implementation」文档化意图（X0-5 邻域），拓宽 `hash32` 播种签名则是切片外公开面变更；真实规模（KB 级）亦仅 µs 级 |

另有四处以既有排除/前轮收口直接覆盖、不立新 ID：`createEvaluationRecord`
的 `input.evidence[criterion.id]` 双属性读 CSE（S1-E-2 双 Map.get 同族
±ns 抖动 + test-only 面）；`findUnsourcedItems` 每类别 filter+map 两遍
并单遍（X3-2/S1-F-5 常数遍数噪声类，且 R1-H 已按「单遍即输出」收口）；
`normalizeSources` 的 `content.slice(0, 200)` 短内容免拷贝（V8 全范围
slice 本就返回原串，零分配，无候选）；`isVague` 谓词重排（S1-B-2 类
单句亚噪声，R3-H 不立 ID 收口维持）。第五遍对 21 文件逐一重扫**再未
发现任何未被五轮排除表覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S5-H-1：分配前守卫的双侧代价——「省分配」与「丢守卫费」不可兼得

S1-H-5 融合双 filter 为单遍（仍分配），S4-H-2 想跨模块复用判定结果
（信息缺口 + 签名墙），本轮的新机制是**判定与物化分离**：先用零分配的
双 `some` 判「有没有冲突」，只在有冲突时才物化 fast/slow 数组。生产
路径（heuristic 合同的两条 observableCheck 都无 fast/slow 关键词）恒走
无冲突分支，三次运行稳定省 121–132ns——但这是 once-per-run 的
240ns 函数，收益占 §1 上界锚点约 1.3%，深入战役噪声带。真正钉死它的
是压力有冲突侧：C=729 时候选**三次全部更慢**（−2.8~−4.2µs）——守卫
命中时那两次「早退」`some` 是纯增量（早退点可能在任意深度，最坏全扫）。
这与 S2-H-3（融合丢失早退在压力侧负优化）构成对偶教训：**给多遍结构
加前置守卫，在守卫不命中侧省的，恰是守卫命中侧多付的**；除非两侧
流量分布已知且恒偏一侧（本切片生产流量恒无冲突，但 detectConflicts
是公开导出，无处强制该分布）。两端非同向 ⇒ 即使未来合同规模增长，
本条也不是干净的重开候选——重开必须先版本化「无冲突为主」的流量假设。

### 3.2 S5-H-2：模块图是本切片最后一个未量化的成本面——量化后即关闭

四轮扫描全部对准调用图（每 run 的函数执行成本）；本轮补测模块图
（每 process 的加载成本）：在 dist 编译产物上、新 Node 进程内、把
domain/* 共享依赖预扣除后，切片生产子树（8 模块）独占冷加载中位数
2.2–2.4ms。这个数字**看起来**在 ms 级，但三重否决：其一，门槛第 3 条
明文把 once-per-run CLI 噪声列为否决类，进程级一次性成本正是该类
（S5-E-5 的 2.8–3.0ms 独占增量被同理由否决是最近先例）；其二，惰性
import 不消灭成本只延付成本——`track/clarify.ts` 在每个 tracked run
的 clarify 阶段必然调用 `extractHeuristicContract`，`run/*` 启动必然
调用 `assertCoverageAllowsStart`，即主路径 run 一次不少地照付，净省
只发生在从不进 tracking 的命令上；其三，实现要改 6 个切片外调用方
（`run/supervisor.ts`、`run/coordinator.ts`、`run/flowchart-run.ts`、
`track/clarify.ts`、`track/loop.ts`、`track/plan.ts`——S4-I 能落地是
因为 Pi 运行时子树大（ms×10 级）且用点在 CLI 自己切片内，本条两个
条件都不满足）。至此本切片调用图（R2-H §3.4）与模块图（本节）两个
成本面都有了实测上界，第五遍收口完整。

### 3.3 S5-H-3：切片内唯一 Θ(字节) 位点——逐位等价成立，败于零流量与实现两难

`hashArtifact` 是全切片唯一随输入字节数伸缩的结构（其余全部被 C=2 /
Q≤4 / 表长 3 钉死在常数规模）。`hash32` 的折叠形式（h = h·31 + c 逐
UTF-16 code unit）使增量变体构造上逐位相同——16,000 项逐位检查（含
嵌入 NUL 与孤立代理项）三轮全过，压力 1MB 侧稳定省 1.4–1.8ms（免掉
的正是拼接物化 + rope 扁平化的双倍内存流量）。但 CheckAdapter 自
R1-H 起四轮复核零生产调用方（本轮 grep 再确认），1MB stdout 无契约
锚点（真实测试样本 KB 级，省 ~2µs）；且落地路径两难：在 check-adapter
内手写折叠循环违背 `domain/hash.ts` 头注释明示的单实现集中化意图
（该文件正是为消除「evaluation, learning, experiments, routing 各抄
一份」而立，X0-5 私有助手合并的镜像面），拓宽 `hash32` 为可播种签名
则是切片外 domain 公开面变更。等价性证据留档：若 check-adapter 未来
接入生产且输出 ≥100KB 级，本条可凭本报告直接重开，且应走「拓宽
domain/hash.ts 播种 API」路线而非复制循环。

### 3.4 第五遍收口：成本面枚举已尽

R1-H 证逐函数渐近下界，R2-H 证调用图收益上界，R3-H 枚举尽切片内
重复工作与分配削减，R4-H 收口内建换写/跨模块去重/局部可变化三类
角度，本轮补上最后三个层级：**生产快路径的分配前守卫**（S5-H-1，
败于双侧代价对偶）、**模块图冷加载成本**（S5-H-2，量化 2.2–2.4ms
once-per-process 后按门槛明文关闭）、**Θ(字节) 位点的内存流量**
（S5-H-3，败于零流量 + 实现两难）。五遍合起来：单函数、函数间、
跨模块、调用图、模块图五个成本面全部有实测锚点与排除收口。重开
该切片的唯一前提维持不变：调用图变更（每 turn 热路径接入或合同
规模 ≥2 个量级增长）。

## 4. 逐文件收口（第五遍新视角，其余与 R1-H/R2-H/R3-H/R4-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/precedence.ts` | detectConflicts 分配前守卫（S5-H-1）；S1-H-5/S4-H-2 维持未重开 | S5-H-1 淘汰 |
| `evaluation/check-adapter.ts` | hashArtifact 免拼接增量折叠（S5-H-3）；changeSetsEqual 三面钉死维持（零候选） | S5-H-3 淘汰 |
| 切片生产子树模块图 | 冷加载成本量化 + 惰性 import 角度（S5-H-2） | S5-H-2 淘汰 |
| `requirement/heuristic.ts` | isVague 谓词重排（S1-B-2 类，不立 ID）；正则/字面量/some 守卫诸收口维持 | 无新候选 |
| `requirement/coverage.ts` | S1-H-1/2、S4-H-1 三面钉死维持；orphans 拷贝（S1-A-7 身份类）维持 | 无新候选 |
| `requirement/extractor.ts` / `critic.ts` / `normalizer.ts` / `provenance.ts` | S2-H-1/2/3/7、S3-H-1/2 维持；slice(0,200) 零分配核实（不立 ID）；findUnsourcedItems 每类别两遍（X3-2 类，不立 ID） | 无新候选 |
| `evaluation/evaluator.ts` | evidence 双属性读 CSE（S1-E-2 族 + test-only，不立 ID）；S1-H-7 维持 | 无新候选 |
| `evaluation/types.ts` / `adapters.ts` / `precedence.ts` / `ownership.ts` / `delivery-adapter.ts` / `diff-adapter.ts` | 纯类型/常量/3 元表；X4-9 维持；分支序为归因契约 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `critic.ts` / `self-review.ts` | 双物质比较为协议本体；remap "ab" 冗余展开（R1-H 不立 ID）维持；S1-H-6 维持；O(1) 谓词 | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持；Θ(字段) 构造 | 无新候选 |

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
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H/R2-H/R3-H/R4-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r5h-sim.mts`，无赢家故未入库以从 round01–05 仅
赢家 sim 入库的仓库惯例；完整源码见附录，seed 固定可复现；S5-H-2 的
模块图测量以 `pnpm build` 后的 dist 产物为准）代表性一次运行：

```text
S5-H-1 bench real heuristic C=2 (no-conflict production path): current=240ns cand=119ns delta=121ns/run inside applyPrecedence=238ns (once per run)
S5-H-1 bench stress no-conflict (729 criteria): current=59572ns cand=27319ns delta=32253ns/call
S5-H-1 bench stress with-conflict (729 criteria, candidate re-scans): current=60456ns cand=64642ns delta=-4186ns/call
S5-H-2 slice-exclusive cold module load (dist, fresh process, domain deps pre-charged): median=2261µs range=[2211, 2564]µs — once per PROCESS, i.e. once-per-run CLI noise class
S5-H-3 bench typical CI output 2KB+200B: current(concat+hash32)=7.6µs cand(incremental)=5.6µs delta=2.0µs/call (face has NO production caller)
S5-H-3 bench stress 1MB stdout: current(concat+hash32)=4541.8µs cand(incremental)=2841.1µs delta=1700.7µs/call (face has NO production caller)
CEILING re-verify: extractHeuristicContract=8276ns + run-start gate=804ns (matrix=441ns) + applyPrecedence=281ns = 9361ns once-per-run production total -> slice gain ceiling ~9.4µs/run (campaign landing bar: tens-to-hundreds of ms)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~28,000 项等价/逐位检查全部通过、裁决结论逐位一致；
计时抖动内方向稳定（S5-H-1 真实规模三次 121/132/129ns、冲突侧压力
三次全部更慢 −4186/−3328/−2806ns；S5-H-2 中位数三次 2261/2270/2448µs；
S5-H-3 压力侧三次 1701/1823/1363µs；上界锚点三次 9361/9460/9190ns）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-H-1 | detectConflicts 双 some 分配前守卫（无冲突路径零分配） | 真实 C=2 仅 121–132ns/run once-per-run 噪声；冲突侧压力三次稳定负优化（−2.8~−4.2µs）——守卫命中侧的双侧代价对偶（S2-H-3 镜像） |
| S5-H-2 | 生产加载切片子树（requirement/* 7 文件 + review/self-review）惰性 import | 切片独占冷加载实测 2.2–2.4ms once-per-process = 门槛明文否决的 CLI 噪声类（S5-E-5 同族）；惰性化仅延付（tracked run 主路径照付）；需改 6 个切片外调用方 |
| S5-H-3 | hashArtifact 免拼接增量 hash32 折叠 | 逐位等价（16,000 项含 NUL/孤立代理项）但作用面零生产调用方（test-only，S1-E-7 类）；1MB 压力侧 1.4–1.8ms 无契约锚点；实现需复制集中化哈希循环（X0-5 邻域）或拓宽切片外 domain 公开 API |

重开条件：S5-H-1 需先出现每 turn 生产调用方或合同规模 ≥2 个量级增长，
**且**先版本化「无冲突流量为主」的分布假设（否则冲突侧负优化反噬）；
S5-H-2 需先把 CLI 启动预算立为战役目标（ms 级落地线）或切片子树增长
≥2 个量级（如引入重依赖），且接受 6 个切片外调用方变更；S5-H-3 需
先出现 check-adapter 的生产调用方且 CommandResult 输出达 ≥100KB 级，
届时凭本报告逐位等价证据直接重开，落地路线应为拓宽 `domain/hash.ts`
播种 API 保单实现，而非在 check-adapter 内复制循环。总门槛更新：任何
候选须先推翻本报告 §1 的 **9.2–9.5µs/run**（本 VM）实测收益上界（即
调用图出现新热路径或合同规模 ≥2 个量级增长）；模块图面额外受
once-per-process 否决类钉死。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：`pnpm build` 后保存为任意 `.mts` 并 `npx tsx <file>`（仓库
根目录，依赖已装；`.mts` 保证 ESM 顶层 await 可用；S5-H-2 需要 dist
产物存在）。seeds：`0x554801` / `0x554803`（S5-H-2 为进程级测量，
无需 RNG）。

```ts
/**
 * R5-H deterministic equivalence + benchmark simulation (fifth pass).
 * Adjudicates fresh candidates S5-H-1 .. S5-H-3 against the current
 * implementations in src/{evaluation,requirement,review,rubric} and
 * re-verifies the R4-H §1 ~6µs/run slice gain ceiling (which itself
 * re-verified R2-H §3.4 / R3-H §3.4). All candidates are NEW angles not
 * named by EXCLUSIONS.md, R1-H (S1-H-1..9), R2-H (S2-H-1..7), R3-H
 * (S3-H-1..4) or R4-H (S4-H-1..3). Seeded PRNG (mulberry32) -> fully
 * reproducible. Seeds: 0x554801 .. 0x554803.
 *
 * Reference = production imports wherever the function is exported (or the
 * public adapter surface for private helpers); each candidate differs from
 * the current implementation ONLY by the candidate edit.
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
  type HeuristicHabits
} from "/workspace/src/requirement/heuristic.js";
import {
  assertCoverageAllowsStart,
  coverageMatrixFromTasks,
  type CoverageTaskRef
} from "/workspace/src/requirement/coverage.js";
import { createCheckAdapter } from "/workspace/src/evaluation/check-adapter.js";
import type { AdapterContext, CommandResult } from "/workspace/src/evaluation/adapters.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import type {
  RequirementContract,
  AcceptanceCriterion,
  SourceRef
} from "/workspace/src/domain/contract.js";
import type { EpisodeId, TaskId } from "/workspace/src/domain/ids.js";

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
 * S5-H-1: detectConflicts — guard-first, allocation-free no-conflict
 * path. Distinct from S1-H-5 (fusing the two filters into one pass
 * inside applyPrecedence) and S4-H-2 (cross-module result-level dedup
 * with critiqueContract): here detectConflicts itself first runs two
 * early-exiting `some` scans and only allocates + re-filters when BOTH
 * sides are present. The production heuristic contract has no fast/slow
 * keywords, so the production path always takes the no-conflict branch:
 * current = 2 full filter scans + 2 array allocations; candidate =
 * 1 full miss-scan (the first `some`) + 0 allocations. Trade-off: in
 * the conflict case the candidate re-scans (2 extra early-exit `some`).
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
  const criteria = contract.acceptanceCriteria;
  // the candidate edit: allocation-free guard before the filters
  if (
    !criteria.some((criterion) => isFastLocal(criterion.observableCheck)) ||
    !criteria.some((criterion) => isSlowLocal(criterion.observableCheck))
  ) {
    return [];
  }
  const fast = criteria.filter((criterion) => isFastLocal(criterion.observableCheck));
  const slow = criteria.filter((criterion) => isSlowLocal(criterion.observableCheck));
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
  const rng = mulberry32(0x554801);
  for (let trial = 0; trial < 6000; trial += 1) {
    const contract = genPrecedenceContract(rng, 1);
    check(
      "S5-H-1 equivalence (guard-first detectConflicts)",
      JSON.stringify(detectConflicts(contract)) === JSON.stringify(candidateDetectConflicts(contract)),
      JSON.stringify(contract.acceptanceCriteria.map((criterion) => criterion.observableCheck))
    );
  }
  // Directed: the real heuristic-shaped contract (no fast/slow keywords)
  // must take the no-conflict branch on both sides.
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const real = prod.contract;
  check(
    "S5-H-1 heuristic-shaped parity (production no-conflict path)",
    JSON.stringify(detectConflicts(real)) === JSON.stringify(candidateDetectConflicts(real)) &&
      detectConflicts(real).length === 0
  );
  const curReal = bench(() => void detectConflicts(real), 100000);
  const candReal = bench(() => void candidateDetectConflicts(real), 100000);
  const applyReal = bench(() => void applyPrecedence(real, "user-first"), 100000);
  console.log(
    `S5-H-1 bench real heuristic C=${real.acceptanceCriteria.length} (no-conflict production path): current=${(curReal * 1e6).toFixed(0)}ns cand=${(candReal * 1e6).toFixed(0)}ns delta=${((curReal - candReal) * 1e6).toFixed(0)}ns/run inside applyPrecedence=${(applyReal * 1e6).toFixed(0)}ns (once per run)`
  );
  // Stress both directions: no-conflict at scale (candidate best case) and
  // with-conflict at scale (candidate worst case: 2 extra early-exit scans).
  const stressMiss = {
    ...genPrecedenceContract(mulberry32(0x554801), 100),
    acceptanceCriteria: genPrecedenceContract(mulberry32(0x554801), 100).acceptanceCriteria.map(
      (criterion, i) => ({ ...criterion, observableCheck: `run the suite number ${i}` })
    )
  } as RequirementContract;
  const curMiss = bench(() => void detectConflicts(stressMiss), 2000);
  const candMiss = bench(() => void candidateDetectConflicts(stressMiss), 2000);
  console.log(
    `S5-H-1 bench stress no-conflict (${stressMiss.acceptanceCriteria.length} criteria): current=${(curMiss * 1e6).toFixed(0)}ns cand=${(candMiss * 1e6).toFixed(0)}ns delta=${((curMiss - candMiss) * 1e6).toFixed(0)}ns/call`
  );
  const stressHit = genPrecedenceContract(mulberry32(0x554801), 100);
  const curHit = bench(() => void detectConflicts(stressHit), 2000);
  const candHit = bench(() => void candidateDetectConflicts(stressHit), 2000);
  console.log(
    `S5-H-1 bench stress with-conflict (${stressHit.acceptanceCriteria.length} criteria, candidate re-scans): current=${(curHit * 1e6).toFixed(0)}ns cand=${(candHit * 1e6).toFixed(0)}ns delta=${((curHit - candHit) * 1e6).toFixed(0)}ns/call`
  );
}

/* ================================================================
 * S5-H-2: module-graph angle (never measured for this slice): the
 * production-loaded slice subtree — requirement/{coverage,heuristic,
 * extractor,normalizer,critic,provenance,precedence} + review/
 * self-review — is imported eagerly at CLI startup via run/*, track/*
 * and adaptation/promotion-rules. A lazy-import candidate (S4-I /
 * S5-E-5 family) would defer that cost. Measure the slice-EXCLUSIVE
 * cold-load cost on the production artifact (dist/, compiled JS) in
 * fresh Node processes, charging shared domain/* deps to the baseline.
 * ================================================================ */
{
  const script = `
    await import("/workspace/dist/domain/contract.js");
    await import("/workspace/dist/domain/errors.js");
    await import("/workspace/dist/domain/ids.js");
    await import("/workspace/dist/domain/timestamp.js");
    const t0 = performance.now();
    await import("/workspace/dist/requirement/coverage.js");
    await import("/workspace/dist/requirement/heuristic.js");
    await import("/workspace/dist/requirement/precedence.js");
    await import("/workspace/dist/review/self-review.js");
    const t1 = performance.now();
    console.log((t1 - t0).toFixed(3));
  `;
  const samples: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const proc = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8"
    });
    if (proc.status !== 0) {
      check("S5-H-2 cold-load probe runs", false, proc.stderr);
      break;
    }
    samples.push(Number(proc.stdout.trim()));
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? Number.NaN;
  console.log(
    `S5-H-2 slice-exclusive cold module load (dist, fresh process, domain deps pre-charged): median=${(median * 1e3).toFixed(0)}µs range=[${(samples[0]! * 1e3).toFixed(0)}, ${(samples[samples.length - 1]! * 1e3).toFixed(0)}]µs — once per PROCESS, i.e. once-per-run CLI noise class`
  );
  check("S5-H-2 probe produced numbers", Number.isFinite(median) && samples.length === 5);
}

/* ================================================================
 * S5-H-3: hashArtifact — the only Θ(bytes) input-scale-sensitive site
 * in the slice concatenates `${stdout}\u0000${stderr}` before hashing
 * (one extra full-size string materialization; charCodeAt on the rope
 * forces flattening). hash32 is a seedable per-code-unit fold, so an
 * incremental variant folding stdout, then "\u0000", then stderr is
 * bit-identical by construction. Costs: duplicating the centralized
 * hash loop in check-adapter (hash.ts's documented single-implementation
 * intent) or widening domain/hash.ts's public API (out of slice).
 * Reference = the PUBLIC CheckAdapter surface (metadata.artifactHash).
 * ================================================================ */
function candidateHashArtifactIncremental(stdout: string, stderr: string): string {
  let h = 0;
  for (let i = 0; i < stdout.length; i += 1) {
    h = (h << 5) - h + stdout.charCodeAt(i);
    h |= 0;
  }
  h = (h << 5) - h; // "\u0000" -> code unit 0
  h |= 0;
  for (let i = 0; i < stderr.length; i += 1) {
    h = (h << 5) - h + stderr.charCodeAt(i);
    h |= 0;
  }
  return `hash_${Math.abs(h).toString(16)}`;
}

function genString(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    const roll = rng();
    if (roll < 0.7) out += String.fromCharCode(32 + Math.floor(rng() * 95)); // ascii
    else if (roll < 0.85) out += String.fromCharCode(Math.floor(rng() * 0xd7ff)); // BMP
    else if (roll < 0.95) out += "\u0000"; // embedded NULs on purpose
    else out += String.fromCharCode(0xd800 + Math.floor(rng() * 0x400)); // lone surrogate half
  }
  return out;
}

{
  const rng = mulberry32(0x554803);
  const adapter = createCheckAdapter();
  const context: AdapterContext = {
    episodeId: "ep_00000001" as EpisodeId,
    workingDirectory: "/w",
    revision: "rev-1",
    changeSet: ["a.ts"]
  };
  for (let trial = 0; trial < 4000; trial += 1) {
    const stdout = genString(rng, 300);
    const stderr = genString(rng, 120);
    const result: CommandResult = {
      exitCode: 0,
      stdout,
      stderr,
      durationMs: 5,
      command: "pnpm test",
      cwd: "/w",
      changeSet: ["a.ts"]
    };
    const evaluation = await adapter.evaluate(context, result);
    const refHash = (evaluation.metadata as Record<string, unknown>).artifactHash as string;
    check(
      "S5-H-3 bit-identity (incremental fold vs public adapter hash)",
      refHash === candidateHashArtifactIncremental(stdout, stderr),
      `trial ${trial}`
    );
  }
  // direct cross-check against the shared hash32 as well
  for (let trial = 0; trial < 4000; trial += 1) {
    const stdout = genString(rng, 300);
    const stderr = genString(rng, 120);
    check(
      "S5-H-3 bit-identity (incremental fold vs hash32 on concat)",
      `hash_${hash32(`${stdout}\u0000${stderr}`)}` === candidateHashArtifactIncremental(stdout, stderr)
    );
  }
  const currentHashArtifact = (stdout: string, stderr: string): string =>
    `hash_${hash32(`${stdout}\u0000${stderr}`)}`;
  for (const [label, outLen, errLen, reps] of [
    ["typical CI output 2KB+200B", 2048, 200, 20000],
    ["stress 1MB stdout", 1 << 20, 4096, 200]
  ] as const) {
    const stdout = genString(mulberry32(0x554803 + outLen), outLen).padEnd(outLen, "x");
    const stderr = genString(mulberry32(0x554803 + errLen), errLen).padEnd(errLen, "e");
    const cur = bench(() => void currentHashArtifact(stdout, stderr), reps);
    const cand = bench(() => void candidateHashArtifactIncremental(stdout, stderr), reps);
    console.log(
      `S5-H-3 bench ${label}: current(concat+hash32)=${(cur * 1e3).toFixed(1)}µs cand(incremental)=${(cand * 1e3).toFixed(1)}µs delta=${((cur - cand) * 1e3).toFixed(1)}µs/call (face has NO production caller)`
    );
  }
}

/* ================================================================
 * Ceiling re-verification (R4-H §1, mandated: re-measure, don't assume):
 * total production work of this slice per run = extraction chain +
 * run-start coverage gate + applyPrecedence (+ O(1) promotion predicate).
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
BRANCH=cursor/r5-h-eval-fifth-pass-83a1

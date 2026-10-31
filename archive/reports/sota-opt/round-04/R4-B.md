# R4-B：live 路由切片 Round 4 四搜报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-B（十区之一，R1-B/R2-B/R3-B 的第四遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `f0748a9`
**分支:** `cursor/r4-b-live-routing-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 关键前提事实：切片 8 个文件加 4 个只读
上下游自 R2-B 的裁决基线 `f5b2526` 以来**逐字节零变化**（`git diff --stat
f5b2526..f0748a9 -- src/` 全 src 仅 `offline-logit.ts` 一个文件变化，即切片外的
S3-C；因 R2-B 已验证 `94ed3d9..f5b2526` 对切片为空，本切片实际自 R1-B 裁决基线
`94ed3d9` 起逐字节未变），R1-B 的结构下界论证与 S1-B-1..8、S2-B-1..4、
S3-B-1..6 全部裁决对当前代码原样成立。本轮第四遍换新透镜穷举，得到 5 个排除表
未覆盖的新提案（S4-B-1 … S4-B-5），全部经理论 + 确定性仿真（seeded mulberry32，
等价性 fuzz + 真实规模基准，三次独立运行结论逐位一致）裁决后淘汰：1 个廉价形式
不等价、修正形式被上界支配（S4-B-1），2 个等价但深度噪声/噪声带（S4-B-2、
S4-B-4），1 个身份可观察改变（S4-B-3），1 个等价但噪声带 + 别名可变危险
（S4-B-5）。未重开任何 X* / S1-* / S2-* / S3-* 条目。

本轮新增的**结构性收口**（§2）：实测本切片在最大现实调用规模下的**全量成本天花
板**为每 eval 9.7–20.0ms（M=2/M=10），即使把整个切片成本消为零也低于落地线
（数十 ms）；而 R1-B §2 下界已排除复杂度类下降。因此在当前调用方图景下，本切片
**不存在任何可达门槛的候选类**——切片被整体收口，而非仅逐候选收口。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts` 只读取证，一行未改。
- 基线漂移检查：`git diff --stat f5b2526..f0748a9 -- src/` 全 src 树仅
  `src/routing/offline-logit.ts`（S3-C 落地，切片外）。切片、上下游与全部调用方
  文件逐字节未变，R1-B/R2-B/R3-B 的规模测量、调用方图景与全部裁决原样成立。
- 排除表遵守：X1-1、X1-2、X1-6、X3-1、X4-4/5、S1-B-1..8、S2-B-1..4、S3-B-1..6
  全部未重开。S4-B-5 是 S3-B-1（批内记忆化）与 S3-B-6（分区内共享可变请求）之外
  的**assign 层姊妹变体**（共享可变 route-input 骨架），按 R2-B/R3-B 先例作为新
  条目独立裁决，结论同向。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation`
  3/3 绿（§6）。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义天然
  不变；双 LCB 与双归因在切片外，未触碰。

## 1. 第四遍搜索方法与调用方图景复核

R1-B 用「输出契约渐近下界」，R2-B 用「跨模块身份/重复归一化/姊妹变体」，R3-B 用
「批内去重/比较器热循环/语义面与分配消除」。本轮换第四组透镜：

1. **聚合天花板透镜**：不再逐候选问「省多少」，先问「整个切片在最大现实规模下
   总共花多少」——若天花板本身低于落地线，则一切常数因子候选先验不可达标（§2）。
2. **多模式匹配/自动机透镜**：正则优先级链能否单遍化（产出 S4-B-1）。
3. **约束依赖分解透镜**：evaluateCandidate 的约束矩阵中请求不变部分能否每批预
   评估（产出 S4-B-2）。
4. **分配来源穷尽透镜**：成功路径空数组单例（S4-B-3）、options 对象免建
   （S4-B-4）、route-input 骨架复用（S4-B-5）。

调用方图景复核（grep 全 src 取证，与 R3-B 记录逐条一致，且因 src 树除
offline-logit 外零变化而必然一致）：`routeR0` 唯一生产调用方仍是
`r1-shadow-report.ts`；`applyEvidenceCascade` 在 src 内仍无生产调用方
（`applyCascade` 生产不可达）；`decideLiveCascade` 在 `run/child-coordinator.ts`
每 child 结果一次；`assignTasks` 调用方为 `cli/main.ts`（N≤30）、
`track/primary-split.ts`、`track/loop.ts`（经 `liveCascadePlanFromAssignment`）、
最大规模入口 `adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate）。

## 2. 聚合天花板：本切片被整体收口的论证

实测（本 VM，三次运行区间；完整脚本见附录）：

```text
ceiling eval-replay N=2000: assignTasks M=2 4838.0–5886.4us | M=10 9387.0–9993.7us | analyzeTask share 1124.6–1151.4us (19–23%)
ceiling per eval run (x2 calls): M=2 total=9.68–11.77ms | M=10 total=18.77–19.99ms | analyzeTask total=2.25–2.30ms
ceiling 10x stress N=20000: assignTasks M=2 50.9–54.0ms per call (101.9–108.0ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 52.6–70.2us per call
```

推论链：

1. 本切片的最大现实规模入口是 eval 回放（N=2000 量级，×2 次调用）。**整个切片**
   在该入口的全量成本为每 eval 9.7–11.8ms（现实目录 M=2）至 18.8–20.0ms
   （M=10 压力目录）。live 面（CLI/track，N≤30）为几十 µs/次，低三个量级。
2. 落地线是「热路径数十~数百 ms，或复杂度类下降」（标尺 S3-C ≈140–155ms）。
   即使存在一个把切片成本**整体消为零**的假想候选（不可能——决策对象构造即输出
   契约本体），节省也只有 ~10–20ms/eval，落在落地线下沿之下；任何真实候选只能
   拿到其中一小部分（历史最强的 S1-B 捆绑为 6%）。
3. 复杂度类下降通道已被 R1-B §2 逐函数下界论证关闭（排序即输出 Ω(M log M)、
   全约束评估即 rejection-matrix 契约 Θ(M×约束数)、决策构造 Θ(输出字段数)），
   本轮复核每条论证在逐字节未变的代码上原样成立。
4. 因此：**在当前调用方图景与数据面契约下，本切片不存在可达门槛的候选类。**
   10× 压力（N=20000，超现实数据集一个量级）下切片全量成本才到 ~102–108ms/eval
   ——届时 20–30% 级候选才开始触线，这是本切片唯一的结构性重开条件（§7）。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-B-1 | `analyze-task.ts` 七正则优先级链换单遍多模式扫描（合并 alternation + 类别命中旗标） | 至多 8 遍文本扫描 → 1 遍 | ❌ 廉价形式发散见证 + 语料 25.8% 发散（2062/8000，三次逐位一致）；修正形式需逐 token 多类别归属 | 被上界支配：analyzeTask 全量仅 2.25–2.30ms/eval | 淘汰：见 §4.1 |
| S4-B-2 | `evaluateCandidate` 约束按依赖分解，模型不变失败片段（provider-policy）每批预评估 | 每 (任务,模型) 省 1 次属性比较与条件分支 | ✅ 5000 组 fuzz（replica 保真 + factored 逐字节） | N=2000×M=2 批省 16.6–33.1µs——深度噪声 | 淘汰：见 §4.2 |
| S4-B-3 | `evaluateCandidate`/`evaluateLiveCandidate` 成功路径共享冻结空 `failures` 单例 | 每合格候选免 1 次空数组分配（ns 级） | ❌ 身份论证：当前 `R0Decision.candidates[i].failures` 跨候选互异（探针 true），单例使之别名 | — | 淘汰：可观察身份改变，S1-A-7/S1-B-8 先例 |
| S4-B-4 | `assignPlanned` 免建 `AnalyzeTaskOptions` 条件 spread 对象，直接传 task（结构超集） | 每任务省 1 次 ≤3 字段对象构造 | ✅ 8000 组 fuzz（含显式 undefined 属性）逐字节 | N=2000 批省 142.9–214.6µs | 淘汰：S1-B 捆绑（284µs）/S2-B-1（202–240µs）同噪声带 + 跨边界宽对象脆弱性（§4.3） |
| S4-B-5 | `assignTasks` 批内共享可变 route-input 骨架（S3-B-6 的 assign 层姊妹；含 modelPolicy 壳复用） | 每任务免 1 次 ~13 字段输入对象 + 1 次 modelPolicy 壳分配 | ✅ 3000 组 fuzz 对真实 `router.route` 逐字节（含 refusal 路径） | N=2000 批省 232.3–348.8µs（route-only 路径） | 淘汰：同噪声带（~0.5–0.7ms/eval）+ 别名可变危险（§4.4） |

## 4. 关键裁决细节

### 4.1 S4-B-1：单遍化在两个层面都关死

**语义层**：HIGH_RISK_RE 与 familyOf 的 deploy 检查共享 token 集
（deploy/production/prod）。合并 alternation 的单遍扫描对每个匹配位置只把 token
记入**第一个**命中的分组——deploy token 被 HIGH_RISK 分支消费后 deploy 旗标永远
不亮。发散见证：`"Deploy payment credentials to production"`（worker）当前
family=`deploy`，naive 单遍=`edit`；语料 fuzz 8000 组发散 2062 组（25.8%，
确定性计数三次逐位一致）。修正形式必须做逐 token 多类别归属（tokenizer + 8 组
成员集，且要覆盖 `drop table`、`break down`、`rm -[a-z]*`、`add ` 尾空格等多词/
边界模式）——即手写扫描器，落在 S3-B-5 已实证的「手写循环输给 V8 内建」负优化
域。

**价值层**：即使修正形式做到理论最优（analyzeTask 100% 消除——不可能，正则
匹配本身是分类语义），上界也只有 2.25–2.30ms/eval，低于落地线一个量级。§2 的
天花板论证使本候选无需实现即可裁决。

### 4.2 S4-B-2：约束矩阵里几乎没有请求不变量

逐约束的依赖分析：provider-policy 是**唯一**完全模型不变的约束（1 次字符串比较
+ 1 个失败对象字面量）；privacy 依赖 `request.privacyRequired`，capability 依赖
`request.requiredCapabilities`，context/max-output/budget/deadline/high-risk 全
依赖请求。分解后的收益上界就是每次评估省 1 次属性比较——实测 N=2000×M=2 批仅
16.6–33.1µs（占批 <0.7%），深度噪声。

进一步的「assign 路径特化」（privacyRequired 恒为 `"cloud-general"`、
requiredCapabilities 常为 `["tool-use"]`，可把 privacy/capability 也预评估）依赖
的是 `assignPlanned` 未把 `privacyRequired` 传入 route() 这一**未承诺的路径默认
值**——S2-B-1 型跨模块脆弱性。且任何生产实现都需要在 `evaluateCandidate` 旁开
平行评估路径（X1-2 味），直接弱化 policy.ts L154-156「请求对象完整直进共享约束
矩阵」的架构护栏。三重否决。

### 4.3 S4-B-4：等价成立但双重不达标

直接传 task 作 options 在行为上逐字节等价（analyzeTask 对三个可选字段只做
`!== undefined` 检查，显式 undefined 与缺席同义；8000 组 fuzz 含显式 undefined
属性验证通过）。但：

1. **噪声带**：142.9–214.6µs/批，与已裁决淘汰的 S1-B 捆绑（284µs）、S2-B-1
   （202–240µs）同带宽同路径——一次性离线路径上的 <4% 常数因子。
2. **边界脆弱性**：把含 `taskId/role/objective` 的宽对象递给 analyzeTask，
   意味着 `AnalyzeTaskOptions` 未来任何与 `AssignableTask` 撞名的新键（语义不同
   时）都会被静默注入。防御性最小接口正是这条模块边界的护栏。

### 4.4 S4-B-5：第三个共享可变提案，同一堵墙

与 S3-B-1（批内记忆化，负优化）、S3-B-6（分区内共享请求，护栏否决）构成同一
思路的第三形态：把每任务的 route-input 对象（含 modelPolicy 壳）换成批内单一
可变骨架。等价当前成立（`router.route` 不保留输入对象引用，3000 组 fuzz 对真实
router 逐字节，含 refusal 抛错路径），但：

1. **噪声带**：232.3–348.8µs/批（route-only 计价），换算 ~0.5–0.7ms/eval，
   仍在 S1-B 捆绑噪声带内、低于落地线一个量级以上。
2. **别名可变危险**：r0 入口类在 `R0Decision.request` **保留请求对象**；live 入
   口今天不保留是实现巧合而非契约。共享矩阵的两类调用方一旦在可变性纪律上分叉
   （live 骨架可变、r0 请求冻结），任何未来在决策/诊断字段中回显输入的改动都会
   跨任务污染——与 S3-B-6 撞同一堵 policy.ts L154-156 的墙。

### 4.5 S4-B-3：一句话身份否决

`routeR0` 两合格候选探针：`candidates[0].failures !== candidates[1].failures`
恒 true（各自新鲜空数组）。共享冻结 `[]` 单例把它翻成 false——`failures` 是
`R0Decision.candidates`（公开输出）与 `CandidateCheck`（公开返回）的字段，对象
身份可观察（S1-A-7/S1-B-8 先例）。收益是每合格候选一次空数组分配（ns 级），
不值得任何论证成本以外的字。

## 5. 逐文件收口（第四遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `analyze-task.ts` | S4-B-1 淘汰（语义 + 上界双关）；S1-B-1/2/3 维持 | 无候选 |
| `policy.ts` | S4-B-2 淘汰（无请求不变量 + 护栏）；S4-B-3 淘汰（身份）；全约束独立评估为契约下界维持 | 无候选 |
| `assign.ts` | S4-B-4、S4-B-5 淘汰；防御拷贝维持 S1-B-8/S2-B-1 排除；批不变量已提升 | 无候选 |
| `r0.ts` | S4-B-3 身份探针在此取证；高风险过滤维持 S1-B-6/S2-B-3 排除；排序输出即契约 | 无候选 |
| `live-cascade.ts` | 无新面；S3-B-2/3 与 S1-B-4/5 维持 | 无候选 |
| `primary-catalog.ts` / `catalog-model.ts` | 纯构造 Θ(字段)，条件 spread 属性存在性可观察（S1-C-10 类）维持 | 无候选 |
| `supervisor/model-router.ts` | S4-B-5 的骨架消费端在此取证（route 不保留输入为实现巧合）；S3-B-5、S2-B-2 维持；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |

## 6. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test test/unit/routing/*.test.ts test/unit/supervisor/*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本未入库——无赢家不落地死代码；完整源码见附录，seeds
`0xb44b01`–`0xb44b06`）最终一次运行：

```text
ceiling eval-replay N=2000: assignTasks M=2 5723.6us | M=10 9387.0us | analyzeTask share 1151.4us (20%)
ceiling per eval run (x2 calls): M=2 total=11.45ms | M=10 total=18.77ms | analyzeTask total=2.30ms
ceiling 10x stress N=20000: assignTasks M=2 50.9ms per call (101.9ms per eval x2)
ceiling CLI live face N=30: assignTasks M=2 69.0us per call
S4-B-1 witness "Deploy payment credentials to production": current family=deploy naive-single-scan=edit -> diverges=true
S4-B-1 corpus divergence: 2062/8000 trials (25.8%)
S4-B-2 bench N=2000 M=2 (4000 evals): current=832.6us factored=816.0us delta=16.6us per batch
S4-B-3: both eligible=true; candidates[0].failures !== candidates[1].failures = true
S4-B-4 bench N=2000: options-object=1306.9us direct-task=1164.0us delta=142.9us per batch
S4-B-5 bench N=2000 (route-only): fresh-input=3121.2us skeleton=2888.8us delta=232.3us per batch
CONCLUSIONS: S4-B-1 naive-diverges=true corpus-divergent>0=true | S4-B-2 factored-equal=true | S4-B-3 current-distinct=true | S4-B-4 equal=true | S4-B-5 equal=true
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 `CONCLUSIONS` 行**逐位一致**（含确定性的 2062/8000 发散计数），
基准方向三次一致（S4-B-2 16.6–33.1µs、S4-B-4 142.9–214.6µs、S4-B-5
232.3–348.8µs，全部同向为正但同在噪声带）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-B-1 | analyze-task 七正则链换单遍多模式扫描（合并 alternation/自动机） | 廉价形式不等价（HIGH_RISK 与 deploy token 集重叠，语料 25.8% 发散）；修正形式需手写逐 token 多类别扫描（S3-B-5 负优化域）且被上界支配（analyzeTask 全量仅 2.25–2.30ms/eval） |
| S4-B-2 | evaluateCandidate 约束按依赖分解、模型不变失败片段每批预评估 | 等价但唯一模型不变约束是 provider-policy，N=2000×M=2 批仅省 16.6–33.1µs；生产实现需平行评估路径（X1-2 味）+ 弱化 policy.ts L154-156 护栏；特化更多不变量依赖未承诺的路径默认值（S2-B-1 型） |
| S4-B-3 | evaluateCandidate/evaluateLiveCandidate 成功路径共享冻结空 failures 单例 | 不等价：candidates[].failures 跨候选身份互异是可观察契约（S1-A-7/S1-B-8 先例）；收益 ns 级 |
| S4-B-4 | assignPlanned 免建 AnalyzeTaskOptions 对象直接传 task | 等价（含显式 undefined fuzz）但 N=2000 批仅省 142.9–214.6µs（S1-B 捆绑同噪声带）；跨边界宽对象使未来撞名键静默注入 |
| S4-B-5 | assignTasks 批内共享可变 route-input 骨架（S3-B-6 的 assign 层姊妹） | 等价（router 今日不保留输入）但 232.3–348.8µs/批同噪声带；r0 入口保留请求对象，共享矩阵两类调用方可变性纪律分叉，S3-B-6 同一护栏 |

**结构性重开条件（对整个切片）**：eval 数据集规模增长 ≥1 个量级（N≥20000 时
切片全量成本 ~102–108ms/eval，20–30% 级候选开始触线），或 analyzeTask/route
进入每 turn 热路径，或出现新的高频调用方。逐候选重开条件：S4-B-1 需先给出正确
且实测不慢于 V8 正则的单遍实现（推翻 S3-B-5 域）且满足结构性条件；S4-B-2/4/5
需先满足结构性条件（等价证据本报告已备）；S4-B-3 需先推翻身份契约论证。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb44b01`–`0xb44b06`。

```ts
/**
 * R4-B deterministic equivalence + benchmark simulation (fourth pass).
 * Adjudicates fresh Round-4 candidates S4-B-1 .. S4-B-5 against the live
 * routing slice, byte-identical since R1-B's baseline 94ed3d9, and measures
 * the aggregate slice ceiling at the largest realistic caller scale.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb44b01-0xb44b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions, type TaskAnalysis } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel, type AssignmentPolicyPlan } from "/workspace/src/routing/assign-plan.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import { routeR0, type R0Config } from "/workspace/src/routing/r0.js";
import { evaluateCandidate, type ConstraintFailure, type RouteRequest } from "/workspace/src/routing/policy.js";
import {
  estimateCostUsd,
  estimateLatencyMs,
  hasCapability,
  satisfiesPrivacy,
  type ModelDescriptor,
  type PrivacyClass
} from "/workspace/src/routing/capability-registry.js";
import {
  createModelRouter,
  type ModelRouterConfig,
  type RouteTaskInput,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { TaskComplexity } from "/workspace/src/domain/flowchart.js";
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

const ROLES: readonly AgentRole[] = [
  "worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"
];
const OBJECTIVE_TEMPLATES = [
  "Survey the payment module",
  "Plan the checkout migration",
  "Run the unit tests",
  "Deploy payment credentials to production",
  "Implement retry logic for the ledger sync",
  "Review the audit log formatting nits",
  "Refactor and rename the tracking roller",
  "Fix the flaky spec for gate transitions",
  "Research and compare vector store options",
  "Investigate why the drop table migration failed in prod",
  "验证路由细节并补充测试",
  ""
];
const FRAGMENTS = [
  "deploy", "production", "credentials", "review", "tests", "coverage", "plan",
  "design", "survey", "research", "refactor", "implement", "add ", "fix ",
  "migrate", "verify", "\n", "the module", "碎片", " "
];
function genObjective(rng: () => number): string {
  if (rng() < 0.5) return pick(rng, OBJECTIVE_TEMPLATES);
  let text = "";
  const parts = 1 + Math.floor(rng() * 8);
  for (let i = 0; i < parts; i += 1) text += pick(rng, FRAGMENTS) + " ";
  return text;
}
function genTasks(rng: () => number, n: number): AssignableTask[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `tsk_${i.toString().padStart(6, "0")}` as AssignableTask["taskId"],
    role: pick(rng, ROLES),
    objective: genObjective(rng),
    ...(rng() < 0.1 ? { contractRisk: rng() < 0.5 } : {}),
    ...(rng() < 0.3 ? { contextTokens: Math.floor(rng() * 100000) } : {}),
    ...(rng() < 0.3 ? { outputTokens: Math.floor(rng() * 4000) } : {})
  }));
}
function tenModelCatalog(): ModelRouterConfig {
  const models: CatalogModelInput[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    version: `m${i}-v1`,
    roles: ["actor", "critic"] as const,
    maxComplexity: (i >= 7 ? "HIGH" : "MEDIUM") as TaskComplexity,
    estimatedCostUsd: 0.05 * (i + 1),
    estimatedDurationMs: 500 * (i + 1),
    approvedForHighRisk: i >= 8
  }));
  return { policyVersion: "sim-r4b", models };
}
const conclusions: string[] = [];

/* ============================================================
 * Aggregate ceiling: total slice cost per eval run at the largest realistic
 * caller scale (adaptation/eval-routing.ts: assignTasks x2 at N=episodes).
 * ============================================================ */
{
  const catalog2 = catalogFromPrimary({ primaryModelId: "premium" });
  const catalog10 = tenModelCatalog();
  const tasks = genTasks(mulberry32(0xb44b01), 2000);
  const totalM2 = bench(() => assignTasks({ catalog: catalog2, tasks }), 30);
  const totalM10 = bench(() => assignTasks({ catalog: catalog10, tasks }), 30);
  const analyzeOnly = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role);
  }, 30);
  console.log(
    `ceiling eval-replay N=2000: assignTasks M=2 ${(totalM2 * 1e3).toFixed(1)}us | M=10 ${(totalM10 * 1e3).toFixed(1)}us | analyzeTask share ${(analyzeOnly * 1e3).toFixed(1)}us (${((analyzeOnly / totalM2) * 100).toFixed(0)}%)`
  );
  console.log(
    `ceiling per eval run (x2 calls): M=2 total=${(totalM2 * 2).toFixed(2)}ms | M=10 total=${(totalM10 * 2).toFixed(2)}ms | analyzeTask total=${(analyzeOnly * 2).toFixed(2)}ms`
  );
  const stress = genTasks(mulberry32(0xb44b01), 20000);
  const stressM2 = bench(() => assignTasks({ catalog: catalog2, tasks: stress }), 5);
  console.log(
    `ceiling 10x stress N=20000: assignTasks M=2 ${stressM2.toFixed(1)}ms per call (${(stressM2 * 2).toFixed(1)}ms per eval x2)`
  );
  const cli = genTasks(mulberry32(0xb44b01), 30);
  const cliM2 = bench(() => assignTasks({ catalog: catalog2, tasks: cli }), 2000);
  console.log(`ceiling CLI live face N=30: assignTasks M=2 ${(cliM2 * 1e3).toFixed(1)}us per call`);
}

/* ============================================================
 * S4-B-1: analyze-task 7-regex priority chain -> single-scan multi-pattern
 * classifier. Naive form (one combined alternation, first-group-wins per
 * match) is NOT equivalent: HIGH_RISK and the deploy check share tokens
 * (deploy/production/prod), so a token consumed by the HIGH_RISK branch
 * never sets the deploy flag. Divergence witness + corpus divergence rate.
 * ============================================================ */
{
  const COMBINED =
    /\b(?:(deploy(?:ing|ment|s)?|production|prod|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(?:table|database)|privilege\s+escalat\w*)|(review|audit|critique|nits?)|(tests?|spec|coverage|qa|verify|validation)|(plan|decompos|roadmap|break down|design)|(survey|research|investigat|scout|explor|compar)|(refactor|cleanup|rename|extract)|(implement|add |fix |integrate|migrate|write |build )|(deploy|production|prod))\b/gi;
  const ROLE_FAMILY: Record<AgentRole, string> = {
    worker: "edit", scout: "research", planner: "plan", implementer: "edit",
    reviewer: "review", tester: "test", debugger: "edit"
  };
  function naiveSingleScanFamily(text: string, role: AgentRole): string {
    let highRisk = false, review = false, test = false, plan = false,
      research = false, refactor = false, implement = false, deploy = false;
    COMBINED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COMBINED.exec(text)) !== null) {
      if (m[1] !== undefined) highRisk = true;
      else if (m[2] !== undefined) review = true;
      else if (m[3] !== undefined) test = true;
      else if (m[4] !== undefined) plan = true;
      else if (m[5] !== undefined) research = true;
      else if (m[6] !== undefined) refactor = true;
      else if (m[7] !== undefined) implement = true;
      else if (m[8] !== undefined) deploy = true;
      if (m.index === COMBINED.lastIndex) COMBINED.lastIndex += 1;
    }
    if (highRisk && deploy) return "deploy";
    if (plan || role === "planner") return "plan";
    if (research || role === "scout") return "research";
    if (test || role === "tester") return "test";
    if (review || role === "reviewer") return "review";
    if (refactor) return "refactor";
    if (implement || role === "implementer" || role === "worker") return "edit";
    return ROLE_FAMILY[role] ?? "unknown";
  }
  const witnessText = "Deploy payment credentials to production";
  const cur = analyzeTask(witnessText, "worker").family;
  const naive = naiveSingleScanFamily(witnessText.trim(), "worker");
  const witnessDiverges = cur !== naive;
  check("S4-B-1 naive single-scan divergence witness", witnessDiverges);
  console.log(
    `S4-B-1 witness "${witnessText}": current family=${cur} naive-single-scan=${naive} -> diverges=${witnessDiverges}`
  );
  const rng = mulberry32(0xb44b02);
  let divergent = 0;
  const trials = 8000;
  for (let trial = 0; trial < trials; trial += 1) {
    const objective = genObjective(rng);
    const role = pick(rng, ROLES);
    if (analyzeTask(objective, role).family !== naiveSingleScanFamily(objective.trim(), role)) divergent += 1;
  }
  console.log(
    `S4-B-1 corpus divergence: ${divergent}/${trials} trials (${((divergent / trials) * 100).toFixed(1)}%) -> naive form is NOT equivalent; a correct form needs per-token multi-category membership (hand-rolled scanner, S3-B-5 domain)`
  );
  conclusions.push(`S4-B-1 naive-diverges=${witnessDiverges} corpus-divergent>0=${divergent > 0}`);
}

/* ============================================================
 * S4-B-2: evaluateCandidate constraint dependency factoring — precompute the
 * request-invariant failure slice per model (provider-policy is the only
 * fully model-invariant constraint), evaluate the rest per request.
 * Replica fidelity is checked against the real evaluateCandidate first.
 * ============================================================ */
function evaluateCandidateReplica(model: ModelDescriptor, request: RouteRequest) {
  const fails: ConstraintFailure[] = [];
  if (model.providerPolicy === "forbidden") {
    fails.push({ modelId: model.modelId, constraint: "provider-policy", detail: `provider ${model.providerId} is not approved` });
  }
  if (!satisfiesPrivacy(model, request.privacyRequired)) {
    fails.push({
      modelId: model.modelId,
      constraint: "privacy-class",
      detail:
        model.privacyClass === undefined
          ? `undeclared privacy class cannot serve ${request.privacyRequired}`
          : `${model.privacyClass} cannot serve ${request.privacyRequired}`
    });
  }
  for (const capability of request.requiredCapabilities) {
    if (!hasCapability(model, capability)) {
      fails.push({ modelId: model.modelId, constraint: "capability", detail: `capability not declared: ${capability}` });
      break;
    }
  }
  if (model.contextWindow !== undefined && model.contextWindow < request.contextNeeded) {
    fails.push({ modelId: model.modelId, constraint: "context-window", detail: `${model.contextWindow} < ${request.contextNeeded}` });
  }
  if (model.maxOutputTokens !== undefined && model.maxOutputTokens < request.outputNeeded) {
    fails.push({ modelId: model.modelId, constraint: "max-output", detail: `${model.maxOutputTokens} < ${request.outputNeeded}` });
  }
  const useTokens = request.contextNeeded > 0 || request.outputNeeded > 0;
  const cost = useTokens
    ? estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
    : (request.fixedCostUsd ?? estimateCostUsd(model, request.contextNeeded, request.outputNeeded));
  if (cost > request.budgetUsd) {
    fails.push({ modelId: model.modelId, constraint: "budget", detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}` });
  }
  const latency = useTokens
    ? estimateLatencyMs(model, request.outputNeeded)
    : (request.fixedLatencyMs ?? estimateLatencyMs(model, request.outputNeeded));
  if (latency > request.deadlineMs) {
    fails.push({ modelId: model.modelId, constraint: "deadline", detail: `estimated ${latency.toFixed(0)}ms > deadline ${request.deadlineMs}ms` });
  }
  if (request.highRisk && model.approvedForHighRisk !== true) {
    fails.push({ modelId: model.modelId, constraint: "high-risk-approval", detail: "model is not approved for high-risk tasks" });
  }
  return { modelId: model.modelId, eligible: fails.length === 0, failures: fails };
}
function invariantFailuresOf(model: ModelDescriptor): ConstraintFailure[] {
  return model.providerPolicy === "forbidden"
    ? [{ modelId: model.modelId, constraint: "provider-policy", detail: `provider ${model.providerId} is not approved` }]
    : [];
}
function evaluateCandidateFactored(
  model: ModelDescriptor,
  invariant: readonly ConstraintFailure[],
  request: RouteRequest
) {
  const fails: ConstraintFailure[] = invariant.length === 0 ? [] : [...invariant];
  if (!satisfiesPrivacy(model, request.privacyRequired)) {
    fails.push({
      modelId: model.modelId,
      constraint: "privacy-class",
      detail:
        model.privacyClass === undefined
          ? `undeclared privacy class cannot serve ${request.privacyRequired}`
          : `${model.privacyClass} cannot serve ${request.privacyRequired}`
    });
  }
  for (const capability of request.requiredCapabilities) {
    if (!hasCapability(model, capability)) {
      fails.push({ modelId: model.modelId, constraint: "capability", detail: `capability not declared: ${capability}` });
      break;
    }
  }
  if (model.contextWindow !== undefined && model.contextWindow < request.contextNeeded) {
    fails.push({ modelId: model.modelId, constraint: "context-window", detail: `${model.contextWindow} < ${request.contextNeeded}` });
  }
  if (model.maxOutputTokens !== undefined && model.maxOutputTokens < request.outputNeeded) {
    fails.push({ modelId: model.modelId, constraint: "max-output", detail: `${model.maxOutputTokens} < ${request.outputNeeded}` });
  }
  const useTokens = request.contextNeeded > 0 || request.outputNeeded > 0;
  const cost = useTokens
    ? estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
    : (request.fixedCostUsd ?? estimateCostUsd(model, request.contextNeeded, request.outputNeeded));
  if (cost > request.budgetUsd) {
    fails.push({ modelId: model.modelId, constraint: "budget", detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}` });
  }
  const latency = useTokens
    ? estimateLatencyMs(model, request.outputNeeded)
    : (request.fixedLatencyMs ?? estimateLatencyMs(model, request.outputNeeded));
  if (latency > request.deadlineMs) {
    fails.push({ modelId: model.modelId, constraint: "deadline", detail: `estimated ${latency.toFixed(0)}ms > deadline ${request.deadlineMs}ms` });
  }
  if (request.highRisk && model.approvedForHighRisk !== true) {
    fails.push({ modelId: model.modelId, constraint: "high-risk-approval", detail: "model is not approved for high-risk tasks" });
  }
  return { modelId: model.modelId, eligible: fails.length === 0, failures: fails };
}
function genDescriptor(rng: () => number, i: number): ModelDescriptor {
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  return {
    modelId: `m${i}`,
    providerId: rng() < 0.9 ? "prov" : "other",
    version: `v${i}`,
    capabilities: rng() < 0.8 ? ["tool-use"] : [],
    providerPolicy: rng() < 0.85 ? "approved" : "forbidden",
    inputCostPerMTok: Number((rng() * 5).toFixed(2)),
    outputCostPerMTok: Number((rng() * 15).toFixed(2)),
    latencyMsPer1K: 40 + Math.floor(rng() * 100),
    ...(rng() < 0.5 ? { contextWindow: 1000 + Math.floor(rng() * 200000) } : {}),
    ...(rng() < 0.5 ? { maxOutputTokens: 100 + Math.floor(rng() * 16000) } : {}),
    ...(rng() < 0.6 ? { privacyClass: pick(rng, privacy) } : {}),
    ...(rng() < 0.6 ? { approvedForHighRisk: rng() < 0.5 } : {})
  };
}
function genRequest(rng: () => number): RouteRequest {
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  return {
    taskFamily: pick(rng, ["edit", "plan", "test"]),
    privacyRequired: pick(rng, privacy),
    requiredCapabilities: rng() < 0.7 ? ["tool-use"] : [],
    contextNeeded: rng() < 0.3 ? 0 : Math.floor(rng() * 150000),
    outputNeeded: rng() < 0.3 ? 0 : Math.floor(rng() * 8000),
    budgetUsd: rng() < 0.2 ? 0.0001 : Number((rng() * 2).toFixed(4)),
    deadlineMs: rng() < 0.2 ? 10 : Math.floor(rng() * 600000),
    highRisk: rng() < 0.4,
    ...(rng() < 0.4 ? { fixedCostUsd: Number((rng() * 1).toFixed(3)) } : {}),
    ...(rng() < 0.4 ? { fixedLatencyMs: Math.floor(rng() * 8000) } : {})
  };
}
{
  const rng = mulberry32(0xb44b03);
  let allEqual = true;
  for (let trial = 0; trial < 5000; trial += 1) {
    const model = genDescriptor(rng, trial % 10);
    const request = genRequest(rng);
    const real = JSON.stringify(evaluateCandidate(model, request));
    const replica = JSON.stringify(evaluateCandidateReplica(model, request));
    const factored = JSON.stringify(evaluateCandidateFactored(model, invariantFailuresOf(model), request));
    if (real !== replica || real !== factored) allEqual = false;
    check("S4-B-2 replica fidelity", real === replica, `trial ${trial}`);
    check("S4-B-2 factored equivalence", real === factored, `trial ${trial}`);
  }
  conclusions.push(`S4-B-2 factored-equal=${allEqual}`);
  // Bench at replay scale: N=2000 tasks x M=2 candidate evaluations.
  const models = [genDescriptor(mulberry32(0xb44b03), 0), genDescriptor(mulberry32(0xb44b04), 1)]
    .map((m) => ({ ...m, providerPolicy: "approved" as const }));
  const invariants = models.map((m) => invariantFailuresOf(m));
  const requests = Array.from({ length: 2000 }, () => genRequest(rng));
  const cur = bench(() => {
    for (const request of requests) for (const model of models) evaluateCandidateReplica(model, request);
  }, 30);
  const fac = bench(() => {
    for (const request of requests) {
      for (let i = 0; i < models.length; i += 1) evaluateCandidateFactored(models[i]!, invariants[i]!, request);
    }
  }, 30);
  console.log(
    `S4-B-2 bench N=2000 M=2 (4000 evals): current=${(cur * 1e3).toFixed(1)}us factored=${(fac * 1e3).toFixed(1)}us delta=${((cur - fac) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S4-B-3: shared frozen empty-failures singleton on the success path.
 * The current contract keeps candidates[i].failures as distinct array
 * objects; a shared singleton is an observable identity change.
 * ============================================================ */
{
  const config: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-sim-r4b" };
  const models: ModelDescriptor[] = [0, 1].map((i) => ({
    modelId: `m${i}`,
    providerId: "prov",
    version: `v${i}`,
    capabilities: ["tool-use"],
    providerPolicy: "approved",
    inputCostPerMTok: 0.5 + i,
    outputCostPerMTok: 1.5 + i,
    latencyMsPer1K: 80
  }));
  const request: RouteRequest = {
    taskFamily: "edit",
    privacyRequired: "cloud-general",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 50000,
    outputNeeded: 2000,
    budgetUsd: 10,
    deadlineMs: 600000,
    highRisk: false
  };
  const decision = routeR0(config, models, request);
  const bothEligible = decision.candidates.every((c) => c.eligible);
  const distinct = decision.candidates[0]!.failures !== decision.candidates[1]!.failures;
  check("S4-B-3 current contract: eligible failures arrays distinct", bothEligible && distinct);
  console.log(
    `S4-B-3: both eligible=${bothEligible}; candidates[0].failures !== candidates[1].failures = ${distinct} -> a shared frozen [] singleton flips this to false (observable identity change, S1-A-7/S1-B-8 precedent)`
  );
  conclusions.push(`S4-B-3 current-distinct=${distinct}`);
}

/* ============================================================
 * S4-B-4: assignPlanned passes the task object directly as
 * AnalyzeTaskOptions instead of building a conditional-spread options object.
 * ============================================================ */
function analyzeViaOptions(task: AssignableTask): TaskAnalysis {
  return analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
}
function analyzeDirect(task: AssignableTask): TaskAnalysis {
  return analyzeTask(task.objective, task.role, task as AnalyzeTaskOptions);
}
{
  const rng = mulberry32(0xb44b05);
  let allEqual = true;
  for (let trial = 0; trial < 8000; trial += 1) {
    const base = genTasks(rng, 1)[0]!;
    // Stress explicit-undefined properties: present key, undefined value.
    const task: AssignableTask = rng() < 0.25
      ? { ...base, contractRisk: undefined, contextTokens: undefined }
      : base;
    const cur = JSON.stringify(analyzeViaOptions(task));
    const cand = JSON.stringify(analyzeDirect(task));
    if (cur !== cand) allEqual = false;
    check("S4-B-4 equivalence", cur === cand, JSON.stringify(task));
  }
  conclusions.push(`S4-B-4 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb44b05), 2000);
  const cur = bench(() => {
    for (const task of tasks) analyzeViaOptions(task);
  }, 30);
  const cand = bench(() => {
    for (const task of tasks) analyzeDirect(task);
  }, 30);
  console.log(
    `S4-B-4 bench N=2000: options-object=${(cur * 1e3).toFixed(1)}us direct-task=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

/* ============================================================
 * S4-B-5: shared mutable route-input skeleton across the assignTasks batch
 * (assign-layer sibling of the excluded S3-B-6). The router does not retain
 * the input object, so values are expected to match; the candidate is
 * adjudicated on benefit size and alias hazard.
 * ============================================================ */
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };
function freshInput(
  plan: AssignmentPolicyPlan,
  task: AssignableTask,
  analysis: TaskAnalysis,
  allowedModels: readonly string[],
  preferredModel: string,
  limits: RoutingLimits
): RouteTaskInput {
  return {
    taskId: task.taskId,
    role: flowchartRoleForAgentRole(task.role),
    complexity: analysis.complexity,
    modelPolicy: { allowedModels, preferredModel },
    approvalRequired: analysis.highRisk,
    highRisk: analysis.highRisk,
    family: analysis.family,
    featureVersion: ASSIGN_FEATURE_VERSION,
    agentRole: task.role,
    requiredCapabilities: analysis.requiredCapabilities,
    ...(analysis.contextTokens !== undefined ? { contextNeeded: analysis.contextTokens } : {}),
    ...(analysis.outputTokens !== undefined ? { outputNeeded: analysis.outputTokens } : {}),
    limits
  };
}
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const ids = catalog.models.map((m) => m.id);
  const plan = planAssignmentPolicy(router.config.models, ids);
  interface MutableSkeleton {
    taskId: TaskId;
    role: ReturnType<typeof flowchartRoleForAgentRole>;
    complexity: TaskComplexity;
    modelPolicy: { allowedModels: readonly string[]; preferredModel: string };
    approvalRequired: boolean;
    highRisk: boolean;
    family: string;
    featureVersion: string;
    agentRole: AgentRole;
    requiredCapabilities: readonly string[];
    contextNeeded: number | undefined;
    outputNeeded: number | undefined;
    limits: RoutingLimits;
  }
  const skeleton: MutableSkeleton = {
    taskId: "tsk_skel" as TaskId,
    role: "actor",
    complexity: "MEDIUM",
    modelPolicy: { allowedModels: [], preferredModel: "" },
    approvalRequired: false,
    highRisk: false,
    family: "unknown",
    featureVersion: ASSIGN_FEATURE_VERSION,
    agentRole: "worker",
    requiredCapabilities: [],
    contextNeeded: undefined,
    outputNeeded: undefined,
    limits: DEFAULT_LIMITS
  };
  function skeletonRoute(task: AssignableTask, analysis: TaskAnalysis, allowedModels: readonly string[], preferredModel: string) {
    skeleton.taskId = task.taskId;
    skeleton.role = flowchartRoleForAgentRole(task.role);
    skeleton.complexity = analysis.complexity;
    skeleton.modelPolicy.allowedModels = allowedModels;
    skeleton.modelPolicy.preferredModel = preferredModel;
    skeleton.approvalRequired = analysis.highRisk;
    skeleton.highRisk = analysis.highRisk;
    skeleton.family = analysis.family;
    skeleton.agentRole = task.role;
    skeleton.requiredCapabilities = analysis.requiredCapabilities;
    skeleton.contextNeeded = analysis.contextTokens;
    skeleton.outputNeeded = analysis.outputTokens;
    return router.route(skeleton as RouteTaskInput);
  }
  const outcome = (fn: () => unknown): string => {
    try {
      return JSON.stringify(fn());
    } catch (error) {
      return `THROW:${(error as Error).message}`;
    }
  };
  const rng = mulberry32(0xb44b06);
  let allEqual = true;
  for (let trial = 0; trial < 3000; trial += 1) {
    const task = genTasks(rng, 1)[0]!;
    const analysis = analyzeViaOptions(task);
    const allowedModels = [...plan.allowedIds];
    const preferredModel = pickPreferredModel(plan, analysis, undefined);
    const cur = outcome(() => router.route(freshInput(plan, task, analysis, allowedModels, preferredModel, DEFAULT_LIMITS)));
    const cand = outcome(() => skeletonRoute(task, analysis, allowedModels, preferredModel));
    if (cur !== cand) allEqual = false;
    check("S4-B-5 equivalence", cur === cand, task.taskId);
  }
  conclusions.push(`S4-B-5 equal=${allEqual}`);
  const tasks = genTasks(mulberry32(0xb44b06), 2000);
  const prepared = tasks.map((task) => {
    const analysis = analyzeViaOptions(task);
    return { task, analysis, allowedModels: [...plan.allowedIds], preferredModel: pickPreferredModel(plan, analysis, undefined) };
  });
  const cur = bench(() => {
    for (const p of prepared) router.route(freshInput(plan, p.task, p.analysis, p.allowedModels, p.preferredModel, DEFAULT_LIMITS));
  }, 30);
  const cand = bench(() => {
    for (const p of prepared) skeletonRoute(p.task, p.analysis, p.allowedModels, p.preferredModel);
  }, 30);
  console.log(
    `S4-B-5 bench N=2000 (route-only): fresh-input=${(cur * 1e3).toFixed(1)}us skeleton=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us per batch`
  );
}

console.log(`\nCONCLUSIONS: ${conclusions.join(" | ")}`);
if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

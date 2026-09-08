# R1-B：live 路由切片 SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-B（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `94ed3d9`
**分支:** `cursor/r1-b-live-routing-slice-c9b5`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** main 上已合入的三个重构（ModelRouter 纯
selection、catalog-invariant assignment plan、live request 直进共享约束矩阵）之后，
本切片每个函数都已处于其**输出契约所要求的渐近下界**（§2）。以新视角逐文件重新
枚举，得到 8 个此前排除表未点名的候选（S1-B-1 … S1-B-8），全部经理论 + 确定性
仿真（seeded mulberry32，等价性 fuzz + 真实规模基准，三次独立运行方向一致）裁决
后淘汰：5 个等价但真实规模噪声级，1 个理论被仿真推翻（实测更慢），1 个实测零
收益，1 个不等价（可观察对象身份改变）。现状即为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量读码；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts` 只读取证，一行未改。
- 遵守排除表：X1-4（r1 换 Map）、X3-1（assign 目录重过滤索引化）、X4-4、X4-5 全部
  未触碰；Iter4 逐文件否决表（r0 高风险 O(E×M)、analyze-task 正则重复、model-router
  每次 route 的 Set/过滤、live-cascade byId 比较器、policy 单遍矩阵、catalog-model、
  primary-catalog）未以原方案重开——本轮仅对其中两项以**新证据等级**（确定性仿真）
  作正式化裁决并立 ID（S1-B-1、S1-B-6），结论与原否决同向且更强。
- R1/posterior/offline-*（R1-C 区）未碰；live 保持 R0 等价，R1 未接线：
  `live-isolation` 3/3 绿（§7）。
- 公开 API、决策对象 schema（RoutingDecision/R0Decision/TaskAssignment）、refusal
  消息优先级、tie-break 语义全部不变——零 diff，天然满足。

## 1. 现实规模测量（门槛第 3 条的证据基底）

切片的三个现实入口与规模（读码 + 确定性 profile 实测）：

- **目录规模 M**：`catalogFromPrimary` 生产 1–2 模型；全库上界 ~10（Iter 系列共识）。
- **live 面**：CLI `--children` / `track/primary-split` 每次调 `assignTasks` 一次，
  N=任务数（个位数到几十）；`decideLiveCascade` 每个 child 结果一次，tier 数个位数。
- **最大现实规模入口**：`adaptation/eval-routing.ts` 回放对 N=episodes 调
  `assignTasks` **2 次**（baseline+candidate），N 为数据集级（几百到几千）。

```text
profile CLI-scale N=30:      assignTasks M=2 66.0us | M=10 126.5us | analyzeTask share 14.1us (21%)
profile eval-replay N=2000:  assignTasks M=2 4734.5us | M=10 10373.9us | analyzeTask share 1260.7us (27%)
10x stress N=20000:          assignTasks=57.0ms  analyzeTask-share=13.6ms
route() anchor M=2:          route=1468ns; toModelDescriptor for the whole catalog=237ns (16%)
```

即：live 面每次调用是**几十微秒**级；最大现实规模（eval 回放）是**个位数毫秒**级、
每次 eval 一次性；单任务成本 ~2.3µs，其中 analyzeTask 正则 ~27%、route() ~73%
（后者大头是决策对象构造，即输出本身）。

## 2. 结构下界论证（为什么渐近层面没有余地）

| 函数 | 下界论证 |
| --- | --- |
| `routeR0` / `cheapFirstTiers` | 排序结果就是公开输出（`fallbacks` / `tiers` 是有序 tier 列表）→ Ω(M log M) 不可省 |
| `evaluateCandidate` / `partitionLiveCandidates` | 全约束独立评估 + 全 failure 保留是「rejection matrix 可归因、nothing dropped silently」契约本体 → 禁止早退，Θ(M×约束数) 即下界 |
| `selectLiveModel` | 已是单遍 min（main 重构落地），Ω(E) 下界 |
| `assignTasks` | 批不变量已由 `planAssignmentPolicy` 提为 per-batch（main 重构落地）；剩余为 Θ(N×单任务) |
| `analyzeTask` / `familyOf` | 正则优先级链自带早退；唯一冗余是 HIGH_RISK_RE 双求值（S1-B-1，噪声） |
| `applyCascade` / `decideLiveCascade` | plan 是 readonly 数组公开类型，定位当前 tier Ω(T)；T 个位数 |
| `catalogModel` / `toModelDescriptor` / `oneHotDistribution` / `primary-catalog` | 纯构造 Θ(字段数)，models ≤2 |
| `buildDecision` / `makeApprovalPlan` | justification/approvalPlan/behaviorDistribution 是事件契约输出本身，不可削减 |

结论：剩余全部候选只能是 M≤10 / T≤10 / 短文本尺度上的常数因子与分配削减——
正是战役已反复裁决为噪声的类别。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-B-1 | `analyze-task.ts` 去重 HIGH_RISK_RE 求值（analyzeTask+familyOf 共享一次）+ DEPLOY_RE 提升模块常量 | 每任务省 1 次正则 + 1 次正则字面量分配 | ✅ 12000 fuzz 逐字节一致 | 省 ~30–60ns/任务（665→604ns） | 淘汰：噪声 |
| S1-B-2 | `long` 判定换免分配的手写 `\n` 计数早退（替代 `match(/\n/g)`） | 免 match 数组分配 + 第 3 个换行即退 | ✅ 12000 fuzz（捆绑） | 现实目标为短单行文本，亚噪声 | 淘汰：噪声 |
| S1-B-3 | `familyOf` 布尔短路重排（role 判定先于正则；同一 `\|\|` 分支内纯布尔可交换，分支间优先级不变） | 角色命中的任务免 1 次正则 | ✅ 12000 fuzz（捆绑） | planner 例 329→253ns（捆绑值） | 淘汰：噪声 |
| 1+2+3 捆绑 | 上述三项合并 | analyzeTask 常数 ~20% | ✅ | N=2000 回放省 284µs/call（占 assignTasks 6%）；10× N=20000 也仅 ~2.7ms/call | 淘汰：见 §4.1 |
| S1-B-4 | `decideLiveCascade` 开头 `find` 与 escalate 路径 `findIndex` 合并单扫 | 2 次 O(T) 扫→1 次 | ✅ 8000 fuzz（全 source×kind×failureClass×ghost-tier） | T=10 省 ~30ns；每 child 结果一次 | 淘汰：噪声 |
| S1-B-5 | `cheapFirstTiers` 冗余 `[...eligibleIds]` spread 移除（filter 本就返回新数组） | 免 1 次数组分配 | ✅ 5000 fuzz（含空 version/ghost id） | T=10 省 ~45ns | 淘汰：噪声 |
| S1-B-6 | `routeR0` 高风险审批过滤 `models.find` 换预建 id→model Map | O(E×M)→O(E+M) | ✅ 5000 fuzz（全 R0Decision 逐字节） | **实测更慢**：2142→2488ns（M=10 高风险） | 淘汰：理论被仿真推翻，S1-A-4 同类反例 |
| S1-B-7 | `validateInput` 的 `["LOW","MEDIUM","HIGH"]` 字面量提升模块常量 | 免每 route 1 次 3 元数组分配 | —（平凡等价） | 实测无差（35.4 vs 35.1ns；V8 已优化只读字面量） | 淘汰：零收益 |
| S1-B-8 | `assignPlanned` 省略 `[...plan.allowedIds]` 防御拷贝 | 免每任务 1 次数组拷贝 | ❌ 身份论证 | — | 淘汰：不等价。跨 assignment 共享引用，`a1.allowedModels === a2.allowedModels` 由 false 变 true，可观察身份改变（S1-A-7 先例） |

## 4. 关键裁决细节

### 4.1 捆绑候选（最强）为何仍淘汰

三项 analyzeTask 微优化在 12000 组 fuzz（真实语料模板 + 关键词碎片混合 + 长文本
+ 中文 + 空串 × 7 角色 × 全 options 组合）上逐字节等价，捆绑后 analyzeTask 常数
下降 ~20%。但换算到入口规模：

- live 面（CLI N≤30）：每次调用省 ~3µs——低于一次子进程调度的噪声底。
- 最大现实规模（eval 回放 N=2000，每次 eval 调 2 次）：省 ~0.57ms/eval，占
  assignTasks 路径 6%、占整个 eval 管道（数据集载入/隔离守卫/哈希/报告）<1%。
- 10× 压力（N=20000，已超现实数据集一个量级）：~5.4ms/eval。

对比战役内赢家的量级（Iter3 H1：单次回放省 522ms、6.9×），1.05× 常数因子在
一次性离线路径上是门槛第 3 条定义的噪声；而改动落在 live 面文件上，回归风险
非零。收益/风险裁决：不动。若未来 eval 数据集增长 ≥2 个量级或 analyzeTask 进入
每 turn 热路径，可凭本报告等价性证据重开。

### 4.2 S1-B-6 的反向教训（本切片的 S1-A-4）

高风险路径 `eligible.filter(c => models.find(...))` 纸面 O(E×M)→O(E+M) 必赚，但
M=10 时 `new Map(models.map(...))` 的构建成本高于 10×10 次短数组线性 find：
2142ns→2488ns，**全面变慢**。与 R1-A 的 S1-A-4（个位数组 Set 化更慢）构成同一
教训的第二例：目录尺度上索引结构的固定开销 > 线性扫描。Iter4 对此文件的按理论
否决（噪声）经仿真后升级为「负优化」，排除更牢。

### 4.3 S1-B-8 的不等价论证

当前每个 `TaskAssignment.allowedModels` 是独立数组对象（仿真验证
`assignments[i].allowedModels !== assignments[j].allowedModels` 恒 true）。省略
拷贝后所有无 learned 覆盖的 assignment 共享 `plan.allowedIds` 同一引用——对象
身份是可观察行为（S1-A-7 先例），且一旦任何调用方原地排序/变异该数组即跨任务
污染。不满足「仿真可证一致」，直接淘汰。

### 4.4 toModelDescriptor 的 16% 为何无路可走

route() 内每 (任务, 模型) 调一次 `toModelDescriptor`（M=2 时占 route 16%）。三条
消除路线全部撞已有排除：模块级/WeakMap 缓存是 X1-1；给 `evaluateLiveCandidate`
加预建 descriptor 参数是公开签名改动 + X1-2 类平行入口；在 model-router 内联约束
检查绕开共享矩阵，与 main 刚合入的「live request 直进共享约束矩阵」重构方向相反
（policy.ts L154-156 的注释就是防这个）。架构裁决：保持现状。

## 5. 逐文件收口

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `r0.ts` | `eligibleCandidates` 内 `estimateCostUsd` 与 `evaluateCandidate` 内部的预算成本并非恒等重复（fixedCostUsd 分叉时量不同），合并需跨签名改动且为 2 次乘加，噪声；高风险 Map 化见 S1-B-6；`applyCascade` O(T) 为下界 | 无候选 |
| `assign.ts` | 批不变量已提升（main 重构）；`assignOne` 每调重算 plan 是单任务入口语义本体；防御拷贝见 S1-B-8；eval-routing 双 policy 调用间 analysis 复用属跨切片 API 变更（X1-1/X1-2 域），记录不改 | 无候选 |
| `policy.ts` | 全约束独立评估为契约下界；`merged` 双 spread 在空失败集时的分配为亚噪声；共享矩阵注释（L154-156）为架构护栏，不动 | 无候选 |
| `live-cascade.ts` | S1-B-4/5 淘汰；比较器内 `byId.get` 已被 Iter1 S7 否决不重开；`liveCascadePlanFromAssignment`/`evidenceFromTaskResult` 平凡 | 无候选 |
| `analyze-task.ts` | S1-B-1/2/3 淘汰（捆绑亦淘汰，§4.1）；正则链顺序即优先级语义，不可重排分支间顺序 | 无候选 |
| `primary-catalog.ts` | 纯构造 ≤2 模型；`modelFor`/`inferFastId` 常数 | 无候选 |
| `catalog-model.ts` | 纯构造 Θ(字段)；`oneHotDistribution` O(E) 单遍即下界 | 无候选 |
| `supervisor/model-router.ts` | S1-B-7 淘汰；`partitionLiveCandidates` 全评估为契约（§2）；per-model request 字面量为 fixedCostUsd/fixedLatencyMs 所需；`toModelDescriptor` 见 §4.4；`validateConfig`/`effectiveConfidenceThreshold` 一次性/常数 | 无候选 |

## 6. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 7. 测试

零代码改动下相关套件基线复核，全绿：

```bash
npx tsx --test "test/unit/routing/*.test.ts" "test/unit/supervisor/*.test.ts"
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现）最终一次运行：

```text
S1-B-1/2/3 bench real-edit: current=665ns min=604ns bundle=532ns
S1-B-1/2/3 bench high-risk: current=311ns min=302ns bundle=282ns
S1-B-1/2/3 bench planner: current=329ns min=292ns bundle=253ns
profile CLI-scale N=30: assignTasks M=2 66.0us | M=10 126.5us | analyzeTask share 14.1us (21% of M=2)
profile eval-replay N=2000: assignTasks M=2 4734.5us | M=10 10373.9us | analyzeTask share 1260.7us (27% of M=2)
S1-B bundle at replay scale N=2000: current=1234.0us candidate=950.4us delta=283.6us per assignTasks call
S1-B-4 bench T=2 escalate path: current=316ns cand=290ns
S1-B-4 bench T=10 escalate path: current=304ns cand=276ns
S1-B-5 bench T=10: current=881ns cand=834ns
S1-B-6 bench M=10 high-risk: current=2142ns cand=2488ns
S1-B-7 micro anchor (4 checks): inline-literal=35.4ns hoisted=35.1ns (sink=true)
S1-B-8: current assignments carry distinct allowedModels arrays (true)
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价结论逐位一致，计时抖动内稳定，裁决方向不变
（S1-B-6 三次全部实测更慢；bundle 三次都在 250–284µs/call 区间）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-B-1 | analyze-task 去重 HIGH_RISK_RE 求值 + DEPLOY_RE 提升模块常量 | 等价但省 ~30–60ns/任务，噪声 |
| S1-B-2 | analyze-task `long` 换手写 `\n` 计数早退 | 现实目标短单行，亚噪声 |
| S1-B-3 | familyOf 同分支布尔短路重排（role 先于正则） | 等价但噪声；捆绑 1+2+3 在最大现实规模（eval 回放 ×2）也仅 ~0.57ms/eval |
| S1-B-4 | decideLiveCascade find+findIndex 合并单扫 | 等价但 T≤10 省 ~30ns，噪声 |
| S1-B-5 | cheapFirstTiers 冗余 spread 移除 | 等价但省 1 次分配 ~45ns，噪声 |
| S1-B-6 | routeR0 高风险审批过滤 Map 索引化 | 不劣化伪装：等价但 M=10 实测更慢（2142→2488ns），目录尺度 Map 构建 > 线性 find（S1-A-4 同类） |
| S1-B-7 | model-router validateInput 复杂度数组字面量提升 | 实测零收益（V8 已优化） |
| S1-B-8 | assignPlanned allowedIds 防御拷贝省略 | 不等价：跨 assignment 共享引用，可观察对象身份改变（S1-A-7 先例）+ 变异污染风险 |

重开条件：S1-B-1/2/3 若 eval 数据集规模增长 ≥2 个量级或 analyzeTask 进入每 turn
热路径，可凭本报告 12000-fuzz 等价证据重开；S1-B-4/5/7 需先给出非噪声场景；
S1-B-6/8 需先推翻本报告的基准/身份论证。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb11b01`–`0xb11b06`。第二脚本为 10× 压力与 route() 构成锚点。

### 脚本 1：候选裁决主仿真

```ts
/**
 * R1-B deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-B-1 .. S1-B-8 against the current live
 * routing slice: analyze-task / assign / model-router / live-cascade / r0.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb11b01-0xb11b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask, type AnalyzeTaskOptions, type TaskAnalysis } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { catalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import {
  cheapFirstTiers,
  decideLiveCascade,
  type LiveCascadeDecision,
  type LiveCascadePlan
} from "/workspace/src/routing/live-cascade.js";
import { resolveEvidenceCascade, type CascadeEvidence } from "/workspace/src/routing/cascade-evidence.js";
import { routeR0, type R0Config } from "/workspace/src/routing/r0.js";
import { evaluateCandidate, type RouteRequest } from "/workspace/src/routing/policy.js";
import { estimateCostUsd, type ModelDescriptor, type PrivacyClass } from "/workspace/src/routing/capability-registry.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { FailureClass } from "/workspace/src/routing/outcomes.js";
import type { ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
import type { TaskFamily } from "/workspace/src/task/taxonomy.js";
import type { TaskComplexity } from "/workspace/src/domain/flowchart.js";

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

/* Realistic objective corpus: repo-test-style sentences plus keyword mixers. */
const OBJECTIVE_TEMPLATES = [
  "Survey the payment module",
  "Plan the checkout migration",
  "Run the unit tests",
  "Deploy payment credentials to production",
  "Document how to delete a cache key and describe auth headers",
  "Implement retry logic for the ledger sync",
  "Review the audit log formatting nits",
  "Refactor and rename the tracking roller",
  "Fix the flaky spec for gate transitions",
  "Research and compare vector store options",
  "Add coverage for the routing refusal path",
  "Investigate why the drop table migration failed in prod",
  "Design a roadmap to break down the supervisor rewrite",
  "Write build scripts and integrate the release pipeline",
  "验证路由细节并补充测试",
  ""
];
const FRAGMENTS = [
  "deploy", "production", "credentials", "secrets", "review", "audit", "tests",
  "coverage", "plan", "design", "survey", "research", "refactor", "rename",
  "implement", "add ", "fix ", "migrate", "critique", "qa", "verify", "\n",
  "the module", "for the ledger", "and document it", "碎片", " "
];

function genObjective(rng: () => number): string {
  const roll = rng();
  if (roll < 0.5) return pick(rng, OBJECTIVE_TEMPLATES);
  let text = "";
  const parts = 1 + Math.floor(rng() * 10);
  for (let i = 0; i < parts; i += 1) text += pick(rng, FRAGMENTS) + " ";
  if (rng() < 0.1) text = text.repeat(1 + Math.floor(rng() * 8)); // long objectives
  return text;
}

function genOptions(rng: () => number): AnalyzeTaskOptions {
  return {
    ...(rng() < 0.3 ? { contractRisk: rng() < 0.5 } : {}),
    ...(rng() < 0.3 ? { contextTokens: Math.floor(rng() * 200000) } : {}),
    ...(rng() < 0.3 ? { outputTokens: Math.floor(rng() * 8000) } : {}),
    ...(rng() < 0.2 ? { requiredCapabilities: rng() < 0.5 ? ["tool-use"] : ["tool-use", "vision"] } : {}),
    ...(rng() < 0.2 ? { hasTests: rng() < 0.5 } : {}),
    ...(rng() < 0.2 ? { ownershipRestricted: rng() < 0.5 } : {})
  };
}

/* ============================================================
 * Candidate replicas for S1-B-1/2/3 (analyze-task.ts)
 * S1-B-1: single HIGH_RISK_RE evaluation shared by analyzeTask+familyOf,
 *         DEPLOY_RE hoisted to module scope.
 * S1-B-2: `long` newline count via handwritten early-exit scan.
 * S1-B-3: familyOf boolean short-circuit reorder (role before regex).
 * candidateAnalyzeMin  = S1-B-1 only.
 * candidateAnalyzeFull = S1-B-1 + S1-B-2 + S1-B-3 bundle.
 * ============================================================ */
const HIGH_RISK_RE =
  /\b(deploy(?:ing|ment|s)?|production|prod|credentials?|secrets?|privileged?|rm\s+-[a-z]*|drop\s+(table|database)|privilege\s+escalat\w*)\b/i;
const REVIEW_RE = /\b(review|audit|critique|nits?)\b/i;
const TEST_RE = /\b(tests?|spec|coverage|qa|verify|validation)\b/i;
const PLAN_RE = /\b(plan|decompos|roadmap|break down|design)\b/i;
const RESEARCH_RE = /\b(survey|research|investigat|scout|explor|compar)\b/i;
const REFACTOR_RE = /\b(refactor|cleanup|rename|extract)\b/i;
const IMPLEMENT_RE = /\b(implement|add |fix |integrate|migrate|write |build )\b/i;
const DEPLOY_RE = /\b(deploy|production|prod\b)\b/i;

const ROLE_FAMILY: Record<AgentRole, TaskFamily> = {
  worker: "edit",
  scout: "research",
  planner: "plan",
  implementer: "edit",
  reviewer: "review",
  tester: "test",
  debugger: "edit"
};

type ComplexityInput = {
  readonly role: AgentRole;
  readonly family: TaskFamily;
  readonly highRisk: boolean;
  readonly long: boolean;
};

function complexityOf(input: ComplexityInput): TaskComplexity {
  if (input.highRisk || input.family === "deploy") return "HIGH";
  if (input.long) return "MEDIUM";
  if (input.role === "scout" || input.role === "tester") return "LOW";
  if (input.role === "planner" || input.role === "debugger" || input.role === "reviewer") return "MEDIUM";
  if (input.family === "plan" || input.family === "research") return "MEDIUM";
  return "MEDIUM";
}

function finishAnalysis(
  text: string,
  role: AgentRole,
  family: TaskFamily,
  highRisk: boolean,
  long: boolean,
  options: AnalyzeTaskOptions
): TaskAnalysis {
  const complexity = complexityOf({ role, family, highRisk, long });
  const preferPrimary =
    highRisk || complexity === "HIGH" || role === "planner" || role === "debugger" || family === "deploy";
  const requiredCapabilities = options.requiredCapabilities ?? ["tool-use"];
  const reason = [
    `role ${role}`,
    `family ${family}`,
    `${complexity} complexity`,
    highRisk ? "high-risk" : "standard-risk",
    preferPrimary ? "prefer primary model" : "prefer cheapest eligible"
  ].join("; ");
  return {
    family,
    complexity,
    highRisk,
    requiredCapabilities,
    preferPrimary,
    reason,
    ...(options.contextTokens !== undefined ? { contextTokens: options.contextTokens } : {}),
    ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
    ...(options.hasTests !== undefined ? { hasTests: options.hasTests } : {}),
    ...(options.ownershipRestricted !== undefined ? { ownershipRestricted: options.ownershipRestricted } : {})
  };
}

/* S1-B-1 only: dedupe HIGH_RISK_RE, hoisted DEPLOY_RE, rest verbatim. */
function candidateAnalyzeMin(objective: string, role: AgentRole, options: AnalyzeTaskOptions = {}): TaskAnalysis {
  const text = objective.trim();
  const keywordRisk = HIGH_RISK_RE.test(text);
  const family = familyOfMin(text, role, keywordRisk);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : keywordRisk;
  const long = text.length >= 180 || (text.match(/\n/g) ?? []).length >= 3;
  return finishAnalysis(text, role, family, highRisk, long, options);
}

function familyOfMin(text: string, role: AgentRole, keywordRisk: boolean): TaskFamily {
  if (keywordRisk && DEPLOY_RE.test(text)) return "deploy";
  if (PLAN_RE.test(text) || role === "planner") return "plan";
  if (RESEARCH_RE.test(text) || role === "scout") return "research";
  if (TEST_RE.test(text) || role === "tester") return "test";
  if (REVIEW_RE.test(text) || role === "reviewer") return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (IMPLEMENT_RE.test(text) || role === "implementer" || role === "worker") return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}

/* S1-B-1+2+3 bundle. */
function candidateAnalyzeFull(objective: string, role: AgentRole, options: AnalyzeTaskOptions = {}): TaskAnalysis {
  const text = objective.trim();
  const keywordRisk = HIGH_RISK_RE.test(text);
  const family = familyOfFull(text, role, keywordRisk);
  const highRisk = options.contractRisk !== undefined ? options.contractRisk : keywordRisk;
  const long = text.length >= 180 || hasThreeNewlines(text);
  return finishAnalysis(text, role, family, highRisk, long, options);
}

function hasThreeNewlines(text: string): boolean {
  let count = 0;
  let index = text.indexOf("\n");
  while (index !== -1) {
    count += 1;
    if (count >= 3) return true;
    index = text.indexOf("\n", index + 1);
  }
  return false;
}

function familyOfFull(text: string, role: AgentRole, keywordRisk: boolean): TaskFamily {
  if (keywordRisk && DEPLOY_RE.test(text)) return "deploy";
  if (role === "planner" || PLAN_RE.test(text)) return "plan";
  if (role === "scout" || RESEARCH_RE.test(text)) return "research";
  if (role === "tester" || TEST_RE.test(text)) return "test";
  if (role === "reviewer" || REVIEW_RE.test(text)) return "review";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (role === "implementer" || role === "worker" || IMPLEMENT_RE.test(text)) return "edit";
  return ROLE_FAMILY[role] ?? "unknown";
}

{
  const rng = mulberry32(0xb11b01);
  for (let trial = 0; trial < 12000; trial += 1) {
    const objective = genObjective(rng);
    const role = pick(rng, ROLES);
    const options = genOptions(rng);
    const expected = JSON.stringify(analyzeTask(objective, role, options));
    check(
      "S1-B-1 equivalence (min)",
      expected === JSON.stringify(candidateAnalyzeMin(objective, role, options)),
      JSON.stringify({ objective, role, options })
    );
    check(
      "S1-B-1/2/3 equivalence (bundle)",
      expected === JSON.stringify(candidateAnalyzeFull(objective, role, options)),
      JSON.stringify({ objective, role, options })
    );
  }
  // S1-B-3 soundness note: inside one `||` branch the operands are pure boolean
  // regex/role tests, so reordering preserves the value; the branch-to-branch
  // priority order is untouched. The 12000-trial fuzz above is the arbiter.
  const realObjective = "Implement retry logic for the ledger sync";
  const riskyObjective = "Deploy payment credentials to production";
  for (const [label, objective, role] of [
    ["real-edit", realObjective, "implementer"],
    ["high-risk", riskyObjective, "implementer"],
    ["planner", "Plan the checkout migration", "planner"]
  ] as const) {
    const cur = bench(() => analyzeTask(objective, role), 40000);
    const min = bench(() => candidateAnalyzeMin(objective, role), 40000);
    const full = bench(() => candidateAnalyzeFull(objective, role), 40000);
    console.log(
      `S1-B-1/2/3 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns min=${(min * 1e6).toFixed(0)}ns bundle=${(full * 1e6).toFixed(0)}ns`
    );
  }
}

/* ============================================================
 * Scale probe: assignTasks profile at CLI scale and eval-replay scale.
 * ============================================================ */
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
  return { policyVersion: "sim-v1", models };
}

{
  const catalog2 = catalogFromPrimary({ primaryModelId: "premium" });
  const catalog10 = tenModelCatalog();
  for (const [label, n, reps] of [["CLI-scale N=30", 30, 2000], ["eval-replay N=2000", 2000, 30]] as const) {
    const tasks = genTasks(mulberry32(0xb11b02), n);
    const totalM2 = bench(() => assignTasks({ catalog: catalog2, tasks }), reps);
    const totalM10 = bench(() => assignTasks({ catalog: catalog10, tasks }), reps);
    const analyzeOnly = bench(() => {
      for (const task of tasks) analyzeTask(task.objective, task.role);
    }, reps);
    console.log(
      `profile ${label}: assignTasks M=2 ${(totalM2 * 1e3).toFixed(1)}us | M=10 ${(totalM10 * 1e3).toFixed(1)}us | analyzeTask share ${(analyzeOnly * 1e3).toFixed(1)}us (${((analyzeOnly / totalM2) * 100).toFixed(0)}% of M=2)`
    );
  }
  // Bundle upper bound at replay scale: delta(analyzeTask) x N.
  const tasks = genTasks(mulberry32(0xb11b02), 2000);
  const curAnalyze = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role);
  }, 50);
  const candAnalyze = bench(() => {
    for (const task of tasks) candidateAnalyzeFull(task.objective, task.role);
  }, 50);
  console.log(
    `S1-B bundle at replay scale N=2000: current=${(curAnalyze * 1e3).toFixed(1)}us candidate=${(candAnalyze * 1e3).toFixed(1)}us delta=${((curAnalyze - candAnalyze) * 1e3).toFixed(1)}us per assignTasks call`
  );
}

/* ============================================================
 * S1-B-4: decideLiveCascade find+findIndex merged single scan.
 * ============================================================ */
function candidateDecide(input: {
  readonly plan: LiveCascadePlan;
  readonly previousModelId: string;
  readonly evidence: CascadeEvidence;
  readonly failureClass?: FailureClass | undefined;
}): LiveCascadeDecision {
  const tiers = input.plan.tiers;
  const index = tiers.findIndex((tier) => tier.modelId === input.previousModelId);
  const current = index >= 0 ? tiers[index] : undefined;
  const stay = (action: LiveCascadeDecision["action"], reason: string): LiveCascadeDecision => ({
    action,
    reason,
    nextModelId: input.previousModelId,
    ...(current !== undefined ? { nextVersion: current.version } : {})
  });
  if (input.evidence.kind === "FAIL" && input.failureClass !== undefined && input.failureClass !== "model") {
    return stay("abstain", `failureClass=${input.failureClass}; cascade skipped`);
  }
  const choice = resolveEvidenceCascade(input.plan.highRisk, input.evidence);
  if (choice.action !== "escalate") {
    return stay(choice.action, choice.reason);
  }
  const successor = index >= 0 ? tiers[index + 1] : undefined;
  if (successor === undefined) {
    return stay("retain", "cascade exhausted; staying on the most expensive eligible tier");
  }
  return {
    action: "escalate",
    reason: `cascade ${input.previousModelId}->${successor.modelId}`,
    nextModelId: successor.modelId,
    nextVersion: successor.version
  };
}

{
  const rng = mulberry32(0xb11b03);
  const sources = ["deterministic-check", "compile", "schema", "acceptance", "critic", "self-report", "none"] as const;
  const kinds = ["PASS", "FAIL", "ABSTAIN"] as const;
  const classes: readonly (FailureClass | undefined)[] = [undefined, "model", "contract", "tool", "environment", "run"];
  for (let trial = 0; trial < 8000; trial += 1) {
    const tierCount = Math.floor(rng() * 6);
    const plan: LiveCascadePlan = {
      highRisk: rng() < 0.2,
      tiers: Array.from({ length: tierCount }, (_, i) => ({ modelId: `m${i}`, version: `m${i}-v1` }))
    };
    const previousModelId = rng() < 0.8 && tierCount > 0 ? `m${Math.floor(rng() * tierCount)}` : "ghost";
    const input = {
      plan,
      previousModelId,
      evidence: { source: pick(rng, sources), kind: pick(rng, kinds) },
      failureClass: pick(rng, classes)
    };
    check(
      "S1-B-4 equivalence",
      JSON.stringify(decideLiveCascade(input)) === JSON.stringify(candidateDecide(input)),
      JSON.stringify(input)
    );
  }
  for (const tierCount of [2, 10]) {
    const plan: LiveCascadePlan = {
      highRisk: false,
      tiers: Array.from({ length: tierCount }, (_, i) => ({ modelId: `m${i}`, version: `m${i}-v1` }))
    };
    const input = {
      plan,
      previousModelId: "m0",
      evidence: { source: "deterministic-check", kind: "FAIL" } as CascadeEvidence,
      failureClass: "model" as FailureClass
    };
    const cur = bench(() => decideLiveCascade(input), 40000);
    const cand = bench(() => candidateDecide(input), 40000);
    console.log(
      `S1-B-4 bench T=${tierCount} escalate path: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns`
    );
  }
}

/* ============================================================
 * S1-B-5: cheapFirstTiers redundant spread removal.
 * ============================================================ */
function candidateCheapFirstTiers(
  eligibleIds: readonly string[],
  models: readonly { readonly id: string; readonly version?: string; readonly estimatedCostUsd: number }[]
) {
  const byId = new Map(models.map((model) => [model.id, model]));
  return eligibleIds
    .filter((id) => {
      const model = byId.get(id);
      return model !== undefined && typeof model.version === "string" && model.version.trim() !== "";
    })
    .sort((left, right) => {
      const cost =
        (byId.get(left)?.estimatedCostUsd ?? Number.POSITIVE_INFINITY) -
        (byId.get(right)?.estimatedCostUsd ?? Number.POSITIVE_INFINITY);
      if (cost !== 0) return cost;
      return left.localeCompare(right);
    })
    .map((id) => {
      const model = byId.get(id)!;
      return { modelId: model.id, version: model.version! };
    });
}

{
  const rng = mulberry32(0xb11b04);
  for (let trial = 0; trial < 5000; trial += 1) {
    const m = 1 + Math.floor(rng() * 10);
    const models = Array.from({ length: m }, (_, i) => ({
      id: `m${i}`,
      ...(rng() < 0.85 ? { version: rng() < 0.9 ? `m${i}-v1` : "  " } : {}),
      estimatedCostUsd: rng() < 0.3 ? 0.1 : Number((rng() * 2).toFixed(3))
    }));
    const eligibleIds = models.filter(() => rng() < 0.7).map((model) => model.id);
    if (rng() < 0.2) eligibleIds.push("ghost");
    check(
      "S1-B-5 equivalence",
      JSON.stringify(cheapFirstTiers(eligibleIds, models)) ===
        JSON.stringify(candidateCheapFirstTiers(eligibleIds, models)),
      JSON.stringify({ eligibleIds, models })
    );
  }
  const models = tenModelCatalog().models.map((model) => ({
    id: model.id,
    version: model.version,
    estimatedCostUsd: model.estimatedCostUsd
  }));
  const eligibleIds = models.map((model) => model.id);
  const cur = bench(() => cheapFirstTiers(eligibleIds, models), 40000);
  const cand = bench(() => candidateCheapFirstTiers(eligibleIds, models), 40000);
  console.log(`S1-B-5 bench T=10: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S1-B-6: routeR0 high-risk approved filter via prebuilt Map.
 * Full replica of routeR0 with id->model Map replacing models.find.
 * ============================================================ */
function candidateRouteR0(config: R0Config, models: readonly ModelDescriptor[], request: RouteRequest) {
  const candidates = models
    .map((model) => {
      const checkResult = evaluateCandidate(model, request);
      return {
        modelId: model.modelId,
        eligible: checkResult.eligible,
        failures: checkResult.failures,
        estimatedCostUsd: estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
      };
    })
    .sort((a, b) => {
      const costDiff = a.estimatedCostUsd - b.estimatedCostUsd;
      if (costDiff !== 0) return costDiff;
      return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
    });
  const eligible = candidates.filter((c) => c.eligible);
  const tiered = eligible.map((c) => c.modelId);
  const byId = new Map(models.map((model) => [model.modelId, model]));

  let selection: string | undefined;
  let reason: string;
  if (request.highRisk) {
    const approved = eligible.filter((c) => byId.get(c.modelId)?.approvedForHighRisk === true);
    if (approved.length === 0) {
      selection = undefined;
      reason = "no model approved for high-risk tasks is eligible; routing refused";
    } else {
      selection = approved[0]?.modelId;
      reason = "cheapest eligible model approved for high-risk tasks";
    }
  } else if (tiered.length === 0) {
    selection = undefined;
    reason = "no eligible model for the request; routing refused";
  } else {
    selection = tiered[0];
    reason = "cheapest eligible model under deterministic constraints";
  }
  const fallbacks = selection === undefined ? tiered : tiered.filter((id) => id !== selection);
  return {
    request,
    candidates,
    selection,
    fallbacks,
    reason,
    policyVersion: config.policyVersion,
    exploratory: false as const,
    escalations: [] as const
  };
}

{
  const rng = mulberry32(0xb11b05);
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  const config: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-sim-v1" };
  for (let trial = 0; trial < 5000; trial += 1) {
    const m = 1 + Math.floor(rng() * 10);
    const models: ModelDescriptor[] = Array.from({ length: m }, (_, i) => ({
      modelId: `m${i}`,
      providerId: rng() < 0.9 ? "prov" : "other",
      version: `v${i}`,
      capabilities: rng() < 0.8 ? ["tool-use"] : [],
      providerPolicy: rng() < 0.9 ? "approved" : "forbidden",
      inputCostPerMTok: Number((rng() * 5).toFixed(2)),
      outputCostPerMTok: Number((rng() * 15).toFixed(2)),
      latencyMsPer1K: 40 + Math.floor(rng() * 100),
      ...(rng() < 0.5 ? { contextWindow: 1000 + Math.floor(rng() * 200000) } : {}),
      ...(rng() < 0.5 ? { maxOutputTokens: 100 + Math.floor(rng() * 16000) } : {}),
      ...(rng() < 0.6 ? { privacyClass: pick(rng, privacy) } : {}),
      ...(rng() < 0.6 ? { approvedForHighRisk: rng() < 0.5 } : {})
    }));
    const request: RouteRequest = {
      taskFamily: pick(rng, ["edit", "plan", "test"]),
      privacyRequired: pick(rng, privacy),
      requiredCapabilities: rng() < 0.7 ? ["tool-use"] : [],
      contextNeeded: Math.floor(rng() * 150000),
      outputNeeded: Math.floor(rng() * 8000),
      budgetUsd: rng() < 0.2 ? 0.0001 : Number((rng() * 2).toFixed(4)),
      deadlineMs: rng() < 0.2 ? 10 : Math.floor(rng() * 600000),
      highRisk: rng() < 0.4
    };
    check(
      "S1-B-6 equivalence",
      JSON.stringify(routeR0(config, models, request)) === JSON.stringify(candidateRouteR0(config, models, request)),
      JSON.stringify({ trial })
    );
  }
  const models: ModelDescriptor[] = Array.from({ length: 10 }, (_, i) => ({
    modelId: `m${i}`,
    providerId: "prov",
    version: `v${i}`,
    capabilities: ["tool-use"],
    providerPolicy: "approved",
    inputCostPerMTok: 0.5 + i,
    outputCostPerMTok: 1.5 + i,
    latencyMsPer1K: 80,
    approvedForHighRisk: i >= 8
  }));
  const request: RouteRequest = {
    taskFamily: "edit",
    privacyRequired: "cloud-general",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 50000,
    outputNeeded: 2000,
    budgetUsd: 10,
    deadlineMs: 600000,
    highRisk: true
  };
  const cur = bench(() => routeR0(config, models, request), 20000);
  const cand = bench(() => candidateRouteR0(config, models, request), 20000);
  console.log(`S1-B-6 bench M=10 high-risk: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S1-B-7: validateInput complexity array literal hoist (micro anchor).
 * ============================================================ */
{
  const HOISTED: readonly string[] = ["LOW", "MEDIUM", "HIGH"];
  const complexities = ["LOW", "MEDIUM", "HIGH", "BOGUS"];
  let sink = 0;
  const cur = bench(() => {
    for (const c of complexities) if (["LOW", "MEDIUM", "HIGH"].includes(c)) sink += 1;
  }, 100000);
  const cand = bench(() => {
    for (const c of complexities) if (HOISTED.includes(c)) sink += 1;
  }, 100000);
  console.log(
    `S1-B-7 micro anchor (4 checks): inline-literal=${(cur * 1e6).toFixed(1)}ns hoisted=${(cand * 1e6).toFixed(1)}ns (sink=${sink > 0})`
  );
}

/* ============================================================
 * S1-B-8: assignPlanned defensive-copy elision -> observable identity change.
 * Demonstrate the current contract: distinct array objects per assignment.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const tasks = genTasks(mulberry32(0xb11b06), 3).map((task) => ({
    ...task,
    contractRisk: false
  }));
  const assignments = assignTasks({ catalog, tasks });
  const distinct =
    assignments[0]!.allowedModels !== assignments[1]!.allowedModels &&
    assignments[1]!.allowedModels !== assignments[2]!.allowedModels;
  check("S1-B-8 current contract: per-assignment arrays are distinct objects", distinct);
  console.log(
    `S1-B-8: current assignments carry distinct allowedModels arrays (${distinct}); eliding the copy would alias them across assignments -> observable identity change, S1-A-7 precedent applies`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

### 脚本 2：10× 压力与 route() 构成锚点

```ts
/**
 * R1-B addendum anchors: 10x stress for the analyzeTask bundle and a
 * route()-internals share probe. Seeded, deterministic (0xb11b02 reused
 * so the task corpus matches the main simulation).
 */
import { performance } from "node:perf_hooks";
import { analyzeTask } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { toModelDescriptor, catalogModel } from "/workspace/src/routing/catalog-model.js";
import { createModelRouter } from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";

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
  "Document how to delete a cache key and describe auth headers",
  "Implement retry logic for the ledger sync",
  "Review the audit log formatting nits",
  "Refactor and rename the tracking roller",
  "Fix the flaky spec for gate transitions",
  "Research and compare vector store options",
  "Add coverage for the routing refusal path",
  "Investigate why the drop table migration failed in prod",
  "Design a roadmap to break down the supervisor rewrite",
  "Write build scripts and integrate the release pipeline",
  "验证路由细节并补充测试",
  ""
];
const FRAGMENTS = [
  "deploy", "production", "credentials", "secrets", "review", "audit", "tests",
  "coverage", "plan", "design", "survey", "research", "refactor", "rename",
  "implement", "add ", "fix ", "migrate", "critique", "qa", "verify", "\n",
  "the module", "for the ledger", "and document it", "碎片", " "
];
function genObjective(rng: () => number): string {
  const roll = rng();
  if (roll < 0.5) return pick(rng, OBJECTIVE_TEMPLATES);
  let text = "";
  const parts = 1 + Math.floor(rng() * 10);
  for (let i = 0; i < parts; i += 1) text += pick(rng, FRAGMENTS) + " ";
  if (rng() < 0.1) text = text.repeat(1 + Math.floor(rng() * 8));
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

// 10x stress: N=20000 assignTasks vs analyzeTask-only share (M=2 catalog).
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const tasks = genTasks(mulberry32(0xb11b02), 20000);
  const total = bench(() => assignTasks({ catalog, tasks }), 5);
  const analyzeOnly = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role);
  }, 5);
  console.log(
    `10x stress N=20000: assignTasks=${(total).toFixed(1)}ms analyzeTask-share=${(analyzeOnly).toFixed(1)}ms; a 20% analyzeTask cut would save ~${(analyzeOnly * 0.2).toFixed(1)}ms per call`
  );
}

// route() internals: toModelDescriptor allocation share anchor (M=2).
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = catalog.models.map((m) => catalogModel(m));
  const routeCost = bench(
    () =>
      router.route({
        taskId: "tsk_anchor" as Parameters<typeof router.route>[0]["taskId"],
        role: "actor",
        complexity: "MEDIUM",
        modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
        limits: { remainingTimeMs: Number.MAX_SAFE_INTEGER }
      }),
    20000
  );
  const descriptorCost = bench(() => {
    for (const model of models) toModelDescriptor(model);
  }, 20000);
  console.log(
    `route() anchor M=2: route=${(routeCost * 1e6).toFixed(0)}ns; toModelDescriptor for the whole catalog=${(descriptorCost * 1e6).toFixed(0)}ns (${((descriptorCost / routeCost) * 100).toFixed(0)}%)`
  );
}
```

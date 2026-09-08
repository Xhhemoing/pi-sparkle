# R2-B：live 路由切片 Round 2 复搜报告

**战役:** 全库持久 SOTA 优化 Round 2 / R2-B（十区之一，R1-B 的第二遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `f5b2526`
**分支:** `cursor/r2-b-live-routing-slice-3ef3`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 关键前提事实：本切片 8 个文件加 4 个
只读上下游文件自 R1-B 的裁决基线 `94ed3d9` 以来**逐字节零变化**（`git diff --quiet`
验证通过），R1-B 的结构下界论证（§2 该报告）与全部 S1-B-1..8 裁决对当前代码
原样成立。本轮以新视角穷举 R1-B 未点名的剩余候选，得到 4 个排除表未覆盖的
新提案（S2-B-1 … S2-B-4），全部经理论 + 确定性仿真（seeded mulberry32，等价性
fuzz + 真实规模基准，三次独立运行方向一致）裁决后淘汰：3 个等价但真实规模
噪声级，1 个（无条件版）实测拖慢常见路径、（条件版）等价但噪声级。未重开任何
X* / S1-* 条目。现状仍为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts`、`learning/learned-routing.ts`、
  `graph/compile-children.ts`、`routing/public-prior.ts` 只读取证，一行未改。
- 基线漂移检查：`git diff 94ed3d9..f5b2526` 对切片 + 上下游 12 个文件为空。
  两个相关合入（S1-C offline-logit、S1-I CLI --children 目录复用）均在切片外；
  S1-I 使 `--children` 路径少调一次目录构建，live 切片负载只降不升，
  R1-B 的规模测量（live 面几十 µs、eval 回放 ×2 个位 ms）继续成立（§4 锚点复测）。
- 排除表遵守：X1-4、X3-1、X4-4、X4-5、X1-1、X1-2、S1-B-1..8、S1-I-3 全部未重开。
  S2-B-3 是 S1-B-6 的**姊妹提案**（消除事后 Map(entries) 构建，改为现有 map 遍历内
  联收集 Set），不与 S1-B-6 的基准结论矛盾，作为新条目独立裁决。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation` 3/3 绿（§5）。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义天然不变。

## 1. 新一遍搜索方法

R1-B 已按「输出契约渐近下界」逐函数收口。本轮换三个新透镜复搜：

1. **跨模块身份/新鲜性透镜**：找依赖别名关系的防御拷贝中「可证冗余」的那部分
   （产出 S2-B-1）。
2. **重复归一化透镜**：找同一数据被多次校验/构造的路径（产出 S2-B-2、S2-B-4）。
3. **已淘汰候选的可行姊妹变体**：S1-B-6 输了在 Map 构建成本上，检验「不建 Map、
   在现有遍历内联收集」是否翻案（产出 S2-B-3 及其条件变体）。

调用方图景复核：live 面入口不变（CLI `--children`、`track/loop`、`track/primary-split`
每次一批 `assignTasks`；`decideLiveCascade` 每 child 结果一次）；最大现实规模入口
仍是 `adaptation/eval-routing.ts` 对 N=episodes 调 `assignTasks` ×2（带 learned）；
`routeR0` 唯一生产调用方仍是 `r1-shadow-report.ts`（离线 shadow 对比）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-B-1 | `assignPlanned` learned 路径第二次防御拷贝 `[...applied.allowedModels]` 省略 | 每任务省 1 次数组拷贝；`applyLearnedRouting` 当前实现两分支（fresh filter / 别名局部首拷贝）都保跨 assignment 身份互异 | ✅ 3000 组 fuzz（复刻保真 + 值等价）+ 三种 learned 情形身份探针全 true | N=2000 learned 回放批省 202–240µs，占 assignTasks 4.5–5.3% | 淘汰：S1-B 捆绑同量级噪声 + 等价性依赖切片外模块未承诺的返回数组新鲜性（见 §3.1） |
| S2-B-2 | `createModelRouter`/`validateConfig` 对已构建目录（`catalogFromPrimary` 产物）跳过二次 `catalogModel()` 归一化 | 每 router 构建省 M 次 Θ(字段) 重构造 | —（需先解决检测手段） | `catalogModel()`≈68–79ns，M=2 上界 ~136–157ns/批；整个 createModelRouter 仅 ~700ns/批 | 淘汰：噪声 + 实现通道全撞排除类（brand 字段=公开类型变更；WeakSet=X1-1 隐藏状态）（见 §3.2） |
| S2-B-3 | `routeR0` 高风险审批过滤：在 `eligibleCandidates` 现有 map 遍历内联收集 approvedIds Set（S1-B-6 姊妹版，无 Map(entries) 构建） | O(E×M)→O(E+M) 且免 S1-B-6 的 Map 构建成本 | ✅ 5000 组 fuzz ×2 变体逐字节 | 无条件版：高风险 2093–2171→1795–1924ns，但**非高风险实测更慢**（1621–1697→1644–1801ns）；条件版：高风险省 ~300–380ns，非高风险持平 | 淘汰：无条件版拖慢常见路径；条件版收益 ns 级且唯一生产调用方是离线 shadow 报告，现实 M=1–2 时更小（见 §3.3） |
| S2-B-4 | `assignTasks` 全目录情形 `planAssignmentPolicy` 特化（requested≡catalog 时 Set/filter 恒等，双全排序换单遍 max/min） | 每批 O(M log M)+2 拷贝 → O(M) | ✅ 3000 组 fuzz（全目录情形值等价） | M=2 省 ~300ns、M=10 省 ~950ns，**每批一次**：占 N=2000 批 0.02%、N=30 CLI 批 ~0.5% | 淘汰：一次性亚 µs 噪声 + 需改切片外 `assign-plan.ts` 或在 assign.ts 开 X1-2 味平行私有路径（见 §3.4） |

## 3. 关键裁决细节

### 3.1 S2-B-1：等价成立但双重不达标

`applyLearnedRouting`（`src/learning/learned-routing.ts` L204）返回
`kept.length > 0 ? kept : catalogIds`：`kept` 是每调新鲜的 `.filter` 产物；
`catalogIds` 分支别名的是 `assignPlanned` 内每任务新鲜的首次拷贝
`[...plan.allowedIds]`。因此省略第二次拷贝后，跨 assignment 数组身份仍互异
（仿真三种情形探针全 true），S1-B-8 的身份论证**不适用**——这是与 S1-B-8
不同的新候选。但两条独立淘汰理由：

1. **噪声**：最大现实规模（eval 回放 N=2000，双 policy 各一次）每
   `assignTasks` 批省 202–240µs（4.5–5.3%），与已裁决淘汰的 S1-B 捆绑
   （284µs/6%）同量级同路径——一次性离线路径上的 1.05× 常数因子。
2. **跨模块脆弱性**：等价性依赖 `applyLearnedRouting`（learning/ 的公开函数）
   永不返回共享/缓存数组。当前实现为真，但这不是其签名承诺；未来任何
   memoize 化都会静默引入跨任务别名污染。防御拷贝正是这条模块边界的护栏。

### 3.2 S2-B-2：收益上界即噪声底

`catalogFromPrimary` 产出完整 `CatalogModel`，`validateConfig` 又对每个跑一遍
`catalogModel()`（重 trim、重铺默认值）。跳过需要区分「已构建」与「原始输入」：
brand 字段改公开 `CatalogModel` 形状（S1-C-3 类），WeakSet 登记是 X1-1 隐藏
状态，`instanceof` 无类可用。而收益上界实测 ~150ns/批（`createModelRouter`
全程也才 ~700ns/批，每 `assignTasks` 批一次）。任何通道都不值得为此破例。

### 3.3 S2-B-3：姊妹变体翻不了案

S1-B-6 输在 `new Map(models.map(...))` 的构建成本（2142→2488ns）。本变体在
现有 map 遍历内联 `approvedIds.add(...)`，免掉 entries 数组 + Map 构造：
高风险路径确实转正（2093–2171→1795–1924ns，三次一致）。但无条件收集使
**非高风险常见路径变慢**（Set 分配 + M 次条件判断白付），三次一致——
「不劣化」原则直接否决。条件变体（仅 `request.highRisk` 时收集）两路都不劣化、
高风险省 ~300–380ns（~15%），然而：`routeR0` 唯一生产调用方是
`r1-shadow-report.ts` 的离线 shadow 对比，每 observation 一次、现实目录
M=1–2（E×M 线性 find 仅 2×2），M=10 是压力假设。ns 级 × 离线一次性 ×
非常见分支 = 门槛第 3 条的噪声。记录条件变体的等价证据，若未来 routeR0
进入 live 热路径或 M 增长一个量级可凭本报告重开。

### 3.4 S2-B-4：每批一次的亚 µs

`assignTasks` 路径上 `catalogIds ≡ models.map(id)`，故 `planAssignmentPolicy`
的 `requested`/`catalog` 两个 Set、`allowedIds` filter、`assignableModels` filter
全为恒等，双 `[...].sort` 只为取 max/min。特化版单遍 max/min 等价（3000 fuzz，
V8 稳定排序与严格不等式单遍在平手时同取目录最早项）且快 ~10–17×，但绝对量
是**每批一次的 300–950ns**：占 eval 回放批 0.02%、CLI 批 ~0.5%。且
`planAssignmentPolicy` 在切片外的 `assign-plan.ts`（其行为被
`assign-plan.test.ts` 锁定），`assignOne` 还需通用路径（catalogIds 可为子集），
在 assign.ts 内开全目录快路径是 X1-2 味的平行实现。收益/风险裁决：不动。

## 4. 逐文件收口（本轮新透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `r0.ts` | S2-B-3 及条件变体淘汰；`applyCascade` 的 `tiers` spread + `indexOf` 为 T≤10 亚噪声（R1-B §2 下界） | 无候选 |
| `assign.ts` | S2-B-1、S2-B-4 淘汰；`catalogIds` 重 map 与 router 内部 Set 不共享属公开接口变更 | 无候选 |
| `policy.ts` | `evaluateLiveCandidate` merged 双 spread 已由 R1-B §5 裁决亚噪声；全约束独立评估为契约下界，不变 | 无候选 |
| `live-cascade.ts` | `stay` 闭包每调分配为亚噪声（S1-B-4 同表面）；`cheapFirstTiers` 现有 Map 因多次查询摊销合理，换线性扫描无净益 | 无候选 |
| `analyze-task.ts` | S1-B-1/2/3 排除维持；无新面 | 无候选 |
| `primary-catalog.ts` | 纯构造 ≤2 模型；模块级缓存 = X1-1 | 无候选 |
| `catalog-model.ts` | `catalogModel`/`toModelDescriptor` 条件 spread 微模式 = S1-C-10 类；`oneHotDistribution` O(E) 下界 | 无候选 |
| `supervisor/model-router.ts` | S2-B-2 淘汰；`validateConfig` 的 `ROLES.includes`/`new Set(roles)` 为一次性构造（S1-D-8 类）；`partitionLiveCandidates` 的 per-route `allowed` Set 在 A≤10 属 S1-A-4 教训域，现状合理；`toModelDescriptor` 16% 的三条路线维持 R1-B §4.4 架构裁决 | 无候选 |

跨切片观察（不改、仅记录）：`pickPreferredModel` → `pickFromPublicPrior`
（`public-prior.ts`，切片外）对同一 snapshot 每任务重跑
`validatePublicPriorSnapshot`。最大规模入口（eval 回放）不传 prior，live 面
N≤30，当前为噪声；若未来带 prior 的批量路径出现，归属该区裁决。

## 5. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test "test/unit/routing/"*.test.ts "test/unit/supervisor/"*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本未入库；完整源码见附录，seeds `0xb22b01`–`0xb22b05`）最终一次运行：

```text
S2-B-1 identity probe no-learned/partial-avoid/avoid-all: distinct (true) x3
S2-B-1 bench N=2000 learned replay: current=3709.3us candidate=3497.1us delta=212.2us | real assignTasks=4524.9us (delta=4.7%)
S2-B-2 bench: catalogModel()x1=79ns | createModelRouter M=2 total=700ns | skip upper bound ~157ns per batch
S2-B-3 bench M=10 highRisk=true: current=2104ns cand=1801ns cond-variant=1793ns
S2-B-3 bench M=10 highRisk=false: current=1658ns cand=1801ns cond-variant=1603ns
S2-B-4 bench M=2: current=324ns specialized=34ns (once per batch)
S2-B-4 bench M=10: current=1033ns specialized=57ns (once per batch)
anchor eval-replay N=2000: assignTasks M=2 4249.2us | analyzeTask share 1076.0us (25%)
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价结论逐位一致，方向不变（S2-B-1 delta 202–240µs；S2-B-3
无条件版非高风险三次全慢、条件版高风险三次全省 ~300ns；S2-B-4 三次同向）。
锚点与 R1-B 的 profile 同量级（assignTasks M=2 N=2000 ≈ 4.0–4.5ms、
analyzeTask 占比 ~26%），确认规模结论未漂移。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-B-1 | assignPlanned learned 路径第二次防御拷贝 `[...applied.allowedModels]` 省略 | 等价且身份保持（与 S1-B-8 不同），但 N=2000 回放批仅省 202–240µs（4.5–5.3%），且依赖 applyLearnedRouting 未承诺的返回数组新鲜性 |
| S2-B-2 | createModelRouter 对已构建目录跳过二次 catalogModel() 归一化 | 收益上界 ~150ns/批；检测手段全撞排除类（brand=公开类型变更、WeakSet=X1-1） |
| S2-B-3 | routeR0 高风险过滤在现有 map 遍历内联收集 approvedIds Set（含条件变体；S1-B-6 姊妹版） | 无条件版拖慢非高风险常见路径（三次一致）；条件版等价但高风险仅省 ~300ns，唯一生产调用方为离线 shadow 报告、现实 M=1–2，噪声 |
| S2-B-4 | assignTasks 全目录情形 planAssignmentPolicy 特化（单遍 max/min） | 等价但每批一次省 300–950ns（占批 0.02–0.5%），且需改切片外 assign-plan.ts 或开 X1-2 味平行路径 |

重开条件：S2-B-1 若 applyLearnedRouting 签名正式承诺返回新鲜数组且 eval 数据
集增长 ≥2 个量级；S2-B-3 条件变体若 routeR0 进入 live 热路径或现实 M 增长一个
量级（等价证据本报告已备）；S2-B-2/4 需先给出非噪声场景。

## 附录:确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb22b01`–`0xb22b05`。

```ts
/**
 * R2-B deterministic equivalence + benchmark simulation.
 * Adjudicates the four fresh Round-2 candidates S2-B-1 .. S2-B-4 against the
 * live routing slice, which is byte-identical to what R1-B adjudicated.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb22b01-0xb22b06.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask, type TaskAssignment } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel, type AssignmentPolicyPlan } from "/workspace/src/routing/assign-plan.js";
import { applyLearnedRouting, type LearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary, premiumCatalogModel } from "/workspace/src/routing/primary-catalog.js";
import { catalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import { routeR0, type R0Config } from "/workspace/src/routing/r0.js";
import { evaluateCandidate, type RouteRequest } from "/workspace/src/routing/policy.js";
import { estimateCostUsd, type ModelDescriptor, type PrivacyClass } from "/workspace/src/routing/capability-registry.js";
import {
  createModelRouter,
  type ModelRouter,
  type ModelRouterConfig,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
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

/* ============================================================
 * S2-B-1: assignPlanned second defensive copy elision on the learned path.
 * current:   allowedModels = [...applied.allowedModels]
 * candidate: allowedModels = applied.allowedModels
 * Replicas call the exact same real dependencies as src/routing/assign.ts.
 * ============================================================ */
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };

function assignPlannedReplica(
  router: ModelRouter,
  plan: AssignmentPolicyPlan,
  task: AssignableTask,
  limits: RoutingLimits,
  learned: LearnedRoutingPolicy | undefined,
  elideSecondCopy: boolean
): TaskAssignment {
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  let allowedModels: readonly string[] = [...plan.allowedIds];
  let preferredModel = pickPreferredModel(plan, analysis, undefined);
  if (learned !== undefined) {
    const applied = applyLearnedRouting(analysis.family, allowedModels, preferredModel, learned);
    allowedModels = elideSecondCopy ? applied.allowedModels : [...applied.allowedModels];
    preferredModel = applied.preferredModel;
  }
  const decision = router.route({
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
  });
  return { taskId: task.taskId, role: task.role, analysis, decision, allowedModels, preferredModel };
}

function genCatalog(rng: () => number): ModelRouterConfig {
  const m = 2 + Math.floor(rng() * 9);
  const models: CatalogModelInput[] = Array.from({ length: m }, (_, i) => ({
    id: `m${i}`,
    version: `m${i}-v1`,
    roles: ["actor", "critic"] as const,
    maxComplexity: (i >= m - 2 ? "HIGH" : pick(rng, ["MEDIUM", "HIGH"])) as TaskComplexity,
    estimatedCostUsd: Number((0.05 + rng()).toFixed(3)),
    estimatedDurationMs: 500 + Math.floor(rng() * 5000),
    capabilities: ["tool-use"],
    approvedForHighRisk: i >= m - 2 ? true : rng() < 0.3
  }));
  return { policyVersion: "sim-r2b", models };
}

function genLearned(rng: () => number, catalogIds: readonly string[]): LearnedRoutingPolicy | undefined {
  const roll = rng();
  if (roll < 0.25) return undefined;
  const families = ["edit", "plan", "research", "test", "review", "refactor", "deploy"];
  if (roll < 0.35) {
    // avoid-all: forces the kept.length===0 alias branch inside applyLearnedRouting
    return {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: catalogIds.map((id) => ({ modelId: id, reason: "sim avoid-all" })),
      prefer: []
    };
  }
  const avoid = catalogIds
    .filter(() => rng() < 0.3)
    .map((id) => ({
      modelId: id,
      reason: "sim",
      ...(rng() < 0.5 ? { family: pick(rng, families) } : {})
    }));
  const prefer = families
    .filter(() => rng() < 0.3)
    .map((family) => ({ family, modelId: pick(rng, catalogIds) }));
  return { primaryModelId: catalogIds[catalogIds.length - 1]!, avoid, prefer };
}

function outcomeOf(fn: () => TaskAssignment): string {
  try {
    return JSON.stringify(fn());
  } catch (error) {
    return `THROW:${(error as Error).message}`;
  }
}

{
  const rng = mulberry32(0xb22b01);
  for (let trial = 0; trial < 3000; trial += 1) {
    const catalog = genCatalog(rng);
    const router = createModelRouter(catalog);
    const catalogIds = catalog.models.map((model) => model.id);
    const plan = planAssignmentPolicy(router.config.models, catalogIds);
    const learned = genLearned(rng, catalogIds);
    const tasks = genTasks(rng, 1 + Math.floor(rng() * 4));
    // Fidelity: replica-current must equal the real assignTasks.
    let real: string;
    try {
      real = JSON.stringify(assignTasks({ catalog, tasks, learned }));
    } catch (error) {
      real = `THROW:${(error as Error).message}`;
    }
    let replicaBatch: string;
    try {
      replicaBatch = JSON.stringify(
        tasks.map((task) => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, false))
      );
    } catch (error) {
      replicaBatch = `THROW:${(error as Error).message}`;
    }
    check("S2-B-1 replica fidelity vs assignTasks", real === replicaBatch, `trial ${trial}`);
    // Equivalence: candidate (elided copy) must equal current, per task.
    for (const task of tasks) {
      const cur = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, false));
      const cand = outcomeOf(() => assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, true));
      check("S2-B-1 value equivalence", cur === cand, `trial ${trial}`);
    }
  }

  // Identity probe: cross-assignment allowedModels stay distinct objects under
  // the candidate, in all three regimes (no learned / partial avoid / avoid-all).
  const catalog = genCatalog(mulberry32(0xb22b02));
  const router = createModelRouter(catalog);
  const catalogIds = catalog.models.map((model) => model.id);
  const plan = planAssignmentPolicy(router.config.models, catalogIds);
  const probeTasks = genTasks(mulberry32(0xb22b02), 4).map((task) => ({ ...task, contractRisk: false }));
  const regimes: readonly [string, LearnedRoutingPolicy | undefined][] = [
    ["no-learned", undefined],
    ["partial-avoid", {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: [{ modelId: catalogIds[0]!, reason: "sim" }],
      prefer: []
    }],
    ["avoid-all", {
      primaryModelId: catalogIds[catalogIds.length - 1]!,
      avoid: catalogIds.map((id) => ({ modelId: id, reason: "sim" })),
      prefer: []
    }]
  ];
  for (const [label, learned] of regimes) {
    const out = probeTasks.map((task) =>
      assignPlannedReplica(router, plan, task, DEFAULT_LIMITS, learned, true)
    );
    let distinct = true;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i]!.allowedModels === plan.allowedIds) distinct = false;
      for (let j = i + 1; j < out.length; j += 1) {
        if (out[i]!.allowedModels === out[j]!.allowedModels) distinct = false;
      }
    }
    check(`S2-B-1 candidate identity (${label})`, distinct);
    console.log(`S2-B-1 identity probe ${label}: candidate keeps per-assignment arrays distinct (${distinct})`);
  }

  // Benchmark at the largest realistic scale: eval-replay N=2000 with a
  // learned policy (adaptation/eval-routing.ts passes learned on both calls).
  const benchCatalog = catalogFromPrimary({ primaryModelId: "premium" });
  const benchRouter = createModelRouter(benchCatalog);
  const benchIds = benchCatalog.models.map((model) => model.id);
  const benchPlan = planAssignmentPolicy(benchRouter.config.models, benchIds);
  const benchLearned: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", reason: "sim", family: "review" }],
    prefer: [{ family: "plan", modelId: "premium" }]
  };
  const benchTasks = genTasks(mulberry32(0xb22b02), 2000);
  const cur = bench(() => {
    for (const task of benchTasks) assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, benchLearned, false);
  }, 30);
  const cand = bench(() => {
    for (const task of benchTasks) assignPlannedReplica(benchRouter, benchPlan, task, DEFAULT_LIMITS, benchLearned, true);
  }, 30);
  const whole = bench(() => assignTasks({ catalog: benchCatalog, tasks: benchTasks, learned: benchLearned }), 30);
  console.log(
    `S2-B-1 bench N=2000 learned replay: current=${(cur * 1e3).toFixed(1)}us candidate=${(cand * 1e3).toFixed(1)}us delta=${((cur - cand) * 1e3).toFixed(1)}us | real assignTasks=${(whole * 1e3).toFixed(1)}us (delta=${(((cur - cand) / whole) * 100).toFixed(1)}%)`
  );
}

/* ============================================================
 * S2-B-2: createModelRouter re-normalizes prebuilt catalogs through
 * catalogModel(). Upper bound of any skip = M x catalogModel() per router
 * construction (once per assignTasks batch).
 * ============================================================ */
{
  const premiumInput: CatalogModelInput = { ...premiumCatalogModel() };
  const one = bench(() => catalogModel(premiumInput), 100000);
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const construct = bench(() => createModelRouter(catalog), 20000);
  console.log(
    `S2-B-2 bench: catalogModel()x1=${(one * 1e6).toFixed(0)}ns | createModelRouter M=2 total=${(construct * 1e6).toFixed(0)}ns | skip upper bound ~${(one * 2 * 1e6).toFixed(0)}ns per batch`
  );
}

/* ============================================================
 * S2-B-3: routeR0 high-risk approved filter via an approved-id Set collected
 * inline in the existing eligibleCandidates map pass (sibling of the excluded
 * S1-B-6 Map variant, without the entries-array Map construction).
 * ============================================================ */
function candidateRouteR0(
  config: R0Config,
  models: readonly ModelDescriptor[],
  request: RouteRequest,
  onlyWhenHighRisk = false
) {
  const approvedIds = new Set<string>();
  const collect = !onlyWhenHighRisk || request.highRisk;
  const candidates = models
    .map((model) => {
      if (collect && model.approvedForHighRisk === true) approvedIds.add(model.modelId);
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

  let selection: string | undefined;
  let reason: string;
  if (request.highRisk) {
    const approved = eligible.filter((c) => approvedIds.has(c.modelId));
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
  const rng = mulberry32(0xb22b03);
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  const config: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-sim-r2b" };
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
    const expected = JSON.stringify(routeR0(config, models, request));
    check(
      "S2-B-3 equivalence",
      expected === JSON.stringify(candidateRouteR0(config, models, request)),
      JSON.stringify({ trial })
    );
    check(
      "S2-B-3 equivalence (conditional variant)",
      expected === JSON.stringify(candidateRouteR0(config, models, request, true)),
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
  for (const highRisk of [true, false]) {
    const request: RouteRequest = {
      taskFamily: "edit",
      privacyRequired: "cloud-general",
      requiredCapabilities: ["tool-use"],
      contextNeeded: 50000,
      outputNeeded: 2000,
      budgetUsd: 10,
      deadlineMs: 600000,
      highRisk
    };
    const cur = bench(() => routeR0(config, models, request), 20000);
    const cand = bench(() => candidateRouteR0(config, models, request), 20000);
    const condVariant = bench(() => candidateRouteR0(config, models, request, true), 20000);
    console.log(
      `S2-B-3 bench M=10 highRisk=${highRisk}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns cond-variant=${(condVariant * 1e6).toFixed(0)}ns`
    );
  }
}

/* ============================================================
 * S2-B-4: full-catalog specialization of planAssignmentPolicy (when
 * catalogIds === all model ids, the Sets and filters are identities).
 * Once per assignTasks batch.
 * ============================================================ */
function specializedFullCatalogPlan(
  models: readonly ReturnType<typeof catalogModel>[],
  catalogIds: readonly string[]
): AssignmentPolicyPlan {
  let primary = models[0];
  let cheapest = models[0];
  for (const model of models) {
    if (model.estimatedCostUsd > primary!.estimatedCostUsd) primary = model;
    if (model.estimatedCostUsd < cheapest!.estimatedCostUsd) cheapest = model;
  }
  return {
    catalogIds,
    allowedIds: catalogIds,
    primaryPreferredId: primary?.id,
    assignableModels: models,
    cheapestAssignableId: cheapest?.id ?? catalogIds[0]!
  };
}

{
  const rng = mulberry32(0xb22b04);
  for (let trial = 0; trial < 3000; trial += 1) {
    const catalog = genCatalog(rng);
    const router = createModelRouter(catalog);
    const ids = catalog.models.map((model) => model.id);
    const cur = planAssignmentPolicy(router.config.models, ids);
    const cand = specializedFullCatalogPlan(router.config.models, ids);
    // Value equivalence requires identical max/min tie-breaks: V8 Array.sort
    // is stable, keeping the earliest catalog entry on ties; the single-pass
    // loops above use strict > / < so they also keep the earliest entry.
    check("S2-B-4 value equivalence (full catalog)", JSON.stringify(cur) === JSON.stringify(cand), `trial ${trial}`);
  }
  for (const m of [2, 10]) {
    const catalog: ModelRouterConfig = {
      policyVersion: "sim-r2b",
      models: Array.from({ length: m }, (_, i) => ({
        id: `m${i}`,
        version: `m${i}-v1`,
        roles: ["actor", "critic"] as const,
        maxComplexity: "HIGH" as TaskComplexity,
        estimatedCostUsd: 0.05 * (i + 1),
        estimatedDurationMs: 500
      }))
    };
    const router = createModelRouter(catalog);
    const ids = catalog.models.map((model) => model.id);
    const cur = bench(() => planAssignmentPolicy(router.config.models, ids), 100000);
    const cand = bench(() => specializedFullCatalogPlan(router.config.models, ids), 100000);
    console.log(
      `S2-B-4 bench M=${m}: current=${(cur * 1e6).toFixed(0)}ns specialized=${(cand * 1e6).toFixed(0)}ns (once per batch)`
    );
  }
}

/* ============================================================
 * Baseline anchor: confirm R1-B's scale profile still holds on this tree.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const tasks = genTasks(mulberry32(0xb22b05), 2000);
  const total = bench(() => assignTasks({ catalog, tasks }), 30);
  const analyzeOnly = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role);
  }, 30);
  console.log(
    `anchor eval-replay N=2000: assignTasks M=2 ${(total * 1e3).toFixed(1)}us | analyzeTask share ${(analyzeOnly * 1e3).toFixed(1)}us (${((analyzeOnly / total) * 100).toFixed(0)}%)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

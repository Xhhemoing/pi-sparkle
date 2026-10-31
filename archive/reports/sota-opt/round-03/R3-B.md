# R3-B：live 路由切片 Round 3 三搜报告

**战役:** 全库持久 SOTA 优化 Round 3 / R3-B（十区之一，R1-B/R2-B 的第三遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `4c31136`
**分支:** `cursor/r3-b-routing-slice-4959`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 关键前提事实：切片 8 个文件加全部只读
上下游（共 16 个文件）自 R2-B 的裁决基线 `f5b2526` 以来**逐字节零变化**
（`git diff --stat f5b2526..HEAD` 为空；期间唯一 src 合入是切片外的 S2-C
offline-logit IRLS），R1-B 的结构下界论证与 S1-B-1..8、S2-B-1..4 全部裁决对
当前代码原样成立。本轮换第三组新透镜穷举，得到 6 个排除表未覆盖的新提案
（S3-B-1 … S3-B-6），全部经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz +
真实规模基准，三次独立运行方向逐位一致）裁决后淘汰：**2 个实测负优化**
（S3-B-1 记忆化、S3-B-5 融合）、1 个不等价（S3-B-3 tie-break 语义）、1 个无生产
调用方（S3-B-4）、2 个等价但噪声级（S3-B-2、S3-B-6）。未重开任何
X* / S1-* / S2-* 条目。现状仍为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、
  `src/supervisor/model-router.ts` 全量重读；上下游 `assign-plan.ts`、`live-selection.ts`、
  `capability-registry.ts`、`cascade-evidence.ts` 只读取证，一行未改。
- 基线漂移检查：对切片 + 上下游 16 个文件 `git diff f5b2526..HEAD` 为空。
  R1-B/R2-B 的规模测量与调用方图景复核后不变（§1）。
- 排除表遵守：X1-1、X1-2、X1-6、X3-1、X4-4/5、S1-B-1..8、S2-B-1..4 全部未重开。
  S3-B-1 是**批内**（非跨 episode）记忆化，与 X1-6（跨 episode 记忆化 routeR1）
  和 X1-1（模块级隐藏缓存）作用域不同，作为新条目独立裁决——结论反而更强
  （实测负优化）。S3-B-2 与 R2-B §4 的「cheapFirstTiers 换线性扫描」不同
  （保留 Map、消除比较器内重复查询），作为新条目独立裁决。
- R1/posterior/offline-* 未碰；live 保持 R0 等价，R1 未接线：`live-isolation` 3/3 绿（§5）。
- 零 diff，公开 API / 决策对象 schema / refusal 消息优先级 / tie-break 语义天然不变。

## 1. 第三遍搜索方法与调用方图景复核

R1-B 用「输出契约渐近下界」透镜，R2-B 用「跨模块身份/重复归一化/已淘汰候选
姊妹变体」透镜。本轮换三组新透镜：

1. **批内去重透镜**：同一 `assignTasks` 批内路由请求键重复度多高、记忆化
   `partitionLiveCandidates` 是否可赚（产出 S3-B-1）。
2. **比较器/热循环内重复求值透镜**：sort 比较器内的重复 Map 查询、验证头部对
   同一数组的多遍扫描（产出 S3-B-2、S3-B-5）。
3. **语义面与分配消除透镜**：tie-break 排序原语可替换性、每候选请求字面量的
   共享可变化、快路径免建数组（产出 S3-B-3、S3-B-6、S3-B-4）。

调用方图景复核（grep 全 src 取证，与 R2-B 记录一致）：`routeR0` 唯一生产调用方
仍是 `r1-shadow-report.ts`；`applyCascade` 在 src 内唯一调用方是
`applyEvidenceCascade`（cascade-evidence.ts），而后者**在 src 内无任何调用方**
（仅测试引用）——即 `applyCascade` 当前生产不可达；`decideLiveCascade` 在
`run/child-coordinator.ts` 每 child 结果一次；`assignTasks` 最大规模入口仍是
`adaptation/eval-routing.ts` N=episodes ×2（baseline+candidate）。

规模锚点复测（本 VM 较前两轮偏慢，绝对值成比例膨胀，占比与方向结论不受影响）：

```text
anchor eval-replay N=2000: assignTasks M=2 6225.6–6753.1us | analyzeTask share 1191.2–1413.4us (19–21%)
```

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-B-1 | `assignTasks` 批内按请求键记忆化 `partitionLiveCandidates`（copy 变体每命中拷贝 refusals；alias 变体直接共享） | 批内键重复率实测 48.1%（N=2000 → 1039 距离键），命中免 M 次 evaluateLiveCandidate | ✅ copy 变体 N=2000 批值等价；❌ alias 变体身份探针证明 `rejections` 跨 assignment 共享 | **实测负优化**：copy 变体慢 884.7–1441.5µs/批（-12.5~-22.7%），alias 变体慢 922.1–1147.8µs/批，三次一致 | 淘汰：键构造成本（11 字段字符串拼接）> M=2 分区本体；alias 变体另有可观察身份改变（S1-A-7/S1-B-8 先例）；键还需随 RouteTaskInput 增字段同步维护（X1-6 类脆弱性） |
| S3-B-2 | `cheapFirstTiers` 装饰-排序-还原（decorate-sort-undecorate），消除比较器内双 `byId.get` 与二次 map 查询 | 比较器 O(1) 化 + filter/map 两遍并一遍 | ✅ 5000 组 fuzz（含空 version/ghost id/成本平手）逐字节 | T=2 省 39–57ns、T=10 省 165–201ns；调用方 `liveCascadePlanFromAssignment` 每 assignment 一次（live 面 N≤30） | 淘汰：ns 级噪声（S1-B-5 同带宽） |
| S3-B-3 | `cheapFirstTiers` tie-break `localeCompare` 换码点比较（`<`/`>`） | localeCompare 为 ICU 调用，码点比较快一个量级 | ❌ 发散见证：等成本 ids `["Beta","alpha"]` 当前序 `[alpha,Beta]`，码点序 `[Beta,alpha]` | — | 淘汰：不等价。tier 顺序是公开输出，ICU 排序与码点序在混大小写 id 上发散 |
| S3-B-4 | `applyCascade` 当 `previousModelId === decision.selection` 时免建 `[selection, ...fallbacks]` 数组的快路径 | 免 1 次 O(T) spread + indexOf 直取 `fallbacks[0]` | ✅ 8000 组 fuzz（cascade 开关 × 置信度 × selection/fallbacks/ghost 全组合）逐字节 | T=10 省 50–80ns/次 | 淘汰：`applyCascade` 生产不可达（唯一 src 调用方 `applyEvidenceCascade` 无生产调用方，仅测试引用）+ ns 级（S1-D-3 同类） |
| S3-B-5 | `validateInput` 与 route 头部 unknown-model 检查分段融合单遍（一遍内记录首个 unknown、其余校验后再抛，保错误优先级） | allowedModels 三遍扫描（every/includes/find）省一遍 | ✅ 8000 组 fuzz 含全错误路径，抛错消息与次序逐字节一致 | **实测更慢**：A=10 happy path 176–192ns → 209–210ns，三次一致 | 淘汰：理论被仿真推翻（手写循环替代 V8 内建 `every` 更慢），S1-B-6/S1-A-4 同类反例第三例 |
| S3-B-6 | `partitionLiveCandidates` 共享可变请求对象（每候选仅改写 fixedCostUsd/fixedLatencyMs，替代每候选新建请求字面量；R1-B §5 请求字面量裁决的姊妹变体） | 免 M-1 次 12 字段对象分配 | ✅ 3000 组 fuzz 分区结果逐字节 | M=2 省 ~127–142ns/route、M=10 省 ~91–120ns/route；N=2000 批上界 ~260µs | 淘汰：与已淘汰的 S1-B 捆绑（284µs）/S2-B-1（202–240µs）同噪声带；且引入别名可变对象（S1-C-1 类危险），policy.ts L154-156 护栏注释明示请求对象直进共享矩阵，live 决策虽不保留请求引用但 r0 路径保留（`R0Decision.request`），同一 evaluateCandidate 的两类调用方语义分叉，回归风险非零 |

## 3. 关键裁决细节

### 3.1 S3-B-1：批内记忆化是本切片第三个「不劣化伪装」反例

批内键重复率真实存在（48.1%），但三个成本叠加使其全面负优化：

1. **键构造成本**：安全键必须覆盖分区读取的全部 11 个输入维度（role、
   complexity、family、privacy、capabilities、context、output、budget、
   deadline、highRisk、allowedModels），字符串拼接本身 ≳ M=2 时 2 次
   `evaluateLiveCandidate` 的本体成本（分区份额仅 766–800µs/2000 次 ≈
   390ns/次）。
2. **身份约束**：`buildDecision` 将分区的 `refusals` 数组直接别名为
   `decision.rejections`；命中共享（alias 变体）使跨 assignment
   `rejections` 同引用——仿真身份探针证明当前路由器保持互异、alias 变体
   破坏之，是可观察身份改变。为保身份每命中需拷贝（copy 变体），进一步
   侵蚀收益。
3. **维护脆弱性**：任何未来给 `RouteTaskInput` 增加的约束字段都必须记得
   同步进键，否则静默错误命中——与 X1-6「等价键不安全」同一教训，此处
   连性能动机都不存在（实测慢 12–23%）。

### 3.2 S3-B-5：手写循环输给 V8 内建的第三例

纸面上 `every` + `includes` + `find` 对同一 A≤10 数组三遍扫描可并作一遍，
且分段抛错可精确保持错误优先级（8000 组含错误路径的 fuzz 逐字节一致证明
等价可行）。但 happy path 实测三次全部更慢（176–192 → 209–210ns）：V8 对
内建数组方法的快路径 + 单态回调内联优于手写循环内的多分支。与 S1-A-4
（Set 化更慢）、S1-B-6（Map 化更慢）构成同一教训的第三例，覆盖第三种
形态（循环融合）。

### 3.3 S3-B-3：tie-break 语义是冻结面

`cheapFirstTiers`（及只读上下游 `compareLiveCandidates`）的 `localeCompare`
与 `r0.ts` 的码点比较是**两个各自被测试锁定的公开 tie-break 契约**，不是
可统一的实现细节。发散见证（等成本 `["Beta","alpha"]`：ICU 序 `alpha<Beta`、
码点序 `Beta<alpha`）直接否决替换；两者互换方向的「统一」提案同理双向
不等价。性能面 ties 仅在成本完全相等时触达，T≤10 下亦是噪声。

### 3.4 S3-B-6：分配消除撞上架构护栏

共享可变请求对象等价成立（live 路径不保留请求引用，3000 fuzz 逐字节），
但 policy.ts L154-156 的注释明确该请求对象按 RouteRequest 完整形状直进
共享约束矩阵——引入「同一对象被循环内改写」后，任何未来在
`evaluateCandidate` 内缓存/保留请求引用的改动（r0 路径已经在
`R0Decision.request` 保留！）都会踩别名污染。收益上界（N=2000 批 ~260µs）
落在 S1-B 捆绑 / S2-B-1 已裁决的同一噪声带内，不值得为此弱化护栏。

## 4. 逐文件收口（第三遍透镜下的残余检查）

| 文件 | 检查项 | 结论 |
| --- | --- | --- |
| `r0.ts` | S3-B-4 淘汰（生产不可达 + ns）；高风险过滤维持 S1-B-6/S2-B-3 排除；排序输出即契约（R1-B §2 下界） | 无候选 |
| `assign.ts` | S3-B-1 批内记忆化淘汰（负优化）；防御拷贝维持 S1-B-8/S2-B-1 排除；批不变量已提升 | 无候选 |
| `policy.ts` | S3-B-6 淘汰（噪声带 + 护栏）；全约束独立评估为契约下界；`merged` 双 spread 维持 R1-B §5 亚噪声裁决 | 无候选 |
| `live-cascade.ts` | S3-B-2 淘汰（ns 级）；S3-B-3 淘汰（不等价）；`decideLiveCascade` 维持 S1-B-4 排除 | 无候选 |
| `analyze-task.ts` | S1-B-1/2/3 排除维持；正则链分支间顺序即优先级语义，无新面 | 无候选 |
| `primary-catalog.ts` | 纯构造 ≤2 模型；模块级缓存 = X1-1；无新面 | 无候选 |
| `catalog-model.ts` | 条件 spread 微模式 = S1-C-10 类（改无条件字段会改变属性存在性，可观察）；`oneHotDistribution` O(E) 下界 | 无候选 |
| `supervisor/model-router.ts` | S3-B-5 淘汰（实测更慢）；S2-B-2 排除维持；`effectiveConfidenceThreshold` 的 ≤4 元 `Math.max` spread 为常数噪声（调用方 supervisor/flowchart，非本切片热路径）；`toModelDescriptor` 16% 维持 R1-B §4.4 架构裁决 | 无候选 |

## 5. 前后对比与测试

无代码 diff。仓库变更仅本报告一个文件。零改动下相关套件复核全绿：

```bash
npx tsx --test "test/unit/routing/"*.test.ts "test/unit/supervisor/"*.test.ts
# tests 260 / suites 18 / pass 260 / fail 0
npx tsx --test test/unit/routing/live-isolation.test.ts
# tests 3 / pass 3 / fail 0   （live 面不 import R1/bandit/shadow 继续成立）
```

仿真（临时脚本未入库；完整源码见附录，seeds `0xb33b01`–`0xb33b07`）最终一次运行：

```text
S3-B-1 memo key-space: N=2000 tasks -> 1039 distinct keys (hit rate 48.1%)
S3-B-1 identity: current distinct=true; alias-memo shared=true (observable identity change)
S3-B-1 bench N=2000 M=2: replica-current=2015.8us memo-copy=3396.8us memo-alias=3163.6us | partition share=765.8us | real assignTasks=6095.8us
S3-B-1 delta: copy=-1381.0us/batch (-22.7% of real) alias=-1147.8us/batch
S3-B-2 bench T=2: current=249ns decorated=192ns
S3-B-2 bench T=10: current=922ns decorated=721ns
S3-B-3: current(localeCompare)=[alpha,Beta] codepoint=[Beta,alpha] -> diverges=true
S3-B-4 bench T=10 escalate-from-selection: current=249ns cand=176ns
S3-B-5 bench A=10 happy path: current=192ns fused=210ns
S3-B-6 bench M=2: per-model-literal=523ns shared-mutable=396ns
S3-B-6 bench M=10: per-model-literal=1661ns shared-mutable=1545ns
anchor eval-replay N=2000: assignTasks M=2 6225.6us | analyzeTask share 1191.2us (19%)
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价结论逐位一致，方向不变（S3-B-1 两变体三次全慢；S3-B-5 三次
全慢；S3-B-2/4/6 三次同向同带宽）。路由 replica 保真性在候选运行前先经 400 组
逐字节校验（replica-current ≡ 真实 `router.route`）。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-B-1 | assignTasks 批内按请求键记忆化 partitionLiveCandidates | 实测负优化（copy/alias 两变体慢 884–1442µs/批，键构造 > M=2 分区本体）；alias 变体可观察身份改变；X1-6 类键脆弱性 |
| S3-B-2 | cheapFirstTiers 装饰-排序-还原消除比较器重复查询 | 等价但 T≤10 省 39–201ns，live 面每 assignment 一次，噪声 |
| S3-B-3 | cheapFirstTiers tie-break localeCompare 换码点比较 | 不等价：混大小写等成本 id 序发散（`[alpha,Beta]` vs `[Beta,alpha]`），tier 顺序是公开输出 |
| S3-B-4 | applyCascade previousModelId===selection 免建 tiers 数组快路径 | 等价但省 50–80ns，且 applyCascade 生产不可达（applyEvidenceCascade 仅测试引用），S1-D-3 同类 |
| S3-B-5 | validateInput 与 unknown-model 检查分段融合单遍 | 错误次序可保持（fuzz 证明）但实测更慢（176–192→209–210ns），V8 内建快路径反例第三例 |
| S3-B-6 | partitionLiveCandidates 共享可变请求对象（每候选改写 fixed 字段） | 等价但 N=2000 批上界 ~260µs（S1-B 捆绑同噪声带）；别名可变危险（S1-C-1 类）+ policy.ts L154-156 护栏 |

重开条件：S3-B-1 需先推翻键构造成本论证（如 M 增长两个量级使分区本体远超键
成本）且解决 rejections 身份；S3-B-2/4/6 需先给出非噪声场景（S3-B-4 另需
applyCascade 获得生产调用方）；S3-B-3/5 需先推翻本报告的发散见证/基准。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xb33b01`–`0xb33b07`。

```ts
/**
 * R3-B deterministic equivalence + benchmark simulation (third pass).
 * Adjudicates fresh Round-3 candidates S3-B-1 .. S3-B-6 against the live
 * routing slice, byte-identical since R1-B's baseline 94ed3d9.
 * Seeded PRNG (mulberry32) -> fully reproducible. Seeds 0xb33b01-0xb33b07.
 */
import { performance } from "node:perf_hooks";
import { analyzeTask } from "/workspace/src/routing/analyze-task.js";
import { assignTasks, type AssignableTask } from "/workspace/src/routing/assign.js";
import { planAssignmentPolicy, pickPreferredModel, type AssignmentPolicyPlan } from "/workspace/src/routing/assign-plan.js";
import { flowchartRoleForAgentRole } from "/workspace/src/graph/compile-children.js";
import { ASSIGN_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";
import { catalogModel, oneHotDistribution, toModelDescriptor, type CatalogModel, type CatalogModelInput } from "/workspace/src/routing/catalog-model.js";
import { cheapFirstTiers, type LiveCascadeTier } from "/workspace/src/routing/live-cascade.js";
import { applyCascade, routeR0, type CascadeInput, type R0Config, type R0Decision } from "/workspace/src/routing/r0.js";
import { evaluateCandidate, evaluateLiveCandidate, type RouteRequest, type LiveRouteRequest, type ConstraintFailure } from "/workspace/src/routing/policy.js";
import { estimateCostUsd, type ModelDescriptor, type PrivacyClass } from "/workspace/src/routing/capability-registry.js";
import { liveRefusalMessage, selectLiveModel } from "/workspace/src/routing/live-selection.js";
import { DomainValidationError, RoutingRefusalError, type RoutingRefusal } from "/workspace/src/domain/errors.js";
import { DEFAULT_HUMAN_CONFIDENCE } from "/workspace/src/domain/flowchart.js";
import { FLOWCHART_FEATURE_VERSION } from "/workspace/src/routing/feature-version.js";
import {
  createModelRouter,
  coldStartRoutingScore,
  type ModelRouter,
  type ModelRouterConfig,
  type RouteTaskInput,
  type RoutingDecision,
  type RoutingLimits
} from "/workspace/src/supervisor/model-router.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { TaskComplexity, FlowchartNodeRole, ApprovalPlan } from "/workspace/src/domain/flowchart.js";
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

/* ============================================================
 * Faithful route() replica (same exported building blocks as
 * src/supervisor/model-router.ts) so internals can be instrumented.
 * Fidelity is checked against the real router before any candidate runs.
 * ============================================================ */
interface ResolvedRouteRequest {
  readonly highRisk: boolean;
  readonly family: string;
  readonly featureVersion: string;
  readonly privacyRequired: PrivacyClass;
  readonly requiredCapabilities: readonly string[];
  readonly contextNeeded: number;
  readonly outputNeeded: number;
  readonly budgetUsd: number;
  readonly deadlineMs: number;
}
function resolveRouteDefaults(input: RouteTaskInput): ResolvedRouteRequest {
  return {
    highRisk: input.highRisk === true,
    family: input.family ?? "unknown",
    featureVersion: input.featureVersion ?? FLOWCHART_FEATURE_VERSION,
    privacyRequired: input.privacyRequired ?? "cloud-general",
    requiredCapabilities: input.requiredCapabilities ?? ["tool-use"],
    contextNeeded: input.contextNeeded ?? 0,
    outputNeeded: input.outputNeeded ?? 0,
    budgetUsd: input.limits.remainingCostUsd ?? Number.POSITIVE_INFINITY,
    deadlineMs: input.limits.remainingTimeMs
  };
}
type Partition = { readonly eligible: readonly CatalogModel[]; readonly refusals: readonly RoutingRefusal[] };
function partitionReplica(models: readonly CatalogModel[], input: RouteTaskInput, resolved: ResolvedRouteRequest): Partition {
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
    const checkResult = evaluateLiveCandidate(model, {
      role: input.role,
      complexity: input.complexity,
      taskFamily: resolved.family,
      privacyRequired: resolved.privacyRequired,
      requiredCapabilities: resolved.requiredCapabilities,
      contextNeeded: resolved.contextNeeded,
      outputNeeded: resolved.outputNeeded,
      budgetUsd: resolved.budgetUsd,
      deadlineMs: resolved.deadlineMs,
      highRisk: resolved.highRisk,
      fixedCostUsd: model.estimatedCostUsd,
      fixedLatencyMs: model.estimatedDurationMs
    });
    if (checkResult.eligible) eligible.push(model);
    else refusals.push(...checkResult.failures);
  }
  return { eligible, refusals };
}
function makeApprovalPlan(taskId: TaskId, model: CatalogModel): ApprovalPlan {
  return {
    id: `approval:${taskId}:${model.id}`,
    items: [
      { id: `route:${model.id}`, label: `Use ${model.id}`, selectable: true, defaultSelected: true },
      { id: "route:cancel", label: "Do not run this task", selectable: true, defaultSelected: false }
    ]
  };
}
function buildDecisionReplica(
  policyVersion: string,
  input: RouteTaskInput,
  resolved: ResolvedRouteRequest,
  selected: CatalogModel,
  eligible: readonly CatalogModel[],
  refusals: readonly RoutingRefusal[]
): RoutingDecision {
  const preferredModel = input.modelPolicy.preferredModel;
  const preferred = selected.id === preferredModel;
  const score = coldStartRoutingScore(input.complexity, preferred);
  const approvalRequired = input.approvalRequired ?? false;
  const statusAfterRoute = approvalRequired ? "WAITING_FOR_USER" : "RUNNING";
  const preferredNote = preferred ? `; preferred constraint ${preferredModel}` : "";
  const justification =
    `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
    `estimated cost ${selected.estimatedCostUsd} USD and duration ${selected.estimatedDurationMs} ms fit remaining limits` +
    preferredNote;
  const eligibleModels = eligible.map((model) => model.id);
  return {
    eventType: "MODEL_ROUTED",
    taskId: input.taskId,
    role: input.role,
    complexity: input.complexity,
    model: selected.id,
    justification,
    confidence: score,
    coldStartRoutingScore: score,
    approvalPlan: makeApprovalPlan(input.taskId, selected),
    statusAfterRoute,
    policyVersion,
    estimatedCostUsd: selected.estimatedCostUsd,
    estimatedDurationMs: selected.estimatedDurationMs,
    family: resolved.family,
    featureVersion: resolved.featureVersion,
    modelVersion: selected.version,
    highRisk: resolved.highRisk,
    eligibleModels,
    rejections: refusals,
    behaviorDistribution: oneHotDistribution(eligibleModels, selected.id),
    ...(input.agentRole !== undefined ? { agentRole: input.agentRole } : {}),
    ...(preferred && preferredModel !== undefined ? { preferredConstraint: preferredModel } : {})
  } as RoutingDecision;
}
/** memoMode: "off" = faithful current; "alias" = share partition arrays; "copy" = fresh refusals per hit. */
function routeReplica(
  models: readonly CatalogModel[],
  catalogIds: ReadonlySet<string>,
  policyVersion: string,
  input: RouteTaskInput,
  memo?: Map<string, Partition>,
  memoMode: "off" | "alias" | "copy" = "off"
): RoutingDecision {
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
  const resolved = resolveRouteDefaults(input);
  let partition: Partition;
  if (memo !== undefined && memoMode !== "off") {
    const key =
      input.role + "\u0000" + input.complexity + "\u0000" + resolved.family + "\u0000" +
      resolved.privacyRequired + "\u0000" + resolved.requiredCapabilities.join(",") + "\u0000" +
      resolved.contextNeeded + "\u0000" + resolved.outputNeeded + "\u0000" +
      resolved.budgetUsd + "\u0000" + resolved.deadlineMs + "\u0000" +
      resolved.highRisk + "\u0000" + input.modelPolicy.allowedModels.join(",");
    const hit = memo.get(key);
    if (hit !== undefined) {
      partition = memoMode === "copy" ? { eligible: hit.eligible, refusals: [...hit.refusals] } : hit;
    } else {
      partition = partitionReplica(models, input, resolved);
      memo.set(key, partition);
    }
  } else {
    partition = partitionReplica(models, input, resolved);
  }
  if (partition.eligible.length === 0) {
    throw new RoutingRefusalError(
      liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk: resolved.highRisk }, partition.refusals),
      partition.refusals
    );
  }
  const selected = selectLiveModel(partition.eligible, input.modelPolicy.preferredModel);
  return buildDecisionReplica(policyVersion, input, resolved, selected, partition.eligible, partition.refusals);
}
function routeInputFor(plan: AssignmentPolicyPlan, task: AssignableTask, limits: RoutingLimits): RouteTaskInput {
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  return {
    taskId: task.taskId,
    role: flowchartRoleForAgentRole(task.role),
    complexity: analysis.complexity,
    modelPolicy: { allowedModels: [...plan.allowedIds], preferredModel: pickPreferredModel(plan, analysis, undefined) },
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
const DEFAULT_LIMITS: RoutingLimits = { remainingTimeMs: Number.MAX_SAFE_INTEGER };

/* ============================================================
 * S3-B-1: per-batch partition memoization inside assignTasks.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const router = createModelRouter(catalog);
  const models = router.config.models;
  const catalogIdSet = new Set(models.map((m) => m.id));
  const ids = catalog.models.map((m) => m.id);
  const plan = planAssignmentPolicy(models, ids);

  // Fidelity: replica (memo off) must match the real router byte-for-byte.
  const rng = mulberry32(0xb33b01);
  const fidelityTasks = genTasks(rng, 400);
  for (const task of fidelityTasks) {
    const input = routeInputFor(plan, task, DEFAULT_LIMITS);
    const real = JSON.stringify(router.route(input));
    const rep = JSON.stringify(routeReplica(models, catalogIdSet, catalog.policyVersion, input));
    check("S3-B-1 replica fidelity", real === rep, task.taskId);
  }

  // Equivalence of the copy-variant memo at batch scale (values only).
  const batch = genTasks(mulberry32(0xb33b02), 2000);
  const inputs = batch.map((task) => routeInputFor(plan, task, DEFAULT_LIMITS));
  const plain = inputs.map((input) => JSON.stringify(routeReplica(models, catalogIdSet, catalog.policyVersion, input)));
  {
    const memo = new Map<string, Partition>();
    const memoized = inputs.map((input) =>
      JSON.stringify(routeReplica(models, catalogIdSet, catalog.policyVersion, input, memo, "copy"))
    );
    let same = true;
    for (let i = 0; i < plain.length; i += 1) if (plain[i] !== memoized[i]) same = false;
    check("S3-B-1 memo(copy) value equivalence N=2000", same);
    console.log(`S3-B-1 memo key-space: N=2000 tasks -> ${memo.size} distinct keys (hit rate ${(100 * (1 - memo.size / 2000)).toFixed(1)}%)`);
  }
  // Identity probe: alias variant shares decision.rejections across assignments.
  {
    const memo = new Map<string, Partition>();
    const highRiskTasks: AssignableTask[] = [0, 1].map((i) => ({
      taskId: `tsk_hr_${i}` as AssignableTask["taskId"],
      role: "implementer",
      objective: "Deploy payment credentials to production",
      contractRisk: true
    }));
    const decisions = highRiskTasks.map((task) =>
      routeReplica(models, catalogIdSet, catalog.policyVersion, routeInputFor(plan, task, DEFAULT_LIMITS), memo, "alias")
    );
    const aliased = decisions[0]!.rejections === decisions[1]!.rejections;
    const currentDecisions = highRiskTasks.map((task) =>
      router.route(routeInputFor(plan, task, DEFAULT_LIMITS))
    );
    const currentDistinct = currentDecisions[0]!.rejections !== currentDecisions[1]!.rejections;
    check("S3-B-1 alias variant breaks rejections identity", aliased);
    check("S3-B-1 current router keeps rejections distinct", currentDistinct);
    console.log(`S3-B-1 identity: current distinct=${currentDistinct}; alias-memo shared=${aliased} (observable identity change)`);
  }
  // Benchmarks: replay-scale batches; partition share; key cost.
  const repPlain = bench(() => {
    for (const input of inputs) routeReplica(models, catalogIdSet, catalog.policyVersion, input);
  }, 30);
  const repMemoCopy = bench(() => {
    const memo = new Map<string, Partition>();
    for (const input of inputs) routeReplica(models, catalogIdSet, catalog.policyVersion, input, memo, "copy");
  }, 30);
  const repMemoAlias = bench(() => {
    const memo = new Map<string, Partition>();
    for (const input of inputs) routeReplica(models, catalogIdSet, catalog.policyVersion, input, memo, "alias");
  }, 30);
  const partitionOnly = bench(() => {
    for (const input of inputs) partitionReplica(models, input, resolveRouteDefaults(input));
  }, 30);
  const realWhole = bench(() => assignTasks({ catalog, tasks: batch }), 30);
  console.log(
    `S3-B-1 bench N=2000 M=2: replica-current=${(repPlain * 1e3).toFixed(1)}us memo-copy=${(repMemoCopy * 1e3).toFixed(1)}us memo-alias=${(repMemoAlias * 1e3).toFixed(1)}us | partition share=${(partitionOnly * 1e3).toFixed(1)}us | real assignTasks=${(realWhole * 1e3).toFixed(1)}us`
  );
  console.log(
    `S3-B-1 delta: copy=${((repPlain - repMemoCopy) * 1e3).toFixed(1)}us/batch (${(((repPlain - repMemoCopy) / realWhole) * 100).toFixed(1)}% of real) alias=${((repPlain - repMemoAlias) * 1e3).toFixed(1)}us/batch`
  );
}

/* ============================================================
 * S3-B-2: cheapFirstTiers decorate-sort-undecorate.
 * ============================================================ */
function candidateCheapFirstTiersDecorated(
  eligibleIds: readonly string[],
  models: readonly { readonly id: string; readonly version?: string; readonly estimatedCostUsd: number }[]
): LiveCascadeTier[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const decorated: { id: string; cost: number; version: string }[] = [];
  for (const id of eligibleIds) {
    const model = byId.get(id);
    if (model !== undefined && typeof model.version === "string" && model.version.trim() !== "") {
      decorated.push({ id, cost: model.estimatedCostUsd, version: model.version });
    }
  }
  decorated.sort((left, right) => {
    const cost = left.cost - right.cost;
    if (cost !== 0) return cost;
    return left.id.localeCompare(right.id);
  });
  return decorated.map((entry) => ({ modelId: entry.id, version: entry.version }));
}
{
  const rng = mulberry32(0xb33b03);
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
      "S3-B-2 equivalence",
      JSON.stringify(cheapFirstTiers(eligibleIds, models)) ===
        JSON.stringify(candidateCheapFirstTiersDecorated(eligibleIds, models)),
      JSON.stringify({ eligibleIds, models })
    );
  }
  for (const t of [2, 10]) {
    const models = Array.from({ length: t }, (_, i) => ({
      id: `m${i}`,
      version: `m${i}-v1`,
      estimatedCostUsd: i < t / 2 ? 0.1 : 0.05 * (i + 1) // ties in the first half exercise localeCompare
    }));
    const eligibleIds = models.map((model) => model.id);
    const cur = bench(() => cheapFirstTiers(eligibleIds, models), 40000);
    const cand = bench(() => candidateCheapFirstTiersDecorated(eligibleIds, models), 40000);
    console.log(`S3-B-2 bench T=${t}: current=${(cur * 1e6).toFixed(0)}ns decorated=${(cand * 1e6).toFixed(0)}ns`);
  }
}

/* ============================================================
 * S3-B-3: localeCompare -> codepoint tie-break. Divergence witness.
 * ============================================================ */
{
  const models = [
    { id: "Beta", version: "Beta-v1", estimatedCostUsd: 0.1 },
    { id: "alpha", version: "alpha-v1", estimatedCostUsd: 0.1 }
  ];
  const eligibleIds = ["Beta", "alpha"];
  const current = cheapFirstTiers(eligibleIds, models).map((tier) => tier.modelId);
  const codepoint = [...eligibleIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const diverges = JSON.stringify(current) !== JSON.stringify(codepoint);
  check("S3-B-3 divergence witness (mixed-case equal-cost ids)", diverges);
  console.log(
    `S3-B-3: current(localeCompare)=[${current.join(",")}] codepoint=[${codepoint.join(",")}] -> diverges=${diverges}; tier order is public output, candidate is NOT equivalent`
  );
}

/* ============================================================
 * S3-B-4: applyCascade fast path when previousModelId === selection.
 * ============================================================ */
function candidateApplyCascade(config: R0Config, decision: R0Decision, input: CascadeInput): R0Decision {
  if (!config.cascade) {
    return { ...decision, reason: "cascade disabled; selection unchanged" };
  }
  if (decision.selection === undefined) {
    return { ...decision, reason: "no selection to cascade from" };
  }
  if (input.previousConfidence >= config.confidenceGate) {
    return {
      ...decision,
      reason: `confidence ${input.previousConfidence} >= gate ${config.confidenceGate}; retained ${decision.selection}`
    };
  }
  let escalated: string | undefined;
  if (input.previousModelId === decision.selection) {
    // fast path: previous model is tier 0; successor is fallbacks[0]
    if (decision.fallbacks.length === 0) {
      return { ...decision, reason: "cascade exhausted; staying on the most expensive eligible tier" };
    }
    escalated = decision.fallbacks[0];
  } else {
    const currentIndex = decision.fallbacks.indexOf(input.previousModelId);
    if (currentIndex < 0) {
      return { ...decision, reason: `previous model ${input.previousModelId} is not in the cascade tiers` };
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex >= decision.fallbacks.length) {
      return { ...decision, reason: "cascade exhausted; staying on the most expensive eligible tier" };
    }
    escalated = decision.fallbacks[nextIndex];
  }
  if (escalated === undefined) {
    return { ...decision, reason: "cascade exhausted" };
  }
  return {
    ...decision,
    selection: escalated,
    fallbacks: decision.fallbacks.filter((id) => id !== escalated),
    escalations: [...decision.escalations, `${input.previousModelId}->${escalated}`],
    reason: `confidence ${input.previousConfidence} < gate ${config.confidenceGate}; escalated ${input.previousModelId} -> ${escalated}`
  };
}
{
  const rng = mulberry32(0xb33b04);
  const privacy: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"];
  for (let trial = 0; trial < 8000; trial += 1) {
    const config: R0Config = {
      confidenceGate: Number(rng().toFixed(2)),
      cascade: rng() < 0.8,
      policyVersion: "r0-sim-r3b"
    };
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
      highRisk: rng() < 0.3
    };
    const decision = routeR0(config, models, request);
    const previousModelId =
      rng() < 0.5 && decision.selection !== undefined
        ? decision.selection
        : rng() < 0.7 && decision.fallbacks.length > 0
          ? pick(rng, decision.fallbacks)
          : "ghost";
    const input: CascadeInput = { previousModelId, previousConfidence: Number(rng().toFixed(2)) };
    check(
      "S3-B-4 equivalence",
      JSON.stringify(applyCascade(config, decision, input)) ===
        JSON.stringify(candidateApplyCascade(config, decision, input)),
      JSON.stringify({ trial })
    );
  }
  // Bench: escalate-from-selection path (the fast-path target), T=10 tiers.
  const config: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-sim-r3b" };
  const models: ModelDescriptor[] = Array.from({ length: 10 }, (_, i) => ({
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
  const input: CascadeInput = { previousModelId: decision.selection!, previousConfidence: 0.2 };
  const cur = bench(() => applyCascade(config, decision, input), 40000);
  const cand = bench(() => candidateApplyCascade(config, decision, input), 40000);
  console.log(`S3-B-4 bench T=10 escalate-from-selection: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S3-B-5: validateInput + unknown-model staged single-pass fusion.
 * Replica of the real head; fused variant preserves error precedence by
 * recording the first unknown id during the validity pass and throwing it
 * only after every other validateInput check has run.
 * ============================================================ */
function validateScoreReplica(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be a finite number between 0 and 1`);
  }
  return value;
}
function currentHead(input: RouteTaskInput, catalogIds: ReadonlySet<string>): void {
  if (!Array.isArray(input.modelPolicy.allowedModels) || input.modelPolicy.allowedModels.length === 0 ||
      !input.modelPolicy.allowedModels.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new DomainValidationError("Route modelPolicy.allowedModels must be a non-empty string array");
  }
  if (input.modelPolicy.preferredModel !== undefined &&
      !input.modelPolicy.allowedModels.includes(input.modelPolicy.preferredModel)) {
    throw new DomainValidationError("Route preferredModel must be in allowedModels");
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(input.complexity)) {
    throw new DomainValidationError("Route complexity is invalid");
  }
  if (!Number.isFinite(input.limits.remainingTimeMs) || input.limits.remainingTimeMs < 0) {
    throw new DomainValidationError("remainingTimeMs must be a non-negative finite number");
  }
  if (input.limits.remainingCostUsd !== undefined &&
      (!Number.isFinite(input.limits.remainingCostUsd) || input.limits.remainingCostUsd < 0)) {
    throw new DomainValidationError("remainingCostUsd must be a non-negative finite number");
  }
  if (input.confidenceThreshold !== undefined) validateScoreReplica(input.confidenceThreshold, "confidenceThreshold");
  if (input.limits.minHumanConfidence !== undefined) {
    validateScoreReplica(input.limits.minHumanConfidence, "minHumanConfidence");
  }
  const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
  if (unknownPolicyModel !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
  }
}
function fusedHead(input: RouteTaskInput, catalogIds: ReadonlySet<string>): void {
  const allowedModels = input.modelPolicy.allowedModels;
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
    throw new DomainValidationError("Route modelPolicy.allowedModels must be a non-empty string array");
  }
  let firstUnknown: string | undefined;
  for (const id of allowedModels) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new DomainValidationError("Route modelPolicy.allowedModels must be a non-empty string array");
    }
    if (firstUnknown === undefined && !catalogIds.has(id)) firstUnknown = id;
  }
  if (input.modelPolicy.preferredModel !== undefined &&
      !allowedModels.includes(input.modelPolicy.preferredModel)) {
    throw new DomainValidationError("Route preferredModel must be in allowedModels");
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(input.complexity)) {
    throw new DomainValidationError("Route complexity is invalid");
  }
  if (!Number.isFinite(input.limits.remainingTimeMs) || input.limits.remainingTimeMs < 0) {
    throw new DomainValidationError("remainingTimeMs must be a non-negative finite number");
  }
  if (input.limits.remainingCostUsd !== undefined &&
      (!Number.isFinite(input.limits.remainingCostUsd) || input.limits.remainingCostUsd < 0)) {
    throw new DomainValidationError("remainingCostUsd must be a non-negative finite number");
  }
  if (input.confidenceThreshold !== undefined) validateScoreReplica(input.confidenceThreshold, "confidenceThreshold");
  if (input.limits.minHumanConfidence !== undefined) {
    validateScoreReplica(input.limits.minHumanConfidence, "minHumanConfidence");
  }
  if (firstUnknown !== undefined) {
    throw new DomainValidationError(`Model policy references unavailable model: ${firstUnknown}`);
  }
}
{
  const rng = mulberry32(0xb33b05);
  const catalogIds = new Set(["m0", "m1", "m2", "m3"]);
  const outcome = (fn: () => void): string => {
    try {
      fn();
      return "OK";
    } catch (error) {
      return `THROW:${(error as Error).message}`;
    }
  };
  for (let trial = 0; trial < 8000; trial += 1) {
    const poolRoll = rng();
    const allowedModels: unknown =
      poolRoll < 0.08
        ? "not-an-array"
        : poolRoll < 0.16
          ? []
          : Array.from({ length: 1 + Math.floor(rng() * 6) }, () => {
              const r = rng();
              if (r < 0.06) return 42 as unknown as string;
              if (r < 0.12) return "  ";
              if (r < 0.3) return `ghost${Math.floor(rng() * 3)}`;
              return `m${Math.floor(rng() * 4)}`;
            });
    const input = {
      taskId: "tsk_val" as TaskId,
      role: "actor" as FlowchartNodeRole,
      complexity: (rng() < 0.9 ? pick(rng, ["LOW", "MEDIUM", "HIGH"]) : "BOGUS") as TaskComplexity,
      modelPolicy: {
        allowedModels: allowedModels as readonly string[],
        ...(rng() < 0.5
          ? { preferredModel: rng() < 0.7 ? `m${Math.floor(rng() * 4)}` : `ghost${Math.floor(rng() * 3)}` }
          : {})
      },
      limits: {
        remainingTimeMs: rng() < 0.9 ? Math.floor(rng() * 1e6) : -5,
        ...(rng() < 0.4 ? { remainingCostUsd: rng() < 0.8 ? Number((rng() * 3).toFixed(2)) : -1 } : {}),
        ...(rng() < 0.3 ? { minHumanConfidence: rng() < 0.8 ? Number(rng().toFixed(2)) : 7 } : {})
      },
      ...(rng() < 0.3 ? { confidenceThreshold: rng() < 0.8 ? Number(rng().toFixed(2)) : -2 } : {})
    } as RouteTaskInput;
    check(
      "S3-B-5 error-order equivalence",
      outcome(() => currentHead(input, catalogIds)) === outcome(() => fusedHead(input, catalogIds)),
      JSON.stringify({ trial })
    );
  }
  const okInput = {
    taskId: "tsk_val" as TaskId,
    role: "actor" as FlowchartNodeRole,
    complexity: "MEDIUM" as TaskComplexity,
    modelPolicy: {
      allowedModels: Array.from({ length: 10 }, (_, i) => `m${i % 4}`),
      preferredModel: "m1"
    },
    limits: { remainingTimeMs: 1e6, remainingCostUsd: 2 }
  } as RouteTaskInput;
  const cur = bench(() => currentHead(okInput, catalogIds), 100000);
  const cand = bench(() => fusedHead(okInput, catalogIds), 100000);
  console.log(`S3-B-5 bench A=10 happy path: current=${(cur * 1e6).toFixed(0)}ns fused=${(cand * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S3-B-6: partitionLiveCandidates shared mutable request object.
 * ============================================================ */
function partitionMutable(models: readonly CatalogModel[], input: RouteTaskInput, resolved: ResolvedRouteRequest): Partition {
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  const request = {
    role: input.role,
    complexity: input.complexity,
    taskFamily: resolved.family,
    privacyRequired: resolved.privacyRequired,
    requiredCapabilities: resolved.requiredCapabilities,
    contextNeeded: resolved.contextNeeded,
    outputNeeded: resolved.outputNeeded,
    budgetUsd: resolved.budgetUsd,
    deadlineMs: resolved.deadlineMs,
    highRisk: resolved.highRisk,
    fixedCostUsd: 0,
    fixedLatencyMs: 0
  };
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
    request.fixedCostUsd = model.estimatedCostUsd;
    request.fixedLatencyMs = model.estimatedDurationMs;
    const checkResult = evaluateLiveCandidate(model, request as LiveRouteRequest);
    if (checkResult.eligible) eligible.push(model);
    else refusals.push(...checkResult.failures);
  }
  return { eligible, refusals };
}
{
  const rng = mulberry32(0xb33b06);
  for (let trial = 0; trial < 3000; trial += 1) {
    const m = 2 + Math.floor(rng() * 9);
    const modelInputs: CatalogModelInput[] = Array.from({ length: m }, (_, i) => ({
      id: `m${i}`,
      version: `m${i}-v1`,
      roles: ["actor", "critic"] as const,
      maxComplexity: pick(rng, ["MEDIUM", "HIGH"]) as TaskComplexity,
      estimatedCostUsd: Number((0.05 + rng()).toFixed(3)),
      estimatedDurationMs: 500 + Math.floor(rng() * 5000),
      capabilities: rng() < 0.8 ? ["tool-use"] : [],
      approvedForHighRisk: rng() < 0.4
    }));
    const models = modelInputs.map((mi) => catalogModel(mi));
    const allowedModels = models.filter(() => rng() < 0.8).map((model) => model.id);
    if (allowedModels.length === 0) allowedModels.push(models[0]!.id);
    const input = {
      taskId: "tsk_mut" as TaskId,
      role: "actor" as FlowchartNodeRole,
      complexity: pick(rng, ["LOW", "MEDIUM", "HIGH"]) as TaskComplexity,
      modelPolicy: { allowedModels },
      highRisk: rng() < 0.3,
      family: pick(rng, ["edit", "plan", "test"]),
      requiredCapabilities: rng() < 0.7 ? ["tool-use"] : [],
      ...(rng() < 0.4 ? { contextNeeded: Math.floor(rng() * 150000) } : {}),
      ...(rng() < 0.4 ? { outputNeeded: Math.floor(rng() * 8000) } : {}),
      limits: {
        remainingTimeMs: rng() < 0.2 ? 10 : Math.floor(rng() * 1e6),
        ...(rng() < 0.4 ? { remainingCostUsd: Number((rng() * 2).toFixed(3)) } : {})
      }
    } as RouteTaskInput;
    const resolved = resolveRouteDefaults(input);
    check(
      "S3-B-6 partition equivalence",
      JSON.stringify(partitionReplica(models, input, resolved)) ===
        JSON.stringify(partitionMutable(models, input, resolved)),
      JSON.stringify({ trial })
    );
  }
  for (const m of [2, 10]) {
    const models = Array.from({ length: m }, (_, i) =>
      catalogModel({
        id: `m${i}`,
        version: `m${i}-v1`,
        roles: ["actor", "critic"] as const,
        maxComplexity: "HIGH" as TaskComplexity,
        estimatedCostUsd: 0.05 * (i + 1),
        estimatedDurationMs: 500,
        capabilities: ["tool-use"]
      })
    );
    const input = {
      taskId: "tsk_mut" as TaskId,
      role: "actor" as FlowchartNodeRole,
      complexity: "MEDIUM" as TaskComplexity,
      modelPolicy: { allowedModels: models.map((model) => model.id) },
      family: "edit",
      requiredCapabilities: ["tool-use"],
      limits: { remainingTimeMs: 1e6 }
    } as RouteTaskInput;
    const resolved = resolveRouteDefaults(input);
    const cur = bench(() => partitionReplica(models, input, resolved), 40000);
    const cand = bench(() => partitionMutable(models, input, resolved), 40000);
    console.log(`S3-B-6 bench M=${m}: per-model-literal=${(cur * 1e6).toFixed(0)}ns shared-mutable=${(cand * 1e6).toFixed(0)}ns`);
  }
}

/* ============================================================
 * Baseline anchor: confirm R1-B/R2-B scale profile still holds.
 * ============================================================ */
{
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const tasks = genTasks(mulberry32(0xb33b07), 2000);
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

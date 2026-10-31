MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-G：运行时 / 监督 / 图 / 领域模型切片第七遍复查报告

**战役:** 全库持久 SOTA 优化 Round 7 / R7-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `9c26b83`（含 R7-A/R7-B 排除
S7-A-*、S7-B-1..6 合入，S6-C / S6-F-1 / S5-I-1 落地均在本切片外）
**分支:** `cursor/r7-g-runtime-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线
（`4efee23`）以来**第七轮逐字节未变**（`git diff 4efee23 9c26b83 -- src/run
src/supervisor src/graph src/domain` 为空，`git diff 054db8f HEAD -- <切片
含 A/B 剔除>` 同为空——R7-A/R7-B 只动报告与排除表，代码零 diff），
R1-G~R6-G 六遍收口与 S1-G-1..9、S2-G-1..8、S3-G-1..5、S4-G-1..7、
S5-G-1..6、S6-G-1..7 共四十二条排除全部继承有效。本轮在完整排除表
（含 S7-A/S7-B 新行）之上第七次全量实际读码，刻意转向前六遍从未点名的
"**校验器内部算法复杂度 / 领域纯函数微结构**"角度（前六遍聚焦 I/O 时序、
重读复用、persist 合并、校验层删除，从未审视校验/判决函数**内部**的
渐进复杂度），枚举得 5 个新候选（S7-G-1 … S7-G-5），全部经理论 +
确定性基准（固定输入两种规模形态 16n/8n 作双 seed，两次独立运行计时
抖动 <2%、等价与反例结论逐位一致）裁决后淘汰：**1 个被真实反例封死
且量级不达线**——本轮最有价值的发现是 `validateJoin` 的 O(J·E) 边扫描
"复用 `edgePairs` Set"变体在含 `\u0000` 节点 id 的流程图上**接受现实现
拒绝的畸形 join 引用**（`${from}\u0000${to}` 键碰撞，反例已执行验证：
现实现 throws=true、变体 accepts=true），无碰撞变体（Map<from,
Set<to>>）等价成立但实测可移除量仅 0.067µs/次校验、0.002ms/run；
**4 个合法候选全部在噪声区**：validateFlowchart 整体 8.2µs/次
（每轮 checkpoint 校验路径 ×32 轮＝0.26ms/run 全额上限，字面量数组
提升属 S1-G-3 已判噪声家族）、DeterministicJudge.decide 0.11µs/次
（0.0018ms/run）、expandTaskTransition BFS 0.50µs/次（0.008ms/run，
X4-6 同家族）、resume 路径三段 I/O 链并行化被真数据依赖
（`project.rootPath` 来自 replay 产物）+ S5-G-4/S6-G-5 Promise.all
排除家族双重封死。未重开任何 X* / S1-* ~ S6-* / S7-A / S7-B 条目；
事件 schema 零 diff。第七遍结论与 R6-G 一致并终结：本切片计算面
已压至 µs 量级（最大单点 validateFlowchart 8µs），每 run 持久化预算
（~69~89ms readAll + checkpoint 地板）是**契约 / I-O 地板**，
本切片在现行为契约下不存在十 ms 带以上的保行为优化空间。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部 45 文件第七次实际读码，未依赖前六轮记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md 全表（含 S7-A、
  S7-B-1..6 新行）→ round-07/PLAN.md → round-01/R1-G.md → … →
  round-06/R6-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1..9、S2-G-1..8、
  S3-G-1..5、S4-G-1..7、S5-G-1..6、S6-G-1..7 四十二条全部不再提案；
  X0-1/X0-2、X4-6..8、X1-1/X1-3 直接跳过；S7-A/S7-B 新行核对不重叠
  （A：tracking/gate 端点，B：model-router 评估路径，均在切片外）。
  特别核对：S7-G-1 与 S6-G-3/S4-G-2/S3-G-2 的区别——那三条是"删除
  校验**层**"（被可恢复性屏障封死），本条是"降低校验**内部**渐进复杂度"
  （保留全部校验语义），属未点名新角度；S7-G-5 主动承认落入 S5-G-4/
  S6-G-5 家族后即停止展开，只留反例式记录。
- 硬不变量维持：确定性 id 流（未动任何 create*Id 调用点）、事件顺序
  （未动任何 append 时序）、fail-closed persist、crash-prefix 持久性
  （writeAtomic open→write→sync→rename 链未动）、inspect 数据面
  （磁盘事实源语义未动）。无 Outcome-supported 特性、无阈值/测试/
  schema 改动。EXCLUSIONS.md / PROGRESS.md 未编辑。
- 漂移复核：`git diff --stat 054db8f HEAD -- src/run src/supervisor
  src/graph src/domain ':!src/run/child-tracking.ts'
  ':!src/run/gate-apply.ts' ':!src/supervisor/model-router.ts'` 输出为空；
  更强的 `git diff 4efee23 HEAD -- <四目录全量>` 亦为空（0 行），
  即含 A/B 区文件在内整个四目录自 R1-G 起七轮逐字节未变。

## 1. 规模与门槛基底（第七遍继承 + 本轮实测校准）

继承 R6-G 实测地板：每 run 持久化预算 readAll 地板 37.8~43.0ms +
checkpoint 写地板 ~31~46ms ≈ 69~89ms，全部为契约 / I-O 承重结构。
本轮补充**计算面**基底（Node v22.22.2，固定输入，两规模形态双 seed，
两次独立运行）：

| 端点 | 实测 | 每 run 全额 | 说明 |
| --- | --- | --- | --- |
| `validateFlowchart`（16 节点 4 扇入 join / 8 节点 2 扇入） | 8.2µs / 4.1µs | ×32 轮 ≈ 0.26ms | 每轮 persistCheckpoint→validateCheckpoint 路径最频调用者 |
| `validateJoin` O(J·E) 边扫描（可移除份额） | 0.176µs→0.110µs | 0.002ms | S7-G-1 的收益上限 |
| `DeterministicJudge.decide`（8×8 证据） | 0.111µs | ×16 判决 ≈ 0.0018ms | filter+includes O(n·m) |
| `expandTaskTransition`（PENDING→FAILED 最长路径） | 0.50µs | ×16 ≈ 0.008ms | BFS queue.shift，状态图恒 8 节点 |
| `compileChildrenToFlowchart`（16 children） | 10.2µs | 每 run 一次 | 一次性编译 |

**结论性基底：本切片计算面每 run 总额 <0.3ms，与 69~89ms I/O 地板差
两个数量级以上。** 任何纯计算优化在本切片的收益上限即 0.3ms，
永久低于十 ms 门槛——这是第七遍新确立的**切片级封顶论证**：
后续轮次无需再枚举本切片纯计算候选，除非流程图规模契约
（maxTasks=16）放大 ≥2 个数量级。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 端点 | 方案 | 裁决 |
| --- | --- | --- | --- |
| S7-G-1 | `domain/flowchart.ts` `validateJoin` | O(J·E) `edges.some` 边扫描改边对索引（复用 `edgePairs` Set 或新建 Map） | 淘汰：naive Set 复用被 NUL 键碰撞反例封死（非保行为）；无碰撞 Map 变体等价成立但可移除量 0.067µs/次、0.002ms/run＝噪声 |
| S7-G-2 | `domain/flowchart.ts` 校验循环 | role/operator 检查的每迭代字面量数组提升为模块级 Set | 淘汰：S1-G-3 已判噪声同家族；宿主函数全额才 8.2µs/次、0.26ms/run 上限 |
| S7-G-3 | `graph/judge.ts` `DeterministicJudge.decide` | `filter(id => includes(id))` O(n·m) 改 Set 成员判定 | 淘汰：等价成立（filter 序保持，已执行验证 identical=true）但 0.111µs/次、0.0018ms/run＝噪声 |
| S7-G-4 | `domain/state.ts` `expandTaskTransition` | BFS `queue.shift()` + 路径数组分配改索引队列 | 淘汰：X4-6（Kahn shift）同家族；状态图恒 8 节点，0.50µs/次、0.008ms/run＝噪声 |
| S7-G-5 | `run/flowchart-run.ts` resume/approval 路径 | `replayRun` → `checkpointStore.read()` → `loadLearnedRouting` 三段 I/O 并行化 | 淘汰：真数据依赖（`rootPath` 来自 replay 产物、checkpoint 读语义上以 replay 成功为前提）；并行化本质是 S5-G-4/S6-G-5 已排除 Promise.all 家族在 resume 端点的复现 |

逐文件收口中另核对并直接放弃（不占候选 ID，均为一次性/µs 级）：
`compileChildrenToFlowchart`（10.2µs 一次性）、`formatChildPrompt` /
`formatFlowchartNodePrompt` 字符串拼装（每节点一次，µs 级）、
`groundChildTask.uniqueArtifacts`（已是 Set 实现）、
`validateRequirementContract` 三数组展开分配（一次性）、`hash32`
（已最简 FNV 风格循环）、`domain/index.ts` 与 `supervisor/flowchart.ts`
纯 barrel（零运行时成本）、`DeterministicJudge` 之外的全部 domain
校验器（`validateEpisode`/`validateRun`/`validateTaskNode`/
`validateProjectSnapshot`/`validateEvidence`/`validateArtifact`，
每对象一次线性扫、µs 级）、`isIsoTimestamp` 的 `Date.parse`
（S6-G-4 双向发散反例已封死，不重开）。

## 3. 关键裁决细节

### S7-G-1：validateJoin 边对索引——本轮唯一有实质内容的候选

**动机（新角度）：** `validateFlowchart` 在 :382-395 已为重复边检测构建
`edgePairs = Set(`${from}\u0000${to}`)`，随后 :404 的 `validateJoin` 却对
每个 `requiredNodeIds` 重新线性扫 `edges.some(e => e.from === required &&
e.to === nodeId)`（:334），复杂度 O(J·E)。直觉方案：把已建好的
`edgePairs` 传入 `validateJoin` 换 O(1) 查找。前六遍全部聚焦"删层/删读/
并写"，从未审视过校验器内部渐进复杂度，属未点名角度。

**反例（已执行验证，非理论推演）：** `nonEmpty` 只要求 trim 后非空，
节点 id 可以合法包含 `\u0000`。构造流程图：节点
`["a", "a\u0000b", "c", "b\u0000c"]`，唯一边 `("a\u0000b" → "c")`，
节点 `"b\u0000c"` 声明 `joinPolicy.requiredNodeIds = ["a"]`。
现实现 `edges.some` 逐字段精确比较：不存在边 `a → b\u0000c`，**正确
抛出** `node b\u0000c has malformed join reference: a`。而 naive Set
复用变体查键 `"a" + "\u0000" + "b\u0000c"` ＝ `"a\u0000b\u0000c"`，
与既有边 `("a\u0000b" → "c")` 的键**逐字节相同**——变体**接受**这个
畸形 join。执行结果：`current throws=true, naive accepts=true,
divergence=true`。即该变体会静默放宽校验面，与 S6-G-4 同性质的
"校验器替换发散"，直接封死 naive 方案。（顺带记录：:391 重复边检测
本身也有同样的键歧义，但那里两侧语义一致——歧义键只会把"本可通过的
NUL 流程图"误判为重复边而**收紧**拒绝，fail-closed 方向，无放宽风险，
不构成 bug 修复义务，本轮依规不做任何行为变更。）

**无碰撞变体与量级：** `Map<from, Set<to>>` 双层索引可做到与逐字段
精确比较严格等价。但实测收益上限：16 节点 / 18 边 / 4 扇入 join 下
边扫描全额 0.176µs、Set 查找 0.110µs，可移除量 **0.067µs/次
validateFlowchart**；每 run 走 32 轮 checkpoint 校验路径全额也只有
**0.002ms**。距十 ms 门槛差四个数量级。流程图规模受 maxTasks=16
契约钉死，E 无增长空间。**淘汰。**

### S7-G-2/S7-G-3/S7-G-4：三个合法但恒为噪声的微结构候选

三者等价性全部成立：S7-G-2 纯查表语义不变；S7-G-3 的 Set 变体保持
filter 遍历序（执行验证 `order+content identical=true`）；S7-G-4 的
索引队列 BFS 访问序与 `shift()` 完全一致（FIFO 语义不变，且
`TASK_TRANSITIONS` 邻接序为源码常量序，路径解唯一）。但三者宿主
函数实测全额分别为 8.2µs、0.111µs、0.50µs，乘以每 run 调用次数上限
（32/16/16）后合计 <0.28ms/run。与 S1-G-3、X4-6 的既有噪声裁决
同构，规模契约（8 状态、16 任务）钉死增长。**全部淘汰。**

### S7-G-5：resume 三段 I/O 链——数据依赖 + 排除家族双重封死

`resumeFlowchartRun` / `submitApprovalReply`（:866、:1008）的时序是
`replayRun(eventStore.readAll())` → `checkpointStore.read()` →
`loadLearnedRouting(stateRoot, replayed.project.rootPath)`。表面上三段
磁盘读串行，似有并行空间。裁决：(a) `loadLearnedRouting` 的第二参数
是 replay 产物，**真数据依赖**，不可提前；(b) checkpoint 读与事件读
的并行化正是 S5-G-4（跨 store Promise.all，错误面时序改变被封死）在
resume 端点的复现——replay 失败（如事件流损坏）时现实现**不会**发起
checkpoint 读，并行变体会，错误优先序与 I/O 副作用面改变；(c) 即使
并行成立，收益是一次 checkpoint 读（~µs~ms 级 SSD 读），每 resume
CLI 一次，非每轮路径。**淘汰，不再展开仿真。**

### 保行为面复核（第七遍，在六轮收口之上）

- 事件 schema、`EVENT_TYPES`、`payloadError` 分支：零 diff。
- `writeAtomic`（checkpoint-store / pause-controller）open→write→
  sync→rename 链：零 diff，crash-prefix 持久性维持。
- id 流：全部 `create*Id` 调用点与顺序未动，确定性 id 流维持。
- `EventStore.enqueue` 追加串行化队列：零 diff，事件顺序维持。
- 磁盘事实源（S1-G-1/S6-G-1/2/7 契约）：全部 readAll 调用点未动。
- 每轮双 persist（S6-G-6 恢复窗口契约）：未动。

### 逐文件收口（第七遍新视角补充，前六轮收口之上）

- `domain/flowchart.ts`（441 行，本切片最大 domain 文件）：校验语义
  全部承重；唯一 O(J·E) 热点即 S7-G-1，已裁决。DFS 环检测递归深度
  受 16 节点钉死，无栈风险，无改写价值。
- `domain/state.ts`：`expandTaskTransition` 即 S7-G-4；
  `RUN_TRANSITIONS`/`TASK_TRANSITIONS` 常量表 + `includes`，
  8 元素内 `includes` 与 Set 无差（S1-G-3 家族）。
- `domain/ids.ts`：`isId` 前缀 + regex（S3-G-5 已裁决不重开）；
  `createId` 每次 regex 校验 suffix 是 fail-closed 入口守卫，承重。
- `domain/timestamp.ts`：S6-G-4 封死，不重开。
- `domain/contract.ts`/`episode.ts`/`evidence.ts`/`task.ts`/`run.ts`/
  `limits.ts`/`project.ts`/`status.ts`/`roles.ts`/`record.ts`/`hash.ts`/
  `errors.ts`/`index.ts`：全部每对象一次线性校验或常量/barrel，
  µs 级噪声区，无候选。
- `graph/validate.ts`：Kahn（X4-6 收口）；`graph/readiness.ts`：
  topoOrder 线性扫 + 早停，已最优形态；`graph/judge.ts`：S7-G-3；
  `graph/compile-children.ts`：一次性编译 10.2µs，`byId`/`seen` 已是
  Map/Set 实现。
- `run/child-grounding.ts`/`child-prompt.ts`/`flowchart-executor.ts`：
  每子任务一次的字符串/数组组装，µs 级；`executeFlowchartNode` 的
  事件循环由 executor 异步流主导（LLM 秒级），循环体本身零热点。
- `supervisor/flowchart.ts`：纯 barrel。其余 supervisor / run 大文件
  （flowchart-supervisor、flowchart-run、event-store、episode-store、
  episode-bind、child-coordinator、replay、scheduler、coordinator、
  supervisor、events、inspection、checkpoint-store、pause-controller、
  injection、ledger、flowchart-snapshot）第七遍重读未发现任何
  前六轮四十二条排除未覆盖且 ≥十 ms 的新端点。

## 4. 前后对比

无代码改动。切片（含 A/B 区剔除文件在内的四目录全量）保持与 R1-G
基线 `4efee23` 逐字节一致，第七轮零漂移。本轮产出为：(a) 5 条新排除
（S7-G-1..5）；(b) **切片级计算面封顶论证**（<0.3ms/run 全额，见 §1）
——该论证使后续轮次可以直接跳过本切片纯计算候选枚举，本身即是
搜索空间收敛的净贡献。

## 5. 测试

```
$ pnpm gate   # typecheck + lint + test + build
tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1
typecheck: 通过（tsc --noEmit 零错误）
lint: 通过（eslint 零告警）
build: 通过（tsc -p tsconfig.build.json 零错误）
```

（skipped 1 为基线即存在的跳过用例，与本轮无关；切片零代码改动，
测试面与基线逐位一致。）

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-G-1 | validateJoin O(J·E) 边扫描改边对索引（复用 edgePairs Set / 新建 Map） | naive Set 复用被 NUL 键碰撞反例封死（接受现实现拒绝的畸形 join，校验面放宽）；无碰撞 Map 变体等价但 0.067µs/次、0.002ms/run＝噪声，规模被 maxTasks=16 钉死 |
| S7-G-2 | validateFlowchart/validateCondition 字面量数组提升模块级 Set | S1-G-3 噪声家族；宿主全额 8.2µs/次、0.26ms/run 上限 |
| S7-G-3 | DeterministicJudge.decide 的 filter+includes 改 Set | 等价成立（filter 序保持）但 0.111µs/次、0.0018ms/run＝噪声 |
| S7-G-4 | expandTaskTransition BFS queue.shift 改索引队列 | X4-6 同家族；状态图恒 8 节点，0.50µs/次、0.008ms/run＝噪声 |
| S7-G-5 | resume/approval 路径 replay→checkpoint 读→learned-routing 读并行化 | 真数据依赖（rootPath 来自 replay 产物）+ S5-G-4/S6-G-5 Promise.all 错误面时序排除家族在 resume 端点复现 |

重开条件：S7-G-1..4 共同前提是流程图/状态规模契约放大 ≥2 个数量级
（maxTasks=16 → ≥1600 或事件级高频调用出现），届时按本报告基准数据
线性外推即可先验估收益；S7-G-1 若重开**必须**用无碰撞索引
（Map<from, Set<to>> 或长度前缀键），本报告 NUL 反例可直接作为其
回归用例；S7-G-5 维持 S5-G-4/S6-G-5 重开条件（错误面时序契约的
显式重定义）。另立**切片级封顶结论**：在 maxTasks=16 契约不变前提下，
本切片纯计算候选全额上限 <0.3ms/run，后续轮次可凭本条直接跳过
该类枚举。

## 附录：确定性基准 / 反例脚本（完整，可复现）

运行：`cd /workspace && node_modules/.bin/tsx <script>.mts`
（Node v22.22.2；固定输入两规模形态作双 seed；两次独立运行计时
抖动 <2%，等价/反例布尔结论逐位一致。）

```typescript
import { performance } from "node:perf_hooks";
import { validateFlowchart, type Flowchart, type FlowEdge, type FlowNode } from "/workspace/src/domain/flowchart.js";
import { DeterministicJudge } from "/workspace/src/graph/judge.js";
import { expandTaskTransition } from "/workspace/src/domain/state.js";
import { compileChildrenToFlowchart, compilableChildFrom } from "/workspace/src/graph/compile-children.js";
import type { EvidenceId, TaskId } from "/workspace/src/domain/ids.js";
import type { VerificationResult } from "/workspace/src/protocol/v1.js";

function buildFlowchart(nodeCount: number, joinFanIn: number): Flowchart {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const id = `n${i}`;
    const isJoin = i === nodeCount - 1;
    const joinSources = isJoin
      ? Array.from({ length: joinFanIn }, (_, k) => `n${nodeCount - 2 - k}`)
      : [];
    nodes.push({
      id,
      taskId: `tsk_task${i}` as TaskId,
      role: "actor",
      objective: `objective ${i}`,
      modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
      confidenceThreshold: 0.7,
      approvalRequired: false,
      ...(isJoin ? { joinPolicy: { mode: "all" as const, requiredNodeIds: joinSources } } : {})
    });
    if (i > 0 && !isJoin) {
      edges.push({ from: `n${i - 1}`, to: id, condition: { type: "success", expected: true } });
    }
    if (isJoin) {
      for (const src of joinSources) {
        edges.push({ from: src, to: id, condition: { type: "success", expected: true } });
      }
    }
  }
  return { id: "bench", nodes, edges };
}

function bench(label: string, iters: number, fn: () => void): number {
  for (let i = 0; i < Math.min(iters, 2000); i++) fn(); // warmup
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const perCallUs = ((performance.now() - t0) / iters) * 1000;
  console.log(`${label}: ${perCallUs.toFixed(3)} us/call`);
  return perCallUs;
}

// ---- S7-G-1/S7-G-2: validateFlowchart（每轮 checkpoint 校验路径） ----
const fcSeedA = buildFlowchart(16, 4); // maxTasks 默认上限
const fcSeedB = buildFlowchart(8, 2);
const vfA = bench("validateFlowchart 16n join4 (seedA)", 20000, () => validateFlowchart(fcSeedA));
bench("validateFlowchart  8n join2 (seedB)", 20000, () => validateFlowchart(fcSeedB));
console.log(`  -> per-run (32 rounds, seedA): ${(vfA * 32 / 1000).toFixed(3)} ms\n`);

// ---- S7-G-1: 边对索引可移除份额 ----
const joinNode = fcSeedA.nodes[fcSeedA.nodes.length - 1]!;
const required = joinNode.joinPolicy!.requiredNodeIds;
const edgesArr = fcSeedA.edges;
const scanUs = bench("join scan edges.some x4 refs", 200000, () => {
  for (const r of required) {
    if (!edgesArr.some((e) => e.from === r && e.to === joinNode.id)) throw new Error("bad");
  }
});
const pairSet = new Set(edgesArr.map((e) => `${e.from}\u0000${e.to}`));
const setUs = bench("join scan Set-lookup x4 refs", 200000, () => {
  for (const r of required) {
    if (!pairSet.has(`${r}\u0000${joinNode.id}`)) throw new Error("bad");
  }
});
console.log(`  -> removable per validateFlowchart: ${(scanUs - setUs).toFixed(3)} us; per-run (32 rounds): ${((scanUs - setUs) * 32 / 1000).toFixed(4)} ms\n`);

// ---- S7-G-3: DeterministicJudge.decide ----
const judge = new DeterministicJudge();
const evidenceIds = Array.from({ length: 8 }, (_, i) => `evd_e${i}` as EvidenceId);
const verification: VerificationResult = { kind: "PASSED", evidenceIds: [...evidenceIds] } as VerificationResult;
const judgeUs = bench("DeterministicJudge.decide 8x8", 100000, () => {
  judge.decide({ taskId: "tsk_t" as TaskId, verification, evidenceIds });
});
console.log(`  -> per-run (16 decisions): ${(judgeUs * 16 / 1000).toFixed(4)} ms\n`);

// ---- S7-G-4: expandTaskTransition BFS ----
const expandUs = bench("expandTaskTransition PENDING->FAILED", 200000, () => {
  expandTaskTransition("PENDING", "FAILED");
});
console.log(`  -> per-run (16 expansions): ${(expandUs * 16 / 1000).toFixed(4)} ms\n`);

// ---- S7-G-1 反例：naive edgePairs-Set 复用在 NUL id 上发散 ----
// 节点 "a","a\u0000b","c","b\u0000c"；唯一边 ("a\u0000b" -> "c")。
// "b\u0000c" 上的 join 要求 "a"：不存在边 a->b\u0000c，现实现精确扫描抛错；
// 而既有边的键 "a\u0000b\u0000c" 与 (a -> b\u0000c) 的键逐字节相同，
// naive Set 复用变体会接受。
const nulFc = {
  id: "nul",
  nodes: ["a", "a\u0000b", "c", "b\u0000c"].map((id, i) => ({
    id,
    taskId: `tsk_nul${i}`,
    role: "actor",
    objective: `o${i}`,
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: 0.7,
    approvalRequired: false,
    ...(id === "b\u0000c" ? { joinPolicy: { mode: "all", requiredNodeIds: ["a"] } } : {})
  })),
  edges: [{ from: "a\u0000b", to: "c", condition: { type: "success", expected: true } }]
};
let currentThrows = false;
try {
  validateFlowchart(nulFc);
} catch {
  currentThrows = true;
}
const nulPairSet = new Set(nulFc.edges.map((e) => `${e.from}\u0000${e.to}`));
const naiveSetAccepts = nulPairSet.has(`a\u0000b\u0000c`);
console.log(`S7-G-1 counterexample: current validateFlowchart throws=${currentThrows}, naive Set-reuse would accept=${naiveSetAccepts} -> divergence=${currentThrows && naiveSetAccepts}\n`);

// ---- S7-G-3 等价：Set 变体保持 filter 序 ----
const verifSet = new Set(verification.evidenceIds);
const filtered = evidenceIds.filter((id) => verification.evidenceIds.includes(id));
const setFiltered = evidenceIds.filter((id) => verifSet.has(id));
console.log(`S7-G-3 equivalence: order+content identical=${JSON.stringify(filtered) === JSON.stringify(setFiltered)}\n`);

// ---- 一次性编译基底 ----
const children = Array.from({ length: 16 }, (_, i) =>
  compilableChildFrom({
    taskId: `tsk_c${i}` as TaskId,
    role: "worker",
    objective: `obj ${i}`,
    ...(i > 0 ? { dependsOn: [`tsk_c${i - 1}` as TaskId] } : {})
  })
);
bench("compileChildrenToFlowchart 16 children (one-shot per run)", 20000, () => {
  compileChildrenToFlowchart(children);
});
```

两次独立运行输出（关键行）：

```
run 1:
validateFlowchart 16n join4 (seedA): 8.049 us/call
validateFlowchart  8n join2 (seedB): 4.180 us/call
join scan edges.some x4 refs: 0.175 us/call
join scan Set-lookup x4 refs: 0.109 us/call
  -> removable: 0.066 us; per-run: 0.0021 ms
DeterministicJudge.decide 8x8: 0.111 us/call -> 0.0018 ms/run
expandTaskTransition PENDING->FAILED: 0.495 us/call -> 0.0079 ms/run
compileChildrenToFlowchart 16 children: 10.066 us/call

run 2:
validateFlowchart 16n join4 (seedA): 8.206 us/call
validateFlowchart  8n join2 (seedB): 4.135 us/call
join scan edges.some x4 refs: 0.176 us/call
join scan Set-lookup x4 refs: 0.110 us/call
  -> removable: 0.067 us; per-run: 0.0021 ms
DeterministicJudge.decide 8x8: 0.111 us/call -> 0.0018 ms/run
expandTaskTransition PENDING->FAILED: 0.501 us/call -> 0.0080 ms/run
S7-G-1 counterexample: current throws=true, naive Set-reuse accepts=true -> divergence=true
S7-G-3 equivalence: order+content identical=true
compileChildrenToFlowchart 16 children: 10.192 us/call
```

MODEL_SLUG=claude-fable-5-thinking-xhigh

# R1-E：`src/learning/` 切片 SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-E（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `adb20d7`
**分支:** `cursor/r1e-learning-slice-5cd3`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** `src/learning/` 全部 10 个文件（1770 行）
逐一通读并以新视角重新枚举，得到 8 个此前排除表未点名的候选（S1-E-1 … S1-E-8），
全部经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz + 真实规模基准，三次独立
运行方向一致）裁决后淘汰：1 个不等价（两个发散反例），5 个等价但真实规模噪声级
（其中 2 个在其各自的中等/测试规模上**实测更慢**），1 个被同路径磁盘 I/O 以约
10³ 倍支配，1 个是 I/O 并发调整而非复杂度下降且现实规模亚毫秒。本切片的每个
生产热面都已处于其输出契约与数据面语义所要求的渐近下界；现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` / `bandit-store` /
  `diagnostics` / `from-episode` / `learned-routing` / `patterns` / `signals` /
  `signatures` / `task-success`）全量读码。上下游 `adaptation/`（candidate、
  promotion、approval-profile）、`routing/`（bandit、outcomes、failure-class、
  catalog-model）、`feedback/store`、`persist/file-lock` 只读取证，一行未改
  ——遵守「不改 adaptation 实现文件（可 import）」。
- 遵守排除表：X0-3（auto-loop 与 from-episode 候选创建主体合并——两处保存时机
  语义不同，维持分离）、X2-6（patterns 相似度对键记忆化 / averageSimilarity 复用
  clusterSignatures 中间值）、X1-1（模块级隐藏缓存，覆盖 `stableProjectKey` 结果
  缓存等一切跨调用记忆化）、X0-5（合并私有 asRecord 类助手）全部未触碰；候选
  枚举刻意绕开这些方案，只探索**未被排除的新角度**（扫描合并、重复求值去重、
  字符串累积策略、循环融合、排序换 min 扫描、调用域内预取、I/O 并发）。
- 既往逐文件裁决维持并复核成立：Iter2 S16（diagnostics 单遍分组；patterns 贪心
  聚类 O(n²) 是算法定义）、Iter3 S21–S23（`unique` O(k²) 上界 kind 种类数；
  task-success/signatures 纯构造）、Iter4 §1.5（from-episode routes Map 单遍、
  FAMILIES.includes 上界 8；learned-routing avoided Set 已建、live 面 M≤10；
  bandit-store arms 个位数、全量重建 state 是文件锁内一次性持久化；attribution
  边界排序上界 8）。
- 行为面全部不变：`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS 晋升）、
  SPARKLE_AUTO_ADAPT=0 仍收集、taskSuccess 伪造 fail-closed
  （`parseObservedSignal` 拒绝 user/human 伪造 + `collectSignalsFromEvents` 只由
  确定性适配器写该 criterion）、`ensureRoutingBaseline` 绝不移动既有指针——
  本轮零 diff，天然满足。

## 1. 现实规模测量（门槛第 3 条的证据基底）

本切片的生产入口只有两类，规模全部有界且小：

- **post-run 自适应环**（`runAutoAdaptLoop`，由 `track/loop`、CLI `adapt auto`、
  `cli/main` 在 run 结束后各调一次）：事件表 E≈41（R1-A 实测的完整 tracked run：
  10 MODEL_ROUTED、10 CHILD_MESSAGE、个位数 USER_ANSWER/JUDGE），产出信号
  S≈10–15；subagent 目录现实为**个位数** JSON 文件；诊断分组数 ≤ 项目内模型数
  （M≤10）。整个环被磁盘 I/O 支配：每信号一次 `appendFeedback`（redaction +
  jsonl 追加，实测 **96–192µs/次**）+ bandit 文件锁读写 + registry 锁内读写。
- **live 装配面**（`applyLearnedRouting`，每任务一次）：avoid/prefer 与 catalog
  均 ≤10（Iter4 已裁决，X3-1 同域）。

`detectRepeatedPatterns` / `attributeToBoundary` / `compareSignatures` /
`createSignature` 经全库交叉检索确认**无任何生产调用方**（仅
`test/unit/learning/patterns.test.ts` 与 `test/acceptance/adaptive-loop.test.ts`
使用，n≤6）——该面上的任何优化在生产中不可测。

```text
anchor: one redundant filter(3 ids)=110ns vs one appendFeedback=96-192us (~10^3 x) per signal
anchor: collectSignalsFromEvents over the 41-event run fixture = ~13.5us per call
```

## 2. 结构下界论证（为什么渐近层面没有余地）

| 函数 | 下界论证 |
| --- | --- |
| `collectSignalsFromEvents` | 两遍各 Θ(E)：第一遍全局解析 project/route 绑定使输出**与事件顺序解耦**（迟到 PROJECT_DISCOVERED、结果后重路由均正确绑定）——这是语义本体，单遍合并有发散反例（S1-E-1）；第二遍产出即输出 |
| `outcomesFromRoutedRun` | 单遍 Θ(E) routes-so-far + TASK_RETRY 级联语义已是下界（与上函数语义不同是行为差异，不是冗余） |
| `policyFromOutcomes` / `optimizedPolicy` | 单遍 + seen Set 去重，Θ(N) |
| `proposeRoutingFromOutcomes` / `proposeAndMaybePromote` | registry 锁内 load→find→create→save 是 CAS 提案协议本体；两处主体合并=X0-3 |
| `persistSignals` | Θ(S) 次 appendFeedback 逐条追加是 feedback 数据面契约；每次 ~10²µs I/O 支配一切 CPU 微优化 |
| `ingestSubagentDirectory` | Θ(文件数) 读取不可省；并发化非复杂度下降（S1-E-5） |
| `updateProjectBandit` | 文件锁内一次性重建 + Θ(S×M)，M≤10（Iter4 已点名）；in-slice 增量累加需复制 `recordReward` 语义=平行实现（X1-2 同类） |
| `diagnoseModelProjectIssues` | Θ(S) 分组 + Θ(G) 聚合；全组统计（mean/failures/kinds/mode）是输出契约 |
| `applyLearnedRouting` | avoided Set 已建；Θ(avoid + M)，M≤10 live 面（Iter4 已裁决） |
| `parseLearnedRoutingPolicy` / `parseObservedSignal` | 全字段校验是 fail-closed 契约（含 taskSuccess 伪造拒绝），Θ(字段) |
| `detectRepeatedPatterns` | 贪心 O(n²) 聚类是算法定义（换法改聚类结果，Iter2 已裁决）；无生产调用方 |
| `attributeToBoundary` | 输出需 min over patterns ⇒ Ω(P)；现 O(P log P) 可降 O(P)（S1-E-7）但 P≤8 且 test-only |
| `task-success` / `signatures` / `attribution` 其余 | 纯构造 Θ(字段)；`findNegativeControlMarker` O(5×cluster) 单遍 |

结论：剩余候选只能是 E≈41 / S≈12 / M≤10 / 个位数文件尺度上的常数因子与分配
削减，或无生产流量面上的改良——正是战役已反复裁决为噪声的类别。

## 3. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-E-1 | `collectSignalsFromEvents` 两遍事件扫描合并单遍 | 2×Θ(E)→1×Θ(E) | ❌ **两个发散反例** | — | 淘汰：不等价（§4.1） |
| S1-E-2 | JUDGE_DECISION 分支 `roleByTask`/`familyByTask` 双重 `Map.get` 去重 | 每 judge 事件省 2 次 Map 查询 | ✅ 4000 fuzz 一致（createdAt 归一化后逐字节） | E=41 全 run delta 在 **±ns 抖动内**（+8/+69/−278ns 三次运行） | 淘汰：亚噪声 |
| S1-E-3 | `extractAssistant` 字符串折叠改 parts 数组 + join（忠实保留空前缀吸收语义） | Θ(总长²) 字节拷贝→Θ(总长) | ✅ 4000 fuzz 一致 | 现实 6 段省 ~230ns/文件；500 段×200B 极端也仅 120→103µs（1.15×）——**V8 cons-string 使现实现已近线性** | 淘汰：噪声，理论收益被引擎表示吸收 |
| S1-E-4 | `persistSignals` 的 `evidenceIds.filter(isEvidenceId)` 双重求值去重 | 每信号省 1 次 O(E) filter | —（filter 纯函数，平凡等价） | 冗余 filter=110ns vs 同信号 `appendFeedback`=96–192µs（**~10³×**） | 淘汰：被 I/O 支配，深度噪声（S1-B-1 同类） |
| S1-E-5 | `ingestSubagentDirectory` 顺序读改 `Promise.all` 并行 | I/O 等待重叠 | ✅ 20 文件（含损坏/非 JSON）输出逐字节一致 | 现实 6 文件省 ~0.2ms/次；60 文件（超现实一个量级）省 ~1.2ms——一次性 post-run 路径 | 淘汰：非复杂度下降；亚毫秒一次性收益低于既往噪声线（S1-B 捆绑 0.57ms/eval 先例）；无界并行 open 有 fd 耗尽风险 |
| S1-E-6 | `diagnoseModelProjectIssues` 组内 4 遍（reduce/filter/map×2 + mode）融合进分组单遍 | 5 遍→1 遍；浮点求和序与 mode 平局语义逐位保留 | ✅ 5000 fuzz 一致 | 真实 S=12 省 **2–9ns**；10× S=120 **实测反而更慢**（−66/−83/−81ns 三次）；仅 S=5000（超现实两个量级）才 1.4× | 淘汰：真实规模亚噪声 + 中等规模负优化（S1-A-4/S1-B-6 同类反例第三例） |
| S1-E-7 | `attributeToBoundary` `[...].sort()[0]` 换单遍 min 扫描 | O(P log P)→O(P)，免拷贝免排序 | ✅ 6000 fuzz 一致（含 junk kind indexOf=-1 路径；稳定排序首位 ⇔ 严格小于首现 min） | P=8：216→59ns（3.5×）——但绝对量 ~160ns 且**无生产调用方** | 淘汰：test-only 面，收益在生产不可测 |
| S1-E-8 | `detectRepeatedPatterns` 调用域内每签名 `Object.keys` 预取 + 并集 Set 直接迭代（免每对 2 次 keys 分配 + 1 次数组拷贝；非 X2-6 的对键相似度记忆化） | O(n²) 对循环常数下降 | ✅ 2500 fuzz 一致 | 测试规模 n=6 **实测更慢**（0.71–0.78×，Map 构建开销）；n=40 1.15×、n=400 1.08–1.12×——且无生产调用方 | 淘汰：小规模负优化 + 无生产流量；更深路线是 X2-6 |

另有三处以既有排除/裁决直接覆盖、不立新 ID：`stableProjectKey` 结果缓存
（X1-1）；`updateProjectBandit` 的 `arms.includes` Set 化与 reward 循环增量化
（Iter4 §1.5 已点名 + 增量化即 X1-2 类平行实现）；`familyFromRouted` 的
`FAMILIES.includes` Map 化（Iter4 已点名，上界 8）。

## 4. 关键裁决细节

### 4.1 S1-E-1 的发散反例

```text
反例 A（迟到 PROJECT_DISCOVERED）:
  events = [USER_ANSWER("lgtm"), PROJECT_DISCOVERED(prj)]
  current → 1 个 userAcceptance 信号    merged → 0 个（信号被丢弃）
反例 B（结果后重路由）:
  events = [PROJECT_DISCOVERED, MODEL_ROUTED(t1→modelA),
            CHILD_MESSAGE(TASK_RESULT t1), MODEL_ROUTED(t1→modelB)]
  current → 信号绑定 modelB             merged → 绑定 modelA
```

当前实现的第一遍全局扫描使 project/route 解析**对事件顺序无假设**——这与
`outcomesFromRoutedRun` 刻意选择的 routes-so-far 语义（级联重试归因）是两个
不同的契约，各自正确。单遍合并把前者静默改成后者，属行为改变而非优化。
与 S1-A-9（nextTrackingSeq 反向扫描）同类：候选隐含「追加序=语义序」不变量，
而事件表在重放/合并场景无处强制它。为将来任何「信号收集单遍化」提案立此反例。

### 4.2 S1-E-6 / S1-E-8 的反向教训（理论被仿真推翻，战役第三、四例）

S1-E-6 纸面上 5 遍变 1 遍必赚，但 10× 规模（S=120）三次运行**一致更慢**
（每组增量结构的 Map/对象开销 > 个位数长度数组的连续多遍扫描），真实规模
（S=12）差异 2–9ns 在抖动内。S1-E-8 在测试规模 n=6 同样一致更慢
（每签名 Map 预取的构建成本 > 直接 Object.keys 于 3–8 键小对象）。与 S1-A-4
（prescore Set 化更慢）、S1-B-6（routeR0 Map 化更慢）构成同一教训的系列证据：
**小集合上索引/预取结构的固定开销高于线性重算**。后续轮次禁止以纯理论重提
此类候选。

### 4.3 S1-E-4 / S1-E-5 为何按 I/O 支配淘汰

`persistSignals` 每信号做一次 `appendFeedback`（redaction + `appendJsonlLine`
磁盘追加），实测 96–192µs；同信号上的冗余 filter 仅 110ns——占比 ~0.1%，任何
CPU 微优化在此路径都不可测。`ingestSubagentDirectory` 并行化在现实个位数文件
上省 ~0.2ms（一次性 post-run），量级低于战役已淘汰的 S1-B 捆绑（0.57ms/eval）；
且 `Promise.all` 无界并发在对抗性文件数下有 fd 耗尽风险，顺序读的确定性
资源使用是更稳的默认。两者均不构成「复杂度下降」，收益/风险裁决：不动。

### 4.4 diagnostics 的「恒真守卫」裁决保留

`diagnoseModelProjectIssues` 过滤后所有入组信号 `kind === "deterministic"`，
故 `kinds` 恒为 `["deterministic"]`、`independent` 恒真——`unique`/`includes`
一段在现行过滤器下不可达非平凡分支。与 R1-A 对 `mapGateDirective` 的
FAIL_CLOSED 默认裁决同理：这是面向过滤器未来放宽的 fail-closed 守卫
（防止 human 混入组后仍被判 actionable），删除属负优化，保留。

## 5. 逐文件收口

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S1-E-1/2/3 淘汰；`truncate` 正则与 `baseSignal` 11 个条件 spread 为构造本体、分配级噪声；`parseObservedSignal` 全字段校验含 taskSuccess 伪造拒绝为契约 | 无候选 |
| `auto-loop.ts` | S1-E-4/5 淘汰；`proposeAndMaybePromote` 与 from-episode 主体合并=X0-3 维持；`signals.some(modelId)` 门 + bandit 双扫 S 个位数 | 无候选 |
| `from-episode.ts` | routes Map 单遍（Iter4 复核成立）；`applyCascadeRetry` includes 上界 M；`isCompleteRoute`/`outcomeKindFromResult` 常数；try/catch 逐条吞错是 fail-closed 采集契约 | 无候选 |
| `learned-routing.ts` | `applyLearnedRouting` avoided Set 已建（Iter4）；`stableProjectKey` 缓存=X1-1；`ensureRoutingBaseline` 指针不动语义为契约；`saveLearnedRouting` 拒写为数据面守卫 | 无候选 |
| `bandit-store.ts` | Iter4 已点名维持；reward 循环增量化需复制 `recordReward` 语义（X1-2 类）；锁内读-建-写为一次性持久化契约 | 无候选 |
| `diagnostics.ts` | S1-E-6 淘汰；恒真守卫保留（§4.4）；`unique` O(k²) k≤3（Iter3 复核成立） | 无候选 |
| `patterns.ts` | S1-E-8 淘汰；对键记忆化=X2-6 维持；贪心聚类次序是算法定义；无生产调用方 | 无候选 |
| `attribution.ts` | S1-E-7 淘汰；`findNegativeControlMarker` O(5×cluster) 单遍即下界；BOUNDARY_ORDER indexOf 上界 8 | 无候选 |
| `signatures.ts` | `compareSignatures` 与 computeFeatureSim 同构、hash 早退已存在；test-only 面 | 无候选 |
| `task-success.ts` | 纯构造 + `copyDefinedBinding` 条件 spread；PARTIAL/CANCELLED/UNOBSERVED 省略为规格 | 无候选 |

## 6. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 7. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r1e-sim.mts`，未入库以遵守「不改切片外文件」约束；完整
源码见附录，seed 固定可复现）最终一次运行：

```text
S1-E-2 bench E=41 run: current=13568ns cand=13846ns delta=-278ns/run
S1-E-1 counterexamples: A current=1 signal(s) merged=0; B current binds modelB merged binds modelA -> NOT equivalent
S1-E-3 bench realistic(6 parts): current=3816ns cand=3546ns | stress(500x200B parts): current=120.4us cand=103.2us
S1-E-6 bench real S=12: current=103ns cand=94ns delta=9ns/call
S1-E-6 bench 10x S=120: current=687ns cand=768ns delta=-81ns/call
S1-E-6 bench stress S=5000: current=184717ns cand=130777ns delta=53940ns/call
S1-E-7 bench P=8: current=218ns cand=51ns (no production caller; test-only face)
S1-E-8 bench n=6: current=1.22us cand=1.55us (0.78x; no production caller)
S1-E-8 bench n=40: current=33.62us cand=28.61us (1.18x; no production caller)
S1-E-8 bench n=400: current=4224.54us cand=3897.41us (1.08x; no production caller)
S1-E-4 anchor: one redundant filter(3 ids)=110ns vs one appendFeedback=95.9us (871x) per signal
S1-E-5 bench 6 files: sequential=407us parallel=192us delta=214us/ingest
S1-E-5 bench 60 files: sequential=3943us parallel=2811us delta=1132us/ingest

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 21500 项等价检查全部通过、结论逐位一致；计时抖动内方向稳定
（S1-E-6 10× 三次全部更慢；S1-E-8 n=6 三次全部更慢；S1-E-2 delta 三次异号
确认为纯抖动）。

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-E-1 | collectSignalsFromEvents 两遍事件扫描合并单遍 | 不等价：迟到 PROJECT_DISCOVERED 丢信号、结果后重路由绑错模型两个发散反例（S1-A-9 同类） |
| S1-E-2 | signals JUDGE_DECISION 分支 role/family 双重 Map.get 去重 | 等价但 E=41 全 run delta 在 ±ns 抖动内，亚噪声 |
| S1-E-3 | extractAssistant 字符串折叠改 parts+join | 等价但 V8 cons-string 使现实现近线性；现实 6 段省 ~230ns，500 段极端仅 1.15× |
| S1-E-4 | persistSignals evidenceIds.filter 双重求值去重 | 等价但 110ns vs 同信号 appendFeedback ~10²µs I/O（~10³×），深度噪声 |
| S1-E-5 | ingestSubagentDirectory Promise.all 并行读 | 输出等价但非复杂度下降；现实个位数文件省 ~0.2ms 一次性；无界并发 fd 风险 |
| S1-E-6 | diagnoseModelProjectIssues 组内多遍融合单遍 | 等价但真实 S=12 省 2–9ns、10× 实测更慢（S1-A-4/S1-B-6 同类反例） |
| S1-E-7 | attributeToBoundary 排序换单遍 min 扫描 | 等价且 3.5×，但绝对量 ~160ns、P≤8 且无生产调用方（test-only 面） |
| S1-E-8 | detectRepeatedPatterns 调用域内 Object.keys 预取 + 并集 Set 直接迭代 | 等价但测试规模 n=6 实测更慢；无生产调用方；更深路线为 X2-6 |

重开条件：S1-E-2/3/4/6 若信号管道进入每 turn 热路径或事件/信号规模增长 ≥2 个
量级，可凭本报告等价性证据重开；S1-E-5 需先给出有界并发方案 + 现实文件数增长
两个量级的证据；S1-E-7/8 需先出现 `detectRepeatedPatterns`/`attributeToBoundary`
的生产调用方；S1-E-1 需先推翻本报告的发散反例（即证明事件表全局有序不变量）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装；
`.mts` 扩展名保证 ESM 顶层 await 可用）。seeds：`0xe11e01`–`0xe11e0a`。

```ts
/**
 * R1-E deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-E-1 .. S1-E-8 against the current
 * implementations in src/learning/. Seeded PRNG (mulberry32) -> fully
 * reproducible. Seeds 0xe11e01-0xe11e08.
 *
 * Reference = production imports. Candidates = full replicas whose only
 * difference from the verbatim-copied private helpers is the candidate edit.
 */
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun,
  scoreTaskResult,
  scoreUserAnswer,
  type ObservedSignal,
  type SignalContext
} from "/workspace/src/learning/signals.js";
import {
  taskSuccessFromResult,
  type TaskSuccessRouteBinding
} from "/workspace/src/learning/task-success.js";
import { diagnoseModelProjectIssues, type ModelProjectIssue } from "/workspace/src/learning/diagnostics.js";
import { attributeToBoundary, findNegativeControlMarker } from "/workspace/src/learning/attribution.js";
import { detectRepeatedPatterns, isSevereSafetySignature, type Pattern, type PatternDetectorOptions } from "/workspace/src/learning/patterns.js";
import type { EpisodeSignature, EpisodeSignatureKind } from "/workspace/src/learning/signatures.js";
import { isEvidenceId, type EpisodeId, type ProjectId, type RunId, type TaskId } from "/workspace/src/domain/ids.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import { appendFeedback } from "/workspace/src/feedback/store.js";
import type { FeedbackRecord, FeedbackKind } from "/workspace/src/feedback/types.js";
import type { Event } from "/workspace/src/run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { nowIso } from "/workspace/src/domain/timestamp.js";
import type { OutcomeCriterion, OutcomeKind } from "/workspace/src/routing/outcomes.js";

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
/** createdAt is nowIso() captured per call; normalize it for cross-call comparison. */
function norm(signals: readonly ObservedSignal[]): string {
  return JSON.stringify(signals.map((s) => ({ ...s, createdAt: "T" })));
}

/* ================================================================
 * Verbatim private-helper replicas from src/learning/signals.ts.
 * Candidates below differ from these ONLY by the candidate edit.
 * ================================================================ */
const USER_NEGATIVE = /\b(no|wrong|revert|reject|bad|不行|错误)\b/i;
const USER_POSITIVE = /\b(lgtm|good|ship|approve|yes|可以)\b/i;
const PEER_NEGATIVE = /\b(fail|bug|issue|missing|violation|unknown agent|错误)\b/i;
void USER_NEGATIVE;
void USER_POSITIVE;

type EpisodeSignatureKindLocal = EpisodeSignatureKind;

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

function baseSignal(input: {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKindLocal;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: RunId | undefined;
  taskId?: TaskId | undefined;
  modelId?: string | undefined;
  modelVersion?: string | undefined;
  role?: string | undefined;
  family?: string | undefined;
  featureVersion?: string | undefined;
  criterion?: OutcomeCriterion | undefined;
  outcomeKind?: OutcomeKind | undefined;
  evidenceIds?: readonly string[] | undefined;
}): ObservedSignal {
  return {
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    score: input.score,
    boundary: input.boundary,
    summary: input.summary,
    createdAt: input.createdAt,
    evidenceIds: input.evidenceIds ?? [],
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.modelVersion !== undefined ? { modelVersion: input.modelVersion } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.featureVersion !== undefined ? { featureVersion: input.featureVersion } : {}),
    ...(input.criterion !== undefined ? { criterion: input.criterion } : {}),
    ...(input.outcomeKind !== undefined ? { outcomeKind: input.outcomeKind } : {}),
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  };
}

function familyFromRole(role: string | undefined): string | undefined {
  if (role === "critic" || role === "reviewer") return "review";
  if (role === "tester") return "test";
  if (role === "scout") return "research";
  if (role === "planner") return "plan";
  if (role === "actor" || role === "implementer" || role === "worker" || role === "debugger") return "edit";
  return undefined;
}

function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAssistantRef(messages: unknown): { text: string; model?: string } {
  if (!Array.isArray(messages)) return { text: "" };
  let text = "";
  let model: string | undefined;
  for (const message of messages) {
    if (!isRecordLocal(message) || message.role !== "assistant") continue;
    if (typeof message.model === "string" && message.model.trim() !== "") {
      model = message.model;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecordLocal(part)) continue;
      if (part.type === "thinking") continue;
      if (part.type === "text" && typeof part.text === "string") {
        text = text === "" ? part.text : `${text}\n${part.text}`;
      }
    }
  }
  return model !== undefined ? { text, model } : { text };
}

type SignalCtx = {
  projectId: ProjectId;
  modelByTask: ReadonlyMap<string, string>;
  modelVersionByTask: ReadonlyMap<string, string>;
  roleByTask: ReadonlyMap<string, string>;
  familyByTask: ReadonlyMap<string, string>;
  featureVersionByTask: ReadonlyMap<string, string>;
  episodeId?: EpisodeId | undefined;
  createdAt: IsoTimestamp;
};

function signalFromAgentMessage(message: AgentMessage, ctx: SignalCtx): ObservedSignal | undefined {
  if (message.type === "TASK_RESULT") {
    const modelId = ctx.modelByTask.get(message.taskId);
    const role = ctx.roleByTask.get(message.taskId);
    const family = ctx.familyByTask.get(message.taskId) ?? familyFromRole(role);
    const modelVersion = ctx.modelVersionByTask.get(message.taskId);
    const featureVersion = ctx.featureVersionByTask.get(message.taskId);
    const unverified = message.outcome === "SUCCESS" && message.verification.kind === "UNOBSERVED";
    const binding: TaskSuccessRouteBinding = {
      ...(modelId !== undefined ? { modelId } : {}),
      ...(modelVersion !== undefined ? { modelVersion } : {}),
      ...(family !== undefined ? { family } : {}),
      ...(featureVersion !== undefined ? { featureVersion } : {}),
      ...(role !== undefined ? { role } : {})
    };
    const taskSuccess = taskSuccessFromResult(message.outcome, message.verification.kind, binding);
    return baseSignal({
      source: "subagent",
      kind: "deterministic",
      projectId: ctx.projectId,
      score: scoreTaskResult(message.outcome, message.verification.kind),
      boundary: "execution",
      summary: truncate(
        `${unverified ? "unverified-success " : ""}TASK_RESULT ${message.outcome}: ${message.summary}`
      ),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      evidenceIds: message.evidenceIds,
      ...(taskSuccess !== undefined
        ? {
            criterion: taskSuccess.criterion,
            outcomeKind: taskSuccess.outcomeKind,
            ...(taskSuccess.modelVersion !== undefined ? { modelVersion: taskSuccess.modelVersion } : {}),
            ...(taskSuccess.featureVersion !== undefined
              ? { featureVersion: taskSuccess.featureVersion }
              : {})
          }
        : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(family !== undefined ? { family } : {})
    });
  }
  if (message.type === "PEER_MESSAGE") {
    const score = PEER_NEGATIVE.test(message.body) ? 25 : 65;
    const modelId = ctx.modelByTask.get(message.taskId);
    return baseSignal({
      source: "subagent",
      kind: "peer",
      projectId: ctx.projectId,
      score,
      criterion: "policyCompliance",
      outcomeKind: score < 40 ? "FAIL" : "PASS",
      boundary: "review",
      summary: truncate(`peer: ${message.body}`),
      createdAt: ctx.createdAt,
      episodeId: ctx.episodeId,
      runId: message.runId,
      taskId: message.taskId,
      ...(modelId !== undefined ? { modelId } : {})
    });
  }
  return undefined;
}

/* ================================================================
 * S1-E-2 candidate: collectSignalsFromEvents replica, two passes kept,
 * JUDGE_DECISION branch deduplicates the double roleByTask/familyByTask gets.
 * ================================================================ */
function candidateCollectDedup(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) familyByTask.set(event.payload.taskId, event.payload.family);
      if (event.payload.modelVersion !== undefined) modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      if (event.payload.featureVersion !== undefined) featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
    }
  }
  if (projectId === undefined) return [];

  for (const event of events) {
    if (event.type === "CHILD_MESSAGE") {
      const fromResult = signalFromAgentMessage(event.payload.message, {
        projectId, modelByTask, modelVersionByTask, roleByTask, familyByTask, featureVersionByTask,
        episodeId: context.episodeId, createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(baseSignal({
        source: "user", kind: "human", projectId, score,
        criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
        boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
    if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      // candidate edit: fetch role/family once instead of twice
      const role = roleByTask.get(event.payload.taskId);
      const family = familyByTask.get(event.payload.taskId);
      signals.push(baseSignal({
        source: "deterministic", kind: "judge", projectId, score,
        criterion: "policyCompliance",
        outcomeKind: event.payload.verdict === "APPROVED" ? "PASS" : event.payload.verdict === "REJECTED" ? "FAIL" : "ABSTAIN",
        boundary: "review", summary: `judge ${event.payload.verdict}`,
        createdAt, episodeId: context.episodeId, runId: event.runId,
        taskId: event.payload.taskId, evidenceIds: event.payload.evidenceIds,
        ...(modelId !== undefined ? { modelId } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(family !== undefined ? { family } : {})
      }));
    }
    if (event.type === "RUN_FAILED") {
      signals.push(baseSignal({
        source: "deterministic", kind: "deterministic", projectId, score: 10,
        boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
  }
  return signals;
}

/* ================================================================
 * S1-E-1 candidate: single merged pass (maps built as the scan goes).
 * Expected NOT equivalent -- counterexamples below must diverge.
 * ================================================================ */
function candidateCollectMerged(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
  let projectId = context.projectId;
  const modelByTask = new Map<string, string>();
  const modelVersionByTask = new Map<string, string>();
  const roleByTask = new Map<string, string>();
  const familyByTask = new Map<string, string>();
  const featureVersionByTask = new Map<string, string>();
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();

  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      continue;
    }
    if (event.type === "MODEL_ROUTED") {
      modelByTask.set(event.payload.taskId, event.payload.model);
      roleByTask.set(event.payload.taskId, event.payload.role);
      if (event.payload.family !== undefined) familyByTask.set(event.payload.taskId, event.payload.family);
      if (event.payload.modelVersion !== undefined) modelVersionByTask.set(event.payload.taskId, event.payload.modelVersion);
      if (event.payload.featureVersion !== undefined) featureVersionByTask.set(event.payload.taskId, event.payload.featureVersion);
      continue;
    }
    if (projectId === undefined) continue;
    if (event.type === "CHILD_MESSAGE") {
      const fromResult = signalFromAgentMessage(event.payload.message, {
        projectId, modelByTask, modelVersionByTask, roleByTask, familyByTask, featureVersionByTask,
        episodeId: context.episodeId, createdAt
      });
      if (fromResult !== undefined) signals.push(fromResult);
    }
    if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(baseSignal({
        source: "user", kind: "human", projectId, score,
        criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
        boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
  }
  return signals;
}

/* ================================================================
 * Seeded event-log generator (real composition mirrors the R1-A probe:
 * 41 events, 10 MODEL_ROUTED, 10 CHILD_MESSAGE, few USER_ANSWER/JUDGE).
 * ================================================================ */
const OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"];
const VERIFS: readonly VerificationKind[] = ["PASSED", "FAILED", "UNOBSERVED"];
const ROLES = ["actor", "critic", "tester", "planner", "scout", "reviewer"] as const;
const FAMS = ["edit", "test", "review", "plan", "research"] as const;
const ANSWERS = ["lgtm", "no, revert this", "please also add coverage", "可以", "不行 错误", "hmm"];
const PEERS = ["found a bug in the ledger", "looks fine to me", "missing tests", "unknown agent addressed", "ok"];

function genEvents(rng: () => number, length: number, opts?: { forceProject?: boolean }): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  if (opts?.forceProject !== false) {
    out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } });
  }
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.05) {
      out.push({ type: "PROJECT_DISCOVERED", payload: { project: { id: `prj_p${Math.floor(rng() * 3)}simsim`, rootPath: "/tmp/x" } } });
    } else if (roll < 0.3) {
      out.push({
        type: "MODEL_ROUTED",
        payload: {
          taskId,
          model: pick(rng, ["cheap", "premium", "mid"]),
          role: pick(rng, ROLES),
          ...(rng() < 0.8 ? { family: pick(rng, FAMS) } : {}),
          ...(rng() < 0.8 ? { modelVersion: "v1" } : {}),
          ...(rng() < 0.8 ? { featureVersion: "fv1" } : {})
        }
      });
    } else if (roll < 0.55) {
      const isResult = rng() < 0.6;
      out.push({
        type: "CHILD_MESSAGE",
        payload: {
          message: isResult
            ? {
                type: "TASK_RESULT",
                taskId: rng() < 0.85 ? taskId : "tsk_unrouted0",
                runId: "run_simsim01",
                outcome: pick(rng, OUTCOMES),
                verification: { kind: pick(rng, VERIFS) },
                summary: pick(rng, ["tests passed", "did the work\n  with details", "failed to compile", ""]),
                evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
              }
            : {
                type: "PEER_MESSAGE",
                taskId,
                runId: "run_simsim01",
                body: pick(rng, PEERS)
              }
        }
      });
    } else if (roll < 0.65) {
      out.push({ type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: pick(rng, ANSWERS) } });
    } else if (roll < 0.75) {
      out.push({
        type: "JUDGE_DECISION",
        runId: "run_simsim01",
        payload: {
          taskId,
          verdict: pick(rng, ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"] as const),
          evidenceIds: rng() < 0.5 ? ["evd_00000002"] : []
        }
      });
    } else if (roll < 0.8) {
      out.push({ type: "RUN_FAILED", runId: "run_simsim01", payload: { reason: "boom  reason" } });
    } else {
      out.push({ type: pick(rng, ["LEDGER_UPDATED", "TASK_STATUS_CHANGED", "RUN_STARTED"] as const), payload: {} });
    }
  }
  return out as Event[];
}

{
  const rng = mulberry32(0xe11e01);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    check(
      "S1-E-2 equivalence (judge dedup replica)",
      norm(collectSignalsFromEvents(events, ctx)) === norm(candidateCollectDedup(events, ctx)),
      `trial ${trial}`
    );
  }
  // real-scale bench: 41-event run
  const events = genEvents(mulberry32(0xe11e02), 40);
  const cur = bench(() => collectSignalsFromEvents(events, {}), 20000);
  const cand = bench(() => candidateCollectDedup(events, {}), 20000);
  console.log(
    `S1-E-2 bench E=41 run: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run`
  );
}

/* S1-E-1 counterexamples: merged single pass must diverge. */
{
  const late: Event[] = [
    { type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: "lgtm" } },
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } }
  ] as unknown as Event[];
  const cur1 = collectSignalsFromEvents(late);
  const cand1 = candidateCollectMerged(late);
  check("S1-E-1 counterexample A (late PROJECT_DISCOVERED) must diverge", cur1.length === 1 && cand1.length === 0);

  const reroute: Event[] = [
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_simsim01", rootPath: "/tmp/x" } } },
    {
      type: "MODEL_ROUTED",
      payload: { taskId: "tsk_10000000", model: "modelA", role: "actor", family: "edit", modelVersion: "v1", featureVersion: "fv1" }
    },
    {
      type: "CHILD_MESSAGE",
      payload: {
        message: {
          type: "TASK_RESULT", taskId: "tsk_10000000", runId: "run_simsim01",
          outcome: "SUCCESS", verification: { kind: "PASSED" }, summary: "ok", evidenceIds: []
        }
      }
    },
    {
      type: "MODEL_ROUTED",
      payload: { taskId: "tsk_10000000", model: "modelB", role: "actor", family: "edit", modelVersion: "v2", featureVersion: "fv1" }
    }
  ] as unknown as Event[];
  const cur2 = collectSignalsFromEvents(reroute);
  const cand2 = candidateCollectMerged(reroute);
  check(
    "S1-E-1 counterexample B (route after result) must diverge",
    cur2[0]?.modelId === "modelB" && cand2[0]?.modelId === "modelA"
  );
  console.log(
    `S1-E-1 counterexamples: A current=${cur1.length} signal(s) merged=${cand1.length}; B current binds ${cur2[0]?.modelId} merged binds ${cand2[0]?.modelId} -> NOT equivalent`
  );
}

/* ================================================================
 * S1-E-3: extractAssistant accumulation via parts array + join.
 * Faithful to the empty-prefix-absorbing fold of the current code.
 * ================================================================ */
function extractAssistantJoin(messages: unknown): { text: string; model?: string } {
  if (!Array.isArray(messages)) return { text: "" };
  const parts: string[] = [];
  let model: string | undefined;
  for (const message of messages) {
    if (!isRecordLocal(message) || message.role !== "assistant") continue;
    if (typeof message.model === "string" && message.model.trim() !== "") {
      model = message.model;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecordLocal(part)) continue;
      if (part.type === "thinking") continue;
      if (part.type === "text" && typeof part.text === "string") {
        if (parts.length === 0 && part.text === "") continue; // fold absorbs empty prefixes
        parts.push(part.text);
      }
    }
  }
  const text = parts.join("\n");
  return model !== undefined ? { text, model } : { text };
}

function candidateCollectSubagent(raw: unknown, context: SignalContext): ObservedSignal[] {
  if (!isRecordLocal(raw) || context.projectId === undefined) return [];
  const request = isRecordLocal(raw.request) ? raw.request : {};
  const results = Array.isArray(raw.results) ? raw.results : [];
  const status = typeof raw.status === "string" ? raw.status : "";
  const signals: ObservedSignal[] = [];
  const createdAt = nowIso();
  for (const result of results) {
    if (!isRecordLocal(result)) continue;
    const agent = typeof result.agent === "string" ? result.agent : typeof request.agent === "string" ? request.agent : undefined;
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
    const extracted = extractAssistantJoin(result.messages);
    const failed = status === "failed" || status === "error" || exitCode === 1 || PEER_NEGATIVE.test(extracted.text);
    const score = failed ? 15 : 70;
    const kind: FeedbackKind = agent === "reviewer" || agent === "tester" ? "peer" : "deterministic";
    signals.push(baseSignal({
      source: "subagent", kind, projectId: context.projectId, score,
      boundary: failed && /unknown agent/i.test(extracted.text) ? "tool" : "execution",
      summary: truncate(extracted.text === "" ? `subagent ${status || "completed"}` : extracted.text),
      createdAt, episodeId: context.episodeId,
      ...(extracted.model !== undefined ? { modelId: extracted.model } : {}),
      ...(agent !== undefined ? { role: agent } : {})
    }));
  }
  return signals;
}

function genPiRun(rng: () => number, partCount: number, partLen: number): unknown {
  const mkParts = () => {
    const content: unknown[] = [];
    for (let i = 0; i < partCount; i += 1) {
      const r = rng();
      if (r < 0.15) content.push({ type: "thinking", text: "..." });
      else if (r < 0.25) content.push({ type: "tool_use", name: "read" });
      else if (r < 0.35) content.push({ type: "text", text: "" });
      else content.push({ type: "text", text: pick(rng, ["step ok", "found a bug", "all done", "x".repeat(partLen)]) });
    }
    return content;
  };
  return {
    status: pick(rng, ["completed", "failed", "error", ""]),
    request: rng() < 0.5 ? { agent: pick(rng, ["reviewer", "tester", "implementer"]) } : {},
    results: Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
      ...(rng() < 0.7 ? { agent: pick(rng, ["reviewer", "tester", "implementer"]) } : {}),
      ...(rng() < 0.7 ? { exitCode: rng() < 0.3 ? 1 : 0 } : {}),
      messages: [
        { role: "user", content: [{ type: "text", text: "task" }] },
        { role: "assistant", ...(rng() < 0.6 ? { model: "m1" } : {}), content: mkParts() },
        ...(rng() < 0.4 ? [{ role: "assistant", content: mkParts() }] : [])
      ]
    }))
  };
}

{
  const rng = mulberry32(0xe11e03);
  const ctx: SignalContext = { projectId: "prj_simsim01" as ProjectId };
  for (let trial = 0; trial < 4000; trial += 1) {
    const raw = genPiRun(rng, Math.floor(rng() * 8), 40);
    check(
      "S1-E-3 equivalence (join replica)",
      norm(collectSignalsFromSubagentRun(raw, ctx)) === norm(candidateCollectSubagent(raw, ctx)),
      JSON.stringify(raw)
    );
  }
  const realistic = genPiRun(mulberry32(0xe11e04), 6, 60);
  const stress = genPiRun(mulberry32(0xe11e04), 500, 200);
  const curR = bench(() => collectSignalsFromSubagentRun(realistic, ctx), 20000);
  const candR = bench(() => candidateCollectSubagent(realistic, ctx), 20000);
  const curS = bench(() => collectSignalsFromSubagentRun(stress, ctx), 500);
  const candS = bench(() => candidateCollectSubagent(stress, ctx), 500);
  console.log(
    `S1-E-3 bench realistic(6 parts): current=${(curR * 1e6).toFixed(0)}ns cand=${(candR * 1e6).toFixed(0)}ns | stress(500x200B parts): current=${(curS * 1e3).toFixed(1)}us cand=${(candS * 1e3).toFixed(1)}us`
  );
}

/* ================================================================
 * S1-E-4: persistSignals double evidenceIds.filter(isEvidenceId).
 * Purity makes dedup trivially equal; anchor = filter cost vs one
 * appendFeedback (redaction + jsonl append to disk).
 * ================================================================ */
async function anchorS1E4(): Promise<void> {
  const evidenceIds = ["evd_00000001", "not-an-id", "evd_00000002"];
  const filterCost = bench(() => {
    void evidenceIds.filter(isEvidenceId).length;
  }, 200000);
  const stateRoot = await mkdtemp(join(tmpdir(), "r1e-fbk-"));
  const record: FeedbackRecord = {
    id: `fbk_${hash32("anchor")}`,
    episodeId: "ep_simsim01" as EpisodeId,
    kind: "deterministic",
    rubricVersion: "auto-loop-v1",
    score: 70,
    evidenceRefs: ["evd_00000001"] as FeedbackRecord["evidenceRefs"],
    redacted: false,
    createdAt: nowIso(),
    summary: "anchor summary"
  };
  const t0 = performance.now();
  for (let i = 0; i < 200; i += 1) await appendFeedback(stateRoot, record);
  const appendCost = (performance.now() - t0) / 200;
  console.log(
    `S1-E-4 anchor: one redundant filter(3 ids)=${(filterCost * 1e6).toFixed(0)}ns vs one appendFeedback=${(appendCost * 1e3).toFixed(1)}us (${((appendCost / filterCost)).toFixed(0)}x) per signal`
  );
}

/* ================================================================
 * S1-E-5: ingestSubagentDirectory sequential vs parallel reads.
 * Reference = verbatim replica of the private function (production
 * collectSignalsFromSubagentRun); candidate = Promise.all, order kept.
 * ================================================================ */
async function referenceIngest(dir: string, context: SignalContext): Promise<ObservedSignal[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  const signals: ObservedSignal[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rawText = await readFile(join(dir, name), "utf8").catch(() => "");
    if (rawText === "") continue;
    try {
      signals.push(...collectSignalsFromSubagentRun(JSON.parse(rawText) as unknown, context));
    } catch {
      // skip malformed Pi run files
    }
  }
  return signals;
}

async function candidateIngestParallel(dir: string, context: SignalContext): Promise<ObservedSignal[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  const jsonNames = names.filter((name) => name.endsWith(".json"));
  const texts = await Promise.all(jsonNames.map((name) => readFile(join(dir, name), "utf8").catch(() => "")));
  const signals: ObservedSignal[] = [];
  for (const rawText of texts) {
    if (rawText === "") continue;
    try {
      signals.push(...collectSignalsFromSubagentRun(JSON.parse(rawText) as unknown, context));
    } catch {
      // skip malformed Pi run files
    }
  }
  return signals;
}

async function adjudicateS1E5(): Promise<void> {
  const rng = mulberry32(0xe11e05);
  const ctx: SignalContext = { projectId: "prj_simsim01" as ProjectId };
  const mkDir = async (files: number): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "r1e-pi-"));
    for (let i = 0; i < files; i += 1) {
      const name = `${String(i).padStart(3, "0")}.json`;
      if (rng() < 0.1) await writeFile(join(dir, name), "{malformed", "utf8");
      else await writeFile(join(dir, name), JSON.stringify(genPiRun(rng, 6, 60)), "utf8");
    }
    await writeFile(join(dir, "notes.txt"), "ignore me", "utf8");
    return dir;
  };
  const dir20 = await mkDir(20);
  check(
    "S1-E-5 equivalence (parallel ingest, 20 files)",
    norm(await referenceIngest(dir20, ctx)) === norm(await candidateIngestParallel(dir20, ctx))
  );
  for (const files of [6, 60]) {
    const dir = await mkDir(files);
    const t0 = performance.now();
    for (let i = 0; i < 30; i += 1) await referenceIngest(dir, ctx);
    const seq = (performance.now() - t0) / 30;
    const t1 = performance.now();
    for (let i = 0; i < 30; i += 1) await candidateIngestParallel(dir, ctx);
    const par = (performance.now() - t1) / 30;
    console.log(
      `S1-E-5 bench ${files} files: sequential=${(seq * 1e3).toFixed(0)}us parallel=${(par * 1e3).toFixed(0)}us delta=${((seq - par) * 1e3).toFixed(0)}us/ingest`
    );
  }
}

/* ================================================================
 * S1-E-6: diagnoseModelProjectIssues per-group multi-pass fusion.
 * Candidate accumulates sum/failures/kinds/mode incrementally during
 * the grouping loop; float sum order and mode tie-break preserved.
 * ================================================================ */
const ACTIONABLE_MEAN = 0.45;
const ACTIONABLE_SAMPLES = 5;

interface FusedGroup {
  first: ObservedSignal;
  samples: number;
  scoreSum: number;
  failures: number;
  kinds: string[];
  famCounts: Map<string, number>;
  famBest: string | undefined;
  famBestCount: number;
}

function candidateDiagnoseFused(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const groups = new Map<string, FusedGroup>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    const key = `${signal.projectId}::${signal.modelId}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        first: signal, samples: 0, scoreSum: 0, failures: 0, kinds: [],
        famCounts: new Map(), famBest: undefined, famBestCount: 0
      };
      groups.set(key, group);
    }
    group.samples += 1;
    group.scoreSum += signal.score;
    if (signal.score < 40) group.failures += 1;
    if (!group.kinds.includes(signal.kind)) group.kinds.push(signal.kind);
    if (signal.family !== undefined) {
      const next = (group.famCounts.get(signal.family) ?? 0) + 1;
      group.famCounts.set(signal.family, next);
      if (next > group.famBestCount) {
        group.famBest = signal.family;
        group.famBestCount = next;
      }
    }
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    const first = group.first;
    if (first.modelId === undefined) continue;
    const meanScore = group.scoreSum / group.samples / 100;
    const independent = group.kinds.includes("deterministic") && !group.kinds.includes("human");
    const actionable = group.samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && independent;
    issues.push({
      projectId: first.projectId,
      modelId: first.modelId,
      samples: group.samples,
      meanScore,
      failures: group.failures,
      kinds: group.kinds,
      actionable,
      ...(group.famBest !== undefined ? { family: group.famBest } : {})
    });
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}

function genSignal(rng: () => number): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", "policyCompliance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "judge", "deterministic"] as const),
    projectId: pick(rng, ["prj_a0000000", "prj_b0000000"]) as ProjectId,
    score: rng() < 0.5 ? Math.floor(rng() * 101) : Number((rng() * 100).toFixed(3)),
    boundary: "execution",
    summary: "s",
    createdAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    evidenceIds: [],
    ...(rng() < 0.85 ? { modelId: pick(rng, ["m1", "m2", "m3", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.7 ? { family: pick(rng, FAMS) } : {})
  };
}

{
  const rng = mulberry32(0xe11e06);
  for (let trial = 0; trial < 5000; trial += 1) {
    const signals = Array.from({ length: Math.floor(rng() * 30) }, () => genSignal(rng));
    check(
      "S1-E-6 equivalence (fused diagnostics)",
      JSON.stringify(diagnoseModelProjectIssues(signals)) === JSON.stringify(candidateDiagnoseFused(signals)),
      JSON.stringify(signals)
    );
  }
  for (const [label, count, reps] of [["real S=12", 12, 40000], ["10x S=120", 120, 5000], ["stress S=5000", 5000, 100]] as const) {
    const benchRng = mulberry32(0xe11e07 + count);
    const signals = Array.from({ length: count }, () => genSignal(benchRng));
    const cur = bench(() => diagnoseModelProjectIssues(signals), reps);
    const cand = bench(() => candidateDiagnoseFused(signals), reps);
    console.log(
      `S1-E-6 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * S1-E-7: attributeToBoundary sort -> single min scan.
 * Stable-sort-first-of-ties  ==  strict-less first-occurrence min.
 * ================================================================ */
const BOUNDARY_ORDER: EpisodeSignatureKind[] = [
  "contract", "context", "plan", "route", "execution", "tool", "review", "delivery"
];

function candidateAttributeMin(
  patterns: Array<{ kind: EpisodeSignatureKind; count: number }>
): ReturnType<typeof attributeToBoundary> {
  if (patterns.length === 0) {
    return { boundary: "contract", earliestSupported: "contract", confidence: 0 };
  }
  let earliest = patterns[0]!;
  let earliestIndex = BOUNDARY_ORDER.indexOf(earliest.kind);
  for (let i = 1; i < patterns.length; i += 1) {
    const item = patterns[i]!;
    const index = BOUNDARY_ORDER.indexOf(item.kind);
    if (index < earliestIndex) {
      earliest = item;
      earliestIndex = index;
    }
  }
  return {
    boundary: earliest.kind,
    earliestSupported: earliest.kind,
    confidence: Math.min(1, earliest.count / 3)
  };
}

{
  const rng = mulberry32(0xe11e08);
  const kinds = [...BOUNDARY_ORDER, "junk" as EpisodeSignatureKind];
  for (let trial = 0; trial < 6000; trial += 1) {
    const patterns = Array.from({ length: Math.floor(rng() * 10) }, () => ({
      kind: pick(rng, kinds),
      count: Math.floor(rng() * 6)
    }));
    check(
      "S1-E-7 equivalence (min scan)",
      JSON.stringify(attributeToBoundary(patterns)) === JSON.stringify(candidateAttributeMin(patterns)),
      JSON.stringify(patterns)
    );
  }
  const patterns = Array.from({ length: 8 }, (_, i) => ({ kind: BOUNDARY_ORDER[7 - i]!, count: i }));
  const cur = bench(() => attributeToBoundary(patterns), 100000);
  const cand = bench(() => candidateAttributeMin(patterns), 100000);
  console.log(
    `S1-E-7 bench P=8: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns (no production caller; test-only face)`
  );
}

/* ================================================================
 * S1-E-8: detectRepeatedPatterns constant work per pair:
 * per-signature Object.keys precompute (call-scoped) + iterate the
 * union Set directly instead of copying it into an array.
 * ================================================================ */
function candidateDetectPre(
  signatures: readonly EpisodeSignature[],
  options: PatternDetectorOptions = {}
): Pattern[] {
  const minCount = options.minCount ?? 2;
  const minSim = options.minSimilarity ?? 0.6;
  const keysOf = new Map<EpisodeSignature, readonly string[]>();
  for (const sig of signatures) {
    if (!keysOf.has(sig)) keysOf.set(sig, Object.keys(sig.features));
  }
  const sim = (a: EpisodeSignature, b: EpisodeSignature): number => {
    const keySet = new Set<string>();
    for (const k of keysOf.get(a)!) keySet.add(k);
    for (const k of keysOf.get(b)!) keySet.add(k);
    let matches = 0;
    for (const k of keySet) {
      if (a.features[k] === b.features[k]) matches++;
    }
    return keySet.size > 0 ? matches / keySet.size : 0;
  };

  const byKind = new Map<EpisodeSignatureKind, EpisodeSignature[]>();
  for (const sig of signatures) {
    const arr = byKind.get(sig.kind) ?? [];
    arr.push(sig);
    byKind.set(sig.kind, arr);
  }
  const patterns: Pattern[] = [];
  byKind.forEach((sigs, kind) => {
    if (sigs.length < minCount && !sigs.some(isSevereSafetySignature)) return;
    const clusters: EpisodeSignature[][] = [];
    const used = new Set<number>();
    for (let i = 0; i < sigs.length; i++) {
      if (used.has(i)) continue;
      const cluster: EpisodeSignature[] = [sigs[i]!];
      used.add(i);
      for (let j = i + 1; j < sigs.length; j++) {
        if (used.has(j)) continue;
        if (sim(sigs[i]!, sigs[j]!) >= minSim) {
          cluster.push(sigs[j]!);
          used.add(j);
        }
      }
      clusters.push(cluster);
    }
    clusters.forEach((cluster, idx) => {
      if (cluster.length >= minCount) {
        let sum = 0;
        let n = 0;
        for (let i = 0; i < cluster.length; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            sum += sim(cluster[i]!, cluster[j]!);
            n++;
          }
        }
        patterns.push({
          key: `${kind}:cluster-${idx}`,
          kind,
          count: cluster.length,
          avgSimilarity: cluster.length < 2 ? 1.0 : n > 0 ? sum / n : 1.0,
          negativeControl: findNegativeControlMarker(cluster) !== undefined,
          boundary: kind,
          oneOffReadiness: false
        });
        return;
      }
      for (const sig of cluster) {
        if (isSevereSafetySignature(sig)) {
          patterns.push({
            key: `${kind}:one-off:${sig.hash}`,
            kind,
            count: 1,
            avgSimilarity: 1,
            negativeControl: false,
            boundary: kind,
            oneOffReadiness: true
          });
        }
      }
    });
  });
  return patterns;
}

function genSignature(rng: () => number, id: number): EpisodeSignature {
  const featurePool: Array<[string, () => number | string | boolean]> = [
    ["operation", () => pick(rng, ["read", "edit", "write", "test"])],
    ["instrumented", () => rng() < 0.5],
    ["gateBlocked", () => rng() < 0.5],
    ["unrelated", () => rng() < 0.5],
    ["severeSafety", () => rng() < 0.3],
    ["errorCode", () => Math.floor(rng() * 4)],
    ["tool", () => pick(rng, ["bash", "grep", "apply"])],
    ["retry", () => rng() < 0.5]
  ];
  const features: Record<string, number | string | boolean> = {};
  for (const [key, gen] of featurePool) {
    if (rng() < 0.6) features[key] = gen();
  }
  return {
    episodeId: `ep_${String(id).padStart(8, "0")}` as EpisodeId,
    kind: pick(rng, BOUNDARY_ORDER),
    hash: `h${id.toString(16)}`,
    features,
    createdAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp
  };
}

{
  const rng = mulberry32(0xe11e09);
  for (let trial = 0; trial < 2500; trial += 1) {
    const n = Math.floor(rng() * 40);
    const sigs = Array.from({ length: n }, (_, i) => genSignature(rng, i));
    const options: PatternDetectorOptions = {
      ...(rng() < 0.3 ? { minCount: 1 + Math.floor(rng() * 4) } : {}),
      ...(rng() < 0.3 ? { minSimilarity: rng() } : {})
    };
    check(
      "S1-E-8 equivalence (call-scoped key precompute)",
      JSON.stringify(detectRepeatedPatterns(sigs, options)) === JSON.stringify(candidateDetectPre(sigs, options)),
      `trial ${trial} n=${n}`
    );
  }
  for (const [n, reps] of [[6, 40000], [40, 4000], [400, 40]] as const) {
    const benchRng = mulberry32(0xe11e0a + n);
    const sigs2 = Array.from({ length: n }, (_, i) => genSignature(benchRng, i));
    const cur = bench(() => detectRepeatedPatterns(sigs2), reps);
    const cand = bench(() => candidateDetectPre(sigs2), reps);
    console.log(
      `S1-E-8 bench n=${n}: current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us (${(cur / cand).toFixed(2)}x; no production caller)`
    );
  }
}

/* run async anchors, then report */
await anchorS1E4();
await adjudicateS1E5();

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-E：`src/learning/` 第三遍复查报告（Round 3）

**战役:** 全库持久 SOTA 优化 Round 3 / R3-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `09d7545`
**分支:** `cursor/r3-e-learning-third-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 10 个文件（1770 行）自 R1-E
基线（`adb20d7`）以来**逐字节未变**（`git diff adb20d7..09d7545 --
src/learning/` 为空），R1-E 逐文件收口、R2-E 复查与 S1-E-1..8 / S2-E-1..7
共 15 项排除全部继承有效；生产调用面交叉检索复核未变（post-run 自适应环
`runAutoAdaptLoop`/`runAutoAdaptFromEvents`/`proposeRoutingFromRoutedEvents`
+ live 装配面 `applyLearnedRouting`/`loadLearnedRouting`；`patterns` /
`attribution` / `signatures` 仍无任何生产调用方，仅测试使用）。本轮在完整
排除表（含 R2-J、R3-A/B/D 新增）之上以新角度第三遍枚举，得到 5 个此前
未点名的新候选（S3-E-1 … S3-E-5），全部经理论 + 确定性仿真（seeded
mulberry32，18,001 项等价检查/次 × 8 次独立运行，等价结论逐位一致）
裁决后淘汰：1 个**无正收益且更慢为主**（S3-E-4 bandit 双扫融合，8 次
测量 7 次更慢、1 次离群翻正——战役「小集合融合固定开销高于线性重算」
教训的第七例，且首次以 8 样本量化了该量级候选的抖动带），4 个等价但
±ns 级纯抖动或需公开签名变更。本轮另立**切片 CPU 总量上界锚点**：一次完整
auto-adapt run 的全切片 CPU 合计仅 **~25µs**，距落地线（数十 ms）约
**400×**——即使把切片 CPU 清零也远不达门槛，而所有 ms 级余量都在 I/O
契约面上（保存时机 X0-3、锁内写通 S2-E-4、readAll 事实源 S1-G-1、顺序
追加 S1-E-4/5），全部受保护。未重开任何 X* / S1-* / S2-* / S3-A/B/D-*
条目。零 diff 下全部硬不变量天然满足。本切片在其输出契约与数据面语义下
维持 SOTA。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮第三遍全量
  实际读码，未依赖前两轮记忆。上下游 `adaptation/`、`routing/`、`run/`、
  `track/`、`cli/`、`persist/` 只读取证，一行未改。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（完整表）→
  round-03/PLAN.md → round-01/R1-E.md → round-02/R2-E.md → 10 个源文件。
- 排除表遵守：候选枚举刻意绕开全部既有排除。特别地：S3-E-1 的候选副本
  **保留** JUDGE_DECISION 的 role/family 双重 `Map.get`（S1-E-2 已排除的
  编辑不得捆绑）；S3-E-4 与 X1-2（平行实现）区分——融合保留 `recordReward`
  调用与 `includes` 守卫，仅合并扫描；S3-E-5 与 X0-6 区分——目标正则无
  `/g` 标志、无 lastIndex 状态风险。X0-3 / X2-6 / X1-1 / S1-E-* / S2-E-*
  全部未触碰。
- 硬不变量：零 diff，`adapt auto` 只提案（`autoPromote` 被忽略）、
  SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human 伪造
  taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针、双 LCB 与双归因
  保留——天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放
  （ADR-005）。

## 1. 规模基底与本轮新锚点

R1-E 实测的现实规模（E≈41、S≈10–15、M≤10、subagent 目录个位数文件、每
信号 appendFeedback 96–192µs）与 R2-E 的 I/O 锚点（saveAdaptationRegistry
409–716µs、updateProjectBandit 全事务 446–456µs、readJsonlObjects(41)
100–115µs）继承有效——代码与调用面均未变。

本轮新立**切片 CPU 总量上界锚点**（八次运行区间）：

```text
collect=15.6-16.2us  outcomes=7.5-7.7us  diagnose=~0.1us  bandit-build=1.2-1.3us
total in-slice CPU ~24.6-25.2us per full auto-adapt run
vs landing bar >=10000us  ->  ~400x below EVEN IF ZEROED
```

这是本切片第三遍复查的结构性收口：落地线要求数十~数百 ms 或复杂度类
下降；本切片每 run 的全部 CPU 合计 ~25µs，唯一的 ms 级余量在 I/O 行为
上，而每一条 I/O 边都已被排除表点名保护（X0-3 保存时机、S2-E-1/4 跳写、
S1-G-1 readAll 缓存、S1-E-4/5 顺序追加与并行读）。因此**该切片不存在
不推翻既有排除就能达门槛的候选**——除非输入规模增长 ≥2 个量级或 I/O
契约面重新立项。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-E-1 | `collectSignalsFromEvents` 两遍内独立 `if` 链改互斥分派（else-if）+ 第一遍 MODEL_ROUTED `event.payload` 局部提升 | 每事件命中后免最多 3 次剩余 type 字符串比较（E=41 ≈ 百余次） | ✅ 4000 fuzz 一致（createdAt 归一化后逐字节） | E=41 全 run delta **八次测量异号**（−113…+60ns）——纯抖动 | 淘汰：等价但亚噪声；V8 对短字符串 type 比较已近零成本（S1-B-7 同类） |
| S3-E-2 | `runAutoAdaptFromEvents` 的 PROJECT_DISCOVERED/EPISODE_OPENED 前置扫描与下游 `collectSignalsFromEvents` 首遍重复 Θ(E) 消除（跨函数传递已解析绑定） | 省一次 Θ(E) 扫描 | ✅ 反例确认**不安全变体发散**：context=A、events 含 PROJECT_DISCOVERED B 时现行语义 event-derived 必须赢（信号绑定 prj_b）——只能走签名扩展路线 | 冗余前置扫描实测 **105–124ns/run**；同路径 `EventStore.readAll` ≥100µs（~10³×） | 淘汰：噪声级 + 需扩公开签名（S2-E-2 同族的 auto-loop 侧样本；「信任 context 跳过重推导」有发散反例，为将来立此证据） |
| S3-E-3 | 分组循环冗余 `Map.set` 消除（`diagnoseModelProjectIssues` 的 `groups.set(key, list)` 在 list 已存在时冗余；`patterns.byKind` 同形） | 每已分组信号省 1 次 Map.set | ✅ 5000 fuzz × 2（候选等价 + 副本保真各 5000）一致 | 公平副本对副本：S=12 **七次测量异号**（−8…+8ns）；S=120 +8~+72ns 抖动带内 | 淘汰：亚噪声。注：首测（生产导入 vs 本地副本）曾显示 +156ns 假收益，换公平对比后塌缩——见 §3.1 方法论教训 |
| S3-E-4 | `updateProjectBandit` arms 收集与 reward 双扫融合单遍 + 紧凑 reward 重放（保留 `includes` 守卫与 armList 插入序） | 2×Θ(S)→1×Θ(S)+Θ(R)，R⊆S | ✅ 4000 fuzz 一致（含 previous 无/有、novel/空白 modelId、**previous 携带空白 arm 边界**、三态 outcomeKind；JSON 比较覆盖 armList 序） | M=10 S=12 **八次测量七次更慢**（−26/−28/−35/−43/−48/−60/−70ns，一次 +71ns 离群）——更慢为主、量级在抖动带边缘，无正收益证据；且全程在文件锁内，事务 ~450µs（R2-E 锚点） | 淘汰：无正收益且更慢为主——「小集合融合固定开销高于线性重算」系列**第七例**（S1-A-4/S1-B-6/S1-E-6/S1-E-8/S2-E-5/S2-E-6 之后）；锁内 I/O 支配 |
| S3-E-5 | `collectSignalsFromSubagentRun` 的 `/unknown agent/i` 字面量提升模块常量（无 `/g`，无 X0-6 的 lastIndex 状态风险） | 免每次求值的正则对象创建 | —（提升非 /g 字面量平凡等价） | 3 次求值合计省 **1–6ns**；且仅在 failed 分支求值，每 run 个位数次 | 淘汰：深度亚噪声；V8 已缓存字面量编译，仅剩对象分配 |

另有四处以既有排除/裁决直接覆盖、不立新 ID：`averageSimilarity` 复用
`clusterSignatures` 中间相似度（X2-6 原文点名）；bandit reward 循环增量化
（X1-2 类，R1-E §2 已裁决）；`FAMILIES.includes`/`arms.includes` Set 化
（Iter4 上界 8/M≤10）；`outcomeKindFromResult` 死参数清理（R2-E 已裁决
零收益不动）。

## 3. 关键裁决细节

### 3.1 S3-E-3 的方法论教训：跨模块基准偏差

首版基准以生产导入 `diagnoseModelProjectIssues` 为参照、本地副本为候选，
S=12 测得 +156ns/call 的「收益」——超出该函数总成本（~100ns），明显异常。
改为**同模块逐字副本 vs 候选**（副本保真另以 5000 项检查对生产导入验证）
后，delta 塌缩为 ±8ns 三次异号纯抖动。根因：tsx/ESM 跨模块调用的内联与
IC 状态不同于同文件函数，微基准在 ns 尺度上放大了该差异。**后续轮次凡
ns~百 ns 级候选的基准必须副本对副本**，生产导入仅承担等价性参照角色
（R1-E/R2-E 的既有结论不受影响——其淘汰裁决全部建立在「收益不超过
公平上界」方向上，偏差只会高估收益，而高估后仍被淘汰）。

### 3.2 S3-E-4：融合系列第七例（并首次量化该量级的抖动带）

纸面上双扫合一稳赚，且等价性严格成立（含 armList 插入序与 previous 携带
空白 arm 的对抗边界，4000 例逐字节一致）——但 M=10、S=12 真实规模八次
独立测量中七次更慢（−26…−70ns）、一次 +71ns 离群翻正：紧凑 reward 数组
的分配 + 元组解构开销至少抵消、通常超过省掉的一遍个位数长度扫描。最初
四次测量恰好全部为负，第五次才出现离群正值——这本身是一条方法论数据：
**几十 ns 量级的 delta 需要 ≥5 次独立运行才能区分「一致更慢」与「抖动带
边缘」**，既往轮次以三次运行判「一致」的结论在该量级应理解为方向证据
而非精确值。裁决不受影响：无正收益证据 + 与 S1-A-4、S1-B-6、S1-E-6、
S1-E-8、S2-E-5、S2-E-6 同族 + 该函数每 run 恰一次、全程在 ~450µs 文件锁
事务内，即使小幅正收益也不可测。

### 3.3 S3-E-2 的发散反例价值

「`runAutoAdaptFromEvents` 已解析 projectId，下游 `collectSignalsFromEvents`
可信任 context 跳过重推导」是直觉候选，但反例确认不等价：现行语义是
**event-derived 覆盖 context 种子**（`context.projectId` 仅为初值，事件表
中的 PROJECT_DISCOVERED 永远赢）。`track/loop` 与 CLI 直调 `runAutoAdaptLoop`
时传入的 projectId 来自 run 上下文，与事件表可能不同——跳过重推导会静默
改变信号归属项目。安全路线只剩跨函数签名扩展，为省 105–124ns 不值。与
S1-E-1（迟到 PROJECT_DISCOVERED）、S1-A-9 同族：**事件表语义不允许
「调用方快照=事件真相」假设**。为将来任何「auto-loop 扫描去重」提案立此
反例。

## 4. 逐文件收口（前两轮收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `signals.ts` | S3-E-1（互斥分派）、S3-E-5（正则提升）淘汰；S1-E-1/2/3、S2-E-5/7 维持 | 无候选 |
| `auto-loop.ts` | S3-E-2（前置扫描去重）淘汰并立发散反例；S1-E-4/5、S2-E-1/6 维持；三源 spread、hash32 键构造均 I/O 旁噪声 | 无候选 |
| `from-episode.ts` | S2-E-2 维持（三遍融合已有等价证据但噪声）；`Date.parse` 每 TASK_RESULT ~10 次/run µs 级；死参数维持 R2-E 裁决 | 无候选 |
| `bandit-store.ts` | S3-E-4（双扫融合）淘汰——第七例负优化；S2-E-3/4、X1-2 维持 | 无候选 |
| `diagnostics.ts` | S3-E-3（冗余 Map.set）淘汰；S1-E-6、恒真守卫（R1-E §4.4）维持 | 无候选 |
| `learned-routing.ts` | `stableProjectKey` 多次调用缓存=X1-1 维持；`routingPolicyIdentity` 每 run 个位数次 µs 级；S2-E-6 维持 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 本轮交叉检索复核仍无生产调用方；X2-6、S1-E-7/8 维持；`byKind` 分组的冗余 set 同 S3-E-3 淘汰 | 无候选 |
| `task-success.ts` | S2-E-7 维持；`copyDefinedBinding`+`present()` 是空白字段契约实施点 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r3e-sim.mts`，未入库以遵守「无赢家不落地代码」；
完整源码见附录，seeds `0xe33e01`–`0xe33e08`）共 **8 次独立运行**（含从
本报告附录原文提取后的复现运行），18,001 项等价检查/次全部通过、等价
结论逐位一致。代表性一次运行：

```text
S3-E-1 bench E=41 run: current=12254ns cand=12198ns delta=57ns/run
S3-E-2 anchor: redundant pre-scan over E=41 costs 111ns/run (same-path EventStore.readAll >=100us; elimination needs a cross-function plumbing signature change)
S3-E-3 bench real S=12 (replica-vs-replica): current=99ns cand=107ns delta=-8ns/call
S3-E-3 bench 10x S=120 (replica-vs-replica): current=1334ns cand=1262ns delta=72ns/call
S3-E-4 bench M=10 S=12: current=1655ns fused=1703ns delta=-48ns/call (in-lock transaction ~450us, R2-E anchor)
S3-E-5 bench 3 evals: literal=59ns hoisted=58ns delta=1ns (evaluated only on failed results; single-digit per run)
SLICE-CPU anchor: collect=15.8us outcomes=7.6us diagnose=0.10us bandit-build=1.3us | total in-slice CPU ~24.7us per run vs landing bar >=10000us (405x below even if zeroed)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

计时方向跨 8 次运行（首版脚本 1 次 + 最终版 7 次，两版仅 S3-E-3 基准
形态不同）汇总：S3-E-1 八次异号（−99/−113/−1/+57/+60/−52/−97/+34）
确认纯抖动；S3-E-3 公平基准七次异号（−2/+8/−8/−3/+5/+5/+1）确认纯抖动；
S3-E-4 **七负一正**（−26…−70ns，+71ns 一次离群）——更慢为主、无正收益
证据（§3.2）；S3-E-5 恒 ≤6ns；SLICE-CPU 总量 24.6–25.2µs 稳定。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-E-1 | collectSignalsFromEvents 独立 if 链改互斥分派 + payload 提升 | 等价但 E=41 八次测量异号（−113…+60ns），纯抖动 |
| S3-E-2 | runAutoAdaptFromEvents 前置扫描与 collectSignalsFromEvents 首遍去重 | 冗余扫描仅 105–124ns vs 同路径 readAll ≥100µs；「信任 context 跳过重推导」有发散反例（event-derived 必须赢）；安全路线需扩公开签名 |
| S3-E-3 | 分组循环冗余 Map.set 消除（diagnostics/patterns 同形） | 等价但公平副本对副本 ±8ns 异号纯抖动；并立「ns 级基准必须副本对副本」方法论教训 |
| S3-E-4 | updateProjectBandit arms/reward 双扫融合 + 紧凑 reward 重放 | 等价严格成立（含 armList 序与空白 arm 边界）但 M=10 S=12 八次测量七次更慢、无正收益证据（融合系列第七例）；锁内 ~450µs 事务支配 |
| S3-E-5 | collectSignalsFromSubagentRun /unknown agent/i 字面量提升 | 等价（无 /g，区别于 X0-6）但 1–6ns 深度亚噪声，failed 分支每 run 个位数次 |

重开条件：S3-E-1/3/5 若信号管道进入每 turn 热路径或 E/S 增长 ≥2 个量级
可凭本报告等价证据重开；S3-E-2 需先接受 `collectSignalsFromEvents` 公开
签名扩展立项，且必须保留 event-derived 覆盖语义（反例见 §3.3）；S3-E-4
属融合系列，需推翻七例系列证据或 bandit 事务离开文件锁 I/O 面。切片级
重开总条件：`SLICE-CPU` 锚点失效（全切片 CPU 增长 ≥2 个量级）或任一
I/O 契约排除（X0-3 / S2-E-1/4 / S1-G-1 / S1-E-4/5）被正式推翻。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xe33e01`–`0xe33e08`。

```ts
/**
 * R3-E deterministic equivalence + benchmark simulation (third pass over
 * src/learning/). Adjudicates fresh candidates S3-E-1 .. S3-E-5 against the
 * current implementations. Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xe33e01 - 0xe33e08.
 *
 * Reference = production imports. Candidates = full replicas whose only
 * difference from the verbatim-copied private helpers is the candidate edit.
 * IMPORTANT: replicas keep every already-excluded edit UNAPPLIED (e.g. the
 * S1-E-2 judge double-get stays verbatim in the S3-E-1 candidate).
 */
import { performance } from "node:perf_hooks";
import {
  collectSignalsFromEvents,
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
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { AGENT_ROLES } from "/workspace/src/domain/roles.js";
import type { EpisodeId, ProjectId } from "/workspace/src/domain/ids.js";
import type { Event } from "/workspace/src/run/events.js";
import type { AgentMessage, TaskOutcome, VerificationKind } from "/workspace/src/protocol/v1.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { nowIso } from "/workspace/src/domain/timestamp.js";
import type { FeedbackKind } from "/workspace/src/feedback/types.js";
import type { OutcomeCriterion, OutcomeKind } from "/workspace/src/routing/outcomes.js";
import type { EpisodeSignatureKind } from "/workspace/src/learning/signatures.js";
import type { TaskFamily } from "/workspace/src/task/taxonomy.js";

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
/** createdAt is nowIso() captured per call; normalize for cross-call compare. */
function norm(signals: readonly ObservedSignal[]): string {
  return JSON.stringify(signals.map((s) => ({ ...s, createdAt: "T" })));
}

/* ================================================================
 * Verbatim private-helper replicas from src/learning/signals.ts.
 * ================================================================ */
const PEER_NEGATIVE = /\b(fail|bug|issue|missing|violation|unknown agent|错误)\b/i;

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}
function familyFromRole(role: string | undefined): string | undefined {
  if (role === "critic" || role === "reviewer") return "review";
  if (role === "tester") return "test";
  if (role === "scout") return "research";
  if (role === "planner") return "plan";
  if (role === "actor" || role === "implementer" || role === "worker" || role === "debugger") return "edit";
  return undefined;
}
function baseSignal(input: {
  source: ObservedSignal["source"];
  kind: FeedbackKind;
  projectId: ProjectId;
  score: number;
  boundary: EpisodeSignatureKind;
  summary: string;
  createdAt: IsoTimestamp;
  episodeId?: EpisodeId | undefined;
  runId?: ObservedSignal["runId"];
  taskId?: ObservedSignal["taskId"];
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
function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
void isRecordLocal;
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
 * S3-E-1 candidate: collectSignalsFromEvents with mutually-exclusive
 * dispatch (else-if in both passes) + payload local hoist in pass 1.
 * The S1-E-2 judge double-get stays VERBATIM (that edit is excluded).
 * ================================================================ */
function candidateCollectDispatch(events: readonly Event[], context: SignalContext = {}): ObservedSignal[] {
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
    } else if (event.type === "MODEL_ROUTED") {
      const payload = event.payload; // hoist
      modelByTask.set(payload.taskId, payload.model);
      roleByTask.set(payload.taskId, payload.role);
      if (payload.family !== undefined) familyByTask.set(payload.taskId, payload.family);
      if (payload.modelVersion !== undefined) modelVersionByTask.set(payload.taskId, payload.modelVersion);
      if (payload.featureVersion !== undefined) featureVersionByTask.set(payload.taskId, payload.featureVersion);
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
    } else if (event.type === "USER_ANSWER") {
      const score = scoreUserAnswer(event.payload.answer);
      if (score === undefined) continue;
      signals.push(baseSignal({
        source: "user", kind: "human", projectId, score,
        criterion: "userAcceptance", outcomeKind: score >= 50 ? "PASS" : "FAIL",
        boundary: "review", summary: truncate(`user: ${event.payload.answer}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    } else if (event.type === "JUDGE_DECISION") {
      const score = event.payload.verdict === "APPROVED" ? 85 : event.payload.verdict === "REJECTED" ? 20 : 50;
      const modelId = modelByTask.get(event.payload.taskId);
      signals.push(baseSignal({
        source: "deterministic", kind: "judge", projectId, score,
        criterion: "policyCompliance",
        outcomeKind: event.payload.verdict === "APPROVED" ? "PASS" : event.payload.verdict === "REJECTED" ? "FAIL" : "ABSTAIN",
        boundary: "review", summary: `judge ${event.payload.verdict}`,
        createdAt, episodeId: context.episodeId, runId: event.runId,
        taskId: event.payload.taskId, evidenceIds: event.payload.evidenceIds,
        ...(modelId !== undefined ? { modelId } : {}),
        // verbatim double-get kept (S1-E-2 excluded edit NOT applied):
        ...(roleByTask.get(event.payload.taskId) !== undefined
          ? { role: roleByTask.get(event.payload.taskId) }
          : {}),
        ...(familyByTask.get(event.payload.taskId) !== undefined
          ? { family: familyByTask.get(event.payload.taskId) }
          : {})
      }));
    } else if (event.type === "RUN_FAILED") {
      signals.push(baseSignal({
        source: "deterministic", kind: "deterministic", projectId, score: 10,
        boundary: "execution", summary: truncate(`run failed: ${event.payload.reason}`),
        createdAt, episodeId: context.episodeId, runId: event.runId
      }));
    }
  }
  return signals;
}

/* Seeded event-log generator (R1-A composition: E~41). */
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
            : { type: "PEER_MESSAGE", taskId, runId: "run_simsim01", body: pick(rng, PEERS) }
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
  const rng = mulberry32(0xe33e01);
  for (let trial = 0; trial < 4000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60), { forceProject: rng() < 0.9 });
    const ctx: SignalContext = rng() < 0.5 ? { episodeId: "ep_simsim01" as EpisodeId } : {};
    check(
      "S3-E-1 equivalence (exclusive dispatch)",
      norm(collectSignalsFromEvents(events, ctx)) === norm(candidateCollectDispatch(events, ctx)),
      `trial ${trial}`
    );
  }
  const events = genEvents(mulberry32(0xe33e02), 40);
  const cur = bench(() => collectSignalsFromEvents(events, {}), 20000);
  const cand = bench(() => candidateCollectDispatch(events, {}), 20000);
  console.log(
    `S3-E-1 bench E=41 run: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/run`
  );
}

/* ================================================================
 * S3-E-2: runAutoAdaptFromEvents' PROJECT_DISCOVERED/EPISODE_OPENED
 * pre-scan duplicates the pass collectSignalsFromEvents will redo.
 * (a) Counterexample: the UNSAFE variant (trust context.projectId and
 *     skip re-derivation inside collectSignals) must diverge.
 * (b) Measure the redundant pre-scan's actual cost at E=41.
 * ================================================================ */
{
  // (a) counterexample: context says A, events later discover B.
  const events: Event[] = [
    { type: "PROJECT_DISCOVERED", payload: { project: { id: "prj_bbbbbbbb", rootPath: "/tmp/x" } } },
    { type: "USER_ANSWER", runId: "run_simsim01", payload: { answer: "lgtm" } }
  ] as unknown as Event[];
  const ctx: SignalContext = { projectId: "prj_aaaaaaaa" as ProjectId };
  const current = collectSignalsFromEvents(events, ctx);
  check(
    "S3-E-2 counterexample: event-derived projectId must win over context",
    current.length === 1 && current[0]?.projectId === "prj_bbbbbbbb",
    JSON.stringify(current)
  );
  // Unsafe skip variant would bind prj_aaaaaaaa -> divergent. QED by inspection
  // of the current first pass: context.projectId is only the seed value.

  // (b) redundant pre-scan cost (verbatim runAutoAdaptFromEvents scan shape).
  const run = genEvents(mulberry32(0xe33e03), 40);
  const preScan = bench(() => {
    let projectId: string | undefined;
    let projectRoot: string | undefined;
    let episodeId: string | undefined;
    for (const event of run) {
      if (event.type === "PROJECT_DISCOVERED") {
        projectId = event.payload.project.id;
        projectRoot = projectRoot ?? event.payload.project.rootPath;
      }
      if (event.type === "EPISODE_OPENED") {
        episodeId = (event.payload as { episode: { id: string } }).episode.id;
      }
    }
    void projectId; void projectRoot; void episodeId;
  }, 40000);
  console.log(
    `S3-E-2 anchor: redundant pre-scan over E=41 costs ${(preScan * 1e6).toFixed(0)}ns/run (same-path EventStore.readAll >=100us; elimination needs a cross-function plumbing signature change)`
  );
}

/* ================================================================
 * S3-E-3 candidate: grouping loop without the redundant Map.set when
 * the list already exists (diagnostics replica; same shape appears in
 * patterns.ts byKind). Aggregation loop stays VERBATIM (S1-E-6 excluded).
 * ================================================================ */
const ACTIONABLE_MEAN = 0.45;
const ACTIONABLE_SAMPLES = 5;
function uniqueLocal(values: readonly string[]): string[] {
  const seen: string[] = [];
  for (const value of values) {
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}
function modeLocal(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  let best = values[0]!;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}
function candidateDiagnoseNoReset(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const groups = new Map<string, ObservedSignal[]>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    const key = `${signal.projectId}::${signal.modelId}`;
    const list = groups.get(key);
    if (list === undefined) {
      groups.set(key, [signal]); // candidate edit: set only on first sight
    } else {
      list.push(signal);
    }
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined || first.modelId === undefined) continue;
    const samples = group.length;
    const meanScore = group.reduce((sum, item) => sum + item.score, 0) / samples / 100;
    const failuresCount = group.filter((item) => item.score < 40).length;
    const kinds = uniqueLocal(group.map((item) => item.kind));
    const family = modeLocal(group.map((item) => item.family).filter((item): item is string => item !== undefined));
    const independent = kinds.includes("deterministic") && !kinds.includes("human");
    const actionable = samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && independent;
    issues.push({
      projectId: first.projectId,
      modelId: first.modelId,
      samples,
      meanScore,
      failures: failuresCount,
      kinds,
      actionable,
      ...(family !== undefined ? { family } : {})
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
/** Verbatim local replica of diagnoseModelProjectIssues for a fair
 *  same-module bench (production import keeps the equivalence role). */
function replicaDiagnoseCurrent(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const groups = new Map<string, ObservedSignal[]>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    const key = `${signal.projectId}::${signal.modelId}`;
    const list = groups.get(key) ?? [];
    list.push(signal);
    groups.set(key, list);
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined || first.modelId === undefined) continue;
    const samples = group.length;
    const meanScore = group.reduce((sum, item) => sum + item.score, 0) / samples / 100;
    const failuresCount = group.filter((item) => item.score < 40).length;
    const kinds = uniqueLocal(group.map((item) => item.kind));
    const family = modeLocal(group.map((item) => item.family).filter((item): item is string => item !== undefined));
    const independent = kinds.includes("deterministic") && !kinds.includes("human");
    const actionable = samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && independent;
    issues.push({
      projectId: first.projectId,
      modelId: first.modelId,
      samples,
      meanScore,
      failures: failuresCount,
      kinds,
      actionable,
      ...(family !== undefined ? { family } : {})
    });
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}
{
  const rng = mulberry32(0xe33e04);
  for (let trial = 0; trial < 5000; trial += 1) {
    const signals = Array.from({ length: Math.floor(rng() * 30) }, () => genSignal(rng));
    const expected = JSON.stringify(diagnoseModelProjectIssues(signals));
    check(
      "S3-E-3 equivalence (no redundant Map.set)",
      expected === JSON.stringify(candidateDiagnoseNoReset(signals)),
      JSON.stringify(signals)
    );
    check(
      "S3-E-3 replica fidelity (verbatim copy == production)",
      expected === JSON.stringify(replicaDiagnoseCurrent(signals)),
      JSON.stringify(signals)
    );
  }
  for (const [label, count, reps] of [["real S=12", 12, 40000], ["10x S=120", 120, 5000]] as const) {
    const benchRng = mulberry32(0xe33e05 + count);
    const signals = Array.from({ length: count }, () => genSignal(benchRng));
    const cur = bench(() => replicaDiagnoseCurrent(signals), reps);
    const cand = bench(() => candidateDiagnoseNoReset(signals), reps);
    console.log(
      `S3-E-3 bench ${label} (replica-vs-replica): current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
}

/* ================================================================
 * S3-E-4 candidate: updateProjectBandit arms+reward double scan fused
 * into one scan with a deferred compact reward replay. armList insertion
 * order and reward application order are preserved; the includes() guard
 * stays for blank/previous-only arms. Replica-vs-replica (in-lock body).
 * ================================================================ */
function currentBanditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
      arms.add(signal.modelId);
    }
  }
  const armList = [...arms];
  let state = createBanditState(armList);
  if (previous !== undefined) {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
    if (signal.outcomeKind === "PASS") {
      state = recordReward(state, signal.modelId, 1);
    } else if (signal.outcomeKind === "FAIL") {
      state = recordReward(state, signal.modelId, 0);
    }
  }
  return state;
}
function fusedBanditBuild(previous: BanditState | undefined, signals: readonly ObservedSignal[]): BanditState {
  const arms = new Set(previous?.arms ?? []);
  const rewards: Array<readonly [string, number]> = [];
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
      arms.add(signal.modelId);
    }
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined) continue;
    if (signal.outcomeKind === "PASS") rewards.push([signal.modelId, 1]);
    else if (signal.outcomeKind === "FAIL") rewards.push([signal.modelId, 0]);
  }
  const armList = [...arms];
  let state = createBanditState(armList);
  if (previous !== undefined) {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const [modelId, reward] of rewards) {
    if (!state.arms.includes(modelId)) continue; // blank ids only pass when previous held them
    state = recordReward(state, modelId, reward);
  }
  return state;
}
function genBanditSignal(rng: () => number, models: readonly string[]): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "deterministic"] as const),
    projectId: "prj_simsim01" as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: "s",
    createdAt: "2026-08-24T00:00:00.000Z" as IsoTimestamp,
    evidenceIds: [],
    ...(rng() < 0.9 ? { modelId: pick(rng, [...models, "novel", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL", "ABSTAIN"] as const) } : {})
  };
}
{
  const rng = mulberry32(0xe33e06);
  const models = ["m1", "m2", "m3", "m4", "m5"];
  for (let trial = 0; trial < 4000; trial += 1) {
    const seedSignals = Array.from({ length: Math.floor(rng() * 15) }, () => genBanditSignal(rng, models));
    let previous = rng() < 0.3 ? undefined : currentBanditBuild(undefined, seedSignals);
    // blank-arm edge: previous state carrying a whitespace arm (only reachable
    // via a hand-edited file, but the includes() guard makes it observable).
    if (previous !== undefined && rng() < 0.2) {
      previous = {
        ...previous,
        arms: [...previous.arms, "  "],
        pulls: { ...previous.pulls, "  ": 1 },
        rewardSum: { ...previous.rewardSum, "  ": 1 }
      };
    }
    const signals = Array.from({ length: Math.floor(rng() * 15) }, () => genBanditSignal(rng, models));
    check(
      "S3-E-4 equivalence (fused scan, order + blank-arm edge)",
      JSON.stringify(currentBanditBuild(previous, signals)) === JSON.stringify(fusedBanditBuild(previous, signals)),
      `trial ${trial}`
    );
  }
  const benchRng = mulberry32(0xe33e07);
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const prevSeed = Array.from({ length: 30 }, () => genBanditSignal(benchRng, models10));
  const previous = currentBanditBuild(undefined, prevSeed);
  const signals = Array.from({ length: 12 }, () => genBanditSignal(benchRng, models10));
  const cur = bench(() => void currentBanditBuild(previous, signals), 40000);
  const cand = bench(() => void fusedBanditBuild(previous, signals), 40000);
  console.log(
    `S3-E-4 bench M=10 S=12: current=${(cur * 1e6).toFixed(0)}ns fused=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call (in-lock transaction ~450us, R2-E anchor)`
  );
}

/* ================================================================
 * S3-E-5: /unknown agent/i literal in collectSignalsFromSubagentRun
 * hoisted to a module const (non-/g: no lastIndex state, unlike X0-6).
 * Measure the literal's per-evaluation cost in isolation.
 * ================================================================ */
{
  const texts = ["unknown agent addressed the wrong mailbox", "found a bug in the ledger", "all good"];
  const HOISTED = /unknown agent/i;
  let sink = 0;
  const literalCost = bench(() => {
    for (const t of texts) if (/unknown agent/i.test(t)) sink += 1;
  }, 100000);
  const hoistedCost = bench(() => {
    for (const t of texts) if (HOISTED.test(t)) sink += 1;
  }, 100000);
  void sink;
  console.log(
    `S3-E-5 bench 3 evals: literal=${(literalCost * 1e6).toFixed(0)}ns hoisted=${(hoistedCost * 1e6).toFixed(0)}ns delta=${((literalCost - hoistedCost) * 1e6).toFixed(0)}ns (evaluated only on failed results; single-digit per run)`
  );
}

/* ================================================================
 * Slice-wide CPU upper bound anchor: total in-slice CPU on one full
 * auto-adapt run at real scale vs the campaign landing bar (>=10ms).
 * ================================================================ */
{
  const events = genEvents(mulberry32(0xe33e08), 40);
  const collectCost = bench(() => collectSignalsFromEvents(events, {}), 20000);

  // outcomesFromRoutedRun at real scale needs complete routed payloads.
  const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
  const FAMILIES_LOCAL: readonly TaskFamily[] = ["edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"];
  const rng = mulberry32(0xe33e08 + 1);
  const routed: unknown[] = [];
  const models = ["cheap", "premium", "mid"];
  for (let i = 0; i < 10; i += 1) {
    const model = pick(rng, models);
    routed.push({
      type: "MODEL_ROUTED", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        taskId: `tsk_${i}0000000`, model, role: "actor",
        eligibleModels: models, behaviorDistribution: oneHotDistribution(models, model),
        family: pick(rng, FAMILIES_LOCAL), featureVersion: "fv1", modelVersion: "v1",
        agentRole: pick(rng, AGENT_ROLES)
      }
    });
    routed.push({
      type: "CHILD_MESSAGE", runId: "run_simsim01", occurredAt: NOW,
      payload: {
        message: {
          type: "TASK_RESULT", taskId: `tsk_${i}0000000`, runId: "run_simsim01",
          outcome: pick(rng, ["SUCCESS", "FAILURE"] as const),
          verification: { kind: pick(rng, ["PASSED", "FAILED"] as const) },
          summary: "tests passed", evidenceIds: []
        }
      }
    });
  }
  const routedEvents = routed as Event[];
  const outcomesCost = bench(() => void outcomesFromRoutedRun(routedEvents), 20000);

  const sRng = mulberry32(0xe33e08 + 2);
  const signals12 = Array.from({ length: 12 }, () => genSignal(sRng));
  const diagnoseCost = bench(() => void diagnoseModelProjectIssues(signals12), 40000);

  const bRng = mulberry32(0xe33e08 + 3);
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const previous = currentBanditBuild(undefined, Array.from({ length: 30 }, () => genBanditSignal(bRng, models10)));
  const banditSignals = Array.from({ length: 12 }, () => genBanditSignal(bRng, models10));
  const banditCost = bench(() => void currentBanditBuild(previous, banditSignals), 40000);

  const totalUs = (collectCost + outcomesCost + diagnoseCost + banditCost) * 1e3;
  console.log(
    `SLICE-CPU anchor: collect=${(collectCost * 1e3).toFixed(1)}us outcomes=${(outcomesCost * 1e3).toFixed(1)}us diagnose=${(diagnoseCost * 1e3).toFixed(2)}us bandit-build=${(banditCost * 1e3).toFixed(1)}us | total in-slice CPU ~${totalUs.toFixed(1)}us per run vs landing bar >=10000us (${(10000 / totalUs).toFixed(0)}x below even if zeroed)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

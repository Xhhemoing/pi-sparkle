# R1-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-A（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `7acb666`
**分支:** `cursor/sota-r1-a-tracking-1174`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** 以新视角对切片 14 个文件逐一重新枚举，
得到 9 个此前排除表未点名的候选（S1-A-1 … S1-A-9），全部经理论 + 确定性仿真
（seeded mulberry32，等价性 fuzz + 真实规模基准）裁决后淘汰：8 个在真实规模是
噪声级（其中 1 个实测反而更慢），1 个不等价（有发散反例）。与 Iter0–4 的收口
结论一致；本切片现状即为该数据面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（14 文件全量读码）、`src/run/child-tracking.ts`、`src/run/gate-apply.ts`。
- 遵守排除表：X0-4（gate-apply 签名/增量索引）、X0-6（human-score 正则缓存）、
  X2-4（gate-apply 单遍合并）等全部继承排除均未触碰；候选枚举刻意绕开这些方案，
  只探索**未被排除的新角度**（扫描方向、惰性求值、循环融合、重复计算复用）。
- 公开 API、阈值（softThreshold 0.55 / hardFailCap 0.3 / minorPDip 0.03）、
  哈希契约（`hashAssessment`/`hashSummary` 的排序字段集）、事件 schema、
  CAS/幂等键格式全部不变——本轮零 diff，天然满足。

## 1. 现实规模测量（门槛第 3 条的证据基底）

用与 `test/integration/track` 相同的 harness 跑一次完整 tracked run
（`startTrackedRun` + `ProtocolChildExecutor`）实测：

```text
status: COMPLETED
total events: 41
TRACKING_ASSESSMENT: 5 | GATE_TRANSITION: 0
CHILD_MESSAGE: 10, CHILD_RUN_CREATED: 5, MODEL_ROUTED: 10, LEDGER_UPDATED: 4, ...
```

即:门控热路径每 run 扫描的事件表是 **几十级**(41),门控应用 **~5 次/run**;
每 tracking turn 的 claims/toolSituations/checks/constraints 均为个位数;
episode 十几 turn。Iter2 曾按“数百事件”从宽估计仍判噪声——实测比那更小一个量级,
噪声判定只会更强。

## 2. 候选总表(全部淘汰,无赢家落地)

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-A-1 | `gate-apply.ts` 私有 `currentGateStatus` 改反向扫描早退 | O(E)→O(距最后状态事件) | ✅ 5000 fuzz 一致 | 省 **318ns/run**(E=41×5 次);10× 压力也仅省 3.6µs | 淘汰:噪声 |
| S1-A-2 | `from-child.ts` 复用外层 `computePrescore`,免 `runTrackingTurn` 内重复计算 | 免 1 次全维度评估(~22% 单次调用) | ✅ 3000 fuzz 外/内层结果逐字节一致 | 省 ~1µs × 5 次/run | 淘汰:噪声 + 需给公开 `TrackingTurnInput` 开注入口(X1-2 同类平行入口风险) |
| S1-A-3 | `human-score.ts` 十分制 matchAll 早退 + 惰性「分」路匹配(不缓存正则,非 X0-6) | O(全部匹配)→O(≤2 个匹配) | ✅ 4034 文本语料一致 | 真实句省 **171ns/turn**;仅 540 分数的对抗文本才有 5.4× | 淘汰:现实输入是单句,噪声 |
| S1-A-4 | `prescore.ts` evidence/scope 循环融合 + coverage/constraint/scope 成员判定 Set 化 | 2 遍→1 遍;O(R×C)→O(R+C) | ✅ 6000 fuzz 一致 | **实测更慢**:1307→1469ns(10× 时 872→2029ns) | 淘汰:个位数组上 Set 构建开销 > 线性 `includes`,理论常数下降被仿真推翻 |
| S1-A-5 | `roller.ts` `confirmedDecisions.includes` 过滤 Set 化 | O(Q×c)→O(Q+c) | ✅ 150 条 episode 链(2–15 turn,含 maxItems 截断)一致 | 12-turn episode:58.47µs vs 60.54µs,持平(被 `hashSummary` 支配) | 淘汰:c 为单轮个位数,噪声 |
| S1-A-6 | `gates.ts` `shouldEscalateMinors` 三遍 filter/some 融合为单遍早退 | 3 遍→1 遍 | ✅ 8000 fuzz(含硬/软/none 全路径)一致 | minors ≤6,亚噪声 | 淘汰:噪声 |
| S1-A-7 | `turn.ts` `[...gate.codes]` 拷贝省略,直接别名 | 免 1 次小数组分配/turn | —(身份论证) | 亚噪声 | 淘汰:`summary.anomalyCodes === gate.codes` 变 true,引入可观察的对象身份改变,零收益 |
| S1-A-8 | `types.ts` `evidenceWeight` find / 枚举校验 `includes` 换 Map/Set | O(5~9)→O(1) | —(平凡) | 表长 ≤9、parse 频次低 | 淘汰:噪声(与 Iter4 §1.4 types.ts 裁决同向) |
| S1-A-9 | `nextTrackingSeq` 反向扫描取第一个 seq+1 | O(E)→O(1) | ❌ **发散反例** | — | 淘汰:不等价。追加序 ≠ seq 序时(重放/合并事件表)反向取 8→给 4,当前 max 语义给 8;该不变量无处强制 |

另核对一处疑似死代码并裁决**保留**:`gate-apply.ts` `mapGateDirective` 末尾的
`FAIL_CLOSED` 返回在 `GateKind` 现枚举下不可达,但它是面向未来 kind 扩展的
fail-closed 默认,与规格失败关闭原则一致,删除属负优化。

## 3. 关键裁决细节

### S1-A-1(最强候选)为何仍淘汰

反向扫描与正向折叠在**全部**输入上逐位一致(状态只由最后一个相关事件决定;
5000 组含乱序状态事件的 fuzz 验证)。理论上把每次门控应用的状态扫描从 O(E)
降到 O(距最后状态事件),run 内累计从 O(T·E) 降到 O(E)。但实测 E=41、T=5:
每 run 全部节省 318ns——低于一次事件追加的分配成本,属于门槛第 3 条定义的
噪声。10× 压力(E=410,已超实测规模一个量级)也只省 3.6µs/run。X2-4 当年按
“数百事件”判噪声,本轮实测 41 事件,同理更强。若未来 run 事件表增长两个
量级以上,此候选可凭本报告的等价性证据重开。

### S1-A-4 的反向教训(理论被仿真推翻)

“两遍 some 融合单遍 + includes 换 Set”在纸面上常数必降,但个位数长度的数组上
`new Set()` 构建 + 哈希查找的固定开销**高于**短数组线性扫描,6000 组 fuzz 等价
但基准全面变慢(真实规模 +12%,10× 规模 +133%)。这正是战役门槛要求
“理论 + 仿真”双证的原因——本候选作为反例记录,防止后续轮次以纯理论重提。

### S1-A-9 的发散反例

```text
events = [TRACKING_ASSESSMENT(seq=7), TRACKING_ASSESSMENT(seq=3)]
current(max 语义) → 8    backward(最后一个+1) → 4
```

`nextTrackingSeq` 的 max 折叠对事件追加顺序**无假设**;反向早退隐含
“追加序=seq 序”不变量,而该不变量在重放/外部合并事件表时无处强制。
不满足“仿真可证一致”,直接淘汰,并为将来任何“反向取尾”类提案立此反例。

### 逐文件收口(切片其余面)

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `turn.ts` | `mergeOpenMinors` Map+Set 已线性;`collectEvidence` 单遍 Set;minors 计数 filter().length 亚噪声 | 无候选 |
| `roller.ts` | 每 turn O(累计量) 是不可变累计快照数据面的构造下界;`hashSummary(previous)` 无法缓存(X1-1/schema 冻结) | 无候选 |
| `types.ts` | 哈希契约排序字段版本化不可动;parse 校验错误消息被测试断言(X0-5 同域) | 无候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `combined-score.ts` | 一次性构造 / O(1) 谓词 / 常量 / 单表达式 | 无候选 |
| `child-tracking.ts` | `observationFromChild` 单遍线性;5 次事件表扫描(episodeId/seq/幂等×2/status)的合并与索引化即 X2-4/X0-4,维持排除 | 无候选 |
| `gate-apply.ts` | 双 `hashAssessment`(caller 算 + callee 验)是 CAS fail-closed 契约本体,测试断言 mismatch 必 throw | 无候选 |
| `human-score.ts` | `REQUIREMENT_ONLY` 的 `[\s\S]*$` 尾缀冗余(前缀锚定后恒真),删除等价——但同为单句输入噪声级,且改动正则源属高风险低收益 | 记录不改 |
| `prescore.ts` / `gates.ts` / `from-child.ts` | 见 S1-A-2/4/6 | 淘汰 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 5. 测试

零代码改动下相关套件基线复核,全绿:

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真(临时脚本,未入库;完整源码见附录,seed 固定可复现):

```text
S1-A-1 bench E=41, 5 applications/run: current=406.9ns cand=89.1ns delta/run=317.7ns
S1-A-1 bench E=410, 5 applications/run: current=3704.5ns cand=55.2ns delta/run=3649.2ns
S1-A-9 counterexample: current=8 backward=4 -> NOT equivalent
S1-A-3 bench real-text: current=813.5ns cand=642.1ns | adversarial(540 marks): 44.00us -> 8.23us
S1-A-4 bench real-scale: current=1307.2ns cand=1469.1ns | 10x: current=871.6ns cand=2028.5ns
S1-A-5 bench 12-turn episode: current=58.47us cand=60.54us delta=-2.07us
S1-A-2 bench: assessChildObservation=4839.2ns, one computePrescore=1053.7ns (~22%, ~5 calls/run)
anchor: nextTrackingSeq over E=41 events = 190.9ns per call
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价结论逐位一致,计时在抖动范围内稳定,裁决方向不变。

## 6. 新增排除 ID(请并入全局 EXCLUSIONS.md「本战役新增」)

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-A-1 | gate-apply `currentGateStatus` 反向扫描早退 | 等价但 E=41 实测每 run 省 318ns,噪声 |
| S1-A-2 | from-child 复用外层 prescore 免 runTrackingTurn 内重复计算 | 噪声 + 需公开 TrackingTurnInput 开注入口(X1-2 同类) |
| S1-A-3 | human-score 十分制 matchAll 早退/惰性「分」匹配 | 单句输入噪声;仅对抗文本获益 |
| S1-A-4 | prescore 循环融合 + 成员判定 Set 化 | 等价但实测更慢(个位数组 Set 构建开销) |
| S1-A-5 | roller confirmedDecisions 过滤 Set 化 | 单轮确认数个位数,实测持平 |
| S1-A-6 | gates shouldEscalateMinors 单遍融合 | minors ≤6,亚噪声 |
| S1-A-7 | turn.ts anomalyCodes 拷贝省略(别名) | 引入可观察对象身份改变,零收益 |
| S1-A-8 | types evidenceWeight/枚举校验 Map/Set 化 | 表长 ≤9、低频,噪声 |
| S1-A-9 | nextTrackingSeq 反向扫描 | 不等价:乱序 seq 事件表发散反例(8 vs 4) |

重开条件:S1-A-1/3/5 若 run 事件表或用户文本规模增长 ≥2 个量级可凭本报告
等价性证据重开;S1-A-4/9 需先推翻本报告的基准/反例。

## 附录:确定性仿真脚本(完整,可复现)

运行方式:保存为任意 `.ts` 后 `npx tsx <file>`(仓库根目录,依赖已装)。
seeds:`0xa11a01`–`0xa11a09`。规模探针为同目录第二脚本,直接调用
`startTrackedRun` 统计事件计数(§1 数字)。

```ts
/**
 * R1-A deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-A-1 .. S1-A-9 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply}.
 * Seeded PRNG (mulberry32) -> fully reproducible.
 */
import { performance } from "node:perf_hooks";
import { computePrescore, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import { extractHumanScore } from "/workspace/src/tracking/human-score.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import { evaluateGates, type GateInput } from "/workspace/src/tracking/gates.js";
import { DEFAULT_TRACKING_CONFIG } from "/workspace/src/tracking/config.js";
import {
  assessChildObservation,
  prescoreInputFromObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { nextTrackingSeq } from "/workspace/src/run/gate-apply.js";
import type {
  ConstraintRecord,
  DimensionScore,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  ToolSituation,
  TrackingWindow
} from "/workspace/src/tracking/types.js";
import { UNOBSERVED, hashSummary } from "/workspace/src/tracking/types.js";

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
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}

/* ============================================================
 * S1-A-1: currentGateStatus backward scan
 * current = verbatim copy of the private function in gate-apply.ts
 * ============================================================ */
type MiniEvent =
  | { type: "GATE_TRANSITION"; payload: { to: Status; seq: number } }
  | { type: "TRACKING_ASSESSMENT"; payload: { seq: number } }
  | { type: "RUN_BLOCKED" }
  | { type: "RUN_WAITING_FOR_USER" }
  | { type: "USER_ANSWER" }
  | { type: "RUN_STARTED" }
  | { type: "CHILD_MESSAGE" }
  | { type: "LEDGER_UPDATED" };
type Status = "RUNNING" | "BLOCKED" | "WAITING_FOR_USER";

function currentGateStatusForward(events: readonly MiniEvent[]): Status {
  let status: Status = "RUNNING";
  for (const event of events) {
    if (event.type === "GATE_TRANSITION") status = event.payload.to;
    else if (event.type === "RUN_BLOCKED") status = "BLOCKED";
    else if (event.type === "RUN_WAITING_FOR_USER") status = "WAITING_FOR_USER";
    else if (event.type === "USER_ANSWER" || event.type === "RUN_STARTED") status = "RUNNING";
  }
  return status;
}

function candidateGateStatusBackward(events: readonly MiniEvent[]): Status {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as MiniEvent;
    if (event.type === "GATE_TRANSITION") return event.payload.to;
    if (event.type === "RUN_BLOCKED") return "BLOCKED";
    if (event.type === "RUN_WAITING_FOR_USER") return "WAITING_FOR_USER";
    if (event.type === "USER_ANSWER" || event.type === "RUN_STARTED") return "RUNNING";
  }
  return "RUNNING";
}

function genEvents(rng: () => number, length: number): MiniEvent[] {
  const statuses: readonly Status[] = ["RUNNING", "BLOCKED", "WAITING_FOR_USER"];
  const out: MiniEvent[] = [];
  let seq = 0;
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    if (roll < 0.55) out.push({ type: "CHILD_MESSAGE" });
    else if (roll < 0.7) out.push({ type: "LEDGER_UPDATED" });
    else if (roll < 0.78) out.push({ type: "TRACKING_ASSESSMENT", payload: { seq: seq++ } });
    else if (roll < 0.86) out.push({ type: "GATE_TRANSITION", payload: { to: pick(rng, statuses), seq: seq++ } });
    else if (roll < 0.9) out.push({ type: "RUN_BLOCKED" });
    else if (roll < 0.94) out.push({ type: "RUN_WAITING_FOR_USER" });
    else if (roll < 0.97) out.push({ type: "USER_ANSWER" });
    else out.push({ type: "RUN_STARTED" });
  }
  return out;
}

{
  const rng = mulberry32(0xa11a01);
  for (let trial = 0; trial < 5000; trial += 1) {
    const events = genEvents(rng, Math.floor(rng() * 60)); // real scale: 41-event runs
    check(
      "S1-A-1 equivalence",
      currentGateStatusForward(events) === candidateGateStatusBackward(events),
      JSON.stringify(events)
    );
  }
  // benchmark at real scale (E=41) and 10x stress (E=410), 5 gate applications each
  for (const E of [41, 410]) {
    const events = genEvents(mulberry32(0xa11a02), E);
    const cur = bench(() => {
      for (let k = 0; k < 5; k += 1) currentGateStatusForward(events);
    }, 20000);
    const cand = bench(() => {
      for (let k = 0; k < 5; k += 1) candidateGateStatusBackward(events);
    }, 20000);
    console.log(
      `S1-A-1 bench E=${E}, 5 applications/run: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta/run=${((cur - cand) * 1e6).toFixed(1)}ns`
    );
  }
}

/* ============================================================
 * S1-A-9: nextTrackingSeq backward scan -- counterexample
 * ============================================================ */
{
  function candidateNextSeqBackward(events: readonly MiniEvent[]): number {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i] as MiniEvent;
      if (event.type === "TRACKING_ASSESSMENT" || event.type === "GATE_TRANSITION") {
        return event.payload.seq + 1;
      }
    }
    return 0;
  }
  function currentNextSeq(events: readonly MiniEvent[]): number {
    let next = 0;
    for (const event of events) {
      if (event.type === "TRACKING_ASSESSMENT" || event.type === "GATE_TRANSITION") {
        next = Math.max(next, event.payload.seq + 1);
      }
    }
    return next;
  }
  // Counterexample: appended list where seq order != append order.
  const outOfOrder: MiniEvent[] = [
    { type: "TRACKING_ASSESSMENT", payload: { seq: 7 } },
    { type: "TRACKING_ASSESSMENT", payload: { seq: 3 } }
  ];
  const diverges = currentNextSeq(outOfOrder) !== candidateNextSeqBackward(outOfOrder);
  check("S1-A-9 counterexample must diverge", diverges);
  console.log(
    `S1-A-9 counterexample: current=${currentNextSeq(outOfOrder)} backward=${candidateNextSeqBackward(outOfOrder)} -> NOT equivalent (candidate rejected on soundness)`
  );
}

/* ============================================================
 * S1-A-3: extractHumanScore ten-point early exit / lazy fen
 * candidate = full replica with lazy second-match detection
 * ============================================================ */
{
  const SHORT_CONFIRM = /^(ok|okay|lgtm|yes|y|行|好|继续|嗯|可以)\s*[.。!！]*$/i;
  const REQUIREMENT_ONLY = /^(另外|还有|再加|还要|also\b|please also\b|add\b|再补)[\s\S]*$/i;
  const NEGATION = /不行|拒绝|回滚|rollback|重来|否定|stop|停下|不要|错了|有误|有问题|reject/i;
  const TEN_POINT_SLASH = /(?<![0-9.])(\d+(?:\.\d+)?)\s*\/\s*10(?![0-9])/i;
  const TEN_POINT_FEN = /(?<![0-9.])(\d+(?:\.\d+)?)\s*分/;
  const OPERATION_REJECT =
    /这个(操作|步骤|改动).*(不行|拒绝|不对).{0,12}(计划|方案).*(可以|还行|没问题)|reject this (operation|step|change).{0,24}(plan|方案).*(ok|fine|ok)/i;
  const NAMED_ERROR_CONTINUE =
    /(错了|有误|有问题|typo|wrong name).{0,16}(继续|先往下|continue)|named error.{0,16}continue/i;
  const WHOLE_REJECT = /回滚|rollback|全部(拒绝|否定|重来)|推倒重来|停下来|不要了|reject all|stop\b/i;

  function firstTwo(text: string, re: RegExp): { count: number; first?: string } {
    let count = 0;
    let first: string | undefined;
    for (const match of text.matchAll(re)) {
      count += 1;
      if (count === 1) first = match[1];
      if (count > 1) break; // early exit: never materialize match 3..k
    }
    return count === 0 ? { count } : { count, first: first as string };
  }

  function candidateExtract(userText?: string): HumanSignal {
    const text = userText?.trim() ?? "";
    if (text === "") return { kind: "unobserved" };
    if (SHORT_CONFIRM.test(text)) return { kind: "unobserved" };
    if (REQUIREMENT_ONLY.test(text) && !NEGATION.test(text)) return { kind: "unobserved" };
    const tenPoint = candidateTenPoint(text);
    if (tenPoint !== undefined) return tenPoint;
    if (OPERATION_REJECT.test(text)) return { kind: "short-rule", H: 0.35, bucket: "operation-reject" };
    if (NAMED_ERROR_CONTINUE.test(text)) return { kind: "short-rule", H: 0.45, bucket: "named-error-continue" };
    if (WHOLE_REJECT.test(text)) return { kind: "short-rule", H: 0.15, bucket: "whole-reject" };
    return { kind: "unobserved" };
  }

  function candidateTenPoint(text: string): HumanSignal | undefined {
    const slash = firstTwo(text, new RegExp(TEN_POINT_SLASH.source, "gi"));
    if (slash.count > 1) return undefined; // fen regex never runs on this path
    const fen = firstTwo(text, new RegExp(TEN_POINT_FEN.source, "g"));
    if (fen.count > 1) return undefined;
    const slashMark = slash.first !== undefined ? Number(slash.first) : undefined;
    const fenMark = fen.first !== undefined ? Number(fen.first) : undefined;
    if (slashMark !== undefined && fenMark !== undefined && slashMark !== fenMark) return undefined;
    const mark = slashMark ?? fenMark;
    if (mark === undefined || !Number.isFinite(mark) || mark < 0 || mark > 10) return undefined;
    return { kind: "ten-point", H: mark / 10, mark };
  }

  const corpus = [
    "", "ok", "继续", "另外再加一个测试", "另外这个错了要拒绝",
    "7分", "7 分", "9.5分", "12分", "0分", "10分", "3.5/10", "7/10", "8 / 10",
    "给 7/10 也就是 7分", "给 7/10 但其实是 8分", "7/10 8/10", "1分 2分 3分",
    "v2/10 版本", "价格 12.5 分摊", "评分 -1分", ".5分", "先 9分 再 9分",
    "这个操作不行,计划可以", "named error continue", "回滚全部", "stop",
    "reject this step because plan is fine", "typo 继续", "满分 10/10!",
    "分数是 7/100", "107/10", "分",
    "长文本 ".repeat(40) + "8分", "长文本 ".repeat(40)
  ];
  const rng = mulberry32(0xa11a03);
  const fragments = ["测试", "7分", "3/10", "ok", "继续跑", "分", "/10", "9.9", "回滚", "错了", " ", "。"];
  const texts = [...corpus];
  for (let i = 0; i < 4000; i += 1) {
    let text = "";
    const parts = Math.floor(rng() * 12);
    for (let j = 0; j < parts; j += 1) text += pick(rng, fragments);
    texts.push(text);
  }
  for (const text of texts) {
    const expected = extractHumanScore({ userText: text });
    const actual = candidateExtract(text);
    check("S1-A-3 equivalence", JSON.stringify(expected) === JSON.stringify(actual), JSON.stringify(text));
  }
  const realText = "这轮改动整体还行,但有两个测试名字错了,先继续,给 7分 吧";
  const cur = bench(() => extractHumanScore({ userText: realText }), 20000);
  const cand = bench(() => candidateExtract(realText), 20000);
  const adversarial = "1分 2分 3分 4分 5分 6分 7分 8分 9分 ".repeat(60);
  const curAdv = bench(() => extractHumanScore({ userText: adversarial }), 2000);
  const candAdv = bench(() => candidateExtract(adversarial), 2000);
  console.log(
    `S1-A-3 bench real-text: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns | adversarial(540 marks): current=${(curAdv * 1e3).toFixed(2)}us cand=${(candAdv * 1e3).toFixed(2)}us`
  );
}

/* ============================================================
 * S1-A-4: prescore evidenceOutcome single pass + Set memberships
 * candidate = full replica of computePrescore with fused loops
 * ============================================================ */
{
  function candidatePrescore(input: PrescoreInput) {
    const config = input.config ?? DEFAULT_TRACKING_CONFIG;
    const SUCCESS_CLAIM = /pass|passed|verified|succeed/i;
    const successClaim = input.claims.some((claim) => SUCCESS_CLAIM.test(claim));
    let failedTool = false;
    let observedPass = false;
    let escaped = false;
    for (const tool of input.toolSituations) {
      if (tool.exitCode !== undefined && tool.exitCode !== 0) failedTool = true;
      if (tool.exitCode === 0) observedPass = true;
      if (tool.escaped) escaped = true;
    }
    const evidence =
      successClaim && (failedTool || (!observedPass && input.completedChecks.length === 0))
        ? "FAIL"
        : failedTool
          ? "FAIL"
          : input.claims.length === 0 && input.toolSituations.length === 0
            ? "UNOBSERVED"
            : "PASS";
    let scope: DimensionScore["outcome"];
    if (input.toolSituations.length === 0 && input.writePaths.length === 0) scope = "UNOBSERVED";
    else if (escaped) scope = "FAIL";
    else {
      const owned = new Set(input.ownedPaths);
      scope = input.writePaths.every((path) => owned.has(path)) ? "PASS" : "FAIL";
    }
    let coverageOutcome: DimensionScore["outcome"];
    if (input.requiredChecks.length === 0) coverageOutcome = "NOT_APPLICABLE";
    else {
      const completed = new Set(input.completedChecks);
      coverageOutcome = input.requiredChecks.every((c) => completed.has(c)) ? "PASS" : "UNOBSERVED";
    }
    let constraint: DimensionScore["outcome"];
    if (input.constraints.length === 0) constraint = "NOT_APPLICABLE";
    else {
      const retained = new Set(input.retainedConstraintIds);
      constraint = input.constraints.every((item) => retained.has(item.id)) ? "PASS" : "FAIL";
    }
    const progress =
      input.progressed === UNOBSERVED
        ? "UNOBSERVED"
        : input.progressed === false || input.stalledTurns >= 2
          ? "FAIL"
          : "PASS";
    const mk = (id: DimensionScore["id"], outcome: DimensionScore["outcome"], hardRelated: boolean): DimensionScore => ({
      id,
      outcome,
      hardRelated,
      ...(outcome === "PASS" || outcome === "FAIL" ? { value: outcome === "PASS" ? 1 : 0 } : {})
    });
    const dimensions: DimensionScore[] = [
      mk("evidence-consistency", evidence, true),
      mk("scope-safety", scope, true),
      mk("check-coverage", coverageOutcome, true),
      mk("constraint-retention", constraint, true),
      mk("progress-vs-stall", progress, true),
      mk("narrative-coherence", input.narrative ?? "ABSTAIN", false)
    ];
    let observedWeight = 0;
    let applicableWeight = 0;
    let qualitySum = 0;
    for (const item of dimensions) {
      if (item.id === "narrative-coherence") continue;
      if (item.outcome === "NOT_APPLICABLE") continue;
      applicableWeight += 1;
      if (item.outcome === "PASS" || item.outcome === "FAIL") {
        observedWeight += 1;
        qualitySum += item.outcome === "PASS" ? 1 : 0;
      }
    }
    const quality = observedWeight === 0 ? 0 : qualitySum / observedWeight;
    const coverage = applicableWeight === 0 ? 0 : observedWeight / applicableWeight;
    let P = quality * coverage;
    const dip = (input.lightMinorCount ?? 0) * config.minorPDip;
    if (dip > 0) P = Math.max(0, P - dip);
    P = Number(P.toFixed(4));
    const cappedByHardFail = dimensions.some((item) => item.hardRelated && item.outcome === "FAIL");
    const displayPrescore = cappedByHardFail ? Math.min(P, config.hardFailCap) : P;
    return {
      P,
      quality: Number(quality.toFixed(4)),
      coverage: Number(coverage.toFixed(4)),
      dimensions,
      cappedByHardFail,
      displayPrescore: Number(displayPrescore.toFixed(4))
    };
  }

  const rng = mulberry32(0xa11a04);
  function genTool(): ToolSituation {
    const exit = rng();
    return {
      name: pick(rng, ["test", "read", "write", "lint"]),
      ...(exit < 0.6 ? { exitCode: exit < 0.35 ? 0 : Math.floor(rng() * 3) } : {}),
      wrote: rng() < 0.4,
      escaped: rng() < 0.08,
      artifactIds: rng() < 0.5 ? ["art_1"] : [],
      evidenceIds: rng() < 0.6 ? ["evd_1", "evd_2"] : [],
      hashes: rng() < 0.3 ? ["aa"] : []
    };
  }
  function genInput(scale: number): PrescoreInput {
    const n = (max: number) => Math.floor(rng() * max * scale);
    const checks = Array.from({ length: n(4) }, (_, i) => `chk_${i}`);
    const constraints: ConstraintRecord[] = Array.from({ length: n(3) }, (_, i) => ({
      id: `c_${i}`,
      text: `constraint ${i}`,
      kind: "constraint",
      mandatory: true
    }));
    const paths = Array.from({ length: n(3) }, (_, i) => `src/p${i}.ts`);
    return {
      claims: rng() < 0.5 ? [pick(rng, ["tests passed", "did work", "verified output", "wip"])] : [],
      toolSituations: Array.from({ length: n(4) }, genTool),
      writePaths: paths.filter(() => rng() < 0.7),
      ownedPaths: paths.filter(() => rng() < 0.8),
      requiredChecks: checks,
      completedChecks: checks.filter(() => rng() < 0.75),
      constraints,
      retainedConstraintIds: constraints.filter(() => rng() < 0.85).map((c) => c.id),
      progressed: rng() < 0.15 ? UNOBSERVED : rng() < 0.8,
      stalledTurns: Math.floor(rng() * 4),
      independentEvidence: rng() < 0.5,
      ...(rng() < 0.3 ? { narrative: pick(rng, ["PASS", "ABSTAIN", "UNOBSERVED"] as const) } : {}),
      ...(rng() < 0.4 ? { lightMinorCount: Math.floor(rng() * 4) } : {})
    };
  }
  const inputs: PrescoreInput[] = [];
  for (let i = 0; i < 6000; i += 1) inputs.push(genInput(1));
  for (const input of inputs) {
    check(
      "S1-A-4 equivalence",
      JSON.stringify(computePrescore(input)) === JSON.stringify(candidatePrescore(input)),
      JSON.stringify(input)
    );
  }
  const realInput = genInput(1);
  const bigInput = genInput(10);
  const cur = bench(() => computePrescore(realInput), 20000);
  const cand = bench(() => candidatePrescore(realInput), 20000);
  const curBig = bench(() => computePrescore(bigInput), 5000);
  const candBig = bench(() => candidatePrescore(bigInput), 5000);
  console.log(
    `S1-A-4 bench real-scale: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns | 10x: current=${(curBig * 1e6).toFixed(1)}ns cand=${(candBig * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * S1-A-5: roller confirmedDecisions Set membership
 * candidate = full replica of rollSummary with Set filter
 * ============================================================ */
{
  function candidateRoll(input: Parameters<typeof rollSummary>[0]) {
    const previous = input.window.previous;
    const byId = new Map<string, ConstraintRecord>();
    for (const item of previous?.constraints ?? []) byId.set(item.id, item);
    for (const item of input.window.constraints) byId.set(item.id, item);
    const mergedConstraints = [...byId.values()];
    const confirmedNow = new Set(input.window.confirmedDecisions);
    const unresolvedQuestions = [
      ...new Set([...(previous?.unresolvedQuestions ?? []), ...input.window.unresolvedDecisions])
    ].filter((question) => !confirmedNow.has(question));
    const confirmedDecisions = [
      ...new Set([...(previous?.confirmedDecisions ?? []), ...input.window.confirmedDecisions])
    ];
    const mandatory = [
      ...mergedConstraints.map((item) => ({ key: item.id, kind: item.kind as "constraint" | "authority" | "unresolved-decision" | "failed-check" })),
      ...unresolvedQuestions.map((question) => ({ key: question, kind: "unresolved-decision" as const }))
    ];
    const omissions: RollingSummary["omissions"][number][] = [];
    let keptMandatory = mandatory;
    let failClosed = false;
    let failClosedReason: string | undefined;
    if (input.maxItems !== undefined && mandatory.length > input.maxItems) {
      keptMandatory = mandatory.slice(0, input.maxItems);
      for (const dropped of mandatory.slice(input.maxItems)) {
        omissions.push({ key: dropped.key, kind: dropped.kind, mandatory: true, reason: "budget" });
      }
      failClosed = true;
      failClosedReason = "mandatory item could not fit; fail closed";
    }
    const keptIds = new Set(keptMandatory.map((item) => item.key));
    const constraints = mergedConstraints.filter((item) => keptIds.has(item.id));
    const keptQuestions = unresolvedQuestions.filter((question) => keptIds.has(question));
    const prevSummaryHash = previous === undefined ? undefined : hashSummary(previous);
    const summary: RollingSummary = {
      schemaVersion: 1,
      constraints,
      unresolvedQuestions: keptQuestions,
      confirmedDecisions,
      operations: input.window.toolSituations,
      prescore: input.prescore,
      human: input.human,
      score: input.score,
      anomalyCodes: input.anomalyCodes,
      evidenceRefs: input.evidenceRefs,
      openMinors: input.openMinors,
      omissions,
      failClosed,
      ...(failClosedReason !== undefined ? { failClosedReason } : {}),
      ...(prevSummaryHash !== undefined ? { prevSummaryHash } : {})
    };
    return { summary };
  }

  const rng = mulberry32(0xa11a05);
  function genWindow(previous: RollingSummary | undefined, turn: number): TrackingWindow {
    const decisions = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `decision t${turn}#${i}`);
    const confirmed = [
      ...decisions.filter(() => rng() < 0.3),
      ...(previous?.unresolvedQuestions ?? []).filter(() => rng() < 0.25)
    ];
    return {
      ...(previous !== undefined ? { previous } : {}),
      contextFacts: ["fact"],
      toolSituations: [],
      constraints: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
        id: `c_t${turn}#${i}`,
        text: `text ${i}`,
        kind: "constraint" as const,
        mandatory: true as const
      })),
      unresolvedDecisions: decisions,
      confirmedDecisions: confirmed,
      openMinors: []
    };
  }
  for (let episode = 0; episode < 150; episode += 1) {
    let prevCurrent: RollingSummary | undefined;
    let prevCandidate: RollingSummary | undefined;
    const turns = 2 + Math.floor(rng() * 14);
    const maxItems = rng() < 0.3 ? 4 + Math.floor(rng() * 8) : undefined;
    for (let turn = 0; turn < turns; turn += 1) {
      const windowCurrent = genWindow(prevCurrent, turn);
      const windowCandidate: TrackingWindow = {
        ...windowCurrent,
        ...(prevCandidate !== undefined ? { previous: prevCandidate } : {})
      };
      if (prevCandidate === undefined) delete (windowCandidate as { previous?: unknown }).previous;
      const base = {
        prescore: 0.8,
        human: { kind: "unobserved" } as HumanSignal,
        score: 0.8,
        anomalyCodes: [],
        evidenceRefs: [`evd_${turn}`],
        openMinors: [],
        ...(maxItems !== undefined ? { maxItems } : {})
      };
      prevCurrent = rollSummary({ window: windowCurrent, ...base }).summary;
      prevCandidate = candidateRoll({ window: windowCandidate, ...base }).summary;
      check(
        "S1-A-5 equivalence",
        JSON.stringify(prevCurrent) === JSON.stringify(prevCandidate),
        `episode ${episode} turn ${turn}`
      );
    }
  }
  // benchmark one 12-turn episode chain at real scale
  function chain(fn: (input: Parameters<typeof rollSummary>[0]) => { summary: RollingSummary }): void {
    const rng2 = mulberry32(0xa11a06);
    const localGen = (previous: RollingSummary | undefined, turn: number): TrackingWindow => {
      const decisions = Array.from({ length: Math.floor(rng2() * 4) }, (_, i) => `decision t${turn}#${i}`);
      return {
        ...(previous !== undefined ? { previous } : {}),
        contextFacts: ["fact"],
        toolSituations: [],
        constraints: Array.from({ length: Math.floor(rng2() * 3) }, (_, i) => ({
          id: `c_t${turn}#${i}`,
          text: `text ${i}`,
          kind: "constraint" as const,
          mandatory: true as const
        })),
        unresolvedDecisions: decisions,
        confirmedDecisions: decisions.filter(() => rng2() < 0.3),
        openMinors: []
      };
    };
    let previous: RollingSummary | undefined;
    for (let turn = 0; turn < 12; turn += 1) {
      previous = fn({
        window: localGen(previous, turn),
        prescore: 0.8,
        human: { kind: "unobserved" },
        score: 0.8,
        anomalyCodes: [],
        evidenceRefs: [`evd_${turn}`],
        openMinors: []
      }).summary;
    }
  }
  const cur = bench(() => chain(rollSummary), 3000);
  const cand = bench(() => chain(candidateRoll), 3000);
  console.log(
    `S1-A-5 bench 12-turn episode: current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us delta=${((cur - cand) * 1e3).toFixed(2)}us`
  );
}

/* ============================================================
 * S1-A-6: gates shouldEscalateMinors single pass
 * ============================================================ */
{
  function candidateGates(input: GateInput) {
    const fused = (() => {
      const codesHard: string[] = [];
      if (input.deterministicFail) codesHard.push("deterministic-fail");
      if (input.ownershipEscape) codesHard.push("ownership-escape");
      if (input.claimedVerificationWithoutChecks) codesHard.push("claimed-verification-without-checks");
      if (input.repeatedNoProgress) codesHard.push("repeated-no-progress");
      if (input.userRejectStop) codesHard.push("user-reject-stop");
      if (input.safetyRejected) codesHard.push("permission-security-reject");
      if (codesHard.length > 0) {
        return {
          kind: "hard",
          codes: codesHard,
          wakeAnalysis: true,
          expandDetail: true,
          askUser: input.userRejectStop,
          openMinors: input.openMinors
        };
      }
      if (input.score < input.config.softThreshold) {
        return { kind: "soft", codes: ["soft-threshold"], wakeAnalysis: true, expandDetail: true, askUser: false, openMinors: input.openMinors };
      }
      let verifiedCount = 0;
      let escalate = false;
      for (const item of input.openMinors) {
        if (item.status !== "verified-true") continue;
        verifiedCount += 1;
        if (item.consecutiveTurns >= 2 || item.touchesConstraint || item.userRejected || verifiedCount >= 3) {
          escalate = true;
          break;
        }
      }
      if (escalate) {
        return { kind: "soft", codes: ["minor-escalated"], wakeAnalysis: true, expandDetail: true, askUser: false, openMinors: input.openMinors };
      }
      return { kind: "none", codes: [], wakeAnalysis: false, expandDetail: false, askUser: false, openMinors: input.openMinors };
    })();
    return fused;
  }
  const rng = mulberry32(0xa11a07);
  for (let trial = 0; trial < 8000; trial += 1) {
    const minors: OpenMinor[] = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => ({
      id: `m${i}`,
      text: `minor ${i}`,
      status: rng() < 0.7 ? "verified-true" : UNOBSERVED,
      consecutiveTurns: Math.floor(rng() * 4),
      touchesConstraint: rng() < 0.15,
      userRejected: rng() < 0.1
    }));
    const input: GateInput = {
      P: rng(),
      score: rng(),
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: rng() < 0.1,
      ownershipEscape: rng() < 0.1,
      claimedVerificationWithoutChecks: rng() < 0.1,
      repeatedNoProgress: rng() < 0.1,
      userRejectStop: rng() < 0.1,
      safetyRejected: rng() < 0.1,
      openMinors: minors
    };
    check(
      "S1-A-6 equivalence",
      JSON.stringify(evaluateGates(input)) === JSON.stringify(candidateGates(input)),
      JSON.stringify(input.openMinors)
    );
  }
  console.log("S1-A-6 equivalence over 8000 fuzz trials: OK (perf at <=6 minors is sub-noise; not benched separately)");
}

/* ============================================================
 * S1-A-2: from-child duplicate computePrescore
 * demonstrate the two computations are identical (purity), then
 * adjudicate rejection on parallel-entry risk + noise.
 * ============================================================ */
{
  const rng = mulberry32(0xa11a08);
  for (let trial = 0; trial < 3000; trial += 1) {
    const outcome = pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const);
    const verified = rng();
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["implementer", "tester", "scout"]),
      outcome,
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      ...(verified < 0.85
        ? {
            verification: {
              kind: verified < 0.5 ? ("PASSED" as const) : verified < 0.75 ? ("FAILED" as const) : ("UNOBSERVED" as const),
              evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : []
            }
          }
        : {}),
      requiredChecks: rng() < 0.4 ? ["test"] : [],
      constraints:
        rng() < 0.3
          ? [{ id: "c1", text: "keep scope", kind: "constraint" as const, mandatory: true as const }]
          : []
    };
    const prescoreInput = prescoreInputFromObservation(observation);
    const once = computePrescore(prescoreInput);
    const twice = computePrescore({ ...prescoreInput, lightMinorCount: 0 });
    check(
      "S1-A-2 purity (outer call == inner call)",
      JSON.stringify(once) === JSON.stringify(twice),
      JSON.stringify(observation)
    );
    const decision = assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" });
    if (decision.apply) {
      check(
        "S1-A-2 composed consistency",
        decision.assessment.quality === decision.prescore.quality &&
          decision.assessment.coverage === decision.prescore.coverage
      );
    }
  }
  const observation: ChildObservation = {
    taskId: "tsk_bench",
    role: "tester",
    outcome: "SUCCESS",
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    verification: { kind: "PASSED", evidenceIds: ["evd_1"] },
    requiredChecks: ["test"],
    constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }]
  };
  const full = bench(() => assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" }), 5000);
  const oneCall = bench(() => computePrescore(prescoreInputFromObservation(observation)), 5000);
  console.log(
    `S1-A-2 bench: assessChildObservation=${(full * 1e6).toFixed(1)}ns, one computePrescore=${(oneCall * 1e6).toFixed(1)}ns -> duplicate share=${((oneCall / full) * 100).toFixed(1)}% of an already-microsecond call, ~5 calls/run`
  );
}

/* ============================================================
 * nextTrackingSeq real-scale cost anchor (context for S1-A-1/9)
 * ============================================================ */
{
  const events = genEvents(mulberry32(0xa11a09), 41) as unknown as Parameters<typeof nextTrackingSeq>[0];
  const cost = bench(() => nextTrackingSeq(events), 20000);
  console.log(`anchor: nextTrackingSeq over E=41 events = ${(cost * 1e6).toFixed(1)}ns per call`);
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

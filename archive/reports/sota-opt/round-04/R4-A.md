# R4-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第四遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-A（Round 1–3 同区第四遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `9df3ea4`
**分支:** `cursor/r4-a-tracking-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；本切片在当前数据面规模下已预算收口。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A（`384536e`）、R3-A（`e3c0e8f`）
至本轮基线（`9df3ea4`）**逐字节未变**（`git diff 7acb666..9df3ea4 -- src/tracking/
src/run/child-tracking.ts src/run/gate-apply.ts` 为空）。R3-A 的整片预算支配论证
经本轮实测**复核仍成立**（§1）。在完整排除表之上以新角度第四遍枚举，得到 3 个
此前未点名的新候选（S4-A-1 … S4-A-3），全部经理论 + 确定性仿真（seeded
mulberry32，等价 fuzz + 真实规模基准，两次独立运行结论逐位一致）裁决后淘汰：
全部收益在 ns–亚 µs 噪声带，其中 1 个的获益路径生产不可达。未重开任何
X* / S1-* / S2-* / S3-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md / round-04/PLAN.md /
  round-01/R1-A.md / round-02/R2-A.md / round-03/R3-A.md。候选枚举刻意绕开全部
  既有排除（X0-4、X0-6、X1-1、X2-4、S1-A-1..9、S2-A-1..6、S3-A-1..4 等），只探索
  **未被点名的第四组新角度**：死字段覆盖 + 免克隆直传（S4-A-1）、caller 侧前置
  条件提升（S4-A-2）、入口守卫收窄后的死重检（S4-A-3）。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 / minorPDip 0.03）、
  哈希契约、事件 schema、CAS/幂等键格式全部不变——本轮零 diff，天然满足。
  三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写路由、live = R0
  等价、双 LCB 双归因保留）同样天然满足。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（本轮首要任务）

R3-A §3 建立的整片预算论证依赖两个前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..9df3ea4 -- <切片>` 为空，逐字节一致。
2. **调用面未变**：`e3c0e8f..9df3ea4` 间 `src/` 仅 `src/routing/offline-logit.ts`
   变动（S3-C 落地），不触及切片；生产调用方仍为 `supervisor.ts` /
   `coordinator.ts` / `flowchart-run.ts` 经 `applyChildThreeLine` /
   `applyTrackingGate` 到达，每子结果一次（~5 次/run），事件表几十级（41）。

本轮在当前 VM 重测预算锚点（两次独立运行）：

```text
anchor: one applyChildThreeLine over 41-event table = 12.1–12.3 µs（apply 全路径）
=> ~5 gates/run => 切片每 run 总预算 ≈ 60–61 µs
```

绝对值比 R3-A 的 19.0–22.8 µs/gate 更低（VM 差异），量级结论不变：即使把整个
切片优化到零成本，节省上界 ~0.06–0.11 ms/run，仍比战役落地线（数十~数百 ms
或复杂度类下降）低**约三个量级**。复杂度类下降的仅存位点维持既有排除
（X0-4/X2-4 事件表索引化、S1-A-1/S1-A-9 反向早退、X1-1 hashSummary 跨调用
缓存、R1-A 裁决的不可变累计快照构造下界）。**支配论证复核成立，本切片在
当前数据面规模下已预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-A-1 | `turn.ts` `rollSummary({ window: { ...input.window, openMinors }, ... })` 中 window 克隆的 `openMinors` 覆盖是**死写入**（`rollSummary` 只读 `RollInput.openMinors`，从不读 `window.openMinors`），整个 spread 克隆可省略直传 `input.window` | 免每 turn 一次 ~9 字段对象克隆；无身份泄漏——输出唯一保留的 window 字段是 `summary.operations`，两种写法都别名同一个 `input.window.toolSituations` | ✅ 4000 组 lemma fuzz（rollSummary 对 window.openMinors 值与 window 对象身份不变）+ 400 条 episode 链全 `runTrackingTurn` 副本对比（含 failClosed / wakeAnalysis packet / readers / gateFacts / list-humanInput 全路径）JSON 逐位一致 | 省 **493–582 ns/turn** × ~5 turns/run ≈ 2.5–2.9 µs/run | 淘汰：门槛 (c) 不过。绝对量低于落地线四个量级；S3-A-1（roller 死 text 字段）同族「死写入消除、真实规模噪声」先例 |
| S4-A-2 | `child-tracking.ts` `applyChildThreeLine` 把 verification kind 预检提升到 caller 侧（`terminal.verification?.kind` 非 PASSED/FAILED 即早退），非 apply 路径跳过 `episodeIdFromEvents` O(E) 扫描 + `observationFromChild` 构造 | 非 apply 路径 O(E)+构造 → O(1)；`episodeIdFromEvents` / `observationFromChild` 均纯函数无抛错，检查重排等价 | ✅ 3000 组 fuzz（terminal 缺失 / verification 缺失 / UNOBSERVED / PASSED / FAILED × 有无 RUN_ATTACHED × 有无 spec/contract，双变体喂相同确定性 id 流）result 与 events JSON 逐位一致，skip 路径引用同一性一致 | 省 **432–455 ns/skip**（E=41）；但**生产该路径 ~0 次/run**——R1-A 实测 harness 中 5/5 子结果全走 apply 路径，非 apply verification 是异常态 | 淘汰：获益路径生产近不可达（S3-A-2 同族）+ 量级亚噪声 + 预检谓词与 `assessChildObservation` 入口守卫跨函数重复（S2-A-3 同类耦合） |
| S4-A-3 | `from-child.ts` `assessChildObservation` 内部调用 `shouldApplyThreeLine` 时 verification kind 已被入口守卫收窄为 PASSED/FAILED，其首条件是死重检；消除需改公开函数或在调用点内联 `coverage > 0 && hasHardPassOrFail` | 免 1 次布尔双比较/子结果 | ✅ 2000 组 lemma fuzz（收窄域上全谓词 ≡ 缩减谓词） | 整个 `shouldApplyThreeLine` 调用仅 **18.5–19.8 ns**，死条件是其中一小部分 × ~5 次/run | 淘汰：深度亚噪声；`shouldApplyThreeLine` 是公开导出，改签名/行为伤外部调用方，内联=逻辑重复（S3-H-1「删防御纵深」同类否决方向） |

## 3. 关键裁决细节

### S4-A-1（本轮唯一结构性新发现）为何仍淘汰

这是四遍搜查中该文件仅剩的未点名死工作：`turn.ts` 把 `openMinors` 同时放进
window 克隆和 `RollInput.openMinors`，而 `rollSummary` 的读取集是
`window.{previous, constraints, unresolvedDecisions, confirmedDecisions,
toolSituations}`——window 侧的 `openMinors` 覆盖无人读取，整个克隆是纯开销。
等价性双层验证：(a) lemma fuzz 证明 `rollSummary` 输出对 `window.openMinors`
的任意值与 window 对象身份均不变；(b) 全 `runTrackingTurn` 副本在 400 条
episode 链（两变体各自消费自己的 previous 链）上 JSON 逐位一致。身份层面也
无可观察差异（与 S1-A-7 不同）：候选不别名任何新对象给输出，`summary.operations`
在两种写法下都指向同一个 `input.window.toolSituations`。

淘汰完全落在门槛 (c)：493–582 ns/turn、~2.5–2.9 µs/run，在 §1 复核的整片
60 µs/run 预算内即使按比例看也只有 ~4%，绝对量低于落地线四个量级。
S2-A-1（同文件整套 mandatory 机器跳过，~12 µs/episode）与 S3-A-1（同类死写入）
两个更强候选均已被否决，本候选被支配论证覆盖。

### S4-A-2 的生产不可达论证

`applyChildThreeLine` 的非 apply verification 路径（verification 缺失或
UNOBSERVED）要求子任务以 SUCCESS/FAILURE 终止**但不带可判定 verification**。
集成 harness 实测（R1-A §1）：5/5 子结果全部 apply。该路径是协议异常态而非
稳态流量，节省的 432–455 ns/skip 乘以 ~0 的现实频次 = 生产零收益。apply 路径
上预检只加一次 `?.kind` 双比较（本轮实测加不出可测差异；仿真输出中 apply 路径
current 15.1–15.2 µs vs cand 12.2–12.5 µs 的差是首测 JIT 热身序偏置——末尾
预算锚点对 current 重测得 12.1–12.3 µs，与 cand 同带）。

### 逐文件收口（第四遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `turn.ts` | window 克隆死 openMinors 覆盖（本轮唯一结构性新发现）；`openMinors.filter().length` 计数、humanInput 条件 spread、failClosed `uniqueCodes` 维持 R1-A/R3-A 无 ID 裁决 | S4-A-1 淘汰 |
| `child-tracking.ts` | caller 侧 verification 预检提升；5 次事件表扫描维持 X2-4/X0-4；`skipped` 常量提升维持 R3-A 身份类裁决 | S4-A-2 淘汰 |
| `from-child.ts` | 内部 `shouldApplyThreeLine` 死重检；S1-A-2 / S2-A-2/6 收口维持；window 字面量构造 ns 级 | S4-A-3 淘汰 |
| `roller.ts` | S1-A-5 / S2-A-1 / S3-A-1 三层收口后无剩余未点名结构；`uniqueStrings`/`mergeConstraints` 已线性 | 无新候选 |
| `prescore.ts` | `evidenceOutcome` 三次 some 融合 = S1-A-4 族（实测更慢先例）；`dimension()` 条件 spread 为微观常数族 | 无新候选 |
| `gate-apply.ts` | 双 find + currentGateStatus + nextTrackingSeq 扫描维持 X2-4/X0-4/S1-A-1/S1-A-9；双 hashAssessment 维持 R1-A CAS fail-closed 契约裁决；`mapGateDirective` FAIL_CLOSED 兜底维持保留 | 无新候选 |
| `human-score.ts` | 每调用 `new RegExp` 重建维持 R3-A「X0-6 对偶面」裁决；S1-A-3 收口维持 | 无新候选 |
| `gates.ts` | S1-A-6 收口维持，无新结构 | 无新候选 |
| `types.ts` | `hashAssessment`/`hashSummary` spread 必要性（R2-A）与 parse 面（X0-5/S1-A-8）维持 | 无新候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `combined-score.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 单表达式 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守「不要为了交差写死代码」），完整源码见附录。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A/R2-A/R3-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真（临时脚本；seed 固定可复现，两次独立运行）：

```text
run 1:
S4-A-1 bench one turn at from-child scale: current=2516.6ns cand=2024.0ns delta=492.6ns/turn (x~5 turns/run)
S4-A-2 bench non-apply path (UNOBSERVED verification, E=41): current=739.5ns cand=307.9ns delta=431.6ns/skip [production: ~0 such skips/run]
S4-A-2 bench apply path (E=41): current=15.2us cand=12.2us (precheck adds no measurable cost)
S4-A-3 bench: one shouldApplyThreeLine call (incl. dead re-check) = 19.8ns
anchor: one applyChildThreeLine over 41-event table = 12.3us -> ~5 gates/run => ~61us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S4-A-1 delta=581.8ns/turn | S4-A-2 delta=455.1ns/skip | S4-A-3 =18.5ns
anchor: 12.1us -> ~60us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价结论逐位一致，全部计时方向稳定，裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-A-1 | turn.ts rollSummary 调用处 window 死 openMinors 覆盖 + 免克隆直传 | 等价（含身份层）但 493–582ns/turn ≈ 2.5–2.9µs/run，低于落地线四个量级 |
| S4-A-2 | applyChildThreeLine caller 侧 verification kind 预检提升 | 等价但获益路径生产 ~0 次/run + 432–455ns/skip 亚噪声 + 跨函数谓词重复 |
| S4-A-3 | assessChildObservation 内 shouldApplyThreeLine 死首条件消除 | 整调用 18.5–19.8ns 深度亚噪声 + 公开函数行为/逻辑重复代价 |

重开条件：S4-A-1 若 tracking turn 频次或 window 字段规模增长 ≥2 个量级可凭
本报告等价性证据（lemma + 400 链全副本 fuzz）重开；S4-A-2 需先出现「无可判定
verification 的子结果」成为稳态流量的生产调用方；S4-A-3 需先推翻公开面变更
的成本判断。整片预算支配论证（§1）的重开条件不变：run 事件表或每 turn 集合
规模增长 ≥2–3 个量级，届时 S1-A-1、S2-A-1、S2-A-3、S4-A-1 可凭既有等价性
证据优先重开。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa44a01`–`0xa44a03`。

```ts
/**
 * R4-A deterministic equivalence + benchmark simulation (fourth pass).
 * Adjudicates fresh candidates S4-A-1 .. S4-A-3 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply},
 * and re-verifies the R3-A whole-slice budget anchor.
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A
 * (S1-A-1..9), R2-A (S2-A-1..6) or R3-A (S3-A-1..4).
 * Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa44a01 .. 0xa44a03.
 */
import { performance } from "node:perf_hooks";
import { DEFAULT_TRACKING_CONFIG } from "/workspace/src/tracking/config.js";
import { combineScore } from "/workspace/src/tracking/combined-score.js";
import { evaluateGates } from "/workspace/src/tracking/gates.js";
import {
  extractHumanScore,
  hasObviousHumanProblem,
  humanScoreValue
} from "/workspace/src/tracking/human-score.js";
import { computePrescore, isSuccessClaim, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import {
  mergeOpenMinors,
  runTrackingTurn,
  type TrackingTurnInput,
  type TrackingTurnResult
} from "/workspace/src/tracking/turn.js";
import {
  assessChildObservation,
  shouldApplyThreeLine,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { applyChildThreeLine, observationFromChild } from "/workspace/src/run/child-tracking.js";
import {
  applyTrackingGate,
  nextTrackingSeq,
  type GateApplyResult
} from "/workspace/src/run/gate-apply.js";
import { episodeIdFromEvents } from "/workspace/src/run/episode-bind.js";
import type { Event } from "/workspace/src/run/events.js";
import type { EventId } from "/workspace/src/domain/ids.js";
import type {
  AnomalyCode,
  AnomalyPacket,
  AnomalyPacketWindow,
  ConstraintRecord,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  ToolSituation,
  TrackingWindow
} from "/workspace/src/tracking/types.js";
import { UNOBSERVED, hashAssessment } from "/workspace/src/tracking/types.js";

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
 * S4-A-1: turn.ts passes `window: { ...input.window, openMinors }`
 * to rollSummary, but rollSummary NEVER reads window.openMinors
 * (it uses RollInput.openMinors). The override is a dead write and
 * the whole window spread clone is unnecessary: candidate passes
 * input.window directly. No identity change is observable: the only
 * window field retained in the output is summary.operations, which
 * aliases input.window.toolSituations in BOTH variants.
 * Candidate = full replica of runTrackingTurn with that one change
 * (private helpers copied verbatim).
 * ============================================================ */
function candidateRunTrackingTurn(input: TrackingTurnInput): TrackingTurnResult {
  const config = input.config ?? DEFAULT_TRACKING_CONFIG;
  const openMinors = mergeOpenMinors(input.window.previous?.openMinors ?? [], input.window.openMinors);
  const lightMinorCount =
    input.prescoreInput.lightMinorCount ??
    openMinors.filter((item) => item.status === "verified-true").length;
  const prescore = computePrescore({
    ...input.prescoreInput,
    lightMinorCount
  });
  const userText = input.humanInput.userText ?? input.window.userText;
  const human = extractHumanScore({
    ...(input.humanInput.list !== undefined ? { list: input.humanInput.list } : {}),
    ...(userText !== undefined ? { userText } : {})
  });
  const obviousProblem = hasObviousHumanProblem(human);
  const score = combineScore({ P: prescore.P, human, obviousProblem });
  const safetyRejected = input.gateFacts?.safetyRejected ?? (human.kind === "ratio" && human.safetyRejected);
  const userRejectStop =
    input.gateFacts?.userRejectStop ?? (human.kind === "short-rule" && human.bucket === "whole-reject");

  let gate = evaluateGates({
    P: prescore.P,
    score,
    human,
    config,
    deterministicFail: input.gateFacts?.deterministicFail ?? false,
    ownershipEscape:
      input.gateFacts?.ownershipEscape ?? input.window.toolSituations.some((tool) => tool.escaped),
    claimedVerificationWithoutChecks: candidateDerived(input),
    repeatedNoProgress: input.gateFacts?.repeatedNoProgress ?? input.prescoreInput.stalledTurns >= 2,
    userRejectStop,
    safetyRejected,
    openMinors
  });

  let readersInvoked: TrackingTurnResult["readersInvoked"] = {
    toolBodies: false,
    chainOfThought: false
  };
  let toolBodies: readonly string[] | undefined;
  if (gate.expandDetail && input.readers?.readToolBodies !== undefined) {
    toolBodies = input.readers.readToolBodies();
    readersInvoked = { toolBodies: true, chainOfThought: false };
  }

  const anomalyCodes = [...gate.codes];

  const rolled = rollSummary({
    window: input.window, // CANDIDATE: dead openMinors override + clone removed
    prescore: prescore.P,
    human,
    score,
    anomalyCodes,
    evidenceRefs: candidateCollectEvidence(input.window),
    openMinors,
    ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {})
  });

  let summary = rolled.summary;
  if (summary.failClosed) {
    const codes: AnomalyCode[] = candidateUniqueCodes([...summary.anomalyCodes, "mandatory-omission"]);
    summary = { ...summary, anomalyCodes: codes };
    gate = { ...gate, askUser: true, codes };
  }

  let packet: AnomalyPacket | undefined;
  if (gate.wakeAnalysis) {
    const windowDetail: AnomalyPacketWindow = {
      contextFacts: input.window.contextFacts,
      toolSituations: input.window.toolSituations,
      ...(input.window.userText !== undefined
        ? { userText: input.window.userText, userTextTrust: "UNTRUSTED_TEXT" as const }
        : {}),
      ...(input.window.aiText !== undefined ? { aiText: input.window.aiText } : {}),
      ...(toolBodies !== undefined ? { toolBodies } : {})
    };
    packet = {
      summary,
      window: windowDetail,
      P: prescore.P,
      H: humanScoreValue(human),
      score,
      gate: gate.codes[0] ?? "soft-threshold",
      evidenceRefs: summary.evidenceRefs
    };
  }

  return {
    summary,
    P: prescore.P,
    human,
    score,
    gate,
    ...(packet !== undefined ? { packet } : {}),
    readersInvoked
  };
}

function candidateDerived(input: TrackingTurnInput): boolean {
  if (input.gateFacts?.claimedVerificationWithoutChecks !== undefined) {
    return input.gateFacts.claimedVerificationWithoutChecks;
  }
  const required = input.prescoreInput.requiredChecks;
  const completed = input.prescoreInput.completedChecks;
  const requiredCheckGap =
    required.length > 0 && !required.every((id) => completed.includes(id));
  return input.prescoreInput.claims.some(isSuccessClaim) && requiredCheckGap;
}

function candidateCollectEvidence(window: TrackingWindow): string[] {
  const refs = new Set<string>();
  for (const tool of window.toolSituations) {
    for (const id of tool.evidenceIds) refs.add(id);
    for (const id of tool.artifactIds) refs.add(id);
    for (const hash of tool.hashes) refs.add(hash);
  }
  return [...refs];
}

function candidateUniqueCodes(codes: readonly AnomalyCode[]): AnomalyCode[] {
  return [...new Set(codes)];
}

{
  const rng = mulberry32(0xa44a01);

  // Lemma fuzz: rollSummary output is invariant to window.openMinors and
  // to the window object identity (clone vs original).
  for (let trial = 0; trial < 4000; trial += 1) {
    const genMinors = (n: number): OpenMinor[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        text: `minor ${i}`,
        status: rng() < 0.6 ? "verified-true" : UNOBSERVED,
        consecutiveTurns: Math.floor(rng() * 3),
        touchesConstraint: rng() < 0.2,
        userRejected: rng() < 0.1
      }));
    const constraints: ConstraintRecord[] = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
      id: `c_${i}`,
      text: `text ${i}`,
      kind: "constraint" as const,
      mandatory: true as const
    }));
    const decisions = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `d${i}`);
    const window: TrackingWindow = {
      contextFacts: ["fact"],
      toolSituations: [],
      constraints,
      unresolvedDecisions: decisions,
      confirmedDecisions: decisions.filter(() => rng() < 0.3),
      openMinors: genMinors(Math.floor(rng() * 4))
    };
    const base = {
      prescore: Number(rng().toFixed(4)),
      human: { kind: "unobserved" } as HumanSignal,
      score: Number(rng().toFixed(4)),
      anomalyCodes: [] as AnomalyCode[],
      evidenceRefs: [`evd_${trial}`],
      openMinors: genMinors(Math.floor(rng() * 4)),
      ...(rng() < 0.3 ? { maxItems: 1 + Math.floor(rng() * 6) } : {})
    };
    const viaClone = rollSummary({ window: { ...window, openMinors: genMinors(5) }, ...base });
    const direct = rollSummary({ window, ...base });
    check(
      "S4-A-1 lemma (rollSummary invariant to window.openMinors + clone)",
      JSON.stringify(viaClone.summary) === JSON.stringify(direct.summary),
      JSON.stringify(window)
    );
    // identity fact: operations aliases input toolSituations in both variants
    check("S4-A-1 operations identity", direct.summary.operations === window.toolSituations);
  }

  // Full runTrackingTurn replica equivalence fuzz, chained over episodes so
  // previous summaries flow through both variants independently.
  const genTool = (): ToolSituation => {
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
  };
  const genMinors2 = (n: number): OpenMinor[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${Math.floor(rng() * 5)}`,
      text: `minor ${i}`,
      status: rng() < 0.6 ? "verified-true" : UNOBSERVED,
      consecutiveTurns: Math.floor(rng() * 3),
      touchesConstraint: rng() < 0.2,
      userRejected: rng() < 0.1
    }));
  for (let episode = 0; episode < 400; episode += 1) {
    let prevCurrent: RollingSummary | undefined;
    let prevCandidate: RollingSummary | undefined;
    const turns = 1 + Math.floor(rng() * 8);
    const maxItems = rng() < 0.35 ? 1 + Math.floor(rng() * 8) : undefined;
    for (let turn = 0; turn < turns; turn += 1) {
      const checks = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `chk_${i}`);
      const constraints: ConstraintRecord[] = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
        id: `c_t${turn}#${i}`,
        text: `text ${i}`,
        kind: "constraint" as const,
        mandatory: true as const
      }));
      const decisions = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `decision t${turn}#${i}`);
      const tools = Array.from({ length: Math.floor(rng() * 3) }, genTool);
      const windowBase = {
        contextFacts: ["fact"],
        ...(rng() < 0.4
          ? { userText: pick(rng, ["7分", "继续", "回滚全部", "另外再加一个测试", "这轮还行 8/10"]) }
          : {}),
        ...(rng() < 0.2 ? { aiText: "assistant text" } : {}),
        toolSituations: tools,
        constraints,
        unresolvedDecisions: decisions,
        confirmedDecisions: decisions.filter(() => rng() < 0.3),
        openMinors: genMinors2(Math.floor(rng() * 4))
      };
      const prescoreInput: PrescoreInput = {
        claims: rng() < 0.5 ? [pick(rng, ["tests passed", "did work", "verified output", "wip"])] : [],
        toolSituations: tools,
        writePaths: rng() < 0.4 ? ["src/a.ts"] : [],
        ownedPaths: rng() < 0.8 ? ["src/a.ts"] : [],
        requiredChecks: checks,
        completedChecks: checks.filter(() => rng() < 0.75),
        constraints,
        retainedConstraintIds: constraints.filter(() => rng() < 0.85).map((c) => c.id),
        progressed: rng() < 0.15 ? UNOBSERVED : rng() < 0.8,
        stalledTurns: Math.floor(rng() * 4),
        independentEvidence: rng() < 0.5,
        ...(rng() < 0.3 ? { lightMinorCount: Math.floor(rng() * 3) } : {})
      };
      const gateFacts =
        rng() < 0.3
          ? {
              ...(rng() < 0.5 ? { deterministicFail: rng() < 0.5 } : {}),
              ...(rng() < 0.5 ? { safetyRejected: rng() < 0.5 } : {})
            }
          : undefined;
      const readers = rng() < 0.3 ? { readToolBodies: () => ["body-1", "body-2"] } : undefined;
      const rng2Stable = rng();
      const mk = (previous: RollingSummary | undefined): TrackingTurnInput => ({
        window: { ...windowBase, ...(previous !== undefined ? { previous } : {}) },
        prescoreInput,
        humanInput: rng2Stable < 0.5 ? {} : { userText: "named error continue" },
        ...(gateFacts !== undefined ? { gateFacts } : {}),
        ...(readers !== undefined ? { readers } : {}),
        ...(maxItems !== undefined ? { maxItems } : {})
      });
      const currentOut = runTrackingTurn(mk(prevCurrent));
      const candidateOut = candidateRunTrackingTurn(mk(prevCandidate));
      check(
        "S4-A-1 full-turn equivalence",
        JSON.stringify(currentOut) === JSON.stringify(candidateOut),
        `episode ${episode} turn ${turn} maxItems=${maxItems}`
      );
      prevCurrent = currentOut.summary;
      prevCandidate = candidateOut.summary;
    }
  }

  // benchmark at the real from-child production scale (single tool situation,
  // couple checks/constraints, no previous)
  const benchTools: ToolSituation[] = [
    { name: "task-result", exitCode: 0, wrote: true, escaped: false, artifactIds: ["art_1"], evidenceIds: ["evd_1"], hashes: [] }
  ];
  const benchInput: TrackingTurnInput = {
    window: {
      contextFacts: ["role tester", "task tsk_bench"],
      toolSituations: benchTools,
      constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }],
      unresolvedDecisions: [],
      confirmedDecisions: [],
      openMinors: []
    },
    prescoreInput: {
      claims: ["tests passed"],
      toolSituations: benchTools,
      writePaths: [],
      ownedPaths: [],
      requiredChecks: ["chk_0"],
      completedChecks: ["chk_0"],
      constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }],
      retainedConstraintIds: ["c1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    },
    humanInput: {}
  };
  const cur = bench(() => runTrackingTurn(benchInput), 30000);
  const cand = bench(() => candidateRunTrackingTurn(benchInput), 30000);
  console.log(
    `S4-A-1 bench one turn at from-child scale: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/turn (x~5 turns/run)`
  );
}

/* ============================================================
 * Shared event-table builders for S4-A-2 and the budget anchor.
 * Minimal realistic shapes, mirroring the R3-A harness casts.
 * ============================================================ */
const NOW_ISO = "2026-08-24T00:00:00.000Z";
function buildEvents(withAttach: boolean, fillers: number, nextId: () => EventId): Event[] {
  const runId = "run_x" as Event["runId"];
  const events: Event[] = [];
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId,
    type: "RUN_STARTED",
    actor: "system",
    payload: { title: "bench" }
  } as unknown as Event);
  if (withAttach) {
    events.push({
      id: nextId(),
      schemaVersion: 1,
      occurredAt: NOW_ISO as Event["occurredAt"],
      runId,
      type: "RUN_ATTACHED",
      actor: "supervisor",
      payload: { episodeId: "ep_bench", runId, attachedAt: NOW_ISO }
    } as unknown as Event);
  }
  for (let i = 0; i < fillers; i += 1) {
    events.push({
      id: nextId(),
      schemaVersion: 1,
      occurredAt: NOW_ISO as Event["occurredAt"],
      runId,
      type: "CHILD_MESSAGE",
      actor: "child",
      payload: { taskId: `tsk_${i % 5}`, content: "..." }
    } as unknown as Event);
  }
  return events;
}

type ApplyInput = Parameters<typeof applyChildThreeLine>[0];

/* ============================================================
 * S4-A-2: applyChildThreeLine caller-side verification precheck.
 * assessChildObservation rejects unless verification.kind is
 * PASSED/FAILED; hoisting that check before episodeIdFromEvents and
 * observationFromChild skips one O(E) scan plus the observation
 * construction on non-apply verification paths. Candidate = replica
 * with the precheck (duplicates the downstream predicate ->
 * cross-function coupling, S2-A-3 class).
 * ============================================================ */
function candidateApplyChildThreeLine(input: ApplyInput): {
  readonly events: readonly Event[];
  readonly result: GateApplyResult;
} {
  const skipped: GateApplyResult = { applied: false, directive: "none", runStatus: "RUNNING" };
  const terminal = input.child.terminalResult;
  if (terminal === undefined) {
    return { events: input.events, result: skipped };
  }
  const verificationKind = terminal.verification?.kind; // NEW precheck
  if (verificationKind !== "PASSED" && verificationKind !== "FAILED") {
    return { events: input.events, result: skipped };
  }
  const episodeId = episodeIdFromEvents(input.events);
  if (episodeId === undefined) {
    return { events: input.events, result: skipped };
  }
  const runId = input.events[0]?.runId;
  if (runId === undefined) {
    return { events: input.events, result: skipped };
  }
  const observation = observationFromChild(input.child, input.spec, input.contract);
  const assessed = assessChildObservation({
    observation,
    episodeId,
    runId
  });
  if (!assessed.apply) {
    return { events: input.events, result: skipped };
  }
  return applyTrackingGate({
    events: input.events,
    assessment: assessed.assessment,
    assessmentHash: hashAssessment(assessed.assessment),
    expectedSeq: nextTrackingSeq(input.events),
    policyVersion: "track-v1",
    nowIso: input.nowIso,
    generateEventId: input.generateEventId
  });
}

{
  const rng = mulberry32(0xa44a02);
  for (let trial = 0; trial < 3000; trial += 1) {
    let idCounter = 0;
    const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
    const withAttach = rng() < 0.8;
    const events = buildEvents(withAttach, Math.floor(rng() * 45), nextId);
    const verifiedRoll = rng();
    const child = {
      taskId: `tsk_${trial}`,
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      ...(rng() < 0.9
        ? {
            terminalResult: {
              ...(verifiedRoll < 0.85
                ? {
                    verification: {
                      kind:
                        verifiedRoll < 0.4
                          ? ("PASSED" as const)
                          : verifiedRoll < 0.65
                            ? ("FAILED" as const)
                            : ("UNOBSERVED" as const),
                      evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : []
                    }
                  }
                : {})
            }
          }
        : {})
    };
    const spec =
      rng() < 0.7
        ? {
            role: pick(rng, ["tester", "implementer", "worker"]),
            acceptanceCriteria:
              rng() < 0.6 ? [{ id: "chk_0", description: "tests pass" }] : []
          }
        : undefined;
    const contract =
      rng() < 0.4
        ? { constraints: [{ id: "c1", description: "keep scope" }] }
        : undefined;

    const mkInput = (): ApplyInput => {
      let localCounter = 100;
      return {
        events,
        child: child as never,
        ...(spec !== undefined ? { spec: spec as never } : {}),
        ...(contract !== undefined ? { contract: contract as never } : {}),
        nowIso: NOW_ISO,
        generateEventId: () => `evt_${String(localCounter++).padStart(8, "0")}` as EventId
      };
    };
    const currentOut = applyChildThreeLine(mkInput());
    const candidateOut = candidateApplyChildThreeLine(mkInput());
    check(
      "S4-A-2 result equivalence",
      JSON.stringify(currentOut.result) === JSON.stringify(candidateOut.result),
      `trial ${trial}`
    );
    check(
      "S4-A-2 events equivalence",
      JSON.stringify(currentOut.events) === JSON.stringify(candidateOut.events),
      `trial ${trial}`
    );
    if (!currentOut.result.applied) {
      check(
        "S4-A-2 skip path returns the same events reference in both variants",
        (currentOut.events === events) === (candidateOut.events === events)
      );
    }
  }

  // bench the non-apply verification path (UNOBSERVED) over a 41-event table
  let idCounter = 0;
  const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
  const events = buildEvents(true, 39, nextId);
  const childUnobserved = {
    taskId: "tsk_bench",
    outcome: "SUCCESS" as const,
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    terminalResult: { verification: { kind: "UNOBSERVED" as const, evidenceIds: [] } }
  };
  const spec = { role: "tester", acceptanceCriteria: [{ id: "chk_0", description: "tests pass" }] };
  const mk = (child: unknown): ApplyInput => {
    let localCounter = 100;
    return {
      events,
      child: child as never,
      spec: spec as never,
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(localCounter++).padStart(8, "0")}` as EventId
    };
  };
  const curSkip = bench(() => applyChildThreeLine(mk(childUnobserved)), 20000);
  const candSkip = bench(() => candidateApplyChildThreeLine(mk(childUnobserved)), 20000);
  console.log(
    `S4-A-2 bench non-apply path (UNOBSERVED verification, E=41): current=${(curSkip * 1e6).toFixed(1)}ns cand=${(candSkip * 1e6).toFixed(1)}ns delta=${((curSkip - candSkip) * 1e6).toFixed(1)}ns/skip [production: ~0 such skips/run]`
  );
  const childApplied = {
    ...childUnobserved,
    terminalResult: { verification: { kind: "PASSED" as const, evidenceIds: ["evd_1"] } }
  };
  const curApply = bench(() => applyChildThreeLine(mk(childApplied)), 5000);
  const candApply = bench(() => candidateApplyChildThreeLine(mk(childApplied)), 5000);
  console.log(
    `S4-A-2 bench apply path (E=41): current=${(curApply * 1e3).toFixed(1)}us cand=${(candApply * 1e3).toFixed(1)}us (precheck adds no measurable cost)`
  );
}

/* ============================================================
 * S4-A-3: from-child internal shouldApplyThreeLine call re-checks the
 * verification kind that the entry guard already narrowed. The first
 * condition of shouldApplyThreeLine is dead on the internal path.
 * Removing it would change the exported function's behaviour for
 * external callers; inlining `coverage > 0 && hasHardPassOrFail` at
 * the call site duplicates logic. Measure the dead re-check.
 * ============================================================ */
{
  const rng = mulberry32(0xa44a03);
  // lemma: on the internal path the kind is always PASSED/FAILED, so the
  // first condition never fires; full predicate === reduced predicate there
  for (let trial = 0; trial < 2000; trial += 1) {
    const kind = pick(rng, ["PASSED", "FAILED"] as const);
    const coverage = Number(rng().toFixed(4));
    const hasHard = rng() < 0.7;
    const full = shouldApplyThreeLine({ verificationKind: kind, coverage, hasHardPassOrFail: hasHard });
    const reduced = coverage > 0 && hasHard;
    check("S4-A-3 lemma (narrowed kind -> first condition dead)", full === reduced);
  }
  const cost = bench(
    () => void shouldApplyThreeLine({ verificationKind: "PASSED", coverage: 0.8, hasHardPassOrFail: true }),
    100000
  );
  console.log(
    `S4-A-3 bench: one shouldApplyThreeLine call (incl. dead re-check) = ${(cost * 1e6).toFixed(1)}ns; the dead condition is a fraction of that (x~5 calls/run)`
  );
}

/* ============================================================
 * Budget anchor re-verification (R3-A section 3): applyChildThreeLine
 * end-to-end at real scale (41-event table, apply path) x ~5 gates/run
 * bounds ANY optimization in this slice from above.
 * ============================================================ */
{
  let idCounter = 0;
  const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
  const events = buildEvents(true, 39, nextId);
  const child = {
    taskId: "tsk_bench",
    outcome: "SUCCESS" as const,
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    terminalResult: {
      verification: { kind: "PASSED" as const, evidenceIds: ["evd_1"] }
    }
  };
  const spec = {
    role: "tester",
    acceptanceCriteria: [{ id: "chk_0", description: "tests pass" }]
  };
  let applied = false;
  const one = bench(() => {
    let localCounter = 100;
    const out = applyChildThreeLine({
      events,
      child: child as never,
      spec: spec as never,
      nowIso: NOW_ISO,
      generateEventId: () => `evt_${String(localCounter++).padStart(8, "0")}` as EventId
    });
    applied = out.result.applied;
  }, 5000);
  check("anchor path actually applies the gate", applied);
  console.log(
    `anchor: one applyChildThreeLine over 41-event table = ${(one * 1e3).toFixed(1)}us -> ~5 gates/run => whole-slice per-run budget ~${(one * 5 * 1e3).toFixed(0)}us (campaign landing line: ~100ms or complexity-class drop)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

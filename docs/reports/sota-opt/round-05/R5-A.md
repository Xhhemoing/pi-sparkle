# R5-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第五遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-A（Round 1–4 同区第五遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `23128f6`（含 S4-C）
**分支:** `cursor/r5-a-tracking-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；整片预算收口第三次复核成立。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A / R3-A / R4-A 至本轮基线
（`23128f6`）**逐字节未变**（`git diff 7acb666..23128f6 -- src/tracking/
src/run/child-tracking.ts src/run/gate-apply.ts` 为空）。调用面同样未变：
R4-A 基线（`9df3ea4`）以来 `src/` 仅 `src/routing/lin-alg.ts` 变动（S4-C
落地），不触及本切片及其调用方。R4-A 的 ~60 µs/run 预算天花板经本轮实测
复核为 **~96–100 µs/run**（VM 差异，与 R3-A 的 95–114 µs 同带），量级结论
不变。在完整排除表之上以新角度第五遍枚举，得到 3 个此前未点名的新候选
（S5-A-1 … S5-A-3），全部经理论 + 确定性仿真（seeded mulberry32，等价
fuzz + 真实规模基准，两次独立运行结论逐位一致）裁决后淘汰：1 个廉价变体
**不等价**（有发散反例）而可靠变体是 ns 级 + 公开面变更，1 个**实测负优化**
（理论被仿真推翻第三例），1 个 ns 级 + 平行路径代价。未重开任何
X* / S1-* / S2-* / S3-* / S4-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表）/ round-05/PLAN.md /
  round-01/R1-A.md / round-02/R2-A.md / round-03/R3-A.md / round-04/R4-A.md。
  候选枚举刻意绕开全部既有排除（X0-4、X0-6、X1-1、X2-4、S1-A-1..9、
  S2-A-1..6、S3-A-1..4、S4-A-1..3 及全部无 ID 收口裁决），只探索**未被点名的
  第五组新角度**：跨函数同数组重复谓词扫描（S5-A-1）、哈希载荷序列化常数
  改写（S5-A-2）、构造保证下的死校验短路（S5-A-3）。
- 换名重提检查：写侧 `validateEvent` 跳过（= S4-G-2 同方案换文件）、
  hashSummary 排序 decorate-sort-undecorate（= S3-B-2 同方案换位点）、
  extractHumanScore 按文本记忆化（= X1-1）均识别为既有方案换名，**未列为
  新候选**。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 / minorPDip 0.03）、
  哈希契约、事件 schema、CAS/幂等键格式全部不变——本轮零 diff，天然满足。
  三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写路由、live = R0
  等价、双 LCB 双归因保留、提升 proposal-first）同样天然满足。不声称
  Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（方法第 1 步，不假设直接实测）

R3-A §3 / R4-A §1 的整片预算论证依赖两个前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..23128f6 -- <切片>` 与
   `git diff 9df3ea4..23128f6 -- <切片>` 均为空，逐字节一致。
2. **调用面未变**：`9df3ea4..23128f6` 间 `src/` 仅 `src/routing/lin-alg.ts`
   变动（S4-C solveSymmetric 提升，24 行），不触及切片；生产调用方经全库
   grep 复核仍为 `supervisor.ts`（applyTrackingGate/nextTrackingSeq）/
   `coordinator.ts` / `flowchart-run.ts`（applyChildThreeLine），每子结果一次
   （~5 次/run），事件表几十级（41）。**无新热路径，无量级变化。**

本轮在当前 VM 重测预算锚点（两次独立运行）：

```text
anchor: one applyChildThreeLine over 41-event table = 19.2–20.1 µs（apply 全路径）
=> ~5 gates/run => 切片每 run 总预算 ≈ 96–100 µs
```

绝对值高于 R4-A 的 12.1–12.3 µs/gate（VM 差异），与 R3-A 的 19.0–22.8 µs
同带；量级结论不变：即使把整个切片优化到零成本，节省上界 ~0.1 ms/run，
仍比战役落地线（数十~数百 ms 或复杂度类下降）低**约三个量级**。复杂度类
下降的仅存位点维持既有排除（X0-4/X2-4 事件表索引化、S1-A-1/S1-A-9 反向
早退、X1-1 hashSummary 跨调用缓存、R1-A 裁决的不可变累计快照构造下界）。
**支配论证第三次复核成立，本切片在当前数据面规模下维持预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-A-1 | `turn.ts` `ownershipEscape` 的 `toolSituations.some(escaped)` 与 `prescore.ts scopeOutcome` 内同名扫描跨函数去重（from-child 路径两处扫描**同一数组引用**：`window.toolSituations === prescoreInput.toolSituations`） | 免 1 次 some 扫描/turn | 廉价变体（复用 scope-safety 维度作 ownershipEscape）❌ **发散反例**：writePaths 越权但无工具逃逸时 scope-safety=FAIL 而 escaped=false，复用会误发 hard code `ownership-escape`（路径越权 ≠ 沙箱逃逸，两个不同规格概念）；可靠变体（PrescoreResult 暴露 escaped 事实）等价成立 | 重复扫描仅 **9.8–10.0 ns/turn**（from-child 路径 ≤1 个 toolSituation 且 `escaped` 被 `prescoreInputFromObservation` 硬编码 false，2000 组 fuzz 验证） | 淘汰：廉价变体不健全；可靠变体 = 公开 `PrescoreResult` 类型变更（S3-A-3 同拒绝类）+ 亚噪声 |
| S5-A-2 | `types.ts` `hashAssessment` 载荷 `JSON.stringify` 换手写定长序列化（键序冻结、维度/verdict/kind/codes 为枚举安全串免转义，仅 episodeId/runId/turnId 走 `JSON.stringify` 转义） | 免通用序列化器的反射遍历 | ✅ 4000 组 fuzz 哈希逐字节一致（含引号/反斜杠/\u2028/中文/控制字符对抗 id 与 0.1+0.2、1e-7、1/3 等非整洁浮点） | **实测负优化**：2223.8→2466.8 ns/调用（run2: 2205.7→2531.5），慢 11–15%；×~10 次哈希/run 反而亏 2.4–3.3 µs/run | 淘汰：V8 `JSON.stringify` 内建快路径胜过手写字符串拼接——纯理论常数直觉被仿真推翻**第三例**（S1-A-4 Set 构建、S2-A-4 concat 后又一记录案例） |
| S5-A-3 | `from-child.ts` PASSED 路径 check-coverage 死校验短路：`prescoreInputFromObservation` 在 PASSED 时置 `completedChecks = [...requiredChecks]`，故 `coverageOutcome` 的 every/includes 扫描恒真，维度值仅由 `requiredChecks.length` 决定 | O(R×C) 扫描 → O(1) 长度判断 | ✅ 3000 组 fuzz 引理成立（PASSED 观察下 coverage 维度 ≡ length 判据，0–5 checks 全档） | 该扫描在真实规模（≤3 checks）仅 **21.6–21.7 ns/子结果** ×~5 次/run | 淘汰：利用引理需 call-site 特化 prescore（X1-2 平行路径类）或给 `computePrescore` 开公开旗标；收益深度亚噪声 |

## 3. 关键裁决细节

### S5-A-2（本轮唯一"理论必赢"候选）为何负优化

手写序列化在纸面上省掉了 `JSON.stringify` 的通用对象遍历、键枚举与全串
转义扫描，且 4000 组含对抗字符的 fuzz 证明输出逐字节一致（`String(n)` 与
JSON 数字序列化同源，枚举串直拼安全）。但实测稳定慢 11–15%：V8 的
`JSON.stringify` 走 C++ 内建快路径（扁平对象 + 短串场景有专门优化），而
手写路径由多段 JS 字符串拼接（rope 构造 + 中间串分配）组成。与 S1-A-4
（个位数组上 Set 构建开销 > 线性 includes）、S2-A-4（concat 慢于
spread+push 3.7×）并列为「纯理论常数直觉在 V8 真实路径上反转」的第三个
记录案例，供后续轮次防止以纯理论重提序列化改写类微改。

### S5-A-1 的双变体裁决（规格概念区分）

`scope-safety` 维度的 FAIL 有两个来源：工具 `escaped`（沙箱逃逸）**或**
`writePaths ⊄ ownedPaths`（路径越权）。gate 的 `ownership-escape` hard code
只对应前者。复用维度作 gate 事实会把纯路径越权也升级成 hard gate——反例
已构造并验证（scope=FAIL ∧ escaped=false）。可靠去重要求 `computePrescore`
在公开 `PrescoreResult` 上暴露 escaped 中间事实，属公开面变更（S3-A-3 同
类），而被去重的扫描在生产路径上只有 ≤1 个元素且 `escaped` 恒 false
（`prescoreInputFromObservation` 硬编码），10 ns/turn 深度亚噪声。

### S5-A-3 的引理（记录备查）

PASSED 观察下 `completedChecks` 是 `requiredChecks` 的逐元素拷贝，故
`every(includes)` 恒真——3000 组 fuzz 验证维度输出与 `length` 判据双向一致。
引理成立但无处安放：特化 = 平行路径，旗标 = 公开签名。若未来 checks 集合
达数千级且 PASSED 路径成为热点可凭本引理重开。

### 逐文件收口（第五遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `turn.ts` | ownershipEscape 跨函数同数组双扫（本轮唯一新结构性发现）；extractHumanScore 空输入入参构造维持 R3-A 无 ID 裁决 | S5-A-1 淘汰 |
| `types.ts` | hashAssessment 序列化常数改写；hashSummary 同类（更复杂：undefined 省略语义 + operations 嵌套）被 S5-A-2 负优化结果支配 | S5-A-2 淘汰 |
| `from-child.ts` | PASSED 路径 coverage 死校验；`collectEvidence` 第三次 refs 重建 = S1-A-2 注入口方案换位点，不另立 ID | S5-A-3 淘汰 |
| `prescore.ts` | evidenceOutcome/scopeOutcome/coverageOutcome/constraintOutcome 的 some/every/includes 全部 = S1-A-4 族（实测更慢先例）维持 | 无新候选 |
| `roller.ts` | S1-A-5 / S2-A-1 / S3-A-1 三层收口后无剩余未点名结构（R4-A 同判） | 无新候选 |
| `gate-apply.ts` | 写侧 validateEvent 跳过 = S4-G-2 换名，拒列；双 find/currentGateStatus/nextTrackingSeq 维持 X2-4/X0-4/S1-A-1/S1-A-9；双 hashAssessment 维持 CAS fail-closed 契约裁决 | 无新候选 |
| `child-tracking.ts` | S4-A-2 预检提升收口维持；observationFromChild 构造均有同类裁决 | 无新候选 |
| `human-score.ts` | extractShortRule 正则按频次重排**不等价**（文本同时命中多桶时优先序语义发散），不列 ID；每调用 new RegExp 维持 R3-A「X0-6 对偶面」裁决 | 无新候选 |
| `gates.ts` | S1-A-6 收口维持，无新结构 | 无新候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `combined-score.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 单表达式 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守方法第 4 条），完整源码见附录。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A/R2-A/R3-A/R4-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真（临时脚本；seed 固定可复现，两次独立运行）：

```text
run 1:
S5-A-1 variant A counterexample: scope-safety=FAIL but toolSituations.some(escaped)=false -> reuse NOT equivalent
S5-A-1 variant B duplicate scan cost at from-child scale (1 tool): 10.0ns/turn (x~5 turns/run)
S5-A-2 bench: current=2223.8ns cand=2466.8ns delta=-243.0ns/call (x~10 hash calls/run => -2430ns/run)
S5-A-3 bench: trivially-true every/includes scan at real scale (3 checks) = 21.7ns/child result (x~5/run)
anchor: one applyChildThreeLine over 41-event table = 20.1us -> ~5 gates/run => ~100us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S5-A-1 variant B = 9.8ns/turn | S5-A-2 delta=-325.8ns/call | S5-A-3 = 21.6ns
anchor: 19.2us -> ~96us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价结论逐位一致，全部计时方向稳定（S5-A-2 两次均为负），
裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-A-1 | turn.ts ownershipEscape 与 prescore scopeOutcome escaped 扫描跨函数去重 | 廉价变体不等价（路径越权 ≠ 沙箱逃逸发散反例）；可靠变体需公开 PrescoreResult 变更 + 9.8–10ns/turn 亚噪声 |
| S5-A-2 | types.ts hashAssessment/hashSummary JSON.stringify 换手写定长序列化 | 等价（4000 fuzz 逐字节）但实测慢 11–15%（负优化，理论被仿真推翻第三例） |
| S5-A-3 | from-child PASSED 路径 check-coverage 死校验短路 | 引理成立但需平行 prescore 路径或公开旗标；扫描仅 21.6–21.7ns/子结果 |

重开条件：S5-A-1 需先出现区分 escaped 与路径越权的公开维度事实且 turn
频次增长 ≥2 个量级；S5-A-2 需先推翻本报告基准（如 V8 序列化内建路径退化）；
S5-A-3 若 checks 集合达数千级且 PASSED 路径成为热点可凭引理重开。整片预算
支配论证（§1）的重开条件不变：run 事件表或每 turn 集合规模增长 ≥2–3 个
量级，届时 S1-A-1、S2-A-1、S2-A-3、S4-A-1 可凭既有等价性证据优先重开。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa55a01`–`0xa55a03`。

```ts
/**
 * R5-A deterministic equivalence + benchmark simulation (fifth pass).
 * Adjudicates fresh candidates S5-A-1 .. S5-A-3 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply},
 * and re-verifies the R4-A whole-slice budget anchor (~60 us/run).
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A
 * (S1-A-1..9), R2-A (S2-A-1..6), R3-A (S3-A-1..4) or R4-A (S4-A-1..3).
 * Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa55a01 .. 0xa55a04.
 */
import { performance } from "node:perf_hooks";
import { hash32 } from "/workspace/src/domain/hash.js";
import { computePrescore, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import {
  prescoreInputFromObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { applyChildThreeLine } from "/workspace/src/run/child-tracking.js";
import type { Event } from "/workspace/src/run/events.js";
import type { EventId } from "/workspace/src/domain/ids.js";
import type {
  AssessmentDimension,
  DimensionScore,
  PrescoreDimensionId,
  ToolSituation,
  TrackingAssessment
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
 * S5-A-1: turn.ts ownershipEscape duplicates the escaped scan that
 * computePrescore's scopeOutcome already performs on the SAME array
 * (from-child aliases window.toolSituations === prescoreInput.toolSituations).
 * Variant A (reuse the scope-safety dimension as ownershipEscape) is
 * NOT equivalent: scope-safety FAIL also fires on write-path ownership
 * escapes without any tool escape. Variant B (expose an `escaped` fact
 * on PrescoreResult) is equivalent by construction but is a public
 * type change (S3-A-3 rejection class). Adjudicate with a
 * counterexample for A and a duplicate-cost measurement for B.
 * ============================================================ */
{
  // Variant A counterexample: writePaths escape ownership, no tool escaped.
  const input: PrescoreInput = {
    claims: ["tests passed"],
    toolSituations: [
      {
        name: "write",
        exitCode: 0,
        wrote: true,
        escaped: false,
        artifactIds: [],
        evidenceIds: ["evd_1"],
        hashes: []
      }
    ],
    writePaths: ["src/outside.ts"],
    ownedPaths: [],
    requiredChecks: [],
    completedChecks: [],
    constraints: [],
    retainedConstraintIds: [],
    progressed: true,
    stalledTurns: 0,
    independentEvidence: true
  };
  const prescore = computePrescore(input);
  const scopeDim = prescore.dimensions.find((d) => d.id === "scope-safety") as DimensionScore;
  const currentOwnershipEscape = input.toolSituations.some((tool) => tool.escaped);
  const variantAOwnershipEscape = scopeDim.outcome === "FAIL";
  check(
    "S5-A-1 variant A counterexample must diverge",
    currentOwnershipEscape === false && variantAOwnershipEscape === true
  );
  console.log(
    `S5-A-1 variant A counterexample: scope-safety=${scopeDim.outcome} but toolSituations.some(escaped)=${currentOwnershipEscape} -> reuse NOT equivalent (would fire hard code "ownership-escape" on a pure path-ownership escape)`
  );

  // Variant B duplicate-cost measurement at production from-child scale
  // (<=1 tool situation, escaped hard-coded false by prescoreInputFromObservation).
  const rng = mulberry32(0xa55a01);
  for (let trial = 0; trial < 2000; trial += 1) {
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["implementer", "tester", "scout"]),
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      verification: {
        kind: rng() < 0.5 ? ("PASSED" as const) : ("FAILED" as const),
        evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : []
      },
      requiredChecks: rng() < 0.4 ? ["test"] : [],
      constraints: []
    };
    const pi = prescoreInputFromObservation(observation);
    // production fact: escaped is hard-coded false on this path
    check(
      "S5-A-1 production lemma: from-child tool situations never escape",
      pi.toolSituations.every((tool) => !tool.escaped)
    );
  }
  const oneTool: ToolSituation[] = [
    { name: "task-result", exitCode: 0, wrote: true, escaped: false, artifactIds: ["art_1"], evidenceIds: ["evd_1"], hashes: [] }
  ];
  const scanCost = bench(() => void oneTool.some((tool) => tool.escaped), 200000);
  console.log(
    `S5-A-1 variant B duplicate scan cost at from-child scale (1 tool): ${(scanCost * 1e6).toFixed(1)}ns/turn (x~5 turns/run); dedup requires a public PrescoreResult field`
  );
}

/* ============================================================
 * S5-A-2: types.ts hashAssessment hand-rolled fixed-shape serializer
 * replacing JSON.stringify. The payload has a frozen key order and
 * mostly enum-safe strings; only episodeId/runId/turnId need escaping.
 * Candidate must produce the byte-identical payload string.
 * ============================================================ */
{
  const cmp = (left: { id: string }, right: { id: string }): number => left.id.localeCompare(right.id);

  function candidateHashAssessment(assessment: TrackingAssessment): string {
    const dims = assessment.dimensions
      .map((dimension) => ({ id: dimension.id, verdict: dimension.verdict }))
      .sort(cmp);
    let dimsStr = "";
    for (let i = 0; i < dims.length; i += 1) {
      const d = dims[i] as { id: string; verdict: string };
      dimsStr += `${i === 0 ? "" : ","}{"id":"${d.id}","verdict":"${d.verdict}"}`;
    }
    const codes = [...assessment.gate.codes].sort();
    let codesStr = "";
    for (let i = 0; i < codes.length; i += 1) {
      codesStr += `${i === 0 ? "" : ","}"${codes[i]}"`;
    }
    const payload =
      `{"coverage":${String(assessment.coverage)}` +
      `,"dimensions":[${dimsStr}]` +
      `,"episodeId":${JSON.stringify(assessment.episodeId)}` +
      `,"gate":{"codes":[${codesStr}],"kind":"${assessment.gate.kind}"}` +
      `,"prescore":${String(assessment.prescore)}` +
      `,"quality":${String(assessment.quality)}` +
      `,"runId":${JSON.stringify(assessment.runId)}` +
      `,"score":${String(assessment.score)}` +
      `,"turnId":${JSON.stringify(assessment.turnId)}}`;
    return hash32(payload);
  }

  const rng = mulberry32(0xa55a02);
  const dimIds: readonly PrescoreDimensionId[] = [
    "evidence-consistency",
    "scope-safety",
    "check-coverage",
    "constraint-retention",
    "progress-vs-stall",
    "narrative-coherence"
  ];
  const nastyIds = [
    "ep_1",
    'ep_"quoted"',
    "ep_back\\slash",
    "ep_\u2028line",
    "ep_中文\t tab",
    "ep_\u0007bell"
  ];
  const weirdNumbers = [0, 1, 0.1 + 0.2, 1e-7, 0.5, Number((0.1234).toFixed(4)), 1 / 3];
  let last: TrackingAssessment | undefined;
  for (let trial = 0; trial < 4000; trial += 1) {
    const dims: AssessmentDimension[] = dimIds
      .filter(() => rng() < 0.9)
      .map((id) => {
        const verdict = pick(rng, ["PASS", "FAIL", "UNOBSERVED", "NOT_APPLICABLE"] as const);
        return verdict === "FAIL" ? { id, verdict, evidenceRefs: ["evd_1"] } : { id, verdict };
      });
    const num = (): number => (rng() < 0.3 ? pick(rng, weirdNumbers) : Number(rng().toFixed(4)));
    const assessment: TrackingAssessment = {
      schemaVersion: 1,
      episodeId: rng() < 0.2 ? pick(rng, nastyIds) : `ep_${trial}`,
      runId: rng() < 0.2 ? pick(rng, nastyIds) : "run_x",
      turnId: rng() < 0.2 ? pick(rng, nastyIds) : `t_${trial}`,
      prescore: num(),
      quality: num(),
      coverage: num(),
      human: { kind: "unobserved" },
      score: num(),
      dimensions: dims,
      gate: {
        kind: pick(rng, ["hard", "soft", "none"] as const),
        codes:
          rng() < 0.5
            ? rng() < 0.5
              ? ["soft-threshold"]
              : ["user-reject-stop", "deterministic-fail", "ownership-escape"]
            : [],
        wakeAnalysis: rng() < 0.5,
        expandDetail: rng() < 0.5,
        askUser: rng() < 0.2,
        openMinors: []
      },
      evidenceRefs: ["evd_1"]
    };
    check(
      "S5-A-2 hash byte-equality",
      hashAssessment(assessment) === candidateHashAssessment(assessment),
      JSON.stringify(assessment)
    );
    last = assessment;
  }
  const cur = bench(() => hashAssessment(last as TrackingAssessment), 30000);
  const cand = bench(() => candidateHashAssessment(last as TrackingAssessment), 30000);
  console.log(
    `S5-A-2 bench: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/call (x~10 hash calls/run => ${(((cur - cand) * 10) * 1e6).toFixed(0)}ns/run)`
  );
}

/* ============================================================
 * S5-A-3: from-child PASSED-path check-coverage short circuit.
 * prescoreInputFromObservation with verification.kind === "PASSED"
 * sets completedChecks = [...requiredChecks], so coverageOutcome's
 * every/includes scan is trivially true:
 *   coverage dim === requiredChecks.length === 0 ? NOT_APPLICABLE : PASS.
 * Exploiting it needs a call-site-specialized prescore (parallel path,
 * X1-2 class) or a computePrescore flag (public change). Prove the
 * lemma, measure the scan.
 * ============================================================ */
{
  const rng = mulberry32(0xa55a03);
  for (let trial = 0; trial < 3000; trial += 1) {
    const nChecks = Math.floor(rng() * 6);
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["tester", "implementer", "worker"]),
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      verification: { kind: "PASSED", evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : [] },
      requiredChecks: Array.from({ length: nChecks }, (_, i) => `chk_${i}`),
      constraints: []
    };
    const pi = prescoreInputFromObservation(observation);
    const prescore = computePrescore(pi);
    const coverageDim = prescore.dimensions.find((d) => d.id === "check-coverage") as DimensionScore;
    const expected = pi.requiredChecks.length === 0 ? "NOT_APPLICABLE" : "PASS";
    check("S5-A-3 lemma (PASSED path coverage is length-determined)", coverageDim.outcome === expected);
  }
  const required = ["chk_0", "chk_1", "chk_2"];
  const completed = [...required];
  const scan = bench(
    () => void (required.length === 0 || required.every((c) => completed.includes(c))),
    200000
  );
  console.log(
    `S5-A-3 bench: the trivially-true every/includes scan at real scale (3 checks) = ${(scan * 1e6).toFixed(1)}ns/child result (x~5/run); exploiting it needs a parallel prescore path`
  );
}

/* ============================================================
 * Budget anchor re-verification (R3-A section 3 / R4-A section 1):
 * applyChildThreeLine end-to-end at real scale (41-event table,
 * apply path) x ~5 gates/run bounds ANY optimization in this slice.
 * ============================================================ */
{
  const NOW_ISO = "2026-08-24T00:00:00.000Z";
  let idCounter = 0;
  const nextId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
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
  events.push({
    id: nextId(),
    schemaVersion: 1,
    occurredAt: NOW_ISO as Event["occurredAt"],
    runId,
    type: "RUN_ATTACHED",
    actor: "supervisor",
    payload: { episodeId: "ep_bench", runId, attachedAt: NOW_ISO }
  } as unknown as Event);
  for (let i = 0; i < 39; i += 1) {
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
    `anchor: one applyChildThreeLine over 41-event table = ${(one * 1e3).toFixed(1)}us -> ~5 gates/run => whole-slice per-run budget ~${(one * 5 * 1e3).toFixed(0)}us (campaign landing line: tens-hundreds of ms or complexity-class drop)`
  );
}

void UNOBSERVED;

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

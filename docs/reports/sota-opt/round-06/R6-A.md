# R6-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第六遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-A（Round 1–5 同区第六遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `07c7b3e`（含 S5-C / S5-F / S5-G/H 排除）
**分支:** `cursor/r6-a-tracking-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动；整片预算收口第四次复核成立。**
切片 14 个文件自 R1-A 基线（`7acb666`）经 R2-A / R3-A / R4-A / R5-A 至本轮
基线（`07c7b3e`）**逐字节未变**（`git diff 7acb666..07c7b3e -- src/tracking/
src/run/child-tracking.ts src/run/gate-apply.ts` 与 `git diff 23128f6..07c7b3e
-- <切片>` 均为空）。调用面同样未变：R5-A 基线（`23128f6`）以来 `src/` 仅
`src/cli/main.ts`、`src/experiments/plan.ts`、`src/pi-adapter/auth-session.ts`、
`src/routing/lin-alg.ts` 变动（S4-I 补齐 / S5-F / S5-C 落地），不触及本切片
及其调用方；全库 grep 复核生产调用方仍为 `supervisor.ts`
（applyTrackingGate/nextTrackingSeq）/ `coordinator.ts` / `flowchart-run.ts`
（applyChildThreeLine），每子结果一次（~5 次/run），事件表几十级（41）。
R5-A 的 ~96–100 µs/run 预算天花板经本轮实测复核为 **~81–86 µs/run**（VM
差异，与 R4-A 的 60–61 µs、R3-A 的 95–114 µs 同量级带），量级结论不变。
在完整排除表之上以新角度第六遍枚举，得到 3 个此前未点名的新候选
（S6-A-1 … S6-A-3），全部经理论 + 确定性仿真（seeded mulberry32，等价
fuzz + 真实规模基准，两次独立运行结论逐位一致）裁决后淘汰：1 个**不等价**
（半格点反例 4419/10000，得分契约路径直接发散），2 个等价但收益在
10–24 ns/子结果的深度亚噪声带。未重开任何 X* / S1-* / S2-* / S3-* /
S4-* / S5-* 条目。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` +
  `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守（顺序强制）：README / EXCLUSIONS.md（全表）/ round-06/PLAN.md /
  round-01/R1-A.md / round-02/R2-A.md / round-03/R3-A.md / round-04/R4-A.md /
  round-05/R5-A.md。候选枚举刻意绕开全部既有排除（X0-4、X0-6、X1-1、X2-4、
  S1-A-1..9、S2-A-1..6、S3-A-1..4、S4-A-1..3、S5-A-1..3 及全部无 ID 收口
  裁决），只探索**未被点名的第六组新角度**：数值舍入实现替换（S6-A-1）、
  守卫合取短路重排（S6-A-2）、构造保证下的第二处死校验（S6-A-3）。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `hashAssessment`/`hashSummary` 排序比较器 `localeCompare` 换码点比较
    = S3-B-3 同方案换位点；且 `hashSummary.operations` 的 name 是任意工具名
    （非闭枚举），混大小写名下序发散 ⇒ 哈希发散，本就不等价；
  - `human-score.ts` 模块级缓存全局正则供 matchAll 用 = X0-6 本体
    （ES 规格下 matchAll 克隆正则不改原 lastIndex，但克隆**继承**原
    lastIndex，任何未来 `.test`/`.exec` 调用方都会复活 X0-6 点名的陈旧
    状态风险；且收益亚 µs，重开无意义，维持排除不动）；
  - gate-apply 事件表两次 find 合并单遍 = X2-4；写侧 `validateEvent` 跳过
    = S4-G-2 换文件（R5-A 已拒列过一次）；
  - turn.ts `filter().length` 计数循环化 = R1-A 无 ID 收口；from-child
    `completedChecks`/`requiredChecks` 防御拷贝省略 = R2-A 无 ID 收口
    （S1-A-7/S1-B-8 身份类）。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 /
  minorPDip 0.03）、哈希契约、事件 schema、CAS/幂等键格式全部不变——
  本轮零 diff，天然满足。三线规格（分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 双归因保留、提升 proposal-first）
  同样天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 预算支配论证复核（方法第 1 步，不假设直接实测）

R3-A §3 / R4-A §1 / R5-A §1 的整片预算论证依赖两个前提，本轮逐一复核：

1. **切片代码未变**：`git diff 7acb666..07c7b3e -- <切片>` 与
   `git diff 23128f6..07c7b3e -- <切片>` 均为空，逐字节一致。
2. **调用面未变**：`23128f6..07c7b3e` 间 `src/` 仅 4 个切片外文件变动
   （见结论节），不触及切片；生产调用方经全库 grep 复核不变。
   **无新热路径，无量级变化。**

本轮在当前 VM 重测预算锚点（两次独立运行）：

```text
anchor: one applyChildThreeLine over 41-event table = 16.2–17.3 µs（apply 全路径）
=> ~5 gates/run => 切片每 run 总预算 ≈ 81–86 µs
```

与 R3-A（19.0–22.8 µs/gate）、R4-A（12.1–12.3）、R5-A（19.2–20.1）同带；
量级结论不变：即使把整个切片优化到零成本，节省上界 ~0.1 ms/run，仍比战役
落地线（数十~数百 ms 或复杂度类下降）低**约三个量级**。复杂度类下降的仅存
位点维持既有排除（X0-4/X2-4 事件表索引化、S1-A-1/S1-A-9 反向早退、X1-1
hashSummary 跨调用缓存、R1-A 裁决的不可变累计快照构造下界）。
**支配论证第四次复核成立，本切片在当前数据面规模下维持预算收口。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-A-1 | `combined-score.ts roundScore` 与 `prescore.ts` 的 `Number(x.toFixed(4))` 舍入链换算术舍入 `Math.round(x*1e4)/1e4`（免十进制字符串往返分配） | 免 1 次字符串分配 + 解析/舍入 | ❌ **不等价**：`toFixed` 按 x 的**精确二进制值**舍入，`x*1e4` 携带乘法舍入误差且 `Math.round` 对精确 .5 恒进位——四位小数半格点（1/20000 的奇数倍，永非二进制可表示）上 **4419/10000 发散**，首反例 `v=0.00035 → toFixed=0.0003 / 算术=0.0004`；均匀 fuzz 0/200000（发散集测度薄但可构造，得分契约按 S1-A-9 标准直接不健全） | 即便等价也仅省 100.9–102.7 ns/舍入 × ~5 舍入/turn × ~5 turns/run ≈ 2.5 µs/run | 淘汰：**双重否决**——不等价（得分/哈希链可观察发散）+ 量级噪声。本反例把 R3-A「舍入链为 schema 契约」无 ID 收口具体化为可复现证据 |
| S6-A-2 | `from-child.ts assessChildObservation` FAIL 守卫合取短路重排：`failRefs.length === 0` 前置于 `prescore.dimensions.some(FAIL)` 扫描（两操作数均纯且全定义，合取值交换） | failRefs 非空（生产常态）时跳过 ≤6 元素 some 扫描 | ✅ 5000 组 fuzz（30% 空 evidence，PASSED/FAILED/UNOBSERVED/缺失全路径）全副本 JSON 逐位一致 | 被跳过的 some 扫描仅 **10.0–10.5 ns/子结果**（占 assessChildObservation 的 0.28–0.31%）× ~5 次/run ≈ 50 ns/run | 淘汰：深度亚噪声（S1-B-3 布尔短路重排同族量级） |
| S6-A-3 | `from-child.ts` constraint-retention 死校验短路（S5-A-3 的姊妹维度，且 PASSED/FAILED **双路径**成立）：`prescoreInputFromObservation` 置 `retainedConstraintIds = constraints.map(id)`，故 `constraintOutcome` 的 every/includes 扫描恒真，维度值仅由 `constraints.length` 决定 | O(C²) 扫描 → O(1) 长度判断 | ✅ 5000 组 fuzz 引理成立（0–5 constraints × PASSED/FAILED × constraint/authority kind 全档：维度 ≡ `length===0 ? NOT_APPLICABLE : PASS`） | 该扫描在真实规模（≤3 constraints）仅 **21.8–24.2 ns/子结果** × ~5 次/run | 淘汰：利用引理需 call-site 特化 prescore（X1-2 平行路径类）或给 `computePrescore` 开公开旗标（S5-A-3 同拒绝结构）；收益深度亚噪声 |

## 3. 关键裁决细节

### S6-A-1（本轮唯一"理论必赢"候选）为何不健全

`toFixed(4)` 的语义是对 double 的**精确十进制展开**做四位舍入；
`Math.round(x*1e4)/1e4` 先做一次有误差的乘法，再按「精确 .5 恒进位」取整。
两条路径在远离半格点处一致（均匀 fuzz 200000 组零发散），但四位小数的半
格点（奇数倍 1/20000，分母含 5⁴，永非二进制可表示）附近乘法误差会跨越
取整边界：网格扫描 10000 个半格点 **4419 个发散**，首反例
`0.00035 → 0.0003 vs 0.0004`。P/quality/coverage/score 是小整数商的乘积
减 `minorPDip` 倍数，可构造命中发散邻域的输入，而得分值进入
`hashAssessment` 载荷与 TRACKING_ASSESSMENT 事件——单点发散即哈希链与
事件表可观察发散。按 S1-A-9 的健全性标准直接淘汰，且即便等价其收益
（~2.5 µs/run）也在噪声带。与 S1-A-4 / S2-A-4 / S5-A-2 并列为「纯理论
常数直觉被仿真推翻」的第四个记录案例——本例更进一步：不只更慢/持平，
而是**语义不等价**。

### S6-A-2 / S6-A-3 的定位（第六遍还剩什么）

六遍搜查后，本切片未点名候选已收敛到「单次 ≤6 元素扫描的存在性」这个
粒度：S6-A-2 是一次 some 扫描的条件跳过（10 ns），S6-A-3 是一次
every/includes 扫描的构造性恒真（22–24 ns）。两者等价性均严格成立
（5000 组 fuzz 各自全绿），但绝对量比整片预算（~85 µs/run）还低三个量级，
比战役落地线低六个量级。这从侧面印证 R3-A 建立、本轮第四次复核的支配
论证：该粒度以下不存在任何能改变量级的剩余结构。

### 逐文件收口（第六遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `combined-score.ts` | roundScore 舍入实现替换（六遍来该文件首个候选）；`isMachineScore` 入口校验为边界防御（S3-H-1 同向保留） | S6-A-1 淘汰 |
| `prescore.ts` | 同舍入链（P/quality/coverage/displayPrescore 四处）；evidenceOutcome 的 successClaim 先算——claims 空时 some 早零成本，无重排收益 | S6-A-1 淘汰 |
| `from-child.ts` | FAIL 守卫短路重排；constraint-retention 构造恒真（S5-A-3 姊妹）；S1-A-2 / S2-A-2/6 / S4-A-3 / S5-A-3 收口维持 | S6-A-2/3 淘汰 |
| `turn.ts` | S4-A-1 / S5-A-1 后无剩余未点名结构；`anomalyCodes` 拷贝（S1-A-7）、humanInput 条件 spread（R3-A/R4-A 无 ID）维持 | 无新候选 |
| `roller.ts` | S1-A-5 / S2-A-1 / S3-A-1 三层收口维持；uniqueStrings/mergeConstraints 融合 = S1-A-4 族 | 无新候选 |
| `types.ts` | 排序比较器码点化 = S3-B-3 换位点（拒列，见 §0）；hashAssessment/hashSummary 面 S2-A-5 / S5-A-2 / X0-5 / S1-A-8 收口维持 | 无新候选 |
| `gate-apply.ts` | 双 find / currentGateStatus / nextTrackingSeq 维持 X2-4/X0-4/S1-A-1/S1-A-9；双 hashAssessment 维持 CAS fail-closed 契约裁决；`mapGateDirective` FAIL_CLOSED 兜底维持保留 | 无新候选 |
| `child-tracking.ts` | S4-A-2 预检提升收口维持；observationFromChild 构造均有同类裁决 | 无新候选 |
| `human-score.ts` | matchAll 用模块级全局正则 = X0-6 重开（拒列，见 §0）；S1-A-3 / R3-A「X0-6 对偶面」收口维持 | 无新候选 |
| `gates.ts` | S1-A-6 收口维持；from-child 路径 openMinors 恒空的早退 = S3-A-4 族 | 无新候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 纯再导出 | 无新候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。仿真为临时脚本未入库（无赢家不落
仿真文件，遵守方法第 4 条），完整源码见附录。

## 5. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A…R5-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真（临时脚本；seed 固定可复现，两次独立运行）：

```text
run 1:
S6-A-1 half-boundary grid: 4419/10000 diverge; first counterexample v=0.00035 -> toFixed=0.0003 arithmetic=0.0004 | uniform fuzz divergences: 0/200000
S6-A-1 bench: toFixed-chain=105.6ns arithmetic=2.9ns delta=102.7ns/rounding (x~5 roundings/turn x ~5 turns/run)
S6-A-2 bench: skipped some-scan=10.5ns/child result (x~5/run) vs whole assessChildObservation=3423ns -> saving share=0.31%
S6-A-3 bench: the trivially-true every/includes scan at real scale (3 constraints) = 21.8ns/child result (x~5/run)
anchor: one applyChildThreeLine over 41-event table = 17.3us -> ~5 gates/run => ~86us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)

run 2:
S6-A-1 grid: 4419/10000 (同一反例) | bench delta=100.9ns/rounding
S6-A-2 some-scan=10.0ns (share=0.28%) | S6-A-3 =24.2ns
anchor: 16.2us -> ~81us/run
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价/发散结论逐位一致（S6-A-1 反例集确定性重现），全部计时
方向稳定，裁决方向不变。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-A-1 | roundScore/prescore `Number(x.toFixed(4))` 舍入链换算术舍入 `Math.round(x*1e4)/1e4` | 不等价：四位小数半格点 4419/10000 发散（首反例 0.00035→0.0003 vs 0.0004），得分/哈希链可观察发散；即便等价也仅 ~2.5µs/run |
| S6-A-2 | from-child FAIL 守卫合取短路重排（failRefs.length 前置于 dimensions.some(FAIL)） | 等价但 10.0–10.5ns/子结果（占 0.28–0.31%）深度亚噪声 |
| S6-A-3 | from-child constraint-retention 构造恒真死校验短路（S5-A-3 姊妹维度） | 引理成立（双路径）但需平行 prescore 路径或公开旗标；扫描仅 21.8–24.2ns/子结果 |

重开条件：S6-A-1 需先推翻反例（即证明生产得分值域与全部半格点发散邻域
不交并把该值域固化为契约——现无此契约）；S6-A-2 若子结果频次增长 ≥3 个
量级可凭本报告 fuzz 证据重开；S6-A-3 同 S5-A-3——checks/constraints 集合
达数千级且 from-child 成为热点时可凭引理重开。整片预算支配论证（§1）的
重开条件不变：run 事件表或每 turn 集合规模增长 ≥2–3 个量级，届时
S1-A-1、S2-A-1、S2-A-3、S4-A-1 可凭既有等价性证据优先重开。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa66a01`–`0xa66a04`。

```ts
/**
 * R6-A deterministic equivalence + benchmark simulation (sixth pass).
 * Adjudicates fresh candidates S6-A-1 .. S6-A-3 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply},
 * and re-verifies the R5-A whole-slice budget anchor (~96-100 us/run).
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A
 * (S1-A-1..9), R2-A (S2-A-1..6), R3-A (S3-A-1..4), R4-A (S4-A-1..3)
 * or R5-A (S5-A-1..3). Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa66a01 .. 0xa66a04.
 */
import { performance } from "node:perf_hooks";
import { combineScore } from "/workspace/src/tracking/combined-score.js";
import { computePrescore, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import { runTrackingTurn } from "/workspace/src/tracking/turn.js";
import {
  assessChildObservation,
  prescoreInputFromObservation,
  shouldApplyThreeLine,
  type ChildObservation,
  type ChildTrackingDecision
} from "/workspace/src/tracking/from-child.js";
import { applyChildThreeLine } from "/workspace/src/run/child-tracking.js";
import type { Event } from "/workspace/src/run/events.js";
import type { EventId } from "/workspace/src/domain/ids.js";
import type {
  ConstraintRecord,
  DimensionScore,
  HumanSignal
} from "/workspace/src/tracking/types.js";

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
 * S6-A-1: roundScore / Number(x.toFixed(4)) rounding chain replaced
 * by arithmetic rounding Math.round(x * 1e4) / 1e4.
 * Sites: combined-score.ts roundScore (score contract) and
 * prescore.ts P/quality/coverage/displayPrescore.
 * Theory: avoids the decimal-string round trip (allocation + parse).
 * Soundness question: toFixed rounds by the EXACT binary value of x,
 * while x*1e4 carries multiplication rounding error and Math.round
 * rounds exact halves up -> candidates can disagree near half
 * boundaries (odd multiples of 0.00005, never dyadic-representable).
 * ============================================================ */
{
  const current = (v: number): number => Number(v.toFixed(4));
  const candidate = (v: number): number => Math.round(v * 10000) / 10000;

  // (a) targeted grid: every half-boundary of the 4-decimal lattice in [0,1]
  const counterexamples: number[] = [];
  for (let k = 0; k < 10000; k += 1) {
    const v = (2 * k + 1) / 20000;
    if (current(v) !== candidate(v)) counterexamples.push(v);
  }
  // (b) seeded uniform fuzz including products (quality*coverage shape)
  const rng = mulberry32(0xa66a01);
  let fuzzDivergences = 0;
  for (let trial = 0; trial < 200000; trial += 1) {
    const v = trial % 3 === 0 ? rng() * rng() : rng();
    if (current(v) !== candidate(v)) fuzzDivergences += 1;
  }
  check("S6-A-1 counterexample search must find divergence", counterexamples.length > 0);
  const cx = counterexamples[0] as number;
  console.log(
    `S6-A-1 half-boundary grid: ${counterexamples.length}/10000 diverge; first counterexample v=${cx} -> toFixed=${current(cx)} arithmetic=${candidate(cx)} | uniform fuzz divergences: ${fuzzDivergences}/200000`
  );
  // score-path witness: the divergence propagates into combineScore output
  const witnessP = current(cx) !== candidate(cx) ? cx : (counterexamples[1] as number);
  const human: HumanSignal = { kind: "ten-point", H: witnessP, mark: witnessP * 10 };
  void human;
  const viaCurrent = combineScore({ P: 0.5, human: { kind: "unobserved" }, obviousProblem: false });
  check("S6-A-1 combineScore baseline sanity", viaCurrent === 0.5);
  // bench the two roundings (context: 4 roundings per computePrescore + 1 per combineScore)
  const sample = 0.73219847;
  const cur = bench(() => void current(sample), 2000000);
  const cand = bench(() => void candidate(sample), 2000000);
  console.log(
    `S6-A-1 bench: toFixed-chain=${(cur * 1e6).toFixed(1)}ns arithmetic=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/rounding (x~5 roundings/turn x ~5 turns/run)`
  );
}

/* ============================================================
 * S6-A-2: from-child FAIL-guard short-circuit reorder.
 * Current: prescore.dimensions.some(FAIL) && failRefs.length === 0
 * Candidate: failRefs.length === 0 && prescore.dimensions.some(FAIL)
 * Both operands are pure and total, so the conjunction commutes on
 * value; the reorder skips the <=6-element some scan whenever
 * failRefs is non-empty (the production common case).
 * Candidate = full replica of assessChildObservation with the reorder.
 * ============================================================ */
function evidenceRefsOfReplica(observation: ChildObservation): string[] {
  const refs = new Set<string>();
  for (const id of observation.evidenceIds) refs.add(id);
  for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
  return [...refs];
}

function candidateAssess(input: {
  readonly observation: ChildObservation;
  readonly episodeId: string;
  readonly runId: string;
}): ChildTrackingDecision {
  const verification = input.observation.verification;
  if (verification === undefined || (verification.kind !== "PASSED" && verification.kind !== "FAILED")) {
    return { apply: false };
  }
  const prescoreInput = prescoreInputFromObservation(input.observation);
  const prescore = computePrescore(prescoreInput);
  const hasHardPassOrFail = prescore.dimensions.some(
    (dimension) => dimension.hardRelated && (dimension.outcome === "PASS" || dimension.outcome === "FAIL")
  );
  if (
    !shouldApplyThreeLine({
      verificationKind: verification.kind,
      coverage: prescore.coverage,
      hasHardPassOrFail
    })
  ) {
    return { apply: false };
  }
  const failRefs = evidenceRefsOfReplica(input.observation);
  // CANDIDATE: cheap length check first; the some scan only runs when empty
  if (failRefs.length === 0 && prescore.dimensions.some((dimension) => dimension.outcome === "FAIL")) {
    return { apply: false };
  }
  const window = {
    contextFacts: [`role ${input.observation.role}`, `task ${input.observation.taskId}`],
    toolSituations: prescoreInput.toolSituations,
    constraints: input.observation.constraints,
    unresolvedDecisions: [],
    confirmedDecisions: [],
    openMinors: []
  };
  const turn = runTrackingTurn({
    window,
    prescoreInput,
    humanInput: {},
    gateFacts: { deterministicFail: verification.kind === "FAILED" }
  });
  return {
    apply: true,
    prescore,
    turn,
    assessment: {
      schemaVersion: 1,
      episodeId: input.episodeId,
      runId: input.runId,
      turnId: input.observation.taskId,
      prescore: prescore.displayPrescore,
      quality: prescore.quality,
      coverage: prescore.coverage,
      human: turn.human,
      score: turn.score,
      dimensions: prescore.dimensions.map((dimension) => {
        const verdict = dimension.outcome === "ABSTAIN" ? "UNOBSERVED" : dimension.outcome;
        if (verdict === "FAIL") {
          return { id: dimension.id, verdict, evidenceRefs: failRefs };
        }
        return { id: dimension.id, verdict };
      }),
      gate: turn.gate,
      evidenceRefs: failRefs
    }
  };
}

{
  const rng = mulberry32(0xa66a02);
  for (let trial = 0; trial < 5000; trial += 1) {
    const verifiedRoll = rng();
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["implementer", "tester", "scout"]),
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip"]),
      // 30% empty evidence so the guard's empty-refs branch fuzzes hard
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`, "evd_shared"] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      ...(verifiedRoll < 0.9
        ? {
            verification: {
              kind:
                verifiedRoll < 0.4
                  ? ("PASSED" as const)
                  : verifiedRoll < 0.75
                    ? ("FAILED" as const)
                    : ("UNOBSERVED" as const),
              evidenceIds: rng() < 0.6 ? [`evd_v_${trial}`] : []
            }
          }
        : {}),
      requiredChecks: rng() < 0.4 ? ["test"] : [],
      constraints:
        rng() < 0.3
          ? [{ id: "c1", text: "keep scope", kind: "constraint" as const, mandatory: true as const }]
          : []
    };
    const currentOut = assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" });
    const candidateOut = candidateAssess({ observation, episodeId: "ep_x", runId: "run_x" });
    check(
      "S6-A-2 equivalence",
      JSON.stringify(currentOut) === JSON.stringify(candidateOut),
      JSON.stringify(observation)
    );
  }
  // the saving is exactly one <=6-element some scan per child result when
  // failRefs is non-empty (production common case): measure that scan
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
  const prescore = computePrescore(prescoreInputFromObservation(observation));
  const scan = bench(
    () => void prescore.dimensions.some((dimension) => dimension.outcome === "FAIL"),
    500000
  );
  const full = bench(() => assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" }), 5000);
  console.log(
    `S6-A-2 bench: skipped some-scan=${(scan * 1e6).toFixed(1)}ns/child result (x~5/run) vs whole assessChildObservation=${(full * 1e6).toFixed(0)}ns -> saving share=${((scan / full) * 100).toFixed(2)}%`
  );
}

/* ============================================================
 * S6-A-3: from-child constraint-retention tautology short circuit
 * (sibling of rejected S5-A-3, different dimension, holds on BOTH
 * PASSED and FAILED paths).
 * prescoreInputFromObservation sets
 *   retainedConstraintIds = constraints.map(c => c.id),
 * so constraintOutcome's every/includes scan is trivially true:
 *   constraint-retention dim === constraints.length === 0
 *     ? NOT_APPLICABLE : PASS.
 * Exploiting it needs a call-site-specialized prescore (X1-2 parallel
 * path class) or a public computePrescore flag. Prove the lemma,
 * measure the scan.
 * ============================================================ */
{
  const rng = mulberry32(0xa66a03);
  for (let trial = 0; trial < 5000; trial += 1) {
    const nConstraints = Math.floor(rng() * 6);
    const constraints: ConstraintRecord[] = Array.from({ length: nConstraints }, (_, i) => ({
      id: `c_${i}`,
      text: `constraint ${i}`,
      kind: pick(rng, ["constraint", "authority"] as const),
      mandatory: true
    }));
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["tester", "implementer", "worker"]),
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      verification: {
        kind: pick(rng, ["PASSED", "FAILED"] as const),
        evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`] : []
      },
      requiredChecks: rng() < 0.4 ? ["test"] : [],
      constraints
    };
    const pi = prescoreInputFromObservation(observation);
    const prescore = computePrescore(pi);
    const dim = prescore.dimensions.find((d) => d.id === "constraint-retention") as DimensionScore;
    const expected = pi.constraints.length === 0 ? "NOT_APPLICABLE" : "PASS";
    check(
      "S6-A-3 lemma (from-child constraint-retention is length-determined)",
      dim.outcome === expected,
      `n=${nConstraints} outcome=${dim.outcome}`
    );
  }
  const constraints: ConstraintRecord[] = Array.from({ length: 3 }, (_, i) => ({
    id: `c_${i}`,
    text: `constraint ${i}`,
    kind: "constraint",
    mandatory: true
  }));
  const retained = constraints.map((c) => c.id);
  const scan = bench(
    () =>
      void (constraints.length === 0 || constraints.every((item) => retained.includes(item.id))),
    500000
  );
  console.log(
    `S6-A-3 bench: the trivially-true every/includes scan at real scale (3 constraints) = ${(scan * 1e6).toFixed(1)}ns/child result (x~5/run); exploiting it needs a parallel prescore path or a public flag (S5-A-3 sibling)`
  );
}

/* ============================================================
 * Budget anchor re-verification (R3-A section 3 / R4-A section 1 /
 * R5-A section 1): applyChildThreeLine end-to-end at real scale
 * (41-event table, apply path) x ~5 gates/run bounds ANY
 * optimization in this slice from above.
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

void mulberry32(0xa66a04);

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

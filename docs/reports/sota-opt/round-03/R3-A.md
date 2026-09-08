# R3-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 第三遍搜查报告

**战役:** 全库持久 SOTA 优化 Round 3 / R3-A（Round 1–2 同区第三遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `e3c0e8f`
**分支:** `cursor/r3-a-tracking-third-pass-41c0`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-A 基线（`7acb666`）
起经 R2-A（`384536e`）至本轮基线（`e3c0e8f`）**逐字节未变**（`git diff` 为空；
基线间仅 `src/routing/offline-logit.ts` 与 `src/cli/main.ts` 有变动，不触及切片
及其调用规模）。R1-A 的逐文件收口、S1-A-1..9 与 S2-A-1..6 排除全部继承有效。
本轮在完整排除表之上以新角度第三遍枚举，得到 4 个此前未点名的新候选
（S3-A-1 … S3-A-4），全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz +
真实规模基准，两次独立运行方向一致）裁决后淘汰：全部收益在 ns–亚 µs 噪声带，
其中 1 个实测在抖动内互有胜负、1 个生产路径不可达。未重开任何 X* / S1-* / S2-*
条目。另建立**整片预算支配论证**（见 §3），把本切片在当前数据面规模下整体收口。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守：README / EXCLUSIONS.md / round-03/PLAN.md / round-01/R1-A.md / round-02/R2-A.md。
  候选枚举刻意绕开全部既有排除（X0-4、X0-6、X2-4、S1-A-1..9、S2-A-1..6 等），
  只探索**未被点名的新角度**：死字段写入消除（S3-A-1）、冗余入参克隆条件跳过
  （S3-A-2）、跨函数重复谓词计算（S3-A-3）、空输入快路径（S3-A-4）。
- 公开 API、版本化阈值（softThreshold 0.55 / hardFailCap 0.3 / minorPDip 0.03）、
  哈希契约、事件 schema、CAS/幂等键格式全部不变——本轮零 diff，天然满足。
  三线规格（分析不改 in-flight、Tracking 无命令权、H/score 不写路由）同样天然满足。

## 1. 规模与门槛校准（继承 + 本轮补充）

R1-A 实测现实规模（41 事件/run、~5 次门控/run、每 turn 集合个位数、episode
十几 turn）与 R2-A 的落地/否决量级标尺（落地线 = 百 ms 级或复杂度类下降；
µs 级与亚 ms 级一律淘汰过）继承有效——代码与调用面均未变（生产调用方仍为
`supervisor.ts` / `coordinator.ts` / `flowchart-run.ts`，经 `applyChildThreeLine`
/ `applyTrackingGate` 到达）。本轮补充**整片预算锚点**：

```text
anchor: one applyChildThreeLine over 41-event table = 19.0–22.8 µs（apply 全路径，含
  observationFromChild + assessChildObservation + 双 hashAssessment + applyTrackingGate）
=> ~5 gates/run => 切片每 run 总预算 ≈ 95–114 µs
```

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-A-1 | `roller.ts` `mandatory` 数组元素死 `text` 字段移除（构造时写入 `text: item.text`，但 omissions 只读 key/kind、keptIds 只读 key，`text` 全程无人读取） | 免每 mandatory 项一个属性写入/turn | ✅ 200 条 episode 链（含 40% 紧 `maxItems` 截断路径与 `==maxItems` 边界）JSON 逐位一致 | 12-turn 链 delta **−0.46 ~ −1.41 µs（抖动内互有胜负）**；且被已否决 S2-A-1 严格支配（S2-A-1 跳过整套 mandatory 机器仅省 11.3–12.1 µs，本候选是其真子集） | 淘汰：支配论证 + 实测噪声 |
| S3-A-2 | `turn.ts` 当 `input.prescoreInput.lightMinorCount !== undefined` 时跳过 `{...input.prescoreInput, lightMinorCount}` 纯克隆，直传原对象（`computePrescore` 纯函数且不保留/暴露入参，值与身份均安全） | 免 1 次 ~14 字段对象克隆/turn | ✅ 4000 fuzz 克隆 vs 直传逐位一致 | 省 **21.7–27.2 ns/turn**；且**生产不可达**——`runTrackingTurn` 仓内唯一生产入口是 `assessChildObservation`，其 `prescoreInputFromObservation` 从不预置 `lightMinorCount`，快路径条件恒假 | 淘汰：生产零收益 + test-only ns 级 |
| S3-A-3 | `claims.some(isSuccessClaim)` 每 turn 双算去重（一次在 `computePrescore.evidenceOutcome` 内、一次在 `turn.ts derivedClaimedVerificationWithoutChecks`；S2-A-3 已点名该项「须保留重算」，本候选是把它也去掉） | 免 1 次正则 some/turn | ✅ 纯函数可重复性平凡成立 | 单次 **35.1–39.9 ns/turn** ×5 turns/run | 淘汰：去重需在公开 `PrescoreResult` 上暴露 successClaim（公开面变更，S1-F-6 同类）或跨函数耦合（S2-A-3 同类）；收益亚噪声 |
| S3-A-4 | `turn.ts mergeOpenMinors` 双空输入早退（生产 from-child 路径恒传两个空数组，现行仍分配 Map + Set + 输出数组） | 3 次分配 → 0 | ✅ 4000 fuzz（含重叠 id、跨长度组合）一致 | 空输入省 **31.8–38.9 ns/turn** ×5 turns/run ≈ 0.2 µs/run | 淘汰：亚噪声（S1-A-6/S2-A-6 同类位点量级） |

## 3. 整片预算支配论证（本轮新增收口）

本切片全部生产热路径经 `applyChildThreeLine`（~5 次/run）到达，单次 apply
全路径实测 19.0–22.8 µs（41 事件表，含全部哈希/校验/事件构造），**切片每 run
总预算 ≈ 95–114 µs**。战役落地线是百 ms 级或复杂度类下降（R2-A §1 标尺）：

- 即使把整个切片优化到零成本，节省上界也只有 ~0.1 ms/run，比落地线低
  **约三个量级**。
- 复杂度类下降的仅存位点均已被排除或裁决：事件表扫描索引化/合并 = X0-4/X2-4
  （接口破坏/已否决），反向早退 = S1-A-1/S1-A-9（噪声/不等价），不可变累计
  快照的每 turn O(累计量) = R1-A 裁决的构造下界，`hashSummary(previous)`
  跨调用缓存 = X1-1。

因此在当前数据面契约与规模下，**本切片不存在任何能达战役门槛的候选**，
这一支配论证对「尚未想到的微观常数改写」也成立。重开的唯一途径是规模前提
变化（run 事件表或每 turn 集合增长 ≥2–3 个量级），届时 S1-A-1、S2-A-1、
S2-A-3 可凭既有等价性证据优先重开。

## 4. 逐文件收口（第三遍新角度复查）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `roller.ts` | mandatory 死 `text` 字段（本轮唯一新结构性发现） | S3-A-1 淘汰 |
| `turn.ts` | prescoreInput 纯克隆条件跳过；mergeOpenMinors 空输入早退；`extractHumanScore` 入参对象构造与 failClosed 路径 `uniqueCodes` 均为同类 ns 级（不另立 ID） | S3-A-2/3/4 淘汰 |
| `prescore.ts` | `claims.some(isSuccessClaim)` 双算（与 turn.ts 联合裁决）；`Number(toFixed(4))` 舍入链为 schema 契约 | S3-A-3 淘汰 |
| `from-child.ts` | S1-A-2 / S2-A-2/6 收口维持；window 构造、`[...artifactIds]` 防御拷贝均已有同类裁决 | 无新候选 |
| `gate-apply.ts` | 两次 `find` 交换顺序**不等价**（双重复存在时返回值发散，GATE_TRANSITION 优先语义）；合并 = X2-4；`[...evidenceRefs]` 拷贝省略 = S1-A-7 身份类 | 无新候选 |
| `child-tracking.ts` | 5 次事件表扫描维持 X2-4/X0-4；`skipped` 常量提升 = 共享对象身份（X 类） | 无新候选 |
| `human-score.ts` | 正则每调用 `new RegExp` 重建 = X0-6 缓存排除的对偶面，维持不动；其余 S1-A-3 收口维持 | 无新候选 |
| `gates.ts` | S1-A-6 收口维持，无新结构 | 无新候选 |
| `types.ts` | `hashSummary` 各 spread 必要性（R2-A）维持；parse 面 = X0-5/S1-A-8 | 无新候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `combined-score.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 单表达式 / 纯再导出 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A/R2-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现）：

```text
S3-A-1 bench 12-turn episode: current=63.18us cand=63.64us delta=-0.46us (-0.7%)  [run2: -0.79us]
S3-A-2 bench: clone+compute=713.7ns direct=688.6ns delta=25.1ns/turn [production-unreachable]
S3-A-3 bench: one claims.some(isSuccessClaim)=35.1ns/turn duplicate (x~5 turns/run)
S3-A-4 bench empty inputs (production from-child path): current=61.5ns cand=22.6ns delta=38.9ns/turn
anchor: one applyChildThreeLine over 41-event table = 19.0–22.8us -> ~5 gates/run => ~95–114us/run
anchor: assessChildObservation alone = 5948–6266ns
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

两次独立运行等价结论逐位一致；全部计时方向稳定（S3-A-1 两次均在抖动带内），
裁决方向不变。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-A-1 | roller mandatory 数组死 `text` 字段移除 | 等价但实测抖动内（−0.5~−1.4µs/12-turn 链）；被已否决 S2-A-1 严格支配 |
| S3-A-2 | turn.ts lightMinorCount 已定义时跳过 prescoreInput 纯克隆 | 等价但生产不可达（from-child 从不预置），test-only 22–27ns |
| S3-A-3 | claims.some(isSuccessClaim) 跨 prescore/turn 双算去重 | 35–40ns/turn 亚噪声 + 需公开 PrescoreResult 变更或跨函数耦合 |
| S3-A-4 | mergeOpenMinors 双空输入早退 | 等价但 32–39ns/turn 亚噪声 |

重开条件：S3-A-1/4 若滚轮/回合数据面规模增长 ≥2 个量级可凭本报告等价性证据
重开；S3-A-2 需先出现预置 `lightMinorCount` 的生产调用方；S3-A-3 需先推翻
公开面变更的成本判断。整片支配论证（§3）的重开条件同 S1-A-1/S2-A-1。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa33a01`–`0xa33a06`。

```ts
/**
 * R3-A deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S3-A-1 .. S3-A-4 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply}.
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-A (S1-A-1..9)
 * or R2-A (S2-A-1..6). Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa33a01 .. 0xa33a06.
 */
import { performance } from "node:perf_hooks";
import { computePrescore, isSuccessClaim, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import { mergeOpenMinors, runTrackingTurn } from "/workspace/src/tracking/turn.js";
import {
  assessChildObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import { applyChildThreeLine } from "/workspace/src/run/child-tracking.js";
import type { Event } from "/workspace/src/run/events.js";
import type { EventId } from "/workspace/src/domain/ids.js";
import type {
  ConstraintRecord,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  TrackingOmission,
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
 * S3-A-1: roller.ts `mandatory` element dead `text` field removal.
 * The mandatory array elements carry `text: item.text`, but text is
 * never read: omissions use only key/kind, keptIds uses only key.
 * Candidate = full replica of rollSummary without the dead field.
 * Strictly dominated by rejected S2-A-1 (which removed the whole
 * mandatory machinery on the fast path); adjudicate with numbers.
 * ============================================================ */
function candidateRollNoText(input: Parameters<typeof rollSummary>[0]): { summary: RollingSummary } {
  const previous = input.window.previous;
  const byId = new Map<string, ConstraintRecord>();
  for (const item of previous?.constraints ?? []) byId.set(item.id, item);
  for (const item of input.window.constraints) byId.set(item.id, item);
  const mergedConstraints = [...byId.values()];
  const unresolvedQuestions = [
    ...new Set([...(previous?.unresolvedQuestions ?? []), ...input.window.unresolvedDecisions])
  ].filter((question) => !input.window.confirmedDecisions.includes(question));
  const confirmedDecisions = [
    ...new Set([...(previous?.confirmedDecisions ?? []), ...input.window.confirmedDecisions])
  ];

  // no `text` field: dead write removed
  const mandatory: Array<{ key: string; kind: TrackingOmission["kind"] }> = [
    ...mergedConstraints.map((item) => ({ key: item.id, kind: item.kind })),
    ...unresolvedQuestions.map((question) => ({ key: question, kind: "unresolved-decision" as const }))
  ];

  const omissions: TrackingOmission[] = [];
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
  const constraints: ConstraintRecord[] = mergedConstraints.filter((item) => keptIds.has(item.id));
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

{
  const rng = mulberry32(0xa33a01);
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
  // equivalence over 200 episode chains, ~40% with tight maxItems so the
  // truncation path (the only consumer of `mandatory`) fuzzes hard,
  // including the mandatory.length == maxItems boundary
  for (let episode = 0; episode < 200; episode += 1) {
    let prevCurrent: RollingSummary | undefined;
    let prevCandidate: RollingSummary | undefined;
    const turns = 2 + Math.floor(rng() * 14);
    const maxItems = rng() < 0.4 ? 1 + Math.floor(rng() * 10) : undefined;
    for (let turn = 0; turn < turns; turn += 1) {
      const windowCurrent = genWindow(prevCurrent, turn);
      const windowCandidate: TrackingWindow = { ...windowCurrent };
      if (prevCandidate !== undefined) {
        (windowCandidate as { previous?: RollingSummary }).previous = prevCandidate;
      } else {
        delete (windowCandidate as { previous?: unknown }).previous;
      }
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
      prevCandidate = candidateRollNoText({ window: windowCandidate, ...base }).summary;
      check(
        "S3-A-1 equivalence",
        JSON.stringify(prevCurrent) === JSON.stringify(prevCandidate),
        `episode ${episode} turn ${turn} maxItems=${maxItems}`
      );
    }
  }
  // benchmark: same 12-turn chain harness as R1-A/R2-A for comparability
  function chain(fn: (input: Parameters<typeof rollSummary>[0]) => { summary: RollingSummary }): void {
    const rng2 = mulberry32(0xa33a02);
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
  const cand = bench(() => chain(candidateRollNoText), 3000);
  console.log(
    `S3-A-1 bench 12-turn episode: current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us delta=${((cur - cand) * 1e3).toFixed(2)}us (${(((cur - cand) / cur) * 100).toFixed(1)}%) [S2-A-1 full-machinery skip saved 11.3-12.1us -> dominance bound]`
  );
}

/* ============================================================
 * S3-A-2: turn.ts skip the `{...input.prescoreInput, lightMinorCount}`
 * clone when input.prescoreInput.lightMinorCount is already defined
 * (then lightMinorCount === input.prescoreInput.lightMinorCount and
 * the spread is a pure clone). computePrescore is pure and does not
 * retain/expose its input, so passing the original is value- and
 * identity-safe. BUT: production reaches runTrackingTurn only via
 * assessChildObservation, whose prescoreInputFromObservation never
 * sets lightMinorCount -> fast path is production-unreachable.
 * ============================================================ */
{
  const rng = mulberry32(0xa33a03);
  for (let trial = 0; trial < 4000; trial += 1) {
    const checks = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `chk_${i}`);
    const constraints: ConstraintRecord[] = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
      id: `c_${i}`,
      text: `constraint ${i}`,
      kind: "constraint",
      mandatory: true
    }));
    const input: PrescoreInput = {
      claims: rng() < 0.5 ? [pick(rng, ["tests passed", "did work", "verified output", "wip"])] : [],
      toolSituations:
        rng() < 0.7
          ? [
              {
                name: "task-result",
                exitCode: rng() < 0.6 ? 0 : 1,
                wrote: false,
                escaped: rng() < 0.1,
                artifactIds: [],
                evidenceIds: ["evd_1"],
                hashes: []
              }
            ]
          : [],
      writePaths: [],
      ownedPaths: [],
      requiredChecks: checks,
      completedChecks: checks.filter(() => rng() < 0.7),
      constraints,
      retainedConstraintIds: constraints.map((c) => c.id),
      progressed: rng() < 0.15 ? UNOBSERVED : rng() < 0.8,
      stalledTurns: Math.floor(rng() * 4),
      independentEvidence: rng() < 0.5,
      lightMinorCount: Math.floor(rng() * 4) // defined -> fast-path condition holds
    };
    const viaClone = computePrescore({ ...input, lightMinorCount: input.lightMinorCount as number });
    const direct = computePrescore(input);
    check("S3-A-2 equivalence (clone vs direct)", JSON.stringify(viaClone) === JSON.stringify(direct));
  }
  const sample: PrescoreInput = {
    claims: ["tests passed"],
    toolSituations: [
      { name: "task-result", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_1"], hashes: [] }
    ],
    writePaths: [],
    ownedPaths: [],
    requiredChecks: ["chk_0"],
    completedChecks: ["chk_0"],
    constraints: [],
    retainedConstraintIds: [],
    progressed: true,
    stalledTurns: 0,
    independentEvidence: true,
    lightMinorCount: 1
  };
  const viaClone = bench(() => computePrescore({ ...sample, lightMinorCount: sample.lightMinorCount as number }), 50000);
  const direct = bench(() => computePrescore(sample), 50000);
  console.log(
    `S3-A-2 bench: clone+compute=${(viaClone * 1e6).toFixed(1)}ns direct=${(direct * 1e6).toFixed(1)}ns delta=${((viaClone - direct) * 1e6).toFixed(1)}ns/turn [production-unreachable: from-child never presets lightMinorCount]`
  );
}

/* ============================================================
 * S3-A-3: per-turn duplicate `claims.some(isSuccessClaim)` cost.
 * Computed once inside computePrescore.evidenceOutcome and once in
 * turn.ts derivedClaimedVerificationWithoutChecks. Dedup would need
 * to expose successClaim on PrescoreResult (public type change) or
 * cross-function coupling (S2-A-3 class). Measure the duplicate.
 * ============================================================ */
{
  const claimsSets: string[][] = [
    [],
    ["tests passed"],
    ["child completed the task"],
    ["verified output", "all checks pass"],
    ["wip"]
  ];
  const rng = mulberry32(0xa33a04);
  // correctness sanity: some() is pure and repeatable
  for (let trial = 0; trial < 1000; trial += 1) {
    const claims = pick(rng, claimsSets);
    check("S3-A-3 purity", claims.some(isSuccessClaim) === claims.some(isSuccessClaim));
  }
  const claims = ["child completed the task"];
  const cost = bench(() => void claims.some(isSuccessClaim), 100000);
  console.log(
    `S3-A-3 bench: one claims.some(isSuccessClaim)=${(cost * 1e6).toFixed(1)}ns/turn duplicate (x~5 turns/run) [dedup needs public PrescoreResult change]`
  );
}

/* ============================================================
 * S3-A-4: mergeOpenMinors empty-input early return.
 * From-child production path always passes two empty arrays; the
 * current code still allocates a Map, a Set, and an output array.
 * Candidate: `if (previous.length === 0 && current.length === 0) return [];`
 * ============================================================ */
{
  function candidateMerge(previous: readonly OpenMinor[], current: readonly OpenMinor[]): OpenMinor[] {
    if (previous.length === 0 && current.length === 0) return [];
    const previousById = new Map(previous.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const merged: OpenMinor[] = [];
    for (const item of current) {
      seen.add(item.id);
      const prior = previousById.get(item.id);
      const consecutive = prior === undefined ? item.consecutiveTurns : Math.max(item.consecutiveTurns, prior.consecutiveTurns + 1);
      merged.push({ ...item, consecutiveTurns: consecutive });
    }
    for (const item of previous) {
      if (!seen.has(item.id)) merged.push(item);
    }
    return merged;
  }
  const rng = mulberry32(0xa33a05);
  for (let trial = 0; trial < 4000; trial += 1) {
    const gen = (n: number): OpenMinor[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `m${Math.floor(rng() * 6)}_${i % 3}`,
        text: `minor ${i}`,
        status: rng() < 0.7 ? "verified-true" : UNOBSERVED,
        consecutiveTurns: Math.floor(rng() * 4),
        touchesConstraint: rng() < 0.15,
        userRejected: rng() < 0.1
      }));
    const previous = gen(Math.floor(rng() * 5));
    const current = gen(Math.floor(rng() * 5));
    check(
      "S3-A-4 equivalence",
      JSON.stringify(mergeOpenMinors(previous, current)) === JSON.stringify(candidateMerge(previous, current)),
      JSON.stringify({ previous, current })
    );
  }
  const cur = bench(() => void mergeOpenMinors([], []), 100000);
  const cand = bench(() => void candidateMerge([], []), 100000);
  console.log(
    `S3-A-4 bench empty inputs (production from-child path): current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns/turn`
  );
}

/* ============================================================
 * Whole-slice budget dominance anchor:
 * measure applyChildThreeLine end-to-end at real scale (41-event
 * table, apply path) and multiply by ~5 gates/run. The result bounds
 * ANY optimization in this slice from above.
 * ============================================================ */
{
  const rng = mulberry32(0xa33a06);
  void rng;
  const runId = "run_x" as Event["runId"];
  const nowIso = "2026-08-24T00:00:00.000Z";
  let idCounter = 0;
  const generateEventId = (): EventId => `evt_${String(idCounter++).padStart(8, "0")}` as EventId;
  // build a realistic 41-event table: RUN_STARTED + RUN_ATTACHED + filler
  const events: Event[] = [];
  events.push({
    id: generateEventId(),
    schemaVersion: 1,
    occurredAt: nowIso as Event["occurredAt"],
    runId,
    type: "RUN_STARTED",
    actor: "system",
    payload: { title: "bench" }
  } as unknown as Event);
  events.push({
    id: generateEventId(),
    schemaVersion: 1,
    occurredAt: nowIso as Event["occurredAt"],
    runId,
    type: "RUN_ATTACHED",
    actor: "supervisor",
    payload: { episodeId: "ep_bench", runId, attachedAt: nowIso }
  } as unknown as Event);
  for (let i = 0; i < 39; i += 1) {
    events.push({
      id: generateEventId(),
      schemaVersion: 1,
      occurredAt: nowIso as Event["occurredAt"],
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
    idCounter = 100;
    const out = applyChildThreeLine({
      events,
      child: child as never,
      spec: spec as never,
      nowIso,
      generateEventId
    });
    applied = out.result.applied;
  }, 5000);
  check("anchor path actually applies the gate", applied);
  console.log(
    `anchor: one applyChildThreeLine over 41-event table = ${(one * 1e3).toFixed(1)}us -> ~5 gates/run => whole-slice per-run budget ~${(one * 5 * 1e3).toFixed(0)}us (campaign landing line: ~100ms or complexity-class drop)`
  );

  // child observation micro-anchor for context
  const observation: ChildObservation = {
    taskId: "tsk_bench",
    role: "tester",
    outcome: "SUCCESS",
    summary: "tests passed",
    evidenceIds: ["evd_1"],
    artifactIds: ["art_1"],
    verification: { kind: "PASSED", evidenceIds: ["evd_1"] },
    requiredChecks: ["chk_0"],
    constraints: []
  };
  const assess = bench(() => assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" }), 5000);
  console.log(`anchor: assessChildObservation alone = ${(assess * 1e6).toFixed(0)}ns`);
}

// keep the import referenced for the anchor context (turn cost measured in R2-A)
void runTrackingTurn;

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

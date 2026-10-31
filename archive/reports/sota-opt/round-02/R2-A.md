# R2-A：`src/tracking/` + `src/run/{child-tracking,gate-apply}.ts` 复查报告

**战役:** 全库持久 SOTA 优化 Round 2 / R2-A（Round 1 同区第二遍）
**基线:** `cursor/sota-persistent-opt-83a1` @ `384536e`
**分支:** `cursor/r2a-tracking-slice-ccba`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-A 基线
（`7acb666`）以来**逐字节未变**（`git diff 7acb666..384536e -- <切片>` 为空），
R1-A 的逐文件收口与 S1-A-1..9 排除全部继承有效。本轮在完整排除表之上以新角度
再枚举，得到 6 个此前未点名的新候选（S2-A-1 … S2-A-6），全部经理论 + 确定性
仿真（seeded mulberry32，等价 fuzz + 真实规模基准 + 已落地/已否决量级校准）
裁决后淘汰：5 个在真实规模是 µs/ns 级噪声（含 1 个最强候选，理论与等价均成立
但绝对收益低于战役已示范的否决线两个量级），1 个实测反而慢 3.7×。未重开任何
X* / S1-* 条目。本切片在该数据面契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/tracking/`（12 文件）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`，全部实际读码。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-A.md。
  候选枚举刻意绕开全部既有排除（X0-4、X0-6、X2-4、S1-A-1..9 等），只探索
  **未被点名的新角度**：公共路径死工作消除（S2-A-1）、跨调用重复计算复用
  （S2-A-2/3）、追加拷贝构造方式（S2-A-4）、冗余中间拷贝（S2-A-5）、
  多遍融合的新位点（S2-A-6）。
- 三线规格遵守：分析不改 in-flight、Tracking 无命令权、H/score 不写路由——
  本轮零 diff，天然满足。公开 API、版本化阈值、哈希契约、事件 schema、
  CAS/幂等键格式全部不变。

## 1. 门槛校准（本轮裁决的证据基底）

R1-A 已实测本切片现实规模（41 事件/run、~5 次门控/run、每 turn 集合个位数、
episode 十几 turn），本轮直接继承（代码未变）。本轮补充的关键证据是
**战役已落地 vs 已否决候选的绝对量级对照**，作为门槛第 (c) 条（真实规模收益
非噪声）的裁决标尺：

| 类别 | 案例 | 量级 | 裁决 |
| --- | --- | --- | --- |
| 已落地 | J1（preferences） | 10618 ms → 3.8 ms（2770×） | 赢家 |
| 已落地 | S1-C（offline-logit） | 2336 → 1888 ms（1.24×，~450 ms/fit） | 赢家 |
| 已落地 | S1-F（experiments restore） | 727 → 152 ms（4.8×） | 赢家 |
| 已否决 | S1-C-1 | 边际 8.5–46 **ms**（运行噪声内） | 淘汰 |
| 已否决 | S1-C-7 | 亚 **ms** | 淘汰 |
| 已否决 | S1-C-6 | **µs** 级 | 淘汰 |
| 已否决 | S1-A-1 | 318 ns/run（10× 压力 3.6 µs/run） | 淘汰 |
| 已否决 | S1-A-5 | ±2 µs/12-turn 链（抖动内） | 淘汰 |
| 已否决 | S1-J-7 | 冗余 sort 移除，k 小常数噪声 | 淘汰 |

即：战役实际落地线在 **百 ms 级或复杂度类下降**；µs 级与亚 ms 级候选一律
淘汰过。本轮全部候选的绝对收益上界是 **12 µs/episode**，据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-A-1 | `roller.ts` 无截断快路径：`maxItems` 未设或 `mandatory` 不超预算时跳过 `mandatory` 数组 / `keptIds` Set / 双 filter（该机器在无截断分支可证为纯拷贝 no-op） | 消除每 turn O(累计量) 个对象分配 + 1 Set + 2 filter；快路径判定用 `length` 和免建数组 | ✅ 200 条 episode 链（2–15 turn，40% 带紧 `maxItems`，含 `==maxItems` 边界与截断路径）JSON 逐位一致 | 12-turn 链 54.7→43.4 µs（三次运行 delta 11.3/12.1/12.0 µs，稳定 20.7–22.2%）；单次晚期调用（31 约束）7.2→5.3 µs | 淘汰：**门槛 (c) 不过**。绝对收益 ~1 µs/turn、~12 µs/episode、~5 µs/run，比战役否决线（S1-C-7 亚 ms、S1-C-1 8.5–46 ms）低约两个量级；S1-J-7（冗余工作移除、结构等价、小 k）同类先例。理论与等价证据留存，见重开条件 |
| S2-A-2 | `from-child.ts` apply 路径 `evidenceRefsOf` 双算去重（外层 failRefs 与 `prescoreInputFromObservation` 内 `toolSituations[0].evidenceIds` 同值） | 免 1 次 Set 构建/子结果 | ✅ 3000 fuzz 双算逐字节同值（纯函数）；并验证现状两对象身份**不同** | 单次 `evidenceRefsOf`=143 ns，占 `assessChildObservation`(5.3 µs) 的 2.6%，~5 次/run | 淘汰：噪声；别名复用=可观察对象身份改变（S1-A-7 同类），传参复用=改公开 `prescoreInputFromObservation` 签名（S1-F-6 同类） |
| S2-A-3 | `turn.ts` `derivedClaimedVerificationWithoutChecks` 复用 prescore 的 check-coverage 维度（`requiredCheckGap ⇔ 该维度 outcome === "UNOBSERVED"`），免 O(R×C) every/includes 重扫 | 1 次小双层扫 → 1 次维度读取 | ✅ 8000 fuzz 一致（含 requiredChecks 空 / 全完成 / 部分完成全路径） | 省 **2.3 ns/turn** | 淘汰：亚噪声；且引入对维度数组内容的跨函数耦合，收益为零级 |
| S2-A-4 | `gate-apply.ts` `[...events]`+逐 push 换 `events.concat(a,b,c)` 批量追加 | 同 O(E)，仅常数假设 | ✅ 内容平凡一致 | **实测更慢 3.7×**：78.6 ns → 291.8 ns（E=41 追加 3） | 淘汰：负优化。V8 上小数组 spread+push 快于多参 concat，纯理论常数直觉再次被仿真推翻（S1-A-4 同教训） |
| S2-A-5 | `types.ts` `hashAssessment` 中 `[...assessment.dimensions]` 冗余 spread 移除（`.map` 已返回新数组，后续 `.sort` 只变异该新副本） | 免 1 次小数组分配/哈希调用 | ✅ 3000 fuzz 哈希逐位一致 + 入参不可变性验证 | 省 173 ns/调用 × ~10 次哈希/run ≈ 1.7 µs/run | 淘汰：噪声（哈希契约路径上零风险但零可测收益，「不要硬改」） |
| S2-A-6 | `from-child.ts` `assessChildObservation` 对 `prescore.dimensions` 的三遍（hasHardPassOrFail some + FAIL some + verdict map）融合单遍 | 3 遍 → 1 遍，固定 ≤6 元素 | ✅ 5000 fuzz 三输出联合一致 | 省 **10.9 ns**/子结果 | 淘汰：亚噪声（S1-A-6 同类位点） |

## 3. 关键裁决细节

### S2-A-1（本轮最强候选）为何仍淘汰

无截断分支上，现行代码构建 `mandatory`（每个合并约束 + 未决问题各分配一个
`{key,kind,text}` 对象）、`keptIds` Set，再对 `mergedConstraints` 与
`unresolvedQuestions` 各做一次 filter——而此时 `keptIds` 恒包含全部键，两次
filter 只产出内容相同的新副本。快路径把这一整段变成两个别名赋值（被别名的
两个数组均为 `rollSummary` 局部新建，不与任何入参共享引用，无 S1-A-7 型
可观察身份问题），200 条含截断/边界的 episode 链上 JSON 逐位一致。

三次独立仿真运行 delta 稳定（11.3/12.1/12.0 µs/12-turn 链，20.7–22.2%），
**不是** S1-A-5 那种抖动内持平——门槛 (a)(b) 双过。淘汰完全落在 (c)：滚轮
是每 tracking turn 一次的路径（~5 次/run），绝对收益 ~5 µs/run、~12 µs/episode。
战役已两次否决量级远大于此的候选（S1-C-7 亚 ms、S1-C-1 边际 8.5–46 ms），
且 S1-J-7 为「结构等价的冗余工作移除、小 k、常数噪声」立过同类先例。相对
百分比（20.7%）不改变绝对量级裁决——R1-A 否决 S1-A-1 时其相对节省高达 78%。

**重开条件：** 若滚轮 mandatory 集规模增长 ≥2 个量级（数千级约束/未决），或
`maxItems` 预算路径成为高频热点，可凭本报告的等价性证据（200 链 fuzz，含
`mandatory.length == maxItems` 边界）直接重开，无需重做理论。

### S2-A-4 的反向教训（理论被仿真推翻，第二例）

「一次 concat 批量追加应当不慢于 spread 拷贝加三次 push」在纸面成立，实测
E=41 时 concat 慢 3.7×（78.6 → 291.8 ns）。与 S1-A-4（Set 构建开销 > 短数组
线性扫）同为「纯理论常数直觉在 V8 真实分配路径上反转」的记录案例，供后续
轮次防止以纯理论重提追加构造类微改。

### S2-A-3 的等价引理（记录备查）

`coverageOutcome` 返回 `"UNOBSERVED"` ⇔ `requiredChecks.length > 0 &&
!every(completed)` ⇔ `derivedClaimedVerificationWithoutChecks` 中的
`requiredCheckGap`——8000 组 fuzz 验证该双向蕴含。故该候选**等价成立**但
收益 2.3 ns/turn，淘汰仅因规模；若未来 checks 集合达数千级可凭此引理重开。

## 4. 逐文件收口（新角度复查，其余面与 R1-A 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `roller.ts` | 无截断快路径（本轮唯一新结构） | S2-A-1 淘汰 |
| `from-child.ts` | `evidenceRefsOf` 双算；dimensions 三遍融合；`completedChecks` 防御拷贝省略=身份改变（S1-A-7/S1-B-8 同类，不另立 ID） | S2-A-2/6 淘汰 |
| `turn.ts` | claimed-verification 重扫复用 prescore 维度 | S2-A-3 淘汰 |
| `gate-apply.ts` | 追加构造 concat 化；`mapGateDirective` 的 `codes.includes` 表长 ≤6（S1-A-8 同类，不另立 ID） | S2-A-4 淘汰 |
| `types.ts` | `hashAssessment` 冗余 spread；`hashSummary` 各 spread 均必要（`.sort` 原地变异，省略即变异 readonly 入参） | S2-A-5 淘汰 |
| `child-tracking.ts` | `applyChildThreeLine` 的 5 次事件表扫描合并/索引化维持 X2-4/X0-4 排除；`observationFromChild` 单遍无新角度 | 无候选 |
| `human-score.ts` | X0-6/S1-A-3 之外无新角度；`REQUIREMENT_ONLY` 尾缀冗余维持 R1-A「记录不改」 | 无候选 |
| `prescore.ts` / `gates.ts` | S1-A-4/6 收口维持；无新结构 | 无候选 |
| `analysis.ts` / `isolation.ts` / `config.ts` / `combined-score.ts` / `index.ts` | 一次性构造 / O(1) 谓词 / 常量 / 单表达式 / 纯再导出 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（与 R1-A 同套件同计数）：

```bash
npx tsx --test "test/unit/tracking/**/*.test.ts" \
  "test/unit/run/gate-apply.test.ts" \
  "test/integration/track/**/*.test.ts"
# tests 72 / suites 13 / pass 72 / fail 0
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现）：

```text
S2-A-1 bench 12-turn episode: current=54.72us cand=43.38us delta=11.34us (20.7%)
S2-A-1 bench one late-episode call (31 constraints, 9 questions): current=7217ns cand=5334ns hashSummary(previous) alone=3335ns
S2-A-2 bench: assessChildObservation=5486.2ns, one evidenceRefsOf=142.9ns -> duplicate share=2.6%, ~5 calls/run
S2-A-3 bench per turn: current=54.5ns cand=52.3ns delta=2.3ns (x5 turns/run)
S2-A-4 bench E=41 append 3: spread+push=78.6ns concat=291.8ns delta=-213.2ns (x5 applications/run)
S2-A-5 bench: current=2280.4ns cand=2107.2ns delta=173.2ns (x~10 hash calls/run)
S2-A-6 bench 6 dimensions: three-pass=99.9ns fused=89.0ns delta=10.9ns (x~5 child results/run)
anchor: one runTrackingTurn at real scale = 4257ns per call (~5 turns/run)
ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行等价结论逐位一致；S2-A-1 delta 稳定于 11.3–12.1 µs
（20.7–22.2%），其余计时在抖动范围内，裁决方向均不变。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-A-1 | roller 无截断快路径（跳过 mandatory/keptIds/双 filter） | 等价且稳定省 20.7% 滚轮链，但绝对量 ~12µs/episode 低于战役落地线两个量级（S1-C-7/S1-J-7 同类）；mandatory 达数千级可凭本报告重开 |
| S2-A-2 | from-child evidenceRefsOf 双算去重 | 143ns 噪声；别名=S1-A-7 身份改变，传参=公开签名变更 |
| S2-A-3 | turn claimed-verification 复用 prescore check-coverage 维度 | 等价（双向蕴含已 fuzz 证明）但 2.3ns/turn 亚噪声 + 跨函数耦合 |
| S2-A-4 | gate-apply 追加拷贝 spread+push 换 concat | 不达：实测慢 3.7×（负优化，理论被仿真推翻第二例） |
| S2-A-5 | types hashAssessment dimensions 冗余 spread 移除 | 等价但 173ns/调用噪声 |
| S2-A-6 | from-child dimensions 三遍融合单遍 | 10.9ns 亚噪声（S1-A-6 同类位点） |

重开条件：S2-A-1/3 凭本报告等价性证据在规模增长 ≥2 个量级时重开；
S2-A-4 需先推翻本报告基准。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后 `npx tsx <file>`（仓库根目录，依赖已装）。
seeds：`0xa22a01`–`0xa22a07`。

```ts
/**
 * R2-A deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S2-A-1 .. S2-A-6 against the current
 * implementations in src/tracking + src/run/{child-tracking,gate-apply}.
 * All candidates are NEW angles not named by EXCLUSIONS.md or R1-A
 * (S1-A-1..9). Seeded PRNG (mulberry32) -> fully reproducible.
 * Seeds: 0xa22a01 .. 0xa22a08.
 */
import { performance } from "node:perf_hooks";
import { hash32 } from "/workspace/src/domain/hash.js";
import { computePrescore, isSuccessClaim, type PrescoreInput } from "/workspace/src/tracking/prescore.js";
import { rollSummary } from "/workspace/src/tracking/roller.js";
import { runTrackingTurn, type TrackingTurnInput } from "/workspace/src/tracking/turn.js";
import {
  assessChildObservation,
  prescoreInputFromObservation,
  type ChildObservation
} from "/workspace/src/tracking/from-child.js";
import type {
  AssessmentDimension,
  ConstraintRecord,
  HumanSignal,
  OpenMinor,
  PrescoreResult,
  RollingSummary,
  ToolSituation,
  TrackingAssessment,
  TrackingOmission,
  TrackingWindow
} from "/workspace/src/tracking/types.js";
import { UNOBSERVED, hashAssessment, hashSummary } from "/workspace/src/tracking/types.js";

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
 * S2-A-1: roller.ts no-truncation fast path.
 * When maxItems is undefined or mandatory fits the budget, the
 * current code still builds `mandatory`, a `keptIds` Set, and
 * re-filters constraints/questions even though everything is kept.
 * Candidate: full replica of rollSummary with a fast path that
 * skips that machinery when no truncation can occur.
 * ============================================================ */
function candidateRollFast(input: Parameters<typeof rollSummary>[0]): { summary: RollingSummary } {
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
  const mandatoryCount = mergedConstraints.length + unresolvedQuestions.length;

  let constraints: ConstraintRecord[];
  let keptQuestions: string[];
  const omissions: TrackingOmission[] = [];
  let failClosed = false;
  let failClosedReason: string | undefined;

  if (input.maxItems === undefined || mandatoryCount <= input.maxItems) {
    // fast path: nothing can be dropped; reuse locally created arrays
    constraints = mergedConstraints;
    keptQuestions = unresolvedQuestions;
  } else {
    const mandatory: Array<{ key: string; kind: TrackingOmission["kind"] }> = [
      ...mergedConstraints.map((item) => ({ key: item.id, kind: item.kind })),
      ...unresolvedQuestions.map((question) => ({ key: question, kind: "unresolved-decision" as const }))
    ];
    const keptMandatory = mandatory.slice(0, input.maxItems);
    for (const dropped of mandatory.slice(input.maxItems)) {
      omissions.push({ key: dropped.key, kind: dropped.kind, mandatory: true, reason: "budget" });
    }
    failClosed = true;
    failClosedReason = "mandatory item could not fit; fail closed";
    const keptIds = new Set(keptMandatory.map((item) => item.key));
    constraints = mergedConstraints.filter((item) => keptIds.has(item.id));
    keptQuestions = unresolvedQuestions.filter((question) => keptIds.has(question));
  }

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
  const rng = mulberry32(0xa22a01);
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
  // equivalence: 200 episode chains, ~40% with tight maxItems so the
  // truncation (slow) path and the boundary mandatory==maxItems both fuzz
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
      prevCandidate = candidateRollFast({ window: windowCandidate, ...base }).summary;
      check(
        "S2-A-1 equivalence",
        JSON.stringify(prevCurrent) === JSON.stringify(prevCandidate),
        `episode ${episode} turn ${turn} maxItems=${maxItems}`
      );
    }
  }
  // benchmark: 12-turn episode chain at real scale (same harness as R1-A
  // S1-A-5 so numbers are comparable), no maxItems -> fast path always taken
  function chain(fn: (input: Parameters<typeof rollSummary>[0]) => { summary: RollingSummary }): void {
    const rng2 = mulberry32(0xa22a02);
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
  const cand = bench(() => chain(candidateRollFast), 3000);
  console.log(
    `S2-A-1 bench 12-turn episode: current=${(cur * 1e3).toFixed(2)}us cand=${(cand * 1e3).toFixed(2)}us delta=${((cur - cand) * 1e3).toFixed(2)}us (${(((cur - cand) / cur) * 100).toFixed(1)}%)`
  );
  // isolate one no-truncation rollSummary call at late-episode scale
  // (cumulative constraints ~30) to bound the per-call saving
  const bigConstraints: ConstraintRecord[] = Array.from({ length: 30 }, (_, i) => ({
    id: `c_${i}`,
    text: `text ${i}`,
    kind: "constraint" as const,
    mandatory: true as const
  }));
  const bigPrev: RollingSummary = {
    schemaVersion: 1,
    constraints: bigConstraints,
    unresolvedQuestions: Array.from({ length: 8 }, (_, i) => `q_${i}`),
    confirmedDecisions: Array.from({ length: 10 }, (_, i) => `d_${i}`),
    operations: [],
    prescore: 0.8,
    human: { kind: "unobserved" },
    score: 0.8,
    anomalyCodes: [],
    evidenceRefs: [],
    openMinors: [],
    omissions: [],
    failClosed: false
  };
  const bigInput = {
    window: {
      previous: bigPrev,
      contextFacts: ["fact"],
      toolSituations: [],
      constraints: [{ id: "c_new", text: "t", kind: "constraint" as const, mandatory: true as const }],
      unresolvedDecisions: ["q_new"],
      confirmedDecisions: ["d_0"],
      openMinors: []
    },
    prescore: 0.8,
    human: { kind: "unobserved" } as HumanSignal,
    score: 0.8,
    anomalyCodes: [],
    evidenceRefs: [],
    openMinors: []
  };
  const curBig = bench(() => rollSummary(bigInput), 20000);
  const candBig = bench(() => candidateRollFast(bigInput), 20000);
  const hashOnly = bench(() => hashSummary(bigPrev), 20000);
  console.log(
    `S2-A-1 bench one late-episode call (31 constraints, 9 questions): current=${(curBig * 1e6).toFixed(0)}ns cand=${(candBig * 1e6).toFixed(0)}ns hashSummary(previous) alone=${(hashOnly * 1e6).toFixed(0)}ns`
  );
}

/* ============================================================
 * S2-A-2: from-child evidenceRefsOf duplicate elimination.
 * assessChildObservation computes evidenceRefsOf(observation) twice
 * on the apply path: once inside prescoreInputFromObservation (as
 * toolSituations[0].evidenceIds) and once as failRefs. Candidate A
 * aliases failRefs = prescoreInput.toolSituations[0].evidenceIds.
 * Adjudicate: value-equal (purity), but introduces an observable
 * object-identity change (assessment.evidenceRefs would alias
 * toolSituations[0].evidenceIds) -> S1-A-7 class; measure cost share.
 * ============================================================ */
{
  const rng = mulberry32(0xa22a03);
  for (let trial = 0; trial < 3000; trial += 1) {
    const observation: ChildObservation = {
      taskId: `tsk_${trial}`,
      role: pick(rng, ["implementer", "tester", "scout"]),
      outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const),
      summary: pick(rng, ["tests passed", "child completed the task", "", "wip"]),
      evidenceIds: rng() < 0.7 ? [`evd_${trial}`, "evd_shared"] : [],
      artifactIds: rng() < 0.5 ? [`art_${trial}`] : [],
      verification: {
        kind: rng() < 0.5 ? ("PASSED" as const) : ("FAILED" as const),
        evidenceIds: rng() < 0.8 ? [`evd_v_${trial}`, "evd_shared"] : []
      },
      requiredChecks: rng() < 0.4 ? ["test"] : [],
      constraints:
        rng() < 0.3
          ? [{ id: "c1", text: "keep scope", kind: "constraint" as const, mandatory: true as const }]
          : []
    };
    const prescoreInput = prescoreInputFromObservation(observation);
    const inner = prescoreInput.toolSituations[0]?.evidenceIds ?? [];
    const decision = assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" });
    if (decision.apply) {
      check(
        "S2-A-2 value equality (inner evidenceIds == outer failRefs)",
        JSON.stringify(inner) === JSON.stringify(decision.assessment.evidenceRefs),
        JSON.stringify(observation)
      );
      // current behaviour keeps them distinct objects (the contract the
      // aliasing candidate would observably change)
      check(
        "S2-A-2 current: distinct object identity",
        (inner as unknown) !== (decision.assessment.evidenceRefs as unknown)
      );
    }
  }
  const observation: ChildObservation = {
    taskId: "tsk_bench",
    role: "tester",
    outcome: "SUCCESS",
    summary: "tests passed",
    evidenceIds: ["evd_1", "evd_2"],
    artifactIds: ["art_1"],
    verification: { kind: "PASSED", evidenceIds: ["evd_1", "evd_3"] },
    requiredChecks: ["test"],
    constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }]
  };
  const full = bench(() => assessChildObservation({ observation, episodeId: "ep_x", runId: "run_x" }), 5000);
  const refsOnly = bench(() => {
    const refs = new Set<string>();
    for (const id of observation.evidenceIds) refs.add(id);
    for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
    void [...refs];
  }, 20000);
  console.log(
    `S2-A-2 bench: assessChildObservation=${(full * 1e6).toFixed(1)}ns, one evidenceRefsOf=${(refsOnly * 1e6).toFixed(1)}ns -> duplicate share=${((refsOnly / full) * 100).toFixed(1)}%, ~5 calls/run`
  );
}

/* ============================================================
 * S2-A-3: turn.ts derivedClaimedVerificationWithoutChecks reuse of
 * prescore's check-coverage dimension.
 * Theory: requiredCheckGap === (check-coverage outcome === "UNOBSERVED"),
 * so the O(R*C) every/includes rescan can be replaced by reading the
 * already-computed dimension. claims.some(isSuccessClaim) must still
 * be recomputed (not exposed by any dimension).
 * ============================================================ */
{
  const rng = mulberry32(0xa22a04);
  function genPrescoreInput(): PrescoreInput {
    const checks = Array.from({ length: Math.floor(rng() * 5) }, (_, i) => `chk_${i}`);
    const constraints: ConstraintRecord[] = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
      id: `c_${i}`,
      text: `constraint ${i}`,
      kind: "constraint",
      mandatory: true
    }));
    const tool = (): ToolSituation => {
      const exit = rng();
      return {
        name: pick(rng, ["test", "read", "write"]),
        ...(exit < 0.6 ? { exitCode: exit < 0.35 ? 0 : 1 } : {}),
        wrote: rng() < 0.4,
        escaped: rng() < 0.08,
        artifactIds: [],
        evidenceIds: ["evd_1"],
        hashes: []
      };
    };
    return {
      claims: rng() < 0.6 ? [pick(rng, ["tests passed", "did work", "verified output", "wip"])] : [],
      toolSituations: Array.from({ length: Math.floor(rng() * 4) }, tool),
      writePaths: [],
      ownedPaths: [],
      requiredChecks: checks,
      completedChecks: checks.filter(() => rng() < 0.7),
      constraints,
      retainedConstraintIds: constraints.map((c) => c.id),
      progressed: rng() < 0.15 ? UNOBSERVED : rng() < 0.8,
      stalledTurns: Math.floor(rng() * 4),
      independentEvidence: rng() < 0.5
    };
  }
  function currentDerived(prescoreInput: PrescoreInput): boolean {
    const required = prescoreInput.requiredChecks;
    const completed = prescoreInput.completedChecks;
    const requiredCheckGap = required.length > 0 && !required.every((id) => completed.includes(id));
    return prescoreInput.claims.some(isSuccessClaim) && requiredCheckGap;
  }
  function candidateDerived(prescoreInput: PrescoreInput, prescore: PrescoreResult): boolean {
    const coverageDim = prescore.dimensions.find((d) => d.id === "check-coverage");
    const requiredCheckGap = coverageDim?.outcome === "UNOBSERVED";
    return prescoreInput.claims.some(isSuccessClaim) && requiredCheckGap;
  }
  let lastInput: PrescoreInput | undefined;
  let lastPrescore: PrescoreResult | undefined;
  for (let trial = 0; trial < 8000; trial += 1) {
    const prescoreInput = genPrescoreInput();
    const prescore = computePrescore(prescoreInput);
    check(
      "S2-A-3 equivalence",
      currentDerived(prescoreInput) === candidateDerived(prescoreInput, prescore),
      JSON.stringify(prescoreInput)
    );
    lastInput = prescoreInput;
    lastPrescore = prescore;
  }
  const cur = bench(() => currentDerived(lastInput as PrescoreInput), 20000);
  const cand = bench(() => candidateDerived(lastInput as PrescoreInput, lastPrescore as PrescoreResult), 20000);
  console.log(
    `S2-A-3 bench per turn: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns (x5 turns/run)`
  );
}

/* ============================================================
 * S2-A-4: gate-apply `[...events]` + pushes -> single concat batch.
 * Same O(E) copy either way; adjudicate the constant.
 * ============================================================ */
{
  type Ev = { readonly type: string; readonly n: number };
  const events: Ev[] = Array.from({ length: 41 }, (_, i) => ({ type: "CHILD_MESSAGE", n: i }));
  const a: Ev = { type: "TRACKING_ASSESSMENT", n: 100 };
  const b: Ev = { type: "GATE_TRANSITION", n: 101 };
  const c: Ev = { type: "RUN_BLOCKED", n: 102 };
  const spreadPush = () => {
    const next = [...events];
    next.push(a);
    next.push(b);
    next.push(c);
    return next;
  };
  const concatBatch = () => events.concat(a, b, c);
  check(
    "S2-A-4 equivalence",
    JSON.stringify(spreadPush()) === JSON.stringify(concatBatch())
  );
  const cur = bench(() => void spreadPush(), 50000);
  const cand = bench(() => void concatBatch(), 50000);
  console.log(
    `S2-A-4 bench E=41 append 3: spread+push=${(cur * 1e6).toFixed(1)}ns concat=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns (x5 applications/run)`
  );
}

/* ============================================================
 * S2-A-5: types.ts hashAssessment redundant [...dimensions] spread
 * before .map (map already returns a fresh array; sort mutates only
 * that fresh copy). Candidate = replica without the spread.
 * ============================================================ */
{
  function candidateHashAssessment(assessment: TrackingAssessment): string {
    const payload = {
      coverage: assessment.coverage,
      dimensions: assessment.dimensions
        .map((dimension) => ({ id: dimension.id, verdict: dimension.verdict }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      episodeId: assessment.episodeId,
      gate: {
        codes: [...assessment.gate.codes].sort(),
        kind: assessment.gate.kind
      },
      prescore: assessment.prescore,
      quality: assessment.quality,
      runId: assessment.runId,
      score: assessment.score,
      turnId: assessment.turnId
    };
    return hash32(JSON.stringify(payload));
  }
  const rng = mulberry32(0xa22a05);
  const dimIds = [
    "evidence-consistency",
    "scope-safety",
    "check-coverage",
    "constraint-retention",
    "progress-vs-stall",
    "narrative-coherence"
  ] as const;
  let last: TrackingAssessment | undefined;
  for (let trial = 0; trial < 3000; trial += 1) {
    const dims: AssessmentDimension[] = dimIds
      .filter(() => rng() < 0.9)
      .map((id) => {
        const verdict = pick(rng, ["PASS", "FAIL", "UNOBSERVED", "NOT_APPLICABLE"] as const);
        return verdict === "FAIL" ? { id, verdict, evidenceRefs: ["evd_1"] } : { id, verdict };
      });
    const assessment: TrackingAssessment = {
      schemaVersion: 1,
      episodeId: `ep_${trial}`,
      runId: "run_x",
      turnId: `t_${trial}`,
      prescore: Number(rng().toFixed(4)),
      quality: Number(rng().toFixed(4)),
      coverage: Number(rng().toFixed(4)),
      human: { kind: "unobserved" },
      score: Number(rng().toFixed(4)),
      dimensions: dims,
      gate: {
        kind: pick(rng, ["hard", "soft", "none"] as const),
        codes: rng() < 0.5 ? ["soft-threshold"] : [],
        wakeAnalysis: rng() < 0.5,
        expandDetail: rng() < 0.5,
        askUser: rng() < 0.2,
        openMinors: []
      },
      evidenceRefs: ["evd_1"]
    };
    // input immutability: candidate must not mutate assessment.dimensions
    const before = JSON.stringify(assessment.dimensions);
    const expected = hashAssessment(assessment);
    const actual = candidateHashAssessment(assessment);
    check("S2-A-5 equivalence", expected === actual, JSON.stringify(assessment));
    check("S2-A-5 input not mutated", JSON.stringify(assessment.dimensions) === before);
    last = assessment;
  }
  const cur = bench(() => hashAssessment(last as TrackingAssessment), 20000);
  const cand = bench(() => candidateHashAssessment(last as TrackingAssessment), 20000);
  console.log(
    `S2-A-5 bench: current=${(cur * 1e6).toFixed(1)}ns cand=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns (x~10 hash calls/run)`
  );
}

/* ============================================================
 * S2-A-6: from-child assessChildObservation three dimension passes
 * (hasHardPassOrFail some + FAIL some + verdict map) fused into one.
 * Dimensions array is fixed at <=6 entries.
 * ============================================================ */
{
  const rng = mulberry32(0xa22a06);
  function fused(prescore: PrescoreResult, failRefs: string[]): {
    hasHardPassOrFail: boolean;
    anyFail: boolean;
    mapped: AssessmentDimension[];
  } {
    let hasHardPassOrFail = false;
    let anyFail = false;
    const mapped: AssessmentDimension[] = [];
    for (const dimension of prescore.dimensions) {
      const isPassOrFail = dimension.outcome === "PASS" || dimension.outcome === "FAIL";
      if (dimension.hardRelated && isPassOrFail) hasHardPassOrFail = true;
      if (dimension.outcome === "FAIL") anyFail = true;
      const verdict = dimension.outcome === "ABSTAIN" ? "UNOBSERVED" : dimension.outcome;
      mapped.push(verdict === "FAIL" ? { id: dimension.id, verdict, evidenceRefs: failRefs } : { id: dimension.id, verdict });
    }
    return { hasHardPassOrFail, anyFail, mapped };
  }
  let last: PrescoreResult | undefined;
  for (let trial = 0; trial < 5000; trial += 1) {
    const checks = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => `chk_${i}`);
    const input: PrescoreInput = {
      claims: rng() < 0.5 ? ["tests passed"] : [],
      toolSituations:
        rng() < 0.8
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
      constraints: [],
      retainedConstraintIds: [],
      progressed: rng() < 0.15 ? UNOBSERVED : rng() < 0.8,
      stalledTurns: 0,
      independentEvidence: true
    };
    const prescore = computePrescore(input);
    const failRefs = ["evd_f"];
    const expectedHard = prescore.dimensions.some(
      (dimension) => dimension.hardRelated && (dimension.outcome === "PASS" || dimension.outcome === "FAIL")
    );
    const expectedFail = prescore.dimensions.some((dimension) => dimension.outcome === "FAIL");
    const expectedMap = prescore.dimensions.map((dimension) => {
      const verdict = dimension.outcome === "ABSTAIN" ? "UNOBSERVED" : dimension.outcome;
      if (verdict === "FAIL") return { id: dimension.id, verdict, evidenceRefs: failRefs };
      return { id: dimension.id, verdict };
    });
    const got = fused(prescore, failRefs);
    check(
      "S2-A-6 equivalence",
      got.hasHardPassOrFail === expectedHard &&
        got.anyFail === expectedFail &&
        JSON.stringify(got.mapped) === JSON.stringify(expectedMap)
    );
    last = prescore;
  }
  const p = last as PrescoreResult;
  const cur = bench(() => {
    void p.dimensions.some((d) => d.hardRelated && (d.outcome === "PASS" || d.outcome === "FAIL"));
    void p.dimensions.some((d) => d.outcome === "FAIL");
    void p.dimensions.map((d) => {
      const verdict = d.outcome === "ABSTAIN" ? "UNOBSERVED" : d.outcome;
      return verdict === "FAIL" ? { id: d.id, verdict, evidenceRefs: ["evd_f"] } : { id: d.id, verdict };
    });
  }, 50000);
  const cand = bench(() => void fused(p, ["evd_f"]), 50000);
  console.log(
    `S2-A-6 bench 6 dimensions: three-pass=${(cur * 1e6).toFixed(1)}ns fused=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns (x~5 child results/run)`
  );
}

/* ============================================================
 * Context anchor: full runTrackingTurn cost at real scale, so the
 * per-candidate deltas can be judged against the whole-turn cost.
 * ============================================================ */
{
  const rng = mulberry32(0xa22a07);
  const checks = ["chk_0", "chk_1"];
  const minors: OpenMinor[] = [
    { id: "m1", text: "minor", status: "verified-true", consecutiveTurns: 0, touchesConstraint: false, userRejected: false }
  ];
  const input: TrackingTurnInput = {
    window: {
      contextFacts: ["fact"],
      toolSituations: [
        { name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: ["art_1"], evidenceIds: ["evd_1"], hashes: [] }
      ],
      constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }],
      unresolvedDecisions: ["q1"],
      confirmedDecisions: [],
      openMinors: minors,
      userText: "这轮改动整体还行,给 7分 吧"
    },
    prescoreInput: {
      claims: ["tests passed"],
      toolSituations: [
        { name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: ["art_1"], evidenceIds: ["evd_1"], hashes: [] }
      ],
      writePaths: ["src/a.ts"],
      ownedPaths: ["src/a.ts"],
      requiredChecks: checks,
      completedChecks: checks,
      constraints: [{ id: "c1", text: "keep scope", kind: "constraint", mandatory: true }],
      retainedConstraintIds: ["c1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    },
    humanInput: {}
  };
  void rng;
  const cost = bench(() => runTrackingTurn(input), 10000);
  console.log(`anchor: one runTrackingTurn at real scale = ${(cost * 1e6).toFixed(0)}ns per call (~5 turns/run)`);
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

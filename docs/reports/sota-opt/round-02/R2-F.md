MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-F：`src/experiments/` 复查报告（Round 1 同区第二遍）

- 基线：最新 `cursor/sota-persistent-opt-83a1` @ `e5594a4`（含 S1-F 已落地）
- 切片：`src/experiments/` 全部 15 文件（2325 行）
- 前置阅读：README、EXCLUSIONS（含 S2-A/B/D 新增）、round-02/PLAN、round-01/R1-F、`scripts/round01-r1f-equivalence-sim.ts`
- 分支：`cursor/r2f-experiments-research-c879`

## 结论

**无新更优解落地，零代码改动。** 在 S1-F 与完整排除表之上再搜一遍，找到 6 个排除表未覆盖的新候选（其中 S2-F-1 是逐位可证的闭式 O(1) 替代、S2-F-3 是错误行为逐字节等价的去重），全部经理论 + 确定性仿真裁决后淘汰，新增排除 S2-F-1…S2-F-6。R1-F 的渐近下界论证（fail-closed 契约下 runner 每调用 Ω(P+A)）经本轮复核后维持成立；`canCloseProductionCheckpointF` 语义未触碰（simulation ≠ production）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* / S2-* 条目。本轮候选均先对照 EXCLUSIONS 全表：S2-F-1 不是 X1-3（闭式**近似**）也不是 X4-1（RNG 重放**增量化/隐藏状态**）——它是无状态纯函数的逐位精确等值式；S2-F-4 不是 S1-F-6（公开签名变更）——它只动私有 `restoreShadowState` 的内部管线。逐条论证见 §3。
- 未触碰版本化阈值、权限、数据面契约；X1-5、X3-2、X3-3、X4-1、S1-F-1…8 全部维持。
- 回归：`npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓（2668 项逐位检查通过；S1-F 维持 658.7ms→154.0ms，4.3×）。

## 1. 规模与门槛基底

- 仓内可达性（本轮重新核实）：`createShadowRunner` 唯一生产调用方为 `src/adaptation/reflection.ts` 的 `evaluateProposalShadow`（assign+recordOutcome 全循环）；`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout` **仓内仅测试可达**；`eval-routing.ts` 只用 `replayCacheKey`。
- 战役否决线校准（继承）：S1-I-1 ~190µs、S2-B-1 202–240µs、S2-D-4 ~116µs 均已否决；防御纵深消除类（S2-D-5、S1-H-2）一律安全侧保留。
- R1-F 下界论证复核：fail-closed 契约要求每次 runner 调用重验整个 plan（Ω(P)）与全部 assignment（Ω(A)），S1-F 落地后每调用 O(P+A) 已达该下界——本轮所有 runner 侧候选都只能压常数，不可能再降复杂度类。**该论证经复核无第二个「漏记嵌套因子」**（R1-F 曾发现 Iter4 漏记 O(A×P)；本轮对每条 O(·) 记载重新展开验算，见 §4 逐文件收口）。

## 2. 候选总表（全部淘汰，无赢家落地）

仿真脚本全文见附录；13 项检查 0 失败。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-F-1 | `shadowDecisionAt` mulberry32 闭式 O(1) 状态跳转（替代每 assign 从头重放 index+1 次 rng） | mulberry32 状态递推是仿射式：state_i = (seed + i·0x6d2b79f5) mod 2³²，`Math.imul` 给出精确 32 位乘积，第 i 个输出可 O(1) 直算；单函数 Θ(index)→Θ(1)，全实验累计 rng 功 Θ(A²)→Θ(A) | ✅ 58,950 组 (seed,index) 原始 double `Object.is` 逐位一致（边界种子含 0/±1/±2³¹/2³²±/±MAX_SAFE_INTEGER、200 随机种子、index 穷举 0..4095 + 大índice 2.5M） | P=2000/A=1000 全实验 291.15ms，其中 rng 重放组件仅 3.011ms，闭式 0.032ms——省 2.98ms = **全程 1.02%**；P=200/A=100 时 0.96% | 淘汰：runner 每调用 Ω(P+A) 下界（R1-F §1.1）不因此改变，rng 项被 fail-closed 重验与防御拷贝支配；~1% 低于落地线。**注记：这是无状态纯等值式，不触犯 X1-3（非近似）/X4-1（非增量），若未来 A 增大 100× 或重验被规格解锁可重新裁决** |
| S2-F-2 | `replayPolicy` 内 `manifestHash(manifest)` 双算消除（L124 rerunHash 模板与 L128 返回字段各算一次，纯函数同输入） | 免一次全 manifest stableStringify+hash32，O(2S)→O(S) 组件常数减半 | ✅ 纯函数确定性（同对象两次调用值恒等，仿真 part C 复核） | 一次 manifestHash 占 replayPolicy 全程 **2.7–3.1%**（N=100:31µs / N=1000:230µs / N=10000:2.39ms）；且 `replayPolicy` **仓内无生产调用方**（仅 m5 测试与 iter3 仿真） | 淘汰：S2-D-3（双 parseTaskId 16.5µs）同类纯重复消除 + S1-D-3/S1-E-7 的「无生产调用方」论证叠加；组件常数减半不改 O(S+N·policy) 调用类 |
| S2-F-3 | `assertIsolatedOutput` 先对 `episodes.map(originalWorkspace)` 去重再建守卫（`[...new Set(...)]` 保插入序） | createIsolationGuard 每 root 4 次 path.resolve + 2 次 path.relative；真实数据集 workspace 高度重复，昂贵路径解析 O(N)→O(U) | ✅ 400 例 fuzz（随机混入空串/空白/双向重叠/重复 root/输出根变体）throw 与否、错误消息、错误类逐字节一致；顺序论证：Set 保首现序，重复 root 结果幂等，首个违规 root 不变 | N=10000/U=3 省 7.86ms、N=1000 省 0.90ms，但 **N=100 仅省 90µs**（低于 S1-I-1 ~190µs 否决线）；且与 S2-F-2 同：仓内 test-only 可达 | 淘汰：调用类 O(N) 不变（收集 workspace 本身 Ω(N)）；真实规模收益压不过否决线，无生产负载背书 |
| S2-F-4 | shadow/canary assign 路径复用 restore 已建 population Set（私有 `restoreShadowState`/`restoreCanaryState` 返回值扩带 Set，`requirePopulationEpisode` 换 `requirePopulationMember`） | restore 已付 O(P) 建 Set，assign 的 `plan.population.includes` 线性扫描（均摊 P/2）可 O(1) 复用，零额外构建成本；每 assign 免一遍 O(P) | ✅ S1-F 已证 `Set.has` ≡ `includes`（SameValueZero + 已验唯一非空字符串），错误消息共用同一实现 | P=2000/A=1000 全实验 includes 总计 2.452ms vs 复用 Set 0.054ms——省 2.40ms = **全程 0.8%**；P=200 时省 25µs | 淘汰：每调用 O(P+A) 类不变（validate 本身 Ω(P) 多遍在前）；~0.8% 低于落地线。R1-F「assign 单点查询建 Set 无收益」的裁决扩展适用于复用变体 |
| S2-F-5 | `splitFromManifest` 尾部 `assertExplicitSplit` 双验消除（train/holdout 无重复、无交叉已由 `validateSealedDatasetManifest` 的 membership Map 保证） | 免一遍 O(train+holdout) 重验 | —（不变式论证成立但属防御纵深删除） | 重验遍占 split 路径 **8.6–12.1%**（N=2000:120µs / N=20000:864µs），每 `runSimulationHoldout` 一次性；且 runSimulationHoldout 仓内 test-only | 淘汰：fail-closed 防御纵深（S2-D-5 monitor 重复校验、S1-H-2 gated 合同拷贝同族裁决：安全侧保留）；绝对量一次性 µs–亚 ms 级 |
| S2-F-6 | `pairedEvaluationCard` 4×map + `mean` 双算（外层 `mean(xs)` 与 `sampleStandardError(xs)` 内部重算）单遍融合 | 常数遍数 6→1 | ✅ 分累加器单遍可保各数组求和序（逐位）；hoist mean 恒等 | 真实规模（每 tier 配对记录几十条）N=40 全函数仅 **13µs**；N=1000 也只 175µs | 淘汰：X3-2/S1-F-4/S1-C-8 同族常数遍数噪声；每报告一次性 |

## 3. 关键裁决细节

### S2-F-1：本轮最强候选为何仍不落地

这是本轮唯一具有「组件复杂度类下降」形态的候选，值得完整记录：

- **等值式推导**：`createSeededRng` 的状态更新是 `state ← (state + 0x6d2b79f5) >>> 0`，输出仅依赖当前 state（tempering 无携带状态）。mod 2³² 加法可结合，故第 i 次调用（1-based）的 state ≡ (ToUint32(seed) + i·0x6d2b79f5) mod 2³²。JS 中 `Math.imul(i, 0x6d2b79f5)` 精确给出乘积低 32 位（ToInt32 环绕 ≡ mod 2³²，对任意整数 i 成立），两个 uint32 相加 < 2⁵³ 无精度损失，`>>> 0` 归约。tempering 逐句照抄。因此 `shadowDecisionAt(seed, index)` 可重写为 O(1) 纯函数，**对全体 (整数 seed, index≥0) 逐位一致**——仿真以 58,950 组边界+随机组合对原始 double 做 `Object.is` 验证，0 失败。
- **与排除表的关系**：X1-3 排除的是「Newton/减迭代/闭式**近似**」（非逐位一致）；X4-1 排除的是「RNG 重放/restore **增量化**」（跨调用隐藏状态）。本候选两者皆非——无状态、无缓存、逐位精确。属排除表未覆盖的新提案，故需独立裁决。
- **为何淘汰**：观测边界是 runner 调用。R1-F §1.1 的下界论证（复核无误）：fail-closed 契约强制每调用 Ω(P)（validateExperimentPlan）+ Ω(A)（全量 assignment 重验 + 防御拷贝），S1-F 后已达 O(P+A) 下界。rng 重放是 assign 路径 5–6 个 A 线性项之一，且每步仅 ~6 整数操作：实测 P=2000/A=1000 全实验 291.15ms 中 rng 重放组件仅 3.01ms（1.02%），P=200/A=100 时 0.96%。**每调用与全实验复杂度类均不变**（O(P+k+k)→O(P+k)；O(AP+A²) 不动），收益~1% 深陷噪声带，低于战役历次落地形态（S1-F 4.8×、J1/S1-C/S1-I 均为类变或可测倍数级）。
- **留门**：若未来规格允许 restore 增量化（推翻 X3-3/X4-1）使 A 线性项消失，rng 重放将成为 assign 路径唯一 Θ(k) 项，届时本等值式（连同本报告的逐位证明）应重新裁决。

### S2-F-3：等价性完整但两条独立死因

去重变体在 400 例对抗 fuzz（空串/空白 root、输出根被包含/包含输出根、重复混排、非法输出根）下 throw/消息/错误类逐字节一致——顺序论证：`Set` 保首现序；重复 root 的三段检查（空验、双向重叠）结果幂等，故首个抛错 root 与原实现一致。仍淘汰，因（1）复杂度类不降：收集 N 个 workspace 本身 Ω(N)，降的只是每项常数（4 次 path.resolve → 1 次 Set 插入）；（2）`replayPolicy`（唯一调用方）仓内无生产调用方，真实规模档 N=100 的收益 90µs 低于 S1-I-1 已否决的 ~190µs。两条任一即足否决。

### S2-F-4：R1-F 裁决的复用变体扩展

R1-F 曾裁决「assign 路径单点查询建 Set 无收益」（建 Set 本身 O(P)）。本轮候选绕开了构建成本——restore 已建的 Set 顺手传给 assign（私有函数签名，非 S1-F-6 的公开 `: void` 变更）。等价性由 S1-F 的 SameValueZero 论证直接继承。淘汰理由回到规模：includes 扫描在全实验中只占 0.8%（validate 的多遍 Ω(P) 与防御拷贝支配），且每调用复杂度类不变。此变体连同原始形态一并计入排除，防止第三次重提。

## 4. 逐文件收口（R1-F 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | 见 S2-F-1/S2-F-4；`applyExperimentClock`/`haltOnAssignmentBudget` 对象 spread 为 O(字段数) 浅拷贝非 O(A)（复核确认 R1-F 记载无漏）；`recordExperimentOutcome` 双 some + 成本重加维持 S1-F-8 | 无候选落地 |
| `canary.ts` | 见 S2-F-4；assign 内 `requireCanaryBlock(next.plan)` 二次调用为 O(1) 常数；`derivedExposure` 单遍已最优；`reversibleScopes.includes` 维持 S1-F-7 | 无候选 |
| `replay.ts` | 见 S2-F-2/S2-F-3；`[...manifest.episodeHashes].filter` 冗余 spread 为 S1-B-5 同族一次分配噪声；`eligible.includes(selected)` E≤个位数；rerunHash 全量 stableStringify 为字节稳定契约本体 | 无候选落地 |
| `plan.ts` | 全单遍；`EXPERIMENT_ID_PATTERN` 模块级无 /g（X0-6 安全侧）；返回 Set 维持 S1-F-6 | 无候选 |
| `gated-comparison.ts` | 见 S2-F-6；strip-retry 维持 S1-F-1 | 无候选落地 |
| `comparison-report.ts` | 六遍聚合维持 X3-2；`pairedDeltaSummary` 两遍 mean+variance 若改 Welford 单遍则浮点序变、非逐位（X2-1/X1-3 域），不提案 | 无候选 |
| `simulation-holdout.ts` | 见 S2-F-5；`lookupSplit` O(hashes) Map 查已最优；`observationsFromTrain` 单遍 | 无候选落地 |
| `dataset.ts` | `rotateHoldout` 双验维持 R1-F「fail-closed 设计」裁决；`previousHoldout` 环节全 Set 单遍 | 无候选 |
| `manifest.ts` | `stableStringify` 流式单缓冲重写理论上 O(S·D)→O(S)，但真实深度 D≤5 恒常数，且 parts+join 型重写在本仓两次实测更慢（S1-E-3 ~230ns、S1-I-7 慢 6.4×），输出字节为冻结契约——不提案不立 ID（X3-2 常数域 + 实测负优化先例足够覆盖） | 无候选 |
| `holdout.ts` | 审计追加拷贝维持 S1-F-3/X4-2；`datasets` Map 已 O(1) | 无候选 |
| `isolation.ts` | `isInside` 内 resolvedRoot/Target 重复 resolve 的提升属每调用常数（roots 个位数时 ns 级）；N 大场景已并入 S2-F-3 裁决 | 无候选 |
| `threshold-calibration.ts` | 三遍维持 S1-F-4；`best` 扫描 3 行常数 | 无候选 |
| `evaluation-card.ts` | 纯校验常数遍，数组字面量循环为 S1-B-7 域 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |
| `attribution-report.ts` | 21 行证据封装无循环 | 无候选 |

## 5. 前后对比

零代码改动。基线（S1-F 落地态）即本轮终态：P=2000/A=1000 全实验 291.15ms（本机），rng/成员判断/重复哈希等全部残余候选合计理论上限 <5%，且各自撞排除域或否决线。

## 6. 测试

- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（S1-F 回归：658.7ms→154.0ms，4.3×，1.67 亿次成员比较消除维持）
- 本轮裁决仿真（附录）✓ — 13 项检查 0 失败（58,950 组闭式逐位等价 + 400 例去重错误等价 + 全部性能基准）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-F-1 | shadowDecisionAt mulberry32 闭式 O(1) 状态跳转 | 逐位精确（58,950 组 Object.is 验证，非 X1-3 近似/X4-1 增量），但 runner 每调用 Ω(P+A) 下界不变，rng 重放仅占全实验 ~1%（P=2000/A=1000 省 2.98ms/291ms）；若 X3-3/X4-1 未来被规格解锁应重新裁决 |
| S2-F-2 | replayPolicy 双 manifestHash 消除 | 纯函数重复可证恒等，但占全程仅 2.7–3.1% 且 replayPolicy 仓内无生产调用方（S2-D-3 + S1-D-3/S1-E-7 叠加） |
| S2-F-3 | assertIsolatedOutput workspace 去重后建守卫 | 错误行为 400 fuzz 逐字节等价，但调用类 O(N) 不变、真实档 N=100 仅省 90µs（低于 S1-I-1 否决线）、test-only 可达 |
| S2-F-4 | shadow/canary assign 路径复用 restore 已建 population Set | 等价性继承 S1-F 论证且仅动私有签名（非 S1-F-6），但全实验仅省 ~0.8%（2.40ms/291ms），validate 的 Ω(P) 多遍支配 |
| S2-F-5 | splitFromManifest 尾部 assertExplicitSplit 双验消除 | fail-closed 防御纵深（S2-D-5/S1-H-2 同族安全侧保留）；一次性 µs–亚 ms 级且 test-only 可达 |
| S2-F-6 | pairedEvaluationCard 多遍 map/mean 双算单遍融合 | X3-2/S1-F-4/S1-C-8 同族常数遍数；真实 N=40 全函数仅 13µs 一次性 |

MORE_OPTIMA=NO
BRANCH=cursor/r2f-experiments-research-c879

## 附录：确定性仿真脚本（完整，可复现）

保存为 `scripts/round02-r2f-decision-sim.ts` 后 `npx tsx scripts/round02-r2f-decision-sim.ts` 运行（本轮按战役纪律不将脚本入库，报告内嵌全文）：

```ts
/**
 * Round-2 R2-F adjudication simulation (temporary — embedded in the R2-F
 * report appendix, not committed as a standing script).
 *
 * Adjudicates six fresh candidates over src/experiments/ on top of the
 * landed S1-F baseline:
 *
 *   S2-F-1  shadowDecisionAt closed-form O(1) state jump (mulberry32 state is
 *           affine: state_i = seed + i*0x6d2b79f5 mod 2^32; Math.imul gives
 *           the exact 32-bit product, so the i-th output is computable
 *           without replaying i rng calls). Bitwise equivalence + realistic
 *           full-experiment share.
 *   S2-F-2  replayPolicy duplicate manifestHash(manifest) elimination.
 *   S2-F-3  assertIsolatedOutput unique-workspace dedupe before the guard.
 *   S2-F-4  assign-path population membership reusing the restore-built Set.
 *   S2-F-5  splitFromManifest trailing assertExplicitSplit double-validation.
 *   S2-F-6  pairedEvaluationCard multi-pass fusion / duplicate mean.
 *
 * Every equivalence check demands bitwise-identical doubles (Object.is) and
 * identical thrown error messages/classes. Run with:
 *   npx tsx scripts/round02-r2f-decision-sim.ts
 */

import {
  createShadowRunner,
  type ExperimentOutcome,
  type ShadowState,
} from "../src/experiments/shadow.js";
import { createSeededRng, replayPolicy, assertIsolatedOutput, type FrozenEpisode, type RoutingPolicy } from "../src/experiments/replay.js";
import { manifestHash, type DatasetManifest } from "../src/experiments/manifest.js";
import { validateExperimentPlan, type ExperimentPlan } from "../src/experiments/plan.js";
import {
  validateSealedDatasetManifest,
  type SealedDatasetManifest,
} from "../src/experiments/dataset.js";
import { pairedEvaluationCard } from "../src/experiments/gated-comparison.js";
import type { PairedEvaluationRecord } from "../src/experiments/comparison-report.js";
import type { SimulationHoldoutEpisode } from "../src/experiments/simulation-holdout.js";
import { createIsolationGuard } from "../src/experiments/isolation.js";
import { createCandidateId, createResourceVersionId } from "../src/domain/ids.js";
import { DomainValidationError } from "../src/domain/errors.js";
import type { RouteRequest } from "../src/routing/policy.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}
function out(line: string): void {
  console.log(line);
}

function timeMs(fn: () => void, rounds = 5): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    best = Math.min(best, Number(t1 - t0) / 1e6);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Part A — S2-F-1 closed-form equivalence (bitwise)                   */
/* ------------------------------------------------------------------ */

/** Verbatim production shadowDecisionAt, returning the raw double. */
function refShadowValueAt(seed: number, index: number): number {
  const rng = createSeededRng(seed);
  let value = 0;
  for (let i = 0; i <= index; i++) {
    value = rng();
  }
  return value;
}

/** Closed-form candidate: exact affine state jump, identical tempering. */
function closedShadowValueAt(seed: number, index: number): number {
  const state = (((seed >>> 0) + (Math.imul(index + 1, 0x6d2b79f5) >>> 0)) >>> 0);
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function partA(): void {
  const edgeSeeds = [
    0, 1, -1, 42, 1234567, -987654321,
    2 ** 31 - 1, -(2 ** 31), 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 7,
    -(2 ** 32), Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  ];
  const rng = createSeededRng(20260824);
  const randomSeeds: number[] = [];
  for (let i = 0; i < 200; i++) {
    randomSeeds.push(Math.floor((rng() - 0.5) * 2 ** 41));
  }
  let compared = 0;
  // Exhaustive small indices on edge seeds.
  for (const seed of edgeSeeds) {
    for (let index = 0; index < 4096; index++) {
      const a = refShadowValueAt(seed, index);
      const b = closedShadowValueAt(seed, index);
      if (!Object.is(a, b)) {
        check(`A seed=${seed} index=${index}`, false);
        return;
      }
      compared += 1;
    }
  }
  // Sampled indices on random seeds.
  const sampledIndices = [0, 1, 2, 3, 5, 127, 1023, 65535];
  for (const seed of randomSeeds) {
    for (const index of sampledIndices) {
      const a = refShadowValueAt(seed, index);
      const b = closedShadowValueAt(seed, index);
      if (!Object.is(a, b)) {
        check(`A seed=${seed} index=${index}`, false);
        return;
      }
      compared += 1;
    }
  }
  // Large indices on a few seeds (1e6+ replay each).
  for (const seed of [0, 42, -987654321]) {
    for (const index of [1_000_000, 2_500_000]) {
      const a = refShadowValueAt(seed, index);
      const b = closedShadowValueAt(seed, index);
      if (!Object.is(a, b)) {
        check(`A seed=${seed} index=${index}`, false);
        return;
      }
      compared += 1;
    }
  }
  check("A closed-form bitwise equivalence", true);
  out(`part A: ${compared} (seed,index) pairs bitwise-identical (Object.is on the raw double)`);
}

/* ------------------------------------------------------------------ */
/* Part B — S2-F-1 realistic share of a full production experiment     */
/* ------------------------------------------------------------------ */

function makeShadowPlan(populationSize: number, maxAssignments: number): ExperimentPlan {
  const population: string[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  return {
    planVersion: 1,
    experimentId: "exp_r2f_bench",
    mode: "shadow",
    baselineVersionId: createResourceVersionId(() => "r2fbase"),
    candidateId: createCandidateId(() => "r2fcand"),
    population,
    metrics: ["utility"],
    thresholds: { maxGuardrailBreaches: 1_000_000, maxCostUsd: 1e12 },
    budget: { maxAssignments, maxWallClockMs: 1e12 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
    canary: undefined,
  };
}

function partB(): void {
  for (const [P, A] of [[200, 100], [2000, 1000]] as const) {
    const plan = makeShadowPlan(P, A);
    validateExperimentPlan(plan);
    const runner = createShadowRunner(plan);
    const outcomes: ExperimentOutcome[] = plan.population.slice(0, A).map((episodeHash) => ({
      episodeHash,
      utility: 0.5,
      costUsd: 0.01,
      guardrailBreached: false,
    }));
    // evaluateProposalShadow-shaped production loop (assign + recordOutcome).
    let finalState: ShadowState | undefined;
    const tProd = timeMs(() => {
      let state = runner.start(0);
      for (const outcome of outcomes) {
        if (state.halted) break;
        state = runner.assign(state, outcome.episodeHash, 0);
        state = runner.recordOutcome(state, outcome, 0);
      }
      finalState = state;
    }, 3);
    check(`B P=${P} loop completes`, finalState !== undefined && finalState.outcomes.length === A);
    // Exact rng-replay component for the same call pattern (index 0..A-1),
    // versus the closed form. The saving is exactly this delta because the
    // decision call is a pure leaf of the assign path.
    let sinkRef = 0;
    const tReplay = timeMs(() => {
      for (let k = 0; k < A; k++) sinkRef += refShadowValueAt(plan.randomization.seed, k);
    });
    let sinkClosed = 0;
    const tClosed = timeMs(() => {
      for (let k = 0; k < A; k++) sinkClosed += closedShadowValueAt(plan.randomization.seed, k);
    });
    check(`B P=${P} component sums agree`, sinkRef !== 0 && Math.abs(sinkRef - sinkClosed) < 1e-9 * Math.abs(sinkRef));
    const saved = tReplay - tClosed;
    out(
      `part B: P=${P} A=${A} full-experiment=${tProd.toFixed(2)}ms; rng-replay component=${tReplay.toFixed(3)}ms; ` +
      `closed-form=${tClosed.toFixed(3)}ms; saving=${saved.toFixed(3)}ms (${((saved / tProd) * 100).toFixed(2)}% of the run)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part C — S2-F-2 duplicate manifestHash share of replayPolicy        */
/* ------------------------------------------------------------------ */

const DUMMY_REQUEST: RouteRequest = {} as RouteRequest;

function makeManifest(n: number): { manifest: DatasetManifest; episodes: FrozenEpisode[] } {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) hashes.push(`h_${i.toString(36).padStart(10, "0")}`);
  const manifest: DatasetManifest = {
    manifestVersion: 1,
    datasetId: "ds_r2f",
    episodeHashes: hashes,
    exclusions: [],
    split: { train: [], eval: hashes },
    resourceVersions: { model: "m1" },
    environment: { os: "linux" },
    seed: 7,
    createdAt: "2026-08-24T00:00:00.000Z",
  };
  const episodes: FrozenEpisode[] = hashes.map((episodeHash) => ({
    episodeHash,
    request: DUMMY_REQUEST,
    role: "worker",
    featureVersion: "fv1",
    originalWorkspace: "/live/workspace",
  }));
  return { manifest, episodes };
}

const UNIFORM_POLICY: RoutingPolicy = {
  policyVersion: "p1",
  eligibleFor: () => ["m1", "m2", "m3", "m4", "m5"],
  propensityFor: () => 0.2,
  select: (_e, rng) => ["m1", "m2", "m3", "m4", "m5"][Math.floor(rng() * 5)] ?? "m1",
};

function partC(): void {
  for (const n of [100, 1000, 10000]) {
    const { manifest, episodes } = makeManifest(n);
    const tReplay = timeMs(() => {
      replayPolicy(manifest, episodes, UNIFORM_POLICY, "/replay/out");
    }, 3);
    let sink = "";
    const tMh = timeMs(() => {
      sink = manifestHash(manifest);
    }, 5);
    check(`C n=${n} manifestHash stable`, sink === manifestHash(manifest));
    out(
      `part C: N=${n} replayPolicy=${tReplay.toFixed(2)}ms; one manifestHash=${tMh.toFixed(3)}ms ` +
      `(duplicate share ${((tMh / tReplay) * 100).toFixed(1)}%)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part D — S2-F-3 dedupe: error equivalence fuzz + perf               */
/* ------------------------------------------------------------------ */

/** Candidate: dedupe workspaces before building the guard. */
function assertIsolatedOutputDedup(
  episodes: readonly FrozenEpisode[],
  outputRoot: string
): void {
  try {
    createIsolationGuard({
      readOnlyRoots: [...new Set(episodes.map((episode) => episode.originalWorkspace))],
      outputRoot,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError(`output root overlaps original workspace: ${detail}`);
  }
}

function runCatch(fn: () => void): { threw: boolean; message: string; cls: string } {
  try {
    fn();
    return { threw: false, message: "", cls: "" };
  } catch (error) {
    return {
      threw: true,
      message: error instanceof Error ? error.message : String(error),
      cls: error?.constructor?.name ?? "unknown",
    };
  }
}

function partD(): void {
  const rng = createSeededRng(0xf3f3);
  const pool = [
    "/live/a", "/live/b", "/live/c", "", "   ", "/replay/out/inner", "/replay",
    "/live/a", "/live/a/nested", "/other/ws",
  ];
  let fuzz = 0;
  for (let c = 0; c < 400; c++) {
    const n = 1 + Math.floor(rng() * 12);
    const episodes: FrozenEpisode[] = [];
    for (let i = 0; i < n; i++) {
      episodes.push({
        episodeHash: `h${i}`,
        request: DUMMY_REQUEST,
        role: "worker",
        featureVersion: "fv1",
        originalWorkspace: pool[Math.floor(rng() * pool.length)] ?? "/live/a",
      });
    }
    const outputRoot = rng() < 0.15 ? "/live/a/out" : "/replay/out";
    const a = runCatch(() => assertIsolatedOutput(episodes, outputRoot));
    const b = runCatch(() => assertIsolatedOutputDedup(episodes, outputRoot));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`D fuzz case ${c}`, false);
      return;
    }
    fuzz += 1;
  }
  check("D dedupe error equivalence", true);
  for (const n of [100, 1000, 10000]) {
    const episodes: FrozenEpisode[] = [];
    for (let i = 0; i < n; i++) {
      episodes.push({
        episodeHash: `h${i}`,
        request: DUMMY_REQUEST,
        role: "worker",
        featureVersion: "fv1",
        originalWorkspace: ["/live/a", "/live/b", "/live/c"][i % 3] ?? "/live/a",
      });
    }
    const tOrig = timeMs(() => assertIsolatedOutput(episodes, "/replay/out"), 3);
    const tDedup = timeMs(() => assertIsolatedOutputDedup(episodes, "/replay/out"), 3);
    out(
      `part D: N=${n} (3 unique roots) original=${tOrig.toFixed(2)}ms dedup=${tDedup.toFixed(2)}ms ` +
      `(saving ${(tOrig - tDedup).toFixed(2)}ms)`
    );
  }
  out(`part D: ${fuzz} fuzz cases — throw/no-throw, message, and error class identical`);
}

/* ------------------------------------------------------------------ */
/* Part E — S2-F-4 assign-path membership share                         */
/* ------------------------------------------------------------------ */

function partE(): void {
  for (const [P, A] of [[200, 100], [2000, 1000]] as const) {
    const plan = makeShadowPlan(P, A);
    const rng = createSeededRng(9);
    const queries: string[] = [];
    for (let k = 0; k < A; k++) {
      queries.push(plan.population[Math.floor(rng() * P)] ?? plan.population[0]!);
    }
    let hits = 0;
    const tIncludes = timeMs(() => {
      hits = 0;
      for (const q of queries) if (plan.population.includes(q)) hits += 1;
    });
    const populationSet = new Set(plan.population); // built by restore anyway
    let hits2 = 0;
    const tHas = timeMs(() => {
      hits2 = 0;
      for (const q of queries) if (populationSet.has(q)) hits2 += 1;
    });
    check(`E P=${P} membership agreement`, hits === A && hits2 === A);
    out(
      `part E: P=${P} A=${A} assign-path includes total=${tIncludes.toFixed(3)}ms vs reused-Set has=${tHas.toFixed(3)}ms ` +
      `(saving ${(tIncludes - tHas).toFixed(3)}ms per full experiment)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part F — S2-F-5 splitFromManifest double-validation share            */
/* ------------------------------------------------------------------ */

function makeSealed(n: number): { manifest: SealedDatasetManifest; episodes: SimulationHoldoutEpisode[] } {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) hashes.push(`s_${i.toString(36).padStart(10, "0")}`);
  const train = hashes.slice(0, n / 2);
  const validation = hashes.slice(n / 2, (n * 3) / 4);
  const holdout = hashes.slice((n * 3) / 4);
  const manifest: SealedDatasetManifest = {
    manifestVersion: 1,
    datasetId: "sd_r2f",
    episodeHashes: hashes,
    splits: { train, validation, holdout },
    exclusions: [],
    rotation: 0,
    previousHoldout: undefined,
    resourceVersions: { model: "m1", features: "f1" },
    createdAt: "2026-08-24T00:00:00.000Z" as SealedDatasetManifest["createdAt"],
  };
  const episodes: SimulationHoldoutEpisode[] = hashes.map((episodeHash, i) => ({
    episodeHash,
    taskFamily: "fam",
    role: "worker",
    request: DUMMY_REQUEST,
    taskSuccess: i % 2 === 0 ? "PASS" : "FAIL",
    observedModelId: "m1",
    observedModelVersion: "v1",
  }));
  return { manifest, episodes };
}

/** Verbatim private assertExplicitSplit (simulation-holdout.ts). */
function refAssertExplicitSplit(
  train: readonly SimulationHoldoutEpisode[],
  holdout: readonly SimulationHoldoutEpisode[]
): void {
  if (train.length === 0) throw new DomainValidationError("simulation holdout train split must not be empty");
  if (holdout.length === 0) throw new DomainValidationError("simulation holdout holdout split must not be empty");
  const trainHashes = new Set<string>();
  for (const episode of train) {
    if (episode.episodeHash.trim() === "") throw new DomainValidationError("train episode hash is required");
    if (trainHashes.has(episode.episodeHash)) throw new DomainValidationError(`duplicate train episode ${episode.episodeHash}`);
    trainHashes.add(episode.episodeHash);
  }
  for (const episode of holdout) {
    if (episode.episodeHash.trim() === "") throw new DomainValidationError("holdout episode hash is required");
    if (trainHashes.has(episode.episodeHash)) {
      throw new DomainValidationError(`contamination: episode ${episode.episodeHash} appears in train and holdout`);
    }
  }
}

function partF(): void {
  const wait: number[] = [];
  for (const n of [2000, 20000]) {
    const { manifest, episodes } = makeSealed(n);
    // Full private splitFromManifest path, mirrored verbatim.
    const tSplit = timeMs(() => {
      validateSealedDatasetManifest(manifest);
      const byHash = new Map<string, SimulationHoldoutEpisode>();
      for (const episode of episodes) {
        if (episode.episodeHash.trim() === "") throw new DomainValidationError("episodes episode hash is required");
        if (byHash.has(episode.episodeHash)) throw new DomainValidationError(`duplicate episode ${episode.episodeHash}`);
        byHash.set(episode.episodeHash, episode);
      }
      const train = manifest.splits.train.map((h) => byHash.get(h)!);
      const holdout = manifest.splits.holdout.map((h) => byHash.get(h)!);
      refAssertExplicitSplit(train, holdout);
    }, 3);
    const { manifest: m2, episodes: e2 } = makeSealed(n);
    const byHash = new Map<string, SimulationHoldoutEpisode>();
    for (const episode of e2) byHash.set(episode.episodeHash, episode);
    const train = m2.splits.train.map((h) => byHash.get(h)!);
    const holdout = m2.splits.holdout.map((h) => byHash.get(h)!);
    const tAssert = timeMs(() => refAssertExplicitSplit(train, holdout), 5);
    wait.push(tAssert);
    out(
      `part F: N=${n} splitFromManifest path=${tSplit.toFixed(2)}ms; trailing assertExplicitSplit=${tAssert.toFixed(3)}ms ` +
      `(defense-in-depth share ${((tAssert / tSplit) * 100).toFixed(1)}%)`
    );
  }
  check("F measured", wait.length === 2);
}

/* ------------------------------------------------------------------ */
/* Part G — S2-F-6 pairedEvaluationCard multi-pass share                */
/* ------------------------------------------------------------------ */

function partG(): void {
  for (const n of [40, 1000]) {
    const rng = createSeededRng(11);
    const records: PairedEvaluationRecord[] = [];
    for (let i = 0; i < n; i++) {
      records.push({
        episodeHash: `pe_${i}`,
        taskFamily: `fam${i % 4}`,
        baselineUtility: rng() * 2 - 1,
        candidateUtility: rng() * 2 - 1,
        baselineCostUsd: rng(),
        candidateCostUsd: rng(),
      });
    }
    const tCard = timeMs(() => pairedEvaluationCard(records, "tier1"), 5);
    out(`part G: N=${n} pairedEvaluationCard (4 maps + duplicate means)=${tCard.toFixed(3)}ms total`);
  }
  check("G measured", true);
}

partA();
partB();
partC();
partD();
partE();
partF();
partG();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

仿真原始输出：

```
part A: 58950 (seed,index) pairs bitwise-identical (Object.is on the raw double)
part B: P=200 A=100 full-experiment=2.98ms; rng-replay component=0.032ms; closed-form=0.003ms; saving=0.029ms (0.96% of the run)
part B: P=2000 A=1000 full-experiment=291.15ms; rng-replay component=3.011ms; closed-form=0.032ms; saving=2.979ms (1.02% of the run)
part C: N=100 replayPolicy=1.14ms; one manifestHash=0.031ms (duplicate share 2.7%)
part C: N=1000 replayPolicy=8.18ms; one manifestHash=0.230ms (duplicate share 2.8%)
part C: N=10000 replayPolicy=76.77ms; one manifestHash=2.390ms (duplicate share 3.1%)
part D: N=100 (3 unique roots) original=0.09ms dedup=0.00ms (saving 0.09ms)
part D: N=1000 (3 unique roots) original=0.92ms dedup=0.02ms (saving 0.90ms)
part D: N=10000 (3 unique roots) original=7.98ms dedup=0.11ms (saving 7.86ms)
part D: 400 fuzz cases — throw/no-throw, message, and error class identical
part E: P=200 A=100 assign-path includes total=0.030ms vs reused-Set has=0.005ms (saving 0.025ms per full experiment)
part E: P=2000 A=1000 assign-path includes total=2.452ms vs reused-Set has=0.054ms (saving 2.398ms per full experiment)
part F: N=2000 splitFromManifest path=0.99ms; trailing assertExplicitSplit=0.120ms (defense-in-depth share 12.1%)
part F: N=20000 splitFromManifest path=10.00ms; trailing assertExplicitSplit=0.864ms (defense-in-depth share 8.6%)
part G: N=40 pairedEvaluationCard (4 maps + duplicate means)=0.013ms total
part G: N=1000 pairedEvaluationCard (4 maps + duplicate means)=0.175ms total

total: 13 checks, 0 failures
```

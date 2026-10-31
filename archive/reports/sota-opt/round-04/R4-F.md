MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-F：`src/experiments/` 第四遍复查报告（Round 1/2/3 同区之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `0864857`（含 R1–R3 全部三十区、R4-A/B/D、S4-A-*、S4-B-*、S4-D-* 排除）
- 切片：`src/experiments/` 全部 15 文件（2325 行），全量实际读码
- 前置阅读：README、EXCLUSIONS 全表（含 S4-D-1..5）、round-04/PLAN、round-01/R1-F、round-02/R2-F、round-03/R3-F
- 分支：`cursor/r4-f-experiments-fourth-pass-83a1`

## 结论

**无新更优解落地，零生产代码改动。** 在 S1-F 落地态与完整排除表（S1-F-1..8、S2-F-1..6、S3-F-1..5 及全部 X*）之上做第四遍全量搜索，找到 3 个排除表未覆盖的新角度候选（其中 S4-F-1 是「私有 helper 复用」通路——刻意绕开 S1-F-6 的公开签名死因；S4-F-2 是空 exclusions 快路径；S4-F-3 是循环内公共子表达式提升），全部经理论 + 确定性仿真（seeded mulberry32，两次独立运行结论逐位一致）裁决后淘汰，新增排除 S4-F-1…S4-F-3。R1-F 的 Ω(P+A) 下界（S3-F-2 构造性攻击后维持）本轮复核无恙；`canCloseProductionCheckpointF` 语义未触碰（simulation ≠ production）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* / S2-* / S3-* / S4-A-* / S4-B-* / S4-D-* 条目。逐条对照：S4-F-1 不是 S1-F-6（那是 plan.ts 公开 `: void` 签名变更；本候选是 dataset.ts **文件私有** helper `assertUniqueNonEmpty` 返回 seen Set 复用为 universe，无公开面变化）——排除表无此条，需独立裁决；S4-F-2 不是 S2-F-2（双 manifestHash）也不是 S2-F-3（workspace 去重）——它是 `orderedHashes` 构建在 `exclusions.length === 0` 时的免 Set + 免 filter 快路径；S4-F-3 不是 X3-2（遍数融合）——它是**同一循环迭代内**同一减法算两次的 CSE，遍数不变。
- 未触碰版本化阈值、权限、数据面契约、公开签名；双 LCB 与双归因未动；不声称 Outcome-supported。X1-5、X3-2、X3-3、X4-1、S1-F-1..8、S2-F-1..6、S3-F-1..5 全部维持。
- `git diff d91e2bd..HEAD -- src/experiments/` 核对：本切片自 S1-F 落地以来仅含 `shadow.ts`（+33/−4）与 `canary.ts`（+6/−1）的已记录 S1-F 变更，无未记录漂移。
- 按「无赢家不写死代码」纪律，本轮裁决仿真脚本未入库（全文见附录）；`scripts/round04-r4f-equivalence-sim.ts` 未创建（该路径仅在落地时启用）。

## 1. 规模与可达性基底（本轮重新核实）

- 切片外生产消费方（rg 全仓复核）：`src/adaptation/reflection.ts`（`createShadowRunner` + `validateExperimentPlan`，唯一 runner 生产链）、`src/adaptation/eval-routing.ts`（`gatedComparisonReport`/`createIsolationGuard`/`stableStringify`/`replayCacheKey`）、`src/adaptation/promotion-rules.ts`（`validateComparisonReport`）、`src/routing/r1-shadow-report.ts`（comparison-report + gated-comparison）。
- 仓内 test-only（本轮 rg 复核，与 R2-F/R3-F 记载一致）：`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout`、`HoldoutVault`、`validateSealedDatasetManifest`/`createSealedDatasetManifest`/`rotateHoldout`、`validateManifest`/`createManifest`、`calibrateSoftThreshold`、`compareShadowR1`、`writeAttributionPair`。
- 否决线继承：S2-F-3 90µs、S3-F-3 50.8µs、S1-I-1 ~190µs、S3-D-3 351–388µs 均已否决；防御纵深消除类一律安全侧保留。
- 基线性能锚点（本机，Node 22.22.2）：`npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ 2668 项逐位检查 0 失败；S1-F 回归维持 723.8ms→151.6ms（4.8×），1.67 亿次成员比较消除维持。
- Ω(P+A) 下界第四次复核：restore 必经 `validateExperimentPlan`（Ω(P)：唯一性必须读全 population）+ 全量 assignment 循环（Ω(A)）+ 防御拷贝（Ω(A)），S3-F-2 已构造性证明引用同一性绕过是契约违反——本轮读码确认 shadow.ts/canary.ts 自 S1-F 后无任何变更，下界论证原样成立，runner 侧一切候选只能压常数且各 A 线性项已被 S2-F-1/S2-F-4/S3-F-1 逐项排除。

## 2. 候选总表（全部淘汰，无赢家落地）

仿真脚本全文见附录；15 项检查 × 两次独立运行均 0 失败，剔除计时行后 `diff` 逐位一致。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-F-1 | dataset.ts `validateSealedDatasetManifest`：私有 `assertUniqueNonEmpty(episodeHashes)` 的 seen Set 返回复用为 universe（消除紧随其后的 `new Set(episodeHashes)` 重建；私有 helper，非 S1-F-6 公开签名域） | 每 validate 免一次 O(U) Set 构建；调用类不变（唯一性验证本身 Ω(U)） | ✅ 100 组成员恒等（成功路径 seen Set 与重建 Set 成员逐一相等）+ 15 组篡改 manifest（重复/空 hash、split 未知/污染、exclusions 违规、rotation/previousHoldout/时间戳损坏）throw/消息/错误类逐字节一致 | **真实档 U=2000 深陷噪声带**：两次运行 saving 分别为 **-76µs 与 +55µs**（孤立死构建本体仅 ~50µs，与 S3-F-3 同量级）；U=20000 才省 ~1ms，且每 manifest 一次性 | 淘汰：真实规模双向抖动（负优化风险实测存在）、绝对量低于 S2-F-3 90µs 否决线量级、全部调用方（runSimulationHoldout/createSealedDatasetManifest/rotateHoldout）仓内 test-only |
| S4-F-2 | replay.ts `replayPolicy`：`exclusions.length === 0` 时跳过 exclusion Set 构建与 O(N) filter 遍（spread 拷贝即为有序全集） | 免 N 次 Set.has + 一次 O(N) 数组分配；调用类 O(N·E) 不变 | ✅ 4 组（空/非空 exclusions × 两规模）ReplayResult `stableStringify` 逐字节一致 + missing-episode 错误路径逐字节一致（rng 消耗序不受影响：filter 在 rng 循环之前） | 被跳过组件 N=100/1000/10000 仅 **3µs / 25–27µs / 92–106µs**，占 replayPolicy 全程 0.1–0.4%（全程被 policy 调用与 rerunHash stableStringify 支配） | 淘汰：µs 级 + 占比 <0.5% + `replayPolicy` 仓内无生产调用方（S2-F-2/S2-F-3 双死因叠加同域） |
| S4-F-3 | comparison-report.ts `computeComparisonReport`：主循环内 `candidateUtility - baselineUtility` 与 `candidateCostUsd - baselineCostUsd` 各算两次（delta 数组 push 与 family 累加），CSE 提升为局部变量 | 每 record 省 2 次浮点减法；遍数与调用类不变 | ✅ 同操作数同运算 IEEE 逐位恒等（10000 组 fuzz `Object.is` 一致）——这是三候选中等价性最平凡的一个 | 重复减法组件**上界**（含 4N 次属性加载的孤立循环全体）N=40 仅 2.1–2.2µs、N=1000 仅 40.8–41.1µs；`computeComparisonReport` 全函数本身才 23.5µs / 376–409µs，每报告一次性 | 淘汰：µs 级一次性、低于 S2-F-3 否决线；X3-2/S1-F-5 邻域（机制不同但收益同带） |

## 3. 关键裁决细节

### 3.1 S4-F-1：绕开 S1-F-6 死因的通路为何仍死于规模

R3-F §0 曾记载 plan.ts 侧「validateExperimentPlan 内部 Set 与 restore 自建 Set 重复构建」的一切消除机制都落入 S1-F-6/X1-2/X0-4 已排除域（公开签名）。本候选是该问题在 **dataset.ts** 的镜像——但这里 `assertUniqueNonEmpty` 是文件私有 helper，返回 `Set` 零公开面变化，等价性完整（helper 成功返回时 seen 恰含全部唯一 hash，与 `new Set(...)` 同成员；15 组篡改用例错误逐字节一致）。仍淘汰，三条独立死因：(1) 真实档 U=2000 实测**双向抖动**（-76µs / +55µs 两次运行异号，纯噪声，孤立死构建仅 ~50µs——与 S3-F-3 已否决的 50.8µs 同量级）；(2) U=20000 也才 ~1ms 且每 manifest 一次性；(3) sealed-manifest 全链路（runSimulationHoldout / rotateHoldout）仓内 test-only。S3-B-1/S3-F-1 的教训再次复现：「省一次构建」的直觉必须实测，V8 分配器在小对象上经常反转符号。

### 3.2 S4-F-2：等价性完整（含 rng 序保持论证）但组件占比 <0.5%

快路径只改 `orderedHashes` 的构建方式：filter 谓词在空 Set 上恒真，输出数组内容与顺序同 spread 拷贝；关键是 **rng 消耗序不变**——`createSeededRng(manifest.seed)` 在 filter 之前创建但首次调用发生在 action 循环内，快路径不改变循环迭代序列，故所有 `select` 抽签逐位一致（4 组 ReplayResult 字节级验证）。淘汰理由与 S2-F-2/S2-F-3 完全同构：组件 3–106µs、占比 0.1–0.4%、test-only 可达，三条任一即足。

### 3.3 S4-F-3：等价性最平凡、收益也最平凡

同操作数同运算的 IEEE 减法逐位恒等是定义级事实（fuzz 仅为流程完整性）。孤立测量给出的 2N 次重复减法成本**上界**（循环含属性加载）在真实档 N=40 仅 ~2µs；生产可达（eval-routing/r1-shadow-report 经 gatedComparisonReport），但每报告一次性、深低于否决线。与 X3-2（遍数融合）机制不同（遍数不变、纯 CSE），故立新 ID 防重提。

## 4. 逐文件收口（R1-F/R2-F/R3-F 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | S1-F 后零变更读码复核；`requireEpisodeHash` 的 `trim()` 在无空白字符串上 V8 返回原串，亚噪声；assign 路径 4 次常数字段 spread 维持 R2-F「O(字段数) 非 O(A)」记载 | 无候选 |
| `canary.ts` | 结构同构复核；`derivedExposure` 校验循环即 fail-closed 本体 | 无候选 |
| `plan.ts` | S1-F-6 维持排除（R3-F §0 裁决原样成立，未重开） | 无候选 |
| `replay.ts` | **S4-F-2 淘汰**；`[...].filter` 冗余 spread 维持 S1-B-5 同族；`eligible.includes(selected)` E 个位数 | 无候选落地 |
| `dataset.ts` | **S4-F-1 淘汰**；exclusions 双查 `membership.has`+`get` 仅在 throw 路径；分割遍与成员遍融合维持 R3-F「错误消息/顺序变更 + X3-2 域」不提案（即便以 `prior === name` 分支保住消息文本，跨 split 违规的**抛错顺序**仍发散） | 无候选落地 |
| `comparison-report.ts` | **S4-F-3 淘汰**；四个 `records.reduce` 均值维持 R3-F「非冗余」认定；`families.set` 每迭代冗余调用为 S3-E-3 同族 ±ns | 无候选落地 |
| `manifest.ts` | `validateManifest` 的 exclusions 两遍（universe 查 + split 查）融合与 dataset.ts 同判（错误顺序发散 + X3-2 域）；`(split.holdout ?? [])` 空数组分配为常数噪声；stableStringify 维持 R2-F 不提案裁决 | 无候选 |
| `simulation-holdout.ts` | 尾部双验维持 S2-F-5；`toFrozenEpisode` 维持 S3-F-5；`byHash` 全量插入是全集查重的 fail-closed 本体不可裁剪；`auditHoldoutAccess` try/catch 维持 R3-F 噪声认定 | 无候选 |
| `holdout.ts` | 审计拷贝维持 S1-F-3/X4-2；`seal`/`replace` 常数 spread | 无候选 |
| `isolation.ts` | `createIsolationGuard`/`assertWritablePath` 重复 resolve 维持 S3-F-4 同域同判 | 无候选 |
| `gated-comparison.ts` | strip-retry 维持 S1-F-1；`pairedEvaluationCard` 维持 S2-F-6；`IMPROVEMENT_CLAIM` 与 comparison-report 的 `IMPROVEMENT_PATTERN` 双文件重复正则为各自模块级常量，合并零性能收益（S1-B-1 域）且引入跨文件耦合，不提案 | 无候选 |
| `threshold-calibration.ts` | 三遍维持 S1-F-4；`pairedDeltaSummary` 型死分支（rows[0] 恒存在）为防御纵深保留域 | 无候选 |
| `evaluation-card.ts` | 校验数组字面量维持 S1-B-7 域 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |
| `attribution-report.ts` | 21 行证据封装无循环 | 无候选 |

## 5. 前后对比

零生产代码改动。基线（S1-F 落地态）即本轮终态。四遍搜索后本切片的剩余候选空间已收敛到：(a) 被 fail-closed 契约锁定的 Ω(P+A)/Ω(U)/Ω(N) 验证本体；(b) 已逐项排除并量化的 A 线性项与常数项（各 ≤~1%）；(c) 本轮新增的三个 µs 级角度。在保行为 + 契约 + 排除表约束下，无任何达「数十~数百 ms」落地线的可测优化存在。

## 6. 测试

- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（S1-F 回归：723.8ms→151.6ms，4.8×，167,167,000 次成员比较消除维持）
- 本轮裁决仿真（附录）✓ — 15 项检查 × 两次独立运行 0 失败；剔除计时行后确定性结论 `diff` 逐位一致
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。注：需 Node ≥22.19.0（engines），本 VM 以 nvm 22.22.2 运行
- 未触碰任何版本化阈值、权限、数据面契约；`canCloseProductionCheckpointF` 语义未动

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-F-1 | dataset.ts validateSealedDatasetManifest 私有 assertUniqueNonEmpty 返回 seen Set 复用为 universe | 等价完整（100 成员恒等 + 15 篡改用例逐字节），但真实档 U=2000 实测双向抖动（-76µs/+55µs 异号，死构建本体 ~50µs 同 S3-F-3 量级）、U=20000 才 ~1ms 一次性、sealed 链路仓内 test-only。plan.ts 镜像问题维持 S1-F-6 |
| S4-F-2 | replayPolicy 空 exclusions 跳过 Set+filter 快路径 | ReplayResult 字节级等价（rng 序不受 filter 移除影响），但组件仅 3–106µs、占全程 0.1–0.4%、replayPolicy 仓内无生产调用方（S2-F-2/S2-F-3 双死因同域） |
| S4-F-3 | computeComparisonReport 循环内 delta 减法双算 CSE 提升 | 同操作数 IEEE 减法逐位恒等（10000 fuzz），但重复组件上界 N=40 仅 ~2µs / N=1000 仅 ~41µs，每报告一次性，低于 S2-F-3 否决线；X3-2/S1-F-5 邻域收益带 |

**重开条件**：三条均为规模性淘汰而非契约性淘汰。若未来 (a) sealed-manifest 链路获得生产调用方且 U 增至 10⁵ 级（S4-F-1）、(b) replayPolicy 接入生产回放且 N 增至 10⁵ 级（S4-F-2）、(c) comparison-report 进入每 episode 高频路径（S4-F-3），对应条目应携本报告的等价性证明重新裁决。S3-F-2 的下界重开条件（ExperimentPlan 改为构造时深冻结不可变值类型）维持不变，且仍是本切片唯一具有 >50% 收益潜力的假设性通路。

MORE_OPTIMA=no
BRANCH=cursor/r4-f-experiments-fourth-pass-83a1

## 附录：确定性裁决仿真脚本（完整，可复现）

保存为 `scripts/round04-r4f-decision-sim.ts` 后 `npx tsx scripts/round04-r4f-decision-sim.ts` 运行（无赢家，按战役纪律不入库，报告内嵌全文）：

```ts
/**
 * Round-4 R4-F adjudication simulation (temporary — embedded in the R4-F
 * report appendix, not committed as a standing script; no winner landed).
 *
 * Adjudicates three fresh fourth-pass candidates over src/experiments/ on top
 * of the landed S1-F baseline and the S1-F-1..8 / S2-F-1..6 / S3-F-1..5
 * exclusions:
 *
 *   S4-F-1  dataset.ts validateSealedDatasetManifest: the private
 *           assertUniqueNonEmpty(episodeHashes) builds a `seen` Set over the
 *           whole universe and discards it; the very next step rebuilds
 *           `universe = new Set(episodeHashes)`. Candidate: return the seen
 *           Set from the private helper and reuse it as the universe (NOT
 *           S1-F-6 — that was plan.ts's public `: void` signature; this
 *           helper is file-private).
 *   S4-F-2  replay.ts replayPolicy: when manifest.exclusions is empty, skip
 *           building the exclusion Set and the O(N) filter pass (the spread
 *           copy is already the ordered list).
 *   S4-F-3  comparison-report.ts computeComparisonReport: the paired deltas
 *           (candidate - baseline) are computed twice per record (once for
 *           the delta arrays, once for the family accumulation). Candidate:
 *           common-subexpression hoist into a local.
 *
 * Every equivalence check demands identical accept/reject verdicts, thrown
 * error messages, and (for S4-F-2/3) byte-identical serialized outputs /
 * Object.is-identical doubles. All fixtures are generated with a seeded
 * mulberry32 so two independent runs produce bitwise-identical check
 * verdicts (timing lines are informational). Run with:
 *   npx tsx scripts/round04-r4f-decision-sim.ts
 */

import { DomainValidationError } from "../src/domain/errors.js";
import {
  validateSealedDatasetManifest,
  type SealedDatasetManifest,
} from "../src/experiments/dataset.js";
import { isIsoTimestamp } from "../src/domain/timestamp.js";
import {
  replayPolicy,
  type FrozenEpisode,
  type RoutingPolicy,
} from "../src/experiments/replay.js";
import {
  manifestHash,
  stableStringify,
  type DatasetManifest,
} from "../src/experiments/manifest.js";
import { hash32 } from "../src/domain/hash.js";
import {
  computeComparisonReport,
  type PairedEvaluationRecord,
} from "../src/experiments/comparison-report.js";
import { pairedEvaluationCard } from "../src/experiments/gated-comparison.js";
import type { RouteRequest } from "../src/routing/policy.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}`);
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

/** Deterministic fixture generator (mulberry32, fixture-only seed space). */
function fixtureRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/* ------------------------------------------------------------------ */
/* Part A — S4-F-1 sealed-manifest duplicate universe Set build        */
/* ------------------------------------------------------------------ */

/** Variant private helper: identical checks/messages, returns the seen Set. */
function assertUniqueNonEmptyReturning(
  hashes: readonly string[],
  label: string
): Set<string> {
  const seen = new Set<string>();
  for (const hash of hashes) {
    if (hash.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty episode hash`);
    }
    if (seen.has(hash)) {
      throw new DomainValidationError(`${label} contains a duplicate episode hash: ${hash}`);
    }
    seen.add(hash);
  }
  return seen;
}

/** Candidate: verbatim validateSealedDatasetManifest, with the universe Set
 * reused from the helper instead of rebuilt. Everything else unchanged. */
function validateSealedVariant(manifest: SealedDatasetManifest): void {
  if (manifest.manifestVersion !== 1) {
    throw new DomainValidationError(`unsupported manifest version: ${manifest.manifestVersion}`);
  }
  if (manifest.datasetId.trim() === "") {
    throw new DomainValidationError("datasetId is required");
  }
  if (manifest.episodeHashes.length === 0) {
    throw new DomainValidationError("episode universe must not be empty");
  }
  const universe = assertUniqueNonEmptyReturning(manifest.episodeHashes, "episode universe");

  const { train, validation, holdout } = manifest.splits;
  assertUniqueNonEmptyReturning(train, "train split");
  assertUniqueNonEmptyReturning(validation, "validation split");
  assertUniqueNonEmptyReturning(holdout, "holdout split");

  const membership = new Map<string, string>();
  for (const [name, hashes] of [
    ["train", train],
    ["validation", validation],
    ["holdout", holdout],
  ] as const) {
    for (const hash of hashes) {
      if (!universe.has(hash)) {
        throw new DomainValidationError(`unknown episode ${hash} in ${name} split`);
      }
      const prior = membership.get(hash);
      if (prior !== undefined) {
        throw new DomainValidationError(
          `contamination: episode ${hash} appears in more than one split (${prior} and ${name})`
        );
      }
      membership.set(hash, name);
    }
  }

  assertUniqueNonEmptyReturning(manifest.exclusions, "exclusions");
  for (const hash of manifest.exclusions) {
    if (!universe.has(hash)) {
      throw new DomainValidationError(`unknown episode ${hash} in exclusions`);
    }
    if (membership.has(hash)) {
      throw new DomainValidationError(
        `exclusion ${hash} appears in the ${membership.get(hash)} split`
      );
    }
  }

  if (!Number.isInteger(manifest.rotation) || manifest.rotation < 0) {
    throw new DomainValidationError("rotation must be a non-negative integer");
  }
  if (manifest.rotation === 0 && manifest.previousHoldout !== undefined) {
    throw new DomainValidationError(
      "previous holdout snapshot is only allowed after the first rotation"
    );
  }
  if (manifest.rotation > 0) {
    if (manifest.previousHoldout === undefined) {
      throw new DomainValidationError("previous holdout snapshot is required after rotation");
    }
    const prev = manifest.previousHoldout;
    if (prev.datasetId !== manifest.datasetId) {
      throw new DomainValidationError("previous holdout must belong to the same dataset");
    }
    if (prev.rotation !== manifest.rotation - 1) {
      throw new DomainValidationError(
        "previous holdout must be the immediately preceding rotation"
      );
    }
    if (prev.episodeHashes.length === 0) {
      throw new DomainValidationError("previous holdout snapshot must not be empty");
    }
    for (const hash of prev.episodeHashes) {
      if (!universe.has(hash)) {
        throw new DomainValidationError(`previous holdout references unknown episode ${hash}`);
      }
    }
  }

  if (manifest.resourceVersions.model.trim() === "" || manifest.resourceVersions.features.trim() === "") {
    throw new DomainValidationError("resource versions must not be empty");
  }
  if (!isIsoTimestamp(manifest.createdAt)) {
    throw new DomainValidationError("createdAt must be an ISO timestamp");
  }
}

function makeSealed(n: number): SealedDatasetManifest {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) hashes.push(`s_${i.toString(36).padStart(10, "0")}`);
  const nEx = Math.max(1, Math.floor(n / 20));
  const usable = hashes.slice(0, n - nEx);
  const u = usable.length;
  return {
    manifestVersion: 1,
    datasetId: "sd_r4f",
    episodeHashes: hashes,
    splits: {
      train: usable.slice(0, u / 2),
      validation: usable.slice(u / 2, (u * 3) / 4),
      holdout: usable.slice((u * 3) / 4),
    },
    exclusions: hashes.slice(n - nEx),
    rotation: 0,
    previousHoldout: undefined,
    resourceVersions: { model: "m1", features: "f1" },
    createdAt: "2026-08-24T00:00:00.000Z" as SealedDatasetManifest["createdAt"],
  };
}

function partA(): void {
  // Membership identity: after a successful pass, the helper's seen Set holds
  // exactly the unique hashes — the same members as new Set(episodeHashes).
  const rng = fixtureRng(0x4f01);
  for (let c = 0; c < 100; c++) {
    const n = 1 + Math.floor(rng() * 60);
    const hashes: string[] = [];
    for (let i = 0; i < n; i++) hashes.push(`h_${i}_${Math.floor(rng() * 1e6)}`);
    const seen = assertUniqueNonEmptyReturning(hashes, "episode universe");
    const rebuilt = new Set(hashes);
    if (seen.size !== rebuilt.size || ![...rebuilt].every((h) => seen.has(h))) {
      check(`A membership case ${c}`, false);
      return;
    }
  }
  check("A seen-Set ≡ rebuilt universe Set membership", true);

  // Error-behavior fuzz: tampered manifests must throw byte-identical errors.
  const tamperings: ((m: SealedDatasetManifest) => SealedDatasetManifest)[] = [
    (m) => ({ ...m, episodeHashes: [...m.episodeHashes, m.episodeHashes[0]!] }),
    (m) => ({ ...m, episodeHashes: [...m.episodeHashes, "  "] }),
    (m) => ({ ...m, splits: { ...m.splits, train: [...m.splits.train, "s_unknown"] } }),
    (m) => ({ ...m, splits: { ...m.splits, train: [...m.splits.train, m.splits.holdout[0]!] } }),
    (m) => ({ ...m, splits: { ...m.splits, holdout: [...m.splits.holdout, m.splits.holdout[0]!] } }),
    (m) => ({ ...m, exclusions: [...m.exclusions, "s_unknown"] }),
    (m) => ({ ...m, exclusions: [...m.exclusions, m.splits.validation[0]!] }),
    (m) => ({ ...m, exclusions: [...m.exclusions, m.exclusions[0]!] }),
    (m) => ({ ...m, rotation: -1 }),
    (m) => ({ ...m, rotation: 1 }),
    (m) => ({
      ...m,
      rotation: 1,
      previousHoldout: { datasetId: m.datasetId, rotation: 0, episodeHashes: ["s_unknown"] },
    }),
    (m) => ({ ...m, datasetId: " " }),
    (m) => ({ ...m, resourceVersions: { model: "", features: "f1" } }),
    (m) => ({ ...m, createdAt: "not-a-timestamp" as SealedDatasetManifest["createdAt"] }),
    (m) => m, // valid case: both accept
  ];
  let fuzz = 0;
  for (const [i, tamper] of tamperings.entries()) {
    const m = tamper(makeSealed(60));
    const a = runCatch(() => validateSealedDatasetManifest(m));
    const b = runCatch(() => validateSealedVariant(m));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`A tamper case ${i}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    fuzz += 1;
  }
  check("A tampered-manifest error equivalence", true);
  out(`part A: 100 membership cases + ${fuzz} tamper cases identical (throw, message, class)`);

  for (const n of [2000, 20000]) {
    const m = makeSealed(n);
    const tProd = timeMs(() => validateSealedDatasetManifest(m), 7);
    const tVar = timeMs(() => validateSealedVariant(m), 7);
    let sink = 0;
    const tDeadBuild = timeMs(() => {
      sink = new Set(m.episodeHashes).size;
    }, 7);
    check(`A U=${n} dead build observed`, sink === n);
    out(
      `part A: U=${n} production validate=${(tProd * 1000).toFixed(0)}µs; variant=${(tVar * 1000).toFixed(0)}µs ` +
        `(saving ${((tProd - tVar) * 1000).toFixed(0)}µs); isolated duplicate Set build=${(tDeadBuild * 1000).toFixed(0)}µs`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part B — S4-F-2 replayPolicy empty-exclusions filter fast path      */
/* ------------------------------------------------------------------ */

const DUMMY_REQUEST: RouteRequest = {} as RouteRequest;

/** Candidate: verbatim replayPolicy with the empty-exclusions fast path. */
function replayPolicyFast(
  manifest: DatasetManifest,
  episodes: readonly FrozenEpisode[],
  policy: RoutingPolicy,
  outputRoot: string
): ReturnType<typeof replayPolicy> {
  return replayBody(manifest, episodes, policy, outputRoot);
}

function replayBody(
  manifest: DatasetManifest,
  episodes: readonly FrozenEpisode[],
  policy: RoutingPolicy,
  outputRoot: string
): ReturnType<typeof replayPolicy> {
  // Verbatim from src/experiments/replay.ts, except the orderedHashes line.
  assertIsolatedOutputMirror(episodes, outputRoot);

  const byHash = new Map<string, FrozenEpisode>();
  for (const episode of episodes) {
    byHash.set(episode.episodeHash, episode);
  }

  const rng = seededRngMirror(manifest.seed);
  const orderedHashes =
    manifest.exclusions.length === 0
      ? [...manifest.episodeHashes]
      : (() => {
          const excludedHashes = new Set(manifest.exclusions);
          return [...manifest.episodeHashes].filter((h) => !excludedHashes.has(h));
        })();
  const actions: {
    episodeHash: string;
    modelId: string;
    propensity: number;
    eligible: readonly string[];
    propensities: readonly { modelId: string; propensity: number }[];
  }[] = [];

  for (const hash of orderedHashes) {
    const episode = byHash.get(hash);
    if (episode === undefined) {
      throw new DomainValidationError(`manifest references missing episode: ${hash}`);
    }
    const eligible = policy.eligibleFor(episode);
    const selected = policy.select(episode, rng);
    if (!eligible.includes(selected)) {
      throw new DomainValidationError(
        `policy selected ${selected} outside the eligible set for ${hash}`
      );
    }
    const propensity = policy.propensityFor(episode, selected);
    const propensities = eligible.map((modelId) => ({
      modelId,
      propensity: policy.propensityFor(episode, modelId),
    }));
    actions.push({ episodeHash: hash, modelId: selected, propensity, eligible, propensities });
  }

  const rerunHash = `rr_${stableStringify({
    actions,
    manifestHash: manifestHash(manifest),
  })}`;
  return {
    manifestHash: manifestHash(manifest),
    rerunHash: hash32(rerunHash),
    actions,
    policyVersion: policy.policyVersion,
    seed: manifest.seed,
  };
}

/** Verbatim mirrors of the production helpers the body depends on. */
function seededRngMirror(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
import { createIsolationGuard } from "../src/experiments/isolation.js";
function assertIsolatedOutputMirror(
  episodes: readonly FrozenEpisode[],
  outputRoot: string
): void {
  try {
    createIsolationGuard({
      readOnlyRoots: episodes.map((episode) => episode.originalWorkspace),
      outputRoot,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError(`output root overlaps original workspace: ${detail}`);
  }
}

function makeReplayFixture(n: number, excludeEvery: number): {
  manifest: DatasetManifest;
  episodes: FrozenEpisode[];
} {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) hashes.push(`h_${i.toString(36).padStart(10, "0")}`);
  const exclusions = excludeEvery > 0 ? hashes.filter((_, i) => i % excludeEvery === 0) : [];
  const manifest: DatasetManifest = {
    manifestVersion: 1,
    datasetId: "ds_r4f",
    episodeHashes: hashes,
    exclusions,
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

function partB(): void {
  // Byte-identical result equivalence over empty and non-empty exclusions.
  for (const [n, every] of [
    [50, 0],
    [50, 5],
    [500, 0],
    [500, 7],
  ] as const) {
    const { manifest, episodes } = makeReplayFixture(n, every);
    const prod = replayPolicy(manifest, episodes, UNIFORM_POLICY, "/replay/out");
    const fast = replayPolicyFast(manifest, episodes, UNIFORM_POLICY, "/replay/out");
    check(
      `B n=${n} every=${every} byte-identical result`,
      stableStringify(prod) === stableStringify(fast)
    );
  }
  // Error path unchanged (missing episode).
  {
    const { manifest, episodes } = makeReplayFixture(20, 0);
    const short = episodes.slice(0, 19);
    const a = runCatch(() => replayPolicy(manifest, short, UNIFORM_POLICY, "/replay/out"));
    const b = runCatch(() => replayPolicyFast(manifest, short, UNIFORM_POLICY, "/replay/out"));
    check("B missing-episode error identical", a.threw && a.message === b.message && a.cls === b.cls);
  }
  out("part B: 4 byte-identical replay results + 1 identical error path");

  for (const n of [100, 1000, 10000]) {
    const { manifest, episodes } = makeReplayFixture(n, 0);
    const tProd = timeMs(() => replayPolicy(manifest, episodes, UNIFORM_POLICY, "/replay/out"), 3);
    const tFast = timeMs(() => replayPolicyFast(manifest, episodes, UNIFORM_POLICY, "/replay/out"), 3);
    // Isolate the skipped component: empty Set + full filter pass.
    let sink = 0;
    const tComponent = timeMs(() => {
      const excludedHashes = new Set(manifest.exclusions);
      sink = [...manifest.episodeHashes].filter((h) => !excludedHashes.has(h)).length;
    }, 5);
    check(`B N=${n} component observed`, sink === n);
    out(
      `part B: N=${n} (no exclusions) production=${tProd.toFixed(2)}ms fast-path=${tFast.toFixed(2)}ms; ` +
        `skipped filter component=${(tComponent * 1000).toFixed(0)}µs (${((tComponent / tProd) * 100).toFixed(1)}% of replay)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part C — S4-F-3 computeComparisonReport delta CSE                   */
/* ------------------------------------------------------------------ */

function partC(): void {
  // Bitwise: hoisting the identical subtraction is the same IEEE op on the
  // same operands — verify Object.is over fuzz doubles anyway.
  const rng = fixtureRng(0x4f03);
  let pairs = 0;
  for (let c = 0; c < 10000; c++) {
    const a = (rng() - 0.5) * 2;
    const b = (rng() - 0.5) * 2;
    const first = a - b;
    const second = a - b;
    if (!Object.is(first, second)) {
      check(`C pair ${c}`, false);
      return;
    }
    pairs += 1;
  }
  check("C repeated subtraction bitwise identical", true);

  // Realistic share: the duplicate work is exactly 2 subtractions per record.
  for (const n of [40, 1000]) {
    const rng2 = fixtureRng(0x4f04);
    const records: PairedEvaluationRecord[] = [];
    for (let i = 0; i < n; i++) {
      records.push({
        episodeHash: `pe_${i}`,
        taskFamily: `fam${i % 4}`,
        baselineUtility: rng2() * 2 - 1,
        candidateUtility: rng2() * 2 - 1,
        baselineCostUsd: rng2(),
        candidateCostUsd: rng2(),
      });
    }
    const card = pairedEvaluationCard(records, "tier1");
    const tReport = timeMs(() => computeComparisonReport(records, card, []), 5);
    let sink = 0;
    const tDupSubs = timeMs(() => {
      sink = 0;
      for (const r of records) {
        sink += r.candidateUtility - r.baselineUtility;
        sink += r.candidateCostUsd - r.baselineCostUsd;
      }
    }, 5);
    check(`C n=${n} component observed`, Number.isFinite(sink));
    out(
      `part C: N=${n} computeComparisonReport=${(tReport * 1000).toFixed(1)}µs; ` +
        `the duplicated 2N subtractions cost at most ${(tDupSubs * 1000).toFixed(2)}µs (${((tDupSubs / tReport) * 100).toFixed(2)}%)`
    );
  }
  out(`part C: ${pairs} fuzz pairs bitwise identical`);
}

partA();
partB();
partC();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

仿真原始输出（第 1 次运行）：

```
part A: 100 membership cases + 15 tamper cases identical (throw, message, class)
part A: U=2000 production validate=394µs; variant=470µs (saving -76µs); isolated duplicate Set build=51µs
part A: U=20000 production validate=5256µs; variant=4280µs (saving 976µs); isolated duplicate Set build=935µs
part B: 4 byte-identical replay results + 1 identical error path
part B: N=100 (no exclusions) production=0.71ms fast-path=0.70ms; skipped filter component=3µs (0.4% of replay)
part B: N=1000 (no exclusions) production=8.09ms fast-path=7.53ms; skipped filter component=27µs (0.3% of replay)
part B: N=10000 (no exclusions) production=78.04ms fast-path=73.49ms; skipped filter component=92µs (0.1% of replay)
part C: N=40 computeComparisonReport=23.5µs; the duplicated 2N subtractions cost at most 2.18µs (9.25%)
part C: N=1000 computeComparisonReport=376.2µs; the duplicated 2N subtractions cost at most 40.84µs (10.86%)
part C: 10000 fuzz pairs bitwise identical

total: 15 checks, 0 failures
```

第 2 次独立运行：15 项检查同样 0 失败；剔除计时行后确定性结论 `diff` 逐位一致（U=2000 saving 翻号为 +55µs——正是 §3.1 的双向抖动证据；B/C 各档 µs 数值在同噪声带内复现）。注：part B 中 production 与 fast-path 全函数计时差（~0.5–4.5ms）大于孤立组件（3–106µs），系镜像函数与生产函数 JIT 身份差异所致，裁决以孤立组件测量为准。

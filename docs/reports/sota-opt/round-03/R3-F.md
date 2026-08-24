MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-F：`src/experiments/` 第三遍复查报告（Round 1/2 同区之上）

- 基线：`cursor/sota-persistent-opt-83a1` @ `09d7545`（含 R1 十区、R2 十区、R3-A/B/D、S2-J-1..11、S3-A-1..4、S3-B-1..6、S3-D-1..5）
- 切片：`src/experiments/` 全部 15 文件（2325 行），全量实际读码
- 前置阅读：README、EXCLUSIONS 全表、round-03/PLAN、round-01/R1-F、round-02/R2-F、`scripts/round01-r1f-equivalence-sim.ts`
- 分支：`cursor/r3-f-experiments-third-pass-83a1`

## 结论

**无新更优解落地，零生产代码改动。** 在 S1-F 落地态与完整排除表（含 R2-F 的 S2-F-1..6）之上做第三遍全量搜索，找到 5 个排除表未覆盖的新角度候选，全部经理论 + 确定性仿真（seeded mulberry32，两次独立运行结论逐位一致）裁决后淘汰，新增排除 S3-F-1…S3-F-5。其中 **S3-F-2 是对「必须先推翻 Ω(P+A) 下界」要求的正面回答**：本轮找到了绕过该下界的唯一候选通路（plan 引用同一性快路径）并以两个可复现发散反例证明它是 fail-closed 契约违反而非优化——下界经构造性检验后维持成立。`canCloseProductionCheckpointF` 语义未触碰（simulation ≠ production）。

## 0. 范围与约束遵守

- 未重开任何 X* / S1-* / S2-* / S3-A-* / S3-B-* / S3-D-* 条目。逐条对照：S3-F-1 不是 S2-F-4（那是 population Set 复用，这是 assignment-hash 索引）也不是 S1-F-8（那覆盖 recordExperimentOutcome 侧，本候选仅限 assign 的 `requireUniqueAssignment`，recordOutcome 侧复用明确划出候选范围）；S3-F-2 不是 X1-1（非缓存，是身份信任快路径）也不是 X1-6（非跨 episode 记忆化）——排除表无此条，需独立裁决；S3-F-3 是 S3-D-5 同族但机制新（死 Set 构建下沉，非死对象字面量）；S3-F-4 在 R2-F 逐文件收口中被提及但「并入 S2-F-3 裁决」未立 ID，本轮独立量化后补立。
- **S1-F-6 维持排除、未重开**：Part B 实测 `validateExperimentPlan` 占全程 ~52%，其内部 `assertUniqueNonEmpty` 的 Set 与 restore 自建 Set 确有一次重复构建，但一切消除机制（改 `: void` 签名、plan.ts 新增返回 Set 的平行入口、out-param）均落入 S1-F-6/X1-2/X0-4 已排除域，且 per-call 复杂度类不变（Ω(P) 维持）——按本轮「禁止重开」硬规则不提案。
- 未触碰版本化阈值、权限、数据面契约、公开签名；双 LCB 与双归因未动；live = R0 等价、R1 未接线 live 维持；X1-5、X3-2、X3-3、X4-1、S1-F-1..8、S2-F-1..6 全部维持。
- `git diff d91e2bd..HEAD -- src/experiments/` 核对：本切片自 S1-F 落地以来仅含 `shadow.ts`/`canary.ts` 的已记录 S1-F 变更（+34/−5），无未记录漂移。

## 1. 规模与可达性基底（本轮重新核实）

- `createShadowRunner` 唯一生产消费链仍是 `src/adaptation/reflection.ts` 的 `evaluateProposalShadow`（assign+recordOutcome 全循环）；`createCanaryRunner`、`replayPolicy`、`runSimulationHoldout` 仓内仅测试可达；`eval-routing.ts` 消费 `replayCacheKey`、`createIsolationGuard`、`gatedComparisonReport`、`stableStringify`；`promotion-rules.ts`、`r1-shadow-report.ts` 消费 comparison-report/gated-comparison。
- 否决线继承：S1-I-1 ~190µs、S2-F-3 90µs、S3-D-3 351–388µs 均已否决；防御纵深消除类（S2-F-5、S2-D-5、S1-H-2）一律安全侧保留。
- 基线性能锚点（本机，Node 22.22.2）：P=2000/A=1000 全实验 284–291ms；S1-F 回归维持 648.0ms→149.3ms（4.3×）。

## 2. Ω(P+A) 下界第三次复核（含构造性反证）

R1-F §1.1 的论证：fail-closed 契约（X3-3/X4-1）强制每次 runner 调用重验整个 plan（`validateExperimentPlan` 必须读全部 P 个 population 条目才能确立唯一性/非空性，Ω(P)）与全部 A 条 assignment（Ω(A)），故每调用 Ω(P+A)；S1-F 后实现为 O(P+A)，已达界。

本轮的新增工作是**穷举了绕过通路**：per-call 下界的唯一可攻击项是「重验」二字——若能证明 serialized.plan 与创建时验证过的对象是同一对象（引用同一性），理论上可跳过 Ω(P) 的内容重验（`evaluateProposalShadow` 的 in-memory 循环中 plan 引用全程传递不变，命中率 100%）。S3-F-2 实现了该快路径并构造两个发散反例（§3.2）：plan 对象未被冻结，调用方可就地变异，生产 fail-closed 逐调用捕获而快路径放行。契约要求重验**内容**，身份信任不构成内容重验。配套的「创建时深冻结 plan」变体则变更调用方持有对象的可观察行为（就地写在严格模式抛 TypeError），属公开面变更。**结论：不存在保契约的下界绕过；Ω(P+A) 维持成立，本切片 runner 侧后续轮次只可能压常数。**

## 3. 候选总表（全部淘汰，无赢家落地）

仿真脚本全文见附录；13 项检查 × 两次独立运行均 0 失败，结论逐位一致。

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-F-1 | restore 循环顺手构建 assignment-episodeHash Set，经私有管线复用于 assign 的 `requireUniqueAssignment`（S2-F-4 姊妹：那是 population Set，这是 assignments 索引；recordOutcome 侧=S1-F-8 已排除域，划出范围） | per-call 类不变（restore Ω(A) 在前）；把 assign 的 Σk 次字符串 === 换成每 restore k 次 Set.add + 1 次 has；fail-closed 逐调用重建（跨调用缓存=X1-1） | ✅ 1600 组 `some(===)` ≡ `Set.has` 成员判断一致（SameValueZero，字符串上 ≡ ===） | **实测负优化**：A=100 慢 0.140–0.166ms（-4.4~-5.2%）、A=1000 慢 5.9–6.5ms（-2.0~-2.2%）——逐调用 Set 重建（哈希+插入）贵于 V8 字符串 === 失配扫描 | 淘汰（实测更慢，S3-B-1 同型负优化；即便持平也仅为 5–6 个 A 线性项之一） |
| S3-F-2 | `serialized.plan === plan` 引用同一性快路径跳过 `validateExperimentPlan`（唯一可能推翻 Ω(P+A) 下界的通路） | 若成立则 in-memory 循环 per-call O(P+A)→O(A)，validateExperimentPlan 占全程 **51.6–51.8%**（P=2000/A=1000 的 ~284–291ms 中占 ~146–148ms），将是全战役最大赢家 | ❌ 两个发散反例：(1) `plan.population` 就地 push("")——生产抛 `population contains an empty entry`，快路径放行；(2) `plan.thresholds.maxCostUsd = -1`——生产抛错，快路径放行。plan 未冻结，身份≠内容 | —（契约违反不进基准） | 淘汰（fail-closed 契约违反；深冻结配套变体=公开可观察行为变更）。**下界经构造性反证维持** |
| S3-F-3 | restore 在 `assignments.length === 0` 时跳过 population Set 构建（可证死分配） | 循环体不执行时 Set 无任何读者，删除平凡等价 | ✅ 空 assignments 状态 restore 往返一致 | 每实验恰一次（首个 assign 的 restore）：P=200 省 3.9µs、P=2000 省 50.6–50.8µs——低于 S2-F-3 90µs 否决线 | 淘汰（一次性 µs 级；S3-D-5 死分配同族） |
| S3-F-4 | `createIsolationGuard` 循环外提升 `path.resolve(outputRoot)`（每守卫 4R 次 resolve → R+1 次） | path.resolve 同 cwd 下纯确定；检查次序/错误消息不变；组件常数 ~4× 降，调用类 O(R) 不变 | ✅ 400 例 fuzz（空/空白 root、双向重叠、重复、非法 outputRoot）throw/消息逐字节一致 | R=100 省 48–58µs、R=1000 省 363–392µs，一次性守卫构建；唯一生产调用方 eval-routing `assertReplayIsolated` 整体才 351–388µs（S3-D-3 已否决） | 淘汰（µs 级一次性，S2-F-3/S3-D-3 同域；R2-F 曾提及未立 ID，本轮补立防第三次重提） |
| S3-F-5 | simulation-holdout `toFrozenEpisode` 投影省略（直接别名 `SimulationHoldoutEpisode` 对象传入 `buildR1ShadowReport`） | 省 O(H) 小对象分配 | ❌ 对象形状可观察：额外字段（observedModelId/observedModelVersion/request 全形）流入下游，任何枚举/序列化路径逐字节发散风险 | `runSimulationHoldout` 仓内 test-only | 淘汰（形状契约 + 无生产调用方，S1-B-8/X4-2 邻域；无需计时） |

## 4. 关键裁决细节

### 4.1 S3-F-1：为什么「省一个 O(A) 扫描」反而更慢

assign 路径的 `requireUniqueAssignment` 对 k 条已有 assignment 做全扫（全部失配，因为 episodeHash 唯一）。候选让 restore 的既有 fail-closed 循环顺手 `set.add(episodeHash)`，assign 改一次 `has`。看似把 Σk 比较换成「免费」的顺手插入——但插入不是免费的：每次 Set.add 需字符串哈希（V8 有哈希缓存，但插入本身的桶操作与 rehash 仍在），而失配的字符串 === 在共同前缀早断处即返回。实测两个规模档均为负优化（A=1000 慢 ~6ms）。这与 S3-B-1（partitionLiveCandidates 记忆化实测慢 884–1442µs/批）同型：**「省扫描」的直觉在 V8 字符串比较快路径面前经常反转，必须实测**。即便未来测得持平，该扫描也只是 assign 路径 5–6 个 A 线性项之一，被 restore 的 Ω(P+A) 支配。

### 4.2 S3-F-2：下界攻击的完整记录（本轮最重要结论）

- **攻击面选择**：Ω(P) 项来自「每调用重验 plan 内容」。`evaluateProposalShadow` 的循环里 `state = runner.assign(state, ...)` 返回的状态携带同一 plan 引用（restore 返回 `plan: serialized.plan`，引用透传），故 `serialized.plan === plan` 在 in-memory 场景恒真，快路径命中率 100%，收益上限实测 ~52% 全程——若成立远超落地线。
- **为什么必死**：契约语义是「不信任任何传入状态」（JSON 往返、跨进程恢复、调用方篡改一视同仁）。引用同一性只证明「是同一个对象」，不证明「内容仍合法」——JS 对象默认可变，`ExperimentPlan` 仅 TS 层 readonly（编译期擦除）。仿真用两行就地变异构造出生产/快路径判决发散（生产 fail-closed 抛错、快路径静默放行），即快路径**改变了可观察错误行为**，违反「等价」门槛的同时削弱安全不变量。
- **深冻结堵漏为何也不行**：`createShadowRunner` 对 plan `Object.freeze` 深冻结可让身份检查可靠，但冻结调用方持有的对象是公开可观察副作用（后续就地写从「fail-closed 捕获」变成「严格模式 TypeError / 非严格静默丢失」），错误类与消息全变，且冻结递归 O(P) 也只付一次——是行为变更而非保行为优化。
- **重开条件**（记入排除表）：若未来规格把 `ExperimentPlan` 定义为构造时深冻结的不可变值类型（即推翻 X3-3/X4-1 的内容重验要求），本候选应第一时间重新裁决，预期收益 ~52% 全程、per-call 类降至 O(A)。

### 4.3 S3-F-4：等价成立但三条独立死因

400 例对抗 fuzz 逐字节一致（resolve 纯函数 + 检查次序逐语句保持）。仍淘汰：(1) 调用类 O(R) 不变，降的是组件常数；(2) 绝对量 µs 级一次性（R=100 才省 ~50µs），低于 S2-F-3 已否决的 90µs；(3) 生产唯一到达路径 eval-routing `assertReplayIsolated` 整体 351–388µs 刚被 R3-D 以低于否决线淘汰（S3-D-3），守卫内部提升省得更少。三条任一即足。

## 5. 逐文件收口（R1-F/R2-F 收口之上的本轮新检查点）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `shadow.ts` | 见 S3-F-1/S3-F-2/S3-F-3；`requireEpisodeHash` 的 per-assignment trim 为 Ω(A) 内常数；`new Set(population)` 构造器 vs for-of add 为 S1C-10 域微常数 | 无候选落地 |
| `canary.ts` | S3-F-1/2/3 裁决对称适用（restore 结构同构）；`derivedExposure` 单遍已最优 | 无候选 |
| `plan.ts` | `assertUniqueNonEmpty` 的 trim/Set 即契约验证本体不可省；与 restore 的重复 Set 构建=S1-F-6 维持排除（§0） | 无候选 |
| `replay.ts` | rerunHash/manifestHash/去重维持 S2-F-1/2/3；`[...].filter` 冗余 spread 维持 S1-B-5 同族 | 无候选 |
| `isolation.ts` | **S3-F-4 独立量化后补立 ID 淘汰**；`assertWritablePath` 的 per-root 重复 resolve 同域同判 | 无候选落地 |
| `gated-comparison.ts` | strip-retry 维持 S1-F-1；`pairedEvaluationCard` 维持 S2-F-6；`[...new Set(map)]` 为其组件 | 无候选 |
| `comparison-report.ts` | 六遍维持 X3-2；四个 `records.reduce` 均值不可从 families 的 delta 和导出（非冗余）；Welford 维持 X2-1/X1-3 域 | 无候选 |
| `simulation-holdout.ts` | **S3-F-5 淘汰**；尾部双验维持 S2-F-5；`auditHoldoutAccess` try/catch 两次 Map 查为噪声 | 无候选落地 |
| `dataset.ts` | `validateSealedDatasetManifest` 的 assertUniqueNonEmpty 遍 + membership 遍合并会令「split 内重复」错误消息从 duplicate 变 contamination（错误面变更），且 X3-2 常数域——不提案 | 无候选 |
| `manifest.ts` | stableStringify 维持 R2-F 不提案裁决（字节冻结契约 + parts/join 两次负优化先例）；流式 hash 化需改 hash32 公开签名 | 无候选 |
| `holdout.ts` | 审计拷贝维持 S1-F-3/X4-2；`rotateHoldout` 的 `[...splits.holdout]` 快照拷贝为冻结语义本体（别名化=S1-B-8 域） | 无候选 |
| `threshold-calibration.ts` | 三遍维持 S1-F-4；`rows[0]` 起点扫描 3 行常数 | 无候选 |
| `evaluation-card.ts` | 校验数组字面量维持 S1-B-7 域 | 无候选 |
| `shadow-compare.ts` | 薄封装维持 X1-5 | 无候选 |
| `attribution-report.ts` | 21 行证据封装无循环 | 无候选 |

## 6. 前后对比

零生产代码改动。基线（S1-F 落地态）即本轮终态：P=2000/A=1000 全实验 284–291ms，其中 ~52% 是 fail-closed 契约强制的 plan 重验（S3-F-2 证明不可绕）、其余为 Ω(A) 重验/防御拷贝（X3-3/X4-1 锁定）与已被 S2-F-1/4、S3-F-1 逐项排除的 A 线性项。本切片在保行为 + 契约 + 排除表约束下无剩余可测优化。

## 7. 测试

- 本轮裁决仿真（附录）✓ — 13 项检查 0 失败；**两次独立运行的确定性结论逐位一致**（seeded mulberry32；计时行为信息性输出）
- `npx tsx scripts/round01-r1f-equivalence-sim.ts` ✓ — 2668 项逐位检查 0 失败（S1-F 回归：648.0ms→149.3ms，4.3×，1.67 亿次成员比较消除维持）
- `pnpm gate`（typecheck + lint + test + build）✓ — 1168 pass / 0 fail / 1 skipped（既有 provider-smoke 凭据跳过）。注：需 Node ≥22.19.0（engines）；本 VM 默认 Node 22.14.0 会令 doctor 预检测试 fail-closed（环境性，与代码无关），本轮以 nvm 切至 22.22.2 后全绿
- 按「无赢家不写死代码」纪律，裁决仿真脚本未入库（全文见附录），`scripts/` 下仅保留既有的 round01-r1f-equivalence-sim.ts

## 8. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-F-1 | restore 顺手构建 assignment-hash Set 复用于 assign 的 requireUniqueAssignment | 实测负优化（A=1000 慢 5.9–6.5ms，-2.0~-5.2%）：逐调用 Set 重建贵于字符串 === 失配扫描；recordOutcome 侧=S1-F-8、跨调用缓存=X1-1 |
| S3-F-2 | shadow/canary restore 以 plan 引用同一性跳过 validateExperimentPlan（含深冻结配套变体） | fail-closed 契约要求重验内容而非信任身份：就地变异 population/thresholds 时生产抛错、快路径放行（两反例）；深冻结=公开可观察行为变更。收益上限 ~52% 全程已量化——**若未来规格将 ExperimentPlan 改为构造时深冻结不可变值类型（推翻 X3-3/X4-1 内容重验），应第一时间重新裁决** |
| S3-F-3 | restore 空 assignments 时跳过 population Set 构建 | 可证死分配但每实验仅一次，P=2000 省 50.8µs（低于 S2-F-3 90µs 否决线）；S3-D-5 同族 |
| S3-F-4 | createIsolationGuard 循环外提升 resolve(outputRoot)（4R→R+1 次 resolve） | 400 fuzz 逐字节等价，但 O(R) 类不变、一次性 µs 级（R=100 省 48–58µs）、唯一生产路径整体已被 S3-D-3 否决 |
| S3-F-5 | simulation-holdout toFrozenEpisode 投影省略直接别名 | 对象形状可观察（额外字段外泄下游）+ runSimulationHoldout 仓内 test-only（S1-B-8/X4-2 邻域） |

MORE_OPTIMA=no
BRANCH=cursor/r3-f-experiments-third-pass-83a1

## 附录：确定性裁决仿真脚本（完整，可复现）

保存为 `scripts/round03-r3f-decision-sim.ts` 后 `npx tsx scripts/round03-r3f-decision-sim.ts` 运行（无赢家，按战役纪律不入库，报告内嵌全文）：

```ts
/**
 * Round-3 R3-F adjudication simulation (temporary — embedded in the R3-F
 * report appendix, not committed as a standing script; no winner landed).
 *
 * Adjudicates five fresh candidates over src/experiments/ on top of the
 * landed S1-F baseline (and the S1-F-1..8 / S2-F-1..6 exclusions):
 *
 *   S3-F-1  restore-built assignment-episodeHash Set reused for the assign
 *           path's requireUniqueAssignment (sibling of S2-F-4, which reused
 *           the *population* Set; this one indexes the *assignments*).
 *           recordExperimentOutcome-side reuse is S1-F-8 and stays excluded;
 *           its ceiling is measured here for context only.
 *   S3-F-2  reference-identity fast path skipping validateExperimentPlan
 *           when serialized.plan === runner plan (the only way left to beat
 *           the R1-F Ω(P+A) per-call bound). Adjudicated on the fail-closed
 *           contract: an in-place plan mutation must keep throwing.
 *   S3-F-3  skip the restore population-Set build when assignments is empty
 *           (the Set is provably dead in that case).
 *   S3-F-4  createIsolationGuard: hoist path.resolve(outputRoot) out of the
 *           per-root loop (4R resolves -> R+1).
 *   S3-F-5  toFrozenEpisode projection elision in simulation-holdout
 *           (adjudicated in the report on shape-observability + test-only
 *           reachability; no timing needed).
 *
 * Every equivalence check demands identical accept/reject, thrown error
 * messages, and error classes. All fixtures are generated with a seeded
 * mulberry32 so two independent runs produce bitwise-identical check
 * verdicts (timing lines are informational). Run with:
 *   npx tsx scripts/round03-r3f-decision-sim.ts
 */

import path from "node:path";
import {
  createShadowRunner,
  type ExperimentOutcome,
  type ShadowState,
} from "../src/experiments/shadow.js";
import { validateExperimentPlan, type ExperimentPlan } from "../src/experiments/plan.js";
import { createIsolationGuard } from "../src/experiments/isolation.js";
import { createCandidateId, createResourceVersionId } from "../src/domain/ids.js";
import { DomainValidationError } from "../src/domain/errors.js";

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

function makeShadowPlan(populationSize: number, maxAssignments: number): ExperimentPlan {
  const population: string[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  return {
    planVersion: 1,
    experimentId: "exp_r3f_bench",
    mode: "shadow",
    baselineVersionId: createResourceVersionId(() => "r3fbase"),
    candidateId: createCandidateId(() => "r3fcand"),
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

/* ------------------------------------------------------------------ */
/* Part A — S3-F-1 assignment-hash Set: equivalence + component ceiling */
/* ------------------------------------------------------------------ */

function partA(): void {
  // Equivalence fuzz: some(===) vs Set.has over identical fixtures.
  const rng = fixtureRng(0x3f01);
  let fuzz = 0;
  for (let c = 0; c < 200; c++) {
    const n = Math.floor(rng() * 50);
    const assignments: { episodeHash: string }[] = [];
    for (let i = 0; i < n; i++) {
      assignments.push({ episodeHash: `ep_${Math.floor(rng() * 60)}` });
    }
    const set = new Set(assignments.map((a) => a.episodeHash));
    for (let q = 0; q < 8; q++) {
      const hash = `ep_${Math.floor(rng() * 80)}`;
      const viaSome = assignments.some((a) => a.episodeHash === hash);
      const viaSet = set.has(hash);
      if (viaSome !== viaSet) {
        check(`A fuzz case ${c} query ${q}`, false);
        return;
      }
      fuzz += 1;
    }
  }
  check("A some(===) ≡ Set.has equivalence", true);
  out(`part A: ${fuzz} membership queries agree between some(===) and Set.has`);

  // Component ceiling at the production call pattern (evaluateProposalShadow):
  // assign at step k scans k prior assignments (all misses, full scan).
  for (const A of [100, 1000]) {
    const P = 2 * A;
    const plan = makeShadowPlan(P, A);
    validateExperimentPlan(plan);
    const hashes = plan.population.slice(0, A);
    const assignments = hashes.map((episodeHash) => ({ episodeHash }));

    // Reference: the assign-path unique scan, Σk comparisons (all unique).
    let refHits = 0;
    const tSome = timeMs(() => {
      refHits = 0;
      for (let k = 0; k < A; k++) {
        const prefix = assignments.slice(0, k);
        if (prefix.some((a) => a.episodeHash === hashes[k])) refHits += 1;
      }
    }, 3);
    // Variant: each assign-restore builds the index inside its existing loop
    // (fail-closed rebuild per call — caching across calls would be X1-1),
    // then answers the unique check with one Set.has.
    let varHits = 0;
    const tSet = timeMs(() => {
      varHits = 0;
      for (let k = 0; k < A; k++) {
        const index = new Set<string>();
        for (let i = 0; i < k; i++) index.add(assignments[i]!.episodeHash);
        if (index.has(hashes[k]!)) varHits += 1;
      }
    }, 3);
    check(`A A=${A} unique verdicts agree`, refHits === 0 && varHits === 0);

    // Context: the full production experiment (assign + recordOutcome).
    const runner = createShadowRunner(plan);
    const outcomes: ExperimentOutcome[] = hashes.map((episodeHash) => ({
      episodeHash,
      utility: 0.5,
      costUsd: 0.01,
      guardrailBreached: false,
    }));
    let finalState: ShadowState | undefined;
    const tFull = timeMs(() => {
      let state = runner.start(0);
      for (const outcome of outcomes) {
        if (state.halted) break;
        state = runner.assign(state, outcome.episodeHash, 0);
        state = runner.recordOutcome(state, outcome, 0);
      }
      finalState = state;
    }, 3);
    check(`A A=${A} full loop completes`, finalState !== undefined && finalState.outcomes.length === A);
    out(
      `part A: P=${P} A=${A} full-experiment=${tFull.toFixed(2)}ms; assign unique-scan component=` +
        `${tSome.toFixed(3)}ms; per-restore rebuilt Set variant=${tSet.toFixed(3)}ms; ` +
        `delta=${(tSome - tSet).toFixed(3)}ms (${(((tSome - tSet) / tFull) * 100).toFixed(2)}% of the run)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part B — S3-F-2 identity fast path: fail-closed divergence proof    */
/* ------------------------------------------------------------------ */

/** Candidate variant: skip validateExperimentPlan when the serialized plan is
 * the very object the runner was created with (identity trust). Everything
 * else — including the membership Set and the per-assignment loop — verbatim. */
function fastPathRestore(serialized: ShadowState, expected: ExperimentPlan): ShadowState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("shadow state is required");
  }
  if (serialized.plan !== expected) {
    validateExperimentPlan(serialized.plan);
  }
  if (serialized.plan.experimentId !== expected.experimentId) {
    throw new DomainValidationError("restored plan does not match runner");
  }
  if (serialized.plan.mode !== "shadow") {
    throw new DomainValidationError('shadow restore requires mode "shadow"');
  }
  if (typeof serialized.halted !== "boolean") {
    throw new DomainValidationError("halted must be a boolean");
  }
  if (!Array.isArray(serialized.assignments) || !Array.isArray(serialized.outcomes)) {
    throw new DomainValidationError("assignments and outcomes must be arrays");
  }
  if (!Number.isInteger(serialized.guardrailBreaches) || serialized.guardrailBreaches < 0) {
    throw new DomainValidationError("guardrailBreaches must be an integer >= 0");
  }
  if (typeof serialized.startedAtMs !== "number" || !Number.isFinite(serialized.startedAtMs)) {
    throw new DomainValidationError("startedAtMs must be a finite number");
  }
  if (typeof serialized.elapsedMs !== "number" || !Number.isFinite(serialized.elapsedMs) || serialized.elapsedMs < 0) {
    throw new DomainValidationError("elapsedMs must be a finite number >= 0");
  }
  const population = new Set(serialized.plan.population);
  for (const assignment of serialized.assignments) {
    if (assignment.liveAction !== "baseline" || assignment.changedLiveAction !== false) {
      throw new DomainValidationError("shadow state must not change the live action");
    }
    if (assignment.shadowDecision !== "baseline" && assignment.shadowDecision !== "candidate") {
      throw new DomainValidationError("invalid shadowDecision");
    }
    if (typeof assignment.episodeHash !== "string" || assignment.episodeHash.trim() === "") {
      throw new DomainValidationError("episodeHash is required");
    }
    if (!population.has(assignment.episodeHash)) {
      throw new DomainValidationError(`episode ${assignment.episodeHash} is not in the frozen population`);
    }
  }
  return serialized; // divergence probe only needs the acceptance verdict
}

function runCatch(fn: () => void): { threw: boolean; message: string } {
  try {
    fn();
    return { threw: false, message: "" };
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) };
  }
}

function partB(): void {
  // Divergence case 1: in-place population mutation (empty entry appended).
  {
    const plan = makeShadowPlan(20, 10);
    const runner = createShadowRunner(plan);
    let state = runner.start(0);
    state = runner.assign(state, plan.population[0]!, 0);
    (plan.population as string[]).push("");
    const production = runCatch(() => runner.assign(state, plan.population[1]!, 0));
    const fastPath = runCatch(() => fastPathRestore(state, plan));
    check(
      "B case 1: production fail-closed catches the in-place mutation",
      production.threw && production.message === "population contains an empty entry"
    );
    check("B case 1: identity fast path silently accepts it (divergence)", !fastPath.threw);
  }
  // Divergence case 2: in-place threshold corruption.
  {
    const plan = makeShadowPlan(20, 10);
    const runner = createShadowRunner(plan);
    let state = runner.start(0);
    state = runner.assign(state, plan.population[0]!, 0);
    (plan.thresholds as { maxCostUsd: number }).maxCostUsd = -1;
    const production = runCatch(() => runner.assign(state, plan.population[1]!, 0));
    const fastPath = runCatch(() => fastPathRestore(state, plan));
    check(
      "B case 2: production fail-closed catches the threshold corruption",
      production.threw && production.message === "maxCostUsd must be a finite number >= 0"
    );
    check("B case 2: identity fast path silently accepts it (divergence)", !fastPath.threw);
  }
  // Foregone-saving context: what share of the full run validateExperimentPlan is.
  const A = 1000;
  const plan = makeShadowPlan(2 * A, A);
  validateExperimentPlan(plan);
  const tValidate = timeMs(() => {
    for (let i = 0; i < 2 * A; i++) validateExperimentPlan(plan);
  }, 3);
  const runner = createShadowRunner(plan);
  const outcomes: ExperimentOutcome[] = plan.population.slice(0, A).map((episodeHash) => ({
    episodeHash,
    utility: 0.5,
    costUsd: 0.01,
    guardrailBreached: false,
  }));
  const tFull = timeMs(() => {
    let state = runner.start(0);
    for (const outcome of outcomes) {
      if (state.halted) break;
      state = runner.assign(state, outcome.episodeHash, 0);
      state = runner.recordOutcome(state, outcome, 0);
    }
  }, 3);
  out(
    `part B: P=${2 * A} A=${A} full-experiment=${tFull.toFixed(2)}ms; the 2A validateExperimentPlan calls ` +
      `the contract mandates cost ${tValidate.toFixed(2)}ms (${((tValidate / tFull) * 100).toFixed(1)}% — ` +
      `the price the fail-closed contract knowingly pays; skipping them is a contract violation, not an optimization)`
  );
}

/* ------------------------------------------------------------------ */
/* Part C — S3-F-3 dead population-Set build on empty assignments      */
/* ------------------------------------------------------------------ */

function partC(): void {
  // Deadness: with assignments === [], the restore loop body never runs and
  // the Set has no other reader — verify restore output is untouched by it.
  const plan = makeShadowPlan(50, 10);
  const runner = createShadowRunner(plan);
  const fresh = runner.start(0);
  const restored = runner.restore(JSON.parse(JSON.stringify(fresh)) as ShadowState);
  check(
    "C empty-assignments restore round-trips",
    restored.assignments.length === 0 && restored.outcomes.length === 0 && !restored.halted
  );
  for (const P of [200, 2000]) {
    const bigPlan = makeShadowPlan(P, 10);
    let sink = 0;
    const tBuild = timeMs(() => {
      sink = new Set(bigPlan.population).size;
    }, 5);
    check(`C P=${P} set build observed`, sink === P);
    out(
      `part C: P=${P} one dead Set build=${(tBuild * 1000).toFixed(1)}µs — occurs exactly once per experiment ` +
        `(the single restore that sees an empty assignments array)`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Part D — S3-F-4 isolation-guard outputRoot resolve hoist            */
/* ------------------------------------------------------------------ */

/** Candidate variant: identical checks in identical order; outputRoot is
 * resolved once and each root once (4R resolves -> R+1). */
function createIsolationGuardHoisted(input: {
  readonly readOnlyRoots: readonly string[];
  readonly outputRoot: string;
}): { readonly readOnlyRoots: readonly string[]; readonly outputRoot: string } {
  const guard = input;
  if (guard.outputRoot.trim() === "") {
    throw new DomainValidationError("outputRoot is required");
  }
  const resolvedOutput = path.resolve(guard.outputRoot);
  for (const root of guard.readOnlyRoots) {
    if (root.trim() === "") {
      throw new DomainValidationError("read-only roots must not be empty");
    }
    const resolvedRoot = path.resolve(root);
    const outInRoot = path.relative(resolvedRoot, resolvedOutput);
    if (outInRoot === "" || (!outInRoot.startsWith("..") && !path.isAbsolute(outInRoot))) {
      throw new DomainValidationError(
        `output root ${guard.outputRoot} overlaps read-only root ${root}`
      );
    }
    const rootInOut = path.relative(resolvedOutput, resolvedRoot);
    if (rootInOut === "" || (!rootInOut.startsWith("..") && !path.isAbsolute(rootInOut))) {
      throw new DomainValidationError(
        `read-only root ${root} overlaps output root ${guard.outputRoot}`
      );
    }
  }
  return guard;
}

function partD(): void {
  const rng = fixtureRng(0x3f04);
  const pool = [
    "/live/a",
    "/live/b",
    "/live/c/../c",
    "",
    "   ",
    "/replay/out/inner",
    "/replay",
    "/live/a/nested",
    "/other/ws",
    "/replay/out",
  ];
  let fuzz = 0;
  for (let c = 0; c < 400; c++) {
    const n = Math.floor(rng() * 12);
    const roots: string[] = [];
    for (let i = 0; i < n; i++) {
      roots.push(pool[Math.floor(rng() * pool.length)] ?? "/live/a");
    }
    const outputRoot = rng() < 0.1 ? "/live/a/out" : rng() < 0.1 ? "  " : "/replay/out";
    const a = runCatch(() => createIsolationGuard({ readOnlyRoots: roots, outputRoot }));
    const b = runCatch(() => createIsolationGuardHoisted({ readOnlyRoots: roots, outputRoot }));
    if (a.threw !== b.threw || a.message !== b.message) {
      check(`D fuzz case ${c}`, false, `${a.message} vs ${b.message}`);
      return;
    }
    fuzz += 1;
  }
  check("D hoisted guard error equivalence", true);
  out(`part D: ${fuzz} fuzz cases — throw/no-throw and message identical`);
  for (const R of [100, 1000]) {
    const roots: string[] = [];
    for (let i = 0; i < R; i++) roots.push(`/live/ws-${i % 7}/repo-${i}`);
    const tOrig = timeMs(() => createIsolationGuard({ readOnlyRoots: roots, outputRoot: "/replay/out" }), 5);
    const tHoist = timeMs(
      () => createIsolationGuardHoisted({ readOnlyRoots: roots, outputRoot: "/replay/out" }),
      5
    );
    out(
      `part D: R=${R} original=${(tOrig * 1000).toFixed(0)}µs hoisted=${(tHoist * 1000).toFixed(0)}µs ` +
        `(saving ${((tOrig - tHoist) * 1000).toFixed(0)}µs per guard construction)`
    );
  }
}

partA();
partB();
partC();
partD();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
```

仿真原始输出（第 1 次运行）：

```
part A: 1600 membership queries agree between some(===) and Set.has
part A: P=200 A=100 full-experiment=3.19ms; assign unique-scan component=0.108ms; per-restore rebuilt Set variant=0.248ms; delta=-0.140ms (-4.39% of the run)
part A: P=2000 A=1000 full-experiment=291.01ms; assign unique-scan component=4.081ms; per-restore rebuilt Set variant=10.605ms; delta=-6.524ms (-2.24% of the run)
part B: P=2000 A=1000 full-experiment=285.51ms; the 2A validateExperimentPlan calls the contract mandates cost 147.91ms (51.8% — the price the fail-closed contract knowingly pays; skipping them is a contract violation, not an optimization)
part C: P=200 one dead Set build=3.9µs — occurs exactly once per experiment (the single restore that sees an empty assignments array)
part C: P=2000 one dead Set build=50.8µs — occurs exactly once per experiment (the single restore that sees an empty assignments array)
part D: 400 fuzz cases — throw/no-throw and message identical
part D: R=100 original=240µs hoisted=192µs (saving 48µs per guard construction)
part D: R=1000 original=1534µs hoisted=1171µs (saving 363µs per guard construction)

total: 13 checks, 0 failures
```

第 2 次独立运行：13 项检查同样 0 失败；剔除计时行后确定性结论 `diff` 逐位一致（A=100: -5.18%、A=1000: -2.05%、validate 份额 51.6%、C/D 各档 µs 数值均在同噪声带内复现）。

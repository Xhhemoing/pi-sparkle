MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-D：`src/adaptation/` 第三遍搜查报告（Round 1–2 同区第三遍）

**战役:** 全库持久 SOTA 优化 Round 3 / R3-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `c9c7017`
**分支:** `cursor/r3-d-adaptation-third-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D（`6ef886e`）至本轮基线（`c9c7017`）**逐字节未变**
（`git diff 82bef36..c9c7017 -- src/adaptation/` 与 `git diff 6ef886e..c9c7017
-- src/adaptation/` 均为空），R1-D 的逐文件收口与 S1-D-1..9、S2-D-1..5 排除
全部继承有效。本轮在完整排除表（含 S2-J-1..11、S3-A-1..4、S3-B-1..6）之上换
第三组新透镜全量重读枚举，得到 5 个此前未点名的新候选（S3-D-1 … S3-D-5），
全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz / 别名安全探针 /
真实规模基准，两次独立运行等价结论**逐位一致**）裁决后淘汰：全部等价可证，
但 4 个在 ns~µs 噪声带，最强候选（S3-D-3，~351–388µs/eval 调用）仍低于战役
否决线（数十~数百 ms；已否决标尺 S1-I-1 ~190µs、S2-D-4 ~116µs、S2-F-3 90µs
同量级）。未重开任何 X* / S1-* / S2-* / S3-A-* / S3-B-* 条目。X2-5 维持排除
未触碰。CAS/权限/凭据/数据面语义零 diff，天然不变。另建立**整片预算支配
论证**（§3），把本切片在当前控制面规模下整体收口。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、promotion-rules、
  candidate、eval-routing、pareto、rollback、resource、retirement、
  active-pointer、monitor、approval-profile、reflection、mutate）本轮再次
  **全量实际读码**，未依赖前两轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表）/ round-03/PLAN.md /
  round-01/R1-D.md / round-02/R2-D.md。
- 基线漂移检查：`git diff 82bef36..c9c7017 -- src/adaptation/` 为空
  ——R1-D/R2-D 的全部规模测量与裁决对当前代码原样成立。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5（monitor 每 observe 重算
  `freezeBaseline`）直接跳过；S1-D-1..9 / S2-D-1..5 全部不再提案；
  X1-1/X0-4/X1-2/X0-5/X0-6 全部绕开。本轮只探索**未被点名的第三组透镜**：
  原子路径中间产物丢弃（S3-D-1）、终末冗余 spread（S3-D-2）、上游调用形参
  去重（S3-D-3）、解析器外层再拷贝（S3-D-4）、分支死分配下沉（S3-D-5）。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升（`autoPromotableFor` 由 kind 派生、
  `NON_AUTO_PROMOTABLE_KINDS` 强制在 neverAutoPromote）、晋升提案优先——
  零 diff，天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放
  （ADR-005）。

## 1. 规模与门槛基底（继承 + 本轮补充）

R1-D 实测规模（V/C/L 个位~十位、pendingByIntent 0~个位、catalog M=2~3、
唯一可增长维度是 eval 数据集 E、monitor W=8）与 R2-D 的 I/O 支配事实
（全部入口是每进程一次的 CLI/auto-loop：磁盘载入→单次操作→原子保存）继承
有效——代码与调用面均未变。本轮补充两点结构事实：

- **生产调用方图景**（grep 复核）：`paretoFront`、`reconstructPromotion`、
  `createAdaptationDriftMonitor`、`proposeCandidates` / `evaluateProposalShadow`
  / `assignEvaluationSplit`、`retireVersion`、`PromotionService`、独立的
  `beginPromotion`/`commitPromotion` 在 `src/` 生产面**均无调用方**（monitor
  的唯一同名邻居 `src/routing/shadow.ts` 用的是另一个 drift monitor）。CLI
  只经 `rollbackActive`、`promoteWithRegistry`、`evalRoutingPolicy` 与
  registry 载入/保存到达本切片。
- **eval 路径切片内成本排序**（E=200 实测）：`assertReplayIsolated` 的 guard
  构建 ~355–395µs（本轮 S3-D-3 测得）是切片内单项最大成本，其余在
  ns~十µs 级；全部被切片外 `assignTasks`×2（R2-D 实测 ~750µs）与 dataset/
  registry/report 的 ms 级 I/O 支配。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-D-1 | `registry.promote()` 原子路径丢弃 `beginPromotion` 返回的 `ledger()` 拷贝（`promote` 只读 `began.intentId`，O(L) 拷贝是死产物） | 免 1 次 O(L) 数组拷贝/promote | —（拷贝被丢弃，消除即等价；上界锚定） | L=6（3 次晋升 = intent+promoted×3）实测 **38.1–41.1ns**；L=60（10×）也仅 40.1–43.8ns | 淘汰：ns 级噪声；且消除需私有 begin 变体（X1-2 类平行路径）或改 `BeginPromotionResult` 公开返回契约（X0-4 类） |
| S3-D-2 | `paretoFront` 末尾 `[...front]` 冗余 spread 移除（`front` 是 `points.filter` 的新数组，原地 sort 不可观察） | 免 1 次 n 元素拷贝/调用 | ✅ 4000 fuzz（含 20% 重复度量点）输出逐位一致 + 双向输入纯度探针 | n=3 省 **21.2–23.4ns**、n=10 省 30.8–37.2ns/调用；n ≤ maxCandidatesPerEpoch 个位数，**且无生产调用方** | 淘汰：S1-B-5/S2-A-5 同族噪声 |
| S3-D-3 | eval-routing `assertReplayIsolated` readOnlyRoots 先按首现序去重再建 guard（E 个 episode 共享 originalWorkspace 时，`createIsolationGuard` 每 root 付 2 次 isInside = 4 次 path.resolve + 2 次 path.relative） | guard 内路径运算 O(E)→O(U)，U=1~3 | ✅ 3000 fuzz（8% 注入 overlap 反例路径）抛错/放行与首错消息逐字节一致（首现序去重保首个坏 root 的值不变） | E=200,U=1：current 355.6–381.3µs → dedup+guard 4.8–5.1µs，**省 350.9–376.2µs/eval 调用**；U=3 同带（362.6–388.1µs） | 淘汰：**本轮最强候选仍低于否决线**——数十~数百 ms 落地线之下 ~2 个量级；同族 S2-F-3（90µs）与标尺 S1-I-1（190µs）已被否决；一次性 `adapt eval` CLI 进程，被 ms 级 I/O 与 assignTasks×2 支配；总复杂度仍 O(E)（去重本身 O(E)），非复杂度类下降 |
| S3-D-4 | `parseRollbackLedgerEntry` 外层 `copyRollbackLedgerEntry` 再拷贝消除（传入字面量已新鲜，仅 `evidence: [...]` 拷贝是载荷——`asStringArray` 按引用返回输入 JSON 数组；变体内联 evidence 拷贝、免 7 字段再拷贝） | 免 1 次对象拷贝/ledger 条目 | ✅ 3000 fuzz 逐位一致 + 别名安全探针（parse 后变异输入 evidence 两变体均不泄漏） | L=6 条全 registry 载入省 **1073.0–1134.8ns**；rollbackLedger 每回滚 1 条、个位~十位 | 淘汰：µs 级、每进程一次、被 registry 载入的全量 content 重哈希与文件 I/O 支配 |
| S3-D-5 | monitor `report()` 预热后死 `emptyAxes` 分配下沉冷分支（observations.length ≥ W 路径从不读它） | 免 1 次 5 字段对象分配/observe | ✅ 400×24 步流式 fuzz：复刻管线先对齐真实 monitor 逐位一致，再 current vs sunk 逐位一致 | N=32 省 **66.7–70.9ns/observe**（全 observe 1572–1606ns）；**且无生产调用方** | 淘汰：ns 级 + test-only（S1-A-7/S2-H-5 同类境地） |

## 3. 整片预算支配论证（本轮新增收口）

本切片全部生产入口按调用频率与切片内可寻址成本收口：

- **promote / rollback / auto-loop 路径**：每进程一次，切片内全部数据结构
  个位~十位规模，本轮与前两轮全部候选实测 ns~µs 带（最大单项 S3-D-4 的
  ~1.1µs/载入）。即使全部清零，收益上界 < ~10µs/进程调用，低于落地线
  ≥4 个量级，且每次调用固定支付 ms 级 registry 读/写 + fsync。
- **adapt eval 路径**（唯一可增长维度 E）：切片内可寻址成本 = guard 构建
  （~0.4ms，S3-D-3）+ 双 parseTaskId（~16.5µs，S2-D-3）+ catalogCost find
  （<0.1µs，S1-D-4）+ 若干常数遍——合计 **< 0.5ms/调用**，而同一调用固定
  支付切片外 `assignTasks`×2（~750µs）+ dataset/registry/report ms 级 I/O。
  把切片内 eval 成本全部清零也够不到数十 ms 落地线。

结论：在「人审门控低频控制面 + E≲10³」的现实契约下，本切片不存在达门槛的
保行为优化空间；唯一可能改变裁决的是 E 增长 ≥2 个量级（见 §6 重开条件）。

## 4. 逐文件收口（第三遍新检查点，叠加 R1-D/R2-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S3-D-1；`preparePromotion` 的 pendingByIntent 线性扫按 candidateId 建索引 = S1-D-2 同族第二结构（pending 0~个位，不另立 ID）；`promote` 原子路径上 begin/commit 的重复校验（candidate 状态、pendingVersion 存在性）是两阶段 CAS 契约——commit 必须可在 crash 恢复后独立调用，融合特化 = X1-2 平行路径；`updateCandidateStatus` 全字段 revalidate 为 fail-closed（ns 级） | 无候选落地 |
| `promotion.ts` | S3-D-1 的契约载体（`BeginPromotionResult.ledger` 公开）；`parsePromotionReview` 尾部 `validatePromotionReview` 与 `preparePromotion` 各自路径只跑一次，无同流重复；`loadAdaptationRegistryOrNew` 错误消息 regex 在 X0-5 域 | 无候选 |
| `promotion-rules.ts` | `assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed 契约（R1-D 已判，X1-1 域）；`validateChangeNote` 双数组两遍 for 已线性、顺序短路即错误契约 | 无候选 |
| `candidate.ts` | `assertSingleResourceBoundary` 前缀嗅探已免非 JSON parse；`HASH_PATTERN` 已模块级常量；`candidateError` 顺序化短路已最优 | 无候选 |
| `eval-routing.ts` | 见 S3-D-3；episodes 四遍（tasks map / replayAssignments map / pairedRecords / rerunHash actions 序列化）融合 = X3-2/S1-F-5 同族常数噪声；`parseEpisode` 条件 spread 临时对象 = S2-A-5 同族 ns 级；S1-D-4/9、S2-D-3/4 维持不重开 | 无候选落地 |
| `pareto.ts` | 见 S3-D-2；S1-D-6（skyline）维持；先全量校验后过滤的次序是错误行为契约 | 无候选落地 |
| `rollback.ts` | 见 S3-D-4；`RollbackLog.list()` 拷贝 = readonly 契约（X4-2 域）；`last()` O(1) 去重已最优；`validateRollbackInput` 常数遍 | 无候选落地 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 三个薄委托 / 三个 O(1) 纯函数——第三遍无新角度；`resourceIdentityKey` 按 identity 记忆化 = X1-1 域不提案 | 无候选 |
| `monitor.ts` | 见 S3-D-5；**X2-5 维持排除未触碰**（`freezeBaseline` 重算与两次 slice 均不碰）；S2-D-5 维持；observations 无界数组不可截断——snapshot/restore 契约要求全量历史 | 无候选落地 |
| `approval-profile.ts` | `validateApprovalProfile` 末段 autoPromoteClasses × neverAutoPromote 双重 includes O(a×n) 表长 ≤10 = S1-D-8 域；`createDefaultApprovalProfile` 每 preparePromotion 新建维持 R2-D 裁决（身份改变 + 共享可变风险） | 无候选 |
| `reflection.ts` | 生产无调用方（grep 复核）；`partitionEvidence` 已 Set 单遍 + cap 早退已存在；`isSelfSupported` unique 上界 evaluator 个位（S1-D-8 域） | 无候选 |
| `mutate.ts` | `adjustParameter` 两遍正则维持 R1-D「记录不改」；`escapeRegExp`/正则每次新建是 X0-6 的安全侧；`replaceSection` 单遍行扫已线性 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22.14.0，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd33d02`–`0xd33d05`，两次独立运行等价结论逐位一致、计时抖动范围内稳定）：

```text
S3-D-1 anchor L=6: one discarded ledger() copy in promote() = 38.1–41.1ns per promotion
S3-D-1 anchor L=60 (10x): one discarded copy = 40.1–43.8ns per promotion
S3-D-2 bench n=3: delta/call=21.2–23.4ns | n=10: delta/call=30.8–37.2ns
S3-D-3 bench E=200 U=1: current=355.6–381.3us dedup+guard=4.8–5.1us delta/eval-invocation=350.9–376.2us
S3-D-3 bench E=200 U=3: delta/eval-invocation=362.6–388.1us
S3-D-4 bench L=6 entries: current=~2.5us variant=~1.4us delta/registry-load=1073.0–1134.8ns
S3-D-5 bench N=32 (post-warm-up): delta/observe=66.7–70.9ns | full observe()=1572–1606ns (no production caller)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-D-1 | registry `promote()` 原子路径丢弃 `beginPromotion` 的 ledger 拷贝 | 消除即等价但 L=6 仅 ~40ns/promote；需私有 begin 变体（X1-2 类）或改公开返回契约（X0-4 类） |
| S3-D-2 | `paretoFront` 末尾 `[...front]` 冗余 spread 移除 | 等价可证（4000 fuzz + 输入纯度），但 n 个位省 ~21–37ns 且无生产调用方（S1-B-5/S2-A-5 同族） |
| S3-D-3 | eval-routing `assertReplayIsolated` readOnlyRoots 首现序去重 | 等价可证（3000 fuzz 含 overlap 反例，首错消息逐字节一致），E=200 省 ~351–388µs/eval 调用——低于否决线（S1-I-1 190µs/S2-F-3 90µs 同族已否决），一次性 CLI 被 ms 级 I/O 支配，总复杂度仍 O(E) |
| S3-D-4 | rollback `parseRollbackLedgerEntry` 外层 `copyRollbackLedgerEntry` 再拷贝消除（内联 evidence 拷贝） | 等价 + 别名安全可证，但 L=6 全载入仅 ~1.1µs，被 registry 载入重哈希与 I/O 支配 |
| S3-D-5 | monitor `report()` 死 `emptyAxes` 分配下沉冷分支 | 等价平凡（复刻管线对齐真实 monitor 后 fuzz），~70ns/observe 且 monitor 无生产调用方 |

重开条件：S3-D-3 若 (a) eval 数据集 E 增长 ≥2 个量级（E~2×10⁴ 时按本报告
测量外推 ~35–39ms，达落地线），或 (b) `assertReplayIsolated` 进入每 run 多次
的热路径，可凭本报告的等价性证据（首现序去重保首错）直接重开落地；
S3-D-1/2/4/5 需先推翻规模论证（各自数据结构增长 ≥2 个量级）或（S3-D-1）
先由战役裁定公开返回契约可变。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xd33d02`–`0xd33d05`。

```ts
/**
 * R3-D deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S3-D-1 .. S3-D-5 against the current
 * implementations in src/adaptation/. Seeded PRNG (mulberry32) -> reproducible.
 * Seeds: 0xd33d01 - 0xd33d05.
 */
import { performance } from "node:perf_hooks";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import { promoteWithRegistry } from "/workspace/src/adaptation/promotion.js";
import { paretoFront, type CandidateMetrics } from "/workspace/src/adaptation/pareto.js";
import { parseRollbackLedgerEntry, type RollbackLedgerEntry } from "/workspace/src/adaptation/rollback.js";
import {
  createAdaptationDriftMonitor,
  type DriftObservation,
  type DriftReport
} from "/workspace/src/adaptation/monitor.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import type { ResourceIdentity } from "/workspace/src/adaptation/resource.js";
import { createIsolationGuard } from "/workspace/src/experiments/isolation.js";
import { createProjectId, type IdGenerator } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";

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

const NOW = "2026-08-24T06:00:00.000Z" as IsoTimestamp;
const HUMAN = { kind: "human", identity: "operator" } as const;
const EVAL_PLAN: EvaluationPlan = { stages: ["static"], metrics: ["utility"], planVersion: 1 };

function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  };
}

/* ============================================================
 * S3-D-1: promote() discards beginPromotion's ledger copy.
 * beginPromotion returns { ..., ledger: this.ledger() } (an O(L) copy);
 * promote() only reads began.intentId, so on the atomic happy path the
 * copy is dead. Anchor the discarded-copy cost at realistic and 10x L.
 * (Eliminating it needs a private begin variant [X1-2-class duplicate
 * path] or a public-return-contract change [X0-4 class].)
 * ============================================================ */
{
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1r") });
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d1proj") }
  };
  let baseline = registry.registerBaseline({ identity, content: "v0", author: HUMAN });
  // Realistic promotion count: build a ledger of 3 promotions = 6 entries (intent+promoted each).
  for (let i = 1; i <= 3; i += 1) {
    const candidate = registry.createCandidate({
      identity,
      content: `v${i}`,
      parentVersionId: baseline.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const result = promoteWithRegistry(registry, {
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: `v${i}`,
      approvedBy: HUMAN,
      review: {
        reviewId: `rv-d1-${i}`,
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        verdict: "approved",
        reviewerKind: "independent",
        reviewerId: "critic-gate",
        actorId: HUMAN.identity,
        evidenceRefs: [`review:d1:${i}`]
      },
      changeNote: {
        scope: `prompt:d1:${i}`,
        evidence: ["static"],
        guardrails: ["proposal-first"],
        rollbackVersionId: baseline.versionId
      },
      explicitApproval: true
    });
    baseline = result.newVersion!;
  }
  const L = registry.ledger().length;
  check("S3-D-1 realistic ledger built (L=6: intent+promoted x3)", L === 6, `L=${L}`);
  // The discarded copy is exactly one ledger() call.
  const copyCost = bench(() => registry.ledger(), 100000);
  console.log(
    `S3-D-1 anchor L=${L}: one discarded ledger() copy in promote() = ${(copyCost * 1e6).toFixed(1)}ns per promotion`
  );
  // 10x scale anchor via plain array copy of same shape.
  const big = Array.from({ length: 60 }, (_, i) => ({ kind: "promoted", i }));
  const bigCost = bench(() => [...big], 100000);
  console.log(
    `S3-D-1 anchor L=60 (10x): one discarded copy = ${(bigCost * 1e6).toFixed(1)}ns per promotion`
  );
}

/* ============================================================
 * S3-D-2: paretoFront trailing `[...front]` redundant spread.
 * `front` is fresh from points.filter(); sorting it in place is
 * unobservable. Verbatim variant + equivalence fuzz + input-purity
 * probe + realistic bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd33d02);

  // Verbatim module-private logic (dominates / compareCandidateId / validation),
  // with only the spread removed.
  function dominates(a: CandidateMetrics, b: CandidateMetrics): boolean {
    const geMax = a.quality >= b.quality && a.preferenceFit >= b.preferenceFit;
    const leMin = a.costUsd <= b.costUsd && a.latencyMs <= b.latencyMs && a.risk <= b.risk;
    const strict =
      a.quality > b.quality ||
      a.preferenceFit > b.preferenceFit ||
      a.costUsd < b.costUsd ||
      a.latencyMs < b.latencyMs ||
      a.risk < b.risk;
    return geMax && leMin && strict;
  }
  function compareCandidateId(a: CandidateMetrics, b: CandidateMetrics): number {
    if (a.candidateId < b.candidateId) return -1;
    if (a.candidateId > b.candidateId) return 1;
    return 0;
  }
  function assertUnitInterval(value: number, label: string): void {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new DomainValidationError(`${label} must be a finite number in [0, 1]`);
    }
  }
  function assertNonNegativeFinite(value: number, label: string): void {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new DomainValidationError(`${label} must be a finite number >= 0`);
    }
  }
  function validateCandidateMetrics(point: CandidateMetrics): void {
    if (typeof point !== "object" || point === null) {
      throw new DomainValidationError("candidate metrics are required");
    }
    if (typeof point.candidateId !== "string" || point.candidateId.trim() === "") {
      throw new DomainValidationError("candidateId is required");
    }
    assertUnitInterval(point.quality, "quality");
    assertUnitInterval(point.preferenceFit, "preferenceFit");
    assertUnitInterval(point.risk, "risk");
    assertNonNegativeFinite(point.costUsd, "costUsd");
    assertNonNegativeFinite(point.latencyMs, "latencyMs");
  }
  function paretoFrontNoSpread(points: readonly CandidateMetrics[]): CandidateMetrics[] {
    if (!Array.isArray(points)) {
      throw new DomainValidationError("pareto points must be an array");
    }
    if (points.length === 0) return [];
    for (const point of points) validateCandidateMetrics(point);
    const front = points.filter(
      (point, index) =>
        !points.some((other, otherIndex) => otherIndex !== index && dominates(other, point))
    );
    return front.sort(compareCandidateId);
  }

  const genPoint = (i: number, dupOf?: CandidateMetrics): CandidateMetrics =>
    dupOf !== undefined
      ? { ...dupOf, candidateId: `cnd_dup${i}` }
      : {
          candidateId: `cnd_p${Math.floor(rng() * 30)}_${i}`,
          quality: Math.round(rng() * 4) / 4,
          preferenceFit: Math.round(rng() * 4) / 4,
          costUsd: Math.round(rng() * 8) / 4,
          latencyMs: Math.round(rng() * 4) * 100,
          risk: Math.round(rng() * 4) / 4
        };

  for (let trial = 0; trial < 4000; trial += 1) {
    const n = Math.floor(rng() * 12);
    const points: CandidateMetrics[] = [];
    for (let i = 0; i < n; i += 1) {
      // 20% duplicate-metric points (only ids differ) to stress tie semantics.
      const dup = points.length > 0 && rng() < 0.2 ? points[Math.floor(rng() * points.length)] : undefined;
      points.push(genPoint(trial * 100 + i, dup));
    }
    const frozenInput = JSON.stringify(points);
    const a = paretoFront(points);
    const afterA = JSON.stringify(points);
    const b = paretoFrontNoSpread(points);
    const afterB = JSON.stringify(points);
    check(
      "S3-D-2 equivalence (same elements, same order)",
      JSON.stringify(a) === JSON.stringify(b),
      `trial ${trial}`
    );
    check("S3-D-2 input purity current", afterA === frozenInput, `trial ${trial}`);
    check("S3-D-2 input purity no-spread variant", afterB === frozenInput, `trial ${trial}`);
  }

  for (const n of [3, 10]) {
    const points = Array.from({ length: n }, (_, i) => genPoint(900000 + i));
    const cur = bench(() => paretoFront(points), 50000);
    const cand = bench(() => paretoFrontNoSpread(points), 50000);
    console.log(
      `S3-D-2 bench n=${n}: current=${(cur * 1e6).toFixed(1)}ns no-spread=${(cand * 1e6).toFixed(1)}ns delta/call=${((cur - cand) * 1e6).toFixed(1)}ns`
    );
  }
}

/* ============================================================
 * S3-D-3: assertReplayIsolated readOnlyRoots dedup before
 * createIsolationGuard (episodes share originalWorkspace; the guard
 * pays 2 isInside path-resolutions per root). First-occurrence-order
 * dedup preserves the first-thrown error. Equivalence fuzz over
 * overlap/no-overlap mixes + realistic-scale bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd33d03);
  const outputRoot = "/state/adaptation/evals";
  const goodPool = ["/repos/alpha", "/repos/beta", "/data/frozen-episodes", "/repos/gamma"];
  const badPool = ["/state/adaptation/evals/inner", "/state/adaptation", "/state"];

  const runGuard = (roots: readonly string[]): string => {
    try {
      createIsolationGuard({ readOnlyRoots: roots, outputRoot });
      return "<ok>";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const dedupFirstOccurrence = (roots: readonly string[]): string[] => {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const root of roots) {
      if (!seen.has(root)) {
        seen.add(root);
        unique.push(root);
      }
    }
    return unique;
  };

  for (let trial = 0; trial < 3000; trial += 1) {
    const count = Math.floor(rng() * 24);
    const roots: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // Mostly duplicates of good workspaces; ~8% inject an overlapping root.
      roots.push(rng() < 0.08 ? pick(rng, badPool) : pick(rng, goodPool));
    }
    roots.push("/data/frozen-episodes"); // datasetDir, appended like the real call
    const current = runGuard(roots);
    const dedup = runGuard(dedupFirstOccurrence(roots));
    check("S3-D-3 equivalence (same outcome/message)", current === dedup, `trial ${trial}: ${current} vs ${dedup}`);
  }

  for (const [E, U] of [
    [200, 1],
    [200, 3]
  ] as const) {
    const workspaces = Array.from({ length: E }, (_, i) => goodPool[i % U] as string);
    const roots = [...workspaces, "/data/frozen-episodes"];
    const cur = bench(() => runGuard(roots), 2000);
    const cand = bench(() => runGuard(dedupFirstOccurrence(roots)), 2000);
    const candWithDedup = bench(() => {
      const unique = dedupFirstOccurrence(roots);
      runGuard(unique);
    }, 2000);
    console.log(
      `S3-D-3 bench E=${E} U=${U}: current=${(cur * 1e3).toFixed(1)}us guard-on-deduped=${(cand * 1e3).toFixed(1)}us dedup+guard=${(candWithDedup * 1e3).toFixed(1)}us delta/eval-invocation=${((cur - candWithDedup) * 1e3).toFixed(1)}us`
    );
  }
}

/* ============================================================
 * S3-D-4: parseRollbackLedgerEntry outer copyRollbackLedgerEntry
 * elimination. The literal passed to it is already fresh; only the
 * evidence array copy is load-bearing (asStringArray returns the input
 * JSON array by reference). Variant inlines the evidence copy and drops
 * the 7-field re-copy. Equivalence fuzz + alias-safety probe + bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd33d04);
  const KINDS = ["rolled-back", "rollback-proposed", "rollback-rejected"] as const;
  const REASONS = ["guardrail", "degradation", "user"] as const;

  function asRecordLocal(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DomainValidationError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
  }
  function asStringArrayLocal(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new DomainValidationError(`${label} must be an array of strings`);
    }
    return value as string[];
  }
  // Verbatim variant: same checks, literal built once, evidence copied inline.
  function parseNoOuterCopy(value: unknown): RollbackLedgerEntry {
    const record = asRecordLocal(value, "rollback ledger entry");
    if (typeof record.kind !== "string" || !(KINDS as readonly string[]).includes(record.kind)) {
      throw new DomainValidationError(`invalid rollback ledger kind: ${String(record.kind)}`);
    }
    if (typeof record.fromVersionId !== "string" || !/^rsv_[A-Za-z0-9_-]{1,64}$/.test(record.fromVersionId)) {
      throw new DomainValidationError("rollback fromVersionId is invalid");
    }
    if (typeof record.toVersionId !== "string" || !/^rsv_[A-Za-z0-9_-]{1,64}$/.test(record.toVersionId)) {
      throw new DomainValidationError("rollback toVersionId is invalid");
    }
    if (typeof record.reason !== "string" || !(REASONS as readonly string[]).includes(record.reason)) {
      throw new DomainValidationError(`invalid rollback reason: ${String(record.reason)}`);
    }
    if (typeof record.automatic !== "boolean") {
      throw new DomainValidationError("rollback automatic must be a boolean");
    }
    if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
      throw new DomainValidationError("rollback at must be an ISO timestamp");
    }
    return {
      kind: record.kind,
      fromVersionId: record.fromVersionId,
      toVersionId: record.toVersionId,
      reason: record.reason,
      automatic: record.automatic,
      evidence: [...asStringArrayLocal(record.evidence, "rollback evidence")],
      at: record.at
    } as unknown as RollbackLedgerEntry;
  }

  const genRaw = (i: number): Record<string, unknown> => ({
    kind: pick(rng, KINDS),
    fromVersionId: `rsv_from${i}`,
    toVersionId: `rsv_to${i}`,
    reason: pick(rng, REASONS),
    automatic: rng() < 0.5,
    evidence: Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, k) => `ev:${i}:${k}`),
    at: NOW
  });

  for (let trial = 0; trial < 3000; trial += 1) {
    const raw = genRaw(trial);
    const a = parseRollbackLedgerEntry(raw);
    const b = parseNoOuterCopy(raw);
    check("S3-D-4 equivalence", JSON.stringify(a) === JSON.stringify(b), `trial ${trial}`);
    // Alias safety: mutating the input evidence array after parse must not
    // leak into either parsed entry.
    (raw.evidence as string[]).push("ev:injected");
    check(
      "S3-D-4 alias safety (both detach evidence from input)",
      !a.evidence.includes("ev:injected") && !b.evidence.includes("ev:injected"),
      `trial ${trial}`
    );
  }

  const raws = Array.from({ length: 6 }, (_, i) => genRaw(800000 + i));
  const cur = bench(() => {
    for (const raw of raws) parseRollbackLedgerEntry(raw);
  }, 30000);
  const cand = bench(() => {
    for (const raw of raws) parseNoOuterCopy(raw);
  }, 30000);
  console.log(
    `S3-D-4 bench L=6 entries: current=${(cur * 1e6).toFixed(1)}ns variant=${(cand * 1e6).toFixed(1)}ns delta/registry-load=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * S3-D-5: monitor report() dead emptyAxes allocation after warm-up
 * (length >= windowSize path never reads it). Sink the literal into the
 * cold branch. Replicated-verbatim pipeline cross-checked against the
 * real monitor, then fuzz + bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd33d05);
  const W = 8;
  const CAL_DELTA = 0.25;

  function meanCalibration(window: readonly DriftObservation[]): number {
    let sum = 0;
    for (const item of window) sum += item.judgeCalibration;
    return window.length === 0 ? 0 : sum / window.length;
  }
  interface FrozenBaseline {
    readonly modelVersion: ReadonlySet<string>;
    readonly taskFamily: ReadonlySet<string>;
    readonly projectId: ReadonlySet<string>;
    readonly policyVersion: ReadonlySet<string>;
    readonly meanCalibration: number;
  }
  function freezeBaseline(window: readonly DriftObservation[]): FrozenBaseline {
    return {
      modelVersion: new Set(window.map((item) => item.modelVersion)),
      taskFamily: new Set(window.map((item) => item.taskFamily)),
      projectId: new Set(window.map((item) => item.projectId)),
      policyVersion: new Set(window.map((item) => item.policyVersion)),
      meanCalibration: meanCalibration(window)
    };
  }
  function mode(values: readonly string[]): string | undefined {
    const counts = new Map<string, number>();
    let best: string | undefined;
    let bestCount = 0;
    for (const value of values) {
      const next = (counts.get(value) ?? 0) + 1;
      counts.set(value, next);
      if (best === undefined || next > bestCount) {
        best = value;
        bestCount = next;
      }
    }
    return best;
  }
  function majorityUnseen(
    window: readonly DriftObservation[],
    valueOf: (obs: DriftObservation) => string,
    baseline: ReadonlySet<string>
  ): { drifted: boolean; unseenValue: string | undefined } {
    const unseen: string[] = [];
    for (const item of window) {
      const value = valueOf(item);
      if (!baseline.has(value)) unseen.push(value);
    }
    const drifted = unseen.length > window.length / 2;
    return { drifted, unseenValue: drifted ? mode(unseen) : undefined };
  }
  function formatNumber(value: number): string {
    return (Math.round(value * 1000) / 1000).toString();
  }
  function evaluateWindow(
    window: readonly DriftObservation[],
    baseline: FrozenBaseline,
    calibrationDelta: number
  ): DriftReport {
    const model = majorityUnseen(window, (item) => item.modelVersion, baseline.modelVersion);
    const task = majorityUnseen(window, (item) => item.taskFamily, baseline.taskFamily);
    const project = majorityUnseen(window, (item) => item.projectId, baseline.projectId);
    const policy = majorityUnseen(window, (item) => item.policyVersion, baseline.policyVersion);
    const calMean = meanCalibration(window);
    const calDelta = Math.abs(calMean - baseline.meanCalibration);
    const judgeCalibration = calDelta >= calibrationDelta;
    const axes = {
      modelVersion: model.drifted,
      taskMix: task.drifted,
      project: project.drifted,
      policy: policy.drifted,
      judgeCalibration
    };
    const evidence: string[] = [];
    if (model.drifted && model.unseenValue !== undefined) evidence.push(`modelVersion: unseen version ${model.unseenValue}`);
    if (task.drifted && task.unseenValue !== undefined) evidence.push(`taskMix: unseen family ${task.unseenValue}`);
    if (project.drifted && project.unseenValue !== undefined) evidence.push(`project: unseen project ${project.unseenValue}`);
    if (policy.drifted && policy.unseenValue !== undefined) evidence.push(`policy: unseen version ${policy.unseenValue}`);
    if (judgeCalibration) evidence.push(`judgeCalibration: |${formatNumber(calDelta)}| >= ${formatNumber(calibrationDelta)}`);
    const driftedCount = Object.values(axes).filter((axis) => axis).length;
    const drifted = driftedCount > 0;
    const uncertainty = drifted ? Math.min(1, driftedCount / 5) : 0;
    return { drifted, axes, uncertainty, evidence };
  }

  // Verbatim current report(): emptyAxes allocated unconditionally.
  function reportCurrent(observations: readonly DriftObservation[]): DriftReport {
    const emptyAxes = {
      modelVersion: false,
      taskMix: false,
      project: false,
      policy: false,
      judgeCalibration: false
    };
    if (observations.length < W) {
      return { drifted: false, axes: emptyAxes, uncertainty: 0, evidence: [] };
    }
    const baseline = freezeBaseline(observations.slice(0, W));
    const window = observations.slice(-W);
    return evaluateWindow(window, baseline, CAL_DELTA);
  }
  // Candidate: literal sunk into the cold branch.
  function reportSunk(observations: readonly DriftObservation[]): DriftReport {
    if (observations.length < W) {
      return {
        drifted: false,
        axes: {
          modelVersion: false,
          taskMix: false,
          project: false,
          policy: false,
          judgeCalibration: false
        },
        uncertainty: 0,
        evidence: []
      };
    }
    const baseline = freezeBaseline(observations.slice(0, W));
    const window = observations.slice(-W);
    return evaluateWindow(window, baseline, CAL_DELTA);
  }

  const genObs = (): DriftObservation => ({
    modelVersion: pick(rng, ["m1", "m2", "m3-new"]),
    taskFamily: pick(rng, ["edit", "test", "review", "novel-family"]),
    projectId: pick(rng, ["prj_x", "prj_y"]),
    policyVersion: pick(rng, ["pol1", "pol2"]),
    judgeCalibration: Math.round(rng() * 100) / 100
  });

  // Cross-check the replicated pipeline against the real monitor, then fuzz
  // the two variants against each other.
  for (let trial = 0; trial < 400; trial += 1) {
    const monitor = createAdaptationDriftMonitor();
    const stream: DriftObservation[] = [];
    const steps = Math.floor(rng() * 24);
    for (let i = 0; i < steps; i += 1) {
      const obs = genObs();
      const real = monitor.observe(obs);
      stream.push(obs);
      const cur = reportCurrent(stream);
      const sunk = reportSunk(stream);
      check(
        "S3-D-5 replication matches real monitor",
        JSON.stringify(real) === JSON.stringify(cur),
        `trial ${trial} step ${i}`
      );
      check(
        "S3-D-5 equivalence current vs sunk",
        JSON.stringify(cur) === JSON.stringify(sunk),
        `trial ${trial} step ${i}`
      );
    }
  }

  const warm = Array.from({ length: 32 }, genObs);
  const cur = bench(() => reportCurrent(warm), 100000);
  const sunk = bench(() => reportSunk(warm), 100000);
  const observeCost = (() => {
    const monitor = createAdaptationDriftMonitor();
    for (const obs of warm) monitor.observe(obs);
    return bench(() => monitor.observe(warm[0] as DriftObservation), 20000);
  })();
  console.log(
    `S3-D-5 bench N=32 (post-warm-up): report current=${(cur * 1e6).toFixed(1)}ns sunk=${(sunk * 1e6).toFixed(1)}ns delta/observe=${((cur - sunk) * 1e6).toFixed(1)}ns | full observe()=${(observeCost * 1e6).toFixed(1)}ns (no production caller)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

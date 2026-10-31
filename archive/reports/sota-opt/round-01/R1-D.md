MODEL_SLUG=claude-fable-5-thinking-xhigh

# R1-D：`src/adaptation/` 全量 SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-D（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `82bef36`
**分支:** `cursor/r1-d-adaptation-opt-41f0`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** 对 `src/adaptation/` 全部 14 个文件逐一
通读并以新视角枚举，得到 9 个此前排除表未点名的候选（S1-D-1 … S1-D-9），全部
经理论 + 确定性仿真（seeded mulberry32，等价性 fuzz / 发散反例 / 真实规模基准）
裁决后淘汰：2 个不等价（有可观察发散反例），7 个在真实规模是噪声级（其中 1 个
实测反而更慢，复现 S1-A-4 的反向教训）。自适应面是**人审门控的低频控制面**，
其全部数据结构在真实运行中为个位~十位数规模；已落地的 promotion-rules 拆环与
gatedComparison 薄包装未重做。本切片现状即为该控制面契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、promotion-rules、
  candidate、eval-routing、pareto、rollback、resource、active-pointer、monitor、
  retirement、approval-profile、reflection、mutate，共约 3200 行）全量读码。
- 已落地项未重做：promotion-rules 拆环（§4.2 三线报告）、gatedComparisonReport
  薄包装（eval-routing 保留 6 行 `gatedComparison` 包装）、
  `loadAdaptationRegistryOrNew`。
- 排除表遵守：**X2-5（drift monitor 基线缓存）维持排除未触碰**——`monitor.ts`
  每 observe 重算 `freezeBaseline` 的候选即 X2-5，本轮直接跳过；X1-1（隐藏缓存）、
  X0-4（公开签名增量化）、X1-2（第二公开入口）、X0-5（合并 asRecord/asArray，
  错误消息被测试断言）同样全部绕开。
- 晋升提案优先、权限/安全/凭据永不自动晋升（`autoPromotableFor` 由 kind 派生）、
  CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）全部不变——
  零 diff，天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放。

## 1. 现实规模测量（门槛第 3 条的证据基底）

adaptation 面没有热路径：registry 只经 CLI（`adapt status/learn/auto/eval/
promote/rollback`）与 learning auto-loop/from-episode 在**每次进程调用**时
从磁盘载入→单次操作→保存。实测/结构规模：

- **每 identity 版本数 V**：baseline + 人审晋升数。验收测试全程 2；真实运行
  个位数（晋升需 human `--approve` + 独立 review + evalReport）。
- **候选数 C**：auto-loop 按 `contentHash` 去重后才创建；个位~十位数。
- **pendingByIntent**：正常路径 begin→commit 内清空，仅 crash 残留，0~个位。
- **promotion/rollback ledger**：每晋升 1~2 条、每回滚 1 条，个位~十位数。
- **paretoFront n** ≤ `budget.maxCandidatesPerEpoch`（验收测试 n=3）。
- **eval-routing catalog M = 2~3**（`catalogFromPrimary` 只产 primary+fast）。
- **唯一可增长维度是 eval 数据集 E**（episodes）：该路径除 `catalogCost` 的
  O(E×M)（M≤3）外全线性，且被 `assignTasks`（全量路由分析 ×2）与
  `rerunHash` 的 `stableStringify`（O(E) 固有）支配。
- **monitor windowSize 默认 8**：每 observe 成本 O(W)=常数，与积累量无关。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-D-1 | `registry.addVersion` 追加拷贝改可变 push | 总量 O(V²)→O(V) | ❌ **发散反例**（别名可观察） | V=6 全程仅省 204~284ns | 淘汰:不等价 + 噪声 |
| S1-D-2 | `candidatesFor` 建 identity 二级索引 | O(C)→O(1)/查 | ✅ 注入性 48,400 对 + 等价 2,400 查 fuzz 一致 | **C=8 实测更慢**（-7~-12ns）;C=800 才省 9.4~10.5µs | 淘汰:S1-A-4 同向反例 |
| S1-D-3 | `reconstructPromotion` 反向早退 | O(L)→O(距末条 promoted) | ✅ 4,000 fuzz（含无 promoted 抛错路径）一致 | L=6 省 14~26ns;**无生产调用方** | 淘汰:噪声 |
| S1-D-4 | eval-routing `catalogCost` `models.find` 换 Map | O(E×M)→O(M+E) | ✅ 逐模型同值 + 未知模型错误逐字节一致 | 真实 M=2:E=200 数据集**全程**仅省 0.07~0.09µs | 淘汰:X1-4 同类噪声 |
| S1-D-5 | `Array.from(values())` 改直接迭代（candidatesFor / preparePromotion in-flight 扫描 / snapshot） | 免一次数组分配 | —（平凡） | n=8 省 17~20ns/次 | 淘汰:S1-F-5 同类噪声 |
| S1-D-6 | `paretoFront` O(n²) 支配检查换排序/分治 skyline | O(n²·d)→O(n log n) 级 | —（未实现:5 维不可比 + 重复点语义风险高） | **全函数上界**:n=3 共 377~421ns、n=10 <1µs——任何收益 < 该值 | 淘汰:噪声（上界论证） |
| S1-D-7 | `promoteWithRegistry`/`PromotionService` 外层 `assertRoutingPolicyEvalReport` 去重 | 免 1 次校验 + 1 次 hash32 | ❌ **发散反例**（抛错次序可观察） | 亚微秒 | 淘汰:不等价 |
| S1-D-8 | 小表 `includes` 换 Set/Map（approval-profile / resource / rollback / promotion 解析器 / reflection `isSelfSupported`） | O(表长)→O(1) | —（平凡） | 表长 ≤10;`validateApprovalProfile` 全程 127~134ns | 淘汰:S1-A-8/X1-4 同类噪声 |
| S1-D-9 | eval-routing `parseRoutingPolicyContent` 双 JSON.parse 消除 | 免 2 次解析/eval 调用 | —（需改切片外公开签名） | 256B 策略单次 parse ~850ns，每 eval 共 ~1.7µs | 淘汰:X0-4/X1-2 同类 + 噪声 |

## 3. 关键裁决细节

### S1-D-1 的发散反例（最强渐近候选为何不等价）

`versionsFor` 把 `versionsByKey` 的内部数组**按引用**返回
（`readonly ResourceVersion[]` 只是编译期标注）。现行 copy-on-write
（`this.versionsByKey.set(key, [...existing, version])`）保证调用方持有的
数组在后续 `addVersion` 后**不变**；可变 push 会让它可观察地增长：

```text
current (copy-on-write): held = versionsFor(identity); promote(); held.length == 1
candidate (mutable push): held2 = get(key);            addPush(); held2.length == 2
-> NOT behavior-preserving（X4-2 / S1-F-3 同类）
```

变体「保持内部可变、`versionsFor` 返回拷贝」则让相邻两次调用返回不同对象
引用（`===` 可观察），属 S1-A-7 同类身份改变，且只是把 O(V) 拷贝从写侧挪到
读侧。真实 V 为个位数（晋升人审门控），V=6 时整个注册表生命周期的拷贝总量
455ns——即使等价也在噪声之下。两条改法均淘汰。

### S1-D-2 的反向教训（理论被仿真推翻，S1-A-4 同向）

`candidatesFor` 是切片内唯一的按身份线性过滤。二级索引 `candidatesByKey` 的
等价性本轮已证充分：`resourceIdentityKey` 对合法 identity **注入**（kind 为
无 `|` 枚举；projectId 受 `prj_[A-Za-z0-9_-]{1,64}` 约束不含 `|`；两种
scopeKey 均不含 `|`，故 `name|scopeKey` 拼接可从右侧唯一切分）——48,400 对
随机身份（name 池刻意含 `|`、`|user-global`、`|project:prj_x` 等对抗串）上
`identityEquals(a,b) ⇔ key(a)===key(b)` 无一反例；分组保插入序，2,400 次查询
逐元素一致。但基准显示 **C=8（真实规模）时索引路径反而慢 7~12ns/次**——
Map 哈希查找 + 防御拷贝的固定开销高于 8 次 `identityEquals` 短路比较；且索引
是须与 `createCandidate`/`updateCandidateStatus`/`commitPromotion`/`restore`
四条变异路径同步的第二结构。C=800（100×）才有 9.4~10.5µs 收益，而
`candidatesFor` 每次 auto-loop 进程调用仅 1 次。淘汰。

### S1-D-7 的发散反例（防御纵深不是冗余）

`promoteWithRegistry` 在 `registry.promote` 之前先跑一次
`assertRoutingPolicyEvalReport`，`preparePromotion` 内还会再跑——看似可去重。
但两处的**校验次序不同**：外层先查 evalReport，内层先查 changeNote。构造
双故障输入（evalReport 缺失 + changeNote.evidence 为空）：

```text
with outer check    -> "routing-policy promote requires evalReport"
without outer check -> "change note must include evidence"
```

抛错消息可观察发散，去重不保行为。该结构同时是 registry 直用方（不经
promoteWithRegistry）的 fail-closed 兜底，与 R1-A 对 `mapGateDirective`
FAIL_CLOSED 默认的裁决同向：保留。

### 逐文件收口（切片其余面）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S1-D-1/2/5;`rollback` 的 `knownTargets.some` 与后续 `identityEquals` 双重校验是 fail-closed 本体;`preparePromotion` 中第二次 `review.candidateId` 检查在前置组合检查下不可达——防御纵深，与 R1-A mapGateDirective 同判**保留**;失败路径上 `putContent` 已落 content 进 `contentsByHash` 属可观察状态（snapshot 含 contents），调整校验次序不保行为 | 无候选落地 |
| `promotion.ts` | 见 S1-D-3;解析器错误消息被测试断言（X0-5 同域）;`saveAdaptationRegistry` 临时文件 + fsync + 原子 rename 是数据面契约 | 无候选 |
| `promotion-rules.ts` | `isPromotableStatus` includes 表长 3（S1-D-8）;`assertRoutingPolicyEvalReport` 每次重算 `hashCandidateContent` 是 CAS fail-closed 契约（与 gate-apply 双 hash 同类，不可缓存＝X1-1） | 无候选 |
| `candidate.ts` | `assertAcyclicLineage` 沿父链已用 visited Set;`assertSingleResourceBoundary` 单次 JSON.parse + 常数遍 | 无候选 |
| `eval-routing.ts` | 见 S1-D-4/9;`replayAssignments`/`pairedRecords` 单遍;`rerunHash` 的 `stableStringify` O(E) 为字节稳定序列化契约;`assertNoForbiddenFields` 递归下降 O(策略节点数)，策略为 KB 级 | 无候选 |
| `active-pointer.ts` | 三个 O(1) 纯函数 | 无候选 |
| `pareto.ts` | 见 S1-D-6;先全量校验后过滤的次序是错误行为（任一非法点必抛）的一部分 | 无候选 |
| `rollback.ts` | `RollbackLog.list()` 每次拷贝是 readonly 契约（X4-2 同域）;`restore`/`parseRollbackLedgerEntry` 的防御性拷贝为数据面;degradation 去重只看 `last()`，O(1) | 无候选 |
| `resource.ts` / `retirement.ts` | 常量表 + O(1) 谓词 / 三个薄委托 | 无候选 |
| `monitor.ts` | 每 observe 重算 `freezeBaseline` ＝ **X2-5，维持排除不触碰**;除此之外每 observe O(W)=8 常数，`slice` 不随积累量增长 | 无候选（X2-5 遵守） |
| `approval-profile.ts` | 见 S1-D-8;`canAutoPromote` 六道短路检查次序是规格语义 | 无候选 |
| `reflection.ts` | `partitionEvidence` 已 Set 去重单遍;`isSelfSupported` unique 数组上界为 evaluator 数（个位，见 S1-D-8）;`proposeCandidates` 受 budget cap 上界 | 无候选 |
| `mutate.ts` | `replaceSection` 单遍行扫;`adjustParameter` match(/gm)+replace(/m) 两遍正则可并一遍——一次性变异操作、内容 KB 级，常数噪声，**记录不改**;每次调用新建正则与 X0-6 同理（无状态风险的反面:每次新建是安全侧） | 记录不改 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 5. 测试

零代码改动下相关套件基线复核，全绿（Node 22.22.2，与 R1-J 环境注记同）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现，两次独立运行等价
结论逐位一致、计时抖动范围内稳定）：

```text
S1-D-1 counterexample: copy-on-write held.length=1 vs push-variant held.length=2 -> NOT behavior-preserving
S1-D-1 bench V=6: copy-append total=455.3ns push total=251.2ns delta=204.1ns
S1-D-7 counterexample: with outer check -> "routing-policy promote requires evalReport" | without -> "change note must include evidence"
S1-D-2 bench C=8: current=128.5ns indexed=140.5ns delta/call=-11.9ns | C=800: delta=10546.0ns
S1-D-3 bench L=6: current=175.3ns backward=161.4ns delta=13.9ns (no production caller)
S1-D-4 bench E=200 episodes (2E lookups, M=2): current=1.47us indexed=1.40us delta/eval-invocation=0.07us
S1-D-6 anchor paretoFront n=3: 376.6ns | n=10: 928.2ns per call (total cost bounds any possible gain)
S1-D-5 anchor n=8: Array.from=45.7ns direct=26.2ns delta=19.5ns per call
S1-D-8 anchor: validateApprovalProfile=133.6ns canAutoPromote=39.8ns per call (tables <= 10)
S1-D-9 anchor: one redundant JSON.parse of a realistic policy (256B) = 857.3ns, twice per eval invocation
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-D-1 | registry `addVersion` 追加拷贝改可变 push / `versionsFor` 改返回拷贝 | 不等价:`versionsFor` 返回内部数组引用，push 使调用方持有数组可观察增长（反例 1 vs 2，X4-2/S1-F-3 同类）;返回拷贝改对象身份（S1-A-7 同类）;V 个位数收益亦噪声 |
| S1-D-2 | `candidatesFor` 建 identity 二级索引（candidatesByKey） | 等价可证（key 注入性 + 48,400 对 fuzz），但 C=8 实测更慢（S1-A-4 同向）;须与 4 条变异路径同步的第二结构 |
| S1-D-3 | `reconstructPromotion` 反向早退 | 任意输入等价（非 S1-A-9 型），但 L 个位数、省 ~20ns、无生产调用方 |
| S1-D-4 | eval-routing `catalogCost` `models.find` 换 Map | X1-4 同类;真实 catalog M=2~3，E=200 数据集全程仅省 <0.1µs |
| S1-D-5 | registry `Array.from(values())` 改直接迭代 | S1-F-5 同类常数噪声（n=8 省 ~20ns/次） |
| S1-D-6 | `paretoFront` O(n²) 支配检查换排序/分治 skyline | n ≤ maxCandidatesPerEpoch 个位数;n=3 全函数 <0.5µs 为收益上界;5 维不可比+重复点语义风险（S1-A-4 教训） |
| S1-D-7 | promoteWithRegistry/PromotionService 外层 assertRoutingPolicyEvalReport 去重 | 不等价:多故障输入抛错次序可观察（反例两条不同消息）;registry 直用方的 fail-closed 兜底 |
| S1-D-8 | adaptation 各小表 `includes` 换 Set/Map（approval-profile/resource/rollback/promotion 解析/isSelfSupported） | 表长 ≤10、低频（validate 全程 ~130ns），S1-A-8/X1-4 同类 |
| S1-D-9 | eval-routing `parseRoutingPolicyContent` 双 JSON.parse 消除 | 需改 learning 公开签名或开第二入口（X0-4/X1-2 同类）;每 eval 共 ~1.7µs 噪声 |

重开条件：S1-D-2/4 若候选数或 catalog/数据集规模增长 ≥2 个量级可凭本报告
等价性证据重开；S1-D-1/7 需先推翻本报告的发散反例（即先改 `versionsFor`
返回语义或统一两处校验次序——均为行为变更，不属保行为优化）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xd11d01`–`0xd11d09`。

```ts
/**
 * R1-D deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-D-1 .. S1-D-9 against the current
 * implementations in src/adaptation/. Seeded PRNG (mulberry32) -> reproducible.
 */
import { performance } from "node:perf_hooks";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  reconstructPromotion,
  type PromoteInput,
  type PromotionLedgerEntry
} from "/workspace/src/adaptation/promotion.js";
import { paretoFront, type CandidateMetrics } from "/workspace/src/adaptation/pareto.js";
import { resourceIdentityKey } from "/workspace/src/adaptation/active-pointer.js";
import {
  identityEquals,
  RESOURCE_KINDS,
  type ResourceIdentity,
  type ResourceVersion
} from "/workspace/src/adaptation/resource.js";
import {
  canAutoPromote,
  createDefaultApprovalProfile,
  validateApprovalProfile
} from "/workspace/src/adaptation/approval-profile.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import { createProjectId, type IdGenerator } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { catalogFromPrimary, DEFAULT_PRIMARY_MODEL_ID } from "/workspace/src/routing/primary-catalog.js";
import type { ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";

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

const NOW = "2026-08-15T17:00:00.000Z" as IsoTimestamp;
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
 * S1-D-1: registry.addVersion copy-on-append -> mutable push.
 * Soundness counterexample: versionsFor returns the internal array
 * by reference; copy-on-write keeps caller-held arrays frozen, a
 * mutable push would grow them (observable divergence).
 * ============================================================ */
{
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1a") });
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d1proj") }
  };
  const baseline = registry.registerBaseline({ identity, content: "v1", author: HUMAN });
  const held = registry.versionsFor(identity); // caller-held snapshot alias
  const candidate = registry.createCandidate({
    identity,
    content: "v2",
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  promoteWithRegistry(registry, {
    candidateId: candidate.candidateId,
    expectedCurrentVersionId: baseline.versionId,
    content: "v2",
    approvedBy: HUMAN,
    review: {
      reviewId: "rv-d1",
      candidateId: candidate.candidateId,
      contentHash: candidate.contentHash,
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-gate",
      actorId: HUMAN.identity,
      evidenceRefs: ["review:d1"]
    },
    changeNote: {
      scope: "prompt:d1",
      evidence: ["static"],
      guardrails: ["proposal-first"],
      rollbackVersionId: baseline.versionId
    },
    explicitApproval: true
  });
  check("S1-D-1 current: caller-held versionsFor array is immutable across addVersion", held.length === 1);
  check("S1-D-1 current: registry now has 2 versions", registry.versionsFor(identity).length === 2);

  // Candidate variant: verbatim addVersion with mutable push.
  const byKey = new Map<string, ResourceVersion[]>();
  const addPush = (version: ResourceVersion): void => {
    const key = resourceIdentityKey(version.identity);
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, [version]);
    else existing.push(version);
  };
  const v1 = { ...baseline };
  addPush(v1);
  const held2 = byKey.get(resourceIdentityKey(identity)) as ResourceVersion[];
  addPush({ ...baseline, versionId: "rsv_other" as ResourceVersion["versionId"] });
  check("S1-D-1 push variant: caller-held array GROWS (observable divergence)", held2.length === 2);
  console.log(
    `S1-D-1 counterexample: copy-on-write held.length=${held.length} vs push-variant held.length=${held2.length} -> NOT behavior-preserving`
  );

  // Cost anchor at realistic scale (V versions of one identity).
  for (const V of [6, 600]) {
    const versions: ResourceVersion[] = Array.from({ length: V }, (_, i) => ({
      ...baseline,
      versionId: `rsv_v${i}` as ResourceVersion["versionId"]
    }));
    const copyCost = bench(() => {
      const m = new Map<string, readonly ResourceVersion[]>();
      const key = resourceIdentityKey(identity);
      for (const v of versions) {
        const existing = m.get(key) ?? [];
        m.set(key, [...existing, v]);
      }
    }, V > 100 ? 200 : 20000);
    const pushCost = bench(() => {
      const m = new Map<string, ResourceVersion[]>();
      const key = resourceIdentityKey(identity);
      for (const v of versions) {
        const arr = m.get(key);
        if (arr === undefined) m.set(key, [v]);
        else arr.push(v);
      }
    }, V > 100 ? 200 : 20000);
    console.log(
      `S1-D-1 bench V=${V}: copy-append total=${(copyCost * 1e6).toFixed(1)}ns push total=${(pushCost * 1e6).toFixed(1)}ns delta=${((copyCost - pushCost) * 1e6).toFixed(1)}ns`
    );
  }
}

/* ============================================================
 * S1-D-7: promoteWithRegistry outer assertRoutingPolicyEvalReport
 * dedup -> error-order divergence counterexample on multi-fault input.
 * ============================================================ */
{
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d7a") });
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => "d7proj") }
  };
  const content1 = JSON.stringify({ primaryModelId: "m-base", avoid: [], prefer: [] });
  const content2 = JSON.stringify({ primaryModelId: "m-cand", avoid: [], prefer: [] });
  const baseline = registry.registerBaseline({ identity, content: content1, author: HUMAN });
  const candidate = registry.createCandidate({
    identity,
    content: content2,
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  // Multi-fault input: evalReport missing AND changeNote.evidence empty.
  const badInput: PromoteInput = {
    candidateId: candidate.candidateId,
    expectedCurrentVersionId: baseline.versionId,
    content: content2,
    approvedBy: HUMAN,
    review: {
      reviewId: "rv-d7",
      candidateId: candidate.candidateId,
      contentHash: candidate.contentHash,
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-gate",
      actorId: HUMAN.identity,
      evidenceRefs: ["review:d7"]
    },
    changeNote: {
      scope: "routing:d7",
      evidence: [],
      guardrails: ["proposal-first"],
      rollbackVersionId: baseline.versionId
    },
    explicitApproval: true
  };
  const capture = (fn: () => void): string => {
    try {
      fn();
      return "<no error>";
    } catch (error) {
      check("S1-D-7 error class", error instanceof DomainValidationError);
      return (error as Error).message;
    }
  };
  const withOuter = capture(() => promoteWithRegistry(registry, badInput));
  const withoutOuter = capture(() => registry.promote(badInput));
  check(
    "S1-D-7 counterexample: outer-check removal changes the thrown error",
    withOuter !== withoutOuter,
    `${withOuter} vs ${withoutOuter}`
  );
  console.log(
    `S1-D-7 counterexample: with outer check -> "${withOuter}" | without -> "${withoutOuter}" -> observable divergence`
  );
}

/* ============================================================
 * S1-D-2: candidatesFor identity index (candidatesByKey).
 * Key-injectivity probe + equivalence fuzz + realistic-scale bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd11d02);
  const namePool = [
    "a",
    "main-agent-prompt",
    "a|b",
    "a|user-global",
    "n|project:prj_x",
    "x|project:prj_x|user-global",
    "routing-policy|z",
    "|",
    "||user-global"
  ];
  const projectIds = ["p1", "p2", "a_b-C9"].map((suffix) => createProjectId(() => suffix));
  const genIdentity = (): ResourceIdentity => ({
    kind: pick(rng, RESOURCE_KINDS),
    name: pick(rng, namePool),
    scope: rng() < 0.5 ? { kind: "user-global" } : { kind: "project", projectId: pick(rng, projectIds) }
  });

  // Injectivity: identityEquals(a,b) <=> key(a)===key(b) for valid identities.
  const identities = Array.from({ length: 220 }, genIdentity);
  for (let i = 0; i < identities.length; i += 1) {
    for (let j = 0; j < identities.length; j += 1) {
      const a = identities[i] as ResourceIdentity;
      const b = identities[j] as ResourceIdentity;
      check(
        "S1-D-2 key injectivity",
        identityEquals(a, b) === (resourceIdentityKey(a) === resourceIdentityKey(b)),
        `${resourceIdentityKey(a)} vs ${resourceIdentityKey(b)}`
      );
    }
  }

  // Equivalence fuzz: filter-based candidatesFor vs key-indexed lookup.
  interface FakeCandidate {
    readonly candidateId: string;
    readonly identity: ResourceIdentity;
  }
  const currentCandidatesFor = (
    map: Map<string, FakeCandidate>,
    identity: ResourceIdentity
  ): FakeCandidate[] => {
    const matching: FakeCandidate[] = [];
    for (const candidate of Array.from(map.values())) {
      if (identityEquals(candidate.identity, identity)) matching.push(candidate);
    }
    return matching;
  };
  const indexedCandidatesFor = (
    index: Map<string, FakeCandidate[]>,
    identity: ResourceIdentity
  ): FakeCandidate[] => [...(index.get(resourceIdentityKey(identity)) ?? [])];

  for (let trial = 0; trial < 400; trial += 1) {
    const count = Math.floor(rng() * 16);
    const map = new Map<string, FakeCandidate>();
    const index = new Map<string, FakeCandidate[]>();
    for (let i = 0; i < count; i += 1) {
      const cand: FakeCandidate = { candidateId: `cnd_${trial}_${i}`, identity: genIdentity() };
      map.set(cand.candidateId, cand);
      const key = resourceIdentityKey(cand.identity);
      const bucket = index.get(key);
      if (bucket === undefined) index.set(key, [cand]);
      else bucket.push(cand);
    }
    for (let q = 0; q < 6; q += 1) {
      const query = genIdentity();
      const a = currentCandidatesFor(map, query);
      const b = indexedCandidatesFor(index, query);
      check(
        "S1-D-2 equivalence (same elements, same order)",
        a.length === b.length && a.every((item, k) => item === b[k]),
        `trial ${trial}`
      );
    }
  }

  // Bench at realistic scale (C=8) and 100x (C=800), index prebuilt.
  for (const C of [8, 800]) {
    const map = new Map<string, FakeCandidate>();
    const index = new Map<string, FakeCandidate[]>();
    for (let i = 0; i < C; i += 1) {
      const cand: FakeCandidate = { candidateId: `cnd_b${i}`, identity: genIdentity() };
      map.set(cand.candidateId, cand);
      const key = resourceIdentityKey(cand.identity);
      const bucket = index.get(key);
      if (bucket === undefined) index.set(key, [cand]);
      else bucket.push(cand);
    }
    const query = (map.get("cnd_b0") as FakeCandidate).identity;
    const cur = bench(() => currentCandidatesFor(map, query), C > 100 ? 2000 : 50000);
    const idx = bench(() => indexedCandidatesFor(index, query), C > 100 ? 2000 : 50000);
    console.log(
      `S1-D-2 bench C=${C}: current=${(cur * 1e6).toFixed(1)}ns indexed=${(idx * 1e6).toFixed(1)}ns delta/call=${((cur - idx) * 1e6).toFixed(1)}ns (1 call per auto-loop invocation)`
    );
  }
}

/* ============================================================
 * S1-D-3: reconstructPromotion backward early-exit.
 * Equivalence fuzz (any input order) + bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd11d03);
  function backwardReconstruct(ledger: readonly PromotionLedgerEntry[]): unknown {
    let last: PromotionLedgerEntry | undefined;
    for (let i = ledger.length - 1; i >= 0; i -= 1) {
      const entry = ledger[i] as PromotionLedgerEntry;
      if (entry.kind === "promoted") {
        last = entry;
        break;
      }
    }
    if (last === undefined) {
      throw new DomainValidationError("promotion ledger has no promoted entry");
    }
    return {
      parentVersionId: last.fromVersionId,
      candidateId: last.candidateId,
      expectedCurrentVersionId: last.expectedCurrentVersionId,
      ...(last.toVersionId !== undefined ? { toVersionId: last.toVersionId } : {}),
      approvedBy: last.approvedBy,
      rollbackVersionId: last.changeNote.rollbackVersionId
    };
  }
  const genEntry = (i: number): PromotionLedgerEntry =>
    ({
      kind: pick(rng, ["promoted", "rejected", "intent"] as const),
      candidateId: `cnd_${i}`,
      fromVersionId: `rsv_from${i}`,
      ...(rng() < 0.8 ? { toVersionId: `rsv_to${i}` } : {}),
      expectedCurrentVersionId: `rsv_exp${i}`,
      approvedBy: HUMAN,
      changeNote: {
        scope: "s",
        evidence: ["e"],
        guardrails: ["g"],
        rollbackVersionId: `rsv_rb${i}`
      },
      at: NOW
    }) as unknown as PromotionLedgerEntry;
  for (let trial = 0; trial < 4000; trial += 1) {
    const ledger = Array.from({ length: Math.floor(rng() * 12) }, (_, i) => genEntry(i));
    let a: unknown;
    let aErr: string | undefined;
    let b: unknown;
    let bErr: string | undefined;
    try {
      a = reconstructPromotion(ledger);
    } catch (error) {
      aErr = (error as Error).message;
    }
    try {
      b = backwardReconstruct(ledger);
    } catch (error) {
      bErr = (error as Error).message;
    }
    check(
      "S1-D-3 equivalence",
      JSON.stringify(a) === JSON.stringify(b) && aErr === bErr,
      `trial ${trial}`
    );
  }
  const realistic = Array.from({ length: 6 }, (_, i) => genEntry(i));
  realistic[3] = { ...realistic[3], kind: "promoted" } as PromotionLedgerEntry;
  const cur = bench(() => {
    try {
      reconstructPromotion(realistic);
    } catch {
      /* no promoted entry */
    }
  }, 50000);
  const cand = bench(() => {
    try {
      backwardReconstruct(realistic);
    } catch {
      /* no promoted entry */
    }
  }, 50000);
  console.log(
    `S1-D-3 bench L=6: current=${(cur * 1e6).toFixed(1)}ns backward=${(cand * 1e6).toFixed(1)}ns delta=${((cur - cand) * 1e6).toFixed(1)}ns (no production caller)`
  );
}

/* ============================================================
 * S1-D-4: eval-routing catalogCost models.find -> Map.
 * Equivalence + bench at dataset scale (M = real catalog size).
 * ============================================================ */
{
  const catalog: ModelRouterConfig = catalogFromPrimary({ primaryModelId: DEFAULT_PRIMARY_MODEL_ID });
  const M = catalog.models.length;
  function catalogCostCurrent(cfg: ModelRouterConfig, modelId: string): number {
    const model = cfg.models.find((entry) => entry.id === modelId);
    if (model === undefined) {
      throw new DomainValidationError(`selected model ${modelId} is not in the catalog`);
    }
    return model.estimatedCostUsd;
  }
  const costById = new Map(catalog.models.map((entry) => [entry.id, entry.estimatedCostUsd]));
  function catalogCostIndexed(modelId: string): number {
    const cost = costById.get(modelId);
    if (cost === undefined) {
      throw new DomainValidationError(`selected model ${modelId} is not in the catalog`);
    }
    return cost;
  }
  for (const model of catalog.models) {
    check("S1-D-4 equivalence", catalogCostCurrent(catalog, model.id) === catalogCostIndexed(model.id));
  }
  let curUnknown = "";
  let idxUnknown = "";
  try {
    catalogCostCurrent(catalog, "nope");
  } catch (error) {
    curUnknown = (error as Error).message;
  }
  try {
    catalogCostIndexed("nope");
  } catch (error) {
    idxUnknown = (error as Error).message;
  }
  check("S1-D-4 unknown-model error equal", curUnknown === idxUnknown);
  const rng = mulberry32(0xd11d04);
  const E = 200;
  const ids = Array.from({ length: 2 * E }, () => pick(rng, catalog.models).id);
  const cur = bench(() => {
    for (const id of ids) catalogCostCurrent(catalog, id);
  }, 5000);
  const idx = bench(() => {
    for (const id of ids) catalogCostIndexed(id);
  }, 5000);
  console.log(
    `S1-D-4 bench E=${E} episodes (2E lookups, M=${M}): current=${(cur * 1e3).toFixed(2)}us indexed=${(idx * 1e3).toFixed(2)}us delta/eval-invocation=${((cur - idx) * 1e3).toFixed(2)}us`
  );
}

/* ============================================================
 * S1-D-6: paretoFront total-cost upper bound at realistic n.
 * ============================================================ */
{
  const rng = mulberry32(0xd11d06);
  const genPoint = (i: number): CandidateMetrics => ({
    candidateId: `cnd_p${i}`,
    quality: rng(),
    preferenceFit: rng(),
    costUsd: rng() * 2,
    latencyMs: rng() * 5000,
    risk: rng()
  });
  for (const n of [3, 10, 100]) {
    const points = Array.from({ length: n }, (_, i) => genPoint(i));
    const cost = bench(() => paretoFront(points), n > 50 ? 2000 : 20000);
    console.log(
      `S1-D-6 anchor paretoFront n=${n}: ${(cost * 1e6).toFixed(1)}ns per call (total cost bounds any possible gain)`
    );
  }
}

/* ============================================================
 * S1-D-5: Array.from(values()) vs direct iteration anchor (C=8).
 * ============================================================ */
{
  const map = new Map<string, { v: number }>();
  for (let i = 0; i < 8; i += 1) map.set(`k${i}`, { v: i });
  const viaArray = bench(() => {
    let acc = 0;
    for (const item of Array.from(map.values())) acc += item.v;
    return acc;
  }, 100000);
  const direct = bench(() => {
    let acc = 0;
    for (const item of map.values()) acc += item.v;
    return acc;
  }, 100000);
  console.log(
    `S1-D-5 anchor n=8: Array.from=${(viaArray * 1e6).toFixed(1)}ns direct=${(direct * 1e6).toFixed(1)}ns delta=${((viaArray - direct) * 1e6).toFixed(1)}ns per call`
  );
}

/* ============================================================
 * S1-D-8: approval-profile small-table membership anchor.
 * ============================================================ */
{
  const profile = createDefaultApprovalProfile();
  const validate = bench(() => validateApprovalProfile(profile), 100000);
  const auto = bench(() => canAutoPromote(profile, "prompt", 0), 100000);
  console.log(
    `S1-D-8 anchor: validateApprovalProfile=${(validate * 1e6).toFixed(1)}ns canAutoPromote=${(auto * 1e6).toFixed(1)}ns per call (tables <= 10)`
  );
}

/* ============================================================
 * S1-D-9: duplicate JSON.parse in parseRoutingPolicyContent anchor.
 * ============================================================ */
{
  const policy = JSON.stringify({
    primaryModelId: "gpt-large-v3",
    avoid: [
      { modelId: "m-a", taskFamily: "edit", reason: "deterministic FAIL" },
      { modelId: "m-b", taskFamily: "test", reason: "deterministic FAIL" }
    ],
    prefer: [{ modelId: "m-c", taskFamily: "refactor", reason: "cheaper PASS" }]
  });
  const parse = bench(() => JSON.parse(policy), 100000);
  console.log(
    `S1-D-9 anchor: one redundant JSON.parse of a realistic policy (${policy.length}B) = ${(parse * 1e6).toFixed(1)}ns, twice per eval invocation`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

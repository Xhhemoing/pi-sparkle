MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-D：`src/adaptation/` 复查报告（Round 1 同区第二遍）

**战役:** 全库持久 SOTA 优化 Round 2 / R2-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `6ef886e`
**分支:** `cursor/r2-d-adaptation-reaudit-1b42`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）以来**逐字节未变**（`git diff 82bef36..6ef886e -- src/adaptation/`
为空），R1-D 的逐文件收口与 S1-D-1..9 排除全部继承有效。本轮在完整排除表
（含 Round 1 十区 S1-* 与 R2-A 的 S2-A-1..6）之上以新角度再枚举，得到 5 个
此前未点名的新候选（S2-D-1 … S2-D-5），全部经理论 + 确定性仿真（seeded
mulberry32，等价 fuzz / 对象身份验证 / 真实规模基准，两次独立运行等价结论
逐位一致）裁决后淘汰：5 个全部在真实规模是 ns~百µs 级噪声，其中最强候选
（S2-D-4，~116µs/次）仍低于战役已示范的否决线（S1-I-1 的 ~190µs 亦被否决）
且需切片外公开面变更。未重开任何 X* / S1-* / S2-A-* 条目。X2-5 维持排除
未触碰。CAS/权限/凭据语义零 diff，天然不变。本切片在该人审门控低频控制面
契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、promotion-rules、
  candidate、eval-routing、pareto、rollback、resource、retirement、
  active-pointer、monitor、approval-profile、reflection、mutate）本轮再次
  全量实际读码，未依赖 R1-D 的记忆。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-D.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——X2-5（monitor 每 observe 重算
  `freezeBaseline` 直接跳过）、S1-D-1..9（addVersion push、candidatesFor 索引、
  反向早退、catalogCost Map、直接迭代、skyline、外层校验去重、小表 Set 化、
  双 JSON.parse 全部不再提案）、X1-1/X0-4/X1-2/X0-5。本轮只探索**未被点名的
  新角度**：restore 批量重建（S2-D-1）、可证死分支消除（S2-D-2）、跨阶段重复
  解析消除（S2-D-3）、双 assignTasks 共享分析（S2-D-4）、快照重复校验消除
  （S2-D-5）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、权限/安全/
  凭据永不自动晋升（`autoPromotableFor` 由 kind 派生、`NON_AUTO_PROMOTABLE_KINDS`
  强制在 neverAutoPromote）、晋升提案优先——零 diff，天然满足。
  不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 规模与门槛基底（继承 + 本轮校准）

R1-D 已实测本切片现实规模（V/C/L 个位~十位、catalog M=2~3、唯一可增长维度
是 eval 数据集 E、monitor W=8），代码未变，本轮直接继承。R2-A 校准的战役
落地线同样继承：**已落地项在百 ms 级或复杂度类下降**（J1 2770×、S1-F 4.8×、
S1-C ~450ms/fit），µs 级与亚 ms 级候选一律被否决过（S1-I-1 ~190µs、S2-A-1
~12µs/episode、S1-C-7 亚 ms）。本轮全部候选的绝对收益上界是
**~116 µs/eval 调用**（S2-D-4），据此裁决。

补充一点本轮新测的结构事实：adaptation 面全部入口都是**每进程调用一次**的
CLI/auto-loop 路径（磁盘载入 → 单次操作 → 原子保存），任何 µs 级候选都被
`readFile`/`writeFile`/`fsync` 的 ms 级 I/O 支配。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-D-1 | `registry.restore()` 内 `versionsByKey` 批量重建（restore 局部可变 push，装填完即冻结），替代逐条 `addVersion` copy-on-append | 每 identity O(V²)→O(V)；**绕开 S1-D-1 别名反例**（restore 先 clear，全新数组在 restore 返回前不可能被外部持有） | ✅ 2000 fuzz（多 identity 混排）逐元素逐序一致 + 别名安全验证（restore 前持有数组不变、重建数组为新对象） | V=6（真实上界）全 restore 仅省 **229~267ns**；V=600（100×）才省 226µs | 淘汰：噪声。等价性与 S1-D-1 不同（机制安全），但 S1-D-1 的规模论证原样适用——V 是人审门控的个位数 |
| S2-D-2 | `registry.rollback()` CAS 成功后第二次 `versionsById.get(targetVersionId)` 与其 undefined 抛错分支消除（`target` 在函数头已取，两次 get 之间 `versionsById` 无变异，`restored === target` 恒成立） | 免 1 次 Map.get + 死分支 | ✅ 300 fuzz 全三路径（CAS/幂等/degradation 提案）对象身份验证：返回的 active 恒 === 预取的 target | 上界 **9~18ns/rollback** | 淘汰：亚噪声；且 undefined 分支是 fail-closed 防御纵深（不可能态兜底），与 R1-D 对 preparePromotion 不可达检查、S1-D-7 的裁决同向：保留 |
| S2-D-3 | eval-routing episode `taskId` 双 `parseTaskId` 消除（`parseEpisode` 校验后弃值，`replayAssignments` 再解析；可在切片内部 interface 存 branded 值） | 免 E 次正则解析 | ✅ 200 id 值恒等验证（branded string，返回值与输入同一字符串） | E=200 全程 **16.2~16.7µs/eval 调用**，每 `adapt eval` CLI 进程一次 | 淘汰：噪声；被 dataset 读取 + report 写入的 ms 级 I/O 与 assignTasks×2 支配 |
| S2-D-4 | `replayAssignments` 双 `assignTasks` 共享 `analyzeTask` 结果（分析与 learned 策略无关，baseline/candidate 两遍重复计算） | 免 1 遍 O(E) 正则分析 | —（未实现：`assignTasks` 无接受预置分析的公开入口，须改 `src/routing/` 公开签名或在切片内平行实现 `assignPlanned`——X0-4/X1-2 同类） | 重复分析遍 E=200 实测 **116~117µs**，单遍 assignTasks 370~378µs；eval 调用另付 ms 级 I/O | 淘汰：收益低于战役否决线（S1-I-1 ~190µs 已被否决）+ 切片外公开面变更/平行实现被排除表点名 |
| S2-D-5 | monitor `snapshot()` 对已验证观测的 `copyObservation` 重复校验消除（私有数组只进已验证项，快照校验不可能失败） | 免 N 次字段校验 | —（不变式论证：observe/restore 入口均已验证） | N=32 全快照 937.4→321.7ns，省 **~615ns/snapshot** | 淘汰：噪声 + fail-closed 防御纵深（与 `getActiveContent` 重哈希、gate-apply 双 hash 同族），安全侧保留 |

## 3. 关键裁决细节

### S2-D-1：等价性成立但规模裁决不变（S1-D-1 的安全变体仍是噪声）

S1-D-1 被排除的核心是别名反例：`versionsFor` 按引用返回内部数组，写路径
可变 push 会让调用方持有的数组可观察增长。本轮候选把可变 push **限制在
restore 内部**：`restore()` 先 `versionsByKey.clear()`，重建期间的新数组
在方法返回前外部不可达，返回后写路径仍走 copy-on-append——旧持有数组保持
冻结、新数组不再被变异，可观察行为逐位一致（2000 例 fuzz + 别名探针验证）。
机制上这是 S1-D-1 反例覆盖不到的新提案。但裁决不变：restore 只在每进程
载入快照时跑一次，真实 V 是人审晋升门控下的个位数，V=6 时整个 restore 的
重建成本 1.3µs、候选省 267ns；O(V²)→O(V) 要到 V=600（两个量级外）才产生
226µs 收益。落到与 S1-D-3/5 同级的 ns 档，淘汰。

### S2-D-2：可证死分支 ≠ 可删分支

`rollback()` 第 294 行的 `restored = this.versionsById.get(...)` 与第 237 行
的 `target` 之间只有 `casActivePointer`（仅变异 `activeByKey`）与
`rollbackLog.append`，`versionsById` 不可能变化，故 `restored === target`
恒成立、undefined 抛错分支不可达——300 例三路径 fuzz 的对象身份断言证实。
但删除它：(a) 收益上界一次 Map.get（9~18ns）；(b) 该分支与 preparePromotion
的第二次 `review.candidateId` 检查（R1-D 判保留）同族，是「注册表内部不变式
被未来变更破坏时 fail-closed 而非静默返回错对象」的防御纵深。两条理由各自
独立充分，淘汰。

### S2-D-4：本轮最强候选为何仍不落地

eval 路径是切片唯一可增长维度（E）上的支配成本：`assignTasks` 以相同 tasks
调两次（baseline/candidate 策略各一），其中 `analyzeTask` 的正则分析与
learned 策略无关，纯重复。实测 E=200 时重复份额 116µs（占双遍 ~750µs 的
15.5%）。不落地的两条独立理由：
(1) **量级**：116µs 一次性 CLI 调用收益低于战役已否决的 S1-I-1（~190µs），
    且被 dataset manifest 读取、registry 载入（含全量 content 重哈希校验）、
    report 写盘的 ms 级 I/O 支配；
(2) **实现面**：`assignTasks` 的公开签名不接受预置分析，`assignPlanned` 是
    `src/routing/assign.ts` 的模块私有函数——共享分析要么改切片外公开签名
    （X0-4 同类）、要么在 adaptation 内复制 assignPlanned 逻辑形成平行实现
    （X1-2 同类，策略应用语义漂移风险）。
重开条件见 §6。

### 逐文件收口（本轮新视角补充，R1-D 收口之上）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S2-D-1/2；`restore()` 开头的 `rollbackLog.restore([])` 看似冗余（结尾会再 restore 真数据）——但快照中途抛错时它保证 rollbackLedger 不残留旧数据，是失败路径可观察行为的一部分，**不可删**；`createCandidate` 的 `assertAcyclicLineage` 从 candidateId 起步在 versionsById 中必查空、循环体不执行——O(1) 的 fail-closed 结构，无优化空间 | 无候选落地 |
| `promotion.ts` | `promoteWithRegistry`/`PromotionService.beginPromotion` 的 candidate 预取 + 条件外层校验已由 S1-D-7 裁决保留；解析器全线性 | 无候选 |
| `promotion-rules.ts` | `assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed 契约（R1-D 已判，X1-1 域）；`intentIdFor` O(1) | 无候选 |
| `candidate.ts` | `candidateError` 顺序化短路已最优；`assertSingleResourceBoundary` 前缀嗅探避免了非 JSON 内容的解析 | 无候选 |
| `eval-routing.ts` | 见 S2-D-3/4；`assertNoForbiddenFields` 的 `key.toLowerCase()` 每键分配为 KB 级策略常数噪声；`assertReplayIsolated` O(E) 一次性 | 无候选落地 |
| `active-pointer.ts` / `resource.ts` / `retirement.ts` | 三个 O(1) 纯函数 / 常量表 + O(1) 谓词 / 三个薄委托，无新角度 | 无候选 |
| `pareto.ts` | S1-D-6 维持；先全量校验后过滤的次序是错误行为契约 | 无候选 |
| `rollback.ts` | `RollbackLog.list()` 拷贝 = readonly 契约（X4-2 域）；`last()` O(1) 去重已最优 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；见 S2-D-5；`majorityUnseen`/`mode` O(W)=8 常数 | 无候选落地 |
| `approval-profile.ts` | `createDefaultApprovalProfile()` 每 preparePromotion 新建——模块级冻结常量会改对象身份（S1-A-7 同类）且引入共享可变风险（S1-G-9 同域），ns 级，不提案 | 无候选 |
| `reflection.ts` | `partitionEvidence` 已 Set 单遍；`isSelfSupported` unique 上界 evaluator 个位（S1-D-8 域） | 无候选 |
| `mutate.ts` | `adjustParameter` 两遍正则维持 R1-D「记录不改」；每次新建正则是 X0-6 的安全侧 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 5. 测试

零代码改动下相关套件基线复核，全绿（Node 22.22.2，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库；完整源码见附录，seeds `0xd22d01`–`0xd22d05`，
两次独立运行等价结论逐位一致、计时抖动范围内稳定）：

```text
S2-D-1 bench restore V=6 (one identity): current=1318.7ns batch=1051.3ns delta/restore=267.4ns
S2-D-1 bench restore V=600 (one identity): current=303642.5ns batch=77347.3ns delta/restore=226295.2ns
S2-D-2 anchor: one redundant Map.get = 9.0ns per rollback CAS (upper bound of any gain; dead undefined-branch is fail-closed depth)
S2-D-3 anchor: redundant parseTaskId x E=200 = 16.65us per eval invocation (once per adapt-eval CLI run)
S2-D-4 anchor E=200: duplicated analyzeTask pass=117.04us vs one full assignTasks pass=370.14us (eval invocation also pays dataset read + report write I/O)
S2-D-5 anchor N=32: snapshot with re-validation=937.4ns copy-only=321.7ns delta/snapshot=615.8ns
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-D-1 | registry `restore()` versionsByKey 批量重建（restore 局部可变 push） | 等价可证（绕开 S1-D-1 别名反例：clear 后新数组 restore 返回前不可达），但真实 V 个位数、V=6 省 ~250ns/restore；O(V²)→O(V) 要 V=600 才见 226µs |
| S2-D-2 | rollback CAS 后冗余 `versionsById.get` 与 undefined 死分支消除 | 恒等可证（两 get 间无 versionsById 变异，300 fuzz 对象身份一致），但上界 9~18ns 且该分支是不可能态 fail-closed 兜底（S1-D-7/R1-A 同向保留） |
| S2-D-3 | eval-routing episode taskId 双 `parseTaskId` 消除（内部 interface 存 branded 值） | 值恒等，E=200 全程仅 ~16.5µs/eval CLI 调用，被 ms 级 I/O 支配 |
| S2-D-4 | eval-routing 双 `assignTasks` 共享 `analyzeTask` 结果 | E=200 重复份额 ~116µs 低于战役否决线（S1-I-1 ~190µs 已否决）；且需改 `src/routing/` 公开签名（X0-4 同类）或切片内平行实现 assignPlanned（X1-2 同类） |
| S2-D-5 | monitor `snapshot()` 跳过已验证观测的重复校验 | N=32 仅省 ~615ns/snapshot；fail-closed 防御纵深（getActiveContent 重哈希同族），安全侧保留 |

重开条件：S2-D-4 若 (a) eval 数据集 E 增长 ≥2 个量级，或 (b) `src/routing/`
先行提供接受预置 TaskAnalysis 的公开 assignTasks 变体（届时不再构成 X0-4/
X1-2 冲突），可凭本报告的 116µs/200-episode 份额测量重开；S2-D-1 若快照
版本数增长 ≥2 个量级可凭本报告等价性证据重开；S2-D-2/5 需先推翻防御纵深
裁决（属安全边界决策，非性能问题）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0xd22d01`–`0xd22d05`。

```ts
/**
 * R2-D deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S2-D-1 .. S2-D-5 against the current
 * implementations in src/adaptation/. Seeded PRNG (mulberry32) -> reproducible.
 * Seeds: 0xd22d01 - 0xd22d05.
 */
import { performance } from "node:perf_hooks";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import { promoteWithRegistry } from "/workspace/src/adaptation/promotion.js";
import { resourceIdentityKey } from "/workspace/src/adaptation/active-pointer.js";
import {
  identityEquals,
  RESOURCE_KINDS,
  type ResourceIdentity,
  type ResourceVersion
} from "/workspace/src/adaptation/resource.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import { createAdaptationDriftMonitor, type DriftObservation } from "/workspace/src/adaptation/monitor.js";
import { createProjectId, parseTaskId, type IdGenerator } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { analyzeTask } from "/workspace/src/routing/analyze-task.js";
import { assignTasks } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary, DEFAULT_PRIMARY_MODEL_ID } from "/workspace/src/routing/primary-catalog.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";

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

const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
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
 * S2-D-1: restore() batch-builds versionsByKey (mutable push while
 * rebuilding, freeze on set) instead of per-version copy-on-append.
 * Sidesteps the S1-D-1 alias counterexample: during restore the maps
 * were just cleared, so no caller can hold a mid-restore array.
 * Equivalence fuzz + realistic/100x bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd22d01);
  const projectIds = ["p1", "p2", "zz9"].map((s) => createProjectId(() => s));
  const genIdentity = (): ResourceIdentity => ({
    kind: pick(rng, RESOURCE_KINDS),
    name: pick(rng, ["a", "main-agent-prompt", "n|project:prj_x", "routing-policy|z"]),
    scope: rng() < 0.5 ? { kind: "user-global" } : { kind: "project", projectId: pick(rng, projectIds) }
  });
  const genVersion = (i: number, identity: ResourceIdentity): ResourceVersion => ({
    versionId: `rsv_r${i}` as ResourceVersion["versionId"],
    identity,
    contentHash: "deadbeef",
    author: HUMAN,
    parentVersionId: undefined,
    createdAt: NOW
  });

  // Verbatim current construction (per-version copy-on-append, addVersion body).
  const currentBuild = (versions: readonly ResourceVersion[]): Map<string, readonly ResourceVersion[]> => {
    const byKey = new Map<string, readonly ResourceVersion[]>();
    for (const version of versions) {
      const key = resourceIdentityKey(version.identity);
      const existing = byKey.get(key) ?? [];
      byKey.set(key, [...existing, version]);
    }
    return byKey;
  };
  // Candidate: restore-local batch build (mutable push while private).
  const batchBuild = (versions: readonly ResourceVersion[]): Map<string, readonly ResourceVersion[]> => {
    const byKey = new Map<string, ResourceVersion[]>();
    for (const version of versions) {
      const key = resourceIdentityKey(version.identity);
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [version]);
      else bucket.push(version);
    }
    return byKey;
  };

  for (let trial = 0; trial < 2000; trial += 1) {
    const identities = Array.from({ length: 1 + Math.floor(rng() * 4) }, genIdentity);
    const versions = Array.from({ length: Math.floor(rng() * 14) }, (_, i) =>
      genVersion(trial * 100 + i, pick(rng, identities))
    );
    const a = currentBuild(versions);
    const b = batchBuild(versions);
    check("S2-D-1 same key set", a.size === b.size, `trial ${trial}`);
    for (const [key, arrA] of a) {
      const arrB = b.get(key);
      check(
        "S2-D-1 equivalence (same elements, same order)",
        arrB !== undefined && arrA.length === arrB.length && arrA.every((v, k) => v === arrB[k]),
        `trial ${trial} key ${key}`
      );
    }
  }

  // Alias safety: an array held from BEFORE restore stays frozen either way
  // (the map was cleared; both variants insert fresh arrays).
  {
    const identity = genIdentity();
    const versions = Array.from({ length: 3 }, (_, i) => genVersion(90000 + i, identity));
    const before = currentBuild(versions);
    const held = before.get(resourceIdentityKey(identity)) as readonly ResourceVersion[];
    const heldLen = held.length;
    const after = batchBuild([...versions, genVersion(90009, identity)]);
    check("S2-D-1 alias safety: pre-restore held array unchanged", held.length === heldLen);
    check("S2-D-1 alias safety: rebuilt array is a distinct object", after.get(resourceIdentityKey(identity)) !== held);
  }

  for (const V of [6, 600]) {
    const identity = genIdentity();
    const versions = Array.from({ length: V }, (_, i) => genVersion(i, identity));
    const cur = bench(() => currentBuild(versions), V > 100 ? 500 : 20000);
    const cand = bench(() => batchBuild(versions), V > 100 ? 500 : 20000);
    console.log(
      `S2-D-1 bench restore V=${V} (one identity): current=${(cur * 1e6).toFixed(1)}ns batch=${(cand * 1e6).toFixed(1)}ns delta/restore=${((cur - cand) * 1e6).toFixed(1)}ns`
    );
  }
}

/* ============================================================
 * S2-D-2: rollback() post-CAS re-get of the target version is provably
 * the same object as `target` fetched at entry (no versionsById mutation
 * in between). Object-identity fuzz across all rollback paths + anchor.
 * ============================================================ */
{
  const rng = mulberry32(0xd22d02);
  for (let trial = 0; trial < 300; trial += 1) {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(`d2t${trial}x`) });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => `d2p${trial}`) }
    };
    const baseline = registry.registerBaseline({ identity, content: "v1", author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const promoted = promoteWithRegistry(registry, {
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: "v2",
      approvedBy: HUMAN,
      review: {
        reviewId: "rv",
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        verdict: "approved",
        reviewerKind: "independent",
        reviewerId: "critic-gate",
        actorId: HUMAN.identity,
        evidenceRefs: ["review:d2"]
      },
      changeNote: {
        scope: "prompt:d2",
        evidence: ["static"],
        guardrails: ["proposal-first"],
        rollbackVersionId: baseline.versionId
      },
      explicitApproval: true
    });
    const active = promoted.newVersion as ResourceVersion;
    const targetBefore = registry.getVersion(baseline.versionId) as ResourceVersion;
    const mode = Math.floor(rng() * 3);
    if (mode === 0) {
      // CAS path (user rollback): returned active must BE the pre-fetched target object.
      const result = registry.rollback({
        identity,
        expectedCurrentVersionId: active.versionId,
        targetVersionId: baseline.versionId,
        reason: "user",
        evidence: ["ev"],
        automatic: false
      });
      check("S2-D-2 CAS path: restored === pre-fetched target (object identity)", result.active === targetBefore);
      check("S2-D-2 CAS path ok", result.ok);
    } else if (mode === 1) {
      // Idempotent path: target already active.
      const result = registry.rollback({
        identity,
        expectedCurrentVersionId: active.versionId,
        targetVersionId: active.versionId,
        reason: "user",
        evidence: ["ev"],
        automatic: false
      });
      check("S2-D-2 idempotent path: active object returned", result.active === registry.getVersion(active.versionId));
    } else {
      // Degradation propose path: no CAS, active unchanged.
      const result = registry.rollback({
        identity,
        expectedCurrentVersionId: active.versionId,
        targetVersionId: baseline.versionId,
        reason: "degradation",
        evidence: ["ev"],
        automatic: false
      });
      check("S2-D-2 propose path: ok=false, active is current", !result.ok && result.active === registry.getVersion(active.versionId));
    }
  }
  const map = new Map<string, { v: number }>();
  for (let i = 0; i < 8; i += 1) map.set(`rsv_k${i}`, { v: i });
  const get = bench(() => map.get("rsv_k3"), 200000);
  console.log(
    `S2-D-2 anchor: one redundant Map.get = ${(get * 1e6).toFixed(1)}ns per rollback CAS (upper bound of any gain; dead undefined-branch is fail-closed depth)`
  );
}

/* ============================================================
 * S2-D-3: eval-routing double parseTaskId (parseEpisode validates and
 * discards; replayAssignments re-parses). Value identity + anchor at E=200.
 * ============================================================ */
{
  const rng = mulberry32(0xd22d03);
  const ids = Array.from({ length: 200 }, (_, i) => `tsk_e${i}_${Math.floor(rng() * 1e6)}`);
  for (const id of ids) {
    check("S2-D-3 parseTaskId returns the identical string value", (parseTaskId(id) as string) === id);
  }
  const cost = bench(() => {
    for (const id of ids) parseTaskId(id);
  }, 2000);
  console.log(
    `S2-D-3 anchor: redundant parseTaskId x E=200 = ${(cost * 1e3).toFixed(2)}us per eval invocation (once per adapt-eval CLI run)`
  );
}

/* ============================================================
 * S2-D-4: sharing analyzeTask across the two assignTasks calls in
 * replayAssignments. Upper bound of the duplicated work at E=200 vs the
 * cost of one assignTasks pass (the change needs a routing/ public-surface
 * extension or a parallel implementation -> X0-4 / X1-2 class).
 * ============================================================ */
{
  const rng = mulberry32(0xd22d04);
  const roles: readonly AgentRole[] = ["executor", "tester", "reviewer", "planner", "scout"];
  const objectives = [
    "Fix the failing unit test in the adapter and rerun the suite",
    "Refactor the retry helper to remove the duplicated backoff logic",
    "Review the migration PR for schema drift and unsafe defaults",
    "Investigate why the nightly benchmark regressed on large inputs",
    "Plan the rollout of the new caching layer across services"
  ];
  const E = 200;
  const tasks = Array.from({ length: E }, (_, i) => ({
    taskId: parseTaskId(`tsk_s2d4_${i}`),
    role: pick(rng, roles),
    objective: pick(rng, objectives)
  }));
  const catalog = catalogFromPrimary({ primaryModelId: DEFAULT_PRIMARY_MODEL_ID });
  const analyzeCost = bench(() => {
    for (const task of tasks) analyzeTask(task.objective, task.role, {});
  }, 200);
  const assignCost = bench(() => assignTasks({ catalog, tasks }), 200);
  console.log(
    `S2-D-4 anchor E=${E}: duplicated analyzeTask pass=${(analyzeCost * 1e3).toFixed(2)}us vs one full assignTasks pass=${(assignCost * 1e3).toFixed(2)}us (eval invocation also pays dataset read + report write I/O)`
  );
}

/* ============================================================
 * S2-D-5: monitor snapshot()/restore() re-validation of already-validated
 * observations. Anchor the validation share at a realistic lifetime N.
 * ============================================================ */
{
  const rng = mulberry32(0xd22d05);
  const genObs = (): DriftObservation => ({
    modelVersion: pick(rng, ["m1", "m2"]),
    taskFamily: pick(rng, ["edit", "test", "review"]),
    projectId: "prj_x",
    policyVersion: "pol1",
    judgeCalibration: Math.round(rng() * 100) / 100
  });
  const monitor = createAdaptationDriftMonitor();
  const N = 32;
  for (let i = 0; i < N; i += 1) monitor.observe(genObs());
  const snapCost = bench(() => monitor.snapshot(), 20000);
  const copyOnly = (obs: DriftObservation): DriftObservation => ({
    modelVersion: obs.modelVersion,
    taskFamily: obs.taskFamily,
    projectId: obs.projectId,
    policyVersion: obs.policyVersion,
    judgeCalibration: obs.judgeCalibration
  });
  const raw = monitor.snapshot();
  const noValidate = bench(() => raw.map(copyOnly), 20000);
  console.log(
    `S2-D-5 anchor N=${N}: snapshot with re-validation=${(snapCost * 1e6).toFixed(1)}ns copy-only=${(noValidate * 1e6).toFixed(1)}ns delta/snapshot=${((snapCost - noValidate) * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * DomainValidationError sanity for the S2-D-2 fail-closed argument.
 * ============================================================ */
{
  let threw = false;
  try {
    throw new DomainValidationError("probe");
  } catch (error) {
    threw = error instanceof DomainValidationError;
  }
  check("DomainValidationError probe", threw);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

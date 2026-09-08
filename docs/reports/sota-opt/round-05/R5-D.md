MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-D：`src/adaptation/` 第五遍搜查报告（Round 1–4 同区第五遍）

**战役:** 全库持久 SOTA 优化 Round 5 / R5-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `fbff2ef`
**分支:** `cursor/r5-d-adaptation-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D、R3-D、R4-D（`cb65c81`）至本轮基线（`fbff2ef`）
**逐字节未变**（`git diff 82bef36..fbff2ef -- src/adaptation/` 与
`git diff cb65c81..fbff2ef -- src/adaptation/` 均为空），前四轮全部规模
测量、逐文件收口与 S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 排除
继承有效。本轮按指令先**重测 R4-D 端到端锚点**（§1：`adapt eval` E=200
全程 4.07–4.39ms/调用、registry save+fsync 0.57–0.58ms、load 0.10–0.12ms
——R4-D 的 4.35–4.38ms / 0.55–0.80ms 带成立），再换第五组新透镜全量重读
枚举，得到 5 个此前排除表未点名的新候选（S5-D-1 … S5-D-5），全部经理论 +
确定性仿真（seeded mulberry32，等价 fuzz / fail-open 与错误选择反例 /
真实规模基准，两次独立运行等价/反例结论**逐位一致**）裁决后淘汰：
2 个有确定性反例（S5-D-1 一般化 fail-open、S5-D-4 双故障错误选择发散），
3 个在 ns~µs 噪声带（最强 S5-D-2 仅 567–744ns/eval 调用）。未重开任何
X* / S1-* / S2-* / S3-* / S4-* / S5-A-* / S5-B-* 条目。X2-5 维持排除
未触碰。CAS/权限/凭据/数据面语义零 diff，天然不变。本切片在该人审门控
低频控制面契约下维持 SOTA；可寻址空间仍低于数十~数百 ms 落地线 ≥3 个
量级。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate，共 3294 行）本轮再次**全量实际读码**，未依赖前四轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表含 S5-A-1..3、S5-B-1..4）/
  round-05/PLAN.md / round-01/R1-D.md / round-02/R2-D.md /
  round-03/R3-D.md / round-04/R4-D.md。
- 基线漂移检查：`git diff 82bef36..fbff2ef -- src/adaptation/` 与
  `git diff cb65c81..fbff2ef -- src/adaptation/` 均为空；**切片外调用面
  同样复核**——`git diff --stat cb65c81..fbff2ef` 对 `src/cli/adapt.ts`、
  `src/learning/`、`src/experiments/isolation.ts`、`src/routing/assign.ts`
  等消费方为空，且 grep 复核 monitor/pareto/reflection/retirement/mutate
  在 `src/` 生产面仍无调用方（R3-D 图景原样成立）。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5 直接跳过；
  S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 全部不再提案；
  X1-1/X0-4/X1-2/X0-5/X0-6 全部绕开；禁令点名的双故障 Promise.all /
  投机 I/O / 丢 ledger 拷贝换名重提均未发生（S5-D-4 是**前置短路**新角度，
  其反例恰好落回 S1-D-7/S4-D-3-A 错误选择家族，见 §3）。本轮只探索
  **未被点名的第五组透镜**：载入链跨函数死校验（S5-D-1）、数组迭代器
  元组分配（S5-D-2）、保存链中间快照对象（S5-D-3）、度量前空观测前置
  短路（S5-D-4）、调用内 identity-key 公共子表达式消除（S5-D-5）。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`（S1-F/J1/S1-C/S1-I/S2-C/S3-C/S4-C 均在
  切片外或已落地，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升、`adapt auto` 只提案——零 diff，天然满足。
  双 LCB 与双归因不涉及本切片，均未触碰。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、公开签名、数据面契约。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 / R4-D §1 的论证：全部生产入口是每进程一次的 CLI/auto-loop
（磁盘载入→单次操作→原子保存）；切片内可寻址成本 promote/rollback 路径
<~10µs、eval 路径 <0.5ms，均被固定 ms 级成本支配。本轮用与 R4-D 相同的
真实入口端到端方法重测（temp stateRoot + 真实 `saveAdaptationRegistry`/
`loadAdaptationRegistry`/`evalRoutingPolicy`，E=200 数据集，两次独立运行）：

```text
run1: registry load=0.10ms save(+fsync)=0.58ms | adapt-eval end-to-end (E=200)=4.39ms
run2: registry load=0.12ms save(+fsync)=0.57ms | adapt-eval end-to-end (E=200)=4.07ms
```

**R4-D 锚点带成立**（eval 4.07–4.39ms vs R4-D 4.35–4.38ms；save 0.57–0.58ms
落在 R4-D 0.55–0.80ms 带内）。本轮五个候选的收益上界（最大 S5-D-2 的
744ns）不足 eval 固定成本的 0.02%，距数十~数百 ms 落地线 ≥4 个量级。
预算支配论证经第三次独立复核后继续成立——在「人审门控低频控制面 +
E≲10³」契约下，本切片不存在达门槛的保行为优化空间。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-D-1 | registry `restore()` 对 `parseRegistrySnapshot` 产物的 `isResourceVersionId`/`isCandidateId` 再校验消除（载入链上解析器已逐字段校验，restore 再查是跨函数死校验） | 免 (V+C+retired) 次正则测试/载入 | ❌ **fail-open 反例**（restore 是公开方法，直接调用方可传任意内存快照：现行对 `versionId:"not-a-version-id"` 抛 `invalid version id in snapshot`，信任变体照单收下）；载入链冗余性另经 300 例 fuzz 证实（parse→restore 永不抛 + 解析器规范化字节级回环一致） | V=6,C=8,retired=2 全部再校验共 **804.0–806.8ns/载入** | 淘汰：一般化不等价（fail-closed 边界，S4-G-2 同性质非法收益）；载入路径特化需私有信任入口（X1-2 类，S4-D-2 同判）；收益亦 ns 级 |
| S5-D-2 | eval-routing `pairedRecords` 的 `episodes.entries()` 迭代器换经典索引循环（免每 episode 一次 `[index, value]` 元组分配；S4-D-5 是 `Object.entries`，本条是 `Array.prototype.entries`，站点与机制均不同） | 免 O(E) 元组分配 | ✅ 3000 fuzz（PASS/FAIL/UNOBSERVED 混排、taskFamily 缺省、~6% 截断 actions 走 missing-action 错误路径）记录与首错消息逐位一致 | E=200 delta **567.3–744.2ns/eval 调用**（current 3.11–3.31µs → 2.55–2.56µs） | 淘汰：亚 µs、每 `adapt eval` CLI 进程一次，占端到端 4.1–4.4ms 的 ~0.02% |
| S5-D-3 | 保存链中间 `snapshot()` 对象消除（`saveAdaptationRegistry` 先 `registry.snapshot()` 建五个 `Array.from` 数组 + contents map 再 `JSON.stringify`，可直接从内部结构流式序列化） | 免一次全量中间对象构建 | —（上界锚定：消除的极限=snapshot+stringify 全部归零） | snapshot()=444.9–453.6ns + stringify=2428.5–2442.4ns，合计 **~2.9µs = save(+fsync) 的 0.4–0.5%** | 淘汰：份额低于 fsync 地板 2 个量级；直接序列化需扩公开接口（S1-G-2/S4-G-4 同族）或手写序列化器（S5-A-2 已实测慢 11–15%）；快照对象另被 X4-2 类 readonly 契约消费 |
| S5-D-4 | `evalRoutingPolicy` 在 `assignTasks`×2 之前前置检测全 UNOBSERVED 数据集（`records.length===0` 的错误可在 episodes 解析后立即判定，省掉两遍全量路由重放） | 错误路径省 ~0.75ms（assignTasks×2） | ❌ **双故障错误选择反例**（确定性复现）：全 UNOBSERVED 数据集含高风险 episode（deploy 目标）+ 候选策略 avoid 掉唯一 approvedForHighRisk 模型 → 现行浮出 `No allowed model is approved for high-risk tasks...`（RoutingRefusalError 自 replayAssignments 内传出），前置短路变体浮出 `routing eval requires at least one episode with recorded PASS or FAIL`——S1-D-7/S4-D-3-A 错误选择家族 | 收益仅存在于**退化错误路径**（真实数据集必有已观测 episode）；happy path 反付一次 O(E) 前置扫描 | 淘汰：不等价（错误选择可观察发散）+ 错误路径专属收益低于否决线 + happy path 零收益 |
| S5-D-5 | registry `rollback()` 调用内 `resourceIdentityKey` 重复计算 CSE（CAS 路径 `versionsFor`/`getActiveVersion`/`casActivePointer` 各自派生同一 key，共 3 次） | 免 2 次纯函数重算/rollback | ✅ 纯函数确定性探针（64 identity 重复计算逐位一致，提升平凡等价） | key 单次 **13.9ns**，冗余份额 **~27.8ns/rollback** | 淘汰：ns 级；完全 CSE 须内联私有 map 访问（复制方法逻辑）或改 `casActivePointer` 公开签名收 key（X0-4 类）；R3-D 已判跨调用记忆化属 X1-1 域 |

## 3. 关键裁决细节

### S5-D-1：载入链可证冗余 ≠ 公开契约冗余（restore 的第四个别名/信任反例）

`loadAdaptationRegistry` 链上 `parseRegistrySnapshot` 已对每个 version/
candidate/retired id 做过逐字段校验，`restore()` 内的 `isResourceVersionId`/
`isCandidateId` 再查在该路径上**可证永真**（300 例含晋升/退休混排的
fuzz：parse→restore 零抛错，且解析器规范化后字节级回环一致——注意
fresh-写与再解析的 ledger 条目 `toVersionId` 键位不同是 R4-D S4-D-1 已
记录的两态性，比较须过解析器规范化）。但 `restore()` 与 `fromSnapshot`
是公开方法，调用方可以传**未经解析器**的内存快照：

```text
current:  restore({versions:[{...v, versionId:"not-a-version-id"}]}) -> throw "invalid version id in snapshot: not-a-version-id"
trusting: 同输入被照单收下（versionsById 出现 bogus 键，后续 getVersion 返回坏行）-> fail-open
```

删除校验 = 把 fail-closed 边界改成 fail-open（S4-G-2「写侧校验全跳过」
同性质的非法收益）；只对载入路径特化 = 私有信任入口（X1-2 类，与
S4-D-2 对 `RollbackLog.restore` 的裁决同判）。叠加 ~805ns/载入的收益
规模，两条理由各自独立充分，淘汰。

### S5-D-4：本轮第二个错误选择反例（前置短路与投机 I/O 是同一枚硬币的两面）

`records.length === 0` 检查位于 `assignTasks`×2 与 `catalogCost` 之后；
把「数据集不含任何 PASS/FAIL」的判定前置到 episodes 解析后，理论上让
退化数据集省掉 ~0.75ms 的双遍路由重放。但前置检查与现检查之间的窗口
**不是纯的**：`router.route` 在高风险任务遇到 avoid 掉全部
approvedForHighRisk 模型的候选策略时确定性抛 `RoutingRefusalError`。
构造双故障输入（全 UNOBSERVED + deploy 目标 episode + avoid premium 的
候选策略），真实 `evalRoutingPolicy` 端到端复现：

```text
current       -> "No allowed model is approved for high-risk tasks..."
early-exit    -> "routing eval requires at least one episode with recorded PASS or FAIL"
```

两个错误分属不同用户可操作项（策略问题 vs 数据集问题），发散可观察且
确定。S4-D-3 证明「重叠化会投机做多余工作」，本条证明其对偶「短路化会
投机跳过揭错工作」——错误路径的工作次序本身就是行为。淘汰。

### S5-D-2：第五遍最强候选为何仍是噪声

`pairedRecords` 的 `for (const [index, episode] of episodes.entries())`
每 episode 分配一个 `[index, value]` 元组，是 S4-D-5（`Object.entries`
的每节点元组数组）之后切片内最后一处未点名的迭代器分配站点。索引循环
变体 3000 例 fuzz（含错误路径首错消息）逐位一致，E=200 实测省
567–744ns——占 4.1–4.4ms 端到端的 ~0.02%，与 S4-D-5（~5.2µs，0.1%）
同域但低一个量级。V8 对元组解构已有逃逸分析但未完全清零（与 S4-D-1 的
清零结局不同，本条 delta 稳定为正），however 规模裁决独立充分：淘汰。

## 4. 逐文件收口（第五遍新检查点，叠加 R1-D..R4-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S5-D-1/5；`promote()` 原子路径 begin/commit 双取 candidate/pendingVersion 为两阶段 CAS 契约（R3-D 已判 X1-2 域）；`snapshot()` 五个 `Array.from` = S1-D-5 家族（S5-D-3 的上界锚点已一并覆盖其成本）；`preparePromotion` 的 `Array.from(pendingByIntent.values())` 同族 | 无候选落地 |
| `promotion.ts` | 见 S5-D-3（`saveAdaptationRegistry` 中间快照 + 美化 stringify 为数据面字节契约，S4-G-6 域不可改紧凑）；`parseChangeNote.evidence` 经 `asStringArray` 按引用返回输入 JSON 数组——载入链输入恒新鲜、快照序列化即拷贝语义，无别名危险亦无性能角度；`withAdaptationRegistryLock` 委托切片外 `withExclusiveFileLock`，无竞争路径一次 open(wx)，I/O 支配 | 无候选落地 |
| `promotion-rules.ts` | 第五遍无新角度：`validatePromotionReview` 单链布尔短路次序即错误契约；`assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed（R1-D 判，X1-1 域） | 无候选 |
| `candidate.ts` | `assertSingleResourceBoundary` 的 `JSON.parse` 仅对 `{`/`[` 前缀内容执行且每 createCandidate 一次，KB 级常数；`candidateError` 字符串模板仅错误路径分配 | 无候选 |
| `eval-routing.ts` | 见 S5-D-2/4；`replayAssignments` 的 `episodes.map` 构建 tasks 数组为 assignTasks 输入契约（融合 = S1-C-5 同族小数组反例域）；`loadRoutingEvalDataset` 的 `episodes.map(parseEpisode)` 单遍已最优；S2-D-3/4、S3-D-3、S4-D-3/5 维持不重开 | 无候选落地 |
| `pareto.ts` | 第五遍无新角度（S1-D-6/S3-D-2 维持；无生产调用方，grep 本轮复核） | 无候选 |
| `rollback.ts` | S3-D-4/S4-D-2 维持；`validateRollbackInput` 的 evidence 逐项 trim 检查 O(项数)，个位级 | 无候选 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 三个薄委托 / 三个 O(1) 纯函数——第五遍无新角度；`scopeEquals` 双分支已最短路径 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；`report()` 两次 `slice` 各 O(W)=8 分配属 X2-5 邻域（缓存基线才能免第一个 slice）；S2-D-5/S3-D-5 维持；无生产调用方（grep 本轮复核） | 无候选 |
| `approval-profile.ts` | S4-D-4 维持；`isAutoAdaptEnabled` 每次读 env 是 kill-switch 语义（缓存 = X1-1 域 + 行为变更） | 无候选 |
| `reflection.ts` | 生产无调用方（grep 本轮复核）；`partitionEvidence`/`isSelfSupported` 维持 R1-D 收口；`instructionFor` 模板 O(1) | 无候选 |
| `mutate.ts` | `adjustParameter` 两遍正则维持「记录不改」；`replaceSection` 的三段 slice+join 为一次性变异 KB 级常数 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22.14.0，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd55d01`–`0xd55d05`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 budget anchors: registry load=0.10–0.12ms save(+fsync)=0.57–0.58ms | adapt-eval end-to-end (E=200)=4.07–4.39ms per invocation
S5-D-1 counterexample: current restore -> "invalid version id in snapshot: not-a-version-id" | trusting variant accepts bogus id=true -> fail-open (illegal)
S5-D-1 anchor (V=6, C=8, retired=2): redundant re-validation in restore() = 804.0–806.8ns per registry load
S5-D-2 bench E=200: current(entries)=3114.9–3306.5ns index-loop=2547.6–2562.3ns delta/eval-invocation=567.3–744.2ns
S5-D-3 anchor: snapshot()=444.9–453.6ns stringify=2428.5–2442.4ns -> ~0.0029ms = 0.4–0.5% of save(+fsync)
S5-D-4 counterexample (dual fault): current -> "No allowed model is approved for high-risk tasks..." | early-exit variant -> "routing eval requires at least one episode with recorded PASS or FAIL" -> observable error-selection divergence
S5-D-4 anchor: happy-path eval E=200 = 2.98–3.54ms (early exit saves assignTasks x2 only on all-UNOBSERVED datasets -> error-path-only)
S5-D-5 anchor: resourceIdentityKey=13.9ns per call; rollback CAS path recomputes 3x -> redundant share ~27.8ns per rollback
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-D-1 | registry `restore()` 对解析器产物的 id 再校验消除 | 一般化 fail-open（公开 restore 收任意内存快照，bogus id 反例）；载入路径特化 = X1-2 私有信任入口（S4-D-2 同判）；~805ns/载入 |
| S5-D-2 | `pairedRecords` `episodes.entries()` 换索引循环 | 等价可证（3000 fuzz 含错误路径），但 E=200 仅省 567–744ns/eval 调用（端到端 ~0.02%），S4-D-5 低一个量级的同域噪声 |
| S5-D-3 | 保存链中间 `snapshot()` 对象消除 / 直接流式序列化 | snapshot+stringify 合计 ~2.9µs 仅占 save(+fsync) 0.4–0.5%（fsync 地板支配）；需扩公开接口（S1-G-2/S4-G-4 族）或手写序列化器（S5-A-2 实测更慢） |
| S5-D-4 | `evalRoutingPolicy` 全 UNOBSERVED 前置短路（assignTasks×2 之前判空） | 双故障错误选择发散反例（路由拒绝 vs 空记录错误，确定性复现，S1-D-7/S4-D-3-A 家族）；收益仅退化错误路径；happy path 反付 O(E) 扫描 |
| S5-D-5 | `rollback()` 调用内 `resourceIdentityKey` CSE | 等价平凡（纯函数），但冗余份额 ~28ns/rollback；完全消除需内联私有 map 访问或改 `casActivePointer` 公开签名（X0-4 类）；跨调用记忆化属 X1-1 域（R3-D 已判） |

重开条件：S5-D-2 若 E 增长 ≥3 个量级（E~2×10⁵ 时外推 ~0.6–0.7ms，仍
低于落地线——实际须 ≥4 个量级才达门槛）可凭本报告 fuzz 证据重开；
S5-D-3 若战役先行裁定注册表持久化可换紧凑/流式格式（数据面契约决策，
非性能问题）；S5-D-1/4 需先推翻各自反例（即先改 restore 公开语义或裁定
错误路径工作次序不算行为——均属行为变更）；S5-D-5 需先由战役裁定
`casActivePointer` 签名可变。整片层面：唯一可能改变预算论证的仍是
E 增长 ≥2 个量级（继承 R3-D §6 / R4-D §7 与 S3-D-3 重开条件）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts`（或仓库根目录内任意 `.ts`）后
`npx tsx <file>`（依赖已装）。seeds：`0xd55d01`–`0xd55d05`。

```ts
/**
 * R5-D deterministic equivalence + benchmark simulation (fifth pass).
 * Adjudicates fresh candidates S5-D-1 .. S5-D-5 against the current
 * implementations in src/adaptation/, and re-verifies the R3-D/R4-D
 * whole-slice budget-domination argument with end-to-end anchors.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd55d01 - 0xd55d05.
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  parseRegistrySnapshot,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  type ResourceRegistrySnapshot
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy } from "/workspace/src/adaptation/eval-routing.js";
import { resourceIdentityKey } from "/workspace/src/adaptation/active-pointer.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "/workspace/src/adaptation/resource.js";
import type { PairedEvaluationRecord } from "/workspace/src/experiments/comparison-report.js";
import {
  createProjectId,
  isCandidateId,
  isResourceVersionId,
  type IdGenerator
} from "/workspace/src/domain/ids.js";
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

async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T08:00:00.000Z" as IsoTimestamp;
const HUMAN: AuthorIdentity = { kind: "human", identity: "operator" };
const EVAL_PLAN: EvaluationPlan = { stages: ["static", "replay"], metrics: ["utility"], planVersion: 1 };

function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  };
}

const BASELINE_POLICY = JSON.stringify({ primaryModelId: "premium", avoid: [], prefer: [] });
const CANDIDATE_POLICY = JSON.stringify({
  primaryModelId: "premium",
  avoid: [{ modelId: "fast", family: "edit", reason: "deterministic FAIL on edit replay" }],
  prefer: [{ family: "test", modelId: "fast" }]
});
/** Avoids the only high-risk-approved model with no family restriction. */
const REFUSING_CANDIDATE_POLICY = JSON.stringify({
  primaryModelId: "premium",
  avoid: [{ modelId: "premium", reason: "deterministic FAIL everywhere" }],
  prefer: []
});

const ROLES = ["worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"] as const;
const OBJECTIVES = [
  "Fix the failing unit test in the adapter and rerun the suite",
  "Refactor the retry helper to remove duplicated backoff logic",
  "Review the migration PR for schema drift and unsafe defaults",
  "Investigate why the nightly benchmark regressed on large inputs",
  "Plan the rollout of the new caching layer across services"
];

function buildRoutingRegistry(
  tag: string,
  candidateContent: string = CANDIDATE_POLICY
): { registry: ResourceRegistry; candidateId: string } {
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
  };
  const baseline = registry.registerBaseline({ identity, content: BASELINE_POLICY, author: HUMAN });
  const candidate = registry.createCandidate({
    identity,
    content: candidateContent,
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  return { registry, candidateId: candidate.candidateId };
}

interface EpisodeSpec {
  readonly objective?: string;
  readonly allUnobserved?: boolean;
}

async function writeDataset(
  dir: string,
  episodes: number,
  rng: () => number,
  spec: EpisodeSpec = {}
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const eps = Array.from({ length: episodes }, (_, i) => ({
    episodeHash: `eh_${i}`,
    taskId: `tsk_e${i}`,
    role: pick(rng, ROLES),
    objective: spec.objective ?? pick(rng, OBJECTIVES),
    originalWorkspace: "/repos/alpha",
    ...(spec.allUnobserved === true || rng() >= 0.7
      ? {}
      : { taskSuccess: rng() < 0.5 ? "PASS" : "FAIL" }),
    ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test", "review"]) } : {})
  }));
  const manifest = { datasetId: "ds-r5d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* ============================================================
 * Section 0: whole-slice budget re-verification (R4-D S0 recheck).
 * End-to-end anchors: registry load / save(+fsync) / adapt-eval E=200.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r5d-sim-"));
let saveMsAnchor = 0;
{
  const rng = mulberry32(0xd55d01);
  const stateRoot = join(workRoot, "state");
  const { registry } = buildRoutingRegistry("b0");
  await saveAdaptationRegistry(stateRoot, registry);
  const datasetDir = join(workRoot, "dataset");
  await writeDataset(datasetDir, 200, rng);

  const loadMs = await benchAsync(async () => {
    await loadAdaptationRegistry(stateRoot);
  }, 30);
  const saveMs = await benchAsync(async () => {
    await saveAdaptationRegistry(stateRoot, registry);
  }, 30);
  saveMsAnchor = saveMs;

  const { registry: r2, candidateId } = buildRoutingRegistry("b1");
  await saveAdaptationRegistry(stateRoot, r2);
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  }, 20);
  console.log(
    `S0 budget anchors: registry load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * S5-D-1: registry.restore() re-validation of parseRegistrySnapshot-
 * produced fields (isResourceVersionId / isCandidateId re-checks).
 * On the load chain the checks are provably redundant (fuzz below), but
 * restore() is public and accepts arbitrary in-memory snapshots: a
 * trusting variant is fail-open (counterexample). Path specialization
 * needs a private trusted entry (X1-2 class). Cost anchor: ns.
 * ============================================================ */
{
  const rng = mulberry32(0xd55d02);

  // Load-path redundancy fuzz: snapshot -> JSON round-trip ->
  // parseRegistrySnapshot -> restore never throws, state round-trips.
  for (let trial = 0; trial < 300; trial += 1) {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(`d1t${trial}x`) });
    const identity: ResourceIdentity = {
      kind: pick(rng, ["prompt", "routing-policy"] as const),
      name: "main-agent-prompt",
      scope: rng() < 0.5
        ? { kind: "user-global" }
        : { kind: "project", projectId: createProjectId(() => `d1p${trial}`) }
    };
    const content1 = identity.kind === "routing-policy" ? BASELINE_POLICY : "v1";
    const content2 = identity.kind === "routing-policy" ? CANDIDATE_POLICY : "v2";
    const baseline = registry.registerBaseline({ identity, content: content1, author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: content2,
      parentVersionId: baseline.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    if (identity.kind === "prompt" && rng() < 0.6) {
      promoteWithRegistry(registry, {
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: baseline.versionId,
        content: content2,
        approvedBy: HUMAN,
        review: {
          reviewId: `rv-${trial}`,
          candidateId: candidate.candidateId,
          contentHash: candidate.contentHash,
          verdict: "approved",
          reviewerKind: "independent",
          reviewerId: "critic-gate",
          actorId: HUMAN.identity,
          evidenceRefs: [`review:${trial}`]
        },
        changeNote: {
          scope: `prompt:${trial}`,
          evidence: ["static"],
          guardrails: ["proposal-first"],
          rollbackVersionId: baseline.versionId
        },
        explicitApproval: true
      });
      if (rng() < 0.4) {
        registry.retire(baseline.versionId);
      }
    }
    const raw = JSON.parse(JSON.stringify(registry.snapshot())) as unknown;
    const parsed = parseRegistrySnapshot(raw);
    let threw: string | undefined;
    const rebuilt = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("z") });
    try {
      rebuilt.restore(parsed);
    } catch (error) {
      threw = (error as Error).message;
    }
    check("S5-D-1 load-path: restore(parseRegistrySnapshot(...)) never throws", threw === undefined, threw);
    // Normalize both sides through the parser: fresh-written ledger entries
    // and re-parsed ones legitimately differ in toVersionId key position
    // (two-state key order documented in R4-D S4-D-1).
    const normalize = (r: ResourceRegistry): string =>
      JSON.stringify(parseRegistrySnapshot(JSON.parse(JSON.stringify(r.snapshot()))));
    check(
      "S5-D-1 load-path: state round-trips (parser-normalized bytes)",
      normalize(rebuilt) === normalize(registry),
      `trial ${trial}`
    );
  }

  // Counterexample: restore() is public; a malformed in-memory snapshot
  // must fail closed. The trusting variant accepts it (fail-open).
  {
    const { registry } = buildRoutingRegistry("d1c");
    const good = registry.snapshot();
    const badVersion = { ...(good.versions[0] as ResourceVersion), versionId: "not-a-version-id" };
    const bad: ResourceRegistrySnapshot = {
      ...good,
      versions: [badVersion, ...good.versions.slice(1)]
    };
    let currentMsg = "<accepted>";
    try {
      new ResourceRegistry().restore(bad);
    } catch (error) {
      currentMsg = (error as Error).message;
    }
    check(
      "S5-D-1 counterexample: current restore fails closed on malformed snapshot",
      currentMsg.includes("invalid version id in snapshot"),
      currentMsg
    );
    // Trusting variant replica of the versions loop (check removed).
    const trustingById = new Map<string, unknown>();
    for (const version of bad.versions) {
      trustingById.set(version.versionId as string, version);
    }
    const trustingAccepts = trustingById.has("not-a-version-id");
    check("S5-D-1 counterexample: trusting variant accepts the malformed row (fail-open)", trustingAccepts);
    console.log(
      `S5-D-1 counterexample: current restore -> "${currentMsg}" | trusting variant accepts bogus id=${trustingAccepts} -> general elimination is fail-open (illegal); load-path specialization = X1-2-class private entry`
    );
  }

  // Cost anchor at realistic load scale: V=6 versions + C=8 candidates
  // + 2 retired ids re-checked per restore.
  {
    const versionIds = Array.from({ length: 8 }, (_, i) => `rsv_v${i}`);
    const candidateIds = Array.from({ length: 8 }, (_, i) => `cnd_c${i}`);
    const cost = bench(() => {
      for (let i = 0; i < 6; i += 1) isResourceVersionId(versionIds[i]);
      for (let i = 0; i < 8; i += 1) isCandidateId(candidateIds[i]);
      for (let i = 0; i < 2; i += 1) isResourceVersionId(versionIds[i]);
    }, 100000);
    console.log(
      `S5-D-1 anchor (V=6, C=8, retired=2): redundant re-validation in restore() = ${(cost * 1e6).toFixed(1)}ns per registry load`
    );
  }
}

/* ============================================================
 * S5-D-2: pairedRecords `episodes.entries()` iterator tuple allocation
 * -> classic index loop (distinct site from S4-D-5's Object.entries).
 * Verbatim replica + equivalence fuzz (incl. missing-action error path)
 * + bench at E=200.
 * ============================================================ */
{
  const rng = mulberry32(0xd55d03);
  interface Ep {
    readonly episodeHash: string;
    readonly taskFamily?: string | undefined;
    readonly taskSuccess?: "PASS" | "FAIL" | undefined;
  }
  interface Act {
    readonly taskFamily: string;
    readonly baselineCostUsd: number;
    readonly candidateCostUsd: number;
  }
  // Verbatim replica of the current module-private pairedRecords.
  function pairedRecordsCurrent(episodes: readonly Ep[], actions: readonly Act[]): PairedEvaluationRecord[] {
    const records: PairedEvaluationRecord[] = [];
    for (const [index, episode] of episodes.entries()) {
      if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
        continue;
      }
      const action = actions[index];
      if (action === undefined) {
        throw new DomainValidationError(`missing replay action for ${episode.episodeHash}`);
      }
      const utility = episode.taskSuccess === "PASS" ? 1 : 0;
      records.push({
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? action.taskFamily,
        baselineUtility: utility,
        candidateUtility: utility,
        baselineCostUsd: action.baselineCostUsd,
        candidateCostUsd: action.candidateCostUsd
      });
    }
    return records;
  }
  // Candidate: index loop, no per-episode [index, value] tuple.
  function pairedRecordsIndexLoop(episodes: readonly Ep[], actions: readonly Act[]): PairedEvaluationRecord[] {
    const records: PairedEvaluationRecord[] = [];
    for (let index = 0; index < episodes.length; index += 1) {
      const episode = episodes[index] as Ep;
      if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
        continue;
      }
      const action = actions[index];
      if (action === undefined) {
        throw new DomainValidationError(`missing replay action for ${episode.episodeHash}`);
      }
      const utility = episode.taskSuccess === "PASS" ? 1 : 0;
      records.push({
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? action.taskFamily,
        baselineUtility: utility,
        candidateUtility: utility,
        baselineCostUsd: action.baselineCostUsd,
        candidateCostUsd: action.candidateCostUsd
      });
    }
    return records;
  }

  for (let trial = 0; trial < 3000; trial += 1) {
    const n = Math.floor(rng() * 24);
    const episodes: Ep[] = Array.from({ length: n }, (_, i) => ({
      episodeHash: `eh_${trial}_${i}`,
      ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test"]) } : {}),
      ...(rng() < 0.7 ? { taskSuccess: rng() < 0.5 ? ("PASS" as const) : ("FAIL" as const) } : {})
    }));
    // ~6% of trials truncate actions to exercise the error path.
    const actions: Act[] = Array.from({ length: rng() < 0.06 ? Math.floor(n / 2) : n }, () => ({
      taskFamily: pick(rng, ["edit", "test", "review"]),
      baselineCostUsd: Math.round(rng() * 100) / 100,
      candidateCostUsd: Math.round(rng() * 100) / 100
    }));
    let a: string | undefined;
    let aErr: string | undefined;
    let b: string | undefined;
    let bErr: string | undefined;
    try {
      a = JSON.stringify(pairedRecordsCurrent(episodes, actions));
    } catch (error) {
      aErr = (error as Error).message;
    }
    try {
      b = JSON.stringify(pairedRecordsIndexLoop(episodes, actions));
    } catch (error) {
      bErr = (error as Error).message;
    }
    check("S5-D-2 equivalence (records + error path)", a === b && aErr === bErr, `trial ${trial}`);
  }

  const E = 200;
  const episodes: Ep[] = Array.from({ length: E }, (_, i) => ({
    episodeHash: `eh_b${i}`,
    ...(i % 2 === 0 ? { taskFamily: "edit" } : {}),
    ...(i % 10 < 7 ? { taskSuccess: i % 2 === 0 ? ("PASS" as const) : ("FAIL" as const) } : {})
  }));
  const actions: Act[] = Array.from({ length: E }, (_, i) => ({
    taskFamily: "test",
    baselineCostUsd: 0.5,
    candidateCostUsd: 0.1 + (i % 3) * 0.2
  }));
  const cur = bench(() => pairedRecordsCurrent(episodes, actions), 20000);
  const cand = bench(() => pairedRecordsIndexLoop(episodes, actions), 20000);
  console.log(
    `S5-D-2 bench E=${E}: current(entries)=${(cur * 1e6).toFixed(1)}ns index-loop=${(cand * 1e6).toFixed(1)}ns delta/eval-invocation=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * S5-D-3: save-path intermediate snapshot() object elimination
 * (serialize directly from internal structures). Anchor the
 * snapshot()+stringify share of the measured save(+fsync) total.
 * Rejection grounds are S1-G-2/S4-G-4 (public interface change) +
 * S5-A-2 (handwritten serializers measured slower) + share below bar.
 * ============================================================ */
{
  const { registry } = buildRoutingRegistry("d3s");
  const snapCost = bench(() => registry.snapshot(), 20000);
  const snap = registry.snapshot();
  const strCost = bench(() => JSON.stringify(snap, null, 2), 20000);
  const share = ((snapCost + strCost) / saveMsAnchor) * 100;
  console.log(
    `S5-D-3 anchor: snapshot()=${(snapCost * 1e6).toFixed(1)}ns stringify=${(strCost * 1e6).toFixed(1)}ns -> ${(snapCost + strCost).toFixed(4)}ms = ${share.toFixed(1)}% of save(+fsync)=${saveMsAnchor.toFixed(2)}ms (upper bound of any gain)`
  );
}

/* ============================================================
 * S5-D-4: evalRoutingPolicy early all-UNOBSERVED short-circuit before
 * assignTasks x2. Deterministic dual-fault counterexample: an
 * all-UNOBSERVED dataset containing a high-risk episode plus a candidate
 * policy that avoids the only high-risk-approved model. Current code
 * surfaces the routing refusal from inside replayAssignments; the
 * early-exit variant would surface the empty-records error instead.
 * ============================================================ */
{
  const rng = mulberry32(0xd55d04);
  const stateRoot = join(workRoot, "state-d4");
  const { registry, candidateId } = buildRoutingRegistry("d4", REFUSING_CANDIDATE_POLICY);
  await saveAdaptationRegistry(stateRoot, registry);
  const datasetDir = join(workRoot, "dataset-d4");
  // All-UNOBSERVED dataset; the deploy objective analyzes high-risk.
  await writeDataset(datasetDir, 8, rng, {
    objective: "Deploy the hotfix to the production environment",
    allUnobserved: true
  });
  let currentMsg = "<no error>";
  try {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  } catch (error) {
    currentMsg = (error as Error).message;
  }
  const variantMsg = "routing eval requires at least one episode with recorded PASS or FAIL";
  check(
    "S5-D-4 counterexample: current surfaces the routing refusal (not the empty-records error)",
    currentMsg !== "<no error>" && currentMsg !== variantMsg,
    currentMsg
  );
  console.log(
    `S5-D-4 counterexample (dual fault): current -> "${currentMsg.slice(0, 110)}..." | early-exit variant -> "${variantMsg}" -> observable error-selection divergence (S1-D-7/S4-D-3-A family)`
  );

  // Gain anchor: the skipped work exists only on the degenerate error path.
  const { registry: r2, candidateId: c2 } = buildRoutingRegistry("d4b");
  await saveAdaptationRegistry(join(workRoot, "state-d4b"), r2);
  const okDataset = join(workRoot, "dataset-d4b");
  await writeDataset(okDataset, 200, mulberry32(0xd55d04 + 1));
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot: join(workRoot, "state-d4b"), candidateId: c2, datasetDir: okDataset });
  }, 10);
  console.log(
    `S5-D-4 anchor: happy-path eval E=200 = ${evalMs.toFixed(2)}ms (early exit saves only the assignTasks x2 share, only on an all-UNOBSERVED dataset -> error-path-only, below veto line)`
  );
}

/* ============================================================
 * S5-D-5: rollback() intra-call resourceIdentityKey recomputation CSE
 * (versionsFor + getActiveVersion + casActivePointer each derive the
 * same key). The function is pure over an unchanged input, so hoisting
 * is trivially equivalent — but full CSE needs either inlining the
 * private map accesses (duplicating method logic) or changing the public
 * casActivePointer signature (X0-4 class). Anchor: ns per rollback.
 * ============================================================ */
{
  const rng = mulberry32(0xd55d05);
  const projectIds = ["p1", "p2", "a_b-C9"].map((s) => createProjectId(() => s));
  const identities: ResourceIdentity[] = Array.from({ length: 64 }, () => ({
    kind: pick(rng, ["prompt", "routing-policy", "rubric"] as const),
    name: pick(rng, ["main-agent-prompt", "learned-routing", "n|project:prj_x"]),
    scope: rng() < 0.5 ? { kind: "user-global" } : { kind: "project", projectId: pick(rng, projectIds) }
  }));
  // Purity/determinism probe: repeated computation is bytewise identical.
  for (const identity of identities) {
    check("S5-D-5 purity: resourceIdentityKey deterministic", resourceIdentityKey(identity) === resourceIdentityKey(identity));
  }
  const keyCost = bench(() => {
    for (const identity of identities) resourceIdentityKey(identity);
  }, 20000);
  const perKey = (keyCost / identities.length) * 1e6;
  console.log(
    `S5-D-5 anchor: resourceIdentityKey=${perKey.toFixed(1)}ns per call; rollback CAS path recomputes it 3x (versionsFor, getActiveVersion, casActivePointer) -> redundant share ~${(2 * perKey).toFixed(1)}ns per rollback; full CSE needs private-map inlining or a casActivePointer signature change (X0-4 class)`
  );
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

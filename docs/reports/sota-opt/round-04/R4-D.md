MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-D：`src/adaptation/` 第四遍搜查报告（Round 1–3 同区第四遍）

**战役:** 全库持久 SOTA 优化 Round 4 / R4-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `cb65c81`
**分支:** `cursor/r4-d-adaptation-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D（`6ef886e`）、R3-D（`c9c7017`）至本轮基线
（`cb65c81`）**逐字节未变**（`git diff 82bef36..cb65c81 -- src/adaptation/`
为空），前三轮全部规模测量、逐文件收口与 S1-D-1..9 / S2-D-1..5 /
S3-D-1..5 排除继承有效。本轮先按指令**复核 R3-D 的整片预算支配论证**
（§1，端到端新锚点：`adapt eval` E=200 全程 4.35–4.38ms/调用、registry
save+fsync 0.55–0.80ms——切片内可寻址 ns~µs 候选低于数十~数百 ms 落地线
≥3 个量级，论证成立），再换第四组新透镜全量重读枚举，得到 5 个此前排除表
未点名的新候选（S4-D-1 … S4-D-5），全部经理论 + 确定性仿真（seeded
mulberry32，等价 fuzz / 别名与错误次序反例 / 真实规模基准，两次独立运行
等价结论**逐位一致**）裁决后淘汰：2 个有可观察发散反例（S4-D-2 一般化、
S4-D-3 两条），其余在抖动~µs 噪声带；最强候选（S4-D-3，重叠收益上界
79–127µs/eval 调用）仍低于战役否决线（已否决标尺 S1-I-1 ~190µs、
S3-D-3 351–388µs 同量级或更高）。未重开任何 X* / S1-* / S2-* / S3-* /
S4-A-* / S4-B-* 条目。X2-5 维持排除未触碰。CAS/权限/凭据/数据面语义
零 diff，天然不变。本切片在该人审门控低频控制面契约下维持 SOTA。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate）本轮再次**全量实际读码**，未依赖前三轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表含 S4-A-1..3、S4-B-1..5）/
  round-04/PLAN.md / round-01/R1-D.md / round-02/R2-D.md / round-03/R3-D.md。
- 基线漂移检查：`git diff 82bef36..cb65c81 -- src/adaptation/` 与
  `git diff c9c7017..cb65c81 -- src/adaptation/` 均为空。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5 直接跳过；
  S1-D-1..9 / S2-D-1..5 / S3-D-1..5 全部不再提案；X1-1/X0-4/X1-2/X0-5/
  X0-6 全部绕开。本轮只探索**未被点名的第四组透镜**：解析器尾部条件
  spread（S4-D-1）、跨函数载入链双拷贝（S4-D-2）、独立 I/O 顺序 await
  重叠化（S4-D-3）、已知有效默认值的死校验（S4-D-4）、递归遍历的
  entries 元组分配（S4-D-5）。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`（S1-F/J1/S1-C/S1-I/S2-C/S3-C 均在
  切片外或已落地，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升（`autoPromotableFor` 由 kind 派生、
  `NON_AUTO_PROMOTABLE_KINDS` 强制在 neverAutoPromote）、`adapt auto`
  只提案——零 diff，天然满足。双 LCB 与双归因不涉及本切片，均未触碰。
  不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。
  不改阈值、权限、数据面契约、公开签名。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 的论证：全部生产入口是每进程一次的 CLI/auto-loop（磁盘载入→
单次操作→原子保存）；切片内可寻址成本 promote/rollback 路径 <~10µs、
eval 路径 <0.5ms，均被固定 ms 级成本支配。本轮用**真实入口端到端**新锚点
复核（temp stateRoot + 真实 `saveAdaptationRegistry`/`loadAdaptationRegistry`/
`evalRoutingPolicy`，E=200 数据集，两次独立运行）：

```text
S0 budget anchors: registry load=0.11–0.13ms save(+fsync)=0.55–0.80ms
                   adapt-eval end-to-end (E=200)=4.35–4.38ms per invocation
```

即：eval 调用固定支付 ~4.4ms（含 registry 载入重哈希、dataset 读取、
`assignTasks`×2、guard 构建、report 写盘），promote/rollback 调用固定支付
~0.7–0.9ms 的 load+save。本轮五个候选的收益上界（最大 127µs）不足
eval 固定成本的 3%，距数十~数百 ms 落地线 ≥2.5 个量级。**R3-D 预算论证
成立且经端到端复核加强**——在「人审门控低频控制面 + E≲10³」契约下，
本切片不存在达门槛的保行为优化空间。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-D-1 | promotion `parseLedgerEntry` 尾部条件 spread 消除（`{ ...entry, toVersionId }` 改单字面量 + 尾置条件展开，键序/求值序均保持） | 免 1 次 ~9 字段对象拷贝/条目（intent/promoted/rejected 几乎全带 toVersionId） | ✅ 复刻先经 `parseRegistrySnapshot` 与真实解析器 300×N 逐字节对齐（含键序）；3000 fuzz（含坏输入错误路径）逐位一致 | L=6 两次运行 delta **+0.5ns / −145ns**、L=60 **−2.9ns / −192ns**——**符号翻转，纯抖动**（S3-E-1 同境地） | 淘汰：实测零收益（V8 已优化尾 spread），L 个位~十位、每进程一次 |
| S4-D-2 | rollback 载入链双拷贝消除（`parseRollbackLedgerEntry` 已返回新鲜拷贝，`RollbackLog.restore()` 再逐条拷贝；改 restore 信任输入） | 免 L 次 7 字段拷贝/载入 | ❌ **一般化发散反例**（外部调用方 restore 后变异持有 entry.evidence：现行隔离、信任变体泄漏）；仅注册表载入路径等价（1000 fuzz 一致） | 第二次拷贝 L=6 全载入仅 **133–143ns** | 淘汰：不等价（restore 是公开方法，别名安全是契约——S1-G-9/X4-2 同域）；路径特化需私有信任入口（X1-2 类）；收益亦 ns 级 |
| S4-D-3 | eval-routing `evalRoutingPolicy` registry 与 dataset 两次独立 await 载入重叠/并行化 | I/O 延迟重叠，上界 min(T_registry, T_dataset) | ❌ **两条发散反例**：(A) 天真 Promise.all 双故障时浮出 dataset 错误而非 registry 错误（确定性复现，S2-J-10 同族）；(B) 保错误次序的顺序 await 重叠变体在 candidate 校验失败路径上仍**投机读取 dataset 文件**（顺序版 0 次读 vs 重叠版 1 次读，外部可观察副作用） | 上界 min(78.9µs, 192.1µs)–min(126.9µs, 195.7µs) = **79–127µs/eval 调用**；每 `adapt eval` CLI 进程一次 | 淘汰：**本轮最强候选仍低于否决线**（S1-I-1 ~190µs、S2-D-4 116µs、S3-D-3 351–388µs 同量级已否决）；非 CPU 复杂度下降，是 I/O 重叠；且无发散的实现不存在（A/B 至少居其一） |
| S4-D-4 | registry `preparePromotion` 对新建默认 approval-profile 跳过 `validateApprovalProfile`（默认工厂产物可证恒有效） | 免 1 次 ~10 项校验/promote | ✅ 探针证默认恒过（平凡） | create+validate 共 **108–111ns**/promote（create 单独 13–14ns） | 淘汰：ns 级 + fail-closed 防御纵深（防未来默认工厂漂移；S2-D-5/updateCandidateStatus 全字段 revalidate 同族，安全侧保留） |
| S4-D-5 | eval-routing `assertNoForbiddenFields` 递归 `Object.entries` 改 `Object.keys` 循环（免每节点元组数组分配） | 免 O(节点数) 元组分配 | ✅ 3000 fuzz（8% 注入大小写变体禁字段、随机深度）抛错/放行与首个禁字段错误消息逐字节一致（entries 与 keys 枚举序相同） | 真实 ~1.5KB 策略 delta **2.56–2.59µs/次**，每 eval 调用 2 次（candidate+baseline）共 ~5.2µs | 淘汰：µs 级、每进程 2 次、被 4.4ms 端到端成本支配（占比 ~0.1%）；R2-D 已把该遍历的 key.toLowerCase() 归入常数噪声同域 |

## 3. 关键裁决细节

### S4-D-2：路径等价 ≠ 契约等价（第三个 restore 别名反例）

`parseRegistrySnapshot` → `registry.restore` → `rollbackLog.restore` 链上，
每条 rollback ledger 条目被拷贝两次（S3-D-4 处理的是 parse **内部**的
外层再拷贝，本条是 parse 输出→restore 的**跨函数**第二拷贝，前三轮均未
点名）。在该链上输入恒新鲜、信任变体可证等价；但 `RollbackLog.restore`
是公开方法，其拷贝是对任意调用方的别名隔离契约——反例：调用方 restore
后 `entry.evidence.push("ev:injected-after-restore")`，现行 `last()` 不含
注入项、信任变体含。消除只剩两条路：信任所有调用方（S1-G-9 同域危险）
或开私有信任入口（X1-2 平行路径）。叠加 133–143ns 的收益规模，两条
理由各自独立充分，淘汰。

### S4-D-3：本轮最强候选为何不存在无发散实现

`evalRoutingPolicy` 顺序 await 两次独立载入（registry → 中间夹 candidate
存在性/kind/内容校验 → dataset），是切片内唯一可寻址的 I/O 串行点。
两条实现路线各有确定性反例：

1. **天真 `Promise.all`**：双故障输入（registry 慢失败 30ms + dataset
   快失败）下浮出错误从 `registry-error` 变为 `dataset-error`——
   Promise.all 按时间序而非程序序拒绝，与 S2-J-10（readFeedback 双读
   Promise.all，双故障抛错竞态）同族，且这里两个错误分属不同用户可
   操作项（registry 损坏 vs 数据集路径错误），错误选择可观察且不确定。
2. **保错误次序的重叠**（先发 dataset promise 挂 catch-noop，按序
   await）：错误次序逐位保持，但 candidate 校验失败路径（unknown
   candidate / 非 routing-policy / 内容缺失）上 dataset 文件被投机打开
   读取——顺序版 0 次读 vs 重叠版 1 次读。文件系统访问（atime、
   特殊文件阻塞、审计日志）是进程外可观察副作用，且该读取在错误路径
   上纯属浪费。

即使忽略两条反例，收益上界 = min(两载入耗时) = 79–127µs/eval 调用
（实测两次运行），低于战役已否决的同量级标尺（S1-I-1 ~190µs、S3-D-3
351–388µs），占 4.4ms 端到端成本 <3%，每 CLI 进程仅一次。淘汰。

### S4-D-1：第四遍的反向教训（理论收益被 V8 逃逸分析清零）

尾部 `{ ...entry, toVersionId }` 理论上是每条目一次全字段拷贝，但两次
独立基准的 delta 符号翻转（+0.5ns/−145ns 与 −2.9ns/−192ns），单字面量
变体**没有任何可测优势**——`entry` 不逃逸出函数，V8 对「构建后立即
spread 进新字面量」的模式已优化。与 S1-A-4/S1-B-6/S3-B-5 同列
「理论遍数/分配下降被运行时优化反超或清零」的反例库。等价性本身
完全可证（含持久化键序逐字节一致——注意 `beginPromotion` 现写条目
键序 toVersionId 在第 4 位、载入重存后在末位，本已两态，变体保持
载入侧末位不变）。淘汰。

## 4. 逐文件收口（第四遍新检查点，叠加 R1-D/R2-D/R3-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S4-D-4；`rollback()` 的 `knownTargets.some` 先于 `identityEquals` 的次序是错误消息契约的一部分（R1-D 已判 fail-closed 本体，两处删任一都改变多故障输入的抛错）；`promoteWithRegistry`→`preparePromotion` 的双 `getCandidate` = S2-D-2 同族冗余 Map.get（ns 级 + 消除需改签名，不另立 ID）；routing-policy promote 全链三次 `hashCandidateContent`（外层 assert、内层 assert、putContent）= R1-D 已判 CAS fail-closed 契约（X1-1 域） | 无候选落地 |
| `promotion.ts` | 见 S4-D-1；`parsePending`/`parseLedgerEntry` 条件 review spread 在字面量中间，无第二拷贝；`snapshot()` 直接 stringify 免中间对象 = S1-G-2 同族（需扩公开接口 + stringify 支配），不提案 | 无候选落地 |
| `promotion-rules.ts` | `validatePromotionReview` 单遍布尔链已最优；`assertRoutingPolicyEvalReport` 的 provisional 双条件与 claims 检查是规格语义（顺序即错误契约） | 无候选 |
| `candidate.ts` | `assertSingleResourceBoundary` 的 `content.trim()` 仅扫两端空白，O(1) 级；`candidateError` 与 `isCandidate` 共享错误枚举无重复计算 | 无候选 |
| `eval-routing.ts` | 见 S4-D-3/5；`replayAssignments` 对全部 episodes（含 UNOBSERVED）构建 actions 非死功——rerunHash 序列化消费全量 actions（验证过，无可跳过项）；episode 条件 spread 的 4 种隐藏类对下游是多态 IC，E=200 亚 µs，不提案 | 无候选落地 |
| `pareto.ts` | 第四遍无新角度（S1-D-6/S3-D-2 维持；校验-过滤-排序三段次序均为契约） | 无候选 |
| `rollback.ts` | 见 S4-D-2；`validateRollbackInput` 的 guardrail/automatic 交叉检查次序是错误契约 | 无候选落地 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 三个薄委托 / 三个 O(1) 纯函数——第四遍无新角度 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；`restore()` 先全量 copy 再替换的次序保证坏输入不半写（fail-closed，不可重排）；S2-D-5/S3-D-5 维持 | 无候选 |
| `approval-profile.ts` | 见 S4-D-4；`isAutoAdaptEnabled` O(1)；`canAutoPromote` 六道短路次序是规格语义（R1-D 已判） | 无候选落地 |
| `reflection.ts` | 生产无调用方（R3-D grep 图景，代码未变继承）；`proposeCandidates` cap 早退已存在；`instructionFor` 模板字符串 O(1) | 无候选 |
| `mutate.ts` | `adjustParameter` 两遍正则维持「记录不改」；`escapeRegExp` 每次调用一遍 O(name) 为一次性变异噪声 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22.14.0，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd44d01`–`0xd44d05`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 budget anchors: registry load=0.11–0.13ms save(+fsync)=0.55–0.80ms | adapt-eval end-to-end (E=200)=4.35–4.38ms per invocation
S4-D-1 bench L=6: delta/registry-load=+0.5ns / −145.1ns (两次运行，符号翻转=抖动) | L=60: −2.9ns / −191.8ns
S4-D-2 counterexample: current restore isolated=true | trusting variant leaks=true -> general elimination NOT behavior-preserving
S4-D-2 anchor L=6: second copy in restore() = 133.1–142.7ns per registry load
S4-D-3 counterexample A (dual fault): sequential -> "registry-error" | Promise.all -> "dataset-error" -> observable divergence
S4-D-3 counterexample B (unknown candidate): sequential dataset reads=0 | overlapped=1 -> speculative I/O side effect
S4-D-3 anchor: T_registry-load=78.9–126.9us T_dataset-read+parse=192.1–195.7us -> max overlap gain=79–127us per eval invocation
S4-D-4 anchor: create+validate default profile=108.6–111.3ns per promote invocation
S4-D-5 bench realistic policy (~1507B, x2 per eval): delta/parse=2556.7–2586.3ns
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-D-1 | promotion `parseLedgerEntry` 尾部条件 spread 消除 | 等价可证（含持久化键序），但两次基准 delta 符号翻转、纯抖动零收益（V8 已优化非逃逸 spread；S1-A-4/S3-B-5 同列反向教训）；L 个位~十位每进程一次 |
| S4-D-2 | rollback 载入链 `parseRollbackLedgerEntry`→`RollbackLog.restore` 双拷贝消除 | 一般化不等价：restore 是公开方法，拷贝是别名隔离契约（restore 后变异 evidence 的泄漏反例）；路径特化需私有信任入口（X1-2 类）；收益 133–143ns/载入 |
| S4-D-3 | eval-routing `evalRoutingPolicy` registry/dataset 载入重叠或 Promise.all 并行 | 两条发散反例：Promise.all 双故障错误选择漂移（S2-J-10 同族）、保序重叠在错误路径投机读 dataset 文件（外部可观察副作用）；上界 79–127µs/eval 调用低于否决线（S1-I-1/S3-D-3 同量级已否决），非复杂度下降 |
| S4-D-4 | `preparePromotion` 对默认 approval-profile 跳过 `validateApprovalProfile` | 恒有效可证但 ~110ns/promote；fail-closed 防御纵深（防默认工厂漂移，S2-D-5 同族安全侧保留） |
| S4-D-5 | `assertNoForbiddenFields` `Object.entries` 改 `Object.keys` 循环 | 等价可证（枚举序相同、首错逐字节一致），但 ~2.6µs/次 ×2/eval，占端到端 ~0.1%，被 ms 级固定成本支配 |

重开条件：S4-D-3 若 (a) registry/dataset 体量增长使 min(两载入) ≥
数十 ms（约需 snapshot 或 manifest 增大 ≥2 个量级），且 (b) 先由战役
裁定「错误路径投机读 dataset」不算行为发散（安全边界决策）——两条
须同时满足，届时用保序重叠变体（本报告已给等价错误次序构造）；
S4-D-5 若策略体量增长 ≥3 个量级（MB 级策略）可凭本报告等价证据重开；
S4-D-1/2/4 需先推翻各自的抖动实测/别名契约/防御纵深裁决。整片层面：
唯一可能改变预算论证的仍是 E 增长 ≥2 个量级（继承 R3-D §6 与 S3-D-3
重开条件）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts`（或仓库根目录内任意 `.ts`）后
`npx tsx <file>`（依赖已装）。seeds：`0xd44d01`–`0xd44d05`。

```ts
/**
 * R4-D deterministic equivalence + benchmark simulation (fourth pass).
 * Adjudicates fresh candidates S4-D-1 .. S4-D-5 against the current
 * implementations in src/adaptation/, and re-verifies the R3-D whole-slice
 * budget-domination argument with end-to-end anchors.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd44d01 - 0xd44d05.
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  parseRegistrySnapshot,
  parsePromotionReview,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  type PromotionLedgerEntry,
  type ChangeNote
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy } from "/workspace/src/adaptation/eval-routing.js";
import {
  RollbackLog,
  parseRollbackLedgerEntry,
  type RollbackLedgerEntry
} from "/workspace/src/adaptation/rollback.js";
import {
  createDefaultApprovalProfile,
  validateApprovalProfile
} from "/workspace/src/adaptation/approval-profile.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity } from "/workspace/src/adaptation/resource.js";
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

async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T07:00:00.000Z" as IsoTimestamp;
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

const ROLES = ["worker", "scout", "planner", "implementer", "reviewer", "tester", "debugger"] as const;
const OBJECTIVES = [
  "Fix the failing unit test in the adapter and rerun the suite",
  "Refactor the retry helper to remove duplicated backoff logic",
  "Review the migration PR for schema drift and unsafe defaults",
  "Investigate why the nightly benchmark regressed on large inputs",
  "Plan the rollout of the new caching layer across services"
];

/** Build a realistic registry with a routing-policy baseline + candidate. */
function buildRoutingRegistry(tag: string): {
  registry: ResourceRegistry;
  candidateId: string;
} {
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
  };
  const baseline = registry.registerBaseline({ identity, content: BASELINE_POLICY, author: HUMAN });
  const candidate = registry.createCandidate({
    identity,
    content: CANDIDATE_POLICY,
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  return { registry, candidateId: candidate.candidateId };
}

async function writeDataset(dir: string, episodes: number, rng: () => number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const eps = Array.from({ length: episodes }, (_, i) => ({
    episodeHash: `eh_${i}`,
    taskId: `tsk_e${i}`,
    role: pick(rng, ROLES),
    objective: pick(rng, OBJECTIVES),
    originalWorkspace: "/repos/alpha",
    ...(rng() < 0.7 ? { taskSuccess: rng() < 0.5 ? "PASS" : "FAIL" } : {}),
    ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test", "review"]) } : {})
  }));
  const manifest = { datasetId: "ds-r4d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* ============================================================
 * Section 0: whole-slice budget re-verification (R3-D §3 recheck).
 * End-to-end anchors: registry load / save / adapt-eval invocation.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r4d-sim-"));
{
  const rng = mulberry32(0xd44d01);
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

  // Rebuild with a fresh candidate id per eval not needed: eval is read-only
  // over the registry; reuse one candidate id.
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
 * S4-D-1: parseLedgerEntry tail conditional spread elimination.
 * Current: builds `entry` literal, then `{ ...entry, toVersionId }` when
 * toVersionId is defined (a second ~9-field copy for nearly every entry).
 * Variant: single literal with a trailing conditional spread — key order
 * (toVersionId last) and evaluation order preserved.
 * ============================================================ */
{
  const rng = mulberry32(0xd44d02);

  function asRecordL(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DomainValidationError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
  }
  function asStringArrayL(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new DomainValidationError(`${label} must be an array of strings`);
    }
    return value as string[];
  }
  const LEDGER_KINDS = ["promoted", "rejected", "intent"] as const;
  const AUTHOR_KINDS = ["human", "model", "detector"] as const;
  const RSV = /^rsv_[A-Za-z0-9_-]{1,64}$/;
  const CND = /^cnd_[A-Za-z0-9_-]{1,64}$/;
  const ISO = (v: unknown): boolean => typeof v === "string" && !Number.isNaN(Date.parse(v));
  function parseAuthorL(value: unknown, label: string): AuthorIdentity {
    const record = asRecordL(value, label);
    if (typeof record.kind !== "string" || !(AUTHOR_KINDS as readonly string[]).includes(record.kind)) {
      throw new DomainValidationError(`${label}.kind is invalid`);
    }
    if (typeof record.identity !== "string" || record.identity.trim() === "") {
      throw new DomainValidationError(`${label}.identity is required`);
    }
    return { kind: record.kind as AuthorIdentity["kind"], identity: record.identity };
  }
  function parseChangeNoteL(value: unknown): ChangeNote {
    const record = asRecordL(value, "changeNote");
    if (typeof record.rollbackVersionId !== "string" || !RSV.test(record.rollbackVersionId)) {
      throw new DomainValidationError("changeNote.rollbackVersionId is invalid");
    }
    return {
      scope: typeof record.scope === "string" ? record.scope : "",
      evidence: asStringArrayL(record.evidence, "changeNote.evidence"),
      guardrails: asStringArrayL(record.guardrails, "changeNote.guardrails"),
      rollbackVersionId: record.rollbackVersionId as ChangeNote["rollbackVersionId"]
    };
  }
  function commonChecks(record: Record<string, unknown>): void {
    if (typeof record.kind !== "string" || !(LEDGER_KINDS as readonly string[]).includes(record.kind)) {
      throw new DomainValidationError(`invalid ledger kind: ${String(record.kind)}`);
    }
    if (typeof record.candidateId !== "string" || !CND.test(record.candidateId)) {
      throw new DomainValidationError("ledger candidateId is invalid");
    }
    if (typeof record.fromVersionId !== "string" || !RSV.test(record.fromVersionId)) {
      throw new DomainValidationError("ledger fromVersionId is invalid");
    }
    if (typeof record.expectedCurrentVersionId !== "string" || !RSV.test(record.expectedCurrentVersionId)) {
      throw new DomainValidationError("ledger expectedCurrentVersionId is invalid");
    }
    if (!ISO(record.at)) {
      throw new DomainValidationError("ledger at must be an ISO timestamp");
    }
  }
  // Verbatim replica of the current parseLedgerEntry.
  function parseLedgerEntryCurrent(value: unknown): PromotionLedgerEntry {
    const record = asRecordL(value, "ledger entry");
    commonChecks(record);
    let toVersionId: string | undefined;
    if (record.toVersionId !== undefined && record.toVersionId !== null) {
      if (typeof record.toVersionId !== "string" || !RSV.test(record.toVersionId)) {
        throw new DomainValidationError("ledger toVersionId is invalid");
      }
      toVersionId = record.toVersionId;
    }
    const entry = {
      kind: record.kind,
      candidateId: record.candidateId,
      fromVersionId: record.fromVersionId,
      expectedCurrentVersionId: record.expectedCurrentVersionId,
      approvedBy: parseAuthorL(record.approvedBy, "ledger.approvedBy"),
      ...(record.review !== undefined ? { review: parsePromotionReview(record.review) } : {}),
      changeNote: parseChangeNoteL(record.changeNote),
      at: record.at
    } as unknown as PromotionLedgerEntry;
    return toVersionId === undefined
      ? entry
      : ({ ...entry, toVersionId } as unknown as PromotionLedgerEntry);
  }
  // Candidate variant: single literal, trailing conditional spread.
  function parseLedgerEntryNoTailSpread(value: unknown): PromotionLedgerEntry {
    const record = asRecordL(value, "ledger entry");
    commonChecks(record);
    let toVersionId: string | undefined;
    if (record.toVersionId !== undefined && record.toVersionId !== null) {
      if (typeof record.toVersionId !== "string" || !RSV.test(record.toVersionId)) {
        throw new DomainValidationError("ledger toVersionId is invalid");
      }
      toVersionId = record.toVersionId;
    }
    return {
      kind: record.kind,
      candidateId: record.candidateId,
      fromVersionId: record.fromVersionId,
      expectedCurrentVersionId: record.expectedCurrentVersionId,
      approvedBy: parseAuthorL(record.approvedBy, "ledger.approvedBy"),
      ...(record.review !== undefined ? { review: parsePromotionReview(record.review) } : {}),
      changeNote: parseChangeNoteL(record.changeNote),
      at: record.at,
      ...(toVersionId !== undefined ? { toVersionId } : {})
    } as unknown as PromotionLedgerEntry;
  }

  const genRaw = (i: number, opts?: { bad?: boolean }): Record<string, unknown> => {
    const raw: Record<string, unknown> = {
      kind: opts?.bad === true && rng() < 0.3 ? "bogus" : pick(rng, LEDGER_KINDS),
      candidateId: `cnd_l${i}`,
      fromVersionId: `rsv_from${i}`,
      expectedCurrentVersionId: `rsv_exp${i}`,
      approvedBy: { kind: "human", identity: "operator" },
      ...(rng() < 0.7
        ? {
            review: {
              reviewId: `rv-${i}`,
              candidateId: `cnd_l${i}`,
              contentHash: "deadbeef",
              verdict: "approved",
              reviewerKind: "independent",
              reviewerId: "critic-gate",
              actorId: "operator",
              evidenceRefs: [`review:${i}`]
            }
          }
        : {}),
      changeNote: {
        scope: `scope:${i}`,
        evidence: [`ev:${i}`],
        guardrails: ["proposal-first"],
        rollbackVersionId: `rsv_exp${i}`
      },
      at: NOW,
      ...(rng() < 0.8 ? { toVersionId: `rsv_to${i}` } : {})
    };
    if (opts?.bad === true && rng() < 0.3) delete raw.changeNote;
    return raw;
  };

  // Cross-check the replica against the real parser via parseRegistrySnapshot.
  for (let trial = 0; trial < 300; trial += 1) {
    const raws = Array.from({ length: 1 + Math.floor(rng() * 8) }, (_, i) => genRaw(trial * 100 + i));
    const snapshot = parseRegistrySnapshot({
      versions: [],
      activeVersionIds: [],
      candidates: [],
      ledger: raws,
      pending: [],
      autoPromotionsUsed: 0
    });
    for (let i = 0; i < raws.length; i += 1) {
      check(
        "S4-D-1 replica matches real parseLedgerEntry (bytes incl. key order)",
        JSON.stringify(snapshot.ledger[i]) === JSON.stringify(parseLedgerEntryCurrent(raws[i])),
        `trial ${trial} entry ${i}`
      );
    }
  }
  // Equivalence fuzz current vs variant (incl. error paths).
  for (let trial = 0; trial < 3000; trial += 1) {
    const raw = genRaw(900000 + trial, { bad: true });
    let a: string | undefined;
    let aErr: string | undefined;
    let b: string | undefined;
    let bErr: string | undefined;
    try {
      a = JSON.stringify(parseLedgerEntryCurrent(raw));
    } catch (error) {
      aErr = (error as Error).message;
    }
    try {
      b = JSON.stringify(parseLedgerEntryNoTailSpread(raw));
    } catch (error) {
      bErr = (error as Error).message;
    }
    check("S4-D-1 equivalence (bytes incl. key order + error)", a === b && aErr === bErr, `trial ${trial}`);
  }
  for (const L of [6, 60]) {
    const raws = Array.from({ length: L }, (_, i) => genRaw(800000 + i));
    const cur = bench(() => {
      for (const raw of raws) parseLedgerEntryCurrent(raw);
    }, L > 10 ? 5000 : 30000);
    const cand = bench(() => {
      for (const raw of raws) parseLedgerEntryNoTailSpread(raw);
    }, L > 10 ? 5000 : 30000);
    console.log(
      `S4-D-1 bench L=${L}: current=${(cur * 1e6).toFixed(1)}ns variant=${(cand * 1e6).toFixed(1)}ns delta/registry-load=${((cur - cand) * 1e6).toFixed(1)}ns`
    );
  }
}

/* ============================================================
 * S4-D-2: load-chain double copy — parseRollbackLedgerEntry already returns
 * fresh copies; RollbackLog.restore() copies each entry again. A trusting
 * restore is equivalent ON THE REGISTRY LOAD PATH, but the general restore()
 * contract needs the copy: external callers may mutate their arrays/entries
 * after restore (alias counterexample). Eliminating it needs a private
 * trusted path (X1-2 class).
 * ============================================================ */
{
  const rng = mulberry32(0xd44d03);
  const genRaw = (i: number): Record<string, unknown> => ({
    kind: pick(rng, ["rolled-back", "rollback-proposed", "rollback-rejected"] as const),
    fromVersionId: `rsv_from${i}`,
    toVersionId: `rsv_to${i}`,
    reason: pick(rng, ["guardrail", "degradation", "user"] as const),
    automatic: rng() < 0.5,
    evidence: Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, k) => `ev:${i}:${k}`),
    at: NOW
  });

  // Alias counterexample against the real RollbackLog.
  {
    const parsed = parseRollbackLedgerEntry(genRaw(1));
    const held = [parsed];
    const log = new RollbackLog();
    log.restore(held);
    (parsed.evidence as string[]).push("ev:injected-after-restore");
    const currentIsolated = !(log.last() as RollbackLedgerEntry).evidence.includes("ev:injected-after-restore");
    check("S4-D-2 current restore() isolates caller-held entries", currentIsolated);

    class TrustingLog {
      private entries: RollbackLedgerEntry[] = [];
      restore(entries: readonly RollbackLedgerEntry[]): void {
        this.entries = [...entries];
      }
      last(): RollbackLedgerEntry | undefined {
        return this.entries.at(-1);
      }
    }
    const parsed2 = parseRollbackLedgerEntry(genRaw(2));
    const trusting = new TrustingLog();
    trusting.restore([parsed2]);
    (parsed2.evidence as string[]).push("ev:injected-after-restore");
    const trustingLeaks = (trusting.last() as RollbackLedgerEntry).evidence.includes("ev:injected-after-restore");
    check("S4-D-2 trusting variant leaks caller mutation (counterexample)", trustingLeaks);
    console.log(
      `S4-D-2 counterexample: current restore isolated=${currentIsolated} | trusting variant leaks=${trustingLeaks} -> general elimination NOT behavior-preserving`
    );
  }

  // Registry-load-path equivalence: parse output is fresh, so a trusted batch
  // restore observes the same list (fuzz).
  for (let trial = 0; trial < 1000; trial += 1) {
    const raws = Array.from({ length: Math.floor(rng() * 8) }, (_, i) => genRaw(trial * 100 + i));
    const parsed = raws.map(parseRollbackLedgerEntry);
    const log = new RollbackLog();
    log.restore(parsed);
    check(
      "S4-D-2 load-path equivalence (copied list == trusted list)",
      JSON.stringify(log.list()) === JSON.stringify(parsed),
      `trial ${trial}`
    );
  }

  // Cost anchor: the second copy of L=6 entries.
  const entries = Array.from({ length: 6 }, (_, i) => parseRollbackLedgerEntry(genRaw(700 + i)));
  const copyCost = bench(() => {
    entries.map((entry) => ({
      kind: entry.kind,
      fromVersionId: entry.fromVersionId,
      toVersionId: entry.toVersionId,
      reason: entry.reason,
      automatic: entry.automatic,
      evidence: [...entry.evidence],
      at: entry.at
    }));
  }, 50000);
  console.log(
    `S4-D-2 anchor L=6: second copy in restore() = ${(copyCost * 1e6).toFixed(1)}ns per registry load`
  );
}

/* ============================================================
 * S4-D-3: evalRoutingPolicy sequential awaits (registry then dataset) ->
 * overlapped/parallel loads. Two counterexamples + a gain upper bound.
 * ============================================================ */
{
  // Counterexample A: naive Promise.all changes which error surfaces on
  // dual-fault input (registry slow-fails, dataset fast-fails).
  const slowRegistryFail = (): Promise<never> =>
    new Promise((_, reject) => setTimeout(() => reject(new Error("registry-error")), 30));
  const fastDatasetFail = (): Promise<never> => Promise.reject(new Error("dataset-error"));

  const sequentialError = await (async () => {
    try {
      await slowRegistryFail();
      await fastDatasetFail();
      return "<none>";
    } catch (error) {
      return (error as Error).message;
    }
  })();
  const parallelError = await (async () => {
    try {
      await Promise.all([slowRegistryFail(), fastDatasetFail()]);
      return "<none>";
    } catch (error) {
      return (error as Error).message;
    }
  })();
  check(
    "S4-D-3 counterexample A: Promise.all surfaces a different error on dual fault",
    sequentialError === "registry-error" && parallelError === "dataset-error",
    `${sequentialError} vs ${parallelError}`
  );
  console.log(
    `S4-D-3 counterexample A (dual fault): sequential -> "${sequentialError}" | Promise.all -> "${parallelError}" -> observable divergence`
  );

  // Counterexample B: ordered-await overlap still performs a speculative
  // dataset read on candidate-validation failure paths.
  let datasetReads = 0;
  const countingDatasetLoad = async (): Promise<string> => {
    datasetReads += 1;
    return "dataset";
  };
  const failingCandidateCheck = (): void => {
    throw new DomainValidationError("unknown candidate: cnd_missing");
  };
  // sequential shape (current)
  datasetReads = 0;
  try {
    failingCandidateCheck();
    await countingDatasetLoad();
  } catch {
    /* expected */
  }
  const sequentialReads = datasetReads;
  // overlapped shape (start dataset load first, await later)
  datasetReads = 0;
  try {
    const datasetPromise = countingDatasetLoad();
    datasetPromise.catch(() => undefined);
    failingCandidateCheck();
    await datasetPromise;
  } catch {
    /* expected */
  }
  const overlappedReads = datasetReads;
  check(
    "S4-D-3 counterexample B: overlap reads the dataset on error paths",
    sequentialReads === 0 && overlappedReads === 1,
    `${sequentialReads} vs ${overlappedReads}`
  );
  console.log(
    `S4-D-3 counterexample B (unknown candidate): sequential dataset reads=${sequentialReads} | overlapped=${overlappedReads} -> speculative I/O side effect`
  );

  // Gain upper bound: min(T_registry, T_dataset) per eval invocation.
  const rng = mulberry32(0xd44d04);
  const stateRoot = join(workRoot, "state-d3");
  const { registry } = buildRoutingRegistry("d3");
  await saveAdaptationRegistry(stateRoot, registry);
  const datasetDir = join(workRoot, "dataset-d3");
  await writeDataset(datasetDir, 200, rng);
  const tReg = await benchAsync(async () => {
    await loadAdaptationRegistry(stateRoot);
  }, 30);
  const tData = await benchAsync(async () => {
    JSON.parse(await readFile(join(datasetDir, "manifest.json"), "utf8"));
  }, 30);
  console.log(
    `S4-D-3 anchor: T_registry-load=${(tReg * 1e3).toFixed(1)}us T_dataset-read+parse=${(tData * 1e3).toFixed(1)}us -> max overlap gain=min(...)=${(Math.min(tReg, tData) * 1e3).toFixed(1)}us per eval invocation`
  );
}

/* ============================================================
 * S4-D-4: preparePromotion validates the freshly created default approval
 * profile every promote. The default is provably always valid (probe), so
 * the validation is dead work on the default path — but it is fail-closed
 * depth against future default-factory drift, and costs ns.
 * ============================================================ */
{
  let threw = false;
  try {
    validateApprovalProfile(createDefaultApprovalProfile());
  } catch {
    threw = true;
  }
  check("S4-D-4 default profile always validates", !threw);
  const cost = bench(() => {
    validateApprovalProfile(createDefaultApprovalProfile());
  }, 100000);
  const createOnly = bench(() => {
    createDefaultApprovalProfile();
  }, 100000);
  console.log(
    `S4-D-4 anchor: create+validate default profile=${(cost * 1e6).toFixed(1)}ns (create alone=${(createOnly * 1e6).toFixed(1)}ns) per promote invocation`
  );
}

/* ============================================================
 * S4-D-5: assertNoForbiddenFields Object.entries -> Object.keys loop
 * (drops per-node tuple-array allocation). Equivalence incl. first-throw
 * key order; bench on a realistic KB policy.
 * ============================================================ */
{
  const rng = mulberry32(0xd44d05);
  const FORBIDDEN = new Set([
    "permission",
    "credential",
    "secret",
    "token",
    "apikey",
    "password",
    "authorization"
  ]);
  const isRec = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  // Verbatim replica of the current walker.
  function walkCurrent(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) walkCurrent(entry);
      return;
    }
    if (!isRec(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN.has(key.toLowerCase())) {
        throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
      }
      walkCurrent(child);
    }
  }
  // Candidate: keys loop, no tuple allocation.
  function walkKeys(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) walkKeys(entry);
      return;
    }
    if (!isRec(value)) return;
    for (const key of Object.keys(value)) {
      if (FORBIDDEN.has(key.toLowerCase())) {
        throw new DomainValidationError(`routing-policy contains forbidden field ${key}`);
      }
      walkKeys((value as Record<string, unknown>)[key]);
    }
  }
  const FORBIDDEN_VARIANTS = ["Token", "APIKEY", "password", "Authorization", "secret"];
  function genNode(depth: number): unknown {
    const r = rng();
    if (depth > 3 || r < 0.25) return `v${Math.floor(rng() * 100)}`;
    if (r < 0.4) return Array.from({ length: Math.floor(rng() * 4) }, () => genNode(depth + 1));
    const node: Record<string, unknown> = {};
    const fields = 1 + Math.floor(rng() * 5);
    for (let i = 0; i < fields; i += 1) {
      const forbidden = rng() < 0.08;
      const key = forbidden ? pick(rng, FORBIDDEN_VARIANTS) : `k${i}_${Math.floor(rng() * 30)}`;
      node[key] = genNode(depth + 1);
    }
    return node;
  }
  for (let trial = 0; trial < 3000; trial += 1) {
    const doc = genNode(0);
    let aErr: string | undefined;
    let bErr: string | undefined;
    try {
      walkCurrent(doc);
    } catch (error) {
      aErr = (error as Error).message;
    }
    try {
      walkKeys(doc);
    } catch (error) {
      bErr = (error as Error).message;
    }
    check("S4-D-5 equivalence (outcome + first-thrown key)", aErr === bErr, `trial ${trial}: ${aErr} vs ${bErr}`);
  }
  const policy = JSON.parse(
    JSON.stringify({
      primaryModelId: "premium",
      avoid: Array.from({ length: 10 }, (_, i) => ({
        modelId: `m-${i}`,
        family: "edit",
        reason: `deterministic FAIL pattern ${i} observed in replay window`
      })),
      prefer: Array.from({ length: 10 }, (_, i) => ({ family: `fam-${i}`, modelId: `m-${i}` })),
      notes: { source: "auto-loop", window: { from: NOW, to: NOW } }
    })
  ) as unknown;
  const cur = bench(() => walkCurrent(policy), 30000);
  const cand = bench(() => walkKeys(policy), 30000);
  console.log(
    `S4-D-5 bench realistic policy (~${JSON.stringify(policy).length}B, x2 per eval): current=${(cur * 1e6).toFixed(1)}ns keys-loop=${(cand * 1e6).toFixed(1)}ns delta/parse=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

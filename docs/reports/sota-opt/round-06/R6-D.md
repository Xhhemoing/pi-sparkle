MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-D：`src/adaptation/` 第六遍搜查报告（Round 1–5 同区第六遍）

**战役:** 全库持久 SOTA 优化 Round 6 / R6-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `339da37`
**分支:** `cursor/r6-d-adaptation-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D、R3-D、R4-D、R5-D（`fbff2ef`）至本轮基线
（`339da37`）**逐字节未变**（`git diff 82bef36..339da37 -- src/adaptation/`
与 `git diff fbff2ef..339da37 -- src/adaptation/` 均为空），前五轮全部规模
测量、逐文件收口与 S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 /
S5-D-1..5 排除继承有效。本轮按指令先**重测 R5-D 端到端锚点**（§1：
`adapt eval` E=200 全程 4.25–4.29ms/调用（落在 R5-D 4.07–4.39ms 带内）、
registry save+fsync 0.41–0.45ms、load 0.10–0.14ms——ms 级 I/O 地板成立，
本 VM fsync 略快于 R5-D 的 0.57–0.58ms 但同数量级），再换第六组新透镜
全量重读枚举，得到 5 个此前排除表未点名的新候选（S6-D-1 … S6-D-5），
全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz / fail-open 与
身份别名反例 / 真实规模基准，两次独立运行等价/反例结论**逐位一致**）
裁决后淘汰：2 个有确定性反例（S6-D-2 崩溃恢复后意图碰撞 fail-open、
S6-D-4 身份别名可观察发散），2 个在 ns 噪声带（S6-D-1 ~48ns、S6-D-3
双向抖动符号翻转），1 个是**六遍以来切片内单项最大可寻址份额**
（S6-D-5 rerunHash 序列化 459–468µs = 端到端 10.8–10.9%）但字节即契约、
实现面在切片外且绝对量低于数十~数百 ms 落地线一个量级。未重开任何
X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-A-* / S6-B-* 条目。X2-5 维持
排除未触碰。CAS/权限/凭据/数据面语义零 diff，天然不变。本切片在该人审
门控低频控制面契约下维持 SOTA；4.3ms eval + fsync 地板成立，按验收标准
第 3 条，切片继续收口——唯一具体化的重开阈值是 E 增长 ≥2 个量级
（届时仅 rerunHash 序列化一项即外推 ~45ms，见 §3/§7）。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate，共 3294 行）本轮再次**全量实际读码**，未依赖前五轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表含 S6-A-1..3、S6-B-1..5）/
  round-06/PLAN.md / round-01/R1-D.md / round-02/R2-D.md /
  round-03/R3-D.md / round-04/R4-D.md / round-05/R5-D.md。
- 基线漂移检查：`git diff 82bef36..339da37 -- src/adaptation/` 与
  `git diff fbff2ef..339da37 -- src/adaptation/` 均为空；**切片外调用面
  复核**——`git diff fbff2ef..339da37` 对 `src/cli/adapt.ts`、
  `src/learning/`、`src/experiments/isolation.ts`、`src/routing/assign.ts`、
  `src/domain/` 均为空，唯一变更是 `src/routing/lin-alg.ts`（S5-C 赢家
  落地，`9d5e760`——offline-logit IRLS 路径，不在 adapt-eval 调用链上）；
  grep 复核 monitor / pareto / reflection / mutate / reconstructPromotion /
  retirement 族在 `src/` 生产面仍无调用方（R3-D/R5-D 图景原样成立，
  本轮独立重查）。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5 直接跳过；
  S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 / S5-D-1..5 全部不再
  提案；X1-1/X0-4/X1-2/X0-5/X0-6 全部绕开；禁令点名的双故障 Promise.all /
  投机 I/O / restore 再校验跳过 / 丢 ledger 拷贝换名重提均未发生。本轮
  只探索**未被点名的第六组透镜**：跨界品牌 id 死类型守卫（S6-D-1）、
  生成 id 碰撞守卫（S6-D-2）、被调方不变式守卫信任（S6-D-3）、解析期
  对象驻留/interning（S6-D-4）、序列化份额锚定（S6-D-5）。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`（S1-F/J1/S1-C/S1-I/S2-C/S3-C/S4-C/S4-I/
  S5-C/S5-F 均在切片外或已落地，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升、`adapt auto` 只提案——零 diff，天然满足。
  双 LCB 与双归因不涉及本切片，均未触碰。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、公开签名、数据面契约。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 / R4-D §1 / R5-D §1 的论证：全部生产入口是每进程一次的
CLI/auto-loop（磁盘载入→单次操作→原子保存）；切片内可寻址成本
promote/rollback 路径 <~10µs、eval 路径 <0.5ms，均被固定 ms 级成本支配。
本轮用与 R4-D/R5-D 相同的真实入口端到端方法重测（temp stateRoot + 真实
`saveAdaptationRegistry`/`loadAdaptationRegistry`/`evalRoutingPolicy`，
E=200 数据集，两次独立运行）：

```text
run1: registry load=0.10ms save(+fsync)=0.45ms | adapt-eval end-to-end (E=200)=4.29ms
run2: registry load=0.14ms save(+fsync)=0.41ms | adapt-eval end-to-end (E=200)=4.25ms
```

**R5-D eval 锚点带成立**（4.25–4.29ms vs R5-D 4.07–4.39ms）；save+fsync
0.41–0.45ms 略低于 R5-D 的 0.57–0.58ms（本 VM fsync 更快），仍为 ms 级
I/O 地板，支配方向不变。本轮最强非反例候选（S6-D-5 的 459–468µs）也
只占 eval 固定成本的 ~11%，距数十~数百 ms 落地线仍 ≥2 个量级；其余
候选在 ns 带，距落地线 ≥5 个量级。预算支配论证经第四次独立复核后继续
成立——在「人审门控低频控制面 + E≲10³」契约下，本切片不存在达门槛的
保行为优化空间。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-D-1 | `retire()`/`assertAssignable()` 前置 `isResourceVersionId` 类型守卫消除（regex-fail 分支与 map-miss 分支抛**逐字节相同**的 `unknown version: ...`；versionsById 全部插入路径（registerBaseline/beginPromotion 经 createResourceVersionId、restore 经 isResourceVersionId）都已校验 id，非法串永不可能是键 → 前置守卫行为学死） | 免 1 次正则测试/调用 | ✅ 2000 fuzz（已知 id / 合法未知 id / 非法串 / 非字符串 123·对象·null·undefined 全混排）retire 与 assertAssignable 的结果+首错消息与去守卫复刻逐位一致 | 守卫单次 **48.3–49.0ns**；retire/assertAssignable 各只跑一次，且两者在 `src/` **无生产调用方**（仅 retirement.ts 薄委托） | 淘汰：ns 级 + 品牌类型运行时边界是 fail-closed 纵深（未来变异路径若引入坏键则守卫先失败而非静默 miss；S2-D-2/S4-D-4 同族安全侧保留） |
| S6-D-2 | `beginPromotion` 重复意图守卫 `pendingByIntent.has(intentId)` 消除（默认 UUID 生成器下碰撞概率密码学可忽略，看似「实际死」） | 免 1 次 Map.has/begin | ❌ **fail-open 反例**（确定性，全公开 API）：`generateId` 是公开注入点；崩溃恢复（snapshot→fromSnapshot）后注入的生成器再产出与幸存 in-flight pendingVersion 相同的后缀 → 现行抛 `duplicate promotion intent: int_x0004`；去守卫变体 Map.set **静默顶掉**恢复的 in-flight 晋升并覆盖 pending 版本行 → 对恢复意图的 commit 会晋升**错误的候选** | 守卫单次 **11.4–15.6ns** | 淘汰：一般化不等价（两阶段 CAS 崩溃恢复语义的 fail-closed 本体，S4-G-2 同性质非法收益）；收益亦 ns 级 |
| S6-D-3 | `replayAssignments` 尾 map 内逐 episode undefined-assignment 守卫消除（`assignTasks` 结构性保长：`input.tasks.map(...)`，守卫对现被调方不可达） | 免 2E 次 undefined 比较/eval | ✅ 不变式 300 fuzz（含 E=200）：assignTasks 输出恒等长且无洞；守卫/去守卫复刻 actions 字节逐位一致 | E=200 delta 两次运行 **+83.9ns / −1485.2ns**——**符号翻转，纯抖动**（去守卫在 run2 反而更慢；S4-D-1 同境地）；漂移探针：截断输入下守卫抛具名 `missing assignment for eh_cx_2`，去守卫抛裸 `TypeError: Cannot read properties of undefined` | 淘汰：实测零收益（V8 已优化）+ 跨模块 fail-closed 纵深（被调方契约漂移时 first-fault 具名错误 vs 裸 TypeError；S2-D-2 族安全侧保留） |
| S6-D-4 | `parseRegistrySnapshot` 解析期 identity 对象驻留（按 `resourceIdentityKey` intern，V+C 行共享一个 identity 对象） | 免 (V+C−1) 次小对象分配/载入 | ❌ **双反例**（确定性）：(a) 对象身份 `===` 经公开面可观察——现行分别解析的 version/candidate identity 互不相同，驻留变体恒相同（S1-A-7 族身份改变）；(b) identity 未冻结，驻留后调用方变异一处 `name` 传播到全部行，现行相互隔离（S1-G-9 族共享可变危险） | 单次 identity 解析 **12.2–12.9ns**；V=6,C=8 单一身份下可去重份额 **158.6–167.2ns/载入** | 淘汰：不等价（身份+别名双反例）+ ns 级 |
| S6-D-5 | eval 路径 rerunHash 序列化份额（`stableStringify({datasetId,cache,actions})` + `hash32(str)`——六遍以来切片内单项最大可寻址成本，前五轮从未单独锚定） | 若能更快产出**同字节**可省最大单项 | —（上界锚定：字节即 rerunHash 契约，任何优化必须逐字节同值） | E=200：stableStringify **302.0–312.1µs** + hash32 **155.8–157.2µs** = **459.3–468.0µs = 端到端 10.8–10.9%**；E=2×10⁴ 外推实测 **44.7–44.9ms** | 淘汰：绝对量低于数十~数百 ms 落地线 1 个量级（S3-D-3 351–388µs 同量级已否决）；`stableStringify` 在 `src/experiments/manifest.ts`（**切片外**，字节稳定契约函数），切片内复制序列化器 = X1-2 平行实现 + S5-H-3 同族（复制集中化哈希/序列化）；每 `adapt eval` CLI 进程一次。E ≥2 个量级时单项即达落地线——并入 §7 重开条件 |

## 3. 关键裁决细节

### S6-D-2：「密码学上死」≠ 死（崩溃恢复 + 公开注入点的碰撞反例）

`beginPromotion` 的 `pendingByIntent.has(intentId)` 在默认 `randomUUID`
生成器下确实几乎不可能命中，第六遍的新透镜是问它是否**可证死**。答案是
否：`generateId` 是 `RegistryOptions` 的公开注入点，且两阶段 CAS 的
crash 语义使 pendingByIntent 能跨进程幸存。构造（全公开 API）：

```text
A = new ResourceRegistry({generateId: sequential("x")})
A.registerBaseline(...)            -> rsv_x0001
c1, c2 = A.createCandidate(...)    -> cnd_x0002, cnd_x0003
A.beginPromotion(c1)               -> pendingVersion rsv_x0004, intent int_x0004
crash; B = fromSnapshot(snap, {generateId: () => "x0004"})
B.beginPromotion(c2)               -> 现行: throw "duplicate promotion intent: int_x0004"
                                      去守卫: pendingByIntent.set 顶掉 c1 的恢复意图,
                                      versionsById 的 rsv_x0004 行被 c2 内容覆盖
```

去守卫变体下，对恢复意图 `int_x0004` 的 `commitPromotion` 会把 **c2**
的内容晋升到 c1 的意图上——in-flight 晋升被静默替换，属 fail-open
（S4-G-2「写侧校验全跳过」同性质非法收益）。该守卫是两阶段 CAS 崩溃
恢复契约的 fail-closed 本体，不是可省的重复检查。叠加 ~12–16ns 的收益
规模，两条理由各自独立充分，淘汰。

### S6-D-5：六遍以来最大的单项份额为何仍不落地

前五轮把 eval 路径的可寻址成本逐项锚定（guard 构建 ~0.37ms=S3-D-3、
assignTasks×2 ~0.75ms=S2-D-4 域、双 parseTaskId ~16.5µs=S2-D-3、
迭代器分配 ~0.6µs=S5-D-2……），但 `rerunHash` 的
`stableStringify(payload) + hash32(str)` 从未被单独测量。本轮实测
E=200 时共 459–468µs——**占端到端 10.8–10.9%，是六遍以来切片内单项
最大可寻址份额**（超过 S3-D-3 的 351–388µs）。仍淘汰的三条独立理由：

1. **字节即契约**：rerunHash 是复评稳定性哈希，任何「更快」实现必须
   逐字节产出相同序列化（键排序递归稳定）。`stableStringify` 住在
   `src/experiments/manifest.ts`——切片外的集中化契约函数，本切片
   只允许动 `src/adaptation/`；在切片内复制一份序列化器 = X1-2 平行
   实现 + S5-H-3（复制集中化哈希）同族排除。
2. **量级**：0.46ms 一次性 CLI 调用收益低于数十~数百 ms 落地线一个
   量级；战役已在同量级否决过 S3-D-3（351–388µs）、S1-I-1（190µs）。
3. **无复杂度类下降**：序列化 O(E) 固有（R1-D 已判），可省的只是
   常数因子。

价值在于把整片重开条件**具体化**：E 增长 2 个量级（E~2×10⁴）时仅此
一项实测外推 44.7–44.9ms，即单项达落地线——见 §7。

### S6-D-1 / S6-D-3：两类「可证死守卫」的第六遍统一裁决

S6-D-1（品牌 id 前置正则）与 S6-D-3（被调方保长不变式守卫）都通过了
完整等价性仿真（含非字符串输入与错误消息逐字节比对），是真正行为学
死的检查。但两者的删除收益分别是 ~48ns/调用（且 retire/assertAssignable
无生产调用方）与符号翻转的纯抖动（run1 +84ns、run2 −1485ns——V8 对
每迭代两次 `=== undefined` 的成本近零，S4-D-1 反向教训重现）；而两者
的保留价值同族：S6-D-1 是品牌类型的运行时边界（未来变异路径引入坏键
时 fail-closed），S6-D-3 是跨模块契约漂移的 first-fault 质量（具名
DomainValidationError vs 裸 TypeError——漂移探针实测确认）。与
S2-D-2/S4-D-4/preparePromotion 第二次 review 检查的历轮裁决完全同向：
防御纵深不是冗余。淘汰。

## 4. 逐文件收口（第六遍新检查点，叠加 R1-D..R5-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S6-D-1/2；`snapshot()` 的 contents 映射 `entries()→{hash,content}` 落在 S5-D-3 上界锚点内（snapshot 全函数 ~450ns）；`restore()` 的 `ledgerEntries.push(...snapshot.ledger)` 单次展开已最优；`candidatesFor`/`preparePromotion` 的 `Array.from` = S1-D-5 维持 | 无候选落地 |
| `promotion.ts` | 见 S6-D-4（parseIdentity 驻留反例）；`parseRegistrySnapshot` 各解析器单遍无重复；`saveAdaptationRegistry` 美化 stringify + snapshot 中间对象 = S5-D-3/S4-G-6 域维持；`loadAdaptationRegistryOrNew` 错误消息 regex 在 X0-5 域 | 无候选落地 |
| `promotion-rules.ts` | 第六遍无新角度：`intentIdFor` 的 slice+模板 O(1)；`assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed（R1-D 判，X1-1 域）；provisional 双条件顺序是规格语义 | 无候选 |
| `candidate.ts` | `assertAcyclicLineage` visited Set 已最优；`candidateError` 顺序短路即错误契约；`HASH_PATTERN` 已模块级 | 无候选 |
| `eval-routing.ts` | 见 S6-D-3/5；报告写盘 `JSON.stringify(report,null,2)` 为数据面字节（S4-G-6 族，不改紧凑）；`catalogFromPrimary` 每 eval 一次 O(M=2) 常数；episodes 四遍融合 = X3-2 族维持（R3-D 判）；S1-D-4/9、S2-D-3/4、S3-D-3、S4-D-3/5、S5-D-2/4 全部维持不重开 | 无候选落地 |
| `pareto.ts` | 第六遍无新角度（S1-D-6/S3-D-2 维持；无生产调用方，grep 本轮复核） | 无候选 |
| `rollback.ts` | S3-D-4/S4-D-2 维持；`copyRollbackLedgerEntry` 双用处（parse 内 + restore）各自契约载体；`validateIdentity` 常数遍 | 无候选 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 三个薄委托（本轮 grep 复核仍无生产调用方）/ 三个 O(1) 纯函数——第六遍无新角度；S5-D-5（rollback key CSE）维持 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；S2-D-5/S3-D-5 维持；`restore()` 先全量 copy 后替换的次序 = fail-closed（R4-D 判）；无生产调用方（grep 本轮复核） | 无候选 |
| `approval-profile.ts` | S4-D-4 维持；`isAutoAdaptEnabled` 每次读 env 是 kill-switch 语义（X1-1 域 + 行为变更）；`validateApprovalProfile` 交叉 includes 表长 ≤10 = S1-D-8 域 | 无候选 |
| `reflection.ts` | 生产无调用方（grep 本轮复核）；`partitionEvidence` Set 单遍 + cap 早退维持 R1-D 收口；`isSelfSupported` unique 上界 evaluator 个位 | 无候选 |
| `mutate.ts` | `adjustParameter` 两遍正则维持「记录不改」；`replaceSection` 三段 slice+join 一次性变异 KB 级常数；每次新建正则是 X0-6 安全侧 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22.14.0，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd66d01`–`0xd66d05`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 budget anchors: registry load=0.10–0.14ms save(+fsync)=0.41–0.45ms | adapt-eval end-to-end (E=200)=4.25–4.29ms per invocation
S6-D-1 anchor: leading isResourceVersionId guard = 48.3–49.0ns per call (retire/assertAssignable each run it once; no production caller of either)
S6-D-2 counterexample: current -> "duplicate promotion intent: int_x0004" | trusting variant silently replaces restored pending cnd_x0002 with cnd_x0003 and overwrites the pending version row -> fail-open (commit of the restored intent would promote the wrong candidate)
S6-D-2 anchor: one pendingByIntent.has = 11.4–15.6ns per beginPromotion
S6-D-3 drift probe (truncated assignments): guarded -> "missing assignment for eh_cx_2" | unguarded -> "Cannot read properties of undefined (reading 'analysis')"
S6-D-3 bench E=200: delta/eval-invocation=+83.9ns / -1485.2ns (两次运行，符号翻转=抖动)
S6-D-4 counterexample: current identity objects distinct=true | interned variant aliases them (===) and propagates mutation across rows -> observable identity/alias divergence (S1-A-7/S1-G-9 family)
S6-D-4 anchor: one identity parse=12.2–12.9ns -> dedupable share at V=6,C=8 = 158.6–167.2ns per registry load
S6-D-5 anchor E=200: stableStringify=302.0–312.1us hash32=155.8–157.2us -> rerunHash serialization=459.3–468.0us = 10.8–10.9% of end-to-end eval
S6-D-5 anchor E=20000: rerunHash serialization=44727.7–44938.5us
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-D-1 | `retire()`/`assertAssignable()` 前置 `isResourceVersionId` 守卫消除 | 等价可证（2000 fuzz 含非字符串，消息逐字节同），但 ~48ns/调用、无生产调用方；品牌类型运行时边界 = fail-closed 纵深（S2-D-2/S4-D-4 族安全侧保留） |
| S6-D-2 | `beginPromotion` 重复意图守卫 `pendingByIntent.has` 消除 | fail-open 反例（公开 generateId 注入 + 崩溃恢复后意图碰撞：恢复的 in-flight 晋升被静默替换、pending 版本行被覆盖、commit 晋升错误候选）；两阶段 CAS 崩溃恢复契约本体；~12–16ns |
| S6-D-3 | `replayAssignments` 逐 episode undefined-assignment 守卫消除 | 对现被调方等价可证（assignTasks 结构性保长），但两次基准 delta 符号翻转、纯抖动零收益（S4-D-1 同列反向教训）；跨模块契约漂移时 first-fault 具名错误退化为裸 TypeError |
| S6-D-4 | `parseRegistrySnapshot` 解析期 identity 对象驻留（intern） | 不等价：对象身份 `===` 经公开面可观察改变（S1-A-7 族）+ 未冻结对象共享变异跨行传播（S1-G-9 族）；可去重份额 ~160ns/载入 |
| S6-D-5 | eval `rerunHash` 序列化换更快同字节实现（stableStringify+hash32 份额） | E=200 实测 459–468µs（端到端 ~11%，六遍单项最大）仍低于落地线 1 个量级；字节即 rerunHash 契约且 `stableStringify` 在切片外（X1-2 平行实现 / S5-H-3 复制集中化序列化同族）；O(E) 固有无复杂度类下降 |

重开条件：S6-D-5 若 (a) eval 数据集 E 增长 ≥2 个量级（E~2×10⁴ 时本报告
实测外推 44.7–44.9ms，单项达落地线），且 (b) 战役裁定可在
`src/experiments/manifest.ts` 层面优化 `stableStringify`（切片外决策）
或裁定 rerunHash 序列化可在切片内特化——(a) 必须满足，(b) 居其一；
S6-D-1/3 需先推翻防御纵深裁决（安全边界决策，非性能问题）且各自数据
结构/调用频率增长 ≥3 个量级；S6-D-2/4 需先推翻各自反例（即先改
generateId 注入语义/两阶段崩溃恢复契约，或冻结并承诺 identity 不可变
——均属行为变更）。整片层面：唯一可能改变预算论证的仍是 E 增长
≥2 个量级（继承 R3-D §6 / R4-D §7 / R5-D §7，S6-D-5 首次给出该阈值下
的单项实测外推）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts`（或仓库根目录内任意 `.ts`）后
`npx tsx <file>`（依赖已装）。seeds：`0xd66d01`–`0xd66d05`。

```ts
/**
 * R6-D deterministic equivalence + benchmark simulation (sixth pass).
 * Adjudicates fresh candidates S6-D-1 .. S6-D-5 against the current
 * implementations in src/adaptation/, and re-verifies the R3-D/R4-D/R5-D
 * whole-slice budget-domination argument with end-to-end anchors.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd66d01 - 0xd66d05.
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
  type PromoteInput,
  type PendingPromotion,
  type ResourceRegistrySnapshot
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy } from "/workspace/src/adaptation/eval-routing.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "/workspace/src/adaptation/resource.js";
import { resourceIdentityKey } from "/workspace/src/adaptation/active-pointer.js";
import {
  createProjectId,
  isResourceVersionId,
  parseTaskId,
  type IdGenerator,
  type ResourceVersionId
} from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import { stableStringify } from "/workspace/src/experiments/manifest.js";
import { assignTasks, type TaskAssignment } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary, DEFAULT_PRIMARY_MODEL_ID } from "/workspace/src/routing/primary-catalog.js";
import type { ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
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

async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T10:00:00.000Z" as IsoTimestamp;
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

function buildRoutingRegistry(tag: string): { registry: ResourceRegistry; candidateId: string } {
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
  const manifest = { datasetId: "ds-r6d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* ============================================================
 * Section 0: whole-slice budget re-verification (R4-D/R5-D S0 recheck).
 * End-to-end anchors: registry load / save(+fsync) / adapt-eval E=200.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r6d-sim-"));
let evalMsAnchor = 0;
{
  const rng = mulberry32(0xd66d01);
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

  const { registry: r2, candidateId } = buildRoutingRegistry("b1");
  await saveAdaptationRegistry(stateRoot, r2);
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  }, 20);
  evalMsAnchor = evalMs;
  console.log(
    `S0 budget anchors: registry load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * S6-D-1: retire()/assertAssignable() leading isResourceVersionId
 * type-guard elimination. Both the regex-fail branch and the map-miss
 * branch throw the byte-identical `unknown version: ...` message, and
 * every versionsById insertion path validates ids, so a non-conforming
 * value can never be a key -> the pre-guard is behaviorally dead.
 * Equivalence fuzz (any runtime input incl. non-strings) + ns anchor.
 * ============================================================ */
{
  const rng = mulberry32(0xd66d02);

  // Invariant probe: all version ids reachable through the public surface
  // are valid branded ids, across every insertion path (registerBaseline,
  // beginPromotion via promote, restore round-trip).
  const probe = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1p") });
  const probeIdentity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d1proj") }
  };
  const probeBaseline = probe.registerBaseline({ identity: probeIdentity, content: "v1", author: HUMAN });
  const probeCand = probe.createCandidate({
    identity: probeIdentity,
    content: "v2",
    parentVersionId: probeBaseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  promoteWithRegistry(probe, {
    candidateId: probeCand.candidateId,
    expectedCurrentVersionId: probeBaseline.versionId,
    content: "v2",
    approvedBy: HUMAN,
    review: {
      reviewId: "rv-d1",
      candidateId: probeCand.candidateId,
      contentHash: probeCand.contentHash,
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
      rollbackVersionId: probeBaseline.versionId
    },
    explicitApproval: true
  });
  const restored = ResourceRegistry.fromSnapshot(
    parseRegistrySnapshot(JSON.parse(JSON.stringify(probe.snapshot()))),
    { now: () => NOW, generateId: sequentialIds("z") }
  );
  for (const reg of [probe, restored]) {
    for (const version of reg.versionsFor(probeIdentity)) {
      check("S6-D-1 invariant: every stored versionId is a valid branded id", isResourceVersionId(version.versionId));
    }
  }

  // No-pre-guard replica decisions (verbatim logic minus the regex guard),
  // computed over the registry's public surface.
  const retireNoGuardDecision = (reg: ResourceRegistry, id: unknown): string => {
    const version = reg.getVersion(id as ResourceVersionId);
    if (version === undefined) return `unknown version: ${String(id)}`;
    const active = reg.getActiveVersion(version.identity);
    if (active?.versionId === (id as ResourceVersionId)) {
      return `cannot retire the current active version ${String(id)}`;
    }
    return "<ok>";
  };
  const assertAssignableNoGuardDecision = (reg: ResourceRegistry, id: unknown): string => {
    const version = reg.getVersion(id as ResourceVersionId);
    if (version === undefined) return `unknown version: ${String(id)}`;
    if (reg.isRetired(id as ResourceVersionId)) {
      return `version ${String(id)} is retired and cannot receive new assignments`;
    }
    return "<ok>";
  };
  const capture = (fn: () => void): string => {
    try {
      fn();
      return "<ok>";
    } catch (error) {
      return (error as Error).message;
    }
  };

  for (let trial = 0; trial < 2000; trial += 1) {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(`d1t${trial}x`) });
    const identity: ResourceIdentity = {
      kind: pick(rng, ["prompt", "rubric"] as const),
      name: "main-agent-prompt",
      scope: rng() < 0.5 ? { kind: "user-global" } : { kind: "project", projectId: createProjectId(() => `d1q${trial}`) }
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
    if (rng() < 0.3) registry.retire(baseline.versionId);
    const inputs: unknown[] = [
      baseline.versionId,
      promoted.newVersion?.versionId,
      `rsv_nope${trial}`,
      "bogus",
      "rsv_",
      "rsv_!bad",
      "",
      "RSV_x0001",
      `cnd_${trial}`,
      123,
      { toString: () => "obj" },
      null,
      undefined
    ];
    const input = pick(rng, inputs);
    // Decision replicas are computed BEFORE the mutating real call.
    const retireExpected = retireNoGuardDecision(registry, input);
    const retireActual = capture(() => registry.retire(input as ResourceVersionId));
    check("S6-D-1 retire equivalence (outcome + message)", retireActual === retireExpected, `trial ${trial}: ${retireActual} vs ${retireExpected}`);
    const assignExpected = assertAssignableNoGuardDecision(registry, input);
    const assignActual = capture(() => registry.assertAssignable(input as ResourceVersionId));
    check("S6-D-1 assertAssignable equivalence", assignActual === assignExpected, `trial ${trial}: ${assignActual} vs ${assignExpected}`);
  }

  const ids = ["rsv_d1p0001", "rsv_d1p0002", "rsv_nope1", "bogus-string-not-an-id"];
  const guardCost = bench(() => {
    for (const id of ids) isResourceVersionId(id);
  }, 200000);
  console.log(
    `S6-D-1 anchor: leading isResourceVersionId guard = ${((guardCost / ids.length) * 1e6).toFixed(1)}ns per call (retire/assertAssignable each run it once; no production caller of either)`
  );
}

/* ============================================================
 * S6-D-2: beginPromotion duplicate-intent guard (pendingByIntent.has)
 * elimination. The guard is NOT dead: generateId is a public injection
 * point and crash-restored registries can regenerate a suffix that
 * collides with a restored in-flight pending version. Deterministic
 * fail-open counterexample via the public API + ns anchor.
 * ============================================================ */
{
  const gen = sequentialIds("x");
  const registry = new ResourceRegistry({ now: () => NOW, generateId: gen });
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d2proj") }
  };
  const baseline = registry.registerBaseline({ identity, content: "v1", author: HUMAN }); // rsv_x0001
  const mkReview = (candidateId: string, contentHash: string, n: number) => ({
    reviewId: `rv-d2-${n}`,
    candidateId: candidateId as PromoteInput["candidateId"],
    contentHash,
    verdict: "approved" as const,
    reviewerKind: "independent" as const,
    reviewerId: "critic-gate",
    actorId: HUMAN.identity,
    evidenceRefs: [`review:d2:${n}`]
  });
  const mkNote = () => ({
    scope: "prompt:d2",
    evidence: ["static"],
    guardrails: ["proposal-first"],
    rollbackVersionId: baseline.versionId
  });
  const c1 = registry.createCandidate({
    identity,
    content: "v2-c1",
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  }); // cnd_x0002
  const c2 = registry.createCandidate({
    identity,
    content: "v2-c2",
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  }); // cnd_x0003
  const began = registry.beginPromotion({
    candidateId: c1.candidateId,
    expectedCurrentVersionId: baseline.versionId,
    content: "v2-c1",
    approvedBy: HUMAN,
    review: mkReview(c1.candidateId, c1.contentHash, 1),
    changeNote: mkNote(),
    explicitApproval: true
  }); // pendingVersion rsv_x0004, intent int_x0004
  check("S6-D-2 setup: in-flight intent recorded", began.intentId === "int_x0004", began.intentId);

  // Crash + restore with an injected generator whose next suffix collides
  // with the restored pending version (generateId is a public option).
  const snap = parseRegistrySnapshot(JSON.parse(JSON.stringify(registry.snapshot())));
  const restored = ResourceRegistry.fromSnapshot(snap, { now: () => NOW, generateId: () => "x0004" });
  let currentMsg = "<no error>";
  try {
    restored.beginPromotion({
      candidateId: c2.candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: "v2-c2",
      approvedBy: HUMAN,
      review: mkReview(c2.candidateId, c2.contentHash, 2),
      changeNote: mkNote(),
      explicitApproval: true
    });
  } catch (error) {
    currentMsg = (error as Error).message;
  }
  check(
    "S6-D-2 counterexample: current guard fails closed on the intent collision",
    currentMsg === "duplicate promotion intent: int_x0004",
    currentMsg
  );

  // Trusting variant replica (guard removed): Map.set silently overwrites
  // the crash-restored in-flight promotion and the pending version row.
  const pendingByIntent = new Map<string, PendingPromotion>(snap.pending.map((p) => [p.intentId, p]));
  const beforeOverwrite = pendingByIntent.get("int_x0004") as PendingPromotion;
  const versionsById = new Map<string, ResourceVersion>(snap.versions.map((v) => [v.versionId as string, v]));
  const c1PendingRow = versionsById.get("rsv_x0004") as ResourceVersion;
  const trustingPending: PendingPromotion = {
    intentId: "int_x0004",
    candidateId: c2.candidateId,
    expectedCurrentVersionId: baseline.versionId,
    pendingVersionId: "rsv_x0004" as ResourceVersionId,
    approvedBy: HUMAN,
    review: mkReview(c2.candidateId, c2.contentHash, 2),
    changeNote: mkNote(),
    usedAutoPromote: false
  };
  pendingByIntent.set("int_x0004", trustingPending);
  versionsById.set("rsv_x0004", { ...c1PendingRow, contentHash: c2.contentHash });
  const overwritten = pendingByIntent.get("int_x0004") as PendingPromotion;
  const rowAfter = versionsById.get("rsv_x0004") as ResourceVersion;
  const silentlyReplaced =
    beforeOverwrite.candidateId === c1.candidateId &&
    overwritten.candidateId === c2.candidateId &&
    rowAfter.contentHash !== c1PendingRow.contentHash;
  check("S6-D-2 counterexample: trusting variant silently replaces the restored in-flight promotion", silentlyReplaced);
  console.log(
    `S6-D-2 counterexample: current -> "${currentMsg}" | trusting variant silently replaces restored pending ${beforeOverwrite.candidateId} with ${overwritten.candidateId} and overwrites the pending version row -> fail-open (commit of the restored intent would promote the wrong candidate)`
  );

  const map = new Map<string, number>();
  for (let i = 0; i < 4; i += 1) map.set(`int_k${i}`, i);
  const hasCost = bench(() => map.has("int_k2"), 200000);
  console.log(
    `S6-D-2 anchor: one pendingByIntent.has = ${(hasCost * 1e6).toFixed(1)}ns per beginPromotion (upper bound of any gain)`
  );
}

/* ============================================================
 * S6-D-3: replayAssignments per-episode undefined-assignment guard
 * elimination. assignTasks is structurally length-preserving
 * (tasks.map), so the guard never fires against the current callee —
 * invariant fuzz + equivalence + ns anchor. It remains cross-module
 * fail-closed depth against future assignTasks contract drift.
 * ============================================================ */
{
  const rng = mulberry32(0xd66d03);
  const catalog: ModelRouterConfig = catalogFromPrimary({ primaryModelId: DEFAULT_PRIMARY_MODEL_ID });
  const roles: readonly AgentRole[] = ["executor", "tester", "reviewer", "planner", "scout"];

  interface Ep {
    readonly episodeHash: string;
    readonly taskFamily?: string | undefined;
    readonly taskSuccess?: "PASS" | "FAIL" | undefined;
  }
  interface Action {
    readonly episodeHash: string;
    readonly taskFamily: string;
    readonly taskSuccess: "PASS" | "FAIL" | "UNOBSERVED";
    readonly baselineModel: string;
    readonly candidateModel: string;
    readonly baselineCostUsd: number;
    readonly candidateCostUsd: number;
  }
  function catalogCostL(cfg: ModelRouterConfig, modelId: string): number {
    const model = cfg.models.find((entry) => entry.id === modelId);
    if (model === undefined) {
      throw new DomainValidationError(`selected model ${modelId} is not in the catalog`);
    }
    return model.estimatedCostUsd;
  }
  // Verbatim replica of the final episodes.map in replayAssignments.
  function finalizeCurrent(
    episodes: readonly Ep[],
    baseline: readonly TaskAssignment[],
    candidate: readonly TaskAssignment[]
  ): Action[] {
    return episodes.map((episode, index) => {
      const baselineAssignment = baseline[index];
      const candidateAssignment = candidate[index];
      if (baselineAssignment === undefined || candidateAssignment === undefined) {
        throw new DomainValidationError(`missing assignment for ${episode.episodeHash}`);
      }
      return {
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? baselineAssignment.analysis.family,
        taskSuccess: episode.taskSuccess ?? "UNOBSERVED",
        baselineModel: baselineAssignment.decision.model,
        candidateModel: candidateAssignment.decision.model,
        baselineCostUsd: catalogCostL(catalog, baselineAssignment.decision.model),
        candidateCostUsd: catalogCostL(catalog, candidateAssignment.decision.model)
      };
    });
  }
  // Candidate: guard removed (trusts the assignTasks length invariant).
  function finalizeNoGuard(
    episodes: readonly Ep[],
    baseline: readonly TaskAssignment[],
    candidate: readonly TaskAssignment[]
  ): Action[] {
    return episodes.map((episode, index) => {
      const baselineAssignment = baseline[index] as TaskAssignment;
      const candidateAssignment = candidate[index] as TaskAssignment;
      return {
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? baselineAssignment.analysis.family,
        taskSuccess: episode.taskSuccess ?? "UNOBSERVED",
        baselineModel: baselineAssignment.decision.model,
        candidateModel: candidateAssignment.decision.model,
        baselineCostUsd: catalogCostL(catalog, baselineAssignment.decision.model),
        candidateCostUsd: catalogCostL(catalog, candidateAssignment.decision.model)
      };
    });
  }

  for (let trial = 0; trial < 300; trial += 1) {
    const n = trial === 0 ? 200 : Math.floor(rng() * 24);
    const tasks = Array.from({ length: n }, (_, i) => ({
      taskId: parseTaskId(`tsk_d3_${trial}_${i}`),
      role: pick(rng, roles),
      objective: pick(rng, OBJECTIVES)
    }));
    const baseline = assignTasks({ catalog, tasks });
    const candidate = assignTasks({ catalog, tasks });
    check("S6-D-3 invariant: assignTasks preserves length", baseline.length === tasks.length && candidate.length === tasks.length, `trial ${trial}`);
    check(
      "S6-D-3 invariant: no holes in assignTasks output",
      baseline.every((a) => a !== undefined) && candidate.every((a) => a !== undefined),
      `trial ${trial}`
    );
    const episodes: Ep[] = tasks.map((_, i) => ({
      episodeHash: `eh_${trial}_${i}`,
      ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test"]) } : {}),
      ...(rng() < 0.7 ? { taskSuccess: rng() < 0.5 ? ("PASS" as const) : ("FAIL" as const) } : {})
    }));
    check(
      "S6-D-3 equivalence (actions bytes)",
      JSON.stringify(finalizeCurrent(episodes, baseline, candidate)) === JSON.stringify(finalizeNoGuard(episodes, baseline, candidate)),
      `trial ${trial}`
    );
  }

  // The guard's role exists only on contract-drift inputs (replica level;
  // the real assignTasks cannot produce them): truncated arrays.
  {
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      taskId: parseTaskId(`tsk_d3_cx_${i}`),
      role: roles[0] as AgentRole,
      objective: OBJECTIVES[0] as string
    }));
    const full = assignTasks({ catalog, tasks });
    const truncated = full.slice(0, 2);
    const episodes: Ep[] = tasks.map((_, i) => ({ episodeHash: `eh_cx_${i}` }));
    let guardMsg = "<no error>";
    try {
      finalizeCurrent(episodes, truncated, full);
    } catch (error) {
      guardMsg = (error as Error).message;
    }
    let noGuardMsg = "<no error>";
    try {
      finalizeNoGuard(episodes, truncated, full);
    } catch (error) {
      noGuardMsg = (error as Error).message;
    }
    console.log(
      `S6-D-3 drift probe (truncated assignments): guarded -> "${guardMsg}" | unguarded -> "${noGuardMsg}" (first-fault quality lost on contract drift)`
    );
  }

  const E = 200;
  const tasks = Array.from({ length: E }, (_, i) => ({
    taskId: parseTaskId(`tsk_d3_b${i}`),
    role: pick(rng, roles),
    objective: pick(rng, OBJECTIVES)
  }));
  const baseline = assignTasks({ catalog, tasks });
  const candidate = assignTasks({ catalog, tasks });
  const episodes: Ep[] = tasks.map((_, i) => ({
    episodeHash: `eh_b${i}`,
    ...(i % 2 === 0 ? { taskFamily: "edit" } : {}),
    ...(i % 10 < 7 ? { taskSuccess: i % 2 === 0 ? ("PASS" as const) : ("FAIL" as const) } : {})
  }));
  const cur = bench(() => finalizeCurrent(episodes, baseline, candidate), 5000);
  const cand = bench(() => finalizeNoGuard(episodes, baseline, candidate), 5000);
  console.log(
    `S6-D-3 bench E=${E}: guarded=${(cur * 1e6).toFixed(1)}ns unguarded=${(cand * 1e6).toFixed(1)}ns delta/eval-invocation=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * S6-D-4: parse-time identity interning in parseRegistrySnapshot
 * (dedupe identical {kind,name,scope} objects across versions and
 * candidates). Counterexamples: object-identity observable via ===
 * through the public surface, and shared-mutation propagation
 * (identities are not frozen). Anchor: dedupable parse cost is ns.
 * ============================================================ */
{
  const { registry } = buildRoutingRegistry("d4");
  const identity = registry.versionsFor({
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => "d4proj") }
  })[0]?.identity as ResourceIdentity;
  const raw = JSON.parse(JSON.stringify(registry.snapshot())) as unknown;
  const parsed = parseRegistrySnapshot(raw);
  const v0 = parsed.versions[0] as ResourceVersion;
  const cand0 = parsed.candidates[0];
  check("S6-D-4 setup: same identity by value", resourceIdentityKey(v0.identity) === resourceIdentityKey((cand0 as { identity: ResourceIdentity }).identity));
  const currentDistinct = v0.identity !== (cand0 as { identity: ResourceIdentity }).identity;
  check("S6-D-4 current: separately parsed identities are distinct objects", currentDistinct);

  // Interned replica of parseIdentity (verbatim checks + intern map).
  const intern = new Map<string, ResourceIdentity>();
  const parseIdentityInterned = (value: ResourceIdentity): ResourceIdentity => {
    const key = resourceIdentityKey(value);
    const existing = intern.get(key);
    if (existing !== undefined) return existing;
    const fresh: ResourceIdentity = {
      kind: value.kind,
      name: value.name,
      scope: value.scope.kind === "project" ? { kind: "project", projectId: value.scope.projectId } : { kind: "user-global" }
    };
    intern.set(key, fresh);
    return fresh;
  };
  const rawObj = raw as { versions: { identity: ResourceIdentity }[]; candidates: { identity: ResourceIdentity }[] };
  const internedV0 = parseIdentityInterned(rawObj.versions[0]?.identity as ResourceIdentity);
  const internedC0 = parseIdentityInterned(rawObj.candidates[0]?.identity as ResourceIdentity);
  check("S6-D-4 counterexample: interned variant makes identities the SAME object (=== observable)", internedV0 === internedC0);

  // Shared-mutation propagation: identities are plain, non-frozen objects.
  (internedV0 as { name: string }).name = "mutated-after-load";
  const internedLeaks = (internedC0 as { name: string }).name === "mutated-after-load";
  const parsedV0Name = (v0.identity as { name: string }).name;
  (v0.identity as { name: string }).name = "mutated-after-load";
  const currentIsolated = ((cand0 as { identity: ResourceIdentity }).identity as { name: string }).name !== "mutated-after-load";
  (v0.identity as { name: string }).name = parsedV0Name;
  check("S6-D-4 counterexample: interning propagates caller mutation across rows; current isolates", internedLeaks && currentIsolated);
  console.log(
    `S6-D-4 counterexample: current identity objects distinct=${currentDistinct} | interned variant aliases them (===) and propagates mutation across rows -> observable identity/alias divergence (S1-A-7/S1-G-9 family)`
  );

  // Anchor: the dedupable work at realistic scale is (V+C-1) identity
  // parses; verbatim replica of parseIdentity cost.
  const parseIdentityReplica = (value: ResourceIdentity): ResourceIdentity => ({
    kind: value.kind,
    name: value.name,
    scope: value.scope.kind === "project" ? { kind: "project", projectId: value.scope.projectId } : { kind: "user-global" }
  });
  const one = rawObj.versions[0]?.identity as ResourceIdentity;
  const perParse = bench(() => parseIdentityReplica(one), 200000);
  const V = 6;
  const C = 8;
  console.log(
    `S6-D-4 anchor: one identity parse=${(perParse * 1e6).toFixed(1)}ns -> dedupable share at V=${V},C=${C} (one shared identity) = ${(((V + C - 1) * perParse) * 1e6).toFixed(1)}ns per registry load`
  );
  void identity;
}

/* ============================================================
 * S6-D-5: rerunHash serialization share. The eval invocation pays one
 * stableStringify over {datasetId, cache, actions} plus one hash32 over
 * the resulting string. The bytes ARE the rerunHash contract; producing
 * them faster needs either changing experiments/manifest.ts (outside
 * this slice) or duplicating serialization in-slice (X1-2/S5-H-3
 * family). Anchor the share at E=200 and the 100x extrapolation.
 * ============================================================ */
{
  const rng = mulberry32(0xd66d05);
  const models = ["premium", "fast"];
  const mkActions = (E: number) =>
    Array.from({ length: E }, (_, i) => ({
      episodeHash: `eh_${i}`,
      taskFamily: pick(rng, ["edit", "test", "review"]),
      taskSuccess: pick(rng, ["PASS", "FAIL", "UNOBSERVED"] as const),
      baselineModel: pick(rng, models),
      candidateModel: pick(rng, models),
      baselineCostUsd: 0.5,
      candidateCostUsd: 0.1 + (i % 3) * 0.2
    }));
  for (const E of [200, 20000]) {
    const payload = {
      datasetId: "ds-r6d",
      cache: {
        candidateHash: "deadbeef",
        environmentVersion: "env-1",
        evaluatorVersion: "routing-eval-v1"
      },
      actions: mkActions(E)
    };
    const strCost = bench(() => stableStringify(payload), E > 1000 ? 50 : 2000);
    const str = stableStringify(payload);
    const hashCost = bench(() => hash32(str), E > 1000 ? 200 : 5000);
    const total = strCost + hashCost;
    const share = E === 200 ? ` = ${((total / evalMsAnchor) * 100).toFixed(1)}% of the ${evalMsAnchor.toFixed(2)}ms end-to-end eval` : "";
    console.log(
      `S6-D-5 anchor E=${E}: stableStringify=${(strCost * 1e3).toFixed(1)}us hash32=${(hashCost * 1e3).toFixed(1)}us -> rerunHash serialization=${(total * 1e3).toFixed(1)}us${share}`
    );
  }
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

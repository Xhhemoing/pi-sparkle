MODEL_SLUG=claude-fable-5-thinking-xhigh

# R7-D：`src/adaptation/` 第七遍搜查报告（Round 1–6 同区第七遍）

**战役:** 全库持久 SOTA 优化 Round 7 / R7-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `447e522`
**分支:** `cursor/r7-d-adaptation-seventh-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D…R6-D（`339da37`）至本轮基线（`447e522`）
**逐字节未变**（`git diff 82bef36..447e522 -- src/adaptation/` 与
`git diff 339da37..447e522 -- src/adaptation/` 均为空），前六轮全部规模
测量、逐文件收口与 S1-D..S6-D 五族排除继承有效。R6-D 后切片外唯一
变更是三个已落地赢家：S6-C（`80d103e`，routing/offline-logit）、
S5-I-1（`3101aee`，cli/main）、S6-F-1（`f7a84fa`，
experiments/{shadow,canary}——本切片 `reflection.evaluateProposalShadow`
的**被调方**），均不在 adapt-eval 调用链上。本轮按指令先**重测端到端
锚点**（§1：`adapt eval` E=200 全程 4.26–4.59ms/调用（R6-D 带 4.25–4.29、
R5-D 4.07–4.39——上沿略宽但同数量级），registry save+fsync 0.62–0.76ms、
load 0.11–0.15ms——ms 级 I/O 地板成立），再**穿过 S6-F-1 改动后的
shadow.ts 重测** `evaluateProposalShadow` 墙钟（§1b：P=200/A=100 →
1.7–1.8ms，P=2000/A=1000 → 186.0–188.3ms，与父代理复测 ≈173ms 同数量级；
逐步 restore 成本在被调方，X4-1/S3-F-2/S2-F-1 辖区），然后换第七组新
透镜全量重读枚举，得到 5 个此前排除表未点名的新候选（S7-D-1 … S7-D-5），
全部经理论 + 确定性仿真（seeded mulberry32，反例构造 / 等价 fuzz /
真实规模基准，两次独立运行等价/反例结论**逐位一致**）裁决后淘汰：
3 个有确定性反例（S7-D-1 legacy 快照修复 + hash32 碰撞双反例、S7-D-3
陈旧临时文件 EEXIST 健壮性回退、S7-D-4 retired-active fail-open），
2 个在噪声带（S7-D-2 实现整体在切片外且 28.7–29.2µs = 端到端 0.62–0.69%、
S7-D-5 可证冗余回退消除仅 ~1.2–1.6µs 且引入跨函数耦合）。S7-D-2 同时
把 eval 端到端分解**收拢闭合**——七遍后 eval 路径每个具名成分都有锚点，
切片内单项最大可寻址份额仍是已排除的 S6-D-5（rerunHash 序列化 ~0.46ms）。
未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-A-* 条目。
X2-5 维持排除未触碰。CAS/权限/凭据/数据面语义零 diff，天然不变。不声称
Outcome-supported；Checkpoint F-PROD 仍开放。本切片在人审门控低频控制面
契约下维持 SOTA；4.3ms eval + fsync 地板第五次独立复核成立，按验收标准
第 3 条，切片继续收口——整片唯一重开阈值仍是 E 增长 ≥2 个量级
（继承 R6-D §7 的单项外推 ~45ms，见 §7）。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate，共 3294 行）本轮再次**全量实际读码**，未依赖前六轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表含 S6-I-1..3、S7-A-1..4）/
  round-07/PLAN.md / round-01/R1-D.md … round-06/R6-D.md。
- 基线漂移检查：`git diff 82bef36..447e522 -- src/adaptation/` 与
  `git diff 339da37..447e522 -- src/adaptation/` 均为空；**切片外调用面
  复核**——`git diff --stat 339da37..447e522 -- src/` 仅 4 文件：
  `src/cli/main.ts`（S5-I-1 点用 import）、`src/experiments/canary.ts` 与
  `src/experiments/shadow.ts`（S6-F-1 restore 成员判断方向反转）、
  `src/routing/offline-logit.ts`（S6-C IRLS 直线化）。eval-routing 的
  全部切片外被调方（comparison-report / gated-comparison / isolation /
  manifest / replay）与 `src/routing/assign.ts`、`src/learning/`、
  `src/domain/` 零变更——adapt-eval 调用链不受影响；`shadow.ts` 是
  `reflection.evaluateProposalShadow` 的被调方（`createShadowRunner`），
  按指令未编辑、只穿透重测（§1b）。grep 复核 monitor / pareto /
  reflection / mutate / reconstructPromotion / retirement 族在 `src/`
  生产面仍无调用方（R3-D/R5-D/R6-D 图景原样成立，本轮独立重查）。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5 直接跳过；
  S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 / S5-D-1..5 /
  S6-D-1..5 全部不再提案；S7-A-1..4 不在本切片但已核对不撞车；
  X0-3 / X0-1 / X1-1 / X1-2 / X0-5 / X0-6 全部绕开；禁令点名的双故障
  Promise.all / 投机 I/O / restore 再校验跳过 / 丢 ledger 拷贝换名重提
  均未发生。本轮只探索**未被点名的第七组透镜**：promote 路径内容重存
  死写消除（S7-D-1）、eval 分解最后一块未测成分锚定（S7-D-2）、原子
  保存临时名生成替换（S7-D-3）、幂等回滚快路径前置（S7-D-4）、跨函数
  数据流可证冗余回退消除（S7-D-5）。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`、S6-C/S6-F-1/S5-I-1（均在切片外，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升、`adapt auto` 只提案——零 diff，天然满足。
  双 LCB 与双归因不涉及本切片，均未触碰。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、公开签名、数据面契约。
  不改测试。无赢家故未新建 `scripts/round07-r7d-equivalence-sim.ts`；
  败者仿真全文留在本报告附录。lint 全绿，无需对任何继承脚本做
  console.* 机械替换。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 / R4-D §1 / R5-D §1 / R6-D §1 的论证：全部生产入口是每进程一次
的 CLI/auto-loop（磁盘载入→单次操作→原子保存）；切片内可寻址成本
promote/rollback 路径 <~10µs、eval 路径 <0.5ms，均被固定 ms 级成本支配。
本轮用与 R4-D..R6-D 相同的真实入口端到端方法重测（temp stateRoot + 真实
`saveAdaptationRegistry`/`loadAdaptationRegistry`/`evalRoutingPolicy`，
E=200 数据集，两次独立运行）：

```text
run1: registry load=0.11ms save(+fsync)=0.62ms | adapt-eval end-to-end (E=200)=4.59ms
run2: registry load=0.15ms save(+fsync)=0.76ms | adapt-eval end-to-end (E=200)=4.26ms
```

**eval 锚点带成立**（4.26–4.59ms，下沿与 R6-D 4.25–4.29ms 重合、上沿
略宽但仍在 R5-D 4.07–4.39ms 同数量级）；save+fsync 0.62–0.76ms 高于
R6-D 的 0.41–0.45ms、接近 R5-D 的 0.57–0.58ms（VM fsync 波动），仍为
ms 级 I/O 地板，支配方向不变。本轮候选中唯一可证等价且非反例的
S7-D-5 收益 ~1.2–1.6µs，距数十~数百 ms 落地线 ≥4 个量级；预算支配
论证经第五次独立复核后继续成立。

### 1b. `evaluateProposalShadow` 穿透 S6-F-1 重测（指令新增项）

S6-F-1 反转了 `experiments/shadow.ts` 的 restore 成员再校验方向——该
文件是本切片 `reflection.evaluateProposalShadow` 的**被调方**
（`createShadowRunner`）。按指令不编辑该文件，只从切片侧穿透重测
post-S6-F-1 的墙钟轮廓：

```text
S0b evaluateProposalShadow: P=200  A=100  -> 1.7–1.8ms per call
S0b evaluateProposalShadow: P=2000 A=1000 -> 186.0–188.3ms per call
```

与父代理复测（P=2000/A=1000 ≈173ms）同数量级（本 VM 略慢）。逐步
population-restore/验证成本全部在被调方 shadow.ts 内（X4-1 / S3-F-2 /
S2-F-1 辖区，且 S6-F-2..5 已排除）；切片内的 `evaluateProposalShadow`
本体只做 plan 校验 + 循环委托 + 状态透传，且在 `src/` 生产面**无调用方**
（grep 本轮复核，测试专用）。切片内无 ms 级可寻址份额，无候选。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S7-D-1 | `preparePromotion` 内 `putContent` 重存消除（「createCandidate 已存过同 hash 内容，promote 再 set 一次是死写」——hash 仍算，仅省 Map.set） | 免 1 次 Map.set/promote | ❌ **双反例**（确定性，全公开 API）：(a) **legacy 快照修复**——`contents` 字段是显式可选（旧格式快照无该字段），从 legacy 快照 restore 后 promote 路径的 putContent 是**唯一**再物化内容的写点：现行 promote 后 `getActiveContent`="v2-content" 且血清后快照携带 blob；消除变体两者皆 undefined/缺失 → fail-closed 可观察发散；(b) **hash32 碰撞**——`hash32("Aa")===hash32("BB")`（同为 `840`），以 "BB" 过全部 hash 等式门后 promote：现行 last-write-wins 存 "BB"，消除变体 first-write-wins 留 "Aa" → 公开面字节发散 | 被消除的工作 = 一次小 Map.set：**10.1–14.4ns**/promote（收益上界） | 淘汰：不等价（修复路径活写 + 碰撞语义翻转双反例）+ ns 级 |
| S7-D-2 | `evalRoutingPolicy` 端到端分解的最后一块未测成分：`gatedComparisonReport`（含配套 `replayCacheKey` / 报告 stringify / 报告写盘尾） | 若可省则是 eval 内最后未锚定项 | —（份额锚定：实现整体在 `src/experiments/{comparison-report,gated-comparison}.ts`，切片外） | N=140（E=200 的 ~70% observed）：**28.7–29.2µs = 端到端 0.62–0.69%**；replayCacheKey 1.25–1.66µs；报告 stringify 4.1–4.3µs；报告写盘（无 fsync）167.9–205.0µs | 淘汰：切片外实现 + 量级低于落地线 ≥3 个量级；价值在**收拢闭合**——eval 分解至此每个具名成分都有锚点（§3） |
| S7-D-3 | `saveAdaptationRegistry` 临时文件名 `randomUUID()` → `pid+进程内计数器`（「UUID 太贵」） | 免 1 次 randomUUID/save | ❌ **健壮性反例**（确定性）：崩溃遗留 + PID 复用场景下，计数器变体首个名字撞上陈旧 `.pid.1.tmp`，`open("wx")` 抛 **EEXIST**、save 中止；现行 UUID 名成功。原子保存的临时名唯一性从「概率上必然」退化为「依赖无陈旧文件」 | randomUUID = **81–90ns**/save = save(+fsync) 地板的 **0.011–0.015%** | 淘汰：健壮性回退（fail-closed 保存契约弱化）+ 收益占比 <0.02% |
| S7-D-4 | `rollback()` 幂等快路径前置（`active===target` 早退，跳过 versionsFor 扫描与 retired 检查） | 幂等路径免扫描 | ❌ **fail-open 反例**（确定性，全公开 API）：`beginPromotion → retire(pendingVersion) → commitPromotion` 使 **retired 版本成为 active 指针**（retire 时 pending 未激活故合法，commit 的 CAS 只对 expectedCurrent 校验）；对其做幂等回滚：现行抛 `version rsv_d4x0003 is retired and cannot receive new assignments`，前置变体静默 `<ok:true>`。非 retired-active 状态 300 fuzz（5 模式）等价逐位一致——发散恰好只在该可达状态 | 幂等路径 delta = **266.5–283.1ns**/次（CAS 路径不变） | 淘汰：变异可达状态上 fail-open（S4-G-2/S6-D-2 同性质非法收益）+ ns 级 |
| S7-D-5 | `pairedRecords` 冗余回退消除：`episode.taskFamily ?? action.taskFamily` → `action.taskFamily`（数据流不变式：`replayAssignments` 定义 `action.taskFamily = episode.taskFamily ?? baseline.analysis.family`，episode 有值时 action 必然携带同值） | 免 E 次 `??` 判断/eval | ✅ 不变式 fuzz（>1000 个 defined-family 探针全过）+ 等价 fuzz 300 试次（含 ~6% 截断 actions 错误路径）记录字节逐位一致 | E=200 delta = **1157.8–1573.8ns**（~1.2–1.6µs）/eval 调用 | 淘汰：µs 级低于落地线 ≥4 个量级；且把局部正确性事实变为对 `replayAssignments` 的**隐式跨函数耦合**（被调方回退语义漂移时静默错 family 而非现行自愈；S6-D-3 防御纵深同族） |

## 3. 关键裁决细节

### S7-D-1：「死写」两条独立活路（legacy 修复 + 碰撞语义）

`preparePromotion` 在校验后执行 `putContent(content)`，而
`createCandidate` 早已按同一 `contentHash` 存过内容——第七遍的新透镜是
问这次重存是否**可证死**。答案是否，且有两条互相独立的活路：

1. **legacy 快照修复路径**。`ResourceRegistrySnapshot.contents` 是显式
   可选字段（旧格式快照没有它，`parseRegistrySnapshot` 显式支持）。从
   legacy 快照 restore 出的 registry 里 `contentsByHash` 是空的——此时
   promote 路径的 putContent 是**唯一**能把批准内容再物化进 registry 的
   写点。仿真（公开 API）：restore 后 `getContent(hash)=undefined`；
   现行 promote 后 `getActiveContent()="v2-content"` 且后续快照携带
   blob；消除变体两者皆 undefined/缺失。激活版本查不到内容属 fail-closed
   合同破坏，可观察。
2. **hash32 碰撞语义**。`hash32` 是 31 乘子非加密哈希，
   `hash32("Aa") === hash32("BB")`（同为 `840`）是确定性碰撞对。以
   candidate 内容 "Aa"、promote 内容 "BB" 走完全部 hash 等式门（全部
   通过——门只比 hash）：现行 putContent 使 `getActiveContent`="BB"
   （last-write-wins，promote 时字节胜出）；消除变体留 "Aa"
   （first-write-wins）。公开面字节发散——即使认为碰撞域「不该发生」，
   变体也**改变了碰撞下的语义**，不是等价变换。

收益上界是一次小 Map.set = 10.1–14.4ns（hash 两个变体都要算）。双反例
+ ns 级，两条理由各自独立充分，淘汰。

### S7-D-2：eval 端到端分解的收拢闭合

前六轮把 eval 路径逐项锚定：assignTasks×2 ~0.75ms（S2-D-4 域）、guard
构建 ~0.37ms（S3-D-3）、rerunHash 序列化 459–468µs（S6-D-5）、registry
load 0.11–0.15ms（S4-D-3 域）、双 parseTaskId ~16.5µs（S2-D-3）、迭代器
分配 ~0.6µs（S5-D-2）——但报告生成尾（gatedComparisonReport →
JSON.stringify → 写盘）从未单独测量。本轮补齐：

```text
gatedComparisonReport (N=140)   28.7–29.2µs   = 端到端 0.62–0.69%
replayCacheKey                  1.25–1.66µs
报告 JSON.stringify(…,null,2)   4.1–4.3µs
报告写盘（writeFile 无 fsync）  167.9–205.0µs
```

至此 eval 调用的每个具名成分都有锚点，剩余未列名部分是数据集
manifest 读取/JSON.parse 与进程级开销——全部为 I/O 或切片外。结论有
两层：(a) `gatedComparisonReport` 本体在
`src/experiments/{comparison-report,gated-comparison}.ts`（切片外，
本切片只有 S1-F 薄包装调用点，无可动空间）；(b) 其份额 0.62–0.69% 距
落地线 ≥3 个量级，即便在 F 切片辖区也远不达门槛。七遍分解闭合后，
切片内单项最大可寻址份额**仍是已排除的 S6-D-5**（rerunHash ~0.46ms，
重开条件 E≥2 个量级不变）。淘汰（份额锚定项，无重提实体）。

### S7-D-4：幂等快路径与 retired-active 可达状态

`rollback()` 的幂等分支（`active === target` 返回 `{ok:true}`）位于
target 存在性/身份/retired 三重检查**之后**。前置它看似纯加速——幂等
回滚语义上「什么都不做」，检查还有必要吗？有：retired 检查对 active
指针本身**不是不变式**。公开 API 序列
`beginPromotion → retire(pendingVersion) → commitPromotion` 构造出
retired 版本占据 active 指针的状态（retire 时 pending 尚未激活故通过
「不能 retire 现役版本」检查；commit 的 CAS 只校验 expectedCurrent 未
漂移，不复查 pending 是否已被 retire）。此状态下对 active 自身的幂等
回滚：现行抛 `version rsv_d4x0003 is retired and cannot receive new
assignments`（fail-closed：拒绝确认一个 retired 版本可继续接收指派）；
前置变体静默 `<ok:true>`（fail-open：调用方拿到「回滚成功」的确认，
实则指针停在 retired 版本上）。300 试次 5 模式 fuzz 证明非
retired-active 状态下两者逐位等价——发散**恰好**只在该变异可达状态，
说明检查次序是契约本体而非冗余（S4-G-2/S6-D-2 同性质）。幂等路径
delta 仅 266.5–283.1ns，两条理由各自独立充分，淘汰。

### S7-D-3 / S7-D-5：健壮性回退与跨函数耦合的统一裁决

S7-D-3（UUID 临时名 → pid+计数器）通过了「正常路径」等价——但原子
保存的临时名契约不止正常路径：崩溃遗留 + PID 复用使计数器变体的首个
名字可与陈旧文件相撞，`open("wx")` 抛 EEXIST、save 中止（现行 UUID 名
成功）。把「密码学上必然唯一」换成「依赖环境无陈旧文件」是健壮性
回退，且收益仅 81–90ns（save 地板的 0.015%）。S7-D-5（`??` 回退消除）
是本轮唯一可证等价且非反例的候选：不变式 fuzz >1000 探针确认
`action.taskFamily` 在 episode 有值时必然同值。但它把 `pairedRecords`
的局部正确性事实变为对 `replayAssignments` 回退定义的隐式跨函数依赖
——被调方语义漂移时现行自愈（episode 值优先），变体静默错 family
（进入按族分层的统计）——且收益 ~1.2–1.6µs 距落地线 ≥4 个量级。与
S2-D-2/S4-D-4/S6-D-1/S6-D-3 历轮裁决完全同向：防御纵深不是冗余。
两者淘汰。

## 4. 逐文件收口（第七遍新检查点，叠加 R1-D..R6-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S7-D-1（preparePromotion putContent 活写证明）与 S7-D-4（rollback 检查次序 = 契约）；`getActiveContent` 两跳查找已最优；S6-D-1/2、S5-D-3、S1-D-5 维持 | 无候选落地 |
| `promotion.ts` | 见 S7-D-3（saveAdaptationRegistry 临时名 UUID = 健壮性本体）；`loadAdaptationRegistry` 读→parse 单遍无冗余；S6-D-4、S5-D-3/S4-G-6 域维持 | 无候选落地 |
| `promotion-rules.ts` | 第七遍无新角度：`intentIdFor` O(1)；`assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed（X1-1 域）；validateChangeNote 顺序即错误契约 | 无候选 |
| `candidate.ts` | `hashCandidateContent` 委托 hash32——S7-D-1(b) 碰撞语义属其辖域但字节契约在 domain/hash.ts（切片外）；`assertAcyclicLineage` visited Set 维持 | 无候选 |
| `eval-routing.ts` | 见 S7-D-2（报告尾成分锚定、分解闭合）与 S7-D-5（`??` 回退 = 数据流自愈）；S6-D-3/5、S1-D-4/9、S2-D-3/4、S3-D-3、S4-D-3/5、S5-D-2/4 全部维持不重开 | 无候选落地 |
| `pareto.ts` | 第七遍无新角度（S1-D-6/S3-D-2 维持；无生产调用方，grep 本轮复核） | 无候选 |
| `rollback.ts` | `validateRollbackInput` 在 S7-D-4 变体中原样保留仍不救 fail-open——发散在 registry 侧检查次序；S3-D-4/S4-D-2 维持 | 无候选 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 薄委托（无生产调用方，本轮复核）/ O(1) 纯函数——第七遍无新角度；S5-D-5 维持 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；S2-D-5/S3-D-5 维持；无生产调用方（grep 本轮复核） | 无候选 |
| `approval-profile.ts` | S4-D-4 维持；`isAutoAdaptEnabled` 每次读 env 是 kill-switch 语义（X1-1 域） | 无候选 |
| `reflection.ts` | §1b：穿透 S6-F-1 后的 shadow.ts 重测 evaluateProposalShadow（1.7–1.8ms / 186.0–188.3ms）；本体只做校验+委托，ms 级成本全在被调方（X4-1/S3-F-2/S2-F-1 辖区）；生产无调用方 | 无候选 |
| `mutate.ts` | `adjustParameter`/`replaceSection` 维持「记录不改」；每次新建正则 = X0-6 安全侧 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下相关套件基线复核，全绿（Node 22，pnpm 10.17.1）：

```bash
npx tsx --test "test/unit/adaptation/**/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 101 / suites 11 / pass 101 / fail 0
pnpm typecheck && pnpm lint && pnpm build   # 全绿
```

仿真（临时脚本，未入库——无赢家不落死代码；完整源码见附录，seeds
`0xd77d01`–`0xd77d05`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 budget anchors: registry load=0.11–0.15ms save(+fsync)=0.62–0.76ms | adapt-eval end-to-end (E=200)=4.26–4.59ms per invocation
S0b evaluateProposalShadow through S6-F-1 shadow.ts: P=200 A=100 -> 1.7–1.8ms | P=2000 A=1000 -> 186.0–188.3ms per call
S7-D-1 counterexample (a): legacy no-contents snapshot -> before promote getContent=undefined | current promote re-stores -> getActiveContent="v2-content" and snapshot.contents has the blob | eliding variant leaves both undefined/absent -> observable fail-closed divergence
S7-D-1 counterexample (b): collision promote accepted (hash 840) -> current getActiveContent="BB" (last write wins) | eliding variant keeps "Aa" (first write wins) -> divergent bytes through the public surface
S7-D-1 anchor: one contentsByHash Map.set = 10.1–14.4ns per promote
S7-D-2 anchor N=140: gatedComparisonReport=28.7–29.2us (0.62–0.69% of end-to-end) | replayCacheKey=1.25–1.66us | report stringify=4.1–4.3us write(no fsync)=167.9–205.0us
S7-D-3 counterexample (stale tmp under recycled pid): current uuid-name save -> <ok> | pid+counter variant -> EEXIST (save aborts where current succeeds)
S7-D-3 anchor: randomUUID()=81–90ns per save = 0.011–0.015% of the save(+fsync) floor
S7-D-4 counterexample (begin -> retire(pending) -> commit): idempotent rollback onto the retired active -> current "version rsv_d4x0003 is retired and cannot receive new assignments" | hoisted fast path "<ok:true>" -> fail-open divergence on a mutation-reachable state
S7-D-4 anchor (idempotent path only): current=593.9–607.5ns hoisted=324.4–327.4ns delta=266.5–283.1ns per idempotent rollback (CAS path unchanged)
S7-D-5 bench E=200: current=3821.4–4185.0ns variant=2611.2–2663.6ns delta/eval-invocation=1157.8–1573.8ns
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S7-D-1 | `preparePromotion` 内 `putContent` 重存消除 | 双反例：legacy 无 contents 快照下 promote 路径 putContent 是唯一再物化写点（消除后 getActiveContent fail-closed undefined）+ hash32 碰撞（"Aa"/"BB" 同 `840`）下 last-write-wins → first-write-wins 语义翻转；收益上界一次 Map.set ~10–14ns |
| S7-D-2 | eval 报告尾（gatedComparisonReport/replayCacheKey/stringify/写盘）优化 | 份额锚定：28.7–29.2µs = 端到端 0.62–0.69%，低于落地线 ≥3 个量级；实现整体在 `src/experiments/`（切片外）；七遍分解至此闭合，切片内最大单项仍是已排除的 S6-D-5 |
| S7-D-3 | `saveAdaptationRegistry` 临时名 `randomUUID()` → pid+计数器 | 健壮性反例：崩溃遗留 + PID 复用下计数器名 EEXIST 使 save 中止（现行成功）；randomUUID 仅 81–90ns = save 地板 0.011–0.015% |
| S7-D-4 | `rollback()` 幂等快路径前置（跳过 target/retired 检查） | fail-open 反例：`begin → retire(pending) → commit` 使 retired 版本占据 active 指针，幂等回滚现行 fail-closed 抛错、前置变体静默 ok；非 retired-active 状态 300 fuzz 等价证明发散恰在该可达状态；delta ~267–283ns |
| S7-D-5 | `pairedRecords` 冗余回退 `episode.taskFamily ?? action.taskFamily` → `action.taskFamily` | 等价可证（不变式 + 300 fuzz 含错误路径逐位一致），但 ~1.2–1.6µs 低于落地线 ≥4 个量级；引入对 `replayAssignments` 回退定义的隐式跨函数耦合（漂移时静默错 family vs 现行自愈；S6-D-3 防御纵深同族） |

重开条件：S7-D-1 需同时 (a) 移除 legacy 无 contents 快照支持（迁移
决策、行为变更）且 (b) 将 hash32 换为抗碰撞内容哈希（公开契约变更）
——即便如此收益上界仍是 ~10ns；S7-D-2 属 F 切片辖区，需 paired 记录
N 增长 ≥3 个量级（统计 O(N) 固有）；S7-D-3 需原子保存契约改为容忍/
清理陈旧临时文件（健壮性决策，非性能问题）；S7-D-4 需先堵死
retired-active 可达状态（禁止 retire pending 版本或 commit 时复查——
均属行为变更）；S7-D-5 需接受跨函数数据流耦合或以类型系统固化不变式。
整片层面：唯一可能改变预算论证的仍是 E 增长 ≥2 个量级（继承 R3-D §6 /
R4-D §7 / R5-D §7 / R6-D §7，届时首先重开的是 S6-D-5 的 ~45ms 外推
单项，而非本轮任何候选）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts` 后 `npx tsx <file>`（顶层 await 需
ESM，`.mts` 强制 tsx 走 ESM；依赖已装）。seeds：`0xd77d01`–`0xd77d05`。

```ts
/**
 * R7-D deterministic equivalence + benchmark simulation (seventh pass).
 * Adjudicates fresh candidates S7-D-1 .. S7-D-5 against the current
 * implementations in src/adaptation/, re-verifies the R3-D..R6-D whole-slice
 * budget-domination argument with end-to-end anchors, and re-measures
 * evaluateProposalShadow through the S6-F-1-changed experiments/shadow.ts.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd77d01 - 0xd77d05.
 */
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  parseRegistrySnapshot,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  type PromoteInput,
  type ResourceRegistrySnapshot
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy } from "/workspace/src/adaptation/eval-routing.js";
import { evaluateProposalShadow } from "/workspace/src/adaptation/reflection.js";
import { validateRollbackInput, type RollbackInput } from "/workspace/src/adaptation/rollback.js";
import type { EvaluationPlan } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "/workspace/src/adaptation/resource.js";
import { createProjectId, parseTaskId, type CandidateId, type IdGenerator, type ResourceVersionId } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import {
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReportConfig,
  type PairedEvaluationRecord
} from "/workspace/src/experiments/comparison-report.js";
import { gatedComparisonReport } from "/workspace/src/experiments/gated-comparison.js";
import { replayCacheKey } from "/workspace/src/experiments/replay.js";
import type { ExperimentPlan } from "/workspace/src/experiments/plan.js";
import type { ExperimentOutcome } from "/workspace/src/experiments/shadow.js";
import { parseLearnedRoutingPolicy, type LearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
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

const NOW = "2026-08-24T12:00:00.000Z" as IsoTimestamp;
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

function mkReview(candidateId: CandidateId, contentHash: string, tag: string) {
  return {
    reviewId: `rv-${tag}`,
    candidateId,
    contentHash,
    verdict: "approved" as const,
    reviewerKind: "independent" as const,
    reviewerId: "critic-gate",
    actorId: HUMAN.identity,
    evidenceRefs: [`review:${tag}`]
  };
}

function mkNote(scope: string, rollbackVersionId: ResourceVersionId) {
  return {
    scope,
    evidence: ["static"],
    guardrails: ["proposal-first"],
    rollbackVersionId
  };
}

function buildRoutingRegistry(tag: string): { registry: ResourceRegistry; candidateId: CandidateId } {
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
  const manifest = { datasetId: "ds-r7d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* ============================================================
 * Section 0: whole-slice budget re-verification (R4-D..R6-D S0 recheck).
 * End-to-end anchors: registry load / save(+fsync) / adapt-eval E=200.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r7d-sim-"));
let evalMsAnchor = 0;
let saveMsAnchor = 0;
{
  const rng = mulberry32(0xd77d01);
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
  evalMsAnchor = evalMs;
  console.log(
    `S0 budget anchors: registry load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * Section 0b: evaluateProposalShadow wall clock re-measured THROUGH the
 * S6-F-1-changed experiments/shadow.ts (in-slice caller, no production
 * callers; the per-step restore/validate cost lives in the callee and is
 * covered by X4-1 / S3-F-2 / S2-F-1 — measured here only to document the
 * post-S6-F-1 profile reachable through the slice).
 * ============================================================ */
{
  const mkPlan = (p: number, a: number): ExperimentPlan => ({
    planVersion: 1,
    experimentId: "exp_r7d-shadow",
    mode: "shadow",
    baselineVersionId: "rsv_r7d0001" as ResourceVersionId,
    candidateId: "cnd_r7d0002" as CandidateId,
    population: Array.from({ length: p }, (_, i) => `eh_${i}`),
    metrics: ["utility"],
    thresholds: { maxGuardrailBreaches: 1000000, maxCostUsd: 1e9 },
    budget: { maxAssignments: a + 1, maxWallClockMs: 1000000000 },
    randomization: { seed: 7 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude"
  });
  const mkOutcomes = (a: number): ExperimentOutcome[] =>
    Array.from({ length: a }, (_, i) => ({
      episodeHash: `eh_${i}`,
      utility: i % 2,
      costUsd: 0.001,
      guardrailBreached: false
    }));
  for (const [p, a, reps] of [
    [200, 100, 20],
    [2000, 1000, 3]
  ] as const) {
    const plan = mkPlan(p, a);
    const outcomes = mkOutcomes(a);
    const state = evaluateProposalShadow(plan, outcomes, 0);
    check(`S0b shadow run completes without halt (P=${p},A=${a})`, !state.halted && state.outcomes.length === a);
    const ms = bench(() => {
      evaluateProposalShadow(plan, outcomes, 0);
    }, reps);
    console.log(
      `S0b evaluateProposalShadow through S6-F-1 shadow.ts: P=${p} A=${a} -> ${ms.toFixed(1)}ms per call (test-only; per-step restore cost is callee-side, X4-1/S3-F-2/S2-F-1 domain)`
    );
  }
}

/* ============================================================
 * S7-D-1: preparePromotion putContent store-elision (compute the hash,
 * skip the contentsByHash write — "createCandidate already stored it").
 * Two deterministic counterexamples through the public surface:
 *   (a) legacy snapshot without a contents field: the promote-path
 *       putContent is what re-materializes the blob; eliding it leaves
 *       getActiveContent() fail-closed undefined and the persisted
 *       snapshot without the content.
 *   (b) hash32 collision ("Aa" / "BB" both hash to 0x840 under the
 *       31-multiplier hash): current is last-write-wins, the eliding
 *       variant is first-write-wins -> different bytes from
 *       getActiveContent after an accepted promote.
 * Anchor: the elided work is one Map.set per promote (the hash is
 * computed either way).
 * ============================================================ */
{
  // Collision probe (deterministic, no search needed).
  check("S7-D-1 hash32 collision pair", hash32("Aa") === hash32("BB") && "Aa" !== "BB", `${hash32("Aa")} vs ${hash32("BB")}`);

  // (a) Legacy snapshot repair path.
  const seed = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1a") });
  const identity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d1proj") }
  };
  const baseline = seed.registerBaseline({ identity, content: "v1-content", author: HUMAN });
  const candidate = seed.createCandidate({
    identity,
    content: "v2-content",
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  const full = JSON.parse(JSON.stringify(seed.snapshot())) as Record<string, unknown>;
  delete full.contents; // legacy pre-contents snapshot shape (explicitly supported)
  const legacy = ResourceRegistry.fromSnapshot(parseRegistrySnapshot(full), {
    now: () => NOW,
    generateId: sequentialIds("d1z")
  });
  const beforeContent = legacy.getContent(candidate.contentHash);
  check("S7-D-1 setup: legacy registry has no stored content for the candidate hash", beforeContent === undefined);
  const promoteInput: PromoteInput = {
    candidateId: candidate.candidateId,
    expectedCurrentVersionId: baseline.versionId,
    content: "v2-content",
    approvedBy: HUMAN,
    review: mkReview(candidate.candidateId, candidate.contentHash, "d1"),
    changeNote: mkNote("prompt:d1", baseline.versionId),
    explicitApproval: true
  };
  promoteWithRegistry(legacy, promoteInput);
  const activeContent = legacy.getActiveContent(identity);
  check(
    "S7-D-1 counterexample (a): promote-path putContent re-materializes the blob (store is live, not dead)",
    activeContent !== undefined && activeContent.content === "v2-content"
  );
  const persisted = legacy.snapshot().contents ?? [];
  check("S7-D-1 counterexample (a): re-materialized blob reaches the persisted snapshot", persisted.some((b) => b.hash === candidate.contentHash));
  console.log(
    `S7-D-1 counterexample (a): legacy no-contents snapshot -> before promote getContent=undefined | current promote re-stores -> getActiveContent="${activeContent?.content}" and snapshot.contents has the blob | eliding variant leaves both undefined/absent -> observable fail-closed divergence`
  );

  // (b) hash-collision last-write-wins vs first-write-wins.
  const coll = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1c") });
  const cIdentity: ResourceIdentity = {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "d1cproj") }
  };
  const cBase = coll.registerBaseline({ identity: cIdentity, content: "v1", author: HUMAN });
  const cCand = coll.createCandidate({
    identity: cIdentity,
    content: "Aa",
    parentVersionId: cBase.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  const storedBefore = coll.getContent(cCand.contentHash);
  check("S7-D-1 (b) setup: candidate-time bytes stored", storedBefore === "Aa");
  promoteWithRegistry(coll, {
    candidateId: cCand.candidateId,
    expectedCurrentVersionId: cBase.versionId,
    content: "BB", // different bytes, same hash32 -> passes every hash equality gate
    approvedBy: HUMAN,
    review: mkReview(cCand.candidateId, cCand.contentHash, "d1c"),
    changeNote: mkNote("prompt:d1c", cBase.versionId),
    explicitApproval: true
  });
  const storedAfter = coll.getActiveContent(cIdentity)?.content;
  check("S7-D-1 counterexample (b): current promote is last-write-wins on a hash collision", storedAfter === "BB");
  console.log(
    `S7-D-1 counterexample (b): collision promote accepted (hash ${cCand.contentHash}) -> current getActiveContent="${storedAfter}" (last write wins) | eliding variant keeps "${storedBefore}" (first write wins) -> divergent bytes through the public surface`
  );

  // Anchor: the elided work is one Map.set on a small map.
  const map = new Map<string, string>();
  for (let i = 0; i < 8; i += 1) map.set(hash32(`blob${i}`), `blob${i}`);
  const key = hash32("blob3");
  const setCost = bench(() => map.set(key, "blob3"), 200000);
  console.log(
    `S7-D-1 anchor: one contentsByHash Map.set = ${(setCost * 1e6).toFixed(1)}ns per promote (hash computed either way; upper bound of any gain)`
  );
}

/* ============================================================
 * S7-D-2: gatedComparisonReport share of the eval invocation — the last
 * unmeasured end-to-end component after S2-D-4 (assignTasks x2), S3-D-3
 * (guard build), S6-D-5 (rerunHash serialization), S4-D-3 (load I/O).
 * Also anchors replayCacheKey and the report stringify+write tail so the
 * decomposition closes. Implementation is entirely outside the slice
 * (experiments/comparison-report.ts + gated-comparison.ts).
 * ============================================================ */
{
  const rng = mulberry32(0xd77d02);
  const N = 140; // ~70% observed episodes of E=200 (S0 dataset distribution)
  const records: PairedEvaluationRecord[] = Array.from({ length: N }, (_, i) => {
    const utility = rng() < 0.5 ? 1 : 0;
    return {
      episodeHash: `eh_${i}`,
      taskFamily: pick(rng, ["edit", "test", "review"]),
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: 0.5,
      candidateCostUsd: 0.1 + (i % 3) * 0.2
    };
  });
  const config: ComparisonReportConfig = {
    ...DEFAULT_COMPARISON_REPORT_CONFIG,
    evidenceClass: "simulation"
  };
  const gatedMs = bench(() => {
    gatedComparisonReport({ records, claims: [], config, difficultyTier: "replay" });
  }, 2000);
  const cacheKeyMs = bench(() => {
    replayCacheKey({
      runId: "ds-r7d",
      candidateHash: "deadbeef",
      environmentVersion: "env-1",
      evaluatorVersion: "routing-eval-v1"
    });
  }, 20000);
  const report = gatedComparisonReport({ records, claims: [], config, difficultyTier: "replay" });
  const reportJson = `${JSON.stringify({ candidateId: "cnd_x", contentHash: "deadbeef", cacheKey: "ck", stages: ["static", "replay"], comparison: report, evidenceClass: "replay", environmentVersion: "env-1", evaluatorVersion: "routing-eval-v1", rerunHash: "rh" }, null, 2)}\n`;
  const stringifyMs = bench(() => {
    JSON.stringify({ candidateId: "cnd_x", contentHash: "deadbeef", cacheKey: "ck", stages: ["static", "replay"], comparison: report, evidenceClass: "replay", environmentVersion: "env-1", evaluatorVersion: "routing-eval-v1", rerunHash: "rh" }, null, 2);
  }, 5000);
  const reportPath = join(workRoot, "report-probe.json");
  const writeMs = await benchAsync(async () => {
    await writeFile(reportPath, reportJson, "utf8");
  }, 50);
  console.log(
    `S7-D-2 anchor N=${N}: gatedComparisonReport=${(gatedMs * 1e3).toFixed(1)}us (${((gatedMs / evalMsAnchor) * 100).toFixed(2)}% of ${evalMsAnchor.toFixed(2)}ms end-to-end) | replayCacheKey=${(cacheKeyMs * 1e3).toFixed(2)}us | report stringify=${(stringifyMs * 1e3).toFixed(1)}us write(no fsync)=${(writeMs * 1e3).toFixed(1)}us`
  );
}

/* ============================================================
 * S7-D-3: saveAdaptationRegistry temp-file name randomUUID() -> pid+counter.
 * Verbatim save replica with an injectable temp-name generator. A stale
 * temp file (crash leftover under a recycled pid) makes the counter
 * variant fail with EEXIST on open("wx") where the current UUID name
 * succeeds. Anchor: randomUUID cost vs the fsync floor.
 * ============================================================ */
{
  async function saveReplica(path: string, serialized: string, tempName: () => string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = tempName();
    const handle = await open(tempPath, "wx");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
  const dir = join(workRoot, "d3");
  const path = join(dir, "registry.json");
  await mkdir(dir, { recursive: true });
  // Crash leftover: the exact first name the counter variant will pick.
  const stale = `${path}.${process.pid}.1.tmp`;
  await writeFile(stale, "stale-crash-leftover", "utf8");

  let uuidOutcome = "<ok>";
  try {
    await saveReplica(path, "{}\n", () => `${path}.${process.pid}.${randomUUID()}.tmp`);
  } catch (error) {
    uuidOutcome = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
  }
  let counter = 0;
  let counterOutcome = "<ok>";
  try {
    await saveReplica(path, "{}\n", () => `${path}.${process.pid}.${(counter += 1)}.tmp`);
  } catch (error) {
    counterOutcome = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
  }
  check("S7-D-3 counterexample: UUID name survives a stale leftover", uuidOutcome === "<ok>");
  check("S7-D-3 counterexample: counter name fails closed on the leftover", counterOutcome === "EEXIST");
  console.log(
    `S7-D-3 counterexample (stale tmp under recycled pid): current uuid-name save -> ${uuidOutcome} | pid+counter variant -> ${counterOutcome} (save aborts where current succeeds)`
  );
  const uuidCost = bench(() => {
    randomUUID();
  }, 100000);
  console.log(
    `S7-D-3 anchor: randomUUID()=${(uuidCost * 1e6).toFixed(0)}ns per save = ${((uuidCost / saveMsAnchor) * 100).toFixed(3)}% of the ${saveMsAnchor.toFixed(2)}ms save(+fsync) floor`
  );
}

/* ============================================================
 * S7-D-4: rollback() idempotent fast path hoisted ahead of the
 * target/retired checks (active === target -> return {ok:true} without
 * scanning versionsFor or consulting retiredIds). Counterexample is
 * mutation-reachable through the public API: beginPromotion ->
 * retire(pendingVersion) -> commitPromotion leaves a RETIRED version as
 * the active pointer; idempotent rollback onto it currently fails closed
 * with the retired error, the fast-path variant silently returns ok.
 * Equivalence fuzz over non-retired-active states + ns anchor.
 * ============================================================ */
{
  const rng = mulberry32(0xd77d04);
  const capture = (fn: () => unknown): string => {
    try {
      const result = fn() as { ok: boolean };
      return `<ok:${result.ok}>`;
    } catch (error) {
      return (error as Error).message;
    }
  };
  // Fast-path variant replica over the public surface: input validation
  // kept, idempotent return hoisted ahead of target existence/identity/
  // retired checks; every other path delegates to the real rollback.
  const variantRollback = (reg: ResourceRegistry, input: RollbackInput): string => {
    try {
      validateRollbackInput(input);
    } catch (error) {
      return (error as Error).message;
    }
    const active = reg.getActiveVersion(input.identity);
    if (active !== undefined && active.versionId === input.targetVersionId) {
      return "<ok:true>";
    }
    return capture(() => reg.rollback(input));
  };

  const buildPromoted = (tag: string): {
    registry: ResourceRegistry;
    identity: ResourceIdentity;
    v1: ResourceVersion;
    v2: ResourceVersion;
  } => {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => `${tag}p`) }
    };
    const v1 = registry.registerBaseline({ identity, content: "v1", author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: "v2",
      parentVersionId: v1.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const result = promoteWithRegistry(registry, {
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: v1.versionId,
      content: "v2",
      approvedBy: HUMAN,
      review: mkReview(candidate.candidateId, candidate.contentHash, tag),
      changeNote: mkNote(`prompt:${tag}`, v1.versionId),
      explicitApproval: true
    });
    return { registry, identity, v1, v2: result.newVersion as ResourceVersion };
  };

  // Counterexample: retired version becomes ACTIVE via begin -> retire(pending) -> commit.
  {
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d4x") });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => "d4xp") }
    };
    const v1 = registry.registerBaseline({ identity, content: "v1", author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: "v2",
      parentVersionId: v1.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const began = registry.beginPromotion({
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: v1.versionId,
      content: "v2",
      approvedBy: HUMAN,
      review: mkReview(candidate.candidateId, candidate.contentHash, "d4x"),
      changeNote: mkNote("prompt:d4x", v1.versionId),
      explicitApproval: true
    });
    registry.retire(began.pendingVersion.versionId); // pending is not active -> retire succeeds
    registry.commitPromotion(began.intentId); // CAS moves the pointer onto the retired version
    check(
      "S7-D-4 setup: a retired version is now the active pointer (public API only)",
      registry.getActiveVersion(identity)?.versionId === began.pendingVersion.versionId &&
        registry.isRetired(began.pendingVersion.versionId)
    );
    const input: RollbackInput = {
      identity,
      expectedCurrentVersionId: began.pendingVersion.versionId,
      targetVersionId: began.pendingVersion.versionId,
      reason: "user",
      evidence: ["ev:d4"],
      automatic: false
    };
    const current = capture(() => registry.rollback(input));
    const variant = variantRollback(registry, input);
    check("S7-D-4 counterexample: current fails closed, fast-path variant fails open", current !== variant && variant === "<ok:true>", `${current} vs ${variant}`);
    console.log(
      `S7-D-4 counterexample (begin -> retire(pending) -> commit): idempotent rollback onto the retired active -> current "${current}" | hoisted fast path "${variant}" -> fail-open divergence on a mutation-reachable state`
    );
  }

  // Equivalence fuzz over states whose active pointer is not retired.
  for (let trial = 0; trial < 300; trial += 1) {
    const { registry, identity, v1, v2 } = buildPromoted(`d4t${trial}x`);
    if (rng() < 0.4) registry.retire(v1.versionId); // retired NON-active
    const badIdentity: ResourceIdentity = { ...identity, name: "other-name" };
    const mode = Math.floor(rng() * 5);
    const input: RollbackInput =
      mode === 0
        ? { identity, expectedCurrentVersionId: v2.versionId, targetVersionId: v2.versionId, reason: "user", evidence: ["ev"], automatic: false }
        : mode === 1
          ? { identity, expectedCurrentVersionId: v2.versionId, targetVersionId: v1.versionId, reason: "user", evidence: ["ev"], automatic: false }
          : mode === 2
            ? { identity, expectedCurrentVersionId: v2.versionId, targetVersionId: "rsv_nope0001" as ResourceVersionId, reason: "user", evidence: ["ev"], automatic: false }
            : mode === 3
              ? { identity: badIdentity, expectedCurrentVersionId: v2.versionId, targetVersionId: v2.versionId, reason: "user", evidence: ["ev"], automatic: false }
              : { identity, expectedCurrentVersionId: v2.versionId, targetVersionId: v2.versionId, reason: "degradation", evidence: ["ev"], automatic: false };
    // Variant decision computed against a clone so the real call stays authoritative.
    const clone = ResourceRegistry.fromSnapshot(
      parseRegistrySnapshot(JSON.parse(JSON.stringify(registry.snapshot())) as ResourceRegistrySnapshot),
      { now: () => NOW, generateId: sequentialIds("z") }
    );
    const variant = variantRollback(clone, input);
    const current = capture(() => registry.rollback(input));
    check("S7-D-4 equivalence on non-retired-active states", current === variant, `trial ${trial} mode ${mode}: ${current} vs ${variant}`);
  }

  // Anchor: idempotent-path cost, current vs hoisted fast path.
  const { registry: benchReg, identity: benchIdentity, v2: benchV2 } = buildPromoted("d4b");
  const benchInput: RollbackInput = {
    identity: benchIdentity,
    expectedCurrentVersionId: benchV2.versionId,
    targetVersionId: benchV2.versionId,
    reason: "user",
    evidence: ["ev"],
    automatic: false
  };
  const cur = bench(() => benchReg.rollback(benchInput), 100000);
  const fast = bench(() => {
    validateRollbackInput(benchInput);
    const active = benchReg.getActiveVersion(benchInput.identity);
    if (active === undefined || active.versionId !== benchInput.targetVersionId) {
      throw new DomainValidationError("unreachable in this bench");
    }
  }, 100000);
  console.log(
    `S7-D-4 anchor (idempotent path only): current=${(cur * 1e6).toFixed(1)}ns hoisted=${(fast * 1e6).toFixed(1)}ns delta=${((cur - fast) * 1e6).toFixed(1)}ns per idempotent rollback (CAS path unchanged)`
  );
}

/* ============================================================
 * S7-D-5: pairedRecords redundant `episode.taskFamily ?? action.taskFamily`
 * fallback elimination. Dataflow invariant: replayAssignments defines
 * action.taskFamily = episode.taskFamily ?? baselineAssignment.analysis.family,
 * so whenever episode.taskFamily is defined the action already carries it —
 * `episode.taskFamily ?? action.taskFamily` is provably `action.taskFamily`.
 * Invariant fuzz + equivalence fuzz (incl. the missing-action error path)
 * + E=200 bench.
 * ============================================================ */
{
  const rng = mulberry32(0xd77d05);
  const catalog: ModelRouterConfig = catalogFromPrimary({ primaryModelId: DEFAULT_PRIMARY_MODEL_ID });
  const roles: readonly AgentRole[] = ["executor", "tester", "reviewer", "planner", "scout"];
  const baselinePolicy: LearnedRoutingPolicy = parseLearnedRoutingPolicy(BASELINE_POLICY);
  const candidatePolicy: LearnedRoutingPolicy = parseLearnedRoutingPolicy(CANDIDATE_POLICY);

  interface Ep {
    readonly episodeHash: string;
    readonly taskId: string;
    readonly role: AgentRole;
    readonly objective: string;
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
  // Verbatim replica of replayAssignments (real assignTasks + learned policies).
  function replayReplica(episodes: readonly Ep[]): { actions: Action[]; baseline: readonly TaskAssignment[] } {
    const tasks = episodes.map((episode) => ({
      taskId: parseTaskId(episode.taskId),
      role: episode.role,
      objective: episode.objective
    }));
    const baseline = assignTasks({ catalog, tasks, learned: baselinePolicy });
    const candidate = assignTasks({ catalog, tasks, learned: candidatePolicy });
    const actions = episodes.map((episode, index) => {
      const baselineAssignment = baseline[index];
      const candidateAssignment = candidate[index];
      if (baselineAssignment === undefined || candidateAssignment === undefined) {
        throw new DomainValidationError(`missing assignment for ${episode.episodeHash}`);
      }
      return {
        episodeHash: episode.episodeHash,
        taskFamily: episode.taskFamily ?? baselineAssignment.analysis.family,
        taskSuccess: episode.taskSuccess ?? ("UNOBSERVED" as const),
        baselineModel: baselineAssignment.decision.model,
        candidateModel: candidateAssignment.decision.model,
        baselineCostUsd: catalogCostL(catalog, baselineAssignment.decision.model),
        candidateCostUsd: catalogCostL(catalog, candidateAssignment.decision.model)
      };
    });
    return { actions, baseline };
  }
  // Verbatim replica of pairedRecords (current form).
  function pairedCurrent(episodes: readonly Ep[], actions: readonly Action[]): PairedEvaluationRecord[] {
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
  // Candidate: the redundant fallback dropped (taskFamily: action.taskFamily).
  function pairedVariant(episodes: readonly Ep[], actions: readonly Action[]): PairedEvaluationRecord[] {
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
        taskFamily: action.taskFamily,
        baselineUtility: utility,
        candidateUtility: utility,
        baselineCostUsd: action.baselineCostUsd,
        candidateCostUsd: action.candidateCostUsd
      });
    }
    return records;
  }

  let familyDefinedProbes = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const n = trial === 0 ? 200 : Math.floor(rng() * 24);
    const episodes: Ep[] = Array.from({ length: n }, (_, i) => ({
      episodeHash: `eh_${trial}_${i}`,
      taskId: `tsk_d5_${trial}_${i}`,
      role: pick(rng, roles),
      objective: pick(rng, OBJECTIVES),
      ...(rng() < 0.5 ? { taskFamily: pick(rng, ["edit", "test", "review"]) } : {}),
      ...(rng() < 0.7 ? { taskSuccess: rng() < 0.5 ? ("PASS" as const) : ("FAIL" as const) } : {})
    }));
    const { actions } = replayReplica(episodes);
    // Invariant: action.taskFamily carries episode.taskFamily whenever defined.
    for (let i = 0; i < episodes.length; i += 1) {
      const episode = episodes[i] as Ep;
      if (episode.taskFamily !== undefined) {
        familyDefinedProbes += 1;
        check("S7-D-5 invariant: action.taskFamily === episode.taskFamily when defined", (actions[i] as Action).taskFamily === episode.taskFamily, `trial ${trial} i=${i}`);
      }
    }
    // Equivalence incl. the truncated-actions error path (~6%).
    const usedActions = rng() < 0.06 && n > 2 ? actions.slice(0, n - 1) : actions;
    let curOut = "";
    let varOut = "";
    try {
      curOut = JSON.stringify(pairedCurrent(episodes, usedActions));
    } catch (error) {
      curOut = `<err:${(error as Error).message}>`;
    }
    try {
      varOut = JSON.stringify(pairedVariant(episodes, usedActions));
    } catch (error) {
      varOut = `<err:${(error as Error).message}>`;
    }
    check("S7-D-5 equivalence (records bytes + error path)", curOut === varOut, `trial ${trial}`);
  }
  check("S7-D-5 fuzz coverage: defined-family probes exercised", familyDefinedProbes > 1000, String(familyDefinedProbes));

  const E = 200;
  const episodes: Ep[] = Array.from({ length: E }, (_, i) => ({
    episodeHash: `eh_b${i}`,
    taskId: `tsk_d5_b${i}`,
    role: pick(rng, roles),
    objective: pick(rng, OBJECTIVES),
    ...(i % 2 === 0 ? { taskFamily: "edit" } : {}),
    ...(i % 10 < 7 ? { taskSuccess: i % 2 === 0 ? ("PASS" as const) : ("FAIL" as const) } : {})
  }));
  const { actions } = replayReplica(episodes);
  const cur = bench(() => pairedCurrent(episodes, actions), 5000);
  const cand = bench(() => pairedVariant(episodes, actions), 5000);
  console.log(
    `S7-D-5 bench E=${E}: current=${(cur * 1e6).toFixed(1)}ns variant=${(cand * 1e6).toFixed(1)}ns delta/eval-invocation=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

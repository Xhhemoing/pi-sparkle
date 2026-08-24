MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-D：`src/adaptation/` 第八遍搜查报告（Round 1–7 同区第八遍）

**战役:** 全库持久 SOTA 优化 Round 8 / R8-D
**基线:** `cursor/sota-persistent-opt-83a1` @ `aa730d2`
**分支:** `cursor/r8-d-adaptation-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 14 个文件自 R1-D 基线
（`82bef36`）起经 R2-D…R7-D（`447e522`）至本轮基线（`aa730d2`）
**逐字节未变**（`git diff 82bef36..aa730d2 -- src/adaptation/` 为空），
前七轮全部规模测量、逐文件收口与 S1-D..S7-D 六族排除继承有效。R7-D 后
切片外变更是三个已落地赢家：S7-F-1/S7-F-2（`519101f`，
experiments/{canary,plan,shadow}——本切片 `reflection.evaluateProposalShadow`
的**被调方**，plan.ts 的 `validateExperimentPlan` 亦在其中）、S7-C
（`183df9b`，routing/offline-logit）、S7-I-1（`8dee7fb`，cli/model-catalog
+ pi-adapter 拆分），均不在 adapt-eval 调用链上。本轮按指令先**重测端到端
锚点**（§1：`adapt eval` E=200 玩具政策 4.05–4.33ms/调用，与 R7-D
4.26–4.59 同带下沿；registry save+fsync 0.39–0.45ms、load 0.10–0.11ms），
再按 R7-I 教训**首次补配置态锚点**（§1c：9.2KB 学习政策（40 avoid +
40 prefer + 7 assignments，全部绑定真实目录模型 id）+ V=15/C=9/L=11/B=18
blobs 119.5KB 的 registry（registry.json 146.2KB）——load 0.57–0.71ms、
save 1.44ms、eval E=200 **3.67–3.93ms**：与玩具态同在 ~4ms 带内，
**D 切片不存在被默认态夹具掩盖的配置态主路径**，与 R7-I 在 cli 切片的
发现相反），然后**穿过 S7-F-1/S7-F-2 改动后的 shadow.ts+plan.ts 重测**
`evaluateProposalShadow` 墙钟（§1b：P=200/A=100 → 1.3–1.4ms、
P=2000/A=1000 → **119.9–124.6ms**，较 R7-D 的 186.0–188.3ms 快 ~35%
——S7-F-1 对齐前缀快路径的被调方收益穿透可见），最后换第八组新透镜
全量重读枚举，得到 5 个此前排除表未点名的新候选（S8-D-1 … S8-D-5），
全部经理论 + 确定性仿真（seeded mulberry32，反例构造 / 等价 fuzz /
真实规模基准，两次独立运行等价/反例结论**逐位一致**）裁决后淘汰：
2 个有确定性反例（S8-D-1 载入篡改 fail-open、S8-D-4 失败路径混合态），
1 个契约性自动否决（S8-D-3 去 fsync = crash-order widening，且收益
0.39–0.52ms 本身低于落地线），2 个可证等价但在噪声带（S8-D-2 读路径
再哈希可证死码但 13.4µs 且为防御纵深成对门、S8-D-5 条件展开消除
~5.1µs = 端到端 0.12–0.13%）。切片内单项最大可寻址份额仍是已排除的
S6-D-5（rerunHash 序列化 ~0.46ms）。未重开任何 X* / S1-* / S2-* /
S3-* / S4-* / S5-* / S6-* / S7-* / S8-B-* 条目（S8-B-1..4 全在 live
routing 切片，已核对不撞车）。X2-5 维持排除未触碰。CAS/权限/凭据/
数据面语义零 diff，天然不变。不声称 Outcome-supported；Checkpoint
F-PROD 仍开放。本切片在人审门控低频控制面契约下维持 SOTA；~4ms eval +
fsync 地板第六次独立复核成立（本轮同时以配置态复核），按验收标准
第 3 条，切片继续收口——整片唯一重开阈值仍是 E 增长 ≥2 个量级
（继承 R6-D/R7-D §7 的单项外推 ~45ms，见 §7）。

## 0. 范围与约束遵守

- 切片：`src/adaptation/` 全部 14 文件（registry、promotion、
  promotion-rules、candidate、eval-routing、pareto、rollback、resource、
  retirement、active-pointer、monitor、approval-profile、reflection、
  mutate）本轮再次**全量实际读码**，未依赖前七轮记忆。
- 先读并遵守：README / EXCLUSIONS.md（完整表含 S7-D-1..5、S8-B-1..4）/
  round-08/PLAN.md / round-01/R1-D.md … round-07/R7-D.md。
- 基线漂移检查：`git diff 82bef36..aa730d2 -- src/adaptation/` 为空；
  **切片外调用面复核**——`git diff --stat 447e522..aa730d2 -- src/` 共
  8 文件：`src/experiments/{canary,plan,shadow}.ts`（S7-F-1/S7-F-2）、
  `src/routing/offline-logit.ts`（S7-C）、`src/cli/model-catalog.ts` 与
  `src/pi-adapter/listed-model*.ts`（S7-I-1）。eval-routing 的全部切片外
  被调方（comparison-report / gated-comparison / isolation / manifest /
  replay）与 `src/routing/assign.ts`、`src/learning/`、`src/domain/`
  零变更——adapt-eval 调用链不受影响；`shadow.ts`+`plan.ts` 是
  `reflection.evaluateProposalShadow` 的被调方（`createShadowRunner` /
  `validateExperimentPlan`），按指令未编辑、只穿透重测（§1b）。grep
  复核 monitor / pareto / reflection / mutate / retirement 族在 `src/`
  生产面仍无切片外调用方（R3-D..R7-D 图景原样成立，本轮独立重查）。
- 排除表遵守：候选枚举刻意绕开全部既有排除。X2-5 直接跳过；
  S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 / S5-D-1..5 /
  S6-D-1..5 / S7-D-1..5 全部不再提案；S8-B-1..4 不在本切片但已核对
  不撞车。特别核对过近缘条目后确认本轮五个透镜均是**新点名site**：
  S8-D-1（restore 逐 blob 内容再哈希）≠ S5-D-1（restore 对解析器产物
  的 id 再校验）；S8-D-2（getActiveContent 读路径再哈希）此前只有
  「两跳查找已最优」的收口记录、再哈希本体从未点名；S8-D-3（去
  fsync）八轮从未有人提案（历轮只把它当「地板」引用）；S8-D-4
  （rollbackLog 预清除）≠ S3-D-4/S4-D-2（解析/载入链拷贝消除）；
  S8-D-5（parseEpisode 条件展开）≠ S5-D-2（pairedRecords entries()
  换索引循环）。禁令点名的双故障 Promise.all / 投机 I/O / restore id
  再校验跳过 / 丢 ledger 拷贝换名重提均未发生。
- 已落地项未重做：promotion-rules 拆环、gatedComparisonReport 薄包装、
  `loadAdaptationRegistryOrNew`、S6-C/S6-F-1/S7-F-1/S7-F-2/S5-I-1/
  S7-I-1/S7-C（均在切片外，不触碰）。
- CAS 语义（`casActivePointer` + 两阶段 begin/commit + 幂等回滚）、
  权限/安全/凭据永不自动晋升、`adapt auto` 只提案——零 diff，天然满足。
  双 LCB 与双归因不涉及本切片，均未触碰。不声称 Outcome-supported；
  Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、公开签名、数据面契约。
  不改测试。无赢家故未新建等价仿真入库脚本；败者仿真全文留在本报告
  附录。lint 全绿。

## 1. 预算支配论证复核（指令要求的第一步）

R3-D §3 … R7-D §1 的论证：全部生产入口是每进程一次的 CLI/auto-loop
（磁盘载入→单次操作→原子保存）；切片内可寻址成本 promote/rollback
路径 <~10µs、eval 路径 <0.5ms，均被固定 ms 级成本支配。本轮用与
R4-D..R7-D 相同的真实入口端到端方法重测（temp stateRoot + 真实
`saveAdaptationRegistry`/`loadAdaptationRegistry`/`evalRoutingPolicy`，
E=200 数据集，两次独立运行）：

```text
run1: registry load=0.11ms save(+fsync)=0.45ms | adapt-eval end-to-end (E=200, toy policy)=4.33ms
run2: registry load=0.10ms save(+fsync)=0.39ms | adapt-eval end-to-end (E=200, toy policy)=4.05ms
```

**eval 锚点带成立**（4.05–4.33ms，与 R7-D 4.26–4.59ms 下沿重合、本 VM
略快），save+fsync 0.39–0.45ms 与 R6-D 的 0.41–0.45ms 几乎重合，仍为
ms 级 I/O 地板，支配方向不变。本轮候选中可证等价且非反例的两项
（S8-D-2 ~13.4µs、S8-D-5 ~5.1µs）距数十~数百 ms 落地线 ≥3–4 个量级；
预算支配论证经第六次独立复核后继续成立。

### 1b. `evaluateProposalShadow` 穿透 S7-F-1/S7-F-2 重测（指令新增项）

S7-F-1 给 `experiments/shadow.ts`/`canary.ts` 加了对齐前缀 restore
快路径、S7-F-2 加了 ASCII-head trim 守卫，`plan.ts` 的
`validateExperimentPlan` 同一提交内变更——三者都是本切片
`reflection.evaluateProposalShadow` 的**被调方**。按指令不编辑这些
文件，只从切片侧穿透重测 post-S7-F 的墙钟轮廓：

```text
S0b evaluateProposalShadow: P=200  A=100  -> 1.3–1.4ms per call
S0b evaluateProposalShadow: P=2000 A=1000 -> 119.9–124.6ms per call
```

较 R7-D 的 1.7–1.8ms / 186.0–188.3ms 快 ~25–35%——S7-F-1 的被调方
收益从切片侧穿透可见，方向与幅度与 R7-F 报告一致。逐步
population-restore/验证成本仍全部在被调方（X4-1 / S3-F-2 / S2-F-1 /
S6-F-1 / S7-F-1 辖区）；切片内的 `evaluateProposalShadow` 本体只做
plan 校验 + 循环委托 + 状态透传，且在 `src/` 生产面**无调用方**
（grep 本轮复核，测试专用）。切片内无 ms 级可寻址份额，无候选。

### 1c. 配置态锚点（R7-I 教训，本切片首次）

R7-I 的教训：默认态夹具可能掩盖配置态主路径。历轮 D 基准全部用近空
玩具政策（1 avoid + 1 prefer）与 2 版本 registry。本轮构造配置态：
学习政策 40 avoid + 40 prefer + 7 assignments（9.2KB JSON，avoid/prefer
绑定真实目录模型 id `cheap`，使规则在 assignTasks 中真实生效）；
registry 含 9 个身份、5 次显式批准晋升、1 个 pending intent、2 条
rollback 账目、2 个 retired 版本、B=18 个 KB 级内容 blob（合计
119.5KB，registry.json 146.2KB）：

```text
S0c configured: load=0.57–0.71ms save(+fsync)=1.44ms | adapt-eval end-to-end (E=200, configured policy)=3.67–3.93ms
```

三个结论：(a) 配置态 eval 与玩具态同在 ~4ms 带内（3.67–3.93 vs
4.05–4.33，差异在 VM 抖动带内）——**D 切片没有配置态悬崖**；政策
规模增长的成本（4 次 JSON.parse、每任务 avoid-Set 构建）被 ms 级
I/O+固定成本吞没。(b) load 从 0.10–0.11ms 涨到 0.57–0.71ms、save 从
0.39–0.45ms 涨到 1.44ms——增量全部是 JSON 解析/序列化与 fsync 的
O(状态规模) 固有成本，其中唯一切片内可寻址新成分是 S8-D-1 点名的
逐 blob 再哈希（153.8–154.1µs = load 的 21.7–26.9%，见 §3）。
(c) S1-D-4（catalogCost 换 Map）的旧否决理由「真实 M=2」在配置态
复核下仍成立——目录仍是 2 模型（`catalogFromPrimary` 固定），未重开。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-D-1 | `restore()` 逐 blob 内容再哈希消除（`hashCandidateContent(blob.content) !== blob.hash` 载入门——「parse 已验 shape，O(bytes) hash 是重复」；S5-D-1 是 id 再校验，本条是内容完整性门，八遍首次点名） | 省 O(总 blob 字节)/load，配置态 load 的 ~1/4 | ❌ **篡改反例**（确定性，公开面）：篡改快照 candidate blob（剥除全部 avoid 规则、保留声明 hash）——现行 load 抛 `snapshot content hash mismatch: 263d4a0a` fail-closed；消除变体静默载入，`getContent` 交出篡改字节 = eval 路径 `contentFor` 的直接消费源，下游 assignTasks 指派发散（getActiveContent 的读门只护 live 路径，护不住 eval 的 getContent 消费） | 配置态 B=18/119.5KB：**153.8–154.1µs**/load（占配置态 load 21.7–26.9%）；1MB 包络 hash32=2.53–2.59ms/MB | 淘汰：完整性门消除 = fail-open 自动否决族（授权指令点名家族）+ 现实规模 µs 级 |
| S8-D-2 | `getActiveContent()` 读路径再哈希消除（map 不变式 `hash(get(k))===k` 由两个写点保证：putContent 用刚算出的 hash 作键、restore 逐 blob 校验后 set——检查可证不可达，hash32 碰撞也过门） | 省 O(bytes)/read | ✅ 等价：300 试次 ×2 探针（含 hash32 碰撞晋升 "Aa"/"BB" 与快照往返）逐位一致；检查 **0 次触发**（可证死码，也证明它连碰撞都查不出） | 配置态 9KB 政策 delta=**13.4µs**/read；64KB 探针 178.0–185.0µs/read | 淘汰：µs 级 ≥3 个量级低于落地线 + **防御纵深成对论证**——restore 门护 `getContent`（eval 消费），读门护 `getActiveContent`（live 消费，且 loadLearnedRouting 切片外还有第三道再哈希）；S8-D-1 型漂移下读门是 live 路径切片内唯一门，拆掉任一都在另一门漂移时使对应消费路径 fail-open（S6-D-3/S4-D-4 同族） |
| S8-D-3 | `saveAdaptationRegistry` 去 fsync（rename 前省 `handle.sync()`——save 地板中唯一 ms 级单项，八轮来首次被作为候选点名而非当「地板」引用） | 省 ~0.4–0.5ms/save | ❌ **契约反例**（理论；用户态无法仿真断电）：无 fsync 时数据块落盘与 rename 的次序是文件系统相关行为，崩溃后 registry.json 可为空/截断；现行 sync-before-rename 是原子保存的标准形态，保证 crash 后必得旧字节或新字节。写序拓宽 = 授权指令自动否决族 | with fsync=0.73–0.98ms / without=0.34–0.46ms，**delta=0.39–0.52ms**/save——delta 本身就是耐久性契约的价格 | 淘汰：crash-order widening 自动否决；且收益 0.39–0.52ms 即便计入也低于数十 ms 落地线 ≥1.5 个量级 |
| S8-D-4 | `restore()` 头部 `rollbackLog.restore([])` 预清除消除（「`RollbackLog.restore` 本身先清后填，首调用是死双清」——成功路径为真） | 省一次空 restore/load | ❌ **失败路径反例**（确定性，公开面）：对已使用 registry restore 一个 active-version-unknown 快照——两个实现同样 fail-closed 抛同错，但现行事后 `rollbackLedger()=[]`（与其余全部集合一致清空），消除变体**独留前一 registry 的 1 条陈旧 rollback 记录** → 失败路径混合态发散；成功路径快照逐字节等价（fuzz 证实发散恰只在异常序） | 预清除本体 **41.1–41.4ns**/restore（收益上界） | 淘汰：ns 级 + 失败路径状态一致性拓宽（异常序契约本体，S6-D-2/S7-D-3 崩溃恢复同族） |
| S8-D-5 | `parseEpisode` 尾部条件展开消除（`{...(x!==undefined?{k:x}:{})}` ×2 → 先建基对象再条件赋值；属性存在性与键序完全一致） | 省 2E 次 spread 分配/eval | ✅ 等价：300 试次含全部校验错误路径，记录字节与 `Object.keys` 键序逐位一致 | E=200 delta=**5120.9–5123.6ns**（~5.1µs）/eval 调用 = 端到端 0.12–0.13% | 淘汰：µs 级 ≥4 个量级低于落地线（S5-D-2/S7-D-5 同带噪声族；无反例但无意义） |

## 3. 关键裁决细节

### S8-D-1 / S8-D-2：内容完整性双门的成对裁决

第八遍的新透镜是把 `contentsByHash` 的**两道 O(bytes) 哈希门**分别
拎出来问是否可省——载入门（restore 逐 blob）与读门
（getActiveContent 每读再验）。答案是两道门谁都不能单独拆，理由
互为镜像：

1. **载入门是 `getContent` 消费者的唯一门**。`eval-routing.contentFor`
   经 `registry.getContent(contentHash)` 取 candidate/parent 政策字节，
   该读取**没有**再哈希。仿真：篡改配置态快照中 candidate blob 的
   政策内容（剥除全部 avoid 规则）但保留声明 hash——现行
   `loadAdaptationRegistry` 抛 `snapshot content hash mismatch`（eval
   入口 fail-closed）；消除变体静默载入，`getContent` 交出篡改字节，
   对同一任务集的 assignTasks 指派可观察发散（避免规则被剥除后
   test-family 任务改选被禁模型）。完整性门消除 = fail-open，自动
   否决；且其成本在配置态实测仅 153.8–154.1µs/load（119.5KB blobs），
   1MB 包络 2.53–2.59ms——即便按纯收益计也低于落地线 ≥2 个量级。
2. **读门可证死码，但它是 live 路径的最后切片内门**。两个写点
   （`putContent` 用刚算的 hash 作键；restore 校验后 set）共同保证
   map 不变式 `hash(get(k))===k`，故 getActiveContent 的再哈希在现行
   写点下**不可达**——600 探针 fuzz（含 hash32 碰撞晋升
   `hash32("Aa")===hash32("BB")` 与快照往返）0 次触发、逐位等价，
   还证明该门连碰撞都查不出（碰撞下 hash(get(k)) 仍 ===k）。但
   「可证死」依赖 S8-D-1 那道门存在：若载入门被弱化（正是 S8-D-1
   的提案方向），读门立即成为 live 路由路径（`loadLearnedRouting →
   getActiveContent`）在切片内的唯一拦截点。两门保护的消费面不相交
   （getContent=eval、getActiveContent=live），互为对方漂移时的
   后备——防御纵深不是冗余（S6-D-3/S4-D-4/S2-D-5 历轮同向）。收益
   13.4µs/read（9KB 政策）且 live 路径每进程仅一读，淘汰。

### S8-D-3：fsync = 原子保存契约的价格，不是可寻址成本

八轮以来 save+fsync 一直被当「ms 级 I/O 地板」引用，但从未有人把
**去掉 fsync** 本身作为候选点名裁决——第八遍补上这个缺口以收拢
save 分解。实测 delta 0.39–0.52ms/save（配置态 146.2KB 载荷），即
fsync 占 save 的 ~50–55%。裁决是契约性的：`open("wx") → writeFile →
sync → rename` 是原子保存的标准形态；去掉 sync 后「数据块落盘」与
「rename 元数据落盘」的次序不再有保证（POSIX rename 的原子性只在
命名空间层面；ext4 的 auto_da_alloc 等启发式不构成契约），断电后
registry.json 可为空/截断——把「crash 后必得旧字节或新字节」弱化为
「大概率」，正是授权指令点名的 crash-order widening 自动否决族。
且即便计入收益，0.39–0.52ms 仍低于数十 ms 落地线 ≥1.5 个量级，
两条理由各自独立充分。至此 save 路径分解闭合：fsync（契约价格）+
序列化/临时名/rename（S5-D-3/S7-D-3 已排除域）——save 侧再无未
点名成分。

### S8-D-4：预清除的死与活取决于异常序

`RollbackLog.restore` 自身先清后填，所以 `registry.restore()` 头部的
`rollbackLog.restore([])` 在成功路径上**确实是双清**（fuzz 证实成功
路径快照逐字节等价）。活路在异常序：restore 头部把全部集合清空的
动作发生在**读任何快照数据之前**，所以一次抛错的 restore（如
active-version-unknown）留下的是「全部清空」的一致失败态；消除预
清除后，rollback log 成为唯一保留前一 registry 数据的集合——对已
使用 registry 的失败 restore 之后，`rollbackLedger()` 公开面返回
陈旧记录（现行返回 []）。restore 是公开方法、可对在用实例调用，
该发散可达。收益上界 41.1–41.4ns，ns 级 + 失败路径一致性拓宽，
两条理由各自独立充分，淘汰。

### S8-D-5：可证等价但无意义

`parseEpisode` 的两个尾部条件展开逐条构造 300 试次 fuzz（含全部五类
校验错误路径）：变体（条件赋值）与现行字节、键序、错误信息逐位
一致——条件展开在 undefined 时本就不写键，属性存在性无差。E=200
实测 delta ~5.1µs/eval = 端到端 0.12–0.13%，距落地线 ≥4 个量级。与
S5-D-2（同文件 entries() 换索引循环，567–744ns）、S7-D-5（同文件
`??` 回退消除，~1.2–1.6µs）同带噪声族，淘汰。

## 4. 逐文件收口（第八遍新检查点，叠加 R1-D..R7-D 收口）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `registry.ts` | 见 S8-D-1/S8-D-2（contentsByHash 双哈希门成对裁决：载入门 fail-open 反例 + 读门可证死码但为 live 路径最后切片内门）与 S8-D-4（restore 异常序 = 预清除的活路）；S7-D-1/4、S6-D-1/2、S5-D-3、S1-D-5 维持 | 无候选落地 |
| `promotion.ts` | 见 S8-D-3（fsync = 原子保存契约价格，save 分解至此闭合）；S7-D-3、S6-D-4、S5-D-3/S4-G-6 域维持 | 无候选落地 |
| `promotion-rules.ts` | 第八遍无新角度：`assertRoutingPolicyEvalReport` 重哈希 = CAS fail-closed（X1-1 域）；intentIdFor O(1) 维持 | 无候选 |
| `candidate.ts` | `hashCandidateContent` 吞吐首次锚定：2.53–2.59ms/MB（S8-D-1 规模包络的分母）；hash32 本体在 domain/hash.ts（切片外） | 无候选 |
| `eval-routing.ts` | 见 S8-D-5（parseEpisode 条件展开 = 等价噪声）与 §1c 配置态锚点（无配置态悬崖；S1-D-4 旧否决理由配置态复核仍成立）；S7-D-2/5、S6-D-3/5、S1-D-4/9、S2-D-3/4、S3-D-3、S4-D-3/5、S5-D-2/4 全部维持不重开 | 无候选落地 |
| `pareto.ts` | 第八遍无新角度（S1-D-6/S3-D-2 维持；无生产调用方，grep 本轮复核） | 无候选 |
| `rollback.ts` | `RollbackLog.restore` 先清后填语义正是 S8-D-4「成功路径冗余/失败路径承重」的成因；S3-D-4/S4-D-2 维持 | 无候选 |
| `resource.ts` / `retirement.ts` / `active-pointer.ts` | 常量表 + O(1) 谓词 / 薄委托（无生产调用方，本轮复核）/ O(1) 纯函数——第八遍无新角度；S5-D-5 维持 | 无候选 |
| `monitor.ts` | **X2-5 维持排除未触碰**；S2-D-5/S3-D-5 维持；无生产调用方（grep 本轮复核） | 无候选 |
| `approval-profile.ts` | S4-D-4 维持；`isAutoAdaptEnabled` 每次读 env 是 kill-switch 语义（X1-1 域） | 无候选 |
| `reflection.ts` | §1b：穿透 S7-F-1/S7-F-2 后的 shadow.ts+plan.ts 重测 evaluateProposalShadow（1.3–1.4ms / 119.9–124.6ms，较 R7-D 快 ~25–35%，被调方收益穿透可见）；本体只做校验+委托，ms 级成本全在被调方（X4-1/S3-F-2/S2-F-1/S6-F-1/S7-F-1 辖区）；生产无调用方 | 无候选 |
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
`0xd88d01`–`0xd88d05`，两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
S0 default anchors: registry load=0.10–0.11ms save(+fsync)=0.39–0.45ms | adapt-eval end-to-end (E=200, toy policy)=4.05–4.33ms per invocation
S0b evaluateProposalShadow through S7-F-1/S7-F-2 shadow.ts+plan.ts: P=200 A=100 -> 1.3–1.4ms | P=2000 A=1000 -> 119.9–124.6ms per call
S0c configured anchors (registry.json=146.2KB, V=15 C=9 L=11 B=18 blobs=119.5KB, policy=9.2KB): load=0.57–0.71ms save(+fsync)=1.44ms | adapt-eval end-to-end (E=200, configured policy)=3.67–3.93ms per invocation
S8-D-1 counterexample (tampered candidate blob, avoid rules stripped): current load -> "snapshot content hash mismatch: 263d4a0a" | eliding variant -> <ok>, getContent serves tampered bytes, downstream assignTasks diverges
S8-D-1 anchor: configured-load blob verification (B=18, 119.5KB) = 153.8–154.1us per load = 21.7–26.9% of the configured load | 1MB scale envelope: hash32=2.53–2.59ms per MB
S8-D-2 equivalence: 300 trials x2 probes (incl. hash32-collision promotes and snapshot roundtrips) byte-identical; read-path re-hash fired 0 times
S8-D-2 anchor: configured policy (9.0KB) getActiveContent current=13621–13623ns variant=226ns delta=13394–13397ns per read | 64KB probe delta=178041–184999ns per read
S8-D-3 anchor (configured 146.2KB payload): save with fsync=0.73–0.98ms without fsync=0.34–0.46ms delta=0.39–0.52ms per save
S8-D-4 counterexample (failed restore onto a used registry): current rollbackLedger()=[] | pre-clear-eliding variant retains 1 stale entry -> mixed-state divergence on the failure path
S8-D-4 anchor: rollbackLog.restore([]) pre-clear = 41.1–41.4ns per restore
S8-D-5 equivalence: 300 trials (incl. every validation error path) byte- and key-order-identical | bench E=200 delta/eval-invocation=5120.9–5123.6ns
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-D-1 | `restore()` 逐 blob 内容再哈希消除 | 篡改反例：变体静默载入篡改快照，`getContent`（eval 消费面唯一门）交出篡改字节、下游 assignTasks 发散；现行 fail-closed。配置态实测 153.8–154.1µs/load（load 的 ~1/4）、1MB 包络 2.53–2.59ms——即便计收益也 µs 级 |
| S8-D-2 | `getActiveContent()` 读路径再哈希消除 | 可证死码（putContent 键构造 + restore 校验双写点保证 hash(get(k))===k；600 探针含碰撞 0 触发），但为 live 路径（loadLearnedRouting）切片内最后完整性门、与 restore 门成对防御纵深；13.4µs/read（9KB）距落地线 ≥3 个量级 |
| S8-D-3 | `saveAdaptationRegistry` 去 fsync | crash-order widening 自动否决：无 fsync 时 rename 与数据落盘次序无契约，断电后 registry.json 可空/截断（现行必得旧或新字节）；delta 0.39–0.52ms/save 即便计入也低于落地线 ≥1.5 个量级。save 分解至此闭合 |
| S8-D-4 | `restore()` 头部 `rollbackLog.restore([])` 预清除消除 | 失败路径反例：对在用 registry 的抛错 restore，现行全集合一致清空、变体独留前一 registry 陈旧 rollback 记录（公开 `rollbackLedger()` 可观察）；成功路径等价 fuzz 证实发散恰在异常序；收益上界 41.1–41.4ns |
| S8-D-5 | `parseEpisode` 尾部条件展开消除 | 等价可证（300 试次含全部错误路径字节+键序逐位一致），但 ~5.1µs/eval = 端到端 0.12–0.13%，距落地线 ≥4 个量级（S5-D-2/S7-D-5 同带噪声族） |

重开条件：S8-D-1 需内容哈希升级为抗碰撞加密哈希**且**显式决定
放弃载入期防篡改（安全决策，非性能问题）——即便如此现实规模收益
µs 级；S8-D-2 需先接受 S8-D-1（已否决）或以类型系统固化 map 不变式，
且收益仍 µs；S8-D-3 需原子保存契约显式放弃断电耐久性（行为决策）；
S8-D-4 需把失败 restore 的语义显式改为「保留旧 rollback 记录」或
restore 改全有全无事务（均属行为变更）；S8-D-5 需 E 增长 ≥4 个量级。
整片层面：唯一可能改变预算论证的仍是 E 增长 ≥2 个量级（继承 R3-D §6
… R7-D §7，届时首先重开的是 S6-D-5 的 ~45ms 外推单项，而非本轮任何
候选）；配置态维度经 §1c 首测后同样收口——政策/registry 规模再涨
1 个量级也只把 load/save 推到低两位数 ms，且全部是切片外 JSON/I-O
固有成本。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为仓库外任意 `.mts` 后 `npx tsx <file>`（顶层 await 需
ESM，`.mts` 强制 tsx 走 ESM；依赖已装）。seeds：`0xd88d01`–`0xd88d05`。

```ts
/**
 * R8-D deterministic equivalence + benchmark simulation (eighth pass).
 * Adjudicates fresh candidates S8-D-1 .. S8-D-5 against the current
 * implementations in src/adaptation/, re-verifies the R3-D..R7-D whole-slice
 * budget-domination argument with end-to-end anchors (default-state AND the
 * new configured-state anchor per the R7-I lesson), and re-measures
 * evaluateProposalShadow through the S7-F-1/S7-F-2-changed
 * experiments/{shadow,plan}.ts.
 * Seeded PRNG (mulberry32) -> reproducible. Seeds: 0xd88d01 - 0xd88d05.
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, readFile, rm, open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ResourceRegistry } from "/workspace/src/adaptation/registry.js";
import {
  promoteWithRegistry,
  parseRegistrySnapshot,
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  adaptationRegistryPath,
  type PendingPromotion,
  type PromoteInput,
  type PromotionLedgerEntry,
  type ResourceRegistrySnapshot
} from "/workspace/src/adaptation/promotion.js";
import { evalRoutingPolicy } from "/workspace/src/adaptation/eval-routing.js";
import { evaluateProposalShadow } from "/workspace/src/adaptation/reflection.js";
import { RollbackLog, type RollbackLedgerEntry } from "/workspace/src/adaptation/rollback.js";
import { resourceIdentityKey } from "/workspace/src/adaptation/active-pointer.js";
import { hashCandidateContent, type EvaluationPlan, type ImprovementCandidate } from "/workspace/src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "/workspace/src/adaptation/resource.js";
import {
  createProjectId,
  isCandidateId,
  isResourceVersionId,
  type CandidateId,
  type IdGenerator,
  type ResourceVersionId
} from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { DomainValidationError } from "/workspace/src/domain/errors.js";
import { hash32 } from "/workspace/src/domain/hash.js";
import { isAgentRole, type AgentRole } from "/workspace/src/domain/roles.js";
import { parseTaskId } from "/workspace/src/domain/ids.js";
import { isRecord } from "/workspace/src/domain/record.js";
import type { ExperimentPlan } from "/workspace/src/experiments/plan.js";
import type { ExperimentOutcome } from "/workspace/src/experiments/shadow.js";
import { parseLearnedRoutingPolicy } from "/workspace/src/learning/learned-routing.js";
import { assignTasks } from "/workspace/src/routing/assign.js";
import { catalogFromPrimary } from "/workspace/src/routing/primary-catalog.js";

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

/* Configured-state policies (R7-I lesson): 40 avoid + 40 prefer + 7
 * assignments each, several KB of JSON — a learned-routing-present catalog
 * instead of the toy near-empty policy. Rules reference the REAL catalog
 * model id ("cheap") so they bind inside assignTasks. */
function configuredPolicy(variantTag: string): string {
  const avoid = Array.from({ length: 40 }, (_, i) => ({
    modelId: i % 8 === 0 ? "cheap" : `m${i % 7}`,
    family: i % 3 === 0 ? pick(() => (i % 10) / 10, ["edit", "test", "review"]) : `fam${i % 12}`,
    reason: `deterministic FAIL pattern ${i} (${variantTag}): attributable replay regression observed across paired episodes with stable family-level attribution`
  }));
  const prefer = Array.from({ length: 40 }, (_, i) => ({
    family: i % 4 === 0 ? "test" : `fam${i % 12}`,
    modelId: i % 4 === 0 ? "cheap" : `m${(i + 1) % 7}`
  }));
  const assignments = Array.from({ length: 7 }, (_, i) => ({
    role: ["planner", "executor", "tester", "reviewer", "scout", "debugger", "worker"][i] as string,
    model: i % 2 === 0 ? "premium" : "cheap",
    family: ["edit", "test", "review"][i % 3] as string
  }));
  if (variantTag === "candidate") {
    avoid.push({ modelId: "cheap", family: "refactor", reason: "candidate-only: deterministic FAIL on refactor replay (new attribution)" });
  }
  return JSON.stringify({ primaryModelId: "premium", avoid, prefer, assignments });
}
const CONFIGURED_BASELINE_POLICY = configuredPolicy("baseline");
const CONFIGURED_CANDIDATE_POLICY = configuredPolicy("candidate");

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

function buildRoutingRegistry(
  tag: string,
  baselinePolicy = BASELINE_POLICY,
  candidatePolicy = CANDIDATE_POLICY
): { registry: ResourceRegistry; candidateId: CandidateId } {
  const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
  const identity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
  };
  const baseline = registry.registerBaseline({ identity, content: baselinePolicy, author: HUMAN });
  const candidate = registry.createCandidate({
    identity,
    content: candidatePolicy,
    parentVersionId: baseline.versionId,
    author: HUMAN,
    evaluationPlan: EVAL_PLAN
  });
  return { registry, candidateId: candidate.candidateId };
}

/* Configured-state registry: routing pair on KB-scale policies plus 8 prompt
 * identities with KB-scale contents, 5 explicit-approval promotes (10 ledger
 * entries), 1 pending begin, 1 degradation proposal + 1 user rollback
 * (rollback ledger), 2 retired versions. B=18 content blobs. */
function buildConfiguredRegistry(tag: string): { registry: ResourceRegistry; candidateId: CandidateId } {
  const { registry, candidateId } = buildRoutingRegistry(tag, CONFIGURED_BASELINE_POLICY, CONFIGURED_CANDIDATE_POLICY);
  const versions: { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion }[] = [];
  for (let i = 0; i < 8; i += 1) {
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: `agent-prompt-${i}`,
      scope: { kind: "project", projectId: createProjectId(() => `${tag}proj`) }
    };
    const body = `# prompt ${i}\n${`Follow the review checklist, cite evidence for every claim, and keep the diff bounded to the stated scope (${i}).\n`.repeat(30 + i * 8)}`;
    const v1 = registry.registerBaseline({ identity, content: body, author: HUMAN });
    const candidate = registry.createCandidate({
      identity,
      content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
      parentVersionId: v1.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const entry: { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion } = { identity, v1 };
    if (i < 5) {
      const result = promoteWithRegistry(registry, {
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: v1.versionId,
        content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
        approvedBy: HUMAN,
        review: mkReview(candidate.candidateId, candidate.contentHash, `${tag}p${i}`),
        changeNote: mkNote(`prompt:${tag}${i}`, v1.versionId),
        explicitApproval: true
      });
      entry.v2 = result.newVersion as ResourceVersion;
    } else if (i === 5) {
      registry.beginPromotion({
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: v1.versionId,
        content: `${body}\n## amendment ${i}\nAdd an explicit check for the attributable failure.\n`,
        approvedBy: HUMAN,
        review: mkReview(candidate.candidateId, candidate.contentHash, `${tag}p${i}`),
        changeNote: mkNote(`prompt:${tag}${i}`, v1.versionId),
        explicitApproval: true
      });
    }
    versions.push(entry);
  }
  const first = versions[0] as { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion };
  registry.rollback({
    identity: first.identity,
    expectedCurrentVersionId: (first.v2 as ResourceVersion).versionId,
    targetVersionId: first.v1.versionId,
    reason: "degradation",
    evidence: ["ev:configured-degradation"],
    automatic: false
  });
  const second = versions[1] as { identity: ResourceIdentity; v1: ResourceVersion; v2?: ResourceVersion };
  registry.rollback({
    identity: second.identity,
    expectedCurrentVersionId: (second.v2 as ResourceVersion).versionId,
    targetVersionId: second.v1.versionId,
    reason: "user",
    evidence: ["ev:configured-user"],
    automatic: false
  });
  registry.retire((versions[2] as { v1: ResourceVersion }).v1.versionId);
  registry.retire((versions[3] as { v1: ResourceVersion }).v1.versionId);
  return { registry, candidateId };
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
  const manifest = { datasetId: "ds-r8d", environmentVersion: "env-1", episodes: eps };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/* Runtime access to registry internals for VERBATIM restore/getActiveContent
 * variant replicas. The replicas below copy the current method bodies
 * line-for-line, with only the candidate's elision applied. */
interface RegistryInternals {
  versionsById: Map<ResourceVersionId, ResourceVersion>;
  versionsByKey: Map<string, readonly ResourceVersion[]>;
  activeByKey: Map<string, ResourceVersionId>;
  candidates: Map<CandidateId, ImprovementCandidate>;
  ledgerEntries: PromotionLedgerEntry[];
  pendingByIntent: Map<string, PendingPromotion>;
  rollbackLog: RollbackLog;
  retiredIds: Set<ResourceVersionId>;
  contentsByHash: Map<string, string>;
  autoPromoteCount: number;
}
function internalsOf(registry: ResourceRegistry): RegistryInternals {
  return registry as unknown as RegistryInternals;
}

/** Verbatim replica of ResourceRegistry.restore with two switchable elisions. */
function restoreReplica(
  registry: ResourceRegistry,
  snapshot: ResourceRegistrySnapshot,
  opts: { blobCheck: boolean; preclearRollback: boolean }
): void {
  const self = internalsOf(registry);
  const addVersion = (version: ResourceVersion): void => {
    self.versionsById.set(version.versionId, version);
    const key = resourceIdentityKey(version.identity);
    const existing = self.versionsByKey.get(key) ?? [];
    self.versionsByKey.set(key, [...existing, version]);
  };
  self.versionsById.clear();
  self.versionsByKey.clear();
  self.activeByKey.clear();
  self.candidates.clear();
  self.ledgerEntries.length = 0;
  if (opts.preclearRollback) {
    self.rollbackLog.restore([]);
  }
  self.retiredIds.clear();
  self.contentsByHash.clear();
  self.autoPromoteCount = snapshot.autoPromotionsUsed;
  for (const blob of snapshot.contents ?? []) {
    if (opts.blobCheck && hashCandidateContent(blob.content) !== blob.hash) {
      throw new DomainValidationError(`snapshot content hash mismatch: ${blob.hash}`);
    }
    self.contentsByHash.set(blob.hash, blob.content);
  }
  for (const version of snapshot.versions) {
    if (!isResourceVersionId(version.versionId)) {
      throw new DomainValidationError(`invalid version id in snapshot: ${String(version.versionId)}`);
    }
    addVersion(version);
  }
  for (const versionId of snapshot.activeVersionIds) {
    const version = self.versionsById.get(versionId);
    if (version === undefined) {
      throw new DomainValidationError(`snapshot active version is unknown: ${String(versionId)}`);
    }
    self.activeByKey.set(resourceIdentityKey(version.identity), version.versionId);
  }
  for (const candidate of snapshot.candidates) {
    if (!isCandidateId(candidate.candidateId)) {
      throw new DomainValidationError(`invalid candidate id in snapshot: ${String(candidate.candidateId)}`);
    }
    self.candidates.set(candidate.candidateId, candidate);
  }
  self.ledgerEntries.push(...snapshot.ledger);
  for (const pending of snapshot.pending) {
    if (!self.versionsById.has(pending.pendingVersionId)) {
      throw new DomainValidationError(
        `snapshot pending version is unknown: ${String(pending.pendingVersionId)}`
      );
    }
    self.pendingByIntent.set(pending.intentId, pending);
  }
  self.rollbackLog.restore(snapshot.rollbackLedger ?? []);
  for (const versionId of snapshot.retiredVersionIds ?? []) {
    if (!isResourceVersionId(versionId)) {
      throw new DomainValidationError(`invalid retired version id in snapshot: ${String(versionId)}`);
    }
    if (!self.versionsById.has(versionId)) {
      throw new DomainValidationError(`snapshot retired version is unknown: ${String(versionId)}`);
    }
    self.retiredIds.add(versionId);
  }
}

/** Verbatim replica of getActiveContent minus the read-path re-hash. */
function getActiveContentNoRehash(
  registry: ResourceRegistry,
  identity: ResourceIdentity
): { readonly version: ResourceVersion; readonly content: string } | undefined {
  const self = internalsOf(registry);
  const activeId = self.activeByKey.get(resourceIdentityKey(identity));
  if (activeId === undefined) return undefined;
  const version = self.versionsById.get(activeId);
  if (version === undefined) return undefined;
  const content = self.contentsByHash.get(version.contentHash);
  if (content === undefined) return undefined;
  return { version, content };
}

/* ============================================================
 * Section 0: whole-slice budget re-verification (R4-D..R7-D S0 recheck),
 * default-state anchors: registry load / save(+fsync) / adapt-eval E=200.
 * ============================================================ */
const workRoot = await mkdtemp(join(tmpdir(), "r8d-sim-"));
let evalMsAnchor = 0;
let saveMsAnchor = 0;
let configuredLoadMsAnchor = 0;
{
  const rng = mulberry32(0xd88d01);
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
    `S0 default anchors: registry load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200, toy policy)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * Section 0b: evaluateProposalShadow wall clock re-measured THROUGH the
 * S7-F-1/S7-F-2-changed experiments/{shadow,plan}.ts (in-slice caller has no
 * production callers; per-step restore cost is callee-side —
 * X4-1/S3-F-2/S2-F-1/S6-F-1/S7-F-1 domain — measured only to document the
 * post-S7-F profile reachable through the slice).
 * ============================================================ */
{
  const mkPlan = (p: number, a: number): ExperimentPlan => ({
    planVersion: 1,
    experimentId: "exp_r8d-shadow",
    mode: "shadow",
    baselineVersionId: "rsv_r8d0001" as ResourceVersionId,
    candidateId: "cnd_r8d0002" as CandidateId,
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
      `S0b evaluateProposalShadow through S7-F-1/S7-F-2 shadow.ts+plan.ts: P=${p} A=${a} -> ${ms.toFixed(1)}ms per call (test-only; per-step restore cost is callee-side)`
    );
  }
}

/* ============================================================
 * Section 0c (NEW, R7-I lesson): configured-state anchors. A learned-routing
 * policy with 40 avoid + 40 prefer + 7 assignments (KB-scale JSON, rules
 * bound to real catalog ids), plus a registry with 9 identities, 5 promotes,
 * 1 pending intent, rollback ledger entries, retired versions and B=18
 * KB-scale content blobs — instead of the default-state toy fixture.
 * Anchors: load / save(+fsync) / eval E=200.
 * ============================================================ */
let configuredContents: readonly { readonly hash: string; readonly content: string }[] = [];
{
  const rng = mulberry32(0xd88d02);
  const stateRoot = join(workRoot, "state-configured");
  const { registry, candidateId } = buildConfiguredRegistry("c0");
  await saveAdaptationRegistry(stateRoot, registry);
  const raw = await readFile(adaptationRegistryPath(stateRoot), "utf8");
  const snapshot = registry.snapshot();
  configuredContents = snapshot.contents ?? [];
  const totalBlobBytes = configuredContents.reduce((sum, blob) => sum + blob.content.length, 0);
  const datasetDir = join(workRoot, "dataset-configured");
  await writeDataset(datasetDir, 200, rng);

  const loadMs = await benchAsync(async () => {
    await loadAdaptationRegistry(stateRoot);
  }, 30);
  configuredLoadMsAnchor = loadMs;
  const saveMs = await benchAsync(async () => {
    await saveAdaptationRegistry(stateRoot, registry);
  }, 30);
  const evalMs = await benchAsync(async () => {
    await evalRoutingPolicy({ stateRoot, candidateId, datasetDir });
  }, 20);
  console.log(
    `S0c configured anchors (registry.json=${(raw.length / 1024).toFixed(1)}KB, V=${snapshot.versions.length} C=${snapshot.candidates.length} L=${snapshot.ledger.length} B=${configuredContents.length} blobs=${(totalBlobBytes / 1024).toFixed(1)}KB, policy=${(CONFIGURED_CANDIDATE_POLICY.length / 1024).toFixed(1)}KB): load=${loadMs.toFixed(2)}ms save(+fsync)=${saveMs.toFixed(2)}ms | adapt-eval end-to-end (E=200, configured policy)=${evalMs.toFixed(2)}ms per invocation`
  );
}

/* ============================================================
 * S8-D-1: restore() per-blob content re-hash elision
 * (`hashCandidateContent(blob.content) !== blob.hash` inside the contents
 * loop — "the parser already validated shape; the hash is O(bytes) per
 * load"). Distinct site from S5-D-1 (id re-validation of parser products).
 * Deterministic counterexample: a tampered snapshot blob loads silently in
 * the eliding variant and its bytes flow to registry.getContent — which is
 * exactly what eval-routing's contentFor consumes — while current load
 * fails closed at the entry. Anchor: blob-verification cost per configured
 * load + 1MB scale envelope.
 * ============================================================ */
{
  const { registry, candidateId } = buildConfiguredRegistry("d1");
  const candidate = registry.getCandidate(candidateId) as ImprovementCandidate;
  const clean = JSON.parse(JSON.stringify(registry.snapshot())) as Record<string, unknown>;
  const tampered = JSON.parse(JSON.stringify(clean)) as { contents: { hash: string; content: string }[] };
  const target = tampered.contents.find((blob) => blob.hash === candidate.contentHash);
  check("S8-D-1 setup: candidate blob present in snapshot", target !== undefined);
  const originalBytes = (target as { content: string }).content;
  const tamperedPolicy = JSON.parse(originalBytes) as { avoid: unknown[] };
  tamperedPolicy.avoid = []; // strip every learned avoid rule; keep declared hash
  (target as { content: string }).content = JSON.stringify(tamperedPolicy);
  check(
    "S8-D-1 setup: tampered bytes hash differently under the declared hash",
    hashCandidateContent((target as { content: string }).content) !== candidate.contentHash
  );

  let currentOutcome = "<ok>";
  try {
    ResourceRegistry.fromSnapshot(parseRegistrySnapshot(tampered), { now: () => NOW, generateId: sequentialIds("d1x") });
  } catch (error) {
    currentOutcome = (error as Error).message;
  }
  const variant = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("d1y") });
  let variantOutcome = "<ok>";
  try {
    restoreReplica(variant, parseRegistrySnapshot(tampered), { blobCheck: false, preclearRollback: true });
  } catch (error) {
    variantOutcome = (error as Error).message;
  }
  const servedBytes = variant.getContent(candidate.contentHash);
  check("S8-D-1 counterexample: current load fails closed on the tampered blob", /snapshot content hash mismatch/.test(currentOutcome));
  check("S8-D-1 counterexample: eliding variant loads silently", variantOutcome === "<ok>");
  check("S8-D-1 counterexample: variant getContent serves tampered bytes", servedBytes !== undefined && servedBytes !== originalBytes);

  // The served bytes are what eval-routing's contentFor consumes: replay the
  // candidate policy original vs tampered and show the assignments diverge.
  const catalog = catalogFromPrimary({ primaryModelId: "premium" });
  const probeRoles: readonly AgentRole[] = ["tester", "worker", "reviewer", "planner", "scout"];
  const tasks = probeRoles.map((role, i) => ({
    taskId: parseTaskId(`tsk_d1probe${i}`),
    role,
    objective: OBJECTIVES[i % OBJECTIVES.length] as string
  }));
  const withPolicy = (content: string) => assignTasks({ catalog, tasks, learned: parseLearnedRoutingPolicy(content) });
  const originalAssign = JSON.stringify(withPolicy(originalBytes));
  const tamperedAssign = JSON.stringify(withPolicy(servedBytes as string));
  check("S8-D-1 counterexample: tampered policy changes replay assignments downstream", originalAssign !== tamperedAssign);
  console.log(
    `S8-D-1 counterexample (tampered candidate blob, avoid rules stripped): current load -> "${currentOutcome}" | eliding variant -> ${variantOutcome}, getContent serves tampered bytes, downstream assignTasks diverges (fail-open through the eval consumption path; live-read path would fail later only via the S8-D-2 gate)`
  );

  const verifyLoop = () => {
    for (const blob of configuredContents) {
      if (hashCandidateContent(blob.content) !== blob.hash) {
        throw new DomainValidationError("unreachable in this bench");
      }
    }
  };
  const verifyMs = bench(verifyLoop, 2000);
  const megabyte = "x".repeat(1024 * 1024);
  const mbHashMs = bench(() => {
    hashCandidateContent(megabyte);
  }, 50);
  console.log(
    `S8-D-1 anchor: configured-load blob verification (B=${configuredContents.length}, ${(configuredContents.reduce((s, b) => s + b.content.length, 0) / 1024).toFixed(1)}KB) = ${(verifyMs * 1e3).toFixed(1)}us per load = ${((verifyMs / configuredLoadMsAnchor) * 100).toFixed(1)}% of the ${configuredLoadMsAnchor.toFixed(2)}ms configured load | 1MB scale envelope: hash32=${mbHashMs.toFixed(2)}ms per MB`
  );
}

/* ============================================================
 * S8-D-2: getActiveContent() read-path re-hash elision. Under the two write
 * sites (putContent keys the map by the hash it just computed; restore
 * verifies every blob) the map invariant hash(get(k)) === k holds, so the
 * read-path check is provably unreachable — even hash32 collisions pass it
 * (S7-D-1(b) pair). Equivalence fuzz incl. the collision pair + snapshot
 * roundtrips; anchor: re-hash cost per read at configured policy size and a
 * 64KB probe. The live routing path (learning/loadLearnedRouting) calls this
 * once per load and re-hashes AGAIN out-of-slice — a third gate.
 * ============================================================ */
{
  const rng = mulberry32(0xd88d03);
  let mismatchThrows = 0;
  let probes = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const tag = `e${trial}x`;
    const registry = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds(tag) });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => `${tag}p`) }
    };
    const contentPool = ["v1", "Aa", `long-${"y".repeat(Math.floor(rng() * 4096))}`, "{}"];
    const v1 = registry.registerBaseline({ identity, content: pick(rng, contentPool), author: HUMAN });
    let active = v1;
    if (rng() < 0.7) {
      const isCollision = rng() < 0.15;
      const candContent = isCollision ? "Aa" : `v2-${trial}`;
      const promoteContent = isCollision ? "BB" : candContent; // hash32("Aa")===hash32("BB")
      const candidate = registry.createCandidate({
        identity,
        content: candContent,
        parentVersionId: v1.versionId,
        author: HUMAN,
        evaluationPlan: EVAL_PLAN
      });
      const result = promoteWithRegistry(registry, {
        candidateId: candidate.candidateId,
        expectedCurrentVersionId: v1.versionId,
        content: promoteContent,
        approvedBy: HUMAN,
        review: mkReview(candidate.candidateId, candidate.contentHash, tag),
        changeNote: mkNote(`prompt:${tag}`, v1.versionId),
        explicitApproval: true
      });
      active = result.newVersion as ResourceVersion;
      if (rng() < 0.3) {
        registry.rollback({
          identity,
          expectedCurrentVersionId: active.versionId,
          targetVersionId: v1.versionId,
          reason: "user",
          evidence: ["ev"],
          automatic: false
        });
      }
    }
    const subject = rng() < 0.5
      ? registry
      : ResourceRegistry.fromSnapshot(
          parseRegistrySnapshot(JSON.parse(JSON.stringify(registry.snapshot())) as ResourceRegistrySnapshot),
          { now: () => NOW, generateId: sequentialIds(`${tag}z`) }
        );
    const missingIdentity: ResourceIdentity = { ...identity, name: "missing" };
    for (const probe of [identity, missingIdentity]) {
      probes += 1;
      let current: string;
      try {
        current = JSON.stringify(subject.getActiveContent(probe) ?? null);
      } catch (error) {
        current = `<err:${(error as Error).message}>`;
        if (/hash mismatch/.test(current)) mismatchThrows += 1;
      }
      const variant = JSON.stringify(getActiveContentNoRehash(subject, probe) ?? null);
      check("S8-D-2 equivalence (re-hash elided)", current === variant, `trial ${trial}: ${current} vs ${variant}`);
    }
  }
  check("S8-D-2 unreachability: the read-path re-hash never fired across the fuzz", mismatchThrows === 0, String(mismatchThrows));
  check("S8-D-2 fuzz coverage", probes === 600, String(probes));

  // Collision probe: the check passes even on divergent bytes with equal hashes.
  check("S8-D-2 collision pair still holds", hash32("Aa") === hash32("BB"));
  console.log(
    `S8-D-2 equivalence: 300 trials x2 probes (incl. hash32-collision promotes and snapshot roundtrips) byte-identical; read-path re-hash fired 0 times (provably dead under putContent/restore invariants; it cannot catch collisions either — hash(get(k))===k by construction)`
  );

  const { registry: cfg } = buildConfiguredRegistry("e8");
  const routingIdentity: ResourceIdentity = {
    kind: "routing-policy",
    name: "learned-routing",
    scope: { kind: "project", projectId: createProjectId(() => "e8proj") }
  };
  const cur = bench(() => {
    cfg.getActiveContent(routingIdentity);
  }, 20000);
  const variantCost = bench(() => {
    getActiveContentNoRehash(cfg, routingIdentity);
  }, 20000);
  const big = new ResourceRegistry({ now: () => NOW, generateId: sequentialIds("e9") });
  const bigIdentity: ResourceIdentity = {
    kind: "prompt",
    name: "big-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "e9p") }
  };
  big.registerBaseline({ identity: bigIdentity, content: "z".repeat(64 * 1024), author: HUMAN });
  const cur64 = bench(() => {
    big.getActiveContent(bigIdentity);
  }, 5000);
  const variant64 = bench(() => {
    getActiveContentNoRehash(big, bigIdentity);
  }, 5000);
  console.log(
    `S8-D-2 anchor: configured policy (${(CONFIGURED_BASELINE_POLICY.length / 1024).toFixed(1)}KB) getActiveContent current=${(cur * 1e6).toFixed(0)}ns variant=${(variantCost * 1e6).toFixed(0)}ns delta=${((cur - variantCost) * 1e6).toFixed(0)}ns per read | 64KB probe delta=${((cur64 - variant64) * 1e6).toFixed(0)}ns per read (live path re-hashes again out-of-slice in loadLearnedRouting)`
  );
}

/* ============================================================
 * S8-D-3: saveAdaptationRegistry fsync elision (drop handle.sync() before
 * rename). The only remaining ms-scale single component in the slice.
 * Anchor: save replica with vs without sync. Adjudication is contractual:
 * rename durability without fsync is filesystem-dependent write-order
 * WIDENING (post-crash empty/short registry.json where current always
 * recovers old-or-new bytes) — the mandate's automatic-reject family. No
 * userspace sim can reproduce a power loss; the ordering contract plus the
 * anchor decide.
 * ============================================================ */
{
  async function saveReplica(path: string, serialized: string, withSync: boolean): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "wx");
    try {
      await handle.writeFile(serialized, "utf8");
      if (withSync) {
        await handle.sync();
      }
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
  const { registry } = buildConfiguredRegistry("f0");
  const serialized = `${JSON.stringify(registry.snapshot(), null, 2)}\n`;
  const dir = join(workRoot, "d3");
  const path = join(dir, "registry.json");
  const withSyncMs = await benchAsync(async () => {
    await saveReplica(path, serialized, true);
  }, 30);
  const withoutSyncMs = await benchAsync(async () => {
    await saveReplica(path, serialized, false);
  }, 30);
  console.log(
    `S8-D-3 anchor (configured ${(serialized.length / 1024).toFixed(1)}KB payload): save with fsync=${withSyncMs.toFixed(2)}ms without fsync=${withoutSyncMs.toFixed(2)}ms delta=${(withSyncMs - withoutSyncMs).toFixed(2)}ms per save (delta IS the crash-durability contract; elision = write-order widening, automatic reject)`
  );
}

/* ============================================================
 * S8-D-4: restore() early rollbackLog.restore([]) pre-clear elision
 * ("RollbackLog.restore already clears before repopulating — the first call
 * is a dead double-clear"). True on the success path, false on the failure
 * path: every collection cleared at the top of restore() is emptied before
 * any snapshot data is read, so a THROWING restore leaves them cleared —
 * except, under the elision, the rollback log, which uniquely retains the
 * PREVIOUS registry's entries. Deterministic counterexample through the
 * public surface; success-path equivalence; ns anchor.
 * ============================================================ */
{
  const buildPrestate = (tag: string): ResourceRegistry => {
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
    registry.rollback({
      identity,
      expectedCurrentVersionId: (result.newVersion as ResourceVersion).versionId,
      targetVersionId: v1.versionId,
      reason: "degradation",
      evidence: ["ev:g4"],
      automatic: false
    });
    check(`S8-D-4 setup(${tag}): pre-state carries one rollback-proposed entry`, registry.rollbackLedger().length === 1);
    return registry;
  };

  const donor = buildRoutingRegistry("g4d").registry;
  const badSnapshot = JSON.parse(JSON.stringify(donor.snapshot())) as { activeVersionIds: string[] };
  badSnapshot.activeVersionIds = ["rsv_zz990001"]; // valid format, unknown version -> restore throws after the pre-clear
  const parsedBad = parseRegistrySnapshot(badSnapshot);

  const currentRegistry = buildPrestate("g4a");
  let currentOutcome = "<ok>";
  try {
    currentRegistry.restore(parsedBad);
  } catch (error) {
    currentOutcome = (error as Error).message;
  }
  const variantRegistry = buildPrestate("g4b");
  let variantOutcome = "<ok>";
  try {
    restoreReplica(variantRegistry, parsedBad, { blobCheck: true, preclearRollback: false });
  } catch (error) {
    variantOutcome = (error as Error).message;
  }
  check("S8-D-4 both restores fail closed on the unknown active version", /active version is unknown/.test(currentOutcome) && currentOutcome === variantOutcome, `${currentOutcome} vs ${variantOutcome}`);
  const currentLedger = currentRegistry.rollbackLedger();
  const variantLedger = variantRegistry.rollbackLedger();
  check("S8-D-4 counterexample: current failed restore leaves the rollback log cleared", currentLedger.length === 0, String(currentLedger.length));
  check("S8-D-4 counterexample: eliding variant retains the PREVIOUS registry's rollback entries", variantLedger.length === 1, String(variantLedger.length));
  console.log(
    `S8-D-4 counterexample (failed restore onto a used registry): current rollbackLedger()=[] | pre-clear-eliding variant rollbackLedger() retains ${variantLedger.length} stale entr(y/ies) from the previous registry -> mixed-state divergence on the failure path (all other collections were already cleared)`
  );

  // Success-path equivalence: identical pre-states, good snapshot, real vs replica.
  const goodSnapshot = parseRegistrySnapshot(JSON.parse(JSON.stringify(buildConfiguredRegistry("g4s").registry.snapshot())) as ResourceRegistrySnapshot);
  const okCurrent = buildPrestate("g4c");
  const okVariant = buildPrestate("g4e");
  okCurrent.restore(goodSnapshot);
  restoreReplica(okVariant, goodSnapshot, { blobCheck: true, preclearRollback: false });
  check(
    "S8-D-4 success-path equivalence: snapshots byte-identical after restore",
    JSON.stringify(okCurrent.snapshot()) === JSON.stringify(okVariant.snapshot())
  );

  const log = new RollbackLog();
  for (let i = 0; i < 3; i += 1) {
    log.append({
      kind: "rollback-proposed",
      fromVersionId: "rsv_g4bb0001" as ResourceVersionId,
      toVersionId: "rsv_g4bb0002" as ResourceVersionId,
      reason: "degradation",
      automatic: false,
      evidence: ["ev"],
      at: NOW
    } as RollbackLedgerEntry);
  }
  const clearCost = bench(() => {
    log.restore([]);
  }, 200000);
  console.log(`S8-D-4 anchor: rollbackLog.restore([]) pre-clear = ${(clearCost * 1e6).toFixed(1)}ns per restore (upper bound of any gain)`);
}

/* ============================================================
 * S8-D-5: parseEpisode conditional-spread elimination
 * ({...(x !== undefined ? {k: x} : {})} tail spreads -> build the base
 * object once and conditionally assign). Property presence and order are
 * identical (absent key in both shapes when undefined); equivalence fuzz
 * incl. every validation error path; E=200 bench of the construction delta.
 * ============================================================ */
{
  const rng = mulberry32(0xd88d05);
  interface EpisodeShape {
    readonly episodeHash: string;
    readonly taskId: string;
    readonly role: AgentRole;
    readonly objective: string;
    readonly taskFamily?: string | undefined;
    readonly taskSuccess?: "PASS" | "FAIL" | undefined;
    readonly originalWorkspace: string;
  }
  // Verbatim replica of eval-routing parseEpisode (current form).
  function parseEpisodeCurrent(value: unknown, index: number): EpisodeShape {
    if (!isRecord(value)) {
      throw new DomainValidationError(`dataset episodes[${index}] must be an object`);
    }
    if (typeof value.episodeHash !== "string" || value.episodeHash.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires episodeHash`);
    }
    if (typeof value.taskId !== "string") {
      throw new DomainValidationError(`dataset episodes[${index}] requires taskId`);
    }
    parseTaskId(value.taskId);
    if (!isAgentRole(value.role)) {
      throw new DomainValidationError(`dataset episodes[${index}] has invalid role`);
    }
    if (typeof value.objective !== "string" || value.objective.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires objective`);
    }
    if (typeof value.originalWorkspace !== "string" || value.originalWorkspace.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires originalWorkspace`);
    }
    let taskSuccess: "PASS" | "FAIL" | undefined;
    if (value.taskSuccess !== undefined) {
      if (value.taskSuccess !== "PASS" && value.taskSuccess !== "FAIL") {
        throw new DomainValidationError(
          `dataset episodes[${index}] taskSuccess must be PASS or FAIL when present`
        );
      }
      taskSuccess = value.taskSuccess;
    }
    const taskFamily =
      typeof value.taskFamily === "string" && value.taskFamily.trim() !== ""
        ? value.taskFamily
        : undefined;
    return {
      episodeHash: value.episodeHash,
      taskId: value.taskId,
      role: value.role,
      objective: value.objective,
      originalWorkspace: value.originalWorkspace,
      ...(taskFamily !== undefined ? { taskFamily } : {}),
      ...(taskSuccess !== undefined ? { taskSuccess } : {})
    };
  }
  // Candidate: same validation, tail spreads replaced by conditional assignment.
  function parseEpisodeVariant(value: unknown, index: number): EpisodeShape {
    if (!isRecord(value)) {
      throw new DomainValidationError(`dataset episodes[${index}] must be an object`);
    }
    if (typeof value.episodeHash !== "string" || value.episodeHash.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires episodeHash`);
    }
    if (typeof value.taskId !== "string") {
      throw new DomainValidationError(`dataset episodes[${index}] requires taskId`);
    }
    parseTaskId(value.taskId);
    if (!isAgentRole(value.role)) {
      throw new DomainValidationError(`dataset episodes[${index}] has invalid role`);
    }
    if (typeof value.objective !== "string" || value.objective.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires objective`);
    }
    if (typeof value.originalWorkspace !== "string" || value.originalWorkspace.trim() === "") {
      throw new DomainValidationError(`dataset episodes[${index}] requires originalWorkspace`);
    }
    let taskSuccess: "PASS" | "FAIL" | undefined;
    if (value.taskSuccess !== undefined) {
      if (value.taskSuccess !== "PASS" && value.taskSuccess !== "FAIL") {
        throw new DomainValidationError(
          `dataset episodes[${index}] taskSuccess must be PASS or FAIL when present`
        );
      }
      taskSuccess = value.taskSuccess;
    }
    const taskFamily =
      typeof value.taskFamily === "string" && value.taskFamily.trim() !== ""
        ? value.taskFamily
        : undefined;
    const episode: {
      episodeHash: string;
      taskId: string;
      role: AgentRole;
      objective: string;
      originalWorkspace: string;
      taskFamily?: string;
      taskSuccess?: "PASS" | "FAIL";
    } = {
      episodeHash: value.episodeHash,
      taskId: value.taskId,
      role: value.role,
      objective: value.objective,
      originalWorkspace: value.originalWorkspace
    };
    if (taskFamily !== undefined) episode.taskFamily = taskFamily;
    if (taskSuccess !== undefined) episode.taskSuccess = taskSuccess;
    return episode;
  }

  const mkRaw = (i: number, mode: number): unknown => {
    if (mode === 1) return "not-an-object";
    const base: Record<string, unknown> = {
      episodeHash: `eh_${i}`,
      taskId: `tsk_s5_${i}`,
      role: pick(rng, ROLES),
      objective: pick(rng, OBJECTIVES),
      originalWorkspace: "/repos/alpha"
    };
    if (mode === 2) base.episodeHash = "  ";
    if (mode === 3) base.role = "chief-vibes-officer";
    if (mode === 4) base.taskSuccess = "MAYBE";
    if (mode === 5) base.objective = "";
    if (rng() < 0.5) base.taskFamily = rng() < 0.2 ? "  " : pick(rng, ["edit", "test", "review"]);
    if (rng() < 0.6) base.taskSuccess = base.taskSuccess ?? (rng() < 0.5 ? "PASS" : "FAIL");
    return base;
  };
  for (let trial = 0; trial < 300; trial += 1) {
    const mode = Math.floor(rng() * 7); // ~29% error-path probes
    const raw = mkRaw(trial, mode <= 5 ? mode : 0);
    let current: string;
    let variant: string;
    try {
      const parsed = parseEpisodeCurrent(raw, trial);
      current = `${JSON.stringify(parsed)}|keys:${Object.keys(parsed).join(",")}`;
    } catch (error) {
      current = `<err:${(error as Error).message}>`;
    }
    try {
      const parsed = parseEpisodeVariant(raw, trial);
      variant = `${JSON.stringify(parsed)}|keys:${Object.keys(parsed).join(",")}`;
    } catch (error) {
      variant = `<err:${(error as Error).message}>`;
    }
    check("S8-D-5 equivalence (bytes + key order + error paths)", current === variant, `trial ${trial}`);
  }

  const E = 200;
  const raws = Array.from({ length: E }, (_, i) => mkRaw(i, 0));
  const cur = bench(() => {
    raws.map((raw, index) => parseEpisodeCurrent(raw, index));
  }, 5000);
  const cand = bench(() => {
    raws.map((raw, index) => parseEpisodeVariant(raw, index));
  }, 5000);
  console.log(
    `S8-D-5 equivalence: 300 trials (incl. every validation error path) byte- and key-order-identical | bench E=${E}: current=${(cur * 1e6).toFixed(1)}ns variant=${(cand * 1e6).toFixed(1)}ns delta/eval-invocation=${((cur - cand) * 1e6).toFixed(1)}ns`
  );
}

await rm(workRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

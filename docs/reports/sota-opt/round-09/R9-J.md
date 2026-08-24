MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第九遍复查报告

**战役:** 全库持久 SOTA 优化 Round 9 / R9-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `57fcd16`（独占 tip，含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 / S9-H-1..2 排除全表）
**分支:** `cursor/r9-j-persist-ninth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 29 个文件
（3655 行）自 J1 落地（`fb41417`）以来**逐字节未变**（本轮核对
`git diff fb41417..57fcd16 -- <29 文件>` 输出为空，经 R2-J..R8-J 与本轮
共八遍复查累计零后续代码改动）。R8-J 基线（`263e0e0`）之后
`git log 263e0e0..57fcd16 -- src/` **零提交**（26 个中间提交全部为
R9 A–H 的报告/合并/文档），生产调用图对本切片**可证不变**——R9 各区
全数淘汰、无新落地，连间接切入点都没有新增。按 R7-I 教训先重锚
配置态矩阵再猎新角度：本 VM 实测 preferences `saveToDisk` 地板
**585–647µs/写**（R8-J 519–548µs 带上方少许，同量级；I/O 支配判据
第九次成立）、jsonl 追加 fsync=false **68.4–71.5µs** / fsync=true
**314–391µs**（premium 0.243–0.319ms，R8-D/R8-J 同带）、配置态删除
级联 match=**678–714µs** / no-match=**266–273µs**（R8-J 666–717 /
256–275µs 带内复现，fail-closed 两读顺序未动）、
`buildProjectContextIndex` **18.6–21.0µs**/构建（R8-J 18.5–21.2µs
带内）、track-loop 切片内命令类**首次锚定**（applyAnswers +
planFromContract + acceptanceForRole 五子计划 **2.94–2.97µs/plan**
——startTrackedRun 的切片内 CPU 成分即此，其余全为切片外路由与 I/O）。
第九遍在完整排除表之上以**四个从未点名的位点**枚举得到 4 个新候选
（S9-J-1 … S9-J-4），全部经理论 + 确定性 seeded 仿真（mulberry32，
含生产端到端 fidelity 闸）+ 真实规模基准（R9J_SEED=1/2/3 三次独立
运行等价结论逐位一致）裁决后淘汰：S9-J-1（`stripForbidden` 逐 needle
includes 卫，miss 侧免 split/join 分配）逐位等价但 **258–264ns/剥除**、
调用点 `appendFeedback` 紧随 68–72µs jsonl 追加（~270×）；S9-J-2
（`rebuildViews` 内部 `weights` 累加器 Record→Map）经原型键
（`__proto__`/`toString`/`constructor` 等）等价论证 + 400 seed fuzz +
40 seed 生产 fidelity 证等价，但 **3.01–3.86µs/重建**@N=1000 被同路径
`saveToDisk` 地板 585–647µs 吞没（~170×，S2-J-6/S7-J-4 家族第三站点）；
S9-J-3（index 构建 architecture/risks 双遍 filter+sort+map 融合单遍
分流）等价但现实档 **21–88ns/构建**、F=2000 超现实压力档（66×）也仅
12.0–16.3µs、每 run 一次；S9-J-4（`decideClosure` structured-pass
短路跳过死 legacyMatch 探针）等价且方向稳定为正，但 **4–865ns/闭合
判定**（幅度在抖动内摇摆）、每 episode 闭合尝试一次。J1 落地代码本轮
`scripts/r1j-equivalence-sim.ts` 重跑全绿（2468 项逐位检查，2996.2×），
`evaluatePreferenceLoop` / `queryPacketGrounding` re-grep 再证零生产
调用方（本轮另证 `refreshProjectContextIndex` 亦零生产调用方）。未重开
任何 X* / S1-* … S8-* / S9-A/B/C/D/E/F/H-* 条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`（3）、`src/privacy/`（3）、`src/preferences/`（7）、
  `src/episode/`（5）、`src/persist/`（2）、`src/track/`（4）、
  `src/context/`（2）、`src/feedback/`（3）共 29 文件 3655 行全量第九遍
  实际读码，未依赖前八轮记忆。上下游 `run/event-store.ts`（fsync 参数
  取证）、`run/{coordinator,flowchart-run,child-grounding,episode-bind}.ts`
  与 `cli/episode.ts`（调用图取证）只读，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含继承
  X0–X4、S1–S8 全部 ID 及 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 /
  S9-E-1..3 / S9-F-1..3 / S9-H-1..2；S9-G / S9-I 在飞未引用）/
  round-09/PLAN.md / round-08/PLAN.md + R8-J.md / R7-J.md … R1-J.md。
  J1 未重做（本轮重跑其等价仿真全绿）；`scripts/r1j-equivalence-sim.ts`
  未改动。未开 PR；未编辑 EXCLUSIONS.md / PROGRESS.md / 任何 PLAN.md。
- PLAN 三条 J 区专项禁令逐条遵守：**未去 fsync**（S0b 经生产
  `appendJsonlLine` 原样测量，fsync 路径一字未动）、**未做 sourcedFact
  跨调用 CSE**（S8-J-1 已闭，`context/index.ts` 零碰）、**未合并 jsonl
  单句柄**（S8-J-2 已闭）。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `privacy/deletion.ts` 级联 match 路径 `{ ...record, body: undefined }`
    换 rest 解构 = 级联匹配路径固有 I/O 组成的 ns 级对象拷贝微观
    （S0c 锚定 678–714µs 全程中 CPU 不可寻址，S2-J-7/S6-J-1 收口域），
    拒列；
  - `feedback/store.ts` `readFeedbackTombstoneIds` 的 every+Set 双遍
    = R5-J 已裁「tombstone 双遍维持」，拒列；
  - `cluster/mailbox.ts` `claimRole` 自邮回插的 `byRole.get ?? []` 重取
    = R1-J S10 已裁（噪声级 + mailbox 数据面），拒列；
  - `preferences/export.ts` `options.scopes!.includes` 逐观察 = S3-J-6
    原文位点，拒列；
  - `track/loop.ts` children/flowchart 构造条件 spread 改后置赋值 =
    S8-A-3 / S8-E-2 / S8-H-1 明文点名的 PIC 形状伪影类，拒列；
  - `episode/store.ts` `append` 将 `JSON.stringify(event)` 提到队列外 =
    调用-落盘窗口内的入参变异可观察面改变（S1-B-8 身份/别名家族邻域）
    + ns 级，拒列；
  - `persist/file-lock.ts` 释放路径 ownerToken 重读 = 锁安全协议本体
    （数据面），无合法候选；
  - `context/index.ts` manifests 记录循环与 fileFact 循环的探针跨循环
    复用 = S8-J-1 跨调用 CSE 同机制换位点（且两处 hash32 回退串不同，
    只能部分复用），拒列。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无
  命令权、live = R0 等价、双 LCB 与双归因保留、saveToDisk 每写 mkdir
  自愈保留（S7-J-6）、删除级联 fail-closed 保留（S5-J-3 / S6-J-1——
  S0c 经生产函数原样测量，两读顺序未动）、无 Promise.all 双故障竞态
  引入（S2-J-10 / S4-J-2 / S4-J-3 / S6-J-1）、stripForbidden 顺序剥除
  语义未动（S3-J-1——S9-J-1 只在仿真中裁决，生产文件零碰）、loop-eval
  lastUpdated / tombstone / 增量 fold 可观察面未动（S1-J-1 / S3-J-5 /
  J1）、reduceEpisodeEvents 无输入别名回归（S6-J-5）、EventStore/
  EpisodeStore 磁盘事实源未加内存缓存（S1-G-1）、阈值 / 测试 / CAS /
  凭据 / 公开签名不变。不声称 Outcome-supported，Checkpoint F-PROD
  仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与 I/O 地板重测（含配置态矩阵）

1. **切片逐字节未变**：`git diff fb41417..57fcd16 -- src/cluster
   src/privacy src/preferences src/episode src/persist src/track
   src/context src/feedback` 输出为空（29 文件 3655 行，九遍全程 J1
   之外零 diff）。R1-J…R8-J 全部逐函数收口与 S*-J-* 排除继承有效。
2. **调用图可证不变**：`git log 263e0e0..57fcd16 -- src/` **零提交**
   （中间 26 个提交全为 R9 A–H 报告/合并——R9 前八区全数淘汰无落地），
   即自 R8-J 裁决以来生产代码一行未变。生产调用面 re-grep 校准与
   R8-J 一致并加一：`evaluatePreferenceLoop` 与 `queryPacketGrounding`
   在 `src/` 仍仅存在于各自定义文件；**`refreshProjectContextIndex`
   本轮首次单独取证——`src/` 内零调用方**（仅定义处，test-only 面），
   其内部「build 后二次 staleness 重映射」不具生产热度，归入一次性
   构建噪声域不另立 ID；`appendJsonlLine` 四调用方中 fsync 非 false
   仅 `run/event-store.ts:39`（TERMINAL_EVENT_TYPES）与
   `run/episode-store.ts:36`（TERMINAL_EPISODE_STATUSES）；
   `buildProjectContextIndex` 生产调用方 `run/coordinator.ts:253` 与
   `run/flowchart-run.ts:255`（每 run 一次）；`compileContextPacket`
   唯一生产调用方 `run/child-grounding.ts:48`（≤16/run）；
   `decideClosure` 调用方 `run/episode-bind.ts:181` 与
   `cli/episode.ts:105`（每闭合尝试一次）。
3. **I/O 地板 vs CPU 重测（本 VM，Node v22.22.2，overlay fs；三次独立
   运行 R9J_SEED=1/2/3）**：

```text
S0a preferences saveToDisk floor replica (N=1000 obs + 25 tombstones): 585 / 647 / 635 us/write   (R8-J band 519-548us)
S0b jsonl append floor: fsync=false 68.4-71.5us | fsync=true 314.0-390.8us | premium 0.243-0.319ms/append
S0c configured deletion cascade (N=200 records 49.9KB, 20 matching):
    match=678-714us/cascade | no-match=266-273us/cascade (fail-closed 2-read order kept)
S0d buildProjectContextIndex configured (I=3 M=2 C=4 F=30, dual hash maps): 18.6-21.0us/build
S0e track-loop slice-internal class (applyAnswers+planFromContract+acceptanceForRole, 5-child plan): 2.94-2.97us/plan  [new anchor]
```

   方向与八轮判例一致：唯一无上界增长维度（preference N、feedback N）
   仍被同路径全量序列化 + 磁盘 I/O 支配，切片内全部具名 CPU 成分维持
   ns–µs 级。**配置态 × 命令类矩阵补最后一格**（R7-I 教训 + 本轮 PLAN
   点名「track loop if it is a distinct class」）：`startTrackedRun`
   的切片内 CPU 成分 = clarify/plan/acceptance 塑形，S0e 实测全程
   **2.94–2.97µs**（五子计划、含 tests/reviewer 配置态），其余组成
   （calibrateCatalog、assignTasks、startFlowchartRun、runAutoAdaptLoop）
   全部切片外；waitForClarification 路径 = 五次事件追加 + 双 readAll +
   checkpoint 写 = S6-J-4 / S2-J-11 / S1-G-1 收口的 I/O 契约面。矩阵
   其余格与 R8-J §1.3 相同：删除 match/no-match（S0c）、saveToDisk
   非空店态（S0a 含 25 tombstones）、jsonl fsync 开/关（S0b）、
   redaction 有/无文本 = S7-J-5 收口域。矩阵无空洞。
4. **J1 落地代码复核**：`npx tsx scripts/r1j-equivalence-sim.ts` 全绿
   （ALL EQUIVALENCE CHECKS PASSED, 2468 bitwise checks；perf fixture
   reference 10393.1ms → current 3.5ms = **2996.2×**）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 方案 | 理论收益 | 仿真 | 基准（三次独立运行） | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S9-J-1 | `feedback/redaction.ts` `stripForbidden` 逐 needle includes 卫：现行对每个 needle 无条件 `out.split(needle).join("")`——needle 缺席时 split/join 是纯身份变换但仍付一次数组分配 + 拼接；候选在**演化中字符串**上先 `out.includes(needle)`，缺席即跳过（顺序剥除语义一字未动：探针对象与剥除对象是同一演化串，前序剥除拼合出的新出现仍被后续探中；≠ S3-J-1 的单遍融合、≠ S2-J-9 的排序提升、≠ S7-J-5 的无文本整跳） | miss 侧免 split/join 分配，K=4 生产 needles | ✅ 2000 trial 单元 fuzz（重叠/拼合 needle 形态、CJK/NUL 字符）`Object.is` 逐位一致；✅ 100 seeds × 4 记录形态 × 4 策略生产端到端：baseline replica vs 生产 `redactFeedback` **fidelity 闸**逐字节一致，guarded 变体 vs 生产逐字节一致，非脱敏路径输入身份保持（三次运行同判） | miss-all（生产常态干净 body）省 **258–264ns/剥除**；hit-2 省 82–94ns（探针税被分配节省抵消大半）；唯一生产调用点 `appendFeedback` 后随 jsonl 追加 **68–72µs**（S0b）——占比 ~0.4% | 淘汰：I/O 支配 ~270×（S2-J-9 / S7-J-5 同域第三证人），距落地线 ≥5 个数量级；`stripForbidden` 分解至此闭合（顺序语义 S3-J-1、needle 预处理 S2-J-9/S7-J-5、逐 needle miss 分配本条） |
| S9-J-2 | `preferences/store.ts` `rebuildViews` 内部 `weights` 累加器 Record→Map（`aggregates` 保持 Record——公开 `PreferenceView` 形状）：Record 动态键置字典模式且原型链读有害；**原型键等价论证**：`currentW` 的全部三个用点都被 `typeof current === "number"` 或 `currentW > 0` 闸门守卫，而 `current` 读自两侧共享的 aggregates Record——原型键（`__proto__` 恒返 Object.prototype、`toString` 首读返继承函数）下 current 永非 number、继承函数/`>0` 恒 false ⇒ 闸门两侧同闭；普通键上 Record 自有属性行为 = Map | 免字典模式哈希查/写 | ✅ 400 seed fuzz（**200 组含 `__proto__`/`toString`/`constructor`/`hasOwnProperty`/`valueOf` 键**）views 逐字节一致含 aggregates 条目序；✅ 40 seed 生产 fidelity 闸：驱动生产 store（`recordObservation`→`getView`，持久化未配置），replica 与生产在 aggregates 条目/confidence/sourceCount 上逐位一致（三次运行同判） | N=1000, P=20 档：record=116.5–122.1µs vs map=113.0–118.3µs → 省 **3.01–3.86µs/重建**；同路径紧随的 `saveToDisk` 地板 **585–647µs**（S0a）——占比 ~0.5–0.7% | 淘汰：S2-J-6（同函数 filter→计数）/ S7-J-4（同函数冗余 Map.set）的 I/O 支配判据第三次原样适用（~170×）；preferences 插入路径任何 CPU 微观化都低于其 I/O 尾数抖动的结构性结论第九次成立 |
| S9-J-3 | `context/index.ts` `buildProjectContextIndex` 的 architecture/risks 双链 `facts.filter(startsWith).sort(byKey).map(value)`（两遍独立全扫）融合为单遍分流 + 各自 sort+map（filter 保子序列序 ⇒ 两侧稳定排序输入相同 ⇒ 输出逐位一致） | 免一遍 facts 全扫 + 谓词重复求值 | ✅ 60 seeds 生产端到端：baseline replica vs 生产 `buildProjectContextIndex().{architecture,risks}` fidelity 逐字节一致（键重复平局夹具在内），fused 变体 vs baseline 逐字节一致（三次运行同判） | 现实档 F=30 省 **21–88ns/构建**；压力档 F=2000（66× 超现实）省 12.0–16.3µs；调用方 coordinator/flowchart-run 每 run 一次（S0d 全构建 18.6–21.0µs） | 淘汰：一次性构建 ns 级噪声，距落地线 ≥5 个数量级（S1-J-6 / S2-J-4 / S4-J-6 同域）；index 构建的 facts 面分解闭合（dirty×generated S1-J-6、比较器 S3-J-2、冗余拷贝 S4-J-6/S6-J-6、sourcedFact S8-J-1、双链扫描本条） |
| S9-J-4 | `episode/closure.ts` `decideClosure` structured-pass 短路：`structuredMatch === true` 时现行仍对 evidenceRefs 跑 legacy `` evd_${id} `` 探针，其结果是**死值**（`structuredMatch !== true && !legacyMatch` 已定 false）；候选 `if (structuredMatch === true) return false;` 后再算 legacyMatch（探针对 schema 合法 string refs 纯函数，跳过等价；≠ S7-J-3 的模板提升、≠ S2-J-8 的 Set 化——本条是分支级死代码短路） | structured 已证的 criterion 免一遍 O(R) 扫描 | ✅ 300 seeds 生产端到端（structured/legacy/无证据混合、PASSED/FAILED、三态 status）vs 生产 `decideClosure` JSON 逐位一致（三次运行同判） | C=6, R=24 档：all-structured 省 4 / 865 / 431 ns/判定，mixed 省 253 / 693 / 48 ns/判定——方向稳定为正但幅度在运行间抖动内摇摆；每 episode 闭合尝试一次（episode-bind / cli） | 淘汰：亚 µs 一次性判定路径（S2-J-8 ~800ns / S7-J-3 419–445ns 同函数同量级判据第三次成立）；`decideClosure` 表达式级分解闭合（Set 化 S2-J-8、模板提升 S7-J-3、死探针短路本条） |

## 3. 关键裁决细节

### 3.1 S9-J-2：原型键危险被 aggregates 共享闸门中和——等价成立但 I/O 判据不动

Record→Map 换 accumulator 通常携带 `__proto__` 类原型键的行为发散
风险（Record 读命中继承值、Map 读 miss）。本条的特殊性在于 `weights`
的每个消费点都被 `current`（读自**两侧共享**的 aggregates Record）的
`typeof === "number"` 闸门或 `currentW > 0` 数值比较守卫：
`aggregates["__proto__"]` 对原始值赋值恒 no-op、读恒返
Object.prototype ⇒ 该键的 current 永非 number ⇒ 闸门永闭；
`toString`/`constructor` 等首读返继承函数（非 undefined ⇒ hasConflict
恒 true ⇒ 不进 currentW 消费分支），一经显式赋值即被自有属性遮蔽、
两侧行为重新对齐。400 seed fuzz（半数注入五种原型键）与 40 seed
生产 fidelity 全绿证实论证。但收益 3.01–3.86µs/重建正好落在 R2-J
以来三代实测的同一结论上：`rebuildViews` 的调用方
（`applyObservation`/`deleteObservation`）紧随全量 `saveToDisk`
（本轮 585–647µs），任何该函数内 CPU 微观化都被两个数量级的 I/O
地板吞没。S2-J-6 → S7-J-4 → 本条，同函数三个不同机制的候选以同一
判据淘汰，preferences 插入路径宣告表达式级穷尽。

### 3.2 S9-J-1：miss 侧分配税首次点名——绝对量仍是 I/O 尾数

`stripForbidden` 八轮以来被裁过顺序语义（S3-J-1，不可融合）、needle
预处理（S2-J-9/S7-J-5），但「逐 needle 的 split/join 在 miss 时是
纯身份变换却付分配」这个位点从未被单独点名。等价性关键是探针必须打在
**演化中**的字符串上（先剥 `sk-` 可能把 `a` + `pi_key` 拼合出
`api_key`——2000 trial fuzz 专门注入拼合形态），guarded 变体正是
如此。生产常态（干净 body、4 needles 全 miss）省 258–264ns，但唯一
调用点 `appendFeedback` 的下一行就是 68–72µs 的 jsonl 追加——占比
0.4%，S2-J-9 的 I/O 支配判据原样适用。

### 3.3 S9-J-4：方向稳定但幅度不稳的死代码短路——闭合判定路径第三次收口

structured-pass 短路是真死代码消除（结果值可证不参与任何后继），
三次运行方向一致为正，但幅度（4→865ns）在 V8 分支预测与 GC 抖动内
摇摆，且触发面 = 每 episode 闭合尝试一次（episode-bind 的 settle 与
cli episode close）。与同函数的 S2-J-8（~800ns）、S7-J-3（419–445ns）
同量级同判据。`decideClosure` 的全部表达式级站点至此各有具名锚点。

### 3.4 第九遍收口：矩阵最后一格补齐，候选空间在四个新位点上再次闭合

S0e 把「track loop 是否独立命令类」的问题定量关闭：切片内成分
2.94–2.97µs/plan，与 S0a–S0d 的 I/O 地板相差两个数量级以上，track
路径的重量全部在切片外（路由/执行/学习）或 I/O 契约面（S6-J-4 /
S2-J-11 收口域）。第九遍逐文件重读产出的全部「疑似新角度」经排除表
比对后只有四条不是换名（§0 列出八条换名拒列），四条全部以 I/O 支配、
一次性 ns 级或亚 µs 判定路径淘汰——本切片在「契约/I/O 地板支配、
具名 CPU 皆 ns–µs」这一 R1-J 以来的结构性结论上第九次收敛，无遗留
赢家、无待重测空洞。

## 4. 逐文件收口（第九遍新视角，其余与 R1-J…R8-J 一致）

| 文件 | 第九遍检查结论 | 候选 |
| --- | --- | --- |
| `cluster/mailbox.ts` | enqueue 三连（S5-J-4）/ claimRole box 提升（S4-J-5）/ 自邮回插重取（R1-J S10 换名拒列）维持；drain 空箱新数组为读契约 | 无 |
| `cluster/spawn.ts` | allowlist O(1) 常数域维持（X1-4）；无新角度 | 无 |
| `cluster/host.ts` | 双 trim（S3-J-3）/ 役播 per-target（S2-J-3）/ spawn 死分支（S4-J-1 防御纵深保留）维持；register 丢弃 claimRole 返回数组属 ns 级投递副本所有权，拒列 | 无 |
| `privacy/deletion.ts` | 级联四角度（S2-J-7/S4-J-3/S5-J-3/S6-J-1）收口维持；S0c 本 VM 复现 678–714µs 带内；`{...record, body: undefined}` 换 rest 解构 = 固有 I/O 组成 ns 级微观（§0 拒列） | 无 |
| `privacy/state-layout.ts` | 纯路径拼接 | 无 |
| `privacy/record-classes.ts` | 小常数字典 + find，X1-4 小域；`durableRecordClassById` 仍零生产调用方 | 无 |
| `preferences/loop-eval.ts` | J1 落地面重跑全绿（2468 项，2996.2×）；`evaluatePreferenceLoop` re-grep 仍零生产调用方 | 无 |
| `preferences/export.ts` | S5-J-1/S3-J-6 维持；scopes includes = S3-J-6 原文位点（§0 拒列） | 无 |
| `preferences/precedence.ts` | X1-4 小域维持；`selectHighestPriority` 折叠权重携带 = S2-H-5 同型 test-only 面，拒列 | 无 |
| `preferences/materialize.ts` | entries 循环收口维持（R7-J） | 无 |
| `preferences/service.ts` | 薄包装 | 无 |
| `preferences/store.ts` | **S9-J-2 点名 + 淘汰**（§3.1）：`rebuildViews` 表达式级穷尽（S1-J-1 增量化、S3-J-5 时戳、S7-J-4 冗余 set、S2-J-6 计数、weights 结构本条）；S0a 本 VM 重锚 585–647µs | S9-J-2 淘汰 |
| `preferences/types.ts` | 类型定义 | 无 |
| `episode/manager.ts` | RUN_ATTACHED O(R²) = S1-J-3、无拒绝别名 = S6-J-5 维持；reducer 拷贝为数据面语义 | 无 |
| `episode/replay.ts` | 单遍 parse 支配（S3-J-4 域）维持 | 无 |
| `episode/events.ts` | 类型定义 | 无 |
| `episode/store.ts` | 队列顺序契约维持；append 内 stringify 时机 = 变异窗口可观察面（§0 拒列） | 无 |
| `episode/closure.ts` | **S9-J-4 点名 + 淘汰**（§3.3）：`decideClosure` 分解闭合（S2-J-8 Set、S7-J-3 模板、死探针短路本条）；`closeEpisode` 单 spread 无可省 | S9-J-4 淘汰 |
| `persist/file-lock.ts` | wx/ownerToken/重试数据面锁维持；释放路径重读 = 安全协议本体（§0），无合法候选 | 无 |
| `persist/jsonl.ts` | S3-J-4/S8-J-2/R3-J 三面维持；S0b 本 VM 重锚（fsync premium 0.24–0.32ms）；PLAN 禁令遵守 | 无 |
| `track/primary-split.ts` | 纯编排维持 | 无 |
| `track/plan.ts` | S0e 首次锚定切片内命令类 2.94–2.97µs/plan；正则字面量非 /g 无 X0-6 风险；无新角度 | 无 |
| `track/clarify.ts` | R4-J 偏好合并收口维持；applyAnswers 单遍 | 无 |
| `track/loop.ts` | S1-J-5/S2-J-11/S4-J-2/S6-J-4/S8-E-1 五面维持；条件 spread = PIC 伪影类（§0 拒列）；waitForClarification I/O 序 = 契约面 | 无 |
| `context/index.ts` | **S9-J-3 点名 + 淘汰**（§3.4）：facts 面分解闭合；`refreshProjectContextIndex` 本轮取证零生产调用方（test-only，重映射归一次性构建噪声域）；manifests 跨循环探针复用 = S8-J-1 换位点（§0 拒列） | S9-J-3 淘汰 |
| `context/packet.ts` | S1-J-7/S2-J-5/S4-J-4/S5-J-2/S6-J-3/S7-J-1/S7-J-2 七面维持；`queryPacketGrounding` re-grep 仍零生产调用方；编译路径整体预算（35µs × ≤16 child）自 R7-J 起封顶 | 无 |
| `feedback/redaction.ts` | **S9-J-1 点名 + 淘汰**（§3.2）：`stripForbidden` 分解闭合（顺序 S3-J-1、预处理 S2-J-9/S7-J-5、miss 分配本条）；copyFeedback 条件 spread = PIC 伪影类 | S9-J-1 淘汰 |
| `feedback/store.ts` | 双读串行（S2-J-10）/ 双层过滤（R1-J S21）/ tombstone 双遍（R5-J，§0 拒列）维持 | 无 |
| `feedback/types.ts` | 类型定义 | 无 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1
（`fb41417`）起经 R2-J..R8-J 与本轮 R9-J 八遍复查累计零后续代码
改动，逐字节一致。

## 6. 测试

零代码改动下相关基线复核，全绿（Node v22.22.2 via nvm，overlay fs，
pnpm 10.17.1）：

```bash
npx tsx scripts/r1j-equivalence-sim.ts
# ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
# perf fixture: reference 10393.1 ms -> current 3.5 ms (2996.2x)
pnpm gate   # typecheck + lint + test + build 全绿
# tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1（全套件，
# 含 cluster/privacy/preferences/episode/persist/track/context/feedback）
```

仿真（临时脚本，未入库——无赢家不落仿真文件，完整源码见附录；三次
独立运行（R9J_SEED=1/2/3）10 项等价断言逐位一致、计时见带）：

```text
run 1 (R9J_SEED=1):
S0a 585us/write | S0b fsync=false 71.0us fsync=true 314.0us premium 0.243ms | S0c match=694us no-match=273us | S0d 18.6us | S0e 2.94us/plan
S9-J-1 unit fuzz 2000 trials true; e2e fidelity/equiv/identity true; bench miss delta=258ns hit delta=82ns
S9-J-2 fuzz 400 seeds (200 proto-key) true; production fidelity 40 seeds true; bench delta=3.46us/rebuild
S9-J-3 e2e 60 seeds fidelity/equiv true; bench realistic delta=21ns stress(F=2000) delta=12.0us
S9-J-4 e2e 300 seeds true; bench all-structured delta=4ns mixed delta=253ns
checks=10 failures=0

run 2 (R9J_SEED=2):
S0a 647us | S0b 68.4 / 319.8us premium 0.251ms | S0c match=678us no-match=267us | S0d 21.0us | S0e 2.96us
S9-J-1 all true; miss delta=264ns hit delta=94ns
S9-J-2 all true; delta=3.86us | S9-J-3 all true; realistic delta=47ns stress delta=12.8us
S9-J-4 all true; all-structured delta=865ns mixed delta=693ns
checks=10 failures=0

run 3 (R9J_SEED=3):
S0a 635us | S0b 71.5 / 390.8us premium 0.319ms | S0c match=714us no-match=266us | S0d 20.2us | S0e 2.97us
S9-J-1 all true; miss delta=261ns hit delta=89ns
S9-J-2 all true; delta=3.01us | S9-J-3 all true; realistic delta=88ns stress delta=16.3us
S9-J-4 all true; all-structured delta=431ns mixed delta=48ns
checks=10 failures=0
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines
>=22.19.0`；本轮全部测试与门禁在 nvm 的 Node 22.22.2 下执行，全绿。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S9-J-1 | redaction `stripForbidden` 逐 needle includes 卫（演化串探针，miss 即跳过 split/join） | 逐位等价（2000 fuzz 含拼合形态 + 100×4×4 生产端到端 fidelity 闸），但 miss-all 258–264ns/剥除、hit-2 82–94ns，唯一调用点 appendFeedback 紧随 68–72µs jsonl 追加（占比 ~0.4%，S2-J-9/S7-J-5 同域）；stripForbidden 分解闭合 |
| S9-J-2 | preferences `rebuildViews` 内部 `weights` 累加器 Record→Map（aggregates 保持公开 Record 形状） | 等价含原型键（currentW 全部用点被共享 aggregates Record 的 typeof/number 闸门守卫；400 fuzz 半数注入 `__proto__`/`toString`/`constructor`/`hasOwnProperty`/`valueOf` + 40 seed 生产 fidelity），但 3.01–3.86µs/重建@N=1000 被同路径 saveToDisk 地板 585–647µs 吞没（~170×；S2-J-6/S7-J-4 同函数第三站点） |
| S9-J-3 | context index 构建 architecture/risks 双遍 filter+sort+map 融合单遍分流 | 等价（60 seed 生产 fidelity + 稳定排序子序列论证），但现实档 21–88ns/构建、每 run 一次；F=2000 超现实压力档（66×）仅 12.0–16.3µs（S1-J-6/S2-J-4/S4-J-6 同域）；facts 面分解闭合 |
| S9-J-4 | closure `decideClosure` structured-pass 短路跳过死 legacyMatch 探针 | 等价（300 seed 生产端到端；探针对 schema 合法 string refs 纯函数）且方向稳定为正，但 4–865ns/闭合判定（幅度抖动内摇摆）、每 episode 闭合尝试一次（S2-J-8/S7-J-3 同函数同量级）；decideClosure 分解闭合 |

重开条件：S9-J-1 若 needles 表从 4 个常量增至 10²+ 或 redaction 进入
每消息热路径，可凭本报告拼合形态 fuzz 证据重开；S9-J-2 若 preferences
快照改增量日志使 I/O 地板消失（S1-J-1/S7-J-4 同一重开前提，属数据面
契约决策），可连带重估；S9-J-3 若 facts 常态达 10³+ 且 index 构建
获得每 run 数百次调用方（S7-J-1/S8-J-1 同门槛）可重开；S9-J-4 若
episode 闭合判定进入每事件热环（当前每闭合尝试一次）可重开——四者
现实重开路径均不存在。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：置于 `/tmp/r9j-sim.mts`（`.mts` 强制 ESM；相对 import 指向
`/workspace`），`R9J_SEED=1|2|3 npx --prefix /workspace tsx r9j-sim.mts`。

```typescript
/* ============================================================
 * R9-J adjudication sim — data plane / persist, ninth pass.
 * Runs under tsx on Node v22.22.2 from /tmp with relative imports
 * into /workspace. Deterministic: mulberry32(seed); rerun with
 * R9J_SEED=1|2|3 for the three-run verdict.
 *
 * Section 0: I/O-floor re-measure on THIS VM (default + configured).
 *   S0a preferences saveToDisk floor replica (N=1000 + tombstones) [R8-J band 519-548us]
 *   S0b jsonl append floor: fsync=false vs fsync=true              [R8-J 69-72 / 250-483us]
 *   S0c configured privacy deletion cascade: match/no-match        [R8-J 666-717 / 256-275us]
 *   S0d buildProjectContextIndex whole-build CPU                   [R8-J 18.5-21.2us]
 *   S0e track-loop slice-internal command class (clarify-shape:
 *       planFromContract + applyAnswers + acceptanceForRole)       [new anchor]
 * Candidates (all never-named sites, ninth pass):
 *   S9-J-1 feedback/redaction.ts stripForbidden per-needle includes
 *          guard (skip split/join for needles absent from the
 *          evolving string; order semantics untouched)
 *   S9-J-2 preferences/store.ts rebuildViews internal `weights`
 *          accumulator Record -> Map (aggregates stays Record)
 *   S9-J-3 context/index.ts architecture/risks two filter+sort+map
 *          passes -> single-pass split (sorts preserved per output)
 *   S9-J-4 episode/closure.ts decideClosure structured-pass
 *          short-circuit (skip legacyMatch when structuredMatch===true)
 * ============================================================ */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { hash32 } from "../workspace/src/domain/hash.js";
import {
  buildProjectContextIndex,
  type BuildProjectContextIndexOptions
} from "../workspace/src/context/index.js";
import { appendJsonlLine } from "../workspace/src/persist/jsonl.js";
import { cascadeFeedbackTombstones } from "../workspace/src/privacy/deletion.js";
import { feedbackLogPath, feedbackTombstonesPath } from "../workspace/src/feedback/store.js";
import { redactFeedback, type RedactionPolicy } from "../workspace/src/feedback/redaction.js";
import type { FeedbackRecord } from "../workspace/src/feedback/types.js";
import { decideClosure } from "../workspace/src/episode/closure.js";
import { planFromContract, acceptanceForRole } from "../workspace/src/track/plan.js";
import { applyAnswers } from "../workspace/src/track/clarify.js";
import {
  recordObservation,
  resetPreferenceStore,
  getView,
  listObservations,
  MIN_INFERRED_RECURRENCE_DEFAULT
} from "../workspace/src/preferences/store.js";
import type { PreferenceObservation, PreferenceScope } from "../workspace/src/preferences/types.js";
import type { ProjectSnapshot } from "../workspace/src/domain/project.js";
import type { ProjectEpisode } from "../workspace/src/domain/episode.js";
import type { RequirementContract, DecisionQuestion } from "../workspace/src/domain/contract.js";
import type {
  ProjectId,
  EpisodeId,
  RunId,
  EvidenceId
} from "../workspace/src/domain/ids.js";
import type { IsoTimestamp } from "../workspace/src/domain/timestamp.js";

const SEED_BASE = Number(process.env["R9J_SEED"] ?? "1");
let checks = 0;
let failures = 0;
function assertOk(cond: boolean, label: string): void {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`FAIL: ${label}`);
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bench(fn: () => void, iters: number): number {
  fn();
  fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return performance.now() - t0;
}

async function benchAsync(fn: () => Promise<void>, iters: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  return performance.now() - t0;
}

const NOW = "2026-08-24T00:00:00.000Z" as IsoTimestamp;

/* ============================================================
 * Section 0a: preferences saveToDisk floor replica, N=1000 + 25
 * tombstones (same shape R7-J/R8-J measured: stringify + mkdirSync +
 * writeFileSync — the configured nonempty-store write).
 * ============================================================ */
{
  const rnd = mulberry32(SEED_BASE * 101);
  const observations = Array.from({ length: 1000 }, (_, i) => ({
    id: `obs_${i}`,
    scope: i % 2 === 0 ? "project" : "user",
    scopeKey: `sk${i % 20}`,
    key: `k${i % 7}`,
    value: rnd() < 0.5 ? `v${Math.floor(rnd() * 5)}` : Math.floor(rnd() * 100),
    explicit: rnd() < 0.3,
    weight: 1 + Math.floor(rnd() * 3),
    recurrenceCount: 1 + Math.floor(rnd() * 4),
    observedAt: NOW
  }));
  const tombstones = Array.from({ length: 25 }, (_, i) => `obs_t${i}`);
  const dir = join(tmpdir(), "r9j-s0a");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "preferences.json");
  const IO_ITER = 300;
  const ms = bench(() => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ observations, tombstones }));
  }, IO_ITER);
  console.log(
    `S0a preferences saveToDisk floor replica (N=1000 obs + 25 tombstones): ${((ms / IO_ITER) * 1e3).toFixed(0)}us/write (R8-J band 519-548us)`
  );
  rmSync(dir, { recursive: true, force: true });
}

/* ============================================================
 * Section 0b: jsonl append floor through the PRODUCTION function.
 * ============================================================ */
{
  const dir = join(tmpdir(), "r9j-s0b");
  await rm(dir, { recursive: true, force: true });
  const fileNo = join(dir, "no-fsync.jsonl");
  const fileYes = join(dir, "yes-fsync.jsonl");
  const line = JSON.stringify({
    type: "RUN_COMPLETED",
    runId: "run_r9j",
    at: NOW,
    payload: { status: "DONE" }
  });
  const N1 = 400;
  const N2 = 200;
  const noMs = await benchAsync(() => appendJsonlLine(fileNo, line, false), N1);
  const yesMs = await benchAsync(() => appendJsonlLine(fileYes, line, true), N2);
  console.log(
    `S0b jsonl append floor: fsync=false ${((noMs / N1) * 1e3).toFixed(1)}us/append | fsync=true ${((yesMs / N2) * 1e3).toFixed(1)}us/append | fsync premium ${(yesMs / N2 - noMs / N1).toFixed(3)}ms/append (R8-J 69-72 / 250-483us)`
  );
  await rm(dir, { recursive: true, force: true });
}

/* ============================================================
 * Section 0c: configured-state privacy deletion cascade through
 * PRODUCTION cascadeFeedbackTombstones. N=200 records, 20 matching,
 * pre-existing tombstones sidecar.
 * ============================================================ */
{
  const stateRoot = join(tmpdir(), "r9j-s0c");
  const target = "ep_target" as EpisodeId;
  const N = 200;
  const mkRecord = (i: number, ep: string) => ({
    id: `fb_${String(i).padStart(4, "0")}`,
    episodeId: ep,
    kind: "SELF",
    rubricVersion: "1",
    score: i % 101,
    evidenceRefs: [],
    redacted: false,
    createdAt: NOW,
    body: `free text payload number ${i} with enough characters to look like a real comment body.`
  });
  let fixtureBytes = 0;
  const setup = async (): Promise<void> => {
    await rm(stateRoot, { recursive: true, force: true });
    const logPath = feedbackLogPath(stateRoot);
    await mkdir(dirname(logPath), { recursive: true });
    const lines = Array.from({ length: N }, (_, i) =>
      JSON.stringify(mkRecord(i, i % 10 === 0 ? (target as string) : `ep_other_${i % 7}`))
    );
    const body = `${lines.join("\n")}\n`;
    fixtureBytes = body.length;
    await writeFile(logPath, body, "utf8");
    await writeFile(
      feedbackTombstonesPath(stateRoot),
      `${JSON.stringify(["fb_pre_a", "fb_pre_b"], null, 2)}\n`,
      "utf8"
    );
  };
  const REP = 30;
  let matchMs = 0;
  for (let i = 0; i < REP; i++) {
    await setup();
    const t0 = performance.now();
    const out = await cascadeFeedbackTombstones(stateRoot, target);
    matchMs += performance.now() - t0;
    if (i === 0) assertOk(out.length === 20, `S0c expected 20 cascaded ids, got ${out.length}`);
  }
  await setup();
  const NM = 100;
  const noMatchMs = await benchAsync(async () => {
    await cascadeFeedbackTombstones(stateRoot, "ep_absent" as EpisodeId);
  }, NM);
  console.log(
    `S0c configured deletion cascade (N=200 records ${(fixtureBytes / 1024).toFixed(1)}KB, 20 matching): match=${((matchMs / REP) * 1e3).toFixed(0)}us/cascade | no-match=${((noMatchMs / NM) * 1e3).toFixed(0)}us/cascade (R8-J 666-717 / 256-275us; fail-closed 2-read order kept)`
  );
  await rm(stateRoot, { recursive: true, force: true });
}

/* ============================================================
 * Shared snapshot generator (S0d anchor + S9-J-3 fixtures).
 * ============================================================ */
const TRUSTS = ["HIGH", "MEDIUM", "LOW"] as const;

function genSnapshot(rnd: () => number, I: number, M: number, C: number, F: number): ProjectSnapshot {
  const root = "/repo";
  const mkPath = (stem: string): string => {
    const roll = rnd();
    if (roll < 0.15) return `${stem}.md`;
    if (roll < 0.3) return `${root}\\${stem}.md`;
    return `${root}/${stem}.md`;
  };
  const commands = Array.from({ length: C }, (_, i) => ({
    name: i === 0 && rnd() < 0.7 ? "test" : `cmd${i}`,
    command: `run-${i} --flag`
  }));
  return {
    id: "proj_r9j" as ProjectId,
    rootPath: root,
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: I }, (_, i) => ({ path: mkPath(`docs/inst${i}`) })),
    manifests: Array.from({ length: M }, (_, i) => ({ path: mkPath(`pkg${i}/package`) })),
    commands,
    facts: Array.from({ length: F }, (_, i) => ({
      key:
        rnd() < 0.25
          ? `architecture.part${Math.floor(rnd() * 12)}`
          : rnd() < 0.33
            ? `risk.item${Math.floor(rnd() * 12)}`
            : `fact.k${i}`,
      value: `v${Math.floor(rnd() * 6)}`,
      confidence: TRUSTS[Math.floor(rnd() * 3)]!
    }))
  };
}

function genOptions(rnd: () => number, snapshot: ProjectSnapshot): BuildProjectContextIndexOptions {
  const mkMap = (): Record<string, string> | undefined => {
    if (rnd() < 0.12) return undefined;
    const m: Record<string, string> = {};
    for (let i = 0; i < Math.floor(rnd() * 12); i++) m[`noise/${i}`] = `h${Math.floor(rnd() * 8)}`;
    for (const file of [...snapshot.instructionFiles, ...snapshot.manifests]) {
      if (rnd() < 0.4) m[file.path] = `h${Math.floor(rnd() * 8)}`;
    }
    for (const fact of snapshot.facts) {
      if (rnd() < 0.45) m[fact.key] = `h${Math.floor(rnd() * 8)}`;
    }
    return m;
  };
  return { sourceHashes: mkMap(), priorHashes: mkMap(), now: NOW };
}

/* ============================================================
 * Section 0d: whole-build CPU anchor.
 * ============================================================ */
const anchorSnapshot = genSnapshot(mulberry32(SEED_BASE * 733), 3, 2, 4, 30);
const anchorOptions = genOptions(mulberry32(SEED_BASE * 977), anchorSnapshot);
{
  const ITER = 2000;
  const ms = bench(() => {
    buildProjectContextIndex(anchorSnapshot, anchorOptions);
  }, ITER);
  console.log(
    `S0d buildProjectContextIndex configured (I=3 M=2 C=4 F=30, dual hash maps): ${((ms / ITER) * 1e3).toFixed(1)}us/build (R8-J band 18.5-21.2us)`
  );
}

/* ============================================================
 * Section 0e: track-loop slice-internal command class. The slice's
 * own CPU on startTrackedRun is clarify/plan/acceptance shaping;
 * everything else on that path is out-of-slice (routing) or I/O.
 * ============================================================ */
{
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "Add integration tests and coverage for the deployment pipeline",
    deliverables: [],
    constraints: [{ id: "c-tests", description: "tests required", source: "user" }] as unknown as RequirementContract["constraints"],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "ac-1", description: "pipeline verified", observableCheck: "ci" },
      { id: "ac-tests", description: "tests pass", observableCheck: "pnpm test" }
    ] as unknown as RequirementContract["acceptanceCriteria"],
    assumptions: [],
    questions: [
      { id: "q-tests", question: "require tests?", options: ["yes", "no"], default: "yes" },
      { id: "q-done", question: "done when?", options: [] }
    ] as unknown as RequirementContract["questions"],
    authority: [],
    sourceRefs: []
  };
  const questions = contract.questions as readonly DecisionQuestion[];
  const answers = { "q-tests": "yes", "q-done": "ship it" };
  const ITER = 20000;
  let sink = 0;
  const ms = bench(() => {
    const applied = applyAnswers(questions, answers);
    const children = planFromContract({ contract, answers: applied.resolved });
    for (const child of children) {
      sink += acceptanceForRole(child.role, contract).length;
    }
  }, ITER);
  console.log(
    `S0e track-loop slice-internal class (applyAnswers+planFromContract+acceptanceForRole, ${5}-child plan): ${((ms / ITER) * 1e3).toFixed(2)}us/plan`
  );
  if (sink === -1) console.log("sink");
}

/* ============================================================
 * S9-J-1: stripForbidden per-needle includes guard.
 * Baseline replica = production body (redaction.ts:88-94). Variant
 * probes `out.includes(needle)` on the EVOLVING string before each
 * split/join — absent-needle strips are identity, so skipping them
 * is value-equivalent and the sequential order semantics (a strip
 * can create a later needle's occurrence) are untouched.
 * ============================================================ */
function stripForbiddenBase(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) {
    out = out.split(needle).join("");
  }
  return out;
}

function stripForbiddenGuarded(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) {
    if (!out.includes(needle)) continue;
    out = out.split(needle).join("");
  }
  return out;
}

{
  /* Unit fuzz: random needle sets incl. overlapping/recombining shapes. */
  const rnd = mulberry32(SEED_BASE * 3301);
  let ok = true;
  const alphabet = ["sk-", "api", "_key", "AB", "BA", "aa", "a", "中", "\u0000", "BEGIN "];
  for (let trial = 0; trial < 2000; trial++) {
    const needles: string[] = [];
    const n = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      let needle = "";
      const parts = 1 + Math.floor(rnd() * 3);
      for (let p = 0; p < parts; p++) needle += alphabet[Math.floor(rnd() * alphabet.length)]!;
      needles.push(needle);
    }
    let text = "";
    const chunks = Math.floor(rnd() * 40);
    for (let c = 0; c < chunks; c++) {
      text += rnd() < 0.4 ? needles[Math.floor(rnd() * needles.length)]! : alphabet[Math.floor(rnd() * alphabet.length)]!;
    }
    if (!Object.is(stripForbiddenBase(text, needles), stripForbiddenGuarded(text, needles))) ok = false;
  }
  assertOk(ok, "S9-J-1 unit fuzz divergence");
  console.log(`S9-J-1 unit fuzz: 2000 trials (overlapping/recombining needles, CJK/NUL chars), Object.is identical: ${ok}`);
}

{
  /* Production end-to-end: full redactFeedback with a guarded-strip
   * replica across record shapes x policies (fidelity gate first). */
  const CLASS_ORDER = ["secret", "pii", "path", "prompt-injection", "oversized"] as const;
  type RClass = (typeof CLASS_ORDER)[number];
  const copyFeedbackR = (
    feedback: FeedbackRecord,
    patch: { redacted: boolean; body?: string | undefined; summary?: string | undefined; omitBody?: boolean | undefined }
  ): FeedbackRecord => {
    const nextBody = patch.omitBody === true ? undefined : patch.body !== undefined ? patch.body : feedback.body;
    const nextSummary = patch.summary !== undefined ? patch.summary : feedback.summary;
    return {
      id: feedback.id,
      episodeId: feedback.episodeId,
      kind: feedback.kind,
      rubricVersion: feedback.rubricVersion,
      score: feedback.score,
      evidenceRefs: feedback.evidenceRefs,
      redacted: patch.redacted,
      createdAt: feedback.createdAt,
      ...(feedback.runId !== undefined ? { runId: feedback.runId } : {}),
      ...(feedback.taskId !== undefined ? { taskId: feedback.taskId } : {}),
      ...(nextBody !== undefined ? { body: nextBody } : {}),
      ...(nextSummary !== undefined ? { summary: nextSummary } : {})
    };
  };
  const redactWith = (
    strip: (text: string, needles: readonly string[]) => string,
    feedback: FeedbackRecord,
    policy: RedactionPolicy
  ) => {
    const classes = new Set<RClass>();
    const droppedFields: string[] = [];
    let body = feedback.body;
    let summary = feedback.summary;
    let referenceOnly = false;
    const needles = [...(policy.forbiddenSubstrings ?? [])]
      .filter((needle) => needle.length > 0)
      .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    if (needles.length > 0) {
      const strippedBody = body !== undefined ? strip(body, needles) : undefined;
      const strippedSummary = summary !== undefined ? strip(summary, needles) : undefined;
      if (strippedBody !== body || strippedSummary !== summary) {
        classes.add("secret");
        body = strippedBody;
        summary = strippedSummary;
      }
    }
    if (policy.maxBodyChars !== undefined && body !== undefined && body.length > policy.maxBodyChars) {
      classes.add("oversized");
      droppedFields.push("body");
      body = undefined;
      referenceOnly = true;
    }
    if (policy.redactPII) classes.add("pii");
    const redacted = classes.size > 0;
    if (!redacted) {
      return { feedback, decision: { redacted: false, classes: [], droppedFields: [], referenceOnly: false } };
    }
    return {
      feedback: copyFeedbackR(feedback, {
        redacted: true,
        ...(body !== undefined ? { body } : { omitBody: true }),
        ...(summary !== undefined ? { summary } : {})
      }),
      decision: {
        redacted: true,
        classes: CLASS_ORDER.filter((entry) => classes.has(entry)),
        droppedFields,
        referenceOnly
      }
    };
  };
  const rnd = mulberry32(SEED_BASE * 7717);
  const policies: RedactionPolicy[] = [
    { redactPII: true, maxBodyChars: 400, forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"] },
    { redactPII: false, forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"] },
    { redactPII: false, forbiddenSubstrings: [] },
    { redactPII: false }
  ];
  let fidelityOk = true;
  let equivalenceOk = true;
  let identityOk = true;
  for (let seed = 1; seed <= 100; seed++) {
    for (const withBody of [true, false]) {
      for (const withSummary of [true, false]) {
        const secretish = rnd() < 0.5 ? `sk-${Math.floor(rnd() * 10)} api_key=x BEGIN PRIVATE` : "clean text";
        const record: FeedbackRecord = {
          id: `fb_${seed}`,
          episodeId: "ep_r9j" as EpisodeId,
          kind: "judge",
          rubricVersion: "1",
          score: Math.floor(rnd() * 101),
          evidenceRefs: [],
          redacted: false,
          createdAt: NOW,
          ...(withBody ? { body: `body ${secretish} ${"x".repeat(Math.floor(rnd() * 500))}` } : {}),
          ...(withSummary ? { summary: `summary ${secretish}` } : {})
        };
        for (const policy of policies) {
          const prod = redactFeedback(record, policy);
          const base = redactWith(stripForbiddenBase, record, policy);
          const vari = redactWith(stripForbiddenGuarded, record, policy);
          const prodJson = JSON.stringify(prod);
          if (prodJson !== JSON.stringify(base)) fidelityOk = false;
          if (prodJson !== JSON.stringify(vari)) equivalenceOk = false;
          if (!prod.decision.redacted && (base.feedback !== record || vari.feedback !== record)) identityOk = false;
        }
      }
    }
  }
  assertOk(fidelityOk, "S9-J-1 baseline replica does not match production redactFeedback");
  assertOk(equivalenceOk, "S9-J-1 guarded variant does not match production redactFeedback");
  assertOk(identityOk, "S9-J-1 non-redacted identity broken");
  console.log(
    `S9-J-1 end-to-end: 100 seeds x 4 shapes x 4 policies, replica fidelity=${fidelityOk}, guarded-vs-production byte-equal=${equivalenceOk}, non-redacted identity=${identityOk}`
  );

  /* Bench: production REDACTION needle set (4 needles), miss-heavy
   * realistic body vs hit-heavy body. */
  const needles = ["BEGIN PRIVATE", "API_KEY", "api_key", "sk-"];
  const missBody = "The reviewer confirmed the change keeps contracts stable and tests green across the suite. ".repeat(3);
  const hitBody = `The key sk-abc leaked next to api_key=1 in config. ${"pad ".repeat(40)}`;
  const ITER = 200000;
  let sink = 0;
  const missBase = bench(() => {
    sink += stripForbiddenBase(missBody, needles).length;
  }, ITER);
  const missVar = bench(() => {
    sink += stripForbiddenGuarded(missBody, needles).length;
  }, ITER);
  const hitBase = bench(() => {
    sink += stripForbiddenBase(hitBody, needles).length;
  }, ITER);
  const hitVar = bench(() => {
    sink += stripForbiddenGuarded(hitBody, needles).length;
  }, ITER);
  console.log(
    `S9-J-1 bench (4 production needles): miss-all base=${((missBase / ITER) * 1e6).toFixed(0)}ns var=${((missVar / ITER) * 1e6).toFixed(0)}ns delta=${(((missBase - missVar) / ITER) * 1e6).toFixed(0)}ns/strip | hit-2 base=${((hitBase / ITER) * 1e6).toFixed(0)}ns var=${((hitVar / ITER) * 1e6).toFixed(0)}ns delta=${(((hitBase - hitVar) / ITER) * 1e6).toFixed(0)}ns/strip | jsonl append floor after this call: see S0b`
  );
  if (sink === -1) console.log("sink");
}

/* ============================================================
 * S9-J-2: rebuildViews internal `weights` accumulator Record -> Map.
 * aggregates MUST stay Record (public PreferenceView shape). The
 * hazard is prototype-key inputs (obs.key in {__proto__, toString,
 * constructor, ...}): Record reads return inherited values, Map reads
 * return undefined. Equivalence argument: every use of currentW is
 * gated by `typeof current === "number"` or `currentW > 0`, and for
 * prototype keys `current` (read from the aggregates Record, which
 * both variants share) is never a number, so the gates close
 * identically on both sides. Fuzz includes those keys explicitly.
 * ============================================================ */
interface ViewLite {
  scope: string;
  scopeKey: string;
  aggregates: Record<string, string | number | boolean>;
  confidence: number;
  sourceCount: number;
}

function rebuildReplica(
  observations: readonly PreferenceObservation[],
  minInferredRecurrence: number,
  weightsAsMap: boolean
): Map<string, ViewLite> {
  const views = new Map<string, ViewLite>();
  const byPair = new Map<string, PreferenceObservation[]>();
  for (const obs of observations) {
    const key = `${obs.scope}:${obs.scopeKey}`;
    const list = byPair.get(key) ?? [];
    list.push(obs);
    byPair.set(key, list);
  }
  byPair.forEach((obsList, key) => {
    const first = obsList[0];
    if (!first) return;
    const aggregates: Record<string, string | number | boolean> = {};
    const weightsRecord: Record<string, number> = {};
    const weightsMap = new Map<string, number>();
    const explicitAnchored = new Set<string>();
    let sourceCount = 0;
    let explicitOverrides = 0;
    let inferredConflicts = 0;
    for (const obs of obsList) {
      if (!obs.explicit && obs.recurrenceCount < minInferredRecurrence) continue;
      sourceCount += 1;
      const current = aggregates[obs.key];
      const currentW = weightsAsMap ? (weightsMap.get(obs.key) ?? 0) : (weightsRecord[obs.key] ?? 0);
      const hasConflict = current !== undefined && current !== obs.value;
      if (obs.explicit) {
        aggregates[obs.key] = obs.value;
        if (weightsAsMap) weightsMap.set(obs.key, obs.weight);
        else weightsRecord[obs.key] = obs.weight;
        explicitAnchored.add(obs.key);
        if (hasConflict) explicitOverrides += 1;
      } else if (!hasConflict) {
        if (typeof obs.value === "number" && typeof current === "number" && (currentW as number) > 0) {
          if (weightsAsMap) weightsMap.set(obs.key, (currentW as number) + obs.weight);
          else weightsRecord[obs.key] = (currentW as number) + obs.weight;
        } else {
          aggregates[obs.key] = obs.value;
          if (weightsAsMap) weightsMap.set(obs.key, obs.weight);
          else weightsRecord[obs.key] = obs.weight;
        }
      } else if (explicitAnchored.has(obs.key)) {
        inferredConflicts += 1;
      } else if (typeof current === "number" && typeof obs.value === "number") {
        const merged =
          ((current as number) * (currentW as number) + (obs.value as number) * obs.weight) /
          ((currentW as number) + obs.weight);
        aggregates[obs.key] = merged;
        if (weightsAsMap) weightsMap.set(obs.key, (currentW as number) + obs.weight);
        else weightsRecord[obs.key] = (currentW as number) + obs.weight;
        inferredConflicts += 1;
      } else {
        inferredConflicts += 1;
      }
    }
    const base = Math.min(1, sourceCount / 5);
    const confidence = Math.max(0, Math.min(1, base + 0.25 * explicitOverrides - 0.25 * inferredConflicts));
    views.set(key, { scope: first.scope, scopeKey: first.scopeKey, aggregates, confidence, sourceCount });
  });
  return views;
}

function genObservationList(rnd: () => number, n: number, protoKeys: boolean): PreferenceObservation[] {
  const scopes: PreferenceScope[] = ["user", "project", "task-family", "role", "model"];
  const keyPool = protoKeys
    ? ["__proto__", "toString", "constructor", "hasOwnProperty", "valueOf", "k0", "k1", "k2"]
    : ["k0", "k1", "k2", "k3", "k4", "k5", "k6"];
  const out: PreferenceObservation[] = [];
  for (let i = 0; i < n; i++) {
    const valueRoll = rnd();
    const value: string | number | boolean =
      valueRoll < 0.45
        ? Math.floor(rnd() * 8) + (rnd() < 0.3 ? 0.5 : 0)
        : valueRoll < 0.8
          ? `v${Math.floor(rnd() * 4)}`
          : rnd() < 0.5;
    out.push({
      id: `obs_${i}`,
      scope: scopes[Math.floor(rnd() * scopes.length)]!,
      scopeKey: `sk${Math.floor(rnd() * 4)}`,
      key: keyPool[Math.floor(rnd() * keyPool.length)]!,
      value,
      evidenceEpisodeId: "ep_r9j" as EpisodeId,
      weight: 0.5 + Math.floor(rnd() * 4) * 0.5,
      createdAt: NOW,
      explicit: rnd() < 0.3,
      recurrenceCount: 1 + Math.floor(rnd() * 3)
    });
  }
  return out;
}

function serializeViews(views: Map<string, ViewLite>): string {
  return JSON.stringify(
    [...views.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => [
      k,
      v.scope,
      v.scopeKey,
      Object.entries(v.aggregates),
      v.confidence,
      v.sourceCount
    ])
  );
}

{
  /* Replica-vs-replica fuzz incl. prototype keys. */
  let ok = true;
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(SEED_BASE * 15485863 + seed * 6151);
    const protoKeys = seed % 2 === 0;
    const list = genObservationList(rnd, 1 + Math.floor(rnd() * 120), protoKeys);
    const a = rebuildReplica(list, MIN_INFERRED_RECURRENCE_DEFAULT, false);
    const b = rebuildReplica(list, MIN_INFERRED_RECURRENCE_DEFAULT, true);
    if (serializeViews(a) !== serializeViews(b)) ok = false;
  }
  assertOk(ok, "S9-J-2 Record-vs-Map weights divergence");
  console.log(
    `S9-J-2 fuzz: 400 seeds (200 with __proto__/toString/constructor/hasOwnProperty/valueOf keys), views byte-equal incl. aggregate entry order: ${ok}`
  );

  /* Production fidelity gate: drive the real store (persistence left
   * unconfigured so saveToDisk no-ops) and check the Record replica
   * reproduces production getView on every touched pair. */
  let fidelityOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = mulberry32(SEED_BASE * 104729 + seed * 7919);
    resetPreferenceStore();
    const list = genObservationList(rnd, 1 + Math.floor(rnd() * 60), seed % 2 === 0);
    for (const obs of list) recordObservation(obs);
    const stored = listObservations();
    const replica = rebuildReplica(stored, MIN_INFERRED_RECURRENCE_DEFAULT, false);
    const pairs = new Set(stored.map((o) => `${o.scope}:${o.scopeKey}`));
    for (const pair of pairs) {
      const [scope, scopeKey] = pair.split(":") as [PreferenceScope, string];
      const prod = getView(scope, scopeKey);
      const mine = replica.get(pair);
      if (prod === undefined || mine === undefined) {
        fidelityOk = false;
        continue;
      }
      if (
        JSON.stringify(Object.entries(prod.aggregates)) !== JSON.stringify(Object.entries(mine.aggregates)) ||
        !Object.is(prod.confidence, mine.confidence) ||
        prod.sourceCount !== mine.sourceCount
      ) {
        fidelityOk = false;
      }
    }
  }
  resetPreferenceStore();
  assertOk(fidelityOk, "S9-J-2 baseline replica does not match production rebuildViews");
  console.log(`S9-J-2 production fidelity: 40 seeds, replica-vs-getView field-equal (aggregates entries, confidence, sourceCount): ${fidelityOk}`);

  /* Bench at the unbounded dimension N=1000, P=20 pairs. */
  const rnd = mulberry32(SEED_BASE * 6007);
  const big = genObservationList(rnd, 1000, false);
  const ITER = 2000;
  const recMs = bench(() => {
    rebuildReplica(big, MIN_INFERRED_RECURRENCE_DEFAULT, false);
  }, ITER);
  const mapMs = bench(() => {
    rebuildReplica(big, MIN_INFERRED_RECURRENCE_DEFAULT, true);
  }, ITER);
  console.log(
    `S9-J-2 bench (N=1000): record=${((recMs / ITER) * 1e3).toFixed(2)}us map=${((mapMs / ITER) * 1e3).toFixed(2)}us delta=${(((recMs - mapMs) / ITER) * 1e3).toFixed(2)}us/rebuild | same-path saveToDisk floor: see S0a`
  );
}

/* ============================================================
 * S9-J-3: buildProjectContextIndex architecture/risks two-pass fusion.
 * Baseline replica = two filter().sort().map() chains (index.ts:140-147).
 * Variant = one pass splitting into two {key,value} lists, then the
 * same per-list sort + value map. Filter preserves subsequence order,
 * so each sort sees identical input order => identical stable output.
 * ============================================================ */
type SnapFact = ProjectSnapshot["facts"][number];

function archRisksBase(facts: readonly SnapFact[]): { architecture: string[]; risks: string[] } {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const architecture = facts
    .filter((fact) => fact.key.startsWith("architecture."))
    .sort((a, b) => cmp(a.key, b.key))
    .map((fact) => fact.value);
  const risks = facts
    .filter((fact) => fact.key.startsWith("risk."))
    .sort((a, b) => cmp(a.key, b.key))
    .map((fact) => fact.value);
  return { architecture, risks };
}

function archRisksFused(facts: readonly SnapFact[]): { architecture: string[]; risks: string[] } {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const archFacts: SnapFact[] = [];
  const riskFacts: SnapFact[] = [];
  for (const fact of facts) {
    if (fact.key.startsWith("architecture.")) archFacts.push(fact);
    else if (fact.key.startsWith("risk.")) riskFacts.push(fact);
  }
  return {
    architecture: archFacts.sort((a, b) => cmp(a.key, b.key)).map((fact) => fact.value),
    risks: riskFacts.sort((a, b) => cmp(a.key, b.key)).map((fact) => fact.value)
  };
}

{
  let fidelityOk = true;
  let equivalenceOk = true;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(SEED_BASE * 31 + seed * 2903);
    const snapshot = genSnapshot(
      rnd,
      1 + Math.floor(rnd() * 5),
      1 + Math.floor(rnd() * 4),
      1 + Math.floor(rnd() * 5),
      Math.floor(rnd() * 60)
    );
    const options = genOptions(rnd, snapshot);
    const prod = buildProjectContextIndex(snapshot, options);
    const base = archRisksBase(snapshot.facts);
    const fused = archRisksFused(snapshot.facts);
    if (JSON.stringify({ architecture: prod.architecture, risks: prod.risks }) !== JSON.stringify(base)) fidelityOk = false;
    if (JSON.stringify(base) !== JSON.stringify(fused)) equivalenceOk = false;
  }
  assertOk(fidelityOk, "S9-J-3 baseline replica does not match production architecture/risks");
  assertOk(equivalenceOk, "S9-J-3 fused variant diverges");
  console.log(`S9-J-3 end-to-end: 60 seeds (duplicate-key ties included), replica fidelity=${fidelityOk}, fused-vs-base byte-equal=${equivalenceOk}`);

  const realistic = anchorSnapshot.facts;
  const stressSnap = genSnapshot(mulberry32(SEED_BASE * 43), 3, 2, 4, 2000);
  const ITER_R = 200000;
  const ITER_S = 2000;
  let sink = 0;
  const baseR = bench(() => {
    sink += archRisksBase(realistic).architecture.length;
  }, ITER_R);
  const varR = bench(() => {
    sink += archRisksFused(realistic).architecture.length;
  }, ITER_R);
  const baseS = bench(() => {
    sink += archRisksBase(stressSnap.facts).architecture.length;
  }, ITER_S);
  const varS = bench(() => {
    sink += archRisksFused(stressSnap.facts).architecture.length;
  }, ITER_S);
  console.log(
    `S9-J-3 bench: realistic F=30 base=${((baseR / ITER_R) * 1e6).toFixed(0)}ns var=${((varR / ITER_R) * 1e6).toFixed(0)}ns delta=${(((baseR - varR) / ITER_R) * 1e6).toFixed(0)}ns/build | stress F=2000 base=${((baseS / ITER_S) * 1e3).toFixed(1)}us var=${((varS / ITER_S) * 1e3).toFixed(1)}us delta=${(((baseS - varS) / ITER_S) * 1e3).toFixed(1)}us/build (whole build: see S0d; once per run)`
  );
  if (sink === -1) console.log("sink");
}

/* ============================================================
 * S9-J-4: decideClosure structured-pass short-circuit. When
 * structuredMatch === true the current code still runs the legacy
 * `evd_<id>` probe over evidenceRefs whose result is dead
 * (structuredMatch !== true && !legacyMatch is already false).
 * The probe is pure over schema-legal (string) refs, so skipping
 * it is equivalent.
 * ============================================================ */
function decideClosureVariant(
  episode: ProjectEpisode,
  _latestRunIds: readonly RunId[]
): { canClose: boolean; reason: string; requiredEvidence: string[] } {
  if (episode.status !== "OPEN" && episode.status !== "WAITING_FOR_USER") {
    return { canClose: false, reason: "already-closed", requiredEvidence: [] };
  }
  const acceptanceEvidence = (
    episode as ProjectEpisode & {
      readonly acceptanceEvidence?: readonly {
        readonly criterionId: string;
        readonly evidenceId: string;
        readonly result: "PASSED" | "FAILED" | "UNOBSERVED";
      }[];
    }
  ).acceptanceEvidence;
  const missing = episode.acceptance
    .filter((criterion) => {
      const structuredMatch = acceptanceEvidence?.some(
        (evidence) =>
          evidence.criterionId === criterion.id &&
          evidence.result === "PASSED" &&
          episode.evidenceRefs.includes(evidence.evidenceId as ProjectEpisode["evidenceRefs"][number])
      );
      if (structuredMatch === true) return false;
      const legacyMatch = episode.evidenceRefs.some((ref) => String(ref) === `evd_${criterion.id}`);
      return !legacyMatch;
    })
    .map((criterion) => criterion.id);
  if (missing.length > 0) {
    return { canClose: false, reason: "acceptance-incomplete", requiredEvidence: missing };
  }
  return { canClose: true, reason: "all-criteria-met", requiredEvidence: [] };
}

function genEpisode(rnd: () => number, criteria: number, refs: number, structuredBias: number): ProjectEpisode {
  const acceptance = [] as { id: string; description: string; observableCheck: string }[];
  for (let i = 0; i < criteria; i++) {
    acceptance.push({ id: `ac${i}`, description: `crit ${i}`, observableCheck: `check ${i}` });
  }
  const evidenceRefs: string[] = [];
  for (let i = 0; i < refs; i++) {
    evidenceRefs.push(rnd() < 0.3 ? `evd_ac${Math.floor(rnd() * criteria)}` : `evd_other_${i}`);
  }
  const acceptanceEvidence =
    rnd() < 0.75
      ? acceptance
          .filter(() => rnd() < structuredBias)
          .map((c) => ({
            criterionId: c.id,
            evidenceId: `evd_s_${c.id}`,
            result: (rnd() < 0.85 ? "PASSED" : "FAILED") as "PASSED" | "FAILED",
            sourceRef: "sim"
          }))
      : undefined;
  if (acceptanceEvidence !== undefined) {
    for (const ev of acceptanceEvidence) {
      if (rnd() < 0.8) evidenceRefs.push(ev.evidenceId);
    }
  }
  const statusPool: ProjectEpisode["status"][] = ["OPEN", "WAITING_FOR_USER", "COMPLETED"];
  return {
    id: "ep_r9j" as EpisodeId,
    projectId: "proj_r9j" as ProjectId,
    objective: "sim",
    contractVersion: 1,
    runIds: ["run_1" as RunId],
    startedAt: NOW,
    status: statusPool[Math.floor(rnd() * 3)]!,
    acceptance: acceptance as unknown as ProjectEpisode["acceptance"],
    evidenceRefs: evidenceRefs as unknown as readonly EvidenceId[],
    ...(acceptanceEvidence !== undefined ? { acceptanceEvidence } : {})
  } as ProjectEpisode;
}

{
  let ok = true;
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(SEED_BASE * 613 + seed * 4241);
    const episode = genEpisode(rnd, 1 + Math.floor(rnd() * 8), Math.floor(rnd() * 40), rnd());
    const a = decideClosure(episode, episode.runIds);
    const b = decideClosureVariant(episode, episode.runIds);
    if (JSON.stringify(a) !== JSON.stringify(b)) ok = false;
  }
  assertOk(ok, "S9-J-4 divergence vs production decideClosure");
  console.log(`S9-J-4 end-to-end: 300 seeds (mixed structured/legacy/none, 3 statuses), variant-vs-production byte-equal: ${ok}`);

  /* Bench: all-structured-pass fixture (max benefit) and mixed. */
  const allStructured = genEpisode(mulberry32(SEED_BASE * 5), 6, 24, 1.0);
  const mixed = genEpisode(mulberry32(SEED_BASE * 6), 6, 24, 0.4);
  const ITER = 200000;
  let sink = 0;
  const asBase = bench(() => {
    sink += decideClosure(allStructured, allStructured.runIds).requiredEvidence.length;
  }, ITER);
  const asVar = bench(() => {
    sink += decideClosureVariant(allStructured, allStructured.runIds).requiredEvidence.length;
  }, ITER);
  const mxBase = bench(() => {
    sink += decideClosure(mixed, mixed.runIds).requiredEvidence.length;
  }, ITER);
  const mxVar = bench(() => {
    sink += decideClosureVariant(mixed, mixed.runIds).requiredEvidence.length;
  }, ITER);
  console.log(
    `S9-J-4 bench (C=6,R=24, once per closure attempt): all-structured base=${((asBase / ITER) * 1e6).toFixed(0)}ns var=${((asVar / ITER) * 1e6).toFixed(0)}ns delta=${(((asBase - asVar) / ITER) * 1e6).toFixed(0)}ns/decision | mixed base=${((mxBase / ITER) * 1e6).toFixed(0)}ns var=${((mxVar / ITER) * 1e6).toFixed(0)}ns delta=${(((mxBase - mxVar) / ITER) * 1e6).toFixed(0)}ns/decision`
  );
  if (sink === -1) console.log("sink");
}

console.log(`checks=${checks} failures=${failures}`);
if (failures > 0) process.exitCode = 1;
```

MORE_OPTIMA=no
BRANCH=cursor/r9-j-persist-ninth-pass-83a1

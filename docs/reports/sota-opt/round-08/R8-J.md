MODEL_SLUG=claude-fable-5-thinking-xhigh

# R8-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第八遍复查报告

**战役:** 全库持久 SOTA 优化 Round 8 / R8-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `263e0e0`（独占 tip，含 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3 / S8-F-1..3 / S8-H-1..3 排除全表）
**分支:** `cursor/r8-j-persist-eighth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动，切片维持关闭。** 切片 29 个文件
（3655 行）自 J1 落地（`fb41417`）以来**逐字节未变**（`git diff
fb41417..263e0e0 -- <29 文件>` 输出为空，经 R2-J..R7-J 与本轮共七遍复查
累计零后续代码改动）。R7-J 基线（`75b0387`）之后 `src/` 仅落地 S7-C
（`183df9b`，`routing/irls.ts` 邻域）与 S7-I-1（`8dee7fb`，
`cli/model-catalog.ts` + `pi-adapter/listed-model*.ts`），R8-A…R8-H 全部
为纯报告提交 ⇒ 生产调用图对本切片**可证不变**；唯一切入点是
`track/loop.ts` import 的 `buildLiveCatalogConfig`——S7-I-1 把 builtin
模型表改为按 provider 惰性构建，只会**降低**该链成本，未引入新热循环。
按 R7-I 教训先补配置态锚点再猎新角度：本 VM 实测 preferences
`saveToDisk` 地板 **519–548µs/写**（R7-J 638–817µs 带下沿、本 VM 略快，
I/O 支配判据第八次成立）、jsonl 追加 fsync=false **69–72µs** /
fsync=true **250–483µs**（fsync 溢价 0.18–0.41ms，与 R8-D 0.39–0.52ms
同带）、**配置态删除级联首次锚定**（N=200 条 49.9KB、20 条命中：
match=**666–717µs**/级联、no-match=**256–275µs**/级联——两读保持
fail-closed 顺序）、`buildProjectContextIndex` 双 hash map 配置态
**18.5–21.2µs**/构建——配置态无隐藏悬崖，与 R8-D/R8-H 的发现同向。
第八遍在完整排除表之上以**两个从未点名的位点**枚举得到 2 个新候选
（S8-J-1、S8-J-2），全部经理论 + 确定性 seeded 仿真（mulberry32，
逐位等价含 60-seed 生产端到端 fidelity 闸）+ 真实规模基准（三次独立
运行等价结论逐位一致）裁决后淘汰：S8-J-1（`sourcedFact` 跨调用 CSE，
`providedCurrent` 重算 `resolveHash` 刚做过的同一 `sourceHashes` 探针）
逐位等价但 **8.1–47.0ns/调用、446–614ns/构建、每 run 一次**——距落地线
≥4 个数量级；S8-J-2（`appendJsonlLine` fsync 路径单句柄合并，省
appendFile 内部的 open/close 对）字节+读面逐位等价、裸 open/close 对
实测 30.9–32.5µs，但三次运行 delta **符号不稳**（−66.6 / +13.2 /
+125.6µs——被 fsync 抖动整体吞没）、只在终局追加触发（每 run ≤2 次）、
且**外部 unlink 窗口面可观察发散**（确定性演示：现行重开重建空文件、
变体文件消失）——持久层强调区三重淘汰。J1 落地代码本轮
`scripts/r1j-equivalence-sim.ts` 重跑全绿（2468 项逐位检查，2688.7×），
`evaluatePreferenceLoop` / `queryPacketGrounding` re-grep 再证零生产
调用方。未重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* /
S7-* / S8-A/B/C/D/E/F/H-* 条目。现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`（3）、`src/privacy/`（3）、`src/preferences/`（7）、
  `src/episode/`（5）、`src/persist/`（2）、`src/track/`（4）、
  `src/context/`（2）、`src/feedback/`（3）共 29 文件 3655 行全量第八遍
  实际读码，未依赖前七轮记忆。上下游 `run/{event-store,episode-store}.ts`
  （fsync=true 唯一调用方取证）、`cli/model-catalog.ts`（S7-I-1 落地面
  取证）只读，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（全表，含继承 X0–X4、
  S1–S7 全部 ID 及 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 /
  S8-E-1..3 / S8-F-1..3 / S8-H-1..3；S8-G / S8-I 在飞未引用）/
  round-08/PLAN.md / round-07/PLAN.md / round-01/R1-J.md …
  round-07/R7-J.md。S7-C 已落地于 offline-logit 邻域，未触碰。J1 未重做
  （本轮重跑其等价仿真全绿）。S8-E-1（双 loadLearnedRouting）未重开——
  track/loop 虽是调用位点，该 ID 已闭。
- 换名重提检查（识别为既有方案换名/换位点，**未列为新候选**）：
  - `preferences/store.ts` `rebuildViews` 显式分支的 `explicitAnchored.add(obs.key)`
    对已锚定 key 是幂等冗余写 = S5-J-4 / S7-J-4「冗余集合写」家族第三
    站点（Set.add 本身幂等，条件化守卫反而加读），拒列；
  - `track/loop.ts` children 构造中的条件 spread 改后置赋值 = S8-A-3 /
    S8-E-2 / S8-H-1 明文点名的 **PIC 形状伪影类**（R8-H 实测同型改动
    反噬 −41~−52ns），非候选，拒列；
  - `context/index.ts` `isUnderGenerated` 对每个 dirty×generated 组合
    重算 `relativeToRoot` = S1-J-6 一次性前缀匹配索引家族换位点，拒列；
  - `buildProjectContextIndex` manifests 循环重算 `relativeToRoot` =
    R4-J 已按 S3-J-2 同规模收口，拒列；
  - `track/loop.ts` `waitForClarification` 多次 `nowIso()` 合并共享 =
    S3-J-5 可观察时间戳面（occurredAt 分布即契约），拒列；
  - `cluster/host.ts` role-cast 每 target 条件 spread topic + 每 target
    `stampMail` 时间戳 = S2-J-3 / R5-J trim 提升家族 + S3-J-5 可观察面，
    拒列；
  - `context/packet.ts` `collapseFacts` 单值组仍 spread+sort = S7-J-1
    同函数域 ns 级微分配，拒列；
  - `persist/jsonl.ts` 每 append `mkdir` 缓存化 = S7-J-6 自愈语义收窄
    同款（R3-J 已裁 jsonl 侧），拒列。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无命令权、
  live = R0 等价、双 LCB 与双归因保留、saveToDisk 每写 mkdir 自愈保留
  （S7-J-6）、删除级联 fail-closed 保留（S6-J-1 / S5-J-3——S0c 基准
  经由生产函数原样测量，两读顺序未动）、无 Promise.all 双故障竞态引入
  （S2-J-10 / S4-J-2）、stripForbidden 未动（S3-J-1）、loop-eval
  lastUpdated / tombstone / 增量 fold 可观察面未动（S1-J-1 / J1）、
  reduceEpisodeEvents 无输入别名回归（S6-J-5）、mailbox / privacy /
  episode 数据面强调区零契约收窄（S8-J-2 正因窗口面发散被淘汰）、
  阈值 / 测试 / CAS / 凭据 / 公开签名不变。不声称 Outcome-supported，
  Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性、调用图复核与 I/O 地板重测（含配置态）

1. **切片逐字节未变**：`git diff fb41417..263e0e0 -- src/{cluster,privacy,preferences,episode,persist,feedback}/ src/track/{primary-split,plan,clarify,loop}.ts src/context/{index,packet}.ts`
   输出为空（29 文件 3655 行，八遍全程 J1 之外零 diff）。R1-J…R7-J 全部
   逐函数收口与 S*-J-* 排除继承有效。
2. **调用图可证不变**：`git log 75b0387..263e0e0 -- src/` 仅 S7-C
   （`183df9b`）与 S7-I-1（`8dee7fb`）两组落地（余为 merge/报告提交），
   无一触碰本切片文件；唯一间接切入点 `track/loop.ts` →
   `buildLiveCatalogConfig`（`cli/model-catalog.ts`）经 S7-I-1 改为
   per-provider 惰性 builtin 表，成本单调下降，无新热循环流入切片。
   生产调用面 re-grep 校准与 R7-J 一致：`evaluatePreferenceLoop` 与
   `queryPacketGrounding` 在 `src/` 仍仅存在于各自定义文件（test-only
   面维持）；`appendJsonlLine` 四个调用方中 fsync 参数非 false 的只有
   `run/event-store.ts:39`（`TERMINAL_EVENT_TYPES.has(type)`）与
   `run/episode-store.ts:36`（`TERMINAL_EPISODE_STATUSES.has(status)`）
   ——即 fsync=true 每 run 至多个位数次（终局事件）。
3. **I/O 地板 vs CPU 重测（本 VM，Node v22.22.2，overlay fs；三次独立
   运行）**：

```text
S0a preferences saveToDisk floor replica (N=1000 obs): 548 / 519 / 532 us/write   (R7-J band 638-817us, 本 VM 略快)
S0b jsonl append floor: fsync=false 69.3-72.0us | fsync=true 250.2-483.1us | fsync premium 0.180-0.414ms/append
S0c configured deletion cascade (N=200 records 49.9KB, 20 matching):
    match=666-717us/cascade (read+strip+rewrite+tombstones) | no-match=256-275us/cascade (两读保持 fail-closed 顺序)
S0d buildProjectContextIndex configured (I=3 M=2 C=4 F=30, dual hash maps): 18.5-21.2us/build | sourcedFact calls/build=39
```

   方向与七轮判例一致：唯一无上界增长维度（preference 观察数 N、
   feedback 记录数 N）仍被同路径全量序列化 + 磁盘 I/O 支配
   （S0a=519–548µs 写地板、S0c=666–717µs 级联地板），切片内全部具名
   CPU 成分维持 ns–µs 级。**配置态首测补齐**（R7-I 教训）：删除级联
   「有匹配」路径此前七轮只有默认态/无匹配锚点，本轮 20/200 命中档
   实测后确认匹配路径由「读 50KB + 全量重写 + tombstones 落盘」构成，
   无 CPU 可寻址新成分；no-match 路径两读 256–275µs 即 S5-J-3 裁定
   保留的 fail-closed 价格。配置态 × 命令类矩阵其余格：track/loop 带
   learned routing 只触 `assign.ts`（切片外，S8-E-1 已闭未重开）；
   preferences export 带 scopes = S5-J-1 收口域；mailbox P>1
   claim/enqueue = R1-J / S5-J-4 收口域；redaction 有/无文本 =
   S7-J-5 收口域。矩阵无空洞。
4. **J1 落地代码复核**：`npx tsx scripts/r1j-equivalence-sim.ts` 全绿
   （ALL EQUIVALENCE CHECKS PASSED, 2468 bitwise checks；perf fixture
   reference 10332.8ms → current 3.8ms = **2688.7×**）。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 方案 | 理论收益 | 仿真 | 基准（三次独立运行） | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-J-1 | `context/index.ts` `sourcedFact` 跨调用 CSE：L300 `providedCurrent = resolveFromMap(options.sourceHashes, sourceKey, alternateKey, key)` 与 L298 `resolveHash(...)`（→ 同一 `resolveFromMap(options.sourceHashes, ...)`）是**同参同映射的纯探针重算**，候选先探一次、`current = providedCurrent ?? hash32(fallback)`（≠ S5-J-5 的**函数内**属性双读 CSE——本条是**跨调用**整链重算，八遍首次点名） | 免每 fact 一次 O(探针深度) Record 链查 | ✅ 500 trial 单元 fuzz（全探针形态：sourceKey/alternateKey/factKey 命中、全 miss、map undefined）field-wise `Object.is` 逐位一致；✅ 60-seed 生产端到端：baseline replica vs 生产 `buildProjectContextIndex().facts` **fidelity 闸**逐字节一致，CSE 变体 vs 生产逐字节一致（三次运行同判） | hit-sourceKey 省 **8.1–11.5ns/调用**；hit-factKey（最深探针）省 29.1–47.0ns；miss-all 省 33.2–39.7ns；39 调用现实构建混合档省 **446–614ns/构建**，每 run 一次性（S0d 全构建 18.5–21.2µs） | 淘汰：ns 级一次性构建噪声，距数十 ms 落地线 ≥4 个数量级（S5-J-5 / S4-J-6 / S2-J-4 同域判据）；`sourcedFact` 分解至此闭合（探针链 S5-J-5、relativeToRoot R4-J、本条跨调用重算） |
| S8-J-2 | `persist/jsonl.ts` `appendJsonlLine` fsync=true 路径单句柄合并：现行 `appendFile`（内部 open/write/close）后**再** `open(path,"a")` + `sync()` + `close()`，候选一次 `open("a")` → `writeFile` → `sync()` → `close()`（省一对 open/close；字节格式、mkdir 自愈、先写后刷次序全保留；≠ S8-D-3 的**去 fsync**——本条保 fsync 只并句柄，jsonl 侧 fsync 路径八遍首次点名） | 免 1 次 open+close 系统调用对/终局追加 | ✅ 40 序列 fuzz（混合 fsync 标志、unicode/长行、序中外删目录自愈）字节 + `readJsonlObjects` 读面逐位一致（三次运行同判）；❌ **外部 unlink 窗口演示**（确定性）：追加与 sync 之间外删文件——现行 reopen **重建空文件**（exists=true size=0，sync 成功），变体字节只存活在已 unlink 的 inode（**exists=false**）——崩溃/外扰后可观察面不同 | 裸 open/close 对 = **30.9–32.5µs**；fsync=true 追加全程 current=225.6–305.2µs vs variant=179.6–338.9µs，delta 三次运行 **−66.6 / +13.2 / +125.6µs——符号不稳**，被 fsync 抖动（S0b premium 0.18–0.41ms）整体吞没；触发频次 = 终局追加（每 run ≤2 次，`run/{event,episode}-store.ts` 唯二调用方） | 淘汰：µs 级收益低于 fsync 噪声带（方向都测不稳）+ 每 run 个位数次一次性 + 外扰窗口面可观察发散（persist 耐久性强调区「不以 µs 换契约面」，S7-J-6 / S8-D-3 同区判据），三重淘汰 |

## 3. 关键裁决细节

### 3.1 S8-J-1：S5-J-5 之后 sourcedFact 里最后一处未点名的重算

S5-J-5 裁的是 `resolveFromMap` **函数内**每个 Record 的属性双读
（守卫 + return，~10ns/查）；本条是**跨调用**层面的整链重算：
`sourcedFact` 先经 `resolveHash` 探一遍 `options.sourceHashes`
（L298，作 `current` 的首选来源），两行之后又以完全相同的四个实参
把同一条探针链整个重跑一遍（L300 `providedCurrent`）。等价性是纯
函数意义上平凡的（Readonly Record 探针，无副作用、无中间写点），
但仍按纪律走了 fidelity 闸——60-seed 端到端先证 baseline replica 与
生产 `buildProjectContextIndex().facts` 逐字节一致（防「仿真副本
漂移」假阳性），再证 CSE 变体与生产逐字节一致。基准三档探针形态
省 8.1–47.0ns/调用；39 次调用的现实构建混合档省 446–614ns/构建，
而该构建每 run 一次、全程本身只有 18.5–21.2µs。距落地线 ≥4 个数量级，
S5-J-5 / S4-J-6 同域判据原样适用。至此 `sourcedFact` 的每个成分都有
具名锚点（探针链、fallback hash32、freshness 分支、跨调用重算），
该函数收口闭合。

### 3.2 S8-J-2：jsonl 终局 fsync 分解首次点名——省的那对 open/close 连方向都测不稳

八轮以来 jsonl 的 fsync 路径一直被当「耐久性契约价格」整体引用，
从未有人把「appendFile 后**再开一次**文件才能 sync」这个双 open 形态
本身作为候选裁决——本轮补上（与 R8-D S8-D-3 收拢 registry save 分解
同型：那条裁「去 fsync」，本条裁「保 fsync 并句柄」）。理论收益上界
明确：裸 open/close 对实测 30.9–32.5µs。但 fsync=true 追加的全程
基准三次独立运行 delta 为 −66.6 / +13.2 / +125.6µs——**符号都不稳**，
因为 fsync 本身的运行间抖动（S0b premium 0.18–0.41ms）比候选收益
大一个量级。频次侧：fsync=true 只从 `run/event-store.ts:39` 与
`run/episode-store.ts:36` 的终局判定触发，每 run 个位数次。语义侧：
字节与读面逐位等价（40 序列 fuzz 含序中外删目录的 mkdir 自愈），但
外部 unlink 落在「追加→sync」窗口内时两形态可观察发散（现行重开
重建空文件并 sync 成功；变体字节只存活于已 unlink 的 inode，文件
消失）——该窗口无契约覆盖，但 persist 强调区判据是「不以 µs 换任何
契约/外扰面变化」。µs 级 + 噪声下方向不稳 + 面变化，三重淘汰。

### 3.3 第八遍收口：配置态矩阵补齐后，增长维度与候选空间双重闭合

R7-J 已证唯二无上界维度（preference N、feedback N）被同路径 I/O
支配；本轮把此前从未在「有匹配」形态下锚定的删除级联补上
（666–717µs/级联 vs 无匹配 256–275µs），确认匹配路径的增量全部是
读-重写-tombstones 的 O(N) 固有 I/O，无 CPU 可寻址新成分。配置态
× 命令类矩阵其余格全部落在既有收口域（§1.3）。第八遍逐文件重读
产出的全部「疑似新角度」经排除表比对后，只有两条不是换名
（S8-J-1 / S8-J-2），且都以 ≥4 个数量级或噪声带内的差距淘汰——
本切片在「契约/I/O 地板支配、具名 CPU 皆 ns–µs」这一 R1-J 以来的
结构性结论上第八次收敛，无遗留赢家、无待重测空洞。

## 4. 逐文件收口（第八遍新视角，其余与 R1-J…R7-J 一致）

| 文件 | 第八遍检查结论 | 候选 |
| --- | --- | --- |
| `cluster/mailbox.ts` | enqueue role-cast 三连 / claimRole 自邮回插 / P>1 双面维持收口（R1-J、S5-J-4）；无新角度 | 无 |
| `cluster/spawn.ts` | allowlist O(1) 常数域维持；无新角度 | 无 |
| `cluster/host.ts` | send 首邮外提已裁（S2-J-3/R5-J）；per-target 条件 topic spread 与 stampMail 逐 target 时间戳 = 换名（§0），viewFor 闭包每注册一次性 | 无 |
| `privacy/deletion.ts` | 级联 fail-closed 两读顺序与排序输出契约维持（S5-J-3/S6-J-1/R1-J）；配置态匹配路径首次锚定 666–717µs（§1.3），成分全为固有 I/O | 无 |
| `privacy/state-layout.ts` | 纯路径拼接 | 无 |
| `privacy/record-classes.ts` | 小常数字典 + find，X1-4 小域 | 无 |
| `preferences/loop-eval.ts` | J1 落地面重跑全绿（2468 项，2688.7×）；`evaluatePreferenceLoop` re-grep 仍零生产调用方 | 无 |
| `preferences/export.ts` | scope 过滤 / 数据集导出维持收口（S5-J-1 域） | 无 |
| `preferences/precedence.ts` | 优先级双 find 比较 = X1-4 小域维持 | 无 |
| `preferences/materialize.ts` | entries 循环收口维持；双视图重复代码为重构关切非性能 | 无 |
| `preferences/service.ts` | 薄包装 | 无 |
| `preferences/store.ts` | `saveToDisk` 地板本 VM 重锚 519–548µs（S0a，I/O 支配第八次成立）；`explicitAnchored.add` 幂等冗余写 = S5-J-4/S7-J-4 家族换名（§0）；`buildView` 读 API 缓存空视图、`clearPreferences` 不清 tombstones 为行为备注非性能项 | 无 |
| `preferences/types.ts` | 类型定义 | 无 |
| `episode/manager.ts` | RUN_ATTACHED O(R²) = S1-J-3 维持；无别名回归（S6-J-5） | 无 |
| `episode/replay.ts` | 重放收口维持 | 无 |
| `episode/events.ts` | 类型定义 | 无 |
| `episode/store.ts` | 队列/读契约维持；fsync 追加语义在被调方裁决（S8-J-2） | 无 |
| `episode/closure.ts` | S2-J-8/S7-J-3 维持；`_latestRunIds` 死参 = 公开签名不变量 | 无 |
| `persist/file-lock.ts` | wx/ownerToken/重试数据面锁维持 | 无 |
| `persist/jsonl.ts` | **S8-J-2 点名 + 淘汰**（§3.2）：fsync 路径分解闭合（mkdir 自愈 R3-J、追加字节面、双 open 形态本条）；每 append mkdir 缓存化 = S7-J-6 换名拒列 | S8-J-2 淘汰 |
| `track/primary-split.ts` | 纯编排维持 | 无 |
| `track/plan.ts` | 合同规划收口维持；两个一次性正则 test 可忽略 | 无 |
| `track/clarify.ts` | 偏好合并 R4-J 收口维持；单遍应答应用可忽略 | 无 |
| `track/loop.ts` | S8-E-1 未重开；`buildLiveCatalogConfig` 经 S7-I-1 变廉（§1.2）；children 条件 spread 改写 = S8-A-3/S8-E-2/S8-H-1 PIC 伪影类拒列（§0）；nowIso 合并 = S3-J-5 可观察面拒列 | 无 |
| `context/index.ts` | **S8-J-1 点名 + 淘汰**（§3.1）：`sourcedFact` 分解闭合；`isUnderGenerated` 逐组合 relativeToRoot = S1-J-6 换名、manifests 循环 = R4-J 维持 | S8-J-1 淘汰 |
| `context/packet.ts` | S7-J-1/2 维持；`queryPacketGrounding` re-grep 仍零生产调用方；`collapseFacts` 单值组微分配 = S7-J-1 域拒列 | 无 |
| `feedback/redaction.ts` | S3-J-1 fail-closed 前缀墙与 S7-J-5 稀有形态判据维持 | 无 |
| `feedback/store.ts` | 双读串行顺序维持（S2-J-10/S4-J-2）；tombstone 双遍 = R5-J 维持 | 无 |
| `feedback/types.ts` | 类型定义 | 无 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1
（`fb41417`）起经 R2-J..R7-J 与本轮 R8-J 七遍复查累计零后续代码
改动，逐字节一致。

## 6. 测试

零代码改动下相关基线复核，全绿（Node v22.22.2 via nvm，overlay fs）：

```bash
npx tsx scripts/r1j-equivalence-sim.ts
# ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
# perf fixture: reference 10332.8 ms -> current 3.8 ms (2688.7x)
pnpm gate   # typecheck + lint + test + build 全绿（pnpm 10.17.1）
# tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1（全套件，
# 含 cluster/privacy/preferences/episode/persist/track/context/feedback）
```

仿真（临时脚本，未入库——无赢家不落仿真文件，完整源码见附录；三次
独立运行（R8J_SEED=1/2/3）5 项等价断言逐位一致、计时见带）：

```text
run 1 (R8J_SEED=1):
S0a preferences saveToDisk floor replica (N=1000 obs): 548us/write (R7-J band 638-817us)
S0b jsonl append floor: fsync=false 72.0us/append | fsync=true 263.6us/append | fsync premium 0.192ms/append
S0c configured deletion cascade (N=200 records 49.9KB, 20 matching): match=695us | no-match=256us
S0d buildProjectContextIndex configured (I=3 M=2 C=4 F=30, dual hash maps): 19.1us/build | sourcedFact calls/build=39
S8-J-1 unit fuzz: 500 trials x all probe shapes, field-wise Object.is identical: true
S8-J-1 end-to-end: 60 seeds, replica-vs-production fidelity=true, CSE-vs-production byte-equal=true
S8-J-1 bench: hit-sourceKey delta=8.1ns | hit-factKey delta=29.1ns | miss-all delta=39.7ns | per-build delta=614ns
S8-J-2 equivalence fuzz: 40 sequences, bytes+read-side identical: true
S8-J-2 external-unlink window demo: current -> exists=true size=0 | variant -> exists=false
S8-J-2 bench fsync=true append: current=272.3us variant=338.9us delta=-66.6us | raw open+close pair=32.5us
checks=5 failures=0

run 2 (R8J_SEED=2):
S0a 519us | S0b fsync=false 70.0us fsync=true 250.2us premium 0.180ms | S0c match=717us no-match=275us | S0d 21.2us
S8-J-1 all equivalence true; deltas: 9.9 / 37.9 / 33.2 ns/call; per-build 589ns
S8-J-2 equivalence true; unlink demo same divergence; bench delta=+13.2us (pair=31.9us)
checks=5 failures=0

run 3 (R8J_SEED=3):
S0a 532us | S0b fsync=false 69.3us fsync=true 483.1us premium 0.414ms | S0c match=666us no-match=264us | S0d 18.5us
S8-J-1 all equivalence true; deltas: 11.5 / 47.0 / 34.5 ns/call; per-build 446ns
S8-J-2 equivalence true; unlink demo same divergence; bench delta=+125.6us (pair=30.9us)
checks=5 failures=0
```

环境注记（R1-J 同款）：VM 系统 Node 为 22.14.0，低于 `engines
>=22.19.0`；本轮全部测试与门禁在 nvm 的 Node 22.22.2 下执行，全绿。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S8-J-1 | context `sourcedFact` 跨调用 CSE（providedCurrent 复用 resolveHash 的 sourceHashes 探针） | 逐位等价（500 fuzz + 60-seed 生产端到端 fidelity 闸），但 8.1–47.0ns/调用、446–614ns/构建、每 run 一次性构建（全程 18.5–21.2µs）——距落地线 ≥4 个数量级（S5-J-5/S4-J-6 同域）；sourcedFact 分解至此闭合 |
| S8-J-2 | jsonl `appendJsonlLine` fsync 路径单句柄合并（appendFile+reopen-sync → open/write/sync/close） | 字节+读面逐位等价（40 序列 fuzz 含 mkdir 自愈），但收益上界 = 一对 open/close 30.9–32.5µs，三次运行 delta 符号不稳（−66.6/+13.2/+125.6µs，被 fsync 抖动 0.18–0.41ms 吞没）；仅终局追加触发（每 run ≤2 次）；外部 unlink 窗口可观察发散（现行重建空文件 vs 变体文件消失）——persist 强调区不以 µs 换外扰面 |

重开条件：S8-J-1 若 `buildProjectContextIndex` 获得每 run 数百次以上
高频调用方或 facts 常态达 10³+（与 S7-J-1 同门槛），可凭本报告
60-seed fidelity 证据重开；S8-J-2 若 jsonl 终局 fsync 变为每事件
fsync（吞吐契约决策）且先做出外扰窗口语义决议（明确 append-sync
原子面），可重估——两者现实重开路径均不存在。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：置于 `/tmp/r8j-sim.mts`（`.mts` 强制 ESM；相对 import 指向
`/workspace`），`R8J_SEED=1|2|3 npx --prefix /workspace tsx r8j-sim.mts`。

```typescript
/* ============================================================
 * R8-J adjudication sim — data plane / persist, eighth pass.
 * Runs under tsx on Node v22.22.2 from /tmp with relative imports
 * into /workspace. Deterministic: mulberry32(seed); rerun with
 * R8J_SEED=2 for the two-seed verdict.
 *
 * Section 0: I/O-floor re-measure on THIS VM (default + configured).
 *   S0a preferences saveToDisk floor replica (N=1000)      [R7-J band]
 *   S0b jsonl append floor: fsync=false vs fsync=true       [new anchor]
 *   S0c configured privacy deletion cascade: match/no-match [R7-I lesson]
 *   S0d buildProjectContextIndex whole-build CPU            [R5-J band]
 * Candidates:
 *   S8-J-1 context/index.ts sourcedFact cross-call CSE
 *          (providedCurrent recomputes resolveHash's sourceHashes probe)
 *   S8-J-2 persist/jsonl.ts appendJsonlLine fsync path single-handle
 *          merge (appendFile + open/sync/close -> open/write/sync/close)
 * ============================================================ */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, open, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { hash32 } from "../workspace/src/domain/hash.js";
import {
  buildProjectContextIndex,
  type BuildProjectContextIndexOptions,
  type ContextFact,
  type FactTrust
} from "../workspace/src/context/index.js";
import { appendJsonlLine, readJsonlObjects } from "../workspace/src/persist/jsonl.js";
import { cascadeFeedbackTombstones } from "../workspace/src/privacy/deletion.js";
import { feedbackLogPath, feedbackTombstonesPath } from "../workspace/src/feedback/store.js";
import type { ProjectSnapshot } from "../workspace/src/domain/project.js";
import type { ProjectId, EpisodeId } from "../workspace/src/domain/ids.js";
import type { IsoTimestamp } from "../workspace/src/domain/timestamp.js";

const SEED_BASE = Number(process.env["R8J_SEED"] ?? "1");
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
 * Section 0a: preferences saveToDisk floor replica, N=1000.
 * Same shape R7-J C4 measured (stringify + mkdirSync + writeFileSync).
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
  const dir = join(tmpdir(), "r8j-s0a");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "preferences.json");
  const IO_ITER = 300;
  const ms = bench(() => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ observations, tombstones }));
  }, IO_ITER);
  console.log(
    `S0a preferences saveToDisk floor replica (N=1000 obs): ${((ms / IO_ITER) * 1e3).toFixed(0)}us/write (R7-J band 638-817us)`
  );
  rmSync(dir, { recursive: true, force: true });
}

/* ============================================================
 * Section 0b: jsonl append floor through the PRODUCTION function.
 * fsync=false (every event append) vs fsync=true (terminal appends:
 * run/event-store.ts TERMINAL_EVENT_TYPES, run/episode-store.ts
 * TERMINAL_EPISODE_STATUSES). The premium is S8-J-2's denominator.
 * ============================================================ */
{
  const dir = join(tmpdir(), "r8j-s0b");
  await rm(dir, { recursive: true, force: true });
  const fileNo = join(dir, "no-fsync.jsonl");
  const fileYes = join(dir, "yes-fsync.jsonl");
  const line = JSON.stringify({
    type: "RUN_COMPLETED",
    runId: "run_r8j",
    at: NOW,
    payload: { status: "DONE" }
  });
  const N1 = 400;
  const N2 = 200;
  const noMs = await benchAsync(() => appendJsonlLine(fileNo, line, false), N1);
  const yesMs = await benchAsync(() => appendJsonlLine(fileYes, line, true), N2);
  console.log(
    `S0b jsonl append floor (overlay fs): fsync=false ${((noMs / N1) * 1e3).toFixed(1)}us/append | fsync=true ${((yesMs / N2) * 1e3).toFixed(1)}us/append | fsync premium ${(yesMs / N2 - noMs / N1).toFixed(3)}ms/append`
  );
  await rm(dir, { recursive: true, force: true });
}

/* ============================================================
 * Section 0c: configured-state privacy deletion cascade (R7-I lesson:
 * with and without matching records), through PRODUCTION
 * cascadeFeedbackTombstones. N=200 records, 20 matching the target
 * episode, pre-existing tombstones sidecar.
 * ============================================================ */
{
  const stateRoot = join(tmpdir(), "r8j-s0c");
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
    `S0c configured deletion cascade (N=200 records ${(fixtureBytes / 1024).toFixed(1)}KB, 20 matching): match=${((matchMs / REP) * 1e3).toFixed(0)}us/cascade (read+strip+rewrite+tombstones) | no-match=${((noMatchMs / NM) * 1e3).toFixed(0)}us/cascade (2 reads kept in fail-closed order)`
  );
  await rm(stateRoot, { recursive: true, force: true });
}

/* ============================================================
 * S8-J-1 fixtures: seeded ProjectSnapshot + options with dual hash maps
 * exercising every resolveFromMap probe depth (sourceKey / alternateKey /
 * factKey hits and misses, undefined maps, backslash paths, paths outside
 * rootPath) and both fresh/stale outcomes.
 * ============================================================ */
const TRUSTS = ["HIGH", "MEDIUM", "LOW"] as const;

function genSnapshot(rnd: () => number, I: number, M: number, C: number, F: number): ProjectSnapshot {
  const root = "/repo";
  const mkPath = (stem: string): string => {
    const roll = rnd();
    if (roll < 0.15) return `${stem}.md`; // bare relative (outside root prefix)
    if (roll < 0.3) return `${root}\\${stem}.md`; // backslash to exercise normalizePath
    return `${root}/${stem}.md`;
  };
  const commands = Array.from({ length: C }, (_, i) => ({
    name: i === 0 && rnd() < 0.7 ? "test" : `cmd${i}`,
    command: `run-${i} --flag`
  }));
  return {
    id: "proj_r8j" as ProjectId,
    rootPath: root,
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: I }, (_, i) => ({ path: mkPath(`docs/inst${i}`) })),
    manifests: Array.from({ length: M }, (_, i) => ({ path: mkPath(`pkg${i}/package`) })),
    commands,
    facts: Array.from({ length: F }, (_, i) => ({
      key:
        rnd() < 0.2
          ? `architecture.part${i}`
          : rnd() < 0.25
            ? `risk.item${i}`
            : `fact.k${i}`,
      value: `v${Math.floor(rnd() * 6)}`,
      confidence: TRUSTS[Math.floor(rnd() * 3)]!
    }))
  };
}

function normalizePathR(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
function relativeToRootR(rootPath: string, filePath: string): string {
  const root = normalizePathR(rootPath);
  const path = normalizePathR(filePath);
  if (path === root) return "";
  if (root !== "" && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path;
}
function commandSourceKeyR(snapshot: ProjectSnapshot, commandName: string): string {
  const packageJson = snapshot.manifests.find((file) => {
    const normalized = normalizePathR(file.path);
    return normalized === "package.json" || normalized.endsWith("/package.json");
  });
  return packageJson?.path ?? `validation.route:${commandName}`;
}

function genOptions(rnd: () => number, snapshot: ProjectSnapshot): BuildProjectContextIndexOptions {
  const mkMap = (): Record<string, string> | undefined => {
    if (rnd() < 0.12) return undefined;
    const m: Record<string, string> = {};
    // Noise keys.
    for (let i = 0; i < Math.floor(rnd() * 12); i++) m[`noise/${i}`] = `h${Math.floor(rnd() * 8)}`;
    // Source-key hits (absolute paths / fact keys), alternate-key hits
    // (relative paths), fact-key hits (`instruction:rel` / `manifest:rel`
    // / `validation.route:*`).
    for (const file of [...snapshot.instructionFiles, ...snapshot.manifests]) {
      const rel = relativeToRootR(snapshot.rootPath, file.path);
      if (rnd() < 0.4) m[file.path] = `h${Math.floor(rnd() * 8)}`;
      if (rnd() < 0.3) m[rel] = `h${Math.floor(rnd() * 8)}`;
      if (rnd() < 0.2) m[`instruction:${rel}`] = `h${Math.floor(rnd() * 8)}`;
      if (rnd() < 0.2) m[`manifest:${rel}`] = `h${Math.floor(rnd() * 8)}`;
    }
    for (const command of snapshot.commands) {
      if (rnd() < 0.35) m[`validation.route:${command.name}`] = `h${Math.floor(rnd() * 8)}`;
    }
    for (const fact of snapshot.facts) {
      if (rnd() < 0.45) m[fact.key] = `h${Math.floor(rnd() * 8)}`;
    }
    return m;
  };
  return { sourceHashes: mkMap(), priorHashes: mkMap(), now: NOW };
}

/* ============================================================
 * Section 0d: whole-build CPU anchor (S8-J-1's denominator).
 * ============================================================ */
const anchorSnapshot = genSnapshot(mulberry32(SEED_BASE * 733), 3, 2, 4, 30);
const anchorOptions = genOptions(mulberry32(SEED_BASE * 977), anchorSnapshot);
{
  const ITER = 2000;
  const ms = bench(() => {
    buildProjectContextIndex(anchorSnapshot, anchorOptions);
  }, ITER);
  const sourcedFactCalls =
    anchorSnapshot.instructionFiles.length +
    anchorSnapshot.manifests.length +
    anchorSnapshot.commands.length +
    anchorSnapshot.facts.length;
  console.log(
    `S0d buildProjectContextIndex configured (I=3 M=2 C=4 F=30, dual hash maps): ${((ms / ITER) * 1e3).toFixed(1)}us/build (R5-J band 40.1-40.4us) | sourcedFact calls/build=${sourcedFactCalls}`
  );
}

/* ============================================================
 * S8-J-1: sourcedFact cross-call CSE.
 * Baseline replica = current production body (context/index.ts:289-308):
 * `current` probes options.sourceHashes via resolveHash, then
 * `providedCurrent` re-runs the IDENTICAL pure probe. Variant probes
 * once and derives `current` = providedCurrent ?? hash32(fallback).
 * ============================================================ */
type Trust = Exclude<FactTrust, "unavailable">;
type FactFresh = ContextFact["freshness"];

function resolveFromMapR(
  map: Readonly<Record<string, string>> | undefined,
  sourceKey: string,
  alternateKey?: string,
  factKey?: string
): string | undefined {
  if (map === undefined) return undefined;
  if (map[sourceKey] !== undefined) return map[sourceKey];
  if (alternateKey !== undefined && map[alternateKey] !== undefined) return map[alternateKey];
  if (factKey !== undefined && map[factKey] !== undefined) return map[factKey];
  return undefined;
}

function sourcedFactBase(
  key: string,
  value: string,
  sourceKey: string,
  trust: Trust,
  options: BuildProjectContextIndexOptions,
  alternateKey?: string
): ContextFact {
  const current =
    resolveFromMapR(options.sourceHashes, sourceKey, alternateKey, key) ?? hash32(`${sourceKey}\0${value}`);
  const prior = resolveFromMapR(options.priorHashes, sourceKey, alternateKey, key);
  const providedCurrent = resolveFromMapR(options.sourceHashes, sourceKey, alternateKey, key);
  let freshness: FactFresh = "fresh";
  if (prior !== undefined && providedCurrent !== undefined && prior !== providedCurrent) {
    freshness = "stale";
  } else if (prior !== undefined && prior !== current) {
    freshness = "stale";
  }
  return { key, value, trust, sourceHash: current, freshness };
}

function sourcedFactCSE(
  key: string,
  value: string,
  sourceKey: string,
  trust: Trust,
  options: BuildProjectContextIndexOptions,
  alternateKey?: string
): ContextFact {
  const providedCurrent = resolveFromMapR(options.sourceHashes, sourceKey, alternateKey, key);
  const current = providedCurrent ?? hash32(`${sourceKey}\0${value}`);
  const prior = resolveFromMapR(options.priorHashes, sourceKey, alternateKey, key);
  let freshness: FactFresh = "fresh";
  if (prior !== undefined && providedCurrent !== undefined && prior !== providedCurrent) {
    freshness = "stale";
  } else if (prior !== undefined && prior !== current) {
    freshness = "stale";
  }
  return { key, value, trust, sourceHash: current, freshness };
}

/* Unit fuzz: every probe shape. */
{
  const rnd = mulberry32(SEED_BASE * 4241);
  let ok = true;
  for (let trial = 0; trial < 500; trial++) {
    const sk = `src/k${Math.floor(rnd() * 50)}`;
    const ak = rnd() < 0.6 ? `rel/k${Math.floor(rnd() * 50)}` : undefined;
    const fk = `fact:k${Math.floor(rnd() * 50)}`;
    const mkMap = (): Record<string, string> | undefined => {
      if (rnd() < 0.15) return undefined;
      const m: Record<string, string> = {};
      for (let i = 0; i < Math.floor(rnd() * 30); i++) m[`noise/${i}`] = `h${Math.floor(rnd() * 8)}`;
      if (rnd() < 0.5) m[sk] = `h${Math.floor(rnd() * 8)}`;
      if (ak !== undefined && rnd() < 0.4) m[ak] = `h${Math.floor(rnd() * 8)}`;
      if (rnd() < 0.4) m[fk] = `h${Math.floor(rnd() * 8)}`;
      return m;
    };
    const options: BuildProjectContextIndexOptions = { sourceHashes: mkMap(), priorHashes: mkMap() };
    const value = `v${Math.floor(rnd() * 6)}`;
    const trust = TRUSTS[Math.floor(rnd() * 3)]!;
    const a = sourcedFactBase(fk, value, sk, trust, options, ak);
    const b = sourcedFactCSE(fk, value, sk, trust, options, ak);
    if (
      !Object.is(a.key, b.key) ||
      !Object.is(a.value, b.value) ||
      !Object.is(a.trust, b.trust) ||
      !Object.is(a.sourceHash, b.sourceHash) ||
      !Object.is(a.freshness, b.freshness)
    ) {
      ok = false;
    }
  }
  assertOk(ok, "S8-J-1 unit fuzz divergence");
  console.log(`S8-J-1 unit fuzz: 500 trials x all probe shapes, field-wise Object.is identical: ${ok}`);
}

/* Production fidelity + end-to-end equivalence over the facts surface. */
{
  let fidelityOk = true;
  let equivalenceOk = true;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(SEED_BASE * 15485863 + seed * 7919);
    const snapshot = genSnapshot(
      rnd,
      1 + Math.floor(rnd() * 5),
      1 + Math.floor(rnd() * 4),
      1 + Math.floor(rnd() * 5),
      Math.floor(rnd() * 40)
    );
    const options = genOptions(rnd, snapshot);
    const prodFacts = buildProjectContextIndex(snapshot, options).facts;
    const factsWith = (
      impl: (
        key: string,
        value: string,
        sourceKey: string,
        trust: Trust,
        options: BuildProjectContextIndexOptions,
        alternateKey?: string
      ) => ContextFact
    ): ContextFact[] => {
      const facts: ContextFact[] = [];
      const fileFactR = (kind: "instruction" | "manifest", path: string): ContextFact => {
        const relative = relativeToRootR(snapshot.rootPath, path);
        return impl(`${kind}:${relative}`, path, path, "HIGH", options, relative);
      };
      for (const file of snapshot.instructionFiles) facts.push(fileFactR("instruction", file.path));
      for (const file of snapshot.manifests) facts.push(fileFactR("manifest", file.path));
      for (const command of snapshot.commands) {
        facts.push(
          impl(
            `validation.route:${command.name}`,
            command.command,
            commandSourceKeyR(snapshot, command.name),
            "HIGH",
            options
          )
        );
      }
      if (!snapshot.commands.some((command) => command.name === "test")) {
        facts.push({
          key: "validation.route:test",
          value: "unavailable",
          trust: "unavailable",
          sourceHash: hash32("validation.route:test"),
          freshness: "unavailable"
        });
      }
      for (const fact of snapshot.facts) {
        facts.push(impl(fact.key, fact.value, fact.key, fact.confidence, options));
      }
      return facts;
    };
    const baseFacts = factsWith(sourcedFactBase);
    const cseFacts = factsWith(sourcedFactCSE);
    const prodJson = JSON.stringify(prodFacts);
    if (prodJson !== JSON.stringify(baseFacts)) fidelityOk = false;
    if (prodJson !== JSON.stringify(cseFacts)) equivalenceOk = false;
  }
  assertOk(fidelityOk, "S8-J-1 baseline replica does not match production facts");
  assertOk(equivalenceOk, "S8-J-1 CSE variant does not match production facts");
  console.log(
    `S8-J-1 end-to-end: 60 seeds, replica-vs-production fidelity=${fidelityOk}, CSE-vs-production byte-equal=${equivalenceOk}`
  );
}

/* Bench: probe profiles at realistic map size, then per-build delta. */
{
  const rnd = mulberry32(SEED_BASE * 6007);
  const mkMapWith = (extra: Record<string, string>): Record<string, string> => {
    const m: Record<string, string> = {};
    for (let i = 0; i < 30; i++) m[`noise/path/${i}.md`] = `h${Math.floor(rnd() * 8)}`;
    Object.assign(m, extra);
    return m;
  };
  const profiles: { name: string; options: BuildProjectContextIndexOptions; sk: string; ak?: string; fk: string }[] = [
    {
      name: "hit-sourceKey",
      options: {
        sourceHashes: mkMapWith({ "/repo/docs/a.md": "h1" }),
        priorHashes: mkMapWith({ "/repo/docs/a.md": "h1" })
      },
      sk: "/repo/docs/a.md",
      ak: "docs/a.md",
      fk: "instruction:docs/a.md"
    },
    {
      name: "hit-factKey(deepest)",
      options: {
        sourceHashes: mkMapWith({ "instruction:docs/a.md": "h2" }),
        priorHashes: mkMapWith({ "instruction:docs/a.md": "h3" })
      },
      sk: "/repo/docs/a.md",
      ak: "docs/a.md",
      fk: "instruction:docs/a.md"
    },
    {
      name: "miss-all(hash32 fallback)",
      options: { sourceHashes: mkMapWith({}), priorHashes: mkMapWith({}) },
      sk: "/repo/docs/zz.md",
      ak: "docs/zz.md",
      fk: "instruction:docs/zz.md"
    }
  ];
  const ITER = 1_000_000;
  let sink = 0;
  for (const profile of profiles) {
    const baseMs = bench(() => {
      sink += sourcedFactBase(profile.fk, "v1", profile.sk, "HIGH", profile.options, profile.ak).sourceHash.length;
    }, ITER);
    const cseMs = bench(() => {
      sink += sourcedFactCSE(profile.fk, "v1", profile.sk, "HIGH", profile.options, profile.ak).sourceHash.length;
    }, ITER);
    console.log(
      `S8-J-1 bench ${profile.name}: base=${((baseMs / ITER) * 1e6).toFixed(1)}ns/call cse=${((cseMs / ITER) * 1e6).toFixed(1)}ns/call delta=${(((baseMs - cseMs) / ITER) * 1e6).toFixed(1)}ns/call`
    );
  }
  // Per-build delta at the realistic 39-call mix (anchor snapshot).
  const BUILD_ITER = 20_000;
  const buildWith = (
    impl: (
      key: string,
      value: string,
      sourceKey: string,
      trust: Trust,
      options: BuildProjectContextIndexOptions,
      alternateKey?: string
    ) => ContextFact
  ): void => {
    for (const file of anchorSnapshot.instructionFiles) {
      const relative = relativeToRootR(anchorSnapshot.rootPath, file.path);
      sink += impl(`instruction:${relative}`, file.path, file.path, "HIGH", anchorOptions, relative).sourceHash.length;
    }
    for (const file of anchorSnapshot.manifests) {
      const relative = relativeToRootR(anchorSnapshot.rootPath, file.path);
      sink += impl(`manifest:${relative}`, file.path, file.path, "HIGH", anchorOptions, relative).sourceHash.length;
    }
    for (const command of anchorSnapshot.commands) {
      sink += impl(
        `validation.route:${command.name}`,
        command.command,
        commandSourceKeyR(anchorSnapshot, command.name),
        "HIGH",
        anchorOptions
      ).sourceHash.length;
    }
    for (const fact of anchorSnapshot.facts) {
      sink += impl(fact.key, fact.value, fact.key, fact.confidence, anchorOptions).sourceHash.length;
    }
  };
  const baseBuildMs = bench(() => buildWith(sourcedFactBase), BUILD_ITER);
  const cseBuildMs = bench(() => buildWith(sourcedFactCSE), BUILD_ITER);
  console.log(
    `S8-J-1 per-build (39-call mix incl. relativeToRoot): base=${((baseBuildMs / BUILD_ITER) * 1e6).toFixed(0)}ns cse=${((cseBuildMs / BUILD_ITER) * 1e6).toFixed(0)}ns delta=${(((baseBuildMs - cseBuildMs) / BUILD_ITER) * 1e6).toFixed(0)}ns/build (once per run)`
  );
  if (sink === -1) console.log("sink");
}

/* ============================================================
 * S8-J-2: appendJsonlLine fsync path single-handle merge.
 * Variant keeps mkdir self-heal, byte format, and the
 * data-write-then-fsync order; saves appendFile's internal
 * open/close pair on the fsync=true path only.
 * ============================================================ */
async function appendJsonlLineVariant(filePath: string, line: string, fsync: boolean): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  if (!fsync) {
    await appendFile(filePath, `${line}\n`, "utf8");
    return;
  }
  const handle = await open(filePath, "a");
  try {
    await handle.writeFile(`${line}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/* Equivalence fuzz: seeded append sequences, byte + read-side compare,
 * including mid-sequence directory deletion (mkdir self-heal). */
{
  const rnd = mulberry32(SEED_BASE * 104729);
  const root = join(tmpdir(), "r8j-s2-fuzz");
  await rm(root, { recursive: true, force: true });
  let ok = true;
  for (let sequence = 0; sequence < 40; sequence++) {
    const dirA = join(root, `seq${sequence}`, "a", "nested");
    const dirB = join(root, `seq${sequence}`, "b", "nested");
    const fileA = join(dirA, "log.jsonl");
    const fileB = join(dirB, "log.jsonl");
    const appends = 1 + Math.floor(rnd() * 15);
    for (let i = 0; i < appends; i++) {
      if (rnd() < 0.12) {
        // External directory deletion between appends: both sides must
        // self-heal via the per-append mkdir.
        await rm(dirname(fileA), { recursive: true, force: true });
        await rm(dirname(fileB), { recursive: true, force: true });
      }
      const record = {
        i,
        type: rnd() < 0.5 ? "STEP" : "RUN_COMPLETED",
        text: rnd() < 0.3 ? `unicode \u00e9\u4e2d\u6587 ${"x".repeat(Math.floor(rnd() * 200))}` : `plain ${i}`,
        nested: { deep: [1, 2, { k: `v${Math.floor(rnd() * 5)}` }] }
      };
      const line = JSON.stringify(record);
      const fsync = rnd() < 0.5;
      await appendJsonlLine(fileA, line, fsync);
      await appendJsonlLineVariant(fileB, line, fsync);
    }
    const bytesA = existsSync(fileA) ? await import("node:fs/promises").then((fs) => fs.readFile(fileA, "utf8")) : "";
    const bytesB = existsSync(fileB) ? await import("node:fs/promises").then((fs) => fs.readFile(fileB, "utf8")) : "";
    if (bytesA !== bytesB) ok = false;
    const readA = await readJsonlObjects(fileA, (n) => new Error(`corrupt ${n}`));
    const readB = await readJsonlObjects(fileB, (n) => new Error(`corrupt ${n}`));
    if (JSON.stringify(readA) !== JSON.stringify(readB)) ok = false;
  }
  assertOk(ok, "S8-J-2 fuzz divergence");
  console.log(
    `S8-J-2 equivalence fuzz: 40 sequences (mixed fsync flags, unicode/long lines, mid-sequence dir deletion self-heal), bytes+read-side identical: ${ok}`
  );
  await rm(root, { recursive: true, force: true });
}

/* External-unlink window demo (deterministic step replicas): the two
 * shapes differ in what survives an external delete landing inside the
 * append-to-sync window. */
{
  const dir = join(tmpdir(), "r8j-s2-unlink");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const fileA = join(dir, "current.jsonl");
  const fileB = join(dir, "variant.jsonl");
  // Current shape: appendFile -> [external unlink] -> open("a") -> sync.
  await appendFile(fileA, "x\n", "utf8");
  await unlink(fileA);
  const handleA = await open(fileA, "a"); // recreates an EMPTY file
  await handleA.sync();
  await handleA.close();
  const currentExists = existsSync(fileA);
  const currentSize = currentExists ? statSync(fileA).size : -1;
  // Variant shape: open("a") -> [external unlink] -> write -> sync.
  const handleB = await open(fileB, "a");
  await unlink(fileB);
  await handleB.writeFile("x\n", "utf8"); // bytes go to the unlinked inode
  await handleB.sync();
  await handleB.close();
  const variantExists = existsSync(fileB);
  console.log(
    `S8-J-2 external-unlink window demo: current -> file exists=${currentExists} size=${currentSize} (reopen recreates empty, sync succeeds) | variant -> file exists=${variantExists} (append survives only on the unlinked inode)`
  );
  await rm(dir, { recursive: true, force: true });
}

/* Bench: fsync=true per-append, current vs variant, plus the raw
 * open/close pair the variant saves. */
{
  const dir = join(tmpdir(), "r8j-s2-bench");
  await rm(dir, { recursive: true, force: true });
  const fileA = join(dir, "cur.jsonl");
  const fileB = join(dir, "var.jsonl");
  const line = JSON.stringify({ type: "RUN_COMPLETED", runId: "run_r8j", at: NOW });
  const N = 200;
  const curMs = await benchAsync(() => appendJsonlLine(fileA, line, true), N);
  const varMs = await benchAsync(() => appendJsonlLineVariant(fileB, line, true), N);
  const P = 500;
  const pairFile = join(dir, "pair.jsonl");
  await appendFile(pairFile, "x\n", "utf8");
  const pairMs = await benchAsync(async () => {
    const handle = await open(pairFile, "a");
    await handle.close();
  }, P);
  console.log(
    `S8-J-2 bench fsync=true append: current=${((curMs / N) * 1e3).toFixed(1)}us variant=${((varMs / N) * 1e3).toFixed(1)}us delta=${(((curMs - varMs) / N) * 1e3).toFixed(1)}us/append | raw open+close pair=${((pairMs / P) * 1e3).toFixed(1)}us | fires only on terminal appends (event-store TERMINAL_EVENT_TYPES, episode-store TERMINAL_EPISODE_STATUSES)`
  );
  await rm(dir, { recursive: true, force: true });
}

console.log(`checks=${checks} failures=${failures}`);
```

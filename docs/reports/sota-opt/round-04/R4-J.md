MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）第四遍复查报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `d11c125`
**分支:** `cursor/r4-j-persist-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3，共 3655 行）自 R1-J 落地
J1（`fb41417`）以来**逐字节未变**（`git diff fb41417..d11c125 -- <切片>` 为空；
自 `7acb666` 起全切片 diff 仍仅含 `loop-eval.ts` 一个文件），R1-J 的逐文件
收口、S1-J-1..7、S2-J-1..11、S3-J-1..6 排除全部继承有效。本轮在完整排除表
（含 R4 已产出的 S4-A/B/D/E/F/G/H-*）之上第四次全量实际读码、以新角度枚举，
得到 6 个此前未点名的新候选（S4-J-1 … S4-J-6），全部经理论 + 确定性仿真
（seeded mulberry32，等价 fuzz / **不可达性穷举证明** / **双故障发散演示** /
真实规模基准，seeds `0x54bb01`/`0x54bb02` 两次独立运行等价与发散结论逐位
一致、计时抖动范围内稳定）裁决后淘汰：**2 个是 I/O 编排重叠**（S4-J-2 的
catalog∥learned 载入 ~17–18µs/run、S4-J-3 的删除双文件并行 ~60–62µs/删除，
两者均带双故障错误身份竞态且远低于 ~190µs 否决线——S2-J-10/S4-D-3/S4-E-2
同判据），**1 个是防御纵深删除**（S4-J-1 的 spawn 死分支复核，穷举证明不可达
即收益为两条从不成立的比较 ≈ 亚 ns），其余 3 个在真实规模是 ns 级常数噪声
（S4-J-4 融合 9–87ns、S4-J-5 提升 ~76–92ns、S4-J-6 双冗余拷贝 8–68ns）。
未重开任何 X* / S1-* / S2-* / S3-* / S4-* 条目。数据面（删除/脱敏/状态布局、
mailbox、episode 闭合、jsonl 锁语义）**零 diff**，可见行为天然不变。J1 之上
本切片在其数据面契约下经四遍穷尽复查仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  本轮全部第四次实际读码，未依赖 R1-J/R2-J/R3-J 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含全部 S4-A..H 新排除）→
  round-04/PLAN.md → round-01/R1-J.md → round-02/R2-J.md → round-03/R3-J.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1..7、S2-J-1..11、
  S3-J-1..6 共二十四条全部不再提案。特别地：**J1 落地代码未回退未重做**
  （`loop-eval.ts` 与 `fb41417` 逐字节一致，本轮 `git diff` 核对）；
  **S1-J-1/S3-J-5 遵守**（`rebuildViews` 与其 `lastUpdated` 可观察面零碰）；
  **S2-J-1 遵守**（两次 `tombstones.has` 调用模式原样）；**S2-J-2 遵守**
  （createdAt 字典序比较器未碰，Z vs +00:00 反例继续有效）；**S3-J-1 遵守**
  （`stripForbidden` 顺序剥除语义零碰——密钥前缀反例继续有效）；**S2-J-10 /
  S2-J-11 / S1-G-1 遵守**（feedback 双读串行、track 双 readAll 磁盘事实源
  语义维持）；X1-1、X0-5、X4-2 直接跳过。本轮只探索**未被点名的新角度**：
  spawn 死分支双重复核（S4-J-1）、tracked-run 启动 I/O 编排（S4-J-2）、
  episode 删除双文件 I/O 编排（S4-J-3）、packet codeMap omissions 双遍
  （S4-J-4）、claimRole 循环内 box() 重查（S4-J-5）、index 构建两处冗余
  拷贝（S4-J-6）。
- **数据面强调区零 diff**：`privacy/deletion.ts` 的全量读→map→全量重写
  级联、`persist/file-lock.ts` 的 wx/ownerToken/重试语义、`persist/jsonl.ts`
  的截尾恢复、`cluster/mailbox.ts` 的 role 队列 claim 语义、
  `episode/manager.ts` 的 fail-closed reducer——可见行为天然不变。S4-J-3
  仅在仿真中建模并否决，生产删除路径一行未改。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、
  权限、数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，未落仿真脚本（完整源码见附录）。

## 1. 规模与门槛基底（第四遍继承 + 本轮校准）

R1-J/R2-J/R3-J 已实测本切片规模：episode 内 run 数、cluster peer 数
（≤ maxTasks=16）、track 子任务数（C≤~6）、context 构建输入（十位级）、
redaction needles（=4）全部为小常数；**唯一无上界增长维度是 preference
观察数 N 与 feedback 记录数 N**，两者的插入/读取路径均被同路径的全量 JSON
序列化 + 磁盘 I/O 支配（R2-J 实测 ~50×），度量路径已被 J1 收口为
Θ(N log N) 且无生产调用方。代码逐字节未变，全部继承。

战役落地线继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms），µs 级候选一律被否决过（S1-I-1 ~190µs、
S3-D-3 351–388µs 亦被否决、S2-J-10 ~48–73µs）。本轮全部候选的绝对收益
上界是 **~60–62µs/删除**（S4-J-3，一次性删除工具路径且带竞态）与
**~17–18µs/run**（S4-J-2，一次性启动路径且带竞态 + 投机读发散）；其余四个
是 ns 级。没有候选接近数十 ms 落地线。据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-J-1 | `cluster/host.ts` `spawn()` 在 `validateSpawn` 之后对 depth/配额的双重复核（:173-178）为死分支，候选删除 | `parent.depth+1 > MAX ⟺ parent.depth >= MAX` 与 `used >= MAX_SPAWNS` 恰是 validateSpawn 已抛出的同条件 ⇒ host 分支不可达 | ✅ **穷举证明**：depth 0..4 × used 0..6 全域扫描，validateSpawn 放行的 8 个组合上两个 host 条件全为假；depth 边界实测抛 validateSpawn 的消息（`spawn depth 2 exceeds max 2`）而非 host 的（`spawn depth exceeds 2`） | 整个 spawn=532–556ns；两条从不成立的比较合计 **3.7–5.5ns** | 淘汰：收益为两条死比较 ≈ 亚 ns；删除属防御纵深拆除（S4-D-4/S3-H-1 同判据——host 是 validateSpawn 输入的最后防线，重构 validateSpawn 调用点时它兜底） |
| S4-J-2 | `track/loop.ts` `startTrackedRun` 的 catalog 链（buildLiveCatalogConfig→calibrateCatalogFromState）与 `loadLearnedRouting` 数据无关，候选 Promise.all 编排重叠 | 重叠上界 = min(两载入) | ✅ 值等价平凡（两载入互不依赖）；❌ **双故障发散演示**：两个 rejection 在 Promise.all 下浮出者随 settle 次序翻转（实测 [learned fault, catalog fault]），现实现确定性先抛 catalog 错误；且 catalog 单故障时 learned 读成为**投机 I/O**（现实现根本不启动它，S4-D-3 同型） | catalog 链=120.9–124.1µs、learned 载入=25.9–26.6µs；串行=130.6–133.8µs、并行=112.7–116.8µs → **重叠收益仅 17.1–17.9µs/run**、每 tracked run 一次性 | 淘汰：S2-J-10/S4-D-3/S4-E-2 同判据（双故障错误身份竞态 + 投机读）+ 远低于 ~190µs 否决线 |
| S4-J-3 | `privacy/deletion.ts` `deleteEpisodeRecords` 两个 episode 文件（`.jsonl`/`.events.jsonl`）的 stat/rm 串行循环，候选 Promise.all 并行（索引化保 removedPaths 序） | 重叠两对 stat+rm | ✅ 命中/未命中 removedPaths 逐位一致 + production fidelity（真实 `deleteEpisodeRecords` 返回同序两路径）；⚠️ 双故障（两文件同时 rm 失败）时浮出错误变 settle 次序依赖 | 未命中 seq=37.4–38.3µs par=29.1–30.0µs；命中 seq=128.1–129.1µs par=67.5–67.7µs → **重叠收益 60.4–61.6µs/删除**；episode 删除是一次性隐私工具路径，且随后 `cascadeFeedbackTombstones` 全量读+重写 feedback 日志支配 | 淘汰：**删除数据面强调区**（S2-J-7 邻域）+ 双故障竞态 + 低于否决线；一次性工具路径无重复调用放大 |
| S4-J-4 | `context/packet.ts` `compileContextPacket` 对 `codeMapSelection.omissions` 的两遍迭代（:130 map 构造 + :134 omissions.push）融合单遍 | 免一遍 O(O) 迭代 | ✅ 400 轮 fuzz（O 0..29 随机）两输出数组逐位一致（两 seed 同判） | O=20 档：两遍=643–666ns、融合=579–634ns → **delta 9–87ns/编译**（两次测量已异号级抖动）；整个 `compileContextPacket`=41.2–41.4µs | 淘汰：ns 级抖动（X3-2/S1-F-5 同类；S1-J-7/S2-J-5 的同函数姊妹） |
| S4-J-5 | `cluster/mailbox.ts` `claimRole` 每投递 mail 重复 `box(agentId)` 查找（循环内 get-or-create），候选提升为循环外一次 | 免 (D-1) 次 Map.get | ✅ 300 轮 fuzz（P 1..16、~20% 自邮回插）delivered/inbox/pendingForRole 三面逐位一致（两 seed 同判） | P=15 整个 enqueue+claim=2.0µs；一次 Map.get=5.4–6.6ns → **提升省 ~76–92ns/claim** | 淘汰：亚噪声 + mailbox 数据面强调区（S2-J-3/S3-J-3 同域；R1-J 已裁同函数 byRole.get 重取为数据面噪声） |
| S4-J-6 | `context/index.ts` 两处冗余拷贝：`[...snapshot.instructionFiles].map(...)`（:135，map 本就分配新数组，spread 多余）与 `dirtyPaths.filter(...).slice().sort(...)`（:130-133，filter 结果已是新数组，slice 多余） | 各免一次 O(I)/O(D) 数组分配 | ✅ 两处消除同值平凡（map 不读 index 参、sort 就地作用于无别名的新数组），断言通过 | I=12 spread delta=**8–13ns**；D=30 slice delta=**62–68ns**；整个 `buildProjectContextIndex`=109.8–110.5µs、每 run 一次性 | 淘汰：一次性构建 ns 级噪声（S2-J-5 的 index 侧姊妹；S1-J-6/S2-J-4/S3-J-2 同域规模论证） |

## 3. 关键裁决细节

### S4-J-1：`spawn()` 的双重复核是死分支，但"死"正是不删它的理由

`validateSpawn`（`cluster/spawn.ts`）在 `depth >= MAX_SPAWN_DEPTH` 或
`spawnsByParent >= MAX_SPAWNS_PER_PARENT` 时先抛；host 随后复核
`parent.depth + 1 > MAX_SPAWN_DEPTH`（同一条件的等价改写）与
`used >= MAX_SPAWNS_PER_PARENT`（逐字同条件）。本轮用有限域穷举
（depth×used 全组合过 validateSpawn，放行组合上断言 host 条件全假）证明
两个 host 分支**不可达**，并在 depth 边界实测浮出的是 validateSpawn 的
错误文本。删除因此平凡保行为——但收益恰好也因此为零：两条从不成立的比较
实测合计 3.7–5.5ns，占整个 spawn（532–556ns）的 ~1%。而该复核是
"validateSpawn 的调用点被重构/参数被改错时的最后防线"（host 不信任自己
拼装的入参），与 S4-D-4/S3-H-1/S2-D-5 的防御纵深判据同类。零收益换防线，
淘汰。

### S4-J-2/S4-J-3：本切片仅剩的"两位数 µs"候选全是 I/O 编排重叠，且全带竞态

四遍扫描后本切片纯 CPU 侧已无 µs 级以上候选；仅剩的两个两位数 µs 机会
都是把串行 await 改 `Promise.all`：

- **S4-J-2**（tracked-run 启动）：catalog 链与 learned 载入重叠收益实测
  17.1–17.9µs/run——因为两者共享同一 stateRoot 的页缓存且 learned 在无
  registry 时快速返回 undefined，重叠窗口远小于 min(两载入) 的理论上界。
  发散面有两个：双故障时浮出错误从"确定性 catalog 先抛"变为 settle 次序
  依赖（演示实测翻转）；catalog 单故障时 learned 读被投机执行（现实现
  根本不启动它——S4-D-3 在 D 区的同型投机读判据）。
- **S4-J-3**（episode 删除）：双文件 stat/rm 并行收益实测 60.4–61.6µs/
  删除，是本轮最大数字——但它挂在**一次性隐私删除工具路径**上（无重复
  调用放大），同函数随后的 feedback 级联（全量读 + 全量重写 + tombstones
  重写）支配总成本，且并行 rm 在双故障下错误身份变竞态。删除数据面强调区
  上以竞态换一次性 60µs，低于 ~190µs 否决线（S3-D-3 的 351–388µs 都被
  否决过），淘汰。

结论与 R2-J §1 一致并加强：本切片的 I/O 编排面（S2-J-10、S2-J-11、
S4-J-2、S4-J-3）已四面收口——**所有串行 await 序列要么是错误面契约，
要么重叠收益低于否决线一个数量级**。

### S4-J-4/5/6：三个"教科书微观化"在真实规模全是 ns 级

- packet 的 omissions 双遍融合 delta 在 9–87ns 间抖动（两次测量方向都
  不稳），整个编译 41µs——X3-2 的"常数遍数噪声"第 N 次再现。
- claimRole 的 box() 提升省 ~76–92ns/claim（P=15 顶格），且 mailbox 是
  数据面强调区——与同函数早已裁决的 byRole.get 重取（R1-J）同域同判。
- index 构建的两处冗余拷贝（spread-before-map、slice-after-filter）合计
  ~70–81ns/构建，占整个构建（~110µs）的 0.07%——尽管它们是本轮读码新
  发现的"客观死代码"，规模论证与 S2-J-5/S1-J-6 完全一致。值得注意
  `.slice()` 消除还依赖"filter 结果无别名"这一实现细节论证，属于以
  论证负担换 ns 的典型负性价比。

### 增长维度第四次复核：两条 O(N) 契约路径维持无更优解

preference 插入路径（recurrence 扫描 + rebuildViews + saveToDisk）与
feedback 读写路径（脱敏顺序遍 + jsonl parse + 双读串行 + 级联全量重写）
的收口论证（S1-J-1/2、S2-J-6/9/10、S3-J-1/4/5/6）在零 diff 下全部继承。
本轮无新增角度可提。

### 逐文件收口（第四遍新视角补充，R1-J/R2-J/R3-J 收口之上）

| 文件 | 第四遍新检查点 | 结论 |
| --- | --- | --- |
| `cluster/host.ts` | 见 S4-J-1；役播 stampMail 每 target 一次 `nowIso()` 提升 = S3-J-5 同一可观察面（occurredAt 分布）不另立 ID；`viewFor` 闭包每注册一次性 | 无候选落地 |
| `cluster/mailbox.ts` | 见 S4-J-5；`enqueue`/`drain`/`inbox` 拷贝为公开契约（X4-2 域） | 无候选落地 |
| `cluster/spawn.ts` | `PARENT_SPAWN_ALLOWLIST[...] ?? []` 的 `?? []` 对合法 AgentRole 不可达但删除零收益（S4-J-1 同判不另立）；allowlist includes ≤6 | 无候选 |
| `privacy/deletion.ts` | 见 S4-J-3；`statExists`+`rm(force)` 的先探测为 removedPaths 记账语义；级联 = S2-J-7 维持 | 无候选落地 |
| `privacy/record-classes.ts` / `state-layout.ts` | 字典 find 无生产调用方（R1-J S12 维持）；纯路径拼接 | 无候选 |
| `preferences/loop-eval.ts`（J1） | 与 `fb41417` 逐字节一致核对；S2-J-1/2 维持；无新残余常数 | 无候选（J1 未回退未重做） |
| `preferences/store.ts` | `byPair.get/??[]/set` 冗余 Map.set = S3-E-3 同型 ns 级不另立；`weights` 换 Map 被 saveToDisk 支配（S2-J-6 域） | 无候选 |
| `preferences/export.ts` / `materialize.ts` / `precedence.ts` / `service.ts` / `types.ts` | S3-J-6 维持；materialize 的 entries 循环换 spread = ns 级形状等价不另立；X1-4 域 find ≤5 | 无候选 |
| `episode/manager.ts` / `closure.ts` / `replay.ts` / `events.ts` / `store.ts` | reducer 每事件 spread = S1-J-3 域；`decideClosure` 的 `String(ref)` 对已是 string 的 refs = S2-J-8 域内亚 ns；append 队列 promise 链为顺序契约 | 无候选 |
| `persist/jsonl.ts` / `file-lock.ts` | S3-J-4 维持（split 占 CPU ~4%）；锁 finally 的 readFile+includes 一次性 I/O 支配 | 无候选（数据面） |
| `track/loop.ts` | 见 S4-J-2；`assignments.find` = S1-J-5、双 readAll = S2-J-11 维持；`resolvedQuestionIds` 常数规模 | 无候选落地 |
| `track/clarify.ts` / `plan.ts` / `primary-split.ts` | 双 getMaterializedView + spread 合并 = 常数规模一次性；plan 内联正则 = S3-E-5 同型 | 无候选 |
| `context/index.ts` | 见 S4-J-6；manifests 循环对 fileFact 已算过的 relativeToRoot 重算 = R3-J 已裁 S3-J-2 同规模不另立；`refreshProjectContextIndex` 每 fact Map 一次性 | 无候选落地 |
| `context/packet.ts` | 见 S4-J-4；首个 omissions.sort = S1-J-7、selectCodeMap 拷贝 = S2-J-5 维持；`summarizeOmissions`/`collapseFacts` 单遍分组+确定性排序契约 | 无候选落地 |
| `feedback/redaction.ts` / `store.ts` / `types.ts` | stripForbidden 无匹配时 split/join 已近零成本（早退探测反而加一遍扫描，S2-J-7 同型倒贴）；S3-J-1/S2-J-9/S2-J-10 维持 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-J 落地 J1（`fb41417`）起
经 R2-J、R3-J、本轮 R4-J 三遍复查累计零后续代码改动，逐字节一致。

## 5. 测试

零代码改动下相关套件与全量门禁基线复核，全绿（Node v22.22.2，pnpm 10.17.1）：

```bash
npx tsx --test test/unit/preferences/*.test.ts test/unit/cluster/*.test.ts \
  test/unit/episode/*.test.ts test/unit/context/*.test.ts \
  test/unit/privacy/*.test.ts test/unit/persist/*.test.ts \
  test/unit/track/*.test.ts test/unit/feedback/*.test.ts
# tests 91 / pass 91 / fail 0
npx tsx --test test/integration/m3/*.test.ts test/integration/cluster/*.test.ts \
  test/integration/track/*.test.ts test/integration/m4/*.test.ts
# tests 49 / pass 49 / fail 0
pnpm gate   # typecheck + lint + test + build 全绿：1168 pass / 0 fail / 1 skipped
```

仿真（临时脚本 `/tmp/r4j-sim.mts`，未入库——无赢家不落仿真文件，完整源码
见附录；seeds `0x54bb01`/`0x54bb02` 两次独立运行等价/发散结论逐位一致、
计时抖动范围内稳定）：

```text
seed=0x54bb01
S4-J-1 anchor: 8 pass combos swept; whole spawn=532ns; two dead comparisons=5.49ns -> removal saves sub-ns/spawn (defence-in-depth deletion)
S4-J-2 anchor: catalog chain=120.9us learned load=25.9us; sequential=133.8us parallel=116.8us overlap win=17.1us/run (one-shot per tracked run)
S4-J-2 double-fault: Promise.all surfaced [learned fault, catalog fault] as I/O timing flipped; sequential shape always surfaces "catalog fault"
S4-J-3 anchor: miss seq=37.4us par=29.1us; hit seq=128.1us par=67.7us overlap win=60.4us/delete (one-shot deletion tooling; double-fault error identity becomes racy)
S4-J-4 anchor O=20: two-pass=666ns fused=579ns delta=87ns/compile; whole compileContextPacket=41.4us
S4-J-5 anchor P=15: enqueue+claim=2.0us; one Map.get=6.6ns -> hoist saves ~92ns/claim (mailbox data plane)
S4-J-6 anchor I=12 D=30: spread-copy delta=8ns; slice-copy delta=68ns; whole buildProjectContextIndex=110.5us (one-shot per run)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x54bb02
S4-J-1 anchor: whole spawn=556ns; two dead comparisons=3.72ns（穷举与边界结论与 seed 1 逐位一致）
S4-J-2 anchor: sequential=130.6us parallel=112.7us overlap win=17.9us/run；double-fault 翻转与 seed 1 一致
S4-J-3 anchor: hit seq=129.1us par=67.5us overlap win=61.6us/delete
S4-J-4 anchor O=20: delta=9ns/compile（与 seed 1 的 87ns 同证纯抖动）; whole compile=41.2us
S4-J-5 anchor P=15: one Map.get=5.4ns -> hoist saves ~76ns/claim
S4-J-6 anchor: spread delta=13ns; slice delta=62ns; whole build=109.8us
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-J-1 | cluster host.spawn 深度/配额双重复核死分支删除 | 穷举证明不可达 ⇒ 收益为两条死比较 3.7–5.5ns（整个 spawn ~550ns）；删除属防御纵深拆除（S4-D-4/S3-H-1 同判据） |
| S4-J-2 | track startTrackedRun catalog∥learned Promise.all 编排重叠 | 双故障浮出错误变 settle 次序依赖（演示实测翻转）+ catalog 单故障时 learned 读投机执行（S4-D-3 同型）；重叠收益仅 17–18µs/run 一次性 |
| S4-J-3 | privacy deleteEpisodeRecords 双文件 stat/rm 并行化 | 删除数据面强调区 + 双故障错误身份竞态；重叠收益 60–62µs/一次性删除，低于 ~190µs 否决线，且级联全量重写支配 |
| S4-J-4 | context/packet codeMap omissions 双遍迭代融合单遍 | delta 9–87ns/编译（两 seed 异号级抖动）；整个编译 ~41µs（X3-2 同类） |
| S4-J-5 | cluster mailbox.claimRole 每投递 box() 查找提升 | ~76–92ns/claim（P=15 顶格）；mailbox 数据面（S2-J-3/S3-J-3 同域） |
| S4-J-6 | context/index `[...instructionFiles].map` spread 与 dirtyUnrelated `.slice()` 冗余拷贝消除 | 合计 ~70–81ns/构建、每 run 一次性（S2-J-5/S1-J-6 同域）；slice 消除还需无别名论证 |

重开条件：S4-J-2/3 若启动/删除路径变为高频批量调用（如批量 episode 删除
工具）且错误面契约显式改为聚合错误（AggregateError 决策，属语义工作），
可凭本报告等价与基准证据重开；S4-J-1 若 validateSpawn 与 host 的职责边界
被重构（复核语义显式移除），随重构自然消失，无需单独重开；S4-J-4/5/6 为
ns 级常数，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed-hex>`
（依赖已装）。seeds：`0x54bb01`、`0x54bb02`（其余段确定性构造，无随机性）。

```ts
/**
 * R4-J deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh fourth-pass candidates S4-J-1 .. S4-J-6 against the
 * current implementations in src/cluster + src/track(loop I/O orchestration
 * via its callees) + src/privacy + src/context.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed-hex>
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClusterHost } from "/workspace/src/cluster/host.js";
import { createMailbox, stampMail, type ClusterMail } from "/workspace/src/cluster/mailbox.js";
import { validateSpawn, MAX_SPAWN_DEPTH, MAX_SPAWNS_PER_PARENT } from "/workspace/src/cluster/spawn.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "/workspace/src/agents/registry.js";
import { deleteEpisodeRecords } from "/workspace/src/privacy/deletion.js";
import { runtimeRoot } from "/workspace/src/privacy/state-layout.js";
import { buildProjectContextIndex } from "/workspace/src/context/index.js";
import { compileContextPacket } from "/workspace/src/context/packet.js";
import { buildLiveCatalogConfig } from "/workspace/src/cli/model-catalog.js";
import { calibrateCatalogFromState } from "/workspace/src/routing/cost-calibration.js";
import { loadLearnedRouting } from "/workspace/src/learning/learned-routing.js";
import { parseIsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { createProjectId, createTaskId } from "/workspace/src/domain/ids.js";
import type { AgentInstanceId, EpisodeId } from "/workspace/src/domain/ids.js";
import type { AgentRole } from "/workspace/src/domain/roles.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import type { RequirementContract } from "/workspace/src/domain/contract.js";
import { stat, rm } from "node:fs/promises";

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
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps; // ms per call
}
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const SEED = Number.parseInt(process.argv[2] ?? "0x54bb01", 16) || 0x54bb01;
console.log(`seed=0x${SEED.toString(16)}`);
const NOW = parseIsoTimestamp("2026-08-24T05:00:00.000Z");
const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

/* ============================================================
 * S4-J-1: host.spawn re-checks depth and per-parent spawn quota AFTER
 * validateSpawn already threw on the identical conditions
 * (parent.depth + 1 > MAX ⟺ parent.depth >= MAX, and used >= MAX_SPAWNS).
 * Candidate: delete the two host-side dead branches.
 * Adjudication: prove unreachability by exhaustion over the finite domain,
 * confirm the surfaced error at the depth boundary is validateSpawn's
 * (distinct message text), and anchor the whole spawn cost. Removal is
 * defence-in-depth deletion for two never-taken comparisons.
 * ============================================================ */
{
  // Exhaustion: whenever validateSpawn passes, both host-side conditions are false.
  let combos = 0;
  for (let depth = 0; depth <= MAX_SPAWN_DEPTH + 2; depth += 1) {
    for (let used = 0; used <= MAX_SPAWNS_PER_PARENT + 2; used += 1) {
      let passed = false;
      try {
        validateSpawn({
          parentRole: "planner",
          parentCanDelegate: true,
          childRole: "tester",
          objective: "verify",
          depth,
          spawnsByParent: used,
          liveTaskCount: 1,
          maxTasks: 16
        });
        passed = true;
      } catch {
        /* validateSpawn rejected */
      }
      if (passed) {
        combos += 1;
        check(
          "S4-J-1 host depth re-check unreachable",
          !(depth + 1 > MAX_SPAWN_DEPTH),
          `depth=${depth}`
        );
        check(
          "S4-J-1 host quota re-check unreachable",
          !(used >= MAX_SPAWNS_PER_PARENT),
          `used=${used}`
        );
      }
    }
  }
  // Boundary error identity: at depth == MAX the surfaced message is
  // validateSpawn's ("spawn depth 2 exceeds max 2"), never the host's
  // ("spawn depth exceeds 2") — the host branch is dead in production too.
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const host = createClusterHost({
    registry,
    maxTasks: 4096,
    generateId: (() => { let n = 0; return () => `id${(n += 1)}`; })(),
    onSpawn: () => undefined
  });
  host.register("p0" as AgentInstanceId, "planner", createTaskId(() => "t-p0"));
  host.register("p1" as AgentInstanceId, "worker", createTaskId(() => "t-p1"), "p0" as AgentInstanceId);
  host.register("p2" as AgentInstanceId, "debugger" as AgentRole, createTaskId(() => "t-p2"), "p1" as AgentInstanceId);
  let boundaryMessage = "";
  try {
    host.spawn({ parentAgentId: "p2" as AgentInstanceId, role: "tester", objective: "at depth boundary" });
  } catch (error) {
    boundaryMessage = (error as Error).message;
  }
  check(
    "S4-J-1 boundary error comes from validateSpawn, not the host re-check",
    boundaryMessage === `spawn depth ${MAX_SPAWN_DEPTH} exceeds max ${MAX_SPAWN_DEPTH}`,
    boundaryMessage
  );
  // Quota boundary: after MAX_SPAWNS_PER_PARENT successful spawns the next
  // one throws from validateSpawn (identical text to the host's, but the
  // exhaustion sweep above proves the host branch is never reached).
  const parent = "p0" as AgentInstanceId;
  for (let i = 0; i < MAX_SPAWNS_PER_PARENT; i += 1) {
    host.spawn({ parentAgentId: parent, role: "tester", objective: `child ${i}` });
  }
  let quotaMessage = "";
  try {
    host.spawn({ parentAgentId: parent, role: "tester", objective: "one too many" });
  } catch (error) {
    quotaMessage = (error as Error).message;
  }
  check(
    "S4-J-1 quota boundary throws",
    quotaMessage === `parent already spawned ${MAX_SPAWNS_PER_PARENT} children`,
    quotaMessage
  );
  // Anchor: whole spawn cost (pre-register parents; each spawns exactly 4x).
  const benchHost = createClusterHost({
    registry,
    maxTasks: 1 << 20,
    generateId: (() => { let n = 0; return () => `id${(n += 1)}`; })(),
    onSpawn: () => undefined
  });
  const PARENTS = 5000;
  for (let i = 0; i < PARENTS; i += 1) {
    benchHost.register(`bp${i}` as AgentInstanceId, "planner", createTaskId(() => `t-bp${i}`));
  }
  let rep = 0;
  const spawnCost = bench(() => {
    const parentId = `bp${Math.floor(rep / MAX_SPAWNS_PER_PARENT)}` as AgentInstanceId;
    benchHost.spawn({ parentAgentId: parentId, role: "tester", objective: "bench child" });
    rep += 1;
  }, PARENTS * MAX_SPAWNS_PER_PARENT - 1);
  const cmpCost = bench(() => {
    // Two never-taken comparisons, the entire upper bound of the removal.
    void (2 + 1 > MAX_SPAWN_DEPTH);
    void (3 >= MAX_SPAWNS_PER_PARENT);
  }, 1000000);
  console.log(
    `S4-J-1 anchor: ${combos} pass combos swept; whole spawn=${(spawnCost * 1e6).toFixed(0)}ns; two dead comparisons=${(cmpCost * 1e6).toFixed(2)}ns -> removal saves sub-ns/spawn (defence-in-depth deletion)`
  );
}

/* ============================================================
 * S4-J-2: startTrackedRun awaits the catalog chain
 * (buildLiveCatalogConfig -> calibrateCatalogFromState) and then
 * loadLearnedRouting sequentially; the two are data-independent, so a
 * Promise.all could overlap them. Divergence surface: under a double fault
 * the surfaced error becomes settlement-order dependent (S2-J-10/S4-D-3
 * class), and a catalog-only fault makes the learned-routing read
 * speculative (it runs although the current shape never starts it).
 * Anchor the overlap ceiling on a realistic stateRoot.
 * ============================================================ */
{
  const dir = mkdtempSync(join(tmpdir(), "r4j-io-"));
  // Realistic stateRoot: default catalog (no providers.json -> premium/cheap
  // fall through to catalogFromPrimary), a small invocations log for the
  // calibration read, no adaptation registry (loadLearnedRouting returns
  // undefined fast). This mirrors the common tracked-run boot.
  mkdirSync(join(dir, "runtime"), { recursive: true });
  writeFileSync(
    join(dir, "runtime", "invocations.jsonl"),
    Array.from({ length: 40 }, (_, i) =>
      JSON.stringify({
        id: `inv-${i}`,
        modelId: i % 2 === 0 ? "premium" : "cheap",
        startedAt: NOW,
        finishedAt: NOW,
        outcome: "ok",
        promptHash: "h1",
        responseHash: "h2"
      })
    ).join("\n") + "\n"
  );
  const catalogChain = async (): Promise<void> => {
    await calibrateCatalogFromState(await buildLiveCatalogConfig(dir, {}), dir);
  };
  const learnedLoad = async (): Promise<void> => {
    await loadLearnedRouting(dir, "/repo/demo-project");
  };
  const catalogCost = await benchAsync(catalogChain, 300);
  const learnedCost = await benchAsync(learnedLoad, 300);
  const seqCost = await benchAsync(async () => {
    await catalogChain();
    await learnedLoad();
  }, 300);
  const parCost = await benchAsync(async () => {
    await Promise.all([catalogChain(), learnedLoad()]);
  }, 300);
  console.log(
    `S4-J-2 anchor: catalog chain=${(catalogCost * 1e3).toFixed(1)}us learned load=${(learnedCost * 1e3).toFixed(1)}us; sequential=${(seqCost * 1e3).toFixed(1)}us parallel=${(parCost * 1e3).toFixed(1)}us overlap win=${((seqCost - parCost) * 1e3).toFixed(1)}us/run (one-shot per tracked run)`
  );
  // Double-fault demonstration: Promise.all surfaces whichever rejection
  // settles first — an I/O-timing artifact — while the sequential shape
  // deterministically surfaces the catalog error.
  const failAfter = (ms: number, message: string): Promise<never> =>
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  const surfaced: string[] = [];
  for (const [catalogDelay, learnedDelay] of [[8, 1], [1, 8]] as const) {
    try {
      await Promise.all([failAfter(catalogDelay, "catalog fault"), failAfter(learnedDelay, "learned fault")]);
    } catch (error) {
      surfaced.push((error as Error).message);
    }
  }
  console.log(
    `S4-J-2 double-fault: Promise.all surfaced [${surfaced.join(", ")}] as I/O timing flipped; sequential shape always surfaces "catalog fault"`
  );
  check(
    "S4-J-2 divergence demonstrated (error identity is settlement-order dependent)",
    surfaced.length === 2 && surfaced[0] !== surfaced[1]
  );
}

/* ============================================================
 * S4-J-3: deleteEpisodeRecords probes and removes the two episode file
 * shapes (<id>.jsonl, <id>.events.jsonl) sequentially; candidate overlaps
 * the two stat/rm pairs with Promise.all (order in removedPaths kept via
 * indexed collection). Deletion data plane; under a double fault the
 * surfaced error becomes settlement-order dependent. Anchor both shapes.
 * ============================================================ */
{
  const dir = mkdtempSync(join(tmpdir(), "r4j-del-"));
  const episodesDir = join(runtimeRoot(dir), "episodes");
  mkdirSync(episodesDir, { recursive: true });
  const episodeId = "ep_r4j" as EpisodeId;
  const files = [join(episodesDir, `${episodeId}.jsonl`), join(episodesDir, `${episodeId}.events.jsonl`)];
  const statExists = async (path: string): Promise<boolean> => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
  // Parallel candidate (feedback cascade left out: both benched shapes call
  // the same cascade, so the delta isolates the two-file probe/remove).
  const parallelRemove = async (): Promise<string[]> => {
    const flags = await Promise.all(
      files.map(async (file) => {
        if (await statExists(file)) {
          await rm(file, { force: true });
          return true;
        }
        return false;
      })
    );
    return files.filter((_, index) => flags[index]);
  };
  const sequentialRemove = async (): Promise<string[]> => {
    const removed: string[] = [];
    for (const file of files) {
      if (await statExists(file)) {
        await rm(file, { force: true });
        removed.push(file);
      }
    }
    return removed;
  };
  // Equivalence on hit + miss (removedPaths order preserved by construction).
  for (const populate of [true, false]) {
    if (populate) for (const file of files) writeFileSync(file, "{}\n");
    const seq = await sequentialRemove();
    if (populate) for (const file of files) writeFileSync(file, "{}\n");
    const par = await parallelRemove();
    check(`S4-J-3 equivalence (populated=${populate})`, JSON.stringify(seq) === JSON.stringify(par));
  }
  // Production fidelity: deleteEpisodeRecords returns the same removedPaths.
  for (const file of files) writeFileSync(file, "{}\n");
  const production = await deleteEpisodeRecords(dir, episodeId);
  check(
    "S4-J-3 production fidelity",
    JSON.stringify(production.removedPaths) === JSON.stringify(files) &&
      production.cascadedFeedbackTombstones.length === 0
  );
  // Bench: miss path (stat-only overlap) and hit path (create untimed, delete timed).
  const missSeq = await benchAsync(async () => { await sequentialRemove(); }, 400);
  const missPar = await benchAsync(async () => { await parallelRemove(); }, 400);
  let hitSeqTotal = 0;
  let hitParTotal = 0;
  const HITS = 200;
  for (let i = 0; i < HITS; i += 1) {
    for (const file of files) writeFileSync(file, "{}\n");
    const t0 = performance.now();
    await sequentialRemove();
    hitSeqTotal += performance.now() - t0;
    for (const file of files) writeFileSync(file, "{}\n");
    const t1 = performance.now();
    await parallelRemove();
    hitParTotal += performance.now() - t1;
  }
  console.log(
    `S4-J-3 anchor: miss seq=${(missSeq * 1e3).toFixed(1)}us par=${(missPar * 1e3).toFixed(1)}us; hit seq=${((hitSeqTotal / HITS) * 1e3).toFixed(1)}us par=${((hitParTotal / HITS) * 1e3).toFixed(1)}us overlap win=${(((hitSeqTotal - hitParTotal) / HITS) * 1e3).toFixed(1)}us/delete (one-shot deletion tooling; double-fault error identity becomes racy)`
  );
}

/* ============================================================
 * S4-J-4: compileContextPacket iterates codeMapSelection.omissions twice
 * (map into packetCodeMapOmissions + push into omissions); candidate fuses
 * both into one loop. Same-valued; anchor the delta against the whole
 * compile at the realistic O=20 scale.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 1);
  const RANK_CODE_MAP = 70;
  type Omission = { path: string; symbol: string; reason: "token-budget"; rank: number };
  const randomOmissions = (n: number): Omission[] =>
    Array.from({ length: n }, (_, i) => ({
      path: `src/omit${Math.floor(rng() * 40)}.ts`,
      symbol: `o${i}`,
      reason: "token-budget" as const,
      rank: 1 + Math.floor(rng() * 2)
    }));
  const currentShape = (omissions: readonly Omission[]) => {
    const packetCodeMapOmissions = omissions.map((omission) => ({ ...omission, source: "index" as const }));
    const records: { key: string; reason: string; rank: number }[] = [];
    for (const omission of omissions) {
      records.push({ key: `code-map:${omission.path}:${omission.symbol}`, reason: "token-budget", rank: RANK_CODE_MAP });
    }
    return { packetCodeMapOmissions, records };
  };
  const fusedShape = (omissions: readonly Omission[]) => {
    const packetCodeMapOmissions: (Omission & { source: "index" })[] = [];
    const records: { key: string; reason: string; rank: number }[] = [];
    for (const omission of omissions) {
      packetCodeMapOmissions.push({ ...omission, source: "index" });
      records.push({ key: `code-map:${omission.path}:${omission.symbol}`, reason: "token-budget", rank: RANK_CODE_MAP });
    }
    return { packetCodeMapOmissions, records };
  };
  for (let trial = 0; trial < 400; trial += 1) {
    const omissions = randomOmissions(Math.floor(rng() * 30));
    check(
      "S4-J-4 equivalence",
      JSON.stringify(currentShape(omissions)) === JSON.stringify(fusedShape(omissions)),
      `trial ${trial}`
    );
  }
  const fixed = randomOmissions(20);
  const cur = bench(() => { currentShape(fixed); }, 100000);
  const fused = bench(() => { fusedShape(fixed); }, 100000);
  // Whole-compile anchor with a realistic index (entries fit budget, 20 omissions).
  const snapshot = {
    id: createProjectId(UUID),
    rootPath: "/repo",
    discoveredAt: NOW,
    instructionFiles: Array.from({ length: 6 }, (_, i) => ({ path: `/repo/dir${i}/AGENTS.md` })),
    manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
    commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  } as unknown as ProjectSnapshot;
  const index = {
    ...buildProjectContextIndex(snapshot),
    codeMap: {
      schemaVersion: 1 as const,
      tokenBudget: 2000,
      estimatedTokens: 900,
      entries: Array.from({ length: 60 }, (_, i) => ({
        path: `src/mod${i % 7}/file${i}.ts`,
        symbol: `sym${i}`,
        kind: "function" as const,
        public: i % 3 === 0,
        calls: [`callee${i % 5}`]
      })),
      omissions: fixed
    }
  };
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "demo objective",
    deliverables: [],
    constraints: [{ id: "c1", description: "keep the API stable" }] as never,
    nonGoals: [],
    acceptanceCriteria: [],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
  const whole = bench(() => {
    compileContextPacket({ taskId: createTaskId(UUID), contract, index, tokenBudget: 2000, selectorVersion: 1 });
  }, 3000);
  console.log(
    `S4-J-4 anchor O=20: two-pass=${(cur * 1e6).toFixed(0)}ns fused=${(fused * 1e6).toFixed(0)}ns delta=${((cur - fused) * 1e6).toFixed(0)}ns/compile; whole compileContextPacket=${(whole * 1e3).toFixed(1)}us`
  );
}

/* ============================================================
 * S4-J-5: mailbox.claimRole re-resolves box(agentId) once per delivered
 * mail; candidate hoists the recipient list lookup out of the loop.
 * Same-valued (the loop never mutates byAgent for other ids and box() is
 * get-or-create-once). Mailbox is data plane; anchor the per-claim cost.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 2);
  const mkMail = (i: number, from: string): ClusterMail =>
    stampMail({
      id: `m${i}` as ClusterMail["id"],
      from: from as AgentInstanceId,
      body: `mail body ${i}`,
      addressRole: "tester",
      occurredAt: NOW
    });
  // Equivalence: production claimRole vs hoisted verbatim variant.
  const hoistedClaim = (pending: readonly ClusterMail[], agentId: string) => {
    const inbox: ClusterMail[] = [];
    const requeued: ClusterMail[] = [];
    const delivered: ClusterMail[] = [];
    for (const mail of pending) {
      if (mail.from === agentId) {
        requeued.push(mail);
        continue;
      }
      const copy = { ...mail, to: agentId as AgentInstanceId };
      inbox.push(copy);
      delivered.push(copy);
    }
    return { inbox, requeued, delivered };
  };
  for (let trial = 0; trial < 300; trial += 1) {
    const mailbox = createMailbox();
    const n = 1 + Math.floor(rng() * 16);
    const pending: ClusterMail[] = [];
    for (let i = 0; i < n; i += 1) {
      const mail = mkMail(i, rng() < 0.2 ? "agent-claimer" : `agent-s${Math.floor(rng() * 3)}`);
      mailbox.enqueue(mail);
      pending.push(mail);
    }
    const delivered = mailbox.claimRole("tester", "agent-claimer" as AgentInstanceId);
    const variant = hoistedClaim(pending, "agent-claimer");
    check(
      "S4-J-5 equivalence (delivered mails)",
      JSON.stringify(delivered) === JSON.stringify(variant.delivered),
      `trial ${trial}`
    );
    check(
      "S4-J-5 equivalence (inbox + requeued)",
      JSON.stringify(mailbox.inbox("agent-claimer" as AgentInstanceId)) === JSON.stringify(variant.inbox) &&
        JSON.stringify(mailbox.pendingForRole("tester")) === JSON.stringify(variant.requeued),
      `trial ${trial}`
    );
  }
  // Anchor: whole claim of P=15 pending mails vs one Map.get.
  const claimCost = bench(() => {
    const mailbox = createMailbox();
    for (let i = 0; i < 15; i += 1) mailbox.enqueue(mkMail(i, `agent-s${i % 3}`));
    mailbox.claimRole("tester", "agent-claimer" as AgentInstanceId);
  }, 5000);
  const map = new Map([["agent-claimer", [] as ClusterMail[]]]);
  const getCost = bench(() => { map.get("agent-claimer"); }, 1000000);
  console.log(
    `S4-J-5 anchor P=15: enqueue+claim=${(claimCost * 1e3).toFixed(1)}us; one Map.get=${(getCost * 1e6).toFixed(1)}ns -> hoist saves ~${(14 * getCost * 1e6).toFixed(0)}ns/claim (mailbox data plane)`
  );
}

/* ============================================================
 * S4-J-6: buildProjectContextIndex carries two redundant copies:
 * `[...snapshot.instructionFiles].map(...)` (spread before map, which
 * already allocates) and `dirtyPaths.filter(...).slice().sort(...)`
 * (slice of a fresh filter result). Same-valued eliminations; anchor at
 * the one-shot per-run build scale.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 3);
  const files = Array.from({ length: 12 }, (_, i) => ({ path: `/repo/dir${i % 5}/AGENTS.md`, index: i }));
  const dirty = Array.from({ length: 30 }, (_, i) => `/repo/src/f${Math.floor(rng() * 40)}-${i}.ts`);
  const generated = ["/repo/dist", "/repo/build"];
  const withSpread = () => [...files].map((file) => file.path);
  const withoutSpread = () => files.map((file) => file.path);
  const isUnder = (path: string): boolean => generated.some((g) => path === g || path.startsWith(`${g}/`));
  const withSlice = () => dirty.filter((path) => !isUnder(path)).slice().sort();
  const withoutSlice = () => dirty.filter((path) => !isUnder(path)).sort();
  check("S4-J-6 spread elision same-valued", JSON.stringify(withSpread()) === JSON.stringify(withoutSpread()));
  check("S4-J-6 slice elision same-valued", JSON.stringify(withSlice()) === JSON.stringify(withoutSlice()));
  const spreadCost = bench(() => { withSpread(); }, 200000);
  const noSpreadCost = bench(() => { withoutSpread(); }, 200000);
  const sliceCost = bench(() => { withSlice(); }, 100000);
  const noSliceCost = bench(() => { withoutSlice(); }, 100000);
  const snapshot = {
    id: createProjectId(UUID),
    rootPath: "/repo",
    discoveredAt: NOW,
    instructionFiles: files.map((file) => ({ path: file.path })),
    manifests: Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` })),
    commands: Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` })),
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  } as unknown as ProjectSnapshot;
  const whole = bench(() => {
    buildProjectContextIndex(snapshot, { dirtyPaths: dirty, generatedPaths: generated });
  }, 2000);
  console.log(
    `S4-J-6 anchor I=12 D=30: spread-copy delta=${((spreadCost - noSpreadCost) * 1e6).toFixed(0)}ns; slice-copy delta=${((sliceCost - noSliceCost) * 1e6).toFixed(0)}ns; whole buildProjectContextIndex=${(whole * 1e3).toFixed(1)}us (one-shot per run)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r4-j-persist-fourth-pass-83a1

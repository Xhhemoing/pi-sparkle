MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-J：数据面切片（cluster / privacy / preferences / episode / persist / track / context / feedback）复查报告（Round 1 同区第二遍）

**战役:** 全库持久 SOTA 优化 Round 2 / R2-J
**基线:** `cursor/sota-persistent-opt-83a1` @ `9e1886c`
**分支:** `cursor/r2-j-persist-slice-a4e3`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 29 个文件（`src/cluster/` 3、
`src/privacy/` 3、`src/preferences/` 7、`src/episode/` 5、`src/persist/` 2、
`src/track/` 4、`src/context/` 2、`src/feedback/` 3）自 R1-J 基线（`7acb666`）
以来除已落地的 J1（`src/preferences/loop-eval.ts`，`fb41417`）外**逐字节未变**
（`git diff 7acb666..9e1886c -- <切片>` 仅含 loop-eval.ts），R1-J 的逐文件收口
与 S1-J-1..7 排除全部继承有效。本轮在完整排除表（含 Round 1 十区 S1-* 与 R2
已产出的 S2-A/B/C/D/E/F/G-*）之上再次全量实际读码、以新角度枚举，得到 11 个
此前未点名的新候选（S2-J-1 … S2-J-11），全部经理论 + 确定性仿真（seeded
mulberry32，等价 fuzz / **行为发散反例** / 真实规模基准，两次独立运行等价与
反例结论逐位一致、计时抖动范围内稳定）裁决后淘汰：**1 个被反例证明非保行为
且实测更慢**（S2-J-2 会翻转 fit/correctionCost/reversalEvents 三项可观察指标），
**1 个的调用次数面可观察**（S2-J-1，公开 ReadonlySet 扩展点，S1-F-2 同类，且
被测函数无生产调用方），其余 9 个在真实规模是 ns~µs 级噪声（最强合法者
S2-J-10 约 48–73µs/读且引入双故障抛错次序竞态，低于战役否决线——S1-I-1 的
~190µs 亦被否决）。未重开任何 X* / S1-* / S2-* 条目。数据面（删除/脱敏/状态
布局、mailbox、episode 闭合、jsonl 锁语义）**零 diff**，可见行为天然不变。
J1 之上本切片在其数据面契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、
  `src/persist/`、`src/track/`、`src/context/`、`src/feedback/`。29 个文件
  （约 3655 行）本轮全部再次实际读码，未依赖 R1-J 的记忆。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-J.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-J-1（rebuildViews 增量化）、
  S1-J-2（recurrence 计数器化）、S1-J-3（reduceEpisodeEvents runIds Set）、
  S1-J-4（役播 role→agent 索引）、S1-J-5（track/loop assignments.find Map）、
  S1-J-6（dirty×generated 前缀索引）、S1-J-7（首个 omissions.sort 移除）七条
  全部不再提案；X1-1（模块级隐藏缓存）、X0-5（asRecord 合并）、X4-2（readonly
  追加拷贝）直接跳过。本轮只探索**未被点名的新角度**：J1 落地代码自身的残余
  常数（S2-J-1/2）、役播每目标重复 trim（S2-J-3）、索引构建重复 find
  （S2-J-4）、packet 防御拷贝（S2-J-5）、插入路径中间数组（S2-J-6）、删除
  级联无匹配早退（S2-J-7）、闭合判定 Set 提升（S2-J-8）、追加路径重复排序
  （S2-J-9）、读路径 I/O 并行（S2-J-10）、等待路径双读消除（S2-J-11）。
- **数据面强调区未碰**：`privacy/deletion.ts` 的全量读→map→全量重写级联、
  `persist/file-lock.ts` 的 wx/ownerToken/重试语义、`persist/jsonl.ts` 的
  截尾恢复、`cluster/mailbox.ts` 的 role 队列 claim 语义、`episode/manager.ts`
  的 fail-closed reducer——零 diff，可见行为天然不变。
- 规格强制双路（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区。
  不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。
- 仓库变更仅本报告一个文件。

## 1. 规模与门槛基底（继承 + 本轮校准）

R1-J 已实测本切片规模：episode 内 run 数、cluster peer 数（≤ maxTasks=16）、
track 子任务数（C≤~6）、context 构建输入（十位级）、redaction needles（=4）
全部为小常数；**唯一无上界增长维度是 preference 观察数 N 与 feedback 记录数
N**。前者的度量路径已被 J1 收口为 Θ(N log N)（且 `evaluatePreferenceLoop`
**无生产调用方**——仅测试与度量脚本引用）；两者的插入/读取路径均被同路径的
全量 JSON 序列化 + 磁盘 I/O 支配（本轮实测：N=5000 时 `saveToDisk` 的
`JSON.stringify` 一项 ~1.5ms，同路径 filter→count 候选仅 ~30µs，差 ~50×）。
战役落地线继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit），µs 级候选一律被否决过（S1-I-1 ~190µs、S2-D-4 ~116µs、S2-G-8
~35µs）。本轮全部合法候选的绝对收益上界是 ~48–73µs/读（S2-J-10，且带竞态
风险）；更大的数字（S2-J-1 在 N=6000 极端夹具下 ~115–172µs）挂在无生产调用
方的 API 上且调用次数面可观察。据此裁决。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-J-1 | `loop-eval` 每迭代两次 `tombstones.has(obs.id)` 合并局部布尔 | 免每观察 1 次 Set.has | ✅ 值等价（300 轮 fuzz 逐位一致）；❌ **调用次数发散**：插桩 ReadonlySet 实测 N=500 时 current=1000 次、deduped=500 次 | N=6000 极端夹具 delta 115–172µs（Set.has 上界 ~77µs）；**该 API 无生产调用方**（仅测试/度量脚本） | 淘汰：公开 ReadonlySet 扩展点的调用次数可观测（S1-F-2 同判据；R1-J 落地时明确保留该调用模式作为忠实性论证一部分）+ test-only |
| S2-J-2 | `loop-eval` createdAt 排序换预计算 `Date.parse` 数字键 | 免排序中字符串比较 | ❌ **反例**：`IsoTimestamp` 正则同时接受 `Z` 与 `+00:00` 后缀（及 1–9 位小数），同刻不同字符串在字典序比较器下有序、在数字键下并列（稳定排序保输入序）→ 折叠顺序不同 → 实测 fit 0 vs 0.5、corrections 2 vs 1、reversals 1 vs 0 | 公平 decorate-sort-undecorate 变体在 N=6000 还**更慢**（3.44ms vs 3.81ms） | 淘汰：**非保行为** + 实测负优化，双重淘汰 |
| S2-J-3 | `cluster/host.ts` 役播每目标重复 `input.body.trim()` 提升 + `targets.slice(1)` 消除 | 免 P-1 次 trim + 1 次 slice | ✅（trim 纯函数，平凡） | P=15 上限（maxTasks=16）实测 trim(256 字符)=18–40ns → 每 send 省 ~265–605ns；整个役播 send=13–14µs | 淘汰：亚噪声；mailbox 数据面强调区（S1-J-4 邻域） |
| S2-J-4 | `context/index.ts` `commandSourceKey` 每 command 重复 `manifests.find`(package.json) 提升 | O(C×M)→O(C+M) | ✅ find 与 command 名无关，逐 command 同值断言通过 | C=8 M=12 实测省 ~5.9µs/构建；整个 `buildProjectContextIndex`=38–44µs、每 run 一次性 | 淘汰：一次性构建 µs 级噪声（S1-J-6 姊妹） |
| S2-J-5 | `context/packet.ts` `selectCodeMap` entries/omissions 防御拷贝省略 | 免 2 次 O(E) 拷贝 | ✅（两数组仅被只读消费；omissions 另行 map 成新对象） | E=60/O=20 实测拷贝仅 ~42–49ns/编译；整个 `compileContextPacket`=~41µs | 淘汰：亚噪声 |
| S2-J-6 | `preferences/store.ts` `applyObservation` 的 `filter().length` 换单遍计数（免中间数组） | 同 O(N)，免一次数组分配 | ✅ 500 轮 fuzz 计数逐位一致 | N=5000 实测省 ~30µs/插入；同一插入路径的 `saveToDisk` 仅 `JSON.stringify` 就 ~1.5–1.9ms（+同步磁盘写）**支配 ~50×** | 淘汰：被同路径持久化契约支配（S1-J-2 姊妹——那是跨调用计数器，这是调用内分配；两者同域同判） |
| S2-J-7 | `privacy/deletion.ts` `cascadeFeedbackTombstones` 无匹配先探测早退（免 O(N) map 分配） | 无匹配免 map；有匹配多一遍 some | ✅ 匹配/无匹配输出 JSON 逐位一致 | N=2000 无匹配省 ~3.7µs、有匹配多花 ~0.5–1.0µs；有匹配路径随后**全量重写磁盘日志**（级联契约）支配 | 淘汰：数据面强调区 + µs 噪声 |
| S2-J-8 | `episode/closure.ts` `decideClosure` evidenceRefs Set 提升（O(A×(E+R))→O(A×E+R)） | 免嵌套 includes | ✅ 800 轮 fuzz missing 列表逐位一致（字符串上 includes 的 === 与 Set 的 SameValueZero 相同） | A=6 E=6 R=6 实测**整个 decideClosure 仅 ~790–850ns**，每次 close 决策一次性 | 淘汰：亚 µs 全量成本，无可省空间（R1-J S7 判定本轮补 ID） |
| S2-J-9 | `feedback/redaction.ts` store 固定 REDACTION 的 4 条 needles 每 append 重排序提升为模块常量 | 免每 append 拷贝+过滤+排序 | ✅（needles 冻结常量，平凡） | 实测排序 ~116ns/append vs 磁盘 append ~3.3–3.4µs/append（**I/O 支配 ~30×**） | 淘汰：噪声 + 模块级派生缓存（X1-1 邻域）或需特判 store 策略（公开 `redactFeedback` 按调用传 policy） |
| S2-J-10 | `feedback/store.ts` `readFeedback` 双 await 串行读改 `Promise.all` 并行 | 重叠两次小文件读延迟 | ⚠️ 值等价但**双故障抛错身份变竞态**：records.jsonl 损坏 + tombstones.json 畸形同时发生时，当前实现确定性先抛 jsonl 错误；`Promise.all` 抛先 settle 者（I/O 时序依赖） | 实测重叠收益 ~48–73µs/读（单文件读 ~3µs 同步 / ~60µs async 往返） | 淘汰：S1-D-7/S1-E-5 同类（双故障抛错次序 + 非复杂度下降），且低于 ~190µs 否决线 |
| S2-J-11 | `track/loop.ts` `waitForClarification` 双 `eventStore.readAll()` 用内存事件镜像消除 | 免 ≤2 次全量读 | —（未实现：两读之间 `settleBoundEpisode` 有追加，镜像即缓存） | 实测 7 事件 readAll（含 parse）~5.5µs/次；等待路径一次性、被多次 appendFile+checkpoint 写支配 | 淘汰：**S1-G-1 同域**——磁盘为跨进程事实源 + 截尾恢复读校验契约；µs 级噪声 |

## 3. 关键裁决细节

### S2-J-2：为何"显然的"排序键数字化会改判度量（本轮最重要发现）

`evaluatePreferenceLoop` 的比较器是 **createdAt 字符串字典序**（`fb41417` 逐字
保留了 `7acb666` 的比较器）。`isIsoTimestamp` 的正则
`^\d{4}-…(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$` 同时接受 `Z` 与 `+00:00` 后缀以及
1–9 位小数，因此**同一时刻存在多种合法字符串表示**。构造
`s1="2026-01-01T00:00:00+00:00"`、`s2="2026-01-01T00:00:00Z"`
（`Date.parse` 相等、`s1 < s2` 字典序），输入序 `[B@s2, A@s1, A@s3]`：

- 当前实现（字典序）：折叠序 A→B→A ⇒ fit 0、corrections 2、reversals 1。
- 数字键 + 稳定排序：s1/s2 并列保输入序，折叠序 B→A→A ⇒ fit 0.5、
  corrections 1、reversals 0。

三项公开指标全部发散——排序键数字化**非保行为**。且公平的
decorate-sort-undecorate 实现在 N=6000 实测反而慢 ~0.3–0.4ms（decorate 分配
压过比较器差价）。双重淘汰，反例入库供未来轮次直接引用。

### S2-J-1：J1 落地代码上唯一的残余常数为何不动

J1 后每迭代仍调用两次 `tombstones.has(obs.id)`（撤销判定 + forgetting 记账）。
R1-J 报告在忠实性论证 (iv) 中**明确保留了该调用模式**。本轮插桩验证：该参数
是公开 `ReadonlySet<string>` 扩展点，调用方可传入自定义实现（R1-J 的等价仿真
自己就是这么做插桩的），合并两次调用把可观测调用序列从 2N 降到 N——与
S1-F-2（`propensityFor` 调用次数可观测）同判据。叠加两点：该函数**无生产
调用方**（全仓引用仅 `test/unit/preferences/loop-eval.test.ts` 与
`scripts/r1j-equivalence-sim.ts`），N=6000 极端夹具下的 ~115–172µs 在真实
测试规模（N≤6）是亚 ns 事件。淘汰。

### 增长维度复核：为何 O(N)/插入的 preference 存储不再有合法收口点

`applyObservation` 路径 = recurrence 扫描 O(N) + `rebuildViews` O(N) +
`saveToDisk` 全量序列化 O(N)。三段中：rebuildViews 增量化改 `lastUpdated`
可见时间戳（S1-J-1 维持）；recurrence 计数器化是跨调用派生索引（S1-J-2
维持）；全量快照写盘是持久化契约本身（S1-G-2 同域）。本轮新角度 S2-J-6
（调用内免分配）实测被序列化支配 ~50×。结论：该 O(N)/插入是契约代价，
在不改契约的前提下无更优解。feedback 读路径同理（S1-G-1 域 + S2-J-10）。

### 逐文件收口（本轮新视角补充，R1-J 收口之上）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `preferences/loop-eval.ts`（J1 后） | 见 S2-J-1/2；排序拷贝为入参保护必需；折叠体已 O(1)/步 | 无候选落地 |
| `preferences/store.ts` | 见 S2-J-6；`loadFromDisk` 一次性；`findConflicts`/`rebuildViews` 单遍分组+折叠；`deleteObservation` findIndex+splice 被 save 支配 | 无候选落地 |
| `preferences/precedence.ts` / `export.ts` / `materialize.ts` / `service.ts` / `types.ts` | 表长 5 的 find（X1-4 域）；导出为一次性授权路径、JSON.stringify 支配 | 无候选 |
| `episode/manager.ts` | `attachRun`/reducer 的 `runIds.includes` + 拷贝 = **S1-J-3 维持**（单 episode run 数个位）；`TERMINAL_STATUSES` 已模块级 Set | 无候选（S1-J-3 遵守） |
| `episode/closure.ts` | 见 S2-J-8 | 无候选落地 |
| `episode/store.ts` / `replay.ts` / `events.ts` | append 队列/截尾恢复为持久化契约；类型声明 | 无候选 |
| `cluster/host.ts` | 见 S2-J-3；役播过滤 = **S1-J-4 维持**；`peers()` 防御拷贝为公开契约（X4-2 域） | 无候选落地 |
| `cluster/mailbox.ts` / `spawn.ts` | `claimRole` 循环内 `byRole.get` 重取为 R1-J 已裁噪声、数据面；allowlist `includes` 表长 ≤6 | 无候选 |
| `privacy/deletion.ts` | 见 S2-J-7；`[...tombstones].sort()`/`cascaded.sort()` 为确定性输出契约 | 无候选落地 |
| `privacy/record-classes.ts` / `state-layout.ts` | 字典 find 上界 17、无生产调用方；纯路径拼接 | 无候选 |
| `persist/jsonl.ts` / `file-lock.ts` | 单遍 split+parse + 截尾恢复；wx/ownerToken/重试为锁语义 | 无候选（数据面） |
| `track/loop.ts` | 见 S2-J-11；`assignments.find` = **S1-J-5 维持**；`catalogIds.includes` M≤10（X3-1 域）；children.flatMap 单遍 | 无候选落地（S1-J-5 遵守） |
| `track/plan.ts` / `clarify.ts` / `primary-split.ts` | 常数规模决策、单遍 filter；`applyAnswers` 单遍 | 无候选 |
| `context/index.ts` | 见 S2-J-4；dirty×generated = **S1-J-6 维持**；`relativeToRoot` 重复 normalize root 为排序比较器内 ns 级；architecture/risks 双 filter+sort = X3-2 域 | 无候选落地（S1-J-6 遵守） |
| `context/packet.ts` | 见 S2-J-5；首个 omissions.sort = **S1-J-7 维持**；`collapseFacts`/`pickCanonical` 分组+排序为规范化契约；`queryPacketGrounding` O(lines×tokens) 一次性查询 | 无候选落地（S1-J-7 遵守） |
| `feedback/redaction.ts` | 见 S2-J-9；`CLASS_ORDER.filter` 表长 5 | 无候选落地 |
| `feedback/store.ts` / `types.ts` | 见 S2-J-10；双层墓碑过滤为隐私契约（R1-J S21 维持） | 无候选落地 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 5. 测试

零代码改动下相关套件基线复核，全绿（Node v22.22.2，pnpm 10.17.1）：

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

仿真（临时脚本，未入库；完整源码见附录，seeds 固定可复现，两次独立运行
等价/反例结论逐位一致、计时抖动范围内稳定）：

```text
control fidelity: 400 randomized cases bitwise-equal to production evaluatePreferenceLoop
S2-J-1 observable surface: tombstones.has calls at N=500 current=1000 deduped=500 (public ReadonlySet extension point)
S2-J-1 bench N=6000: current-shape=3.466ms deduped=3.294ms delta=172.0us; one Set.has=13.7ns -> upper bound N*has=82.1us (no production caller; test/metric-only API)
S2-J-2 counterexample: current fit=0 corrections=2 reversals=1 | numeric-key fit=0.5 corrections=1 reversals=0
S2-J-2 bench N=6000: string-sort fold=3.441ms numeric-key fold=3.811ms (illegal win bounded at -369.5us)
S2-J-3 anchor P=15 targets: whole role-cast send=14.2us; one trim(256 chars)=21ns -> hoist saves 310ns/send; slice(1)=40ns
S2-J-4 anchor C=8 M=12: whole buildProjectContextIndex=43.6us; one package.json find=853ns -> hoist saves 5974ns/build (one-shot per run)
S2-J-5 anchor E=60/O=20: whole compileContextPacket=40.6us; selectCodeMap copies=42ns/compile (read-only use, elision same-valued)
S2-J-6 bench N=5000: filter=46.4us count=16.1us delta=30.3us/insert; same-path saveToDisk JSON.stringify=1455us (+ sync disk write) dominates
S2-J-7 bench N=2000: no-match current=6.8us probe-first=3.2us (saves 3.7us); match current=8.8us probe-first=9.3us (extra pass costs 0.5us); deletion cascade then rewrites the whole log to disk
S2-J-8 anchor A=6 E=6 R=6: whole decideClosure=788ns per close decision (one-shot)
S2-J-9 anchor: needles copy+filter+sort=116ns/append vs disk append=3.4us/append (I/O dominates ~30x)
S2-J-10 anchor: sequential 2-file read=117.6us parallel=54.0us overlap win=63.6us/read; sync single read=3.2us (double-fault error identity becomes racy under Promise.all)
S2-J-11 anchor: one 7-event readAll(parse incl.)=5.5us -> in-memory mirror saves <=2 reads on a one-shot waiting path (disk source-of-truth + truncated-tail recovery contract = S1-G-1 domain)
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-J-1 | loop-eval 每迭代两次 `tombstones.has` 合并局部布尔 | 公开 ReadonlySet 扩展点调用次数可观测（插桩实测 2N→N，S1-F-2 同判据）；无生产调用方，N=6000 极端夹具亦仅 ~115–172µs |
| S2-J-2 | loop-eval createdAt 排序换 Date.parse 数字键 | **非保行为**：`Z` vs `+00:00` 同刻不同串在数字键下并列、稳定排序保输入序 → fit/corrections/reversals 三项指标实测发散；公平实现还慢 ~0.3ms |
| S2-J-3 | cluster 役播每目标 `body.trim()` 提升 + `slice(1)` 消除 | P≤16 上限实测 ~265–605ns/send；mailbox 数据面（S1-J-4 邻域） |
| S2-J-4 | context/index `commandSourceKey` package.json find 提升 | 同值平凡但 ~6µs/构建、每 run 一次性（S1-J-6 姊妹） |
| S2-J-5 | context/packet `selectCodeMap` 防御拷贝省略 | 只读使用等价，但 ~42–49ns/编译 |
| S2-J-6 | preferences `applyObservation` filter→单遍计数 | ~30µs/插入被同路径 `saveToDisk` 序列化（~1.5ms）支配 ~50×（S1-J-2 姊妹） |
| S2-J-7 | privacy 删除级联无匹配先探测早退 | 无匹配省 ~3.7µs、有匹配倒贴一遍扫描；数据面强调区，重写磁盘支配 |
| S2-J-8 | episode `decideClosure` evidenceRefs Set 提升 | 整个函数 ~800ns/一次性 close 决策，无可省空间 |
| S2-J-9 | feedback store 固定 needles 排序提升模块常量 | ~116ns/append vs 磁盘 append ~3.4µs（30×）；模块级派生缓存 X1-1 邻域 |
| S2-J-10 | feedback `readFeedback` 双读改 Promise.all | 双故障（jsonl 损坏+墓碑畸形）抛错身份变 I/O 时序竞态（S1-D-7 同类）；重叠收益 ~48–73µs 低于否决线 |
| S2-J-11 | track `waitForClarification` 双 readAll 内存镜像消除 | S1-G-1 同域（磁盘跨进程事实源 + 截尾恢复读校验）；~5.5µs/读、一次性等待路径 |

重开条件：S2-J-2 需先做出**行为变更决策**（时间戳规范化为单一表示，届时属
语义工作而非保行为优化）；S2-J-1 若 `evaluatePreferenceLoop` 获得高频生产
调用方且明确其 tombstones 参数永远是原生 Set，可凭本报告等价 fuzz 重开；
S2-J-6/10 若 preference/feedback 存储契约改为增量持久化（另立项）后规模
论证失效，可重开；其余为 ns~µs 级常数，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0x527210` … `0x527217`（其余段确定性构造，无随机性）。

```ts
/**
 * R2-J deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh candidates S2-J-1 .. S2-J-11 against the current
 * implementations in src/preferences + src/cluster + src/context +
 * src/episode + src/privacy + src/feedback + src/track.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file>
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreferenceLoop } from "/workspace/src/preferences/loop-eval.js";
import { MIN_INFERRED_RECURRENCE_DEFAULT } from "/workspace/src/preferences/store.js";
import type { PreferenceObservation } from "/workspace/src/preferences/types.js";
import { createClusterHost } from "/workspace/src/cluster/host.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "/workspace/src/agents/registry.js";
import { buildProjectContextIndex } from "/workspace/src/context/index.js";
import { compileContextPacket } from "/workspace/src/context/packet.js";
import { decideClosure } from "/workspace/src/episode/closure.js";
import { parseIsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { createProjectId, createTaskId } from "/workspace/src/domain/ids.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import type { ProjectEpisode } from "/workspace/src/domain/episode.js";
import type { RequirementContract } from "/workspace/src/domain/contract.js";
import type { AgentInstanceId, EpisodeId, RunId } from "/workspace/src/domain/ids.js";

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
const sameReport = (a: ReturnType<typeof evaluatePreferenceLoop>, b: ReturnType<typeof evaluatePreferenceLoop>): boolean =>
  Object.is(a.fit, b.fit) && Object.is(a.correctionCost, b.correctionCost) &&
  Object.is(a.forgettingEvents, b.forgettingEvents) && Object.is(a.reversalEvents, b.reversalEvents);

/* ============================================================
 * Verbatim reimplementation of the CURRENT evaluatePreferenceLoop fold
 * (J1 shape), parameterized only by the sort step, so candidate deltas can
 * be implemented and measured while the control stays bitwise-checkable
 * against production. dedupeHas additionally collapses the two
 * tombstones.has calls per iteration into one local boolean (S2-J-1).
 * ============================================================ */
type EffVal = string | number | boolean;
interface SubjState { lastExplicit: EffVal | undefined; lastDurableInferred: EffVal | undefined; inferredCounts: Map<string, number>; }
function foldVariant(
  observations: readonly PreferenceObservation[],
  tombstones: ReadonlySet<string>,
  opts: { numericSortKey?: boolean; dedupeHas?: boolean } = {}
): ReturnType<typeof evaluatePreferenceLoop> {
  // Fair candidate shape: precomputed epoch keys (decorate-sort-undecorate),
  // not Date.parse inside the comparator.
  const sorted = opts.numericSortKey === true
    ? observations
        .map((obs) => ({ key: Date.parse(obs.createdAt), obs }))
        .sort((a, b) => a.key - b.key)
        .map((item) => item.obs)
    : [...observations].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const subjectId = (o: PreferenceObservation): string => `${o.scope}\u0000${o.scopeKey}\u0000${o.key}`;
  const valueKey = (v: EffVal): string => `${typeof v}:${String(v)}`;
  const effectiveOf = (s: SubjState): EffVal | undefined => s.lastExplicit ?? s.lastDurableInferred;
  const bySubject = new Map<string, SubjState>();
  const lastFlippedAway = new Map<string, EffVal>();
  let laterExplicit = 0, laterExplicitMatches = 0, correctionCost = 0, forgettingEvents = 0, reversalEvents = 0;
  for (const obs of sorted) {
    const id = subjectId(obs);
    let state = bySubject.get(id);
    if (state === undefined) {
      state = { lastExplicit: undefined, lastDurableInferred: undefined, inferredCounts: new Map() };
      bySubject.set(id, state);
    }
    const before = effectiveOf(state);
    const inferredBefore = before !== undefined && state.lastExplicit === undefined;
    if (obs.explicit && before !== undefined) {
      laterExplicit += 1;
      if (before === obs.value) laterExplicitMatches += 1;
      else { correctionCost += 1; if (inferredBefore) forgettingEvents += 1; }
    }
    const prevLastExplicit = state.lastExplicit;
    const prevLastDurableInferred = state.lastDurableInferred;
    let inferredKey: string | undefined;
    if (obs.explicit) state.lastExplicit = obs.value;
    else {
      inferredKey = valueKey(obs.value);
      const count = (state.inferredCounts.get(inferredKey) ?? 0) + 1;
      state.inferredCounts.set(inferredKey, count);
      if (count >= MIN_INFERRED_RECURRENCE_DEFAULT) state.lastDurableInferred = obs.value;
    }
    const mid = effectiveOf(state);
    const tomb = opts.dedupeHas === true ? tombstones.has(obs.id) : undefined;
    const isTomb1 = opts.dedupeHas === true ? tomb! : tombstones.has(obs.id);
    if (isTomb1) {
      state.lastExplicit = prevLastExplicit;
      state.lastDurableInferred = prevLastDurableInferred;
      if (inferredKey !== undefined) {
        const count = state.inferredCounts.get(inferredKey) ?? 0;
        if (count <= 1) state.inferredCounts.delete(inferredKey);
        else state.inferredCounts.set(inferredKey, count - 1);
      }
    }
    const after = effectiveOf(state);
    const isTomb2 = opts.dedupeHas === true ? tomb! : tombstones.has(obs.id);
    if (isTomb2 && mid !== undefined && after === undefined) forgettingEvents += 1;
    if (before !== undefined && after !== undefined && before !== after) {
      const origin = lastFlippedAway.get(id);
      if (origin !== undefined && origin === after) reversalEvents += 1;
      lastFlippedAway.set(id, before);
    } else if (after === undefined) {
      lastFlippedAway.delete(id);
    }
  }
  return {
    fit: laterExplicit === 0 ? 1 : laterExplicitMatches / laterExplicit,
    correctionCost, forgettingEvents, reversalEvents
  };
}

function randomObservations(rng: () => number, n: number): { observations: PreferenceObservation[]; tombstones: Set<string> } {
  const scopes = ["user", "project", "task-family", "role", "model"] as const;
  const values: EffVal[] = ["fast", "slow", "0", 0, 1, true, false];
  const observations: PreferenceObservation[] = [];
  const tombstones = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const id = `obs-${i}`;
    const ms = 1700000000000 + Math.floor(rng() * 500000) * 1000;
    observations.push({
      id,
      scope: scopes[Math.floor(rng() * scopes.length)]!,
      scopeKey: `k${Math.floor(rng() * 2)}`,
      key: `key${Math.floor(rng() * 3)}`,
      value: values[Math.floor(rng() * values.length)]!,
      evidenceEpisodeId: "ep_x" as EpisodeId,
      weight: 1,
      createdAt: parseIsoTimestamp(new Date(ms).toISOString()),
      explicit: rng() < 0.3,
      recurrenceCount: 1
    });
    if (rng() < 0.25) tombstones.add(id);
  }
  return { observations, tombstones };
}

/* ============================================================
 * Control fidelity: the parameterized reimplementation with default opts
 * must match production evaluatePreferenceLoop bitwise on a randomized
 * corpus, so candidate deltas measured on it transfer.
 * ============================================================ */
{
  const rng = mulberry32(0x527210);
  for (let trial = 0; trial < 400; trial += 1) {
    const { observations, tombstones } = randomObservations(rng, 1 + Math.floor(rng() * 80));
    const a = evaluatePreferenceLoop(observations, tombstones);
    const b = foldVariant(observations, tombstones);
    check("control fidelity", sameReport(a, b), `trial ${trial}`);
  }
  console.log("control fidelity: 400 randomized cases bitwise-equal to production evaluatePreferenceLoop");
}

/* ============================================================
 * S2-J-1: collapse the two tombstones.has(obs.id) calls per iteration into
 * one local boolean. Divergence surface: the tombstones parameter is a
 * public ReadonlySet extension point; call counts are observable through
 * an instrumented set (same class as S1-F-2). Values are equivalent
 * (fuzz), the win is bounded by one Set.has per observation.
 * ============================================================ */
{
  class CountingSet extends Set<string> { hasCalls = 0; override has(v: string): boolean { this.hasCalls += 1; return super.has(v); } }
  const rng = mulberry32(0x527211);
  const { observations, tombstones } = randomObservations(rng, 500);
  const counting = new CountingSet(tombstones);
  evaluatePreferenceLoop(observations, counting);
  const currentCalls = counting.hasCalls;
  const counting2 = new CountingSet(tombstones);
  foldVariant(observations, counting2, { dedupeHas: true });
  const dedupedCalls = counting2.hasCalls;
  console.log(`S2-J-1 observable surface: tombstones.has calls at N=500 current=${currentCalls} deduped=${dedupedCalls} (public ReadonlySet extension point)`);
  check("S2-J-1 call-count divergence demonstrated", currentCalls === 1000 && dedupedCalls === 500, `${currentCalls}/${dedupedCalls}`);
  for (let trial = 0; trial < 300; trial += 1) {
    const c = randomObservations(rng, 1 + Math.floor(rng() * 60));
    check("S2-J-1 value equivalence", sameReport(evaluatePreferenceLoop(c.observations, c.tombstones), foldVariant(c.observations, c.tombstones, { dedupeHas: true })), `trial ${trial}`);
  }
  const big = randomObservations(mulberry32(0x527212), 6000);
  const cur = bench(() => foldVariant(big.observations, big.tombstones), 60);
  const ded = bench(() => foldVariant(big.observations, big.tombstones, { dedupeHas: true }), 60);
  const hasCost = bench(() => big.tombstones.has("obs-3000"), 500000);
  console.log(`S2-J-1 bench N=6000: current-shape=${cur.toFixed(3)}ms deduped=${ded.toFixed(3)}ms delta=${((cur - ded) * 1e3).toFixed(1)}us; one Set.has=${(hasCost * 1e6).toFixed(1)}ns -> upper bound N*has=${(6000 * hasCost * 1e3).toFixed(1)}us (no production caller; test/metric-only API)`);
}

/* ============================================================
 * S2-J-2: replace the lexicographic createdAt sort with a numeric
 * Date.parse key. COUNTEREXAMPLE: IsoTimestamp validation accepts both
 * "Z" and "+00:00" suffixes (and 1-9 fraction digits), so distinct strings
 * can share one epoch ms. The lexicographic comparator orders them; the
 * numeric key ties them, and the stable sort then preserves input order
 * -> different fold order -> observably different metrics.
 * ============================================================ */
{
  const s1 = parseIsoTimestamp("2026-01-01T00:00:00+00:00");
  const s2 = parseIsoTimestamp("2026-01-01T00:00:00Z");
  const s3 = parseIsoTimestamp("2026-01-02T00:00:00Z");
  check("S2-J-2 premise: equal epoch, distinct strings", Date.parse(s1) === Date.parse(s2) && s1 < s2);
  const mk = (id: string, createdAt: string, value: EffVal): PreferenceObservation => ({
    id, scope: "user", scopeKey: "default", key: "style", value,
    evidenceEpisodeId: "ep_x" as EpisodeId, weight: 1,
    createdAt: createdAt as PreferenceObservation["createdAt"], explicit: true, recurrenceCount: 1
  });
  const input = [mk("o-b", s2, "B"), mk("o-a", s1, "A"), mk("o-c", s3, "A")];
  const current = evaluatePreferenceLoop(input, new Set());
  const variant = foldVariant(input, new Set(), { numericSortKey: true });
  console.log(`S2-J-2 counterexample: current fit=${current.fit} corrections=${current.correctionCost} reversals=${current.reversalEvents} | numeric-key fit=${variant.fit} corrections=${variant.correctionCost} reversals=${variant.reversalEvents}`);
  check("S2-J-2 divergence demonstrated (candidate is NOT behavior-preserving)", !sameReport(current, variant));
  // Sanity: with all-distinct epochs the two sorts agree.
  const rng = mulberry32(0x527213);
  for (let trial = 0; trial < 300; trial += 1) {
    const c = randomObservations(rng, 1 + Math.floor(rng() * 60));
    check("S2-J-2 sanity: distinct-epoch corpus agrees", sameReport(evaluatePreferenceLoop(c.observations, c.tombstones), foldVariant(c.observations, c.tombstones, { numericSortKey: true })), `trial ${trial}`);
  }
  const big = randomObservations(mulberry32(0x527214), 6000);
  const str = bench(() => foldVariant(big.observations, big.tombstones), 60);
  const num = bench(() => foldVariant(big.observations, big.tombstones, { numericSortKey: true }), 60);
  console.log(`S2-J-2 bench N=6000: string-sort fold=${str.toFixed(3)}ms numeric-key fold=${num.toFixed(3)}ms (illegal win bounded at ${((str - num) * 1e3).toFixed(1)}us)`);
}

/* ============================================================
 * S2-J-3: cluster role-cast re-runs input.body.trim() per target and
 * allocates targets.slice(1). Equivalence is trivial (trim is pure);
 * anchor the per-send cost at the P=16 ceiling (defaultRunLimits.maxTasks).
 * ============================================================ */
{
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const host = createClusterHost({ registry, maxTasks: 16, generateId: (() => { let n = 0; return () => `id${(n += 1)}`; })(), onSpawn: () => undefined });
  host.register("agent-sender" as AgentInstanceId, "planner", createTaskId(() => "t-sender"));
  for (let i = 0; i < 15; i += 1) {
    host.register(`agent-w${i}` as AgentInstanceId, "tester", createTaskId(() => `t-w${i}`));
  }
  const body = `  ${"please verify the acceptance criteria and report evidence refs ".repeat(4)}  `;
  const sendCost = bench(() => { host.send({ from: "agent-sender" as AgentInstanceId, body, addressRole: "tester" }); }, 2000);
  const trimCost = bench(() => { body.trim(); }, 500000);
  const sliceCost = bench(() => { [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].slice(1); }, 500000);
  console.log(`S2-J-3 anchor P=15 targets: whole role-cast send=${(sendCost * 1e3).toFixed(1)}us; one trim(${body.length} chars)=${(trimCost * 1e6).toFixed(0)}ns -> hoist saves ${(15 * trimCost * 1e6).toFixed(0)}ns/send; slice(1)=${(sliceCost * 1e6).toFixed(0)}ns`);
}

/* ============================================================
 * S2-J-4: buildProjectContextIndex commandSourceKey re-finds package.json
 * in snapshot.manifests once per command (O(C*M)). Hoisting is same-valued
 * (the find does not depend on the command); verify and anchor at C=8, M=12.
 * ============================================================ */
{
  const NOW = parseIsoTimestamp("2026-08-24T05:00:00.000Z");
  const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
  const manifests = Array.from({ length: 12 }, (_, i) => ({ path: i === 10 ? "/repo/package.json" : `/repo/pkg${i}/manifest.yaml` }));
  const commands = Array.from({ length: 8 }, (_, i) => ({ name: `cmd${i}`, command: `run cmd${i}` }));
  const snapshot: ProjectSnapshot = {
    id: createProjectId(UUID), rootPath: "/repo", discoveredAt: NOW,
    instructionFiles: Array.from({ length: 6 }, (_, i) => ({ path: `/repo/dir${i}/AGENTS.md` })),
    manifests, commands,
    facts: Array.from({ length: 20 }, (_, i) => ({ key: i % 2 ? `architecture.a${i}` : `risk.r${i}`, value: `v${i}`, confidence: "HIGH" as const }))
  };
  const findPkg = () => manifests.find((file) => {
    const normalized = file.path.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized === "package.json" || normalized.endsWith("/package.json");
  });
  const hoisted = findPkg();
  for (const command of commands) {
    check("S2-J-4 same-valued per command", findPkg() === hoisted, command.name);
  }
  const whole = bench(() => buildProjectContextIndex(snapshot), 2000);
  const findCost = bench(() => { findPkg(); }, 200000);
  console.log(`S2-J-4 anchor C=8 M=12: whole buildProjectContextIndex=${(whole * 1e3).toFixed(1)}us; one package.json find=${(findCost * 1e6).toFixed(0)}ns -> hoist saves ${(7 * findCost * 1e6).toFixed(0)}ns/build (one-shot per run)`);

  /* ============================================================
   * S2-J-5: compileContextPacket's selectCodeMap defensively copies
   * entries+omissions that are only read. Anchor the copy cost at a
   * realistic code map and the whole compile cost around it.
   * ============================================================ */
  const entries = Array.from({ length: 60 }, (_, i) => ({ path: `src/mod${i % 7}/file${i}.ts`, symbol: `sym${i}`, kind: "function" as const, public: i % 3 === 0, calls: [`callee${i % 5}`] }));
  const omissions = Array.from({ length: 20 }, (_, i) => ({ path: `src/omit${i}.ts`, symbol: `o${i}`, reason: "token-budget" as const, rank: 2 }));
  const index = { ...buildProjectContextIndex(snapshot), codeMap: { schemaVersion: 1 as const, tokenBudget: 2000, estimatedTokens: 900, entries, omissions } };
  const contract: RequirementContract = {
    schemaVersion: 1, objective: "demo objective", deliverables: [], constraints: [{ id: "c1", description: "keep the API stable" }] as never, nonGoals: [],
    acceptanceCriteria: [], assumptions: [], questions: [], authority: [], sourceRefs: []
  };
  const compile = bench(() => compileContextPacket({ taskId: createTaskId(UUID), contract, index, tokenBudget: 2000, selectorVersion: 1 }), 3000);
  const copyCost = bench(() => { void [...entries]; void [...omissions]; }, 200000);
  console.log(`S2-J-5 anchor E=60/O=20: whole compileContextPacket=${(compile * 1e3).toFixed(1)}us; selectCodeMap copies=${(copyCost * 1e6).toFixed(0)}ns/compile (read-only use, elision same-valued)`);
}

/* ============================================================
 * S2-J-6: applyObservation counts prior same-subject observations via
 * filter().length (allocates the matching array). A fused counting loop is
 * same-valued; both stay O(N) and the same insert path then runs
 * rebuildViews (O(N)) and saveToDisk (full JSON serialize + write).
 * ============================================================ */
{
  const rng = mulberry32(0x527215);
  const { observations } = randomObservations(rng, 5000);
  const probe = observations[4999]!;
  const sameSubject = (a: PreferenceObservation, b: PreferenceObservation): boolean =>
    a.scope === b.scope && a.scopeKey === b.scopeKey && a.key === b.key;
  const viaFilter = () => observations.filter((o) => sameSubject(o, probe) && o.explicit === probe.explicit).length;
  const viaCount = () => { let n = 0; for (const o of observations) if (sameSubject(o, probe) && o.explicit === probe.explicit) n += 1; return n; };
  for (let trial = 0; trial < 500; trial += 1) {
    const p = observations[Math.floor(rng() * observations.length)]!;
    const f = observations.filter((o) => sameSubject(o, p) && o.explicit === p.explicit).length;
    let c = 0; for (const o of observations) if (sameSubject(o, p) && o.explicit === p.explicit) c += 1;
    check("S2-J-6 equivalence", f === c, `trial ${trial}`);
  }
  const f = bench(() => { viaFilter(); }, 2000);
  const c = bench(() => { viaCount(); }, 2000);
  const serialize = bench(() => { JSON.stringify({ observations, tombstones: [] }); }, 100);
  console.log(`S2-J-6 bench N=5000: filter=${(f * 1e3).toFixed(1)}us count=${(c * 1e3).toFixed(1)}us delta=${((f - c) * 1e3).toFixed(1)}us/insert; same-path saveToDisk JSON.stringify=${(serialize * 1e3).toFixed(0)}us (+ sync disk write) dominates`);
}

/* ============================================================
 * S2-J-7: cascadeFeedbackTombstones maps all records (allocating the
 * updated array) before discovering nothing matched. A probe-first early
 * exit is same-valued (no write happens either way when nothing matches);
 * anchor both shapes at N=2000 records.
 * ============================================================ */
{
  interface Rec { id: string; episodeId: string; body?: string | undefined; kind: string; score: number; }
  const rng = mulberry32(0x527216);
  const records: Rec[] = Array.from({ length: 2000 }, (_, i) => ({ id: `fb-${i}`, episodeId: `ep-${i % 40}`, kind: "user", score: 1, ...(rng() < 0.8 ? { body: `body text ${i}` } : {}) }));
  const currentShape = (episodeId: string): { cascaded: string[]; updated: Rec[] | undefined } => {
    const cascaded: string[] = [];
    const updated = records.map((record) => {
      if (record.episodeId !== episodeId) return record;
      cascaded.push(record.id);
      return record.body === undefined ? record : { ...record, body: undefined };
    });
    if (cascaded.length === 0) return { cascaded: [], updated: undefined };
    return { cascaded, updated };
  };
  const probeShape = (episodeId: string): { cascaded: string[]; updated: Rec[] | undefined } => {
    if (!records.some((record) => record.episodeId === episodeId)) return { cascaded: [], updated: undefined };
    return currentShape(episodeId);
  };
  for (const ep of ["ep-7", "ep-does-not-exist"]) {
    const a = currentShape(ep);
    const b = probeShape(ep);
    check("S2-J-7 equivalence", JSON.stringify(a) === JSON.stringify(b), ep);
  }
  // Interleave-warm both shapes before timing so JIT state is symmetric.
  bench(() => { currentShape("ep-7"); probeShape("ep-7"); currentShape("ep-none"); probeShape("ep-none"); }, 2000);
  const missCur = bench(() => { currentShape("ep-none"); }, 20000);
  const missPro = bench(() => { probeShape("ep-none"); }, 20000);
  const hitCur = bench(() => { currentShape("ep-7"); }, 20000);
  const hitPro = bench(() => { probeShape("ep-7"); }, 20000);
  console.log(`S2-J-7 bench N=2000: no-match current=${(missCur * 1e3).toFixed(1)}us probe-first=${(missPro * 1e3).toFixed(1)}us (saves ${((missCur - missPro) * 1e3).toFixed(1)}us); match current=${(hitCur * 1e3).toFixed(1)}us probe-first=${(hitPro * 1e3).toFixed(1)}us (extra pass costs ${((hitPro - hitCur) * 1e3).toFixed(1)}us); deletion cascade then rewrites the whole log to disk`);
}

/* ============================================================
 * S2-J-8: decideClosure hoists episode.evidenceRefs into a Set
 * (O(A*(E+R)) -> O(A*E + R)). Membership semantics for strings are equal
 * (includes uses ===, Set uses SameValueZero; identical on strings).
 * Fuzz + anchor at the realistic single-episode scale.
 * ============================================================ */
{
  const rng = mulberry32(0x527217);
  const mkEpisode = (a: number, e: number, r: number): ProjectEpisode => {
    const acceptance = Array.from({ length: a }, (_, i) => ({ id: `ac-${i}`, description: `criterion ${i}` }));
    const evidenceRefs = Array.from({ length: r }, (_, i) => `evd-${i}`);
    const acceptanceEvidence = Array.from({ length: e }, (_, i) => ({
      criterionId: `ac-${Math.floor(rng() * a)}`,
      evidenceId: rng() < 0.7 ? `evd-${Math.floor(rng() * Math.max(1, r))}` : `evd-missing-${i}`,
      result: (rng() < 0.7 ? "PASSED" : "FAILED") as "PASSED" | "FAILED"
    }));
    return {
      id: "ep_1" as EpisodeId, projectId: createProjectId(() => "01234567-89ab-cdef-0123-456789abcdef"),
      objective: "demo", contractVersion: 1, runIds: [] as RunId[], startedAt: parseIsoTimestamp("2026-08-24T05:00:00.000Z"),
      status: "OPEN", acceptance, evidenceRefs, acceptanceEvidence
    } as unknown as ProjectEpisode;
  };
  const variant = (episode: ProjectEpisode): string[] => {
    const acceptanceEvidence = (episode as ProjectEpisode & { acceptanceEvidence?: readonly { criterionId: string; evidenceId: string; result: string }[] }).acceptanceEvidence;
    const refs = new Set(episode.evidenceRefs as readonly string[]);
    return episode.acceptance
      .filter((criterion) => {
        const structuredMatch = acceptanceEvidence?.some((ev) => ev.criterionId === criterion.id && ev.result === "PASSED" && refs.has(ev.evidenceId));
        const legacyMatch = episode.evidenceRefs.some((ref) => String(ref) === `evd_${criterion.id}`);
        return structuredMatch !== true && !legacyMatch;
      })
      .map((criterion) => criterion.id);
  };
  for (let trial = 0; trial < 800; trial += 1) {
    const episode = mkEpisode(1 + Math.floor(rng() * 8), Math.floor(rng() * 10), Math.floor(rng() * 8));
    const cur = decideClosure(episode, []);
    const varMissing = variant(episode);
    const curMissing = cur.canClose ? [] : (cur.reason === "acceptance-incomplete" ? cur.requiredEvidence : []);
    check("S2-J-8 equivalence", JSON.stringify(curMissing) === JSON.stringify(varMissing), `trial ${trial}`);
  }
  const episode = mkEpisode(6, 6, 6);
  const cost = bench(() => { decideClosure(episode, []); }, 20000);
  console.log(`S2-J-8 anchor A=6 E=6 R=6: whole decideClosure=${(cost * 1e6).toFixed(0)}ns per close decision (one-shot)`);
}

/* ============================================================
 * S2-J-9: appendFeedback re-sorts the store's 4 fixed forbidden
 * substrings on every append. Anchor the sort cost against the disk
 * append it precedes.
 * ============================================================ */
{
  const needles = ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"];
  const sortCost = bench(() => {
    [...needles].filter((n) => n.length > 0).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  }, 200000);
  const dir = mkdtempSync(join(tmpdir(), "r2j-"));
  const file = join(dir, "records.jsonl");
  writeFileSync(file, "");
  const appendCost = bench(() => { appendFileSync(file, `{"id":"x","episodeId":"e","kind":"user","score":1}\n`); }, 500);
  console.log(`S2-J-9 anchor: needles copy+filter+sort=${(sortCost * 1e6).toFixed(0)}ns/append vs disk append=${(appendCost * 1e3).toFixed(1)}us/append (I/O dominates ~${Math.round(appendCost / sortCost)}x)`);

  /* ============================================================
   * S2-J-10: readFeedback awaits records.jsonl then tombstones.json
   * sequentially; Promise.all overlap is bounded by one small-file read,
   * and under a double fault (both files corrupt) the surfaced error
   * becomes settlement-order dependent instead of deterministic.
   * ============================================================ */
  const recPath = join(dir, "records2.jsonl");
  const tombPath = join(dir, "tombstones.json");
  writeFileSync(recPath, Array.from({ length: 50 }, (_, i) => `{"id":"fb-${i}","episodeId":"e","kind":"user","score":1}`).join("\n"));
  writeFileSync(tombPath, JSON.stringify(["fb-1", "fb-2"]));
  const readOne = bench(() => { readFileSync(recPath, "utf8"); }, 2000);
  const t0 = performance.now();
  for (let i = 0; i < 200; i += 1) { await readFile(recPath, "utf8"); await readFile(tombPath, "utf8"); }
  const seq = (performance.now() - t0) / 200;
  const t1 = performance.now();
  for (let i = 0; i < 200; i += 1) { await Promise.all([readFile(recPath, "utf8"), readFile(tombPath, "utf8")]); }
  const par = (performance.now() - t1) / 200;
  console.log(`S2-J-10 anchor: sequential 2-file read=${(seq * 1e3).toFixed(1)}us parallel=${(par * 1e3).toFixed(1)}us overlap win=${((seq - par) * 1e3).toFixed(1)}us/read; sync single read=${(readOne * 1e3).toFixed(1)}us (double-fault error identity becomes racy under Promise.all)`);

  /* ============================================================
   * S2-J-11: waitForClarification reads the whole event log twice
   * (before settleBoundEpisode and after it appends). Anchor one
   * readAll-equivalent parse of the realistic ~7-event log.
   * ============================================================ */
  const evPath = join(dir, "events.jsonl");
  writeFileSync(evPath, Array.from({ length: 7 }, (_, i) => JSON.stringify({ id: `evt-${i}`, schemaVersion: 1, type: "RUN_CREATED", payload: { i } })).join("\n"));
  const readAllCost = bench(() => {
    const raw = readFileSync(evPath, "utf8");
    for (const line of raw.split("\n")) { if (line !== "") JSON.parse(line); }
  }, 5000);
  console.log(`S2-J-11 anchor: one 7-event readAll(parse incl.)=${(readAllCost * 1e3).toFixed(1)}us -> in-memory mirror saves <=2 reads on a one-shot waiting path (disk source-of-truth + truncated-tail recovery contract = S1-G-1 domain)`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=NO
BRANCH=cursor/r2-j-persist-slice-a4e3

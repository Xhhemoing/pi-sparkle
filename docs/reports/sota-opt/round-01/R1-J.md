MODEL_SLUG=claude-fable-5-thinking-xhigh

# R1-J：`cluster` / `privacy` / `preferences` / `episode` / `persist` / `track` / `context` / `feedback` 优化报告

日期：2026-08-24
基线：`cursor/sota-persistent-opt-83a1` @ `7acb666`
本轮分支：`cursor/r1j-data-plane-opt-d508`
分区：Round 1 / R1-J（见 [PLAN.md](./PLAN.md)）

**结论：找到更优解。** 本轮在偏好面（M4-T4 preference-loop 度量）落地一项逐位
保行为的复杂度优化：`evaluatePreferenceLoop`（`src/preferences/loop-eval.ts`）
从「每处理一条观察就对全部存活观察做 3 次全量分组重算 + 1 次锚定扫描 +
墓碑 findIndex」（Θ(N·L)，L 为存活历史长度）改为「每主体增量折叠 + O(1)
墓碑撤销」（排序主导的 Θ(N log N)）。N=6000 的确定性夹具上实测中位耗时
10618.3 ms → 3.8 ms（≈2770×），参考实现每次求值 92,590,419 次元素访问被
消除；2468 项逐位一致性检查全绿。

数据面（删除/脱敏/状态布局、mailbox、episode 闭合、jsonl 锁语义）**零改动**：
`src/privacy/`、`src/persist/`、`src/cluster/`、`src/episode/`、`src/feedback/`、
`src/context/`、`src/track/` 本轮一行未改。唯一改动文件为
`src/preferences/loop-eval.ts`（模块私有实现，公开签名与导出不变）+ 新增仿真
脚本 `scripts/r1j-equivalence-sim.ts`。

本报告不声称任何 Outcome-supported 改进；Checkpoint F-PROD 仍开放（ADR-005）。
排除表（X0-1 … X4-9）全部维持有效，本轮未触碰任何被排除项；规格强制双路
（Beta LCB vs 正态 LCB；offline-logit vs 概率可加）不在本区且未触碰。

---

## 1. 扫描过的候选列表

8 个模块 29 个文件全部实际通读（约 3600 行），逐一裁决：

| # | 位置 | 发现 | 处置 |
| --- | --- | --- | --- |
| S1 | `preferences/loop-eval.ts` `evaluatePreferenceLoop` | 每条观察调 3 次 `effectiveBySubject(live)`（每次全量分组 O(L) + 对**每个**主体折叠 O(L)，含瞬时 Map/数组分配）+ `subjectIsExplicitAnchored` O(L) 扫描 + 墓碑路径 `live.findIndex` O(L)：合计 Θ(N·L)，且历史长度 N 随观察积累无上界 | **采纳**（J 组，赢家 J1） |
| S2 | `preferences/store.ts` `rebuildViews` | 每次插入/删除全量重建所有 view（O(N)）；增量化会改变未受影响 view 的 `lastUpdated`（每次全量重建给所有 pair 刷新 `nowIso()`，`getView`/`buildView` 可观察）——**行为不保** | 否决（新增 S1-J-1） |
| S3 | `preferences/store.ts` `applyObservation` | recurrence 计数 `observations.filter(...)` 每次插入 O(N)；增量计数器需与 `loadFromDisk`/`deleteObservation`/`clearPreferences`/`resetPreferenceStore` 四条变异路径同步（X1-1 型陈旧状态风险），且同一插入路径上 `rebuildViews` 与 `saveToDisk`（全量 JSON 序列化）本就各 O(N)，收益封顶常数级 | 否决（新增 S1-J-2） |
| S4 | `preferences/precedence.ts` | `SCOPE_PRECEDENCE.find` 上界 5；`selectHighestPriority` 单遍 reduce | 无更优（X1-4 同理），不动 |
| S5 | `preferences/export.ts` / `materialize.ts` / `service.ts` | 单遍 filter/map、薄封装，无重复扫描结构 | 无更优，不动 |
| S6 | `episode/manager.ts` `reduceEpisodeEvents` | 每个 `RUN_ATTACHED` 做 `runIds.includes`（O(R)）+ 全数组拷贝（O(R)）→ O(R²)；R 为单 episode 的 run 数（multi-run attach，个位数量级），且 episode 闭合属数据面强调区 | 否决（新增 S1-J-3） |
| S7 | `episode/closure.ts` `decideClosure` | acceptance × evidenceRefs 嵌套（O(A×(E+R))）；A/E/R 单 episode 个位~十位数，每次 close 决策一次性调用 | 无更优，不动 |
| S8 | `episode/events.ts` / `replay.ts` / `store.ts` | 类型声明、单遍解析、标准 promise 追加队列 | 无更优，不动 |
| S9 | `cluster/host.ts` `send`（役播） | `[...directory.values()].filter(...)` O(P)；P ≤ maxTasks（`defaultRunLimits`，小常数）；role→agent 目录索引是需与 `register` 同步的第二结构，收益噪声级；mailbox 为数据面 | 否决（新增 S1-J-4） |
| S10 | `cluster/mailbox.ts` / `spawn.ts` | 数据面（role 队列 claim 语义）；`claimRole` 循环内 `byRole.get(role) ?? []` 重取——语义等价合并是噪声级且触碰数据面 | 不动 |
| S11 | `privacy/deletion.ts` `cascadeFeedbackTombstones` | 全量读→map→全量重写是墓碑级联的契约本身（数据面）；`[...tombstones].sort()` O(T log T) 为确定性输出所需 | 不动 |
| S12 | `privacy/record-classes.ts` / `state-layout.ts` | 字典常量 + `find` 上界 16（`durableRecordClassById` 无生产调用方）；state-layout 为纯路径拼接 | 无更优，不动 |
| S13 | `persist/jsonl.ts` / `file-lock.ts` | jsonl 读为必要单遍 split+parse、截尾恢复契约；锁的 wx/ownerToken/重试语义为数据面 | 不动 |
| S14 | `track/loop.ts` | `planned.map` 内 `assignments.find` O(C²)，C ≤ ~6（planner/scout/impl/review/test）；`catalogIds.includes` M ≤ 10（live 面，X3-1 同理） | 否决（新增 S1-J-5） |
| S15 | `track/plan.ts` / `clarify.ts` / `primary-split.ts` | 常数规模决策 + 单遍 filter；`acceptanceForRole` 每 role 一次性 O(criteria) | 无更优，不动 |
| S16 | `context/index.ts` `buildProjectContextIndex` | `dirtyPaths.filter(... generatedPaths.some(isUnderGenerated) ...)` O(D×G×len)：一次性索引构建、D/G 典型十位数量级；前缀 trie/排序索引不改行为但收益噪声级 | 否决（新增 S1-J-6） |
| S17 | `context/packet.ts` `compileContextPacket` | 第 122 行 `omissions.sort(compareOmissions)` 后仅有追加、第 167 行再次全量排序——首个 sort 冗余（比较器覆盖 OmissionRecord 全部字段，比较相等 ⇒ 结构相同，双排 = 单排的结构等价输出）；k（遗漏数）小，移除属常数噪声（X3-2 同理） | 否决（新增 S1-J-7） |
| S18 | `context/packet.ts` `collapseFacts`/`pickCanonical`/`collectCandidates` | 分组 + 排序为确定性规范化契约；`pickCanonical` 对组内排序可换单遍 min 扫描但组大小为同 key 事实数（个位）| 无更优，不动 |
| S19 | `context/packet.ts` `queryPacketGrounding` | O(lines×tokens×len) 子串匹配；lines 受 tokenBudget 约束（数百）、tokens 为问题词数（个位），M3-T5 一次性查询 | 无更优，不动 |
| S20 | `feedback/redaction.ts` | needles 上界 4（store 端固定表），`stripForbidden` 逐 needle split/join 的顺序（长优先）是行为 | 无更优，不动 |
| S21 | `feedback/store.ts` `readFeedback` | `filter(isFeedbackRecord).filter(!tombstones.has)` 两遍 O(N) 合一遍是常数噪声；墓碑双层过滤是隐私契约 | 无更优，不动 |

## 2. 相似方案组：理论对比 + 仿真裁决

唯一采纳组存在 2+ 可行做法，按规范做理论 + 仿真。仿真载体：
`scripts/r1j-equivalence-sim.ts`（独立脚本；内嵌基线 `7acb666` 的
`evaluatePreferenceLoop` 及其全部私有助手**原文**作为冻结对照组，仅加访问计数
插桩；`MIN_INFERRED_RECURRENCE_DEFAULT`、`createSeededRng` 本轮未变，从生产
导入，使被测差异恰好等于 J1）。

### 2.1 J 组：evaluatePreferenceLoop 的 effective 值维护

| 方案 | 理论检测 | 裁决 |
| --- | --- | --- |
| J0 现状 | 每步 3×`effectiveBySubject(live)`（before/mid/after，各自全量分组并折叠所有主体）+ 锚定 O(L) 扫描 + 墓碑 `findIndex` O(L) ⇒ Θ(N·L) 元素访问，另有每步 O(S) 张瞬时 Map/列表分配 | 被更优解取代 |
| J1 每主体增量折叠 + O(1) 墓碑撤销 | **保行为论证**：(i) `effectiveBySubject(live).get(id)` 只依赖 live 中 subjectId=id 的子序列（分组保相对序），且等于对该子序列跑 `effectiveForSubject`；(ii) 新的折叠步骤逐字对应 `effectiveForSubject` 循环体，查询式 `lastExplicit ?? lastDurableInferred` 逐字对应其返回式；(iii) 锚定判定 `lastExplicit !== undefined` ⇔ 子序列含 explicit（值域 string\|number\|boolean 不含 undefined）；(iv) **关键引理**：循环不变量「每轮开始时无存活条目的记录 id ∈ tombstones」归纳成立——id 在墓碑集的观察在自己那轮被 push 后，由不变量它是该 id 的唯一存活条目，`findIndex` 必命中它本身并被 splice ⇒ 删除永远等价于「撤销刚发生的 push」，撤销只需恢复两个标量快照 + 回退单个计数（`tombstones.has` 每轮两次的调用模式保持原样）；(v) 排序比较器、四个计数器的记账逻辑、返回式逐字保留；除 fit 对相同整数做同一除法外无浮点参与 ⇒ 逐位平凡一致。折叠状态与函数调用同生命周期，无跨调用缓存 | **赢家** |
| J2 保留 live 数组，查询时只对当前主体的子列表重折叠 | 忠实性平凡（直接调原 `effectiveForSubject`）但每步 O(s)，单主体退化 Θ(N²)；被 J1 完全支配 | 被 J1 取代（非排除） |
| J3 在 before/mid 间记忆化整张 `effectiveBySubject` | 仍 Θ(N·L)（push/splice 使缓存每步失效），瞬时分配未减 | 被 J1 取代 |
| J4 模块级按 `observations` 引用做跨调用记忆化 | X1-1 同理：隐藏全局状态、入参数组可变异 ⇒ 陈旧结果 | 淘汰（X1-1 覆盖，不另立 ID） |

### 2.2 仿真结果

```text
scenario 1 (deterministic edge cases):
  64 checks over 16 cases
  — 空输入 / 单测镜像（agree、反转）/ 复现阈值边界（1 条 vs 2 条 inferred）/
    墓碑遗忘 / false 值 effective（?? 不穿透）/ NaN 值（=== 恒假的翻转记账）/
    跨主体重复墓碑 id / 同主体重复墓碑 id / 非墓碑重复 id / 同一对象引用
    重复（含墓碑）/ 墓碑观察不留翻转痕迹 / Object.freeze 冻结输入（双方
    均不得变异调用方数据）
scenario 2 (randomized): 2400 checks over 600 cases
  — 种子化 RNG；N 1–120，5 scope × 2 scopeKey × 3 key 随机主体，值池含
    -0/NaN/true/false/"0"，~30% explicit，~25% 墓碑率 + 必含不存在 id，
    ~12% 重复记录 id、~8% 重复对象引用，时间戳池含重复项（排序平局），
    recurrenceCount 随机填充（证明度量与该字段无关）
perf fixture (N=6000, multi-subject, ~25% tombstoned):
  reference 10618.3 ms -> current 3.8 ms (2769.9x)
  reference element visits per evaluation: 92,590,419
  (current: O(1) map operations per observation after the O(N log N) sort)

ALL EQUIVALENCE CHECKS PASSED (2468 bitwise checks)
```

全部检查为 `Object.is` 逐位比较（fit 浮点与三个整数计数器全字段）。

## 3. 测试与门禁

- `pnpm gate`（typecheck + lint + test + build）在 Node v22.22.2 下**全绿**：
  1168 pass / 0 fail / 1 skipped。
- 环境注记：本 VM 系统 Node 为 22.14.0，低于 `engines >=22.19.0`，导致
  `test/unit/cli/doctor.test.ts` 的 node 版本检查在**未改动的基线 `7acb666`
  上同样失败**（已用独立 worktree 复核）；与本轮改动无关，换用 nvm 安装的
  Node 22.22.2 后消失。
- 目标分区相关单测（preferences×4、episode×3、cluster×2、context×2、
  privacy×3、persist×1、track×2、feedback×1）全部通过。

## 4. 排除表新增（S1-J-*）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-J-1 | preferences `rebuildViews` 增量化（按 pair 局部更新） | 未受影响 view 的 `lastUpdated` 可见时间戳改变，行为不保 |
| S1-J-2 | preferences `applyObservation` recurrence 计数器化 | 同路径 `saveToDisk`/`rebuildViews` 本就 O(N)，收益常数级；派生索引须与 4 条变异路径同步（X1-1 型风险） |
| S1-J-3 | episode `reduceEpisodeEvents` runIds Set 化/共享可变数组 | 单 episode run 数个位级；episode 闭合为数据面强调区 |
| S1-J-4 | cluster 役播 role→agent 目录索引 | P ≤ maxTasks 小常数；mailbox 数据面；第二同步结构无收益 |
| S1-J-5 | track/loop `assignments.find` 换 Map | C ≤ ~6，live 面，X3-1 同理 |
| S1-J-6 | context/index dirty×generated 前缀匹配索引化 | 一次性构建、D/G 小，噪声级 |
| S1-J-7 | context/packet 首个 `omissions.sort` 冗余移除 | 结构等价但 k 小、常数噪声（X3-2 同理） |

## 5. 交付物

- 改动：`src/preferences/loop-eval.ts`（J1）
- 新增：`scripts/r1j-equivalence-sim.ts`（冻结对照 + 2468 项逐位检查 + 性能夹具）
- 本报告 + `EXCLUSIONS.md` 追加 S1-J-1 … S1-J-7

MORE_OPTIMA=NO
BRANCH=cursor/r1j-data-plane-opt-d508

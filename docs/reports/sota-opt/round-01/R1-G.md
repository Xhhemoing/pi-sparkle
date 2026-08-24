MODEL_SLUG=claude-fable-5-thinking-xhigh

# R1-G：运行时 / 监督 / 图 / 领域模型切片 SOTA 打磨报告

**战役:** 全库持久 SOTA 优化 Round 1 / R1-G（10 区并行之一）
**基线:** `cursor/sota-persistent-opt-83a1` @ `4efee23`
**分支:** `cursor/r1-g-runtime-graph-domain-f48c`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的更优解，切片零代码改动。** 对切片全部 45 个文件（约 8,960 行：
`src/run/` 19 文件、`src/supervisor/` 4 文件、`src/graph/` 4 文件、
`src/domain/` 18 文件）逐一通读并以新视角枚举，得到 9 个此前排除表未点名的
候选（S1-G-1 … S1-G-9），全部经理论 + 确定性仿真（seeded mulberry32，等价
fuzz + 真实规模基准，两次独立运行结论一致）裁决后淘汰：1 个违反跨进程磁盘
事实源与 fail-closed 读校验契约（S1-G-1），1 个实测负优化（S1-G-5），其余
7 个在真实规模是噪声级（其中 1 个还需扩公开接口）。该切片是**每轮驱动秒级
子代理执行与 fsync 落盘的 live 控制面**：全部结构维度（节点、任务、轮次、
每轮事实）为几十级且热点结构已全面 Map 化，唯一真正增长的维度（事件数 E）
只被线性触碰。已有的 X4-6/X4-7/X4-8/X4-9 四条排除正是对该面规模的正确刻画，
本轮全部复核维持。本切片现状即为其持久化与调度契约下的 SOTA。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 R1-A）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 R1-B）、`src/graph/`、
  `src/domain/`，共 45 文件全量读码。
- **X0-2 遵守**：`planTaskTopology`（定义于 `src/run/supervisor.ts:64`，无生产
  调用方）保持未接线，本轮未触碰。
- **X0-4 遵守**：`applyTrackingGate`/`nextTrackingSeq` 在 R1-A 文件内，未触碰。
- **X4-6/X4-7/X4-8/X4-9 全部维持**：Kahn `queue.shift`（`graph/validate.ts`）、
  ledger `isDuplicateFact`（每轮新事实个位数、X4-7 复核确认 `classifyRoundProgress`
  与 `advanceLedgerRound` 的每轮 O(F) 扫描同理）、flowchart-supervisor
  `propagate`/`computeStatus` 增量化、ownership changeSet——四条均直接跳过。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、各 payload 校验器、
  `validateEvent` 抛错消息与次序全部原样。
- 调度语义、resume、lease、flowchart join 行为不变——零 diff，天然满足。
- 仓库变更仅本报告一个文件。

## 1. 现实规模测量（门槛证据基底）

本切片与 R1-F/R1-J 的数据面本质不同：**每一轮循环都伴随子代理执行（秒级）
与 checkpoint 落盘（fsync）**，CPU 侧常数从不构成瓶颈。结构规模实测/规格：

- **flowchart 节点 N**：live 面几十级（X4-8 理由复核成立）；默认
  `maxConcurrentNodes=4`。
- **轮次 R** ≤ `maxRounds`，默认 32（`domain/limits.ts:19`）。
- **每轮新事实**：个位数（X4-7 理由复核成立）；`ledger.facts`/`progress`
  随轮次线性累积，R=32 时 progress ≤ ~百级小对象。
- **M2 任务图 T**：几十级、几十层（X4-6 理由复核成立）；`statuses`/
  `attempts`/`leases`/`byId` 已全 Map。
- **唯一增长维度是事件数 E**（数百~千级）：`readAll` 每次 O(E)（JSON.parse
  + validateEvent，实测 1000 事件 ≈ 1.35~1.68ms CPU）；运行循环每轮多次
  `readAll` 构成 O(R×E) 总量，**但这是刻意语义**——事件日志磁盘态是跨进程
  唯一事实源（CLI answer/pause 从独立进程读写），读时全量重校验（含损坏行
  号恢复 `EventLogRecovery`）是 fail-closed 恢复契约。
- **热点结构现状**：`nodesById`/`incoming`/`outgoing`/`joinPolicies`/
  `runtime`/`activeRoutes`/`userDecisions`/`facts` 全 Map；
  `finishedChildren`/`childByTaskId` Map；`inspection` 首选 byRun O(1)。
  切片余下的线性扫描全部受上述几十级维度限界。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S1-G-1 | EventStore/EpisodeStore `readAll` 增量缓存（记忆化已解析事件 + 文件偏移尾读） | 总量 O(R×E)→O(E) | —（契约违背，未实现） | 上界:1.35~1.68ms CPU/读 ×~100 读/run ≈ 135~168ms，被磁盘 I/O 与子代理秒级执行支配 | 淘汰:X1-1 隐藏缓存同类 + 跨进程磁盘事实源 + fail-closed 读校验契约 |
| S1-G-2 | `persistLedger`/`persistBlocked`/`failedReason` 以全量 `snapshot()` 读 4 个标量改轻量访问器 | 免 O(state) 深拷贝/次 | ✅（标量同值平凡） | snapshot()=168µs/次（N=24）;可避免总量 ~5.7ms/run（N=64 压力面 ~15ms） | 淘汰:需扩 `FlowchartSupervisor` 公开接口 + 噪声 |
| S1-G-3 | `validateEvent` 的 `EVENT_TYPES.includes`（33 项）及同类枚举表 Set 化 | O(33)→O(1)/查 | ✅ 33 已知 + 6 对抗未知类型逐一同判 | 省 6.1~8.7ns/查;激进上界（100 读×1000 事件）0.61~0.87ms/run，占 validateEvent 全程 1.0~1.5% | 淘汰:S1-A-8/S1-D-8 同类噪声 |
| S1-G-4 | `validateFlowchart` join `requiredNodeIds`×`edges.some` 二重扫描换预构 `from→to` 邻接 Set | O(J·R·E)→O(E+J·R) | ✅ 300 轮合法/断边 fuzz 逐对同判 | 全函数 21.3~21.7µs（N=25）/43µs（N=57）;run 级 ≤1.4ms 为收益上界 | 淘汰:live 面几十节点（X4-8 理由同类）噪声 |
| S1-G-5 | `snapshot()` 逐项 `structuredClone` 合并单次聚合 clone | 省 N+K 次序列化启动 | ✅ 聚合 clone 值与 snapshot() 输出 JSON 同值 | **实测更慢**:N=24 慢 10.2~10.4µs/次、N=64 慢 3.2~32µs/次（两轮均负） | 淘汰:负优化（S1-A-4/S1-D-2 同向反例） |
| S1-G-6 | coordinator.ts `remaining.splice(remaining.indexOf(child),1)` 与 active/stillActive 重复 filter 改 Set/索引 | O(T²)→O(T) | —（平凡） | T ≤ maxConcurrentTasks（个位~十位）;splice 保序语义须留 | 淘汰:X4-9 同类噪声 |
| S1-G-7 | flowchart-run `nodeTaskId` 定义节点线性 find 换预构 Map | O(N)→O(1)/查 | —（平凡） | 仅审批/等待持久化路径调用（每审批一次），N 几十 | 淘汰:噪声 |
| S1-G-8 | `ConcurrencyGate.waiters.shift()` / `LeaseRegistry.expired()` 的 `Array.from().filter` 指针化/融合 | O(W²)→O(W) | —（平凡） | 等待者 ≤ 排队任务数（十级）;expired() 每轮一次 | 淘汰:X4-6 同类噪声 |
| S1-G-9 | flowchart-supervisor `setRuntime` 展开拷贝改原地变异 | 免 O(字段) 拷贝/patch | —（有内部别名风险，未实现） | patch 对象十字段级、每状态迁移一次 | 淘汰:`getRuntime` 返回内部引用被 propagate/joinStatus 局部持有，copy-on-write 是别名安全边界;噪声 |

## 3. 关键裁决细节

### S1-G-1：最大数字为何仍不是赢家（契约优先于总量）

切片内唯一超线性总量是运行循环的重复 `readAll`：`persistCheckpoint`（每轮）、
`executeClusteredNode`（每子任务）、`persistWaiting`/`persistBlocked`/
`persistCompleted`/`persistFailed`/`pauseIfRequested`/`finish`（结算幂等哨卫）
各自全量重读事件日志，总量 O(R×E)，1000 事件日志下 CPU 上界 ~135-168ms/run。
但增量缓存不保行为：

1. **磁盘是跨进程唯一事实源**——`pi-sparkle pause`/`answer`/CLI 检查从独立
   进程读同一 `events.jsonl`；进程内缓存一旦与外部追加/截断分叉即读到幻影
   状态，X1-1（隐藏缓存/陈旧风险）本体。
2. **读时全量 `validateEvent` 是 fail-closed 恢复契约**——`readJsonlObjects`
   的损坏行号（`Corrupt event log line N`）与 `EventLogRecovery.incompleteLine`
   语义要求每次读都从字节重建；缓存跳过校验等于弱化损坏检测。
3. 结算哨卫（`hasEvent`/`hasOpenWaiting`/`hasUnmatchedPause`）依赖「重读后
   判重」达成幂等，是 resume 语义的一部分。

与 X3-3/X4-1（fail-closed 全量重校验保留）同判：**保留全量重读，记录排除。**

### S1-G-2：真实浪费为何不修（公开面代价 > 噪声收益）

`persistLedger` 每轮以 `supervisor.snapshot()`（深拷贝全部 nodes/decisions/
facts/ledger，实测 168µs @ N=24、436µs @ N=64）只为读出
`revision/round/consecutiveStalls/isBlocked` 四个标量；`persistBlocked`/
`failedReason` 同模式。但 `FlowchartSupervisor` 公开接口刻意只暴露
`snapshot()` 作为全量读口（`nodeState`/`nodeRuntime` 是仅有的细粒度只读口，
后者也走 `structuredClone`）——修复须给接口加 `ledger` 访问器，等于为
~5.7ms/run（32 轮上界，run 本体为秒~分钟级）扩公开 API 面。与 S1-F-6
（公开签名变更）与噪声门槛双重淘汰。`failedReason` 用 `definition.nodes` +
`nodeState` 改写虽不加 API，但依赖快照 Record 迭代序与定义序一致这一未承诺
性质，收益同级，一并淘汰。

### S1-G-5：聚合 clone 的负优化（理论被仿真推翻）

「把 snapshot() 的 N+K+3 次 `structuredClone` 合并为一次聚合 clone 省
序列化启动开销」在两个规模、两次独立运行下**全部实测更慢**（N=24:
-10.2~-10.4µs/次;N=64: -3.2~-32µs/次），且聚合方案仍需先做 Map→Record
重建（实测未计入，真实差距更大）。V8 的 structuredClone 对多次小对象与
一次大对象的成本差为负收益，复现 S1-A-4/S1-D-2「理论常数改进被真实引擎
行为推翻」的教训。等价性已证（JSON 同值）但淘汰。

### 保行为面复核（调度/resume/lease/join）

- **调度语义**：`planRound` 拓扑序 + `maxConcurrentTasks` 截断 + lease 过滤
  的三段式保持；`leaseReadyNodes` 的 READY 过滤与路由消费次序未碰。
- **resume**：checkpoint 校验含 `restoreFlowchartSupervisor` 干跑
  （fail-closed，用 `snapshotValidationRouter` 而非真 router，故干跑实例
  不可复用于真恢复——「复用干跑省一次 restore」不成立，未列候选）；
  孤儿 lease 的 TIMEOUT→BLOCKED→READY 恢复链未碰。
- **lease**：`LeaseRegistry` 已 Map；`expired()` 的拷贝-过滤是 readonly
  安全边界（X4-2 同域）。
- **flowchart join**：`joinStatus` 的 `requiredNodeIds.includes` 过滤
  （X4-8 邻域、fan 个位数）与 quorum 计数语义未碰。

### 逐文件收口（切片其余面）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `run/flowchart-run.ts` | 见 S1-G-1/2/7;每轮 `persistCheckpoint` 的 `validateCheckpoint`（含 validateFlowchart + 快照校验 + restore 干跑）为写前 fail-closed 自检，X3-3/X4-1 同域保留;`gated.events.slice(current.events.length)` O(新增) | 无候选落地 |
| `run/supervisor.ts` | `planRound`/`canProgress` 每轮 O(T·D)，T 几十（X4-6 理由域）;`planTaskTopology` 维持未接线（X0-2）;`recordStatus` 状态机逐步落事件为审计语义 | 无候选 |
| `run/events.ts` | 见 S1-G-3;各 payload 校验 O(payload) 线性;`toModelRoutedPayload` 常数投影 | 无候选（schema 未碰） |
| `run/event-store.ts` / `episode-store.ts` | 见 S1-G-1;append 队列 `enqueue` O(1) 链式;终端事件 fsync 标志为持久化契约 | 无候选 |
| `run/coordinator.ts` | 见 S1-G-6;`depFailed` 的 deps.some O(D) 个位;结算幂等哨卫依赖重读（S1-G-1 同域） | 无候选 |
| `run/child-coordinator.ts` | 见 S1-G-8;`pendingQuestionsList` find/findIndex Q 个位;模型级联 tiers ≤ 个位;`peers().filter` P 个位 | 无候选 |
| `run/replay.ts` | 单遍 O(E) 状态机，无二次扫描;`eventsLookLikeFlowchartRun` 单遍 some | 无候选 |
| `run/scheduler.ts` | 见 S1-G-8;`applyTaskOutcome` 的 TASK_OUTCOMES.includes 表长 4（S1-A-8 域）;状态机 O(1) | 无候选 |
| `run/inspection.ts` | `findChild` byRun O(1) 主路径，taskId 回退扫描仅协议缺 runId 时触发、C 几十、一次性 CLI 检查 | 记录不改 |
| `run/episode-bind.ts` | `readAll().episodes.at(-1)` 读尾快照 O(S)，S 十级、每 run 结算一次;反向文件 I/O 复杂度不值 | 记录不改 |
| `run/injection.ts` / `pause-controller.ts` | 一次性请求路径 O(payload);`writeAtomic` tmp+fsync+rename 为原子性契约 | 无候选 |
| `run/child-grounding.ts` / `child-prompt.ts` / `flowchart-executor.ts` | 每子任务一次的字符串组装，O(输入) | 无候选 |
| `supervisor/flowchart-supervisor.ts` | 见 S1-G-2/5/9;`propagate`/`computeStatus`/`joinStatus` = **X4-8 维持排除不触碰**;`assertWaiterInvariant` O(N) 每 apply 为不变量防线;`nodeRuntime`/`pendingApproval` 的 structuredClone 是 readonly 边界 | 无候选（X4-8 遵守） |
| `supervisor/flowchart-snapshot.ts` | 校验 O(state) 每 checkpoint 读/写一次，fail-closed;枚举 includes 表长 ≤7（S1-A-8 域） | 无候选 |
| `supervisor/ledger.ts` | `isDuplicateFact` = **X4-7 维持**;`advanceLedgerRound` 的 progress/facts 拷贝 O(R+F)/轮，R=32 上界百级小对象拷贝，且返回新对象是快照语义（S1-D-1 同域） | 无候选（X4-7 遵守） |
| `graph/validate.ts` | Kahn `queue.shift` = **X4-6 维持**;自环检查 O(D)/节点;inDegree/adjacency 已 Map | 无候选（X4-6 遵守） |
| `graph/readiness.ts` / `judge.ts` / `compile-children.ts` | deps O(D) 个位;judge `evidenceIds.filter×includes` 证据数个位;compile 单遍 + rootCount 一次 filter | 无候选 |
| `domain/flowchart.ts` | 见 S1-G-4;`approvalPlan` selectable Set 已建;枚举 includes 表长 ≤6 | 无候选 |
| `domain/ids.ts` / `timestamp.ts` / `hash.ts` / `state.ts` / `status.ts` / `roles.ts` / `record.ts` / `errors.ts` | 模块级正则 + O(1) 谓词;`isIsoTimestamp` 的 regex+Date.parse 为语义本体（自写解析器 = X1-3 非逐位一致域）;hash32 单遍 | 无候选 |
| `domain/task.ts` / `run.ts` / `contract.ts` / `episode.ts` / `evidence.ts` / `project.ts` / `limits.ts` / `index.ts`、`supervisor/flowchart.ts` | 一次性校验器 O(输入)，无重复扫描;barrel 无逻辑 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 5. 测试

零代码改动下相关套件基线复核，全绿（Node v22.14.0）：

```bash
npx tsx --test test/unit/run/*.test.ts test/unit/supervisor/*.test.ts test/unit/graph/*.test.ts
# tests 165 / pass 165 / fail 0
npx tsx --test test/integration/m2/*.test.ts test/integration/m2.5/*.test.ts
# tests 27 / pass 27 / fail 0   （m2: supervisor/resume/scheduler; m2.5: flowchart-run/children/resume）
npx tsx --test test/unit/domain/*.test.ts
# tests 31 / pass 31 / fail 0
```

仿真（临时脚本，未入库；完整源码见附录，seed 固定可复现，两次独立运行等价
结论逐位一致、计时抖动范围内稳定）：

```text
S1-G-2 anchor N=24 (decisions=24, facts=24, ledger.progress=72): snapshot()=168.5us/call -> avoidable scalar-read cost/run (~34 calls) = 5.73ms
S1-G-5 bench N=24: per-item clones=168.5us aggregate-clone=178.7us delta/call=-10.2us (negative = aggregate slower)
S1-G-2 anchor N=64 (decisions=64, facts=64, ledger.progress=192): snapshot()=436.2us/call -> avoidable scalar-read cost/run (~34 calls) = 14.83ms
S1-G-5 bench N=64: per-item clones=436.2us aggregate-clone=468.1us delta/call=-32.0us (negative)
S1-G-3 bench: includes=15.4ns set=9.4ns delta/lookup=6.1ns -> per-run upper bound (100 readAll x 1000 events) = 0.61ms
S1-G-3 context: full validateEvent=579ns/event -> membership delta is 1.0% of it
S1-G-1 anchor: readAll CPU (JSON.parse+validateEvent, 1000-event log) = 1.68ms/read -> per-run upper bound (~100 readAll) = 168ms CPU, excl. disk I/O (cache itself excluded: X1-1 + cross-process contract)
S1-G-4 anchor N=25 edges=40 joins=4: whole validateFlowchart=21.7us -> per run (~33 checkpoint validations) = 0.72ms
S1-G-4 anchor N=57 edges=98 joins=7: whole validateFlowchart=43.0us -> per run (~33 checkpoint validations) = 1.42ms
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S1-G-1 | EventStore/EpisodeStore `readAll` 增量缓存（记忆化 + 偏移尾读） | 磁盘是跨进程唯一事实源（CLI pause/answer 独立进程读写）;读时全量校验是 fail-closed 恢复契约（损坏行号/EventLogRecovery）;X1-1 同类。CPU 上界 ~168ms/run 被 I/O 与子代理秒级执行支配 |
| S1-G-2 | `persistLedger`/`persistBlocked`/`failedReason` 全量 `snapshot()` 读标量改轻量 ledger 访问器 | 需扩 `FlowchartSupervisor` 公开接口（S1-F-6 同类）;可避免总量 ~5.7ms/run（N=24, 32 轮上界）噪声 |
| S1-G-3 | `validateEvent` `EVENT_TYPES.includes`（33 项）及同类枚举表 Set 化 | 实测省 6~9ns/查、激进上界 <0.9ms/run、占 validateEvent 1~1.5%;S1-A-8/S1-D-8 同类 |
| S1-G-4 | `validateFlowchart` join `requiredNodeIds`×`edges.some` 换预构邻接 Set | 等价已证（300 轮 fuzz），但全函数 21~43µs、run 级 ≤1.4ms 为收益上界;live 面几十节点（X4-8 理由同类） |
| S1-G-5 | `snapshot()` 逐项 `structuredClone` 合并单次聚合 clone | **实测负优化**（N=24 慢 ~10µs/次、N=64 慢 3~32µs/次，两次运行均负），且仍需 Map→Record 重建;S1-A-4/S1-D-2 同向 |
| S1-G-6 | coordinator `remaining.splice(indexOf)` 与 active/stillActive 重复 filter 改 Set/索引 | 规模 ≤ maxConcurrentTasks（个位~十位）;splice 保序语义;X4-9 同类噪声 |
| S1-G-7 | flowchart-run `nodeTaskId` 线性 find 换预构 Map | 仅审批/等待持久化路径调用（每审批一次）、N 几十，噪声 |
| S1-G-8 | `ConcurrencyGate.waiters.shift()` / `LeaseRegistry.expired()` 拷贝-过滤指针化/融合 | 等待者/租约 ≤ 排队任务数（十级）;expired() 每轮一次;拷贝是 readonly 边界（X4-2 同域）;X4-6 同类 |
| S1-G-9 | flowchart-supervisor `setRuntime` 展开拷贝改原地变异 | `getRuntime` 返回内部引用被 `propagate`/`joinStatus` 局部持有，copy-on-write 是别名安全边界;patch 十字段级噪声 |

重开条件：S1-G-3/4 若 flowchart/事件校验移入高频热路径（如事件流式校验服务）
且规模增长 ≥2 个量级，可凭本报告等价性证据重开；S1-G-1 需先改跨进程持久化
契约（行为变更，不属保行为优化）；S1-G-2 若接口本就因功能需要新增 ledger
访问器，可顺带迁移（届时属功能工作附带，非独立优化）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0x516703`、`0x516704`。

```ts
/**
 * R1-G deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S1-G-1 .. S1-G-9 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file>
 */
import { performance } from "node:perf_hooks";
import { createTaskId } from "/workspace/src/domain/ids.js";
import {
  validateConfidenceScore,
  validateFlowchart,
  type Flowchart,
  type FlowEdge,
  type FlowNode
} from "/workspace/src/domain/flowchart.js";
import { createModelRouter, type ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
import {
  createFlowchartSupervisor,
  type FlowchartSupervisor
} from "/workspace/src/supervisor/flowchart-supervisor.js";
import { validateEvent, EVENT_TYPES } from "/workspace/src/run/events.js";

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
  return (performance.now() - t0) / reps; // ms per call
}

/* ============================================================
 * Shared fixtures: live-scale flowchart supervisor (chain), driven
 * to completion so decisions/facts/ledger.progress hold end-of-run
 * volume (worst case for snapshot()).
 * ============================================================ */
const routerConfig: ModelRouterConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

function chainFlowchart(n: number): Flowchart {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    nodes.push({
      id: `n${i}`,
      taskId: createTaskId(() => `t${i}`),
      role: "actor",
      objective: `Do step ${i} of the plan with enough detail to be realistic`,
      modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
      confidenceThreshold: validateConfidenceScore(0.7),
      approvalRequired: false
    });
    if (i > 0) edges.push({ from: `n${i - 1}`, to: `n${i}`, condition: { type: "success", expected: true } });
  }
  return { id: `chain-${n}`, nodes, edges };
}

function driveToCompletion(n: number): FlowchartSupervisor {
  const sv = createFlowchartSupervisor({
    flowchart: chainFlowchart(n),
    router: createModelRouter(routerConfig),
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3 }
  });
  for (let i = 0; i < n; i += 1) {
    const leases = sv.leaseReadyNodes();
    if (leases.length === 0) break;
    for (const lease of leases) {
      sv.applyChildResult(lease.nodeId, {
        outcome: "SUCCESS",
        confidence: validateConfidenceScore(0.9),
        evidenceIds: [`evd_${lease.nodeId}`],
        facts: [
          { key: `fact-${lease.nodeId}`, value: `value observed at ${lease.nodeId}`, confidence: validateConfidenceScore(0.8) }
        ]
      });
    }
    sv.advanceRound();
  }
  return sv;
}

/* ============================================================
 * S1-G-2 / S1-G-5: snapshot() cost anchors.
 *  - S1-G-2: persistLedger/persistBlocked/failedReason read 4 scalars
 *    through a full snapshot(); upper bound = per-call cost x ~34
 *    avoidable calls per run (persistLedger 1/round x maxRounds=32 + 2).
 *  - S1-G-5: single aggregate structuredClone alternative, equivalence
 *    (same JSON value) + bench.
 * ============================================================ */
for (const n of [24, 64]) {
  const sv = driveToCompletion(n);
  const snap = sv.snapshot();
  check(
    "S1-G-5 equivalence: aggregate structuredClone yields the same snapshot value",
    JSON.stringify(structuredClone(snap)) === JSON.stringify(sv.snapshot())
  );
  const perItem = bench(() => sv.snapshot(), 2000);
  const aggregate = bench(() => structuredClone(snap), 2000);
  console.log(
    `S1-G-2 anchor N=${n} (decisions=${snap.decisions.length}, facts=${Object.keys(snap.facts).length}, ledger.progress=${snap.ledger.progress.length}): snapshot()=${(perItem * 1e3).toFixed(1)}us/call -> avoidable scalar-read cost/run (~34 calls) = ${(perItem * 34).toFixed(2)}ms`
  );
  console.log(
    `S1-G-5 bench N=${n}: per-item clones=${(perItem * 1e3).toFixed(1)}us aggregate-clone=${(aggregate * 1e3).toFixed(1)}us delta/call=${((perItem - aggregate) * 1e3).toFixed(1)}us (negative = aggregate slower; alternative also still needs Map->Record rebuild)`
  );
}

/* ============================================================
 * S1-G-3: EVENT_TYPES (33 entries) Array.includes -> Set.has.
 * Equivalence (known + adversarial unknown types) + bench at the
 * realistic hot mix, scaled to the per-run re-validation upper bound.
 * ============================================================ */
{
  const rng = mulberry32(0x516703);
  const eventTypeSet = new Set<string>(EVENT_TYPES as readonly string[]);
  const adversarial = ["", "AGENT_EVENT ", "agent_event", "RUN_COMPLETED2", "GATE_TRANSITIONX", "unknown"];
  for (const t of [...EVENT_TYPES, ...adversarial]) {
    check(
      "S1-G-3 equivalence",
      (EVENT_TYPES as readonly string[]).includes(t) === eventTypeSet.has(t),
      t
    );
  }
  const hotTypes = [
    "AGENT_EVENT", "AGENT_EVENT", "AGENT_EVENT", "AGENT_EVENT",
    "TASK_STATUS_CHANGED", "TASK_STATUS_CHANGED",
    "AGENT_STARTED", "AGENT_FINISHED", "TASK_LEASED", "LEDGER_UPDATED"
  ] as const;
  const samples: string[] = [];
  for (let i = 0; i < 4096; i += 1) samples.push(pick(rng, hotTypes));
  let sink = 0;
  const inc = bench(() => {
    for (const t of samples) if ((EVENT_TYPES as readonly string[]).includes(t)) sink += 1;
  }, 2000);
  const set = bench(() => {
    for (const t of samples) if (eventTypeSet.has(t)) sink += 1;
  }, 2000);
  const deltaNs = ((inc - set) / samples.length) * 1e6;
  console.log(
    `S1-G-3 bench: includes=${((inc / samples.length) * 1e6).toFixed(1)}ns set=${((set / samples.length) * 1e6).toFixed(1)}ns delta/lookup=${deltaNs.toFixed(1)}ns -> per-run upper bound (100 readAll x 1000 events) = ${((deltaNs * 1e5) / 1e6).toFixed(2)}ms [sink=${sink}]`
  );

  /* whole-validateEvent context + S1-G-1 readAll CPU upper bound */
  const RUN_ID = "run_bench";
  const TASK_ID = "tsk_bench";
  const AGENT_ID = "agt_bench";
  const NOW = "2026-08-24T03:00:00.000Z";
  const mkEvent = (i: number): Record<string, unknown> => {
    const t = samples[i % samples.length] as string;
    const base = { id: `evt_e${i}`, schemaVersion: 1, occurredAt: NOW, runId: RUN_ID, actor: "coordinator", type: t };
    switch (t) {
      case "AGENT_EVENT":
        return { ...base, payload: { agentInstanceId: AGENT_ID, kind: "TOOL_FINISHED", summary: `tool call ${i} finished` } };
      case "TASK_STATUS_CHANGED":
        return { ...base, taskId: TASK_ID, payload: { taskId: TASK_ID, status: "RUNNING", attempt: 1 } };
      case "AGENT_STARTED":
        return { ...base, taskId: TASK_ID, payload: { agentInstanceId: AGENT_ID, taskId: TASK_ID } };
      case "AGENT_FINISHED":
        return { ...base, payload: { agentInstanceId: AGENT_ID, outcome: "SUCCESS" } };
      case "TASK_LEASED":
        return { ...base, taskId: TASK_ID, payload: { taskId: TASK_ID, childRunId: RUN_ID, expiresAt: NOW } };
      case "LEDGER_UPDATED":
        return { ...base, payload: { revision: i, round: 3, consecutiveStalls: 0, isBlocked: false } };
      default:
        throw new Error(`unhandled ${t}`);
    }
  };
  const log = Array.from({ length: 1000 }, (_, i) => mkEvent(i));
  const lines = log.map((e) => JSON.stringify(e));
  const val = bench(() => {
    for (const e of log) validateEvent(e);
  }, 300);
  console.log(
    `S1-G-3 context: full validateEvent=${((val / 1000) * 1e6).toFixed(0)}ns/event -> membership delta is ${((deltaNs / ((val / 1000) * 1e6)) * 100).toFixed(1)}% of it`
  );
  const parse = bench(() => {
    for (const line of lines) validateEvent(JSON.parse(line));
  }, 200);
  console.log(
    `S1-G-1 anchor: readAll CPU (JSON.parse+validateEvent, 1000-event log) = ${parse.toFixed(2)}ms/read -> per-run upper bound (~100 readAll) = ${(parse * 100).toFixed(0)}ms CPU, excl. disk I/O (cache itself excluded: X1-1 + cross-process contract)`
  );
}

/* ============================================================
 * S1-G-4: validateFlowchart join required-edge membership
 * (edges.some per requiredNodeId) -> prebuilt "from->to" Set.
 * Equivalence on accept/reject fuzz + whole-function anchor.
 * ============================================================ */
{
  const rng = mulberry32(0x516704);
  const mk = (id: string, joinPolicy?: FlowNode["joinPolicy"]): FlowNode => ({
    id,
    taskId: createTaskId(() => `t-${id}`),
    role: "actor",
    objective: `Objective for ${id}`,
    modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false,
    ...(joinPolicy !== undefined ? { joinPolicy } : {})
  });
  const joinFlowchart = (n: number, fan: number): Flowchart => {
    const nodes: FlowNode[] = [mk("root")];
    const edges: FlowEdge[] = [];
    let prev = "root";
    let idx = 0;
    while (nodes.length + fan + 1 <= n) {
      const layer: string[] = [];
      for (let i = 0; i < fan; i += 1) {
        const id = `p${idx}_${i}`;
        nodes.push(mk(id));
        edges.push({ from: prev, to: id, condition: { type: "success", expected: true } });
        layer.push(id);
      }
      const joinId = `j${idx}`;
      nodes.push(mk(joinId, { mode: "quorum", quorum: Math.max(1, fan - 1), requiredNodeIds: layer }));
      for (const id of layer) edges.push({ from: id, to: joinId, condition: { type: "success", expected: true } });
      prev = joinId;
      idx += 1;
    }
    return { id: `join-${n}`, nodes, edges };
  };

  // Equivalence fuzz: current edge scan vs prebuilt Set over valid and
  // broken (missing required edge) variants -- same accept/reject verdicts.
  const requiredEdgeExistsCurrent = (edges: readonly FlowEdge[], required: string, nodeId: string): boolean =>
    edges.some((edge) => edge.from === required && edge.to === nodeId);
  for (let trial = 0; trial < 300; trial += 1) {
    const fc = joinFlowchart(12 + Math.floor(rng() * 20), 2 + Math.floor(rng() * 5));
    const broken = rng() < 0.5;
    let edges = fc.edges;
    if (broken) {
      const joinEdgeIdx = edges.findIndex((e) => e.to.startsWith("j"));
      if (joinEdgeIdx >= 0) edges = edges.filter((_, i) => i !== joinEdgeIdx);
    }
    const edgeSet = new Set(edges.map((e) => `${e.from}\u0000${e.to}`));
    for (const node of fc.nodes) {
      const jp = node.joinPolicy;
      if (jp === undefined) continue;
      for (const required of jp.requiredNodeIds) {
        check(
          "S1-G-4 equivalence",
          requiredEdgeExistsCurrent(edges, required, node.id) === edgeSet.has(`${required}\u0000${node.id}`),
          `trial ${trial} ${required}->${node.id}`
        );
      }
    }
  }
  for (const [n, fan] of [[30, 5], [64, 7]] as const) {
    const fc = joinFlowchart(n, fan);
    const cost = bench(() => validateFlowchart(fc), 3000);
    console.log(
      `S1-G-4 anchor N=${fc.nodes.length} edges=${fc.edges.length} joins=${fc.nodes.filter((x) => x.joinPolicy !== undefined).length}: whole validateFlowchart=${(cost * 1e3).toFixed(1)}us -> per run (~33 checkpoint validations) = ${(cost * 33).toFixed(2)}ms (join-membership subcost is a fraction of this bound)`
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

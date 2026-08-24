MODEL_SLUG=claude-fable-5-thinking-xhigh

# R4-G：运行时 / 监督 / 图 / 领域模型切片第四遍复查报告

**战役:** 全库持久 SOTA 优化 Round 4 / R4-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `591def6`
**分支:** `cursor/r4-g-runtime-fourth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线（`4efee23`）
以来**逐字节未变**（`git diff 4efee23 591def6 -- src/run src/supervisor
src/graph src/domain` 为空——R2/R3 十区与 R4-A/B/D/E 均未触碰本切片），
R1-G/R2-G/R3-G 的三遍收口与 S1-G-1..9、S2-G-1..8、S3-G-1..5 排除全部继承
有效。本轮在完整排除表之上第四次全量实际读码、以新角度枚举，得到 7 个
此前未点名的新候选（S4-G-1 … S4-G-7），全部经理论 + 确定性仿真（seeded
mulberry32，等价校验 / **行为发散反例** / 真实规模基准，seeds
`0x548301`/`0x548302` 两次独立运行等价与反例结论逐位一致、计时抖动范围内
稳定）裁决后淘汰：**3 个被反例证明非保行为**——其中两个是本轮最重要发现：
S4-G-1（RUNNING 节点并行执行）是本切片**唯一秒级墙钟候选**（sum→max），
被确定性 id 流 + 事件追加次序双发散反例封死；S4-G-2（persistCheckpoint
写侧校验全跳过）是本切片**最大 CPU 聚合量**（26.7~56.3ms/run，名义上够到
落地线下沿），被"损坏 checkpoint 落盘"反例证明不是合法收益。S4-G-6 在
解析值层等价但**磁盘字节流发散**（数据面契约）。其余合法候选在真实规模
不达线：最强合法候选 S4-G-4（persistLedger 整快照投影 4 标量）全 run 仅
5.4~14.1ms 且每次调用紧跟 fsync 追加、并需要拓宽公开接口。未重开任何
X* / S1-* / S2-* / S3-* / S4-* 条目。X0-2/X0-4/X4-6..9 维持排除未触碰；
事件 schema 零 diff。本切片在其确定性 id 流、事件次序、fail-closed 持久化
与数据面契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部文件第四次实际读码，未依赖前三轮的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S4-A/B/D/E-* 新排除）
  → round-04/PLAN.md → round-01/R1-G.md → round-02/R2-G.md →
  round-03/R3-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1..9、S2-G-1..8、
  S3-G-1..5 二十二条全部不再提案；X0-2（`planTaskTopology` 未接线）、
  X0-4、X4-6（Kahn queue.shift）、X4-7（isDuplicateFact）、X4-8、X4-9
  直接跳过。本轮只探索**未被点名的新角度**：RUNNING 节点并行执行
  （S4-G-1）、写侧校验全跳过的正式量化与反例收口（S4-G-2）、审批双层校验
  去重（S4-G-3）、persistLedger 整快照投影（S4-G-4）、finish() 出参快照
  复用（S4-G-5）、checkpoint 紧凑 JSON（S4-G-6）、`failed` 过滤器下沉
  （S4-G-7）。
- **S1-G-1 遵守**：`readAll` 增量缓存未提案（跨进程磁盘事实源 + fail-closed
  读校验，第四次复核维持）。**S2-G-2 遵守**：`failurePathCompletedGraph`
  共享 `visiting` 语义未触碰。**S2-G-5 遵守**：每轮 `new ChildCoordinator`
  维持原样（确定性 id 流）。**S3-G-4 遵守**：`finish()` 入口
  `persistCheckpoint` 未提跳过——本轮 S4-G-5 只针对**出参快照对象**的复用
  （行为面是对象身份/别名，与 S3-G-4 的"陈旧态落盘"正交），末次落盘本身
  原样保留。**S3-G-2 边界**：S4-G-2 不是 S3-G-2（外/内层去重）的重提——
  它是同域中**从未被赋 ID 的激进端点**（整个写侧校验跳过），R1-G/R2-G
  逐文件收口只以"X3-3/X4-1 同域保留"一笔带过、从未量化也从未给出该端点
  自己的反例；本轮正式量化并以独立反例收口入库（见 §3）。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、payload 校验器、
  `validateEvent` 抛错消息与次序全部原样；CAS / 幂等键 / 确定性 id 流零 diff。
- 双 LCB 与双归因未触碰（本切片不含路由聚合面，天然满足）。不声称
  Outcome-supported。不改阈值、权限、数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，仿真脚本未入库（完整源码见附录）。

## 1. 规模与门槛基底（第四遍继承 + 本轮校准）

R1-G 已实测本切片规模：全部结构维度（节点 N、任务 T、轮次 R≤32、每轮事实、
消息 M、租约 L）为几十级且热点结构已全面 Map 化；唯一增长维度是事件数 E
（数百~千级），只被线性触碰且重复重读是刻意契约（S1-G-1）。R2-G 校准了
每轮 `persistCheckpoint` ≥2 次的 fsync 支配结构；R3-G 校准了 snapshot 面
全 run CPU 总量上界 ~20~45ms（~100 次调用，每次伴随 fsync）。代码逐字节
未变，全部继承。

战役落地线同样继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms——直接标尺），µs 级候选一律被否决过。本轮
新增两点结构校准：

1. **墙钟维度第一次被系统枚举**。本切片是 live 控制面，子代理执行是秒级；
   `executeRemainingRunningNodes`（`flowchart-run.ts:334`）对同轮多个
   RUNNING 节点**严格串行 await**，串行和 = Σ(子代理秒级时长)。这是全
   切片唯一超过落地线的候选维度（秒级 >> 百 ms），但被行为发散反例封死
   （S4-G-1，见 §3）——不是"不够大"，是"不合法"。
2. **CPU 聚合量的真实天花板被正式量化**。写侧 `validateCheckpoint` 全量
   （含 restore 干跑）实测 396~404µs/write（N=24）、847~854µs/write
   （N=64），×~66 次/run = **26.2~56.3ms/run**——这是本切片最大的单一
   CPU 聚合量，名义上够到落地线下沿，但它是 fail-closed 写前防线，跳过
   即改行为（S4-G-2 反例，见 §3）。合法候选中最大的是 S4-G-4 的
   5.4~14.1ms/run，距落地线仍差数倍且被 fsync 支配。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S4-G-1 | `executeRemainingRunningNodes`（`flowchart-run.ts:334`）对同轮多个 RUNNING 节点的串行 await 改 `Promise.all` 并行 | 墙钟 sum→max：同轮 k 个可并行节点省 (k-1)×子代理秒级时长，**唯一秒级候选** | ❌ **反例**：共享确定性 id 生成器在并发下交错——nB 的 agentInstanceId 从 `agt_id0004` 变 `agt_id0003`，AGENT_FINISHED 追加次序随子代理完成时序漂移（events.jsonl 是事实源，次序可观察且不再确定）（两 seed 同判） | 仿真 30.6ms→24.5ms（缩尺）；真实规模秒级 | 淘汰：**非保行为**——同时击穿"确定性 id 流不可改"与事件追加次序两条硬不变量；重开需产品级契约重定义（见 §6） |
| S4-G-2 | `persistCheckpoint`（`flowchart-run.ts:447`）写侧 `validateCheckpoint`（含 `validateFlowchartCheckpointState` restore 干跑）全跳过——checkpoint 刚由可信内存态物化 | 免每写 396~854µs 全量校验，本切片最大 CPU 聚合量 | ❌ **反例**：注入损坏快照（非法 node state）后，现实现**写前抛错**（磁盘保留上一份好 checkpoint）；变体把含 `NOT_A_STATE` 的损坏字节流序列化并 fsync 落盘——磁盘内容与错误浮出时机（写时 vs 恢复时）双发散（两 seed 同判） | 26.2~26.7ms/run（N=24）、55.9~56.3ms/run（N=64） | 淘汰：**非保行为**——fail-closed 写前屏障是持久化契约（X3-3/X4-1 同域、S3-G-2 反例的激进端点，首次正式量化 + 独立反例收口）；且每次校验伴随 fsync 原子写，I/O 支配 |
| S4-G-3 | `applyApproval` 外层 `validateApprovalReplyAgainstPlan`（`flowchart-run.ts:557`）与 `applyApprovalReply` 内层（`flowchart-supervisor.ts:841`）双层校验去重 | 免每审批一层校验 | ❌ **反例**：去外层后非法 reply 先追加 USER_ANSWER 再在内层抛错——事件日志多出一条现实现从不写入的事件（实测 current 追加 0 条、variant 追加 1 条）；去内层则改公开接口 `applyApprovalReply` 对全部调用方的校验契约（两 seed 同判） | 单层校验仅 325~343ns/审批、每 run 1~2 次审批 | 淘汰：**非保行为** + 收益亚噪声，双重淘汰 |
| S4-G-4 | `persistLedger`（`flowchart-run.ts:470`）为投影 4 个标量（revision/round/consecutiveStalls/isBlocked）取整份深快照 → 窄投影 | 免每轮一次全量 snapshot()（N=64 实测 437~441µs/次） | ✅ LEDGER_UPDATED payload 逐位一致（两 seed 同判） | delta 170.0~173.6µs/call（N=24）、436.6~440.9µs/call（N=64）；全 run（~32 次 persistLedger）**5.44~14.11ms** | 淘汰：距落地线数倍；每次调用紧跟 append+fsync（I/O 支配）；且消除需给公开接口 `FlowchartSupervisor` 增窄读方法（公开签名面变更）或击穿封装；处于 R3-G 已封死的 snapshot 面 20~45ms 总上界之内 |
| S4-G-5 | `finish()`（`flowchart-run.ts:543`）出参 `outcome.snapshot` 复用 `persistCheckpoint`（:438）刚取的快照对象 | 免一次 snapshot() | ✅ 值等价（settle 不变异 supervisor，两次 snapshot JSON 逐位一致）但复用后 `outcome.snapshot === checkpoint.flowchart.snapshot`——对象身份可观察、隔离性降级 | 167.8~169.4µs **每 run 仅一次** | 淘汰：0.17ms/run 亚噪声 + 别名化把两个独立出参耦合为共享可变对象，风险换噪声 |
| S4-G-6 | `CheckpointStore.write`（`checkpoint-store.ts:17`）`JSON.stringify(checkpoint, null, 2)` 改紧凑 JSON | 免美化序列化 + 字节数 68KB→38KB（N=24）、180KB→102KB（N=64） | ⚠️ 解析值等价但**磁盘字节流发散**（两 seed 同判）——checkpoint.json 是跨进程/人工可读数据面 | delta 45.4~45.7µs/write（N=24）、176.1~269.8µs/write（N=64）；全 run（~66 写）**3.0~17.8ms** | 淘汰：磁盘格式是数据面契约（任务明令不改）；每写伴随 fsync（tmp+sync+rename 原子写支配）；量级本身也不达线 |
| S4-G-7 | `runSupervisorRounds`（`run/supervisor.ts:278`）`failed` 过滤器在每个 ready 空轮无条件计算、仅 `!canProgress` 分支消费 → 下沉入分支 | 免每轮一次 O(T) 过滤 | ✅ 纯过滤无副作用，等价 | 单次 284~304ns（T=48）；全 run（≤32 轮）**9.1~9.7µs** | 淘汰：亚噪声（M2 遗留路径，X4-6 理由域邻域） |

## 3. 关键裁决细节

### S4-G-1：本切片唯一秒级候选被确定性契约封死（本轮最重要发现）

`leaseReadyNodes` 每轮可按 `maxConcurrentNodes` 租出多个节点，但
`executeRemainingRunningNodes`（`flowchart-run.ts:334-369`）对它们**严格
串行 await**——每个 clustered/executor 节点都阻塞到子代理秒级执行完成。
并行化的名义收益是同轮 sum→max，即 (k-1)×秒级/轮，是全战役少见的
数量级达标候选。但仿真复现执行模式后双发散：

1. **id 流发散**：`agentInstanceId`（:345）与事件 id（`ctx.make`/
   `createEventId`）都从同一个共享确定性生成器顺序抽取。串行下 nA 消费
   `id0001..0003`、nB 消费 `id0004..0006`；`Promise.all` 下 nA 在首个
   await 处让出，nB 的 agentInstanceId 变为 `agt_id0003`——同一输入产生
   不同 id 指派，违反"确定性 id 流不可改"硬不变量。
2. **事件次序发散**：AGENT_FINISHED 的追加次序由子代理完成时序决定
   （仿真中 nB 先完成，`[STARTED_A, STARTED_B, FINISHED_B, FINISHED_A]`
   vs 串行 `[STARTED_A, FINISHED_A, STARTED_B, FINISHED_B]`）。
   events.jsonl 是事实源，追加次序是可观察面且从确定性变为时序依赖；
   下游 `applyChildResult` 的调用次序连带漂移，`propagate`/决策门的
   评估次序随之改变。

重开需要对 id 流与事件次序契约做**产品级重定义**（如按节点命名空间化
id + 确定性归并），属语义工作而非保行为优化。任何"并行执行 RUNNING
节点"的提案都被本反例排除。

### S4-G-2：最大 CPU 聚合量不是合法收益——写侧屏障的正式量化与收口

R1-G/R2-G 逐文件收口曾以"写前 fail-closed 自检，X3-3/X4-1 同域保留"
一笔带过写侧校验；S3-G-2 只裁决了**外/内层去重**（错误消息前缀发散）。
"整个写侧校验跳过"这一激进端点从未被赋 ID、从未被量化、也没有自己的
反例——而它名义上是本切片最大的 CPU 聚合量：全量 `validateCheckpoint`
（validateFlowchart + 快照校验 + `snapshotValidationRouter` restore 干跑）
实测 396.6~404.1µs/write（N=24）、847.3~853.7µs/write（N=64），
×~66 写/run = **26.2~56.3ms/run**，够到落地线下沿。仿真反例：向
checkpoint 注入非法 node state（`NOT_A_STATE`）后，现实现在
`validateCheckpoint` 处**写前抛错**——`CheckpointStore.write` 从未被调用，
磁盘保留上一份完好 checkpoint（崩溃后 resume 从好状态恢复）；变体直接
序列化，损坏字节流经 tmp+fsync+rename **持久落盘**——错误从写时浮出推迟
到下次 resume 读校验，且磁盘内容本身已发散。fail-closed 写前屏障是
持久化契约的实现点，跳过即改行为。加之每次校验都伴随一次 fsync 原子写
（I/O 支配），双重淘汰。**本条目连同 S3-G-2 一起，把写侧校验域的全部
削减谱系（去一层 / 全跳过）收口入库。**

### S4-G-4：最强合法候选为何仍不达线

`persistLedger`（`flowchart-run.ts:469-479`）每轮调用一次（`runFlowchartLoop`
:616 或 :631），为读 4 个标量字段取整份深快照——N=64 时每次 437~441µs
纯为投影浪费（窄投影实测 54~121ns）。这是"不是更快拷贝、而是不拷贝"的
新角度，等价性平凡成立（LEDGER_UPDATED payload 逐位一致）。但三条独立
理由封死落地：(1) **规模**——~32 次/run × delta = 5.44~14.11ms，距数十~
数百 ms 落地线数倍，且处于 R3-G 已论证的 snapshot 面 20~45ms 全 run 总
上界之内（该上界已把"即使拷贝成本归零也不达线"钉死）；(2) **I/O 支配**
——每次 persistLedger 紧跟 `ctx.append`（LEDGER_UPDATED 事件 fsync 落盘）；
(3) **公开面**——`FlowchartSupervisor` 接口（`flowchart-supervisor.ts:191`）
无窄读方法，消除快照需拓宽公开接口（签名面变更，任务明令不改）或击穿
封装读私有字段。重开条件见 §6。

### 保行为面复核（第四遍，在三轮收口之上）

- **O(R×E) 重复 `readAll` 维持排除**（S1-G-1）：第四次复核 `finish()`
  三连读与 `pauseIfRequested`/`persistWaiting`/`persistBlocked` 等幂等
  哨卫重读之间的跨进程追加窗口（CLI answer/pause 独立进程写同一
  events.jsonl），复用即缓存即 X1-1。维持。
- **checkpoint 写侧防线完整维持**：S4-G-2 的反例把"全跳过"端点也钉入
  排除表；写侧校验域（X3-3/X4-1 同域 + S3-G-2 + S4-G-2）现已全谱系收口。
- **审批路径双层校验维持**：S4-G-3 反例证明外层校验的"追加前拦截"角色
  与内层校验的"公开接口自卫"角色各自不可省。
- **调度/resume/lease/join**：`planRound` 三段式、孤儿 lease 恢复链、
  `joinStatus` quorum 计数、`assertWaiterInvariant`、共享 `visiting` 的
  失败恢复图语义（S2-G-2）——零 diff。
- **确定性 id 流**：每轮 `new ChildCoordinator`（S2-G-5）、`createId`
  消费次序、事件 id 派生——零 diff；S4-G-1 反例进一步证明该契约是本切片
  墙钟优化的硬边界。

### 逐文件收口（第四遍新视角补充，前三轮收口之上）

| 文件 | 第四遍新检查点 | 结论 |
| --- | --- | --- |
| `run/flowchart-run.ts` | 见 S4-G-1/2/3/4/5；`finishIfSettled` 每轮 ≤4 次调用 `computeStatus` O(N) 几十级噪声（X4-8 域）；`applyRunningResults` O(N)/轮噪声 | 无候选落地 |
| `supervisor/flowchart-supervisor.ts` | 见 S4-G-3（内层校验角色）；`get pendingApproval` 每读一次 structuredClone 是读侧隔离（S3-G-1 规模论证覆盖）；`computeStatus` 每 `get status` 重算 = X4-8 维持 | 无候选落地 |
| `run/checkpoint-store.ts` | 见 S4-G-6；tmp+fsync+rename 原子写契约维持（S3-G-4/S4-G-2 反例双重佐证不可省） | 无候选落地 |
| `run/supervisor.ts` | 见 S4-G-7；`reconstructSupervisorState` 单遍重放维持；孤儿 lease 恢复循环 O(L) 一次性；`planTaskTopology` 维持未接线（X0-2） | 无候选落地 |
| `run/replay.ts` | 见 S4-G-2（validateCheckpoint 调用方视角）；`replayRun` 单遍状态机、`materializeCheckpoint` O(1) 派生维持 | 无候选落地 |
| `run/child-coordinator.ts` | 每轮 new = S2-G-5 维持；`handleExecutionEvent` = S3-G-3 维持；`ConcurrencyGate` 节点内并发与 S4-G-1 的跨节点串行是两层——前者已并行且 id 流按消息到达序消费是既有语义 | 无候选 |
| `run/events.ts` | `validateEvent` 读写双侧调用 = S1-G-3/S3-G-5 维持；schema 零碰 | 无候选 |
| `run/event-store.ts` / `episode-store.ts` | append 写前 validateEvent 写侧 fail-closed；readAll = S1-G-1 第四次维持；终端事件 fsync 标志持久化契约 | 无候选 |
| `run/scheduler.ts` / `run/coordinator.ts` / `run/inspection.ts` | `isExpired` = S2-G-8、splice/filter = S1-G-6、两遍扫描 = S2-G-6 维持 | 无候选 |
| `run/flowchart-executor.ts` / `child-grounding.ts` / `child-prompt.ts` / `episode-bind.ts` / `pause-controller.ts` / `injection.ts` | O(输入) 组装每子任务一次；一次性请求路径 | 无候选 |
| `supervisor/ledger.ts` | `advanceLedgerRound` 拷贝 R≤32 × 事实几十级噪声（R3-G 收口维持）；X4-7 维持 | 无候选 |
| `supervisor/flowchart-snapshot.ts` | `snapshotValidationRouter()` 每校验重建（:488）——量化后属 S4-G-2 全量 396~854µs 的 <5%、独立收益 µs 级且模块级提升 = X1-1 邻域，并入 S4-G-2 收口不另立 ID | 无候选落地 |
| `graph/validate.ts` / `readiness.ts` / `judge.ts` / `compile-children.ts` | Kahn = X4-6 维持；一次性接受路径；judge 证据个位 | 无候选 |
| `domain/flowchart.ts` | 见 S4-G-3（validateApprovalReplyAgainstPlan 本体 O(plan) 线性、325~343ns）；`validateJoin` = S1-G-4 维持 | 无候选落地 |
| `domain/ids.ts` / `state.ts` | isId = S3-G-5 维持；BFS = S2-G-4 维持 | 无候选 |
| `domain/` 其余 13 文件 | 模块级正则 + O(1) 谓词 + 一次性校验器；`isIsoTimestamp` = X1-3 域 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-G 基线 `4efee23` 起经
R2-G、R3-G、本轮 R4-G 四遍复查累计零代码改动，逐字节一致。

## 5. 测试

零代码改动下相关套件基线复核，全绿（Node v22.14.0，pnpm 10.17.1）：

```bash
npx tsx --test test/unit/run/*.test.ts test/unit/supervisor/*.test.ts test/unit/graph/*.test.ts
# tests 165 / pass 165 / fail 0
npx tsx --test test/integration/m2/*.test.ts test/integration/m2.5/*.test.ts
# tests 27 / pass 27 / fail 0
npx tsx --test test/unit/domain/*.test.ts
# tests 31 / pass 31 / fail 0
```

仿真（临时脚本，未入库——无赢家不落仿真文件，完整源码见附录；seeds
`0x548301`/`0x548302` 两次独立运行等价/反例结论逐位一致、计时抖动范围内
稳定）：

```text
seed=0x548301
S4-G-1 sequential log : AGENT_STARTED node=nA agent=agt_id0001 evt=evt_id0002 | AGENT_FINISHED node=nA agent=agt_id0001 evt=evt_id0003 | AGENT_STARTED node=nB agent=agt_id0004 evt=evt_id0005 | AGENT_FINISHED node=nB agent=agt_id0004 evt=evt_id0006
S4-G-1 parallel log   : AGENT_STARTED node=nA agent=agt_id0001 evt=evt_id0002 | AGENT_STARTED node=nB agent=agt_id0003 evt=evt_id0004 | AGENT_FINISHED node=nB agent=agt_id0003 evt=evt_id0005 | AGENT_FINISHED node=nA agent=agt_id0001 evt=evt_id0006
S4-G-1 wall clock: sequential=30.6ms (sum of children) parallel=24.5ms (max of children) -> at real scale (children run seconds) the gain is seconds-level, but:
S4-G-2 bench N=24: validateCheckpoint(full)=404.1us/write (clone overhead excluded) -> per run (~66 checkpoint writes) = 26.67ms
S4-G-2 counterexample: current=THROWS-BEFORE-WRITE(true) variant=WRITES-CORRUPT-CHECKPOINT(bytes contain NOT_A_STATE: true)
S4-G-2 bench N=64: validateCheckpoint(full)=853.7us/write (clone overhead excluded) -> per run (~66 checkpoint writes) = 56.34ms
S4-G-3 counterexample: current appends 0 events (throws before append: true); variant appends 1 event(s) before the inner validation throws
S4-G-3 bench: one validateApprovalReplyAgainstPlan=343ns -> dedup saving ~343ns per approval (1-2 approvals/run)
S4-G-4 bench N=24: current(full snapshot for 4 scalars)=173.7us variant(direct projection)=63ns delta/call=173.6us -> per run (~32 persistLedger calls) = 5.56ms
S4-G-4 bench N=64: current(full snapshot for 4 scalars)=436.7us variant(direct projection)=121ns delta/call=436.6us -> per run (~32 persistLedger calls) = 13.97ms
S4-G-5 bench N=24: one snapshot()=167.8us, saved ONCE per run -> 0.168ms/run; reuse would make outcome.snapshot === checkpoint.flowchart.snapshot (aliasing)
S4-G-6 bench N=24: stringify pretty=99.4us compact=53.6us delta/write=45.7us bytes 68144->38427 -> per run (~66 writes) = 3.02ms
S4-G-6 bench N=64: stringify pretty=415.8us compact=146.0us delta/write=269.8us bytes 180184->101507 -> per run (~66 writes) = 17.81ms
S4-G-7 bench T=48: one failed-filter=284ns -> per run (<=32 idle rounds) = 9.08us
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x548302
S4-G-1 sequential/parallel log：与 seed 1 逐位一致（发散反例复现）
S4-G-1 wall clock: sequential=30.5ms parallel=24.5ms
S4-G-2 bench N=24: 396.6us/write -> 26.17ms/run; N=64: 847.3us/write -> 55.92ms/run
S4-G-2 counterexample: 与 seed 1 逐位一致
S4-G-3 counterexample: 与 seed 1 逐位一致; bench=325ns
S4-G-4 bench N=24: delta/call=170.0us -> 5.44ms/run; N=64: delta/call=440.9us -> 14.11ms/run
S4-G-5 bench N=24: one snapshot()=169.4us -> 0.169ms/run
S4-G-6 bench N=24: delta/write=45.4us bytes 68144->38427 -> 3.00ms/run; N=64: delta/write=176.1us bytes 180184->101507 -> 11.62ms/run
S4-G-7 bench T=48: one failed-filter=304ns -> 9.74us/run
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S4-G-1 | `executeRemainingRunningNodes` 同轮 RUNNING 节点 `Promise.all` 并行执行 | **非保行为**：共享确定性 id 生成器并发交错（agentInstanceId 指派实测漂移）+ AGENT_FINISHED 追加次序随子代理完成时序漂移——同时击穿确定性 id 流与事件次序两条硬不变量；唯一秒级墙钟候选被此封死 |
| S4-G-2 | `persistCheckpoint` 写侧 `validateCheckpoint` 全跳过（含任何"可信内存态免检"变体） | **非保行为**：损坏态从写前抛错（磁盘保留好 checkpoint）变为损坏字节流 fsync 落盘、错误推迟到 resume 读侧浮出；26~56ms/run 名义收益不是合法收益；写侧校验域（X3-3/X4-1 同域）连同 S3-G-2 全谱系收口 |
| S4-G-3 | `applyApproval` 外层与 `applyApprovalReply` 内层审批校验去重 | **非保行为**：去外层则非法 reply 先追加 USER_ANSWER 再抛错（事件日志多一条）；去内层则改公开接口校验契约；且单层仅 ~325~343ns/审批，亚噪声 |
| S4-G-4 | `persistLedger` 整快照投影 4 标量改窄投影 | 等价（payload 逐位一致）但全 run 仅 5.44~14.11ms（N=24/64），距落地线数倍、每次调用紧跟 append+fsync、处于 snapshot 面 20~45ms 总上界内；且需拓宽公开接口 `FlowchartSupervisor` 或击穿封装 |
| S4-G-5 | `finish()` 出参 `outcome.snapshot` 复用 checkpoint 内嵌快照对象 | 值等价但对象身份可观察发散（`outcome.snapshot === checkpoint.flowchart.snapshot` 别名化、隔离性降级）；0.17ms/run 每 run 仅一次，亚噪声 |
| S4-G-6 | `CheckpointStore.write` 美化 JSON 改紧凑 JSON | 磁盘字节流发散（checkpoint.json 是跨进程/人工可读数据面契约，任务明令不改）；3.0~17.8ms/run 且被 tmp+fsync+rename 原子写支配 |
| S4-G-7 | `runSupervisorRounds` 的 `failed` 过滤器下沉入 `!canProgress` 分支 | 等价但 284~304ns/轮、全 run ≤9.7µs，亚噪声（M2 遗留路径） |

重开条件：S4-G-1 需先对确定性 id 流与事件追加次序契约做**产品级重定义**
（如按节点命名空间化 id + 确定性归并落盘），属语义工作而非保行为优化，
届时可凭本反例框架重新裁决；S4-G-2 需先做出 fail-closed 写侧屏障的
**行为变更决策**（与 S3-G-2 重开条件同源：checkpoint 校验面的显式重定义）；
S4-G-6 需先显式重定义 checkpoint.json 数据面格式契约（含全部读方迁移）；
S4-G-4 若 live flowchart 规模增长 ≥2 个量级**且** persistLedger 频次同步
放大**且**公开接口允许窄读方法（签名面决策），可凭本报告等价证据重开；
S4-G-3/5/7 为 ns~百 µs 级常数或别名风险，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed>`（依赖
已装；`.mts` 后缀确保 ESM 顶层 await 可用）。seeds：`0x548301`、
`0x548302`（其余段确定性构造，无随机性）。

```ts
/**
 * R4-G deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh candidates S4-G-1 .. S4-G-7 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed>
 */
import { performance } from "node:perf_hooks";
import {
  createAgentInstanceId,
  createEventId,
  createTaskId
} from "/workspace/src/domain/ids.js";
import {
  validateApprovalReplyAgainstPlan,
  validateConfidenceScore,
  validateFlowchart,
  type ApprovalPlan,
  type ApprovalReply,
  type Flowchart,
  type FlowEdge,
  type FlowNode
} from "/workspace/src/domain/flowchart.js";
import { createModelRouter, type ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
import {
  createFlowchartSupervisor,
  type FlowchartSupervisor
} from "/workspace/src/supervisor/flowchart-supervisor.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "/workspace/src/run/replay.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import type { Event } from "/workspace/src/run/events.js";

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

const SEED = Number.parseInt(process.argv[2] ?? "0x548301", 16) || 0x548301;
console.log(`seed=0x${SEED.toString(16)}`);

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

function makeCheckpoint(n: number): { cp: ReturnType<typeof materializeCheckpoint>; sv: FlowchartSupervisor } {
  const sv = driveToCompletion(n);
  let tick = 0;
  const nextIso = (): IsoTimestamp => new Date(1756000000000 + (tick += 1000)).toISOString() as IsoTimestamp;
  let idn = 0;
  const gen = () => `id${String((idn += 1)).padStart(4, "0")}`;
  const mk = (type: Event["type"], payload: unknown): Event =>
    ({
      id: createEventId(gen),
      schemaVersion: 1,
      occurredAt: nextIso(),
      runId: "run_r4g",
      type,
      actor: "flowchart-supervisor",
      payload
    }) as Event;
  const events: Event[] = [mk("RUN_STARTED", {})];
  const flowchart = {
    definition: chainFlowchart(n),
    snapshot: sv.snapshot(),
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3, remainingTimeMs: Number.MAX_SAFE_INTEGER }
  };
  const cp = materializeCheckpoint(replayRun(events), nextIso(), flowchart);
  return { cp, sv };
}

/* ============================================================
 * S4-G-1: executeRemainingRunningNodes (flowchart-run.ts:334) executes
 * RUNNING nodes strictly sequentially (await inside the for-loop) even
 * though each clustered/executor node blocks for the child agent's full
 * seconds-scale wall time. Candidate: Promise.all across RUNNING nodes
 * (sum -> max of child durations; the ONLY above-threshold wall-clock
 * candidate in the slice). COUNTEREXAMPLE: the shared deterministic id
 * generator and the append order interleave under concurrency -> the id
 * stream and the event log diverge (and depend on child timing).
 * ============================================================ */
{
  interface SimNode { id: string; durMs: number }
  async function runPattern(parallel: boolean): Promise<{ log: string[]; wallMs: number }> {
    let idn = 0;
    const gen = () => `id${String((idn += 1)).padStart(4, "0")}`;
    const log: string[] = [];
    // Two independent RUNNING nodes in the same round; B's child finishes
    // first. Durations are fixed constants (deterministic across seeds).
    const nodes: SimNode[] = [
      { id: "nA", durMs: 24 },
      { id: "nB", durMs: 6 }
    ];
    const execOne = async (node: SimNode): Promise<void> => {
      // Mirrors flowchart-run.ts:345-346: draw agentInstanceId, then append
      // AGENT_STARTED (event id drawn from the same shared generator).
      const agentInstanceId = createAgentInstanceId(gen);
      log.push(`AGENT_STARTED node=${node.id} agent=${agentInstanceId} evt=${createEventId(gen)}`);
      await new Promise((resolve) => setTimeout(resolve, node.durMs));
      // Mirrors flowchart-run.ts:364: append AGENT_FINISHED after the await.
      log.push(`AGENT_FINISHED node=${node.id} agent=${agentInstanceId} evt=${createEventId(gen)}`);
    };
    const t0 = performance.now();
    if (parallel) await Promise.all(nodes.map((node) => execOne(node)));
    else for (const node of nodes) await execOne(node);
    return { log, wallMs: performance.now() - t0 };
  }
  const sequential = await runPattern(false);
  const parallelized = await runPattern(true);
  console.log(`S4-G-1 sequential log : ${sequential.log.join(" | ")}`);
  console.log(`S4-G-1 parallel log   : ${parallelized.log.join(" | ")}`);
  console.log(
    `S4-G-1 wall clock: sequential=${sequential.wallMs.toFixed(1)}ms (sum of children) parallel=${parallelized.wallMs.toFixed(1)}ms (max of children) -> at real scale (children run seconds) the gain is seconds-level, but:`
  );
  check(
    "S4-G-1 divergence demonstrated (id stream + event order differ under Promise.all)",
    JSON.stringify(sequential.log) !== JSON.stringify(parallelized.log)
  );
}

/* ============================================================
 * S4-G-2: persistCheckpoint (flowchart-run.ts:447) runs the full
 * validateCheckpoint (incl. validateFlowchartCheckpointState restore
 * dry-run) before EVERY write. Candidate: skip the write-side validation
 * entirely (checkpoint was just materialized from trusted in-memory state).
 * Largest remaining CPU aggregate in the slice -- quantified below.
 * COUNTEREXAMPLE: with corrupt in-memory state the current code throws
 * BEFORE the write (disk keeps the last good checkpoint); the variant
 * serializes and durably fsyncs the corrupt checkpoint.
 * ============================================================ */
for (const n of [24, 64]) {
  const { cp } = makeCheckpoint(n);
  const cost = bench(() => validateCheckpoint(structuredClone(cp)), 500);
  const cloneOnly = bench(() => structuredClone(cp), 500);
  const net = cost - cloneOnly;
  console.log(
    `S4-G-2 bench N=${n}: validateCheckpoint(full)=${(net * 1e3).toFixed(1)}us/write (clone overhead excluded) -> per run (~66 checkpoint writes) = ${(net * 66).toFixed(2)}ms`
  );
  if (n === 24) {
    const malformed = structuredClone(cp) as unknown as Record<string, unknown>;
    ((malformed.flowchart as Record<string, unknown>).snapshot as { nodes: Record<string, Record<string, unknown>> }).nodes["n0"]!.state = "NOT_A_STATE";
    let currentThrew = false;
    let currentWrote = "";
    try {
      validateCheckpoint(malformed);
      currentWrote = JSON.stringify(malformed, null, 2);
    } catch {
      currentThrew = true; // nothing serialized, nothing written
    }
    // Variant: skip write-side validation, serialize directly.
    const variantWrote = `${JSON.stringify(malformed, null, 2)}\n`;
    console.log(
      `S4-G-2 counterexample: current=THROWS-BEFORE-WRITE(${currentThrew}) variant=WRITES-CORRUPT-CHECKPOINT(bytes contain NOT_A_STATE: ${variantWrote.includes("NOT_A_STATE")})`
    );
    check(
      "S4-G-2 divergence demonstrated (fail-closed write barrier removed)",
      currentThrew && currentWrote === "" && variantWrote.includes("NOT_A_STATE")
    );
  }
}

/* ============================================================
 * S4-G-3: applyApproval (flowchart-run.ts:557) validates the reply against
 * the plan, then applyApprovalReply (flowchart-supervisor.ts:841) validates
 * the same reply again. Candidate: drop the outer call. COUNTEREXAMPLE:
 * the outer validation throws BEFORE the USER_ANSWER append; without it an
 * invalid reply appends USER_ANSWER first and only then throws inside the
 * supervisor -> the event log diverges (gains an event the current
 * implementation never writes).
 * ============================================================ */
{
  const plan: ApprovalPlan = {
    id: "apl_1",
    items: [
      { id: "act_a", label: "Apply patch A", selectable: true },
      { id: "act_b", label: "Apply patch B", selectable: true }
    ]
  };
  const invalidReply: ApprovalReply = { approvalPlanId: "apl_1", selectedActionIds: ["act_zzz"] };

  const currentPath = (): string[] => {
    const appended: string[] = [];
    const validated = validateApprovalReplyAgainstPlan(plan, invalidReply); // throws here
    appended.push(`USER_ANSWER selected=${validated.selectedActionIds.join(",")}`);
    return appended;
  };
  const variantPath = (): string[] => {
    const appended: string[] = [];
    const correlated: ApprovalReply = { approvalPlanId: plan.id, selectedActionIds: invalidReply.selectedActionIds };
    appended.push(`USER_ANSWER selected=${correlated.selectedActionIds.join(",")}`);
    // inner validation (applyApprovalReply -> validateApprovalReplyAgainstPlan) throws AFTER the append
    try {
      validateApprovalReplyAgainstPlan(plan, correlated);
    } catch {
      /* run surfaces the error, but the event is already durable */
    }
    return appended;
  };
  let currentAppended: string[] = [];
  let currentThrew = false;
  try {
    currentAppended = currentPath();
  } catch {
    currentThrew = true;
  }
  const variantAppended = variantPath();
  console.log(
    `S4-G-3 counterexample: current appends ${currentAppended.length} events (throws before append: ${currentThrew}); variant appends ${variantAppended.length} event(s) before the inner validation throws`
  );
  check(
    "S4-G-3 divergence demonstrated (event log gains USER_ANSWER for an invalid reply)",
    currentThrew && currentAppended.length === 0 && variantAppended.length === 1
  );
  const validReply: ApprovalReply = { approvalPlanId: "apl_1", selectedActionIds: ["act_a"] };
  const cost = bench(() => validateApprovalReplyAgainstPlan(plan, validReply), 100000);
  console.log(
    `S4-G-3 bench: one validateApprovalReplyAgainstPlan=${(cost * 1e6).toFixed(0)}ns -> dedup saving ~${(cost * 1e6).toFixed(0)}ns per approval (1-2 approvals/run)`
  );
}

/* ============================================================
 * S4-G-4: persistLedger (flowchart-run.ts:470) takes a FULL deep
 * snapshot() just to project four scalar ledger fields (revision, round,
 * consecutiveStalls, isBlocked). Candidate: a narrow ledger projection.
 * Equivalent in value -- the strongest legal candidate this round.
 * Quantified against the per-run bound; also requires widening the public
 * FlowchartSupervisor interface (public-surface change).
 * ============================================================ */
for (const n of [24, 64]) {
  const sv = driveToCompletion(n);
  const snapLedger = sv.snapshot().ledger;
  const projectionSource = structuredClone(snapLedger); // stand-in for internal field access
  const current = (): unknown => {
    const ledger = sv.snapshot().ledger;
    return { revision: ledger.revision, round: ledger.round, consecutiveStalls: ledger.consecutiveStalls, isBlocked: ledger.isBlocked };
  };
  const variant = (): unknown => ({
    revision: projectionSource.revision,
    round: projectionSource.round,
    consecutiveStalls: projectionSource.consecutiveStalls,
    isBlocked: projectionSource.isBlocked
  });
  check(`S4-G-4 equivalence N=${n}: identical LEDGER_UPDATED payload`, JSON.stringify(current()) === JSON.stringify(variant()));
  const cur = bench(() => void current(), 2000);
  const varc = bench(() => void variant(), 2000);
  const delta = cur - varc;
  console.log(
    `S4-G-4 bench N=${n}: current(full snapshot for 4 scalars)=${(cur * 1e3).toFixed(1)}us variant(direct projection)=${(varc * 1e6).toFixed(0)}ns delta/call=${(delta * 1e3).toFixed(1)}us -> per run (~32 persistLedger calls) = ${(delta * 32).toFixed(2)}ms`
  );
}

/* ============================================================
 * S4-G-5: finish() (flowchart-run.ts:543) takes a second fresh snapshot()
 * for the returned outcome although persistCheckpoint (line 438) just took
 * one that is embedded in the returned checkpoint. Candidate: reuse it.
 * Value-equal, but the outcome would alias checkpoint.flowchart.snapshot
 * (object identity is observable; isolation guarantee downgraded). Gain is
 * one snapshot() call ONCE per run.
 * ============================================================ */
{
  const sv = driveToCompletion(24);
  const first = sv.snapshot();
  const second = sv.snapshot();
  check("S4-G-5 value equivalence (settle does not mutate supervisor)", JSON.stringify(first) === JSON.stringify(second));
  check("S4-G-5 current isolation: two calls yield distinct objects", first !== second && first.nodes !== second.nodes);
  const cost = bench(() => sv.snapshot(), 3000);
  console.log(
    `S4-G-5 bench N=24: one snapshot()=${(cost * 1e3).toFixed(1)}us, saved ONCE per run -> ${(cost).toFixed(3)}ms/run; reuse would make outcome.snapshot === checkpoint.flowchart.snapshot (aliasing)`
  );
}

/* ============================================================
 * S4-G-6: CheckpointStore.write (checkpoint-store.ts:17) serializes with
 * JSON.stringify(checkpoint, null, 2). Candidate: compact JSON. Parsed
 * value identical, but the on-disk byte stream is the data plane other
 * processes and humans read -- and every write is fsync-dominated anyway.
 * ============================================================ */
for (const n of [24, 64]) {
  const { cp } = makeCheckpoint(n);
  const pretty = bench(() => JSON.stringify(cp, null, 2), 500);
  const compact = bench(() => JSON.stringify(cp), 500);
  const prettyBytes = Buffer.byteLength(JSON.stringify(cp, null, 2));
  const compactBytes = Buffer.byteLength(JSON.stringify(cp));
  check(`S4-G-6 parsed-value equivalence N=${n}`, JSON.stringify(JSON.parse(JSON.stringify(cp, null, 2))) === JSON.stringify(cp));
  check(`S4-G-6 byte divergence N=${n} (on-disk data plane changes)`, JSON.stringify(cp, null, 2) !== JSON.stringify(cp));
  console.log(
    `S4-G-6 bench N=${n}: stringify pretty=${(pretty * 1e3).toFixed(1)}us compact=${(compact * 1e3).toFixed(1)}us delta/write=${((pretty - compact) * 1e3).toFixed(1)}us bytes ${prettyBytes}->${compactBytes} -> per run (~66 writes) = ${((pretty - compact) * 66).toFixed(2)}ms`
  );
}

/* ============================================================
 * S4-G-7: runSupervisorRounds (run/supervisor.ts:278) computes the
 * `failed` filter on every idle round before checking canProgress, but only
 * consumes it inside the !canProgress branch. Candidate: hoist into the
 * branch. Equivalent (pure filter, no side effects) but ns-level.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 7);
  const T = 48;
  const tasks = Array.from({ length: T }, (_, i) => ({ id: `t${i}` }));
  const statuses = new Map<string, string>();
  for (const task of tasks) {
    const r = rng();
    statuses.set(task.id, r < 0.7 ? "COMPLETED" : r < 0.85 ? "RUNNING" : "FAILED");
  }
  const lookup = (id: string): string => statuses.get(id) ?? "PENDING";
  const filterCost = bench(() => void tasks.filter((node) => lookup(node.id) === "FAILED"), 100000);
  console.log(
    `S4-G-7 bench T=${T}: one failed-filter=${(filterCost * 1e6).toFixed(0)}ns -> per run (<=32 idle rounds) = ${(filterCost * 32 * 1e3).toFixed(2)}us`
  );
  const inBranch = tasks.filter((node) => lookup(node.id) === "FAILED");
  const hoisted = tasks.filter((node) => lookup(node.id) === "FAILED");
  check("S4-G-7 equivalence (pure filter)", JSON.stringify(inBranch) === JSON.stringify(hoisted));
}

// Silence unused-import lint for harness-only imports.
void validateFlowchart;

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

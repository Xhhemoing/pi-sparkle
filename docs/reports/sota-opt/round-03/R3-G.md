MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-G：运行时 / 监督 / 图 / 领域模型切片第三遍复查报告

**战役:** 全库持久 SOTA 优化 Round 3 / R3-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `aa41f02`
**分支:** `cursor/r3-g-runtime-third-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线（`4efee23`）
以来**逐字节未变**（`git diff 4efee23 aa41f02 -- src/run src/supervisor
src/graph src/domain`（扣除 A/B 区三文件）为空——R2 十区与 R3-A/B/C/D 均未
触碰本切片），R1-G 的逐文件收口、S1-G-1..9 与 S2-G-1..8 排除全部继承有效。
本轮在完整排除表（含 S3-C 已落地与 S3-A/B/C/D-* 新排除）之上第三次全量实际
读码、以新角度枚举，得到 5 个此前未点名的新候选（S3-G-1 … S3-G-5），全部经
理论 + 确定性仿真（seeded mulberry32，等价校验 / **行为发散反例** / 真实规模
基准，seeds `0x538301`/`0x538302` 两次独立运行等价与反例结论逐位一致、计时
抖动范围内稳定）裁决后淘汰：**2 个被反例证明非保行为**（S3-G-2 会改变损坏
checkpoint 浮出的错误消息前缀；S3-G-4 会把陈旧 checkpoint 当终态落盘，违反
崩溃恢复持久性契约），其余 3 个在真实规模是 ns~µs 级噪声（本轮最强合法候选
S3-G-1 全 run 上界 ~2.8~8.6ms，距落地线数十~数百 ms 仍差一个量级；S3-C 标尺
是 ~140–155ms）。未重开任何 X* / S1-* / S2-* / S3-A/B/C/D-* 条目。
X0-2/X0-4/X4-6/X4-7/X4-8/X4-9 维持排除未触碰；事件 schema 零 diff。唯一
超线性总量仍是 O(R×E) 的重复 `readAll`，其排除理由（S1-G-1：跨进程磁盘
事实源 + fail-closed 读校验契约）本轮第三次复核维持。本切片在其持久化与
调度契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部文件第三次实际读码，未依赖 R1-G/R2-G 的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S3-C 已落地与
  S3-C-1..3）→ round-03/PLAN.md → round-01/R1-G.md → round-02/R2-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1..9、S2-G-1..8 十七条
  全部不再提案；X4-6（Kahn queue.shift）、X4-7（isDuplicateFact）、X4-8
  （propagate/computeStatus 跨调用增量）、X4-9 直接跳过。本轮只探索**未被
  点名的新角度**：snapshot() 平坦记录 structuredClone→浅展开（S3-G-1）、
  checkpoint 双层校验去重（S3-G-2）、handleExecutionEvent 的 O(M²)
  copy+rescan（S3-G-3）、finish() 末次 persistCheckpoint 消除（S3-G-4）、
  isId 前缀模块级提升（S3-G-5）。
- **S1-G-1 遵守**：`readAll` 增量缓存未提案（跨进程磁盘事实源 + fail-closed
  读校验，本轮复核见 §3）。**S2-G-2 遵守**：`failurePathCompletedGraph`
  共享 `visiting` 语义未触碰。**S2-G-5 遵守**：每轮 `new ChildCoordinator`
  维持原样（确定性 id 流）。
- **X0-2 遵守**：`planTaskTopology`（`src/run/supervisor.ts`，无生产调用方）
  保持未接线。**X0-4 遵守**：`applyTrackingGate`/`nextTrackingSeq` 未触碰。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、payload 校验器、
  `validateEvent` 抛错消息与次序全部原样；CAS / 幂等键 / 确定性 id 流零 diff。
- 双 LCB 与双归因未触碰（本切片不含路由聚合面，天然满足）。不声称
  Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。不改阈值、权限、
  数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。

## 1. 规模与门槛基底（第三遍继承 + 本轮校准）

R1-G 已实测本切片规模：全部结构维度（节点 N、任务 T、轮次 R≤32、每轮事实、
消息 M、租约 L）为几十级且热点结构已全面 Map 化；**唯一增长维度是事件数 E**
（数百~千级），只被线性触碰且重复重读是刻意契约（S1-G-1）。R2-G 补充校准了
每轮 `persistCheckpoint` ≥2 次的 fsync 支配结构（整个 `leaseReadyNodes` 含
supervisor 构建在 N=64 时 <0.1ms）。代码逐字节未变，全部继承。

战役落地线同样继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S2-C ms 级、**S3-C ~140–155ms / 1.09–1.10×**——本轮直接标尺），
µs 级候选一律被否决过（S1-I-1 ~190µs、S2-G-8 全 run ~35µs、S2-D-4 ~116µs）。
本轮全部候选的合法收益上界是 **~2.8~8.6ms/run**（S3-G-1，N=24/64），两个
更大的候选（S3-G-2/4）根本不是合法收益——它们改行为。据此裁决。

本轮补充校准的一点新结构事实：`snapshot()`（`flowchart-supervisor.ts:957`）
是本切片 CPU 最贵的纯函数调用（N=24 实测 ~172~200µs、N=64 ~442~447µs，
structuredClone 支配），每轮被 `persistCheckpoint`/注入/审批路径调用 ~3 次，
全 run 上界 ~100 次——即整个 snapshot 面全 run 的 CPU 总量也只有 ~20~45ms，
且每次都伴随一次 fsync 原子写。这从上界层面封死了本切片一切"更快拷贝"类
候选：**即使把拷贝成本压到零也够不到落地线**。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-G-1 | `snapshot()` 对平坦记录 `FlowNodeRuntime`/`ActiveRoute` 的逐项 `structuredClone`（:959/:961）改浅展开 `{...runtime}`（字段全原始值，类型与 restore 校验双重保证） | 免 structuredClone 的序列化开销（单条实测 1.1µs vs 15ns） | ✅ JSON 逐位一致 + 无内部别名外泄 + 键序一致（两 seed 同判） | N=24 delta **28.2µs/call**、N=64 **75.8~86.1µs/call**；全 run（~100 次 snapshot）上界 **2.82~8.61ms** | 淘汰：距落地线一个量级；且把快照隔离性从"运行时保证"降为"类型平坦性约定"——未来任何嵌套字段悄然引入别名泄漏，风险换噪声 |
| S3-G-2 | `validateFlowchartCheckpointState`（`replay.ts:239`）对 definition/snapshot 各校验两遍（外层直验 + `restoreFlowchartSupervisor` 干跑内重验）→ 去掉一层 | 免每 checkpoint 一次 validateFlowchart + 一次快照校验 | ❌ **反例**：去掉外层后，损坏快照浮出的错误消息前缀从 `flowchart.snapshot: ...` 变为 `flowchart snapshot is not restorable: ...`——可观察错误面发散（两 seed 同判） | 去重上界 **34.4~35.2µs/checkpoint**；全 run（~66 次校验）**2.27~2.32ms** | 淘汰：**非保行为**（fail-closed 错误面是可观察契约，X3-3/X4-1 同域）+ 收益本身也是噪声，双重淘汰 |
| S3-G-3 | `handleExecutionEvent` 每 MESSAGE 拷贝 `[...seen, message]` 再全量重扫 `assertAtMostOneTerminal`（`child-coordinator.ts:650`）→ 调用点增量终结计数 | O(M²)→O(M)/attempt | ✅ 接受侧等价（无终结消息双方均通过） | M=12 实测 current **0.39~0.40µs**/attempt、增量 0.05µs，delta **0.35µs**/子任务尝试 | 淘汰：亚噪声（M 个位~十位级、每 attempt 一次）；且协议断言改内联计数会把公共协议契约的实现点私有化 |
| S3-G-4 | `finish()`（`flowchart-run.ts:524`）入口的 `persistCheckpoint` 在结算路径已于同轮写过 checkpoint 时跳过 | 免一次校验 + fsync 原子写 | ❌ **反例**：结算 append（RUN_COMPLETED 等）后 `lastEventId`/`status`/`updatedAt` 全部变化（实测 `evt_id0001`/RUNNING → `evt_id0002`/COMPLETED），跳过即把陈旧 RUNNING 态当终态落盘（两 seed 同判） | —（不是合法收益） | 淘汰：**非保行为**——违反崩溃恢复持久性契约（checkpoint 必须反映终态事件流）；"看似重复"的末次落盘正是终态可恢复性的实现点 |
| S3-G-5 | `isId`（`ids.ts:67`）每次成员检查构造 `` `${prefix}_` `` → 模块级前缀表（影响 `validateEvent` 每事件的 isEventId/isRunId/isTaskId） | 免每查一次模板串构造 | ✅ 全采样 + 边界串（空串/`evt_`/`evt_!bad`）判定逐位一致 | 单查 delta **32.4~34.0ns**；激进上界（100 readAll × 1000 事件 × ~4 id 检查）**12.97~13.62ms**/run | 淘汰：ns 级常数，激进外推也够不到落地线；与 S1-I-1（~190µs 被否）、S2-G-8（~35µs 被否）同类 |

## 3. 关键裁决细节

### S3-G-4：finish() 的末次 persistCheckpoint 不是重复，是终态持久性的实现点（本轮最重要发现）

`runFlowchartLoop` 的多个路径（lease 后、注入后、轮末）都会写 checkpoint，
`finish()` 入口（`flowchart-run.ts:525`）再写一次，表面看同轮内像重复落盘
（每次都是 validateCheckpoint + fsync 原子写，是本切片单次最贵操作之一）。
但结算路径在两次落盘之间**追加了终态事件**（RUN_COMPLETED / RUN_FAILED /
审批与注入结算），`materializeCheckpoint` 由事件流导出的 `lastEventId`、
`status`、`updatedAt` 全部变化。仿真用真实 `replayRun` +
`materializeCheckpoint` 复现：结算前 checkpoint 为
`lastEventId=evt_id0001, status=RUNNING`，结算后为
`lastEventId=evt_id0002, status=COMPLETED`。跳过末次落盘意味着进程若在
finish 后崩溃，磁盘上的 checkpoint 停在 RUNNING 且 lastEventId 落后于
events.jsonl——resume 语义与检查工具的可观察面全部发散。**任何"同轮已
checkpoint 即跳过"的条件消除都被本反例排除**；这与 S1-G-1（跨进程磁盘
事实源）是同一持久性契约的两面。

### S3-G-2：fail-closed 校验的错误消息前缀是可观察契约

`validateFlowchartCheckpointState`（`replay.ts:239`）确实对 definition 与
snapshot 各做两遍校验：外层直接调 `validateFlowchart` +
`validateFlowchartSupervisorSnapshot`，随后 `restoreFlowchartSupervisor`
干跑在构造函数与 restore() 内**再各跑一遍同样的校验**。纯 CPU 视角去重
一层是"免费"的（34~35µs/checkpoint）。但外层校验先于干跑抛错，其消息
前缀（`Invalid RunCheckpoint: flowchart.snapshot: ...`）与干跑路径的前缀
（`Invalid RunCheckpoint: flowchart snapshot is not restorable: ...`）
不同——仿真对同一份损坏快照（非法 node state）实测两条路径浮出不同消息。
损坏 checkpoint 的诊断消息是 fail-closed 防线的可观察面（测试与操作手册
依赖它定位损坏层），去重即改行为。且 2.3ms/run 的上界本身也是噪声。
双重淘汰，反例入库。

### S3-G-1：本轮最强合法候选为何仍差一个量级

`snapshot()` 对 runtime/activeRoutes 两个 Map 的逐项 `structuredClone` 是
本切片纯 CPU 最贵点（单条 clone ~1.1µs vs 浅展开 ~15ns，N=64 时整个
snapshot ~442~447µs）。`FlowNodeRuntime` 与 `ActiveRoute` 字段全为原始值
（类型定义保证，restore 侧 `validateNodeRuntime`/`validateActiveRoute`
再次强制），浅展开在当前类型下值等价且不泄漏内部别名——仿真三重验证
（JSON 逐位、别名检查、键序）两 seed 全过。但落地被两条独立理由否决：
(1) **规模**——delta 28.2µs/call（N=24）~ 75.8~86.1µs/call（N=64），全 run
~100 次 snapshot 的上界 2.82~8.61ms，距数十~数百 ms 落地线一个量级，且
每次 snapshot 伴随 fsync 落盘（I/O 支配）；(2) **防御面**——structuredClone
的深拷贝语义是"未来嵌套字段也不外泄别名"的运行时保证，浅展开把这一保证
降级为类型平坦性约定，任何后续给 runtime 加嵌套字段的改动都会悄然引入
共享可变状态。风险换噪声，否决。

### 保行为面复核（第三遍，在 R1-G/R2-G 收口之上）

- **O(R×E) 重复 `readAll` 维持排除**（S1-G-1）：第三次复核 `finish()` 三连读
  与每轮重读之间的跨进程追加窗口（CLI answer/pause 独立进程写同一
  events.jsonl），复用即缓存即 X1-1。维持。
- **checkpoint 写前自检维持**（X3-3/X4-1 同域）：S3-G-2 的反例进一步证明
  双层校验的错误面有各自的可观察角色，整条防线未碰。
- **调度/resume/lease/join**：`planRound` 三段式、孤儿 lease 恢复链、
  `joinStatus` quorum 计数、`assertWaiterInvariant`、共享 `visiting` 的
  失败恢复图语义（S2-G-2）——零 diff。
- **确定性 id 流**：每轮 `new ChildCoordinator`（S2-G-5）、`createId` 的
  generate 消费次序、事件 id 派生——零 diff。

### 逐文件收口（第三遍新视角补充，R1-G/R2-G 收口之上）

| 文件 | 第三遍新检查点 | 结论 |
| --- | --- | --- |
| `supervisor/flowchart-supervisor.ts` | 见 S3-G-1；`setRuntime`（:351）与 restore（:358）的 clone 是写侧隔离、同 S3-G-1 规模论证不另立；`propagate`/`computeStatus` = X4-8 维持 | 无候选落地 |
| `run/replay.ts` | 见 S3-G-2；`replayRun` 单遍状态机维持；`materializeCheckpoint` O(1) 派生 | 无候选落地 |
| `run/flowchart-run.ts` | 见 S3-G-4；`hasOpenWaiting`/`hasEvent`/`hasUnmatchedPause` 各 O(E) 线性扫但每 run 常数次、E 千级下 µs 级；`applyLearnedToFlowchart` 启动一次性 | 无候选落地 |
| `run/child-coordinator.ts` | 见 S3-G-3；`childStores` Map 缓存维持；`answerQuestion` find+findIndex（S1-B-4 同类）维持 | 无候选落地 |
| `run/supervisor.ts` | `reconstructSupervisorState` 单遍重放维持；每轮 coordinator = S2-G-5 维持；`recordStatus` 审计语义维持 | 无候选 |
| `run/scheduler.ts` | `isExpired` = S2-G-8 维持；`planRound` O(T) 维持 | 无候选 |
| `run/event-store.ts` / `episode-store.ts` | append 写前 validateEvent 是写侧 fail-closed；readAll = S1-G-1 第三次维持 | 无候选 |
| `run/events.ts` | 见 S3-G-5（id 检查的调用方）；`isBehaviorDistribution` 每事件 Set 载荷依赖维持；schema 零碰 | 无候选落地 |
| `run/inspection.ts` | 两遍扫描 = S2-G-6 维持；`findChild` 回退链一次性 CLI 路径 | 无候选 |
| `run/checkpoint-store.ts` / `pause-controller.ts` / `injection.ts` | tmp+fsync+rename 原子写契约（S3-G-4 反例佐证其不可省）；一次性请求路径 | 无候选 |
| `run/coordinator.ts` / `child-grounding.ts` / `child-prompt.ts` / `flowchart-executor.ts` / `episode-bind.ts` | splice/filter = S1-G-6 维持；O(输入) 组装每子任务一次；`episodeIdFromEvents` 反向早退维持 | 无候选 |
| `supervisor/ledger.ts` | 双 `isDuplicateFact` = X4-7 维持；`advanceLedgerRound` 拷贝 R≤32 × 事实几十级噪声 | 无候选 |
| `supervisor/flowchart-snapshot.ts` | 校验器 = S3-G-2 反例的另一半（干跑内层）；`isOneOf` 表长 ≤7 | 无候选落地 |
| `graph/validate.ts` / `readiness.ts` / `judge.ts` / `compile-children.ts` | Kahn = X4-6 维持；一次性接受路径；judge 证据个位 | 无候选 |
| `domain/ids.ts` | 见 S3-G-5；`createId` 每 run 几十次构造噪声 | 无候选落地 |
| `domain/state.ts` / `flowchart.ts` | BFS = S2-G-4 维持；`validateJoin` = S1-G-4 维持；DFS 环检查一次性 | 无候选 |
| `domain/` 其余 13 文件 | 模块级正则 + O(1) 谓词 + 一次性校验器；`isIsoTimestamp` = X1-3 域 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-G 基线 `4efee23` 起经
R2-G、本轮 R3-G 三遍复查累计零代码改动，逐字节一致。

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
`0x538301`/`0x538302` 两次独立运行等价/反例结论逐位一致、计时抖动范围内
稳定）：

```text
seed=0x538301
S3-G-1 bench N=24: whole-snapshot current=199.2us variant(flat-spread)=171.0us delta/call=28.2us (real sv.snapshot()=172.3us) -> per-run upper bound (~100 snapshot calls) = 2.82ms
S3-G-1 anchor: one FlowNodeRuntime structuredClone=1118ns spread=15ns
S3-G-1 bench N=64: whole-snapshot current=519.2us variant(flat-spread)=433.1us delta/call=86.1us (real sv.snapshot()=441.5us) -> per-run upper bound (~100 snapshot calls) = 8.61ms
S3-G-1 anchor: one FlowNodeRuntime structuredClone=1111ns spread=16ns
S3-G-2 anchor N=24: whole validateFlowchartCheckpointState=356.4us; one validateFlowchart=11.3us; one validateFlowchartSupervisorSnapshot=23.1us -> dedup saving upper bound/checkpoint=34.4us; per run (~66 checkpoint validations) = 2.27ms
S3-G-2 error-path current : Invalid RunCheckpoint: flowchart.snapshot: Invalid FlowchartSupervisorSnapshot: nodes.n0.state must be a known FlowNodeState
S3-G-2 error-path variant : Invalid RunCheckpoint: flowchart snapshot is not restorable: Invalid FlowchartSupervisorSnapshot: nodes.n0.state must be a known FlowNodeState
S3-G-3 bench M=12: current O(M^2) copy+rescan=0.39us/attempt incremental=0.05us/attempt delta=0.35us per child attempt
S3-G-4 counterexample: checkpoint before settle lastEventId=evt_id0001 status=RUNNING; after settle lastEventId=evt_id0002 status=COMPLETED (final persistCheckpoint is not redundant)
S3-G-5 bench: isEventId current=65.3ns hoisted-prefix=32.9ns delta/lookup=32.4ns -> per-run upper bound (100 readAll x 1000 events x ~4 id checks) = 12.97ms
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x538302
S3-G-1 bench N=24: whole-snapshot current=198.9us variant(flat-spread)=170.7us delta/call=28.2us (real sv.snapshot()=200.0us) -> per-run upper bound (~100 snapshot calls) = 2.82ms
S3-G-1 bench N=64: whole-snapshot current=513.4us variant(flat-spread)=437.6us delta/call=75.8us (real sv.snapshot()=446.5us) -> per-run upper bound (~100 snapshot calls) = 7.58ms
S3-G-2 anchor N=24: dedup saving upper bound/checkpoint=35.2us; per run (~66 checkpoint validations) = 2.32ms
S3-G-2 error-path divergence: 与 seed 1 逐位一致
S3-G-3 bench M=12: delta=0.35us per child attempt
S3-G-4 counterexample: 与 seed 1 逐位一致
S3-G-5 bench: delta/lookup=34.0ns -> per-run upper bound = 13.62ms
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-G-1 | `snapshot()` 对平坦记录 `FlowNodeRuntime`/`ActiveRoute` 的 `structuredClone` 改浅展开 | 等价（JSON/别名/键序三重验证过），但全 run 上界仅 2.82~8.61ms（N=24/64），距落地线一个量级且被 fsync 支配；并把快照隔离性从运行时保证降为类型平坦性约定，未来嵌套字段会悄然引入别名泄漏 |
| S3-G-2 | `validateFlowchartCheckpointState` 外层直验与 restore 干跑内重验的去重 | **非保行为**：损坏快照浮出的错误消息前缀发散（`flowchart.snapshot:` vs `flowchart snapshot is not restorable:`，实测同一损坏输入两路径不同消息）；收益上界 ~35µs/checkpoint、~2.3ms/run 本身也是噪声 |
| S3-G-3 | `handleExecutionEvent` 的 `[...seen, message]` + `assertAtMostOneTerminal` 全量重扫改增量终结计数 | delta ~0.35µs/子任务尝试（M=12），亚噪声；且把公共协议断言的实现点私有化为调用点内联计数 |
| S3-G-4 | `finish()` 入口 `persistCheckpoint` 在同轮已 checkpoint 时跳过 | **非保行为**：结算 append 后 `lastEventId`/`status`/`updatedAt` 全部变化（实测 RUNNING→COMPLETED），跳过即把陈旧态当终态落盘，违反崩溃恢复持久性契约（S1-G-1 同一契约的写侧） |
| S3-G-5 | `isId` 每查构造 `` `${prefix}_` `` 改模块级前缀表 | ~32~34ns/查，激进外推（100 readAll × 1000 事件 × 4 检查）也仅 ~13ms/run；与已否决的 S1-I-1（~190µs）、S2-G-8（~35µs）同类 |

重开条件：S3-G-2/4 需先做出**行为变更决策**（分别为 checkpoint 校验错误面
的显式重定义、checkpoint 落盘时机契约的显式重定义），届时属功能/语义工作
而非保行为优化；S3-G-1 若 live flowchart 规模增长 ≥2 个量级（数千节点、
snapshot 频次同步放大）**且** checkpoint 写路径先移除 fsync 支配（本身是
X 级契约），可凭本报告等价三重验证与基准重开；S3-G-5 若事件量增长使
`validateEvent` 进入百 ms 级可凭等价证据重开；S3-G-3 为 ns 级常数，无现实
重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file> <seed>`（依赖已
装）。seeds：`0x538301`、`0x538302`（其余段确定性构造，无随机性）。

```ts
/**
 * R3-G deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S3-G-1 .. S3-G-5 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed>
 */
import { performance } from "node:perf_hooks";
import { createTaskId, createEventId, isEventId, isRunId, isTaskId } from "/workspace/src/domain/ids.js";
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
  restoreFlowchartSupervisor,
  type ActiveRoute,
  type FlowchartSupervisor,
  type FlowchartSupervisorSnapshot,
  type FlowNodeRuntime
} from "/workspace/src/supervisor/flowchart-supervisor.js";
import {
  snapshotValidationRouter,
  validateFlowchartSupervisorSnapshot
} from "/workspace/src/supervisor/flowchart-snapshot.js";
import { materializeCheckpoint, replayRun, validateFlowchartCheckpointState } from "/workspace/src/run/replay.js";
import { assertAtMostOneTerminal, type AgentMessage } from "/workspace/src/protocol/v1.js";
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

const SEED = Number.parseInt(process.argv[2] ?? "0x538301", 16) || 0x538301;
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

/* ============================================================
 * S3-G-1: snapshot() clones flat records (FlowNodeRuntime, ActiveRoute)
 * with structuredClone; candidate replaces those two per-item clones with
 * shallow spreads ({...runtime}) which are value-identical for records whose
 * fields are all primitives (guaranteed by the FlowNodeRuntime/ActiveRoute
 * types and enforced on restore by validateNodeRuntime/validateActiveRoute).
 * Deep members (decisions, ledger, pendingApproval, roundEvent) keep
 * structuredClone. Equivalence + isolation + faithful whole-snapshot bench.
 * ============================================================ */
for (const n of [24, 64]) {
  const sv = driveToCompletion(n);
  const snap = sv.snapshot();

  // Rebuild internal-shaped state from the snapshot to bench both builders
  // over the same Maps the implementation iterates.
  const runtimeMap = new Map<string, FlowNodeRuntime>(Object.entries(snap.nodes));
  const routesMap = new Map<string, ActiveRoute>(Object.entries(snap.activeRoutes));
  const userDecisionsMap = new Map<string, string | boolean>(Object.entries(snap.userDecisions));
  const factsMap = new Map<string, string | number | boolean>(Object.entries(snap.facts));
  const decisions = snap.decisions;
  const ledger = snap.ledger;
  const roundEvent = snap.pendingRoundEvent;
  const approvedActionIds = [...snap.approvedActionIds];

  const buildCurrent = (): FlowchartSupervisorSnapshot => {
    const nodes: Record<string, FlowNodeRuntime> = {};
    for (const [id, runtime] of runtimeMap) nodes[id] = structuredClone(runtime);
    const activeRoutes: Record<string, ActiveRoute> = {};
    for (const [id, route] of routesMap) activeRoutes[id] = structuredClone(route);
    const userDecisions: Record<string, string | boolean> = {};
    for (const [id, value] of userDecisionsMap) userDecisions[id] = value;
    const facts: Record<string, string | number | boolean> = {};
    for (const [key, value] of factsMap) facts[key] = value;
    return {
      flowchartId: snap.flowchartId,
      status: snap.status,
      nodes,
      decisions: structuredClone(decisions) as FlowchartSupervisorSnapshot["decisions"],
      activeRoutes,
      approvedActionIds: [...approvedActionIds],
      userDecisions,
      facts,
      ledger: structuredClone(ledger),
      pendingRoundEvent: structuredClone(roundEvent),
      remainingTimeMs: snap.remainingTimeMs ?? Number.MAX_SAFE_INTEGER
    };
  };
  const buildVariant = (): FlowchartSupervisorSnapshot => {
    const nodes: Record<string, FlowNodeRuntime> = {};
    for (const [id, runtime] of runtimeMap) nodes[id] = { ...runtime };
    const activeRoutes: Record<string, ActiveRoute> = {};
    for (const [id, route] of routesMap) activeRoutes[id] = { ...route };
    const userDecisions: Record<string, string | boolean> = {};
    for (const [id, value] of userDecisionsMap) userDecisions[id] = value;
    const facts: Record<string, string | number | boolean> = {};
    for (const [key, value] of factsMap) facts[key] = value;
    return {
      flowchartId: snap.flowchartId,
      status: snap.status,
      nodes,
      decisions: structuredClone(decisions) as FlowchartSupervisorSnapshot["decisions"],
      activeRoutes,
      approvedActionIds: [...approvedActionIds],
      userDecisions,
      facts,
      ledger: structuredClone(ledger),
      pendingRoundEvent: structuredClone(roundEvent),
      remainingTimeMs: snap.remainingTimeMs ?? Number.MAX_SAFE_INTEGER
    };
  };

  const a = buildCurrent();
  const b = buildVariant();
  check(`S3-G-1 equivalence N=${n}: same JSON value`, JSON.stringify(a) === JSON.stringify(b));
  // Isolation: variant output must not alias internal map values.
  let aliased = false;
  for (const [id, runtime] of runtimeMap) {
    if (b.nodes[id] === runtime) aliased = true;
  }
  check(`S3-G-1 isolation N=${n}: shallow spread does not alias internal state`, !aliased);
  // Key order (JSON already covers it, but assert explicitly on one node).
  const firstId = Array.from(runtimeMap.keys())[0]!;
  check(
    `S3-G-1 key order N=${n}`,
    JSON.stringify(Object.keys(a.nodes[firstId]!)) === JSON.stringify(Object.keys(b.nodes[firstId]!))
  );

  const cur = bench(() => buildCurrent(), 3000);
  const varc = bench(() => buildVariant(), 3000);
  const realSnapshot = bench(() => sv.snapshot(), 3000);
  const perRun = (cur - varc) * 100; // ~3 snapshot() calls/round x 32 rounds + settle ~= 100 calls
  console.log(
    `S3-G-1 bench N=${n}: whole-snapshot current=${(cur * 1e3).toFixed(1)}us variant(flat-spread)=${(varc * 1e3).toFixed(1)}us delta/call=${((cur - varc) * 1e3).toFixed(1)}us (real sv.snapshot()=${(realSnapshot * 1e3).toFixed(1)}us) -> per-run upper bound (~100 snapshot calls) = ${perRun.toFixed(2)}ms`
  );

  const oneRuntime = runtimeMap.get(firstId)!;
  const clone1 = bench(() => structuredClone(oneRuntime), 200000);
  const spread1 = bench(() => ({ ...oneRuntime }), 200000);
  console.log(
    `S3-G-1 anchor: one FlowNodeRuntime structuredClone=${(clone1 * 1e6).toFixed(0)}ns spread=${(spread1 * 1e6).toFixed(0)}ns`
  );
}

/* ============================================================
 * S3-G-2: validateFlowchartCheckpointState validates the definition and the
 * snapshot each TWICE per checkpoint: once directly (validateFlowchart /
 * validateFlowchartSupervisorSnapshot) and once again inside the
 * restoreFlowchartSupervisor dry-run (the constructor re-runs
 * validateFlowchart and restore() re-runs validateFlowchartSupervisorSnapshot).
 * Candidate: dedup one layer. Anchors the avoidable cost and demonstrates
 * that dropping the outer layer observably changes which error message
 * surfaces for a malformed snapshot (error-path divergence).
 * ============================================================ */
{
  const n = 24;
  const sv = driveToCompletion(n);
  const snap = sv.snapshot();
  const definition = chainFlowchart(n);
  const limits = { maxConcurrentNodes: 4, maxConsecutiveStalls: 3, remainingTimeMs: Number.MAX_SAFE_INTEGER };
  const state = { definition, snapshot: snap, limits };

  const whole = bench(() => validateFlowchartCheckpointState(state), 1000);
  const defCost = bench(() => validateFlowchart(definition), 3000);
  const snapCost = bench(() => validateFlowchartSupervisorSnapshot(snap), 3000);
  const dedupSaving = defCost + snapCost; // one avoidable layer per checkpoint
  console.log(
    `S3-G-2 anchor N=${n}: whole validateFlowchartCheckpointState=${(whole * 1e3).toFixed(1)}us; one validateFlowchart=${(defCost * 1e3).toFixed(1)}us; one validateFlowchartSupervisorSnapshot=${(snapCost * 1e3).toFixed(1)}us -> dedup saving upper bound/checkpoint=${(dedupSaving * 1e3).toFixed(1)}us; per run (~66 checkpoint validations) = ${(dedupSaving * 66).toFixed(2)}ms`
  );

  // Error-path divergence: malformed snapshot (invalid node state).
  const malformed = structuredClone(snap) as Record<string, unknown>;
  (malformed.nodes as Record<string, Record<string, unknown>>)["n0"]!.state = "NOT_A_STATE";
  let currentMessage = "";
  try {
    validateFlowchartCheckpointState({ definition, snapshot: malformed, limits });
  } catch (error) {
    currentMessage = (error as Error).message;
  }
  // Variant that drops the outer snapshot validation and relies on the
  // restore dry-run alone (re-implemented from replay.ts verbatim minus the
  // outer call): the surfaced message prefix differs.
  let variantMessage = "";
  validateFlowchart(definition);
  // outer validateFlowchartSupervisorSnapshot skipped by the variant
  try {
    restoreFlowchartSupervisor(
      { flowchart: definition, router: snapshotValidationRouter(), limits },
      malformed as unknown as FlowchartSupervisorSnapshot
    );
  } catch (error) {
    variantMessage = `Invalid RunCheckpoint: flowchart snapshot is not restorable: ${(error as Error).message}`;
  }
  console.log(`S3-G-2 error-path current : ${currentMessage}`);
  console.log(`S3-G-2 error-path variant : ${variantMessage}`);
  check(
    "S3-G-2 divergence demonstrated (dedup changes surfaced error message)",
    currentMessage !== variantMessage && currentMessage !== "" && variantMessage !== ""
  );
}

/* ============================================================
 * S3-G-3: handleExecutionEvent copies [...seen, message] per MESSAGE and
 * assertAtMostOneTerminal rescans the whole history -> O(M^2) per attempt.
 * Candidate: incremental terminal counter at the call site. Anchor the total
 * pattern cost at realistic message volume (the protocol scan itself is the
 * implementation point of a public protocol contract).
 * ============================================================ */
{
  const rng = mulberry32(SEED);
  const M = 12; // generous per-attempt message volume (questions + peer mail)
  const mkMessage = (i: number, type: "QUESTION" | "PEER_MESSAGE"): AgentMessage =>
    ({ type, id: `msg_${i}`, runId: "run_x", taskId: "tsk_x", from: "agt_x", body: `m${i}` }) as unknown as AgentMessage;
  const stream: AgentMessage[] = [];
  for (let i = 0; i < M; i += 1) stream.push(mkMessage(i, rng() < 0.5 ? "QUESTION" : "PEER_MESSAGE"));

  const currentPattern = (): void => {
    const seen: AgentMessage[] = [];
    for (const message of stream) {
      assertAtMostOneTerminal([...seen, message]);
      seen.push(message);
    }
  };
  const incrementalPattern = (): void => {
    const seen: AgentMessage[] = [];
    let terminals = 0;
    for (const message of stream) {
      if ((message as { type: string }).type === "TASK_RESULT") {
        terminals += 1;
        if (terminals > 1) throw new Error("Duplicate terminal TASK_RESULT message");
      }
      seen.push(message);
    }
  };
  // Equivalence on accept side (no terminal in stream: both accept).
  let currentThrew = false;
  let incrementalThrew = false;
  try { currentPattern(); } catch { currentThrew = true; }
  try { incrementalPattern(); } catch { incrementalThrew = true; }
  check("S3-G-3 equivalence (accept)", currentThrew === incrementalThrew);

  const cur = bench(currentPattern, 100000);
  const inc = bench(incrementalPattern, 100000);
  console.log(
    `S3-G-3 bench M=${M}: current O(M^2) copy+rescan=${(cur * 1e3).toFixed(2)}us/attempt incremental=${(inc * 1e3).toFixed(2)}us/attempt delta=${((cur - inc) * 1e3).toFixed(2)}us per child attempt`
  );
}

/* ============================================================
 * S3-G-4: eliminating the finish()-internal persistCheckpoint after a
 * settlement path already checkpointed in the same iteration.
 * COUNTEREXAMPLE: the settlement appends (RUN_COMPLETED et al.) and the
 * wall clock advances, so the final checkpoint differs in lastEventId,
 * status and updatedAt -- skipping it persists stale state.
 * ============================================================ */
{
  let tick = 0;
  const nextIso = (): IsoTimestamp => new Date(1756000000000 + (tick += 1000)).toISOString() as IsoTimestamp;
  let idn = 0;
  const gen = () => `id${String((idn += 1)).padStart(4, "0")}`;
  const mk = (type: Event["type"], payload: unknown): Event =>
    ({
      id: createEventId(gen),
      schemaVersion: 1,
      occurredAt: nextIso(),
      runId: "run_s3g4",
      type,
      actor: "flowchart-supervisor",
      payload
    }) as Event;
  const events: Event[] = [mk("RUN_STARTED", {})];
  const before = materializeCheckpoint(replayRun(events), nextIso());
  events.push(mk("RUN_COMPLETED", {}));
  const after = materializeCheckpoint(replayRun(events), nextIso());
  console.log(
    `S3-G-4 counterexample: checkpoint before settle lastEventId=${before.lastEventId} status=${before.status}; after settle lastEventId=${after.lastEventId} status=${after.status} (final persistCheckpoint is not redundant)`
  );
  check(
    "S3-G-4 divergence demonstrated (final checkpoint differs)",
    before.lastEventId !== after.lastEventId && before.status !== after.status && before.updatedAt !== after.updatedAt
  );
}

/* ============================================================
 * S3-G-5: isId builds `${prefix}_` per membership check inside validateEvent
 * (isEventId/isRunId/isTaskId per event). Candidate: module-level prefix
 * table. Equivalence + per-lookup bench + per-run upper bound.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 1);
  const EVENT_PREFIX = "evt_";
  const hoistedIsEventId = (value: unknown): boolean =>
    typeof value === "string" && value.startsWith(EVENT_PREFIX) && /^[A-Za-z0-9_-]{1,64}$/.test(value.slice(EVENT_PREFIX.length));
  const samples: string[] = [];
  for (let i = 0; i < 4096; i += 1) {
    const r = rng();
    if (r < 0.85) samples.push(`evt_${Math.floor(rng() * 1e9).toString(36)}`);
    else if (r < 0.95) samples.push(`run_${Math.floor(rng() * 1e9).toString(36)}`);
    else samples.push("not an id");
  }
  for (const s of [...samples.slice(0, 64), "evt_", "evt_!bad", "", "evt_ok"]) {
    check("S3-G-5 equivalence", isEventId(s) === hoistedIsEventId(s), s);
  }
  let sink = 0;
  const cur = bench(() => {
    for (const s of samples) if (isEventId(s)) sink += 1;
  }, 2000);
  const hoisted = bench(() => {
    for (const s of samples) if (hoistedIsEventId(s)) sink += 1;
  }, 2000);
  const deltaNs = ((cur - hoisted) / samples.length) * 1e6;
  console.log(
    `S3-G-5 bench: isEventId current=${((cur / samples.length) * 1e6).toFixed(1)}ns hoisted-prefix=${((hoisted / samples.length) * 1e6).toFixed(1)}ns delta/lookup=${deltaNs.toFixed(1)}ns -> per-run upper bound (100 readAll x 1000 events x ~4 id checks) = ${((deltaNs * 4e5) / 1e6).toFixed(2)}ms [sink=${sink}]`
  );
  void isRunId;
  void isTaskId;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

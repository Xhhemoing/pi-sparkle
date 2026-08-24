MODEL_SLUG=claude-fable-5-thinking-xhigh

# R6-G：运行时 / 监督 / 图 / 领域模型切片第六遍复查报告

**战役:** 全库持久 SOTA 优化 Round 6 / R6-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `859171e`（含 S6-C 落地与
S6-A/B/C/D、S5-F、S5-I-1 各区排除/落地完整合入）
**分支:** `cursor/r6-g-runtime-sixth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线
（`4efee23`）以来**逐字节未变**（`git diff 4efee23 859171e -- src/run
src/supervisor src/graph src/domain` 为空——S6-C 只动
`src/routing/offline-logit.ts`，S5-F/S5-I-1 与 S6-A/B/D 均在切片外），
R1-G~R5-G 五遍收口与 S1-G-1..9、S2-G-1..8、S3-G-1..5、S4-G-1..7、
S5-G-1..6 共三十五条排除全部继承有效。本轮在完整排除表（含 S6-A/B/C/D
新行）之上第六次全量实际读码、以"相邻重读穿线复用 / persist 时机合并 /
校验器替换 / 同 store 追加入队重叠"四个未点名角度枚举，得到 7 个新候选
（S6-G-1 … S6-G-7），全部经理论 + 确定性仿真（seeded mulberry32，等价
校验 / **行为发散反例** / 真实规模基准，seeds `0x669061`/`0x669062` 两次
独立运行等价与反例结论逐位一致、计时抖动范围内稳定）裁决后淘汰：
**4 个被反例/契约封死**——本轮最重要发现是本切片仅剩的两类"看似冗余"
结构全是承重契约：(a) **相邻重读是终端一致性 / 证据边界屏障**——磁盘是
跨进程事实源（S1-G-1），外部 cancel/answer/pause CLI 的追加可落在任意
两次 readAll 之间；`finish()` 三连读复用首读的变体在反例中把已取消的 run
报成陈旧 RUNNING、**完全跳过 episode 结算**（现实现重读得 CANCELLED、
正确结算 ABANDONED），S6-G-1/S6-G-2/S6-G-7 三个端点同机制收口；
(b) **每轮租约后 + 应用后双 `persistCheckpoint` 是恢复窗口契约**——节点
执行（child LLM，秒~分钟级）是最长阶段、执行中崩溃是常态恢复点，去掉
租约后 persist 的变体在崩溃反例中 resume 重路由**全部**已租约节点：重复
MODEL_ROUTED 落日志、事件 id 流发散、子任务重复执行、learned-routing
归因重复计数。**本轮唯一名义进入十 ms 带的候选（S6-G-6，
14.9~22.1ms/run）恰好被最强契约封死。** 2 个合法候选真实规模不达线：
S6-G-3（checkpoint 校验去重的 S3-G-2 互补方向 + N=48 重标定，两层合计
名义仅 3.4~4.2ms/run）、S6-G-5（同 store 追加改入队重叠，等价成立但
delta 跨 seed +2.1/−0.5µs/事件**符号翻转**＝纯测量噪声）。S6-G-4
（`isIsoTimestamp` 的 `Date.parse` 换手写日历校验）被**双向发散**反例
证明等价不可行（13 月被 regex-only 放行；2 月 30 日被 V8 回卷语义接受、
严格日历校验反而拒绝），且份额上限 3.4~3.6ms/run。未重开任何 X* /
S1-* / S2-* / S3-* / S4-* / S5-* / S6-* 条目；事件 schema 零 diff。
第六遍结论与 R5-G 一致并加固：本切片每 run 持久化预算（实测 readAll
地板 37.8~43.0ms + checkpoint 写地板 ~31~46ms，合计 ~69~89ms）是
**契约 / I-O 地板，不是可优化计算**。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部 45 文件第六次实际读码，未依赖前五轮的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S6-A-1..3、
  S6-B-1..5、S6-C-1..7、S6-D-1..5 新排除）→ round-06/PLAN.md →
  round-01/R1-G.md → … → round-05/R5-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1..9、S2-G-1..8、
  S3-G-1..5、S4-G-1..7、S5-G-1..6 三十五条全部不再提案；X0-1/X0-2、
  X4-6..8、X1-1/X1-3 直接跳过；S6-A/B/C/D 各区新行核对不重叠（A：
  gate-apply/from-child 守卫，B：model-router，C：routing lin-alg，D：
  registry/promotion，均在切片外或不同端点）。本轮只探索**未被点名的
  新角度**：`finish()` 三连读穿线（S6-G-1）、resume 双读复用（S6-G-2）、
  checkpoint 双层校验的内层方向（S6-G-3）、时戳校验器替换（S6-G-4）、
  同 store 追加入队重叠（S6-G-5）、租约后 persist 消除（S6-G-6）、
  每子任务 readAll 喂门控的增量化（S6-G-7）。
- **与近邻 ID 的边界**：S6-G-1/2/7 不是 S1-G-1（readAll **增量缓存**，
  读的实现方式）也不是 S2-J-11（waitForClarification 双读内存镜像）的
  重提——它们是"相邻调用点**穿线复用一次读的结果**"（读的次数），R3-G
  保行为复核曾点名 finish() 三连读属"复用即缓存即 X1-1"但从未赋 ID、
  也从未给出行为发散反例；本轮以独立反例（外部 RUN_CANCEL_REQUESTED
  落在相邻读间 → episode 结算被跳过）首次显式收口。S6-G-3 不重开
  S3-G-2——S3-G-2 的反例封死的是"去掉**外层**直验"（错误消息前缀发散
  `flowchart.snapshot:` vs `flowchart snapshot is not restorable:`）；
  本条裁决其互补方向"去掉**内层** restore 重验"（restore 与真实 resume
  路径共享实现，内层校验即可恢复性屏障本体），并在 N=48 重标定两层
  合计名义上界，结论维持该行排除。S6-G-4 与 S1-G-3（EVENT_TYPES
  includes→Set）同属 validateEvent 微份额家族、与 X1-3 同属"非逐位一致
  替代"原则域，但 `Date.parse` 端点从未被独立赋 ID。S6-G-5 不是 S5-G-4
  （**跨 store** 父/子文件 Promise.all 重叠，被崩溃前缀反例封死）——
  本条是**同 store** 入队重叠，EventStore 内部队列使等价成立，也正因
  队列串行化 I/O 而零收益；两条合起来把"追加重叠"在同店/跨店两个维度
  全部收口。S6-G-6 与 S3-G-4（finish() 跳过**末次** persist）、S4-G-2
  （写侧校验跳过）相邻但端点不同——本条是**每轮中段**"租约后 persist"
  的时机合并，恢复窗口反例是新的。
- **S1-G-1 遵守**：`readAll` 增量缓存未提案（跨进程磁盘事实源 +
  fail-closed 读校验，第六次复核维持；本轮 S6-G-1 反例给出该契约在
  **终端一致性**维度的直接佐证——陈旧读会把取消结算整个跳过）。
  **S3-G-4/S4-G-2/S5-G-1 遵守**：写侧校验、末次落盘、每写 mkdir 全部
  未触碰。**S2-G-5/S4-G-1/S5-G-4/S5-G-5 遵守**：确定性 id 流、事件
  次序、跨 store 追加次序、逐消息落盘全部未触碰——本轮 S6-G-6 反例把
  该契约族在 **checkpoint 时机**维度的剩余角度也收口入库。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、payload 校验器、
  `validateEvent` 抛错消息与次序全部原样；CAS / 幂等键 / 确定性 id 流
  零 diff。双 LCB 与双归因未触碰（本切片不含路由聚合面，天然满足）。
  不声称 Outcome-supported、不关 Checkpoint F。不改阈值、权限、数据面
  契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，仿真脚本未入库（完整源码见附录）；
  lint 本就全绿，未触碰任何旧仿真脚本。

## 1. 规模与门槛基底（第六遍继承 + 本轮校准）

R1-G 已实测本切片规模：全部结构维度（节点 N、任务 T、轮次 R≤32、每轮
事实、消息 M、租约 L）为几十级且热点结构已全面 Map 化；唯一增长维度是
事件数 E（数百~千级）。R2-G 校准了每轮 `persistCheckpoint` ≥2 次的
fsync 支配结构；R3-G 校准 snapshot 面 CPU 上界；R4-G 证明唯一秒级墙钟
候选（RUNNING 节点并行）被确定性契约封死；R5-G 证明持久化层三个"看似
浪费"点（每写 mkdir、每读复验、逐条落盘）全是承重 fail-safe。代码逐
字节未变，全部继承。战役落地线同样继承：已落地项在几十~百 ms 级或
复杂度类下降（J1 2770×、S1-C ~450ms/fit、S3-C ~140–155ms、S5-C 秒级、
S6-C +42.5~54.0ms——直接标尺）。本轮响应调度指令"recheck the per-run
floor"，新增两点结构校准：

1. **每 run 持久化地板首次全量标定**。以 E=300 真实混合负载（RUN_CREATED
   /AGENT_EVENT/TASK_STATUS_CHANGED/TASK_RETRY/LEDGER_UPDATED，经真实
   EventStore 落盘）实测：`readAll` 全谱（磁盘读 + JSON.parse + 逐事件
   `validateEvent`）541~614µs/读，持久化路径 ~70 次读 →
   **37.8~43.0ms/run**；checkpoint 原子写全谱（validate + stringify +
   open + write + fsync + rename，N=48 流程图）467~691µs/写，~66 次 →
   **~31~46ms/run**。合计 **~69~89ms/run** 即本切片的持久化预算，其中
   每一项都被某条排除的反例证明承重：readAll 重复读＝跨进程事实源 +
   防篡改复验（S1-G-1/S5-G-2/S6-G-1）、checkpoint 写侧校验 + 末次落盘 +
   每写 mkdir + 每轮双写（S4-G-2/S3-G-4/S5-G-1/S6-G-6）。
2. **十 ms 带候选的结构性特征**。本切片任何名义收益进入几十 ms 带的
   候选必然在削减上述契约地板的某个组成部分（S6-G-6 的 14.9~22.1ms
   正是 ≤32 次租约后 checkpoint 写），因此**按构造**撞上某条持久性/
   一致性契约。纯计算侧（校验、扫描、Map 查找）经六遍枚举全部候选
   名义收益 ≤4.2ms/run（本轮 S6-G-3 上界）。地板复核完毕：预算是
   契约/I-O 地板的判断量化成立，非计算可解。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S6-G-1 | `finish()`（`flowchart-run.ts:524-546`）三次相邻 readAll+replayRun（`persistCheckpoint` 内部 `:440`、`beforeSettle` `:526`、最终 outcome 读 `:534`）→ 穿线复用一次读 | 免 1-2 次全量 readAll（541~614µs/次） | ❌ **反例**：外部 cancel CLI 在相邻读之间追加 RUN_CANCEL_REQUESTED——现实现重读得 status=CANCELLED、episode 正确结算 ABANDONED；复用变体报陈旧 RUNNING、**完全跳过 episode 结算**（两 seed 同判） | 省 1081~1228µs 且**每次终端转换仅一次**（finish 每 CLI 调用运行一次）→ CLI 噪声类 | 淘汰：**非保行为**（跨进程磁盘事实源的终端一致性屏障，S1-G-1/S2-J-11 同域从未赋 ID 的端点）+ CLI 噪声，双重淘汰 |
| S6-G-2 | `resumeFlowchartRun` 在 `:854` 读后于 `:949` 重读（即使无 unpause 发生）→ 复用首读 | 免一次全量 readAll | ❌ 同 S6-G-1 反例机制：外部 cancel 落在两读之间——现实现直接走 finish() 不执行；复用变体会**在已取消的 run 上继续执行节点**（同机制裁决，未另立仿真块） | 每次 resume CLI 一次 → CLI 噪声类 | 淘汰：与 S6-G-1 同契约同机制的第二端点，收口赋 ID |
| S6-G-3 | `validateFlowchartCheckpointState`（`replay.ts:239-276`）结构直验后 restore 再验（构造器重跑 `validateFlowchart`、restore 重跑 `validateFlowchartSupervisorSnapshot`）→ 去掉**内层**（S3-G-2 反例封死的是去掉外层） | 免每 checkpoint 一层校验 | ❌ 理论裁决：restore 与真实 resume 路径**共享实现**，内层校验即可恢复性屏障本体（"snapshot is not restorable" 语义的实现点），拆内层等于拆 resume 防线 | N=48 重标定：结构遍 51.9~63.0µs + restore 遍 125.9~130.6µs；即便两层全部去重（非法）也仅 51.9~63.0µs × ~66 persists = **3.43~4.16ms/run** | 淘汰：S3-G-2 互补方向收口（外层死于错误前缀发散、内层死于可恢复性屏障），且名义上界不达线，双重淘汰；**非重开**（维持 S3-G-2 排除） |
| S6-G-4 | `isIsoTimestamp`（`timestamp.ts:11-14`）每次事件校验跑 regex + `Date.parse` → 纯 regex 快路径或手写日历校验 | 免每时戳一次 Date.parse（133~142ns） | ❌ **双向发散反例**：(a) "2026-13-01T00:00:00Z"（13 月）regex-only **接受** vs 现实现**拒绝**——Date.parse 承载真实范围校验；(b) "2026-02-30T00:00:00Z" 现实现经 V8 日回卷语义**接受**、严格手写日历校验会**拒绝**——替代实现除非逐位复刻 V8 回卷语义，否则两个方向都发散（两 seed 同判） | isIsoTimestamp 168~176ns/call、regex 份额 32~39ns → Date.parse 份额 133~142ns；上限 E=300 × ~1.2 时戳/事件 × 70 readAll = **3.4~3.6ms/run** | 淘汰：等价不可行（X1-3"非逐位一致替代"原则域）+ S1-G-3 家族微份额不达线，双重淘汰 |
| S6-G-5 | 门控事件顺序追加（`flowchart-run.ts:328-330`、`coordinator.ts:452-454`、`supervisor.ts:492-494`）`for…await append` → 全部入队后 `Promise.all` 等待 | 重叠微任务等待（I/O 由 store 队列串行化） | ✅ EventStore 内部队列按入队序串行化写——k=16 同 store 两路落盘文件**行序逐位一致**（两 seed 同判） | 30 轮交替实测：sequential-await 72.2~83.2µs/事件 vs enqueue-all 70.1~75.7µs/事件；delta 跨 seed **+2.1 / −0.5µs/事件（符号翻转）**＝纯测量噪声 | 淘汰：等价成立但零收益——队列串行化 I/O 使重叠只省微任务开销；与 S5-G-4（跨 store，反例封死）合并把"追加重叠"两维度全部收口 |
| S6-G-6 | `runFlowchartLoop` 租约后立即 persist（`flowchart-run.ts:603`）+ 应用结果后再 persist（`:617`）→ 去掉租约后 persist（每轮合并为一次） | 免 ≤32 次/run 的 checkpoint 原子写（467~691µs/次） | ❌ **反例**：节点执行是最长阶段（child LLM 秒~分钟级），执行中崩溃后 resume——现实现（post-lease checkpoint）重路由 **0** 个（日志共 1 条 MODEL_ROUTED；租约节点保持 RUNNING、无重复子执行）；变体（仅 pre-lease checkpoint）重路由**全部**已租约节点（日志共 2 条：重复 MODEL_ROUTED 携带全新事件 id → **id 流发散**、节点重复执行 child、learned-routing 归因重复计数）（两 seed 同判） | **14.9~22.1ms/run 名义**——本轮唯一进入十 ms 带的候选 | 淘汰：**非保行为**——恢复窗口契约（确定性 id 流 + 事件次序 + 重复执行三重违例）；名义收益越大恰因它削的是契约地板本体 |
| S6-G-7 | 每子任务完成后全量 readAll 喂 `applyChildThreeLine`（`flowchart-run.ts:319`、`coordinator.ts:443`）→ 维护内存事件镜像增量喂 | 免每子任务一次全量 readAll | ❌ 同 S6-G-1 反例机制：三线门必须在**当前磁盘全量事实**上决策——外部 answer/pause/cancel CLI 与 injection 的追加是门控输入的一部分，内存镜像即陈旧证据；此为 tracking gate 的**证据边界**（tracking 无指挥权、门控只信磁盘事实源） | 几十子任务 × 541~614µs ＝低十 ms 带名义，但同契约封死 | 淘汰：S1-G-1 同契约在 tracking 门控证据边界维度的调用点收口（不重开 S1-G-1，赋 ID 显式钉死该端点） |

## 3. 关键裁决细节

### S6-G-1/S6-G-2/S6-G-7：相邻重读是终端一致性 / 证据边界屏障（本轮最重要发现之一）

第六遍读码把注意力放在"同一函数内相邻的多次 readAll"上——这是 S1-G-1
（增量缓存）与 S2-J-11（内存镜像）都没有点名过的第三种形态：不缓存、
不镜像，只把**相邻调用点的一次读穿线复用**。表面看它连缓存失效问题都
没有（生命周期只有几行代码），R3-G 也只在保行为复核里顺带提过一句。
仿真给出了第一个行为发散反例：

1. `finish()` 的三连读（`persistCheckpoint` 内部 `:440` → `beforeSettle`
   `:526` → 最终 outcome 读 `:534`）之间存在**跨进程追加窗口**。反例向
   该窗口注入外部 cancel CLI 的 RUN_CANCEL_REQUESTED：现实现第二次读
   看到取消事件，`settleBoundEpisode` 以 CANCELLED 结算 episode 为
   ABANDONED；复用首读的变体把 run 报成陈旧 RUNNING，**episode 结算被
   整个跳过**——不是"晚一步看到"，而是该终端转换点上的结算逻辑永久
   丢失（finish 每 CLI 调用只走一次）。
2. `resumeFlowchartRun` 的 `:854`/`:949` 双读同机制：取消落在两读之间
   时，现实现直接返回 finish() 不执行任何节点；复用变体会在已取消的
   run 上继续租约执行。
3. `applyChildThreeLine` 的每子任务 readAll（S6-G-7）是同契约的门控
   面：三线门的输入按设计是**当前磁盘全量事实**——外部 answer/pause/
   cancel 与 injection 追加必须进入门控证据。换内存镜像即把门控决策
   建立在陈旧证据上；tracking 无指挥权的前提正是它只读磁盘事实源。

收益侧三个端点全部是 CLI 噪声或被同契约封死：finish/resume 每 CLI
调用一次（~1ms 量级一次性），per-child readAll 名义可达低十 ms 带但
恰好是证据边界本体。**"相邻重读穿线"家族至此收口：本切片再无任何
"看似可复用"的 readAll 端点。**

### S6-G-6：每轮双 checkpoint 是恢复窗口契约——唯一十 ms 带候选的封死

`runFlowchartLoop` 每轮在租约后（`:603`，仅当有新租约）与应用结果后
（`:617`）各 persist 一次，表面看同一轮两次全谱原子写（validate +
stringify + fsync + rename，467~691µs/次）是显然的合并对象——去掉
租约后那次名义省 14.9~22.1ms/run，是本轮唯一进入十 ms 带的候选。
反例证明该 persist 的时机正是它的全部意义：

- 租约（`leaseReadyNodes`）在 supervisor 内**消费路由决策**：MODEL_ROUTED
  事件已追加、事件 id 已从确定性 id 流抽取、节点状态已置 RUNNING。
- 节点执行（child LLM 调用）是全 run 最长阶段（秒~分钟级），**执行中
  崩溃是概率最大的恢复窗口**。
- 现实现：resume 从 post-lease checkpoint 恢复，重路由 0 个节点，租约
  节点保持 RUNNING 由孤儿租约恢复链接管——日志中 MODEL_ROUTED 恰一条。
- 变体：resume 只能回到 pre-lease 快照，`leaseReadyNodes` 把同一批节点
  **再路由一遍**：日志出现重复 MODEL_ROUTED（携带全新事件 id → id 流
  与事件次序双发散）、子任务重复执行（重复计费/重复副作用）、
  learned-routing 归因把同一路由计两次。

这与 S3-G-4（跳过**末次** persist → 陈旧态当终态落盘）互补：末次
persist 保证终态可恢复，租约后 persist 保证**中段执行窗口**可恢复。
checkpoint 时机族（末次、每轮中段、写侧校验、每写 mkdir）至此全谱收口。
名义收益最大的候选恰好死于最硬的契约，定量佐证了第 1 节的结构判断：
**本切片十 ms 带以上的"优化空间"全部是契约地板本体。**

### S6-G-4：时戳校验替换的双向发散陷阱

`isIsoTimestamp` 的 `Date.parse`（regex 后二次校验）看似可用手写日历
检查替换。反例证明替换在**两个方向**都发散：13 月（"2026-13-01"）被
regex-only 放行而现实现拒绝——Date.parse 承载真实范围校验；而
2 月 30 日（"2026-02-30"）被现实现**接受**（V8 Date.parse 日回卷到
3 月 2 日）——一个"更正确"的严格日历校验反而会拒绝现实现接受的字节，
改变 `validateEvent` 的接受集。等价替换必须逐位复刻 V8 回卷语义，
工程风险远超 133~142ns/call 的份额（上限 3.4~3.6ms/run，S1-G-3 同族
微份额）。fail-closed 校验器的接受集是可观察契约，X1-3"非逐位一致
替代"原则第六遍复核维持。

### S6-G-3/S6-G-5：两个合法候选为何不达线

- S6-G-3 把 S3-G-2 的互补方向也钉死：外层直验去除死于错误前缀发散
  （R3-G 反例），内层 restore 重验去除死于可恢复性屏障（restore 与
  resume 共享实现）。N=48 重标定证明即便两层全部去重（非法）名义也
  只有 3.43~4.16ms/run——结构遍（51.9~63.0µs）只占 restore 全谱
  （125.9~130.6µs）的三分之一，且整条路径被 fsync 支配。该行维持排除，
  重开语义不变。
- S6-G-5 是"追加重叠"家族的最后一格：S5-G-4 封死跨 store 重叠（崩溃
  前缀反例），本条同 store 入队重叠因 EventStore 内部队列按入队序
  串行化而**等价平凡成立**（k=16 两路文件行序逐位一致），但也正因
  I/O 无论如何串行化，重叠只省 await 微任务开销——delta 跨 seed
  +2.1/−0.5µs/事件符号翻转，纯测量噪声。等价但零收益，家族收口。

### 保行为面复核（第六遍，在五轮收口之上）

- **O(R×E) 重复 `readAll` 维持排除**（S1-G-1）：第六次复核；本轮
  S6-G-1/2/7 反例把该契约的**终端一致性**与**门控证据边界**两个维度
  显式钉死。维持。
- **checkpoint 全谱系维持**（X3-3/X4-1/S3-G-2/S3-G-4/S4-G-2/S4-G-6/
  S5-G-1）：零 diff；本轮 S6-G-3（内层方向）与 S6-G-6（每轮中段时机）
  把校验与时机两条剩余缝隙收口，写路径现已无任何未裁决角度。
- **确定性 id 流与事件次序维持**（S2-G-5/S4-G-1/S5-G-4/S5-G-5）：
  零 diff；本轮 S6-G-6 反例给出 id 流契约在 **checkpoint 时机**维度的
  违例形态（重复 MODEL_ROUTED 携带新 id）。
- **调度/resume/lease/join**：`planRound` 三段式、孤儿 lease 恢复链
  （S6-G-6 反例中现实现路径的接管方）、`joinStatus` quorum 计数、
  `assertWaiterInvariant`——零 diff。
- **审批路径双层校验维持**（S4-G-3）：零 diff。tracking 无指挥权、
  H/score 不写路由 PASS/FAIL：本切片无触点，天然满足。

### 逐文件收口（第六遍新视角补充，前五轮收口之上）

| 文件 | 第六遍新检查点 | 结论 |
| --- | --- | --- |
| `run/flowchart-run.ts` | 见 S6-G-1（finish 三连读）、S6-G-2（resume 双读）、S6-G-5（门控顺序追加）、S6-G-6（每轮双 persist）、S6-G-7（per-child readAll）；S4-G-1..5/S3-G-4 全维持 | 无候选落地 |
| `run/replay.ts` | 见 S6-G-3（内层 restore 重验的角色）；`replayRun` 单遍状态机、`materializeCheckpoint` O(1) 派生维持 | 无候选落地 |
| `run/event-store.ts` / `episode-store.ts` | 见 S6-G-5（append 队列的入队序契约正是等价性来源）；readAll 全量重验 = S1-G-1/S5-G-2 维持；终端事件 fsync 旗标维持 | 无候选落地 |
| `run/checkpoint-store.ts` / `pause-controller.ts` | 见 S6-G-6（写全谱 467~691µs 的时机角色）；每写 mkdir = S5-G-1、tmp+fsync+rename = S4-G-2 维持 | 无候选落地 |
| `run/coordinator.ts` / `run/supervisor.ts` | 见 S6-G-5/S6-G-7（同两端点的非流程图调用面）；跨 store 追加链 = S5-G-4 维持；`planTaskTopology` 维持未接线（X0-2） | 无候选落地 |
| `run/child-coordinator.ts` | S5-G-4/5、S3-G-3、S2-G-5 全维持；本轮无新端点（AGENT_EVENT 面已于 R5 全谱收口） | 无候选 |
| `run/scheduler.ts` / `inspection.ts` / `injection.ts` / `episode-bind.ts` | `isExpired` = S2-G-8、splice/filter = S1-G-6、两遍扫描 = S2-G-6 维持；`episodeIdFromEvents` 反向早退维持 | 无候选 |
| `run/flowchart-executor.ts` / `child-grounding.ts` / `child-prompt.ts` | O(输入) 组装每子任务一次；无新端点 | 无候选 |
| `supervisor/flowchart-supervisor.ts` | `leaseReadyNodes` 的路由消费时序（S6-G-6 反例的机制载体）；snapshot = S3-G-1、edgeStatus = S5-G-6、propagate = X4-8 维持 | 无候选落地 |
| `supervisor/flowchart-snapshot.ts` / `ledger.ts` | 见 S6-G-3（校验器即 restore 屏障的另一半）；X4-7 维持 | 无候选落地 |
| `graph/validate.ts` / `readiness.ts` / `judge.ts` / `compile-children.ts` | Kahn = X4-6 维持；一次性接受路径；judge 证据个位 | 无候选 |
| `domain/timestamp.ts` | 见 S6-G-4（Date.parse 的范围校验角色 + V8 回卷语义陷阱） | 无候选落地 |
| `domain/ids.ts` / `state.ts` / `flowchart.ts` | isId = S3-G-5、BFS = S2-G-4、validateJoin = S1-G-4、审批校验 = S4-G-3 维持 | 无候选 |
| `domain/` 其余 13 文件 | 模块级正则 + O(1) 谓词 + 一次性校验器 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-G 基线 `4efee23` 起经
R2-G、R3-G、R4-G、R5-G、本轮 R6-G 六遍复查累计零代码改动，逐字节一致
（对当前独占 tip `859171e` 重验：S6-C 与 S5-F/S5-I-1 均未触碰本切片）。

## 5. 测试

零代码改动下全量 gate 基线复核，全绿（Node v22.22.2，pnpm 10.17.1）：

```bash
pnpm gate   # tsc --noEmit && eslint . && tsx --test && tsc -p tsconfig.build.json
# tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1
```

环境注记：本 VM 系统 Node 为 v22.14.0，低于 `engines` 要求
（>=22.19.0）——`doctor` 预检测试（`test/unit/cli/doctor.test.ts`，
切片外）按设计 fail-closed 报 FAIL；切换 nvm v22.22.2 后全量 gate 绿。
非本切片问题，未改任何测试。

仿真（临时脚本，未入库——无赢家不落仿真文件，完整源码见附录；seeds
`0x669061`/`0x669062` 两次独立运行等价/反例结论逐位一致、计时抖动
范围内稳定）：

```text
seed=0x669061
shared bench: EventStore.readAll(E=300, realistic mixed payloads)=614us/read (disk read + JSON.parse + per-event validateEvent); ~70 persist-path reads/run -> 43.0ms/run total (contract floor, S1-G-1)
S6-G-1 counterexample: external RUN_CANCEL_REQUESTED lands between adjacent reads -> current re-read status=CANCELLED (episode close action=ABANDONED) | reuse variant status=RUNNING (episode close action=(none: run looks live))
S6-G-1 bench: eliding the 1-2 redundant-looking reads in finish() would save 1228us once per terminal transition (finish runs once per CLI invocation) -> not a landing-line quantity even before the contract veto
S6-G-3 bench (N=48 nodes): structural pass=63.0us + restore pass=130.6us per validateCheckpoint; deduping the structural pass saves 63.0us x ~66 persists = 4.16ms/run (S3-G-2 domain: error-prefix divergence + restore IS the restorability barrier)
S6-G-4 counterexample: "2026-13-01T00:00:00Z" -> regex-only fast-path ACCEPTS(true) vs current isIsoTimestamp REJECTS(true) -> Date.parse carries real range validation a replacement must replicate bit-for-bit
S6-G-4 equivalence trap: "2026-02-30T00:00:00Z" -> current isIsoTimestamp ACCEPTS(true) via Date.parse day rollover; a strict calendar validator would reject it -> hand-rolled replacement diverges in BOTH directions unless it replicates V8 rollover semantics
S6-G-4 bench: isIsoTimestamp=168ns/call, regex share=32ns -> Date.parse share=136ns/call; ceiling at E=300 x ~1.2 timestamps/event x 70 readAll = 3.4ms/run (S1-G-3 family: validateEvent micro-share)
S6-G-5 bench: k=16 same-store appends sequential-await=72.2us/event vs enqueue-all=70.1us/event (queue-serialized I/O either way; delta=2.1us/event microtask overhead only); line order identical=true
S6-G-6 counterexample: crash mid-execution after 1 MODEL_ROUTED appended -> current(post-lease checkpoint) resume re-routes 0 (log total 1 MODEL_ROUTED; leased node stays RUNNING, no duplicate child execution) | variant(pre-lease checkpoint only) resume re-routes 1 (log total 2: duplicate MODEL_ROUTED with fresh event ids -> id-stream divergence, node re-executes its child, learned-routing attribution double-counts the route)
S6-G-6 bench: one durable checkpoint write (validate+stringify+open+write+fsync+rename, N=48 flowchart)=691us -> eliding <=32 post-lease writes/run = 22.1ms/run nominal, vetoed by the recovery-window contract above

ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x669062
shared bench: 541us/read -> 37.8ms/run（地板复核与 seed 1 同带）
S6-G-1 counterexample: 与 seed 1 逐位一致; bench: 1081us
S6-G-3 bench: 51.9us + 125.9us -> 3.43ms/run
S6-G-4 counterexample + equivalence trap: 与 seed 1 逐位一致; bench: 176ns / 33ns -> 142ns, 3.6ms/run
S6-G-5 bench: 73.8us vs 74.3us -> delta=-0.5us/event（符号翻转＝噪声）; line order identical=true
S6-G-6 counterexample: 与 seed 1 逐位一致; bench: 467us -> 14.9ms/run
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S6-G-1 | finish() 三连读穿线复用一次 readAll | 外部 cancel 落在相邻读间→episode 结算被跳过（终端一致性屏障）；1.1~1.2ms 每 CLI 一次＝噪声 |
| S6-G-2 | resumeFlowchartRun :854/:949 双读复用首读 | 同 S6-G-1 机制：在已取消 run 上继续执行节点；每 resume CLI 一次 |
| S6-G-3 | validateFlowchartCheckpointState 去掉内层 restore 重验（S3-G-2 互补方向） | restore 与 resume 共享实现，内层即可恢复性屏障；两层合计名义仅 3.4~4.2ms/run |
| S6-G-4 | isIsoTimestamp 的 Date.parse 换纯 regex / 手写日历校验 | 双向发散（13 月被放行；2 月 30 日 V8 回卷接受、严格校验反而拒绝）；份额 3.4~3.6ms/run |
| S6-G-5 | 门控事件顺序追加改同 store 入队 Promise.all | 等价成立（队列入队序串行化、行序逐位一致）但 delta ±µs 符号翻转＝零收益 |
| S6-G-6 | runFlowchartLoop 去掉租约后 persistCheckpoint（每轮合一） | 执行中崩溃反例：resume 重路由全部租约节点（重复 MODEL_ROUTED、id 流发散、子任务重复执行）；14.9~22.1ms/run 名义是契约地板本体 |
| S6-G-7 | applyChildThreeLine 的 per-child readAll 换内存事件镜像 | tracking 门控证据边界（门只信磁盘事实源，外部追加必须进入门控输入）；S1-G-1 同契约调用点收口 |

重开条件：S6-G-1/2/7 与 S1-G-1 同源——需先显式重定义跨进程事实源契约
（如引入单进程独占锁使外部追加不可能，属语义工作）；S6-G-6 需先对
恢复窗口契约做产品级重定义（如 lease 幂等化 + MODEL_ROUTED 去重键，
届时"每轮一写"是新语义下的设计而非保行为优化）；S6-G-3 维持 S3-G-2
重开条件（checkpoint 校验错误面/可恢复性屏障的显式重定义）；S6-G-4
需 V8 回卷语义的逐位复刻实现 + E 增长 ≥2 个量级方值得重估；S6-G-5
等价已证，若 EventStore 队列实现改变（如批量 writev 合并）可凭本报告
等价证据直接重估收益端。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed>`（依赖
已装；`.mts` 后缀确保 ESM 顶层 await 可用）。seeds：`0x669061`、
`0x669062`（其余段确定性构造，无随机性）。S6-G-2/S6-G-7 由 S6-G-1 反例
同机制裁决（见脚本内注释块），未另立仿真块。

```ts
/**
 * R6-G deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh candidates S6-G-1 .. S6-G-7 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed>
 */
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "/workspace/src/run/event-store.js";
import { CheckpointStore } from "/workspace/src/run/checkpoint-store.js";
import { runtimeRoot } from "/workspace/src/privacy/state-layout.js";
import type { Event } from "/workspace/src/run/events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "/workspace/src/run/replay.js";
import {
  createFlowchartSupervisor,
  restoreFlowchartSupervisor,
  type FlowchartSupervisorSnapshot
} from "/workspace/src/supervisor/flowchart-supervisor.js";
import {
  validateFlowchartRunLimits,
  validateFlowchartSupervisorSnapshot
} from "/workspace/src/supervisor/flowchart-snapshot.js";
import { validateFlowchart, type Flowchart } from "/workspace/src/domain/flowchart.js";
import type { ModelRouter, RoutingDecision } from "/workspace/src/supervisor/model-router.js";
import { isIsoTimestamp, type IsoTimestamp } from "/workspace/src/domain/timestamp.js";
import { defaultRunLimits } from "/workspace/src/domain/limits.js";
import { createEventId, type RunId, type TaskId } from "/workspace/src/domain/ids.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}\n`);
  }
}
function log(line: string): void {
  process.stdout.write(`${line}\n`);
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
  return (performance.now() - t0) / reps; // ms per call
}

const SEED = Number.parseInt(process.argv[2] ?? "0x669061", 16) || 0x669061;
log(`seed=0x${SEED.toString(16)}`);
const scratch = await mkdtemp(join(tmpdir(), "r6g-sim-"));

let idn = 0;
const gen = () => `id${String((idn += 1)).padStart(5, "0")}`;
const iso = (tick: number): IsoTimestamp =>
  new Date(1756200000000 + tick * 1000).toISOString() as IsoTimestamp;

function makeEvent(runId: RunId, tick: number, type: Event["type"], payload: unknown, taskId?: TaskId): Event {
  return {
    id: createEventId(gen),
    schemaVersion: 1,
    occurredAt: iso(tick),
    runId,
    ...(taskId !== undefined ? { taskId } : {}),
    type,
    actor: "r6g-sim",
    payload
  } as Event;
}

function makeRunPayload(runId: RunId): unknown {
  return {
    run: {
      id: runId,
      projectId: "prj_r6g",
      rootTaskId: "tsk_root",
      status: "PLANNING",
      limits: defaultRunLimits(),
      createdAt: iso(0),
      updatedAt: iso(0)
    }
  };
}

/* ============================================================
 * Shared fixture: a realistic parent event log at E=300 (RUN_CREATED +
 * RUN_STARTED + AGENT_EVENT / TASK_STATUS_CHANGED / TASK_RETRY /
 * LEDGER_UPDATED mix), persisted through the real EventStore.
 * ============================================================ */
const rng = mulberry32(SEED);
const stateRoot = join(scratch, "state");
const runId = "run_r6g" as RunId;
const store = new EventStore(stateRoot, runId);
{
  await store.append(makeEvent(runId, 0, "RUN_CREATED", makeRunPayload(runId)));
  await store.append(makeEvent(runId, 1, "RUN_STARTED", {}));
  const kinds = ["TEXT_DELTA", "TOOL_STARTED", "TOOL_FINISHED"] as const;
  for (let i = 0; i < 298; i += 1) {
    const roll = rng();
    if (roll < 0.72) {
      await store.append(
        makeEvent(runId, 2 + i, "AGENT_EVENT", {
          agentInstanceId: "agt_r6g",
          kind: kinds[Math.floor(rng() * kinds.length)]!,
          summary: `text delta (${64 + Math.floor(rng() * 512)} chars)`
        })
      );
    } else if (roll < 0.86) {
      await store.append(
        makeEvent(
          runId,
          2 + i,
          "TASK_STATUS_CHANGED",
          { taskId: `tsk_t${Math.floor(rng() * 16)}`, status: "RUNNING", attempt: 1 },
          `tsk_t${Math.floor(rng() * 16)}` as TaskId
        )
      );
    } else if (roll < 0.94) {
      await store.append(
        makeEvent(runId, 2 + i, "TASK_RETRY", {
          childRunId: "run_child",
          attempt: 1 + Math.floor(rng() * 2),
          reason: "attempt failed"
        })
      );
    } else {
      await store.append(
        makeEvent(runId, 2 + i, "LEDGER_UPDATED", {
          revision: i,
          round: 1 + Math.floor(i / 10),
          consecutiveStalls: 0,
          isBlocked: false
        })
      );
    }
  }
}
const E = (await store.readAll()).events.length;
const readAllCost = await benchAsync(async () => {
  await store.readAll();
}, 100);
log(
  `shared bench: EventStore.readAll(E=${E}, realistic mixed payloads)=${(readAllCost * 1e3).toFixed(0)}us/read (disk read + JSON.parse + per-event validateEvent); ~70 persist-path reads/run -> ${(readAllCost * 70).toFixed(1)}ms/run total (contract floor, S1-G-1)`
);

/* ============================================================
 * S6-G-1: finish() (flowchart-run.ts:524-546) performs three adjacent
 * readAll+replayRun passes (inside persistCheckpoint, beforeSettle, and the
 * final outcome read). Candidate: thread one read through the adjacent
 * call sites. COUNTEREXAMPLE: the disk is the cross-process fact source
 * (S1-G-1/S2-J-11): an external cancel CLI appends RUN_CANCEL_REQUESTED
 * between the first and second read -> the current re-read settles the
 * episode as ABANDONED and reports CANCELLED; the reuse variant reports a
 * stale RUNNING and skips episode settlement entirely.
 * ============================================================ */
{
  const localRoot = join(scratch, "s6g1");
  const localRun = "run_s6g1" as RunId;
  const localStore = new EventStore(localRoot, localRun);
  await localStore.append(makeEvent(localRun, 0, "RUN_CREATED", makeRunPayload(localRun)));
  await localStore.append(makeEvent(localRun, 1, "RUN_STARTED", {}));

  const firstRead = await localStore.readAll(); // = persistCheckpoint's read

  // External process (cancel CLI) appends between the adjacent reads.
  const externalStore = new EventStore(localRoot, localRun);
  await externalStore.append(makeEvent(localRun, 2, "RUN_CANCEL_REQUESTED", {}));

  const currentRead = await localStore.readAll(); // current: re-read before settle
  const currentStatus = replayRun(currentRead.events).status;
  const variantStatus = replayRun(firstRead.events).status; // variant: reuse the first read

  const closeAction = (status: string): string =>
    status === "CANCELLED" ? "ABANDONED" : status === "RUNNING" ? "(none: run looks live)" : status;
  log(
    `S6-G-1 counterexample: external RUN_CANCEL_REQUESTED lands between adjacent reads -> current re-read status=${currentStatus} (episode close action=${closeAction(currentStatus)}) | reuse variant status=${variantStatus} (episode close action=${closeAction(variantStatus)})`
  );
  check(
    "S6-G-1 divergence demonstrated (stale read skips cancellation settle)",
    currentStatus === "CANCELLED" && variantStatus === "RUNNING"
  );
  log(
    `S6-G-1 bench: eliding the 1-2 redundant-looking reads in finish() would save ${(readAllCost * 2 * 1e3).toFixed(0)}us once per terminal transition (finish runs once per CLI invocation) -> not a landing-line quantity even before the contract veto`
  );
}

/* ============================================================
 * S6-G-2 (same mechanism, distinct site): resumeFlowchartRun re-reads at
 * flowchart-run.ts:949 after the :854 read even when no unpause happened.
 * An external cancel between the two reads makes the current code return
 * finish() without executing; the reuse variant would execute nodes on a
 * cancelled run. Adjudicated by the S6-G-1 counterexample above (identical
 * mechanism); once per resume CLI -> also CLI-noise class.
 * S6-G-7 (same domain): per-child readAll feeding applyChildThreeLine
 * (flowchart-run.ts:319, coordinator.ts:443) is the tracking gate's
 * evidence boundary over the same cross-process fact source.
 * ============================================================ */

/* ============================================================
 * S6-G-3: validateCheckpoint -> validateFlowchartCheckpointState
 * (replay.ts:239-276) validates definition + snapshot structurally and then
 * validates AGAIN by restore (the FlowchartSupervisorImpl constructor
 * re-runs validateFlowchart, restore() re-runs
 * validateFlowchartSupervisorSnapshot + structuredClones). Candidate:
 * dedupe the double validation. Same domain as excluded S3-G-2; bench the
 * nominal delta to confirm it is also under the landing line.
 * ============================================================ */
const N = 48;
let definition: Flowchart;
let liveSnapshot: FlowchartSupervisorSnapshot;
const stubRouter = {
  config: { policyVersion: "r6g-sim", models: [] },
  route: (input: { taskId: TaskId }): RoutingDecision =>
    ({
      eventType: "MODEL_ROUTED",
      taskId: input.taskId,
      role: "actor",
      complexity: "MEDIUM",
      model: "cheap",
      justification: "sim route",
      confidence: 0.9,
      approvalPlan: {
        id: `approval:${input.taskId}`,
        items: [{ id: "route:cheap", label: "Run on cheap", selectable: true, defaultSelected: true }]
      },
      statusAfterRoute: "RUNNING",
      policyVersion: "sim-v1",
      estimatedCostUsd: 0,
      estimatedDurationMs: 1000,
      family: "sim",
      featureVersion: "f1",
      modelVersion: "cheap-v1",
      highRisk: false,
      eligibleModels: ["cheap"],
      rejections: [],
      behaviorDistribution: { cheap: 1 }
    }) as unknown as RoutingDecision
} as unknown as ModelRouter;
{
  definition = validateFlowchart({
    id: "r6g-sim-chart",
    nodes: Array.from({ length: N }, (_, i) => ({
      id: `n${i}`,
      taskId: `tsk_n${i}`,
      role: "actor",
      objective: `node ${i} objective`,
      modelPolicy: { allowedModels: ["cheap"], preferredModel: "cheap" },
      confidenceThreshold: 0.5,
      approvalRequired: false
    })),
    edges: Array.from({ length: N - 1 }, (_, i) => ({
      from: `n${i}`,
      to: `n${i + 1}`,
      condition: { type: "success", expected: true }
    }))
  });
  const sup = createFlowchartSupervisor({
    flowchart: definition,
    router: stubRouter,
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3 },
    runId: "run_s6g3" as RunId,
    generateId: gen,
    now: () => iso(9)
  });
  sup.leaseReadyNodes();
  liveSnapshot = sup.snapshot();

  const limits = validateFlowchartRunLimits({
    maxConcurrentNodes: 4,
    maxConsecutiveStalls: 3,
    remainingTimeMs: Number.MAX_SAFE_INTEGER
  });
  const structuralCost = bench(() => {
    validateFlowchart(definition);
    validateFlowchartSupervisorSnapshot(liveSnapshot);
  }, 2000);
  const restoreCost = bench(() => {
    restoreFlowchartSupervisor({ flowchart: definition, router: stubRouter, limits }, liveSnapshot);
  }, 2000);
  log(
    `S6-G-3 bench (N=${N} nodes): structural pass=${(structuralCost * 1e3).toFixed(1)}us + restore pass=${(restoreCost * 1e3).toFixed(1)}us per validateCheckpoint; deduping the structural pass saves ${(structuralCost * 1e3).toFixed(1)}us x ~66 persists = ${(structuralCost * 66).toFixed(2)}ms/run (S3-G-2 domain: error-prefix divergence + restore IS the restorability barrier)`
  );
}

/* ============================================================
 * S6-G-4: isIsoTimestamp (timestamp.ts:11-14) runs Date.parse after the
 * regex on every event validation, on every readAll. Candidate: replace
 * Date.parse with a hand-rolled calendar check. COUNTEREXAMPLE for the
 * naive variant: the regex alone accepts impossible calendar dates.
 * Bench: the Date.parse share is noise at real scale, and a semantics-
 * preserving replacement must replicate calendar + offset validation
 * (equivalence risk for a noise-band gain).
 * ============================================================ */
{
  const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
  const badMonth = "2026-13-01T00:00:00Z"; // month 13: regex passes, Date.parse rejects
  const regexOnlyAccepts = ISO_PATTERN.test(badMonth);
  const currentRejects = !isIsoTimestamp(badMonth);
  log(
    `S6-G-4 counterexample: "${badMonth}" -> regex-only fast-path ACCEPTS(${regexOnlyAccepts}) vs current isIsoTimestamp REJECTS(${currentRejects}) -> Date.parse carries real range validation a replacement must replicate bit-for-bit`
  );
  check("S6-G-4 divergence demonstrated (regex-only variant accepts month 13)", regexOnlyAccepts && currentRejects);
  // Equivalence trap for a "correct" hand-rolled calendar validator: V8's
  // Date.parse ACCEPTS 2026-02-30 by day rollover, so a strict calendar
  // check would REJECT bytes the current code accepts (divergence both ways).
  const rollover = "2026-02-30T00:00:00Z";
  log(
    `S6-G-4 equivalence trap: "${rollover}" -> current isIsoTimestamp ACCEPTS(${isIsoTimestamp(rollover)}) via Date.parse day rollover; a strict calendar validator would reject it -> hand-rolled replacement diverges in BOTH directions unless it replicates V8 rollover semantics`
  );

  const samples = Array.from({ length: 64 }, (_, i) => iso(i * 37));
  const fullCost = bench(() => {
    for (const sample of samples) isIsoTimestamp(sample);
  }, 5000);
  const regexCost = bench(() => {
    for (const sample of samples) ISO_PATTERN.test(sample);
  }, 5000);
  const deltaPerCall = ((fullCost - regexCost) / samples.length) * 1e6;
  const perRun = ((fullCost - regexCost) / samples.length) * E * 1.2 * 70;
  log(
    `S6-G-4 bench: isIsoTimestamp=${((fullCost / samples.length) * 1e6).toFixed(0)}ns/call, regex share=${((regexCost / samples.length) * 1e6).toFixed(0)}ns -> Date.parse share=${deltaPerCall.toFixed(0)}ns/call; ceiling at E=${E} x ~1.2 timestamps/event x 70 readAll = ${perRun.toFixed(1)}ms/run (S1-G-3 family: validateEvent micro-share)`
  );
}

/* ============================================================
 * S6-G-5: sequential `for ... await append(event)` over gated events
 * (flowchart-run.ts:328-330, coordinator.ts:452-454, supervisor.ts:492-494)
 * -> enqueue all appends into the EventStore queue and await the batch.
 * EQUIVALENCE: the store's internal queue serializes writes in enqueue
 * order, so the file bytes are identical. BENCH: the I/O is serialized
 * either way; the delta is per-event microtask overhead only.
 * ============================================================ */
{
  const k = 16;
  const mkEvents = (runIdLocal: RunId): Event[] => [
    makeEvent(runIdLocal, 0, "RUN_CREATED", makeRunPayload(runIdLocal)),
    ...Array.from({ length: k - 1 }, (_, i) =>
      makeEvent(runIdLocal, 1 + i, "AGENT_EVENT", {
        agentInstanceId: "agt_r6g",
        kind: "TEXT_DELTA",
        summary: `text delta (${100 + i} chars)`
      })
    )
  ];
  const seqRun = "run_s6g5a" as RunId;
  const batchRun = "run_s6g5b" as RunId;
  const seqStore = new EventStore(join(scratch, "s6g5"), seqRun);
  const batchStore = new EventStore(join(scratch, "s6g5"), batchRun);
  const seqEvents = mkEvents(seqRun);
  const batchEvents = mkEvents(batchRun);
  // First pass (measured for byte-equivalence below), then repeated
  // alternating passes for a stable timing average.
  const t0 = performance.now();
  for (const event of seqEvents) await seqStore.append(event);
  const firstSeqMs = performance.now() - t0;
  const t1 = performance.now();
  await Promise.all(batchEvents.map((event) => batchStore.append(event)));
  const firstBatchMs = performance.now() - t1;
  let seqTotal = firstSeqMs;
  let batchTotal = firstBatchMs;
  const passes = 30;
  for (let pass = 0; pass < passes - 1; pass += 1) {
    const moreSeq = Array.from({ length: k }, (_, i) =>
      makeEvent(seqRun, 100 + pass * k + i, "AGENT_EVENT", {
        agentInstanceId: "agt_r6g",
        kind: "TEXT_DELTA",
        summary: `text delta (${200 + i} chars)`
      })
    );
    const moreBatch = Array.from({ length: k }, (_, i) =>
      makeEvent(batchRun, 100 + pass * k + i, "AGENT_EVENT", {
        agentInstanceId: "agt_r6g",
        kind: "TEXT_DELTA",
        summary: `text delta (${200 + i} chars)`
      })
    );
    const s0 = performance.now();
    for (const event of moreSeq) await seqStore.append(event);
    seqTotal += performance.now() - s0;
    const b0 = performance.now();
    await Promise.all(moreBatch.map((event) => batchStore.append(event)));
    batchTotal += performance.now() - b0;
  }
  const seqMs = seqTotal / passes;
  const batchMs = batchTotal / passes;
  const seqLines = readFileSync(join(runtimeRoot(join(scratch, "s6g5")), "runs", seqRun, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { type: string; payload: { summary?: string } }));
  const batchLines = readFileSync(join(runtimeRoot(join(scratch, "s6g5")), "runs", batchRun, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { type: string; payload: { summary?: string } }));
  const sameOrder =
    seqLines.length === batchLines.length &&
    seqLines.every(
      (line, i) => line.type === batchLines[i]!.type && line.payload.summary === batchLines[i]!.payload.summary
    );
  check("S6-G-5 equivalence (queue preserves enqueue order; identical line sequence)", sameOrder);
  log(
    `S6-G-5 bench: k=${k} same-store appends sequential-await=${(seqMs * 1e3 / k).toFixed(1)}us/event vs enqueue-all=${(batchMs * 1e3 / k).toFixed(1)}us/event (queue-serialized I/O either way; delta=${(((seqMs - batchMs) / k) * 1e3).toFixed(1)}us/event microtask overhead only); line order identical=${sameOrder}`
  );
}

/* ============================================================
 * S6-G-6: runFlowchartLoop persists a checkpoint right after leasing
 * (flowchart-run.ts:603) and again after applying results (:617).
 * Candidate: drop the post-lease persist (merge to one per round).
 * COUNTEREXAMPLE: node execution is the long phase (child LLM runs,
 * seconds-to-minutes) -> a crash during execution is the common case.
 * With the post-lease checkpoint the resume restores RUNNING leases and
 * routes nothing; without it the resume restores the pre-lease snapshot
 * and re-routes every leased node: duplicate MODEL_ROUTED events land in
 * the log and consumeRoute debits the remaining budget a second time.
 * ============================================================ */
{
  const mkSup = (snapshot?: FlowchartSupervisorSnapshot) =>
    snapshot === undefined
      ? createFlowchartSupervisor({
          flowchart: definition,
          router: stubRouter,
          limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3, remainingTimeMs: 100_000 },
          runId: "run_s6g6" as RunId,
          generateId: gen,
          now: () => iso(10)
        })
      : restoreFlowchartSupervisor(
          {
            flowchart: definition,
            router: stubRouter,
            limits: validateFlowchartRunLimits({
              maxConcurrentNodes: 4,
              maxConsecutiveStalls: 3,
              remainingTimeMs: snapshot.remainingTimeMs ?? 100_000
            }),
            runId: "run_s6g6" as RunId,
            generateId: gen,
            now: () => iso(10)
          },
          snapshot
        );

  const sup = mkSup();
  const preLease = sup.snapshot(); // last durable checkpoint under the variant
  const leases = sup.leaseReadyNodes();
  const routedBeforeCrash = leases.length; // MODEL_ROUTED events already appended
  const postLease = sup.snapshot(); // durable checkpoint under the current code

  // Crash during node execution; resume:
  const currentResume = mkSup(postLease);
  const currentReRoutes = currentResume.leaseReadyNodes().length;
  const variantResume = mkSup(preLease);
  const variantReRoutes = variantResume.leaseReadyNodes().length;

  const currentTotal = routedBeforeCrash + currentReRoutes;
  const variantTotal = routedBeforeCrash + variantReRoutes;
  log(
    `S6-G-6 counterexample: crash mid-execution after ${routedBeforeCrash} MODEL_ROUTED appended -> current(post-lease checkpoint) resume re-routes ${currentReRoutes} (log total ${currentTotal} MODEL_ROUTED; leased node stays RUNNING, no duplicate child execution) | variant(pre-lease checkpoint only) resume re-routes ${variantReRoutes} (log total ${variantTotal}: duplicate MODEL_ROUTED with fresh event ids -> id-stream divergence, node re-executes its child, learned-routing attribution double-counts the route)`
  );
  check(
    "S6-G-6 divergence demonstrated (duplicate MODEL_ROUTED + duplicate child execution on resume)",
    currentReRoutes === 0 && variantReRoutes === routedBeforeCrash && variantTotal > currentTotal
  );

  // Nominal gain of the elided persist: one full checkpoint write per round.
  const cpStore = new CheckpointStore(join(scratch, "s6g6"), "run_s6g6" as RunId);
  const replayed = replayRun((await store.readAll()).events);
  const checkpoint = validateCheckpoint(
    materializeCheckpoint(replayed, iso(11), {
      definition,
      snapshot: postLease,
      limits: validateFlowchartRunLimits({
        maxConcurrentNodes: 4,
        maxConsecutiveStalls: 3,
        remainingTimeMs: 100_000
      })
    })
  );
  const writeCost = await benchAsync(async () => {
    await cpStore.write(checkpoint);
  }, 100);
  log(
    `S6-G-6 bench: one durable checkpoint write (validate+stringify+open+write+fsync+rename, N=${N} flowchart)=${(writeCost * 1e3).toFixed(0)}us -> eliding <=32 post-lease writes/run = ${(writeCost * 32).toFixed(1)}ms/run nominal, vetoed by the recovery-window contract above`
  );
}

await rm(scratch, { recursive: true, force: true });

if (failures > 0) {
  process.stderr.write(`\n${failures} check(s) FAILED\n`);
  process.exit(1);
}
log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

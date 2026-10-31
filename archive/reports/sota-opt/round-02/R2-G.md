MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-G：运行时 / 监督 / 图 / 领域模型切片复查报告（Round 1 同区第二遍）

**战役:** 全库持久 SOTA 优化 Round 2 / R2-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `31d4390`
**分支:** `cursor/r2-g-runtime-graph-domain-ffb9`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线（`4efee23`）
以来**逐字节未变**（`git diff 4efee23..31d4390 -- src/run src/supervisor
src/graph src/domain` 为空），R1-G 的逐文件收口与 S1-G-1..9 排除全部继承有效。
本轮在完整排除表（含 Round 1 十区 S1-* 与 R2 已产出的 S2-A/B/C/D-*）之上
再次全量实际读码、以新角度枚举，得到 8 个此前未点名的新候选
（S2-G-1 … S2-G-8），全部经理论 + 确定性仿真（seeded mulberry32，等价 fuzz /
**行为发散反例** / 真实规模基准，两次独立运行等价与反例结论逐位一致、计时
抖动范围内稳定）裁决后淘汰：**2 个被反例证明非保行为**（S2-G-2 会翻转可观察
run 终态 FAILED→COMPLETED；S2-G-5 会平移确定性 id 流使持久化事件可观察发散），
其余 6 个在真实规模是 ns~µs 级噪声（最强者 S2-G-8 全 run 上界 ~35µs，远低于
战役否决线——S1-I-1 的 ~190µs 亦被否决）。未重开任何 X* / S1-* / S2-* 条目。
X0-2/X0-4/X4-6/X4-7/X4-8/X4-9 维持排除未触碰；事件 schema 零 diff。唯一
超线性总量仍是 O(R×E) 的重复 `readAll`，其排除理由（S1-G-1：跨进程磁盘
事实源 + fail-closed 读校验契约）本轮复核维持。本切片在其持久化与调度契约
下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部文件再次实际读码，未依赖 R1-G 的记忆。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1（readAll 增量缓存）、
  S1-G-2（snapshot 标量访问器）、S1-G-3（EVENT_TYPES Set）、S1-G-4（join 邻接
  Set）、S1-G-5（聚合 clone）、S1-G-6（coordinator splice/filter）、S1-G-7
  （nodeTaskId Map）、S1-G-8（gate/lease 指针化）、S1-G-9（setRuntime 原地
  变异）九条全部不再提案；X4-6（Kahn queue.shift）、X4-7（isDuplicateFact）、
  X4-8（propagate/computeStatus 跨调用增量）、X4-9 直接跳过。本轮只探索
  **未被点名的新角度**：调用内 O(N²) 作用域缓存（S2-G-1）、失败恢复图 DFS
  重构（S2-G-2）、私有数组 copy-on-append（S2-G-3）、状态机 BFS 预计算
  （S2-G-4）、每轮协调器提升（S2-G-5）、检查扫描融合（S2-G-6/7）、租约
  时间戳解析缓存（S2-G-8）。
- **X0-2 遵守**：`planTaskTopology`（`src/run/supervisor.ts:64`，无生产调用方）
  保持未接线。**X0-4 遵守**：`applyTrackingGate`/`nextTrackingSeq` 未触碰。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、payload 校验器、
  `validateEvent` 抛错消息与次序全部原样。
- 调度语义、resume、lease、flowchart join 行为不变——零 diff，天然满足。
  不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。
- 仓库变更仅本报告一个文件。

## 1. 规模与门槛基底（继承 + 本轮校准）

R1-G 已实测本切片规模：全部结构维度（节点 N、任务 T、轮次 R≤32、每轮事实）
为几十级且热点结构已全面 Map 化；**唯一增长维度是事件数 E**（数百~千级），
只被线性触碰且重复重读是刻意契约（S1-G-1）。代码未变，全部继承。战役落地线
同样继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C ~450ms/fit、
S2-C ms 级），µs 级候选一律被否决过（S1-I-1 ~190µs、S2-D-4 ~116µs、S2-A-1
~12µs）。本轮全部候选的绝对收益上界是 **~35µs/run**（S2-G-8），两个更大的
数字（S2-G-2/5）根本不是合法收益——它们改行为。据此裁决。

本轮补充校准的一点新结构事实：该切片每一轮循环伴随**子代理秒级执行与
fsync 落盘**（`persistCheckpoint` 每轮 ≥2 次，含 validateFlowchart + 快照
校验 + restore 干跑 + 原子写），任何 µs 级 CPU 候选都被支配。实测整个
`leaseReadyNodes`（含 supervisor 构建）在 N=64 时 ~86µs，即调度决策 CPU
本体一整个也不到 0.1ms。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-G-1 | `leaseReadyNodes` 循环内每节点重算 `computeStatus()`（O(N)）与 `activeCount()`（O(N)）→ 变更驱动的调用内缓存（O(N²)→O(N)/调用） | 每 lease 调用免 ~2N² 次 Map 扫描 | —（未实现：循环中途 `resolveBranchGate`+`propagate` 与路由拒绝→FAILED 路径会真实改变状态，缓存需脏标记，见 §3） | 一次 computeStatus=34~111ns；O(N²) 上界 N=24/64 均 **~4.3~5.3µs/调用**；lease 本体 ~21~47µs | 淘汰：X4-8 同域规模论证（live 面几十节点）+ 中途重算是载荷语义，脏标记复杂度换 µs 级噪声 |
| S2-G-2 | `failurePathCompletedGraph` 跨 failedIds 记忆化 / 每根新鲜 `visiting` 消除重复 DFS | O(F·E)→O(E) | ❌ **反例**：链式恢复 b(FAILED)→a(FAILED)→C(COMPLETED) 下当前实现共享 `visiting` 在 true 返回路径保留节点，裁决 **FAILED**；每根独立评估的变体裁决 **COMPLETED**——可观察 run 终态翻转 | F 几十级上界；divergence 用公共 API 驱动复现（两次运行同判） | 淘汰：**非保行为**。共享 `visiting` 的跨根历史依赖是现行可观察语义的一部分，任何"显然的"去重都改判终态 |
| S2-G-3 | `approvedActionIds` copy-on-append（leaseReadyNodes 自动门 + applyApprovalReply 两处）改可变 push | 免 O(A) 拷贝/审批 | ✅（私有数组、无外泄别名，snapshot() 另行拷贝——与 S1-G-9 的别名反例不同） | A=8 实测 delta **14.6~14.9ns/审批**；审批人审门控、每 run 个位数 | 淘汰：亚噪声 |
| S2-G-4 | `expandTaskTransition` 8×8 全对 BFS 结果预计算为模块级冻结表 | 免每次 BFS | ✅ 全 64 (from,to) 对路径/抛错消息重放逐位一致（BFS 对冻结表确定性） | 直边 29~31ns、两步 226~229ns、最坏 BFS **475~482ns**/状态变迁，每 run 几十次 | 淘汰：噪声 + 模块级派生缓存（X1-1 邻域，虽不可变仍无收益支撑） |
| S2-G-5 | `runSupervisorRounds` 每轮 `new ChildCoordinator` 提升到循环外复用 | 免每轮构造（对象 + EventStore + gate） | ❌ **反例**：构造函数消费确定性 `generateId` 一次（`parentAgentInstanceId`），提升后同一 generator 的后续事件 id 全部平移（实测 `evt_id0003` vs `evt_id0002`）——持久化事件流可观察发散 | 单次构造实测 **1.83µs**/轮（收益上界） | 淘汰：**非保行为**（seeded id 流是测试与重放的可观察面）+ µs 级噪声双重淘汰 |
| S2-G-6 | `inspectRun` 两遍事件扫描（先收 answers 再收 questions）合并单遍 + 尾部过滤 pendingQuestions | 2×O(E)→O(E) | ✅ 1000 轮 fuzz（问答乱序/未答/重答）JSON 逐位一致 | E=1000 两遍 6.0µs、单遍 4.9µs，省 **~1.0µs**/次；一次性 CLI 检查路径 | 淘汰：噪声（S1-E-1 姊妹面：那里两遍是语义必需，这里可融合但不值） |
| S2-G-7 | `joinStatus` 的 `map`+2×`filter` 三遍计数融合单遍 | 3 遍→1 遍 | ✅ 2000 轮 fuzz 计数逐位一致 | fan=6 实测 delta **16.3~16.9ns**/joinStatus 调用 | 淘汰：亚噪声（fan 个位数，X4-8 邻域） |
| S2-G-8 | `LeaseRegistry.isExpired` 每查 `Date.parse(expiresAt)` → 租约建立时缓存 epoch ms | 免重复 ISO 解析 | —（值等价平凡，但需在 `TaskLease` 旁挂派生 ms 态） | Date.parse=137~139ns；`expired()` 每轮 L=8 → ~1.1µs；**全 run（32 轮）~35µs** | 淘汰：噪声 + 公开 `TaskLease` 形状旁的隐藏派生状态（X1-1 邻域）；本轮最强合法候选仍低于否决线一个量级 |

## 3. 关键裁决细节

### S2-G-2：为何"显然的" DFS 去重会改判 run 终态（本轮最重要发现）

`failurePathCompletedGraph`（`flowchart-supervisor.ts:461`）用**单个共享
`visiting` Set** 跑 `failedIds.every(handled)`，且 `handled` 在 true 返回
路径上**不清除** `visiting` 中的节点。后果：一旦某条恢复链评估为 true，
链上节点被永久保留在 `visiting` 中，后续 failedIds 再触达这些节点时
`visiting.has(...)` 直接判 false。构造 b→a→C（b、a 均 FAILED，边均为
`success expected:false`，C COMPLETED）：

- 当前实现：`handled(nb)` 经 `handled(na)`→C 返回 true（nb、na 留在
  visiting）；随后 `every` 评估 `handled(na)` 时 `visiting.has(na)` → false
  → **run 终态 FAILED**。
- 记忆化 / 每根新鲜 visiting 的"等价重构"：`handled(na)` 独立评估 → true
  → **run 终态 COMPLETED**。

该场景可用公共 API 真实驱动（lease→fail b→lease→fail a→lease→complete C，
仿真已复现），即它是可达的可观察行为，而非死代码。无论现行语义是否符合
文档注释的直觉（"through a chain of failed recoveries"），**保行为优化的
契约是逐位保留现行可观察裁决**——因此一切改变共享 visiting 历史依赖的
重构（记忆化、fresh-per-root、迭代化重写）都被本反例排除。同时 F（失败
节点数）是几十级上界，重复 DFS 的总量本就是噪声。双重淘汰，且反例入库
供未来轮次直接引用。

### S2-G-5：每轮构造不是浪费，是 id 流的一部分

`runSupervisorRounds` 每轮 `new ChildCoordinator`（`supervisor.ts:341`）看似
可提升复用（省对象/EventStore/ConcurrencyGate 构造）。但构造函数调用
`createAgentInstanceId(generateId)`——在确定性 `generateId` 下每轮消费一个
id。提升后同一 generator 的后续 `createEventId` 输出全部前移（实测
`evt_id0003` → `evt_id0002`），**持久化到 events.jsonl 的事件 id 流可观察
发散**，seeded 重放与既有测试快照全部失效。这与 S1-A-7/S1-B-8（对象身份
可观察改变）同判据：id 流是行为面。且单次构造仅 1.83µs/轮，收益本身也是
噪声。双重淘汰。

### S2-G-1：O(N²) 为何既是真的又不值得修

`leaseReadyNodes` 的循环对**每个节点**（含非 READY 节点）重算
`computeStatus()`（全 runtime Map 扫描）与 `activeCount()`（同样全扫），
使单次调用为 O(N²)。这是排除表未点名的新角度（X4-8 针对的是跨调用增量化，
这里是调用内重复）。但两条独立理由淘汰：(1) **规模**——O(N²) 上界实测
N=24/64 均 ~4-5µs/调用（computeStatus 单次 34~111ns），lease 调用本体连
supervisor 构建在内 <0.1ms，每轮一次、被子代理秒级执行支配；(2) **正确性
面**——循环中途状态真实变化（决策门 `resolveBranchGate`+`propagate` 内联
完成/跳过节点；路由拒绝把节点翻成 FAILED 后 `break`；WAITING_FOR_USER 设
pending 后 break），簿记缓存必须精确追踪全部变异点，复杂度换 µs 是负交易。

### 保行为面复核（在 R1-G 收口之上）

- **O(R×E) 重复 `readAll` 维持排除**（S1-G-1）：`finish()` 的三连读
  （persistCheckpoint 内读 → settle 前读 → 结果读）之间无本进程 append，
  看似可复用——但两读之间**外部进程可以追加**（CLI answer/pause 从独立
  进程写同一 events.jsonl），复用即缓存即 X1-1。复核维持。
- **checkpoint 写前自检维持**（X3-3/X4-1 同域）：每 `persistCheckpoint` 的
  `validateCheckpoint`（validateFlowchart + 快照校验 + `snapshotValidationRouter`
  restore 干跑）是 fail-closed 写前防线，未碰。
- **调度/resume/lease/join**：`planRound` 三段式、孤儿 lease 的
  TIMEOUT→BLOCKED→READY 恢复链、`joinStatus` quorum 计数语义、
  `assertWaiterInvariant` 防线——零 diff。

### 逐文件收口（本轮新视角补充，R1-G 收口之上）

| 文件 | 本轮新检查点 | 结论 |
| --- | --- | --- |
| `supervisor/flowchart-supervisor.ts` | 见 S2-G-1/2/3/7；`readyNodeIds` filter+map 两遍 N 几十噪声；`resolveBranchGate` 的 `selected.includes` 项数个位；`buildBranchPlan` 已 Set 去重 | 无候选落地 |
| `run/supervisor.ts` | 见 S2-G-5；`recordStatus`→`expandTaskTransition` 见 S2-G-4；孤儿 lease 恢复循环 O(L) 一次性；`Object.assign(ledger, advanced)` 就地聚合是既有语义 | 无候选落地 |
| `run/flowchart-run.ts` | `finish()` 三连读复核维持 S1-G-1（跨进程窗口）；`applyLearnedToNode` 的 `prefer.find` 每节点一次、启动时一次性 O(N·L) 几十×几十噪声；`resolveLimits`/`limitsFromSnapshot` 常数 | 无候选 |
| `run/scheduler.ts` | 见 S2-G-8；`planRound` lookup 闭包常数；`applyTaskOutcome` 表长 4（S1-A-8 域） | 无候选落地 |
| `run/inspection.ts` | 见 S2-G-6；`findChild` byRun O(1) 主路径维持 R1-G「记录不改」 | 无候选落地 |
| `run/coordinator.ts` | `startReady` splice/filter = S1-G-6 维持；`handles.filter` 每迭代 O(H)，H ≤ 任务数几十 | 无候选（S1-G-6 遵守） |
| `run/child-coordinator.ts` | `answerQuestion` find+findIndex（S1-B-4 同类、Q 个位）维持不改；`ConcurrencyGate` = S1-G-8 维持；`childStores` 已 Map 缓存 | 无候选 |
| `run/event-store.ts` / `episode-store.ts` | append 写前 validateEvent 是写侧 fail-closed 契约；readAll = S1-G-1 维持 | 无候选 |
| `run/events.ts` | `isBehaviorDistribution` 每事件建 eligible Set——载荷依赖不可提升、个位数键；枚举表 = S1-G-3/S1-B-7 域维持 | 无候选（schema 未碰） |
| `run/replay.ts` | 单遍状态机维持；`validateFlowchartCheckpointState` restore 干跑 = fail-closed 维持 | 无候选 |
| `run/checkpoint-store.ts` / `pause-controller.ts` / `injection.ts` | tmp+fsync+rename 原子写契约；一次性请求路径 | 无候选 |
| `run/child-grounding.ts` / `child-prompt.ts` / `flowchart-executor.ts` / `episode-bind.ts` | 每子任务/每结算一次的 O(输入) 组装；`uniqueArtifacts` 已 Set；`episodeIdFromEvents` 已反向早退 | 无候选 |
| `supervisor/ledger.ts` | `classifyRoundProgress`+`advanceLedgerRound` 双 `isDuplicateFact` 扫描 = **X4-7 维持**（每轮新事实个位数） | 无候选（X4-7 遵守） |
| `supervisor/flowchart-snapshot.ts` | O(state) 每 checkpoint 读写各一次 fail-closed；`isOneOf` 表长 ≤7 | 无候选 |
| `graph/validate.ts` / `readiness.ts` / `judge.ts` / `compile-children.ts` | Kahn = **X4-6 维持**；`computeReadyTasks`/`allDependenciesSatisfied` O(D) 个位；judge filter×includes 证据个位；compile 维持 R1-G 收口 | 无候选（X4-6 遵守） |
| `domain/state.ts` | 见 S2-G-4；`expandTaskTransition` 的 `queue.shift` BFS 队列 ≤8 项（X4-6 同类不另立） | 无候选落地 |
| `domain/flowchart.ts` | `validateJoin` edges.some = S1-G-4 维持；`validateApprovalSelection` 每调用建 Set、项数个位；DFS 环检查一次性 | 无候选（S1-G-4 遵守） |
| `domain/` 其余 15 文件 | 模块级正则 + O(1) 谓词 + 一次性校验器，R1-G 收口维持；`isIsoTimestamp` regex+Date.parse = X1-3 域 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

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

仿真（临时脚本，未入库；完整源码见附录，seeds 固定可复现，两次独立运行
等价/反例结论逐位一致、计时抖动范围内稳定）：

```text
S2-G-1 anchor N=24: whole leaseReadyNodes call (incl. supervisor build 48.1us) = 89.3us -> lease-only ~41.2us; one computeStatus (status getter) = 92ns; O(N^2) upper bound = N * 2 scans = 4.4us/call
S2-G-1 anchor N=64: whole leaseReadyNodes call (incl. supervisor build 64.9us) = 85.5us -> lease-only ~20.6us; one computeStatus (status getter) = 34ns; O(N^2) upper bound = N * 2 scans = 4.3us/call
S2-G-2 counterexample (chained recovery b->a->C): current status=FAILED fresh-visiting-per-root variant=COMPLETED
S2-G-3 anchor A=8: copy-on-append=47.8ns push=33.2ns delta/approval=14.6ns (approvals are human-gated, single digits per run)
S2-G-4 anchor: expandTaskTransition direct=29ns 2-step=226ns worst(BFS)=482ns per status change (tens per run)
S2-G-5 counterexample: next event id after 2 rounds current=evt_id0003 hoisted=evt_id0002 (id stream diverges)
S2-G-5 anchor: one ChildCoordinator construction = 1.83us per round (upper bound of any win)
S2-G-6 bench E=1000: two-pass=6.0us fused=4.9us delta/inspect=1.0us (one-shot CLI inspection)
S2-G-7 bench fan=6: two-filter=30.6ns fused=14.2ns delta/joinStatus=16.3ns
S2-G-8 anchor: Date.parse(ISO)=139ns -> expired() per round at L=8 = 1115ns; per run (32 rounds) = 35.68us
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-G-1 | `leaseReadyNodes` 循环内 `computeStatus`/`activeCount` 每节点重算的调用内缓存 | O(N²) 上界实测 ~4-5µs/调用（N=24/64）；循环中途状态变化（决策门内联解析、路由拒绝 FAILED）是载荷语义，脏标记复杂度换噪声；X4-8 同域规模 |
| S2-G-2 | `failurePathCompletedGraph` 跨 failedIds 记忆化 / 每根新鲜 `visiting` | **非保行为**：共享 visiting 在 true 路径保留节点，链式恢复 b→a→C 下当前判 FAILED、重构判 COMPLETED（公共 API 驱动的反例，可达）；F 几十级本也是噪声 |
| S2-G-3 | `approvedActionIds` copy-on-append 改可变 push | 等价（无外泄别名），但 ~15ns/审批、审批人审门控个位数/run |
| S2-G-4 | `expandTaskTransition` 8×8 全对 BFS 预计算模块表 | 最坏 BFS 仅 ~480ns/状态变迁、每 run 几十次；模块级派生缓存 X1-1 邻域 |
| S2-G-5 | `runSupervisorRounds` 每轮 `new ChildCoordinator` 提升复用 | **非保行为**：构造消费确定性 generateId（parentAgentInstanceId），提升平移后续全部事件 id（实测发散）；构造仅 1.83µs/轮 |
| S2-G-6 | `inspectRun` 两遍扫描合并单遍 + 尾部过滤 pendingQuestions | 等价（1000 轮 fuzz），E=1000 仅省 ~1µs/次、一次性 CLI 检查 |
| S2-G-7 | `joinStatus` map+2×filter 三遍融合单遍计数 | ~16ns/调用、fan 个位数（X4-8 邻域） |
| S2-G-8 | `LeaseRegistry.isExpired` 的 `Date.parse` 重复解析改建立时缓存 ms | 全 run 上界 ~35µs（32 轮 × L=8 × ~139ns），低于战役否决线一个量级；`TaskLease` 公开形状旁的隐藏派生状态（X1-1 邻域） |

重开条件：S2-G-2/5 需先做出**行为变更决策**（分别为失败恢复图裁决语义的
显式重定义、事件 id 流对构造次序不敏感化），届时属功能/语义工作而非保行为
优化；S2-G-1 若 live flowchart 规模增长 ≥2 个量级（数千节点）可凭本报告
O(N²) 测量重开；S2-G-6 若 inspect 移入高频服务路径可凭等价 fuzz 证据重开；
其余为 ns 级常数，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.ts` 后在仓库根目录 `npx tsx <file>`（依赖已装）。
seeds：`0x527206`、`0x527207`（其余段确定性构造，无随机性）。

```ts
/**
 * R2-G deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S2-G-1 .. S2-G-8 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file>
 */
import { performance } from "node:perf_hooks";
import { createEventId, createTaskId, type IdGenerator } from "/workspace/src/domain/ids.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode
} from "/workspace/src/domain/flowchart.js";
import { expandTaskTransition, TASK_TRANSITIONS } from "/workspace/src/domain/state.js";
import type { TaskStatus } from "/workspace/src/domain/status.js";
import { createModelRouter, type ModelRouterConfig } from "/workspace/src/supervisor/model-router.js";
import {
  createFlowchartSupervisor,
  type FlowchartSupervisor,
  type FlowchartSupervisorSnapshot
} from "/workspace/src/supervisor/flowchart-supervisor.js";
import { ChildCoordinator } from "/workspace/src/run/child-coordinator.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "/workspace/src/agents/registry.js";
import type { AgentExecutor } from "/workspace/src/execution/contract.js";
import type { ProjectSnapshot } from "/workspace/src/domain/project.js";
import type { RunId } from "/workspace/src/domain/ids.js";

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

const routerConfig: ModelRouterConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

function mkNode(id: string, role: FlowNode["role"] = "actor"): FlowNode {
  return {
    id,
    taskId: createTaskId(() => `t-${id}`),
    role,
    objective: `Objective for ${id} with enough detail to be realistic`,
    modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

function chainFlowchart(n: number): Flowchart {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    nodes.push(mkNode(`n${i}`));
    if (i > 0) edges.push({ from: `n${i - 1}`, to: `n${i}`, condition: { type: "success", expected: true } });
  }
  return { id: `chain-${n}`, nodes, edges };
}

function freshSupervisor(fc: Flowchart): FlowchartSupervisor {
  return createFlowchartSupervisor({
    flowchart: fc,
    router: createModelRouter(routerConfig),
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3 }
  });
}

/* ============================================================
 * S2-G-1: leaseReadyNodes recomputes computeStatus() (O(N)) and
 * activeCount() (O(N)) inside the per-node loop -> O(N^2)/call.
 * Candidate: change-driven caching within the call. Anchors: whole
 * leaseReadyNodes cost, isolated status-getter cost. The mid-loop
 * recomputation is load-bearing (decision gates resolve inline via
 * resolveBranchGate+propagate; router refusal flips a node to FAILED),
 * so a cache needs dirty-tracking; the anchor bounds any possible win.
 * ============================================================ */
for (const n of [24, 64]) {
  const fc = chainFlowchart(n);
  const statusCost = (() => {
    const sv = freshSupervisor(fc);
    return bench(() => void sv.status, 20000);
  })();
  const leaseCost = bench(() => {
    const sv = freshSupervisor(fc);
    sv.leaseReadyNodes();
  }, 500);
  const createCost = bench(() => freshSupervisor(fc), 500);
  console.log(
    `S2-G-1 anchor N=${n}: whole leaseReadyNodes call (incl. supervisor build ${(createCost * 1e3).toFixed(1)}us) = ${(leaseCost * 1e3).toFixed(1)}us -> lease-only ~${((leaseCost - createCost) * 1e3).toFixed(1)}us; one computeStatus (status getter) = ${(statusCost * 1e6).toFixed(0)}ns; O(N^2) upper bound = N * 2 scans = ${(n * 2 * statusCost * 1e3).toFixed(1)}us/call`
  );
}

/* ============================================================
 * S2-G-2: failurePathCompletedGraph memoization / fresh-visiting-per-root.
 * COUNTEREXAMPLE: the shared `visiting` set retains nodes on true-returning
 * paths, so a chained recovery (b FAILED -> a FAILED -> C COMPLETED) yields
 * FAILED under the current code, while any restructure that evaluates each
 * failed root independently (fresh visiting or memo) yields COMPLETED.
 * The candidate is therefore NOT behavior-preserving.
 * ============================================================ */
{
  const fc: Flowchart = {
    id: "chained-recovery",
    nodes: [mkNode("nb"), mkNode("na"), mkNode("nc")],
    edges: [
      { from: "nb", to: "na", condition: { type: "success", expected: false } },
      { from: "na", to: "nc", condition: { type: "success", expected: false } }
    ]
  };
  const sv = freshSupervisor(fc);
  const fail = { outcome: "FAILURE" as const };
  const ok = { outcome: "SUCCESS" as const, confidence: validateConfidenceScore(0.9) };
  sv.leaseReadyNodes();
  sv.applyChildResult("nb", fail);
  sv.advanceRound();
  sv.leaseReadyNodes();
  sv.applyChildResult("na", fail);
  sv.advanceRound();
  sv.leaseReadyNodes();
  sv.applyChildResult("nc", ok);
  sv.advanceRound();
  const currentStatus = sv.status;

  // Candidate variant reimplemented from the snapshot: fresh visiting per root.
  const variantStatus = (snapshot: FlowchartSupervisorSnapshot, edges: readonly FlowEdge[]): string => {
    const state = (id: string): string => snapshot.nodes[id]!.state;
    const failedIds = Object.keys(snapshot.nodes).filter((id) => state(id) === "FAILED");
    const outgoing = new Map<string, FlowEdge[]>();
    for (const edge of edges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }
    const handledFrom = (root: string): boolean => {
      const visiting = new Set<string>();
      const rec = (nodeId: string): boolean => {
        if (visiting.has(nodeId)) return false;
        visiting.add(nodeId);
        for (const edge of outgoing.get(nodeId) ?? []) {
          if (edge.condition.type !== "success" || edge.condition.expected !== false) continue;
          const dest = state(edge.to);
          if (dest === "COMPLETED") return true;
          if (dest === "FAILED" && rec(edge.to)) return true;
        }
        visiting.delete(nodeId);
        return false;
      };
      return rec(root);
    };
    return failedIds.every(handledFrom) ? "COMPLETED" : "FAILED";
  };
  const variant = variantStatus(sv.snapshot(), fc.edges);
  console.log(
    `S2-G-2 counterexample (chained recovery b->a->C): current status=${currentStatus} fresh-visiting-per-root variant=${variant}`
  );
  check(
    "S2-G-2 divergence demonstrated (candidate is NOT behavior-preserving)",
    currentStatus !== variant,
    `current=${currentStatus} variant=${variant}`
  );

  // Sanity: on a single handled failure both agree (COMPLETED).
  const fc2: Flowchart = {
    id: "single-recovery",
    nodes: [mkNode("mb"), mkNode("mc")],
    edges: [{ from: "mb", to: "mc", condition: { type: "success", expected: false } }]
  };
  const sv2 = freshSupervisor(fc2);
  sv2.leaseReadyNodes();
  sv2.applyChildResult("mb", fail);
  sv2.advanceRound();
  sv2.leaseReadyNodes();
  sv2.applyChildResult("mc", ok);
  sv2.advanceRound();
  const v2 = variantStatus(sv2.snapshot(), fc2.edges);
  check("S2-G-2 sanity: single handled failure agrees", sv2.status === "COMPLETED" && v2 === "COMPLETED", `${sv2.status}/${v2}`);
}

/* ============================================================
 * S2-G-3: approvedActionIds copy-on-append -> mutable push.
 * Equivalence is trivial (private array, snapshot() copies it out);
 * anchor the per-approval cost at realistic accumulated size.
 * ============================================================ */
{
  const A = 8;
  const base = Array.from({ length: A }, (_, i) => `action-${i}`);
  const selected = ["route:premium"];
  const copyCost = bench(() => {
    let arr = [...base];
    arr = [...arr, ...selected];
    void arr;
  }, 200000);
  const pushCost = bench(() => {
    const arr = [...base];
    arr.push(...selected);
    void arr;
  }, 200000);
  console.log(
    `S2-G-3 anchor A=${A}: copy-on-append=${(copyCost * 1e6).toFixed(1)}ns push=${(pushCost * 1e6).toFixed(1)}ns delta/approval=${((copyCost - pushCost) * 1e6).toFixed(1)}ns (approvals are human-gated, single digits per run)`
  );
}

/* ============================================================
 * S2-G-4: expandTaskTransition all-pairs precomputed module table.
 * Equivalence: BFS is deterministic over the frozen TASK_TRANSITIONS
 * table, so a precomputed table is same-valued by construction; verify
 * by comparing every (from,to) pair (paths and thrown errors). Anchor
 * the per-call BFS cost.
 * ============================================================ */
{
  const STATUSES = Object.keys(TASK_TRANSITIONS) as TaskStatus[];
  const outcomes = new Map<string, { path?: TaskStatus[]; error?: string }>();
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      try {
        outcomes.set(`${from}->${to}`, { path: expandTaskTransition(from, to) });
      } catch (error) {
        outcomes.set(`${from}->${to}`, { error: (error as Error).message });
      }
    }
  }
  // Re-run: deterministic same-valued results (the precomputed table would
  // just freeze these values).
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const prev = outcomes.get(`${from}->${to}`)!;
      try {
        const path = expandTaskTransition(from, to);
        check("S2-G-4 equivalence", prev.path !== undefined && JSON.stringify(path) === JSON.stringify(prev.path), `${from}->${to}`);
      } catch (error) {
        check("S2-G-4 equivalence", prev.error === (error as Error).message, `${from}->${to}`);
      }
    }
  }
  const direct = bench(() => expandTaskTransition("READY", "RUNNING"), 200000);
  const expanded = bench(() => expandTaskTransition("PENDING", "RUNNING"), 200000);
  const worst = bench(() => expandTaskTransition("PENDING", "FAILED"), 200000);
  console.log(
    `S2-G-4 anchor: expandTaskTransition direct=${(direct * 1e6).toFixed(0)}ns 2-step=${(expanded * 1e6).toFixed(0)}ns worst(BFS)=${(worst * 1e6).toFixed(0)}ns per status change (tens per run)`
  );
}

/* ============================================================
 * S2-G-5: hoisting the per-round `new ChildCoordinator` out of the
 * runSupervisorRounds loop. COUNTEREXAMPLE: the constructor consumes one
 * id from the deterministic generator (parentAgentInstanceId), so the
 * hoisted variant shifts every subsequent event id -> the persisted
 * event stream observably diverges under a seeded IdGenerator.
 * ============================================================ */
{
  const seqGen = (): IdGenerator => {
    let n = 0;
    return () => {
      n += 1;
      return `id${String(n).padStart(4, "0")}`;
    };
  };
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const executorStub: AgentExecutor = {
    // Never invoked in this probe.
    execute: () => {
      throw new Error("not used");
    }
  } as unknown as AgentExecutor;
  const project = { id: "prj_s2g5", rootPath: "/tmp" } as unknown as ProjectSnapshot;
  const mkCoordinator = (generateId: IdGenerator): ChildCoordinator =>
    new ChildCoordinator({
      stateRoot: "/tmp/s2g5-state",
      executor: executorStub,
      parentRunId: "run_s2g5" as RunId,
      project,
      registry,
      maxConcurrentTasks: 4,
      generateId
    });

  // Current shape: one coordinator constructed per round (2 rounds here).
  const genA = seqGen();
  mkCoordinator(genA);
  mkCoordinator(genA);
  const eventIdCurrent = createEventId(genA);
  // Hoisted shape: one coordinator reused across rounds.
  const genB = seqGen();
  mkCoordinator(genB);
  const eventIdHoisted = createEventId(genB);
  console.log(
    `S2-G-5 counterexample: next event id after 2 rounds current=${eventIdCurrent} hoisted=${eventIdHoisted} (id stream diverges)`
  );
  check("S2-G-5 divergence demonstrated (candidate changes observable event ids)", eventIdCurrent !== eventIdHoisted);
  const ctorCost = bench(() => mkCoordinator(() => "fixedsuffix"), 5000);
  console.log(`S2-G-5 anchor: one ChildCoordinator construction = ${(ctorCost * 1e3).toFixed(2)}us per round (upper bound of any win)`);
}

/* ============================================================
 * S2-G-6: inspectRun two passes over events -> single pass + final
 * pendingQuestions filter. Equivalence fuzz over synthetic event mixes
 * (answers may arrive after their questions) + bench at E=1000.
 * ============================================================ */
{
  const rng = mulberry32(0x527206);
  interface MiniQuestion {
    type: "QUESTION" | "TASK_RESULT";
    id: string;
    runId: string;
  }
  interface MiniEvent {
    type: "USER_ANSWER" | "CHILD_MESSAGE" | "OTHER";
    payload: { messageId?: string; answer?: string; message?: MiniQuestion };
  }
  interface ScanResult {
    pending: string[];
    answers: Array<{ messageId: string; answer: string }>;
  }
  // Verbatim shape of the current two-pass logic (answers first, then questions).
  const currentScan = (events: readonly MiniEvent[]): ScanResult => {
    const answered = new Set<string>();
    const answers: ScanResult["answers"] = [];
    for (const event of events) {
      if (event.type === "USER_ANSWER") {
        answered.add(event.payload.messageId!);
        answers.push({ messageId: event.payload.messageId!, answer: event.payload.answer! });
      }
    }
    const pending: string[] = [];
    for (const event of events) {
      if (event.type === "CHILD_MESSAGE") {
        const message = event.payload.message!;
        if (message.type === "QUESTION" && !answered.has(message.id)) pending.push(message.id);
      }
    }
    return { pending, answers };
  };
  // Candidate: single pass, filter pending at the end.
  const fusedScan = (events: readonly MiniEvent[]): ScanResult => {
    const answered = new Set<string>();
    const answers: ScanResult["answers"] = [];
    const questions: string[] = [];
    for (const event of events) {
      if (event.type === "USER_ANSWER") {
        answered.add(event.payload.messageId!);
        answers.push({ messageId: event.payload.messageId!, answer: event.payload.answer! });
      } else if (event.type === "CHILD_MESSAGE") {
        const message = event.payload.message!;
        if (message.type === "QUESTION") questions.push(message.id);
      }
    }
    return { pending: questions.filter((id) => !answered.has(id)), answers };
  };
  for (let trial = 0; trial < 1000; trial += 1) {
    const events: MiniEvent[] = [];
    const openQuestions: string[] = [];
    const count = 5 + Math.floor(rng() * 40);
    for (let i = 0; i < count; i += 1) {
      const r = rng();
      if (r < 0.4) {
        const id = `msg_q${trial}_${i}`;
        openQuestions.push(id);
        events.push({ type: "CHILD_MESSAGE", payload: { message: { type: "QUESTION", id, runId: "run_x" } } });
      } else if (r < 0.7 && openQuestions.length > 0) {
        const id = openQuestions[Math.floor(rng() * openQuestions.length)]!;
        events.push({ type: "USER_ANSWER", payload: { messageId: id, answer: `answer for ${id}` } });
      } else {
        events.push({ type: "OTHER", payload: {} });
      }
    }
    check(
      "S2-G-6 equivalence",
      JSON.stringify(currentScan(events)) === JSON.stringify(fusedScan(events)),
      `trial ${trial}`
    );
  }
  const big: MiniEvent[] = [];
  for (let i = 0; i < 1000; i += 1) {
    if (i % 10 === 3) big.push({ type: "CHILD_MESSAGE", payload: { message: { type: "QUESTION", id: `msg_b${i}`, runId: "run_x" } } });
    else if (i % 10 === 7) big.push({ type: "USER_ANSWER", payload: { messageId: `msg_b${i - 4}`, answer: "yes" } });
    else big.push({ type: "OTHER", payload: {} });
  }
  const cur = bench(() => currentScan(big), 3000);
  const fus = bench(() => fusedScan(big), 3000);
  console.log(
    `S2-G-6 bench E=1000: two-pass=${(cur * 1e3).toFixed(1)}us fused=${(fus * 1e3).toFixed(1)}us delta/inspect=${((cur - fus) * 1e3).toFixed(1)}us (one-shot CLI inspection)`
  );
}

/* ============================================================
 * S2-G-7: joinStatus map + 2x filter -> fused single-pass counters.
 * Equivalence fuzz over random status arrays + bench at fan=6.
 * ============================================================ */
{
  const rng = mulberry32(0x527207);
  type EdgeStatus = "SATISFIED" | "UNSATISFIED" | "PENDING";
  const kinds: readonly EdgeStatus[] = ["SATISFIED", "UNSATISFIED", "PENDING"];
  const currentCounts = (statuses: readonly EdgeStatus[]): { satisfied: number; pending: number } => ({
    satisfied: statuses.filter((status) => status === "SATISFIED").length,
    pending: statuses.filter((status) => status === "PENDING").length
  });
  const fusedCounts = (statuses: readonly EdgeStatus[]): { satisfied: number; pending: number } => {
    let satisfied = 0;
    let pending = 0;
    for (const status of statuses) {
      if (status === "SATISFIED") satisfied += 1;
      else if (status === "PENDING") pending += 1;
    }
    return { satisfied, pending };
  };
  for (let trial = 0; trial < 2000; trial += 1) {
    const statuses = Array.from({ length: Math.floor(rng() * 10) }, () => pick(rng, kinds));
    const a = currentCounts(statuses);
    const b = fusedCounts(statuses);
    check("S2-G-7 equivalence", a.satisfied === b.satisfied && a.pending === b.pending, `trial ${trial}`);
  }
  const fan6 = Array.from({ length: 6 }, () => pick(rng, kinds));
  const cur = bench(() => currentCounts(fan6), 500000);
  const fus = bench(() => fusedCounts(fan6), 500000);
  console.log(
    `S2-G-7 bench fan=6: two-filter=${(cur * 1e6).toFixed(1)}ns fused=${(fus * 1e6).toFixed(1)}ns delta/joinStatus=${((cur - fus) * 1e6).toFixed(1)}ns`
  );
}

/* ============================================================
 * S2-G-8: LeaseRegistry.isExpired re-parses expiresAt per check ->
 * cache epoch ms next to the lease. Anchor the Date.parse cost and the
 * per-round total at L = maxConcurrentTasks leases.
 * ============================================================ */
{
  const iso = "2026-08-24T05:00:00.000Z";
  const parse = bench(() => Date.parse(iso), 500000);
  const L = 8;
  const rounds = 32;
  console.log(
    `S2-G-8 anchor: Date.parse(ISO)=${(parse * 1e6).toFixed(0)}ns -> expired() per round at L=${L} = ${(parse * L * 1e6).toFixed(0)}ns; per run (${rounds} rounds) = ${(parse * L * rounds * 1e3).toFixed(2)}us`
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

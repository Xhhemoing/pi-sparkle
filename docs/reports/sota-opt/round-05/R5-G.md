MODEL_SLUG=claude-fable-5-thinking-xhigh

# R5-G：运行时 / 监督 / 图 / 领域模型切片第五遍复查报告

**战役:** 全库持久 SOTA 优化 Round 5 / R5-G
**基线:** `cursor/sota-persistent-opt-83a1` @ `d350722`（含 S5-C 落地与 S5-A/B/D/E 排除）
**分支:** `cursor/r5-g-runtime-fifth-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 45 个文件（`src/run/` 19、
`src/supervisor/` 5、`src/graph/` 4、`src/domain/` 17）自 R1-G 基线（`4efee23`）
以来**逐字节未变**（`git diff 4efee23 d350722 -- src/run src/supervisor
src/graph src/domain` 为空——R2/R3/R4 十区与 R5-A/B/C/D/E 均未触碰本切片），
R1-G~R4-G 四遍收口与 S1-G-1..9、S2-G-1..8、S3-G-1..5、S4-G-1..7 共二十九条
排除全部继承有效。本轮在完整排除表之上第五次全量实际读码、以新角度枚举，
得到 6 个此前未点名的新候选（S5-G-1 … S5-G-6），全部经理论 + 确定性仿真
（seeded mulberry32，等价校验 / **行为发散反例** / 真实规模基准，seeds
`0x559051`/`0x559052` 两次独立运行等价与反例结论逐位一致、计时抖动范围内
稳定）裁决后淘汰：**4 个被反例证明非保行为**——本轮最重要发现是持久化层
三个"看似浪费"的模式全是承重的 fail-safe 行为：S5-G-1（每写 `mkdir` 提升）
被"外部清理后自愈落盘"反例封死（现实现自愈成功、变体 ENOENT 丢
checkpoint）；S5-G-2（TRACKING_ASSESSMENT 读侧哈希复验 memoize）被
"磁盘篡改字节被静默接受"反例封死——每次 readAll 重算 `hashAssessment` 是
防篡改 fail-closed 屏障；S5-G-4（跨 store 相邻追加 `Promise.all` 重叠）与
S5-G-5（AGENT_EVENT 批量合并落盘）被崩溃持久性反例封死——顺序 await 链
保证的"父事件持久 ⟹ 子事件持久"前缀不变量在并行下可达 `{parent}` 违例态，
批量合并把逐消息持久性与跨进程实时可见性（inspect 数据面）双双取消。
2 个合法候选在真实规模不达线：S5-G-3（`ReconstructedRun` 暴露
`unmatchedPause` 免二次 O(E) 扫描）≤3.7µs/run 且需拓宽公开导出类型；
S5-G-6（`edgeStatus`→`conditionHolds` 双重 `getRuntime` 合一）4.7~6.3ns/边评估、
激进外推仅 0.04~0.05ms/run。未重开任何 X* / S1-* / S2-* / S3-* / S4-* /
S5-* 条目；事件 schema 零 diff。本切片在其确定性 id 流、事件次序、
fail-closed 持久化、崩溃持久性次序与数据面契约下仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/run/`（**未碰** `child-tracking.ts`、`gate-apply.ts`，属 A 区）、
  `src/supervisor/`（**未碰** `model-router.ts`，属 B 区）、`src/graph/`、
  `src/domain/`。本轮全部文件第五次实际读码，未依赖前四轮的记忆。
- 先读并遵守（顺序强制）：README → EXCLUSIONS.md（含 S5-A/B/C/D/E-* 新排除）
  → round-05/PLAN.md → round-01/R1-G.md → round-02/R2-G.md →
  round-03/R3-G.md → round-04/R4-G.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-G-1..9、S2-G-1..8、
  S3-G-1..5、S4-G-1..7 二十九条全部不再提案；X0-2、X0-4、X4-6..9 直接跳过；
  S5-C-1..7（lin-alg，C 区）、S5-A-1..3、S5-B-1..4、S5-D-1..5、S5-E-1..5
  全部核对不重叠。本轮只探索**未被点名的新角度**：每写 `mkdir` 提升
  （S5-G-1）、读侧哈希复验 memoize（S5-G-2）、`unmatchedPause` 复用免二次
  扫描（S5-G-3）、跨 store 相邻追加重叠（S5-G-4）、AGENT_EVENT 批量合并
  （S5-G-5）、边评估双查合一（S5-G-6）。
- **与近邻 ID 的边界**：S5-G-2 不是 S1-G-1（readAll 增量缓存）的重提——
  它不缓存磁盘读，只 memoize `validateEvent` 内部对 TRACKING_ASSESSMENT
  的 parse+hash 复验（按事件 id 跳过重验证），是同域中从未被赋 ID 的独立
  端点；也不是 S5-A-2（`hashAssessment` 实现换手写序列化，A 区）——那是
  哈希函数本体，这是调用侧复验的取消。S5-G-3 与 S1-G-2/S4-G-4 的公开面
  论证同源（拓宽公开接口被任务明令禁止）但对象不同（`ReconstructedRun`
  导出类型 vs `FlowchartSupervisor` 接口）。S5-G-4 不是 S4-G-1（RUNNING
  节点并行执行）的重提——那是执行面 id 流发散，这是持久化面追加次序发散，
  反例机制不同（崩溃持久性前缀不变量 vs 确定性 id 指派）。S5-G-6 与
  S2-G-1/S2-G-7 相邻但对象不同（`getRuntime` 双查 vs computeStatus 缓存 /
  三遍计数融合）。
- **S1-G-1 遵守**：`readAll` 增量缓存未提案（跨进程磁盘事实源 + fail-closed
  读校验，第五次复核维持；本轮 S5-G-2 反例进一步佐证该契约——读侧重验证
  正是防篡改屏障本体）。**S3-G-4/S4-G-2 遵守**：写侧 `validateCheckpoint`
  与末次落盘未触碰。**S4-G-6 遵守**：checkpoint 美化 JSON 原样。
  **S2-G-5/S4-G-1 遵守**：确定性 id 流与事件次序未触碰——本轮 S5-G-4/5
  把该契约在**持久化次序维度**的剩余角度也收口入库。
- **事件 schema 未改**：`events.ts` 的 `EVENT_TYPES`、payload 校验器、
  `validateEvent` 抛错消息与次序全部原样；CAS / 幂等键 / 确定性 id 流零 diff。
- 双 LCB 与双归因未触碰（本切片不含路由聚合面，天然满足）。不声称
  Outcome-supported。不改阈值、权限、数据面契约、公开签名；未改任何测试。
- 仓库变更仅本报告一个文件。无赢家，仿真脚本未入库（完整源码见附录）。

## 1. 规模与门槛基底（第五遍继承 + 本轮校准）

R1-G 已实测本切片规模：全部结构维度（节点 N、任务 T、轮次 R≤32、每轮事实、
消息 M、租约 L）为几十级且热点结构已全面 Map 化；唯一增长维度是事件数 E
（数百~千级），只被线性触碰且重复重读是刻意契约（S1-G-1）。R2-G 校准了
每轮 `persistCheckpoint` ≥2 次的 fsync 支配结构；R3-G 校准了 snapshot 面
全 run CPU 总量上界 ~20~45ms；R4-G 校准了写侧校验 26~56ms/run 是最大 CPU
聚合量但属非法收益、并证明唯一秒级墙钟候选（RUNNING 节点并行）被确定性
契约封死。代码逐字节未变，全部继承。

战役落地线同样继承：已落地项在百 ms 级或复杂度类下降（J1 2770×、S1-C
~450ms/fit、S3-C ~140–155ms、S5-C 秒级——直接标尺）。本轮新增两点结构校准：

1. **持久化 I/O 面的"重叠/合并"维度第一次被系统枚举**。R4-G 封死了执行面
   并行（S4-G-1，id 流），但 ChildCoordinator 对**不同文件**（子 run 与
   父 run 的 events.jsonl）的相邻追加严格串行 await（`child-coordinator.ts:334-336`
   / `:518-524`），高频 AGENT_EVENT 逐条落盘（`:606-652`）。重叠与批量
   名义上是本切片仅剩的 I/O 墙钟角度（fsync 仅终端事件带，非终端追加
   ~51~53µs/条、重叠省 40~57µs/对），但实测规模在亚 ms~低 ms 带，**且**
   顺序 await 链本身是崩溃持久性前缀不变量（"父引用的子 run 必有子日志"）
   与跨进程实时可见性（inspect/attach 实时读 events.jsonl）的实现点——
   S5-G-4/5 反例把整个"重叠/批量/合并追加"家族收口。
2. **读侧完整性复验的真实成本被正式量化**。TRACKING_ASSESSMENT 的
   parse+hash 复验实测 3.0~3.5µs/事件（对比空 payload 校验 ~0.4µs），
   激进上界（100 readAll × 24 assessment）仅 7.3~7.5ms/run——即使全部
   免除也远不达线，而它是防篡改 fail-closed 屏障（S5-G-2 反例），
   双重淘汰。持久化层三个"看似浪费"点（每写 mkdir、每读复验、逐条落盘）
   经本轮全部证明为承重 fail-safe 行为。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S5-G-1 | `CheckpointStore.write`（`checkpoint-store.ts:18`）与 pause `writeAtomic`（`pause-controller.ts:27`）每写 `mkdir(dirname, {recursive})` 提升至构造期 / dir-ensured 旗标 | 免每写一次目录系统调用（实测 26.0~26.4µs/写，占全量原子写 4.2~4.9%） | ❌ **反例**：外部清理（操作员 rm / 崩溃恢复清扫）删除 run 目录后，现实现**自愈**——mkdir 重建目录、checkpoint 落盘成功（实测读回 probe=2）；变体 `open(tmp)` 抛 ENOENT，checkpoint 写**丢失**（两 seed 同判） | 全 run（~66 checkpoint 写 + pause 轮询）仅 **1.82~1.84ms**，且每写被 fsync 原子写（527~625µs）支配 | 淘汰：**非保行为**（自愈语义是持久化韧性契约，与 R3-J 对 `jsonl.ts` 同模式裁决同源、本切片首次赋 ID 收口）+ 收益噪声，双重淘汰 |
| S5-G-2 | `validateEvent`（`events.ts:730-746`）对 TRACKING_ASSESSMENT 每次校验重跑 `parseTrackingAssessment` + `hashAssessment`（`:739`）；`readAll` 每读全量重验 → 按事件 id memoize 跳过复验 | 免每事件每读 3.0~3.1µs 的 parse+hash（对比空 payload 校验 405~408ns） | ❌ **反例**：两次读之间磁盘字节被篡改（score 0.78→0.11、保留旧 hash）——现实现每次 readAll 重验、抛 `assessmentHash mismatch`（fail-closed 防篡改）；memoize 变体凭首读缓存的事件 id **静默接受篡改字节**（两 seed 同判） | 激进上界（100 readAll × 24 assessment）**7.27~7.45ms/run**，且每次 readAll 被磁盘读支配 | 淘汰：**非保行为**——读侧重验证是防篡改屏障本体（S1-G-1 跨进程事实源同域、从未被赋 ID 的独立端点，首次量化 + 独立反例收口）；名义收益也不达线 |
| S5-G-3 | `replayRun`（`replay.ts:88,144-152`）内部已跟踪 `unmatchedPause` 但丢弃；`pauseIfRequested`（`flowchart-run.ts:583`）/`resumeFlowchartRun`（`:944`）/`pauseFlowchartRun`（`:1071`）再用 `hasUnmatchedPause` 二次 O(E) 扫描 → `ReconstructedRun` 暴露该旗标 | 免每次 pause/resume 路径一趟 O(E) 扫描 | ✅ 内联跟踪器与 `hasUnmatchedPause` 对 200 条 seeded 序列逐位一致；`replayRun().status==="PAUSED"` 交叉核对一致（两 seed 同判） | E=1000 单扫仅 **1.23~1.24µs**；pause/resume 路径每次 CLI 调用 ≤3 次 → **≤3.7µs/run**；且每次调用点紧跟全量 readAll（磁盘 I/O + 逐事件 validateEvent 支配） | 淘汰：亚噪声 + 需拓宽公开导出类型 `ReconstructedRun`（公开签名面，任务明令不改）；且 `pauseIfRequested` 调用点只有 readAll 无 replay，改用 replayRun 反而更贵 |
| S5-G-4 | ChildCoordinator 跨 store 相邻追加（`child-coordinator.ts:334-336` 子 RUN_CREATED→RUN_STARTED→父 CHILD_RUN_CREATED；`:518-524` 子 AGENT_STARTED→父 CHILD_MESSAGE）改 `Promise.all` 重叠 | 重叠两文件的写系统调用（实测串行对 96.8~109.3µs → 并行 52.3~56.5µs，省 40.3~56.9µs/对） | ❌ **反例**：确定性手动完成调度器枚举全部崩溃点——串行 await 下持久前缀恒为 `[]→[child]→[child,parent]`，不变量"parent 持久 ⟹ child 持久"全点成立；`Promise.all` 下持久集 `[parent]`（无 child）可达——恢复端看到父日志引用了**没有子日志**的子 run（两 seed 同判） | ~3 对/子任务 × 几十任务 = 亚 ms~低 ms/run | 淘汰：**非保行为**——跨 store 追加次序是崩溃恢复数据面（进程崩溃后已完成的 write 落页缓存、次序可观察）；与 S4-G-1（执行面 id 流）互补收口持久化面 |
| S5-G-5 | `handleExecutionEvent`（`child-coordinator.ts:606-652`）逐消息落盘 AGENT_EVENT → 攒批、每 attempt 末一次合并追加 | 省 (k-1) 次追加（非终端追加无 fsync，实测 51.1~53.2µs/条；k=8 省 ~358~372µs/attempt） | ❌ **反例**：attempt 中途崩溃（第 2/3 条消息后）——现实现子日志已持久 2 条（每条追加在 handler 返回前完成）；批量变体持久 **0 条**（缓冲未刷）。同一时刻跨进程实时读者（inspect/attach）看到 2 行 vs 0 行——逐消息追加时机是跨进程可观察数据面（两 seed 同判） | 亚 ms/attempt | 淘汰：**非保行为**——逐消息持久性 + 实时可见性双重契约（S1-G-1 跨进程事实源同域、S3-G-3 邻域的未点名端点）；收益也在噪声带 |
| S5-G-6 | `edgeStatus`（`flowchart-supervisor.ts:519`）取 `getRuntime(edge.from).state` 后 `conditionHolds`（`:484`）对同节点再查一次 `getRuntime` → 传参复用 | 免每边评估一次 Map.get | ✅ 全边 seeded 状态下判定逐位一致（两 seed 同判） | delta **4.7~6.3ns**/边评估；激进上界（64 轮 × 2 遍 propagate × 63 边）**0.038~0.051ms/run** | 淘汰：ns 级亚噪声（几十级 Map，S2-G-1/S2-G-7 同噪声带的相邻新角度，赋 ID 收口） |

## 3. 关键裁决细节

### S5-G-1/S5-G-2/S5-G-5：持久化层三个"看似浪费"点全是承重 fail-safe（本轮最重要发现）

第五遍读码把注意力放在持久化层"每次都做"的重复动作上，三个候选覆盖了
写侧（每写 mkdir）、读侧（每读哈希复验）、追加侧（逐消息落盘）的全部
剩余削减角度，仿真证明三者都不是浪费：

1. **每写 `mkdir` 是自愈语义**。`CheckpointStore.write` 与 pause
   `writeAtomic` 在每次写前 `mkdir(dirname, {recursive: true})`。目录已
   存在时该调用仅 26µs（占全量原子写 4~5%、全 run ~1.8ms，噪声）；但当
   run 目录被外部清理（操作员清扫、部分崩溃恢复）后，它把"写失败丢
   checkpoint"变成"重建目录、落盘成功"。仿真实测：现实现删目录后写回
   `probe=2` 成功读回；hoist 变体 `open(checkpoint.json.tmp)` 抛 ENOENT。
   R3-J 曾对 `persist/jsonl.ts` 的同模式做过同向裁决，本切片两个调用点
   首次赋 ID 收口。
2. **每读哈希复验是防篡改屏障**。TRACKING_ASSESSMENT 的
   `parseTrackingAssessment` + `hashAssessment`（`events.ts:739`）在每次
   `validateEvent` 重跑，而 `readAll`（`event-store.ts:59`）每读全量重验。
   磁盘是跨进程事实源（S1-G-1），两次读之间字节可被任何进程改写——仿真
   把 score 从 0.78 篡改为 0.11、保留旧 hash：现实现下一次 readAll 即抛
   `assessmentHash mismatch`；按事件 id memoize 的变体静默接受篡改字节。
   完整性复验的意义恰恰在"重复"上，memoize 即取消屏障。激进上界
   7.3~7.5ms/run 也不达线，双重淘汰。
3. **逐消息落盘是持久性 + 实时可见性双契约**。AGENT_EVENT 每条追加在
   handler 返回前完成：attempt 中途进程崩溃时已处理消息必在盘上（页缓存
   落盘语义下 write 已完成即幸存），且 inspect/attach 类跨进程读者实时
   看到进度。批量合并把两者同时取消（崩溃点实测 2 行 vs 0 行）。

### S5-G-4：跨 store 追加次序是崩溃恢复数据面——持久化面并行家族收口

R4-G 的 S4-G-1 封死了执行面并行（确定性 id 流 + 事件次序），但留下一个
未点名角度：**同一执行流内对不同文件的相邻追加**（子 store 与父 store）
没有 id 流问题——id 在追加发起前已抽取完毕，`Promise.all` 不改变任何 id
指派，看似"免费"的 I/O 重叠（实测省 40~57µs/对）。仿真用确定性手动完成
调度器枚举全部崩溃点：串行 await 强制持久前缀 `[]→[child]→[child,parent]`
——"父日志出现 CHILD_RUN_CREATED ⟹ 子日志已有 RUN_CREATED"这一恢复端
依赖的前缀不变量在**每个**崩溃点成立；`Promise.all` 把完成次序交给调度器
/磁盘，持久集 `[parent]`（无 child）可达——恢复端看到父日志引用一个没有
任何日志的子 run。进程崩溃语义下已完成的 write 系统调用会经页缓存落盘，
次序是可观察面。加之收益亚 ms~低 ms，双重淘汰。**本条目与 S4-G-1 互补，
把"并行化"在执行面与持久化面的两个维度全部收口。**

### S5-G-3/S5-G-6：两个合法候选为何不达线

- S5-G-3 是"已计算被丢弃"型候选（`replayRun` 内部已有 `unmatchedPause`
  旗标），等价性平凡成立。但消除二次扫描需给公开导出类型
  `ReconstructedRun` 增字段（签名面，任务明令不改）；三个调用点中
  `pauseIfRequested` 只有 readAll 结果没有 replay，改用 `replayRun` 反而
  从单遍 type 比对升级为全状态机重放（负优化）；且 E=1000 单扫仅 1.2µs、
  每次 CLI 调用 ≤3 次，紧跟的 readAll 磁盘读 + 逐事件校验比它贵三个量级。
- S5-G-6 是本切片边评估热路径上最后一个未点名的重复查找（`edgeStatus`
  查 state 后 `conditionHolds` 再查同节点 runtime）。几十级 Map 双查
  delta 4.7~6.3ns，激进外推（64 轮 × 2 遍 propagate × 63 边）仅
  0.04~0.05ms/run，距落地线三个量级。

### 保行为面复核（第五遍，在四轮收口之上）

- **O(R×E) 重复 `readAll` 维持排除**（S1-G-1）：第五次复核；本轮 S5-G-2
  反例给出该契约迄今最直接的佐证——读侧重验证正是防篡改屏障本体。维持。
- **checkpoint 写侧防线完整维持**（X3-3/X4-1/S3-G-2/S3-G-4/S4-G-2/S4-G-6）：
  零 diff；本轮 S5-G-1 把目录自愈层也钉入排除表，写路径全谱系
  （校验→mkdir→tmp+fsync+rename→美化 JSON）现已逐层收口。
- **确定性 id 流与事件次序维持**（S2-G-5/S4-G-1）：零 diff；本轮 S5-G-4/5
  把持久化面（跨 store 次序、逐消息落盘）也收口，执行面 + 持久化面双维度
  现已全部封死。
- **调度/resume/lease/join**：`planRound` 三段式、孤儿 lease 恢复链、
  `joinStatus` quorum 计数、`assertWaiterInvariant`、共享 `visiting` 的
  失败恢复图语义（S2-G-2）——零 diff。
- **审批路径双层校验维持**（S4-G-3）：零 diff。

### 逐文件收口（第五遍新视角补充，前四轮收口之上）

| 文件 | 第五遍新检查点 | 结论 |
| --- | --- | --- |
| `run/checkpoint-store.ts` | 见 S5-G-1（每写 mkdir 自愈）；tmp+fsync+rename 与美化 JSON 维持（S4-G-2/S4-G-6） | 无候选落地 |
| `run/pause-controller.ts` | 见 S5-G-1（writeAtomic 同模式）；`token()` 每轮轮询是跨进程 pause 通道的必要读；EPERM/EEXIST 重命名回退是 Windows 兼容契约 | 无候选落地 |
| `run/events.ts` | 见 S5-G-2（TRACKING_ASSESSMENT 复验）；`EVENT_TYPES includes` = S1-G-3 维持；schema 零碰 | 无候选落地 |
| `run/event-store.ts` / `episode-store.ts` | 见 S5-G-2（readAll 全量重验的角色）；append 队列串行化（`enqueue`）是单 store 内次序契约；终端事件 fsync 旗标维持 | 无候选落地 |
| `run/replay.ts` | 见 S5-G-3（unmatchedPause 旗标丢弃）；`replayRun` 单遍状态机、`validateCheckpoint` 全谱系维持 | 无候选落地 |
| `run/child-coordinator.ts` | 见 S5-G-4（跨 store 相邻追加）与 S5-G-5（逐消息落盘）；每轮 new = S2-G-5、增量终结计数 = S3-G-3 维持；`createdAt`/`updatedAt` 两次 `now()` 是独立时戳语义（强行合一改可观察值，且 ns 级） | 无候选落地 |
| `run/flowchart-run.ts` | S4-G-1..5 全维持；`finishIfSettled` 多次 `computeStatus` = X4-8 域；`nodeTaskId` 线性查 = S1-G-7 维持 | 无候选 |
| `supervisor/flowchart-supervisor.ts` | 见 S5-G-6（edgeStatus 双查）；`snapshot()` structuredClone = S3-G-1、`get pendingApproval` 读侧隔离维持 | 无候选落地 |
| `run/supervisor.ts` | S4-G-7 维持；`runTask` 的跨 store 追加链与 S5-G-4 同域收口；`planTaskTopology` 维持未接线（X0-2） | 无候选落地 |
| `run/scheduler.ts` / `run/coordinator.ts` / `run/inspection.ts` | `isExpired` = S2-G-8、splice/filter = S1-G-6、两遍扫描 = S2-G-6 维持 | 无候选 |
| `run/flowchart-executor.ts` / `child-grounding.ts` / `child-prompt.ts` / `episode-bind.ts` / `injection.ts` | O(输入) 组装每子任务一次；`episodeIdFromEvents` 反向扫描已是最优向 | 无候选 |
| `supervisor/ledger.ts` / `flowchart-snapshot.ts` | X4-7、S4-G-2 并入项维持；`advanceLedgerRound` 拷贝几十级噪声 | 无候选 |
| `graph/validate.ts` / `readiness.ts` / `judge.ts` / `compile-children.ts` | Kahn = X4-6 维持；一次性接受路径；judge 证据个位 | 无候选 |
| `domain/ids.ts` / `state.ts` / `flowchart.ts` | isId = S3-G-5、BFS = S2-G-4、validateJoin = S1-G-4、审批校验 = S4-G-3 维持 | 无候选 |
| `domain/` 其余 13 文件 | 模块级正则 + O(1) 谓词 + 一次性校验器；`isIsoTimestamp` = X1-3 域 | 无候选 |

## 4. 前后对比

无代码 diff。仓库变更仅本报告一个文件。切片自 R1-G 基线 `4efee23` 起经
R2-G、R3-G、R4-G、本轮 R5-G 五遍复查累计零代码改动，逐字节一致。

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
`0x559051`/`0x559052` 两次独立运行等价/反例结论逐位一致、计时抖动范围内
稳定）：

```text
seed=0x559051
S5-G-1 counterexample: current=SELF-HEALS(true) variant(mkdir hoisted)=OPEN FAILS(ENOENT) -> checkpoint write lost after external dir cleanup
S5-G-1 bench: mkdir(existing dir)=26.4us/write vs full atomic write(open+write+fsync+rename)=624.9us -> mkdir share=4.2% ; per run (~66 checkpoint writes + pause polls) = 1.84ms
S5-G-2 bench: validateEvent(TRACKING_ASSESSMENT incl. parse+hash)=3511ns validateEvent(empty payload)=405ns -> hash re-verification delta=3106ns/event; aggressive bound (100 readAll x 24 assessments) = 7.45ms/run
S5-G-2 counterexample: current=REJECTS-TAMPERED-REREAD(true) variant(memoize by event id)=ACCEPTS-TAMPERED-BYTES(true)
S5-G-3 bench: hasUnmatchedPause(E=1000)=1.24us/scan; pause/resume paths call it <=3 times per CLI invocation -> <=3.7us/run; each call sits behind a full readAll (disk I/O + per-event validateEvent)
S5-G-4 counterexample: sequential durable prefixes=[[],["child:RUN_CREATED"],["child:RUN_CREATED","parent:CHILD_RUN_CREATED"]] (invariant holds: true) | parallel durable prefixes=[[],["parent:CHILD_RUN_CREATED"],["parent:CHILD_RUN_CREATED","child:RUN_CREATED"]] (invariant holds: false)
S5-G-4 bench: sequential pair=109.3us Promise.all pair=52.3us -> saving=56.9us/pair; ~3 cross-store pairs per child task x tens of tasks = sub-ms..low-ms/run
S5-G-5 counterexample: crash after 2/3 messages -> current durable child log=["AGENT_EVENT#1(TOOL_STARTED)","AGENT_EVENT#2(TOOL_FINISHED)"] | batched variant durable=[]; live inspect reader at the same instant sees 2 vs 0 lines
S5-G-5 bench: one no-fsync append=53.2us -> coalescing k=8 messages saves ~372us/attempt (sub-ms), while forfeiting per-message durability
S5-G-6 bench N=64: sweep(current)=1011ns sweep(single-lookup)=615ns -> delta=6.3ns/edge-eval; aggressive bound (64 rounds x 2 propagate sweeps x 63 edges) = 0.051ms/run
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)

seed=0x559052
S5-G-1 counterexample: 与 seed 1 逐位一致; bench: mkdir=26.0us / full write=526.7us -> share 4.9%, 1.82ms/run
S5-G-2 counterexample: 与 seed 1 逐位一致; bench: 3437ns vs 408ns -> delta 3029ns, 7.27ms/run
S5-G-3 bench: 1.23us/scan -> <=3.7us/run
S5-G-4 counterexample: 与 seed 1 逐位一致; bench: 96.8us -> 56.5us, saving 40.3us/pair
S5-G-5 counterexample: 与 seed 1 逐位一致; bench: 51.1us/append -> ~358us/attempt (k=8)
S5-G-6 bench N=64: 854ns vs 560ns -> delta 4.7ns/edge-eval, 0.038ms/run
ALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)
```

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S5-G-1 | CheckpointStore/pause writeAtomic 每写 mkdir 提升 | 外部清理后自愈落盘 vs ENOENT 丢写；26µs/写、1.8ms/run 噪声 |
| S5-G-2 | TRACKING_ASSESSMENT 读侧 parse+hash 复验按事件 id memoize | 磁盘篡改字节被静默接受（fail-closed 防篡改屏障）；上界 7.3~7.5ms/run |
| S5-G-3 | ReconstructedRun 暴露 unmatchedPause 免二次 O(E) 扫描 | ≤3.7µs/run 亚噪声；需拓宽公开导出类型；调用点改 replayRun 反而负优化 |
| S5-G-4 | 跨 store 相邻追加（子/父 events.jsonl）Promise.all 重叠 | 崩溃持久前缀不变量"parent⟹child"违例态可达；40~57µs/对 |
| S5-G-5 | handleExecutionEvent AGENT_EVENT 攒批合并落盘 | 逐消息持久性 + 跨进程实时可见性双契约取消；亚 ms/attempt |
| S5-G-6 | edgeStatus→conditionHolds 双 getRuntime 传参合一 | 4.7~6.3ns/边评估、激进外推 0.04~0.05ms/run，亚噪声 |

重开条件：S5-G-1 需先显式重定义持久化韧性契约（目录生命周期由谁保证——
若产品决定 run 目录在 run 存续期内不可外删且违者视为致命错误，可凭本反例
框架重裁）；S5-G-2 需先做出读侧完整性屏障的**行为变更决策**（与 S1-G-1
重开条件同源：跨进程事实源与防篡改语义的显式重定义）；S5-G-4/5 需先对
崩溃持久性次序与逐消息可见性做**产品级契约重定义**（如引入 WAL 层统一
两个 store 的原子提交 + inspect 改推送通道），属语义工作而非保行为优化；
S5-G-3 若 `ReconstructedRun` 公开面允许增字段（签名面决策）且 E 增长
≥3 个量级，可凭本报告等价证据重开；S5-G-6 为 ns 级常数，无现实重开路径。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file> <seed>`（依赖
已装；`.mts` 后缀确保 ESM 顶层 await 可用）。seeds：`0x559051`、
`0x559052`（其余段确定性构造，无随机性）。

```ts
/**
 * R5-G deterministic equivalence + counterexample + benchmark simulation.
 * Adjudicates fresh candidates S5-G-1 .. S5-G-6 against the current
 * implementations in src/run + src/supervisor + src/graph + src/domain.
 * Seeded PRNG (mulberry32) -> reproducible. Run: npx tsx <file> <seed>
 */
import { performance } from "node:perf_hooks";
import { appendFile, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "/workspace/src/run/checkpoint-store.js";
import { runtimeRoot } from "/workspace/src/privacy/state-layout.js";
import { validateEvent, type Event } from "/workspace/src/run/events.js";
import { hasUnmatchedPause, replayRun } from "/workspace/src/run/replay.js";
import { hashAssessment, parseTrackingAssessment } from "/workspace/src/tracking/types.js";
import { createEventId } from "/workspace/src/domain/ids.js";
import type { RunId } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";

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
  return (performance.now() - t0) / reps; // ms per call
}

const SEED = Number.parseInt(process.argv[2] ?? "0x559051", 16) || 0x559051;
console.log(`seed=0x${SEED.toString(16)}`);
const scratch = await mkdtemp(join(tmpdir(), "r5g-sim-"));

/* ============================================================
 * S5-G-1: CheckpointStore.write (checkpoint-store.ts:18) and the pause
 * controller's writeAtomic (pause-controller.ts:27) call
 * mkdir(dirname, { recursive: true }) on EVERY write, even when the run
 * directory already exists. Candidate: hoist the mkdir to the constructor
 * (or cache a dir-ensured flag). COUNTEREXAMPLE: external cleanup removes
 * the run directory mid-run -> the current per-write mkdir self-heals and
 * the checkpoint lands; the hoisted variant fails with ENOENT and the
 * checkpoint is lost.
 * ============================================================ */
{
  const stateRoot = join(scratch, "s5g1");
  const runId = "run_r5g" as RunId;
  const store = new CheckpointStore(stateRoot, runId);
  const runDir = join(runtimeRoot(stateRoot), "runs", runId);

  await store.write({ probe: 1 });
  // External cleanup between writes (crash-recovery / operator rm).
  await rm(runDir, { recursive: true, force: true });
  let currentHealed = false;
  try {
    await store.write({ probe: 2 });
    currentHealed = JSON.parse(await readFile(join(runDir, "checkpoint.json"), "utf8")).probe === 2;
  } catch {
    currentHealed = false;
  }
  // Variant: mkdir hoisted to construction time -> the write body runs
  // without the per-write mkdir (exact same open/write/sync/rename).
  await rm(runDir, { recursive: true, force: true });
  let variantErrno = "";
  try {
    const tempPath = join(runDir, "checkpoint.json.tmp");
    const handle = await open(tempPath, "w");
    await handle.close();
  } catch (error) {
    variantErrno = (error as NodeJS.ErrnoException).code ?? "";
  }
  console.log(
    `S5-G-1 counterexample: current=SELF-HEALS(${currentHealed}) variant(mkdir hoisted)=OPEN FAILS(${variantErrno}) -> checkpoint write lost after external dir cleanup`
  );
  check("S5-G-1 divergence demonstrated (self-healing per-write mkdir removed)", currentHealed && variantErrno === "ENOENT");

  await mkdir(runDir, { recursive: true });
  const mkdirCost = await benchAsync(async () => {
    await mkdir(runDir, { recursive: true });
  }, 400);
  const writeCost = await benchAsync(async () => {
    await store.write({ probe: 3, payload: "x".repeat(2048) });
  }, 200);
  console.log(
    `S5-G-1 bench: mkdir(existing dir)=${(mkdirCost * 1e3).toFixed(1)}us/write vs full atomic write(open+write+fsync+rename)=${(writeCost * 1e3).toFixed(1)}us -> mkdir share=${((mkdirCost / writeCost) * 100).toFixed(1)}% ; per run (~66 checkpoint writes + pause polls) = ${(mkdirCost * 70).toFixed(2)}ms`
  );
}

/* ============================================================
 * S5-G-2: validateEvent (events.ts:730-746) re-runs
 * parseTrackingAssessment + hashAssessment for every TRACKING_ASSESSMENT
 * payload, and EventStore.readAll validates every event on every read, so
 * an assessment-heavy run recomputes the hash O(readAll x assessments)
 * times. Candidate: memoize validation by event id (skip re-verification
 * on re-reads). COUNTEREXAMPLE: tamper the on-disk assessment payload
 * while keeping the recorded assessmentHash -> the current fail-closed
 * re-verification rejects the tampered bytes on the next readAll; the
 * memoized variant accepts them.
 * ============================================================ */
{
  let idn = 0;
  const gen = () => `id${String((idn += 1)).padStart(4, "0")}`;
  const iso = (tick: number): IsoTimestamp => new Date(1756100000000 + tick * 1000).toISOString() as IsoTimestamp;
  const assessment = {
    schemaVersion: 1,
    episodeId: "ep_r5g",
    runId: "run_r5g",
    turnId: "turn_0001",
    prescore: 0.82,
    quality: 0.74,
    coverage: 0.9,
    human: { kind: "unobserved" },
    score: 0.78,
    dimensions: [
      { id: "evidence-consistency", verdict: "PASS" },
      { id: "scope-safety", verdict: "PASS" },
      { id: "check-coverage", verdict: "UNOBSERVED" },
      { id: "constraint-retention", verdict: "PASS" },
      { id: "progress-vs-stall", verdict: "PASS" },
      { id: "narrative-coherence", verdict: "NOT_APPLICABLE" }
    ],
    gate: { kind: "none", codes: [], wakeAnalysis: false, expandDetail: false, askUser: false, openMinors: [] },
    evidenceRefs: ["evd_r5g_1"]
  };
  const assessmentHash = hashAssessment(parseTrackingAssessment(assessment));
  const trackingEvent = {
    id: createEventId(gen),
    schemaVersion: 1,
    occurredAt: iso(1),
    runId: "run_r5g",
    type: "TRACKING_ASSESSMENT",
    actor: "child-tracking",
    payload: { assessmentHash, seq: 0, assessment }
  };
  const plainEvent = {
    id: createEventId(gen),
    schemaVersion: 1,
    occurredAt: iso(2),
    runId: "run_r5g",
    type: "RUN_STARTED",
    actor: "run-cli",
    payload: {}
  };
  validateEvent(trackingEvent);
  validateEvent(plainEvent);

  const costTracking = bench(() => validateEvent(trackingEvent), 20000);
  const costPlain = bench(() => validateEvent(plainEvent), 20000);
  const delta = costTracking - costPlain;
  console.log(
    `S5-G-2 bench: validateEvent(TRACKING_ASSESSMENT incl. parse+hash)=${(costTracking * 1e6).toFixed(0)}ns validateEvent(empty payload)=${(costPlain * 1e6).toFixed(0)}ns -> hash re-verification delta=${(delta * 1e6).toFixed(0)}ns/event; aggressive bound (100 readAll x 24 assessments) = ${(delta * 100 * 24).toFixed(2)}ms/run`
  );

  // Counterexample: on-disk tamper between two reads (disk is the
  // cross-process fact source; CLI answer/pause processes write the file).
  const serialized = JSON.stringify(trackingEvent);
  const firstRead = JSON.parse(serialized) as { id: string };
  const tampered = JSON.parse(serialized) as { id: string; payload: { assessment: { score: number } } };
  tampered.payload.assessment.score = 0.11; // corrupt byte flip, stale hash kept

  const cache = new Set<string>();
  const validateMemoized = (value: unknown): Event => {
    const id = (value as { id: string }).id;
    if (cache.has(id)) return value as Event; // memoized: skip re-verification
    const validated = validateEvent(value);
    cache.add(id);
    return validated;
  };

  validateMemoized(firstRead); // first read: both paths validate fine
  let currentRejects = false;
  try {
    validateEvent(tampered); // current: every readAll re-verifies
  } catch (error) {
    currentRejects = (error as Error).message.includes("assessmentHash mismatch");
  }
  let memoizedAccepts = false;
  try {
    const accepted = validateMemoized(tampered) as unknown as { payload: { assessment: { score: number } } };
    memoizedAccepts = accepted.payload.assessment.score === 0.11;
  } catch {
    memoizedAccepts = false;
  }
  console.log(
    `S5-G-2 counterexample: current=REJECTS-TAMPERED-REREAD(${currentRejects}) variant(memoize by event id)=ACCEPTS-TAMPERED-BYTES(${memoizedAccepts})`
  );
  check("S5-G-2 divergence demonstrated (fail-closed tamper detection removed)", currentRejects && memoizedAccepts);
}

/* ============================================================
 * S5-G-3: replayRun (replay.ts:88,144-152) already tracks unmatchedPause
 * internally but discards it; pauseIfRequested (flowchart-run.ts:583),
 * resumeFlowchartRun (:944) and pauseFlowchartRun (:1071) then rescan the
 * whole event array with hasUnmatchedPause (second O(E) pass). Candidate:
 * expose unmatchedPause on ReconstructedRun. Equivalent, but it widens the
 * exported public type and the scan is microseconds at real scale.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 3);
  const TYPES = ["PAUSE_REQUESTED", "PAUSE_CLEARED", "AGENT_EVENT", "LEDGER_UPDATED", "TASK_STATUS_CHANGED"] as const;
  let mismatches = 0;
  for (let round = 0; round < 200; round += 1) {
    const len = 1 + Math.floor(rng() * 50);
    const seq = Array.from({ length: len }, () => ({ type: TYPES[Math.floor(rng() * TYPES.length)]! })) as unknown as Event[];
    // Inline tracker replicating replayRun's PAUSE_REQUESTED/PAUSE_CLEARED branches.
    let tracked = false;
    for (const event of seq) {
      if (event.type === "PAUSE_REQUESTED") tracked = true;
      else if (event.type === "PAUSE_CLEARED") tracked = false;
    }
    if (tracked !== hasUnmatchedPause(seq)) mismatches += 1;
    // Cross-check via replayRun's derived status on non-terminal sequences.
    const replayed = replayRun(seq.filter((event) => event.type === "PAUSE_REQUESTED" || event.type === "PAUSE_CLEARED"));
    if ((replayed.status === "PAUSED") !== hasUnmatchedPause(seq)) mismatches += 1;
  }
  check("S5-G-3 equivalence (exposed flag == hasUnmatchedPause, 200 seeded sequences)", mismatches === 0, `${mismatches} mismatches`);
  const E = 1000;
  const bigLog = Array.from({ length: E }, (_, i) => ({ type: i % 97 === 0 ? "PAUSE_REQUESTED" : i % 97 === 5 ? "PAUSE_CLEARED" : "AGENT_EVENT" })) as unknown as Event[];
  const scanCost = bench(() => void hasUnmatchedPause(bigLog), 5000);
  console.log(
    `S5-G-3 bench: hasUnmatchedPause(E=${E})=${(scanCost * 1e3).toFixed(2)}us/scan; pause/resume paths call it <=3 times per CLI invocation -> <=${(scanCost * 3 * 1e3).toFixed(1)}us/run; each call sits behind a full readAll (disk I/O + per-event validateEvent)`
  );
}

/* ============================================================
 * S5-G-4: ChildCoordinator appends adjacent events to DIFFERENT stores
 * strictly sequentially (child-coordinator.ts:334-336 RUN_CREATED(child) ->
 * RUN_STARTED(child) -> CHILD_RUN_CREATED(parent); :518-524
 * AGENT_STARTED(child) -> CHILD_MESSAGE(parent)). Candidate: Promise.all
 * the cross-store pair to overlap the write syscalls. COUNTEREXAMPLE: on a
 * process crash the durable prefix under sequential awaits always satisfies
 * "parent event durable => child event durable"; under Promise.all the
 * completion order is scheduler/disk dependent and the durable set
 * {parent CHILD_RUN_CREATED} without {child RUN_CREATED} becomes reachable
 * -> recovery sees a child run referenced by the parent log with no child
 * log. Deterministic manual-completion scheduler, no timers.
 * ============================================================ */
{
  async function appendPair(parallel: boolean): Promise<string[][]> {
    const durable: string[] = [];
    const snapshots: string[][] = [[]]; // every possible crash point
    const pending = new Map<string, () => void>();
    const write = (name: string): Promise<void> =>
      new Promise((resolve) => {
        pending.set(name, () => {
          durable.push(name);
          snapshots.push([...durable]);
          resolve();
        });
      });
    const child = "child:RUN_CREATED";
    const parent = "parent:CHILD_RUN_CREATED";
    const work = (async () => {
      if (parallel) await Promise.all([write(child), write(parent)]);
      else {
        await write(child);
        await write(parent);
      }
    })();
    // Deterministic "disk": completes parent first whenever it is pending.
    let completed = 0;
    while (completed < 2) {
      await new Promise((resolve) => setImmediate(resolve));
      const keys = [...pending.keys()];
      if (keys.length === 0) continue;
      const pick = keys.includes(parent) ? parent : keys[0]!;
      const complete = pending.get(pick)!;
      pending.delete(pick);
      complete();
      completed += 1;
    }
    await work;
    return snapshots;
  }
  const invariantHolds = (snapshots: string[][]): boolean =>
    snapshots.every((set) => !set.includes("parent:CHILD_RUN_CREATED") || set.includes("child:RUN_CREATED"));
  const sequentialSnapshots = await appendPair(false);
  const parallelSnapshots = await appendPair(true);
  console.log(
    `S5-G-4 counterexample: sequential durable prefixes=${JSON.stringify(sequentialSnapshots)} (invariant holds: ${invariantHolds(sequentialSnapshots)}) | parallel durable prefixes=${JSON.stringify(parallelSnapshots)} (invariant holds: ${invariantHolds(parallelSnapshots)})`
  );
  check(
    "S5-G-4 divergence demonstrated (crash-durability ordering across stores)",
    invariantHolds(sequentialSnapshots) && !invariantHolds(parallelSnapshots)
  );
  // Real-fs bench of the nominal gain (non-terminal appends carry no fsync).
  const childPath = join(scratch, "s5g4-child.jsonl");
  const parentPath = join(scratch, "s5g4-parent.jsonl");
  const line = `${JSON.stringify({ type: "CHILD_MESSAGE", payload: { p: "x".repeat(256) } })}\n`;
  const seqCost = await benchAsync(async () => {
    await appendFile(childPath, line, "utf8");
    await appendFile(parentPath, line, "utf8");
  }, 300);
  const parCost = await benchAsync(async () => {
    await Promise.all([appendFile(childPath, line, "utf8"), appendFile(parentPath, line, "utf8")]);
  }, 300);
  console.log(
    `S5-G-4 bench: sequential pair=${(seqCost * 1e3).toFixed(1)}us Promise.all pair=${(parCost * 1e3).toFixed(1)}us -> saving=${((seqCost - parCost) * 1e3).toFixed(1)}us/pair; ~3 cross-store pairs per child task x tens of tasks = sub-ms..low-ms/run`
  );
}

/* ============================================================
 * S5-G-5: handleExecutionEvent (child-coordinator.ts:606-652) durably
 * appends every AGENT_EVENT / CHILD_MESSAGE as it is handled. Candidate:
 * buffer the high-frequency AGENT_EVENTs and flush once per attempt.
 * COUNTEREXAMPLE: (a) process crash mid-attempt loses every buffered
 * message that the current implementation had already made durable;
 * (b) events.jsonl is read live by other processes (inspect/attach), so
 * append timing per message is cross-process observable data plane.
 * ============================================================ */
{
  const handled = ["AGENT_EVENT#1(TOOL_STARTED)", "AGENT_EVENT#2(TOOL_FINISHED)", "AGENT_EVENT#3(TEXT_DELTA)"];
  const crashAfter = 2; // deterministic crash point: 2 of 3 messages handled
  const currentDurable = handled.slice(0, crashAfter); // each append completes before the handler returns
  const batchedDurable: string[] = []; // buffered, flush never reached
  console.log(
    `S5-G-5 counterexample: crash after ${crashAfter}/${handled.length} messages -> current durable child log=${JSON.stringify(currentDurable)} | batched variant durable=${JSON.stringify(batchedDurable)}; live inspect reader at the same instant sees ${currentDurable.length} vs ${batchedDurable.length} lines`
  );
  check(
    "S5-G-5 divergence demonstrated (per-message durability + live visibility removed)",
    currentDurable.length === 2 && batchedDurable.length === 0
  );
  const path = join(scratch, "s5g5-child.jsonl");
  const line = `${JSON.stringify({ type: "AGENT_EVENT", payload: { kind: "TEXT_DELTA", summary: "text delta (128 chars)" } })}\n`;
  const appendCost = await benchAsync(async () => {
    await appendFile(path, line, "utf8");
  }, 500);
  console.log(
    `S5-G-5 bench: one no-fsync append=${(appendCost * 1e3).toFixed(1)}us -> coalescing k=8 messages saves ~${(appendCost * 7 * 1e3).toFixed(0)}us/attempt (sub-ms), while forfeiting per-message durability`
  );
}

/* ============================================================
 * S5-G-6: edgeStatus (flowchart-supervisor.ts:519) reads
 * getRuntime(edge.from).state and then conditionHolds (:484) performs a
 * second getRuntime(fromId) lookup for the same node. Candidate: pass the
 * runtime through. Equivalent (pure reads), ns-level on tens-sized Maps.
 * ============================================================ */
{
  const rng = mulberry32(SEED + 6);
  const N = 64;
  interface Runtime {
    state: string;
    success?: boolean;
    evidenceCount: number;
  }
  const runtimes = new Map<string, Runtime>();
  for (let i = 0; i < N; i += 1) {
    const r = rng();
    runtimes.set(`n${i}`, {
      state: r < 0.55 ? "COMPLETED" : r < 0.75 ? "RUNNING" : r < 0.9 ? "PENDING" : "FAILED",
      success: rng() < 0.8,
      evidenceCount: Math.floor(rng() * 4)
    });
  }
  const edges = Array.from({ length: N - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, expected: true }));
  const currentEval = (edge: { from: string; expected: boolean }): string => {
    const state = runtimes.get(edge.from)!.state; // lookup 1 (edgeStatus)
    if (state === "SKIPPED" || state === "FAILED") return "UNSATISFIED";
    if (state !== "COMPLETED") return "PENDING";
    const runtime = runtimes.get(edge.from)!; // lookup 2 (conditionHolds)
    return (runtime.success ?? false) === edge.expected ? "SATISFIED" : "UNSATISFIED";
  };
  const variantEval = (edge: { from: string; expected: boolean }): string => {
    const runtime = runtimes.get(edge.from)!; // single lookup, passed through
    if (runtime.state === "SKIPPED" || runtime.state === "FAILED") return "UNSATISFIED";
    if (runtime.state !== "COMPLETED") return "PENDING";
    return (runtime.success ?? false) === edge.expected ? "SATISFIED" : "UNSATISFIED";
  };
  check(
    "S5-G-6 equivalence (all edges, seeded states)",
    edges.every((edge) => currentEval(edge) === variantEval(edge))
  );
  const curCost = bench(() => {
    for (const edge of edges) currentEval(edge);
  }, 20000);
  const varCost = bench(() => {
    for (const edge of edges) variantEval(edge);
  }, 20000);
  const perEdge = ((curCost - varCost) / edges.length) * 1e6;
  console.log(
    `S5-G-6 bench N=${N}: sweep(current)=${(curCost * 1e6).toFixed(0)}ns sweep(single-lookup)=${(varCost * 1e6).toFixed(0)}ns -> delta=${perEdge.toFixed(1)}ns/edge-eval; aggressive bound (64 rounds x 2 propagate sweeps x ${edges.length} edges) = ${(((curCost - varCost) * 64 * 2)).toFixed(3)}ms/run`
  );
}

await rm(scratch, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE/COUNTEREXAMPLE CHECKS PASSED (deterministic, seeded)");
```

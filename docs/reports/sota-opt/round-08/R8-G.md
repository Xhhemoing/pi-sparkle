# R8-G：运行时 / 监督 / 图 / 领域模型切片第八遍复查报告（Round 8）

- 切片：`src/run/`（除 child-tracking.ts、gate-apply.ts，属 A 切片）＋ `src/supervisor/`（除 model-router.ts，属 B 切片）＋ `src/graph/`（全部）＋ `src/domain/`（全部）＝ 42 个文件（run 17 / supervisor 4 / graph 4 / domain 17）
- 基线：起点 `cursor/sota-persistent-opt-83a1` @ `1cae2db`（含 S8-D-1..5 摄入；派单时给定的 `a944af3` 在开工时已被父分支推进为 `1cae2db`，纯 docs 变更，已 fetch 并重置到最新独占尖端）
- 工作分支：`cursor/r8-g-runtime-eighth-pass-83a1`
- 结论产出：**无赢家落地，报告独占**。新增判决并排除 S8-G-1..2（见 §7）。

## 结论

**第八遍复查未找到任何可落地的赢家；切片连续第八轮零代码变更收口。**

前七遍已把 I/O 时序、重读复用、持久化合并、校验器删除、校验器内部
复杂度五个角度全部收口（R8-G 派单原文），学习遍（R8-E）又把本切片
唯一残留的跨界调用矩阵洞（S8-E-1/S8-E-3）关死。本轮在通读全部 42 个
在册文件后，仅找到**两个前七遍从未点名的结构性新角度**——
runFlowchartLoop 每轮双 pause 轮询去重（S8-G-1）与 persistCheckpoint
写侧校验的对象身份记忆化（S8-G-2）——两者均被**行为契约 + 实测规模**
双重（S8-G-2 为三重）封死：

- **S8-G-1**：可移除量实测 0.65~0.70ms/run（单次 pause.json ENOENT 读
  20.2~21.9µs × 32 轮），远低于十 ms 落地线；且第二次轮询是租约/执行
  窗口内 pause 请求的**唯一本轮观测点**——节点执行是最长阶段（child
  LLM 秒~分钟级，S6-G-6 裁决已实证），去重会把用户可见的暂停延迟
  拉宽整整一个节点执行期＝暂停响应契约面非保行为。
- **S8-G-2**：WeakSet 身份 memo 在生产路径上**命中率恒为 0**（32 轮
  仿真 0/64 命中——supervisor.snapshot() 深拷贝 + materializeCheckpoint
  每次新建记录，对象身份每轮全新）；要制造命中必须跨轮缓存别名对象，
  即重开 S1-G-9 别名安全边界并静默放过原地变异态＝S4-G-2 非法收益
  同族 fail-open；即使 memo 免费，天花板也仅 8.2~8.8ms/run（
  validateCheckpoint N=16 全额 85~92µs × ≤96 次/run），仍低于落地线。

基底复测（本 VM，双种子 + 双 Node 版本共三次运行，判决逐位一致）：
计算面天花板 **0.28~0.29ms/run**（validateFlowchart 16 节点 8.8~9.1µs
× 32 轮为最大单项），与 R7-G 的 <0.3ms 结论一致；I/O 地板
**checkpoint 耐久写 587~652µs/次 ×66 ≈ 38.8~43.0ms/run**（R6-G 区间
467~691µs 正中）＋ **readAll 谱 188~518µs（100/300 事件）×~96 ≈
32.6~34.3ms/run** ＋ 逐事件追加 74~98µs/条，合计 **~72~100ms/run**，
继承 69~89ms 契约地板判在本 VM 上成立。**顶/地板比 ≈ 250~350 倍**：
本切片任何合法纯计算优化在物理上不可能触及落地线，而全部 ms 级
I/O 面均为排除表在册的契约承重结构。切片就此收口。

## 0. 范围与约束遵守

- **分支/提交**：从 `origin/cursor/sota-persistent-opt-83a1` 最新尖端
  `1cae2db` 建 `cursor/r8-g-runtime-eighth-pass-83a1`；未开 PR；未触碰
  EXCLUSIONS.md / PROGRESS.md。无赢家，故 `scripts/` 不落仿真脚本，
  败者仿真全文存本报告附录（遵派单）。
- **必读完成**：README、EXCLUSIONS 全表（X0–X4、S1–S7 全部、
  S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3；S8-D 已在
  开工时被父摄入，一并核对——5 条全部为 D 切片 adaptation 面，与本
  切片零交集）、round-08/PLAN、round-07/PLAN、R1-G..R7-G 全部七份、
  R8-E §S8-E-1/§S8-E-3。
- **逐文件通读**：42 个在册文件全部本轮重读，未依赖往轮记忆。
- **字节校验**：`git diff 4efee23 HEAD -- src/run/ src/supervisor/
  src/graph/ src/domain/`（剔除 A/B 三文件）＝**空 diff**。切片自
  R1-G 基线起连续八轮字节恒等，无漂移。
- **新热环核查**：R7-G 摄入（`acb23e4`）以来 src/ 仅
  cli/model-catalog、experiments/*（S7-F 落地）、pi-adapter/*（S7-I
  落地）、routing/offline-logit（S7-C 落地）有改动；对这些 diff 逐行
  grep，**零条新增 import 指向 run/supervisor/graph/domain**——切片的
  调用者图谱与 R7-G 时完全一致，无新热环。
- **A/B 切片文件未触碰**：child-tracking.ts、gate-apply.ts、
  model-router.ts 零读写依赖变更（flowchart.ts barrel 对 model-router
  的既有 re-export 未动）。
- **硬不变量**：全部维持——本轮无任何生产代码变更，不变量面
  自动成立；两个候选的裁决本身即以 S1-G-1/S4-G-2/S5-G-1/S4-G-6/
  S1-G-9/S6-G-6/暂停响应契约为封死依据（见 §3）。

## 1. 配置态 × 命令类矩阵复核 + 基底重测（R7-I 教训执行）

### 1.1 配置态 × 命令类矩阵

| 配置态 / 命令类 | 本切片每 run 调用面 | 判定 |
| --- | --- | --- |
| run / resume / replay / tracked / children 入口 | `flowchartForSupervisor`（flowchart-run.ts:747/:880/:1021）+ `loadLearnedRouting` 双载 | S8-E-1 已判死，未重开；三处调用点本轮逐一核对未变 |
| 每轮循环（run 中） | pauseIfRequested ×2（:593/:608）→ finishIfSettled readAll 链 → leaseReadyNodes + MODEL_ROUTED 追加 + 租约后 persistCheckpoint（:603）→ applyRunningResults → advanceRound + persistLedger + persistCheckpoint（:616-617/:630-632） | 逐面对照排除表：readAll 链＝S6-G-1/2，租约后 persist＝S6-G-6，追加时序＝S5-G-4/S6-G-5；**唯一未点名残面＝双 pause 轮询**→ 立案 S8-G-1 |
| pause / unpause | token() 每轮 ×2（未暂停 ENOENT 20.2~21.9µs；暂停在案 55.9~59.2µs）；暂停分支 readAll+hasUnmatchedPause 仅暂停时走一次 | S8-G-1 裁决见 §3.1；unpause 侧 S4-I-3 在案 |
| approval / clarification 等待 | resume 端点一次性：checkpoint 读 + validateCheckpoint + replayRun；approval 校验双层（S4-G-3 在案） | 一次性面，S6-G-2/S7-G-5 在案，无新残面 |
| 学习路由已配置态 | 仅入口三点（上表），**每轮零调用**——学习配置态不改变本切片每轮调用计数 | 无配置态悬崖 |
| SPARKLE_AUTO_ADAPT on/0 | 对 src/run+supervisor+graph+domain 全域 grep `AUTO_ADAPT|autoAdapt` ＝ **0 命中**：auto-adapt 钩子全部在切片外（cli/adaptation），本切片调用计数与开关无关 | 无影响 |
| inject | CLI 命令一次性（INJECTION_REQUESTED 追加 + applyInjection + advanceRound + persistLedger）；**循环内无 inject 轮询面** | 一次性，无候选 |

**矩阵结论：配置态不给本切片增加任何每轮调用；默认空 fixture 在
G 切片没有掩盖任何配置态热路径。** R7-I 教训在本切片的执行结果是
把每轮调用序列逐面钉到排除表行，仅剩双 pause 轮询一个未点名残面
（已立案裁决）。

### 1.2 计算面天花板重测（本 VM；种子 0x88c061 / 0x88c062，另加
Node 22.19.0 下 0x88c063 一次交叉验证，三次判决一致）

| 探针 | 本轮实测 | R7-G 参考 | 每 run 全额上限 |
| --- | --- | --- | --- |
| `validateFlowchart` 16 节点 4 扇入 join | 8.82~9.07µs | 8.2µs | ×32 轮 ≈ **0.28~0.29ms** |
| `validateFlowchart` 8 节点 2 扇入 | 4.53~4.71µs | 4.1µs | — |
| `DeterministicJudge.decide` 8×8 | 0.137~0.139µs | 0.111µs | ×16 ≈ 0.002ms |
| `expandTaskTransition` PENDING→FAILED | 0.487~0.507µs | 0.50µs | ×16 ≈ 0.008ms |
| `compileChildrenToFlowchart` 16 children | 8.67~8.81µs | 10.2µs | 每 run 一次 |
| `validateEvent` AGENT_EVENT 全额 | 0.540~0.556µs | — | readAll(300) 计算份额合计 0.163~0.168ms |
| `replayRun` 300 事件 | 0.657~0.671µs/次 | — | 每 persist 一次，噪声 |
| `validateCheckpoint` N=48 全额（含 restore 内层） | 250~276µs | — | 写侧承重结构（S3-G-2/S6-G-3 在案） |
| `validateCheckpoint` N=16 全额 | 85~92µs | — | ×≤96 ≈ 8.2~8.8ms（S8-G-2 天花板输入） |

**计算面每 run 总额 <0.3ms 的 R7-G 结论在本 VM 复现成立。**

### 1.3 I/O 地板重测（本 VM）

| 探针 | 本轮实测 | R6-G 继承区间 | 每 run 外推 |
| --- | --- | --- | --- |
| CheckpointStore.write 耐久写 N=48（validate+stringify+open+write+fsync+rename） | 587.6~652.2µs/次 | 467~691µs | ×66 ≈ **38.8~43.0ms/run** |
| EventStore.append 非终结事件（mkdir+appendFile，无 fsync） | 74.1~98.3µs/条 | 70.1~83.2µs | ×300 ≈ 22.2~29.5ms/run |
| EventStore.readAll 300 / 100 事件 | 486.7~518.2µs / 188.2~204.8µs | — | ×~96（每轮 ≤3 次）均值 ≈ **32.6~34.3ms/run**（R6-G：37.8~43.0） |
| pause token() ENOENT / 在案 | 20.2~21.9µs / 55.9~59.2µs | — | ×64 ≈ 1.3~1.4ms/run（双轮询全额） |

**地板合计 ~72~100ms/run，69~89ms 继承判在本 VM 成立（本 VM 追加
谱略宽）。顶/地板比 250~350 倍——纯计算候选物理上永无可能触线。**

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 位置 | 提案 | 理论 | 仿真/实测 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S8-G-1 | `run/flowchart-run.ts:593/:608` runFlowchartLoop | 每轮两次 pauseIfRequested（轮首 + 租约后）去重为一次 | 省一次 pause.json ENOENT 读/轮 | token() ENOENT 20.2~21.9µs ×32 ＝ **0.645~0.700ms/run**（三次运行一致） | 淘汰：**非保行为**——租约后轮询是租约/持久化窗口内 pause 请求的唯一本轮观测点，去重把暂停观测推迟整整一个节点执行期（child LLM 秒~分钟级，S6-G-6 已实证执行是最长阶段）＝暂停响应契约面拉宽；且收益 0.7ms 远低落地线（S3-I-6/S4-I-3 相邻但为此前未点名的独立调用点，本轮点名收口） |
| S8-G-2 | `run/replay.ts:278` validateCheckpoint 写侧（`flowchart-run.ts:437-450` persistCheckpoint 调用面） | WeakSet 对象身份 memo：已校验过的 checkpoint 对象跳过重校验（区别于 S4-G-2 无条件跳过与 S5-G-2 读侧按事件 id memo 的第三种机制） | 每轮 ≤3 次 persist，×32 轮共 ≤96 次校验可省 | 32 轮生产等价仿真：**命中率 0/64**（checkpoint 与 flowchart 子对象身份每轮全新——snapshot() 深拷贝 + materializeCheckpoint 新建记录）；N=16 全额 85~92µs ×96 ＝ 8.2~8.8ms/run 天花板 | 淘汰：**三重封死**——(a) 生产路径零命中＝零收益；(b) 制造命中须跨轮缓存别名对象＝重开 S1-G-9 别名安全 + 静默放过原地变异态（S4-G-2 非法收益同族 fail-open）；(c) 即使免费也 8.2~8.8ms < 落地线，且写侧校验为契约承重（S4-G-2/S3-G-2/S6-G-3 在案） |

逐文件收口中另核对并直接放弃（不占候选 ID，均为排除家族改名或
µs/ns 级）：`isId` 的 `value.slice()` 子串分配规避（S3-G-5 同函数
同族，ns 级）；`validateFlowchart` 环检递归 DFS 改迭代（S7-G 校验器
内部复杂度同族，宿主全额 <10µs）；`edgePairs` NUL 拼接串分配
（S7-G-1 相邻，ns）；Kahn `dependents` 预建数组微调（X4-6 同族）；
`failedReason`/`persistLedger`/`persistBlocked` 的整快照窄投影
（S1-G-2/S4-G-4/S3-G-1 三重在案）；暂停分支 `hasUnmatchedPause`
线性扫（仅暂停时走，一次性）。

## 3. 关键裁决细节

### 3.1 S8-G-1：双 pause 轮询——本轮唯一"新调用点"候选

`runFlowchartLoop` 每轮在两个点观测暂停请求：

```592:609:src/run/flowchart-run.ts
  for (let round = 1; round <= ctx.maxRounds; round += 1) {
    const pausedAtStart = await pauseIfRequested(ctx);
    if (pausedAtStart !== undefined) return pausedAtStart;

    const settled = await finishIfSettled(ctx);
    // ... lease + MODEL_ROUTED appends + post-lease persistCheckpoint ...
    const pausedAfterLease = await pauseIfRequested(ctx);
    if (pausedAfterLease !== undefined) return pausedAfterLease;
```

前七遍点名过 pause 面的三条排除（S2-I-2 惰性 router、S3-I-6 stat
探针、S4-I-3 unpause 重排）全部在 I 切片端点侧；**循环内"每轮两次
轮询是否可并一"此前从未被点名**，故立案。裁决：

1. **行为面**：两个轮询点之间夹着本轮的租约、MODEL_ROUTED 追加、
   租约后 checkpoint 持久化与（下一步的）节点结果应用。用户在这个
   窗口内敲下 `pause` 时，租约后轮询让本轮立即以 PAUSED 收口；去重
   （只留轮首轮询）则必须等 applyRunningResults→advanceRound→双
   persist 全部走完、下一轮轮首才观测到——而节点执行是全 run 最长
   阶段（S6-G-6 裁决实证 child LLM 秒~分钟级）。暂停观测窗口拉宽
   一个执行期＝暂停响应契约非保行为。fail-closed 语义（malformed
   pause.json 抛 DomainValidationError）也要求观测点不减。
2. **规模面**：即使无视契约，可移除量＝每轮一次 ENOENT 读，实测
   20.2~21.9µs ×32 轮＝0.645~0.700ms/run（三次运行 0.645/0.664/
   0.700ms，判决一致）——比十 ms 落地线低一个数量级以上。

双杀成立，排除。

### 3.2 S8-G-2：写侧校验身份 memo——机制上新、结果上三重死

前七遍对"校验开销"的攻击面是删除（S4-G-2 全跳、S3-G-4 末次跳过）、
去重（S3-G-2/S6-G-3 双层去重）与读侧记忆化（S5-G-2 按事件 id）。
**"写侧按对象身份记忆化"是第八遍才枚举出的第三种机制**：
`WeakSet<object>` 记录已通过 `validateCheckpoint` 的对象引用，同一
引用再次持久化时跳过重校验——理论上不减少任何"首次"校验，貌似
不触 S4-G-2 的 fail-closed 红线。裁决：

1. **零命中实证**：生产路径 `persistCheckpoint`（flowchart-run.ts:
   437-450）每次调用都走 `ctx.supervisor.snapshot()`（S3-G-1 在案的
   structuredClone 深拷贝隔离）→ `materializeCheckpoint`（replay.ts:
   214-229，字面量新建记录）→ `validateCheckpoint`。仿真按生产序列
   跑 32 轮、每轮检查 checkpoint 本体与 flowchart 子对象两个身份，
   **命中 0/64**（双种子 + 双 Node 版本三次运行一致）。memo 在现
   实现下语义上不可能命中——这是结构性的，不是 fixture 巧合：
   隔离拷贝正是 S1-G-9/S3-G-1 两条排除守住的行为面。
2. **制造命中＝fail-open**：要让 memo 生效必须让 persistCheckpoint
   复用上一轮的 checkpoint 对象（别名化），则轮间任何原地变异都被
   memo 静默放过、坏态直达 fsync——恰是 S4-G-2"损坏态落盘＝非法
   收益"的定义，且重开 S1-G-9 别名安全。
3. **免费也不触线**：validateCheckpoint N=16 全额 85~92µs，×96 次/run
   上限＝8.2~8.8ms/run，低于十 ms 落地线；N=48 单次 250~276µs 亦同
   （×66 ≈ 17~18ms 但 48 节点已超 maxTasks=16 的 live 面，仅作应力
   上界）。

三重封死，排除。此裁决同时把"校验记忆化"机制族在写侧收口——
后续轮次凭本条与 S5-G-2（读侧）可直接跳过任何 memoize-validation
变体。

### 3.3 保行为面复核（第八遍，在七轮收口之上）

- `snapshotValidationRouter` 的 must-not-route 断言实测有效：bench
  初版误在 validation router 上调 `leaseReadyNodes`，立即被
  `"snapshot validation must not route"` fail-closed 拦截——恢复性
  校验与路由权限的隔离边界按设计工作（顺带验证 S4-G-2 内层 restore
  屏障活性）。
- `persistCheckpoint` 每次全量 readAll + replayRun（S1-G-1 磁盘事实
  源）、租约后立即 persist（S6-G-6 恢复窗口）、追加严格排队
  （EventStore 内部 promise 队列，S5-G-4/S6-G-5）本轮逐点重读确认
  原样在位。
- 事件次序与确定性 id 流：makeEventFactory 逐事件顺序生成、
  ChildCoordinator 每轮新建（S2-G-5）、无同轮 Promise.all（S4-G-1）
  ——均未被本轮任何提案触碰（两个候选皆为只读面提案且已否决）。

## 4. 逐文件收口（第八遍新增检查点，叠加前七轮收口）

| 文件 | 第八遍检查 | 结果 |
| --- | --- | --- |
| `run/flowchart-run.ts` | 每轮调用序列逐面钉排除表（§1.1）；S8-E-1 三调用点（:747/:880/:1021）未变；S8-G-1 立案否决；`failedReason` 整快照＝S1-G-2/S3-G-1 族 | 无候选 |
| `run/event-store.ts` / `episode-store.ts` | readAll 事实源（S1-G-1）+ 追加队列（S6-G-5）+ 终结事件 fsync（S5-G-5 族）重读确认；追加 74~98µs、readAll 谱重测在案 | 契约地板 |
| `run/checkpoint-store.ts` | 耐久写全谱 587~652µs 重测正中 R6-G 区间；pretty JSON（S4-G-6）/mkdir 自愈（S5-G-1）/tmp+fsync+rename（S4-G-2 面）原位 | 契约地板 |
| `run/pause-controller.ts` | token 双态 20~22µs / 56~59µs 实测；parse fail-closed；S8-G-1 在此调用面裁决 | 无候选 |
| `run/replay.ts` | replayRun 线性 0.66~0.67µs/300 事件＝噪声；validateCheckpoint 双层（S3-G-2/S6-G-3）250~276µs 重测；materializeCheckpoint 新建记录＝S8-G-2 零命中前提实证 | 无候选 |
| `run/events.ts` | validateEvent 全额 0.54~0.56µs；EVENT_TYPES includes＝S1-G-3 在案 | 噪声区 |
| `run/child-coordinator.ts` | 每轮新建（S2-G-5）、per-child readAll（S6-G-7）、并发门（S1-G-8）重读确认 | 无候选 |
| `run/coordinator.ts` / `supervisor.ts` / `scheduler.ts` | M1/M2 路径字节未变；S1-G-6/7/8、S2-G-1/2/8 族覆盖完备，无新环 | 无候选 |
| `run/inspection.ts` / `injection.ts` / `episode-bind.ts` | CLI 一次性面（S2-G-6）；inject 无循环轮询面（§1.1 矩阵）；episode settle 一次性 readAll＝S1-G-1 面 | 无候选 |
| `run/child-grounding.ts` / `child-prompt.ts` / `flowchart-executor.ts` | 每子任务一次的字符串/数组组装 µs 级（R7-G 收口维持）；executor 薄适配无环 | 噪声区 |
| `supervisor/flowchart-supervisor.ts` | snapshot 深拷贝（S3-G-1）、leaseReadyNodes（S2-G-1）、edgeStatus（S5-G-6）、setRuntime 别名安全（S1-G-9）逐一原位；无新每轮环 | 无候选 |
| `supervisor/flowchart-snapshot.ts` | 校验器字面量数组＝S7-G-2 族；snapshotValidationRouter must-not-route 活性实证（§3.3） | 无候选 |
| `supervisor/ledger.ts` / `flowchart.ts` | 每轮小数组操作 µs 级；barrel 无代码 | 噪声区 |
| `graph/validate.ts` | Kahn shift＝X4-6；重复/缺失依赖检查 N≤16 µs 级 | 噪声区 |
| `graph/readiness.ts` | computeReadyTasks 线性 topo 扫描，µs | 噪声区 |
| `graph/judge.ts` | S7-G-3 维持（0.137~0.139µs 重测） | 噪声区 |
| `graph/compile-children.ts` | 一次性 8.67~8.81µs（R7-G 10.2µs 同带） | 噪声区 |
| `domain/flowchart.ts` | validateFlowchart 8.8~9.1µs 重测；S7-G-1（NUL 碰撞 fail-open 红线）/S7-G-2/S1-G-4 原位；环检 DFS 改迭代＝校验器内部族放弃 | 无候选 |
| `domain/state.ts` | expandTaskTransition 0.49~0.51µs 重测＝S7-G-4/S2-G-4 维持 | 噪声区 |
| `domain/ids.ts` / `timestamp.ts` | isId slice 分配＝S3-G-5 同族放弃；Date.parse＝S6-G-4/S2-G-8 在案 | 噪声区 |
| `domain/hash.ts` / `record.ts` / `roles.ts` / `status.ts` / `errors.ts` / `index.ts` | ns 级纯函数 / 常量 / barrel，无环 | 无面 |
| `domain/task.ts` / `run.ts` / `limits.ts` / `project.ts` / `evidence.ts` / `episode.ts` / `contract.ts` | 校验器 µs 级、每对象一次线性扫（R7-G 收口维持） | 噪声区 |

## 5. 前后对比

- 生产代码：**零变更**（连续第八轮）。切片 42 文件对 R1-G 基线
  `4efee23` 字节恒等。
- 判决面新增：(a) 双 pause 轮询调用点点名并封死（S8-G-1）；(b)
  "校验记忆化"机制族写侧收口（S8-G-2，与 S5-G-2 读侧合璧）；(c)
  配置态 × 命令类矩阵在 G 切片首次成文（§1.1）：配置态不改变本
  切片每轮调用计数，SPARKLE_AUTO_ADAPT 与本切片零钩子；(d) 基底
  三次运行重测把 <0.3ms 顶 / ~72~100ms 地板钉到本 VM。

## 6. 测试

```
# tests 1169 / suites 78 / pass 1168 / fail 0 / skipped 1
# typecheck OK / lint OK / build OK
```

- 测试须在 Node ≥22.19.0（package.json engines）下运行：本 VM 默认
  node v22.14.0 会且仅会挂 `test/unit/cli/doctor.test.ts` 的 engines
  预检（doctor 正确 FAIL `node: 22.14.0 (engines >=22.19.0)`）——
  纯环境因素，与本切片无关；经 nvm 装 22.19.0 后全绿，计数与 R7-G
  逐位一致（1168/0/1）。
- 基准三次运行（22.14.0 双种子 + 22.19.0 交叉一次）等价/命中/淘汰
  判决逐位一致，计时抖动 <15%。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」；父进程操作）

| ID | 提案 | 排除理由 |
| --- | --- | --- |
| S8-G-1 | runFlowchartLoop 每轮双 pause 轮询去重（:593/:608 并一） | 暂停响应契约非保行为：租约后轮询是租约/持久化窗口内 pause 的唯一本轮观测点，去重把观测推迟一个节点执行期（秒~分钟）；收益仅 0.645~0.700ms/run（ENOENT 读 20~22µs ×32） |
| S8-G-2 | persistCheckpoint 写侧 validateCheckpoint 对象身份 memo（WeakSet） | 生产路径零命中（snapshot 深拷贝 + materializeCheckpoint 新建，32 轮仿真 0/64）；制造命中须别名化＝重开 S1-G-9 并静默放过原地变异（S4-G-2 非法收益族）；免费天花板 8.2~8.8ms/run 亦低于落地线。连同 S5-G-2 把"校验记忆化"读写两侧机制族全部收口 |

（另：本切片计算面 <0.3ms/run 顶与 ~72~100ms/run 地板在本 VM 三次
重测成立，后续轮次可凭 §1.2/§1.3 直接跳过任何纯计算候选。）

## 附录：确定性基准 / 裁决脚本（完整，可复现）

未落 `scripts/`（无赢家，遵派单）。运行方式：置于仓库根目录为
`tmp-r8g-bench.ts`，`npx tsx tmp-r8g-bench.ts 0x88c061`。种子仅标注
运行批次，全部数据确定性构造，无随机性。三次运行（0x88c061 /
0x88c062 @ node 22.14.0；0x88c063 @ node 22.19.0）关键输出：

```
validateFlowchart 16n join4: 9.067 / 8.822 / 9.071 us  -> x32 = 0.282~0.290 ms/run
DeterministicJudge.decide 8x8: 0.138 / 0.139 / 0.137 us
expandTaskTransition: 0.492 / 0.507 / 0.487 us
compileChildrenToFlowchart 16: 8.810 / 8.671 / 8.671 us
validateEvent AGENT_EVENT: 0.550 / 0.540 / 0.556 us
replayRun 300 events: 0.667 / 0.657 / 0.671 us
validateCheckpoint N=48 incl. restore: 264.979 / 250.412 / 276.027 us
CheckpointStore.write durable N=48: 628.5 / 652.2 / 587.6 us -> x66 = 38.8~43.0 ms/run
EventStore.append (no fsync): 74.1 / 81.2 / 98.3 us
EventStore.readAll 300ev: 508.9 / 486.7 / 518.2 us; 100ev: 204.8 / 192.9 / 188.2 us
pause token() ENOENT: 21.9 / 20.2 / 20.8 us; present: 59.0 / 55.9 / 59.2 us
S8-G-1 removable: 0.700 / 0.645 / 0.664 ms/run
S8-G-2 identity-memo hit rate over 32 rounds: 0/64 (all three runs)
S8-G-2 ceiling if free: validateCheckpoint N=16 = 91.1 / 85.2 / 92.1 us -> x96 = 8.18~8.84 ms/run
```

脚本全文：

```ts
/**
 * R8-G eighth-pass re-measure bench (NOT committed; source archived in the
 * report appendix). Reproduces the R6-G/R7-G CPU-ceiling and I/O-floor probes
 * on this VM and adjudicates the two eighth-pass candidates S8-G-1/S8-G-2.
 *
 * Deterministic: seeds fixed, no randomness outside randomUUID-free id
 * construction (ids are constructed with fixed suffixes). Run twice with
 * seeds 0x88C061 / 0x88C062 (seed only labels the run; all data fixed).
 *
 * Run: npx tsx tmp-r8g-bench.ts 0x88c061
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { validateFlowchart, type FlowEdge, type FlowNode, type Flowchart } from "./src/domain/flowchart.js";
import { expandTaskTransition } from "./src/domain/state.js";
import type { AgentInstanceId, EventId, RunId, TaskId } from "./src/domain/ids.js";
import { DeterministicJudge } from "./src/graph/judge.js";
import { compileChildrenToFlowchart, type CompilableChild } from "./src/graph/compile-children.js";
import { validateEvent, type Event } from "./src/run/events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint, type RunCheckpoint } from "./src/run/replay.js";
import { CheckpointStore } from "./src/run/checkpoint-store.js";
import { EventStore } from "./src/run/event-store.js";
import { createFilePauseController } from "./src/run/pause-controller.js";
import { createFlowchartSupervisor, type FlowchartRunLimits } from "./src/supervisor/flowchart-supervisor.js";
import { snapshotValidationRouter } from "./src/supervisor/flowchart-snapshot.js";
import type { IsoTimestamp } from "./src/domain/timestamp.js";

const SEED = process.argv[2] ?? "0x88c061";
console.log(`seed=${SEED}`);

const tid = (n: number): TaskId => `tsk_r8g${n.toString(36).padStart(4, "0")}` as TaskId;
const eid = (n: number): EventId => `evt_r8g${n.toString(36).padStart(8, "0")}` as EventId;
const aid = (n: number): AgentInstanceId => `agt_r8g${n.toString(36).padStart(4, "0")}` as AgentInstanceId;
const RUN_ID = "run_r8g-bench" as RunId;
const T0 = "2026-08-24T12:00:00.000Z" as IsoTimestamp;

function bench(label: string, iters: number, fn: () => void): number {
  for (let i = 0; i < Math.max(50, iters / 10); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const us = ((performance.now() - start) * 1000) / iters;
  console.log(`${label}: ${us.toFixed(3)} us/call`);
  return us;
}

async function benchAsync(label: string, iters: number, fn: () => Promise<void>): Promise<number> {
  for (let i = 0; i < Math.max(5, iters / 10); i++) await fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const us = ((performance.now() - start) * 1000) / iters;
  console.log(`${label}: ${us.toFixed(1)} us/call`);
  return us;
}

/* ---- fixtures ---------------------------------------------------------- */

// R7-G seedA fixture: 16 nodes, chain edges, one 4-fan-in all-join.
function fixtureFlowchart(n: number, joinFanIn: number): Flowchart {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i++) {
    const isJoin = i === n - 1 && joinFanIn >= 2;
    nodes.push({
      id: `n${i}`,
      taskId: tid(i),
      role: "actor",
      objective: `objective ${i}`,
      modelPolicy: { allowedModels: ["cheap", "premium"], preferredModel: "cheap" },
      confidenceThreshold: 0.7,
      approvalRequired: false,
      ...(isJoin
        ? {
            joinPolicy: {
              mode: "all" as const,
              requiredNodeIds: Array.from({ length: joinFanIn }, (_, k) => `n${n - 2 - k}`)
            }
          }
        : {})
    });
  }
  for (let i = 1; i < n - 1; i++) {
    edges.push({ from: `n${i - 1}`, to: `n${i}`, condition: { type: "success", expected: true } });
  }
  for (let k = 0; k < joinFanIn; k++) {
    edges.push({ from: `n${n - 2 - k}`, to: `n${n - 1}`, condition: { type: "success", expected: true } });
  }
  return { id: "bench", nodes, edges };
}

const fcSeedA = fixtureFlowchart(16, 4);
const fcSeedB = fixtureFlowchart(8, 2);

function syntheticEvents(count: number): Event[] {
  const events: Event[] = [];
  events.push(validateEvent({
    id: eid(0), schemaVersion: 1, occurredAt: T0, runId: RUN_ID,
    type: "RUN_STARTED", actor: "cli", payload: {}
  }));
  for (let i = 1; i < count; i++) {
    events.push(validateEvent({
      id: eid(i), schemaVersion: 1, occurredAt: T0, runId: RUN_ID,
      type: "AGENT_EVENT", actor: "executor",
      taskId: tid(i % 16),
      payload: { agentInstanceId: aid(i % 16), kind: "TEXT_DELTA", summary: `delta chunk ${i} of a realistically sized agent message summary line` }
    }));
  }
  return events;
}

const events300 = syntheticEvents(300);
const events100 = syntheticEvents(100);

// Realistic checkpoint states via the real supervisor (validation router).
const LIMITS: FlowchartRunLimits = { maxConcurrentNodes: 2, maxConsecutiveStalls: 3 };
function checkpointFor(fc: Flowchart): RunCheckpoint {
  const supervisor = createFlowchartSupervisor({
    flowchart: validateFlowchart(fc), router: snapshotValidationRouter(), limits: LIMITS
  });
  const replayed = replayRun(events100);
  return validateCheckpoint(materializeCheckpoint(replayed, T0, {
    definition: validateFlowchart(fc), snapshot: supervisor.snapshot(), limits: LIMITS
  }));
}

const children48: CompilableChild[] = Array.from({ length: 48 }, (_, i) => ({
  taskId: tid(1000 + i), role: "implementer" as const, objective: `child objective ${i}`,
  ...(i > 0 && i % 3 === 0 ? { dependsOn: [tid(1000 + i - 1)] } : {})
}));
const fc48 = compileChildrenToFlowchart(children48);
const checkpoint48 = checkpointFor(fc48);
const checkpoint16 = checkpointFor(fcSeedA);

/* ---- Part A: CPU plane ------------------------------------------------- */
console.log("\n[A] CPU plane (R7-G probe set re-run)");
const vfA = bench("validateFlowchart 16n join4 (seedA)", 20000, () => validateFlowchart(fcSeedA));
bench("validateFlowchart  8n join2 (seedB)", 20000, () => validateFlowchart(fcSeedB));
console.log(`  -> x32 rounds = ${(vfA * 32 / 1000).toFixed(3)} ms/run ceiling`);

const judge = new DeterministicJudge();
const evd = Array.from({ length: 8 }, (_, i) => `evd_r8g${i}` as never);
bench("DeterministicJudge.decide 8x8", 100000, () => {
  judge.decide({ taskId: tid(0), verification: { kind: "PASSED", evidenceIds: evd, notes: "" } as never, evidenceIds: evd });
});
bench("expandTaskTransition PENDING->FAILED", 200000, () => { expandTaskTransition("PENDING", "FAILED"); });
bench("compileChildrenToFlowchart 16 children (one-shot)", 20000, () => {
  compileChildrenToFlowchart(children48.slice(0, 16));
});
const veUs = bench("validateEvent AGENT_EVENT", 100000, () => { validateEvent(events300[7] as never); });
const rrUs = bench("replayRun 300 events", 5000, () => { replayRun(events300); });
console.log(`  -> readAll(300) compute share = ${(veUs * 300 / 1000 + rrUs / 1000).toFixed(3)} ms`);
const vcUs = bench("validateCheckpoint full (N=48, incl. restore)", 2000, () => { validateCheckpoint(JSON.parse(JSON.stringify(checkpoint48))); });

/* ---- Part B: I/O floor -------------------------------------------------- */
console.log("\n[B] I/O floor on this VM");
const root = mkdtempSync(join(tmpdir(), "r8g-bench-"));
try {
  const ckStore = new CheckpointStore(root, RUN_ID);
  const ckWriteUs = await benchAsync("CheckpointStore.write durable (N=48)", 200, async () => {
    await ckStore.write(checkpoint48);
  });
  console.log(`  -> x66 writes/run (R6-G count) = ${(ckWriteUs * 66 / 1000).toFixed(1)} ms/run`);

  const evStore = new EventStore(root, RUN_ID);
  let n = 0;
  const apUs = await benchAsync("EventStore.append AGENT_EVENT (no fsync)", 400, async () => {
    const e = { ...events300[1] as object, id: eid(100000 + n++) } as Event;
    await evStore.append(e);
  });
  console.log(`  -> x300 events/run = ${(apUs * 300 / 1000).toFixed(1)} ms/run`);

  const evStoreR = new EventStore(root, "run_r8g-readbench" as RunId);
  for (const e of events300) await evStoreR.append({ ...(e as object), runId: "run_r8g-readbench" } as Event);
  const raUs = await benchAsync("EventStore.readAll 300 events", 300, async () => { await evStoreR.readAll(); });
  const evStoreS = new EventStore(root, "run_r8g-readsmall" as RunId);
  for (const e of events100) await evStoreS.append({ ...(e as object), runId: "run_r8g-readsmall" } as Event);
  const raSmallUs = await benchAsync("EventStore.readAll 100 events", 300, async () => { await evStoreS.readAll(); });
  // Growing-log model: ~96 readAll calls/run (3 per round x32), average size ~mid-run.
  console.log(`  -> x96 readAll/run at avg mid-run size = ${(((raUs + raSmallUs) / 2) * 96 / 1000).toFixed(1)} ms/run`);

  const pause = createFilePauseController(root, () => T0);
  const tokAbsentUs = await benchAsync("pause token() ENOENT (not paused)", 2000, async () => {
    await pause.token(RUN_ID);
  });
  await pause.requestPause(RUN_ID, "bench");
  await benchAsync("pause token() present (paused)", 2000, async () => { await pause.token(RUN_ID); });
  await pause.clearPause(RUN_ID);

  /* ---- Part C: candidate adjudication ---------------------------------- */
  console.log("\n[C] eighth-pass candidates");
  // S8-G-1: dedup the two per-round pause polls -> removable = 1 token()/round.
  console.log(`S8-G-1 removable share: 1 token()/round x32 = ${(tokAbsentUs * 32 / 1000).toFixed(3)} ms/run`);
  // S8-G-2: WeakSet identity memo on write-side validateCheckpoint.
  const seen = new WeakSet<object>();
  let hits = 0;
  const sup = createFlowchartSupervisor({
    flowchart: validateFlowchart(fcSeedA), router: snapshotValidationRouter(), limits: LIMITS
  });
  for (let round = 0; round < 32; round++) {
    const replayed = replayRun(events100);
    const cp = materializeCheckpoint(replayed, T0, {
      definition: validateFlowchart(fcSeedA), snapshot: sup.snapshot(), limits: LIMITS
    });
    if (seen.has(cp as object)) hits++;
    seen.add(cp as object);
    if (seen.has((cp as { flowchart?: object }).flowchart!)) hits++;
    seen.add((cp as { flowchart?: object }).flowchart!);
  }
  console.log(`S8-G-2 identity-memo hit rate over 32 rounds: ${hits}/64 (persistCheckpoint materializes fresh objects)`);
  console.log(`S8-G-2 ceiling even if memo were free: validateCheckpoint(N=16) x96 = ${(bench("validateCheckpoint full (N=16)", 5000, () => validateCheckpoint(JSON.parse(JSON.stringify(checkpoint16)))) * 96 / 1000).toFixed(2)} ms/run (protected face regardless)`);
  console.log(`  (write-side validateCheckpoint N=48 single-call: ${vcUs.toFixed(1)} us)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("\ndone");
```

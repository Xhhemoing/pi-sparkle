MODEL_SLUG=claude-fable-5-thinking-xhigh

# R9-G：runtime / supervisor / graph / domain 第九遍复查报告

- 基线：`cursor/sota-persistent-opt-83a1` @ `af7a423`（含 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3 排除全表）。漂移复核（本轮实测）：`git diff 1cae2db..af7a423 -- src/` 为**空**（R8-G 基线以来 26 个提交全部 docs-only）；`git diff 4efee23..af7a423 --（G 切片 42 文件）` 为**空**——本切片自 R1-G 基线起**九轮字节不变**，从未落过任何生产代码。
- 切片：`src/run/`（除 child-tracking.ts / gate-apply.ts，属 A 切片）+ `src/supervisor/`（除 model-router.ts，属 B 切片）+ `src/graph/` 全部 + `src/domain/` 全部。清单实点：run 19−2=**17** / supervisor 5−1=**4** / graph **4** / domain **17**，合计 **42 文件**，与派单一致；全量实际读码（未依赖历轮记忆）。
- 前置阅读按令序：README → EXCLUSIONS 全表（含 S9-A/B/C/D/F 全系新行）→ round-09/PLAN → round-08/PLAN + R8-G → R7-G..R1-G → 42 个切片源文件。
- 分支：`cursor/r9-g-runtime-ninth-pass-83a1`（已推送，未开 PR）。
- 环境：Node 22.22.2（VM 默认 22.14.0 低于 engines ≥22.19.0，nvm 切换，历轮同处理）、pnpm 10.17.1、`pnpm install --frozen-lockfile`。

## 结论

**无可落地的新更优解，本轮生产代码零改动（连续第九轮）。** 第九遍在 49 条既有 G 切片排除行（S1-G-1..9 / S2-G-1..8 / S3-G-1..5 / S4-G-1..7 / S5-G-1..6 / S6-G-1..7 / S7-G-1..5 / S8-G-1..2）之上，完成了两件派单要求的事：

1. **本 VM 重锚 + 首次对真实命令面做动态配置态 × 命令类矩阵**（历轮矩阵为静态调用点核对；本轮用原型插桩对 12 个 命令 × 状态 单元逐一实测 I/O 操作数，三进程 × 三迭代九次摘要**逐位一致** `e0b4a243cd056d09…`）。矩阵证实：每个命令类的每一次 I/O 操作都精确落在已关闭的机制族内（§1.3），非法单元（pause/inject @ 终态）在**任何写发生之前**以最小 I/O（1 readAll + 1 checkpoint read）fail-closed 抛错——命令面无隐藏悬崖、无未裁决 I/O 孔。
2. **枚举出三个排除表未覆盖的新角度（S9-G-1..3），全部裁决淘汰**：每一个都是亚 ms 级（22 µs / 1.3 ms / 0.26 ms），且 S9-G-1、S9-G-3 还各自撞上 fail-closed / 持久性契约（详见 §2–3）。

物理收口在本 VM 三批次重测下继续成立并加剧：计算顶 **0.286–0.307 ms/run** vs I/O 地板 **87.4–97.8 ms/run**（比率 **~285–335×**）。把整个计算面清零仍差落地线（数十 ms）两个数量级；I/O 面的每一项（66 次 checkpoint 持久写 ≈ 34.7–42.2 ms、~96 次 readAll ≈ 32.0–34.4 ms、~300 次事件追加 ≈ 20.7–21.8 ms）都是已裁决的契约地板（S6-G-6 / S3-G-4 / S1-G-1 / S6-G-1/2/7 / S5-G-4/5 / S4-G-6）。本轮矩阵把「命令类 × 配置态」维度也排空之后，**本切片在当前排除表与硬不变量下不存在不经表所有者层级契约变更即可达落地线的候选**。

不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。双 LCB 与双归因未动；无阈值/测试/公开签名/数据面变更。仓库变更仅本报告一个文件；无赢家故未提交 `scripts/round09-r9g-equivalence-sim.ts`（裁决脚本全文进附录 A，遵守 R7-G/R8-G 纪律）。

## 0. 范围与约束遵守

- 硬不变量逐条核对（生产零 diff 下天然成立）：分析不变异在飞 run；tracking 无指挥权；H/score 不写 routing PASS/FAIL；Live=R0 等价；双 LCB / 双归因在位；promotion proposal-first；无阈值变更；CAS / credentials / 数据面 / 公开签名不动；EventStore/EpisodeStore 跨进程磁盘事实源 + fail-closed 读校验（S1-G-1）；确定性 id 流与事件次序（S5-G-4 禁 Promise.all 兄弟追加）；别名安全边界（S1-G-9）。
- 未重开任何 X* / S1-* ～ S8-* / S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3。特别核对上轮关单：**S8-G-1**（双 pause 轮询去重——本轮 S9-G-2 是「换观测机制」而非「去重」，独立立行但引 S8-G-1 的观测点语义与共享天花板；未重开去重本身）；**S8-G-2**（写侧校验身份 memo——本轮未提出任何校验记忆化）。
- 逐条撇清三个新候选与既有行：
  - **S9-G-1 不是 S2-I-1 的重开**（那是 I 切片 `cli/main.ts` 普通 run 路径把 loadLearnedRouting 下沉 children 分支；本候选是 G 切片 `flowchart-run.ts` 会话恢复类命令 pause/inject 的按命令类免除——不同文件、不同调用面），但**同型**：损坏 registry 时错误路径发散的否决理由完全移植，本轮以真实命令面见证复证（§3.1）。也不是 S7-G-5 / S7-I-3（那些是 Promise.all 并行化；本候选是免除）。
  - **S9-G-2 不是 S8-G-1**（那是删第二次轮询；本候选保留两个观测点、把 token() 的每次磁盘读换成 fs.watch 驱动的内存缓存）——机制新，但共享同一张天花板（两次轮询全免 1.31–1.34 ms/run），且缓存观测与「观测点即时读盘」语义发散（inotify 合并/延迟、网络文件系统不保证），属 S1-G-1 跨进程磁盘事实源的观测面推论。
  - **S9-G-3 不是 S5-G-1**（那是 mkdir 提升）也不在 S4-G-6（字节格式）内：pause.json writeAtomic 的 fsync 从未单独立行——新站点，但机制上是 S3-G-4/S6-G-6「持久性地板」家族在用户命令上的形态：CLI pause 返回后崩溃 = 已受理的暂停丢失。
- 纯计算类微角度（`inspectRun` findChild 回退分配、`advanceLedgerRound` progress 数组拷贝、`validateTaskGraph` shift 队列、`limitsFromSnapshot` 重验等）本轮按 R8-G §1.2/§1.3 的类别性关闭**不再立行不再测量**：计算顶 0.29–0.31 ms/run 三批重测成立，任何合法纯计算候选物理低于线（派单明示）。
- 未编辑 EXCLUSIONS.md / PROGRESS.md / 任何 PLAN.md；未开 PR。

## 1. 锚点重测 + 配置态 × 命令类矩阵（本 VM 实测，三批次 0x99c071/72/73）

### 1.1 计算顶（R8-G 探针组原样重跑，可比）

| 探针 | 本 VM 三批 | R8-G 记载带 |
| --- | --- | --- |
| validateFlowchart 16n join4 | 8.948 / 9.586 / 8.959 µs → ×32 = **0.286–0.307 ms/run** | 8.822–9.071 µs → 0.282–0.290 |
| validateFlowchart 8n join2 | 4.516 / 4.593 / 4.586 µs | — |
| DeterministicJudge.decide 8×8 | 0.137 / 0.131 / 0.133 µs | 0.137–0.139 |
| expandTaskTransition | 0.485 / 0.469 / 0.477 µs | 0.487–0.507 |
| compileChildrenToFlowchart 16 | 8.879 / 8.744 / 8.644 µs | 8.671–8.810 |
| validateEvent AGENT_EVENT | 0.542 / 0.538 / 0.537 µs | 0.540–0.556 |
| replayRun 300 events | 0.664 / 0.673 / 0.661 µs | 0.657–0.671 |
| validateCheckpoint N=48（含 restore 重验） | 251.97 / 253.29 / 248.57 µs | 250.4–276.0 |

### 1.2 I/O 地板

| 探针 | 本 VM 三批 | 每 run 外推 |
| --- | --- | --- |
| CheckpointStore.write 持久（N=48） | 525.7 / 639.5 / 554.0 µs | ×66（R6-G 计数）= **34.7 / 42.2 / 36.6 ms/run** |
| EventStore.append（无 fsync） | 69.1 / 72.6 / 68.8 µs | ×300 = **20.7 / 21.8 / 20.7 ms/run** |
| EventStore.readAll 300ev / 100ev | 478.8–524.8 / 188.7–191.6 µs | ×96 均值中程 = **32.0 / 33.8 / 34.4 ms/run** |
| pause token() ENOENT / 在位 | 20.5–20.9 / 56.0–56.6 µs | 2 次/轮 ×32 ≈ 1.3 ms/run |
| loadLearnedRouting（无 registry 快照） | 22.2 / 23.1 / 23.4 µs | 每命令一次 |

I/O 地板合计 ≈ **87.4 / 97.8 / 91.7 ms/run** vs 计算顶 0.286–0.307 → **~285–335×**，与 R8-G 的 250–350× 带一致。派单的物理结论在本 VM 复现：清零整个计算面（甚至加上把 66 次持久写的 stringify+校验全免的 S8-G-2 天花板 8–9 ms）仍不达线。

### 1.3 配置态 × 命令类矩阵（本轮新测法：真实命令面 + 原型插桩 I/O 计数）

历轮矩阵为静态调用点核对；本轮对 `startFlowchartRun` / `pauseFlowchartRun` / `resumeFlowchartRun`（unpause / approval / noop 三形态）/ `injectFlowchartRun` / 跨进程 cancel 观测，在真实存储（EventStore / CheckpointStore / EpisodeStore / EpisodeEventStore / 文件 pause 控制器）上以原型插桩逐单元实测 I/O 操作数。固定时钟 + 序列 id 生成器，**三进程 × 三迭代共九次运行，归一化（时戳/临时路径占位）后 sha256 摘要逐位一致：`e0b4a243cd056d09…`**——命令面 I/O 行为对本切片是确定性的。

| 命令类 | 配置态 | 结果 | ev.append(fsync) | ev.readAll(读事件数) | cp.write | cp.read | pz.tok/req/clr | epi.app/read + epiEvt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| start | 新建→COMPLETED（3 节点链） | COMPLETED | 13(1) | 11(104) | 8 | 0 | 6/0/0 | 3/1 + 3 |
| start | 新建→WAITING（审批门） | WAITING_FOR_USER | 10(0) | 8(62) | 5 | 0 | 3/0/0 | 3/1 + 3 |
| pause | WAITING | PAUSED | 1(0) | 5(53) | 1 | 1 | 0/1/0 | 0/1 + 0 |
| resume(unpause) | PAUSED | WAITING_FOR_USER | 1(0) | 7(82) | 1 | 1 | 2/0/1 | 0/1 + 0 |
| inject(fact) | WAITING | WAITING_FOR_USER | 2(0) | 4(54) | 1 | 1 | 0/0/0 | 0/1 + 0 |
| resume(approval) | WAITING | COMPLETED | 6(1) | 9(155) | 4 | 1 | 3/0/0 | 1/1 + 1 |
| resume(noop) | COMPLETED | COMPLETED | 0(0) | 5(100) | 1 | 1 | 0/0/0 | 0/0 + 0 |
| pause | COMPLETED | **THROWS**（fail-closed） | 0 | **1(20)** | **0** | 1 | 0/0/0 | 0/0 + 0 |
| inject(fact) | COMPLETED | **THROWS**（fail-closed） | 0 | **1(20)** | **0** | 1 | 0/0/0 | 0/0 + 0 |
| cancel（跨进程追加） | WAITING | appended | 1(1) | 0 | 0 | 0 | 0/0/0 | 0/0 + 0 |
| resume（观测 cancel） | CANCELLED | CANCELLED | 1(0) | 5(56) | 1 | 1 | 0/0/0 | 1/1 + 1 |

矩阵读法与结论：

- **每个单元的每类 I/O 都映射到已关闭族**：checkpoint 写次数 = 租约后 + 轮末 + finish（S6-G-6 / S3-G-4 / 持久合并族）；readAll 次数 = persistCheckpoint 内嵌读 + 终态去重守卫 + finish 三连（S1-G-1 / S6-G-1 / S6-G-2 / S6-G-7）；pause 轮询 = 每轮两点观测（S8-G-1）；episode 三写 = 开/挂/结算逐条持久（S5-G-4 崩溃前缀 + S5-G-5 逐消息持久性）。矩阵中**不存在任何一列**的操作不被既有行覆盖——「命令类 × 配置态」维度无新 I/O 孔。
- **非法单元最小 I/O fail-closed**：pause/inject @ COMPLETED 在 1 次 readAll + 1 次 checkpoint read 后抛错，零写入——错误路径本身已是地板，无可优化面。
- **审批与注入命令类**（R7-I 教训点名的 resume/cancel/pause/finish/approval 全部覆盖）：approval 是 resume 的承载形态（+1 USER_ANSWER 追加 + 后续轮循环）；inject 是最轻命令（2 追加 + 1 checkpoint 写）；两者的 I/O 计数都由 finish() 的收尾族支配，与其它单元同族。
- 终态 fsync 追加（RUN_COMPLETED / RUN_CANCEL_REQUESTED）每 run 恰一次，计数列 (fsync) 证实——无重复终态持久。

## 2. 候选总表（S9-G-1..3，全部淘汰）

| ID | 候选 | 淘汰理由（本 VM 实测） |
| --- | --- | --- |
| S9-G-1 | pause/inject 会话恢复类命令免除 `flowchartForSupervisor` 的 `loadLearnedRouting`（这两类命令到进程退出都不会发生 lease 路由，学习策略貌似死载荷） | **S2-I-1 同型（跨切片新站点）**：损坏/哈希失配 registry 今天使 pause 命令 fail-closed 抛错（本轮真实命令面见证：`THROWS: invalid registry snapshot at …`），免除载入会把该单元翻成静默成功 = 移除完整性观测（S4-G-2/S5-G-2 非法收益形态）；且天花板 22.2–23.4 µs/命令（registry 缺席）～亚 ms（在位，单次小文件读+哈希核对），低于落地线 3 个数量级 |
| S9-G-2 | 每轮两次 pause token() 磁盘读换 fs.watch 驱动内存缓存（保留两个观测点，免读盘） | 绝对天花板（两次轮询全免）**1.31–1.34 ms/run**，低于线 ~30–75×；且 watch 延迟/事件合并使「观测点即时读盘」语义发散（S8-G-1 确立的暂停响应窗 + S1-G-1 跨进程磁盘事实源的观测面推论）；任何部分变体严格低于该天花板 |
| S9-G-3 | pause.json writeAtomic 去 fsync（requestPause 持久性降级） | fsync 份额实测 **243.0–262.5 µs**、每 pause 命令仅一次（一次性命令类），低于线 2 个数量级；且 CLI pause 返回后崩溃 = 已受理暂停丢失，S3-G-4/S6-G-6「持久性地板」家族在用户命令站点的形态 |

三个候选合计天花板 < 1.7 ms/run——即便全部非法落地也不达线的 1/20。

## 3. 关键裁决细节

### 3.1 S9-G-1：会话恢复类的学习策略载入

理论面成立的部分：`pauseFlowchartRun`/`injectFlowchartRun` 经 `restoreFlowchartSession` → `flowchartForSupervisor` → `loadLearnedRouting`，而学习策略只改 `modelPolicy`（allowedModels 序 / preferredModel），仅被 `leaseReadyNodes` 的路由消费；这两类命令的控制流（pause→finish、inject→applyInjection→advanceRound→finish）到进程退出都不触 lease，且 checkpoint 持久的 definition 是 checkpoint 原本（非 learned 施加后），supervisor 快照也不含 modelPolicy——「死载荷」判断对**成功路径**成立。

否决在错误路径与规模双杀：(a) `loadLearnedRouting` 是 registry 快照的 fail-closed 完整性观测点（损坏 JSON / 内容哈希失配 → DomainValidationError）。本轮在真实命令面构造损坏 registry 后 `pauseFlowchartRun` 如期抛错；免除载入会把「registry 已损坏」这一事实从 pause/inject 命令的可观测面上静默抹除——与 S2-I-1 的否决理由（损坏 registry 时错误路径发散）逐字同型，且方向是 fail-closed→fail-open（非法收益族）。(b) 收益 22–24 µs（缺席路径三批）/亚 ms（在位路径为单次小 readFile + 哈希核对 + 解析），一次性命令类不乘轮数。新行立档，重开条件建议随 S2-I-1：registry 载入获得「按命令类免检」的显式契约放宽。

### 3.2 S9-G-2：观测机制替换的天花板

S8-G-1 已证两个轮询点中删除任何一个都拉宽用户可见暂停延迟一整个节点执行——本候选换思路保留两点、免其磁盘读。但 (a) 全免天花板 = 2×32×20.5–20.9 µs = **1.31–1.34 ms/run**（三批同带），部分变体（watch 失败回退轮询等）严格更低；(b) fs.watch 的 inotify 语义（事件合并、rename 原子替换的 IN_MOVED_TO 时序、网络/容器文件系统不保证送达）使缓存态可能滞后于磁盘态——而 pause.json 由**另一进程**原子写入，「观测点即时读盘」正是 S1-G-1 跨进程磁盘事实源契约在观测面的推论。机制新、站点旧、天花板共享——立行关闭整个「pause 观测换代」方向。

### 3.3 S9-G-3：用户命令的持久性份额

`requestPause` 的 writeAtomic（open tmp → write → **fsync** → close → rename）中 fsync 份额 = 382.4/389.1/363.0 − 122.6/126.6/120.0 = **243.0–262.5 µs**，每 pause 命令一次。去掉它，pause CLI 返回「已暂停」后掉电，pause.json 可能不在盘上，运行中的循环在下一观测点读不到暂停请求——已受理命令丢失，与 S3-G-4（终态陈旧）/ S6-G-6（恢复窗）同属「持久性地板不可折」家族，只是站点从 run 状态移到用户命令。收益规模也自足否决。

## 4. 逐文件收口（R1–R8 收口之上的本轮新检查点）

- `flowchart-run.ts`：命令面 12 单元动态矩阵（§1.3）零新孔；`loadLearnedRouting` 站点裁决（S9-G-1）后，start/resume/pause/inject 四类命令的**全部** I/O 调用点均有排除行或契约行背书。
- `pause-controller.ts`：writeAtomic fsync 份额单列并关闭（S9-G-3）；token() 观测机制方向整体关闭（S9-G-2）。ENOENT/在位两态成本三批重测与 R8-G 带一致。
- `event-store.ts` / `checkpoint-store.ts` / `episode-store.ts`：地板重锚（§1.2）；终态 fsync 追加每 run 恰一次经矩阵计数证实；无新机制可提。
- `events.ts` / `replay.ts` / `scheduler.ts` / `injection.ts` / `inspection.ts` / `episode-bind.ts` / `child-grounding.ts` / `child-prompt.ts` / `flowchart-executor.ts` / `child-coordinator.ts` / `coordinator.ts` / `supervisor.ts`：全量重读，纯计算面按 §1.1 类别性关闭；`settleBoundEpisode` 的 episode readAll 与三写为 S1-G-1 同契约调用点 + S5-G-4/5 族（不另立行）。
- `supervisor/flowchart-supervisor.ts` / `flowchart-snapshot.ts` / `flowchart.ts` / `ledger.ts`：restore 校验面（快照-节点 id 匹配）确认不消费 modelPolicy（S9-G-1 裁决的必要事实）；其余为 S1-G-5/S3-G-1/S8-G-2 已收割/关闭面。
- `graph/` 4 文件与 `domain/` 17 文件：校验器/状态机/id 面全部低于单 µs 或已有行（S1-G-3/4、S2-G-4、S6-G-4、S7-G-1..4）；无新角度。

## 5. 测试

- `pnpm gate`（typecheck + lint + test + build）@ Node 22.22.2：**1169 测试 / 1168 过 / 0 败 / 1 skip，全绿**（与 R9-F 记载带一致）。注：VM 默认 node 22.14.0 会使 `doctor` 预检单测如实 fail-closed（engines ≥22.19.0），nvm 切换后消失——环境事实，非代码问题，历轮同处理。
- 裁决脚本三批（0x99c071/72/73）：矩阵摘要九次逐位一致；全部锚点在带内。

## 6. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 候选 | 排除理由 |
| --- | --- | --- |
| S9-G-1 | pause/inject 会话恢复免除 loadLearnedRouting | S2-I-1 同型：损坏 registry 错误路径 fail-open 发散；22–24µs/命令。重开：registry 载入获得按命令类免检契约 |
| S9-G-2 | pause 轮询换 fs.watch 内存缓存观测 | 两轮询全免天花板 1.31–1.34ms/run；watch 合并/延迟 vs 观测点即时读盘（S8-G-1/S1-G-1 推论）。重开：轮数 ×10 或 token 成本 ×10 |
| S9-G-3 | requestPause writeAtomic 去 fsync | 已受理用户命令掉电丢失（S3-G-4/S6-G-6 持久性地板族新站点）；243–263µs/命令 |

MORE_OPTIMA=no

## 附录 A：裁决基准 / 矩阵脚本（完整，可复现；无赢家按纪律不入库）

运行方式：置于仓库根目录为 `tmp-r9g-bench.ts`，`npx tsx tmp-r9g-bench.ts 0x99c071`（种子仅标注批次，全部数据确定性构造）。三批关键输出：

```
validateFlowchart 16n join4: 8.948 / 9.586 / 8.959 us -> x32 = 0.286~0.307 ms/run
DeterministicJudge.decide 8x8: 0.137 / 0.131 / 0.133 us
expandTaskTransition: 0.485 / 0.469 / 0.477 us
compileChildrenToFlowchart 16: 8.879 / 8.744 / 8.644 us
validateEvent AGENT_EVENT: 0.542 / 0.538 / 0.537 us
replayRun 300 events: 0.664 / 0.673 / 0.661 us
validateCheckpoint N=48 incl. restore: 251.972 / 253.294 / 248.567 us
CheckpointStore.write durable N=48: 525.7 / 639.5 / 554.0 us -> x66 = 34.7~42.2 ms/run
EventStore.append (no fsync): 69.1 / 72.6 / 68.8 us -> x300 = 20.7~21.8 ms/run
EventStore.readAll 300ev: 478.8 / 511.8 / 524.8 us; 100ev: 188.7 / 191.6 / 191.4 us -> x96 = 32.0~34.4 ms/run
pause token() ENOENT: 20.8 / 20.9 / 20.5 us; present: 56.6 / 56.4 / 56.0 us
loadLearnedRouting (no registry snapshot): 22.2 / 23.1 / 23.4 us
matrix digest (3 proc x 3 iter): e0b4a243cd056d09... 九次逐位一致
S9-G-1 witness: pause@corrupt-registry THROWS "invalid registry snapshot at ..." (all three runs)
S9-G-2 ceiling: 1.33 / 1.34 / 1.31 ms/run
S9-G-3 fsync share: 259.8 / 262.5 / 243.0 us per pause command
gate @ node 22.22.2: 1168 pass / 0 fail / 1 skip
```

脚本全文：

```ts
/**
 * R9-G ninth-pass re-measure bench + configured-state x command-class matrix
 * (NOT committed to scripts/; source archived in the report appendix).
 *
 * Parts:
 *   A. CPU-plane probes (identical to the R8-G set, for drift comparability).
 *   B. I/O-floor probes (checkpoint durable write, per-event append, readAll,
 *      pause token, loadLearnedRouting ENOENT path).
 *   C. Deterministic configured-state x command-class matrix over the REAL
 *      flowchart-run command surface (start / pause / resume-unpause / inject /
 *      approval / resume-noop / cancel-observation / illegal cells), with
 *      per-command I/O op counts via prototype instrumentation. Run 3x and
 *      digest-compared (timestamps and tmp paths normalized).
 *   D. Ninth-pass candidate adjudication probes (S9-G-1..3).
 *
 * Deterministic: fixed clock, sequential id generator, fixed fixtures. The
 * seed argv only labels the batch. Run: npx tsx tmp-r9g-bench.ts 0x99c071
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { validateFlowchart, validateConfidenceScore, type FlowEdge, type FlowNode, type Flowchart, type JoinPolicy } from "./src/domain/flowchart.js";
import { expandTaskTransition } from "./src/domain/state.js";
import { createTaskId, type AgentInstanceId, type EventId, type RunId, type TaskId } from "./src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "./src/domain/timestamp.js";
import { DeterministicJudge } from "./src/graph/judge.js";
import { compileChildrenToFlowchart, type CompilableChild } from "./src/graph/compile-children.js";
import { validateEvent, type Event } from "./src/run/events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint, type RunCheckpoint } from "./src/run/replay.js";
import { CheckpointStore } from "./src/run/checkpoint-store.js";
import { EventStore } from "./src/run/event-store.js";
import { EpisodeStore } from "./src/run/episode-store.js";
import { EpisodeEventStore } from "./src/episode/store.js";
import { createFilePauseController, type PauseController } from "./src/run/pause-controller.js";
import { createFlowchartSupervisor, type ChildNodeResult, type FlowchartRunLimits } from "./src/supervisor/flowchart-supervisor.js";
import { snapshotValidationRouter } from "./src/supervisor/flowchart-snapshot.js";
import { createModelRouter, type ModelRouter } from "./src/supervisor/model-router.js";
import { startFlowchartRun, resumeFlowchartRun, pauseFlowchartRun, injectFlowchartRun } from "./src/run/flowchart-run.js";
import { loadLearnedRouting } from "./src/learning/learned-routing.js";
import { adaptationRegistryPath } from "./src/adaptation/promotion.js";

const SEED = process.argv[2] ?? "0x99c071";
console.log(`seed=${SEED}`);

const tid = (n: number): TaskId => `tsk_r9g${n.toString(36).padStart(4, "0")}` as TaskId;
const eid = (n: number): EventId => `evt_r9g${n.toString(36).padStart(8, "0")}` as EventId;
const aid = (n: number): AgentInstanceId => `agt_r9g${n.toString(36).padStart(4, "0")}` as AgentInstanceId;
const RUN_ID = "run_r9g-bench" as RunId;
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

/* ---- fixtures (R8-G set) ------------------------------------------------ */

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
        ? { joinPolicy: { mode: "all" as const, requiredNodeIds: Array.from({ length: joinFanIn }, (_, k) => `n${n - 2 - k}`) } }
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

/* ---- Part A: CPU plane -------------------------------------------------- */
console.log("\n[A] CPU plane (R8-G probe set re-run)");
const vfA = bench("validateFlowchart 16n join4 (seedA)", 20000, () => validateFlowchart(fcSeedA));
bench("validateFlowchart  8n join2 (seedB)", 20000, () => validateFlowchart(fcSeedB));
console.log(`  -> x32 rounds = ${(vfA * 32 / 1000).toFixed(3)} ms/run ceiling`);

const judge = new DeterministicJudge();
const evd = Array.from({ length: 8 }, (_, i) => `evd_r9g${i}` as never);
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
bench("validateCheckpoint full (N=48, incl. restore)", 2000, () => { validateCheckpoint(JSON.parse(JSON.stringify(checkpoint48))); });

/* ---- Part B: I/O floor --------------------------------------------------- */
console.log("\n[B] I/O floor on this VM");
const ioRoot = mkdtempSync(join(tmpdir(), "r9g-bench-"));
let tokAbsentUs = 0;
try {
  const ckStore = new CheckpointStore(ioRoot, RUN_ID);
  const ckWriteUs = await benchAsync("CheckpointStore.write durable (N=48)", 200, async () => {
    await ckStore.write(checkpoint48);
  });
  console.log(`  -> x66 writes/run (R6-G count) = ${(ckWriteUs * 66 / 1000).toFixed(1)} ms/run`);

  const evStore = new EventStore(ioRoot, RUN_ID);
  let n = 0;
  const apUs = await benchAsync("EventStore.append AGENT_EVENT (no fsync)", 400, async () => {
    const e = { ...events300[1] as object, id: eid(100000 + n++) } as Event;
    await evStore.append(e);
  });
  console.log(`  -> x300 events/run = ${(apUs * 300 / 1000).toFixed(1)} ms/run`);

  const evStoreR = new EventStore(ioRoot, "run_r9g-readbench" as RunId);
  for (const e of events300) await evStoreR.append({ ...(e as object), runId: "run_r9g-readbench" } as Event);
  const raUs = await benchAsync("EventStore.readAll 300 events", 300, async () => { await evStoreR.readAll(); });
  const evStoreS = new EventStore(ioRoot, "run_r9g-readsmall" as RunId);
  for (const e of events100) await evStoreS.append({ ...(e as object), runId: "run_r9g-readsmall" } as Event);
  const raSmallUs = await benchAsync("EventStore.readAll 100 events", 300, async () => { await evStoreS.readAll(); });
  console.log(`  -> x96 readAll/run at avg mid-run size = ${(((raUs + raSmallUs) / 2) * 96 / 1000).toFixed(1)} ms/run`);

  const pause = createFilePauseController(ioRoot, () => T0);
  tokAbsentUs = await benchAsync("pause token() ENOENT (not paused)", 2000, async () => {
    await pause.token(RUN_ID);
  });
  await pause.requestPause(RUN_ID, "bench");
  await benchAsync("pause token() present (paused)", 2000, async () => { await pause.token(RUN_ID); });
  await pause.clearPause(RUN_ID);

  await benchAsync("loadLearnedRouting (no registry snapshot)", 2000, async () => {
    await loadLearnedRouting(ioRoot, "/tmp/nonexistent-project");
  });
} finally {
  rmSync(ioRoot, { recursive: true, force: true });
}

/* ---- Part C: configured-state x command-class matrix --------------------- */
console.log("\n[C] configured-state x command-class matrix (real command surface)");

interface OpCounts {
  evAppend: number; evAppendFsync: number; evReadAll: number; evEventsRead: number;
  cpWrite: number; cpRead: number;
  pauseToken: number; pauseRequest: number; pauseClear: number;
  epiAppend: number; epiReadAll: number; epiEvtAppend: number;
}
const zeroCounts = (): OpCounts => ({
  evAppend: 0, evAppendFsync: 0, evReadAll: 0, evEventsRead: 0,
  cpWrite: 0, cpRead: 0, pauseToken: 0, pauseRequest: 0, pauseClear: 0,
  epiAppend: 0, epiReadAll: 0, epiEvtAppend: 0
});
let counts = zeroCounts();
const TERMINAL_EVENT_TYPES = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCEL_REQUESTED"]);

// Prototype instrumentation (observation only; no behavior change).
const origEvAppend = EventStore.prototype.append;
EventStore.prototype.append = function (event: Event) {
  counts.evAppend += 1;
  if (TERMINAL_EVENT_TYPES.has(event.type)) counts.evAppendFsync += 1;
  return origEvAppend.call(this, event);
};
const origEvReadAll = EventStore.prototype.readAll;
EventStore.prototype.readAll = async function () {
  counts.evReadAll += 1;
  const out = await origEvReadAll.call(this);
  counts.evEventsRead += out.events.length;
  return out;
};
const origCpWrite = CheckpointStore.prototype.write;
CheckpointStore.prototype.write = function (checkpoint: unknown) {
  counts.cpWrite += 1;
  return origCpWrite.call(this, checkpoint);
};
const origCpRead = CheckpointStore.prototype.read;
CheckpointStore.prototype.read = function () {
  counts.cpRead += 1;
  return origCpRead.call(this);
};
const origEpiAppend = EpisodeStore.prototype.append;
EpisodeStore.prototype.append = function (episode: never) {
  counts.epiAppend += 1;
  return origEpiAppend.call(this, episode);
};
const origEpiReadAll = EpisodeStore.prototype.readAll;
EpisodeStore.prototype.readAll = function () {
  counts.epiReadAll += 1;
  return origEpiReadAll.call(this);
};
const origEpiEvtAppend = EpisodeEventStore.prototype.append;
EpisodeEventStore.prototype.append = function (event: never) {
  counts.epiEvtAppend += 1;
  return origEpiEvtAppend.call(this, event);
};

function countingPause(inner: PauseController): PauseController {
  return {
    requestPause(runId, reason) { counts.pauseRequest += 1; return inner.requestPause(runId, reason); },
    clearPause(runId) { counts.pauseClear += 1; return inner.clearPause(runId); },
    token(runId) { counts.pauseToken += 1; return inner.token(runId); }
  };
}

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const, estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};
function router(): ModelRouter { return createModelRouter(routerConfig); }

interface MatrixNodeOpts {
  role?: FlowNode["role"]; models?: readonly string[]; preferred?: string;
  approvalRequired?: boolean; parallelGroup?: string; joinPolicy?: JoinPolicy;
}
function mnode(id: string, opts: MatrixNodeOpts = {}): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: opts.role ?? "actor",
    objective: `Do ${id}`,
    modelPolicy: {
      allowedModels: opts.models ?? ["cheap", "premium"],
      ...(opts.preferred !== undefined ? { preferredModel: opts.preferred } : {})
    },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: opts.approvalRequired ?? false,
    ...(opts.parallelGroup !== undefined ? { parallelGroup: opts.parallelGroup } : {}),
    ...(opts.joinPolicy !== undefined ? { joinPolicy: opts.joinPolicy } : {})
  };
}
const sEdge = (from: string, to: string): FlowEdge => ({ from, to, condition: { type: "success", expected: true } });

function chainFlowchart(): Flowchart {
  return {
    id: "matrix-chain",
    nodes: [mnode("a"), mnode("b"), mnode("c")],
    edges: [sEdge("a", "b"), sEdge("b", "c")]
  };
}
function approvalFlowchart(id: string): Flowchart {
  return {
    id,
    nodes: [
      mnode("a"),
      mnode("selector", { role: "router", models: ["premium"], approvalRequired: true }),
      mnode("pathA", { models: ["cheap"] }),
      mnode("pathB", { models: ["premium"], preferred: "premium" })
    ],
    edges: [sEdge("a", "selector"), sEdge("selector", "pathA"), sEdge("selector", "pathB")]
  };
}
function fakeResult(confidence: number, evidence: string): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(confidence),
    evidenceIds: [evidence],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(confidence) }]
  };
}

interface Cell { command: string; state: string; result: string; ms: number; ops: OpCounts }

async function cell(
  cells: Cell[], command: string, state: string, fn: () => Promise<string>
): Promise<void> {
  counts = zeroCounts();
  const start = performance.now();
  let result: string;
  try {
    result = await fn();
  } catch (error) {
    result = `THROWS(${(error as Error).message.slice(0, 48)})`;
  }
  const ms = performance.now() - start;
  cells.push({ command, state, result, ms, ops: counts });
}

async function runMatrix(): Promise<{ cells: Cell[]; digest: string }> {
  const stateRoot = mkdtempSync(join(tmpdir(), "r9g-matrix-state-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "r9g-matrix-proj-"));
  const cells: Cell[] = [];
  try {
    const generateId = sequenceGenerator();
    const deps = {
      stateRoot,
      router: router(),
      now: () => parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
      generateId,
      pause: countingPause(createFilePauseController(stateRoot, () => parseIsoTimestamp("2026-08-24T09:00:00.000Z")))
    };

    // C1: start -> COMPLETED (chain, results supplied).
    let run1 = "" as RunId;
    await cell(cells, "start", "fresh->COMPLETED", async () => {
      const out = await startFlowchartRun(deps, {
        projectRoot, flowchart: chainFlowchart(), objective: "matrix chain",
        childResults: { a: fakeResult(0.9, "evd_a"), b: fakeResult(0.9, "evd_b"), c: fakeResult(0.9, "evd_c") }
      });
      run1 = out.runId;
      return out.status;
    });

    // C2: start -> WAITING_FOR_USER (approval gate).
    let run2 = "" as RunId;
    let planId = "";
    await cell(cells, "start", "fresh->WAITING", async () => {
      const out = await startFlowchartRun(deps, {
        projectRoot, flowchart: approvalFlowchart("matrix-approval"), objective: "matrix approval",
        childResults: { a: fakeResult(0.9, "evd_a2") }
      });
      run2 = out.runId;
      planId = out.pendingApproval?.plan.id ?? "";
      return out.status;
    });

    // C3: pause @ WAITING_FOR_USER.
    await cell(cells, "pause", "WAITING", async () => (await pauseFlowchartRun(deps, run2, "matrix pause")).status);

    // C4: resume(unpause) @ PAUSED -> back to WAITING.
    await cell(cells, "resume(unpause)", "PAUSED", async () => (await resumeFlowchartRun(deps, run2, { unpause: true })).status);

    // C5: inject(fact) @ WAITING_FOR_USER.
    await cell(cells, "inject(fact)", "WAITING", async () =>
      (await injectFlowchartRun(deps, run2, { kind: "fact", actor: "user", confidence: 0.9, key: "matrix", value: "yes" })).status);

    // C6: approval @ WAITING_FOR_USER -> COMPLETED.
    await cell(cells, "resume(approval)", "WAITING", async () =>
      (await resumeFlowchartRun(deps, run2, {
        approvalReply: { approvalPlanId: planId, selectedActionIds: ["pathA"] },
        childResults: { pathA: fakeResult(0.85, "evd_pathA") }
      })).status);

    // C7: resume @ COMPLETED (terminal noop finish).
    await cell(cells, "resume(noop)", "COMPLETED", async () => (await resumeFlowchartRun(deps, run2)).status);

    // C8/C9: illegal cells.
    await cell(cells, "pause", "COMPLETED", async () => (await pauseFlowchartRun(deps, run2)).status);
    await cell(cells, "inject(fact)", "COMPLETED", async () =>
      (await injectFlowchartRun(deps, run2, { kind: "fact", actor: "user", confidence: 0.9, key: "k", value: "v" })).status);

    // C10: cross-process cancel observation.
    let run3 = "" as RunId;
    await cell(cells, "start", "fresh->WAITING(2)", async () => {
      const out = await startFlowchartRun(deps, {
        projectRoot, flowchart: approvalFlowchart("matrix-cancel"), objective: "matrix cancel",
        childResults: { a: fakeResult(0.9, "evd_a3") }
      });
      run3 = out.runId;
      return out.status;
    });
    await cell(cells, "cancel(x-process append)", "WAITING", async () => {
      const store = new EventStore(stateRoot, run3);
      await store.append({
        id: `evt_${generateId()}` as EventId, schemaVersion: 1,
        occurredAt: parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
        runId: run3, type: "RUN_CANCEL_REQUESTED", actor: "cli", payload: {}
      } as Event);
      return "appended";
    });
    await cell(cells, "resume(observe cancel)", "CANCELLED", async () => (await resumeFlowchartRun(deps, run3)).status);

    // Digest: op counts + results + normalized persisted bytes.
    const normalize = (raw: string): string =>
      raw
        .replaceAll(stateRoot, "<STATE>")
        .replaceAll(projectRoot, "<PROJ>")
        .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})/g, "<T>");
    const hash = createHash("sha256");
    hash.update(JSON.stringify(cells.map((c) => ({ command: c.command, state: c.state, result: normalize(c.result), ops: c.ops }))));
    for (const runId of [run1, run2, run3]) {
      const dir = join(stateRoot, "runtime", "runs", runId);
      hash.update(normalize(await readFile(join(dir, "events.jsonl"), "utf8")));
      hash.update(normalize(await readFile(join(dir, "checkpoint.json"), "utf8")));
    }
    return { cells, digest: hash.digest("hex") };
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

const digests: string[] = [];
let firstCells: Cell[] = [];
for (let iteration = 1; iteration <= 3; iteration += 1) {
  const { cells, digest } = await runMatrix();
  if (iteration === 1) firstCells = cells;
  digests.push(digest);
  console.log(`matrix iteration ${iteration}: digest=${digest.slice(0, 16)}...`);
}
console.log(`matrix deterministic (3 runs bit-identical after normalization): ${digests.every((d) => d === digests[0])}`);

console.log("\ncommand class            | state         | result                    |  ms    | ev.app(fsync) ev.readAll(evts) cp.w cp.r pz.tok pz.req pz.clr epi.app epi.read epiEvt");
for (const c of firstCells) {
  const o = c.ops;
  console.log(
    `${c.command.padEnd(24)} | ${c.state.padEnd(13)} | ${c.result.padEnd(25)} | ${c.ms.toFixed(1).padStart(6)} | ` +
    `${String(o.evAppend).padStart(6)}(${o.evAppendFsync}) ${String(o.evReadAll).padStart(6)}(${String(o.evEventsRead).padStart(4)}) ` +
    `${String(o.cpWrite).padStart(4)} ${String(o.cpRead).padStart(4)} ${String(o.pauseToken).padStart(6)} ${String(o.pauseRequest).padStart(6)} ${String(o.pauseClear).padStart(6)} ` +
    `${String(o.epiAppend).padStart(7)} ${String(o.epiReadAll).padStart(8)} ${String(o.epiEvtAppend).padStart(6)}`
  );
}

/* ---- Part D: ninth-pass candidates --------------------------------------- */
console.log("\n[D] ninth-pass candidates");

// S9-G-1: skip loadLearnedRouting on pause/inject session restores.
// (a) fail-closed witness: corrupt registry.json makes the pause command throw today.
{
  const stateRoot = mkdtempSync(join(tmpdir(), "r9g-s9g1-state-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "r9g-s9g1-proj-"));
  try {
    const generateId = sequenceGenerator();
    const deps = {
      stateRoot, router: router(),
      now: () => parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
      generateId
    };
    const out = await startFlowchartRun(deps, {
      projectRoot, flowchart: approvalFlowchart("s9g1"), objective: "s9g1",
      childResults: { a: fakeResult(0.9, "evd_a") }
    });
    const registryPath = adaptationRegistryPath(stateRoot);
    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, "{ this is not valid json", "utf8");
    let witness = "NO-THROW (divergence would be silent)";
    try {
      await pauseFlowchartRun(deps, out.runId, "s9g1");
    } catch (error) {
      witness = `THROWS today: ${(error as Error).message.slice(0, 72)}`;
    }
    console.log(`S9-G-1 fail-closed witness on pause@corrupt-registry: ${witness}`);
    console.log("S9-G-1: skipping the load would flip this cell to silent success = fail-open divergence");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

// S9-G-2: replace both per-round pause polls with fs.watch-cached state.
console.log(`S9-G-2 absolute ceiling (both polls free): 2 x 32 x token(ENOENT) = ${(tokAbsentUs * 64 / 1000).toFixed(2)} ms/run`);

// S9-G-3: drop fsync from pause.json writeAtomic (requestPause durability).
{
  const root = mkdtempSync(join(tmpdir(), "r9g-s9g3-"));
  try {
    const pause = createFilePauseController(root, () => T0);
    const withFsyncUs = await benchAsync("S9-G-3 requestPause (writeAtomic + fsync)", 300, async () => {
      await pause.requestPause(RUN_ID, "bench");
    });
    const target = join(root, "nofsync.json");
    const noFsyncUs = await benchAsync("S9-G-3 same write path without fsync", 300, async () => {
      const serialized = `${JSON.stringify({ paused: true, requestedAt: T0, reason: "bench" }, null, 2)}\n`;
      await mkdir(dirname(target), { recursive: true });
      const tempPath = `${target}.tmp`;
      const handle = await open(tempPath, "w");
      try {
        await handle.writeFile(serialized, "utf8");
      } finally {
        await handle.close();
      }
      await rename(tempPath, target);
    });
    console.log(`S9-G-3 fsync share: ${(withFsyncUs - noFsyncUs).toFixed(1)} us ONCE per pause command (one-shot command class)`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("\ndone");
```

BRANCH=cursor/r9-g-runtime-ninth-pass-83a1

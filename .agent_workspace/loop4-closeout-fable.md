MODEL_SLUG: claude-fable-5-thinking-xhigh

# Loop 4 闭环审阅（SOTA closeout）— `origin/main` = `80eb0bd`

审阅者独立在本 VM（Node v22.14.0，engines `>=22.19.0` 仅告警）于 `main` @ `80eb0bd`（Merge PR #10）
复核：`pnpm gate` **exit 0 — 2050 tests / 2049 pass / 0 fail / 1 skipped / 120 suites**，TAP 中恰好
一行 `# SKIP`（`PI_SMOKE` 真实供应商门）；`node scripts/crash-probe.mjs` **exit 0，`ok: true`，
11 案例 × 3 次迭代**，名单与顺序逐一核对（`jsonl-truncated-tail` … `unblock-discard-append-before-
checkpoint-sigkill` 居末）。`gh pr view` 确认 **PR #8 MERGED（merge commit `985250b`）、PR #10
MERGED（merge commit `80eb0bd`）**。ADR-006 直接读文件确认仍为 **Proposed**
（`docs/decisions/0006-pi-extension-reverse-adapter.md:5`）。本报告只写这一个文件，不改 `src/`，
不提交 git。

依据材料：`.agent_workspace/PROGRESS.md`（Loop 4 Rounds 1–21 全记录）、`ROUND16/17/18/20/21-BRIEF.md`、
`loop4-r18-review.md`、`loop4-r20-audit.md`、`loop4-r20-review.md`，以及 HEAD 代码直读
（`src/run/flowchart-run.ts`、`src/pi-adapter/pi-executor.ts`、`src/execution/contract.ts`、
`src/run/coordinator.ts`、`src/run/replay.ts`、`docs/specs/m0-m2-architecture.md`）。
注意：`docs/kernel-reuse.md` 全文件冻结且有三处已被后续落地取代（见 §3），不作为现状依据。

---

## 一、总共干了些什么（按能力分组，不按轮次）

Loop 4 = PR #8（`agent/opt-continuous`，Rounds 1–17 + 合并 origin/main）+ PR #10
（`cursor/opt-r18-postmerge-42b1`，Rounds 18–21）。门禁测试数从 Round 1 的 **1508** 走到收官的
**2050**（其中合并 kernel-reuse + Loop 3 面带来 1981→2038 的 +57，Round 18/20 两轮共 +12）。
按能力聚类：

### 1. 成本上限（maxCostUsd）全链路 — 从"披露但不执行"到端到端强制且可幸存暂停/恢复

- 合并面（kernel-reuse epic，随 PR #8 进 main）：`CostGate` 执行器级计价停止、
  `RunLimits.maxCostUsd` 经 `costCapFor`（per-task 与 run 级取 min）转发到执行请求与子
  `RUN_CREATED.limits`；CI 修复 `159630e` 把披露文本改为"转发 + 执行器相关强制"。
- **R18-2 `daea498`**：`parseChildSpec` 携带声明的 per-child `maxCostUsd`（正有限数），非法值在解析层
  以 `DomainValidationError` 点名任务拒绝——这是合并诱发洞（两侧单独都无此洞），审计 3× 出树证明
  CLI 声明的上限在 `TASK_REQUEST.limits` 与子 `RUN_CREATED.limits` 上原先全部丢失。
- **R20-1 `1d9ef99`**：`FlowchartCheckpointState.taskCostCeilings` 在接受时刻持久记录每个子任务
  声明的上限（仅 ceiling、可选、缺席即未知、first-write-wins、绝不合成），`fallbackChildLimits`
  的兄弟臂只替换 `maxAttempts`/`timeoutMs`/`maxWallTimeMs`（**绝不复制 `maxCostUsd`**），
  `withRecordedCostCeilings` 只对被替换的 spec 恢复记录的 ceiling，`validateTaskCostCeilings`
  失败即关闭。审计证明了双向缺陷：pause/resume 会把兄弟的 0.25 **发明**给未声明的孩子（三处
  持久记录全污染），也会把声明的 0.05 **蒸发**（孩子无上限运行、exit 0、无警告）。以上座标
  （`flowchart-run.ts:428/521/666/954/1452/1631`，`replay.ts:482/569`）本审阅在 HEAD 直读确认。

### 2. Steer（运行中转向）诚实性 — 从"记录可以撒谎"到投递前置、可幸存重试、目标明确

- 合并面：`SparkleKernel` 门面、`RunningRun.steer`、`STEER_INJECTED`（投递先于记录）、
  `THINKING_DELTA` 仅字节数（CoT 正文不进事件日志，`execution/contract.ts:30` 直读确认）、
  `77e5d42` 事件流经工具启动持续直播（判定仍按 attempt 缓冲）。
- **R18-1 `4412fac`**：已接受的 steer 幸存 429/5xx 重试——执行域 `acceptedSteers` 日志、每 attempt
  快照、在新 attempt 首个 `TURN_FINISHED` 后经 `kernel.steerText` 重投递、一次性闩锁
  （`pi-executor.ts:461/568-584/655-690` 直读确认）。审计证明原行为：重试丢弃 steer 而
  `STEER_INJECTED` 永久记录一条没有任何幸存调用见过的指令。
- **R20-2 `57ade59`**：`AgentExecutor.steerText?(text, agentInstanceId?)`（`contract.ts:61` 直读
  确认），`startRun` 以根实例为目标开启 steer 窗口，目标未命中在任何写入前大声拒绝；
  `startParentRun` 保持无目标（whichever-child 是披露语义，其 `STEER_INJECTED` 载荷 key 恰为
  `["text"]`，有 pin）。审计证明原行为：共享执行器时 A 的 steer 落进 B 的内核，A 的日志却记录
  自己的 `agentInstanceId` 被 steer——双重持久失实。

### 3. 暂停 / 恢复 / 解锁（unblock）链路 — 从缺失到有审计、有折损披露的完整状态机

- `RUN_UNBLOCKED`（R8-1）+ 锁定的 `unblock` 命令；`RUN_UNBLOCKED_WITH_DISCARD` + `unblock
  --discard-executed`（R10-1 `54cf5e5`，已计费估算 fail-closed 对账 `MODEL_ROUTED`）；恢复路径
  discard 计费审计（R11-4 `9663294`）。
- 检查点上的持久 `contract`（R9-1 `aeb14dc`）；`taskCriteria` writer+reader + 早期 run-id 披露
  （R12-1 `81f5b81`），unblock 携带前滚（R13-2）；tracked-run 暂停控制器（R11-3）；
  R20-1 的 `taskCostCeilings` 镜像了 `taskCriteria` 的全部七个 seam（含 unblock 重开写入）。
- 恢复语义：从父日志重建子 spec（R7-1）、resume 共享 invocation sink（R3-9）、
  `resume --primary-model/--thinking` + 重建披露（R4-6）、空任务图预检拒绝（R7-9）。

### 4. 持久化 I/O：原子写与写侧校验 — 全树消灭撕裂写

- 共享 `writeFileAtomic` 唯一临时名（R1 T3），tombstones/catalog-observed/preferences（R4-7/9）、
  bandit store（R5-3）、providers/credentials/adaptation registry（R5-4）、eval-routing 报告
  （R16-3 `9c58b90`，树上最后一个裸截断 `writeFile`）全部原子化；feedback/invocation 重写原子化
  （R3-2）。
- 写侧校验补齐：`validateEpisodeEvent` 进 `EpisodeEventStore.append`（R16-2 `ee24d86`，原先一条
  坏行会永久 brick 该 episode 的 `readAll`）；事件日志 `DomainValidationError` + 行 fuzz（R3-4）。
- `migrate-legacy --apply` 崩溃自愈：唯一临时 + fsync + `link`（EEXIST→digest 分支），never-overwrite
  在 link-less 文件系统回退臂也有 pin（R16-4 `92ffd15` + R17-2 `16a471d`）。

### 5. 锁与跨进程竞争 — 清空无锁读改写清单

- feedback `records.jsonl.lock`（R1 T1）、typed `LOCK_TIMEOUT` + 有界重试（R2-2）、episode 锁下
  settle/delete（R1 T4、R2-3）、run 生命周期锁（R4-1、R5-1）、以及树上**最后一个**无锁跨进程
  RMW——`pref correct/delete` 的 `preferences.json.lock` 跨 bind+mutate+persist（R16-1 `16691b3`，
  审计证明了"已删除观察复活、tombstone 消失、无任何报错"）。
- 有意的不作为也被测量并冻结：`EventStore.append`/`CheckpointStore.write` 保持无锁（R4 每步
  run-lock 因 e2e +22.5%/+17.5% 超出 5% 预算被**回滚**）；不偷锁（PID 复用保守立场）。

### 6. 崩溃终局与灾难恢复 — crash-probe 从 3 案例长到 11×3 并保持全绿

- 共享 `crash-terminal.ts`（R5-2）、崩溃时冲刷可恢复 flowchart 检查点（R4-4）、逃逸错误追加
  `RUN_FAILED`（R3-5、R4-3）、父平面崩溃拒绝覆盖已回放终局（R7-4）、WAITING_FOR_USER 崩溃语义
  （R8-7）。探针案例演进：R1 的 3 → R2 6 → R3 8 → R6 9 → R9 10（unblock 窗口）→ R11 11
  （discard 窗口），R11 之后冻结在 11×3 直到收官（本审阅独立重跑 `ok: true`）。

### 7. 协议冻结与判定生产者 — 把"当前行为"变成字符级契约

- 判定生产者：`sparkle_report_task_result` 工具（R9-2 `dff71f1`，PASSED 开门 / FAILED 硬阻塞）、
  option (a) 逐条 criteria 门控（R11-1 `6096da6`）、never-synthesize-from-episode（R10-7）。
- 冻结面：五条 `DOCTOR_ROUTED_NEXT` 字符级、`INSPECT_SUMMARY` 四键 additive、八成员 `RunStatus`、
  `RUN_UNBLOCKED` 载荷三键、`TERMINAL_REPLAY_STATUSES`、BLOCKED 前缀、`applyRetry` AST 缺席 pin、
  探针 11 案例顺序。这些冻结让 Round 18/20 的审阅能以"11 文件外逐字节不变"结构性证明其余契约。

### 8. 隐私 / 隔离平面

- adaptation-plane 传递值导入闭包（Loop 3 seed → 合并后 `dc0c611` 收紧到恰好 4 模块，双向
  stale-entry 断言）；`delete --run/--episode` 级联验证（`RunRecordsSurvivedError`、R3-3）；
  R17-1 `223e3dd` 删除持久化已死的 `recordInferredPreference` 调用（方向 (b)：CLI 推断偏好平面
  显式不上线，机制留给嵌入方）。

### 9. 诊断与运维（doctor）

- 陈旧锁清单（不偷锁，R3-6）、逐锁修复指引 + PLANNING/RUNNING 清单（R4-5）、learned/derived
  状态清单（R6-4）、keyed 只读读取器（R7-8）、`LOCK_TIMEOUT`/`RUN_RECORDS_SURVIVED` 等 `next:`
  路由进 doctor（R5-9、R6-5）。

### 10. 性能（仅早期两轮，同 VM 记录）

- R1 T7：jsonlAppend **−36%**、fsync **−34%**（评审独立复测 −31.5%/−28.6%）；R2-2：锁
  serial/contended **约 −12.5%**（复测 −14.4%/−12.0%）。R2 后 jsonl/锁性能面宣告饱和，Rounds
  3–21 **零性能声明**（协议要求同 VM 前后对照 ≥5% 才可声明，无则不claim）。

### 11. 死代码与文档真实化

- 删除：`expired()`（R2-9）、`applySkipped`（R3-8）、未用 episode replay（R5-10）、
  `settleSupervisedOutcome`（R7-7）、`loadProjectBandit`（R8-9）。
- 每轮 docs truth-up；R15 `5d7c0d6` 终结 census-note 跑步机（此后只有落地触发的对齐，随落地
  同 commit 进树——R18-2/R20-1 的 spec 对齐即此形态）。

---

## 二、是否有效提升了程序能力（诚实评估）

### (a) 用户可见的运行时能力：有真增量，但不是 21 轮的主体

真正的新可用面：`unblock` / `unblock --discard-executed`（阻塞恢复出口）、
`resume --primary-model/--thinking`、`migrate-legacy` 崩溃自愈、`pref` 命令跨进程安全、
`doctor --json` 路由与修复指引、以及合并进来的整套 kernel-reuse 运行时（直播流、steer、
思考字节遥测、成本门）。**但需要诚实**：直播/steer/成本门这套能力主体是 kernel-reuse epic
（PR #5 线）造的，Loop 4 本轮（尤其 18–21）的贡献是把它在崩溃/重试/恢复/共享下**修成不撒谎**
——R18-1/R18-2/R20-1/R20-2 四个落地全是修复合并面暴露的诚实洞，而非新增可见功能。
Rounds 8–13 的 unblock/contract/criteria 链路是 Loop 4 自身最大的一块用户可见增量。

### (b) 崩溃 / 重试 / 恢复 / steer 下的正确性与诚实性：这是本 loop 的实质产出，证据质量高

这一维度的提升是真实且被独立证明的：每个声明的缺陷都有 3× 确定性出树复现（真实仓库代码），
每个修复的每条承重子句都被评审自己的变异体杀死（如 R20-1 的"发明"单红 / "蒸发"双红，R18-1 的
放置/双施加/闩锁三个变异体 0/2）。持久记录不再在这些窗口撒谎：重试不再吞掉已确认投递的 steer；
steer 不再落错运行；pause/resume 不再发明或蒸发成本上限；解析层不再静默丢弃声明的上限；
崩溃窗口 11 案例探针常绿。**代价同样诚实**：这些改进的用户可感知度低——只有踩到对应窗口
（重试中 steer、暂停后恢复、共享执行器）的用户才会受益，日常路径行为不变。

### (c) 性能：只有 Rounds 1–2 有合规声明，此后为零

有记录的同 VM ≥5% 收益仅两笔：jsonlAppend −36% / fsync −34%（R1 T7）与锁 −12.5%（R2-2），
且各有评审独立复测。反向证据同样在案：R4 每步 run-lock 因 e2e 回归 +22.5% 被回滚——5% 预算
双向执行。Rounds 3–21 无任何性能声明，这是纪律而非产出：**本 loop 对运行时性能的总贡献止步于
第 2 轮**。R20 评审记录的 `persistCheckpoint` 每次写扫描日志两次未做声明、不欠声明。

### (d) 测试增长（1508 → 2050，+542）：主体是契约钉（pin），不是功能

+542 中，合并面带入 +57（1981→2038）；Round 18/20 的 +12 全部是四个修复的回归钉（+4、+8，
逐条分解到 TAP 编号）。中段 Rounds 10–13 的大量 slot 是 freeze/report-only（"keep X" 类），
R14/R15 只剩 docs（1951 三轮不动）。**钉不是坏事**——正是 11 案例探针顺序、五路由字符级、
`RunStatus` 八成员这类冻结，让后续审阅能结构性证明"其余一切未动"，把每轮验证成本压到两个
文件集的 diff——但把 2050 读作"能力是 1508 时的 1.36 倍"是错的；它更接近"行为契约被钉死的
密度提高了 1.36 倍"。

### 饱和与未动面（必须点名）

- **饱和是真实且被诚实记录的**：R14（2 slot，纯 docs）、R15（1 slot）、**R19 零 slot、R21 零
  slot**（ROUND21-BRIEF §4 空）。R16 的平面重定向（I/O/竞争/协议/DR）找到 4 个真实项，R17 剩
  2，合并这个"新 seam"给了 R18 两个、R20 两个，然后归零。协议的四条有效派发理由（新 seam /
  复现的行为缺口 / 门禁探针变红 / 落地致陈旧面）在 HEAD 一条都不满足——零 slot 是对的，
  硬凑第 22 轮就是灌水。
- **没有动的**（全部是有意为之的策略门，不是遗漏）：ADR-006 仍 **Proposed**（本审阅直读确认）；
  live R1/bandit/topology 仍不在执行路径（bandit 仅 shadow，doctor 只读清单是唯一例外）；
  无 Outcome-supported 声明；无 auto-promote；P0 隐私独立签核仍开放；F-PROD 密封 holdout 未做；
  留存无界（Q3 接受）；真实供应商覆盖仍是那 1 个 `PI_SMOKE` 永久 skip；Node engines `>=22.19.0`
  vs 本 VM 22.14.0 仍靠 doctor fail-closed 兜底。

**一句话结论**：Loop 4 有效提升的主要是**第 (b) 维**——程序在崩溃/重试/恢复/转向下的持久记录
诚实性，且证据链达到了变异体级；(a) 有中等真实增量（unblock 链 + 合并的 kernel 运行时）；
(c) 止步于前两轮；(d) 的数字主体是防回归资产而非能力。

---

## 三、接下来还可以怎么优化（仅 HEAD 上仍是真实工作的项，已排序）

前提：**不发明 slot**。HEAD 零候选是审计结论；以下任何工程项启动前都欠一份该 HEAD 上的全新
3× 确定性出树证明。禁区维持：不解冻 live R1，不 Accept ADR-006，不 Outcome-supported，
不 auto-promote，不动依赖。

### (i) 父编排已停放的产品决策（ROUND21-BRIEF §5 及沿承 §5；需要产品拍板，不是工程 slot）

1. **`docs/kernel-reuse.md` 冻结复判**（成本最低、诚实债最明确）：该文件现有**三处**已被落地
   取代的规范性表述——`:131-136`+`:213-214`（"排队 steering 不幸存重试 / document-and-drop"，
   已被 R18-1 取代）与 `:54`+`:72`（单参数 `steerText` 签名与 sole-live 描述，已被 R20-2 取代）。
   解冻后是一个纯 docs 对齐落地；不解冻则这份"extenders must respect"文档持续对二次开发者撒谎。
2. **CLI 成本可观测性**：R18-2/R20-1 之后操作者能声明 per-child 上限，但 run 级 `maxCostUsd`
   无 CLI 旗标、`onCostGate` 无 CLI 接线（停放决议：折入未来证明了操作者需求的 slot）。这是
   成本链路从"诚实"走向"可用"的下一步，属产品范围决策。
3. **父运行 × 根运行共享执行器的无目标 steer 跨投递**（R20 评审 t2 残留 R3）：判定为 HEAD 上
   非缺陷（父按签核无目标、其 `STEER_INJECTED` 不点名实例、无持久记录失实——有 `ok 308` 钉）。
   修复需要父路径候选集拒绝或被禁的第二注册表。除非新证明显示某条持久记录真的失实，否则
   仅是产品语义选择。
4. **flowchart 平面支出账本 / 节点级 ceiling**：`FlowchartRunLimits` 无 `maxCostUsd`，跨子
   N·$X 界只有披露。这是能力建设（非诚实洞），R18 brief 已明确"先要产品决策"。
5. **`steer` CLI 动词**：`RunningRun.steer` 目前是嵌入方 API，没有任何面声称 CLI 可 steer。
   产品工作。
6. **真实供应商覆盖**：`PI_SMOKE` 那 1 个永久 skip 是门禁里唯一的非绿格。要动它需要凭据与
   CI 策略决策，不是代码 slot。
7. **长期策略门**（不属于本 loop 性质的工作）：P0 隐私独立签核、F-PROD 密封 holdout、留存
   上界、Node engines 与 22.14.0 宿主的对齐。

### (ii) 诚实性 / I/O / 竞争 / 协议 / DR 残留——每项都欠全新出树证明，且多为 owner-on-next-touch

1. **unblock 重开的 `taskCostCeilings` 行为级 pin**：当前只有源码 tripwire（与 `taskCriteria`
   在该 seam 覆盖等价）。下一个触碰 unblock seam 的落地应顺手补行为用例（阻塞 flowchart +
   带上限的未派发子任务）；单独开 test-only slot 无复现缺陷即灌水（R21 brief 已如此判定）。
2. **`SteerChannel.settled()` 的 allSettled 吞没**：磁盘 append 失败会丢 steer 记录而运行继续。
   仅磁盘故障可达、无复现；记录给下一个 owner of `coordinator.ts`，若能造出确定性磁盘故障
   复现则升格。
3. **遗留检查点（字段前）对未派发子任务的 ceiling 丢失**：已披露、规范已写明；"修复"意味着
   合成，违反 never-synthesize 冻结。只能随某个未来的迁移工具议题一起看，单独不是工作。
4. **测试套件 `/tmp` mkdtemp 泄漏**（每全套约 65–128 个 `pi-sparkle-*` 根）：测试卫生，冻结
   姿态是"折入下一个拥有那些套件的 slot"；同类还有 tsx 转译缓存陷阱（已定为流程规则而非代码
   slot）。
5. **`persistCheckpoint` 每写两次日志扫描**：唯一在案的潜在性能点。只有拿出同 VM 前后对照
   ≥5% e2e 才构成工作；jsonl/锁两个面已宣告饱和，别处收益需先有新基准。

### (iii) 会是灌水的（点名以免回潮）

第 12 个 crash-probe 案例（两轮父方明确 decline）；freeze-extra 重普查；无复现缺陷的 test-only
钉；把 `security-probe` 当例行公事重跑（仅当 `dist/` 面或 redaction 管线变动时再进审计）；
无落地触发的 census note；重开 R18-1 回放放置/闩锁、跨重试 steer 顺序契约、blank-before-target
消息顺序、不可达的 kernel 拒绝顺序钉；广播 steer 或第二内核注册表；以及**在四条有效派发理由
一条不满足的情况下开 Round 22 本身**。

---

## 附：本审阅的核验清单

| 事实 | 来源 | 结果 |
|---|---|---|
| PR #8 / PR #10 MERGED（`985250b` / `80eb0bd`） | `gh pr view 8/10` | 确认 |
| 门禁 2050/2049/0/1 skip（`PI_SMOKE`），120 套件 | 本审阅自跑 `pnpm gate` @ `80eb0bd` | exit 0，逐项一致 |
| crash-probe 11×3 `ok: true`，顺序不变 | 本审阅自跑 | exit 0，逐名核对 |
| ADR-006 Proposed | 直读 `docs/decisions/0006-…md:5` | 确认 |
| `steerText(text, agentInstanceId?)` | 直读 `contract.ts:61`、`pi-executor.ts:712` | 确认 |
| `acceptedSteers` 重投递（首 `TURN_FINISHED` 闩锁） | 直读 `pi-executor.ts:568-584/655-690` | 确认 |
| `taskCostCeilings` 记录/恢复/校验 | 直读 `flowchart-run.ts`、`replay.ts:482/569` | 确认 |
| Round 19 / 21 零 slot | ROUND19 记录（PROGRESS）+ ROUND21-BRIEF §4 空 | 确认 |
| R18-1 `4412fac`、R18-2 `daea498`、R20-1 `1d9ef99`、R20-2 `57ade59` | `git log` + 两轮 review | 确认 |

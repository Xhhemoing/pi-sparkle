# pi-sparkle 项目分析与优化建议

- 基线：`3310feb3cb7846195dad5de8b8b1587f04fc839d`（main）。
- 分析日期：2026-09-12，本机时区；复现输出的 UTC 日期可能为 2026-09-11。
- 环境：Windows，Node.js `v24.18.0`，pnpm `10.17.1`。
- 范围：架构导航、关键源码人工审查、全量基础门禁、内置探针、临时目录中的针对性复现。未修改业务源码，未发起真实模型调用，未测量真实供应商成本。
- 证据等级：**复现**＝本次运行观察；**静态确认**＝源码明确行为；**风险/建议**＝需要进一步测试或设计决策。不是生产就绪认证或穷尽式安全审计。

## 1. 总体判断

项目已经是较完整的本地多 Agent 编排与实验基础设施，而不是简单的提示词包装：具备 DAG 调度、父子协议、checkpoint/resume、审批与解除阻塞、runtime/adaptation 分区、反馈脱敏、删除级联、遥测及人工批准的策略晋升。

但它还不是“可靠地自主完成开发任务，并证明自适应优于静态路由”的产品。下一阶段的最大收益来自：

1. 修复持久化与控制面一致性；
2. 建立实际开发工具与独立验收闭环；
3. 修正 F6 实验采集与证据资格；
4. 再优化路由、性能和产品体验。

不建议现在扩展更多 Agent 角色、启用 live R1/bandit、改造成微服务或直接迁移全部存储。

### 已有优势，应保留

- `docs/status-matrix.md` 明确区分 Present / Wired / Exercised / Outcome-supported，承认目前无 Outcome-supported 能力。
- `package.json` 固定 Pi 依赖版本；适配边界有测试和 probe。
- `src/graph/compile-children.ts` 将 children 编译到 flowchart，避免主要 CLI 路径维护两套执行引擎。
- `src/telemetry/invocation-log.ts` 统一共享调用日志的写入与删除重写锁。
- `src/privacy/` 对删除、残留文本、状态平面和保留期已有明确实现，不应误报为“没有隐私治理”。
- adaptation 保持 proposal-first；R1/bandit 不直接参与 live 模型选择。
- 测试包含行为测试、故障注入、协议契约、边界隔离及文档一致性，而不只是 happy path。

### 规模与架构

本次统计：`src/` 230 个文件、51,313 行；`test/` 314 个文件、82,204 行，后者包含辅助文件和 fixtures，并非 314 个独立测试套件。

主链路：

```text
CLI → 配置/模型目录/需求与 children 编译
    → flowchart run → supervisor / router → child coordinator
    → AgentExecutor → pi-adapter 或 fake
    → 结构化协议、事件日志、checkpoint、episode
    → tracking / evaluation → learning / adaptation 提案
```

已有 `graphify-out/` 用于导航；其报告标注 2026-08-20、196 个源文件，早于当前源码规模。图中的关系必须回源确认，不能将旧图的“无环”等结论视为当前检查结果。

## 2. 本次验证结果

| 检查 | 实际结果 | 解释 |
|---|---|---|
| `pnpm gate` | exit 0 | typecheck、lint、test、build 均完成 |
| 测试汇总 | tests 2567；pass 2549；fail 0；skipped 18；cancelled 0；todo 0 | 测试部分耗时 59,262.886 ms；不是全门禁耗时 |
| `pnpm security:probe` | status ok；passed 26；openFindings []；waivedFindings []；refusedWaivers [] | 仅证明该 probe 覆盖的条件 |
| `pnpm pi:probe` | 4 条 PASS | 两个 0.85.1 依赖 pin、旧类型标识、ThinkingLevel 导入边界 |
| `pnpm kernel-reuse:probe` | 3 条 PASS | live-stream、kernel-facade、executor-steer |
| `pnpm bench:runtime` | exit 1；后续直接运行同脚本 3 次仍失败 | 共 4/4 次在 contended.lock 的 open 遇到 EPERM；一次清理还报 ENOTEMPTY |
| JSONL 续写复现 | `JSONL_AFTER_ERROR corrupt line 2` | 可读取的残尾在追加后变为日志损坏 |
| 原子写故障注入 | async / sync 均 `destination: ENOENT` | 第二次 rename 失败后旧文件不见 |
| F6 runner 配置失败复现 | runner exit 0；两臂 UNKNOWN / exitCode 1 / invocationCount 0 | 仍生成 production-candidate |
| 自报成功信号复现 | source=subagent；kind=deterministic；criterion=taskSuccess；outcomeKind=PASS；evidenceIds=[] | 有保留 subagent 来源，但没有独立验证证据 |
| pause 完成交错注入 | `PAUSE_REQUESTED after a terminal event` | 使用 PauseController seam 模拟读状态后另一写入者完成；非真实跨进程压力测试 |

补充边界：安全子代理因配置的模型不存在而未启动，安全相关源码由主线程检查；其失败不计为安全审查通过。未运行远程依赖漏洞数据库、真实 provider smoke 或完整真实进程 kill probe。18 个跳过项包括 Windows 权限/并发测试及 opt-in crash 测试，不应统称为无关跳过。

## 3. 第一优先级：持久化和控制面

### A1. JSONL“读取残尾”不等于“恢复后可续写”【复现】

位置：`src/persist/jsonl.ts:14–66`；`src/run/event-store.ts:103–133`。

`readJsonlObjects` 返回残尾 recovery 信息，但不截断文件；`appendJsonlLine` 直接追加。文件为 `{"ok":1}\n{"partial` 时，先读取可得到一条记录和 recovery；追加一条完整记录后，再读取报 `corrupt line 2`。

建议：在写入者持有对应锁时，提供显式 repair/recover-and-append：保留完整记录的字节边界、备份或隔离损坏尾部、截断后同步，再追加。读取仍保持只读；中间损坏仍 fail closed。禁止在无锁读取路径自动修复。

验收：覆盖 UTF-8 多字节截断、完整但无末尾换行、残尾后 append→read→resume、修复过程中再崩溃、episode 与 invocation 共用 helper 的路径。

### A2. atomic write 回退会丢失旧有效文件【复现】

位置：`src/persist/atomic-file.ts:109–118,166–180`。

首次 rename 返回 EPERM/EEXIST/EACCES 后执行删除目标，再次 rename 失败时，finally 又清理临时文件。对已有旧文件进行两次 EPERM 注入，异步与同步实现均得到 ENOENT。

已有 `test/unit/persist/atomic-file.test.ts:199` 测试第二次 rename 失败后的临时文件清理，但该测试没有预置旧文件，未验证旧状态存活。这是断言缺口，不是完全没有失败测试。

建议：优先采用失败时保留旧文件的策略；若目标平台必须绕过 replace 限制，设计 generation/备份恢复协议并验证 reader 行为，不能将 unlink→rename 继续宣称为无条件 crash-atomic。区分原子可见性与掉电持久性，明确目录同步能力。

验收：旧文件存在、第二次 rename 失败、发布阶段进程退出、并发读写均能保留或恢复上一有效 generation。修复同步和异步两条路径。

### A3. pause / inject 与运行主循环的写入所有权不一致【部分复现、部分静态确认】

位置：`src/run/flowchart-run.ts:1921–1983`、`src/run/pause-controller.ts:89–104`、`src/run/coordinator.ts:107`。

- 主执行 start/resume 持有 run 生命周期锁；pause 的 token 写入也要求同一锁，因此长任务执行时 pause 不能及时写入，可能等到超时或执行结束。
- `pauseFlowchartRun` 在获得 token 写锁之前恢复 checkpoint、校验状态；锁等待期间状态可能变化。模拟该交错后，实际产生终态后的 PAUSE_REQUESTED 异常。
- `injectFlowchartRun` 未持有同一生命周期锁，却从 checkpoint 重建 supervisor 并回写。恢复逻辑只专门补放 unblock，不重放 injection；与主循环并发可能丢注入或覆盖更新。该覆盖交错尚未做跨进程复现。

建议：主循环成为唯一状态写入者；pause/inject 写有 requestId 的控制消息，主循环消费、确认并持久化。暂不支持活动执行时注入也可以，但必须明确拒绝而不是接受后可能丢失。不要用“给每条事件再加 run 锁”代替所有权设计，容易造成重入问题和不必要 I/O。

验收：暂停长任务有可测响应上界；inject 恰好一次或幂等应用；并发完成/pause/inject/delete 不能让 checkpoint 倒退；日志与快照一致。

### A4. Windows 并发锁基准稳定失败【复现，OS 级原因待定位】

位置：`src/persist/file-lock.ts:54–63`；`scripts/bench-runtime.mjs:79–94,139–143`。

4/4 次基准失败于 contended.lock 的 `open` EPERM。源码只把 EEXIST 作为竞争重试；EPERM 直接退出。尚不能据此断言是杀毒、ACL 还是 Windows 删除/重建瞬态造成。一次 ENOTEMPTY 清理错误与 Promise.all 提前拒绝后其他 worker 尚未结束的实现风险一致。

建议：先记录 open/close/rm 时序和错误码，增加 Windows 竞争回归。若确认可恢复瞬态，做平台限定、有界重试；不要吞掉所有权限错误。基准失败时取消并等待所有 worker settle，再清理，并保留此前已完成阶段的数据，而非全部输出 null。

## 4. 第二优先级：真实开发能力与证据可信度

### B1. 默认真实 CLI 没有文件读写和测试执行工具【静态确认】

位置：`src/cli/main.ts:193–258`、`src/pi-adapter/runtime.ts:42–81`、`src/pi-adapter/pi-executor.ts:536–553`。

`createConfiguredPiExecutor` 没有接收/传入 tools；执行器最终工具集合为可选外部 tools、cluster tools 和任务结果上报工具。CLI 默认未注入 read/write/bash/check 工具；工作目录主要作为提示文本传入。因此真实模型调用、分析与结果上报，不等于完成仓库修改和测试。

建议：明确两条产品能力：analysis-only 与 coding executor。coding 路径先接入受控读文件、受限补丁、受控检查命令及 artifact 持久化；每个任务使用隔离 worktree。`allowedToolNames`、`canWriteWorkspace` 必须在执行边界强制约束，不能只出现在 `src/run/child-prompt.ts:33–34` 的提示词中。

验收：使用临时示例仓库，从真实文件读取→修改→独立测试→可检查 diff/artifact 完成一个任务；只读角色越权和路径逃逸必须拒绝。真实 provider 测试仍需显式 opt-in，不在默认 CI 消耗凭据。

### B2. 自报 PASSED 与独立验证事实尚未分离【复现；部分已记录为已知限制】

位置：`src/pi-adapter/pi-executor.ts:377–427`、`src/learning/signals.ts:282–342`、`src/learning/task-success.ts:24–31`、`src/tracking/from-child.ts:186–228`。

调用结果上报工具，仅传 PASSED 和 summary，不提供 evidence，也能产生 `kind: deterministic` 的 taskSuccess/PASS 信号；source 仍为 subagent。tracking 还会按 PASSED 生成合成 exitCode 0、复制 requiredChecks 为 completedChecks。这不是独立执行命令所得的检查结果。

项目已明确记录 `independentEvidence` 不是第三方证据且当前不消费该字段；本报告不将它误报为新发现的字段消费漏洞。但学习和未来实验必须区分报告来源与验证来源。

建议：增加 `verificationSource: self-report | command | independent-review | human`，并绑定 artifact hash、revision、cwd、命令与检查记录。只有符合策略的外部检查进入成功率学习和 F-PROD；自报可保留为执行进度信号。失败引用还应验证实际存在、属于该任务，而不只是 ID 前缀合法。

### B3. 交付物不要塞进 TASK_RESULT.summary【静态确认及历史记录】

`docs/reports/2026-09-04-xhh-dogfood-acceptance.md` 已记录长输出运输问题；`src/run/child-coordinator.ts:780–788` 只持久化 TEXT_DELTA 的长度摘要，不存正文。

建议：保持不持久化隐藏思考链的现状，新增显式 artifact 通道保存用户可见交付物，含 MIME、字节数、内容哈希、来源任务、删除策略。summary 保持短摘要；不能通过放宽 summary 无限长度解决。

## 5. F6 实验基础设施：采集结果还不能作为有效比较

### C1. 未执行的两臂仍生成 production-candidate【复现】

位置：`scripts/holdout-block.mjs:82–85,114–124,212–233,235–260`。

runner 为各臂创建空 state root，并删除 PI_PROVIDER/PI_MODEL 等环境覆盖，却不安装冻结 providers/default 配置。`src/cli/main.ts:216–226` 会在真实模型执行前拒绝。遥测读取的 catch 又将读取/解析失败统一变成空数组；provenance gate 只遍历已有行，空集自然通过。

本次用临时 spec、cheap/premium 目录、`--executor pi` 运行整个 runner；两臂均在配置阶段失败，没有模型调用，却输出：

```text
RUNNER_EXIT=0
R0: UNKNOWN invocations=0 cacheHits=0
R1: UNKNOWN invocations=0 cacheHits=0
evidenceClass: production-candidate
两臂 exitCode: 1；tokensIn: 0；tokensOut: 0
```

建议：单独定义 `harnessStatus`、`taskOutcome`、`telemetryCompleteness`、`eligibility`。配置失败、未知 run、损坏日志不能生成有效候选样本；保留拒绝记录和原因。先复制脱敏的冻结配置，凭据通过显式 provider 引用注入，不复制整个用户状态。

**不要简单要求任务必须成功或 CLI exitCode 必须为 0 才纳入样本。** 真实任务失败本来就是实验 outcome，过滤它会造成幸存者偏差；应拒绝的是不可评价的采集失败，并预注册超时、工具错误、零调用拒绝等情形的归类规则。

### C2. R0/R1 两臂任务语义、目录和执行路径不等价【静态确认】

位置：`scripts/holdout-block.mjs:74–78,137–191`。

R0 执行完整 children spec；R1 仅取 tasks[0] 构造单个 actor 节点，没有保留全部任务、依赖、角色、acceptanceCriteria 和 limits。R1 使用固定价格 1、固定 taskFamily/featureVersion 和 Date.now；这会影响成本选择和后验匹配，冷启动 fallback 也未必等同于实际 R0 臂。R1 的 allowedModels 仍包含多个模型，不是严格单模型 pin。

建议：两臂共用完整 taskSpec 编译结果，只改变路由策略；冻结真实 catalog、R0 版本、观测集和时间参数。R1 选择若定义为固定干预，使用单元素 allowedModels；若允许 cascade，就把其规则明确纳入实验干预。增加逐字段任务等价测试。

### C3. 原始证据与构建来源不足【静态确认】

位置：`scripts/holdout-block.mjs:65,246–260,269–275`。

runner 使用当前工作目录的 dist，而基线 worktree 由 baseCommit 决定；构建来源未独立记录。最终 block 只保留调用聚合，finally 删除临时 state root，丢失逐 invocation 的模型、价格版本、调用身份等复核材料。缺失 token 被汇总为 0，混淆“没有数据”和“没有消费”。

建议：记录 runtimeCommit/buildHash、workloadCommit、spec/observation/catalog hash、执行配置 hash；将去敏逐调用记录和 oracle 结果存入受控审计目录，再清理 worktree。费用不可观测时使用 null/unknown，不用零代替。加入独立验收 oracle 与预注册配对分析，继续保持 F-PROD=no。

## 6. 性能优化：先降低全量扫描与无界缓冲

以下为源码识别的优化候选，不是已经测出的性能收益。当前基准没有成功完成，不能提供可信吞吐提升百分比。

| 热点 | 证据 | 建议与验证 |
|---|---|---|
| checkpoint 反复读全日志、replay | `src/run/flowchart-run.ts:977–1010,1112–1122` | 基于可靠 sequence/offset 做增量 reducer；恢复时只回放 checkpoint 后缀。先明确单写入者和 CAS，再加缓存 |
| 子任务每个 text/thinking delta 都写一行 | `src/run/child-coordinator.ts:779–811` | 合并进度计数，终态/协议/审批事件仍可靠持久化；测写入次数、队列等待和取消响应 |
| Pi attempt 保存 events[]，另有流队列 | `src/pi-adapter/pi-executor.ts:533–535,592–599` | 为队列加可观测水位和背压；审查 retry 是否需要保留全部已发送事件 |
| 调度并发与执行并发配置不一致 | `src/run/flowchart-run.ts:215,769` | supervisor 默认 maxConcurrentNodes=4，child coordinator 使用默认 maxConcurrentTasks=2；统一配置或清楚区分 leased 与 executing，并测实际同时执行数 |
| 目录校准读取共享调用日志 | `src/routing/cost-calibration.ts:129` | 增量聚合与版本化派生缓存；删除/保留策略必须使缓存失效 |

建议 benchmark 覆盖 1/4/16 children、1k/10k/100k 事件、普通/高频流、恢复与取消；记录 p50/p95、峰值 RSS、I/O 次数、队列深度。Windows/Linux 分别基线，语义必须与原实现等价。

## 7. 维护性、测试、安全与体验

### 模块化：按职责拆分，不按行数机械切碎

当前大文件：`src/cli/main.ts` 2545 行；`src/run/flowchart-run.ts` 2418 行；`src/supervisor/flowchart-supervisor.ts` 1256 行；`src/cli/doctor.ts` 1248 行。

建议新增边界（路径为提议，不是已有文件）：

- `src/cli/run.ts`、`resume.ts`、`inspect.ts`：main 保留 dispatch、顶层错误处理。
- `src/run/flowchart-session.ts`：恢复、日志游标、checkpoint 约束。
- `src/run/flowchart-control.ts`：pause/inject/unblock 控制面。
- `src/run/flowchart-lifecycle.ts`：start/resume/settle 编排。

迁移优先保持公开签名与行为；每次只移动一个职责，用现有集成测试验证。历史审查叙事可迁往 ADR；锁所有权、隐私与故障语义等关键注释应保留在代码附近。

### 学习模型：先统一标签含义

`src/learning/diagnostics.ts:35–40` 对 taskSuccess 的 score 求均值；`src/learning/signals.ts:48–55` 用 90/15 表示通过/失败。当前 meanScore 等于 `0.15 + 0.75 × 成功率`，不是成功率本身；0.45 阈值实际对应成功率低于 40%。

建议明确保留它为启发式 score，或改用二元 outcomeKind 计算通过率；不要静默更换含义。按 project/modelVersion/taskFamily 分组，记录样本数、缺失率和区间；避免项目内不同任务族混合后误判模型质量。

### CI 与测试

`.github/workflows/ci.yml` 的完整 quality 在 Ubuntu/Node 22.19.x；Windows 仅 CLI smoke。本机 Node 24 的失败不能证明 Node 22 一定失败，但说明支持矩阵验证不充分。

建议：

1. Windows 增加 persist、run lifecycle、并发读写针对性测试；Node 22 最低版本与当前支持版本分别覆盖。
2. crash/retention/benchmark 放 nightly 或 release gate；避免所有重任务挤进每次 PR。
3. F6 runner/seal 增加独立 CLI 集成测试。本次在 test/ 未找到两脚本名称的直接测试引用，不排除间接覆盖。
4. 增加 pause→inject→resume→delete 状态序列测试和持久化故障点测试。
5. 覆盖率作为缺口导航，核心 reducer/校验器可增加 mutation testing；不把测试数量当可靠性指标。
6. CI action 固定到审计过的 SHA，增加依赖与密钥扫描；security:probe 不能替代全部供应链检查。

### 成本与安全

- `src/pi-adapter/cost-gate.ts` 是执行级、回合后停止；`src/run/child-coordinator.ts:55–63` 将 run cap 应用于每个 child，不是所有子任务共享总预算。应明确命名，并建立父级 reservation/settlement 账本，覆盖 retry/cascade。
- 无价格时当前披露并解除 cap，而不是硬性拒绝。保留兼容行为的同时，增加严格预算模式：不可计价则拒绝；普通模式标注 best-effort，允许显式选择。
- `src/pi-adapter/file-credential-store.ts:183–185` 跳过 Windows POSIX mode 检查。不能据此说凭据已泄漏，但共享机器/自定义 state root 应验证 ACL，或使用系统凭据存储。
- 接入文件/命令工具前必须定义真实权限边界、出网规则、symlink/路径逃逸检查、环境变量白名单；提示中的 write forbidden 不构成 sandbox。
- artifact、新缓存、实验审计记录都应加入 `src/privacy/record-classes.ts` 的生命周期设计；不能为审计无限保留原始用户数据。

### 文档与 CLI

- README 的 Preview、fake 默认、真实 provider opt-in 说明应继续保留；补充“真实 CLI 当前工具能力”矩阵。
- 固定 JSON 状态入口优先于脚本解析人类文本；F6 runner 应使用结构化结果而非 `Run ...` 正则。
- `inspect` 展示控制请求 pending/applied、实际 executing 数、预算是否 armed、遥测丢失数、验证来源。
- 统一 timeout presets。历史 dogfood 已遇到默认 60 秒不够；按角色提供可解释配置，同时保留总时间/成本约束。
- 历史报告保留时间语义：例如 dogfood 报告曾说 children 不支持 per-task pin，但当前 HEAD 已实现，不应当作当前缺失再次修复。
- graphify 产物记录 sourceCommit/生成时间，代码变动后更新或明确标记 stale。

## 8. 建议实施顺序与退出条件

| 阶段 | 工作 | 退出条件 |
|---|---|---|
| 1：止损 | A1 JSONL、A2 atomic、A4 Windows 定位；阻止 C1 无效候选输出 | 新回归先失败后通过；已有有效数据不丢；无效采集返回可区分失败 |
| 2：控制面一致 | 单写入者控制队列；pause/inject 与 delete 协调 | 并发/故障序列无 checkpoint 倒退、无丢注入；暂停延迟有上界 |
| 3：最小真实闭环 | coding 工具、worktree、artifact、独立 check、总预算 | 在临时仓库完成真实修改并由独立检查验收，失败可恢复 |
| 4：可信实验 | 两臂同 spec/config、冻结目录、原始证据、oracle、配对分析 | 可审计有效 blocks；按预注册区分任务失败与采集失败；通过统计门槛前保持 live R1 off |
| 5：性能和维护 | 增量 replay、流事件合并、职责拆分、文档同步 | benchmark 可重复、行为等价；不以弱化持久化/证据为代价 |

推荐跟踪六项指标：独立验收成功率、每个有效成功任务的可核算成本、恢复成功率、控制请求应用延迟、可评价 block 比例、长日志恢复 p95/RSS。

**核心结论：先让系统可靠地执行、保存和证明结果，再让它更聪明地选模型。**

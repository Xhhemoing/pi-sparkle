# Cloud continuation implementation plan

> 执行者按切片持续实现与测试；有子 Agent 时委派独立调查和实际 diff 评审。先遵守仓库 AGENTS.md，再使用可用的计划执行技能；工具不可用时如实记录并继续能完成的工作。

**Goal:** 完成当前 ADR-009 源码的集成验收，然后交付对话工具入口、跨会话恢复及有界后续开发能力。

**Architecture:** 复用 ConversationSession、ConversationFocus、DevelopmentController、NativeWriteSession、既有 run/event/queue/action 事实与 Pi adapter。新入口负责接线，恢复只保存引用，不建立第二套成功状态、调度器或授权系统。

**Tech stack:** TypeScript / Node.js >=22.19.0 / pnpm 10.17.1 / Pi 0.86.1；命令使用 pwsh。

## Identity

- ID: `TASK-20261020-cloud-continuation`
- Owner: cloud root coordinator；Windows 专属验证由有 Windows 环境的后续执行者承担。
- State: `blocked` at Work 1 dependency bootstrap in the current cloud attempt; [actual verification/blocker](../../reports/2026-10-20-cloud-validation.md). No runtime acceptance follows from the handoff or this attempt.
- Date opened: 2026-10-20（America/Los_Angeles）。
- Design: [ADR-009](../../decisions/0009-lightweight-adaptive-framework.md)、[对话方案](../../conversation-workflow.md)、[迁移清单](../../../tasks/migration-todo.md)。
- Handoff evidence: [交接记录](../../reports/2026-10-20-cloud-handoff.md)。

## Problem and Scope

当前已实现的切片需要最终集成证据；结构化对话宿主尚未成为实际自然语言工具入口，焦点还不能跨会话恢复。用户要求持续开发和测试，并先提交可供云端获取的代码。

### In scope

1. 接收当前源码，完成现有完整门禁、适用探针、实际打包消费者和平台验证；发现真实缺陷后最小修复。
2. 实现对话宿主/扩展工具接线，再实现带来源与失效规则的跨会话恢复。
3. 上述工作验收后，继续诊断到有限修复、任务提升与计划修改；每项先写精确子计划和失败测试，再实现。
4. 有平台与授权条件时，补受管进程资格验证和必要修复。无法验证的 Windows 条件明确交接，继续无依赖的工作。

### Out of scope

不自动合并 main、发布 npm/生产版本、付费调用模型、读取或复制用户凭据、向真实业务系统写入、启用在线学习或宣称 holdout 收益。严格共享预算和 GitHub 远端写入保留为后续独立需求。既有 opt-in crash/benchmark/holdout 脚本保持 opt-in；没有相应授权就记录条件，不以模拟冒充实际实验。

## Global Constraints

- 所有 shell 命令使用 pwsh；脚本首行 `$ErrorActionPreference = 'Stop'`；文件读写显式 `-Encoding UTF8`。原生命令逐项检查 `$LASTEXITCODE`，不让后续成功掩盖失败。云端先确认 pwsh、Node 与固定 pnpm 可用；缺工具是环境问题，不修改产品来绕过。
- 不覆盖、还原、暂存或提交他人的修改；检查实际 HEAD/差异后再工作。临时运行状态与原始日志放 `.agent_workspace/`，可恢复结论进入 docs/reports 和活动任务文件。
- 当前源码包含 task context、SDK、finding analysis、usage coverage、preference tombstones、managed Pi A/B/C/D1/D2、只读 GitHub drafts 和 check archival。先看最新证据，不能根据旧计划中的将来时重复实现。
- 默认不新增 hash、冻结 contract、baseline 或 gate。确需例外时先说明具体失败，以及 Git、版本号、主键、事务、唯一约束、类型、普通测试为何不足；保留已有安全检查。
- 一个候选范围只有一个写者。最多 3 名子 Agent、最多 2 名文件互不冲突的实现者；共享入口、schema、锁、授权和事务协议串行修改。
- 同一候选同时只运行一份完整构建、门禁或打包；会内部构建的 managed integration tests 也算。不要启动后台测试后立即换源码。
- 行为变更先复现 RED，再最小实现、focused GREEN、相邻回归、一次独立实际 diff 评审和适用现有 gate。无新失败/变更/疑点时不反复全库扫描。
- 用户授权持续有效，常规可逆实现不逐步索要许可。遇到缺凭据、平台或授权的独立事项，保存阻塞与解除条件，继续其他可执行切片。自动审批拒绝不得换通道绕过。

## Work 1: 验收现有源码与可携带构建

**Files/symbols:** `package.json`、`scripts/sdk-consumer-probe.mjs`、`test/unit/privacy/adaptation-plane-closure.test.ts`、`test/unit/run/run-lifecycle-lock.test.ts`、`test/unit/track/clarification-lifecycle-lock.test.ts`、相关 managed/binding 测试；记录更新在本计划、活动任务和交接报告中。

**Starting evidence:** 功能源码检查点为 `3d3dcdc5`。前次全量为 3965 pass / 6 fail / 48 skip；修复后相关回归 89/89 及独立复审通过。Windows 第三轮完整门禁在交接准备时尚无退出结果。云端不能访问本地 ignored 日志时写 unavailable，在自己的候选上实际验证；禁止把文档修复或历史局部通过视为完整 gate。

- [ ] 确认交接提交包含 `3d3dcdc5`，记录实际 HEAD、OS、Node、pnpm 和 dirty state；读取 AGENTS.md、tasks/README.md、tasks/plan.md、tasks/todo.md、本计划、迁移清单及相关状态行。
- [ ] 使用固定 pnpm 和现有锁文件安装依赖，运行当前完整 `pnpm gate`；失败保存完整输出、退出码与跳过原因。先处理源码/环境根因，不删断言或宽化 allowlist 来变绿。
- [ ] 对最终构建顺序运行 `pnpm security:probe`、`pnpm pi:probe`、`pnpm kernel-reuse:probe` 及下述 packed consumer。现有 probe 若重建同样必须串行。
- [ ] Linux Node 22.19.0 与 Node24 分别记录真实验证；若环境只有一种，完成可用矩阵单元并把另一项交给可用环境，不能声称全平台通过。不同 Node 的安装/构建目录不得互相污染。
- [ ] 确认包内有 `dist/native/host-attribution.js`，没有已搬走的 `dist/learning/host-attribution.js` / `.d.ts`。需要清理时只处理已确认的生成文件，并在删除前验证绝对目录范围。

以下命令在仓库根目录的 pwsh 执行；先完成完整 gate 及所需 probes，再打包，任一步失败立即停止这组命令：

```powershell
$ErrorActionPreference = 'Stop'
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'dependency installation failed' }
pnpm gate
if ($LASTEXITCODE -ne 0) { throw 'gate failed' }
pnpm security:probe
if ($LASTEXITCODE -ne 0) { throw 'security probe failed' }
pnpm pi:probe
if ($LASTEXITCODE -ne 0) { throw 'Pi probe failed' }
pnpm kernel-reuse:probe
if ($LASTEXITCODE -ne 0) { throw 'kernel probe failed' }
New-Item -ItemType Directory -Path '.agent_workspace/cloud-continuation' -Force | Out-Null
pnpm pack --out .agent_workspace/cloud-continuation/sdk-package.tgz --json
if ($LASTEXITCODE -ne 0) { throw 'pack failed' }
node scripts/sdk-consumer-probe.mjs .agent_workspace/cloud-continuation/sdk-package.tgz
if ($LASTEXITCODE -ne 0) { throw 'packed consumer failed' }
```

**Acceptance:** 当前候选实际完整执行、构建和消费者结果可复查；失败与 skip 有解释；既有 CLI/事件、隐私隔离与运行绑定保护保留。环境验证不足不能转成产品已接受。

## Work 2: 接通日常对话工具

**Files/symbols:** `src/conversation/session.ts` 的 `ConversationSession.handle`、`src/conversation/focus.ts` 的 `ConversationFocus`、`extensions/pi-sparkle/index.ts`；按需在 `src/native/` 增加薄适配器。测试入口为 `test/unit/native/extension.test.ts`、`test/unit/conversation/focus.test.ts`、`test/integration/conversation/session.test.ts`，新增 `test/integration/conversation/extension.test.ts` 覆盖真实注册 handler。

**Interface:** 复用 `ConversationProjectBinding`、`ConversationTaskBinding`、`ConversationRequest`、`ConversationResponse`。宿主提供允许的项目、任务、checker、上下文和 executor；模型只选择既有引用。沿用当前对话模型的工具选择，不为每条消息额外调用分类模型。

- [ ] 先记录适配器工具名、宿主注册/授权入口、关闭链和接口兼容方案。再写 handler 级失败回归，证明接线缺失，而非只 mock 一个新函数。
- [ ] 问答/status 不执行任务且不改主焦点；focus/restore 只换引用；已授权 run-direct 进入现有候选/check 路径。
- [ ] 未知 target、自带路径/checker、伪造授权、重复 requestId、迟到结果、切换焦点后旧结果、取消与 session shutdown 均有负例。应用句柄仍由原宿主入口签发，模型不能通过新入口自动 accept/apply。
- [ ] 独立评审实际 diff 和对应固定接口断言；更新 `docs/conversation-host.md`、`docs/conversation-workflow.md` 与状态行，记录真实可用的调用方法。

**Focused command:** `pnpm test --test-concurrency=1 test/unit/native/extension.test.ts test/unit/conversation/focus.test.ts test/integration/conversation/`；随后按现有工作流执行适用 gate 和 Pi/security probes。

**Acceptance:** 小任务、插问、状态查询、回主线通过实际注册处理器可用；已有宿主权限与验收保护不变；不以免费 loopback 测试声称真实模型理解率。

## Work 3: 跨会话恢复（C3）

**Files/symbols:** `src/conversation/session.ts`、`focus.ts`；新建窄的 `src/conversation/recovery.ts` 与 `test/integration/conversation/recovery.test.ts`，复用现有 run/queue/action 读取器与持久化设施，不复制存储实现。

**Interface:** 恢复输入是宿主选择的项目/任务/run 引用；输出是重新读取的当前事实、来源/失效信息及可恢复焦点，不是执行许可。精确字段、隐私保留/删除规则和不可用引用行为须在开始写代码前记入子计划。

- [ ] 先用实际进程关闭后重开的测试复现恢复能力缺失；覆盖完成任务不重跑、取消/未知效果不释放旧写入责任、重复请求跨重启不得盲重放。
- [ ] 持久化最少事实引用与可失效提示，不存凭据、原始提示或第二套 accepted/completed 状态。新宿主重读 run/queue/action/sourceRevision，再决定展示或拒绝执行。
- [ ] 测试源版本变化、删除/失效证据、引用缺失、损坏存储、跨项目引用、偏好隔离和旧会话迟到结果。不能把会话内 request 去重宣传为跨进程 exactly-once。
- [ ] 与对话工具接线做实际重启集成；独立审查权限、数据归属和兼容，更新使用文档和验证记录。

**Focused command:** `pnpm test --test-concurrency=1 test/unit/conversation/ test/integration/conversation/`；现有 `pnpm gate` 与受影响隐私/删除回归。

**Acceptance:** 新进程可恢复当前任务事实，旧摘要不冒充现状，跨项目不泄漏；无法对账时保留阻塞，查询和无关工作仍可用。

## Work 4: 在已验证基础上持续实现后续切片

Work 2/3 完成后不因完成一个小项就结束；按以下顺序选择满足依赖的下一项。先在仓库写精确子计划（字段/接口、写路径、RED 命令、恢复与验收），随后实现、验证、独立评审、提交。

| 顺序/范围 | 入口与依赖 | 必须验证的行为 |
|---|---|---|
| 受管 driver 集成补测 | `test/integration/pi-adapter/managed-driver.test.ts`、`managed-qualification.test.ts`；复用真实本地 loopback，属于可先做的独立测试切片 | held tool 和异步 agent_end 在整条 driver 中实际停止/结算；取消/迟到输出不重复派发；原引擎绑定恢复正确 |
| 有限诊断修复 | `src/native/write-session.ts`、`src/evaluation/check-finding-analysis.ts`、`src/development/controller.ts`；需要停止/结算责任可证 | 相同证据不反复分析，同候选单写者、有界重试，旧 generation 不生效，修复后原 checker 重验；不能分析一次就自动接受 |
| 任务提升/计划修改（C4） | `src/development/work-item-store.ts`、`work-items.ts`、`src/conversation/`；C3 与现有 claim/依赖就绪逻辑 | 仅修改允许变更的 planned 定义；版本冲突/依赖环拒绝；已开始或已验收事实不重写；accepted 未集成不解锁依赖；不直接改 JSON 绕过 store |
| 平台进程隔离 | `src/execution/command-runner.ts`、`independent-check.ts`、managed driver、`test/integration/development/process-ownership.test.ts` | 先证明当前可用平台的取消/deadline/后代终止；需新 crash 实验时先明确 opt-in 条件。Linux 不能关闭 Windows 条件；未结效果不得接受/重用/盲重放 |

**Public managed execution:** 只有平台 containment 资格和既有授权条件实际满足后才设计公开 selector；加载边界不等于恶意代码沙箱。缺 Windows 环境不阻塞对话、恢复等独立开发。

## Gates and Handoff

- [ ] 每片留下问题、非目标、验收、实际文件/符号、RED/GREEN/适用 gate 命令与退出码、独立评审、剩余风险。
- [ ] 同步 `tasks/plan.md`、`tasks/todo.md`、`tasks/migration-todo.md` 和受影响状态行；历史失败保留，用日期明确更正，不把局部通过写成整体验收。
- [ ] 提交已验证的源码与证据到专用分支；不夹带凭据、原始模型记录或他人修改，不 force-push、不自动合并 main。
- [ ] 最终候选运行一次完整适用验收。已有不变候选的完整通过结果可引用；代码改动、失败修复或新风险才需要重跑相应检查。
- [ ] 只有已完成所有可执行授权工作、出现需要用户/外部改变的实质阻塞或运行时限到达才停止。时限前保存 commit、验收状态、未完步骤和下一条命令，避免只说“可以继续”。

**Rollback/abort:** 保留用户修改、原始失败证据、候选和未结效果；停止有冲突的写入，不关闭安全测试、不清空状态、不通过切换会话/版本绕过占用。

## Closeout

本文件记录后续执行授权与顺序，不是功能验收报告。交接准备的实际命令、提交与远端可达性在[交接记录](../../reports/2026-10-20-cloud-handoff.md)及交付消息中；后续执行者按完成切片更新本节并链接各自验证记录。

2026-10-20 cloud attempt: confirmed `d6a3032a` and underlying source ancestry. Actual Linux Node24 gate exit 1 before tests because dependencies are incomplete. Installation was blocked by automatic approval review for unknown telemetry egress; offline cache is missing a pinned Pi tarball. Node22.19.0 is installed, Windows unavailable, all product probes/pack/consumer checks remain pending. [Current record](../../reports/2026-10-20-cloud-validation.md) states exact failed commands, read-only continuation findings, responsible owner, safe unblock condition and next command. Work 2 has a [precise unimplemented slice plan](2026-10-20-conversation-tools.md); no behavioral code/test completion is claimed.

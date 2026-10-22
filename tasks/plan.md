# Active implementation plan

## Project-agent roadmap (2026-10-22)

- ID / owner / state: `TASK-20261022-project-agent-roadmap`; coordinating agent; **A/B execution authorized; A delivery pending, B read-only preparation**.
- 2026-10-22 owner instruction: “记录你的计划然后开始执行”。此前仅文档限制已被这次 A/B 实施授权替代；先完成 A，再执行 B1–B4，不从路线认可推导 C–F、冻结能力或原始 Soul 的实施授权。下文命令仍须以实际输出标记结果，不能将计划命令当作已执行证据。
- 协作起点：A 的共享工作区和 `native-03` 由另一活动聊天负责，且已有其他聊天运行门禁；本协调者先只读核对 A 结果、准备 B 接口/回归，不抢写 A、不重复派发试验/全量构建。A 交付后从其实际候选创建或复用合适隔离工作区实施 B；共享文档只修改本路线区，原运行证据由下方 `Current work` 维护。
- 产品目标：用户给出成果、验收要求与边界后，在已有授权内持续实施、检查、集成和处理失败；关键产品取舍、范围变化、无法安全恢复、发布及已有强制人工审查边界才请求用户决定。
- 首期范围：单项目、固定里程碑、默认一个连贯编码 worker；独立调查/评审有实际收益时再委派。复用 Pi 和模块化单体，不新增调度器、第二套项目完成状态、hash、冻结 contract、baseline 或 gate。
- [ADR-009](../docs/decisions/0009-lightweight-adaptive-framework.md)、[工作流](../docs/development-workflow.md)与[状态矩阵](../docs/status-matrix.md)继续有效。路线认可不解除 P4/P5、学习/自适应及新实验功能冻结，也不授权原始 Soul 访问/应用、真实数据、安装、发布或 main 合并。A/B 已获开始指令，C–F 实施须另有明确开始指令，并满足相关冻结条件；不得把阶段字母与旧 P 编号混同。

### Reuse and gaps

| 能力 | 复用现有落点 | 本路线补齐什么 |
|---|---|---|
| 连贯编码 | `src/development/start-task.ts`、`src/native/write-session.ts`、Pi executor、候选文件工具 | 统一受信宿主装配与项目阶段衔接；不重写模型内核 |
| 任务与依赖 | `work-item-store.ts`、`controller.ts`、`advance-project.ts`、`batch.ts` | 在单次推进之外串联验收、集成与下一轮；保留原单步/batch 语义 |
| 验证与集成 | `candidate-review.ts`、`trusted-verification.ts`、`NativeApplySession` | 从固定宿主检查定义签发新鲜能力，按已有授权应用；历史 JSON 不授予权限 |
| 状态与恢复 | `ActionLedger`、`ActionStore`、run 事件、候选记录、`conversation/recovery.ts` | 实际效果对账和跨会话可写继续；引用恢复不直接恢复执行权 |
| 项目上下文 | `project/discovery.ts`、`context/task-context.ts`、`context/index.ts`、preferences | 按项目/任务检索目标、决定、失败与下一步，标明来源和失效 |
| 交互与成本 | `conversation/session.ts`、focus、`telemetry/usage-coverage.ts`、run projection | 项目级进展、纠正与停止入口、跨运行用量关联；未知费用不计为零 |

`src/sdk/host.ts` 当前是插件贡献接口，不扩成项目调度器。既有 `apply-registration` 未接收本路线所需的新鲜 descriptor / `onPrepared`，B 优先复用直接 native apply 路径，不扩大冻结公共接口。

### Order and stage acceptance

| 阶段 | 依赖与交付物 | 退出标准 |
|---|---|---|
| A 完成当前交付 | 既有多阶段修复、受限宿主配置和真实任务验证 | 实际依赖阶段完成并集成、最终独立验收、当前候选完整检查和远端绿色 CI；保留失败 |
| B 固定计划连续推进 | A；一个薄的私有宿主推进器 | 三个依赖任务从执行到集成连续完成；授权、取消、陈旧状态和崩溃反例成立；无逐项重复派工 |
| C 安全恢复 | B 的效果记录和停止点；既有 ledger / recovery | 执行中、检查后、应用中、应用后未记账四种中断均不重复效果；可证明安全才继续，未知保持停止；重启不重置额度 |
| D 项目事实与记忆 | 复用上下文和现有权威记录；可在 B/C 稳定接口上独立实施 | 新会话接上目标/决定/下一步；纠正使旧摘要失效，来源可追溯，跨项目不串用，必需事实不被压缩掉 |
| E 目标到受控计划 | B/C/D；自然语言任务草稿与未开始项的受控修订 | 可执行验收和无环依赖；不改在途/已验收定义，不放宽检查制造成功；插问保留主线，任务提升不重跑已有工作 |
| F 整体价值判断 | 从 B 起逐阶段收集，最后汇总不同任务类型 | 独立质量成立，越权/重复效果反例成立；比较人工介入、返工、总耗时与费用覆盖，不能由小样本宣称普遍收益 |

D/E 不引入默认向量服务或在线学习。F 覆盖单文件缺陷、跨模块功能、依赖阶段及中断/纠正场景；不替代未完成的原 15 任务比较。每阶段按证据决定下一步，不等待全部远期功能才使用已有成果。

### Stage A: close existing delivery

**范围与输入。** 直接接续下方 `Current work`，不重做已完成的可选路径、诊断和 Git 批处理修复。当前已登记 `native-03`；不得重跑它或用新样本覆盖旧失败。多 recipe 的 split 提案已被总 40000ms 限额拒绝；有效宿主方案是受限 `--no-run` 准备加原完整单 recipe，而非扩大检查限额。

| 步骤 | 具体动作与涉及文件 | 验收 / 证据 |
|---|---|---|
| A1 读取最终事实 | 只读 `.agent_workspace/multistage-delivery-20261022/soul-split-checks/native-03/result.json`、登记、准备诊断与用量记录；同步现有任务文件 | 结果未落盘时不能判定完成；`command-accepted-awaiting-independent-review` 不等于最终验收。失败/未知保留，停止自动追加试验 |
| A2 验收真实依赖集成 | 原有 `soul-split-checks/run.ts` 与 `verify-host.ts`、`verify.py` 仅作已登记宿主/检查证据；独立审查实际最终差异 | 三阶段按当前 source revision 衔接；受保护文件不变；原 reading/外部验收/候选回归/16 行测量/格式要求全部成立；原 Soul 不访问或应用 |
| A3 核对最终候选 | `src/development/controller.ts`、`recipe-check.ts`；`src/execution/{exact-snapshot,trusted-verification,worktree-snapshot}.ts`；`src/native/apply.ts` 及对应现有测试 | 执行下面 A-focused；若新失败，由 A 负责者先复现再做已授权范围内的最小修复；独立评审覆盖授权、保护路径与未知效果 |
| A4 关闭交付 | 现有任务文件、生成 STATUS、PR 与 CI；不新增报告 | 串行执行 delivery checks；记录实际失败/跳过；远端分支和同一候选绿色 CI 齐备，不合并 main，不将局部观测当普遍收益 |

**执行检查点（2026-10-22，只读实证）。** `native-03/result.json` 已落盘：总耗时 949.194s、`failed`，未到期限，`cleanupUnsettled=false`。第一、二阶段分别通过重新验证并应用到隔离 source（`ea75126b → adbc0238 → 1a2acf24`）；独立只读核对 source 的 HEAD/ref 与 queue：前两项 accepted，第三项 blocked。第三阶段 request 24 返回上游 502，未形成最终验收或应用；`independentFinalPatchReview=not-run`。23/24 次请求有完整用量，已知参考小计 USD 0.2534164，完整总费用及实际 relay 费用未知；这个比例是请求覆盖率，不是费用覆盖率。原始 Soul 未应用。A 尚未通过，B 实施依赖未满足。

A 负责聊天已开始准备第三阶段恢复脚本并在独立工作区运行门禁；这是当前工作状态，不是恢复成功或绿色 CI。保留 `native-03` 失败、既有候选与记录，不由本协调者重复运行、重置或推导新臂授权；后续恢复以 A 负责者单独登记和实际结果为准。A 的 gate/PR/CI 与完整任务验收分别核对。

**A 结果读取（只读；不能用历史启动命令代替）。** 所有命令在仓库根目录用 `pwsh` 执行。保留路径内已有资料，不删除/迁移旧样本。

```powershell
$ErrorActionPreference = 'Stop'
$trialRoot = '.agent_workspace/multistage-delivery-20261022/soul-split-checks'
$resultPath = Join-Path $trialRoot 'native-03/result.json'
if (Test-Path -LiteralPath $resultPath) {
    $result = Get-Content -LiteralPath $resultPath -Encoding UTF8 -Raw | ConvertFrom-Json
    $result | Select-Object status, elapsedMs, cleanupUnsettled, failure, independentFinalPatchReview
} else {
    Write-Output 'No final result recorded; do not infer completion or restart the arm.'
}
```

**历史入口，禁止本轮执行/重复启动。** `pnpm exec tsx .agent_workspace/multistage-delivery-20261022/soul-split-checks/diagnose-prepared.ts --diagnose` 与同目录 `run.ts --preflight` 都会做准备/写文件，虽无模型调用也不是只读命令；`run.ts --run` 会启动真实模型且固定 `native-03`，只对应已有登记。失败后的新臂必须有新的明确决定与独立登记。

**A-focused（未来执行，非本轮结果）。** 精确 Git/快照、真实 controller、recipe 和 native/source 集成一起核对，保留平台跳过。

```powershell
$ErrorActionPreference = 'Stop'
pnpm test -- --test-concurrency=1 test/unit/execution/exact-snapshot.test.ts test/unit/execution/trusted-verification.test.ts test/unit/execution/worktree-snapshot.test.ts test/unit/execution/exact-git-tree.test.ts test/integration/development/controller.test.ts test/integration/development/recipe-limits.test.ts test/integration/development/source-integration.test.ts test/integration/native/trusted-apply.test.ts
if ($LASTEXITCODE -ne 0) { throw 'A-focused failed; preserve results before further work.' }
```

### Stage B: continuous milestone delivery

**范围。** B 已获实施指令，满足 A 验收依赖并核对冻结边界后开始，无需重复请求普通实施许可。输入是宿主已确定的固定队列与有限里程碑；只支持当前存活宿主中的串行连续推进。自然语言建计划、后台定时、跨进程自动继续、自动冲突解决、学习及公共 SDK/CLI 扩展不在 B。

**文件与接口选择。** 拟新增私有 `src/development/project-host.ts`，入口暂定 `runProjectMilestone`；输入复用 controller、固定工作项 ID、受信检查定义、宿主授权判断、取消信号和累计限制，输出只组合现有 queue/action/run/Git 事实。另在 `controller.ts` 增加最小私有宿主接缝；公共返回值、CLI/event/JSON 保持兼容。这是待实施的内部接口，不是现有 API。拟新增 `test/integration/development/project-host.test.ts` 和 `project-host-interruption.test.ts`；优先复用 `source-integration.test.ts` 的真实 Git/命令模式，只有实际重复时才提取私有 fixture。`advanceProject` 和 `batch` 原行为不变；`src/sdk/host.ts`、冻结事件/JSON 不改。

| 步骤 | 先建立的失败用例与实现步骤 | 文件 / 依赖 / 完成断言 |
|---|---|---|
| B1 里程碑与授权 | RED：陌生工作项、越界路径、撤销、零/非法额度、重复调用不能进入执行。实现宿主边界：仓库/分支、固定工作项和定义版本、允许动作、停止条件、总时间/总尝试/任务数；每个受控动作准入前核对适用授权；撤销同时触发取消信号，在途动作等待真实结算。来源字符串不签发权限 | 新 `project-host.ts` 与主测试；复用 store 定义/claim、AbortSignal。不另存任务成功状态；定义变动停止。测试全绿但要求人工冲突审查时仍不得自动应用 |
| B2 推进、验收、集成 | RED：三个依赖任务不能只停在首个 ready；accepted 未集成不得启动后继。串联单步推进、受信宿主审查决定、`controller.accept()`、新鲜 descriptor 和 `NativeApplySession.apply()`，然后重新读取源码与依赖。`no-ready-task` 单独出现不能报里程碑完成 | 新 host；复用 `candidate-review.ts`、`loop-artifact.ts`、`trusted-verification.ts`、`native/apply.ts`。保留同一进程中真实、已结算的 `NativeWriteSessionResult`；artifact 只补充历史事实，不能重建运行权限。检查/授权只来自固定宿主定义。完成须所有指定项已集成且最终源验收通过 |
| B3 停止、并发与最小崩溃安全 | RED：并发继续、取消、外部改源、改检查器、应用中断均不造成重复/陈旧效果。使用既有 ledger 的 `admit` 原子准入 `candidate-apply`，在 `onPrepared` 中 checkpoint 精确目标，成功记实际结果，未知保留责任；只有等待真实结算后才释放。总额度覆盖 worker、检查、集成和准备，不按子任务重新计满 | 新 host / interruption 测试；复用 `action-ledger.ts`、`action-store.ts`、apply 的 `onPrepared`。原队列再次打开时先核对既有工作/效果；B 不自动续跑历史队列以获得新额度，重启进入只读对账，便利恢复归 C。取消是停止准入与请求终止，不承诺清理尾部绝不超时 |
| B4 进展、成本与整体结果 | RED：待审/接受/集成混淆、未结费用显示零、子调用重复累计、无就绪项误报完成。组合现有状态与用量，逐阶段呈现完成项、阻塞、下一动作、累计时间/尝试、已知费用及缺口；最终调用固定宿主的里程碑验收 | 新 host / 主测试；复用 `telemetry/usage-coverage.ts`、run projection、真实源检查。累计仅是事实投影；不引入严格美元准入保证。登记人工介入原因、返工和费用覆盖，不只报成功耗时 |

**B 最小接入位置（当前源码静态核对，未实现）。** 主线程串行拥有 `project-host.ts`、`controller.ts` 及对应新测试；A 完成后先从其实际候选隔离，不能覆盖共享工作区修改。

1. 宿主入口先授权固定里程碑及其必要的就绪/依赖检查，再调用 controller；这些检查可能先于 claim。实际任务授权放在 `claimNext` 返回后、候选写入/factory/worker 工具之前，核对实际领取的定义，而非可能被并发改变的 advisory。撤销须同时触发传入取消信号；拒绝进入既有 fenced cleanup，不自动释放未知责任。
2. 累计额度定义为 **worker 执行准入次数**，在 guarded executor 的 `execute` 入口检查外层/子执行取消信号、持久预留，再检查信号并委托。factory 每次 repair attempt 都可能调用，但抛错或返回后取消时未必调用 worker；factory 次数不能冒充 worker 次数，更不能冒充模型请求次数。已预留后取消不自动退还未知额度；checkpoint 与最终收据须保留累计预留。时间额度包含宿主准备/检查/集成，次数额度不承诺控制可信 factory 自身操作、Pi 内部请求/重试或美元费用。
3. `session.execute` 返回并 `shutdown` 完成后，排除 `effectsSettled:false`；仅在原结果 `ledger.complete` 成功后向私有宿主同步传递原始对象。捕获失败保留 completed 收据并进入对账；宿主仍必须核对 `runNext` 最终状态及 queue，不能因捕获结果而自动 accept/apply。
4. `candidate-apply` 准入复用 `ledger.admit` 的原子冲突判断，`onPrepared` 先持久目标，再允许 source 变化。当前 `unresolvedEffect` 只识别 write/check；B 须以 RED 证明同项目 apply 在途/未知时不能有重叠新效果，并补齐最小检查。ledger 实际位于 `dirname(queuePath)/actions`，不是 stateRoot。B 的受信宿主配置必须固定物理 source → queuePath/ledger 的唯一绑定，入口拒绝与该绑定不符的目录/路径别名；同一绑定下复用既有 ledger 准入。不同且独立授权的宿主配置、外部 Git 不属于该互斥保证，仍依赖源码漂移拒绝，不能宣称全机器互斥。

优先 RED：advisory 与实际 claim 不同且后者未授权；factory 失败/取消不计为真实执行；两次修复耗尽共享额度后第三次底层 execute 为零；持久预留失败或预留后取消不能派发；complete 失败不发布 settled result；捕获失败不重放；unknown settlement 不传递可应用结果；两宿主对同一 source 的 apply 与后继派发不能重叠；同一受信项目绑定下改用不同 queue 目录或路径别名必须在任何检查/claim/worker 前拒绝，不能只测试同 queue。上述为将实施的断言，尚无行为通过证据。

**B 的关键反例。** 在 checkout 后/ref 更新前，以及 ref 更新后/账本完成前中断；核对源码树、HEAD、旧 worker 和记录，不能把 apply 当原子事务。未经明确 opt-in 不运行真实 crash 演练；普通测试先覆盖受控失败边界，未来 crash 验证在一次性仓库中独立登记。A 验收后用户改源/检查器/配置，或撤销自动 apply，应停止并重新判断，不清理用户改动、不继承旧 PASS。合并冲突仍保留人工 conflict-hunk 审查。

**B 的红绿与评审顺序。** B1 → B2 → B3 → B4；各步先运行对应失败用例并确认失败原因，再做最小实现、重跑相关套件、审查差异。共享 host/ledger/apply 路径串行写入，最多一个写者；独立只读评审覆盖授权和效果边界。B3 的最小安全要求与 B2 一起满足后才允许真实连续应用，不能先发布“成功路径”再补安全。

**B-focused（未来新增测试文件后执行；当前不存在不是已通过）。** 三阶段真实 Git/命令但脚本 worker 的测试证明机制；真实模型验证另外记录，不能互相替代。

```powershell
$ErrorActionPreference = 'Stop'
pnpm test -- --test-concurrency=1 test/integration/development/project-host.test.ts test/integration/development/project-host-interruption.test.ts test/integration/development/source-integration.test.ts test/integration/development/advance-project.test.ts test/integration/development/batch.test.ts test/integration/development/controller-admission.test.ts test/integration/development/controller-cancellation.test.ts test/integration/native/trusted-apply.test.ts test/unit/development/action-ledger.test.ts test/unit/development/action-admission.test.ts test/unit/telemetry/usage-coverage.test.ts
if ($LASTEXITCODE -ne 0) { throw 'B-focused failed; do not advance the candidate.' }
```

**B 的真实任务验收。** B1–B4 普通检查和独立评审后，再明确登记固定计划、隔离输入、运行预算、模型、验收、重试与费用覆盖；适配 A 的私有宿主以调用新入口，不重用旧 `native-03` 启动目录。本轮不编造尚不存在的模型脚本命令；未来修改现有 `.agent_workspace/` 宿主时，必须先把其精确启动/读取命令登记回此节，再获得适用执行授权。通过标准为三个依赖阶段和最终源验收完成、正常路径没有逐项派工/重复确认、所有失败和人工介入如实记录。框架代码质量、机制测试和真实任务收益分别报告。

### Delivery checks and handoff

以下沿用现有检查，不新增 gate。实施阶段由主线程串行运行；已有同一候选的完整有效结果不机械重复，代码变化或失败修复后才重跑受影响检查。跨模块/授权/数据正确性改动须独立评审；真实 provider/crash/benchmark 仍是单独 opt-in。

```powershell
$ErrorActionPreference = 'Stop'
pnpm gate
if ($LASTEXITCODE -ne 0) { throw 'gate failed' }
pnpm security:probe
if ($LASTEXITCODE -ne 0) { throw 'security probe failed' }
pnpm pi:probe
if ($LASTEXITCODE -ne 0) { throw 'Pi probe failed' }
pnpm kernel-reuse:probe
if ($LASTEXITCODE -ne 0) { throw 'kernel reuse probe failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'diff check failed' }
```

门禁通过不推导远端 CI、人类审查、实验采纳或生产就绪。A/B 的结果留在本计划与现有 PR 验证描述，详细日志放 CI 或 `.agent_workspace/`，不增加逐切片报告。todo 仅保留未完成工作并限 25 行；STATUS 只用生成器更新。失败时保留 candidate/action/日志，停止受影响新动作，不重置或删除证据；独立安全工作可继续。

此前文档阶段仅执行 `pnpm status`、`pnpm workflow:check`、`git diff --check` 和路径/命令静态核对，未运行 A/B 或 delivery checks，未暂存/提交/发布已有代码改动。现已收到开始指令；近期执行顺序为核对 A 的真实最终结果与交付 → 隔离 B 工作区 → B1–B4 红绿与独立评审 → 适用 gate/受限任务验收与交付。A 未就绪前不抢先实施 B，未知效果不重放。

此前文档核对（2026-10-22）：`pnpm status`、`pnpm workflow:check`（10 files / 16 headings）、`git diff --check` 均退出 0；四个 PowerShell 块静态解析通过，17 个测试路径中 15 个现有文件有效、2 个明确标为未来新增，任务链接有效，todo 16 行。独立只读文档评审未发现具体缺陷。未执行实现测试、完整 gate、模型或 crash 试验；这些结果不代表 A/B 已实现、验收或发布。

本次继续核验：独立读取 native-03 结果、实际 source HEAD/ref 与 queue；B 静态评审发现并修正了 ledger 实际根目录及 claim 前检查授权时序两处方案问题。修正后 `pnpm workflow:check` 与 `git diff --check` 均退出 0，todo 16 行。本线程未运行实现测试、完整 gate 或模型，也未提交/发布当前共享改动；A 的恢复与交付由下方记录接续。

## Current work: multi-stage delivery repair and end-to-end verification (2026-10-22)

- ID/owner/state: `TASK-20261022-multistage-delivery`; coordinating agent; in progress; final verification/publication isolated on `codex/multistage-delivery-verified-20261022` to preserve concurrent roadmap/model-routing edits in the original checkout.
- Authority: the owner explicitly requested status reconciliation, removal of multi-stage blockers and end-to-end verification. This supersedes the earlier stop-retry instruction only for bounded repair/validation. P4/P5, learning/adaptation, new orchestration and the broader 15-task evaluation remain frozen/incomplete. No original Soul access/application, real data, release or main merge.
- Fresh starting state: clean `main` at `9f883e4100bef61782e3aaab54bfebf8f541eb3a`; #65/#66/#69 merged, #67 open. Starting-main [CI](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39757666467) and [recovery regression](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39757666477) passed. Later historical sections retain their then-current state; no experiment adoption follows from a merge.
- Scope: optional writable snapshot paths, bounded recipe diagnostics, exact Git verification process amplification, corresponding tests and current status/navigation. No new runtime hash, baseline, gate, public CLI/event/JSON schema, provider retry or fallback.

### Acceptance and current evidence

- [x] Reconcile actual merge/CI status in the existing plan/navigation/status guides; workflow check passes and STATUS is generated.
- [x] Optional-scope RED reproduced the missing-prefix refusal. Required protected paths stay mandatory; optional paths include future files in before/after checks. Controller, descriptor, fingerprint and native whole-apply boundaries preserve mutation/link/partial-scope refusals. Exact/trusted units and 9 real controller/native/source cases passed; final Git suite 29 pass / 0 fail / 2 platform skips, then 4 updated source/native cases passed without skips.
- [x] Recipe-tail RED failed specifically on missing final diagnostics; all 8 recipe tests passed with bounded head/tail excerpts.
- [x] Real two-stage Git integration completed accept/apply/final source checks, including stale-sibling refusal. Per-path Git process amplification RED reproduced and bounded native batching passed binary/framing/type/size, cross-batch and four-view attribute negatives. A 12-file probe changed comparison from 39 processes/10.374s to 5/1.458s and attributes from 78/18.852s to 11/2.902s. The same two-stage test observed 317.537s before and 179.020s after; these local observations do not establish general speedup.
- [x] Register fixed isolated-input, model, scope, budget and acceptance before model execution; retain failures and missing usage separately. Independent read-only runtime and final private-host reviews found no remaining concrete defect.
- [x] Complete the real Soul three-stage functional chain with explicit disposable-source integration and final command/source review. Stages 1/2 passed in `native-03`; after its upstream 502, separately registered stage-3 continuation passed. This is operator-assisted completion, not an uninterrupted successful three-stage arm.
- [ ] Complete serialized `pnpm gate` and final workflow/diff checks. Build, security 26, Pi 4 and kernel-reuse 3 probes already passed on this runtime candidate.
- [ ] Publish a scoped branch/PR with exact commands, failures/skips and current green hosted CI. Publication, tests and human/experimental adoption remain distinct.

### Registered real execution and retained failures

Use only retained isolated input `ea75126bf5e860b812f9e75cba9a290ab81fc8ac`; old trial directories remain read-only. The task is the existing people-view observer, semantic/error regressions and 16 interleaved synthetic measurements, with the exact four allowed source/test files and all other input bytes protected. Provider/model/thinking/output are existing `mine/gpt-6.1-sol/high`, 8192. Each stage has one attempt; provider retries/fallback are disabled. Worker 600s and whole-arm 1800s include actual model calls, tools, compilation preparation, checks and host accept/apply. This is native-only delivery validation, not a new A/B or superiority claim.

| Recorded execution | Actual outcome and boundary |
|---|---|
| Original zero-model diagnosis | Cold Cargo exceeded verifier budget; separate shared compilation passed in 134.938s and warm stage1 passed in 12.506s. Failure and reconciliation observations retained. |
| `native-01` | Failed after 133.996s: request 9 reported Connection error with missing usage after 8 metered requests. No candidate accepted/applied; incomplete total cost. |
| `native-02` | One explicitly registered host restart; stopped after 128.648s. All 10 request usages reported, reference subtotal USD 0.1234904. Changed-source compilation took 28.718s, next command exceeded remaining 4.333s; host unavailable/cleanupUnknown stopped successors. No source application. |
| New-directory cold diagnosis | Failed after 37.553s; copied cache did not avoid relocation compilation. Separate shared no-run compilation then passed in 41.588s. No model calls. |
| Proposed split-recipe aggregate | Real queue rejected combined recipe timeout above 40000ms. The proposal was discarded; failure retained, no model calls or widened runtime limits. |
| Corrected host diagnostics | Explicit bounded no-run preparation followed by the original complete single recipe. Stage1 controller/apply passed in 13.452s/14.972s; complete stage3 controller/apply in 53.070s/27.657s, including preparation. Default independent-check 60s and recipe 40s remain. Four paths and SDK preflight passed with zero model calls. |
| `native-03` | Failed after 949.194s: stages 1 and 2 were independently checked, accepted and applied to the disposable source; stage 3 request 24 returned upstream 502. Usage 23/24, known reference subtotal USD 0.2534164; total unknown. No cleanup uncertainty or deadline expiry. |
| `native-04-stage3` | Operator-assisted stage-3 continuation from actually applied stage2 revision; passed in 593.844s, 16/16 metered requests, reference worker USD 0.1646272. Controller accepted and reverified apply to disposable revision `c3d11bd78c884a87352b4f02c9df0190b89b1cf9`; final applied-source check passed in 18.780s: original reading 4/4, external behavior 7/7, candidate regressions 9/9, ignored scale test 1/1 with all 16 rows, protection and format. No timeout/cleanup uncertainty. Independent stage2/stage3 source reviews found no concrete defect; applied stage3 bytes match the reviewed candidate. |

The corrected private host prepares matching test executables before worker tests and before releasing a successful worker result. This uses protected-source checks and Cargo `--no-run`, limited to 120s and the remaining worker/arm budgets with actual child/arm cancellation. It confers no acceptance: all original reading tests, external acceptance, candidate regressions, 16 measurement rows and format checks still execute under the unchanged 36s Python / 38s wrapper / 40s recipe. Terminal events are held until preparation settles; unknown cleanup notifies native ownership, retains evidence and aborts successors. No runtime/check budget or schema was changed for the private host.

All failed arms/diagnostics/candidates remain under `.agent_workspace/multistage-delivery-20261022/`. Scope-specific process observations found no matching remaining compiler/linker or trial processes after setup failures; they do not prove OS containment or rewrite old failed ledgers. Setup-only reconciliation explicitly names unchanged prior markers and predates the new arm; new/changed/late markers still block (actual zero-model negative checks passed). No private Soul source, transcripts or credentials are committed/uploaded. Actual relay charge and total preparation/coordinator/reviewer effort remain unknown; no missing usage is treated as zero cost.

### Current next action

Complete the serialized full gate, then scoped publication and current hosted CI. The first local gate bootstrap exited with Windows process status -1073740791 before any gate step output; preserve that log. A second invocation has passed workflow/typecheck/lint and is executing all tests. The gate uses a separate worktree/two-CPU affinity; the successful continuation used separate CPU affinity and Cargo target. Its elapsed time reflects concurrent local load and is not a performance comparison. Final PR verification carries exact commands and detailed CI artifacts; do not add per-slice reports, receipt-only commits or expand frozen work.

## Current result: single-task execution parity (2026-10-22)

Delivery: [PR #69](https://github.com/Xhhemoing/pi-sparkle/pull/69). Owner: coordinating agent. Two execution defects are fixed and the registered four-run Soul test-copy comparison is complete. The observed successful candidates have similar cost and quality; this does not prove a general advantage. Original Soul was not accessed or changed during this follow-up. Work is based on reviewed but unmerged #66 (`95c7970c`); #65/#66/#67 remain separate owner decisions. Keep P4/P5, controller expansion and adaptation/learning frozen.

### Bounded fixes and reusable configuration

- Child prompts advertised seven logical profile tools that did not match the five actual native file tools or host-added test/format/report tools. Replace that misleading list with guidance to use the actual callable schemas. Role/write restrictions and actual tool/path enforcement remain intact; `allowedToolNames` had no runtime authorization consumer.
- An explicit host wall budget was silently capped by a fixed 300s child deadline. Pass the synchronously captured, validated explicit budget to the worker; keep the 300s worker default when omitted, including attempts-only opt-in. The existing overall timer covers setup/all attempts/verification and never renews. No new executor, gate, retry policy or schema.
- Pi core does not automatically load the Coding SDK system prompt. The measured native host now obtains the public SDK `session.systemPrompt` for the same candidate/tools/resource-loader settings and passes it through the existing executor option, disposing the preparation session without a model call. [Integration instructions](../docs/direct-development-task.md) make this configuration reusable; it is not a new automatic runtime default. Keep one coherent task in one Pi worker, existing `stopAfterTaskResult: true`, and independent final acceptance.
- Changed runtime/test files: `src/run/child-prompt.ts`, `src/native/write-session.ts`, prompt unit tests and real `startDevelopmentTask` integration tests. Focused RED was 11 pass/4 expected failures; GREEN with native repair/cancellation coverage was 26 pass/1 existing Windows signal skip. Typecheck, lint and independent runtime review passed. Explicit larger/smaller limits, default, invalid limits and caller mutation are covered. The 300s model trial does not measure the larger-budget fix's benefit.

### Registered comparison and actual outcome

Input `6e7f620d` is a disposable snapshot from the earlier approved numeric test copy, with stale trial context corrected. Real task: fix `age_days` and `civil_from_epoch_day` at public i64 boundaries, preserving signatures/const/ordinary behavior. Only `crates/soul-algo-tie/src/types.rs` was writable. The host compiles the real crate; seven external mathematical/calendar tests, real crate unit tests, rustfmt and 223 protected-file byte comparisons determine final quality. No original Soul apply, commits or publication.

Order registered before calls: direct/native/native/direct; one attempt per lane, no favorable reruns. Same mine/gpt-6.1-sol/high, 8192 output, 300s whole-arm deadline, file/test/format tools, no provider retry/fallback and fixed compiler/proxy configuration. Both use SDK-generated coding instructions, identical after normalizing candidate cwd. Native retains a 262-character grounding addition and its structured report/host acceptance protocol, so this is not a single-variable ablation. No DevelopmentController or task slicing. Whole-arm time includes per-arm setup and final acceptance; shared harness preparation and independent review are outside it.

| Lane / path | Whole-arm time | Reference worker USD | Request usage | Outcome |
|---|---:|---:|---:|---|
| 01 / direct Pi | 20.695s | Unknown | 0/1 | First request timed out after 11.429s; no writes; unchanged boundary bugs fail acceptance |
| 02 / pi-sparkle | 133.993s | 0.0896500 | 11/11 | External 7/7, crate 63/63, format/protection and independent source review passed |
| 03 / pi-sparkle | 200.747s | 0.1030024 | 11/11 | External 7/7, crate 64/64, format/protection and independent source review passed |
| 04 / direct Pi | 178.857s | 0.0954708 | 9/9 | External 7/7, crate 63/63, format/protection and independent source review passed |

All four had zero new human inputs/corrective operator interventions inside the arm clock. No later code repair or source application; all cleanup/meter promises settled. Reference monetary cost uses the previously registered USD/million rates: uncached input 2, cache read 0.10, output 10; reasoning already included in output is not counted twice. Actual relay billing and coordinator/reviewer usage remain unknown. Lane 01's known subtotal of zero is not a zero-cost request. Shared preparation includes a 9.570s expected-RED check and an 8.280s native zero-model check, but total harness/coordination effort was not fully metered.

Successful native mean is 167.370s/$0.0963262 (n=2), versus 178.857s/$0.0954708 for the sole successful direct run: observed time -6.4%, reference cost +0.9%, all successful implementations independently accepted. Retain the failed direct run separately; these tiny, known-task samples and availability failure do not establish accuracy, reliability or superiority. No evidence here supports replacing the core agent or adding more orchestration.

### What explains the result, and what remains unknown

- The two successful native runs differ by 66.754s despite the same prompt and request count. Model request intervals account for 46.148s of that difference, worker checks 10.450s, format 0.671s, final checker 4.832s and the rest 4.653s. Generation/upstream waiting and host variation cannot be separated further from these logs; raw token totals do not measure economic cost or framework overhead.
- Request-to-tool records show native report generation replaces the direct final prose request; neither native arm made another model request after its report. Native report turns cost $0.0070464/$0.0097916 versus direct final prose $0.0096184. Native extra requests were model-selected reads/patches, not another forced completion round. Their redundancy is unproven; do not remove independent acceptance to manufacture savings.
- Lane 01 is an availability observation, not a coding failure. Installed SDK provider timeouts differ (direct 300s, native default 600s), but both exceed the 11.429s failure; each arm also has the same 300s outer deadline. The normalized provider error loses its underlying cause. No attribution to connection, relay or framework is established, and parameters were not changed during the series.
- This follow-up also changes runtime version, coding prompt/role context, stale input instructions, checker environment, format availability, final-check timing and request metering relative to old numeric trials. Old direct required later format repair; old native failed and required host takeover with missing usage. Those results cannot estimate the causal effect of an individual fix or a speedup. The tool/budget defects are deterministic regressions; the prompt configuration's benefit remains a plausible, non-isolated contributor.
- Conclusion: preserve Pi's coherent coding context and remove contradictory guidance/hidden limits; use pi-sparkle for scoped delegation and independent acceptance. The observed single-task gap is no longer present in these successful samples, but general benefit and end-to-end project economics remain unproven. Do not expand runtime on this evidence.

### Verification and handoff

Raw protocol, measured runtime patch, failed/successful requests, candidates, checks, cost analysis and timeout diagnosis remain in `.agent_workspace/single-task-parity/`; no private Soul source or transcripts are published. Commands: focused prompt/start-task/write-loop tests, typecheck/lint/build, security/Pi probes, `pnpm exec tsx .agent_workspace/single-task-parity/run.ts 01|02|03|04`, `pnpm status`, `pnpm workflow:check`. Independent review covered runtime/harness and all three changed candidates; original source stayed outside the trial.

The local serialized full test run was deliberately cancelled after 317 pass records/no observed failures so it would not displace the actual experiment; it is not a passing gate. Current-branch hosted CI must complete the full workflow/typecheck/lint/test/build and probe stages before delivery. Publication/CI details belong in the PR; no merge is authorized by this experiment. Next owner decision: review this bounded fix and #65/#66/#67, then choose later independent task types only if the broader evaluation is worth its cost. The 15-task evaluation and successful dependent-task integration remain unfinished.

## Previous large-task result: benefit remains unproven (2026-10-22)

Owner: coordinating agent. The requested summary and real large-task trial are complete as an experiment, including retained failures; the pi-sparkle three-stage workflow did not complete. Direct Pi produced a reviewed, tested candidate in an isolated Soul copy. No candidate was applied to original Soul. Runtime revision `95c7970c` was tested from open [PR #66](https://github.com/Xhhemoing/pi-sparkle/pull/66); PR #67 records those results without merging #65/#66 or extending runtime behavior. Keep P4/P5/adaptation/learning frozen and the broader 15-task evaluation explicitly unfinished.

### Results worth retaining from earlier work

- Integration/document cleanup is delivered: #61/#62 merged, #60 superseded, main protected. [#63](https://github.com/Xhhemoing/pi-sparkle/pull/63) removed 352 repetitive reports (271,929 lines) while retaining unresolved obligations. #64 is merged. Active plans/checklists and PR/CI evidence replace per-slice reports; the package remains private.
- Independent quality checks change the conclusion. In [#64](https://github.com/Xhhemoing/pi-sparkle/pull/64), both helper candidates passed functional tests, but the second direct candidate regressed kill-error/successful-reap cleanup. In [#65](https://github.com/Xhhemoing/pi-sparkle/pull/65), external numeric cases exposed three failures despite 60 original tests passing; archive cases needed independent input coverage. Host takeover, later formatting and missing usage remain separate from initial completion. The older helper defect remains unresolved before adoption.
- One bounded short-task optimization is implemented in #66: finish the valid report's whole tool/usage turn, then omit redundant final prose; accepted steering disables early completion. Four native archive runs passed 12 tests/eight input classes. Mean time changed 78.852s to 68.431s and reference worker USD 0.0640446 to 0.0480176. The omitted final request accounts for about 6.2% of original cost; the observed 25% total difference also contains generation/cache variation and unblinded path labels. This is one known task, not a general accuracy or savings estimate.
- #66's final current-head Ubuntu/Windows and quality CI passed (4,075 pass / 0 fail / 2 skip): [CI run](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39730904500). Earlier local timing failures and the corrected instrumentation-seam CI failure remain recorded. #65/#66 are open; implementation, publication, CI and owner adoption are different states.
- Meter actual requests, including errors, instead of treating invocation summaries or SDK zero rates as bills. Missing usage is unknown cost; reasoning already included in output must not be counted twice. Previous trials primarily tested single candidates, not verified dependent-task integration.

### Real task and comparison registered before execution

Use Soul's existing people-view cost-attribution backlog: add a shared-path optional phase observer, semantic/error regressions, and 16 controlled interleaved measurements (100/1000 peers × unique/shared × four trials). This diagnoses current execution; it does not optimize SQL/cache/scoring or promise a speedup. Only graph implementation, optional graph helper, diagnostics tests and existing scale probe were writable. Original tests/support and all other input files were protected.

Input `ea75126b` contains current selected Soul Rust source, including relevant uncommitted files, plus curated synthetic fixtures. Original Soul was read/copied only. Both configurations received the same objective, fixed three-stage plan, restricted file/test/format tools and mine/gpt-6.1-sol/high with 8192 output limit. Direct Pi used one session; pi-sparkle used DevelopmentController with dependent workers and the explicit short completion option. This compares fixed workflow configurations, not autonomous decomposition.

One original pair: order randomized once to native then direct, neutral lane paths, serial model/build execution, one attempt per stage, no provider retry/fallback. Whole-arm budget 1,200s includes setup/tools/checks/integration; native additionally has an existing 300s limit per worker. Existing recipe limit stayed 40s (checker 36s); final host verification could use remaining time up to 900s. Preparation and independent review are outside arm clocks; no end-to-end project-cost claim.

### Observed outcomes

| Run | Whole-arm time | Reference worker USD | Request usage coverage | Actual outcome |
|---|---:|---:|---:|---|
| Original native / lane-01 | 157.591s | 0.1314344 | 11/11 | Stage-1 code passed worker-invoked tests, then controller snapshot precheck blocked; stages 2/3 and integration never ran |
| Original direct / lane-02 | 356.681s | 0.2648348 | 21/21 | Complete task passed final commands and independent source review |
| Separate native supplement / lane-03 | 309.919s | at least 0.0549348 | 3/4 | Stage-1 300s deadline cancelled a long request; no writes or tests; complete cost unknown |

All three runs required zero new human inputs and zero corrective operator actions during their measured clocks; no host accept/apply transition occurred. This excludes substantial experiment preparation and one explicitly separate host-configuration correction before the supplement. Worker self-correction/rechecking is not human intervention. None of the native failure durations or lower costs is an efficiency win.

Reference USD uses the registered [model reference rates](https://developers.openai.com/api/docs/models/gpt-6.1-sol): uncached input 2, cache read 0.10, output 10 per million. Actual relay billing is unknown. Every one of the 32 original-pair requests was independently recalculated; all had usage. The supplement's fourth request ran 279.270s before cancellation and returned missing usage, not a free call. Coverage is a fraction of requests, not a known fraction of cost. Coordinator/reviewer usage is unavailable, not zero.

### Final quality and useful findings

- Direct final acceptance: four protected reading tests, seven host behavior tests, eight candidate regressions and one scale test (20 distinct test entries), all 16 measurement rows and formatting passed. Independent source review found no blocking defect. Ordinary/observed calls share real implementation; complete views, first-error behavior, load/resolve error pairing, metadata freshness and lookup-key/document-ID mismatch are covered. There are no ordinary-path timers/output; this is not a zero-overhead claim.
- Direct did have an expected missing-interface RED and two failed file reads. Later stage checks and final checks passed; independent RED evidence was not observed separately for stages 2/3. Native lane-01 had the expected RED, a compilation/check-budget failure and a model-initiated recheck that passed four protected plus two stage-1 host tests. Its partial implementation had no blocking finding in static review; that does not complete the large task.
- Root cause of lane-01: controller `allowedScope` becomes mandatory `snapshotManifest.includePrefixes`. A legal optional file was absent, so exact snapshot creation failed before the independent checker could start. This is both a controller scope limitation and a host configuration mismatch; it is not a demonstrated Rust defect. Source locations: `src/development/controller.ts` verification helper and `src/execution/exact-snapshot.ts` required-prefix check.
- The single supplement changed only that controller scope to the existing commands parent directory. Exact writable-file tools and all-other-files byte checks remained; independent review approved this host configuration. The run stopped before independent verification on a recorded `TASK_TIMEOUT`; the reason the provider request remained unfinished is unknown. Known setup/cache differences exclude this supplement from paired superiority claims.
- A separate zero-model, post-run diagnostic used the retained stage-1 candidate and corrected scope through the real independent-check API. Exact trusted verification succeeded and the recipe actually started, but the overall check failed with exit 1 after 40.502s. The aggregate retained only short previews, insufficient to establish the recipe failure's precise cause. No queue acceptance/application occurred and no initial result was replaced.
- Current warm synthetic timing supports targeted investigation: evidence resolution occupied about 76–81% of observed unique-case time; graph load about 72–80% for shared cases. All 16 host-final rows were retained. This does not establish the historical unique/100 +41.51% regression's cause: no historical implementation was paired in the same environment, observer/caching/order effects remain, and nested phase times cannot be added again to total time.

### Causal diagnosis: execution constraints, not established loss of model ability

The observed problem is brittle delivery control plus unequal executor/budget configurations. Lane-01 wrote and tested a viable stage-1 candidate before a host/controller scope mismatch blocked delivery; lane-03 was cancelled by the fixed worker deadline. Neither demonstrates reduced coding ability. The following intervals were recomputed from request/command records; model and checker intervals did not overlap. Checker time includes expected RED and necessary verification, not only failed work.

| Run | Model request intervals | Checker command intervals | Remaining wall time |
|---|---:|---:|---:|
| Native lane-01 | 92.849s | 53.780s / 3 calls | 10.962s |
| Direct lane-02 | 213.416s | 139.837s / 6 calls | 3.428s |
| Native supplement lane-03 | 299.901s | 0s / 0 calls | 10.018s |

Remaining time includes setup, file tools, formatting, logging and scheduling; it is not a measurement of pure framework overhead. Model intervals include provider/network waiting and generation. Native's last 279.270s request dominates the supplement, but its internal activity is unknown. Failed partial runs cannot be compared with completed work as speed/cost savings.

- **Confirmed delivery constraints:** optional allowed scope became mandatory snapshot input (`src/development/controller.ts:160`, `src/execution/exact-snapshot.ts:368`); the native implementer fixes both time limits to 300,000ms (`src/native/write-session.ts:173`). The compilation/check-budget failure and later successful worker recheck also show that verification budgeting needs attention. The separate 40.502s post-run recipe failure remains undiagnosed; do not silently classify it as another timeout. Preserve snapshot/isolation checks while making the task fit their actual semantics.
- **Host experiment defect:** prompts referenced `task.json` and `objective.txt`, but those files were outside all candidate roots; all three workers attempted missing-file reads, and lane-01 also tried `docs/STATUS.md`. These were ENOENT, not permission refusals. Failed-read I/O itself took only 25/22/13ms; extra model-turn cost is not isolated. Fix context delivery before attributing this friction to pi-sparkle.
- **Uncontrolled execution differences:** the runner uses Pi Coding SDK `createAgentSession` with its default system-prompt builder for direct, but `createConfiguredPiExecutor` creates a pi-agent-core `Agent` for native (`src/pi-adapter/pi-executor.ts:564`). Native also receives role/acceptance instructions (`src/run/child-prompt.ts:30`) and only the current stage's write scope; direct retains all three cards in one session. This is a workflow comparison, not a controlled ablation of framework weight.
- **Limits of the freedom hypothesis:** both arms have restricted file/test/format tools and no arbitrary shell or installation. No logged valid write was denied. Native lane-01 successfully wrote, patched, formatted and tested. There is no evidence that the repository's large docs/skills inventory was automatically loaded; direct explicitly disabled that loading and native used custom prompts. Prompt volume and lost reasoning capacity were not measured.
- **Observed completion tail versus unobserved costs:** after lane-01's first passing stage check, two more model requests took 19.061s and reference USD 0.0180016, within a 20.132s tail ending at failure. This includes rereading and task-result completion, not exclusively avoidable reporting. No native stage 2/3, independent recipe command, accept/apply transition or cross-stage handoff ran in either model trial. Repeated integration checks and lost cross-stage context remain hypotheses, not measured causes.

Practical direction: keep coherent implementation work inside a Pi worker, with pi-sparkle managing assignment and independent final verification where it adds value. This is a design hypothesis, not a runtime change or proven improvement. A future controlled diagnosis should use the same bounded stage-1 task, actual executor/system prompt, tools, environment and 300s worker deadline in both arms; vary only controller orchestration and measure candidate quality separately from delivery overhead. Compare one-session versus staged work separately afterward. First correct missing prompt files, optional-scope setup and checker diagnostics; retain isolation, protected-file checks and explicit application authorization. That historical analysis did not itself perform another model trial or runtime modification; the subsequent bounded work is recorded above.

### Preparation, preservation and verification limits

The first pre-model build failed in vendored OpenSSL and exceeded the output limit after 739.633s; nmake's precise low-level cause was obscured. Its process tree was checked gone. A diagnostic build was explicitly cancelled at 119.580s. Investigation found the new environment whitelist omitted the previously successful static OpenSSL setup. Existing OpenSSL 3.6.3 include/lib were copied into the test directory, with a fixed MSVC/SDK environment for both arms. The next 91.293s preparation run passed all four original tests and failed specifically on the absent requested observer API. These three runs alone consumed 950.506s, outside the measured arms. SDK preflights used zero model calls.

The existing Windows command runner does not guarantee descendant-tree containment; an erroneous harness comment was corrected. Timeout/cleanup uncertainty requires actual host reconciliation before later work. No runtime containment feature was added. Final process inspection found no scoped trial processes remaining. A selected-file byte comparison found 427/427 original Soul files unchanged; original HEAD remained `6a56d852`. Original writes, commits, installs, applications and publication were zero; concurrent unrelated Soul state is outside this comparison.

Commands, failures and review are summarized in the results PR for the [results branch](https://github.com/Xhhemoing/pi-sparkle/tree/codex/soul-large-task-results-20261022). Raw protocol, request records, private source/candidates and logs remain local under `.agent_workspace/soul-large-task/`; do not publish them. Main commands: `pnpm exec tsx .agent_workspace/soul-large-task/run.ts lane-01|lane-02`, `run-scope-followup.ts lane-03`, `post-scope-check.ts`, fixed offline Cargo/Rustfmt checks, and `pnpm workflow:check`. PR #67 changed only existing task records and generated STATUS. Hosted CI validates that documentation revision; it does not rerun the private Soul trial or merge the tested #66 runtime. Full Soul/desktop/Session/real-data gates, automatic task decomposition, successful three-stage host integration, user acceptance and outcome superiority remain unverified.

### Next decision and retained obligations

Stop further large-task retries. Preserve the direct candidate for owner inspection; applying anything to original Soul requires a separate request. Use direct Pi or narrow delegation as the conservative current path. Any next comparison must first fit the existing scope semantics, make checker failures diagnosable and match executor/prompt/worker deadline before claiming a framework-specific effect; successful dependent integration and useful quality/cost gains must be observed before expanding runtime. Do not turn the present failures into further slices or routine reports.

Owner review of #65/#66, the older helper cleanup defect, and the broader 15-task evaluation remain open. [Previous plan](archive/2026-10-21-pre-integration-plan.md) and [previous checklist](archive/2026-10-21-pre-integration-checklist.md) preserve F6 custody/holdout, S0-min, R10/R11, PR #36 artifacts, privacy, containment and production conditions. The [status matrix](../docs/status-matrix.md) retains scoped claims; this experiment does not override them.

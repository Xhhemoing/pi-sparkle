# Pi-sparkle 当前架构：迁移计划

本计划落实已接受的 [ADR-009](decisions/0009-lightweight-adaptive-framework.md)。M0–M7 是可拆分的工作切片，不是八个新模块、固定日期承诺或要求全部完成的发布清单。当前能力见[状态矩阵](status-matrix.md)，行为合同见[算法文档](architecture-algorithms.md)。本轮仅写文档，不把任何切片标记为已实施。

## 1. 最小交付与依赖

先让现有能力可靠停止，并让直接任务更好用。默认一个 worker，不强制项目队列或金额输入，保留严格开发路径；项目连接、画像推断和长期实验都不是核心可用的前置。

| 切片 | 依赖与可并行关系 | 主要责任 | 对应算法 |
|---|---|---|---|
| M0 基线与进程所有权 | 基线最先固定；进程修复先于扩大 live、新并发修复和受管进程 | runtime/process | A10 |
| M1 直接任务可用 | 基线后可做入口/工具；涉及真实进程的交付需满足 M0 | application/coding | A1、A3、A10 |
| M2 边界与窄 SDK | 与 M1 按文件分工并行；插件接入复用可用的核心端口 | core/plugin | A9 |
| M3 动态发现与局部纠偏 | M1 可用；只读观察可先做，自动修复依赖 M0 的停止/对账 | runtime/application | A2、A10 |
| M4 费用路由与即时偏好 | 核心可用后独立增量；观察、路由、显式 overlay 可分别交付 | policy/preferences | A3、A4、A6 |
| M5 受管 Pi 更新 | M0 与清楚的 adapter 契约；不等待 M6/M7 | compatibility/process | A5 |
| M6 项目与外部连接 | 复用现有队列/controller；connector 与项目检索可分别交付 | development/connector | A8 |
| M7 长期策略优化 | 可归因事实与 M4 的观测基础；不等待全部 connector；自动试用另受既有 gate | evaluation/adaptation | A7 |

M1 的直接任务、基础小工具和相称检查构成首个用户可见增量。M2 可以先交付纯破环再交付 SDK。M4 的严格预留单独按需实现，不能阻塞无金额上限的普通任务。每个新增行为先有聚焦回归，迁移与算法改动分开提交；切片过大时继续拆，不为保持编号合并无关工作。

## 2. M0 基线与进程所有权

先固定实际 heads、接口与证据。源码审查基线是 PR #60 `7407674`；审查时 main 为 `44db4b1`，PR #61 `c4a9e3c` 独立且有重叠。实施前实际 fetch，核对 merge-base/range-diff，再选择需要的 recovery/terminal 变更；不能直接叠合两个 PR，也不从本地缺失对象推断精确共同祖先。本次文档不合并它们。

主要触点：[command-runner](../src/execution/command-runner.ts)、[independent-check](../src/execution/independent-check.ts)、[recipe-check](../src/development/recipe-check.ts)、相关 run 取消与资源结束记录。统一资源归属，取消后先停止新准入，再等待子孙实际结束或保留未结状态；只有真实结束才能释放工作区、写入所有权和相应预留。

当前发现来自等价嵌套 runner：内层 detached 进程组可能逃离外层取消。这不是完整 `develop` E2E，也未证明 Windows 行为。现有正常超时配置下外层窗口大于 recipe 总限时，重点仍要覆盖显式取消、上游 deadline 和崩溃。

**退出证据：** 真实 develop recipe 链在 abort/deadline、父崩溃、忽略 TERM、重复取消与迟到结果下，无后续文件写入，或明确 unsettled 且不接受、不重用、不自动重放；POSIX/Windows 分别记录证据。保存固定任务的非模型耗时、环境准备、用量覆盖基线，未测项目保持 unknown。

**退路：** 停止受影响新任务，保留候选和效果供对账。不能回退到已知不安全行为后声称 clean。纯文档/依赖梳理可继续，不用一个平台的未验证结论冒充全平台完成。

## 3. M1 直接任务可用

以薄的 `startDevelopmentTask` 目标入口复用 [NativeWriteSession](../src/native/write-session.ts)，不重建 agent loop。该名字是设计接口，尚非现有稳定 API。补 list/search/range-read/精确 patch/命名诊断；现有受控 workspace 与 Pi 工具包装分开，上层不用 Pi 类型表示文件能力。

触点：[development CLI](../src/cli/development.ts)、[write-session](../src/native/write-session.ts)、[write-loop](../src/native/write-loop.ts)、[context](../src/context/index.ts)、[worktree-coding-tools](../src/pi-adapter/worktree-coding-tools.ts)。先接代码中的 CodeMap 输入来源与任务局部选择，不另建默认向量服务。

**退出证据：** 一组明确、可逆的小任务无需队列、金额填写或额外 planner 调用；相关测试失败可在同候选有限修复；相同授权不重复询问；protected checker、strict develop 验收、CLI/事件输出保持原语义。必须上下文不可读、过期或装不下有明确失败，不静默删目标。

**退路：** 新入口可关闭，旧路径继续可用；工具不可用退到受控范围读取/搜索，必要检查不可用则报告阻塞。保留已有候选与收据，不同时改变持久 schema。

## 4. M2 边界与窄 SDK

先做行为保持重构：`cli/main ↔ cli/pref` 的共享选项退出 main；宿主无关 model-catalog 构建退出 CLI；`privacy/state-layout` 下沉为基础布局，deletion/retention 保留应用级组合。路径搬迁保留转发，不顺手改变记录字节与算法。

触点：[main](../src/cli/main.ts)、[pref](../src/cli/pref.ts)、[model-catalog](../src/cli/model-catalog.ts)、[native routing-catalog](../src/native/routing-catalog.ts)、[track loop](../src/track/loop.ts)、[state-layout](../src/privacy/state-layout.ts)、[package.json](../package.json)。继续执行 Pi 双边界与 live/adaptation 隔离，先冻结不得新增违规边，再逐项减少旧例外。

SDK 首批拟稳定公开 context/diagnostic，目标入口为 sdk/host/testing；tool/observer 后续实验。保留扩展现有懒加载，注册先暂存、校验唯一 ID 后发布；并发首次请求共用 activation promise，取消/generation 拒绝过期提案，迟到效果收据与用量仍记录并幂等结算。

**退出证据：** 未启用插件零激活，两个外部示例不依赖未支持的内部路径；打包后的消费者能编译/运行；唯一现有 runtime 文件循环消除，相关 CLI/native 固定输出不变；关闭插件后主链可用。

**退路：** 保留已知深路径转发与明确迁移窗口，再收窄 exports。当前没有稳定 package exports；新增 exports 会限制包名深导入，移动 dist 也会破坏相对导入，二者都需检查。不要把全部内部 export 永久承诺为 SDK，不按 36 组目录拆包。

## 5. M3 动态发现与局部纠偏

先交付只读 finding 与摘要：消费已有工具、测试和源变化，规范化原因/位置/目标，绑定 revision、generation 和不透明证据版本。相同证据不反复分析；必要时 single-flight 短时调查；原始取消/效果/计费事实不进入可丢弃队列。

触点：[execution contract](../src/execution/contract.ts)、[run events](../src/run/events.ts)、[controller](../src/development/controller.ts)、[write-loop](../src/native/write-loop.ts)、[store](../src/development/work-item-store.ts)。不把模型自报当可信 host observation；冻结事件/schema 需要显式兼容设计。

再启用范围内可逆修复：同一候选写入者在安全动作边界处理一次；重大阻塞先 stop/settle/reconcile，再准备独立修复。基线变化后重建或重验原候选。当前 store 无 append/replan 公共 API，不直接改 JSON 绕过它。

**退出证据：** 重复日志不放大模型调用；新危害不被 cooldown 压住；旧分析结果不生效；同边界不并发派两个重叠修复；未结效果不释放 claim；已授权修复无需重新确认；无关工作仍可继续。

**退路：** 先 shadow 只展示，再选择性启用；关闭观察/修复能力不影响普通任务。无法定位时换一次有界诊断或给出明确阻塞，不无限加 agent。

## 6. M4 费用路由与即时偏好

将本切片拆成三个可独立交付部分：用量覆盖/失败归因、静态能力路由、task 偏好 overlay。严格共享准入是另一个按需增量，不要求每个普通任务先建账本或填写金额。

触点：[CostGate](../src/pi-adapter/cost-gate.ts)、[invocation-log](../src/telemetry/invocation-log.ts)、[usage-aggregate](../src/telemetry/usage-aggregate.ts)、[model-router](../src/supervisor/model-router.ts)、[preferences](../src/preferences/store.ts)、[clarify](../src/track/clarify.ts)、[context](../src/context/index.ts)。优先复用已有模型目录、失败分类和偏好记录，不另建用户库。

**退出证据：** 普通观察模式可在价格 unknown 时继续且不算零；用户指定有效；环境/provider 失败不盲目升级模型或跨层重复重试；本次详细覆盖全局简短而不污染默认；明确 correct/delete 不走实验，删除会失效派生缓存且不被旧来源复活。

严格准入另外验证可靠上界、共享原子预留、幂等结算、未知费用、重复/冲突收据、取消与崩溃对账、祖先强制上限不可被后代撤销。各累计 scope 使用自己的 ledger；准入保证不宣传为供应商账单保证。

**退路：** 固定配置主模型；关闭推断仍保留显式偏好。严格模式缺可靠上界就明确不可用，不静默切为观察。已产生新数据时遵守第 10 节的回滚规则。

## 7. M5 受管 Pi 动态更新

先适配实际停止语义，再建立更新管理。新的 driver 必须在下一 provider 请求前观察并只计一次本轮用量；单纯把 `shouldStopAfterTurn` 改名为 `finishTurn` 不足以验证时序。

触点：[pi-adapter](../src/pi-adapter/index.ts)、[pi-compat](../src/pi-compat/check.ts)、[latest check](../scripts/pi-latest-check.mjs)、兼容 probe/fixture 与 CI。候选在独立目录/进程验证，发布完整资格记录后才原子更新 approved 指针。记录绑定不透明 generation ID、driver/test/policy/environment 和精确 manifest 字节。

standalone 首期一个 root run 一个受管进程；子任务、重试与恢复保持绑定。native 宿主升级单独验证，需要新宿主进程；不跨 IPC 搬函数认证，不为升级先维护三套后端。发现升级不在每次普通任务关键路径阻塞网络。

**退出证据：** 真实 Pi Agent 与 deterministic provider 的候选矩阵验证事件、工具、取消、计费、停止和 settlement；首轮达到停止条件后 `providerCalls=1`；版本不匹配拒绝使用；运行 lease/恢复引用阻止清理旧 generation。真实 provider smoke 另经既有条件；独立策略原型不能替代以上证据。

**退路：** 继续已知可用 generation，离线可用已安装版本。只切新 root run；旧版不可用时明确恢复阻塞，不用“没有 receipt”证明没有 dispatch。跨版本重开需独立证明全树在任何外部派发前已结束，不能删除未知效果绕过。

## 8. M6 项目与外部连接

先提供 `advanceProject` 薄函数和只读进展/经验检索。外层读事实、对账、调用 `controller.runNext()`；不先 claim 再调用，也不复制 scheduler。accepted 候选未集成源代码时，不解锁依赖。

触点：[controller](../src/development/controller.ts)、[work-items](../src/development/work-items.ts)、[store](../src/development/work-item-store.ts)、[batch](../src/development/batch.ts)、[ProjectSnapshot](../src/domain/project.ts)。经验视图有来源、时效和失效规则，但不能拥有任务完成状态。

外部连接先只读 issue 草稿，再写自身进展区；计划 patch 和 webhook 可后续独立增加。拟议 `applyPlanPatch(expectedRevision)` 只改未开始的 planned 定义，在现有 store 内验证 revision、授权、依赖无环，不转移旧验收；不创建新 ProjectPlan 数据库。

connector 使用 delivery/规范对象/operation 三类不同身份。内容去重按固定规范化版本精确字节比较，不新造加密摘要。传输记录有独立大小、条数和 retention 上限，不塞满有限业务 ActionLedger；外部写仍先意图后效果/收据。GitHub 通用 PATCH 没有 ETag 写 CAS 保证，共享字段冲突产生 proposal，不覆盖人类内容。

**退出证据：** 并发 continue 不双执行；accepted 未集成不解锁；重复/乱序、issue/PR 别名、远端并发修改、丢响应、限流、满额与过期重投均不重复写入或覆盖。外部授权失败不能被误判为实体删除。网络故障不阻塞无关本地任务。

**退路：** 禁用推进/connector 后仍可手动 runNext；保留未决外部 receipt 与冲突，退回只读链接和草稿。定时触发由后续外部调用复用同一 claim，不在本轮建立内置 cron。

## 9. M7 长期策略优化

复用 [auto-loop](../src/learning/auto-loop.ts)、[adaptation](../src/adaptation/promotion.ts)、[rollback](../src/adaptation/rollback.ts)、[evaluation](../src/evaluation/types.ts)；先补真实任务归因和费用覆盖，再做冻结基线、时间切分离线比较与 shadow。当前 auto-loop 从不自动晋升，monitor 也未形成已验证的生产自动回滚链。

**退出证据：** 样本/归因可解释，无训练测试泄漏；取消和 provider 故障不一律归因模型；独立验收质量不下降；费用含失败、辅助分析和重试，缺口单列；旧策略可恢复。自动停止、回滚链实际触发验证后，才在明确一次性授权范围内考虑低风险自动试用，仍满足 ADR-004/005/007 和既有 gate。

**退路：** 保留冻结策略，关闭学习不影响普通任务及显式 correct/delete。候选不能修改权限、checker 或在飞运行代码。满意度不能替代真实性；框架代码优化形成普通开发任务与可审查候选，不在后台直接自换内核。

## 10. 跨切片兼容、旧 writer 与回滚

先盘点冻结 CLI/事件/JSON、Pi/native 注册、旧深导入和持久路径；每切片验证受影响表面，不把旧测试数量当当前行为证据。新的 read model 不能变成写入入口，测试 mock/缓存/历史 JSON 不能恢复 trusted apply capability。

新增 schema 先兼容读取，再用明确版本/副本切换写入，不双写两份业务权威。**只写一个“新版本 marker”不能阻止不认识 marker 的旧 binary。** 切换前要通过进程停止、宿主准入/可执行入口控制、写目录隔离或可证明的共同锁协议，让旧 writer 实际无法继续写同一数据；未证明互斥就不能升级共享目录。

已经写入新状态后，回退代码不等于回退数据。保存切换前可恢复副本与 locator，对新状态只读隔离，或用单独审查的逆向迁移；保留所有未结效果和 receipt。旧 binary 不得直接读取/改写不理解的新格式。回退期间仍维持单一写入权威，不复制已发生外部效果。

遵守 ADR-008：新 locator 用随机版本化不透明 ID；字节相等直接比较，不引入替代加密 hash。历史 SHA-bound 记录保留只读，不静默重算、升级、重新封存或授予新信任。

## 11. 验证与工作记录

后续每个实现切片按[开发工作流](development-workflow.md)先写最小失败回归，再实现并运行相关 gate；需要真实 provider、崩溃、多平台、benchmark 或 holdout 时单独记录条件。文档切片只需 workflow 与链接/内容检查，本轮不运行付费模型或生产迁移。

交付记录区分代码存在、已接通、实际演练、独立验收与效果支持。测量成功率、返工、费用覆盖和非模型开销，不宣称尚未实测的提速或省钱。可选优化没有收益时保持关闭，不把 M0–M7 全部完成变成核心发布条件。
